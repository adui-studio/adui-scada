import { expect, test } from "vite-plus/test";
import { parseScadaDocument, SCADA_SCHEMA_VERSION } from "../src/document.ts";

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
