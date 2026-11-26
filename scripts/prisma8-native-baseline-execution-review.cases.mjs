import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewExecutionChecks } from "./prisma8-native-baseline-execution-review.mjs";

function fixture() {
  const operation = (id) => ({
    id,
    operationClass: "additive",
    target: { id: "postgres" },
    precheck: [{ sql: "SELECT NOT EXISTS (SELECT 1)", params: [] }],
    execute: [{ sql: "模拟执行语句" }],
    postcheck: [{ sql: "SELECT EXISTS (SELECT 1)", params: [id] }],
    meta: { secret: "禁止输出的元数据" },
  });
  return [
    operation("schema.public"),
    ...Array.from({ length: 45 }, (_, index) => operation("table.t" + index)),
    ...Array.from({ length: 119 }, (_, index) => operation("comment.table.t" + index)),
  ];
}

void test("按固定边界提取四十六项结构检查，不输出注释内容或其他元数据", () => {
  const operations = fixture();
  const original = structuredClone(operations);
  const report = reviewExecutionChecks(operations);
  assert.equal(report.structuralOperations, 46);
  assert.equal(report.commentOperations, 119);
  assert.deepEqual(report.structure[0], {
    id: "schema.public",
    precheck: [{ sql: "SELECT NOT EXISTS (SELECT 1)", params: [] }],
    postcheck: [{ sql: "SELECT EXISTS (SELECT 1)", params: ["schema.public"] }],
  });
  assert.equal(report.signingAllowed, false);
  assert.equal(report.deploymentAllowed, false);
  assert.doesNotMatch(JSON.stringify(report), /comment\.table|禁止输出|模拟执行语句/u);
  assert.deepEqual(operations, original);
});

void test("独立记录空检查及相同前后检查而不推断执行结果", () => {
  const operations = fixture();
  operations[0].precheck = [];
  operations[1].postcheck = [];
  operations[2].postcheck = structuredClone(operations[2].precheck);
  const report = reviewExecutionChecks(operations);
  assert.deepEqual(report.missingPrecheck, ["schema.public"]);
  assert.deepEqual(report.missingPostcheck, ["table.t0"]);
  assert.deepEqual(report.identicalChecks, ["table.t1"]);
  assert.equal(report.status, "EXECUTION_CHECK_REVIEW_REQUIRED");
});

void test("拒绝缺失、重复、错序、越界及非新增操作", () => {
  assert.throws(() => reviewExecutionChecks(fixture().slice(1)), /操作总数/u);
  for (const patch of [
    { id: "schema.public" },
    { id: "comment.table.t0" },
    { id: "table.非法" },
    { operationClass: "destructive" },
    { target: { id: "other" } },
    { execute: [] },
  ]) {
    const operations = fixture();
    operations[1] = { ...operations[1], ...patch };
    assert.throws(() => reviewExecutionChecks(operations), /标识、范围或执行步骤/u);
  }
  const operations = fixture();
  [operations[0], operations[1]] = [operations[1], operations[0]];
  assert.throws(() => reviewExecutionChecks(operations), /迁移首项/u);
});

void test("拒绝畸形检查且保留缺省参数的官方执行语义", () => {
  for (const postcheck of [null, [{}], [{ sql: "" }], [{ sql: "SELECT 1", params: null }]]) {
    const operations = fixture();
    operations[0].postcheck = postcheck;
    assert.throws(() => reviewExecutionChecks(operations), /检查/u);
  }
  const operations = fixture();
  operations[0].postcheck = [{ sql: "SELECT 1" }];
  assert.deepEqual(reviewExecutionChecks(operations).structure[0].postcheck, [
    { sql: "SELECT 1", params: [] },
  ]);
});
