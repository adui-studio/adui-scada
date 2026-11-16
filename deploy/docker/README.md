# ADui SCADA · 唯一本机 Docker Compose 项目

项目名称固定为 `adui-scada`，配置文件只有 **`deploy/docker/compose.yaml`**。用于本机开发和演示，不是工业生产部署，也不是将所有组件合并成一个镜像。

| 容器服务  | 职责                                           | 宿主机入口                |
| --------- | ---------------------------------------------- | ------------------------- |
| web-react | React HTTP 模拟演示                            | `127.0.0.1:18080`         |
| web-vue   | Vue HTTP 模拟演示                              | `127.0.0.1:18081`         |
| server    | NestJS Docker Demo（不自动提供 OIDC 业务写入） | 容器内部                  |
| demo      | 只读模拟数据和 SSE                             | 容器内部                  |
| postgres  | 唯一 PostgreSQL 17 实例                        | `127.0.0.1:15433`         |
| redis     | Redis 7.4（尚未接入 NestJS）                   | `127.0.0.1:16379`         |
| keycloak  | Keycloak 26.8.2 本机测试 IdP                   | `https://127.0.0.1:18443` |

**注意**：一个 PostgreSQL 容器内仍有相互隔离的 `adui_scada_oidc_lab`（SCADA）与 `adui_scada_keycloak_lab`（Keycloak）两个逻辑数据库，属于同一 PostgreSQL 实例，不是两个 PostgreSQL 容器。名称暂不变更，避免丢失已经完成的 Prisma 迁移和身份绑定。

## 首次切换：只执行一次

此前 Docker Desktop 显示三个项目组。更新代码后，先检查现有数据库和 Keycloak 的逻辑备份、卷与端口，再执行：

```powershell
git status --short
git pull --ff-only
pnpm run test:docker
pnpm run env:check
pnpm run docker:plan

# 确认有可恢复的 PostgreSQL 逻辑备份后，显式切换
pnpm run docker:migrate
pnpm run docker:ps
```

`docker:migrate` 只停止并删除三个**旧项目的已核验容器**，不删除 Docker 数据卷；然后以 `adui-scada` 启动最新的七服务 Compose。后续只需：

```powershell
pnpm run docker:up
pnpm run docker:ps
pnpm run docker:logs
pnpm run docker:down
```

旧 `docker:demo:*`、`docker:lab:*`、`docker:all:*`、`db:dev:*` 命令及旧 Compose 文件已从仓库移除。旧开发库的 15432 容器不会在最新栈中启动；其原数据卷暂时**保留为历史备份**，未经维护者再次确认不能自动删除。

## 数据保护与配置

SCADA 与 Keycloak 的现有身份、迁移和 Redis 数据仍在已创建的外部 Docker 数据卷中。为防止数据丢失，物理卷名暂保持原来的 `adui-scada-oidc-lab_lab-postgres-data` 和 `adui-scada-oidc-lab_lab-redis-data`。这些是 Docker 卷名称，**不会让 Docker Desktop 额外生成旧 Compose 项目组**。如果以后需要清理旧卷名，必须先做独立的数据迁移及恢复演练，不能直接改 `name:` 指向空卷。

根目录 `.env.example` 可复制为 `.env`，默认关闭 OIDC/HTTPS，不预填数据库口令。需要真实登录联调时，沿用先前已核对的本机随机凭据，`.env` 中的数据库 URL 必须指向同一回环 PostgreSQL 15433；不要覆盖已经验证成功的自定义 `.env`。只有本机证书与凭据生成脚本会使用 `.local/oidc-lab/` 目录，该路径始终被 Git/Docker 忽略。

## 验收

先执行 `pnpm run test:docker`、`vp check`、`pnpm run docs:check`、`pnpm run ready`，再执行真实 `docker:plan` / `docker:migrate`。切换后检查：

- `pnpm run docker:ps` 仅显示 7 个新服务；Docker Desktop 只有 `adui-scada` 项目组。
- Keycloak Discovery 为 HTTP 200，Realm、Client、普通测试用户仍存在。
- PostgreSQL 迁移仍为最新，SCADA 的 `issuer + sub` 身份预绑定未丢失。
- HTTP Demo 的 React/Vue SSE 仍可正常访问；WebStorm 的 HTTPS 15173/15174 仍共享认证身份。
- Cookie、CSRF、工程 ACL 和生产部署不因容器迁移自动判定通过。

任何情况下都不要执行 `docker compose down -v`、`docker volume rm` 或 `docker system prune --volumes`。旧项目切换时会有短暂服务中断。参见 [ADR-0066](../../docs/adr/0066-single-local-compose-project.md) 和 [HARNESS](../../docs/HARNESS.md)。
