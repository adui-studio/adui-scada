import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeHash } from "./prisma8-native-baseline.mjs";
import {
  describeNativeChildFailure,
  inspectNativeMigrationState,
  requireRecoveryReview,
} from "./prisma8-native-baseline-recovery.mjs";

const boundary = {
  database_name: "adui_scada_fresh_prisma8_native",
  role_name: "lab_owner",
  session_role: "lab_owner",
  read_only: "on",
  default_read_only: "on",
  isolation: "repeatable read",
  server_version: "170011",
  in_recovery: false,
  database_owner: true,
  other_sessions: false,
};
const empty = {
  tables: 0,
  columns: 0,
  primary_keys: 0,
  foreign_keys: 0,
  checks: 0,
  non_primary_indexes: 0,
  table_comments: 0,
  column_comments: 0,
  index_comments: 0,
  marker_schema: false,
  marker_table: false,
  ledger_table: false,
  legacy_ledger: false,
};
const populated = {
  ...empty,
  tables: 12,
  columns: 85,
  primary_keys: 12,
  foreign_keys: 13,
  checks: 36,
  non_primary_indexes: 20,
  table_comments: 12,
  column_comments: 85,
  index_comments: 22,
  marker_schema: true,
  marker_table: true,
  ledger_table: true,
};

function mock({
  catalog = empty,
  target = boundary,
  failAt = "",
  marker = { rows: 1, matched: 1 },
  ledger = { rows: 1, matched: 1 },
} = {}) {
  const calls = [];
  const client = {
    async connect() {
      calls.push("连接");
    },
    async query(sql, params = []) {
      calls.push(sql);
      if (failAt && sql.includes(failAt))
        throw Object.assign(new Error("敏感连接串"), { code: "42703" });
      if (sql.includes("pg_is_in_recovery")) return { rows: [target] };
      if (sql.startsWith("WITH tables")) return { rows: [catalog] };
      if (sql.includes("FROM prisma_contract.marker")) {
        assert.deepEqual(params, [nativeHash]);
        return { rows: [marker] };
      }
      if (sql.includes("FROM prisma_contract.ledger")) {
        assert.deepEqual(params, [
          "e6b95ed88834dce3f6448445a5ba12a00ba34c8e5c68f4335751659b15a77f17",
          nativeHash,
        ]);
        return { rows: [ledger] };
      }
      return { rows: [] };
    },
    async end() {
      calls.push("关闭");
      if (failAt === "关闭") throw new Error("敏感异常");
    },
  };
  return { client, calls };
}

void test("事故恢复期间任何迁移确认均被拒绝", () => {
  requireRecoveryReview(false);
  assert.throws(() => requireRecoveryReview(true), /禁止再次执行迁移/u);
});

void test("子进程失败仅输出固定退出码和白名单官方及数据库错误码", () => {
  const document = {
    kind: "result",
    commandId: "db.migrate",
    envelope: {
      commandId: "db.migrate",
      ok: false,
      error: {
        code: "MIGRATION.EXECUTION_FAILED",
        message: "敏感密码",
        meta: { cause: { sqlState: "42501", message: "敏感连接串" } },
        details: { code: "SECRET.PRIVATE" },
      },
    },
  };
  const report = describeNativeChildFailure(
    {
      status: 2,
      stdout: JSON.stringify({ kind: "event" }) + "\n" + JSON.stringify(document),
      stderr: "敏感标准错误",
    },
    "db.migrate",
  );
  assert.match(report, /退出码：2/u);
  assert.match(report, /MIGRATION\.EXECUTION_FAILED/u);
  assert.match(report, /42501/u);
  assert.doesNotMatch(report, /敏感|SECRET/u);
  const timeout = describeNativeChildFailure(
    { status: null, error: { code: "ETIMEDOUT", message: "敏感异常" }, stdout: "", stderr: "" },
    "db.migrate",
  );
  assert.match(timeout, /ETIMEDOUT/u);
  assert.doesNotMatch(timeout, /敏感/u);
  const unknown = describeNativeChildFailure(
    {
      status: 1,
      error: { code: "SECRET" },
      stdout: JSON.stringify({ ...document, commandId: "db.sign" }),
    },
    "db.migrate",
  );
  assert.match(unknown, /未取得白名单错误码/u);
  assert.doesNotMatch(unknown, /SECRET|42501/u);
});

