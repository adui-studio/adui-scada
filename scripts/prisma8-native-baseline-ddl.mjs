import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { collectHistoricalComments } from "./prisma8-native-catalog-supplement.mjs";

const packageDirectory = "migrations/app/20261125T0918_scada_native_baseline";
const snapshotDirectory =
  "migrations/snapshots/6eec3e7459bdfa2646dc156bd6eaf22ffe60b0a0eac309622262b9742a0c68cc";
const auditedFiles = {
  "contract.d.ts": "03d6276070136b97a906c500e044ac765d494ce1aaa56b9ac01fe52cc6b5c0d4",
  "contract.json": "850ef15fcfc0455491ba73f66419f42a394f963b1a99a02870bad5cae964cffa",
  "contract.prisma": "b8ed4ffa398d84ce4a1fd34863de95ca3a3ea83508358d428233b8a2e3d3ad83",
  "plan.json": "048606f3358a11647bc5abdac19bc516a2145a9e44ad33acf9cc9b54836ee360",
  "plan.stderr.txt": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  [packageDirectory + "/migration.json"]:
    "3b6701a4dcf61249a0c7e397d52913ab76d392e9f10c65412e91c99dbb0d691a",
  [packageDirectory + "/migration.ts"]:
    "b3d07b3050d3b158cfeed26d536f0a9073ce7803e9227026b369ff062e1a531a",
  [packageDirectory + "/ops.json"]:
    "1d0f048784c6fa4377e1be275bbceb1bfe8b8445a5020cb6fdaf424b3e928c73",
  [snapshotDirectory + "/contract.d.ts"]:
    "20ecc6c55095c490f17bb88d60952980dfd30d1a430abb8e42865e6b6767749b",
  [snapshotDirectory + "/contract.json"]:
    "2bd3034a2509fc8fc88c4c7a2dba9feee78d347440c133628329f6d675ea57ef",
};
const historicalChecksums = [
  "b06365b604b0c3b68452bb28f8017271fc6a54c7a5e9543c0d255d6540141877",
  "ffba0efe961e41bab1ab1fe7de7b4af48d4e6e143063e571d6da24bdf7fe4ebb",
  "12a96942c920b41e5ad4826742ef5f3cebb8261d3cd2ae649043eedcfd2603dc",
  "bde4b8fb7d8bb299ce4d3280db655d26757f3ad12e5a88c29cbc0e82f5b428bf",
  "3fc1f3fe7429d30dc2b87f66e7a8d72d0597c78c7e741cb1b986098acb0f216e",
  "09b7f1cda813dff53cc1a92d8ea72c4efffecab560159732c899209a2bf8cad8",
  "5f79650af69c89dd0de907afc0b481474075337748f942a813ee95c8b0f85d7d",
  "612d07f100e1b25967ea5c3cd577beea2b09cdbb6b3ee8293278bdc8afc0a831",
];
const auditedCommentHash = "06a47418f3477c263cb19c7a3550a6be3810a4ffd9c22afada7ecd28f6322fb7";
const primaryCommentTables = ["scada_tag_history_batches", "scada_tag_history_records"];
const operationKinds = ["schema", "table", "index", "foreignKey"];

export class DdlReviewError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new DdlReviewError(message);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function identifier(name) {
  requireMatch(
    typeof name === "string" && /^[a-z_][a-z0-9_]*$/.test(name),
    "物理标识符超出已审查范围",
  );
  return '"' + name + '"';
}

function relation(name) {
  return '"public".' + identifier(name);
}

function columns(names) {
  requireMatch(
    Array.isArray(names) && names.length > 0 && new Set(names).size === names.length,
    "物理列清单无效",
  );
  return names.map(identifier).join(", ");
}

