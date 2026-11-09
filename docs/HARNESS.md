# ADui SCADA · Harness

V0.1 使用 Vite+ 1.5.0、pnpm workspace Catalog、TypeScript 6.0.3、Vite+ 内置 Vitest。
命令必须在项目根目录执行，版本以 `pnpm-workspace.yaml` 和实际锁文件为准。

```powershell
pnpm install
pnpm run deps:check
pnpm run test:unit
pnpm run typecheck:web
pnpm run build:web
vp check
pnpm run docs:check
pnpm run ready
```

测试至少覆盖：Document 结构校验、恶意 JSON、SVG 安全转义、Tag 乱序和失联质量、Runtime 快照及增量。
浏览器双框架联动及真实设备协议测试**未执行**。

`pnpm run ready` = Catalog 检查 → Vite+ 检查 → 双 Web 类型检查 → Vitest → 文档检查 → Web 构建。

## 运行验证

```powershell
pnpm run dev:demo
pnpm run dev:react
pnpm run dev:vue
```

运行端必须从发布快照/只读订阅消费标准数据；当前 SSE 仅为本机诊断接口，不代表正式 WebSocket/API 协议。

**验证状态**：开发分支的文件结构检查完成；缺少联网 pnpm/Vite+ 执行环境，故本轮未宣称 Vitest、TS6 类型检查和双 Web 构建通过。
