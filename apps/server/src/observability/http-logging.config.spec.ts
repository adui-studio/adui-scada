import { describe, expect, it } from "vite-plus/test";
import pino from "pino";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createHttpLoggingOptions,
  resolveScadaLogLevel,
  shouldUsePrettyTransport,
} from "./http-logging.config.js";

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

  it("HTTP 失败日志不序列化原始异常消息、堆栈、原因和附加设备字段", () => {
    const options = createHttpLoggingOptions();
    const failure = {
      message: "测试用私密设备地址和访问令牌",
      stack: "测试用本机程序路径及调用堆栈",
      cause: { token: "测试用令牌" },
      password: "测试用密码",
    };
    const logged = options.serializers.err(failure);

    expect(logged).toEqual({ type: "HTTP_ERROR" });
    expect(JSON.stringify(logged)).not.toContain("测试用");
    expect(options.serializers.req({ id: "request-503", method: "POST" })).toEqual({
      id: "request-503",
      method: "POST",
    });
    expect(options.serializers.res({ statusCode: 503 })).toEqual({ statusCode: 503 });
  });

  it("异常对象的恶意属性访问器不得破坏 HTTP 失败日志脱敏", () => {
    const options = createHttpLoggingOptions();
    const untrusted = Object.defineProperty({}, "message", {
      enumerable: true,
      get() {
        throw new Error("测试用异常内部敏感信息");
      },
    });
    expect(() => options.serializers.err(untrusted)).not.toThrow();
    expect(options.serializers.err(untrusted)).toEqual({ type: "HTTP_ERROR" });
  });

  it("真实 Pino 失败日志保留请求关联信息而不包含原始异常与 URL", () => {
    const lines: string[] = [];
    const stream = {
      write(chunk: string) {
        lines.push(chunk);
      },
    };
    const logger = pino({ serializers: createHttpLoggingOptions().serializers }, stream);
    const sensitive = "测试用不应记录的内部错误正文";
    logger.error(
      {
        req: { id: "request-log-503", method: "POST", url: "/?token=private" },
        res: { statusCode: 503 },
        err: new Error(sensitive),
      },
      "HTTP 请求失败",
    );

    expect(lines).toHaveLength(1);
    const recorded = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(recorded).toMatchObject({
      req: { id: "request-log-503", method: "POST" },
      res: { statusCode: 503 },
      err: { type: "HTTP_ERROR" },
      msg: "HTTP 请求失败",
    });
    expect(JSON.stringify(recorded)).not.toContain(sensitive);
    expect(JSON.stringify(recorded)).not.toContain("stack");
    expect(JSON.stringify(recorded)).not.toContain("/?token=private");
  });

  it("开发交互式终端可美化日志，测试和生产均不得启动 Pretty 工作线程", () => {
    expect(
      shouldUsePrettyTransport({ nodeEnv: "development", isTty: true, isTestRunner: false }),
    ).toBe(true);
    expect(shouldUsePrettyTransport({ nodeEnv: "test", isTty: true, isTestRunner: false })).toBe(
      false,
    );
    expect(
      shouldUsePrettyTransport({ nodeEnv: "development", isTty: true, isTestRunner: true }),
    ).toBe(false);
    expect(
      shouldUsePrettyTransport({ nodeEnv: "production", isTty: true, isTestRunner: false }),
    ).toBe(false);
    expect(
      shouldUsePrettyTransport({ nodeEnv: undefined, isTty: false, isTestRunner: false }),
    ).toBe(false);
    expect(createHttpLoggingOptions()).not.toHaveProperty("transport");
  });
});
