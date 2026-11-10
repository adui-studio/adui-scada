import { expect, test } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "../src/demo-document.ts";
import {
  LEGACY_SCADA_SCHEMA_VERSION,
  SCADA_SCHEMA_VERSION,
  studioNodeLocked,
  studioNodeVisible,
} from "../src/document.ts";
import {
  DocumentEditor,
  findNodesInRect,
  resolveDragSnap,
  withNodePosition,
  withNodesTranslated,
  withNodeTransform,
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

test("图元位置尺寸与旋转可一次修改并撤销重做且不改变 Tag 绑定", () => {
  const e = editor();
  e.select("tank");
  const before = e.snapshot().document;
  const transform = { x: 102.5, y: 140, width: 160, height: 180, rotation: -45 };
  expect(e.updateSelectedTransform(transform)).toBe(true);
  const after = e.snapshot();
  const node = after.document.pages[0]?.nodes.find((item) => item.id === "tank");
  expect(node?.transform).toEqual(transform);
  expect(node?.bindings.level?.tagId).toBe("water.level");
  expect(after.canUndo).toBe(true);
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document).toEqual(before);
  expect(e.redo()).toBe(true);
  expect(e.snapshot().document).toEqual(after.document);
});

test("未变化的几何属性不会写入撤销历史", () => {
  const e = editor();
  e.select("tank");
  expect(e.updateSelectedTransform({ x: 80, y: 125 })).toBe(false);
  expect(e.updateSelectedTransform({})).toBe(false);
  expect(e.snapshot().canUndo).toBe(false);
});

test("几何属性允许合法小数并保持原工程不变", () => {
  const original = editor().snapshot().document;
  const result = withNodeTransform(original, "tank", {
    x: 0.25,
    width: 0.1,
    rotation: 360,
  });
  const transform = result.pages[0]?.nodes.find((node) => node.id === "tank")?.transform;
  expect(transform?.x).toBe(0.25);
  expect(transform?.width).toBe(0.1);
  expect(transform?.rotation).toBe(360);
  expect(original.pages[0]?.nodes.find((node) => node.id === "tank")?.transform.x).toBe(80);
  const restored = new DocumentEditor(JSON.parse(JSON.stringify(result)) as unknown);
  expect(restored.snapshot().document).toEqual(result);
});

test("几何属性拒绝无效数值、未知字段和非法对象", () => {
  const document = editor().snapshot().document;
  expect(() => withNodeTransform(document, "tank", { x: Number.NaN })).toThrow(/有限数/);
  expect(() => withNodeTransform(document, "tank", { y: Infinity })).toThrow(/有限数/);
  expect(() => withNodeTransform(document, "tank", { width: "20" as never })).toThrow(/有限数/);
  expect(() => withNodeTransform(document, "tank", { opacity: 1 } as never)).toThrow(
    /不支持的图元几何属性/,
  );
  expect(() => withNodeTransform(document, "tank", null as never)).toThrow(/普通对象/);
  expect(() => withNodeTransform(document, "missing", { x: 20 })).toThrow(/未找到图元/);
});

test("几何属性拒绝越界与不合法尺寸旋转且失败不破坏历史", () => {
  const e = editor();
  e.select("tank");
  const before = e.snapshot();
  expect(() => e.updateSelectedTransform({ x: -1 })).toThrow(/画布范围/);
  expect(() => e.updateSelectedTransform({ x: 800 })).toThrow(/画布范围/);
  expect(() => e.updateSelectedTransform({ width: 0 })).toThrow(/宽度和高度/);
  expect(() => e.updateSelectedTransform({ height: 16385 })).toThrow(/宽度和高度/);
  expect(() => e.updateSelectedTransform({ rotation: -361 })).toThrow(/旋转角度/);
  expect(() => e.updateSelectedTransform({ x: 740, width: 150 })).toThrow(/画布范围/);
  expect(e.snapshot()).toEqual(before);
});

test("未选择或多选图元时不允许误改某个图元的几何属性", () => {
  const e = editor();
  const before = e.snapshot().document;
  expect(() => e.updateSelectedTransform({ rotation: 30 })).toThrow(/单选/);
  e.selectMany(["tank", "pump"]);
  expect(() => e.updateSelectedTransform({ width: 180 })).toThrow(/单选/);
  expect(e.snapshot().document).toEqual(before);
  expect(e.snapshot().canUndo).toBe(false);
});

test("组合至少两个图元并保留原始 Tag 和单次撤销重做", () => {
  const e = editor();
  const original = e.snapshot().document;
  e.selectMany(["tank", "pump"]);
  expect(e.groupSelected()).toBe("group-1");
  const grouped = e.snapshot();
  expect(grouped.selectedIds).toEqual(["tank", "pump"]);
  expect(grouped.document.pages[0]?.nodes.find((node) => node.id === "tank")?.groupId).toBe(
    "group-1",
  );
  expect(grouped.document.pages[0]?.nodes.find((node) => node.id === "pump")?.groupId).toBe(
    "group-1",
  );
  const tank = grouped.document.pages[0]?.nodes.find((node) => node.id === "tank");
  expect(tank?.bindings.level?.tagId).toBe("water.level");
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document).toEqual(original);
  expect(e.redo()).toBe(true);
  expect(e.snapshot().document).toEqual(grouped.document);
});

test("点击组合任一成员自动选中整组，Shift 可整体取消选中", () => {
  const e = editor();
  e.selectMany(["tank", "pump"]);
  e.groupSelected();
  e.select(null);
  e.select("tank");
  expect(e.snapshot().selectedIds).toEqual(["pump", "tank"]);
  expect(e.snapshot().selectedId).toBe("tank");
  e.select("pump", true);
  expect(e.snapshot().selectedIds).toEqual([]);
  e.select("pump", true);
  expect(e.snapshot().selectedIds).toEqual(["tank", "pump"]);
  e.selectMany(["tank"]);
  expect(e.snapshot().selectedIds).toEqual(["tank", "pump"]);
  e.selectMany(["flow"], true);
  expect(e.snapshot().selectedIds).toEqual(["tank", "pump", "flow"]);
});

test("只传入组合成员的纯移动和吸附计算均会展开全部组员", () => {
  const e = editor();
  e.selectMany(["tank", "pump"]);
  e.groupSelected();
  const document = e.snapshot().document;
  const moved = withNodesTranslated(document, ["tank"], 10, 20);
  expect(moved.pages[0]?.nodes.find((node) => node.id === "tank")?.transform.x).toBe(90);
  expect(moved.pages[0]?.nodes.find((node) => node.id === "pump")?.transform.x).toBe(510);
  expect(document.pages[0]?.nodes.find((node) => node.id === "tank")?.transform.x).toBe(80);
  const snap = resolveDragSnap(document, ["tank"], 10000, 10000, {
    gridEnabled: false,
    nodeEnabled: false,
  });
  expect(snap.dx).toBe(270);
  expect(snap.dy).toBe(130);
  const atEdge = withNodesTranslated(document, ["tank"], snap.dx, snap.dy);
  expect(atEdge.pages[0]?.nodes.find((node) => node.id === "tank")?.transform.x).toBe(350);
  expect(atEdge.pages[0]?.nodes.find((node) => node.id === "pump")?.transform.x).toBe(770);
});

