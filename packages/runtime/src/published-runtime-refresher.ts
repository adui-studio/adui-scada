import { PublishedRuntime } from "./published-runtime.ts";

/** 单次延时刷新；取消函数必须使未触发的任务不再运行。 */
export type PublishedRefreshSchedule = (
  callback: () => void,
  delayMs: number,
) => () => void;

export interface PublishedRefreshOptions {
  /** 正常刷新间隔，限制在 1～300 秒，默认 15 秒。 */
  readonly intervalMs?: number;
  /** 离线重试最大间隔，不能小于正常间隔，默认 60 秒。 */
  readonly maxOfflineIntervalMs?: number;
  /** 单次请求超时上限，默认 10 秒；超时后立即清空快照并启动离线退避。 */
  readonly requestTimeoutMs?: number;
  /** 测试可注入受控时钟；正式运行使用单次 setTimeout。 */
  readonly schedule?: PublishedRefreshSchedule;
}

const DEFAULT_REFRESH_MS = 15_000;
const DEFAULT_MAX_OFFLINE_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MIN_REFRESH_MS = 1_000;
const MAX_REFRESH_MS = 300_000;

const defaultSchedule: PublishedRefreshSchedule = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

function requireInterval(value: number, label: string): void {
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_REFRESH_MS ||
    value > MAX_REFRESH_MS
  ) {
    throw new TypeError(label + "必须是 1000～300000 毫秒的安全整数");
  }
}

/**
 * 生命周期受控的发布指针刷新器。
 * 仅显式 start 后刷新；隐藏/停止立即撤下画面，重显必须重新读取受控服务端指针。
 * 不持有自己的快照、不轮询编辑 head、不缓存敏感发布正文。
 */
export class PublishedRuntimeRefresher {
  private readonly runtime: PublishedRuntime;
  private readonly intervalMs: number;
  private readonly maxOfflineIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly schedule: PublishedRefreshSchedule;
  private projectId: string | null = null;
  private active = false;
  private visible = false;
  private epoch = 0;
  private offlineFailures = 0;
  private pending: Promise<void> | null = null;
  private cancelScheduled: (() => void) | null = null;
  private cancelWatchdog: (() => void) | null = null;

  constructor(runtime: PublishedRuntime, options: PublishedRefreshOptions = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_REFRESH_MS;
    const maxOfflineIntervalMs = options.maxOfflineIntervalMs ?? DEFAULT_MAX_OFFLINE_MS;
    const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    requireInterval(intervalMs, "正式发布刷新间隔");
    requireInterval(maxOfflineIntervalMs, "正式发布离线重试上限");
    requireInterval(requestTimeoutMs, "正式发布单次请求超时");
    if (maxOfflineIntervalMs < intervalMs) {
      throw new TypeError("正式发布离线重试上限不得小于刷新间隔");
    }
    this.runtime = runtime;
    this.intervalMs = intervalMs;
    this.maxOfflineIntervalMs = maxOfflineIntervalMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.schedule = options.schedule ?? defaultSchedule;
  }

  private clearSchedule(): void {
    this.cancelScheduled?.();
    this.cancelScheduled = null;
  }

  private clearWatchdog(): void {
    this.cancelWatchdog?.();
    this.cancelWatchdog = null;
  }

  private scheduleNext(): void {
    if (!this.active || !this.visible || this.projectId === null) return;

    const status = this.runtime.snapshot().status;
    if (status === "denied" || status === "error") {
      // 撤权和完整性错误禁止自动重试；只能由调用方显式开启新会话。
      return;
    }
    if (status !== "verified" && status !== "unreleased" && status !== "offline") {
      return;
    }

    if (status === "offline") {
      this.offlineFailures = Math.min(this.offlineFailures + 1, 16);
    } else {
      this.offlineFailures = 0;
    }
    const delay =
      status === "offline"
        ? Math.min(
            this.maxOfflineIntervalMs,
            this.intervalMs * 2 ** Math.min(this.offlineFailures - 1, 10),
          )
        : this.intervalMs;
    const expectedEpoch = this.epoch;
    this.cancelScheduled = this.schedule(() => {
      if (
        expectedEpoch !== this.epoch ||
        !this.active ||
        !this.visible ||
        this.projectId === null
      ) {
        return;
      }
      this.cancelScheduled = null;
      // 延时任务的未知异常不得泄漏 Promise 拒绝或继续刷新旧发布内容。
      void this.refresh().catch(() => this.stop());
    }, delay);
  }

  /** 显式启动一个工程的只读运行会话；调用方必须在身份变更时重新 start。 */
  async start(projectId: string): Promise<void> {
    this.stop();
    this.active = true;
    this.visible = true;
    this.projectId = projectId;
    try {
      await this.refresh();
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  /**
   * 手动刷新与自动刷新使用同一个请求；并发触发不会发出第二条 GET。
   * 读取失败交由 PublishedRuntime 显式显示离线、撤权或异常质量。
   */
  async refresh(): Promise<void> {
    if (!this.active || !this.visible || this.projectId === null) return;
    if (this.pending !== null) return this.pending;
    this.clearSchedule();
    const expectedEpoch = this.epoch;
    const projectId = this.projectId;
    const task = (async () => {
      const timeout = new Promise<void>((resolve) => {
        this.cancelWatchdog = this.schedule(() => {
          if (expectedEpoch !== this.epoch) return;
          this.cancelWatchdog = null;
          try {
            this.runtime.expire();
          } catch {
            // 未预期的监听器异常也不得让超时回调持有旧发布快照。
            this.stop();
          } finally {
            resolve();
          }
        }, this.requestTimeoutMs);
      });
      try {
        // 网络底层忽略 AbortSignal 时也必须按超时上限撤下运行画面。
        await Promise.race([this.runtime.load(projectId), timeout]);
      } finally {
        if (expectedEpoch === this.epoch) {
          this.clearWatchdog();
          this.pending = null;
          this.scheduleNext();
        }
      }
    })();
    this.pending = task;
    await task;
  }

  /** 隐藏时取消请求、清空快照和定时任务；重新可见时先从正式发布指针重读。 */
  async setVisible(visible: boolean): Promise<void> {
    if (!this.active || visible === this.visible) return;
    this.visible = visible;
    this.clearSchedule();
    if (!visible) {
      this.clearWatchdog();
      this.epoch++;
      this.pending = null;
      this.offlineFailures = 0;
      this.runtime.stop();
      return;
    }
    await this.refresh();
  }

  /** 页面卸载、登出、身份切换必须调用；旧任务即使迟到也无法恢复画面。 */
  stop(): void {
    this.epoch++;
    this.clearSchedule();
    this.clearWatchdog();
    this.active = false;
    this.visible = false;
    this.projectId = null;
    this.pending = null;
    this.offlineFailures = 0;
    this.runtime.stop();
  }
}
