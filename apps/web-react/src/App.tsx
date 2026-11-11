import { lazy, Suspense, useState } from "react";

const RuntimePage = lazy(() => import("./runtime/RuntimePage.tsx"));
const StudioPage = lazy(() => import("./studio/StudioPage.tsx"));

export default function App() {
  const [view, setView] = useState<"runtime" | "studio">("runtime");
  return (
    <>
      <nav className="scada-app-nav" aria-label="功能导航">
        <span className="scada-app-brand"><img src="/brand/favicon.svg" alt="" aria-hidden="true" />ADui SCADA</span>
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
      <Suspense fallback={<main role="status">正在加载页面...</main>}>
        {view === "runtime" ? <RuntimePage /> : <StudioPage />}
      </Suspense>
    </>
  );
}
