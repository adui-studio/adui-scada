import { expect, test } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "../src/demo-document.ts";
import {
  DocumentEditor,
  RESIZE_HANDLES,
  resolveResizeTransform,
  resolveRotationTransform,
  withNodeTransform,
} from "../src/editor.ts";

function tankTransform() {
  const node = waterTreatmentDemoDocument.pages[0]?.nodes.find((item) => item.id === "tank");
  if (!node) throw new Error("测试工程缺少水箱图元");
  return node.transform;
}

test("四角缩放手柄的类型和顺序稳定", () => {
  expect(RESIZE_HANDLES).toEqual(["nw", "ne", "se", "sw"]);
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
  expect(() => resolveRotationTransform(transform, Infinity, 140, 100, 139)).toThrow(
    /有限数/,
  );
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
  const updatedTank = editor
    .snapshot()
    .document.pages[0]?.nodes.find((node) => node.id === "tank");
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
