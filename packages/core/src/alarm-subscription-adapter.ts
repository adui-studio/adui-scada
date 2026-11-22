import { AlarmBaselineSessionController } from "./alarm-session-controller.ts";
import type { AlarmBaselineSessionToken } from "./alarm-session-controller.ts";
import type { AlarmBaselineSessionState } from "./alarm-baseline-session.ts";
import type { TagChange } from "./tag-store.ts";

/**
 * 只读数据源接口仅允许由受控上游实现；回调中的核验标志本身不构成认证证据。
 * subscribe 可以同步发出首次快照；返回的函数必须释放该订阅。
 */
export interface AlarmReadonlySubscriptionSource {
  subscribe(handlers: {
    readonly onChange: (change: TagChange, sourceVerified: boolean) => void;
    readonly onDisconnect: () => void;
  }): () => void;
}

/** 时钟与周期调度由受控宿主提供，Core 不依赖系统时间或定时器。 */
export interface AlarmSubscriptionScheduler {
  every(intervalMs: number, callback: () => void): () => void;
}

export interface AlarmSubscriptionAdapterOptions {
  readonly maxAgeMs: number;
  readonly checkIntervalMs: number;
  readonly nowMs: () => number;
}

/**
 * 托管一个报警候选的只读订阅，定期检查基线新鲜度。
 * 所有拒绝/断连/超时都关闭当前订阅；只有显式再次 start 才建立新代次。
 * 不执行报警规则或设备写入，也不证明上游传入数据已经通过来源认证。
 */
export class AlarmSubscriptionAdapter {
  private readonly controller: AlarmBaselineSessionController;
  private readonly source: AlarmReadonlySubscriptionSource;
  private readonly scheduler: AlarmSubscriptionScheduler;
  private readonly options: AlarmSubscriptionAdapterOptions;
  private token: AlarmBaselineSessionToken | null = null;
  private unsubscribe: (() => void) | null = null;
  private cancelCheck: (() => void) | null = null;
  private running = false;

  constructor(
    expectedTagId: string,
    source: AlarmReadonlySubscriptionSource,
    scheduler: AlarmSubscriptionScheduler,
    options: AlarmSubscriptionAdapterOptions,
  ) {
    if (
      !Number.isSafeInteger(options.maxAgeMs) ||
      options.maxAgeMs <= 0 ||
      !Number.isSafeInteger(options.checkIntervalMs) ||
      options.checkIntervalMs <= 0 ||
      options.checkIntervalMs > options.maxAgeMs
    ) {
      throw new TypeError("报警时效检查参数无效");
    }
    this.controller = new AlarmBaselineSessionController(expectedTagId);
    this.source = source;
    this.scheduler = scheduler;
    this.options = options;
  }

  snapshot(): AlarmBaselineSessionState {
    return this.controller.snapshot();
  }

  isRunning(): boolean {
    return this.running;
  }

  /** 同步订阅和定时器均可能立即回调，安装失败必须清理此前已获得的资源。 */
  start(): void {
    if (this.running) throw new TypeError("报警候选订阅已经启动");

    const token = this.controller.currentToken() ?? this.controller.restart();
    this.token = token;
    this.running = true;

    try {
      const unsubscribe = this.source.subscribe({
        onChange: (change, sourceVerified) => {
          this.forward(token, () =>
            this.controller.receive(
              token,
              change,
              sourceVerified,
              this.options.nowMs(),
              this.options.maxAgeMs,
            ),
          );
        },
        onDisconnect: () => {
          this.forward(token, () => this.controller.disconnect(token, 0, this.options.maxAgeMs));
        },
      });

      if (typeof unsubscribe !== "function") {
        throw new TypeError("报警数据源未返回取消订阅函数");
      }
      if (!this.running) {
        unsubscribe();
        return;
      }
      this.unsubscribe = unsubscribe;

      const cancelCheck = this.scheduler.every(this.options.checkIntervalMs, () => {
        this.forward(token, () =>
          this.controller.checkFreshness(token, this.options.nowMs(), this.options.maxAgeMs),
        );
      });
      if (typeof cancelCheck !== "function") {
        throw new TypeError("报警调度器未返回取消函数");
      }
      if (!this.running) {
        cancelCheck();
        return;
      }
      this.cancelCheck = cancelCheck;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  /** 主动停止或故障后，立即撤销回调令牌并释放全部已安装资源。 */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    const token = this.token;
    this.token = null;
    const cancelCheck = this.cancelCheck;
    const unsubscribe = this.unsubscribe;
    this.cancelCheck = null;
    this.unsubscribe = null;
    try {
      cancelCheck?.();
    } finally {
      try {
        unsubscribe?.();
      } finally {
        if (token !== null) this.controller.disconnect(token, 0, this.options.maxAgeMs);
      }
    }
  }

  private forward(token: AlarmBaselineSessionToken, invoke: () => { readonly status: string }): void {
    if (!this.running || token !== this.token) return;
    try {
      if (invoke().status === "BASELINE_INVALIDATED") this.stop();
    } catch (error) {
      this.stop();
      throw error;
    }
  }
}
