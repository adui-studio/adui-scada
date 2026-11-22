import { classifyTimelyNumericAlarmSample } from "./alarm-tag-freshness.ts";
import type { TimelyNumericAlarmSample } from "./alarm-tag-freshness.ts";
import { validateTagValue } from "./tag-store.ts";
import type { TagChange, TagValue } from "./tag-store.ts";

/** 快照核验标记和订阅代次只允许由受控上游提供，不是来源认证凭证。 */
export interface AlarmSnapshotBaselineRequest {
  readonly change: TagChange;
  readonly expectedTagId: string;
  readonly activeGeneration: number;
  readonly snapshotGeneration: number;
  readonly sourceVerified: boolean;
}

/** 仅作为后续同会话 delta 的序列基线，不表示报警已经触发。 */
export interface AlarmSnapshotBaseline {
  readonly generation: number;
  readonly value: Readonly<TagValue>;
}

export type AlarmSnapshotBaselineResult =
  | { readonly status: "BASELINE_ESTABLISHED"; readonly baseline: AlarmSnapshotBaseline }
  | {
      readonly status:
        | "UNVERIFIED_SOURCE"
        | "SNAPSHOT_REQUIRED"
        | "SESSION_MISMATCH"
        | "TAG_NOT_FOUND";
    }
  | { readonly status: Exclude<TimelyNumericAlarmSample["status"], "READY"> };

/**
 * 从上游明确核验的同代次 snapshot 中挑选数值 Tag，建立只读序列基线。
 * 整批校验在创建基线前完成；delta、旧会话和未核验来源均不能建立基线。
 * 本函数无法证明 sourceVerified 的真实性，也不会订阅设备或生成报警事件。
 */
export function establishAlarmSnapshotBaseline(
  request: AlarmSnapshotBaselineRequest,
  nowMs: number,
  maxAgeMs: number,
): AlarmSnapshotBaselineResult {
  if (
    !Number.isSafeInteger(request.activeGeneration) ||
    request.activeGeneration < 0 ||
    !Number.isSafeInteger(request.snapshotGeneration) ||
    request.snapshotGeneration < 0
  ) {
    throw new TypeError("报警快照会话代次无效");
  }
  if (request.sourceVerified !== true) return { status: "UNVERIFIED_SOURCE" };
  if (request.change.kind !== "snapshot") return { status: "SNAPSHOT_REQUIRED" };
  if (request.snapshotGeneration !== request.activeGeneration) {
    return { status: "SESSION_MISMATCH" };
  }

  const seen = new Set<string>();
  let selected: TagValue | null = null;
  for (const entry of request.change.values) {
    const checked = validateTagValue(entry);
    if (seen.has(checked.tagId)) {
      throw new TypeError("报警快照中存在重复的 Tag ID");
    }
    seen.add(checked.tagId);
    if (checked.tagId === request.expectedTagId) selected = checked;
  }
  if (selected === null) return { status: "TAG_NOT_FOUND" };

  const result = classifyTimelyNumericAlarmSample(selected, nowMs, maxAgeMs);
  if (result.status !== "READY") return { status: result.status };

  return {
    status: "BASELINE_ESTABLISHED",
    baseline: Object.freeze({
      generation: request.activeGeneration,
      value: Object.freeze({ ...selected }),
    }),
  };
}
