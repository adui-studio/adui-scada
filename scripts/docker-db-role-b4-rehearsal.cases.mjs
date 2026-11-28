import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildScadaB4InstallPreflight,
  readScadaB4BusinessPreparation,
} from "./docker-db-role-b4-preflight.mjs";
import {
  buildScadaBusinessAclPreview,
  scadaBusinessColumnInventory,
  scadaBusinessGrantCandidates,
} from "./docker-db-role-business-acl.mjs";
import { buildScadaLockRoutinePreview } from "./docker-db-role-lock-routines.mjs";
import {
  buildScadaRestrictedWritePreview,
  buildScadaOidcCleanupRoutinePreview,
} from "./docker-db-role-restricted-writes.mjs";
import { buildScadaB4PermissionExpectations } from "./docker-db-role-b4-permission-review.mjs";
import { buildScadaB4RoutineExpectations } from "./docker-db-role-b4-routine-review.mjs";
import {
  buildScadaB4RehearsalPlan,
  DockerB4RehearsalError,
  runScadaB4RollbackRehearsal,
  runScadaB4Persistence,
} from "./docker-db-role-b4-rehearsal.mjs";
import { createScadaB4RuntimeProbeFixture } from "./docker-db-role-b4-runtime-probe.fixture.mjs";

const identity = { version: "190000", systemIdentifier: "123456789" };
const storageHash = "a".repeat(64);
const isolationFingerprint = "b".repeat(64);
const port = "18443";
const confirm = "--confirm-rehearse-scada-b4";
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
const ownerRows = () =>
  ["adui_scada_lock_owner", "adui_scada_project_create_owner", "adui_scada_oidc_cleanup_owner"].map(
    (role) => ({
      role,
      managerVerified: true,
      hardened: true,
      noMemberships: true,
      noSettings: true,
      noDependencies: true,
      noDatabaseAccess: true,
      noSchemaCreate: true,
      noTableOrColumnAccess: true,
      noSequenceAccess: true,
    }),
  );
const preparation = () => ({
  ownerInstallPreflight: buildScadaB4InstallPreflight(preflightRows()),
  businessAclPreview: buildScadaBusinessAclPreview(businessRows()),
});
const planInput = () => ({
  identity,
  storageHash,
  isolationFingerprint,
  port,
  preparation: preparation(),
});
const fixedDdl = /^(CREATE ROLE |CREATE FUNCTION |ALTER FUNCTION |GRANT |REVOKE )/u;

