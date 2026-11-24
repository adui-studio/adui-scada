import type { TagHistoryArchiveBatch, TagHistoryBuffer, TagHistoryPoint } from "./tag-history.ts";

/** 由可信调用方分配的工程及唯一写入流标识，不构成工程授权。 */
export interface TagHistoryArchiveScope {
  readonly projectId: string;
  readonly streamId: string;
}

/** 复合幂等键为 projectId、streamId、batchSequence，版本约束记录编码。 */
export interface TagHistoryPersistenceRequest extends TagHistoryArchiveScope {
  readonly formatVersion: 1;
  readonly batchSequence: number;
  readonly records: readonly TagHistoryPoint[];
}

export interface TagHistoryPersistenceReceipt extends TagHistoryArchiveScope {
  readonly formatVersion: 1;
  readonly batchSequence: number;
  readonly recordCount: number;
  readonly status: "COMMITTED" | "ALREADY_COMMITTED";
}

/**
 * 实现方必须原子提交整批记录及幂等键；重复键仅在完整有序内容一致时返回已提交。
 * 不同内容的重复键、部分写入、失败或结果未知均须拒绝，不得返回成功回执。
 */
export interface TagHistoryPersistencePort {
  persist(request: TagHistoryPersistenceRequest): Promise<TagHistoryPersistenceReceipt>;
}

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const claimedBuffers = new WeakSet<TagHistoryBuffer>();

function verifyReceipt(request: TagHistoryPersistenceRequest, receipt: unknown): void {
  if (receipt === null || typeof receipt !== "object") {
    throw new TypeError("历史持久化回执无效或不匹配");
  }
  const result = receipt as Partial<TagHistoryPersistenceReceipt>;
  if (
    result.formatVersion !== request.formatVersion ||
    result.projectId !== request.projectId ||
    result.streamId !== request.streamId ||
    result.batchSequence !== request.batchSequence ||
    result.recordCount !== request.records.length ||
    (result.status !== "COMMITTED" && result.status !== "ALREADY_COMMITTED")
  ) {
    throw new TypeError("历史持久化回执无效或不匹配");
  }
}

/**
 * 单缓冲区单写入者的内存协调器；写入流标识不得跨生命周期复用。
 * 调用方不得绕过本协调器直接确认或清理待持久化记录。
 * 不负责数据库事务、跨进程恢复、超时取消或自动重试。
 */
export class TagHistoryArchiveWriter {
  private readonly scope: TagHistoryArchiveScope;
  private nextSequence = 1;
  private writing = false;
  private pending:
    | { readonly batch: TagHistoryArchiveBatch; readonly request: TagHistoryPersistenceRequest }
    | undefined;

  constructor(
    private readonly buffer: TagHistoryBuffer,
    scope: TagHistoryArchiveScope,
    private readonly storage: TagHistoryPersistencePort,
  ) {
    if (
      typeof scope.projectId !== "string" ||
      !ID_PATTERN.test(scope.projectId) ||
      typeof scope.streamId !== "string" ||
      !ID_PATTERN.test(scope.streamId)
    ) {
      throw new TypeError("历史归档工程或写入流标识无效");
    }
    if (claimedBuffers.has(buffer)) throw new Error("历史缓冲区已绑定归档写入者");
    this.scope = Object.freeze({ projectId: scope.projectId, streamId: scope.streamId });
    claimedBuffers.add(buffer);
  }

  /** 成功返回确认记录数；失败保留待归档请求，重试不得生成新键。 */
  async flush(maxRecords: number): Promise<number> {
    if (this.writing) throw new Error("历史归档正在写入，不能并发提交");
    this.writing = true;
    try {
      if (!Number.isSafeInteger(this.nextSequence)) {
        throw new RangeError("历史归档批次序号已耗尽");
      }
      const batch = this.buffer.prepareArchive(maxRecords);
      if (this.pending && this.pending.batch !== batch) {
        throw new Error("历史待归档批次已被外部改变");
      }
      if (!batch) return 0;
      this.pending ??= {
        batch,
        request: Object.freeze({
          formatVersion: 1,
          ...this.scope,
          batchSequence: this.nextSequence,
          records: batch.records,
        }),
      };
      const pending = this.pending;
      const receipt = await this.storage.persist(pending.request);
      verifyReceipt(pending.request, receipt);
      const count = this.buffer.confirmArchive(pending.batch);
      this.pending = undefined;
      this.nextSequence += 1;
      return count;
    } finally {
      this.writing = false;
    }
  }
}