void test("空目录恢复检查只读并在返回之前回滚关闭", async () => {
  const { client, calls } = mock();
  const result = await inspectNativeMigrationState(client, "lab_owner");
  assert.deepEqual(result.catalog, empty);
  assert.deepEqual(result.metadata, { marker: null, ledger: null });
  assert.deepEqual(calls.slice(0, 2), ["连接", "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"]);
  assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
  assert.equal(calls.length, 6);
});

void test("非空目录和迁移元数据只返回固定统计且不宣称迁移成功", async () => {
  const { client, calls } = mock({ catalog: populated });
  const result = await inspectNativeMigrationState(client, "lab_owner");
  assert.deepEqual(result.catalog, populated);
  assert.deepEqual(result.metadata, {
    marker: { rows: 1, matched: 1 },
    ledger: { rows: 1, matched: 1 },
  });
  assert.equal(result.status, "NATIVE_MIGRATION_RECOVERY_REVIEW_REQUIRED");
  assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
  const partial = mock({
    catalog: { ...populated, ledger_table: false },
    marker: { rows: 1, matched: 0 },
  });
  const partialResult = await inspectNativeMigrationState(partial.client, "lab_owner");
  assert.deepEqual(partialResult.metadata, { marker: { rows: 1, matched: 0 }, ledger: null });
});

void test("目标错误或其他会话不得进入目录查询", async () => {
  for (const target of [
    { ...boundary, database_name: "adui_scada_test" },
    { ...boundary, other_sessions: true },
    { ...boundary, read_only: "off" },
  ]) {
    const { client, calls } = mock({ target });
    await assert.rejects(
      () => inspectNativeMigrationState(client, "lab_owner"),
      /实际数据库、所有者/u,
    );
    assert.equal(calls.length, 5);
    assert.deepEqual(calls.slice(-2), ["ROLLBACK", "关闭"]);
  }
});

void test("目录与元数据异常或清理失败必须停止且不回显原文", async () => {
  for (const failAt of [
    "WITH tables",
    "FROM prisma_contract.marker",
    "FROM prisma_contract.ledger",
    "ROLLBACK",
    "关闭",
  ]) {
    const { client, calls } = mock({ catalog: populated, failAt });
    await assert.rejects(
      () => inspectNativeMigrationState(client, "lab_owner"),
      (error) => {
        assert.match(error.message, /恢复检查/u);
        assert.doesNotMatch(error.message, /敏感/u);
        return true;
      },
    );
    assert.equal(calls.at(-1), "关闭");
  }
  const malformed = mock({ catalog: { ...empty, columns: "错误" } });
  await assert.rejects(
    () => inspectNativeMigrationState(malformed.client, "lab_owner"),
    /统计形状无效/u,
  );
});

void test("官方直接错误封装可定位且不回显摘要或敏感元数据", () => {
  const document = {
    ok: false,
    severity: "error",
    code: "MIGRATION.PRECHECK_FAILED",
    summary: "敏感摘要",
    meta: { cause: { sqlState: "42P01", message: "敏感连接串" } },
  };
  const report = describeNativeChildFailure(
    { status: 2, stdout: "", stderr: JSON.stringify(document) },
    "db.migrate",
  );
  assert.match(report, /MIGRATION\.PRECHECK_FAILED/u);
  assert.match(report, /42P01/u);
  assert.doesNotMatch(report, /敏感/u);
  const mismatched = describeNativeChildFailure(
    { status: 2, stdout: JSON.stringify({ ...document, commandId: "db.sign" }) },
    "db.migrate",
  );
  assert.match(mismatched, /未取得白名单错误码/u);
  assert.doesNotMatch(mismatched, /42P01/u);
});
