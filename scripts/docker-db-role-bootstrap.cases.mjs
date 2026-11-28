import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildDockerRoleBootstrapPlan } from "./docker-db-role-bootstrap-plan.mjs";
import { runDockerRoleBootstrap } from "./docker-db-role-bootstrap.mjs";

const storageHash = "a".repeat(64);
const identity = { version: "190000", systemIdentifier: "123456789" };
const names = ["adui_scada_runtime", "adui_scada_keycloak_runtime"];
const columns = [
  "public.scada_projects.tenant_id",
  "public.scada_projects.project_id",
  "public.scada_projects.head_revision",
  "prisma_contract.marker.space",
  "prisma_contract.marker.core_hash",
];
const database = { owner: true, ownerPrivileges: true, connect: true, create: true, temporary: true, publicConnect: true };
const schema = { owner: false, ownerPrivileges: true, usage: true, create: true, publicCreate: false };

function fixture() {
  const inventory = (total) => ({
    otherSchemas: 0,
    schemas: { public: { ...schema } },
    sequences: { total: 0, owner: 0, ownerPrivileges: 0, usage: 0, select: 0, update: 0 },
    tables: {
      total, owner: total, ownerPrivileges: total, select: total, insert: total,
      update: total, delete: total, truncate: total, references: total, trigger: total,
      maintain: total, anyColumnSelect: total, anyColumnInsert: total,
      anyColumnUpdate: total, anyColumnReferences: total,
    },
  });
  return {
    status: "DOCKER_DB_ROLE_REVIEW_READY", directoryReviewPassed: true,
    admissionPassed: false, databaseWritten: false, storageHash,
    tables: 12, columns: 85, checks: 36, indexes: 20, foreignKeys: 13, comments: 119,
    serverVersion: "190000",
    role: {
      superuser: true, createDatabase: true, createRole: true, replication: true,
      bypassRls: true, login: true, inherit: true, scadaRuntimeExists: false,
      keycloakRuntimeExists: false, directMemberships: 0, reachableMemberships: 0,
      inheritedMemberships: 0, setRoleMemberships: 0,
    },
    databases: { adui_scada: { ...database }, adui_scada_keycloak: { ...database } },
    scada: { ...inventory(12), schemas: { public: { ...schema }, prisma_contract: { ...schema, owner: true } }, marker: { markerSelect: true, clusterFunctionExecute: true } },
    keycloak: inventory(101),
  };
}

