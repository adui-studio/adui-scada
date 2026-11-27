import type { ProjectReleasePreflightIssue, ProjectSnapshot } from "@adui/scada-core";
import type { AuthenticatedProjectPrincipal } from "./project-access-policy.js";

export interface ProjectReleaseResult {
  readonly projectId: string;
  readonly action: "PUBLISH";
  /** 发布事件提交时的工程 head 水位；幂等重放返回原始值。 */
  readonly headRevision: number;
  readonly releasedRevision: number;
  readonly releasedContentHash: string;
  readonly releaseGeneration: number;
  readonly eventId: string;
  readonly createdAt: string;
}

/** 当前发布指针读取结果；不包含编辑 head 或本地草稿信息。 */
export type ProjectCurrentReleaseResult =
  | {
      readonly status: "UNRELEASED";
      readonly projectId: string;
      readonly releaseGeneration: 0;
    }
  | {
      readonly status: "RELEASED";
      readonly projectId: string;
      readonly releasedRevision: number;
      readonly releasedContentHash: string;
      readonly releaseGeneration: number;
      readonly eventId: string;
      readonly lastAction: "PUBLISH" | "ROLLBACK";
      readonly releasedAt: string;
      readonly snapshot: ProjectSnapshot;
    };

/** 事务锁内发现会话已撤销、过期或主体已停用。 */
export class ProjectReleaseSessionInvalidError extends Error {
  constructor() {
    super("身份会话无效或已经失效");
    this.name = "ProjectReleaseSessionInvalidError";
  }
}

/** 同一幂等键被用于不同语义时返回冲突。 */
export class ProjectReleaseConflictError extends Error {
  constructor() {
    super("工程发布状态或幂等请求已变化，请重新读取发布状态");
    this.name = "ProjectReleaseConflictError";
  }
}

/** 当前已保存快照未通过共享 Core 静态发布预检。 */
export class ProjectReleasePreflightRejectedError extends Error {
  readonly issues: readonly ProjectReleasePreflightIssue[];

  constructor(issues: readonly ProjectReleasePreflightIssue[]) {
    super("当前已保存工程版本未通过静态发布兼容性检查");
    this.name = "ProjectReleasePreflightRejectedError";
    this.issues = issues;
  }
}

/** 正式发布 HTTP 业务端口；内部回滚不暴露为公开接口。 */
export abstract class ProjectReleaseStore {
  abstract readCurrent(
    principal: AuthenticatedProjectPrincipal | null,
    sessionId: string | null,
    projectId: string,
  ): Promise<ProjectCurrentReleaseResult>;
  abstract publish(
    principal: AuthenticatedProjectPrincipal | null,
    sessionId: string | null,
    projectId: string,
    input: unknown,
    idempotencyKey: unknown,
  ): Promise<ProjectReleaseResult>;
}
