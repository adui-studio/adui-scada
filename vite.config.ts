import { defineConfig } from "vite-plus";
import { sharedFormat } from "@adui/tooling/format";
import { sharedLint } from "@adui/tooling/lint";
import { sharedStaged } from "@adui/tooling/staged";

// 根配置统一管理工作区 Format/Lint，各框架的 Vite 配置仅负责插件和开发服务。
export default defineConfig({
  staged: sharedStaged,
  fmt: sharedFormat,
  lint: sharedLint,
  test: {
    environment: "node",
    include: [
      "packages/core/test/**/*.test.ts",
      "packages/draft-storage/test/**/*.test.ts",
      "packages/runtime/test/**/*.test.ts",
      "apps/server/src/**/*.spec.ts",
    ],
  },
  run: { cache: true },
});
