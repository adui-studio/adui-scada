import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  requirePrisma8ReadOnlyReferenceUrl,
  requirePrisma8ReadOnlyTestUrl,
} from "../apps/server/src/database/prisma8-readonly-target.ts";
import {
  compareMigrationDatabases,
  inspectMigrationDatabase,
  loadMigrationBaseline,
  readNativeContractCatalog,
  validateMigrationCatalog,
  validateMigrationLedger,
} from "./inspect-prisma8-migration-readiness.mjs";

const baseline = loadMigrationBaseline();
const lastEventKey = "scada_project_release_state_last_event_fkey";
const permissionCheck =
  "CHECK ((permission = ANY (ARRAY['project:read'::text, 'version:read'::text, 'version:append'::text, 'release:publish'::text, 'release:rollback'::text, 'release:read'::text])))";
const boundary = {
  database_name: "adui_scada_test",
  schema_name: "public",
  read_only: "on",
  isolation: "repeatable read",
  timezone: "UTC",
  server_version: "170004",
  server_encoding: "UTF8",
  search_path: "public",
  date_style: "ISO, MDY",
  standard_strings: "on",
  database_collation: "C",
  database_ctype: "C",
  legacy_ledger: true,
  marker_schema: false,
  marker_table: false,
};

function ledger() {
  return baseline.migrations.map((migration) => ({
    migration_name: migration.name,
    checksum: migration.checksum,
    finished: true,
    rolled_back: false,
    applied_steps_count: 1,
  }));
}

function catalog() {
  return {
    tables: baseline.tableNames.map((table_name) => ({ table_name, comment: "测试业务表" })),
    columns: Object.entries(baseline.tables).flatMap(([table_name, table]) =>
      Object.entries(table.columns).map(([column_name, column]) => ({
        table_name,
        column_name,
        udt_name: column.dataType.slice(3),
        nullable: column.nullable,
        character_length: column.typeParams?.length ?? null,
        datetime_precision: column.typeParams?.precision ?? null,
        default_expression: column.default ? "模拟默认表达式" : null,
        comment: "测试字段说明",
      })),
    ),
    constraints: [...baseline.constraints.values()].map((entry) => ({
      table_name: entry.table,
      constraint_name: entry.name,
      kind: entry.kind,
      validated: true,
      deferrable: false,
      deferred: false,
      definition:
        entry.name === "scada_project_grants_permission_check" ? permissionCheck : "模拟原生定义",
      source_columns:
        entry.kind === "p"
          ? [...baseline.tables[entry.table].primaryKey.columns]
          : [...(entry.source ?? [])],
      target_schema: entry.kind === "f" ? "public" : null,
      target_table: entry.target ?? null,
      target_columns: [...(entry.targetColumns ?? [])],
      delete_rule: "r",
      update_rule: "c",
      match_type: "s",
    })),
    indexes: Object.entries(baseline.tables).flatMap(([table_name, table]) =>
      table.indexes.map((index) => ({
        table_name,
        index_name: index.name,
        unique: index.unique,
        valid: true,
        ready: true,
        simple: true,
        method: "btree",
        columns: [...index.columns],
        definition: "模拟索引定义",
        comment: "测试索引说明",
      })),
    ),
  };
}

