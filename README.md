# ADui SCADA

**ADui Studio 出品的工业 SCADA / HMI 组态与实时监控平台。**

> **状态：V0 架构与文档初始化。** 当前仓库仍是 Vite+ Monorepo Starter，尚无可运行的 SCADA 应用、工业采集网关或服务端。本文所有产品能力均为目标，不代表已经交付。

## 产品方向

- **Web 双版本**：Vue 3 与 React，共享工程 Schema、编辑器核心、Tag 数据模型与业务 API；两种框架的工程文件可互通。
- **2D 组态**：SVG 工业图元、画布编辑、变量绑定、独立运行时、版本化发布。
- **工业数据**：NestJS 业务平台、独立 Gateway；计划支持 OPC UA、Modbus TCP、MQTT、报警和历史趋势。
- **桌面端**：后续使用 Tauri 2 封装 Windows 版本，Linux 按阶段支持。
- **3D 扩展**：Three.js 自研通用引擎，Vue/React 适配，V1 优先完成 2D 闭环。
- **暂缓**：Flutter、Android / iOS 原生 App、未经评审的设备控制写入。

## 当前环境与进度

已存在 `package.json`、`pnpm-workspace.yaml`、`vite.config.ts`、`tsconfig.json`、锁文件、Git Hooks 和 7 个第三方 Agent Skills。仓库**尚无** `apps/*` / `packages/*` 业务包、数据库迁移和工业设备适配代码。

已声明基础要求：Node.js ≥ 22.18.0、pnpm 12.18.0、vite-plus 1.5.0（以仓库配置为准）。

```powershell
pnpm install
pnpm run docs:check
vp check
```

这些是配置中的执行入口，结果以本机实际输出为准。Starter 原 `pnpm run dev` 指向尚不存在的 `website`，当前不能作为 SCADA 启动命令。

## 项目文档

| 入口 | 作用 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Agent 协作及安全规则 |
| [REQUIREMENTS](docs/REQUIREMENTS.md) | 产品需求、编号、验收 |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 整体设计、数据流、部署 |
| [SDD](docs/SDD.md) | 模型、协议、状态机和接口草案 |
| [PROJECT_CONTEXT](docs/PROJECT_CONTEXT.md) | 当前进度、决策、阻塞 |
| [CODEBASE_MAP](docs/CODEBASE_MAP.md) | 实际文件与规划目录 |
| [SKILLS](docs/SKILLS.md) | 已安装 Skills 与使用边界 |
| [HARNESS](docs/HARNESS.md) | 执行、验证、反馈 |
| [VALIDATION](docs/VALIDATION.md) | 文档静态校验说明 |
| [ADR-0001](docs/adr/0001-dual-framework-core.md) | 双框架架构决策 |

产品由 **ADui Studio** 维护。尚未发现 `LICENSE` 文件；**公开仓库不意味着已授权他人开源再使用**，许可证需另行明确。
