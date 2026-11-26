import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import acceptedEvidence from "./prisma8-native-baseline-accepted-evidence.json" with { type: "json" };

export const nativeEmptyDatabaseName = "adui_scada_fresh_prisma8_native";
export const nativeEmptyConfirmation = "--confirm-adui-scada-fresh-prisma8-native";
export const nativeEmptyUrlVariable = "SCADA_PRISMA8_NATIVE_BASELINE_DATABASE_URL";
const acceptedFingerprint = "02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e";

export class NativePreflightError extends Error {}

function requireCondition(condition, message) {
  if (!condition) throw new NativePreflightError(message);
}

/** 锁定维护者实际验收的十四文件证据，而不是信任当前候选自行报告的哈希。 */
export function requireAcceptedCandidateEvidence(report) {
  const { fingerprint, ...content } = acceptedEvidence;
  requireCondition(
    fingerprint === acceptedFingerprint &&
      createHash("sha256").update(JSON.stringify(content)).digest("hex") === fingerprint &&
      isDeepStrictEqual(report, acceptedEvidence),
    "独立候选与已验收的十四文件证据指纹不一致",
  );
  return fingerprint;
}

/** 仅接受第三座专用库的显式地址，不继承通用连接串或 URL 查询配置。 */
export function nativeEmptyClientOptions(input, args) {
  requireCondition(
    isDeepStrictEqual(args, [nativeEmptyConfirmation]),
    "必须明确确认第三座专用空库只读预检，且不得附加参数",
  );
  const message = "仅允许显式连接本机 127.0.0.1:15432 的第三座专用空库";
  try {
    requireCondition(
      typeof input === "string" && !/[\x00-\x20\x7f\\]/u.test(input),
      message,
    );
    const url = new URL(input);
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    requireCondition(
      (url.protocol === "postgresql:" || url.protocol === "postgres:") &&
        url.hostname === "127.0.0.1" &&
        url.port === "15432" &&
        url.pathname === "/" + nativeEmptyDatabaseName &&
        /^[a-zA-Z_][a-zA-Z0-9_]*$/u.test(user) &&
        password.length > 0 &&
        !/[\x00-\x1f\x7f]/u.test(password) &&
        !url.hash &&
        (url.search === "" || url.search === "?schema=public"),
      message,
    );
    return {
      host: "127.0.0.1",
      port: 15432,
      database: nativeEmptyDatabaseName,
      user,
      password,
      ssl: false,
      replication: "false",
      client_encoding: "UTF8",
      application_name: "adui_scada_native_empty_preflight",
      connectionTimeoutMillis: 5000,
      query_timeout: 8000,
      options:
        "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=10000 -c search_path=public -c timezone=UTC -c standard_conforming_strings=on",
    };
  } catch {
    throw new NativePreflightError(message);
  }
}

const boundarySql = `SELECT pg_catalog.current_database()::text AS database_name,
    pg_catalog.current_schema()::text AS schema_name,
    current_user::text AS role_name, session_user::text AS session_role,
    pg_catalog.current_setting('transaction_read_only') AS read_only,
    pg_catalog.current_setting('default_transaction_read_only') AS default_read_only,
    pg_catalog.current_setting('transaction_isolation') AS isolation,
    pg_catalog.current_setting('TimeZone') AS timezone,
    pg_catalog.current_setting('server_encoding') AS server_encoding,
    pg_catalog.current_setting('standard_conforming_strings') AS standard_strings,
    pg_catalog.current_setting('search_path') AS search_path,
    pg_catalog.current_setting('server_version_num') AS server_version,
    pg_catalog.pg_is_in_recovery() AS in_recovery,
    (SELECT datdba = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
      FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database()) AS database_owner,
    pg_catalog.has_database_privilege(current_user, pg_catalog.current_database(), 'CREATE') AS database_create,
    pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage,
    pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') AS public_create`;

