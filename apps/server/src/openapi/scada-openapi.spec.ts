import { describe, expect, it } from "vite-plus/test";
import {
  allowLocalOpenApi,
  getLocalOpenApiUrl,
  LOCAL_OPENAPI_PATH,
} from "./scada-openapi.js";

describe("Swagger 本机访问策略", () => {
  it("默认或未显式开启时不注册文档", () => {
    expect(
      allowLocalOpenApi({
        enabled: undefined,
        nodeEnv: "development",
        host: "127.0.0.1",
      }),
    ).toBe(false);
    expect(
      allowLocalOpenApi({
        enabled: "false",
        nodeEnv: "development",
        host: "127.0.0.1",
      }),
    ).toBe(false);
  });

  it("只有非生产且绑定本机回环才能显式开启", () => {
    expect(
      allowLocalOpenApi({
        enabled: "true",
        nodeEnv: "development",
        host: "127.0.0.1",
      }),
    ).toBe(true);
    expect(
      allowLocalOpenApi({
        enabled: "true",
        nodeEnv: "production",
        host: "127.0.0.1",
      }),
    ).toBe(false);
    expect(
      allowLocalOpenApi({
        enabled: "true",
        nodeEnv: "development",
        host: "0.0.0.0",
      }),
    ).toBe(false);
    expect(
      allowLocalOpenApi({
        enabled: "TRUE",
        nodeEnv: "development",
        host: "127.0.0.1",
      }),
    ).toBe(false);
  });

  it("文档启用后生成与实际路由一致的本机地址，支持自定义端口", () => {
    expect(LOCAL_OPENAPI_PATH).toBe("api/docs");
    expect(getLocalOpenApiUrl(true, 3001)).toBe("http://127.0.0.1:3001/api/docs");
    expect(getLocalOpenApiUrl(true, 13001)).toBe("http://127.0.0.1:13001/api/docs");
  });

  it("文档未启用时不生成可记录的 Swagger 地址", () => {
    expect(getLocalOpenApiUrl(false, 3001)).toBeUndefined();
    expect(getLocalOpenApiUrl(false, 13001)).toBeUndefined();
  });

});
