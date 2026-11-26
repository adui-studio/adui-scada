import { lstatSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const nativeRetryConfirmation = "--confirm-adui-scada-fresh-prisma8-native-retry-once";
const acceptedFingerprint = "02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e";
const receiptName = "prisma8-native-baseline-retry-20261126.json";

export class NativeRetryError extends Error {}

export function isNativeRetryRequest(args) {
  return isDeepStrictEqual(args, [nativeRetryConfirmation]);
}

/** 恢复后仅准许一次人工确认的官方执行；记录不属于迁移候选，失败也不得删除。 */
export function claimNativeRetry(root, fingerprint) {
  if (fingerprint !== acceptedFingerprint) {
    throw new NativeRetryError("恢复尝试的固定候选指纹不符");
  }
  const parent = join(root, "apps", "server", ".artifacts");
  try {
    if (!lstatSync(parent).isDirectory() || realpathSync(parent) !== parent) {
      throw new NativeRetryError("恢复尝试记录目录不安全");
    }
    writeFileSync(
      join(parent, receiptName),
      JSON.stringify({ scope: "PRISMA8_NATIVE_BASELINE_RETRY_V1", fingerprint }) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if (error instanceof NativeRetryError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new NativeRetryError("本次恢复尝试记录已存在，禁止再次执行官方迁移");
    }
    throw new NativeRetryError("无法安全保存恢复尝试记录，未授权官方迁移");
  }
}

/** 固定官方文档的直接错误封装；仅限已知命令和白名单错误，绝不转发正文。 */
export function isNativeDirectError(document, commandId, allowedCodes) {
  return (
    (commandId === "db.migrate" || commandId === "db.verify") &&
    document?.ok === false &&
    document.severity === "error" &&
    (document.commandId === undefined || document.commandId === commandId) &&
    allowedCodes.has(document.code)
  );
}
