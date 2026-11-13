import { describe, expect, it } from "vite-plus/test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHttpLoggingOptions, resolveScadaLogLevel } from "./http-logging.config.js";

describe("服务端结构化 HTTP 日志", () => {
  it("日志等级使用安全白名单，无效输入回退 info", () => {
    expect(resolveScadaLogLevel("debug")).toBe("debug");
    expect(resolveScadaLogLevel("error")).toBe("error");
    expect(resolveScadaLogLevel("untrusted")).toBe("info");
    expect(resolveScadaLogLevel(undefined)).toBe("info");
  });

  it("每次请求由服务端签发随机请求 ID 并写入响应头", () => {
    const headers = new Map<string, string>();
    const response = {
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
    } as unknown as ServerResponse;
    const options = createHttpLoggingOptions();
    const first = options.genReqId({} as IncomingMessage, response);
    const second = options.genReqId({} as IncomingMessage, response);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    expect(second).not.toBe(first);
    expect(headers.get("x-request-id")).toBe(second);
  });

  it("日志请求序列化只保留方法和关联 ID，不记录 URL 查询与凭据", () => {
    const options = createHttpLoggingOptions();
    const logged = options.serializers.req({
      id: "request-1",
      method: "GET",
      url: "/health?token=never-log-this",
      headers: { authorization: "Bearer secret" },
      body: { password: "secret" },
    } as { id: string; method: string });
    expect(logged).toEqual({ id: "request-1", method: "GET" });
    expect(JSON.stringify(logged)).not.toContain("never-log-this");
    expect(JSON.stringify(logged)).not.toContain("secret");
    expect(options.serializers.res({ statusCode: 404 })).toEqual({ statusCode: 404 });
    expect(options.redact.paths).toContain("*.token");
    expect(options.redact.paths).toContain("*.password");
  });
});
