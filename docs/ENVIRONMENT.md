# ADui SCADA · 唯一根目录环境配置（V0.2）

> 当前为 V0.2 本地 Studio 与 V0.1 只读模拟服务。**仅维护仓库根目录一份 `.env`**，Vue、React、NestJS、模拟服务和 Docker 都从这里读取。实际值不入 Git。

## 一、创建配置

在仓库根目录执行（不要强制覆盖已有配置）：

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
pnpm run env:check
```

仓库只跟踪一个 `.env.example`。原先的四份子目录 `.env.example` 已删除；你先前复制在子目录中的 `.env` 仍是被忽略的本地文件，**新版代码不再读取这些文件**。如有自定义值，请合并到根 `.env`，确认后再手动删除旧文件。

未创建根 `.env` 时，所有进程沿用表格中的安全默认值。

| 变量                   | 默认值      | 用途                                     |
| ---------------------- | ----------- | ---------------------------------------- |
| `SCADA_WEB_HOST`       | `127.0.0.1` | React/Vue 本地开发监听，允许 `localhost` |
| `SCADA_REACT_DEV_PORT` | `5173`      | React 开发 Web                           |
| `SCADA_VUE_DEV_PORT`   | `5174`      | Vue 开发 Web                             |
| `SCADA_SERVER_HOST`    | `127.0.0.1` | NestJS 本机监听                          |
| `SCADA_SERVER_PORT`    | `3001`      | NestJS HTTP 端口                         |
| `SCADA_DEMO_HOST`      | `127.0.0.1` | 无鉴权 SSE 模拟服务监听                  |
| `SCADA_DEMO_PORT`      | `4178`      | SSE 模拟服务及两套 Web 开发代理目标      |
| `SCADA_REACT_PORT`     | `8080`      | Docker React 宿主机 HTTP 端口            |
| `SCADA_VUE_PORT`       | `8081`      | Docker Vue 宿主机 HTTP 端口              |

全部端口限制为 1–65535 的整数。开发 Web 只允许 loopback 主机；NestJS/SSE 允许 `0.0.0.0` 仅为了**不向宿主机发布端口**的隔离 Docker demo 网络，不能把无鉴权模拟服务放到工业网或公网。

## 二、React / Vue / Tauri

两个 `vite.config.ts` 都以自身文件位置定位仓库根目录 `envDir`，从那里执行 `loadEnv(mode, envDir, "SCADA_")`。Vue、React 拥有独立的 `*_DEV_PORT`，共享 `SCADA_DEMO_PORT`，代理固定 `http://127.0.0.1:<模拟端口>`；不接受外部任意主机目标。实际进程环境中同名变量优先于文件值。

`envDir` 同时让 Vite 按既定 mode 读取根目录环境文件；当前仅维护单个 `.env`。Vite 默认只向浏览器公开 `VITE_*`，不能将真实口令、Token、PLC 地址或其他秘密设为 `VITE_*`。`SCADA_*` 只用于构建/服务配置，不作为公开客户端变量。

Tauri `desktop` 构建模式仍明确选择本机离线模拟。Tauri 开发 `devUrl` 目前固定为 React 5173 / Vue 5174；修改本地 Web 开发端口后若要运行 `desktop:dev`，必须另行同步其 Tauri 配置。此次没有变更 Tauri 发布或工业通信行为。

## 三、NestJS / SSE / Docker

NestJS（源码 `src/main.ts` 与构建 `dist/main.js`）以及 `examples/water-treatment/server.mjs` 都采用 Node 内置 `loadEnvFile` 读取仓库根 `.env`。已有进程环境变量优先；兼容旧环境中 NestJS 的 `HOST` / `PORT`、模拟服务的 `DEMO_HOST` / `DEMO_PORT`，但新配置请只使用 `SCADA_*`。

