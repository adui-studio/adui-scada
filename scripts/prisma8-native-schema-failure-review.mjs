export const maxSchemaFailureBytes = 16 * 1024 * 1024;
const failureCode = "MIGRATION.SCHEMA_VERIFY_FAILED";
const commandId = "db.migrate";

export class NativeSchemaFailureReviewError extends Error {}

function requireMatch(condition, message) {
  if (!condition) throw new NativeSchemaFailureReviewError(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readDocuments(output) {
  requireMatch(
    typeof output === "string" && Buffer.byteLength(output, "utf8") <= maxSchemaFailureBytes,
    "迁移诊断输入无效或超过大小限制",
  );
  try {
    return [JSON.parse(output)];
  } catch {
    // 官方机器输出也可能为逐行事件；不输出无法解析的原文。
    return output.split(/\r?\n/u).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  }
}

function matchingFailures(document) {
  if (
    document?.ok === false &&
    document.severity === "error" &&
    document.code === failureCode &&
    (document.commandId === undefined || document.commandId === commandId)
  ) {
    return [document];
  }
  const envelope = document?.envelope;
  if (
    document?.kind !== "result" ||
    document.commandId !== commandId ||
    envelope?.commandId !== commandId ||
    envelope.ok !== false
  ) {
    return [];
  }
  return [
    envelope.error,
    ...(Array.isArray(envelope.diagnostics) ? envelope.diagnostics : []),
  ].filter(
    (diagnostic) =>
      isRecord(diagnostic) &&
      diagnostic.code === failureCode &&
      (diagnostic.commandId === undefined || diagnostic.commandId === commandId) &&
      (diagnostic.ok === undefined || diagnostic.ok === false) &&
      (diagnostic.severity === undefined || diagnostic.severity === "error"),
  );
}

function summarizeIssue(issue, allowedNames) {
  const expected = issue?.expected;
  const actual = issue?.actual;
  const path = issue?.path;
  requireMatch(
    isRecord(issue) &&
      Array.isArray(path) &&
      path.length > 0 &&
      path.length <= 32 &&
      path.every((segment) => typeof segment === "string") &&
      (expected === undefined || isRecord(expected)) &&
      (actual === undefined || isRecord(actual)) &&
      (expected !== undefined || actual !== undefined),
    "官方结构差异条目形状无效",
  );
  const cause = issue.explanation?.cause;
  return {
    path: path.map((segment) => (allowedNames.has(segment) ? segment : "[已脱敏]")),
    outcome:
      expected === undefined ? "not-expected" : actual === undefined ? "not-found" : "not-equal",
    cause: cause === "differs" || cause === "possibly-equivalent" ? cause : null,
  };
}

/** 只从唯一匹配的官方失败封装提取结构路径、差异类别和解释类别，不认证输入来源。 */
export function reviewNativeSchemaFailure(output, allowedNames) {
  const failures = readDocuments(output).flatMap(matchingFailures);
  requireMatch(failures.length === 1, "未取得唯一匹配的原生迁移结构失败封装");
  const issues = failures[0].meta?.schemaIssues;
  requireMatch(
    issues === undefined || (Array.isArray(issues) && issues.length <= 1000),
    "官方结构差异列表形状无效或超过数量限制",
  );
  const details = issues?.map((issue) => summarizeIssue(issue, allowedNames)) ?? [];
  return {
    status: "NATIVE_SCHEMA_FAILURE_REVIEW_REQUIRED",
    code: failureCode,
    detailsAvailable: details.length > 0,
    issueCount: issues === undefined ? null : issues.length,
    issues: details,
    signingAllowed: false,
    deploymentAllowed: false,
  };
}
