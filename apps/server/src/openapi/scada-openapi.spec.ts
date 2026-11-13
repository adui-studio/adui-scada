import { describe, expect, it } from "vite-plus/test";
import { allowLocalOpenApi } from "./scada-openapi.js";

describe("Swagger 本机访问策略", () => {
  it("默认或未显式开启时不注册文档", () => {
    expect(allowLocalOpenApi({
      enabled: undefined,
      nodeEnv: "development",
      host: "127.0.0.1",
    })).toBe(false);
    expect(allowLocalOpenApi({
      enabled: "false",
      nodeEnv: "development",
      host: "127.0.0.1",
    })).toBe(false);
  });

  it("只有非生产且绑定本机回环才能显式开启", () => {
    expect(allowLocalOpenApi({
      enabled: "true",
      nodeEnv: "development",
      host: "127.0.0.1",
    })).toBe(true);
    expect(allowLocalOpenApi({
      enabled: "true",
      nodeEnv: "production",
      host: "127.0.0.1",
    })).toBe(false);
    expect(allowLocalOpenApi({
      enabled: "true",
      nodeEnv: "development",
      host: "0.0.0.0",
    })).toBe(false);
    expect(allowLocalOpenApi({
      enabled: "TRUE",
      nodeEnv: "development",
      host: "127.0.0.1",
    })).toBe(false);
  });
});
