import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCheckRoundTripPlan, reviewCheckRoundTripObservations } from "./prisma8-native-check-roundtrip.mjs";

function fixture() {
  const entries = [
    { table: "scada_identities", name: "scada_identities_status_check", column: "status", values: ["active", "disabled"] },
    { table: "scada_project_release_events", name: "scada_project_release_event_action_check", column: "action", values: ["PUBLISH", "ROLLBACK"] },
  ];
  const tables = Object.fromEntries(entries.map(({ table, name, column, values }) => [table, {
    columns: { [column]: { dataType: "pg/varchar", typeParams: { length: 16 }, nullable: false } },
    checks: [{ name, expression: "((" + column + ")::text = ANY ((ARRAY[" + values.map((value) => "'" + value + "'::character varying").join(", ") + "])::text[]))" }],
  }]));
  const original = { storage: { storageHash: "6eec3e7459bdfa2646dc156bd6eaf22ffe60b0a0eac309622262b9742a0c68cc", namespaces: { public: { entries: { table: tables } } } } };
  const candidate = structuredClone(original);
  candidate.storage.storageHash = "9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436";
  for (const { table, column, values } of entries) {
    candidate.storage.namespaces.public.entries.table[table].checks[0].expression = "((" + column + ")::text = ANY (ARRAY[" + values.map((value) => "('" + value + "'::character varying)::text").join(", ") + "]))";
  }
  return { original, candidate };
}

function observations(plan) {
  return {
    planFingerprint: plan.planFingerprint, serverVersionNum: plan.serverVersionNum,
    rows: plan.rows.map(({ schema, table, name, column, stage, appliedExpression, expectedExpression, columnType, notNull, constraintType, validated, local, inputs }) => ({
      schema, table, name, column, stage, appliedExpression, expression: expectedExpression, columnType, notNull, constraintType, validated, local,
      outcomes: inputs.map(({ expectedOutcome }) => expectedOutcome),
    })),
  };
}

void test("固定两项约束覆盖旧表达式、修复及再次重放六个阶段", () => {
  const { original, candidate } = fixture();
  const plan = buildCheckRoundTripPlan(original, candidate);
  assert.equal(plan.rows.length, 6);
  assert.deepEqual(plan.rows.map((row) => row.stage), ["legacy", "repair", "replay", "legacy", "repair", "replay"]);
  assert.notEqual(plan.rows[0].appliedExpression, plan.rows[0].expectedExpression);
  assert.equal(plan.rows[1].appliedExpression, plan.rows[0].expectedExpression);
  assert.equal(plan.rows[2].appliedExpression, plan.rows[1].expectedExpression);
  assert.equal(plan.planFingerprint, buildCheckRoundTripPlan(original, candidate).planFingerprint);
  assert.equal(plan.databaseExecutionAllowed, false);
});

void test("每阶段覆盖允许值、拒绝值及非空约束共四十八项", () => {
  const { original, candidate } = fixture();
  const plan = buildCheckRoundTripPlan(original, candidate);
  assert.equal(plan.rows.reduce((sum, row) => sum + row.inputs.length, 0), 48);
  for (const row of plan.rows) {
    assert.equal(row.inputs.filter((input) => input.expectedOutcome === "accepted").length, 2);
    assert.equal(row.inputs.filter((input) => input.expectedOutcome === "23514").length, 5);
    assert.deepEqual(row.inputs.at(-1), { value: null, expectedOutcome: "23502" });
  }
});

void test("拒绝非固定契约、未授权谓词变化及目标列类型变化", () => {
  const { original, candidate } = fixture();
  const other = structuredClone(candidate);
  other.storage.storageHash = "a".repeat(64);
  assert.throws(() => buildCheckRoundTripPlan(original, other), /已验收契约/u);
  other.storage.storageHash = candidate.storage.storageHash;
  other.storage.namespaces.public.entries.table.scada_identities.checks[0].expression = "true";
  assert.throws(() => buildCheckRoundTripPlan(original, other), /之外的变化/u);
  for (const contract of [original, candidate]) contract.storage.namespaces.public.entries.table.scada_identities.columns.status.nullable = true;
  assert.throws(() => buildCheckRoundTripPlan(original, candidate), /列类型或非空/u);
});

