import { classifyTimelyNumericAlarmSample } from "./alarm-tag-freshness.ts";
import type { TimelyNumericAlarmSample } from "./alarm-tag-freshness.ts";
import { validateTagValue } from "./tag-store.ts";
import type { TagValue } from "./tag-store.ts";

/** 仅用于同一订阅会话内的数值报警候选过滤，不证明上游数据源可信。 */
export type OrderedNumericAlarmSample =
  | TimelyNumericAlarmSample
  | {
      readonly status:
        | "BASELINE_REQUIRED"
        | "TAG_MISMATCH"
        | "SEQUENCE_NOT_ADVANCED"
        | "SERVER_TIMESTAMP_REGRESSED";
    };

/**
 * 要求调用方提供同一可信会话中上一条已接受的 Tag 读数。
 * 没有基线、Tag 不一致、旧基线失效、序列号未前进或服务器时间回退时不暴露数值，也不产生报警事件。
 * 跨会话代次、服务端来源与初始快照可信性必须由上游独立校验。
 */
export function classifyOrderedNumericAlarmSample(
  input: TagValue,
  previous: TagValue | null,
  nowMs: number,
  maxAgeMs: number,
): OrderedNumericAlarmSample {
  const current = classifyTimelyNumericAlarmSample(input, nowMs, maxAgeMs);
  if (current.status !== "READY") return current;
  if (previous === null) return { status: "BASELINE_REQUIRED" };

  const baseline = validateTagValue(previous);
  if (baseline.tagId !== input.tagId) return { status: "TAG_MISMATCH" };
  // 直接调用底层序列校验时，也必须复核所依赖的旧基线是否仍然有效。
  const baselineCheck = classifyTimelyNumericAlarmSample(baseline, nowMs, maxAgeMs);
  if (baselineCheck.status !== "READY") return baselineCheck;
  if (input.sequence <= baseline.sequence) return { status: "SEQUENCE_NOT_ADVANCED" };
  // 同代次序列递增也不能接受较旧的服务端时间；相同毫秒时间允许。
  if (Date.parse(input.serverTimestamp) < Date.parse(baseline.serverTimestamp)) {
    return { status: "SERVER_TIMESTAMP_REGRESSED" };
  }
  return current;
}
