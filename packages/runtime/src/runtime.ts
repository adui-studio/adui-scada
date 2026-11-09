import { TagStore, parseScadaDocument, renderSvgPage, validateTagValue } from "@adui/scada-core";
import type { ScadaDocument, TagChange, TagValue } from "@adui/scada-core";

export type RuntimeStatus = "idle" | "loading" | "connecting" | "live" | "reconnecting" | "error";
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
    throw new TypeError("Invalid Tag event");
  const e = raw as Record<string, unknown>;
  if (e.kind !== "snapshot" && e.kind !== "delta") throw new TypeError("Invalid event kind");
  if (!Array.isArray(e.values) || e.values.length > 5000)
    throw new TypeError("Invalid event values");
  const values = e.values.map((item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item))
      throw new TypeError("Invalid Tag value");
    return validateTagValue(item as TagValue);
  });
  if (e.kind === "snapshot") store.replaceSnapshot(values);
  else store.apply(values);
  return { kind: e.kind, values };
}

export function svgDataUrl(document: ScadaDocument, values: readonly TagValue[]): string {
  const page = document.pages[0];
  if (!page) throw new RangeError("Document has no page");
  const snapshot = new Map(values.map((v) => [v.tagId, v]));
  return (
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(renderSvgPage(document, page.id, snapshot))
  );
}

/** Diagnostic-only SSE adapter; never connects directly to industrial equipment. */
export class DemoRuntime {
  private source: EventSource | null = null;
  private readonly store = new TagStore();
  private document: ScadaDocument | null = null;
  private status: RuntimeStatus = "idle";
  private message = initialRuntimeState.message;
  private active = false;
  private readonly listener: RuntimeListener;

  constructor(listener: RuntimeListener) {
    this.listener = listener;
  }

  private publish(): void {
    if (this.active)
      this.listener({
        status: this.status,
        document: this.document,
        values: this.store.snapshot(),
        message: this.message,
      });
  }
  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.status = "loading";
    this.message = "正在加载模拟工程";
    this.publish();
    try {
      const response = await fetch("/demo/project", { cache: "no-store" });
      if (!response.ok) throw new Error("读取模拟工程失败: HTTP " + response.status);
      const body: unknown = await response.json();
      const document = parseScadaDocument(body);
      if (!this.active) return;
      this.document = document;
      this.status = "connecting";
      this.message = "等待 Tag 快照";
      this.publish();
      const source = new EventSource("/demo/events");
      this.source = source;
      source.onmessage = (event) => {
        if (!this.active || this.source !== source) return;
        try {
          const raw: unknown = JSON.parse(event.data);
          applyDemoChange(this.store, raw);
          this.status = "live";
          this.message = "模拟数据连接正常";
        } catch (error) {
          source.close();
          this.source = null;
          this.store.markDisconnected(Date.now());
          this.status = "error";
          this.message =
            "无效模拟数据：" + (error instanceof Error ? error.message : String(error));
        }
        this.publish();
      };
      source.onerror = () => {
        if (!this.active || this.source !== source) return;
        this.store.markDisconnected(Date.now());
        this.status = "reconnecting";
        this.message = "连接中断，旧值已标记 STALE，等待重连";
        this.publish();
      };
    } catch (error) {
      if (!this.active) return;
      this.store.markDisconnected(Date.now());
      this.status = "error";
      this.message = error instanceof Error ? error.message : String(error);
      this.publish();
    }
  }
  stop(): void {
    this.active = false;
    this.source?.close();
    this.source = null;
  }
}
