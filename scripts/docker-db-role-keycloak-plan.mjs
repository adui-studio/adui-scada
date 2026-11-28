import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export class DockerKeycloakOwnershipError extends Error {}

const manager = "adui_scada";
const runtime = "adui_scada_keycloak_runtime";
const oid = (value) =>
  typeof value === "string" && /^[1-9][0-9]{0,9}$/u.test(value) && Number(value) <= 4294967295;
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const kinds = ["table", "index", "toast", "toastIndex", "rowType", "arrayType"];
const tableCount = 101;
const requiredTables = [
  "realm",
  "client",
  "user_entity",
  "databasechangelog",
  "databasechangeloglock",
];
const baseline = {
  managerVerified: true,
  rolesHardened: true,
  isolatedRuntime: true,
  schemaTrusted: true,
  noOtherSchemas: true,
  noUnexpectedObjects: true,
  keycloakDependencyMatched: true,
};

const readOnlyPhase = (phase) => phase === "read-only" || phase === "projected-read-only";
const projectedPhase = (phase) => phase === "projected" || phase === "projected-read-only";

const baselineSql = (phase) => `WITH roles AS (
  SELECT * FROM pg_catalog.pg_authid WHERE rolname IN ('adui_scada_runtime', 'adui_scada_keycloak_runtime')
), keycloak AS (SELECT oid FROM roles WHERE rolname = 'adui_scada_keycloak_runtime'),
  db AS (SELECT oid, datdba FROM pg_catalog.pg_database WHERE datname = current_database()),
  ns AS (SELECT oid, nspowner, nspacl FROM pg_catalog.pg_namespace WHERE nspname = 'public')
SELECT (current_database() = 'adui_scada_keycloak' AND current_user = 'adui_scada' AND session_user = 'adui_scada'
  AND current_setting('transaction_read_only') = '${readOnlyPhase(phase) ? "on" : "off"}'
  AND current_setting('transaction_isolation') = '${readOnlyPhase(phase) ? "repeatable read" : "serializable"}'
  AND current_setting('server_version_num') = '190000' AND NOT pg_catalog.pg_is_in_recovery()
  AND EXISTS (SELECT 1 FROM db JOIN pg_catalog.pg_roles r ON r.oid = db.datdba WHERE r.rolname = current_user AND r.rolsuper)) AS "managerVerified",
  ((SELECT count(*) FROM roles) = 2 AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.rolcanlogin OR r.rolsuper
    OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit OR r.rolpassword IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN roles r ON r.oid IN (m.roleid, m.member, m.grantor))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s JOIN roles r ON r.oid = s.setrole)) AS "rolesHardened",
  (NOT EXISTS (SELECT 1 FROM roles r CROSS JOIN pg_catalog.pg_database d WHERE
    pg_catalog.has_database_privilege(r.oid, d.oid, 'CONNECT') IS DISTINCT FROM
      ((r.rolname = 'adui_scada_runtime' AND d.datname = 'adui_scada') OR
       (r.rolname = 'adui_scada_keycloak_runtime' AND d.datname = 'adui_scada_keycloak'))
    OR pg_catalog.has_database_privilege(r.oid, d.oid, 'CREATE,TEMPORARY,CONNECT WITH GRANT OPTION'))) AS "isolatedRuntime",
  EXISTS (SELECT 1 FROM ns n JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
    WHERE r.rolname = 'pg_database_owner' AND n.nspacl IS NOT NULL
    AND (SELECT count(*) FROM pg_catalog.aclexplode(n.nspacl)) = 3
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(n.nspacl) a WHERE a.grantor <> n.nspowner OR a.is_grantable
      OR NOT ((a.grantee = n.nspowner AND a.privilege_type IN ('USAGE','CREATE')) OR (a.grantee = 0 AND a.privilege_type = 'USAGE')))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE n.nspowner IN (m.roleid, m.member, m.grantor))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles actor WHERE NOT actor.rolsuper AND actor.oid <> n.nspowner
      AND pg_catalog.has_schema_privilege(actor.oid, n.oid, 'CREATE'))) AS "schemaTrusted",
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname NOT IN ('public','information_schema') AND left(n.nspname,3) <> 'pg_') AS "noOtherSchemas",
  (NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN ns n ON p.pronamespace = n.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_operator p JOIN ns n ON p.oprnamespace = n.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_collation p JOIN ns n ON p.collnamespace = n.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_conversion p JOIN ns n ON p.connamespace = n.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_ts_config p JOIN ns n ON p.cfgnamespace = n.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_ts_dict p JOIN ns n ON p.dictnamespace = n.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_ts_parser p JOIN ns n ON p.prsnamespace = n.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_ts_template p JOIN ns n ON p.tmplnamespace = n.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_opclass p JOIN ns n ON p.opcnamespace = n.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_opfamily p JOIN ns n ON p.opfnamespace = n.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_statistic_ext p JOIN ns n ON p.stxnamespace = n.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_foreign_server)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_foreign_data_wrapper)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_subscription WHERE subdbid = (SELECT oid FROM db))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_largeobject_metadata)) AS "noUnexpectedObjects",
  ((SELECT count(*) FROM pg_catalog.pg_shdepend d JOIN keycloak k ON k.oid = d.refobjid
    WHERE d.refclassid = 'pg_catalog.pg_authid'::regclass) = ${projectedPhase(phase) ? tableCount + 1 : 1}
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_shdepend d JOIN keycloak k ON k.oid = d.refobjid
      WHERE d.refclassid = 'pg_catalog.pg_authid'::regclass AND d.dbid = 0
        AND d.classid = 'pg_catalog.pg_database'::regclass AND d.objid = (SELECT oid FROM db)
        AND d.objsubid = 0 AND d.deptype = 'a')) AS "keycloakDependencyMatched"`;

