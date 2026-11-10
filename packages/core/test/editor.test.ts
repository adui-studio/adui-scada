import { expect, test } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "../src/demo-document.ts";
import {
  DocumentEditor,
  findNodesInRect,
  withNodePosition,
  withNodesTranslated,
} from "../src/editor.ts";

function editor() {
  return new DocumentEditor(waterTreatmentDemoDocument);
}

test("选择、拖动、撤销和重做保持工程及 Tag 绑定一致", () => {
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

test("无效移动不产生历史，新命令会清空重做记录", () => {
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

test("移动坐标需合法且自动限制在画布边界内", () => {
  const e = editor();
  e.select("tank");
  expect(() => e.moveSelected(Number.POSITIVE_INFINITY, 0)).toThrow(/有限数/);
  expect(e.snapshot().canUndo).toBe(false);
  expect(e.moveSelected(-999, 999)).toBe(true);
  const node = e.snapshot().document.pages[0]?.nodes.find((n) => n.id === "tank");
  expect(node?.transform.x).toBe(0);
  expect(node?.transform.y).toBe(255);
  expect(() => e.select("missing")).toThrow(/未找到图元/);
});

test("文本修改可撤销，类似 HTML 的内容仅作为普通数据", () => {
  const e = editor();
  e.select("title");
  e.setSelectedLabel("<script>alert(1)</script>");
  expect(e.snapshot().document.pages[0]?.nodes[0]?.props.text).toBe("<script>alert(1)</script>");
  e.undo();
  expect(e.snapshot().document.pages[0]?.nodes[0]?.props.text).toBe("水处理系统 / V0.1");
  expect(() => e.setSelectedLabel("x".repeat(257))).toThrow(/256/);
});

test("无效导入不破坏原工程，有效 JSON 可跨编辑会话往返", () => {
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

test("编辑快照为防御性副本，预览不会改变历史", () => {
  const e = editor();
  const copy = e.snapshot();
  copy.document.pages[0]!.nodes[0]!.props.text = "mutated";
  expect(e.snapshot().document.pages[0]?.nodes[0]?.props.text).toBe("水处理系统 / V0.1");
  const preview = withNodePosition(e.snapshot().document, "pump", 550, 190);
  expect(preview.pages[0]?.nodes.find((n) => n.id === "pump")?.transform.x).toBe(550);
  expect(e.snapshot().canUndo).toBe(false);
});

test("移动操作历史最多保留 100 条", () => {
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

test("只有文本图元能更新静态文案", () => {
  const e = editor();
  e.select("pump");
  expect(() => e.setSelectedLabel("unsafe")).toThrow(/请先选择文本图元/);
  expect(e.snapshot().canUndo).toBe(false);
});

test("新增图元 ID 稳定且不绑定设备，撤销重做保留 JSON", () => {
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
  expect(() => e.addNode("html" as never)).toThrow(/不支持的图元类型/);
});

test("多选切换、整组移动与边界预览一致", () => {
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

test("整组移动拒绝不存在或重复的图元及非法坐标", () => {
  const doc = editor().snapshot().document;
  expect(() => withNodesTranslated(doc, ["missing"], 2, 2)).toThrow(/不存在/);
  expect(() => withNodesTranslated(doc, ["tank", "tank"], 2, 2)).toThrow(/重复图元/);
  expect(() => withNodesTranslated(doc, ["tank"], Number.NaN, 2)).toThrow(/有限数/);
  expect(doc.pages[0]?.nodes.find((n) => n.id === "tank")?.transform.x).toBe(80);
});

test("图元对齐仅生成一条可撤销命令", () => {
  const e = editor();
  e.select("tank");
  e.select("pump", true); // 水泵是此次对齐的基准图元。
  expect(e.alignSelected("left")).toBe(true);
  const after = e.snapshot().document.pages[0]?.nodes ?? [];
  expect(after.find((n) => n.id === "tank")?.transform.x).toBe(500);
  expect(after.find((n) => n.id === "pump")?.transform.x).toBe(500);
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.find((n) => n.id === "tank")?.transform.x).toBe(80);
  expect(e.alignSelected("hcenter")).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.find((n) => n.id === "tank")?.transform.x).toBe(480);
});

test("图层排序保留多选顺序并支持撤销", () => {
  const e = editor();
  e.select("tank");
  e.select("pipe", true);
  expect(e.reorderSelected("front")).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.map((n) => n.id)).toEqual([
    "title",
    "pump",
    "flow",
    "tank",
    "pipe",
  ]);
  expect(e.reorderSelected("front")).toBe(false);
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.map((n) => n.id)).toEqual([
    "title",
    "tank",
    "pipe",
    "pump",
    "flow",
  ]);
  expect(e.reorderSelected("back")).toBe(true);
  expect(
    e
      .snapshot()
      .document.pages[0]?.nodes.slice(0, 2)
      .map((n) => n.id),
  ).toEqual(["tank", "pipe"]);
});

test("批量删除可撤销恢复，导出的工程仍兼容", () => {
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

test("新增图元 ID 在删除和导入后保持唯一，无效操作不入历史", () => {
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

test("小数坐标的受限位移不会越出画布", () => {
  const document = editor().snapshot().document;
  const tank = document.pages[0]?.nodes.find((node) => node.id === "tank");
  if (!tank) throw new Error("测试数据缺少水箱图元");
  // 水平方向仅剩 0.3 个单位的可移动空间。
  tank.transform.x = 729.7;
  const moved = withNodesTranslated(document, ["tank"], 1, 0);
  const x = moved.pages[0]?.nodes.find((node) => node.id === "tank")?.transform.x;
  expect(x).toBe(730);
  expect(x! + tank.transform.width).toBeLessThanOrEqual(880);
});

test("图层逐级上移下移及边缘无效操作正确", () => {
  const e = editor();
  e.select("title");
  expect(e.reorderSelected("backward")).toBe(false);
  expect(e.reorderSelected("forward")).toBe(true);
  expect(
    e
      .snapshot()
      .document.pages[0]?.nodes.map((node) => node.id)
      .slice(0, 2),
  ).toEqual(["tank", "title"]);
  expect(e.reorderSelected("backward")).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes[0]?.id).toBe("title");
});

test("框选命中支持反向拖动、空选框和完整画布", () => {
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

test("框选按旋转后外接矩形命中", () => {
  const document = editor().snapshot().document;
  const tank = document.pages[0]?.nodes.find((node) => node.id === "tank");
  if (!tank) throw new Error("测试数据缺少水箱图元");
  tank.transform.rotation = 90;
  expect(findNodesInRect(document, 50, 220, 60, 230)).toEqual(["tank"]);
});

test("框选拒绝非法坐标且不修改编辑历史", () => {
  const e = editor();
  const before = e.snapshot();
  expect(() => findNodesInRect(before.document, Number.NaN, 0, 300, 300)).toThrow(/有限数/);
  expect(() => findNodesInRect(before.document, 0, Number.POSITIVE_INFINITY, 300, 300)).toThrow(
    /有限数/,
  );
  expect(e.snapshot()).toEqual(before);
});

test("批量选择先验证再更新，保留顺序且不修改 JSON", () => {
  const e = editor();
  const original = e.snapshot().document;
  e.selectMany(["tank", "pump"]);
  expect(e.snapshot().selectedIds).toEqual(["tank", "pump"]);
  e.selectMany(["pump", "title"], true);
  expect(e.snapshot().selectedIds).toEqual(["tank", "pump", "title"]);
  expect(e.snapshot().selectedId).toBe("title");
  expect(() => e.selectMany(["flow", "does-not-exist"])).toThrow(/不存在/);
  expect(e.snapshot().selectedIds).toEqual(["tank", "pump", "title"]);
  e.selectMany(["tank", "tank", "pipe"]);
  expect(e.snapshot().selectedIds).toEqual(["tank", "pipe"]);
  expect(e.snapshot().document).toEqual(original);
  expect(e.snapshot().canUndo).toBe(false);
});

test("框选后的整组移动能作为单条命令撤销", () => {
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

test("右侧小数边界吸附位移能够提交并撤销", () => {
  const document = editor().snapshot().document;
  const tank = document.pages[0]?.nodes.find((node) => node.id === "tank");
  if (!tank) throw new Error("测试数据缺少水箱图元");
  tank.transform.x = 729.7;
  const e = new DocumentEditor(document);
  e.select("tank");

  expect(e.moveBy(730 - tank.transform.x, 0)).toBe(true);
  expect(
    e.snapshot().document.pages[0]?.nodes.find((node) => node.id === "tank")?.transform.x,
  ).toBe(730);
  expect(e.undo()).toBe(true);
  expect(
    e.snapshot().document.pages[0]?.nodes.find((node) => node.id === "tank")?.transform.x,
  ).toBe(729.7);
  expect(e.moveBy(-5.4, 0)).toBe(true);
  expect(
    e.snapshot().document.pages[0]?.nodes.find((node) => node.id === "tank")?.transform.x,
  ).toBe(724.7);
});

test("左侧小数边界吸附位移能够提交并撤销", () => {
  const document = editor().snapshot().document;
  const tank = document.pages[0]?.nodes.find((node) => node.id === "tank");
  if (!tank) throw new Error("测试数据缺少水箱图元");
  tank.transform.x = 0.2;
  const e = new DocumentEditor(document);
  e.select("tank");

  expect(e.moveBy(-0.2, 0)).toBe(true);
  expect(
    e.snapshot().document.pages[0]?.nodes.find((node) => node.id === "tank")?.transform.x,
  ).toBe(0);
  expect(e.undo()).toBe(true);
  expect(
    e.snapshot().document.pages[0]?.nodes.find((node) => node.id === "tank")?.transform.x,
  ).toBe(0.2);
});
