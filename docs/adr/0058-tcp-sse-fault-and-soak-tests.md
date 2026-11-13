# ADR-0058：本机 TCP SSE 传输故障与双框架长连接回归

- 状态：Proposed
- 日期：2026-11-13
- 关联：FR-007、FR-009、NFR-001、NFR-002、NFR-003、NFR-006
- 前置：[ADR-0055](0055-sse-heartbeat-and-tag-silence.md)、[ADR-0056](0056-sse-browser-visibility-recovery.md)、[ADR-0057](0057-local-sse-capacity-and-proxy-validation.md)

## 背景

第二十四批通过 EventSource 回调层的静默注入验证了共享 Runtime 的超时和恢复；第二十五批通过真实 Node HTTP 与 Docker Nginx 验证六路连接、心跳、快照和断开隔离。但现有测试尚未覆盖：**浏览器与服务端保持 TCP socket 打开、下行 SSE 字节实际不再到达**，以及单轮验证之外的连续多客户端运行。

## 决策

1. 新增仅用于本机自动化的 `scripts/sse-fault-proxy.mjs`。通过 Node 原生 `net.createServer` 在 `127.0.0.1` 随机端口建立透明 TCP 代理，只接受目标为 **127.0.0.1 的 HTTP 根路径与有效端口**，禁止任意外网或 HTTPS 目标。普通 HTTP 和 WebSocket 的字节继续透明转发；仅对被选中的 `GET /demo/events` 或 `GET /events` SSE 响应冻结“上游 → 浏览器”字节，**不发送 FIN/RST、不主动关闭连接**。后续新建的 SSE TCP 连接正常透传。
2. 通过真实 Socket `close/error` 终止双向对应连接，代理退出时销毁所有临时 socket。该组件只运行于手动测试进程，不进入应用/服务端/Docker 镜像，不占用用户固定端口，不接入 PLC/DCS。
3. `scripts/sse-fault-proxy.test.mjs` 用 Node 内置 `node:test` 验证非法外部地址拒绝、普通 HTTP 完整透传、SSE 真实下行被阻断时连接仍存活、其他订阅继续接收、客户端关闭后可重连。新增 `pnpm run test:sse:fault:unit` 并纳入根 `pnpm run ready`，不增加依赖。
4. 扩展已有 `scripts/test-runtime-sse-browser.mjs`，**不改变原 `test:sse:browser` 行为**。显式 `--transport-fault` 时，将 Chrome/Edge 的 Vue/React 页面通过本机临时 TCP 代理接入真实 SSE，先确认运行监控为 live，再冻结唯一 SSE 下行，要求旧数据转为 STALE、15 秒传输静默后客户端主动关闭旧 EventSource 并重建连接，新快照恢复 live，最后退出 Runtime 后旧 socket 全部回收。可选 `--docker` 将下游代理目标切换为本机已运行的 React/Vue Docker Nginx 入口，并保持原来的固定同源 `/demo` 路由。提供 `test:sse:fault:browser`、`test:sse:fault:proxy` 两条显式测试命令。
5. 扩展既有真实 Node HTTP 六路 SSE 流脚本，只有带 `--soak` 的命令才增加持续验证：每条活跃订阅需新增至少 **12 次具名 heartbeat** 和至少一条新的 `delta`，任意连续两个 heartbeat 间隔不得达到 **15 秒**，随后仍要关闭全部客户端。分别提供 `test:sse:soak`（独立 Demo）与 `test:sse:soak:proxy`（双框架 Docker Nginx）；**不加入根 ready**，避免对每次提交引入分钟级网络等待。
6. 不增加服务端写入、调试开关、远程故障 API 或新环境变量。验证仅在用户已启动的本机演示端口执行，不停止、重启或注入任何现有 Docker 进程；保持 5/12/15 秒模拟时效、32 路/64 KiB 演示保护和 Core/Tag 序列/质量语义不变。

## 运行和验收

```powershell
# 无需运行服务；已纳入 ready
pnpm run test:sse:fault:unit

# 先在三个独立终端启动：
pnpm run dev:demo
pnpm run dev:react
pnpm run dev:vue

# 真实浏览器 TCP 下行冻结回归
pnpm run test:sse:fault:browser

# 本机独立 Demo 六路 SSE 持续观测
pnpm run test:sse:soak

# 已经运行 Docker Demo 演示栈后：
pnpm run docker:demo:ps
pnpm run test:sse:fault:proxy
pnpm run test:sse:soak:proxy

vp check
pnpm run docs:check
pnpm run ready
```

