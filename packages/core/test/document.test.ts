import { expect, test } from "vite-plus/test";
import { parseScadaDocument, SCADA_SCHEMA_VERSION } from "../src/document.ts";
import { waterTreatmentDemoDocument } from "../src/demo-document.ts";

function fixture() {
  return {
    schemaVersion: SCADA_SCHEMA_VERSION,
    projectId: "water-demo",
    pages: [
      {
        id: "main",
        name: "水处理系统",
        size: { width: 880, height: 460 },
        nodes: [
          {
            id: "tank",
            type: "tank",
            symbolVersion: "1",
            transform: { x: 20, y: 30, width: 100, height: 160, rotation: 0 },
            props: { title: "水箱 1" },
            bindings: { level: { tagId: "water.level" } },
            rules: [],
          },
        ],
      },
    ],
  };
}

test("验证并复制可跨框架使用的工程文档", () => {
  const source = fixture();
  const parsed = parseScadaDocument(source);
  expect(JSON.parse(JSON.stringify(parsed))).toEqual(source);
  source.pages[0].nodes[0].props.title = "已篡改";
  expect(parsed.pages[0].nodes[0].props.title).toBe("水箱 1");
});

test("拒绝不支持的 Schema 版本和非法图元尺寸", () => {
  const unsupported = fixture() as any;
  unsupported.schemaVersion = "99";
  expect(() => parseScadaDocument(unsupported)).toThrow(/不支持的版本/);
  const invalid = fixture();
  invalid.pages[0].nodes[0].transform.width = Number.POSITIVE_INFINITY;
  expect(() => parseScadaDocument(invalid)).toThrow(/有限数值/);
});

test("拒绝重复的页面或图元 ID 以及不安全的 JSON 属性名", () => {
  const duplicated = fixture();
  duplicated.pages[0].nodes[0].id = "main";
  expect(() => parseScadaDocument(duplicated)).toThrow(/ID 重复/);
  const injected = fixture() as any;
  injected.pages[0].nodes[0].props = JSON.parse('{"__proto__": {"polluted": true}}');
  expect(() => parseScadaDocument(injected)).toThrow(/属性名称不安全/);
});

test("拒绝用户规则中的函数与循环引用", () => {
  const fn = fixture() as any;
  fn.pages[0].nodes[0].rules = [() => "unsafe"];
  expect(() => parseScadaDocument(fn)).toThrow(/不是合法的 JSON 值/);
  const cycle = fixture() as any;
  const recursive: unknown[] = [];
  recursive.push(recursive);
  cycle.pages[0].nodes[0].rules = recursive;
  expect(() => parseScadaDocument(cycle)).toThrow(/循环引用/);
});

test("平面组合标识在 JSON 往返中保留且不改变原有 Tag 绑定", () => {
  const original = parseScadaDocument(waterTreatmentDemoDocument);
  original.pages[0]!.nodes[0]!.groupId = "group-a";
  original.pages[0]!.nodes[1]!.groupId = "group-a";
  const parsed = parseScadaDocument(JSON.parse(JSON.stringify(original)));
  expect(parsed.pages[0]?.nodes[0]?.groupId).toBe("group-a");
  expect(parsed.pages[0]?.nodes[1]?.groupId).toBe("group-a");
  expect(parsed.pages[0]?.nodes.find((node) => node.id === "tank")?.bindings.level?.tagId).toBe(
    "water.level",
  );
  expect(parsed.pages[0]?.nodes[2]?.groupId).toBeUndefined();
  expect(parsed.schemaVersion).toBe(SCADA_SCHEMA_VERSION);
  expect(parseScadaDocument(parsed)).toEqual(parsed);
});

test("组合标识为空、包含不安全字符或非字符串时拒绝导入", () => {
  const document = parseScadaDocument(waterTreatmentDemoDocument);
  document.pages[0]!.nodes[0]!.groupId = "";
  expect(() => parseScadaDocument(document)).toThrow(/稳定 ASCII 标识符/);
  document.pages[0]!.nodes[0]!.groupId = "group/../bad";
  expect(() => parseScadaDocument(document)).toThrow(/稳定 ASCII 标识符/);
  document.pages[0]!.nodes[0]!.groupId = 12 as never;
  expect(() => parseScadaDocument(document)).toThrow(/稳定 ASCII 标识符/);
});

test("拒绝成员不足两个的组合与组合标识和图元 ID 冲突", () => {
  const document = parseScadaDocument(waterTreatmentDemoDocument);
  document.pages[0]!.nodes[0]!.groupId = "group-a";
  expect(() => parseScadaDocument(document)).toThrow(/至少需要两个图元/);
  document.pages[0]!.nodes[1]!.groupId = "group-a";
  expect(parseScadaDocument(document).pages[0]?.nodes[1]?.groupId).toBe("group-a");
  document.pages[0]!.nodes[1]!.groupId = "title";
  document.pages[0]!.nodes[0]!.groupId = "title";
  expect(() => parseScadaDocument(document)).toThrow(/组合 ID .*冲突/);
});

test("拒绝跨页面共用同一个组合 ID", () => {
  const document = parseScadaDocument(waterTreatmentDemoDocument);
  const first = document.pages[0]!;
  first.nodes[0]!.groupId = "group-a";
  first.nodes[1]!.groupId = "group-a";
  document.pages.push({
    id: "other",
    name: "备用画面",
    size: { ...first.size },
    nodes: [
      { ...first.nodes[0]!, id: "other-title", groupId: "group-a" },
      { ...first.nodes[1]!, id: "other-tank", groupId: "group-a" },
    ],
  });
  expect(() => parseScadaDocument(document)).toThrow(/不能跨页面/);
});
