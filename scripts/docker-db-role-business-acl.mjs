import { createHash } from "node:crypto";
import { buildScadaLockRoutinePreview } from "./docker-db-role-lock-routines.mjs";

export class DockerBusinessAclPreviewError extends Error {}

const runtime = "adui_scada_runtime";
const keycloak = "adui_scada_keycloak_runtime";
const roles = [runtime, keycloak];

function columns(value) {
  return value ? value.split(" ") : [];
}

function table(name, physical, read, insert = "", update = "") {
  return {
    name,
    columns: columns(physical),
    read: columns(read),
    insert: columns(insert),
    update: columns(update),
  };
}

// 固定原生契约的物理列与已审阅业务 SQL 对照；不得从目录中的任意标识符生成授权。
const tables = [
  table("scada_projects",
    "tenant_id project_id head_revision created_at updated_at",
    "tenant_id project_id head_revision created_at updated_at",
    "tenant_id project_id head_revision created_at updated_at",
    "head_revision updated_at"),
  table("scada_project_grants",
    "tenant_id project_id subject_id permission",
    "tenant_id project_id subject_id permission"),
  table("scada_project_versions",
    "tenant_id project_id revision snapshot content_hash created_by created_at",
    "tenant_id project_id revision snapshot content_hash created_by created_at",
    "tenant_id project_id revision snapshot content_hash created_by created_at"),
  table("scada_project_audit",
    "event_id tenant_id project_id revision actor_id action created_at",
    "event_id tenant_id project_id revision actor_id action",
    "event_id tenant_id project_id revision actor_id action"),
  table("scada_project_release_state",
    "tenant_id project_id released_revision released_content_hash release_generation last_release_event_id updated_at",
    "tenant_id project_id released_revision released_content_hash release_generation last_release_event_id"),
  table("scada_project_release_events",
    "event_id tenant_id project_id generation action from_revision from_content_hash to_revision to_content_hash actor_id idempotency_key request_semantic_hash created_at",
    "event_id tenant_id project_id generation action to_revision to_content_hash request_semantic_hash created_at"),
  table("scada_identities",
    "tenant_id subject_id status created_at updated_at",
    "tenant_id subject_id status"),
  table("scada_auth_sessions",
    "session_id tenant_id subject_id token_hash issued_at expires_at revoked_at csrf_token_hash",
    "session_id tenant_id subject_id token_hash issued_at expires_at revoked_at csrf_token_hash",
    "session_id tenant_id subject_id token_hash issued_at expires_at csrf_token_hash",
    "revoked_at"),
  table("scada_external_identities",
    "issuer subject tenant_id subject_id created_at",
    "issuer subject tenant_id subject_id"),
  table("scada_oidc_transactions",
    "state_hash issuer nonce verifier_ciphertext browser_binding_hash return_path created_at expires_at consumed_at",
    "state_hash issuer nonce verifier_ciphertext browser_binding_hash return_path created_at expires_at consumed_at",
    "state_hash issuer nonce verifier_ciphertext browser_binding_hash return_path created_at expires_at",
    "consumed_at"),
  table("scada_tag_history_batches",
    "tenant_id project_id stream_id batch_sequence format_version record_count created_at",
    "tenant_id project_id stream_id batch_sequence format_version record_count",
    "tenant_id project_id stream_id batch_sequence format_version record_count"),
  table("scada_tag_history_records",
    "tenant_id project_id stream_id batch_sequence ordinal tag_id timestamp_ms payload",
    "tenant_id project_id stream_id batch_sequence ordinal tag_id timestamp_ms payload",
    "tenant_id project_id stream_id batch_sequence ordinal tag_id timestamp_ms payload"),
];

const startupColumns = ["tenant_id", "project_id", "head_revision"];
const allowedLockTables = [
  "scada_identities",
  "scada_project_grants",
  "scada_project_versions",
  "scada_project_release_state",
  "scada_project_release_events",
];

// 对混合关系目录使用 CASE，避免优化器调整过滤条件时对错误对象调用权限函数。
const privilegeSql = [
  'SELECT r.rolname::text AS role, c.relname::text AS "table", a.attname::text AS "column", c.relkind::text AS kind,',
  "  pg_catalog.pg_has_role(r.oid, c.relowner, 'USAGE') AS owner,",
  "  CASE WHEN c.relkind IN ('r','p') THEN pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') ELSE false END AS \"tableAccess\",",
  ...["SELECT", "INSERT", "UPDATE", "REFERENCES"].map((privilege) =>
    "  CASE WHEN c.relkind IN ('r','p') THEN pg_catalog.has_column_privilege(r.oid, c.oid, a.attnum, '" +
      privilege + "') ELSE false END AS \"" + privilege.toLowerCase() + "\","),
  "  CASE WHEN c.relkind IN ('r','p') THEN pg_catalog.has_column_privilege(r.oid, c.oid, a.attnum, 'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') ELSE false END AS grantable",
  "FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace",
  "JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid",
  "CROSS JOIN pg_catalog.pg_roles r",
  "WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND a.attnum > 0 AND NOT a.attisdropped",
  "AND r.rolname IN ('adui_scada_runtime','adui_scada_keycloak_runtime')",
  "ORDER BY r.rolname, c.relname, a.attnum",
].join("\n");

