import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const SCADA_LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type ScadaLogLevel = (typeof SCADA_LOG_LEVELS)[number];

/** 拒绝任意外部等级，避免错误配置改变生产日志策略。 */
export function resolveScadaLogLevel(value: string | undefined): ScadaLogLevel {
  return SCADA_LOG_LEVELS.find((item) => item === value) ?? "info";
}

/**
 * 日志只记录请求 ID、方法与响应状态；绝不序列化 HTTP 头、URL 查询、请求体。
 * 即使未来其他日志调用带入敏感对象，依然通过 Pino redact 进行第二层脱敏。
 */
export function createHttpLoggingOptions() {
  return {
    level: resolveScadaLogLevel(process.env.SCADA_LOG_LEVEL),
    genReqId(_req: IncomingMessage, res: ServerResponse): string {
      const requestId = randomUUID();
      res.setHeader("x-request-id", requestId);
      return requestId;
    },
    serializers: {
      req(req: { id?: string | number; method?: string }) {
        return { id: req.id, method: req.method };
      },
      res(res: { statusCode?: number }) {
        return { statusCode: res.statusCode };
      },
    },
    redact: {
      paths: [
        "req.headers",
        "req.body",
        "res.headers",
        "res.body",
        "*.authorization",
        "*.cookie",
        "*.password",
        "*.token",
        "*.secret",
        "*.apiKey",
      ],
      censor: "[已脱敏]",
    },
    customSuccessMessage: () => "HTTP 请求完成",
    customErrorMessage: () => "HTTP 请求失败",
  };
}
