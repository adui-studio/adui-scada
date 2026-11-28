export class DockerRoleReviewError extends Error {}

const databases = ["adui_scada", "adui_scada_keycloak"];
const businessTables = new Set([
  "scada_projects",
  "scada_project_grants",
  "scada_project_versions",
  "scada_project_audit",
  "scada_project_release_state",
  "scada_project_release_events",
  "scada_identities",
  "scada_auth_sessions",
  "scada_external_identities",
  "scada_oidc_transactions",
  "scada_tag_history_batches",
  "scada_tag_history_records",
]);
const invalid = "数据库角色只读核查结果不完整或身份不一致";
const identitySql = `SELECT current_database() AS database, current_user::text AS role,
  session_user::text AS "sessionRole", current_schema()::text AS schema,
  current_setting('server_version_num') AS version,
  (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "systemIdentifier",
  current_setting('transaction_read_only') AS "readOnly",
  current_setting('default_transaction_read_only') AS "defaultReadOnly",
  pg_catalog.pg_is_in_recovery() AS recovery`;
const roleSql = `WITH RECURSIVE memberships(oid) AS (
  SELECT m.roleid FROM pg_catalog.pg_auth_members m
  JOIN pg_catalog.pg_roles r ON r.oid = m.member WHERE r.rolname = current_user
  UNION
  SELECT m.roleid FROM pg_catalog.pg_auth_members m JOIN memberships p ON p.oid = m.member
)
SELECT r.rolsuper AS superuser, r.rolcreatedb AS "createDatabase", r.rolcreaterole AS "createRole",
  r.rolreplication AS replication, r.rolbypassrls AS "bypassRls", r.rolcanlogin AS login,
  r.rolinherit AS inherit,
  (SELECT count(DISTINCT m.roleid)::int FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid) AS "directMemberships",
  (SELECT count(*)::int FROM memberships) AS "reachableMemberships",
  (SELECT count(*)::int FROM memberships m WHERE pg_catalog.pg_has_role(r.oid, m.oid, 'USAGE')) AS "inheritedMemberships",
  (SELECT count(*)::int FROM memberships m WHERE pg_catalog.pg_has_role(r.oid, m.oid, 'SET')) AS "setRoleMemberships",
  EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'adui_scada_runtime') AS "scadaRuntimeExists",
  EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'adui_scada_keycloak_runtime') AS "keycloakRuntimeExists"
FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`;
const databaseSql = `SELECT d.datname AS name,
  d.datdba = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user) AS owner,
  pg_catalog.pg_has_role(d.datdba, 'USAGE') AS "ownerPrivileges",
  pg_catalog.has_database_privilege(d.oid, 'CONNECT') AS connect,
  pg_catalog.has_database_privilege(d.oid, 'CREATE') AS create,
  pg_catalog.has_database_privilege(d.oid, 'TEMPORARY') AS temporary,
  EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(d.datacl, pg_catalog.acldefault('d', d.datdba))) a
    WHERE a.grantee = 0 AND a.privilege_type = 'CONNECT') AS "publicConnect"
FROM pg_catalog.pg_database d WHERE d.datname IN ('adui_scada', 'adui_scada_keycloak')`;
const schemaSql = `SELECT n.nspname AS name,
  n.nspowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user) AS owner,
  pg_catalog.pg_has_role(n.nspowner, 'USAGE') AS "ownerPrivileges",
  pg_catalog.has_schema_privilege(n.oid, 'USAGE') AS usage,
  pg_catalog.has_schema_privilege(n.oid, 'CREATE') AS create,
  EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
    WHERE a.grantee = 0 AND a.privilege_type = 'CREATE') AS "publicCreate"
FROM pg_catalog.pg_namespace n WHERE n.nspname = ANY($1::text[])`;
const otherSchemasSql = `SELECT count(*)::int AS total FROM pg_catalog.pg_namespace n
WHERE left(n.nspname, 3) <> 'pg_' AND n.nspname <> 'information_schema'
  AND NOT (n.nspname = ANY($1::text[]))`;
