import {
  beginAlarmBaselineSession,
  restartAlarmBaselineSession,
  transitionAlarmBaselineSession,
} from "./alarm-baseline-session.ts";
import type {
  AlarmBaselineSessionAction,
  AlarmBaselineSessionState,
  AlarmBaselineSessionTransition,
} from "./alarm-baseline-session.ts";
import type { TagChange } from "./tag-store.ts";

/** 令牌只用于本地回调身份比较，不是认证凭据或网络会话标识。 */
export interface AlarmBaselineSessionToken {
  readonly generation: number;
}

/** 失效令牌不会收到当前会话状态，也不会收到工艺数值。 */
export type AlarmBaselineManagedTransition =
  | AlarmBaselineSessionTransition
  | { readonly status: "STALE_HANDLE_IGNORED" };

/**
 * 同步托管报警候选会话状态，实际替换每次归约返回的新基线。
 * 不创建网络订阅、定时器或报警事件；数据来源核验必须由外部受控上游完成。
 */
export class AlarmBaselineSessionController {
  private state: AlarmBaselineSessionState;
  private token: AlarmBaselineSessionToken | null;

  constructor(expectedTagId: string, initialGeneration = 0) {
    this.state = beginAlarmBaselineSession(expectedTagId, initialGeneration);
    this.token = Object.freeze({ generation: initialGeneration });
  }

  /** 获取当前冻结状态；调用方不可将它作为可信报警或审计证据。 */
  snapshot(): AlarmBaselineSessionState {
    return this.state;
  }

  /** 仅向当前受控订阅回调传入此对象，不要用同代次数字重建令牌。 */
  currentToken(): AlarmBaselineSessionToken | null {
    return this.token;
  }

  /** 丢弃旧会话基线与令牌；代次溢出时保持原状态并拒绝。 */
  restart(): AlarmBaselineSessionToken {
    const next = restartAlarmBaselineSession(this.state, this.state.generation + 1);
    const token = Object.freeze({ generation: next.generation });
    this.state = next;
    this.token = token;
    return token;
  }

  receive(
    token: AlarmBaselineSessionToken,
    change: TagChange,
    sourceVerified: boolean,
    nowMs: number,
    maxAgeMs: number,
  ): AlarmBaselineManagedTransition {
    return this.apply(
      token,
      {
        kind: "CHANGE",
        generation: this.state.generation,
        change,
        sourceVerified,
      },
      nowMs,
      maxAgeMs,
    );
  }

  /** 当前会话断连后撤销令牌；后续消息必须先显式 restart。 */
  disconnect(
    token: AlarmBaselineSessionToken,
    nowMs: number,
    maxAgeMs: number,
  ): AlarmBaselineManagedTransition {
    return this.apply(
      token,
      { kind: "DISCONNECT", generation: this.state.generation },
      nowMs,
      maxAgeMs,
    );
  }

  /** 无隐式时钟或调度；调用方必须以可信时钟主动执行过期检查。 */
  checkFreshness(
    token: AlarmBaselineSessionToken,
    nowMs: number,
    maxAgeMs: number,
  ): AlarmBaselineManagedTransition {
    return this.apply(
      token,
      { kind: "CHECK_FRESHNESS", generation: this.state.generation },
      nowMs,
      maxAgeMs,
    );
  }

  private apply(
    token: AlarmBaselineSessionToken,
    action: AlarmBaselineSessionAction,
    nowMs: number,
    maxAgeMs: number,
  ): AlarmBaselineManagedTransition {
    if (this.token === null || token !== this.token) {
      return { status: "STALE_HANDLE_IGNORED" };
    }
    const transition = transitionAlarmBaselineSession(this.state, action, nowMs, maxAgeMs);
    this.state = transition.state;
    if (transition.status === "BASELINE_INVALIDATED") this.token = null;
    return transition;
  }
}