test("已组合成员使用编辑器移动时整体移动，删除时整体删除并支持撤销", () => {
  const e = editor();
  e.selectMany(["tank", "pump"]);
  e.groupSelected();
  e.select("tank");
  expect(e.moveBy(10, 20)).toBe(true);
  const pump = e.snapshot().document.pages[0]?.nodes.find((node) => node.id === "pump");
  expect(pump?.transform.x).toBe(510);
  expect(e.deleteSelected()).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.some((node) => node.id === "tank")).toBe(false);
  expect(e.snapshot().document.pages[0]?.nodes.some((node) => node.id === "pump")).toBe(false);
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.find((node) => node.id === "tank")?.groupId).toBe(
    "group-1",
  );
});

test("解组后保留节点和 Tag，解组命令支持撤销重做", () => {
  const e = editor();
  expect(e.ungroupSelected()).toBe(false);
  expect(e.snapshot().canUndo).toBe(false);
  e.selectMany(["tank", "pump"]);
  e.groupSelected();
  const grouped = e.snapshot().document;
  expect(e.ungroupSelected()).toBe(true);
  const ungrouped = e.snapshot().document;
  expect(ungrouped.pages[0]?.nodes.find((node) => node.id === "tank")?.groupId).toBeUndefined();
  expect(ungrouped.pages[0]?.nodes.find((node) => node.id === "tank")?.bindings.level?.tagId).toBe(
    "water.level",
  );
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document).toEqual(grouped);
  expect(e.redo()).toBe(true);
  expect(e.snapshot().document).toEqual(ungrouped);
});

test("多个组合独立维护 ID，解组只影响当前选中的组合", () => {
  const e = editor();
  e.selectMany(["tank", "pump"]);
  expect(e.groupSelected()).toBe("group-1");
  e.selectMany(["title", "flow"]);
  expect(e.groupSelected()).toBe("group-2");
  e.select("tank");
  expect(e.ungroupSelected()).toBe(true);
  const nodes = e.snapshot().document.pages[0]?.nodes ?? [];
  expect(nodes.find((node) => node.id === "tank")?.groupId).toBeUndefined();
  expect(nodes.find((node) => node.id === "pump")?.groupId).toBeUndefined();
  expect(nodes.find((node) => node.id === "title")?.groupId).toBe("group-2");
  expect(nodes.find((node) => node.id === "flow")?.groupId).toBe("group-2");
  e.selectMany(["tank", "pump"]);
  expect(e.groupSelected()).toBe("group-1");
});

test("禁止单节点组合、嵌套组合及混入其他组合，不污染历史", () => {
  const e = editor();
  e.select("tank");
  expect(() => e.groupSelected()).toThrow(/至少选择两个/);
  expect(e.snapshot().canUndo).toBe(false);
  e.selectMany(["tank", "pump"]);
  e.groupSelected();
  const before = e.snapshot();
  expect(() => e.groupSelected()).toThrow(/已有组合/);
  e.selectMany(["tank", "flow"]);
  expect(() => e.groupSelected()).toThrow(/已有组合/);
  expect(e.snapshot().document).toEqual(before.document);
});

test("组内几何与文案单体编辑和对齐须先解组", () => {
  const e = editor();
  e.selectMany(["title", "tank"]);
  e.groupSelected();
  const before = e.snapshot().document;
  e.select("title");
  expect(() => e.updateSelectedTransform({ x: 120 })).toThrow(/单选/);
  expect(() => withNodeTransform(before, "title", { width: 220 })).toThrow(/先解组/);
  expect(() => e.setSelectedLabel("不能单改")).toThrow(/请先选择文本图元/);
  expect(() => e.alignSelected("left")).toThrow(/先解组/);
  expect(e.snapshot().document).toEqual(before);
});

test("组合关系可通过本地 JSON 跨编辑器往返并恢复组员选择", () => {
  const e = editor();
  e.selectMany(["tank", "pump"]);
  e.groupSelected();
  const data = JSON.stringify(e.snapshot().document);
  const other = editor();
  other.loadDocument(JSON.parse(data));
  expect(other.snapshot().document).toEqual(e.snapshot().document);
  expect(other.snapshot().selectedIds).toEqual([]);
  other.select("pump");
  expect(new Set(other.snapshot().selectedIds)).toEqual(new Set(["tank", "pump"]));
  expect(other.ungroupSelected()).toBe(true);
  const third = editor();
  third.loadDocument(JSON.parse(JSON.stringify(other.snapshot().document)));
  third.select("tank");
  expect(third.snapshot().selectedIds).toEqual(["tank"]);
});

test("旧版工程显式导入后升级并重置旧编辑历史", () => {
  const e = editor();
  e.select("tank");
  expect(e.moveBy(4, 0)).toBe(true);
  const legacy = JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
  legacy.schemaVersion = LEGACY_SCADA_SCHEMA_VERSION;
  legacy.pages[0].nodes[1].groupId = "group-1";
  legacy.pages[0].nodes[3].groupId = "group-1";

  expect(e.loadDocument(legacy)).toBe(LEGACY_SCADA_SCHEMA_VERSION);
  const result = e.snapshot();
  expect(result.document.schemaVersion).toBe(SCADA_SCHEMA_VERSION);
  expect(result.selectedIds).toEqual([]);
  expect(result.canUndo).toBe(false);
  expect(result.canRedo).toBe(false);
  e.select("tank");
  expect(new Set(e.snapshot().selectedIds)).toEqual(new Set(["tank", "pump"]));
  expect(result.document.pages[0]?.nodes[1]?.groupId).toBe("group-1");
  expect(result.document.pages[0]?.nodes[3]?.groupId).toBe("group-1");
});

test("当前版本工程导入不触发迁移提示", () => {
  const e = editor();
  const current = e.snapshot().document;
  expect(e.loadDocument(JSON.parse(JSON.stringify(current)))).toBeNull();
  expect(e.snapshot().document).toEqual(current);
});

test("旧版工程存在未知字段时导入失败且保留选中和撤销历史", () => {
  const e = editor();
  e.select("tank");
  expect(e.moveBy(5, 0)).toBe(true);
  const before = e.snapshot();
  const legacy = JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
  legacy.schemaVersion = LEGACY_SCADA_SCHEMA_VERSION;
  legacy.pages[0].nodes[1].transform.futureScale = 2;
  expect(() => e.loadDocument(legacy)).toThrow(/结构字段/);
  expect(e.snapshot()).toEqual(before);
  expect(e.undo()).toBe(true);
  expect(e.redo()).toBe(true);
  expect(e.snapshot().document).toEqual(before.document);
});

test("未来版本或非法历史组合拒绝导入并保留当前工程", () => {
  const e = editor();
  e.select("tank");
  const before = e.snapshot();
  const future = JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
  future.schemaVersion = "0.3.0";
  expect(() => e.loadDocument(future)).toThrow(/不支持的工程版本/);
  expect(e.snapshot()).toEqual(before);
  future.schemaVersion = LEGACY_SCADA_SCHEMA_VERSION;
  future.pages[0].nodes[1].groupId = "group-1";
  expect(() => e.loadDocument(future)).toThrow(/至少需要两个图元/);
  expect(e.snapshot()).toEqual(before);
});

