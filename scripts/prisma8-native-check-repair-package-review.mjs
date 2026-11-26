import { createHash } from "node:crypto";

export const acceptedRepairFingerprint =
  "13360ad35e8a1742f7d6a8eea99162fc11f33aea4d45d2075390ce4d2bef9a86";
export const acceptedRepairMigrationHash =
  "5cc4b025c41e1b5479cf29a86d6252806ff5bd517ef5c24b80fa6b89cf3c182e";
export const acceptedRepairStructuralHash =
  "fce9c3dfdc0b5300cc1d128b07a6be03f618f89df7dd8d43ed2712881aee93c8";
export const acceptedRepairMigrationDirectory =
  "migrations/app/20261126T0620_scada_native_check_repair";

export class RepairPackageReviewError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new RepairPackageReviewError(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 固定真实验收清单，先验证清单再使用其中的任何相对路径。 */
export function requireAcceptedRepairEvidence(evidence) {
  requireMatch(evidence && typeof evidence === "object", "修复包固定证据清单无效");
  const { fingerprint, ...payload } = evidence;
  requireMatch(
    fingerprint === acceptedRepairFingerprint &&
      sha256(JSON.stringify(payload)) === acceptedRepairFingerprint &&
      evidence.scope === "PRISMA8_NATIVE_CHECK_REPAIR_PACKAGE_V1" &&
      evidence.migrationHash === acceptedRepairMigrationHash &&
      Array.isArray(evidence.files) &&
      evidence.files.length === 24 &&
      Array.isArray(evidence.configs) &&
      evidence.configs.length === 2,
    "修复包固定证据清单与真实验收指纹不一致",
  );
  return fingerprint;
}

/** 核对文件集合及实际原始字节，不接受仅由候选声明的哈希。 */
export function requireRepairFileEvidence(entries, files) {
  requireMatch(
    Array.isArray(entries) &&
      files &&
      Object.keys(files).length === entries.length &&
      new Set(entries.map((entry) => entry.path)).size === entries.length,
    "修复包实际文件集合与证据清单不一致",
  );
  for (const entry of entries) {
    const bytes = Object.hasOwn(files, entry.path) ? files[entry.path] : undefined;
    requireMatch(
      Buffer.isBuffer(bytes) && bytes.length === entry.bytes && sha256(bytes) === entry.sha256,
      "修复包实际文件字节或 SHA-256 不一致",
    );
  }
}

/** 在成功或失败后均复核原件；不在 finally 中覆盖原始阶段异常。 */
export function runPreservedRepairReview(preserve, action, stage) {
  preserve();
  let result;
  let failed = false;
  try {
    result = action();
  } catch {
    failed = true;
  }
  let changed = false;
  try {
    preserve();
  } catch {
    changed = true;
  }
  requireMatch(
    !failed && !changed,
    "修复包离线复验失败：" +
      stage +
      (failed ? "；阶段未通过" : "") +
      (changed ? "；原件或固定证据复核失败" : "") +
      "；禁止继续操作",
  );
  return result;
}

/** 仅接受官方成功退出且标准错误为空，不回显任意子进程诊断。 */
export function requireRepairReviewProcess(result) {
  requireMatch(
    result && !result.error && result.status === 0 && result.signal == null &&
      result.stderr === "" && typeof result.stdout === "string" && result.stdout.length > 0,
    "官方修复包离线子进程未确认成功",
  );
  return result.stdout;
}

/** 复验命令封闭为官方干跑与完整性检查，不接收任意附加参数。 */
export function runRepairOfficialRechecks({
  preserve, execute, verifyDryRun, verifyMigrationCheck, migrationPath, configPath, cliPath,
}) {
  runPreservedRepairReview(preserve, () => {
    verifyDryRun(execute([migrationPath, "--config", configPath, "--dry-run"]));
  }, "官方干跑");
  runPreservedRepairReview(preserve, () => {
    verifyMigrationCheck(execute([cliPath, "migration", "check", "--space", "app", "--json", "--config", configPath]));
  }, "官方迁移完整性");
}
