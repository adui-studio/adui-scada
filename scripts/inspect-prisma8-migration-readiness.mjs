import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { requirePrisma8ReadOnlyTestUrl } from "../apps/server/src/database/prisma8-readonly-target.ts";

const root = resolve(import.meta.dirname, "..");
const server = join(root, "apps", "server");
const migrationRoot = join(server, "prisma", "migrations");
const expectedMigrations = [
  "20261112000000_init_scada_projects",
  "20261112170000_add_chinese_table_comments",
  "20261113000000_trusted_identity_sessions",
  "20261114000000_oidc_identity_transactions",
  "20261118000000_release_state_and_events",
  "20261119000000_release_state_event_integrity",
  "20261119180000_release_read_permission",
  "20261124100000_tag_history_archive",
];
const lastEventKey = "scada_project_release_state_last_event_fkey";
const chinese = /[\u3400-\u9fff]/u;
const hexHash = /^[0-9a-f]{64}$/;
const permissionValues = [
  "project:read",
  "version:read",
  "version:append",
  "release:publish",
  "release:rollback",
  "release:read",
];

export class PreflightError extends Error {}

function requireCondition(condition, message) {
  if (!condition) throw new PreflightError(message);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function same(actual, expected, message) {
  requireCondition(isDeepStrictEqual(actual, expected), message);
}

function sqlColumns(source) {
  return source.split(",").map((part) => {
    const match = part.trim().match(/^"([a-z_][a-z0-9_]*)"$/);
    requireCondition(match !== null, "历史迁移列清单超出受控提取范围");
    return match[1];
  });
}

/** 只针对当前八项历史迁移的已核对 DDL 形状提取最终命名约束；不是通用 SQL 解析器。 */
function readConstraints(sql, constraints) {
  const tokens =
    /(?:CREATE TABLE|ALTER TABLE)\s+"(scada_[a-z0-9_]+)"|\bCONSTRAINT\s+"(scada_[a-z0-9_]+)"\s+(PRIMARY KEY|FOREIGN KEY|CHECK)\b/g;
  let table = "";
  for (const token of sql.matchAll(tokens)) {
    if (token[1]) {
      table = token[1];
      continue;
    }
    requireCondition(table !== "", "历史迁移约束缺少所属业务表");
    const name = token[2];
    const kind = token[3] === "PRIMARY KEY" ? "p" : token[3] === "FOREIGN KEY" ? "f" : "c";
    const entry = { name, table, kind };
    if (kind === "f") {
      const tail = sql.slice(token.index + token[0].length);
      const shape = tail.match(
        /^\s*\(([^)]+)\)\s+REFERENCES\s+"([a-z0-9_]+)"\s*\(([^)]+)\)\s+ON DELETE RESTRICT\s+ON UPDATE CASCADE/,
      );
      requireCondition(shape !== null, "历史外键超出受控提取范围");
      entry.source = sqlColumns(shape[1]);
      entry.target = shape[2];
      entry.targetColumns = sqlColumns(shape[3]);
    }
    constraints.set(name, entry);
  }
}

function foreignKeyShape(table, source, target, targetColumns) {
  return JSON.stringify([table, source, target, targetColumns]);
}

function contractForeignKeys(tables) {
  const result = new Set();
  for (const [table, model] of Object.entries(tables)) {
    for (const key of model.foreignKeys) {
      requireCondition(
        key.source.namespaceId === "public" &&
          key.source.tableName === table &&
          key.target.namespaceId === "public" &&
          key.onDelete === "restrict" &&
          key.onUpdate === "cascade",
        "契约外键命名空间或引用规则发生变化",
      );
      result.add(
        foreignKeyShape(table, key.source.columns, key.target.tableName, key.target.columns),
      );
    }
  }
  return result;
}

