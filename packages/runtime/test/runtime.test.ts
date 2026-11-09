import { expect, test } from "vite-plus/test";
import { TagStore } from "@adui/scada-core";
import { applyDemoChange, initialRuntimeState } from "../src/runtime.ts";
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
