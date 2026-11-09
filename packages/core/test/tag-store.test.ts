import { test } from "vite-plus/test";
import assert from "node:assert/strict";
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

void test("subscribers receive initial snapshot and incrementals; unsubscribe works", () => {
  const store = new TagStore();
  const events: string[] = [];
  const unsubscribe = store.subscribe((event) =>
    events.push(`${event.kind}:${event.values.length}`),
  );
  store.apply([make()]);
  unsubscribe();
  store.apply([make(2)]);
  assert.deepEqual(events, ["snapshot:0", "delta:1"]);
});

void test("ignores out-of-order and duplicate sequence without mutating values", () => {
  const store = new TagStore();
  store.apply([make(5)]);
  assert.equal(store.apply([make(3)]).length, 0);
  assert.equal(store.apply([make(5)]).length, 0);
  assert.equal(store.get("water.level")?.sequence, 5);
});

void test("batch rejects invalid/duplicated data atomically", () => {
  const store = new TagStore();
  const bad = { ...make(), value: Number.NaN };
  assert.throws(() => store.apply([make(), bad]), /Duplicate update|Invalid number/);
  assert.deepEqual(store.snapshot(), []);
  assert.throws(() => store.apply([make(), make(2)]), /Duplicate update/);
  assert.deepEqual(store.snapshot(), []);
  assert.throws(
    () => validateTagValue({ ...make(), quality: "UNKNOWN" as any }),
    /Invalid quality/,
  );
});

void test("stale is explicit, changes sequence, retains last reading, recovery is possible", () => {
  const store = new TagStore();
  store.apply([make()]);
  const now = Date.parse(at) + 3000;
  const stale = store.markStale(now, 2500);
  assert.equal(stale[0].quality, "STALE");
  assert.equal(stale[0].value, 55);
  assert.equal(stale[0].sequence, 2);
  assert.equal(store.markStale(now + 3000, 2500).length, 0);
  store.apply([{ ...make(3), value: 65, serverTimestamp: new Date(now + 4000).toISOString() }]);
  assert.equal(store.get("water.level")?.quality, "GOOD");
  assert.equal(store.get("water.level")?.value, 65);
});
