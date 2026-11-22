import { expect, test } from "vite-plus/test";
import {
  advanceAlarmTagDeltaBaseline,
  establishAlarmSnapshotBaseline,
} from "../src/index.ts";
import type {
  AlarmSnapshotBaseline,
  AlarmTagDeltaRequest,
  TagValue,
} from "../src/index.ts";

const nowMs = Date.parse("2026-11-22T09:00:00.000Z");
const previous: TagValue = {
  tagId: "tank.level",
  value: 40,
  quality: "GOOD",
  sourceTimestamp: null,
  serverTimestamp: "2026-11-22T08:59:58.000Z",
  sequence: 5,
};
const next: TagValue = {
  ...previous,
  value: 42,
  serverTimestamp: "2026-11-22T08:59:59.000Z",
  sequence: 6,
};
const baseline: AlarmSnapshotBaseline = {
  generation: 2,
  value: previous,
};
const request: AlarmTagDeltaRequest = {
  change: { kind: "delta", values: [next] },
  expectedTagId: "tank.level",
  baseline,
  activeGeneration: 2,
  deltaGeneration: 2,
  sourceVerified: true,
};

test("同代次有效增量返回独立冻结基线且不修改旧读数", () => {
  const input = { ...next };
  const result = advanceAlarmTagDeltaBaseline(
    { ...request, change: { kind: "delta", values: [input] } },
    nowMs,
    1000,
  );
  expect(result).toEqual({
    status: "DELTA_ACCEPTED",
    value: 42,
    baseline: { generation: 2, value: next },
  });
  if (result.status !== "DELTA_ACCEPTED") {
    throw new TypeError("测试增量未接受");
  }
  expect(Object.isFrozen(result.baseline)).toBe(true);
  expect(Object.isFrozen(result.baseline.value)).toBe(true);
  input.value = 99;
  expect(result.baseline.value.value).toBe(42);
  expect(previous.value).toBe(40);
});

test("初始快照基线支持两次连续增量并保持序列前进", () => {
  const initial = establishAlarmSnapshotBaseline(
    {
      change: { kind: "snapshot", values: [previous] },
      expectedTagId: "tank.level",
      activeGeneration: 2,
      snapshotGeneration: 2,
      sourceVerified: true,
    },
    nowMs,
    3000,
  );
  expect(initial.status).toBe("BASELINE_ESTABLISHED");
  if (initial.status !== "BASELINE_ESTABLISHED") {
    throw new TypeError("测试快照基线未建立");
  }
  const first = advanceAlarmTagDeltaBaseline(
    { ...request, baseline: initial.baseline },
    nowMs,
    1000,
  );
  expect(first.status).toBe("DELTA_ACCEPTED");
  if (first.status !== "DELTA_ACCEPTED") {
    throw new TypeError("测试首条增量未接受");
  }
  const second = advanceAlarmTagDeltaBaseline(
    {
      ...request,
      baseline: first.baseline,
      change: {
        kind: "delta",
        values: [{ ...next, sequence: 7, value: 43, serverTimestamp: "2026-11-22T09:00:00.000Z" }],
      },
    },
    nowMs,
    1000,
  );
  expect(second).toEqual({
    status: "DELTA_ACCEPTED",
    value: 43,
    baseline: {
      generation: 2,
      value: { ...next, sequence: 7, value: 43, serverTimestamp: "2026-11-22T09:00:00.000Z" },
    },
  });
});

test("未核验来源或快照误作增量时拒绝并不回传基线", () => {
  expect(advanceAlarmTagDeltaBaseline({ ...request, sourceVerified: false }, nowMs, 1000)).toEqual({
    status: "DELTA_REJECTED",
    reason: "UNVERIFIED_SOURCE",
  });
  expect(
    advanceAlarmTagDeltaBaseline(
      { ...request, change: { kind: "snapshot", values: [next] } },
      nowMs,
      1000,
    ),
  ).toEqual({ status: "DELTA_REJECTED", reason: "DELTA_REQUIRED" });
});