test("水箱 Tag 绑定可以清除、撤销和重做", () => {
  const e = editor();
  e.select("tank");
  const before = e.snapshot().document;
  expect(e.setSelectedBinding("level", null)).toBe(true);
  expect(
    Object.keys(
      e.snapshot().document.pages[0]?.nodes.find((node) => node.id === "tank")?.bindings ?? {},
    ),
  ).toEqual([]);
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document).toEqual(before);
  expect(e.redo()).toBe(true);
  expect(
    Object.keys(
      e.snapshot().document.pages[0]?.nodes.find((node) => node.id === "tank")?.bindings ?? {},
    ),
  ).toEqual([]);
});

test("新增文本图元绑定模拟流量后工程 JSON 往返保持一致", () => {
  const e = editor();
  expect(e.addNode("label")).toBe("label-1");
  expect(e.setSelectedBinding("value", "water.flow")).toBe(true);
  const after = e.snapshot().document;
  const loaded = editor();
  loaded.loadDocument(JSON.parse(JSON.stringify(after)));
  expect(loaded.snapshot().document).toEqual(after);
  expect(after.pages[0]?.nodes.find((node) => node.id === "label-1")?.bindings.value?.tagId).toBe(
    "water.flow",
  );
});

test("Tag 绑定相同值不生成撤销历史", () => {
  const e = editor();
  e.select("tank");
  expect(e.setSelectedBinding("level", "water.level")).toBe(false);
  expect(e.snapshot().canUndo).toBe(false);
  expect(e.setSelectedBinding("level", null)).toBe(true);
  expect(e.setSelectedBinding("level", null)).toBe(false);
  expect(e.snapshot().canUndo).toBe(true);
});

test("Tag 绑定拒绝非法槽及非法标识符，不污染工程", () => {
  const e = editor();
  e.select("pump");
  const before = e.snapshot();
  expect(() => e.setSelectedBinding("level", "water.level")).toThrow(/不支持指定/);
  expect(() => e.setSelectedBinding("running", "非法 Tag")).toThrow(/稳定 ASCII/);
  expect(() => e.setSelectedBinding("running", "")).toThrow(/稳定 ASCII/);
  expect(() => e.setSelectedBinding("running", 123 as never)).toThrow(/字符串或 null/);
  expect(e.snapshot()).toEqual(before);
});

test("Tag 绑定只允许单选，组合图元不可单独修改", () => {
  const e = editor();
  expect(() => e.setSelectedBinding("level", null)).toThrow(/单选/);
  e.select("tank");
  e.select("pump", true);
  expect(() => e.setSelectedBinding("level", null)).toThrow(/单选/);
  e.groupSelected();
  e.select("tank");
  const before = e.snapshot();
  expect(() => e.setSelectedBinding("level", null)).toThrow(/先解组/);
  expect(e.snapshot()).toEqual(before);
});

test("管道图元不支持 Tag 绑定，原有绑定与图元属性保持不变", () => {
  const e = editor();
  e.select("pipe");
  const before = e.snapshot();
  expect(() => e.setSelectedBinding("value", "water.flow")).toThrow(/不支持指定/);
  expect(e.snapshot()).toEqual(before);
});

test("编辑器初始激活第一页，切换页面不修改工程或撤销历史", () => {
  const e = editor();
  expect(e.snapshot().activePageId).toBe("main");
  const second = e.createPage();
  const original = e.snapshot().document;
  const canUndo = e.snapshot().canUndo;
  expect(e.switchPage("main")).toBe(true);
  e.select("tank");
  expect(e.switchPage(second)).toBe(true);
  expect(e.snapshot().selectedIds).toEqual([]);
  expect(e.switchPage(second)).toBe(false);
  expect(e.snapshot().document).toEqual(original);
  expect(e.snapshot().canUndo).toBe(canUndo);
});

test("新建页面继承当前画布尺寸，撤销重做正确恢复激活页", () => {
  const e = editor();
  const original = e.snapshot().document;
  const id = e.createPage("泵房监控");
  expect(id).toBe("page-1");
  expect(e.snapshot().activePageId).toBe(id);
  expect(e.snapshot().document.pages[1]).toMatchObject({
    id,
    name: "泵房监控",
    size: original.pages[0]?.size,
    nodes: [],
  });
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document).toEqual(original);
  expect(e.snapshot().activePageId).toBe("main");
  expect(e.redo()).toBe(true);
  expect(e.snapshot().activePageId).toBe(id);
  expect(e.snapshot().document.pages).toHaveLength(2);
});

test("页面重命名不改变 ID 与图元，未变化名称不写入历史", () => {
  const e = editor();
  const original = e.snapshot().document;
  expect(e.renamePage("main", "水处理总览")).toBe(true);
  expect(e.snapshot().document.pages[0]?.name).toBe("水处理总览");
  expect(e.renamePage("main", " 水处理总览 ")).toBe(false);
  expect(e.snapshot().document.pages[0]?.nodes).toEqual(original.pages[0]?.nodes);
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document).toEqual(original);
});

test("删除当前页面后自动切换相邻页面，撤销恢复全部图元与绑定", () => {
  const e = editor();
  const pageId = e.createPage("临时监控");
  const nodeId = e.addNode("label");
  expect(e.setSelectedBinding("value", "water.flow")).toBe(true);
  const beforeDelete = e.snapshot().document;
  expect(e.deletePage(pageId)).toBe(true);
  expect(e.snapshot().activePageId).toBe("main");
  expect(e.snapshot().document.pages).toHaveLength(1);
  expect(e.undo()).toBe(true);
  expect(e.snapshot().activePageId).toBe(pageId);
  expect(e.snapshot().document).toEqual(beforeDelete);
  const restoredNode = e.snapshot().document.pages[1]?.nodes.find((node) => node.id === nodeId);
  expect(restoredNode?.bindings.value?.tagId).toBe("water.flow");
  expect(e.redo()).toBe(true);
  expect(e.snapshot().document.pages).toHaveLength(1);
});

test("删除非当前页保持当前页和选择，禁止删除最后一页", () => {
  const e = editor();
  expect(() => e.deletePage("main")).toThrow(/至少需要保留一个页面/);
  const id = e.createPage();
  const nodeId = e.addNode("label");
  expect(e.deletePage("main")).toBe(true);
  expect(e.snapshot().activePageId).toBe(id);
  expect(e.snapshot().selectedIds).toEqual([nodeId]);
  expect(e.snapshot().document.pages.map((page) => page.id)).toEqual([id]);
  expect(() => e.deletePage(id)).toThrow(/至少需要保留一个页面/);
});

