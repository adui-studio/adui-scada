# ADR-0055：SSE 具名心跳、传输静默重连与 Tag 数据超时

- 状态：Proposed
- 日期：2026-11-13
- 关联：FR-007、FR-009、NFR-001、NFR-002、NFR-003、NFR-006
- 前置：[ADR-0053](0053-local-readonly-demo-telemetry.md)、[ADR-0054](0054-readonly-tag-source-adapters.md)

## 背景

现有独立水处理模拟 SSE 与 NestJS 本机只读模拟接口都发送共享 Core 的 `snapshot/delta` 事件。浏览器 `EventSource.onerror` 能报告部分网络故障，但连接可能表面保持正常、长时间不再收到字节。仅依赖断连回调可能将旧的 GOOD 读数保留为实时值。

同时，现有水处理模拟器每 30 秒故意暂停 8 秒采样，服务端通过 TagStore 发送 STALE 演练数据。在此周期中，把“几秒没有新 Tag”直接当作 SSE 断线会产生误报。因此必须区分**传输存活**和**数据新鲜度**，不能让心跳伪造新的 PLC 测量。

## 决策

1. 两个仅供开发模拟的 SSE 服务分别在 `examples/water-treatment/server.mjs` 与 `LocalDemoTelemetryController` 中**每 5 秒发送具名 SSE 事件**：
   ```text
   event: heartbeat
   data: {}
   ```
   在网络上传输时各行使用 SSE 换行分隔，空行表示事件结束；保留原 `data: {"kind":"snapshot"|"delta","values":[...]}` 默认事件格式，**不添加 heartbeat TagChange 类型**。Node 独立服务广播共用心跳计时器，Nest 本地服务在每条订阅内维护心跳计时器；两者都在服务停止或订阅撤销时清理。
2. 浏览器 `createSseTagSource` 通过 `EventSource.addEventListener("heartbeat")` 接收心跳，不向 `DemoRuntime.onMessage` 传入心跳，不更改 `TagStore`。收到任意 SSE 正常 Tag 事件或心跳均重置**15 秒传输静默定时器**；超时（即超过约三个预期心跳周期）时主动触发 `onDisconnected`、关闭失去响应的 EventSource，并使用**同一个固定同源 URL** 新建连接；不得绕过 `nest-local` 的受控本机访问策略或接受任意设备地址。事件回调按当前 EventSource 实例比对，旧连接事件失效。原生 `onerror` 仍先交由 EventSource 自动重连，持续无活动后再由静默定时器重建。
3. `DemoRuntime` 增加独立的**12 秒 Tag 数据静默定时器**：只有经过 Core 校验且非空的 `snapshot`，或被 TagStore 按序列号实际接受的新 `delta` 才重置数据接收时间；空增量和重复旧序列都不能刷新数据接收时间。具名心跳、空增量和网络错误均不能伪造数据刷新。超过阈值后调用 `TagStore.markDisconnected`，将旧 GOOD/UNCERTAIN 值降为 STALE，并通过新增 `RuntimeStatus = "stale"` / 中文状态「Tag 数据已过期」告知操作者。该状态意味着**数据超时或存在上游过期质量**，不必然表示网络已经断开。有效数据恢复后重新根据 TagStore 实际质量选择 live / stale。
4. 网络错误/静默重建沿用上一批会话约束：Runtime 切换到 `reconnecting`，下一个数据会话必须先收到 `snapshot`，再接收 `delta`。同一未断开的 SSE 流仅发生 Tag 停更时仍允许后续有效增量按共享 TagStore 序列号规则恢复；未来正式订阅需另行设计 gap 检测与可靠重同步，不能将此模拟方案视为交付。
5. 12 秒窗口大于模拟器设计的 8 秒采样暂停，5 秒心跳不会重置 Tag 数据计时；原定 30 秒演练会继续通过 STALE 更新体现质量。实时系统上的 timeout、heartbeat 和数据处理容量尚未做现场评审，不把这些原型常量认定为工业现场 SLA。
6. Runtime 只在订阅成功建立后开启数据静默定时器，`stop()`、非法消息错误和新代次隔离场景必须清理。底层 SSE 适配器在 `close()` 后必须清除传输定时器，禁止已关闭源的心跳或网络错误重新创建连接。Nest 本机模拟接口在正式 `AppModule` 中仍不存在；默认关闭、仅非生产且回环监听显式开启，`Swagger` 开关独立。Vue/React 默认继续使用原 `/demo` 路径；Tauri 离线模拟没有网络访问。
7. 不引入新 npm 依赖、不更改 Prisma、工程 Schema、TagChange 契约、工业设备接口、Gateway、登录及工程读写 API；不新增动态代理或可配置外部主机。

## 验证与风险

- 适配器测试覆盖：具名心跳不进入 Tag 数据、心跳维持连接、完全静默 15 秒自动重建、旧连接事件不再生效、原生错误短期不强制重建、主动关闭后清理、超时回调同步关闭时禁止重新建连。
- Runtime 测试覆盖：12 秒停更触发 STALE、恢复后的 GOOD、空增量不重置数据时间、上游 STALE 不显示为正常、网络重连状态持续、快照恢复、定时器销毁；既有 21 项 Runtime 测试不回退。
- NestJS 控制器增加单测检查首次 snapshot、具名 heartbeat、订阅清理；现有 E2E 继续检查只读接口、工业设备写入 404 和 SIGTERM。
- 维护者上一批 Windows 实测基线：400/400 普通单测（35 文件）、17/17 E2E、完整 `ready` 和 Docker 退出码均为 0。本批新增 **9 项单元测试**，预期累计 **409 项普通单测、17 项 E2E**；这些结果**尚未实际执行**，不能宣称已通过。
- 预计 12/15 秒阈值适合本机演示，不保证浏览器后台标签页的定时器精度或网络代理负载下的生产可靠性。没有完成真实 SSE 长时间断流、Nginx 反向代理、后台标签页节流、多客户端背压、工业现场和可信网关验证，均留作后续独立验收。
- 本批仅代码和文档设计，PR 保持 Draft，创建后立即指派并核验 `@adui-dev`；未经明确授权不合并、部署或发布。