浏览器测试要求本机 Chrome/Edge，支持通过 `SCADA_BROWSER_PATH` 指定可执行文件。故障代理只监听回环随机端口，并由测试自动清理；六路持续观测只是有限时长的模拟负载，不是长时间/大并发压力测试。

## 边界与风险

- 下行丢弃是一种**本机测试代理注入的 TCP 半开样式故障**，不是 Nginx 自身宕机、真实链路断开、路由器黑洞或工业现场断网。
- 浏览器测试依赖现有 Web 页面和原生 EventSource；成功需以维护者 Windows 实际 Chrome/Edge 结果为准。测试运行期间不要让浏览器进入人工暂停/系统睡眠模式。
- Node 六路持续观测只检查事件与间隔，不对内存增长、操作系统 socket 配额、生产限流、正式认证或长期慢消费者建立 SLA。
- 不在未经明确授权的情况下操作 Docker 生命周期、连接生产网络或合并 PR。

## 目前验证状态

- 协作容器的 Node 22 本机测试进程已执行相应独立代理单测：**3/3 通过**，包含真实 HTTP/TCP SSE 下行阻断、其他订阅隔离和连接关闭后重入。GitHub 分支代码完成静态 JavaScript 解析。
- `pnpm run test:sse:fault:unit` 在维护者 Windows 工作区、Vue/React 实际浏览器双框架故障、Docker Nginx 故障模式、六路持续观测、`vp check` 和完整 `ready` **尚未执行**。不得将 Node 代理自身通过误称为 Runtime 或 Nginx 已验收。
- 所有新功能交付为 Draft PR，创建后将 Assignee 指派 `@adui-dev` 并核验；未获明确授权不得合并或发布。

### 第二十六批首轮 Windows 浏览器与 Lint 反馈（2026-11-13）

维护者已启动 `dev:react`（`127.0.0.1:15173`）和 `dev:vue`（`127.0.0.1:15174`），均显示 Vite+ Ready。运行 `pnpm run test:sse:fault:browser` 后，**React 的真实 TCP 下行阻断、STALE、主动重连和连接回收通过**；Vue 在注入前断言失败：`故障注入前必须只有一条有效 SSE TCP 流`（实际 **0 !== 1**），因此整条命令退出码 1，**不能标记为双框架通过**。`vp check --fix` 反馈 129 个受检文件 **0 errors、1 warning**：浏览器脚本 `recovered` 变量未使用，并已运行格式修复。

**已定位代码根因：** 测试专用 TCP 故障代理原先仅用 socket 的第一条 HTTP 请求行决定是否为 SSE；浏览器可能复用 Keep-Alive 连接，先获取 Vue 页面资源，再在同一 socket 上请求 `/demo/events`，从而出现 UI 已经 live、代理 `activeSseCount() === 0` 的分类遗漏。该结论来自代理实现缺陷；当前日志没有直接抓到 Vue 每个 socket 的请求顺序，故不将复用行为描述为已经抓包证实。

**本分支定向修正：** TCP 代理对同一个下游连接持续识别后续的 `GET /demo/events`/`GET /events` 请求行，使用最多 256 字节尾部缓存跨 TCP 分块解析，不改变普通流的转发规则。新增第 4 条 Node 回归，用同一个 `http.Agent({ keepAlive: true, maxSockets: 1 })` 确认同一 socket 先访问 `/health`、再访问 `/demo/events`，随后可以冻结真实 SSE 字节且完成连接回收。浏览器脚本要求页面恰有一条有效 EventSource 且测试代理恰有一条 SSE socket，稳定 400ms 才故障注入，消除初次页面加载时的判断竞态；`recovered` 现参与同源订阅路径一致性断言，修复未使用变量警告。

**修复后验证状态：** 代码通过静态 JavaScript 语法解析，协作环境的独立 Node 22 Keep-Alive 实验复现成功，但**没有在完整仓库执行修改后的四项 Node 单测、双框架真实 Chrome/Edge、`vp check` 或 `pnpm run ready`**。维护者需同步分支后重跑 `pnpm run test:sse:fault:unit`、`pnpm run test:sse:fault:browser`、`vp check`、`pnpm run docs:check`、`pnpm run ready`；Docker 专项与持续长连接仍独立待测。

只更新测试工具和验收文档，没有改动共享 Runtime、Core、Vue/React 页面或生产服务；PR #48 继续 Draft，不经明确授权不合并。

