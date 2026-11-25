import assert from "node:assert/strict";
import { test } from "node:test";
import { collectHistoricalComments, reviewCatalogSupplement } from "./prisma8-native-catalog-supplement.mjs";

const legacyFingerprint = "73079d85974ddc9cbabf59741f2a4a94dd7bfff3d70a23bab27a7283456e8c52";

function fixture() {
  const names = ["scada_project_grants", ...Array.from({ length: 9 }, (_, index) => "scada_test_" + index), "scada_tag_history_batches", "scada_tag_history_records"];
  const tables = Object.fromEntries(names.map((name, index) => [name, {
    columns: Object.fromEntries(Array.from({ length: index === 0 ? 8 : 7 }, (_, column) => [index === 0 && column === 0 ? "permission" : "column_" + column, {}])),
    indexes: index < 10 ? [{ name: name + "_idx_a" }, { name: name + "_idx_b" }] : [],
    primaryKey: { columns: [index === 0 ? "permission" : "column_0", "column_1"] },
  }]));
  const constraints = new Map(names.map((table) => [table + "_pkey", { name: table + "_pkey", table, kind: "p" }]));
  const baseline = { tables, constraints };
  const catalog = {
    tables: names.map((table_name) => ({ table_name, comment: "业务表说明" })),
    columns: names.flatMap((table_name) => Object.keys(tables[table_name].columns).map((column_name) => ({ table_name, column_name, comment: "字段最终说明" }))),
    indexes: names.flatMap((table_name) => tables[table_name].indexes.map(({ name }) => ({ index_name: name, comment: "索引说明" }))),
  };
  const primaryIndexes = names.map((table_name, index) => ({
    table_name, index_name: table_name + "_pkey", constraint_name: table_name + "_pkey", index_schema: "public",
    primary: true, unique: true, valid: true, ready: true, live: true, immediate: true, simple: true, method: "btree",
    definition: "模拟主键索引定义", columns: tables[table_name].primaryKey.columns,
    comment: index >= 10 ? "主键索引说明" : null,
  }));
  const sql = [
    ...catalog.tables.map((row) => `COMMENT ON TABLE "${row.table_name}" IS '${row.comment}';`),
    ...catalog.columns.map((row) => `COMMENT ON COLUMN "${row.table_name}"."${row.column_name}" IS '${row.comment}';`),
    ...[...catalog.indexes, ...primaryIndexes.slice(-2)].map((row) => `COMMENT ON INDEX "${row.index_name}" IS '${row.comment}';`),
  ].join("\n");
  const sources = [
    `COMMENT ON COLUMN "scada_project_grants"."permission" IS '初版说明';`,
    `COMMENT ON COLUMN "scada_project_grants"."permission" IS '中间说明';`,
    sql,
  ];
  const history = collectHistoricalComments(sources);
  const actual = { report: { catalogFingerprint: legacyFingerprint }, catalog, primaryIndexes };
  const reference = structuredClone(actual);
  return { baseline, actual, reference, history, sources };
}

void test("历史注释按迁移顺序覆盖并保留转义引号", () => {
  const { history } = fixture();
  assert.equal(history.statements, 121);
  assert.equal(history.entries.size, 119);
  assert.equal(history.permissionUpdates, 3);
  assert.equal(history.entries.get("COLUMN scada_project_grants.permission"), "字段最终说明");
  const quoted = collectHistoricalComments([`COMMENT ON TABLE "scada_example" IS '中文''引号';`]);
  assert.equal(quoted.entries.get("TABLE scada_example"), "中文'引号");
});

void test("拒绝不受控注释格式、非中文及未审查的重复对象", () => {
  for (const source of [
    `COMMENT ON TABLE "scada_example" IS NULL;`,
    `COMMENT ON TABLE "scada_example" IS 'english';`,
    `COMMENT ON TABLE "scada_example"."column_0" IS '中文';`,
    `COMMENT ON TABLE "scada_example" IS '中文';\nCOMMENT ON TABLE "scada_example" IS '再次说明';`,
  ]) assert.throws(() => collectHistoricalComments([source]), /历史/);
});