const inventorySql = `WITH public_relations AS (
  SELECT c.* FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = 'public'
), toast_relations AS (
  SELECT c.*, p.oid AS parent FROM pg_catalog.pg_class c JOIN public_relations p ON c.oid = p.reltoastrelid
), relations AS (
  SELECT CASE c.relkind WHEN 'r' THEN 'table' WHEN 'i' THEN 'index' ELSE 'unsupported' END AS kind,
    c.oid, c.relname AS name, i.indrelid AS parent, c.relowner AS owner,
    (c.relacl IS NULL AND c.relpersistence = 'p' AND NOT c.relispartition AND c.reloftype = 0
      AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits h WHERE c.oid IN (h.inhrelid, h.inhparent))
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite r WHERE r.ev_class = c.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid)
      AND (c.relkind <> 'i' OR (i.indisvalid AND i.indisready AND i.indislive))) AS clean
    FROM public_relations c LEFT JOIN pg_catalog.pg_index i ON i.indexrelid = c.oid
  UNION ALL SELECT 'toast', c.oid, c.relname, c.parent, c.relowner,
    c.relkind = 't' AND c.relacl IS NULL AND c.relpersistence = 'p' AND n.nspname = 'pg_toast'
    FROM toast_relations c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  UNION ALL SELECT 'toastIndex', c.oid, c.relname, t.oid, c.relowner,
    c.relkind = 'i' AND c.relacl IS NULL AND c.relpersistence = 'p' AND n.nspname = 'pg_toast'
      AND i.indisvalid AND i.indisready AND i.indislive
    FROM toast_relations t JOIN pg_catalog.pg_index i ON i.indrelid = t.oid
      JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
), types AS (
  SELECT CASE WHEN t.typtype = 'c' AND c.relkind = 'r' AND c.reltype = t.oid THEN 'rowType'
      WHEN t.typcategory = 'A' AND elem.typarray = t.oid AND elem.typtype = 'c' THEN 'arrayType' ELSE 'unsupported' END AS kind,
    t.oid, t.typname AS name, CASE WHEN t.typtype = 'c' THEN t.typrelid ELSE t.typelem END AS parent, t.typowner AS owner,
    t.typacl IS NULL AND t.typisdefined AS clean
    FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      LEFT JOIN public_relations c ON c.oid = t.typrelid LEFT JOIN pg_catalog.pg_type elem ON elem.oid = t.typelem
    WHERE n.nspname = 'public'
), objects AS (
  SELECT *, 'pg_catalog.pg_class'::regclass AS classid FROM relations
  UNION ALL SELECT *, 'pg_catalog.pg_type'::regclass AS classid FROM types
)
SELECT kind, oid::text AS oid, name::text AS name, parent::text AS parent,
  pg_catalog.pg_get_userbyid(owner)::text AS owner,
  clean AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = objects.classid AND d.objid = objects.oid AND d.deptype = 'e') AS clean
FROM objects`;