function fixture(fault = "") {
  const calls = [];
  const runtimeFixture = createScadaB4RuntimeProbeFixture(fault === "probe" ? "cleanup" : "");
  const permission = buildScadaB4PermissionExpectations(port);
  const groups = [
    permission.roles,
    permission.databases,
    permission.acl,
    permission.relations,
    permission.columns,
    buildScadaB4RoutineExpectations(port),
  ];
  let ddl = 0;
  let post = 0;
  let clients = 0;
  let hostCalls = 0;
  let first;
  const makeClient = (readOnly) => {
    clients++;
    const label = readOnly ? "只读" : "演练";
    const client = {
      async connect() {
        calls.push([label, "连接"]);
        if (fault === "connect" && !readOnly) throw new Error("模拟敏感错误");
      },
      async query(sql, values = []) {
        calls.push([label, sql]);
        if (sql.startsWith("BEGIN"))
          return { command: fault === "begin" && !readOnly ? "SELECT" : "BEGIN" };
        if (sql === "COMMIT") {
          if (fault === "commit") throw new Error("模拟敏感错误");
          return { command: "COMMIT" };
        }
        if (sql === "ROLLBACK") {
          if ((fault === "rollback" && !readOnly) || (fault === "read-rollback" && readOnly))
            throw new Error("模拟敏感错误");
          return { command: fault === "rollback-tag" && !readOnly ? "SELECT" : "ROLLBACK" };
        }
        if (!readOnly && post === groups.length && ddl === 93)
          return runtimeFixture.client.query(sql, values);
        if (sql.includes("pg_try_advisory_xact_lock"))
          return { rows: [{ locked: fault !== "lock", isolation: "serializable" }] };
        if (sql.includes('AS "candidateOwnerCount"')) {
          assert.ok(
            sql.includes(
              "current_setting('transaction_read_only') = '" + (readOnly ? "on" : "off") + "'",
            ),
          );
          if (!readOnly)
            assert.ok(sql.includes("current_setting('transaction_isolation') = 'serializable'"));
          const rows = preflightRows();
          if (fault === "cluster-acl" && !readOnly) rows[0].clusterFunctionAclReady = false;
          if ((fault === "preflight" && !readOnly) || (fault === "independent-drift" && readOnly))
            rows[0].candidateOwnerCount = 1;
          return { rows };
        }
        if (sql.includes('AS "noTableOrColumnAccess"')) {
          assert.equal(ddl, 3);
          const rows = ownerRows();
          if (fault === "owner") rows[0].noDatabaseAccess = false;
          return { rows };
        }
        if (sql.includes('AS "tableAccess"')) return { rows: businessRows() };
        if (sql === "SET LOCAL check_function_bodies = on")
          return { command: fault === "setting" ? "SELECT" : "SET" };
        if (fixedDdl.test(sql)) {
          assert.equal(readOnly, false);
          ddl++;
          if (fault === "ddl-error" && ddl === 5) throw new Error("模拟敏感错误");
          // 按 pg.Result.command 的真实首词语义模拟，不返回 CREATE ROLE 等完整服务器标签。
          return { command: fault === "ddl-tag" && ddl === 5 ? "SELECT" : sql.split(" ")[0] };
        }
        assert.equal(readOnly, false);
        assert.equal(ddl, 93);
        assert.match(sql, /^(SELECT|WITH) /u);
        const rows = groups[post++];
        if (!rows) throw new Error("模拟未知目录查询");
        if (fault === "cluster-public-retained" && post === 1) {
          return {
            rows: permission.roles.map((row) => ({
              ...row,
              clusterFunctionAclMatched: false,
              clusterFunctionExecute: true,
            })),
          };
        }
        return { rows: fault === "post" && post === 6 ? rows.slice(1) : rows };
      },
      async end() {
        calls.push([label, "关闭"]);
        if ((fault === "close" && !readOnly) || (fault === "read-close" && readOnly))
          throw new Error("模拟敏感错误");
      },
    };
    if (!readOnly) first = client;
    return fault === "reuse" && readOnly ? first : client;
  };
  const options = {
    identity,
    storageHash,
    isolationFingerprint,
    port,
    confirm,
    confirmFixtures: "--confirm-rollback-business-fixtures",
    expectedPlanFingerprint: buildScadaB4RehearsalPlan(planInput()).planFingerprint,
    createClient: makeClient,
    readHostBoundary: async () => {
      hostCalls++;
      if (fault === "host-error" || (fault === "host-after" && hostCalls === 2))
        throw new Error("模拟敏感错误");
      return {
        serverVersion: identity.version,
        systemIdentifier: identity.systemIdentifier,
        storageHash,
        issuer:
          fault === "host-issuer"
            ? "https://127.0.0.1:18444/realms/adui-scada"
            : "https://127.0.0.1:18443/realms/adui-scada",
        strictContractVerified: fault !== "host-contract",
        commentsVerified: fault !== "host-comments",
        formalDiscoveryVerified: fault !== "host-discovery",
      };
    },
    readIsolatedBaseline: async (client, readOnly) => {
      assert.equal(client === first, !readOnly);
      calls.push([readOnly ? "只读" : "演练", "B3 隔离基线"]);
      return {
        planFingerprint: fault === "baseline-fingerprint" ? "c".repeat(64) : isolationFingerprint,
        catalogIsolationPersisted: fault !== "not-isolated",
      };
    },
  };
  return { options, calls, clientCount: () => clients, hostCount: () => hostCalls };
}

