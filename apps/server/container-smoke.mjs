import { NestFactory } from "@nestjs/core";
import { AppModule } from "./dist/app.module.js";
import { PrismaProjectVersionStore } from "./dist/projects/prisma-project-version-store.js";

/** 本文件只用于隔离容器内部的服务端烟测，不是正式 HTTP 服务入口。 */
if (typeof PrismaProjectVersionStore !== "function") {
  throw new Error("服务端容器未能加载事务仓储及其共享 Core 依赖");
}

const app = await NestFactory.create(AppModule, { logger: false });
try {
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  if (!address || typeof address !== "object") {
    throw new Error("服务端容器未能分配本机临时测试端口");
  }
  const base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/health`);
  const body = await health.json();
  if (health.status !== 200 || body.status !== "ok" || body.service !== "adui-scada-server") {
    throw new Error("服务端容器健康接口返回异常");
  }

  const project = await fetch(`${base}/api/projects/water-demo/versions`);
  if (project.status !== 404) {
    throw new Error("服务端容器意外开放工程版本读取接口");
  }
  const device = await fetch(`${base}/api/devices/write`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"value":1}',
  });
  if (device.status !== 404) {
    throw new Error("服务端容器意外开放工业设备写入接口");
  }

  console.log("容器校验通过：仓储依赖可加载、健康接口正常、工程及设备接口未开放");
} finally {
  await app.close();
}
