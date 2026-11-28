import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createScadaB4HostReader,
  createScadaB4IsolationReader,
  readScadaB4HostPlan,
} from "./docker-db-role-b4-host.mjs";
import { DockerB4RehearsalError } from "./docker-db-role-b4-rehearsal.mjs";
import { scadaBusinessColumnInventory } from "./docker-db-role-business-acl.mjs";

const identity = { version: "190000", systemIdentifier: "123456789" };
const storageHash = "a".repeat(64);
const isolationFingerprint = "b".repeat(64);
const port = "18443";
const issuer = "https://127.0.0.1:18443/realms/adui-scada";
const host = {
  serverVersion: identity.version,
  systemIdentifier: identity.systemIdentifier,
  storageHash,
  issuer,
  strictContractVerified: true,
  commentsVerified: true,
  formalDiscoveryVerified: true,
};
const isolation = { planFingerprint: isolationFingerprint, catalogIsolationPersisted: true };
const report = () => ({
  role: { scadaRuntimeExists: true, keycloakRuntimeExists: true },
  databases: {
    adui_scada: { publicConnect: false },
    adui_scada_keycloak: { publicConnect: false },
  },
  scada: { marker: { markerSelect: true } },
});

function baselineFixture(fault = "") {
  const calls = [];
  const original = report();
  const inventory = { roles: [] };
  const client = {
    async query(sql) {
      calls.push(sql);
      return { rows: [] };
    },
  };
  let reads = 0;
  const options = {
    report: original,
    identity,
    storageHash,
    validateBootstrap(value, hash, isolated) {
      calls.push("bootstrap");
      assert.equal(value.role.scadaRuntimeExists, false);
      assert.equal(value.role.keycloakRuntimeExists, false);
      assert.equal(hash, storageHash);
      assert.equal(isolated, true);
      if (fault === "bootstrap") throw new Error("模拟敏感异常");
    },
    async readDirectory(connection, actualIdentity, hash, readOnly) {
      calls.push("directory");
      assert.equal(connection, client);
      assert.equal(actualIdentity, identity);
      assert.equal(hash, storageHash);
      assert.equal(typeof readOnly, "boolean");
      reads++;
      const value = report();
      if ((fault === "before" && reads === 1) || (fault === "after" && reads === 2))
        value.scada.marker.markerSelect = false;
      return value;
    },
    async verifyPrepared(connection, actualIdentity, hash, isolated) {
      calls.push("prepared");
      assert.equal(connection, client);
      assert.equal(actualIdentity, identity);
      assert.equal(hash, storageHash);
      assert.equal(isolated, true);
      if (fault === "prepared") throw new Error("模拟敏感异常");
    },
    async readIsolationDirectory(query) {
      calls.push("inventory");
      assert.deepEqual(await query("目录", "SELECT 1"), { rows: [] });
      return inventory;
    },
    reviewIsolationInventory(value, actualIdentity, hash, isolated) {
      calls.push("review");
      assert.equal(value, inventory);
      assert.equal(actualIdentity, identity);
      assert.equal(hash, storageHash);
      assert.equal(isolated, true);
      if (fault === "inventory") throw new Error("模拟敏感异常");
      return { planFingerprint: fault === "fingerprint" ? "bad" : isolationFingerprint };
    },
  };
  return { calls, client, options };
}

void test("隔离适配器在调用者同一连接上复用 B2 和完整 B3.3 核验", async () => {
  for (const readOnly of [true, false]) {
    const { calls, client, options } = baselineFixture();
    const reader = createScadaB4IsolationReader(options);
    options.report.scada.marker.markerSelect = false;
    assert.deepEqual(await reader(client, readOnly), isolation);
    assert.deepEqual(calls, [
      "bootstrap",
      "directory",
      "prepared",
      "inventory",
      "SELECT 1",
      "review",
      "directory",
    ]);
  }
});

void test("未隔离或缺少独立运行角色的初始报告在目录调用前拒绝", () => {
  for (const mutate of [
    (value) => {
      value.databases.adui_scada.publicConnect = true;
    },
    (value) => {
      value.databases.adui_scada_keycloak.publicConnect = true;
    },
    (value) => {
      value.role.scadaRuntimeExists = false;
    },
    (value) => {
      value.role.keycloakRuntimeExists = false;
    },
  ]) {
    const { calls, options } = baselineFixture();
    mutate(options.report);
    assert.throws(() => createScadaB4IsolationReader(options), DockerB4RehearsalError);
    assert.deepEqual(calls, []);
  }
});

void test("同事务目录、启动授权、全集群指纹及后置漂移均失败关闭", async () => {
  for (const [fault, length] of [
    ["before", 2],
    ["prepared", 3],
    ["inventory", 6],
    ["fingerprint", 6],
    ["after", 7],
  ]) {
    const { calls, client, options } = baselineFixture(fault);
    await assert.rejects(
      () => createScadaB4IsolationReader(options)(client, false),
      (error) => {
        assert.ok(error instanceof DockerB4RehearsalError);
        assert.doesNotMatch(error.message, /模拟敏感异常/u);
        return true;
      },
    );
    assert.equal(calls.length, length);
  }
});

function hostFixture(fault = "") {
  const calls = [];
  let inspections = 0;
  const options = {
    identity,
    storageHash,
    port,
    inspectIdentity() {
      calls.push("identity");
      inspections++;
      return (fault === "before" && inspections === 1) || (fault === "after" && inspections === 2)
        ? { ...identity, systemIdentifier: "987654321" }
        : identity;
    },
    verifyContract() {
      calls.push("contract");
      return fault !== "contract";
    },
    async verifyComments() {
      calls.push("comments");
      return fault !== "comments";
    },
    verifyOidc() {
      calls.push("oidc");
      if (fault === "throw") throw new Error("模拟敏感异常");
      return {
        issuer: fault === "issuer" ? "https://127.0.0.1:18444/realms/adui-scada" : issuer,
        formalDiscoveryVerified: fault !== "discovery",
      };
    },
  };
  return { calls, options };
}

