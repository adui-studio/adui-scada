import { Button, Input } from "tdesign-react";
import { WORKSPACE_HOME_ENTRIES, filterWorkspaceHomeEntries } from "@adui/scada-runtime";
import "tdesign-react/es/style/index.css";
import { lazy, Suspense, useState } from "react";

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
  return (
    <div className="scada-app-frame" data-view={view}>
      <a className="scada-skip-link" href="#scada-main-content">
        跳转到主要内容
      </a>
      <nav className="scada-app-nav" aria-label="功能导航">
        <div className="scada-rail-brand">
          <span className="scada-app-brand">
            <img src="/brand/favicon.svg" alt="" aria-hidden="true" />
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
            onClick={() => setView("home")}
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
            onClick={() => setView("runtime")}
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
            onClick={() => setView("published")}
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
            onClick={() => setView("studio")}
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
          <span className="scada-app-safety">
            {view === "studio"
              ? "本地组态编辑 · 非现场控制"
              : view === "published"
                ? "受控只读预览 · 非现场控制"
                : view === "runtime"
                  ? "模拟只读监控 · 非现场控制"
                  : "开发工作台 · 非现场控制"}
          </span>
        </header>
        <Suspense
          fallback={
            <main id="scada-main-content" className="scada-loading" role="status">
              正在加载工作区…
            </main>
          }
        >
          {view === "home" ? (
            <WorkspaceHome onNavigate={setView} />
          ) : view === "runtime" ? (
            <RuntimePage />
          ) : view === "published" ? (
            <PublishedRuntimePage />
          ) : (
            <StudioPage />
          )}
        </Suspense>
      </div>
    </div>
  );
}

/** 不虚构最近文件，只展示真实存在的工作入口与内置模拟工程。 */
function WorkspaceHome({ onNavigate }: { onNavigate: (view: AppView) => void }) {
  const [query, setQuery] = useState("");
  const entries = filterWorkspaceHomeEntries(query);

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
        {WORKSPACE_HOME_ENTRIES.map((entry) => (
          <button
            key={entry.view}
            type="button"
            className="scada-home-quick"
            onClick={() => onNavigate(entry.view)}
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
            <img src="/brand/favicon.svg" alt="" />
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
              onClick={() => onNavigate(entry.view)}
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
      <p className="scada-home-footnote">
        已有浏览器草稿请在 Studio 文件菜单中查看和恢复。本页不展示未经核实的最近文件或发布状态。
      </p>
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