function mockClient({
  boundaryRow = boundary,
  history = ledger(),
  metadata = catalog(),
  failAt = "",
  closeFails = false,
} = {}) {
  const calls = [];
  const client = {
    connect: () => {
      calls.push("连接");
      return Promise.resolve();
    },
    query: (query, values) => {
      calls.push(query);
      if (query.includes(failAt) && failAt !== "")
        return Promise.reject(new Error("测试内部连接信息不得回显"));
      if (query === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" || query === "ROLLBACK")
        return Promise.resolve({ rows: [] });
      if (query.startsWith("SELECT current_database()"))
        return Promise.resolve({ rows: [boundaryRow] });
      if (query.includes("FROM public._prisma_migrations")) {
        assert.deepEqual(values, [9]);
        return Promise.resolve({ rows: history });
      }
      if (query.includes("FROM information_schema.columns")) {
        assert.deepEqual(values, [baseline.tableNames]);
        return Promise.resolve({ rows: metadata.columns });
      }
      if (query.includes("FROM pg_constraint")) {
        assert.deepEqual(values, [baseline.tableNames]);
        return Promise.resolve({ rows: metadata.constraints });
      }
      if (query.includes("FROM pg_index")) {
        assert.deepEqual(values, [baseline.tableNames]);
        return Promise.resolve({ rows: metadata.indexes });
      }
      if (query.includes("FROM pg_class c")) return Promise.resolve({ rows: metadata.tables });
      return Promise.reject(new Error("出现未批准的数据库查询"));
    },
    end: () => {
      calls.push("关闭");
      return closeFails ? Promise.reject(new Error("内部关闭异常不得回显")) : Promise.resolve();
    },
  };
  return { client, calls };
}

void describe("Prisma 8 迁移接管只读预检", () => {
  void it("真实仓库历史迁移和生成契约包含明确的安全差异", () => {
    assert.equal(baseline.migrations.length, 8);
    assert.equal(baseline.tableNames.length, 12);
    assert.equal(baseline.columnCount, 85);
    assert.equal(baseline.indexCount, 20);
    assert.equal(baseline.constraints.size, 61);
    assert.equal([...baseline.constraints.values()].filter((row) => row.kind === "c").length, 36);
    assert.equal([...baseline.constraints.values()].filter((row) => row.kind === "f").length, 13);
    assert.deepEqual(baseline.constraints.get(lastEventKey)?.source, [
      "tenant_id",
      "project_id",
      "release_generation",
      "released_revision",
      "released_content_hash",
      "last_release_event_id",
    ]);
    assert.deepEqual(baseline.constraints.get(lastEventKey)?.targetColumns, [
      "tenant_id",
      "project_id",
      "generation",
      "to_revision",
      "to_content_hash",
      "event_id",
    ]);
    assert.match(baseline.contractHash, /^[0-9a-f]{64}$/);
    assert.equal(
      baseline.migrations.every((row) => /^[0-9a-f]{64}$/.test(row.checksum)),
      true,
    );
  });

  void it("历史记录完整且校验和匹配才通过并拒绝缺失、重复和失败记录", () => {
    validateMigrationLedger(baseline, ledger());
    const rows = ledger();
    assert.throws(() => validateMigrationLedger(baseline, rows.slice(1)), /登记数量不一致/);
    assert.throws(() => validateMigrationLedger(baseline, [...rows.slice(1), rows[1]]), /重复记录/);
    assert.throws(
      () => validateMigrationLedger(baseline, [{ ...rows[0], finished: false }, ...rows.slice(1)]),
      /未完成/,
    );
    assert.throws(
      () =>
        validateMigrationLedger(baseline, [{ ...rows[0], rolled_back: true }, ...rows.slice(1)]),
      /存在回滚/,
    );
    assert.throws(
      () =>
        validateMigrationLedger(baseline, [
          { ...rows[0], applied_steps_count: 0 },
          ...rows.slice(1),
        ]),
      /未完成/,
    );
    assert.throws(
      () =>
        validateMigrationLedger(baseline, [
          { ...rows[0], checksum: "0".repeat(64) },
          ...rows.slice(1),
        ]),
      /校验和不一致/,
    );
  });

  void it("正向元数据只产生待审查结论且指纹包含真实定义和注释", () => {
    const metadata = catalog();
    const result = validateMigrationCatalog(baseline, metadata);
    assert.equal(result.status, "REVIEW_REQUIRED");
    assert.equal(result.signingAllowed, false);
    assert.equal(result.contractForeignKeyGap, lastEventKey);
    assert.match(result.catalogFingerprint, /^[0-9a-f]{64}$/);
    assert.equal(
      validateMigrationCatalog(baseline, metadata).catalogFingerprint,
      result.catalogFingerprint,
    );
    metadata.constraints.find(
      (row) => row.constraint_name === "scada_projects_head_revision_check",
    ).definition = "模拟另一种原生定义";
    assert.notEqual(
      validateMigrationCatalog(baseline, metadata).catalogFingerprint,
      result.catalogFingerprint,
    );
  });

  void it("表、字段、类型、空值、默认值存在性和中文注释不一致均拒绝", () => {
    const metadata = catalog();
    assert.throws(
      () => validateMigrationCatalog(baseline, { ...metadata, tables: metadata.tables.slice(1) }),
      /业务表清单不一致/,
    );
    assert.throws(
      () => validateMigrationCatalog(baseline, { ...metadata, columns: metadata.columns.slice(1) }),
      /业务字段数量不一致/,
    );
    for (const changes of [
      { udt_name: "text" },
      { nullable: !metadata.columns[0].nullable },
      { character_length: 1 },
      { default_expression: "额外默认值" },
    ]) {
      const columns = [{ ...metadata.columns[0], ...changes }, ...metadata.columns.slice(1)];
      assert.throws(
        () => validateMigrationCatalog(baseline, { ...metadata, columns }),
        /业务字段类型/,
      );
    }
    const columns = [{ ...metadata.columns[0], comment: null }, ...metadata.columns.slice(1)];
    assert.throws(
      () => validateMigrationCatalog(baseline, { ...metadata, columns }),
      /缺少中文数据库注释/,
    );
  });

  void it("拒绝弱化复合外键、未验证约束及旧三项 ACL 定义", () => {
    const metadata = catalog();
    const key = metadata.constraints.find((row) => row.constraint_name === lastEventKey);
    key.source_columns = ["last_release_event_id"];
    key.target_columns = ["event_id"];
    assert.throws(() => validateMigrationCatalog(baseline, metadata), /实际外键字段/);
    const notValidated = catalog();
    notValidated.constraints[0].validated = false;
    assert.throws(() => validateMigrationCatalog(baseline, notValidated), /未验证/);
    const acl = catalog();
    acl.constraints.find(
      (row) => row.constraint_name === "scada_project_grants_permission_check",
    ).definition =
      "CHECK ((permission = ANY (ARRAY['project:read'::text, 'version:read'::text, 'version:append'::text])))";
    assert.throws(() => validateMigrationCatalog(baseline, acl), /权限白名单定义不一致/);
    const bypass = catalog();
    bypass.constraints.find(
      (row) => row.constraint_name === "scada_project_grants_permission_check",
    ).definition = permissionCheck.slice(0, -1) + " OR true)";
    assert.throws(() => validateMigrationCatalog(baseline, bypass), /权限白名单定义不一致/);
  });

  void it("索引缺失、失效、顺序或唯一性不一致均拒绝", () => {
    const metadata = catalog();
    assert.throws(
      () => validateMigrationCatalog(baseline, { ...metadata, indexes: metadata.indexes.slice(1) }),
      /索引数量不一致/,
    );
    for (const change of [
      { valid: false },
      { simple: false },
      { unique: !metadata.indexes[0].unique },
    ]) {
      const indexes = [{ ...metadata.indexes[0], ...change }, ...metadata.indexes.slice(1)];
      assert.throws(
        () => validateMigrationCatalog(baseline, { ...metadata, indexes }),
        /实际索引所属表/,
      );
    }
    const indexes = [
      { ...metadata.indexes[0], columns: ["wrong_column"] },
      ...metadata.indexes.slice(1),
    ];
    assert.throws(
      () => validateMigrationCatalog(baseline, { ...metadata, indexes }),
      /实际索引字段/,
    );
  });

  void it("只读事务按固定顺序查询元数据且最终回滚和关闭", async () => {
    const { client, calls } = mockClient();
    const result = await inspectMigrationDatabase(client, baseline);
    assert.equal(result.signingAllowed, false);
    assert.equal(result.marker, "ABSENT");
    assert.equal(result.timezoneUtc, true);
    assert.equal(calls.length, 10);
    assert.deepEqual(calls.slice(0, 2), [
      "连接",
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    ]);
    assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
    assert.equal(
      calls.slice(2, -2).every((query) => query.startsWith("SELECT")),
      true,
    );
  });

  void it("实际连接边界或 Prisma 8 标记异常时停止历史与目录查询", async () => {
    for (const { changes, expected } of [
      { changes: { database_name: "adui_scada" }, expected: /实际数据库或只读事务边界/ },
      { changes: { read_only: "off" }, expected: /实际数据库或只读事务边界/ },
      { changes: { marker_schema: true }, expected: /发现 Prisma 8 标记/ },
      { changes: { marker_table: true }, expected: /发现 Prisma 8 标记/ },
      { changes: { legacy_ledger: false }, expected: /缺少 Prisma 7 历史迁移登记/ },
    ]) {
      const { client, calls } = mockClient({ boundaryRow: { ...boundary, ...changes } });
      await assert.rejects(() => inspectMigrationDatabase(client, baseline), expected);
      assert.equal(calls.length, 5);
      assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
    }
  });

  void it("查询和关闭失败均按固定阶段脱敏且不能返回成功结果", async () => {
    const first = mockClient({ failAt: "FROM pg_constraint" });
    await assert.rejects(() => inspectMigrationDatabase(first.client, baseline), {
      message: "迁移接管只读预检失败：业务目录元数据失败",
    });
    assert.deepEqual(first.calls.slice(-2), ["ROLLBACK", "关闭"]);
    const second = mockClient({ failAt: "ROLLBACK", closeFails: true });
    await assert.rejects(() => inspectMigrationDatabase(second.client, baseline), {
      message: "迁移接管只读预检失败：只读快照回滚失败；数据库连接关闭失败",
    });
    assert.deepEqual(second.calls.slice(-2), ["ROLLBACK", "关闭"]);
  });
});

const referenceBoundary = { ...boundary, database_name: "adui_scada_fresh_prisma8_ref" };

void describe("Prisma 8 独立参考库只读目录对照", () => {
  void it("两个固定目标的 URL 门禁互相隔离且拒绝业务库和额外参数", () => {
    const testUrl = "postgresql://test_user@127.0.0.1:15432/adui_scada_test";
    const referenceUrl = "postgresql://test_user@127.0.0.1:15432/adui_scada_fresh_prisma8_ref";
    assert.equal(requirePrisma8ReadOnlyTestUrl(testUrl + "?schema=public"), testUrl);
    assert.equal(requirePrisma8ReadOnlyReferenceUrl(referenceUrl + "?schema=public"), referenceUrl);
    assert.throws(() => requirePrisma8ReadOnlyTestUrl(referenceUrl), /只读探针仅允许/);
    for (const invalid of [
      undefined,
      testUrl,
      referenceUrl.replace("127.0.0.1", "example.invalid"),
      referenceUrl.replace("15432", "5432"),
      referenceUrl.replace("adui_scada_fresh_prisma8_ref", "adui_scada"),
      referenceUrl + "?schema=private",
      referenceUrl + "?options=unsafe",
      referenceUrl + "?schema=public&schema=public",
      referenceUrl + "#fragment",
      referenceUrl + "\n",
    ]) {
      assert.throws(() => requirePrisma8ReadOnlyReferenceUrl(invalid), /目录对照仅允许/);
    }
  });

  void it("两库目录定义逐项一致且分别回滚关闭仍禁止签名", async () => {
    const actual = mockClient();
    const reference = mockClient({ boundaryRow: referenceBoundary });
    const result = await compareMigrationDatabases(actual.client, reference.client, baseline);
    assert.equal(result.status, "MATCHED_REVIEW_REQUIRED");
    assert.equal(result.signingAllowed, false);
    assert.equal(result.contractHash, baseline.contractHash);
    assert.equal(result.catalogFingerprint, result.referenceFingerprint);
    assert.equal(
      result.catalogFingerprint,
      validateMigrationCatalog(baseline, catalog()).catalogFingerprint,
    );
    for (const calls of [actual.calls, reference.calls]) {
      assert.equal(calls.length, 10);
      assert.deepEqual(calls.slice(0, 2), [
        "连接",
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      ]);
      assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
      assert.equal(
        calls.slice(2, -2).every((query) => query.startsWith("SELECT")),
        true,
      );
    }
  });

  void it("仅在两库目录完整匹配并关闭后提供原生候选元数据", async () => {
    const actual = mockClient();
    const reference = mockClient({ boundaryRow: referenceBoundary });
    const result = await readNativeContractCatalog(actual.client, reference.client, baseline);
    assert.deepEqual(result.catalog, catalog());
    assert.equal(
      result.report.catalogFingerprint,
      validateMigrationCatalog(baseline, catalog()).catalogFingerprint,
    );
    assert.equal(result.report.signingAllowed, false);
    assert.deepEqual(actual.calls.slice(-2), ["ROLLBACK", "关闭"]);
    assert.deepEqual(reference.calls.slice(-2), ["ROLLBACK", "关闭"]);

    const drift = catalog();
    drift.tables[0].comment = "不同中文表注释";
    const anotherActual = mockClient();
    const anotherReference = mockClient({ boundaryRow: referenceBoundary, metadata: drift });
    await assert.rejects(
      () => readNativeContractCatalog(anotherActual.client, anotherReference.client, baseline),
      /业务表定义或注释不一致/,
    );
    assert.deepEqual(anotherActual.calls.slice(-2), ["ROLLBACK", "关闭"]);
    assert.deepEqual(anotherReference.calls.slice(-2), ["ROLLBACK", "关闭"]);
  });

  void it("拒绝预检能通过但原生定义或注释不一致的参考库", async () => {
    const tableComment = catalog();
    tableComment.tables[0].comment = "不同中文表注释";
    const defaultValue = catalog();
    const column = defaultValue.columns.find((row) => row.default_expression !== null);
    assert.ok(column, "默认值测试夹具必须存在");
    column.default_expression = "模拟另一种默认值表达式";
    const check = catalog();
    const nativeCheck = check.constraints.find(
      (row) => row.constraint_name === "scada_projects_head_revision_check",
    );
    assert.ok(nativeCheck, "原生检查约束测试夹具必须存在");
    nativeCheck.definition = "模拟另一种原生约束定义";
    const indexDefinition = catalog();
    indexDefinition.indexes[0].definition = "模拟另一种索引排序定义";
    const indexComment = catalog();
    indexComment.indexes[0].comment = "不同中文索引注释";
    for (const { metadata, expected } of [
      { metadata: tableComment, expected: /业务表定义或注释不一致/ },
      { metadata: defaultValue, expected: /字段定义或注释不一致/ },
      { metadata: check, expected: /原生约束定义不一致/ },
      { metadata: indexDefinition, expected: /索引定义或注释不一致/ },
      { metadata: indexComment, expected: /索引定义或注释不一致/ },
    ]) {
      assert.equal(validateMigrationCatalog(baseline, metadata).status, "REVIEW_REQUIRED");
      const actual = mockClient();
      const reference = mockClient({ boundaryRow: referenceBoundary, metadata });
      await assert.rejects(
        () => compareMigrationDatabases(actual.client, reference.client, baseline),
        expected,
      );
      assert.deepEqual(actual.calls.slice(-2), ["ROLLBACK", "关闭"]);
      assert.deepEqual(reference.calls.slice(-2), ["ROLLBACK", "关闭"]);
    }
  });

  void it("参考库实际库名错误或标记异常时拒绝继续读取", async () => {
    for (const { changes, expected } of [
      { changes: { database_name: "adui_scada_test" }, expected: /实际数据库或只读事务边界/ },
      { changes: { marker_schema: true }, expected: /发现 Prisma 8 标记/ },
      { changes: { legacy_ledger: false }, expected: /缺少 Prisma 7 历史迁移登记/ },
    ]) {
      const actual = mockClient();
      const reference = mockClient({ boundaryRow: { ...referenceBoundary, ...changes } });
      await assert.rejects(
        () => compareMigrationDatabases(actual.client, reference.client, baseline),
        expected,
      );
      assert.equal(reference.calls.length, 5);
      assert.deepEqual(actual.calls.slice(-2), ["ROLLBACK", "关闭"]);
      assert.deepEqual(reference.calls.slice(-2), ["ROLLBACK", "关闭"]);
    }
  });

  void it("拒绝查询上下文不完整、不受控或不同的参考库", async () => {
    for (const { changes, expected } of [
      { changes: { server_version: "170005" }, expected: /查询上下文不一致/ },
      { changes: { database_collation: "C.UTF-8" }, expected: /查询上下文不一致/ },
      { changes: { date_style: "ISO, DMY" }, expected: /查询上下文不一致/ },
      { changes: { server_encoding: "" }, expected: /完整、受控的 PostgreSQL 查询上下文/ },
      {
        changes: { search_path: "public, pg_catalog" },
        expected: /完整、受控的 PostgreSQL 查询上下文/,
      },
      { changes: { timezone: "Asia/Shanghai" }, expected: /完整、受控的 PostgreSQL 查询上下文/ },
      { changes: { standard_strings: "off" }, expected: /完整、受控的 PostgreSQL 查询上下文/ },
    ]) {
      const actual = mockClient();
      const reference = mockClient({ boundaryRow: { ...referenceBoundary, ...changes } });
      await assert.rejects(
        () => compareMigrationDatabases(actual.client, reference.client, baseline),
        expected,
      );
      assert.deepEqual(actual.calls.slice(-2), ["ROLLBACK", "关闭"]);
      assert.deepEqual(reference.calls.slice(-2), ["ROLLBACK", "关闭"]);
    }
  });

  void it("验收库预检失败则不连接参考库且不输出第三方错误", async () => {
    const actual = mockClient({ failAt: "FROM pg_constraint" });
    const reference = mockClient({ boundaryRow: referenceBoundary });
    await assert.rejects(
      () => compareMigrationDatabases(actual.client, reference.client, baseline),
      { message: "迁移接管只读预检失败：业务目录元数据失败" },
    );
    assert.deepEqual(actual.calls.slice(-2), ["ROLLBACK", "关闭"]);
    assert.equal(reference.calls.length, 0);
  });
});