function requireMatch(condition, message) {
  if (!condition) throw new DockerKeycloakOwnershipError(message);
}

function normalizeInventory(rows, expectedOwner) {
  requireMatch(Array.isArray(rows) && rows.length <= 10000, "Keycloak 对象证据数量无效");
  const keys = ["kind", "oid", "name", "parent", "owner", "clean"];
  requireMatch(
    rows.every(
      (row) =>
        row &&
        Object.keys(row).length === keys.length &&
        keys.every((key) => Object.hasOwn(row, key)) &&
        kinds.includes(row.kind) &&
        oid(row.oid) &&
        typeof row.name === "string" &&
        /^[a-z_][a-z0-9_]{0,62}$/u.test(row.name) &&
        (row.kind === "table" ? row.parent === null : oid(row.parent)) &&
        row.owner === expectedOwner &&
        row.clean === true,
    ),
    "Keycloak 对象类型、名称、所有者或 ACL 不一致",
  );
  const objectKey = (row) =>
    (row.kind === "rowType" || row.kind === "arrayType" ? "type:" : "relation:") + row.oid;
  requireMatch(new Set(rows.map(objectKey)).size === rows.length, "Keycloak 对象标识重复");
  const groups = Object.fromEntries(
    kinds.map((kind) => [kind, rows.filter((row) => row.kind === kind)]),
  );
  const tables = groups.table;
  const names = new Set(tables.map((row) => row.name));
  requireMatch(
    tables.length === tableCount &&
      names.size === tableCount &&
      requiredTables.every((name) => names.has(name)) &&
      tables.every((row) => !/^(scada_|prisma_)/u.test(row.name)),
    "Keycloak 已评审表范围不一致",
  );
  for (const [child, parent] of [
    ["index", "table"],
    ["toast", "table"],
    ["toastIndex", "toast"],
    ["rowType", "table"],
    ["arrayType", "rowType"],
  ]) {
    requireMatch(
      groups[child].every((row) => groups[parent].some((item) => item.oid === row.parent)),
      "Keycloak 从属对象依赖不一致",
    );
  }
  for (const [parent, child] of [
    ["table", "rowType"],
    ["rowType", "arrayType"],
    ["toast", "toastIndex"],
  ]) {
    requireMatch(
      groups[parent].every(
        (row) => groups[child].filter((item) => item.parent === row.oid).length === 1,
      ),
      "Keycloak 从属对象缺失或重复",
    );
  }
  requireMatch(
    tables.every((row) => groups.toast.filter((item) => item.parent === row.oid).length <= 1),
    "Keycloak TOAST 依赖重复",
  );
  return rows
    .map((row) => Object.fromEntries(keys.map((key) => [key, row[key]])))
    .sort((left, right) => compare(objectKey(left), objectKey(right)));
}

// 只预览已核验的普通表，不生成全库所有权转移或运行角色授权语句。
export function buildKeycloakOwnershipPlan({
  identity,
  storageHash,
  isolationFingerprint,
  baselineRows,
  objects,
}) {
  requireMatch(
    identity?.version === "190000" &&
      typeof identity.systemIdentifier === "string" &&
      /^[1-9][0-9]{0,19}$/u.test(identity.systemIdentifier) &&
      hash(storageHash) &&
      hash(isolationFingerprint) &&
      isDeepStrictEqual(baselineRows, [baseline]),
    "Keycloak 所有权前置证据不一致",
  );
  const inventory = normalizeInventory(objects, manager);
  const tables = inventory
    .filter((row) => row.kind === "table")
    .sort((left, right) => compare(left.name, right.name));
  const sqlPreview = tables.map(
    (row) => 'ALTER TABLE ONLY public."' + row.name + '" OWNER TO adui_scada_keycloak_runtime',
  );
  const planFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        identity: [identity.version, identity.systemIdentifier],
        storageHash,
        isolationFingerprint,
        inventory,
        sqlPreview,
      }),
    )
    .digest("hex");
  return {
    inventory,
    sqlPreview,
    report: {
      status: "KEYCLOAK_OWNERSHIP_PLAN_READY",
      planOnly: true,
      planFingerprint,
      targetDatabase: "adui_scada_keycloak",
      targetRole: runtime,
      tableCount: tables.length,
      objectCounts: Object.fromEntries(
        kinds.map((kind) => [kind, inventory.filter((row) => row.kind === kind).length]),
      ),
      statementCount: sqlPreview.length,
      schemaCreateReviewRequired: true,
      objectIdentityReviewed: false,
      ownershipTransferAllowed: false,
      ownerProjectionVerified: false,
      runtimeLoginAllowed: false,
      businessAclApproved: false,
      admissionPassed: false,
      databaseWritten: false,
      serviceSwitched: false,
    },
  };
}

