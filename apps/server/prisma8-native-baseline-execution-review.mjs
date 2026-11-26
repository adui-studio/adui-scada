import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import acceptedEvidence from "../../scripts/prisma8-native-baseline-accepted-evidence.json" with { type: "json" };
import { resolveBaselineCli } from "../../scripts/prisma8-native-baseline.mjs";
import { readCandidateRegular } from "../../scripts/prisma8-native-baseline-candidate.mjs";
import { requireLockedCandidateEvidence } from "../../scripts/prisma8-native-baseline-comment-emission.mjs";
import { packageDirectory } from "../../scripts/prisma8-native-baseline-ddl.mjs";
import { reviewExecutionChecks } from "../../scripts/prisma8-native-baseline-execution-review.mjs";

let stage = "参数与固定依赖";
try {
  if (process.argv.length !== 2) throw new Error("不接受额外参数");
  const root = realpathSync(resolve(import.meta.dirname, "../.."));
  // 只检查版本及入口文件，不启动 Prisma CLI 或数据库驱动。
  resolveBaselineCli(root);
  stage = "固定原包与十四文件证据";
  const fingerprint = requireLockedCandidateEvidence(root);
  const name = packageDirectory + "/ops.json";
  const expected = acceptedEvidence.files.find((item) => item.path === name);
  const bytes = readCandidateRegular(
    join(root, "apps", "server", ".artifacts", "prisma8-native-baseline-comments", name),
  );
  if (
    !expected ||
    expected.bytes !== bytes.length ||
    expected.sha256 !== createHash("sha256").update(bytes).digest("hex")
  ) {
    throw new Error("迁移操作证据指纹不一致");
  }
  stage = "结构检查条件提取";
  const report = reviewExecutionChecks(JSON.parse(bytes.toString("utf8")));
  stage = "原件与候选再次核对";
  if (requireLockedCandidateEvidence(root) !== fingerprint) {
    throw new Error("独立候选指纹变化");
  }
  process.stdout.write(JSON.stringify({ fingerprint, ...report }, null, 2) + "\n");
} catch {
  console.error("离线执行检查评审失败：" + stage + "；保留原件，不执行迁移");
  process.exitCode = 1;
}
