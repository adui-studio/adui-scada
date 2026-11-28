import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { buildB4KeycloakDependencyScope, verifyB4KeycloakDependencyScope } from "./docker-db-role-b4-phase.mjs";
import { readKeycloakInstalledOwnership } from "./docker-db-role-keycloak-plan.mjs";
import {
  scadaBusinessColumnInventory,
  scadaBusinessGrantCandidates,
} from "./docker-db-role-business-acl.mjs";
import { buildScadaLockRoutinePreview } from "./docker-db-role-lock-routines.mjs";
import { verifyScadaB4InstalledRoutines } from "./docker-db-role-b4-routine-review.mjs";
import {
  buildScadaOidcCleanupRoutinePreview,
  buildScadaRestrictedWritePreview,
} from "./docker-db-role-restricted-writes.mjs";

export class DockerB4PermissionReviewError extends Error {}

const runtime = "adui_scada_runtime";
const keycloak = "adui_scada_keycloak_runtime";
const lockOwner = "adui_scada_lock_owner";
const projectOwner = "adui_scada_project_create_owner";
const cleanupOwner = "adui_scada_oidc_cleanup_owner";
const owners = [lockOwner, projectOwner, cleanupOwner];
const roles = [runtime, keycloak, ...owners];
const databases = ["adui_scada", "adui_scada_keycloak", "postgres", "template0", "template1"];
const tablePrivileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];
const columnPrivileges = ["SELECT", "INSERT", "UPDATE", "REFERENCES"];
const literals = (values) => values.map((value) => "'" + value + "'").join(", ");
const roleList = literals(roles);
const ownerList = literals(owners);
const candidates = `SELECT oid, rolname FROM pg_catalog.pg_roles WHERE rolname IN (${roleList})`;
const grant = (role, kind, object, privilege) => ({ role, kind, object, privilege, ownerGrant: true, grantable: false });

function requireMatch(condition, message) {
  if (!condition) throw new DockerB4PermissionReviewError(message);
}

function expectedConnect(role, database) {
  return (role === runtime && database === "adui_scada") ||
    (role === keycloak && database === "adui_scada_keycloak");
}

