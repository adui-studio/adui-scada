import { isDeepStrictEqual } from "node:util";

export class CommentEmissionError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new CommentEmissionError(message);
}

/** 仅接受已审查的 public 中文注释文本，不接受任意 SQL。 */
export function buildCommentOperations(preview) {
  requireMatch(preview.endsWith("\n"), "注释审查文本缺少结束换行");
  const lines = preview.slice(0, -1).split("\n");
  const seen = new Set();
  return lines.map((line) => {
    const match =
      /^COMMENT ON (TABLE|COLUMN|INDEX) "public"\."([a-z_][a-z0-9_]*)"(?:\."([a-z_][a-z0-9_]*)")? IS '((?:[^'\\\r\n]|'')+)';$/u.exec(
        line,
      );
    requireMatch(match, "注释语句超出已审查范围");
    const [, kind, name, column, literal] = match;
    const comment = literal.replaceAll("''", "'");
    requireMatch(
      (kind === "COLUMN") === (column !== undefined) &&
        /[\u3400-\u9fff]/u.test(comment) &&
        Array.from(comment).every(
          (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ),
      "注释对象或文案不符合约束",
    );
    const id = "comment." + kind.toLowerCase() + "." + name + (column ? "." + column : "");
    requireMatch(!seen.has(id), "中文注释操作标识重复");
    seen.add(id);
    const relationKind = kind === "INDEX" ? "i" : "r";
    const catalog =
      " FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace" +
      (column ? " JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid" : "") +
      " WHERE n.nspname = 'public' AND c.relname = $1 AND c.relkind = '" +
      relationKind +
      "'" +
      (column ? " AND a.attname = $2 AND a.attnum > 0 AND NOT a.attisdropped" : "");
    const description = column
      ? "pg_catalog.col_description(c.oid, a.attnum)"
      : "pg_catalog.obj_description(c.oid, 'pg_class')";
    const params = column ? [name, column] : [name];
    const check = (predicate) =>
      "SELECT EXISTS (SELECT 1" + catalog + " AND " + predicate + ") AS ok";
    return {
      id,
      label: "补充中文注释：" + name + (column ? "." + column : ""),
      operationClass: "additive",
      target: { id: "postgres" },
      precheck: [
        { description: "对象存在且尚无注释", sql: check(description + " IS NULL"), params },
      ],
      execute: [{ description: "写入已审查的中文注释", sql: line }],
      postcheck: [
        {
          description: "对象存在且注释字节精确匹配",
          sql: check(
            "pg_catalog.convert_to(" +
              description +
              ", 'UTF8') = pg_catalog.convert_to($" +
              (params.length + 1) +
              "::text, 'UTF8')",
          ),
          params: [...params, comment],
        },
      ],
    };
  });
}

/** 只扩展固定官方脚手架的现有导入及操作列表，不重写原操作或快照导入。 */
export function appendCommentOperations(source, comments) {
  const importPattern =
    /^import \{ ([A-Za-z0-9_, ]+) \} from (["'])@prisma\/orm-postgres\/migration\2;$/gm;
  const imports = [...source.matchAll(importPattern)];
  const end = "\n    ];\n  }\n}\n\nMigrationCLI.run(import.meta.url, M);\n";
  requireMatch(
    imports.length === 1 &&
      source.endsWith(end) &&
      source.includes("export default class M extends Migration<never, End> {") &&
      source.includes("  override readonly endContractJson = endContract;") &&
      source.includes("  override get operations() {\n    return [\n") &&
      !/\bplaceholder\s*\(/u.test(source),
    "官方空起点迁移脚手架形状变化",
  );
  const symbols = imports[0][1].split(",").map((name) => name.trim());
  requireMatch(
    symbols.includes("Migration") && symbols.includes("MigrationCLI"),
    "官方迁移导入缺失",
  );
  const body = source.slice(0, -end.length);
  const prefix = symbols.includes("rawSql")
    ? body
    : body.replace(importPattern, (line) => line.replace(" }", ", rawSql }"));
  const suffix = comments
    .map((operation) => "      rawSql(" + JSON.stringify(operation) + ")")
    .join(",\n");
  return prefix + (prefix.endsWith(",") ? "" : ",") + "\n" + suffix + end;
}

/** 解析固定 RC 自发射干跑的两个 JSON 区段，不自行生成迁移哈希。 */
export function parseDryRun(stdout) {
  const text = stdout.replaceAll("\r\n", "\n");
  const prefix = "--- migration.json ---\n";
  const separator = "\n--- ops.json ---\n";
  requireMatch(
    text.startsWith(prefix) && text.split(separator).length === 2,
    "官方自发射干跑输出形状变化",
  );
  const [manifest, operations] = text.slice(prefix.length).split(separator);
  return { manifest: JSON.parse(manifest), operations: JSON.parse(operations) };
}

/** 完整比较原操作及新增操作、边和元数据，仅允许官方迁移哈希改变。 */
export function reviewCommentEmission(original, candidate, comments) {
  requireMatch(
    Array.isArray(original.operations) &&
      Array.isArray(candidate.operations) &&
      isDeepStrictEqual(candidate.operations, [...original.operations, ...comments]),
    "自发射操作与原有 DDL 或已审查注释不一致",
  );
  requireMatch(
    new Set(candidate.operations.map(({ id }) => id)).size === candidate.operations.length,
    "自发射操作标识重复",
  );
  const { migrationHash: oldHash, ...oldMetadata } = original.manifest;
  const { migrationHash: newHash, ...newMetadata } = candidate.manifest;
  requireMatch(
    oldMetadata.from === null &&
      typeof oldMetadata.to === "string" &&
      isDeepStrictEqual(oldMetadata, newMetadata) &&
      typeof newHash === "string" &&
      /^(?:sha256:)?[a-f0-9]{64}$/u.test(newHash) &&
      newHash !== oldHash,
    "自发射迁移边、元数据或新迁移标识不一致",
  );
  return {
    operations: candidate.operations.length,
    migrationHash: newHash,
    signingAllowed: false,
    deploymentAllowed: false,
  };
}
