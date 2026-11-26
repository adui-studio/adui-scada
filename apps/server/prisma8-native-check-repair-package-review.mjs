import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { loadMigrationBaseline } from "../../scripts/inspect-prisma8-migration-readiness.mjs";
import {
  BaselineError,
  inspectOfflinePackage,
  offlineEnvironment,
  readBaselineInputs,
  requirePreservedInputs,
  resolveBaselineCli,
} from "../../scripts/prisma8-native-baseline.mjs";
import {
  packageDirectory,
  readAuditedFiles,
  reviewAuditedBaseline,
  reviewStatements,
} from "../../scripts/prisma8-native-baseline-ddl.mjs";
import {
  candidateFileNames,
  fingerprintCandidateFiles,
  readCandidateRegular,
  readExactCandidateTree,
  requireMigrationCheck,
} from "../../scripts/prisma8-native-baseline-candidate.mjs";
import { requireLockedCandidateEvidence } from "../../scripts/prisma8-native-baseline-comment-emission.mjs";
import { requireAcceptedCandidateEvidence } from "../../scripts/prisma8-native-baseline-preflight.mjs";
import {
  appendCommentOperations,
  buildCommentOperations,
  parseDryRun,
  reviewCommentEmission,
} from "../../scripts/prisma8-native-baseline-comments.mjs";
import { reviewExecutionChecks } from "../../scripts/prisma8-native-baseline-execution-review.mjs";
import { requireDeclarationHashes } from "../../scripts/prisma8-native-runtime-review.mjs";
import {
  buildCheckRepairSource,
  reviewCheckRepairContract,
} from "../../scripts/prisma8-native-check-repair.mjs";
import {
  repairDirectory,
  repairHash,
  repairInputHashes,
  requireRepairInputs,
  reviewRepairStructure,
} from "../../scripts/prisma8-native-check-repair-package.mjs";
import {
  buildReadOnlyVerificationCommands,
  packageLockPath,
  PackageLockError,
  reviewLockedPackageEvidence,
  validatePackageLock,
} from "../../scripts/prisma8-native-check-repair-package-lock.mjs";

const confirmation = "--verify-offline-check-repair-package";
const originalFingerprint = "02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e";
let stage = "只读复验授权";

function requireMatch(condition, message) {
  if (!condition) throw new PackageLockError(message);
}

function parse(files, name) {
  return JSON.parse(files[name].toString("utf8"));
}

function sameFiles(left, right) {
  const names = Object.keys(left);
  return (
    names.length === Object.keys(right).length &&
    names.every((name) => Buffer.isBuffer(right[name]) && left[name].equals(right[name]))
  );
}

function checkSummary(text) {
  const result = JSON.parse(text);
  return {
    kind: result.kind,
    commandId: result.commandId,
    envelope: {
      commandId: result.envelope?.commandId,
      ok: result.envelope?.ok,
      exitCode: result.envelope?.exitCode,
      diagnostics: result.envelope?.diagnostics,
      result: {
        ok: result.envelope?.result?.ok,
        failures: result.envelope?.result?.failures,
      },
    },
  };
}

function runReadOnly(root, args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  requireMatch(
    !result.error && result.status === 0 && result.signal === null && result.stderr === "",
    "固定 Prisma 8 只读复验命令失败；内部诊断不回显",
  );
  return result.stdout;
}

