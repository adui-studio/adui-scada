export class DockerRolePlanError extends Error {}

const roleBaseline = {
  superuser: true,
  createDatabase: true,
  createRole: true,
  replication: true,
  bypassRls: true,
  login: true,
  inherit: true,
  scadaRuntimeExists: false,
  keycloakRuntimeExists: false,
  directMemberships: 0,
  reachableMemberships: 0,
  inheritedMemberships: 0,
  setRoleMemberships: 0,
};
const databaseBaseline = {
  owner: true,
  ownerPrivileges: true,
  connect: true,
  create: true,
  temporary: true,
  publicConnect: true,
};
const publicSchemaBaseline = {
  owner: false,
  ownerPrivileges: true,
  usage: true,
  create: true,
  publicCreate: false,
};
const sequenceBaseline = {
  total: 0,
  owner: 0,
  ownerPrivileges: 0,
  usage: 0,
  select: 0,
  update: 0,
};
const tableFields = [
  "total",
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

function matches(value, baseline) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(baseline).every(
      ([key, expected]) => Object.hasOwn(value, key) && value[key] === expected,
    )
  );
}

function matchesDatabase(value, count) {
  return (
    value?.otherSchemas === 0 &&
    matches(value.schemas?.public, publicSchemaBaseline) &&
    matches(value.sequences, sequenceBaseline) &&
    matches(value.tables, Object.fromEntries(tableFields.map((field) => [field, count])))
  );
}

/** 仅生成固定角色准备预览，不执行任何 SQL。 */
export function buildDockerRoleBootstrapPlan(report, expectedHash) {
  if (
    typeof expectedHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(expectedHash) ||
    !matches(report, {
      status: "DOCKER_DB_ROLE_REVIEW_READY",
      directoryReviewPassed: true,
      admissionPassed: false,
      databaseWritten: false,
      storageHash: expectedHash,
      tables: 12,
      columns: 85,
      checks: 36,
      indexes: 20,
      foreignKeys: 13,
      comments: 119,
      serverVersion: "190000",
    }) ||
    !matches(report.role, roleBaseline) ||
    !matches(report.databases?.adui_scada, databaseBaseline) ||
    !matches(report.databases?.adui_scada_keycloak, databaseBaseline) ||
    !matchesDatabase(report.scada, 12) ||
    !matchesDatabase(report.keycloak, 101) ||
    !matches(report.scada.schemas.prisma_contract, { ...publicSchemaBaseline, owner: true }) ||
    !matches(report.scada.marker, { markerSelect: true, clusterFunctionExecute: true })
  ) {
    throw new DockerRolePlanError("角色准备预览基线不一致，禁止生成方案");
  }

  return {
    status: "DOCKER_DB_ROLE_BOOTSTRAP_PLAN_READY",
    directoryReviewPassed: true,
    planOnly: true,
    admissionPassed: false,
    databaseWritten: false,
    serviceSwitched: false,
    storageHash: expectedHash,
    serverVersion: report.serverVersion,
    targetDatabase: "adui_scada",
    sqlPreview: [
      "CREATE ROLE adui_scada_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD NULL",
      "CREATE ROLE adui_scada_keycloak_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD NULL",
      "GRANT CONNECT ON DATABASE adui_scada TO adui_scada_runtime",
      "GRANT CONNECT ON DATABASE adui_scada_keycloak TO adui_scada_keycloak_runtime",
      "GRANT USAGE ON SCHEMA public, prisma_contract TO adui_scada_runtime",
      "GRANT SELECT (tenant_id, project_id, head_revision) ON TABLE public.scada_projects TO adui_scada_runtime",
      "GRANT SELECT (space, core_hash) ON TABLE prisma_contract.marker TO adui_scada_runtime",
      "GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO adui_scada_runtime",
    ],
    pendingGates: [
      "ROLE_CHANGE_APPROVAL",
      "EFFECTIVE_PUBLIC_AND_CLUSTER_CONNECT_REVIEW",
      "SCADA_ROW_LOCK_AND_BUSINESS_ACL_REVIEW",
      "KEYCLOAK_OBJECT_OWNERSHIP_REVIEW",
      "LOGIN_AND_SERVICE_SWITCH_APPROVAL",
    ],
  };
}
