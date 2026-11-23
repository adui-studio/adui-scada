import { expect, test } from "vite-plus/test";
import { AlarmSubscriptionAdapter } from "../src/index.ts";
import type {
  AlarmReadonlySubscriptionSource,
  AlarmSubscriptionScheduler,
  TagChange,
  TagValue,
} from "../src/index.ts";

const startMs = Date.parse("2026-11-22T09:00:00.000Z");
const value: TagValue = {
  tagId: "tank.level",
  value: 40,
  quality: "GOOD",
  sourceTimestamp: null,
  serverTimestamp: "2026-11-22T08:59:58.000Z",
  sequence: 5,
};
type Handlers = Parameters<AlarmReadonlySubscriptionSource["subscribe"]>[0];

class TestSource implements AlarmReadonlySubscriptionSource {
  readonly handlers: Handlers[] = [];
  closes = 0;
  immediate: ((handlers: Handlers) => void) | null = null;
  fail = false;

  subscribe(handlers: Handlers): () => void {
    if (this.fail) throw new TypeError("测试订阅失败");
    this.handlers.push(handlers);
    this.immediate?.(handlers);
    return () => {
      this.closes += 1;
    };
  }

  emit(change: TagChange, sourceVerified = true, index = this.handlers.length - 1): void {
    this.handlers[index]?.onChange(change, sourceVerified);
  }
}

class TestScheduler implements AlarmSubscriptionScheduler {
  readonly callbacks: (() => void)[] = [];
  readonly intervals: number[] = [];
  cancels = 0;
  immediate = false;
  fail = false;

  every(intervalMs: number, callback: () => void): () => void {
    if (this.fail) throw new TypeError("测试调度失败");
    this.intervals.push(intervalMs);
    this.callbacks.push(callback);
    if (this.immediate) callback();
    return () => {
      this.cancels += 1;
    };
  }

  tick(index = this.callbacks.length - 1): void {
    this.callbacks[index]?.();
  }
}

function setup() {
  const source = new TestSource();
  const scheduler = new TestScheduler();
  let now = startMs;
  const adapter = new AlarmSubscriptionAdapter("tank.level", source, scheduler, {
    maxAgeMs: 3000,
    checkIntervalMs: 1000,
    nowMs: () => now,
  });
  return {
    adapter,
    source,
    scheduler,
    setNow: (next: number) => {
      now = next;
    },
  };
}

test("启动建立只读订阅和检查计划，快照与增量正常推进", () => {
  const { adapter, source, scheduler } = setup();
  adapter.start();
  expect(adapter.isRunning()).toBe(true);
  expect(scheduler.intervals).toEqual([1000]);
  source.emit({ kind: "snapshot", values: [value] });
  expect(adapter.snapshot().baseline?.value.sequence).toBe(5);
  source.emit({ kind: "delta", values: [{ ...value, sequence: 6, value: 42 }] });
  expect(adapter.snapshot().baseline?.value.sequence).toBe(6);
  expect(adapter.snapshot().baseline?.value.value).toBe(42);
  adapter.stop();
  expect(source.closes).toBe(1);
  expect(scheduler.cancels).toBe(1);
});

test("无目标增量不能刷新基线年龄，定时检查过期释放所有资源", () => {
  const { adapter, source, scheduler, setNow } = setup();
  adapter.start();
  source.emit({ kind: "snapshot", values: [value] });
  source.emit({ kind: "delta", values: [{ ...value, tagId: "other.tag" }] });
  setNow(startMs + 1001);
  scheduler.tick();
  expect(adapter.isRunning()).toBe(false);
  expect(adapter.snapshot().baseline).toBeNull();
  expect(source.closes).toBe(1);
  expect(scheduler.cancels).toBe(1);
});

