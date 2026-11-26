import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { reviewCheckRepairContract } from "./prisma8-native-check-repair.mjs";

export const repairHash = "9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436";
export const repairDirectory = "prisma8-native-check-repair-package";
export const repairSlug = "scada_native_check_repair";
export const repairInputHashes = {
  "contract.prisma": "777908921c4bb89f82a9f65785f4879d225fb644c9a731dc2b88345fc500812f",
  "contract.json": "715e66ae145d69dbce57c56ddad7bf8cb4569b5ae047abc9bd9ffd73d8e0887d",
  "contract.d.ts": "39a9013bff8229bcd20fec1cb9e02b52baea9be316248fcb4c8d79103a26b599",
};

export class RepairPackageError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new RepairPackageError(message);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 仅允许维护者已经实际发射并验收的三份契约原文。 */
export function requireRepairInputs(files) {
  for (const [name, hash] of Object.entries(repairInputHashes)) {
    requireMatch(Buffer.isBuffer(files[name]) && digest(files[name]) === hash, "修复契约文件指纹不一致：" + name);
  }
  const contract = JSON.parse(files["contract.json"].toString("utf8"));
  requireMatch(contract.storage?.storageHash === repairHash, "修复契约存储标识不一致");
  return contract;
}

/** 比较全量结构操作，只允许两张目标表的已知谓词文字变化。 */
export function reviewRepairStructure(originalContract, candidateContract, original, candidate) {
  const review = reviewCheckRepairContract(originalContract, candidateContract);
  requireMatch(review.candidateHash === repairHash, "结构操作不是已验收修复契约");
  requireMatch(
    Array.isArray(original) && Array.isArray(candidate) &&
      original.length === 46 && candidate.length === 46 &&
      new Set(original.map(({ id }) => id)).size === 46,
    "修复前后结构操作数量或标识不一致",
  );
  const previousTables = originalContract.storage.namespaces.public.entries.table;
  const nextTables = candidateContract.storage.namespaces.public.entries.table;
  const changed = new Map(review.changedChecks.map(({ table, name }) => {
    const before = previousTables[table].checks.find((check) => check.name === name).expression;
    const after = nextTables[table].checks.find((check) => check.name === name).expression;
    return ["table." + table, { before, after }];
  }));
  const observed = [];
  for (const [index, operation] of original.entries()) {
    const replacement = changed.get(operation.id);
    let expected = operation;
    if (replacement) {
      const { before, after } = replacement;
      const sql = operation.execute?.[0]?.sql;
      requireMatch(typeof sql === "string" && sql.split(before).length === 2, "原结构操作目标谓词缺失或重复");
      expected = JSON.parse(JSON.stringify(operation).replaceAll(before, () => after));
      observed.push(operation.id);
    }
    requireMatch(isDeepStrictEqual(candidate[index], expected), "结构操作存在未批准的变化：" + operation.id);
  }
  requireMatch(observed.length === 2, "两项目标结构操作未完整覆盖");
  return observed;
}

/** 生成独立文件证据指纹，不将本地指纹冒充 Prisma 官方迁移标识。 */
export function fingerprintRepairPackage(files, configs, migrationHash) {
  requireMatch(typeof migrationHash === "string" && /^(?:sha256:)?[a-f0-9]{64}$/u.test(migrationHash), "官方新迁移标识无效");
  const entries = (values) => Object.entries(values)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: digest(bytes) }));
  const evidence = {
    scope: "PRISMA8_NATIVE_CHECK_REPAIR_PACKAGE_V1",
    contractHash: repairHash,
    migrationHash,
    configs: entries(configs),
    files: entries(files),
  };
  return { ...evidence, fingerprint: digest(JSON.stringify(evidence)) };
}
