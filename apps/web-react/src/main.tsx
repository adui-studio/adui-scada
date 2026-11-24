import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "tdesign-react/es/_util/react-19-adapter";
import App, { StudioWorkspaceRoute, WorkspaceHomeRoute } from "./App.tsx";
import { createHashRouter, Navigate } from "react-router";
import { RouterProvider } from "react-router/dom";
import "@adui/normalize.css/all.css";
import "@adui/tailwind/styles.css";
import "@adui/scada-runtime/styles.css";
import { applyWorkspaceTheme, readWorkspaceTheme } from "@adui/scada-runtime";

applyWorkspaceTheme(readWorkspaceTheme());

const mount = document.getElementById("root");
if (!mount) throw new Error("未找到页面挂载节点 #root");
const router = createHashRouter([
  {
    path: "/",
    Component: App,
    children: [
      { index: true, id: "home", Component: WorkspaceHomeRoute },
      {
        path: "runtime",
        id: "runtime",
        lazy: async () => ({ Component: (await import("./runtime/RuntimePage.tsx")).default }),
      },
      {
        path: "published",
        id: "published",
        lazy: async () => ({
          Component: (await import("./runtime/PublishedRuntimePage.tsx")).default,
        }),
      },
      { path: "studio/:projectId?", id: "studio", Component: StudioWorkspaceRoute },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
createRoot(mount).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