function main() {
  requireMatch(
    process.argv.length === 3 && process.argv[2] === confirmation,
    "必须明确确认仅复验已锁定的离线迁移包，不接受其他参数",
  );
  stage = "锁文件、固定工具版本及二十四项证据";
  const root = realpathSync(resolve(import.meta.dirname, "../.."));
  const server = join(root, "apps", "server");
  const parent = join(server, ".artifacts");
  const output = join(parent, repairDirectory);
  requireMatch(
    lstatSync(parent, { throwIfNoEntry: false })?.isDirectory() &&
      realpathSync(parent) === parent,
    "独立迁移包父目录不存在或包含链接",
  );
  const lockPath = join(root, packageLockPath);
  const lockBytes = readCandidateRegular(lockPath);
  const lock = validatePackageLock(JSON.parse(lockBytes.toString("utf8")));
  const fileNames = lock.evidence.files.map(({ path }) => path);
  const files = readExactCandidateTree(output, fileNames);
  const configs = Object.fromEntries(
    lock.evidence.configs.map(({ path }) => [
      path,
      readCandidateRegular(join(server, path)),
    ]),
  );
  const evidence = reviewLockedPackageEvidence(lock, files, configs);
  const entry = resolveBaselineCli(root);
  const repairConfig = readCandidateRegular(
    join(server, "prisma8-native-check-repair.config.ts"),
  );
  requireMatch(
    createHash("sha256").update(repairConfig).digest("hex") ===
      lock.source.repairContractConfigSha256,
    "原始修复契约配置指纹变化",
  );

  stage = "原包、历史迁移、第四座副本及修复契约复核";
  const inputs = readBaselineInputs(root, true);
  const oldDir = join(root, ".artifacts", "prisma8-native-baseline");
  const oldFiles = readAuditedFiles(oldDir);
  const oldContractText = oldFiles["contract.json"].toString("utf8");
  const oldContract = JSON.parse(oldContractText);
  const baseline = loadMigrationBaseline();
  const audited = reviewAuditedBaseline(root, baseline, oldContractText);
  const oldOps = JSON.parse(
    oldFiles[packageDirectory + "/ops.json"].toString("utf8"),
  );
  const repairDir = join(root, ".artifacts", "prisma8-native-check-repair");
  const repairNames = [
    ...Object.keys(repairInputHashes),
    "emit.stdout.txt",
    "emit.stderr.txt",
  ];
  const repairFiles = readExactCandidateTree(repairDir, repairNames);
  const contract = requireRepairInputs(repairFiles);
  reviewCheckRepairContract(oldContract, contract);
  requireMatch(
    buildCheckRepairSource(oldFiles["contract.prisma"].toString("utf8"), oldContract) ===
      repairFiles["contract.prisma"].toString("utf8"),
    "已验收修复契约源码与真实证据不一致",
  );
  requireDeclarationHashes(repairFiles["contract.d.ts"].toString("utf8"), contract);
  void contractFromJson(contract);

  const fourth = join(parent, "prisma8-native-repro-candidate");
  const fourthNames = candidateFileNames(oldFiles);
  const previousConfig = readCandidateRegular(
    join(server, "prisma8-native-baseline-comments.config.ts"),
  );
  const fourthFiles = readExactCandidateTree(fourth, fourthNames);
  const fourthFingerprint = requireAcceptedCandidateEvidence(
    fingerprintCandidateFiles(fourthFiles, previousConfig),
  );
  requireMatch(
    fourthFingerprint === originalFingerprint &&
      requireLockedCandidateEvidence(root) === originalFingerprint,
    "第四座保留副本或原注释候选指纹变化",
  );

  const preserve = () => {
    requireMatch(readCandidateRegular(lockPath).equals(lockBytes), "已提交迁移包锁文件发生变化");
    requirePreservedInputs(root, inputs);
    const current = reviewAuditedBaseline(
      root,
      loadMigrationBaseline(),
      oldContractText,
    );
    requireMatch(
      isDeepStrictEqual(current, audited) &&
        requireLockedCandidateEvidence(root) === originalFingerprint,
      "原始迁移、历史注释或固定候选发生变化",
    );
    requireMatch(
      requireAcceptedCandidateEvidence(
        fingerprintCandidateFiles(
          readExactCandidateTree(fourth, fourthNames),
          readCandidateRegular(join(server, "prisma8-native-baseline-comments.config.ts")),
        ),
      ) === originalFingerprint,
      "第四座保留副本发生变化",
    );
    requireMatch(
      sameFiles(readExactCandidateTree(repairDir, repairNames), repairFiles),
      "已验收修复契约或诊断发生变化",
    );
    requireMatch(
      sameFiles(
        Object.fromEntries(
          lock.evidence.configs.map(({ path }) => [
            path,
            readCandidateRegular(join(server, path)),
          ]),
        ),
        configs,
      ) &&
        readCandidateRegular(join(server, "prisma8-native-check-repair.config.ts")).equals(
          repairConfig,
        ),
      "离线配置原文发生变化",
    );
    const currentPackage = readExactCandidateTree(output, fileNames);
    requireMatch(sameFiles(currentPackage, files), "已锁定的二十四项迁移证据发生变化");
    requireMatch(
      isDeepStrictEqual(
        reviewLockedPackageEvidence(lock, currentPackage, configs),
        evidence,
      ),
      "迁移包证据指纹复验不一致",
    );
  };
  preserve();

  stage = "结构原包与完整迁移包静态复核";
  const planDir = join(output, "plan");
  const completeDir = join(output, "complete");
  const planNames = fileNames
    .filter((name) => name.startsWith("plan/"))
    .map((name) => name.slice("plan/".length));
  const completeNames = fileNames
    .filter((name) => name.startsWith("complete/"))
    .map((name) => name.slice("complete/".length));
  const planFiles = readExactCandidateTree(planDir, planNames);
  const completeFiles = readExactCandidateTree(completeDir, completeNames);
  const snapshotDir = "migrations/snapshots/" + repairHash;
  const structural = inspectOfflinePackage(
    root,
    planDir,
    repairFiles["contract.json"].toString("utf8"),
    repairHash,
    /^\d{8}T\d{4}_scada_native_check_repair$/u,
  );
  requireMatch(
    structural.operations === 46 &&
      structural.migrationHash === lock.structuralMigrationHash,
    "官方结构原包操作数量或迁移标识与锁文件不一致",
  );
  for (const name of Object.keys(repairInputHashes)) {
    requireMatch(
      planFiles[name].equals(repairFiles[name]) &&
        completeFiles[name].equals(repairFiles[name]),
      "结构规划或完整迁移包中的修复契约原文发生变化",
    );
  }
  const structuralManifestName = lock.migrationDirectory + "/migration.json";
  const structuralSourceName = lock.migrationDirectory + "/migration.ts";
  const structuralOpsName = lock.migrationDirectory + "/ops.json";
  const structuralManifest = parse(planFiles, structuralManifestName);
  const structuralOps = parse(planFiles, structuralOpsName);
  requireMatch(
    structuralManifest.from === null &&
      structuralManifest.to === repairHash &&
      structuralManifest.migrationHash === lock.structuralMigrationHash,
    "结构迁移边与固定空起点不一致",
  );
  requireDeclarationHashes(
    planFiles[snapshotDir + "/contract.d.ts"].toString("utf8"),
    contract,
  );
  requireDeclarationHashes(
    completeFiles[snapshotDir + "/contract.d.ts"].toString("utf8"),
    contract,
  );
  const tables = contract.storage.namespaces.public.entries.table;
  requireMatch(
    reviewStatements(tables, structuralOps) === 46 &&
      isDeepStrictEqual(
        reviewRepairStructure(oldContract, contract, oldOps, structuralOps),
        ["table.scada_identities", "table.scada_project_release_events"],
      ),
    "四十六项结构操作超出已批准的两项 CHECK 谓词变化",
  );

  const comments = buildCommentOperations(audited.preview);
  requireMatch(comments.length === 119 && audited.comments === 119, "历史中文注释数量变化");
  const completeManifestName = lock.migrationDirectory + "/migration.json";
  const completeSourceName = lock.migrationDirectory + "/migration.ts";
  const completeOpsName = lock.migrationDirectory + "/ops.json";
  const structuralPackage = {
    manifest: structuralManifest,
    operations: structuralOps,
  };
  const storedDryRun = parseDryRun(
    completeFiles["emit-dry-run.stdout.txt"].toString("utf8"),
  );
  const actual = {
    manifest: parse(completeFiles, completeManifestName),
    operations: parse(completeFiles, completeOpsName),
  };
  const dryReview = reviewCommentEmission(structuralPackage, storedDryRun, comments);
  const finalReview = reviewCommentEmission(structuralPackage, actual, comments);
  requireMatch(
    isDeepStrictEqual(storedDryRun, actual) &&
      dryReview.operations === 165 &&
      finalReview.operations === lock.operations &&
      finalReview.migrationHash === lock.migrationHash,
    "完整迁移包自发射结果与锁定干跑或官方迁移标识不一致",
  );
  requireMatch(
    completeFiles[completeSourceName].equals(
      Buffer.from(
        appendCommentOperations(
          planFiles[structuralSourceName].toString("utf8"),
          comments,
        ),
      ),
    ),
    "完整迁移源码与已审查的中文注释插入结果不一致",
  );
  requireMatch(
    ["emit-dry-run.stderr.txt", "emit.stderr.txt", "migration-check.stderr.txt"].every(
      (name) => completeFiles[name].length === 0,
    ),
    "已保存的官方离线诊断包含未审查标准错误",
  );
  requireMigrationCheck(
    completeFiles["migration-check.stdout.txt"].toString("utf8"),
  );
  const checks = reviewExecutionChecks(actual.operations);
  requireMatch(
    checks.structuralOperations === lock.structuralOperations &&
      checks.commentOperations === lock.commentOperations &&
      isDeepStrictEqual(checks.missingPrecheck, lock.executionChecks.missingPrecheck) &&
      isDeepStrictEqual(checks.missingPostcheck, lock.executionChecks.missingPostcheck) &&
      isDeepStrictEqual(checks.identicalChecks, lock.executionChecks.identicalChecks),
    "完整迁移的前后置检查覆盖与锁定结果不一致",
  );

  stage = "固定 Prisma 8 官方只读干跑与迁移完整性复验";
  const completeConfig = join(server, "prisma8-native-check-repair-complete.config.ts");
  const migrationFile = join(completeDir, completeSourceName);
  const commands = buildReadOnlyVerificationCommands(entry, migrationFile, completeConfig);
  const childEnvironment = offlineEnvironment(process.env);
  const rerunDryRun = parseDryRun(
    runReadOnly(root, commands.dryRun, childEnvironment),
  );
  requireMatch(
    isDeepStrictEqual(rerunDryRun, actual),
    "固定 Prisma 8 官方再次干跑与已锁定一百六十五项操作不一致",
  );
  preserve();

  const storedCheck = checkSummary(
    completeFiles["migration-check.stdout.txt"].toString("utf8"),
  );
  const currentCheckText = runReadOnly(
    root,
    commands.migrationCheck,
    childEnvironment,
  );
  requireMigrationCheck(currentCheckText);
  requireMatch(
    isDeepStrictEqual(checkSummary(currentCheckText), storedCheck),
    "固定 Prisma 8 官方再次完整性检查与已保存结果不一致",
  );
  preserve();

  stage = "最终只读证据复核";
  const report = {
    status: "NATIVE_CHECK_REPAIR_PACKAGE_LOCKED_REVIEW_REQUIRED",
    lockFingerprint: lock.lockFingerprint,
    evidenceFingerprint: evidence.fingerprint,
    contractHash: lock.contractHash,
    structuralMigrationHash: lock.structuralMigrationHash,
    migrationHash: lock.migrationHash,
    migrationDirectory: lock.migrationDirectory,
    structuralOperations: lock.structuralOperations,
    commentOperations: lock.commentOperations,
    operations: lock.operations,
    verifiedFiles: fileNames.length,
    verifiedConfigs: lock.evidence.configs.length,
    originalFingerprint,
    officialDryRunVerified: true,
    officialMigrationCheckVerified: true,
    packageUnchanged: true,
    sourceEvidencePreserved: true,
    databaseConnectionConfigured: false,
    databaseCommandsInvoked: false,
    roundTripVerified: false,
    signingAllowed: false,
    deploymentAllowed: false,
  };
  preserve();
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

try {
  main();
} catch (error) {
  const reason =
    error instanceof PackageLockError ||
    error instanceof BaselineError ||
    error instanceof RepairPackageError
      ? error.message
      : "内部详情已脱敏";
  console.error("离线迁移包只读复验失败：" + stage + "；" + reason);
  process.exitCode = 1;
}
