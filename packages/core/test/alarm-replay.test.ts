import { expect, test } from "vite-plus/test";
import { replayAlarmEvents } from "../src/index.ts";
import type { AlarmEvent } from "../src/index.ts";

test("空事件序列没有告警实例，也不伪造状态轨迹", () => {
  expect(replayAlarmEvents([])).toEqual({ state: null, steps: [] });
});

test("事件回放保留首次触发、确认、恢复与重触发的每一步状态", () => {
  const result = replayAlarmEvents(["TRIGGER", "ACKNOWLEDGE", "RECOVER", "TRIGGER"]);
  expect(result).toEqual({
    state: "ACTIVE_UNACKED",
    steps: [
      {
        sequence: 1,
        event: "TRIGGER",
        before: null,
        after: "ACTIVE_UNACKED",
        changed: true,
      },
      {
        sequence: 2,
        event: "ACKNOWLEDGE",
        before: "ACTIVE_UNACKED",
        after: "ACTIVE_ACKED",
        changed: true,
      },
      {
        sequence: 3,
        event: "RECOVER",
        before: "ACTIVE_ACKED",
        after: "CLEARED_ACKED",
        changed: true,
      },
      {
        sequence: 4,
        event: "TRIGGER",
        before: "CLEARED_ACKED",
        after: "ACTIVE_UNACKED",
        changed: true,
      },
    ],
  });
});

test("重复事件仍保留输入顺序但明确标记未产生新状态", () => {
  const result = replayAlarmEvents(["TRIGGER", "TRIGGER", "ACKNOWLEDGE", "ACKNOWLEDGE"]);
  expect(result.state).toBe("ACTIVE_ACKED");
  expect(result.steps.map((step) => step.changed)).toEqual([true, false, true, false]);
  expect(result.steps.map((step) => step.sequence)).toEqual([1, 2, 3, 4]);
});

test("事件顺序非法或事件类型未知时拒绝返回不完整的状态结果", () => {
  expect(() => replayAlarmEvents(["RECOVER"])).toThrow("不存在可恢复的报警实例");
  expect(() => replayAlarmEvents(["ACKNOWLEDGE"])).toThrow("不存在可确认的报警实例");
  const unknown = "WRITE_DEVICE" as AlarmEvent;
  expect(() => replayAlarmEvents(["TRIGGER", unknown])).toThrow("报警事件不受支持");
  expect(replayAlarmEvents(["TRIGGER"]).state).toBe("ACTIVE_UNACKED");
});

test("回放只读取调用方事件且相同事件流结果确定，不修改原始数组", () => {
  const events = Object.freeze(["TRIGGER", "RECOVER", "ACKNOWLEDGE"] as const);
  const first = replayAlarmEvents(events);
  const second = replayAlarmEvents(events);
  expect(first).toEqual(second);
  expect(first.state).toBe("CLEARED_ACKED");
  expect(events).toEqual(["TRIGGER", "RECOVER", "ACKNOWLEDGE"]);
});
