import { createServer } from "node:http";
import { describe, expect, it } from "vite-plus/test";
import {
  applyHttpServerPolicy,
  SCADA_HTTP_INGRESS_LIMITS,
  SCADA_NEST_HTTP_OPTIONS,
} from "./http-server-policy.js";

describe("服务端 HTTP 连接与关闭安全策略", () => {
  it("请求接收超时与 HTTP 头数量均有明确的有限上限", () => {
    const server = createServer();
    applyHttpServerPolicy(server);

    expect(server.headersTimeout).toBe(15_000);
    expect(server.requestTimeout).toBe(60_000);
    expect(server.maxHeadersCount).toBe(100);
    expect(server.headersTimeout).toBeLessThan(server.requestTimeout);
  });

  it("限制长连接请求次数，但不设置 SSE 等响应的统一超时", () => {
    const server = createServer();
    const previousResponseTimeout = server.timeout;
    applyHttpServerPolicy(server);

    expect(server.keepAliveTimeout).toBe(5_000);
    expect(server.maxRequestsPerSocket).toBe(1_000);
    expect(server.timeout).toBe(previousResponseTimeout);
  });

  it("策略可重复应用，关闭时必须拒绝新请求而不强制销毁已有连接", () => {
    const server = createServer();
    applyHttpServerPolicy(server);
    server.headersTimeout = 0;
    server.maxHeadersCount = 0;
    applyHttpServerPolicy(server);

    expect(server.headersTimeout).toBe(SCADA_HTTP_INGRESS_LIMITS.headersTimeout);
    expect(server.maxHeadersCount).toBe(SCADA_HTTP_INGRESS_LIMITS.maxHeadersCount);
    expect(SCADA_NEST_HTTP_OPTIONS).toEqual({
      cors: false,
      bufferLogs: true,
      return503OnClosing: true,
    });
    expect("forceCloseConnections" in SCADA_NEST_HTTP_OPTIONS).toBe(false);
  });
});
