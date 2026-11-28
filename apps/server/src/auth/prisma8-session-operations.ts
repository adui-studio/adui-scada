import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import type { Prisma8AuthTransactionPort } from "./prisma8-auth-transaction-port.js";
import { lockB4Identity } from "../database/prisma8-b4-routines.js";
import type { AuthenticatedProjectPrincipal } from "../projects/project-access-policy.js";
import type {
  AuthenticatedSession,
  CookieSessionAuthenticationResult,
  IssuedAuthSession,
} from "./auth-session.service.js";

const PRINCIPAL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const TOKEN_PATTERN = /^scada_s_[A-Za-z0-9_-]{43}$/;
const CSRF_TOKEN_PATTERN = /^scada_csrf_[A-Za-z0-9_-]{43}$/;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

function constantTimeHashMatches(expectedHash: string, actualHash: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || !/^[a-f0-9]{64}$/.test(actualHash)) {
    return false;
  }
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

interface ActiveSessionRecord {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly csrfTokenHash: string | null;
}

/** 两代 Prisma 8 会话共用同一签发、认证与撤销逻辑，数据库权限由各自事务端口保证。 */
export class Prisma8SessionOperations {
  constructor(private readonly transactions: Prisma8AuthTransactionPort) {}

  async issueForVerifiedSubject(
    principal: AuthenticatedProjectPrincipal,
  ): Promise<IssuedAuthSession> {
    if (!validPrincipal(principal)) throw new ForbiddenException("无效的可信主体，禁止签发会话");
    const { tenantId, subjectId } = principal;
    return this.transactions.write(async (tx) => {
      const identities = await lockB4Identity(tx, tenantId, subjectId);
      if (identities.length !== 1 || identities[0]?.status !== "active") {
        throw new ForbiddenException("主体不存在或已停用，禁止签发会话");
      }
      // 明文仅在内部签发回执中返回一次，数据库保存各自独立摘要。
      const token = "scada_s_" + randomBytes(32).toString("base64url");
      const csrfToken = "scada_csrf_" + randomBytes(32).toString("base64url");
      const sessionId = randomUUID();
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + SESSION_DURATION_MS);
      const tokenHash = hashToken(token);
      const csrfTokenHash = hashToken(csrfToken);
      const result = await tx.executeCount`INSERT INTO public.scada_auth_sessions
          (session_id, tenant_id, subject_id, token_hash, csrf_token_hash, issued_at, expires_at)
          VALUES (${sessionId}::uuid, ${tenantId}, ${subjectId}, ${tokenHash}, ${csrfTokenHash},
            ${issuedAt.toISOString()}::timestamptz, ${expiresAt.toISOString()}::timestamptz)`;
      if (result.affectedRows !== 1) throw new Error("本地会话创建失败，请稍后重试");
      return { sessionId, token, csrfToken, expiresAt };
    });
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

  /** 只按可信租户、主体与会话联合条件撤销，重复撤销返回 false。 */
  async revokeForVerifiedSubject(
    principal: AuthenticatedProjectPrincipal,
    sessionId: string,
  ): Promise<boolean> {
    if (
      !validPrincipal(principal) ||
      typeof sessionId !== "string" ||
      !SESSION_ID_PATTERN.test(sessionId)
    ) {
      throw new ForbiddenException("撤销会话的主体或标识无效");
    }
    const { tenantId, subjectId } = principal;
    return this.transactions.write(async (tx) => {
      const result =
        await tx.executeCount`UPDATE public.scada_auth_sessions SET revoked_at = ${new Date().toISOString()}::timestamptz
          WHERE session_id = ${sessionId}::uuid AND tenant_id = ${tenantId} AND subject_id = ${subjectId}
            AND revoked_at IS NULL`;
      if (result.affectedRows > 1) throw new Error("会话撤销影响行数异常");
      return result.affectedRows === 1;
    });
  }

  private async findActiveSession(token: string): Promise<ActiveSessionRecord | null> {
    const tokenHash = hashToken(token);
    return this.transactions.read(async (tx) => {
      const rows = await tx.queryText({
        session_id: "pg/text@1",
        tenant_id: "pg/text@1",
        subject_id: "pg/text@1",
        csrf_hash: "pg/text@1",
        csrf_is_null: "pg/text@1",
        issued_at: "pg/text@1",
        expires_at: "pg/text@1",
      })`SELECT s.session_id::text AS session_id, s.tenant_id::text AS tenant_id,
          s.subject_id::text AS subject_id, COALESCE(s.csrf_token_hash, '')::text AS csrf_hash,
          (s.csrf_token_hash IS NULL)::text AS csrf_is_null,
          s.issued_at::text AS issued_at, s.expires_at::text AS expires_at
          FROM public.scada_auth_sessions s
          JOIN public.scada_identities i ON i.tenant_id = s.tenant_id AND i.subject_id = s.subject_id
          WHERE s.token_hash = ${tokenHash} AND s.revoked_at IS NULL AND i.status = 'active'`;
      const row = rows[0];
      if (rows.length !== 1 || !row) return null;
      const now = Date.now();
      const issuedAt = Date.parse(row.issued_at);
      const expiresAt = Date.parse(row.expires_at);
      if (
        !Number.isFinite(issuedAt) ||
        !Number.isFinite(expiresAt) ||
        issuedAt > now ||
        expiresAt <= now
      )
        return null;
      if (row.csrf_is_null !== "true" && row.csrf_is_null !== "false") return null;
      return {
        sessionId: row.session_id,
        tenantId: row.tenant_id,
        subjectId: row.subject_id,
        csrfTokenHash: row.csrf_is_null === "true" ? null : row.csrf_hash,
      };
    });
  }
}