/** 从已审阅候选生成预期权限，不将合成目录当作实际读取证据。 */
export function buildScadaB4PermissionExpectations(port) {
  const locks = buildScadaLockRoutinePreview();
  const project = buildScadaRestrictedWritePreview().projectCreate;
  const cleanup = buildScadaOidcCleanupRoutinePreview(port);
  const inventory = scadaBusinessColumnInventory();
  const physical = new Set(inventory.flatMap(({ table, columns }) => columns.map((column) => "public." + table + "." + column)));
  const acl = [
    grant(runtime, "database", "adui_scada", "CONNECT"),
    grant(keycloak, "database", "adui_scada_keycloak", "CONNECT"),
    grant(runtime, "schema", "public", "USAGE"),
    grant(runtime, "schema", "prisma_contract", "USAGE"),
    grant(runtime, "function", "pg_catalog.pg_control_system()", "EXECUTE"),
    ...["public.scada_projects.tenant_id", "public.scada_projects.project_id", "public.scada_projects.head_revision",
      "prisma_contract.marker.space", "prisma_contract.marker.core_hash"].map((object) => grant(runtime, "column", object, "SELECT")),
  ];
  for (const item of scadaBusinessGrantCandidates()) {
    for (const column of item.columns) {
      const object = "public." + item.table + "." + column;
      requireMatch(physical.has(object) && columnPrivileges.includes(item.privilege), "B4 固定业务授权候选不一致");
      acl.push(grant(runtime, "column", object, item.privilege));
    }
  }
  // 仅解释模块内部的固定授权候选；不解析目录输入或执行 SQL。
  for (const [owner, statements] of [[lockOwner, locks.ownerGrants], [projectOwner, project.ownerGrants], [cleanupOwner, cleanup.ownerGrants]]) {
    requireMatch(owners.includes(owner), "B4 固定所有者候选不一致");
    for (const statement of statements) {
      if (statement === "GRANT USAGE ON SCHEMA public TO " + owner) {
        acl.push(grant(owner, "schema", "public", "USAGE"));
      } else if (owner === projectOwner && statement === "GRANT EXECUTE ON FUNCTION public.scada_lock_identity(text, text) TO " + owner) {
        // public 例程 ACL 由独立例程目录核验覆盖。
      } else if (owner === cleanupOwner && statement === "GRANT DELETE ON TABLE public.scada_oidc_transactions TO " + owner) {
        acl.push(grant(owner, "relation", "public.scada_oidc_transactions", "DELETE"));
      } else {
        const match = statement.match(/^GRANT (SELECT|INSERT|UPDATE) \(([a-z_, ]+)\) ON TABLE public\.(scada_[a-z_]+) TO (adui_scada_[a-z_]+)$/u);
        requireMatch(match && match[4] === owner, "B4 固定所有者授权候选不一致");
        for (const column of match[2].split(", ")) {
          const object = "public." + match[3] + "." + column;
          requireMatch(physical.has(object), "B4 固定所有者物理列不一致");
          acl.push(grant(owner, "column", object, match[1]));
        }
      }
    }
  }
  requireMatch(new Set(acl.map((row) => JSON.stringify(row))).size === acl.length, "B4 固定授权候选存在重复项");
  const allowed = (role, kind, object, privileges) => privileges.filter((privilege) =>
    acl.some((entry) => entry.role === role && entry.kind === kind && entry.object === object && entry.privilege === privilege));
  return {
    roles: roles.map((role) => ({ role, managerVerified: true, hardened: true, noMemberships: true,
      noSettings: true, noUnexpectedDependencies: true, trustedSchemas: true, noUnexpectedSchemaCreators: true,
      noPublicSchemaCreate: true, noDatabaseOwnerMemberships: true, noSchemaCreate: true, requiredPublicUsage: true,
      markerUsage: role === runtime, noSchemaGrantOption: true, noUnexpectedSchemaUsage: true,
      noSequenceAccess: true, noDefaultAcl: true, clusterFunctionExecute: role === runtime })),
    databases: roles.flatMap((role) => databases.map((database) => ({ role, database,
      connect: expectedConnect(role, database), create: false, temporary: false, grantable: false }))),
    acl,
    relations: roles.flatMap((role) => inventory.map(({ table }) => ({ role, schema: "public", table, kind: "r", owner: false,
      privileges: allowed(role, "relation", "public." + table, tablePrivileges), grantable: false }))),
    columns: [
      ...roles.flatMap((role) => inventory.flatMap(({ table, columns }) => columns.map((column) => ({
        role, schema: "public", table, column, kind: "r",
        privileges: allowed(role, "column", "public." + table + "." + column, columnPrivileges), grantable: false,
      })))),
      ...["space", "core_hash"].map((column) => ({ role: runtime, schema: "prisma_contract", table: "marker", column,
        kind: "r", privileges: ["SELECT"], grantable: false })),
    ],
  };
}