void test("固定计划绑定集群、存储、隔离、端口和真实候选，不批准实际安装", () => {
  const input = planInput();
  const plan = buildScadaB4RehearsalPlan(input);
  assert.equal(plan.roleCount, 3);
  assert.equal(plan.statementCount, 93);
  assert.equal(plan.businessFixtureRehearsalRequired, true);
  assert.equal(plan.expectedPositiveCount, 36);
  assert.equal(plan.expectedDeniedCount, 15);
  assert.equal(plan.planOnly, true);
  assert.equal(plan.installationAllowed, false);
  assert.equal(plan.issuerBindingVerified, false);
  assert.deepEqual(buildScadaB4RehearsalPlan(planInput()), plan);
  for (const change of [
    { identity: { ...identity, systemIdentifier: "123456790" } },
    { storageHash: "c".repeat(64) },
    { isolationFingerprint: "c".repeat(64) },
    { port: "18444" },
  ]) {
    assert.notEqual(
      buildScadaB4RehearsalPlan({ ...input, ...change }).planFingerprint,
      plan.planFingerprint,
    );
  }
  for (const mutate of [
    (value) => value.ownerInstallPreflight.roleCreationPreview.push("模拟其他语句"),
    (value) => {
      value.businessAclPreview.grants[0].sql = "模拟其他语句";
    },
    (value) => {
      value.businessAclPreview.lockRoutinePreview.definitions[0].createSql = "模拟其他语句";
    },
    (value) => {
      value.businessAclPreview.restrictedWritePreview.projectCreate.createSql = "模拟其他语句";
    },
  ]) {
    const changed = planInput();
    mutate(changed.preparation);
    assert.throws(() => buildScadaB4RehearsalPlan(changed), DockerB4RehearsalError);
  }
});

void test("完整演练严格按候选顺序执行九十三条语句并独立只读核验", async () => {
  const { options, calls, clientCount, hostCount } = fixture();
  const result = await runScadaB4RollbackRehearsal(options);
  const locks = buildScadaLockRoutinePreview();
  const writes = buildScadaRestrictedWritePreview();
  const cleanup = buildScadaOidcCleanupRoutinePreview(port);
  const routine = (item) => [item.createSql, item.revokePublicSql, item.ownerSql, item.executeSql];
  const expected = [
    ...preparation().ownerInstallPreflight.roleCreationPreview,
    "REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM PUBLIC RESTRICT",
    ...locks.ownerGrants,
    ...locks.definitions.flatMap(routine),
    ...writes.projectCreate.ownerGrants,
    ...routine(writes.projectCreate),
    ...cleanup.ownerGrants,
    ...routine(cleanup),
    ...scadaBusinessGrantCandidates().map((item) => item.sql),
  ];
  assert.deepEqual(
    calls.filter(([, sql]) => fixedDdl.test(sql)).map(([, sql]) => sql),
    expected,
  );
  assert.equal(clientCount(), 2);
  assert.equal(hostCount(), 2);
  assert.equal(calls.filter(([, sql]) => sql === "ROLLBACK").length, 2);
  assert.equal(
    calls.some(([, sql]) => sql === "COMMIT"),
    false,
  );
  assert.deepEqual(calls.slice(0, 2), [
    ["演练", "连接"],
    ["演练", "BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE"],
  ]);
  assert.ok(
    calls.findIndex(([, sql]) => sql === "B3 隔离基线") <
      calls.findIndex(([, sql]) => fixedDdl.test(sql)),
  );
  assert.ok(
    calls.findIndex(([, sql]) => sql === "SET LOCAL check_function_bodies = on") <
      calls.findIndex(([, sql]) => fixedDdl.test(sql)),
  );
  const independentStart = calls.findIndex(([label]) => label === "只读");
  assert.deepEqual(calls.slice(independentStart - 2, independentStart + 2), [
    ["演练", "ROLLBACK"],
    ["演练", "关闭"],
    ["只读", "连接"],
    ["只读", "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"],
  ]);
  assert.deepEqual(calls.slice(-2), [
    ["只读", "ROLLBACK"],
    ["只读", "关闭"],
  ]);
  assert.equal(result.statementsExecuted, 93);
  assert.equal(result.runtimeProbe.positiveCount, 36);
  assert.equal(result.runtimeProbe.deniedCount, 15);
  assert.equal(result.runtimeProbe.fixturesRolledBack, true);
  assert.equal(result.runtimeProbe.rowLockConcurrencyVerified, false);
  assert.equal(result.transactionCatalogMatched, true);
  assert.equal(result.independentBaselineMatched, true);
  assert.equal(result.rolledBack, true);
  for (const flag of [
    "committed",
    "databaseWritten",
    "businessDataWritten",
    "ownerRolesPersisted",
    "installationAllowed",
    "issuerBindingVerified",
    "definerSafetyVerified",
    "rowLockVerified",
    "rowAuthorizationVerified",
    "businessAclApproved",
    "admissionPassed",
    "serviceSwitched",
  ])
    assert.equal(result[flag], false);
});

