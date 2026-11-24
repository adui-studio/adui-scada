import { expect, test } from "vite-plus/test";
import { TagHistoryBuffer, TagHistorySampler } from "../src/tag-history.ts";
import type { TagHistorySampleInput, TagHistorySamplingPolicy } from "../src/tag-history.ts";
import type { TagValue } from "../src/tag-store.ts";

const start = Date.parse("2026-11-24T00:00:00.000Z");
const tagId = "water.level";
const query = { tagId, startMs: start, endMs: start + 10_000, maxPoints: 100 };
const policy: TagHistorySamplingPolicy = { intervalMs: 1000, numericDeadband: 5 };

function sample(offset: number, changes: Partial<TagValue> = {}): TagHistorySampleInput {
  return {
    kind: "sample",
    value: {
      tagId,
      value: 50,
      quality: "GOOD",
      sourceTimestamp: null,
      serverTimestamp: new Date(start + offset).toISOString(),
      sequence: 1,
      ...changes,
    },
  };
}

test("首次采样无条件保留，周期边界包含等于指定间隔", () => {
  const buffer = new TagHistoryBuffer(5);
  const sampler = new TagHistorySampler(buffer, tagId, { intervalMs: 1000 });
  expect(sampler.record(sample(0))).toBe("INITIAL");
  expect(sampler.record(sample(999))).toBe("SKIPPED");
  expect(sampler.record(sample(1000))).toBe("PERIODIC");
  expect(sampler.record(sample(1999))).toBe("SKIPPED");
  expect(sampler.record(sample(2000))).toBe("PERIODIC");
  expect(buffer.query(query).map((point) => point.timestampMs)).toEqual([
    start,
    start + 1000,
    start + 2000,
  ]);
});

test("数值变化以最后成功记录为基准，累积变化及双向阈值均可触发", () => {
  const buffer = new TagHistoryBuffer(5);
  const sampler = new TagHistorySampler(buffer, tagId, policy);
  expect(sampler.record(sample(0))).toBe("INITIAL");
  expect(sampler.record(sample(10, { value: 53 }))).toBe("SKIPPED");
  expect(sampler.record(sample(20, { value: 55 }))).toBe("VALUE_CHANGE");
  expect(sampler.record(sample(30, { value: 51 }))).toBe("SKIPPED");
  expect(sampler.record(sample(40, { value: 50 }))).toBe("VALUE_CHANGE");
  expect(buffer.query(query).map((point) => point.value)).toEqual([50, 55, 50]);
});

test("周期计时从最近一次成功记录重新计算，不补造缺失周期", () => {
  const buffer = new TagHistoryBuffer(5);
  const sampler = new TagHistorySampler(buffer, tagId, policy);
  sampler.record(sample(0));
  expect(sampler.record(sample(900, { value: 55 }))).toBe("VALUE_CHANGE");
  expect(sampler.record(sample(1000, { value: 55 }))).toBe("SKIPPED");
  expect(sampler.record(sample(1900, { value: 55 }))).toBe("PERIODIC");
  expect(sampler.record(sample(9000, { value: 55 }))).toBe("PERIODIC");
  expect(buffer.size).toBe(4);
});

test("全部采样质量变化优先保留，同毫秒变化也不按序列去重", () => {
  const buffer = new TagHistoryBuffer(5);
  const sampler = new TagHistorySampler(buffer, tagId, policy);
  expect(sampler.record(sample(0))).toBe("INITIAL");
  expect(sampler.record(sample(0, { quality: "UNCERTAIN" }))).toBe("QUALITY_CHANGE");
  expect(sampler.record(sample(0, { quality: "BAD" }))).toBe("QUALITY_CHANGE");
  expect(sampler.record(sample(0, { quality: "STALE" }))).toBe("QUALITY_CHANGE");
  expect(sampler.record(sample(0))).toBe("QUALITY_CHANGE");
  expect(buffer.query(query).map((point) => point.quality)).toEqual([
    "GOOD",
    "UNCERTAIN",
    "BAD",
    "STALE",
    "GOOD",
  ]);
  expect(buffer.query(query).map((point) => point.sequence)).toEqual([1, 1, 1, 1, 1]);
});

test("同为 GOOD 时数值可用性变化优先保留，零值不是缺失", () => {
  const buffer = new TagHistoryBuffer(4);
  const sampler = new TagHistorySampler(buffer, tagId, { intervalMs: 1000 });
  expect(sampler.record(sample(0, { value: 0 }))).toBe("INITIAL");
  expect(sampler.record(sample(1, { value: null }))).toBe("VALUE_AVAILABILITY_CHANGE");
  expect(sampler.record(sample(2, { value: 0 }))).toBe("VALUE_AVAILABILITY_CHANGE");
  expect(buffer.query(query).map((point) => point.numericValue)).toEqual([0, null, 0]);
});

test("非 GOOD 数值不触发变化阈值，非数值标量不隐式转换", () => {
  const buffer = new TagHistoryBuffer(5);
  const sampler = new TagHistorySampler(buffer, tagId, policy);
  expect(sampler.record(sample(0, { quality: "BAD" }))).toBe("INITIAL");
  expect(sampler.record(sample(1, { quality: "BAD", value: 999 }))).toBe("SKIPPED");
  expect(sampler.record(sample(2, { value: "50" }))).toBe("QUALITY_CHANGE");
  expect(sampler.record(sample(3, { value: "999" }))).toBe("SKIPPED");
  expect(sampler.record(sample(1002, { value: true }))).toBe("PERIODIC");
  expect(buffer.query(query).map((point) => point.numericValue)).toEqual([null, null, null]);
});

