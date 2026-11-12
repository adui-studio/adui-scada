/** 仅由未来可信认证层填充；不得从请求体或前端角色字段直接构造。 */
export interface AuthenticatedProjectPrincipal {
  readonly tenantId: string;
  readonly subjectId: string;
}

/** 权限查询范围必须由服务端解析并与可信主体关联。 */
export interface ProjectAccessScope {
  readonly tenantId: string;
  readonly projectId: string;
}

/** 由服务端项目权限仓储查出的有效授权记录，不是客户端 DTO。 */
export interface ProjectPermissionGrant extends ProjectAccessScope {
  readonly subjectId: string;
  readonly permissions: readonly ProjectAccessAction[];
}

/** 仅表示工程与版本操作权限，不包含正式发布或工业设备写入权限。 */
export type ProjectAccessAction = "project:read" | "version:read" | "version:append";

const ACTIONS: readonly ProjectAccessAction[] = [
  "project:read",
  "version:read",
  "version:append",
];
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

/**
 * 纯策略判断：主体、租户、工程和显式授权均匹配才允许访问，否则默认拒绝。
 * 本函数不验证主体来源、不查询数据库，也不替代 NestJS Guard 或持久化审计。
 */
export function hasProjectPermission(
  principal: AuthenticatedProjectPrincipal | null,
  scope: ProjectAccessScope,
  grant: ProjectPermissionGrant | null,
  action: ProjectAccessAction,
): boolean {
  if (!principal || !scope || !grant) return false;
  if (
    !validIdentifier(principal.tenantId) ||
    !validIdentifier(principal.subjectId) ||
    !validIdentifier(scope.tenantId) ||
    !validIdentifier(scope.projectId) ||
    !validIdentifier(grant.tenantId) ||
    !validIdentifier(grant.projectId) ||
    !validIdentifier(grant.subjectId)
  ) {
    return false;
  }
  if (!ACTIONS.includes(action)) return false;
  if (
    principal.tenantId !== scope.tenantId ||
    grant.tenantId !== scope.tenantId ||
    grant.projectId !== scope.projectId ||
    grant.subjectId !== principal.subjectId
  ) {
    return false;
  }
  if (!Array.isArray(grant.permissions) || grant.permissions.some((item) => !ACTIONS.includes(item))) {
    return false;
  }
  return grant.permissions.includes(action);
}
