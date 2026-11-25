import assert from "node:assert/strict";
import { test } from "node:test";
import { collectHistoricalComments } from "./prisma8-native-catalog-supplement.mjs";
import { commentPreview, expectedStatements, reviewStatements } from "./prisma8-native-baseline-ddl.mjs";

function fixture() {
  const name = "scada_tag_history_batches";
  const tables = {
    [name]: {
      columns: {
        tenant_id: { dataType: "pg/varchar", typeParams: { length: 128 }, nullable: false },
        seq: { dataType: "pg/int8", nullable: false, default: { kind: "literal", value: "0" } },
        created_at: { dataType: "pg/timestamptz", typeParams: { precision: 6 }, nullable: true, default: { kind: "function", expression: "now()" } },
      },
      primaryKey: { name: name + "_pkey", columns: ["tenant_id", "seq"] },
      uniques: [],
      checks: [{ name: name + "_check", expression: "(seq >= 0)" }],
      indexes: [{ name: name + "_idx", columns: ["tenant_id", "seq"], unique: true }],
      foreignKeys: [{ name: name + "_fkey", source: { namespaceId: "public", tableName: name, columns: ["tenant_id", "seq"] }, target: { namespaceId: "public", tableName: name, columns: ["tenant_id", "seq"] }, onDelete: "restrict", onUpdate: "cascade" }],
    },
  };
  const sql = [
    ["schema.public", 'CREATE SCHEMA IF NOT EXISTS "public"'],
    ["table." + name, 'CREATE TABLE "public"."scada_tag_history_batches" (\n  "created_at" timestamptz(6) DEFAULT (now()),\n  "seq" int8 DEFAULT \'0\'::int8 NOT NULL,\n  "tenant_id" character varying(128) NOT NULL,\n  CONSTRAINT "scada_tag_history_batches_pkey" PRIMARY KEY ("tenant_id", "seq"),\n  CONSTRAINT "scada_tag_history_batches_check" CHECK ((seq >= 0))\n)'],
    ["index." + name + "." + name + "_idx", 'CREATE UNIQUE INDEX "scada_tag_history_batches_idx" ON "public"."scada_tag_history_batches" ("tenant_id", "seq")'],
    ["foreignKey." + name + "." + name + "_fkey", 'ALTER TABLE "public"."scada_tag_history_batches"\nADD CONSTRAINT "scada_tag_history_batches_fkey"\nFOREIGN KEY ("tenant_id", "seq")\nREFERENCES "public"."scada_tag_history_batches" ("tenant_id", "seq")\nON DELETE RESTRICT\nON UPDATE CASCADE'],
  ];
  const ops = sql.map(([id, text]) => ({ id, operationClass: "additive", target: { id: "postgres" }, execute: [{ sql: text }] }));
  const sources = [[
    'COMMENT ON TABLE "scada_tag_history_batches" IS \'中文表\';',
    'COMMENT ON COLUMN "scada_tag_history_batches"."seq" IS \'序号\';',
    'COMMENT ON COLUMN "scada_tag_history_batches"."tenant_id" IS \'租户\';',
    'COMMENT ON COLUMN "scada_tag_history_batches"."created_at" IS \'时间\';',
    'COMMENT ON INDEX "scada_tag_history_batches_idx" IS \'唯一索引\';',
    'COMMENT ON INDEX "scada_tag_history_batches_pkey" IS \'主键\'\'注释\';',
  ].join("\n")];
  return { name, tables, ops, history: collectHistoricalComments(sources) };
}

void test("独立预期与手写建表、索引和外键全文一致", () => {
  const { tables, ops } = fixture();
  assert.equal(reviewStatements(tables, ops), 4);
  assert.deepEqual(expectedStatements(tables), new Map(ops.map((op) => [op.id, op.execute[0].sql])));
});

void test("拒绝字段类型、默认值、可空性及 CHECK 谓词漂移", () => {
  for (const [before, after] of [["character varying(128)", "character varying(64)"], ["DEFAULT '0'::int8", "DEFAULT '1'::int8"], [" NOT NULL", ""], ["seq >= 0", "seq >= -1"], ["PRIMARY KEY (\"tenant_id\", \"seq\")", "PRIMARY KEY (\"seq\", \"tenant_id\")"]]) {
    const { tables, ops } = fixture();
    ops[1].execute[0].sql = ops[1].execute[0].sql.replace(before, () => after);
    assert.throws(() => reviewStatements(tables, ops), /实际 DDL 与物理契约不一致/);
  }
});

