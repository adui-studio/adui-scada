import { createHash, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { validateProjectReleasePreflight, type ProjectSnapshot } from "@adui/scada-core";
import type { Prisma8Transaction } from "../database/prisma8-read-transaction.js";
import { Prisma8Service } from "../database/prisma8.service.js";
import { nativeTextTransaction } from "../database/prisma8-text-transaction.js";
import {
  lockB4SessionIdentity,
  lockB4ProjectGrants,
  lockB4ReleaseState,
  lockB4ProjectVersion,
  lockB4ReleaseEvent,
  lockB4ReleaseRequest,
  lockB4PriorPublish,
  type B4ReleaseEventRow,
} from "../database/prisma8-b4-routines.js";
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
} from "./project-version-store.js";
import {
  type ProjectReleaseStore,
  ProjectReleaseSessionInvalidError,
  ProjectReleaseConflictError,
  ProjectReleasePreflightRejectedError,
  type ProjectReleaseResult,
  type ProjectCurrentReleaseResult,
} from "./project-release-store.js";
import { requireProjectReleaseSafety } from "./project-release-safety-gate.js";
import { validatePrisma8ProjectSnapshot } from "./prisma8-project-query-store.js";

type Tx = Prisma8Transaction;

function routineTransaction(tx: Tx) {
  return nativeTextTransaction(tx, "工程发布事务查询结果缺少有效文本列");
}

type ReleaseAction = "PUBLISH" | "ROLLBACK";
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

interface ProjectRollbackRequest {
  readonly targetRevision: number;
  readonly expectedReleaseGeneration: number;
  readonly idempotencyKey: string;
}

/** 内部回滚回执不虚构事件发生时未持久化的编辑 head；尚未暴露 HTTP 契约。 */
export type ProjectRollbackResult = Omit<ProjectReleaseResult, "action" | "headRevision"> & {
  readonly action: "ROLLBACK";
};

interface ReleaseEventResultRow {
  readonly eventId: string;
  readonly generation: bigint;
  readonly action: string;
  readonly toRevision: bigint;
  readonly toContentHash: string;
  readonly createdAt: Date;
  readonly semanticHash: string;
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
function parsePublishRequest(input: unknown, idempotencyKey: unknown): ProjectPublishRequest {
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

/** 回滚不接受编辑 head、正文或客户端权威摘要。 */
function parseRollbackRequest(input: unknown, idempotencyKey: unknown): ProjectRollbackRequest {
  if (!isPlainRecord(input)) {
    throw new ProjectRequestValidationError("正式回滚请求必须为普通对象");
  }
  if (
    Object.keys(input).length !== 2 ||
    !Object.hasOwn(input, "targetRevision") ||
    !Object.hasOwn(input, "expectedReleaseGeneration")
  ) {
    throw new ProjectRequestValidationError(
      "正式回滚请求只允许 targetRevision 和 expectedReleaseGeneration",
    );
  }
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new ProjectRequestValidationError("Idempotency-Key 必须为服务端生成的 UUID v4");
  }
  return {
    targetRevision: parseSafePositiveInteger(input.targetRevision, "目标回滚修订号"),
    expectedReleaseGeneration: parseSafePositiveInteger(
      input.expectedReleaseGeneration,
      "预期发布代次",
    ),
    idempotencyKey,
  };
}

function createRollbackSemanticHash(projectId: string, request: ProjectRollbackRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        action: "ROLLBACK",
        projectId,
        targetRevision: request.targetRevision,
        expectedReleaseGeneration: request.expectedReleaseGeneration,
      }),
      "utf8",
    )
    .digest("hex");
}

function databaseInteger(value: string, message: string): bigint {
  if (!/^(0|[1-9][0-9]{0,15})$/.test(value)) throw new TypeError(message);
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_BIGINT || parsed.toString() !== value) throw new TypeError(message);
  return parsed;
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
    (state.lastReleaseEventId !== null && !SESSION_ID_PATTERN.test(state.lastReleaseEventId)) ||
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

