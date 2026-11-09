import { expect, test } from "vite-plus/test";
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

test("validates and clones a portable document", () => {
  const source = fixture();
  const parsed = parseScadaDocument(source);
  expect(JSON.parse(JSON.stringify(parsed))).toEqual(source);
  source.pages[0].nodes[0].props.title = "Tampered";
  expect(parsed.pages[0].nodes[0].props.title).toBe("Tank 1");
});

test("rejects unsupported schema and invalid geometry", () => {
  const unsupported = fixture() as any;
  unsupported.schemaVersion = "99";
  expect(() => parseScadaDocument(unsupported)).toThrow(/unsupported version/);
  const invalid = fixture();
  invalid.pages[0].nodes[0].transform.width = Number.POSITIVE_INFINITY;
  expect(() => parseScadaDocument(invalid)).toThrow(/finite number/);
});

test("rejects duplicate page/node ID and unsafe JSON keys", () => {
  const duplicated = fixture();
  duplicated.pages[0].nodes[0].id = "main";
  expect(() => parseScadaDocument(duplicated)).toThrow(/duplicate ID/);
  const injected = fixture() as any;
  injected.pages[0].nodes[0].props = JSON.parse('{"__proto__": {"polluted": true}}');
  expect(() => parseScadaDocument(injected)).toThrow(/unsafe property key/);
});

test("rejects functions and cycles in user-defined rules", () => {
  const fn = fixture() as any;
  fn.pages[0].nodes[0].rules = [() => "unsafe"];
  expect(() => parseScadaDocument(fn)).toThrow(/not a JSON value/);
  const cycle = fixture() as any;
  const recursive: unknown[] = [];
  recursive.push(recursive);
  cycle.pages[0].nodes[0].rules = recursive;
  expect(() => parseScadaDocument(cycle)).toThrow(/cyclic value/);
});
