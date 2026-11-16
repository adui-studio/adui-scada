# ADui SCADA · Docker 本机全新安装

只维护一份 `deploy/docker/compose.yaml`，项目名 **`adui-scada`**。共有七个独立服务：`web-react`、`web-vue`、`server`、`demo`、`postgres`、`redis`、`keycloak`。**只有一个 PostgreSQL 17 容器**，其中的 `adui_scada` 是业务数据库、`adui_scada_keycloak` 是 Keycloak 的独立逻辑数据库。

## 第一次安装

前提为 Docker Desktop 已启动、Node/pnpm 依赖已安装、`mkcert` 已安装及本机根证书已信任。本方案仅用于回环本机开发/演示，不可直接用于生产。

```powershell
# 如果仓库根目录仍有旧 .env，先在本机保存备份，不输出其中的密钥。
if (Test-Path .env) {
    Copy-Item .env (".env.backup." + (Get-Date -Format yyyyMMddHHmmss))
}
Copy-Item .env.example .env -Force

pnpm run docker:plan
if ($LASTEXITCODE -ne 0) { throw "Docker 安装预检失败" }
pnpm run docker:up
if ($LASTEXITCODE -ne 0) { throw "Docker 全新安装或数据库初始化失败" }
pnpm run docker:ps
```

`docker:up` 会准备 `.local/docker/` 下 Git 忽略的 **随机密码与本机 TLS 证书**，验证唯一 Compose 配置并创建 **`adui-scada_postgres-data`**、**`adui-scada_redis-data`** 两个新卷，启动七个容器，随后将现有 Prisma 迁移部署到新业务库 `adui_scada`。已有本地秘密文件不会自动被覆盖；密码不会写入仓库模板。`docker:db:init` 可在服务已运行后重试幂等的 Prisma 迁移。

**历史情况**：维护者已删除三个旧 Docker 项目与数据卷，且没有数据库备份。因此这是新安装，不是迁移或恢复。以前的 Keycloak 用户、SCADA 身份预绑定、工程历史和旧会话都不会自动回来。如果 Docker Desktop 实际仍有旧项目容器，预检会拒绝自动清理；请先自行确认。

## 日常命令

```powershell
pnpm run docker:up
pnpm run docker:ps
pnpm run docker:logs
pnpm run docker:down
pnpm run docker:db:init
```

`docker:down` 不带 `-v`，保留新卷；第二次 `docker:up` 不会重置密码、Keycloak 账户或已部署的表。严禁为排错随意执行 `down -v` 或 `docker volume rm`。

| 服务                                      | 本机入口                  |
| ----------------------------------------- | ------------------------- |
| React Docker HTTP Demo                    | `http://127.0.0.1:18080`  |
| Vue Docker HTTP Demo                      | `http://127.0.0.1:18081`  |
| PostgreSQL（SCADA + Keycloak 两个逻辑库） | `127.0.0.1:15433`         |
| Redis                                     | `127.0.0.1:16379`         |
| Keycloak HTTPS                            | `https://127.0.0.1:18443` |

**OIDC 安全边界**：根 `.env.example` 的 OIDC 默认关闭，HTTP Demo 不能替代 WebStorm Vite HTTPS 的受保护工程 API。Keycloak Realm 将重新导入，但普通用户和对应的本地可信身份映射需要重新创建；不会自动授予工程写权限。真实 OAuth 回调、Secure Cookie、CSRF、ACL 和 Vue/React 会话互通仍须在新空库上重新验收。

Prisma 首次迁移是幂等的 `migrate deploy`，不是 `migrate reset`。单镜像生产交付不在本次范围内。
