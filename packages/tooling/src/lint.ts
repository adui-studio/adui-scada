/** Oxlint is configured once at the workspace root for vp check. */
export const sharedLint = {
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
