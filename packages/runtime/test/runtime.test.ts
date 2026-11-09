import { expect, test, vi } from "vite-plus/test";
import { TagStore } from "@adui/scada-core";
import { applyDemoChange, DemoRuntime, initialRuntimeState } from "../src/runtime.ts";
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
test("initial state is idle", () => {
  expect(initialRuntimeState.status).toBe("idle");
});
test("fresh snapshot resets sequence after reconnect", () => {
  const store = new TagStore();
  applyDemoChange(store, { kind: "snapshot", values: [mk(42)] });
  applyDemoChange(store, { kind: "snapshot", values: [mk(1)] });
  expect(store.get("water.level")?.sequence).toBe(1);
});
test("delta ignores old sequence", () => {
  const store = new TagStore();
  applyDemoChange(store, { kind: "snapshot", values: [mk(5)] });
  applyDemoChange(store, { kind: "delta", values: [mk(3)] });
  expect(store.get("water.level")?.sequence).toBe(5);
});
test("disconnect marks previously GOOD readings STALE", () => {
  const store = new TagStore();
  applyDemoChange(store, { kind: "snapshot", values: [mk()] });
  store.markDisconnected(Date.parse("2026-11-09T00:00:05Z"));
  expect(store.get("water.level")?.quality).toBe("STALE");
});
test("bad snapshot is atomic", () => {
  const store = new TagStore();
  applyDemoChange(store, { kind: "snapshot", values: [mk()] });
  expect(() =>
    applyDemoChange(store, { kind: "snapshot", values: [mk(2), { ...mk(3), value: Infinity }] }),
  ).toThrow(/Invalid number/);
  expect(store.get("water.level")?.sequence).toBe(1);
});
test("unknown event kind is rejected", () => {
  const store = new TagStore();
  expect(() => applyDemoChange(store, { kind: "execute", values: [] })).toThrow(
    /Invalid event kind/,
  );
});

test("offline desktop mode displays explicitly simulated values and closes its timer", () => {
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

test("SSE mode reports HTML fallback instead of parsing it as JSON", async () => {
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