test("第二页新增、移动和标签绑定不改变第一页内容", () => {
  const e = editor();
  const firstNodes = e.snapshot().document.pages[0]?.nodes;
  const second = e.createPage("第二页");
  expect(e.addNode("tank")).toBe("tank-1");
  expect(e.setSelectedBinding("level", "water.level")).toBe(true);
  expect(e.moveBy(30, 30)).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes).toEqual(firstNodes);
  expect(e.snapshot().document.pages[1]?.nodes[0]?.bindings.level?.tagId).toBe("water.level");
  expect(e.snapshot().document.pages[1]?.nodes[0]?.transform.x).toBe(70);
  expect(e.switchPage("main")).toBe(true);
  expect(() => e.select("tank-1")).toThrow(/未找到图元/);
  expect(e.switchPage(second)).toBe(true);
  expect(e.snapshot().selectedIds).toEqual([]);
});

test("吸附、框选、位置和尺寸计算仅影响指定页面", () => {
  const e = editor();
  const id = e.createPage();
  const nodeId = e.addNode("label");
  const document = e.snapshot().document;
  const originalFirst = document.pages[0];
  const found = findNodesInRect(document, 0, 0, 260, 180, id);
  expect(found).toEqual([nodeId]);
  expect(findNodesInRect(document, 0, 0, 260, 180)).not.toContain(nodeId);
  const snap = resolveDragSnap(
    document,
    [nodeId],
    10,
    5,
    { gridEnabled: false, nodeEnabled: false },
    id,
  );
  const moved = withNodesTranslated(document, [nodeId], snap.dx, snap.dy, id);
  expect(moved.pages[0]).toEqual(originalFirst);
  expect(moved.pages[1]?.nodes[0]?.transform.x).toBe(50);
  const resized = withNodeTransform(moved, nodeId, { width: 250 }, id);
  expect(resized.pages[1]?.nodes[0]?.transform.width).toBe(250);
  const positioned = withNodePosition(resized, nodeId, 80, 90, id);
  expect(positioned.pages[1]?.nodes[0]?.transform.x).toBe(80);
  expect(positioned.pages[0]).toEqual(originalFirst);
});

test("多个页面的图元和组合共享工程级唯一标识符", () => {
  const e = editor();
  const pageId = e.createPage();
  expect(e.addNode("label")).toBe("label-1");
  expect(e.addNode("label")).toBe("label-2");
  e.select("label-1");
  e.select("label-2", true);
  expect(e.groupSelected()).toBe("group-1");
  expect(e.snapshot().document.pages[1]?.nodes.every((node) => node.groupId === "group-1")).toBe(
    true,
  );
  expect(e.snapshot().document.pages[0]?.nodes.every((node) => node.groupId === undefined)).toBe(
    true,
  );
  e.switchPage("main");
  expect(e.addNode("label")).toBe("label-3");
  expect(e.snapshot().activePageId).toBe("main");
  expect(pageId).toBe("page-1");
});

test("页面 ID 避让图元与组合标识符，避免不同实体发生冲突", () => {
  const source = JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
  source.pages[0].nodes[0].id = "page-1";
  source.pages[0].nodes[1].groupId = "page-2";
  source.pages[0].nodes[3].groupId = "page-2";
  const e = new DocumentEditor(source);
  expect(e.createPage()).toBe("page-3");
});

test("页面非法名称、未知 ID 与页面数量上限均原子拒绝", () => {
  const e = editor();
  const before = e.snapshot();
  expect(() => e.switchPage("missing")).toThrow(/未找到页面/);
  expect(() => e.renamePage("missing", "新名称")).toThrow(/未找到页面/);
  expect(() => e.deletePage("missing")).toThrow(/未找到页面/);
  expect(() => e.createPage("   ")).toThrow(/页面名称不能为空/);
  expect(() => e.renamePage("main", "   ")).toThrow(/页面名称不能为空/);
  expect(() => e.renamePage("main", "很".repeat(257))).toThrow(/256/);
  expect(e.snapshot()).toEqual(before);
  for (let i = 1; i < 100; i++) e.createPage();
  expect(e.snapshot().document.pages).toHaveLength(100);
  const full = e.snapshot();
  expect(() => e.createPage()).toThrow(/不能超过 100/);
  expect(e.snapshot()).toEqual(full);
});

test("多页面 JSON 导入后默认激活第一页且清空旧编辑历史", () => {
  const e = editor();
  const id = e.createPage("泵房");
  e.addNode("pump");
  const saved = JSON.parse(JSON.stringify(e.snapshot().document));
  const other = editor();
  other.select("tank");
  other.moveBy(5, 5);
  expect(other.loadDocument(saved)).toBeNull();
  expect(other.snapshot().document).toEqual(e.snapshot().document);
  expect(other.snapshot().activePageId).toBe("main");
  expect(other.snapshot().selectedIds).toEqual([]);
  expect(other.snapshot().canUndo).toBe(false);
  expect(other.snapshot().canRedo).toBe(false);
  expect(other.switchPage(id)).toBe(true);
  expect(other.snapshot().document.pages[1]?.nodes[0]?.type).toBe("pump");
});

test("跨页面撤销编辑命令会回到发生修改的页面", () => {
  const e = editor();
  const id = e.createPage();
  e.addNode("label");
  expect(e.switchPage("main")).toBe(true);
  expect(e.undo()).toBe(true);
  expect(e.snapshot().activePageId).toBe(id);
  expect(e.snapshot().document.pages[1]?.nodes).toHaveLength(0);
  expect(e.redo()).toBe(true);
  expect(e.snapshot().activePageId).toBe(id);
  expect(e.snapshot().document.pages[1]?.nodes).toHaveLength(1);
});

test("复制页面紧邻源页插入，并重新分配页面与图元 ID", () => {
  const e = editor();
  const before = e.snapshot().document;
  const pageId = e.duplicatePage();
  const after = e.snapshot();
  expect(pageId).toBe("page-1");
  expect(after.activePageId).toBe(pageId);
  expect(after.selectedIds).toEqual([]);
  expect(after.document.pages.map((page) => page.id)).toEqual(["main", pageId]);
  expect(after.document.pages[0]).toEqual(before.pages[0]);
  expect(after.document.pages[1]?.name).toBe("水处理系统（模拟） 副本");
  expect(after.document.pages[1]?.size).toEqual(before.pages[0]?.size);
  expect(after.document.pages[1]?.nodes).toHaveLength(before.pages[0]!.nodes.length);
  expect(after.document.pages[1]?.nodes.map((node) => node.id)).not.toEqual(
    before.pages[0]?.nodes.map((node) => node.id),
  );
  expect(after.document.pages[1]?.nodes[1]?.bindings.level?.tagId).toBe("water.level");
});

test("复制页面会完整重映射组合，原节点属性和 Tag 保真", () => {
  const e = editor();
  e.select("tank");
  e.select("pump", true);
  const originalGroup = e.groupSelected();
  const before = e.snapshot().document;
  const newId = e.duplicatePage();
  const copy = e.snapshot().document.pages.find((page) => page.id === newId)!;
  const source = before.pages[0]!;
  const group = copy.nodes[1]?.groupId;
  expect(group).toBeDefined();
  expect(group).not.toBe(originalGroup);
  expect(copy.nodes[3]?.groupId).toBe(group);
  expect(copy.nodes[1]?.transform).toEqual(source.nodes[1]?.transform);
  expect(copy.nodes[1]?.bindings).toEqual(source.nodes[1]?.bindings);
  expect(copy.nodes[3]?.bindings).toEqual(source.nodes[3]?.bindings);
  expect(copy.nodes[0]?.props).toEqual(source.nodes[0]?.props);
  expect(e.snapshot().document.pages[0]).toEqual(source);
});

