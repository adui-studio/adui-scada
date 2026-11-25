import { createHash, randomUUID } from "node:crypto";
import { validateProjectReleasePreflight, type ProjectSnapshot } from "@adui/scada-core";
import type { PostgresClient, PostgresTransactionContext } from "@prisma/orm-postgres/runtime";
import type { Contract } from "../generated/prisma8/contract.d.js";
import {
  hasProjectPermission,
  type AuthenticatedProjectPrincipal,
  type ProjectAccessAction,
} from "./project-access-policy.js";
import {
  ProjectRequestValidationError,
  ProjectRevisionConflictError,
  ProjectVersionAccessDeniedError,
  requirePrincipal,
  requireProjectId,
} from "./prisma-project-version-store.js";
import {
  ProjectReleaseSessionInvalidError,
  ProjectReleaseConflictError,
  ProjectReleasePreflightRejectedError,
  type ProjectReleaseResult,
  type ProjectCurrentReleaseResult,
} from "./prisma-project-release-store.js";
import {
  assessProjectReleaseSafety,
  ProjectReleaseGateUnavailableError,
  type ProjectReleaseSafetyContext,
  type ProjectReleaseSafetyBlock,
} from "./project-release-safety-gate.js";
import { validatePrisma8ProjectSnapshot } from "./prisma8-project-query-store.js";

type Tx = PostgresTransactionContext<Contract>;
const OPTIONS = { isolationLevel: "ReadCommitted", timeout: 10000 } as const;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/** 正式发布命令；不接受工程正文、主体、租户、摘要或客户端发布结论。 */
interface ProjectPublishRequest {
  readonly expectedHeadRevision: number;
  readonly targetRevision: number;
  readonly expectedReleaseGeneration: number;
  readonly idempotencyKey: string;
}

interface ReleaseEventResultRow {
  readonly eventId: string;
  readonly generation: bigint;
  readonly action: string;
  readonly toRevision: bigint;
  readonly toContentHash: string;
  readonly createdAt: Date;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseSafePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ProjectRequestValidationError(label + "必须是大于零的安全整数");
  }
  return value as number;
}

function parseSafeNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ProjectRequestValidationError(label + "必须是非负安全整数");
  }
  return value as number;
}

/** 请求体与幂等头均使用精确白名单，禁止客户端指定快照或可信身份字段。 */
export function parsePrisma8PublishRequest(
  input: unknown,
  idempotencyKey: unknown,
): ProjectPublishRequest {
  if (!isPlainRecord(input)) {
    throw new ProjectRequestValidationError("正式发布请求必须为普通对象");
  }
  const fields = Object.keys(input);
  if (
    fields.length !== 3 ||
    fields.some(
      (field) =>
        field !== "expectedHeadRevision" &&
        field !== "targetRevision" &&
        field !== "expectedReleaseGeneration",
    )
  ) {
    throw new ProjectRequestValidationError(
      "正式发布请求只允许 expectedHeadRevision、targetRevision 和 expectedReleaseGeneration",
    );
  }
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new ProjectRequestValidationError("Idempotency-Key 必须为服务端生成的 UUID v4");
  }

  const expectedHeadRevision = parseSafePositiveInteger(
    input.expectedHeadRevision,
    "预期工程修订号",
  );
  const targetRevision = parseSafePositiveInteger(input.targetRevision, "目标发布修订号");
  const expectedReleaseGeneration = parseSafeNonNegativeInteger(
    input.expectedReleaseGeneration,
    "预期发布代次",
  );
  if (targetRevision !== expectedHeadRevision) {
    throw new ProjectRequestValidationError("首次正式发布目标必须等于预期工程 head 修订号");
  }

  return {
    expectedHeadRevision,
    targetRevision,
    expectedReleaseGeneration,
    idempotencyKey,
  };
}

