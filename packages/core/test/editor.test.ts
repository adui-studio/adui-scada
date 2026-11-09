import { expect, test } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "../src/demo-document.ts";
import { DocumentEditor, findNodesInRect, withNodePosition, withNodesTranslated } from "../src/editor.ts";

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

test("add symbol uses stable IDs, no device binding, and undo/redo preserves JSON", () => {
  const e = editor();
  expect(e.addNode("label")).toBe("label-1");
  const first = e.snapshot();
  const newNode = first.document.pages[0]?.nodes.at(-1);
  expect(newNode?.type).toBe("label");
  expect(Object.keys(newNode?.bindings ?? {})).toEqual([]);
  expect(first.selectedIds).toEqual(["label-1"]);
  expect(e.addNode("label")).toBe("label-2");
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.some((n) => n.id === "label-2")).toBe(false);
  expect(e.redo()).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.at(-1)?.id).toBe("label-2");
  expect(() => e.addNode("html" as never)).toThrow(/Unsupported/);
});

test("multiselect toggles, group movement and bounded preview are coherent", () => {
  const e = editor();
  e.select("tank");
  e.select("pump", true);
  expect(e.snapshot().selectedIds).toEqual(["tank", "pump"]);
  expect(e.moveBy(10, 20)).toBe(true);
  const moved = e.snapshot().document.pages[0]?.nodes ?? [];
  expect(moved.find((n) => n.id === "tank")?.transform.x).toBe(90);
  expect(moved.find((n) => n.id === "pump")?.transform.x).toBe(510);
  expect(moved.find((n) => n.id === "tank")?.transform.y).toBe(145);
  const preview = withNodesTranslated(e.snapshot().document, ["tank", "pump"], 10000, 10000);
  expect(preview.pages[0]?.nodes.find((n) => n.id === "pump")?.transform.x).toBe(770);
  expect(preview.pages[0]?.nodes.find((n) => n.id === "tank")?.transform.x).toBe(350);
  e.select("tank", true);
  expect(e.snapshot().selectedIds).toEqual(["pump"]);
  e.select(null);
  expect(e.snapshot().selectedIds).toEqual([]);
});

test("group translation rejects invalid IDs, duplicate selection and invalid coordinates", () => {
  const doc = editor().snapshot().document;
  expect(() => withNodesTranslated(doc, ["missing"], 2, 2)).toThrow(/Unknown/);
  expect(() => withNodesTranslated(doc, ["tank", "tank"], 2, 2)).toThrow(/Duplicate/);
  expect(() => withNodesTranslated(doc, ["tank"], Number.NaN, 2)).toThrow(/finite/);
  expect(doc.pages[0]?.nodes.find((n) => n.id === "tank")?.transform.x).toBe(80);
});

test("alignment applies one undoable command to selected nodes", () => {
  const e = editor();
  e.select("tank");
  e.select("pump", true); // Pump is alignment anchor.
  expect(e.alignSelected("left")).toBe(true);
  const after = e.snapshot().document.pages[0]?.nodes ?? [];
  expect(after.find((n) => n.id === "tank")?.transform.x).toBe(500);
  expect(after.find((n) => n.id === "pump")?.transform.x).toBe(500);
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.find((n) => n.id === "tank")?.transform.x).toBe(80);
  expect(e.alignSelected("hcenter")).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.find((n) => n.id === "tank")?.transform.x).toBe(480);
});

test("layer reordering preserves selected order and supports undo", () => {
  const e = editor();
  e.select("tank");
  e.select("pipe", true);
  expect(e.reorderSelected("front")).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.map((n) => n.id)).toEqual([
    "title", "pump", "flow", "tank", "pipe",
  ]);
  expect(e.reorderSelected("front")).toBe(false);
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.map((n) => n.id)).toEqual([
    "title", "tank", "pipe", "pump", "flow",
  ]);
  expect(e.reorderSelected("back")).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.slice(0, 2).map((n) => n.id)).toEqual([
    "tank", "pipe",
  ]);
});

test("delete selection is atomic, undo restores nodes, and export stays compatible", () => {
  const e = editor();
  e.select("tank");
  e.select("pump", true);
  const before = e.snapshot().document;
  expect(e.deleteSelected()).toBe(true);
  expect(e.snapshot().selectedIds).toEqual([]);
  expect(e.snapshot().document.pages[0]?.nodes.length).toBe(3);
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document).toEqual(before);
  const imported = editor();
  imported.loadDocument(JSON.parse(JSON.stringify(e.snapshot().document)));
  expect(imported.snapshot().document).toEqual(before);
});

