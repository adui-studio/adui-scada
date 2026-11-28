import { describe, expect, it } from "vite-plus/test";
import { TagHistoryBuffer } from "@adui/scada-core";
import type { TagHistoryPoint, TagValue } from "@adui/scada-core";
import {
  decodeHistoryPoint,
  encodeHistoryPoint,
  normalizeHistoryPoints,
} from "./tag-history-record-codec.js";

const timestamp = "2026-11-24T00:00:00.000Z";

function point(value: TagValue["value"], quality: TagValue["quality"] = "GOOD"): TagHistoryPoint {
  const buffer = new TagHistoryBuffer(1);
  buffer.append({
    kind: "sample",
    values: [
      {
        tagId: "water.level",
        value,
        quality,
        sourceTimestamp: null,
        serverTimestamp: timestamp,
        sequence: 1,
      },
    ],
  });
  return buffer.prepareArchive(1)!.records[0]!;
}

function row(sample: TagHistoryPoint) {
  return {
    tagId: sample.tagId,
    timestampMs: BigInt(sample.timestampMs),
    payload: encodeHistoryPoint(sample),
  };
}

describe("历史归档规范编码", () => {
  it("保留标量、质量、时间和原始顺序", () => {
    const points = [
      point(12.5),
      point("文本\\u0000\u0000"),
      point(true),
      point(null, "BAD"),
      point(3, "UNCERTAIN"),
      point(7, "STALE"),
    ];
    expect(normalizeHistoryPoints(points).map((sample) => decodeHistoryPoint(row(sample)))).toEqual(
      points,
    );
    expect(decodeHistoryPoint(row(points[4]!)).numericValue).toBeNull();
    expect(decodeHistoryPoint(row(points[5]!)).quality).toBe("STALE");
  });

  it("负零和正零的原始标量编码不同且负零往返不变", () => {
    const negative = point(-0);
    expect(encodeHistoryPoint(negative)).not.toBe(encodeHistoryPoint(point(0)));
    expect(Object.is(decodeHistoryPoint(row(negative)).value, -0)).toBe(true);
  });

  it("拒绝空批次、超量和伪造派生字段", () => {
    const sample = point(1);
    expect(() => normalizeHistoryPoints([])).toThrow("历史持久化批次记录数无效");
    expect(() => normalizeHistoryPoints(Array.from({ length: 257 }, () => sample))).toThrow(
      "历史持久化批次记录数无效",
    );
    expect(() => normalizeHistoryPoints([{ ...sample, numericValue: 99 }])).toThrow(
      "历史记录派生字段不匹配",
    );
    expect(() => normalizeHistoryPoints([{ ...sample, timestampMs: 0 }])).toThrow(
      "历史记录派生字段不匹配",
    );
  });

  it("拒绝损坏的存储内容、索引错配与非规范编码", () => {
    const stored = row(point(1));
    expect(() => decodeHistoryPoint({ ...stored, payload: "null" })).toThrow(
      "历史持久化记录损坏或编码无效",
    );
    expect(() => decodeHistoryPoint({ ...stored, tagId: "other.tag" })).toThrow(
      "历史持久化记录损坏或编码无效",
    );
    expect(() => decodeHistoryPoint({ ...stored, timestampMs: stored.timestampMs + 1n })).toThrow(
      "历史持久化记录损坏或编码无效",
    );
    expect(() => decodeHistoryPoint({ ...stored, payload: stored.payload + " " })).toThrow(
      "历史持久化记录损坏或编码无效",
    );
  });
});
