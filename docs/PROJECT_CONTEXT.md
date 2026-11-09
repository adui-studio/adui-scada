# ADui SCADA · 长期项目上下文

- 日期：2026-11-09
- 版本阶段：V0.1，**Web/Server 工具链、React/Vue MSI 构建及桌面安装启动/离线模拟展示已通过维护者本机验证；工业安全及生产能力仍未验收**。
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

完整 Studio 编辑器（V0.2 仅实现首批本地操作）、生产业务后端接口、真实网关、报警/历史、工程发布、Tauri 生产离线运行能力、3D、数据库、认证授权、真实协议与现场性能/安全验证。
当前两个 Web 应用不包含编辑器，亦不能作为现场 SCADA 使用。

## 当前未完成的验收

- React/Vue MSI 已在维护者 Windows 环境安装并启动成功；仍需在全新 Windows 环境验证卸载、升级、兼容性及长期运行。两个构建共用安装包名称/产品标识，不支持默认并行安装。
- React 桌面离线模拟已截图验证 STALE 状态；仍需核验 STALE → GOOD 恢复全过程、Vue 相同阶段以及 Web 开发 SSE 的连接/断线语义。MSI 使用共享 Core 离线模拟，不内置 HTTP SSE 服务。
- 核对 Cargo.lock 与 pnpm-lock.yaml 的实际提交状态，确保构建可重现。
- 明确开源许可证、生产工业安全准入与真实网关的隔离边界。

[工具链](V0.1_TOOLCHAIN.md) · [Harness](HARNESS.md) · [代码地图](CODEBASE_MAP.md)

## 2026-11-09 · 首轮 Windows 质量检查反馈

`pnpm install`、`pnpm run deps:check`、`pnpm run config:check` 已由维护者运行成功。
`pnpm run ready` 首先被格式差异阻断；`vp check --fix` 暴露 7 个类型错误与 1 个测试规则警告。已对源代码和共享格式忽略规则做针对性修复，**等待维护者本机复验**。

## 2026-11-09 · Windows 桌面打包更新

React Web 与 Rust Release 编译成功，Windows WiX 已输出 MSI 文件；NSIS 依赖文件 `nsis_tauri_utils.dll` 下载遇到 HTTP 504，导致原先的 all-targets 打包命令失败。已新增 React/Vue 单独构建 MSI 的命令以绕过非必需的 NSIS 下载。维护者随后已成功构建两套 Release MSI；MSI 尚未完成独立安装及实时监控验收。

## 2026-11-09 · 双框架 MSI 构建验收成功

维护者已在 Windows 实际运行 `pnpm run desktop:build:react:msi` 和 `pnpm run desktop:build:vue:msi`，Tauri 日志均显示 Rust Release 编译成功以及 `Finished 1 bundle`。React MSI 1.92 MiB，Vue MSI 1.88 MiB，均使用 `ADui SCADA_0.1.0_x64_en-US.msi` 文件名；后构建可能覆盖前一个同名文件。此里程碑为**构建通过**，不等于安装测试、NSIS 打包或现场生产能力通过。

## 2026-11-09 · Vue MSI 安装首测与离线模拟修复

维护者提供的截图确认 Vue MSI **可以安装并启动桌面窗口**，但监控页出现 `Unexpected token '<'`：Tauri 发布版不包含 Vite 的 `/demo` 开发代理，工程请求实际得到 HTML。故安装启动通过、Runtime 数据链路未通过。

本轮在共享 Core/Runtime 添加显式离线模拟分支，并让两套 Tauri Web 构建使用 `--mode desktop`：共享水处理工程、模拟数据、`STALE` 状态，不访问 PLC/DCS，不注册额外 Tauri 权限。原浏览器开发 SSE 链路保持不变，网页正式后端连接仍未开发。本修复源代码已进入 PR，**Windows 重新构建、安装和实际数据演示待验证**。

## 2026-11-09 · Vue / React MSI 安装运行验收

维护者确认两套 MSI 均已完成安装并可启动桌面窗口。Vue 截图显示 `SIMULATION` 状态、水处理 SVG 和三项模拟数据（含 `GOOD` 品质）；React 截图显示同一水处理 SVG 在离线模拟中断阶段将数值及设备质量标为 `STALE`，旧值没有伪装为实时 `GOOD`。

因此 V0.1 的**双框架桌面安装与模拟运行里程碑已达成**。截图没有涵盖完整断线恢复循环、卸载升级或干净环境复现；本轮不能认定现场工业协议、生产运行、设备安全或完整 SCADA 系统已经验收。

## 2026-11-09 · STALE → GOOD 自动恢复人工验收通过

维护者继续运行桌面离线模拟后确认，模拟断线期间 `STALE` 正确展示，并能够按预期恢复 `GOOD`。至此 V0.1 React/Vue 桌面模拟的构建、安装、显示及质量恢复主要演示链路均获人工确认。该结论不涵盖生产设备、工业协议、真实网络故障恢复、系统升级与安全认证，PR 合并应另经代码审查。

## 2026-11-09 · Docker 部署能力预留

