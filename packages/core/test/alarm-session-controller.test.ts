import { expect, test } from "vite-plus/test";
import { AlarmBaselineSessionController } from "../src/index.ts";
import type { AlarmBaselineSessionToken, TagValue } from "../src/index.ts";

const nowMs = Date.parse("2026-11-22T09:00:00.000Z");
const baseline: TagValue = {
  tagId: "tank.level",
  value: 40,
  quality: "GOOD",
  sourceTimestamp: null,
  serverTimestamp: "2026-11-22T08:59:58.000Z",
  sequence: 5,
};
const next: TagValue = {
  ...baseline,
  value: 42,
  serverTimestamp: "2026-11-22T08:59:59.000Z",
  sequence: 6,
};

function activeToken(controller: AlarmBaselineSessionController): AlarmBaselineSessionToken {
  const token = controller.currentToken();
  if (token === null) throw new TypeError("测试会话令牌不存在");
  return token;
}

function establish(controller: AlarmBaselineSessionController): AlarmBaselineSessionToken {
  const token = activeToken(controller);
  const result = controller.receive(
    token,
    { kind: "snapshot", values: [baseline] },
    true,
    nowMs,
    3000,
  );
  if (result.status !== "BASELINE_ESTABLISHED") {
    throw new TypeError("测试初始快照未接受");
  }
  return token;
}

test("首次构造只创建等待快照的会话及冻结令牌", () => {
  const controller = new AlarmBaselineSessionController("tank.level");
  expect(controller.snapshot()).toEqual({
    expectedTagId: "tank.level",
    generation: 0,
    baseline: null,
  });
  expect(Object.isFrozen(activeToken(controller))).toBe(true);
  expect(controller.checkFreshness(activeToken(controller), nowMs, 3000).status).toBe(
    "WAITING_SNAPSHOT",
  );
});

test("快照与连续增量自动写回新基线且不改变旧快照", () => {
  const controller = new AlarmBaselineSessionController("tank.level", 2);
  const token = establish(controller);
  const original = controller.snapshot();
  const first = controller.receive(token, { kind: "delta", values: [next] }, true, nowMs, 3000);
  expect(first.status).toBe("DELTA_ACCEPTED");
  expect(controller.snapshot().baseline?.value.sequence).toBe(6);
  expect(original.baseline?.value.sequence).toBe(5);
  const second = controller.receive(
    token,
    { kind: "delta", values: [{ ...next, sequence: 7, value: 43 }] },
    true,
    nowMs,
    3000,
  );
  expect(second.status).toBe("DELTA_ACCEPTED");
  expect(controller.snapshot().baseline?.value.sequence).toBe(7);
});

test("托管会话允许业务序列跳号，但未核验增量必须撤销令牌且旧回调失效", () => {
  const controller = new AlarmBaselineSessionController("tank.level", 2);
  const token = establish(controller);
  const jumped = { ...next, sequence: 7 };
  expect(
    controller.receive(token, { kind: "delta", values: [jumped] }, true, nowMs, 3000),
  ).toMatchObject({ status: "DELTA_ACCEPTED", value: 42 });
  expect(controller.snapshot().baseline?.value.sequence).toBe(7);

  expect(
    controller.receive(
      token,
      { kind: "delta", values: [{ ...jumped, sequence: 8 }] },
      false,
      nowMs,
      3000,
    ),
  ).toMatchObject({ status: "BASELINE_INVALIDATED", reason: "UNVERIFIED_SOURCE" });
  expect(controller.snapshot().baseline).toBeNull();
  expect(controller.currentToken()).toBeNull();

  const renewed = controller.restart();
  expect(controller.receive(token, { kind: "delta", values: [jumped] }, true, nowMs, 3000)).toEqual({
    status: "STALE_HANDLE_IGNORED",
  });
  expect(
    controller.receive(
      renewed,
      { kind: "snapshot", values: [{ ...baseline, sequence: 1 }] },
      true,
      nowMs,
      3000,
    ).status,
  ).toBe("BASELINE_ESTABLISHED");
  expect(controller.snapshot().baseline?.value.sequence).toBe(1);
});

test("伪造相同数字代次的令牌仍无法读取或修改当前基线", () => {
  const controller = new AlarmBaselineSessionController("tank.level", 2);
  establish(controller);
  const oldState = controller.snapshot();
  const forged = Object.freeze({ generation: 2 });
  expect(controller.receive(forged, { kind: "delta", values: [next] }, true, nowMs, 3000)).toEqual({
    status: "STALE_HANDLE_IGNORED",
  });
  expect(controller.disconnect(forged, nowMs, 3000)).toEqual({
    status: "STALE_HANDLE_IGNORED",
  });
  expect(controller.snapshot()).toBe(oldState);
});

test("会话重启撤销旧令牌，旧快照与迟到断连不能影响新会话", () => {
  const controller = new AlarmBaselineSessionController("tank.level", 2);
  const old = establish(controller);
  const renewed = controller.restart();
  expect(renewed.generation).toBe(3);
  expect(renewed).not.toBe(old);
  expect(controller.snapshot().baseline).toBeNull();
  const newSnapshot = controller.receive(
    renewed,
    { kind: "snapshot", values: [{ ...baseline, sequence: 1 }] },
    true,
    nowMs,
    3000,
  );
  expect(newSnapshot.status).toBe("BASELINE_ESTABLISHED");
  expect(controller.receive(old, { kind: "delta", values: [next] }, true, nowMs, 3000)).toEqual({
    status: "STALE_HANDLE_IGNORED",
  });
  expect(controller.disconnect(old, nowMs, 3000)).toEqual({
    status: "STALE_HANDLE_IGNORED",
  });
  expect(controller.snapshot().baseline?.value.sequence).toBe(1);
});

