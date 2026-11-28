import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  AuthorizationReadStore,
  copyAuthorizationPrincipal,
  isAuthorizationIdentifier,
} from "./authorization-read-store.js";
import { hasProjectPermission } from "../projects/project-access-policy.js";
import type { ProjectAccessAction } from "../projects/project-access-policy.js";
import { ScadaSecurityAuditService } from "../security/scada-security-audit.js";
import type { SecurityAuditReporter } from "../security/scada-security-audit.js";
import type { ScadaAuthenticatedRequest } from "./scada-session.guard.js";

export const SCADA_PROJECT_PERMISSION = "scada:project-permission";

/** 工程级 Guard 仅做前置 ACL 保护；事务仓储仍必须在行锁内再次复核授权。 */
@Injectable()
export class ScadaProjectGuard implements CanActivate {
  constructor(
    @Inject(AuthorizationReadStore) private readonly authorization: AuthorizationReadStore,
    private readonly reflector: Reflector,
    @Inject(ScadaSecurityAuditService) private readonly audit: SecurityAuditReporter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") {
      this.audit.record({
        action: "project.authorize",
        outcome: "denied",
        reason: "unsupported_context",
      });
      throw new UnauthorizedException("工程权限仅支持受保护的 HTTP 请求");
    }
    const action = this.reflector.getAllAndOverride<ProjectAccessAction>(SCADA_PROJECT_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    // 缺失元数据时必须拒绝，而不是默认允许访问未声明权限的路由。
    if (!action) {
      this.audit.record({
        action: "project.authorize",
        outcome: "denied",
        reason: "missing_policy",
      });
      throw new NotFoundException("工程资源不存在或无权访问");
    }
    const request = context.switchToHttp().getRequest<ScadaAuthenticatedRequest>();
    const verified = request.scadaPrincipal;
    if (!verified) {
      this.audit.record({
        action: "project.authorize",
        outcome: "denied",
        reason: "missing_principal",
      });
      throw new UnauthorizedException("尚未建立可信身份上下文");
    }

    const principal = copyAuthorizationPrincipal(verified.tenantId, verified.subjectId);
    if (!principal) {
      this.audit.record({
        action: "project.authorize",
        outcome: "denied",
        reason: "permission_denied",
      });
      throw new NotFoundException("工程资源不存在或无权访问");
    }
    const projectId = request.params?.projectId;
    const routeTenant = request.params?.tenantId;
    if (
      !isAuthorizationIdentifier(projectId) ||
      (routeTenant !== undefined && routeTenant !== principal.tenantId)
    ) {
      this.audit.record({
        action: "project.authorize",
        outcome: "denied",
        reason: "invalid_scope",
      });
      throw new NotFoundException("工程资源不存在或无权访问");
    }

    let grants: readonly { readonly permission: string }[];
    try {
      grants = await this.authorization.readProjectGrants(principal, projectId);
    } catch {
      throw new ServiceUnavailableException("工程权限查询暂不可用，请稍后重试");
    }
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
    if (!allowed) {
      this.audit.record({
        action: "project.authorize",
        outcome: "denied",
        reason: "permission_denied",
      });
      throw new NotFoundException("工程资源不存在或无权访问");
    }
    this.audit.record({
      action: "project.authorize",
      outcome: "allowed",
      reason: "permission_granted",
    });
    return true;
  }
}
