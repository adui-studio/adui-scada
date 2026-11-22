import { expect, test } from "vite-plus/test";
import { classifyNumericAlarmSample } from "../src/index.ts";
import type { TagValue } from "../src/index.ts";

const valid: TagValue = {
  tagId: "tank.level",
  value: 42,
  quality: "GOOD",
  sourceTimestamp: null,
  serverTimestamp: "2026-11-22T00:00:00.000Z",
  sequence: 1,
};

test("正常质量且有限数值才返回数值候选", () => {
  expect(classifyNumericAlarmSample(valid)).toEqual({ status: "READY", value: 42 });
  expect(classifyNumericAlarmSample({ ...valid, value: 0 })).toEqual({
    status: "READY",
    value: 0,
  });
});

test("异常、不确定与过期质量均不能返回工艺数值", () => {
  for (const quality of ["BAD", "UNCERTAIN", "STALE"] as const) {
    expect(classifyNumericAlarmSample({ ...valid, quality })).toEqual({
      status: "QUALITY_NOT_GOOD",
    });
  }
});

test("正常质量下的非数值读数仍不得进入数值报警计算", () => {
  for (const value of [null, true, "42"] as const) {
    expect(classifyNumericAlarmSample({ ...valid, value })).toEqual({
      status: "NOT_NUMERIC",
    });
  }
});

test("非法数值和不合法的 Tag 元数据必须拒绝而非降级为正常", () => {
  expect(() => classifyNumericAlarmSample({ ...valid, value: Number.NaN })).toThrow(
    "Tag 数值必须为有限数",
  );
  expect(() => classifyNumericAlarmSample({ ...valid, sequence: -1 })).toThrow(
    "Tag 序列号无效",
  );
});

test("分类不修改输入对象并且不创建告警事件", () => {
  const input = Object.freeze({ ...valid });
  expect(classifyNumericAlarmSample(input)).toEqual({ status: "READY", value: 42 });
  expect(input).toEqual(valid);
});
