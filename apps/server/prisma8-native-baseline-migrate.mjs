import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { loadMigrationBaseline } from "../../scripts/inspect-prisma8-migration-readiness.mjs";
import {
  readBaselineInputs,
  requirePreservedInputs,
  resolveBaselineCli,
} from "../../scripts/prisma8-native-baseline.mjs";
import { readCandidateRegular } from "../../scripts/prisma8-native-baseline-candidate.mjs";
import { requireLockedCandidateEvidence } from "../../scripts/prisma8-native-baseline-comment-emission.mjs";
import {
  nativeEmptyConfirmation,
  nativeEmptyUrlVariable,
  NativePreflightError,
} from "../../scripts/prisma8-native-baseline-preflight.mjs";
import {
  migrationArguments,
  migrationRequest,
  NativeMigrationError,
  requireMigrationResult,
  requireNativeAppliedResult,
  requireNativeMigrationPath,
} from "../../scripts/prisma8-native-baseline-migrate.mjs";

let stage = "确认独立迁移授权";
let writeStarted = false;

function requireMatch(condition, message) {
  if (!condition) throw new NativeMigrationError(message);
}

function main() {
  const request = migrationRequest(
    process.env[nativeEmptyUrlVariable],
    process.argv.slice(2),
    process.env,
  );
  const root = realpathSync(resolve(import.meta.dirname, "../.."));
  stage = "固定依赖及证据检查";
  const entry = resolveBaselineCli(root);
  const config = join(root, "apps", "server", "prisma8-native-baseline-migrate.config.ts");
  const originalConfig = readCandidateRegular(config);
  const inputs = readBaselineInputs(root, true);
  const history = loadMigrationBaseline();
  const fingerprint = requireLockedCandidateEvidence(root);
  const requirePreserved = () => {
    requirePreservedInputs(root, inputs);
    const current = loadMigrationBaseline();
    requireMatch(
      isDeepStrictEqual(current.migrations, history.migrations) &&
        current.contractHash === history.contractHash &&
        requireLockedCandidateEvidence(root) === fingerprint &&
        readCandidateRegular(config).equals(originalConfig),
      "历史迁移、原件、独立候选或部署配置发生变化",
    );
  };
  const run = (args) => {
    requirePreserved();
    const child = spawnSync(process.execPath, args, {
      cwd: root,
      env: request.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
    requirePreserved();
    requireMatch(
      !child.error && child.status === 0,
      "独立迁移子进程未确认成功；原始诊断不回显",
    );
    return child.stdout;
  };
  const preflight = () => {
    stage = "重新执行固定候选及第三座空库只读预检";
    run([join(root, "apps", "server", "prisma8-native-baseline-plan.mjs"), nativeEmptyConfirmation]);
    console.info("第三座空库只读预检重新通过");
  };
  const preview = (applied) => {
    stage = applied ? "迁移后剩余路径检查" : "官方在线迁移路径预览";
    requireNativeMigrationPath(
      requireMigrationResult(run(migrationArguments(entry, config, "预览")), "db.migrate"),
      applied,
    );
  };

  preflight();
  preview(false);
  console.info("官方在线预览确认唯一固定空起点迁移边");
  console.info("独立候选证据指纹：" + fingerprint);
  if (!request.apply) {
    console.info("路径状态：NATIVE_MIGRATION_PATH_REVIEW_REQUIRED；未执行迁移");
    return;
  }

  // 预览完成后再次核对候选和空库，不以之前的预检替代写入前检查。
  preflight();
  stage = "官方独立基线迁移";
  writeStarted = true;
  const operations = requireNativeAppliedResult(
    requireMigrationResult(run(migrationArguments(entry, config, "迁移")), "db.migrate"),
  );
  console.info("官方报告已应用唯一基线，实际执行操作数量：" + operations);
  stage = "官方契约校验";
  requireMigrationResult(run(migrationArguments(entry, config, "校验")), "db.verify");
  preview(true);
  requirePreserved();
  console.info("官方契约校验及剩余路径检查通过，原件及十四文件证据不变");
  console.info("迁移状态：NATIVE_BASELINE_APPLIED_REVIEW_REQUIRED；正式接管许可：否");
}

try {
  main();
} catch (error) {
  const reason =
    error instanceof NativeMigrationError || error instanceof NativePreflightError
      ? "；" + error.message
      : "；内部诊断已脱敏";
  console.error("第三座独立迁移阶段失败：" + stage + reason);
  if (writeStarted) {
    console.error("已进入官方迁移调用，数据库可能已发生变化；禁止自动重试、重置或清理");
  }
  process.exitCode = 1;
}
