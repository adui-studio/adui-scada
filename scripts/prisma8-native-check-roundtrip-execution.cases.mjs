import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  acceptedPlanFingerprint,
  roundTripTarget,
  requireLockedRoundTripPlan,
  requireRoundTripBoundary,
  simulateRoundTripExecution,
} from "./prisma8-native-check-roundtrip-execution.mjs";

function fixturePlan() {
  const rows = [
    {
      table: "scada_identities",
      name: "scada_identities_status_check",
      column: "status",
      values: ["active", "disabled"],
      invalid: ["ACTIVE", "DISABLED"],
    },
    {
      table: "scada_project_release_events",
      name: "scada_project_release_event_action_check",
      column: "action",
      values: ["PUBLISH", "ROLLBACK"],
      invalid: ["publish", "rollback"],
    },
  ].flatMap(({ table, name, column, values, invalid }) => {
    const before =
      "((" +
      column +
      ")::text = ANY ((ARRAY[" +
      values.map((v) => "'" + v + "'::character varying").join(", ") +
      "])::text[]))";
    const after =
      "((" +
      column +
      ")::text = ANY (ARRAY[" +
      values.map((v) => "('" + v + "'::character varying)::text").join(", ") +
      "]))";
    return ["legacy", "repair", "replay"].map((stage) => ({
      schema: "public",
      table,
      name,
      column,
      stage,
      appliedExpression: stage === "legacy" ? before : after,
      expectedExpression: after,
      columnType: "character varying(16)",
      notNull: true,
      constraintType: "c",
      validated: true,
      local: true,
      inputs: [
        ...values.map((value) => ({ value, expectedOutcome: "accepted" })),
        ...[...invalid, "", "unknown", values[0] + " "].map((value) => ({
          value,
          expectedOutcome: "23514",
        })),
        { value: null, expectedOutcome: "23502" },
      ],
    }));
  });
  return {
    status: "NATIVE_CHECK_ROUNDTRIP_PLAN_REVIEW_REQUIRED",
    scope: "NATIVE_CHECK_ROUNDTRIP_PLAN_V1",
    originalHash: "6eec3e7459bdfa2646dc156bd6eaf22ffe60b0a0eac309622262b9742a0c68cc",
    candidateHash: "9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436",
    evidenceFingerprint: "13360ad35e8a1742f7d6a8eea99162fc11f33aea4d45d2075390ce4d2bef9a86",
    serverVersionNum: 170011,
    providerVersion: "8.0.0-rc.25",
    catalogExpression: "pg_get_expr(c.conbin, c.conrelid)",
    rows,
    planFingerprint: acceptedPlanFingerprint,
    databaseExecutionAllowed: false,
    roundTripVerified: false,
    historicalAdoptionVerified: false,
    signingAllowed: false,
    deploymentAllowed: false,
  };
}

function boundary() {
  const referenceCollation = {
    encoding: "UTF8",
    provider: "c",
    collate: "C",
    ctype: "C",
    locale: null,
    version: null,
  };
  return {
    target: { ...roundTripTarget },
    dockerEndpoint: "npipe:////./pipe/dockerDesktopLinuxEngine",
    dockerOs: "linux",
    running: true,
    scope: "prisma8-check-roundtrip",
    mountCount: 1,
    networkCount: 1,
    publishedPortCount: 1,
    databaseOwner: true,
    defaultReadOnly: true,
    containerId: "a".repeat(64),
    containerSystemIdentifier: "300",
    tcpSystemIdentifier: "300",
    frozenSystemIdentifiers: ["100", "100", "100", "200"],
    referenceCollation,
    targetCollation: { ...referenceCollation },
    checkedEmptyCategories: 23,
    empty: true,
    otherSessions: 0,
  };
}

