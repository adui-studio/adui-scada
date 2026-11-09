# ADui SCADA · 长期项目上下文

- 日期：2026-11-09
- 状态：**V0 初始化 / 文档基线**
- 品牌：ADui Studio；项目：ADui SCADA。
- 本文只记录可确认事实与明确标记的方向。

## 已确定的产品方向

Vue 3、React 双正式版本；框架无关 TypeScript 2D SVG Core；共享工程文档、Tag 与 API；NestJS + 独立网关；OPC UA、Modbus TCP、MQTT 作为目标协议。Tauri 2 Windows 桌面化按阶段实施；Three.js 自研封装作为后续 3D 能力；Flutter 与移动原生 App 暂不开发。

## GitHub 现状

实际仓库是 Vite+ Monorepo Starter。已有 `package.json`、`pnpm-workspace.yaml`、`vite.config.ts`、`tsconfig.json`、`pnpm-lock.yaml`、`.vite-hooks/pre-commit`、`.agents/skills/`、`skills-lock.json`。当前没有 `apps/*`、`packages/*` 业务包、后端、协议网关、数据库迁移和生产部署。

Starter 要求 Node ≥ 22.18.0、pnpm 12.18.0、vite-plus 1.5.0；`dev` 仍引用不存在的 `website`。

## 状态矩阵

| 资产 | 状态 |
| --- | --- |
| Monorepo 基础配置 | 已存在（仅模板） |
| 七个第三方 Skills | 文件已安装，执行权限/上游许可证未逐项审计 |
| 项目工程文档、ADR、文档校验脚本 | 本次文档分支新增 |
| Vue / React SCADA 编辑器与 Runtime | 未开发 |
| NestJS / 工业 Gateway / 数据库 | 未开发 |
| Tauri / Three.js 3D | 未开发 |
| 真实工业连接、性能、现场安全测试 | 未执行 |

## 下一阶段

先确认 V1 验收与许可证；建立共享 Document/Tag 契约及模拟 Tag → SVG Runtime 最小闭环；React 先行、Vue 对齐；接入网关协议模拟器，再补报警历史；完成双框架互通、故障与安全验证后再桌面化。

## 风险与阻塞

缺少行业场景、真实 PLC 型号、采样频率、数据规模与保留期；具体 ORM / UI / 驱动版本待验证；无正式 `LICENSE`；无生产环境和经过验证的 SCADA 功能。不得把规划当交付。

[需求](REQUIREMENTS.md) · [架构](ARCHITECTURE.md) · [SDD](SDD.md) · [代码地图](CODEBASE_MAP.md) · [验证](HARNESS.md)
