import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  plugins: lazyPlugins(() => [react()]),
  server: {
    host: "127.0.0.1",
    port: 5173,
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
