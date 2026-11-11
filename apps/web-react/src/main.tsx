import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "@adui/normalize.css";
import "./tailwind.css";
import "@adui/scada-runtime/styles.css";

const mount = document.getElementById("root");
if (!mount) throw new Error("未找到页面挂载节点 #root");
createRoot(mount).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
