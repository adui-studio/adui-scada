/** Oxlint 统一在工作区根目录配置，由 vp check 执行。 */
export const sharedLint = {
  ignorePatterns: [".agents/skills/**", "apps/server/src/generated/prisma/**"],
  jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
  rules: { "vite-plus/prefer-vite-plus-imports": "error" as const },
  options: { typeAware: true, typeCheck: true },
  overrides: [
    { files: ["apps/web-react/**/*.{ts,tsx}"], plugins: ["react" as const] },
    { files: ["apps/web-vue/**/*.{ts,vue}"], plugins: ["vue" as const] },
    { files: ["apps/server/**/*.ts"], plugins: ["node" as const], env: { node: true } },
    {
      files: ["**/*.test.ts", "**/*.spec.ts", "**/*.e2e-spec.ts"],
      plugins: ["vitest" as const],
    },
  ],
};
