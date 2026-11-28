import "reflect-metadata";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "nestjs-pino";
import { resolveOidcStartupConfig } from "./config/oidc-startup.config.js";
import { resolveServerStartupConfig } from "./config/server-startup.config.js";
import { resolveDockerReadOnlyMode } from "./database/docker-readonly-config.js";
import { allowLocalDemoTelemetry } from "./demo/local-demo-access.js";
import { getLocalOpenApiUrl, setupLocalOpenApi } from "./openapi/scada-openapi.js";
import { applyHttpSecurityHeaders } from "./security/http-security.js";
import {
  applyHttpServerPolicy,
  SCADA_HTTP_BODY_LIMIT_BYTES,
  SCADA_NEST_HTTP_OPTIONS,
} from "./security/http-server-policy.js";

// 本地环境变量仅从仓库根目录 .env 读取，构建后的 dist/main.js 也使用同一路径。
// Docker 通过进程环境变量注入隔离容器网络的监听地址。
const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

async function bootstrap(): Promise<void> {
  // AppModule 在模块求值时会创建 Pino 配置，必须在 .env 加载后再导入。
  const { port, host, localDocs } = resolveServerStartupConfig(process.env);
  const oidc = resolveOidcStartupConfig(process.env);
  const dockerReadOnly = resolveDockerReadOnlyMode(process.env);
  const allowDemo = allowLocalDemoTelemetry({
    enabled: process.env.SCADA_LOCAL_DEMO_API_ENABLED,
    nodeEnv: process.env.NODE_ENV,
    host,
  });
  if (oidc.enabled && allowDemo) {
    throw new Error("OIDC 身份接入与本机模拟 API 不能同时启用");
  }

  // 常驻容器只读模式仅装配原生数据库；身份与工程 API 仍须独立启用 OIDC。
  const { AppModule, LocalDemoAppModule, OidcEnabledAppModule, DockerReadOnlyDatabaseAppModule } =
    await import("./app.module.js");
  const rootModule = dockerReadOnly
    ? DockerReadOnlyDatabaseAppModule
    : oidc.enabled
      ? OidcEnabledAppModule
      : allowDemo
        ? LocalDemoAppModule
        : AppModule;
  // 关闭默认 100 KiB 解析器，显式将 JSON 与表单请求体限制为 Core 的 2 MiB 上限。
  const app = await NestFactory.create<NestExpressApplication>(rootModule, {
    ...SCADA_NEST_HTTP_OPTIONS,
    bodyParser: false,
  });
  app.useBodyParser("json", { limit: SCADA_HTTP_BODY_LIMIT_BYTES });
  app.useBodyParser("urlencoded", {
    limit: SCADA_HTTP_BODY_LIMIT_BYTES,
    extended: true,
  });
  app.useLogger(app.get(Logger));
  applyHttpServerPolicy(app.getHttpServer());
  applyHttpSecurityHeaders(app, localDocs);
  await setupLocalOpenApi(app, localDocs);
  // NestJS 完成关闭钩子后以退出码 0 结束，便于容器判断正常 SIGTERM 关闭。
  app.enableShutdownHooks([], { useProcessExit: true });
  try {
    await app.listen(port, host);
  } catch (error) {
    if (dockerReadOnly) {
      try {
        await app.close();
      } catch {
        throw new Error("Docker 正式只读服务启动及资源关闭失败");
      }
    }
    throw error;
  }
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