test("断连撤销令牌并关闭订阅，迟到快照不能重新建立基线", () => {
  const { adapter, source, scheduler } = setup();
  adapter.start();
  source.emit({ kind: "snapshot", values: [value] });
  source.handlers[0]?.onDisconnect();
  expect(adapter.isRunning()).toBe(false);
  source.emit({ kind: "snapshot", values: [value] }, true, 0);
  scheduler.tick(0);
  expect(adapter.snapshot().baseline).toBeNull();
  expect(source.closes).toBe(1);
  expect(scheduler.cancels).toBe(1);
});

test("重启后旧订阅与旧检查回调不能改变新会话", () => {
  const { adapter, source, scheduler } = setup();
  adapter.start();
  source.emit({ kind: "snapshot", values: [value] });
  adapter.stop();
  adapter.start();
  expect(adapter.snapshot().generation).toBe(1);
  source.emit({ kind: "snapshot", values: [{ ...value, sequence: 1 }] }, true, 1);
  source.emit({ kind: "delta", values: [{ ...value, sequence: 6 }] }, true, 0);
  source.handlers[0]?.onDisconnect();
  scheduler.tick(0);
  expect(adapter.snapshot().baseline?.value.sequence).toBe(1);
  expect(adapter.isRunning()).toBe(true);
  adapter.stop();
});

test("上游未核验的消息使订阅失效，不能当作可信初始快照", () => {
  const { adapter, source, scheduler } = setup();
  adapter.start();
  source.emit({ kind: "snapshot", values: [value] }, false);
  expect(adapter.isRunning()).toBe(false);
  expect(adapter.snapshot().baseline).toBeNull();
  expect(source.closes).toBe(1);
  expect(scheduler.cancels).toBe(1);
});

test("整批非法数据立即关闭订阅且不泄露部分基线", () => {
  const { adapter, source } = setup();
  adapter.start();
  source.emit({ kind: "snapshot", values: [value] });
  source.emit({ kind: "delta", values: [value, { ...value }] });
  expect(adapter.isRunning()).toBe(false);
  expect(adapter.snapshot().baseline).toBeNull();
  expect(source.closes).toBe(1);
});

test("订阅源同步触发异常质量时也能在返回后释放取消函数", () => {
  const { adapter, source, scheduler } = setup();
  source.immediate = (handlers) => {
    handlers.onChange({ kind: "snapshot", values: [{ ...value, quality: "BAD" }] }, true);
  };
  adapter.start();
  expect(adapter.isRunning()).toBe(false);
  expect(adapter.snapshot().baseline).toBeNull();
  expect(source.closes).toBe(1);
  expect(scheduler.intervals).toEqual([]);
});

test("调度器同步发现过期时能补做取消并防止旧回调进入", () => {
  const { adapter, source, scheduler, setNow } = setup();
  source.immediate = (handlers) => {
    handlers.onChange({ kind: "snapshot", values: [value] }, true);
    setNow(startMs + 1001);
  };
  scheduler.immediate = true;
  adapter.start();
  expect(adapter.isRunning()).toBe(false);
  expect(source.closes).toBe(1);
  expect(scheduler.cancels).toBe(1);
});

test("订阅或调度安装异常会清空状态并释放已经建立的资源", () => {
  const first = setup();
  first.source.fail = true;
  expect(() => first.adapter.start()).toThrow("测试订阅失败");
  expect(first.adapter.isRunning()).toBe(false);
  expect(first.adapter.snapshot().baseline).toBeNull();

  const second = setup();
  second.scheduler.fail = true;
  expect(() => second.adapter.start()).toThrow("测试调度失败");
  expect(second.source.closes).toBe(1);
  expect(second.adapter.isRunning()).toBe(false);
  expect(second.adapter.snapshot().baseline).toBeNull();
});

test("主动停止幂等且启动期重复调用被拒绝", () => {
  const { adapter, source, scheduler } = setup();
  adapter.start();
  expect(() => adapter.start()).toThrow("报警候选订阅已经启动");
  adapter.stop();
  adapter.stop();
  expect(source.closes).toBe(1);
  expect(scheduler.cancels).toBe(1);
  expect(adapter.isRunning()).toBe(false);
});