function releaseReceipt(projectId: string, event: ReleaseEventResultRow, action: ReleaseAction) {
  if (
    event.action !== action ||
    event.generation <= 0n ||
    event.generation > MAX_SAFE_BIGINT ||
    event.toRevision <= 0n ||
    event.toRevision > MAX_SAFE_BIGINT ||
    !SHA256_PATTERN.test(event.toContentHash) ||
    !SHA256_PATTERN.test(event.semanticHash) ||
    !SESSION_ID_PATTERN.test(event.eventId) ||
    !Number.isFinite(event.createdAt.getTime())
  ) {
    throw new TypeError("数据库正式发布事件记录无效");
  }
  return {
    projectId,
    releasedRevision: Number(event.toRevision),
    releasedContentHash: event.toContentHash,
    releaseGeneration: Number(event.generation),
    eventId: event.eventId,
    createdAt: event.createdAt.toISOString(),
  };
}

function toReleaseResult(projectId: string, event: ReleaseEventResultRow): ProjectReleaseResult {
  const receipt = releaseReceipt(projectId, event, "PUBLISH");
  return { ...receipt, action: "PUBLISH", headRevision: receipt.releasedRevision };
}

function toRollbackResult(projectId: string, event: ReleaseEventResultRow): ProjectRollbackResult {
  return { ...releaseReceipt(projectId, event, "ROLLBACK"), action: "ROLLBACK" };
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
  action: "release:read" | "release:publish" | "release:rollback",
): Promise<void> {
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new ProjectReleaseSessionInvalidError();
  }
  const { tenantId, subjectId } = actor;
  const routineTx = routineTransaction(tx);
  const sessions = await lockB4SessionIdentity(routineTx, tenantId, subjectId, sessionId);
  if (sessions.length !== 1 || sessions[0]?.session_id !== sessionId.toLowerCase()) {
    throw new ProjectReleaseSessionInvalidError();
  }
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
      action,
    )
  )
    throw new ProjectVersionAccessDeniedError();
}

