import { expect, test } from "vite-plus/test";
import {
  classifySessionBoundNumericAlarmSample,
  establishAlarmSnapshotBaseline,
} from "../src/index.ts";
import type { AlarmSnapshotBaselineRequest, TagValue } from "../src/index.ts";

const nowMs = Date.parse("2026-11-22T09:00:00.000Z");
const sample: TagValue = {
  tagId: "tank.level",
  value: 42,
  quality: "GOOD",
  sourceTimestamp: null,
  serverTimestamp: "2026-11-22T08:59:59.000Z",
  sequence: 5,
};
const request: AlarmSnapshotBaselineRequest = {
  change: { kind: "snapshot", values: [sample] },
  expectedTagId: "tank.level",
  activeGeneration: 2,
  snapshotGeneration: 2,
  sourceVerified: true,
};

test("同代次且上游声明已核验的快照建立独立只读基线", () => {
  const input = { ...sample };
  const result = establishAlarmSnapshotBaseline(
    { ...request, change: { kind: "snapshot", values: [input] } },
    nowMs,
    1000,
  );
  expect(result).toEqual({
    status: "BASELINE_ESTABLISHED",
    baseline: { generation: 2, value: sample },
  });
  if (result.status !== "BASELINE_ESTABLISHED") {
    throw new TypeError("测试快照基线未建立");
  }
  expect(Object.isFrozen(result.baseline)).toBe(true);
  expect(Object.isFrozen(result.baseline.value)).toBe(true);
  input.value = 99;
  expect(result.baseline.value.value).toBe(42);
});

test("未核验来源或增量消息均不能直接建立初始基线", () => {
  expect(
    establishAlarmSnapshotBaseline({ ...request, sourceVerified: false }, nowMs, 1000),
  ).toEqual({ status: "UNVERIFIED_SOURCE" });
  expect(
    establishAlarmSnapshotBaseline(
      { ...request, change: { kind: "delta", values: [sample] } },
      nowMs,
      1000,
    ),
  ).toEqual({ status: "SNAPSHOT_REQUIRED" });
});

test("旧会话快照即使读数有效也不能建立当前代次基线", () => {
  expect(
    establishAlarmSnapshotBaseline({ ...request, snapshotGeneration: 1 }, nowMs, 1000),
  ).toEqual({ status: "SESSION_MISMATCH" });
});

test("快照缺少目标 Tag 时拒绝，重复或非法其他 Tag 则整体拒绝", () => {
  expect(
    establishAlarmSnapshotBaseline({ ...request, expectedTagId: "unknown.tag" }, nowMs, 1000),
  ).toEqual({ status: "TAG_NOT_FOUND" });
  expect(() =>
    establishAlarmSnapshotBaseline(
      { ...request, change: { kind: "snapshot", values: [sample, { ...sample }] } },
      nowMs,
      1000,
    ),
  ).toThrow("报警快照中存在重复的 Tag ID");
  expect(() =>
    establishAlarmSnapshotBaseline(
      {
        ...request,
        change: { kind: "snapshot", values: [sample, { ...sample, tagId: "other", sequence: -1 }] },
      },
      nowMs,
      1000,
    ),
  ).toThrow("Tag 序列号无效");
});

test("质量异常、非数值、过期和未来时间均不能成为基线", () => {
  expect(
    establishAlarmSnapshotBaseline(
      { ...request, change: { kind: "snapshot", values: [{ ...sample, quality: "STALE" }] } },
      nowMs,
      1000,
    ),
  ).toEqual({ status: "QUALITY_NOT_GOOD" });
  expect(
    establishAlarmSnapshotBaseline(
      { ...request, change: { kind: "snapshot", values: [{ ...sample, value: null }] } },
      nowMs,
      1000,
    ),
  ).toEqual({ status: "NOT_NUMERIC" });
  expect(establishAlarmSnapshotBaseline(request, nowMs, 999)).toEqual({
    status: "OUTDATED_TIMESTAMP",
  });
  expect(
    establishAlarmSnapshotBaseline(
      {
        ...request,
        change: {
          kind: "snapshot",
          values: [{ ...sample, serverTimestamp: "2026-11-22T09:00:00.001Z" }],
        },
      },
      nowMs,
      1000,
    ),
  ).toEqual({ status: "FUTURE_TIMESTAMP" });
});

