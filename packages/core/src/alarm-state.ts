/** 告警激活与确认状态彼此独立；确认不表示现场工艺条件已恢复。 */
export const ALARM_STATES = [
  "ACTIVE_UNACKED",
  "ACTIVE_ACKED",
  "CLEARED_UNACKED",
  "CLEARED_ACKED",
] as const;

export type AlarmState = (typeof ALARM_STATES)[number];

/** 仅描述可信上游已决定的生命周期事件，不参与阈值/死区/质量判定。 */
export const ALARM_EVENTS = ["TRIGGER", "RECOVER", "ACKNOWLEDGE"] as const;
export type AlarmEvent = (typeof ALARM_EVENTS)[number];

export const ALARM_STATE_LABELS: Readonly<Record<AlarmState, string>> = Object.freeze({
  ACTIVE_UNACKED: "激活未确认",
  ACTIVE_ACKED: "激活已确认",
  CLEARED_UNACKED: "已恢复未确认",
  CLEARED_ACKED: "已恢复已确认",
});

/**
 * 纯函数形式的最小告警生命周期状态转换。
 * null 表示尚无任何告警实例，只允许首个 TRIGGER 创建实例。
 * 授权、确认操作者、事件持久化以及工业数据质量由调用方独立实现并审查。
 */
export function transitionAlarmState(previous: AlarmState | null, event: AlarmEvent): AlarmState {
  if (previous !== null && !ALARM_STATES.includes(previous)) {
    throw new TypeError("报警状态不受支持");
  }
  switch (event) {
    case "TRIGGER":
      // 持续激活不重复清除确认；只有真正恢复后的重触发才重置确认状态。
      return previous === "ACTIVE_UNACKED" || previous === "ACTIVE_ACKED"
        ? previous
        : "ACTIVE_UNACKED";
    case "RECOVER":
      if (previous === null) throw new TypeError("不存在可恢复的报警实例");
      if (previous === "ACTIVE_UNACKED") return "CLEARED_UNACKED";
      if (previous === "ACTIVE_ACKED") return "CLEARED_ACKED";
      return previous;
    case "ACKNOWLEDGE":
      if (previous === null) throw new TypeError("不存在可确认的报警实例");
      if (previous === "ACTIVE_UNACKED") return "ACTIVE_ACKED";
      if (previous === "CLEARED_UNACKED") return "CLEARED_ACKED";
      return previous;
    default:
      throw new TypeError("报警事件不受支持");
  }
}
