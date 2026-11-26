import { nativeHash } from "./prisma8-native-baseline.mjs";
import { nativeEmptyDatabaseName } from "./prisma8-native-baseline-preflight.mjs";

export const migrationStateConfirmation = "--inspect-adui-scada-fresh-prisma8-native-state";
const migrationHash = "e6b95ed88834dce3f6448445a5ba12a00ba34c8e5c68f4335751659b15a77f17";
const systemCodes = new Set(["ETIMEDOUT", "ENOBUFS", "ENOENT", "EACCES", "EPERM", "ECONNRESET", "ECONNREFUSED", "EPIPE"]);
const prismaCodes = new Set([
  "MIGRATION.PRECHECK_FAILED", "MIGRATION.POSTCHECK_FAILED", "MIGRATION.EXECUTION_FAILED",
  "MIGRATION.RUNNER_FAILED", "MIGRATION.SCHEMA_VERIFY_FAILED", "MIGRATION.HASH_MISMATCH",
  "MIGRATION.MARKER_MISMATCH", "MIGRATION.MARKER_NOT_IN_HISTORY", "MIGRATION.PATH_UNREACHABLE",
  "MIGRATION.CHANGE_POLICY_FORBIDS", "MIGRATION.DATA_PROTECTION_FORBIDS", "MIGRATION.POLICY_MISMATCH",
  "MIGRATION.UNFILLED_PLACEHOLDER", "MIGRATION.FILE_MISSING", "MIGRATION.SNAPSHOT_MISSING",
  "MIGRATION.PLANNING_FAILED", "MIGRATION.INVALID_DEFAULT_EXPORT",
  "CONTRACT.MARKER_MISSING", "CONTRACT.MARKER_MISMATCH", "CONTRACT.SCHEMA_VERIFICATION_FAILED",
  "CONTRACT.TARGET_MISMATCH", "CONFIG.DB_CONNECTION_REQUIRED", "CONFIG.VALIDATION_FAILED",
  "CLI.INVALID_ARGUMENTS", "DRIVER.NOT_CONNECTED",
]);
const sqlStates = new Set([
  "3D000", "3F000", "28P01", "28000", "42501", "42P01", "42703", "42704", "42601", "42P07", "42710",
  "23502", "23503", "23505", "23514", "25006", "25P02", "40001", "40P01", "55P03", "57014", "53300", "57P03", "0A000",
]);

export class NativeRecoveryError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new NativeRecoveryError(message);
}

/** 事故恢复期间冻结所有写入确认；不提供环境变量或附加参数绕过。 */
export function requireRecoveryReview(apply) {
  requireMatch(!apply, "上次原生迁移失败，恢复评审完成前禁止再次执行迁移");
}

/** 只从匹配命令的结构化封装收集已知代码，不复制异常文本及任意元数据。 */
export function describeNativeChildFailure(child, commandId) {
  /** @type {Set<string>} 可公开的固定错误码集合。 */
  const codes = new Set();
  const collect = (value, depth) => {
    if (!value || typeof value !== "object" || depth > 6) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 50)) collect(item, depth + 1);
      return;
    }
    for (const code of [value.code, value.sqlState, value.sqlstate]) {
      if (prismaCodes.has(code) || sqlStates.has(code)) codes.add(code);
    }
    for (const key of ["error", "cause", "meta", "details", "failure", "diagnostics", "errors"]) {
      collect(value[key], depth + 1);
    }
  };
  for (const stream of [child.stdout, child.stderr]) {
    if (typeof stream !== "string" || !commandId) continue;
    let documents;
    try {
      documents = [JSON.parse(stream)];
    } catch {
      documents = stream.trim().split(/\r?\n/u).flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    }
    for (const document of documents) {
      if (document?.kind === "result" && document.commandId === commandId && document.envelope?.commandId === commandId) {
        collect(document.envelope, 0);
      }
    }
  }
  const code = child.error?.code;
  const processCode = systemCodes.has(code) ? code : child.error ? "未知进程错误" : "无";
  const status = Number.isSafeInteger(child.status) ? String(child.status) : "未知";
  return "独立迁移子进程未确认成功；子进程退出码：" + status +
    "；进程错误：" + processCode + "；官方诊断：" + ([...codes].join("、") || "未取得白名单错误码") +
    "；原始诊断不回显";
}

const boundarySql = `SELECT pg_catalog.current_database()::text AS database_name,
    current_user::text AS role_name, session_user::text AS session_role,
    pg_catalog.current_setting('transaction_read_only') AS read_only,
    pg_catalog.current_setting('default_transaction_read_only') AS default_read_only,
    pg_catalog.current_setting('transaction_isolation') AS isolation,
    pg_catalog.current_setting('server_version_num') AS server_version,
    pg_catalog.pg_is_in_recovery() AS in_recovery,
    (SELECT datdba = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
      FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database()) AS database_owner,
    EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
      WHERE datname = pg_catalog.current_database() AND pid <> pg_catalog.pg_backend_pid()) AS other_sessions`;
