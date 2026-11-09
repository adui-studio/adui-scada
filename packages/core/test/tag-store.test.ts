import { expect, test } from "vite-plus/test";
import { TagStore, validateTagValue } from "../src/tag-store.ts";
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

test("subscribers receive initial snapshot and incrementals; unsubscribe works", () => {
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

test("ignores out-of-order and duplicate sequence without mutating values", () => {
  const store = new TagStore();
  store.apply([make(5)]);
  expect(store.apply([make(3)]).length).toBe(0);
  expect(store.apply([make(5)]).length).toBe(0);
  expect(store.get("water.level")?.sequence).toBe(5);
});

test("batch rejects invalid/duplicated data atomically", () => {
  const store = new TagStore();
  const bad = { ...make(), value: Number.NaN };
  expect(() => store.apply([make(), bad])).toThrow(/Duplicate update|Invalid number/);
  expect(store.snapshot()).toEqual([]);
  expect(() => store.apply([make(), make(2)])).toThrow(/Duplicate update/);
  expect(store.snapshot()).toEqual([]);
  expect(() => validateTagValue({ ...make(), quality: "UNKNOWN" as any })).toThrow(/Invalid quality/);
});

test("stale is explicit, changes sequence, retains last reading, recovery is possible", () => {
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
