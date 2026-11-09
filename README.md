# ADui SCADA

**ADui Studio 出品的工业 SCADA / HMI 组态与实时监控平台。**

> **状态：V0.1 核心原型（非生产版本）。** 当前已提供共享 TypeScript Core、模拟 Tag 和只读 SVG 演示。Vue/React 正式应用、NestJS、工业 Gateway、数据库及 2D 编辑器尚未实现；以下产品能力仍是目标。

## 产品方向

- **Web 双版本**：Vue 3 与 React，共享工程 Schema、编辑器核心、Tag 数据模型与业务 API；两种框架的工程文件互通。
- **2D 组态**：SVG 工业图元、画布编辑、变量绑定、独立运行时、版本化发布。
- **工业数据**：NestJS 业务平台、独立 Gateway；目标支持 OPC UA、Modbus TCP、MQTT、报警和历史趋势。
- **桌面端**：后续使用 Tauri 2 封装 Windows 版本。
- **3D 扩展**：Three.js 自研独立引擎，Vue/React 适配。
- **暂缓**：原生移动 App、未经评审的设备写入。

## V0.1 本地开发

环境要求（原仓库声明）：Node.js >= 22.18.0、pnpm 12.18.0、Vite+ 1.5.0。本阶段没有引入新的第三方运行时依赖。原始锁文件是否与 `vite-plus` 及新增工作区一致，需运行 `pnpm install` 后检查差异并由维护者确认。

```powershell
pnpm install
pnpm run test:core
pnpm run docs:check
pnpm run dev
```

打开 `http://127.0.0.1:4178`。演示为 **Node HTTP + SSE + SVG 诊断页**，只监听 loopback 地址，未接真实 PLC、NestJS 或 Vue/React。模拟 Tag 每秒更新；每 30 秒模拟约 8 秒的采集中断，超时后状态显示 `STALE`，不以旧读数假装实时状态。`Ctrl+C` 停止。`vp check` 用于检查现有 Vite+ 配置及新增代码；构建命令将在正式应用加入后提供。

当前核心模块：`packages/core/src/document.ts`（工程解析）、`tag-store.ts`（Tag 质量/快照/增量）、`svg.ts`（SVG 渲染）、`simulator.ts`（模拟数据）。以上模块均不依赖 Vue/React。`examples/water-treatment/` 仅用于快速验证端到端模拟链路，**不是**正式 Runtime 的网络/安全架构。

## 文档与工程规则

| 文档                                             | 作用                        |
| ------------------------------------------------ | --------------------------- |
| [AGENTS.md](AGENTS.md)                           | Agent 协作、安全与 Git 规则 |
| [REQUIREMENTS](docs/REQUIREMENTS.md)             | 产品需求和验收条件          |
| [ARCHITECTURE](docs/ARCHITECTURE.md)             | 目标架构                    |
| [SDD](docs/SDD.md)                               | 数据契约及候选接口          |
| [V0.1 实施记录](docs/V0.1_IMPLEMENTATION.md)     | 当前实现、实测与下一阶段    |
| [PROJECT_CONTEXT](docs/PROJECT_CONTEXT.md)       | 当前真实进度与风险          |
| [CODEBASE_MAP](docs/CODEBASE_MAP.md)             | 实际目录与规划目录          |
| [SKILLS](docs/SKILLS.md)                         | 已安装 Agent Skills         |
| [HARNESS](docs/HARNESS.md)                       | 质量入口与验证口径          |
| [VALIDATION](docs/VALIDATION.md)                 | 文档检查说明                |
| [ADR-0001](docs/adr/0001-dual-framework-core.md) | 双框架共享 Core             |

当前仓库尚无 `LICENSE`；开源许可需另行明确，公开可见不等于授予再分发权。
