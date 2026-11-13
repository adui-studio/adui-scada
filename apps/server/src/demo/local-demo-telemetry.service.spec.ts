import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { LocalDemoTelemetryService } from "./local-demo-telemetry.service.js";

describe("本机水处理模拟 Tag 服务", () => {
  let service: LocalDemoTelemetryService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-13T00:00:00.000Z"));
    service = new LocalDemoTelemetryService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  it("首次启动生成三个共享契约 Tag，不重复开启定时器", () => {
    service.onModuleInit();
    service.onModuleInit();

    expect(service.project().projectId).toBe("water-demo");
    expect(service.snapshot().kind).toBe("snapshot");
    expect(service.snapshot().values.map((tag) => tag.tagId)).toEqual([
      "water.level",
      "water.pump.running",
      "water.flow",
    ]);
    expect(service.snapshot().values.every((tag) => tag.quality === "GOOD")).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("订阅立即得到快照，随后收到增量；取消订阅后不再接收事件", () => {
    service.onModuleInit();
    const kinds: string[] = [];
    const unsubscribe = service.subscribe((event) => kinds.push(event.kind));

    vi.advanceTimersByTime(1_000);
    expect(kinds).toEqual(["snapshot", "delta"]);

    unsubscribe();
    vi.advanceTimersByTime(2_000);
    expect(kinds).toEqual(["snapshot", "delta"]);
  });

  it("模拟中断将质量标记为 STALE，恢复后新序列号不能回退", () => {
    service.onModuleInit();
    vi.advanceTimersByTime(25_000);
    const stale = service.snapshot().values;

    expect(stale).toHaveLength(3);
    expect(stale.every((tag) => tag.quality === "STALE")).toBe(true);

    const staleSequences = new Map(stale.map((tag) => [tag.tagId, tag.sequence]));
    vi.advanceTimersByTime(5_000);
    expect(service.snapshot().values.every((tag) => tag.quality === "GOOD")).toBe(true);
    for (const tag of service.snapshot().values) {
      expect(tag.sequence).toBeGreaterThan(staleSequences.get(tag.tagId) ?? 0);
    }
  });

  it("服务关闭后释放模拟定时器，不再产生数据更新", () => {
    service.onModuleInit();
    const before = service.snapshot().values;
    service.onModuleDestroy();

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(3_000);
    expect(service.snapshot().values).toEqual(before);
  });
});
