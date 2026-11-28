import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { buildDockerRoleBootstrapPlan } from "./docker-db-role-bootstrap-plan.mjs";

export class DockerRoleBootstrapError extends Error {}

const scada = "adui_scada_runtime";
const keycloak = "adui_scada_keycloak_runtime";
const names = [scada, keycloak];
const candidateSql =
  "SELECT oid, rolname FROM pg_catalog.pg_roles WHERE rolname IN ('adui_scada_runtime', 'adui_scada_keycloak_runtime')";
const attributesSql = `SELECT r.rolname::text AS role,
  NOT (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit)
    AND r.rolpassword IS NULL AS hardened,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE r.oid IN (m.roleid, m.member, m.grantor)) AS "noMemberships",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s WHERE s.setrole = r.oid) AS "noSettings",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_shdepend d WHERE d.refclassid = 'pg_catalog.pg_authid'::regclass
    AND d.refobjid = r.oid AND (d.deptype <> 'a' OR d.dbid NOT IN (0, (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database())))) AS "noUnexpectedDependencies"
FROM pg_catalog.pg_authid r WHERE r.rolname IN ('adui_scada_runtime', 'adui_scada_keycloak_runtime')`;
const aclSql = `WITH candidates AS (${candidateSql}), entries AS (
  SELECT 'database' AS kind, d.datname::text AS object, a.* FROM pg_catalog.pg_database d CROSS JOIN LATERAL pg_catalog.aclexplode(d.datacl) a
  UNION ALL SELECT 'schema', n.nspname::text, a.* FROM pg_catalog.pg_namespace n CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) a
  UNION ALL SELECT 'relation', pg_catalog.format('%I.%I', n.nspname, c.relname), a.* FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
  UNION ALL SELECT 'column', pg_catalog.format('%I.%I.%I', n.nspname, c.relname, f.attname), a.* FROM pg_catalog.pg_attribute f
    JOIN pg_catalog.pg_class c ON c.oid = f.attrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(f.attacl) a WHERE f.attnum > 0 AND NOT f.attisdropped
  UNION ALL SELECT 'function', CASE WHEN p.oid = 'pg_catalog.pg_control_system()'::regprocedure
    THEN 'pg_catalog.pg_control_system()' ELSE p.oid::text END, a.*
    FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
) SELECT r.rolname::text AS role, e.kind, e.object, e.privilege_type AS privilege, e.is_grantable AS grantable
FROM entries e JOIN candidates r ON r.oid = e.grantee`;
const effectiveSql = `WITH candidates AS (${candidateSql}), relations AS (
  SELECT c.oid, c.relkind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'prisma_contract')
)
SELECT r.rolname::text AS role,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database d WHERE pg_catalog.has_database_privilege(r.oid, d.oid, 'CREATE')) AS "noDatabaseCreate",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname IN ('public', 'prisma_contract') AND pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE')) AS "noSchemaCreate",
  NOT EXISTS (SELECT 1 FROM relations c WHERE c.relkind IN ('r','p','v','m','f') AND (
    pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR
    pg_catalog.has_any_column_privilege(r.oid, c.oid, 'INSERT,UPDATE,REFERENCES'))) AS "noTableOrColumnWrites",
  NOT EXISTS (SELECT 1 FROM relations c WHERE c.relkind = 'S' AND pg_catalog.has_sequence_privilege(r.oid, c.oid, 'USAGE,SELECT,UPDATE')) AS "noSequencePrivileges",
  pg_catalog.has_database_privilege(r.oid, 'adui_scada', 'CONNECT') AS "businessConnect",
  pg_catalog.has_database_privilege(r.oid, 'adui_scada_keycloak', 'CONNECT') AS "keycloakConnect"
FROM candidates r`;
const effectiveColumnsSql = `WITH candidates AS (${candidateSql})
SELECT r.rolname::text AS role, pg_catalog.format('%I.%I.%I', n.nspname, c.relname, a.attname) AS object
FROM candidates r CROSS JOIN pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE n.nspname IN ('public', 'prisma_contract') AND c.relkind IN ('r','p','v','m','f')
  AND pg_catalog.has_column_privilege(r.oid, c.oid, a.attnum, 'SELECT')`;
