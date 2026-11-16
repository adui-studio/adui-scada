# ADR-0066 · 本机单一 Compose 项目与唯一 PostgreSQL 实例

- 状态：Proposed
- 验收：Windows 实际切换待执行
- 日期：2026-11-16
- 范围：本机开发/演示/OIDC 测试，不涉及生产正式部署

## 背景

原 Docker Desktop 中存在 `adui-scada-v01-demo`、`adui-scada-postgres-dev`、`adui-scada-oidc-lab` 三组 Compose。2026-11-16 维护者明确要求**移除遗留 Compose 与独立旧开发 PostgreSQL，只保留名称 `adui-scada` 的一个最新项目**。现有 OIDC Lab PostgreSQL 已应用四项 Prisma 迁移，存有真实 Keycloak 用户及 SCADA 外部身份绑定，因此不可重建或清空。

## 决策

1. 仓库只保留 `deploy/docker/compose.yaml`，顶层 `name: adui-scada`。七个服务为 `web-react`、`web-vue`、`server`、`demo`、`postgres`、`redis`、`keycloak`。没有 `postgres-dev`、`legacy-db` Profile 或第二个 PostgreSQL 容器。
2. 一个 PostgreSQL 17 实例承载互相隔离的两个**逻辑数据库**：现存的 `adui_scada_oidc_lab`（SCADA）与 `adui_scada_keycloak_lab`（Keycloak）。此批只合并容器，不重命名逻辑数据库、凭据、Realm 或 OIDC Issuer。数据库主机在 Compose 内为 `postgres`，宿主仅绑定 `127.0.0.1:15433`。
3. 物理持久化存储继续使用之前经过 Windows 真实联调的卷 `adui-scada-oidc-lab_lab-postgres-data` 和 `adui-scada-oidc-lab_lab-redis-data`，并以 `external: true` 声明。**旧物理卷名只是 Docker 存储标识，不会再创建旧项目组**；禁止在没有完整备份/迁移验证的情况下自动改卷名或创建空数据库。
4. 新增唯一 `docker:plan` / `docker:migrate` / `docker:up` / `docker:down` / `docker:ps` / `docker:logs` 入口。迁移前检查两份现有卷、当前根 `.env` 只能指向同一回环 PostgreSQL、端口互不冲突，以及 Compose 配置合法。仅在维护者显式执行 `docker:migrate` 时，按历史 Compose 项目标签验证、停止并删除**旧容器**，无 `-v`、`volume rm` 等操作。日常 `docker:up` 检测到旧容器时必须拒绝并提示迁移。
5. 旧三套 Compose 文件、短暂存在的八服务统一 Compose 文件及相关多套入口在代码仓库中删除。旧开发库 `15432` 的卷不自动删除，以免销毁未备份数据；该库不再启动且不属于最新项目。
6. `.env.example` 统一默认数据库端口为 `15433`，数据库密码与 Prisma URL 留空；保持 OIDC 默认关闭，不能在公开模板内提供随机秘密或被对话暴露的真实凭据。真实 OIDC 联调继续使用本机已建立的随机凭据和证书。
7. 仍然**不是单镜像**：应用、数据库、Redis、Keycloak 分别容器化。Docker `18080/18081` 当前只读 HTTP 演示，不等同于宿主 WebStorm `15173/15174` 的真实 OIDC HTTPS 和工业生产安全部署。

## 影响和待验收

首次切换会短时停止旧容器。切换前维护者应先对 Keycloak/SCADA 数据库执行可恢复的逻辑备份，并保证没有其他进程同时使用相同 PG 存储。迁移工具只操作白名单标签对应的历史容器，不会删除数据卷；新栈 `up --remove-orphans` 会移除同项目中此前残留的旧开发库容器，但依然保留其卷。发生启动故障时，先排查新栈，不要使用 `down -v` 强制重置。

代码提交前候选 17 项隔离 V8 Mock 检查通过；Windows `vp check`、`ready`、Docker Compose 配置解析、实际项目迁移、身份用户/数据库完整性及 React/Vue SSE/HTTPS 回归均待真实验收。正式单应用镜像和生产部署需另行专项设计。
