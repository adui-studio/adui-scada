import { Buffer } from "node:buffer";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthenticatedProjectPrincipal } from "../projects/project-access-policy.js";
import { PrismaService } from "../database/prisma.service.js";

const PRINCIPAL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const TOKEN_PATTERN = /^scada_s_[A-Za-z0-9_-]{43}$/;
const CSRF_TOKEN_PATTERN = /^scada_csrf_[A-Za-z0-9_-]{43}$/;
/** 短期访问会话有效期为 15 分钟，当前不提供刷新令牌或公开签发接口。 */
const SESSION_DURATION_MS = 15 * 60 * 1000;

interface ActiveSessionRecord {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly csrfTokenHash: string | null;
  readonly identity: { readonly status: string };
}

export interface IssuedAuthSession {
  readonly sessionId: string;
  /** 仅首次签发时返回明文；不得写入数据库、日志或前端永久存储。 */
  readonly token: string;
  /** 仅用于设置可读 CSRF Cookie；不得写入日志或响应 JSON。 */
  readonly csrfToken: string;
  readonly expiresAt: Date;
}

export interface AuthenticatedSession {
  readonly sessionId: string;
  readonly principal: AuthenticatedProjectPrincipal;
}

export type CookieSessionAuthenticationResult =
  | {
      readonly authenticated: true;
      readonly sessionId: string;
      readonly principal: AuthenticatedProjectPrincipal;
    }
  | {
      readonly authenticated: false;
      readonly reason: "invalid_session" | "csrf_rejected";
    };

function validPrincipal(
  principal: AuthenticatedProjectPrincipal | null | undefined,
): principal is AuthenticatedProjectPrincipal {
  return (
    principal !== null &&
    principal !== undefined &&
    typeof principal.tenantId === "string" &&
    PRINCIPAL_ID_PATTERN.test(principal.tenantId) &&
    typeof principal.subjectId === "string" &&
    PRINCIPAL_ID_PATTERN.test(principal.subjectId)
  );
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function constantTimeHashMatches(expectedHash: string, actualHash: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || !/^[a-f0-9]{64}$/.test(actualHash)) {
    return false;
  }
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * 可撤销、不透明的服务端会话。
 * 只接受后续可信身份提供方确认的主体，不自行验证密码、OIDC 或签发公开登录凭据。
 */
@Injectable()
export class AuthSessionService {
  constructor(private readonly database: PrismaService) {}

  /** 仅供已验证的服务端身份流程签发；不提供客户端可直接调用的会话签发路由。 */
  async issueForVerifiedSubject(
    principal: AuthenticatedProjectPrincipal,
  ): Promise<IssuedAuthSession> {
    if (!validPrincipal(principal)) {
      throw new ForbiddenException("无效的可信主体，禁止签发会话");
    }
    const identity = await this.database.client.scadaIdentity.findUnique({
      where: {
        tenantId_subjectId: {
          tenantId: principal.tenantId,
          subjectId: principal.subjectId,
        },
      },
      select: { status: true },
    });
    if (identity?.status !== "active") {
      throw new ForbiddenException("主体不存在或已停用，禁止签发会话");
    }

    // 会话令牌与 CSRF 令牌分别使用 32 字节随机数；数据库只保存各自 SHA-256 摘要。
    const token = `scada_s_${randomBytes(32).toString("base64url")}`;
    const csrfToken = `scada_csrf_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    const session = await this.database.client.scadaAuthSession.create({
      data: {
        tenantId: principal.tenantId,
        subjectId: principal.subjectId,
        tokenHash: hashToken(token),
        csrfTokenHash: hashToken(csrfToken),
        expiresAt,
      },
      select: { sessionId: true, expiresAt: true },
    });
    return { sessionId: session.sessionId, token, csrfToken, expiresAt: session.expiresAt };
  }

  /** 兼容既有 Bearer 调用；每次请求仍回查撤销、过期和主体状态。 */
  async authenticate(token: unknown): Promise<AuthenticatedProjectPrincipal | null> {
    const session = await this.authenticateWithSession(token);
    return session?.principal ?? null;
  }

  /** 验证 Bearer 会话并返回本地会话标识，令牌明文不会进入结果。 */
  async authenticateWithSession(token: unknown): Promise<AuthenticatedSession | null> {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
    const session = await this.findActiveSession(token);
    if (!session) return null;

    const principal = { tenantId: session.tenantId, subjectId: session.subjectId };
    if (!validPrincipal(principal)) return null;
    return Object.freeze({
      sessionId: session.sessionId,
      principal: Object.freeze(principal),
    });
  }

  /**
   * 验证浏览器 Cookie 会话。
   * Cookie 会话必须具有 CSRF 摘要；旧 Bearer 会话的空摘要不能升级为 Cookie 会话。
   */
  async authenticateCookieSession(
    token: unknown,
    csrfToken?: unknown,
  ): Promise<CookieSessionAuthenticationResult> {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
      return { authenticated: false, reason: "invalid_session" };
    }

    const session = await this.findActiveSession(token);
    if (
      !session ||
      typeof session.csrfTokenHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(session.csrfTokenHash)
    ) {
      return { authenticated: false, reason: "invalid_session" };
    }

    if (csrfToken !== undefined) {
      if (typeof csrfToken !== "string" || !CSRF_TOKEN_PATTERN.test(csrfToken)) {
        return { authenticated: false, reason: "csrf_rejected" };
      }
      if (!constantTimeHashMatches(session.csrfTokenHash, hashToken(csrfToken))) {
        return { authenticated: false, reason: "csrf_rejected" };
      }
    }

    const principal = { tenantId: session.tenantId, subjectId: session.subjectId };
    if (!validPrincipal(principal)) {
      return { authenticated: false, reason: "invalid_session" };
    }

    return Object.freeze({
      authenticated: true as const,
      sessionId: session.sessionId,
      principal: Object.freeze(principal),
    });
  }

  /** 仅由受信内部逻辑根据会话 UUID 和主体精确撤销，不提供跨租户撤销。 */
  async revokeForVerifiedSubject(
    principal: AuthenticatedProjectPrincipal,
    sessionId: string,
  ): Promise<boolean> {
    if (
      !validPrincipal(principal) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)
    ) {
      throw new ForbiddenException("撤销会话的主体或标识无效");
    }
    const result = await this.database.client.scadaAuthSession.updateMany({
      where: {
        sessionId,
        tenantId: principal.tenantId,
        subjectId: principal.subjectId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    return result.count === 1;
  }

  private async findActiveSession(token: string): Promise<ActiveSessionRecord | null> {
    const session = await this.database.client.scadaAuthSession.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        sessionId: true,
        tenantId: true,
        subjectId: true,
        issuedAt: true,
        expiresAt: true,
        revokedAt: true,
        csrfTokenHash: true,
        identity: { select: { status: true } },
      },
    });
    if (
      !session ||
      session.revokedAt !== null ||
      session.identity.status !== "active" ||
      session.expiresAt.getTime() <= Date.now() ||
      session.issuedAt.getTime() > Date.now()
    ) {
      return null;
    }
    return session;
  }
}
