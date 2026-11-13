import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { AuthenticatedProjectPrincipal } from "../projects/project-access-policy.js";
import { ScadaSecurityAuditService } from "../security/scada-security-audit.js";
import type { SecurityAuditReporter } from "../security/scada-security-audit.js";
import { AuthSessionService } from "./auth-session.service.js";

export interface ScadaAuthenticatedRequest {
  readonly headers: { readonly authorization?: string | string[] };
  readonly params?: Record<string, unknown>;
  scadaPrincipal?: AuthenticatedProjectPrincipal;
}

/**
 * 只验证服务端可信会话。拒绝事件只使用固定原因码，不传递 Bearer 或请求对象。
 * 本 Guard 尚未挂载正式 AppModule，不对外开放认证与业务接口。
 */
@Injectable()
export class ScadaSessionGuard implements CanActivate {
  constructor(
    private readonly sessions: AuthSessionService,
    @Inject(ScadaSecurityAuditService) private readonly audit: SecurityAuditReporter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") {
      this.audit.record({
        action: "session.authenticate",
        outcome: "denied",
        reason: "unsupported_context",
      });
      throw new UnauthorizedException("暂不接受非 HTTP 类型的身份凭据");
    }

    const request = context.switchToHttp().getRequest<ScadaAuthenticatedRequest>();
    const header = request.headers.authorization;
    if (
      typeof header !== "string" ||
      header.length > 128 ||
      !/^Bearer (scada_s_[A-Za-z0-9_-]{43})$/i.test(header)
    ) {
      this.audit.record({
        action: "session.authenticate",
        outcome: "denied",
        reason: "malformed_authorization",
      });
      throw new UnauthorizedException("缺少有效的身份凭据");
    }

    const match = /^Bearer (scada_s_[A-Za-z0-9_-]{43})$/i.exec(header);
    if (!match) {
      this.audit.record({
        action: "session.authenticate",
        outcome: "denied",
        reason: "malformed_authorization",
      });
      throw new UnauthorizedException("缺少有效的身份凭据");
    }

    const principal = await this.sessions.authenticate(match[1]);
    if (!principal) {
      this.audit.record({
        action: "session.authenticate",
        outcome: "denied",
        reason: "invalid_session",
      });
      throw new UnauthorizedException("身份凭据无效或已经失效");
    }

    request.scadaPrincipal = principal;
    this.audit.record({
      action: "session.authenticate",
      outcome: "allowed",
      reason: "verified",
    });
    return true;
  }
}
