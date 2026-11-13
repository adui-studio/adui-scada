# ADR-0054：Runtime 只读 Tag 数据源契约与固定同源 SSE 适配器

- 状态：Proposed
- 日期：2026-11-13
- 关联：FR-004、FR-006、FR-007、FR-009、FR-013、NFR-001、NFR-002、NFR-003、NFR-006
- 前置：[ADR-0053](0053-local-readonly-demo-telemetry.md)

## 背景

Vue/React Runtime 目前共用 `@adui/scada-runtime` 的 `DemoRuntime`，但其内部直接调用固定的 `fetch("/demo/project")` 和 `new EventSource("/demo/events")`；NestJS 第 21 批另提供**本机开发显式开启、非生产、回环监听**的 `/api/dev/demo/project`、`/api/dev/demo/tags`、`/api/dev/demo/events`。两个模拟服务已经复用 Core `TagChange` 的 `snapshot/delta` 与 `TagStore` 的质量和序列号契约。

此时不应把现有 `/demo` URL 全量替换为默认受控关闭的 NestJS API，也不应新增任意外部 URL、自动发现网关或提供没有真实身份校验的生产订阅功能。本批仅抽出浏览器 Runtime 数据源的最小可复用能力。

## 决策

1. 新增 `packages/runtime/src/tag-source.ts`：`ReadonlyTagSource` 只定义 `loadProject(signal): Promise<unknown>` 与 `subscribe({onMessage,onDisconnected})`；返回订阅句柄仅含 `close()`。不引入编辑、数据发布、认证代签、设备写入或 PLC/网关驱动方法。原始消息作为 `unknown` 传入 Runtime，经现有 `applyDemoChange`、Core `validateTagValue` 与 `TagStore` 实施统一校验，不重复维护协议。
2. SSE 工厂 `createSseTagSource` 只允许静态枚举 `"standalone"` 与 `"nest-local"`：
   - `standalone`：`/demo/project` + `/demo/events`，保持 Vue/React 现有默认 URL 不变。
   - `nest-local`：`/api/dev/demo/project` + `/api/dev/demo/events`，只表示**同源路径**契约；Nest 服务端的开关、非生产、回环监听约束继续生效。当前 Vite 两套 Web 的开发代理只代理 `/demo`，本批**不开放** `/api/dev/demo` 代理，不承诺浏览器可直接切到此预设。只有未来经过专项评审配置受控同源入口后才能实际选择它。
     工厂不接收任意主机、绝对 URL、设备地址或动态路由配置；非法预设立即抛出中文异常。
3. 工程请求继续禁用缓存、检查 HTTP 状态及 JSON Content-Type，并直接透传 `AbortSignal`；EventSource 保持浏览器原生自动重连能力。没有添加依赖、全局响应超时、后台轮询或多余的重试机制。
4. `DemoRuntime(listener)` 构造参数和默认行为保持不变，第二个可选参数可注入 `ReadonlyTagSource`。两套 Web 仍按原路径实例化；Tauri `OfflineDemoRuntime` 继续纯本机模拟、不访问网络，不被强制重构。
5. `DemoRuntime.start()` 为每次启动分配独立代次 `generation`，并为加载工程建立 `AbortController`。在 `stop()` 中取消挂起的 HTTP 请求、关闭订阅、使旧代次回调失效，并标记已缓存读数 STALE；停机后迟到的 Promise、SSE 消息或错误事件不能刷新 UI。同步订阅回调在 `subscribe()` 返回前发生时，也必须回收后来创建的句柄。
6. 新连接及断线重连**必须先收到 `snapshot`**，其后才接收 `delta`。每个事件继续由共享 Core 校验，快照可重置会话序列号，delta 忽略旧序列；缺少首次快照或载荷异常时关闭当前订阅、将旧值标记 STALE 并显示中文错误，不静默伪装为有效值。
7. 数据质量 `GOOD/UNCERTAIN/BAD/STALE`、Tag ID、Schema、SSE `{kind, values}` 均为原有协议；不修改 NestJS 路由、Swagger、数据库、Gateway、安全配置或两套 Web 的显示组件。

## 验收计划

- 单元测试覆盖：两个同源预设和禁止外部 URL、无缓存工程读取、异常 HTTP / HTML、AbortSignal 转发、raw JSON 与对象事件、断线 STALE/快照重同步、坏消息停止订阅、停止期间工程 Promise 回调、旧代次消息隔离、订阅同步失败回收、未先收到快照的增量拒绝。
- 第 21 批维护者 Windows 基线：**389/389 普通单测、17/17 NestJS E2E**，完整 `ready` 与 Docker 隔离烟测退出码均为 0。第二十二批预计新增 **11 项单测**，目标普通单测 **400**，E2E 不变 **17**；这是待运行数字，当前**不得声明通过**。
- 维护者执行 `pnpm install --frozen-lockfile`、`vp check`、`pnpm run ready`、`pnpm run test:docker:server`。重点回归 React/Vue Runtime 默认仍访问旧模拟路径；桌面离线构建仍不发网络请求；正式 NestJS API 未新增读写接口。
- 没有运行多客户端长时间压测、异常高频数据背压、正式发布工程恢复、工业网关认证/ACL、生产数据订阅或现场 PLC。后续真实 Tag 服务须独立设计可信租户权限、连接容量、背压、心跳及断线重同步策略；本接口不能直接视为其生产实现。

## PR 约束

PR 默认 Draft，创建后立即指派并核验 `@adui-dev`；必须由维护者 Windows/Docker 验收及明确授权后方可合并，不擅自部署或发布。
