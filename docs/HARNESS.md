# ADui SCADA · Harness

V0.1 使用 Vite+ 1.5.0、pnpm workspace Catalog、TypeScript 6.0.3、Vite+ 内置 Vitest。编辑规范来自根 `.editorconfig`，`@adui/tooling` 导出 Format / Lint 供根 Vite+ 使用；应用 TypeScript 统一引用 `@adui/tsconfig/*`。
命令必须在项目根目录执行，版本以 `pnpm-workspace.yaml` 和实际锁文件为准。

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
pnpm run ready
```

测试至少覆盖：Document 结构校验、恶意 JSON、SVG 安全转义、Tag 乱序和失联质量、Runtime 快照及增量。
浏览器双框架联动及真实设备协议测试**未执行**。

`pnpm run ready` = Catalog + 共享配置检查 → Vite+ 检查 → 双 Web + NestJS 类型检查 → Vitest 单测 → NestJS E2E → 文档检查 → Web + NestJS 构建。Rust/Tauri 构建单独验证。

## 配置验证

- `pnpm run config:check`：检查共享 TSConfig 导出与引用、根 .editorconfig、Root Format/Lint 入口和子配置无重复声明。
- `pnpm run deps:check`：检查每个 Workspace Manifest 只使用 Catalog 或 workspace 依赖。
- `vp check`：从仓库根运行；Vite+ Monorepo Format / Lint 以根配置和 overrides 为准，不能依赖子目录覆盖。

## 运行验证

```powershell
pnpm run dev:demo
pnpm run dev:react
pnpm run dev:vue
pnpm run dev:server
# Windows Tauri（需 Rust + WebView2 等）
pnpm run desktop:dev:react
pnpm run desktop:dev:vue
pnpm run desktop:build:react
pnpm run desktop:build:vue
```

运行端必须从发布快照/只读订阅消费标准数据；当前 SSE 仅为本机诊断接口，不代表正式 WebSocket/API 协议。

**验证状态（2026-11-09）**：维护者已在 Windows 运行通过 `pnpm run ready`（含 Vite+ 检查、TS6、18 个单测、2 个 NestJS E2E、文档检查与 React/Vue/NestJS 构建）。React/Vue 桌面开发运行已由维护者确认；两套 MSI 单独打包命令也均已成功。维护者已完成 Vue/React MSI 安装启动及模拟画面显示验收；卸载/更新、自动恢复全过程和工业现场测试仍未完成。

## 2026-11-09 · 工具链初次集成反馈

Windows / pnpm 12.18 / TypeScript 6.0.3 实测 `pnpm install`、`deps:check`、`config:check` 成功。
首轮 `vp check` 因格式差异被阻断；`vp check --fix` 报告 Runtime TS1294、React CSS TS2882、Vue SFC TS2307、Node assert TS2591、Vitest expect-expect。
本次针对性修复：

- Format/Lint 忽略 `.agents/skills/**` 的外部 Skill 文档，避免自动重写供应方资料；
- Runtime 构造函数取消 TS6 `erasableSyntaxOnly` 禁用的参数属性简写；
- 给 React CSS 和 Vue SFC 提供入口声明；
- Core/Runtime 单测统一使用 Vitest `expect`，NestJS E2E 使用显式断言。

注意：本次修复提交后仍需重新执行 `vp check`、`pnpm run ready`，不得把源码修复视为实际测试通过。此前在本机执行 `vp check --fix` 可能格式化了大量文件；合并前应先检查 `git status`，避免覆盖未提交的本地格式修改。

## 2026-11-09 · Windows Tauri Release 打包记录

开发者在 Windows 运行 `pnpm run desktop:build:react`：React Web 构建、Rust release 构建成功，Tauri/WiX 输出 MSI 文件 `apps/desktop/src-tauri/target/release/bundle/msi/ADui SCADA_0.1.0_x64_en-US.msi`。随后的 NSIS 打包下载 `nsis_tauri_utils.dll` 时返回 HTTP 504，因此原命令整体失败；不能把该次结果标记为全部通过。

针对外部下载故障新增 `pnpm run desktop:build:react:msi` 与 `pnpm run desktop:build:vue:msi`，单独执行 `tauri build --bundles msi`，保留原全量打包入口。两套 MSI 专用命令随后已由维护者在 Windows 实际执行成功；MSI 安装后的实际运行、生产数据接入仍尚未验收。

## 2026-11-09 · React / Vue MSI 独立打包验收

以下为维护者提供的真实 Windows PowerShell 构建日志结果，不代表当前协作环境重新运行了 Rust 工具链：

| 构建入口                           | Web 构建 | Rust release | Windows MSI | 文件大小 |
| ---------------------------------- | -------- | ------------ | ----------- | -------- |
| `pnpm run desktop:build:react:msi` | 通过     | 通过         | 通过        | 1.92 MiB |
| `pnpm run desktop:build:vue:msi`   | 通过     | 通过         | 通过        | 1.88 MiB |

两次构建都显示 `Finished 1 bundle`，产物文件名都是 `apps/desktop/src-tauri/target/release/bundle/msi/ADui SCADA_0.1.0_x64_en-US.msi`。共用产品 ID、版本号及输出目录，**后执行的 Vue 构建可能覆盖先前生成的 React MSI**；若要同时保存两种版本，应在构建 Vue 前备份/重命名 React MSI。上述成功不意味着 NSIS 全格式打包故障已解决，也不能证明 MSI 安装、首次启动、自动升级或离线运行成功。

下一步验收：在干净的 Windows 环境安装 MSI、检查桌面窗口与 WebView2、确认数据源不可用时提示准确且不会展示伪实时 GOOD 值。V0.1 仅有本地模拟 SSE，安装包**未包含**正式独立后台服务。生产设备通信、鉴权及安全认证仍属于后续工作。

## 2026-11-09 · MSI 安装后的 HTML/JSON 数据源问题与回归测试

维护者已安装并启动 Vue MSI。页面显示 `Unexpected token '<'`，工程未加载；根因是发布版没有 Vite `/demo` 代理，`fetch('/demo/project')` 取得 HTML 而非 JSON。该情况表明安装启动成功、**运行时数据源验收失败**，不代表已完成桌面端验收。

修复思路：

- V0.1 React/Vue Tauri 的 `beforeBuildCommand` 使用 `vp build --mode desktop`；Web 开发模式仍走 SSE；
- 共享 `OfflineDemoRuntime` 在桌面模式直接读取共享 Demo Document，按秒输出模拟 Tag，并演练中断与 `STALE`；页面明显标注 `SIMULATION`，绝不冒充生产设备实时值；
- SSE 模式校验响应 `Content-Type: application/json`，避免将 HTML 错误内容直接交给 `response.json()`；
- Vitest 增加离线模拟、定时器清理、STALE 演练、HTML 错误响应回归用例。

验证方法（维护者 Windows）：

```powershell
pnpm run ready
pnpm run desktop:build:react:msi
# 备份 React MSI 产物
pnpm run desktop:build:vue:msi
```

分别安装两套 MSI，**无需启动 `dev:demo`**；确认进入 `SIMULATION`、加载相同水处理 SVG、三个 Tag 变化、模拟断线后 `STALE`、恢复 `GOOD`，并验证退出程序后定时器清理。原 `pnpm run ready` 通过记录属于修复前的版本，**修复后的打包与安装尚待实测**。

## 2026-11-09 · Windows MSI 安装运行实测（用户截图）

- **Vue MSI：安装及窗口启动通过**，离线 `SIMULATION` 标识、水处理 SVG、水位、泵状态与流量正常显示；之前的 HTML/JSON 解析错误未再出现。截图显示水位 70.8%、流量 17.7 m³/h、质量 `GOOD`（仅本地模拟值）。
- **React MSI：维护者确认安装及窗口启动通过**。截图显示相同水处理组态进入模拟数据中断阶段，页面明确提示 `STALE`，水位、泵、流量不再显示旧值为正常实时值；顶部仍显示 `SIMULATION`。
- 以上为两个框架安装版的**实际人工运行验收证据**；两张截图对应不同模拟时刻，尚不足以单独证明 React 的 `STALE → GOOD` 恢复全过程或两端严格逐帧对等。
- 仍待验证：长时间运行及恢复循环、Windows 安装卸载/升级、干净环境复现、正式工业数据源与安全边界。上述示例均非真实 PLC/DCS 数据。

结论：V0.1 React/Vue Windows MSI 的**安装启动、离线模拟展示与 React STALE 显示**已通过本轮人工验收；不是正式 SCADA 生产发布验收。

## 2026-11-09 · 模拟质量自动恢复验收完成

维护者在 Windows 桌面安装版上继续运行离线水处理模拟，确认演练断线后的 **`STALE → GOOD` 自动恢复全过程通过**。此前截图确认 `STALE` 期间水位、泵状态和流量均不以正常读数展示；本次后续人工验收确认其可自动恢复到 `GOOD`。

**V0.1 双框架桌面模拟验收小结**：React / Vue MSI 构建、安装启动、SVG 与模拟数据展示、`SIMULATION` 明确标识、`STALE` 标记及自动恢复均有维护者的实测反馈。证据来源分别是构建日志、运行截图与维护者后续确认；未把这次确认视为持续运行压力测试或自动化 E2E。

仍待验证：全新 Windows 环境、MSI 卸载/升级、更多断连边界、NSIS 全目标打包、生产工业网关及安全性。V0.1 是模拟只读原型，不构成可投产 SCADA 的验收。

## V0.1 Docker 演示验收（待 Windows/Docker Desktop 执行）

已新增 `deploy/docker/compose.demo.yaml`、React/Vue 共享 Dockerfile、NestJS Dockerfile、模拟器 Dockerfile 与 Nginx 代理。质量验收步骤：

```powershell
docker compose -f deploy/docker/compose.demo.yaml config
docker compose -f deploy/docker/compose.demo.yaml up --build -d
docker compose -f deploy/docker/compose.demo.yaml ps
Invoke-RestMethod http://127.0.0.1:8080/api/health
Invoke-RestMethod http://127.0.0.1:8080/demo/project
curl.exe -N http://127.0.0.1:8080/demo/events
```

随后分别打开 `http://127.0.0.1:8080`（React）、`http://127.0.0.1:8081`（Vue），验证两端画面、数据质量和模拟 `STALE → GOOD`。结束运行使用 `pnpm run docker:demo:down`。

**本轮未执行 Docker CLI/config/build/run**：当前协作环境无 Docker；不能据此声称容器部署已通过。V0.1 模拟 HTTP/SSE 未鉴权，仅限 loopback 测试，不构成工业现场验收。

## 环境变量配置校验（待本机运行）

新增 `pnpm run env:check`，校验根、React、Vue、NestJS、SSE 的五份环境模板、配置读取位置、默认值、Git 忽略和 Docker 端口限制；并将它纳入 `pnpm run ready`。

```powershell
pnpm run env:check
pnpm run ready
docker compose -f deploy/docker/compose.demo.yaml config
```

从 `.env.example` 复制本地 `.env` 后验证：React/Vue 端口覆盖有效；NestJS `PORT`、模拟器 `DEMO_PORT` 生效；无效端口明确失败；Docker React/Vue 宿主机端口可变，但仍只绑定 `127.0.0.1`；Tauri MSI `desktop` 模式继续显式离线模拟。

**本轮尚未在完整 Node24/Vite+/Docker 环境执行新增脚本及构建检查**。静态模板检查不能替代集成运行和安全评审。

## V0.2 第一阶段 SVG Studio（待维护者验证）

新增 `packages/core/test/editor.test.ts`，在 `pnpm run test:unit` 中覆盖选中移动、边界截断、无操作不入历史、撤销重做、文本安全、无效导入原子性和 JSON 文档往返。

```powershell
pnpm run ready
pnpm run dev:react
pnpm run dev:vue
```

从 React 与 Vue 首页顶部选择「组态编辑」，分别验证：

- 选中水箱后拖动到新位置、方向微调，执行撤销/重做；
- 修改 Label 文案，撤销可恢复；输入类似 `<script>` 的文本必须被 SVG 转义，不得执行；
- React 导出 JSON → Vue 导入 → 再导出 → React 导入，Schema、节点、Tag 绑定不丢失，反向也应一致；
- 导入错误 JSON 时保留当前工程；Runtime 仍可访问模拟 SSE，切换页面不会发送 PLC/DCS 请求；
- Windows Tauri MSI / Docker 两套 Web 的 Studio 可打开，不因此声称生产可用。

**该 V0.2 代码的 TS6、Vite+、Vitest、双 Web 构建和手动交互尚待 Windows 本机执行，未宣称通过。**

## 2026-11-09 · Studio JSON 跨框架往返人工验收

维护者已在 Windows 上实际执行 **React 导出工程 JSON → Vue 导入 → Vue 再导出 → React 再导入**，确认图元和 Tag 绑定保持一致。这是用户完成的人工交互验证，不是自动化 E2E；相反方向 Vue → React → Vue、异常 JSON 和其他编辑操作仍需单独复验。

## 2026-11-09 · 唯一根 .env / LF 规范待回归

针对 Windows `vp check --fix` 将许多 CRLF 转为 LF 的问题，新增 `.gitattributes` 强制 Git 检出 LF，并与 Oxfmt / EditorConfig 保持一致（Windows `.bat/.cmd` 例外）。只保留根 `.env.example`；Vue/React/NestJS/SSE/Docker 读同一根 `.env`，Nginx 容器采用启动时模板以匹配内部端口。

```powershell
git status --short
pnpm run env:check
pnpm run ready
docker compose -f deploy/docker/compose.demo.yaml config
pnpm run docker:demo:up
docker compose -f deploy/docker/compose.demo.yaml ps
Invoke-RestMethod http://127.0.0.1:8080/api/health
Invoke-RestMethod http://127.0.0.1:8080/demo/project
```

还应测试更改 `SCADA_DEMO_PORT` 和 `SCADA_SERVER_PORT` 后，容器健康探针、Nginx 代理与 SSE 可同步工作。现阶段 GitHub 仅提供代码和静态结构验证，**尚未在维护者 Windows 上执行本轮完整 `ready` / Docker 重新构建 / 换行符迁移**；已通过的 V0.1 Docker 运行不代表新的端口模板已验证。

## 2026-11-09 · V0.2 第二批画布操作待验收

本轮 Core 增加对以下行为的单元覆盖：新图元全局 ID 唯一且没有 Tag 绑定、多选切换/整体移动/画布截断、非法节点/非有限坐标拦截、六方向对齐、图层排序及撤销、批量删除与 JSON 往返。

```powershell
pnpm run ready
pnpm run dev:react
pnpm run dev:vue
```

React 和 Vue 各自打开 Studio 后检验缩放 50/100/200%；创建水箱/水泵/文本、撤销重做、删除；Shift 点击多选并拖动，在靠近画布边界时保持相对布局；选两个不同尺寸的图元执行水平/垂直对齐；层级置顶/置底并通过 JSON 验证节点顺序。新图元不自动关联任何 Tag；跨框架往返不丢失已有绑定。

**截至提交时未在此协作环境执行完整 pnpm/Vite+/TS6/Vitest/浏览器或 Docker 回归。** 不继承之前单选版本的验收结果为本轮已通过。

## 2026-11-09 · V0.2 框选和键盘交互待验证

新增 5 个单元用例，`packages/core/test/editor.test.ts` 累计 **22 个用例**（未实际运行）。须在 Windows 运行：

```powershell
pnpm run ready
pnpm run dev:react
pnpm run dev:vue
```

React/Vue 都需测试：从正向/反向拖动空白区域框选；Shift 框选追加、单击空白取消；框选后整体移动与撤销；缩放到 50%/200% 后框选坐标准确。Ctrl+A 全选、方向键 ±1、Shift+方向键 ±10、Ctrl+Z 撤销、Ctrl+Shift+Z/Ctrl+Y 重做、Delete 删除、Esc 清选。**在 Label 输入框聚焦时快捷键不得触发图元编辑命令**。还需跨框架 JSON 往返与 Runtime STALE/GOOD 回归。

GitHub 结构检查不等于 Vite+、TS6、Vitest、双框架浏览器与 Docker 实测通过。

## 2026-11-10 · Windows `ready` 反馈：NestJS 单测超时修复待复验

维护者在 Windows 执行 `pnpm run ready`：Catalog/共享配置/根 .env 与 LF、Vite+ 119 文件格式检查、46 文件 Lint/类型、双 Web/NestJS TypeScript 检查均通过；Core/Runtime/Editor 单测通过 **41 项**（编辑器 22 项）。`apps/server/src/app.controller.spec.ts` 的 1 个测试在 5 秒默认时限内未完成（`Test timed out in 5000ms`），导致 **42 项中 41 项通过、`ready` 失败**，之后的 Nest E2E、文档检查与构建**没有执行**。

针对性处理：Controller 单测只验证 `getHealth()` 的业务返回值，直接实例化 `new AppController(new AppService())`，不再为简单同步调用在单个测试内执行 `Test.createTestingModule().compile()` 和 `close()`。原有 `apps/server/test/app.e2e-spec.ts` 不变，负责验证 Nest 依赖注入、HTTP `GET /health` 和工业写入路由 404。没有提高全局测试超时或改动产品 API。

请维护者在 Windows 同步补丁后运行：

```powershell
pnpm run test:unit
pnpm run test:e2e:server
pnpm run ready
```

**本轮补丁尚未在 Windows/Vite+/Vitest 下实测；原始超时原因按测试初始化开销判断，待复验确认**。若仍超时，需结合系统并行负载、Vitest worker 数量和具体测试启动耗时进一步分析。
