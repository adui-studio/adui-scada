import { expect, test } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "../src/demo-document.ts";
import { withNodesTranslated } from "../src/editor.ts";
import { DEFAULT_GRID_SIZE, resolveDragSnap } from "../src/snap.ts";

const noSnap = { gridEnabled: false, nodeEnabled: false };

test("未启用吸附时按原有规则取整位移且没有辅助线", () => {
  const result = resolveDragSnap(waterTreatmentDemoDocument, ["tank"], 13.4, 7.2, noSnap);
  expect(result).toEqual({
    dx: 13,
    dy: 7,
    verticalGuide: null,
    horizontalGuide: null,
  });
});

test("网格吸附可单独开启，默认网格间距为 20 单位", () => {
  expect(DEFAULT_GRID_SIZE).toBe(20);
  const result = resolveDragSnap(waterTreatmentDemoDocument, ["tank"], 17, 0, {
    gridEnabled: true,
    nodeEnabled: false,
  });
  expect(result.dx).toBe(20);
  expect(result.dy).toBe(0);
  expect(result.verticalGuide).toBeNull();
});

test("图元吸附对齐邻近边缘并输出垂直辅助线", () => {
  const result = resolveDragSnap(waterTreatmentDemoDocument, ["tank"], 2, 0, {
    gridEnabled: false,
    nodeEnabled: true,
  });
  expect(result.dx).toBe(2);
  expect(result.verticalGuide).toBe(232);
  expect(result.horizontalGuide).toBeNull();
});

test("只有水平位移时不引发意外的垂直跳动", () => {
  const result = resolveDragSnap(waterTreatmentDemoDocument, ["tank"], 2, 0, {
    gridEnabled: true,
    nodeEnabled: true,
  });
  expect(result.dy).toBe(0);
  expect(result.horizontalGuide).toBeNull();
});

test("拖动预览和提交可复用同一组吸附位移且保持 Tag 绑定", () => {
  const original = JSON.stringify(waterTreatmentDemoDocument);
  const result = resolveDragSnap(waterTreatmentDemoDocument, ["tank", "pipe"], 3, 0, {
    gridEnabled: false,
    nodeEnabled: true,
  });
  expect(result.dx).toBe(3);
  expect(result.verticalGuide).toBe(500);
  const moved = withNodesTranslated(
    waterTreatmentDemoDocument,
    ["tank", "pipe"],
    result.dx,
    result.dy,
  );
  expect(moved.pages[0]?.nodes.find((node) => node.id === "tank")?.transform.x).toBe(83);
  expect(moved.pages[0]?.nodes.find((node) => node.id === "pipe")?.transform.x).toBe(235);
  expect(moved.pages[0]?.nodes.find((node) => node.id === "tank")?.bindings.level?.tagId).toBe(
    "water.level",
  );
  expect(JSON.stringify(waterTreatmentDemoDocument)).toBe(original);
});

test("移动整组图元时不将组内节点作为外部吸附目标", () => {
  const document = structuredClone(waterTreatmentDemoDocument);
  const page = document.pages[0];
  if (!page) throw new Error("测试工程缺少页面");
  page.nodes = page.nodes.filter((node) => node.id === "tank" || node.id === "pipe");
  const result = resolveDragSnap(document, ["tank", "pipe"], 3, 4, {
    gridEnabled: false,
    nodeEnabled: true,
  });
  expect(result).toEqual({
    dx: 3,
    dy: 4,
    verticalGuide: null,
    horizontalGuide: null,
  });
});

test("吸附不得使图元超出移动命令允许的画布范围", () => {
  const result = resolveDragSnap(waterTreatmentDemoDocument, ["flow"], 1000, 0, {
    gridEnabled: true,
    nodeEnabled: true,
  });
  expect(result.dx).toBeLessThanOrEqual(50);
  const moved = withNodesTranslated(waterTreatmentDemoDocument, ["flow"], result.dx, result.dy);
  const node = moved.pages[0]?.nodes.find((item) => item.id === "flow");
  expect(node?.transform.x).toBeLessThanOrEqual(680);
  expect(node?.transform.x).toBeGreaterThanOrEqual(0);
});

