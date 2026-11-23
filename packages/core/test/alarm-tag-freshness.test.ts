import { expect, test } from "vite-plus/test";
import { classifyTimelyNumericAlarmSample } from "../src/index.ts";
import type { TagValue } from "../src/index.ts";

const nowMs = Date.parse("2026-11-22T09:00:00.000Z");
const valid: TagValue = {
  tagId: "tank.level",
  value: 42,
  quality: "GOOD",
  sourceTimestamp: null,
  serverTimestamp: "2026-11-22T08:59:59.000Z",
  sequence: 1,
};

test("时间窗口内和最大年龄边界上的正常读数允许作为候选", () => {
  expect(classifyTimelyNumericAlarmSample(valid, nowMs, 1000)).toEqual({
    status: "READY",
    value: 42,
  });
  expect(
    classifyTimelyNumericAlarmSample(
      { ...valid, serverTimestamp: "2026-11-22T09:00:00.000Z" },
      nowMs,
      1000,
    ),
  ).toEqual({
    status: "READY",
    value: 42,
  });
});

test("超过显式最大年龄的读数拒绝且不泄露旧数值", () => {
  expect(classifyTimelyNumericAlarmSample(valid, nowMs, 999)).toEqual({
    status: "OUTDATED_TIMESTAMP",
  });
});

test("未来服务端时间拒绝而不是将负年龄误判为新鲜", () => {
  const future = { ...valid, serverTimestamp: "2026-11-22T09:00:00.001Z" };
  expect(classifyTimelyNumericAlarmSample(future, nowMs, 1000)).toEqual({
    status: "FUTURE_TIMESTAMP",
  });
});

test("非 GOOD 质量和非数值首先由现有候选分类拒绝", () => {
  expect(classifyTimelyNumericAlarmSample({ ...valid, quality: "STALE" }, nowMs, 1000)).toEqual({
    status: "QUALITY_NOT_GOOD",
  });
  expect(classifyTimelyNumericAlarmSample({ ...valid, value: null }, nowMs, 1000)).toEqual({
    status: "NOT_NUMERIC",
  });
});

test("无效时钟参数和 Tag 时间字段必须明确拒绝", () => {
  expect(() => classifyTimelyNumericAlarmSample(valid, Number.NaN, 1000)).toThrow(
    "当前时间参数无效",
  );
  expect(() => classifyTimelyNumericAlarmSample(valid, -1, 1000)).toThrow("当前时间参数无效");
  expect(() => classifyTimelyNumericAlarmSample(valid, nowMs, 0)).toThrow("最大数据年龄参数无效");
  expect(() => classifyTimelyNumericAlarmSample(valid, nowMs, Number.POSITIVE_INFINITY)).toThrow(
    "最大数据年龄参数无效",
  );
  expect(() =>
    classifyTimelyNumericAlarmSample({ ...valid, serverTimestamp: "invalid" }, nowMs, 1000),
  ).toThrow("服务器时间戳无效");
});

test("函数只读且只检查服务端时间字段，不把来源时间当成可信依据", () => {
  const input = Object.freeze({ ...valid, sourceTimestamp: "2000-01-01T00:00:00.000Z" });
  expect(classifyTimelyNumericAlarmSample(input, nowMs, 1000)).toEqual({
    status: "READY",
    value: 42,
  });
  expect(input).toEqual({ ...valid, sourceTimestamp: "2000-01-01T00:00:00.000Z" });
});

test("报警候选拒绝无时区服务器时间，同时接受明确 UTC 偏移", () => {
  const offset = {
    ...valid,
    serverTimestamp: "2026-11-22T17:59:59.000+09:00",
    sourceTimestamp: "2026-11-22T08:59:59",
  };
  expect(classifyTimelyNumericAlarmSample(offset, nowMs, 1000)).toEqual({
    status: "READY",
    value: 42,
  });
  for (const timestamp of ["2026-11-22T08:59:59.000", "2026-11-22", "11/22/2026 08:59:59"]) {
    expect(() =>
      classifyTimelyNumericAlarmSample({ ...valid, serverTimestamp: timestamp }, nowMs, 1000),
    ).toThrow("报警服务器时间戳必须包含明确时区");
  }
  expect(
    classifyTimelyNumericAlarmSample(
      { ...valid, quality: "BAD", serverTimestamp: "2026-11-22T08:59:59.000" },
      nowMs,
      1000,
    ),
  ).toEqual({ status: "QUALITY_NOT_GOOD" });
});
