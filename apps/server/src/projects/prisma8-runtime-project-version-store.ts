import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  createProjectSnapshot,
  parseServerProjectSaveRequest,
  readProjectSnapshot,
  type ProjectSnapshot,
  type ScadaDocument,
} from "@adui/scada-core";
import type { Prisma8Transaction } from "../database/prisma8-read-transaction.js";
import { Prisma8Service } from "../database/prisma8.service.js";
import { nativeTextTransaction } from "../database/prisma8-text-transaction.js";
import {
  createB4Project,
  lockB4Identity,
  lockB4ProjectGrants,
  lockB4ReleaseState,
} from "../database/prisma8-b4-routines.js";
import { Prisma8RuntimeProjectQueryStore } from "./prisma8-runtime-project-query-store.js";
import {
  hasProjectPermission,
  type AuthenticatedProjectPrincipal,
  type ProjectAccessAction,
} from "./project-access-policy.js";
import {
  type ProjectVersionStore,
  ProjectAlreadyExistsError,
  ProjectRequestValidationError,
  ProjectRevisionConflictError,
  ProjectVersionAccessDeniedError,
  requirePrincipal,
  requireProjectId,
  type ProjectSummary,
} from "./project-version-store.js";

type Tx = Prisma8Transaction;

function bindPrincipal(
  principal: AuthenticatedProjectPrincipal | null,
): AuthenticatedProjectPrincipal {
  requirePrincipal(principal);
  return Object.freeze({ tenantId: principal.tenantId, subjectId: principal.subjectId });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseSave(input: unknown, projectId: string) {
  try {
    return parseServerProjectSaveRequest(input, projectId);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      throw new ProjectRequestValidationError(error.message);
    }
    throw error;
  }
}

/** 事务开始前复用共享请求校验，不从文档或请求体读取主体。 */
function prepareProjectCreation(principal: AuthenticatedProjectPrincipal | null, input: unknown) {
  const actor = bindPrincipal(principal);
  if (!isPlainRecord(input)) throw new ProjectRequestValidationError("工程创建请求必须为普通对象");
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, "document")) {
    throw new ProjectRequestValidationError("工程创建请求只允许 document 字段");
  }
  const document = input.document;
  if (!isPlainRecord(document) || typeof document.projectId !== "string") {
    throw new ProjectRequestValidationError("工程创建请求必须包含有效的工程文档");
  }
  return {
    actor,
    document: parseSave({ expectedRevision: null, document }, document.projectId).document,
  };
}

function prepareProjectAppend(
  principal: AuthenticatedProjectPrincipal | null,
  projectId: string,
  input: unknown,
) {
  const actor = bindPrincipal(principal);
  requireProjectId(projectId);
  return { actor, projectId, request: parseSave(input, projectId) };
}