void test("缺少独立确认、无效指纹或端口时不创建连接", async () => {
  for (const change of [
    { confirm: undefined },
    { confirm: "--apply" },
    { confirmFixtures: undefined },
    { confirmFixtures: "--apply" },
    { expectedPlanFingerprint: "bad" },
    { port: "18443;" },
    { identity: { ...identity, version: "190001" } },
    { readIsolatedBaseline: undefined },
    { readHostBoundary: undefined },
  ]) {
    const { options, calls } = fixture();
    await assert.rejects(() => runScadaB4RollbackRehearsal({ ...options, ...change }));
    assert.deepEqual(calls, []);
  }
});

void test("锁、未隔离基线、计划指纹、可写前置或函数校验设置失败时零目录变更", async () => {
  for (const fault of [
    "lock",
    "not-isolated",
    "baseline-fingerprint",
    "preflight",
    "cluster-acl",
    "setting",
    "fingerprint",
  ]) {
    const { options, calls } = fixture(fault);
    if (fault === "fingerprint") options.expectedPlanFingerprint = "c".repeat(64);
    await assert.rejects(() => runScadaB4RollbackRehearsal(options), /已收到回滚标签/u);
    assert.equal(calls.filter(([, sql]) => fixedDdl.test(sql)).length, 0);
    assert.equal(
      calls.some(([, sql]) => sql === "COMMIT"),
      false,
    );
  }
});

void test("新角色越权、目录语句异常及后置漂移立即停止并独立回滚核验", async () => {
  for (const [fault, count] of [
    ["owner", 3],
    ["ddl-error", 5],
    ["ddl-tag", 5],
    ["cluster-public-retained", 93],
    ["post", 93],
    ["probe", 93],
  ]) {
    const { options, calls } = fixture(fault);
    await assert.rejects(
      () => runScadaB4RollbackRehearsal(options),
      (error) => {
        assert.match(error.message, /已收到回滚标签/u);
        if (fault === "ddl-error" || fault === "ddl-tag")
          assert.match(error.message, /第 5 条固定目录语句（GRANT）/u);
        assert.doesNotMatch(error.message, /模拟敏感/u);
        return true;
      },
    );
    assert.equal(calls.filter(([, sql]) => fixedDdl.test(sql)).length, count);
    assert.equal(
      calls.some(([label, sql]) => label === "只读" && sql === "B3 隔离基线"),
      true,
    );
    assert.equal(
      calls.some(([, sql]) => sql === "COMMIT"),
      false,
    );
  }
});

void test("连接、事务启动及回滚状态未知均拒绝且不重试", async () => {
  for (const fault of ["connect", "begin", "rollback", "rollback-tag"]) {
    const { options, calls, clientCount } = fixture(fault);
    await assert.rejects(
      () => runScadaB4RollbackRehearsal(options),
      (error) => {
        assert.doesNotMatch(error.message, /模拟敏感/u);
        if (fault === "begin") assert.match(error.message, /启动状态未知/u);
        if (fault.startsWith("rollback")) assert.match(error.message, /回滚未确认，禁止重试/u);
        return true;
      },
    );
    assert.equal(clientCount(), 1);
    assert.equal(calls.filter(([, sql]) => sql === "ROLLBACK").length, fault === "connect" ? 0 : 1);
    assert.equal(
      calls.some(([, sql]) => sql === "COMMIT"),
      false,
    );
  }
});

void test("原连接关闭异常或独立状态漂移、复用连接、回滚关闭异常不能报告成功", async () => {
  for (const fault of [
    "close",
    "independent-drift",
    "reuse",
    "read-rollback",
    "read-close",
    "host-after",
  ]) {
    const { options, calls } = fixture(fault);
    await assert.rejects(
      () => runScadaB4RollbackRehearsal(options),
      (error) => {
        assert.match(error.message, /禁止重试/u);
        assert.match(error.message, /已收到回滚标签/u);
        assert.doesNotMatch(error.message, /模拟敏感/u);
        return true;
      },
    );
    assert.equal(
      calls.some(([, sql]) => sql === "COMMIT"),
      false,
    );
  }
});