const relationSql = `SELECT c.relname AS name,
  c.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user) AS owner,
  pg_catalog.pg_has_role(c.relowner, 'USAGE') AS "ownerPrivileges",
  pg_catalog.has_table_privilege(c.oid, 'SELECT') AS select,
  pg_catalog.has_table_privilege(c.oid, 'INSERT') AS insert,
  pg_catalog.has_table_privilege(c.oid, 'UPDATE') AS update,
  pg_catalog.has_table_privilege(c.oid, 'DELETE') AS delete,
  pg_catalog.has_table_privilege(c.oid, 'TRUNCATE') AS truncate,
  pg_catalog.has_table_privilege(c.oid, 'REFERENCES') AS references,
  pg_catalog.has_table_privilege(c.oid, 'TRIGGER') AS trigger,
  pg_catalog.has_table_privilege(c.oid, 'MAINTAIN') AS maintain,
  pg_catalog.has_any_column_privilege(c.oid, 'SELECT') AS "anyColumnSelect",
  pg_catalog.has_any_column_privilege(c.oid, 'INSERT') AS "anyColumnInsert",
  pg_catalog.has_any_column_privilege(c.oid, 'UPDATE') AS "anyColumnUpdate",
  pg_catalog.has_any_column_privilege(c.oid, 'REFERENCES') AS "anyColumnReferences"
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`;
const sequenceSql = `SELECT c.relname AS name,
  c.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user) AS owner,
  pg_catalog.pg_has_role(c.relowner, 'USAGE') AS "ownerPrivileges",
  pg_catalog.has_sequence_privilege(c.oid, 'USAGE') AS usage,
  pg_catalog.has_sequence_privilege(c.oid, 'SELECT') AS select,
  pg_catalog.has_sequence_privilege(c.oid, 'UPDATE') AS update
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'S'`;
const markerSql = `SELECT core_hash::text AS "storageHash",
  pg_catalog.has_table_privilege('prisma_contract.marker', 'SELECT') AS "markerSelect",
  pg_catalog.has_function_privilege('pg_catalog.pg_control_system()', 'EXECUTE') AS "clusterFunctionExecute"
FROM prisma_contract.marker WHERE space = 'app'`;
const roleFlags = [
  "superuser",
  "createDatabase",
  "createRole",
  "replication",
  "bypassRls",
  "login",
  "inherit",
  "scadaRuntimeExists",
  "keycloakRuntimeExists",
];
const membershipCounts = [
  "directMemberships",
  "reachableMemberships",
  "inheritedMemberships",
  "setRoleMemberships",
];
const databaseFlags = [
  "owner",
  "ownerPrivileges",
  "connect",
  "create",
  "temporary",
  "publicConnect",
];
const schemaFlags = ["owner", "ownerPrivileges", "usage", "create", "publicCreate"];
const tableFlags = [
  "owner",
  "ownerPrivileges",
  "select",
  "insert",
  "update",
  "delete",
  "truncate",
  "references",
  "trigger",
  "maintain",
  "anyColumnSelect",
  "anyColumnInsert",
  "anyColumnUpdate",
  "anyColumnReferences",
];
const sequenceFlags = ["owner", "ownerPrivileges", "usage", "select", "update"];

function requireReview(condition) {
  if (!condition) throw new DockerRoleReviewError(invalid);
}

function booleanFields(row, fields) {
  requireReview(
    row && fields.every((field) => Object.hasOwn(row, field) && typeof row[field] === "boolean"),
  );
  return Object.fromEntries(fields.map((field) => [field, row[field]]));
}

function single(rows) {
  requireReview(Array.isArray(rows) && rows.length === 1 && rows[0]);
  return rows[0];
}

function namedRows(rows, names, flags) {
  requireReview(Array.isArray(rows) && rows.length === names.size);
  const result = {};
  for (const row of rows) {
    requireReview(row && names.has(row.name) && !Object.hasOwn(result, row.name));
    result[row.name] = booleanFields(row, flags);
  }
  return result;
}

function relationCounts(rows, fields) {
  requireReview(Array.isArray(rows));
  const names = new Set();
  const counts = Object.fromEntries(fields.map((field) => [field, 0]));
  for (const row of rows) {
    requireReview(
      row && typeof row.name === "string" && row.name.length > 0 && !names.has(row.name),
    );
    names.add(row.name);
    const values = booleanFields(row, fields);
    for (const field of fields) if (values[field]) counts[field] += 1;
  }
  return { total: rows.length, ...counts };
}

function verifyIdentity(rows, database, expected) {
  const row = single(rows);
  requireReview(
    row.database === database &&
      row.role === "adui_scada" &&
      row.sessionRole === "adui_scada" &&
      row.schema === "public" &&
      row.version === expected.version &&
      row.systemIdentifier === expected.systemIdentifier &&
      row.readOnly === "on" &&
      row.defaultReadOnly === "on" &&
      row.recovery === false,
  );
}

