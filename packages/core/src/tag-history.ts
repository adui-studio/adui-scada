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
    const sample = validateTagValue(input);
    const timestampMs = Date.parse(sample.serverTimestamp);
    if (
      !UTC_MILLISECOND_PATTERN.test(sample.serverTimestamp) ||
      new Date(timestampMs).toISOString() !== sample.serverTimestamp
    ) {
      throw new TypeError("历史记录服务器时间必须为规范 UTC 毫秒时间");
    }
    if (timestampMs < query.startMs || timestampMs >= query.endMs) continue;
    if (points.length >= query.maxPoints) {
      throw new RangeError("历史查询结果超过点数上限，请缩小时间范围");
    }
    points.push({
      tagId: sample.tagId,
      value: sample.value,
      quality: sample.quality,
      sourceTimestamp: sample.sourceTimestamp,
      serverTimestamp: sample.serverTimestamp,
      sequence: sample.sequence,
      timestampMs,
      numericValue:
        sample.quality === "GOOD" && typeof sample.value === "number" ? sample.value : null,
    });
  }

  // 同毫秒的记录保持输入顺序；序列号不代表跨会话的全局历史顺序。
  return points.sort((left, right) => left.timestampMs - right.timestampMs);
}
