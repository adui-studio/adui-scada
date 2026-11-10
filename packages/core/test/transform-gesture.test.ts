import { expect, test } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "../src/demo-document.ts";
import {
  DocumentEditor,
  RESIZE_HANDLES,
  RESIZE_HANDLE_LABELS,
  resizeHandlePosition,
  resolveResizeTransform,
  resolveRotationTransform,
  withNodeTransform,
} from "../src/editor.ts";

function tankTransform() {
  const node = waterTreatmentDemoDocument.pages[0]?.nodes.find((item) => item.id === "tank");
  if (!node) throw new Error("测试工程缺少水箱图元");
  return node.transform;
}

test("四角按住 Shift 时锁定原始宽高比，普通拖动保持原行为", () => {
  const transform = { x: 100, y: 100, width: 160, height: 80, rotation: 0 };
  expect(resolveResizeTransform(transform, "se", 32, 0)).toEqual({
    x: 100,
    y: 100,
    width: 192,
    height: 80,
    rotation: 0,
  });
  expect(resolveResizeTransform(transform, "se", 32, 0, true)).toEqual({
    x: 100,
    y: 100,
    width: 192,
    height: 96,
    rotation: 0,
  });
});

test("四角等比例缩放选择变化幅度较大的轴并固定对角点", () => {
  const transform = { x: 100, y: 100, width: 160, height: 80, rotation: 0 };
  const nw = resolveResizeTransform(transform, "nw", 5, 20, true);
  expect(nw).toEqual({ x: 140, y: 120, width: 120, height: 60, rotation: 0 });
  expect(nw.x + nw.width).toBe(transform.x + transform.width);
  expect(nw.y + nw.height).toBe(transform.y + transform.height);

  const se = resolveResizeTransform(transform, "se", 32, -25, true);
  expect(se).toEqual({ x: 100, y: 100, width: 110, height: 55, rotation: 0 });
  expect(se.width / se.height).toBe(2);
});

test("左右边中点等比例缩放时高度围绕原中心同步变化", () => {
  const transform = { x: 100, y: 100, width: 160, height: 80, rotation: 0 };
  const east = resolveResizeTransform(transform, "e", 32, 70, true);
  expect(east).toEqual({ x: 100, y: 92, width: 192, height: 96, rotation: 0 });
  const west = resolveResizeTransform(transform, "w", -32, -50, true);
  expect(west).toEqual({ x: 68, y: 92, width: 192, height: 96, rotation: 0 });
  expect(west.x + west.width).toBe(transform.x + transform.width);
});

test("上下边中点等比例缩放时宽度围绕原中心同步变化", () => {
  const transform = { x: 100, y: 100, width: 160, height: 80, rotation: 0 };
  const north = resolveResizeTransform(transform, "n", 30, -16, true);
  expect(north).toEqual({ x: 84, y: 84, width: 192, height: 96, rotation: 0 });
  const south = resolveResizeTransform(transform, "s", -30, 16, true);
  expect(south).toEqual({ x: 84, y: 100, width: 192, height: 96, rotation: 0 });
  expect(south.y).toBe(transform.y);
});

test("九十度旋转图元等比例缩放后固定对侧锚点", () => {
  const transform = { x: 100, y: 100, width: 100, height: 80, rotation: 90 };
  const east = resolveResizeTransform(transform, "e", 0, 20, true);
  expect(east).toEqual({ x: 90, y: 102, width: 120, height: 96, rotation: 90 });
  const se = resolveResizeTransform(transform, "se", 0, 20, true);
  expect(se).toEqual({ x: 82, y: 102, width: 120, height: 96, rotation: 90 });

  // 左侧中点的旋转后世界位置保持不变。
  expect(east.y + east.height / 2 - east.width / 2).toBe(
    transform.y + transform.height / 2 - transform.width / 2,
  );
  // 左上角的旋转后世界坐标保持不变。
  expect(se.x + se.width / 2 + se.height / 2).toBe(
    transform.x + transform.width / 2 + transform.height / 2,
  );
});

