import { createHash, randomBytes } from "node:crypto";
import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthenticatedProjectPrincipal } from "../projects/project-access-policy.js";
import { PrismaService } from "../database/prisma.service.js";

const PRINCIPAL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const TOKEN_PATTERN = /^scada_s_[A-Za-z0-9_-]{43}$/;
/** 短期访问会话有效期为 15 分钟，当前不提供刷新令牌或公开签发接口。 */
const SESSION_DURATION_MS = 15 * 60 * 1000;

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

export interface IssuedAuthSession {
  readonly sessionId: string;
  /** 仅首次签发时返回明文；不得写入数据库、日志或前端永久存储。 */
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * 可撤销、不透明的服务端会话。
 * 只接受后续可信身份提供方确认的主体，不自行验证密码、OIDC 或签发公开登录凭据。
 */
@Injectable()
export class AuthSessionService {
  constructor(private readonly database: PrismaService) {}

  /** 仅允许未来已通过可信身份认证的内部调用方签发，暂未向 HTTP 注册此能力。 */
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

    // 32 字节加密安全随机数；随机令牌只返回一次，数据库仅存 SHA-256 摘要。
    const token = `scada_s_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    const session = await this.database.client.scadaAuthSession.create({
      data: {
        tenantId: principal.tenantId,
        subjectId: principal.subjectId,
        tokenHash: hashToken(token),
        expiresAt,
      },
      select: { sessionId: true, expiresAt: true },
    });
    return { sessionId: session.sessionId, token, expiresAt: session.expiresAt };
  }

  /** 每次请求回查 PostgreSQL 中的过期、撤销和停用状态，拒绝信任客户端角色字段。 */
  async authenticate(token: unknown): Promise<AuthenticatedProjectPrincipal | null> {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
    const session = await this.database.client.scadaAuthSession.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        tenantId: true,
        subjectId: true,
        issuedAt: true,
        expiresAt: true,
        revokedAt: true,
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
    const principal = { tenantId: session.tenantId, subjectId: session.subjectId };
    return validPrincipal(principal) ? Object.freeze(principal) : null;
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
}
