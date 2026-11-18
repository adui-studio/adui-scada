import { expect, test } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "../src/demo-document.ts";
import { parseScadaDocument } from "../src/document.ts";
import { validateProjectReleasePreflight } from "../src/release-preflight.ts";

const source = () => parseScadaDocument(waterTreatmentDemoDocument);

test("已支持的演示工程通过静态运行兼容性预检且原文档不变", () => {
  const document = source();
  const before = JSON.stringify(document);
  expect(validateProjectReleasePreflight(document)).toEqual({ passed: true, issues: [] });
  expect(JSON.stringify(document)).toBe(before);
});

test("结构非法优先返回已有带字段路径的 Schema 错误", () => {
  const document = source();
  document.pages[0]!.nodes[0]!.transform.width = 0;
  expect(validateProjectReleasePreflight(document)).toMatchObject({
    passed: false,
    issues: [{ code: "DOCUMENT_INVALID", path: "pages[0].nodes[0].transform.width" }],
  });
});

test("旧版工程只能先走显式迁移，预检不隐式升级", () => {
  const document = { ...source(), schemaVersion: "0.2.0" };
  expect(validateProjectReleasePreflight(document)).toMatchObject({
    passed: false,
    issues: [{ code: "DOCUMENT_INVALID", path: "schemaVersion" }],
  });
  expect(document.schemaVersion).toBe("0.2.0");
});

test("未知图元即使隐藏也不能被误认为当前运行时可渲染", () => {
  const document = source();
  const node = document.pages[0]!.nodes[0]!;
  node.type = "future-gauge";
  node.props.__scadaStudio = { visible: false };
  expect(validateProjectReleasePreflight(document)).toMatchObject({
    passed: false,
    issues: [{ code: "UNSUPPORTED_SYMBOL", path: "pages[0].nodes[0].type" }],
  });
});

test("内置图元未知版本必须显式拒绝而非忽略 symbolVersion", () => {
  const document = source();
  document.pages[0]!.nodes[0]!.symbolVersion = "2";
  expect(validateProjectReleasePreflight(document)).toMatchObject({
    passed: false,
    issues: [{ code: "UNSUPPORTED_SYMBOL_VERSION", path: "pages[0].nodes[0].symbolVersion" }],
  });
});

test("已绑定的历史待确认 Tag 类型会阻止发布预检", () => {
  const document = source();
  document.tags = document.tags.map((tag) =>
    tag.tagId === "water.level" ? { ...tag, dataType: "unknown" as const } : tag,
  );
  expect(validateProjectReleasePreflight(document)).toMatchObject({
    passed: false,
    issues: [
      {
        code: "UNRESOLVED_BOUND_TAG",
        path: "pages[0].nodes[1].bindings.level.tagId",
      },
    ],
  });
});

test("未绑定的待确认 Tag 不改变当前 SVG 图元运行兼容性", () => {
  const document = source();
  document.tags.push({
    tagId: "unused.legacy",
    displayName: "未绑定历史 Tag",
    dataType: "unknown",
    unit: null,
    description: "尚未被任何图元使用",
  });
  expect(validateProjectReleasePreflight(document)).toEqual({ passed: true, issues: [] });
});

test("对管道添加合法但运行时不消费的绑定槽必须明确拒绝", () => {
  const document = source();
  const pipe = document.pages[0]!.nodes.find((node) => node.type === "pipe")!;
  pipe.bindings.level = { tagId: "water.level" };
  expect(validateProjectReleasePreflight(document)).toMatchObject({
    passed: false,
    issues: [{ code: "UNSUPPORTED_BINDING_SLOT", path: "pages[0].nodes[2].bindings.level" }],
  });
});

test("非空图元规则虽然符合 JSON Schema，仍须等待规则运行能力", () => {
  const document = source();
  document.pages[0]!.nodes[0]!.rules = [{ expression: "water.level > 50" }];
  expect(validateProjectReleasePreflight(document)).toMatchObject({
    passed: false,
    issues: [{ code: "UNSUPPORTED_RULES", path: "pages[0].nodes[0].rules" }],
  });
});

test("多个问题逐项以稳定路径返回，且不能影响其他图元与源数据", () => {
  const document = source();
  const first = document.pages[0]!.nodes[0]!;
  const second = document.pages[0]!.nodes[1]!;
  first.symbolVersion = "2";
  first.rules = [{ kind: "future" }];
  second.bindings.future = { tagId: "water.level" };
  const before = JSON.stringify(document);
  const result = validateProjectReleasePreflight(document);
  expect(result.passed).toBe(false);
  expect(result.issues.map((issue) => [issue.code, issue.path])).toEqual([
    ["UNSUPPORTED_SYMBOL_VERSION", "pages[0].nodes[0].symbolVersion"],
    ["UNSUPPORTED_RULES", "pages[0].nodes[0].rules"],
    ["UNSUPPORTED_BINDING_SLOT", "pages[0].nodes[1].bindings.future"],
  ]);
  expect(JSON.stringify(document)).toBe(before);
});
