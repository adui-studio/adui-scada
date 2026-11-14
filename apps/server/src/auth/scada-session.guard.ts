import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { AuthenticatedProjectPrincipal } from "../projects/project-access-policy.js";
import { ScadaSecurityAuditService } from "../security/scada-security-audit.js";
import type {
  SecurityAuditReason,
  SecurityAuditReporter,
} from "../security/scada-security-audit.js";
import type { EnabledOidcConfig } from "../config/oidc-startup.config.js";
import { AuthSessionService } from "./auth-session.service.js";
import { SCADA_CSRF_COOKIE_NAME, SCADA_SESSION_COOKIE_NAME } from "./scada-auth-cookie.js";
import { SCADA_OIDC_STARTUP_CONFIG } from "./oidc-provider-discovery.service.js";

const CSRF_TOKEN_PATTERN = /^scada_csrf_[A-Za-z0-9_-]{43}$/;
const MAX_COOKIE_HEADER_LENGTH = 4096;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

interface ParsedAuthCookies {
  readonly valid: boolean;
  readonly sessionPresent: boolean;
  readonly sessionToken?: string;
  readonly csrfPresent: boolean;
  readonly csrfToken?: string;
}

export interface ScadaAuthenticatedRequest {
  readonly headers: {
    readonly authorization?: string | string[];
    readonly cookie?: string | string[];
    readonly origin?: string | string[];
    readonly "sec-fetch-site"?: string | string[];
    readonly "x-scada-csrf"?: string | string[];
  };
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  scadaPrincipal?: AuthenticatedProjectPrincipal;
  scadaSessionId?: string;
  scadaAuthMethod?: "bearer" | "cookie";
}

function parseAuthCookies(header: string | string[] | undefined): ParsedAuthCookies {
  if (header === undefined) {
    return { valid: true, sessionPresent: false, csrfPresent: false };
  }
  if (typeof header !== "string" || header.length > MAX_COOKIE_HEADER_LENGTH) {
    return { valid: false, sessionPresent: false, csrfPresent: false };
  }

  let sessionPresent = false;
  let csrfPresent = false;
  let sessionToken: string | undefined;
  let csrfToken: string | undefined;

  for (const rawPart of header.split(";")) {
    const part = rawPart.trim();
    if (part.length === 0) continue;
    const separator = part.indexOf("=");
    if (separator <= 0) {
      return { valid: false, sessionPresent: false, csrfPresent: false };
    }

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === SCADA_SESSION_COOKIE_NAME) {
      if (sessionPresent) return { valid: false, sessionPresent, csrfPresent };
      sessionPresent = true;
      sessionToken = value;
    } else if (name === SCADA_CSRF_COOKIE_NAME) {
      if (csrfPresent) return { valid: false, sessionPresent, csrfPresent };
      csrfPresent = true;
      csrfToken = value;
    }
  }

  return { valid: true, sessionPresent, sessionToken, csrfPresent, csrfToken };
}

function constantTimeStringEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/**
 * 同时兼容显式 Bearer 与浏览器 Cookie，但拒绝混用或回退。
 * Cookie 写请求必须通过 Origin、Fetch Metadata 和绑定当前会话的 CSRF 双提交校验。
 */
@Injectable()
export class ScadaSessionGuard implements CanActivate {
  constructor(
    private readonly sessions: AuthSessionService,
    @Inject(ScadaSecurityAuditService) private readonly audit: SecurityAuditReporter,
    @Inject(SCADA_OIDC_STARTUP_CONFIG)
    private readonly startupConfig: EnabledOidcConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") {
      this.reject(
        "unsupported_context",
        new UnauthorizedException("暂不接受非 HTTP 类型的身份凭据"),
      );
    }

    const request = context.switchToHttp().getRequest<ScadaAuthenticatedRequest>();
    const cookies = parseAuthCookies(request.headers.cookie);
    if (!cookies.valid) {
      this.reject("malformed_cookie", new UnauthorizedException("浏览器身份 Cookie 格式无效"));
    }

    const authorization = request.headers.authorization;
    if (authorization !== undefined) {
      if (cookies.sessionPresent || cookies.csrfPresent) {
        this.reject(
          "ambiguous_credentials",
          new UnauthorizedException("不允许混用 Bearer 与 Cookie 身份凭据"),
        );
      }

      const match =
        typeof authorization === "string" && authorization.length <= 128
          ? /^Bearer (scada_s_[A-Za-z0-9_-]{43})$/i.exec(authorization)
          : null;
      const token = match?.[1];
      if (!token) {
        this.reject("malformed_authorization", new UnauthorizedException("缺少有效的身份凭据"));
      }

      const session = await this.sessions.authenticateWithSession(token);
      if (!session) {
        this.reject("invalid_session", new UnauthorizedException("身份凭据无效或已经失效"));
      }

      request.scadaPrincipal = session.principal;
      request.scadaSessionId = session.sessionId;
      request.scadaAuthMethod = "bearer";
      this.allow();
      return true;
    }

    if (!cookies.sessionPresent || typeof cookies.sessionToken !== "string") {
      if (cookies.csrfPresent) {
        this.reject(
          "malformed_cookie",
          new UnauthorizedException("浏览器 CSRF Cookie 缺少会话绑定"),
        );
      }
      this.reject("malformed_authorization", new UnauthorizedException("缺少有效的身份凭据"));
    }

    const method = request.method;
    if (typeof method !== "string" || method.length === 0) {
      this.reject("malformed_cookie", new UnauthorizedException("浏览器请求方法无效"));
    }

    const safeMethod = SAFE_METHODS.has(method.toUpperCase());
    let csrfHeader: string | undefined;
    if (!safeMethod) {
      const origin = request.headers.origin;
      if (typeof origin !== "string" || !this.startupConfig.webOrigins.includes(origin)) {
        this.reject("origin_rejected", new ForbiddenException("请求来源不在可信站点白名单中"));
      }

      if (request.headers["sec-fetch-site"] !== "same-origin") {
        this.reject("fetch_metadata_rejected", new ForbiddenException("请求未通过同源安全检查"));
      }

      const csrfCookie = cookies.csrfToken;
      const csrfHeaderValue = request.headers["x-scada-csrf"];
      if (
        typeof csrfCookie !== "string" ||
        typeof csrfHeaderValue !== "string" ||
        !CSRF_TOKEN_PATTERN.test(csrfCookie) ||
        !CSRF_TOKEN_PATTERN.test(csrfHeaderValue) ||
        !constantTimeStringEquals(csrfCookie, csrfHeaderValue)
      ) {
        this.reject("csrf_rejected", new ForbiddenException("CSRF 校验失败"));
      }
      csrfHeader = csrfHeaderValue;
    }

    const authentication = await this.sessions.authenticateCookieSession(
      cookies.sessionToken,
      csrfHeader,
    );
    if (!authentication.authenticated) {
      if (authentication.reason === "csrf_rejected") {
        this.reject("csrf_rejected", new ForbiddenException("CSRF 校验失败"));
      }
      this.reject("invalid_session", new UnauthorizedException("身份凭据无效或已经失效"));
    }

    request.scadaPrincipal = authentication.principal;
    request.scadaSessionId = authentication.sessionId;
    request.scadaAuthMethod = "cookie";
    this.allow();
    return true;
  }

  private reject(reason: SecurityAuditReason, exception: Error): never {
    this.audit.record({
      action: "session.authenticate",
      outcome: "denied",
      reason,
    });
    throw exception;
  }

  private allow(): void {
    this.audit.record({
      action: "session.authenticate",
      outcome: "allowed",
      reason: "verified",
    });
  }
}
