import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolvePublishedRevocationPreflightTarget } from "./preflight-oidc-published-revocation.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const SERVER_PACKAGE = fileURLToPath(new URL("../apps/server/package.json", import.meta.url));
const ORIGINAL_PROJECT = "d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca";
const PROJECT_PATTERN =
  /^d5b4-revoke-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PRINCIPAL = { tenantId: "lab-tenant", subjectId: "lab-engineer" };
const OWNER_PERMISSIONS = ["project:read", "version:read", "version:append"];
const PERMISSIONS = [...OWNER_PERMISSIONS, "release:read"];
const MIGRATIONS = [
  "20261118000000_release_state_and_events",
  "20261119000000_release_state_event_integrity",
  "20261119180000_release_read_permission",
];
const SAFE_ERRORS = new Set([
  "D5b4c 参数仅允许现有独立专用工程 ID，禁止写入模式",
  "D5b4c 只能连接可信本机 OIDC Lab",
  "D5b4c 目标数据库、迁移或可信身份不符合预期",
  "D5b4c 独立工程不存在、不唯一或出现额外工程",
  "D5b4c 独立工程首版、审计或未发布状态不符合预期",
  "D5b4c 独立工程 release:read 权限不符合预期",
  "D5b4c 原 D5b1 工程或授权发生变化",
]);

/** 只允许明确的随机专用工程 ID；不支持创建、撤权或恢复命令。 */
export function parsePublishedRevocationTargetArgs(args) {
  if (
    !Array.isArray(args) ||
    args.length !== 2 ||
    args[0] !== "--project-id" ||
    !PROJECT_PATTERN.test(args[1] ?? "")
  ) {
    throw new Error("D5b4c 参数仅允许现有独立专用工程 ID，禁止写入模式");
  }
  return { projectId: args[1] };
}

export function describePublishedRevocationTargetFailure(error) {
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) return error.message;
  return "D5b4c 真实撤权前只读核查失败，内部诊断已脱敏";
}

function validAcl(rows, permissions = PERMISSIONS) {
  return (
    Array.isArray(rows) &&
    rows.length === permissions.length &&
    permissions.every(
      (permission) =>
        rows.filter(
          (entry) => entry.subject_id === PRINCIPAL.subjectId && entry.permission === permission,
        ).length === 1,
    )
  );
}

function validVersion(rows) {
  return (
    rows?.project?.length === 1 &&
    String(rows.project[0].head_revision) === "1" &&
    rows.versions?.length === 1 &&
    String(rows.versions[0].revision) === "1" &&
    rows.versions[0].created_by === PRINCIPAL.subjectId &&
    rows.audit?.length === 1 &&
    String(rows.audit[0].revision) === "1" &&
    rows.audit[0].actor_id === PRINCIPAL.subjectId &&
    rows.audit[0].action === "version:append" &&
    rows.state?.length === 1 &&
    String(rows.state[0].release_generation) === "0" &&
    rows.state[0].released_revision === null &&
    rows.state[0].released_content_hash === null &&
    rows.state[0].last_release_event_id === null &&
    rows.events?.length === 1 &&
    Number(rows.events[0].count) === 0
  );
}

/** 每个检查都要通过，避免以单纯 count=4 误判授权或租户。 */
function assertPublishedRevocationRows(rows, projectId, phase) {
  const prefix = phase === "after" ? "D5b4e" : "D5b4c";
  if (!PROJECT_PATTERN.test(projectId)) {
    throw new Error(prefix + " 参数仅允许现有独立专用工程 ID，禁止写入模式");
  }
  if (
    rows?.database?.length !== 1 ||
    rows.database[0].database_name !== "adui_scada" ||
    rows.database[0].database_user !== "adui_scada" ||
    rows.migrations?.length !== 3 ||
    new Set(rows.migrations.map((item) => item.migration_name)).size !== 3 ||
    MIGRATIONS.some((name) => !rows.migrations.some((item) => item.migration_name === name)) ||
    rows.unresolved?.length !== 1 ||
    Number(rows.unresolved[0].count) !== 0 ||
    rows.identity?.length !== 1 ||
    rows.externalIdentity?.length !== 1
  ) {
    throw new Error(prefix + " 目标数据库、迁移或可信身份不符合预期");
  }
  if (rows.dedicated?.length !== 1 || rows.dedicated[0].project_id !== projectId) {
    throw new Error(prefix + " 独立工程不存在、不唯一或出现额外工程");
  }
  if (!validVersion(rows.target)) {
    throw new Error(prefix + " 独立工程首版、审计或未发布状态不符合预期");
  }
  const expected = phase === "after" ? OWNER_PERMISSIONS : PERMISSIONS;
  if (!validAcl(rows.target.grants, expected)) {
    throw new Error(prefix + " 独立工程 release:read 权限不符合预期");
  }
  if (!validVersion(rows.original) || !validAcl(rows.original.grants)) {
    throw new Error(prefix + " 原 D5b1 工程或授权发生变化");
  }
  return true;
}

/** 原 D5b4c 撤权前校验必须保留四项 ACL 和原有错误契约。 */
export function assertPublishedRevocationTargetRows(rows, projectId) {
  return assertPublishedRevocationRows(rows, projectId, "before");
}

