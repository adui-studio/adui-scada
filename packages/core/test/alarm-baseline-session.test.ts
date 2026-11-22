import { expect, test } from "vite-plus/test";
import {
  beginAlarmBaselineSession,
  restartAlarmBaselineSession,
  transitionAlarmBaselineSession,
} from "../src/index.ts";
import type {
  AlarmBaselineSessionAction,
  AlarmBaselineSessionState,
  TagValue,
} from "../src/index.ts";

const nowMs = Date.parse("2026-11-22T09:00:00.000Z");
const previous: TagValue = {
  tagId: "tank.level",
  value: 40,
  quality: "GOOD",
  sourceTimestamp: null,
  serverTimestamp: "2026-11-22T08:59:58.000Z",
  sequence: 5,
};
const next: TagValue = {
  ...previous,
  value: 42,
  serverTimestamp: "2026-11-22T08:59:59.000Z",
  sequence: 6,
};
const snapshot: AlarmBaselineSessionAction = {
  kind: "CHANGE",
  generation: 2,
  sourceVerified: true,
  change: { kind: "snapshot", values: [previous] },
};
const delta: AlarmBaselineSessionAction = {
  kind: "CHANGE",
  generation: 2,
  sourceVerified: true,
  change: { kind: "delta", values: [next] },
};

function established(): AlarmBaselineSessionState {
  const initial = beginAlarmBaselineSession("tank.level", 2);
  const transition = transitionAlarmBaselineSession(initial, snapshot, nowMs, 3000);
  if (transition.status !== "BASELINE_ESTABLISHED") {
    throw new TypeError("测试快照基线未建立");
  }
  return transition.state;
}

test("创建会话时不带旧数值，初始状态冻结并等待快照", () => {
  const state = beginAlarmBaselineSession("tank.level", 2);
  expect(state).toEqual({ expectedTagId: "tank.level", generation: 2, baseline: null });
  expect(Object.isFrozen(state)).toBe(true);
  expect(
    transitionAlarmBaselineSession(state, { kind: "CHECK_FRESHNESS", generation: 2 }, nowMs, 3000),
  ).toEqual({
    status: "WAITING_SNAPSHOT",
    state,
  });
});

test("快照建立只读基线，连续增量只返回新候选并推进序列", () => {
  const initial = established();
  expect(Object.isFrozen(initial.baseline)).toBe(true);
  expect(Object.isFrozen(initial.baseline?.value)).toBe(true);

  const first = transitionAlarmBaselineSession(initial, delta, nowMs, 3000);
  expect(first).toEqual({
    status: "DELTA_ACCEPTED",
    value: 42,
    state: { expectedTagId: "tank.level", generation: 2, baseline: { generation: 2, value: next } },
  });
  if (first.status !== "DELTA_ACCEPTED") {
    throw new TypeError("测试首条增量未被接受");
  }
  const nextTwo: TagValue = { ...next, value: 43, sequence: 7 };
  const second = transitionAlarmBaselineSession(
    first.state,
    { ...delta, change: { kind: "delta", values: [nextTwo] } },
    nowMs,
    3000,
  );
  expect(second.status).toBe("DELTA_ACCEPTED");
  expect(initial.baseline?.value.sequence).toBe(5);
  expect(first.state.baseline?.value.sequence).toBe(6);
  expect(second.state.baseline?.value.sequence).toBe(7);
});

test("同会话未更新目标 Tag 时保留基线但不重发旧值", () => {
  const initial = established();
  const result = transitionAlarmBaselineSession(
    initial,
    { ...delta, change: { kind: "delta", values: [{ ...next, tagId: "other.tag" }] } },
    nowMs,
    3000,
  );
  expect(result).toEqual({ status: "TAG_NOT_UPDATED", state: initial });
});

test("旧会话的快照、增量和断连回调不能改变当前会话", () => {
  const initial = established();
  const restarted = restartAlarmBaselineSession(initial, 3);
  const refreshed = transitionAlarmBaselineSession(
    restarted,
    {
      ...snapshot,
      generation: 3,
      change: { kind: "snapshot", values: [{ ...previous, sequence: 1 }] },
    },
    nowMs,
    3000,
  );
  expect(refreshed.status).toBe("BASELINE_ESTABLISHED");
  for (const action of [
    snapshot,
    delta,
    { kind: "DISCONNECT", generation: 2 } as const,
  ]) {
    expect(transitionAlarmBaselineSession(refreshed.state, action, nowMs, 3000)).toEqual({
      status: "OTHER_SESSION_IGNORED",
      state: refreshed.state,
    });
  }
  expect(refreshed.state.baseline?.value.sequence).toBe(1);
});

test("重启必须递增代次并清空基线，不能复用原会话状态", () => {
  const initial = established();
  const restarted = restartAlarmBaselineSession(initial, 3);
  expect(restarted).toEqual({ expectedTagId: "tank.level", generation: 3, baseline: null });
  expect(initial.baseline?.value.sequence).toBe(5);
  for (const invalid of [2, 1, -1, Number.NaN, 1.5]) {
    expect(() => restartAlarmBaselineSession(initial, invalid)).toThrow("报警会话重启代次必须递增");
  }
});