test("复制页面可撤销重做，历史恢复正确的当前页", () => {
  const e = editor();
  const original = e.snapshot().document;
  const copyId = e.duplicatePage();
  const copied = e.snapshot().document;
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document).toEqual(original);
  expect(e.snapshot().activePageId).toBe("main");
  expect(e.redo()).toBe(true);
  expect(e.snapshot().document).toEqual(copied);
  expect(e.snapshot().activePageId).toBe(copyId);
});

test("复制指定的非当前页面不改变源页面和其他页面", () => {
  const e = editor();
  const second = e.createPage();
  e.addNode("label");
  const original = e.snapshot().document;
  const copyId = e.duplicatePage("main");
  expect(e.snapshot().document.pages.map((page) => page.id)).toEqual(["main", copyId, second]);
  expect(e.snapshot().document.pages[0]).toEqual(original.pages[0]);
  expect(e.snapshot().document.pages[2]).toEqual(original.pages[1]);
  expect(e.snapshot().activePageId).toBe(copyId);
});

test("重复复制不会产生全工程页面、图元和组合 ID 冲突", () => {
  const e = editor();
  e.select("tank");
  e.select("pump", true);
  e.groupSelected();
  e.duplicatePage();
  e.duplicatePage();
  const doc = e.snapshot().document;
  const ids = doc.pages.flatMap((page) => [
    page.id,
    ...page.nodes.map((node) => node.id),
    ...new Set(page.nodes.flatMap((node) => (node.groupId ? [node.groupId] : []))),
  ]);
  expect(new Set(ids).size).toBe(ids.length);
});

test("复制页面的非法 ID 与最大页数限制不会改变工程", () => {
  const e = editor();
  const before = e.snapshot();
  expect(() => e.duplicatePage("missing")).toThrow(/未找到页面/);
  expect(e.snapshot()).toEqual(before);
  for (let i = 1; i < 100; i++) e.createPage();
  const full = e.snapshot();
  expect(() => e.duplicatePage()).toThrow(/不能超过 100/);
  expect(e.snapshot()).toEqual(full);
});

test("页面前移后移只改变顺序，且边界不写入撤销历史", () => {
  const e = editor();
  const second = e.createPage();
  const third = e.createPage();
  const before = e.snapshot().document;
  expect(e.movePage("main", "previous")).toBe(false);
  expect(e.movePage(third, "next")).toBe(false);
  expect(e.snapshot().document).toEqual(before);
  expect(e.movePage(third, "previous")).toBe(true);
  expect(e.snapshot().document.pages.map((page) => page.id)).toEqual(["main", third, second]);
  expect(e.snapshot().activePageId).toBe(third);
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document).toEqual(before);
  expect(e.redo()).toBe(true);
  expect(e.snapshot().document.pages.map((page) => page.id)).toEqual(["main", third, second]);
  expect(e.movePage(third, "next")).toBe(true);
  expect(e.snapshot().document.pages.map((page) => page.id)).toEqual(["main", second, third]);
});

test("页面排序非法方向和未知页面原子拒绝", () => {
  const e = editor();
  const before = e.snapshot();
  expect(() => e.movePage("missing", "previous")).toThrow(/未找到页面/);
  expect(() => e.movePage("main", "wrong" as never)).toThrow(/排序方向无效/);
  expect(e.snapshot()).toEqual(before);
});

test("跨页面复制选中图元保留源页、几何和 Tag 绑定", () => {
  const e = editor();
  const targetId = e.createPage("目标页面");
  e.switchPage("main");
  e.select("tank");
  const before = e.snapshot().document;
  const ids = e.copySelectedToPage(targetId);
  expect(ids).toHaveLength(1);
  expect(e.snapshot().activePageId).toBe("main");
  expect(e.snapshot().selectedIds).toEqual(["tank"]);
  const pages = e.snapshot().document.pages;
  expect(pages[0]).toEqual(before.pages[0]);
  const copied = pages[1]?.nodes[0];
  expect(copied?.id).toBe(ids[0]);
  expect(copied?.id).not.toBe("tank");
  expect(copied?.transform).toEqual(before.pages[0]?.nodes[1]?.transform);
  expect(copied?.bindings.level?.tagId).toBe("water.level");
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document).toEqual(before);
  expect(e.redo()).toBe(true);
  expect(e.snapshot().document.pages[1]?.nodes[0]?.id).toBe(ids[0]);
});

test("跨页面复制组合自动带齐成员，并生成新的组合 ID", () => {
  const e = editor();
  e.select("tank");
  e.select("pump", true);
  const originalGroup = e.groupSelected();
  const dest = e.createPage("目标");
  e.switchPage("main");
  e.select("tank");
  expect(e.snapshot().selectedIds).toHaveLength(2);
  const ids = e.copySelectedToPage(dest);
  expect(ids).toHaveLength(2);
  const copies = e.snapshot().document.pages[1]?.nodes ?? [];
  expect(copies.map((node) => node.id)).toEqual(ids);
  expect(copies[0]?.groupId).toBe(copies[1]?.groupId);
  expect(copies[0]?.groupId).not.toBe(originalGroup);
  expect(copies[0]?.bindings.level?.tagId).toBe("water.level");
  expect(copies[1]?.bindings.running?.tagId).toBe("water.pump.running");
});

test("跨页面复制不允许同页、无选中或未知目标，失败不污染工程", () => {
  const e = editor();
  const dest = e.createPage();
  e.switchPage("main");
  const before = e.snapshot();
  expect(() => e.copySelectedToPage(dest)).toThrow(/请先选择/);
  expect(() => e.copySelectedToPage("missing")).toThrow(/未找到页面/);
  expect(() => e.copySelectedToPage(undefined as never)).toThrow(/目标页面 ID/);
  expect(() => e.copySelectedToPage("")).toThrow(/目标页面 ID/);
  e.select("tank");
  const chosen = e.snapshot();
  expect(() => e.copySelectedToPage("main")).toThrow(/其他页面/);
  expect(e.snapshot()).toEqual(chosen);
  expect(before.document).toEqual(chosen.document);
});

test("跨页面复制遇到目标尺寸不足会拒绝，而不会破坏组合布局", () => {
  const source = JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
  source.pages.push({
    id: "small",
    name: "小画布",
    size: { width: 200, height: 200 },
    nodes: [],
  });
  const e = new DocumentEditor(source);
  e.select("tank");
  const before = e.snapshot();
  expect(() => e.copySelectedToPage("small")).toThrow(/超过目标页面画布/);
  expect(e.snapshot()).toEqual(before);
  e.select("flow");
  const copied = e.copySelectedToPage("small");
  expect(copied).toHaveLength(1);
  const node = e.snapshot().document.pages[1]?.nodes[0];
  expect(node?.transform.x).toBe(0);
  expect(node?.transform.y).toBe(168);
  expect(node?.transform.width).toBe(200);
  expect(node?.bindings.value?.tagId).toBe("water.flow");
});

