import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeHash } from "./prisma8-native-baseline.mjs";
import {
  migrationApplyConfirmation,
  migrationArguments,
  migrationPreviewConfirmation,
  migrationRequest,
  requireMigrationResult,
  requireNativeAppliedResult,
  requireNativeMigrationPath,
} from "./prisma8-native-baseline-migrate.mjs";

const url =
  "postgresql://lab_owner:sample%40password@127.0.0.1:15432/adui_scada_fresh_prisma8_native?schema=public";
const edge = {
  spaceId: "app",
  dirName: "20261125T0918_scada_native_baseline",
  migrationHash: "e6b95ed88834dce3f6448445a5ba12a00ba34c8e5c68f4335751659b15a77f17",
  from: "empty",
  to: nativeHash,
};

function envelope(result, commandId = "db.migrate") {
  return {
    kind: "result",
    commandId,
    envelope: { commandId, ok: true, exitCode: 0, diagnostics: [], result },
  };
}

void test("独立预览和迁移只接受专用连接及固定授权", () => {
  const request = migrationRequest(url, [migrationApplyConfirmation], {
    PATH: "测试路径",
    NODE_OPTIONS: "敏感注入",
    SCADA_DATABASE_URL: "其他数据库",
    PGOPTIONS: "其他连接选项",
  });
  assert.equal(request.apply, true);
  assert.equal(
    request.env.SCADA_PRISMA8_NATIVE_BASELINE_DATABASE_URL,
    url.replace("?schema=public", ""),
  );
  assert.equal(Object.hasOwn(request.env, "NODE_OPTIONS"), false);
  assert.equal(Object.hasOwn(request.env, "SCADA_DATABASE_URL"), false);
  assert.equal(Object.hasOwn(request.env, "PGOPTIONS"), false);
  assert.equal(migrationRequest(url, [migrationPreviewConfirmation], {}).apply, false);
  for (const args of [[], ["--yes"], [migrationApplyConfirmation, "--extra"]]) {
    assert.throws(() => migrationRequest(url, args, {}), /明确确认/u);
  }
  assert.throws(
    () =>
      migrationRequest(
        url.replace("fresh_prisma8_native", "test"),
        [migrationApplyConfirmation],
        {},
      ),
    /仅允许/u,
  );
});

void test("官方参数固定目标且凭据不进入命令行", () => {
  assert.deepEqual(migrationArguments("入口", "配置", "预览"), [
    "入口",
    "db",
    "migrate",
    "--show",
    "--to",
    nativeHash,
    "--no-advance-ref",
    "--json",
    "--config",
    "配置",
  ]);
  assert.deepEqual(migrationArguments("入口", "配置", "迁移"), [
    "入口",
    "db",
    "migrate",
    "--to",
    nativeHash,
    "--no-advance-ref",
    "--json",
    "--config",
    "配置",
  ]);
  assert.deepEqual(migrationArguments("入口", "配置", "校验"), [
    "入口",
    "db",
    "verify",
    "--json",
    "--config",
    "配置",
  ]);
  assert.throws(() => migrationArguments("入口", "配置", "签名"), /动作无效/u);
});

void test("机器响应严格确认唯一最终成功结果且不回显敏感错误", () => {
  const result = { ok: true, migrations: [edge] };
  const valid = envelope(result);
  assert.deepEqual(requireMigrationResult(JSON.stringify(valid), "db.migrate"), result);
  assert.deepEqual(
    requireMigrationResult(
      JSON.stringify({ kind: "event" }) + "\n" + JSON.stringify(valid),
      "db.migrate",
    ),
    result,
  );
  for (const value of [
    { ...valid, commandId: "db.sign" },
    { ...valid, envelope: { ...valid.envelope, ok: false, error: "敏感原始错误" } },
    { ...valid, envelope: { ...valid.envelope, diagnostics: ["敏感诊断"] } },
  ]) {
    assert.throws(() => requireMigrationResult(JSON.stringify(value), "db.migrate"), /未确认成功/u);
  }
  assert.throws(() => requireMigrationResult("敏感非 JSON", "db.migrate"), /无法解析/u);
  assert.throws(
    () =>
      requireMigrationResult(JSON.stringify(valid) + "\n" + JSON.stringify(valid), "db.migrate"),
    /未确认成功/u,
  );
});

void test("首次预览只允许固定迁移边且迁移后必须无剩余路径", () => {
  requireNativeMigrationPath({ ok: true, migrations: [edge] }, false);
  requireNativeMigrationPath({ ok: true, migrations: [] }, true);
  for (const migrations of [
    [],
    [edge, edge],
    [{ ...edge, spaceId: "其他空间" }],
    [{ ...edge, from: nativeHash }],
    [{ ...edge, migrationHash: "其他迁移" }],
  ]) {
    assert.throws(() => requireNativeMigrationPath({ ok: true, migrations }, false), /路径/u);
  }
  assert.throws(() => requireNativeMigrationPath({ ok: true, migrations: [edge] }, true), /路径/u);
});

void test("应用结果必须匹配唯一迁移标识、目标标记及不推进引用", () => {
  const valid = {
    ok: true,
    migrationsApplied: 1,
    migrationsTotal: 1,
    markerHash: nativeHash,
    applied: [{ ...edge, operationsExecuted: 164 }],
    advancedRef: null,
  };
  assert.equal(requireNativeAppliedResult(valid), 164);
  for (const changed of [
    { ...valid, migrationsApplied: 0 },
    { ...valid, markerHash: "错误标记" },
    { ...valid, advancedRef: { name: "db", hash: nativeHash } },
    { ...valid, applied: [{ ...edge, operationsExecuted: 166 }] },
    { ...valid, applied: [{ ...edge, to: "错误目标", operationsExecuted: 165 }] },
  ]) {
    assert.throws(() => requireNativeAppliedResult(changed), /禁止自动重试/u);
  }
});
