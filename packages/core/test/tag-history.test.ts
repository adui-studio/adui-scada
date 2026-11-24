import { expect, test } from "vite-plus/test";
import { selectTagHistory } from "../src/tag-history.ts";
import type { TagHistoryQuery } from "../src/tag-history.ts";
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

test("历史查询仅返回指定 Tag 和左闭右开时间范围内的记录", () => {
  const points = selectTagHistory(
    [
      sample(1000),
      sample(999),
      sample(-1),
      sample(0),
      sample(10, { tagId: "water.flow" }),
    ],
    query,
  );
  expect(points.map((point) => point.timestampMs)).toEqual([start, start + 999]);
  expect(points.map((point) => point.tagId)).toEqual([query.tagId, query.tagId]);
});

test("历史趋势保留四种质量和原值，只有正常数值生成绘图值", () => {
  const points = selectTagHistory(
    [
      sample(0, { value: 0 }),
      sample(1, { quality: "UNCERTAIN" }),
      sample(2, { quality: "BAD" }),
      sample(3, { quality: "STALE" }),
      sample(4, { value: true }),
      sample(5, { value: "55" }),
      sample(6, { value: null }),
    ],
    query,
  );
  expect(points.map((point) => point.numericValue)).toEqual([0, null, null, null, null, null, null]);
  expect(points.map((point) => point.value)).toEqual([0, 55, 55, 55, true, "55", null]);
  expect(points.map((point) => point.quality)).toEqual([
    "GOOD",
    "UNCERTAIN",
    "BAD",
    "STALE",
    "GOOD",
    "GOOD",
    "GOOD",
  ]);
});

test("重复和跳变序列不被误作历史去重，同毫秒保持输入顺序", () => {
  const points = selectTagHistory(
    [
      sample(10, { sequence: 7, value: 7 }),
      sample(0, { sequence: 5, value: 5 }),
      sample(10, { sequence: 1, value: 1 }),
      sample(20, { sequence: 1, value: 2 }),
    ],
    query,
  );
  expect(points.map((point) => point.value)).toEqual([5, 7, 1, 2]);
  expect(points.map((point) => point.sequence)).toEqual([5, 7, 1, 1]);
});

test("保留源时间，查询不修改输入也不回传额外字段", () => {
  const input = {
    ...sample(0, { sourceTimestamp: "2026-11-23T23:59:59.000Z" }),
    unrelated: "不应进入结果",
  };
  const points = selectTagHistory([input], query);
  expect(points[0]).toEqual({
    ...sample(0, { sourceTimestamp: input.sourceTimestamp }),
    timestampMs: start,
    numericValue: 55,
  });
  expect(input.value).toBe(55);
  expect(points[0]).not.toBe(input);
});

test("空结果不补造数据，超量结果不静默截断", () => {
  expect(selectTagHistory([], query)).toEqual([]);
  expect(selectTagHistory([sample(0)], { ...query, maxPoints: 1 })).toHaveLength(1);
  expect(() => selectTagHistory([sample(0), sample(1)], { ...query, maxPoints: 1 })).toThrow(
    /超过点数上限/,
  );
});

test("拒绝无效查询标识、时间边界与点数限制", () => {
  expect(() => selectTagHistory([], { ...query, tagId: "../tag" })).toThrow(/Tag ID 无效/);
  expect(() => selectTagHistory([], { ...query, startMs: Number.NaN })).toThrow(/时间范围无效/);
  expect(() => selectTagHistory([], { ...query, endMs: start })).toThrow(/时间范围无效/);
  expect(() => selectTagHistory([], { ...query, endMs: Number.MAX_SAFE_INTEGER })).toThrow(
    /时间范围无效/,
  );
  expect(() => selectTagHistory([], { ...query, maxPoints: 0 })).toThrow(/点数上限无效/);
  expect(() => selectTagHistory([], { ...query, maxPoints: 1.5 })).toThrow(/点数上限无效/);
});

test("拒绝不规范或隐式归一化的历史服务器时间，不改写通用 TagStore", () => {
  for (const serverTimestamp of [
    "2026-11-24T00:00:00",
    "2026-11-24T00:00:00.000+00:00",
    "2026-11-24T00:00:00.0001Z",
    "2026-02-30T00:00:00.000Z",
    "2026-11-23T24:00:00.000Z",
  ]) {
    expect(() => selectTagHistory([sample(0, { serverTimestamp })], query)).toThrow(
      /规范 UTC 毫秒时间/,
    );
  }
});

test("拒绝同一 Tag 的无效标量和无效质量", () => {
  expect(() => selectTagHistory([sample(0, { value: Number.NaN })], query)).toThrow(/有限数/);
  expect(() =>
    selectTagHistory([sample(0, { quality: "UNKNOWN" as TagValue["quality"] })], query),
  ).toThrow(/质量状态无效/);
});
