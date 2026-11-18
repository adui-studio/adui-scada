import { Injectable } from "@nestjs/common";
import type {
  ProjectSnapshot,
  ProjectListQuery,
  ProjectVersionQuery,
  ProjectVersionSummary,
  ProjectReleasePreflightIssue,
  ScadaDocument,
} from "@adui/scada-core";
import {
  createProjectSnapshot,
  parseServerProjectSaveRequest,
  readProjectSnapshot,
  validateProjectReleasePreflight,
} from "@adui/scada-core";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { hasProjectPermission } from "./project-access-policy.js";
import type {
  AuthenticatedProjectPrincipal,
  ProjectAccessAction,
} from "./project-access-policy.js";

/** 工程列表和详情共用的轻量摘要，不包含完整组态文档。 */
export interface ProjectSummary {
  readonly projectId: string;
  readonly headRevision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 已保存的当前修订版的静态发布预检；不包含快照正文与发布许可。 */
export interface ProjectReleasePreflightSummary {
  readonly projectId: string;
  readonly revision: number;
  readonly headRevision: number;
  readonly contentHash: string;
  readonly passed: boolean;
  readonly issues: readonly ProjectReleasePreflightIssue[];
}

/** 未授权与工程不存在统一拒绝，不向外暴露工程是否存在。 */
export class ProjectVersionAccessDeniedError extends Error {
  constructor() {
    super("工程资源不存在或无权访问");
    this.name = "ProjectVersionAccessDeniedError";
  }
}

/** 预期修订号不匹配；调用方必须重新读取后显式决定如何处理。 */
export class ProjectRevisionConflictError extends Error {
  constructor() {
    super("工程版本已变化，请重新获取最新修订号");
    this.name = "ProjectRevisionConflictError";
  }
}

/** 已授权工程中查询不到指定历史修订号。 */
export class ProjectRevisionNotFoundError extends Error {
  constructor() {
    super("指定工程版本不存在");
    this.name = "ProjectRevisionNotFoundError";
  }
}

/** 当前租户下已存在相同工程标识。 */
export class ProjectAlreadyExistsError extends Error {
  constructor() {
    super("当前租户下已存在相同工程标识的工程");
    this.name = "ProjectAlreadyExistsError";
  }
}

/** 客户端工程请求不符合共享 Core 或服务端分页契约。 */
export class ProjectRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectRequestValidationError";
  }
}

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const TRANSACTION_OPTIONS = { maxWait: 2000, timeout: 10000 };
const OWNER_PERMISSIONS: readonly ProjectAccessAction[] = [
  "project:read",
  "version:read",
  "version:append",
];

