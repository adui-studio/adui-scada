import { TagHistoryBuffer } from "@adui/scada-core";
import type { TagHistoryPoint, TagValue } from "@adui/scada-core";

/** 持久化端口单批上限；调用方必须在准备不可变批次前选择此上限。 */
export const MAX_PERSISTED_HISTORY_BATCH_RECORDS = 256;

/** 复用核心历史校验并返回独立记录，禁止直接信任派生字段。 */
export function normalizeHistoryPoints(
  records: readonly TagHistoryPoint[],
): readonly TagHistoryPoint[] {
  if (
    !Array.isArray(records) ||
    records.length === 0 ||
    records.length > MAX_PERSISTED_HISTORY_BATCH_RECORDS
  ) {
    throw new RangeError("历史持久化批次记录数无效");
  }
  const buffer = new TagHistoryBuffer(MAX_PERSISTED_HISTORY_BATCH_RECORDS);
  buffer.append({ kind: "sample", values: records });
  const normalized = buffer.prepareArchive(records.length);
  if (!normalized) throw new Error("历史持久化批次为空");
  for (let index = 0; index < normalized.records.length; index += 1) {
    const input = records[index]!;
    const point = normalized.records[index]!;
    if (
      !Object.is(input.timestampMs, point.timestampMs) ||
      !Object.is(input.numericValue, point.numericValue)
    ) {
      throw new TypeError("历史记录派生字段不匹配");
    }
  }
  return normalized.records;
}

/** 固定字段顺序；原始标量单独编码，以免 JSON 序列化丢失数值负零。 */
export function encodeHistoryPoint(point: TagHistoryPoint): string {
  return JSON.stringify({
    tagId: point.tagId,
    valueJson: Object.is(point.value, -0) ? "-0" : JSON.stringify(point.value),
    quality: point.quality,
    sourceTimestamp: point.sourceTimestamp,
    serverTimestamp: point.serverTimestamp,
    sequence: point.sequence,
  });
}

/** 读取时重新校验原始内容、规范编码及用于索引的冗余字段。 */
export function decodeHistoryPoint(row: {
  readonly tagId: string;
  readonly timestampMs: bigint;
  readonly payload: string;
}): TagHistoryPoint {
  try {
    const encoded = JSON.parse(row.payload) as Omit<TagValue, "value"> & {
      valueJson: string;
    };
    if (typeof encoded.valueJson !== "string") {
      throw new TypeError("历史标量编码无效");
    }
    const sample: TagValue = {
      tagId: encoded.tagId,
      value: JSON.parse(encoded.valueJson) as TagValue["value"],
      quality: encoded.quality,
      sourceTimestamp: encoded.sourceTimestamp,
      serverTimestamp: encoded.serverTimestamp,
      sequence: encoded.sequence,
    };
    const buffer = new TagHistoryBuffer(1);
    buffer.append({ kind: "sample", values: [sample] });
    const point = buffer.prepareArchive(1)?.records[0];
    if (
      !point ||
      point.tagId !== row.tagId ||
      BigInt(point.timestampMs) !== row.timestampMs ||
      encodeHistoryPoint(point) !== row.payload
    ) {
      throw new TypeError("历史记录内容或索引字段不一致");
    }
    return point;
  } catch {
    throw new TypeError("历史持久化记录损坏或编码无效");
  }
}
