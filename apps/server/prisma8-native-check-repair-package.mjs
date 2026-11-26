import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { loadMigrationBaseline } from "../../scripts/inspect-prisma8-migration-readiness.mjs";
import {
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
  acceptedMigrationHash,
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
  fingerprintRepairPackage,
  repairDirectory,
  repairHash,
  repairInputHashes,
  repairSlug,
  RepairPackageError,
  requireRepairInputs,
  reviewRepairStructure,
} from "../../scripts/prisma8-native-check-repair-package.mjs";

import { RepairPackageReviewError } from "../../scripts/prisma8-native-check-repair-package-review.mjs";
import { reviewExistingRepairPackage } from "./prisma8-native-check-repair-package-review.mjs";
import {
  buildCheckRoundTripPlan,
  CheckRoundTripError,
} from "../../scripts/prisma8-native-check-roundtrip.mjs";

const confirmation = "--confirm-offline-check-repair-package";
const reviewConfirmation = "--review-existing-check-repair-package";
const roundTripConfirmation = "--plan-check-roundtrip";
const originalFingerprint = "02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e";
const configHashes = {
  "prisma8-native-check-repair-plan.config.ts":
    "939fa70ad1c4738e805b02cc797baa4e0c54c1575cc872fa9f27557fbfe454f7",
  "prisma8-native-check-repair-complete.config.ts":
    "e83ff5d3d0462f2365ba268421ab82f0beff244eb36a50cb4d6cd244c3e8d63b",
};
const contractNames = Object.keys(repairInputHashes);
const planLogs = ["plan.json", "plan.stderr.txt"];
let stage = "确认离线授权";

function requireMatch(condition, message) {
  if (!condition) throw new RepairPackageError(message);
}

function requireDirectory(path) {
  requireMatch(
    lstatSync(path).isDirectory() && realpathSync(path) === path,
    "离线目录包含链接或不是目录",
  );
}

function parse(files, name) {
  return JSON.parse(files[name].toString("utf8"));
}

function runOffline(root, output, args, logs) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: offlineEnvironment(process.env),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  requireDirectory(output);
  writeFileSync(join(output, logs[0]), result.stdout ?? "", { flag: "wx" });
  writeFileSync(join(output, logs[1]), result.stderr ?? "", { flag: "wx" });
  requireMatch(
    !result.error && result.status === 0,
    "官方离线阶段失败：" + stage + "；保留诊断，不自动重试",
  );
  return result.stdout;
}