async function lockState(
  tx: Tx,
  tenantId: string,
  projectId: string,
  write: boolean,
): Promise<ReleaseState> {
  const rows = await lockB4ReleaseState(routineTransaction(tx), tenantId, projectId, write);
  const row = rows[0];
  if (rows.length !== 1 || !row) throw new TypeError("数据库工程正式发布状态记录缺失");
  const message = "数据库工程正式发布状态不符合生命周期约束";
  if (
    (row.hash_is_null !== "true" && row.hash_is_null !== "false") ||
    (row.hash_is_null === "true" && row.hash !== "")
  ) {
    throw new TypeError(message);
  }
  const state = {
    releaseGeneration: databaseInteger(row.generation, message),
    releasedRevision: row.revision === "" ? null : databaseInteger(row.revision, message),
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
  const rows = await lockB4ProjectVersion(
    routineTransaction(tx),
    tenantId,
    projectId,
    BigInt(revision),
  );
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

function eventResult(row: B4ReleaseEventRow): ReleaseEventResultRow {
  return {
    eventId: row.event_id,
    generation: databaseInteger(row.generation, "数据库正式发布事件记录无效"),
    action: row.action,
    toRevision: databaseInteger(row.revision, "数据库正式发布事件记录无效"),
    toContentHash: row.hash,
    createdAt: new Date(row.created_at),
    semanticHash: row.semantic_hash,
  };
}

async function readEvent(
  tx: Tx,
  tenantId: string,
  projectId: string,
  eventId: string,
): Promise<ReleaseEventResultRow> {
  const rows = await lockB4ReleaseEvent(routineTransaction(tx), tenantId, projectId, eventId);
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
    !SHA256_PATTERN.test(event.semanticHash) ||
    !Number.isFinite(event.createdAt.getTime())
  ) {
    throw new TypeError("数据库当前正式发布事件与指针不一致");
  }
}

async function findReplay(
  tx: Tx,
  actor: AuthenticatedProjectPrincipal,
  projectId: string,
  action: ReleaseAction,
  request: ProjectRollbackRequest,
  semanticHash: string,
  state: ReleaseState,
): Promise<ReleaseEventResultRow | null> {
  const { tenantId, subjectId } = actor;
  const rows = await lockB4ReleaseRequest(
    routineTransaction(tx),
    tenantId,
    projectId,
    subjectId,
    action,
    request.idempotencyKey,
  );
  if (rows.length > 1) throw new ProjectReleaseConflictError();
  const row = rows[0];
  if (!row) return null;
  const event = eventResult(row);
  if (
    event.semanticHash !== semanticHash ||
    event.action !== action ||
    event.toRevision !== BigInt(request.targetRevision) ||
    event.generation !== BigInt(request.expectedReleaseGeneration) + 1n ||
    event.generation > state.releaseGeneration
  ) {
    throw new ProjectReleaseConflictError();
  }
  return event;
}

function requireGeneration(state: ReleaseState, request: ProjectRollbackRequest): void {
  if (
    state.releaseGeneration !== BigInt(request.expectedReleaseGeneration) ||
    state.releaseGeneration >= MAX_SAFE_BIGINT ||
    state.releasedRevision === BigInt(request.targetRevision)
  ) {
    throw new ProjectReleaseConflictError();
  }
}

/** 只承认同一租户工程内较早的真实 PUBLISH 事件，不以保存记录或回滚事件作为首发证明。 */
async function findRollbackTarget(
  tx: Tx,
  tenantId: string,
  projectId: string,
  request: ProjectRollbackRequest,
  state: ReleaseState,
): Promise<ProjectSnapshot> {
  const rows = await lockB4PriorPublish(
    routineTransaction(tx),
    tenantId,
    projectId,
    BigInt(request.targetRevision),
    state.releaseGeneration,
  );
  if (rows.length !== 1 || !rows[0]) throw new ProjectReleaseConflictError();
  const event = eventResult(rows[0]);
  releaseReceipt(projectId, event, "PUBLISH");
  if (
    event.toRevision !== BigInt(request.targetRevision) ||
    event.generation >= state.releaseGeneration
  ) {
    throw new ProjectReleaseConflictError();
  }
  const snapshot = await lockedSnapshot(tx, tenantId, projectId, request.targetRevision);
  if (snapshot.contentHash !== event.toContentHash) {
    throw new TypeError("数据库回滚目标快照与发布事件不一致");
  }
  return snapshot;
}

/** 事件、指针 CAS 与回读在同一原生事务中；安全门禁未交付前不会执行 DML。 */
async function switchRelease(
  tx: Tx,
  actor: AuthenticatedProjectPrincipal,
  projectId: string,
  action: ReleaseAction,
  request: ProjectRollbackRequest,
  semanticHash: string,
  state: ReleaseState,
  snapshot: ProjectSnapshot,
): Promise<ReleaseEventResultRow> {
  const { tenantId, subjectId } = actor;
  const report = validateProjectReleasePreflight(snapshot.document);
  if (!report.passed) throw new ProjectReleasePreflightRejectedError(report.issues);
  requireProjectReleaseSafety(snapshot, { tenantId, projectId, actorId: subjectId });
  const generation = state.releaseGeneration + 1n;
  const eventId = randomUUID();
  const fromRevision = state.releasedRevision?.toString() ?? "";
  const fromHash = state.releasedContentHash ?? "";
  const fromEvent = state.lastReleaseEventId ?? "";
  const inserted = await tx.execute(
    tx.raw.sql`INSERT INTO public.scada_project_release_events
      (event_id, tenant_id, project_id, generation, action, from_revision, from_content_hash,
       to_revision, to_content_hash, actor_id, idempotency_key, request_semantic_hash)
      VALUES (${eventId}::uuid, ${tenantId}, ${projectId}, ${generation}, ${action},
        NULLIF(${fromRevision}::text, '')::bigint, NULLIF(${fromHash}::text, ''), ${BigInt(request.targetRevision)},
        ${snapshot.contentHash}, ${subjectId}, ${request.idempotencyKey}, ${semanticHash})
      ON CONFLICT DO NOTHING`
      .affectedCount()
      .build(),
  );
  if (inserted.affectedRows !== 1) throw new ProjectReleaseConflictError();
  const event = await readEvent(tx, tenantId, projectId, eventId);
  if (
    event.eventId !== eventId ||
    event.action !== action ||
    event.generation !== generation ||
    event.toRevision !== BigInt(request.targetRevision) ||
    event.toContentHash !== snapshot.contentHash ||
    event.semanticHash !== semanticHash
  ) {
    throw new ProjectReleaseConflictError();
  }
  const updated = await tx.execute(
    tx.raw
      .sql`UPDATE public.scada_project_release_state SET released_revision = ${BigInt(request.targetRevision)},
      released_content_hash = ${snapshot.contentHash}, release_generation = ${generation},
      last_release_event_id = ${eventId}::uuid,
      updated_at = (SELECT created_at FROM public.scada_project_release_events
        WHERE tenant_id = ${tenantId} AND project_id = ${projectId} AND event_id = ${eventId}::uuid)
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
  return event;
}

/** 仅使用当前原生业务数据库事务，暂不挂载正式 HTTP 控制器。 */
@Injectable()
export class Prisma8RuntimeProjectReleaseStore implements ProjectReleaseStore {
  constructor(private readonly database: Prisma8Service) {}

  async readCurrent(
    principal: AuthenticatedProjectPrincipal | null,
    sessionId: string | null,
    projectId: string,
  ): Promise<ProjectCurrentReleaseResult> {
    const actor = bindActor(principal);
    requireProjectId(projectId);
    const { tenantId } = actor;
    // PostgreSQL 严格只读事务不允许持有共享行锁。
    this.database.assertWritable();
    return this.database.readTransaction(async (tx) => {
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
    });
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
    const request = parsePublishRequest(input, idempotencyKey);
    const semanticHash = createSemanticHash(projectId, request);
    const { tenantId } = actor;
    return this.database.writeTransaction(async (tx) => {
      const projects = await tx
        .query(
          tx.raw.sql`SELECT head_revision::text AS head_revision FROM public.scada_projects
          WHERE tenant_id = ${tenantId} AND project_id = ${projectId} FOR UPDATE`
            .returnsRow({ head_revision: "pg/text@1" })
            .build(),
        )
        .toArray();
      if (projects.length !== 1 || !projects[0]) throw new ProjectVersionAccessDeniedError();
      await lockSessionAndPermission(tx, actor, projectId, sessionId, "release:publish");
      const head = databaseInteger(projects[0].head_revision, "数据库工程修订号异常");
      const state = await lockState(tx, tenantId, projectId, true);
      const replay = await findReplay(
        tx,
        actor,
        projectId,
        "PUBLISH",
        request,
        semanticHash,
        state,
      );
      if (replay) return toReleaseResult(projectId, replay);
      if (head !== BigInt(request.expectedHeadRevision)) throw new ProjectRevisionConflictError();
      requireGeneration(state, request);
      const snapshot = await lockedSnapshot(tx, tenantId, projectId, request.targetRevision);
      const event = await switchRelease(
        tx,
        actor,
        projectId,
        "PUBLISH",
        request,
        semanticHash,
        state,
        snapshot,
      );
      return toReleaseResult(projectId, event);
    });
  }

  /** 回滚不读取或修改编辑 head；当前发布代次和曾发布目标独立复核。 */
  async rollback(
    principal: AuthenticatedProjectPrincipal | null,
    sessionId: string | null,
    projectId: string,
    input: unknown,
    idempotencyKey: unknown,
  ): Promise<ProjectRollbackResult> {
    const actor = bindActor(principal);
    requireProjectId(projectId);
    const request = parseRollbackRequest(input, idempotencyKey);
    const semanticHash = createRollbackSemanticHash(projectId, request);
    const { tenantId } = actor;
    return this.database.writeTransaction(async (tx) => {
      const projects = await tx
        .query(
          tx.raw.sql`SELECT project_id::text AS project_id FROM public.scada_projects
          WHERE tenant_id = ${tenantId} AND project_id = ${projectId} FOR UPDATE`
            .returnsRow({ project_id: "pg/text@1" })
            .build(),
        )
        .toArray();
      if (projects.length !== 1 || projects[0]?.project_id !== projectId)
        throw new ProjectVersionAccessDeniedError();
      await lockSessionAndPermission(tx, actor, projectId, sessionId, "release:rollback");
      const state = await lockState(tx, tenantId, projectId, true);
      const replay = await findReplay(
        tx,
        actor,
        projectId,
        "ROLLBACK",
        request,
        semanticHash,
        state,
      );
      if (replay) return toRollbackResult(projectId, replay);
      requireGeneration(state, request);
      if (state.lastReleaseEventId === null) throw new ProjectReleaseConflictError();
      const current = await readEvent(tx, tenantId, projectId, state.lastReleaseEventId);
      verifyCurrentEvent(state, current);
      const snapshot = await findRollbackTarget(tx, tenantId, projectId, request, state);
      const event = await switchRelease(
        tx,
        actor,
        projectId,
        "ROLLBACK",
        request,
        semanticHash,
        state,
        snapshot,
      );
      return toRollbackResult(projectId, event);
    });
  }
}
