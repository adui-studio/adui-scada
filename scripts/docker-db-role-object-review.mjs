import { createHash } from "node:crypto";
import { verifyDockerRoleObjectIdentity } from "./docker-db-role-review.mjs";
import { safeSqlState } from "./docker-db-role-bootstrap.mjs";
import { DockerBusinessAclPreviewError, readScadaBusinessAclPreview } from "./docker-db-role-business-acl.mjs";
import { DockerB4PreflightError, readScadaB4InstallPreflight } from "./docker-db-role-b4-preflight.mjs";

export class DockerRoleObjectReviewError extends Error {}

const rolesSql = "SELECT oid::text AS oid, rolname::text AS name, rolcanlogin AS login, rolsuper AS superuser, rolcreatedb AS \"createDatabase\", rolcreaterole AS \"createRole\", rolreplication AS replication, rolbypassrls AS \"bypassRls\", rolinherit AS inherit FROM pg_catalog.pg_roles WHERE rolname IN ('adui_scada', 'adui_scada_runtime', 'adui_scada_keycloak_runtime', 'pg_database_owner', 'adui_scada_lock_owner')";
const requiredRoles = ["adui_scada", "adui_scada_runtime", "adui_scada_keycloak_runtime", "pg_database_owner"];
const roleNames = [...requiredRoles, "adui_scada_lock_owner"];
const objectsSql = `WITH schemas AS (
  SELECT * FROM pg_catalog.pg_namespace WHERE nspname <> 'information_schema' AND left(nspname, 3) <> 'pg_'
), objects AS (
  SELECT 'schema' AS kind, n.oid::text AS id, n.nspowner::text AS owner,
    jsonb_build_array(n.nspname, n.nspacl::text) AS evidence FROM schemas n
  UNION ALL SELECT 'relation', c.oid::text, c.relowner::text,
    jsonb_build_array(n.nspname, c.relname, c.relkind::text, c.relacl::text, c.relrowsecurity, c.relforcerowsecurity)
    FROM pg_catalog.pg_class c JOIN schemas n ON c.relnamespace = n.oid
  UNION ALL SELECT 'columnAcl', c.oid::text || ':' || a.attnum::text, c.relowner::text,
    jsonb_build_array(n.nspname, c.relname, a.attname, a.attacl::text)
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN schemas n ON c.relnamespace = n.oid WHERE a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
  UNION ALL SELECT 'routine', p.oid::text, p.proowner::text,
    jsonb_build_array(n.nspname, p.proname, p.prokind::text, p.proacl::text, p.prosecdef, p.proconfig)
    FROM pg_catalog.pg_proc p JOIN schemas n ON p.pronamespace = n.oid
  UNION ALL SELECT 'type', t.oid::text, t.typowner::text,
    jsonb_build_array(n.nspname, t.typname, t.typtype::text, t.typacl::text)
    FROM pg_catalog.pg_type t JOIN schemas n ON t.typnamespace = n.oid
  UNION ALL SELECT 'defaultAcl', d.oid::text, d.defaclrole::text,
    jsonb_build_array(d.defaclnamespace::text, d.defaclobjtype::text, d.defaclacl::text)
    FROM pg_catalog.pg_default_acl d
  UNION ALL SELECT 'extension', e.oid::text, e.extowner::text,
    jsonb_build_array(e.extname, e.extnamespace::text, e.extversion)
    FROM pg_catalog.pg_extension e
  UNION ALL SELECT 'policy', p.oid::text, c.relowner::text,
    jsonb_build_array(n.nspname, c.relname, p.polname, p.polcmd::text, p.polpermissive, p.polroles::text)
    FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid = p.polrelid JOIN schemas n ON n.oid = c.relnamespace
  UNION ALL SELECT 'eventTrigger', e.oid::text, e.evtowner::text,
    jsonb_build_array(e.evtname, e.evtevent, e.evtenabled::text)
    FROM pg_catalog.pg_event_trigger e
  UNION ALL SELECT 'foreignServer', s.oid::text, s.srvowner::text,
    jsonb_build_array(s.srvname, s.srvacl::text) FROM pg_catalog.pg_foreign_server s
  UNION ALL SELECT 'foreignWrapper', w.oid::text, w.fdwowner::text,
    jsonb_build_array(w.fdwname, w.fdwacl::text) FROM pg_catalog.pg_foreign_data_wrapper w
  UNION ALL SELECT 'publication', p.oid::text, p.pubowner::text,
    jsonb_build_array(p.pubname) FROM pg_catalog.pg_publication p
)
SELECT kind, id, owner, evidence FROM objects ORDER BY kind, id`;
const dependenciesSql = `SELECT d.dbid::text AS "databaseOid",
  CASE WHEN d.dbid = 0 THEN 'SHARED'
    WHEN d.dbid = (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database()) THEN 'CURRENT_DATABASE'
    ELSE 'OTHER_DATABASE' END AS "databaseScope",
  d.classid::text AS "classOid", d.objid::text AS "objectOid",
  d.objsubid AS "subId", d.refobjid::text AS "roleOid", d.deptype::text AS kind
FROM pg_catalog.pg_shdepend d
WHERE d.refclassid = 'pg_catalog.pg_authid'::regclass
  AND d.refobjid IN (
    SELECT oid FROM pg_catalog.pg_roles
    WHERE rolname IN ('adui_scada', 'adui_scada_runtime', 'adui_scada_keycloak_runtime', 'pg_database_owner', 'adui_scada_lock_owner')
  )
ORDER BY d.dbid, d.classid, d.objid, d.objsubid, d.refobjid, d.deptype`;
const databaseNames = ["adui_scada", "adui_scada_keycloak"];

