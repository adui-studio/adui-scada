import vue from "@vitejs/plugin-vue";
import { defineConfig, lazyPlugins, loadEnv } from "vite-plus";
import { fileURLToPath } from "node:url";

// Both Web apps load only the repository-root .env, independent of vp -C.
const envDir = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode }) => {
  // SCADA_* is server-side configuration; Vite exposes only VITE_* to browser code.
  const env = loadEnv(mode, envDir, "SCADA_");
  const host = env.SCADA_WEB_HOST || "127.0.0.1";
  const port = Number(env.SCADA_VUE_DEV_PORT || "5174");
  const demoPort = Number(env.SCADA_DEMO_PORT || "4178");

  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("SCADA_WEB_HOST must be 127.0.0.1 or localhost");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SCADA_VUE_DEV_PORT must be an integer between 1 and 65535");
  }

  if (!Number.isInteger(demoPort) || demoPort < 1 || demoPort > 65535) {
    throw new Error("SCADA_DEMO_PORT must be an integer between 1 and 65535");
  }

  return {
    envDir,
    plugins: lazyPlugins(() => [vue()]),
    server: {
      host,
      port,
      strictPort: true,
      proxy: {
        "/demo": {
          target: `http://127.0.0.1:${demoPort}`,
          changeOrigin: false,
          rewrite: (path) => path.replace(/^\/demo(?=\/|$)/, ""),
        },
      },
    },
  };
});