test("错误时效参数必须拒绝且不能启动资源", () => {
  const source = new TestSource();
  const scheduler = new TestScheduler();
  for (const [maxAgeMs, checkIntervalMs] of [
    [0, 1000],
    [1000, 0],
    [1000, 1001],
    [Number.NaN, 500],
    [1000, 1.5],
  ]) {
    expect(
      () =>
        new AlarmSubscriptionAdapter("tank.level", source, scheduler, {
          maxAgeMs,
          checkIntervalMs,
          nowMs: () => startMs,
        }),
    ).toThrow("报警时效检查参数无效");
  }
  expect(source.handlers).toEqual([]);
  expect(scheduler.intervals).toEqual([]);
});

test("构造后外部修改配置不能放宽或缩短既定时间窗口", () => {
  const source = new TestSource();
  const scheduler = new TestScheduler();
  const options = {
    maxAgeMs: 3000,
    checkIntervalMs: 1000,
    nowMs: () => startMs,
  };
  const adapter = new AlarmSubscriptionAdapter("tank.level", source, scheduler, options);
  options.maxAgeMs = 1;
  options.checkIntervalMs = 1;
  adapter.start();
  source.emit({ kind: "snapshot", values: [value] });
  expect(adapter.snapshot().baseline?.value.sequence).toBe(5);
  expect(scheduler.intervals).toEqual([1000]);
  adapter.stop();
});

test("受控时钟读取异常必须释放订阅并禁止迟到快照恢复", () => {
  const source = new TestSource();
  const scheduler = new TestScheduler();
  const adapter = new AlarmSubscriptionAdapter("tank.level", source, scheduler, {
    maxAgeMs: 3000,
    checkIntervalMs: 1000,
    nowMs: () => {
      throw new TypeError("测试时钟不可用");
    },
  });
  adapter.start();
  expect(() => source.emit({ kind: "snapshot", values: [value] })).toThrow("测试时钟不可用");
  expect(adapter.isRunning()).toBe(false);
  expect(adapter.snapshot().baseline).toBeNull();
  expect(source.closes).toBe(1);
  expect(scheduler.cancels).toBe(1);
  source.emit({ kind: "snapshot", values: [value] });
  expect(adapter.snapshot().baseline).toBeNull();
});

test("周期取消重入启动新会话时先清空旧基线，不能复用原代次", () => {
  const source = new TestSource();
  let adapter: AlarmSubscriptionAdapter;
  let cancellations = 0;
  let baselineClearedBeforeCancellation = false;
  const scheduler: AlarmSubscriptionScheduler = {
    every(_intervalMs, _callback) {
      return () => {
        cancellations += 1;
        if (cancellations === 1) {
          baselineClearedBeforeCancellation = adapter.snapshot().baseline === null;
          adapter.start();
        }
      };
    },
  };
  adapter = new AlarmSubscriptionAdapter("tank.level", source, scheduler, {
    maxAgeMs: 3000,
    checkIntervalMs: 1000,
    nowMs: () => startMs,
  });
  adapter.start();
  source.emit({ kind: "snapshot", values: [value] });
  const oldCallback = source.handlers[0];
  adapter.stop();

  expect(baselineClearedBeforeCancellation).toBe(true);
  expect(adapter.isRunning()).toBe(true);
  expect(adapter.snapshot().generation).toBe(1);
  expect(source.handlers).toHaveLength(2);
  oldCallback?.onChange({ kind: "snapshot", values: [value] }, true);
  expect(adapter.snapshot().baseline).toBeNull();

  source.emit({ kind: "snapshot", values: [{ ...value, sequence: 1 }] });
  expect(adapter.snapshot().baseline?.value.sequence).toBe(1);
  adapter.stop();
  expect(cancellations).toBe(2);
});

