import { validateTagValue } from "./tag-store.ts";
import type { TagValue } from "./tag-store.ts";

/** 单个已隔离工程内的历史查询，时间范围为左闭右开。 */
export interface TagHistoryQuery {
  readonly tagId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly maxPoints: number;
}

/** 保留原始记录；仅 GOOD 有限数值可用于数值趋势。 */
export type TagHistoryPoint = Readonly<TagValue> & {
  readonly timestampMs: number;
  readonly numericValue: number | null;
};

const TAG_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const UTC_MILLISECOND_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_DATE_MS = 8_640_000_000_000_000;

/** 将记录复制为仅含历史契约字段的独立点。 */
function toTagHistoryPoint(input: TagValue): TagHistoryPoint {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("历史记录必须为对象");
  }
  if (typeof input.tagId !== "string") throw new TypeError("Tag ID 无效");
  const sample = validateTagValue(input);
  const timestampMs = Date.parse(sample.serverTimestamp);
  if (
    !UTC_MILLISECOND_PATTERN.test(sample.serverTimestamp) ||
    new Date(timestampMs).toISOString() !== sample.serverTimestamp
  ) {
    throw new TypeError("历史记录服务器时间必须为规范 UTC 毫秒时间");
  }
  return {
    tagId: sample.tagId,
    value: sample.value,
    quality: sample.quality,
    sourceTimestamp: sample.sourceTimestamp,
    serverTimestamp: sample.serverTimestamp,
    sequence: sample.sequence,
    timestampMs,
    numericValue:
      sample.quality === "GOOD" && typeof sample.value === "number" ? sample.value : null,
  };
}

/**
 * 从调用方已隔离的内存记录中选择一个 Tag 的历史点。
 * 不采集、不持久化、不推断数据连续性，不按实时序列去重。
 * 时间轴使用服务端时间，源时间仅原样保留；坏质量与非数值点保留为空绘图值。
 */
export function selectTagHistory(
  samples: readonly TagValue[],
  query: TagHistoryQuery,
): readonly TagHistoryPoint[] {
  if (typeof query.tagId !== "string" || !TAG_ID_PATTERN.test(query.tagId)) {
    throw new TypeError("历史查询 Tag ID 无效");
  }
  if (
    !Number.isSafeInteger(query.startMs) ||
    !Number.isSafeInteger(query.endMs) ||
    query.startMs < -MAX_DATE_MS ||
    query.endMs > MAX_DATE_MS ||
    query.startMs >= query.endMs
  ) {
    throw new RangeError("历史查询时间范围无效");
  }
  if (!Number.isSafeInteger(query.maxPoints) || query.maxPoints <= 0) {
    throw new RangeError("历史查询点数上限无效");
  }

  const points: TagHistoryPoint[] = [];
  for (const input of samples) {
    if (input.tagId !== query.tagId) continue;
    const point = toTagHistoryPoint(input);
    if (point.timestampMs < query.startMs || point.timestampMs >= query.endMs) continue;
    if (points.length >= query.maxPoints) {
      throw new RangeError("历史查询结果超过点数上限，请缩小时间范围");
    }
    points.push(point);
  }

  // 同毫秒的记录保持输入顺序；序列号不代表跨会话的全局历史顺序。
  return points.sort((left, right) => left.timestampMs - right.timestampMs);
}

/** 本地候选缓冲区的总记录数上限，不是生产归档容量承诺。 */
export const MAX_TAG_HISTORY_BUFFER_SAMPLES = 10_000;

/** 调用方显式标记来源；此标记不构成真实采集身份认证。 */
export interface TagHistoryBatch {
  readonly kind: "sample" | "runtime-quality";
  readonly values: readonly TagValue[];
}

/**
 * 单个已隔离工程的本地有界缓冲区，不自动订阅 TagStore。
 * 满容量、无效批次和超出保留边界的采样均整批拒绝，不覆盖已有记录。
 * 清理必须由调用方显式执行，不能把清理或内存数据视为归档成功。
 */
export class TagHistoryBuffer {
  private records: TagHistoryPoint[] = [];
  private retentionStartMs: number | undefined;
  private readonly capacity: number;

  constructor(capacity: number) {
    if (
      !Number.isSafeInteger(capacity) ||
      capacity <= 0 ||
      capacity > MAX_TAG_HISTORY_BUFFER_SAMPLES
    ) {
      throw new RangeError("历史缓冲区容量无效");
    }
    this.capacity = capacity;
  }

  get size(): number {
    return this.records.length;
  }

  /** 仅记录显式采样批次，先校验完整批次再写入。 */
  append(batch: TagHistoryBatch): void {
    if (batch.kind !== "sample") {
      throw new TypeError("历史缓冲区不接受运行时派生质量或未知批次");
    }
    if (!Array.isArray(batch.values)) {
      throw new TypeError("历史采样批次必须为数组");
    }
    if (batch.values.length > this.capacity - this.records.length) {
      throw new RangeError("历史缓冲区容量不足，未写入本批数据");
    }
    const values: readonly TagValue[] = batch.values;
    const checked: TagHistoryPoint[] = [];
    // 逐项遍历，避免稀疏数组的 map 跳过空位而破坏批次原子性。
    for (const input of values) {
      // 源时间原样保留，但限制内存候选的单条记录文本大小。
      if (typeof input?.sourceTimestamp === "string" && input.sourceTimestamp.length > 128) {
        throw new RangeError("历史记录源时间文本过长");
      }
      const point = toTagHistoryPoint(input);
      if (this.retentionStartMs !== undefined && point.timestampMs < this.retentionStartMs) {
        throw new RangeError("历史记录早于保留边界");
      }
      checked.push(point);
    }
    for (const point of checked) this.records.push(point);
  }

  /** 复用共享查询，返回独立结果，不暴露内部记录。 */
  query(query: TagHistoryQuery): readonly TagHistoryPoint[] {
    return selectTagHistory(this.records, query);
  }

  /** 移除严格早于边界的记录，并禁止迟到记录重新填入已清理区间。 */
  pruneBefore(cutoffMs: number): number {
    if (
      !Number.isSafeInteger(cutoffMs) ||
      Math.abs(cutoffMs) > MAX_DATE_MS ||
      (this.retentionStartMs !== undefined && cutoffMs < this.retentionStartMs)
    ) {
      throw new RangeError("历史缓冲区保留边界无效或倒退");
    }
    const previousSize = this.records.length;
    this.records = this.records.filter((point) => point.timestampMs >= cutoffMs);
    this.retentionStartMs = cutoffMs;
    return previousSize - this.records.length;
  }
}