void test("双库补充匹配返回独立范围指纹且禁止签名", () => {
  const { baseline, actual, reference, history } = fixture();
  const result = reviewCatalogSupplement(baseline, actual, reference, history);
  assert.equal(result.primaryIndexes, 12);
  assert.equal(result.comments, 119);
  assert.equal(result.legacyFingerprint, legacyFingerprint);
  assert.notEqual(result.fingerprint, legacyFingerprint);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.signingAllowed, false);
  assert.equal(result.status, "MATCHED_REVIEW_REQUIRED");
});

void test("拒绝主键索引缺失、重复、错约束和物理属性变化", () => {
  for (const key of ["constraint_name", "table_name", "index_schema", "primary", "unique", "valid", "ready", "live", "immediate", "simple", "method", "definition"]) {
    const { baseline, actual, reference, history } = fixture();
    Reflect.set(actual.primaryIndexes[0], key, false);
    assert.throws(() => reviewCatalogSupplement(baseline, actual, reference, history), /主键索引所属/);
  }
  const { baseline, actual, reference, history } = fixture();
  const missing = structuredClone(actual);
  missing.primaryIndexes.pop();
  assert.throws(() => reviewCatalogSupplement(baseline, missing, reference, history), /主键索引数量/);
  const duplicate = structuredClone(actual);
  duplicate.primaryIndexes[1] = duplicate.primaryIndexes[0];
  assert.throws(() => reviewCatalogSupplement(baseline, duplicate, reference, history), /主键索引名称重复/);
});

void test("拒绝主键索引列序及两库完整定义或额外注释漂移", () => {
  const { baseline, actual, reference, history } = fixture();
  const wrongColumns = structuredClone(reference);
  wrongColumns.primaryIndexes[0].columns.reverse();
  assert.throws(() => reviewCatalogSupplement(baseline, actual, wrongColumns, history), /主键索引列或顺序/);
  for (const key of ["definition", "comment"]) {
    const drift = structuredClone(reference);
    Reflect.set(drift.primaryIndexes[0], key, "不同中文定义");
    assert.throws(() => reviewCatalogSupplement(baseline, actual, drift, history), /两库主键索引完整定义或注释/);
  }
});

void test("表、字段、普通索引及两个主键索引必须精确匹配最终注释", () => {
  const { baseline, actual, reference, history } = fixture();
  for (const category of ["tables", "columns", "indexes"]) {
    const drift = structuredClone(reference);
    Reflect.set(drift.catalog[category][0], "comment", "不同中文注释");
    assert.throws(() => reviewCatalogSupplement(baseline, actual, drift, history), /数据库注释与历史最终文案/);
  }
  for (const index of [10, 11]) {
    const drift = structuredClone(reference);
    drift.primaryIndexes[index].comment = null;
    assert.throws(() => reviewCatalogSupplement(baseline, actual, drift, history), /数据库注释与历史最终文案/);
  }
});

void test("拒绝旧目录指纹变化、历史覆盖顺序错误和缺少注释对象", () => {
  const { baseline, actual, reference, history, sources } = fixture();
  const drift = structuredClone(reference);
  drift.report.catalogFingerprint = "wrong";
  assert.throws(() => reviewCatalogSupplement(baseline, actual, drift, history), /既有目录指纹/);
  const wrongOrder = collectHistoricalComments([...sources].reverse());
  assert.throws(() => reviewCatalogSupplement(baseline, actual, reference, wrongOrder), /数据库注释与历史最终文案/);
  history.entries.delete("TABLE scada_project_grants");
  assert.throws(() => reviewCatalogSupplement(baseline, actual, reference, history), /历史最终注释对象/);
});
