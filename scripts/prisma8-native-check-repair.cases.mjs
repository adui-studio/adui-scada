import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCheckRepairSource,
  reviewCheckRepairContract,
} from "./prisma8-native-check-repair.mjs";

const statusName = "scada_identities_status_check";
const actionName = "scada_project_release_event_action_check";
const statusBefore =
  "((status)::text = ANY ((ARRAY['active'::character varying, 'disabled'::character varying])::text[]))";
const statusAfter =
  "((status)::text = ANY (ARRAY[('active'::character varying)::text, ('disabled'::character varying)::text]))";
const actionBefore =
  "((action)::text = ANY ((ARRAY['PUBLISH'::character varying, 'ROLLBACK'::character varying])::text[]))";
const actionAfter =
  "((action)::text = ANY (ARRAY[('PUBLISH'::character varying)::text, ('ROLLBACK'::character varying)::text]))";

function attribute(name, expression) {
  return "  @@check(expression: sql`" + expression + "`, map: " + JSON.stringify(name) + ")";
}

const source = [
  "// use prisma-8",
  "model Identity {",
  attribute(statusName, statusBefore),
  '  @@map("scada_identities")',
  "}",
  "model Event {",
  attribute(actionName, actionBefore),
  attribute("another_check", "generation > 0"),
  '  @@map("scada_project_release_events")',
  "}",
  "",
].join("\n");

function fixture() {
  return {
    target: "postgres",
    storage: {
      storageHash: "a".repeat(64),
      namespaces: {
        public: {
          entries: {
            table: {
              scada_identities: {
                columns: { status: { dataType: "pg/varchar", nullable: false } },
                checks: [{ name: statusName, expression: statusBefore }],
              },
              scada_project_release_events: {
                columns: { action: { dataType: "pg/varchar", nullable: false } },
                checks: [
                  { name: actionName, expression: actionBefore },
                  { name: "another_check", expression: "generation > 0" },
                ],
              },
            },
          },
        },
      },
    },
    execution: { executionHash: "c".repeat(64), mutations: {} },
    profileHash: "d".repeat(64),
    domain: { models: {} },
  };
}

function tables(contract) {
  return contract.storage.namespaces.public.entries.table;
}

function generated(original) {
  const candidate = structuredClone(original);
  candidate.storage.storageHash = "b".repeat(64);
  tables(candidate).scada_identities.checks[0].expression = statusAfter;
  tables(candidate).scada_project_release_events.checks[0].expression = actionAfter;
  return candidate;
}

void test("真实两项表达式逐字替换且保留其他 PSL 原文", () => {
  const original = fixture();
  const before = structuredClone(original);
  const result = buildCheckRepairSource(source, original);
  assert.equal(statusBefore.length, 100);
  assert.equal(statusAfter.length, 106);
  assert.equal(actionBefore.length, 101);
  assert.equal(actionAfter.length, 107);
  assert.equal(result, source.replace(statusBefore, statusAfter).replace(actionBefore, actionAfter));
  assert.deepEqual(original, before);
});

void test("拒绝缺失、重复、修改过的源属性与非 LF 输入", () => {
  for (const invalid of [
    source.replace(statusBefore, "true"),
    source.replace(statusName, "different_check"),
    source + attribute(statusName, statusBefore) + "\n",
    source.replaceAll("\n", "\r\n"),
    source.replace("// use prisma-8", ""),
  ]) {
    assert.throws(() => buildCheckRepairSource(invalid, fixture()), /修复源/u);
  }
});

void test("拒绝契约目标缺失、重复、改变允许值或改成哈希命名", () => {
  for (const mode of ["缺失", "重复", "允许值", "哈希命名"]) {
    const original = fixture();
    const checks = tables(original).scada_identities.checks;
    if (mode === "缺失") checks.pop();
    else if (mode === "重复") checks.push({ ...checks[0] });
    else if (mode === "允许值") checks[0].expression = "true";
    else Object.assign(checks[0], { prefix: "scada_identities" });
    assert.throws(() => buildCheckRepairSource(source, original), /真实证据/u);
  }
});

void test("仅两项表达式及新存储标识变化的官方候选仍为待评审", () => {
  const original = fixture();
  const candidate = generated(original);
  const before = structuredClone(original);
  const result = reviewCheckRepairContract(original, candidate);
  assert.equal(result.changedChecks.length, 2);
  assert.equal(result.originalHash, original.storage.storageHash);
  assert.equal(result.candidateHash, candidate.storage.storageHash);
  assert.equal(result.roundTripVerified, false);
  assert.equal(result.migrationPackageGenerated, false);
  assert.equal(result.signingAllowed, false);
  assert.equal(result.deploymentAllowed, false);
  assert.deepEqual(original, before);
});

void test("拒绝旧哈希及非法新哈希", () => {
  const original = fixture();
  for (const hash of [original.storage.storageHash, "", "不是哈希"]) {
    const candidate = generated(original);
    candidate.storage.storageHash = hash;
    assert.throws(() => reviewCheckRepairContract(original, candidate), /存储标识/u);
  }
});

void test("拒绝放宽或丢失目标约束及修改第三项约束", () => {
  const original = fixture();
  for (const mode of ["放宽", "删除", "第三项"]) {
    const candidate = generated(original);
    const checks = tables(candidate).scada_project_release_events.checks;
    if (mode === "放宽") checks[0].expression = "true";
    else if (mode === "删除") checks.shift();
    else checks[1].expression = "generation >= 0";
    assert.throws(() => reviewCheckRepairContract(original, candidate), /之外的变化/u);
  }
});

void test("拒绝物理字段、运行时映射、执行标识或新增任意元数据的变化", () => {
  const original = fixture();
  for (const mode of ["字段", "映射", "执行", "元数据"]) {
    const candidate = generated(original);
    if (mode === "字段") tables(candidate).scada_identities.columns.status.nullable = true;
    else if (mode === "映射") Object.assign(candidate.domain.models, { newModel: {} });
    else if (mode === "执行") candidate.execution.executionHash = "e".repeat(64);
    else Object.assign(candidate, { extra: true });
    assert.throws(() => reviewCheckRepairContract(original, candidate), /之外的变化/u);
  }
});
