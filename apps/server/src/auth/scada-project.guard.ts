import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../database/prisma.service.js";
import { hasProjectPermission } from "../projects/project-access-policy.js";
import type { ProjectAccessAction } from "../projects/project-access-policy.js";
import type { ScadaAuthenticatedRequest } from "./scada-session.guard.js";

export const SCADA_PROJECT_PERMISSION = "scada:project-permission";
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

/** 工程级 Guard 仅做前置 ACL 保护；事务仓储仍必须在行锁内再次复核授权。 */
@Injectable()
export class ScadaProjectGuard implements CanActivate {
  constructor(
    private readonly database: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") {
      throw new UnauthorizedException("工程权限仅支持受保护的 HTTP 请求");
    }
    const action = this.reflector.getAllAndOverride<ProjectAccessAction>(
      SCADA_PROJECT_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    // 缺失元数据时必须拒绝，而不是默认允许访问未声明权限的路由。
    if (!action) throw new NotFoundException("工程资源不存在或无权访问");
    const request = context.switchToHttp().getRequest<ScadaAuthenticatedRequest>();
    const principal = request.scadaPrincipal;
    if (!principal) throw new UnauthorizedException("尚未建立可信身份上下文");

    const projectId = request.params?.projectId;
    const routeTenant = request.params?.tenantId;
    if (
      typeof projectId !== "string" ||
      !PROJECT_ID_PATTERN.test(projectId) ||
      (routeTenant !== undefined && routeTenant !== principal.tenantId)
    ) {
      throw new NotFoundException("工程资源不存在或无权访问");
    }

    const grants = await this.database.client.scadaProjectGrant.findMany({
      where: {
        tenantId: principal.tenantId,
        projectId,
        subjectId: principal.subjectId,
      },
      select: { permission: true },
    });
    const allowed = hasProjectPermission(
      principal,
      { tenantId: principal.tenantId, projectId },
      {
        tenantId: principal.tenantId,
        projectId,
        subjectId: principal.subjectId,
        permissions: grants.map((grant) => grant.permission as ProjectAccessAction),
      },
      action,
    );
    if (!allowed) throw new NotFoundException("工程资源不存在或无权访问");
    return true;
  }
}
