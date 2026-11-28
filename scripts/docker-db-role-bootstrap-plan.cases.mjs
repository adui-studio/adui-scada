import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildDockerRoleBootstrapPlan } from "./docker-db-role-bootstrap-plan.mjs";

const hash = "a".repeat(64);
const database = {
  owner: true,
  ownerPrivileges: true,
  connect: true,
  create: true,
  temporary: true,
  publicConnect: true,
};
const schema = {
  owner: false,
  ownerPrivileges: true,
  usage: true,
  create: true,
  publicCreate: false,
};

function fixture() {
  const inventory = (total) => ({
    otherSchemas: 0,
    schemas: { public: { ...schema } },
    sequences: { total: 0, owner: 0, ownerPrivileges: 0, usage: 0, select: 0, update: 0 },
    tables: {
      total,
      owner: total,
      ownerPrivileges: total,
      select: total,
      insert: total,
      update: total,
      delete: total,
      truncate: total,
      references: total,
      trigger: total,
      maintain: total,
      anyColumnSelect: total,
      anyColumnInsert: total,
      anyColumnUpdate: total,
      anyColumnReferences: total,
    },
  });
  const scada = inventory(12);
  return {
    status: "DOCKER_DB_ROLE_REVIEW_READY",
    directoryReviewPassed: true,
    admissionPassed: false,
    databaseWritten: false,
    storageHash: hash,
    tables: 12,
    columns: 85,
    checks: 36,
    indexes: 20,
    foreignKeys: 13,
    comments: 119,
    serverVersion: "190000",
    role: {
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
    },
    databases: { adui_scada: { ...database }, adui_scada_keycloak: { ...database } },
    scada: {
      ...scada,
      schemas: { ...scada.schemas, prisma_contract: { ...schema, owner: true } },
      marker: { markerSelect: true, clusterFunctionExecute: true },
    },
    keycloak: inventory(101),
  };
}

const failure = { name: "Error", message: "角色准备预览基线不一致，禁止生成方案" };

void describe("Docker 角色准备预览", () => {
  void it("仅生成固定不可登录角色与启动读权预览", () => {
    const report = fixture();
    const original = structuredClone(report);
    const plan = buildDockerRoleBootstrapPlan(report, hash);
    assert.deepEqual(report, original);
    assert.equal(plan.status, "DOCKER_DB_ROLE_BOOTSTRAP_PLAN_READY");
    assert.equal(plan.planOnly, true);
    assert.equal(plan.admissionPassed, false);
    assert.equal(plan.databaseWritten, false);
    assert.equal(plan.serviceSwitched, false);
    assert.equal(plan.targetDatabase, "adui_scada");
    assert.deepEqual(plan.sqlPreview, [
      "CREATE ROLE adui_scada_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD NULL",
      "CREATE ROLE adui_scada_keycloak_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD NULL",
      "GRANT CONNECT ON DATABASE adui_scada TO adui_scada_runtime",
      "GRANT CONNECT ON DATABASE adui_scada_keycloak TO adui_scada_keycloak_runtime",
      "GRANT USAGE ON SCHEMA public, prisma_contract TO adui_scada_runtime",
      "GRANT SELECT (tenant_id, project_id, head_revision) ON TABLE public.scada_projects TO adui_scada_runtime",
      "GRANT SELECT (space, core_hash) ON TABLE prisma_contract.marker TO adui_scada_runtime",
      "GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO adui_scada_runtime",
    ]);
    assert.deepEqual(plan.pendingGates, [
      "ROLE_CHANGE_APPROVAL",
      "EFFECTIVE_PUBLIC_AND_CLUSTER_CONNECT_REVIEW",
      "SCADA_ROW_LOCK_AND_BUSINESS_ACL_REVIEW",
      "KEYCLOAK_OBJECT_OWNERSHIP_REVIEW",
      "LOGIN_AND_SERVICE_SWITCH_APPROVAL",
    ]);
  });

  void it("既有角色或管理权限漂移均拒绝", () => {
    for (const patch of [
      { scadaRuntimeExists: true },
      { keycloakRuntimeExists: true },
      { superuser: false },
      { setRoleMemberships: 1 },
      { login: undefined },
    ]) {
      const report = fixture();
      Object.assign(report.role, patch);
      assert.throws(() => buildDockerRoleBootstrapPlan(report, hash), failure);
    }
  });

  void it("不完整验收或契约版本变更均拒绝", () => {
    for (const patch of [
      { directoryReviewPassed: false },
      { admissionPassed: true },
      { databaseWritten: true },
      { serverVersion: "190001" },
      { storageHash: "b".repeat(64) },
      { columns: 84 },
    ]) {
      const report = { ...fixture(), ...patch };
      assert.throws(() => buildDockerRoleBootstrapPlan(report, hash), failure);
    }
    assert.throws(() => buildDockerRoleBootstrapPlan(undefined, hash), failure);
    assert.throws(() => buildDockerRoleBootstrapPlan(fixture(), "invalid"), failure);
  });

  void it("双库所有权、Schema、公共权限及标记漂移均拒绝", () => {
    const mutations = [
      (report) => {
        report.databases.adui_scada_keycloak.publicConnect = false;
      },
      (report) => {
        report.scada.tables.owner = 11;
      },
      (report) => {
        report.keycloak.tables.total = 102;
      },
      (report) => {
        report.scada.sequences.total = 1;
      },
      (report) => {
        report.keycloak.otherSchemas = 1;
      },
      (report) => {
        report.scada.schemas.prisma_contract.owner = false;
      },
      (report) => {
        report.scada.marker.clusterFunctionExecute = false;
      },
      (report) => {
        delete report.keycloak.schemas.public;
      },
    ];
    for (const mutate of mutations) {
      const report = fixture();
      mutate(report);
      assert.throws(() => buildDockerRoleBootstrapPlan(report, hash), failure);
    }
  });

  void it("预览固定且不回显非必要报告内容", () => {
    const report = fixture();
    report.unrelated = "模拟敏感内容";
    const first = buildDockerRoleBootstrapPlan(report, hash);
    const second = buildDockerRoleBootstrapPlan(report, hash);
    assert.deepEqual(first, second);
    assert.doesNotMatch(JSON.stringify(first), /模拟敏感内容/u);
    first.sqlPreview.length = 0;
    assert.equal(second.sqlPreview.length, 8);
  });
});
