# ADui SCADA · 长期项目上下文

- 日期：2026-11-09
- 版本阶段：V0.1，**开发分支已写入源码，尚待本机完成完整验收**。
- 品牌：ADui Studio。
- 结构：React/Vue 两个正式 Web 应用，共享 Core 与 Runtime 业务逻辑。Studio 与 Runtime 位于同一个 Web 应用、不同功能模块。

## 已实现的源码

- Vite+ / pnpm Monorepo、现有 Agent 工程文档、Skills。
- `packages/core` 工程 Schema 校验、Tag 状态、SVG 和模拟器。
- `packages/runtime` 只读 SSE、快照/增量、STALE 质量、重连逻辑。
- `apps/web-react` / `apps/web-vue` 两个最小 Web Runtime，分别参考各自默认模板。
- 根 Catalog 管理 TypeScript 6.0.3、Vitest 与框架版本；Core/Runtime 测试切换到 Vitest。

## 尚未交付

Studio 编辑器、后端、真实网关、报警/历史、工程发布、Tauri、3D、数据库、认证授权、真实协议与现场性能/安全验证。
当前两个 Web 应用不包含编辑器，亦不能作为现场 SCADA 使用。

## 当前阻塞

- 执行 `pnpm install` 并审查更新后的 `pnpm-lock.yaml`。
- 在 Node >= 22.18、pnpm 12.18 环境运行 `pnpm run ready`，修复真实构建和类型问题。
- 验证 Vue/React 连接同一模拟工程、断线时 STALE 显示一致。
- 明确开源许可证与工业安全现场验证条件。

[工具链](V0.1_TOOLCHAIN.md) · [Harness](HARNESS.md) · [代码地图](CODEBASE_MAP.md)
