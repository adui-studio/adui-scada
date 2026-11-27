import {
  readProjectSnapshot,
  validateProjectReleasePreflight,
  type ProjectSnapshot,
  type ProjectListQuery,
  type ProjectVersionQuery,
  type ProjectVersionSummary,
} from "@adui/scada-core";
import type { PostgresClient, PostgresTransactionContext } from "@prisma/orm-postgres/runtime";
import type { Contract } from "../generated/prisma8/contract.d.js";
import {
  historicalTextTransaction,
  type Prisma8TextTransaction,
} from "../database/prisma8-text-transaction.js";
import {
  hasProjectPermission,
  type AuthenticatedProjectPrincipal,
  type ProjectAccessAction,
} from "./project-access-policy.js";
import {
  ProjectRequestValidationError,
  ProjectRevisionConflictError,
  ProjectRevisionNotFoundError,
  ProjectVersionAccessDeniedError,
  requirePrincipal,
  requireProjectId,
  type ProjectSummary,
  type ProjectReleasePreflightSummary,
} from "./prisma-project-version-store.js";

type HistoricalTx = PostgresTransactionContext<Contract>;

export interface Prisma8ProjectQueryTransaction {
  readonly queryText: Prisma8TextTransaction["queryText"];
  readGrants(
    tenantId: string,
    projectId: string,
    subjectId: string,
  ): Promise<readonly { readonly permission: string }[]>;
}

