import { defineConfig } from "vite-plus";
import { sharedFormat } from "@adui/tooling/format";
import { sharedLint } from "@adui/tooling/lint";
import { sharedStaged } from "@adui/tooling/staged";

// Root config owns workspace-wide format/lint; framework Vite configs own plugins/dev servers.
export default defineConfig({
  staged: sharedStaged,
  fmt: sharedFormat,
  lint: sharedLint,
  test: {
    environment: "node",
    include: [
      "packages/core/test/**/*.test.ts",
      "packages/runtime/test/**/*.test.ts",
      "apps/server/src/**/*.spec.ts",
    ],
  },
  run: { cache: true },
});