test("不合法坐标、网格参数、重复图元和未知图元均会被拒绝", () => {
  expect(() =>
    resolveDragSnap(waterTreatmentDemoDocument, ["tank"], Number.NaN, 0, noSnap),
  ).toThrow(/必须是有限数/);
  expect(() =>
    resolveDragSnap(waterTreatmentDemoDocument, ["tank"], 3, 0, {
      ...noSnap,
      gridSize: 0,
    }),
  ).toThrow(/网格间距/);
  expect(() =>
    resolveDragSnap(waterTreatmentDemoDocument, ["tank"], 3, 0, {
      ...noSnap,
      tolerance: -1,
    }),
  ).toThrow(/吸附距离/);
  expect(() => resolveDragSnap(waterTreatmentDemoDocument, ["tank", "tank"], 3, 0, noSnap)).toThrow(
    /重复图元/,
  );
  expect(() => resolveDragSnap(waterTreatmentDemoDocument, ["missing"], 3, 0, noSnap)).toThrow(
    /不存在/,
  );
});

test("没有选中图元时不移动也不显示辅助线", () => {
  expect(resolveDragSnap(waterTreatmentDemoDocument, [], 10, 12, noSnap)).toEqual({
    dx: 0,
    dy: 0,
    verticalGuide: null,
    horizontalGuide: null,
  });
});

test("旋转图元使用外接矩形参与吸附但不修改旋转属性", () => {
  const document = structuredClone(waterTreatmentDemoDocument);
  const tank = document.pages[0]?.nodes.find((node) => node.id === "tank");
  if (!tank) throw new Error("测试数据缺少水箱图元");
  tank.transform.rotation = 90;
  const result = resolveDragSnap(document, ["tank"], -24, 0, {
    gridEnabled: false,
    nodeEnabled: true,
  });
  expect(result.dx).toBe(-25);
  expect(result.verticalGuide).toBe(232);
  expect(tank.transform.rotation).toBe(90);
});

test("吸附配置缺失或开关类型错误时返回中文异常", () => {
  expect(() =>
    resolveDragSnap(waterTreatmentDemoDocument, ["tank"], 2, 0, undefined as never),
  ).toThrow(/开关必须为布尔值/);
  expect(() =>
    resolveDragSnap(waterTreatmentDemoDocument, ["tank"], 2, 0, {
      gridEnabled: "是" as never,
      nodeEnabled: true,
    }),
  ).toThrow(/开关必须为布尔值/);
});

test("小数边界处的吸附结果与实际命令位移一致", () => {
  const document = structuredClone(waterTreatmentDemoDocument);
  const tank = document.pages[0]?.nodes.find((node) => node.id === "tank");
  if (!tank) throw new Error("测试数据缺少水箱图元");
  tank.transform.x = 729.7;
  const result = resolveDragSnap(document, ["tank"], 100, 0, noSnap);
  const moved = withNodesTranslated(document, ["tank"], result.dx, result.dy);
  const finalX = moved.pages[0]?.nodes.find((node) => node.id === "tank")?.transform.x;
  expect(result.dx).toBeCloseTo(0.3, 10);
  expect(finalX).toBe(730);
});

test("移动至小数左边界时保留精确截断位移", () => {
  const document = structuredClone(waterTreatmentDemoDocument);
  const tank = document.pages[0]?.nodes.find((node) => node.id === "tank");
  if (!tank) throw new Error("测试数据缺少水箱图元");
  tank.transform.x = 0.2;
  const result = resolveDragSnap(document, ["tank"], -100, 0, noSnap);
  const moved = withNodesTranslated(document, ["tank"], result.dx, result.dy);
  expect(result.dx).toBeCloseTo(-0.2, 10);
  expect(moved.pages[0]?.nodes.find((node) => node.id === "tank")?.transform.x).toBe(0);
});
