import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  fingerprintRepairPackage,
  repairHash,
} from "./prisma8-native-check-repair-package.mjs";

export const packageEvidenceFingerprint =
  "13360ad35e8a1742f7d6a8eea99162fc11f33aea4d45d2075390ce4d2bef9a86";
export const packageLockFingerprint =
  "bc6bf007eb514fd73e841aacd8d333ba4ac38a38933f1806fe56dba68ad440df";
export const packageLockPath = "scripts/prisma8-native-check-repair-package.lock.json";

export class PackageLockError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new PackageLockError(message);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    isDeepStrictEqual(
      Object.keys(value).sort(),
      [...expected].sort(),
    )
  );
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function expectedPaths(directory, contractHash) {
  const snapshot = "migrations/snapshots/" + contractHash;
  const plan = [
    "plan/contract.d.ts",
    "plan/contract.json",
    "plan/contract.prisma",
    "plan/plan.json",
    "plan/plan.stderr.txt",
    ...[
      "migration.json",
      "migration.ts",
      "ops.json",
    ].map((name) => "plan/" + directory + "/" + name),
    "plan/" + snapshot + "/contract.d.ts",
    "plan/" + snapshot + "/contract.json",
  ];
  const complete = [
    "complete/contract.d.ts",
    "complete/contract.json",
    "complete/contract.prisma",
    "complete/emit-dry-run.stderr.txt",
    "complete/emit-dry-run.stdout.txt",
    "complete/emit.stderr.txt",
    "complete/emit.stdout.txt",
    "complete/migration-check.stderr.txt",
    "complete/migration-check.stdout.txt",
    ...[
      "migration.json",
      "migration.ts",
      "ops.json",
    ].map((name) => "complete/" + directory + "/" + name),
    "complete/" + snapshot + "/contract.d.ts",
    "complete/" + snapshot + "/contract.json",
  ];
  return [...plan, ...complete].sort(compareNames);
}

