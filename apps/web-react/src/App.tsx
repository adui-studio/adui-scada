import { Button } from "tdesign-react";
import "tdesign-react/es/style/index.css";
import { lazy, Suspense, useState } from "react";

const RuntimePage = lazy(() => import("./runtime/RuntimePage.tsx"));
const PublishedRuntimePage = lazy(() => import("./runtime/PublishedRuntimePage.tsx"));
const StudioPage = lazy(() => import("./studio/StudioPage.tsx"));

type AppView = "runtime" | "published" | "studio";

const viewLabels: Record<AppView, string> = {
  runtime: "运行监控",
  published: "已发布运行",
  studio: "组态编辑",
};

/** 双端同一信息架构：主功能导航独立于工程工作区，运行与编辑不会混淆。 */
export default function App() {
  const [view, setView] = useState<AppView>("runtime");
  return (
    <div className="scada-app-frame" data-view={view}>
      <a className="scada-skip-link" href="#scada-main-content">
        跳转到主要内容
      </a>
      <nav className="scada-app-nav" aria-label="功能导航">
        <div className="scada-rail-brand">
          <span className="scada-app-brand">
            <img src="/brand/favicon.svg" alt="" aria-hidden="true" />
            <strong>ADui</strong>
          </span>
          <span className="scada-rail-product">SCADA</span>
        </div>
        <span className="scada-nav-kicker">工作空间</span>
        <div className="scada-nav-items">
          <Button
            tag="button"
            type="button"
            aria-current={view === "runtime" ? "page" : undefined}
            onClick={() => setView("runtime")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M3 19h18M5 16V8m5 8V5m5 11v-6m4 6V7" strokeLinecap="round" />
            </svg>
            <span>运行监控</span>
          </Button>
          <Button
            tag="button"
            type="button"
            aria-current={view === "published" ? "page" : undefined}
            onClick={() => setView("published")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="4" y="3" width="16" height="18" rx="2" />
              <path d="M8 8h8M8 12h8M8 16h4" strokeLinecap="round" />
            </svg>
            <span>已发布运行</span>
          </Button>
          <Button
            tag="button"
            type="button"
            aria-current={view === "studio" ? "page" : undefined}
            onClick={() => setView("studio")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
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
          <span className="scada-app-safety">只读演示 · 非现场控制</span>
        </header>
        <Suspense
          fallback={
            <main id="scada-main-content" className="scada-loading" role="status">
              正在加载工作区…
            </main>
          }
        >
          {view === "runtime" ? (
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
