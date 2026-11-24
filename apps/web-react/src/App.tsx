import { Button, Input, Upload } from "tdesign-react";
import { waterTreatmentShowcaseDocument } from "@adui/scada-core";
import type { ScadaDocument } from "@adui/scada-core";
import {
  createWorkspaceDraft,
  listWorkspaceDrafts,
  readWorkspaceDraft,
  readWorkspaceJson,
} from "@adui/scada-draft-storage";
import type { WorkspaceDraftSummary } from "@adui/scada-draft-storage";
import {
  WORKSPACE_HOME_ENTRIES,
  filterWorkspaceHomeEntries,
  readWorkspaceTheme,
  applyWorkspaceTheme,
} from "@adui/scada-runtime";
import "tdesign-react/es/style/index.css";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

const RuntimePage = lazy(() => import("./runtime/RuntimePage.tsx"));
const PublishedRuntimePage = lazy(() => import("./runtime/PublishedRuntimePage.tsx"));
const StudioPage = lazy(() => import("./studio/StudioPage.tsx"));

type AppView = "home" | "runtime" | "published" | "studio";

const viewLabels: Record<AppView, string> = {
  home: "工作台",
  runtime: "运行监控",
  published: "已发布运行",
  studio: "组态编辑",
};

/** 双端同一信息架构：主功能导航独立于工程工作区，运行与编辑不会混淆。 */
export default function App() {
  const [view, setView] = useState<AppView>("home");
  const [themeMode, setThemeMode] = useState(readWorkspaceTheme);

  function toggleTheme() {
    const next = themeMode === "light" ? "dark" : "light";
    applyWorkspaceTheme(next);
    setThemeMode(next);
  }
  const [initialDocument, setInitialDocument] = useState<ScadaDocument | null>(null);
  const [initialNotice, setInitialNotice] = useState("");

  function navigate(next: AppView) {
    if (next === "studio" && view !== "studio") {
      setInitialDocument(null);
      setInitialNotice("");
    }
    setView(next);
  }

  function openDocument(document: ScadaDocument, notice: string) {
    setInitialDocument(document);
    setInitialNotice(notice);
    setView("studio");
  }
  return (
    <div className="scada-app-frame" data-view={view}>
      <a className="scada-skip-link" href="#scada-main-content">
        跳转到主要内容
      </a>
      <nav className="scada-app-nav" aria-label="功能导航">
        <div className="scada-rail-brand">
          <span className="scada-app-brand">
            <img
              src={themeMode === "dark" ? "/brand/mark-dark.svg" : "/brand/mark-primary.svg"}
              alt=""
              aria-hidden="true"
            />
            <strong>ADui SCADA</strong>
          </span>
          <span className="scada-rail-product">ADui Studio</span>
        </div>
        <span className="scada-nav-kicker">工作空间</span>
        <div className="scada-nav-items">
          <Button
            tag="button"
            type="button"
            title="工作台"
            aria-current={view === "home" ? "page" : undefined}
            onClick={() => navigate("home")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
              <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
              <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
              <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
            </svg>
            <span>工作台</span>
          </Button>
          <Button
            tag="button"
            type="button"
            title="运行监控"
            aria-current={view === "runtime" ? "page" : undefined}
            onClick={() => navigate("runtime")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M3 19h18M5 16V8m5 8V5m5 11v-6m4 6V7" strokeLinecap="round" />
            </svg>
            <span>运行监控</span>
          </Button>
          <Button
            tag="button"
            type="button"
            title="已发布运行"
            aria-current={view === "published" ? "page" : undefined}
            onClick={() => navigate("published")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <rect x="4" y="3" width="16" height="18" rx="2" />
              <path d="M8 8h8M8 12h8M8 16h4" strokeLinecap="round" />
            </svg>
            <span>已发布运行</span>
          </Button>
          <Button
            tag="button"
            type="button"
            title="组态编辑"
            aria-current={view === "studio" ? "page" : undefined}
            onClick={() => navigate("studio")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M4 4h16v16H4zM4 9h16M9 9v11" strokeLinejoin="round" />
              <path d="m13 15 2 2 4-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>组态编辑</span>
          </Button>
        </div>
        <div className="scada-rail-footer">
          <span className="scada-rail-environment">开发演示环境</span>
          <span className="scada-app-version">仅供开发验证</span>
        </div>
      </nav>
      <div className="scada-app-content">
        <header className="scada-app-topbar">
          <div className="scada-app-breadcrumb">
            <span>工作空间</span>
            <span aria-hidden="true">/</span>
            <strong>{viewLabels[view]}</strong>
          </div>
          <div className="scada-app-header-actions">
          <span className="scada-app-safety">
            {view === "studio"
              ? "本地组态编辑 · 非现场控制"
              : view === "published"
                ? "受控只读预览 · 非现场控制"
                : view === "runtime"
                  ? "模拟只读监控 · 非现场控制"
                  : "开发工作台 · 非现场控制"}
          </span>
          <Button
            type="button"
            theme="default"
            variant="text"
            className="scada-theme-toggle"
            aria-label="切换深色主题"
            aria-pressed={themeMode === "dark"}
            title={themeMode === "dark" ? "切换浅色主题" : "切换深色主题"}
            onClick={toggleTheme}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              {themeMode === "dark" ? (
                <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>
              ) : (
                <path d="M20 15.5A9 9 0 0 1 8.5 4 9 9 0 1 0 20 15.5Z" />
              )}
            </svg>
            {themeMode === "dark" ? "浅色" : "深色"}
          </Button>
          </div>
        </header>
        <Suspense
          fallback={
            <main id="scada-main-content" className="scada-loading" role="status">
              正在加载工作区…
            </main>
          }
        >
          {view === "home" ? (
            <WorkspaceHome onNavigate={navigate} onOpenDocument={openDocument} />
          ) : view === "runtime" ? (
            <RuntimePage />
          ) : view === "published" ? (
            <PublishedRuntimePage />
          ) : (
            <StudioPage initialDocument={initialDocument} initialNotice={initialNotice} />
          )}
        </Suspense>
      </div>
    </div>
  );
}

/** 不虚构最近文件，只展示真实存在的工作入口与内置模拟工程。 */
function WorkspaceHome({
  onNavigate,
  onOpenDocument,
}: {
  onNavigate: (view: AppView) => void;
  onOpenDocument: (document: ScadaDocument, notice: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<readonly WorkspaceDraftSummary[]>([]);
  const [draftStatus, setDraftStatus] = useState("正在读取本地草稿…");
  const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const operation = useRef(false);
  const entries = filterWorkspaceHomeEntries(query);
  const visibleDrafts = drafts.filter((draft) =>
    draft.projectId.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void listWorkspaceDrafts().then(
      (rows) => {
        if (controller.signal.aborted) return;
        setDrafts(rows);
        setDraftStatus(rows.length ? "" : "暂无已保存的本地草稿");
      },
      () => {
        if (!controller.signal.aborted) setDraftStatus("本地草稿读取失败，请检查浏览器存储权限");
      },
    );
    return () => controller.abort();
  }, []);

  function openEntry(view: AppView) {
    if (view === "studio") {
      onOpenDocument(waterTreatmentShowcaseDocument, "已打开水处理总览示例 · 静态模拟预览");
    } else {
      onNavigate(view);
    }
  }

  async function openFromHome(load: () => Promise<{ document: ScadaDocument; notice: string }>) {
    const controller = lifetime.current;
    if (!controller || controller.signal.aborted || operation.current) return;
    operation.current = true;
    setBusy(true);
    try {
      const result = await load();
      if (!controller.signal.aborted) onOpenDocument(result.document, result.notice);
    } catch {
      if (!controller.signal.aborted) setDraftStatus("工程操作失败，请检查文件或本地存储");
    } finally {
      operation.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <main id="scada-main-content" className="scada-home flex min-w-0 flex-col">
      <div className="scada-home-heading flex flex-wrap items-center justify-between">
        <div>
          <h1>工程工作区</h1>
          <p>设计、管理与只读监控</p>
        </div>
        <div className="scada-home-search">
          <Input
            value={query}
            onChange={setQuery}
            placeholder="搜索工作区、工程、Tag"
            aria-label="搜索工作区"
            clearable
          />
        </div>
      </div>
      <div className="scada-home-quick-grid grid">
        <button
          type="button"
          className="scada-home-quick"
          disabled={busy}
          onClick={() => {
            void openFromHome(async () => {
              const draft = await createWorkspaceDraft();
              return { document: draft.document, notice: "已创建并保存独立本地工程" };
            });
          }}
        >
          <span className="scada-home-card-icon" aria-hidden="true">
            +
          </span>
          <strong>新建组态工程</strong>
          <span aria-hidden="true">↗</span>
        </button>
        <div className="scada-home-upload">
          <Upload
            theme="custom"
            accept=".json,application/json"
            autoUpload={false}
            files={[]}
            allowUploadDuplicateFile
            disabled={busy}
            onSelectChange={(files) => {
              const file = files[0];
              if (!file) return;
              void openFromHome(async () => {
                const result = await readWorkspaceJson(file);
                return {
                  document: result.document,
                  notice: result.migratedFrom
                    ? `已从 ${result.migratedFrom} 迁移工程，请重新保存或导出`
                    : "工程 JSON 已校验，请按需保存本地草稿",
                };
              });
            }}
          >
            <button type="button" className="scada-home-quick" disabled={busy}>
              <span className="scada-home-card-icon" aria-hidden="true">
                ↥
              </span>
              <strong>导入 JSON 工程</strong>
              <span aria-hidden="true">↗</span>
            </button>
          </Upload>
        </div>
        {WORKSPACE_HOME_ENTRIES.map((entry) => (
          <button
            key={entry.view}
            type="button"
            className="scada-home-quick"
            onClick={() => openEntry(entry.view)}
          >
            <span className="scada-home-card-icon" aria-hidden="true">
              <HomeCardIcon view={entry.view} />
            </span>
            <strong>{entry.action}</strong>
            <span aria-hidden="true">↗</span>
          </button>
        ))}
      </div>
      <section className="scada-home-section" aria-labelledby="scada-home-explore">
        <div className="scada-home-section-head">
          <h2 id="scada-home-explore">探索 ADui SCADA</h2>
          <span>工业可视化与组态</span>
        </div>
        <div className="scada-home-banner-grid grid">
          <article className="scada-home-banner scada-home-banner-brand">
            <div>
              <strong>ADui SCADA</strong>
              <p>工业组态 · 实时监控</p>
              <small>从工艺画面开始构建工程</small>
            </div>
            <img className="scada-home-brand-mark" src="/brand/mark-primary.svg" alt="" />
          </article>
          <article className="scada-home-banner">
            <div>
              <strong>精密组态设计</strong>
              <p>1920 × 1080 默认画板</p>
              <small>图层、图元、属性与 Tag</small>
            </div>
            <HomeCardIcon view="studio" />
          </article>
          <article className="scada-home-banner scada-home-banner-runtime">
            <div>
              <strong>只读运行监控</strong>
              <p>模拟数据与正式发布分离</p>
              <small>设备写入未开放</small>
            </div>
            <HomeCardIcon view="runtime" />
          </article>
        </div>
      </section>
      <section className="scada-home-section" aria-labelledby="scada-home-start">
        <div className="scada-home-section-head">
          <h2 id="scada-home-start">工程与工作区</h2>
          <span>共 {entries.length} 个入口</span>
        </div>
        <div className="scada-home-card-grid grid">
          {entries.map((entry) => (
            <button
              key={entry.view}
              type="button"
              className="scada-home-card"
              onClick={() => openEntry(entry.view)}
            >
              <span className="scada-home-thumbnail" data-kind={entry.view}>
                {entry.preview ? (
                  <img src={entry.preview} alt="内置水处理工程静态预览，无实时值" />
                ) : (
                  <span aria-hidden="true">
                    <HomeCardIcon view={entry.view} />
                  </span>
                )}
              </span>
              <strong>{entry.title}</strong>
              <span className="scada-home-status" data-kind={entry.view}>
                {entry.status}
              </span>
              <span className="scada-home-description">{entry.description}</span>
              <small>{entry.detail}</small>
            </button>
          ))}
        </div>
        {entries.length === 0 && <p role="status">没有匹配的工作区，请尝试其他关键词。</p>}
      </section>
      <section className="scada-home-section" aria-labelledby="scada-home-drafts">
        <div className="scada-home-section-head">
          <h2 id="scada-home-drafts">我的草稿</h2>
          <span>最近 50 个已保存的本地工程</span>
        </div>
        {draftStatus && <p role="status">{draftStatus}</p>}
        {drafts.length > 0 && visibleDrafts.length === 0 && <p>没有匹配的本地草稿</p>}
        <div className="scada-home-draft-grid">
          {visibleDrafts.map((draft) => (
            <button
              key={draft.projectId}
              type="button"
              className="scada-home-draft"
              disabled={busy}
              onClick={() => {
                void openFromHome(async () => {
                  const latest = await readWorkspaceDraft(draft.projectId);
                  return { document: latest.document, notice: "已打开最新本地草稿" };
                });
              }}
            >
              <strong>{draft.projectId}</strong>
              <span>
                {draft.pageCount} 个页面 · {draft.tagCount} 个 Tag
              </span>
              <small>
                修订 {draft.revision} · {new Date(draft.savedAt).toLocaleString("zh-CN")}
              </small>
            </button>
          ))}
        </div>
      </section>
      <p className="scada-home-footnote">草稿仅保存在当前浏览器；本页不展示未经核实的发布状态。</p>
    </main>
  );
}

/** 仅使用通用矢量图形标识实际入口，不引入第三方专有图标资产。 */
function HomeCardIcon({ view }: { view: AppView }) {
  const drawing =
    view === "studio" ? (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 8h18M9 8v13" />
      </>
    ) : view === "runtime" ? (
      <>
        <path d="M3 19h18M5 16V9m5 7V5m5 11v-4m4 4V7" strokeLinecap="round" />
      </>
    ) : (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h4" strokeLinecap="round" />
      </>
    );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {drawing}
    </svg>
  );
}
