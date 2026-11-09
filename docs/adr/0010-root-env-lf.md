# ADR-0010：统一根目录环境变量与 Git LF 检出规则

- 状态：Accepted
- 日期：2026-11-09
- 替代：[ADR-0008](0008-env-configuration.md)

## 背景

原有 V0.1 五个 `.env.example` 分散在根、React、Vue、NestJS 和 SSE，开发人员需要复制多份；改变模拟端口容易让 Vite 代理与 Docker Nginx 上游不一致。Windows 的 Git 检出还可能受 `core.autocrlf=true` 影响产生 CRLF，而 Oxfmt 与 EditorConfig 要求 LF，造成 `vp check --fix` 每次大量无意义格式变化。

## 决策

1. 仅保留根 `.env.example` 与被 Git 忽略的可选根 `.env`。所有变量采用 `SCADA_*` 命名，Vue/React 共享根 `envDir`、各自使用独立开发端口。
2. NestJS 与模拟 SSE 用 Node 内置 `loadEnvFile` 定位到仓库根目录，兼容旧环境中的 `HOST` / `PORT` / `DEMO_HOST` / `DEMO_PORT` 作为后备，但不再读各子目录 `.env`。
3. Docker Compose 从仓库根目录加载同一文件，将 Web 宿主机端口与容器内部 NestJS/SSE 端口分别注入；Nginx 官方镜像的 `envsubst` 模板用相同内部端口，健康检查跟随环境设置。Web 宿主机依旧仅绑定 `127.0.0.1`；NestJS/SSE 不发布宿主机端口。
4. 文本文件通过 `.gitattributes` 明确 `text=auto eol=lf`；与仓库根 `.editorconfig`、Oxfmt `endOfLine: "lf"` 一致，Windows 原生命令脚本 `.bat/.cmd` 按 CRLF 特例。
5. `env:check` 检查唯一模板及配置路径、端口、Git 换行符规则和 Docker 代理模板；未新增第三方依赖、Schema、Runtime 设备命令或生产发布能力。

## 安全与权衡

Vite `SCADA_*` 只能作为本地配置，不扩展到浏览器的 `envPrefix`；禁止在 `VITE_*` 中保存密钥。Docker 镜像构建上下文排除真实 `.env`，容器通过环境变量读取所需的非敏感参数。Nginx 模板渲染增加一项启动配置依赖，必须以 Docker Compose `config`、容器 `nginx -t` 与 HTTP/SSE 检查验证。

`.gitattributes` 对后续检出生效，不保证自动改写已经存在的 CRLF 工作树文件；迁移期间必须保留开发人员尚未推送的 `vp check --fix` 格式化提交，不能强制覆盖。未来如转生产部署，需要 Secret Manager、网关隔离、授权与 HTTPS 等独立设计。

**本 ADR 对应源代码仍在 V0.2 开发分支，Docker/LF/跨平台完整回归尚待执行。**