// 仅比较将来事务内的目录投影，不代表已经执行所有权转移。
export function verifyKeycloakOwnershipProjection(before, after) {
  const expected = normalizeInventory(before, manager).map((row) => ({ ...row, owner: runtime }));
  requireMatch(
    isDeepStrictEqual(normalizeInventory(after, runtime), expected),
    "Keycloak 所有权投影不一致",
  );
  return { ownerProjectionMatched: true, ownershipTransferAllowed: false, admissionPassed: false };
}

// 内部候选仅供受控事务使用，不得直接输出。
export async function readKeycloakOwnershipCandidate(query, context, phase = "read-only") {
  requireMatch(phase === "read-only" || phase === "rehearsal", "Keycloak 所有权候选事务模式无效");
  let stage = "安全基线";
  try {
    const baselineRows = (await query("Keycloak 所有权前置", baselineSql(phase)))?.rows;
    requireMatch(isDeepStrictEqual(baselineRows, [baseline]), "Keycloak 所有权前置证据不一致");
    stage = "对象与依赖";
    const objects = (await query("Keycloak 对象所有权", inventorySql))?.rows;
    return buildKeycloakOwnershipPlan({ ...context, baselineRows, objects });
  } catch (error) {
    if (error instanceof DockerKeycloakOwnershipError) throw error;
    throw new DockerKeycloakOwnershipError(`Keycloak ${stage}查询失败，内部诊断已脱敏`);
  }
}

/** 只读入口仅返回脱敏报告，不暴露内部候选。 */
export async function readKeycloakOwnershipPreview(query, context) {
  return (await readKeycloakOwnershipCandidate(query, context)).report;
}

const dependencySql = `WITH target AS (
  SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'adui_scada_keycloak_runtime'
), db AS (
  SELECT oid, datname, datdba, datacl FROM pg_catalog.pg_database WHERE datname = current_database()
), deps AS (
  SELECT d.*, (d.dbid = 0 AND d.classid = 'pg_catalog.pg_database'::regclass
    AND d.objid = db.oid AND d.objsubid = 0 AND d.deptype = 'a') AS connect,
    (d.dbid = db.oid AND d.classid = 'pg_catalog.pg_class'::regclass
    AND d.objsubid = 0 AND d.deptype = 'o') AS table_owner, db.datname
  FROM pg_catalog.pg_shdepend d CROSS JOIN db JOIN target t ON d.refobjid = t.oid
  WHERE d.refclassid = 'pg_catalog.pg_authid'::regclass
), direct_acl AS (
  SELECT a.* FROM pg_catalog.pg_database d
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(d.datacl, pg_catalog.acldefault('d', d.datdba))) a
    JOIN target t ON t.oid IN (a.grantee, a.grantor)
  WHERE d.datname = 'adui_scada_keycloak' AND a.grantor = d.datdba
    AND a.grantee = t.oid AND a.privilege_type = 'CONNECT' AND NOT a.is_grantable
), all_acl AS (
  SELECT a.* FROM pg_catalog.pg_database d
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(d.datacl, pg_catalog.acldefault('d', d.datdba))) a
    JOIN target t ON t.oid IN (a.grantee, a.grantor)
)
SELECT CASE WHEN connect THEN 'databaseConnect' WHEN table_owner THEN 'tableOwner' ELSE 'unexpected' END AS kind,
  CASE WHEN connect THEN datname::text ELSE objid::text END AS "objectId",
  (SELECT count(*) FROM direct_acl) = 1 AND (SELECT count(*) FROM all_acl) = 1 AS "directConnectMatched",
  (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "systemIdentifier"
FROM deps`;