function main() {
  const roundTripPlanning = process.argv[2] === roundTripConfirmation;
  const reviewing = process.argv[2] === reviewConfirmation || roundTripPlanning;
  requireMatch(
    process.argv.length === 3 && (reviewing || process.argv[2] === confirmation),
    "必须明确选择离线生成、固定修复迁移包复验或往返计划，不接受其他参数",
  );
  stage = "固定原件、修复契约、第四座副本及配置核验";
  const root = realpathSync(resolve(import.meta.dirname, "../.."));
  const server = join(root, "apps", "server");
  const parent = join(server, ".artifacts");
  const output = join(parent, repairDirectory);
  requireDirectory(parent);
  if (!reviewing) {
    requireMatch(
      !lstatSync(output, { throwIfNoEntry: false }),
      "独立修复迁移包已存在，禁止覆盖或自动清理",
    );
  }
  const inputs = readBaselineInputs(root, true);
  const oldDir = join(root, ".artifacts", "prisma8-native-baseline");
  const oldFiles = readAuditedFiles(oldDir);
  const oldContract = parse(oldFiles, "contract.json");
  const repairDir = join(root, ".artifacts", "prisma8-native-check-repair");
  const repairNames = [...contractNames, "emit.stdout.txt", "emit.stderr.txt"];
  const repairFiles = readExactCandidateTree(repairDir, repairNames);
  const contract = requireRepairInputs(repairFiles);
  reviewCheckRepairContract(oldContract, contract);
  requireMatch(
    buildCheckRepairSource(oldFiles["contract.prisma"].toString("utf8"), oldContract) ===
      repairFiles["contract.prisma"].toString("utf8"),
    "修复契约源码与已审查的两项谓词替换不一致",
  );
  requireDeclarationHashes(repairFiles["contract.d.ts"].toString("utf8"), contract);
  void contractFromJson(contract);
  const configs = Object.fromEntries(
    Object.entries(configHashes).map(([name, hash]) => {
      const bytes = readCandidateRegular(join(server, name));
      requireMatch(
        createHash("sha256").update(bytes).digest("hex") === hash,
        "独立离线配置原文变化",
      );
      return [name, bytes];
    }),
  );
  const baseline = loadMigrationBaseline();
  const audited = reviewAuditedBaseline(root, baseline, oldFiles["contract.json"].toString("utf8"));
  const oldOps = parse(oldFiles, packageDirectory + "/ops.json");
  const fourth = join(parent, "prisma8-native-repro-candidate");
  const fourthNames = candidateFileNames(oldFiles);
  const previousConfig = join(server, "prisma8-native-baseline-comments.config.ts");
  const preserve = () => {
    requirePreservedInputs(root, inputs);
    const current = reviewAuditedBaseline(
      root,
      loadMigrationBaseline(),
      oldFiles["contract.json"].toString("utf8"),
    );
    requireMatch(
      isDeepStrictEqual(current, audited) &&
        requireLockedCandidateEvidence(root) === originalFingerprint,
      "历史原件或固定候选发生变化",
    );
    requireMatch(
      requireAcceptedCandidateEvidence(
        fingerprintCandidateFiles(
          readExactCandidateTree(fourth, fourthNames),
          readCandidateRegular(previousConfig),
        ),
      ) === originalFingerprint,
      "第四座保留副本发生变化",
    );
    requireMatch(
      isDeepStrictEqual(readExactCandidateTree(repairDir, repairNames), repairFiles),
      "已验收修复契约或诊断发生变化",
    );
    for (const [name, bytes] of Object.entries(configs)) {
      requireMatch(readCandidateRegular(join(server, name)).equals(bytes), "独立离线配置发生变化");
    }
  };
  preserve();
  const entry = resolveBaselineCli(root);
  if (reviewing) {
    stage = "固定修复迁移包离线复验";
    const report = reviewExistingRepairPackage({
      root,
      server,
      output,
      entry,
      configs,
      oldContract,
      contract,
      oldOps,
      audited,
      repairFiles,
      preserve,
    });
    if (roundTripPlanning) {
      stage = "固定 CHECK 往返计划";
      const plan = buildCheckRoundTripPlan(oldContract, contract);
      requireMatch(
        report.offlineReviewPassed === true &&
          report.evidencePreserved === true &&
          report.evidenceFingerprint === plan.evidenceFingerprint,
        "往返计划未绑定已复验固定证据",
      );
      preserve();
      process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    } else {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    }
    return;
  }
  const planDir = join(output, "plan");
  const completeDir = join(output, "complete");
  const planConfig = join(server, "prisma8-native-check-repair-plan.config.ts");
  const completeConfig = join(server, "prisma8-native-check-repair-complete.config.ts");
  let failure;
  let report;
  try {
    stage = "新契约空起点官方规划";
    mkdirSync(output);
    mkdirSync(planDir);
    for (const name of contractNames) {
      writeFileSync(join(planDir, name), repairFiles[name], { flag: "wx" });
    }
    const planText = runOffline(
      root,
      planDir,
      [
        entry,
        "migration",
        "plan",
        "--from",
        "@empty",
        "--name",
        repairSlug,
        "--json",
        "--no-interactive",
        "--config",
        planConfig,
      ],
      planLogs,
    );
    preserve();
    const structural = inspectOfflinePackage(
      root,
      planDir,
      repairFiles["contract.json"].toString("utf8"),
      repairHash,
      /^\d{8}T\d{4}_scada_native_check_repair$/u,
    );
    const migrationDir = "migrations/app/" + basename(JSON.parse(planText).envelope.result.dir);
    const snapshotDir = "migrations/snapshots/" + repairHash;
    const manifestName = migrationDir + "/migration.json";
    const sourceName = migrationDir + "/migration.ts";
    const opsName = migrationDir + "/ops.json";
    const planNames = [
      ...contractNames,
      ...planLogs,
      manifestName,
      sourceName,
      opsName,
      snapshotDir + "/contract.json",
      snapshotDir + "/contract.d.ts",
    ];
    const planFiles = readExactCandidateTree(planDir, planNames);
    for (const name of contractNames) {
      requireMatch(planFiles[name].equals(repairFiles[name]), "规划改变了固定修复契约");
    }
    requireDeclarationHashes(planFiles[snapshotDir + "/contract.d.ts"].toString("utf8"), contract);
    const original = {
      manifest: parse(planFiles, manifestName),
      operations: parse(planFiles, opsName),
    };
    stage = "四十六项结构操作与原包逐项对照";
    const tables = contract.storage.namespaces.public.entries.table;
    requireMatch(
      structural.operations === 46 && reviewStatements(tables, original.operations) === 46,
      "修复结构操作数量不一致",
    );
    const changed = reviewRepairStructure(oldContract, contract, oldOps, original.operations);
    const comments = buildCommentOperations(audited.preview);
    requireMatch(comments.length === 119 && audited.comments === 119, "历史中文注释数量不一致");
    const authoring = appendCommentOperations(planFiles[sourceName].toString("utf8"), comments);
    stage = "独立完整候选官方干跑";
    const copyNames = planNames.filter((name) => !planLogs.includes(name));
    const expected = {
      ...Object.fromEntries(copyNames.map((name) => [name, planFiles[name]])),
      [sourceName]: Buffer.from(authoring),
    };
    mkdirSync(completeDir);
    for (const name of copyNames) {
      const path = join(completeDir, name);
      mkdirSync(dirname(path), { recursive: true });
      requireDirectory(dirname(path));
      writeFileSync(path, expected[name], { flag: "wx" });
    }
    const logNames = [];
    const run = (prefix, args) => {
      const logs = [prefix + ".stdout.txt", prefix + ".stderr.txt"];
      const stdout = runOffline(root, completeDir, args, logs);
      logNames.push(...logs);
      preserve();
      requireMatch(
        isDeepStrictEqual(readExactCandidateTree(planDir, planNames), planFiles),
        "独立结构原包发生变化",
      );
      return stdout;
    };
    const readComplete = () => readExactCandidateTree(completeDir, [...copyNames, ...logNames]);
    const requireCopy = (files, emitted = false) => {
      for (const name of copyNames) {
        if (emitted && [manifestName, opsName].includes(name)) continue;
        requireMatch(files[name].equals(expected[name]), "独立完整候选源码或快照发生变化");
      }
    };
    const migration = join(completeDir, sourceName);
    const dryRun = parseDryRun(
      run("emit-dry-run", [migration, "--config", completeConfig, "--dry-run"]),
    );
    requireCopy(readComplete());
    const dryReview = reviewCommentEmission(original, dryRun, comments);
    requireMatch(
      dryReview.operations === 165 && dryReview.migrationHash !== acceptedMigrationHash,
      "完整操作数量或官方新迁移标识不一致",
    );
    stage = "一百六十五项完整操作官方自发射";
    run("emit", [migration, "--config", completeConfig]);
    const emitted = readComplete();
    requireCopy(emitted, true);
    const actual = { manifest: parse(emitted, manifestName), operations: parse(emitted, opsName) };
    requireMatch(isDeepStrictEqual(actual, dryRun), "实际自发射结果与干跑不一致");
    const review = reviewCommentEmission(original, actual, comments);
    const checks = reviewExecutionChecks(actual.operations);
    requireMatch(
      isDeepStrictEqual(checks.missingPrecheck, ["schema.public"]) &&
        isDeepStrictEqual(checks.missingPostcheck, ["schema.public"]) &&
        checks.identicalChecks.length === 0,
      "完整迁移前后置检查覆盖变化",
    );
    stage = "官方迁移完整性检查及证据固定";
    requireMigrationCheck(
      run("migration-check", [
        entry,
        "migration",
        "check",
        "--space",
        "app",
        "--json",
        "--config",
        completeConfig,
      ]),
    );
    const final = readComplete();
    requireMatch(
      Object.entries(emitted).every(([name, bytes]) => final[name].equals(bytes)),
      "官方完整性检查改变了已有证据",
    );
    const allNames = [
      ...planNames.map((name) => "plan/" + name),
      ...Object.keys(final).map((name) => "complete/" + name),
    ];
    const allFiles = readExactCandidateTree(output, allNames);
    requireMatch(
      planNames.every((name) => allFiles["plan/" + name].equals(planFiles[name])) &&
        Object.keys(final).every((name) => allFiles["complete/" + name].equals(final[name])),
      "最终独立迁移证据发生变化",
    );
    report = {
      status: "NATIVE_CHECK_REPAIR_PACKAGE_REVIEW_REQUIRED",
      contractHash: repairHash,
      structuralOperations: 46,
      changedStructuralOperations: changed,
      commentOperations: 119,
      operations: review.operations,
      structuralMigrationHash: structural.migrationHash,
      migrationHash: review.migrationHash,
      migrationDirectory: migrationDir,
      missingPrecheck: checks.missingPrecheck,
      missingPostcheck: checks.missingPostcheck,
      identicalChecks: checks.identicalChecks,
      originalFingerprint,
      roundTripVerified: false,
      migrationPackageGenerated: true,
      signingAllowed: false,
      deploymentAllowed: false,
      evidence: fingerprintRepairPackage(allFiles, configs, review.migrationHash),
    };
  } catch (error) {
    failure =
      error instanceof RepairPackageError
        ? error.message
        : "离线阶段失败：" + stage + "；内部详情已脱敏";
  }
  stage = "全部原件最终复核";
  preserve();
  requireMatch(!failure && report, failure ?? "未取得完整离线迁移包评审报告");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof RepairPackageError ||
      error instanceof RepairPackageReviewError ||
      error instanceof CheckRoundTripError
      ? error.message
      : "离线修复迁移包失败：" + stage + "；保留证据",
  );
  process.exitCode = 1;
}
