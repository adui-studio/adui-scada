import { expect, test, vi } from "vite-plus/test";
import { TagStore, waterTreatmentDemoDocument, parseScadaDocument } from "@adui/scada-core";
import {
  applyDemoChange,
  DemoRuntime,
  initialRuntimeState,
  RUNTIME_STATUS_LABELS,
  svgDataUrl,
} from "../src/runtime.ts";
import { OfflineDemoRuntime } from "../src/offline.ts";
import type { RuntimeState } from "../src/runtime.ts";
const mk = (sequence = 1) => ({
  tagId: "water.level",
  value: 12,
  quality: "GOOD" as const,
  sourceTimestamp: null,
  serverTimestamp: "2026-11-09T00:00:00Z",
  sequence,
});
test("运行时初始状态为未启动", () => {
  expect(initialRuntimeState.status).toBe("idle");
});
test("重连后的新快照可重置 Tag 序列号", () => {
  const store = new TagStore();
  applyDemoChange(store, { kind: "snapshot", values: [mk(42)] });
  applyDemoChange(store, { kind: "snapshot", values: [mk(1)] });
  expect(store.get("water.level")?.sequence).toBe(1);
});
test("增量数据忽略较旧的序列号", () => {
  const store = new TagStore();
  applyDemoChange(store, { kind: "snapshot", values: [mk(5)] });
  applyDemoChange(store, { kind: "delta", values: [mk(3)] });
  expect(store.get("water.level")?.sequence).toBe(5);
});
test("连接中断后将此前正常的读数标记为 STALE", () => {
  const store = new TagStore();
  applyDemoChange(store, { kind: "snapshot", values: [mk()] });
  store.markDisconnected(Date.parse("2026-11-09T00:00:05Z"));
  expect(store.get("water.level")?.quality).toBe("STALE");
});
test("无效快照会整体拒绝且不破坏已有数据", () => {
  const store = new TagStore();
  applyDemoChange(store, { kind: "snapshot", values: [mk()] });
  expect(() =>
    applyDemoChange(store, { kind: "snapshot", values: [mk(2), { ...mk(3), value: Infinity }] }),
  ).toThrow(/Tag 数值必须为有限数/);
  expect(store.get("water.level")?.sequence).toBe(1);
});
test("拒绝未知的事件类型", () => {
  const store = new TagStore();
  expect(() => applyDemoChange(store, { kind: "execute", values: [] })).toThrow(/事件类型无效/);
});

test("桌面离线模式明确显示模拟数据且停止时清理定时器", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T00:00:00.000Z"));
  const states: RuntimeState[] = [];
  const runtime = new OfflineDemoRuntime((state) => states.push(state));

  try {
    runtime.start();
    expect(states.at(-1)?.status).toBe("simulation");
    expect(states.at(-1)?.message).toMatch(/离线模拟/);
    expect(states.at(-1)?.document?.projectId).toBe("water-demo");
    expect(states.at(-1)?.values).toHaveLength(3);
    expect(states.at(-1)?.values.every((tag) => tag.quality === "GOOD")).toBe(true);

    vi.advanceTimersByTime(25_000);
    expect(states.at(-1)?.values.every((tag) => tag.quality === "STALE")).toBe(true);
    expect(states.at(-1)?.message).toMatch(/演练数据中断/);

    runtime.stop();
    const count = states.length;
    vi.advanceTimersByTime(5_000);
    expect(states).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    runtime.stop();
    vi.useRealTimers();
  }
});

test("SSE 返回 HTML 时报告接口类型异常而非将其解析成 JSON", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("<!doctype html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    ),
  );

  const states: RuntimeState[] = [];
  const runtime = new DemoRuntime((state) => states.push(state));
  try {
    await runtime.start();
    expect(states.at(-1)?.status).toBe("error");
    expect(states.at(-1)?.message).toMatch(/未返回 JSON/);
    expect(states.at(-1)?.values).toHaveLength(0);
  } finally {
    runtime.stop();
    vi.unstubAllGlobals();
  }
});

test("运行时状态有完整中文名称且内部状态标识保持不变", () => {
  expect(RUNTIME_STATUS_LABELS).toEqual({
    idle: "未启动",
    loading: "加载中",
    connecting: "连接中",
    live: "模拟数据正常",
    stale: "Tag 数据已过期",
    simulation: "离线模拟",
    reconnecting: "重新连接中",
    error: "运行异常",
  });
});

test("SVG 预览可以指定第二页，默认仍保持第一页兼容", () => {
  const document = parseScadaDocument({
    ...waterTreatmentDemoDocument,
    pages: [
      ...waterTreatmentDemoDocument.pages,
      {
        id: "second",
        name: "第二页",
        size: { width: 640, height: 360 },
        nodes: [],
      },
    ],
  });
  const original = decodeURIComponent(svgDataUrl(document, []).split(",")[1]!);
  const second = decodeURIComponent(svgDataUrl(document, [], "second").split(",")[1]!);
  expect(original).toContain('data-node-id="tank"');
  expect(second).toContain('aria-label="第二页"');
  expect(second).not.toContain('data-node-id="tank"');
  expect(() => svgDataUrl(document, [], "missing")).toThrow(/未找到页面/);
});
