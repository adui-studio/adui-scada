import { expect, test } from "vite-plus/test";
import {
  ALARM_EVENTS,
  ALARM_STATES,
  ALARM_STATE_LABELS,
  transitionAlarmState,
} from "../src/alarm-state.ts";
import type { AlarmEvent, AlarmState } from "../src/alarm-state.ts";

test("告警首次触发必须从无实例进入激活未确认", () => {
  expect(transitionAlarmState(null, "TRIGGER")).toBe("ACTIVE_UNACKED");
  expect(ALARM_EVENTS).toEqual(["TRIGGER", "RECOVER", "ACKNOWLEDGE"]);
  expect(ALARM_STATES).toEqual([
    "ACTIVE_UNACKED",
    "ACTIVE_ACKED",
    "CLEARED_UNACKED",
    "CLEARED_ACKED",
  ]);
});

test("确认只改变确认状态，不会使仍激活的工艺条件恢复", () => {
  const acknowledged = transitionAlarmState("ACTIVE_UNACKED", "ACKNOWLEDGE");
  expect(acknowledged).toBe("ACTIVE_ACKED");
  expect(transitionAlarmState(acknowledged, "TRIGGER")).toBe("ACTIVE_ACKED");
  expect(transitionAlarmState(acknowledged, "ACKNOWLEDGE")).toBe("ACTIVE_ACKED");
});

test("工艺条件恢复不代表已经确认，恢复后仍允许补确认", () => {
  const cleared = transitionAlarmState("ACTIVE_UNACKED", "RECOVER");
  expect(cleared).toBe("CLEARED_UNACKED");
  expect(transitionAlarmState(cleared, "ACKNOWLEDGE")).toBe("CLEARED_ACKED");
  expect(transitionAlarmState(cleared, "RECOVER")).toBe("CLEARED_UNACKED");
});

test("激活已确认后恢复保留确认结果，重复恢复不会新建告警", () => {
  const cleared = transitionAlarmState("ACTIVE_ACKED", "RECOVER");
  expect(cleared).toBe("CLEARED_ACKED");
  expect(transitionAlarmState(cleared, "RECOVER")).toBe("CLEARED_ACKED");
  expect(transitionAlarmState(cleared, "ACKNOWLEDGE")).toBe("CLEARED_ACKED");
});

test("从已恢复状态再次触发必须重新变为激活未确认", () => {
  expect(transitionAlarmState("CLEARED_UNACKED", "TRIGGER")).toBe("ACTIVE_UNACKED");
  expect(transitionAlarmState("CLEARED_ACKED", "TRIGGER")).toBe("ACTIVE_UNACKED");
  expect(transitionAlarmState("ACTIVE_UNACKED", "TRIGGER")).toBe("ACTIVE_UNACKED");
});

test("没有报警实例时不允许伪造确认或恢复动作", () => {
  expect(() => transitionAlarmState(null, "ACKNOWLEDGE")).toThrow("不存在可确认的报警实例");
  expect(() => transitionAlarmState(null, "RECOVER")).toThrow("不存在可恢复的报警实例");
});

test("运行时出现未知状态或事件时明确拒绝而非默认放行", () => {
  const invalidState = "DISABLED" as AlarmState;
  const invalidEvent = "WRITE_DEVICE" as AlarmEvent;
  expect(() => transitionAlarmState(invalidState, "TRIGGER")).toThrow("报警状态不受支持");
  expect(() => transitionAlarmState("ACTIVE_UNACKED", invalidEvent)).toThrow("报警事件不受支持");
});

test("共享中文标签保留四个明确的技术状态码", () => {
  expect(ALARM_STATE_LABELS).toEqual({
    ACTIVE_UNACKED: "激活未确认",
    ACTIVE_ACKED: "激活已确认",
    CLEARED_UNACKED: "已恢复未确认",
    CLEARED_ACKED: "已恢复已确认",
  });
});
