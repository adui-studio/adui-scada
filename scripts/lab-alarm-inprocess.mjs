import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AlarmSubscriptionAdapter } from "../packages/core/src/alarm-subscription-adapter.ts";
import { TagStore } from "../packages/core/src/tag-store.ts";

/**
 * FR-011 S0 进程内实验：仅合成数据，不启动网络服务、不接设备、不执行报警业务写入。
 * 这里的核验标志仅用于演示 Core 拒绝路径，不是认证凭据或工业来源证明。
 */
export function runAlarmInprocessLab() {
  const nowMs = Date.parse("2026-11-23T09:00:00.000Z");
  /** @type {import("../packages/core/src/tag-store.ts").TagValue} */
  const base = {
    tagId: "lab.tank.level",
    value: 40,
    quality: "GOOD",
    sourceTimestamp: null,
    serverTimestamp: "2026-11-23T08:59:59.000Z",
    sequence: 5,
  };
  const store = new TagStore();
  store.apply([base]);

  let sourceVerified = true;
  let unsubscribed = 0;
  let cancelled = 0;
  /** @type {Parameters<import("../packages/core/src/alarm-subscription-adapter.ts").AlarmReadonlySubscriptionSource["subscribe"]>[0] | null} */
  let formerHandlers = null;

  /** @type {import("../packages/core/src/alarm-subscription-adapter.ts").AlarmReadonlySubscriptionSource} */
  const source = {
    subscribe(handlers) {
      formerHandlers = handlers;
      const unsubscribe = store.subscribe((change) => {
        handlers.onChange(change, sourceVerified);
      });
      return () => {
        unsubscribe();
        unsubscribed += 1;
      };
    },
  };
  // 调度器只记录取消操作；本实验不创建真实定时器。
  /** @type {import("../packages/core/src/alarm-subscription-adapter.ts").AlarmSubscriptionScheduler} */
  const scheduler = {
    every() {
      return () => {
        cancelled += 1;
      };
    },
  };
  const adapter = new AlarmSubscriptionAdapter(base.tagId, source, scheduler, {
    maxAgeMs: 3000,
    checkIntervalMs: 1000,
    nowMs: () => nowMs,
  });

  adapter.start();
  const initialSequence = adapter.snapshot().baseline?.value.sequence ?? null;

  // 现有 Tag 业务序列只要求递增，不代表中间事件已被完整收到。
  store.apply([{ ...base, sequence: 7, value: 42 }]);
  const jumpedSequence = adapter.snapshot().baseline?.value.sequence ?? null;
  store.apply([{ ...base, sequence: 6, value: 41 }]);
  const afterLateSequence = adapter.snapshot().baseline?.value.sequence ?? null;

  // 故意改变本地模拟标记，演示候选 fail-closed；不是实际证书撤销。
  sourceVerified = false;
  store.apply([{ ...base, sequence: 8, value: 43 }]);
  const stopped = !adapter.isRunning();
  const invalidated = adapter.snapshot().invalidated === true;
  const candidateCleared = adapter.snapshot().baseline === null;

  // TagStore 并不具备来源认证功能；候选订阅结束后它仍可接收模拟输入。
  store.apply([{ ...base, sequence: 9, value: 44 }]);
  formerHandlers?.onChange({ kind: "delta", values: [{ ...base, sequence: 10 }] }, true);
  formerHandlers?.onDisconnect();

  return Object.freeze({
    mode: "INPROCESS_SIMULATION",
    initialSequence,
    jumpedSequence,
    afterLateSequence,
    stopped,
    invalidated,
    candidateCleared,
    lateCallbackIgnored: adapter.snapshot().baseline === null && !adapter.isRunning(),
    tagStoreSequenceAfterStop: store.get(base.tagId)?.sequence ?? null,
    unsubscribed,
    cancelled,
    machineIdentityAuthenticated: false,
    transportHistoryComplete: false,
    formalAlarmEvents: 0,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log("FR-011 S0 进程内模拟诊断：", JSON.stringify(runAlarmInprocessLab()));
}
