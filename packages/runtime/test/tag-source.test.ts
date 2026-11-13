import { afterEach, expect, test, vi } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "@adui/scada-core";
import { createSseTagSource } from "../src/tag-source.ts";
import type { DemoTagSourcePreset } from "../src/tag-source.ts";

class FakeEventSource {
  static readonly instances: FakeEventSource[] = [];
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private heartbeatHandler: (() => void) | null = null;
  closeCount = 0;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  emit(data: string): void {
    this.onmessage?.({ data } as MessageEvent<string>);
  }

  disconnect(): void {
    this.onerror?.({ type: "error" } as Event);
  }

  addEventListener(type: string, callback: () => void): void {
    if (type === "heartbeat") this.heartbeatHandler = callback;
  }

  emitHeartbeat(): void {
    this.heartbeatHandler?.();
  }

  close(): void {
    this.closeCount++;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeEventSource.instances.length = 0;
});

test("默认模拟数据源只请求原有同源演示路径，并使用无缓存模式", async () => {
  const fetched: Array<{ url: string; cache: RequestCache | undefined; signal?: AbortSignal }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    fetched.push({ url, cache: init?.cache, signal: init?.signal ?? undefined });
    return new Response(JSON.stringify(waterTreatmentDemoDocument), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  });
  vi.stubGlobal("EventSource", FakeEventSource);

  const source = createSseTagSource();
  const abort = new AbortController();
  const project = await source.loadProject(abort.signal);
  expect(project).toMatchObject({ projectId: "water-demo" });
  expect(fetched).toEqual([{ url: "/demo/project", cache: "no-store", signal: abort.signal }]);

  const messages: unknown[] = [];
  let disconnected = 0;
  const subscription = source.subscribe({
    onMessage: (raw) => messages.push(raw),
    onDisconnected: () => {
      disconnected++;
    },
  });
  const sse = FakeEventSource.instances[0]!;
  expect(sse.url).toBe("/demo/events");
  sse.emit('{"kind":"snapshot","values":[]}');
  sse.disconnect();
  expect(messages).toEqual(['{"kind":"snapshot","values":[]}']);
  expect(disconnected).toBe(1);
  subscription.close();
  expect(sse.closeCount).toBe(1);
});

test("NestJS 本机预设固定使用相同源的受控只读接口，不接受自定义地址", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(waterTreatmentDemoDocument), {
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("EventSource", FakeEventSource);

  const source = createSseTagSource("nest-local");
  const project = await source.loadProject(new AbortController().signal);
  expect(project).toMatchObject({ projectId: "water-demo" });
  expect(urls).toEqual(["/api/dev/demo/project"]);

  const events: unknown[] = [];
  let disconnects = 0;
  const subscription = source.subscribe({
    onMessage: (message) => events.push(message),
    onDisconnected: () => {
      disconnects++;
    },
  });
  expect(FakeEventSource.instances[0]?.url).toBe("/api/dev/demo/events");
  FakeEventSource.instances[0]?.emit('{"kind":"snapshot","values":[]}');
  FakeEventSource.instances[0]?.disconnect();
  expect(events).toHaveLength(1);
  expect(disconnects).toBe(1);
  subscription.close();

  expect(() => createSseTagSource("https://example.invalid/device" as DemoTagSourcePreset)).toThrow(
    /不支持的模拟 Tag 数据源预设/,
  );
});

test("工程 HTTP 状态异常或返回 HTML 时拒绝当作工程 JSON 处理", async () => {
  vi.stubGlobal("fetch", async () => new Response("拒绝访问", { status: 404 }));
  await expect(createSseTagSource().loadProject(new AbortController().signal)).rejects.toThrow(
    /读取模拟工程失败: HTTP 404/,
  );

  vi.stubGlobal(
    "fetch",
    async () => new Response("<html>错误代理</html>", { headers: { "content-type": "text/html" } }),
  );
  await expect(createSseTagSource().loadProject(new AbortController().signal)).rejects.toThrow(
    /模拟工程接口未返回 JSON/,
  );
});

test("工程请求保留调用者的 AbortSignal，不创建后台网络重试", async () => {
  let suppliedSignal: AbortSignal | undefined;
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    suppliedSignal = init?.signal ?? undefined;
    throw new DOMException("请求已取消", "AbortError");
  });
  const abort = new AbortController();
  abort.abort();

  await expect(createSseTagSource().loadProject(abort.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(suppliedSignal).toBe(abort.signal);
  expect(suppliedSignal?.aborted).toBe(true);
});

test("每 5 秒收到具名心跳会保活连接，但不会被转发为 Tag 更新", () => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", FakeEventSource);
  const data: unknown[] = [];
  const disconnected: number[] = [];
  const source = createSseTagSource();
  const connection = source.subscribe({
    onMessage: (raw) => data.push(raw),
    onDisconnected: () => disconnected.push(1),
  });

  try {
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(5000);
      FakeEventSource.instances[0]?.emitHeartbeat();
    }
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(disconnected).toHaveLength(0);
    expect(data).toHaveLength(0);
  } finally {
    connection.close();
  }
  expect(vi.getTimerCount()).toBe(0);
});

test("15 秒完全没有 SSE 活动时主动关闭旧流并建立新连接", () => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", FakeEventSource);
  const messages: unknown[] = [];
  const disconnected: number[] = [];
  const connection = createSseTagSource().subscribe({
    onMessage: (raw) => messages.push(raw),
    onDisconnected: () => disconnected.push(1),
  });

  try {
    const old = FakeEventSource.instances[0]!;
    vi.advanceTimersByTime(14_999);
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(disconnected).toHaveLength(1);
    expect(old.closeCount).toBe(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    old.emit('{"kind":"delta","values":[]}');
    FakeEventSource.instances[1]?.emit('{"kind":"snapshot","values":[]}');
    expect(messages).toEqual(['{"kind":"snapshot","values":[]}']);
  } finally {
    connection.close();
  }
  expect(vi.getTimerCount()).toBe(0);
});

test("SSE 网络报错沿用浏览器原生重连，超过静默阈值才强制重建", () => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", FakeEventSource);
  let disconnectCount = 0;
  const connection = createSseTagSource().subscribe({
    onMessage: () => {
      throw new Error("不应收到 Tag 消息");
    },
    onDisconnected: () => {
      disconnectCount++;
    },
  });

  try {
    FakeEventSource.instances[0]?.disconnect();
    expect(disconnectCount).toBe(1);
    vi.advanceTimersByTime(5000);
    FakeEventSource.instances[0]?.emitHeartbeat();
    vi.advanceTimersByTime(10_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  } finally {
    connection.close();
  }
  expect(vi.getTimerCount()).toBe(0);
});

test("主动关闭订阅后不再触发断连通知或后台重连", () => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", FakeEventSource);
  let disconnectCount = 0;
  const connection = createSseTagSource().subscribe({
    onMessage: () => {
      throw new Error("关闭后不得接收数据");
    },
    onDisconnected: () => {
      disconnectCount++;
    },
  });
  connection.close();

  FakeEventSource.instances[0]?.disconnect();
  FakeEventSource.instances[0]?.emitHeartbeat();
  vi.advanceTimersByTime(30_000);
  expect(FakeEventSource.instances).toHaveLength(1);
  expect(disconnectCount).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
