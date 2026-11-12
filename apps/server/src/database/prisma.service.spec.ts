import { describe, expect, it } from "vite-plus/test";
import { PrismaService } from "./prisma.service.js";

describe("Prisma 数据库连接配置", () => {
  it("缺少数据库 URL 时拒绝构建数据库客户端", () => {
    const original = process.env.SCADA_DATABASE_URL;
    try {
      delete process.env.SCADA_DATABASE_URL;
      expect(() => new PrismaService()).toThrow("未配置 SCADA_DATABASE_URL，禁止建立数据库连接");
    } finally {
      if (original === undefined) delete process.env.SCADA_DATABASE_URL;
      else process.env.SCADA_DATABASE_URL = original;
    }
  });
});