const tablePrivileges = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
];
const columnPrivileges = ["SELECT", "INSERT", "UPDATE", "REFERENCES"];
const privilegeSql = `WITH roles AS (
  SELECT oid, rolname FROM pg_catalog.pg_roles WHERE rolname IN ('adui_scada_runtime', 'adui_scada_keycloak_runtime')
), relations AS (
  SELECT c.oid, c.relkind, n.oid AS schema_oid FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'
), privileges AS (SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS name),
  column_privileges AS (SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS name)
SELECT r.rolname::text AS role, c.oid::text AS "objectId",
  ARRAY(SELECT p.name FROM privileges p WHERE CASE WHEN c.relkind = 'r'
    THEN pg_catalog.has_table_privilege(r.oid, c.oid, p.name) ELSE false END ORDER BY p.name COLLATE "C") AS "tablePrivileges",
  ARRAY(SELECT p.name FROM privileges p WHERE CASE WHEN c.relkind = 'r'
    THEN pg_catalog.has_table_privilege(r.oid, c.oid, p.name || ' WITH GRANT OPTION') ELSE false END ORDER BY p.name COLLATE "C") AS "tableGrantOptions",
  ARRAY(SELECT p.name FROM column_privileges p WHERE CASE WHEN c.relkind = 'r'
    THEN pg_catalog.has_any_column_privilege(r.oid, c.oid, p.name) ELSE false END ORDER BY p.name COLLATE "C") AS "columnPrivileges",
  pg_catalog.has_schema_privilege(r.oid, c.schema_oid, 'USAGE') AS "schemaUsage",
  pg_catalog.has_schema_privilege(r.oid, c.schema_oid, 'CREATE,USAGE WITH GRANT OPTION') AS "schemaElevated"
FROM roles r CROSS JOIN relations c`;

function exactRows(rows, expected) {
  return (
    Array.isArray(rows) &&
    rows.length === expected.length &&
    expected.every((entry) => rows.some((row) => isDeepStrictEqual(row, entry)))
  );
}

// 仅普通表有独立所有权依赖；索引、TOAST 及自动类型由前一步对象图校验。
function expectedDependencies(tables, identity, projected) {
  return [
    {
      kind: "databaseConnect",
      objectId: "adui_scada_keycloak",
      directConnectMatched: true,
      systemIdentifier: identity.systemIdentifier,
    },
    ...(projected
      ? tables.map((table) => ({
          kind: "tableOwner",
          objectId: table.oid,
          directConnectMatched: true,
          systemIdentifier: identity.systemIdentifier,
        }))
      : []),
  ];
}

function expectedPrivileges(tables, projected) {
  return ["adui_scada_runtime", runtime].flatMap((role) =>
    tables.map((table) => ({
      role,
      objectId: table.oid,
      tablePrivileges: projected && role === runtime ? [...tablePrivileges].sort(compare) : [],
      tableGrantOptions: projected && role === runtime ? [...tablePrivileges].sort(compare) : [],
      columnPrivileges: projected && role === runtime ? [...columnPrivileges].sort(compare) : [],
      schemaUsage: true,
      schemaElevated: false,
    })),
  );
}

