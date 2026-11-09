# ADui SCADA

ADui Studio 维护的工业 SCADA / HMI 开源项目。**当前 V0.1 是模拟数据与只读监控原型，不是可用于生产的 SCADA 系统。**

## 已实现（V0.1 开发分支）

- **apps/web-react**：React 19 Web 应用，当前仅提供 Runtime 监控页面。
- **apps/web-vue**：Vue 3 Web 应用，当前仅提供 Runtime 监控页面。
- **packages/core**：框架无关的工程 Schema、TagStore、质量状态、SVG 序列化和水处理模拟器。
- **packages/runtime**：浏览器 SSE 诊断客户端，带断线质量标记及自动重连。
- **examples/water-treatment**：本机模拟数据服务器；不连接 PLC/DCS。

Studio（组态编辑器）、NestJS、工业网关、Tauri、Three.js 均尚未实现。

## 模板与依赖

对照用户提供的 React、Vue、NestJS、Tauri 四套默认模板；当前只建立 React/Vue 应用，后端与桌面端不建空工程。
所有第三方依赖版本在 `pnpm-workspace.yaml` Catalog 中维护，包间使用 `workspace:*`。TypeScript 采用 6.0.3，测试统一使用 Vite+ 集成的 Vitest。

环境按仓库 package.json：Node >= 22.18.0，pnpm 12.18.0，Vite+ 1.5.0。新依赖必须执行 `pnpm install` 后更新并审查锁文件。

```powershell
pnpm install
pnpm run deps:check
pnpm run test:unit
pnpm run typecheck:web
pnpm run build:web
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

模拟服务仅绑定 127.0.0.1。客户端通过 Web dev proxy 的 `/demo` 访问工程与 SSE，不直连工业设备。断线/失效质量不能展示为正常值。

## 规范与状态

[Agent 规则](AGENTS.md) · [需求](docs/REQUIREMENTS.md) · [架构](docs/ARCHITECTURE.md) · [详细设计](docs/SDD.md) · [代码地图](docs/CODEBASE_MAP.md) · [验证](docs/HARNESS.md) · [开发进度](docs/PROJECT_CONTEXT.md) · [工具链说明](docs/V0.1_TOOLCHAIN.md)

当前没有 `LICENSE`；公开 GitHub 仓库不等于已授予开源许可证。
