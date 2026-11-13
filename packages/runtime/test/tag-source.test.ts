import { afterEach, expect, test, vi } from "vite-plus/test";
import { waterTreatmentDemoDocument } from "@adui/scada-core";
import { createSseTagSource } from "../src/tag-source.ts";
import type { DemoTagSourcePreset } from "../src/tag-source.ts";

class FakeEventSource {
  static readonly instances: FakeEventSource[] = [];
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
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

  close(): void {
    this.closeCount++;
  }
}

afterEach(() => {
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
