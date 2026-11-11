import { expect, test } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "../src/demo-document.ts";
import { parseServerProjectSaveRequest } from "../src/server-project-contract.ts";

const document = () => JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
const request = () => ({ expectedRevision: null, document: document() });

test("首次服务端版本保存意图接受空修订号且返回独立工程副本", () => {
  const original = request();
  const checked = parseServerProjectSaveRequest(original, original.document.projectId);
  expect(checked.expectedRevision).toBeNull();
  expect(checked.document).toEqual(original.document);
  expect(checked.document).not.toBe(original.document);
  original.document.pages[0].nodes[0].transform.x += 1;
  expect(checked.document.pages[0]?.nodes[0]?.transform.x).not.toBe(
    original.document.pages[0].nodes[0].transform.x,
  );
});

test("更新请求允许有效的正整数预期修订号", () => {
  const original = request();
  const checked = parseServerProjectSaveRequest(
    { ...original, expectedRevision: Number.MAX_SAFE_INTEGER },
    original.document.projectId,
  );
  expect(checked.expectedRevision).toBe(Number.MAX_SAFE_INTEGER);
});

test("拒绝数组、空值与非普通对象请求", () => {
  const projectId = document().projectId;
  for (const input of [null, [], "无效请求", new Date(), Object.create({ document: document() })]) {
    expect(() => parseServerProjectSaveRequest(input, projectId)).toThrow(/普通对象/);
  }
});

test("拒绝缺少字段或携带额外字段的请求", () => {
  const original = request();
  const projectId = original.document.projectId;
  expect(() => parseServerProjectSaveRequest({ document: original.document }, projectId)).toThrow(
    /只允许/,
  );
  expect(() =>
    parseServerProjectSaveRequest({ expectedRevision: null }, projectId),
  ).toThrow(/只允许/);
  for (const extra of ["actorId", "tenantId", "permissions", "published", "revision", "contentHash"]) {
    expect(() => parseServerProjectSaveRequest({ ...original, [extra]: "伪造" }, projectId)).toThrow(
      /只允许/,
    );
  }
});

test("拒绝非法预期修订号且不把字符串修订号隐式转数字", () => {
  const original = request();
  for (const revision of [0, -1, 1.2, "1", undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() =>
      parseServerProjectSaveRequest(
        { ...original, expectedRevision: revision },
        original.document.projectId,
      ),
    ).toThrow(/预期修订号/);
  }
});

test("路由工程 ID 必须合法且与文档工程 ID 完全一致", () => {
  const original = request();
  for (const projectId of ["", "a/b", "../工程", " a", "a?", "a".repeat(129)]) {
    expect(() => parseServerProjectSaveRequest(original, projectId)).toThrow(/路由 ID/);
  }
  expect(() => parseServerProjectSaveRequest(original, "other-project")).toThrow(/不一致/);
});

test("不接受旧版工程 Schema 或不合法的图元字段", () => {
  const original = request();
  const legacy = document();
  legacy.schemaVersion = "0.1.0";
  expect(() =>
    parseServerProjectSaveRequest({ ...original, document: legacy }, original.document.projectId),
  ).toThrow(/schemaVersion/);
  const invalid = document();
  invalid.pages[0].nodes[0].transform.width = 0;
  expect(() =>
    parseServerProjectSaveRequest({ ...original, document: invalid }, original.document.projectId),
  ).toThrow(/width/);
});

test("允许 JSON 解析产生的无原型请求容器", () => {
  const original = request();
  const plain = Object.assign(Object.create(null), original);
  const checked = parseServerProjectSaveRequest(plain, original.document.projectId);
  expect(checked.document).toEqual(original.document);
});

test("按照 UTF-8 字节数拒绝超过 2 MiB 的合法工程保存请求", () => {
  const original = request();
  const template = original.document.pages[0].nodes[0];
  original.document.pages[0].nodes = Array.from({ length: 300 }, (_, index) => ({
    ...template,
    id: `node-${index}`,
    props: { text: "工控".repeat(2500) },
  }));
  expect(() => parseServerProjectSaveRequest(original, original.document.projectId)).toThrow(
    /2 MiB/,
  );
});
