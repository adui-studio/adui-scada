import { Injectable } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

/**
 * 仅在受控持久化模块被明确导入时建立 Prisma Client。
 * 当前 AppModule 未导入该模块，不依赖数据库即可提供进程健康检查。
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;

  constructor() {
    const connectionString = process.env.SCADA_DATABASE_URL;
    if (!connectionString) {
      throw new Error("未配置 SCADA_DATABASE_URL，禁止建立数据库连接");
    }
    this.client = new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
