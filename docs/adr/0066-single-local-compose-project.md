# ADR-0066 · 统一本机 Docker Compose 项目并保留既有数据卷

- 状态：Proposed
- 验收：Windows Docker 切换待维护者执行
- 日期：2026-11-16
- 范围：本机开发、演示和 OIDC Lab；不包含生产单镜像交付

## 背景

ADui SCADA 现有三个 Docker Desktop Compose 项目：`adui-scada-v01-demo`（React/Vue HTTP Demo、NestJS Demo Server、模拟数据）、`adui-scada-postgres-dev`（旧本地开发 PostgreSQL）和 `adui-scada-oidc-lab`（Keycloak、Redis、隔离 PostgreSQL）。维护者希望统一为一个可一键启动/管理的 `adui-scada` 项目。Keycloak 和 PostgreSQL 中已经存在真实测试用户、数据库迁移与 OIDC `issuer+sub` 绑定，不允许丢失。

原 `.env` 当前可指向 Lab 数据库 `15433`，而旧开发 PostgreSQL 仍使用 `15432`。直接合并旧文件会让同名 `postgres` 服务覆盖、错误关联数据卷或造成端口冲突。

## 决定

1. 新增 `deploy/docker/compose.all.dev.yaml`，顶层 `name: adui-scada`，将 Demo 四服务和 Lab 三服务归入统一 Compose 项目。旧 PostgreSQL 作为 `postgres-dev`，通过 `legacy-db` profile 显式保留；统一脚本同时启用该 profile，原开发库继续使用独立 `15432` 本机端口。
2. **旧数据卷按实际 Docker 卷名外部复用**：`adui-scada-oidc-lab_lab-postgres-data`、`adui-scada-oidc-lab_lab-redis-data`、`adui-scada-postgres-dev_scada-postgres-data`。统一栈的 `external: true` 禁止 Docker 自动创建同名空白卷，也不将两个 PostgreSQL 误当成同一数据库。Keycloak JDBC 主机改为新 Compose 网络服务名 `postgres-lab`，保留其数据库名、Issuer、HTTPS 证书与本机回环端口。
3. 新增 `scripts/docker-all-dev.mjs`，提供只读 `plan`、显式 `migrate`、日常 `up/down/ps/logs`。迁移在执行任何旧项目停止操作前核对 3 个卷存在、端口不冲突、Compose 配置合法。停止旧栈仅使用 `docker compose down`，**没有** `-v`、`volume rm`、`prune`；旧 Compose 文件及原脚本保留为独立回退入口。
4. 所有宿主端口只绑定 `127.0.0.1`，本地 Keycloak 仍保持开发模式。统一栈默认不开放 SCADA 工程匿名写入；原 Demo Web `18080/18081` 仍是 HTTP Demo，**不是**真实 OIDC HTTPS WebStorm `15173/15174`，不会因分组统一而获得正式认证能力。
5. **一个 Compose 项目不等于一个 Docker 镜像或一个容器**：正式一镜像应用交付（共享 Web 前端与 NestJS）须另设版本与生产安全设计，数据库、Keycloak/IdP、Redis 和工业网关保留可独立升级的持久化服务。

## 影响及回滚

首次迁移将短暂停止并重建原有容器，但不迁移数据库内部文件，也不重置现有账户/会话密钥。建议切换前对 Keycloak 与 SCADA Lab 数据库进行可验证的逻辑备份；不要使用运行中数据库的裸文件拷贝代替一致性备份。迁移中若新服务启动失败，应先排查/停止不完整的统一栈，再用原三套 Compose 命令恢复，不使用 `down -v`。原有卷仍按旧名字保留。

统一栈未实现生产 HTTPS 入口/统一身份网关，且 Redis 当前尚未接入 NestJS。Windows 实际容器重建、身份会话、数据库和双 Web 演示回归须维护者在隔离本机环境验收。