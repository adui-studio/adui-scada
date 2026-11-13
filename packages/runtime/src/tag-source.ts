/**
 * 只读 Tag 数据源契约：工程快照与实时事件传输分离。
 * 原始事件统一由 Runtime 的 Core TagStore 校验，适配器不可信任网络载荷。
 * 本接口不包含设备写入、认证代签、PLC 地址或生产网关直连能力。
 */
export interface ReadonlyTagSource {
  loadProject(signal: AbortSignal): Promise<unknown>;
  subscribe(handlers: ReadonlyTagSourceHandlers): ReadonlyTagSubscription;
}

export interface ReadonlyTagSourceHandlers {
  onMessage(raw: unknown): void;
  onDisconnected(): void;
}

export interface ReadonlyTagSubscription {
  close(): void;
}

/** 当前仅认可两个同源的本机模拟接口预设，不接受任意外部 URL。 */
export type DemoTagSourcePreset = "standalone" | "nest-local";

const DEMO_ROUTES = {
  standalone: { project: "/demo/project", events: "/demo/events" },
  "nest-local": { project: "/api/dev/demo/project", events: "/api/dev/demo/events" },
} as const;

/**
 * 创建同源只读 SSE 数据源。
 * nest-local 路由受 NestJS 自身非生产、回环监听及显式开关保护；
 * 本适配器不会解除这些限制，也不会更改现有 Vue/React 代理配置。
 */
export function createSseTagSource(preset: DemoTagSourcePreset = "standalone"): ReadonlyTagSource {
  if (preset !== "standalone" && preset !== "nest-local") {
    throw new TypeError("不支持的模拟 Tag 数据源预设");
  }
  const routes = DEMO_ROUTES[preset];

  return {
    async loadProject(signal: AbortSignal): Promise<unknown> {
      const response = await fetch(routes.project, { cache: "no-store", signal });
      if (!response.ok) {
        throw new Error("读取模拟工程失败: HTTP " + response.status);
      }
      if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        throw new Error("模拟工程接口未返回 JSON；请启动模拟服务或使用桌面离线模拟构建");
      }
      return response.json() as Promise<unknown>;
    },

    subscribe(handlers: ReadonlyTagSourceHandlers): ReadonlyTagSubscription {
      const stream = new EventSource(routes.events);
      stream.onmessage = (event) => {
        handlers.onMessage(event.data);
      };
      stream.onerror = () => {
        handlers.onDisconnected();
      };
      return {
        close(): void {
          stream.close();
        },
      };
    },
  };
}
