import type { AuthenticatedProjectPrincipal } from "../projects/project-access-policy.js";

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

/** 可信本地会话端口；正式应用只绑定原生 Prisma 8 实现。 */
export abstract class AuthSessionService {
  abstract issueForVerifiedSubject(
    principal: AuthenticatedProjectPrincipal,
  ): Promise<IssuedAuthSession>;
  abstract authenticate(token: unknown): Promise<AuthenticatedProjectPrincipal | null>;
  abstract authenticateWithSession(token: unknown): Promise<AuthenticatedSession | null>;
  abstract authenticateCookieSession(
    token: unknown,
    csrfToken?: unknown,
  ): Promise<CookieSessionAuthenticationResult>;
  abstract revokeForVerifiedSubject(
    principal: AuthenticatedProjectPrincipal,
    sessionId: string,
  ): Promise<boolean>;
}
