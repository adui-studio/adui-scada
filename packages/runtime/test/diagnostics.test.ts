import { expect, test, vi } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "@adui/scada-core";
import {
  MAX_RUNTIME_STATUS_EVENTS,
  RuntimeStatusHistory,
  createRuntimeDiagnostics,
  formatRuntimeDataAge,
  formatRuntimeUpdateTime,
  initialRuntimeDiagnostics,
} from "../src/diagnostics.ts";
import { DemoRuntime } from "../src/runtime.ts";
import { OfflineDemoRuntime } from "../src/offline.ts";
import type { RuntimeState } from "../src/runtime.ts";
import type { ReadonlyTagSource, ReadonlyTagSourceHandlers } from "../src/tag-source.ts";

const tag = (tagId: string, quality: "GOOD" | "UNCERTAIN" | "BAD" | "STALE", sequence = 1) => ({
  tagId,
  quality,
  value: 20,
  sourceTimestamp: null,
  serverTimestamp: "2026-11-13T00:00:00.000Z",
  sequence,
});

test("诊断默认状态无数据且连接计数为零", () => {
  expect(initialRuntimeDiagnostics).toEqual({
    reconnectCount: 0,
    lastTagReceivedAt: null,
    dataAgeMs: null,
    tagCount: 0,
    qualityCounts: { GOOD: 0, UNCERTAIN: 0, BAD: 0, STALE: 0 },
    statusEvents: [],
  });
});

test("质量统计覆盖四种状态、数据年龄只以本机有效到达时间计算", () => {
  const values = [
    tag("water.good", "GOOD"),
    tag("water.uncertain", "UNCERTAIN"),
    tag("water.bad", "BAD"),
    tag("water.stale", "STALE"),
    tag("water.good2", "GOOD"),
  ];
  const result = createRuntimeDiagnostics(values, 1000, 2, 12_345);
  expect(result).toEqual({
    reconnectCount: 2,
    lastTagReceivedAt: 1000,
    dataAgeMs: 11_345,
    tagCount: 5,
    qualityCounts: { GOOD: 2, UNCERTAIN: 1, BAD: 1, STALE: 1 },
    statusEvents: [],
  });
  expect(createRuntimeDiagnostics(values, 20_000, 0, 19_000).dataAgeMs).toBe(0);
  expect(result.qualityCounts).not.toBe(initialRuntimeDiagnostics.qualityCounts);
});

test("状态事件按变化追加，同毫秒可区分且最多保留二十条", () => {
  const history = new RuntimeStatusHistory();
  expect(history.snapshot()).toEqual([]);
  history.record("loading", 100);
  history.record("loading", 100);
  history.record("connecting", 100);
  expect(history.snapshot()).toEqual([
    { sequence: 2, status: "connecting", occurredAt: 100 },
    { sequence: 1, status: "loading", occurredAt: 100 },
  ]);
  const earlierSnapshot = history.snapshot();
  for (let index = 0; index < 25; index++) {
    history.record(index % 2 === 0 ? "live" : "stale", 100 + index);
  }
  const events = history.snapshot();
  expect(events).toHaveLength(MAX_RUNTIME_STATUS_EVENTS);
  expect(events[0]?.sequence).toBe(27);
  expect(events.at(-1)?.sequence).toBe(8);
  expect(earlierSnapshot).toHaveLength(2);
  history.clear();
  history.record("simulation", 500);
  expect(history.snapshot()).toEqual([{ sequence: 1, status: "simulation", occurredAt: 500 }]);
});

test("状态事件诊断快照与内部历史隔离", () => {
  const history = new RuntimeStatusHistory();
  history.record("connecting", 1);
  const snapshot = createRuntimeDiagnostics([], null, 0, 2, history.snapshot());
  history.record("live", 3);
  expect(snapshot.statusEvents).toEqual([{ sequence: 1, status: "connecting", occurredAt: 1 }]);
  expect(history.snapshot()).toHaveLength(2);
});

test("诊断时间格式明确区别无有效数据与已接收数据", () => {
  expect(formatRuntimeDataAge(null)).toBe("尚无有效数据");
  expect(formatRuntimeDataAge(12_345)).toBe("12 秒");
  expect(formatRuntimeDataAge(90_500)).toBe("1 分 30 秒");
  expect(formatRuntimeUpdateTime(null)).toBe("尚无有效数据");
  expect(formatRuntimeUpdateTime(Date.parse("2026-11-13T00:00:00.000Z"))).not.toBe("");
});