const categories = {
  schema: 2, relation: 6, columnAcl: 4, routine: 6, type: 4, defaultAcl: 3,
  extension: 3, policy: 6, eventTrigger: 3, foreignServer: 2, foreignWrapper: 2, publication: 1,
};
const oid = (value) => typeof value === "string" && /^[1-9][0-9]{0,9}$/u.test(value) && Number(value) <= 4294967295;
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function requireMatch(condition) {
  if (!condition) throw new DockerRoleObjectReviewError("业务对象目录证据缺失或形状不一致");
}

function exactKeys(row, keys) {
  return row && typeof row === "object" && Object.keys(row).length === keys.length &&
    keys.every((key) => Object.hasOwn(row, key));
}

/** 原始名称与 ACL 仅在本地计算指纹；公开报告不包含对象名、凭据或实际业务行。 */
export async function readDockerRoleObjectInventory(query) {
  const roles = (await query("固定角色标识", rolesSql)).rows;
  requireMatch(Array.isArray(roles) && roles.length >= requiredRoles.length && roles.length <= roleNames.length &&
    roles.every((row) =>
      exactKeys(row, ["oid", "name", "login", "superuser", "createDatabase", "createRole", "replication", "bypassRls", "inherit"]) &&
      oid(row.oid) && roleNames.includes(row.name) &&
      ["login", "superuser", "createDatabase", "createRole", "replication", "bypassRls", "inherit"].every((key) => typeof row[key] === "boolean")) &&
    requiredRoles.every((name) => roles.filter((row) => row.name === name).length === 1) &&
    roles.filter((row) => row.name === "adui_scada_lock_owner").length <= 1 &&
    new Set(roles.map((row) => row.name)).size === roles.length &&
    new Set(roles.map((row) => row.oid)).size === roles.length);
  // 两个运行角色和可选锁专用角色必须保持不可登录且无高权限；此处不代替成员关系检查。
  const restrictedRoles = ["adui_scada_runtime", "adui_scada_keycloak_runtime", "adui_scada_lock_owner"];
  requireMatch(roles.filter((role) => restrictedRoles.includes(role.name)).every((role) =>
    ["login", "superuser", "createDatabase", "createRole", "replication", "bypassRls", "inherit"].every((flag) => role[flag] === false)));
  const rows = (await query("对象所有权与直接授权", objectsSql)).rows;
  requireMatch(Array.isArray(rows) && rows.length > 0 && rows.length <= 100000 &&
    rows.every((row) => exactKeys(row, ["kind", "id", "owner", "evidence"]) &&
      Object.hasOwn(categories, row.kind) && oid(row.owner) &&
      (row.kind === "columnAcl" ? typeof row.id === "string" && /^[1-9][0-9]{0,9}:[1-9][0-9]{0,4}$/u.test(row.id) : oid(row.id)) &&
      Array.isArray(row.evidence) && row.evidence.length === categories[row.kind] &&
      row.evidence.every((item, index) => row.kind === "routine" && index === 5
        ? item === null || (Array.isArray(item) && item.length <= 100 && item.every((setting) =>
          typeof setting === "string" && setting.length <= 4096))
        : item === null || typeof item === "string" || typeof item === "boolean")) &&
    new Set(rows.map((row) => row.kind + ":" + row.id)).size === rows.length);
  requireMatch(rows.some((row) => row.kind === "schema") && rows.some((row) => row.kind === "relation"));
  const dependencies = (await query("全集群共享角色依赖", dependenciesSql)).rows;
  requireMatch(Array.isArray(dependencies) && dependencies.length <= 100000 &&
    dependencies.every((row) =>
      exactKeys(row, ["databaseOid", "databaseScope", "classOid", "objectOid", "subId", "roleOid", "kind"]) &&
      (row.databaseOid === "0" || oid(row.databaseOid)) &&
      ["SHARED", "CURRENT_DATABASE", "OTHER_DATABASE"].includes(row.databaseScope) &&
      ((row.databaseOid === "0") === (row.databaseScope === "SHARED")) &&
      oid(row.classOid) && oid(row.objectOid) && oid(row.roleOid) &&
      roleNames.includes(roles.find((role) => role.oid === row.roleOid)?.name) &&
      Number.isSafeInteger(row.subId) && row.subId >= 0 &&
      typeof row.kind === "string" && /^[a-z]$/u.test(row.kind)) &&
    new Set(dependencies.map((row) => JSON.stringify([
      row.databaseOid, row.classOid, row.objectOid, row.subId, row.roleOid, row.kind,
    ]))).size === dependencies.length);
  const classify = (owner) => roles.find((role) => role.oid === owner)?.name ?? "OTHER";
  const objects = Object.keys(categories).map((kind) => ({
    kind,
    total: rows.filter((row) => row.kind === kind).length,
    owners: [...roleNames, "OTHER"].map((name) => ({
      role: name,
      total: rows.filter((row) => row.kind === kind && classify(row.owner) === name).length,
    })),
  }));
  const routineRows = rows.filter((row) => row.kind === "routine");
  const lockOwnerId = roles.find((role) => role.name === "adui_scada_lock_owner")?.oid;
  const securityDefinerRoutineCount = routineRows.filter((row) => row.evidence[4] === true).length;
  // 配置匹配只是必要条件；函数体、执行 ACL、Schema 写权及所有者仍需另行证明。
  const definerConfigMatchedCount = routineRows.filter((row) =>
    row.evidence[4] === true &&
    Array.isArray(row.evidence[5]) && row.evidence[5].length === 2 &&
    row.evidence[5].includes("search_path=pg_catalog, public, pg_temp") &&
    row.evidence[5].includes("row_security=on"),
  ).length;
  const lockOwnerOwnedRoutineCount = lockOwnerId
    ? routineRows.filter((row) => row.owner === lockOwnerId).length
    : 0;
  const dependencyOwners = [...roleNames, "OTHER"].map((name) => ({
    role: name,
    ownership: dependencies.filter((row) => classify(row.roleOid) === name && row.kind === "o").length,
    acl: dependencies.filter((row) => classify(row.roleOid) === name && row.kind === "a").length,
    initialAcl: dependencies.filter((row) => classify(row.roleOid) === name && row.kind === "i").length,
    policy: dependencies.filter((row) => classify(row.roleOid) === name && row.kind === "r").length,
    other: dependencies.filter((row) => classify(row.roleOid) === name && !["o", "a", "i", "r"].includes(row.kind)).length,
    shared: dependencies.filter((row) => classify(row.roleOid) === name && row.databaseScope === "SHARED").length,
    currentDatabase: dependencies.filter((row) => classify(row.roleOid) === name && row.databaseScope === "CURRENT_DATABASE").length,
    otherDatabases: dependencies.filter((row) => classify(row.roleOid) === name && row.databaseScope === "OTHER_DATABASE").length,
  }));
  const catalogFingerprint = createHash("sha256").update(JSON.stringify({
    roles: [...roles].sort((a, b) => compare(a.oid, b.oid)),
    objects: [...rows].sort((a, b) => compare(a.kind + ":" + a.id, b.kind + ":" + b.id)),
    dependencies: [...dependencies].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
  })).digest("hex");
  return {
    objects,
    objectCount: rows.length,
    dependencyOwners,
    dependencyCount: dependencies.length,
    unknownOwnerCount: rows.filter((row) => classify(row.owner) === "OTHER").length,
    unknownDependencyRoleCount: dependencies.filter((row) => classify(row.roleOid) === "OTHER").length,
    securityDefinerRoutineCount,
    definerConfigMatchedCount,
    definerSafetyVerified: false,
    roles: roleNames.flatMap((name) => roles.filter((role) => role.name === name).map(({ oid: _oid, ...flags }) => flags)),
    lockOwnerOwnedRoutineCount,
    catalogFingerprint,
    ownershipTransferAllowed: false,
    businessAclApproved: false,
  };
}

