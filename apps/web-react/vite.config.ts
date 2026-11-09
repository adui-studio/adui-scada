import react from "@vitejs/plugin-react";
import { loadEnv } from "vite-plus";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig(({ mode }) => {
  // Vite loads .env files after config evaluation. Read server-only SCADA_ options here.
  const env = loadEnv(mode, process.cwd(), "SCADA_");
  const host = env.SCADA_WEB_HOST || "127.0.0.1";
  const port = Number(env.SCADA_WEB_PORT || "5173");
  const target = env.SCADA_DEMO_PROXY_TARGET || "http://127.0.0.1:4178";

  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("SCADA_WEB_HOST must be 127.0.0.1 or localhost");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SCADA_WEB_PORT must be an integer between 1 and 65535");
  }

  // The V0.1 unauthenticated demo must only be proxied to a local HTTP endpoint.
  const proxy = new URL(target);
  if (
    proxy.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(proxy.hostname) ||
    proxy.username ||
    proxy.password ||
    proxy.pathname !== "/" ||
    proxy.search ||
    proxy.hash
  ) {
    throw new Error("SCADA_DEMO_PROXY_TARGET must be a local HTTP origin without credentials");
  }

  return {
    plugins: lazyPlugins(() => [react()]),
    server: {
      host,
      port,
      strictPort: true,
      proxy: {
        "/demo": {
          target: proxy.origin,
          changeOrigin: false,
          rewrite: (path) => path.replace(/^\/demo(?=\/|$)/, ""),
        },
      },
    },
  };
});
