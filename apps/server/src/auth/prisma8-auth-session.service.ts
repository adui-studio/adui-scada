import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import type { PostgresClient, PostgresTransactionContext } from "@prisma/orm-postgres/runtime";
import type { Contract } from "../generated/prisma8/contract.d.js";
import type { AuthenticatedProjectPrincipal } from "../projects/project-access-policy.js";
import type { AuthenticatedSession, CookieSessionAuthenticationResult, IssuedAuthSession } from "./auth-session.service.js";

type Tx = PostgresTransactionContext<Contract>;
const OPTIONS = { isolationLevel: "ReadCommitted", timeout: 10000 } as const;
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

async function requireBoundary(tx: Tx): Promise<void> {
  const rows = await tx
    .query(
      tx.raw.sql`SELECT current_database()::text AS database_name,
      current_schema()::text AS schema_name,
      current_setting('transaction_read_only') AS read_only,
      current_setting('transaction_isolation') AS isolation`
        .returnsRow({
          database_name: "pg/text@1",
          schema_name: "pg/text@1",
          read_only: "pg/text@1",
          isolation: "pg/text@1",
        })
        .build(),
    )
    .toArray();
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row?.database_name !== "adui_scada_test" ||
    row.schema_name !== "public" ||
    row.read_only !== "off" ||
    row.isolation !== "read committed"
  ) {
    throw new Error("Prisma 8 身份候选仅允许隔离库读已提交事务");
  }
}

function isValidSubject(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 32 || codeUnit > 126) return false;
  }
  return true;
}

interface ActiveSessionRecord {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly csrfTokenHash: string | null;
}

/** 仅供隔离验收的 Prisma 8 会话候选；不注册生产 Provider，不暴露签发或身份映射路由。 */
export class Prisma8AuthSessionService {
  constructor(private readonly client: PostgresClient<Contract>) {}

  /** 仅在上游已完成 OIDC 验签且固定 Issuer 一致时查询预绑定；不自动创建身份。 */
  async resolveVerifiedExternalIdentity(
    expectedIssuer: string,
    issuer: unknown,
    subject: unknown,
  ): Promise<AuthenticatedProjectPrincipal | null> {
    if (typeof issuer !== "string" || issuer !== expectedIssuer || issuer.length === 0 ||
        issuer.length > 512 || !isValidSubject(subject)) return null;
    return this.client.transaction(async (tx) => {
      await requireBoundary(tx);
      const rows = await tx.query(
        tx.raw.sql`SELECT e.tenant_id::text AS tenant_id, e.subject_id::text AS subject_id
          FROM public.scada_external_identities e
          JOIN public.scada_identities i ON i.tenant_id = e.tenant_id AND i.subject_id = e.subject_id
          WHERE e.issuer = ${issuer} AND e.subject = ${subject} AND i.status = 'active'`
          .returnsRow({ tenant_id: "pg/text@1", subject_id: "pg/text@1" }).build(),
      ).toArray();
      const row = rows[0];
      if (rows.length !== 1 || !row) return null;
      const principal = { tenantId: row.tenant_id, subjectId: row.subject_id };
      return validPrincipal(principal) ? Object.freeze(principal) : null;
    }, OPTIONS);
  }

  async issueForVerifiedSubject(principal: AuthenticatedProjectPrincipal): Promise<IssuedAuthSession> {
    if (!validPrincipal(principal)) throw new ForbiddenException("无效的可信主体，禁止签发会话");
    const { tenantId, subjectId } = principal;
    return this.client.transaction(async (tx) => {
      await requireBoundary(tx);
      const identities = await tx.query(
        tx.raw.sql`SELECT status::text AS status FROM public.scada_identities
          WHERE tenant_id = ${tenantId} AND subject_id = ${subjectId} FOR SHARE`
          .returnsRow({ status: "pg/text@1" }).build(),
      ).toArray();
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
      const result = await tx.execute(
        tx.raw.sql`INSERT INTO public.scada_auth_sessions
          (session_id, tenant_id, subject_id, token_hash, csrf_token_hash, issued_at, expires_at)
          VALUES (${sessionId}::uuid, ${tenantId}, ${subjectId}, ${tokenHash}, ${csrfTokenHash},
            ${issuedAt.toISOString()}::timestamptz, ${expiresAt.toISOString()}::timestamptz)`
          .affectedCount().build(),
      );
      if (result.affectedRows !== 1) throw new Error("本地会话创建失败，请稍后重试");
      return { sessionId, token, csrfToken, expiresAt };
    }, OPTIONS);
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
  async revokeForVerifiedSubject(principal: AuthenticatedProjectPrincipal, sessionId: string): Promise<boolean> {
    if (!validPrincipal(principal) || typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
      throw new ForbiddenException("撤销会话的主体或标识无效");
    }
    const { tenantId, subjectId } = principal;
    return this.client.transaction(async (tx) => {
      await requireBoundary(tx);
      const result = await tx.execute(
        tx.raw.sql`UPDATE public.scada_auth_sessions SET revoked_at = ${new Date().toISOString()}::timestamptz
          WHERE session_id = ${sessionId}::uuid AND tenant_id = ${tenantId} AND subject_id = ${subjectId}
            AND revoked_at IS NULL`.affectedCount().build(),
      );
      if (result.affectedRows > 1) throw new Error("会话撤销影响行数异常");
      return result.affectedRows === 1;
    }, OPTIONS);
  }

  private async findActiveSession(token: string): Promise<ActiveSessionRecord | null> {
    const tokenHash = hashToken(token);
    return this.client.transaction(async (tx) => {
      await requireBoundary(tx);
      const rows = await tx.query(
        tx.raw.sql`SELECT s.session_id::text AS session_id, s.tenant_id::text AS tenant_id,
          s.subject_id::text AS subject_id, COALESCE(s.csrf_token_hash, '')::text AS csrf_hash,
          (s.csrf_token_hash IS NULL)::text AS csrf_is_null,
          s.issued_at::text AS issued_at, s.expires_at::text AS expires_at
          FROM public.scada_auth_sessions s
          JOIN public.scada_identities i ON i.tenant_id = s.tenant_id AND i.subject_id = s.subject_id
          WHERE s.token_hash = ${tokenHash} AND s.revoked_at IS NULL AND i.status = 'active'`
          .returnsRow({
            session_id: "pg/text@1", tenant_id: "pg/text@1", subject_id: "pg/text@1",
            csrf_hash: "pg/text@1", csrf_is_null: "pg/text@1", issued_at: "pg/text@1", expires_at: "pg/text@1",
          }).build(),
      ).toArray();
      const row = rows[0];
      if (rows.length !== 1 || !row) return null;
      const now = Date.now();
      const issuedAt = Date.parse(row.issued_at);
      const expiresAt = Date.parse(row.expires_at);
      if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now || expiresAt <= now) return null;
      if (row.csrf_is_null !== "true" && row.csrf_is_null !== "false") return null;
      return { sessionId: row.session_id, tenantId: row.tenant_id, subjectId: row.subject_id,
        csrfTokenHash: row.csrf_is_null === "true" ? null : row.csrf_hash };
    }, OPTIONS);
  }
}
