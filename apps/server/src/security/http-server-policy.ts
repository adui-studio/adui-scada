import type { Server } from "node:http";

/**
 * 使用 NestJS 12 原生关闭保护：收到关闭请求后拒绝新请求（503），
 * 不强制中断已经进入处理流程的请求。
 */
export const SCADA_NEST_HTTP_OPTIONS = {
  cors: false,
  bufferLogs: true,
  return503OnClosing: true,
} as const;

/**
 * 仅限制 HTTP 请求的接收阶段与连接复用，不设置应用响应超时。
 * 长期 SSE 响应不会因为 requestTimeout 被强制中断。
 */
export const SCADA_HTTP_INGRESS_LIMITS = {
  headersTimeout: 15_000,
  requestTimeout: 60_000,
  keepAliveTimeout: 5_000,
  maxHeadersCount: 100,
  maxRequestsPerSocket: 1_000,
} as const;

/** 配置 Node.js 原生 HTTP Server；必须在 app.listen() 前执行。 */
export function applyHttpServerPolicy(
  server: Pick<Server, keyof typeof SCADA_HTTP_INGRESS_LIMITS>,
): void {
  server.requestTimeout = SCADA_HTTP_INGRESS_LIMITS.requestTimeout;
  server.headersTimeout = SCADA_HTTP_INGRESS_LIMITS.headersTimeout;
  server.keepAliveTimeout = SCADA_HTTP_INGRESS_LIMITS.keepAliveTimeout;
  server.maxHeadersCount = SCADA_HTTP_INGRESS_LIMITS.maxHeadersCount;
  server.maxRequestsPerSocket = SCADA_HTTP_INGRESS_LIMITS.maxRequestsPerSocket;
}
