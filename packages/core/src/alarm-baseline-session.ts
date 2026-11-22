import { classifyTimelyNumericAlarmSample } from "./alarm-tag-freshness.ts";
import { advanceAlarmTagDeltaBaseline } from "./alarm-tag-delta.ts";
import type { AlarmTagDeltaRejectReason } from "./alarm-tag-delta.ts";
import { establishAlarmSnapshotBaseline } from "./alarm-snapshot-baseline.ts";
import type {
  AlarmSnapshotBaseline,
  AlarmSnapshotBaselineResult,
} from "./alarm-snapshot-baseline.ts";
import type { TagChange } from "./tag-store.ts";

/** 当前报警候选会话的本地状态，不包含可信来源证明或真实报警实例。 */
export interface AlarmBaselineSessionState {
  readonly expectedTagId: string;
  readonly generation: number;
  readonly baseline: AlarmSnapshotBaseline | null;
}

/** 会话操作必须由受控订阅管理器触发并提供对应的代次。 */
export type AlarmBaselineSessionAction =
  | {
      readonly kind: "CHANGE";
      readonly generation: number;
      readonly sourceVerified: boolean;
      readonly change: TagChange;
    }
  | { readonly kind: "DISCONNECT" | "CHECK_FRESHNESS"; readonly generation: number };

export type AlarmBaselineSessionRejectReason =
  | AlarmTagDeltaRejectReason
  | Exclude<AlarmSnapshotBaselineResult["status"], "BASELINE_ESTABLISHED">
  | "DISCONNECTED"
  | "INVALID_INPUT";

export type AlarmBaselineSessionTransition =
  | {
      readonly status:
        | "BASELINE_ESTABLISHED"
        | "BASELINE_UNCHANGED"
        | "TAG_NOT_UPDATED"
        | "WAITING_SNAPSHOT"
        | "OTHER_SESSION_IGNORED";
      readonly state: AlarmBaselineSessionState;
    }
  | {
      readonly status: "DELTA_ACCEPTED";
      readonly value: number;
      readonly state: AlarmBaselineSessionState;
    }
  | {
      readonly status: "BASELINE_INVALIDATED";
      readonly reason: AlarmBaselineSessionRejectReason;
      readonly state: AlarmBaselineSessionState;
    };

const TAG_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

/** 新建等待快照的会话；代次由受控上游分配，不是认证凭据。 */
export function beginAlarmBaselineSession(
  expectedTagId: string,
  generation: number,
): AlarmBaselineSessionState {
  if (typeof expectedTagId !== "string" || !TAG_ID_PATTERN.test(expectedTagId)) {
    throw new TypeError("报警目标 Tag ID 无效");
  }
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new TypeError("报警会话代次无效");
  }
  return Object.freeze({ expectedTagId, generation, baseline: null });
}

/** 切换会话必须递增代次，同时彻底丢弃旧快照基线。 */
export function restartAlarmBaselineSession(
  previous: AlarmBaselineSessionState,
  nextGeneration: number,
): AlarmBaselineSessionState {
  if (!Number.isSafeInteger(nextGeneration) || nextGeneration <= previous.generation) {
    throw new TypeError("报警会话重启代次必须递增");
  }
  return beginAlarmBaselineSession(previous.expectedTagId, nextGeneration);
}

function withBaseline(
  state: AlarmBaselineSessionState,
  baseline: AlarmSnapshotBaseline | null,
): AlarmBaselineSessionState {
  return Object.freeze({
    expectedTagId: state.expectedTagId,
    generation: state.generation,
    baseline,
  });
}

function invalidate(
  state: AlarmBaselineSessionState,
  reason: AlarmBaselineSessionRejectReason,
): AlarmBaselineSessionTransition {
  return { status: "BASELINE_INVALIDATED", reason, state: withBaseline(state, null) };
}

/**
 * 归约快照、增量、断连和时间检查，不产生报警事件。
 * 本代次拒绝或非法数据一律清空基线；其他代次的迟到操作不修改当前会话。
 * 来源核验与会话代次分配属于上游责任；本地 sourceVerified 不是安全证明。
 */
export function transitionAlarmBaselineSession(
  state: AlarmBaselineSessionState,
  action: AlarmBaselineSessionAction,
  nowMs: number,
  maxAgeMs: number,
): AlarmBaselineSessionTransition {
  if (!Number.isSafeInteger(action.generation) || action.generation < 0) {
    throw new TypeError("报警会话事件代次无效");
  }
  if (action.generation !== state.generation) {
    return { status: "OTHER_SESSION_IGNORED", state };
  }
  if (action.kind === "DISCONNECT") return invalidate(state, "DISCONNECTED");

  try {
    if (action.kind === "CHECK_FRESHNESS") {
      if (state.baseline === null) return { status: "WAITING_SNAPSHOT", state };
      const checked = classifyTimelyNumericAlarmSample(state.baseline.value, nowMs, maxAgeMs);
      if (checked.status === "READY") return { status: "BASELINE_UNCHANGED", state };
      return invalidate(state, checked.status);
    }
    if (action.kind !== "CHANGE") return invalidate(state, "INVALID_INPUT");

    if (action.change.kind === "snapshot") {
      const result = establishAlarmSnapshotBaseline(
        {
          change: action.change,
          expectedTagId: state.expectedTagId,
          activeGeneration: state.generation,
          snapshotGeneration: action.generation,
          sourceVerified: action.sourceVerified,
        },
        nowMs,
        maxAgeMs,
      );
      if (result.status !== "BASELINE_ESTABLISHED") return invalidate(state, result.status);
      return {
        status: "BASELINE_ESTABLISHED",
        state: withBaseline(state, result.baseline),
      };
    }

    const result = advanceAlarmTagDeltaBaseline(
      {
        change: action.change,
        expectedTagId: state.expectedTagId,
        baseline: state.baseline,
        activeGeneration: state.generation,
        deltaGeneration: action.generation,
        sourceVerified: action.sourceVerified,
      },
      nowMs,
      maxAgeMs,
    );
    if (result.status === "DELTA_REJECTED") return invalidate(state, result.reason);
    if (result.status === "TAG_NOT_UPDATED") return { status: "TAG_NOT_UPDATED", state };
    return {
      status: "DELTA_ACCEPTED",
      value: result.value,
      state: withBaseline(state, result.baseline),
    };
  } catch (error) {
    if (error instanceof TypeError) return invalidate(state, "INVALID_INPUT");
    throw error;
  }
}
