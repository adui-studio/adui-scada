import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { DockerReadOnlyDatabaseAppModule } from "../src/app.module.js";
import { PRISMA8_RUNTIME_CONFIG, Prisma8Service } from "../src/database/prisma8.service.js";
import { DockerDatabaseReadinessController } from "../src/health/docker-database-readiness.controller.js";

describe("常驻容器原生只读数据库就绪（端到端）", () => {
  let app: INestApplication;
  const readTransaction = vi.fn<() => Promise<void>>();
  const database = { writable: false, readTransaction };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DockerReadOnlyDatabaseAppModule] })
      .overrideProvider(PRISMA8_RUNTIME_CONFIG)
      .useValue({ connectionString: undefined, readOnly: true })
      .overrideProvider(Prisma8Service)
      .useValue(database)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    database.writable = false;
    readTransaction.mockReset().mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("回环数据库探针每次复核正式只读事务并仅返回固定标志", async () => {
    const response = await request(app.getHttpServer()).get("/health/database").expect(200);
    expect(response.body).toEqual({ status: "ok", mode: "docker-readonly" });
    expect(response.headers["cache-control"]).toBe("no-store");
    await request(app.getHttpServer()).get("/health/database").expect(200);
    expect(readTransaction).toHaveBeenCalledTimes(2);
  });

  it("事务异常时固定返回 503 并隐藏数据库错误原文", async () => {
    readTransaction.mockRejectedValueOnce(new Error("禁止回显的数据库异常"));
    const response = await request(app.getHttpServer()).get("/health/database").expect(503);
    expect(response.body.message).toBe("原生业务数据库只读连接未就绪");
    expect(JSON.stringify(response.body)).not.toContain("禁止回显的数据库异常");
  });

  it("非回环请求拒绝进入数据库事务", async () => {
    const controller = app.get(DockerDatabaseReadinessController);
    await expect(controller.check({ socket: { remoteAddress: "172.18.0.2" } })).rejects.toThrow(
      "数据库就绪探针仅供容器内部使用",
    );
    expect(readTransaction).not.toHaveBeenCalled();
  });

  it("可写提供方不得冒充严格只读就绪", async () => {
    database.writable = true;
    await request(app.getHttpServer()).get("/health/database").expect(503);
    expect(readTransaction).not.toHaveBeenCalled();
  });

  it("进程存活契约不变且不注册身份、工程或本机模拟接口", async () => {
    const live = await request(app.getHttpServer()).get("/health").expect(200);
    expect(live.body).toEqual({ status: "ok", service: "adui-scada-server" });
    for (const route of [
      "/api/v1/auth/oidc/start",
      "/api/v1/auth/me",
      "/api/v1/projects",
      "/api/dev/demo/project",
    ]) {
      await request(app.getHttpServer()).get(route).expect(404);
    }
    await request(app.getHttpServer()).post("/api/v1/auth/logout").expect(404);
    await request(app.getHttpServer()).post("/api/v1/projects").send({}).expect(404);
    expect(readTransaction).not.toHaveBeenCalled();
  });
});
