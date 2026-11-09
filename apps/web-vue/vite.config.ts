import vue from "@vitejs/plugin-vue";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  plugins: lazyPlugins(() => [vue()]),
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: {
      "/demo": {
        target: "http://127.0.0.1:4178",
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/demo(?=\/|$)/, ""),
      },
    },
  },
});
