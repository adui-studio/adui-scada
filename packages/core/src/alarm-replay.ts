import { transitionAlarmState } from "./alarm-state.ts";
import type { AlarmEvent, AlarmState } from "./alarm-state.ts";

/** 会话内根据输入顺序生成的状态轨迹，不是持久化报警审计事件。 */
export interface AlarmReplayStep {
  readonly sequence: number;
  readonly event: AlarmEvent;
  readonly before: AlarmState | null;
  readonly after: AlarmState;
  /** 重复事件仍被记录，但不意味着发生了新状态转换。 */
  readonly changed: boolean;
}

export interface AlarmReplayResult {
  readonly state: AlarmState | null;
  readonly steps: readonly AlarmReplayStep[];
}

/**
 * 只回放已由可信上游判定的生命周期事件，不计算工艺阈值或执行确认操作。
 * 不写入输入、全局变量或外部系统；遇到非法事件序列直接拒绝完整回放结果。
 * 序号仅代表输入数组的位置，不可用作服务器事件 ID 或审计顺序证明。
 */
export function replayAlarmEvents(events: readonly AlarmEvent[]): AlarmReplayResult {
  let state: AlarmState | null = null;
  const steps: AlarmReplayStep[] = [];
  for (const [index, event] of events.entries()) {
    const next = transitionAlarmState(state, event);
    steps.push({
      sequence: index + 1,
      event,
      before: state,
      after: next,
      changed: state !== next,
    });
    state = next;
  }
  return { state, steps };
}
