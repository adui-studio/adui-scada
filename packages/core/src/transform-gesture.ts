import type { ScadaNode } from "./document.ts";

export type ResizeHandle = "nw" | "ne" | "se" | "sw";
export const RESIZE_HANDLES: readonly ResizeHandle[] = ["nw", "ne", "se", "sw"];

type Transform = ScadaNode["transform"];

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${label}必须为有限数`);
}

function rounded(value: number): number {
  const result = Math.round(value * 100) / 100;
  return result === 0 ? 0 : result;
}

/**
 * 四角手柄以旋转后的局部坐标缩放，保持对角锚点固定。
 * 返回候选几何属性，页面边界最终由 withNodeTransform 统一验证。
 */
export function resolveResizeTransform(
  transform: Transform,
  handle: ResizeHandle,
  dx: number,
  dy: number,
): Transform {
  finite(dx, "水平缩放位移");
  finite(dy, "垂直缩放位移");
  if (!RESIZE_HANDLES.includes(handle)) throw new TypeError("不支持的缩放手柄");

  const angle = (transform.rotation * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const localDx = cosine * dx + sine * dy;
  const localDy = -sine * dx + cosine * dy;
  const horizontalSign = handle.endsWith("e") ? 1 : -1;
  const verticalSign = handle.startsWith("s") ? 1 : -1;
  const width = rounded(transform.width + horizontalSign * localDx);
  const height = rounded(transform.height + verticalSign * localDy);
  if (width < 0.1 || height < 0.1) {
    throw new RangeError("缩放后的图元宽度和高度不能小于 0.1");
  }

  // 对角锚点不动时，新中心等于原中心加上世界坐标位移的一半。
  const centerX = transform.x + transform.width / 2 + dx / 2;
  const centerY = transform.y + transform.height / 2 + dy / 2;
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
