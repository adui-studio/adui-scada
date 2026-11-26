import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspectOfflinePackage, nativeHash } from "./prisma8-native-baseline.mjs";
import {
  fingerprintRepairPackage,
  repairHash,
  repairInputHashes,
  requireRepairInputs,
  reviewRepairStructure,
} from "./prisma8-native-check-repair-package.mjs";

function fixture() {
  const tables = {};
  const replacements = [
    { table: "scada_identities", name: "scada_identities_status_check", column: "status", values: ["active", "disabled"] },
    { table: "scada_project_release_events", name: "scada_project_release_event_action_check", column: "action", values: ["PUBLISH", "ROLLBACK"] },
  ];
  const original = {
    storage: { storageHash: nativeHash, namespaces: { public: { entries: { table: tables } } } },
  };
  const ops = [];
  for (const { table, name, column, values } of replacements) {
    const before = "((" + column + ")::text = ANY ((ARRAY[" +
      values.map((value) => "'" + value + "'::character varying").join(", ") + "])::text[]))";
    tables[table] = { checks: [{ name, expression: before }] };
    ops.push({
      id: "table." + table,
      label: "测试结构",
      operationClass: "additive",
      target: { id: "postgres" },
      precheck: [{ sql: "SELECT false", params: [] }],
      execute: [{ sql: "CHECK (" + before + ")", params: [] }],
      postcheck: [{ sql: "SELECT $1", params: [before] }],
    });
  }
  for (let index = 0; index < 44; index++) {
    ops.push({
      id: "table.example_" + index,
      label: "测试其他结构",
      operationClass: "additive",
      target: { id: "postgres" },
      precheck: [],
      execute: [{ sql: "CREATE TABLE example_" + index + " ()" }],
      postcheck: [],
    });
  }
  const candidate = structuredClone(original);
  candidate.storage.storageHash = repairHash;
  const next = structuredClone(ops);
  for (const [index, { table, column, values }] of replacements.entries()) {
    const after = "((" + column + ")::text = ANY (ARRAY[" +
      values.map((value) => "('" + value + "'::character varying)::text").join(", ") + "]))";
    candidate.storage.namespaces.public.entries.table[table].checks[0].expression = after;
    next[index].execute[0].sql = "CHECK (" + after + ")";
    next[index].postcheck[0].params = [after];
  }
  return { original, candidate, ops, next };
}

void test("仅允许两项目标谓词精确变化并保持其余结构操作原样", () => {
  const { original, candidate, ops, next } = fixture();
  const before = structuredClone(ops);
  assert.deepEqual(reviewRepairStructure(original, candidate, ops, next), [
    "table.scada_identities", "table.scada_project_release_events",
  ]);
  assert.deepEqual(ops, before);
});

void test("拒绝目标谓词之外的检查参数、SQL 或操作分类变化", () => {
  const { original, candidate, ops, next } = fixture();
  for (const mutate of [
    (copy) => { copy[0].precheck[0].sql = "SELECT true"; },
    (copy) => { copy[1].postcheck[0].params.push("额外参数"); },
    (copy) => { copy[2].execute[0].sql += "; DROP TABLE example_2"; },
    (copy) => { copy[2].operationClass = "destructive"; },
    (copy) => { copy[0].label = "未批准描述"; },
  ]) {
    const copy = structuredClone(next);
    mutate(copy);
    assert.throws(() => reviewRepairStructure(original, candidate, ops, copy), /未批准的变化/);
  }
});

void test("拒绝缺少、重复、重排结构操作及未修复谓词", () => {
  const { original, candidate, ops, next } = fixture();
  for (const copy of [
    next.slice(1),
    [next[1], next[1], ...next.slice(2)],
    [next[1], next[0], ...next.slice(2)],
    [ops[0], ...next.slice(1)],
  ]) {
    assert.throws(() => reviewRepairStructure(original, candidate, ops, copy), /数量或标识|未批准/);
  }
});

void test("拒绝非固定目标契约及其他契约字段漂移", () => {
  const { original, candidate, ops, next } = fixture();
  const otherHash = structuredClone(candidate);
  otherHash.storage.storageHash = "c".repeat(64);
  assert.throws(() => reviewRepairStructure(original, otherHash, ops, next), /不是已验收/);
  const otherField = { ...candidate, extra: true };
  assert.throws(() => reviewRepairStructure(original, otherField, ops, next), /之外的变化/);
});

void test("拒绝伪造或缺失的固定修复文件证据", () => {
  assert.equal(Object.keys(repairInputHashes).length, 3);
  assert.throws(() => requireRepairInputs({}), /文件指纹不一致/);
  assert.throws(() => requireRepairInputs({
    "contract.prisma": Buffer.from("// 测试修复源码"),
    "contract.json": Buffer.from(JSON.stringify({ storage: { storageHash: repairHash } })),
    "contract.d.ts": Buffer.from("// 测试修复声明"),
  }), /文件指纹不一致/);
});

