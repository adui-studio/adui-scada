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