async function checkedSnapshot(
  document: ScadaDocument,
  revision: number,
): Promise<ProjectSnapshot> {
  try {
    return await createProjectSnapshot(document, { revision, createdAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof RangeError && error.message === "工程版本快照超过 2 MiB 限制") {
      throw new ProjectRequestValidationError(error.message);
    }
    throw error;
  }
}

function requireAffected(actual: number, expected = 1): void {
  if (actual !== expected) throw new Error("工程版本事务影响行数异常");
}

/** 不可变快照、工程水位、成功审计全部写入并在同一事务内回读。 */
async function persistVersion(
  tx: Tx,
  actor: AuthenticatedProjectPrincipal,
  snapshot: ProjectSnapshot,
  previous: bigint,
): Promise<void> {
  const { tenantId, subjectId } = actor;
  const { projectId, revision, contentHash, createdAt } = snapshot;
  const eventId = randomUUID();
  requireAffected(
    (
      await tx.execute(
        tx.raw.sql`INSERT INTO public.scada_project_versions
      (tenant_id, project_id, revision, snapshot, content_hash, created_by, created_at)
      VALUES (${tenantId}, ${projectId}, ${BigInt(revision)}, ${JSON.stringify(snapshot)}::jsonb, ${contentHash}, ${subjectId}, ${createdAt}::timestamptz)`
          .affectedCount()
          .build(),
      )
    ).affectedRows,
  );
  requireAffected(
    (
      await tx.execute(
        tx.raw
          .sql`UPDATE public.scada_projects SET head_revision = ${BigInt(revision)}, updated_at = ${createdAt}::timestamptz
      WHERE tenant_id = ${tenantId} AND project_id = ${projectId} AND head_revision = ${previous}`
          .affectedCount()
          .build(),
      )
    ).affectedRows,
  );
  requireAffected(
    (
      await tx.execute(
        tx.raw.sql`INSERT INTO public.scada_project_audit
      (event_id, tenant_id, project_id, revision, actor_id, action)
      VALUES (${eventId}::uuid, ${tenantId}, ${projectId}, ${BigInt(revision)}, ${subjectId}, 'version:append')`
          .affectedCount()
          .build(),
      )
    ).affectedRows,
  );

  await verifyPersistedVersion(tx, actor, snapshot, eventId);
}

/** 首版和追加共用真实快照、工程水位、审计回读，不信任单独的写入返回值。 */
async function verifyPersistedVersion(
  tx: Tx,
  actor: AuthenticatedProjectPrincipal,
  snapshot: ProjectSnapshot,
  eventId: string,
): Promise<void> {
  const { tenantId, subjectId } = actor;
  const { projectId, revision, contentHash, createdAt } = snapshot;
  const rows = await tx
    .query(
      tx.raw.sql`SELECT v.snapshot::text AS snapshot_data, v.content_hash::text AS content_hash,
      v.created_by::text AS created_by, v.created_at::text AS created_at,
      p.head_revision::text AS head_revision, a.actor_id::text AS actor_id,
      a.action::text AS action, a.event_id::text AS event_id
      FROM public.scada_project_versions v
      JOIN public.scada_projects p ON p.tenant_id = v.tenant_id AND p.project_id = v.project_id
      JOIN public.scada_project_audit a ON a.tenant_id = v.tenant_id AND a.project_id = v.project_id AND a.revision = v.revision
      WHERE v.tenant_id = ${tenantId} AND v.project_id = ${projectId} AND v.revision = ${BigInt(revision)}`
        .returnsRow({
          snapshot_data: "pg/text@1",
          content_hash: "pg/text@1",
          created_by: "pg/text@1",
          created_at: "pg/text@1",
          head_revision: "pg/text@1",
          actor_id: "pg/text@1",
          action: "pg/text@1",
          event_id: "pg/text@1",
        })
        .build(),
    )
    .toArray();
  const row = rows[0];
  if (
    rows.length !== 1 ||
    !row ||
    row.content_hash !== contentHash ||
    row.created_by !== subjectId ||
    new Date(row.created_at).toISOString() !== createdAt ||
    row.head_revision !== String(revision) ||
    row.actor_id !== subjectId ||
    row.action !== "version:append" ||
    row.event_id !== eventId
  ) {
    throw new Error("工程版本事务回读元数据不一致");
  }
  const data: unknown = JSON.parse(row.snapshot_data);
  const restored = await readProjectSnapshot(data);
  if (
    restored.contentHash !== contentHash ||
    restored.projectId !== projectId ||
    restored.revision !== revision ||
    restored.createdAt !== createdAt
  ) {
    throw new Error("工程版本事务回读快照不一致");
  }
}

async function appendPrepared(
  tx: Tx,
  prepared: ReturnType<typeof prepareProjectAppend>,
): Promise<ProjectSnapshot> {
  const { actor, projectId, request } = prepared;
  const { tenantId, subjectId } = actor;
  // 工程写入与授权复核使用同一行锁和原生事务。
  const rows = await tx
    .query(
      tx.raw.sql`SELECT head_revision::text AS head_revision FROM public.scada_projects
      WHERE tenant_id = ${tenantId} AND project_id = ${projectId} FOR UPDATE`
        .returnsRow({ head_revision: "pg/text@1" })
        .build(),
    )
    .toArray();
  if (rows.length !== 1 || !rows[0]) throw new ProjectVersionAccessDeniedError();
  const routineTx = nativeTextTransaction(tx, "工程事务查询结果缺少有效文本列");
  const identities = await lockB4Identity(routineTx, tenantId, subjectId);
  if (identities.length !== 1 || identities[0]?.status !== "active")
    throw new ProjectVersionAccessDeniedError();
  const grants = await lockB4ProjectGrants(routineTx, tenantId, projectId, subjectId);
  if (
    !hasProjectPermission(
      actor,
      { tenantId, projectId },
      {
        tenantId,
        projectId,
        subjectId,
        permissions: grants.map((grant) => grant.permission as ProjectAccessAction),
      },
      "version:append",
    )
  )
    throw new ProjectVersionAccessDeniedError();
  const headText = rows[0].head_revision;
  if (!/^(0|[1-9]\d*)$/.test(headText)) throw new TypeError("数据库工程修订号异常");
  const head = BigInt(headText);
  if (head !== BigInt(request.expectedRevision ?? 0)) throw new ProjectRevisionConflictError();
  if (head >= BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("工程修订号超出安全整数范围");
  const snapshot = await checkedSnapshot(request.document, Number(head + 1n));
  await persistVersion(tx, actor, snapshot, head);
  return snapshot;
}

/** 全新业务库工程读写仓储，只通过原生提供方取得事务。 */
@Injectable()
export class Prisma8RuntimeProjectVersionStore
  extends Prisma8RuntimeProjectQueryStore
  implements ProjectVersionStore
{
  constructor(private readonly database: Prisma8Service) {
    super(database);
  }

  async create(
    principal: AuthenticatedProjectPrincipal | null,
    input: unknown,
  ): Promise<ProjectSummary> {
    const { actor, document } = prepareProjectCreation(principal, input);
    const { tenantId, subjectId } = actor;
    this.database.assertWritable();
    const snapshot = await checkedSnapshot(document, 1);
    const { projectId, createdAt } = snapshot;
    return this.database.writeTransaction(async (tx) => {
      const routineTx = nativeTextTransaction(tx, "工程事务查询结果缺少有效文本列");
      const eventId = randomUUID();
      const result = await createB4Project(routineTx, tenantId, subjectId, snapshot, eventId);
      if (result === "DENIED") throw new ProjectVersionAccessDeniedError();
      if (result === "EXISTS") throw new ProjectAlreadyExistsError();
      await verifyPersistedVersion(tx, actor, snapshot, eventId);
      const states = await lockB4ReleaseState(routineTx, tenantId, projectId, false);
      const state = states[0];
      if (
        states.length !== 1 || !state || state.generation !== "0" || state.revision !== "" ||
        state.hash !== "" || state.event_id !== "" || state.hash_is_null !== "true"
      ) {
        throw new Error("工程首版发布状态回读不一致");
      }
      const grants = await lockB4ProjectGrants(routineTx, tenantId, projectId, subjectId);
      const permissions = new Set(grants.map((grant) => grant.permission));
      if (
        grants.length !== 3 || permissions.size !== 3 ||
        !permissions.has("project:read") || !permissions.has("version:read") ||
        !permissions.has("version:append")
      ) {
        throw new Error("工程首版创建者授权回读不一致");
      }
      return { projectId, headRevision: 1, createdAt, updatedAt: createdAt };
    });
  }

  async append(
    principal: AuthenticatedProjectPrincipal | null,
    projectId: string,
    input: unknown,
  ): Promise<ProjectSnapshot> {
    const prepared = prepareProjectAppend(principal, projectId, input);
    return this.database.writeTransaction((tx) => appendPrepared(tx, prepared));
  }
}
