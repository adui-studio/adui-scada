import tailwindcss from "@adui/tailwind/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins, loadEnv } from "vite-plus";
import { fileURLToPath } from "node:url";
import { resolveLoopbackOidcHttpsProxy } from "../../scripts/oidc-https-dev-proxy.mjs";

// 两套 Web 均读取仓库根目录唯一的 .env，不受 vp -C 工作目录影响。
const envDir = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode, command }) => {
  // SCADA_* 仅用于服务端配置；Vite 只向浏览器公开 VITE_* 变量。
  const env = loadEnv(mode, envDir, "SCADA_");
  const host = env.SCADA_WEB_HOST || "127.0.0.1";
  const port = Number(env.SCADA_REACT_DEV_PORT || "5173");
  const demoPort = Number(env.SCADA_DEMO_PORT || "4178");

  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("SCADA_WEB_HOST 只能设置为 127.0.0.1 或 localhost");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SCADA_REACT_DEV_PORT 必须是 1～65535 之间的整数");
  }

  if (!Number.isInteger(demoPort) || demoPort < 1 || demoPort > 65535) {
    throw new Error("SCADA_DEMO_PORT 必须是 1～65535 之间的整数");
  }

  // 仅在显式开启 OIDC 的本机 Vite serve 启用 HTTPS，同源代理不参与生产构建。
  const oidcHttps =
    command === "serve"
      ? resolveLoopbackOidcHttpsProxy(
          { ...env, NODE_ENV: mode === "production" ? "production" : process.env.NODE_ENV },
          port,
        )
      : null;

  return {
    envDir,
    plugins: lazyPlugins(() => [react(), tailwindcss()]),
    server: {
      host,
      port,
      strictPort: true,
      ...(oidcHttps ? { https: oidcHttps.https } : {}),
      proxy: {
        // Vite 的 ^ 前缀是正则匹配；禁止把 /api/v1evil 一类路径送往业务 API。
        ...(oidcHttps ? { "^/api/v1(?:/|$)": oidcHttps.apiProxy } : {}),
        "/demo": {
          target: `http://127.0.0.1:${demoPort}`,
          changeOrigin: false,
          rewrite: (path) => path.replace(/^\/demo(?=\/|$)/, ""),
        },
      },
    },
  };
});
