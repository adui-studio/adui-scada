import { Button } from "tdesign-react";
import "tdesign-react/es/style/index.css";
import { lazy, Suspense, useState } from "react";

const RuntimePage = lazy(() => import("./runtime/RuntimePage.tsx"));
const PublishedRuntimePage = lazy(() => import("./runtime/PublishedRuntimePage.tsx"));
const StudioPage = lazy(() => import("./studio/StudioPage.tsx"));

export default function App() {
  const [view, setView] = useState<"runtime" | "published" | "studio">("runtime");
  return (
    <div
      className={
        view === "studio"
          ? "flex h-dvh min-h-0 flex-col overflow-hidden"
          : "flex min-h-dvh flex-col"
      }
    >
      <a className="scada-skip-link" href="#scada-main-content">
        跳转到主要内容
      </a>
      <nav className="scada-app-nav shrink-0" aria-label="功能导航">
        <span className="scada-app-brand">
          <img src="/brand/favicon.svg" alt="" aria-hidden="true" />
          ADui SCADA
        </span>
        <Button
          tag="button"
          type="button"
          aria-current={view === "runtime" ? "page" : undefined}
          onClick={() => setView("runtime")}
        >
          运行监控
        </Button>
        <Button
          tag="button"
          type="button"
          aria-current={view === "published" ? "page" : undefined}
          onClick={() => setView("published")}
        >
          已发布运行
        </Button>
        <Button
          tag="button"
          type="button"
          aria-current={view === "studio" ? "page" : undefined}
          onClick={() => setView("studio")}
        >
          组态编辑
        </Button>
        <span className="scada-app-version">研发预览 · 非现场控制</span>
      </nav>
      <Suspense
        fallback={
          <main id="scada-main-content" className="min-h-0 flex-1 p-4" role="status">
            正在加载页面…
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
  );
}
