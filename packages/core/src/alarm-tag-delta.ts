import { classifyTimelyNumericAlarmSample } from "./alarm-tag-freshness.ts";
import { classifySessionBoundNumericAlarmSample } from "./alarm-session-generation.ts";
import type { SessionBoundNumericAlarmSample } from "./alarm-session-generation.ts";
import type { AlarmSnapshotBaseline } from "./alarm-snapshot-baseline.ts";
import { validateTagValue } from "./tag-store.ts";
import type { TagChange, TagValue } from "./tag-store.ts";

/** 上游须独立验证来源并维护同一订阅会话的代次与初始快照。 */
export interface AlarmTagDeltaRequest {
  readonly change: TagChange;
  readonly expectedTagId: string;
  readonly baseline: AlarmSnapshotBaseline | null;
  readonly activeGeneration: number;
  readonly deltaGeneration: number;
  readonly sourceVerified: boolean;
}

export type AlarmTagDeltaRejectReason =
  | "UNVERIFIED_SOURCE"
  | "DELTA_REQUIRED"
  | Exclude<SessionBoundNumericAlarmSample["status"], "READY">;

/** 拒绝时不能沿用旧基线；无目标 Tag 的有效增量不产生新报警候选。 */
export type AlarmTagDeltaResult =
  | {
      readonly status: "DELTA_ACCEPTED";
      readonly value: number;
      readonly baseline: AlarmSnapshotBaseline;
    }
  | { readonly status: "TAG_NOT_UPDATED" }
  | {
      readonly status: "DELTA_REJECTED";
      readonly reason: AlarmTagDeltaRejectReason;
    };

/**
 * 从同代次、上游已核验的 delta 中提取可用数值，返回新的只读序列基线。
 * 除目标 Tag 未更新外，所有拒绝及校验异常都要求调用方废弃旧基线、重新获取快照。
 * 本函数无副作用，不负责来源认证、订阅重连、报警判断或事件持久化。
 */
export function advanceAlarmTagDeltaBaseline(
  request: AlarmTagDeltaRequest,
  nowMs: number,
  maxAgeMs: number,
): AlarmTagDeltaResult {
  if (
    !Number.isSafeInteger(request.activeGeneration) ||
    request.activeGeneration < 0 ||
    !Number.isSafeInteger(request.deltaGeneration) ||
    request.deltaGeneration < 0
  ) {
    throw new TypeError("报警增量会话代次无效");
  }
  if (request.sourceVerified !== true) {
    return { status: "DELTA_REJECTED", reason: "UNVERIFIED_SOURCE" };
  }
  if (request.change.kind !== "delta") {
    return { status: "DELTA_REJECTED", reason: "DELTA_REQUIRED" };
  }
  if (request.baseline === null) {
    return { status: "DELTA_REJECTED", reason: "BASELINE_REQUIRED" };
  }
  if (
    request.deltaGeneration !== request.activeGeneration ||
    request.baseline.generation !== request.activeGeneration
  ) {
    return { status: "DELTA_REJECTED", reason: "SESSION_MISMATCH" };
  }

  const previous = validateTagValue(request.baseline.value);
  if (previous.tagId !== request.expectedTagId) {
    return { status: "DELTA_REJECTED", reason: "TAG_MISMATCH" };
  }
  // 底层入口也必须重新确认旧基线仍有效，不能只验证本次增量。
  const baselineCheck = classifyTimelyNumericAlarmSample(previous, nowMs, maxAgeMs);
  if (baselineCheck.status !== "READY") {
    return { status: "DELTA_REJECTED", reason: baselineCheck.status };
  }

  const seen = new Set<string>();
  let selected: TagValue | null = null;
  for (const entry of request.change.values) {
    const checked = validateTagValue(entry);
    if (seen.has(checked.tagId)) {
      throw new TypeError("报警增量中存在重复的 Tag ID");
    }
    seen.add(checked.tagId);
    if (checked.tagId === request.expectedTagId) selected = checked;
  }
  if (selected === null) return { status: "TAG_NOT_UPDATED" };

  const result = classifySessionBoundNumericAlarmSample(
    selected,
    previous,
    {
      activeGeneration: request.activeGeneration,
      inputGeneration: request.deltaGeneration,
      baselineGeneration: request.baseline.generation,
    },
    nowMs,
    maxAgeMs,
  );
  if (result.status !== "READY") {
    return { status: "DELTA_REJECTED", reason: result.status };
  }
  return {
    status: "DELTA_ACCEPTED",
    value: result.value,
    baseline: Object.freeze({
      generation: request.activeGeneration,
      value: Object.freeze({ ...selected }),
    }),
  };
}
