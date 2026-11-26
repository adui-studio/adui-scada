import assert from "node:assert/strict";
import lock from "./prisma8-native-check-repair-package.lock.json" with { type: "json" };
import { test } from "node:test";
import {
  buildReadOnlyVerificationCommands,
  packageEvidenceFingerprint,
  packageLockFingerprint,
  reviewLockedPackageEvidence,
  validatePackageLock,
} from "./prisma8-native-check-repair-package-lock.mjs";
import { offlineEnvironment } from "./prisma8-native-baseline.mjs";
import { fingerprintRepairPackage } from "./prisma8-native-check-repair-package.mjs";

function clone(value) {
  return structuredClone(value);
}

void test("已提交锁文件固定来源、版本、迁移边及二十四项证据", () => {
  const result = validatePackageLock(lock);
  assert.equal(result.evidence.fingerprint, packageEvidenceFingerprint);
  assert.equal(result.lockFingerprint, packageLockFingerprint);
  assert.equal(result.evidence.files.length, 24);
  assert.equal(result.evidence.configs.length, 2);
  assert.equal(result.structuralOperations, 46);
  assert.equal(result.commentOperations, 119);
  assert.equal(result.operations, 165);
  assert.equal(result.flags.roundTripVerified, false);
  assert.equal(result.flags.signingAllowed, false);
  assert.equal(result.flags.deploymentAllowed, false);
});

void test("锁文件拒绝来源、固定版本、契约、迁移哈希和计数变化", () => {
  const mutations = [
    (value) => { value.source.pr = 233; },
    (value) => { value.source.cliVersion = "8.0.0"; },
    (value) => { value.source.providerVersion = "8.0.0"; },
    (value) => { value.contractHash = "a".repeat(64); },
    (value) => { value.originalFingerprint = "b".repeat(64); },
    (value) => { value.structuralOperations = 45; },
    (value) => { value.commentOperations = 118; },
    (value) => { value.operations = 164; },
    (value) => { value.structuralMigrationHash = "c".repeat(64); },
    (value) => { value.migrationHash = "d".repeat(64); },
    (value) => { value.migrationDirectory += "-other"; },
  ];
  for (const mutate of mutations) {
    const value = clone(lock);
    mutate(value);
    assert.throws(() => validatePackageLock(value), /锁文件|证据清单/u);
  }
});

void test("锁文件拒绝执行检查漂移及任何签名或部署放行", () => {
  for (const mutate of [
    (value) => { value.executionChecks.missingPrecheck = []; },
    (value) => { value.executionChecks.missingPostcheck = []; },
    (value) => { value.executionChecks.identicalChecks = ["table.users"]; },
    (value) => { value.flags.roundTripVerified = true; },
    (value) => { value.flags.signingAllowed = true; },
    (value) => { value.flags.deploymentAllowed = true; },
  ]) {
    const value = clone(lock);
    mutate(value);
    assert.throws(() => validatePackageLock(value), /检查覆盖|状态|指纹/u);
  }
});

void test("锁文件拒绝缺失、额外、重复、越界或重排的文件清单", () => {
  for (const mutate of [
    (value) => { value.evidence.files.pop(); },
    (value) => { value.evidence.files.push({ ...value.evidence.files[0] }); },
    (value) => { value.evidence.files[0].path = "../secret"; },
    (value) => { value.evidence.files[0].sha256 = "不合法"; },
    (value) => { value.evidence.files[0].bytes = -1; },
    (value) => { value.evidence.files.reverse(); },
    (value) => { value.evidence.configs.pop(); },
    (value) => { value.evidence.configs[0].path = "other.config.ts"; },
  ]) {
    const value = clone(lock);
    mutate(value);
    assert.throws(() => validatePackageLock(value), /证据清单|指纹/u);
  }
});

void test("证据内容与锁文件或两份配置不一致时拒绝", () => {
  assert.throws(
    () => reviewLockedPackageEvidence(lock, {}, {}),
    /真实迁移包或配置/u,
  );
  const value = clone(lock);
  value.evidence.files[0].bytes += 1;
  assert.throws(() => validatePackageLock(value), /指纹/u);
});

void test("通用证据指纹按相对路径排序且覆盖文件和配置原文", () => {
  const first = Buffer.from("first");
  const second = Buffer.from("second");
  const config = Buffer.from("config");
  const one = fingerprintRepairPackage(
    { "b.txt": second, "a.txt": first },
    { "plan.config.ts": config },
    "a".repeat(64),
  );
  const two = fingerprintRepairPackage(
    { "a.txt": first, "b.txt": second },
    { "plan.config.ts": config },
    "a".repeat(64),
  );
  assert.deepEqual(one, two);
  assert.notEqual(
    one.fingerprint,
    fingerprintRepairPackage(
      { "a.txt": Buffer.from("changed"), "b.txt": second },
      { "plan.config.ts": config },
      "a".repeat(64),
    ).fingerprint,
  );
  assert.notEqual(
    one.fingerprint,
    fingerprintRepairPackage(
      { "a.txt": first, "b.txt": second },
      { "plan.config.ts": Buffer.from("changed") },
      "a".repeat(64),
    ).fingerprint,
  );
});

void test("复验命令仅包含官方 dry-run 和 migration check", () => {
  const commands = buildReadOnlyVerificationCommands(
    "/repo/node_modules/prisma/bin.js",
    "/repo/migration.ts",
    "/repo/complete.config.ts",
  );
  assert.deepEqual(commands, {
    dryRun: [
      "/repo/migration.ts",
      "--config",
      "/repo/complete.config.ts",
      "--dry-run",
    ],
    migrationCheck: [
      "/repo/node_modules/prisma/bin.js",
      "migration",
      "check",
      "--space",
      "app",
      "--json",
      "--config",
      "/repo/complete.config.ts",
    ],
  });
  assert.equal(
    JSON.stringify(commands).includes("db migrate"),
    false,
  );
});

void test("只读复验入口不包含文件写入或数据库迁移命令", () => {
  const source = readFileSync(
    join(import.meta.dirname, "../apps/server/prisma8-native-check-repair-package-review.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /\\b(?:writeFileSync|mkdirSync|rmSync|unlinkSync|renameSync|truncateSync)\\b/u);
  assert.doesNotMatch(source, /["'](?:db migrate|db sign|db update|migration plan|contract emit)["']/u);
  assert.match(source, /--dry-run/u);
  const helper = readFileSync(
    join(import.meta.dirname, "prisma8-native-check-repair-package-lock.mjs"),
    "utf8",
  );
  assert.match(helper, /"migration",\\s*"check"/u);
});

void test("离线子进程环境不继承数据库地址、令牌或 Node 注入配置", () => {
  const env = offlineEnvironment({
    PATH: "C:/node",
    HOME: "C:/Users/test",
    DATABASE_URL: "postgresql://secret",
    SCADA_DATABASE_URL: "postgresql://secret",
    SCADA_PRISMA8_NATIVE_REPRO_PASSWORD: "secret",
    NODE_OPTIONS: "--require=inject.js",
    GITHUB_TOKEN: "secret",
  });
  assert.deepEqual(env, {
    PATH: "C:/node",
    HOME: "C:/Users/test",
    CI: "true",
    NO_COLOR: "1",
  });
});
