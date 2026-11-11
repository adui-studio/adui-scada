import { expect, test } from "vite-plus/test";
import { clampStudioPan, studioViewBox } from "../src/studio-viewport.ts";

const size = { width: 880, height: 460 };
const center = { x: 0, y: 0 };

test("默认适应视图显示完整工程坐标", () => {
  expect(studioViewBox(size, 1, center)).toBe("0 0 880 460");
});
test("放大仅改变 SVG viewBox，保持文档页面尺寸", () => {
  expect(studioViewBox(size, 2, center)).toBe("220 115 440 230");
  expect(size).toEqual({ width: 880, height: 460 });
});
test("缩小视区预留背景空间而不改变工程文件", () => {
  expect(studioViewBox(size, 0.5, center)).toBe("-440 -230 1760 920");
});
test("拖动画布不会把视图移出原页面边界", () => {
  expect(clampStudioPan(size, 2, { x: 999, y: -999 })).toEqual({ x: 220, y: -115 });
  expect(studioViewBox(size, 2, { x: 999, y: -999 })).toBe("440 0 440 230");
});
test("适应视图时重置平移", () => {
  expect(clampStudioPan(size, 1, { x: 120, y: 90 })).toEqual(center);
  expect(studioViewBox(size, 1, { x: 120, y: 90 })).toBe("0 0 880 460");
});
test("拒绝无效尺寸、缩放和平移", () => {
  expect(() => studioViewBox({ width: 0, height: 460 }, 1, center)).toThrow("画布宽高");
  expect(() => studioViewBox(size, Number.NaN, center)).toThrow("画布缩放比例");
  expect(() => studioViewBox(size, 1, { x: Infinity, y: 0 })).toThrow("画布平移坐标");
});
