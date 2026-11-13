# ADR-0060：共享 Runtime 单会话状态事件时间线

- 状态：Proposed
- 日期：2026-11-13
- 关联：FR-007、FR-009、NFR-001、NFR-002、NFR-006
- 前置：[ADR-0059](0059-runtime-local-diagnostics.md)、[ADR-0055](0055-sse-heartbeat-and-tag-silence.md)、[ADR-0058](0058-tcp-sse-fault-and-soak-tests.md)

## 背景

第二十七批已将本机 Runtime 诊断快照统一提供给 Vue/React，包括当前连接状态、去重断连过程次数、数据年龄及 Tag 质量分布。该快照只有当前状态，缺少对最近一次过期、重连、恢复过程的按时间查看能力。当前没有中心化事件系统、生产鉴权及持久化历史，因此本批仅在本机 Runtime 内部增加有界只读状态变化记录。

## 决策

1. 扩展 `packages/runtime/src/diagnostics.ts` 的 `RuntimeDiagnostics.statusEvents` 字段：事件为 `RuntimeStatusEvent`，包含会话内递增的 `sequence`、现有 `RuntimeStatus` 和本机 `occurredAt` 毫秒时间戳，**不包含动态异常详情、Tag 值、设备地址、凭据或通信负载**。
2. 新增 `RuntimeStatusHistory`，仅在最新记录的状态不同于当前状态时写入；重复 `live` 增量、`stale` 持续计时、重复 `reconnecting` 回调和离线模拟周期刷新都不产生重复状态记录。
3. 采用最新在前的**最多 20 条**会话内数组。超出后移除最早记录。序号单调递增并在 `clear()` 重新从 1 开始，避免同毫秒的状态变化在双框架列表中碰撞。对外状态快照提供事件副本，不允许持有内部数组的可变引用。
4. 在 `DemoRuntime.publish()` 中记录发布时已确定的状态，再把历史副本与原有数据年龄、质量统计一起输出。每次新的 `start()` 清空历史；`stop()` 仅释放订阅及计时器，不引入额外发布或写入，也不把已终止会话的消息当作新事件。
5. `OfflineDemoRuntime` 复用相同数据契约，每次开始只记录一次 `simulation`；周期内 Tag 质量变化仍由原有质量统计反映，**不伪造网络连接/断连**。
6. Vue 与 React 分别在已有“实时链路诊断”面板中展示同一 `statusEvents`：中文状态名称取自 `RUNTIME_STATUS_LABELS`，时间格式复用 `formatRuntimeUpdateTime`，使用共享 CSS，支持窄屏布局，并说明“仅当前会话 · 非报警历史”。初始无记录时显示中文空状态。
7. 不引入新计时器、轮询、数据库、IndexedDB、日志上传、HTTP/WS 接口、远程控制或新依赖。状态时间线不代表 PLC/DCS 事件日志、报警中心、可靠传输确认或设备时钟；本批不改动 SSE 15 秒重连、Tag 12 秒过期阈值。

## 设计与风险

- 状态变化的 `occurredAt` 由浏览器/桌面运行进程的本机时钟生成，不与服务器/PLC 时钟校对；不承诺准确的跨设备事件先后顺序。
- 时间线不会存储所有 Tag 更新，也不跨刷新或页面关闭持久化；其空间复杂度恒定，最多 20 个状态事件。
- `RuntimeStatusHistory` 由共享 Runtime 所有，不由 Vue/React 各自维护，避免时间线序列不一致；事件快照以值拷贝保护历史记录。
- 正常 `stop()` 不额外向界面写入 `idle`，因为页面通常已离开，且原有运行时生命周期保持不变。

## 验收计划

```powershell
pnpm run test:runtime
vp check
pnpm run docs:check
pnpm run ready

# 在三个终端分别保持 dev:demo、dev:react、dev:vue 运行后：
pnpm run test:sse:browser
pnpm run test:sse:fault:browser
```

新增/扩展测试覆盖重复状态不计数、同毫秒序号唯一、20 条限制、外部快照隔离、重新启动复位、离线模拟仅产生一条 simulation，以及 Vue/React 浏览器断流路径中的 live → stale → reconnecting → live 记录。

## 实际执行状态

- 已基于第二十七批 Squash Merge 的 `main`（`ee996c0`）创建独立第二十八批分支并提交实现及测试。
- **尚未在维护者 Windows 工作区执行本批 `test:runtime`、`vp check`、`docs:check`、`ready`、Vue/React 浏览器回归或 Tauri 人工测试。** 不得继承上一批的通过数字。
- 此功能仅限演示诊断，不包含真正生产审计、报警记录、持续高并发和工业现场验收。Draft PR 必须立即指派并核验 `@adui-dev`，未经维护者明确合并授权不得合并。

### 第二十八批 Windows 双框架 SSE 浏览器回归（2026-11-14）

维护者提供 PowerShell 实测日志，当前分支针对第二十八批状态时间线功能执行：

- `pnpm run test:sse:browser`：React `127.0.0.1:15173` 与 Vue `127.0.0.1:15174` 均输出“浏览器 SSE 心跳保活、Tag 过期、静默重连、资源清理通过”，**明确退出码 0**。脚本额外断言共享状态时间线初始 live、Tag 过期 stale、传输静默 reconnecting 与快照恢复 live，以及会话内事件上限。
- `pnpm run test:sse:fault:browser`：React/Vue 两端均输出“真实 TCP 下行阻断、STALE、主动重连及连接回收通过”。提供的输出到此结束，**未附 `Write-Host "TCP 故障退出码：$LASTEXITCODE"`**，因此只确认两端成功信息及脚本未输出错误，**暂不记录该命令的实际退出码**。

**仍待 Windows 实测**：`pnpm run test:runtime`、`vp check`、`pnpm run docs:check`、完整 `pnpm run ready`；以及手工 UI 和 Tauri 桌面验证。上述浏览器测试不能证明 Node/Vitest、Lint、类型、全量构建、真实工业网络、生产报警持久化已完成。

本次仅补充验收文档与 PR 说明，无业务代码变更。新增文档提交后的格式及文档静态检查仍待执行；PR #50 保持 Draft，需维护者明确授权方能合并。