test("任意角度等比例缩放保持原宽高比和对侧旋转锚点", () => {
  const transform = { x: 100, y: 120, width: 150, height: 80, rotation: 30 };
  const changed = resolveResizeTransform(transform, "ne", 28, -15, true);
  expect(changed.width / changed.height).toBeCloseTo(transform.width / transform.height, 2);

  const oppositeCorner = (node: typeof transform) => {
    const angle = (node.rotation * Math.PI) / 180;
    const centerX = node.x + node.width / 2;
    const centerY = node.y + node.height / 2;
    return {
      x: centerX - (node.width / 2) * Math.cos(angle) - (node.height / 2) * Math.sin(angle),
      y: centerY - (node.width / 2) * Math.sin(angle) + (node.height / 2) * Math.cos(angle),
    };
  };
  expect(oppositeCorner(changed).x).toBeCloseTo(oppositeCorner(transform).x, 1);
  expect(oppositeCorner(changed).y).toBeCloseTo(oppositeCorner(transform).y, 1);
});

test("等比例缩放拒绝非法尺寸，零位移和切线位移不污染高精度数据", () => {
  const transform = { x: 10.123, y: 20.456, width: 160, height: 80, rotation: 0 };
  expect(resolveResizeTransform(transform, "nw", 0, 0, true)).toEqual(transform);
  expect(resolveResizeTransform(transform, "e", 0, 60, true)).toEqual(transform);
  expect(() => resolveResizeTransform(transform, "e", -200, 0, true)).toThrow(/不能小于/);
  expect(() => resolveResizeTransform(transform, "w", Number.POSITIVE_INFINITY, 0, true)).toThrow(
    /有限数/,
  );
});

test("等比例预览不改变工程，提交后撤销重做及 Tag 绑定一致", () => {
  const editor = new DocumentEditor(waterTreatmentDemoDocument);
  editor.select("tank");
  const before = editor.snapshot().document;
  const oldTransform = tankTransform();
  const patch = resolveResizeTransform(oldTransform, "e", -10, 0, true);
  const preview = withNodeTransform(before, "tank", patch);
  expect(editor.snapshot().document).toEqual(before);
  expect(editor.updateSelectedTransform(patch)).toBe(true);
  expect(editor.snapshot().document).toEqual(preview);
  expect(editor.snapshot().document.pages[0]?.nodes.find((n) => n.id === "tank")?.bindings.level?.tagId).toBe(
    "water.level",
  );
  expect(editor.undo()).toBe(true);
  expect(editor.snapshot().document).toEqual(before);
  expect(editor.redo()).toBe(true);
  expect(editor.snapshot().document).toEqual(preview);
});

test("等比例尺寸超出画布时共享命令拒绝修改并保留历史", () => {
  const editor = new DocumentEditor(waterTreatmentDemoDocument);
  editor.select("tank");
  const before = editor.snapshot();
  const transform = tankTransform();
  const patch = resolveResizeTransform(transform, "e", 10000, 0, true);
  expect(() => withNodeTransform(before.document, "tank", patch)).toThrow();
  expect(() => editor.updateSelectedTransform(patch)).toThrow();
  expect(editor.snapshot()).toEqual(before);
});

test("八方向缩放手柄的类型、顺序和中文名称稳定", () => {
  expect(RESIZE_HANDLES).toEqual(["nw", "n", "ne", "e", "se", "s", "sw", "w"]);
  expect(RESIZE_HANDLES.map((handle) => RESIZE_HANDLE_LABELS[handle])).toEqual([
    "左上角",
    "上边中点",
    "右上角",
    "右边中点",
    "右下角",
    "下边中点",
    "左下角",
    "左边中点",
  ]);
});

test("八方向控制点沿局部矩形边缘和中点分布", () => {
  const transform = { x: 100, y: 120, width: 160, height: 80, rotation: 45 };
  expect(RESIZE_HANDLES.map((handle) => resizeHandlePosition(transform, handle))).toEqual([
    { x: 100, y: 120 },
    { x: 180, y: 120 },
    { x: 260, y: 120 },
    { x: 260, y: 160 },
    { x: 260, y: 200 },
    { x: 180, y: 200 },
    { x: 100, y: 200 },
    { x: 100, y: 160 },
  ]);
  expect(() => resizeHandlePosition(transform, "unknown" as never)).toThrow(/缩放手柄/);
});

test("上下中点仅改变高度且对侧边沿不移动", () => {
  const t = { x: 100, y: 100, width: 160, height: 80, rotation: 0 };
  const north = resolveResizeTransform(t, "n", 25, -15);
  expect(north).toEqual({ x: 100, y: 85, width: 160, height: 95, rotation: 0 });
  expect(north.y + north.height).toBe(t.y + t.height);
  const south = resolveResizeTransform(t, "s", 25, 20);
  expect(south).toEqual({ x: 100, y: 100, width: 160, height: 100, rotation: 0 });
});