const emptySql = `SELECT
    EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('public', 'pg_catalog', 'information_schema', 'pg_toast')) AS extra_schema,
    EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public') AS relations,
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') AS routines,
    EXISTS (SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public') AS types,
    EXISTS (SELECT 1 FROM pg_catalog.pg_operator o JOIN pg_catalog.pg_namespace n ON n.oid = o.oprnamespace WHERE n.nspname = 'public') AS operators,
    EXISTS (SELECT 1 FROM pg_catalog.pg_collation c JOIN pg_catalog.pg_namespace n ON n.oid = c.collnamespace WHERE n.nspname = 'public') AS collations,
    EXISTS (SELECT 1 FROM pg_catalog.pg_conversion c JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public') AS conversions,
    EXISTS (SELECT 1 FROM pg_catalog.pg_opclass c JOIN pg_catalog.pg_namespace n ON n.oid = c.opcnamespace WHERE n.nspname = 'public') AS operator_classes,
    EXISTS (SELECT 1 FROM pg_catalog.pg_opfamily f JOIN pg_catalog.pg_namespace n ON n.oid = f.opfnamespace WHERE n.nspname = 'public') AS operator_families,
    EXISTS (SELECT 1 FROM pg_catalog.pg_ts_config c JOIN pg_catalog.pg_namespace n ON n.oid = c.cfgnamespace WHERE n.nspname = 'public') AS text_search_configs,
    EXISTS (SELECT 1 FROM pg_catalog.pg_ts_dict d JOIN pg_catalog.pg_namespace n ON n.oid = d.dictnamespace WHERE n.nspname = 'public') AS text_search_dictionaries,
    EXISTS (SELECT 1 FROM pg_catalog.pg_ts_parser p JOIN pg_catalog.pg_namespace n ON n.oid = p.prsnamespace WHERE n.nspname = 'public') AS text_search_parsers,
    EXISTS (SELECT 1 FROM pg_catalog.pg_ts_template t JOIN pg_catalog.pg_namespace n ON n.oid = t.tmplnamespace WHERE n.nspname = 'public') AS text_search_templates,
    EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql') AS extensions,
    EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger) AS event_triggers,
    EXISTS (SELECT 1 FROM pg_catalog.pg_publication) AS publications,
    EXISTS (SELECT 1 FROM pg_catalog.pg_subscription WHERE subdbid = (SELECT oid FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database())) AS subscriptions,
    EXISTS (SELECT 1 FROM pg_catalog.pg_foreign_server) AS foreign_servers,
    EXISTS (SELECT 1 FROM pg_catalog.pg_foreign_data_wrapper) AS foreign_wrappers,
    EXISTS (SELECT 1 FROM pg_catalog.pg_largeobject_metadata) AS large_objects,
    EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl) AS default_acls,
    EXISTS (SELECT 1 FROM pg_catalog.pg_prepared_xacts WHERE database = pg_catalog.current_database()) AS prepared_transactions,
    EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE datname = pg_catalog.current_database() AND pid <> pg_catalog.pg_backend_pid()) AS other_sessions`;

const emptyKeys = [
  "extra_schema", "relations", "routines", "types", "operators", "collations", "conversions",
  "operator_classes", "operator_families", "text_search_configs", "text_search_dictionaries",
  "text_search_parsers", "text_search_templates", "extensions", "event_triggers", "publications",
  "subscriptions", "foreign_servers", "foreign_wrappers", "large_objects", "default_acls",
  "prepared_transactions", "other_sessions",
];

/** 只读取目录元数据；失败时也回滚、关闭，并且不回显第三方连接异常。 */
export async function inspectNativeEmptyDatabase(client, expectedUser) {
  let begun = false;
  let report;
  const failures = [];
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    begun = true;
    const boundary = await client.query(boundarySql);
    const row = boundary.rows[0];
    requireCondition(
      boundary.rows.length === 1 &&
        row?.database_name === nativeEmptyDatabaseName &&
        row.schema_name === "public" &&
        row.role_name === expectedUser &&
        row.session_role === expectedUser &&
        row.read_only === "on" &&
        row.default_read_only === "on" &&
        row.isolation === "repeatable read" &&
        row.timezone === "UTC" &&
        row.server_encoding === "UTF8" &&
        row.standard_strings === "on" &&
        row.search_path === "public" &&
        /^\d{6}$/u.test(row.server_version) &&
        row.in_recovery === false &&
        row.database_owner === true &&
        row.database_create === true &&
        row.public_usage === true &&
        row.public_create === true,
      "第三座专用库实际连接、只读事务、所有者或必要权限不符合预期",
    );
    const empty = await client.query(emptySql);
    requireCondition(
      empty.rows.length === 1 &&
        isDeepStrictEqual(empty.rows[0], Object.fromEntries(emptyKeys.map((key) => [key, false]))),
      "第三座专用库存在受检用户对象、其他会话或未确认的目录状态",
    );
    report = {
      database: nativeEmptyDatabaseName,
      serverVersion: row.server_version,
      checkedEmptyCategories: emptyKeys.length,
      status: "NATIVE_EMPTY_PREFLIGHT_REVIEW_REQUIRED",
      signingAllowed: false,
      deploymentAllowed: false,
    };
  } catch (error) {
    failures.push(error instanceof NativePreflightError ? error.message : "第三座专用库只读查询失败");
  } finally {
    if (begun) {
      try {
        await client.query("ROLLBACK");
      } catch {
        failures.push("第三座专用库只读事务回滚失败");
      }
    }
    try {
      await client.end();
    } catch {
      failures.push("第三座专用库连接关闭失败");
    }
  }
  requireCondition(failures.length === 0, failures.join("；"));
  return report;
}