/** 固定来源、官方版本、迁移边、操作数量及报告状态。 */
export function validatePackageLock(lock) {
  const keys = [
    "schemaVersion",
    "scope",
    "source",
    "contractHash",
    "originalFingerprint",
    "structuralOperations",
    "commentOperations",
    "operations",
    "structuralMigrationHash",
    "migrationHash",
    "migrationDirectory",
    "executionChecks",
    "flags",
    "evidence",
    "lockFingerprint",
  ];
  requireMatch(exactKeys(lock, keys), "迁移包锁文件顶层结构变化");
  requireMatch(
    lock.schemaVersion === 1 &&
      lock.scope === "PRISMA8_NATIVE_CHECK_REPAIR_PACKAGE_LOCK_V1",
    "迁移包锁文件版本或范围不匹配",
  );
  requireMatch(
    exactKeys(lock.source, [
      "pr",
      "generatorHead",
      "mergeCommit",
      "cliVersion",
      "providerVersion",
      "repairContractConfigSha256",
    ]) &&
      lock.source.pr === 232 &&
      lock.source.generatorHead === "31851343f513681db6eb063bcd4aee286f9fad96" &&
      lock.source.mergeCommit === "f39176464e1805a4443cd4360b70891fa0093cb2" &&
      lock.source.cliVersion === "8.0.0-rc.35" &&
      lock.source.providerVersion === "8.0.0-rc.25" &&
      lock.source.repairContractConfigSha256 ===
        "1ccda04b90a5f26e95a84c67ef8c1726689430955bd0ccecd6dc0baa7e2b250f",
    "迁移包锁文件来源、固定版本或修复配置指纹不匹配",
  );
  requireMatch(
    lock.contractHash === repairHash &&
      lock.originalFingerprint ===
        "02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e" &&
      lock.structuralOperations === 46 &&
      lock.commentOperations === 119 &&
      lock.operations === 165 &&
      lock.structuralMigrationHash ===
        "fce9c3dfdc0b5300cc1d128b07a6be03f618f89df7dd8d43ed2712881aee93c8" &&
      lock.migrationHash ===
        "5cc4b025c41e1b5479cf29a86d6252806ff5bd517ef5c24b80fa6b89cf3c182e" &&
      lock.migrationDirectory ===
        "migrations/app/20261126T0620_scada_native_check_repair",
    "迁移包锁文件的固定契约、操作数量或迁移标识变化",
  );
  requireMatch(
    exactKeys(lock.executionChecks, [
      "missingPrecheck",
      "missingPostcheck",
      "identicalChecks",
    ]) &&
      isDeepStrictEqual(lock.executionChecks, {
        missingPrecheck: ["schema.public"],
        missingPostcheck: ["schema.public"],
        identicalChecks: [],
      }),
    "迁移包前后置检查覆盖与已验收报告不一致",
  );
  requireMatch(
    exactKeys(lock.flags, [
      "roundTripVerified",
      "migrationPackageGenerated",
      "signingAllowed",
      "deploymentAllowed",
    ]) &&
      isDeepStrictEqual(lock.flags, {
        roundTripVerified: false,
        migrationPackageGenerated: true,
        signingAllowed: false,
        deploymentAllowed: false,
      }),
    "迁移包锁文件的往返、签名或部署状态不安全",
  );
  requireMatch(
    exactKeys(lock.evidence, [
      "scope",
      "contractHash",
      "migrationHash",
      "configs",
      "files",
      "fingerprint",
    ]) &&
      lock.evidence.scope === "PRISMA8_NATIVE_CHECK_REPAIR_PACKAGE_V1" &&
      lock.evidence.contractHash === lock.contractHash &&
      lock.evidence.migrationHash === lock.migrationHash,
    "迁移包锁文件证据范围或目标不匹配",
  );
  const configPaths = [
    "prisma8-native-check-repair-complete.config.ts",
    "prisma8-native-check-repair-plan.config.ts",
  ];
  requireMatch(
    Array.isArray(lock.evidence.configs) &&
      lock.evidence.configs.length === 2 &&
      isDeepStrictEqual(
        lock.evidence.configs.map((entry) => entry.path),
        configPaths,
      ) &&
      lock.evidence.configs.every(
        (entry) =>
          exactKeys(entry, ["path", "bytes", "sha256"]) &&
          Number.isSafeInteger(entry.bytes) &&
          entry.bytes > 0 &&
          /^[a-f0-9]{64}$/u.test(entry.sha256),
      ),
    "迁移包锁文件的配置证据清单无效",
  );
  const paths = expectedPaths(lock.migrationDirectory, lock.contractHash);
  requireMatch(
    Array.isArray(lock.evidence.files) &&
      lock.evidence.files.length === 24 &&
      isDeepStrictEqual(
        lock.evidence.files.map((entry) => entry.path),
        paths,
      ) &&
      lock.evidence.files.every(
        (entry) =>
          exactKeys(entry, ["path", "bytes", "sha256"]) &&
          Number.isSafeInteger(entry.bytes) &&
          entry.bytes >= 0 &&
          /^[a-f0-9]{64}$/u.test(entry.sha256),
      ),
    "迁移包锁文件的二十四项证据路径、顺序或指纹无效",
  );
  const { fingerprint, ...evidencePayload } = lock.evidence;
  requireMatch(
    fingerprint === packageEvidenceFingerprint &&
      digest(JSON.stringify(evidencePayload)) === fingerprint,
    "迁移包证据清单自身指纹不一致",
  );
  const { lockFingerprint, ...lockPayload } = lock;
  requireMatch(
    lockFingerprint === packageLockFingerprint &&
      digest(JSON.stringify(lockPayload)) === lockFingerprint,
    "迁移包锁文件自身指纹不一致",
  );
  return lock;
}

/** 对照真实目录重新计算的二十四文件及两份配置证据。 */
export function reviewLockedPackageEvidence(lock, files, configs) {
  validatePackageLock(lock);
  const actual = fingerprintRepairPackage(files, configs, lock.migrationHash);
  requireMatch(
    isDeepStrictEqual(actual, lock.evidence),
    "真实迁移包或配置与已提交证据锁不一致",
  );
  return actual;
}

/** 固定只读复验命令；不包含规划、发射、自发射、迁移或数据库命令。 */
export function buildReadOnlyVerificationCommands(entry, migrationFile, config) {
  requireMatch(
    [entry, migrationFile, config].every(
      (value) => typeof value === "string" && value.length > 0,
    ),
    "只读复验命令路径无效",
  );
  return {
    dryRun: [migrationFile, "--config", config, "--dry-run"],
    migrationCheck: [
      entry,
      "migration",
      "check",
      "--space",
      "app",
      "--json",
      "--config",
      config,
    ],
  };
}
