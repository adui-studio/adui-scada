import type { StudioPageSize, StudioPan } from "./studio-viewport.ts";

/** 浏览器工作区的实际 CSS 像素大小，不属于组态工程 Schema。 */
export interface StudioViewportSize {
  width: number;
  height: number;
}

/** 与实际工作区宽高比完全相同的 SVG 世界坐标范围。 */
export interface StudioViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
  pan: StudioPan;
}

/**
 * 在完整铺满的 SVG 中等比显示工程页面，并为页面以外的工作区保留网格。
 * 缩放和平移只改变视区，不改变 SVG DOM 大小、图元坐标或工程文件。
 */
export function studioViewportRect(
  page: StudioPageSize,
  viewport: StudioViewportSize,
  zoom: number,
  pan: StudioPan,
): StudioViewportRect {
  if (
    !Number.isFinite(page.width) ||
    !Number.isFinite(page.height) ||
    page.width <= 0 ||
    page.height <= 0
  ) {
    throw new RangeError("工程页面宽高必须为有效的正数");
  }
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    throw new RangeError("编辑工作区宽高必须为有效的正数");
  }
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new RangeError("视图缩放比例必须为有效的正数");
  }
  if (!Number.isFinite(pan.x) || !Number.isFinite(pan.y)) {
    throw new RangeError("视图平移坐标必须为有效的数字");
  }

  const fitScale = Math.min(viewport.width / page.width, viewport.height / page.height);
  const width = viewport.width / fitScale / zoom;
  const height = viewport.height / fitScale / zoom;
  const limitX = Math.max(0, (page.width - width) / 2);
  const limitY = Math.max(0, (page.height - height) / 2);
  const clampedX = Math.max(-limitX, Math.min(limitX, pan.x));
  const clampedY = Math.max(-limitY, Math.min(limitY, pan.y));
  const constrainedPan = {
    x: clampedX === 0 ? 0 : clampedX,
    y: clampedY === 0 ? 0 : clampedY,
  };

  return {
    x: (page.width - width) / 2 + constrainedPan.x,
    y: (page.height - height) / 2 + constrainedPan.y,
    width,
    height,
    pan: constrainedPan,
  };
}
