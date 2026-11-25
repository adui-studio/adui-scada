import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  materializeNativeContract,
  nativeChecks,
  reviewNativeContract,
} from "./prisma8-native-contract-review.mjs";

const localColumns = ["tenant_id", "project_id", "generation", "revision", "digest", "event_id"];
const targetColumns = ["tenant_id", "project_id", "generation", "revision", "digest", "event_id"];
const checkName = "scada_state_digest_check";
const fkName = "scada_state_event_fkey";
const expression = "((digest)::text ~ '^[0-9a-f]{64}$'::text)";
const template = [
  "// use prisma-8",
  "model Event {",
  '  @@map("scada_event")',
  "}",
  "model State {",
  '  @@map("scada_state")',
  "}",
  "",
].join("\n");

// 仅构造离线模拟 IR；不改写或冒充 Prisma CLI 生成物。
function fixture() {
  const tables = {
    scada_event: {
      columns: { event_id: { dataType: "pg/uuid", nullable: false } },
      primaryKey: { columns: ["event_id"] },
      indexes: [],
      uniques: [],
      foreignKeys: [],
    },
    scada_state: {
      columns: { digest: { dataType: "pg/varchar", nullable: true } },
      primaryKey: { columns: ["tenant_id", "project_id"] },
      indexes: [{ name: "scada_state_event_key", columns: ["event_id"], unique: true }],
      uniques: [],
      foreignKeys: [],
    },
  };
  const constraints = new Map([
    ["scada_event_pkey", { name: "scada_event_pkey", kind: "p", table: "scada_event" }],
    ["scada_state_pkey", { name: "scada_state_pkey", kind: "p", table: "scada_state" }],
    [checkName, { name: checkName, kind: "c", table: "scada_state" }],
    [fkName, {
      name: fkName, kind: "f", table: "scada_state", source: localColumns,
      target: "scada_event", targetColumns,
    }],
  ]);
  const baseline = { tables, tableNames: ["scada_event", "scada_state"], constraints };
  const catalog = { constraints: [{
    constraint_name: checkName, table_name: "scada_state", kind: "c",
    validated: true, deferrable: false, deferred: false, definition: "CHECK (" + expression + ")",
  }] };
  const formal = {
    targetFamily: "sql",
    target: "postgres",
    roots: { scada_state: { model: "State" }, scada_event: { model: "Event" } },
    storage: { namespaces: { public: { entries: { table: tables } } } },
    execution: { mutations: { defaults: [] } },
    domain: { namespaces: { public: { models: {
      Event: { fields: {}, storage: {}, relations: { currentReleaseState: { cardinality: "1:1" } } },
      State: { fields: {}, storage: {}, relations: { lastReleaseEvent: { on: { localFields: ["eventId"] } } } },
    } } } },
  };
  const candidate = structuredClone(formal);
  const state = candidate.storage.namespaces.public.entries.table.scada_state;
  state.checks = [{ name: checkName, expression }];
  state.foreignKeys = [{
    name: fkName,
    source: { namespaceId: "public", tableName: "scada_state", columns: localColumns.slice() },
    target: { namespaceId: "public", tableName: "scada_event", columns: targetColumns.slice() },
    onDelete: "restrict", onUpdate: "cascade",
  }];
  const checks = nativeChecks(baseline, catalog);
  return { baseline, catalog, formal, candidate, checks, state };
}