void test("拒绝索引唯一性、外键列序和删除更新动作变化", () => {
  for (const { index, before, after } of [{ index: 2, before: "UNIQUE ", after: "" }, { index: 3, before: 'REFERENCES "public"."scada_tag_history_batches" ("tenant_id", "seq")', after: 'REFERENCES "public"."scada_tag_history_batches" ("seq", "tenant_id")' }, { index: 3, before: "ON DELETE RESTRICT", after: "ON DELETE CASCADE" }, { index: 3, before: "ON UPDATE CASCADE", after: "ON UPDATE RESTRICT" }]) {
    const { tables, ops } = fixture();
    ops[index].execute[0].sql = ops[index].execute[0].sql.replace(before, () => after);
    assert.throws(() => reviewStatements(tables, ops), /实际 DDL 与物理契约不一致/);
  }
});

void test("拒绝重复、缺失、额外语句及非新增操作", () => {
  const { tables, ops } = fixture();
  assert.throws(() => reviewStatements(tables, ops.slice(1)), /操作数量/);
  assert.throws(() => reviewStatements(tables, [...ops, ops[0]]), /操作数量/);
  const duplicate = [ops[0], ops[1], ops[1], ops[3]];
  assert.throws(() => reviewStatements(tables, duplicate), /物理契约不一致/);
  for (const patch of [{ operationClass: "data" }, { execute: [{ sql: ops[1].execute[0].sql + '; DROP TABLE "public"."scada_tag_history_batches"' }] }, { execute: [{ sql: ops[1].execute[0].sql, params: [1] }] }, { target: { id: "other" } }]) {
    const changed = structuredClone(ops);
    changed[1] = { ...changed[1], ...patch };
    assert.throws(() => reviewStatements(tables, changed), /物理契约不一致/);
  }
});

void test("拒绝先索引后建表和外键先于索引", () => {
  const { tables, ops } = fixture();
  for (const order of [[0, 2, 1, 3], [0, 1, 3, 2]]) {
    assert.throws(() => reviewStatements(tables, order.map((index) => ops[index])), /依赖阶段顺序/);
  }
});

void test("未知物理类型及外键动作不进入预期渲染范围", () => {
  const { tables, name } = fixture();
  tables[name].columns.seq.dataType = "pg/unknown";
  assert.throws(() => expectedStatements(tables), /字段类型/);
  const other = fixture();
  other.tables[name].foreignKeys[0].onDelete = "cascade";
  assert.throws(() => expectedStatements(other.tables), /外键引用范围或动作/);
});

void test("历史注释精确限定 public、列名与主键索引并保留引号", () => {
  const { tables, history } = fixture();
  const preview = commentPreview(tables, history);
  assert.equal(preview.split("\n").filter(Boolean).length, 6);
  assert.equal(preview, [
    'COMMENT ON COLUMN "public"."scada_tag_history_batches"."created_at" IS \'时间\';',
    'COMMENT ON COLUMN "public"."scada_tag_history_batches"."seq" IS \'序号\';',
    'COMMENT ON COLUMN "public"."scada_tag_history_batches"."tenant_id" IS \'租户\';',
    'COMMENT ON INDEX "public"."scada_tag_history_batches_idx" IS \'唯一索引\';',
    'COMMENT ON INDEX "public"."scada_tag_history_batches_pkey" IS \'主键\'\'注释\';',
    'COMMENT ON TABLE "public"."scada_tag_history_batches" IS \'中文表\';',
    "",
  ].join("\n"));
});

void test("拒绝缺失、同数量错对象及越界注释文本", () => {
  const { tables, history } = fixture();
  const missing = structuredClone(history);
  missing.entries.delete("TABLE scada_tag_history_batches");
  assert.throws(() => commentPreview(tables, missing), /注释数量/);
  missing.entries.set("TABLE scada_other", "错误对象");
  assert.throws(() => commentPreview(tables, missing), /注释缺失/);
  for (const comment of ["English", "中文\\注释", "中文\n注释"]) {
    const changed = structuredClone(history);
    changed.entries.set("TABLE scada_tag_history_batches", comment);
    assert.throws(() => commentPreview(tables, changed), /注释缺失或超出/);
  }
});
