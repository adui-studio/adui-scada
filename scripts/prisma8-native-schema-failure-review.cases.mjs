import assert from "node:assert/strict";
import { test } from "node:test";
import {
  maxSchemaFailureBytes,
  reviewNativeSchemaFailure,
} from "./prisma8-native-schema-failure-review.mjs";

const allowed = new Set(["database", "public", "scada_projects", "id"]);
const code = "MIGRATION.SCHEMA_VERIFY_FAILED";
const issue = {
  path: ["database", "public", "scada_projects", "id"],
  expected: { value: "敏感期望值" },
  actual: { value: "敏感实际值" },
  explanation: { cause: "differs", text: "敏感解释" },
};

function direct(issues) {
  return {
    ok: false,
    severity: "error",
    code,
    meta: { schemaIssues: issues },
    summary: "敏感摘要",
  };
}

function result(error) {
  return {
    kind: "result",
    commandId: "db.migrate",
    envelope: { commandId: "db.migrate", ok: false, error },
  };
}

void test("直接错误封装区分缺失、额外和不一致且不输出原始值", () => {
  const report = reviewNativeSchemaFailure(
    JSON.stringify(
      direct([
        issue,
        { path: ["database", "public", "scada_projects"], expected: {} },
        {
          path: ["database", "public", "未知私有表"],
          actual: {},
          explanation: { cause: "possibly-equivalent" },
        },
      ]),
    ),
    allowed,
  );
  assert.equal(report.detailsAvailable, true);
  assert.equal(report.issueCount, 3);
  assert.deepEqual(
    report.issues.map((item) => item.outcome),
    ["not-equal", "not-found", "not-expected"],
  );
  assert.deepEqual(report.issues[2], {
    path: ["database", "public", "[已脱敏]"],
    outcome: "not-expected",
    cause: "possibly-equivalent",
  });
  assert.equal(report.signingAllowed, false);
  assert.equal(report.deploymentAllowed, false);
  assert.doesNotMatch(JSON.stringify(report), /敏感|未知私有表/u);
});

void test("支持逐行机器事件和最终结果错误封装", () => {
  const output = [
    JSON.stringify({ kind: "event", code }),
    "第三方普通输出",
    JSON.stringify(result(direct([issue]))),
  ].join("\n");
  const report = reviewNativeSchemaFailure(output, allowed);
  assert.equal(report.issueCount, 1);
  assert.deepEqual(report.issues[0].path, issue.path);
});

void test("支持最终结果中的诊断数组且不接收其他错误码", () => {
  const document = result(undefined);
  const output = JSON.stringify({
    ...document,
    envelope: {
      ...document.envelope,
      diagnostics: [{ code: "OTHER.ERROR" }, direct([issue])],
    },
  });
  assert.equal(reviewNativeSchemaFailure(output, allowed).issueCount, 1);
});

void test("缺失或空差异列表与取得结构差异明确区分", () => {
  for (const [issues, count] of [
    [undefined, null],
    [[], 0],
  ]) {
    const report = reviewNativeSchemaFailure(JSON.stringify(direct(issues)), allowed);
    assert.equal(report.detailsAvailable, false);
    assert.equal(report.issueCount, count);
    assert.deepEqual(report.issues, []);
    assert.equal(report.deploymentAllowed, false);
  }
});

void test("拒绝错误命令、成功结果、非目标错误和不唯一封装", () => {
  for (const document of [
    { ...direct([issue]), commandId: "db.verify" },
    { ...direct([issue]), ok: true },
    { ...direct([issue]), severity: "warning" },
    { ...direct([issue]), code: "MIGRATION.EXECUTION_FAILED" },
    { ...result(direct([issue])), commandId: "db.sign" },
    {
      ...result(direct([issue])),
      envelope: { ...result(direct([issue])).envelope, ok: true },
    },
  ]) {
    assert.throws(() => reviewNativeSchemaFailure(JSON.stringify(document), allowed), /唯一匹配/u);
  }
  const line = JSON.stringify(direct([issue]));
  assert.throws(() => reviewNativeSchemaFailure(line + "\n" + line, allowed), /唯一匹配/u);
  assert.throws(() => reviewNativeSchemaFailure("不是机器结果", allowed), /唯一匹配/u);
});

void test("最终错误及诊断也拒绝错误命令、警告、成功或重复记录", () => {
  for (const diagnostic of [
    { ...direct([issue]), commandId: "db.verify" },
    { ...direct([issue]), severity: "warning" },
    { ...direct([issue]), ok: true },
  ]) {
    const document = result(diagnostic);
    assert.throws(() => reviewNativeSchemaFailure(JSON.stringify(document), allowed), /唯一匹配/u);
    const onlyDiagnostic = result(undefined);
    assert.throws(
      () =>
        reviewNativeSchemaFailure(
          JSON.stringify({
            ...onlyDiagnostic,
            envelope: { ...onlyDiagnostic.envelope, diagnostics: [diagnostic] },
          }),
          allowed,
        ),
      /唯一匹配/u,
    );
  }
  const document = result(direct([issue]));
  assert.throws(
    () =>
      reviewNativeSchemaFailure(
        JSON.stringify({
          ...document,
          envelope: { ...document.envelope, diagnostics: [direct([issue])] },
        }),
        allowed,
      ),
    /唯一匹配/u,
  );
});

void test("拒绝畸形差异及超限输入，不泄露诊断文本", () => {
  for (const issues of [
    null,
    {},
    [null],
    [{ path: ["public"] }],
    [{ ...issue, expected: null }],
    [{ ...issue, path: [1] }],
    [{ ...issue, path: [] }],
    [{ ...issue, path: Array(33).fill("public") }],
    Array(1001).fill(issue),
  ]) {
    assert.throws(
      () => reviewNativeSchemaFailure(JSON.stringify(direct(issues)), allowed),
      /结构差异/u,
    );
  }
  assert.throws(
    () => reviewNativeSchemaFailure("x".repeat(maxSchemaFailureBytes + 1), allowed),
    /大小限制/u,
  );
  const report = reviewNativeSchemaFailure(
    JSON.stringify(direct([{ ...issue, explanation: { cause: "敏感解释类别" } }])),
    allowed,
  );
  assert.equal(report.issues[0].cause, null);
  assert.doesNotMatch(JSON.stringify(report), /敏感/u);
});
