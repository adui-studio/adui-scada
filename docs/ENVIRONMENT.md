# ADui SCADA · 环境变量规范（V0.1）

> V0.1 只读模拟阶段。按照配置作用域分开管理，保持 Vue / React 对等；不将后端密钥写进前端构建产物。

## 配置文件位置

| 路径（提交到仓库）                      | 本地实际配置（Git 忽略）        | 用途                                   |
| --------------------------------------- | ------------------------------- | -------------------------------------- |
| `.env.example`                          | 根 `.env`                       | Docker Compose 的 React/Vue 宿主机端口 |
| `apps/web-react/.env.example`           | `apps/web-react/.env`           | React Vite+ 开发服务器与代理           |
| `apps/web-vue/.env.example`             | `apps/web-vue/.env`             | Vue Vite+ 开发服务器与代理             |
| `apps/server/.env.example`              | `apps/server/.env`              | NestJS 健康检查进程监听                |
| `examples/water-treatment/.env.example` | `examples/water-treatment/.env` | 本机模拟 SSE 服务监听                  |

所有 `.env` 文件均为**可选**：缺失时使用现有端口与安全默认值。直接复制模板后可按需修改（PowerShell）：

```powershell
Copy-Item .env.example .env
Copy-Item apps/web-react/.env.example apps/web-react/.env
Copy-Item apps/web-vue/.env.example apps/web-vue/.env
Copy-Item apps/server/.env.example apps/server/.env
Copy-Item examples/water-treatment/.env.example examples/water-treatment/.env
```

不要提交实际 `.env`、密钥、认证令牌和设备网络地址。仓库 `.gitignore` 已忽略 `.env` 与 `.env.*`，只跟踪 `.env.example`。

## 前端环境配置

Vue/React 各自的 `vite.config.ts` 使用 Vite 的 `loadEnv(mode, process.cwd(), "SCADA_")`，读取当前应用目录下的配置，**不会**把 `SCADA_*` 暴露给浏览器。当前支持：

| 变量                      | React 默认              | Vue 默认    | 约束                                 |
| ------------------------- | ----------------------- | ----------- | ------------------------------------ |
| `SCADA_WEB_HOST`          | `127.0.0.1`             | `127.0.0.1` | 仅 `127.0.0.1`、`localhost`          |
| `SCADA_WEB_PORT`          | `5173`                  | `5174`      | 1–65535 的整数                       |
| `SCADA_DEMO_PROXY_TARGET` | `http://127.0.0.1:4178` | 同左        | 仅本机 HTTP Origin，无认证信息和路径 |

**注意：** Tauri 开发模式的 `devUrl` 目前仍固定为 React `5173`、Vue `5174`。如需运行 `desktop:dev:*`，应保持这两个默认端口；调整 `SCADA_WEB_PORT` 仅用于独立 Web 开发，除非同时调整对应 Tauri 配置。

开发用 `/demo/project`、`/demo/events` 代理仍然遵循同源路径，浏览器无需直接访问其他域名。V0.1 演示接口未经认证，因此禁止将代理配置为公网/工业设备地址。

Vite 还支持按模式覆盖的 `.env.development`、`.env.production`、`.env.desktop` 及其 `.local` 变体（均不提交）。本项目 Tauri MSI 的 `--mode desktop` 仍**强制使用共享 Core 的离线模拟**；环境配置不会切换为真实设备采集。

以后需要在前端展示的、非敏感的构建期变量，可专门使用 `VITE_*`；这类变量会进入打包的浏览器代码，因此**绝不能放密码、私钥、Token 或工业网络凭据**。当前没有新增任何需要公开给浏览器的环境变量。

## 后端与本地模拟服务

NestJS 在入口 `apps/server/src/main.ts` 读取同级项目根目录的可选 `.env`，模拟器在 `examples/water-treatment/server.mjs` 读取自己的可选 `.env`。使用 Node 内置 `loadEnvFile`，**无额外 dotenv 依赖**。

| 变量        | 默认值      | 说明                                                  |
| ----------- | ----------- | ----------------------------------------------------- |
| `NODE_ENV`  | 未设置      | 示例为 `development`；Docker 指定 `production`        |
| `HOST`      | `127.0.0.1` | NestJS 主机监听，允许 `0.0.0.0` 仅供容器内部网络使用  |
| `PORT`      | `3001`      | NestJS HTTP 端口（整数 1–65535）                      |
| `DEMO_HOST` | `127.0.0.1` | 无鉴权 SSE 模拟器监听地址；同样仅 Docker 允许容器绑定 |
| `DEMO_PORT` | `4178`      | 模拟服务端口（整数 1–65535）                          |

Node 已存在的进程环境变量优先，`.env` 主要用于本机开发；Docker 通过 Compose 的 `environment` 直接传值，不需要把密钥文件烘焙进镜像。

如果改变 `DEMO_PORT`，须相应修改两个 Web 的 `SCADA_DEMO_PROXY_TARGET`。Docker 内部模拟服务固定 `4178`，**请勿仅修改本机 `DEMO_PORT` 却不修改容器代理**。

## Docker Compose 本地演示

根目录 `.env` 由 Docker Compose 解析；并不等于 Vue/React 应用目录下的 `.env`。支持：

| 变量               | 默认   | 用途                   |
| ------------------ | ------ | ---------------------- |
| `SCADA_REACT_PORT` | `8080` | 宿主机 React HTTP 端口 |
| `SCADA_VUE_PORT`   | `8081` | 宿主机 Vue HTTP 端口   |

例如修改根 `.env` 为 `SCADA_REACT_PORT=9000`、`SCADA_VUE_PORT=9001`，使用 `docker compose -f deploy/docker/compose.demo.yaml up -d` 后从 `127.0.0.1:9000` 和 `127.0.0.1:9001` 访问。Compose 中宿主机监听地址仍**固定为 127.0.0.1**，不允许通过 `.env` 改成公网绑定。

## 检查与安全边界

```powershell
pnpm run env:check
pnpm run ready

docker compose -f deploy/docker/compose.demo.yaml config
```

`env:check` 静态校验环境模板、默认端口、配置引用、Git 忽略和 Docker 监听配置；`ready` 包含它。项目尚未实现正式生产级配置管理、Secret Manager、设备网关、数据库或对外公开部署。

不要将 `--mode desktop` 误认为 Vite 的 `production` 模式，也不要将 Docker Compose 中的 `NODE_ENV=production` 误认为业务平台生产就绪。

**本轮新增配置在 GitHub 开发分支，尚未在用户 Windows 上完成本轮 `pnpm run ready` / Docker 回归验证。**