// 仅允许已经核验的本机管理身份；三个专用所有者不得登录、继承或持有跨库依赖。
const rolesSql = (scope) => `SELECT r.rolname::text AS role,
  (current_user = 'adui_scada' AND session_user = 'adui_scada' AND current_database() = 'adui_scada'
    AND current_setting('server_version_num') = '190000'
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles a JOIN pg_catalog.pg_database d ON d.datdba = a.oid
      WHERE a.rolname = 'adui_scada' AND a.rolsuper AND d.datname = current_database())) AS "managerVerified",
  (NOT (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit)
    AND r.rolpassword IS NULL) AS hardened,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE r.oid IN (m.roleid, m.member, m.grantor)) AS "noMemberships",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s WHERE s.setrole = r.oid) AS "noSettings",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_shdepend d WHERE d.refclassid = 'pg_catalog.pg_authid'::regclass AND d.refobjid = r.oid AND NOT (
    (d.dbid = 0 AND d.deptype = 'a' AND d.classid = 'pg_catalog.pg_database'::regclass AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_database b WHERE b.oid = d.objid AND ((r.rolname = '${runtime}' AND b.datname = 'adui_scada')
        OR (r.rolname = '${keycloak}' AND b.datname = 'adui_scada_keycloak')))) OR
    (d.dbid = (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database()) AND (
      (d.deptype = 'a' AND d.classid IN ('pg_catalog.pg_namespace'::regclass, 'pg_catalog.pg_class'::regclass, 'pg_catalog.pg_proc'::regclass)) OR
      (d.deptype = 'o' AND d.classid = 'pg_catalog.pg_proc'::regclass AND r.rolname IN (${ownerList}) AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE p.oid = d.objid AND p.proowner = r.oid AND n.nspname = 'public'))))${scope?.allowedDependency ?? ""})) AS "noUnexpectedDependencies",
  (SELECT count(*) = 2 FROM pg_catalog.pg_namespace n JOIN pg_catalog.pg_roles a ON a.oid = n.nspowner
    WHERE (n.nspname = 'public' AND a.rolname IN ('adui_scada', 'pg_database_owner'))
      OR (n.nspname = 'pg_catalog' AND a.rolname = 'adui_scada')) AS "trustedSchemas",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n CROSS JOIN pg_catalog.pg_roles a
    WHERE n.nspname IN ('public', 'pg_catalog') AND a.rolname <> 'adui_scada'
      AND NOT (n.nspname = 'public' AND a.rolname = 'pg_database_owner')
      AND pg_catalog.has_schema_privilege(a.oid, n.oid, 'CREATE')) AS "noUnexpectedSchemaCreators",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
    WHERE n.nspname IN ('public', 'pg_catalog') AND a.grantee = 0 AND a.privilege_type = 'CREATE') AS "noPublicSchemaCreate",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles a ON a.oid IN (m.roleid, m.member, m.grantor)
    WHERE a.rolname = 'pg_database_owner') AS "noDatabaseOwnerMemberships",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE')) AS "noSchemaCreate",
  (r.rolname = '${keycloak}' OR pg_catalog.has_schema_privilege(r.oid, 'public', 'USAGE')) AS "requiredPublicUsage",
  pg_catalog.has_schema_privilege(r.oid, 'prisma_contract', 'USAGE') AS "markerUsage",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE WITH GRANT OPTION,USAGE WITH GRANT OPTION')) AS "noSchemaGrantOption",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE left(n.nspname, 3) <> 'pg_' AND n.nspname NOT IN ('information_schema', 'public', 'prisma_contract')
    AND pg_catalog.has_schema_privilege(r.oid, n.oid, 'USAGE')) AS "noUnexpectedSchemaUsage",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE left(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema' AND CASE WHEN c.relkind = 'S' THEN
      pg_catalog.has_sequence_privilege(r.oid, c.oid, 'USAGE,SELECT,UPDATE') ELSE false END) AS "noSequenceAccess",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d WHERE d.defaclrole = r.oid) AS "noDefaultAcl",
  pg_catalog.has_function_privilege(r.oid, 'pg_catalog.pg_control_system()', 'EXECUTE') AS "clusterFunctionExecute"
FROM pg_catalog.pg_authid r WHERE r.rolname IN (${roleList})`;

const databaseSql = `WITH candidates AS (${candidates})
SELECT r.rolname::text AS role, d.datname::text AS database,
  pg_catalog.has_database_privilege(r.oid, d.oid, 'CONNECT') AS connect,
  pg_catalog.has_database_privilege(r.oid, d.oid, 'CREATE') AS create,
  pg_catalog.has_database_privilege(r.oid, d.oid, 'TEMPORARY') AS temporary,
  pg_catalog.has_database_privilege(r.oid, d.oid, 'CONNECT WITH GRANT OPTION,CREATE WITH GRANT OPTION,TEMPORARY WITH GRANT OPTION') AS grantable
FROM candidates r CROSS JOIN pg_catalog.pg_database d`;

