import { classifyOrderedNumericAlarmSample } from "./alarm-tag-sequence.ts";
import type { OrderedNumericAlarmSample } from "./alarm-tag-sequence.ts";
import type { TagValue } from "./tag-store.ts";

/** 会话代次由可信订阅管理方分配，不是身份凭证或跨进程全局序号。 */
export interface AlarmSessionGenerations {
  readonly activeGeneration: number;
  readonly inputGeneration: number;
  readonly baselineGeneration: number;
}

/** 复用已有数值候选结果，增加会话代次不匹配的拒绝状态。 */
export type SessionBoundNumericAlarmSample =
  | OrderedNumericAlarmSample
  | { readonly status: "SESSION_MISMATCH" };

/**
 * 仅允许活跃订阅会话中的当前读数与同代次基线继续做原有序列检查。
 * 代次须由可信上游独立提供；本函数不验证上游身份、创建设备订阅或报警事件。
 */
export function classifySessionBoundNumericAlarmSample(
  input: TagValue,
  previous: TagValue | null,
  generations: AlarmSessionGenerations,
  nowMs: number,
  maxAgeMs: number,
): SessionBoundNumericAlarmSample {
  const { activeGeneration, inputGeneration, baselineGeneration } = generations;
  if (
    !Number.isSafeInteger(activeGeneration) ||
    activeGeneration < 0 ||
    !Number.isSafeInteger(inputGeneration) ||
    inputGeneration < 0 ||
    !Number.isSafeInteger(baselineGeneration) ||
    baselineGeneration < 0
  ) {
    throw new TypeError("报警订阅会话代次无效");
  }
  if (
    inputGeneration !== activeGeneration ||
    baselineGeneration !== activeGeneration
  ) {
    return { status: "SESSION_MISMATCH" };
  }
  return classifyOrderedNumericAlarmSample(input, previous, nowMs, maxAgeMs);
}