test("旧订阅安装失败不应关闭同步重入启动的新会话", () => {
  let adapter: AlarmSubscriptionAdapter;
  let subscribed = 0;
  let closed = 0;
  const acceptedHandlers: Handlers[] = [];
  const source: AlarmReadonlySubscriptionSource = {
    subscribe(handlers) {
      subscribed += 1;
      if (subscribed === 1) {
        handlers.onDisconnect();
        adapter.start();
        throw new TypeError("旧订阅安装失败");
      }
      acceptedHandlers.push(handlers);
      return () => {
        closed += 1;
      };
    },
  };
  const scheduler = new TestScheduler();
  adapter = new AlarmSubscriptionAdapter("tank.level", source, scheduler, {
    maxAgeMs: 3000,
    checkIntervalMs: 1000,
    nowMs: () => startMs,
  });

  expect(() => adapter.start()).toThrow("旧订阅安装失败");
  expect(adapter.isRunning()).toBe(true);
  expect(adapter.snapshot().generation).toBe(1);
  acceptedHandlers[0]?.onChange({ kind: "snapshot", values: [value] }, true);
  expect(adapter.snapshot().baseline?.value.sequence).toBe(5);
  adapter.stop();
  expect(closed).toBe(1);
  expect(scheduler.cancels).toBe(1);
});

test("取消周期和取消订阅均抛错时仍尝试两种清理并撤销会话", () => {
  const acceptedHandlers: Handlers[] = [];
  const cancelFailure = new TypeError("测试取消周期失败");
  const unsubscribeFailure = new TypeError("测试取消订阅失败");
  let closes = 0;
  let cancels = 0;
  const source: AlarmReadonlySubscriptionSource = {
    subscribe(callbacks) {
      acceptedHandlers.push(callbacks);
      return () => {
        closes += 1;
        throw unsubscribeFailure;
      };
    },
  };
  const scheduler: AlarmSubscriptionScheduler = {
    every() {
      return () => {
        cancels += 1;
        throw cancelFailure;
      };
    },
  };
  const adapter = new AlarmSubscriptionAdapter("tank.level", source, scheduler, {
    maxAgeMs: 3000,
    checkIntervalMs: 1000,
    nowMs: () => startMs,
  });
  adapter.start();
  acceptedHandlers[0]?.onChange({ kind: "snapshot", values: [value] }, true);
  expect(adapter.snapshot().baseline?.value.sequence).toBe(5);
  let failure: unknown = null;
  try {
    adapter.stop();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).message).toBe("报警订阅资源清理失败");
  expect((failure as AggregateError).errors).toEqual([cancelFailure, unsubscribeFailure]);
  expect(closes).toBe(1);
  expect(cancels).toBe(1);
  expect(adapter.isRunning()).toBe(false);
  expect(adapter.snapshot().baseline).toBeNull();
  acceptedHandlers[0]?.onChange({ kind: "snapshot", values: [value] }, true);
  expect(adapter.snapshot().baseline).toBeNull();
});

test("旧会话调度安装完成后若新会话已重入，不覆盖新取消函数", () => {
  const source = new TestSource();
  let adapter: AlarmSubscriptionAdapter;
  let installed = 0;
  let cancelled = 0;
  const scheduler: AlarmSubscriptionScheduler = {
    every(_intervalMs, _callback) {
      installed += 1;
      if (installed === 1) {
        source.handlers[0]?.onDisconnect();
        adapter.start();
      }
      return () => {
        cancelled += 1;
      };
    },
  };
  adapter = new AlarmSubscriptionAdapter("tank.level", source, scheduler, {
    maxAgeMs: 3000,
    checkIntervalMs: 1000,
    nowMs: () => startMs,
  });
  adapter.start();
  expect(installed).toBe(2);
  expect(cancelled).toBe(1);
  expect(adapter.isRunning()).toBe(true);
  expect(adapter.snapshot().generation).toBe(1);
  source.emit({ kind: "snapshot", values: [{ ...value, sequence: 1 }] }, true, 1);
  expect(adapter.snapshot().baseline?.value.sequence).toBe(1);
  adapter.stop();
  expect(cancelled).toBe(2);
});

