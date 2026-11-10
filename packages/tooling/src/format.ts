/** 共享 Oxfmt 格式化配置；根目录 .editorconfig 是编辑器统一规范。 */
export const sharedFormat = {
  // 第三方 Skill 文档由提供方维护，格式化范围仅包含项目自身代码。
  ignorePatterns: [".agents/skills/**"],
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  endOfLine: "lf" as const,
  semi: true,
  singleQuote: false,
};
