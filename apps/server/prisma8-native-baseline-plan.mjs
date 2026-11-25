import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { loadMigrationBaseline } from "../../scripts/inspect-prisma8-migration-readiness.mjs";
import { materializeNativeContract, reviewNativeContract } from "../../scripts/prisma8-native-contract-review.mjs";
import { requireDeclarationHashes, reviewRuntimeRelations } from "../../scripts/prisma8-native-runtime-review.mjs";
import { BaselineError, nativeHash, readBaselineInputs, requireBaselineApproval, resolveBaselineCli, runBaselinePlanner } from "../../scripts/prisma8-native-baseline.mjs";

function requireCondition(condition, message) {
  if (!condition) throw new BaselineError(message);
}

let stage = "确认离线授权";

function main() {
  requireBaselineApproval(process.argv.slice(2));
  const root = realpathSync(resolve(import.meta.dirname, "../.."));
  stage = "隔离路径与固定依赖";
  const inputs = readBaselineInputs(root);
  const entry = resolveBaselineCli(root);
  stage = "历史基线及保留候选物理与运行时核对";
  const baseline = loadMigrationBaseline();
  const [source, nativeText, nativeDeclaration] = inputs.native;
  const [formalText, formalDeclaration] = inputs.formal;
  const formal = JSON.parse(formalText);
  const native = JSON.parse(nativeText);
  const status = reviewRuntimeRelations(formal, native);
  requireDeclarationHashes(formalDeclaration, formal);
  requireDeclarationHashes(nativeDeclaration, native);
  const checks = [...baseline.constraints.values()].filter((item) => item.kind === "c").map((item) => {
    const check = native.storage.namespaces.public.entries.table[item.table]?.checks?.find((candidate) => candidate.name === item.name);
    const expression = check?.expression;
    requireCondition(typeof expression === "string" && expression.trim().length > 0 && !expression.includes("`") && !expression.includes("${") && !expression.includes(";") && Array.from(expression).every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), "保留候选 CHECK 表达式超出受控范围");
    return { table: item.table, name: item.name, expression };
  });
  requireCondition(checks.length === 36, "保留候选必须覆盖三十六项历史 CHECK");
  const review = reviewNativeContract(formal, native, baseline, checks);
  requireCondition(review.status === status && review.signingAllowed === false, "保留候选评审状态变化");
  const template = readFileSync(join(root, "apps", "server", "prisma", "native-contract.template.prisma"), "utf8");
  requireCondition(materializeNativeContract(template, baseline, checks) === source, "保留原生 PSL 与候选物理 CHECK 不一致");
  // 使用官方静态入口检查契约可装载性，不创建运行时客户端或连接数据库。
  stage = "官方静态契约装载";
  void contractFromJson(native);
  stage = "独立空起点规划与生成物检查";
  let result;
  let failure;
  try {
    result = runBaselinePlanner(root, inputs, entry);
  } catch (error) {
    failure = error instanceof Error ? error : new BaselineError("离线规划发生未知失败");
  }
  stage = "历史迁移与正式契约复核";
  const after = loadMigrationBaseline();
  requireCondition(isDeepStrictEqual(after.migrations, baseline.migrations) && after.contractHash === baseline.contractHash, "历史迁移或正式契约标识发生变化");
  stage = "独立空起点规划与生成物检查";
  if (failure) throw failure;
  requireCondition(result, "离线基线未产生评审结果");
  stage = "目标快照声明复核";
  requireDeclarationHashes(readFileSync(join(root, ".artifacts", "prisma8-native-baseline", "migrations", "snapshots", nativeHash, "contract.d.ts"), "utf8"), native);
  console.info("离线基线目标存储哈希：" + result.contractHash);
  console.info("保留候选原文指纹：" + result.contractContentHash);
  console.info("官方迁移标识：" + result.migrationHash);
  console.info("计划操作数量：" + result.operations);
  console.info("基线状态：BASELINE_ARTIFACT_REVIEW_REQUIRED；签名许可：否；部署许可：否");
  console.info("物理 DDL、中文注释、操作及依赖解析仍须独立评审");
}

try {
  main();
} catch (error) {
  console.error(error instanceof BaselineError ? error.message : "离线原生基线阶段失败：" + stage + "；保留证据供人工检查");
  process.exitCode = 1;
}
