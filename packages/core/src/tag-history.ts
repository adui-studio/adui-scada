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

/** 采样候选与缓冲区共用单条记录的大小和字段校验。 */
function toBufferedHistoryPoint(input: TagValue): TagHistoryPoint {
  if (typeof input?.sourceTimestamp === "string" && input.sourceTimestamp.length > 128) {
    throw new RangeError("历史记录源时间文本过长");
  }
  return toTagHistoryPoint(input);
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

/** 单次待归档批次的不可变快照，仅以当前缓冲区内对象身份确认。 */
export interface TagHistoryArchiveBatch {
  readonly records: readonly TagHistoryPoint[];
}

/**
 * 单个已隔离工程的本地有界缓冲区，不自动订阅 TagStore。
 * 满容量、无效批次和超出保留边界的采样均整批拒绝，不覆盖已有记录。
 * 清理必须由调用方显式执行，不能把清理或内存数据视为归档成功。
 */
export class TagHistoryBuffer {
  private records: TagHistoryPoint[] = [];
  private retentionStartMs: number | undefined;
  private pendingArchive: TagHistoryArchiveBatch | undefined;
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
      const point = toBufferedHistoryPoint(input);
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

  /**
   * 按入缓冲顺序准备有限批次，未确认时始终保留原记录。
   * 重试返回同一不可变批次；调用方须独立保证持久化幂等性。
   */
  prepareArchive(maxRecords: number): TagHistoryArchiveBatch | undefined {
    if (
      !Number.isSafeInteger(maxRecords) ||
      maxRecords <= 0 ||
      maxRecords > MAX_TAG_HISTORY_BUFFER_SAMPLES
    ) {
      throw new RangeError("历史归档批次上限无效");
    }
    if (this.pendingArchive) {
      if (this.pendingArchive.records.length > maxRecords) {
        throw new RangeError("历史待归档批次不能缩小后重试");
      }
      return this.pendingArchive;
    }
    if (this.records.length === 0) return undefined;

    const records = Object.freeze(
      this.records.slice(0, maxRecords).map((point) => Object.freeze({ ...point })),
    );
    const batch = Object.freeze({ records });
    this.pendingArchive = batch;
    return batch;
  }

  /**
   * 仅在可信调用方确认整批持久化成功后调用。
   * 本地对象身份不是持久化凭证；只移除当前批次对应的记录前缀。
   */
  confirmArchive(batch: TagHistoryArchiveBatch): number {
    if (!this.pendingArchive || batch !== this.pendingArchive) {
      throw new TypeError("历史归档批次无效、已确认或不属于当前缓冲区");
    }
    const count = this.pendingArchive.records.length;
    this.records = this.records.slice(count);
    this.pendingArchive = undefined;
    return count;
  }

  /** 移除严格早于边界的记录，并禁止迟到记录重新填入已清理区间。 */
  pruneBefore(cutoffMs: number): number {
    if (this.pendingArchive) {
      throw new Error("存在待确认历史归档批次，不能清理缓冲区");
    }
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

/** 显式周期与可选绝对数值变化阈值，不包含生产采样参数默认值。 */
export interface TagHistorySamplingPolicy {
  readonly intervalMs: number;
  readonly numericDeadband?: number;
}

/** 单个采样输入，来源类别不能代替可信网关认证。 */
export interface TagHistorySampleInput {
  readonly kind: TagHistoryBatch["kind"];
  readonly value: TagValue;
}

export type TagHistorySamplingDecision =
  | "INITIAL"
  | "QUALITY_CHANGE"
  | "VALUE_AVAILABILITY_CHANGE"
  | "VALUE_CHANGE"
  | "PERIODIC"
  | "SKIPPED";

/**
 * 单 Tag 的本地历史采样策略，每次处理一个调用方明确提供的采样。
 * 不开启定时器、不自动订阅、不补造历史数据；实例须由调用方按工程和 Tag 隔离。
 * 基线以成功进入内存缓冲区的记录为准，不表示已经持久化。
 */
export class TagHistorySampler {
  private readonly intervalMs: number;
  private readonly numericDeadband: number | undefined;
  private lastRecorded: TagHistoryPoint | undefined;
  private lastSeenMs: number | undefined;

  constructor(
    private readonly buffer: TagHistoryBuffer,
    private readonly tagId: string,
    policy: TagHistorySamplingPolicy,
  ) {
    if (typeof tagId !== "string" || !TAG_ID_PATTERN.test(tagId)) {
      throw new TypeError("历史采样 Tag ID 无效");
    }
    if (!Number.isSafeInteger(policy.intervalMs) || policy.intervalMs <= 0) {
      throw new RangeError("历史采样周期无效");
    }
    if (
      policy.numericDeadband !== undefined &&
      (!Number.isFinite(policy.numericDeadband) || policy.numericDeadband <= 0)
    ) {
      throw new RangeError("历史采样数值变化阈值无效");
    }
    this.intervalMs = policy.intervalMs;
    this.numericDeadband = policy.numericDeadband;
  }

  /** 写入成功或明确跳过后才推进观测时间；写入失败不推进任何基线。 */
  record(input: TagHistorySampleInput): TagHistorySamplingDecision {
    if (input.kind !== "sample") {
      throw new TypeError("历史采样不接受运行时派生质量或未知来源类别");
    }
    const point = toBufferedHistoryPoint(input.value);
    if (point.tagId !== this.tagId) throw new TypeError("历史采样 Tag ID 不匹配");
    if (this.lastSeenMs !== undefined && point.timestampMs < this.lastSeenMs) {
      throw new RangeError("历史采样服务器时间倒退");
    }

    const previous = this.lastRecorded;
    let decision: TagHistorySamplingDecision = "SKIPPED";
    if (!previous) {
      decision = "INITIAL";
    } else if (point.quality !== previous.quality) {
      decision = "QUALITY_CHANGE";
    } else if ((point.numericValue === null) !== (previous.numericValue === null)) {
      decision = "VALUE_AVAILABILITY_CHANGE";
    } else if (
      this.numericDeadband !== undefined &&
      previous.numericValue !== null &&
      point.numericValue !== null &&
      Math.abs(point.numericValue - previous.numericValue) >= this.numericDeadband
    ) {
      decision = "VALUE_CHANGE";
    } else if (point.timestampMs - previous.timestampMs >= this.intervalMs) {
      decision = "PERIODIC";
    }

    if (decision !== "SKIPPED") {
      this.buffer.append({ kind: "sample", values: [point] });
      this.lastRecorded = point;
    }
    this.lastSeenMs = point.timestampMs;
    return decision;
  }
}
