import { expect, test } from "vite-plus/test";
import { TAG_QUALITY_LABELS, TagStore, validateTagValue } from "../src/tag-store.ts";
import type { TagValue } from "../src/tag-store.ts";

const at = "2026-11-09T00:00:00.000Z";
const make = (sequence = 1, quality: TagValue["quality"] = "GOOD"): TagValue => ({
  tagId: "water.level",
  value: 55,
  quality,
  sourceTimestamp: at,
  serverTimestamp: at,
  sequence,
});

test("订阅者可收到初始快照与增量，取消订阅后不再接收", () => {
  const store = new TagStore();
  const events: string[] = [];
  const unsubscribe = store.subscribe((event) =>
    events.push(`${event.kind}:${event.values.length}`),
  );
  store.apply([make()]);
  unsubscribe();
  store.apply([make(2)]);
  expect(events).toEqual(["snapshot:0", "delta:1"]);
});

test("忽略乱序及重复序列号且不修改已有数据", () => {
  const store = new TagStore();
  store.apply([make(5)]);
  expect(store.apply([make(3)]).length).toBe(0);
  expect(store.apply([make(5)]).length).toBe(0);
  expect(store.get("water.level")?.sequence).toBe(5);
});

test("同一批次存在非法或重复 Tag 时原子拒绝", () => {
  const store = new TagStore();
  const bad = { ...make(), value: Number.NaN };
  expect(() => store.apply([make(), bad])).toThrow(
    /同一批次存在重复的 Tag 更新|Tag 数值必须为有限数/,
  );
  expect(store.snapshot()).toEqual([]);
  expect(() => store.apply([make(), make(2)])).toThrow(/同一批次存在重复的 Tag 更新/);
  expect(store.snapshot()).toEqual([]);
  expect(() => validateTagValue({ ...make(), quality: "UNKNOWN" as any })).toThrow(
    /Tag 质量状态无效/,
  );
});

test("数据过期后质量明确变为 STALE，保留末次值并支持恢复", () => {
  const store = new TagStore();
  store.apply([make()]);
  const now = Date.parse(at) + 3000;
  const stale = store.markStale(now, 2500);
  expect(stale[0].quality).toBe("STALE");
  expect(stale[0].value).toBe(55);
  expect(stale[0].sequence).toBe(2);
  expect(store.markStale(now + 3000, 2500).length).toBe(0);
  store.apply([{ ...make(3), value: 65, serverTimestamp: new Date(now + 4000).toISOString() }]);
  expect(store.get("water.level")?.quality).toBe("GOOD");
  expect(store.get("water.level")?.value).toBe(65);
});

test("质量状态中文显示名称完整且协议枚举不变", () => {
  expect(TAG_QUALITY_LABELS).toEqual({
    GOOD: "正常",
    UNCERTAIN: "不确定",
    BAD: "异常",
    STALE: "已过期",
  });
});
