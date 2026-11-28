export class DockerRoleIsolationError extends Error {}

const databaseSql = `SELECT d.oid::text AS oid,
  CASE WHEN d.datname IN ('adui_scada', 'adui_scada_keycloak', 'postgres', 'template0', 'template1')
    THEN d.datname::text ELSE NULL END AS name,
  d.datdba::text AS "ownerOid", d.datallowconn AS "allowConnections",
  d.datistemplate AS template, d.datconnlimit AS "connectionLimit",
  d.datacl IS NULL AS "defaultAcl",
  (SELECT count(*)::int FROM pg_catalog.aclexplode(coalesce(d.datacl, pg_catalog.acldefault('d', d.datdba)))) AS "aclEntryCount"
FROM pg_catalog.pg_database d ORDER BY d.oid`;
const roleSql = `SELECT r.oid::text AS oid,
  CASE WHEN r.rolname IN ('adui_scada', 'adui_scada_runtime', 'adui_scada_keycloak_runtime', 'pg_database_owner')
    THEN r.rolname::text ELSE NULL END AS name,
  r.rolcanlogin AS login, r.rolsuper AS superuser, r.rolinherit AS inherit
FROM pg_catalog.pg_roles r ORDER BY r.oid`;
const aclSql = `SELECT d.oid::text AS "databaseOid", a.grantor::text AS "grantorOid",
  a.grantee::text AS "granteeOid", a.privilege_type AS privilege, a.is_grantable AS grantable
FROM pg_catalog.pg_database d
CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(d.datacl, pg_catalog.acldefault('d', d.datdba))) a
ORDER BY d.oid, a.grantee, a.grantor, a.privilege_type`;
const effectiveSql = `SELECT d.oid::text AS "databaseOid", r.oid::text AS "roleOid",
  pg_catalog.has_database_privilege(r.oid, d.oid, 'CONNECT') AS connect,
  pg_catalog.has_database_privilege(r.oid, d.oid, 'TEMPORARY') AS temporary,
  pg_catalog.has_database_privilege(r.oid, d.oid, 'CREATE') AS create
FROM pg_catalog.pg_database d CROSS JOIN pg_catalog.pg_roles r ORDER BY d.oid, r.oid`;
const membershipSql = `SELECT m.roleid::text AS "roleOid", m.member::text AS "memberOid",
  m.grantor::text AS "grantorOid", m.admin_option AS admin,
  m.inherit_option AS inherit, m.set_option AS "setRole"
FROM pg_catalog.pg_auth_members m ORDER BY m.roleid, m.member, m.grantor`;
const sessionsSql = `SELECT a.datid::text AS "databaseOid", a.usesysid::text AS "roleOid",
  count(*)::int AS total FROM pg_catalog.pg_stat_activity a
WHERE a.backend_type = 'client backend' GROUP BY a.datid, a.usesysid ORDER BY a.datid, a.usesysid`;
const databases = ["adui_scada", "adui_scada_keycloak", "postgres", "template0", "template1"];
const roles = ["adui_scada", "adui_scada_runtime", "adui_scada_keycloak_runtime", "pg_database_owner"];
const privileges = ["CONNECT", "TEMPORARY", "CREATE"];
const oid = (value) =>
  typeof value === "string" && /^[1-9][0-9]{0,9}$/u.test(value) && Number(value) <= 4294967295;
const bool = (value) => typeof value === "boolean";
const label = (allowed) => (value) => value === null || allowed.includes(value);

function requireInventory(condition, step) {
  if (!condition) throw new DockerRoleIsolationError(step + "目录证据不完整或不一致");
}

function unique(rows, key, step) {
  const keys = new Set(rows.map(key));
  requireInventory(keys.size === rows.length, step);
  return keys;
}