function fixtureAdapter(plan, options = {}) {
  const calls = [];
  let stage = -1;
  let index = 0;
  let reads = 0;
  let active = false;
  let saved = false;
  return {
    calls,
    get reads() {
      return reads;
    },
    async readBoundary() {
      reads++;
      assert.equal(active, false);
      if (options.failRead === reads) throw new Error("敏感诊断占位");
      const facts = boundary();
      if (options.driftRead === reads) facts.containerId = "b".repeat(64);
      return facts;
    },
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith("BEGIN ")) {
        assert.equal(active, false);
        active = true;
        stage++;
        index = 0;
        if (options.failBegin) throw new Error("敏感诊断占位");
        return { command: "BEGIN" };
      }
      assert.equal(active, true);
      const row = plan.rows[stage];
      if (sql.startsWith("CREATE TABLE ")) return { command: "CREATE TABLE" };
      if (sql.startsWith("SELECT ")) {
        const catalog = {
          schema: row.schema,
          table: row.table,
          name: row.name,
          column: row.column,
          expression: row.expectedExpression,
          columnType: row.columnType,
          notNull: true,
          constraintType: "c",
          validated: true,
          local: true,
          noInherit: false,
          relationKind: "r",
          persistence: "p",
          columnMatches: true,
          columnCount: 1,
        };
        if (options.badCatalog === stage) catalog.expression += " ";
        if (options.badMetadata === stage) catalog.columnCount = 2;
        assert.deepEqual(params, [row.schema, row.table, row.column]);
        return {
          command: "SELECT",
          rows: options.extraCatalog === stage ? [catalog, catalog] : [catalog],
        };
      }
      if (sql === "SAVEPOINT roundtrip_input") {
        assert.equal(saved, false);
        saved = true;
        return { command: "SAVEPOINT" };
      }
      if (sql.startsWith("INSERT INTO ")) {
        assert.equal(saved, true);
        const input = row.inputs[index++];
        assert.deepEqual(params, [input.value]);
        if (input.expectedOutcome === "accepted")
          return {
            command: "INSERT",
            rowCount: options.badAccepted && index === 1 ? 0 : 1,
            rows: [{ value: input.value }],
          };
        if (options.badRejected === input.expectedOutcome)
          return { command: "INSERT", rowCount: 1, rows: [{ value: input.value }] };
        throw Object.assign(new Error("敏感诊断占位"), {
          code: options.badCode ? "XX000" : input.expectedOutcome,
          schema: options.badSchema ? "other" : row.schema,
          table: row.table,
          constraint: options.badConstraint ? "other_check" : row.name,
          column: options.badColumn ? "other_column" : row.column,
        });
      }
      if (sql === "ROLLBACK TO SAVEPOINT roundtrip_input") {
        assert.equal(saved, true);
        return { command: options.badSavepointRollback ? "SELECT" : "ROLLBACK" };
      }
      if (sql === "RELEASE SAVEPOINT roundtrip_input") {
        assert.equal(saved, true);
        saved = false;
        return { command: "RELEASE" };
      }
      if (sql === "ROLLBACK") {
        active = false;
        saved = false;
        if (options.failRollback) throw new Error("敏感诊断占位");
        return { command: "ROLLBACK" };
      }
      throw new Error("模拟适配器收到未声明命令");
    },
  };
}

void test("真实验收计划指纹完整复算并拒绝重算后的篡改及许可变化", () => {
  const plan = fixturePlan();
  assert.deepEqual(requireLockedRoundTripPlan(plan), plan);
  assert.notEqual(requireLockedRoundTripPlan(plan), plan);
  for (const variant of [
    null,
    { ...plan, deploymentAllowed: true },
    { ...plan, rows: plan.rows.toReversed() },
    { ...plan, unexpected: true },
  ]) {
    assert.throws(
      () => requireLockedRoundTripPlan(variant),
      /往返计划指纹或许可状态不符合已验收证据/u,
    );
  }
  const tampered = structuredClone(plan);
  tampered.rows[0].appliedExpression = "true";
  const payload = Object.fromEntries(
    Object.entries(tampered).filter(
      ([key]) =>
        ![
          "status",
          "planFingerprint",
          "databaseExecutionAllowed",
          "roundTripVerified",
          "historicalAdoptionVerified",
          "signingAllowed",
          "deploymentAllowed",
        ].includes(key),
    ),
  );
  tampered.planFingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  assert.throws(
    () => requireLockedRoundTripPlan(tampered),
    /往返计划指纹或许可状态不符合已验收证据/u,
  );
});

