import { expect, test } from "vite-plus/test";
import { MAX_TAG_HISTORY_BUFFER_SAMPLES, TagHistoryBuffer } from "../src/tag-history.ts";
import type { TagHistoryBatch, TagHistoryQuery } from "../src/tag-history.ts";
import type { TagValue } from "../src/tag-store.ts";

const start = Date.parse("2026-11-24T00:00:00.000Z");
const query: TagHistoryQuery = {
  tagId: "water.level",
  startMs: start,
  endMs: start + 1000,
  maxPoints: 10,
};

function sample(offset: number, changes: Partial<TagValue> = {}): TagValue {
  return {
    tagId: query.tagId,
    value: 55,
    quality: "GOOD",
    sourceTimestamp: null,
    serverTimestamp: new Date(start + offset).toISOString(),
    sequence: 1,
    ...changes,
  };
}

test("历史缓冲区拒绝无效容量并支持明确容量边界", () => {
  for (const capacity of [0, -1, 1.5, Number.NaN, MAX_TAG_HISTORY_BUFFER_SAMPLES + 1]) {
    expect(() => new TagHistoryBuffer(capacity)).toThrow(/容量无效/);
  }
  expect(new TagHistoryBuffer(MAX_TAG_HISTORY_BUFFER_SAMPLES).size).toBe(0);
});

test("跨 Tag 共享总容量，满容量整批拒绝且保留已有记录", () => {
  const buffer = new TagHistoryBuffer(2);
  buffer.append({ kind: "sample", values: [sample(0)] });
  expect(() =>
    buffer.append({ kind: "sample", values: [sample(1), sample(2, { tagId: "water.flow" })] }),
  ).toThrow(/容量不足/);
  expect(buffer.size).toBe(1);
  buffer.append({ kind: "sample", values: [sample(2, { tagId: "water.flow" })] });
  expect(buffer.size).toBe(2);
  expect(() => buffer.append({ kind: "sample", values: [sample(3)] })).toThrow(/容量不足/);
  expect(buffer.query(query)).toHaveLength(1);
  expect(buffer.query({ ...query, tagId: "water.flow" })).toHaveLength(1);
});

test("历史查询复用质量投影、稳定时间排序及重复序列保留", () => {
  const buffer = new TagHistoryBuffer(4);
  buffer.append({
    kind: "sample",
    values: [
      sample(10, { value: 7 }),
      sample(0, { value: 5 }),
      sample(10, { value: 1, quality: "STALE" }),
      sample(20, { value: 2, quality: "BAD" }),
    ],
  });
  const points = buffer.query(query);
  expect(points.map((point) => point.value)).toEqual([5, 7, 1, 2]);
  expect(points.map((point) => point.numericValue)).toEqual([5, 7, null, null]);
  expect(points.map((point) => point.sequence)).toEqual([1, 1, 1, 1]);
  expect(() => buffer.query({ ...query, maxPoints: 3 })).toThrow(/超过点数上限/);
});

test("运行时派生质量及未知批次不能成为历史采样", () => {
  const buffer = new TagHistoryBuffer(2);
  expect(() =>
    buffer.append({ kind: "runtime-quality", values: [sample(0, { quality: "STALE" })] }),
  ).toThrow(/不接受运行时派生质量/);
  expect(() =>
    buffer.append({ kind: "unknown" as TagHistoryBatch["kind"], values: [sample(0)] }),
  ).toThrow(/未知批次/);
  expect(buffer.size).toBe(0);
  buffer.append({ kind: "sample", values: [sample(0, { quality: "STALE" })] });
  expect(buffer.query(query)[0].quality).toBe("STALE");
});

