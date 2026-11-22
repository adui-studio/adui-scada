import { expect, test } from "vite-plus/test";
import { classifySessionBoundNumericAlarmSample } from "../src/index.ts";
import type { AlarmSessionGenerations, TagValue } from "../src/index.ts";

const nowMs = Date.parse("2026-11-22T09:00:00.000Z");
const previous: TagValue = {
  tagId: "tank.level",
  value: 40,
  quality: "GOOD",
  sourceTimestamp: null,
  serverTimestamp: "2026-11-22T08:59:58.000Z",
  sequence: 5,
};
const current: TagValue = {
  ...previous,
  value: 42,
  serverTimestamp: "2026-11-22T08:59:59.000Z",
  sequence: 6,
};
const generations: AlarmSessionGenerations = {
  activeGeneration: 2,
  inputGeneration: 2,
  baselineGeneration: 2,
};

test("三份显式代次一致且序列前进时才返回数值候选", () => {
  expect(
    classifySessionBoundNumericAlarmSample(current, previous, generations, nowMs, 1000),
  ).toEqual({
    status: "READY",
    value: 42,
  });
});

test("旧订阅的迟到读数不能进入当前代次", () => {
  expect(
    classifySessionBoundNumericAlarmSample(
      current,
      previous,
      { ...generations, inputGeneration: 1 },
      nowMs,
      1000,
    ),
  ).toEqual({ status: "SESSION_MISMATCH" });
});

test("新订阅不允许继承旧会话的序列基线", () => {
  expect(
    classifySessionBoundNumericAlarmSample(
      current,
      previous,
      { ...generations, baselineGeneration: 1 },
      nowMs,
      1000,
    ),
  ).toEqual({ status: "SESSION_MISMATCH" });
});

test("历史会话即使读数和基线代次相同也不得冒充活跃会话", () => {
  expect(
    classifySessionBoundNumericAlarmSample(
      current,
      previous,
      { ...generations, inputGeneration: 1, baselineGeneration: 1 },
      nowMs,
      1000,
    ),
  ).toEqual({ status: "SESSION_MISMATCH" });
});

test("代次一致也不能绕过无基线、旧序列和坏质量", () => {
  expect(classifySessionBoundNumericAlarmSample(current, null, generations, nowMs, 1000)).toEqual({
    status: "BASELINE_REQUIRED",
  });
  expect(
    classifySessionBoundNumericAlarmSample(
      { ...current, sequence: 5 },
      previous,
      generations,
      nowMs,
      1000,
    ),
  ).toEqual({ status: "SEQUENCE_NOT_ADVANCED" });
  expect(
    classifySessionBoundNumericAlarmSample(
      { ...current, quality: "BAD" },
      previous,
      generations,
      nowMs,
      1000,
    ),
  ).toEqual({ status: "QUALITY_NOT_GOOD" });
});

test("非法代次拒绝且不会修改冻结的读数和会话标记", () => {
  const input = Object.freeze({ ...current });
  const baseline = Object.freeze({ ...previous });
  const session = Object.freeze({ ...generations });
  for (const invalid of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() =>
      classifySessionBoundNumericAlarmSample(
        input,
        baseline,
        { ...session, activeGeneration: invalid },
        nowMs,
        1000,
      ),
    ).toThrow("报警订阅会话代次无效");
  }
  expect(classifySessionBoundNumericAlarmSample(input, baseline, session, nowMs, 1000)).toEqual({
    status: "READY",
    value: 42,
  });
  expect(input).toEqual(current);
  expect(baseline).toEqual(previous);
  expect(session).toEqual(generations);
});
