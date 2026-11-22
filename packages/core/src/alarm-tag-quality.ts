import { validateTagValue } from "./tag-store.ts";
import type { TagValue } from "./tag-store.ts";

/** 数值报警规则的输入候选检查；不表示来源可信或报警条件已满足。 */
export type NumericAlarmSample =
  | { readonly status: "READY"; readonly value: number }
  | { readonly status: "QUALITY_NOT_GOOD" | "NOT_NUMERIC" };

/**
 * 仅筛选具备 GOOD 质量及有限数值的 Tag 候选。
 * 调用前仍须在服务端独立验证数据来源、会话时效和顺序；此函数不产生报警事件。
 */
export function classifyNumericAlarmSample(input: TagValue): NumericAlarmSample {
  const sample = validateTagValue(input);
  if (sample.quality !== "GOOD") return { status: "QUALITY_NOT_GOOD" };
  if (typeof sample.value !== "number") return { status: "NOT_NUMERIC" };
  return { status: "READY", value: sample.value };
}
