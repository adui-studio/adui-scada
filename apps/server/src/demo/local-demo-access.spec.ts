import { describe, expect, it } from "vite-plus/test";
import { allowLocalDemoTelemetry } from "./local-demo-access.js";

describe("本机只读模拟接口启用策略", () => {
  const local = {
    enabled: "true",
    nodeEnv: "development",
    host: "127.0.0.1",
  } as const;

  it("只有显式开启的非生产回环监听才允许注册模拟路由", () => {
    expect(allowLocalDemoTelemetry(local)).toBe(true);
  });

  it("默认关闭，且拒绝生产、全网监听与非严格布尔开关", () => {
    expect(allowLocalDemoTelemetry({ ...local, enabled: undefined })).toBe(false);
    expect(allowLocalDemoTelemetry({ ...local, enabled: "false" })).toBe(false);
    expect(allowLocalDemoTelemetry({ ...local, enabled: "TRUE" })).toBe(false);
    expect(allowLocalDemoTelemetry({ ...local, nodeEnv: "production" })).toBe(false);
    expect(allowLocalDemoTelemetry({ ...local, host: "0.0.0.0" })).toBe(false);
  });
});