async function inspectDatabase(createClient, database, identity) {
  let client;
  let begun = false;
  let stage = "连接";
  let failure;
  let inventory;
  try {
    client = createClient(database);
    await client.connect();
    stage = "只读事务";
    requireMatch((await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")).command === "BEGIN");
    begun = true;
    stage = "前置身份";
    await verifyDockerRoleObjectIdentity(client, database, identity);
    stage = "目录查询";
    const query = async (step, sql) => {
      try { return await client.query(sql); }
      catch (error) { throw new DockerRoleObjectReviewError(step + "查询失败（SQLSTATE=" + safeSqlState(error) + "）"); }
    };
    const objects = await readDockerRoleObjectInventory(query);
    inventory = database === databaseNames[0]
      ? {
          ...objects,
          ownerInstallPreflight: await readScadaB4InstallPreflight(query),
          businessAclPreview: await readScadaBusinessAclPreview(query),
        }
      : objects;
    stage = "后置身份";
    await verifyDockerRoleObjectIdentity(client, database, identity);
    stage = "事务回滚";
    requireMatch((await client.query("ROLLBACK")).command === "ROLLBACK");
    begun = false;
  } catch (error) {
    failure = database + "对象评审" + stage + "失败，内部诊断已脱敏";
    if (error instanceof DockerRoleObjectReviewError || error instanceof DockerBusinessAclPreviewError || error instanceof DockerB4PreflightError) failure += "；" + error.message;
  }
  if (begun) {
    try { requireMatch((await client.query("ROLLBACK")).command === "ROLLBACK"); }
    catch { failure += "；回滚未确认"; }
  }
  if (client) {
    try { await client.end(); }
    catch { failure = (failure ?? "对象评审") + "；连接关闭失败"; }
  }
  if (failure) throw new DockerRoleObjectReviewError(failure);
  return inventory;
}

/** 分别读取两个固定库；不批准所有权转移、业务 ACL 或运行身份。 */
export async function reviewDockerRoleObjects(createClient, identity) {
  requireMatch(identity?.version === "190000" && typeof identity.systemIdentifier === "string" &&
    /^[1-9][0-9]{0,19}$/u.test(identity.systemIdentifier));
  const scada = await inspectDatabase(createClient, databaseNames[0], identity);
  const keycloak = await inspectDatabase(createClient, databaseNames[1], identity);
  return {
    status: "DOCKER_DB_ROLE_OBJECT_REVIEW_READY",
    scada, keycloak,
    directoryReviewPassed: true,
    ownershipTransferAllowed: false,
    businessAclApproved: false,
    admissionPassed: false,
    databaseWritten: false,
    serviceSwitched: false,
  };
}
