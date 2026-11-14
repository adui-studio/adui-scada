import "reflect-metadata";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { resolveOidcStartupConfig } from "./config/oidc-startup.config.js";
import { resolveServerStartupConfig } from "./config/server-startup.config.js";
import { allowLocalDemoTelemetry } from "./demo/local-demo-access.js";
import { getLocalOpenApiUrl, setupLocalOpenApi } from "./openapi/scada-openapi.js";
import { applyHttpSecurityHeaders } from "./security/http-security.js";
import { applyHttpServerPolicy, SCADA_NEST_HTTP_OPTIONS } from "./security/http-server-policy.js";

// 本地环境变量仅从仓库根目录 .env 读取，构建后的 dist/main.js 也使用同一路径。
// Docker 通过进程环境变量注入隔离容器网络的监听地址。
const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

async function bootstrap(): Promise<void> {
  // AppModule 在模块求值时会创建 Pino 配置，必须在 .env 加载后再导入。
  const { port, host, localDocs } = resolveServerStartupConfig(process.env);
  const oidc = resolveOidcStartupConfig(process.env);
  const allowDemo = allowLocalDemoTelemetry({
    enabled: process.env.SCADA_LOCAL_DEMO_API_ENABLED,
    nodeEnv: process.env.NODE_ENV,
    host,
  });
  if (oidc.enabled && allowDemo) {
    throw new Error("OIDC 身份接入与本机模拟 API 不能同时启用");
  }

  // 仅在 OIDC 完整配置通过校验后加载数据库与身份模块；默认根模块仍不连接数据库。
  const { AppModule, LocalDemoAppModule, OidcEnabledAppModule } =
    await import("./app.module.js");
  const rootModule = oidc.enabled
    ? OidcEnabledAppModule
    : allowDemo
      ? LocalDemoAppModule
      : AppModule;
  const app = await NestFactory.create(rootModule, SCADA_NEST_HTTP_OPTIONS);
  app.useLogger(app.get(Logger));
  applyHttpServerPolicy(app.getHttpServer());
  applyHttpSecurityHeaders(app, localDocs);
  await setupLocalOpenApi(app, localDocs);
  // NestJS 完成关闭钩子后以退出码 0 结束，便于容器判断正常 SIGTERM 关闭。
  app.enableShutdownHooks([], { useProcessExit: true });
  await app.listen(port, host);
  const swaggerUrl = getLocalOpenApiUrl(localDocs, port);
  if (swaggerUrl) {
    app.get(Logger).log(`Swagger 文档地址：${swaggerUrl}`);
  }
}

void bootstrap().catch((error: unknown) => {
  // 不输出连接串、启动参数或异常堆栈，避免数据库凭据被日志采集。
  const kind = error instanceof Error ? error.name : "未知异常";
  console.error("ADui SCADA 服务启动失败：" + kind);
  process.exitCode = 1;
});
