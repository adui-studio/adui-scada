# ADui SCADA · 长期项目上下文

- 日期：2026-11-09
- 状态：**V0.1 核心原型首批完成（待本机集成验证）**
- 品牌：ADui Studio；项目：ADui SCADA。
- 本文只记录可确认事实，区分目标、局部实现与验收通过。

## 已确定方向

Vue 3 与 React 双正式版本；共享工程文档、Tag、API 和框架无关 SVG Core；NestJS + 独立只读工业网关；OPC UA、Modbus TCP、MQTT 为目标协议；Three.js 与 Windows Tauri 2 为后续阶段。V1 不交付原生移动 App。

## 已存在的仓库基线

原有 `package.json`、`pnpm-workspace.yaml`、`vite.config.ts`、`tsconfig.json`、`pnpm-lock.yaml`、Git Hook、Skills 和工程文档。工具版本以仓库配置为准：Node >= 22.18.0、pnpm 12.18.0、vite-plus 1.5.0。

## V0.1 本次增量

- 新增 `packages/core`：工程文档校验、TagStore（质量/快照/增量/超时）、模拟数据、SVG 渲染。
- 新增 `examples/water-treatment`：Node loopback + SSE 的非生产诊断页面，演示模拟断连的 STALE 状态。
- 根 `dev` 更换为模拟示例启动入口；新增 `test:core`。无新增第三方运行时依赖。
- 单测及运行验证结果以 [V0.1 实施记录](V0.1_IMPLEMENTATION.md) 为准。

## 状态矩阵

| 范围                                      | 当前状态                               |
| ----------------------------------------- | -------------------------------------- |
| Vite+ Monorepo                            | 原有基础已配置                         |
| V0.1 Document / Tag / SVG / 模拟器        | 首批源代码和测试已实现，待目标环境复验 |
| 非生产浏览器 SVG 诊断页                   | 本次新增                               |
| Vue 与 React 正式应用                     | 未开发                                 |
| SVG 编辑器、历史版本、发布及回滚          | 未开发                                 |
| NestJS API / Gateway / PostgreSQL / Redis | 未开发                                 |
| Tauri 2 / Three.js 3D                     | 未开发                                 |
| 真实协议与现场安全、性能测试              | 未执行                                 |
| 项目开源许可证                            | 未确定；无 `LICENSE`                   |

## 下一阶段

锁定 Web 框架实际版本并使 pnpm 锁文件可复现；补齐 Vue/React 双 Runtime，验证同一 Document/Tag 契约；正式服务端通信与独立工业采集网关单独评审，不直接延用诊断 demo 协议。

## 未确认事项

现场设备型号、网络隔离、协议驱动与周期、质量超时策略、工程持久化/认证、Tag 规模、历史保留期及许可等均待进一步确认。

[需求](REQUIREMENTS.md) · [架构](ARCHITECTURE.md) · [SDD](SDD.md) · [代码地图](CODEBASE_MAP.md) · [V0.1 实施记录](V0.1_IMPLEMENTATION.md)