test("new node IDs remain unique across delete and import and no-ops do not create history", () => {
  const e = editor();
  e.addNode("pump", -100, 10000);
  const node = e.snapshot().document.pages[0]?.nodes.at(-1);
  expect(node?.transform.x).toBe(0);
  expect(node?.transform.y).toBe(350);
  e.deleteSelected();
  expect(e.addNode("pump")).toBe("pump-1");
  expect(e.reorderSelected("front")).toBe(false);
  e.select(null);
  expect(e.alignSelected("top")).toBe(false);
  expect(e.deleteSelected()).toBe(false);
});

test("fractional positions never move outside the page when bounded displacement is fractional", () => {
  const document = editor().snapshot().document;
  const tank = document.pages[0]?.nodes.find((node) => node.id === "tank");
  if (!tank) throw new Error("Missing tank fixture");
  // Remaining permitted horizontal displacement is just 0.3 units.
  tank.transform.x = 729.7;
  const moved = withNodesTranslated(document, ["tank"], 1, 0);
  const x = moved.pages[0]?.nodes.find((node) => node.id === "tank")?.transform.x;
  expect(x).toBe(730);
  expect(x! + tank.transform.width).toBeLessThanOrEqual(880);
});

test("layer forward/backward swaps one position and no-ops at the edge", () => {
  const e = editor();
  e.select("title");
  expect(e.reorderSelected("backward")).toBe(false);
  expect(e.reorderSelected("forward")).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.map((node) => node.id).slice(0, 2)).toEqual([
    "tank", "title",
  ]);
  expect(e.reorderSelected("backward")).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes[0]?.id).toBe("title");
});

test("marquee hit testing handles reversed corners, empty rectangles and whole canvas", () => {
  const document = editor().snapshot().document;
  expect(findNodesInRect(document, 70, 120, 225, 335)).toEqual(["tank"]);
  expect(findNodesInRect(document, 225, 335, 70, 120)).toEqual(["tank"]);
  expect(findNodesInRect(document, 100, 100, 100, 200)).toEqual([]);
  expect(findNodesInRect(document, 0, 0, 880, 460)).toEqual([
    "title",
    "tank",
    "pipe",
    "pump",
    "flow",
  ]);
});

test("marquee uses rotated axis-aligned bounds rather than ignoring rotation", () => {
  const document = editor().snapshot().document;
  const tank = document.pages[0]?.nodes.find((node) => node.id === "tank");
  if (!tank) throw new Error("Missing tank fixture");
  tank.transform.rotation = 90;
  expect(findNodesInRect(document, 50, 220, 60, 230)).toEqual(["tank"]);
});

test("marquee rejects non-finite coordinates without touching editor history", () => {
  const e = editor();
  const before = e.snapshot();
  expect(() => findNodesInRect(before.document, Number.NaN, 0, 300, 300)).toThrow(/finite/);
  expect(() => findNodesInRect(before.document, 0, Number.POSITIVE_INFINITY, 300, 300)).toThrow(
    /finite/,
  );
  expect(e.snapshot()).toEqual(before);
});

test("bulk selection validates atomically, preserves order and never changes project JSON", () => {
  const e = editor();
  const original = e.snapshot().document;
  e.selectMany(["tank", "pump"]);
  expect(e.snapshot().selectedIds).toEqual(["tank", "pump"]);
  e.selectMany(["pump", "title"], true);
  expect(e.snapshot().selectedIds).toEqual(["tank", "pump", "title"]);
  expect(e.snapshot().selectedId).toBe("title");
  expect(() => e.selectMany(["flow", "does-not-exist"])).toThrow(/Unknown/);
  expect(e.snapshot().selectedIds).toEqual(["tank", "pump", "title"]);
  e.selectMany(["tank", "tank", "pipe"]);
  expect(e.snapshot().selectedIds).toEqual(["tank", "pipe"]);
  expect(e.snapshot().document).toEqual(original);
  expect(e.snapshot().canUndo).toBe(false);
});

test("marquee selection can be used to move a group with one reversible command", () => {
  const e = editor();
  const original = e.snapshot().document;
  e.selectMany(findNodesInRect(original, 0, 100, 620, 350));
  const selected = e.snapshot().selectedIds;
  expect(selected).toEqual(["tank", "pipe", "pump"]);
  expect(e.moveBy(10, 0)).toBe(true);
  expect(e.snapshot().canUndo).toBe(true);
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document).toEqual(original);
  expect(e.snapshot().selectedIds).toEqual(selected);
});