test("非法会话代次、非法时间和 Tag 内容明确拒绝", () => {
  for (const invalid of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() =>
      establishAlarmSnapshotBaseline({ ...request, activeGeneration: invalid }, nowMs, 1000),
    ).toThrow("报警快照会话代次无效");
  }
  expect(() => establishAlarmSnapshotBaseline(request, Number.NaN, 1000)).toThrow(
    "当前时间参数无效",
  );
  expect(() =>
    establishAlarmSnapshotBaseline(
      { ...request, change: { kind: "snapshot", values: [{ ...sample, value: Number.NaN }] } },
      nowMs,
      1000,
    ),
  ).toThrow("Tag 数值必须为有限数");
});

test("新会话快照可作为后续增量基线，不能继承旧会话记录", () => {
  const established = establishAlarmSnapshotBaseline(request, nowMs, 1000);
  expect(established.status).toBe("BASELINE_ESTABLISHED");
  if (established.status !== "BASELINE_ESTABLISHED") {
    throw new TypeError("测试快照基线未建立");
  }
  const next: TagValue = { ...sample, sequence: 6 };
  expect(
    classifySessionBoundNumericAlarmSample(
      next,
      established.baseline.value,
      {
        activeGeneration: 2,
        inputGeneration: 2,
        baselineGeneration: established.baseline.generation,
      },
      nowMs,
      1000,
    ),
  ).toEqual({ status: "READY", value: 42 });
  expect(
    classifySessionBoundNumericAlarmSample(
      next,
      established.baseline.value,
      { activeGeneration: 3, inputGeneration: 3, baselineGeneration: 2 },
      nowMs,
      1000,
    ),
  ).toEqual({ status: "SESSION_MISMATCH" });
  const newer = establishAlarmSnapshotBaseline(
    {
      ...request,
      activeGeneration: 3,
      snapshotGeneration: 3,
      change: { kind: "snapshot", values: [{ ...sample, sequence: 1 }] },
    },
    nowMs,
    1000,
  );
  expect(newer).toEqual({
    status: "BASELINE_ESTABLISHED",
    baseline: { generation: 3, value: { ...sample, sequence: 1 } },
  });
});

test("初始快照服务器时间缺少时区不能建立报警候选基线", () => {
  expect(() =>
    establishAlarmSnapshotBaseline(
      {
        ...request,
        change: {
          kind: "snapshot",
          values: [{ ...sample, serverTimestamp: "2026-11-22T08:59:59.000" }],
        },
      },
      nowMs,
      1000,
    ),
  ).toThrow("报警服务器时间戳必须包含明确时区");
});

test("不存在的公历日期不能在快照中被自动归一化为有效基线", () => {
  expect(() =>
    establishAlarmSnapshotBaseline(
      {
        ...request,
        change: {
          kind: "snapshot",
          values: [{ ...sample, serverTimestamp: "2026-02-30T09:00:00.000Z" }],
        },
      },
      Date.parse("2026-03-02T09:00:00.000Z"),
      1000,
    ),
  ).toThrow("报警服务器时间戳日期无效");
});

test("日末二十四时不能通过日期解析进入初始报警快照基线", () => {
  expect(() =>
    establishAlarmSnapshotBaseline(
      {
        ...request,
        change: {
          kind: "snapshot",
          values: [{ ...sample, serverTimestamp: "2026-02-28T24:00:00.000Z" }],
        },
      },
      Date.parse("2026-03-01T00:00:00.000Z"),
      1000,
    ),
  ).toThrow("报警服务器时间戳小时无效");
});

test("亚毫秒时间戳不能通过首份快照隐式截断建立报警基线", () => {
  expect(() =>
    establishAlarmSnapshotBaseline(
      {
        ...request,
        change: {
          kind: "snapshot",
          values: [{ ...sample, serverTimestamp: "2026-11-22T08:59:59.999900Z" }],
        },
      },
      nowMs,
      1000,
    ),
  ).toThrow("报警服务器时间戳精度超过毫秒");
});