test("共享 Runtime 统计有效 Tag、去重断连过程和本地 STALE，重启后清零", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T00:00:00.000Z"));
  const handlers: ReadonlyTagSourceHandlers[] = [];
  const source: ReadonlyTagSource = {
    async loadProject() {
      return waterTreatmentDemoDocument;
    },
    subscribe(next) {
      handlers.push(next);
      return { close() {} };
    },
  };
  const states: RuntimeState[] = [];
  const runtime = new DemoRuntime((state) => states.push(state), source);
  try {
    await runtime.start();
    expect(states.at(-1)?.diagnostics.dataAgeMs).toBeNull();
    expect(states.at(-1)?.diagnostics.statusEvents.map((e) => e.status)).toEqual([
      "connecting",
      "loading",
    ]);
    handlers[0]?.onMessage({
      kind: "snapshot",
      values: [tag("water.level", "GOOD"), tag("water.flow", "GOOD")],
    });
    expect(states.at(-1)?.diagnostics.qualityCounts.GOOD).toBe(2);
    expect(states.at(-1)?.diagnostics.dataAgeMs).toBe(0);
    expect(states.at(-1)?.diagnostics.statusEvents[0]?.status).toBe("live");
    const acceptedAt = states.at(-1)?.diagnostics.lastTagReceivedAt;

    vi.advanceTimersByTime(12_000);
    expect(states.at(-1)?.status).toBe("stale");
    expect(states.at(-1)?.diagnostics.qualityCounts.STALE).toBe(2);
    expect(states.at(-1)?.diagnostics.statusEvents[0]?.status).toBe("stale");
    expect(states.at(-1)?.diagnostics.qualityCounts.GOOD).toBe(0);
    expect(states.at(-1)?.diagnostics.lastTagReceivedAt).toBe(acceptedAt);
    expect(states.at(-1)?.diagnostics.dataAgeMs).toBeGreaterThanOrEqual(12_000);

    handlers[0]?.onMessage({ kind: "delta", values: [tag("water.level", "GOOD", 1)] });
    expect(states.at(-1)?.diagnostics.lastTagReceivedAt).toBe(acceptedAt);

    handlers[0]?.onMessage({ kind: "delta", values: [tag("water.level", "GOOD", 2)] });
    expect(states.at(-1)?.diagnostics.qualityCounts.GOOD).toBe(1);
    expect(states.at(-1)?.diagnostics.qualityCounts.STALE).toBe(1);

    handlers[0]?.onDisconnected();
    handlers[0]?.onDisconnected();
    expect(states.at(-1)?.diagnostics.reconnectCount).toBe(1);
    expect(states.at(-1)?.diagnostics.qualityCounts.STALE).toBe(2);
    expect(states.at(-1)?.diagnostics.statusEvents[0]?.status).toBe("reconnecting");
    expect(states.at(-1)?.diagnostics.statusEvents[1]?.status).toBe("stale");

    handlers[0]?.onMessage({
      kind: "snapshot",
      values: [tag("water.level", "GOOD", 1)],
    });
    expect(states.at(-1)?.diagnostics.reconnectCount).toBe(1);
    handlers[0]?.onDisconnected();
    expect(states.at(-1)?.diagnostics.reconnectCount).toBe(2);

    runtime.stop();
    await runtime.start();
    expect(states.at(-1)?.diagnostics.reconnectCount).toBe(0);
    expect(states.at(-1)?.diagnostics.lastTagReceivedAt).toBeNull();
    expect(states.at(-1)?.diagnostics.statusEvents.map((e) => e.status)).toEqual([
      "connecting",
      "loading",
    ]);
  } finally {
    runtime.stop();
    vi.useRealTimers();
  }
});

test("桌面离线模拟复用诊断快照但不会伪造 SSE 重连", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T00:00:00.000Z"));
  const states: RuntimeState[] = [];
  const runtime = new OfflineDemoRuntime((state) => states.push(state));
  try {
    runtime.start();
    expect(states.at(-1)?.status).toBe("simulation");
    expect(states.at(-1)?.diagnostics.reconnectCount).toBe(0);
    expect(states.at(-1)?.diagnostics.tagCount).toBe(3);
    expect(states.at(-1)?.diagnostics.qualityCounts.GOOD).toBe(3);
    vi.advanceTimersByTime(25_000);
    expect(states.at(-1)?.diagnostics.qualityCounts.STALE).toBe(3);
    expect(states.at(-1)?.diagnostics.reconnectCount).toBe(0);
    expect(states.at(-1)?.diagnostics.statusEvents.map((e) => e.status)).toEqual(["simulation"]);
  } finally {
    runtime.stop();
    vi.useRealTimers();
  }
});