function createSemanticHash(projectId: string, request: ProjectPublishRequest): string {
  const semanticRequest = {
    action: "PUBLISH",
    projectId,
    expectedHeadRevision: request.expectedHeadRevision,
    targetRevision: request.targetRevision,
    expectedReleaseGeneration: request.expectedReleaseGeneration,
  };
  return createHash("sha256").update(JSON.stringify(semanticRequest), "utf8").digest("hex");
}

async function requireBoundary(tx: Tx): Promise<void> {
  const rows = await tx
    .query(
      tx.raw.sql`SELECT current_database()::text AS database_name,
      current_schema()::text AS schema_name,
      current_setting('transaction_read_only') AS read_only,
      current_setting('transaction_isolation') AS isolation`
        .returnsRow({
          database_name: "pg/text@1",
          schema_name: "pg/text@1",
          read_only: "pg/text@1",
          isolation: "pg/text@1",
        })
        .build(),
    )
    .toArray();
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row?.database_name !== "adui_scada_test" ||
    row.schema_name !== "public" ||
    row.read_only !== "off" ||
    row.isolation !== "read committed"
  )
    throw new Error("Prisma 8 发布候选仅允许隔离库读已提交事务");
}

function validateReleaseState(state: {
  readonly releaseGeneration: bigint;
  readonly releasedRevision: bigint | null;
  readonly releasedContentHash: string | null;
  readonly lastReleaseEventId: string | null;
}): void {
  if (
    typeof state.releaseGeneration !== "bigint" ||
    state.releaseGeneration < 0n ||
    state.releaseGeneration > MAX_SAFE_BIGINT ||
    (state.releasedRevision !== null &&
      (typeof state.releasedRevision !== "bigint" ||
        state.releasedRevision <= 0n ||
        state.releasedRevision > MAX_SAFE_BIGINT)) ||
    (state.releasedContentHash !== null && !SHA256_PATTERN.test(state.releasedContentHash)) ||
    (state.releasedRevision === null) !== (state.releasedContentHash === null) ||
    (state.releaseGeneration === 0n &&
      (state.releasedRevision !== null ||
        state.releasedContentHash !== null ||
        state.lastReleaseEventId !== null)) ||
    (state.releaseGeneration > 0n &&
      (state.releasedRevision === null ||
        state.releasedContentHash === null ||
        state.lastReleaseEventId === null))
  ) {
    throw new TypeError("数据库工程正式发布状态不符合生命周期约束");
  }
}

function toReleaseResult(projectId: string, event: ReleaseEventResultRow): ProjectReleaseResult {
  if (
    event.action !== "PUBLISH" ||
    event.generation <= 0n ||
    event.generation > MAX_SAFE_BIGINT ||
    event.toRevision <= 0n ||
    event.toRevision > MAX_SAFE_BIGINT ||
    !SHA256_PATTERN.test(event.toContentHash) ||
    typeof event.eventId !== "string" ||
    !(event.createdAt instanceof Date) ||
    !Number.isFinite(event.createdAt.getTime())
  ) {
    throw new TypeError("数据库正式发布事件记录无效");
  }

  const releasedRevision = Number(event.toRevision);
  return {
    projectId,
    action: "PUBLISH",
    headRevision: releasedRevision,
    releasedRevision,
    releasedContentHash: event.toContentHash,
    releaseGeneration: Number(event.generation),
    eventId: event.eventId,
    createdAt: event.createdAt.toISOString(),
  };
}

type ReleaseState = Parameters<typeof validateReleaseState>[0];

function bindActor(principal: AuthenticatedProjectPrincipal | null): AuthenticatedProjectPrincipal {
  requirePrincipal(principal);
  return Object.freeze({ tenantId: principal.tenantId, subjectId: principal.subjectId });
}

