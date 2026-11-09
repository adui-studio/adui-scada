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
- 根 Catalog 管理 TypeScript 6.0.3、Vitest、Vue/React、NestJS 及 Tauri CLI 的 JS 依赖；Core/Runtime/Server 测试统一 Vitest。
- 新增根目录唯一 `.editorconfig`，以及 `@adui/tsconfig`、`@adui/tooling` 两个共享规范包，Web/Server/Core/Runtime 通过各自入口继承配置。
- `apps/server`：参考 NestJS 12 默认 ESM 模板创建模块化 Server，仅 GET /health 本地进程探针。
- `apps/desktop`：参考 Tauri 2 模板创建 Rust 桌面壳，默认嵌入 React Web，支持 Vue 配置覆盖，未提供特权设备命令。

## 尚未交付

Studio 编辑器、生产业务后端接口、真实网关、报警/历史、工程发布、Tauri 生产离线运行能力、3D、数据库、认证授权、真实协议与现场性能/安全验证。
当前两个 Web 应用不包含编辑器，亦不能作为现场 SCADA 使用。

## 当前阻塞

- 执行 `pnpm install` 并审查更新后的 `pnpm-lock.yaml`，确保共享配置包以 workspace 方式正确链接。
- 运行 `pnpm run config:check` 和 `pnpm run deps:check`，以及根 `vp check` 校验框架对应 Lint overrides。
- 在 Node >= 22.18、pnpm 12.18 环境运行 `pnpm run ready`，修复真实构建和类型问题。
- 验证 Vue/React 连接同一模拟工程、断线时 STALE 显示一致。
- 运行 NestJS `test:e2e`、`typecheck`、`build`，并检查服务仅监听本机地址。
- Windows 安装 Rust / Tauri 前置工具，运行桌面 dev、Windows bundling；正式包当前不包含模拟 SSE 服务。
- 明确开源许可证与工业安全现场验证条件。

[工具链](V0.1_TOOLCHAIN.md) · [Harness](HARNESS.md) · [代码地图](CODEBASE_MAP.md)

## 2026-11-09 · 首轮 Windows 质量检查反馈

`pnpm install`、`pnpm run deps:check`、`pnpm run config:check` 已由维护者运行成功。
`pnpm run ready` 首先被格式差异阻断；`vp check --fix` 暴露 7 个类型错误与 1 个测试规则警告。已对源代码和共享格式忽略规则做针对性修复，**等待维护者本机复验**。

## 2026-11-09 · Windows 桌面打包更新

React Web 与 Rust Release 编译成功，Windows WiX 已输出 MSI 文件；NSIS 依赖文件 `nsis_tauri_utils.dll` 下载遇到 HTTP 504，导致原先的 all-targets 打包命令失败。已新增 React/Vue 单独构建 MSI 的命令以绕过非必需的 NSIS 下载，新命令和 Vue Release 均待本机验证。MSI 尚未完成独立安装及实时监控验收。
