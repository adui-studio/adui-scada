import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { buildScadaLockRoutinePreview } from "./docker-db-role-lock-routines.mjs";
import {
  buildScadaRestrictedWritePreview,
  buildScadaOidcCleanupRoutinePreview,
} from "./docker-db-role-restricted-writes.mjs";

export class DockerB4RoutineReviewError extends Error {}

const runtime = "adui_scada_runtime";
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const config = ["row_security=on", "search_path=pg_catalog, public, pg_temp"];
const header = /^CREATE FUNCTION public\.(scada_[a-z_]+)\(([\s\S]*?)\) RETURNS (TABLE \([^\n]+\)|text|bigint)\nLANGUAGE (sql|plpgsql) VOLATILE( STRICT)? PARALLEL UNSAFE SECURITY DEFINER\nSET search_path = pg_catalog, public, pg_temp SET row_security = on\nAS \$(scada_(?:lock|create|cleanup))\$([\s\S]+)\$\6\$$/u;

function requireMatch(condition, message) {
  if (!condition) throw new DockerB4RoutineReviewError(message);
}

function catalogType(value) {
  return value === "timestamptz" ? "timestamp with time zone" : value;
}

function argumentList(value) {
  if (!value.trim()) return [];
  return value.trim().split(/,\s*/u).map((arg) => {
    const match = arg.match(/^([a-z_]+) (text|bigint|uuid|jsonb|timestamptz)$/u);
    requireMatch(match, "B4 固定例程参数形状异常");
    return match[1] + " " + catalogType(match[2]);
  });
}

function expectedRoutine(definition, owner, projectOwner) {
  const match = definition.createSql.match(header);
  requireMatch(match, "B4 固定例程定义形状异常");
  const [, name, args, result, language, strict, , body] = match;
  const argumentsList = argumentList(args);
  const argumentsText = argumentsList.join(", ");
  const identity = "public." + name + "(" + argumentsList.map((arg) => arg.slice(arg.indexOf(" ") + 1)).join(", ") + ")";
  const grantees = [owner, runtime, ...(name === "scada_lock_identity" ? [projectOwner] : [])].sort(compare);
  return {
    managerVerified: true, schema: "public", name, identity, argumentsText,
    result: result.replace("TABLE (", "TABLE("), owner, language,
    kind: "f", strict: Boolean(strict), securityDefiner: true,
    returnsSet: result.startsWith("TABLE "), volatility: "v", parallel: "u", leakproof: false,
    noVariadic: true, noDefaults: true, noSupport: true, noParsedBody: true,
    noBinary: true, noTransforms: true,
    config: [...config], body, explicitAcl: true,
    acl: grantees.map((grantee) => ({ grantee, grantor: owner, privilege: "EXECUTE", grantable: false })),
    effectiveExecute: grantees,
  };
}

/** 从固定候选构造预期目录，不接受外部 SQL。 */
export function buildScadaB4RoutineExpectations(port) {
  const locks = buildScadaLockRoutinePreview();
  const project = buildScadaRestrictedWritePreview().projectCreate;
  const cleanup = buildScadaOidcCleanupRoutinePreview(port);
  return [
    ...locks.definitions.map((definition) => expectedRoutine(definition, locks.ownerRole, project.ownerRole)),
    expectedRoutine(project, project.ownerRole, project.ownerRole),
    expectedRoutine(cleanup, cleanup.ownerRole, project.ownerRole),
  ];
}

