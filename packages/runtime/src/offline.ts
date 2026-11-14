import {
  TagDefinitionCatalog,
  TagStore,
  WaterTreatmentSimulator,
  waterTreatmentDemoDocument,
} from "@adui/scada-core";
import type { RuntimeListener } from "./runtime.ts";
import { RuntimeStatusHistory, createRuntimeDiagnostics } from "./diagnostics.ts";

/**
 * 为 Tauri 打包版本提供明确标识的 V0.1 离线模拟运行时。
 * 不使用 fetch、EventSource、PLC、工业网关或设备控制命令。
 */
export class OfflineDemoRuntime {
  private readonly listener: RuntimeListener;
  private readonly simulator = new WaterTreatmentSimulator();
  private readonly store = new TagStore(new TagDefinitionCatalog(waterTreatmentDemoDocument.tags));
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private tick = 0;
  private lastTagReceivedAt: number | null = null;
  private readonly statusHistory = new RuntimeStatusHistory();

  constructor(listener: RuntimeListener) {
    this.listener = listener;
  }

  private publish(): void {
    if (!this.active) return;
    const values = this.store.snapshot();
    const stale = values.some((tag) => tag.quality === "STALE");
    this.statusHistory.record("simulation");
    this.listener({
      status: "simulation",
      document: waterTreatmentDemoDocument,
      values,
      diagnostics: createRuntimeDiagnostics(
        values,
        this.lastTagReceivedAt,
        0,
        Date.now(),
        this.statusHistory.snapshot(),
      ),
      message: stale
        ? "离线模拟｜正在演练数据中断，质量已标记 STALE（非真实设备数据）"
        : "离线模拟｜水位、泵和流量均为本机生成的演示数据，未连接任何设备",
    });
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.statusHistory.clear();
    this.tick = 0;
    this.lastTagReceivedAt = Date.now();
    this.store.replaceSnapshot(this.simulator.next());
    this.publish();

    this.timer = setInterval(() => {
      if (!this.active) return;
      this.tick++;
      // 与本机 SSE 诊断服务一致，每 30 秒模拟 8 秒数据中断。
      if (this.tick % 30 >= 22) {
        this.store.markStale(Date.now(), 2500);
      } else {
        const sequences = new Map(this.store.snapshot().map((tag) => [tag.tagId, tag.sequence]));
        this.simulator.resumeAfter(sequences);
        if (this.store.apply(this.simulator.next()).length > 0) {
          this.lastTagReceivedAt = Date.now();
        }
      }
      this.publish();
    }, 1000);
  }

  stop(): void {
    this.active = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
