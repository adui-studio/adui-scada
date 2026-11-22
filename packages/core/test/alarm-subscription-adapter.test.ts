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
    expect(() =>
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
