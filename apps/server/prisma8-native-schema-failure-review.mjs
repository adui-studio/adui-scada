import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import acceptedEvidence from "../../scripts/prisma8-native-baseline-accepted-evidence.json" with { type: "json" };
import { readCandidateRegular } from "../../scripts/prisma8-native-baseline-candidate.mjs";
import { requireLockedCandidateEvidence } from "../../scripts/prisma8-native-baseline-comment-emission.mjs";
import { allowedPaths } from "../../scripts/prisma8-native-direct-schema-review.mjs";
import {
  maxSchemaFailureBytes,
  NativeSchemaFailureReviewError,
  reviewNativeSchemaFailure,
} from "../../scripts/prisma8-native-schema-failure-review.mjs";

let stage = "固定参数及证据";
try {
  if (process.argv.length !== 2 || process.stdin.isTTY) {
    throw new Error("仅接受标准输入中的已有机器诊断，不接受额外参数");
  }
  const root = realpathSync(resolve(import.meta.dirname, "../.."));
  const fingerprint = requireLockedCandidateEvidence(root);
  const expected = acceptedEvidence.files.find((item) => item.path === "contract.json");
  const bytes = readCandidateRegular(
    join(root, "apps", "server", ".artifacts", "prisma8-native-baseline-comments", "contract.json"),
  );
  if (
    !expected ||
    expected.bytes !== bytes.length ||
    expected.sha256 !== createHash("sha256").update(bytes).digest("hex")
  ) {
    throw new Error("固定目标契约指纹不一致");
  }
  const names = allowedPaths(JSON.parse(bytes.toString("utf8")));
  stage = "读取已有机器诊断";
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxSchemaFailureBytes) throw new Error("迁移诊断输入超过大小限制");
    chunks.push(buffer);
  }
  stage = "提取脱敏结构差异";
  const report = reviewNativeSchemaFailure(Buffer.concat(chunks).toString("utf8"), names);
  stage = "固定证据复核";
  if (requireLockedCandidateEvidence(root) !== fingerprint) throw new Error("固定证据变化");
  process.stdout.write(JSON.stringify({ fingerprint, ...report }, null, 2) + "\n");
  process.exitCode = report.detailsAvailable ? 0 : 4;
} catch (error) {
  console.error(
    error instanceof NativeSchemaFailureReviewError
      ? error.message
      : "离线结构失败评审失败：" + stage + "；内部详情已脱敏",
  );
  process.exitCode = 1;
}
