import { expect, test } from "vite-plus/test";
import { STUDIO_CANVAS_FIT_MARGIN, studioFocusTransform, studioViewportRect } from "../src/studio-viewport-rect.ts";

const page = { width: 880, height: 460 };
const center = { x: 0, y: 0 };

test("工作区比例不同于页面时，视区自动扩展并显示完整页面", () => {
  const rect = studioViewportRect(page, { width: 1600, height: 900 }, 1, center);
  expect(rect.x).toBeCloseTo(0);
  expect(rect.y).toBeCloseTo(-17.5);
  expect(rect.width).toBeCloseTo(880);
  expect(rect.height).toBeCloseTo(495);
  expect(rect.width / rect.height).toBeCloseTo(1600 / 900);
});

test("竖向工作区同样铺满网格，不拉伸工程图元", () => {
  const rect = studioViewportRect(page, { width: 800, height: 800 }, 1, center);
  expect(rect.x).toBeCloseTo(0);
  expect(rect.y).toBeCloseTo(-210);
  expect(rect.width).toBeCloseTo(880);
  expect(rect.height).toBeCloseTo(880);
});

test("缩放时维持工作区纵横比，并保持原始工程坐标", () => {
  const viewport = { width: 1600, height: 900 };
  const fit = studioViewportRect(page, viewport, 1, center);
  const zoomed = studioViewportRect(page, viewport, 2, center);
  expect(zoomed.width).toBeCloseTo(fit.width / 2);
  expect(zoomed.height).toBeCloseTo(fit.height / 2);
  expect(zoomed.width / zoomed.height).toBeCloseTo(viewport.width / viewport.height);
  expect(page).toEqual({ width: 880, height: 460 });
});

test("放大后平移限制在工程页面附近，不会出现丢失的画板", () => {
  const rect = studioViewportRect(page, { width: 800, height: 800 }, 2, {
    x: 1000,
    y: -1000,
  });
  expect(rect.pan.x).toBeCloseTo(220);
  expect(rect.pan.y).toBeCloseTo(-10);
  expect(rect.x).toBeCloseTo(440);
  expect(rect.y).toBeCloseTo(0);
});

test("适应工作区时平移重置，网格仍覆盖整个视区", () => {
  const rect = studioViewportRect(page, { width: 800, height: 800 }, 1, {
    x: 100,
    y: -100,
  });
  expect(rect.pan).toEqual(center);
  expect(rect.x).toBeCloseTo(0);
  expect(rect.y).toBeCloseTo(-210);
});

test("零边界与负零输入统一返回正零", () => {
  const fitted = studioViewportRect(page, { width: 800, height: 800 }, 1, {
    x: 100,
    y: -100,
  });
  expect(fitted.pan).toEqual(center);
  expect(Object.is(fitted.pan.x, -0)).toBe(false);
  expect(Object.is(fitted.pan.y, -0)).toBe(false);

  const zoomed = studioViewportRect(page, { width: 1600, height: 900 }, 2, {
    x: -0,
    y: -0,
  });
  expect(zoomed.pan).toEqual(center);
});

test("拒绝无效尺寸、缩放和平移参数", () => {
  expect(() => studioViewportRect(page, { width: 0, height: 900 }, 1, center)).toThrow(
    "编辑工作区宽高",
  );
  expect(() =>
    studioViewportRect({ width: 0, height: 460 }, { width: 800, height: 800 }, 1, center),
  ).toThrow("工程页面宽高");
  expect(() => studioViewportRect(page, { width: 800, height: 800 }, 0, center)).toThrow(
    "视图缩放比例",
  );
  expect(() =>
    studioViewportRect(page, { width: 800, height: 800 }, 1, { x: Infinity, y: 0 }),
  ).toThrow("视图平移坐标");
});

test("Figma 式适应画布留白只改变观察视区，不修改工程页面或纵横比例", () => {
  const page = { width: 1920, height: 1080 };
  const viewport = { width: 900, height: 600 };
  const pan = { x: 0, y: 0 };
  const fitted = studioViewportRect(page, viewport, 1, pan, 48);
  expect(fitted.width / fitted.height).toBeCloseTo(viewport.width / viewport.height);
  expect(fitted.width).toBeGreaterThan(page.width);
  expect(fitted.height).toBeGreaterThan(page.height);
  expect(fitted.x).toBeLessThan(0);
  expect(page).toEqual({ width: 1920, height: 1080 });
  expect(() => studioViewportRect(page, viewport, 1, pan, -1)).toThrow(/留白/);
});

test("定位旋转图元时按实际包围盒适应视区并保持工程几何不变", () => {
  const page = { width: 1920, height: 1080 };
  const viewport = { width: 900, height: 600 };
  const transform = { x: 800, y: 390, width: 320, height: 300, rotation: 90 };
  const focus = studioFocusTransform(page, viewport, transform, 48);
  const rect = studioViewportRect(page, viewport, focus.zoom, focus.pan, 48);
  expect(focus.zoom).toBeGreaterThan(1);
  expect(rect.x).toBeLessThanOrEqual(810);
  expect(rect.y).toBeLessThanOrEqual(380);
  expect(rect.x + rect.width).toBeGreaterThanOrEqual(1110);
  expect(rect.y + rect.height).toBeGreaterThanOrEqual(700);
  expect(transform).toEqual({ x: 800, y: 390, width: 320, height: 300, rotation: 90 });
});

test("定位极小图元时限制最大缩放并拒绝无效几何", () => {
  const viewport = { width: 800, height: 800 };
  const tiny = { x: 400, y: 200, width: 1, height: 1, rotation: 0 };
  expect(studioFocusTransform(page, viewport, tiny, 48).zoom).toBe(8);
  expect(() => studioFocusTransform(page, viewport, { ...tiny, rotation: Infinity }, 48)).toThrow(
    "定位图元的几何参数无效",
  );
});

test("默认 1920×1080 画板适应视口时仅保留最小安全边距且不变形", () => {
  const page = { width: 1920, height: 1080 };
  for (const viewport of [{ width: 900, height: 600 }, { width: 1200, height: 650 }, { width: 600, height: 500 }]) {
    const rect = studioViewportRect(page, viewport, 1, center, STUDIO_CANVAS_FIT_MARGIN);
    const scale = viewport.width / rect.width;
    const horizontalGap = viewport.width - page.width * scale;
    const verticalGap = viewport.height - page.height * scale;
    expect(Math.min(horizontalGap, verticalGap)).toBeCloseTo(16);
    expect(rect.width / rect.height).toBeCloseTo(viewport.width / viewport.height);
    expect(horizontalGap).toBeGreaterThanOrEqual(15.99);
    expect(verticalGap).toBeGreaterThanOrEqual(15.99);
  }
});
