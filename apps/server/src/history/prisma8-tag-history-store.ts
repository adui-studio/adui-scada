import type {
  TagHistoryPersistencePort,
  TagHistoryPersistenceReceipt,
  TagHistoryPersistenceRequest,
} from "@adui/scada-core";
import type { Prisma8Transaction } from "../database/prisma8-read-transaction.js";
import type { Prisma8Service } from "../database/prisma8.service.js";
import { encodeHistoryPoint, normalizeHistoryPoints } from "./tag-history-record-codec.js";

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export interface Prisma8HistoryWriterScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly streamId: string;
}

interface BatchKey extends Prisma8HistoryWriterScope {
  readonly batchSequence: bigint;
}

interface StoredRecord extends BatchKey {
  readonly ordinal: number;
  readonly tagId: string;
  readonly timestampMs: bigint;
  readonly payload: string;
}

interface StoredBatch extends BatchKey {
  readonly formatVersion: number;
  readonly recordCount: number;
}

interface PreparedBatch {
  readonly key: BatchKey;
  readonly records: readonly StoredRecord[];
}

function checkedScope(scope: Prisma8HistoryWriterScope): Prisma8HistoryWriterScope {
  const { tenantId, projectId, streamId } = scope;
  if (
    ![tenantId, projectId, streamId].every((id) => typeof id === "string" && ID_PATTERN.test(id))
  ) {
    throw new TypeError("历史归档作用域标识无效");
  }
  return Object.freeze({ tenantId, projectId, streamId });
}

/** 事务前校验完整输入，复制作用域与规范编码，不保留调用方可变记录。 */
export function preparePrisma8HistoryBatch(
  scope: Prisma8HistoryWriterScope,
  request: TagHistoryPersistenceRequest,
): PreparedBatch {
  const bound = checkedScope(scope);
  const { batchSequence, projectId, streamId, formatVersion, records } = request;
  if (
    projectId !== bound.projectId ||
    streamId !== bound.streamId ||
    formatVersion !== 1 ||
    !Number.isSafeInteger(batchSequence) ||
    batchSequence <= 0
  ) {
    throw new TypeError("历史归档请求与绑定作用域不匹配");
  }
  const key = Object.freeze({ ...bound, batchSequence: BigInt(batchSequence) });
  const encoded = normalizeHistoryPoints(records).map((point, ordinal) =>
    Object.freeze({
      ...key,
      ordinal,
      tagId: point.tagId,
      timestampMs: BigInt(point.timestampMs),
      payload: encodeHistoryPoint(point),
    }),
  );
  return Object.freeze({ key, records: Object.freeze(encoded) });
}

function matchesKey(row: BatchKey, key: BatchKey): boolean {
  return (
    row.tenantId === key.tenantId &&
    row.projectId === key.projectId &&
    row.streamId === key.streamId &&
    row.batchSequence === key.batchSequence
  );
}

/** 相同幂等键必须匹配完整有序内容，首次写入也复核实际记录。 */
export function assertPrisma8HistoryBatch(
  prepared: PreparedBatch,
  batch: StoredBatch | null | undefined,
  stored: readonly StoredRecord[],
): void {
  const { key, records } = prepared;
  if (
    !batch ||
    !matchesKey(batch, key) ||
    batch.formatVersion !== 1 ||
    batch.recordCount !== records.length ||
    stored.length !== records.length ||
    !stored.every((row, index) => {
      const expected = records[index]!;
      return (
        matchesKey(row, key) &&
        row.ordinal === expected.ordinal &&
        row.tagId === expected.tagId &&
        row.timestampMs === expected.timestampMs &&
        row.payload === expected.payload
      );
    })
  ) {
    throw new Error("历史归档幂等键内容冲突");
  }
}

/** 内部事务仅由已校验的原生提供方执行，提交前不交付回执。 */
async function writePrisma8HistoryBatchInTransaction(
  tx: Prisma8Transaction,
  prepared: PreparedBatch,
): Promise<TagHistoryPersistenceReceipt["status"]> {
  const { key, records } = prepared;
  // 显式冲突目标由复合主键裁决；禁止以更新方式抢占已提交批次。
  const claim = await tx.execute(
    tx.raw.sql`INSERT INTO public.scada_tag_history_batches
                 (tenant_id, project_id, stream_id, batch_sequence, format_version, record_count)
               VALUES (${key.tenantId}, ${key.projectId}, ${key.streamId}, ${key.batchSequence},
                       1, ${records.length})
               ON CONFLICT (tenant_id, project_id, stream_id, batch_sequence) DO NOTHING`
      .affectedCount()
      .build(),
  );
  if (claim.affectedRows === 1) {
    const inserted = await tx.execute(
      tx.sql.public.scada_tag_history_records
        .insert(
          records.map((row) => ({
            tenant_id: row.tenantId,
            project_id: row.projectId,
            stream_id: row.streamId,
            batch_sequence: row.batchSequence,
            ordinal: row.ordinal,
            tag_id: row.tagId,
            timestamp_ms: row.timestampMs,
            payload: row.payload,
          })),
        )
        .build(),
    );
    if (inserted.affectedRows !== records.length) {
      throw new Error("历史归档记录写入数量不完整");
    }
  } else if (claim.affectedRows !== 0) {
    throw new Error("历史归档批次写入数量异常");
  }
  const batch = await tx.orm.public.ScadaTagHistoryBatch.where(key)
    .select("tenantId", "projectId", "streamId", "batchSequence", "formatVersion", "recordCount")
    .first();
  const stored = await tx.orm.public.ScadaTagHistoryRecord.where(key)
    .orderBy((row) => row.ordinal.asc())
    .limit(records.length + 1)
    .select(
      "tenantId",
      "projectId",
      "streamId",
      "batchSequence",
      "ordinal",
      "tagId",
      "timestampMs",
      "payload",
    )
    .all();
  assertPrisma8HistoryBatch(prepared, batch, stored);
  return claim.affectedRows === 1 ? "COMMITTED" : "ALREADY_COMMITTED";
}

/** 原生历史归档适配器，由可信采集作用域构造，不开放 HTTP 或设备写入。 */
export class Prisma8TagHistoryStore implements TagHistoryPersistencePort {
  private readonly scope: Prisma8HistoryWriterScope;

  constructor(
    private readonly database: Prisma8Service,
    scope: Prisma8HistoryWriterScope,
  ) {
    this.scope = checkedScope(scope);
  }

  async persist(request: TagHistoryPersistenceRequest): Promise<TagHistoryPersistenceReceipt> {
    const prepared = preparePrisma8HistoryBatch(this.scope, request);
    const status = await this.database.writeTransaction((tx) =>
      writePrisma8HistoryBatchInTransaction(tx, prepared),
    );
    // 事务成功返回前绝不交付回执；失败及未知结果不自动重试。
    return {
      projectId: prepared.key.projectId,
      streamId: prepared.key.streamId,
      batchSequence: Number(prepared.key.batchSequence),
      formatVersion: 1,
      recordCount: prepared.records.length,
      status,
    };
  }
}