/** 仅渲染当前候选已出现的类型、精度和默认值，不充当通用 SQL 生成器。 */
function columnDefinition(name, column) {
  const { dataType, typeParams, nullable } = column;
  requireMatch(typeof nullable === "boolean", "字段可空性无效");
  let type;
  if (dataType === "pg/varchar") {
    requireMatch(
      Number.isInteger(typeParams?.length) &&
        typeParams.length > 0 &&
        Object.keys(typeParams).length === 1,
      "字符字段长度超出已审查范围",
    );
    type = "character varying(" + typeParams.length + ")";
  } else if (dataType === "pg/timestamptz") {
    requireMatch(
      typeParams?.precision === 6 && Object.keys(typeParams).length === 1,
      "时间字段精度超出已审查范围",
    );
    type = "timestamptz(6)";
  } else {
    requireMatch(
      ["pg/int8", "pg/int4", "pg/uuid", "pg/text", "pg/jsonb"].includes(dataType) &&
        typeParams === undefined,
      "字段类型超出已审查范围",
    );
    type = dataType.slice(3);
  }
  let defaultSql = "";
  if (column.default !== undefined) {
    const value = column.default;
    if (
      dataType === "pg/timestamptz" &&
      isDeepStrictEqual(value, { expression: "now()", kind: "function" })
    )
      defaultSql = " DEFAULT (now())";
    else if (dataType === "pg/int8" && isDeepStrictEqual(value, { kind: "literal", value: "0" }))
      defaultSql = " DEFAULT '0'::int8";
    else if (
      dataType === "pg/varchar" &&
      isDeepStrictEqual(value, { kind: "literal", value: "active" })
    )
      defaultSql = " DEFAULT 'active'";
    else throw new DdlReviewError("字段默认表达式超出已审查范围");
  }
  return identifier(name) + " " + type + defaultSql + (nullable ? "" : " NOT NULL");
}

/** 从已经核验的物理契约独立构造当前 RC 的精确 DDL 文本。 */
export function expectedStatements(tables) {
  const statements = new Map([["schema.public", 'CREATE SCHEMA IF NOT EXISTS "public"']]);
  const add = (id, sql) => {
    requireMatch(!statements.has(id), "物理操作标识重复");
    statements.set(id, sql);
  };
  for (const [name, table] of Object.entries(tables)) {
    requireMatch(table.uniques.length === 0, "候选含未审查的独立唯一约束");
    const parts = Object.entries(table.columns)
      .sort(([left], [right]) => compareNames(left, right))
      .map(([key, column]) => columnDefinition(key, column));
    parts.push(
      "CONSTRAINT " +
        identifier(table.primaryKey.name) +
        " PRIMARY KEY (" +
        columns(table.primaryKey.columns) +
        ")",
    );
    for (const check of table.checks.toSorted((left, right) =>
      compareNames(left.name, right.name),
    )) {
      requireMatch(
        typeof check.expression === "string" &&
          check.expression.length > 0 &&
          !check.expression.includes(";") &&
          !/[\r\n]/u.test(check.expression),
        "CHECK 谓词超出已审查范围",
      );
      parts.push("CONSTRAINT " + identifier(check.name) + " CHECK (" + check.expression + ")");
    }
    add("table." + name, "CREATE TABLE " + relation(name) + " (\n  " + parts.join(",\n  ") + "\n)");
    for (const index of table.indexes) {
      requireMatch(
        typeof index.unique === "boolean" && Object.keys(index).length === 3,
        "索引形状超出已审查范围",
      );
      add(
        "index." + name + "." + index.name,
        "CREATE " +
          (index.unique ? "UNIQUE " : "") +
          "INDEX " +
          identifier(index.name) +
          " ON " +
          relation(name) +
          " (" +
          columns(index.columns) +
          ")",
      );
    }
    for (const key of table.foreignKeys) {
      requireMatch(
        key.source.namespaceId === "public" &&
          key.source.tableName === name &&
          key.target.namespaceId === "public" &&
          key.onDelete === "restrict" &&
          key.onUpdate === "cascade",
        "外键引用范围或动作超出已审查范围",
      );
      add(
        "foreignKey." + name + "." + key.name,
        "ALTER TABLE " +
          relation(name) +
          "\nADD CONSTRAINT " +
          identifier(key.name) +
          "\nFOREIGN KEY (" +
          columns(key.source.columns) +
          ")\nREFERENCES " +
          relation(key.target.tableName) +
          " (" +
          columns(key.target.columns) +
          ")\nON DELETE RESTRICT\nON UPDATE CASCADE",
      );
    }
  }
  return statements;
}

