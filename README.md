# ADui SCADA

ADui Studio 维护的工业 SCADA / HMI 开源项目。**当前 V0.1 是模拟数据与只读监控原型，不是可用于生产的 SCADA 系统。**

## 已实现（V0.1 开发分支）

- **apps/web-react**：React 19 Web 应用，当前仅提供 Runtime 监控页面。
- **apps/web-vue**：Vue 3 Web 应用，当前仅提供 Runtime 监控页面。
- **packages/core**：框架无关的工程 Schema、TagStore、质量状态、SVG 序列化和水处理模拟器。
- **packages/runtime**：浏览器 SSE 诊断客户端，带断线质量标记及自动重连。
- **examples/water-treatment**：本机模拟数据服务器；不连接 PLC/DCS。
- **apps/server**：NestJS 12 ESM 服务，正式默认仅提供 `GET /health` 与 `GET /health/ready`；本机开发可显式开启只读模拟 Tag/SSE 接口，生产不注册该路由。
- **apps/desktop**：Tauri 2 Windows 优先桌面壳，默认 React，可切换 Vue。

Studio（组态编辑器）、真实工业网关、生产业务 API、数据库及 Three.js 尚未实现。NestJS 与 Tauri 目前仅完成最小工程。

## 模板与依赖

对照用户提供的 React、Vue、NestJS、Tauri 四套默认模板；目前已建立 React/Vue、NestJS 本地进程探针与 Tauri 桌面工程；后端业务和工业网关暂不接入。
根目录唯一 `.editorconfig` 约定 UTF-8 / LF / 2 空格。TypeScript 统一继承 `@adui/tsconfig/react`、`@adui/tsconfig/vue`、`@adui/tsconfig/nest` 等配置入口；Format / Lint 由 `@adui/tooling` 提供，并由根 `vite.config.ts` 统一生效。

所有第三方依赖版本在 `pnpm-workspace.yaml` Catalog 中维护，包间使用 `workspace:*`。TypeScript 采用 6.0.3，测试统一使用 Vite+ 集成的 Vitest。

环境按仓库 package.json：Node >= 22.18.0，pnpm 12.18.0，Vite+ 1.5.0。新依赖必须执行 `pnpm install` 后更新并审查锁文件。

```powershell
pnpm install
pnpm run deps:check
pnpm run config:check
pnpm run test:unit
pnpm run typecheck:web
pnpm run typecheck:server
pnpm run test:e2e:server
pnpm run build:web
pnpm run build:server
vp check
pnpm run docs:check
```

启动三个终端：

```powershell
pnpm run dev:demo
pnpm run dev:react
pnpm run dev:vue
```

React: http://127.0.0.1:5173 · Vue: http://127.0.0.1:5174 · 模拟端: http://127.0.0.1:4178

NestJS 本地探针：`pnpm run dev:server`，访问 http://127.0.0.1:3001/health。

Tauri（Windows，需 Rust 和 WebView2 等前置环境）：先启动模拟服务，再运行 `pnpm run desktop:dev:react` 或 `pnpm run desktop:dev:vue`；打包执行 `pnpm run desktop:build:react` 或 `pnpm run desktop:build:vue`。打包产物不包含模拟 SSE 服务，当前不保证离线监控。

模拟服务仅绑定 127.0.0.1。客户端通过 Web dev proxy 的 `/demo` 访问工程与 SSE，不直连工业设备。断线/失效质量不能展示为正常值。

## 规范与状态

[Agent 规则](AGENTS.md) · [需求](docs/REQUIREMENTS.md) · [架构](docs/ARCHITECTURE.md) · [详细设计](docs/SDD.md) · [代码地图](docs/CODEBASE_MAP.md) · [验证](docs/HARNESS.md) · [开发进度](docs/PROJECT_CONTEXT.md) · [工具链说明](docs/V0.1_TOOLCHAIN.md)

当前没有 `LICENSE`；公开 GitHub 仓库不等于已授予开源许可证。

## V0.1 桌面安装版

Tauri MSI 构建（`desktop:build:react:msi` / `desktop:build:vue:msi`）使用独立的 `--mode desktop` Web 构建，内置**明确标注的离线模拟数据源**，无需运行 `pnpm run dev:demo`。Web 开发与桌面开发模式仍需本地 SSE 模拟服务。模拟数据不是 PLC/DCS 实际采集，不能用于生产控制。详情见 [桌面端说明](apps/desktop/README.md)。

## Docker 本地演示部署（V0.1）

已预留 Docker Compose 演示运行方式，分别构建 React / Vue 静态 Web、NestJS 健康检查服务和只读模拟 SSE。**仅绑定本机 127.0.0.1，不可视为生产 SCADA 部署。**

```powershell
docker compose -f deploy/docker/compose.demo.yaml config
pnpm run docker:demo:up
```

