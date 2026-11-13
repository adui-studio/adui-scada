# ADR-0059：共享 Runtime 本地只读诊断模型与双框架对等展示

- 状态：Proposed
- 日期：2026-11-13
- 关联：FR-007、FR-009、NFR-001、NFR-002、NFR-006
- 前置：[ADR-0054](0054-readonly-tag-source-adapters.md)、[ADR-0055](0055-sse-heartbeat-and-tag-silence.md)、[ADR-0056](0056-sse-browser-visibility-recovery.md)、[ADR-0058](0058-tcp-sse-fault-and-soak-tests.md)

## 背景

第二十六批已完成本机回环 TCP SSE 字节静默、双框架恢复及 Docker 六路有限时长观测，但 Vue/React Runtime 页面仍仅展示总体状态与各 Tag 最近值，缺少可对比的本地连接过程计数、有效数据年龄和质量分布。当前没有生产认证、工业网关或经校时的端到端遥测时间体系，因此不能将服务器时间戳与浏览器当前时钟直接相减并宣称是网络延迟。

## 决策

1. 新增 `packages/runtime/src/diagnostics.ts`，定义框架无关 `RuntimeDiagnostics`、`createRuntimeDiagnostics` 和两项中文显示格式化函数。每份状态快照包含：`reconnectCount`、`lastTagReceivedAt`、`dataAgeMs`、`tagCount` 和固定四种质量的 `qualityCounts`，全部仅在进程内存中保存，无网络 API、日志导出、永久存储和新的依赖。
2. `reconnectCount` 定义为**当前 Runtime 启动会话进入 reconnecting 的断连过程次数**。EventSource 处在同一 reconnecting 阶段时的重复错误不重复计数；收到 snapshot 回到 live 后再断线属于下一次。该数字不是 TCP 实际重建次数，也不作为连接成功率指标；每次 `start` 重新从零开始。
3. `lastTagReceivedAt` 只在通过共享 Core 校验、且快照非空或至少一条 delta 被 TagStore 按序列接受时使用本机 `Date.now()` 更新。空增量、旧序列及 SSE heartbeat 不改变该时钟；数据静默和网络断连也不能将旧读数伪装为新的有效数据。首次有效数据前以 `null` 表示未知。
4. `dataAgeMs` 是**生成本次 `RuntimeState` 快照时**距离最近被接受 Tag 的本机经过时长，限制最小值为零，以避免系统时钟回拨出现负数。没有有效数据则为 `null`；页面明确标注它不是 PLC/DCS 到浏览器的真实传输延迟。诊断本身不新增高频 timer，不为刷新秒数导致 SVG 全页持续重绘。
5. `qualityCounts` 仅从`RuntimeState.values` 的**展示质量**统计，包括共享 Runtime 的本地 STALE 覆盖，且 BAD、UNCERTAIN、GOOD、STALE 分别计数；不读取 PLC 地址、不改变 TagStore 的原始序列/质量、工程 Schema 或任何 `TagChange` 协议。
6. `OfflineDemoRuntime` 使用同一个诊断类型，标识连接状态为原有 `simulation`，断连次数始终为零；本地模拟器确实接受新值时才刷新数据时钟。Vue/React 页面同时读取同一 `RuntimeState.diagnostics`、同一格式化函数与共用 CSS，只有模板语法存在框架差异。
7. 保持 `ReadonlyTagSource`、现有订阅与超时阈值、`initialRuntimeState` 的状态标签、Tauri 离线行为、`/demo` 固定同源路径和所有工业只读安全限制。新增的是诊断展示，不是生产监控平台、遥测历史记录、远程控制或健康度 SLA。

## 验收计划

- `pnpm run test:runtime`：新诊断纯函数测试、共享 Runtime 数据时效与断连去重、STALE 质量分布、停止/重启清零、桌面离线模拟；还需覆盖既有 Runtime 和 TagSource 回归。
- `vp check`、`pnpm run docs:check`、`pnpm run ready`：检查格式、Lint、类型、单测、E2E、双框架构建。
- 保持三个本机开发服务 `dev:demo`、`dev:react`、`dev:vue` 运行，检查 Vue/React 页面的诊断字段、Tag 质量与页面状态一致，并执行 `pnpm run test:sse:browser` 和 `pnpm run test:sse:fault:browser`，确认已有 SSE 断流恢复未退化。
- Tauri 离线模拟验证属于不连接工业设备的本机模式；本批新增单元测试，不宣称 Windows MSI 已构建或桌面端已人工验收。

## 验证边界

本批输出的是**进程内、单页面、非持久化**的诊断快照，数据年龄只反映本机事件接收时间，不包含真实网络 RTT、PLC 采样时延、NTP/PTP 校时、多浏览器汇总、工业协议网关或服务器容量。此前的六路网络和故障注入验证也不能替代生产鉴权、真实 PostgreSQL、持续大规模负载或工业现场安全验收。

## 实际执行状态

- 源码、两套 Web 展示和新增 Vitest 回归已提交至独立开发分支。
- 当前协作环境未连接维护者 Windows 工作区，**尚未执行本批完整 `vp check`、`test:runtime`、`ready` 和浏览器人工演练**。所有上述项目必须等待实测日志，不可预先写成通过。
- Draft PR 创建后必须立即指派并核验 `@adui-dev`；维护者明确授权前不得合并。
