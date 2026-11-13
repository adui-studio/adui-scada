import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { Controller, Get, Post } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { Test } from "@nestjs/testing";
import { ZBody, ZQuery, ZSerialize } from "nest-zod/swagger";
import request from "supertest";
import { z } from "zod";

/** 测试专用路由，不进入正式 AppModule，也不访问数据库或工业网关。 */
const writeSchema = z.strictObject({
  title: z.string().trim().min(1).max(32),
});
const responseSchema = z.object({
  title: z.string(),
});
const queryResponseSchema = z.object({
  page: z.number().int().positive(),
});

@Controller("_validation-test")
class ValidationTestController {
  @Post("normalize")
  @ZSerialize(responseSchema)
  normalize(@ZBody(writeSchema) body: z.infer<typeof writeSchema>) {
    return { title: body.title, internalToken: "禁止出现在响应中" };
  }

  @Get("page")
  @ZSerialize(queryResponseSchema)
  getPage(@ZQuery("page", z.coerce.number().int().positive()) page: number) {
    return { page };
  }
}

describe("NestJS 12 与 nest-zod 运行时集成", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ValidationTestController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("验证并规范化请求体，响应序列化移除非白名单字段", async () => {
    const response = await request(app.getHttpServer())
      .post("/_validation-test/normalize")
      .send({ title: "  水处理  " })
      .expect(201);
    expect(response.body).toEqual({ title: "水处理" });
    expect(JSON.stringify(response.body)).not.toContain("internalToken");
  });

  it("拒绝非法请求体，不调用业务写入逻辑", async () => {
    const response = await request(app.getHttpServer())
      .post("/_validation-test/normalize")
      .send({ title: "" })
      .expect(400);
    expect(response.body.statusCode).toBe(400);
  });

  it("查询参数按 Zod Schema 转换，拒绝非正整数", async () => {
    const allowed = await request(app.getHttpServer())
      .get("/_validation-test/page?page=2")
      .expect(200);
    expect(allowed.body).toEqual({ page: 2 });
    const denied = await request(app.getHttpServer())
      .get("/_validation-test/page?page=0")
      .expect(400);
    expect(denied.body.statusCode).toBe(400);
  });

  it("OpenAPI 文档包含测试路由的输入与输出元数据", () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("受控测试文档").setVersion("0.3").build(),
    );
    expect(doc.paths["/_validation-test/normalize"]?.post).toBeDefined();
    expect(doc.paths["/_validation-test/page"]?.get).toBeDefined();
  });
});