// 直接 ACL 不按预期对象、权限或授权主体预过滤；public 例程由独立核验负责。
const aclSql = `WITH candidates AS (${candidates}), entries AS (
  SELECT 'database' AS kind, d.datname::text AS object, d.datdba AS owner, a.* FROM pg_catalog.pg_database d CROSS JOIN LATERAL pg_catalog.aclexplode(d.datacl) a
  UNION ALL SELECT 'schema', n.nspname::text, n.nspowner, a.* FROM pg_catalog.pg_namespace n CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) a
  UNION ALL SELECT 'relation', pg_catalog.format('%I.%I', n.nspname, c.relname), c.relowner, a.* FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
  UNION ALL SELECT 'column', pg_catalog.format('%I.%I.%I', n.nspname, c.relname, f.attname), c.relowner, a.*
    FROM pg_catalog.pg_attribute f JOIN pg_catalog.pg_class c ON c.oid = f.attrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(f.attacl) a WHERE f.attnum > 0 AND NOT f.attisdropped
  UNION ALL SELECT 'function', n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')', p.proowner, a.*
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE n.nspname <> 'public'
) SELECT CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE r.rolname::text END AS role, e.kind, e.object,
  e.privilege_type AS privilege, e.grantor = e.owner AS "ownerGrant", e.is_grantable AS grantable
FROM entries e LEFT JOIN pg_catalog.pg_roles r ON r.oid = e.grantee
WHERE e.grantee IN (SELECT oid FROM candidates) OR e.grantor IN (SELECT oid FROM candidates)`;

const relationKinds = "c.relkind IN ('r','p','v','m','f')";
const relationScope = "left(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema'";
function privilegeArray(kind, args, privileges) {
  return "pg_catalog.array_remove(ARRAY[" + privileges.map((privilege) =>
    "CASE WHEN " + relationKinds + " THEN CASE WHEN pg_catalog.has_" + kind + "_privilege(" + args + ", '" + privilege + "') THEN '" + privilege + "'::text END END").join(", ") + "], NULL)";
}
function grantOption(kind, args, privileges) {
  return "CASE WHEN " + relationKinds + " THEN pg_catalog.has_" + kind + "_privilege(" + args + ", '" + privileges.map((privilege) => privilege + " WITH GRANT OPTION").join(",") + "') ELSE false END";
}
const relationSql = `WITH candidates AS (${candidates}), matrix AS (
  SELECT r.rolname::text AS role, n.nspname::text AS schema, c.relname::text AS "table", c.relkind::text AS kind,
    pg_catalog.pg_has_role(r.oid, c.relowner, 'USAGE') AS owner,
    ${privilegeArray("table", "r.oid, c.oid", tablePrivileges)} AS privileges,
    ${grantOption("table", "r.oid, c.oid", tablePrivileges)} AS grantable
  FROM candidates r CROSS JOIN pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE ${relationScope} AND ${relationKinds}
) SELECT * FROM matrix WHERE schema = 'public' OR owner OR cardinality(privileges) > 0 OR grantable`;
const columnSql = `WITH candidates AS (${candidates}), matrix AS (
  SELECT r.rolname::text AS role, n.nspname::text AS schema, c.relname::text AS "table", a.attname::text AS "column", c.relkind::text AS kind,
    ${privilegeArray("column", "r.oid, c.oid, a.attnum", columnPrivileges)} AS privileges,
    ${grantOption("column", "r.oid, c.oid, a.attnum", columnPrivileges)} AS grantable
  FROM candidates r CROSS JOIN pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE ${relationScope} AND ${relationKinds}
) SELECT * FROM matrix WHERE schema = 'public' OR cardinality(privileges) > 0 OR grantable`;

function exactRows(rows, expected, key) {
  if (!Array.isArray(rows) || rows.length !== expected.length) return false;
  const pending = new Map(expected.map((row) => [key(row), row]));
  if (pending.size !== expected.length) return false;
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const id = key(row);
    if (!pending.has(id) || !isDeepStrictEqual(row, pending.get(id))) return false;
    pending.delete(id);
  }
  return pending.size === 0;
}
const keyOf = (...fields) => (row) => JSON.stringify(fields.map((field) => row[field]));

