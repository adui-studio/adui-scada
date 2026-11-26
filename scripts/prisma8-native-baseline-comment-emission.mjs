import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { offlineEnvironment } from "./prisma8-native-baseline.mjs";
import { packageDirectory, readAuditedFiles } from "./prisma8-native-baseline-ddl.mjs";
import {
  appendCommentOperations,
  buildCommentOperations,
  CommentEmissionError,
  parseDryRun,
  reviewCommentEmission,
} from "./prisma8-native-baseline-comments.mjs";
import {
  candidateFileNames,
  fingerprintCandidateFiles,
  readCandidateRegular,
  readExactCandidateTree,
  requireMigrationCheck,
  requireOfflineCandidateConfig,
  reviewCandidateFiles,
} from "./prisma8-native-baseline-candidate.mjs";
import { requireAcceptedCandidateEvidence } from "./prisma8-native-baseline-preflight.mjs";

function requireMatch(condition, message) {
  if (!condition) throw new CommentEmissionError(message);
}

function requireDirectory(path) {
  requireMatch(
    lstatSync(path).isDirectory() && realpathSync(path) === path,
    "独立注释候选目录包含链接或不是目录",
  );
}

function readRegular(path) {
  requireMatch(
    lstatSync(path).isFile() && realpathSync(path) === path,
    "独立注释候选文件包含链接或不是文件",
  );
  return readFileSync(path);
}

const manifestName = packageDirectory + "/migration.json";
const operationsName = packageDirectory + "/ops.json";
const sourceName = packageDirectory + "/migration.ts";

function parseArtifacts(files) {
  return {
    manifest: JSON.parse(files[manifestName].toString("utf8")),
    operations: JSON.parse(files[operationsName].toString("utf8")),
  };
}

/** 固定本地 Node 入口，保留每个阶段的原始输出，不转发任意参数。 */
function runOffline(root, output, stage, args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: offlineEnvironment(process.env),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  requireDirectory(output);
  writeFileSync(join(output, stage + ".stdout.txt"), result.stdout ?? "", { flag: "wx" });
  writeFileSync(join(output, stage + ".stderr.txt"), result.stderr ?? "", { flag: "wx" });
  requireMatch(
    !result.error && result.status === 0,
    "离线注释自发射阶段失败：" + stage + "；保留诊断，不自动重试",
  );
  return result.stdout;
}

/** 仅从固定十文件原包构造独立候选，官方命令不接收数据库参数。 */
export function runCommentEmission(root, entry, audited) {
  const originalDir = join(root, ".artifacts", "prisma8-native-baseline");
  const files = readAuditedFiles(originalDir);
  const original = parseArtifacts(files);
  const comments = buildCommentOperations(audited.preview);
  requireMatch(
    original.operations.length === 46 && comments.length === 119 && audited.comments === 119,
    "原始操作或注释数量变化",
  );
  const authoring = appendCommentOperations(files[sourceName].toString("utf8"), comments);
  const server = join(root, "apps", "server");
  requireDirectory(server);
  const parent = join(server, ".artifacts");
  if (!lstatSync(parent, { throwIfNoEntry: false })) mkdirSync(parent);
  requireDirectory(parent);
  const output = join(parent, "prisma8-native-baseline-comments");
  requireMatch(
    !lstatSync(output, { throwIfNoEntry: false }),
    "独立注释候选已存在，禁止覆盖或自动清理",
  );
  const config = join(server, "prisma8-native-baseline-comments.config.ts");
  const configBytes = readRegular(config);
  const copyNames = Object.keys(files).filter(
    (name) => name !== "plan.json" && name !== "plan.stderr.txt",
  );
  mkdirSync(output);
  try {
    for (const name of copyNames) {
      const path = join(output, name);
      mkdirSync(dirname(path), { recursive: true });
      requireDirectory(dirname(path));
      writeFileSync(path, name === sourceName ? authoring : files[name], { flag: "wx" });
    }
    const readCopy = () => {
      requireMatch(readRegular(config).equals(configBytes), "独立注释配置发生变化");
      return Object.fromEntries(
        copyNames.map((name) => {
          const bytes = readRegular(join(output, name));
          if (name === sourceName)
            requireMatch(bytes.equals(Buffer.from(authoring)), "独立注释源码发生变化");
          else if (name !== manifestName && name !== operationsName)
            requireMatch(bytes.equals(files[name]), "独立注释候选契约或快照发生变化");
          return [name, bytes];
        }),
      );
    };
    const before = readCopy();
    const migration = join(output, sourceName);
    const dryRun = parseDryRun(
      runOffline(root, output, "emit-dry-run", [migration, "--config", config, "--dry-run"]),
    );
    requireMatch(isDeepStrictEqual(readCopy(), before), "官方干跑改变了候选文件");
    const review = reviewCommentEmission(original, dryRun, comments);
    requireMatch(review.operations === 165, "独立注释候选必须包含一百六十五项操作");
    runOffline(root, output, "emit", [migration, "--config", config]);
    const emitted = readCopy();
    const actual = parseArtifacts(emitted);
    requireMatch(isDeepStrictEqual(actual, dryRun), "实际自发射结果与干跑不一致");
    reviewCommentEmission(original, actual, comments);
    const checkText = runOffline(root, output, "migration-check", [
      entry,
      "migration",
      "check",
      "--space",
      "app",
      "--json",
      "--config",
      config,
    ]);
    requireMigrationCheck(checkText);
    requireMatch(isDeepStrictEqual(readCopy(), emitted), "官方迁移检查改变了候选文件");
    return { ...review, status: "COMMENTS_EMITTED_REVIEW_REQUIRED" };
  } finally {
    requireMatch(isDeepStrictEqual(readAuditedFiles(originalDir), files), "固定原包发生变化");
  }
}

