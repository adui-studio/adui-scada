# ADR-0007：V0.1 Docker 只读模拟演示与未来生产部署边界

- 状态：Accepted
- 日期：2026-11-09

## 背景

用户计划将来通过 Docker 部署 ADui SCADA。现阶段仓库已有 React/Vue Web、NestJS 进程存活探针、共享 Core/Runtime、模拟 Node SSE、Tauri Windows 桌面壳，但**没有**认证、网关、数据库、生产 API 或项目发布。直接打包成“生产 Docker SCADA”会误导使用者，并让无鉴权模拟数据服务暴露到公网。

## 决策

1. 当前仅提供 `deploy/docker/compose.demo.yaml`：React 与 Vue 使用同一 `Dockerfile.web` 选择构建入口，Nginx 静态部署；NestJS 与模拟 SSE 分别独立 Node 容器。
2. 仅发布宿主机 `127.0.0.1:8080`、`127.0.0.1:8081`；NestJS 与模拟器不发布端口，只连容器网络。Node 服务仅在明确传入 HOST/DEMO_HOST 时允许监听容器 `0.0.0.0`，非容器默认绑定 loopback。
3. Nginx 同源代理既有 `/demo/project`、`/demo/events` 和 `/api/health`；不定义未实现的业务 API。SSE 关闭代理缓冲；未知 API 返回 404，不能被 SPA HTML fallback 掩盖。
4. Docker 只用于 Web/服务端；Tauri Windows 安装包仍独立构建。
5. 根 `pnpm-workspace.yaml` 的第三方版本和锁文件仍作为安装事实；镜像不私带另一个 Node 包管理体系。应用代码、Tag/Schema、质量语义继续在双框架共享。

## 后果与风险

- 仅构建出可复现性有待进一步确认的本地演示镜像；尚需在具备 Docker 的环境运行 Compose config、build、ps、curl 与 GOOD/STALE 恢复验证。
- Dockerfile 使用 Node 24 具体小版本、Nginx stable 标签；生产使用前需固定 digest 并进行供应链扫描。
- 本演示没有 HTTPS、认证、授权、持久化或设备采集，禁止公网/现场部署；未来生产 Compose 应独立设计，明确网关网络隔离、秘密管理、数据库迁移与备份。
