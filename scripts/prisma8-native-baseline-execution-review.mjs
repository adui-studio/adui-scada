import { isDeepStrictEqual } from "node:util";

export class ExecutionReviewError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new ExecutionReviewError(message);
}

function readChecks(steps) {
  requireMatch(Array.isArray(steps), "迁移检查步骤不是数组");
  return steps.map((step) => {
    requireMatch(
      typeof step?.sql === "string" &&
        step.sql.trim().length > 0 &&
        (step.params === undefined || Array.isArray(step.params)),
      "迁移检查语句或参数形状无效",
    );
    return { sql: step.sql, params: step.params ?? [] };
  });
}

/** 仅从已锁定的操作 JSON 提取检查条件，不解释或执行 SQL。 */
export function reviewExecutionChecks(operations) {
  requireMatch(Array.isArray(operations) && operations.length === 165, "迁移操作总数不一致");
  const seen = new Set();
  const structure = [];
  const missingPrecheck = [];
  const missingPostcheck = [];
  const identicalChecks = [];
  for (const [index, operation] of operations.entries()) {
    const id = operation?.id;
    const comment = index >= 46;
    const pattern = comment
      ? /^comment\.(?:(?:table|index)\.[a-z_][a-z0-9_]*|column\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)$/u
      : /^(?:schema\.public|table\.[a-z_][a-z0-9_]*|(?:index|foreignKey)\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)$/u;
    requireMatch(
      typeof id === "string" &&
        pattern.test(id) &&
        !seen.has(id) &&
        operation.operationClass === "additive" &&
        operation.target?.id === "postgres" &&
        Array.isArray(operation.execute) &&
        operation.execute.length === 1,
      "迁移操作标识、范围或执行步骤不一致",
    );
    seen.add(id);
    const precheck = readChecks(operation.precheck);
    const postcheck = readChecks(operation.postcheck);
    if (precheck.length === 0) missingPrecheck.push(id);
    if (postcheck.length === 0) missingPostcheck.push(id);
    if (postcheck.length > 0 && isDeepStrictEqual(precheck, postcheck)) identicalChecks.push(id);
    // 注释操作只统计检查覆盖，不导出中文注释参数或其他元数据。
    if (!comment) structure.push({ id, precheck, postcheck });
  }
  requireMatch(structure[0]?.id === "schema.public", "迁移首项不是固定 public 命名空间");
  return {
    status: "EXECUTION_CHECK_REVIEW_REQUIRED",
    structuralOperations: structure.length,
    commentOperations: operations.length - structure.length,
    missingPrecheck,
    missingPostcheck,
    identicalChecks,
    structure,
    signingAllowed: false,
    deploymentAllowed: false,
  };
}
