import assert from "node:assert/strict";
import { test } from "node:test";
import { runAlarmInprocessLab } from "./lab-alarm-inprocess.mjs";

void test("进程内模拟可由初始快照建立本地报警候选基线", () => {
  const report = runAlarmInprocessLab();
  assert.equal(report.mode, "INPROCESS_SIMULATION");
  assert.equal(report.initialSequence, 5);
});

void test("非连续业务序列可推进候选，迟到的中间版本不会覆盖", () => {
  const report = runAlarmInprocessLab();
  assert.equal(report.jumpedSequence, 7);
  assert.equal(report.afterLateSequence, 7);
  assert.equal(report.transportHistoryComplete, false);
});

void test("未核验来源使当前候选终止并释放订阅资源", () => {
  const report = runAlarmInprocessLab();
  assert.equal(report.stopped, true);
  assert.equal(report.invalidated, true);
  assert.equal(report.candidateCleared, true);
  assert.equal(report.unsubscribed, 1);
  assert.equal(report.cancelled, 1);
  assert.equal(report.lateCallbackIgnored, true);
});

void test("TagStore 更新不构成来源认证或正式报警事件", () => {
  const report = runAlarmInprocessLab();
  assert.equal(report.tagStoreSequenceAfterStop, 9);
  assert.equal(report.machineIdentityAuthenticated, false);
  assert.equal(report.formalAlarmEvents, 0);
});

void test("每次隔离模拟均生成相同诊断且不共享订阅状态", () => {
  assert.deepEqual(runAlarmInprocessLab(), runAlarmInprocessLab());
});