test("批次后项无效时不部分写入，其他 Tag 也必须验证", () => {
  const buffer = new TagHistoryBuffer(5);
  buffer.append({ kind: "sample", values: [sample(0)] });
  expect(() =>
    buffer.append({
      kind: "sample",
      values: [sample(1), sample(2, { tagId: "water.flow", value: Number.NaN })],
    }),
  ).toThrow(/有限数/);
  expect(() =>
    buffer.append({
      kind: "sample",
      values: [sample(1), sample(2, { serverTimestamp: "2026-02-30T00:00:00.000Z" })],
    }),
  ).toThrow(/规范 UTC 毫秒时间/);
  expect(buffer.size).toBe(1);
  expect(buffer.query(query)[0].timestampMs).toBe(start);
});

test("调用方修改原始采样和查询结果不会污染内部记录", () => {
  const buffer = new TagHistoryBuffer(2);
  const input = { ...sample(0), unrelated: "不保留" };
  buffer.append({ kind: "sample", values: [input] });
  input.value = 99;
  const first = buffer.query(query)[0];
  Object.assign(first, { value: 100, numericValue: 100 });
  expect(buffer.query(query)[0]).toEqual({
    ...sample(0),
    timestampMs: start,
    numericValue: 55,
  });
});

test("按服务器时间清理所有 Tag 并保留边界点，释放容量", () => {
  const buffer = new TagHistoryBuffer(3);
  buffer.append({
    kind: "sample",
    values: [sample(20), sample(0, { tagId: "water.flow" }), sample(10)],
  });
  expect(buffer.pruneBefore(start + 10)).toBe(1);
  expect(buffer.query(query).map((point) => point.timestampMs)).toEqual([start + 10, start + 20]);
  expect(buffer.pruneBefore(start + 10)).toBe(0);
  buffer.append({ kind: "sample", values: [sample(30)] });
  expect(buffer.size).toBe(3);
});

test("清理边界不得倒退，迟到旧点整批拒绝且边界点可写入", () => {
  const buffer = new TagHistoryBuffer(4);
  expect(buffer.pruneBefore(start + 10)).toBe(0);
  expect(() => buffer.pruneBefore(start + 9)).toThrow(/保留边界无效或倒退/);
  expect(() => buffer.pruneBefore(Number.NaN)).toThrow(/保留边界无效或倒退/);
  expect(() => buffer.pruneBefore(Number.MAX_SAFE_INTEGER)).toThrow(/保留边界无效或倒退/);
  expect(() =>
    buffer.append({ kind: "sample", values: [sample(11), sample(9)] }),
  ).toThrow(/早于保留边界/);
  expect(buffer.size).toBe(0);
  buffer.append({ kind: "sample", values: [sample(10)] });
  expect(buffer.size).toBe(1);
});

test("不同缓冲区彼此隔离，空采样和空查询不生成历史数据", () => {
  const left = new TagHistoryBuffer(2);
  const right = new TagHistoryBuffer(2);
  left.append({ kind: "sample", values: [] });
  expect(left.query(query)).toEqual([]);
  left.append({ kind: "sample", values: [sample(0)] });
  expect(right.query(query)).toEqual([]);
  expect(right.size).toBe(0);
});

test("稀疏采样数组的空位不能绕过原子校验", () => {
  const buffer = new TagHistoryBuffer(3);
  buffer.append({ kind: "sample", values: [sample(0)] });
  const values = [sample(1)];
  values.length = 2;
  expect(values).toHaveLength(2);
  expect(Object.hasOwn(values, 1)).toBe(false);
  expect(() => buffer.append({ kind: "sample", values })).toThrow(/历史记录必须为对象/);
  expect(buffer.size).toBe(1);
  expect(buffer.query(query)[0].timestampMs).toBe(start);
});

test("过长源时间在解析前拒绝，整批记录不写入", () => {
  const buffer = new TagHistoryBuffer(2);
  expect(() =>
    buffer.append({
      kind: "sample",
      values: [sample(0), sample(1, { sourceTimestamp: " ".repeat(129) })],
    }),
  ).toThrow(/源时间文本过长/);
  expect(buffer.size).toBe(0);
});