void test("仅接受模拟独立目标与四座冻结库不同的实际集群标识", () => {
  assert.deepEqual(requireRoundTripBoundary(boundary()), boundary());
  for (const changes of [
    { target: { ...roundTripTarget, port: 15433 } },
    { target: { ...roundTripTarget, host: "localhost" } },
    { tcpSystemIdentifier: "301" },
    { frozenSystemIdentifiers: ["100", "100", "200", "300"] },
    { dockerEndpoint: "tcp://remote:2375" },
    { mountCount: 2 },
    { publishedPortCount: 2 },
    { defaultReadOnly: false },
    { databaseOwner: false },
    { checkedEmptyCategories: 22 },
    { empty: false },
    { otherSessions: 1 },
    { targetCollation: { ...boundary().targetCollation, collate: "en_US" } },
    { referenceCollation: null },
  ])
    assert.throws(
      () => requireRoundTripBoundary({ ...boundary(), ...changes }),
      /独立实例身份、排序规则或空库边界不符合预期/u,
    );
});

void test("六阶段四十八项逐项参数化保存点并且仅回滚", async () => {
  const plan = fixturePlan();
  const adapter = fixtureAdapter(plan);
  const report = await simulateRoundTripExecution(plan, adapter);
  assert.equal(report.matchedInputs, 48);
  assert.equal(report.results.length, 6);
  assert.equal(adapter.reads, 13);
  const sql = adapter.calls.map((call) => call.sql);
  assert.equal(sql.filter((s) => s.startsWith("BEGIN ")).length, 6);
  assert.equal(sql.filter((s) => s === "ROLLBACK").length, 6);
  assert.equal(sql.filter((s) => s === "SAVEPOINT roundtrip_input").length, 48);
  assert.equal(sql.filter((s) => s === "ROLLBACK TO SAVEPOINT roundtrip_input").length, 48);
  assert.equal(sql.filter((s) => s === "RELEASE SAVEPOINT roundtrip_input").length, 48);
  assert.equal(
    sql.some((s) => /^(COMMIT|DROP|DELETE|ALTER)/u.test(s)),
    false,
  );
  const inserts = adapter.calls.filter((call) => call.sql.startsWith("INSERT INTO "));
  assert.deepEqual(
    inserts.map((call) => call.params),
    plan.rows.flatMap((row) => row.inputs.map(({ value }) => [value])),
  );
  assert.equal(
    inserts.every((call) => call.sql.includes("VALUES ($1)")),
    true,
  );
  for (const key of [
    "observationSourceAuthenticated",
    "databaseExecutionAllowed",
    "roundTripVerified",
    "historicalAdoptionVerified",
    "signingAllowed",
    "deploymentAllowed",
  ])
    assert.equal(report[key], false);
});

void test("修复与再次重放提交相同的已核验目录表达式", async () => {
  const plan = fixturePlan();
  const adapter = fixtureAdapter(plan);
  await simulateRoundTripExecution(plan, adapter);
  const creates = adapter.calls
    .filter((call) => call.sql.startsWith("CREATE TABLE "))
    .map((call) => call.sql);
  assert.equal(creates.length, 6);
  assert.notEqual(creates[0], creates[1]);
  assert.equal(creates[1], creates[2]);
  assert.notEqual(creates[3], creates[4]);
  assert.equal(creates[4], creates[5]);
  for (const [index, sql] of creates.entries())
    assert.equal(sql.includes(plan.rows[index].appliedExpression), true);
});

void test("反向提取漂移、额外约束或列数异常立即回滚停止", async () => {
  const plan = fixturePlan();
  for (const options of [{ badCatalog: 0 }, { badMetadata: 0 }, { extraCatalog: 0 }]) {
    const adapter = fixtureAdapter(plan, options);
    await assert.rejects(
      simulateRoundTripExecution(plan, adapter),
      /模拟阶段失败：legacy；目录原文与约束元数据/u,
    );
    assert.equal(adapter.calls.at(-1).sql, "ROLLBACK");
    assert.equal(
      adapter.calls.some((call) => call.sql.startsWith("INSERT INTO ")),
      false,
    );
    assert.equal(adapter.reads, 3);
  }
});

