import type { TagHistoryPersistenceRequest, TagHistoryPoint } from "@adui/scada-core";
import { describe, expect, it } from "vite-plus/test";
import {
  assertPrisma8HistoryBatch,
  preparePrisma8HistoryBatch,
} from "./prisma8-tag-history-store.js";

const scope = { tenantId: "tenant-a", projectId: "project-a", streamId: "stream-a" };
const timestamp = "2026-11-24T00:00:00.000Z";
const sample: TagHistoryPoint = {
  tagId: "water.level",
  value: -0,
  quality: "GOOD",
  sourceTimestamp: null,
  serverTimestamp: timestamp,
  sequence: 1,
  timestampMs: Date.parse(timestamp),
  numericValue: -0,
};
const input: TagHistoryPersistenceRequest = {
  projectId: scope.projectId,
  streamId: scope.streamId,
  batchSequence: Number.MAX_SAFE_INTEGER,
  formatVersion: 1,
  records: [sample, { ...sample, value: 1, numericValue: 1, sequence: 2 }],
};

describe("Prisma 8 历史归档候选校验", () => {
  it("复制完整作用域与原始顺序并保留负零和安全整数边界", () => {
    const mutable = { ...sample };
    const prepared = preparePrisma8HistoryBatch(scope, { ...input, records: [mutable] });
    mutable.value = 0;
    expect(prepared.key).toEqual({ ...scope, batchSequence: 9007199254740991n });
    expect(prepared.records[0]?.payload).toContain('"valueJson":"-0"');
    expect(Object.isFrozen(prepared.key)).toBe(true);
    expect(Object.isFrozen(prepared.records)).toBe(true);
    expect(Object.isFrozen(prepared.records[0])).toBe(true);
  });

  it("拒绝非法作用域、错配工程及采集流和无效序号", () => {
    expect(() => preparePrisma8HistoryBatch({ ...scope, tenantId: "../other" }, input)).toThrow(
      "历史归档作用域标识无效",
    );
    for (const invalid of [
      { ...input, projectId: "other" },
      { ...input, streamId: "other" },
      { ...input, batchSequence: 0 },
      { ...input, batchSequence: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(() => preparePrisma8HistoryBatch(scope, invalid)).toThrow(
        "历史归档请求与绑定作用域不匹配",
      );
    }
  });

  it("拒绝空批次、超量与伪造派生字段并接受恰好二百五十六点", () => {
    expect(() => preparePrisma8HistoryBatch(scope, { ...input, records: [] })).toThrow(
      "历史持久化批次记录数无效",
    );
    const records = Array.from({ length: 256 }, () => sample);
    const prepared = preparePrisma8HistoryBatch(scope, { ...input, records });
    expect(prepared.records).toHaveLength(256);
    expect(prepared.records[255]?.ordinal).toBe(255);
    expect(() => preparePrisma8HistoryBatch(scope, { ...input, records: [...records, sample] })).toThrow(
      "历史持久化批次记录数无效",
    );
    expect(() => preparePrisma8HistoryBatch(scope, {
      ...input,
      records: [{ ...sample, numericValue: 0 }],
    })).toThrow("历史记录派生字段不匹配");
  });

  it("仅允许完整一致的批次元数据和记录", () => {
    const prepared = preparePrisma8HistoryBatch(scope, input);
    const batch = { ...prepared.key, formatVersion: 1, recordCount: 2 };
    expect(assertPrisma8HistoryBatch(prepared, batch, prepared.records)).toBeUndefined();
    for (const invalid of [
      null,
      { ...batch, tenantId: "other" },
      { ...batch, projectId: "other" },
      { ...batch, streamId: "other" },
      { ...batch, batchSequence: 1n },
      { ...batch, formatVersion: 2 },
      { ...batch, recordCount: 1 },
    ]) {
      expect(() => assertPrisma8HistoryBatch(prepared, invalid, prepared.records)).toThrow(
        "历史归档幂等键内容冲突",
      );
    }
  });

  it("拒绝部分记录、额外记录、逆序及规范内容和索引不一致", () => {
    const prepared = preparePrisma8HistoryBatch(scope, input);
    const batch = { ...prepared.key, formatVersion: 1, recordCount: 2 };
    const [first, second] = prepared.records;
    for (const invalid of [
      [first!],
      [...prepared.records, first!],
      [second!, first!],
      [{ ...first!, tenantId: "other" }, second!],
      [{ ...first!, ordinal: 1 }, second!],
      [{ ...first!, tagId: "other.tag" }, second!],
      [{ ...first!, timestampMs: first!.timestampMs + 1n }, second!],
      [{ ...first!, payload: first!.payload.replace('"-0"', '"0"') }, second!],
    ]) {
      expect(() => assertPrisma8HistoryBatch(prepared, batch, invalid)).toThrow(
        "历史归档幂等键内容冲突",
      );
    }
  });
});
