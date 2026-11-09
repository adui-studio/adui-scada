import test from "node:test";
import assert from "node:assert/strict";
import { parseScadaDocument } from "../src/document.ts";
import { renderSvgPage } from "../src/svg.ts";
import type { TagValue } from "../src/tag-store.ts";

const source = {
  schemaVersion: "0.1.0",
  projectId: "demo",
  pages: [
    {
      id: "main",
      name: "Demo <svg>",
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

void test("SVG output escapes user strings and uses the explicit GOOD value", () => {
  const svg = renderSvgPage(document, "main", new Map([["water.level", tag("GOOD", 75)]]));
  assert.match(svg, /75%/);
  assert.match(svg, /Demo &lt;svg&gt;/);
  assert.match(svg, /&lt;script&gt;/);
  assert.doesNotMatch(svg, /<script>|onload=|onclick=/);
});

void test("STALE and missing values do not appear as live measurements", () => {
  const staleSvg = renderSvgPage(document, "main", new Map([["water.level", tag("STALE", 75)]]));
  assert.match(staleSvg, /STALE/);
  assert.doesNotMatch(staleSvg, /75%/);
  const unknownSvg = renderSvgPage(document, "main", new Map());
  assert.match(unknownSvg, /BAD/);
});

void test("unknown page fails visibly", () => {
  assert.throws(() => renderSvgPage(document, "unknown", new Map()), /Unknown page/);
});