void test("拒绝错误的约束名、非空列、意外接受和返回行数异常", async () => {
  const plan = fixturePlan();
  for (const options of [
    { badConstraint: true },
    { badColumn: true },
    { badRejected: "23514" },
    { badAccepted: true },
    { badCode: true },
    { badSchema: true },
  ]) {
    const adapter = fixtureAdapter(plan, options);
    await assert.rejects(
      simulateRoundTripExecution(plan, adapter),
      /模拟阶段失败：legacy；参数化写入及保存点/u,
    );
    assert.equal(adapter.calls.at(-1).sql, "ROLLBACK");
    assert.equal(adapter.calls.filter((call) => call.sql.startsWith("BEGIN ")).length, 1);
  }
});

void test("初始或阶段前边界失败不执行任何事务命令", async () => {
  const plan = fixturePlan();
  for (const options of [{ failRead: 1 }, { driftRead: 2 }]) {
    const adapter = fixtureAdapter(plan, options);
    await assert.rejects(simulateRoundTripExecution(plan, adapter), /边界/u);
    assert.deepEqual(adapter.calls, []);
  }
});

void test("阶段失败与回滚、后置核验失败均保留分类且不回显原始异常", async () => {
  const plan = fixturePlan();
  const adapter = fixtureAdapter(plan, { badCatalog: 0, failRollback: true, failRead: 3 });
  await assert.rejects(simulateRoundTripExecution(plan, adapter), {
    message: "模拟阶段失败：legacy；目录原文与约束元数据；事务回滚未确认；回滚后边界未确认",
  });
  assert.equal(adapter.calls.at(-1).sql, "ROLLBACK");
  assert.equal(adapter.reads, 3);
});

void test("回滚后身份漂移不进入下一阶段", async () => {
  const plan = fixturePlan();
  const adapter = fixtureAdapter(plan, { driftRead: 3 });
  await assert.rejects(simulateRoundTripExecution(plan, adapter), /回滚后边界未确认/u);
  assert.equal(adapter.calls.filter((call) => call.sql.startsWith("BEGIN ")).length, 1);
  assert.equal(adapter.calls.at(-1).sql, "ROLLBACK");
});

void test("事务开始状态未知时仍尝试回滚且不进入创建阶段", async () => {
  const plan = fixturePlan();
  const adapter = fixtureAdapter(plan, { failBegin: true });
  await assert.rejects(
    simulateRoundTripExecution(plan, adapter),
    /模拟阶段失败：legacy；启动事务/u,
  );
  assert.deepEqual(
    adapter.calls.map((call) => call.sql),
    ["BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE", "ROLLBACK"],
  );
  assert.equal(adapter.reads, 3);
});

void test("保存点回滚命令状态不符时停止并尝试外层回滚", async () => {
  const plan = fixturePlan();
  const adapter = fixtureAdapter(plan, { badSavepointRollback: true });
  await assert.rejects(
    simulateRoundTripExecution(plan, adapter),
    /模拟阶段失败：legacy；参数化写入及保存点/u,
  );
  assert.equal(adapter.calls.filter((call) => call.sql.startsWith("INSERT INTO ")).length, 1);
  assert.equal(
    adapter.calls.some((call) => call.sql === "RELEASE SAVEPOINT roundtrip_input"),
    false,
  );
  assert.equal(adapter.calls.at(-1).sql, "ROLLBACK");
});

void test("篡改计划在访问适配器前被拒绝", async () => {
  const plan = fixturePlan();
  const adapter = fixtureAdapter(plan);
  plan.rows[0].inputs[0].value = "未知输入";
  await assert.rejects(simulateRoundTripExecution(plan, adapter), /往返计划指纹/u);
  assert.equal(adapter.reads, 0);
  assert.deepEqual(adapter.calls, []);
});