/** 仅核验当前事务内的目录证据，不执行所有权转移或提交。 */
async function verifyOwnershipCatalog(query, context, candidate, expectedPlanFingerprint, phase) {
  const projected = projectedPhase(phase);
  const persisted = phase === "projected-read-only";
  let stage = "候选指纹";
  try {
    requireMatch(hash(expectedPlanFingerprint), "Keycloak 目录候选指纹无效");
    let original;
    if (!persisted) {
      original = buildKeycloakOwnershipPlan({
        ...context,
        baselineRows: [baseline],
        objects: candidate?.inventory,
      });
      requireMatch(
        original.report.planFingerprint === expectedPlanFingerprint &&
          isDeepStrictEqual(candidate, original),
        "Keycloak 目录候选指纹不一致",
      );
    }
    stage = projected ? "后置安全基线" : "原始安全基线";
    requireMatch(
      isDeepStrictEqual((await query(stage, baselineSql(phase)))?.rows, [baseline]),
      "Keycloak 目录安全基线不一致",
    );
    stage = "对象所有权投影";
    const objects = (await query(stage, inventorySql))?.rows;
    if (persisted) {
      // 必须从实际已转移的完整对象图恢复原始候选，并与独立确认的旧指纹匹配。
      const inventory = normalizeInventory(objects, runtime).map((row) => ({
        ...row,
        owner: manager,
      }));
      original = buildKeycloakOwnershipPlan({
        ...context,
        baselineRows: [baseline],
        objects: inventory,
      });
      requireMatch(
        original.report.planFingerprint === expectedPlanFingerprint,
        "Keycloak 持久化所有权候选指纹不一致",
      );
    }
    if (projected) verifyKeycloakOwnershipProjection(original.inventory, objects);
    else
      requireMatch(
        isDeepStrictEqual(normalizeInventory(objects, manager), original.inventory),
        "Keycloak 原始所有权基线不一致",
      );
    const tables = original.inventory.filter((row) => row.kind === "table");
    stage = "共享所有权依赖";
    const dependencies = expectedDependencies(tables, context.identity, projected);
    requireMatch(
      exactRows((await query(stage, dependencySql))?.rows, dependencies),
      "Keycloak 共享所有权依赖投影不一致",
    );
    stage = "有效表列及 Schema 权限";
    const privileges = expectedPrivileges(tables, projected);
    requireMatch(
      exactRows((await query(stage, privilegeSql))?.rows, privileges),
      "Keycloak 有效表列或 Schema 权限不一致",
    );
    const catalogFingerprint = createHash("sha256")
      .update(JSON.stringify({ expectedPlanFingerprint, projected, dependencies, privileges }))
      .digest("hex");
    const report = {
      status: projected
        ? "KEYCLOAK_OWNERSHIP_CATALOG_MATCHED"
        : "KEYCLOAK_OWNERSHIP_BASELINE_MATCHED",
      catalogFingerprint,
      tableCount: tables.length,
      dependencyCount: dependencies.length,
      permissionCount: privileges.length,
      ownerProjectionMatched: projected,
      dependencyProjectionMatched: projected,
      baselineCatalogMatched: !projected,
      rolePrivilegesMatched: true,
      schemaCreateAllowed: false,
      schemaEvolutionVerified: false,
      objectIdentityReviewed: false,
      ownershipTransferAllowed: false,
      runtimeLoginAllowed: false,
      admissionPassed: false,
      businessAclApproved: false,
      databaseWritten: false,
      serviceSwitched: false,
    };
    // 表标识只供同一跨阶段核验内部使用，不进入公开报告。
    return persisted ? { report, tableOids: tables.map((table) => table.oid) } : report;
  } catch (error) {
    if (error instanceof DockerKeycloakOwnershipError) throw error;
    throw new DockerKeycloakOwnershipError(`Keycloak ${stage}核验失败，内部诊断已脱敏`);
  }
}

/** 对应未安装状态：演练前或回滚后独立只读核验。 */
export async function verifyKeycloakOwnershipBaseline(
  query,
  context,
  candidate,
  expectedPlanFingerprint,
  phase = "read-only",
) {
  requireMatch(phase === "read-only" || phase === "rehearsal", "Keycloak 原始目录事务模式无效");
  return verifyOwnershipCatalog(query, context, candidate, expectedPlanFingerprint, phase);
}

/** 仅供后续受控可写事务的所有权后置门禁。 */
export async function verifyKeycloakOwnershipCatalog(
  query,
  context,
  candidate,
  expectedPlanFingerprint,
) {
  return verifyOwnershipCatalog(query, context, candidate, expectedPlanFingerprint, "projected");
}

/** 独立只读核验已转移目录，不接受外部对象列表，不批准所有权转移或服务切换。 */
export async function readKeycloakInstalledOwnership(query, context, expectedPlanFingerprint) {
  return verifyOwnershipCatalog(
    query,
    context,
    undefined,
    expectedPlanFingerprint,
    "projected-read-only",
  );
}