const lockedSql =
  "SELECT pg_catalog.pg_try_advisory_xact_lock(839572941652::bigint) AS locked, current_setting('transaction_isolation') AS isolation";
const probeSql = `SELECT current_user::text AS role, session_user::text AS "sessionRole", current_database() AS database,
  (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "systemIdentifier",
  (SELECT core_hash::text FROM prisma_contract.marker WHERE space = 'app') AS "storageHash"`;
const probeProjectSql =
  "SELECT tenant_id, project_id, head_revision FROM public.scada_projects WHERE tenant_id = $1 AND project_id = $1 LIMIT 1";
const allowedColumns = [
  "public.scada_projects.tenant_id",
  "public.scada_projects.project_id",
  "public.scada_projects.head_revision",
  "prisma_contract.marker.space",
  "prisma_contract.marker.core_hash",
];
const acl = (role, kind, object, privilege) => ({
  role,
  kind,
  object,
  privilege,
  grantable: false,
});
const expectedAcl = [
  acl(scada, "database", "adui_scada", "CONNECT"),
  acl(keycloak, "database", "adui_scada_keycloak", "CONNECT"),
  acl(scada, "schema", "public", "USAGE"),
  acl(scada, "schema", "prisma_contract", "USAGE"),
  ...allowedColumns.map((column) => acl(scada, "column", column, "SELECT")),
  acl(scada, "function", "pg_catalog.pg_control_system()", "EXECUTE"),
];

function requireMatch(condition) {
  if (!condition) throw new DockerRoleBootstrapError("角色准备事务证据不一致");
}

function exactRows(rows, expected) {
  return (
    Array.isArray(rows) &&
    rows.length === expected.length &&
    expected.every((item) => rows.some((row) => isDeepStrictEqual(row, item)))
  );
}

function businessView(report, prepared) {
  return {
    role: { ...report.role, scadaRuntimeExists: prepared, keycloakRuntimeExists: prepared },
    databases: report.databases,
    scada: report.scada,
  };
}

/** 在当前事务验证不可登录属性、精确 ACL、有效权限及真实角色读取，不启用登录。 */
async function verifyPrepared(client, identity, storageHash) {
  requireMatch(
    exactRows(
      (await client.query(attributesSql)).rows,
      names.map((role) => ({
        role,
        hardened: true,
        noMemberships: true,
        noSettings: true,
        noUnexpectedDependencies: true,
      })),
    ),
  );
  requireMatch(exactRows((await client.query(aclSql)).rows, expectedAcl));
  requireMatch(
    exactRows(
      (await client.query(effectiveSql)).rows,
      names.map((role) => ({
        role,
        noDatabaseCreate: true,
        noSchemaCreate: true,
        noTableOrColumnWrites: true,
        noSequencePrivileges: true,
        businessConnect: true,
        keycloakConnect: true,
      })),
    ),
  );
  requireMatch(
    exactRows(
      (await client.query(effectiveColumnsSql)).rows,
      allowedColumns.map((object) => ({ role: scada, object })),
    ),
  );
  await client.query("SET LOCAL ROLE adui_scada_runtime");
  requireMatch(
    exactRows((await client.query(probeSql)).rows, [
      {
        role: scada,
        sessionRole: "adui_scada",
        database: "adui_scada",
        systemIdentifier: identity.systemIdentifier,
        storageHash,
      },
    ]),
  );
  const scope = "prisma8-role-bootstrap-" + randomUUID();
  requireMatch(exactRows((await client.query(probeProjectSql, [scope])).rows, []));
  await client.query("SET LOCAL ROLE NONE");
}

