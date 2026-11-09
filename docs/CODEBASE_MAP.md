# ADui SCADA · 代码地图

> 2026-11-09，基于 V0.1 Web 整合开发分支；分支尚待完整本地依赖安装、类型检查及构建验收。

| 路径 | 已实现职责 |
| --- | --- |
| `apps/web-react/src/App.tsx` | React Web 应用根，按需加载 Runtime |
| `apps/web-react/src/runtime/RuntimePage.tsx` | React 只读水处理监控 |
| `apps/web-vue/src/App.vue` | Vue Web 应用根，按需加载 Runtime |
| `apps/web-vue/src/runtime/RuntimePage.vue` | Vue 只读水处理监控 |
| `apps/server/src/` | NestJS 12 ESM 模块化启动和本地 GET /health |
| `apps/server/test/` | Vitest + Supertest E2E 验证 |
| `apps/desktop/src-tauri/` | Tauri 2 Rust 桌面壳及最小能力权限 |
| `apps/desktop/src-tauri/tauri.vue.conf.json` | 选择 Vue Web 构建目标 |
| `packages/core/src/` | 工程文档、TagStore、模拟器、SVG |
| `packages/runtime/src/` | SSE 浏览器订阅、质量状态、样式 |
| `packages/core/test/`、`packages/runtime/test/` | Vitest 单元测试 |
| `examples/water-treatment/` | 非生产模拟服务及诊断页面 |
| `.editorconfig` | 唯一编辑器格式基线（含 Rust 4 空格规则） |
| `packages/tsconfig/*.json` | `@adui/tsconfig/{react,vue,nest,node,vue-node,core,browser}` |
| `packages/tooling/src/` | `@adui/tooling/{format,lint,staged}` 统一代码规范 |
| `pnpm-workspace.yaml` | 统一依赖版本的 Catalog |
| `vite.config.ts` | Vite+ 的格式、Lint、Vitest 配置 |
| `scripts/check-dependency-catalog.mjs` | Catalog 依赖一致性检查 |
| `scripts/check-shared-config.mjs` | 共享 TSConfig / Format / Lint 引用检查 |
| `scripts/validate-docs.mjs` | 文档静态检查 |

目标但**未创建**：`src/studio`、`apps/gateway`、生产 NestJS API、Tauri 生产离线数据能力、2D 编辑器与 3D 引擎。Studio 与 Runtime 共用一个 Web 应用，但 Runtime 不依赖编辑器代码。

[架构](ARCHITECTURE.md) · [开发进度](PROJECT_CONTEXT.md) · [Harness](HARNESS.md)
