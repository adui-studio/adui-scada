import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { loadMigrationBaseline } from "../../scripts/inspect-prisma8-migration-readiness.mjs";
import {
  materializeNativeContract,
  reviewNativeContract,
} from "../../scripts/prisma8-native-contract-review.mjs";
import {
  requireDeclarationHashes,
  reviewRuntimeRelations,
} from "../../scripts/prisma8-native-runtime-review.mjs";
import {
  BaselineError,
  nativeHash,
  readBaselineInputs,
  requireBaselineApproval,
  resolveBaselineCli,
  reviewExistingBaseline,
  runBaselinePlanner,
} from "../../scripts/prisma8-native-baseline.mjs";
import {
  DdlReviewError,
  reviewAuditedBaseline,
} from "../../scripts/prisma8-native-baseline-ddl.mjs";
import { CommentEmissionError } from "../../scripts/prisma8-native-baseline-comments.mjs";
import {
  requireLockedCandidateEvidence,
  runCandidateReview,
  runCommentEmission,
} from "../../scripts/prisma8-native-baseline-comment-emission.mjs";
import {
  inspectNativeEmptyDatabase,
  nativeEmptyClientOptions,
  nativeEmptyConfirmation,
  nativeEmptyUrlVariable,
  NativePreflightError,
} from "../../scripts/prisma8-native-baseline-preflight.mjs";

function requireCondition(condition, message) {
  if (!condition) throw new BaselineError(message);
}

let stage = "确认离线授权";