test("只有取消周期失败时仍保留原始异常并完成取消订阅", () => {
  const source = new TestSource();
  const cancelFailure = new TypeError("测试单项周期取消失败");
  let unsubscribed = 0;
  const subscription: AlarmReadonlySubscriptionSource = {
    subscribe(handlers) {
      source.subscribe(handlers);
      return () => {
        unsubscribed += 1;
      };
    },
  };
  const scheduler: AlarmSubscriptionScheduler = {
    every() {
      return () => {
        throw cancelFailure;
      };
    },
  };
  const adapter = new AlarmSubscriptionAdapter("tank.level", subscription, scheduler, {
    maxAgeMs: 3000,
    checkIntervalMs: 1000,
    nowMs: () => startMs,
  });
  adapter.start();
  source.emit({ kind: "snapshot", values: [value] });
  let failure: unknown = null;
  try {
    adapter.stop();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBe(cancelFailure);
  expect(unsubscribed).toBe(1);
  expect(adapter.snapshot().baseline).toBeNull();
  expect(adapter.isRunning()).toBe(false);
});

test("调度安装故障与订阅取消故障同时保留且会话失效", () => {
  const schedulerFailure = new TypeError("测试调度安装故障");
  const cleanupFailure = new TypeError("测试取消订阅故障");
  let unsubscribed = 0;
  const source: AlarmReadonlySubscriptionSource = {
    subscribe() {
      return () => {
        unsubscribed += 1;
        throw cleanupFailure;
      };
    },
  };
  const scheduler: AlarmSubscriptionScheduler = {
    every() {
      throw schedulerFailure;
    },
  };
  const adapter = new AlarmSubscriptionAdapter("tank.level", source, scheduler, {
    maxAgeMs: 3000,
    checkIntervalMs: 1000,
    nowMs: () => startMs,
  });
  let failure: unknown = null;
  try {
    adapter.start();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).message).toBe("报警订阅失败且资源清理失败");
  expect((failure as AggregateError).errors).toEqual([schedulerFailure, cleanupFailure]);
  expect(unsubscribed).toBe(1);
  expect(adapter.isRunning()).toBe(false);
  expect(adapter.snapshot().baseline).toBeNull();
});

test("回调读取时钟故障与双资源取消故障均保留原始原因", () => {
  const originalFailure = new TypeError("测试时钟读取故障");
  const intervalFailure = new TypeError("测试周期取消故障");
  const subscriptionFailure = new TypeError("测试订阅取消故障");
  const handlers: Handlers[] = [];
  let cancelCount = 0;
  let unsubscribeCount = 0;
  const source: AlarmReadonlySubscriptionSource = {
    subscribe(handler) {
      handlers.push(handler);
      return () => {
        unsubscribeCount += 1;
        throw subscriptionFailure;
      };
    },
  };
  const scheduler: AlarmSubscriptionScheduler = {
    every() {
      return () => {
        cancelCount += 1;
        throw intervalFailure;
      };
    },
  };
  const adapter = new AlarmSubscriptionAdapter("tank.level", source, scheduler, {
    maxAgeMs: 3000,
    checkIntervalMs: 1000,
    nowMs: () => {
      throw originalFailure;
    },
  });
  adapter.start();
  let failure: unknown = null;
  try {
    handlers[0]?.onChange({ kind: "snapshot", values: [value] }, true);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).message).toBe("报警订阅失败且资源清理失败");
  const failures = (failure as AggregateError).errors as unknown[];
  expect(failures[0]).toBe(originalFailure);
  expect(failures[1]).toBeInstanceOf(AggregateError);
  expect((failures[1] as AggregateError).errors).toEqual([
    intervalFailure,
    subscriptionFailure,
  ]);
  expect(cancelCount).toBe(1);
  expect(unsubscribeCount).toBe(1);
  expect(adapter.isRunning()).toBe(false);
  expect(adapter.snapshot().baseline).toBeNull();
  handlers[0]?.onChange({ kind: "snapshot", values: [value] }, true);
  expect(adapter.snapshot().baseline).toBeNull();
});
