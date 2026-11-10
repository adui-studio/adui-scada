import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module.js";

describe("应用控制器（端到端）", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("GET /health 仅返回进程存活状态", async () => {
    const response = await request(app.getHttpServer()).get("/health").expect(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "adui-scada-server",
    });
  });

  it("未实现的工业设备写入接口返回 404", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/devices/write")
      .send({ value: 1 });
    expect(response.status).toBe(404);
  });
});