/** 仅从既有已验证的只读事务调用固定查询；未知名称不进入报告。 */
export async function readDockerIsolationDirectory(query) {
  const read = async (step, sql, fields) => {
    const result = await query(step, sql);
    const rows = result?.rows;
    requireInventory(
      Array.isArray(rows) && rows.every((row) => row &&
        Object.keys(row).length === Object.keys(fields).length &&
        Object.entries(fields).every(([key, check]) => Object.hasOwn(row, key) && check(row[key]))),
      step,
    );
    return rows;
  };
  const db = await read("全集群数据库", databaseSql, {
    oid, name: label(databases), ownerOid: oid, allowConnections: bool, template: bool,
    connectionLimit: (value) => Number.isSafeInteger(value) && value >= -2,
    defaultAcl: bool,
    aclEntryCount: (value) => Number.isSafeInteger(value) && value >= 0,
  });
  const role = await read("全集群角色", roleSql, {
    oid, name: label(roles), login: bool, superuser: bool, inherit: bool,
  });
  const dbIds = unique(db, (row) => row.oid, "数据库标识");
  const roleIds = unique(role, (row) => row.oid, "角色标识");
  requireInventory(databases.every((name) => db.filter((row) => row.name === name).length === 1), "固定数据库");
  requireInventory(roles.every((name) => role.filter((row) => row.name === name).length === 1), "固定角色");
  requireInventory(db.every((row) => roleIds.has(row.ownerOid)), "数据库所有者");
  const dbRef = (value) => dbIds.has(value);
  const roleRef = (value) => roleIds.has(value);
  const acl = await read("数据库 ACL", aclSql, {
    databaseOid: dbRef, grantorOid: roleRef, granteeOid: (value) => value === "0" || roleRef(value),
    privilege: (value) => privileges.includes(value), grantable: bool,
  });
  unique(acl, (row) => JSON.stringify([row.databaseOid, row.grantorOid, row.granteeOid, row.privilege]), "数据库 ACL");
  requireInventory(
    db.every((row) => acl.filter((entry) => entry.databaseOid === row.oid).length === row.aclEntryCount),
    "数据库 ACL 行数",
  );
  const effective = await read("数据库有效权限", effectiveSql, {
    databaseOid: dbRef, roleOid: roleRef, connect: bool, temporary: bool, create: bool,
  });
  unique(effective, (row) => JSON.stringify([row.databaseOid, row.roleOid]), "数据库有效权限");
  requireInventory(effective.length === db.length * role.length, "全集群权限矩阵");
  const memberships = await read("角色成员关系", membershipSql, {
    roleOid: roleRef, memberOid: roleRef, grantorOid: roleRef, admin: bool, inherit: bool, setRole: bool,
  });
  unique(memberships, (row) => JSON.stringify([row.roleOid, row.memberOid, row.grantorOid]), "角色成员关系");
  const sessions = await read("当前客户端连接", sessionsSql, {
    databaseOid: (value) => value === null || oid(value), roleOid: (value) => value === null || oid(value),
    total: (value) => Number.isSafeInteger(value) && value > 0,
  });
  unique(sessions, (row) => JSON.stringify([row.databaseOid, row.roleOid]), "当前客户端连接");
  const unknownLoginRoleCount = role.filter((row) => row.name === null && row.login).length;
  const unknownDatabaseCount = db.filter((row) => row.name === null).length;
  const unresolvedSessionCount = sessions.filter((row) => !dbRef(row.databaseOid) || !roleRef(row.roleOid) ||
    role.some((item) => item.oid === row.roleOid && item.name !== "adui_scada") ||
    db.some((item) => item.oid === row.databaseOid && item.name === null))
    .reduce((total, row) => total + row.total, 0);
  return {
    databases: db.map((row) => ({ ...row,
      publicConnect: acl.some((entry) => entry.databaseOid === row.oid && entry.granteeOid === "0" && entry.privilege === "CONNECT"),
      publicTemporary: acl.some((entry) => entry.databaseOid === row.oid && entry.granteeOid === "0" && entry.privilege === "TEMPORARY"),
      publicCreate: acl.some((entry) => entry.databaseOid === row.oid && entry.granteeOid === "0" && entry.privilege === "CREATE"),
    })),
    roles: role, acl, effective, memberships, sessions,
    unknownLoginRoleCount, unknownDatabaseCount, unresolvedSessionCount,
    consumerReviewRequired: true, changeAllowed: false, isolationPassed: false,
  };
}