/** 只接受已复核的双库报告，固定 SQL 从共享预览生成；状态查询绝不执行写入。 */
export async function runDockerRoleBootstrap({
  mode,
  createClient,
  readDirectory,
  report,
  identity,
  storageHash,
}) {
  requireMatch(["rehearse", "create", "status"].includes(mode));
  requireMatch(
    identity?.version === "190000" &&
      typeof identity.systemIdentifier === "string" &&
      /^[1-9][0-9]{0,19}$/u.test(identity.systemIdentifier),
  );
  const statusOnly = mode === "status";
  const prepared =
    statusOnly &&
    report?.role?.scadaRuntimeExists === true &&
    report.role.keycloakRuntimeExists === true;
  const baseline = prepared
    ? {
        ...report,
        role: { ...report.role, scadaRuntimeExists: false, keycloakRuntimeExists: false },
      }
    : report;
  const plan = buildDockerRoleBootstrapPlan(baseline, storageHash);
  const result = {
    status: "DOCKER_DB_ROLE_BOOTSTRAP_STATUS_READY",
    rolesPrepared: prepared,
    committed: false,
    rolledBack: false,
    catalogStatementsExecuted: false,
    admissionPassed: false,
    databaseWritten: false,
    businessDataWritten: false,
    serviceSwitched: false,
    publicConnectRetained: true,
    storageHash,
  };
  if (statusOnly && !prepared) return result;
  let client;
  let begun = false;
  let commitAttempted = false;
  let committed = false;
  let stage = "连接";
  let failure;
  try {
    client = createClient();
    await client.connect();
    stage = "事务启动";
    await client.query(
      statusOnly
        ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
        : "BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE",
    );
    begun = true;
    if (!statusOnly) {
      stage = "独立执行锁";
      requireMatch(
        exactRows((await client.query(lockedSql)).rows, [
          { locked: true, isolation: "serializable" },
        ]),
      );
    }
    stage = "事务内基线核验";
    requireMatch(
      isDeepStrictEqual(
        await readDirectory(client, identity, storageHash, statusOnly),
        businessView(report, prepared),
      ),
    );
    if (!statusOnly) {
      stage = "固定角色及授权语句";
      for (const sql of plan.sqlPreview) await client.query(sql);
    }
    stage = "角色属性、精确授权及有效权限核验";
    await verifyPrepared(client, identity, storageHash);
    stage = "后置事务身份及目录核验";
    requireMatch(
      isDeepStrictEqual(
        await readDirectory(client, identity, storageHash, statusOnly),
        businessView(report, true),
      ),
    );
    if (mode === "create") {
      commitAttempted = true;
      requireMatch((await client.query("COMMIT")).command === "COMMIT");
      committed = true;
    } else {
      stage = "事务回滚";
      requireMatch((await client.query("ROLLBACK")).command === "ROLLBACK");
    }
    begun = false;
  } catch {
    failure = commitAttempted
      ? "角色事务提交结果未知，禁止重试，请先执行只读状态核查"
      : "角色准备" + stage + "失败，内部诊断已脱敏，保留现场";
  }
  if (begun && !commitAttempted) {
    try {
      requireMatch((await client.query("ROLLBACK")).command === "ROLLBACK");
    } catch {
      failure = (failure ?? "角色准备失败") + "；回滚未确认，禁止重试";
    }
  }
  if (client) {
    try {
      await client.end();
    } catch {
      failure =
        (failure ?? (committed ? "角色事务已提交" : "角色准备")) + "；连接关闭失败，保留现场";
    }
  }
  if (failure) throw new DockerRoleBootstrapError(failure);
  return {
    ...result,
    status: statusOnly
      ? result.status
      : committed
        ? "DOCKER_DB_ROLE_BOOTSTRAP_CREATED"
        : "DOCKER_DB_ROLE_BOOTSTRAP_REHEARSED",
    rolesPrepared: statusOnly || committed,
    committed,
    rolledBack: !committed,
    catalogStatementsExecuted: !statusOnly,
    databaseWritten: committed,
  };
}
