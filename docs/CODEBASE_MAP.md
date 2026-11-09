# ADui SCADA · 仓库代码索引

> 基于 2026-11-09 `main` 仓库文档与 V0.1 本地增量包更新。新增文件应用到仓库后才实际存在；尚未推送到 GitHub。

## 已有基础与 V0.1 新增

| 路径                                  | 职责                                                         |
| ------------------------------------- | ------------------------------------------------------------ |
| `package.json`                        | Node/pnpm 约束、dev:demo、test:core、docs:check、ready       |
| `pnpm-workspace.yaml`                 | apps/_、packages/_、tools/* 的 workspace glob、Vite+ catalog |
| `vite.config.ts`                      | 格式化、lint、staged 规则；配置未改动                        |
| `tsconfig.json`、`pnpm-lock.yaml`     | 原有 TypeScript 基座与锁文件；本次无依赖变化                 |
| `.vite-hooks/pre-commit`              | 原有 `vp staged`                                             |
| `.agents/skills/`、`skills-lock.json` | 7 个已安装 Skills；未改动                                    |
| `packages/core/package.json`          | `@adui/scada-core` workspace 包（共享源码）                  |
| `packages/core/src/document.ts`       | V0.1 ScadaDocument 结构与入参校验                            |
| `packages/core/src/tag-store.ts`      | TagValue、质量、快照、增量、失联处理                         |
| `packages/core/src/simulator.ts`      | 确定性水处理模拟数据                                         |
| `packages/core/src/svg.ts`            | 无框架 SVG 序列化，只支持白名单图元                          |
| `packages/core/test/`                 | 核心单元测试                                                 |
| `examples/water-treatment/`           | 本地浏览器模拟联调入口（非正式客户端）                       |
| `docs/*.md`、`docs/adr/*.md`          | 工程需求、设计、ADR 与进度                                   |
| `scripts/validate-docs.mjs`           | 原有静态文档校验，未改动                                     |

## 尚未创建的目标模块

```text
apps/
  studio-react/  studio-vue/
  runtime-react/ runtime-vue/
  console-react/ console-vue/
  desktop/ server/ gateway/
packages/
  editor-core/ adapter-react/ adapter-vue/
  api-client/ renderer-three/
contracts/ database/ infra/
```

优先复用 `packages/core`，待边界与依赖稳定才拆细为 `document`、`renderer-svg`、`tag-engine` 等包，避免空包或过度抽象。Runtime 不反向依赖编辑器；网关只在独立服务进程中连接工业设备。

[实施记录](V0.1_IMPLEMENTATION.md) · [需求](REQUIREMENTS.md) · [详细设计](SDD.md) · [Harness](HARNESS.md)
