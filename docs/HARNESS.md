# ADui SCADA · Harness

V0.1 使用 Vite+ 1.5.0、pnpm workspace Catalog、TypeScript 6.0.3、Vite+ 内置 Vitest。编辑规范来自根 `.editorconfig`，`@adui/tooling` 导出 Format / Lint 供根 Vite+ 使用；应用 TypeScript 统一引用 `@adui/tsconfig/*`。
命令必须在项目根目录执行，版本以 `pnpm-workspace.yaml` 和实际锁文件为准。

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
pnpm run ready
```

测试至少覆盖：Document 结构校验、恶意 JSON、SVG 安全转义、Tag 乱序和失联质量、Runtime 快照及增量。
浏览器双框架联动及真实设备协议测试**未执行**。

`pnpm run ready` = Catalog + 共享配置检查 → Vite+ 检查 → 双 Web + NestJS 类型检查 → Vitest 单测 → NestJS E2E → 文档检查 → Web + NestJS 构建。Rust/Tauri 构建单独验证。

## 配置验证

- `pnpm run config:check`：检查共享 TSConfig 导出与引用、根 .editorconfig、Root Format/Lint 入口和子配置无重复声明。
- `pnpm run deps:check`：检查每个 Workspace Manifest 只使用 Catalog 或 workspace 依赖。
- `vp check`：从仓库根运行；Vite+ Monorepo Format / Lint 以根配置和 overrides 为准，不能依赖子目录覆盖。

## 运行验证

```powershell
pnpm run dev:demo
pnpm run dev:react
pnpm run dev:vue
pnpm run dev:server
# Windows Tauri（需 Rust + WebView2 等）
pnpm run desktop:dev:react
pnpm run desktop:dev:vue
pnpm run desktop:build:react
pnpm run desktop:build:vue
```

运行端必须从发布快照/只读订阅消费标准数据；当前 SSE 仅为本机诊断接口，不代表正式 WebSocket/API 协议。

**验证状态**：开发分支的文件结构检查完成；缺少联网 pnpm/Vite+、Rust 和 Windows 工具链，故本轮未宣称 Vitest、TS6 类型检查、NestJS 构建、双 Web 构建或 Tauri 打包通过。