function requireMatch(condition) {
  if (!condition) {
    throw new DockerBusinessAclPreviewError("业务列权限与固定准备基线不一致，禁止生成授权候选");
  }
}

const key = (role, relation, column) => role + ":" + relation + ":" + column;

/** 固定清单仅供契约一致性测试；不暴露模块内部可变引用。 */
export function scadaBusinessColumnInventory() {
  return tables.map((entry) => ({ table: entry.name, columns: [...entry.columns] }));
}

/** 仅接受 B2 启动列权限基线；任何缺失、重复、多余或扩大权限均拒绝。 */
export function buildScadaBusinessAclPreview(rows) {
  const expected = new Map();
  for (const entry of tables) {
    for (const role of roles) {
      for (const column of entry.columns) {
        expected.set(key(role, entry.name, column),
          role === runtime && entry.name === "scada_projects" && startupColumns.includes(column));
      }
    }
  }
  const fields = ["role", "table", "column", "kind", "owner", "tableAccess", "select", "insert", "update", "references", "grantable"];
  requireMatch(expected.size === 170 && Array.isArray(rows) && rows.length === expected.size);
  for (const row of rows) {
    requireMatch(row && Object.keys(row).length === fields.length &&
      fields.every((field) => Object.hasOwn(row, field)) &&
      typeof row.role === "string" && typeof row.table === "string" && typeof row.column === "string");
    const id = key(row.role, row.table, row.column);
    requireMatch(expected.has(id) && row.kind === "r" && row.select === expected.get(id) &&
      row.owner === false && row.tableAccess === false && row.insert === false &&
      row.update === false && row.references === false && row.grantable === false);
    expected.delete(id);
  }
  requireMatch(expected.size === 0);

  const grants = tables.flatMap((entry) =>
    [
      { privilege: "SELECT", columns: entry.read.filter((column) =>
        entry.name !== "scada_projects" || !startupColumns.includes(column)) },
      { privilege: "INSERT", columns: entry.insert },
      { privilege: "UPDATE", columns: entry.update },
    ].filter((grant) => grant.columns.length > 0)
      .map((grant) => ({
        table: entry.name,
        privilege: grant.privilege,
        columns: [...grant.columns],
        sql: "GRANT " + grant.privilege + " (" + grant.columns.join(", ") +
          ") ON TABLE public." + entry.name + " TO adui_scada_runtime",
      })),
  );
  const blockedOperations = [
    ...allowedLockTables.map((relation) => ({ table: relation, operation: "ROW_LOCK", reason: "DEDICATED_LOCK_BOUNDARY_REQUIRED" })),
    { table: "scada_project_grants", operation: "INSERT", reason: "INITIAL_GRANT_SCOPE_REQUIRED" },
    { table: "scada_project_release_state", operation: "INSERT", reason: "INITIAL_STATE_SCOPE_REQUIRED" },
    { table: "scada_oidc_transactions", operation: "DELETE", reason: "EXPIRY_CLEANUP_SCOPE_REQUIRED" },
  ];
  const planFingerprint = createHash("sha256")
    .update(JSON.stringify({ grants, blockedOperations }))
    .digest("hex");
  return {
    status: "SCADA_BUSINESS_ACL_PREVIEW_ONLY",
    tableCount: tables.length,
    columnCount: rows.length / roles.length,
    effectiveColumnCount: rows.length,
    baselineSelectCount: startupColumns.length,
    grants,
    blockedOperations,
    lockRoutinePreview: buildScadaLockRoutinePreview(),
    planFingerprint,
    planOnly: true,
    rowAuthorizationVerified: false,
    rowLockVerified: false,
    businessAclApproved: false,
    admissionPassed: false,
    databaseWritten: false,
  };
}

/** 在现有固定只读事务内采集有效权限；不执行生成的候选语句。 */
export async function readScadaBusinessAclPreview(query) {
  const result = await query("业务列权限及最小授权候选", privilegeSql);
  return buildScadaBusinessAclPreview(result?.rows);
}