test("跨页面复制与页面排序经 JSON 往返仍保留所有 Tag 和 ID", () => {
  const e = editor();
  const target = e.duplicatePage();
  e.switchPage("main");
  e.select("flow");
  const newNodes = e.copySelectedToPage(target);
  e.movePage(target, "previous");
  const doc = e.snapshot().document;
  const restored = editor();
  restored.loadDocument(JSON.parse(JSON.stringify(doc)));
  expect(restored.snapshot().document).toEqual(doc);
  expect(restored.snapshot().document.pages[0]?.id).toBe(target);
  expect(restored.snapshot().document.pages[0]?.nodes.some((node) => node.id === newNodes[0])).toBe(
    true,
  );
  expect(restored.snapshot().document.pages[0]?.nodes.at(-1)?.bindings.value?.tagId).toBe(
    "water.flow",
  );
});

test("跨页面复制多个图元在较小画布内整体平移且相对布局不变", () => {
  const source = JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
  source.pages.push({
    id: "compact",
    name: "紧凑页面",
    size: { width: 400, height: 250 },
    nodes: [],
  });
  const e = new DocumentEditor(source);
  e.select("pump");
  e.select("flow", true);
  const before = e
    .snapshot()
    .document.pages[0]!.nodes.filter((node) => ["pump", "flow"].includes(node.id));
  const ids = e.copySelectedToPage("compact");
  const copies = e.snapshot().document.pages[1]!.nodes;
  expect(ids).toEqual(copies.map((node) => node.id));
  expect(copies).toHaveLength(2);
  expect(copies[0]!.transform.x - before[0]!.transform.x).toBe(-430);
  expect(copies[1]!.transform.x - before[1]!.transform.x).toBe(-430);
  expect(copies[0]!.transform.y - before[0]!.transform.y).toBe(-47);
  expect(copies[1]!.transform.y - before[1]!.transform.y).toBe(-47);
  expect(copies[0]!.bindings.running?.tagId).toBe("water.pump.running");
  expect(copies[1]!.bindings.value?.tagId).toBe("water.flow");
});

test("目标画布不足时拒绝整组复制，不产生孤立的组合成员", () => {
  const source = JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
  source.pages.push({
    id: "compact",
    name: "紧凑页面",
    size: { width: 200, height: 200 },
    nodes: [],
  });
  const e = new DocumentEditor(source);
  e.select("tank");
  e.select("pump", true);
  e.groupSelected();
  const before = e.snapshot();
  expect(() => e.copySelectedToPage("compact")).toThrow(/超过目标页面画布/);
  expect(e.snapshot()).toEqual(before);
});

test("空选择复制和剪切不会清空已有工程或产生历史", () => {
  const e = editor();
  const before = e.snapshot();
  expect(e.copySelected()).toBe(false);
  expect(e.cutSelected()).toBe(false);
  expect(e.pasteClipboard()).toEqual([]);
  expect(e.snapshot()).toEqual(before);
});

test("复制所选只修改会话剪贴板，不产生文档历史", () => {
  const e = editor();
  e.select("tank");
  const before = e.snapshot();
  expect(e.copySelected()).toBe(true);
  expect(e.snapshot().hasClipboard).toBe(true);
  expect(e.snapshot().document).toEqual(before.document);
  expect(e.snapshot().canUndo).toBe(before.canUndo);
  expect(e.snapshot().selectedIds).toEqual(["tank"]);
});

test("重复粘贴按 20 像素递增偏移并重新生成唯一图元 ID", () => {
  const e = editor();
  e.select("tank");
  e.copySelected();
  const first = e.pasteClipboard();
  const second = e.pasteClipboard();
  expect(first).toHaveLength(1);
  expect(second).toHaveLength(1);
  expect(first[0]).not.toBe(second[0]);
  expect(e.snapshot().selectedIds).toEqual(second);
  const nodes = e.snapshot().document.pages[0]!.nodes;
  const one = nodes.find((node) => node.id === first[0]);
  const two = nodes.find((node) => node.id === second[0]);
  expect(one?.transform).toMatchObject({ x: 100, y: 145 });
  expect(two?.transform).toMatchObject({ x: 120, y: 165 });
  expect(one?.bindings.level?.tagId).toBe("water.level");
  expect(two?.bindings.level?.tagId).toBe("water.level");
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.some((node) => node.id === second[0])).toBe(false);
  expect(e.redo()).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.some((node) => node.id === second[0])).toBe(true);
});

test("剪切所选产生一次删除历史，剪贴板可以继续粘贴", () => {
  const e = editor();
  e.select("pump");
  const before = e.snapshot().document;
  expect(e.cutSelected()).toBe(true);
  expect(e.snapshot().selectedIds).toEqual([]);
  expect(e.snapshot().hasClipboard).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.some((node) => node.id === "pump")).toBe(false);
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document).toEqual(before);
  expect(e.redo()).toBe(true);
  const added = e.pasteClipboard();
  expect(added).toHaveLength(1);
  expect(added[0]).not.toBe("pump");
  expect(
    e.snapshot().document.pages[0]?.nodes.find((node) => node.id === added[0])?.bindings.running
      ?.tagId,
  ).toBe("water.pump.running");
});

test("复制与剪切组合均自动包含全部成员，粘贴生成新的完整组", () => {
  const e = editor();
  e.select("tank");
  e.select("pump", true);
  const group = e.groupSelected();
  e.select("tank");
  expect(e.snapshot().selectedIds).toHaveLength(2);
  expect(e.copySelected()).toBe(true);
  const copies = e.pasteClipboard();
  expect(copies).toHaveLength(2);
  const nodes = e.snapshot().document.pages[0]!.nodes;
  const groupIds = copies.map((id) => nodes.find((node) => node.id === id)?.groupId);
  expect(groupIds[0]).toBeDefined();
  expect(groupIds[0]).toBe(groupIds[1]);
  expect(groupIds[0]).not.toBe(group);
  e.select("pump");
  expect(e.cutSelected()).toBe(true);
  expect(e.snapshot().document.pages[0]?.nodes.filter((node) => node.groupId === group)).toEqual(
    [],
  );
  expect(e.undo()).toBe(true);
  expect(
    e.snapshot().document.pages[0]?.nodes.filter((node) => node.groupId === group),
  ).toHaveLength(2);
});

test("粘贴保留图元层级、文本属性、Tag 绑定和规则", () => {
  const e = editor();
  e.select("flow");
  e.select("title", true);
  const original = e
    .snapshot()
    .document.pages[0]!.nodes.filter((node) => ["title", "flow"].includes(node.id));
  e.copySelected();
  const added = e.pasteClipboard();
  expect(added).toHaveLength(2);
  const appended = e.snapshot().document.pages[0]!.nodes.slice(-2);
  expect(appended.map((node) => node.id)).toEqual(added);
  expect(appended.map((node) => node.type)).toEqual(original.map((node) => node.type));
  expect(appended.map((node) => node.props)).toEqual(original.map((node) => node.props));
  expect(appended.map((node) => node.bindings)).toEqual(original.map((node) => node.bindings));
  expect(appended.map((node) => node.rules)).toEqual(original.map((node) => node.rules));
});

