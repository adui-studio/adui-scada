import { isDeepStrictEqual } from "node:util";
import { nativeHash, offlineEnvironment } from "./prisma8-native-baseline.mjs";
import {
  nativeEmptyClientOptions,
  nativeEmptyConfirmation,
  nativeEmptyUrlVariable,
} from "./prisma8-native-baseline-preflight.mjs";

export const migrationPreviewConfirmation = "--review-adui-scada-fresh-prisma8-native-path";
export const migrationApplyConfirmation = "--confirm-adui-scada-fresh-prisma8-native-migrate";
const edge = {
  spaceId: "app",
  dirName: "20261125T0918_scada_native_baseline",
  migrationHash: "e6b95ed88834dce3f6448445a5ba12a00ba34c8e5c68f4335751659b15a77f17",
  from: "empty",
  to: nativeHash,
};

export class NativeMigrationError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new NativeMigrationError(message);
}

/** 只接受固定确认参数及第三座专用库连接，不向 CLI 参数传递密码。 */
export function migrationRequest(input, args, source) {
  requireMatch(
    isDeepStrictEqual(args, [migrationPreviewConfirmation]) ||
      isDeepStrictEqual(args, [migrationApplyConfirmation]),
    "必须明确确认第三座专用库迁移路径复核或独立迁移，且不得附加参数",
  );
  const options = nativeEmptyClientOptions(input, [nativeEmptyConfirmation]);
  const connection =
    "postgresql://" +
    encodeURIComponent(options.user) +
    ":" +
    encodeURIComponent(options.password) +
    "@127.0.0.1:15432/" +
    options.database;
  return {
    apply: args[0] === migrationApplyConfirmation,
    env: { ...offlineEnvironment(source), [nativeEmptyUrlVariable]: connection },
  };
}

/** 官方命令固定为单一目标，不允许更改引用、签名或覆盖保护政策。 */
export function migrationArguments(entry, config, action) {
  const common = ["--json", "--config", config];
  if (action === "校验") return [entry, "db", "verify", ...common];
  requireMatch(action === "预览" || action === "迁移", "独立迁移动作无效");
  return [
    entry,
    "db",
    "migrate",
    ...(action === "预览" ? ["--show"] : []),
    "--to",
    nativeHash,
    "--no-advance-ref",
    ...common,
  ];
}

/** 仅接受成功机器封装；迁移进度可以是逐行 JSON，但最终结果必须唯一。 */
export function requireMigrationResult(stdout, commandId) {
  let documents;
  try {
    try {
      documents = [JSON.parse(stdout)];
    } catch {
      documents = stdout
        .trim()
        .split(/\r?\n/u)
        .map((line) => JSON.parse(line));
    }
  } catch {
    throw new NativeMigrationError("官方迁移机器响应无法解析，保留现场");
  }
  const final = documents.at(-1);
  requireMatch(
    documents.filter((item) => item?.kind === "result").length === 1 &&
      final?.kind === "result" &&
      final.commandId === commandId &&
      final.envelope?.commandId === commandId &&
      final.envelope.ok === true &&
      final.envelope.exitCode === 0 &&
      isDeepStrictEqual(final.envelope.diagnostics, []),
    "官方迁移机器响应未确认成功，保留现场",
  );
  return final.envelope.result;
}

/** 首次迁移前必须有唯一已验收边，迁移后不得再有待执行边。 */
export function requireNativeMigrationPath(result, applied) {
  requireMatch(
    result?.ok === true && isDeepStrictEqual(result.migrations, applied ? [] : [edge]),
    "官方迁移路径与固定空起点基线不一致",
  );
}

/** 检查官方应用结果及目标标记；公共 schema 可能已有，执行数量不等于包操作数量。 */
export function requireNativeAppliedResult(result) {
  const item = result?.applied?.[0];
  requireMatch(
    result?.ok === true &&
      result.migrationsApplied === 1 &&
      result.migrationsTotal === 1 &&
      result.markerHash === nativeHash &&
      Array.isArray(result.applied) &&
      result.applied.length === 1 &&
      Object.entries(edge).every(([key, value]) => item?.[key] === value) &&
      Number.isSafeInteger(item.operationsExecuted) &&
      item.operationsExecuted > 0 &&
      item.operationsExecuted <= 165 &&
      (result.advancedRef === null || result.advancedRef === undefined),
    "官方应用结果、迁移标记或引用状态未确认，禁止自动重试",
  );
  return item.operationsExecuted;
}
