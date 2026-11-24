import { Button, Input, Switch, Upload } from "tdesign-react";
import {
  AppIcon,
  ChartBarIcon,
  FileIcon,
  EditIcon,
  SunnyIcon,
  MoonIcon,
  AddIcon,
  UploadIcon,
  ChevronRightIcon,
} from "tdesign-icons-react";
import { waterTreatmentShowcaseDocument } from "@adui/scada-core";
import type { ScadaDocument } from "@adui/scada-core";
import {
  createWorkspaceDraft,
  listWorkspaceDrafts,
  readWorkspaceDraft,
  readWorkspaceJson,
  readWorkspaceStudioRoute,
} from "@adui/scada-draft-storage";
import type { WorkspaceDraftSummary } from "@adui/scada-draft-storage";
import {
  WORKSPACE_HOME_ENTRIES,
  filterWorkspaceHomeEntries,
  readWorkspaceTheme,
  transitionWorkspaceTheme,
  WORKSPACE_ROUTE_PATHS,
  workspaceViewFromRouteName,
  workspaceStudioPath,
  stageWorkspaceStudioEntry,
  takeWorkspaceStudioEntry,
} from "@adui/scada-runtime";
import type { WorkspaceView, WorkspaceStudioEntry } from "@adui/scada-runtime";
import "tdesign-react/es/style/index.css";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Outlet, useMatches, useNavigate, useOutletContext, useParams } from "react-router";

const StudioPage = lazy(() => import("./studio/StudioPage.tsx"));

type AppView = WorkspaceView;

const viewLabels: Record<AppView, string> = {
  home: "工作台",
  runtime: "运行监控",
  published: "已发布运行",
  studio: "组态编辑",
};

/** 双端同一信息架构：主功能导航独立于工程工作区，运行与编辑不会混淆。 */
export default function App() {
  const view = workspaceViewFromRouteName(useMatches().at(-1)?.id);
  const routerNavigate = useNavigate();
  const [themeMode, setThemeMode] = useState(readWorkspaceTheme);

  function changeTheme(checked: unknown) {
    if (typeof checked !== "boolean") return;
    const next = checked ? "dark" : "light";
    void transitionWorkspaceTheme(next, () => {
      flushSync(() => setThemeMode(next));
    });
  }
  function navigate(next: AppView) {
    if (next !== view) void routerNavigate(WORKSPACE_ROUTE_PATHS[next]);
  }
  return (
    <div className="scada-app-frame" data-view={view}>
      <button
        className="scada-skip-link"
        type="button"
        onClick={() => {
          const main = document.getElementById("scada-main-content");
          if (main) {
            main.tabIndex = -1;
            main.focus();
          }
        }}
      >
        跳转到主要内容
      </button>
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
            <span className="scada-button-content">
              <AppIcon aria-hidden="true" />
              <span className="scada-button-label">工作台</span>
            </span>
          </Button>
          <Button
            tag="button"
            type="button"
            title="运行监控"
            aria-current={view === "runtime" ? "page" : undefined}
            onClick={() => navigate("runtime")}
          >
            <span className="scada-button-content">
              <ChartBarIcon aria-hidden="true" />
              <span className="scada-button-label">运行监控</span>
            </span>
          </Button>
          <Button
            tag="button"
            type="button"
            title="已发布运行"
            aria-current={view === "published" ? "page" : undefined}
            onClick={() => navigate("published")}
          >
            <span className="scada-button-content">
              <FileIcon aria-hidden="true" />
              <span className="scada-button-label">已发布运行</span>
            </span>
          </Button>
          <Button
            tag="button"
            type="button"
            title="组态编辑"
            aria-current={view === "studio" ? "page" : undefined}
            onClick={() => navigate("studio")}
          >
            <span className="scada-button-content">
              <EditIcon aria-hidden="true" />
              <span className="scada-button-label">组态编辑</span>
            </span>
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
            <span className="scada-theme-control">
              <Switch
                className="scada-theme-toggle"
                size="medium"
                value={themeMode === "dark"}
                aria-label="深色主题"
                aria-checked={themeMode === "dark"}
                onChange={changeTheme}
              />
              <span className="scada-theme-icons" aria-hidden="true">
                <SunnyIcon className="scada-theme-sun" />
                <MoonIcon className="scada-theme-moon" />
              </span>
            </span>
          </div>
        </header>
        <Suspense
          fallback={
            <main id="scada-main-content" className="scada-loading" role="status">
              正在加载工作区…
            </main>
          }
        >
          <Outlet context={themeMode} />
        </Suspense>
      </div>
    </div>
  );
}

/** 工作台只负责显式工程入口，路由与 URL 不保存工程正文。 */
export function WorkspaceHomeRoute() {
  const themeMode = useOutletContext<"light" | "dark">();
  const navigate = useNavigate();
  return (
    <WorkspaceHome
      themeMode={themeMode}
      onNavigate={(view) => void navigate(WORKSPACE_ROUTE_PATHS[view])}
      onOpenDocument={(document, notice, clean) => {
        stageWorkspaceStudioEntry({ document, notice, clean });
        void navigate(workspaceStudioPath(document.projectId));
      }}
    />
  );
}

