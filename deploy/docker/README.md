# ADui SCADA V0.1 · Docker 本地演示

这是 **只读模拟演示栈**，不是工业 SCADA 生产部署。已实现的 NestJS 仅有 `GET /health`；水处理模拟 SSE 无身份认证。Docker Compose 默认只在宿主机的 `127.0.0.1` 发布两个 Web 入口。

## 运行前置

- Docker Engine / Docker Desktop，启用 Compose V2
- 能拉取 Node 24 与 Nginx 镜像，构建时能访问 npm
- 从仓库根目录执行命令

首次启动（会构建两套 Web、NestJS 与模拟器镜像）：

```powershell
docker compose -f deploy/docker/compose.demo.yaml config
docker compose -f deploy/docker/compose.demo.yaml up --build -d
docker compose -f deploy/docker/compose.demo.yaml ps
```

也可以通过根脚本启动：

```powershell
pnpm run docker:demo:up
pnpm run docker:demo:logs
pnpm run docker:demo:down
```

| 入口     | 地址                               | 用途                                              |
| -------- | ---------------------------------- | ------------------------------------------------- |
| React    | http://127.0.0.1:8080              | React 只读 Runtime，通过同源 `/demo` 获取模拟数据 |
| Vue      | http://127.0.0.1:8081              | Vue 只读 Runtime，共享工程与 Tag 契约             |
| 健康检查 | http://127.0.0.1:8080/api/health   | NestJS 进程存活探针，不代表网关健康               |
| 演示工程 | http://127.0.0.1:8080/demo/project | 只供本地诊断，未经认证                            |
| 演示 SSE | http://127.0.0.1:8080/demo/events  | 演练 `GOOD → STALE → GOOD`                        |