const catalogSql = `WITH tables AS (
    SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  ), indexes AS (
    SELECT i.indexrelid, i.indisprimary FROM pg_catalog.pg_index i JOIN tables t ON t.oid = i.indrelid
  ) SELECT
    (SELECT count(*)::int FROM tables) AS tables,
    (SELECT count(*)::int FROM pg_catalog.pg_attribute a JOIN tables t ON t.oid = a.attrelid WHERE a.attnum > 0 AND NOT a.attisdropped) AS columns,
    (SELECT count(*)::int FROM pg_catalog.pg_constraint c JOIN tables t ON t.oid = c.conrelid WHERE c.contype = 'p') AS primary_keys,
    (SELECT count(*)::int FROM pg_catalog.pg_constraint c JOIN tables t ON t.oid = c.conrelid WHERE c.contype = 'f') AS foreign_keys,
    (SELECT count(*)::int FROM pg_catalog.pg_constraint c JOIN tables t ON t.oid = c.conrelid WHERE c.contype = 'c') AS checks,
    (SELECT count(*)::int FROM indexes WHERE NOT indisprimary) AS non_primary_indexes,
    (SELECT count(*)::int FROM tables t WHERE pg_catalog.obj_description(t.oid, 'pg_class') IS NOT NULL) AS table_comments,
    (SELECT count(*)::int FROM pg_catalog.pg_attribute a JOIN tables t ON t.oid = a.attrelid WHERE a.attnum > 0 AND NOT a.attisdropped AND pg_catalog.col_description(t.oid, a.attnum) IS NOT NULL) AS column_comments,
    (SELECT count(*)::int FROM indexes i WHERE pg_catalog.obj_description(i.indexrelid, 'pg_class') IS NOT NULL) AS index_comments,
    EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'prisma_contract') AS marker_schema,
    EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prisma_contract' AND c.relname = 'marker' AND c.relkind = 'r') AS marker_table,
    EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prisma_contract' AND c.relname = 'ledger' AND c.relkind = 'r') AS ledger_table,
    EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = '_prisma_migrations') AS legacy_ledger`;
const countKeys = ["tables", "columns", "primary_keys", "foreign_keys", "checks", "non_primary_indexes", "table_comments", "column_comments", "index_comments"];
const flagKeys = ["marker_schema", "marker_table", "ledger_table", "legacy_ledger"];

/** 只读取目录及固定标记字段；不读取业务行，不执行迁移或签名。 */
export async function inspectNativeMigrationState(client, expectedUser) {
  let begun = false;
  let stage = "连接";
  let report;
  const failures = [];
  try {
    await client.connect();
    stage = "启动只读事务";
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    begun = true;
    stage = "连接边界";
    const boundary = await client.query(boundarySql);
    const row = boundary.rows[0];
    requireMatch(boundary.rows.length === 1 && row?.database_name === nativeEmptyDatabaseName && row.role_name === expectedUser && row.session_role === expectedUser && row.read_only === "on" && row.default_read_only === "on" && row.isolation === "repeatable read" && /^\d{6}$/u.test(row.server_version) && row.in_recovery === false && row.database_owner === true && row.other_sessions === false, "恢复检查实际数据库、所有者、只读事务或其他会话不符合预期");
    stage = "目录统计";
    const result = await client.query(catalogSql);
    const catalog = result.rows[0];
    requireMatch(result.rows.length === 1 && countKeys.every((key) => Number.isSafeInteger(catalog?.[key]) && catalog[key] >= 0) && flagKeys.every((key) => typeof catalog?.[key] === "boolean"), "恢复检查目录统计形状无效");
    stage = "迁移标记";
    const marker = catalog.marker_table
      ? readCounts(await client.query("SELECT count(*)::int AS rows, count(*) FILTER (WHERE space = 'app' AND core_hash = $1)::int AS matched FROM prisma_contract.marker", [nativeHash]))
      : null;
    stage = "迁移账本";
    const ledger = catalog.ledger_table
      ? readCounts(await client.query("SELECT count(*)::int AS rows, count(*) FILTER (WHERE space = 'app' AND migration_hash = $1 AND origin_core_hash IS NULL AND destination_core_hash = $2)::int AS matched FROM prisma_contract.ledger", [migrationHash, nativeHash]))
      : null;
    report = {
      database: nativeEmptyDatabaseName,
      serverVersion: row.server_version,
      catalog: Object.fromEntries([...countKeys, ...flagKeys].map((key) => [key, catalog[key]])),
      metadata: { marker, ledger },
      status: "NATIVE_MIGRATION_RECOVERY_REVIEW_REQUIRED",
    };
  } catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string" && sqlStates.has(error.code) ? error.code : "未知错误类别";
    failures.push(error instanceof NativeRecoveryError ? error.message : "恢复检查阶段失败：" + stage + "；" + code);
  } finally {
    if (begun) {
      try {
        await client.query("ROLLBACK");
      } catch {
        failures.push("恢复检查只读事务回滚失败");
      }
    }
    try {
      await client.end();
    } catch {
      failures.push("恢复检查连接关闭失败");
    }
  }
  requireMatch(failures.length === 0, failures.join("；"));
  return report;
}

function readCounts(result) {
  const row = result.rows[0];
  requireMatch(result.rows.length === 1 && Number.isSafeInteger(row?.rows) && row.rows >= 0 && Number.isSafeInteger(row?.matched) && row.matched >= 0 && row.matched <= row.rows, "迁移元数据统计形状无效");
  return { rows: row.rows, matched: row.matched };
}
