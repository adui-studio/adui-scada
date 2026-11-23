import { expect, test } from "vite-plus/test";
import { classifyOrderedNumericAlarmSample } from "../src/index.ts";
import type { TagValue } from "../src/index.ts";

const nowMs = Date.parse("2026-11-22T09:00:00.000Z");
const previous: TagValue = {
  tagId: "tank.level",
  value: 40,
  quality: "GOOD",
  sourceTimestamp: null,
  serverTimestamp: "2026-11-22T08:59:59.000Z",
  sequence: 5,
};
const current: TagValue = {
  ...previous,
  value: 42,
  serverTimestamp: "2026-11-22T08:59:59.000Z",
  sequence: 6,
};

test("同一 Tag 的递增序列在质量和时间窗口均合格时返回候选", () => {
  expect(classifyOrderedNumericAlarmSample(current, previous, nowMs, 1000)).toEqual({
    status: "READY",
    value: 42,
  });
});

test("缺少已接受的同会话基线时不自动接受首条读数", () => {
  expect(classifyOrderedNumericAlarmSample(current, null, nowMs, 1000)).toEqual({
    status: "BASELINE_REQUIRED",
  });
});

test("重复与倒退序列均拒绝且不暴露工艺数值", () => {
  expect(
    classifyOrderedNumericAlarmSample({ ...current, sequence: 5 }, previous, nowMs, 1000),
  ).toEqual({
    status: "SEQUENCE_NOT_ADVANCED",
  });
  expect(
    classifyOrderedNumericAlarmSample({ ...current, sequence: 4 }, previous, nowMs, 1000),
  ).toEqual({
    status: "SEQUENCE_NOT_ADVANCED",
  });
});

test("不同 Tag 的序列号不可交叉比较", () => {
  expect(
    classifyOrderedNumericAlarmSample({ ...current, tagId: "pump.running" }, previous, nowMs, 1000),
  ).toEqual({
    status: "TAG_MISMATCH",
  });
});

test("无效质量与过期数据仍由既有候选筛选拒绝", () => {
  expect(
    classifyOrderedNumericAlarmSample({ ...current, quality: "BAD" }, previous, nowMs, 1000),
  ).toEqual({
    status: "QUALITY_NOT_GOOD",
  });
  expect(classifyOrderedNumericAlarmSample(current, previous, nowMs, 999)).toEqual({
    status: "OUTDATED_TIMESTAMP",
  });
});

test("非法基线与非法当前序列必须拒绝，且不改变入参", () => {
  const baseline = Object.freeze({ ...previous });
  const candidate = Object.freeze({ ...current });
  expect(() =>
    classifyOrderedNumericAlarmSample(candidate, { ...previous, sequence: -1 }, nowMs, 1000),
  ).toThrow("Tag 序列号无效");
  expect(() =>
    classifyOrderedNumericAlarmSample({ ...current, sequence: -1 }, previous, nowMs, 1000),
  ).toThrow("Tag 序列号无效");
  expect(classifyOrderedNumericAlarmSample(candidate, baseline, nowMs, 1000)).toEqual({
    status: "READY",
    value: 42,
  });
  expect(baseline).toEqual(previous);
  expect(candidate).toEqual(current);
});

test("低层序列入口不得以新鲜读数续接已经超龄的旧基线", () => {
  const latest: TagValue = {
    ...current,
    serverTimestamp: "2026-11-22T09:00:01.000Z",
  };
  expect(classifyOrderedNumericAlarmSample(latest, previous, nowMs + 1001, 1000)).toEqual({
    status: "OUTDATED_TIMESTAMP",
  });
});

test("低层序列入口拒绝旧基线的坏质量、非数值和未来时间", () => {
  expect(
    classifyOrderedNumericAlarmSample(current, { ...previous, quality: "BAD" }, nowMs, 1000),
  ).toEqual({ status: "QUALITY_NOT_GOOD" });
  expect(
    classifyOrderedNumericAlarmSample(current, { ...previous, value: null }, nowMs, 1000),
  ).toEqual({ status: "NOT_NUMERIC" });
  expect(
    classifyOrderedNumericAlarmSample(
      current,
      { ...previous, serverTimestamp: "2026-11-22T09:00:00.001Z" },
      nowMs,
      1000,
    ),
  ).toEqual({ status: "FUTURE_TIMESTAMP" });
});

test("旧基线恰在最大年龄边界可用，但不改变原始冻结输入", () => {
  const baseline = Object.freeze({ ...previous });
  const input = Object.freeze({ ...current });
  expect(classifyOrderedNumericAlarmSample(input, baseline, nowMs, 1000)).toEqual({
    status: "READY",
    value: 42,
  });
  expect(baseline).toEqual(previous);
  expect(input).toEqual(current);
});
