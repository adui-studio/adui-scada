import { createHash, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { ProjectReleasePreflightIssue, ProjectSnapshot } from "@adui/scada-core";
import { readProjectSnapshot, validateProjectReleasePreflight } from "@adui/scada-core";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { hasProjectPermission } from "./project-access-policy.js";
import type {
  AuthenticatedProjectPrincipal,
  ProjectAccessAction,
} from "./project-access-policy.js";
import {
  lockProject,
  ProjectRequestValidationError,
  ProjectRevisionConflictError,
  ProjectVersionAccessDeniedError,
  requirePrincipal,
  requireProjectId,
} from "./prisma-project-version-store.js";
import { ProjectReleaseSafetyGate } from "./project-release-safety-gate.js";

const TRANSACTION_OPTIONS = { maxWait: 2000, timeout: 10000 };
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

/** 成功发布的最小回执，不包含工程快照或安全门禁内部信息。 */
export interface ProjectReleaseResult {
  readonly projectId: string;
  readonly action: "PUBLISH";
  /** 发布事件提交时的工程 head 水位；幂等重放返回原始值。 */
  readonly headRevision: number;
  readonly releasedRevision: number;
  readonly releasedContentHash: string;
  readonly releaseGeneration: number;
  readonly eventId: string;
  readonly createdAt: string;
}

/** 当前发布指针读取结果；不包含编辑 head 或本地草稿信息。 */
export type ProjectCurrentReleaseResult =
  | {
      readonly status: "UNRELEASED";
      readonly projectId: string;
      readonly releaseGeneration: 0;
    }
  | {
      readonly status: "RELEASED";
      readonly projectId: string;
      readonly releasedRevision: number;
      readonly releasedContentHash: string;
      readonly releaseGeneration: number;
      readonly eventId: string;
      readonly lastAction: "PUBLISH" | "ROLLBACK";
      readonly releasedAt: string;
      readonly snapshot: ProjectSnapshot;
    };

/** 事务锁内发现会话已撤销、过期或主体已停用。 */
export class ProjectReleaseSessionInvalidError extends Error {
  constructor() {
    super("身份会话无效或已经失效");
    this.name = "ProjectReleaseSessionInvalidError";
  }
}

/** 同一幂等键被用于不同语义时返回冲突。 */
export class ProjectReleaseConflictError extends Error {
  constructor() {
    super("工程发布状态或幂等请求已变化，请重新读取发布状态");
    this.name = "ProjectReleaseConflictError";
  }
}

/** 当前已保存快照未通过共享 Core 静态发布预检。 */
export class ProjectReleasePreflightRejectedError extends Error {
  readonly issues: readonly ProjectReleasePreflightIssue[];

  constructor(issues: readonly ProjectReleasePreflightIssue[]) {
    super("当前已保存工程版本未通过静态发布兼容性检查");
    this.name = "ProjectReleasePreflightRejectedError";
    this.issues = issues;
  }
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

function isUniqueConstraintError(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "P2002";
}

/** 锁定当前有效会话与主体行，避免会话撤销或主体停用与发布提交交错。 */
async function lockActiveSession(
  tx: Prisma.TransactionClient,
  principal: AuthenticatedProjectPrincipal,
  sessionId: string | null,
): Promise<void> {
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new ProjectReleaseSessionInvalidError();
  }

  const sessions = await tx.$queryRaw<Array<{ session_id: string }>>`
    SELECT auth_session.session_id
    FROM scada_auth_sessions AS auth_session
    JOIN scada_identities AS identity_row
      ON identity_row.tenant_id = auth_session.tenant_id
      AND identity_row.subject_id = auth_session.subject_id
    WHERE auth_session.session_id = ${sessionId}::uuid
      AND auth_session.tenant_id = ${principal.tenantId}
      AND auth_session.subject_id = ${principal.subjectId}
      AND auth_session.revoked_at IS NULL
      AND auth_session.issued_at <= CURRENT_TIMESTAMP
      AND auth_session.expires_at > CURRENT_TIMESTAMP
      AND identity_row.status = 'active'
    FOR SHARE OF auth_session, identity_row
  `;
  if (sessions.length !== 1) throw new ProjectReleaseSessionInvalidError();
}

/** 在事务内锁定授权行；撤权事务必须等待本次发布结束，反之则发布看见撤权结果。 */
async function requireLockedProjectPermission(
  tx: Prisma.TransactionClient,
  principal: AuthenticatedProjectPrincipal,
  projectId: string,
  action: ProjectAccessAction,
): Promise<void> {
  const grants = await tx.$queryRaw<Array<{ permission: string }>>`
    SELECT permission
    FROM scada_project_grants
    WHERE tenant_id = ${principal.tenantId}
      AND project_id = ${projectId}
      AND subject_id = ${principal.subjectId}
    FOR SHARE
  `;
  const allowed = hasProjectPermission(
    principal,
    { tenantId: principal.tenantId, projectId },
    {
      tenantId: principal.tenantId,
      projectId,
      subjectId: principal.subjectId,
      permissions: grants.map((grant) => grant.permission as ProjectAccessAction),
    },
    action,
  );
  if (!allowed) throw new ProjectVersionAccessDeniedError();
}

/** 不可变快照在读取和指针提交期间持有共享锁，避免并发数据库修改。 */
async function lockProjectVersion(
  tx: Prisma.TransactionClient,
  principal: AuthenticatedProjectPrincipal,
  projectId: string,
  revision: number,
): Promise<void> {
  const versions = await tx.$queryRaw<Array<{ revision: bigint }>>`
    SELECT revision
    FROM scada_project_versions
    WHERE tenant_id = ${principal.tenantId}
      AND project_id = ${projectId}
      AND revision = ${BigInt(revision)}
    FOR SHARE
  `;
  if (versions.length !== 1) throw new ProjectVersionAccessDeniedError();
}

/** 只锁定工程身份行，不读取 head_revision，Runtime 不得依赖编辑 head。 */
async function lockProjectForReleaseRead(
  tx: Prisma.TransactionClient,
  principal: AuthenticatedProjectPrincipal,
  projectId: string,
): Promise<void> {
  const projects = await tx.$queryRaw<Array<{ project_id: string }>>`
    SELECT project_id
    FROM scada_projects
    WHERE tenant_id = ${principal.tenantId}
      AND project_id = ${projectId}
    FOR SHARE
  `;
  if (projects.length !== 1 || projects[0]?.project_id !== projectId) {
    throw new ProjectVersionAccessDeniedError();
  }
}

/** 读取发布状态使用共享锁；读取事务按工程 → 会话 → ACL → 状态 → 版本 → 事件锁定。 */
async function lockReleaseStateForRead(
  tx: Prisma.TransactionClient,
  principal: AuthenticatedProjectPrincipal,
  projectId: string,
): Promise<bigint> {
  const states = await tx.$queryRaw<Array<{ release_generation: bigint }>>`
    SELECT release_generation
    FROM scada_project_release_state
    WHERE tenant_id = ${principal.tenantId}
      AND project_id = ${projectId}
    FOR SHARE
  `;
  const lockedState = states[0];
  if (states.length !== 1 || !lockedState) {
    throw new TypeError("数据库工程正式发布状态记录缺失");
  }
  return lockedState.release_generation;
}

/** 读取最后发布事件时持有共享锁，避免读取期间事件行被并发改写。 */
async function lockCurrentReleaseEvent(
  tx: Prisma.TransactionClient,
  principal: AuthenticatedProjectPrincipal,
  projectId: string,
  eventId: string,
): Promise<void> {
  const events = await tx.$queryRaw<Array<{ event_id: string }>>`
    SELECT event_id
    FROM scada_project_release_events
    WHERE tenant_id = ${principal.tenantId}
      AND project_id = ${projectId}
      AND event_id = ${eventId}
    FOR SHARE
  `;
  if (events.length !== 1 || events[0]?.event_id !== eventId) {
    throw new TypeError("数据库当前正式发布事件记录缺失");
  }
}

/** 发布状态行使用独立锁；工程行始终先锁定，保持与版本追加一致的锁顺序。 */
async function lockReleaseState(
  tx: Prisma.TransactionClient,
  principal: AuthenticatedProjectPrincipal,
  projectId: string,
): Promise<void> {
  const states = await tx.$queryRaw<Array<{ release_generation: bigint }>>`
    SELECT release_generation
    FROM scada_project_release_state
    WHERE tenant_id = ${principal.tenantId}
      AND project_id = ${projectId}
    FOR UPDATE
  `;
  if (states.length !== 1) {
    throw new TypeError("数据库工程正式发布状态记录缺失");
  }
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

/**
 * 正式发布事务仓储。
 * 发布锁顺序固定为工程 → 会话/主体 → ACL → 发布状态 → 不可变版本；读取还会共享锁定最后发布事件。
 */
@Injectable()
export class PrismaProjectReleaseStore {
  constructor(
    private readonly database: PrismaService,
    private readonly safetyGate: ProjectReleaseSafetyGate,
  ) {}

  /**
   * 只读读取当前发布指针与其不可变快照。
   * 工程行只取 project_id 并持有共享锁，不查询 head_revision；权限、状态、事件和快照均在同一事务内复核。
   */
  async readCurrent(
    principal: AuthenticatedProjectPrincipal | null,
    sessionId: string | null,
    projectId: string,
  ): Promise<ProjectCurrentReleaseResult> {
    requirePrincipal(principal);
    requireProjectId(projectId);

    return this.database.client.$transaction(async (tx) => {
      await lockProjectForReleaseRead(tx, principal, projectId);
      await lockActiveSession(tx, principal, sessionId);
      await requireLockedProjectPermission(tx, principal, projectId, "release:read");
      const lockedReleaseGeneration = await lockReleaseStateForRead(tx, principal, projectId);

      const state = await tx.scadaProjectReleaseState.findUnique({
        where: {
          tenantId_projectId: {
            tenantId: principal.tenantId,
            projectId,
          },
        },
        select: {
          releaseGeneration: true,
          releasedRevision: true,
          releasedContentHash: true,
          lastReleaseEventId: true,
        },
      });
      if (!state) throw new TypeError("数据库工程正式发布状态记录缺失");
      validateReleaseState(state);
      if (state.releaseGeneration !== lockedReleaseGeneration) {
        throw new TypeError("数据库工程正式发布状态锁定水位不一致");
      }

      if (state.releaseGeneration === 0n) {
        return {
          status: "UNRELEASED",
          projectId,
          releaseGeneration: 0,
        };
      }

      if (
        state.releasedRevision === null ||
        state.releasedContentHash === null ||
        state.lastReleaseEventId === null
      ) {
        throw new TypeError("数据库工程正式发布状态不符合生命周期约束");
      }

      const releasedRevision = Number(state.releasedRevision);
      await lockProjectVersion(tx, principal, projectId, releasedRevision);
      await lockCurrentReleaseEvent(
        tx,
        principal,
        projectId,
        state.lastReleaseEventId,
      );

      const version = await tx.scadaProjectVersion.findUnique({
        where: {
          tenantId_projectId_revision: {
            tenantId: principal.tenantId,
            projectId,
            revision: state.releasedRevision,
          },
        },
        select: {
          snapshot: true,
          contentHash: true,
          createdAt: true,
        },
      });
      if (!version) {
        throw new TypeError("数据库当前正式发布快照记录缺失");
      }

      const snapshot = await readProjectSnapshot(version.snapshot);
      if (
        snapshot.projectId !== projectId ||
        snapshot.revision !== releasedRevision ||
        snapshot.contentHash !== version.contentHash ||
        snapshot.contentHash !== state.releasedContentHash ||
        snapshot.createdAt !== version.createdAt.toISOString()
      ) {
        throw new TypeError("数据库当前正式发布快照完整性校验失败");
      }

      const event = await tx.scadaProjectReleaseEvent.findUnique({
        where: { eventId: state.lastReleaseEventId },
        select: {
          eventId: true,
          tenantId: true,
          projectId: true,
          generation: true,
          action: true,
          toRevision: true,
          toContentHash: true,
          createdAt: true,
        },
      });
      if (
        !event ||
        event.eventId !== state.lastReleaseEventId ||
        event.tenantId !== principal.tenantId ||
        event.projectId !== projectId ||
        event.generation !== state.releaseGeneration ||
        (event.action !== "PUBLISH" && event.action !== "ROLLBACK") ||
        event.toRevision !== state.releasedRevision ||
        event.toContentHash !== state.releasedContentHash ||
        !(event.createdAt instanceof Date) ||
        !Number.isFinite(event.createdAt.getTime())
      ) {
        throw new TypeError("数据库当前正式发布事件与指针不一致");
      }

      return {
        status: "RELEASED",
        projectId,
        releasedRevision,
        releasedContentHash: state.releasedContentHash,
        releaseGeneration: Number(state.releaseGeneration),
        eventId: event.eventId,
        lastAction: event.action,
        releasedAt: event.createdAt.toISOString(),
        snapshot,
      };
    }, TRANSACTION_OPTIONS);
  }

  async publish(
    principal: AuthenticatedProjectPrincipal | null,
    sessionId: string | null,
    projectId: string,
    input: unknown,
    idempotencyKey: unknown,
  ): Promise<ProjectReleaseResult> {
    requirePrincipal(principal);
    requireProjectId(projectId);
    const request = parsePublishRequest(input, idempotencyKey);
    const semanticHash = createSemanticHash(projectId, request);

    try {
      return await this.database.client.$transaction(async (tx) => {
        const head = await lockProject(tx, principal, projectId, "UPDATE");
        await lockActiveSession(tx, principal, sessionId);
        await requireLockedProjectPermission(tx, principal, projectId, "release:publish");
        await lockReleaseState(tx, principal, projectId);

        const state = await tx.scadaProjectReleaseState.findUnique({
          where: {
            tenantId_projectId: {
              tenantId: principal.tenantId,
              projectId,
            },
          },
          select: {
            releaseGeneration: true,
            releasedRevision: true,
            releasedContentHash: true,
            lastReleaseEventId: true,
          },
        });
        if (!state) throw new TypeError("数据库工程正式发布状态记录缺失");
        validateReleaseState(state);

        // 幂等重试先于 CAS 检查；已提交的同语义请求必须返回原始成功事件。
        const previousEvent = await tx.scadaProjectReleaseEvent.findFirst({
          where: {
            tenantId: principal.tenantId,
            projectId,
            actorId: principal.subjectId,
            action: "PUBLISH",
            idempotencyKey: request.idempotencyKey,
          },
          select: {
            eventId: true,
            generation: true,
            action: true,
            toRevision: true,
            toContentHash: true,
            createdAt: true,
            requestSemanticHash: true,
          },
        });
        if (previousEvent) {
          if (previousEvent.requestSemanticHash !== semanticHash) {
            throw new ProjectReleaseConflictError();
          }
          return toReleaseResult(projectId, previousEvent);
        }

        if (head !== BigInt(request.expectedHeadRevision)) {
          throw new ProjectRevisionConflictError();
        }
        if (state.releaseGeneration !== BigInt(request.expectedReleaseGeneration)) {
          throw new ProjectReleaseConflictError();
        }
        if (state.releaseGeneration >= MAX_SAFE_BIGINT) {
          throw new ProjectReleaseConflictError();
        }
        // ADR-0069 尚未批准“不同幂等键重复发布同一修订”的语义，当前保守拒绝。
        if (state.releasedRevision === BigInt(request.targetRevision)) {
          throw new ProjectReleaseConflictError();
        }

        await lockProjectVersion(tx, principal, projectId, request.targetRevision);
        const version = await tx.scadaProjectVersion.findUnique({
          where: {
            tenantId_projectId_revision: {
              tenantId: principal.tenantId,
              projectId,
              revision: BigInt(request.targetRevision),
            },
          },
        });
        if (!version) throw new ProjectVersionAccessDeniedError();

        const snapshot = await readProjectSnapshot(version.snapshot);
        if (
          snapshot.projectId !== projectId ||
          snapshot.revision !== request.targetRevision ||
          snapshot.contentHash !== version.contentHash ||
          snapshot.createdAt !== version.createdAt.toISOString()
        ) {
          throw new TypeError("数据库工程版本元数据与快照不一致");
        }

        const preflight = validateProjectReleasePreflight(snapshot.document);
        if (!preflight.passed) {
          throw new ProjectReleasePreflightRejectedError(preflight.issues);
        }

        // 当前正式门禁默认拒绝；只有后续完成 Runtime/Tag/数据源/工业安全评审的实现才能放行。
        await this.safetyGate.assertReady(tx, snapshot, {
          tenantId: principal.tenantId,
          projectId,
          actorId: principal.subjectId,
        });

        const generation = state.releaseGeneration + 1n;
        const eventId = randomUUID();
        const event = await tx.scadaProjectReleaseEvent.create({
          data: {
            eventId,
            tenantId: principal.tenantId,
            projectId,
            generation,
            action: "PUBLISH",
            fromRevision: state.releasedRevision,
            fromContentHash: state.releasedContentHash,
            toRevision: BigInt(request.targetRevision),
            toContentHash: snapshot.contentHash,
            actorId: principal.subjectId,
            idempotencyKey: request.idempotencyKey,
            requestSemanticHash: semanticHash,
          },
          select: {
            eventId: true,
            generation: true,
            action: true,
            toRevision: true,
            toContentHash: true,
            createdAt: true,
          },
        });

        const updated = await tx.scadaProjectReleaseState.updateMany({
          where: {
            tenantId: principal.tenantId,
            projectId,
            releaseGeneration: state.releaseGeneration,
            releasedRevision: state.releasedRevision,
            releasedContentHash: state.releasedContentHash,
            lastReleaseEventId: state.lastReleaseEventId,
          },
          data: {
            releasedRevision: BigInt(request.targetRevision),
            releasedContentHash: snapshot.contentHash,
            releaseGeneration: generation,
            lastReleaseEventId: eventId,
            updatedAt: event.createdAt,
          },
        });
        if (updated.count !== 1) throw new ProjectReleaseConflictError();

        return toReleaseResult(projectId, event);
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ProjectReleaseConflictError();
      throw error;
    }
  }
}