从**仓库根目录**执行 Docker Compose，Compose 自动读取同一根 `.env`。它会将 `SCADA_SERVER_PORT`、`SCADA_DEMO_PORT` 注入各自 Node 容器、Web Nginx 容器与健康检查；官方 Nginx 镜像从 `/etc/nginx/templates/default.conf.template` 生成代理配置，避免端口漂移。Docker Web 容器内部仍监听 8080，宿主机 `SCADA_REACT_PORT` / `SCADA_VUE_PORT` 仅改变映射端口且固定绑定 `127.0.0.1`。

Docker 镜像通过 `.dockerignore` 排除实际 `.env`，只使用 Compose 明确传入的变量。容器内监听主机强制为 `0.0.0.0` 以供专用容器网络通信；NestJS/SSE **不对宿主机发布**。Docker demo 不具备正式生产权限、工业网关或秘密管理系统。

## 四、LF / CRLF 防抖规则

仓库使用 **LF 作为统一文本格式**，并在三个层级保持一致：

1. `.editorconfig`：`end_of_line = lf`；
2. `@adui/tooling/format`（Oxfmt）：`endOfLine: "lf"`；
3. `.gitattributes`：`* text=auto eol=lf`，强制 Git 在 Windows 上检出 LF 文本；只有原生 `.bat/.cmd` 明确保留 CRLF。

因此不要把 Vite+ 改成 CRLF，否则会在开发机与 CI 来回修改。新规则不会自动重写已检出的所有旧文件：第一次同步后仍可能需要运行一次 `vp check --fix`。**不要为了规范换行符执行强制 checkout、reset 或批量覆盖未提交文件。**

如 Windows Git 全局设置 `core.autocrlf=true`，仓库显式 `.gitattributes` 优先；也可以仅在仓库中设置 `git config --local core.autocrlf input`。先运行 `git status --short` 检查本地差异；需要批量规范化索引时使用 `git add --renormalize .` 前先了解其暂存效果。

## 五、验收命令

```powershell
pnpm run env:check
pnpm run ready

docker compose -f deploy/docker/compose.demo.yaml config
pnpm run docker:demo:up
docker compose -f deploy/docker/compose.demo.yaml ps
```

改动 `SCADA_DEMO_PORT`、`SCADA_SERVER_PORT` 后，在 Docker 中验证对应容器健康和 Web 的 `/demo/project`、`/api/health`，并检查 SSE 断连质量。原 V0.1 Docker 实测结果不直接代表本轮动态端口改造通过。

**验收状态**：维护者已确认 React → Vue → React JSON 往返保持图元与 Tag 绑定；本轮单一根 `.env`、Docker Nginx 模板及换行符变更需要新的本机回归测试。

## V0.3 第二十一批：NestJS 本机只读模拟 Tag 接口开关

根目录唯一 `.env.example` 新增 `SCADA_LOCAL_DEMO_API_ENABLED=false`。它与 `SCADA_API_DOCS_ENABLED` 相互独立，仅用于开发诊断；正式启动时要求严格为 `true`、`NODE_ENV` 非 `production`、实际 `SCADA_SERVER_HOST` 解析为 `127.0.0.1`，否则不会注册模拟路由。Docker 示例为 `NODE_ENV=production`、绑定 `0.0.0.0`，始终不可开启。请勿通过端口映射或本机代理将无鉴权模拟接口转发给外部客户端。

仅在确认本机隔离环境后，可以手动设置以下两项并重启 NestJS：

```dotenv
SCADA_LOCAL_DEMO_API_ENABLED=true
SCADA_API_DOCS_ENABLED=true
```

Swagger 地址以启动日志实际端口为准（模板当前默认 `13001`）：`http://127.0.0.1:13001/api/docs`。只读示例端点分别为 `/api/dev/demo/project`、`/api/dev/demo/tags`、`/api/dev/demo/events`（SSE）。结束后将模拟接口开关设回 `false` 并重启服务，确保生产/正常开发默认不暴露新的模拟入口。该模拟模块不会访问数据库或工业设备，不是正式 Tag 数据服务。