test("本会话来源未核验或类型不合法时立即废弃旧基线", () => {
  const initial = established();
  const invalid = transitionAlarmBaselineSession(
    initial,
    { ...delta, sourceVerified: false },
    nowMs,
    3000,
  );
  expect(invalid).toEqual({
    status: "BASELINE_INVALIDATED",
    reason: "UNVERIFIED_SOURCE",
    state: { ...initial, baseline: null },
  });
  const notDelta = transitionAlarmBaselineSession(
    initial,
    { ...delta, change: { kind: "snapshot", values: [{ ...next, quality: "BAD" }] } },
    nowMs,
    3000,
  );
  expect(notDelta).toEqual({
    status: "BASELINE_INVALIDATED",
    reason: "QUALITY_NOT_GOOD",
    state: { ...initial, baseline: null },
  });
});

test("重复或倒退序列清空基线，后续增量不能绕过快照重建", () => {
  const initial = established();
  const invalid = transitionAlarmBaselineSession(
    initial,
    { ...delta, change: { kind: "delta", values: [{ ...next, sequence: 5 }] } },
    nowMs,
    3000,
  );
  expect(invalid).toEqual({
    status: "BASELINE_INVALIDATED",
    reason: "SEQUENCE_NOT_ADVANCED",
    state: { ...initial, baseline: null },
  });
  const afterward = transitionAlarmBaselineSession(invalid.state, delta, nowMs, 3000);
  expect(afterward).toEqual({
    status: "BASELINE_INVALIDATED",
    reason: "BASELINE_REQUIRED",
    state: invalid.state,
  });
  const recovered = transitionAlarmBaselineSession(invalid.state, snapshot, nowMs, 3000);
  expect(recovered.status).toBe("BASELINE_ESTABLISHED");
});

test("任一 Tag 校验异常在本会话内都清空基线，不会部分更新", () => {
  const initial = established();
  const duplicate = transitionAlarmBaselineSession(
    initial,
    { ...delta, change: { kind: "delta", values: [next, { ...next }] } },
    nowMs,
    3000,
  );
  expect(duplicate).toEqual({
    status: "BASELINE_INVALIDATED",
    reason: "INVALID_INPUT",
    state: { ...initial, baseline: null },
  });
  const malformed = transitionAlarmBaselineSession(
    initial,
    { ...delta, change: { kind: "delta", values: [{ ...next, sequence: -1 }] } },
    nowMs,
    3000,
  );
  expect(malformed.status).toBe("BASELINE_INVALIDATED");
  expect(malformed.state.baseline).toBeNull();
});

test("断连清空当前基线并等待新的快照，其他代次断连不影响当前状态", () => {
  const initial = established();
  const disconnected = transitionAlarmBaselineSession(
    initial,
    { kind: "DISCONNECT", generation: 2 },
    nowMs,
    3000,
  );
  expect(disconnected).toEqual({
    status: "BASELINE_INVALIDATED",
    reason: "DISCONNECTED",
    state: { ...initial, baseline: null },
  });
  expect(
    transitionAlarmBaselineSession(
      disconnected.state,
      { kind: "CHECK_FRESHNESS", generation: 2 },
      nowMs,
      3000,
    ),
  ).toEqual({ status: "WAITING_SNAPSHOT", state: disconnected.state });
});

test("无目标增量不能刷新年龄，独立时效检查必须使旧基线失效", () => {
  const initial = established();
  const empty = transitionAlarmBaselineSession(
    initial,
    { ...delta, change: { kind: "delta", values: [] } },
    nowMs,
    3000,
  );
  expect(empty.status).toBe("TAG_NOT_UPDATED");
  expect(
    transitionAlarmBaselineSession(
      empty.state,
      { kind: "CHECK_FRESHNESS", generation: 2 },
      nowMs,
      3000,
    ),
  ).toEqual({
    status: "BASELINE_UNCHANGED",
    state: empty.state,
  });
  const expired = transitionAlarmBaselineSession(
    empty.state,
    { kind: "CHECK_FRESHNESS", generation: 2 },
    nowMs,
    1999,
  );
  expect(expired).toEqual({
    status: "BASELINE_INVALIDATED",
    reason: "OUTDATED_TIMESTAMP",
    state: { ...initial, baseline: null },
  });
});

test("参数错误有明确拒绝，且不改变已冻结的当前状态", () => {
  const initial = established();
  for (const generation of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() =>
      transitionAlarmBaselineSession(initial, { kind: "DISCONNECT", generation }, nowMs, 3000),
    ).toThrow("报警会话事件代次无效");
  }
  expect(() => beginAlarmBaselineSession("invalid tag", 2)).toThrow("报警目标 Tag ID 无效");
  expect(() => beginAlarmBaselineSession("tank.level", -1)).toThrow("报警会话代次无效");
  expect(initial.baseline?.value.sequence).toBe(5);
  expect(Object.isFrozen(initial)).toBe(true);
});