async function lockSessionAndPermission(
  tx: Tx,
  actor: AuthenticatedProjectPrincipal,
  projectId: string,
  sessionId: string | null,
  action: "release:read" | "release:publish",
): Promise<void> {
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new ProjectReleaseSessionInvalidError();
  }
  const { tenantId, subjectId } = actor;
  const sessions = await tx
    .query(
      tx.raw.sql`SELECT s.session_id::text AS session_id FROM public.scada_auth_sessions s
      JOIN public.scada_identities i ON i.tenant_id = s.tenant_id AND i.subject_id = s.subject_id
      WHERE s.session_id = ${sessionId}::uuid AND s.tenant_id = ${tenantId} AND s.subject_id = ${subjectId}
        AND s.revoked_at IS NULL AND s.issued_at <= CURRENT_TIMESTAMP
        AND s.expires_at > CURRENT_TIMESTAMP AND i.status = 'active'
      FOR SHARE OF s, i`
        .returnsRow({ session_id: "pg/text@1" })
        .build(),
    )
    .toArray();
  if (sessions.length !== 1) throw new ProjectReleaseSessionInvalidError();
  const grants = await tx
    .query(
      tx.raw.sql`SELECT permission::text AS permission FROM public.scada_project_grants
      WHERE tenant_id = ${tenantId} AND project_id = ${projectId} AND subject_id = ${subjectId}
      FOR SHARE`
        .returnsRow({ permission: "pg/text@1" })
        .build(),
    )
    .toArray();
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
      action,
    )
  )
    throw new ProjectVersionAccessDeniedError();
}

const STATE_COLUMNS = {
  generation: "pg/text@1",
  revision: "pg/text@1",
  hash: "pg/text@1",
  event_id: "pg/text@1",
  hash_is_null: "pg/text@1",
} as const;

async function lockState(
  tx: Tx,
  tenantId: string,
  projectId: string,
  write: boolean,
): Promise<ReleaseState> {
  const rows = write
    ? await tx
        .query(
          tx.raw.sql`SELECT release_generation::text AS generation,
          COALESCE(released_revision::text, '') AS revision, COALESCE(released_content_hash::text, '') AS hash,
          COALESCE(last_release_event_id::text, '') AS event_id, (released_content_hash IS NULL)::text AS hash_is_null
          FROM public.scada_project_release_state WHERE tenant_id = ${tenantId} AND project_id = ${projectId}
          FOR UPDATE`
            .returnsRow(STATE_COLUMNS)
            .build(),
        )
        .toArray()
    : await tx
        .query(
          tx.raw.sql`SELECT release_generation::text AS generation,
          COALESCE(released_revision::text, '') AS revision, COALESCE(released_content_hash::text, '') AS hash,
          COALESCE(last_release_event_id::text, '') AS event_id, (released_content_hash IS NULL)::text AS hash_is_null
          FROM public.scada_project_release_state WHERE tenant_id = ${tenantId} AND project_id = ${projectId}
          FOR SHARE`
            .returnsRow(STATE_COLUMNS)
            .build(),
        )
        .toArray();
  const row = rows[0];
  if (rows.length !== 1 || !row) throw new TypeError("数据库工程正式发布状态记录缺失");
  const state = {
    releaseGeneration: BigInt(row.generation),
    releasedRevision: row.revision === "" ? null : BigInt(row.revision),
    releasedContentHash: row.hash_is_null === "true" ? null : row.hash,
    lastReleaseEventId: row.event_id === "" ? null : row.event_id,
  };
  validateReleaseState(state);
  return state;
}

