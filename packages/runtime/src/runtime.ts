import { TagStore, parseScadaDocument, renderSvgPage, validateTagValue } from "@adui/scada-core";
import type { ScadaDocument, TagChange, TagValue } from "@adui/scada-core";
import { createSseTagSource } from "./tag-source.ts";
import type { ReadonlyTagSource, ReadonlyTagSubscription } from "./tag-source.ts";

export type RuntimeStatus =
  | "idle"
  | "loading"
  | "connecting"
  | "live"
  | "stale"
  | "simulation"
  | "reconnecting"
  | "error";
/** Runtime 内部状态对应的中文显示名称。 */
export const RUNTIME_STATUS_LABELS: Record<RuntimeStatus, string> = {
  idle: "未启动",
  loading: "加载中",
  connecting: "连接中",
  live: "模拟数据正常",
  stale: "Tag 数据已过期",
  simulation: "离线模拟",
  reconnecting: "重新连接中",
  error: "运行异常",
};

export interface RuntimeState {
  readonly status: RuntimeStatus;
  readonly document: ScadaDocument | null;
  readonly values: readonly TagValue[];
  readonly message: string;
}
export type RuntimeListener = (state: RuntimeState) => void;
export const initialRuntimeState: RuntimeState = {
  status: "idle",
  document: null,
  values: [],
  message: "尚未连接模拟数据源",
};

export function applyDemoChange(store: TagStore, raw: unknown): TagChange {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new TypeError("Tag 事件格式无效");
  const e = raw as Record<string, unknown>;
  if (e.kind !== "snapshot" && e.kind !== "delta") throw new TypeError("事件类型无效");
  if (!Array.isArray(e.values) || e.values.length > 5000) throw new TypeError("事件数据列表无效");
  const values = e.values.map((item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item))
      throw new TypeError("Tag 数据格式无效");
    return validateTagValue(item as TagValue);
  });
  if (e.kind === "snapshot") store.replaceSnapshot(values);
  else store.apply(values);
  return { kind: e.kind, values };
}

export function svgDataUrl(
  document: ScadaDocument,
  values: readonly TagValue[],
  pageId?: string,
): string {
  const page =
    pageId === undefined ? document.pages[0] : document.pages.find((item) => item.id === pageId);
  if (!page)
    throw new RangeError(pageId === undefined ? "工程文档不包含页面" : "未找到页面：" + pageId);
  const snapshot = new Map(values.map((v) => [v.tagId, v]));
  return (
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(renderSvgPage(document, page.id, snapshot))
  );
}

/** 连续 12 秒无有效 Tag 值时，将显示数据超时，但 SSE 心跳不会重置这个计时。 */
export const TAG_DATA_TIMEOUT_MS = 12_000;

/** 基于只读数据源契约的浏览器 Runtime，默认仍使用原独立水处理演示服务。 */
export class DemoRuntime {
  private readonly listener: RuntimeListener;
  private readonly source: ReadonlyTagSource;
  private subscription: ReadonlyTagSubscription | null = null;
  private loading: AbortController | null = null;
  private dataTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityCleanup: (() => void) | null = null;
  private readonly store = new TagStore();
  // 传输内的本地过期标记不占用上游序列号，按 Tag 独立恢复。
  private readonly expiredTagIds = new Set<string>();
  private document: ScadaDocument | null = null;
  private status: RuntimeStatus = "idle";
  private message = initialRuntimeState.message;
  private active = false;
  private generation = 0;

  constructor(listener: RuntimeListener, source: ReadonlyTagSource = createSseTagSource()) {
    this.listener = listener;
    this.source = source;
  }

  private clearDataTimer(): void {
    if (this.dataTimer !== null) clearInterval(this.dataTimer);
    this.dataTimer = null;
  }

  private clearVisibilityListener(): void {
    this.visibilityCleanup?.();
    this.visibilityCleanup = null;
  }

  private current(generation: number): boolean {
    return this.active && this.generation === generation;
  }

  private visibleSnapshot(): readonly TagValue[] {
    return this.store
      .snapshot()
      .map((tag) =>
        this.expiredTagIds.has(tag.tagId) && (tag.quality === "GOOD" || tag.quality === "UNCERTAIN")
          ? { ...tag, quality: "STALE" as const }
          : tag,
      );
  }

