# ADR-0066 · 唯一 Docker Compose 项目的全新安装

- 状态：Proposed
- 日期：2026-11-16
- 验收：Windows 新容器安装与数据库初始化待维护者验证

## 背景

ADui SCADA 曾分别运行 Demo、独立开发 PostgreSQL、OIDC Lab 三个 Compose 项目。维护者现已删除旧项目及所有旧 Docker 数据卷，明确说明没有数据库备份，并要求以 `adui-scada` 为唯一项目名称，全新建立一个 PostgreSQL 实例，不恢复历史数据。

## 决策

1. 仅保留 `deploy/docker/compose.yaml`，顶层 `name: adui-scada`。七服务均在此项目内管理，PostgreSQL 只有一个容器，Keycloak 与 SCADA 使用同一实例内的不同逻辑数据库。
2. PostgreSQL 初始化账号及业务库均为 `adui_scada`，Keycloak 独立逻辑库为 `adui_scada_keycloak`。宿主机数据库端口仅绑定 `127.0.0.1:15433`；所有对外端口均限回环，不接入真实 PLC/DCS。
3. 不再引用、挂载或自动操作旧数据卷。Compose 通过普通命名卷创建 `adui-scada_postgres-data` 和 `adui-scada_redis-data`，容器删除和默认 `docker:down` 不会删除新卷。
4. 复制默认关闭 OIDC 的根 `.env.example` 为 `.env`；`docker:up` 首次生成 Git 忽略的 `.local/docker/` 本机随机凭据与 mkcert 证书，不将密码固化到公开模板。独立 PostgreSQL 初始建库脚本创建 Keycloak 逻辑库，完成容器启动后执行 Prisma `migrate deploy` 创建 SCADA 业务表。重复部署应幂等，不运行 `migrate reset`。
5. 仅提供 `docker:plan/up/down/ps/logs/db:init` 等面向单栈的命令，不再提供旧数据卷预检或 `docker:migrate`；若仍检测到旧项目容器，一律提示人工处理而非自动停止、移除。
6. 这是 **一个 Compose 项目和七个独立容器**，不是一个包含数据库、Redis、Keycloak 的应用镜像。现有 HTTP Demo Web 与真正 OIDC HTTPS SCADA 写接口保持隔离，认证和工程权限不能自动放开。

## 数据和验收边界

维护者明确表示旧项目及卷已经删除且无备份。因此旧 Keycloak 用户、可信身份映射、SCADA 工程版本记录和会话视为不可依赖，新数据库必须重新进行真实 OIDC 用户创建、身份绑定及安全测试。新配置不会执行数据恢复，也不得声称历史数据已迁回。

代码候选已更新；实际 Windows `pnpm run test:docker`、`test:docker:db`、`vp check`、`pnpm run ready`、`docker:plan/up`、七容器状态、Prisma 实际迁移与 OIDC 登录均待维护者执行验收。