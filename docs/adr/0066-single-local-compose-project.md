# ADR-0066 · 唯一 Docker Compose 项目的全新安装

- 状态：Proposed
- 日期：2026-11-16
- 验收：Windows 新容器安装与数据库初始化待维护者验证

## 背景

ADui SCADA 曾分别运行 Demo、独立开发 PostgreSQL、OIDC Lab 三个 Compose 项目。维护者现已删除旧项目及所有旧 Docker 数据卷，明确说明没有数据库备份，并要求以 `adui-scada` 为唯一项目名称，全新建立一个 PostgreSQL 实例，不恢复历史数据。

## 决策

1. 仅保留 `deploy/docker/compose.yaml`，顶层 `name: adui-scada`。七服务均在此项目内管理，PostgreSQL 只有一个容器，Keycloak 与 SCADA 使用同一实例内的不同逻辑数据库。
2. PostgreSQL 初始化账号及业务库均为 `adui_scada`，Keycloak 独立逻辑库为 `adui_scada_keycloak`。宿主机数据库端口仅绑定 `127.0.0.1:15432`；所有对外端口均限回环，不接入真实 PLC/DCS。
3. 不再引用、挂载或自动操作旧数据卷。Compose 通过普通命名卷创建 `adui-scada_postgres-data` 和 `adui-scada_redis-data`，容器删除和默认 `docker:down` 不会删除新卷。
4. 复制默认关闭 OIDC 的根 `.env.example` 为 `.env`；`docker:up` 首次生成 Git 忽略的 `.local/docker/` 本机随机凭据与 mkcert 证书，不将密码固化到公开模板。独立 PostgreSQL 初始建库脚本创建 Keycloak 逻辑库，完成容器启动后执行 Prisma `migrate deploy` 创建 SCADA 业务表。重复部署应幂等，不运行 `migrate reset`。
5. 仅提供 `docker:plan/up/down/ps/logs/db:init` 等面向单栈的命令，不再提供旧数据卷预检或 `docker:migrate`；若仍检测到旧项目容器，一律提示人工处理而非自动停止、移除。
6. 这是 **一个 Compose 项目和七个独立容器**，不是一个包含数据库、Redis、Keycloak 的应用镜像。现有 HTTP Demo Web 与真正 OIDC HTTPS SCADA 写接口保持隔离，认证和工程权限不能自动放开。

## 数据和验收边界

维护者明确表示旧项目及卷已经删除且无备份。因此旧 Keycloak 用户、可信身份映射、SCADA 工程版本记录和会话视为不可依赖，新数据库必须重新进行真实 OIDC 用户创建、身份绑定及安全测试。新配置不会执行数据恢复，也不得声称历史数据已迁回。

代码候选已更新；实际 Windows `pnpm run test:docker`、`test:docker:db`、`vp check`、`pnpm run ready`、`docker:plan/up`、七容器状态、Prisma 实际迁移与 OIDC 登录均待维护者执行验收。

## 2026-11-27 · 当前原生安装启动规则

ADR-0073 已替代早期 Prisma 7 初始化步骤。恢复唯一 adui-scada Compose 七服务一键启动，新增 docker:infra 保留三服务基础设施入口。docker:up 先准备本机随机凭据与证书、验证 Compose 和固定本机 Linux Docker Desktop 命名管道，等待基础设施，再执行已有 Prisma 8 --status 官方严格结构/标记及真实中文注释只读验证；只在成功后构建并启动 server、demo、web-react、web-vue，等待应用服务运行。容器内显式探针经 server 的 lab 网络访问固定 postgres:5432/adui_scada，必须严格只读且与宿主验证的 PostgreSQL 集群 systemIdentifier 一致；复用正式原生根模块全部只读核验与关闭流程。凭据从现有 Git 忽略的随机秘密文件读取，仅经 docker exec -T 标准输入传给一次性探针，不进入服务环境、命令行或报告。两端 Web 探针验证容器网络内静态入口、/api/health、/demo/project、/demo/events 的响应状态及 SSE 内容类型、受保护工程路由保持 404。宿主默认连接白名单和正式数据库生产禁令保持不变。Docker HTTP Server 仍显式关闭 OIDC，不开放身份、工程或设备写入接口；Keycloak 本轮仅验证容器启动，不验证真实登录、JWKS、HTTPS 回调、Cookie 或双端浏览器渲染。不存在数据库自动初始化、迁移、清卷、失败回退、旧库接管或自动授权。 本节取代本文旧的 migrate deploy 初始化说明，早期内容保留为决策历史；实际七服务验证仍待维护者 Windows 执行。

## 2026-11-27 · 双端 HTTPS 演示传输候选

维持同一 Compose 七服务及原有 HTTP 入口，React/Vue 各增加一个仅回环的 HTTPS 发布端口（默认 18480/18481），在同一 Nginx 服务器共享只读代理规则和现有本机 mkcert 叶证书。仅挂载证书及叶私钥两个文件，不向 Web 容器提供 Docker 随机凭据或根私钥。不开放 OIDC、业务写入或新数据库连接；HTTP/HTTPS 均拒绝工程及认证回调路由。宿主严格 TLS 只读探针成为原生数据库及容器 HTTP 验收后的最后一道启动门禁，禁止降级或绕过证书验证。Windows 真实容器联调待验收。

## 2026-11-27 · 固定公开 Issuer 的容器只读探针候选

PR #252 已通过 Windows 真正的双端 HTTPS 传输验收并合入集成分支。本批不修改 Compose/Realm/正式 NestJS OIDC 开关。使用独立宿主与 server 容器 Node 探针，宿主通过回环发布端口，容器通过固定 keycloak:8443 连接；两端均以公开回环 IP 做 TLS 身份校验及 Host 标识，以现有 mkcert 公开根证书为信任锚，精确校验同一公开 Issuer/固定端点与 RS256 签名公钥集合。CA 只经标准输入短时传递，不落入服务环境或镜像，不安装信任根。禁止跟随重定向或连接元数据提供的任意地址。该只读诊断不代表 openid-client 正式传输适配、真实授权码兑换或生产 TLS 身份隔离；登录与业务连接继续单独实施。