function mock(mode, fault = "") {
  const report = fixture();
  const statements = buildDockerRoleBootstrapPlan(report, storageHash).sqlPreview;
  if (mode === "status") {
    report.role.scadaRuntimeExists = true;
    report.role.keycloakRuntimeExists = true;
  }
  const calls = [];
  const acl = (role, kind, object, privilege) => ({ role, kind, object, privilege, grantable: false });
  let created = mode === "status";
  const client = {
    async connect() { calls.push("连接"); },
    async query(sql, values) {
      calls.push(sql);
      if (sql.startsWith("BEGIN")) return { command: "BEGIN" };
      if (sql === "ROLLBACK") {
        if (fault === "rollback") throw new Error("模拟敏感回滚异常");
        return { command: "ROLLBACK" };
      }
      if (sql === "COMMIT") {
        if (fault === "commit") throw new Error("模拟敏感提交异常");
        return { command: "COMMIT" };
      }
      if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ locked: fault !== "lock", isolation: "serializable" }] };
      if (statements.includes(sql)) {
        if (fault === "sql" && sql === statements[3]) throw new Error("模拟敏感语句异常");
        if (sql === statements.at(-1)) created = true;
        return { command: sql.startsWith("CREATE ROLE") ? "CREATE ROLE" : "GRANT" };
      }
      if (sql.includes("pg_catalog.pg_authid r")) return { rows: names.map((role) => ({ role, hardened: fault !== "attributes", noMemberships: true, noSettings: true, noUnexpectedDependencies: true })) };
      if (sql.includes("entries AS")) {
        const rows = [
          acl(names[0], "database", "adui_scada", "CONNECT"),
          acl(names[1], "database", "adui_scada_keycloak", "CONNECT"),
          acl(names[0], "schema", "public", "USAGE"),
          acl(names[0], "schema", "prisma_contract", "USAGE"),
          ...columns.map((column) => acl(names[0], "column", column, "SELECT")),
          acl(names[0], "function", "pg_catalog.pg_control_system()", "EXECUTE"),
        ];
        if (fault === "acl") rows[0].grantable = true;
        if (fault === "extra-acl") rows.push(acl(names[1], "column", columns[0], "SELECT"));
        return { rows };
      }
      if (sql.includes("relations AS")) return { rows: names.map((role) => ({ role, noDatabaseCreate: true, noSchemaCreate: true, noTableOrColumnWrites: fault !== "effective", noSequencePrivileges: true, businessConnect: true, keycloakConnect: true })) };
      if (sql.includes("has_column_privilege")) return { rows: (fault === "column" ? columns.slice(1) : columns).map((object) => ({ role: names[0], object })) };
      if (sql === "SET LOCAL ROLE adui_scada_runtime" || sql === "SET LOCAL ROLE NONE") return { command: "SET" };
      if (sql.includes("session_user::text")) return { rows: [{ role: names[0], sessionRole: "adui_scada", database: "adui_scada", systemIdentifier: fault === "probe" ? "999" : identity.systemIdentifier, storageHash }] };
      if (sql.startsWith("SELECT tenant_id, project_id, head_revision")) {
        assert.equal(values.length, 1);
        assert.match(values[0], /^prisma8-role-bootstrap-/u);
        return { rows: fault === "unexpected-row" ? [{}] : [] };
      }
      throw new Error("模拟未知语句");
    },
    async end() {
      calls.push("关闭");
      if (fault === "close") throw new Error("模拟敏感关闭异常");
    },
  };
  const options = {
    mode, report, identity, storageHash,
    createClient: () => { calls.push("构造"); return client; },
    readDirectory: async (_client, expected, hash, readOnly) => {
      assert.equal(_client, client);
      assert.equal(expected, identity);
      assert.equal(hash, storageHash);
      assert.equal(readOnly, mode === "status");
      calls.push("目录核验");
      return {
        role: { ...report.role, scadaRuntimeExists: created || fault === "baseline", keycloakRuntimeExists: created },
        databases: report.databases,
        scada: report.scada,
      };
    },
  };
  return { options, calls, statements };
}

