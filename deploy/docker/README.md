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

| 入口 | 地址 | 用途 |
| --- | --- | --- |
| React | http://127.0.0.1:8080 | React 只读 Runtime，通过同源 `/demo` 获取模拟数据 |
| Vue | http://127.0.0.1:8081 | Vue 只读 Runtime，共享工程与 Tag 契约 |
| 健康检查 | http://127.0.0.1:8080/api/health | NestJS 进程存活探针，不代表网关健康 |
| 演示工程 | http://127.0.0.1:8080/demo/project | 只供本地诊断，未经认证 |
| 演示 SSE | http://127.0.0.1:8080/demo/events | 演练 `GOOD → STALE → GOOD` |

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

只有两套 Nginx 绑定宿主机 loopback；`server` 与 `demo` 服务只配置容器内 `expose`，不发布宿主机端口。NestJS 的 `HOST=0.0.0.0` 与模拟服务的 `DEMO_HOST=0.0.0.0` **仅为容器网络可达**，不代表允许在真实主机或工业网络上公开监听。非容器开发仍默认绑定 `127.0.0.1`。

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

源文件已加入 GitHub 开发分支；**当前协作环境没有 Docker CLI，也不能实际构建或运行容器**。需开发者在具备 Docker Desktop 的 Windows 主机运行上述命令并提供输出，才可标记为“Docker 演示通过”。不将本次交付视为生产部署。
