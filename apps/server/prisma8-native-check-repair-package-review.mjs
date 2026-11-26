import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { inspectOfflinePackage, offlineEnvironment } from "../../scripts/prisma8-native-baseline.mjs";
import { reviewStatements } from "../../scripts/prisma8-native-baseline-ddl.mjs";
import {
  readCandidateRegular,
  readExactCandidateTree,
  requireMigrationCheck,
} from "../../scripts/prisma8-native-baseline-candidate.mjs";
import {
  appendCommentOperations,
  buildCommentOperations,
  parseDryRun,
  reviewCommentEmission,
} from "../../scripts/prisma8-native-baseline-comments.mjs";
import { reviewExecutionChecks } from "../../scripts/prisma8-native-baseline-execution-review.mjs";
import { requireDeclarationHashes } from "../../scripts/prisma8-native-runtime-review.mjs";
import {
  fingerprintRepairPackage,
  repairHash,
  repairInputHashes,
  reviewRepairStructure,
} from "../../scripts/prisma8-native-check-repair-package.mjs";
import {
  acceptedRepairMigrationDirectory,
  acceptedRepairMigrationHash,
  acceptedRepairStructuralHash,
  requireAcceptedRepairEvidence,
  requireRepairFileEvidence,
  requireRepairReviewProcess,
  RepairPackageReviewError,
  runPreservedRepairReview,
} from "../../scripts/prisma8-native-check-repair-package-review.mjs";

function requireMatch(condition, message) {
  if (!condition) throw new RepairPackageReviewError(message);
}

function parse(files, name) {
  return JSON.parse(files[name].toString("utf8"));
}

