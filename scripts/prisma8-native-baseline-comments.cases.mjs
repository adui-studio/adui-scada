import assert from "node:assert/strict";
import { test } from "node:test";
import { appendCommentOperations, buildCommentOperations, parseDryRun, reviewCommentEmission } from "./prisma8-native-baseline-comments.mjs";

const preview = [
  `COMMENT ON COLUMN "public"."scada_projects"."name" IS '中文''名称；';`,
  `COMMENT ON INDEX "public"."scada_projects_pkey" IS '主键';`,
  `COMMENT ON TABLE "public"."scada_projects" IS '工程表';`,
  "",
].join("\n");
const source = [
  `import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';`,
  "export default class M extends Migration<never, End> {",
  "  override readonly endContractJson = endContract;",
  "  override get operations() {",
  "    return [",
  "      this.createSchema({})",
  "    ];",
  "  }",
  "}",
  "",
  "MigrationCLI.run(import.meta.url, M);",
  "",
].join("\n");

function fixture() {
  const original = { manifest: { from: null, to: "a".repeat(64), migrationHash: "b".repeat(64), createdAt: "2026-11-25T09:18:00Z", providedInvariants: [] }, operations: [{ id: "schema.public", target: { id: "postgres" }, precheck: [{ sql: "SELECT true" }], execute: [{ sql: "CREATE SCHEMA public" }], postcheck: [] }] };
  const comments = buildCommentOperations(preview);
  const candidate = { manifest: { ...original.manifest, migrationHash: "c".repeat(64) }, operations: [...structuredClone(original.operations), ...structuredClone(comments)] };
  return { original, candidate, comments };
}

void test("注释操作保留原 SQL、对象类型和参数化精确检查", () => {
  const operations = buildCommentOperations(preview);
  assert.deepEqual(operations.map((item) => item.execute[0].sql), preview.trimEnd().split("\n"));
  assert.deepEqual(operations[0].postcheck[0].params, ["scada_projects", "name", "中文'名称；"]);
  assert.match(operations[0].precheck[0].sql, /a\.attnum > 0 AND NOT a\.attisdropped.*IS NULL/u);
  assert.match(operations[0].postcheck[0].sql, /convert_to\(\$3::text/u);
  assert.match(operations[1].postcheck[0].sql, /c\.relkind = 'i'/u);
  assert.match(operations[2].postcheck[0].sql, /c\.relkind = 'r'/u);
  assert.equal(operations.every((op) => op.operationClass === "additive" && op.target.id === "postgres"), true);
});

void test("拒绝非 public 对象、重复、注入、错列和非中文文案", () => {
  for (const invalid of [preview.replace('"public"', '"private"'), preview + preview, preview.replace("工程表';", "工程表'; DROP TABLE x;"), preview.replace('"name"', '"bad-name"'), preview.replace("工程表", "english"), preview.replace("工程表", "工程\\表"), preview.replace('COLUMN "public"."scada_projects"."name"', 'COLUMN "public"."scada_projects"'), preview.trimEnd()]) {
    assert.throws(() => buildCommentOperations(invalid), /注释/u);
  }
});

void test("仅追加到现有官方脚手架且保留原调用", () => {
  const comments = buildCommentOperations(preview);
  const result = appendCommentOperations(source, comments);
  assert.match(result, /Migration, MigrationCLI, rawSql/u);
  assert.match(result, /this\.createSchema\(\{\}\),\n      rawSql\(/u);
  assert.equal((result.match(/rawSql\(/gu) ?? []).length, 3);
  assert.match(result, /MigrationCLI\.run\(import\.meta\.url, M\);\n$/u);
  assert.equal((appendCommentOperations(source.replace("Migration, MigrationCLI", "Migration, MigrationCLI, rawSql"), comments).match(/, rawSql \}/gu) ?? []).length, 1);
});

void test("拒绝非空起点、占位符、不同结尾和重复导入", () => {
  for (const invalid of [source.replace("never, End", "Start, End"), source.replace("this.createSchema({})", 'placeholder("待填充")'), source + "\n", source.replace("export default", source.split("\n")[0] + "\nexport default")]) {
    assert.throws(() => appendCommentOperations(invalid, buildCommentOperations(preview)), /脚手架/u);
  }
});

void test("干跑输出仅接受官方两个 JSON 区段", () => {
  const { candidate } = fixture();
  const text = "--- migration.json ---\n" + JSON.stringify(candidate.manifest) + "\n--- ops.json ---\n" + JSON.stringify(candidate.operations) + "\n";
  assert.deepEqual(parseDryRun(text), candidate);
  assert.deepEqual(parseDryRun(text.replaceAll("\n", "\r\n")), candidate);
  assert.throws(() => parseDryRun("错误\n" + text), /输出形状/u);
  assert.throws(() => parseDryRun(text + text), /输出形状/u);
});

void test("完整操作保持且仅官方迁移标识改变", () => {
  const { original, candidate, comments } = fixture();
  assert.deepEqual(reviewCommentEmission(original, candidate, comments), { operations: 4, migrationHash: "c".repeat(64), signingAllowed: false, deploymentAllowed: false });
});

void test("拒绝原 DDL 预后置检查变化及新增注释顺序或内容变化", () => {
  const { original, candidate, comments } = fixture();
  const changed = structuredClone(candidate);
  changed.operations[0].precheck[0].sql = "SELECT false";
  assert.throws(() => reviewCommentEmission(original, changed, comments), /操作与原有/u);
  const reordered = structuredClone(candidate);
  reordered.operations.reverse();
  assert.throws(() => reviewCommentEmission(original, reordered, comments), /操作与原有/u);
  const altered = structuredClone(candidate);
  altered.operations[1].postcheck[0].params[2] = "错误";
  assert.throws(() => reviewCommentEmission(original, altered, comments), /操作与原有/u);
  assert.throws(() => reviewCommentEmission(original, { ...candidate, operations: candidate.operations.slice(0, -1) }, comments), /操作与原有/u);
});

void test("拒绝旧迁移标识、元数据漂移和重复操作", () => {
  const { original, candidate, comments } = fixture();
  for (const manifest of [{ ...candidate.manifest, migrationHash: original.manifest.migrationHash }, { ...candidate.manifest, migrationHash: "invalid" }, { ...candidate.manifest, createdAt: "changed" }, { ...candidate.manifest, from: "d".repeat(64) }]) {
    assert.throws(() => reviewCommentEmission(original, { ...candidate, manifest }, comments), /迁移边/u);
  }
  assert.throws(() => reviewCommentEmission(original, { ...candidate, operations: [...candidate.operations, comments[0]] }, [...comments, comments[0]]), /标识重复/u);
});
