# ADR-0005：跨框架共享 EditorConfig、TSConfig、Format 与 Lint

- 状态：Accepted
- 日期：2026-11-09

## 背景

ADui SCADA 同时维护 Vue 3、React 19、NestJS 与 TypeScript 共享核心。独立复制 tsconfig、lint 和格式化设置容易出现版本漂移；但 Vite+ 的 Monorepo `vp check` 在根目录读取格式化与 Lint 配置，无法通过子应用目录配置覆盖。

## 决策

1. 仓库根目录唯一 `.editorconfig`：UTF-8、LF、2 空格、末尾换行，Rust 使用 4 空格。
2. `@adui/tsconfig` 通过 `exports` 提供 `/react`、`/vue`、`/nest`、`/node`、`/vue-node`、`/core`、`/browser` 入口。各项目使用标准 TypeScript `extends`，只保留本地输入、输出、构建信息。
3. `@adui/tooling` 导出 Format、Lint 和 Git staged。根 `vite.config.ts` 组合并应用；用 `lint.overrides` 指定 React、Vue、NestJS、Vitest 范围。各应用 Vite 配置仅定义构建/开发服务器及插件。
4. 所有 npm 第三方版本由根 `pnpm-workspace.yaml` Catalog 管理；配置包和消费方通过 `workspace:*` 关联。Rust Cargo crates 仍由 Cargo 独立管理。
5. 通过 `pnpm run config:check`、`deps:check`、`vp check` 和 `ready` 验证引用与质量；未执行时不宣称通过。

## 后果

收益：单点更新 TypeScript、格式化与 Lint 规则；框架各取所需；无需 ESLint/Prettier 第二套配置。
风险：共享配置修改会影响全部包，升级后必须同时执行 Vue、React、NestJS 构建和测试。TypeScript 继承的路径解析以配置声明处为基准，因此本地路径选项不能进入共享 preset。
