import { Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { AuthenticatedProjectPrincipal } from "../projects/project-access-policy.js";
import { AuthSessionService } from "./auth-session.service.js";

export interface ScadaAuthenticatedRequest {
  readonly headers: { readonly authorization?: string | string[] };
  readonly params?: Record<string, unknown>;
  scadaPrincipal?: AuthenticatedProjectPrincipal;
}

/**
 * Bearer 令牌只能从 HTTP Authorization 请求头获取；没有可信会话时默认拒绝。
 * 本 Guard 只对未来明确声明受保护的路由生效，不注册到当前 AppModule。
 */
@Injectable()
export class ScadaSessionGuard implements CanActivate {
  constructor(private readonly sessions: AuthSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") {
      throw new UnauthorizedException("暂不接受非 HTTP 类型的身份凭据");
    }
    const request = context.switchToHttp().getRequest<ScadaAuthenticatedRequest>();
    const header = request.headers.authorization;
    if (typeof header !== "string" || header.length > 128) {
      throw new UnauthorizedException("缺少有效的身份凭据");
    }
    const match = /^Bearer (scada_s_[A-Za-z0-9_-]{43})$/i.exec(header);
    if (!match) throw new UnauthorizedException("缺少有效的身份凭据");

    const principal = await this.sessions.authenticate(match[1]);
    if (!principal) throw new UnauthorizedException("身份凭据无效或已经失效");
    request.scadaPrincipal = principal;
    return true;
  }
}
