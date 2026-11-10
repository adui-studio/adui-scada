import type { ScadaNode } from "./document.ts";

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const RESIZE_HANDLES: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export const RESIZE_HANDLE_LABELS: Record<ResizeHandle, string> = {
  nw: "左上角",
  n: "上边中点",
  ne: "右上角",
  e: "右边中点",
  se: "右下角",
  s: "下边中点",
  sw: "左下角",
  w: "左边中点",
};

type Transform = ScadaNode["transform"];

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${label}必须为有限数`);
}

function rounded(value: number): number {
  const result = Math.round(value * 100) / 100;
  return result === 0 ? 0 : result;
}

function handleSigns(handle: ResizeHandle): { horizontal: number; vertical: number } {
  if (!RESIZE_HANDLES.includes(handle)) throw new TypeError("不支持的缩放手柄");
  return {
    horizontal: handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0,
    vertical: handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0,
  };
}

/** 返回局部矩形上的八方向手柄坐标；视图层负责整体旋转。 */
export function resizeHandlePosition(
  transform: Transform,
  handle: ResizeHandle,
): { x: number; y: number } {
  const { horizontal, vertical } = handleSigns(handle);
  const x = horizontal === 0 ? transform.width / 2 : horizontal > 0 ? transform.width : 0;
  const y = vertical === 0 ? transform.height / 2 : vertical > 0 ? transform.height : 0;
  return { x: transform.x + x, y: transform.y + y };
}

/**
 * 四角双轴、四边中点单轴缩放；旋转后的对侧角点或边中点保持固定。
 * 鼠标世界坐标位移先投影至图元局部坐标，再按实际宽高变化求中心移动。
 * 候选结果交由 withNodeTransform 统一校验画布范围与尺寸。
 */
export function resolveResizeTransform(
  transform: Transform,
  handle: ResizeHandle,
  dx: number,
  dy: number,
): Transform {
  finite(dx, "水平缩放位移");
  finite(dy, "垂直缩放位移");
  const { horizontal, vertical } = handleSigns(handle);
  if (dx === 0 && dy === 0) return { ...transform };

  const angle = (transform.rotation * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const localDx = cosine * dx + sine * dy;
  const localDy = -sine * dx + cosine * dy;

  // 单轴缩放忽略切线位移；极小的三角函数浮点误差也不应改变原有精度。
  const xDelta = horizontal === 0 || Math.abs(localDx) < 1e-9 ? 0 : localDx;
  const yDelta = vertical === 0 || Math.abs(localDy) < 1e-9 ? 0 : localDy;
  if (xDelta === 0 && yDelta === 0) return { ...transform };

  const width = xDelta === 0 ? transform.width : rounded(transform.width + horizontal * xDelta);
  const height = yDelta === 0 ? transform.height : rounded(transform.height + vertical * yDelta);
  if (width < 0.1 || height < 0.1) {
    throw new RangeError("缩放后的图元宽度和高度不能小于 0.1");
  }
  if (width === transform.width && height === transform.height) return { ...transform };

  const localCenterDx = (horizontal * (width - transform.width)) / 2;
  const localCenterDy = (vertical * (height - transform.height)) / 2;
  const centerX = transform.x + transform.width / 2 + cosine * localCenterDx - sine * localCenterDy;
  const centerY =
    transform.y + transform.height / 2 + sine * localCenterDx + cosine * localCenterDy;
  return {
    ...transform,
    x: rounded(centerX - width / 2),
    y: rounded(centerY - height / 2),
    width,
    height,
  };
}

/**
 * 旋转手柄围绕原节点中心计算角度。Shift 可按 15 度吸附。
 * 角度规范在现有 Schema 允许的 -360～360 范围内。
 */
export function resolveRotationTransform(
  transform: Transform,
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  snapTo15Degrees = false,
): Transform {
  for (const [value, label] of [
    [startX, "旋转起点 X"],
    [startY, "旋转起点 Y"],
    [currentX, "旋转终点 X"],
    [currentY, "旋转终点 Y"],
  ] as const) {
    finite(value, label);
  }
  if (startX === currentX && startY === currentY) return { ...transform };

  const centerX = transform.x + transform.width / 2;
  const centerY = transform.y + transform.height / 2;
  const startAngle = Math.atan2(startY - centerY, startX - centerX);
  const endAngle = Math.atan2(currentY - centerY, currentX - centerX);
  const difference = endAngle - startAngle;
  const delta = (Math.atan2(Math.sin(difference), Math.cos(difference)) * 180) / Math.PI;
  let rotation = transform.rotation + delta;
  if (snapTo15Degrees) rotation = Math.round(rotation / 15) * 15;
  if (rotation > 360) rotation -= 360;
  if (rotation < -360) rotation += 360;
  return { ...transform, rotation: rounded(rotation) };
}
