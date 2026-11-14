import { Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

/**
 * 统一持有 PrismaService 提供方。只有可信身份与工程模块被明确挂载时才实例化。
 * 两个业务模块复用同一个模块实例，避免独立创建数据库连接池。
 */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