void test("原只读准备仍强制只读模式且得到相同固定计划", async () => {
  let calls = 0;
  const report = await readScadaB4BusinessPreparation(async (_step, sql) => {
    calls++;
    if (calls === 1) {
      assert.match(sql, /current_setting\('transaction_read_only'\) = 'on'/u);
      assert.doesNotMatch(sql, /current_setting\('transaction_isolation'\) = 'serializable'/u);
      return { rows: preflightRows() };
    }
    return { rows: businessRows() };
  });
  assert.equal(calls, 2);
  assert.deepEqual(
    buildScadaB4RehearsalPlan({ ...planInput(), preparation: report }),
    buildScadaB4RehearsalPlan(planInput()),
  );
});

void test("可信宿主证据缺失或 Issuer 漂移时不连接数据库", async () => {
  for (const fault of [
    "host-error",
    "host-issuer",
    "host-contract",
    "host-comments",
    "host-discovery",
  ]) {
    const { options, calls, clientCount, hostCount } = fixture(fault);
    await assert.rejects(() => runScadaB4RollbackRehearsal(options), {
      name: "Error",
      message: "B4 演练宿主严格契约、集群或 Issuer 核验失败",
    });
    assert.equal(clientCount(), 0);
    assert.equal(hostCount(), 1);
    assert.deepEqual(calls, []);
  }
});

void test("原连接关闭失败不得创建独立连接或继续宿主复核", async () => {
  const { options, calls, clientCount, hostCount } = fixture("close");
  await assert.rejects(() => runScadaB4RollbackRehearsal(options), /连接关闭失败，禁止重试/u);
  assert.equal(clientCount(), 1);
  assert.equal(hostCount(), 1);
  assert.equal(
    calls.some(([label]) => label === "只读"),
    false,
  );
  assert.equal(
    calls.some(([, sql]) => sql === "COMMIT"),
    false,
  );
});

void test("SCADA 持久化只能凭已核验演练指纹提交，关闭后独立复核", async () => {
  const rehearsal = await runScadaB4RollbackRehearsal(fixture().options);
  const h = fixture();
  const options = {
    ...h.options,
    confirm: "--confirm-apply-scada-b4",
    confirmRehearsalVerified: "--confirm-rehearsal-verified",
    expectedCatalogFingerprint: rehearsal.catalogFingerprint,
    async readInstalledState() {
      assert.deepEqual(h.calls.at(-1), ["演练", "关闭"]);
      return {
        phase: "scada-installed",
        isolationFingerprint,
        scadaCatalogFingerprint: rehearsal.catalogFingerprint,
        scadaCatalogMatched: true,
        keycloakBaselineMatched: true,
        independentConnectionsClosed: true,
        admissionPassed: false,
      };
    },
  };
  const result = await runScadaB4Persistence(options);
  assert.equal(result.committed, true);
  assert.equal(result.businessDataWritten, false);
  assert.equal(result.admissionPassed, false);
  assert.equal(h.calls.filter(([, sql]) => sql === "COMMIT").length, 1);
  assert.equal(
    h.calls.some(([, sql]) => sql === "ROLLBACK"),
    false,
  );
  assert.equal(h.clientCount(), 1);
  await assert.rejects(() => runScadaB4RollbackRehearsal(options), DockerB4RehearsalError);
});

void test("SCADA 持久化拒绝错误指纹，提交未知或独立复核失败不重试", async () => {
  const rehearsal = await runScadaB4RollbackRehearsal(fixture().options);
  for (const fault of ["fingerprint", "commit", "close", "independent"]) {
    const h = fixture(fault === "fingerprint" || fault === "independent" ? "" : fault);
    let checks = 0;
    await assert.rejects(
      () =>
        runScadaB4Persistence({
          ...h.options,
          confirm: "--confirm-apply-scada-b4",
          confirmRehearsalVerified: "--confirm-rehearsal-verified",
          expectedCatalogFingerprint:
            fault === "fingerprint" ? "f".repeat(64) : rehearsal.catalogFingerprint,
          async readInstalledState() {
            checks++;
            throw new Error("模拟敏感信息");
          },
        }),
      (error) => !error.message.includes("模拟敏感信息"),
    );
    assert.equal(
      h.calls.filter(([, sql]) => sql === "COMMIT").length,
      fault === "fingerprint" ? 0 : 1,
    );
    assert.equal(
      h.calls.some(([, sql]) => sql === "ROLLBACK"),
      fault === "fingerprint",
    );
    assert.equal(checks, fault === "independent" ? 1 : 0);
  }
});