访问 React：`http://127.0.0.1:8080`；Vue：`http://127.0.0.1:8081`。详情与安全边界见 [Docker 演示说明](deploy/docker/README.md)，部署决策见 [ADR-0007](docs/adr/0007-docker-demo-deployment.md)。维护者已确认原 V0.1 Docker 演示运行成功；本轮环境变量及 Nginx 动态端口改造尚待重新构建验收。

## 统一环境变量（唯一根目录 .env）

React、Vue、NestJS、SSE 模拟器以及 Docker Compose 均从仓库根目录唯一 `.env` 取得可配置端口；不创建 `.env` 也保留默认值。先检查现有文件，缺失时再从 `.env.example` 复制：

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
pnpm run env:check
```

根模板包含开发端口 `SCADA_REACT_DEV_PORT=5173` / `SCADA_VUE_DEV_PORT=5174`、后端 `SCADA_SERVER_PORT=3001`、模拟数据 `SCADA_DEMO_PORT=4178`，以及 Docker Web 宿主机端口 `SCADA_REACT_PORT=8080` / `SCADA_VUE_PORT=8081`。旧的分散 `.env.example` 已移除；之前复制过的子目录 `.env` 不会被自动删除，但**不再读取**，请检查并手动迁移需要的值。

仓库统一 LF：`.editorconfig` + `@adui/tooling/format` + `.gitattributes`；Windows 不再依赖用户全局 `core.autocrlf` 选择。具体使用和安全限制见 [环境配置规范](docs/ENVIRONMENT.md)、[ADR-0010](docs/adr/0010-root-env-lf.md)。真实 `.env` 不入库，不包含设备凭据。

## V0.2 组态编辑器首批功能（开发分支）

Vue / React 现在都可通过页面顶部「组态编辑」打开懒加载 Studio，查看同一份水处理工程，选择并拖动画布图元、方向微调、修改 Label 文案、撤销/重做及本地 JSON 导入/导出。编辑内核通过 `@adui/scada-core/editor` 共享；原 `Runtime` 保持独立懒加载，Tag/SSE/工业安全边界不变。

**当前仅浏览器会话内编辑**：不自动持久化、无服务端工程 CRUD、无发布、无实时设备控制。手动导出的 JSON 是草稿文件，不是正式发布工程。使用方式与首批验收见 [V0.2 Studio 说明](docs/V0.2_STUDIO.md)。

## V0.2 SVG 编辑器第二批操作（开发分支）

在现有 Studio 上扩展：画布 `50%–200%` 缩放、添加 `tank/pump/pipe/label` 图元、删除、`Shift` 多选及整体拖动、上移/下移层与置顶/置底、按最后选中的图元进行六方向对齐。全部文档修改经共享 `@adui/scada-core/editor` 校验并支持撤销/重做；React/Vue 使用同一工程 JSON。

当前仍为**内存草稿**，离开 Studio 前须导出本地 JSON。视图缩放与选择状态不写入工程文件；新增图元没有绑定任何真实设备。详情与未完成项见 [V0.2 Studio 文档](docs/V0.2_STUDIO.md)。

### V0.2 画布框选与键盘操作（开发中）

拖动**空白画布**可框选与选择框相交的图元，支持反向拖动；Shift+拖框可追加选择。编辑器可用 Ctrl/Cmd+A 全选、Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 或 Ctrl+Y 重做、Delete 删除、方向键微移（Shift+方向键 10 单位）、Esc 清除选择。输入框获得焦点时这些操作不会拦截正常输入。

框选结果和缩放均为临时 UI 状态，不写入工程 JSON。详见 [Studio 使用文档](docs/V0.2_STUDIO.md)。

## 自有提示与日志的中文规范

项目自研的界面提示、异常、测试名称、日志、注释和 JSDoc 统一使用简体中文；JSON、Tag ID、协议枚举和 API 路径保留技术原值，前端使用共享中文状态显示名称。新增 `pnpm run messages:check` 并纳入 `ready`，具体约定和例外见 [中文文案规范](docs/LOCALIZATION.md)。

## V0.2 画布网格与吸附（开发分支）

Studio 新增 **20 单位网格**和三个独立开关：「显示网格」「网格吸附」「图元吸附」。拖动图元时可吸附到网格，或吸附到其他图元的左/中/右、上/中/下参考线；对齐到其他图元时显示辅助线。Vue / React 使用相同的 `resolveDragSnap`，拖动预览与松开提交结果一致。只有真实图元位移写入工程与撤销历史；网格显示、吸附开关、辅助线本身不进入 JSON。

详细设计及验收见 [Studio 使用说明](docs/V0.2_STUDIO.md) 与 [ADR-0012](docs/adr/0012-grid-snap-guides.md)。本阶段仍只支持本地模拟草稿，不能直接连接工业设备。

## V0.3 第二十二批：共享只读 Tag 数据源适配层（Windows / Docker 自动化验收通过）

Runtime 新增框架无关的 `ReadonlyTagSource` 契约与 `createSseTagSource()`：默认沿用原本 `/demo/project` + `/demo/events`；可显式构造 `createSseTagSource("nest-local")` 以描述第 21 批 Nest 开发接口的固定同源路径，但**不会修改 Vite 代理、绕过 Nest 本机安全开关或自动切换现有 Vue/React 页面**。`DemoRuntime` 单参数用法继续兼容，新增可选的只读数据源注入参数，并在停止/重连时严格管理取消订阅、AbortSignal、STALE 状态与快照优先级。Tauri 离线演示、工业设备接口和正式业务 API 均不变。

此模块尚不是具有生产鉴权、Gateway 连接、发布版本加载或背压控制的完整实时订阅系统。技术决策与验收参见 [ADR-0054](docs/adr/0054-readonly-tag-source-adapters.md)。维护者 Windows 已实测 **Runtime 专项 21/21、单测 400/400、NestJS E2E 17/17**，`vp check` 零警告/错误，完整 `pnpm run ready` **退出码 0**；Docker 隔离烟测与 Linux SIGTERM 退出码均正常，Docker **退出码 0**。人工页面断连演练、真实工业网关与生产认证尚未验证。本次记录性文档更新后建议执行 `vp check` 与 `pnpm run docs:check`。

## V0.3 第二十三批：模拟 SSE 心跳与数据超时（Windows / Docker 自动化验收通过）

原水处理独立模拟 SSE 与 NestJS **仅本机非生产显式开启**的模拟 SSE 现在通过具名 `heartbeat` 每 5 秒保活通道，浏览器只读适配器连续 15 秒无任何 SSE 事件后会重建同源连接。Vue/React 共用 Runtime 独立以 12 秒无有效 Tag 更新识别数据静默，并通过 `stale` /「Tag 数据已过期」降级旧读数；心跳不会将旧值恢复为 GOOD。水处理原本每 30 秒停止采样 8 秒的 STALE 演练仍保持，桌面离线模式、Vue/React 默认 `/demo`、生产 API 与工业只读边界不变。详见 [ADR-0055](docs/adr/0055-sse-heartbeat-and-tag-silence.md)。

本批新增 9 项单测，维护者 Windows 实测 **Runtime 专项 29/29、Server 专项 79/79、全量单测 409/409、NestJS E2E 17/17**；`vp check` 零警告/错误、251 个文件格式正确，71 份 Markdown 检查、Vue/React/NestJS 构建全部通过，完整 `pnpm run ready` **退出码 0**。Docker 冻结安装、隔离 HTTP 烟测与 Linux SIGTERM 正常退出，**Docker 退出码 0**。5/12/15 秒阈值均为开发演示预设，不是生产工业协议 SLA；尚无人工浏览器断流演练、真实 PLC、网关认证、背压或多客户端并发验收。验收文档更新后建议复查 `vp check` 与 `pnpm run docs:check`。

## V0.3 · SSE 浏览器回归（第二十四批）

在项目根目录的三个终端分别执行 `pnpm run dev:demo`、`pnpm run dev:react` 和 `pnpm run dev:vue`，第四个终端运行 `pnpm run test:sse:browser`。该命令需要本机 Chrome/Edge，可通过 `SCADA_BROWSER_PATH` 指定浏览器路径。它同时检查 Vue/React Runtime 的 Tag 静默降级、具名心跳保活、15 秒全事件静默重建及切换 Studio 后的资源回收。只允许本机回环地址，不接入工业设备。用例提交不代表浏览器及生产环境验收通过，详见 [ADR-0056](docs/adr/0056-sse-browser-visibility-recovery.md)。

## V0.3 · 第二十五批本机 SSE 多客户端验证

独立水处理模拟 SSE 现在仅允许最多 32 个同时在线订阅，并对每客户端待发送缓冲限定为 64 KiB；慢连接遇到背压时主动关闭以保护其他连接。这些数字仅为本地模拟防护边界，不是工业现场容量指标。

在项目根目录运行 `pnpm run test:sse:clients`，使用 Node 内置测试器验证资源限制；另一个终端先启动 `pnpm run dev:demo`，再执行 `pnpm run test:sse:network` 验证实际 6 路 SSE 订阅。需要测试本机 Docker Nginx 两套 Web 代理时，先运行 `pnpm run docker:demo:up`，再执行 `pnpm run test:sse:proxy`。脚本从根 `.env` 读取端口，始终只连接 127.0.0.1，不会自动改动容器。详见 [ADR-0057](docs/adr/0057-local-sse-capacity-and-proxy-validation.md)。

### 第二十五批：Docker 演示端口一致性修复

根目录 `.env` 统一配置 Docker 对宿主机发布的端口（默认 React `18080`、Vue `18081`）。`docker:demo:up/down/logs` 现显式使用 `--env-file .env`，并提供 `pnpm run docker:demo:ps` 查看真实容器映射。执行 `pnpm run docker:demo:up` 后建议先核对映射，再运行 `pnpm run test:sse:proxy`；若仍不一致，还需排查同名 PowerShell 进程环境变量。真实 Nginx SSE 代理验收仍需在维护者 Windows/Docker 实测确认。
