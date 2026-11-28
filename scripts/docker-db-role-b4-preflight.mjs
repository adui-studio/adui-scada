import { createHash } from "node:crypto";
import { readScadaBusinessAclPreview } from "./docker-db-role-business-acl.mjs";

export class DockerB4PreflightError extends Error {}

const ownerRoles = [
  "adui_scada_lock_owner",
  "adui_scada_project_create_owner",
  "adui_scada_oidc_cleanup_owner",
];
const runtimeRoles = ["adui_scada_runtime", "adui_scada_keycloak_runtime"];
const routineNames = [
  "scada_lock_identity",
  "scada_lock_session_identity",
  "scada_lock_project_grants",
  "scada_lock_project_version",
  "scada_lock_release_state_share",
  "scada_lock_release_state_update",
  "scada_lock_release_event",
  "scada_lock_release_request",
  "scada_lock_prior_publish",
  "scada_create_project",
  "scada_cleanup_expired_oidc",
];

const literalList = (values) => values.map((value) => "'" + value + "'").join(", ");
const owners = literalList(ownerRoles);
const runtimes = literalList(runtimeRoles);
const restricted = literalList([...ownerRoles, ...runtimeRoles, "pg_database_owner"]);
const hardened = `NOT (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit)
    AND r.rolpassword IS NULL`;

// 仅查询目录聚合证据，不返回密码、对象名或原始授权。
const preflightSql = `SELECT
  (current_user = 'adui_scada' AND session_user = 'adui_scada'
    AND current_database() = 'adui_scada' AND current_setting('transaction_read_only') = 'on'
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_database d ON d.datdba = r.oid
      WHERE r.rolname = 'adui_scada' AND r.rolsuper AND d.datname = current_database())) AS "managerVerified",
  (SELECT count(*)::int FROM pg_catalog.pg_authid r WHERE r.rolname IN (${runtimes}) AND ${hardened}) AS "hardenedRuntimeCount",
  (SELECT count(*)::int FROM pg_catalog.pg_roles r WHERE r.rolname IN (${owners})) AS "candidateOwnerCount",
  (SELECT count(*)::int FROM pg_catalog.pg_auth_members m WHERE EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname IN (${restricted}) AND r.oid IN (m.roleid, m.member, m.grantor))) AS "membershipCount",
  (SELECT count(*)::int FROM pg_catalog.pg_db_role_setting s JOIN pg_catalog.pg_roles r ON r.oid = s.setrole
    WHERE r.rolname IN (${restricted})) AS "roleSettingCount",
  (SELECT count(*)::int FROM pg_catalog.pg_namespace n JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
    WHERE (n.nspname = 'public' AND r.rolname IN ('adui_scada', 'pg_database_owner'))
      OR (n.nspname = 'pg_catalog' AND r.rolname = 'adui_scada')) AS "trustedSchemaCount",
  (SELECT count(*)::int FROM pg_catalog.pg_namespace n CROSS JOIN pg_catalog.pg_roles r
    WHERE n.nspname IN ('public', 'pg_catalog') AND r.rolname <> 'adui_scada'
      AND NOT (n.nspname = 'public' AND r.rolname = 'pg_database_owner')
      AND pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE')) AS "unexpectedSchemaCreatorCount",
  (SELECT count(*)::int FROM pg_catalog.pg_namespace n
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
    WHERE n.nspname IN ('public', 'pg_catalog') AND a.grantee = 0 AND a.privilege_type = 'CREATE') AS "publicSchemaCreateCount",
  (SELECT count(*)::int FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid = d.defaclrole
    WHERE r.rolname = 'adui_scada' AND d.defaclobjtype = 'f'
      AND (d.defaclnamespace = 0 OR d.defaclnamespace IN (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public'))) AS "functionDefaultAclCount",
  (SELECT count(*)::int FROM pg_catalog.pg_proc p WHERE p.proname IN (${literalList(routineNames)})) AS "reservedRoutineCount",
  (SELECT count(*)::int FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public') AS "publicRoutineCount",
  (SELECT count(*)::int FROM pg_catalog.pg_operator o JOIN pg_catalog.pg_namespace n ON n.oid = o.oprnamespace
    WHERE n.nspname = 'public') AS "publicOperatorCount",
  (SELECT count(*)::int FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal) AS "userTriggerCount",
  (SELECT count(*)::int FROM pg_catalog.pg_event_trigger) AS "eventTriggerCount",
  (SELECT count(*)::int FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND (c.relrowsecurity OR c.relforcerowsecurity)) AS "rlsRelationCount",
  (SELECT count(*)::int FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public') AS "rlsPolicyCount"`;

const expected = {
  managerVerified: true,
  hardenedRuntimeCount: 2,
  candidateOwnerCount: 0,
  membershipCount: 0,
  roleSettingCount: 0,
  trustedSchemaCount: 2,
  unexpectedSchemaCreatorCount: 0,
  publicSchemaCreateCount: 0,
  functionDefaultAclCount: 0,
  reservedRoutineCount: 0,
  publicRoutineCount: 0,
  publicOperatorCount: 0,
  userTriggerCount: 0,
  eventTriggerCount: 0,
  rlsRelationCount: 0,
  rlsPolicyCount: 0,
};