// 不过滤异常授权或重载；未知目录值仅参与本地比较。
function routineSql(expected) {
  const names = expected.map(({ name }) => "'" + name + "'").join(", ");
  return `SELECT (current_user = 'adui_scada' AND session_user = 'adui_scada'
    AND current_database() = 'adui_scada' AND current_setting('server_version_num') = '190000'
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles manager JOIN pg_catalog.pg_database d ON d.datdba = manager.oid
      WHERE manager.rolname = 'adui_scada' AND manager.rolsuper AND d.datname = current_database())) AS "managerVerified",
  n.nspname::text AS schema, p.proname::text AS name,
  n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' AS identity,
  pg_catalog.pg_get_function_arguments(p.oid) AS "argumentsText",
  pg_catalog.pg_get_function_result(p.oid) AS result, r.rolname::text AS owner,
  l.lanname::text AS language, p.prokind::text AS kind, p.proisstrict AS strict,
  p.prosecdef AS "securityDefiner", p.proretset AS "returnsSet", p.provolatile::text AS volatility,
  p.proparallel::text AS parallel, p.proleakproof AS leakproof,
  p.provariadic = 0 AS "noVariadic", p.pronargdefaults = 0 AS "noDefaults",
  p.prosupport = 0 AS "noSupport", p.prosqlbody IS NULL AS "noParsedBody",
  p.probin IS NULL AS "noBinary", p.protrftypes IS NULL AS "noTransforms",
  p.proconfig AS config, p.prosrc AS body, p.proacl IS NOT NULL AS "explicitAcl",
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname::text END,
    'grantor', grantor.rolname::text, 'privilege', a.privilege_type, 'grantable', a.is_grantable))
    FROM pg_catalog.aclexplode(p.proacl) a
    LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = a.grantee
    LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid = a.grantor), '[]'::jsonb) AS acl,
  ARRAY(SELECT actor.rolname::text FROM pg_catalog.pg_roles actor WHERE NOT actor.rolsuper
    AND CASE WHEN p.prokind = 'f' THEN pg_catalog.has_function_privilege(actor.oid, p.oid, 'EXECUTE') ELSE false END) AS "effectiveExecute"
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
JOIN pg_catalog.pg_roles r ON r.oid = p.proowner JOIN pg_catalog.pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public' OR p.proname IN (${names})`;
}

function normalized(row) {
  if (!row || typeof row !== "object" || Array.isArray(row) ||
    !Array.isArray(row.config) || !Array.isArray(row.acl) || !Array.isArray(row.effectiveExecute) ||
    !row.config.every((value) => typeof value === "string") ||
    !row.effectiveExecute.every((value) => typeof value === "string") ||
    !row.acl.every((value) => value && typeof value === "object" && typeof value.grantee === "string")) return null;
  return {
    ...row, config: [...row.config].sort(compare),
    acl: [...row.acl].sort((left, right) => compare(left.grantee, right.grantee)),
    effectiveExecute: [...row.effectiveExecute].sort(compare),
  };
}

/** 安装后例程目录必须与固定候选精确一致；不代替行锁或业务验证。 */
export async function verifyScadaB4InstalledRoutines(query, port) {
  const expected = buildScadaB4RoutineExpectations(port);
  let rows;
  try {
    rows = (await query("B4 安装后例程目录核验", routineSql(expected)))?.rows;
  } catch {
    throw new DockerB4RoutineReviewError("B4 例程目录查询失败，内部诊断已脱敏");
  }
  requireMatch(Array.isArray(rows) && rows.length === expected.length, "B4 例程数量不一致");
  for (const entry of expected) {
    const matches = rows.filter((row) => row?.identity === entry.identity);
    requireMatch(matches.length === 1 && isDeepStrictEqual(normalized(matches[0]), entry),
      "B4 例程签名、正文或授权不一致：" + entry.name);
  }
  const catalogFingerprint = createHash("sha256").update(JSON.stringify(expected)).digest("hex");
  return {
    status: "SCADA_B4_ROUTINE_CATALOG_MATCHED", routineCount: expected.length,
    directExecuteAclCount: expected.reduce((total, entry) => total + entry.acl.length, 0),
    catalogFingerprint, routineCatalogMatched: true, definerSafetyVerified: false,
    rowLockVerified: false, rowAuthorizationVerified: false, issuerBindingVerified: false,
    businessAclApproved: false, admissionPassed: false, databaseWritten: false,
  };
}
