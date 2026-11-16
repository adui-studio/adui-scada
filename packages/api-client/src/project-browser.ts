import type { ScadaApiClient, ScadaProjectSummary } from "./index.ts";

export const STUDIO_PROJECT_PAGE_SIZE = 10;

export interface StudioProjectBrowserPage {
  readonly projects: readonly ScadaProjectSummary[];
  readonly pageNumber: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly loaded: boolean;
}

/**
 * Vue/React 共用的服务端工程列表游标会话。
 * 只保存当前会话的分页位置，不持久化身份、工程内容或浏览器草稿。
 */
export class StudioProjectBrowser {
  private readonly api: Pick<ScadaApiClient, "listProjects">;
  private cursors: readonly (string | undefined)[] = [undefined];
  private pageIndex = 0;
  private projects: readonly ScadaProjectSummary[] = [];
  private loaded = false;
  private endReached = false;
  private busy = false;

  constructor(api: Pick<ScadaApiClient, "listProjects">) {
    this.api = api;
  }

  snapshot(): StudioProjectBrowserPage {
    return {
      projects: this.projects,
      pageNumber: this.pageIndex + 1,
      hasPrevious: this.pageIndex > 0,
      hasNext: this.loaded && !this.endReached && this.projects.length === STUDIO_PROJECT_PAGE_SIZE,
      loaded: this.loaded,
    };
  }

  /** 重新获取第一页，丢弃旧列表的全部游标。 */
  refresh(): Promise<StudioProjectBrowserPage> {
    return this.load(0, [undefined]);
  }

  next(): Promise<StudioProjectBrowserPage> {
    const last = this.projects.at(-1);
    if (!this.snapshot().hasNext || !last) return Promise.resolve(this.snapshot());
    const cursors = [...this.cursors.slice(0, this.pageIndex + 1), last.projectId];
    return this.load(this.pageIndex + 1, cursors);
  }

  previous(): Promise<StudioProjectBrowserPage> {
    if (this.pageIndex === 0) return Promise.resolve(this.snapshot());
    return this.load(this.pageIndex - 1, this.cursors);
  }

  private async load(
    index: number,
    cursors: readonly (string | undefined)[],
  ): Promise<StudioProjectBrowserPage> {
    if (this.busy) throw new TypeError("工程列表正在读取，请勿重复提交");
    this.busy = true;
    try {
      const afterProjectId = cursors[index];
      const rows = await this.api.listProjects({
        limit: STUDIO_PROJECT_PAGE_SIZE,
        ...(afterProjectId === undefined ? {} : { afterProjectId }),
      });
      // 最后一页恰好满额时，保留当前页面而非跳转到空列表。
      if (index > this.pageIndex && rows.length === 0) {
        this.endReached = true;
        return this.snapshot();
      }
      this.projects = rows;
      this.pageIndex = index;
      this.cursors = cursors;
      this.loaded = true;
      this.endReached = false;
      return this.snapshot();
    } finally {
      this.busy = false;
    }
  }
}

export function createStudioProjectBrowser(
  api: Pick<ScadaApiClient, "listProjects">,
): StudioProjectBrowser {
  return new StudioProjectBrowser(api);
}
