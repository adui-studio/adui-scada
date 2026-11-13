import { describe, expect, it } from "vite-plus/test";
import { resolveServerStartupConfig } from "./server-startup.config.js";

describe("服务端启动配置", () => {
  it("无环境配置时仅监听本地地址且默认关闭文档", () => {
    expect(resolveServerStartupConfig({})).toEqual({
      host: "127.0.0.1",
      port: 3001,
      localDocs: false,
    });
  });

  it("专用端口和监听地址优先于通用环境变量", () => {
    expect(
      resolveServerStartupConfig({
        PORT: "3002",
        HOST: "0.0.0.0",
        SCADA_SERVER_PORT: "13001",
        SCADA_SERVER_HOST: "127.0.0.1",
      }),
    ).toMatchObject({ port: 13001, host: "127.0.0.1" });

    expect(
      resolveServerStartupConfig({
        PORT: "3002",
        HOST: "0.0.0.0",
      }),
    ).toMatchObject({ port: 3002, host: "0.0.0.0" });
  });

  it("拒绝无效端口和越界值，不暴露原始配置内容", () => {
    for (const value of ["0", "-1", "65536", "3000.5", "无效端口", ""]) {
      expect(() => resolveServerStartupConfig({ SCADA_SERVER_PORT: value })).toThrow(
        "SCADA_SERVER_PORT 必须是 1～65535 之间的整数",
      );
    }
    expect(resolveServerStartupConfig({ SCADA_SERVER_PORT: "65535" }).port).toBe(65535);
  });

  it("不接受未经允许的监听地址", () => {
    for (const value of ["localhost", "::", "192.168.1.100", ""]) {
      expect(() => resolveServerStartupConfig({ SCADA_SERVER_HOST: value })).toThrow(
        "SCADA_SERVER_HOST 只能设置为 127.0.0.1 或 0.0.0.0",
      );
    }
    for (const value of [null, true, {}, []]) {
      const env = { SCADA_SERVER_HOST: value } as unknown as Record<string, string | undefined>;
      expect(() => resolveServerStartupConfig(env)).toThrow(
        "SCADA_SERVER_HOST 只能设置为 127.0.0.1 或 0.0.0.0",
      );
    }
  });

  it("Swagger 仅在显式启用、非生产且绑定本机时开放", () => {
    const enabled = {
      SCADA_API_DOCS_ENABLED: "true",
      NODE_ENV: "development",
      SCADA_SERVER_HOST: "127.0.0.1",
    };
    expect(resolveServerStartupConfig(enabled).localDocs).toBe(true);
    expect(resolveServerStartupConfig({ ...enabled, NODE_ENV: "production" }).localDocs).toBe(
      false,
    );
    expect(resolveServerStartupConfig({ ...enabled, SCADA_SERVER_HOST: "0.0.0.0" }).localDocs).toBe(
      false,
    );
    expect(
      resolveServerStartupConfig({ ...enabled, SCADA_API_DOCS_ENABLED: "TRUE" }).localDocs,
    ).toBe(false);
  });

  it("拒绝非有限数、越界端口和伪造字符串，错误信息不暴露输入", () => {
    const secret = "Bearer-private-token";
    for (const value of ["Infinity", "NaN", "1e309", " ", "0", "65536", secret]) {
      expect(() => resolveServerStartupConfig({ SCADA_SERVER_PORT: value })).toThrow(
        "SCADA_SERVER_PORT 必须是 1～65535 之间的整数",
      );
    }
    let errorMessage: string | undefined;
    try {
      resolveServerStartupConfig({ SCADA_SERVER_PORT: secret });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : undefined;
    }
    expect(errorMessage).toBe("SCADA_SERVER_PORT 必须是 1～65535 之间的整数");
    expect(errorMessage).not.toContain(secret);
    for (const value of [true, null, {}, []]) {
      const env = { SCADA_SERVER_PORT: value } as unknown as Record<string, string | undefined>;
      expect(() => resolveServerStartupConfig(env)).toThrow(
        "SCADA_SERVER_PORT 必须是 1～65535 之间的整数",
      );
    }
  });

  it("专用配置无效时不得回退到通用 PORT 或 HOST", () => {
    expect(() =>
      resolveServerStartupConfig({
        PORT: "13001",
        SCADA_SERVER_PORT: "无效端口",
      }),
    ).toThrow("SCADA_SERVER_PORT 必须是 1～65535 之间的整数");

    expect(() =>
      resolveServerStartupConfig({
        HOST: "127.0.0.1",
        SCADA_SERVER_HOST: "外部地址",
      }),
    ).toThrow("SCADA_SERVER_HOST 只能设置为 127.0.0.1 或 0.0.0.0");
  });

  it("只输出启动配置白名单字段，不复制未知环境变量", () => {
    const env = Object.freeze({
      SCADA_SERVER_PORT: "13001",
      SCADA_SERVER_HOST: "127.0.0.1",
      SCADA_API_DOCS_ENABLED: "false",
      SCADA_DATABASE_URL: "postgresql://敏感数据",
      AUTHORIZATION: "Bearer-private-token",
    });
    const result = resolveServerStartupConfig(env);
    expect(result).toEqual({ port: 13001, host: "127.0.0.1", localDocs: false });
    expect(Object.keys(result).sort()).toEqual(["host", "localDocs", "port"]);
    expect(JSON.stringify(result)).not.toContain("敏感数据");
    expect(JSON.stringify(result)).not.toContain("Bearer-private-token");
  });

  it("接受原有 Number 可识别的数字表示，不扩大环境变量格式", () => {
    expect(resolveServerStartupConfig({ SCADA_SERVER_PORT: "1e3" }).port).toBe(1000);
    expect(resolveServerStartupConfig({ SCADA_SERVER_PORT: "65535" }).port).toBe(65535);
  });
});
