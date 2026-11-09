import { expect, test } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "../src/demo-document.ts";
import { DocumentEditor, withNodePosition } from "../src/editor.ts";

function editor() {
  return new DocumentEditor(waterTreatmentDemoDocument);
}

test("select, drag, undo and redo preserve document and bindings", () => {
  const e = editor();
  e.select("tank");
  const original = e.snapshot();
  expect(e.moveSelected(160.5, 140.5)).toBe(true);
  const moved = e.snapshot();
  const node = moved.document.pages[0]?.nodes.find((n) => n.id === "tank");
  expect(node?.transform.x).toBe(161);
  expect(node?.transform.y).toBe(141);
  expect(node?.bindings.level?.tagId).toBe("water.level");
  expect(moved.canUndo).toBe(true);
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document).toEqual(original.document);
  expect(e.redo()).toBe(true);
  expect(e.snapshot().document).toEqual(moved.document);
});

test("no-op movement does not create history; new command clears redo", () => {
  const e = editor();
  e.select("tank");
  expect(e.moveSelected(80, 125)).toBe(false);
  expect(e.snapshot().canUndo).toBe(false);
  e.moveSelected(100, 130);
  e.undo();
  expect(e.snapshot().canRedo).toBe(true);
  e.moveSelected(120, 130);
  expect(e.snapshot().canRedo).toBe(false);
});

test("movement validates coordinates and clamps to canvas", () => {
  const e = editor();
  e.select("tank");
  expect(() => e.moveSelected(Number.POSITIVE_INFINITY, 0)).toThrow(/finite/);
  expect(e.snapshot().canUndo).toBe(false);
  expect(e.moveSelected(-999, 999)).toBe(true);
  const node = e.snapshot().document.pages[0]?.nodes.find((n) => n.id === "tank");
  expect(node?.transform.x).toBe(0);
  expect(node?.transform.y).toBe(255);
  expect(() => e.select("missing")).toThrow(/Unknown node/);
});

test("label changes are reversible and HTML-like text stays data", () => {
  const e = editor();
  e.select("title");
  e.setSelectedLabel("<script>alert(1)</script>");
  expect(e.snapshot().document.pages[0]?.nodes[0]?.props.text).toBe("<script>alert(1)</script>");
  e.undo();
  expect(e.snapshot().document.pages[0]?.nodes[0]?.props.text).toBe("Water Treatment / V0.1");
  expect(() => e.setSelectedLabel("x".repeat(257))).toThrow(/256/);
});

test("invalid import is atomic, valid JSON round-trips between sessions", () => {
  const a = editor();
  a.select("pump");
  a.moveSelected(560, 170);
  const encoded = JSON.stringify(a.snapshot().document);
  const b = editor();
  b.loadDocument(JSON.parse(encoded));
  expect(b.snapshot().document).toEqual(a.snapshot().document);
  expect(b.snapshot().selectedId).toBeNull();
  const before = b.snapshot();
  expect(() => b.loadDocument({ projectId: "bad" })).toThrow(/schemaVersion/);
  expect(b.snapshot()).toEqual(before);
});

test("editor snapshot is defensive and preview never changes history", () => {
  const e = editor();
  const copy = e.snapshot();
  copy.document.pages[0]!.nodes[0]!.props.text = "mutated";
  expect(e.snapshot().document.pages[0]?.nodes[0]?.props.text).toBe("Water Treatment / V0.1");
  const preview = withNodePosition(e.snapshot().document, "pump", 550, 190);
  expect(preview.pages[0]?.nodes.find((n) => n.id === "pump")?.transform.x).toBe(550);
  expect(e.snapshot().canUndo).toBe(false);
});

test("history keeps at most 100 move commands", () => {
  const e = editor();
  e.select("tank");
  for (let i = 1; i <= 105; i++) {
    expect(e.moveSelected(80 + i, 125)).toBe(true);
  }
  let undos = 0;
  while (e.undo()) undos++;
  expect(undos).toBe(100);
  const node = e.snapshot().document.pages[0]?.nodes.find((n) => n.id === "tank");
  expect(node?.transform.x).toBe(85);
});

test("only label nodes can update static text", () => {
  const e = editor();
  e.select("pump");
  expect(() => e.setSelectedLabel("unsafe")).toThrow(/Select a label/);
  expect(e.snapshot().canUndo).toBe(false);
});
