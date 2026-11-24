import { describe, expect, it } from "vite-plus/test";
import { encodeHistoryPoint } from "./tag-history-record-codec.js";
import { decodePrisma8HistoryRows, preparePrisma8HistoryQuery } from "./prisma8-tag-history-reader.js";

const scope = { tenantId: "tenant-a", projectId: "project-a" };
const timestamp = "2026-11-24T00:00:00.000Z";
const startMs = Date.parse(timestamp);
const query = { tagId: "water.level", startMs, endMs: startMs + 1, maxPoints: 2 };
const point = {
  tagId: query.tagId,
  value: -0,
  quality: "GOOD" as const,
  sourceTimestamp: null,
  serverTimestamp: timestamp,
  sequence: 1,
  timestampMs: startMs,
  numericValue: -0,
};
const row = {
  ...scope,
  tagId: query.tagId,
  timestampMs: BigInt(startMs),
  payload: encodeHistoryPoint(point),
};

describe("Prisma 8 历史查询候选输入与结果门禁", () => {
  it("保留左闭右开毫秒时间窗口与原始负零", () => {
    const prepared = preparePrisma8HistoryQuery(scope, query);
    expect(prepared.start).toBe(BigInt(startMs));
    expect(prepared.end).toBe(BigInt(startMs + 1));
    expect(decodePrisma8HistoryRows([row], prepared)).toEqual([point]);
    expect(Object.is(decodePrisma8HistoryRows([row], prepared)[0]?.value, -0)).toBe(true);
  });

  it("拒绝非法工程作用域及超出服务端上限的请求", () => {
    expect(() => preparePrisma8HistoryQuery({ ...scope, tenantId: "" }, query)).toThrow(
      "历史归档作用域标识无效",
    );
    expect(() => preparePrisma8HistoryQuery({ ...scope, projectId: "../other" }, query)).toThrow(
      "历史归档作用域标识无效",
    );
    expect(() => preparePrisma8HistoryQuery(scope, { ...query, maxPoints: 1001 })).toThrow(
      "历史查询点数上限超过服务端限制",
    );
    expect(() => preparePrisma8HistoryQuery(scope, { ...query, endMs: startMs })).toThrow(
      "历史查询时间范围无效",
    );
  });

  it("拒绝跨租户、跨工程、其他 Tag 及窗口外记录", () => {
    const prepared = preparePrisma8HistoryQuery(scope, query);
    const invalid = [
      { ...row, tenantId: "tenant-b" },
      { ...row, projectId: "project-b" },
      { ...row, tagId: "water.other" },
      { ...row, timestampMs: BigInt(startMs - 1) },
      { ...row, timestampMs: BigInt(startMs + 1) },
    ];
    expect(
      invalid.map((item) => {
        try {
          decodePrisma8HistoryRows([item], prepared);
          return "";
        } catch (error) {
          return error instanceof Error ? error.message : "";
        }
      }),
    ).toEqual(invalid.map(() => "历史查询返回记录超出限定作用域或时间范围"));
  });

  it("超量结果必须拒绝而不是截断，空结果原样返回", () => {
    const prepared = preparePrisma8HistoryQuery(scope, query);
    expect(() => decodePrisma8HistoryRows([row, row, row], prepared)).toThrow(
      "历史查询结果超过点数上限，请缩小时间范围",
    );
    expect(decodePrisma8HistoryRows([], prepared)).toEqual([]);
  });

  it("损坏原始记录不得产生正常趋势点", () => {
    const prepared = preparePrisma8HistoryQuery(scope, query);
    expect(() => decodePrisma8HistoryRows([{ ...row, payload: "{}" }], prepared)).toThrow(
      "历史持久化记录损坏或编码无效",
    );
  });
});