async function lockedSnapshot(
  tx: Tx,
  tenantId: string,
  projectId: string,
  revision: number,
  currentRelease = false,
): Promise<ProjectSnapshot> {
  const rows = await tx
    .query(
      tx.raw
        .sql`SELECT snapshot::text AS snapshot_data, content_hash::text AS content_hash, created_at::text AS created_at
      FROM public.scada_project_versions WHERE tenant_id = ${tenantId} AND project_id = ${projectId}
      AND revision = ${BigInt(revision)} FOR SHARE`
        .returnsRow({
          snapshot_data: "pg/text@1",
          content_hash: "pg/text@1",
          created_at: "pg/text@1",
        })
        .build(),
    )
    .toArray();
  const row = rows[0];
  if (rows.length !== 1 || !row) throw new ProjectVersionAccessDeniedError();
  const data: unknown = JSON.parse(row.snapshot_data);
  try {
    return await validatePrisma8ProjectSnapshot(
      projectId,
      revision,
      row.content_hash,
      row.created_at,
      data,
    );
  } catch (error) {
    if (
      currentRelease &&
      error instanceof TypeError &&
      error.message === "数据库工程版本元数据与快照不一致"
    ) {
      throw new TypeError("数据库当前正式发布快照完整性校验失败");
    }
    throw error;
  }
}

const EVENT_COLUMNS = {
  event_id: "pg/text@1",
  generation: "pg/text@1",
  action: "pg/text@1",
  revision: "pg/text@1",
  hash: "pg/text@1",
  created_at: "pg/text@1",
  semantic_hash: "pg/text@1",
} as const;

type EventRow = { [Key in keyof typeof EVENT_COLUMNS]: string };

function eventResult(row: EventRow): ReleaseEventResultRow {
  return {
    eventId: row.event_id,
    generation: BigInt(row.generation),
    action: row.action,
    toRevision: BigInt(row.revision),
    toContentHash: row.hash,
    createdAt: new Date(row.created_at),
  };
}

async function readEvent(
  tx: Tx,
  tenantId: string,
  projectId: string,
  eventId: string,
): Promise<ReleaseEventResultRow> {
  const rows = await tx
    .query(
      tx.raw
        .sql`SELECT event_id::text AS event_id, generation::text AS generation, action::text AS action,
      to_revision::text AS revision, to_content_hash::text AS hash, created_at::text AS created_at,
      request_semantic_hash::text AS semantic_hash
      FROM public.scada_project_release_events
      WHERE tenant_id = ${tenantId} AND project_id = ${projectId} AND event_id = ${eventId}::uuid FOR SHARE`
        .returnsRow(EVENT_COLUMNS)
        .build(),
    )
    .toArray();
  if (rows.length !== 1 || !rows[0]) throw new TypeError("数据库当前正式发布事件记录缺失");
  return eventResult(rows[0]);
}

function verifyCurrentEvent(state: ReleaseState, event: ReleaseEventResultRow): void {
  if (
    event.eventId !== state.lastReleaseEventId ||
    event.generation !== state.releaseGeneration ||
    (event.action !== "PUBLISH" && event.action !== "ROLLBACK") ||
    event.toRevision !== state.releasedRevision ||
    event.toContentHash !== state.releasedContentHash ||
    !Number.isFinite(event.createdAt.getTime())
  ) {
    throw new TypeError("数据库当前正式发布事件与指针不一致");
  }
}

/** 默认门禁与正式仓储保持相同的安全评估和拒绝语义。 */
export async function denyPrisma8Release(
  _tx: Tx,
  snapshot: ProjectSnapshot,
  context: ProjectReleaseSafetyContext,
): Promise<never> {
  let blocks: readonly ProjectReleaseSafetyBlock[];
  try {
    blocks = assessProjectReleaseSafety(snapshot, context);
  } catch {
    blocks = [{ code: "SAFETY_ASSESSMENT_UNAVAILABLE", path: "assessment" }];
  }
  throw new ProjectReleaseGateUnavailableError(blocks);
}

type ReleaseGate = (
  tx: Tx,
  snapshot: ProjectSnapshot,
  context: ProjectReleaseSafetyContext,
) => Promise<void>;

/** 仅隔离库候选；门禁注入仅用于隔离测试事务，不注册正式模块。 */
export class Prisma8ProjectReleaseStore {
  constructor(
    private readonly client: PostgresClient<Contract>,
    private readonly gate: ReleaseGate = denyPrisma8Release,
  ) {}