void test("真实宿主适配器只有五个检查均通过才产生完整固定证据", async () => {
  const { calls, options } = hostFixture();
  assert.deepEqual(await createScadaB4HostReader(options)(), host);
  assert.deepEqual(calls, ["identity", "contract", "comments", "oidc", "identity"]);
  for (const invalid of ["0", "65536", "018443", "18443;", 18443]) {
    assert.throws(
      () => createScadaB4HostReader({ ...options, port: invalid }),
      DockerB4RehearsalError,
    );
  }
  const canonical = "https://127.0.0.1/realms/adui-scada";
  assert.equal(
    (
      await createScadaB4HostReader({
        ...options,
        port: "443",
        verifyOidc: () => ({
          issuer: canonical,
          formalDiscoveryVerified: true,
        }),
      })()
    ).issuer,
    canonical,
  );
});

void test("集群漂移、契约注释或 Discovery 失败不得生成宿主证据", async () => {
  for (const [fault, count] of [
    ["before", 1],
    ["contract", 2],
    ["comments", 3],
    ["throw", 4],
    ["issuer", 4],
    ["discovery", 4],
    ["after", 5],
  ]) {
    const { calls, options } = hostFixture(fault);
    await assert.rejects(
      () => createScadaB4HostReader(options)(),
      (error) => {
        assert.ok(error instanceof DockerB4RehearsalError);
        assert.doesNotMatch(error.message, /模拟敏感异常/u);
        return true;
      },
    );
    assert.equal(calls.length, count);
  }
});

const preflightRows = () => [
  {
    managerVerified: true,
    clusterFunctionAclReady: true,
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
  },
];
const businessRows = () =>
  scadaBusinessColumnInventory().flatMap(({ table, columns }) =>
    ["adui_scada_runtime", "adui_scada_keycloak_runtime"].flatMap((role) =>
      columns.map((column) => ({
        role,
        table,
        column,
        kind: "r",
        owner: false,
        tableAccess: false,
        select:
          role === "adui_scada_runtime" &&
          table === "scada_projects" &&
          ["tenant_id", "project_id", "head_revision"].includes(column),
        insert: false,
        update: false,
        references: false,
        grantable: false,
      })),
    ),
  );

function planFixture(fault = "") {
  const calls = [];
  let checks = 0;
  let hosts = 0;
  const client = {
    async connect() {
      calls.push("connect");
    },
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith("BEGIN")) return { command: fault === "begin" ? "SELECT" : "BEGIN" };
      if (sql === "ROLLBACK") return { command: fault === "rollback" ? "SELECT" : "ROLLBACK" };
      if (sql.includes('AS "candidateOwnerCount"')) return { rows: preflightRows() };
      if (sql.includes('AS "tableAccess"')) return { rows: businessRows() };
      throw new Error("模拟未知查询");
    },
    async end() {
      calls.push("end");
      if (fault === "close") throw new Error("模拟敏感异常");
    },
  };
  return {
    calls,
    options: {
      identity,
      storageHash,
      port,
      createClient(readOnly) {
        assert.equal(readOnly, true);
        return client;
      },
      async readIsolatedBaseline(connection, readOnly) {
        calls.push("baseline");
        assert.equal(connection, client);
        assert.equal(readOnly, true);
        checks++;
        return fault === "isolated"
          ? { ...isolation, catalogIsolationPersisted: false }
          : fault === "drift" && checks === 2
            ? { ...isolation, planFingerprint: "c".repeat(64) }
            : isolation;
      },
      async readHostBoundary() {
        calls.push("host");
        hosts++;
        return fault === "host" || (fault === "host-after" && hosts === 2)
          ? { ...host, commentsVerified: false }
          : host;
      },
    },
  };
}

void test("真实候选计划只读生成并在回滚关闭后再次检查宿主", async () => {
  const { calls, options } = planFixture();
  const plan = await readScadaB4HostPlan(options);
  assert.equal(plan.statementCount, 93);
  assert.equal(plan.isolationFingerprint, isolationFingerprint);
  assert.match(plan.planFingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(plan.rolledBack, true);
  assert.equal(plan.hostBoundaryVerified, true);
  assert.equal(plan.installationAllowed, false);
  assert.equal(plan.admissionPassed, false);
  assert.equal(plan.databaseWritten, false);
  assert.deepEqual(calls.slice(0, 4), [
    "host",
    "connect",
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    "baseline",
  ]);
  assert.deepEqual(calls.slice(-4), ["baseline", "ROLLBACK", "end", "host"]);
  assert.ok(calls.every((item) => !/^(CREATE |ALTER |GRANT |REVOKE |COMMIT)/u.test(item)));
});

void test("计划缺少真实宿主、隔离、回滚或关闭证据均不得返回指纹", async () => {
  for (const fault of ["host", "begin", "isolated", "drift", "rollback", "close", "host-after"]) {
    const { calls, options } = planFixture(fault);
    await assert.rejects(() => readScadaB4HostPlan(options), DockerB4RehearsalError);
    if (fault === "host") assert.deepEqual(calls, ["host"]);
    else {
      assert.equal(calls.filter((item) => item === "ROLLBACK").length, 1);
      assert.equal(calls.filter((item) => item === "end").length, 1);
    }
    assert.ok(calls.every((item) => !/^(CREATE |ALTER |GRANT |REVOKE |COMMIT)/u.test(item)));
  }
});
