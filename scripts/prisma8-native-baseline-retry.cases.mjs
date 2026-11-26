import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimNativeRetry,
  isNativeDirectError,
  isNativeRetryRequest,
  nativeRetryConfirmation,
} from "./prisma8-native-baseline-retry.mjs";

const fingerprint = "02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e";
const receiptName = "prisma8-native-baseline-retry-20261126.json";

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "scada-retry-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const parent = join(root, "apps", "server", ".artifacts");
  mkdirSync(parent, { recursive: true });
  return { root, parent, receipt: join(parent, receiptName) };
}

void test("仅接受新的单一恢复确认参数", () => {
  assert.equal(isNativeRetryRequest([nativeRetryConfirmation]), true);
  for (const args of [
    [],
    ["--confirm-adui-scada-fresh-prisma8-native-migrate"],
    [nativeRetryConfirmation, "--force"],
    [nativeRetryConfirmation, nativeRetryConfirmation],
  ]) {
    assert.equal(isNativeRetryRequest(args), false);
  }
});

void test("一次性记录不覆盖且失败后也禁止再次取得授权", (t) => {
  const { root, receipt } = fixture(t);
  claimNativeRetry(root, fingerprint);
  const original = readFileSync(receipt, "utf8");
  assert.deepEqual(JSON.parse(original), {
    scope: "PRISMA8_NATIVE_BASELINE_RETRY_V1",
    fingerprint,
  });
  assert.throws(() => claimNativeRetry(root, fingerprint), /记录已存在/u);
  assert.equal(readFileSync(receipt, "utf8"), original);
});

void test("指纹错误或目录缺失拒绝且不创建记录", (t) => {
  const { root, parent, receipt } = fixture(t);
  assert.throws(() => claimNativeRetry(root, "错误"), /指纹不符/u);
  assert.throws(() => readFileSync(receipt), { code: "ENOENT" });
  rmSync(parent, { recursive: true });
  assert.throws(() => claimNativeRetry(root, fingerprint), /无法安全保存/u);
});

void test("拒绝重定向的尝试记录目录", (t) => {
  const { root, parent } = fixture(t);
  const other = join(root, "other");
  mkdirSync(other);
  rmSync(parent, { recursive: true });
  symlinkSync(other, parent, "junction");
  assert.throws(() => claimNativeRetry(root, fingerprint), /目录不安全/u);
  assert.throws(() => readFileSync(join(other, receiptName)), { code: "ENOENT" });
});

void test("直接错误封装限定命令严重度和白名单", () => {
  const allowed = new Set(["MIGRATION.EXECUTION_FAILED"]);
  const error = { ok: false, severity: "error", code: "MIGRATION.EXECUTION_FAILED" };
  assert.equal(isNativeDirectError(error, "db.migrate", allowed), true);
  assert.equal(isNativeDirectError({ ...error, commandId: "db.verify" }, "db.verify", allowed), true);
  assert.equal(isNativeDirectError({ ...error, commandId: "db.sign" }, "db.migrate", allowed), false);
  assert.equal(isNativeDirectError({ ...error, severity: "warn" }, "db.migrate", allowed), false);
  assert.equal(isNativeDirectError({ ...error, code: "SECRET.PRIVATE" }, "db.migrate", allowed), false);
  assert.equal(isNativeDirectError(error, "", allowed), false);
  assert.equal(isNativeDirectError({ ...error, ok: true }, "db.migrate", allowed), false);
});
