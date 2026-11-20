import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { resolvePublishedFixtureTarget } from "./prepare-oidc-published-unreleased.mjs";

const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const SERVER_PACKAGE = fileURLToPath(new URL("../apps/server/package.json", import.meta.url));
const BASELINE_PROJECT = "d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca";
const PRINCIPAL = { tenantId: "lab-tenant", subjectId: "lab-engineer" };
const EXPECTED_PERMISSIONS = ["project:read", "version:read", "version:append", "release:read"];
const RELEASE_MIGRATIONS = [
  "20261118000000_release_state_and_events",
  "20261119000000_release_state_event_integrity",
  "20261119180000_release_read_permission",
];
const SAFE_ERRORS = new Set([
  "D5b4a 只读预检不接受任何写入或额外参数",
  "D5b4a 只能连接可信本机 OIDC Lab",
  "D5b4a 目标数据库或发布迁移不符合预期",
  "D5b4a 可信测试身份与 Keycloak 预绑定不符合预期",
  "D5b4a D5b1 基线工程或未发布状态不符合预期",
  "D5b4a D5b1 基线授权发生变化，拒绝继续",
  "D5b4a 已发现 D5b4 专用工程，必须单独核对",
]);

/** 只读检查，不接受隐含的数据库创建、ACL 删除或回收命令。 */
export function parsePublishedRevocationPreflightArgs(args) {
  if (!Array.isArray(args) || args.length !== 0) {
    throw new Error("D5b4a 只读预检不接受任何写入或额外参数");
  }
  return { mode: "readonly" };
}

export function describePublishedRevocationPreflightFailure(error) {
  if (error instanceof Error && SAFE_ERRORS.has(error.message)) return error.message;
  return "D5b4a 只读预检失败，内部诊断已脱敏";
}

export function resolvePublishedRevocationPreflightTarget(env) {
  try {
    return resolvePublishedFixtureTarget(env);
  } catch {
    throw new Error("D5b4a 只能连接可信本机 OIDC Lab");
  }
}

/** 新批次必须拥有独立的工程命名空间，绝不直接撤销 D5b1 的授权。 */
export function assertPublishedRevocationPreflightRows(rows) {
  if (
    rows?.database?.length !== 1 ||
    rows.database[0].database_name !== "adui_scada" ||
    rows.database[0].database_user !== "adui_scada" ||
    rows.migrations?.length !== 3 ||
    new Set(rows.migrations.map((item) => item.migration_name)).size !== 3 ||
    RELEASE_MIGRATIONS.some(
      (name) => !rows.migrations.some((item) => item.migration_name === name),
    ) ||
    rows.unresolved?.length !== 1 ||
    Number(rows.unresolved[0].count) !== 0
  ) {
    throw new Error("D5b4a 目标数据库或发布迁移不符合预期");
  }
  if (rows.identity?.length !== 1 || rows.externalIdentity?.length !== 1) {
    throw new Error("D5b4a 可信测试身份与 Keycloak 预绑定不符合预期");
  }
  if (
    rows.project?.length !== 1 ||
    String(rows.project[0].head_revision) !== "1" ||
    rows.versions?.length !== 1 ||
    String(rows.versions[0].revision) !== "1" ||
    rows.versions[0].created_by !== PRINCIPAL.subjectId ||
    rows.audit?.length !== 1 ||
    String(rows.audit[0].revision) !== "1" ||
    rows.audit[0].actor_id !== PRINCIPAL.subjectId ||
    rows.audit[0].action !== "version:append" ||
    rows.state?.length !== 1 ||
    String(rows.state[0].release_generation) !== "0" ||
    rows.state[0].released_revision !== null ||
    rows.state[0].released_content_hash !== null ||
    rows.state[0].last_release_event_id !== null ||
    rows.events?.length !== 1 ||
    Number(rows.events[0].count) !== 0
  ) {
    throw new Error("D5b4a D5b1 基线工程或未发布状态不符合预期");
  }
  if (
    rows.grants?.length !== 4 ||
    EXPECTED_PERMISSIONS.some(
      (permission) =>
        rows.grants.filter(
          (row) => row.subject_id === PRINCIPAL.subjectId && row.permission === permission,
        ).length !== 1,
    )
  ) {
    throw new Error("D5b4a D5b1 基线授权发生变化，拒绝继续");
  }
  if (rows.dedicated?.length !== 1 || Number(rows.dedicated[0].count) !== 0) {
    throw new Error("D5b4a 已发现 D5b4 专用工程，必须单独核对");
  }
  return true;
}

