import { expect, test } from "vite-plus/test";
import { SCADA_SCHEMA_VERSION, parseScadaDocument } from "../src/document.ts";
import { renderSvgPage } from "../src/svg.ts";
import type { TagValue } from "../src/tag-store.ts";

const source = {
  schemaVersion: SCADA_SCHEMA_VERSION,
  projectId: "demo",
  pages: [
    {
      id: "main",
      name: "演示 <svg>",
      size: { width: 500, height: 300 },
      nodes: [
        {
          id: "label",
          type: "label",
          symbolVersion: "1",
          transform: { x: 20, y: 20, width: 180, height: 30, rotation: 0 },
          props: { text: '<script>alert("x")</script>' },
          bindings: {},
          rules: [],
        },
        {
          id: "tank",
          type: "tank",
          symbolVersion: "1",
          transform: { x: 50, y: 80, width: 100, height: 130, rotation: 0 },
          props: {},
          bindings: { level: { tagId: "water.level" } },
          rules: [],
        },
      ],
    },
  ],
};

const document = parseScadaDocument(source);
const tag = (quality: TagValue["quality"], value: TagValue["value"]): TagValue => ({
  tagId: "water.level",
  quality,
  value,
  sequence: 1,
  sourceTimestamp: null,
  serverTimestamp: "2026-11-09T00:00:00.000Z",
});

test("SVG 输出对用户文本进行转义并正确展示 GOOD 读数", () => {
  const svg = renderSvgPage(document, "main", new Map([["water.level", tag("GOOD", 75)]]));
  expect(svg).toMatch(/75%/);
  expect(svg).toMatch(/演示 &lt;svg&gt;/);
  expect(svg).toMatch(/&lt;script&gt;/);
  expect(svg).not.toMatch(/<script>|onload=|onclick=/);
});

test("STALE 和缺失读数不展示为有效实时值", () => {
  const staleSvg = renderSvgPage(document, "main", new Map([["water.level", tag("STALE", 75)]]));
  expect(staleSvg).toMatch(/已过期/);
  expect(staleSvg).not.toMatch(/75%/);
  const unknownSvg = renderSvgPage(document, "main", new Map());
  expect(unknownSvg).toMatch(/异常/);
});

test("未知页面会抛出明确错误", () => {
  expect(() => renderSvgPage(document, "unknown", new Map())).toThrow(/未找到页面/);
});

test("隐藏图元不输出到 SVG，但正常图元与页面仍保留", () => {
  const source = JSON.parse(JSON.stringify(document));
  source.pages[0].nodes.find((node: { id: string }) => node.id === "tank").props.__scadaStudio = {
    visible: false,
  };
  const hidden = parseScadaDocument(source);
  const svg = renderSvgPage(hidden, "main", new Map([["water.level", tag("GOOD", 90)]]));
  expect(svg).toContain('data-node-id="label"');
  expect(svg).not.toContain('data-node-id="tank"');
  expect(svg).not.toContain("90%");
  expect(svg).toContain('aria-label="演示 &lt;svg&gt;"');
});

test("锁定只作用于编辑器，Runtime 仍显示可见的锁定图元", () => {
  const source = JSON.parse(JSON.stringify(document));
  source.pages[0].nodes[1].props.__scadaStudio = { locked: true };
  const locked = parseScadaDocument(source);
  const svg = renderSvgPage(locked, "main", new Map([["water.level", tag("GOOD", 60)]]));
  expect(svg).toContain('data-node-id="tank"');
  expect(svg).toContain("60%");
});