/** 仅读取本仓库已跟踪的历史迁移与生成契约，不生成文件或改写历史。 */
export function loadMigrationBaseline() {
  const directories = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  same(directories, expectedMigrations, "历史迁移清单变化，必须重新审查接管基线");
  const lock = readFileSync(join(migrationRoot, "migration_lock.toml"), "utf8");
  requireCondition(/^provider = "postgresql"$/m.test(lock), "历史迁移数据库类型锁不匹配");
  const constraints = new Map();
  const migrations = directories.map((name) => {
    const sql = readFileSync(join(migrationRoot, name, "migration.sql"), "utf8");
    requireCondition(sql.length > 0 && !sql.includes("\r"), "历史迁移必须保留非空 LF 原文");
    readConstraints(sql, constraints);
    return { name, checksum: digest(sql) };
  });
  const contract = JSON.parse(
    readFileSync(join(server, "src", "generated", "prisma8", "contract.json"), "utf8"),
  );
  const storage = contract.storage;
  requireCondition(
    contract.targetFamily === "sql" &&
      contract.target === "postgres" &&
      hexHash.test(storage?.storageHash ?? ""),
    "生成的 Prisma 8 PostgreSQL 契约无效",
  );
  same(Object.keys(storage.namespaces), ["public"], "契约命名空间发生变化");
  const tables = storage.namespaces.public.entries.table;
  const tableNames = Object.keys(tables).sort();
  same(Object.keys(contract.roots).sort(), tableNames, "契约根模型与物理表不一致");
  requireCondition(
    tableNames.length === 12 && tableNames.every((name) => /^scada_[a-z0-9_]+$/.test(name)),
    "业务表基线发生变化",
  );
  const checks = [...constraints.values()].filter((entry) => entry.kind === "c");
  const primaryKeys = [...constraints.values()].filter((entry) => entry.kind === "p");
  const foreignKeys = [...constraints.values()].filter((entry) => entry.kind === "f");
  requireCondition(
    checks.length === 36 && primaryKeys.length === 12 && foreignKeys.length === 13,
    "历史主键、外键或 CHECK 清单发生变化",
  );
  const emittedKeys = contractForeignKeys(tables);
  const nativeKeys = new Set(
    foreignKeys.map((key) => foreignKeyShape(key.table, key.source, key.target, key.targetColumns)),
  );
  requireCondition(emittedKeys.size === 13 && nativeKeys.size === 13, "外键数量与基线不一致");
  const gap = foreignKeys.filter(
    (key) =>
      !emittedKeys.has(foreignKeyShape(key.table, key.source, key.target, key.targetColumns)),
  );
  same(
    gap.map((key) => key.name),
    [lastEventKey],
    "契约与历史外键出现新的差异",
  );
  const nativeLastEvent = constraints.get(lastEventKey);
  same(
    nativeLastEvent?.source,
    [
      "tenant_id",
      "project_id",
      "release_generation",
      "released_revision",
      "released_content_hash",
      "last_release_event_id",
    ],
    "末次事件历史复合外键源列发生变化",
  );
  same(
    nativeLastEvent?.targetColumns,
    ["tenant_id", "project_id", "generation", "to_revision", "to_content_hash", "event_id"],
    "末次事件历史复合外键目标列发生变化",
  );
  const simplified = foreignKeyShape(
    "scada_project_release_state",
    ["last_release_event_id"],
    "scada_project_release_events",
    ["event_id"],
  );
  same(
    [...emittedKeys].filter((key) => !nativeKeys.has(key)),
    [simplified],
    "契约末次事件关联差异发生变化",
  );
  requireCondition(
    Object.values(tables).every((table) => !table.checks || Object.keys(table.checks).length === 0),
    "契约 CHECK 表达已变化，必须重新审查差异",
  );
  const columnCount = Object.values(tables).reduce(
    (sum, table) => sum + Object.keys(table.columns).length,
    0,
  );
  const indexCount = Object.values(tables).reduce((sum, table) => sum + table.indexes.length, 0);
  requireCondition(columnCount === 85 && indexCount === 20, "物理字段或索引基线发生变化");
  return {
    migrations,
    tables,
    tableNames,
    constraints,
    columnCount,
    indexCount,
    contractHash: storage.storageHash,
  };
}

/** 严格比对实际已完成记录与本地 LF 原文 SHA-256；异常历史一律停止，不自动修复。 */
export function validateMigrationLedger(baseline, rows) {
  requireCondition(rows.length === baseline.migrations.length, "Prisma 7 迁移登记数量不一致");
  const byName = new Map(rows.map((row) => [row.migration_name, row]));
  requireCondition(byName.size === rows.length, "Prisma 7 迁移登记存在重复记录");
  for (const migration of baseline.migrations) {
    const row = byName.get(migration.name);
    requireCondition(
      row?.finished === true &&
        row.rolled_back === false &&
        Number.isInteger(row.applied_steps_count) &&
        row.applied_steps_count > 0,
      "Prisma 7 迁移缺失、未完成或存在回滚",
    );
    requireCondition(row.checksum === migration.checksum, "Prisma 7 历史迁移校验和不一致");
  }
}