/**
 * 全程使用 PostgreSQL REPEATABLE READ READ ONLY 事务。
 * 不查询任何 Cookie、工程正文、快照字节或真实 Token。
 */
export async function inspectPublishedRevocationReadiness(client, target) {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const scope = [PRINCIPAL.tenantId, BASELINE_PROJECT];
    const rows = {
      database: (
        await client.query(
          "SELECT current_database() AS database_name, current_user AS database_user",
        )
      ).rows,
      migrations: (
        await client.query(
          'SELECT migration_name FROM public."_prisma_migrations" ' +
            "WHERE migration_name = ANY($1::text[]) AND finished_at IS NOT NULL " +
            "AND rolled_back_at IS NULL",
          [RELEASE_MIGRATIONS],
        )
      ).rows,
      unresolved: (
        await client.query(
          'SELECT COUNT(*)::integer AS count FROM public."_prisma_migrations" ' +
            "WHERE finished_at IS NULL AND rolled_back_at IS NULL",
        )
      ).rows,
      identity: (
        await client.query(
          "SELECT 1 FROM public.scada_identities " +
            "WHERE tenant_id = $1 AND subject_id = $2 AND status = 'active'",
          [PRINCIPAL.tenantId, PRINCIPAL.subjectId],
        )
      ).rows,
      externalIdentity: (
        await client.query(
          "SELECT 1 FROM public.scada_external_identities " +
            "WHERE issuer = $1 AND tenant_id = $2 AND subject_id = $3",
          [target.issuer, PRINCIPAL.tenantId, PRINCIPAL.subjectId],
        )
      ).rows,
      project: (
        await client.query(
          "SELECT head_revision FROM public.scada_projects " +
            "WHERE tenant_id = $1 AND project_id = $2",
          scope,
        )
      ).rows,
      versions: (
        await client.query(
          "SELECT revision, created_by FROM public.scada_project_versions " +
            "WHERE tenant_id = $1 AND project_id = $2",
          scope,
        )
      ).rows,
      audit: (
        await client.query(
          "SELECT revision, actor_id, action FROM public.scada_project_audit " +
            "WHERE tenant_id = $1 AND project_id = $2",
          scope,
        )
      ).rows,
      state: (
        await client.query(
          "SELECT release_generation, released_revision, released_content_hash, " +
            "last_release_event_id FROM public.scada_project_release_state " +
            "WHERE tenant_id = $1 AND project_id = $2",
          scope,
        )
      ).rows,
      events: (
        await client.query(
          "SELECT COUNT(*)::integer AS count FROM public.scada_project_release_events " +
            "WHERE tenant_id = $1 AND project_id = $2",
          scope,
        )
      ).rows,
      grants: (
        await client.query(
          "SELECT subject_id, permission FROM public.scada_project_grants " +
            "WHERE tenant_id = $1 AND project_id = $2",
          scope,
        )
      ).rows,
      dedicated: (
        await client.query(
          "SELECT COUNT(*)::integer AS count FROM public.scada_projects " +
            "WHERE tenant_id = $1 AND project_id LIKE 'd5b4-revoke-%'",
          [PRINCIPAL.tenantId],
        )
      ).rows,
    };
    assertPublishedRevocationPreflightRows(rows);
    return true;
  } finally {
    // 不写入数据；ROLLBACK 确保快照与连接资源清理。
    await client.query("ROLLBACK");
  }
}

async function run() {
  parsePublishedRevocationPreflightArgs(process.argv.slice(2));
  if (!existsSync(ROOT_ENV)) throw new Error("D5b4a 只能连接可信本机 OIDC Lab");
  loadEnvFile(ROOT_ENV);
  const target = resolvePublishedRevocationPreflightTarget(process.env);
  const serverRequire = createRequire(SERVER_PACKAGE);
  const { Client } = serverRequire("pg");
  const client = new Client({
    connectionString: target.connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  try {
    await client.connect();
    await inspectPublishedRevocationReadiness(client, target);
    process.stdout.write(
      "D5b4a 只读预检通过：可信 Lab、原 D5b1 工程及授权完整，尚无 D5b4 专用工程。\n",
    );
    process.stdout.write("未创建工程、未修改 ACL、未发布或回滚；真实撤权必须另行授权。\n");
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write("错误：" + describePublishedRevocationPreflightFailure(error) + "\n");
    process.exitCode = 1;
  });
}