### 第二十六批第二轮 Windows 双框架与完整质量链复验通过（2026-11-13）

维护者上传最新 PowerShell 日志证实：`pnpm run test:sse:fault:browser` 分别打印 **React 和 Vue 真实 TCP 下行阻断、STALE、主动重连及连接回收通过**，浏览器测试退出码 **0**。此前 Vue 的 `0 !== 1` SSE socket 分类失败已由 Keep-Alive 复用识别及稳定就绪判断修复；本轮不再复现。

`vp check` 实测 **260 个文件格式正确，129 个受检文件零警告、零错误，退出码 0**；此前 `recovered` 未使用变量告警已经消除。`pnpm run docs:check` **74 个 Markdown 文件通过**。`pnpm run ready` **退出码 0**，包括依赖检查 11 个清单/51 项 Catalog、9 个 TSConfig 消费端、155 个自有文件中文文案检查、根环境与 LF 检查、Prisma Client 7.10.1 生成、Vue/React/NestJS 类型检查和构建。全量 Vitest **412/412（36 文件）**、Node SSE 连接资源专项 **8/8**、Node TCP 故障代理专项 **4/4**（含同一 Keep-Alive socket 的后续 SSE 请求）、NestJS E2E **17/17（3 文件）**。

E2E 中的 HTTP 503 / `Health Check has failed!` 属于主动模拟服务不可用的预期负面测试，不代表 E2E 失败。

**仍待独立验收：** `pnpm run test:sse:fault:proxy`（Docker Nginx 双框架故障注入）、`pnpm run test:sse:soak` 与 `pnpm run test:sse:soak:proxy`（六路持续心跳及增量）。本批实际故障注入为本机测试代理阻断 TCP 下行字节，不等同真实 Nginx 半开、长时高并发、生产鉴权、PostgreSQL 真库或工业现场验收。

本次仅提交验收文档，**文档提交后的 `vp check` 与 `docs:check` 尚未重新执行**。PR #48 保持 Draft、Assignee `@adui-dev`，没有收到明确合并授权。

### 第二十六批最终 Docker TCP 故障与持续连接验收通过（2026-11-13）

维护者提供最新 Windows PowerShell 日志，本批剩余 **3 条专项测试全部通过，均退出码 0**：

- `pnpm run docker:demo:ps`：本机演示栈 Demo、NestJS Server 均 `healthy`；React 宿主机映射 `127.0.0.1:18080->8080/tcp`，Vue `127.0.0.1:18081->8080/tcp`，与统一根 `.env` 一致。该日志不代表更改或重新部署 Docker。
- `pnpm run test:sse:fault:proxy`：**React/Vue Docker Nginx 双框架均通过**真实 TCP SSE 下行静默注入、Tag STALE、主动重连、快照恢复和连接回收，**退出码 0**。
- `pnpm run test:sse:soak`：独立 Demo `127.0.0.1:14178/events` 六路流通过首包快照、具名心跳、单路断开隔离、新快照，随后每路持续至少 **12 次心跳和有效增量**、连接清理通过，**退出码 0**。
- `pnpm run test:sse:soak:proxy`：Docker Nginx 的 React `18080/demo/events` 与 Vue `18081/demo/events` 两入口各六路全部通过上述持续事件与连接回收验证，**退出码 0**。
- 专项完成后再次执行 `vp check`：**260 个文件格式正确、129 个受检文件零警告零错误，退出码 0**；`pnpm run docs:check`：**74 份 Markdown 文件通过，退出码 0**。

结合前轮维护者实测，双框架开发环境 `test:sse:fault:browser` **退出码 0**，完整 `pnpm run ready` **退出码 0**：全量 Vitest **412/412（36 文件）**、Node SSE 资源 **8/8**、Node TCP 故障代理 **4/4**、NestJS E2E **17/17（3 文件）**，双框架和 NestJS 类型检查、构建通过。**第二十六批本机 Windows/Docker 自动化验收项已全部通过。**

**范围限制：** 真实被阻断的是本机测试代理内的 TCP SSE 下行字节，未直接模拟真实 Nginx 宕机、物理断网、工业网关故障。有限六路持续观测不是长期高并发/慢消费内存背压或生产 SLA，生产鉴权、PostgreSQL 真库与现场设备仍未验收。本次仅追加验收记录，**最新文档提交后的 `vp check` 与 `docs:check` 尚未重新执行**；建议合并前再做一次静态复查。PR #48 继续 Draft，未经维护者明确授权不得合并。