/** 操作必须逐项完整匹配；保持依赖阶段顺序，不将同数量当作等价。 */
export function reviewStatements(tables, ops) {
  const expected = expectedStatements(tables);
  requireMatch(Array.isArray(ops) && ops.length === expected.size, "实际 DDL 操作数量不一致");
  let phase = 0;
  for (const op of ops) {
    const nextPhase = operationKinds.indexOf(op.id.split(".")[0]);
    requireMatch(nextPhase >= phase, "DDL 依赖阶段顺序不一致");
    phase = nextPhase;
    const sql = expected.get(op.id);
    requireMatch(
      typeof sql === "string" &&
        op.operationClass === "additive" &&
        op.target?.id === "postgres" &&
        op.execute.length === 1 &&
        op.execute[0].sql === sql &&
        (op.execute[0].params === undefined || isDeepStrictEqual(op.execute[0].params, [])),
      "实际 DDL 与物理契约不一致",
    );
    expected.delete(op.id);
  }
  requireMatch(expected.size === 0, "实际 DDL 缺少物理操作");
  return ops.length;
}

/** 只产生待审查的中文注释文本，不构造迁移操作或连接数据库。 */
export function commentPreview(tables, history) {
  const expected = new Map();
  for (const [name, table] of Object.entries(tables)) {
    expected.set("TABLE " + name, "TABLE " + relation(name));
    for (const column of Object.keys(table.columns))
      expected.set(
        "COLUMN " + name + "." + column,
        "COLUMN " + relation(name) + "." + identifier(column),
      );
    for (const index of table.indexes)
      expected.set("INDEX " + index.name, "INDEX " + relation(index.name));
    if (primaryCommentTables.includes(name))
      expected.set("INDEX " + table.primaryKey.name, "INDEX " + relation(table.primaryKey.name));
  }
  requireMatch(expected.size === history.entries.size, "历史最终注释数量不一致");
  const statements = [...expected.entries()]
    .sort(([left], [right]) => compareNames(left, right))
    .map(([key, object]) => {
      const comment = history.entries.get(key);
      requireMatch(
        typeof comment === "string" &&
          /[\u3400-\u9fff]/u.test(comment) &&
          !comment.includes("\\") &&
          Array.from(comment).every(
            (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
          ),
        "历史最终注释缺失或超出已审查范围",
      );
      return "COMMENT ON " + object + " IS '" + comment.replaceAll("'", "''") + "';";
    });
  return statements.join("\n") + "\n";
}

/** 锁定维护者实际上传的十份原件；不将文件指纹冒充官方迁移哈希重算。 */
export function readAuditedFiles(directory) {
  return Object.fromEntries(
    Object.entries(auditedFiles).map(([name, hash]) => {
      const path = join(directory, name);
      requireMatch(
        lstatSync(path).isFile() && realpathSync(path) === path,
        "原始候选文件路径不符合受控范围",
      );
      const bytes = readFileSync(path);
      requireMatch(digest(bytes) === hash, "原始候选文件指纹已变化");
      return [name, bytes];
    }),
  );
}

/** 复用已有候选门禁后，只审查已固定的原包及当前历史注释。 */
export function reviewAuditedBaseline(root, baseline, nativeText) {
  const directory = join(root, ".artifacts", "prisma8-native-baseline");
  const files = readAuditedFiles(directory);
  requireMatch(
    files["contract.json"].toString("utf8") === nativeText,
    "候选原文与已评审副本不一致",
  );
  const tables = JSON.parse(nativeText).storage.namespaces.public.entries.table;
  const ops = JSON.parse(files[packageDirectory + "/ops.json"].toString("utf8"));
  const operations = reviewStatements(tables, ops);
  requireMatch(operations === 46, "原生基线操作覆盖数量变化");
  requireMatch(
    isDeepStrictEqual(
      baseline.migrations.map(({ checksum }) => checksum),
      historicalChecksums,
    ),
    "历史八项迁移的已评审原文指纹变化",
  );
  const sources = baseline.migrations.map(({ name, checksum }) => {
    const bytes = readFileSync(
      join(root, "apps", "server", "prisma", "migrations", name, "migration.sql"),
    );
    requireMatch(digest(bytes) === checksum, "历史迁移原文发生变化");
    return bytes.toString("utf8");
  });
  const history = collectHistoricalComments(sources);
  requireMatch(
    history.statements === 121 && history.permissionUpdates === 3 && history.entries.size === 119,
    "历史注释覆盖范围变化",
  );
  const preview = commentPreview(tables, history);
  const previewHash = digest(preview);
  requireMatch(previewHash === auditedCommentHash, "最终中文注释审查文本与已核对历史文案不一致");
  readAuditedFiles(directory);
  return {
    operations,
    comments: 119,
    preview,
    previewHash,
    signingAllowed: false,
    deploymentAllowed: false,
  };
}