响应未来 Docker 部署目标，新增 `deploy/docker/` 下的 Compose 演示拓扑（React Web、Vue Web、NestJS 健康检查、Node SSE 模拟器），共享 Node 24 + pnpm workspace 构建，并通过 Nginx 为两端提供同源 `/demo` 接口。仅将 Web 的 8080/8081 映射到宿主机 loopback，不将模拟器和 Server 公开发布；所有真实网关、数据库、认证、生产 API、正式 Docker 发布流程均尚未实现。

当前状态：**配置/源码已补充，未在实际 Docker 环境构建或启动**。后续验收参见 [Docker 演示说明](../deploy/docker/README.md)。Tauri Windows MSI 继续独立发行。

## 2026-11-09 · 开发环境与部署环境变量规范

新增 `.env.example`（根 Docker 端口模板），以及 React、Vue、NestJS、SSE 模拟服务各自的 `.env.example`。前端 Vite 开发服务器读 `SCADA_*`；NestJS 与 SSE 服务通过 Node 内置 `loadEnvFile` 加载可选的本地变量；Docker Compose 开放的仅为可自定义的 loopback Web 端口。

新增 `pnpm run env:check`，作为 `ready` 的前置检查。相关设计见 [环境变量说明](ENVIRONMENT.md) 与 [ADR-0008](adr/0008-env-configuration.md)。**当前仅提交开发配置代码及文档，等待维护者本机复验。**

## 2026-11-09 · V0.2 共享 SVG Studio 首批开发

在已合并的 V0.1 `main` 基线上新建 `feat/v0.2-svg-editor-foundation`，新增 `@adui/scada-core/editor` 框架无关编辑命令和单元测试，React/Vue Studio 双版本：图元选择、拖动及方向微调、Label 文案、撤销重做、本地 JSON 导入导出。现有 Runtime 仍按需独立加载，Demo/SSE/Docker/Tauri 默认运行监控入口不变。

**实际实现范围仅为本地首批编辑交互**，不包含服务端工程保存/版本发布、缩放、对齐、图层、复杂图元编辑、正式工业设备数据。开发分支仍待维护者本机 `pnpm run ready` 及两套框架交互测试，不得提前标记 V0.2 完成。

## 2026-11-09 · V0.2 编辑器互通验收与配置收敛

维护者实际验证 **React → Vue → React** 本地工程 JSON 往返，节点和 Tag 绑定一致，记录为已完成的人工交互验收；不扩展成全部 FR-013 或反向链路完成。

Windows 使用 `vp check --fix` 时大量 CRLF → LF，分析后保留项目的 LF 规范并增加 `.gitattributes` 强制检出 LF，避免重复格式化；.bat/.cmd 例外。将原本五处 `.env.example` 收敛为根目录唯一模板，各应用和 Docker 都读取根 `.env`；Nginx 上游端口也按 Compose 注入的变量同步生成。取代 ADR-0008 的分散环境方案，详见 [ADR-0010](adr/0010-root-env-lf.md)。

当前本轮代码修改尚待 Windows `pnpm run ready` 与 Docker 回归，不能将配置变更视为已运行成功。GitHub PR #4 仍为 Draft，main 不变。

维护者此前已确认 V0.1 Docker 本地演示成功运行；这项验收发生在本轮单一根 `.env` 和 Nginx 端口模板变更之前。本次 Docker 变更不能沿用旧结果，需重新验收。

## 2026-11-09 · V0.2 第二批画布能力开发

在 PR #4（共享 Studio 第一阶段与统一根 .env）获准并通过 GitHub Squash Merge 后，从最新 main `d0a6db5` 新建 `feat/v0.2-editor-canvas-operations`。新增共享 Core 多选/移动/对齐/图层排序及受控图元增删，并同步接入 React/Vue 的缩放与工具按钮。

**已提交源码的实现状态不等于通过本机验收**；新增 Core 用例、Vite+ 格式和 TS6、Web 双构建、双框架手动体验与 JSON 往返均需开发者在 Windows 实际执行后才能标记通过。本阶段不实现正式工程保存、网关或设备写入。

## 2026-11-09 · V0.2 框选与快捷键开发

在 PR #5 分支继续开发 Core 的 `findNodesInRect` 与原子 `selectMany`；React/Vue 两端增加框选 UI 和仅在 Studio 生命周期内有效的键盘操作。缩放和选择仍不持久化，不改变 Runtime、工业网关边界或工程 Schema。新增 5 个单元用例，共 22 个编辑器用例。

尚未获得本轮 Windows `ready`、浏览器操作、反向跨框架 JSON 往返的验收证据；PR #5 保持 Draft，不合并 main。

## 2026-11-10 · V0.2 Windows 回归测试阻塞

维护者执行 `pnpm run ready` 时，依赖/配置/根 .env/LF/Vite+ 检查及 React/Vue/NestJS 类型检查已通过；22 个编辑器单测及其他 Core/Runtime 共 41 项通过。NestJS Controller 单测在 5 秒时限超时，导致 **41/42 通过、ready 未通过**，E2E/文档/构建未执行。本次为减少不必要的测试启动成本，将 Controller 单测改为直接构造依赖并断言返回值，保留原 E2E 测试覆盖 Nest 容器与 HTTP 路由。不更改服务端业务代码或测试全局超时。

**状态：修复代码待本机 `pnpm run ready` 复验。PR #5 继续 Draft，不合并 main。**