test("切换页面不丢失剪贴板，粘贴仅改变当前目标页面", () => {
  const e = editor();
  e.select("tank");
  e.copySelected();
  const pageId = e.createPage("第二页");
  const source = e.snapshot().document.pages[0];
  const ids = e.pasteClipboard();
  expect(ids).toHaveLength(1);
  expect(e.snapshot().activePageId).toBe(pageId);
  expect(e.snapshot().document.pages[0]).toEqual(source);
  expect(e.snapshot().document.pages[1]?.nodes[0]?.id).toBe(ids[0]);
  expect(e.snapshot().document.pages[1]?.nodes[0]?.bindings.level?.tagId).toBe("water.level");
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document.pages[1]?.nodes).toEqual([]);
  expect(e.redo()).toBe(true);
  expect(e.snapshot().document.pages[1]?.nodes[0]?.id).toBe(ids[0]);
});

test("粘贴到较小画布时整体调整位置并保留绑定", () => {
  const source = JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
  source.pages.push({
    id: "smaller",
    name: "较小画布",
    size: { width: 250, height: 250 },
    nodes: [],
  });
  const e = new DocumentEditor(source);
  e.select("tank");
  e.copySelected();
  e.switchPage("smaller");
  const ids = e.pasteClipboard();
  expect(ids).toHaveLength(1);
  const node = e.snapshot().document.pages[1]?.nodes[0];
  expect(node?.transform).toMatchObject({ x: 100, y: 45, width: 150, height: 205 });
  expect(node?.bindings.level?.tagId).toBe("water.level");
});

test("剪贴板图元过大时粘贴原子拒绝，仍能到其他页成功粘贴", () => {
  const source = JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
  source.pages.push({
    id: "small",
    name: "小画布",
    size: { width: 200, height: 100 },
    nodes: [],
  });
  const e = new DocumentEditor(source);
  e.select("tank");
  e.copySelected();
  e.switchPage("small");
  const before = e.snapshot();
  expect(() => e.pasteClipboard()).toThrow(/超过当前页面画布/);
  expect(e.snapshot()).toEqual(before);
  e.switchPage("main");
  const ids = e.pasteClipboard();
  expect(ids).toHaveLength(1);
  const pasted = e.snapshot().document.pages[0]?.nodes.find((node) => node.id === ids[0]);
  expect(pasted?.transform).toMatchObject({ x: 100, y: 145 });
});

test("复制后修改源图元不会改变剪贴板快照", () => {
  const e = editor();
  e.select("title");
  e.copySelected();
  e.setSelectedLabel("源图元新文案");
  const ids = e.pasteClipboard();
  const page = e.snapshot().document.pages[0]!;
  expect(page.nodes.find((node) => node.id === "title")?.props.text).toBe("源图元新文案");
  expect(page.nodes.find((node) => node.id === ids[0])?.props.text).toBe("水处理系统 / V0.1");
});

test("重复粘贴到画布边缘仅限制整体偏移，不会越界或缩放", () => {
  const e = editor();
  e.select("flow");
  e.copySelected();
  let last = "";
  for (let index = 0; index < 5; index++) {
    const ids = e.pasteClipboard();
    last = ids[0]!;
  }
  const node = e.snapshot().document.pages[0]?.nodes.find((item) => item.id === last);
  expect(node?.transform).toMatchObject({ x: 680, y: 325, width: 200, height: 32 });
  expect(node?.bindings.value?.tagId).toBe("water.flow");
});

test("合法工程重新加载清空剪贴板，失败导入保留已有剪贴板", () => {
  const e = editor();
  e.select("pump");
  e.copySelected();
  expect(e.snapshot().hasClipboard).toBe(true);
  const before = e.snapshot();
  expect(() => e.loadDocument({ invalid: true })).toThrow(/工程版本/);
  expect(e.snapshot()).toEqual(before);
  e.loadDocument(JSON.parse(JSON.stringify(before.document)));
  expect(e.snapshot().hasClipboard).toBe(false);
  expect(e.pasteClipboard()).toEqual([]);
  expect(e.snapshot().canUndo).toBe(false);
});

test("图元剪贴板内容不会写入工程 JSON，双框架数据契约不变", () => {
  const e = editor();
  e.select("tank");
  e.copySelected();
  e.pasteClipboard();
  const saved = JSON.parse(JSON.stringify(e.snapshot().document));
  expect(JSON.stringify(saved)).not.toContain("clipboard");
  expect(JSON.stringify(saved)).not.toContain("hasClipboard");
  const other = editor();
  other.loadDocument(saved);
  expect(other.snapshot().document).toEqual(e.snapshot().document);
  expect(other.snapshot().hasClipboard).toBe(false);
});

test("旧工程未声明图层状态时图元默认未锁定且可见", () => {
  const e = editor();
  const nodes = e.snapshot().document.pages[0]!.nodes;
  expect(nodes.every((node) => !studioNodeLocked(node))).toBe(true);
  expect(nodes.every(studioNodeVisible)).toBe(true);
});

test("批量锁定、解锁共用一次历史并保持 Tag 和几何", () => {
  const e = editor();
  e.select("tank");
  e.select("pump", true);
  const initial = e.snapshot().document;
  expect(e.setSelectedLocked(true)).toBe(true);
  const locked = e.snapshot().document.pages[0]!.nodes;
  expect(locked.filter((node) => ["tank", "pump"].includes(node.id)).every(studioNodeLocked)).toBe(true);
  expect(e.setSelectedLocked(true)).toBe(false);
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document).toEqual(initial);
  expect(e.redo()).toBe(true);
  expect(
    e.snapshot().document.pages[0]!.nodes
      .filter((node) => ["tank", "pump"].includes(node.id))
      .every(studioNodeLocked),
  ).toBe(true);
  expect(e.setSelectedLocked(false)).toBe(true);
  expect(e.snapshot().document).toEqual(initial);
});

test("批量显示和隐藏不删除图元、Tag 或规则，支持撤销", () => {
  const e = editor();
  e.select("tank");
  e.select("pump", true);
  const original = e.snapshot().document;
  expect(e.setSelectedVisible(false)).toBe(true);
  const hidden = e
    .snapshot()
    .document.pages[0]!.nodes.filter((node) => ["tank", "pump"].includes(node.id));
  expect(hidden.every((node) => !studioNodeVisible(node))).toBe(true);
  expect(hidden[0]?.bindings.level?.tagId).toBe("water.level");
  expect(hidden[1]?.bindings.running?.tagId).toBe("water.pump.running");
  expect(e.setSelectedVisible(false)).toBe(false);
  expect(e.undo()).toBe(true);
  expect(e.snapshot().document).toEqual(original);
  expect(e.redo()).toBe(true);
  expect(e.setSelectedVisible(true)).toBe(true);
  expect(e.snapshot().document).toEqual(original);
});