test("断连立即撤销令牌，不能在同代次偷偷建立新快照", () => {
  const controller = new AlarmBaselineSessionController("tank.level", 2);
  const token = establish(controller);
  expect(controller.disconnect(token, nowMs, 3000).status).toBe("BASELINE_INVALIDATED");
  expect(controller.snapshot().baseline).toBeNull();
  expect(controller.currentToken()).toBeNull();
  expect(
    controller.receive(token, { kind: "snapshot", values: [baseline] }, true, nowMs, 3000),
  ).toEqual({ status: "STALE_HANDLE_IGNORED" });
  expect(controller.restart().generation).toBe(3);
});

test("来源未核验和坏质量都会清除旧基线并撤销令牌", () => {
  for (const badChange of [
    { sourceVerified: false, value: next },
    { sourceVerified: true, value: { ...next, quality: "BAD" as const } },
  ]) {
    const controller = new AlarmBaselineSessionController("tank.level", 2);
    const token = establish(controller);
    const result = controller.receive(
      token,
      { kind: "delta", values: [badChange.value] },
      badChange.sourceVerified,
      nowMs,
      3000,
    );
    expect(result.status).toBe("BASELINE_INVALIDATED");
    expect(controller.snapshot().baseline).toBeNull();
    expect(controller.currentToken()).toBeNull();
  }
});

test("格式非法的增量使会话失效而不是部分推进", () => {
  const controller = new AlarmBaselineSessionController("tank.level", 2);
  const token = establish(controller);
  const result = controller.receive(
    token,
    { kind: "delta", values: [next, { ...next }] },
    true,
    nowMs,
    3000,
  );
  expect(result).toMatchObject({ status: "BASELINE_INVALIDATED", reason: "INVALID_INPUT" });
  expect(controller.snapshot().baseline).toBeNull();
  expect(controller.currentToken()).toBeNull();
});

test("未更新目标 Tag 不能刷新年龄，显式时效检查会撤销旧令牌", () => {
  const controller = new AlarmBaselineSessionController("tank.level", 2);
  const token = establish(controller);
  expect(
    controller.receive(
      token,
      { kind: "delta", values: [{ ...next, tagId: "other.tag" }] },
      true,
      nowMs,
      3000,
    ).status,
  ).toBe("TAG_NOT_UPDATED");
  expect(controller.checkFreshness(token, nowMs, 3000).status).toBe("BASELINE_UNCHANGED");
  expect(controller.checkFreshness(token, nowMs, 1999).status).toBe("BASELINE_INVALIDATED");
  expect(controller.currentToken()).toBeNull();
  expect(controller.snapshot().baseline).toBeNull();
});

test("代次溢出和非法初始参数拒绝且不改变旧会话", () => {
  expect(() => new AlarmBaselineSessionController("bad tag")).toThrow("报警目标 Tag ID 无效");
  const controller = new AlarmBaselineSessionController("tank.level", Number.MAX_SAFE_INTEGER);
  const current = controller.snapshot();
  const token = activeToken(controller);
  expect(() => controller.restart()).toThrow("报警会话重启代次必须递增");
  expect(controller.snapshot()).toBe(current);
  expect(controller.currentToken()).toBe(token);
});

test("同代次重复快照撤销托管令牌，必须重启后才能从低序列重新建立基线", () => {
  const controller = new AlarmBaselineSessionController("tank.level", 2);
  const token = establish(controller);
  const rejected = controller.receive(
    token,
    { kind: "snapshot", values: [{ ...baseline, sequence: 1 }] },
    true,
    nowMs,
    3000,
  );
  expect(rejected).toEqual({
    status: "BASELINE_INVALIDATED",
    reason: "SNAPSHOT_ALREADY_ESTABLISHED",
    state: { expectedTagId: "tank.level", generation: 2, baseline: null, invalidated: true },
  });
  expect(controller.currentToken()).toBeNull();
  expect(
    controller.receive(token, { kind: "snapshot", values: [baseline] }, true, nowMs, 3000),
  ).toEqual({
    status: "STALE_HANDLE_IGNORED",
  });
  const renewed = controller.restart();
  expect(renewed.generation).toBe(3);
  expect(
    controller.receive(
      renewed,
      { kind: "snapshot", values: [{ ...baseline, sequence: 1 }] },
      true,
      nowMs,
      3000,
    ).status,
  ).toBe("BASELINE_ESTABLISHED");
  expect(controller.snapshot().baseline?.value.sequence).toBe(1);
});

test("等待快照期间的非法时钟检查撤销令牌，必须重启后才能接受快照", () => {
  const controller = new AlarmBaselineSessionController("tank.level", 2);
  const token = activeToken(controller);
  expect(controller.checkFreshness(token, Number.NaN, 3000)).toEqual({
    status: "BASELINE_INVALIDATED",
    reason: "INVALID_INPUT",
    state: { expectedTagId: "tank.level", generation: 2, baseline: null, invalidated: true },
  });
  expect(controller.currentToken()).toBeNull();
  expect(
    controller.receive(token, { kind: "snapshot", values: [baseline] }, true, nowMs, 3000),
  ).toEqual({ status: "STALE_HANDLE_IGNORED" });
  const restarted = controller.restart();
  expect(restarted.generation).toBe(3);
  expect(
    controller.receive(restarted, { kind: "snapshot", values: [baseline] }, true, nowMs, 3000)
      .status,
  ).toBe("BASELINE_ESTABLISHED");
});
