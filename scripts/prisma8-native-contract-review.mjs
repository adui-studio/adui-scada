import { isDeepStrictEqual } from "node:util";

export class NativeContractReviewError extends Error {}

function requireCondition(condition, message) {
  if (!condition) throw new NativeContractReviewError(message);
}

function same(actual, expected, message) {
  requireCondition(isDeepStrictEqual(actual, expected), message);
}

function names(value) {
  return Object.keys(value).sort();
}

/** 仅接受已核验目录中的普通 CHECK 定义，保留 PostgreSQL 的原始谓词重打印文本。 */
export function nativeChecks(baseline, catalog) {
  const expected = [...baseline.constraints.values()].filter((item) => item.kind === "c");
  const rows = catalog.constraints.filter((row) => row.kind === "c");
  const byName = new Map(rows.map((row) => [row.constraint_name, row]));
  requireCondition(
    rows.length === expected.length && byName.size === rows.length,
    "原生 CHECK 数量或名称重复",
  );
  return expected.map((item) => {
    const row = byName.get(item.name);
    requireCondition(
      row?.table_name === item.table &&
        row.validated === true &&
        row.deferrable === false &&
        row.deferred === false &&
        typeof row.definition === "string" &&
        row.definition.startsWith("CHECK (") &&
        row.definition.endsWith(")") &&
        /^[a-z_][a-z0-9_]*$/.test(item.name),
      "原生 CHECK 定义超出受控范围",
    );
    const expression = row.definition.slice("CHECK (".length, -1);
    requireCondition(
      expression.trim().length > 0 &&
        !expression.includes("`") &&
        !expression.includes("${") &&
        !expression.includes(";") &&
        Array.from(expression).every(
          (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ),
      "原生 CHECK 谓词包含不支持的模板字符",
    );
    return { table: item.table, name: item.name, expression };
  });
}

/** 只在独立 PSL 模板的物理表映射前插入确切命名的 CHECK，不修改生成 JSON。 */
export function materializeNativeContract(template, baseline, checks) {
  requireCondition(
    template.startsWith("// use prisma-8\n") &&
      !template.includes("\r") &&
      !template.includes("@@check("),
    "原生 PSL 模板头或现有约束不符合预期",
  );
  const mapped = new Set();
  let inserted = 0;
  const source = template.replace(/^  @@map\("([a-z_][a-z0-9_]*)"\)$/gm, (line, table) => {
    requireCondition(!mapped.has(table), "原生 PSL 模板存在重复物理表");
    mapped.add(table);
    const attributes = checks
      .filter((check) => check.table === table)
      .map((check) => {
        inserted++;
        return (
          "  @@check(expression: sql`" +
          check.expression +
          "`, map: " +
          JSON.stringify(check.name) +
          ")"
        );
      });
    return [...attributes, line].join("\n");
  });
  same([...mapped].sort(), baseline.tableNames, "原生 PSL 模板物理表清单不一致");
  requireCondition(inserted === checks.length, "原生 PSL 模板未覆盖全部 CHECK");
  return source;
}

function physicalIndex(index) {
  requireCondition(
    typeof index.name === "string" &&
      !index.prefix &&
      index.where === undefined &&
      index.expression === undefined &&
      (index.type === undefined || index.type === "btree") &&
      (index.options === undefined || names(index.options).length === 0),
    "原生候选索引含未审查的访问方法或表达式",
  );
  return { name: index.name, columns: index.columns, unique: index.unique };
}

function orderedByName(items) {
  return items.toSorted((a, b) => a.name.localeCompare(b.name, "en"));
}

/** 核对真实生成的候选 IR；物理结构优先，运行时差异独立报告且始终禁止接管。 */
export function reviewNativeContract(formal, candidate, baseline, checks) {
  same(candidate.targetFamily, formal.targetFamily, "候选目标数据库族不一致");
  same(candidate.target, formal.target, "候选目标数据库不一致");
  same(names(candidate.storage.namespaces), ["public"], "候选物理命名空间不一致");
  same(
    names(candidate.storage.namespaces.public.entries),
    names(formal.storage.namespaces.public.entries),
    "候选物理对象种类不一致",
  );
  const tables = candidate.storage.namespaces.public.entries.table;
  same(names(tables), baseline.tableNames, "候选物理表清单不一致");
  for (const tableName of baseline.tableNames) {
    const actual = tables[tableName];
    const previous = baseline.tables[tableName];
    same(
      actual.columns,
      previous.columns,
      "候选物理字段、类型、默认值或可空性不一致：" + tableName,
    );
    const primary = [...baseline.constraints.values()].find(
      (item) => item.kind === "p" && item.table === tableName,
    );
    requireCondition(primary, "历史主键不存在");
    same(
      actual.primaryKey.columns,
      previous.primaryKey.columns,
      "候选主键列或顺序不一致：" + tableName,
    );
    same(
      actual.primaryKey.name ?? tableName + "_pkey",
      primary.name,
      "候选主键名称不一致：" + tableName,
    );
    same(actual.uniques ?? [], previous.uniques ?? [], "候选新增或改变唯一约束：" + tableName);
    same(
      orderedByName(actual.indexes.map(physicalIndex)),
      orderedByName(previous.indexes.map(physicalIndex)),
      "候选索引定义不一致：" + tableName,
    );
    const expectedChecks = checks
      .filter((check) => check.table === tableName)
      .map(({ name, expression }) => ({ name, expression }));
    same(
      orderedByName(actual.checks ?? []),
      orderedByName(expectedChecks),
      "候选原生 CHECK 名称或谓词不一致：" + tableName,
    );
    const expectedFks = [...baseline.constraints.values()]
      .filter((item) => item.kind === "f" && item.table === tableName)
      .map((item) => ({
        name: item.name,
        source: { namespaceId: "public", tableName, columns: item.source },
        target: { namespaceId: "public", tableName: item.target, columns: item.targetColumns },
        onDelete: "restrict",
        onUpdate: "cascade",
      }));
    const actualFks = actual.foreignKeys.map((key) => ({
      name: key.name ?? tableName + "_" + key.source.columns.join("_") + "_fkey",
      source: key.source,
      target: key.target,
      onDelete: key.onDelete,
      onUpdate: key.onUpdate,
    }));
    same(
      orderedByName(actualFks),
      orderedByName(expectedFks),
      "候选物理外键名称、列、引用范围或动作不一致：" + tableName,
    );
  }

  const runtimeDifferences = [];
  if (!isDeepStrictEqual(candidate.roots, formal.roots)) runtimeDifferences.push("运行时根模型");
  if (!isDeepStrictEqual(candidate.execution.mutations, formal.execution.mutations))
    runtimeDifferences.push("运行时默认值及生成器");
  const oldModels = formal.domain.namespaces.public.models;
  const newModels = candidate.domain.namespaces.public.models;
  if (!isDeepStrictEqual(names(newModels), names(oldModels)))
    runtimeDifferences.push("运行时模型清单");
  for (const model of names(oldModels)) {
    const previous = oldModels[model];
    const actual = newModels[model];
    if (
      !actual ||
      !isDeepStrictEqual(actual.fields, previous.fields) ||
      !isDeepStrictEqual(actual.storage, previous.storage)
    ) {
      runtimeDifferences.push(model + " 字段或映射");
      continue;
    }
    const relations = new Set([
      ...names(previous.relations ?? {}),
      ...names(actual.relations ?? {}),
    ]);
    for (const relation of relations) {
      if (!isDeepStrictEqual(previous.relations?.[relation], actual.relations?.[relation])) {
        runtimeDifferences.push(model + "." + relation);
      }
    }
  }
  return {
    status:
      runtimeDifferences.length === 0
        ? "STORAGE_REVIEW_REQUIRED"
        : "STORAGE_REVIEW_REQUIRED_RUNTIME_BLOCKED",
    checks: checks.length,
    runtimeDifferences,
    signingAllowed: false,
  };
}