test("左右中点仅改变宽度且对侧边沿不移动", () => {
  const t = { x: 100, y: 100, width: 160, height: 80, rotation: 0 };
  const west = resolveResizeTransform(t, "w", -25, 18);
  expect(west).toEqual({ x: 75, y: 100, width: 185, height: 80, rotation: 0 });
  expect(west.x + west.width).toBe(t.x + t.width);
  const east = resolveResizeTransform(t, "e", 25, 18);
  expect(east).toEqual({ x: 100, y: 100, width: 185, height: 80, rotation: 0 });
});

test("单轴手柄沿切线移动时不改变高精度小数几何属性", () => {
  const t = { x: 10.123, y: 20.456, width: 36.789, height: 50.123, rotation: 0 };
  expect(resolveResizeTransform(t, "e", 0, 50)).toEqual(t);
  expect(resolveResizeTransform(t, "n", 60, 0)).toEqual(t);
  const rotated = { ...t, rotation: 90 };
  expect(resolveResizeTransform(rotated, "e", 50, 0)).toEqual(rotated);
  expect(resolveResizeTransform(rotated, "n", 0, 50)).toEqual(rotated);
});

test("九十度旋转图元右中点缩放固定左侧边中点", () => {
  const t = { x: 100, y: 100, width: 100, height: 80, rotation: 90 };
  const east = resolveResizeTransform(t, "e", 30, 20);
  expect(east).toEqual({ x: 90, y: 110, width: 120, height: 80, rotation: 90 });
  expect(east.x + east.width / 2).toBe(t.x + t.width / 2);
  expect(east.y + east.height / 2 - east.width / 2).toBe(t.y + t.height / 2 - t.width / 2);
});

test("非直角旋转图元单轴缩放固定对侧旋转中点", () => {
  const t = { x: 100, y: 120, width: 150, height: 80, rotation: 30 };
  const changed = resolveResizeTransform(t, "n", 45, -25);
  expect(changed.width).toBe(t.width);
  const anchor = (node: typeof t) => ({
    x: node.x + node.width / 2 - Math.sin((node.rotation * Math.PI) / 180) * (node.height / 2),
    y: node.y + node.height / 2 + Math.cos((node.rotation * Math.PI) / 180) * (node.height / 2),
  });
  expect(anchor(changed).x).toBeCloseTo(anchor(t).x, 1);
  expect(anchor(changed).y).toBeCloseTo(anchor(t).y, 1);
});

test("单轴缩放经过共享命令后可撤销并拒绝越界及非法尺寸", () => {
  const editor = new DocumentEditor(waterTreatmentDemoDocument);
  editor.select("tank");
  const before = editor.snapshot();
  const original = tankTransform();
  const valid = resolveResizeTransform(original, "e", 25, 0);
  expect(editor.updateSelectedTransform(valid)).toBe(true);
  expect(editor.undo()).toBe(true);
  expect(editor.snapshot().document).toEqual(before.document);
  expect(() => resolveResizeTransform(original, "w", original.width + 10, 0)).toThrow(/不能小于/);
  const boundary = resolveResizeTransform(original, "w", -100, 0);
  expect(() => withNodeTransform(before.document, "tank", boundary)).toThrow(/画布范围/);
  expect(editor.snapshot().document).toEqual(before.document);
});

test("左上角缩放保持右下角固定", () => {
  const original = tankTransform();
  const changed = resolveResizeTransform(original, "nw", 20, 30);
  expect(changed.x).toBe(original.x + 20);
  expect(changed.y).toBe(original.y + 30);
  expect(changed.width).toBe(original.width - 20);
  expect(changed.height).toBe(original.height - 30);
  expect(changed.x + changed.width).toBe(original.x + original.width);
  expect(changed.y + changed.height).toBe(original.y + original.height);
});

test("右下角缩放保持左上角固定", () => {
  const original = tankTransform();
  const changed = resolveResizeTransform(original, "se", 25, -5);
  expect(changed.x).toBe(original.x);
  expect(changed.y).toBe(original.y);
  expect(changed.width).toBe(original.width + 25);
  expect(changed.height).toBe(original.height - 5);
});

test("手柄单击不应改变原有高精度小数属性", () => {
  const transform = { x: 10.123, y: 20.456, width: 36.789, height: 50.123, rotation: 12.345 };
  expect(resolveResizeTransform(transform, "nw", 0, 0)).toEqual(transform);
  expect(resolveRotationTransform(transform, 28, 0, 28, 0)).toEqual(transform);
  expect(resolveRotationTransform(transform, 28, 0, 28, 0, true)).toEqual(transform);
});

