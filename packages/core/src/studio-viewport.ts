/** 编辑器画布视图坐标，不修改工程文件中的图元位置和尺寸。 */
export interface StudioPan {
  x: number;
  y: number;
}
export interface StudioPageSize {
  width: number;
  height: number;
}

function validateViewport(size: StudioPageSize, zoom: number, pan: StudioPan): void {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    throw new RangeError("画布宽高必须为有效的正数");
  }
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new RangeError("画布缩放比例必须为有效的正数");
  }
  if (!Number.isFinite(pan.x) || !Number.isFinite(pan.y)) {
    throw new RangeError("画布平移坐标必须为有效的数字");
  }
}

/** 平移视图不越过页面边界，缩小后保持视图居中。 */
export function clampStudioPan(size: StudioPageSize, zoom: number, pan: StudioPan): StudioPan {
  validateViewport(size, zoom, pan);
  const maxX = Math.max(0, (size.width - size.width / zoom) / 2);
  const maxY = Math.max(0, (size.height - size.height / zoom) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, pan.x)),
    y: Math.max(-maxY, Math.min(maxY, pan.y)),
  };
}

/** 使用 viewBox 完成缩放和平移，避免通过放大 SVG 元素撑出滚动条。 */
export function studioViewBox(size: StudioPageSize, zoom: number, pan: StudioPan): string {
  const offset = clampStudioPan(size, zoom, pan);
  const width = size.width / zoom;
  const height = size.height / zoom;
  return [
    (size.width - width) / 2 + offset.x,
    (size.height - height) / 2 + offset.y,
    width,
    height,
  ].join(" ");
}
