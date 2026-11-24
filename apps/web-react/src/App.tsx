import { Button } from "tdesign-react";
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
            <strong>ADui</strong>
          </span>
          <span className="scada-rail-product">SCADA</span>
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
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
          <span className="scada-app-safety">只读演示 · 非现场控制</span>
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
  const entries: { view: AppView; icon: string; title: string; description: string }[] = [
    { view: "studio", icon: "▣", title: "打开组态编辑器", description: "设计 1920 × 1080 画板，管理图层和 Tag" },
    { view: "runtime", icon: "◉", title: "查看模拟运行", description: "监控水处理模拟状态、链路和质量" },
    { view: "published", icon: "▤", title: "查看已发布工程", description: "经受控接口读取只读发布快照" },
  ];
  return (
    <main id="scada-main-content" className="scada-home">
      <div className="scada-home-heading">
        <span className="scada-home-eyebrow">ADui Studio / 工作空间</span>
        <h1>你的工业设计工作台</h1>
        <p>从组态画布到只读监控，在同一个工作区完成开发与验证。</p>
      </div>
      <section className="scada-home-section" aria-labelledby="scada-home-start">
        <div className="scada-home-section-head">
          <h2 id="scada-home-start">开始工作</h2>
          <span>选择现有功能</span>
        </div>
        <div className="scada-home-card-grid">
          {entries.map((entry) => (
            <button
              key={entry.view}
              type="button"
              className="scada-home-card"
              onClick={() => onNavigate(entry.view)}
            >
              <span className="scada-home-card-icon" aria-hidden="true">{entry.icon}</span>
              <strong>{entry.title}</strong>
              <span>{entry.description}</span>
              <small>打开 <span aria-hidden="true">↗</span></small>
            </button>
          ))}
        </div>
      </section>
      <section className="scada-home-section" aria-labelledby="scada-home-demo">
        <div className="scada-home-section-head">
          <h2 id="scada-home-demo">内置演示</h2>
          <span>本地示例，不代表最近打开的真实工程</span>
        </div>
        <button type="button" className="scada-home-project" onClick={() => onNavigate("studio")}>
          <span className="scada-home-project-preview" aria-hidden="true">
            <span className="scada-home-preview-tank" />
            <span className="scada-home-preview-pipe" />
            <span className="scada-home-preview-pump" />
          </span>
          <span className="scada-home-project-detail">
            <strong>水处理演示工程</strong>
            <span>本地模拟 · Studio 默认画板 1920 × 1080</span>
          </span>
        </button>
      </section>
      <p className="scada-home-footnote">
        最近文件尚无可信统一数据源。已有浏览器草稿请在 Studio 文件菜单中查看和恢复；
        本页不开放现场设备控制。
      </p>
    </main>
  );
}