void describe("Docker 角色准备事务", () => {
  void it("演练按固定顺序执行八条语句并回滚，不提交或切换服务", async () => {
    const { options, calls, statements } = mock("rehearse");
    const result = await runDockerRoleBootstrap(options);
    assert.equal(result.status, "DOCKER_DB_ROLE_BOOTSTRAP_REHEARSED");
    assert.equal(result.rolesPrepared, false);
    assert.equal(result.rolledBack, true);
    assert.equal(result.catalogStatementsExecuted, true);
    assert.equal(result.databaseWritten, false);
    assert.equal(result.businessDataWritten, false);
    assert.equal(result.admissionPassed, false);
    assert.equal(result.serviceSwitched, false);
    assert.deepEqual(calls.filter((sql) => statements.includes(sql)), statements);
    assert.deepEqual(calls.slice(-3), ["目录核验", "ROLLBACK", "关闭"]);
    assert.equal(calls.includes("COMMIT"), false);
    assert.equal(calls.includes("SET LOCAL ROLE adui_scada_runtime"), true);
    assert.equal(calls.includes("SET LOCAL ROLE NONE"), true);
  });
  void it("正式提交只在全部核验完成后发生，明确区分目录写入和业务写入", async () => {
    const { options, calls } = mock("create");
    const result = await runDockerRoleBootstrap(options);
    assert.equal(result.status, "DOCKER_DB_ROLE_BOOTSTRAP_CREATED");
    assert.equal(result.rolesPrepared, true);
    assert.equal(result.committed, true);
    assert.equal(result.databaseWritten, true);
    assert.equal(result.businessDataWritten, false);
    assert.equal(result.admissionPassed, false);
    assert.deepEqual(calls.slice(-3), ["目录核验", "COMMIT", "关闭"]);
    assert.equal(calls.includes("ROLLBACK"), false);
  });
  void it("非法模式、既有角色或报告漂移在构造连接前拒绝", async () => {
    const { options, calls } = mock("create");
    await assert.rejects(runDockerRoleBootstrap({ ...options, mode: "apply" }), /证据不一致/u);
    options.report.role.scadaRuntimeExists = true;
    await assert.rejects(runDockerRoleBootstrap(options), /基线不一致/u);
    await assert.rejects(runDockerRoleBootstrap({ ...options, mode: "status" }), /基线不一致/u);
    options.report.role.scadaRuntimeExists = false;
    options.report.storageHash = "b".repeat(64);
    await assert.rejects(runDockerRoleBootstrap(options), /基线不一致/u);
    assert.deepEqual(calls, []);
  });
  void it("独立锁未取得或事务内目录漂移时不执行角色语句", async () => {
    for (const fault of ["lock", "baseline"]) {
      const { options, calls, statements } = mock("create", fault);
      await assert.rejects(runDockerRoleBootstrap(options), /保留现场/u);
      assert.equal(calls.some((sql) => statements.includes(sql)), false);
      assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
    }
  });
  void it("语句、角色属性、精确授权、实际权限及角色读取异常均回滚并脱敏", async () => {
    for (const fault of ["sql", "attributes", "acl", "extra-acl", "effective", "column", "probe", "unexpected-row"]) {
      const { options, calls } = mock("create", fault);
      await assert.rejects(runDockerRoleBootstrap(options), (error) => {
        assert.match(error.message, /保留现场/u);
        assert.doesNotMatch(error.message, /模拟敏感/u);
        return true;
      });
      assert.equal(calls.includes("COMMIT"), false);
      assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
    }
  });
  void it("提交结果未知时不自动回滚、重试或冒充成功", async () => {
    const { options, calls } = mock("create", "commit");
    await assert.rejects(runDockerRoleBootstrap(options), { name: "Error", message: "角色事务提交结果未知，禁止重试，请先执行只读状态核查" });
    assert.deepEqual(calls.slice(-2), ["COMMIT", "关闭"]);
    assert.equal(calls.includes("ROLLBACK"), false);
  });
  void it("回滚或连接关闭未确认时拒绝成功", async () => {
    for (const fault of ["rollback", "close"]) {
      const { options, calls } = mock("rehearse", fault);
      await assert.rejects(runDockerRoleBootstrap(options), /回滚未确认|连接关闭失败/u);
      assert.equal(calls.includes("COMMIT"), false);
      assert.equal(calls.at(-1), "关闭");
    }
    const { options } = mock("create", "close");
    await assert.rejects(runDockerRoleBootstrap(options), /角色事务已提交；连接关闭失败/u);
  });
  void it("已存在双角色仅通过独立只读状态核查验证，不再执行创建或提交", async () => {
    const { options, calls, statements } = mock("status");
    const result = await runDockerRoleBootstrap(options);
    assert.equal(result.status, "DOCKER_DB_ROLE_BOOTSTRAP_STATUS_READY");
    assert.equal(result.rolesPrepared, true);
    assert.equal(result.databaseWritten, false);
    assert.equal(result.catalogStatementsExecuted, false);
    assert.equal(calls.includes("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"), true);
    assert.equal(calls.some((sql) => statements.includes(sql) || sql === "COMMIT"), false);
    assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
    const absent = mock("rehearse");
    const empty = await runDockerRoleBootstrap({ ...absent.options, mode: "status" });
    assert.equal(empty.rolesPrepared, false);
    assert.deepEqual(absent.calls, []);
  });
});