  private publish(): void {
    if (this.active) {
      this.listener({
        status: this.status,
        document: this.document,
        values: this.visibleSnapshot(),
        message: this.message,
      });
    }
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    const generation = ++this.generation;
    const controller = new AbortController();
    this.loading = controller;
    // 重新开始订阅前，旧会话数据不得以 GOOD 质量显示。
    this.expiredTagIds.clear();
    this.store.markDisconnected(Date.now());
    this.status = "loading";
    this.message = "正在加载模拟工程";
    this.publish();

    try {
      const rawProject = await this.source.loadProject(controller.signal);
      if (!this.current(generation)) return;
      this.document = parseScadaDocument(rawProject);
      this.status = "connecting";
      this.message = "等待 Tag 快照";
      this.publish();

      let awaitingSnapshot = true;
      let lastDataAt = Date.now();
      const subscription = this.source.subscribe({
        onMessage: (raw) => {
          if (!this.current(generation)) return;
          try {
            const event: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
            // 新连接与重连的第一个消息必须是快照，禁止旧会话增量误标 GOOD。
            if (
              awaitingSnapshot &&
              (event === null ||
                typeof event !== "object" ||
                Array.isArray(event) ||
                (event as { kind?: unknown }).kind !== "snapshot")
            ) {
              throw new TypeError("新订阅必须先收到 Tag 快照");
            }
            const previous = new Map(this.store.snapshot().map((tag) => [tag.tagId, tag.sequence]));
            const change = applyDemoChange(this.store, event);
            if (change.kind === "snapshot") {
              awaitingSnapshot = false;
              this.expiredTagIds.clear();
            } else {
              // 只有被 Store 接受的新序列才能恢复相应 Tag 的显示质量。
              for (const tag of change.values) {
                if (tag.sequence > (previous.get(tag.tagId) ?? -1)) {
                  this.expiredTagIds.delete(tag.tagId);
                }
              }
            }
            // 空增量或已经被 TagStore 拒绝的旧序列不能刷新数据新鲜度。
            const hasNewData =
              change.kind === "snapshot"
                ? change.values.length > 0
                : change.values.some((tag) => tag.sequence > (previous.get(tag.tagId) ?? -1));
            if (change.kind === "delta" && !hasNewData) return;
            if (hasNewData) lastDataAt = Date.now();
            const hasStale = this.visibleSnapshot().some((tag) => tag.quality === "STALE");
            this.status = hasStale ? "stale" : "live";
            this.message = hasStale
              ? "模拟数据存在已过期的 Tag，心跳不能恢复数据质量"
              : "模拟数据连接正常";
          } catch (error) {
            // 拒绝并关闭无效消息源，禁止之后的事件覆盖错误状态。
            this.generation++;
            this.clearDataTimer();
            this.clearVisibilityListener();
            this.subscription?.close();
            this.subscription = null;
            this.expiredTagIds.clear();
            this.store.markDisconnected(Date.now());
            this.status = "error";
            this.message =
              "无效模拟数据：" + (error instanceof Error ? error.message : String(error));
          }
          this.publish();
        },
        onDisconnected: () => {
          if (!this.current(generation)) return;
          awaitingSnapshot = true;
          lastDataAt = Date.now();
          this.expiredTagIds.clear();
          this.store.markDisconnected(Date.now());
          this.status = "reconnecting";
          this.message = "连接中断，旧值已标记 STALE，等待重连";
          this.publish();
        },
      });
      // 同步消息回调也可能在 subscribe 返回前执行；必须防止残留连接。
      if (!this.current(generation)) {
        subscription.close();
        return;
      }
      this.subscription = subscription;
      const checkDataSilence = (): void => {
        if (
          !this.current(generation) ||
          this.status === "error" ||
          this.status === "reconnecting"
        ) {
          return;
        }
        if (Date.now() - lastDataAt < TAG_DATA_TIMEOUT_MS) return;
        // 仅在 Runtime 显示层降级，不调用会消耗上游序列号的 markDisconnected。
        for (const tag of this.store.snapshot()) {
          if (tag.quality === "GOOD" || tag.quality === "UNCERTAIN") {
            this.expiredTagIds.add(tag.tagId);
          }
        }
        const message = "Tag 数据持续超时，现有读数已标记 STALE，等待新数据";
        if (this.status !== "stale" || this.message !== message) {
          this.status = "stale";
          this.message = message;
          this.publish();
        }
      };
      this.dataTimer = setInterval(checkDataSilence, 1000);
      if (typeof document !== "undefined") {
        const visibilityDocument = document;
        const onVisibilityChange = (): void => {
          if (visibilityDocument.visibilityState === "visible") checkDataSilence();
        };
        visibilityDocument.addEventListener("visibilitychange", onVisibilityChange);
        this.visibilityCleanup = () =>
          visibilityDocument.removeEventListener("visibilitychange", onVisibilityChange);
      }
    } catch (error) {
      if (!this.current(generation)) return;
      this.store.markDisconnected(Date.now());
      this.status = "error";
      this.message = error instanceof Error ? error.message : String(error);
      this.publish();
    } finally {
      if (this.loading === controller) this.loading = null;
    }
  }

  stop(): void {
    this.active = false;
    this.generation++;
    this.loading?.abort();
    this.loading = null;
    this.clearDataTimer();
    this.clearVisibilityListener();
    this.subscription?.close();
    this.subscription = null;
    this.expiredTagIds.clear();
    this.store.markDisconnected(Date.now());
  }
}