const diagnostics = {
  managerVerified: "安装前管理身份或只读事务不一致",
  hardenedRuntimeCount: "两个运行角色属性不一致",
  candidateOwnerCount: "候选所有者已存在，禁止重复安装",
  membershipCount: "受控角色存在额外成员关系",
  roleSettingCount: "受控角色存在额外配置",
  trustedSchemaCount: "信任模式所有权不一致",
  unexpectedSchemaCreatorCount: "信任模式存在未审查创建权限",
  publicSchemaCreateCount: "PUBLIC 仍有模式创建权限",
  functionDefaultAclCount: "安装身份存在未审查默认函数授权",
  reservedRoutineCount: "预留例程名称已存在",
  publicRoutineCount: "public 模式存在未审查例程",
  publicOperatorCount: "public 模式存在未审查运算符",
  userTriggerCount: "业务库存在未审查触发器",
  eventTriggerCount: "业务库存在未审查事件触发器",
  rlsRelationCount: "业务库存在未审查行级安全配置",
  rlsPolicyCount: "业务库存在未审查行级安全策略",
};

function exactKeys(row, keys) {
  return row && typeof row === "object" && !Array.isArray(row) &&
    Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key));
}

/** 仅接受固定基线并生成角色创建候选，不执行任何变更。 */
export function buildScadaB4InstallPreflight(rows) {
  if (!Array.isArray(rows) || rows.length !== 1 || !exactKeys(rows[0], Object.keys(expected))) {
    throw new DockerB4PreflightError("B4 安装前目录证据形状异常");
  }
  const row = rows[0];
  for (const [key, value] of Object.entries(expected)) {
    if (row[key] !== value) throw new DockerB4PreflightError(diagnostics[key]);
  }
  const evidence = { ...expected };
  const roleCreationPreview = ownerRoles.map((role) =>
    "CREATE ROLE " + role + " NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD NULL",
  );
  const planFingerprint = createHash("sha256").update(JSON.stringify({
    evidence, roleCreationPreview, reservedRoutineNames: routineNames,
  })).digest("hex");
  return {
    status: "SCADA_B4_INSTALL_PREFLIGHT_READY",
    evidence,
    roleCreationPreview,
    reservedRoutineCount: routineNames.length,
    planFingerprint,
    preflightPassed: true,
    ownerRolesCreated: false,
    ownerRolePrivilegesVerified: false,
    definerSafetyVerified: false,
    issuerBindingVerified: false,
    installationAllowed: false,
    businessAclApproved: false,
    admissionPassed: false,
    databaseWritten: false,
  };
}

/** 在既有只读事务中检查安装前目录。 */
export async function readScadaB4InstallPreflight(query) {
  const result = await query("B4 例程安装前置检查", preflightSql);
  return buildScadaB4InstallPreflight(result?.rows);
}

/** 仅在前置核验成功后读取业务列权限候选。 */
export async function readScadaB4BusinessPreparation(query) {
  const ownerInstallPreflight = await readScadaB4InstallPreflight(query);
  const businessAclPreview = await readScadaBusinessAclPreview(query);
  return { ownerInstallPreflight, businessAclPreview };
}

// 未授权的新所有者必须没有数据库及业务对象权限；不依赖混合关系目录过滤顺序。
const newOwnerSql = `SELECT r.rolname::text AS role,
  (current_user = 'adui_scada' AND session_user = 'adui_scada'
    AND current_database() = 'adui_scada' AND current_setting('transaction_read_only') = 'off'
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles admin JOIN pg_catalog.pg_database d ON d.datdba = admin.oid
      WHERE admin.rolname = 'adui_scada' AND admin.rolsuper AND d.datname = current_database())) AS "managerVerified",
  ${hardened} AS hardened,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE r.oid IN (m.roleid, m.member, m.grantor)) AS "noMemberships",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s WHERE s.setrole = r.oid) AS "noSettings",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_shdepend d WHERE d.refclassid = 'pg_catalog.pg_authid'::regclass AND d.refobjid = r.oid) AS "noDependencies",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database d WHERE pg_catalog.has_database_privilege(r.oid, d.oid, 'CONNECT,TEMPORARY,CREATE')) AS "noDatabaseAccess",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE')) AS "noSchemaCreate",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'prisma_contract') AND CASE WHEN c.relkind IN ('r','p','v','m','f') THEN
      (pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR
       pg_catalog.has_any_column_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')) ELSE false END) AS "noTableOrColumnAccess",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'prisma_contract') AND CASE WHEN c.relkind = 'S' THEN
      pg_catalog.has_sequence_privilege(r.oid, c.oid, 'USAGE,SELECT,UPDATE') ELSE false END) AS "noSequenceAccess"
FROM pg_catalog.pg_authid r WHERE r.rolname IN (${owners})`;

const ownerFlags = ["managerVerified", "hardened", "noMemberships", "noSettings", "noDependencies", "noDatabaseAccess", "noSchemaCreate", "noTableOrColumnAccess", "noSequenceAccess"];

/** 仅供后续事务在创建三个角色后、授权前核验，不调用写入。 */
export async function verifyScadaB4NewOwnerRoles(query) {
  const rows = (await query("B4 新所有者未授权核验", newOwnerSql))?.rows;
  if (!Array.isArray(rows) || rows.length !== ownerRoles.length ||
    !rows.every((row) => exactKeys(row, ["role", ...ownerFlags]) && ownerRoles.includes(row.role) &&
      ownerFlags.every((flag) => row[flag] === true)) ||
    new Set(rows.map((row) => row.role)).size !== ownerRoles.length) {
    throw new DockerB4PreflightError("B4 新所有者未授权基线不一致");
  }
  return { ownerRoleCount: ownerRoles.length, ungrantedOwnerRolesVerified: true, installationAllowed: false, admissionPassed: false, databaseWritten: false };
}
