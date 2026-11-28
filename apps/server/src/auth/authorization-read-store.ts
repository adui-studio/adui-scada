import type { AuthenticatedProjectPrincipal } from "../projects/project-access-policy.js";

/** 认证回调与工程前置权限共用的只读仓储端口，不负责会话签发或锁内授权。 */
export abstract class AuthorizationReadStore {
  abstract findActiveExternalIdentity(
    issuer: string,
    subject: string,
  ): Promise<AuthenticatedProjectPrincipal | null>;

  abstract readProjectGrants(
    principal: AuthenticatedProjectPrincipal,
    projectId: string,
  ): Promise<readonly { readonly permission: string }[]>;
}

const IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export function isAuthorizationIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

/** 外部标识来自已验签声明；限制查询键长度与控制字符，不进行 URL 请求或自动绑定。 */
export function isExternalIdentityKey(issuer: string, subject: string): boolean {
  if (
    typeof issuer !== "string" ||
    issuer.length === 0 ||
    issuer.length > 512 ||
    typeof subject !== "string" ||
    subject.length === 0 ||
    subject.length > 255
  ) {
    return false;
  }
  for (let index = 0; index < issuer.length; index += 1) {
    const code = issuer.charCodeAt(index);
    if (code <= 32 || code === 127) return false;
  }
  for (let index = 0; index < subject.length; index += 1) {
    const code = subject.charCodeAt(index);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

/** 固定可信主体副本，避免异步查询期间切换租户或主体。 */
export function copyAuthorizationPrincipal(
  tenantId: unknown,
  subjectId: unknown,
): AuthenticatedProjectPrincipal | null {
  if (!isAuthorizationIdentifier(tenantId) || !isAuthorizationIdentifier(subjectId)) return null;
  return Object.freeze({ tenantId, subjectId });
}