export interface Prisma8ProjectQueryTransactions {
  read<T>(operation: (tx: Prisma8ProjectQueryTransaction) => Promise<T>): Promise<T>;
  locked<T>(operation: (tx: Prisma8ProjectQueryTransaction) => Promise<T>): Promise<T>;
}
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const OPTIONS = { isolationLevel: "ReadCommitted", timeout: 10000 } as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
export function parsePrisma8ProjectListQuery(
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
export function parsePrisma8VersionQuery(
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

function bindPrincipal(
  principal: AuthenticatedProjectPrincipal | null,
): AuthenticatedProjectPrincipal {
  requirePrincipal(principal);
  return Object.freeze({ tenantId: principal.tenantId, subjectId: principal.subjectId });
}

function requireRevision(revision: number, label: string): void {
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new ProjectRequestValidationError(label + "必须为大于零的安全整数");
  }
}

function safeRevision(raw: string, minimum: bigint, message: string): number {
  const value = BigInt(raw);
  if (value < minimum || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError(message);
  return Number(value);
}

interface ProjectRow {
  readonly project_id: string;
  readonly head_revision: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface VersionRow {
  readonly project_id: string;
  readonly revision: string;
  readonly created_at: string;
  readonly content_hash: string;
}

const PROJECT_COLUMNS = {
  project_id: "pg/text@1",
  head_revision: "pg/text@1",
  created_at: "pg/text@1",
  updated_at: "pg/text@1",
} as const;
const VERSION_COLUMNS = {
  project_id: "pg/text@1",
  revision: "pg/text@1",
  created_at: "pg/text@1",
  content_hash: "pg/text@1",
} as const;

function projectSummary(row: ProjectRow): ProjectSummary {
  return {
    projectId: row.project_id,
    headRevision: safeRevision(row.head_revision, 0n, "数据库工程修订号超出安全整数范围"),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function versionSummary(row: VersionRow): ProjectVersionSummary {
  return {
    projectId: row.project_id,
    revision: safeRevision(row.revision, 1n, "数据库历史版本修订号超出安全整数范围"),
    createdAt: new Date(row.created_at).toISOString(),
    contentHash: row.content_hash,
  };
}

/** 与正式仓储一致复核快照摘要、版本和时间；不接受迁移后的摘要替代原元数据。 */
export async function validatePrisma8ProjectSnapshot(
  projectId: string,
  revision: number,
  contentHash: string,
  createdAt: string,
  data: unknown,
): Promise<ProjectSnapshot> {
  const snapshot = await readProjectSnapshot(data);
  if (
    snapshot.projectId !== projectId ||
    snapshot.revision !== revision ||
    snapshot.contentHash !== contentHash ||
    snapshot.createdAt !== new Date(createdAt).toISOString()
  ) {
    throw new TypeError("数据库工程版本元数据与快照不一致");
  }
  return snapshot;
}

/** PostgreSQL 只读事务不能取得 FOR SHARE；此候选需要隔离库普通事务，但仅执行查询。 */
async function requireBoundary(tx: HistoricalTx): Promise<void> {
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
    throw new Error("Prisma 8 工程查询候选仅允许隔离库读已提交事务");
}

async function lockAndAuthorize(
  tx: Prisma8ProjectQueryTransaction,
  actor: AuthenticatedProjectPrincipal,
  projectId: string,
  action: "project:read" | "version:read",
): Promise<bigint> {
  const { tenantId, subjectId } = actor;
  const rows = await tx.queryText({ head_revision: "pg/text@1" })`SELECT head_revision::text AS head_revision FROM public.scada_projects
      WHERE tenant_id = ${tenantId} AND project_id = ${projectId} FOR SHARE`;
  if (rows.length !== 1 || !rows[0]) throw new ProjectVersionAccessDeniedError();
  const head = BigInt(rows[0].head_revision);
  if (head < 0n) throw new TypeError("数据库工程修订号异常");
  // 不按单项权限预过滤，完整核对当前可信主体的权限集合。
  const grants = await tx.readGrants(tenantId, projectId, subjectId);
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
  return head;
}

async function readSnapshot(
  tx: Prisma8ProjectQueryTransaction,
  tenantId: string,
  projectId: string,
  revision: number,
): Promise<ProjectSnapshot> {
  const rows = await tx.queryText({
    snapshot_data: "pg/text@1",
    content_hash: "pg/text@1",
    created_at: "pg/text@1",
  })`SELECT snapshot::text AS snapshot_data, content_hash::text AS content_hash,
      created_at::text AS created_at FROM public.scada_project_versions
      WHERE tenant_id = ${tenantId} AND project_id = ${projectId} AND revision = ${BigInt(revision)}`;
  if (rows.length !== 1 || !rows[0]) throw new ProjectRevisionNotFoundError();
  const row = rows[0];
  const data: unknown = JSON.parse(row.snapshot_data);
  return validatePrisma8ProjectSnapshot(
    projectId,
    revision,
    row.content_hash,
    row.created_at,
    data,
  );
}

/** 两代查询候选共用五项业务操作，连接、锁事务模式及边界由各自端口保证。 */
export class Prisma8ProjectQueryOperations {
  constructor(private readonly transactions: Prisma8ProjectQueryTransactions) {}

  async list(
    principal: AuthenticatedProjectPrincipal | null,
    input?: unknown,
  ): Promise<readonly ProjectSummary[]> {
    const actor = bindPrincipal(principal);
    const query = parsePrisma8ProjectListQuery(input);
    const cursor = query.afterProjectId ?? "";
    return this.transactions.read(async (tx) => {
      const rows = await tx.queryText(PROJECT_COLUMNS)`SELECT p.project_id::text AS project_id, p.head_revision::text AS head_revision,
          p.created_at::text AS created_at, p.updated_at::text AS updated_at
          FROM public.scada_projects p
          WHERE p.tenant_id = ${actor.tenantId}
            AND (${cursor}::text = '' OR p.project_id > ${cursor})
            AND EXISTS (SELECT 1 FROM public.scada_project_grants g
              WHERE g.tenant_id = p.tenant_id AND g.project_id = p.project_id
                AND g.subject_id = ${actor.subjectId} AND g.permission = 'project:read')
          ORDER BY p.project_id ASC LIMIT ${query.limit}::integer`;
      return rows.map(projectSummary);
    });
  }

  async getProject(
    principal: AuthenticatedProjectPrincipal | null,
    projectId: string,
  ): Promise<ProjectSummary> {
    const actor = bindPrincipal(principal);
    requireProjectId(projectId);
    return this.transactions.locked(async (tx) => {
      await lockAndAuthorize(tx, actor, projectId, "project:read");
      const rows = await tx.queryText(PROJECT_COLUMNS)`SELECT project_id::text AS project_id, head_revision::text AS head_revision,
          created_at::text AS created_at, updated_at::text AS updated_at
          FROM public.scada_projects
          WHERE tenant_id = ${actor.tenantId} AND project_id = ${projectId}`;
      if (rows.length !== 1 || !rows[0]) throw new ProjectVersionAccessDeniedError();
      return projectSummary(rows[0]);
    });
  }

  async listVersions(
    principal: AuthenticatedProjectPrincipal | null,
    projectId: string,
    input?: unknown,
  ): Promise<readonly ProjectVersionSummary[]> {
    const actor = bindPrincipal(principal);
    requireProjectId(projectId);
    const query = parsePrisma8VersionQuery(input);
    const cursor = BigInt(query.beforeRevision ?? 0);
    return this.transactions.locked(async (tx) => {
      await lockAndAuthorize(tx, actor, projectId, "version:read");
      const rows = await tx.queryText(VERSION_COLUMNS)`SELECT project_id::text AS project_id, revision::text AS revision,
          created_at::text AS created_at, content_hash::text AS content_hash
          FROM public.scada_project_versions
          WHERE tenant_id = ${actor.tenantId} AND project_id = ${projectId}
            AND (${cursor}::bigint = 0 OR revision < ${cursor})
          ORDER BY scada_project_versions.revision DESC LIMIT ${query.limit}::integer`;
      return rows.map(versionSummary);
    });
  }

  async read(
    principal: AuthenticatedProjectPrincipal | null,
    projectId: string,
    revision: number,
  ): Promise<ProjectSnapshot> {
    const actor = bindPrincipal(principal);
    requireProjectId(projectId);
    requireRevision(revision, "查询修订号");
    return this.transactions.locked(async (tx) => {
      await lockAndAuthorize(tx, actor, projectId, "version:read");
      return readSnapshot(tx, actor.tenantId, projectId, revision);
    });
  }

  async preflightRelease(
    principal: AuthenticatedProjectPrincipal | null,
    projectId: string,
    revision: number,
  ): Promise<ProjectReleasePreflightSummary> {
    const actor = bindPrincipal(principal);
    requireProjectId(projectId);
    requireRevision(revision, "发布预检修订号");
    return this.transactions.locked(async (tx) => {
      const head = await lockAndAuthorize(tx, actor, projectId, "version:read");
      if (head !== BigInt(revision)) throw new ProjectRevisionConflictError();
      const snapshot = await readSnapshot(tx, actor.tenantId, projectId, revision);
      const report = validateProjectReleasePreflight(snapshot.document);
      return {
        projectId,
        revision,
        headRevision: revision,
        contentHash: snapshot.contentHash,
        passed: report.passed,
        issues: report.issues,
      };
    });
  }
}

/** 历史隔离候选继续只使用旧 Contract 及固定隔离库门禁。 */
export class Prisma8ProjectQueryStore extends Prisma8ProjectQueryOperations {
  constructor(client: PostgresClient<Contract>) {
    const run = <T>(
      operation: (tx: Prisma8ProjectQueryTransaction) => Promise<T>,
    ): Promise<T> =>
      client.transaction(async (tx) => {
        await requireBoundary(tx);
        const text = historicalTextTransaction(tx, "工程事务查询结果缺少有效文本列");
        return operation({
          queryText: text.queryText,
          readGrants: async (tenantId, projectId, subjectId) =>
            await tx.orm.public.ScadaProjectGrant.where({ tenantId, projectId, subjectId })
              .select("permission")
              .all(),
        });
      }, OPTIONS);
    super({ read: run, locked: run });
  }
}