  async readCurrent(
    principal: AuthenticatedProjectPrincipal | null,
    sessionId: string | null,
    projectId: string,
  ): Promise<ProjectCurrentReleaseResult> {
    const actor = bindActor(principal);
    requireProjectId(projectId);
    const { tenantId } = actor;
    return this.client.transaction(async (tx) => {
      await requireBoundary(tx);
      // 当前发布读取不查询编辑 head。
      const projects = await tx
        .query(
          tx.raw.sql`SELECT project_id::text AS project_id FROM public.scada_projects
          WHERE tenant_id = ${tenantId} AND project_id = ${projectId} FOR SHARE`
            .returnsRow({ project_id: "pg/text@1" })
            .build(),
        )
        .toArray();
      if (projects.length !== 1 || projects[0]?.project_id !== projectId)
        throw new ProjectVersionAccessDeniedError();
      await lockSessionAndPermission(tx, actor, projectId, sessionId, "release:read");
      const state = await lockState(tx, tenantId, projectId, false);
      if (state.releaseGeneration === 0n)
        return { status: "UNRELEASED", projectId, releaseGeneration: 0 };
      if (
        state.releasedRevision === null ||
        state.releasedContentHash === null ||
        state.lastReleaseEventId === null
      ) {
        throw new TypeError("数据库工程正式发布状态不符合生命周期约束");
      }
      const revision = Number(state.releasedRevision);
      const snapshot = await lockedSnapshot(tx, tenantId, projectId, revision, true);
      if (snapshot.contentHash !== state.releasedContentHash)
        throw new TypeError("数据库当前正式发布快照完整性校验失败");
      const event = await readEvent(tx, tenantId, projectId, state.lastReleaseEventId);
      verifyCurrentEvent(state, event);
      if (event.action !== "PUBLISH" && event.action !== "ROLLBACK")
        throw new TypeError("数据库当前正式发布事件与指针不一致");
      return {
        status: "RELEASED",
        projectId,
        releasedRevision: revision,
        releasedContentHash: state.releasedContentHash,
        releaseGeneration: Number(state.releaseGeneration),
        eventId: event.eventId,
        lastAction: event.action,
        releasedAt: event.createdAt.toISOString(),
        snapshot,
      };
    }, OPTIONS);
  }