test("没有快照基线或重连混入旧代次时必须拒绝", () => {
  expect(advanceAlarmTagDeltaBaseline({ ...request, baseline: null }, nowMs, 1000)).toEqual({
    status: "DELTA_REJECTED",
    reason: "BASELINE_REQUIRED",
  });
  expect(
    advanceAlarmTagDeltaBaseline({ ...request, activeGeneration: 3 }, nowMs, 1000),
  ).toEqual({ status: "DELTA_REJECTED", reason: "SESSION_MISMATCH" });
  expect(
    advanceAlarmTagDeltaBaseline({ ...request, deltaGeneration: 1 }, nowMs, 1000),
  ).toEqual({ status: "DELTA_REJECTED", reason: "SESSION_MISMATCH" });
});

test("重复与倒退序列、基线 Tag 不一致均拒绝", () => {
  for (const sequence of [5, 4]) {
    expect(
      advanceAlarmTagDeltaBaseline(
        { ...request, change: { kind: "delta", values: [{ ...next, sequence }] } },
        nowMs,
        1000,
      ),
    ).toEqual({ status: "DELTA_REJECTED", reason: "SEQUENCE_NOT_ADVANCED" });
  }
  expect(
    advanceAlarmTagDeltaBaseline(
      { ...request, expectedTagId: "other.tag" },
      nowMs,
      1000,
    ),
  ).toEqual({ status: "DELTA_REJECTED", reason: "TAG_MISMATCH" });
});

test("坏质量、非数值和过期读数不能复用旧正常值", () => {
  expect(
    advanceAlarmTagDeltaBaseline(
      { ...request, change: { kind: "delta", values: [{ ...next, quality: "BAD" }] } },
      nowMs,
      1000,
    ),
  ).toEqual({ status: "DELTA_REJECTED", reason: "QUALITY_NOT_GOOD" });
  expect(
    advanceAlarmTagDeltaBaseline(
      { ...request, change: { kind: "delta", values: [{ ...next, value: null }] } },
      nowMs,
      1000,
    ),
  ).toEqual({ status: "DELTA_REJECTED", reason: "NOT_NUMERIC" });
  expect(advanceAlarmTagDeltaBaseline(request, nowMs, 999)).toEqual({
    status: "DELTA_REJECTED",
    reason: "OUTDATED_TIMESTAMP",
  });
});

test("不包含目标 Tag 的有效增量只返回未更新而不重发旧数值", () => {
  expect(
    advanceAlarmTagDeltaBaseline(
      { ...request, change: { kind: "delta", values: [{ ...next, tagId: "other.tag" }] } },
      nowMs,
      1000,
    ),
  ).toEqual({ status: "TAG_NOT_UPDATED" });
  expect(
    advanceAlarmTagDeltaBaseline(
      { ...request, change: { kind: "delta", values: [] } },
      nowMs,
      1000,
    ),
  ).toEqual({ status: "TAG_NOT_UPDATED" });
});

test("整个批次存在重复或非法 Tag 时拒绝而不部分推进", () => {
  const frozen = Object.freeze({ ...next });
  expect(() =>
    advanceAlarmTagDeltaBaseline(
      { ...request, change: { kind: "delta", values: [frozen, { ...next }] } },
      nowMs,
      1000,
    ),
  ).toThrow("报警增量中存在重复的 Tag ID");
  expect(() =>
    advanceAlarmTagDeltaBaseline(
      {
        ...request,
        change: {
          kind: "delta",
          values: [frozen, { ...next, tagId: "other.tag", sequence: -1 }],
        },
      },
      nowMs,
      1000,
    ),
  ).toThrow("Tag 序列号无效");
  expect(frozen).toEqual(next);
});

test("非法会话代次、无效时间参数和非法基线明确拒绝", () => {
  for (const invalid of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() =>
      advanceAlarmTagDeltaBaseline(
        { ...request, deltaGeneration: invalid },
        nowMs,
        1000,
      ),
    ).toThrow("报警增量会话代次无效");
  }
  expect(() => advanceAlarmTagDeltaBaseline(request, Number.NaN, 1000)).toThrow(
    "当前时间参数无效",
  );
  expect(() =>
    advanceAlarmTagDeltaBaseline(
      { ...request, baseline: { generation: 2, value: { ...previous, sequence: -1 } } },
      nowMs,
      1000,
    ),
  ).toThrow("Tag 序列号无效");
});