function requireComment(value) {
  requireCondition(
    typeof value === "string" && chinese.test(value),
    "业务表、字段或非主键索引缺少中文数据库注释",
  );
}

function validateColumns(baseline, columns) {
  requireCondition(columns.length === baseline.columnCount, "实际业务字段数量不一致");
  const byKey = new Map(columns.map((row) => [row.table_name + "." + row.column_name, row]));
  requireCondition(byKey.size === columns.length, "实际业务字段重复");
  for (const [tableName, table] of Object.entries(baseline.tables)) {
    for (const [name, expected] of Object.entries(table.columns)) {
      const row = byKey.get(tableName + "." + name);
      requireCondition(
        row &&
          expected.dataType === "pg/" + row.udt_name &&
          row.nullable === expected.nullable &&
          (expected.typeParams?.length === undefined ||
            row.character_length === expected.typeParams.length) &&
          (expected.typeParams?.precision === undefined ||
            row.datetime_precision === expected.typeParams.precision) &&
          (row.default_expression !== null) === Boolean(expected.default),
        "实际业务字段类型、长度、精度、空值或默认值存在性不一致",
      );
      requireComment(row.comment);
    }
  }
}

function validatePermissionCheck(definition) {
  // 只接受 PostgreSQL 展开的六项固定白名单表达式；不以约束名称存在替代定义核验。
  const normalized = definition.replace(/[\s()"]/g, "").replaceAll("::text", "");
  const values = permissionValues.map((value) => "'" + value + "'").join(",");
  requireCondition(
    normalized === "CHECKpermission=ANYARRAY[" + values + "]" ||
      normalized === "CHECKpermissionIN" + values,
    "工程 ACL 实际权限白名单定义不一致",
  );
}

function validateConstraints(baseline, rows) {
  requireCondition(rows.length === baseline.constraints.size, "实际业务约束数量不一致");
  const byName = new Map(rows.map((row) => [row.constraint_name, row]));
  requireCondition(byName.size === rows.length, "实际业务约束名称重复");
  for (const expected of baseline.constraints.values()) {
    const row = byName.get(expected.name);
    requireCondition(
      row?.table_name === expected.table &&
        row.kind === expected.kind &&
        row.validated === true &&
        row.deferrable === false &&
        row.deferred === false &&
        typeof row.definition === "string" &&
        row.definition.length > 0,
      "实际命名约束缺失、未验证或规则不一致",
    );
    if (expected.kind === "p") {
      same(
        row.source_columns,
        baseline.tables[expected.table].primaryKey.columns,
        "实际主键字段或顺序不一致",
      );
    } else if (expected.kind === "f") {
      same(
        [
          row.source_columns,
          row.target_schema,
          row.target_table,
          row.target_columns,
          row.delete_rule,
          row.update_rule,
          row.match_type,
        ],
        [expected.source, "public", expected.target, expected.targetColumns, "r", "c", "s"],
        "实际外键字段、顺序、引用范围或动作不一致",
      );
    }
    if (expected.name === "scada_project_grants_permission_check")
      validatePermissionCheck(row.definition);
  }
}

function validateIndexes(baseline, rows) {
  requireCondition(rows.length === baseline.indexCount, "实际非主键索引数量不一致");
  const byName = new Map(rows.map((row) => [row.index_name, row]));
  requireCondition(byName.size === rows.length, "实际非主键索引名称重复");
  for (const [tableName, table] of Object.entries(baseline.tables)) {
    for (const index of table.indexes) {
      const row = byName.get(index.name);
      requireCondition(
        row?.table_name === tableName &&
          row.unique === index.unique &&
          row.valid === true &&
          row.ready === true &&
          row.simple === true &&
          row.method === "btree",
        "实际索引所属表、唯一性、可用性或方法不一致",
      );
      same(row.columns, index.columns, "实际索引字段或顺序不一致");
      requireComment(row.comment);
    }
  }
}

/** 只证明选定元数据检查通过；完整 CHECK 语义、默认表达式和基线重放仍待审查。 */
export function validateMigrationCatalog(baseline, catalog) {
  same(
    catalog.tables.map((row) => row.table_name).sort(),
    baseline.tableNames,
    "实际业务表清单不一致",
  );
  for (const row of catalog.tables) requireComment(row.comment);
  validateColumns(baseline, catalog.columns);
  validateConstraints(baseline, catalog.constraints);
  validateIndexes(baseline, catalog.indexes);
  return {
    status: "REVIEW_REQUIRED",
    migrations: baseline.migrations.length,
    tables: baseline.tableNames.length,
    columns: baseline.columnCount,
    checks: 36,
    foreignKeys: 13,
    indexes: baseline.indexCount,
    contractHash: baseline.contractHash,
    // 指纹包含实际定义和注释，仅用于相同 PostgreSQL 主版本与查询上下文的后续比较。
    catalogFingerprint: digest(JSON.stringify(catalog)),
    contractForeignKeyGap: lastEventKey,
    signingAllowed: false,
  };
}

const sql = Object.freeze({
  begin: "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
  rollback: "ROLLBACK",
  boundary: `SELECT current_database()::text AS database_name, current_schema()::text AS schema_name,
    current_setting('transaction_read_only') AS read_only,
    current_setting('transaction_isolation') AS isolation,
    current_setting('TimeZone') AS timezone,
    current_setting('server_version_num') AS server_version,
    current_setting('server_encoding') AS server_encoding,
    current_setting('search_path') AS search_path,
    current_setting('DateStyle') AS date_style,
    current_setting('standard_conforming_strings') AS standard_strings,
    (SELECT datcollate FROM pg_database WHERE datname = current_database()) AS database_collation,
    (SELECT datctype FROM pg_database WHERE datname = current_database()) AS database_ctype,
    to_regclass('public._prisma_migrations') IS NOT NULL AS legacy_ledger,
    to_regnamespace('prisma_contract') IS NOT NULL AS marker_schema,
    to_regclass('prisma_contract.marker') IS NOT NULL AS marker_table`,
  ledger: `SELECT migration_name, checksum, finished_at IS NOT NULL AS finished,
    rolled_back_at IS NOT NULL AS rolled_back, applied_steps_count
    FROM public._prisma_migrations ORDER BY migration_name, id LIMIT $1::integer`,
  tables: `SELECT c.relname::text AS table_name, obj_description(c.oid, 'pg_class') AS comment
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> '_prisma_migrations'
    ORDER BY c.relname`,
  columns: `SELECT i.table_name::text, i.column_name::text, i.udt_name::text,
    i.is_nullable = 'YES' AS nullable, i.character_maximum_length AS character_length,
    i.datetime_precision, i.column_default AS default_expression, col_description(c.oid, a.attnum) AS comment
    FROM information_schema.columns i
    JOIN pg_namespace n ON n.nspname = i.table_schema
    JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = i.table_name
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = i.column_name
    WHERE i.table_schema = 'public' AND i.table_name = ANY($1::text[])
    ORDER BY i.table_name, i.column_name`,
  constraints: `SELECT con.conname::text AS constraint_name, c.relname::text AS table_name,
    con.contype::text AS kind, con.convalidated AS validated,
    con.condeferrable AS deferrable, con.condeferred AS deferred,
    pg_get_constraintdef(con.oid, false) AS definition,
    ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum ORDER BY k.ord) AS source_columns,
    tn.nspname::text AS target_schema, tc.relname::text AS target_table,
    ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum ORDER BY k.ord) AS target_columns,
    con.confdeltype::text AS delete_rule, con.confupdtype::text AS update_rule, con.confmatchtype::text AS match_type
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_class tc ON tc.oid = con.confrelid LEFT JOIN pg_namespace tn ON tn.oid = tc.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
    ORDER BY c.relname, con.conname`,
  indexes: `SELECT c.relname::text AS table_name, ic.relname::text AS index_name,
    i.indisunique AS "unique", i.indisvalid AS valid, i.indisready AS ready,
    (i.indpred IS NULL AND i.indexprs IS NULL AND i.indnatts = i.indnkeyatts) AS simple,
    am.amname::text AS method, pg_get_indexdef(i.indexrelid) AS definition,
    obj_description(i.indexrelid, 'pg_class') AS comment,
    ARRAY(SELECT a.attname::text FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum ORDER BY k.ord) AS columns
    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_am am ON am.oid = ic.relam
    WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) AND NOT i.indisprimary
    ORDER BY c.relname, ic.relname`,
  primaryIndexes: `SELECT c.relname::text AS table_name, ic.relname::text AS index_name,
    con.conname::text AS constraint_name, ni.nspname::text AS index_schema,
    i.indisprimary AS "primary", i.indisunique AS "unique", i.indisvalid AS valid, i.indisready AS ready,
    i.indislive AS live, i.indimmediate AS immediate,
    (i.indpred IS NULL AND i.indexprs IS NULL AND i.indnatts = i.indnkeyatts) AS simple,
    am.amname::text AS method, pg_get_indexdef(i.indexrelid) AS definition,
    obj_description(i.indexrelid, 'pg_class') AS comment,
    ARRAY(SELECT a.attname::text FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum ORDER BY k.ord) AS columns
    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_namespace ni ON ni.oid = ic.relnamespace JOIN pg_am am ON am.oid = ic.relam
    LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid AND con.conrelid = c.oid AND con.contype = 'p'
    WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) AND i.indisprimary
    ORDER BY c.relname, ic.relname`,
});

/** 固定只读查询序列；任何阶段失败均尝试回滚、关闭连接，且不输出原始第三方错误。 */
async function inspectMigrationSnapshot(
  client,
  baseline,
  databaseName,
  includePrimaryIndexes = false,
) {
  let begun = false;
  let stage = "连接初始化";
  let result;
  const failures = [];
  try {
    await client.connect();
    stage = "开启只读快照";
    await client.query(sql.begin);
    begun = true;
    stage = "隔离库与数据库标记";
    const boundary = (await client.query(sql.boundary)).rows;
    const row = boundary[0];
    requireCondition(
      boundary.length === 1 &&
        row?.database_name === databaseName &&
        row.schema_name === "public" &&
        row.read_only === "on" &&
        row.isolation === "repeatable read",
      "实际数据库或只读事务边界不符合预期",
    );
    requireCondition(
      row.marker_schema === false && row.marker_table === false,
      "发现 Prisma 8 标记或保留命名空间，必须人工审查",
    );
    requireCondition(row.legacy_ledger === true, "缺少 Prisma 7 历史迁移登记");
    stage = "历史迁移登记";
    const ledger = (await client.query(sql.ledger, [baseline.migrations.length + 1])).rows;
    validateMigrationLedger(baseline, ledger);
    stage = "业务目录元数据";
    const catalog = {
      tables: (await client.query(sql.tables)).rows,
      columns: (await client.query(sql.columns, [baseline.tableNames])).rows,
      constraints: (await client.query(sql.constraints, [baseline.tableNames])).rows,
      indexes: (await client.query(sql.indexes, [baseline.tableNames])).rows,
    };
    const report = validateMigrationCatalog(baseline, catalog);
    let primaryIndexes;
    if (includePrimaryIndexes) {
      stage = "主键索引目录元数据";
      primaryIndexes = (await client.query(sql.primaryIndexes, [baseline.tableNames])).rows;
    }
    result = {
      report: {
        ...report,
        marker: "ABSENT",
        timezoneUtc: ["UTC", "Etc/UTC", "GMT"].includes(row.timezone),
      },
      catalog,
      primaryIndexes,
      context: {
        serverVersion: row.server_version,
        serverEncoding: row.server_encoding,
        searchPath: row.search_path,
        dateStyle: row.date_style,
        standardStrings: row.standard_strings,
        databaseCollation: row.database_collation,
        databaseCtype: row.database_ctype,
        timezone: row.timezone,
      },
    };
  } catch (error) {
    failures.push(error instanceof PreflightError ? error.message : stage + "失败");
  } finally {
    if (begun) {
      try {
        await client.query(sql.rollback);
      } catch {
        failures.push("只读快照回滚失败");
      }
    }
    try {
      await client.end();
    } catch {
      failures.push("数据库连接关闭失败");
    }
  }
  if (failures.length > 0) throw new PreflightError("迁移接管只读预检失败：" + failures.join("；"));
  requireCondition(result !== undefined, "迁移接管只读预检未产生有效结果");
  return result;
}

/** 保留原预检返回值、固定验收库及拒绝签名语义。 */
export async function inspectMigrationDatabase(client, baseline) {
  const snapshot = await inspectMigrationSnapshot(client, baseline, "adui_scada_test");
  return snapshot.report;
}

function requireComparisonContext(snapshot) {
  const context = snapshot.context;
  requireCondition(
    snapshot.report.timezoneUtc &&
      context.searchPath === "public" &&
      context.standardStrings === "on" &&
      Object.values(context).every((value) => typeof value === "string" && value.length > 0),
    "目录对照要求完整、受控的 PostgreSQL 查询上下文",
  );
}

/** 对照通过后才向内部候选生成器提供参考库目录，保持原对照入口的返回值。 */
async function readMatchedMigrationSnapshots(
  testClient,
  referenceClient,
  baseline,
  includePrimaryIndexes = false,
) {
  const actual = await inspectMigrationSnapshot(
    testClient,
    baseline,
    "adui_scada_test",
    includePrimaryIndexes,
  );
  requireComparisonContext(actual);
  const reference = await inspectMigrationSnapshot(
    referenceClient,
    baseline,
    "adui_scada_fresh_prisma8_ref",
    includePrimaryIndexes,
  );
  requireComparisonContext(reference);
  same(actual.context, reference.context, "验收库与参考库 PostgreSQL 查询上下文不一致");
  same(actual.catalog.tables, reference.catalog.tables, "验收库与参考库业务表定义或注释不一致");
  same(actual.catalog.columns, reference.catalog.columns, "验收库与参考库字段定义或注释不一致");
  same(
    actual.catalog.constraints,
    reference.catalog.constraints,
    "验收库与参考库原生约束定义不一致",
  );
  same(actual.catalog.indexes, reference.catalog.indexes, "验收库与参考库索引定义或注释不一致");
  same(
    actual.report.catalogFingerprint,
    reference.report.catalogFingerprint,
    "验收库与参考库目录指纹不一致",
  );
  return { actual, reference };
}

/** 仅补充专项读取同一只读快照的主键索引；旧目录及指纹范围不变。 */
export async function readSupplementalMigrationCatalog(testClient, referenceClient, baseline) {
  return readMatchedMigrationSnapshots(testClient, referenceClient, baseline, true);
}

/** 原对照入口仍只返回固定诊断和指纹，不输出数据库原始定义。 */
export async function compareMigrationDatabases(testClient, referenceClient, baseline) {
  const { actual, reference } = await readMatchedMigrationSnapshots(
    testClient,
    referenceClient,
    baseline,
  );
  return {
    status: "MATCHED_REVIEW_REQUIRED",
    signingAllowed: false,
    catalogFingerprint: actual.report.catalogFingerprint,
    referenceFingerprint: reference.report.catalogFingerprint,
    contractHash: baseline.contractHash,
  };
}

/** 仅供原生候选生成器读取已经匹配的参考库元数据，不读取业务记录。 */
export async function readNativeContractCatalog(testClient, referenceClient, baseline) {
  const { reference } = await readMatchedMigrationSnapshots(testClient, referenceClient, baseline);
  return { report: reference.report, catalog: reference.catalog };
}

async function main() {
  requireCondition(process.argv.length === 2, "迁移接管预检不接受命令行参数");
  let connectionString;
  try {
    connectionString = requirePrisma8ReadOnlyTestUrl(process.env.SCADA_TEST_DATABASE_URL);
  } catch {
    throw new PreflightError("迁移接管预检只允许显式指定本机 15432 端口的 adui_scada_test 隔离库");
  }
  const baseline = loadMigrationBaseline();
  const serverRequire = createRequire(join(server, "package.json"));
  const { Client } = serverRequire("pg");
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    options:
      "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000 -c search_path=public",
  });
  const result = await inspectMigrationDatabase(client, baseline);
  console.info("Prisma 8 接管只读预检通过，仍须专项审查；未执行签名、迁移或业务写入");
  console.info(
    "历史迁移：" + result.migrations + "；业务表：" + result.tables + "；字段：" + result.columns,
  );
  console.info(
    "原生 CHECK：" +
      result.checks +
      "；外键：" +
      result.foreignKeys +
      "；非主键索引：" +
      result.indexes,
  );
  console.info("Prisma 8 标记不存在；UTC 会话时区：" + (result.timezoneUtc ? "是" : "否，待审查"));
  console.info("契约存储哈希：" + result.contractHash);
  console.info("实际目录结构指纹：" + result.catalogFingerprint);
  console.info("待保留复合外键：" + result.contractForeignKeyGap);
  console.info("接管状态：REVIEW_REQUIRED；签名许可：否");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    const message = error instanceof PreflightError ? error.message : "迁移接管预检初始化失败";
    console.error(message);
    process.exitCode = 1;
  });
}
