import { Injectable } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { TagStore, WaterTreatmentSimulator, waterTreatmentDemoDocument } from "@adui/scada-core";
import type { ScadaDocument, TagChange, TagListener } from "@adui/scada-core";

/**
 * 本机开发专用的只读模拟数据源。只生成固定水处理 Tag，不读取环境中的工业设备配置。
 * 保持与现有独立水处理 SSE 模拟服务一致的 30 秒周期及数据质量规则。
 */
@Injectable()
export class LocalDemoTelemetryService implements OnModuleInit, OnModuleDestroy {
  private readonly store = new TagStore();
  private readonly simulator = new WaterTreatmentSimulator();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;

  onModuleInit(): void {
    if (this.timer !== null) return;

    this.store.apply(this.simulator.next());
    this.timer = setInterval(() => {
      this.tick += 1;
      if (this.tick % 30 >= 22) {
        this.store.markStale(Date.now(), 2500);
        return;
      }
      const sequences = new Map(
        this.store.snapshot().map((value) => [value.tagId, value.sequence]),
      );
      this.simulator.resumeAfter(sequences);
      this.store.apply(this.simulator.next());
    }, 1000);
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  project(): ScadaDocument {
    return waterTreatmentDemoDocument;
  }

  snapshot(): TagChange {
    return { kind: "snapshot", values: this.store.snapshot() };
  }

  subscribe(listener: TagListener): () => void {
    return this.store.subscribe(listener);
  }
}
