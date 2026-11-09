# ADui SCADA

ADui Studio 维护的工业 SCADA / HMI 开源项目。**当前 V0.1 是模拟数据与只读监控原型，不是可用于生产的 SCADA 系统。**

## 已实现（V0.1 开发分支）

- **apps/web-react**：React 19 Web 应用，当前仅提供 Runtime 监控页面。
- **apps/web-vue**：Vue 3 Web 应用，当前仅提供 Runtime 监控页面。
- **packages/core**：框架无关的工程 Schema、TagStore、质量状态、SVG 序列化和水处理模拟器。
- **packages/runtime**：浏览器 SSE 诊断客户端，带断线质量标记及自动重连。
- **examples/water-treatment**：本机模拟数据服务器；不连接 PLC/DCS。
- **apps/server**：NestJS 12 ESM 服务，当前只有 `GET /health`（进程存活探针）。
- **apps/desktop**：Tauri 2 Windows 优先桌面壳，默认 React，可切换 Vue。

Studio（组态编辑器）、真实工业网关、生产业务 API、数据库及 Three.js 尚未实现。NestJS 与 Tauri 目前仅完成最小工程。

## 模板与依赖

对照用户提供的 React、Vue、NestJS、Tauri 四套默认模板；目前已建立 React/Vue、NestJS 本地进程探针与 Tauri 桌面工程；后端业务和工业网关暂不接入。
根目录唯一 `.editorconfig` 约定 UTF-8 / LF / 2 空格。TypeScript 统一继承 `@adui/tsconfig/react`、`@adui/tsconfig/vue`、`@adui/tsconfig/nest` 等配置入口；Format / Lint 由 `@adui/tooling` 提供，并由根 `vite.config.ts` 统一生效。

所有第三方依赖版本在 `pnpm-workspace.yaml` Catalog 中维护，包间使用 `workspace:*`。TypeScript 采用 6.0.3，测试统一使用 Vite+ 集成的 Vitest。

环境按仓库 package.json：Node >= 22.18.0，pnpm 12.18.0，Vite+ 1.5.0。新依赖必须执行 `pnpm install` 后更新并审查锁文件。

```powershell
pnpm install
pnpm run deps:check
pnpm run config:check
pnpm run test:unit
pnpm run typecheck:web
pnpm run typecheck:server
pnpm run test:e2e:server
pnpm run build:web
pnpm run build:server
vp check
pnpm run docs:check
```

启动三个终端：

```powershell
pnpm run dev:demo
pnpm run dev:react
pnpm run dev:vue
```

React: http://127.0.0.1:5173 · Vue: http://127.0.0.1:5174 · 模拟端: http://127.0.0.1:4178

NestJS 本地探针：`pnpm run dev:server`，访问 http://127.0.0.1:3001/health。

Tauri（Windows，需 Rust 和 WebView2 等前置环境）：先启动模拟服务，再运行 `pnpm run desktop:dev:react` 或 `pnpm run desktop:dev:vue`；打包执行 `pnpm run desktop:build:react` 或 `pnpm run desktop:build:vue`。打包产物不包含模拟 SSE 服务，当前不保证离线监控。

模拟服务仅绑定 127.0.0.1。客户端通过 Web dev proxy 的 `/demo` 访问工程与 SSE，不直连工业设备。断线/失效质量不能展示为正常值。

## 规范与状态

[Agent 规则](AGENTS.md) · [需求](docs/REQUIREMENTS.md) · [架构](docs/ARCHITECTURE.md) · [详细设计](docs/SDD.md) · [代码地图](docs/CODEBASE_MAP.md) · [验证](docs/HARNESS.md) · [开发进度](docs/PROJECT_CONTEXT.md) · [工具链说明](docs/V0.1_TOOLCHAIN.md)

当前没有 `LICENSE`；公开 GitHub 仓库不等于已授予开源许可证。

## V0.1 桌面安装版

Tauri MSI 构建（`desktop:build:react:msi` / `desktop:build:vue:msi`）使用独立的 `--mode desktop` Web 构建，内置**明确标注的离线模拟数据源**，无需运行 `pnpm run dev:demo`。Web 开发与桌面开发模式仍需本地 SSE 模拟服务。模拟数据不是 PLC/DCS 实际采集，不能用于生产控制。详情见 [桌面端说明](apps/desktop/README.md)。
