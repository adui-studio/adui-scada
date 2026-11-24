import { selectTagHistory } from "@adui/scada-core";
import type {
  TagHistoryPersistencePort,
  TagHistoryPersistenceReceipt,
  TagHistoryPersistenceRequest,
  TagHistoryPoint,
  TagHistoryQuery,
} from "@adui/scada-core";
import type { PrismaService } from "../database/prisma.service.js";
import {
  decodeHistoryPoint,
  encodeHistoryPoint,
  normalizeHistoryPoints,
} from "./tag-history-record-codec.js";

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MAX_QUERY_POINTS = 1_000;

interface HistoryProjectScope {
  readonly tenantId: string;
  readonly projectId: string;
}

interface HistoryWriterScope extends HistoryProjectScope {
  readonly streamId: string;
}

function requireHistoryId(value: string): void {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new TypeError("历史归档作用域标识无效");
  }
}

/**
 * 内部事务适配器，不注册 HTTP 路由或生产采集。
 * 仅由后续可信且已授权的服务端调用方绑定租户、工程和唯一写入流。
 */
export class PrismaTagHistoryStore implements TagHistoryPersistencePort {
  private readonly scope: HistoryWriterScope;

  constructor(
    private readonly client: PrismaService["client"],
    scope: HistoryWriterScope,
  ) {
    requireHistoryId(scope.tenantId);
    requireHistoryId(scope.projectId);
    requireHistoryId(scope.streamId);
    this.scope = Object.freeze({
      tenantId: scope.tenantId,
      projectId: scope.projectId,
      streamId: scope.streamId,
    });
  }

  async persist(request: TagHistoryPersistenceRequest): Promise<TagHistoryPersistenceReceipt> {
    if (
      request.projectId !== this.scope.projectId ||
      request.streamId !== this.scope.streamId ||
      request.formatVersion !== 1 ||
      !Number.isSafeInteger(request.batchSequence) ||
      request.batchSequence <= 0
    ) {
      throw new TypeError("历史归档请求与绑定作用域不匹配");
    }
    const batchSequence = request.batchSequence;
    const points = normalizeHistoryPoints(request.records);
    const key = { ...this.scope, batchSequence: BigInt(batchSequence) };
    const records = points.map((point, ordinal) => ({
      ...key,
      ordinal,
      tagId: point.tagId,
      timestampMs: BigInt(point.timestampMs),
      payload: encodeHistoryPoint(point),
    }));

    const status = await this.client.$transaction(
      async (transaction): Promise<TagHistoryPersistenceReceipt["status"]> => {
        // 复合主键竞争由数据库裁决；重复键不能跳过内容校验。
        const inserted = await transaction.scadaTagHistoryBatch.createMany({
          data: { ...key, formatVersion: 1, recordCount: records.length },
          skipDuplicates: true,
        });
        if (inserted.count === 1) {
          const result = await transaction.scadaTagHistoryRecord.createMany({ data: records });
          if (result.count !== records.length) {
            throw new Error("历史归档记录写入数量不完整");
          }
          return "COMMITTED";
        }
        if (inserted.count !== 0) throw new Error("历史归档批次写入数量异常");

        const existing = await transaction.scadaTagHistoryBatch.findUnique({
          where: { tenantId_projectId_streamId_batchSequence: key },
          select: { formatVersion: true, recordCount: true },
        });
        if (
          !existing ||
          existing.formatVersion !== 1 ||
          existing.recordCount !== records.length
        ) {
          throw new Error("历史归档幂等键内容冲突");
        }
        const stored = await transaction.scadaTagHistoryRecord.findMany({
          where: key,
          orderBy: { ordinal: "asc" },
          select: { ordinal: true, tagId: true, timestampMs: true, payload: true },
        });
        if (
          stored.length !== records.length ||
          !stored.every((row, index) => {
            const expected = records[index]!;
            return (
              row.ordinal === expected.ordinal &&
              row.tagId === expected.tagId &&
              row.timestampMs === expected.timestampMs &&
              row.payload === expected.payload
            );
          })
        ) {
          throw new Error("历史归档幂等键内容冲突");
        }
        return "ALREADY_COMMITTED";
      },
      { isolationLevel: "ReadCommitted", maxWait: 2000, timeout: 10000 },
    );

    // 只有整个事务成功返回才产生回执；不推断未知提交结果。
    return {
      projectId: this.scope.projectId,
      streamId: this.scope.streamId,
      batchSequence,
      formatVersion: 1,
      recordCount: records.length,
      status,
    };
  }
}

/**
 * 内部有界只读查询，必须由可信调用方完成工程历史读取授权。
 * 不开放 API；不把结果当作历史完整性或连续性的凭证。
 */
export async function readPersistedTagHistory(
  client: PrismaService["client"],
  scope: HistoryProjectScope,
  query: TagHistoryQuery,
): Promise<readonly TagHistoryPoint[]> {
  requireHistoryId(scope.tenantId);
  requireHistoryId(scope.projectId);
  const checkedQuery = { ...query };
  selectTagHistory([], checkedQuery);
  if (checkedQuery.maxPoints > MAX_QUERY_POINTS) {
    throw new RangeError("历史查询点数上限超过服务端限制");
  }
  const rows = await client.scadaTagHistoryRecord.findMany({
    where: {
      tenantId: scope.tenantId,
      projectId: scope.projectId,
      tagId: checkedQuery.tagId,
      timestampMs: { gte: BigInt(checkedQuery.startMs), lt: BigInt(checkedQuery.endMs) },
    },
    orderBy: [
      { timestampMs: "asc" },
      { streamId: "asc" },
      { batchSequence: "asc" },
      { ordinal: "asc" },
    ],
    take: checkedQuery.maxPoints + 1,
    select: { tagId: true, timestampMs: true, payload: true },
  });
  if (rows.length > checkedQuery.maxPoints) {
    throw new RangeError("历史查询结果超过点数上限，请缩小时间范围");
  }
  return rows.map((row) => decodeHistoryPoint(row));
}