test("锁定图元禁止移动、删除、剪切、复制、对齐及几何编辑", () => {
  const e = editor();
  e.select("tank");
  e.setSelectedLocked(true);
  const original = e.snapshot();
  expect(() => e.moveBy(10, 10)).toThrow(/锁定/);
  expect(() => e.deleteSelected()).toThrow(/锁定/);
  expect(() => e.cutSelected()).toThrow(/锁定/);
  expect(() => e.copySelected()).toThrow(/锁定/);
  expect(() => e.updateSelectedTransform({ x: 150 })).toThrow(/锁定/);
  expect(() => e.setSelectedBinding("level", "water.flow")).toThrow(/锁定/);
  expect(() => withNodesTranslated(original.document, ["tank"], 10, 0)).toThrow(/锁定/);
  expect(() => withNodeTransform(original.document, "tank", { y: 140 })).toThrow(/锁定/);
  expect(() =>
    resolveDragSnap(
      original.document,
      ["tank"],
      5,
      5,
      { gridEnabled: true, nodeEnabled: true },
    ),
  ).toThrow(/锁定/);
  e.select("tank");
  e.select("pump", true);
  expect(() => e.alignSelected("left")).toThrow(/锁定/);
  expect(e.snapshot().document).toEqual(original.document);
});

test("组合包含锁定成员时移动和解组均原子拒绝，解锁后可操作", () => {
  const e = editor();
  e.select("tank");
  e.select("pump", true);
  e.groupSelected();
  e.select("tank");
  e.setSelectedLocked(true);
  const before = e.snapshot();
  expect(() => e.moveBy(12, 12)).toThrow(/锁定/);
  expect(() => e.ungroupSelected()).toThrow(/锁定/);
  expect(e.snapshot()).toEqual(before);
  expect(e.setSelectedLocked(false)).toBe(true);
  expect(e.ungroupSelected()).toBe(true);
});

test("存在锁定成员时不能重新组合或通过选择其他图元间接修改", () => {
  const e = editor();
  e.select("tank");
  e.setSelectedLocked(true);
  e.select("pump", true);
  const before = e.snapshot();
  expect(() => e.groupSelected()).toThrow(/锁定/);
  expect(() => e.deleteSelected()).toThrow(/锁定/);
  expect(e.snapshot()).toEqual(before);
});

test("排序不得间接移动锁定图元，删除含锁定图元的页面需先解锁", () => {
  const e = editor();
  e.select("tank");
  e.setSelectedLocked(true);
  e.select("pump");
  const before = e.snapshot();
  expect(() => e.reorderSelected("back")).toThrow(/锁定/);
  expect(e.snapshot()).toEqual(before);
  const otherPageId = e.createPage();
  expect(() => e.deletePage("main")).toThrow(/锁定/);
  e.switchPage("main");
  e.select("tank");
  e.setSelectedLocked(false);
  expect(e.deletePage("main")).toBe(true);
  expect(e.snapshot().activePageId).toBe(otherPageId);
});

test("锁定状态不阻止复制整页，原始和副本的图元保护仍有效", () => {
  const e = editor();
  e.select("tank");
  e.setSelectedLocked(true);
  const copyId = e.duplicatePage();
  const page = e.snapshot().document.pages.find((item) => item.id === copyId);
  expect(
    page?.nodes.find((node) => node.bindings.level?.tagId === "water.level" && studioNodeLocked(node)),
  ).toBeDefined();
  e.switchPage("main");
  e.select("tank");
  expect(() => e.copySelectedToPage(copyId)).toThrow(/锁定/);
});

test("隐藏图元不能被画布框选，但仍可以从图层列表选中并重新显示", () => {
  const e = editor();
  e.select("tank");
  e.setSelectedVisible(false);
  const document = e.snapshot().document;
  expect(findNodesInRect(document, 0, 0, 400, 400)).not.toContain("tank");
  e.select("tank");
  expect(e.snapshot().selectedIds).toEqual(["tank"]);
  expect(e.setSelectedVisible(true)).toBe(true);
  expect(findNodesInRect(e.snapshot().document, 0, 0, 400, 400)).toContain("tank");
});

test("锁定图元不能隐藏，批量可见性操作遇到锁定成员原子拒绝", () => {
  const e = editor();
  e.select("tank");
  e.setSelectedLocked(true);
  e.select("pump", true);
  const before = e.snapshot();
  expect(() => e.setSelectedVisible(false)).toThrow(/锁定/);
  expect(e.snapshot()).toEqual(before);
  e.setSelectedLocked(false);
  expect(e.setSelectedVisible(false)).toBe(true);
});

test("隐藏目标不参与图元吸附，但保留于工程节点列表", () => {
  const e = editor();
  e.select("pump");
  e.setSelectedVisible(false);
  e.select("tank");
  const snap = resolveDragSnap(
    e.snapshot().document,
    ["tank"],
    0,
    0,
    { gridEnabled: false, nodeEnabled: true },
  );
  expect(snap).toEqual({ dx: 0, dy: 0, verticalGuide: null, horizontalGuide: null });
  expect(e.snapshot().document.pages[0]!.nodes.some((node) => node.id === "pump")).toBe(true);
});

test("锁定与隐藏状态经过 JSON 导入导出后保持一致且不会污染新 Schema 字段", () => {
  const e = editor();
  e.select("tank");
  e.setSelectedVisible(false);
  e.setSelectedLocked(true);
  const json = JSON.parse(JSON.stringify(e.snapshot().document));
  expect(
    json.pages[0].nodes.find((node: { id: string }) => node.id === "tank").props.__scadaStudio,
  ).toEqual({
    visible: false,
    locked: true,
  });
  expect(json.pages[0].nodes.find((node: { id: string }) => node.id === "tank").locked).toBeUndefined();
  const other = editor();
  other.loadDocument(json);
  const restored = other.snapshot().document.pages[0]!.nodes.find((node) => node.id === "tank")!;
  expect(studioNodeLocked(restored)).toBe(true);
  expect(studioNodeVisible(restored)).toBe(false);
});

test("状态命令拒绝非法布尔输入并保留完整工程及历史", () => {
  const e = editor();
  e.select("tank");
  const before = e.snapshot();
  expect(() => e.setSelectedLocked("true" as never)).toThrow(/布尔值/);
  expect(() => e.setSelectedVisible(0 as never)).toThrow(/布尔值/);
  expect(e.snapshot()).toEqual(before);
});

test("隐藏状态可与复制剪贴板和跨页面编辑安全共存", () => {
  const e = editor();
  e.select("tank");
  e.setSelectedVisible(false);
  e.copySelected();
  const second = e.createPage();
  const ids = e.pasteClipboard();
  const pasted = e.snapshot().document.pages[1]!.nodes.find((node) => node.id === ids[0])!;
  expect(studioNodeVisible(pasted)).toBe(false);
  e.select(ids[0]!);
  e.setSelectedVisible(true);
  expect(studioNodeVisible(e.snapshot().document.pages[1]!.nodes[0]!)).toBe(true);
  e.switchPage("main");
  expect(
    studioNodeVisible(e.snapshot().document.pages[0]!.nodes.find((node) => node.id === "tank")!),
  ).toBe(false);
  expect(second).toBe("page-1");
});
