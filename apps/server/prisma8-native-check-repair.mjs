import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { loadMigrationBaseline } from "../../scripts/inspect-prisma8-migration-readiness.mjs";
import {
  offlineEnvironment,
  readBaselineInputs,
  requirePreservedInputs,
  resolveBaselineCli,
} from "../../scripts/prisma8-native-baseline.mjs";
import {
  readAuditedFiles,
  reviewAuditedBaseline,
} from "../../scripts/prisma8-native-baseline-ddl.mjs";
import { requireLockedCandidateEvidence } from "../../scripts/prisma8-native-baseline-comment-emission.mjs";
import {
  readCandidateRegular,
  readExactCandidateTree,
} from "../../scripts/prisma8-native-baseline-candidate.mjs";
import { requireDeclarationHashes } from "../../scripts/prisma8-native-runtime-review.mjs";
import {
  buildCheckRepairSource,
  CheckRepairError,
  reviewCheckRepairContract,
} from "../../scripts/prisma8-native-check-repair.mjs";

const confirmation = "--confirm-offline-check-repair";
const configHash = "1ccda04b90a5f26e95a84c67ef8c1726689430955bd0ccecd6dc0baa7e2b250f";
const originalFingerprint = "02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e";
let stage = "离线修复授权";

function requireMatch(condition, message) {
  if (!condition) throw new CheckRepairError(message);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function main() {
  requireMatch(
    process.argv.length === 3 && process.argv[2] === confirmation,
    "必须明确确认仅离线发射 CHECK 修复契约，不接受其他参数",
  );
  const root = realpathSync(resolve(import.meta.dirname, "../.."));
  const artifacts = join(root, ".artifacts");
  const originalDir = join(artifacts, "prisma8-native-baseline");
  const output = join(artifacts, "prisma8-native-check-repair");
  const config = join(root, "apps", "server", "prisma8-native-check-repair.config.ts");
  stage = "固定原件、离线配置和依赖核验";
  requireMatch(
    lstatSync(artifacts).isDirectory() &&
      realpathSync(artifacts) === artifacts &&
      !lstatSync(output, { throwIfNoEntry: false }),
    "修复输出目录已存在或父目录不安全，禁止覆盖和清理",
  );
  const inputs = readBaselineInputs(root, true);
  const files = readAuditedFiles(originalDir);
  const originalText = files["contract.json"].toString("utf8");
  const original = JSON.parse(originalText);
  const baseline = loadMigrationBaseline();
  const requirePreserved = () => {
    requirePreservedInputs(root, inputs);
    const audit = reviewAuditedBaseline(root, loadMigrationBaseline(), originalText);
    requireMatch(
      audit.operations === 46 &&
        audit.comments === 119 &&
        requireLockedCandidateEvidence(root) === originalFingerprint &&
        digest(readCandidateRegular(config)) === configHash,
      "原件、历史注释、固定候选或离线配置发生变化",
    );
    requireMatch(
      loadMigrationBaseline().contractHash === baseline.contractHash,
      "正式契约标识变化",
    );
  };
  requirePreserved();
  const entry = resolveBaselineCli(root);
  const source = buildCheckRepairSource(files["contract.prisma"].toString("utf8"), original);
  stage = "独立源文件写入及官方契约发射";
  mkdirSync(output);
  writeFileSync(join(output, "contract.prisma"), source, { flag: "wx" });
  let failure;
  let report;
  try {
    const child = spawnSync(process.execPath, [entry, "contract", "emit", "--config", config], {
      cwd: root,
      env: offlineEnvironment(process.env),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
    requireMatch(realpathSync(output) === output, "独立输出目录发生变化");
    writeFileSync(join(output, "emit.stdout.txt"), child.stdout ?? "", { flag: "wx" });
    writeFileSync(join(output, "emit.stderr.txt"), child.stderr ?? "", { flag: "wx" });
    requireMatch(!child.error && child.status === 0, "官方离线发射失败，保留现场");
    stage = "新契约逐项差异和官方静态装载核验";
    const generated = readExactCandidateTree(output, [
      "contract.prisma",
      "contract.json",
      "contract.d.ts",
      "emit.stdout.txt",
      "emit.stderr.txt",
    ]);
    requireMatch(generated["contract.prisma"].toString("utf8") === source, "修复源原文发生变化");
    const candidate = JSON.parse(generated["contract.json"].toString("utf8"));
    report = reviewCheckRepairContract(original, candidate);
    requireDeclarationHashes(generated["contract.d.ts"].toString("utf8"), candidate);
    void contractFromJson(candidate);
    report = {
      ...report,
      originalFingerprint,
      sourceSha256: digest(generated["contract.prisma"]),
      contractSha256: digest(generated["contract.json"]),
      declarationSha256: digest(generated["contract.d.ts"]),
      historicalCommentsPreserved: 119,
    };
  } catch (error) {
    failure = error instanceof CheckRepairError ? error.message : stage + "失败，内部详情已脱敏";
  }
  stage = "原件和固定候选最终复核";
  requirePreserved();
  requireMatch(!failure && report, failure ?? "未取得修复契约评审报告");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof CheckRepairError
      ? error.message
      : "离线 CHECK 修复失败：" + stage + "；内部详情已脱敏",
  );
  process.exitCode = 1;
}