/** 撤权后仅允许专用工程缺少 release:read，其他工程与数据必须完整。 */
export function assertPublishedRevocationAfterRows(rows, projectId) {
  return assertPublishedRevocationRows(rows, projectId, "after");
}

/** 同一受控只读查询快照供撤权前、撤权后与专用事务内重新校验。 */
export async function readPublishedRevocationRows(client, target, projectId) {
  if (!PROJECT_PATTERN.test(projectId)) {
    throw new Error("D5b4c 参数仅允许现有独立专用工程 ID，禁止写入模式");
  }
  const tenant = PRINCIPAL.tenantId;
  const scope = (id) => [tenant, id];
  const query = async (sql, params) => (await client.query(sql, params)).rows;
  const readProject = async (id) => {
    const params = scope(id);
    return {
      project: await query(
        "SELECT head_revision FROM public.scada_projects " +
          "WHERE tenant_id = $1 AND project_id = $2",
        params,
      ),
      versions: await query(
        "SELECT revision, created_by FROM public.scada_project_versions " +
          "WHERE tenant_id = $1 AND project_id = $2",
        params,
      ),
      audit: await query(
        "SELECT revision, actor_id, action FROM public.scada_project_audit " +
          "WHERE tenant_id = $1 AND project_id = $2",
        params,
      ),
      state: await query(
        "SELECT release_generation, released_revision, released_content_hash, " +
          "last_release_event_id FROM public.scada_project_release_state " +
          "WHERE tenant_id = $1 AND project_id = $2",
        params,
      ),
      events: await query(
        "SELECT COUNT(*)::integer AS count FROM public.scada_project_release_events " +
          "WHERE tenant_id = $1 AND project_id = $2",
        params,
      ),
      grants: await query(
        "SELECT subject_id, permission FROM public.scada_project_grants " +
          "WHERE tenant_id = $1 AND project_id = $2",
        params,
      ),
    };
  };
  return {
    database: await query(
      "SELECT current_database() AS database_name, current_user AS database_user",
    ),
    migrations: await query(
      'SELECT migration_name FROM public."_prisma_migrations" ' +
        "WHERE migration_name = ANY($1::text[]) AND finished_at IS NOT NULL " +
        "AND rolled_back_at IS NULL",
      [MIGRATIONS],
    ),
    unresolved: await query(
      'SELECT COUNT(*)::integer AS count FROM public."_prisma_migrations" ' +
        "WHERE finished_at IS NULL AND rolled_back_at IS NULL",
    ),
    identity: await query(
      "SELECT 1 FROM public.scada_identities " +
        "WHERE tenant_id = $1 AND subject_id = $2 AND status = 'active'",
      [tenant, PRINCIPAL.subjectId],
    ),
    externalIdentity: await query(
      "SELECT 1 FROM public.scada_external_identities " +
        "WHERE issuer = $1 AND tenant_id = $2 AND subject_id = $3",
      [target.issuer, tenant, PRINCIPAL.subjectId],
    ),
    dedicated: await query(
      "SELECT project_id FROM public.scada_projects " +
        "WHERE tenant_id = $1 AND project_id LIKE 'd5b4-revoke-%'",
      [tenant],
    ),
    target: await readProject(projectId),
    original: await readProject(ORIGINAL_PROJECT),
  };
}

/** 独立 READ ONLY 事务读取 ACL、版本和发布指针，不获取快照正文。 */
export async function inspectPublishedRevocationTarget(
  client,
  target,
  projectId,
  phase = "before",
) {
  if (!PROJECT_PATTERN.test(projectId) || !["before", "after"].includes(phase)) {
    throw new Error("D5b4c 参数仅允许现有独立专用工程 ID，禁止写入模式");
  }
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const rows = await readPublishedRevocationRows(client, target, projectId);
    if (phase === "after") assertPublishedRevocationAfterRows(rows, projectId);
    else assertPublishedRevocationTargetRows(rows, projectId);
    return true;
  } finally {
    await client.query("ROLLBACK");
  }
}

async function run() {
  const mode = parsePublishedRevocationTargetArgs(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) throw new Error("D5b4c 只能连接可信本机 OIDC Lab");
  loadEnvFile(ROOT_ENV);
  let target;
  try {
    target = resolvePublishedRevocationPreflightTarget(process.env);
  } catch {
    throw new Error("D5b4c 只能连接可信本机 OIDC Lab");
  }
  const requireServer = createRequire(SERVER_PACKAGE);
  const { Client } = requireServer("pg");
  const client = new Client({
    connectionString: target.connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  try {
    await client.connect();
    await inspectPublishedRevocationTarget(client, target, mode.projectId);
    process.stdout.write(
      "D5b4c 只读核查通过：唯一专用工程、授权和未发布状态完整；原 D5b1 工程保持不变。\n",
    );
    process.stdout.write("未创建工程、未撤销或恢复 ACL、未修改发布指针。\n");
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describePublishedRevocationTargetFailure(error) + "\n");
    process.exitCode = 1;
  });
}
