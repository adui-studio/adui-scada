import type { ProjectReleasePreflightIssue, ProjectSnapshot, ProjectVersionSummary } from "@adui/scada-core";
import type { AuthenticatedProjectPrincipal } from "./project-access-policy.js";

export interface ProjectSummary {
  readonly projectId: string;
  readonly headRevision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 已保存的当前修订版的静态发布预检；不包含快照正文与发布许可。 */
export interface ProjectReleasePreflightSummary {
  readonly projectId: string;
  readonly revision: number;
  readonly headRevision: number;
  readonly contentHash: string;
  readonly passed: boolean;
  readonly issues: readonly ProjectReleasePreflightIssue[];
}

/** 未授权与工程不存在统一拒绝，不向外暴露工程是否存在。 */
export class ProjectVersionAccessDeniedError extends Error {
  constructor() {
    super("工程资源不存在或无权访问");
    this.name = "ProjectVersionAccessDeniedError";
  }
}

/** 预期修订号不匹配；调用方必须重新读取后显式决定如何处理。 */
export class ProjectRevisionConflictError extends Error {
  constructor() {
    super("工程版本已变化，请重新获取最新修订号");
    this.name = "ProjectRevisionConflictError";
  }
}

/** 已授权工程中查询不到指定历史修订号。 */
export class ProjectRevisionNotFoundError extends Error {
  constructor() {
    super("指定工程版本不存在");
    this.name = "ProjectRevisionNotFoundError";
  }
}

/** 当前租户下已存在相同工程标识。 */
export class ProjectAlreadyExistsError extends Error {
  constructor() {
    super("当前租户下已存在相同工程标识的工程");
    this.name = "ProjectAlreadyExistsError";
  }
}

/** 客户端工程请求不符合共享 Core 或服务端分页契约。 */
export class ProjectRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectRequestValidationError";
  }
}

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export function requirePrincipal(
  principal: AuthenticatedProjectPrincipal | null,
): asserts principal is AuthenticatedProjectPrincipal {
  if (
    !principal ||
    typeof principal.tenantId !== "string" ||
    !ID_PATTERN.test(principal.tenantId) ||
    typeof principal.subjectId !== "string" ||
    !ID_PATTERN.test(principal.subjectId)
  ) {
    throw new ProjectVersionAccessDeniedError();
  }
}

export function requireProjectId(projectId: string): void {
  if (typeof projectId !== "string" || !ID_PATTERN.test(projectId)) {
    throw new ProjectVersionAccessDeniedError();
  }
}

/** 工程版本业务端口，不依赖具体数据库 SDK。 */
export abstract class ProjectVersionStore {
  abstract create(
    principal: AuthenticatedProjectPrincipal | null,
    input: unknown,
  ): Promise<ProjectSummary>;
  abstract list(
    principal: AuthenticatedProjectPrincipal | null,
    input?: unknown,
  ): Promise<readonly ProjectSummary[]>;
  abstract getProject(
    principal: AuthenticatedProjectPrincipal | null,
    projectId: string,
  ): Promise<ProjectSummary>;
  abstract listVersions(
    principal: AuthenticatedProjectPrincipal | null,
    projectId: string,
    input?: unknown,
  ): Promise<readonly ProjectVersionSummary[]>;
  abstract append(
    principal: AuthenticatedProjectPrincipal | null,
    projectId: string,
    input: unknown,
  ): Promise<ProjectSnapshot>;
  abstract read(
    principal: AuthenticatedProjectPrincipal | null,
    projectId: string,
    revision: number,
  ): Promise<ProjectSnapshot>;
  abstract preflightRelease(
    principal: AuthenticatedProjectPrincipal | null,
    projectId: string,
    revision: number,
  ): Promise<ProjectReleasePreflightSummary>;
}