PowerShell 简单测试：

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/health
Invoke-RestMethod http://127.0.0.1:8080/demo/project
curl.exe -N http://127.0.0.1:8080/demo/events
```

最后一条 SSE 会持续输出；使用 Ctrl+C 终止。

## 数据流与安全边界

```text
本机浏览器
  ├─ 127.0.0.1:8080 → React Nginx ─┐
  └─ 127.0.0.1:8081 → Vue Nginx ────┼─ /demo/* → 模拟 Node SSE (容器网络)
                                    └─ /api/health → NestJS (容器网络)
```

只有两套 Nginx 绑定宿主机 loopback；`server` 与 `demo` 服务只配置容器内 `expose`，不发布宿主机端口。NestJS 的 `SCADA_SERVER_HOST=0.0.0.0` 与模拟服务的 `SCADA_DEMO_HOST=0.0.0.0` **仅为容器网络可达**，不代表允许在真实主机或工业网络上公开监听。非容器开发仍默认绑定 `127.0.0.1`。

Nginx 专门代理 `/demo/project`、`/demo/events` 与 `/api/health`，对其他 `/demo/`、`/api/` 路径返回 404，避免把 SPA HTML 返回给 JSON 客户端。SSE 路由关闭代理缓冲，以便及时显示模拟中断状态。

**切勿直接映射 0.0.0.0:8080/8081 或部署到公网**：模拟接口没有鉴权、速率限制或生产级审计；`SIMULATION` / `GOOD` 均不是现场数据。Tauri 2 不需要 Docker，也不会放进 Linux Web 容器。

## 后续生产部署（尚未实现）

正式交付时应将该 demo Compose 与生产部署隔离，新增：

1. 经安全评审的网关独立容器/进程；客户端不直连 PLC/DCS，且不提供默认写入；
2. NestJS 认证授权与版本化发布/Tag API、WebSocket，删除 demo 代理；
3. PostgreSQL / TimescaleDB / Redis 数据备份、持久卷和恢复演练（依实际实现再选定）；
4. HTTPS/WSS 入口、证书管理、网络分区、服务健康检查、日志与审计；
5. 镜像/依赖 digest 固定、供应链扫描、Linux amd64/arm64 测试、生产秘密管理。

## 验证状态

维护者已确认原 V0.1 Docker 演示在 Windows 上运行成功。**本次唯一根 .env 与动态 Nginx 上游端口修改尚未重新 Docker 构建/运行验证**；当前协作环境没有 Docker CLI。即便新的容器回归通过，也不代表生产 SCADA 安全部署通过。

## 统一根 .env 与端口

从仓库根目录运行 Compose；它会读取同一个 `.env`（如不存在使用默认值）。只有一份提交的 [环境变量模板](../../.env.example)，不再为 Docker 单独维护第二份：

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
pnpm run env:check
docker compose -f deploy/docker/compose.demo.yaml config
pnpm run docker:demo:up
```

- `SCADA_REACT_PORT`、`SCADA_VUE_PORT`：映射到宿主机的本地 Web 端口（8080、8081），宿主机 IP **始终 127.0.0.1**。
- `SCADA_SERVER_PORT`、`SCADA_DEMO_PORT`：容器内 NestJS、SSE 的监听端口（3001、4178），Compose 健康检查和 Nginx 上游使用相同变量。
- Docker 容器内 `SCADA_SERVER_HOST` / `SCADA_DEMO_HOST` 会被 Compose **明确覆盖为** `0.0.0.0`，仅供隔离的容器网络使用；本机启动仍按根 `.env` 默认绑定 loopback。
- Nginx 官方镜像会将 `/etc/nginx/templates/default.conf.template` 中的内部端口变量替换为实际值，避免更改端口后代理继续指向旧地址。
- `SCADA_REACT_DEV_PORT`、`SCADA_VUE_DEV_PORT` 只用于本地 Vite+ 开发服务器，不影响 Docker 的 Nginx 8080 容器内部监听。

改动任何端口后需要重新创建相关容器：`pnpm run docker:demo:up`（带 `--build`）。正式工业业务和公网部署仍未实现。

详细变量见 [环境配置说明](../../docs/ENVIRONMENT.md)。

## V0.3 第二十五批 · SSE Nginx 多客户端烟测

本机 Docker Demo 栈启动完成后，在根目录执行 `pnpm run test:sse:proxy`。脚本从根 `.env` 读取 `SCADA_REACT_PORT`、`SCADA_VUE_PORT`，仅通过宿主机的 `127.0.0.1` 访问 React/Vue Nginx 的 `/demo/events`，各验证 6 路真实 SSE 快照、heartbeat、单客户端断开隔离和重连先收到 snapshot。脚本不会重建容器、修改代理或执行生产网络故障注入。Docker 演示 SSE 共享同一个独立 Node 模拟服务，该服务本批增加 32 路连接上限和 64 KiB 单路背压保护；Nginx 路由与 Docker 暴露范围不变。**本批 Docker 实际网络烟测仍待维护者执行**。详见 [ADR-0057](../../docs/adr/0057-local-sse-capacity-and-proxy-validation.md)。

### 统一读取根环境文件及端口检查

Docker 演示栈由根目录命令 `pnpm run docker:demo:up/down/logs` 统一调用 `docker compose --env-file .env -f deploy/docker/compose.demo.yaml`，与本机 SSE 网络测试从根 `.env` 读取的端口一致；不要通过旧版省略 `--env-file` 的命令启动。端口更新后运行：

```powershell
pnpm run env:check
pnpm run docker:demo:up
pnpm run docker:demo:ps
pnpm run test:sse:proxy
```

默认发布映射应为 React `127.0.0.1:18080->8080/tcp`、Vue `127.0.0.1:18081->8080/tcp`。如仍显示旧 `8080/8081`，检查 PowerShell 的同名环境变量是否覆盖根 `.env`；不要分享含数据库密码的完整配置转储。此修正是本地 Docker 演示端口一致性保护，尚未证明网络代理或工业生产环境通过验收。

### 第二十六批 · Docker Nginx SSE 下行静默与持续流回归

本机已启动的 Docker Demo 演示栈无需重新配置，即可在仓库根目录使用 `pnpm run test:sse:fault:proxy` 对 React `18080`、Vue `18081` 的 SSE 入口分别进行临时 TCP 代理下行静默测试；通过真实浏览器观察共享 Runtime 的 STALE、15 秒重建和 socket 回收。运行 `pnpm run test:sse:soak:proxy` 可按端口分别观测六路连接的持续 12 次心跳及 Tag 增量。测试只访问固定本机回环地址，不停止现有容器、修改 Nginx 或开放新服务端路由。短时 TCP 字节屏蔽不代表 Nginx 自身宕机或真实工业网络已验收；详见 [ADR-0058](../../docs/adr/0058-tcp-sse-fault-and-soak-tests.md)。