type ProjectSummaryRow = {
  readonly projectId: string;
  readonly headRevision: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type ProjectVersionSummaryRow = {
  readonly projectId: string;
  readonly revision: bigint;
  readonly createdAt: Date;
  readonly contentHash: string;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requirePrincipal(
  principal: AuthenticatedProjectPrincipal | null,
): asserts principal is AuthenticatedProjectPrincipal {
  if (
    !principal ||
    typeof principal.tenantId !== "string" ||
    !ID_PATTERN.test(principal.tenantId) ||
    typeof principal.subjectId !== "string" ||
    !ID_PATTERN.test(principal.subjectId)
  ) {
    throw new ProjectVersionAccessDeniedError();
  }
}

function requireProjectId(projectId: string): void {
  if (typeof projectId !== "string" || !ID_PATTERN.test(projectId)) {
    throw new ProjectVersionAccessDeniedError();
  }
}

function parseSaveRequest(input: unknown, projectId: string) {
  try {
    return parseServerProjectSaveRequest(input, projectId);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      throw new ProjectRequestValidationError(error.message);
    }
    throw error;
  }
}

/** 只映射最终快照容量超限；其他摘要、数据库或编程错误保持原样抛出。 */
async function createCheckedSnapshot(
  document: ScadaDocument,
  revision: number,
  createdAt: string,
): Promise<ProjectSnapshot> {
  try {
    return await createProjectSnapshot(document, { revision, createdAt });
  } catch (error) {
    if (error instanceof RangeError && error.message === "工程版本快照超过 2 MiB 限制") {
      throw new ProjectRequestValidationError("工程版本快照超过 2 MiB 限制");
    }
    throw error;
  }
}

/** 创建工程只接受文档本身，租户、主体和审计信息一律来自可信会话。 */
function parseProjectCreateDocument(input: unknown): ScadaDocument {
  if (!isPlainRecord(input)) {
    throw new ProjectRequestValidationError("工程创建请求必须为普通对象");
  }
  const fields = Object.keys(input);
  if (fields.length !== 1 || fields[0] !== "document") {
    throw new ProjectRequestValidationError("工程创建请求只允许 document 字段");
  }
  const document = input.document;
  if (!isPlainRecord(document) || typeof document.projectId !== "string") {
    throw new ProjectRequestValidationError("工程创建请求必须包含有效的工程文档");
  }
  return parseSaveRequest({ expectedRevision: null, document }, document.projectId).document;
}

function parsePositiveInteger(value: unknown, label: string): number {
  let parsed = value;
  if (typeof parsed === "string") {
    if (!/^[1-9]\d*$/.test(parsed)) {
      throw new ProjectRequestValidationError(label + "必须是正整数");
    }
    parsed = Number(parsed);
  }
  if (!Number.isSafeInteger(parsed) || (parsed as number) <= 0) {
    throw new ProjectRequestValidationError(label + "必须是大于零的安全整数");
  }
  return parsed as number;
}

/** 工程列表只允许数量和稳定 ID 游标，拒绝额外身份参数。 */
function parseProjectListQuery(
  input: unknown,
): Required<Pick<ProjectListQuery, "limit">> & Pick<ProjectListQuery, "afterProjectId"> {
  const source = input === undefined ? {} : input;
  if (!isPlainRecord(source)) {
    throw new ProjectRequestValidationError("工程列表分页参数必须为普通对象");
  }
  if (Object.keys(source).some((field) => field !== "limit" && field !== "afterProjectId")) {
    throw new ProjectRequestValidationError("工程列表分页只允许 limit 与 afterProjectId 参数");
  }

  const limit =
    source.limit === undefined ? 20 : parsePositiveInteger(source.limit, "工程列表每页数量");
  if (limit > 100) {
    throw new ProjectRequestValidationError("工程列表每页数量不能超过 100 条");
  }
  const afterProjectId = source.afterProjectId;
  if (
    afterProjectId !== undefined &&
    (typeof afterProjectId !== "string" || !ID_PATTERN.test(afterProjectId))
  ) {
    throw new ProjectRequestValidationError("工程列表游标必须是合法的工程 ID");
  }
  return {
    limit,
    ...(afterProjectId === undefined ? {} : { afterProjectId }),
  };
}

/** 分页只允许 limit 与 beforeRevision，拒绝重复参数、未知字段和越界值。 */
function parseVersionQuery(
  input: unknown,
): Required<Pick<ProjectVersionQuery, "limit">> & Pick<ProjectVersionQuery, "beforeRevision"> {
  const source = input === undefined ? {} : input;
  if (!isPlainRecord(source)) {
    throw new ProjectRequestValidationError("工程版本分页参数必须为普通对象");
  }
  const fields = Object.keys(source);
  if (fields.some((field) => field !== "limit" && field !== "beforeRevision")) {
    throw new ProjectRequestValidationError("工程版本分页只允许 limit 与 beforeRevision 参数");
  }

  const limit = source.limit === undefined ? 20 : parsePositiveInteger(source.limit, "每页数量");
  if (limit > 100) {
    throw new ProjectRequestValidationError("每页数量不能超过 100 条");
  }
  const beforeRevision =
    source.beforeRevision === undefined
      ? undefined
      : parsePositiveInteger(source.beforeRevision, "历史分页修订号");
  return { limit, ...(beforeRevision === undefined ? {} : { beforeRevision }) };
}

function toProjectSummary(row: ProjectSummaryRow): ProjectSummary {
  if (
    typeof row.headRevision !== "bigint" ||
    row.headRevision < 0n ||
    row.headRevision > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new TypeError("数据库工程修订号超出安全整数范围");
  }
  return {
    projectId: row.projectId,
    headRevision: Number(row.headRevision),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toVersionSummary(row: ProjectVersionSummaryRow): ProjectVersionSummary {
  if (
    typeof row.revision !== "bigint" ||
    row.revision <= 0n ||
    row.revision > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new TypeError("数据库历史版本修订号超出安全整数范围");
  }
  return {
    projectId: row.projectId,
    revision: Number(row.revision),
    createdAt: row.createdAt.toISOString(),
    contentHash: row.contentHash,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "P2002";
}

async function lockProject(
  tx: Prisma.TransactionClient,
  principal: AuthenticatedProjectPrincipal,
  projectId: string,
  mode: "SHARE" | "UPDATE",
): Promise<bigint> {
  const projects =
    mode === "UPDATE"
      ? await tx.$queryRaw<Array<{ head_revision: bigint }>>`
          SELECT head_revision FROM scada_projects
          WHERE tenant_id = ${principal.tenantId} AND project_id = ${projectId}
          FOR UPDATE
        `
      : await tx.$queryRaw<Array<{ head_revision: bigint }>>`
          SELECT head_revision FROM scada_projects
          WHERE tenant_id = ${principal.tenantId} AND project_id = ${projectId}
          FOR SHARE
        `;
  if (projects.length !== 1) throw new ProjectVersionAccessDeniedError();
  const head = projects[0]?.head_revision;
  if (typeof head !== "bigint" || head < 0n) {
    throw new TypeError("数据库工程修订号异常");
  }
  return head;
}

async function requireProjectPermission(
  tx: Prisma.TransactionClient,
  principal: AuthenticatedProjectPrincipal,
  projectId: string,
  action: ProjectAccessAction,
): Promise<void> {
  const grants = await tx.scadaProjectGrant.findMany({
    where: {
      tenantId: principal.tenantId,
      projectId,
      subjectId: principal.subjectId,
    },
    select: { permission: true },
  });
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

/**
 * 服务端专用事务仓储。所有主体必须由可信身份 Guard 提供，
 * 不允许从客户端请求体、角色字段或工程文档推导租户和操作人。
 */
@Injectable()
export class PrismaProjectVersionStore {
  constructor(private readonly database: PrismaService) {}

  /**
   * 创建工程、创建者三项权限、首个快照、工程水位和成功审计处于同一事务。
   * 工程标识来自已通过共享 Core 严格校验的文档，不引入独立名称字段。
   */
  async create(
    principal: AuthenticatedProjectPrincipal | null,
    input: unknown,
  ): Promise<ProjectSummary> {
    requirePrincipal(principal);
    const document = parseProjectCreateDocument(input);
    const createdAt = new Date().toISOString();
    const snapshot = await createCheckedSnapshot(document, 1, createdAt);
    const snapshotData = JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue;

    return this.database.client.$transaction(async (tx) => {
      // Guard 的认证结果只是请求开始时的状态；创建权限必须在事务内再次复核。
      // 共享锁保证并发停用主体的 UPDATE 不会与本次创建提交交错。
      const identities = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM scada_identities
        WHERE tenant_id = ${principal.tenantId} AND subject_id = ${principal.subjectId}
        FOR SHARE
      `;
      if (identities.length !== 1 || identities[0]?.status !== "active") {
        throw new ProjectVersionAccessDeniedError();
      }
      try {
        await tx.scadaProject.create({
          data: {
            tenantId: principal.tenantId,
            projectId: document.projectId,
            headRevision: 0n,
            createdAt: new Date(createdAt),
          },
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) throw new ProjectAlreadyExistsError();
        throw error;
      }

      await tx.scadaProjectGrant.createMany({
        data: OWNER_PERMISSIONS.map((permission) => ({
          tenantId: principal.tenantId,
          projectId: document.projectId,
          subjectId: principal.subjectId,
          permission,
        })),
      });
      await tx.scadaProjectVersion.create({
        data: {
          tenantId: principal.tenantId,
          projectId: document.projectId,
          revision: 1n,
          snapshot: snapshotData,
          contentHash: snapshot.contentHash,
          createdBy: principal.subjectId,
          createdAt: new Date(snapshot.createdAt),
        },
      });
      await tx.scadaProject.update({
        where: {
          tenantId_projectId: {
            tenantId: principal.tenantId,
            projectId: document.projectId,
          },
        },
        data: { headRevision: 1n },
      });
      // 现有数据库约束只允许 version:append；首个快照按一次版本追加审计。
      await tx.scadaProjectAudit.create({
        data: {
          tenantId: principal.tenantId,
          projectId: document.projectId,
          revision: 1n,
          actorId: principal.subjectId,
          action: "version:append",
        },
      });

      const project = await tx.scadaProject.findUnique({
        where: {
          tenantId_projectId: {
            tenantId: principal.tenantId,
            projectId: document.projectId,
          },
        },
        select: {
          projectId: true,
          headRevision: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!project) throw new TypeError("工程创建事务无法读取刚写入的工程记录");
      return toProjectSummary(project);
    }, TRANSACTION_OPTIONS);
  }

  /** 按不可变工程 ID 有界升序分页，每页重新核验当前租户与 project:read。 */
  async list(
    principal: AuthenticatedProjectPrincipal | null,
    input?: unknown,
  ): Promise<readonly ProjectSummary[]> {
    requirePrincipal(principal);
    const query = parseProjectListQuery(input);
    const projects = await this.database.client.scadaProject.findMany({
      where: {
        tenantId: principal.tenantId,
        ...(query.afterProjectId === undefined ? {} : { projectId: { gt: query.afterProjectId } }),
        grants: {
          some: {
            tenantId: principal.tenantId,
            subjectId: principal.subjectId,
            permission: "project:read",
          },
        },
      },
      select: {
        projectId: true,
        headRevision: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { projectId: "asc" },
      take: query.limit,
    });
    return projects.map(toProjectSummary);
  }

  /** 工程详情在共享锁内复核 project:read，避免授权撤销与读取竞态。 */
  async getProject(
    principal: AuthenticatedProjectPrincipal | null,
    projectId: string,
  ): Promise<ProjectSummary> {
    requirePrincipal(principal);
    requireProjectId(projectId);

    return this.database.client.$transaction(async (tx) => {
      await lockProject(tx, principal, projectId, "SHARE");
      await requireProjectPermission(tx, principal, projectId, "project:read");
      const project = await tx.scadaProject.findUnique({
        where: { tenantId_projectId: { tenantId: principal.tenantId, projectId } },
        select: {
          projectId: true,
          headRevision: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!project) throw new ProjectVersionAccessDeniedError();
      return toProjectSummary(project);
    }, TRANSACTION_OPTIONS);
  }

  /** 在工程共享锁内复核 version:read；列表只返回摘要，不读取 JSONB 快照。 */
  async listVersions(
    principal: AuthenticatedProjectPrincipal | null,
    projectId: string,
    input?: unknown,
  ): Promise<readonly ProjectVersionSummary[]> {
    requirePrincipal(principal);
    requireProjectId(projectId);
    const query = parseVersionQuery(input);

    return this.database.client.$transaction(async (tx) => {
      await lockProject(tx, principal, projectId, "SHARE");
      await requireProjectPermission(tx, principal, projectId, "version:read");
      const versions = await tx.scadaProjectVersion.findMany({
        where: {
          tenantId: principal.tenantId,
          projectId,
          ...(query.beforeRevision === undefined
            ? {}
            : { revision: { lt: BigInt(query.beforeRevision) } }),
        },
        select: {
          projectId: true,
          revision: true,
          createdAt: true,
          contentHash: true,
        },
        orderBy: { revision: "desc" },
        take: query.limit,
      });
      return versions.map(toVersionSummary);
    }, TRANSACTION_OPTIONS);
  }

  /** 在同一数据库事务内校验授权、CAS、追加快照、推进水位并保存成功审计。 */
  async append(
    principal: AuthenticatedProjectPrincipal | null,
    projectId: string,
    input: unknown,
  ): Promise<ProjectSnapshot> {
    requirePrincipal(principal);
    requireProjectId(projectId);
    const request = parseSaveRequest(input, projectId);

    return this.database.client.$transaction(async (tx) => {
      const head = await lockProject(tx, principal, projectId, "UPDATE");
      await requireProjectPermission(tx, principal, projectId, "version:append");
      if (head !== BigInt(request.expectedRevision ?? 0)) {
        throw new ProjectRevisionConflictError();
      }
      if (head >= BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RangeError("工程修订号超出安全整数范围");
      }

      const revision = Number(head + 1n);
      const snapshot = await createCheckedSnapshot(
        request.document,
        revision,
        new Date().toISOString(),
      );
      // Prisma JSONB 需要可序列化的可写 JSON，不直接传入冻结的 Core 快照对象。
      const snapshotData = JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue;
      await tx.scadaProjectVersion.create({
        data: {
          tenantId: principal.tenantId,
          projectId,
          revision: BigInt(revision),
          snapshot: snapshotData,
          contentHash: snapshot.contentHash,
          createdBy: principal.subjectId,
          createdAt: new Date(snapshot.createdAt),
        },
      });
      await tx.scadaProject.update({
        where: { tenantId_projectId: { tenantId: principal.tenantId, projectId } },
        data: { headRevision: BigInt(revision) },
      });
      await tx.scadaProjectAudit.create({
        data: {
          tenantId: principal.tenantId,
          projectId,
          revision: BigInt(revision),
          actorId: principal.subjectId,
          action: "version:append",
        },
      });
      return snapshot;
    }, TRANSACTION_OPTIONS);
  }

  /** 读取时同样在工程锁内复查权限，并验证 JSONB 快照及数据库元数据。 */
  async read(
    principal: AuthenticatedProjectPrincipal | null,
    projectId: string,
    revision: number,
  ): Promise<ProjectSnapshot> {
    requirePrincipal(principal);
    requireProjectId(projectId);
    if (!Number.isSafeInteger(revision) || revision <= 0) {
      throw new ProjectRequestValidationError("查询修订号必须为大于零的安全整数");
    }

    return this.database.client.$transaction(async (tx) => {
      await lockProject(tx, principal, projectId, "SHARE");
      await requireProjectPermission(tx, principal, projectId, "version:read");

      const row = await tx.scadaProjectVersion.findUnique({
        where: {
          tenantId_projectId_revision: {
            tenantId: principal.tenantId,
            projectId,
            revision: BigInt(revision),
          },
        },
      });
      if (!row) throw new ProjectRevisionNotFoundError();
      const snapshot = await readProjectSnapshot(row.snapshot);
      if (
        snapshot.projectId !== projectId ||
        snapshot.revision !== revision ||
        snapshot.contentHash !== row.contentHash ||
        snapshot.createdAt !== row.createdAt.toISOString()
      ) {
        throw new TypeError("数据库工程版本元数据与快照不一致");
      }
      return snapshot;
    }, TRANSACTION_OPTIONS);
  }
  /**
   * 只读检查当前已保存的工程版本。工程共享锁防止在权限、当前水位、
   * 快照验证与静态 SVG 预检之间插入版本追加或撤权操作。
   * 兼容性 passed 不表示可发布；不创建发布记录或写入审计。
   */
  async preflightRelease(
    principal: AuthenticatedProjectPrincipal | null,
    projectId: string,
    revision: number,
  ): Promise<ProjectReleasePreflightSummary> {
    requirePrincipal(principal);
    requireProjectId(projectId);
    if (!Number.isSafeInteger(revision) || revision <= 0) {
      throw new ProjectRequestValidationError("发布预检修订号必须为大于零的安全整数");
    }

    return this.database.client.$transaction(async (tx) => {
      const head = await lockProject(tx, principal, projectId, "SHARE");
      await requireProjectPermission(tx, principal, projectId, "version:read");
      if (head !== BigInt(revision)) {
        throw new ProjectRevisionConflictError();
      }

      const row = await tx.scadaProjectVersion.findUnique({
        where: {
          tenantId_projectId_revision: {
            tenantId: principal.tenantId,
            projectId,
            revision: BigInt(revision),
          },
        },
      });
      if (!row) throw new ProjectRevisionNotFoundError();
      const snapshot = await readProjectSnapshot(row.snapshot);
      if (
        snapshot.projectId !== projectId ||
        snapshot.revision !== revision ||
        snapshot.contentHash !== row.contentHash ||
        snapshot.createdAt !== row.createdAt.toISOString()
      ) {
        throw new TypeError("数据库工程版本元数据与快照不一致");
      }

      const report = validateProjectReleasePreflight(snapshot.document);
      return {
        projectId,
        revision,
        headRevision: revision,
        contentHash: snapshot.contentHash,
        passed: report.passed,
        issues: report.issues,
      };
    }, TRANSACTION_OPTIONS);
  }
}
