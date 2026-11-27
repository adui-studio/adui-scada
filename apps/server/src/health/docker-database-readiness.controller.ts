import { Controller, Get, Header, Inject, NotFoundException, Req, ServiceUnavailableException } from "@nestjs/common";
import { Prisma8Service } from "../database/prisma8.service.js";

/** 仅常驻只读容器根模块注册；只允许容器自身回环请求，不暴露数据库身份。 */
@Controller("health")
export class DockerDatabaseReadinessController {
  constructor(@Inject(Prisma8Service) private readonly database: Prisma8Service) {}

  @Get("database")
  @Header("Cache-Control", "no-store")
  async check(@Req() request: { readonly socket: { readonly remoteAddress: string | undefined } }) {
    const address = request.socket.remoteAddress;
    if (address !== "127.0.0.1" && address !== "::ffff:127.0.0.1" && address !== "::1") {
      throw new NotFoundException("数据库就绪探针仅供容器内部使用");
    }
    try {
      if (this.database.writable) throw new Error("数据库就绪探针要求严格只读模式");
      // 正式事务边界在同一事务开始和结束时核验库、角色、集群、契约和只读状态。
      await this.database.readTransaction(() => Promise.resolve(undefined));
      return { status: "ok", mode: "docker-readonly" } as const;
    } catch {
      throw new ServiceUnavailableException("原生业务数据库只读连接未就绪");
    }
  }
}