void test("完整匹配的模拟观察仍不授予真实往返、签名或部署许可", () => {
  const { original, candidate } = fixture();
  const report = reviewCheckRoundTripObservations(original, candidate, observations(buildCheckRoundTripPlan(original, candidate)));
  assert.equal(report.observationsMatch, true);
  assert.equal(report.results.length, 6);
  for (const key of ["observationSourceAuthenticated", "databaseExecutionAllowed", "roundTripVerified", "historicalAdoptionVerified", "signingAllowed", "deploymentAllowed"]) assert.equal(report[key], false);
});

void test("旧形式未复现、修复再次漂移以及提交表达式变化均不匹配", () => {
  const { original, candidate } = fixture();
  const plan = buildCheckRoundTripPlan(original, candidate);
  const observed = observations(plan);
  observed.rows[0].expression = plan.rows[0].appliedExpression;
  observed.rows[2].expression += " ";
  observed.rows[4].appliedExpression = "true";
  const report = reviewCheckRoundTripObservations(original, candidate, observed);
  assert.equal(report.observationsMatch, false);
  assert.equal(report.results[0].expressionMatches, false);
  assert.equal(report.results[2].expressionMatches, false);
  assert.equal(report.results[4].appliedMatches, false);
});

void test("约束未验证、非空变化或错误拒绝类别都不会被当作匹配", () => {
  const { original, candidate } = fixture();
  const observed = observations(buildCheckRoundTripPlan(original, candidate));
  observed.rows[0].validated = false;
  observed.rows[1].notNull = false;
  observed.rows[2].outcomes[7] = "23514";
  observed.rows[3].outcomes[2] = "accepted";
  const report = reviewCheckRoundTripObservations(original, candidate, observed);
  assert.equal(report.observationsMatch, false);
  assert.equal(report.results[0].metadataMatches, false);
  assert.equal(report.results[1].metadataMatches, false);
  assert.equal(report.results[2].outcomeMismatchCount, 1);
  assert.equal(report.results[3].outcomeMismatchCount, 1);
});

void test("拒绝缺失、重排、重复阶段及伪造版本或计划指纹", () => {
  const { original, candidate } = fixture();
  const good = observations(buildCheckRoundTripPlan(original, candidate));
  const variants = [
    { ...good, serverVersionNum: 170012 }, { ...good, planFingerprint: "a".repeat(64) },
    { ...good, rows: good.rows.slice(1) }, { ...good, rows: good.rows.toReversed() },
    { ...good, rows: [good.rows[0], ...good.rows.slice(0, 5)] },
  ];
  for (const value of variants) assert.throws(() => reviewCheckRoundTripObservations(original, candidate, value), /往返观察/u);
});

void test("拒绝额外字段、未知结果及超长原文且不回显不匹配正文", () => {
  const { original, candidate } = fixture();
  const good = observations(buildCheckRoundTripPlan(original, candidate));
  const mismatch = structuredClone(good);
  mismatch.rows[0].expression = "敏感诊断占位";
  assert.equal(JSON.stringify(reviewCheckRoundTripObservations(original, candidate, mismatch)).includes("敏感诊断占位"), false);
  for (const patch of [{ diagnostic: "敏感诊断占位" }, { outcomes: ["unknown", ...good.rows[0].outcomes.slice(1)] }, { expression: "x".repeat(4097) }]) {
    const value = structuredClone(good);
    Object.assign(value.rows[0], patch);
    assert.throws(() => reviewCheckRoundTripObservations(original, candidate, value), /往返观察字段/u);
  }
});
