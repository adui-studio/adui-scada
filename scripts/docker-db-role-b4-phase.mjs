import { isDeepStrictEqual } from "node:util";

const oidPattern = /^[1-9][0-9]{0,9}$/u;
const systemPattern = /^[1-9][0-9]{0,19}$/u;
const targetRole = "adui_scada_keycloak_runtime";

function requireMatch(condition, message) {
  if (!condition) throw new Error(message);
}

/** 仅为已审阅的 Keycloak 表所有权投影生成目录过滤条件，不构造写入语句。 */
export function buildB4KeycloakDependencyScope(tableOids, systemIdentifier) {
  requireMatch(
    Array.isArray(tableOids) &&
      tableOids.length === 101 &&
      Array.from(tableOids).every(
        (oid) => typeof oid === "string" && oidPattern.test(oid) && Number(oid) <= 4294967295,
      ) &&
      new Set(tableOids).size === tableOids.length &&
      typeof systemIdentifier === "string" &&
      systemPattern.test(systemIdentifier),
    "B4 跨阶段所有权投影标识无效",
  );
  const ids = [...tableOids].sort((left, right) => Number(left) - Number(right));
  const database = "(SELECT oid FROM pg_catalog.pg_database WHERE datname = 'adui_scada_keycloak')";
  const dependency = `d.dbid = ${database} AND d.classid = 'pg_catalog.pg_class'::regclass
    AND d.objsubid = 0 AND d.deptype = 'o' AND d.objid IN (${ids.map((oid) => oid + "::oid").join(", ")})`;
  return {
    allowedDependency: ` OR (r.rolname = '${targetRole}' AND ${dependency})`,
    sql: `SELECT d.objid::text AS "objectId", (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "systemIdentifier"
FROM pg_catalog.pg_shdepend d JOIN pg_catalog.pg_roles r ON r.oid = d.refobjid
WHERE d.refclassid = 'pg_catalog.pg_authid'::regclass AND r.rolname = '${targetRole}' AND ${dependency}
  AND current_database() = 'adui_scada' AND current_setting('transaction_read_only') = 'on'
  AND current_setting('transaction_isolation') = 'repeatable read'`,
    expected: ids.map((objectId) => ({ objectId, systemIdentifier })),
  };
}

/** 只接受确切的表身份集合；缺失、重复、额外对象和异集群全部拒绝。 */
export function verifyB4KeycloakDependencyScope(rows, scope) {
  const expected = scope.expected;
  requireMatch(
    Array.isArray(rows) &&
      rows.length === expected.length &&
      new Set(rows.map((row) => row?.objectId)).size === expected.length &&
      expected.every((entry) => rows.some((row) => isDeepStrictEqual(row, entry))),
    "B4 跨阶段 Keycloak 共享所有权依赖不一致",
  );
}
