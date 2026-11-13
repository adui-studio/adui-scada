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

### 第二十七批 Windows 完整质量链与双框架浏览器复验通过（2026-11-13）

维护者上传 PowerShell 日志，确认本批新增诊断与既有 SSE 能力在 Windows 仓库工作区通过：

- `pnpm run test:runtime`：**退出码 0**；其中新增 `packages/runtime/test/diagnostics.test.ts` **5/5 通过**，共享 Runtime、TagSource 与离线 Runtime 测试通过。
- `vp check`：**263 个文件格式正确，131 个受检文件零警告、Lint 错误与类型错误，退出码 0**。
- `pnpm run docs:check`：**75 个 Markdown 文件通过，退出码 0**。
- `pnpm run ready`：**退出码 0**；依赖 11 个清单/51 项 Catalog、9 个 TSConfig 消费端、157 个自有代码或配置文件中文文案检查、根 `.env` 与 LF 检查通过；Prisma Client **7.10.1** 生成成功。
- 全量 Vitest：**417/417（37 个文件）**；其中 Runtime 诊断测试 5/5。
- Node SSE 连接资源专项：**8/8**；TCP 故障代理专项：**4/4**。
- NestJS E2E：**17/17（3 个文件）**。其中主动模拟关闭的 HTTP 503 / Terminus Health Check 失败日志属于预期负面测试，不是失败。
- Vue、React、NestJS 类型检查及构建全部通过；日志显示 React 3899 个模块、Vue 3844 个模块完成构建，NestJS 服务端构建完成。
- `pnpm run test:sse:browser`：React、Vue 的 SSE 心跳、Tag 过期、静默重连和资源清理通过，**退出码 0**。
- `pnpm run test:sse:fault:browser`：React、Vue 的真实 TCP 下行阻断、STALE、主动重连和连接回收通过，**退出码 0**。该浏览器脚本同时检查诊断面板存在、四档质量总数与可见 Tag 数一致、STALE 统计和重连过程计数。

**本批 Windows 自动化质量链与双框架浏览器回归通过。** 浏览器自动化断言已覆盖诊断面板的数据一致性；维护者尚未单独报告手工视觉验收或 Tauri 桌面人工验收，因此不将两项标记为完成。

诊断的 `dataAgeMs` 仍只代表本机接受有效 Tag 后经过的时间，不是 PLC 采样延迟或网络 RTT；`reconnectCount` 是去重后的连续断连过程数，不是实际 TCP 重建计数。生产认证、真实工业网关、PostgreSQL 真库、历史诊断持久化及工业现场尚未验收。

本段为验收记录追加后，**尚未重新执行最新文档的 `vp check` / `docs:check`**；建议合并审查前再运行一次。PR #49 继续保持 Draft，Assignee `@adui-dev`，未经明确授权不得合并。