/** 已有候选仅复验，不写入日志、重新自发射或执行任何数据库命令。 */
export function runCandidateReview(root, entry, audited) {
  const originalDir = join(root, ".artifacts", "prisma8-native-baseline");
  const originalFiles = readAuditedFiles(originalDir);
  const server = join(root, "apps", "server");
  const output = join(server, ".artifacts", "prisma8-native-baseline-comments");
  const config = join(server, "prisma8-native-baseline-comments.config.ts");
  const configBytes = readCandidateRegular(config);
  requireOfflineCandidateConfig(configBytes);
  const names = candidateFileNames(originalFiles);
  const files = readExactCandidateTree(output, names);
  const evidence = fingerprintCandidateFiles(files, configBytes);
  requireAcceptedCandidateEvidence(evidence);
  const review = reviewCandidateFiles(originalFiles, files, audited, packageDirectory);
  const requirePreserved = () => {
    requireMatch(
      isDeepStrictEqual(readAuditedFiles(originalDir), originalFiles) &&
        isDeepStrictEqual(readExactCandidateTree(output, names), files) &&
        readCandidateRegular(config).equals(configBytes),
      "离线复验期间原包、独立候选或配置发生变化",
    );
  };
  const runReview = (stage, args) => {
    requirePreserved();
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env: offlineEnvironment(process.env),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
    requirePreserved();
    requireMatch(
      !result.error && result.status === 0,
      "独立候选离线复验失败：" + stage + "；保留已有证据，不自动重试",
    );
    return result.stdout;
  };
  try {
    const dryRun = parseDryRun(
      runReview("官方干跑", [join(output, sourceName), "--config", config, "--dry-run"]),
    );
    requireMatch(isDeepStrictEqual(dryRun, review.actual), "重新干跑与已验收的实际迁移产物不一致");
    requireMigrationCheck(
      runReview("官方迁移完整性", [
        entry,
        "migration",
        "check",
        "--space",
        "app",
        "--json",
        "--config",
        config,
      ]),
    );
    return {
      operations: review.operations,
      migrationHash: review.migrationHash,
      status: "CANDIDATE_PREFLIGHT_REVIEW_REQUIRED",
      signingAllowed: false,
      deploymentAllowed: false,
      evidence,
    };
  } finally {
    requirePreserved();
  }
}

/** 数据库预检结束后重新核对固定原包、配置及十四文件，不启动官方进程。 */
export function requireLockedCandidateEvidence(root) {
  const originalDir = join(root, ".artifacts", "prisma8-native-baseline");
  const original = readAuditedFiles(originalDir);
  const server = join(root, "apps", "server");
  const output = join(server, ".artifacts", "prisma8-native-baseline-comments");
  const config = readCandidateRegular(join(server, "prisma8-native-baseline-comments.config.ts"));
  const files = readExactCandidateTree(output, candidateFileNames(original));
  return requireAcceptedCandidateEvidence(fingerprintCandidateFiles(files, config));
}