  async publish(
    principal: AuthenticatedProjectPrincipal | null,
    sessionId: string | null,
    projectId: string,
    input: unknown,
    idempotencyKey: unknown,
  ): Promise<ProjectReleaseResult> {
    const actor = bindActor(principal);
    requireProjectId(projectId);
    const request = parsePrisma8PublishRequest(input, idempotencyKey);
    const semanticHash = createSemanticHash(projectId, request);
    const { tenantId, subjectId } = actor;
    return this.client.transaction(async (tx) => {
      await requireBoundary(tx);
      const projects = await tx
        .query(
          tx.raw.sql`SELECT head_revision::text AS head_revision FROM public.scada_projects
          WHERE tenant_id = ${tenantId} AND project_id = ${projectId} FOR UPDATE`
            .returnsRow({ head_revision: "pg/text@1" })
            .build(),
        )
        .toArray();
      if (projects.length !== 1 || !projects[0]) throw new ProjectVersionAccessDeniedError();
      const head = BigInt(projects[0].head_revision);
      if (head < 0n) throw new TypeError("数据库工程修订号异常");
      await lockSessionAndPermission(tx, actor, projectId, sessionId, "release:publish");
      const state = await lockState(tx, tenantId, projectId, true);
      const previous = await tx
        .query(
          tx.raw
            .sql`SELECT event_id::text AS event_id, generation::text AS generation, action::text AS action,
          to_revision::text AS revision, to_content_hash::text AS hash, created_at::text AS created_at,
          request_semantic_hash::text AS semantic_hash FROM public.scada_project_release_events
          WHERE tenant_id = ${tenantId} AND project_id = ${projectId} AND actor_id = ${subjectId}
            AND action = 'PUBLISH' AND idempotency_key = ${request.idempotencyKey} FOR SHARE`
            .returnsRow(EVENT_COLUMNS)
            .build(),
        )
        .toArray();
      if (previous.length > 1) throw new ProjectReleaseConflictError();
      if (previous[0]) {
        if (previous[0].semantic_hash !== semanticHash) throw new ProjectReleaseConflictError();
        return toReleaseResult(projectId, eventResult(previous[0]));
      }
      if (head !== BigInt(request.expectedHeadRevision)) throw new ProjectRevisionConflictError();
      if (
        state.releaseGeneration !== BigInt(request.expectedReleaseGeneration) ||
        state.releaseGeneration >= MAX_SAFE_BIGINT ||
        state.releasedRevision === BigInt(request.targetRevision)
      ) {
        throw new ProjectReleaseConflictError();
      }
      const snapshot = await lockedSnapshot(tx, tenantId, projectId, request.targetRevision);
      const report = validateProjectReleasePreflight(snapshot.document);
      if (!report.passed) throw new ProjectReleasePreflightRejectedError(report.issues);
      await this.gate(tx, snapshot, { tenantId, projectId, actorId: subjectId });
      const generation = state.releaseGeneration + 1n;
      const eventId = randomUUID();
      const fromRevision = state.releasedRevision?.toString() ?? "";
      const fromHash = state.releasedContentHash ?? "";
      const fromEvent = state.lastReleaseEventId ?? "";
      const inserted = await tx.execute(
        tx.raw.sql`INSERT INTO public.scada_project_release_events
          (event_id, tenant_id, project_id, generation, action, from_revision, from_content_hash,
           to_revision, to_content_hash, actor_id, idempotency_key, request_semantic_hash)
          VALUES (${eventId}::uuid, ${tenantId}, ${projectId}, ${generation}, 'PUBLISH',
            NULLIF(${fromRevision}::text, '')::bigint, NULLIF(${fromHash}::text, ''), ${BigInt(request.targetRevision)},
            ${snapshot.contentHash}, ${subjectId}, ${request.idempotencyKey}, ${semanticHash})
          ON CONFLICT DO NOTHING`
          .affectedCount()
          .build(),
      );
      if (inserted.affectedRows !== 1) throw new ProjectReleaseConflictError();
      const event = await readEvent(tx, tenantId, projectId, eventId);
      const updated = await tx.execute(
        tx.raw
          .sql`UPDATE public.scada_project_release_state SET released_revision = ${BigInt(request.targetRevision)},
          released_content_hash = ${snapshot.contentHash}, release_generation = ${generation},
          last_release_event_id = ${eventId}::uuid,
          updated_at = (SELECT created_at FROM public.scada_project_release_events WHERE event_id = ${eventId}::uuid)
          WHERE tenant_id = ${tenantId} AND project_id = ${projectId} AND release_generation = ${state.releaseGeneration}
            AND released_revision IS NOT DISTINCT FROM NULLIF(${fromRevision}::text, '')::bigint
            AND released_content_hash IS NOT DISTINCT FROM NULLIF(${fromHash}::text, '')
            AND last_release_event_id IS NOT DISTINCT FROM NULLIF(${fromEvent}::text, '')::uuid`
          .affectedCount()
          .build(),
      );
      if (updated.affectedRows !== 1) throw new ProjectReleaseConflictError();
      const restored = await lockState(tx, tenantId, projectId, true);
      verifyCurrentEvent(restored, event);
      if (
        restored.releaseGeneration !== generation ||
        restored.releasedRevision !== BigInt(request.targetRevision) ||
        restored.releasedContentHash !== snapshot.contentHash ||
        restored.lastReleaseEventId !== eventId
      ) {
        throw new ProjectReleaseConflictError();
      }
      return toReleaseResult(projectId, event);
    }, OPTIONS);
  }
}
