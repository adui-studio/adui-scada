import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { parseScadaDocument, SCADA_SCHEMA_VERSION } from "../src/document.ts";

function fixture() {
  return {
    schemaVersion: SCADA_SCHEMA_VERSION,
    projectId: "water-demo",
    pages: [
      {
        id: "main",
        name: "Water treatment",
        size: { width: 880, height: 460 },
        nodes: [
          {
            id: "tank",
            type: "tank",
            symbolVersion: "1",
            transform: { x: 20, y: 30, width: 100, height: 160, rotation: 0 },
            props: { title: "Tank 1" },
            bindings: { level: { tagId: "water.level" } },
            rules: [],
          },
        ],
      },
    ],
  };
}

void test("validates and clones a portable document", () => {
  const source = fixture();
  const parsed = parseScadaDocument(source);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), source);
  source.pages[0].nodes[0].props.title = "Tampered";
  assert.equal(parsed.pages[0].nodes[0].props.title, "Tank 1");
});

void test("rejects unsupported schema and invalid geometry", () => {
  const unsupported = fixture() as any;
  unsupported.schemaVersion = "99";
  assert.throws(() => parseScadaDocument(unsupported), /unsupported version/);
  const invalid = fixture();
  invalid.pages[0].nodes[0].transform.width = Number.POSITIVE_INFINITY;
  assert.throws(() => parseScadaDocument(invalid), /finite number/);
});

void test("rejects duplicate page/node ID and unsafe JSON keys", () => {
  const duplicated = fixture();
  duplicated.pages[0].nodes[0].id = "main";
  assert.throws(() => parseScadaDocument(duplicated), /duplicate ID/);
  const injected = fixture() as any;
  injected.pages[0].nodes[0].props = JSON.parse('{"__proto__": {"polluted": true}}');
  assert.throws(() => parseScadaDocument(injected), /unsafe property key/);
});

void test("rejects functions and cycles in user-defined rules", () => {
  const fn = fixture() as any;
  fn.pages[0].nodes[0].rules = [() => "unsafe"];
  assert.throws(() => parseScadaDocument(fn), /not a JSON value/);
  const cycle = fixture() as any;
  const recursive: unknown[] = [];
  recursive.push(recursive);
  cycle.pages[0].nodes[0].rules = recursive;
  assert.throws(() => parseScadaDocument(cycle), /cyclic value/);
});