void test("文件证据排序稳定并覆盖诊断、配置和官方迁移标识", () => {
  const a = Buffer.from("测试原文");
  const b = Buffer.from("测试诊断");
  const hash = "a".repeat(64);
  const report = fingerprintRepairPackage({ "b.txt": b, "a.txt": a }, { "plan.ts": a }, hash);
  assert.equal(report.fingerprint, fingerprintRepairPackage({ "a.txt": a, "b.txt": b }, { "plan.ts": a }, hash).fingerprint);
  assert.notEqual(report.fingerprint, fingerprintRepairPackage({ "a.txt": a, "b.txt": a }, { "plan.ts": a }, hash).fingerprint);
  assert.notEqual(report.fingerprint, fingerprintRepairPackage({ "a.txt": a, "b.txt": b }, { "plan.ts": b }, hash).fingerprint);
  assert.notEqual(report.fingerprint, fingerprintRepairPackage({ "a.txt": a, "b.txt": b }, { "plan.ts": a }, "b".repeat(64)).fingerprint);
  assert.throws(() => fingerprintRepairPackage({}, {}, "伪造标识"), /官方新迁移标识无效/);
});

function withPlan(run) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "scada-check-plan-")));
  try {
    const output = join(root, "plan");
    const migration = join(output, "migrations", "app", "20261126T0900_scada_native_check_repair");
    const snapshot = join(output, "migrations", "snapshots", repairHash);
    mkdirSync(migration, { recursive: true });
    mkdirSync(snapshot, { recursive: true });
    const nativeText = JSON.stringify({ storage: { storageHash: repairHash } });
    const operation = { id: "table.example", label: "测试新增表", operationClass: "additive" };
    const sql = "CREATE TABLE example ()";
    const plan = {
      kind: "result", commandId: "migration.plan",
      envelope: { commandId: "migration.plan", ok: true, exitCode: 0, diagnostics: [], result: {
        ok: true, noOp: false, from: null, to: repairHash, dir: migration,
        appliedStatements: [], temporaryValues: [], emittedExtensionDirs: [],
        operations: [operation], preview: { statements: [{ text: sql, language: "sql" }] },
      } },
    };
    for (const path of [output, snapshot]) {
      writeFileSync(join(path, "contract.json"), nativeText);
      writeFileSync(join(path, "contract.d.ts"), "// 测试声明\n");
    }
    writeFileSync(join(output, "contract.prisma"), "// 测试源文件\n");
    writeFileSync(join(output, "plan.json"), JSON.stringify(plan));
    writeFileSync(join(output, "plan.stderr.txt"), "");
    writeFileSync(join(migration, "migration.ts"), "// 测试迁移源码\n");
    writeFileSync(join(migration, "migration.json"), JSON.stringify({
      from: null, to: repairHash, providedInvariants: [], migrationHash: "a".repeat(64),
    }));
    writeFileSync(join(migration, "ops.json"), JSON.stringify([{
      ...operation, target: { id: "postgres" }, precheck: [], postcheck: [], execute: [{ sql }],
    }]));
    const inspect = () => inspectOfflinePackage(root, output, nativeText, repairHash, /^\d{8}T\d{4}_scada_native_check_repair$/u);
    run({ output, snapshot, plan, inspect });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

void test("共享离线检查识别独立空起点修复规划及新目标快照", () => {
  withPlan(({ inspect }) => {
    const report = inspect();
    assert.equal(report.contractHash, repairHash);
    assert.equal(report.operations, 1);
    assert.equal(report.signingAllowed, false);
    assert.equal(report.deploymentAllowed, false);
  });
});

void test("共享离线检查拒绝旧目标、错误快照和非空起点", () => {
  withPlan(({ output, snapshot, plan, inspect }) => {
    plan.envelope.result.from = nativeHash;
    writeFileSync(join(output, "plan.json"), JSON.stringify(plan));
    assert.throws(inspect, /起点、目标或结果不一致/);
    plan.envelope.result.from = null;
    plan.envelope.result.to = nativeHash;
    writeFileSync(join(output, "plan.json"), JSON.stringify(plan));
    assert.throws(inspect, /起点、目标或结果不一致/);
    plan.envelope.result.to = repairHash;
    writeFileSync(join(output, "plan.json"), JSON.stringify(plan));
    writeFileSync(join(snapshot, "contract.json"), JSON.stringify({ storage: { storageHash: nativeHash } }));
    assert.throws(inspect, /目标快照/);
  });
});
