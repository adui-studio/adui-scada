import { expect, test } from "vite-plus/test";
import {
  MAX_TAG_HISTORY_BUFFER_SAMPLES,
  TagHistoryBuffer,
  TagHistorySampler,
} from "../src/tag-history.ts";
import type { TagHistoryArchiveBatch } from "../src/tag-history.ts";
import type { TagValue } from "../src/tag-store.ts";

const start = Date.parse("2026-11-24T00:00:00.000Z");
const tagId = "water.level";
const query = { tagId, startMs: start, endMs: start + 10_000, maxPoints: 100 };

function sample(offset: number, changes: Partial<TagValue> = {}): TagValue {
  return {
    tagId,
    value: 50,
    quality: "GOOD",
    sourceTimestamp: null,
    serverTimestamp: new Date(start + offset).toISOString(),
    sequence: 1,
    ...changes,
  };
}

function prepare(buffer: TagHistoryBuffer, maxRecords: number): TagHistoryArchiveBatch {
  const batch = buffer.prepareArchive(maxRecords);
  if (!batch) throw new Error("测试预期存在待归档批次");
  return batch;
}

test("空缓冲不创建批次，归档上限必须为有界正整数", () => {
  const buffer = new TagHistoryBuffer(2);
  expect(buffer.prepareArchive(1)).toBeUndefined();
  for (const limit of [0, -1, 1.5, Number.NaN, MAX_TAG_HISTORY_BUFFER_SAMPLES + 1]) {
    expect(() => buffer.prepareArchive(limit)).toThrow(/批次上限无效/);
  }
  expect(buffer.size).toBe(0);
});

test("归档按入缓冲顺序跨 Tag 保留原值质量和重复序列，不按时间重新排序", () => {
  const buffer = new TagHistoryBuffer(4);
  buffer.append({
    kind: "sample",
    values: [
      sample(20, { value: 7, quality: "BAD" }),
      sample(0, { tagId: "water.flow", value: 8 }),
      sample(20, { value: 9, sourceTimestamp: "2026-11-23T23:59:59.000Z" }),
      sample(10, { value: 10 }),
    ],
  });
  const batch = prepare(buffer, 3);
  expect(batch.records.map((point) => point.value)).toEqual([7, 8, 9]);
  expect(batch.records.map((point) => point.sequence)).toEqual([1, 1, 1]);
  expect(batch.records[0].quality).toBe("BAD");
  expect(batch.records[0].numericValue).toBeNull();
  expect(batch.records[2].sourceTimestamp).toBe("2026-11-23T23:59:59.000Z");
  expect(buffer.size).toBe(4);
  expect(buffer.query(query)).toHaveLength(3);
});

test("批次及记录不可变且与原始采样和查询结果隔离", () => {
  const buffer = new TagHistoryBuffer(2);
  const input = sample(0);
  buffer.append({ kind: "sample", values: [input] });
  const batch = prepare(buffer, 1);
  input.value = 100;
  Object.assign(buffer.query(query)[0], { value: 200 });
  expect(Object.isFrozen(batch)).toBe(true);
  expect(Object.isFrozen(batch.records)).toBe(true);
  expect(Object.isFrozen(batch.records[0])).toBe(true);
  expect(() => Object.assign(batch.records[0], { value: 300 })).toThrow();
  expect(batch.records[0].value).toBe(50);
  expect(buffer.query(query)[0].value).toBe(50);
});

test("结果未知时重试返回同一批次，新采样不能改变待确认内容", () => {
  const buffer = new TagHistoryBuffer(4);
  buffer.append({ kind: "sample", values: [sample(0), sample(1)] });
  const batch = prepare(buffer, 2);
  buffer.append({ kind: "sample", values: [sample(2)] });
  expect(prepare(buffer, 2)).toBe(batch);
  expect(prepare(buffer, 4)).toBe(batch);
  expect(() => buffer.prepareArchive(1)).toThrow(/不能缩小/);
  expect(batch.records).toHaveLength(2);
  expect(buffer.size).toBe(3);
});

test("整批确认仅移除对应前缀，后续及迟到记录保持原样", () => {
  const buffer = new TagHistoryBuffer(4);
  buffer.append({ kind: "sample", values: [sample(20), sample(30)] });
  const batch = prepare(buffer, 2);
  buffer.append({ kind: "sample", values: [sample(0), sample(10)] });
  expect(buffer.confirmArchive(batch)).toBe(2);
  expect(buffer.size).toBe(2);
  const next = prepare(buffer, 2);
  expect(next).not.toBe(batch);
  expect(next.records.map((point) => point.timestampMs)).toEqual([start, start + 10]);
  expect(buffer.confirmArchive(next)).toBe(2);
  expect(buffer.prepareArchive(2)).toBeUndefined();
});

test("伪造批次、其他缓冲区批次与迟到重复确认均不能移除记录", () => {
  const left = new TagHistoryBuffer(3);
  const right = new TagHistoryBuffer(3);
  left.append({ kind: "sample", values: [sample(0), sample(1)] });
  right.append({ kind: "sample", values: [sample(0)] });
  const batch = prepare(left, 1);
  const foreign = prepare(right, 1);
  expect(() => left.confirmArchive({ records: batch.records })).toThrow(/批次无效/);
  expect(() => left.confirmArchive(foreign)).toThrow(/批次无效/);
  expect(left.size).toBe(2);
  expect(left.confirmArchive(batch)).toBe(1);
  const next = prepare(left, 1);
  expect(() => left.confirmArchive(batch)).toThrow(/批次无效/);
  expect(left.size).toBe(1);
  expect(left.confirmArchive(next)).toBe(1);
  expect(() => left.confirmArchive(next)).toThrow(/批次无效/);
  expect(right.size).toBe(1);
});

test("未确认批次阻止显式清理，确认后仍沿用原保留边界规则", () => {
  const buffer = new TagHistoryBuffer(4);
  buffer.pruneBefore(start);
  buffer.append({ kind: "sample", values: [sample(0), sample(1), sample(2)] });
  const batch = prepare(buffer, 1);
  expect(() => buffer.pruneBefore(start + 3)).toThrow(/待确认/);
  expect(buffer.size).toBe(3);
  expect(buffer.confirmArchive(batch)).toBe(1);
  expect(buffer.pruneBefore(start + 2)).toBe(1);
  expect(buffer.size).toBe(1);
  expect(() => buffer.append({ kind: "sample", values: [sample(1)] })).toThrow(/早于保留边界/);
});

test("待归档记录占用容量，确认释放容量后采样器按原成功基线重试", () => {
  const buffer = new TagHistoryBuffer(1);
  const sampler = new TagHistorySampler(buffer, tagId, { intervalMs: 1000, numericDeadband: 5 });
  expect(sampler.record({ kind: "sample", value: sample(0) })).toBe("INITIAL");
  const batch = prepare(buffer, 1);
  const next = { kind: "sample", value: sample(1, { value: 55 }) } as const;
  expect(() => sampler.record(next)).toThrow(/容量不足/);
  expect(prepare(buffer, 1)).toBe(batch);
  expect(buffer.confirmArchive(batch)).toBe(1);
  expect(sampler.record(next)).toBe("VALUE_CHANGE");
  expect(buffer.query(query)[0].value).toBe(55);
});