function reviewRole(rows) {
  const row = single(rows);
  const role = booleanFields(row, roleFlags);
  for (const field of membershipCounts) {
    const value = row[field];
    requireReview(Number.isSafeInteger(value) && value >= 0);
    role[field] = value;
  }
  requireReview(
    role.login &&
      role.directMemberships <= role.reachableMemberships &&
      role.inheritedMemberships <= role.reachableMemberships &&
      role.setRoleMemberships <= role.reachableMemberships,
  );
  return role;
}

/** 每个库独立只读事务，固定查询目录并核对前后身份；所有原始异常均脱敏。 */
async function inspectDatabase(createClient, database, expected, storageHash) {
  const label = database === databases[0] ? "业务库" : "Keycloak 库";
  let client;
  let begun = false;
  let stage = "连接";
  let failure;
  let report;
  try {
    client = createClient(database);
    await client.connect();
    stage = "只读事务";
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    begun = true;
    stage = "身份核验";
    verifyIdentity((await client.query(identitySql)).rows, database, expected);
    stage = "角色及目录核验";
    const role = reviewRole((await client.query(roleSql)).rows);
    const access = namedRows(
      (await client.query(databaseSql)).rows,
      new Set(databases),
      databaseFlags,
    );
    const business = database === databases[0];
    const schemaNames = business ? ["public", "prisma_contract"] : ["public"];
    const schemas = namedRows(
      (await client.query(schemaSql, [schemaNames])).rows,
      new Set(schemaNames),
      schemaFlags,
    );
    const otherSchemas = single((await client.query(otherSchemasSql, [schemaNames])).rows).total;
    requireReview(Number.isSafeInteger(otherSchemas) && otherSchemas >= 0);
    const tables = (await client.query(relationSql)).rows;
    const tableAccess = relationCounts(tables, tableFlags);
    requireReview(business ? tableAccess.total === businessTables.size : tableAccess.total > 0);
    const tableMatrix = business ? namedRows(tables, businessTables, tableFlags) : null;
    const sequences = relationCounts((await client.query(sequenceSql)).rows, sequenceFlags);
    let marker = null;
    if (business) {
      const row = single((await client.query(markerSql)).rows);
      requireReview(row.storageHash === storageHash);
      marker = booleanFields(row, ["markerSelect", "clusterFunctionExecute"]);
      requireReview(marker.markerSelect && marker.clusterFunctionExecute);
    }
    stage = "后置身份核验";
    verifyIdentity((await client.query(identitySql)).rows, database, expected);
    stage = "事务结束";
    await client.query("ROLLBACK");
    begun = false;
    report = { role, access, schemas, otherSchemas, tableAccess, tableMatrix, sequences, marker };
  } catch {
    failure = new DockerRoleReviewError(label + stage + "失败，内部诊断已脱敏，保留现场");
  }
  if (begun) {
    try {
      await client.query("ROLLBACK");
    } catch {
      failure ??= new DockerRoleReviewError(label + "只读事务回滚失败，保留现场");
    }
  }
  if (client) {
    try {
      await client.end();
    } catch {
      failure ??= new DockerRoleReviewError(label + "连接关闭失败，保留现场");
    }
  }
  if (failure) throw failure;
  return report;
}

/** 当前共享角色仅用于现状核查；任何结果都不得提升为正式业务连接准入。 */
export async function reviewDockerDatabaseRoles(createClient, expected, storageHash) {
  requireReview(
    expected &&
      typeof expected.version === "string" &&
      /^19[0-9]{4}$/u.test(expected.version) &&
      typeof expected.systemIdentifier === "string" &&
      /^[1-9][0-9]{0,19}$/u.test(expected.systemIdentifier) &&
      typeof storageHash === "string" &&
      /^[a-f0-9]{64}$/u.test(storageHash),
  );
  const business = await inspectDatabase(createClient, databases[0], expected, storageHash);
  const keycloak = await inspectDatabase(createClient, databases[1], expected, storageHash);
  requireReview(
    JSON.stringify(business.role) === JSON.stringify(keycloak.role) &&
      databases.every((name) =>
        databaseFlags.every((flag) => business.access[name][flag] === keycloak.access[name][flag]),
      ),
  );
  return {
    status: "DOCKER_DB_ROLE_REVIEW_READY",
    directoryReviewPassed: true,
    admissionPassed: false,
    role: business.role,
    databases: business.access,
    scada: {
      schemas: business.schemas,
      otherSchemas: business.otherSchemas,
      tables: business.tableAccess,
      tableMatrix: business.tableMatrix,
      sequences: business.sequences,
      marker: business.marker,
    },
    keycloak: {
      schemas: keycloak.schemas,
      otherSchemas: keycloak.otherSchemas,
      tables: keycloak.tableAccess,
      sequences: keycloak.sequences,
    },
    databaseWritten: false,
  };
}