test("旋转图元的四角缩放按局部坐标计算并保持对角锚点", () => {
  const transform = { x: 100, y: 100, width: 100, height: 80, rotation: 90 };
  const changed = resolveResizeTransform(transform, "se", 0, 20);
  expect(changed).toEqual({ x: 90, y: 110, width: 120, height: 80, rotation: 90 });
  // 原左上角旋转后的全局坐标为 (190, 90)，缩放后仍保持不变。
  const oldAnchorX = transform.x + transform.width / 2 + transform.height / 2;
  const newAnchorX = changed.x + changed.width / 2 + changed.height / 2;
  expect(newAnchorX).toBe(oldAnchorX);
});

test("零位移缩放不改变原有几何属性", () => {
  const original = tankTransform();
  for (const handle of RESIZE_HANDLES) {
    expect(resolveResizeTransform(original, handle, 0, 0)).toEqual(original);
  }
});

test("非法缩放输入和尺寸过小会被拒绝", () => {
  const transform = tankTransform();
  expect(() => resolveResizeTransform(transform, "ne", Number.NaN, 0)).toThrow(/有限数/);
  expect(() => resolveResizeTransform(transform, "none" as never, 0, 0)).toThrow(/缩放手柄/);
  expect(() => resolveResizeTransform(transform, "se", -1000, 0)).toThrow(/不能小于/);
});

test("旋转手柄以节点中心为轴计算角度", () => {
  const transform = { x: 100, y: 100, width: 100, height: 80, rotation: 0 };
  const result = resolveRotationTransform(transform, 150, 100, 190, 140);
  expect(result.rotation).toBe(90);
  expect(result.x).toBe(transform.x);
  expect(result.y).toBe(transform.y);
  expect(result.width).toBe(transform.width);
  expect(result.height).toBe(transform.height);
});

test("按住 Shift 旋转以十五度为单位吸附", () => {
  const transform = { x: 100, y: 100, width: 100, height: 80, rotation: 0 };
  const loose = resolveRotationTransform(transform, 150, 100, 170, 110);
  const snapped = resolveRotationTransform(transform, 150, 100, 170, 110, true);
  expect(loose.rotation).toBeCloseTo(33.69, 1);
  expect(snapped.rotation).toBe(30);
});

test("旋转手柄跨过正负一百八十度时连续计算", () => {
  const transform = { x: 100, y: 100, width: 100, height: 80, rotation: 0 };
  const changed = resolveRotationTransform(transform, 100, 140, 100, 139);
  expect(Math.abs(changed.rotation)).toBeLessThan(2);
  expect(() => resolveRotationTransform(transform, Infinity, 140, 100, 139)).toThrow(/有限数/);
});

test("拖拽缩放预览不改变工程，松开后仅生成一条可撤销命令", () => {
  const editor = new DocumentEditor(waterTreatmentDemoDocument);
  editor.select("tank");
  const before = editor.snapshot().document;
  const transform = before.pages[0]?.nodes.find((node) => node.id === "tank")?.transform;
  if (!transform) throw new Error("测试数据缺少水箱图元");

  const patch = resolveResizeTransform(transform, "se", 30, 20);
  const preview = withNodeTransform(before, "tank", patch);
  expect(editor.snapshot().document).toEqual(before);
  expect(editor.snapshot().canUndo).toBe(false);
  expect(editor.updateSelectedTransform(patch)).toBe(true);
  expect(editor.snapshot().document).toEqual(preview);
  const updatedTank = editor.snapshot().document.pages[0]?.nodes.find((node) => node.id === "tank");
  expect(updatedTank?.bindings.level?.tagId).toBe("water.level");
  expect(editor.undo()).toBe(true);
  expect(editor.snapshot().document).toEqual(before);
  expect(editor.redo()).toBe(true);
  expect(editor.snapshot().document).toEqual(preview);
});

test("越界缩放不会覆盖工程或污染历史", () => {
  const editor = new DocumentEditor(waterTreatmentDemoDocument);
  editor.select("tank");
  const before = editor.snapshot();
  const transform = tankTransform();
  const patch = resolveResizeTransform(transform, "nw", -100, -150);
  expect(() => withNodeTransform(before.document, "tank", patch)).toThrow(/画布范围/);
  expect(() => editor.updateSelectedTransform(patch)).toThrow(/画布范围/);
  expect(editor.snapshot()).toEqual(before);
});
