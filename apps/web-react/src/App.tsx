import { lazy, Suspense, useState } from "react";

const RuntimePage = lazy(() => import("./runtime/RuntimePage.tsx"));
const StudioPage = lazy(() => import("./studio/StudioPage.tsx"));

export default function App() {
  const [view, setView] = useState<"runtime" | "studio">("runtime");
  return (
    <div
      className={
        view === "studio"
          ? "flex h-dvh min-h-0 flex-col overflow-hidden"
          : "flex min-h-dvh flex-col"
      }
    >
      <nav className="scada-app-nav shrink-0" aria-label="功能导航">
        <span className="scada-app-brand">
          <img src="/brand/favicon.svg" alt="" aria-hidden="true" />
          ADui SCADA
        </span>
        <button
          type="button"
          aria-current={view === "runtime" ? "page" : undefined}
          onClick={() => setView("runtime")}
        >
          运行监控
        </button>
        <button
          type="button"
          aria-current={view === "studio" ? "page" : undefined}
          onClick={() => setView("studio")}
        >
          组态编辑
        </button>
        <span className="scada-app-version">V0.2 本地原型</span>
      </nav>
      <Suspense fallback={<main className="min-h-0 flex-1 p-4" role="status">正在加载页面...</main>}>
        {view === "runtime" ? <RuntimePage /> : <StudioPage />}
      </Suspense>
    </div>
  );
}
