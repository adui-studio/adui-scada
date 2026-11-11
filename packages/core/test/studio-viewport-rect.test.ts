import { expect, test } from "vite-plus/test";
import { studioViewportRect } from "../src/studio-viewport-rect.ts";

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
