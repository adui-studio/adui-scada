import "reflect-metadata";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { allowLocalOpenApi, setupLocalOpenApi } from "./openapi/scada-openapi.js";
import { applyHttpSecurityHeaders } from "./security/http-security.js";
import { AppModule } from "./app.module.js";

// 本地环境变量仅从仓库根目录 .env 读取，构建后的 dist/main.js 也使用同一路径。
// Docker 通过进程环境变量注入隔离容器网络的监听地址。
const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

async function bootstrap(): Promise<void> {
  const rawPort = process.env.SCADA_SERVER_PORT ?? process.env.PORT;
  const port = rawPort === undefined ? 3001 : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SCADA_SERVER_PORT 必须是 1～65535 之间的整数");
  }
  // 默认仅监听本机回环地址；Docker 演示容器可显式监听容器内部网络。
  // 当前服务不是生产 API，未完成认证授权前禁止对外公开。
  const host = process.env.SCADA_SERVER_HOST ?? process.env.HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "0.0.0.0") {
    throw new Error("SCADA_SERVER_HOST 只能设置为 127.0.0.1 或 0.0.0.0");
  }
  const localDocs = allowLocalOpenApi({
    enabled: process.env.SCADA_API_DOCS_ENABLED,
    nodeEnv: process.env.NODE_ENV,
    host,
  });
  const app = await NestFactory.create(AppModule, { cors: false, bufferLogs: true });
  app.useLogger(app.get(Logger));
  applyHttpSecurityHeaders(app, localDocs);
  await setupLocalOpenApi(app, localDocs);
  app.enableShutdownHooks();
  await app.listen(port, host);
}

void bootstrap().catch((error: unknown) => {
  // 不输出连接串、启动参数或异常堆栈，避免数据库凭据被日志采集。
  const kind = error instanceof Error ? error.name : "未知异常";
  console.error("ADui SCADA 服务启动失败：" + kind);
  process.exitCode = 1;
});
