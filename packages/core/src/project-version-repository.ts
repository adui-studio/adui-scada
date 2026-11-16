import type { ProjectSnapshot } from "./project-snapshot.ts";

/** 仅用于查询的历史摘要，不含完整组态文档。 */
export type ProjectVersionSummary = Pick<
  ProjectSnapshot,
  "projectId" | "revision" | "createdAt" | "contentHash"
>;

/** 服务端工程列表采用不可变工程 ID 的有界游标分页。 */
export interface ProjectListQuery {
  /** 缺省 20 条、最多 100 条。 */
  readonly limit?: number;
  /** 仅查询严格大于当前工程 ID 的后续授权工程。 */
  readonly afterProjectId?: string;
}

export interface ProjectVersionQuery {
  /** 每页最多 100 条，缺省 20 条。 */
  readonly limit?: number;
  /** 只查询修订号小于此值的历史，适用于稳定向前翻页。 */
  readonly beforeRevision?: number;
}

/**
 * 工程版本仓储抽象；append 只追加且必须校验调用方已见过的最新修订号。
 * 这不等于正式发布仓储、发布指针或权限审计。
 */
export interface ProjectVersionRepository {
  getHeadRevision(projectId: string): Promise<number | null>;
  append(
    source: unknown,
    expectedRevision: number | null,
    createdAt?: string,
  ): Promise<ProjectSnapshot>;
  get(projectId: string, revision: number): Promise<ProjectSnapshot | null>;
  list(projectId: string, query?: ProjectVersionQuery): Promise<readonly ProjectVersionSummary[]>;
}
