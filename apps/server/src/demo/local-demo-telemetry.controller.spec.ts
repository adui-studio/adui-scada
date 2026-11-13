import { expect, test, vi } from "vite-plus/test";
import type { TagChange, TagListener } from "@adui/scada-core";
import { LocalDemoTelemetryController } from "./local-demo-telemetry.controller.js";
import type { LocalDemoTelemetryService } from "./local-demo-telemetry.service.js";

test("NestJS 本机 SSE 发送具名心跳且取消订阅后清理心跳与 Tag 监听", () => {
  vi.useFakeTimers();
  const release = vi.fn();
  const current = { listener: undefined as TagListener | undefined };
  const telemetry = {
    subscribe(listener: TagListener) {
      current.listener = listener;
      listener({ kind: "snapshot", values: [] });
      return release;
    },
  } as unknown as LocalDemoTelemetryService;
  const messages: Array<{ type?: string; data: unknown }> = [];
  const subscription = new LocalDemoTelemetryController(telemetry)
    .events()
    .subscribe((event) => messages.push(event));

  try {
    expect(messages).toEqual([{ data: { kind: "snapshot", values: [] } }]);
    vi.advanceTimersByTime(5_000);
    expect(messages.at(-1)).toEqual({ type: "heartbeat", data: {} });
    expect(current.listener).toBeDefined();
    current.listener?.({ kind: "delta", values: [] } satisfies TagChange);
    expect(messages.at(-1)).toEqual({ data: { kind: "delta", values: [] } });

    vi.advanceTimersByTime(5_000);
    expect(messages.filter((event) => event.type === "heartbeat")).toHaveLength(2);
    subscription.unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    subscription.unsubscribe();
    vi.useRealTimers();
  }
  expect(release).toHaveBeenCalledOnce();
});
