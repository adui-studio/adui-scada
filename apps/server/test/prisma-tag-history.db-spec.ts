import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { TagHistoryBuffer } from "@adui/scada-core";
import type { TagHistoryPersistenceRequest, TagValue } from "@adui/scada-core";
import { PrismaService } from "../src/database/prisma.service.js";
import {
  PrismaTagHistoryStore,
  readPersistedTagHistory,
} from "../src/history/prisma-tag-history-store.js";

// 严格限制到本机独立测试库，不连接开发库或生产数据库。
const testUrl = process.env.SCADA_TEST_DATABASE_URL;
if (!testUrl) throw new Error("历史归档数据库测试需显式设置 SCADA_TEST_DATABASE_URL");
let parsedUrl: URL;
try {
  parsedUrl = new URL(testUrl);
} catch {
  throw new Error("历史归档数据库连接字符串格式无效");
}
if (
  !["127.0.0.1", "localhost"].includes(parsedUrl.hostname) ||
  parsedUrl.pathname !== "/adui_scada_test" ||
  !["postgresql:", "postgres:"].includes(parsedUrl.protocol)
) {
  throw new Error("历史归档数据库测试仅允许本机 adui_scada_test 隔离数据库");
}

const tenantA = "test-" + randomUUID();
const tenantB = "test-" + randomUUID();
const projectId = "history-demo";
const otherProjectId = "history-other";
const streamId = "test-stream";
const scope = { tenantId: tenantA, projectId };
const timestamp = "2026-11-24T00:00:00.000Z";
const time = Date.parse(timestamp);
const query = { tagId: "water.level", startMs: time, endMs: time + 1, maxPoints: 100 };
let service: PrismaService;
const originalUrl = process.env.SCADA_DATABASE_URL;

beforeAll(async () => {
  process.env.SCADA_DATABASE_URL = testUrl;
  service = new PrismaService();
  await service.onModuleInit();
  await service.client.scadaProject.createMany({
    data: [
      { tenantId: tenantA, projectId },
      { tenantId: tenantB, projectId },
      { tenantId: tenantA, projectId: otherProjectId },
    ],
  });
});

afterAll(async () => {
  try {
    if (service) {
      const where = { tenantId: { in: [tenantA, tenantB] } };
      // 按复合外键的依赖顺序清理，仅操作本次随机测试租户。
      await service.client.scadaTagHistoryRecord.deleteMany({ where });
      await service.client.scadaTagHistoryBatch.deleteMany({ where });
      await service.client.scadaProject.deleteMany({ where });
    }
  } finally {
    try {
      if (service) await service.onModuleDestroy();
    } finally {
      if (originalUrl === undefined) {
        delete process.env.SCADA_DATABASE_URL;
      } else {
        process.env.SCADA_DATABASE_URL = originalUrl;
      }
    }
  }
});

function request(
  batchSequence: number,
  values: readonly TagValue["value"][],
  stream = streamId,
  project = projectId,
): TagHistoryPersistenceRequest {
  const buffer = new TagHistoryBuffer(values.length);
  buffer.append({
    kind: "sample",
    values: values.map((value, sequence) => ({
      tagId: query.tagId,
      value,
      quality: sequence === 0 ? "GOOD" : "BAD",
      sourceTimestamp: timestamp,
      serverTimestamp: timestamp,
      sequence,
    })),
  });
  return {
    projectId: project,
    streamId: stream,
    formatVersion: 1,
    batchSequence,
    records: buffer.prepareArchive(values.length)!.records,
  };
}

function writer(stream = streamId, tenantId = tenantA, project = projectId) {
  return new PrismaTagHistoryStore(service.client, {
    tenantId,
    projectId: project,
    streamId: stream,
  });
}

describe("真实 PostgreSQL 历史归档事务", () => {
  it("首次提交与重试返回明确回执且不重复记录", async () => {
    const input = request(1, [10, 20]);
    const store = writer();
    expect(await store.persist(input)).toEqual({
      projectId,
      streamId,
      formatVersion: 1,
      batchSequence: 1,
      recordCount: 2,
      status: "COMMITTED",
    });
    expect((await store.persist(input)).status).toBe("ALREADY_COMMITTED");
    const rows = await readPersistedTagHistory(service.client, scope, query);
    expect(rows).toEqual(input.records);
    expect(rows.map((row) => row.numericValue)).toEqual([10, null]);
    expect(await readPersistedTagHistory(service.client, scope, { ...query, endMs: time + 2 })).toEqual(
      input.records,
    );
    await expect(
      readPersistedTagHistory(service.client, scope, { ...query, maxPoints: 1 }),
    ).rejects.toThrow("历史查询结果超过点数上限");
    expect(
      await readPersistedTagHistory(service.client, scope, {
        ...query,
        startMs: time + 1,
        endMs: time + 2,
      }),
    ).toEqual([]);
  });

  it("相同幂等键的原始值或记录顺序冲突不能覆盖已提交数据", async () => {
    const input = request(2, [3, 4]);
    const store = writer();
    await store.persist(input);
    await expect(store.persist(request(2, [3, 5]))).rejects.toThrow("历史归档幂等键内容冲突");
    await expect(store.persist({ ...input, records: [...input.records].reverse() })).rejects.toThrow(
      "历史归档幂等键内容冲突",
    );
    expect((await store.persist(input)).status).toBe("ALREADY_COMMITTED");
  });

  it("并发相同批次只提交一次，竞争不同内容拒绝后到请求", async () => {
    const input = request(3, [33, 44]);
    const receipts = await Promise.all([writer().persist(input), writer().persist(input)]);
    expect(receipts.map((receipt) => receipt.status).sort()).toEqual([
      "ALREADY_COMMITTED",
      "COMMITTED",
    ]);
    const race = await Promise.allSettled([
      writer().persist(request(4, [50])),
      writer().persist(request(4, [60])),
    ]);
    expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(race.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      await service.client.scadaTagHistoryRecord.count({
        where: { ...scope, streamId, batchSequence: 4n },
      }),
    ).toBe(1);
  });

  it("租户与工程共同隔离相同写入流和批次键", async () => {
    const isolatedStream = "isolation";
    await writer(isolatedStream, tenantB).persist(request(1, [999], isolatedStream));
    await writer(isolatedStream, tenantA, otherProjectId).persist(
      request(1, [888], isolatedStream, otherProjectId),
    );
    await writer(isolatedStream).persist(request(1, [777], isolatedStream));
    const rows = await readPersistedTagHistory(service.client, scope, query);
    expect(rows.some((row) => row.value === 777)).toBe(true);
    expect(rows.some((row) => row.value === 999 || row.value === 888)).toBe(false);
    expect(
      await readPersistedTagHistory(service.client, { tenantId: tenantB, projectId }, query),
    ).toHaveLength(1);
    await expect(writer().persist(request(5, [1], streamId, otherProjectId))).rejects.toThrow(
      "历史归档请求与绑定作用域不匹配",
    );
  });

  it("不存在的工程及非法派生字段不产生归档批次", async () => {
    await expect(
      writer(streamId, tenantA, "missing-project").persist(request(1, [1], streamId, "missing-project")),
    ).rejects.toThrow(/foreign key|Foreign key|外键|constraint|约束/);
    const input = request(99, [8]);
    await expect(
      writer().persist({ ...input, records: [{ ...input.records[0]!, numericValue: 9 }] }),
    ).rejects.toThrow("历史记录派生字段不匹配");
    expect(
      await service.client.scadaTagHistoryBatch.count({
        where: { ...scope, streamId, batchSequence: 99n },
      }),
    ).toBe(0);
  });
});
