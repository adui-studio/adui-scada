import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  appendCommentOperations,
  buildCommentOperations,
  CommentEmissionError,
  parseDryRun,
  reviewCommentEmission,
} from "./prisma8-native-baseline-comments.mjs";

export const acceptedMigrationHash = "e6b95ed88834dce3f6448445a5ba12a00ba34c8e5c68f4335751659b15a77f17";
const configHash = "1f48ac2fbcc601fff330b670a1b5def9ca6d6b3243e30db97b9bfb9f31c94941";
const evidenceNames = [
  "emit-dry-run.stdout.txt",
  "emit-dry-run.stderr.txt",
  "emit.stdout.txt",
  "emit.stderr.txt",
  "migration-check.stdout.txt",
  "migration-check.stderr.txt",
];
const originalOnly = ["plan.json", "plan.stderr.txt"];

function requireMatch(condition, message) {
  if (!condition) throw new CommentEmissionError(message);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 只允许此前自发射写入的八份候选文件及六份原始诊断。 */
export function candidateFileNames(original) {
  const names = Object.keys(original).filter((name) => !originalOnly.includes(name));
  requireMatch(names.length === 8, "独立注释候选的原件清单变化");
  return [...names, ...evidenceNames];
}

/** 拒绝链接、硬链接和超出范围的文件，避免读取候选以外的内容。 */
export function readCandidateRegular(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  requireMatch(
    stat?.isFile() && stat.nlink === 1 && stat.size <= 16 * 1024 * 1024 && realpathSync(path) === path,
    "独立注释候选文件缺失、链接或超出大小限制",
  );
  const bytes = readFileSync(path);
  requireMatch(bytes.length === stat.size, "独立注释候选文件读取期间发生变化");
  return bytes;
}

/** 验证每层目录的精确子项清单，不递归跟随未知对象。 */
export function readExactCandidateTree(directory, names) {
  requireMatch(new Set(names).size === names.length, "独立注释候选文件清单重复");
  const directories = new Map();
  for (const name of names) {
    const parts = name.split("/");
    requireMatch(
      parts.every((part) => /^[a-zA-Z0-9_.-]+$/u.test(part) && part !== "." && part !== ".."),
      "独立注释候选相对路径超出范围",
    );
    for (const [index, part] of parts.entries()) {
      const parent = parts.slice(0, index).join("/");
      if (!directories.has(parent)) directories.set(parent, new Set());
      directories.get(parent).add(part);
    }
  }
  for (const [relative, children] of directories) {
    const path = join(directory, relative);
    requireMatch(
      lstatSync(path, { throwIfNoEntry: false })?.isDirectory() && realpathSync(path) === path,
      "独立注释候选目录缺失或包含链接",
    );
    const actual = readdirSync(path);
    requireMatch(
      actual.length === children.size && actual.every((name) => children.has(name)),
      "独立注释候选目录存在额外或缺失对象：" + (relative || "根目录"),
    );
  }
  return Object.fromEntries(names.map((name) => [name, readCandidateRegular(join(directory, name))]));
}

/** 固定已验收的无数据库连接配置原文，不执行任意本地配置。 */
export function requireOfflineCandidateConfig(bytes) {
  requireMatch(digest(bytes) === configHash, "独立注释候选离线配置指纹变化");
}

/** 复用真实成功的固定 RC 封装，拒绝诊断、findings 或非零退出。 */
export function requireMigrationCheck(stdout) {
  const check = JSON.parse(stdout);
  requireMatch(
    check.kind === "result" &&
      check.commandId === "migration.check" &&
      check.envelope?.commandId === "migration.check" &&
      check.envelope.ok === true &&
      check.envelope.exitCode === 0 &&
      isDeepStrictEqual(check.envelope.diagnostics, []) &&
      check.envelope.result?.ok === true &&
      isDeepStrictEqual(check.envelope.result.failures, []),
    "官方迁移完整性检查结果未确认成功",
  );
}

function parseArtifacts(files, packageDirectory) {
  return {
    manifest: JSON.parse(files[packageDirectory + "/migration.json"].toString("utf8")),
    operations: JSON.parse(files[packageDirectory + "/ops.json"].toString("utf8")),
  };
}

/** 从固定原包重新构造预期源码与操作；不信任新包自行声明的哈希。 */
export function reviewCandidateFiles(originalFiles, files, audited, packageDirectory) {
  const names = candidateFileNames(originalFiles);
  requireMatch(
    Object.keys(files).length === names.length && names.every((name) => Buffer.isBuffer(files[name])),
    "独立注释候选证据文件清单不一致",
  );
  const sourceName = packageDirectory + "/migration.ts";
  const manifestName = packageDirectory + "/migration.json";
  const operationsName = packageDirectory + "/ops.json";
  const original = parseArtifacts(originalFiles, packageDirectory);
  const actual = parseArtifacts(files, packageDirectory);
  const comments = buildCommentOperations(audited.preview);
  requireMatch(
    original.operations.length === 46 && comments.length === 119 && audited.comments === 119,
    "独立注释候选的原始操作或注释数量变化",
  );
  const authoring = appendCommentOperations(originalFiles[sourceName].toString("utf8"), comments);
  for (const name of names) {
    if (evidenceNames.includes(name) || name === manifestName || name === operationsName) continue;
    const expected = name === sourceName ? Buffer.from(authoring) : originalFiles[name];
    requireMatch(files[name].equals(expected), "独立注释候选源码、契约或快照变化：" + name);
  }
  const review = reviewCommentEmission(original, actual, comments);
  requireMatch(
    review.operations === 165 && review.migrationHash === acceptedMigrationHash,
    "独立注释候选不匹配已验收的官方迁移标识或操作数量",
  );
  requireMatch(
    isDeepStrictEqual(parseDryRun(files["emit-dry-run.stdout.txt"].toString("utf8")), actual),
    "独立注释候选与已保存的官方干跑结果不一致",
  );
  requireMigrationCheck(files["migration-check.stdout.txt"].toString("utf8"));
  return { actual, ...review };
}

/** 证据清单按相对路径排序，包含完整原始日志但不输出日志正文。 */
export function fingerprintCandidateFiles(files, config) {
  requireOfflineCandidateConfig(config);
  const evidence = {
    scope: "PRISMA8_NATIVE_COMMENT_CANDIDATE_V1",
    migrationHash: acceptedMigrationHash,
    configSha256: digest(config),
    files: Object.entries(files)
      .sort(([left], [right]) => compareNames(left, right))
      .map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: digest(bytes) })),
  };
  return { ...evidence, fingerprint: digest(JSON.stringify(evidence)) };
}