void describe("Prisma 8 原生 Contract 候选只读生成与结构评审", () => {
  void it("逐字保留原生 CHECK 谓词并按物理名称插入独立模板", () => {
    const { baseline, checks } = fixture();
    assert.deepEqual(checks, [{ table: "scada_state", name: checkName, expression }]);
    const actual = materializeNativeContract(template, baseline, checks);
    assert.equal(actual, template.replace('  @@map("scada_state")',
      '  @@check(expression: sql`' + expression + '`, map: "' + checkName + '")\n  @@map("scada_state")'));
  });

  void it("缺失、重复、未验证或非普通 CHECK 定义均拒绝生成", () => {
    const { baseline, catalog } = fixture();
    assert.throws(() => nativeChecks(baseline, { constraints: [] }), /数量或名称重复/);
    assert.throws(() => nativeChecks(baseline, { constraints: [catalog.constraints[0], catalog.constraints[0]] }), /数量或名称重复/);
    for (const changes of [
      { table_name: "scada_event" },
      { validated: false },
      { deferrable: true },
      { definition: "CHECK (true) NO INHERIT" },
    ]) {
      assert.throws(() => nativeChecks(baseline, { constraints: [{ ...catalog.constraints[0], ...changes }] }), /超出受控范围/);
    }
  });

  void it("拒绝可能突破 PSL 字面量边界的谓词和重复或缺失的模型映射", () => {
    const { baseline, catalog, checks } = fixture();
    for (const definition of ["CHECK (x`y)", "CHECK (x${y})", "CHECK (x;y)", "CHECK (x\ny)"]) {
      assert.throws(() => nativeChecks(baseline, { constraints: [{ ...catalog.constraints[0], definition }] }), /模板字符/);
    }
    assert.throws(() => materializeNativeContract(template.replace('@@map("scada_state")', '@@map("scada_event")'), baseline, checks), /重复物理表/);
    assert.throws(() => materializeNativeContract(template.replace('  @@map("scada_state")', ""), baseline, checks), /物理表清单不一致/);
    assert.throws(() => materializeNativeContract(template + "@@check(", baseline, checks), /模板头或现有约束/);
  });

  void it("原生物理结构符合预期且运行时 IR 一致仍然禁止签名", () => {
    const { formal, candidate, baseline, checks } = fixture();
    assert.deepEqual(reviewNativeContract(formal, candidate, baseline, checks), {
      status: "STORAGE_REVIEW_REQUIRED", checks: 1, runtimeDifferences: [], signingAllowed: false,
    });
  });

  void it("原生 CHECK 缺失、弱化或使用新物理名称均拒绝", () => {
    for (const change of [[], [{ name: checkName, expression: "true" }], [{ name: "changed", expression }], [{ name: checkName, expression, prefix: "changed" }]]) {
      const { formal, candidate, baseline, checks, state } = fixture();
      state.checks = change;
      assert.throws(() => reviewNativeContract(formal, candidate, baseline, checks), /候选原生 CHECK 名称或谓词不一致/);
    }
  });

  void it("六列外键不可缩减、交换列序、改变引用范围或动作", () => {
    for (const change of [
      (key) => { key.source.columns = ["event_id"]; },
      (key) => { key.target.columns = ["event_id"]; },
      (key) => { key.source.columns.reverse(); },
      (key) => { key.target.tableName = "scada_state"; },
      (key) => { key.onDelete = "cascade"; },
      (key) => { key.name = "wrong_fkey"; },
    ]) {
      const { formal, candidate, baseline, checks, state } = fixture();
      change(state.foreignKeys[0]);
      assert.throws(() => reviewNativeContract(formal, candidate, baseline, checks), /候选物理外键名称、列、引用范围或动作不一致/);
    }
  });

  void it("拒绝字段可空性、默认值、主键、索引和额外唯一约束差异", () => {
    for (const { change, expected } of [
      { change: (state) => { state.columns.digest.nullable = false; }, expected: /候选物理字段/ },
      { change: (state) => { state.columns.digest.default = { kind: "literal", value: "" }; }, expected: /候选物理字段/ },
      { change: (state) => { state.primaryKey.columns.reverse(); }, expected: /候选主键列/ },
      { change: (state) => { state.indexes[0].unique = false; }, expected: /候选索引定义/ },
      { change: (state) => { state.indexes[0].where = "true"; }, expected: /候选索引含未审查/ },
      { change: (state) => { state.uniques.push({ columns: localColumns }); }, expected: /候选新增或改变唯一约束/ },
    ]) {
      const { formal, candidate, baseline, checks, state } = fixture();
      change(state);
      assert.throws(() => reviewNativeContract(formal, candidate, baseline, checks), expected);
    }
  });

  void it("物理一致不掩盖运行时根、生成器和双向导航差异", () => {
    const { formal, candidate, baseline, checks } = fixture();
    delete candidate.roots.scada_event;
    candidate.execution.mutations.defaults.push({ kind: "generator" });
    const models = candidate.domain.namespaces.public.models;
    delete models.Event.relations.currentReleaseState;
    models.State.relations.lastReleaseEvent.on.localFields = localColumns;
    assert.deepEqual(reviewNativeContract(formal, candidate, baseline, checks), {
      status: "STORAGE_REVIEW_REQUIRED_RUNTIME_BLOCKED",
      checks: 1,
      runtimeDifferences: ["运行时根模型", "运行时默认值及生成器", "Event.currentReleaseState", "State.lastReleaseEvent"],
      signingAllowed: false,
    });
  });
});
