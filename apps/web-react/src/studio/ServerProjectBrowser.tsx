import { useEffect, useMemo, useRef, useState } from "react";
import {
  createStudioProjectBrowser,
  ScadaApiError,
  STUDIO_PROJECT_PAGE_SIZE,
} from "@adui/scada-api-client";
import type { ScadaApiClient, StudioProjectBrowserPage } from "@adui/scada-api-client";

interface ServerProjectBrowserProps {
  readonly api: ScadaApiClient;
  readonly currentProjectId: string;
  readonly disabled: boolean;
  readonly onOpen: (projectId: string, headRevision: number) => Promise<void>;
}

/** 仅浏览已授权的工程摘要；载入和草稿保护由 Studio 协调。 */
export function ServerProjectBrowser({
  api,
  currentProjectId,
  disabled,
  onOpen,
}: ServerProjectBrowserProps) {
  const browser = useMemo(() => createStudioProjectBrowser(api), [api]);
  const [page, setPage] = useState<StudioProjectBrowserPage>(() => browser.snapshot());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function loadPage(action: "refresh" | "next" | "previous"): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await browser[action]();
      if (mounted.current) setPage(result);
    } catch (cause) {
      if (mounted.current) {
        if (
          cause instanceof ScadaApiError &&
          (cause.kind === "unauthenticated" ||
            cause.kind === "forbidden" ||
            cause.kind === "not_found")
        ) {
          setPage(browser.reset());
        }
        setError(
          cause instanceof ScadaApiError
            ? cause.message
            : "工程列表读取失败，请检查登录与服务端连接",
        );
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }

  return (
    <details
      className="studio-version-menu studio-project-browser-menu"
      onToggle={(event) => {
        if (event.currentTarget.open) void loadPage("refresh");
      }}
    >
      <summary>工程管理</summary>
      <section className="studio-version-panel studio-project-browser-panel" aria-label="授权工程管理">
        <div className="studio-project-browser-heading">
          <div>
            <strong>服务端工程</strong>
            <p className="studio-version-help">仅显示已授权工程，不包含完整组态文件</p>
          </div>
          <button type="button" disabled={disabled || loading} onClick={() => void loadPage("refresh")}>
            刷新
          </button>
        </div>
        <p className="studio-version-help">
          打开其他工程前会校验最新修订号；本地草稿不会删除，也不会自动发布。
        </p>
        {loading && <p role="status" className="studio-version-help">正在读取授权工程…</p>}
        {error && <p role="alert" className="studio-version-error">{error}</p>}
        {page.loaded && !loading && page.projects.length === 0 && (
          <p className="studio-project-browser-empty" role="status">当前页暂无可访问的工程。</p>
        )}
        <ul className="studio-project-browser-list">
          {page.projects.map((project) => (
            <li key={project.projectId} className="studio-project-browser-item">
              <div className="studio-project-browser-info">
                <code title={project.projectId}>{project.projectId}</code>
                {project.projectId === currentProjectId && (
                  <span className="studio-project-browser-current">当前编辑</span>
                )}
                <small>
                  修订 #{project.headRevision} · 最近更新：
                  <time dateTime={project.updatedAt}>
                    {new Date(project.updatedAt).toLocaleString("zh-CN")}
                  </time>
                </small>
              </div>
              <button
                type="button"
                disabled={disabled || loading}
                aria-label={"打开工程 " + project.projectId}
                onClick={() => void onOpen(project.projectId, project.headRevision)}
              >
                打开
              </button>
            </li>
          ))}
        </ul>
        <div className="studio-project-browser-pagination">
          <button
            type="button"
            disabled={disabled || loading || !page.hasPrevious}
            onClick={() => void loadPage("previous")}
          >
            上一页
          </button>
          <span role="status">
            第 {page.pageNumber} 页 · 每页 {STUDIO_PROJECT_PAGE_SIZE} 条
          </span>
          <button
            type="button"
            disabled={disabled || loading || !page.hasNext}
            onClick={() => void loadPage("next")}
          >
            下一页
          </button>
        </div>
      </section>
    </details>
  );
}
