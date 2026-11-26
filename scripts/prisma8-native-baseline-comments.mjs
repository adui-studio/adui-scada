import { isDeepStrictEqual } from "node:util";
import ts from "typescript";

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

/** 使用已安装的 TypeScript 解析官方脚手架，不执行源码或依赖其中的排版。 */
function locateScaffold(source) {
  const filename = "migration.ts";
  const diagnostics = ts.transpileModule(source, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).diagnostics;
  requireMatch(
    !diagnostics?.some((item) => item.category === ts.DiagnosticCategory.Error),
    "官方迁移脚手架语法无效",
  );
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const imports = ast.statements.filter(
    (node) =>
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "@prisma/orm-postgres/migration",
  );
  const bindings = imports[0]?.importClause?.namedBindings;
  requireMatch(
    imports.length === 1 &&
      !imports[0].importClause?.isTypeOnly &&
      bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.every((item) => !item.isTypeOnly && !item.propertyName),
    "官方迁移脚手架导入不符合约束",
  );
  const symbols = bindings.elements.map((item) => item.name.text);
  requireMatch(
    new Set(symbols).size === symbols.length &&
      symbols.includes("Migration") &&
      symbols.includes("MigrationCLI"),
    "官方迁移脚手架导入缺失或重复",
  );
  const classes = ast.statements.filter(ts.isClassDeclaration);
  const migration = classes[0];
  const heritage = migration?.heritageClauses?.find(
    (item) => item.token === ts.SyntaxKind.ExtendsKeyword,
  );
  const base = heritage?.types[0];
  requireMatch(
    classes.length === 1 &&
      migration.name &&
      ts.getModifiers(migration)?.some((item) => item.kind === ts.SyntaxKind.DefaultKeyword) &&
      heritage?.types.length === 1 &&
      base &&
      ts.isIdentifier(base.expression) &&
      base.expression.text === "Migration" &&
      base.typeArguments?.length === 2 &&
      base.typeArguments[0].kind === ts.SyntaxKind.NeverKeyword,
    "官方迁移脚手架不是唯一空起点迁移类",
  );
  const target = migration.members.filter((item) => item.name?.getText(ast) === "endContractJson");
  requireMatch(
    target.length === 1 &&
      ts.isPropertyDeclaration(target[0]) &&
      target[0].initializer?.getText(ast) === "endContract" &&
      !migration.members.some((item) => item.name?.getText(ast) === "startContractJson"),
    "官方迁移脚手架目标快照或空起点声明变化",
  );
  const getters = migration.members.filter((item) => item.name?.getText(ast) === "operations");
  const getter = getters[0];
  const statement =
    getter && ts.isGetAccessorDeclaration(getter) ? getter.body?.statements[0] : undefined;
  requireMatch(
    getters.length === 1 &&
      ts.isGetAccessorDeclaration(getter) &&
      getter.body?.statements.length === 1 &&
      statement &&
      ts.isReturnStatement(statement) &&
      statement.expression &&
      ts.isArrayLiteralExpression(statement.expression) &&
      statement.expression.elements.length > 0 &&
      !/\bplaceholder\s*\(/u.test(source),
    "官方迁移脚手架操作数组缺失或包含占位符",
  );
  const last = ast.statements.at(-1);
  const run = last && ts.isExpressionStatement(last) ? last.expression : undefined;
  requireMatch(
    run &&
      ts.isCallExpression(run) &&
      ts.isPropertyAccessExpression(run.expression) &&
      run.expression.expression.getText(ast) === "MigrationCLI" &&
      run.expression.name.text === "run" &&
      run.arguments.length === 2 &&
      run.arguments[0].getText(ast).replace(/\s/gu, "") === "import.meta.url" &&
      run.arguments[1].getText(ast) === migration.name.text,
    "官方迁移脚手架自发射入口变化",
  );
  return { ast, bindings, symbols, operations: statement.expression.elements };
}

/** 仅按语法节点插入新操作，保留其余全部原始源码字节。 */
export function appendCommentOperations(source, comments) {
  const before = locateScaffold(source);
  requireMatch(comments.length > 0, "缺少已审查的中文注释操作");
  const last = before.operations.at(-1).getEnd();
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const suffix = comments
    .map((operation) => "      rawSql(" + JSON.stringify(operation) + ")")
    .join("," + newline);
  let result = source.slice(0, last) + "," + newline + suffix + source.slice(last);
  if (!before.symbols.includes("rawSql")) {
    const position = before.bindings.elements.at(-1).getEnd();
    result = result.slice(0, position) + ", rawSql" + result.slice(position);
  }
  const after = locateScaffold(result);
  requireMatch(
    after.operations.length === before.operations.length + comments.length &&
      before.operations.every(
        (item, index) => item.getText(before.ast) === after.operations[index].getText(after.ast),
      ),
    "独立脚手架原操作源码发生变化",
  );
  return result;
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
