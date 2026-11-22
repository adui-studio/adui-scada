import { classifyNumericAlarmSample } from "./alarm-tag-quality.ts";
import type { NumericAlarmSample } from "./alarm-tag-quality.ts";
import type { TagValue } from "./tag-store.ts";

/** 有效数值仅是候选；时间窗口检查不能证明数据来源及采集时间可信。 */
export type TimelyNumericAlarmSample =
  | NumericAlarmSample
  | { readonly status: "FUTURE_TIMESTAMP" | "OUTDATED_TIMESTAMP" };

/**
 * 按调用方显式提供的时间和最大年龄检查 Tag 的服务端时间。
 * 先执行数值与质量筛选；不自动获取当前时间，不推断阈值或生成报警事件。
 * 调用方仍需校验数据来源、服务端时间可信性与订阅会话代次。
 */
export function classifyTimelyNumericAlarmSample(
  input: TagValue,
  nowMs: number,
  maxAgeMs: number,
): TimelyNumericAlarmSample {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new TypeError("当前时间参数无效");
  }
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) {
    throw new TypeError("最大数据年龄参数无效");
  }

  const candidate = classifyNumericAlarmSample(input);
  if (candidate.status !== "READY") return candidate;

  const sampleMs = Date.parse(input.serverTimestamp);
  if (sampleMs > nowMs) return { status: "FUTURE_TIMESTAMP" };
  if (nowMs - sampleMs > maxAgeMs) return { status: "OUTDATED_TIMESTAMP" };
  return candidate;
}
