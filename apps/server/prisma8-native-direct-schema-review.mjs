import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import acceptedEvidence from "../../scripts/prisma8-native-baseline-accepted-evidence.json" with { type: "json" };
import { resolveBaselineCli } from "../../scripts/prisma8-native-baseline.mjs";
import { readCandidateRegular } from "../../scripts/prisma8-native-baseline-candidate.mjs";
import { requireLockedCandidateEvidence } from "../../scripts/prisma8-native-baseline-comment-emission.mjs";
import {
  DirectSchemaReviewError,
  runDirectSchemaReview,
} from "../../scripts/prisma8-native-direct-schema-review.mjs";

let stage = "固定参数、版本及证据";
try {
  if (process.argv.length !== 2) throw new Error("不接受额外参数");
  const root = realpathSync(resolve(import.meta.dirname, "../.."));
  resolveBaselineCli(root);
  const fingerprint = requireLockedCandidateEvidence(root);
  const directory = join(root, "apps", "server", ".artifacts", "prisma8-native-baseline-comments");
  const snapshots = acceptedEvidence.files.filter(
    (item) => item.path.startsWith("migrations/snapshots/") && item.path.endsWith("/contract.json"),
  );
  if (snapshots.length !== 1) throw new Error("固定目标快照不唯一");
  const readLockedContract = (name) => {
    const expected = acceptedEvidence.files.find((item) => item.path === name);
    const bytes = readCandidateRegular(join(directory, name));
    if (
      !expected ||
      expected.bytes !== bytes.length ||
      expected.sha256 !== createHash("sha256").update(bytes).digest("hex")
    ) {
      throw new Error("固定目标契约指纹不一致");
    }
    return JSON.parse(bytes.toString("utf8"));
  };
  const contract = readLockedContract(snapshots[0].path);
  if (!isDeepStrictEqual(contract, readLockedContract("contract.json")))
    throw new Error("固定快照与目标契约不一致");
  stage = "装载官方公开控制入口";
  const { createPostgresControlClient } = await import("@prisma/orm-postgres/control");
  let report;
  try {
    stage = "历史库直接只读结构验证";
    report = await runDirectSchemaReview(
      createPostgresControlClient,
      process.env.SCADA_TEST_DATABASE_URL,
      contract,
    );
  } finally {
    stage = "固定证据复核";
    if (requireLockedCandidateEvidence(root) !== fingerprint) throw new Error("固定证据变化");
  }
  process.stdout.write(JSON.stringify({ fingerprint, ...report }, null, 2) + "\n");
  process.exitCode = report.results.every((item) => item.ok) ? 0 : 4;
} catch (error) {
  console.error(
    error instanceof DirectSchemaReviewError
      ? error.message
      : "直接只读结构评审失败：" + stage + "；内部详情已脱敏",
  );
  process.exitCode = 1;
}