/** 编辑器内部切换工程只替换地址，不重建编辑器。 */
export function StudioWorkspaceRoute() {
  const { projectId } = useParams<"projectId">();
  const themeMode = useOutletContext<"light" | "dark">();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<{ entry: WorkspaceStudioEntry; session: number } | null>(null);
  const [error, setError] = useState("");
  const session = useRef(0);
  const activeRoute = useRef<string | null>(null);
  const activeProject = useRef<string | null>(null);

  useEffect(() => {
    const routeId = projectId ?? "";
    if (activeRoute.current === routeId) return;
    if (projectId !== undefined && activeProject.current === projectId) {
      activeRoute.current = routeId;
      return;
    }
    const controller = new AbortController();
    setLoaded(null);
    setError("");
    activeRoute.current = null;
    activeProject.current = null;
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      try {
        const entry = takeWorkspaceStudioEntry(projectId) ?? (await readWorkspaceStudioRoute(projectId));
        if (controller.signal.aborted) return;
        activeRoute.current = routeId;
        activeProject.current = entry.document.projectId;
        session.current += 1;
        setLoaded({ entry, session: session.current });
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "工程载入失败");
        }
      }
    });
    return () => controller.abort();
  }, [projectId]);

  if (!loaded) {
    return (
      <main id="scada-main-content" className="scada-loading" role={error ? "alert" : "status"}>
        {error || "正在读取组态工程…"}
        {error && <Button onClick={() => void navigate("/")}>返回工作台</Button>}
      </main>
    );
  }
  return (
    <StudioPage
      key={loaded.session}
      initialDocument={loaded.entry.document}
      initialNotice={loaded.entry.notice}
      initialClean={loaded.entry.clean}
      themeMode={themeMode}
      onProjectChange={(id) => {
        activeProject.current = id;
        activeRoute.current = id;
        void navigate(workspaceStudioPath(id), { replace: true });
      }}
    />
  );
}

/** 不虚构最近文件，只展示真实存在的工作入口与内置模拟工程。 */
function WorkspaceHome({
  onNavigate,
  onOpenDocument,
  themeMode,
}: {
  themeMode: "light" | "dark";
  onNavigate: (view: AppView) => void;
  onOpenDocument: (document: ScadaDocument, notice: string, clean: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<readonly WorkspaceDraftSummary[]>([]);
  const [draftStatus, setDraftStatus] = useState("正在读取本地草稿…");
  const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const operation = useRef(false);
  const entries = filterWorkspaceHomeEntries(query);
  const visibleDrafts = drafts.filter((draft) =>
    [draft.projectName, draft.projectId].some((value) =>
      value.toLowerCase().includes(query.trim().toLowerCase()),
    ),
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
      onOpenDocument(waterTreatmentShowcaseDocument, "已打开水处理总览示例 · 静态模拟预览", true);
    } else {
      onNavigate(view);
    }
  }

  async function openFromHome(load: () => Promise<WorkspaceStudioEntry>) {
    const controller = lifetime.current;
    if (!controller || controller.signal.aborted || operation.current) return;
    operation.current = true;
    setBusy(true);
    try {
      const result = await load();
      if (!controller.signal.aborted) onOpenDocument(result.document, result.notice, result.clean);
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
              return { document: draft.document, notice: "已创建并保存独立本地工程", clean: true };
            });
          }}
        >
          <span className="scada-home-card-icon" aria-hidden="true">
            <AddIcon />
          </span>
          <strong>新建组态工程</strong>
          <ChevronRightIcon aria-hidden="true" />
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
                  clean: false,
                  notice: result.migratedFrom
                    ? `已从 ${result.migratedFrom} 迁移工程，请重新保存或导出`
                    : "工程 JSON 已校验，请按需保存本地草稿",
                };
              });
            }}
          >
            <button type="button" className="scada-home-quick" disabled={busy}>
              <span className="scada-home-card-icon" aria-hidden="true">
                <UploadIcon />
              </span>
              <strong>导入 JSON 工程</strong>
              <ChevronRightIcon aria-hidden="true" />
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
            <ChevronRightIcon aria-hidden="true" />
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
            <img
              className="scada-home-brand-mark"
              src={themeMode === "dark" ? "/brand/mark-dark.svg" : "/brand/mark-primary.svg"}
              alt=""
            />
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
                  return { document: latest.document, notice: "已打开最新本地草稿", clean: true };
                });
              }}
            >
              <strong title={draft.projectId}>{draft.projectName}</strong>
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

/** 复用已安装的 TDesign 图标，标识真实功能入口。 */
function HomeCardIcon({ view }: { view: AppView }) {
  if (view === "studio") return <EditIcon aria-hidden="true" />;
  if (view === "runtime") return <ChartBarIcon aria-hidden="true" />;
  return <FileIcon aria-hidden="true" />;
}