async function main() {
  const args = process.argv.slice(2);
  const reviewDdl = args.length === 1 && args[0] === "--review-baseline-ddl";
  const reviewComments = args.length === 1 && args[0] === "--review-baseline-comments";
  const emitComments = args.length === 1 && args[0] === "--confirm-offline-comments";
  const preflight = args.length === 1 && args[0] === nativeEmptyConfirmation;
  const reviewCandidate = preflight || (args.length === 1 && args[0] === "--review-comment-candidate");
  const dbOptions = preflight
    ? nativeEmptyClientOptions(process.env[nativeEmptyUrlVariable], args)
    : undefined;
  const reviewExisting =
    reviewDdl ||
    reviewComments ||
    emitComments ||
    reviewCandidate ||
    (args.length === 1 && args[0] === "--review-existing-baseline");
  if (!reviewExisting) requireBaselineApproval(args);
  const root = realpathSync(resolve(import.meta.dirname, "../.."));
  stage = "隔离路径与固定依赖";
  const inputs = readBaselineInputs(root, reviewExisting);
  const entry = resolveBaselineCli(root);
  stage = "历史基线及保留候选物理与运行时核对";
  const baseline = loadMigrationBaseline();
  const [source, nativeText, nativeDeclaration] = inputs.native;
  const [formalText, formalDeclaration] = inputs.formal;
  const formal = JSON.parse(formalText);
  const native = JSON.parse(nativeText);
  const status = reviewRuntimeRelations(formal, native);
  requireDeclarationHashes(formalDeclaration, formal);
  requireDeclarationHashes(nativeDeclaration, native);
  const checks = [...baseline.constraints.values()]
    .filter((item) => item.kind === "c")
    .map((item) => {
      const check = native.storage.namespaces.public.entries.table[item.table]?.checks?.find(
        (candidate) => candidate.name === item.name,
      );
      const expression = check?.expression;
      requireCondition(
        typeof expression === "string" &&
          expression.trim().length > 0 &&
          !expression.includes("`") &&
          !expression.includes("${") &&
          !expression.includes(";") &&
          Array.from(expression).every(
            (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
          ),
        "保留候选 CHECK 表达式超出受控范围",
      );
      return { table: item.table, name: item.name, expression };
    });
  requireCondition(checks.length === 36, "保留候选必须覆盖三十六项历史 CHECK");
  const review = reviewNativeContract(formal, native, baseline, checks);
  requireCondition(
    review.status === status && review.signingAllowed === false,
    "保留候选评审状态变化",
  );
  const template = readFileSync(
    join(root, "apps", "server", "prisma", "native-contract.template.prisma"),
    "utf8",
  );
  requireCondition(
    materializeNativeContract(template, baseline, checks) === source,
    "保留原生 PSL 与候选物理 CHECK 不一致",
  );
  // 使用官方静态入口检查契约可装载性，不创建运行时客户端或连接数据库。
  stage = "官方静态契约装载";
  void contractFromJson(native);
  stage = "独立空起点规划与生成物检查";
  let result;
  let failure;
  try {
    result = reviewExisting
      ? reviewExistingBaseline(root, inputs)
      : runBaselinePlanner(root, inputs, entry);
  } catch (error) {
    failure = error instanceof Error ? error : new BaselineError("离线规划发生未知失败");
  }
  stage = "历史迁移与正式契约复核";
  const after = loadMigrationBaseline();
  requireCondition(
    isDeepStrictEqual(after.migrations, baseline.migrations) &&
      after.contractHash === baseline.contractHash,
    "历史迁移或正式契约标识发生变化",
  );
  stage = "独立空起点规划与生成物检查";
  if (failure) throw failure;
  requireCondition(result, "离线基线未产生评审结果");
  stage = "目标快照声明复核";
  requireDeclarationHashes(
    readFileSync(
      join(
        root,
        ".artifacts",
        "prisma8-native-baseline",
        "migrations",
        "snapshots",
        nativeHash,
        "contract.d.ts",
      ),
      "utf8",
    ),
    native,
  );
  console.info("离线基线目标存储哈希：" + result.contractHash);
  console.info("保留候选原文指纹：" + result.contractContentHash);
  console.info("官方迁移标识：" + result.migrationHash);
  console.info("计划操作数量：" + result.operations);
  console.info("基线状态：BASELINE_ARTIFACT_REVIEW_REQUIRED；签名许可：否；部署许可：否");
  console.info("物理 DDL、中文注释、操作及依赖解析仍须独立评审");
  if (reviewDdl || reviewComments || emitComments || reviewCandidate) {
    stage = "固定候选 DDL 与历史中文注释审查";
    const audited = reviewAuditedBaseline(root, baseline, nativeText);
    console.info("固定候选原件指纹：10 项匹配");
    console.info("实际 DDL 逐项全文对照：" + audited.operations + " 项");
    console.info("历史最终中文注释：" + audited.comments + " 项；原包注释：0 项");
    console.info("独立注释审查文本指纹：" + audited.previewHash);
    console.info("审查状态：DDL_TEXT_MATCHED_COMMENTS_BLOCKED；签名许可：否；部署许可：否");
    if (reviewComments) {
      console.info("以下仅为注释审查文本，不是可部署迁移包");
      process.stdout.write(audited.preview);
    }
    if (emitComments) {
      stage = "独立注释候选自发射与官方完整性检查";
      let emitted;
      try {
        emitted = runCommentEmission(root, entry, audited);
      } finally {
        reviewExistingBaseline(root, inputs);
        reviewAuditedBaseline(root, loadMigrationBaseline(), nativeText);
      }
      console.info("原始候选、历史迁移及正式契约复核通过");
      console.info("独立注释候选操作数量：" + emitted.operations);
      console.info("独立注释候选官方迁移标识：" + emitted.migrationHash);
      console.info("离线状态：COMMENTS_EMITTED_REVIEW_REQUIRED；签名许可：否；部署许可：否");
    }
    if (reviewCandidate) {
      stage = "已验收独立候选部署前离线复验";
      let candidate;
      let empty;
      try {
        candidate = runCandidateReview(root, entry, audited);
        if (dbOptions) {
          stage = "第三座专用空库只读预检";
          // 仅在固定候选复验成功之后解析数据库驱动并创建连接。
          const { Client } = createRequire(import.meta.url)("pg");
          empty = await inspectNativeEmptyDatabase(new Client(dbOptions), dbOptions.user);
        }
      } finally {
        reviewExistingBaseline(root, inputs);
        reviewAuditedBaseline(root, loadMigrationBaseline(), nativeText);
        if (dbOptions && candidate) requireLockedCandidateEvidence(root);
      }
      console.info("固定独立候选文件数量：" + candidate.evidence.files.length);
      console.info("完整迁移操作数量：" + candidate.operations);
      console.info("已验收官方迁移标识：" + candidate.migrationHash);
      console.info("重新官方干跑与完整性检查通过，所有原件及证据不变");
      console.info("独立候选证据指纹：" + candidate.evidence.fingerprint);
      console.info("离线状态：CANDIDATE_PREFLIGHT_REVIEW_REQUIRED；签名许可：否；部署许可：否");
      process.stdout.write(JSON.stringify(candidate.evidence, null, 2) + "\n");
      if (empty) {
        console.info("第三座专用库：" + empty.database);
        console.info("实际 PostgreSQL 版本号：" + empty.serverVersion);
        console.info("受检空库类别：" + empty.checkedEmptyCategories + " 项全部通过");
        console.info("只读事务已回滚并关闭连接，十四文件证据及原件保持不变");
        console.info("预检状态：NATIVE_EMPTY_PREFLIGHT_REVIEW_REQUIRED；签名许可：否；部署许可：否");
      }
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof BaselineError ||
      error instanceof DdlReviewError ||
      error instanceof CommentEmissionError ||
      error instanceof NativePreflightError
      ? error.message
      : "原生基线阶段失败：" + stage + "；保留证据供人工检查",
  );
  process.exitCode = 1;
}
