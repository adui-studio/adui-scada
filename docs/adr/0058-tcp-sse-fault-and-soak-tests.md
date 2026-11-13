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
