import { NestFactory } from "@nestjs/core";
import { AppModule } from "./dist/app.module.js";
import { PrismaProjectVersionStore } from "./dist/projects/prisma-project-version-store.js";
import { AuthSessionService } from "./dist/auth/auth-session.service.js";
import { ScadaSessionGuard } from "./dist/auth/scada-session.guard.js";
import { ScadaProjectGuard } from "./dist/auth/scada-project.guard.js";
import { applyHttpSecurityHeaders } from "./dist/security/http-security.js";
import { applyHttpServerPolicy, SCADA_NEST_HTTP_OPTIONS } from "./dist/security/http-server-policy.js";
import { allowLocalOpenApi, setupLocalOpenApi } from "./dist/openapi/scada-openapi.js";

/** 本文件只用于隔离容器内部的服务端烟测，不是正式 HTTP 服务入口。 */
if (
  typeof AuthSessionService !== "function" ||
  typeof ScadaSessionGuard !== "function" ||
  typeof ScadaProjectGuard !== "function"
) {
  throw new Error("服务端容器无法加载新的可信身份与工程 Guard 模块");
}

if (typeof PrismaProjectVersionStore !== "function") {
  throw new Error("服务端容器未能加载事务仓储及其共享 Core 依赖");
}

const app = await NestFactory.create(AppModule, { ...SCADA_NEST_HTTP_OPTIONS, logger: false });
applyHttpServerPolicy(app.getHttpServer());
const docsEnabled = allowLocalOpenApi({
  enabled: "true",
  nodeEnv: "production",
  host: "0.0.0.0",
});
if (docsEnabled) {
  throw new Error("生产或非回环环境不应允许公开 Swagger");
}
applyHttpSecurityHeaders(app, false);
await setupLocalOpenApi(app, docsEnabled);
try {
  const httpServer = app.getHttpServer();
  if (
    httpServer.headersTimeout !== 15_000 ||
    httpServer.requestTimeout !== 60_000 ||
    httpServer.keepAliveTimeout !== 5_000 ||
    httpServer.maxHeadersCount !== 100 ||
    httpServer.maxRequestsPerSocket !== 1_000
  ) {
    throw new Error("服务端容器 HTTP 接收与连接限制未生效");
  }

  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  if (!address || typeof address !== "object") {
    throw new Error("服务端容器未能分配本机临时测试端口");
  }
  const base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/health`);
  const body = await health.json();
  if (
    health.headers.get("x-content-type-options") !== "nosniff" ||
    !health.headers.get("x-request-id")
  ) {
    throw new Error("服务端容器未启用必要安全响应头或请求关联 ID");
  }
  const readiness = await fetch(`${base}/health/ready`);
  const readinessBody = await readiness.json();
  if (
    readiness.status !== 200 ||
    readiness.headers.get("cache-control") !== "no-cache, no-store, must-revalidate" ||
    readinessBody.status !== "ok" ||
    readinessBody.details?.http?.status !== "up" ||
    readinessBody.details?.http?.dependencies !== "not_checked"
  ) {
    throw new Error("服务端容器 HTTP 就绪探针异常，且不能将其当作数据库或网关就绪");
  }

  const docs = await fetch(`${base}/api/docs-json`);
  if (docs.status !== 404) {
    throw new Error("服务端容器意外开放 Swagger JSON 文档");
  }
  if (health.status !== 200 || body.status !== "ok" || body.service !== "adui-scada-server") {
    throw new Error("服务端容器健康接口返回异常");
  }

  const project = await fetch(`${base}/api/projects/water-demo/versions`);
  if (project.status !== 404) {
    throw new Error("服务端容器意外开放工程版本读取接口");
  }
  const auth = await fetch(`${base}/api/auth/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"tenantId":"tenant-a","subjectId":"engineer-1"}',
  });
  if (auth.status !== 404) {
    throw new Error("服务端容器意外开放身份会话签发接口");
  }
  const device = await fetch(`${base}/api/devices/write`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"value":1}',
  });
  if (device.status !== 404) {
    throw new Error("服务端容器意外开放工业设备写入接口");
  }

  console.log("容器校验通过：HTTP 资源与关闭策略已加载、存活与就绪探针正常、工程及设备接口未开放");
} finally {
  await app.close();
}
