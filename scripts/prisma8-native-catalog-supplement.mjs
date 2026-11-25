import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const legacyFingerprint = "73079d85974ddc9cbabf59741f2a4a94dd7bfff3d70a23bab27a7283456e8c52";
const primaryCommentNames = ["scada_tag_history_batches_pkey", "scada_tag_history_records_pkey"];
const scope = "PRISMA8_PRIMARY_INDEX_AND_COMMENTS_V1";
const permissionKey = "COLUMN scada_project_grants.permission";

export class SupplementError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new SupplementError(message);
}

/** 仅解析当前历史迁移的单行注释字面量，按迁移顺序保留最终文案。 */
export function collectHistoricalComments(sources) {
  /** @type {Map<string, string>} 最终对象注释 */
  const entries = new Map();
  let statements = 0;
  let permissionUpdates = 0;
  for (const source of sources) {
    for (const raw of source.split("\n")) {
      const line = raw.trim();
      if (!/^COMMENT\b/i.test(line)) continue;
      const match = line.match(
        /^COMMENT ON (TABLE|COLUMN|INDEX) "(scada_[a-z0-9_]+)"(?:\."([a-z_][a-z0-9_]*)")? IS '((?:''|[^'])*)';$/u,
      );
      requireMatch(match !== null, "历史注释超出受控单行字面量范围");
      const [, kind, name, column, literal] = match;
      requireMatch((kind === "COLUMN") === Boolean(column), "历史注释对象格式不一致");
      const key = kind + " " + name + (column ? "." + column : "");
      const comment = literal.replaceAll("''", "'");
      requireMatch(/[\u3400-\u9fff]/u.test(comment), "历史业务注释缺少中文");
      requireMatch(!entries.has(key) || key === permissionKey, "历史注释出现未审查的重复对象");
      if (key === permissionKey) permissionUpdates++;
      entries.set(key, comment);
      statements++;
    }
  }
  return { entries, statements, permissionUpdates };
}

function validatePrimaryIndexes(baseline, rows) {
  const expected = [...baseline.constraints.values()].filter((entry) => entry.kind === "p");
  requireMatch(Array.isArray(rows) && expected.length === 12 && rows.length === expected.length, "主键索引数量不一致");
  const byName = new Map(rows.map((row) => [row.index_name, row]));
  requireMatch(byName.size === rows.length, "主键索引名称重复");
  for (const key of expected) {
    const row = byName.get(key.name);
    requireMatch(
      row?.constraint_name === key.name && row.table_name === key.table && row.index_schema === "public" &&
        row.primary === true && row.unique === true && row.valid === true && row.ready === true &&
        row.live === true && row.immediate === true && row.simple === true && row.method === "btree" &&
        typeof row.definition === "string" && row.definition.length > 0 &&
        (row.comment === null || typeof row.comment === "string"),
      "主键索引所属约束、物理属性或定义不一致",
    );
    requireMatch(isDeepStrictEqual(row.columns, baseline.tables[key.table].primaryKey.columns), "主键索引列或顺序不一致");
  }
}

function validateComments(baseline, snapshot, history) {
  const expectedKeys = new Set(primaryCommentNames.map((name) => "INDEX " + name));
  for (const [name, table] of Object.entries(baseline.tables)) {
    expectedKeys.add("TABLE " + name);
    for (const column of Object.keys(table.columns)) expectedKeys.add("COLUMN " + name + "." + column);
    for (const index of table.indexes) expectedKeys.add("INDEX " + index.name);
  }
  requireMatch(
    history.statements === 121 && history.permissionUpdates === 3 && expectedKeys.size === 119 &&
      history.entries.size === expectedKeys.size && [...expectedKeys].every((key) => history.entries.has(key)),
    "历史最终注释对象、语句数量或覆盖范围不一致",
  );
  const actual = new Map();
  for (const row of snapshot.catalog.tables) actual.set("TABLE " + row.table_name, row.comment);
  for (const row of snapshot.catalog.columns) actual.set("COLUMN " + row.table_name + "." + row.column_name, row.comment);
  for (const row of [...snapshot.catalog.indexes, ...snapshot.primaryIndexes]) actual.set("INDEX " + row.index_name, row.comment);
  for (const [key, comment] of history.entries) {
    requireMatch(actual.has(key) && actual.get(key) === comment, "数据库注释与历史最终文案不一致");
  }
}

/** 仅在既有目录指纹和两库补充证据均匹配后返回独立指纹，始终禁止签名。 */
export function reviewCatalogSupplement(baseline, actual, reference, history) {
  requireMatch(
    actual.report.catalogFingerprint === legacyFingerprint && reference.report.catalogFingerprint === legacyFingerprint,
    "既有目录指纹与验收基线不一致",
  );
  for (const snapshot of [actual, reference]) {
    validatePrimaryIndexes(baseline, snapshot.primaryIndexes);
    validateComments(baseline, snapshot, history);
  }
  requireMatch(isDeepStrictEqual(actual.primaryIndexes, reference.primaryIndexes), "两库主键索引完整定义或注释不一致");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ scope, legacyFingerprint, primaryIndexes: actual.primaryIndexes }))
    .digest("hex");
  return { scope, fingerprint, legacyFingerprint, primaryIndexes: 12, comments: 119, signingAllowed: false, status: "MATCHED_REVIEW_REQUIRED" };
}
