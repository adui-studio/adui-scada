import { lazy, Suspense } from "react";

// Studio will become a lazily loaded route once implemented.
const RuntimePage = lazy(() => import("./runtime/RuntimePage.tsx"));

export default function App() {
  return (
    <Suspense fallback={<main role="status">正在加载监控页面...</main>}>
      <RuntimePage />
    </Suspense>
  );
}