test("未配置变化阈值时正常数值只按周期记录", () => {
  const buffer = new TagHistoryBuffer(3);
  const sampler = new TagHistorySampler(buffer, tagId, { intervalMs: 1000 });
  sampler.record(sample(0));
  expect(sampler.record(sample(1, { value: 999 }))).toBe("SKIPPED");
  expect(sampler.record(sample(1000, { value: 999 }))).toBe("PERIODIC");
  expect(buffer.size).toBe(2);
});

test("容量拒绝后清理再重试，仍以最后成功记录为变化基线", () => {
  const buffer = new TagHistoryBuffer(1);
  const sampler = new TagHistorySampler(buffer, tagId, policy);
  sampler.record(sample(0));
  expect(() => sampler.record(sample(10, { value: 55 }))).toThrow(/容量不足/);
  expect(buffer.query(query)[0].value).toBe(50);
  expect(buffer.pruneBefore(start + 1)).toBe(1);
  expect(sampler.record(sample(10, { value: 55 }))).toBe("VALUE_CHANGE");
  expect(buffer.query(query)[0].value).toBe(55);
});

test("写入失败也不推进观测时间，允许更早的合法候选重试", () => {
  const buffer = new TagHistoryBuffer(1);
  const sampler = new TagHistorySampler(buffer, tagId, policy);
  sampler.record(sample(0));
  expect(() => sampler.record(sample(1000))).toThrow(/容量不足/);
  buffer.pruneBefore(start + 1);
  expect(sampler.record(sample(500, { quality: "BAD" }))).toBe("QUALITY_CHANGE");
});

test("已跳过的合法观测仍约束后续时间顺序，不把倒退当作新采样", () => {
  const buffer = new TagHistoryBuffer(4);
  const sampler = new TagHistorySampler(buffer, tagId, policy);
  sampler.record(sample(0));
  expect(sampler.record(sample(500))).toBe("SKIPPED");
  expect(() => sampler.record(sample(499, { quality: "BAD" }))).toThrow(/服务器时间倒退/);
  expect(sampler.record(sample(500, { quality: "BAD" }))).toBe("QUALITY_CHANGE");
  expect(buffer.size).toBe(2);
});

test("拒绝派生质量、错 Tag 与无效记录，即使本应跳过也必须校验", () => {
  const buffer = new TagHistoryBuffer(5);
  const sampler = new TagHistorySampler(buffer, tagId, policy);
  sampler.record(sample(0));
  expect(() => sampler.record({ ...sample(1), kind: "runtime-quality" })).toThrow(/派生质量/);
  expect(() => sampler.record(sample(1, { tagId: "water.flow" }))).toThrow(/Tag ID 不匹配/);
  expect(() => sampler.record(sample(1, { value: Number.NaN }))).toThrow(/有限数/);
  expect(() =>
    sampler.record(sample(1, { serverTimestamp: "2026-02-30T00:00:00.000Z" })),
  ).toThrow(/规范 UTC 毫秒时间/);
  expect(() => sampler.record(sample(1, { sourceTimestamp: " ".repeat(129) }))).toThrow(
    /源时间文本过长/,
  );
  expect(buffer.size).toBe(1);
});

test("拒绝非法策略，固定策略值及输入记录不受外部修改影响", () => {
  const buffer = new TagHistoryBuffer(4);
  for (const intervalMs of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => new TagHistorySampler(buffer, tagId, { intervalMs })).toThrow(/周期无效/);
  }
  for (const numericDeadband of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => new TagHistorySampler(buffer, tagId, { intervalMs: 1000, numericDeadband })).toThrow(
      /变化阈值无效/,
    );
  }
  expect(() => new TagHistorySampler(buffer, "../tag", policy)).toThrow(/Tag ID 无效/);
  const options = { intervalMs: 1000, numericDeadband: 5 };
  const sampler = new TagHistorySampler(buffer, tagId, options);
  const input = sample(0);
  sampler.record(input);
  options.numericDeadband = 100;
  input.value.value = 100;
  expect(sampler.record(sample(1, { value: 55 }))).toBe("VALUE_CHANGE");
  expect(buffer.query(query)[0].value).toBe(50);
});

test("不同 Tag 实例拥有独立基线，首次写入失败后仍保持首次状态", () => {
  const buffer = new TagHistoryBuffer(1);
  const left = new TagHistorySampler(buffer, tagId, policy);
  const right = new TagHistorySampler(buffer, "water.flow", policy);
  expect(left.record(sample(0))).toBe("INITIAL");
  const flow = sample(1, { tagId: "water.flow" });
  expect(() => right.record(flow)).toThrow(/容量不足/);
  buffer.pruneBefore(start + 1);
  expect(right.record(flow)).toBe("INITIAL");
  expect(buffer.query({ ...query, tagId: "water.flow" })).toHaveLength(1);
});