/** 只读复验固定候选，不写日志、不规划、不执行实际自发射或数据库命令。 */
export function reviewExistingRepairPackage({
  root, server, output, entry, configs, oldContract, contract, oldOps, audited, repairFiles, preserve,
}) {
  const lockPath = join(root, "scripts", "prisma8-native-check-repair-package-accepted-evidence.json");
  const lockBytes = readCandidateRegular(lockPath);
  const evidence = JSON.parse(lockBytes.toString("utf8"));
  const fingerprint = requireAcceptedRepairEvidence(evidence);
  const names = evidence.files.map((item) => item.path);
  const readLockedFiles = () => {
    requireMatch(readCandidateRegular(lockPath).equals(lockBytes), "固定修复包证据清单原文变化");
    const files = readExactCandidateTree(output, names);
    const currentConfigs = Object.fromEntries(
      Object.keys(configs).map((name) => [name, readCandidateRegular(join(server, name))]),
    );
    requireRepairFileEvidence(evidence.files, files);
    requireRepairFileEvidence(evidence.configs, currentConfigs);
    requireMatch(
      isDeepStrictEqual(fingerprintRepairPackage(files, currentConfigs, acceptedRepairMigrationHash), evidence),
      "固定修复包证据完整指纹不一致",
    );
    return files;
  };
  const preserveAll = () => {
    preserve();
    readLockedFiles();
  };
  preserveAll();
  const files = readLockedFiles();
  const planDir = join(output, "plan");
  const completeDir = join(output, "complete");
  const manifestName = acceptedRepairMigrationDirectory + "/migration.json";
  const sourceName = acceptedRepairMigrationDirectory + "/migration.ts";
  const opsName = acceptedRepairMigrationDirectory + "/ops.json";
  const snapshotDir = "migrations/snapshots/" + repairHash;
  const split = (prefix) => Object.fromEntries(
    Object.entries(files).filter(([path]) => path.startsWith(prefix)).map(([path, bytes]) => [path.slice(prefix.length), bytes]),
  );
  const planFiles = split("plan/");
  const completeFiles = split("complete/");
  const original = { manifest: parse(planFiles, manifestName), operations: parse(planFiles, opsName) };
  const actual = { manifest: parse(completeFiles, manifestName), operations: parse(completeFiles, opsName) };
  const changed = runPreservedRepairReview(preserveAll, () => {
    const structural = inspectOfflinePackage(
      root, planDir, repairFiles["contract.json"].toString("utf8"), repairHash,
      /^20261126T0620_scada_native_check_repair$/u,
    );
    requireMatch(
      structural.operations === 46 && structural.migrationHash === acceptedRepairStructuralHash &&
        reviewStatements(contract.storage.namespaces.public.entries.table, original.operations) === 46,
      "固定结构迁移标识或四十六项结构操作不一致",
    );
    for (const name of Object.keys(repairInputHashes)) {
      requireMatch(planFiles[name].equals(repairFiles[name]) && completeFiles[name].equals(repairFiles[name]), "修复契约原文不一致");
    }
    for (const name of [snapshotDir + "/contract.json", snapshotDir + "/contract.d.ts"]) {
      requireMatch(planFiles[name].equals(completeFiles[name]), "结构原包与完整候选快照不一致");
    }
    requireDeclarationHashes(planFiles[snapshotDir + "/contract.d.ts"].toString("utf8"), contract);
    const changes = reviewRepairStructure(oldContract, contract, oldOps, original.operations);
    const comments = buildCommentOperations(audited.preview);
    requireMatch(comments.length === 119 && audited.comments === 119, "历史中文注释数量变化");
    const authoring = appendCommentOperations(planFiles[sourceName].toString("utf8"), comments);
    requireMatch(completeFiles[sourceName].equals(Buffer.from(authoring)), "完整候选源码与历史注释构造不一致");
    const review = reviewCommentEmission(original, actual, comments);
    requireMatch(review.operations === 165 && review.migrationHash === acceptedRepairMigrationHash, "完整操作或官方迁移标识变化");
    requireMatch(isDeepStrictEqual(parseDryRun(completeFiles["emit-dry-run.stdout.txt"].toString("utf8")), actual), "保存的官方干跑与完整候选不一致");
    requireMigrationCheck(completeFiles["migration-check.stdout.txt"].toString("utf8"));
    const checks = reviewExecutionChecks(actual.operations);
    requireMatch(
      isDeepStrictEqual(checks.missingPrecheck, ["schema.public"]) &&
        isDeepStrictEqual(checks.missingPostcheck, ["schema.public"]) && checks.identicalChecks.length === 0,
      "完整迁移前后置检查覆盖变化",
    );
    return changes;
  }, "固定迁移语义");
  const config = join(server, "prisma8-native-check-repair-complete.config.ts");
  const run = (args) => requireRepairReviewProcess(spawnSync(process.execPath, args, {
    cwd: root,
    env: offlineEnvironment(process.env),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  }));
  runPreservedRepairReview(preserveAll, () => {
    const dryRun = parseDryRun(run([join(completeDir, sourceName), "--config", config, "--dry-run"]));
    requireMatch(isDeepStrictEqual(dryRun, actual), "重新官方干跑与固定完整候选不一致");
  }, "官方干跑");
  runPreservedRepairReview(preserveAll, () => {
    requireMigrationCheck(run([entry, "migration", "check", "--space", "app", "--json", "--config", config]));
  }, "官方迁移完整性");
  return {
    status: "NATIVE_CHECK_REPAIR_PACKAGE_LOCKED_REVIEW_REQUIRED",
    contractHash: repairHash,
    structuralMigrationHash: acceptedRepairStructuralHash,
    migrationHash: acceptedRepairMigrationHash,
    migrationDirectory: acceptedRepairMigrationDirectory,
    structuralOperations: 46,
    changedStructuralOperations: changed,
    commentOperations: 119,
    operations: 165,
    missingPrecheck: ["schema.public"],
    missingPostcheck: ["schema.public"],
    identicalChecks: [],
    evidenceFingerprint: fingerprint,
    evidenceFiles: names.length,
    evidenceConfigs: evidence.configs.length,
    offlineReviewPassed: true,
    evidencePreserved: true,
    regenerated: false,
    roundTripVerified: false,
    signingAllowed: false,
    deploymentAllowed: false,
  };
}