/** 仅核验安装后目录；不创建角色、修改 ACL 或切换运行身份。 */
async function verifyInstalledPermissions(query, port, scope) {
  const expected = buildScadaB4PermissionExpectations(port);
  if (scope) {
    let rows;
    try { rows = (await query("B4 跨阶段共享所有权依赖", scope.sql))?.rows; }
    catch { throw new DockerB4PermissionReviewError("B4 跨阶段共享所有权依赖查询失败，内部诊断已脱敏"); }
    verifyB4KeycloakDependencyScope(rows, scope);
  }
  const checks = [
    ["专用角色属性及依赖", rolesSql(scope), expected.roles, keyOf("role")],
    ["全集群有效数据库权限", databaseSql, expected.databases, keyOf("role", "database")],
    ["精确直接授权", aclSql, expected.acl, keyOf("role", "kind", "object", "privilege")],
    ["有效关系权限", relationSql, expected.relations, keyOf("role", "schema", "table")],
    ["有效列权限", columnSql, expected.columns, keyOf("role", "schema", "table", "column")],
  ];
  for (const [step, sql, rows, key] of checks) {
    let result;
    try { result = await query("B4 安装后" + step, sql); }
    catch { throw new DockerB4PermissionReviewError("B4 安装后" + step + "查询失败，内部诊断已脱敏"); }
    requireMatch(exactRows(result?.rows, rows, key), "B4 安装后" + step + "不一致");
  }
  const catalogFingerprint = createHash("sha256").update(JSON.stringify(scope ? { expected, keycloakDependencies: scope.expected } : expected)).digest("hex");
  return {
    status: "SCADA_B4_PERMISSION_CATALOG_MATCHED", roleCount: expected.roles.length,
    databasePermissionCount: expected.databases.length, directAclCount: expected.acl.length,
    relationPermissionCount: expected.relations.length, columnPermissionCount: expected.columns.length,
    catalogFingerprint, permissionCatalogMatched: true, businessAclApproved: false,
    definerSafetyVerified: false, rowAuthorizationVerified: false, admissionPassed: false, databaseWritten: false,
  };
}

/** 原安装后门禁仅允许 Keycloak 未转移状态。 */
export async function verifyScadaB4InstalledPermissions(query, port) {
  return verifyInstalledPermissions(query, port);
}

/** 合并目录核验必须在调用者同一已核验事务内完成；不代表实际业务准入。 */
async function verifyInstalledCatalog(query, port, scope) {
  const permissions = await verifyInstalledPermissions(query, port, scope);
  const routines = await verifyScadaB4InstalledRoutines(query, port);
  return {
    status: "SCADA_B4_INSTALLED_CATALOG_MATCHED",
    permissions, routines,
    catalogFingerprint: createHash("sha256").update(JSON.stringify([permissions.catalogFingerprint, routines.catalogFingerprint])).digest("hex"),
    installedCatalogMatched: true, businessAclApproved: false, definerSafetyVerified: false,
    rowLockVerified: false, rowAuthorizationVerified: false, issuerBindingVerified: false,
    admissionPassed: false, databaseWritten: false,
  };
}

/** 原 SCADA 演练门禁不接受任何 Keycloak 所有权依赖。 */
export async function verifyScadaB4InstalledCatalog(query, port) {
  return verifyInstalledCatalog(query, port);
}

/** 两库安装后的只读目录投影；调用方须持有各自的固定只读事务及独立维护窗口。 */
export async function verifyScadaB4CompletedCatalog({ scadaQuery, keycloakQuery, context, port, expectedKeycloakPlanFingerprint }) {
  requireMatch(typeof scadaQuery === "function" && typeof keycloakQuery === "function" && scadaQuery !== keycloakQuery,
    "B4 跨阶段要求双库独立查询");
  buildScadaB4PermissionExpectations(port);
  const keycloakOwnership = await readKeycloakInstalledOwnership(keycloakQuery, context, expectedKeycloakPlanFingerprint);
  const scope = buildB4KeycloakDependencyScope(keycloakOwnership.tableOids, context.identity.systemIdentifier);
  const scada = await verifyInstalledCatalog(scadaQuery, port, scope);
  const keycloak = keycloakOwnership.report;
  return {
    status: "B4_DUAL_CATALOG_PROJECTION_MATCHED", scada, keycloak,
    keycloakSharedDependencyCount: scope.expected.length,
    catalogFingerprint: createHash("sha256").update(JSON.stringify([expectedKeycloakPlanFingerprint, scada.catalogFingerprint, keycloak.catalogFingerprint])).digest("hex"),
    catalogProjectionMatched: true, crossDatabaseAtomicSnapshotVerified: false,
    installationAllowed: false, ownershipTransferAllowed: false, schemaEvolutionVerified: false,
    runtimeLoginAllowed: false, businessAclApproved: false, admissionPassed: false,
    databaseWritten: false, serviceSwitched: false,
  };
}
