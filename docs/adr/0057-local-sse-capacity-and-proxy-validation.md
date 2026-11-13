# ADR-0057：本机 SSE 模拟连接容量、背压保护与代理多客户端回归

- 状态：Proposed
- 日期：2026-11-13
- 关联：FR-007、FR-009、NFR-001、NFR-002、NFR-003、NFR-006
- 前置：[ADR-0055](0055-sse-heartbeat-and-tag-silence.md)、[ADR-0056](0056-sse-browser-visibility-recovery.md)

## 背景

第二十四批已在 Windows 验证 React/Vue 浏览器 SSE 心跳保活、Tag 过期、静默重连与资源回收。但独立水处理模拟服务器原先用没有上限的 `Set<ServerResponse>` 保留订阅，并忽略 `response.write()` 返回的背压信号。慢速或不读取数据的客户端可能持续积累待发送字节，且缺少直接覆盖 Docker Nginx SSE 真实 HTTP 长连接与多客户端隔离的回归入口。

本批继续以独立模拟服务为验收对象，不提前构建正式工业网关容量、真实生产认证或服务端订阅协议。

## 决策

1. 仅在 `examples/water-treatment/sse-clients.mjs` 引入独立的 `DemoSseClients` 管理器，不修改共享 TagStore、TagChange、Runtime、Vue/React UI、NestJS 模拟控制器或数据库。最多允许 **32 路同时在线**的独立 Node SSE 模拟订阅。超过上限时对 `GET /events` 返回 **HTTP 503**、`Retry-After: 5` 和简体中文错误说明，不返回 SSE 成功响应。
2. 每条响应的 `writableLength + 新事件字节数` 不能超过 **64 KiB**。若超限、`write()` 返回 `false`、写入抛出异常，主动移除并销毁该客户端，避免积压待发送的 Tag 增量。其他正常客户端继续接收。此处理为本地模拟服务的**快速失败**，不保证事件补发或工业现场实时消息的可靠投递。客户端重新连接后必须从服务器发送的新 snapshot 建立状态。
3. 客户端在 SSE 响应 `close` 事件后立即从集合移除，不能把普通 GET 请求的 `request.close` 当作长连接生命周期。服务终止时释放心跳和模拟计时器，并结束剩余 SSE 响应。
4. 使用 Node 内置 `node:test` 的 `sse-clients.test.mjs` 覆盖容量、客户端断开、广播隔离、背压、字节上限、写入异常与参数边界。将 `pnpm run test:sse:clients` 加入根 `ready`，不增加任何第三方依赖。
5. 新增 `scripts/test-runtime-sse-network.mjs`，通过原生 Node `fetch` 读取真实 HTTP SSE 分块，分别允许 **默认直连本机独立模拟服务**（`pnpm run test:sse:network`）或显式访问本机 Docker Nginx 两套 Web 代理（`pnpm run test:sse:proxy`）。每个入口测试 6 路同时订阅均得到 snapshot 与 heartbeat；主动中断一路后其余五路继续收心跳，重新订阅必须先收到 snapshot，最后关闭所有测试连接。
6. 网络测试 URL 固定为 `127.0.0.1`，端口从统一根 `.env` 的 `SCADA_DEMO_PORT`、`SCADA_REACT_PORT`、`SCADA_VUE_PORT` 读取并校验为有效整数，不接受任意外部 URL。不自动拉起、重启、停止 Docker 或改变 Nginx/工业服务配置。
7. 当前 Nginx 演示配置的 SSE 代理已关闭 `proxy_buffering`、`proxy_cache` 并启用 `X-Accel-Buffering: no`，本批仅增加**在真实代理路径上的可执行验证**，不扩大 Docker 暴露端口和默认工业访问范围。

## 验证方式

```powershell
pnpm run test:sse:clients

# 保持独立终端运行 pnpm run dev:demo
pnpm run test:sse:network

# 仅在已启动本机 Docker 演示栈后执行
pnpm run docker:demo:up
pnpm run test:sse:proxy

vp check
pnpm run docs:check
pnpm run ready
```

