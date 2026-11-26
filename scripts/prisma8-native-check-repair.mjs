import { isDeepStrictEqual } from "node:util";

const repairs = [
  {
    table: "scada_identities",
    name: "scada_identities_status_check",
    column: "status",
    values: ["active", "disabled"],
  },
  {
    table: "scada_project_release_events",
    name: "scada_project_release_event_action_check",
    column: "action",
    values: ["PUBLISH", "ROLLBACK"],
  },
].map(({ table, name, column, values }) => ({
  table,
  name,
  expected:
    "((" + column + ")::text = ANY ((ARRAY[" +
    values.map((value) => "'" + value + "'::character varying").join(", ") +
    "])::text[]))",
  candidate:
    "((" + column + ")::text = ANY (ARRAY[" +
    values.map((value) => "('" + value + "'::character varying)::text").join(", ") +
    "]))",
}));

export class CheckRepairError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new CheckRepairError(message);
}

function targetCheck(contract, repair) {
  const checks = contract?.storage?.namespaces?.public?.entries?.table?.[repair.table]?.checks;
  requireMatch(Array.isArray(checks), "修复目标表缺少 CHECK 清单");
  const matches = checks.filter((check) => check.name === repair.name);
  requireMatch(
    matches.length === 1 && matches[0].prefix === undefined &&
      matches[0].expression === repair.expected,
    "修复目标 CHECK 名称、命名方式或原始表达式与真实证据不一致",
  );
  return matches[0];
}

/** 只替换两项已取得真实失败原文的 exact-named PSL 属性，不修改旧文件或生成 JSON。 */
export function buildCheckRepairSource(source, original) {
  requireMatch(
    typeof source === "string" && source.startsWith("// use prisma-8\n") && !source.includes("\r"),
    "修复源必须是已评审的 LF 原生 PSL",
  );
  let candidate = source;
  for (const repair of repairs) {
    targetCheck(original, repair);
    const attribute = (expression) =>
      "  @@check(expression: sql`" + expression + "`", map: " + JSON.stringify(repair.name) + ")";
    const before = attribute(repair.expected);
    requireMatch(
      candidate.split("\n").filter((line) => line === before).length === 1 &&
        candidate.split(before).length === 2,
      "修复源目标属性缺失、重复或原文不一致",
    );
    candidate = candidate.replace(before, attribute(repair.candidate));
  }
  return candidate;
}

/** 官方发射结果只能改变两项谓词与存储标识；该比较不证明实际 PostgreSQL 往返稳定。 */
export function reviewCheckRepairContract(original, candidate) {
  const expected = structuredClone(original);
  for (const repair of repairs) {
    targetCheck(expected, repair).expression = repair.candidate;
  }
  const originalHash = original.storage?.storageHash;
  const candidateHash = candidate?.storage?.storageHash;
  requireMatch(
    typeof originalHash === "string" && /^[a-f0-9]{64}$/u.test(originalHash) &&
      typeof candidateHash === "string" && /^[a-f0-9]{64}$/u.test(candidateHash) &&
      candidateHash !== originalHash,
    "官方新存储标识无效或未变化",
  );
  expected.storage.storageHash = candidateHash;
  requireMatch(
    isDeepStrictEqual(candidate, expected),
    "官方发射结果存在两项 CHECK 谓词及新存储标识之外的变化",
  );
  return {
    status: "NATIVE_CHECK_REPAIR_CONTRACT_REVIEW_REQUIRED",
    originalHash,
    candidateHash,
    changedChecks: repairs.map(({ table, name }) => ({ table, name })),
    roundTripVerified: false,
    migrationPackageGenerated: false,
    signingAllowed: false,
    deploymentAllowed: false,
  };
}