- 单测失败不应由于客户端尚未启动；直连/代理网络烟测则明确依赖本机已启动的服务。
- Docker 代理烟测会请求演示站点的固定 `/demo/events`，不会向 PLC/DCS、设备写入 API、数据库或外部地址发送请求。
- 人工真实代理故障、Web 页面断网恢复、慢客户端极端压测、长时间 32 路连接压力、跨平台 Docker、生产认证/授权和工业现场均不属于本批自动完成范围；32 路/64 KiB 是本地模拟防护值，不是工业 SLA。

## 验证记录

- 协作容器中已使用 Node 自带测试器运行独立代码副本的 **8 项连接管理回归，8/8 通过**；其中包括真实回环 HTTP 32 路同时连接、第 33 路返回 503、客户端关闭后重入及响应错误回收。仓库中的完整 pnpm 工程未在当前协作容器执行。
- 代码经静态 JavaScript 语法检查；真实独立服务连接、Docker Nginx SSE、Windows 全量 `ready`、Vue/React 构建、格式/Lint 和文档检查仍待维护者本机复验。
- PR 保持 Draft，创建后指派并核验 `@adui-dev`；未获维护者明确合并授权前不合并、发布或部署。

## 首轮 Windows Docker 代理烟测及环境加载修正（2026-11-13）

维护者 Windows 实测：`pnpm run test:sse:clients` **8/8 通过**，`pnpm run test:sse:network` 真实直连独立 Demo 六路 SSE 测试**退出码 0**。Docker 演示栈四服务构建/启动成功，Demo/Server 健康检查通过；但首个 React Nginx 代理入口 `127.0.0.1:18080` 返回 `ECONNREFUSED`。Docker Desktop 显示已发布 `8080`/`8081`，根 `.env` 配置 `18080`/`18081`。

根因定位为 Docker Demo Compose 命令未显式加载根目录 `.env`，导致未按用户设置进行端口插值，同时 Compose 和环境静态检查的回退值没有统一依照根 `.env.example`。修正 `docker:demo:up/down/logs` 命令为 `docker compose --env-file .env -f deploy/docker/compose.demo.yaml ...`，新增只输出容器/映射信息的 `docker:demo:ps`；同步 React/Vue、NestJS 和 Demo 的端口回退值（18080、18081、13001、14178），并在 `env:check` 中强制校验。此修正只改变本机 Docker 演示配置，不影响工业接口与正式部署架构。

`--env-file` 指定的是 Compose 配置插值来源；**PowerShell 已定义的同名环境变量依然优先**。如端口仍不匹配，应检查同名进程环境变量和实际 `docker:demo:ps` 映射。真实修复后的 Nginx 代理六路验收、格式检查与全量质量链仍待维护者执行。

## 第二轮 Windows Docker Nginx 多客户端复验（2026-11-13）

修复演示栈对仓库根目录 `.env` 的显式读取后，维护者执行 `pnpm run env:check` 通过；`pnpm run docker:demo:up` 成功完成四镜像构建和四容器启动，Demo/Server Healthy。随后 `pnpm run docker:demo:ps` 确认宿主机发布端口为 React `127.0.0.1:18080->8080/tcp`、Vue `127.0.0.1:18081->8080/tcp`，与配置一致。

`pnpm run test:sse:proxy` 通过 React/Vue 的真实 Docker Nginx 代理，每套六路并发 SSE 均收到 snapshot 与 heartbeat、单路断开不影响其他连接、恢复订阅先收到 snapshot，**退出码 0**。此前独立模拟服务 8 项 Node 单测及直接 HTTP SSE 六路回归亦已在 Windows 通过。以上验收证明本机 Docker SSE 代理能够工作，**不代表生产高并发、长期半开 TCP、工业网关或真实断网已经验证**。本批最新 `vp check`、文档检查及完整 `pnpm run ready` 仍待执行，PR 不经授权不合并。
