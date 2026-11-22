# ADui SCADA · Harness

> **AI 编码前必读门禁**：每次修改任何代码前，先阅读根目录 [AGENTS.md](../AGENTS.md) 与 [AI 编码错误复盘清单](AI_MISTAKES.md) 全文，再检查目标代码、适用 Skills 与测试。发现重复错误应先对照错误编号排查，复验后再将新案例写入清单；命令未实际执行不能登记为通过。

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

## 2026-11-10 · 自有提示统一中文及静态检查（待复验）

应维护者要求，仓库自有的 `throw`、CLI 检查脚本、模拟服务日志、测试名称、注释/JSDoc、Rust 诊断信息、Vite/Docker 配置注释，以及 Vue/React 的 Runtime 可视状态全部统一为简体中文。**协议标识不变**：JSON 字段、Tag ID、`GOOD/UNCERTAIN/BAD/STALE` 枚举、内部 Runtime 状态、路径、命令和依赖版本均保持原样；通过 `TAG_QUALITY_LABELS` 和 `RUNTIME_STATUS_LABELS` 提供中文显示。

新增 `scripts/check-chinese-messages.mjs`、`pnpm run messages:check` 并接入 `pnpm run ready`，检查自有文件的测试名称、异常文本、日志与注释，排除第三方 Skills 与生成产物；此脚本是静态启发式检查，不替代人工 UI 文案审查。部分原有测试根据中文异常断言同步调整，默认演示画面中的中文标题及 SVG 质量显示需人工回归。

```powershell
pnpm run messages:check
pnpm run test:unit
pnpm run test:e2e:server
pnpm run ready
```

**执行状态**：本次中文化补丁尚未在维护者 Windows 上执行 Vite+、Vitest、Vue/React 实际 UI、Docker 和 Tauri 回归。此前 `pnpm run ready` 的 NestJS Controller 单测超时已另作简化修复，但尚无完整复验结果。不能将静态源码审查标记为测试通过。

## 2026-11-10 · V0.2 画布网格与吸附（待验收）

新增 `packages/core/test/snap.test.ts`，覆盖网格吸附与关闭、单轴移动不误触另一轴、其他图元边缘参考线、多选组整体移动、不会对组内图元吸附、旋转外接框、画布边界、非法输入及不可变 JSON。

```powershell
pnpm run messages:check
pnpm run test:core
pnpm run ready
pnpm run dev:react
pnpm run dev:vue
```

两端 Studio 均应分别确认：默认显示 20 单位网格、显示网格独立开关、网格吸附与图元吸附可独立切换；拖动水箱靠近管道左边沿时出现垂直参考线；拖动时不发生未经指针移动的另一轴跳动；吸附后撤销重做和单独移动一致；多选整体拖动保持相对位置；缩放 50%、100%、200% 时光标、网格和落点一致。

导出 React 工程 JSON → Vue 导入，再从 Vue 导出 → React 导入，并反向验证图元位置及 Tag 绑定保持原值。切回 Runtime 验证模拟质量 `GOOD/STALE` 显示没有回归。当前仅为源代码开发成果，**Vite+、TS6、Vitest、Web 构建、浏览器与桌面回归尚未在本轮实际执行**。

## 2026-11-10 · V0.2 网格吸附首次 Windows `ready` 失败及修复

维护者运行 `pnpm run ready`：依赖目录、共享配置、根环境变量、LF 及中文文案检查通过，随后在 `vp check` 的格式化阶段停止。React `StudioPage.tsx` 第 504 行之前的网格条件渲染遗漏 JSX 结束符 `}`，引发解析失败；同时工具报告 Vue `StudioPage.vue` 和 Core `snap.test.ts` 存在格式差异。因格式化先失败，**没有执行后续 Lint、类型检查、测试、E2E、文档检查及构建**。

已在 PR #6 原分支上最小修复 React JSX 语法、整理 React 三组网格开关属性格式及 Vue/单测的格式差异。此为源码修改，尚未在维护者的 Vite+ 环境实测；请重新运行 `pnpm run ready`，并在格式检查通过后按上节验收 React/Vue 交互。

## 2026-11-10 · V0.2 小数边界单元测试反馈与修复

维护者再次运行 `pnpm run ready`：中文文案、格式化（124 文件）、Lint/静态检查（49 文件）、Vue/React 与服务端类型检查均通过；执行 57 个单测时 55 通过、2 失败。失败均位于 `packages/core/test/snap.test.ts`，即吸附函数给出 0.3/-0.2 的精确边界位移，但 `withNodesTranslated` 在提交时重新取整至 0，导致最终图元坐标未到达边界。

修复共享 Core：若传入位移恰为可行区间的精确端点，则保留小数；其他移动仍取整并限制边界。新增左右边界移动、撤销及普通小数取整回归测试。未触及 React/Vue UI、Schema 或工业设备通信。本轮运行在单测阶段结束，**NestJS E2E、文档检查与 Web/Server 构建没有执行**；修复后请重新运行 `pnpm run ready`，运行结果待维护者反馈。

## 2026-11-10 · V0.2 小数边界修复后的 Windows 质量检查反馈

维护者在分支上执行 `pnpm run ready` 并提供终端日志，确认以下阶段通过：依赖 Catalog（9 份清单、26 项依赖）、共享配置、根目录环境/LF、中文文案（70 个文件）、`vp check` 格式化（124 个文件）与 Lint/静态检查（49 个文件）、React/Vue/NestJS TypeScript 类型检查、`vp test run`（**59/59**）、NestJS E2E（**2/2**）、Markdown 文档检查（27 个文件）及 React/Vue 双版本 Web 构建。

日志末尾显示已执行 `pnpm --filter @adui/scada-server run build` 并进入 `nest build`，**未提供最终退出码或命令返回提示，因此服务端构建的最终退出状态尚待确认**。本次只证明以上工具链检查和测试，**尚未完成 Vue/React 浏览器画布交互、双向 JSON 互通及 Runtime/Docker/Tauri 回归**。PR #6 保持 Draft，待交互验收后再评估是否合并。

## 2026-11-10 · V0.2 双框架画布交互验收确认

维护者回复「验收完成」，确认已完成上一轮列出的七项 Vue/React Studio 人工交互检查：默认 20 单位网格及三组开关、图元吸附辅助线与预览/提交一致、多选整体拖动、50%/200% 缩放拖动、边界及撤销重做、React → Vue → React 的本地 JSON 往返与 Tag 绑定、Runtime 模拟数据显示。此为**维护者人工验收声明**，并非当前 Agent 在浏览器重复执行的自动化测试结果。

与此前维护者 Windows 日志结合：59/59 单元测试、2/2 NestJS E2E、中文文案、124 文件格式检查、49 文件 Lint/静态检查、Web/Server 类型检查、27 份文档检查、React/Vue 双 Web 构建已通过。此前日志末尾只显示启动 `nest build`，**未包含退出状态，服务端构建完成状态未独立确认**；Docker/Tauri/工业现场验收亦不在本次完成声明范围内。

PR #6 的**本批双框架交互验收已完成**，仍维持 Draft 以待维护者明确决定何时发起正式合并流程；未经授权不合并 `main`。

## 2026-11-10 · V0.2 第五批图元几何属性开发分支（待验收）

新增 `packages/core/test/editor.test.ts` 6 项回归用例，现有已由维护者确认的 59 项基础单测加上本批新增测试共计**预计 65 项**。功能覆盖图元 X/Y/宽高/旋转单次原子修改、撤销/重做、无变化不入历史、非法输入防护、边界拒绝和多选保护。以上仅为源码用例数量，**本批尚未实际运行新测试**。

维护者 Windows 验证命令：

```powershell
git fetch origin
git switch feat/v0.2-node-transform-properties
pnpm run ready
pnpm run dev:react
pnpm run dev:vue
```

React 与 Vue 均需逐项核验：单选编辑五项几何参数；非法/空白输入中文报错；越界修改不污染 JSON；一次应用可一次撤销/重做；多选不误改；React→Vue→React 与 Vue→React→Vue 的 JSON 往返后位置、尺寸、旋转及 Tag 绑定不变；旧吸附/框选/运行时能力无回归。

**当前只完成 GitHub 源码和静态检查，未实际执行本批 `pnpm run ready`、浏览器交互、Docker/Tauri 或工业现场测试**。历史 PR #6 的 59 项单测与 2 项 E2E 通过结论不得替代本分支重新执行测试。

## 2026-11-10 · 第五批测试执行反馈（结果待补充）

维护者在本轮对话中反馈「测试完成」。该反馈**确认已执行测试工作**，但没有附本批 `pnpm run ready` 的命令输出、退出状态、用例统计或 Vue/React 交互测试结论，因此暂不将预计 65 项单测、2 项 E2E、Web/Server 构建或六项交互清单标记为“通过”。

本 PR 已经提交图元几何属性编辑源码与 6 项新用例；在取得测试是否通过的明确反馈前，维持 Draft。之前 PR #6 的测试结果不能充当 PR #7 的实测证据。相关结果确认后补充本节，再评估合并准备状态。

## 2026-11-10 · 第五批维护者确认全部通过

维护者继「测试完成」之后，进一步明确回复「全部通过」，确认本批 `feat/v0.2-node-transform-properties` 上的 **`pnpm run ready` 完整质量链和 Vue/React 交互测试均已通过、无报错**。按本批六项验收清单，涵盖两端单选几何属性提交、原子撤销/重做、非法/越界输入、原有多选和吸附交互回归、双方向 JSON/Tag 往返、只读 Runtime 模拟展示。验收来源为**维护者本机确认**，并非本 Agent 复现执行。

此轮没有收到逐项终端日志、用例总数或独立构建输出，故不能仅根据此前预计数量写成“65/65 项已逐项核验”；完整 `ready` 通过由维护者明确确认。验收之后追加了这段文档，**文档补充本身尚未重新执行 `docs:check`**。Docker、Tauri、真实 PLC/DCS、工业网关、发布安全及生产运行不包含在本次验收中。PR #7 保持 Draft，等待维护者合并授权，依赖未合并的 PR #6。

## 2026-11-10 · V0.2 第六批 SVG 控制手柄（待验证）

新增 `packages/core/test/transform-gesture.test.ts` 共 **12 项**测试，涵盖四角缩放锚点、90° 旋转缩放、零位移保持、非法尺寸、旋转角、Shift 15° 吸附、跨 ±180° 角度、原子提交和撤销重做、越界拒绝。以维护者前次确认的第五批 65 项为参考，本分支单测预计 **77 项**；**本次没有实际运行**，不能宣称通过。

维护者 Windows 验收：

```powershell
git fetch origin
git switch feat/v0.2-transform-handles
pnpm run ready
pnpm run dev:react
pnpm run dev:vue
```

人工验收应分别在 Vue/React 完成：单选图元显示四角方形缩放手柄和顶部圆形旋转点；四角拖动改变位置与大小、对角锚点固定；旋转后的图元仍能按局部轴缩放；Shift 拖动旋转点以 15 度吸附；超出画布、尺寸不足 0.1 时不覆盖已合法的预览；松开一次仅产生一条撤销历史；Esc 取消；多选不显示单图元手柄；原有网格吸附、属性数值编辑、双向 JSON/Tag 互通和只读 Runtime 无回归。

**测试来源区分**：本批完成 GitHub 源码提交及静态审查，未在维护者 Windows 环境真实执行格式/Lint/TS/单元/E2E、Web/Server 构建或交互测试；PR 先保持 Draft。

## 2026-11-10 · 第六批维护者验收与旋转光标修改

维护者回复「验收通过」，确认第六批 SVG 缩放/旋转功能已通过本机质量检查与 Vue/React 人工验收。该结论来自**维护者测试反馈**，未附原始测试统计，不把源码预计 77 项写成独立执行统计。

针对随后提出的旋转鼠标样式需求，本轮将 `crosshair` 改为共享资源 `assets/cursors/rotate.svg` 的环形旋转箭头，且在旋转 Pointer 捕获期间维持该指针。PointerUp、Esc 和 PointerCancel 清除旋转状态；不支持 SVG 光标时回退 `grab`。

**变更后仍需验证**：本批验收结论针对改光标之前的功能；修改后的 `pnpm run ready`、两端鼠标悬停/拖动/取消与共享 SVG 资源打包尚未重新实际执行。未涉及工业现场安全、Docker/Tauri 或设备写入。

## 2026-11-10 · 旋转光标修改后的 Windows ready 复验

维护者提供 `vp check --fix` 和 `pnpm run ready` 的 Windows PowerShell 日志。修复后再次运行的 `ready` 已明确通过：依赖 Catalog（9 个清单，26 项）、共享配置、根目录环境/LF、中文文案（72 个文件）、格式化（128 个文件）、Lint/静态检查（51 个文件）、React/Vue/NestJS 类型检查；`vp test run` **8 个测试文件、77/77 单元测试通过**（包含 `transform-gesture.test.ts` 的 **12/12**）；NestJS E2E **2/2 通过**；文档静态检查 **29 个 Markdown 文件通过**；React 和 Vue 的 Vite+ Web 构建均成功。

日志最后只显示 `pnpm --filter @adui/scada-server run build` 进入 `nest build`，**未显示返回终态或退出码**，不得单独认定 NestJS 构建成功。用户尚未提供旋转 SVG 光标在浏览器中的悬停、Pointer 拖动、松开、Esc/PointerCancel 视觉反馈；这部分仍待确认。此前第六批其他画布交互已由维护者确认验收通过。

此次记录依据维护者提供的终端日志，不代表 Agent 独立执行。记录文档之后尚未再次运行 `docs:check`；Docker/Tauri、工业网关和生产设备安全验收不在此次范围内。

## 2026-11-10 · 旋转光标人工验收完成

维护者在提交 `bcfad90` 的 77/77 单元测试、2/2 E2E 和 Vue/React Web 双构建复验结果之后，进一步回复「旋转光标正常」，确认本批新增环形旋转箭头鼠标样式的 Vue/React 浏览器交互符合要求，涵盖旋转点悬停、按住拖动、松开及取消恢复。以上为**维护者人工 UI 验收反馈**，不是 Agent 在浏览器独立复测。

据此，PR #8 的缩放/旋转和旋转光标两类交互验收均记录为维护者确认通过。此前 Windows `ready` 日志仍缺少 `nest build` 的最终退出状态；本次验收文档补充后未重新执行 `docs:check`。不扩展为 Docker/Tauri 或真实工业现场安全验收，也不构成合并 PR 的授权。

## 2026-11-10 · 第七批八方向缩放开发分支（待验收）

在已完成维护者上一轮 `main` 验收（77/77 单元测试、2/2 E2E、React/Vue/NestJS 构建确认）的基础上，从合并提交 `cc442bf` 新建 `feat/v0.2-eight-direction-resize`。新分支新增 **7 项** Core 回归用例（`transform-gesture.test.ts` 从 12 扩为 19），整仓单测源码预计 **84 项**。尚未在本次分支实际运行 `pnpm run ready`、类型检查、Vitest/E2E、Web/Server 构建或浏览器交互，不将前一批验收结果当作本批通过。

维护者 Windows 验证：

```powershell
git fetch origin
git switch feat/v0.2-eight-direction-resize
pnpm run ready
pnpm run dev:react
pnpm run dev:vue
```

人工验收：Vue/React 单选均出现八个方形缩放手柄；四角双轴缩放无回归，上/下仅改高度、左/右仅改宽度；图元旋转 30°/90° 后拖动边中点，对侧锚点稳定，沿切线拖动不改变另一轴；50%/200% 缩放坐标准确；非法尺寸/越界不污染预览或历史；松开一次撤销/重做；高精度小数零位移保持；跨 Vue/React JSON 双向往返保留坐标、Tag；原旋转箭头、网格吸附、只读 Runtime 均不回归。

独立数学等价算例曾检查 1007 个基础/抽样场景且未发现超过 0.015 单位的锚点漂移，但**不等于运行本仓库中的源码测试**；仍须维护者 Windows 质量链与浏览器验收。工业现场写入、Docker/Tauri、工程发布与持久化不在本批。

## 2026-11-10 · 第七批八方向缩放维护者验收通过

维护者对 PR #9 第七批「八方向缩放与旋转单轴锚点」明确回复「验收通过」。据此前列出的验收清单，将本批 `pnpm run ready` 质量链和 Vue/React 双框架八方向手柄、旋转图元单轴缩放、对侧锚点、边界/撤销、双向工程 JSON/Tag 互通及原有只读 Runtime 回归记录为**维护者确认通过**。

**证据边界**：本次仅收到维护者的验收结论，未附 `pnpm run ready` 最终退出码、单测总数及各构建输出；因此源码预计的 **84 项**不能写成已经逐项独立核实的 **84/84**。分支另含维护者提交 `82042df` 的代码格式调整，未由 Agent 在 Windows 独立执行本批测试。本次补充文档之后也尚未重新检查 `docs:check`。

PR #9 继续保持 Draft，不合并 `main`；不扩大为工业设备现场安全、Docker/Tauri、服务端持久化或正式工程发布验收。

## 2026-11-10 · V0.2 第八批等比例缩放（开发中，待验收）

在第七批 PR #9 已合并到 `main` 后，从合并提交 `47ca2f4` 创建 `feat/v0.2-aspect-ratio-resize`。共享 Core 新增 `Shift` 锁定原始宽高比的功能，React/Vue 透传 `PointerEvent.shiftKey`；新增 **9 项** `transform-gesture.test.ts` 用例，该文件预计 28 项，整仓单元测试**预计 93 项**。本轮新代码**尚未运行** Vitest、`vp check`、类型检查、文档校验、E2E 或 Web/Server 构建；历史已合并 PR 的通过记录不能当作本批结果。

已独立手算/复核的 10 组基本几何算例与预期一致，但这**不是**在本仓库内执行测试。当前执行环境无法访问 GitHub 远端 Git 地址且无 pnpm，故完整验证交由维护者 Windows 环境完成。

维护者本机执行：

```powershell
git fetch origin
git switch feat/v0.2-aspect-ratio-resize
pnpm run ready
pnpm run dev:react
pnpm run dev:vue
```

人工验收：Vue 和 React 选中图元后，普通八方向拖动行为不变；按住 Shift 拖动任意四角或边中点，宽高按原比例变化；松开 Shift 后恢复普通单轴/双轴缩放；30°/90° 旋转图元对侧固定锚点不漂移；50%/200% 视图缩放仍准确；非法尺寸/画布越界保留最后合法预览，Esc/PointerCancel 不提交；PointerUp 仅形成一条可撤销命令；JSON 双向往返时图元 ID、几何属性、Tag 绑定保持一致；Shift 旋转仍按 15° 吸附，模拟 Runtime 与工业设备只读边界不变。

本批仅验证本地图元编辑，并非工业现场安全认证、Docker/Tauri 专项或正式工程保存/发布。

## 2026-11-10 · 第八批 Shift 等比例缩放 Windows 质量链首次执行

维护者提供 `pnpm run ready` 的 PowerShell 日志：依赖目录 9 个清单/26 项、共享配置、根环境与 LF、中文文案 72 个文件通过；**130 个文件格式检查通过**；React/Vue 的 `tsc --build` / `vue-tsc --build` 与 NestJS `tsc --noEmit` 通过；**8 个测试文件、93/93 单元测试通过**（其中 `transform-gesture.test.ts` **28/28**）、**2/2 NestJS E2E 通过**；文档 **31 个 Markdown 文件通过**，React 和 Vue Web 构建均成功。

但 `vp check` 在 51 个文件中报告 **0 错误、2 条警告**，均为 `packages/core/test/transform-gesture.test.ts` 的 `vitest(require-to-throw-message)`：两处 `toThrow()` 未提供期望错误；因此不能将该日志记为「零警告质量链完整通过」。本次在独立修复提交 `1c1279b` 中将两处断言改为 `toThrow(/画布范围/)`，同时使测试明确匹配共享 Core 的中文越界错误，**未修改业务逻辑**。

原日志最后进入 `nest build`，未提供最终退出状态/退出码；服务端构建终态仍待单独确认。修复提交及本次文档更新后，**还没有维护者提供的最新 `vp check` / `pnpm run ready` 结果**；React/Vue 的 Shift 等比例缩放真实浏览器交互尚待逐项确认。

建议重新运行：

```powershell
vp check
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
```

以上均依据维护者本机日志，不代表 Agent 独立执行；Docker/Tauri、工业网关、设备现场安全及工程发布不在本批验证范围内。

## 2026-11-10 · 第八批 Shift 等比例缩放零警告质量链复验通过

维护者在两条 `vitest(require-to-throw-message)` 警告修复后，重新运行 `pnpm run ready` 并提供完整 Windows PowerShell 日志及最终 `Write-Host "退出码：$LASTEXITCODE"`，输出 **`退出码：0`**。这次日志明确确认：

- 依赖 Catalog（9 个清单、26 项依赖）、统一配置、环境/LF、中文文案（72 个文件）均通过。
- 格式检查 **130 个文件通过**，`vp check` 对 51 个文件显示 **零警告、零 Lint 错误、零类型错误**；React/Vue 与 NestJS TypeScript 类型检查通过。
- 单元测试 **8 个文件、93/93 通过**，其中 `transform-gesture.test.ts` **28/28**；NestJS E2E **2/2 通过**。
- 文档静态检查 **31 个 Markdown 文件通过**；React 与 Vue Web 构建均成功；NestJS `nest build` 完成且完整 `ready` 退出码为 **0**。

这是维护者真实本机执行结果，**不是 Agent 独立运行**。此前 Lint 的两条警告已在此次复验中确认消除。当前尚未收到 Vue/React 的实际浏览器 Shift 等比例缩放交互及 JSON 双向往返的人工验收结论，不能把自动化检查成功当作全部交互验收完成。

此记录提交后尚未再次运行文档检查；Docker/Tauri、真实设备、工业现场安全及工程发布仍不在本批范围内。PR #10 保持 Draft，不合并 `main`。

## 2026-11-10 · 第八批 Shift 等比例缩放人工交互验收通过

维护者在最新 `pnpm run ready` **退出码 0**、**93/93 单测**、**2/2 NestJS E2E**、零警告静态检查及双 Web/NestJS 构建通过之后，进一步明确回复「交互验收通过」。按 PR #10 既定六项双框架人工验收清单记录确认：React/Vue 八方向缩放与悬停提示、四角保持原始宽高比、四边中点对应主轴及对侧锚点、30°/90° 旋转与 50%/200% 视图缩放、非法尺寸/取消/撤销重做及 Shift 旋转无回归、双向 JSON/Tag 互通和只读模拟 Runtime 展示均由维护者确认通过。

**证据来源**：质量链来源于维护者提供的 Windows 终端日志；六项浏览器交互来源于维护者明确的人工验收结论，非 Agent 自行启动浏览器独立测试。本次仅新增文档记录，提交后尚未重新运行 `pnpm run ready` 或 `docs:check`，但不改动业务代码。PR #10 验收清单预计全 7 项完成，仍保持 Draft，未经额外授权不合并 `main`。工业现场安全、Docker/Tauri、设备写入和正式工程发布均不在此次验收范围内。

## 2026-11-10 · V0.2 第九批图元组合开发（待验证）

从已合并 PR #10 的 `main`（`752ef39`）创建 `feat/v0.2-node-grouping`，新增可持久化、受校验的组合 ID、组合/解组命令、自动选中完整组、整组移动与吸附，以及 Vue/React 双版按钮。新添 **4 项文档单元测试**和 **9 项编辑器回归用例**，单测入口预计由 93 项增为 **106 项**；此为源代码统计，尚未实际执行。

当前协作容器的 GitHub 域名无法解析，未能克隆当前远端仓库且未安装仓库要求的 pnpm/Vite+，因此不能声称执行过本批 `vp check`、Vitest、E2E 或构建。请维护者在 Windows 当前项目中执行：

```powershell
git fetch origin
git switch feat/v0.2-node-grouping
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
pnpm run dev:react
pnpm run dev:vue
```

双框架人工验收：Shift 多选两个或多个非组合图元后执行「组合所选」，列表出现同一组合 ID；点击任一组员（含 SVG 和左侧列表）均选中整组，Shift 再次点击整体反选；框选/全选自动扩展组员。组合整体拖动、靠近网格和其他图元吸附、四边裁切、撤销/重做和删除整组行为一致；解组后恢复独立选中和移动；单体属性、文本及逐项对齐禁止误改组合成员。验证两套框架跨框架 JSON 双向导入导出不丢组合关系、节点 ID、位置和 Tag 绑定；原来的八方向/Shift 等比例手柄、旋转箭头、画布缩放与只读 Runtime 不受影响。

**剩余风险**：新 `groupId` 是未升版本的可选 JSON 字段，旧版解析器可能丢弃组合关系；本批只确保同版本 Vue/React 互通，不提供旧客户端可编辑兼容承诺。分组不支持嵌套或整体变形。工业现场、真实 PLC/DCS、Docker/Tauri、正式发布及权限安全专项不包含本次验收。

## 2026-11-10 · V0.2 第九批多图元组合维护者验收确认

维护者明确反馈本批「验收通过」。据 PR #11 已制定的七项验收清单，记录维护者对质量检查、Vue/React 双版组合与解组、整组选中及框选/Shift、移动吸附与删除、单体编辑防护、双向 JSON/Tag 往返、既有缩放与只读 Runtime 回归的总体通过确认。

开发分支另有维护者提交 `9c06def`（「统一工程代码格式并通过 Vite+ 质量检查」），仅修改 Vue Studio 模板与共享编辑器格式。**证据边界**：本轮仅收到「验收通过」的总体结论及该格式整理提交，没有提供此批 `pnpm run ready` 完整日志、实测单元测试数量、各项构建输出或最后退出码。源码预估 **106 项**仅为开发期统计，不记为已独立核对的 **106/106**；不能将 Git 提交说明等同于完整质量链原始日志。本条验收来自维护者确认，非 Agent 独立运行。后续追加此记录也未重新运行 `docs:check`。

PR #11 保持 Draft，**未经另行合并授权不修改 `main`**。新增的 `ScadaNode.groupId` 在现有 `0.1.0` 预发布 Schema 下可能被旧版本 Parser 丢弃，正式保存/发布前仍需确定 Schema 迁移方案；现场安全、PLC/DCS 真实写入与 Docker/Tauri 不属于本批验收。

## 2026-11-10 · V0.2 第十批 Schema 升级与迁移开发分支（待验收）

从 PR #11 合并后的 `main`（`3f20f10`）建立 `feat/v0.2-schema-migration`。上一批维护者 Windows 实测 `pnpm run ready` **106/106 单元测试、2/2 NestJS E2E、零 Lint 警告、三端构建通过且退出码 0**；该结果**不是**本批测试结果。

新增文档验证 **8 项**及编辑器验证 **4 项**，整仓单元测试入口预计 **118 项**。本次尚未在维护者 Windows 运行 `pnpm run ready`、Vitest、类型检查、E2E、Web/Server 构建或浏览器验收；不能根据静态源码统计宣称测试通过。

```powershell
git fetch origin
git switch feat/v0.2-schema-migration
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
pnpm run dev:react
pnpm run dev:vue
```

人工验收：React、Vue 分别导入无组合及含合法 `groupId` 的 `0.1.0` 草稿，确认提示由旧版升级、导出 `0.2.0` 并跨框架双向往返保留页面、节点、位置、Tag 和组合；当前 `0.2.0` 导入仅显示常规提示。未知/未来版本、未知结构字段、非法组合和不安全 JSON 被拒绝，原文档、选择和撤销记录不改变。确认模拟 Runtime 只使用当前 Schema，不提供旧版自动升级；原 SVG、缩放、吸附、组合与只读模拟数据无回归。

工业现场、Docker/Tauri、正式资源包/工程发布及所有历史旧客户端的二进制兼容测试不在本批。文档本身尚未经本批真实 `docs:check`。

## 2026-11-10 · 第十批首次 Windows ready：SVG 测试数据版本失配及修复

维护者执行 `pnpm run ready` 并提供原始日志：依赖 Catalog（9 清单、26 项）、共享配置、根环境与 LF、中文文案（73 个文件）、**133 个文件格式检查**、**52 个文件零警告静态检查**以及 React/Vue/NestJS TypeScript 类型检查通过。Vitest 阶段 **7 个测试文件成功，115 项测试通过**；`packages/core/test/svg.test.ts` 在模块加载时因测试工程仍写死 `schemaVersion: "0.1.0"`，被新 `parseScadaDocument` 按预期拒绝（预期 `0.2.0`），导致该文件 **3 项测试均未执行**，完整 `ready` 退出码为 **1**。因命令链在单测阶段终止，**E2E、文档检查、React/Vue 与 NestJS 构建没有执行**。

已在当前特性分支提交修复 `a6e94a5`：仅更新 `packages/core/test/svg.test.ts`，导入 `SCADA_SCHEMA_VERSION` 并让测试 Fixture 使用当前 Schema 常量。生产解析、迁移和运行时代码保持不变，未为通过测试而放宽版本校验。**修复后尚未重新执行 `pnpm run ready`**，预计 118 项单测仍须维护者复验并给出最终退出码。

## 2026-11-10 · 第十批 Schema 迁移修复后完整质量链通过

维护者在测试 Fixture 修复 `a6e94a5` 和分支格式整理 `c0bb653` 后，于 Windows PowerShell 再次执行 `pnpm run ready` 并提供完整日志，最终 **退出码 0**：

- 依赖 Catalog 检查（9 个清单、26 项依赖）、共享配置（8 个 TSConfig 消费端）、根环境及 LF 行尾检查均通过；自有中文文案检查 **73 个文件**。
- Vite+ 格式检查 **133 个文件全部通过**；Lint/静态检查 **52 个文件零警告、零错误**；React `tsc --build`、Vue `vue-tsc --build` 和 NestJS `tsc --noEmit` 全部通过。
- Vitest 单元测试 **8 个文件、118/118 项通过**；其中 `document.test.ts` **16 项**、`editor.test.ts` **43 项**、`svg.test.ts` **3 项**均通过；NestJS E2E **2/2 项通过**。
- Markdown 静态文档检查 **33 个文件通过**；React、Vue 两套 Web 构建成功，NestJS `nest build` 完成，整个命令退出码 **0**。

这一记录来自维护者实际终端日志，并非 Agent 独立执行。确认此前加载失败的 SVG 测试用例已恢复执行；**尚未提供 Vue/React 真实浏览器旧版工程迁移、双向 JSON 往返及只读 Runtime 的逐项人工验收结论**。记录这段文档之后，新增文档本身未重新运行 `docs:check`；PR #12 保持 Draft，不修改 `main`。

## 2026-11-10 · 第十批 Schema 迁移 Vue/React 交互验收通过

维护者明确反馈「验收通过」，按 PR #12 原定的剩余六项验收清单记录人工交互验收完成：双框架导入无组合的历史 `0.1.0` 工程及升级提示、含合法 `groupId` 的历史组合保真、当前 `0.2.0` 工程导入与 Vue/React 双向 JSON/Tag 往返、未知版本与结构字段拒绝及失败状态保留、只读 Runtime 的当前 Schema 和模拟画面，以及既有组合、缩放、吸附、撤销重做等编辑命令无回归。该结论**来源于维护者总体人工验收反馈，并非 Agent 独立浏览器逐项复测**。

本批此前已有维护者提供的完整 Windows `pnpm run ready` 日志：**118/118 单元测试、2/2 NestJS E2E、133 文件格式检查、52 文件零警告静态检查、33 份 Markdown 检查、React/Vue/NestJS 类型检查与三端构建成功、退出码 0**。此条新增验收记录后**尚未重新执行** `docs:check` 或 `pnpm run ready`。PR #12 的七项验收清单据此全部完成，仍保留 Draft，**未经单独合并授权不修改 `main`**。正式工程持久化、生产发布、历史二进制客户端兼容、Tauri 与真实工业现场安全验收不在本批结论范围内。

## 2026-11-10 · V0.2 第十一批浏览器工程草稿（待验证）

从合并 PR #12 的 `main`（`fe6581c`）创建 `feat/v0.2-local-drafts`。此前维护者在上一批特性分支执行的 `pnpm run ready` **118/118 单元测试、2/2 NestJS E2E、33 份 Markdown、三端构建、退出码 0**，不得作为本批测试通过的证据。本批新增 10 项 Core 单元测试，整仓预计 **128 项**；增加 ADR-0019 后 Markdown 文档预计 **34 份**。**本批尚未运行** Vite+ 格式、Lint、类型检查、Vitest、E2E、文档校验、构建和浏览器交互。

```powershell
git fetch origin
git switch feat/v0.2-local-drafts
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
pnpm run dev:react
pnpm run dev:vue
```

人工测试需要核对双端的按钮一致性：修改图元→保存→刷新→恢复→JSON / Tag / 组合数据一致；保存覆盖与恢复取消后不丢数据；保存/读取失败或损坏草稿不改变当前画面与原始记录；清除后恢复按钮禁用且画面不变；不同 `projectId` 互不覆盖。验证旧版 JSON 导入升级、撤销重做、只读 Runtime 不受影响。浏览器本地数据可能在隐私模式或清理网站数据后丢失；本功能不提供正式工程备份或工业安全验收。此记录只是开发说明，等待本机质量链实测。

## 2026-11-10 · 第十一批首次 Vite+ 检查失败与定点修复

维护者在 Windows 执行 `vp check --fix` 后提供日志：**54 个文件检查出 2 个 TypeScript 错误及 2 个 Lint 警告**，同时格式化步骤显示完成。错误分别为 Core `local-draft.ts` 的两处 `TextEncoder` 缺少类型定义（TS2304）；警告分别为 React Studio 的 Effect 内同步 `setHasSavedDraft`（`react(set-state-in-effect)`）和 `local-draft.test.ts` 中空参数 `toThrow()`（`vitest(require-to-throw-message)`）。因此**不能将该轮 `vp check --fix` 记为通过**，也没有收到 `pnpm run ready` 执行结果。

分支修复提交 `6ea0c00` 做最小调整：Core 改为无 DOM 类型依赖的纯 TypeScript UTF-8 字节计数；React 以 `useState` 惰性初值检测首次草稿，并在工程导入事件中同步可恢复状态，不再于 Effect 中直接更新该状态；Vitest 针对不同非法草稿分别断言中文错误信息，另补中文多字节数据的 **2 MiB 字节上限**回归。独立 Node 小范围验证已核对 ASCII、中文、Emoji、孤立代理项及大文本的字节计数与 `TextEncoder` 结果相同；**此检查不能代替仓库 `vp check`、Vitest 或完整 `pnpm run ready`**。

新增本段验收记录后，尚未重新执行格式、Lint、TS、单测、E2E、文档检查或三端构建。请维护者将分支更新到修复提交及其后续文档提交后重新执行 `pnpm run ready` 并提供退出码。PR #13 继续保持 Draft，未得到合并授权。

## 2026-11-10 · 第十一批修复后质量链复验（完整退出码待确认）

维护者在 Windows PowerShell 执行 `pnpm run ready`，提供以下原始输出：Catalog **9 个清单/26 项依赖**、共享配置、根环境与 LF、中文文案 **75 个文件**通过；Vite+ **136 个文件格式检查通过**，**54 个文件零 Lint 警告、零错误**，React/Vue/NestJS TypeScript 类型检查全部通过；Vitest **9 个测试文件、128/128 项单测通过**（含新增 `local-draft.test.ts` **10/10**）；NestJS E2E **2/2**，Markdown 静态检查 **34 份**；React 和 Vue 两套 Web 构建均成功。

**证据边界**：维护者日志最后仅显示开始运行 `nest build`，**尚未附最终 PowerShell `$LASTEXITCODE`**；因此不能断言整条 `ready` 已以退出码 0 完成。也未收到浏览器手动保存、刷新恢复、存储损坏/拒绝访问与跨 Origin 等人工验收结论。分支新增维护者格式整理提交 `ed6a857`，只改 `local-draft.ts`、`local-draft.test.ts` 的格式，无业务语义变化。

本轮协作另在独立 Node 运行时执行纯函数 UTF-8 字节计数对照（空文本、ASCII、中文、Emoji、高/低孤立代理项、混合字符串和 70 万汉字），均与原生 `TextEncoder` 字节长度一致；**这只是单独函数的实测，不替代仓库 `pnpm run ready`**。新增此文档后未重新执行 `docs:check`。PR #13 保持 Draft，未获合并授权，工业现场安全、正式工程发布和多标签页一致性不在验收范围内。

## 2026-11-10 · 第十一批本地草稿质量链完整通过与保存验收

维护者补充此前同一次 Windows PowerShell `pnpm run ready` 的最终结果：`Write-Host "退出码：$LASTEXITCODE"` 返回 **退出码 0**。结合此前完整终端日志，本批依赖 Catalog、共享环境/LF、中文文案 **75 文件**、Vite+ 格式检查 **136 文件**、Lint/静态检查 **54 文件零警告**、React/Vue/NestJS 类型检查、单元测试 **128/128**、NestJS E2E **2/2**、Markdown 文档检查 **34 份**、React/Vue Web 构建与 NestJS `nest build` 全部完成，确认整条 `ready` 执行成功。

维护者另明确回复「保存验证成功，同意合并」，据此**本地草稿保存功能已获人工验收及明确合并授权**。但未提供 Vue/React 各自刷新恢复、取消覆盖/恢复、损坏记录、跨工程隔离和 Runtime 全套人工步骤的逐项记录；这些场景已在设计、部分 Core 单测和现有校验中覆盖，不应声称所有浏览器手工场景已逐项执行。此次新增记录后**尚未再次运行 `docs:check`**；不能把文档追加后的新提交视为重新执行过质量链。正式工程持久化/发布、历史快照和工业现场验收不属于本批。

## 2026-11-10 · V0.2 第十二批按需自动保存开发（待验证）

本批基于 `main` 合并提交 `27a2229` 建立 `feat/v0.2-safe-autosave`。维护者上一批已在 Windows 执行通过完整 `pnpm run ready`（**128/128** 单测、**2/2** E2E、文档和三端构建，退出码 **0**），但**不继承该验收结果**给本批。新增 **12 项** Core 测试，源码预计 **140** 项单测、**35 份 Markdown**；这些数字尚未由本批真实测试证实。

```powershell
git fetch origin
git switch feat/v0.2-safe-autosave
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
pnpm run dev:react
pnpm run dev:vue
```

两端人工检查：初次打开默认关闭自动保存、已有草稿开启需确认、快速连续编辑等待 1 秒后保存最终工程、切换图元选中与预览不触发写入；刷新后只有恢复提醒并需要人工确认恢复。另一标签页同一 Origin 同项目修改或清除草稿，原页面停止自动保存、保留现有画面；存储损坏或格式不兼容时拒绝开启，非法工程 ID 和写入失败不破坏旧记录。人工保存同步自动保存基线、导入其他工程/恢复/清除立即暂停；继续检验双框架 JSON 往返、组合/Tag/撤销和只读 Runtime。自动保存不足 1 秒直接关闭可能丢失最后修改，跨标签页检测不是原子锁。

本批未独立执行 Vite+ 格式、Lint、类型、Vitest、E2E、文档检查或三端构建；在维护者实际提供 Windows 结果前，PR 应继续 Draft。文档本身不构成生产级安全验证。

## 2026-11-10 · 第十二批 Dexie IndexedDB 存储切换（待验证）

在已有 V0.2 第十二批 PR #14 分支中，按维护者新要求调整 IndexedDB 正式存储方案。选型 `dexie@4.4.7`，测试使用 `fake-indexeddb@6.2.8`，新增 `packages/draft-storage`，`DraftRepository` 的 Core 异步接口及 IndexedDB 事务版本条件写入。历史 localStorage 草稿以校验+事务迁移，且**提交成功后才尝试清理旧数据**。本批未独立运行新依赖的安装、类型检查、Lint、单测或浏览器测试，所有质量指标保留待验证。

现有 128 项已验收单元测试 + 第十二批旧新增 12 项 + 当前新增 **7 项 Core 异步仓储测试和 9 项 fake IndexedDB 测试**，合计源码预计 **156 项**；Markdown 新增 ADR-0021 后预计 **36 份**。新增 `packages/draft-storage/tsconfig.json` 后共享 TSConfig 消费端预计 **9 个**，Catalog 从 26 项增加到预计 **28 项**，依赖清单从 9 个增加到预计 **10 个**。这些仅为静态计算，不等于任何单项实际检查通过。

```powershell
git fetch origin
git switch feat/v0.2-safe-autosave
pnpm install
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
pnpm run dev:react
pnpm run dev:vue
```

待核验：新依赖安装/冻结 Catalog、`vp check` 零警告、React/Vue/新存储包/NestJS 类型检查、Core/Vitest+fake-indexeddb 用例、NestJS E2E、36 份文档及三端构建；浏览器旧 `localStorage` 草稿迁移后恢复保真、同 Origin 双标签页事务冲突、清除后旧备份不复活、自动保存防抖、刷新后仍需明确恢复、现有手动 JSON 和 Runtime 只读行为无回归。

本批未执行工程发布、工业现场安全检查或真实 PLC/DCS 采集；IndexedDB 不能替代服务器持久化和备份。完成质量链后再逐项登记测试结果，Draft PR #14 未获新的合并授权。

## 2026-11-10 · PR #14 Dexie 存储边界修复（待完整质量检查）

在维护者先前对 PR #14 提交 `2189eb4`（允许确认清理损坏历史草稿）之后，继续检查并修复三个风险：Core `DraftAutoSaveSession.saveIfDirty` 以 `async` 保证非法输入也按 Promise 拒绝；新增 `InvalidLegacyDraftError` 明确区分无效旧 localStorage 草稿与 IndexedDB/浏览器存储读取故障，Vue/React 仅对确定的损坏旧草稿放行用户确认清理；针对删除重建的 **ABA 修订号重复**，`migrations` 表保留每工程的 `lastRevision` 水位，后续新建始终单调递增，并在同一 IndexedDB 事务内写入草稿及水位。

新增两项异常场景测试和一项删除重建冲突测试，并补充 1 项 Core Promise 拒绝测试；基于上一批 **128** 项和本批原始新增 **28** 项及新增 **4** 项，**源码预计总计 160 项单元测试**。其中旧存储读取权限故障不应误判为可清理的损坏草稿，删除重建后旧标签页持有的 `revision` 不能覆盖新工程。

**本批仍未执行完整 `pnpm install`、`pnpm run ready`、真实浏览器迁移及双标签页验收**。源码计数不是实际通过结果，新的 Markdown 章节也尚未执行文档格式校验。特别注意 pnpm 12.18.0 新增 `dexie` / `fake-indexeddb` 的正确安装及**由 pnpm 生成的锁文件**；不要手动构造 lockfile。

## 2026-11-10 · V0.2 第十三批模拟 Tag 绑定待验收

本批共享编辑器单测新增六项源码用例，整仓预计 166 项，**没有在维护者 Windows 本机执行验证**。在项目根目录运行：

```powershell
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
pnpm run dev:react
pnpm run dev:vue
```

之后人工检查 Vue/React 的模拟 Tag 绑定、解除、撤销/重做、组合拒绝、JSON 双向互通、IndexedDB 草稿恢复及只读 Runtime `STALE/GOOD` 回归。自动检查不替代浏览器操作。

## 2026-11-10 · V0.2 第十四批多页面编辑验收待执行

新增页面管理与按页面几何、吸附、SVG 预览，源码预计增加 13 项单测至 179 项；未经本批完整运行不得登记为通过。维护者在 Windows PowerShell 根目录执行：

```powershell
git fetch origin
git switch feat/v0.2-multi-page-studio
pnpm install --frozen-lockfile
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
pnpm run dev:react
pnpm run dev:vue
```

人工验收覆盖：创建/重命名/切换/删除至少两页，删除最后一页拒绝；页面切换不产生工程脏状态，撤销/重做跨页准确；第 2 页框选、缩放、吸附、组合、模拟 Tag 绑定不得影响第 1 页；多页面 JSON 双向互通，IndexedDB 手动保存/按需自动保存及刷新后人工恢复正确；只读 Runtime `STALE/GOOD` 无回归。

本批真实 `ready` 与双框架浏览器操作均待维护者提供结果，不可将源码存在或历史检查结果当作本批通过。

## 2026-11-10 · V0.2 第十五批复制与排序待验收

本批新增 15 项共享 Core 测试，整仓**预计 194 项单测**，另有 2 项 NestJS E2E。新 ADR-0023 后 Markdown **预计 38 份**；所有数值为静态统计，需维护者 Windows 实测确认。

```powershell
git status -sb
git fetch origin
git switch feat/v0.2-page-copy-order
pnpm install --frozen-lockfile
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
```

如 `ready` 全部通过，分别运行 `pnpm run dev:react` 和 `pnpm run dev:vue` 检查页面复制、排序、跨页面选择/复制及组合完整性，验证原工程不变和撤销重做；跨框架 JSON 双向互通、IndexedDB 手动/自动草稿与人工恢复，最后检查默认 Runtime `pages[0]`、STALE/GOOD 及设备写入禁用行为。

**注意：** 页面排序会改变默认 Runtime 第一页显示内容；当页面完整复制导致工程超过 IndexedDB 草稿大小上限时，应提示保存失败并允许用户导出 JSON。当前环境未执行上述命令或浏览器实机验证，禁止把源码存在等同于检查通过。

## 2026-11-10 · V0.2 第十六批会话图元剪贴板待验收

Core 新增 13 项剪贴板回归测试，整仓源码预计 **207 项单测**、**2 项 NestJS E2E**，新增 ADR-0024 后 Markdown **预计 39 份**。这只是静态统计；当前环境无法拉取仓库执行 pnpm/Vite+，不作为测试通过证据。

```powershell
git status -sb
git fetch origin
git switch feat/v0.2-node-clipboard
pnpm install --frozen-lockfile
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
```

在 React/Vue 浏览器进一步验证：剪贴板按钮和 `Ctrl/Cmd+C/X/V`；输入框不抢占系统复制粘贴；组合完整复制与剪切、重复偏移、撤销重做、跨页面粘贴与画布边界拒绝；JSON 双方向互通、IndexedDB 手动/自动保存和人工恢复。确认没有持久化剪贴板，也没有生产 PLC/DCS 设备连接或写入。

等待维护者提供本批实际检查与人工验收记录，不沿用此前 194 项通过的结论。

## 2026-11-10 · V0.2 第十七批图元图层状态待验收

Core 新增 19 项图层状态、锁定保护、隐藏渲染与兼容性测试源码，整仓**预计 226 项单测**、**2 项 E2E**，新增 ADR-0025 后 Markdown **预计 40 份**，所有数字均需维护者 Windows 实测确认。

```powershell
git status -sb
git fetch origin
git switch feat/v0.2-node-layer-state
pnpm install --frozen-lockfile
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
pnpm run dev:react
pnpm run dev:vue
```

人工检查 Vue/React 同步的锁定/解锁、隐藏/显示、批量命令历史、图层列表恢复隐藏、锁定拖动/几何/剪切/删除保护、旧工程兼容、JSON 双向互通和 Dexie 草稿恢复。最新 Runtime 必须过滤隐藏图元、保留锁定图元显示和 Tag 质量；工业写入接口仍不开放。静态代码检查不代表现场安全验收通过。

## 2026-11-11 · V0.2 第十八批精确图层排序待验收

本批新增 17 项共享 Core 测试源码，整仓静态预计 **243 项单测**、**2 项 NestJS E2E**、**41 份 Markdown**。该数字需维护者 Windows 复核，当前尚未有本批 `pnpm run ready` 完整成功日志。

```powershell
git status -sb
git fetch origin
git switch feat/v0.2-precise-layer-order
pnpm install --frozen-lockfile
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
pnpm run dev:react
pnpm run dev:vue
```

除自动检查外，人工在 React/Vue 分别验收：列表上层在上，图层拖放高亮与上/下插入正确；精确目标选择可用于非拖放排序；非连续组合整体移动，原有上/下层按钮兼容；锁定图元及锁定组合不能被直接或间接移动；切页清空拖动会话；撤销/重做及工程 JSON/IndexedDB 双框架往返不丢层序。Runtime 只读、STALE/GOOD 与设备写入禁用不回归。本批静态审查不能代替实际浏览器验收。

## 2026-11-11 · V0.2 第十九批组合图层树待验收

本批共享 Core 图层树投影新增 13 项测试源码，整仓静态预计 **256 项单测**、**2 项 NestJS E2E**，ADR-0027 后预计 **42 份 Markdown**；均以维护者 Windows 运行结果为准，当前没有本批完整质量链实测。

```powershell
git status -sb
git fetch origin
git switch feat/v0.2-layer-group-tree
pnpm install --frozen-lockfile
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
pnpm run dev:react
pnpm run dev:vue
```

人工验收两套 Studio：组合树展开/折叠和成员选中同步、组名/成员/类型/中文文本搜索、定位选中图层、非连续组提示、锁定/隐藏状态、原生拖拽与精准插入；切换页面清空搜索、导入/恢复清空 UI 折叠状态。对比 Vue↔React JSON 双向导入与 IndexedDB 保存后人工恢复，确认不会持久化 UI 图层树；检查只读 Runtime 数据质量及 NestJS 未开放的设备写入接口无回归。静态文档检查不能代表已完成业务、工业现场安全验证。

## 2026-11-11 · V0.2 第二十批 TDesign 双端依赖及 UI 迁移待验收

新增四个 TDesign Catalog 依赖及 1 项 Core 几何属性元数据测试，源码预计 **257 项单测**、**2 项 E2E**、**43 份 Markdown**。当前执行环境无法访问 npm Registry，**没有完成锁文件生成或新依赖安装**，因此绝不将此前通过的 `ready` 结果复用到本批。

联网维护者 Windows 首次操作：

```powershell
git status -sb
git fetch origin
git switch feat/v0.2-tdesign-property-panel
pnpm install --no-frozen-lockfile
git diff -- pnpm-lock.yaml
pnpm install --frozen-lockfile
vp check --fix
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
```

要求将由 pnpm 自动生成的 `pnpm-lock.yaml` 变更审查并提交到当前功能分支，确认供应链依赖数量、TDesign 版本、重复图标包及 CSS 产物。检查 React/Vue TDesign 属性按钮/输入和搜索清除图标、几何字段一致性、原快捷键、Tag、组合、IndexedDB 草稿、只读 Runtime 与未实现设备写入返回 404。首次安装未完成前不能执行冻结安装、编译/验收，也不能批准合并。

## V0.2 · 浏览器交互回归（独立验收，不加入 ready）

维护者已在 Windows 执行通过 `pnpm run ready`：包括 270 项单测、2 项 NestJS E2E、React/Vue Web 构建、NestJS 构建与文档检查；这与浏览器真实尺寸和事件交互验收是两项独立证据。

在两个终端分别启动开发服务器：

```powershell
pnpm run dev:react
pnpm run dev:vue
```

随后在第三个终端执行：

```powershell
pnpm run test:browser
```

浏览器检查脚本为 `scripts/test-studio-browser.mjs`，使用 Node.js 内置 `WebSocket` 与 Chrome DevTools Protocol，无额外 npm 依赖；自动寻找 Chrome/Edge，创建**临时隔离浏览器配置文件**，结束后关闭浏览器并清理配置文件。

默认检查 React `http://127.0.0.1:5173/` 与 Vue `http://127.0.0.1:5174/`，各测试 1440×900、1024×768。可以设置 `SCADA_REACT_URL`、`SCADA_VUE_URL`、`SCADA_BROWSER_PATH` 覆盖本地网址或浏览器路径。

覆盖：应用无外层滚动条、中央画布无滚动条、SVG 与容器四边贴合、桌面侧栏固定宽度、视口世界比例、网格覆盖完整 viewBox、工程页面边界、放大与恢复适应、网格显隐、两侧栏显隐和图层点击后属性更新。脚本会输出每套框架每种尺寸的通过数量；任何断言失败退出码非零。

**边界**：该命令不是 Vite+ 单测，也不是工业现场 E2E；浏览器需要安装且两个开发服务器必须启动。当前仅验证了 Node.js 脚本语法和浏览器调试通信，在维护者实际双框架页面中尚未运行。保留人工检查：拖放图层、图元旋转、吸附辅助线、浏览器 125% 缩放、Vue↔React JSON 互导、Dexie 草稿恢复和 Tauri WebView2。

### 浏览器验收入口说明（2026-11-11）

React、Vue 均以“运行监控”为默认视图，而 Studio 由顶部“组态编辑”按钮异步切换。因此 `test:browser` **必须先模拟点击“组态编辑”**，等待工作台与 SVG 挂载后才检查画布。首次版本直接查询 `.studio-workspace`，导致运行监控页误报“元素不存在”；现已修复。每次尺寸测试使用独立的 `scada_browser_check` 本地查询参数，确保不会把上一页面的 `document.readyState` 当作新页面已加载。错误日志会携带地址、页面标题、导航状态及有限的页面文本，便于区分入口错误与应用加载失败。

验收脚本只操作临时浏览器配置，不修改 Studio 默认入口、工程文件或用户草稿。本次远端修复未在维护者 Windows React/Vue 页面上执行完整浏览器验收，需重新运行 `pnpm run test:browser`。

## V0.3 · Vue/React 工程文件双向浏览器互通验收

在已完成的 `test:browser`（76 项布局交互断言）之外，新增独立命令：

```powershell
# 先在其他终端运行 pnpm run dev:react / pnpm run dev:vue
pnpm run test:interop
```

沿用 `scripts/test-studio-browser.mjs` 的 Chrome/Edge 隔离浏览器、CDP 通信和 1440×900 视口，不新增依赖，**不会操作使用者现有的浏览器草稿或文件**。本命令先让 React Studio 通过真实界面新增水箱并导出 JSON，Vue 通过真实文件输入导入并重新导出，断言整个工程对象（包括 Schema、页面、图元顺序、几何属性、props、Tag bindings、rules）完全相等。再在 Vue 新增文本，执行 Vue → React → Vue 往返，证明两个方向都真实接受另一端导出的修改。额外用格式错误的 JSON 尝试导入，验证原工程未被覆盖。

测试脚本只在临时隔离浏览器内拦截下载用的 `a.click`，读取应用真实生成的 Blob；导入模拟浏览器原生 File/DataTransfer，触发真实 change 处理。不会改变工程 Schema、编辑器生产代码、后台或设备通信行为。测试失败退出码非零。

**实际 Windows 双框架测试尚未执行**。不要将历史 76/76 布局通过或 270/270 单测记录等同于新增互通命令通过。需先运行 `pnpm run test:interop`，再执行 `pnpm run ready`，验收后再考虑合并。

## V0.3 工程快照基础验收（ADR-0035）

本批只增加 `@adui/scada-core` 的新导出和单测，无应用生产 UI 改动，不要求启动外部服务。维护者在新功能分支运行：

```powershell
pnpm run test:unit
pnpm run ready
# 可选：两套 Web 开发服务器启动后复核此前互通与画布
pnpm run test:interop
pnpm run test:browser
Write-Host "退出码：$LASTEXITCODE"
```

此前主分支单测为 270 项，本批预期增加 10 项（以 Vitest 实际日志为准）。覆盖结构错误路径、JSON 往返、深冻结、稳定哈希、篡改、容器严格校验、非正修订号、非法 UTC 时间、2 MiB 容量边界。需运行环境提供 WebCrypto `crypto.subtle.digest`；不支持时明确失败而非降级。以上为验收计划，**新分支完整检查尚未执行，不可标记为通过**。

## V0.3 第三批：IndexedDB 工程历史仓储验收（ADR-0036）

本批只新增 Core 接口、现有草稿存储包中的独立历史库适配器、单测和文档；未修改 React/Vue 编辑器 UI、Runtime 或生产设备通信。维护者在功能分支根目录执行：

```powershell
pnpm run test:unit
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
```

此前合并主分支单测为 **280 项**；本批新增 **13 项**，预计 293 项，以实际 Vitest 输出为准。本批特别检查两个 Dexie 实例同时追加同一工程版本只允许一方提交、旧历史不覆盖、关闭重开仍可恢复、分页游标不重复、损坏 SHA-256 快照拒绝读取。原 `pnpm run test:interop` / `pnpm run test:browser` 仍可单独回归验证；由于没有界面改动，本批不把它们加入 `ready`。

真实 Windows 新增单测、`vp check`、类型和构建尚待维护者执行，不能沿用上批通过结论。此版本库仅为浏览器本地历史，**不是正式工程发布/回滚**。

## V0.3 第四批：Vue/React 本地版本历史管理验收（ADR-0037）

本批两套 Studio 增加本地版本历史菜单，并新增纯 Core 比较单测。维护者运行：

```powershell
pnpm run ready
# 分别在两个终端保持 pnpm run dev:react 和 pnpm run dev:vue
pnpm run test:browser
pnpm run test:interop
pnpm run test:versions
Write-Host "退出码：$LASTEXITCODE"
```

此前主分支单测 293 项，本批新增 4 项，预计 **297 项**，以 Vitest 日志为准。新 `test:versions` 在单独隔离 Chrome/Edge 配置中，分别对 React 和 Vue 创建本地历史版本 #1、添加图元并比较内容、取消载入检查未覆盖、确认载入检查工程完整恢复、创建版本 #2 验证倒序历史，不会使用用户浏览器实际的 IndexedDB。

额外人工验收：自动保存开启后载入历史必须先确认并暂停自动保存；手动保存草稿必须仍由用户触发；关闭/重新打开 Studio 后当前 Origin 历史应保留；另一 Origin 不应自动出现本地记录；WebCrypto 不可用和 IndexedDB 禁用时应显示中文错误、保留画面。浏览器测试不替代工业安全与 Tauri WebView2 现场验收。**新增命令及更新后的 `ready` 尚待维护者实际执行。**

## V0.3 第五批：历史恢复可靠性自动化验收（ADR-0038）

本批只修补双端异步 JSON 导入互斥并新增 Core/浏览器测试。维护者在新分支执行：

```powershell
pnpm run ready
Write-Host "完整检查退出码：$LASTEXITCODE"
# 两个终端分别保持 pnpm run dev:react 与 pnpm run dev:vue
pnpm run test:browser
pnpm run test:interop
pnpm run test:versions
pnpm run test:versions:safety
Write-Host "浏览器验收退出码：$LASTEXITCODE"
```

此前 297 项单测，本批增加 2 项，预计为 **299 项**（以 Vitest 输出为准）。`test:versions:safety` 使用临时 Chrome/Edge profile，分别检查两端自动保存已持久化后取消/确认历史恢复、确认后的草稿不被覆盖、跨页面重载历史存在、不同 Origin 历史隔离、历史库访问故障保留画面及故障后继续追加，并测试异步 JSON 导入与历史载入互斥。测试绝不操作真实浏览器用户配置。此命令独立于 `ready`，避免机器缺少 Chrome/Edge 或两套开发服务时影响常规质量入口。

**新命令和更新后的完整检查尚需维护者 Windows 实测。** 浏览器存储配额、Tauri WebView2、现场工业网络不在本批验证范围。

## V0.3 第六批：多标签页草稿并发与重试回归

本批第一阶段仅扩充现有 Core 与 Dexie 行为的确定性单测，不修改工程 Schema、IndexedDB 版本、双框架 UI、Runtime、设备通信或外部依赖。测试覆盖自动保存停写时取消尚未开始的排队任务、临时写入失败后的同会话重试、两个仓储实例同时更新已有修订号，以及保存与清除竞争时的事务互斥和墓碑修订号。

```powershell
pnpm run test:core
pnpm run test:unit
pnpm run ready
Write-Host "完整检查退出码：$LASTEXITCODE"
```

本批最初基于第五批 PR #27 的源码开发；第五批现已通过 Squash Merge 合并到 `main`（`0388bd3`），第六批分支已同步 `main` 并直接以其为 PR 目标。第五批原计划 299 项单测，本批增加 4 项。维护者于 2026-11-11 在 Windows 实际执行完整 `pnpm run ready`：**303/303 单测、2/2 NestJS E2E、181 个文件格式检查、React/Vue/NestJS 类型检查、53 个 Markdown 文档检查与双 Web/NestJS 构建均通过，退出码 0**。但 `vp check` 在 74 个受检文件中仍有 **5 条 `vitest(no-conditional-expect)` 警告、0 错误**，不能称作零警告验收。本批已将保存/清除竞争测试中的分支内断言改为分支外断言，保留两种事务结果的校验；**该修复提交后的 `ready` 尚需重新执行**。 真实 Chrome/Edge 多标签页交互、浏览器配额耗尽、Tauri WebView2 与工业现场仍需专项验收。

## V0.3 第七批：真实双标签页草稿并发安全验收（ADR-0039）

在现有 `scripts/test-studio-browser.mjs` 增加独立 `--multitab` 模式，根命令为 `pnpm run test:multitab`。测试复用 Chrome/Edge 临时 profile，通过浏览器调试接口创建两个真实标签页并连接同一 Origin 的 IndexedDB。React、Vue 各独立执行：

1. 两个标签页开启自动保存，其中一个写入后核对另一个通过 `BroadcastChannel` 收到外部修订号、暂停自动保存且不改变本地未保存画面。
2. 仅在隔离的第二个标签页模拟缺失 `BroadcastChannel`，确认过期草稿修订号被 Dexie 事务校验拒绝，较新的数据库内容不被覆盖。
3. 恢复正常通知后清除草稿、校验另一标签页停写，重建草稿修订号单调递增且不更改其他编辑画面。
4. 在隔离页针对 `drafts` 对象仓库的原生 `IDBObjectStore.put()` 临时注入写入异常，确认自动保存暂停、错误可见、原草稿不变、当前编辑不丢失；撤销故障注入后通过用户明确保存恢复。

在两个终端分别运行 `pnpm run dev:react` 和 `pnpm run dev:vue`，第三个终端执行：

```powershell
pnpm run ready
pnpm run test:browser
pnpm run test:interop
pnpm run test:versions
pnpm run test:versions:safety
pnpm run test:multitab
Write-Host "退出码：$LASTEXITCODE"
```

本命令使用现有 Node.js + Chrome/Edge DevTools Protocol，不增加依赖，也不执行设备写入。始终通过隔离浏览器数据目录启动，关闭双标签页后清理临时 profile，不读取/清空用户日常浏览器数据。测试包含故障模拟，**不代表真实磁盘配额耗尽、断电、Tauri WebView2 或跨设备协同已验证**。本批脚本与完整质量链仍需维护者 Windows 实测后才能标记通过。

## V0.3 第八批：服务端工程保存请求契约验收（ADR-0040）

仅新增 Core 的纯输入校验及 9 项单测，不修改 NestJS 路由或引入数据库。维护者在第八批分支的仓库根目录执行：

```powershell
pnpm run test:core
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
```

上一批实际通过 **303 项**单测、本批预计新增 **9 项**，即 **312 项**（以实测为准）。NestJS E2E 另外新增 2 项未开放工程版本读/写路由均返回 404 的安全回归，原有 2 项保持不变，预计共 **4 项 E2E**。须确认 `vp check` 为零警告、两套 Web/NestJS 类型与构建正常。**本批完整质量链尚未在维护者 Windows 执行**，不可沿用此前日志宣称通过。

## V0.3 第九批：工程级权限策略与 PostgreSQL 设计验收（ADR-0041）

第九批只增加 NestJS 目录下的纯权限策略与 **11 项**单元测试，不注册新的 Controller，不安装数据库驱动或创建可执行迁移。维护者在项目根目录执行：

```powershell
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
```

第八批维护者实测 **312/312** 单测、**4/4** 服务端 E2E、零警告及 React/Vue/NestJS 构建通过；第九批预计单测总数为 **323 项**、E2E 仍 **4 项**，以新分支实际执行为准。检查新策略拒绝无身份、越租户、越工程、未知权限，确保服务端工程读写与工业写入路由仍返回 404。**新增测试和当前完整 `ready` 尚未经维护者 Windows 实测**；此阶段 PostgreSQL DDL 只供评审，不能标记数据库迁移已执行。

## V0.3 第十批：PostgreSQL + Prisma 7 首次迁移验收（ADR-0042）

先在本地分支运行 `pnpm install` 生成并核对新依赖的 `pnpm-lock.yaml`。第十批新增了 Prisma 依赖声明，但当前远端环境无法访问 npm 重新计算锁文件；**锁文件未更新前，不得视为可复现的完整交付**。

```powershell
pnpm install
pnpm run deps:check
pnpm run db:validate
pnpm run db:generate
pnpm run ready
Write-Host "质量检查退出码：$LASTEXITCODE"
```

随后仅在已设置根 `.env` 中 `SCADA_DB_USER`、`SCADA_DB_PASSWORD`、`SCADA_DATABASE_URL` 且确认是独立开发数据库时执行：

```powershell
pnpm run db:dev:up
pnpm run db:migrate:deploy
pnpm run db:migrate:status
pnpm run db:dev:down
```

`db:migrate:deploy` 会修改配置的目标数据库；本批绝不自动执行。当前 NestJS 仍只有 `/health`，工程版本接口与设备写入继续返回 404。**目前未实际执行 Prisma 生成、迁移或真实 PostgreSQL CAS 测试**，本批不声称数据库持久化已上线。

### Prisma Client 生成后中文检查与代码质量范围

维护者本地 `pnpm run db:generate` 后，`pnpm run ready` 首次运行在 `messages:check` 阶段报告 1,379 处错误：包括 `.env.example` 中被注释的 `SCADA_DB_PORT=5432`，以及 `apps/server/src/generated/prisma/` 中 Prisma 自身生成的英文注释。检查脚本现在按跨平台路径排除**精确的 Prisma 生成目录**，同时将 `.env.example` 中被注释的变量赋值识别为技术配置指令；Vite+ Format 与 Lint 也排除同一生成目录。项目自有源码中的错误、日志、测试名称与注释依然必须使用中文，绝不批量翻译或手工修改生成代码。

修复后先执行 `pnpm run messages:check` 和 `vp check`，再执行 `pnpm run ready`。该日志只证明前置依赖、共享配置和环境检查通过，**并没有证明本批后续类型检查、单测、E2E、构建或数据库迁移通过**。

### PostgreSQL + Prisma 默认环境配置

仓库根目录 `.env.example` 默认提供 `SCADA_DB_HOST=127.0.0.1`、`SCADA_DB_PORT=5432`、`SCADA_DB_NAME=adui_scada`、`SCADA_DB_USER=adui_scada`，同时填入**公开、仅限本地隔离开发**的测试密码与相匹配的 Prisma URL。复制到本地 `.env` 即可用于独立开发数据库；正式部署前必须同时更换密码和 URL，且密码含特殊字符时须按 URL 规则编码。Prisma CLI 目前只读取完整的 `SCADA_DATABASE_URL`，**不会从其余字段自动生成连接串**；本地 PostgreSQL Compose 使用 `SCADA_DB_USER`、`SCADA_DB_PASSWORD`、`SCADA_DB_NAME`、`SCADA_DB_PORT`，始终仅绑定 `127.0.0.1`。根 `env:check` 已同步识别并核对新默认值；静态校验不会自动连接数据库。数据库迁移仍必须由维护者检查目标 URL 后显式执行。

### 本地 PostgreSQL Compose 根环境文件与端口一致性

维护者在 Windows 使用 `pnpm run db:dev:up` 报告 `SCADA_DB_USER` / `SCADA_DB_PASSWORD` 缺失；截图显示根目录 `.env` 实际已配置。根脚本此前使用 `docker compose -f deploy/docker/compose.postgres.dev.yaml up -d`，Compose 默认项目目录是首个 `-f` 文件所在的 `deploy/docker`，未读取仓库根 `.env`。现改为 `docker compose --env-file .env -f ...` 明确传入根环境文件（`db:dev:up` 先运行 `env:check`），`db:dev:down` 同样显式读取。

维护者将本机 PostgreSQL 端口调整到 **15432**，但此前 Prisma URL 仍为 5432，根 `env:check` 的 Web/Server/SSE 端口默认值也未同步。现保留新默认端口（React 15173、Vue 15174、NestJS 13001、SSE 14178、Vue Docker 18081、PostgreSQL 15432），更新 `.env.example`、默认契约并新增 URL 与主机、端口、库名、用户、密码匹配的静态检查。**本地被 Git 忽略的 `.env` 不会被自动覆盖，维护者须手动将 `SCADA_DATABASE_URL` 端口改为 15432。**

使用最新分支运行 `pnpm run env:check`，再运行 `pnpm run db:dev:up`；可用 `docker compose --env-file .env -f deploy/docker/compose.postgres.dev.yaml ps` 查看状态。只有明确确认目标是隔离开发库时才执行 `pnpm run db:migrate:deploy`。当前仅完成配置修复提交，实际 Windows Docker 启动、质量链及真实 PostgreSQL 迁移尚待复验。

## V0.3 第十一批：Prisma 工程版本事务仓储验证（ADR-0043）

本批不增加第三方依赖，复用已有 `@prisma/client` 7.10.1、`@prisma/adapter-pg`、`pg`、NestJS 和 Vitest；仅给 NestJS 增加共享 Core workspace 依赖，并同步 pnpm 锁文件。Prisma 生成客户端被 Git 忽略，`ready` 与独立服务端构建/类型检查前必须运行 `db:generate`。

```powershell
git fetch origin
git switch feat/v0.3-prisma-version-store
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run ready
Write-Host "质量检查退出码：$LASTEXITCODE"
```

第十批维护者实测单测 **323** 项、NestJS E2E **4** 项；本批新增仓储**14 项单测**，预计共 **337** 项，E2E 仍为 4 项。新增 5 项 PostgreSQL 真实数据库测试**不包含在 `ready`** 内，不可用模拟单测替代真实事务并发验证。

### PostgreSQL 隔离测试库（显式执行，不碰开发业务库）

先确认本机 PostgreSQL 17 已启动、端口为 `15432`，并单独创建 `adui_scada_test`。只在第一次创建时执行：

```powershell
docker compose --env-file .env -f deploy/docker/compose.postgres.dev.yaml exec -T postgres psql -U adui_scada -d postgres -c "CREATE DATABASE adui_scada_test"
```

再在当前 PowerShell 会话中设置**仅指向该测试库**的 URL（复制本地开发 URL 并把数据库名改为 `adui_scada_test`；不要粘贴真实口令到公开日志）：

```powershell
$originalDatabaseUrl = $env:SCADA_DATABASE_URL
$env:SCADA_DATABASE_URL = (Get-Content .env | Where-Object { $_ -match '^SCADA_DATABASE_URL=' } | Select-Object -First 1).Substring(19).Replace('/adui_scada?', '/adui_scada_test?')
$env:SCADA_TEST_DATABASE_URL = $env:SCADA_DATABASE_URL

# 再次自行确认目标是本机 adui_scada_test；该命令将修改测试库 Schema。
pnpm run db:migrate:deploy
pnpm run test:db

if ($null -eq $originalDatabaseUrl) { Remove-Item Env:SCADA_DATABASE_URL -ErrorAction SilentlyContinue } else { $env:SCADA_DATABASE_URL = $originalDatabaseUrl }
Remove-Item Env:SCADA_TEST_DATABASE_URL -ErrorAction SilentlyContinue
```

专用测试对测试数据库采用随机租户 ID，完成后删除测试租户的审计、版本、授权、工程；只允许 `localhost/127.0.0.1` 与数据库名 `adui_scada_test`。此处创建数据库与执行迁移的命令可能改变目标环境，**必须先确认是隔离测试库**。真实事务 CAS、跨租户、篡改读取和审计落库验证状态以维护者实际输出为准，不能预先标记通过。

补充容器验收：执行 `docker compose --env-file .env -f deploy/docker/compose.demo.yaml build server`（以现有 Compose 真实服务名为准）并检查容器运行镜像包含 `/workspace/packages/core/package.json` 与 `src/`。**当前环境未执行 Docker 构建**，不能宣称容器运行时已通过验证。

### 第十一批补充：7 处 Vitest Mock 类型警告与 Navicat 中文注释验收

维护者 Windows 执行 `vp check --fix` 时报告 `apps/server/src/projects/prisma-project-version-store.spec.ts` 有 **7 处** `vitest(require-mock-type-parameters)` 警告，0 错误；本分支对这些 `vi.fn` 增加明确函数泛型，不禁用规则或改变业务逻辑。

维护者在 Navicat 查看发现四张业务表 `scada_projects`、`scada_project_grants`、`scada_project_versions`、`scada_project_audit` 的表和字段注释为空；新增独立迁移 `20261112170000_add_chinese_table_comments`，设置 **4 张业务表、23 个字段、4 个索引**的中文 PostgreSQL 元数据注释，并在 Prisma Schema 中为 **29 个模型属性**补充中文文档说明。**已执行的初始迁移不得回改**，新增迁移对数据和约束不做修改。

```powershell
git status --short
git pull --ff-only
pnpm run db:validate
vp check
pnpm run ready
Write-Host "质量检查退出码：$LASTEXITCODE"
```

确认根 `.env` 指向**隔离开发库** `adui_scada`、而非生产库后，再显式执行：

```powershell
pnpm run db:migrate:deploy
pnpm run db:migrate:status
```

Navicat 刷新连接及表结构后，四张业务表的“注释”和全部字段的“注释”应显示中文。独立 `adui_scada_test` 库也必须先应用**全部迁移**再运行 `pnpm run test:db`（含新增一项真实注释验证），不可在生产数据库运行测试。预期单元测试由 337 增至 **339**（新增 2 项注释静态测试），隔离数据库测试由 5 增至 **6**，NestJS E2E 仍为 4。以上为目标数量，**本修复后的完整 Windows 质量检查与迁移尚未实测**。

### 第十一批补充：NestJS TypeScript TS5097 与 Core Node 条件构建验证

维护者 Windows `pnpm run ready` 在 `pnpm run typecheck:server` 的 `tsc --noEmit` 阶段报告 Core 9 个源码文件共 **23 处 TS5097**；此前 Prisma Client 7.10.1 生成、200 文件格式、86 文件零 Lint/类型警告、Vue/React/Draft Storage 类型检查均已通过。完整 `ready` 最终退出码 1，**后续单测、E2E、文档和构建未执行**，不得记为通过。

修复增加 Core `node` 条件 JS/声明构建，保留 Vue/React 的源码默认出口；没有改动 Core 业务源码及共享 Schema。切换到修复提交后执行：

```powershell
git status --short
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run build:core

# 单独复核这次的阻断点
pnpm run typecheck:server
pnpm run build:server

# 最后执行包含所有检查与构建的完整质量链
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
```

预期 `build:core` 生成 `packages/core/dist/index.js` 和 `index.d.ts`，NestJS 类型检查不再触发 `TS5097` 或工作区外 `TS6059`；Node 产物中的本地导入以 `.js` 结束。可额外在经过确认的 Docker 开发环境执行 `docker compose --env-file .env -f deploy/docker/compose.demo.yaml build server` 复核运行镜像。**修复后尚未在维护者 Windows 执行完整验证**，实际测试结果以新日志为准。

## V0.3 第十二批：真实失败回滚、授权竞态及 Docker 服务端烟测（ADR-0044）

第十一批维护者 Windows 已实测 `ready` 退出码 0（339/339 单测、4/4 NestJS E2E、零告警），独立 `adui_scada_test` 迁移成功且 6/6 项 PostgreSQL 回归通过。本批额外增加普通单测 1 项（预计 **340**）、隔离 PostgreSQL 回归 3 项（预计 **9**），E2E 仍预计 4 项；以上新计数在维护者 Windows 实测前均为**预期值**。

```powershell
git fetch origin
git switch feat/v0.3-transaction-safety-regression
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run ready
Write-Host "完整质量链退出码：$LASTEXITCODE"
```

### 显式隔离 PostgreSQL 测试库

使用已经创建和迁移过的本机 `adui_scada_test`，先确认根 `.env` 的开发库 URL 指向 `127.0.0.1:15432/adui_scada`，再在 PowerShell 中**临时**设置 `SCADA_DATABASE_URL` 和 `SCADA_TEST_DATABASE_URL` 为对应 `adui_scada_test` 的连接地址。可按第十一批的 `try/finally` 模板操作，不把口令贴到终端日志。**不要直接运行缺少显式测试 URL 的 `pnpm run test:db`，更不能将测试 URL 指向 `adui_scada` 或生产库。**

```powershell
# 确认两个环境变量均指向本机独立数据库 adui_scada_test 后执行：
pnpm run test:db
Write-Host "真实数据库测试退出码：$LASTEXITCODE"
```

新增测试会在测试库的随机租户中验证审计 CHECK 约束失败后真实事务回滚、授权撤销事务与保存竞争，以及回环端口不可达时的连接失败与资源释放。不会增删数据库表、约束或迁移，也不操作现有开发业务数据。

### 服务端 Docker 隔离烟测

在 Docker Desktop 正常运行、可以拉取镜像依赖时，执行：

```powershell
pnpm run test:docker:server
Write-Host "服务端容器测试退出码：$LASTEXITCODE"
```

该脚本构建 `adui-scada-server-smoke:local` 镜像并运行一次 `--rm --network none` 的容器，不使用端口映射、数据库 URL 或 Compose 服务。容器内部检查共享 Core 与 Prisma 仓储模块可加载、`GET /health` 为 200、未开放的工程版本读取及工业设备写入为 404，关闭临时 NestJS 实例后退出。**构建可能读取基础镜像和依赖网络**，但运行阶段禁止外部网络；不会关闭或修改你现有的 PostgreSQL 容器。该测试使用的 Docker 镜像标签会保留在本机，可自行清理。

当前远端变更只属于独立 Draft PR。**本批代码质量、真实 PostgreSQL 回滚和 Docker 运行测试尚未在维护者 Windows 验证**，不得宣称通过。

## V0.3 第十三批：可信会话与工程 Guard 验收（ADR-0045）

第十二批已由维护者 Windows 实测 `ready` 退出码 0（340 项单测、4 项 E2E）、独立 PostgreSQL 9 项真库测试及 Docker 隔离烟测通过。第十三批新增 10 项无数据库会话/Guard 单测、2 项隔离 PostgreSQL 会话真实测试和 1 项未开放认证 API E2E；预计 **350 项单测、5 项 E2E、11 项真库测试**。**本批新结果尚未由维护者执行，不能声称通过。**

```powershell
git fetch origin
git switch feat/v0.3-trusted-identity-guard
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
```

Prisma 新增迁移 `20261113000000_trusted_identity_sessions`，首次应用必须先确认当前 `.env` 指向本机隔离开发库 `127.0.0.1:15432/adui_scada`，然后显式执行 `pnpm run db:migrate:deploy` 与 `pnpm run db:migrate:status`；不能修改或重用旧迁移文件。**真实数据库测试仍仅允许本机 `adui_scada_test`**，通过 PowerShell `try/finally` 形式临时设置 `SCADA_DATABASE_URL` 和 `SCADA_TEST_DATABASE_URL` 为测试库 URL，先将新迁移应用到测试库再执行 `pnpm run test:db`，结束恢复两变量，不把真实口令写入 Git。该测试从随机租户创建临时主体/会话并在结束时删除，不会修改开发业务库。

可独立执行 `pnpm run test:docker:server`，验证默认 OIDC 关闭时的镜像仍可加载 NestJS/共享 Core，身份路由、工程 API 和设备写入均不开放。该容器烟测不导入身份模块，因此不连接数据库；它不覆盖 OIDC 显式启用后的身份路由。真实 IdP、生产 HTTPS、身份撤销并发与持久化审计仍待专项验收。

## V0.3 第十四批：Pino / Swagger / Helmet 验收（ADR-0046）

本批接入 `nestjs-pino@5.3.1`、`pino@10.4.0`、`pino-http@11.0.0`、`@nestjs/swagger@12.1.1`、`helmet@8.3.0`、`@nestjs/config@12.0.1` 与开发依赖 `pino-pretty@13.2.0`。维护者已经用 Windows pnpm 12.18.0 正式生成并提交与 Catalog 一致的 `pnpm-lock.yaml`。Pino Pretty 在测试或生产环境均不启用，默认 Swagger 路由不注册；此批不引入对外登录、工程写入或工业控制接口。

```powershell
git fetch origin
git switch feat/v0.3-pino-swagger-security
git pull --ff-only

# 锁文件已正式生成并提交；继续使用冻结安装复验。
pnpm install --frozen-lockfile
pnpm run ready
Write-Host "质量链退出码：$LASTEXITCODE"
```

2026-11-13 Windows 复验：独立 E2E 8/8、退出码 0；完整 `ready` 356/356 单测、8/8 NestJS E2E、219 个文件格式正确、100 个受检文件零错误/警告、62 份 Markdown 检查，Vue/React/NestJS 构建通过，退出码 0。若安装或 Peer Dependencies 报错，仍须按真实输出调整，不允许默认忽略约束。

可在本机测试 Swagger：在 PowerShell 临时设置 `$env:NODE_ENV="development"`、`$env:SCADA_API_DOCS_ENABLED="true"` 并确认 `SCADA_SERVER_HOST=127.0.0.1` 后执行 `pnpm run dev:server`，打开 `http://127.0.0.1:13001/api/docs`（端口以实际 `.env` 为准）。恢复 `SCADA_API_DOCS_ENABLED=false` 或在 `NODE_ENV=production` 启动后文档必须返回 404。文档仅描述 `GET /health`，不要通过 Swagger 测试未开放的工程/设备接口。非回环绑定禁止启用文档。

```powershell
pnpm run test:docker:server
Write-Host "容器烟测退出码：$LASTEXITCODE"
```

容器运行阶段仍为 `--network none`，不映射宿主机端口、不连接数据库或工业网关。该批维护者已在 Windows 验证 Docker 隔离镜像构建与烟测，退出码 0；最新 Pretty 测试隔离补丁仅影响非生产/测试日志选项，Docker 烟测未在该补丁后单独再次执行。安全审计持久化、生产 IAM、登录/MFA、分布式日志保留、RLS 仍待后续批次。

## V0.3 第十五批：服务器根环境变量加载顺序回归（ADR-0047）

本批从已合并第十四批的 `main` 提取服务器启动配置纯函数，并在根 `.env` 加载后动态导入 AppModule，避免 Pino 初始化过早读取日志等级。无需新增 npm 包，也无需重新生成 `pnpm-lock.yaml`；禁止因为这个小修复扩大到认证接口或数据库迁移。

```powershell
git fetch origin
git switch feat/v0.3-server-startup-config
git pull --ff-only
pnpm install --frozen-lockfile

pnpm run env:check
vp check
pnpm run test:e2e:server
pnpm run ready
Write-Host "完整质量链退出码：$LASTEXITCODE"

# 可选：在 Docker Desktop 就绪时验证镜像启动边界。
pnpm run test:docker:server
Write-Host "Docker 隔离烟测退出码：$LASTEXITCODE"
```

2026-11-13 Windows 实测：`env:check` 通过；新增加的 5 项启动配置测试通过，普通单测 **361/361**、NestJS E2E **8/8**；`vp check` 检查 222 个格式文件、102 个受检文件均通过，63 份 Markdown 检查与 React/Vue/NestJS 构建完成，完整 `ready` **退出码 0**。独立 Docker 镜像隔离测试也已通过，**退出码 0**。未运行本批 PostgreSQL 真库回归；默认 Swagger、工程版本读写、登录和工业设备写入接口仍关闭。记录性文档更新后建议复核格式及文档检查。测试运行前不要在终端输出数据库连接串或生产令牌；本批不要求真实数据库连接。

## V0.3 第十六批：安全审计白名单与 Guard 拒绝事件（ADR-0048）

从第十五批合并后的最新 `main` 分支建立独立安全事件 PR。本批不新增第三方依赖、不变更 `pnpm-lock.yaml`、不连接工业设备，也不执行数据库迁移。只针对当前尚未挂载正式 AppModule 的会话 Guard 与工程 ACL Guard 增加固定字段审计诊断记录。

```powershell
git fetch origin
git switch feat/v0.3-security-audit-boundary
git pull --ff-only
pnpm install --frozen-lockfile

vp check
pnpm run ready
Write-Host "完整质量链退出码：$LASTEXITCODE"

# Docker Desktop 可用时执行隔离镜像烟测，不开放宿主机端口。
pnpm run test:docker:server
Write-Host "Docker 验证退出码：$LASTEXITCODE"
```

Windows 已实测普通单测 **367/367** 项、NestJS E2E **8/8** 项，完整 `ready` **退出码 0**；`vp check` 覆盖 225 个格式文件与 104 个受检文件，64 份 Markdown 检查及全部 Web/Server 构建通过。独立 Docker 镜像构建和隔离烟测也已通过，**退出码 0**。重点查看恶意/伪造 Bearer、已撤销会话、无权限及跨租户的审计结果是否只包含枚举，不含令牌或路径。独立 Docker 烟测仍应确认健康路由、未开放登录/工程版本/设备写入保持原有访问边界。本批未执行 PostgreSQL 真库回归；记录性文档提交发生在 Windows 测试之后，合并前可复验 `vp check` 和 `pnpm run docs:check`。未来接入 Zod 等运行时 Schema 工具时，须先更新 Catalog、通过 pnpm 正式生成锁文件并重新执行质量链；不得静默更改已验收的白名单接口。

## V0.3 第十七批：NestJS 12 原生 Standard Schema 与 Zod（ADR-0049）

本批明确使用 `zod@4.6.7`。维护者 Windows 首轮 `ready` 执行到单测阶段中断（370 通过、1 失败，另有一个测试套件在导入 `nest-zod/swagger` 时抛异常）；**该历史记录不是成功验收，修复后完整验收已通过**。现已修复非法 `null` 默认回退，并将适配器测试改为 NestJS 12 自带 `StandardSchemaValidationPipe`、`StandardSchemaSerializerInterceptor` 与 Swagger 12 Standard JSON Schema。正式 AppModule 不引入任何测试路由或全局 Pipe。

```powershell
git fetch origin
git switch feat/v0.3-zod-runtime-config

# 若此前运行 vp check --fix 留有本地修改，先检查并妥善保留。
git status --short
git pull --ff-only

# 以下命令仅用于后续再次修改依赖时重新生成锁文件；本轮已提交正确锁文件。
pnpm install
git diff -- pnpm-lock.yaml
git status --short

# 只在审查锁文件变化后提交，不提交 .env 或本地密钥。
git add pnpm-lock.yaml
git commit -m "chore(deps): 🔒 移除不兼容适配器并同步 Zod 锁文件"
git push origin feat/v0.3-zod-runtime-config

pnpm install --frozen-lockfile
vp check
pnpm run ready
Write-Host "完整质量链退出码：$LASTEXITCODE"

pnpm run test:docker:server
Write-Host "Docker 隔离烟测退出码：$LASTEXITCODE"
```

新增 4 项配置测试和 4 项原生集成测试，维护者 Windows 实测 **375/375 项常规单测和 8/8 项 NestJS E2E**，完整 `pnpm run ready` **退出码 0**；`vp check` 格式 227/227、105 个代码文件零告警或错误，65 份 Markdown 检查及全部应用构建通过。独立 Docker 隔离镜像构建与烟测 **退出码 0**，其冻结依赖安装成功；上轮已通过 pnpm 重新生成并推送删除 `nest-zod` 后的锁文件。记录性文档同步后建议复验 `vp check` 与 `pnpm run docs:check`。容器检查不得映射宿主端口、触碰工业设备或暴露数据库连接串；隔离 PostgreSQL 真库测试本批不要求运行。不得绕过 Peer、手工修改锁文件 integrity 或把未运行的全量测试标记为通过。见 [ADR-0049](adr/0049-zod-server-runtime-validation.md)。

## V0.3 第十八批：Terminus HTTP 就绪与容器安全烟测（ADR-0050）

本批只添加 `@nestjs/terminus@12.1.0`，区分原有存活 `GET /health` 与新增 HTTP 就绪 `GET /health/ready`。不挂载数据库、不连接工业网关、不启用全局 `@nestjs/throttler`。新增 3 项单测和 2 项 E2E，维护者 Windows 已实测 **378/378 单测 / 10/10 E2E**，完整 `ready` **退出码 0**；Docker 隔离烟测也 **退出码 0**。

```powershell
git fetch origin
git switch feat/v0.3-http-readiness-terminus
git status --short
git pull --ff-only

# 新增生产依赖已由维护者通过 pnpm 正式更新锁文件；后续依赖变更仍按此流程。
pnpm install
git diff -- pnpm-lock.yaml
git status --short

# 锁文件已提交；下列示例仅用于后续再次调整依赖时，不要重复提交空更改。
git add pnpm-lock.yaml
git commit -m "chore(deps): 🔒 同步 Terminus HTTP 就绪探针锁文件"
git push origin feat/v0.3-http-readiness-terminus

pnpm install --frozen-lockfile
vp check
pnpm run ready
Write-Host "完整验收退出码：$LASTEXITCODE"

pnpm run test:docker:server
Write-Host "Docker 隔离烟测退出码：$LASTEXITCODE"
```

验收结果：30 个测试文件 378/378 单测、10/10 E2E；`vp check` 231 个文件格式正确、108 个文件零警告/错误，66 份 Markdown 检查和 React/Vue/NestJS 类型检查及构建完成。已由维护者 Windows pnpm 正式更新并提交锁文件；Docker 冻结安装、镜像构建、`--network none` 烟测通过，存活与 HTTP 就绪均为 200，未开放业务接口保持 404。模拟关闭过程触发的 HTTP 503 与 Terminus/Pino 失败日志是**预期负面用例**，测试 10/10 全部通过。当前 HTTP 就绪不能替代 PostgreSQL、报警、网关或 PLC 状态检查；不允许用虚假的依赖成功状态通过探针。后续只追加了验收文档，建议再执行 `vp check` 与 `pnpm run docs:check`。

## V0.3 第十九批：HTTP 连接安全与关闭拒绝测试（ADR-0051）

第十九批基于前十八批已验收基线，使用已有 NestJS 12.0.3 与 Node 24 自带 HTTP Server 选项，不安装第三方中间件、不修改 `pnpm-lock.yaml`。对接收完整请求的时间、请求头数量、Keep-Alive 和单连接最大请求数设定固定限制；启用关闭过程拒绝新请求 503，不启用 `forceCloseConnections`。未对 SSE 响应施加统一时间上限。新增 3 项普通单测和 2 项 E2E；维护者 Windows 已实测 **381/381 单测（31 个文件）、12/12 E2E（2 个文件）**，完整 `ready` **退出码 0**。独立 Docker 镜像构建与隔离烟测 **退出码 0**。

```powershell
git fetch origin
git switch feat/v0.3-http-ingress-shutdown-guard
git status --short
git pull --ff-only origin feat/v0.3-http-ingress-shutdown-guard

# 本批没有新增依赖，必须保持原有 pnpm 锁文件一致。
pnpm install --frozen-lockfile

vp check
pnpm run ready
Write-Host "完整验收退出码：$LASTEXITCODE"

pnpm run test:docker:server
Write-Host "Docker 隔离烟测退出码：$LASTEXITCODE"

git status --short
```

新增 E2E 使用测试内屏障持有 `onModuleDestroy` 生命周期，在未关闭底层 Server 时验证新请求立即 503，然后释放屏障完成关闭；该用例不访问工业设备、不连接真实 PostgreSQL、不对外监听固定端口。重点检查关闭测试是否因未释放 Promise 而超时，禁止通过跳过测试或扩大超时掩盖资源泄漏。Node HTTP `requestTimeout` 只限制接收请求，不应把它误解为应用响应超时或 SSE 心跳限时。

实际验收：Catalog 检查 11 个清单、51 项依赖，中文文案检查 137 个文件；`vp check` 检查 **235 个格式文件全部通过**、111 个受检代码文件无错误/警告，67 份 Markdown 静态检查通过，Core、React、Vue 和 NestJS 的类型检查与构建通过，完整 `ready` **退出码 0**。Docker 镜像执行冻结安装和服务端构建成功，隔离烟测确认 HTTP 接收策略、存活/就绪探针正常且未开放业务接口仍返回 404，**退出码 0**。E2E 中主动模拟关闭时的 Terminus 错误记录与 503 属于成功验证的预期负面用例。真实 Linux SIGTERM、反向代理摘流、PostgreSQL 真库和工业现场验证属于后续范围，不得把这些未验证事项写为已完成。验收后仅修改记录性文档，建议复查 `vp check` 与 `pnpm run docs:check`。

## V0.3 第二十批：Linux 正式服务 PID 1 SIGTERM 回归（ADR-0052）

本批只使用现有 Node 24、NestJS 12、pnpm 与 Docker Desktop Linux 模式，没有新增包、锁文件变更或数据库迁移。在保持现有 `--network none`、无宿主端口映射的第一阶段容器烟测后，第二阶段启动正式服务端 CMD，待回环 HTTP 就绪后发送真实 SIGTERM，并验证进程完成关闭后退出码 0；测试容器在 `finally` 中无条件清理。注意这是正式镜像进程的 Linux 信号测试，仍不等同于完整业务请求排空或工业现场停机验证。

```powershell
git fetch origin
git switch test/v0.3-linux-sigterm-container
git status --short
git pull --ff-only origin test/v0.3-linux-sigterm-container

pnpm install --frozen-lockfile
vp check
pnpm run ready
Write-Host "完整验收退出码：$LASTEXITCODE"

# 该命令现在有两阶段：原隔离烟测 + 正式容器 SIGTERM/退出码验证。
pnpm run test:docker:server
Write-Host "Linux SIGTERM 与 Docker 验收退出码：$LASTEXITCODE"
git status --short
```

第十九批 Windows 已通过 381 项单测与 12 项 E2E；第二十批无新增普通单测/E2E，预计数量不变，本批实际结果尚待维护者验证。失败时优先检查 `docker exec` 回环就绪轮询、`docker stop` 超时或非零退出码，不要跳过第二阶段，不得将 Docker 命令成功与真实 SIGTERM 清理成功混淆。当前身份、工程版本和工业设备写入 API 均未注册，运行日志不得包含生产凭据或现场网络地址。参见 [ADR-0052](adr/0052-linux-sigterm-container-shutdown.md)。

## V0.3 第二十一批：本机只读模拟 Tag、SSE 与访问边界（ADR-0053）

本批新增 2 项访问策略和 4 项模拟服务单测、1 项默认模块 404 E2E、4 项本机模拟 E2E。维护者 Windows 已实测 **389/389 单测（33 个测试文件）、17/17 NestJS E2E（3 个测试文件）**，完整 `pnpm run ready` **退出码 0**；Docker 冻结安装、隔离镜像烟测与正式容器 Linux SIGTERM 测试 **退出码 0**。本轮完整质量链还覆盖了此前追加的 Swagger URL 单测与 `vitest(expect-expect)` 显式断言修复。不变更 pnpm Catalog、锁文件、数据库或 Core Schema。

```powershell
git fetch origin
git switch feat/v0.3-local-readonly-demo-telemetry
git status --short
git pull --ff-only origin feat/v0.3-local-readonly-demo-telemetry

pnpm install --frozen-lockfile
vp check
pnpm run ready
Write-Host "完整验收退出码：$LASTEXITCODE"

pnpm run test:docker:server
Write-Host "Docker 退出码：$LASTEXITCODE"
```

本机交互验收：只有在**自行确认非生产、绑定 `127.0.0.1`** 时，才在根 `.env` 设置 `SCADA_LOCAL_DEMO_API_ENABLED=true`。需要查看 OpenAPI 时，再独立设置 `SCADA_API_DOCS_ENABLED=true`，运行 `pnpm run dev:server`；访问 `/api/dev/demo/project`、`/api/dev/demo/tags` 与 Swagger `/api/docs`，并用浏览器 `EventSource` 或同源网络面板观察 `/api/dev/demo/events` 的 snapshot/delta 和 STALE/GOOD。结束后将开关改回 false，重启确认上述模拟路由全部返回 404。

实际自动验收：`vp check` 对 245 个格式文件、119 个代码文件检查通过，零告警；69 份 Markdown 文档检查通过。访问策略、默认根模块模拟路由 404、受控模拟工程/Tag/Swagger/SSE、STALE 恢复、订阅/定时器清理均由单测/E2E 覆盖。Docker 隔离模式验证正常 HTTP 探针、未开放工程/设备接口 404 与真实 Linux SIGTERM 退出码 0。E2E 中 Terminus 关闭负面用例产生的 HTTP 503 / 错误日志属于预期。仍未执行手工浏览器 Swagger/SSE 交互验证、PostgreSQL 真库、真实工业现场、生产身份授权与多客户端压测；这些不能标记为完成。记录性文档提交后建议复查 `vp check` 与 `pnpm run docs:check`。

## V0.3 第二十二批：共享 Runtime 数据源生命周期回归（ADR-0054）

以维护者已实测的第二十一批 **389 单测、17 E2E** 为基线，本批新增 **4 项固定同源 SSE 适配器测试与 7 项 Runtime 会话边界测试**。维护者 Windows 已实测：**`test:runtime` 21/21（3 个测试文件）**、**全部单测 400/400（35 个文件）**、**NestJS E2E 17/17（3 个文件）**，`vp check` **249 个文件格式正确、122 个源文件零警告/零错误**，完整 `ready` **退出码 0**。Docker 冻结安装、HTTP 安全烟测及正式 Linux PID 1 SIGTERM 退出码回归成功，**Docker 命令退出码 0**。没有新增依赖或锁文件变更，Vue/React、Tauri 与 Nest 正式路由均未改动。

```powershell
git fetch origin
git switch feat/v0.3-runtime-tag-source-adapters
git status --short
git pull --ff-only origin feat/v0.3-runtime-tag-source-adapters

pnpm install --frozen-lockfile
pnpm run test:runtime
vp check
pnpm run ready
Write-Host "完整验收退出码：$LASTEXITCODE"

pnpm run test:docker:server
Write-Host "Docker 退出码：$LASTEXITCODE"
git status --short
```

验收需核对：默认 Vue/React 仍访问同源 `/demo/project` 和 `/demo/events`，项目 JSON 与 Tag 序列/质量未改变；手工页面断线后质量不得维持 GOOD。新 `nest-local` 预设只是固定相对路径，**当前不增设 Vite 代理，不应在浏览器误认为它已可切换到另一台主机**；Nest 本机模拟 API 未显式允许时依然 404。测试新连接必须先 snapshot、禁止首包 delta、停机取消 HTTP 加载与订阅、旧回调不可污染新会话；Vue 与 React 编译成功、桌面离线模拟无网络访问。

本批的自动测试已验证同源预设、安全拒绝、snapshot 首包约束、断连 STALE、请求取消、旧代次隔离和同步订阅失败回收；双 Web 与 NestJS 构建成功。Docker 验证的是正式 NestJS 容器的 HTTP 边界和 SIGTERM，不是浏览器 Runtime 的生产容器集成测试。**尚未收到人工 Vue/React 页面断线演练或 Nest 预设浏览器接入验收**。PostgreSQL 真库、正式发布快照、认证的 Gateway 数据流、SSE 容量/背压及工业现场未在本批验收。若仅文档记录提交后变更，建议复查 `vp check` 和 `pnpm run docs:check`。

## V0.3 第二十三批：模拟 SSE 心跳、传输与 Tag 数据静默（ADR-0055）

第二十二批维护者 Windows / Docker 基线 **400/400 单测、17/17 NestJS E2E**，完整 `ready` 与 Docker SIGTERM 退出码 0。本批新增模拟 SSE heartbeat、15 秒传输静默重建和 12 秒 Tag 数据超时 STALE，新增 **9 项单测**。维护者 2026-11-13 Windows 已实测 **Runtime 专项 29/29（3 文件）、Server 专项 79/79（16 文件）、全量单测 409/409（36 文件）、NestJS E2E 17/17（3 文件）**；`vp check` **251 个格式文件正确、123 个受检文件零警告/错误**，完整 `ready` **退出码 0**。Docker 冻结安装、隔离 HTTP 烟测和正式 Linux SIGTERM **退出码 0**，独立 Docker 测试命令 **退出码 0**。

```powershell
git fetch origin
git switch feat/v0.3-sse-heartbeat-silence-watchdog
git status --short
git pull --ff-only origin feat/v0.3-sse-heartbeat-silence-watchdog

pnpm install --frozen-lockfile
pnpm run test:runtime
vp check
pnpm run ready
Write-Host "完整验收退出码：$LASTEXITCODE"

pnpm run test:docker:server
Write-Host "Docker 退出码：$LASTEXITCODE"
```

自动化重点检查：心跳只保活传输不更新 TagStore；具名事件与原 `snapshot/delta` 不混淆；连续 15 秒传输静默强制重建，已关闭连接不能重建；12 秒无有效 Tag 值会使旧 GOOD/UNCERTAIN 降为 STALE；空 delta 与重复旧序列不刷新数据时间，服务端标记的 STALE 不应被转换成 GOOD；正常数据恢复和网络重连后 snapshot 恢复正确。还应检查 NestJS 订阅/独立模拟服务关闭时清除心跳 timer，旧连接回调失效，工业设备写入仍为 404。

实测 `ready` 还包含 11 个依赖清单与 51 项 Catalog 依赖检查、149 个自有文件中文文案检查、Prisma Client 7.10.1 生成、71 份 Markdown 检查和 Core/双框架/NestJS 类型检查与构建。Docker 验证的是正式服务端镜像 HTTP 安全及 Linux SIGTERM，不代表 Vue/React 浏览器 SSE 断流端到端测试。E2E 中预期的 Terminus 503 负面测试仍全部通过。

仍建议人工启动独立 SSE 与 Vue/React，在浏览器 Network 观察 5 秒 heartbeat、30 秒周期的 STALE 与恢复、完整静默后重新连接；NestJS 只在受控本机非生产环境显式允许时测试，结束还原开关。**尚无人工交互验收记录**；浏览器后台节流、Nginx 长连接、SSE 高并发背压、真实 Gateway 和工业现场仍未验收。本次仅同步验收文档后，建议复查 `vp check` 与 `pnpm run docs:check`。

## 2026-11-13 · V0.3 第二十四批浏览器 SSE 回归入口（Windows 自动化已通过）

本批新增不依赖 Playwright 的本机 Chrome/Edge SSE 回归脚本。首先在三个独立终端启动：

```powershell
pnpm run dev:demo
pnpm run dev:react
pnpm run dev:vue
```

随后在第四个终端运行：

```powershell
pnpm run test:sse:browser
pnpm run test:runtime
vp check
pnpm run docs:check
pnpm run ready
```

脚本只接受回环地址；读取根目录 `.env` 中实际 Web 端口，启动前分别检查页面和 `/demo/project` 是否可用。`fetch failed` 时应先确认三个服务独立运行并检查代理及端口，改进后的脚本会输出失败 URL 与底层错误。使用真实浏览器、现有同源 Vite 代理和原生 EventSource。注入仅屏蔽页面接收的事件回调，验证心跳仍活跃但 Tag 超时、完整事件静默后的自动重连、Vue/React 数据恢复和页面离开后的连接释放。**这不是实际网络故障或 Nginx 半开连接的测试**，更不覆盖工业现场。前台恢复可见性及多 Tag 独立恢复已有 Vitest 回归。维护者 2026-11-13 Windows 实测：**双框架浏览器 SSE 回归退出码 0**、Runtime 32/32（3 文件）、全量单元测试 412/412（36 文件）、NestJS E2E 17/17（3 文件）；`vp check` 253 个文件格式正确、124 个文件无告警或错误，72 份 Markdown 通过，完整 `ready` **退出码 0**。本轮未运行 Docker 增量回归、Nginx 真实断网与多客户端负载；记录性文档提交后建议仅复查格式和文档，不把旧结果视为新文档提交后的重新执行。参见 [ADR-0056](adr/0056-sse-browser-visibility-recovery.md)。

## 2026-11-13 · V0.3 第二十五批 SSE 资源与真实代理回归（待实测）

本批新增 Node 内置测试器的资源单测入口，并纳入根 `pnpm run ready`，无需额外依赖。Windows 上首先执行：

```powershell
pnpm run test:sse:clients
pnpm run dev:demo
```

保持 Demo 在独立终端运行，在另一终端执行：

```powershell
pnpm run test:sse:network
```

如具备本机 Docker Desktop，可由维护者明确启动已有隔离演示栈后验证实际 Nginx 转发：

```powershell
pnpm run docker:demo:up
pnpm run test:sse:proxy
```

两个网络脚本都只访问根 `.env` 给定端口下的 `127.0.0.1`，每条代理做 6 路真实 SSE 流、snapshot、heartbeat、单路 abort 后其余流保活、重新订阅快照及所有测试客户端关闭。它们**不会重启容器或模拟真实半开 TCP**。然后运行 `vp check`、`pnpm run docs:check`、`pnpm run ready` 并记录退出码。当前协作容器内隔离版资源测试 8/8 通过（含真实回环 HTTP 容量检查），网络/格式/完整项目质量链待维护者 Windows/Docker 实测。参见 [ADR-0057](adr/0057-local-sse-capacity-and-proxy-validation.md)。

### 第二十五批 Windows Docker Nginx 代理端口漂移（2026-11-13）

维护者实际执行了 `pnpm run test:sse:clients`：Node 资源测试 **8/8 通过**；`pnpm run test:sse:network`：本机 `127.0.0.1:14178/events` 六路快照、具名心跳、单路断开隔离及重订阅通过，**退出码 0**。`pnpm run docker:demo:up` 已完成四个镜像构建，Demo 和 NestJS 容器为 Healthy，React/Vue 容器已启动。

但 `pnpm run test:sse:proxy` 在首个 React 代理入口 `127.0.0.1:18080/demo/events` 返回 **ECONNREFUSED，退出码 1**，没有运行到 Vue 代理。Docker Desktop 显示实际宿主机发布端口为 React `8080`、Vue `8081`；维护者根目录 `.env` 则配置 `18080`、`18081`。检查发现 Docker 演示脚本的 Compose 命令缺少显式 `--env-file .env`，且 `scripts/check-env-config.mjs` 与 Compose 内端口回退值同根模板存在漂移。

本批补丁仅修复 Docker 配置读取：演示栈 `up/down/logs` 与新增 `ps` 命令统一显式加载仓库根 `.env`；Compose 四组端口回退值同步为根 `.env.example` 默认值；`env:check` 强制验证脚本及四组默认值，防止再次静默降级到旧端口。**没有修改 SSE 服务、NestJS 或 Vue/React 业务代码，也未执行 Docker 或重启维护者计算机上的容器。**

维护者同步分支后，建议在仓库根目录执行 `pnpm run env:check`、`pnpm run docker:demo:up`、`pnpm run docker:demo:ps` 和 `pnpm run test:sse:proxy`；`docker:demo:ps` 的宿主机端口应分别显示 `127.0.0.1:18080->8080/tcp` 和 `127.0.0.1:18081->8080/tcp`。如仍不一致，需检查 PowerShell 是否存在 `SCADA_REACT_PORT`/`SCADA_VUE_PORT` 同名进程环境变量覆盖；切勿粘贴完整 `docker compose config --environment`，其中可能包含凭据。修复后的 Windows Docker Nginx 代理烟测、`vp check`、`docs:check` 和完整 `ready` 尚未实测。

### 第二十五批 Windows Docker 代理复验结果（2026-11-13）

维护者已使用 `docker compose --env-file .env -f deploy/docker/compose.demo.yaml` 完成四个镜像构建和容器启动，`docker:demo:ps` 验证 React `127.0.0.1:18080->8080/tcp`、Vue `127.0.0.1:18081->8080/tcp` 端口映射准确。Demo/Server 均 Healthy。React/Vue 两条 Nginx `/demo/events` 的各六路 SSE 测试均包含 snapshot、heartbeat、断开隔离和重订阅快照，`pnpm run test:sse:proxy` **退出码 0**。此前已确认 `pnpm run test:sse:clients` **8/8 通过**、`pnpm run test:sse:network` **退出码 0**。

本轮 `pnpm run env:check` 已通过；**尚缺本批最新提交的 `vp check`、`pnpm run docs:check`、`pnpm run ready` 验收结果**。仍不代表已覆盖真实代理半开或生产环境安全。

### 第二十五批 Windows 完整质量链最终复验（2026-11-13）

维护者上传 PowerShell 实测日志，针对本批已修复代码确认：

- `vp check`：**257 个文件格式正确**，127 个受检文件**无警告、Lint 错误或类型错误**，命令退出码 **0**。此前 9 条类型感知 Lint 警告均已消除。
- `pnpm run docs:check`：**73 份 Markdown 文档通过**，退出码 **0**。
- `pnpm run ready`：**退出码 0**。依赖检查 **11 个清单、51 项 Catalog**，共享配置 9 个 TSConfig 消费端，中文文案 153 个自有文件，根环境与 LF 检查通过；Prisma Client **7.10.1** 生成成功。
- 全量 Vitest **412/412 通过（36 个文件）**；纳入 ready 的 SSE Node 专项 **8/8 通过**，含真实回环 HTTP 32 路容量、第 33 路 HTTP 503 和释放后重新订阅。
- NestJS E2E **17/17 通过（3 个文件）**，包含预期的服务关闭负面检查；日志中的 HTTP 503 / `Health Check has failed!` 属于通过的故障场景，不是失败。
- Vue、React、NestJS 类型检查与构建全部通过。
- 结合此前维护者独立网络日志：`test:sse:network` 实际六路 HTTP SSE 通过、退出码 0；`test:sse:proxy` 在 React `18080` 与 Vue `18081` 的 Docker Nginx 双入口通过、退出码 0，Demo 与 Server 为 Healthy。

**自动化验收结论：第二十五批 Windows 完整质量链及 Docker Nginx SSE 代理专项均通过。** 注意本段验收记录追加后尚未再次执行最新文档的格式与静态检查，建议合并审查前运行 `vp check`、`pnpm run docs:check`。仍未验证真实 Nginx 半开连接、持续高并发/慢消费者长期负载、生产认证、PostgreSQL 真库和工业现场设备；不能把本机 Demo 资源上限视为工业 SLA。PR #47 继续 Draft，待维护者明确同意后才能合并。

## 2026-11-13 · V0.3 第二十六批真实 TCP 字节静默与 SSE 持续测试（待验收）

本批在根质量链新增 `pnpm run test:sse:fault:unit`，使用 Node 原生 HTTP/TCP 检查只监听 127.0.0.1 的测试代理。维护者 Windows 验收：

```powershell
pnpm run test:sse:fault:unit

# 分别在独立终端保持运行：
pnpm run dev:demo
pnpm run dev:react
pnpm run dev:vue

# 浏览器必须安装 Chrome/Edge
pnpm run test:sse:fault:browser
pnpm run test:sse:soak

# 本机 Docker 演示栈已运行后：
pnpm run docker:demo:ps
pnpm run test:sse:fault:proxy
pnpm run test:sse:soak:proxy

vp check
pnpm run docs:check
pnpm run ready
```

`test:sse:fault:browser` 与 `test:sse:fault:proxy` 启动临时 TCP 回环代理，阻断单个 SSE 的真实下行字节，但保持 socket 开放；要求 12 秒旧数据 STALE、15 秒传输静默后重新订阅恢复，退出页面后无遗留 SSE socket。两条 `soak` 命令以六路连接累计至少 12 次新心跳和真实 delta 进行有限时长观测，不进入根 ready。测试不停止或重启 Docker，也不访问远端/生产设备。协作容器仅完成故障代理模块 3/3 实测；Windows 双框架、Docker 和质量链未完成，详见 [ADR-0058](adr/0058-tcp-sse-fault-and-soak-tests.md)。

### 第二十六批首轮 Windows 浏览器与 Lint 反馈（2026-11-13）

维护者已启动 `dev:react`（`127.0.0.1:15173`）和 `dev:vue`（`127.0.0.1:15174`），均显示 Vite+ Ready。运行 `pnpm run test:sse:fault:browser` 后，**React 的真实 TCP 下行阻断、STALE、主动重连和连接回收通过**；Vue 在注入前断言失败：`故障注入前必须只有一条有效 SSE TCP 流`（实际 **0 !== 1**），因此整条命令退出码 1，**不能标记为双框架通过**。`vp check --fix` 反馈 129 个受检文件 **0 errors、1 warning**：浏览器脚本 `recovered` 变量未使用，并已运行格式修复。

**已定位代码根因：** 测试专用 TCP 故障代理原先仅用 socket 的第一条 HTTP 请求行决定是否为 SSE；浏览器可能复用 Keep-Alive 连接，先获取 Vue 页面资源，再在同一 socket 上请求 `/demo/events`，从而出现 UI 已经 live、代理 `activeSseCount() === 0` 的分类遗漏。该结论来自代理实现缺陷；当前日志没有直接抓到 Vue 每个 socket 的请求顺序，故不将复用行为描述为已经抓包证实。

**本分支定向修正：** TCP 代理对同一个下游连接持续识别后续的 `GET /demo/events`/`GET /events` 请求行，使用最多 256 字节尾部缓存跨 TCP 分块解析，不改变普通流的转发规则。新增第 4 条 Node 回归，用同一个 `http.Agent({ keepAlive: true, maxSockets: 1 })` 确认同一 socket 先访问 `/health`、再访问 `/demo/events`，随后可以冻结真实 SSE 字节且完成连接回收。浏览器脚本要求页面恰有一条有效 EventSource 且测试代理恰有一条 SSE socket，稳定 400ms 才故障注入，消除初次页面加载时的判断竞态；`recovered` 现参与同源订阅路径一致性断言，修复未使用变量警告。

**修复后验证状态：** 代码通过静态 JavaScript 语法解析，协作环境的独立 Node 22 Keep-Alive 实验复现成功，但**没有在完整仓库执行修改后的四项 Node 单测、双框架真实 Chrome/Edge、`vp check` 或 `pnpm run ready`**。维护者需同步分支后重跑 `pnpm run test:sse:fault:unit`、`pnpm run test:sse:fault:browser`、`vp check`、`pnpm run docs:check`、`pnpm run ready`；Docker 专项与持续长连接仍独立待测。

只更新测试工具和验收文档，没有改动共享 Runtime、Core、Vue/React 页面或生产服务；PR #48 继续 Draft，不经明确授权不合并。

### 第二十六批第二轮 Windows 双框架与完整质量链复验通过（2026-11-13）

维护者上传最新 PowerShell 日志证实：`pnpm run test:sse:fault:browser` 分别打印 **React 和 Vue 真实 TCP 下行阻断、STALE、主动重连及连接回收通过**，浏览器测试退出码 **0**。此前 Vue 的 `0 !== 1` SSE socket 分类失败已由 Keep-Alive 复用识别及稳定就绪判断修复；本轮不再复现。

`vp check` 实测 **260 个文件格式正确，129 个受检文件零警告、零错误，退出码 0**；此前 `recovered` 未使用变量告警已经消除。`pnpm run docs:check` **74 个 Markdown 文件通过**。`pnpm run ready` **退出码 0**，包括依赖检查 11 个清单/51 项 Catalog、9 个 TSConfig 消费端、155 个自有文件中文文案检查、根环境与 LF 检查、Prisma Client 7.10.1 生成、Vue/React/NestJS 类型检查和构建。全量 Vitest **412/412（36 文件）**、Node SSE 连接资源专项 **8/8**、Node TCP 故障代理专项 **4/4**（含同一 Keep-Alive socket 的后续 SSE 请求）、NestJS E2E **17/17（3 文件）**。

E2E 中的 HTTP 503 / `Health Check has failed!` 属于主动模拟服务不可用的预期负面测试，不代表 E2E 失败。

**仍待独立验收：** `pnpm run test:sse:fault:proxy`（Docker Nginx 双框架故障注入）、`pnpm run test:sse:soak` 与 `pnpm run test:sse:soak:proxy`（六路持续心跳及增量）。本批实际故障注入为本机测试代理阻断 TCP 下行字节，不等同真实 Nginx 半开、长时高并发、生产鉴权、PostgreSQL 真库或工业现场验收。

本次仅提交验收文档，**文档提交后的 `vp check` 与 `docs:check` 尚未重新执行**。PR #48 保持 Draft、Assignee `@adui-dev`，没有收到明确合并授权。

### 第二十六批最终 Docker TCP 故障与持续连接验收通过（2026-11-13）

维护者提供最新 Windows PowerShell 日志，本批剩余 **3 条专项测试全部通过，均退出码 0**：

- `pnpm run docker:demo:ps`：本机演示栈 Demo、NestJS Server 均 `healthy`；React 宿主机映射 `127.0.0.1:18080->8080/tcp`，Vue `127.0.0.1:18081->8080/tcp`，与统一根 `.env` 一致。该日志不代表更改或重新部署 Docker。
- `pnpm run test:sse:fault:proxy`：**React/Vue Docker Nginx 双框架均通过**真实 TCP SSE 下行静默注入、Tag STALE、主动重连、快照恢复和连接回收，**退出码 0**。
- `pnpm run test:sse:soak`：独立 Demo `127.0.0.1:14178/events` 六路流通过首包快照、具名心跳、单路断开隔离、新快照，随后每路持续至少 **12 次心跳和有效增量**、连接清理通过，**退出码 0**。
- `pnpm run test:sse:soak:proxy`：Docker Nginx 的 React `18080/demo/events` 与 Vue `18081/demo/events` 两入口各六路全部通过上述持续事件与连接回收验证，**退出码 0**。
- 专项完成后再次执行 `vp check`：**260 个文件格式正确、129 个受检文件零警告零错误，退出码 0**；`pnpm run docs:check`：**74 份 Markdown 文件通过，退出码 0**。

结合前轮维护者实测，双框架开发环境 `test:sse:fault:browser` **退出码 0**，完整 `pnpm run ready` **退出码 0**：全量 Vitest **412/412（36 文件）**、Node SSE 资源 **8/8**、Node TCP 故障代理 **4/4**、NestJS E2E **17/17（3 文件）**，双框架和 NestJS 类型检查、构建通过。**第二十六批本机 Windows/Docker 自动化验收项已全部通过。**

**范围限制：** 真实被阻断的是本机测试代理内的 TCP SSE 下行字节，未直接模拟真实 Nginx 宕机、物理断网、工业网关故障。有限六路持续观测不是长期高并发/慢消费内存背压或生产 SLA，生产鉴权、PostgreSQL 真库与现场设备仍未验收。本次仅追加验收记录，**最新文档提交后的 `vp check` 与 `docs:check` 尚未重新执行**；建议合并前再做一次静态复查。PR #48 继续 Draft，未经维护者明确授权不得合并。

## 2026-11-13 · V0.3 第二十七批共享 Runtime 诊断专项（待 Windows 实测）

在项目根目录按下列顺序运行：

```powershell
pnpm run test:runtime
vp check
pnpm run docs:check
pnpm run ready
```

单独保持 `pnpm run dev:demo`、`pnpm run dev:react`、`pnpm run dev:vue` 三个终端运行，再执行 `pnpm run test:sse:browser` 和 `pnpm run test:sse:fault:browser`，并手动分别查看 React/Vue 运行监控页“实时链路诊断”区域：状态、断连过程、最近有效更新时间、观测时数据年龄、四种质量数量须与 Tag 面板一致；部分 Tag 恢复不应错误清除其他 STALE。桌面离线模拟诊断应保持断连次数为零，不需要连接工业设备。本次没有新增生产网络/后端接口。上述测试结果等待维护者实测，不得预先标记通过。详见 [ADR-0059](adr/0059-runtime-local-diagnostics.md)。

### 第二十七批 Windows 完整质量链与双框架浏览器复验通过（2026-11-13）

维护者上传 PowerShell 日志，确认本批新增诊断与既有 SSE 能力在 Windows 仓库工作区通过：

- `pnpm run test:runtime`：**退出码 0**；其中新增 `packages/runtime/test/diagnostics.test.ts` **5/5 通过**，共享 Runtime、TagSource 与离线 Runtime 测试通过。
- `vp check`：**263 个文件格式正确，131 个受检文件零警告、Lint 错误与类型错误，退出码 0**。
- `pnpm run docs:check`：**75 个 Markdown 文件通过，退出码 0**。
- `pnpm run ready`：**退出码 0**；依赖 11 个清单/51 项 Catalog、9 个 TSConfig 消费端、157 个自有代码或配置文件中文文案检查、根 `.env` 与 LF 检查通过；Prisma Client **7.10.1** 生成成功。
- 全量 Vitest：**417/417（37 个文件）**；其中 Runtime 诊断测试 5/5。
- Node SSE 连接资源专项：**8/8**；TCP 故障代理专项：**4/4**。
- NestJS E2E：**17/17（3 个文件）**。其中主动模拟关闭的 HTTP 503 / Terminus Health Check 失败日志属于预期负面测试，不是失败。
- Vue、React、NestJS 类型检查及构建全部通过；日志显示 React 3899 个模块、Vue 3844 个模块完成构建，NestJS 服务端构建完成。
- `pnpm run test:sse:browser`：React、Vue 的 SSE 心跳、Tag 过期、静默重连和资源清理通过，**退出码 0**。
- `pnpm run test:sse:fault:browser`：React、Vue 的真实 TCP 下行阻断、STALE、主动重连和连接回收通过，**退出码 0**。该浏览器脚本同时检查诊断面板存在、四档质量总数与可见 Tag 数一致、STALE 统计和重连过程计数。

**本批 Windows 自动化质量链与双框架浏览器回归通过。** 浏览器自动化断言已覆盖诊断面板的数据一致性；维护者尚未单独报告手工视觉验收或 Tauri 桌面人工验收，因此不将两项标记为完成。

诊断的 `dataAgeMs` 仍只代表本机接受有效 Tag 后经过的时间，不是 PLC 采样延迟或网络 RTT；`reconnectCount` 是去重后的连续断连过程数，不是实际 TCP 重建计数。生产认证、真实工业网关、PostgreSQL 真库、历史诊断持久化及工业现场尚未验收。

本段为验收记录追加后，**尚未重新执行最新文档的 `vp check` / `docs:check`**；建议合并审查前再运行一次。PR #49 继续保持 Draft，Assignee `@adui-dev`，未经明确授权不得合并。

## 2026-11-13 · V0.3 第二十八批状态事件时间线验收（待实测）

保持共享 Runtime 只读与 Vue/React 对等，在 Windows 项目根目录依次执行：

```powershell
pnpm run test:runtime
vp check
pnpm run docs:check
pnpm run ready
```

在其他终端运行 `pnpm run dev:demo`、`pnpm run dev:react`、`pnpm run dev:vue` 后执行：

```powershell
pnpm run test:sse:browser
pnpm run test:sse:fault:browser
```

浏览器回归须在 React/Vue 同时检查首次 `live`、过期 `stale`、断连 `reconnecting` 和恢复 `live` 的状态事件顺序；页面最多显示 20 条。Tauri 模拟单元测试检查历史不随每秒刷新增长，重新启动会话清零。**本批尚未完成维护者 Windows 和浏览器实测**，自动化不能替代人工 UI 与真实工业现场。见 [ADR-0060](adr/0060-runtime-session-status-history.md)。

### 第二十八批 Windows 双框架 SSE 浏览器回归（2026-11-14）

维护者提供 PowerShell 实测日志，当前分支针对第二十八批状态时间线功能执行：

- `pnpm run test:sse:browser`：React `127.0.0.1:15173` 与 Vue `127.0.0.1:15174` 均输出“浏览器 SSE 心跳保活、Tag 过期、静默重连、资源清理通过”，**明确退出码 0**。脚本额外断言共享状态时间线初始 live、Tag 过期 stale、传输静默 reconnecting 与快照恢复 live，以及会话内事件上限。
- `pnpm run test:sse:fault:browser`：React/Vue 两端均输出“真实 TCP 下行阻断、STALE、主动重连及连接回收通过”。提供的输出到此结束，**未附 `Write-Host "TCP 故障退出码：$LASTEXITCODE"`**，因此只确认两端成功信息及脚本未输出错误，**暂不记录该命令的实际退出码**。

**仍待 Windows 实测**：`pnpm run test:runtime`、`vp check`、`pnpm run docs:check`、完整 `pnpm run ready`；以及手工 UI 和 Tauri 桌面验证。上述浏览器测试不能证明 Node/Vitest、Lint、类型、全量构建、真实工业网络、生产报警持久化已完成。

本次仅补充验收文档与 PR 说明，无业务代码变更。新增文档提交后的格式及文档静态检查仍待执行；PR #50 保持 Draft，需维护者明确授权方能合并。

## 2026-11-14 · V0.3 第二十九批 Tag 定义目录验收（待 Windows 实测）

```powershell
pnpm run test:unit
pnpm run test:runtime
vp check
pnpm run docs:check
pnpm run ready
```

保持 `dev:demo`、`dev:react`、`dev:vue` 在独立终端运行，分别打开两套 Studio，选择水箱、水泵和流量文本图元，检查 Tag 候选展示数据类型/单位/描述、绑定仍保存原有稳定 `tagId`。再执行：

```powershell
pnpm run test:sse:browser
pnpm run test:sse:fault:browser
```

本批新增 Core 单测覆盖定义目录、重命名稳定 ID、类型错误原子拒绝、未定义 Tag 拒绝及质量独立；Runtime 测试覆盖在线消息类型不匹配时进入错误状态。**当前协作环境未执行 Windows pnpm 工作区，全部验收待维护者实测**。本机演示目录不含设备地址、持久化或工业网关。见 [ADR-0061](adr/0061-tag-definition-catalog.md)。

### 第二十九批 Windows 完整质量链复验通过（2026-11-14）

维护者上传最新完整 PowerShell 日志，确认此前 React JSX 分支解析错误与 `TagStore` 的 `TS1294` 参数属性错误已消除；`pnpm run ready` 已从头执行至最后的 NestJS 构建并返回 **退出码 0**：

- 单独 `pnpm run test:unit`：**426/426 通过（38 个文件），明确退出码 0**。其中新增 `tag-definition.test.ts` **6/6**，包括定义校验、稳定 ID、重命名、原子拒绝及动态质量。
- 单独 `pnpm run test:runtime`：**40/40 通过（4 个文件），明确退出码 0**。其中 `diagnostics.test.ts` **8/8**，包含错误值类型被 Runtime 拒绝的回归。
- `vp check`：**267 个文件格式正确、133 个受检文件零警告、Lint 错误或类型错误**；`pnpm run docs:check`：**77 个 Markdown 文件检查通过**。
- `pnpm run ready`：**退出码 0**；依赖 Catalog **11 个清单 / 51 项**、共享配置 **9 个 TSConfig 消费端**、环境/LF、中文文案 **159 个自有文件**、Prisma Client **7.10.1**、Core Node 构建、React/Vue/草稿存储与 NestJS 类型检查均通过。
- `ready` 中全量 Vitest 再次 **426/426（38 文件）**，Node SSE 连接资源 **8/8**、TCP 故障代理 **4/4**、NestJS E2E **17/17（3 文件）**，React **3900 个模块**和 Vue **3845 个模块**完成构建，NestJS 服务端构建结束。
- E2E 日志中预期的 HTTP 503、Health Check 失败由负面测试产生，不代表 E2E 失败；最终 **17/17 通过**。

**尚待本批专项实测**：React/Vue Studio 手工检查水位/水泵/流量 Tag 的类型、单位、描述和绑定撤销/导入导出，以及 `pnpm run test:sse:browser` 与 `pnpm run test:sse:fault:browser`。本轮 `ready` 不包含浏览器测试。Tauri 桌面人工测试、项目级 Tag 持久化、工业驱动、真实设备和工业现场同样不在本批已验证范围。

以上是**维护者 Windows 实测日志**，不是当前协作环境自行执行的结果。本次只新增验收文档记录；**最新文档提交后的 `vp check` / `docs:check` 尚未再次执行**。PR #51 保持 Draft，Assignee `@adui-dev`，未经明确授权不合并。

### 第二十九批 Windows 双框架 SSE 浏览器与最新静态检查通过（2026-11-14）

维护者在第二十九批 Tag 目录类型校验修复后再次执行本机检查，实际日志确认：

- `vp check`：**267 个文件格式正确，133 个受检文件零警告、Lint 错误和类型错误**。
- `pnpm run docs:check`：**77 个 Markdown 文件静态检查通过**。
- `pnpm run test:sse:browser`：React `http://127.0.0.1:15173`、Vue `http://127.0.0.1:15174` 均输出 SSE 心跳保活、Tag 过期、静默重连和资源清理通过，**退出码 0**。
- `pnpm run test:sse:fault:browser`：React/Vue 均输出真实本机 TCP 下行阻断、STALE、主动重连与连接回收通过，**退出码 0**。

结合上一轮完整 `pnpm run ready` **退出码 0**、全量 Vitest **426/426**、Runtime **40/40**、NestJS E2E **17/17**，本批自动化质量链及双框架 SSE 专项已得到 Windows 实测通过。

**未验收内容**：React/Vue Studio 手工检查三项演示 Tag 的类型、单位、描述、稳定 ID、绑定撤销、工程导入导出；Tauri 桌面人工回归；项目级 Tag 持久化、真实工业协议和现场设备。浏览器 SSE 通过不等于 Studio Tag 管理 UI 已人工确认。

本次仅更新验收文档及 PR 正文，不改变业务代码。**上述日志对应文档更新前的分支；最新验收文档提交后的 `vp check` / `docs:check` 尚未重跑**。PR #51 保持 Draft，指派 `@adui-dev`，未经维护者明确授权不得合并。

## V0.3 第三十一批 · 项目 Tag 管理浏览器回归

在根目录 .env 配置的本机开发端口启动当前分支 dev:demo、dev:react 和 dev:vue 后，执行 pnpm run test:tags:browser。该命令通过现有 Chrome/Edge CDP 验收设施检查双框架项目 Tag 新建、编辑、绑定删除保护、删除及工程 JSON 导出，未涉及设备连接或写入。仍需执行 vp check、pnpm run ready 与 pnpm run test:interop；脚本通过不等于人工 UI 和历史草稿完整验收。

## V0.3 第三十二批 · 旧工程迁移浏览器回归

启动当前分支的 dev:demo、dev:react、dev:vue 后执行 pnpm run test:legacy:browser。该命令通过现有 Chrome/Edge CDP 测试设施，在两个 Web Origin 分别构造 0.2.0 localStorage 草稿、IndexedDB 草稿和 Project Snapshot，并通过真实 Studio UI 验证迁移结果。测试只使用临时浏览器用户目录，不访问用户真实 Profile。执行前需确保当前根 .env 的 React/Vue 端口对应当前分支服务。

## V0.3 第三十三批 · OIDC 身份路由与工程 API

阶段 B 已在功能分支实现固定 Issuer Discovery、登录事务、授权码回调、BFF Cookie/CSRF Guard，以及 start/callback/me/logout HTTP Controller；Controller E2E 使用 Mock 服务，不访问真实 IdP 或 PostgreSQL。OIDC 默认关闭，只有配置完整并显式启用时才挂载身份模块。工程 API 仍未实现。真实 PostgreSQL 测试必须显式设置 SCADA_TEST_DATABASE_URL，且仅允许本机 adui_scada_test 隔离数据库。未配置真实 Issuer 时只运行 Mock 自动化，不得宣称完成企业 IdP 联调。

### 第三十三批阶段 A 最小验证指令

`pnpm run env:check`、`pnpm run db:validate`、`pnpm run db:generate`、`vp check`、`pnpm run test:unit`、`pnpm run test:e2e:server`、`pnpm run docs:check`、`pnpm run ready`。验证实际增量迁移时仅允许本机隔离测试数据库，并检查 PostgreSQL COMMENT 元数据。认证 Controller 的 E2E 使用 Mock；真实 OIDC 登录需另配 Issuer、TLS、回调注册和身份映射，工程 API 当前仍未开放。

## 第三十三批 · PostgreSQL OIDC 迁移隔离验收

OIDC 迁移真实测试单独使用 `pnpm run test:db`，不纳入默认 `ready`。测试入口会拒绝非本机地址或数据库名不是 `adui_scada_test` 的 URL。运行前先由维护者创建该独立数据库，再在当前 PowerShell 进程中将 `SCADA_DATABASE_URL` 和 `SCADA_TEST_DATABASE_URL` 都显式设置为该测试库连接串，依次执行：

```powershell
pnpm run db:validate
pnpm run db:migrate:deploy
pnpm run db:migrate:status
pnpm run test:db
```

迁移与测试均不得指向普通开发数据库 `adui_scada` 或生产数据库。测试结束后恢复/清理当前 PowerShell 的临时环境变量。OIDC Schema 测试核对迁移登记、外部身份及登录事务表、15 个字段、外键、约束、索引和中文 PostgreSQL COMMENT。真实迁移未执行前不得标记阶段 A 数据库验收通过。

### 第三十三批阶段 B · OIDC 身份 HTTP 路由验证边界

- `pnpm run test:e2e:server` 已包含 `test/oidc-auth.controller.e2e-spec.ts`，验证 start/callback/me/logout 路由、浏览器绑定 Cookie、Session/CSRF Cookie、Origin/Fetch Metadata、Bearer 兼容与默认 AppModule 404。
- 该 E2E 使用 Mock 登录事务、回调和会话服务，不会访问真实 IdP、PostgreSQL 或工业设备；通过只代表 HTTP 路由与 Guard 编排回归。
- 默认 `SCADA_OIDC_ENABLED=false` 时启动原有 AppModule，不连接 PostgreSQL、不注册身份路由。显式启用 OIDC 时，必须提供完整 Issuer/Client/Redirect/Origin/事务密钥和数据库配置；启动后会加载 ScadaIdentityModule 并连接 PostgreSQL。
- 真实启用前必须由维护者完成 Windows `vp check`、`test:unit`、`test:e2e:server`、`docs:check` 和完整 `ready`；随后另行验收真实 IdP/JWKS、HTTPS 终止代理、Secure/SameSite Cookie 与外部身份预绑定。当前工程 API 和工业设备写入仍未开放。

### 第三十三批 · 全新隔离空库迁移与二次部署验证

此专项与已通过 22/22 的 `adui_scada_test` 事务测试**相互独立**。使用 Navicat 在本机开发 PostgreSQL 中人工创建一个**此前从未使用过的空数据库**（例如 `adui_scada_fresh_20261116`），账号与根目录 `.env` 的本机开发连接相同。不允许使用原有 `adui_scada` 或 `adui_scada_test`，也不要删除/清空任何旧库；如果名称已存在、非空，改用新的受控名称。

在仓库根目录 PowerShell 运行：

```powershell
node --test scripts/verify-fresh-postgres-migrations.cases.mjs
if ($LASTEXITCODE -ne 0) { throw "全新空库目标校验单测失败" }
node scripts/verify-fresh-postgres-migrations.mjs adui_scada_fresh_20261116
Write-Host "全新空库迁移退出码：$LASTEXITCODE"
```

脚本不会修改根 `.env`，只在子进程中临时设置 `SCADA_DATABASE_URL`，且仅允许从本机 `adui_scada` 派生、名称以 `adui_scada_fresh_` 开头的隔离库。开始前必须连接目标库并证实不存在用户对象和自定义 Schema；发现非空、账号/地址/端口不匹配或迁移异常则立即失败。首次迁移应得到全部四项成功记录和预期业务表；第二次必须成功且迁移记录保持不变。脚本**不会创建、重置、删除数据库**，执行后保留空库供维护者在 Navicat 检查。已有库不能用于重新证明首次安装，复测需要另建新的空库。

如果当前 PowerShell 曾临时将 `SCADA_DATABASE_URL` 指向 `adui_scada_test`，应先恢复到 `.env` 中的开发连接或清除临时变量；脚本会主动拒绝从测试库继续派生，不能为了通过检查而放宽地址或数据库名称限制。验证脚本通过也不能代替生产迁移评审、真实 IdP/HTTPS 或工业现场安全验收。补丁应用后运行 `vp check`、`pnpm run docs:check` 和 `pnpm run ready`，以实际退出码为准。

#### 2026-11-16 真实空库验收与 E-015 子进程安全回归

维护者已经在 `adui_scada_fresh_20261116` 完成四项迁移首次部署及二次部署验证，脚本退出码 0；该数据库目前**不再为空库**，不得重复用它运行全新空库验证。初次运行出现 Node.js `DEP0190`，旧版 Windows `pnpm.cmd` 配合 `shell: true` 传参存在安全隐患。新脚本直接使用当前已安装的 Prisma CLI JS 入口和 `process.execPath`（`shell: false` 为默认值），仅允许固定的 `migrate deploy/status` 子命令，保留本机地址、数据库名、Schema 和空库安全校验。

合并前维护者需先在 Windows 执行 `vp check`、`node --test scripts/verify-fresh-postgres-migrations.cases.mjs`、`pnpm run docs:check` 和完整 `pnpm run ready`。如要验证新子进程调用行为，必须再人工创建一个**全新、未使用过**的 `adui_scada_fresh_*` 本机空库并运行脚本，确认两次迁移成功、退出码为 0、没有 `DEP0190`。不能清空、重置或覆盖现有已验收的空库；脚本继续不负责数据库创建或删除。

#### E-015 Windows 修复复验结果（2026-11-16）

维护者已在第二座独立空库 `adui_scada_fresh_20261116_b` 验证新启动方式：四项 `migrate deploy` 首次全部应用、第二次无待执行迁移、`migrate status` 最新、迁移元数据一致、脚本退出码 0，且**未再出现 Node.js DEP0190**。此前在 `adui_scada_fresh_20261116` 的首次迁移结果仍保留，两座库都不允许重复作为“全新空库”测试目标，复测应另建新名称。Windows 质量链 `vp check`、`docs:check`、`ready` 及目标校验 6/6 均已通过；新文档提交后的静态文档校验仍需另行复验。当前 Prisma 7.10.1 不因 8.0.0 RC 更新提示自动升级。

### 第三十三批第七小批：共享 API Client 质量门禁

新增 `packages/api-client/src/index.ts` 与 `packages/api-client/test/api-client.test.ts`。客户端与 Vue/React 无运行时耦合，也没有服务端 JWT 或密码。先验证真实工作区依赖与锁文件，再跑 Mock Fetch 测试和全量质量链：

```powershell
pnpm install --lockfile-only
pnpm install --frozen-lockfile
pnpm run deps:check
pnpm run config:check
vp check
pnpm run typecheck:web
pnpm run test:unit
pnpm run docs:check
pnpm run ready
Write-Host "最终退出码：$LASTEXITCODE"
```

新增 Mock Fetch 测试由根 `vite.config.ts` 统一收集，根 `typecheck:web` 包含 `@adui/scada-api-client`。若安装重写了 `pnpm-lock.yaml`，应以 pnpm 12.18.0 实际生成的内容为准，并检查是否只产生预期的工作区链接变更。原有 Core、NestJS、React/Vue TypeScript 6、测试、中文文案及工业安全门禁不得降低。此测试**不调用真实工程 API，不更改数据库、不执行工业写入**；真实 HTTPS 浏览器 Cookie、Origin/CSRF、同源代理及 React/Vue 工程互通另行验证。

### 第三十三批第八小批：双框架服务端工程保存与草稿保护验收

两个 Studio 新增“服务端工程”独立入口，和已有“保存草稿”“版本历史”分离。提交前须在仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
vp check
pnpm run typecheck:web
pnpm run test:unit
pnpm run test:browser
pnpm run test:versions:safety
pnpm run docs:check
pnpm run ready
Write-Host "最终退出码：$LASTEXITCODE"
```

单测应包含新增 `packages/api-client/test/studio-session.test.ts` 的 9 项：首次创建、存在工程但未载入最新修订号、CAS 冲突、身份切换、并发重复提交及旧基线清理。浏览器自动化原有 `test:browser`、`test:versions:safety` 只能证明本地画布和 IndexedDB 回归，**不能代替真实云端保存测试**。

现场/开发联调前必须由维护者明确配置可信 IdP、回调与本机同源 HTTPS/代理，并在**独立测试租户、测试工程及非生产数据库**执行。验收顺序：React/Vue 各自检查登录；创建服务端工程（必须有有效 CSRF Cookie）；刷新服务端历史；显式载入最新版本；追加 CAS 历史；由另一会话推进修订号后验证 409；模拟 401、403、404、网络中断及代理 HTML 响应；验证操作失败时当前画布、IndexedDB 草稿、自动保存开关和 JSON 导入/恢复行为未被篡改。旧版云端历史载入只用于编辑与比较，不允许直接用旧修订号覆盖服务器最新版。两端互通必须比较同一 ScadaDocument 的内容、修订号及 SHA-256；未配置 IdP 时不开放匿名创建或写入。

**当前尚无此真实 OIDC + HTTPS 浏览器专项结果**，不得将 Mock Fetch 或本地 IndexedDB E2E 记为服务端端到端成功。工业网关、PLC/DCS 写入、正式发布、回滚审批均不属于本批。

### 第三十三批第九小批：受控本机 HTTPS /api/v1 代理与 OIDC 联调

**默认模式完全不变**：SCADA_OIDC_DEV_HTTPS_ENABLED=false，React/Vue 仍为现有 HTTP Demo，/demo 代理与离线数据不改变。首先在默认模式执行：

```powershell
node --test scripts/oidc-https-dev-proxy.cases.mjs
if ($LASTEXITCODE -ne 0) { throw "HTTPS 代理配置测试失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "仓库质量检查失败" }
pnpm run env:check
pnpm run docs:check
pnpm run test:browser
pnpm run ready
Write-Host "最终退出码：$LASTEXITCODE"
```

真实 HTTPS 与 OIDC 联调前，维护者须先在**隔离的本机非生产环境**准备：可信 HTTPS IdP 和预注册的机密客户端、回调地址、本地已由可信流程预绑定且 active 的测试主体、独立的 PostgreSQL 测试数据，以及浏览器信任的 SAN 包含 127.0.0.1 的本机 TLS 证书。证书/私钥放在仓库外，绝不能提交、输出或放进 VITE_*；不使用浏览器忽略证书验证选项，也不自动创建身份/租户。

根 .env 的**非秘密**联调示例（证书路径为占位符，真实凭据单独安全配置）：

```dotenv
SCADA_WEB_HOST=127.0.0.1
SCADA_SERVER_HOST=127.0.0.1
SCADA_SERVER_PORT=13001
SCADA_REACT_DEV_PORT=15173
SCADA_VUE_DEV_PORT=15174
SCADA_OIDC_ENABLED=true
SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=false
SCADA_LOCAL_DEMO_API_ENABLED=false
SCADA_OIDC_DEV_HTTPS_ENABLED=true
SCADA_OIDC_DEV_HTTPS_CERT_FILE=<本机证书绝对路径>
SCADA_OIDC_DEV_HTTPS_KEY_FILE=<本机私钥绝对路径>
SCADA_OIDC_WEB_ORIGINS=https://127.0.0.1:15173,https://127.0.0.1:15174
SCADA_OIDC_REDIRECT_URI=https://127.0.0.1:15173/api/v1/auth/oidc/callback
```

SCADA_OIDC_ISSUER、SCADA_OIDC_CLIENT_ID、SCADA_OIDC_CLIENT_SECRET、SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY 必须遵循现有 OIDC 严格配置，在本机秘密环境中正确填写。真实回调只能精确注册一个 Origin（上例选择 React 15173），登录先从 React 发起，再用相同 127.0.0.1 主机名打开 Vue 15174；Host-only Cookie 不按端口隔离，不能将一端改为 localhost。两个 HTTPS Origin 都必须在服务端白名单中。若需要将 Vue 作为回调端，须重新注册并审核固定回调 URI，不接受请求动态指定。

运行既有 dev:server、dev:react、dev:vue 脚本，浏览器分别使用 https://127.0.0.1:15173/ 和 https://127.0.0.1:15174/。先验证未登录 /api/v1/auth/me 返回 401 且 Content-Type 不是 HTML，再经真实 IdP 完成回调；确认会话 Cookie 带 Secure/HttpOnly/SameSite=Lax/Path=/，CSRF Cookie 保持可读但同样 Secure，且均无 Domain。POST 应由浏览器自动附加精确 Origin、Sec-Fetch-Site: same-origin 与当前 CSRF Cookie 对应的 X-SCADA-CSRF。不要在截图、Git 提交、测试日志中暴露 Cookie、授权码或 Token。

使用**非生产测试租户和工程**验证 React 创建首版 → Vue 查询版本并载入最新快照 → Vue CAS 追加 → React 显式载入最新版本 → 另一会话推进后的 409 拒写及 IndexedDB 草稿保护。另验证 401/403/404、无效 CSRF、网络断开、代理返回 HTML 的错误边界。比对 ScadaDocument、版本修订号和 SHA-256，不执行工业设备写入/正式发布。默认 Vite 浏览器自动化使用 HTTP URL；在专项 HTTPS 模式下不能把它当作真实登录/工程往返证据。测试后恢复默认关闭开关与普通 Demo 环境。

**当前仅新增受控配置及其 10 项 Node 安全测试；真实 Windows Vite+、TLS、IdP、HTTPS Cookie 和双框架服务端往返仍待维护者执行。**

### 第三十三批第十小批：OIDC HTTPS 同源匿名只读探针

本专项先验证 React/Vue 两个独立 HTTPS Origin 是否将固定 `/api/v1/auth/me` 请求送达启用 OIDC 的 NestJS，并确认**未登录**时得到现有安全 Guard 返回的 `401 application/json`（受控中文错误），而不是 Vite 的 HTML 回退、302 跳转或连接失败。

离线安全测试**无需证书、数据库或 IdP**，已经进入默认 `ready`：

```powershell
pnpm run test:oidc:https:readonly
if ($LASTEXITCODE -ne 0) { throw "HTTPS 匿名只读探针安全测试失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "代码质量检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run ready
Write-Host "最终退出码：$LASTEXITCODE"
```

真实网络检查**必须独立执行**。在仓库外准备受信任的本机 TLS 证书及私钥（证书 SAN 包含 IP `127.0.0.1`），按上一节配置可信 OIDC Issuer、精确注册回调、双 Origin 与隔离数据库；保留 `SCADA_OIDC_ENABLED=true`、`SCADA_OIDC_DEV_HTTPS_ENABLED=true`，关闭不安全回环及模拟 API 开关。分别启动：

```powershell
pnpm run dev:server
pnpm run dev:react
pnpm run dev:vue
```

上述三条命令应在**三个终端**运行。然后在第四个终端执行：

```powershell
pnpm run verify:oidc:https:readonly
if ($LASTEXITCODE -ne 0) { throw "真实本机 HTTPS 匿名只读检查失败" }
```

探针只对已登记的两套 `https://127.0.0.1:<端口>` 发起 GET，不发送 Cookie、不跟随重定向，不接受 HTTP/跨站地址，不访问工程写接口；Node.js 将正常验证 TLS 链和主机名。若证书未被 Node 信任，应修复本机信任链或在受控环境中配置 Node 的可信 CA，**禁止** `NODE_TLS_REJECT_UNAUTHORIZED=0`、`--insecure`、禁用身份 Guard 或为通过探针伪造 IdP。探针错误仅打印受控中文说明，不输出密钥、Cookie 或授权码。

**判定范围**：两个来源均返回预期的匿名 401 JSON，仅说明本机 TLS 连接、Vite API 代理和 NestJS 未登录拒绝路径连通；不代表真实 OIDC 登录、Cookie/CSRF、权限与跨框架工程版本互通成功。完成后恢复默认关闭的联调开关，不对生产数据库运行测试。

#### 第十小批真实探针失败：安全诊断和实际前置条件（2026-11-16）

维护者 Windows 已完成离线质量链：HTTPS 探针 9/9、OIDC 代理配置 10/10、`vp check` 310/168 零警告、Vitest 529/529、NestJS E2E 40/40、完整 `ready` 退出码 0。但单独的 `pnpm run verify:oidc:https:readonly` **退出码 1**。该命令不是默认 `ready` 的一部分，不能在缺少 HTTPS/OIDC 配置或服务未启动时预期通过。

修正后的 CLI 对已审核的配置错误、端口未监听、证书 SAN/证书链/过期和握手失败输出固定中文类别；未知错误只输出泛化描述，不展示原始异常、凭据、证书路径、Cookie 或 Token。**实际网络根因仍需根据复测消息判断**，不允许为完成联调禁用证书校验或认证。

在运行真实探针前，由维护者自行确认根目录 `.env`（不要粘贴任何秘密值）：`SCADA_OIDC_ENABLED=true`、`SCADA_OIDC_DEV_HTTPS_ENABLED=true`、`SCADA_WEB_HOST=127.0.0.1`、`SCADA_SERVER_HOST=127.0.0.1`、React/Vue 独立端口、精确双 HTTPS Origin 白名单、固定预注册回调；`SCADA_OIDC_ALLOW_INSECURE_LOOPBACK=false` 与 `SCADA_LOCAL_DEMO_API_ENABLED=false`。提前从仓库外准备 SAN 包含 `127.0.0.1` 的可信证书，并确保 Node.js 信任签发 CA；真实 OIDC Issuer/机密客户端、事务密钥和隔离非生产 PostgreSQL 必须已配置，NestJS/React/Vue 三套服务须分别运行且启动成功。不假定 `ready` 会自动启动这些服务。

```powershell
git rev-parse --short HEAD
pnpm run test:oidc:https:readonly
if ($LASTEXITCODE -ne 0) { throw "HTTPS 探针安全单测失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "代码质量门禁失败" }
pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "完整质量链失败" }
```

之后在**另一个终端**对已启动的三个联调服务运行：

```powershell
pnpm run verify:oidc:https:readonly
Write-Host "真实 HTTPS 探针退出码：$LASTEXITCODE"
```

如果提示配置或 TLS 故障，应修正本机可信配置后再测；如果是 `ECONNREFUSED` 映射的服务未监听，应检查三套进程是否正确启动及实际绑定端口；如果收到非 401 JSON，应检查同源反向代理和 NestJS OIDC 模块。**不得**通过 `NODE_TLS_REJECT_UNAUTHORIZED=0`、忽略证书、硬编码令牌或将 `SCADA_OIDC_ENABLED=false` 与匿名写入混合来规避故障。

### 第三十三批 · 本机 OIDC Lab 单命令 Docker 依赖栈（候选，待 Windows 验证）

为解决“复制根目录 .env 即可恢复日常开发”与“本机可信 OIDC 联调需要独立依赖”两种需求，现有 `.env.example` **仍默认关闭** `SCADA_OIDC_ENABLED` 和 `SCADA_OIDC_DEV_HTTPS_ENABLED`；复制即可继续运行普通 HTTP React/Vue/NestJS/Demo。新增三个仅本机使用的端口：`SCADA_LAB_KEYCLOAK_PORT=18443`、`SCADA_LAB_POSTGRES_PORT=15433` 和 `SCADA_LAB_REDIS_PORT=16379`。不要用这些示例值代替生产部署配置。

在 Windows PowerShell 7 进入仓库根目录（仅首次没有 `.env` 时执行复制；已有自定义配置必须先备份，不覆盖）：

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
mkcert -install
pnpm run docker:lab:up
if ($LASTEXITCODE -ne 0) { throw "本机 OIDC Lab Docker 启动失败" }
pnpm run docker:lab:ps
```

`docker:lab:up` 先运行 `scripts/prepare-oidc-lab.mjs`：检查根目录回环地址与端口、确认非生产模式；在被 Git 和 Docker 构建上下文忽略的 `.local/oidc-lab/` 生成本机 IP SAN 证书以及四个随机值（独立的 PostgreSQL 密码、Keycloak 管理员密码、OIDC 机密客户端 Secret、事务加密密钥），以只允许本机访问的文件保存，不打印秘密或私钥。脚本复用已有凭据，若出现不完整文件则拒绝自动覆盖。证书使用本机 `mkcert` 创建，不自动修改系统 CA 信任；首次需人为执行 `mkcert -install` 并批准系统信任。若已在其他目录生成证书，Lab 会维护自己的本机测试副本，不会修改或覆盖原证书。

新 Compose：`deploy/docker/compose.oidc.lab.yaml`，项目名称固定为 `adui-scada-oidc-lab`；包含**独立的** PostgreSQL 17、Redis 7.4 与 Keycloak 26.8.2。PostgreSQL 创建 `adui_scada_oidc_lab` 和仅供 Keycloak 的 `adui_scada_keycloak_lab` 两个数据库；Keycloak 首次启动自动导入 `adui-scada` Realm 和机密 `adui-scada-bff` Client，固定 HTTPS 回调为 React `/api/v1/auth/oidc/callback`，启用标准授权码流与 PKCE S256，禁用隐式流、密码直授及用户自助注册。**不创建或自动授权业务测试用户**，也不修改现有 PostgreSQL/Demo 数据卷。Redis 此阶段只是可选后续依赖，NestJS 尚未使用它。Keycloak 的 `start-dev` 与 Redis 回环无认证端口仅供受控本机联调，不可直接用于生产。

启动成功后访问 `https://127.0.0.1:18443/admin/`，管理用户名为 `admin`；首次管理员密码仅位于本机 `.local/oidc-lab/secrets.env` 的 `SCADA_LAB_KEYCLOAK_ADMIN_PASSWORD`。其值严禁提交、拍照或发到聊天。Keycloak 真实 Discovery 路径为 `https://127.0.0.1:18443/realms/adui-scada/.well-known/openid-configuration`。修改端口后以 `.env` 的实际数值为准。

```powershell
# 测试依赖与离线保护用例（不调用真实数据库）
pnpm run test:oidc:lab
pnpm run env:check
pnpm run docs:check

# 查看或关闭：保留所有数据卷
pnpm run docker:lab:ps
pnpm run docker:lab:logs
pnpm run docker:lab:down
```

**重要边界**：本命令只负责启动身份认证及数据依赖，不能自动判定 SCADA 本地账户/租户或授权工程。要继续真实 OIDC，必须通过维护者受控流程将 `SCADA_DATABASE_URL` 指向已确认的独立 Lab 测试数据库并完成 Prisma 迁移；在根 `.env` 安全填写真实的 Keycloak Client Secret、随机事务密钥、实验室 Issuer、固定回调、证书绝对路径；确认外部 Keycloak `sub` 与服务端 `scada_external_identities` 的预绑定有效，再显式开启两个 OIDC/HTTPS 开关。不要为了“快速登录”直接写生产数据库、创建匿名权限、跳过 CSRF 或自动添加有写权限的主体。真实 OIDC/Cookie 与跨框架工程联调仍待验收。

正式部署的目标为**一个 ADui SCADA 应用镜像**（前端双版本静态资源及 NestJS 统一交付），但数据库、Redis、IdP 与工业网关仍是可独立升级与持久化的外部服务；这份本机 Lab Compose 不是正式单镜像交付，也不是已经实现的生产方案。

### 第三十三批 · E-018 OIDC 根模块启动和 HTTPS 匿名探针复验（2026-11-16）

维护者在真实 Keycloak/独立 Lab PostgreSQL 准备完成后启动 NestJS，发现 `ProjectApiModule` 使用的 `ScadaSessionGuard` 无法注入 `ScadaSecurityAuditService`，导致服务端未监听 13001、双 Web 的 `/api/v1` 同源代理连接被拒绝。修复仅补齐身份模块对工程 Guard 的跨模块依赖导出，新增真实 OIDC 模块编译 E2E，不直接连接任何生产或 Lab 数据库。

本地更新功能分支前请确认当前分支和工作树；不要因数据库已经完成四项迁移而重新创建、删除或重置任何 Docker 数据卷。维护者在 Windows 运行：

```powershell
git status --short
git pull --ff-only
pnpm run test:unit
if ($LASTEXITCODE -ne 0) { throw "单元测试未通过" }
pnpm run test:e2e:server
if ($LASTEXITCODE -ne 0) { throw "OIDC 模块装配 E2E 未通过" }
vp check
if ($LASTEXITCODE -ne 0) { throw "格式、Lint 或类型检查未通过" }
pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "完整质量链未通过" }
```

在 WebStorm 重启 `dev:server`（保留 `NODE_USE_SYSTEM_CA=1`、已配置的 Lab OIDC），确认不再报 `UnknownDependenciesException` 且监听回环 13001；随后重启 `dev:react`/`dev:vue` 并在**独立 PowerShell 终端**运行：

```powershell
Get-NetTCPConnection -LocalPort 13001 -State Listen
$env:NODE_USE_SYSTEM_CA = "1"
pnpm run verify:oidc:https:readonly
Write-Host "真实 HTTPS 匿名探针退出码：$LASTEXITCODE"
```

两个 Web Origin 都必须得到未登录的 401 JSON，不能用禁用 Guard、跳过 CSRF、忽略 TLS 证书、匿名开写或修改现有 OIDC 事务密钥来让检查通过。该探针通过仍不代表真实 Keycloak 用户已预绑定或浏览器登录成功；身份绑定、Cookie 和 React↔Vue 工程 CAS 另行验收。维护者此前将本机 DB/OIDC 测试秘密粘贴到对话，需单独进行受控轮换，绝不能在 issue/commit/日志引用原值。

### 第三十三批 · E-018 真实 HTTPS 匿名路径结项与后续身份专项

2026-11-16 维护者 Windows 已完成以下事实验证：OIDC 根模块及全部身份/工程路由真实启动、`127.0.0.1:13001` 监听；`test:e2e:server` 42/42、`vp check` 315/171 零告警、完整 `ready` 530/530 单测及其余阶段通过；`verify:oidc:https:readonly` 从 React/Vue 两个 HTTPS Origin 检查到受控匿名 401 JSON，**退出码 0**。E-018 审计依赖注入失败已关闭，不得再将旧的 `ECONNREFUSED` 描述为当前阻塞。

**下一专项：实际身份绑定与完整登录，仅在维护者明确选择的隔离 OIDC Lab 内操作。** 使用 Keycloak `adui-scada` Realm 创建独立、无管理权限的测试用户；保留真实 OIDC `iss` 与 `sub`，不得凭邮箱/用户名推断可信身份或自动提升工程 ACL。先按仓库当前 Prisma 表模型核对已存在的测试主体与租户，以受控管理流程显式建立 `issuer + sub` 对应的外部身份绑定，并确保业务主体状态为 active；联调应检验未绑定主体被拒绝。通过浏览器 `/api/v1/auth/oidc/start` 发起标准授权码 + PKCE 登录，不允许直接手动访问 callback 作为登录操作。再逐项验证 Secure/SameSite Cookie、Origin/Fetch Metadata/CSRF、未授权操作拒绝、React/Vue 双端工程历史与 CAS 409，不保留令牌/授权码/私钥日志。不对现有 Lab 数据卷使用 `down -v`，不操作生产数据库或设备写入。

用户曾在对话贴出本机 Lab 的数据库与 OIDC 密钥，在后续受控联调前应轮换并同步依赖配置，避免只修改 `.env` 造成 Keycloak Client 或 PostgreSQL 凭据不一致。**本次仅归档证据，不自动轮换、不创建用户、不写入数据库、不将 302 误判为登录成功。**

### 第三十三批第十三小批：真实 Keycloak 用户与 OIDC Lab 显式身份预绑定

**前置条件**：已在维护者 Windows 实测 Keycloak `adui-scada` Realm Discovery 200、NestJS OIDC 根模块启动、隔离 Lab 数据库迁移成功及 React/Vue 匿名 HTTPS `401 JSON`（两个 Origin、退出码 0）。本小批提供**只在本机隔离 Lab 内可执行**的可信身份预绑定工具；默认仅预览，既不创建 Keycloak 用户也不自动授权工程，不修改 Prisma Schema/迁移。其他数据库、生产 OIDC 和外部主机均直接拒绝。

**1. 在 Keycloak 管理后台人工创建普通测试用户**：登录 `https://127.0.0.1:18443/admin/`，选 `adui-scada` Realm → Users → Add user，建立独立无管理员角色的测试账号，设置自己的测试密码（不要与管理员或正式账号复用）。进入该用户详情页确认真实 `ID`（Keycloak 的 UUID / OIDC `sub`，不是用户名/邮箱）；确认用户启用，且不要给其添加管理角色。首次 `master` 临时管理员仅供初始化，不应给业务用户使用。绝不将 UUID、口令或任何密钥粘贴到 PR、日志或聊天。

**2. 默认只读预览**：确保当前终端和 WebStorm 使用仓库根 `.env` 的可信 Lab 配置，`SCADA_DATABASE_URL` 精确指向 `127.0.0.1:${SCADA_LAB_POSTGRES_PORT}/adui_scada_oidc_lab`，OIDC Issuer 为 `https://127.0.0.1:${SCADA_LAB_KEYCLOAK_PORT}/realms/adui-scada`，双 Web HTTPS 及回调精确登记；不允许 `NODE_TLS_REJECT_UNAUTHORIZED=0` 或 `NODE_ENV=production`。先核对迁移状态，不要重新迁移或清库。

```powershell
pnpm run db:migrate:status
pnpm run test:oidc:identity
if ($LASTEXITCODE -ne 0) { throw "身份预绑定离线安全测试失败" }

# 本机交互读取 Keycloak Users 详情页的 User ID，不写入脚本或 Git。
$keycloakSub = Read-Host "输入已核对的 Keycloak 测试用户 UUID"
$bindingArgs = @("--tenant", "lab-tenant", "--subject", "lab-engineer", "--keycloak-sub", $keycloakSub)

node scripts/oidc-lab-identity.mjs @bindingArgs
if ($LASTEXITCODE -ne 0) { throw "身份预绑定只读预览失败，禁止写入" }
```

预览将检查硬编码隔离数据库与 Issuer、已完成的 OIDC 迁移、Keycloak `issuer+sub` 是否已经绑定他人、本地主体是否停用、是否已有其他外部身份或工程 ACL；所有预览路径均回滚事务。**本命令不使用 Keycloak Admin API 验证用户存在，UUID 必须由维护者从实际用户详情页核对。**

**3. 显式提交，绝不自动授予工程权限**：仅当维护者核实上述 UUID 与租户/主体的绑定意图后运行下列命令。工具将以可串行化的 PostgreSQL 事务创建（或复用）`scada_identities` 中的 `active` 测试主体，并插入唯一 `scada_external_identities(issuer,subject,tenant_id,subject_id)` 映射；不创建任何 `scada_projects` / `scada_project_grants`，重复相同映射不重复插入，已有其他 ACL/身份冲突或其他异常必须失败并回滚。此操作确实写入**隔离 Lab**，默认 `ready` 不会调用它。

```powershell
node scripts/oidc-lab-identity.mjs @bindingArgs --apply --confirm-lab adui_scada_oidc_lab
if ($LASTEXITCODE -ne 0) { throw "本机测试主体预绑定失败" }
```

**4. 真实浏览器登录与会话检查（需人工验证，尚未自动化）**：在 React HTTPS 原点访问 `https://127.0.0.1:15173/api/v1/auth/oidc/start`（不能直接访问 callback），使用上述非管理员 Keycloak 测试用户登录。成功登录后，访问同源 `/api/v1/auth/me`，预期仅返回 `authenticated: true` 和核对过的 `lab-tenant / lab-engineer`，不包含会话明文。浏览器开发者工具仅核对 Cookie 属性，不复制值：`__Host-adui-scada-session` 应为 `Secure; HttpOnly; SameSite=Lax; Path=/`，`__Host-adui-scada-csrf` 应为 `Secure; SameSite=Lax; Path=/` 且可读；两者不应以明文进入业务响应 JSON 或持久存储。校验未绑定普通用户登录失败、会话失效、无 CSRF Header 的同源 POST 拒绝、跨站 Origin/Fetch Metadata 拒绝及合法同源注销。**仅 302 响应不代表完成这些验证。**

**安全边界**：当前工具并不自动查验 Keycloak 用户或授予其工程读取、版本追加权限；`/api/v1/projects` 的访问结果还取决于既有 ACL，不应通过默认授予权限来使 UI 可见。此前用户曾把本机 Lab 密钥放入对话，需另行按 Keycloak Client/数据库密码、`.env` 与容器实际密码同步轮换，不使用 `docker compose down -v`。本小批只提供候选实现，Windows `vp check`、`ready`、真实数据库写入及完整登录都应独立验收，不接触生产或工业设备。

### 第三十三批 · 唯一 ADui SCADA Docker 项目与安全迁移（最新配置）

旧 `docker:demo:*`、`docker:lab:*`、`docker:all:*` 与 `db:dev:*` 命令已移除，旧 Compose 配置也不再维护。唯一配置为 `deploy/docker/compose.yaml`、名称为 `adui-scada`，**7 个服务、1 个 PostgreSQL 实例**。Keycloak 和 SCADA 仍分别保留现有两个逻辑数据库 `adui_scada_keycloak_lab` 与 `adui_scada_oidc_lab`，不会通过配置整合自动合并数据或重命名。

旧的存储卷必须保留，直到有可核验的数据备份及单独迁移流程；卷中包含已经完成的 Keycloak 登录测试与 SCADA 身份映射。**统一项目名称并不需要改旧物理卷名**。历史开发库 `15432` 的卷不再挂载新服务，但不会自动删除。

```powershell
git status --short
git pull --ff-only
pnpm run test:docker
if ($LASTEXITCODE -ne 0) { throw "Docker 安全回归失败" }
pnpm run env:check
if ($LASTEXITCODE -ne 0) { throw "环境检查失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "完整质量检查失败" }

# 切换前必须确认 Keycloak/SCADA 的 PostgreSQL 逻辑备份可恢复
pnpm run docker:plan
if ($LASTEXITCODE -ne 0) { throw "数据卷或配置预检失败，禁止切换" }

# 显式一次性删除旧 Compose 的已核验容器，不删除卷
pnpm run docker:migrate
if ($LASTEXITCODE -ne 0) { throw "统一项目迁移失败，勿删卷" }
pnpm run docker:ps
```

之后统一使用 `pnpm run docker:up`、`docker:ps`、`docker:logs`、`docker:down`；`down` 不删除数据卷。若旧项目容器仍存在，普通 `docker:up` 必须拒绝，要求显式 `docker:migrate`。迁移过程中可能有短暂中断；若启动新栈失败，保留卷并排查，绝不通过 `down -v` 或删除卷来“修好”数据库。

切换后应检查 Docker Desktop 只有 `adui-scada` 项目组，`docker:ps` 的七项服务、Keycloak Discovery 200、原 `adui` 业务主体仍可认证、Prisma 迁移最新、React/Vue 开发 HTTPS 会话一致与 Docker HTTP Demo SSE。生产单应用镜像、Secure Cookie/CSRF 和工业安全不因本次迁移自动通过验收。

### 2026-11-16 · 最新 Docker 安装步骤（覆盖历史旧卷迁移说明）

维护者已删除原有三个 Docker 项目及全部旧卷，且没有数据库备份。这次**不再执行 `docker:migrate`**，也不允许把旧项目/旧身份数据当成存在。唯一的新 Compose 项目为 `adui-scada`，一个 PostgreSQL 17 容器内有 `adui_scada` 和 `adui_scada_keycloak` 两个逻辑数据库。物理数据卷由最新项目自动创建，名称为 `adui-scada_postgres-data`、`adui-scada_redis-data`。

在 Docker Desktop 已启动、mkcert 安装且受信任、pnpm 依赖已经安装的 Windows PowerShell 中执行：

```powershell
git status --short
git pull --ff-only
pnpm run test:docker
if ($LASTEXITCODE -ne 0) { throw "Docker 安全测试失败" }
pnpm run test:docker:db
if ($LASTEXITCODE -ne 0) { throw "数据库初始化安全测试失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "代码质量检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "工程质量链失败" }

# 原 .env 含曾经暴露的凭据，先在本机备份再覆盖；不要打印备份内容。
if (Test-Path .env) {
  Copy-Item .env (".env.backup." + (Get-Date -Format yyyyMMddHHmmss))
}
Copy-Item .env.example .env -Force
pnpm run docker:plan
if ($LASTEXITCODE -ne 0) { throw "本机新 Docker 预检失败" }
pnpm run docker:up
if ($LASTEXITCODE -ne 0) { throw "本机 Docker/Prisma 初始化失败" }
pnpm run docker:ps
```

`docker:up` 使用新 `.local/docker/` 生成独立随机密码和 mkcert TLS，启动七容器、初始化 Keycloak 数据库及 Realm，然后将 Prisma 迁移部署到新 `adui_scada` 数据库。`docker:db:init` 可安全重复迁移（绝不调用 reset）。日常使用 `docker:up/ps/logs/down`，`down` 只停止容器不删卷。

由于历史库无备份，原 Keycloak 普通用户、原 OIDC 可信主体、会话和工程数据不再自动有效。后续必须重建测试用户并显式预绑定，再重新做 OIDC HTTPS 登录、两框架会话、Cookie/CSRF 和工程版本回归。Docker HTTP Demo 18080/18081 不等同于受控 HTTPS 认证界面。

### 2026-11-16 · 全新 Docker PostgreSQL 宿主端口统一为 15432（当前有效）

唯一 `adui-scada` Compose 内部 PostgreSQL 仍监听 `5432`，仅将宿主发布端口从 `127.0.0.1:15433` 改为 **`127.0.0.1:15432`**。根 `.env.example` 的 `SCADA_DB_PORT` 与 `SCADA_LAB_POSTGRES_PORT` 同步为 `15432`；`scripts/docker-stack.mjs`、`scripts/init-docker-db.mjs` 和安全测试默认值同步，业务库及账号继续为 `adui_scada`。历史迁移验证所记录的旧端口不代表当前配置。

```powershell
git status --short
git pull --ff-only
pnpm run test:docker
if ($LASTEXITCODE -ne 0) { throw "Docker 端口安全测试失败" }
pnpm run test:docker:db
if ($LASTEXITCODE -ne 0) { throw "数据库初始化安全测试失败" }
pnpm run test:oidc:lab
if ($LASTEXITCODE -ne 0) { throw "本机凭据和端口校验失败" }
pnpm run test:oidc:identity
if ($LASTEXITCODE -ne 0) { throw "OIDC 身份绑定校验失败" }
pnpm run env:check
if ($LASTEXITCODE -ne 0) { throw "环境配置检查失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "代码检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

# 已有 .env 先在本机备份再复制新模板；不能提交本机密码。
if (Test-Path .env) {
    Copy-Item .env (".env.backup." + (Get-Date -Format yyyyMMddHHmmss))
}
Copy-Item .env.example .env -Force

pnpm run docker:plan
if ($LASTEXITCODE -ne 0) { throw "Docker 预检失败" }
pnpm run docker:up
if ($LASTEXITCODE -ne 0) { throw "Docker 启动或 Prisma 迁移失败" }
pnpm run docker:ps
```

端口 `15432` 必须未被其他 PostgreSQL/服务占用；如果已占用，应先确认占用进程，不能直接结束其他项目的进程或删除卷。端口变化本身不会修改容器内数据库、密钥、Prisma Schema 或工业安全边界。此记录是代码修改与待执行的 Windows 验收步骤，不代表上述命令已经在维护者机器上运行。

### 2026-11-16 · Docker Prisma 迁移成功后通用 status 报 P1000 的修复

维护者 Windows 实测 `pnpm run docker:db:init` 已在 `127.0.0.1:15432/adui_scada` 成功部署全部四项历史迁移，最后退出码 **0**。容器内 `pg_isready` 接受连接，`psql -U adui_scada -d adui_scada -c "SELECT 1;"` 返回 1。随后通用 `pnpm run db:migrate:status` 返回 P1000，实际原因是该命令按 `apps/server/prisma.config.ts` 读取根 `.env` 的旧密码，和 `docker:db:init` 使用的 `.local/docker/secrets.env` 随机密码不一致。容器内部 Unix Socket `SELECT 1` 并不能证明宿主机 TCP 密码正确。

修复在**不改变通用数据库命令**的前提下增加 `pnpm run docker:db:status`：从 `scripts/init-docker-db.mjs` 统一生成数据库 URL，以受控白名单 `--status` 启动只读 Prisma `migrate status`，环境变量覆盖旧 `.env` 值而不会输出、覆盖或保存密钥。拒绝 `reset`、`dev`、任意参数/远程库，保留 15432 回环约束。原 `docker:db:init` 仍为幂等 `migrate deploy`。

```powershell
git pull --ff-only
pnpm run test:docker:db
if ($LASTEXITCODE -ne 0) { throw "Docker 数据库凭据测试失败" }
pnpm run env:check
if ($LASTEXITCODE -ne 0) { throw "环境检查失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "代码检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run docker:db:status
if ($LASTEXITCODE -ne 0) { throw "本机 Docker Prisma 状态检查失败" }
```

`docker:db:status` 的真实 Windows 退出码与完整 `ready` 在补丁提交后仍待维护者复验。旧根 `.env` 还含曾经公开的数据库、OIDC Client/事务密钥与过期证书路径，宿主 NestJS 联调前必须在本机受控同步到新 Docker 凭据，并进行轮换；禁止将实际值复制到仓库、Issue、测试和日志中。

## 第三十四批第三小批 · 真实 OIDC 双框架工程浏览器专项（需交互、独立于 ready）

在 PR #57 双框架工程管理已合并的基础上，新增隔离浏览器专项：

```powershell
# 先运行纯离线配置保护；该命令已纳入 ready
pnpm run test:projects:oidc:config
if ($LASTEXITCODE -ne 0) { throw "OIDC 工程管理配置保护测试失败" }

# 必须先在当前 PowerShell 进程启动 Node 之前建立可信证书路径
$caDir = & mkcert -CAROOT
if ($LASTEXITCODE -ne 0) { throw "未找到 mkcert 根证书目录" }
$env:NODE_EXTRA_CA_CERTS = Join-Path $caDir "rootCA.pem"

# 本机 dev:server、dev:react、dev:vue 均已启动 HTTPS OIDC 配置；
# Keycloak 用户应为无管理员权限的已显式预绑定测试主体
pnpm run test:projects:oidc:browser
Write-Host "工程管理 OIDC 浏览器专项退出码：$LASTEXITCODE"
```

必须在运行之前人工核对根 `.env` 的 `SCADA_OIDC_ENABLED=true`、`SCADA_OIDC_DEV_HTTPS_ENABLED=true`、`SCADA_OIDC_ISSUER` 指向本机 `adui-scada` Realm、两套精确 HTTPS Origin 和唯一回调、`SCADA_DATABASE_URL` 仅指向本机隔离 `adui_scada` 或 `adui_scada_oidc_lab` 数据库。脚本内部再次执行目标白名单校验；真实服务端的进程配置仍需维护者独立核对，不能只凭根文件推断。禁止 `NODE_TLS_REJECT_UNAUTHORIZED=0`、忽略浏览器 TLS 错误、在命令行/PR 输入真实密钥、随意清理数据库卷或使用正式身份。

执行后会启动全新的**非无头** Chrome/Edge 临时 Profile，并打开真实 OIDC 登录；维护者直接在浏览器界面用普通测试用户完成登录，脚本才会继续；无需在终端粘贴密码。要求隔离 Lab 内至少有 **1 个**当前主体获 `project:read` 权限的工程，超过 10 个才能真实覆盖有数据的上一页/下一页。验证 React/Vue 同源身份和授权列表、取消打开、模拟修订水位冲突、确认打开建立 CAS 可见基线、暂停自动保存及 IndexedDB 原草稿不变。只修改**临时测试浏览器的 IndexedDB**，不执行任何服务端工程写 API；OIDC 登录本身仍会在隔离 Lab 创建正常短期事务。成功与失败都尝试关闭浏览器并删除临时 Profile。

**重要边界**：该浏览器脚本**不属于** `pnpm run ready`，后者仅自动运行 `test:projects:oidc:config` 的纯离线保护测试；真正的 Keycloak 登录需要操作者参与。版本冲突只通过浏览器 GET 响应故障模拟，不等于真实双会话并发 CAS 409 数据库验证。真实工业 PLC/DCS、生产 Keycloak、企业证书、生产数据库与正式发布 API 均不在本批验收范围。

### 第三十四批第三小批 · OIDC 登录后浏览器测试故障定位（E-024）

`test:projects:oidc:browser` 中的浏览器使用临时隔离 Profile，测试失败后关闭 Chrome/Edge 并清理目录，这是保护短期 OIDC Cookie 的预期行为。确认日志已出现“真实 OIDC 会话已在 React Origin 验证”后，若进一步失败，应看**最后一个**“React/Vue：正在验证…”阶段及受控诊断，不应再次误判为登录失败或修改 Keycloak 凭据。脚本只会报告已知中文页面异常、JS 异常类别或工程列表 HTTP 状态码，不打印 CDP 堆栈、Cookie、Token、数据库凭据。

在受控本机隔离 Lab 中，真实工程列表要求测试主体有至少一个 `project:read` 授权；确认打开历史快照还需要同一工程的 `version:read`。若没有相应授权，请先由维护者根据现有安全流程核对，不应从测试脚本新增工程、权限或数据库记录。建议在修复后先执行离线 10 项与 `ready`，然后在维护者实际浏览器重新运行：

```powershell
pnpm run test:projects:oidc:config
if ($LASTEXITCODE -ne 0) { throw "工程浏览器离线配置回归失败" }
pnpm run test:projects:oidc:browser
Write-Host "真实 OIDC 工程浏览器专项退出码：$LASTEXITCODE"
```

真实登录窗口不保留；失败原因仍可能是缺少权限、API 响应、页面运行时或浏览器测试断言，需要使用最新**脱敏**阶段日志区分，不能仅凭质量链通过宣称 OIDC 端到端已通过。

### 第三十四批第三小批 · CDP 页面状态作用域修复（E-025）

维护者 Windows 在最新 OIDC 专项中成功完成 Keycloak 登录、React 授权工程列表和分页，但在临时 IndexedDB 草稿阶段遭遇 `ReferenceError`；排查发现原 `stateInPage` 经 `function.toString()` 发送到浏览器时，错误引用仅存在于 Node 中的 `readBrowserDraftsInPage`。目前已将画布状态/草稿哈希读取拆分为两次**各自自包含的浏览器 CDP 调用**，在 Node 层合并原有断言，不调整临时 Profile 自动清理。

维护者同步 PR #58 最新提交后，先运行 `pnpm run test:projects:oidc:config`（新增一项序列化边界回归，预计共 11 项），`vp check`、`pnpm run docs:check`、`pnpm run ready`；随后在本机可信 OIDC HTTPS Lab 上手动登录测试窗口，运行 `pnpm run test:projects:oidc:browser`，继续检查 React 与 Vue 的取消打开、模拟水位冲突、确认载入、自动保存暂停与 IndexedDB 原草稿哈希一致。浏览器关闭仍是安全清理，失败退出码不属于通过。

### 第三十四批第三小批 · 模拟冲突与确认载入连续执行时的测试状态门禁（E-026）

真实浏览器的“模拟远端水位冲突”会让 Studio **有意显示**冲突错误；同一次测试的下一步“确认打开最新版本”不能将该历史错误作为本次失败证据。测试现在记录点击前错误，在观察到新操作的“正在处理工程版本”或错误变化后，才判断新请求的错误（且不能处于忙碌状态）。真正的失败仍应退出非零；真正的成功仍需确认提示与 CAS 基线建立，且不得覆盖 IndexedDB 原草稿。新增两项正反测试，离线预计共 **13** 项。

请先同步 PR #58 最新 HEAD，运行 `pnpm run test:projects:oidc:config`、`vp check`、`pnpm run docs:check`，再在可信本机 Lab 中运行 `pnpm run test:projects:oidc:browser`，双端专项成功后再运行完整 `pnpm run ready`。浏览器关闭始终是安全清理行为，须以终端退出码和 React/Vue 每个阶段结果判断验收；当前补丁尚待实测。

## 第三十四批第四小批 · 真实多页与两主体 CAS 竞争专项（独立运行）

本小批补足 PR #58 已标明的两个验证空白。严格浏览器模式始终只读，不会隐式创建工程。维护者 2026-11-17 已实测隔离 PostgreSQL **25/25 通过**；严格浏览器模式在 React 第二页条件不足时受控退出（退出码 1），Vue 尚未执行。针对这一明确阻塞，增加**单独且必须显式确认**的本机 Lab 数据准备入口，默认质量链和普通/严格浏览器测试均不触发准备动作。

### 已获维护者授权的本机 Lab 多页数据准备

仅限运行中的 **本机** React/Vue HTTPS、Keycloak `adui-scada` Realm 和现有受控 `127.0.0.1:15432/adui_scada` Lab。操作前核对**当前 NestJS 进程**实际数据库与根 `.env` 的 Lab 连接一致；命令只校验本机配置，不能远程证明另一个运行进程的实际连接。禁止在生产、远程服务或其它数据库上执行。

```powershell
# 使用既有可信 NODE_EXTRA_CA_CERTS / NODE_USE_SYSTEM_CA 环境。
pnpm run test:projects:oidc:config
pnpm run oidc:lab:projects:pages
Write-Host "本机 Lab 工程数据准备退出码：$LASTEXITCODE"
```

准备命令要求 `--prepare-multipage --confirm-lab adui_scada` 双重显式参数（已固定在脚本），并沿用 `oidc-lab-identity.mjs` 中的本机数据库/Realm/非生产配置白名单。命令启动**临时隔离浏览器**，维护者手工登录已预绑定的普通 Keycloak 测试账号。随后仅使用该身份的同源 BFF Session、CSRF 和正式 `POST /api/v1/projects`：先读取当前账号获授权工程；若不足 11 项，仅新增缺少的数量；若已有至少 11 项则不写入。新工程仅包含一个空白组态页、零 Tag/图元，使用 `b34-pages-<UUID>` ID，由原有服务端事务完成首版快照、三项创建者 ACL 和审计；**不复制已有工程内容、不直接操作 ACL/身份表、不更新现有工程、不发布、不清理数据库卷**。已创建测试记录会保留供人工验收，不会在浏览器关闭后自动删除。若中途失败，重新执行会重新读取当前可见数量并只补缺额。

随后使用**另一条独立命令**执行严格只读浏览器验收：

```powershell
# 在测试前，先核对当前 OIDC Lab 已按受控流程存在至少 11 项
# 对当前普通测试主体授权的工程；不得在生产库或正在使用的开发库造数。
$previousCa = $env:NODE_EXTRA_CA_CERTS
try {
  $caRoot = & mkcert -CAROOT
  if ($LASTEXITCODE -ne 0 -or -not $caRoot) { throw "本机可信根证书目录不可读取" }
  $env:NODE_EXTRA_CA_CERTS = Join-Path $caRoot "rootCA.pem"
  if (-not (Test-Path -LiteralPath $env:NODE_EXTRA_CA_CERTS)) {
    throw "本机可信根证书不存在"
  }
  pnpm run test:projects:oidc:browser:pages
  if ($LASTEXITCODE -ne 0) { throw "真实双框架多页验收失败" }
  Write-Host "真实双端多页验收退出码：$LASTEXITCODE"
}
finally {
  [Environment]::SetEnvironmentVariable("NODE_EXTRA_CA_CERTS", $previousCa, "Process")
}
```

严格模式仍通过 Keycloak 真人登录，验证 React/Vue 分别进入授权工程第二页再返回第一页，并继续执行取消、模拟冲突、确认载入、CAS/IndexedDB 保护。授权不足 11 项时**必须失败**，不是项目故障；**只有上文明确授权并单独运行的准备命令才允许通过正式服务端 API 新建测试工程**。普通浏览器专项和严格模式仍然只读。

真实 PostgreSQL 测试复用现有 `pnpm run test:db`，只连接**已迁移的本机独立 `adui_scada_test`**，且会在该库中向**随机 `test-<UUID>` 租户**写入/删除测试数据。维护者必须先通过现有流程核对 `SCADA_TEST_DATABASE_URL` 指向该库、具备有效本机测试连接和迁移，不得直接将开发库 `adui_scada`、Keycloak 数据库、远端数据库或生产库配置给测试命令：

```powershell
# 按现有本机安全流程，在当前 PowerShell 进程设置
# SCADA_TEST_DATABASE_URL 指向 127.0.0.1 的 adui_scada_test
# 密码只留在环境变量或本机受保护配置，不要贴到终端和 PR
pnpm run test:db
Write-Host "隔离 PostgreSQL 测试退出码：$LASTEXITCODE"
```

`test:db` 在现有 `vitest.config.db.ts` 中独立于 `ready`，并有 URL 主机与数据库名白名单；此次预计在旧的 **23 项**基础上新增 **2 项**、共 **25 项**（以实际测试报告为准）。新增离线环境安全检查在本次多页准备工具后由 14 增至预计 **18 项**，随默认 `ready` 执行；交互式多页严格检查与显式数据准备均不进入 `ready`。CAS 用例在仓储层使用独立 Prisma 连接和两位授权主体，不代表生产 HTTP 双 Cookie 会话、真实 OIDC 409、企业 IdP 或正式工业安全验收。维护者已完成此前候选的 Windows 离线配置 14/14、完整 ready（退出码 0）与真实 PostgreSQL 25/25（退出码 0）；**新增数据准备入口与其 4 项单测尚未完成 Windows 复验，也没有在本机执行数据写入**。

## 第三十四批第五小批 · 双 BFF Cookie HTTP 会话 CAS 409（独立真实数据库专项）

第四小批 PR #59 已经维护者授权 Squash 合并至 `main@4c3cb0d7e61ce2aed48350aa33e26e811078d65b`，其真实 PostgreSQL **25/25**、OIDC Lab 工程准备 **1＋10**、React/Vue 严格多页回归均有维护者 Windows **退出码 0** 记录。此前数据准备新增的 **18 项**离线保护和最新代码完整 `ready` 尚无最终成功日志，不能用旧 14 项结果冒充。

第五小批仅补 `apps/server/test/projects-cas-cookie-http.db-spec.ts`，预计真实数据库用例从 25 项增至 **29 项**。**本测试不登录 Keycloak**：两个不同主体在随机租户中通过真实服务端会话签发生成独立 Cookie/CSRF，实际访问内存 NestJS HTTP Server，经正式 Session/Project Guards、事务仓储、数据库行锁与审计，断言同时保存相同修订号只允许 HTTP 201＋409。禁止把两条测试会话冒充两次真正 OIDC IdP 登录。

**Windows 执行顺序**：先同步当前测试分支，核对 `git rev-parse HEAD`；执行 `pnpm run test:projects:oidc:config`（上一小批新增预计 18 项）、`vp check`、`pnpm run docs:check` 和完整 `pnpm run ready`。真实数据库专项必须单独运行；先确认 `SCADA_TEST_DATABASE_URL` 明确指向本机独立 **`adui_scada_test`**，**迁移已完成且实际 NestJS 业务数据库不是该测试库**；严禁把业务库 `adui_scada`、OIDC Lab 库或生产远程数据库当作测试库。不要输出或提交数据库口令。

```powershell
git rev-parse HEAD
git status --short

pnpm run test:projects:oidc:config
if ($LASTEXITCODE -ne 0) { throw "OIDC 离线配置测试失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "代码检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "完整质量链失败" }

# 先沿用项目现有的独立测试库凭据流程，确认本机 adui_scada_test。
# 此处不展示或覆写 SCADA_TEST_DATABASE_URL 的具体口令。
pnpm run test:db
if ($LASTEXITCODE -ne 0) { throw "真实 PostgreSQL HTTP CAS 专项失败" }
Write-Host "本批验收退出码：$LASTEXITCODE"
```

每一项 HTTP 集成测试都使用唯一 `test-<UUID>` 租户，完成后按审计、历史、ACL、工程、会话、身份顺序定向删除当前测试租户的数据；不删除任何数据库或 Docker 卷，不修改现有 Keycloak 身份绑定，也不运行工业设备写入。**本批候选代码尚未在维护者 Windows 运行，预计数不是测试通过结论。** 真正两次 Keycloak 授权码流程、跨进程并发与生产 TLS 验收仍另列后续专项。

## 第三十四批第六小批 · 真实 Keycloak 双主体登录与 HTTP CAS

第五小批 PR #60 已合并到 `main@e7c345b851287f985a45153233c36eb03106f5dd`。维护者 Windows 曾通过 `ready`（544/544 单测、49/49 E2E，退出码 0）及隔离 PostgreSQL `test:db`（29/29，退出码 0）；**最新第六小批代码仍待单独验收，不能复用前一批的通过结果**。

先在本机受控 Keycloak `adui-scada` Realm 准备**第二位不同的普通测试用户**，并通过已有 `pnpm run oidc:lab:identity` 受控工具，将其外部 Keycloak UUID 绑定为与第一位用户同租户、但不同 `subjectId` 的活动主体。此步只做可信身份预绑定，不授予已有工程权限；不要复制账号密码到终端、环境变量、PR 或聊天中。默认不修改 Lab 数据，工具也不会生成 Keycloak 用户。第二位用户尚未绑定时必须在只读预检失败，不得降低安全校验。

Windows 验收顺序：

```powershell
git fetch origin
git switch --track origin/test/v0.3-b34-oidc-dual-login-cas
git rev-parse HEAD
git status --short

pnpm run test:oidc:dual:config
if ($LASTEXITCODE -ne 0) { throw "双主体离线安全测试失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "格式、Lint 或类型检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "完整质量链失败" }

# 请先保证两套本机 HTTPS Web、NestJS、Keycloak 和可信根证书可用。
# 以下命令会让维护者依次在两个隔离浏览器中手动登录不同的预绑定测试用户。
pnpm run test:oidc:dual:preflight
Write-Host "双身份真实登录只读预检退出码：$LASTEXITCODE"
```

只读预检必须确认两个不同主体、同一租户。其本身不创建或授予工程权限；标准 OIDC 登录仍会写入正常的登录事务和短期 BFF 会话。

**仅在维护者确认当前运行中的 NestJS 确实使用非生产本机 `adui_scada` Lab，并明确愿意创建专用测试工程时**，单独执行：

```powershell
pnpm run test:oidc:dual:cas
Write-Host "真实双 Keycloak 主体 HTTP CAS 验收退出码：$LASTEXITCODE"
```

此命令**会写数据库**：第一主体通过正式 HTTP 创建全新的 `b34-oidc-cas-<UUID>` 空白工程，随后只给第二主体授权这一个工程的三项固定 ACL，两浏览器发送并发 HTTP CAS。成功应得到一份 201、一份 409，最终修订 2、历史与成功审计操作者一致。**新工程和 ACL/历史会保留供人工核验**，失败中途也可能保留部分新工程记录，不自动删除、不修改此前 11 项分页验收工程。每次运行生成一个新工程，不要反复执行造数。用户无需在命令行输入 Keycloak 密码。

所有检查严禁远程数据库、生产 OIDC Realm、无效 TLS 或把测试主体验证简化为同一用户的两个窗口。该专项不属于 `ready`；新增的 11 项离线安全回归已接入 `ready`。当前未在维护者 Windows/真实 Lab 执行，不声称真实双主体登录和 CAS 已通过。

### 2026-11-17 · 第六小批 Windows 实测：区分重复主体与租户不一致

维护者已经完成第六小批候选的离线安全测试 **11/11**、`vp check` **331/186 零告警**、`docs:check` **86 份**、完整 `ready`（**544/544 单测、49/49 E2E、退出码 0**）。但独立 `test:oidc:dual:preflight` 与 `test:oidc:dual:cas` 在两个浏览器登录后的**主体合法性比较**都以退出码 1 终止，原提示不能区分两次登录映射到同一个 `subjectId` 还是租户不同。没有执行 CAS 创建/ACL/版本追加。后续修复按 E-029 细分为两种固定中文提示，不暴露身份标识。该诊断修复尚待 Windows 复验，不能称双主体专项已经通过。

本机检查顺序：

1. 在 Keycloak 本机管理界面选择 `adui-scada` Realm，确认存在两位**独立的普通测试用户**；第二位必须确实有不同的 Keycloak 用户 UUID，不能通过两个浏览器重复登录相同账号模拟双主体。脚本不创建 Keycloak 用户、不输入或记录密码。
2. 核对第一用户此前已预绑定的本机 `tenantId`，只在本机可信配置/会话内查阅；为第二用户选择**同一租户、不同且未被占用的本地主体 ID**。使用已有 `oidc:lab:identity` 工具先做只读预览，确认无冲突后才可手工、明确地加 `--apply --confirm-lab adui_scada`。此流程只建立用户/外部身份映射，不给任何旧工程授权，不重新绑定或覆盖第一主体。所有 ID 与 Keycloak UUID 不要粘贴到聊天、工单或日志。
3. 再启动 `pnpm run test:oidc:dual:preflight`，两个隔离窗口分别输入**不同账号**的登录信息。若提示“**两次登录映射到同一本地主体**”，核对第二窗口是否实际使用了不同账号；若提示“**两次登录所属租户不一致**”，核对第二账号的受控本地预绑定租户。无法确认时保持失败并停止，不向当前业务工程授予 ACL。
4. 只有预检退出码 0 且维护者核实运行中的 NestJS 连接到本机受控 `adui_scada` OIDC Lab 后，才单独执行 `test:oidc:dual:cas`。这会创建一份新的专用工程及精确 ACL，保留历史审计；不要反复在身份未满足时重跑写入命令。

预绑定工具使用的参数契约见 `scripts/oidc-lab-identity.mjs`：`--tenant`、`--subject`、`--keycloak-sub`；默认只读预览，真正写入还须显式 `--apply --confirm-lab adui_scada`。它严格限制回环、本机库、可信 Realm 与迁移状态，不能替代第二位 Keycloak 用户的真实登录。

## 第三十四批第七小批 · 本机隔离 PostgreSQL 会话注销与 ACL 即时撤销 HTTP 专项

基于 PR #61 已合并的 `main@669c9ff3bb2d6194890cbc5049b58803ca775c5e`，只扩展 `apps/server/test/projects-cas-cookie-http.db-spec.ts` 的真实数据库 HTTP 测试，不新增产品 API 或用户权限管理能力。上一批 Windows `pnpm run ready` 已由维护者实测 **544/544 单测、49/49 E2E、退出码 0**，真实双 Keycloak 登录的 CAS 为 HTTP **201 + 409**；这些是第六小批的历史证据，不代表本批代码已复验。

本批新增两项：

1. 真实 NestJS `POST /api/v1/auth/logout` 使用原有同源 Cookie/CSRF，通过 PostgreSQL 服务端会话撤销当前主体 A 的会话；验证返回 HTTP **204**、清除 Cookie、数据库 `revokedAt` 已写入。即使客户端故意复用旧 Cookie，`/api/v1/auth/me`、工程列表和版本追加必须立即返回 **401**；未被撤销的主体 B 的会话仍有效，并能独立保存修订 2，成功审计只记录 B。
2. 在两个已登录会话仍有效时，**仅在随机测试租户**删除主体 B 对该测试工程的三项 ACL；必须立即从 B 的工程列表移除，工程详情、历史列表及版本追加均返回 **404**，而 `/auth/me` 仍证明其身份有效；工程创建者 A 仍可读取和保存修订 2，成功审计与 A 一致。

每个用例复用既有唯一 `test-<UUID>` 租户夹具，在 `finally` 定向清理本次审计、历史、ACL、工程、会话与身份。该专项不连接真实 Keycloak，也不读取或修改已有 OIDC Lab 的两位用户、11 项分页工程和双主体 CAS 专用工程；不是生产会话注销验收。测试数据只允许本机独立 `adui_scada_test`，`SCADA_TEST_DATABASE_URL` 必须显式配置；绝不使用真实业务库 `adui_scada`、Keycloak 库或远程数据库。

Windows 命令如下：

```powershell
git fetch origin
git switch --track origin/test/v0.3-b34-session-acl-revocation
git rev-parse HEAD
git status --short

vp check
if ($LASTEXITCODE -ne 0) { throw "代码质量检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "完整质量链失败" }

# 必须先核对独立测试数据库与迁移状态，禁止指向实际运行的 OIDC Lab。
pnpm run test:db
if ($LASTEXITCODE -ne 0) { throw "真实 PostgreSQL 会话与 ACL 专项失败" }
Write-Host "第七小批验收退出码：$LASTEXITCODE"
```

真实 PostgreSQL `test:db` 原 **29** 项加本批 **2** 项，预计 **31/31**，这是验收目标不是实际通过结论。此处测试只验证已存在的会话注销和动态授权实现，**不提供新的会话或工程权限管理 UI，不扩大控制设备写入权限，也不替代独立真实 Keycloak 人工交互验收**。

## 第三十四批第八小批 · 前端服务端授权失效最小安全回归

基于经维护者授权 Squash 合并的 PR #62，正式 `main@d743e17df42fda97a1cd9bce8676ad75b5ed37c9`。本批只修改共享 API Client、React/Vue Studio 和已有共享单元测试，**不修改 PostgreSQL、NestJS 认证或工程权限、Keycloak 用户、OIDC Lab ACL 及正式工程数据**。

Windows 先确认无待保存的未提交修改，然后同步候选分支：

```powershell
git status --short
git fetch origin
git switch --track origin/fix/v0.3-b34-studio-access-revocation
git rev-parse HEAD
pnpm run test:unit
if ($LASTEXITCODE -ne 0) { throw "共享服务端会话回归失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "格式、Lint 或类型检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档静态检查失败" }
pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "完整质量链失败" }
Write-Host "第八小批完整质量链退出码：$LASTEXITCODE"
```

原 `ready` 有 **49 个单测文件、544 项单测和 49 项 HTTP E2E**；本批新增 API Client/Session 合计 **6 项单元测试**，预计变成 **550/550**，真实结果以 Windows 日志为准。该检查不会发起真实 Keycloak 登录，也不会修改既有 Lab 工程。需要浏览器互通复验时，可在**不修改现有用户 ACL**的前提下运行既有 `pnpm run test:projects:oidc:browser`，用预绑定普通测试用户人工完成受控本机真实 OIDC 登录；这只能证明正常权限路径不回归，不能伪称撤权浏览器 E2E 已验证。

授权拒绝的实际 UI 行为需要额外的专用临时权限夹具或安全浏览器模拟场景方能自动化覆盖，**本批未实现该自动化专项**。不得在维护者既有 `adui_scada` 业务工程上直接做删除 ACL 或注销会话的破坏性实验，也不应把 `test:db` 的历史成功错误描述为本次前端新 HEAD 的验证。

## 第三十四批第九小批 · 双框架 OIDC 浏览器模拟权限拒绝专项

在 PR #63 经维护者明确授权 Squash 合并后，以 `main@6f09e1930fe55f567245708bf5eb80edacd7b42a` 为基线，只扩展现有浏览器脚本、离线规则测试、根命令与文档，不新增正式业务 API、Vue/React 页面改动、Prisma 迁移或数据库写入。**本批真实浏览器尚未实测**。

Windows 验收顺序，先确认本地无待保存修改，再同步新分支：

```powershell
git status --short
git fetch origin
git switch --track origin/test/v0.3-b34-oidc-access-denial-browser
git rev-parse HEAD

# 独立离线安全测试：原 18 项 + 新增 3 项，预计 21/21。
pnpm run test:projects:oidc:config
if ($LASTEXITCODE -ne 0) { throw "浏览器模拟规则检查失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "完整质量链失败" }

# 在受控本机 HTTPS OIDC Lab 正常运行后，独立执行不会到达后端写入路由的模拟专项。
pnpm run test:projects:oidc:denial
Write-Host "权限拒绝模拟浏览器退出码：$LASTEXITCODE"
```

执行浏览器专项时使用已有**预绑定普通 Keycloak 测试用户**人工登录，不在 PowerShell 中粘贴密码。浏览器按真实授权列表选取既有一项工程，先通过实际同源 GET 确认载入，再在页面内模拟服务端 GET 返回：React/Vue 分别覆盖历史 401、列表 403、工程水位 404，验证旧 CAS 基线与授权摘要消失、SVG 画布和 IndexedDB 草稿内容摘要未改变、没有任何工程写入请求向真实 Lab 发送。该模式对工程 API 的所有非 GET/HEAD 请求永久拦截，不执行真实服务器的登出、ACL 撤销或项目创建。临时浏览器 Profile 在 finally 中关闭并删除，不打印任何用户身份或密钥。

**风险及边界**：若真实 Keycloak/HTTPS Lab 未启动、临时 Profile 无现有工程权限或 DOM/浏览器版本不符合既有脚本约束，专项按安全设计失败并返回退出码 1，不得放宽数据库白名单、关闭 TLS 或为测试手工更改既有 ACL。浏览器演练是**模拟服务端拒绝**，不是“真实撤权 E2E”；独立真实 PostgreSQL 服务端 ACL 测试（上一批 31/31）仍是另一层证据。目标验收为离线 **21/21**、原单测 **550/550**、服务端 E2E **49/49**、真实模拟浏览器命令 **退出码 0**，均需以维护者 Windows 实际日志为准。

## 第三十四批第十小批 · 真实双主体 ACL 撤销与 React/Vue UI 验收（受控写入）

基线为维护者明确授权 Squash 合并的 PR #64：`main@d59df5e9ef2d702954f6b20173990abe53dffc3a`。第九小批真实 Keycloak 登录＋浏览器内 401/403/404 模拟已在 Windows React/Vue 完整通过（专项退出码 0），离线 OIDC 浏览器专项 21/21、常规单测 550/550、服务端 E2E 49/49。该证据**不代表**真实 PostgreSQL ACL 撤销后的双框架 UI 已通过，因此本批新增独立专项。

只增加新的受控 OIDC Lab 验收脚本与 8 项 Node.js 离线安全用例，复用现有真实 CDP 浏览器和官方工程创建/读取入口，**不修改正式前端/后端、Schema、迁移、Keycloak 用户、历史工程或工业控制路径**。预检无数据库写入；完整浏览器专项带有显式写入开关，严格拒绝非生产与非回环 TLS/数据库、错误的库名或无效身份映射。

Windows 验收步骤：

```powershell
git status --short
git fetch origin
git switch --track origin/test/v0.3-b34-real-acl-revocation-ui
git rev-parse HEAD

pnpm run test:oidc:revoke:config
if ($LASTEXITCODE -ne 0) { throw "权限撤销离线测试失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "格式、Lint 或类型检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "完整质量链失败" }

# 仅登录检查，没有工程/ACL 写入；两个独立浏览器分别登录 adui 与 test。
pnpm run test:oidc:revoke:preflight
Write-Host "真实撤权只读预检退出码：$LASTEXITCODE"
```

**仅当只读预检退出码为 0，且重新核对 NestJS 当前真实连接本机受控 `adui_scada` OIDC Lab 后**，维护者才可决定运行下面的显式写入专项。不要把本机独立的 `adui_scada_test` 真库测试环境当成此命令的目标，也不要使用生产库、远端数据库、其他 Keycloak Realm 或旧账号：

```powershell
pnpm run test:oidc:revoke:browser
Write-Host "真实 React/Vue ACL 撤销浏览器退出码：$LASTEXITCODE"
```

交互阶段每位主体在临时隔离浏览器中手动登录 Keycloak 普通测试用户，不在终端输入/粘贴密码。此命令**真实创建两份新 UUID 空白专用工程**（分别供 React 与 Vue 测试），用固定三项 ACL 暂时授予第二位主体；在已建立真实 CAS 基线且确认本地 IndexedDB 草稿存在后，仅定向删除该新工程上的第二主体三项 ACL。随后要求真实 BFF `/auth/me` 依然有效，详情、历史与首版三个请求均返回 404，React/Vue 服务端摘要及 CAS 清空、本地画布和草稿不变，重复保存被阻断，创建者仍能读首版，PostgreSQL 修订号仍为 1 且仅单条成功审计。专用工程及其首版、审计保留供复核，**不清空数据库、撤销已有工程权限或修改既有测试账号**。失败时脚本在 `finally` 尽可能定向回收本轮授予的第二主体 ACL；如需人工复核，只检查终端输出的本次随机工程，禁止全库删除。

本批目标：新离线安全用例 **8/8**；`ready` 普通单元测试预计仍为 **550/550**、服务端 E2E **49/49**、旧项目浏览器离线 21/21；新真实浏览器脚本 **退出码 0**。协作端仅完成 V8 函数语法及 8 项模拟测试，**真实 Windows CLI、Keycloak 双登录、PostgreSQL SQL 与双框架 UI 尚未执行**。不能将模拟测试标为 Node 正式通过。

## 第三十四批第十一小批 · 跨标签页恢复时只读会话/ACL/CAS 复核

在第十小批 PR #65 获维护者授权、真实双 Keycloak 本机 PostgreSQL ACL 撤销 React/Vue 浏览器专项退出码 0 并 Squash 合并为 `main@e809d306743bd20508630c1809d6993b755f1874` 后，开始本小批。目标是**已载入 CAS 的标签页重新可见时**查询同源 BFF 最新身份、工程 ACL 和水位，不等待用户再次点击“保存”，也不对其它标签页广播主体 ID、权限或 Cookie。

Windows 仓库验收：

```powershell
git status --short
git fetch origin
git switch --track origin/fix/v0.3-b34-resume-session-revalidation
git rev-parse HEAD

pnpm run test:projects:oidc:config
if ($LASTEXITCODE -ne 0) { throw "标签页恢复浏览器规则检查失败" }
pnpm run test:unit
if ($LASTEXITCODE -ne 0) { throw "共享 CAS 恢复复核单元测试失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "格式、Lint 或 TypeScript 检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "完整质量链失败" }
Write-Host "第十一小批 ready 退出码：$LASTEXITCODE"
```

原 Windows 验收已有 550 项单测、21 项 OIDC 浏览器离线测试、49 项服务端 E2E；本批新增共享 CAS **8 项**与离线浏览器 **3 项**，预计 **558/558 单测、24/24 浏览器离线和 49/49 E2E**，必须以实际运行输出为准；`docs:check` 目标仍是 86 篇 Markdown。

本机双 Web HTTPS 与 Keycloak Lab 已按既有文档运行、采用预绑定的普通测试用户登录后，执行本批**浏览器模拟**专项：

```powershell
pnpm run test:projects:oidc:resume
Write-Host "双框架标签页恢复浏览器退出码：$LASTEXITCODE"
```

该专项仍在临时独立 Chrome/Edge Profile 中使用真实登录会话，先通过真实授权列表和实际同源 GET 确认载入工程并保存一份临时 IndexedDB 草稿；随后在页面内**模拟可见事件**，分别只对当前 Origin 模拟 `GET /auth/me` 401、`GET /projects/:id` 404 或将合法 GET 响应的 `headRevision` 增大 1。所有工程 API 非 GET/HEAD 请求在模拟器内始终拒绝，**不会写真实 Lab 工程、ACL 或版本，也不需要真实登出其他标签页**。React/Vue 两端分别验证旧 CAS/水位/授权摘要失效、本地 SVG 画布、IndexedDB 草稿哈希及自动保存状态不变，专项最终退出码须为 0。

**范围边界**：本批没有实现广播式会话立即同步、轮询或跨 Origin Cookie 传输。只有当前文档重新可见并存在 CAS 基线时执行只读复核；真正后台长期可见性、双物理标签并行与真实另一个标签页注销/ACL 撤权仍需后续专用 E2E。既有第十小批真实 PostgreSQL ACL 撤销端到端通过是独立证据，不能把本批模拟事件称为“跨标签页真实注销 E2E 已验收”。源码及质量链均需 Windows 复验；本协作环境无实际 Chrome/Keycloak/React/Vue 全链结果。

## 第三十四批第十二小批 · 共享版本读取上下文切换保护回归

此小批不需要启动真实 Keycloak/浏览器或写 PostgreSQL；新增回归在已有 Vitest 共享会话测试中以受控 Promise 排序模拟：旧读取等待时重置/重新确认载入，分别迟到返回 401、404 和有效快照。前两项必须保留新合法 CAS 或允许明确恢复的本地工程按原有创建规则操作；第三项必须受控拒绝旧快照、不额外执行工程详情 GET。原有活跃会话的 401/403/404、防误创建、CAS 冲突及网络故障测试不删除。

Windows 从新分支执行：

```powershell
git status --short
git fetch origin
git switch --track origin/fix/v0.3-b34-read-version-stale-context
git rev-parse HEAD

pnpm run test:unit
if ($LASTEXITCODE -ne 0) { throw "共享会话单元测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run ready
$readyExitCode = $LASTEXITCODE
Write-Host "第十二小批完整质量链退出码：$readyExitCode"
if ($readyExitCode -ne 0) { throw "完整质量链失败" }
```

目标：共享单元测试原 22 项 + 3 项，共 **25 项**；全量 Vitest 原 558 项 + 3 项，共 **561 项**；HTTP E2E 预计仍 49 项。数字仅为候选预期，不能当作实际执行结果。旧 OIDC `test:projects:oidc:resume` 已在第十一小批通过；本批未改变框架生命周期，但完整质量链和相关浏览器回归仍以维护者实测为准。

## 第三十四批第十三小批 · 服务端保存上下文切换保护验收

此批在上一小批 `main@0d5962b5b7d5b208a550d8cd3ba9a4b72b508c6d` 基础上增加 **5 项**共享会话 Promise 时序测试，目标共享 CAS 测试 **30/30**、全量 Vitest **566/566**（此前 25/25、561/561），服务端 HTTP E2E 预计仍 **49/49**；均须以维护者 Windows 实际日志和退出码为准。代码只涉及共享 API Client，不发起真实 PostgreSQL 或 Keycloak 写入。

Windows 从项目根目录执行：

```powershell
git status --short
git fetch origin
git switch --track origin/fix/v0.3-b34-pending-save-context-guard
git rev-parse HEAD

pnpm run test:unit
$unitExitCode = $LASTEXITCODE
Write-Host "共享会话单测退出码：$unitExitCode"
if ($unitExitCode -ne 0) { throw "共享会话单测失败" }

vp check
$checkExitCode = $LASTEXITCODE
Write-Host "Vite+ 检查退出码：$checkExitCode"
if ($checkExitCode -ne 0) { throw "格式、Lint 或类型检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run ready
$readyExitCode = $LASTEXITCODE
Write-Host "完整质量链退出码：$readyExitCode"
if ($readyExitCode -ne 0) { throw "完整质量链失败" }
```

已有 `test:projects:oidc:resume` 属第十一小批“真实登录＋模拟可见事件/服务端拒绝”浏览器专项，不覆盖本次保存中 Promise 竞态；如 Lab 运行可另行回归，但不要用该专项代替本批共享会话时序单测。保存请求一旦发送到真实服务器，测试不能假装能够取消或回滚；本小批不触碰真实工程和 ACL。

## 第三十四批第十四小批 · 双框架延迟保存浏览器专项

`pnpm run test:projects:oidc:save:browser` 复用第三十四批的本机真实 Keycloak/BFF 登录与 React/Vue 双 Origin 验收环境，单独运行 `--simulate-save-timing`。默认只有此单一模式，不得与 `--prepare-multipage`、`--confirm-lab` 等任何写入模式组合；所有工程 API POST 在浏览器拦截，**不向真实 Lab 发送任何工程写入**，不变更 ACL、工程、版本及生产设备。维护者仍须预先启动受控 Lab 服务并使用已预绑定普通测试账号完成一次登录；终端禁止输入或粘贴密码。

验证顺序：先运行 `pnpm run test:projects:oidc:config`（候选 28 项，原 24 项 + 4 项离线用例），再运行 `pnpm run ready`（实际退出码应为 0，TypeScript / 构建 / 单元 / HTTP E2E 全链）。随后独立交互式执行：

```powershell
pnpm run test:projects:oidc:save:browser
$browserExitCode = $LASTEXITCODE
Write-Host "双框架延迟保存专项退出码：$browserExitCode"
if ($browserExitCode -ne 0) { throw "双框架延迟保存专项失败" }
```

React/Vue 各自以真实 GET 建立已有授权工程的 CAS 基线；在 UI 连续点击保存后仅允许一条被阻断的版本追加 POST，延迟响应下按钮禁用、画布/IndexedDB/自动保存不变；409/401 清除 CAS，503 保留 CAS；浏览器 Profile 结束后清理。失败日志只输出固定中文类别，绝不打印异常原文、Cookie、Token 和工程正文。此专项是**真实浏览器 UI + 合成 POST 响应**，不代表真实数据库写入延迟、真实跨标签并发、现场工业安全已验收。没有浏览器环境时不能把离线 28/28 或 `ready` 通过替代真实浏览器退出码。

## 第三十四批第十四小批 · Vue 载入确认前失败的复验边界

维护者首次 Windows 测试：离线 OIDC 浏览器安全用例 **28/28**、`vp check` 零告警、`ready` 566/566 单测与 49/49 HTTP E2E 通过；交互式 `test:projects:oidc:save:browser` 在 React 延迟保存三场景通过后，Vue **取消载入**确认前发生受控错误，专项退出码 **1**。失败原因尚不能仅凭旧脱敏类别判断。此日志属于真实浏览器专项失败，不得标记为已通过。

浏览器脚本修复候选加强旧错误与本次新错误的区分，并仅输出固定七类安全原因；新增三项安全离线用例，预计 **31/31**。复验步骤：

```powershell
git status --short
git fetch origin
git rev-parse HEAD
git rev-parse origin/test/v0.3-b34-browser-save-timing

pnpm run test:projects:oidc:config
if ($LASTEXITCODE -ne 0) { throw "工程浏览器离线保护测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "代码检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "完整质量链失败" }

pnpm run test:projects:oidc:save:browser
$browserExitCode = $LASTEXITCODE
Write-Host "双框架延迟保存专项退出码：$browserExitCode"
if ($browserExitCode -ne 0) { throw "双框架延迟保存专项失败" }
```

运行前确认本机可信 Keycloak、双 Origin HTTPS Web、NestJS 与授权工程均就绪。本专项仍只模拟浏览器内版本追加 POST 拒绝，真实 Lab 不接受工程写入；不能通过禁用 HTTP 失败断言、关闭 TLS、自动重试工程写入或打印原始异常来提高通过率。

## 第三十四批第十四小批 · 第二轮诊断契约修复后的验证顺序

维护者第二轮实测的 `test:projects:oidc:config` **30/31**，`ready` 也在同一离线测试中提前终止；因此即使此前已输出 `566/566` Vitest 和 `vp check` 零警告，**也不得称该次完整 `ready` 通过**。独立浏览器 React 已通过延迟 409/401/503，Vue 在 BFF 身份阶段返回通用诊断，真实原因未确定。

先在 PR #69 最新 HEAD 上单独复验离线用例（目标 31/31），通过后才运行完整 `ready`；独立浏览器最后运行并记录数值退出码。新固定诊断“Vue BFF 会话未通过验证”表示只读 `/api/v1/auth/me` 返回了非预期的认证布尔结果，**不等同**已证明 HTTP 401、会话过期或存在用户越权。失败时核对本机 HTTPS 监听、服务端 BFF 日志与当前 Origin，仅使用状态或受控诊断，不打印任何 Cookie、CSRF、Token、用户标识和服务端正文。不因错误诊断而取消身份断言，也不得让工程写入穿透浏览器隔离层。

## 第三十四批第十四小批 · React 503 延迟保存超时分阶段复验

第三次 Windows 交互式浏览器日志在 React “服务端暂时不可用”场景**开始后**报通用页面超时，专项退出码 1；Vue 本轮没有开始。为避免将开始提示当成通过，浏览器脚本将明确打印模拟 POST 已触发与已释放的安全阶段标记，并在有界等待失败时仅输出预先审核的固定类别（权限模拟基线加载超时、POST 未命中、额外写请求、Busy 未保持、按钮未禁用、保存操作未结束、页面未显示拒绝错误）。真实身份、授权与 CAS 断言继续 fail-closed；所有项目 POST 仍在隔离浏览器中拒绝/挂起，绝不进入受控 Lab。

先核对本机 HEAD；`pnpm run test:projects:oidc:config` 预计 **33/33**，`vp check` 零告警，`pnpm run docs:check` 通过，再以 `pnpm run ready` 的实际退出码判断完整质量链；单独启动现有可信 HTTPS/Keycloak Lab 后运行 `pnpm run test:projects:oidc:save:browser`，必须同时完成 React/Vue 的 409/401/503 三项并最终返回退出码 0。失败时仅复制固定阶段、固定类别和退出码，禁止粘贴凭据、Cookie、Token、工程正文、服务器原始错误和 CDP 堆栈。不把受控模拟当作真正 PostgreSQL 写入后回包 E2E。

## 第三十四批第十四小批 · Vue 409 与 33 项离线用例最终候选复验

维护者第四轮 Windows `test:projects:oidc:config` **32/33**，失败是新增未知诊断负向断言预期错误；同轮独立 `test:projects:oidc:save:browser` React 409/401/503 执行完成，Vue 在 409 合成响应释放后失败，实际退出码 1。后续候选修复了预期文案与 Vue 保存 409 后共享 CAS 基线的响应式显示对齐，**修复后没有 Windows 实测证据**。

先核对 `git status --short`、`git rev-parse HEAD` 与远端 PR HEAD，确保未覆盖本地改动；执行 `pnpm run test:projects:oidc:config`（目标 33/33）、`vp check`（零告警）、`pnpm run docs:check`（文档门禁）、完整 `pnpm run ready`（退出码须 0），最后在受控 HTTPS / Keycloak Lab 独立运行 `pnpm run test:projects:oidc:save:browser` 并记录退出码。专项必须让 React/Vue 均完成 409、401、503，双框架 409/401 清除 CAS、503 保留 CAS，按钮禁用、仅一条 POST、SVG/IndexedDB/自动保存完全不变。模拟 POST 永不进入真实 Lab；若出现固定“CAS 基线状态不符合预期”，不能通过调整预期或跳过断言规避，需要继续检查 UI 与共享会话一致性。

## 第三十四批第十四小批 · 双框架延迟保存专项验收结案

2026-11-17 维护者 Windows 复验已提供 `pnpm run test:projects:oidc:config` **33/33**、`vp check` **333/188 零告警错误**、`docs:check` **86 份 Markdown**、完整 `ready` 执行至 React/Vue/Server 构建完成且非零失败断言未触发（566/566 Vitest、49/49 HTTP E2E），以及独立 `pnpm run test:projects:oidc:save:browser` **退出码 0**。真实浏览器分别完成 React 与 Vue 的 409/401/503 延迟拒绝、只尝试一次 POST、草稿和自动保存保持不变；所有写请求在浏览器被拦截，未修改 Lab 工程和 ACL。

本段是此前“候选/待复验”说明的**最新验收结论**。仍须保留完整日志和本地提交 SHA 关联；上传日志没有 `git rev-parse HEAD`，本次文档补录自身亦未重新验收。真实 PostgreSQL 成功写入后的延迟响应并不在此专项范围内。

## 第三十四批第十五小批 · 真实数据库提交后延迟交付的分层验收

候选新增 **1 项**共享 Studio Session 单测，目标 **31/31**、全量 Vitest **567/567**；新增 **1 项**真实 PostgreSQL 双 Cookie HTTP CAS 测试，现有 DB 专项原为 4 个文件 / **29** 项，目标 **30/30**，具体以维护者 Windows 实测为准。真实 DB 测试仍不属于 `ready`，**必须独立执行**。

安全前置：仅使用现有 `SCADA_TEST_DATABASE_URL` 指向**本机** `adui_scada_test` 的经过明确授权的隔离测试数据库，已应用项目现有迁移；切勿把根 `SCADA_DATABASE_URL` 或生产、开发、OIDC Lab 业务库当作测试库。数据库测试文件现有前置保护拒绝远程 Host、非法库名和非 PostgreSQL 协议；不会自动新建或迁移数据库。本小批所有新增实际 SQL 使用原 `withFixture` 的**随机租户**，按租户作用域清理，**不触碰已有工程**。测试成功回包的延迟发生在消费端 Promise，而非 TCP 网络故障。

Windows 从项目根执行，先核对当前工作分支和未提交更改：

```powershell
git status --short
git fetch origin
git switch test/v0.3-b34-real-commit-late-response
git pull --ff-only origin test/v0.3-b34-real-commit-late-response
git rev-parse HEAD

pnpm run test:unit
if ($LASTEXITCODE -ne 0) { throw "共享会话单元测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 代码检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run ready
$readyExitCode = $LASTEXITCODE
Write-Host "完整质量链退出码：$readyExitCode"
if ($readyExitCode -ne 0) { throw "完整质量链失败" }
```

**单独真实 PostgreSQL 验收**（确认独立测试库、迁移及本机已有安全环境变量后才执行；不要复制口令到终端、日志或 PR）：

```powershell
pnpm run test:db
$dbExitCode = $LASTEXITCODE
Write-Host "真实 PostgreSQL 专项退出码：$dbExitCode"
if ($dbExitCode -ne 0) { throw "真实 PostgreSQL 专项失败" }
```

`test:db` 必须对照新增用例的 **201 已提交/审计存在→第二主体推进至 3→旧 201 延迟交付→旧 CAS 409→最终水位、版本、审计 1/2/3**；若出现迁移缺失或隔离库前置不满足，保持失败，不使用已有业务库绕过。此测试只阻滞应用层交付，不声明真实浏览器 TCP 故障已验收。需要测试物理 TCP 阻断或真实双浏览器现场并发时另开专项评审。

## 第三十四批第十五小批 · SSE 故障代理随机禁用端口 Windows 复验

维护者实际已通过 `test:db` **32/32，退出码 0**（隔离 PostgreSQL 四项迁移已是最新）、`test:unit` **567/567**、`vp check` **333/188 零警告错误**、`docs:check` **86**；但 `ready` 被 `scripts/sse-fault-proxy.test.mjs` 中两个 `fetch failed: bad port` 阻断，SSE 故障代理 **2/4**，整条质量链退出码 **1**。SSE 客户端 **8/8** 通过不能替代故障代理检查。

最小候选将测试故障代理的监听从无条件 `listen(0)` 改为随机选择本机 **20000～49151** 的 HTTP/Fetch 允许端口，发生 `EADDRINUSE`/`EACCES` 可受控重试最多 32 次；保持回环绑定、外部 URL 严格拒绝、SSE 静默阻断、TCP 资源清理及其他既有断言。原四项单测均通过 `withOrigin` 再验证实际端口范围。不能通过修改 Node Fetch 禁用端口列表、禁用 Web 安全或删除原测试来处理此故障。

同步最新 PR #70 分支并保留本地未提交更改后，在 Windows 项目根执行：

```powershell
pnpm run test:sse:fault:unit
$faultExitCode = $LASTEXITCODE
Write-Host "SSE 故障代理退出码：$faultExitCode"
if ($faultExitCode -ne 0) { throw "SSE 故障代理测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run ready
$readyExitCode = $LASTEXITCODE
Write-Host "完整质量链退出码：$readyExitCode"
if ($readyExitCode -ne 0) { throw "完整质量链失败" }
```

必要时还可独立复查 `pnpm run test:db`，但不得为了消除 `bad port` 而切换生产或开发 PostgreSQL。当前新增代理端口修复只有静态源码核对，**尚无 Windows 新版 SSE 或 ready 退出码**；已有真实 DB 32/32 的验收结论不受影响。

## 第三十四批第十五小批 · Windows 最终质量结果

2026-11-17 维护者 Windows 实测：`pnpm run test:sse:fault:unit` **4/4**；`vp check` **333 文件格式正确/188 受检零告警错误**；`docs:check` **86**；完整 `pnpm run ready` **退出码 0**，包含共享 Vitest **567/567**、SSE 客户端 **8/8**、故障代理 **4/4**、OIDC 工程浏览器离线安全 **33/33**、NestJS HTTP E2E **49/49**、React/Vue/NestJS 类型检查和构建。另有同一小批此前已在本机隔离 `adui_scada_test` 单独执行的真实 `test:db` **4/4 文件、32/32 用例、退出码 0**，四项 Prisma 迁移为最新。

前面“故障代理 2/4”和“ready 退出码 1”是补丁前历史记录，不再是本批当前质量结论。修复后 Windows 证明 SSE 代理在所测端口上的安全监听与 TCP 故障注入恢复正常；上轮未记录随机分配的确切禁用端口，因此不虚构具体端口值。两层 CAS 测试仍非物理 TCP 断流或真实浏览器对同一 PostgreSQL 提交回包的单条完整 E2E。原始日志没有 `git rev-parse HEAD`，新文档提交亦未运行完整门禁；未经明确授权不合并 PR #70。

## 第三十四批第十六小批 · 真实 Keycloak 双浏览器迟到 201

复用原 `test:oidc:dual:preflight` / `test:oidc:dual:cas` 的可信本机环境和身份准备流程，新增**互斥、显式确认、手动运行**的 `test:oidc:dual:late`。原只读预检不写工程；新模式仅为本轮随机 UUID 专用空白工程授予第二主体三项权限，第一浏览器真实 201 已到但延迟消费，第二浏览器完成修订 3，再释放旧 201、旧 CAS 必须 409，SQL 精确核对版本、摘要及审计。测试工程保留。不可将该流程用在现有业务/生产 PostgreSQL 或真实工业设备上。

Windows 根目录质量验证（先确认工作区没有未提交改动）：

```powershell
git status --short
git fetch origin
git switch --track origin/test/v0.3-b34-browser-real-late-cas
git rev-parse HEAD
git rev-parse origin/test/v0.3-b34-browser-real-late-cas

pnpm run test:oidc:dual:config
if ($LASTEXITCODE -ne 0) { throw "双主体迟到响应离线安全测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run ready
$readyExitCode = $LASTEXITCODE
Write-Host "第十六小批完整质量链退出码：$readyExitCode"
if ($readyExitCode -ne 0) { throw "完整质量链失败" }
```

在**已独立确认本机真实 Keycloak / HTTPS 双 Origin / PostgreSQL Lab**、第二位已预绑定普通测试主体以及显式允许新增专用测试工程的前提下，单独执行：

```powershell
pnpm run test:oidc:dual:late
$lateExitCode = $LASTEXITCODE
Write-Host "真实浏览器迟到 201 专项退出码：$lateExitCode"
if ($lateExitCode -ne 0) { throw "真实浏览器迟到 201 专项失败" }
```

独立浏览器专项必须实际完成并打印“真实迟到 201 专项通过”，不能把启动提示当作成功。此脚本不驱动 React/Vue Studio UI 的保存按钮，也没有人为切断 TCP；客户端 UI 与共享 Session 的端到端晚回包保护仍需另批专项。当前候选**没有 Windows 完整质量链或真实 Lab 联合测试的通过日志**。

## 第三十四批第十六小批 · 真实 Windows 全链与双浏览器专项验收结案

2026-11-17 维护者 Windows PowerShell 实测：`pnpm run test:oidc:dual:config` **16/16**、`vp check` **333/188 零告警错误**、`docs:check` **86 个 Markdown**；完整 `pnpm run ready` 最终 **退出码 0**，包含 **567/567** Vitest、**49/49** NestJS HTTP E2E、SSE 客户端 **8/8**、故障代理 **4/4**、OIDC 工程安全离线 **33/33**、双主体 **16/16** 与双 Web/Server 构建。

另单独运行的 **`pnpm run test:oidc:dual:late` 退出码 0**，验证真实双 Keycloak BFF、React/Vue Origin API、PostgreSQL Lab 工程版本 2→3、暂存已到达的旧 201、旧 CAS 2→409，以及三版版本与审计一致；专用测试工程保留。前文“当前候选无 Windows 结果”属于验收前记录，最新结论以本段为准。

`ready` 与真实交互式专项为**两条分开执行的命令**，日志没有包含本机 `git rev-parse HEAD`；本次只追认已提供的真实退出码，文档补录生成的新提交尚未重新验证。此模式不注入网络 TCP 故障，也不操作 Studio UI 保存按钮；不得扩展结论到生产设备、工业现场或真实 Studio UI 迟到回包 E2E。PR #71 保持 Draft 并指派 `@adui-dev`，未经明确授权不得合并。

## 第三十四批第十七小批 · React/Vue Studio 真实迟到 201 独立验收

仅在隔离本机 Keycloak/HTTPS 双 Web Origin/PostgreSQL Lab 完备、已有两个同租户不同的预绑定普通测试用户时，才能运行显式写入专项。默认 `ready` 只包含 9 项 Node 离线安全测试，**不会创建工程或修改 ACL**。真实专项仅新建两个 UUID 测试工程；第一个主体在 React 与 Vue 分别通过 Studio UI 发出一次真实保存，第二主体从另一个独立浏览器推进到第三版。所有失败路径保留专用测试工程供复核，不删除其他工程、数据卷、用户或授权。

请先核对本地工作区，避免覆盖未提交变更。Windows PowerShell 从项目根执行：

```powershell
git status --short
git fetch origin
git switch --track origin/test/v0.3-b34-studio-real-late-ui
git rev-parse HEAD
git rev-parse origin/test/v0.3-b34-studio-real-late-ui

pnpm run test:oidc:dual:studio:config
$offlineExitCode = $LASTEXITCODE
Write-Host "第十七小批离线安全测试退出码：$offlineExitCode"
if ($offlineExitCode -ne 0) { throw "真实 Studio 迟到 201 离线安全测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run ready
$readyExitCode = $LASTEXITCODE
Write-Host "第十七小批完整质量链退出码：$readyExitCode"
if ($readyExitCode -ne 0) { throw "完整质量链失败" }
```

完成本机 Lab 安全前置核查、允许创建**两个新专用空白工程**后，单独运行（需在隔离 Chrome/Edge 两窗口手动登录两位已预绑定普通测试用户；不得在终端粘贴密码）：

```powershell
pnpm run test:oidc:dual:studio:late
$browserExitCode = $LASTEXITCODE
Write-Host "React/Vue 真实 Studio 迟到 201 退出码：$browserExitCode"
if ($browserExitCode -ne 0) { throw "真实双框架 Studio 迟到 201 专项失败" }
```

验收必须同时看到 React 和 Vue 的“真实 UI 迟到 201、CAS 复核失效、草稿保护与三版审计检查完成”以及最终成功结论和明确退出码 0。浏览器中的版本 POST 必须恰好一次；第二主体真实追加至修订 3；释放第一主体已到达的 201 后，页面因真实只读 GET 发现水位差异清除旧 CAS，重复点击不再写入。比较画布 SVG、草稿数量与 SHA-256、自动保存状态，全过程只显示固定中文阶段。此测试仍不代表物理 TCP 断流、保存中强行上下文切换或生产系统验收。

**当前仅提交验收候选，尚未运行上述 Windows 质量链与真实 Lab 专项。** 运行时务必打印并提供本机 `git rev-parse HEAD`，以便将证据与 PR HEAD 关联；本次只读静态检查不代替端到端验证。

## 第十七小批 · 真实 Studio 专项失败后的复验补充

首轮 Windows 质量链已经有真实日志：离线 9/9、`vp check` 335/190 零警告、`docs:check` 86、完整 `ready` 退出码 0；但真实 `test:oidc:dual:studio:late` 退出码 1，最后确认的成功阶段是“React：真实 201 已到达并挂起 Studio UI，另一主体准备推进版本 3”。原始日志不足以定位具体失败阶段。

诊断补丁会在下一轮分别输出第二主体读取版本 2、追加 CAS 2→3 的结果，以及 Studio 释放真实 201、界面恢复、页面可见、CAS 水位失效和过期保存拒绝的阶段。等待超时时只回显经过白名单筛选的布尔量/计数/枚举，不打印任何 Cookie、Token、工程 ID、身份、URL、响应正文或原始异常。看到哪个阶段未完成及其受控状态后，再据实修复，不延长超时或放宽权限门禁。

**本次诊断补丁后的所有 Windows 检查和真实 Lab 浏览器仍待执行。** 请先拉取 PR 分支最新 HEAD 并记录 `git rev-parse HEAD`，再按本节前面的 PowerShell 质量链步骤运行。质量链通过后，单独运行 `pnpm run test:oidc:dual:studio:late`；真实专项仍需退出码 0，且 React/Vue 两阶段均打印完成，才能结案。

## 第十七小批 · 双主体隔离窗口可见性修复复验

第二轮 Windows 真实浏览器日志已定位：React 真实 BFF 第二主体提交到修订 3，第一主体成功消费旧 201；但 `Page.bringToFront` 后 `visible=false`，专项退出码 **1**。候选使用 CDP 只将**第二主体测试浏览器窗口**设置为 `normal/minimized`，不触碰用户浏览器和现有业务数据，不伪造第一主体可见性。CDP 窗口 API 实际支持性与 Windows 前台行为须由本机测试确认；仍为 hidden 或窗口 CDP 操作拒绝时必须失败，并保留相关测试工程供人工复核。

请确保本地无未提交更改、拉取 PR #72 最新 HEAD，并执行：

```powershell
git status --short
git fetch origin
git switch test/v0.3-b34-studio-real-late-ui
git pull --ff-only origin test/v0.3-b34-studio-real-late-ui
git rev-parse HEAD

pnpm run test:oidc:dual:studio:config
if ($LASTEXITCODE -ne 0) { throw "双窗口离线安全检查失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run ready
$readyExitCode = $LASTEXITCODE
Write-Host "完整质量链退出码：$readyExitCode"
if ($readyExitCode -ne 0) { throw "完整质量链失败" }
```

确认本机隔离 Lab 允许**重新创建两份新 UUID 专用工程**且两位不同预绑定主体均可登录后，单独执行：

```powershell
pnpm run test:oidc:dual:studio:late
$browserExitCode = $LASTEXITCODE
Write-Host "真实 Studio 双窗口专项退出码：$browserExitCode"
if ($browserExitCode -ne 0) { throw "真实 Studio 双窗口专项失败" }
```

本次要真实看到 React **和** Vue 各自完成 201 交付、真实可见性确认、CAS 水位变更后失效、无额外版本写入、画布草稿不变及三版审计，最后退出码 0。若依然 `visible=false`，只保留脱敏阶段日志，不强行设置 `document.visibilityState`。上次专项创建的测试工程仍在本机 Lab，脚本不会删除。

## 第十七小批 · 第三轮本地数据变化专项复验

第三轮真实浏览器证据：React 已真实完成版本 2 提交、另一主体推进版本 3、旧 201 交付和页面可见性恢复，但严格本地数据检查返回失败，专项**退出码 1**。根据脚本顺序，失败已经走到 CAS 只读复核及被拒绝的旧 CAS 再次保存之后。本次只把四种本地变化改成不泄漏内容的布尔诊断，并在五个关键阶段保持原强制比较；不能据此认为 IndexedDB 或 SVG 已被证明安全。

请先查看 `git status --short`，确保当前处于 `test/v0.3-b34-studio-real-late-ui` 分支，再执行 `git fetch origin`、`git pull --ff-only origin test/v0.3-b34-studio-real-late-ui`、`git rev-parse HEAD`。按前文命令依次运行 `pnpm run test:oidc:dual:studio:config`（新目标 **13/13**）、`vp check`、`pnpm run docs:check` 和完整 `pnpm run ready`；各命令最终退出码必须为 0，失败后停止验收。

确认本机隔离 Lab 可以新增两份新的随机专用工程后，再单独执行 `pnpm run test:oidc:dual:studio:late`。如果再出现“本地数据变化”，记录其**固定中文阶段**和 `canvasChanged/autoSaveChanged/draftCountChanged/draftHashChanged` 四项布尔值以及最终退出码，不粘贴 SVG、草稿正文、原始 SHA-256、Cookie、Token、数据库连接和主体标识。本次禁止直接将变化分类为正常自动保存，必须先依据真实状态逐项定位。React 和 Vue 两端及最终三版审计均通过、退出码 0 才能关闭 PR 的真实验收。

## 第十七小批 · 第四轮视口网格快照修复后复验

第四轮真实 Lab 专项失败阶段现已明确为 React 的“CAS 只读复核后”，其中**仅 `canvasChanged=true`**，IndexedDB 草稿整记录哈希与数量、自动保存布尔值均未变化；命令退出码 **1**，Vue/最终 PostgreSQL 审计尚未执行。仓库确认原始 `.studio-svg.innerHTML` 混合了真实图元与随视口变化的辅助网格。候选修复仅对该测试快照忽略一个直系辅助网格矩形，其他 SVG 子节点及草稿/CAS/审计完全严格。

复验前核对工作区状态与当前 PR SHA，不覆盖本地未提交修改：

```powershell
git status --short
git fetch origin
git switch test/v0.3-b34-studio-real-late-ui
git pull --ff-only origin test/v0.3-b34-studio-real-late-ui
git rev-parse HEAD

pnpm run test:oidc:dual:studio:config
$offlineExitCode = $LASTEXITCODE
Write-Host "Studio 视口快照离线测试退出码：$offlineExitCode"
if ($offlineExitCode -ne 0) { throw "Studio 视口快照离线测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run ready
$readyExitCode = $LASTEXITCODE
Write-Host "完整质量链退出码：$readyExitCode"
if ($readyExitCode -ne 0) { throw "完整质量链失败" }
```

仅在受控本机 Keycloak/可信 HTTPS 双 Origin/PostgreSQL Lab 和两名已预绑定普通测试主体都确认就绪，且允许再创建两份随机专用测试工程时，单独执行：

```powershell
pnpm run test:oidc:dual:studio:late
$browserExitCode = $LASTEXITCODE
Write-Host "真实双框架 Studio 迟到响应退出码：$browserExitCode"
if ($browserExitCode -ne 0) { throw "真实双框架 Studio 迟到响应专项失败" }
```

必须看到 React、Vue 两轮均完成真实 201、远端 CAS 3、旧基线清除、画布内容与草稿保护、无额外 POST 和真实数据库三版审计，最终退出码 **0** 才能结案。若修复后 `canvasChanged` 仍为 true，说明剩余 SVG 内容有实际差异，应保持失败、进一步分辨渲染图片和图元差异，不能继续扩大忽略范围。已有历史测试工程保留，不自动删除。

## 第三十四批第十七小批 · Windows 真实双框架最终验收结果（2026-11-17）

维护者 Windows 已经提供完整日志，覆盖 `pnpm run test:oidc:dual:studio:config` **16/16**、`vp check` **335/190 零告警错误**、`docs:check` **86 个 Markdown**、完整 `pnpm run ready` **退出码 0**（Vitest **567/567**、HTTP E2E **49/49**，SSE 8/8、故障代理 4/4，React/Vue/NestJS 类型检查与构建通过）。这与单独的真实 Lab 写入专项是**两条不同的命令**，不能混为一次执行。

另已在严格本机隔离 Lab 下执行 `pnpm run test:oidc:dual:studio:late`，最后明确输出 **退出码 0**。React/Vue 两轮都已完成真正 Studio UI 触发保存、浏览器暂缓交付真实 201、第二主体真实 CAS 2→3、页面重新可见、只读水位复核清除旧基线、禁止额外版本、SVG 内容/IndexedDB 草稿保护及 PostgreSQL 三版审计。两个新建专用工程按设计留存。视口网格属于动态装饰性 SVG，实际快照只排除该一个已知非持久化元素；图元与渲染内容的变化仍为失败。

验收前记录的第一至第四轮失败与候选修复均保留作为复盘，**本节是最新 Windows 验收结论**。本次并没有模拟物理 TCP 丢包，也没有进行工业现场测试。日志未包含本地 `git rev-parse HEAD`，不得追溯绑定确切 Git SHA。补录文档的后续 Git 提交本身仍需下次质量检查；PR #72 保持 Draft / `@adui-dev`，等待维护者明确授权才允许合并。

## 第三十四批第十八小批 · 双框架 409 冲突只读预览复验

**先验条件**：本机 Windows、仓库 `feature/v0.3-b34-conflict-preview` 分支、同一可信 Keycloak HTTPS Lab 的两套 Origin、已预绑定普通测试主体及已有已授权工程。新预览操作全部是已存在的 GET 路由，**不自动创建、追加、删除工程或修改 ACL**；原 `--simulate-save-timing` 浏览器拦截器仍截断所有工程 POST。用户登录由独立临时浏览器按真实 OIDC 流程进行，不能粘贴密码、Token 或 Cookie。

从项目根目录按顺序操作（先确认无未提交修改，不要覆盖本地工作）：

```powershell
git status --short
git fetch origin
git switch --track origin/feature/v0.3-b34-conflict-preview
git rev-parse HEAD
git rev-parse origin/feature/v0.3-b34-conflict-preview

pnpm run test:projects:oidc:config
if ($LASTEXITCODE -ne 0) { throw "工程浏览器离线安全测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run ready
$readyExitCode = $LASTEXITCODE
Write-Host "第十八小批完整质量链退出码：$readyExitCode"
if ($readyExitCode -ne 0) { throw "完整质量链失败" }
```

上述全部通过后，在**已确认本机可信 Keycloak/HTTPS 双 Origin Lab 可供只读验收**的前提下，单独执行：

```powershell
pnpm run test:projects:oidc:save:browser
$browserExitCode = $LASTEXITCODE
Write-Host "第十八小批真实双框架 409 只读预览退出码：$browserExitCode"
if ($browserExitCode -ne 0) { throw "双框架冲突恢复浏览器专项失败" }
```

应能实际看到 React/Vue 两端在合成 409 后通过真实 Studio 操作只读预览最新远端版本，旧 CAS 继续未建立、差异比较可见、画布与 IndexedDB 草稿完全不变；原 401 与 503 故障分支也仍通过。无授权工程或缺少可信 Lab 必须按原规则失败，不能自动授予 ACL 或伪造 HTTP 成功。浏览器临时 Profile 用后销毁。当前候选尚未实际运行本批 Windows `vp check`、`docs:check`、`ready` 或真实浏览器专项。

## 第三十四批第十九小批 · 确认载入后水位复核 Windows 验收

维护者先确保本地工作区没有未提交的修改，并查看分支与 SHA。新候选包含共享 Session **8 项单测**、浏览器离线 **2 项用例**，还将扩展真实 Keycloak/HTTPS 双 Origin 浏览器的确认后版本变化与 409 只读预览再载入验收。所有 OIDC 浏览器非 GET 工程请求仍被测试 Profile 本地拦截，不会写入现有 Lab 工程和 ACL。

```powershell
git status --short
git fetch origin
git switch --track origin/test/v0.3-b34-confirmed-load-race
git rev-parse HEAD

pnpm run test:projects:oidc:config
if ($LASTEXITCODE -ne 0) { throw "确认载入浏览器离线测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run ready
$readyExitCode = $LASTEXITCODE
Write-Host "第十九小批完整质量链退出码：$readyExitCode"
if ($readyExitCode -ne 0) { throw "完整质量链失败" }
```

如本地分支已存在，先 `git switch test/v0.3-b34-confirmed-load-race`，再执行 `git pull --ff-only origin test/v0.3-b34-confirmed-load-race`。这些命令须按顺序确认返回码，不能因为其中一个 Vitest 文件成功便声称完整 `ready` 通过。

若本机可信 Keycloak、双 HTTPS Origin、已预绑定正常用户、授权工程和 PostgreSQL Lab 只读前置均已满足，则再单独执行真实 OIDC 浏览器专项：

```powershell
pnpm run test:projects:oidc:save:browser
$browserExitCode = $LASTEXITCODE
Write-Host "第十九小批确认载入专项退出码：$browserExitCode"
if ($browserExitCode -ne 0) { throw "确认载入浏览器专项失败" }
```

验收需要看到 React **和** Vue 在“确认载入前的模拟远端版本冲突”时保持原画布、草稿和自动保存，确认后合成 HEAD 水位变化拒绝载入；然后正常确认打开工程建立 CAS 基线，409 只读预览最新版后通过真正 UI 确认再次载入恢复 CAS，同时只产生测试 Profile 内的单次被拦截 POST，其他全部为真实受保护 GET。既有 401、503 恢复仍须通过。最终命令退出码为 **0** 才能验收；没有实测日志前所有测试计数均是目标，不是结果。此专项非物理 TCP 断流、非生产/工业现场验收。

## 第三十四批第二十小批 · 真实多标签页 OIDC 会话与 CAS 验收

本批真实浏览器专项使用**一个临时 Chrome/Edge Profile、四个真实标签页、一个普通 Keycloak 测试用户**。React/Vue 使用现有本机 HTTPS Origin；四个标签页共用浏览器 Host Cookie 存储，但身份/工程请求仍只发往当前标签页自己的同源 BFF。运行前确保本机可信 Keycloak、React/Vue HTTPS、NestJS、隔离 PostgreSQL Lab 和 NODE_EXTRA_CA_CERTS 均按现有 AGENTS.md / HARNESS.md 约束就绪。

先执行离线安全用例和完整质量链：

```powershell
git status --short
git fetch origin
git switch --track origin/feature/v0.3-b34-multitab-oidc-session
git rev-parse HEAD

pnpm run test:projects:oidc:multitab:config
if ($LASTEXITCODE -ne 0) { throw "真实多标签页离线安全测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run ready
$readyExitCode = $LASTEXITCODE
Write-Host "第二十小批完整质量链退出码：$readyExitCode"
if ($readyExitCode -ne 0) { throw "完整质量链失败" }
```

在维护者明确确认本机 Lab 数据库名称后，单独运行真实浏览器专项：

```powershell
pnpm run test:projects:oidc:multitab:browser
$browserExitCode = $LASTEXITCODE
Write-Host "第二十小批真实多标签页专项退出码：$browserExitCode"
if ($browserExitCode -ne 0) { throw "真实多标签页 OIDC 专项失败" }
```

交互说明：命令启动一个全新的隔离浏览器窗口，维护者只需手动登录一次已预绑定的普通 Keycloak 测试用户；不要在终端输入或粘贴密码。脚本在本轮专用工程上通过正式 BFF 创建首版，由 React 写入端真实追加 2、Vue 写入端真实追加 3；React/Vue 跟随标签页通过实际切换前台触发服务端水位复核，并点击现有 Studio 保存按钮验证旧 CAS 不产生工程 POST。随后 React 写入端执行真实 /api/v1/auth/logout CSRF 注销，两个跟随标签页分别切回前台，验证真实 401、CAS/授权缓存失效与本地草稿保护。

本轮仅新建一份随机 b34-oidc-cas-UUID 专用工程，保留版本 1/2/3 供维护者复核；不会更改其他工程、既有 ACL、身份映射或现有 Lab 业务数据；新工程仅由现有创建 API 按既定流程创建创建者默认权限，不手工增加其他主体授权。跟随标签页内所有工程非 GET/HEAD 请求始终由页面 Fetch 包装器阻断，必须保持零穿透。隐藏标签页在后台期间不应收到即时身份广播，只有切回前台后才通过真实 BFF 复核；这不是后台推送、物理 TCP 断流或生产/工业现场验收。临时浏览器 Profile 在退出时关闭并清理。

## 第三十四批遗留 PR #75 · React/Vue 同源双标签页 CAS 专项验收

本次在 PR #84 合并之后从最新 `main` 无强制推送地解决旧 PR #75 冲突。先确认本地没有未提交改动，核对 PR #75 分支的 HEAD 与远端一致，再执行离线与完整质量门禁。不要把之前 51/51 HTTP E2E、583/583 Vitest 或 `ready` 退出码 0 当作本分支已验收。

```powershell
git status --short
git fetch origin
git switch ai/b34-same-origin-multitab-cas
git pull --ff-only
git rev-parse HEAD

pnpm run test:oidc:dual:studio:multitab:config
Write-Host "同源双标签页离线测试退出码：$LASTEXITCODE"

vp check
Write-Host "Vite+ 检查退出码：$LASTEXITCODE"

pnpm run docs:check
Write-Host "文档检查退出码：$LASTEXITCODE"

pnpm run ready
Write-Host "完整质量链退出码：$LASTEXITCODE"
```

离线安全用例**目标 19/19**，GitHub 分支新增 2 个 `.mjs` 文件，自动纳入 `ready` 的仅是本机不写数据库的 Node 离线测试。完整 `ready` 必须实际退出码 0，不能由单独 E2E 或之前分支构建成功替代。新脚本是否符合 Vite+ 格式/Lint、Node 运行及浏览器行为均以维护者 Windows 实测为准。

在本机可信 Keycloak、双 HTTPS Origin、受控 PostgreSQL Lab、已预绑定普通测试用户都就绪，并允许创建本次随机专用测试工程时，另行运行：

```powershell
pnpm run test:oidc:dual:studio:multitab
Write-Host "同源双标签页真实浏览器专项退出码：$LASTEXITCODE"
```

隔离 Chrome/Edge 中只需手动登录一次，**不要将密码、Cookie、Token 或数据库凭据粘贴进终端**。React/Vue 各创建一份随机专用工程，走真实 Studio UI 的版本 1→2→3、后台到前台实际可见性切换、过期 CAS 阻断、只读预览和人工载入、IndexedDB 草稿不变与 SQL 三版审计；测试工程保留，不删除既有数据。专项可能写入**仅本轮随机专用工程**，不允许在生产环境执行，也不允许改动工业设备。

## 第三十五批第二小批 · React/Vue 发布静态预检浏览器专项

第一小批的 Core 静态预检已在 Windows 单测 **593/593**、`vp check` **341/196**、完整 `ready` 退出码 **0** 后经授权合并为 PR #85。此批变更了两端真实 Studio 视图及独立浏览器专项，**必须重新检查代码、类型与布局**。不把上一批质量链结果当作此批成功。

```powershell
git fetch origin
git switch feat/v0.3-b35-studio-release-preflight
git pull --ff-only
git rev-parse HEAD

pnpm run test:unit
Write-Host "单元测试退出码：$LASTEXITCODE"
vp check
Write-Host "Vite+ 检查退出码：$LASTEXITCODE"
pnpm run docs:check
Write-Host "文档检查退出码：$LASTEXITCODE"
pnpm run ready
Write-Host "完整质量链退出码：$LASTEXITCODE"
```

双框架静态预检界面应先使用 `pnpm run dev:react` 与 `pnpm run dev:vue` 在本机可信回环端口启动，再由第三个 PowerShell 会话执行独立无凭据浏览器专项：

```powershell
pnpm run test:release:preflight:browser
Write-Host "双框架发布预检浏览器退出码：$LASTEXITCODE"
```

测试应在隔离 Chrome/Edge Profile 的两套 Web Studio 中，分别核验「发布预检」菜单、通过/失败提示、精确问题路径及恢复后不留旧提示；模拟不兼容 JSON 只导入浏览器当前编辑会话，不保存草稿或服务端版本、不开启 Keycloak、不创建数据库和工业设备写入。测试工具的浏览器 Profile 在退出后会清理。通过后仍不能宣布正式工程发布已实现。浏览器专项**不包含**在 `ready` 中，必须提供独立退出码。

## 第三十五批第三小批 · 本机 HTTPS Studio 浏览器测试探测

`test:browser`、`test:release:preflight:browser` 和同脚本的其他本机 Studio 专项统一使用 `scripts/studio-browser-targets.mjs` 解析 React/Vue 地址。根 `.env` 的 `SCADA_OIDC_DEV_HTTPS_ENABLED=true` 时，两端默认为 `https://127.0.0.1:15173/`、`https://127.0.0.1:15174/`，不再误用 HTTP；未启用时仍使用 HTTP。只允许回环首页，不能以 `SCADA_REACT_URL` / `SCADA_VUE_URL` 将 HTTPS 模式降级为 HTTP 或指向远端。

HTTPS 预检只发匿名 GET，严格校验服务器证书，不转发 Cookie；可通过 `NODE_EXTRA_CA_CERTS` 提供受信任的本机 CA（脚本在读取 `.env` 后为探测请求显式加载），或由 Node 进程使用系统 CA。Chrome/Edge 独立临时 Profile 也须信任相同 CA；不使用 `NODE_TLS_REJECT_UNAUTHORIZED=0`、`--ignore-certificate-errors` 或关闭 OIDC 校验来规避错误。若证书未被信任，应修复本机 CA/证书 SAN，**不得**直接忽略失败。

建议在 Windows 当前 PR HEAD 下先执行：

```powershell
git rev-parse HEAD
pnpm run test:studio:browser:config
Write-Host "浏览器目标安全测试退出码：$LASTEXITCODE"
```

React/Vue 已以相同回环协议启动后，再执行：

```powershell
pnpm run test:browser
Write-Host "双框架布局退出码：$LASTEXITCODE"
pnpm run test:release:preflight:browser
Write-Host "发布预检浏览器退出码：$LASTEXITCODE"
```

本机配置离线测试虽已加入 `ready`，以上真实浏览器专项仍需单独执行，不访问工业设备、不执行正式工程发布或数据库写入。

## 第三十五批第五小批 · 隔离 PostgreSQL 发布预检 HTTP 专项

本批在现有 `apps/server/test/projects-cas-cookie-http.db-spec.ts` 新增 4 项真实 NestJS HTTP + Cookie 会话 + ACL + Prisma 预检回归。**只允许**在已经独立创建、完成迁移的本机 `adui_scada_test` 测试库执行。专项通过 `SCADA_TEST_DATABASE_URL` 检查回环 Host、PostgreSQL 协议及精确数据库名；每例仅以 `test-<随机 UUID>` 租户建立数据，并在 `finally` 清理该租户。包含一例刻意破坏**本次随机测试版本**的摘要元数据并断言 500，严禁在现有业务库、Keycloak 库、生产库或任何非隔离库中执行。

`pnpm run ready` **不会执行**真实 `test:db`；单元测试/Mock E2E 通过不能替代数据库专项。沿用项目既有测试库凭据配置，不要在终端、提交或聊天中输出密码、数据库 URL、Cookie 或 Token。先按原有 PostgreSQL 专项步骤确认测试库已应用最新迁移；只在当前 PowerShell 进程内临时指向专用测试 URL 并在结束后恢复环境变量：

```powershell
git rev-parse HEAD
$testUrl = $env:SCADA_TEST_DATABASE_URL
if (-not $testUrl) { throw "请先按既有流程配置隔离 PostgreSQL 测试库" }
$target = [uri]$testUrl
if ($target.Host -notin @("127.0.0.1", "localhost") -or $target.AbsolutePath -ne "/adui_scada_test" -or $target.Scheme -notin @("postgresql", "postgres")) {
  throw "数据库专项只允许本机 adui_scada_test"
}
$previousDatabaseUrl = $env:SCADA_DATABASE_URL
try {
  $env:SCADA_DATABASE_URL = $testUrl
  pnpm run test:db
  Write-Host "真实 PostgreSQL 专项退出码：$LASTEXITCODE"
} finally {
  if ($null -eq $previousDatabaseUrl) {
    Remove-Item Env:SCADA_DATABASE_URL -ErrorAction SilentlyContinue
  } else {
    $env:SCADA_DATABASE_URL = $previousDatabaseUrl
  }
}
```

并独立执行 `vp check`、`pnpm run docs:check` 与完整 `pnpm run ready`，保留各项退出码。此专项复用测试内部签发的受信会话，**不连接真实 Keycloak 授权码登录/JWKS**；只验证服务端真实隔离数据库路径。严禁为了绕过失败把测试地址改为开发/生产数据库。

## 第三十五批第六小批 · 真实 Keycloak 双 HTTPS Origin 发布预检只读专项

新增 `test:release:preflight:oidc:config`，通过 Node 内置测试验证 `scripts/test-oidc-release-preflight.mjs` 的参数默认拒绝、CDP 函数序列化、同源 GET、版本/摘要校验、无缓存响应、非法版本 400、非当前水位 409、ACL 缺失时跳过及固定中文脱敏诊断。**只有这个不访问网络或数据库的配置专项纳入 `ready`**；真正的浏览器测试不自动运行。

真正的 `test:release:preflight:oidc:browser` 复用现有 `resolveProjectBrowserLab`、隔离 Chrome/Edge 与真实 Keycloak 登录；必须提前启动本机两套有效 HTTPS Web Origin、同源 NestJS BFF、可信 Keycloak Lab、已经通过维护者受控预绑定的普通测试用户，并且该主体至少有一份同时具备 `project:read` 和 `version:read` 的**已保存工程**。不得为通过专项临时修改用户或业务工程 ACL。

单次真实登录后依次核对 React/Vue 两套 HTTPS Origin 的相同 BFF 主体、当前工程摘要、已保存版本摘要及服务端 GET `/api/v1/projects/:projectId/versions/:revision/release-preflight` 返回的 `projectId/revision/headRevision/contentHash/passed/issues`，同时核对匿名外的有效会话前提、400 非法版本、409 非当前版本、`Cache-Control: no-store` 和读取后工程 head 不变。浏览器仅发同源 GET，不创建版本、不读取快照正文，不读取或输出 Cookie、Token、密码、工程 ID、Tag 或摘要原文；只输出受控中文阶段结果。脚本不接受任何写入参数，也不直接建立 PostgreSQL 连接。若无同时具备版本读取权限的工程，专项必须失败并让维护者检查现有授权，不能扩大权限或随意创建工程。

Windows 先运行：

```powershell
git rev-parse HEAD
pnpm run test:release:preflight:oidc:config
Write-Host "OIDC 发布预检离线测试退出码：$LASTEXITCODE"
vp check
Write-Host "Vite+ 退出码：$LASTEXITCODE"
pnpm run docs:check
Write-Host "文档退出码：$LASTEXITCODE"
pnpm run ready
Write-Host "质量链退出码：$LASTEXITCODE"
```

再在本机可信 Lab 三套服务均运行时，单独执行：

```powershell
pnpm run test:release:preflight:oidc:browser
Write-Host "真实 Keycloak 发布预检退出码：$LASTEXITCODE"
```

隔离浏览器内人工输入测试账号密码，**不要**在终端、聊天、日志中输入或粘贴密码；绝不关闭 HTTPS/TLS 验证，也不要用远端数据库、生产设备、伪造 Token 或写入工程绕过测试。该专项只验证已有发布前静态只读接口；不代表发布指针、权限变更、回滚或工业运行安全已验收。

## 第三十五批第七小批 · 共享 API Client 服务端发布预检待验收

本批只改变框架无关 `@adui/scada-api-client` 的只读请求契约，新增 8 条 Vitest 单测并补齐既有 Studio CAS 会话 Mock。**不改 React/Vue Studio UI，也不触发真实数据库写入或发布流程。** 在 Windows 确认新功能分支 HEAD 后执行：

```powershell
git rev-parse HEAD
pnpm run test:unit
Write-Host "单元测试退出码：$LASTEXITCODE"
pnpm run test:e2e:server
Write-Host "HTTP E2E 退出码：$LASTEXITCODE"
vp check
Write-Host "Vite+ 退出码：$LASTEXITCODE"
pnpm run docs:check
Write-Host "文档检查退出码：$LASTEXITCODE"
pnpm run ready
Write-Host "完整质量链退出码：$LASTEXITCODE"
```

新增只读 Client 不代表 Studio UI 已有服务端预检展示；双框架集成需后续独立提交并验收，不允许为了“接入”修改 CAS 版本、IndexedDB 草稿或授权范围。若发现 401/404/409 或报告字段不合法，必须按现有安全错误类型拒绝，不能自动创建新工程、静默重试或将本地静态结果冒充服务端许可。

## 第三十五批第八小批 · React/Vue Studio 服务端只读预检验收

此次是独立于本地静态预检的**手动**服务端 GET 入口，必须验证双框架 UI 都显示“检查服务端已保存版本”，且没有点击时绝不提示服务端已通过。共享 `readCurrentServerReleasePreflight` 还必须在版本变化、SHA-256 摘要与快照不匹配、授权拒绝时受控失败，并且任何预检动作均不得写草稿、工程版本、CAS 基线、发布指针或工业设备。

Windows 必须在当前功能分支记录 `git rev-parse HEAD`，执行 `pnpm run test:unit`、`pnpm run test:e2e:server`、`vp check`、`pnpm run docs:check`、完整 `pnpm run ready` 并保留真实退出码；目标 **615/615** Vitest、**55/55** HTTP E2E 仅为新分支待测，不是现有结果。随后分别启动 React/Vue 开发服务，执行 `pnpm run test:release:preflight:browser`，观察原静态合法/不兼容/恢复用例和新的手动服务端按钮安全断言均通过。当前专项不会自动点击新按钮并进行受保护 Keycloak 网络验证；须在未来真实浏览器专项中另外覆盖同源点击、未保存画布标记及 ACL/409 的 UI 行为，不能用离线 Browser UI 结构断言冒充真实 OIDC 端到端成功。

## 第三十五批第九小批 · 真实 Keycloak React/Vue Studio 发布预检 UI 按钮专项

**离线门禁**：`pnpm run test:release:preflight:oidc:studio:config` 使用 Node 内置测试执行 12 项只读/跨域拒绝/按钮选择器/CDP 自包含契约，自动加入完整 `ready`。该命令不打开浏览器，不需要 Keycloak、数据库、账号或人工操作。Windows 先运行：

```powershell
git status --short
git rev-parse HEAD
pnpm run test:release:preflight:oidc:studio:config
Write-Host "Studio 预检离线测试退出码：$LASTEXITCODE"
vp check
Write-Host "Vite+ 退出码：$LASTEXITCODE"
pnpm run docs:check
Write-Host "文档检查退出码：$LASTEXITCODE"
pnpm run ready
Write-Host "完整质量链退出码：$LASTEXITCODE"
```

**真实交互验收**：仅在本机可信隔离 Keycloak Lab、正常 TLS 校验的 React/Vue HTTPS Web、同源 NestJS BFF 全部可用，且预绑定普通用户已拥有至少一份可访问并具备 `version:read` 的已保存工程时，另行执行：

```powershell
pnpm run test:release:preflight:oidc:studio:browser
Write-Host "真实 Studio 发布预检按钮退出码：$LASTEXITCODE"
```

登录仅在测试自动打开的隔离 Chrome/Edge 中人工完成，不得将密码、Token、Cookie、工程正文或数据库连接信息放进终端。脚本只使用真实“工程管理/打开/发布预检”UI 读取已有工程，在临时浏览器中添加**未保存**文本图元以检查版本差异；工程 API POST、DELETE 和跨 Origin 请求在页面初始化前被阻断，409/401/404 仅对当前测试工程的预检 GET 合成响应，绝不更新真实 ACL、CAS/版本、发布指针或现场设备。脚本比较预检前后 SVG、JSON SHA-256、草稿整体摘要、自动保存与 CAS；401/404 预期使远端访问基线失效但本地内容不丢失。真实 HTTP 400/409 和数据库摘要另由原 `test:release:preflight:oidc:browser` 覆盖，二者不可混记。

真实 UI 专项属于**单独交互命令**，不能自动加入 `ready` 或通过伪造 Keycloak 登录、关闭 TLS、扩展 ACL、临时创建工程来满足测试。新分支 Windows 验收和真实浏览器结果均待维护者执行；本测试通过也不等于 FR-008 正式发布安全验收。

## 第三十五批第十小批 · 编辑期间迟到 401 访问拒绝双框架验收

此批以最小生产修改将 React/Vue 预检的 401/403/404 **会话级拒绝通知**与“请求文档是否仍为当前画布”的局部 UI 检查拆开。真实 OIDC 浏览器专项在模拟的 401 GET 返回前通过正式 UI 编辑文档，再放行旧拒绝；要求远端 CAS 失效、原报告不恢复、画布/IndexedDB/自动保存不因预检修改。只有隔离浏览器的指定 GET 响应被挂起，工程 API 非 GET 永远阻断。不得为测试增加工程 ACL、创建工程或降低 TLS 校验。

Windows 在该功能分支记录 `git rev-parse HEAD` 后执行：

```powershell
pnpm run test:release:preflight:oidc:studio:config
Write-Host "迟到拒绝离线专项退出码：$LASTEXITCODE"
vp check
Write-Host "Vite+ 退出码：$LASTEXITCODE"
pnpm run docs:check
Write-Host "文档检查退出码：$LASTEXITCODE"
pnpm run ready
Write-Host "完整质量链退出码：$LASTEXITCODE"
```

随后在可信本机 Keycloak、BFF、React/Vue HTTPS 两个 Origin 已启动、测试账号有已授权保存工程的前提下，**单独**执行：

```powershell
pnpm run test:release:preflight:oidc:studio:browser
Write-Host "真实迟到拒绝双框架退出码：$LASTEXITCODE"
```

本批 Windows 目标为新离线 **13/13**、Vitest **615/615**、HTTP E2E **55/55** 和完整 `ready=0`，均**待维护者实际执行**，不得将先前 PR #93 的成功外推到新 HEAD。真实浏览器中不手工添加真实工程权限、不输入终端密码、不关闭证书验证；仅允许访问现有授权工程并在隔离页面产生未保存编辑。

## 第三十五批第十一小批 · ADR-0069 安全设计文档验收

本批仅新增 **Proposed** [ADR-0069](adr/0069-release-pointer-atomic-publication-design.md)，不允许为让文档验收通过而顺手修改原有 Prisma 已应用迁移、身份/ACL 代码、React/Vue Studio 或设备网关。核对新 ADR 标题编号、Proposed 状态、相对文档链接和与现有三个工程 ACL/编辑 `headRevision` 契约的一致性；需要维护者明确审查并批准未决项后才考虑下一批真正可写发布事务。

```powershell
git status --short
git rev-parse HEAD
pnpm run docs:check
Write-Host "文档检查退出码：$LASTEXITCODE"
vp check
Write-Host "Vite+ 退出码：$LASTEXITCODE"
pnpm run ready
Write-Host "完整质量链退出码：$LASTEXITCODE"
```

新增一份 ADR 后预计检查 **87 份 Markdown**；此前 PR #94 的 Vitest **615/615**、HTTP E2E **55/55** 和 Vite+ **351/206 零告警**是合并前 Windows 基线，**不得**自动记作本 PR 测试通过。当前没有新代码、接口、迁移、浏览器行为或工业设备写入，因此无需为这份设计文档单独执行真实 Keycloak/数据库写入专项；未来落实正式发布必须先通过额外工业安全评审、隔离数据库迁移与双框架验收。

## 第三十五批第十二小批 · 发布事务决策矩阵文档检查

本批仅提交 ADR-0069 的**待评审决策/测试矩阵**，不添加发布权限、数据库迁移、NestJS 写路由、Runtime 发布指针或任何设备命令。检查 `docs/RELEASE_TRANSACTION_REVIEW.md` 的 R-01～R-08、I-01～I-06、T-01～T-22，确认均明确“候选、待批准或未执行”，ADR-0069 状态仍为 Proposed，FR-008 仍为规划中；链接必须存在且相对路径正确。Windows 在功能分支记录工作区状态和 HEAD 后执行：

```powershell
git status --short
git rev-parse HEAD
pnpm run docs:check
Write-Host "文档退出码：$LASTEXITCODE"
vp check
Write-Host "Vite+ 退出码：$LASTEXITCODE"
pnpm run ready
Write-Host "完整质量链退出码：$LASTEXITCODE"
```

预计 Markdown **88 份**，原有 Vitest **615/615** 和 HTTP E2E **55/55** 均为**待复验的上一批基线**，不是本分支通过证据。此次没有新的 API/迁移/浏览器行为；后续正式发布写事务必须另行取得 ADR/工业安全批准，并完成隔离 PostgreSQL、可信 OIDC 与双框架完整验收。

## 第三十五批第十三小批 · ADR-0069 Accepted 决策文档同步检查

本批维护者已明确批准 ADR-0069 进入 **Accepted**，并批准 R-01～R-08 推荐基线。文档复核应确认：

- ADR-0069 状态为 Accepted，决策记录与 R-01～R-08 的最终结果一致。
- `RELEASE_TRANSACTION_REVIEW.md` 不再将 R-01～R-08 描述为待批准；I-01～I-06 为已批准设计不变量，T-01～T-22 仍是未来测试义务、尚未执行。
- ARCHITECTURE、SDD、REQUIREMENTS、CODEBASE_MAP、PROJECT_CONTEXT 对 ADR 状态和 FR-008 实现状态保持一致。
- FR-008 仍为规划中；Accepted 不代表 Prisma、API、Runtime 或生产发布功能已完成。
- 正式发布/回滚写入、生产双人审批与任何 PLC/DCS 设备写入仍受独立阶段门禁约束。

本 PR 仅同步架构状态文档，不修改代码、Schema、迁移或运行行为。Windows 验收执行：

```powershell
git status --short
git fetch origin
git switch docs/v0.3-b35-release-decision-record
git pull --ff-only
git rev-parse HEAD
pnpm run docs:check
Write-Host "Accepted 决策文档检查退出码：$LASTEXITCODE"
```

文档检查通过只证明 Markdown 结构和链接规则满足仓库检查，不代表未来 T-01～T-22 测试已执行，也不代表发布功能或工业安全验收完成。

## 2026-11-18 · PR #99 正式发布 Schema 迁移与隔离库验收

第三十五批 B 阶段新增迁移 `20261118000000_release_state_and_events`。该迁移必须只在本机独立 `adui_scada_test` 首次/二次部署和验证；根 `.env` 的 `SCADA_DATABASE_URL` 默认可能仍指向开发库 `adui_scada`。**不能在没有临时覆盖 URL 的情况下直接执行 `pnpm run db:migrate:deploy`。**

### 先检查代码，不访问数据库

```powershell
pnpm run db:validate
Write-Host "Schema 校验退出码：$LASTEXITCODE"

pnpm run db:generate
Write-Host "Prisma Client 生成退出码：$LASTEXITCODE"

vp check
Write-Host "Vite+ 退出码：$LASTEXITCODE"
```

### 仅在本机独立 adui_scada_test 执行迁移和数据库测试

下面的步骤从根 `.env` 读取本机开发连接串，仅在当前 PowerShell 进程中将数据库名改为 `adui_scada_test`；同时设置 Prisma CLI 使用的 `SCADA_DATABASE_URL` 和数据库测试必须显式提供的 `SCADA_TEST_DATABASE_URL`。不修改 `.env` 文件，不输出连接串或口令，并在 `finally` 中恢复原环境变量。

```powershell
$originalDatabaseUrl = $env:SCADA_DATABASE_URL
$originalTestDatabaseUrl = $env:SCADA_TEST_DATABASE_URL
$developmentDatabaseUrl = (
  Get-Content .env |
    Where-Object { $_ -match '^SCADA_DATABASE_URL=' } |
    Select-Object -First 1
)
if (-not $developmentDatabaseUrl) {
  throw "根 .env 缺少 SCADA_DATABASE_URL"
}
$developmentDatabaseUrl = $developmentDatabaseUrl.Substring(19)
$testDatabaseUrl = $developmentDatabaseUrl -replace '/adui_scada(?=\?|$)', '/adui_scada_test'
if ($testDatabaseUrl -eq $developmentDatabaseUrl) {
  throw "无法从开发数据库 URL 推导隔离测试数据库 URL"
}
$testUri = [Uri]$testDatabaseUrl
if (
  $testUri.Host -notin @("127.0.0.1", "localhost") -or
  $testUri.AbsolutePath -ne "/adui_scada_test"
) {
  throw "数据库迁移与测试仅允许本机 adui_scada_test"
}

迁移前可以先运行 `pnpm run db:migrate:status` 查看隔离库状态。**本项目当前 Prisma CLI 7.10.1 在存在待执行迁移时，实际会打印 `Following migration have not yet been applied` 并返回退出码 1**；这表示存在 pending migration，不等同于 P3009 失败迁移。必须根据完整输出区分：仅列出待执行迁移时可以继续部署；出现 failed migration / P3009 时立即停止。不要仅因状态命令退出码为 1 就认定数据库故障，也不要把任何退出码 1 自动忽略。

上面“5 条已应用迁移、唯一待执行项为 `20261118000000_release_state_and_events`”是 2026-11-19 首条发布迁移部署前的历史状态。维护者随后已在隔离 `adui_scada_test` 成功应用 `20261118000000_release_state_and_events`，并完成当时版本的二次部署、status 与 41/41 数据库测试。当前 PR #99 又增加了第二条迁移 `20261119000000_release_state_event_integrity`；**本轮尚无证据显示它已在隔离库应用**，因此当前预期 pending 项应是这条第二迁移。部署前若 status 只列出该 pending 项且没有 failed migration / P3009，可继续执行下面的部署；如果出现 failed migration / P3009 或其他连接错误，立即停止。

try {
  $env:SCADA_DATABASE_URL = $testDatabaseUrl
  $env:SCADA_TEST_DATABASE_URL = $testDatabaseUrl

  pnpm run db:migrate:deploy
  if ($LASTEXITCODE -ne 0) { throw "隔离数据库迁移部署失败" }
  Write-Host "隔离数据库迁移部署退出码：$LASTEXITCODE"

  pnpm run db:migrate:deploy
  if ($LASTEXITCODE -ne 0) { throw "隔离数据库二次迁移失败" }
  Write-Host "隔离数据库二次迁移退出码：$LASTEXITCODE"

  pnpm run db:migrate:status
  if ($LASTEXITCODE -ne 0) { throw "隔离数据库迁移状态检查失败" }
  Write-Host "隔离数据库迁移状态退出码：$LASTEXITCODE"

  pnpm run test:db
  if ($LASTEXITCODE -ne 0) { throw "隔离 PostgreSQL 数据库测试失败" }
  Write-Host "隔离 PostgreSQL 数据库测试退出码：$LASTEXITCODE"
}
finally {
  if ($null -eq $originalDatabaseUrl) {
    Remove-Item Env:SCADA_DATABASE_URL -ErrorAction SilentlyContinue
  }
  else {
    $env:SCADA_DATABASE_URL = $originalDatabaseUrl
  }

  if ($null -eq $originalTestDatabaseUrl) {
    Remove-Item Env:SCADA_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  }
  else {
    $env:SCADA_TEST_DATABASE_URL = $originalTestDatabaseUrl
  }
}
```

如果当前 PowerShell 的根 `.env` URL 不符合上述路径替换规则，应由维护者在本机安全设置正确测试 URL；**不得**为了继续测试把数据库目标改成 `adui_scada`、Keycloak 库、远端数据库或生产数据库。真实数据库测试文件会因缺少 `SCADA_TEST_DATABASE_URL` 而在加载阶段拒绝运行，这是预期安全保护，不应删除。

### 2026-11-18 · `adui_scada` 失败迁移只读结果已确认

维护者已成功执行上方只读检查，实际结果如下：

- `current_database()`：`adui_scada`。
- `_prisma_migrations` 中存在 `20261118000000_release_state_and_events`：`started_at` 为 `2026-11-18 07:03:15.496457+00`，`finished_at IS NULL`、`rolled_back_at IS NULL`。
- `scada_project_grants_permission_check` 存在，但定义仍只允许 `project:read`、`version:read`、`version:append`。
- `scada_project_release_events` 与 `scada_project_release_state` 均不存在。
- 只读命令退出码 0。

这确认了原迁移的部分 DDL：首条权限约束已经提交，后续两张发布表没有创建。不能把它称为“迁移整体回滚”。目前没有查询到发布表或发布事件；这也不等于对整个数据库所有业务数据做过完整审计。

### 修复后的迁移恢复设计（尚未执行）

PR #99 已将迁移开头改为在同一事务内：

1. `DROP CONSTRAINT IF EXISTS scada_project_grants_permission_check`；
2. 重新创建包含五项权限的同名 CHECK；
3. 创建发布事件/状态表、约束、索引，回填既有工程的 generation=0 状态并写入中文注释；
4. 最后提交事务。

因此它既适用于全新隔离库，也能在 Prisma 将旧失败迁移标记为 rolled back 后替换本次遗留的三项权限 CHECK。静态源码检查不能代替真实 PostgreSQL 验证。

**恢复 `adui_scada` 前置条件：**

- 先在独立 `adui_scada_test` 完成修复迁移首次部署、二次部署、`migrate status` 和 `test:db`。
- 对 `adui_scada` 完成可恢复备份并验证备份可读。
- 由维护者明确授权对现有开发库执行迁移元数据和 Schema 写操作。

取得上述授权后，恢复顺序才是：确认 `SCADA_DATABASE_URL` 指向本机 `adui_scada` → 执行 `prisma migrate resolve --rolled-back 20261118000000_release_state_and_events` → 执行修复后的 `prisma migrate deploy` → 执行 `prisma migrate status` 并再次只读核对权限 CHECK 和两张发布表。使用仓库 Prisma 7 CLI 与 `apps/server/prisma.config.ts`；不得手工编辑 `_prisma_migrations`，不得执行 reset、DROP、DELETE 或重置数据库。**在维护者明确授权前，上述恢复命令不得执行。**

### 已经在错误数据库上出现失败迁移时

如果 `migrate deploy` 日志显示目标为 `adui_scada`，并且迁移状态为 P3018/P3009：

- 在迁移状态、部分 DDL 未核实前，停止再次执行 `migrate deploy`、`migrate resolve` 或任何 DROP/DELETE/手工清理。
- 不要假设 Prisma 自动回滚了迁移中此前成功的语句。
- **本次 PR #99 的只读结果已于 2026-11-18 由维护者确认**：失败记录未完成且未标记 rolled back；旧三项权限 CHECK 存在；两张发布表不存在，详见上方“只读结果已确认”。
- 当前仍须先完成独立 `adui_scada_test` 的修复迁移验收、开发库备份和维护者明确授权，才可按上方恢复顺序执行 `migrate resolve --rolled-back` 与重试。不要把开发库的失败状态带入隔离测试库验收。

只读检查使用仓库当前唯一 Compose 文件 `deploy/docker/compose.yaml` 和服务 `postgres`；`compose.postgres.dev.yaml` 已不在当前仓库。命令必须同时加载根 `.env` 与本机 `.local/docker/compose.env`，后者提供 Compose 所需的本机随机配置。

只读检查示例（不会修改数据库）：

```powershell
docker compose -p adui-scada --env-file .env --env-file .local/docker/compose.env -f deploy/docker/compose.yaml exec -T postgres psql -U adui_scada -d adui_scada -v ON_ERROR_STOP=1 -c "SELECT current_database();" -c "SELECT migration_name, started_at, finished_at, rolled_back_at FROM public._prisma_migrations WHERE migration_name = '20261118000000_release_state_and_events';" -c "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.scada_project_grants'::regclass AND conname = 'scada_project_grants_permission_check';" -c "SELECT to_regclass('public.scada_project_release_events') AS release_events, to_regclass('public.scada_project_release_state') AS release_state;"
```

以上查询仅用于判断迁移失败前是否留下了部分 DDL；不要公开连接凭据或修改查询为写操作。

## 2026-11-19 · 发布状态表加入后的 PostgreSQL 测试夹具清理顺序

第三十五批 B 阶段新增 `scada_project_release_state`，其工程外键使用 `ON DELETE RESTRICT`；状态行还可引用最后一次发布事件。发布事件又通过外键引用工程及不可变历史版本。因此真实 PostgreSQL 测试夹具的清理顺序必须遵循外键引用方向：

1. `scadaProjectReleaseState.deleteMany`：先删除发布状态，解除其对工程和最后发布事件的引用。
2. `scadaProjectReleaseEvent.deleteMany`：再删除发布事件，解除其对工程历史版本的引用。
3. 删除工程审计。
4. 删除工程历史版本。
5. 删除工程授权。
6. 删除工程。
7. 最后按各测试自身关系清理认证会话和身份。

不得先删除事件再删除仍引用该事件的状态；不得通过放宽外键、使用 CASCADE 或跳过 finally 清理来让测试通过。任何新增带 `RESTRICT` 外键的表，都必须同步检查所有 DB spec 的 fixture teardown / afterAll。

PR #99 已将该顺序同步至双 Cookie HTTP、工程版本和工程 API 三个 PostgreSQL 测试文件。维护者 2026-11-19 Windows 在隔离 `adui_scada_test` 复验 `pnpm run test:db`：5/5 文件、41/41 项通过，双 Cookie HTTP CAS 11/11 通过，退出码 0。

## 2026-11-19 · 正式发布 Schema 隔离 PostgreSQL 验收结果

维护者 Windows 在本机隔离库 `adui_scada_test`（`127.0.0.1:15432`）完成以下实测：

1. 首次 `pnpm run db:migrate:deploy`：成功应用 `20261118000000_release_state_and_events`，退出码 0。
2. 二次 `pnpm run db:migrate:deploy`：提示 `No pending migrations to apply`，退出码 0。
3. `pnpm run db:migrate:status`：提示 `Database schema is up to date!`，退出码 0。
4. `pnpm run test:db`：5/5 文件、41/41 项通过，退出码 0；包括双 Cookie HTTP CAS 11/11、工程版本 12/12、工程 API 7/7、OIDC Schema 6/6、发布 Schema 5/5。

测试中服务端记录的“数据库工程版本元数据与快照不一致”来自主动篡改摘要的安全用例；用例预期受控 HTTP 500，并检查内部异常不泄漏，Vitest 将其判定为通过。

维护者随后执行完整 `pnpm run ready`，最终退出码 0。`ready` 包含 618/618 单元测试、55/55 HTTP E2E、354 文件格式正确、207 受检文件零警告/错误、88 份 Markdown 检查以及 React/Vue/Server 类型检查和构建。`test:db` 是单独的隔离 PostgreSQL 专项，不包含在 `ready` 脚本中。

原开发库 `adui_scada` 的历史失败迁移未在本次操作中恢复；隔离库验收通过不代表开发库已恢复。任何对原库的迁移元数据或 Schema 写入仍需可恢复备份和维护者明确授权。

## 2026-11-19 · PR #97 合并与 PR #99 分支同步

PR #97 已完成维护者 Windows 文档验收后 Squash 合并至 `main`，合并提交为 `8a622f8766856069065ee7d5cbadeb826646e676`。该提交正式将 ADR-0069 Accepted 决策、R-01～R-08 批准基线及对应文档同步纳入主线。

PR #99 已从原功能分支 `c38de5ca38cc619a1128a84b63eca3523f42c9d7` 合流最新 `main`。本次只合并 PR #97 的十份文档变更；PR #99 原有 Prisma Schema、迁移 SQL、权限实现和测试源码保持不变。该同步不执行任何数据库命令，也不触碰原开发库 `adui_scada`。

PR #97 的 Windows `docs:check` 为 89 份 Markdown、退出码 0；该终端记录没有同时提供本地 HEAD，因此不声称其结果严格绑定到 PR #99 同步后的 HEAD。PR #99 同步后仍须在 Windows 最新 HEAD 执行 `vp check` 与 `pnpm run docs:check`；此前 618/618 单测、41/41 隔离 PostgreSQL 测试、55/55 HTTP E2E 和完整 `ready=0` 对应的代码未被本次文档合流修改，但本次同步本身不构成重新执行这些测试的证据。

PR #99 继续保持 Open / Draft，Assignee 为 `@adui-dev`。原开发库 `adui_scada` 的失败迁移仍冻结；恢复操作必须等待可恢复备份和维护者单独明确授权。

## 2026-11-19 · PR #99 发布状态复合外键增量迁移验收

PR #99 在原发布 Schema 迁移已应用后新增 20261119000000_release_state_event_integrity。**不得回改已应用的 20261118000000_release_state_and_events**；新迁移只在独立测试库增加复合唯一索引和复合外键，绑定租户、工程、发布代次、修订号与 SHA-256 摘要。

维护者此前已在本机隔离 adui_scada_test 成功应用第一条发布 Schema 迁移。当前复验应先通过本节上方原有 PowerShell try/finally 隔离 URL 流程确认 SCADA_DATABASE_URL 和 SCADA_TEST_DATABASE_URL 均指向 127.0.0.1:15432/adui_scada_test，再执行：

1. pnpm run db:validate 与 pnpm run db:generate。
2. pnpm run db:migrate:deploy，应只应用新增的 20261119000000_release_state_event_integrity。
3. 再次执行 pnpm run db:migrate:deploy，应无待执行迁移。
4. 执行 pnpm run db:migrate:status，确认 up to date。
5. 执行 pnpm run test:db，重点检查发布 Schema 复合外键负向用例。

新增测试会尝试将工程 A 的事件关联到同租户工程 B，并尝试不匹配的代次、版本摘要和事件目标摘要；所有错误关联都必须被 PostgreSQL 外键拒绝，正确关联必须成功。测试 finally 必须按发布状态、发布事件、历史版本、工程的顺序清理。

本轮迁移和测试只允许访问本机 adui_scada_test。原开发库 adui_scada 的失败迁移仍处于冻结状态；不得对其执行 migrate resolve、migrate deploy、DROP、DELETE、reset 或手工修改 _prisma_migrations。必须等待可恢复备份和维护者单独明确授权。

## 2026-11-19 · PR #99 E-065 修复后工程质量链与第二条迁移验收通过

维护者 Windows 最新日志：`pnpm run test:unit` 51/51 文件、620/620 项通过；`vp check` 355 文件格式正确、207 受检文件零警告/Lint/类型错误；`docs:check` 89 个 Markdown 通过；完整 `pnpm run ready` 最终退出码 0，包含 55/55 HTTP E2E 与 React/Vue/NestJS 构建。Prisma Client 7.10.1 在单测和完整质量链中生成成功。随后隔离 PostgreSQL 第二条迁移首次/二次部署、status 均退出码 0，`test:db` 5/5 文件、42/42 项通过。数据库测试日志中“数据库工程版本元数据与快照不一致”的 TypeError 来自主动篡改随机测试租户摘要的预期负向 HTTP 500，用例通过。维护者终端记录未包含 `git rev-parse HEAD`，不能虚构本地 SHA；远端分支在本轮记录时为 `d217dde085a5654d8dfe4cc01ef3756ab338466e`，该提交只调整三份文档格式，不修改业务代码或迁移。

**质量链与数据库专项是两类独立验收**：根 `ready` 脚本没有执行 `db:migrate:deploy`、`db:migrate:status` 或 `test:db`，因此本轮分别执行。此前 41/41 对应首条发布迁移；本轮新增第二条迁移后，最终真实数据库结果为 42/42。

当前隔离库此前已应用首条 `20261118000000_release_state_and_events`。维护者随后已按本节上方 PowerShell `try/finally` 模板完成第二条迁移验收，实际结果记录如下：

1. 根 `.env` 保持开发 URL，不修改文件；当前 PowerShell 进程中的 `SCADA_DATABASE_URL` 与 `SCADA_TEST_DATABASE_URL` 临时指向本机 `127.0.0.1:15432/adui_scada_test`。
2. 第二条 `pnpm run db:migrate:deploy` 首次部署成功应用 `20261119000000_release_state_event_integrity`，退出码 0。
3. 二次 `pnpm run db:migrate:deploy` 输出 `No pending migrations to apply`，退出码 0。
4. `pnpm run db:migrate:status` 输出 `Database schema is up to date!`，退出码 0。
5. `pnpm run test:db`：**5/5 文件、42/42 项通过**，退出码 0；`release-schema.db-spec.ts` 6/6，跨工程事件引用、错误代次、错误状态摘要、错误事件目标摘要均被拒绝，正确状态/事件关联成功。
6. PowerShell `finally` 恢复两个原环境变量。

上述是维护者本轮实际结果，不再是待执行步骤。若未来重新创建隔离库或重新验证迁移，仍必须按前述保护模板执行；出现 failed migration / P3009 时立即停止。

迁移前若只看到 pending migration，按 E-060 检查完整输出后可部署；若出现 failed migration / P3009、连接目标不是本机隔离库或任何环境校验不匹配，立即停止。**禁止**把测试目标改成开发库 `adui_scada`、OIDC Lab 库、远程数据库或生产数据库。

原开发库 `adui_scada` 的 `20261118000000_release_state_and_events` 失败迁移继续冻结；未经可恢复备份与维护者单独明确授权，不得执行 `migrate resolve`、`migrate deploy`、reset、DROP、DELETE 或手工修改 `_prisma_migrations`。

## 2026-11-19 · 第三十五批 C1 正式发布事务真实 PostgreSQL 验收入口

新增 `apps/server/test/release-transaction.db-spec.ts`，由 `apps/server/vitest.config.db.ts` 的既有 DB 专项配置发现。该测试使用真实 NestJS HTTP、Cookie/CSRF、Prisma 和 PostgreSQL，覆盖：

- 发布事件与状态指针同事务提交、编辑 head 保持不变。
- 同幂等键同语义重放、同键异语义冲突、不同幂等键重复发布同一修订保守拒绝。
- 新 head 发布时事件来源版本指向上一已发布快照。
- 同一工程相同预期发布代次并发时最多一个成功。
- 发布事务持有会话/身份及 ACL 共享行锁期间，撤销/撤权事务等待发布结束。
- 独立发布 ACL 缺失、静态预检失败、会话撤销时不产生成功发布事件。

生产 Provider 的 `ProjectReleaseSafetyGate` 仍固定 fail-closed。只有该 DB spec 的测试 Nest 模块替换为测试门禁，目的是隔离验证事务、CAS、幂等和行锁，不代表生产请求可以成功发布。

执行前必须使用本文件既有 PowerShell `try/finally` 流程，确保 `SCADA_DATABASE_URL` 与 `SCADA_TEST_DATABASE_URL` 均指向本机 `127.0.0.1:15432/adui_scada_test`；测试文件自身还会校验 `SCADA_TEST_DATABASE_URL` 的协议、主机和数据库名。随后执行 `pnpm run test:db`。该脚本会构建 Core、生成 Prisma Client，并使用 `vitest.config.db.ts` 执行全部数据库专项。

本批不新增迁移，不需要对任何数据库执行 `migrate deploy`。不得将连接指向原开发库 `adui_scada`、远程库或生产库；发生 P3009、failed migration、连接目标不符或状态不明时立即停止。每项随机租户/工程测试必须在 finally 按 RESTRICT 外键依赖顺序清理，不能放宽外键或跳过清理。

## 2026-11-19 · 第三十五批 C1 PostgreSQL 测试重跑（仅设置隔离 URL，不执行迁移）

C1 没有新增 Prisma 迁移；PR #99 的两条 B 阶段迁移此前已在本机隔离 `adui_scada_test` 完成首次/二次部署和真实 Schema 验收。因此 C1 重跑只执行 `pnpm run test:db`，**不要再次运行 `db:migrate:deploy`、`db:migrate:status`，也不要修改根 `.env`**。

必须在仓库根目录的同一个 PowerShell 会话中完整执行下面代码。它从根 `.env` 读取 `SCADA_DATABASE_URL`，只在当前进程将数据库名替换为 `adui_scada_test`，同时设置 Prisma 使用的 `SCADA_DATABASE_URL` 和测试文件强制要求的 `SCADA_TEST_DATABASE_URL`；不会输出连接串或口令，并在 `finally` 中恢复两个原值。

`SCADA_TEST_DATABASE_URL` 缺失时，六个 DB spec 会在模块加载阶段拒绝运行，这是预期 fail-closed 保护，不得删除或绕过。

```powershell
$originalDatabaseUrl = $env:SCADA_DATABASE_URL
$originalTestDatabaseUrl = $env:SCADA_TEST_DATABASE_URL
$testExitCode = $null

try {
  $developmentDatabaseEntry = (
    Get-Content .env |
      Where-Object { $_ -match '^SCADA_DATABASE_URL=' } |
      Select-Object -First 1
  )
  if (-not $developmentDatabaseEntry) {
    throw "根 .env 缺少 SCADA_DATABASE_URL"
  }

  $developmentDatabaseUrl = $developmentDatabaseEntry.Substring(19)
  $testDatabaseUrl = $developmentDatabaseUrl -replace '/adui_scada(?=\\?|$)', '/adui_scada_test'
  if ($testDatabaseUrl -eq $developmentDatabaseUrl) {
    throw "无法从开发数据库 URL 推导隔离测试数据库 URL"
  }

  $testUri = [Uri]$testDatabaseUrl
  if (
    $testUri.Scheme -notin @("postgresql", "postgres") -or
    $testUri.Host -notin @("127.0.0.1", "localhost") -or
    $testUri.AbsolutePath -ne "/adui_scada_test"
  ) {
    throw "PostgreSQL 专项仅允许连接本机 adui_scada_test 隔离数据库"
  }

  $env:SCADA_DATABASE_URL = $testDatabaseUrl
  $env:SCADA_TEST_DATABASE_URL = $testDatabaseUrl

  pnpm run test:db
  $testExitCode = $LASTEXITCODE
  Write-Host "PostgreSQL 专项退出码：$testExitCode"
}
finally {
  if ($null -eq $originalDatabaseUrl) {
    Remove-Item Env:SCADA_DATABASE_URL -ErrorAction SilentlyContinue
  }
  else {
    $env:SCADA_DATABASE_URL = $originalDatabaseUrl
  }

  if ($null -eq $originalTestDatabaseUrl) {
    Remove-Item Env:SCADA_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  }
  else {
    $env:SCADA_TEST_DATABASE_URL = $originalTestDatabaseUrl
  }
}

if ($null -eq $testExitCode) {
  throw "PostgreSQL 专项未执行，请检查前置环境错误"
}
if ($testExitCode -ne 0) {
  throw "PostgreSQL 专项未通过，退出码：$testExitCode"
}
```

执行前确认根 `.env` 中的开发 URL 是本机 `127.0.0.1:15432/adui_scada`；上述脚本只替换数据库路径，若根 URL 不是该本机开发库，应停止并由维护者在本机安全设置正确的隔离测试 URL，不能改指向远程或生产环境。测试文件还会独立校验测试 URL 的协议、主机和数据库名。

本次用户首次裸跑 `pnpm run test:db` 时，6 个 Suite 均在导入阶段因缺少 `SCADA_TEST_DATABASE_URL` 退出，0 个测试执行；没有证据显示 PostgreSQL 已连接或数据库发生写入。按本节完整脚本重跑后，再依据 Vitest 实际统计和最终退出码记录结果。原开发库 `adui_scada` 的历史失败迁移继续冻结。

## 2026-11-20 · D5b1 真实 Keycloak/HTTPS 已授权发布只读专项

D5a 无授权 404 双端验收已于 PR #106 在 Windows 真实浏览器通过。D5b1 是独立候选，**不提供任何数据库准备、授权或发布写入命令**。只能在严格本机可信 OIDC Lab 里由有授权的维护者事先准备带 `release:read` 的专用工程；该权限独立于 `project:read` / `version:read`。用于 `UNRELEASED` 的工程必须未发布且 `releaseGeneration=0`，用于 `RELEASED` 的工程必须已有合法提交的发布快照和事件。默认 `ProjectReleaseSafetyGate` 禁止正式发布，不得为了生成测试数据而绕过、关闭或修改该门禁。

离线代码门禁（加入 `pnpm run ready`）：

```powershell
pnpm run test:published:oidc:authorized:config
vp check
pnpm run docs:check
pnpm run ready
```

真实只读专项需确认本机 HTTPS 双 Origin、Keycloak 预绑定主体和原有证书信任后**手动执行**。**不要复制示例 UUID 作为真实工程**；先由有权维护人员确认工程确实存在于指定隔离数据库、当前 Keycloak 主体已被独立授予 `release:read` 且预期发布代次正确，再人工输入真实专用工程 ID：

```powershell
$unreleasedProjectId = Read-Host "输入真实存在且已授权的 D5b1 未发布隔离工程 ID"
pnpm run test:published:oidc:authorized:browser --status UNRELEASED --project-id $unreleasedProjectId
Write-Host "D5b1 未发布专项退出码：$LASTEXITCODE"

# 只有在已存在合法、真实的隔离发布快照时才执行
$releasedProjectId = Read-Host "输入真实存在且已授权的 D5b1 已发布隔离工程 ID"
pnpm run test:published:oidc:authorized:browser --status RELEASED --project-id $releasedProjectId
Write-Host "D5b1 已发布专项退出码：$LASTEXITCODE"
```

若尚未合法预置，应该停止真实授权验收并先确认隔离数据准备流程；独立 `release:read` 权限不可由 `project:read` 或 `version:read` 代替。HTTP 404 只表示工程不存在或无读取授权，不得推断更具体的数据库情况。

如果缺少预置 `RELEASED` 合法快照、身份未授权、数据库未隔离或状态不一致，**测试应退出 1**，将该场景标记为“未完成前置条件”，不能跳过真实响应断言、手工修改 DB 发布状态或把 HTTP Mock 当作真实验收。全程不读取工程编辑 head、草稿、Cookie、Token，也不发起任何工程写入请求。ACL 撤销、页面隐藏恢复和断网由后续专项覆盖。

## 2026-11-20 · D5b1 已授权本机未发布专用工程准备入口（PR #107，待实测）

维护者已对本机 Docker `adui_scada` 数据库的**一个**专用 D5b1 未发布工程与该工程的 `lab-engineer` 独立 `release:read` 授权作出明确许可。此前已以独立恢复副本演练失败迁移，原开发库修复七条迁移成功，保留 39 工程、168 ACL、39 条未发布状态、0 发布事件。**这些历史数字不代表本批新增夹具已经创建。**

新增 `pnpm run oidc:lab:published:unreleased`：默认只读预检，校验严格本机 OIDC/HTTPS 双 Origin、`127.0.0.1:15432/adui_scada?schema=public`、三条发布迁移、零未处理迁移、`lab-tenant/lab-engineer` 的 active 身份和可信 Keycloak Issuer 预绑定，并拒绝已有 `d5b-unreleased-%` 夹具。不会打印数据库密码或 Keycloak 凭据。

```powershell
git rev-parse HEAD
pnpm run test:published:oidc:fixture:config
pnpm run oidc:lab:published:unreleased
Write-Host "D5b1 夹具只读预检退出码：$LASTEXITCODE"
```

上面全部通过且确认正式 Lab 已启动后，再由维护者在真实浏览器中手动登录已预绑定 Keycloak 用户，**显式运行一次**：

```powershell
pnpm run oidc:lab:published:unreleased --apply --confirm-lab adui_scada
Write-Host "D5b1 夹具准备退出码：$LASTEXITCODE"
```

执行过程以真实 `/api/v1/projects` Cookie/CSRF 同源 POST 创建随机 `d5b-unreleased-<UUID v4>` 工程；由服务端现有 `PrismaProjectVersionStore.create` 原子建立首版快照、审计、创建者三项基础权限及未发布状态。随后使用独立 PostgreSQL `SERIALIZABLE` 事务在严格核对该新工程首版、审计、ACL、代次 0、零事件后，**只新增该工程创建主体的一条 `release:read` 授权**；最后由真实浏览器 GET `/releases/current` 验证 HTTP 200 与 `UNRELEASED`。不会授予 `release:publish` / `release:rollback`，不会直接写入快照或发布指针，也不会修改已有工程。

**非原子边界**：创建工程与 ACL 写入是跨 HTTP/SQL 的两段提交。如后续授权或验证失败，专用工程可能已创建但尚未授权；脚本会报告其工程 ID 并停止，不会自动执行危险的 DELETE 或重跑创建。遇到这类失败必须先只读核查，不能重复运行 `--apply` 或手工绕过 ACL 校验。

成功后复制工具输出的**真实**工程 ID（不使用文档的示例 ID）运行：

```powershell
$projectId = Read-Host "输入刚刚创建的 D5b1 未发布工程 ID"
pnpm run test:published:oidc:authorized:browser --status UNRELEASED --project-id $projectId
Write-Host "真实授权双框架退出码：$LASTEXITCODE"
```

新增 `test:published:oidc:fixture:config` 9 项 Node 安全门禁并加入 `ready`；真实写入脚本不会随 `ready` 自动运行。本批脚本已提交候选，但尚未在维护者 Windows 执行、未创建数据库夹具，不能冒称已验收。生产 `ProjectReleaseSafetyGate` 和工业设备写入继续关闭；`RELEASED` 快照、撤权和离线恢复仍是独立后续专项。

## 2026-11-20 · 第三十五批 D5b2 双框架 UNRELEASED 离线恢复（Draft 待 Windows 验收）

PR #107 已经由维护者提供真实双 HTTPS Origin `UNRELEASED` 成功验收日志并授权 Squash Merge，`main` 提交 `956dd521deea849b76a4c9c2503154d81a09eace`。本小批沿用当时已创建、已授权的单一只读工程 `d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca`，不再次执行夹具 `--apply`、不增加授权、不开发布或设备写入。

新增 `test:published:oidc:offline:config` 9 项 Node 安全门禁并纳入 `ready`。新增 `test:published:oidc:offline:browser` 专项仅接受 `--project-id d5b-unreleased-<UUIDv4>`，复用真实 Keycloak/BFF 会话、React 与 Vue 两个可信 HTTPS Origin，严格只读。首次真实 `GET /api/v1/projects/:id/releases/current` 返回 200 `UNRELEASED` 后，点击真实“立即刷新”，在已注册的只读门禁外**仅拦截一次**同源精确发布 GET 并返回本地网络错误；验证前端为 `offline`、无 SVG、无发布代次且质量保持 `UNAVAILABLE`。随后再次点击真实刷新，从服务器实际取得 200 `UNRELEASED` 并清除离线状态；最后点击“停止读取”验证 `idle`、无画面和零额外请求。

**关键时序**：因为 `createScadaApiClient` 在组件挂载时捕获 `globalThis.fetch`，网络故障层必须在运行页首次挂载**之前**安装，只在首次真实 GET 200 后 `arm`。注入只发生于浏览器 JS Fetch 层，不是真实物理 TCP 故障，也不会触碰 Keycloak、数据库、服务器或其他窗口。该专项的真实浏览器及 Windows 全量质量链尚未执行，任何成功声明需以实际退出码为准。

```powershell
pnpm run test:published:oidc:offline:config
vp check
pnpm run docs:check
pnpm run ready

$projectId = "d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca"
pnpm run test:published:oidc:offline:browser --project-id $projectId
Write-Host "D5b2 真实离线恢复退出码：$LASTEXITCODE"
```

本小批不修改运行时业务代码；已发布 `RELEASED`、ACL 真撤销及真实网络 TCP 故障仍未由此验收，生产发布写入门禁保持关闭。

## 2026-11-20 · D5b3 双框架发布读取模拟 HTTP 404 拒绝与恢复（Draft 待实测）

维护者已在 PR #108 的 HEAD 完成 React/Vue 真实 Keycloak/HTTPS D5b2 单次 Fetch 网络失败→离线清理→真实恢复专项（退出码 0），完整 `pnpm run ready` 退出码 0、680/680 单测、62/62 服务端 E2E；PR #108 已 Squash 合并（`0b073e574daf93c9b521c53bf56a8ebdc125a525`）。

本小批**复用已有** D5b1 专用未发布工程 `d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca`，在真实已登录的同源页面先完成真实 HTTP 200 与 `UNRELEASED` 校验；在已安装的只读门禁外、发布页挂载前安装一次性模拟层，只在首次成功后启用。点击真实“立即刷新”时仅为完全匹配的工程发布 GET 构造本地 HTTP 404 Response，验证 React/Vue 均进入 `denied`，清除发布代次/快照并保持 Tag 质量 `UNAVAILABLE`；再次点击真实刷新必须转发到服务器并获取 HTTP 200、恢复 `UNRELEASED`；最后点击停止读取，验证 `idle` 和零额外工程请求。模拟 404 不转发给服务器，真实服务器日志不会出现该次模拟拒绝。

**边界**：此专项只是在浏览器 Fetch 层**模拟访问拒绝**，绝不撤销 PostgreSQL `release:read` ACL，不触发真正的授权服务端拒绝，不修改 Keycloak 会话、工程版本、发布指针或工业设备。不把“模拟 404”当作“真实 ACL 已撤销”。任何真实撤权需单独授权、隔离准备、服务端状态核对与回收方案。

```powershell
git fetch origin
git switch --track origin/test/b35-d5b3-published-runtime-denial-recovery
git rev-parse HEAD

pnpm run test:published:oidc:denied:config
vp check
pnpm run docs:check
pnpm run ready
Write-Host "完整质量链退出码：$LASTEXITCODE"

$projectId = "d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca"
pnpm run test:published:oidc:denied:browser --project-id $projectId
Write-Host "D5b3 真实浏览器退出码：$LASTEXITCODE"
```

新 Node 9 项门禁加入 `ready`；真实 Keycloak 登录浏览器专项**不**自动执行。该脚本编写及远程提交不等于 Windows 上实际成功，目前新增测试和浏览器专项待维护者验收。

## 2026-11-20 · 第三十五批 D5b4a 真实 ACL 撤销前只读预检（Draft 待 Windows 验收）

维护者 D5b3 Windows 实测 `test:published:oidc:denied:config` **9/9**、`vp check` **380 文件格式正确、232 文件零告警**、`docs:check` **89 份**、`ready` **680/680 单元测试、62/62 E2E、最终退出码 0**；React/Vue 真实 Keycloak/HTTPS 先真实 200→浏览器模拟单次 404→真实 200 恢复、两端均通过，专项退出码 0。PR #109 经明确授权 Squash 合并至 `main`（`33c8d31d8eae6c46b8a3ab5ddaabf44a3f8fa227`）。该结果仅为浏览器模拟拒绝，不能代替真实 PostgreSQL ACL 撤销。

D5b4 必须新建单独 `d5b4-revoke-<UUID v4>` 测试工程（**本批不创建**），通过正式同源 API 与最小授权准备，然后在维护者后续**单独授权**的本机 Lab 中演练真实 `release:read` 撤销，验证原已授权会话在 React/Vue 两端返回服务端真实 HTTP 404、页面清空且无越权内容；保留 D5b1 的既有 `d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca` 工程和四项权限，确保之前 D5b1～D5b3 可继续回归。

本 D5b4a 只新增**只读准备检查**，用现有 `resolvePublishedFixtureTarget` 验证 Keycloak/可信 HTTPS 双 Origin、本机 `127.0.0.1:15432/adui_scada?schema=public`；在 PostgreSQL `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY` 中只执行 SELECT，检查当前连接用户、三条发布迁移和零未处理失败、预绑定 active 主体、原 D5b1 工程首版和单次审计、发布代次 0、零事件、创建者 `project:read/version:read/version:append/release:read` 四项 ACL，以及当前租户尚无 `d5b4-revoke-%` 专用工程。最终总是执行 ROLLBACK，并在 `finally` 关闭数据库连接。预检不输出密码/令牌/工程正文。

```powershell
git fetch origin
git switch --track origin/test/b35-d5b4a-release-read-revocation-preflight
git rev-parse HEAD
pnpm run test:published:oidc:revoke:preflight:config
vp check
pnpm run docs:check
pnpm run ready
Write-Host "D5b4a 全量质量链退出码：$LASTEXITCODE"

pnpm run oidc:lab:published:revoke:preflight
Write-Host "D5b4a 真实数据库只读预检退出码：$LASTEXITCODE"
```

**禁止**对上述命令追加 `--apply`、`--run-revoke`、`--confirm-lab` 或 `--project-id`；所有额外参数均按设计拒绝。本批不提供创建、撤销、恢复 ACL 的数据库写入模式，也不启动真实浏览器专项。下一小批 D5b4b 若要写入专用工程或 ACL，须单独确认新工程命名、权限恢复方案、本机备份和实际写操作授权，不能删除 D5b1 的 `release:read`。

代码编写后仅进行隔离 JavaScript 语法及查询路径模拟核对；**新 10 项 Node 测试、Windows `vp check` / `ready` 和真实 PostgreSQL 只读预检仍待维护者执行**。不对外宣称 D5b4 真实撤权已通过。

## 2026-11-20 · 第三十五批 D5b4b 独立真实撤权测试工程准备（Draft 待 Windows 验收）

D5b4a 已经在真实本机 `adui_scada` Lab 只读预检通过，退出码 **0**；维护者 Windows `test:published:oidc:revoke:preflight:config` **10/10**、`vp check` **382 格式文件/234 受检文件零告警**、`docs:check` **89** 份、`pnpm run ready` **680/680** 单测、**62/62** E2E 和最终退出码 **0**，PR #110 经授权 Squash 合并至 `main@bbcf827b95d609b73052aaa2076d137ae01e92b5`。本结论仅证明撤权准备的只读校验，**未进行任何真实 ACL 撤销**。

D5b4b 的目标是**单独准备未来可撤权工程，不碰原 D5b1 工程**。新增 `scripts/prepare-oidc-published-revocation.mjs`，默认无参数只读：复用 D5b4a 已审查的 `inspectPublishedRevocationReadiness`，使用严格本机 OIDC/HTTPS、Prisma 迁移与 PostgreSQL `adui_scada` 校验。执行该预检不创建工程、无 ACL INSERT/DELETE、无浏览器登录。额外参数按设计拒绝。

**注意：仅获得维护者独立明确授权后**，才可在真实本机 Lab 执行候选脚本的双重确认写入模式。写入流程先完成 D5b4a 只读预检，再独立打开 Keycloak 浏览器验证 `lab-tenant/lab-engineer` 的可信 BFF 主体；生成一份 `d5b4-revoke-<UUIDv4>` 工程，使用正式同源 `POST /api/v1/projects`、Cookie CSRF 创建单页空白首版；在 `SERIALIZABLE` 事务中锁定该新工程并确认仅有创建者三项初始 ACL、首版/审计和零发布事件，**同时只读核对原 D5b1 工程完整四项 ACL**；只对**新工程**插入一条 `release:read`，验证仅四项权限并提交；再通过正式只读发布 GET 取得 `200 UNRELEASED` 及 `Cache-Control: no-store`。写入失败回滚 ACL INSERT，但正式工程 API 已提交的工程可能仍存在；**不得自动 DELETE、不得自动重新创建或补授权，应记录输出的专用工程 ID 并人工复核**。数据库不允许 `release:publish`、`release:rollback` 授权，不允许修改发布指针或设备。

```powershell
git fetch origin
git switch --track origin/test/b35-d5b4b-release-read-fixture
git rev-parse HEAD

pnpm run test:published:oidc:revoke:fixture:config
vp check
pnpm run docs:check
pnpm run ready
Write-Host "D5b4b 完整质量链退出码：$LASTEXITCODE"

# 严格无参数，只读预检；未获得独立授权时不要追加 --apply
pnpm run oidc:lab:published:revoke:fixture
Write-Host "D5b4b 只读预检退出码：$LASTEXITCODE"
```

真实创建、真实撤销和真实双框架撤权后 HTTP 404 均**尚未执行**。只有专用工程创建成功后，才能推进 D5b4c 的真实 ACL 撤销与拒绝验收；撤权步骤必须单独确认备份/恢复边界与执行授权，不能重复执行 D5b4a 的零工程预检当作后续状态已就绪。

D5b4b 候选已做隔离 JavaScript 函数/Mock 行为检查，**11/11 为非 Node、非 PostgreSQL 的静态与隔离测试**；Windows Node、质量链、真实 Lab 预检和任何写操作均待维护者执行。

## 2026-11-22 · 第三十五批 D5b4c 实际 ACL 撤销前的独立工程只读核查（Windows 离线质量已通过）

PR #111 D5b4b 已由维护者在 Windows 实测 `test:published:oidc:revoke:fixture:config` **11/11**、`vp check` **384 格式文件 / 236 受检文件零警告错误**、`docs:check` **89** 份、`ready` **680/680** 单测和 **62/62** 服务端 E2E、最终退出码 **0**；真实 `pnpm run oidc:lab:published:revoke:fixture` 只读预检退出码 **0**，没有创建专用工程或修改授权。经维护者明确同意，PR #111 Squash 合并至 `main@67526a8972f90325ed534ef8c05a5d43cffd7357`。Prisma 更新提示不代表依赖已升级，仍采用仓库锁定版本。

D5b4c 只添加**独立专用工程已创建后的只读核查**：`scripts/preflight-oidc-published-revocation-target.mjs` 要求且只接受 `--project-id d5b4-revoke-<UUIDv4>`，拒绝任何 `--apply`、`--revoke`、`--restore` 和附加参数。复用已审核可信本机 OIDC/双 HTTPS Origin/PG 目标校验器，验证固定 `adui_scada` 数据库及用户、三条发布迁移、零未解决迁移、预绑定可信主体；使用 `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY` 在一致快照内对照当前租户 **仅有一份** `d5b4-revoke-%` 专用工程、该工程首版修订号 1、唯一版本/审计、`release_generation=0`、零发布事件、恰好四项 `project:read/version:read/version:append/release:read` 授权；再核对旧 D5b1 工程仍有相同四项 ACL、首版及零发布状态。所有 SQL 均只读 SELECT，最后始终 `ROLLBACK`，最终关闭连接；拒绝工程内容/快照/Cookie/Token 输出。

**当前没有 D5b4 工程，因此真实 D5b4c 目标核查预计应失败（安全前置条件未满足）；不要为让它通过而使用 D5b1 工程 ID 或伪造测试数据。** 新工程只有在另行获得维护者明确的本机 Lab 数据库写入授权后，才允许使用已验收 D5b4b 准备脚本创建。即便 D5b4c 通过，也仍不允许直接执行真实 ACL 撤销；撤权时必须**在同一写事务内重新复核**现有状态，不能凭只读预检作写入依据。

可以在未授权写入前执行以下 **纯本地、无真实数据库写入** 的质量检查：

```powershell
git fetch origin
git switch --track origin/test/b35-d5b4c-release-revocation-target-preflight
git rev-parse HEAD
pnpm run test:published:oidc:revoke:target:config
vp check
pnpm run docs:check
pnpm run ready
Write-Host "D5b4c 完整质量链退出码：$LASTEXITCODE"
```

只有真实独立工程已获批准并通过 D5b4b 正式创建且记录其 ID 之后，才执行数据库只读验收：

```powershell
$projectId = "<实际创建成功的 d5b4-revoke-UUIDv4>"
pnpm run oidc:lab:published:revoke:target --project-id $projectId
Write-Host "D5b4c 数据库只读核查退出码：$LASTEXITCODE"
```

本小批 10 项新增 Node 安全用例加入 `ready`，真实数据库预检不加入自动质量链；D5b4c 未创建工程、未撤权、不恢复 ACL、不修改发布指针、未操作工业设备。维护者 2026-11-22 Windows 实际运行 Node 安全门禁 **10/10**、工程 API 定向 **13/13**、`vp check` **386/238 零告警**、`docs:check` **89** 份、完整 `ready` **680/680 单测、62/62 HTTP E2E、React/Vue/NestJS 构建成功、退出码 0**。上传日志未包含本机 Git HEAD；本段后续文档提交未经 Windows 再次全量运行。**仍无 D5b4 专用工程**，因此真实 SQL 目标只读核查尚未执行，更不能进行 ACL 撤销或恢复。

## 2026-11-22 · D5b4d 真实撤权前后只读验收契约（设计阶段，禁止写入）

本小批只准备下一阶段安全验收，**不创建** `d5b4-revoke-<UUIDv4>` 工程，**不执行** PostgreSQL INSERT/UPDATE/DELETE、ACL 撤销/恢复、发布写入或工业设备操作。已合并 PR #112 的 D5b4c 脚本只适用于专用工程存在且恰好持有四项权限的撤权前基线；不存在时必须失败，不得使用 D5b1 工程替代。

### 既有入口与信任边界

- 工程创建候选：`scripts/prepare-oidc-published-revocation.mjs`，无参为只读前置检查；其 `--apply --confirm-lab adui_scada` 是**有写入副作用**的独立操作，本阶段禁止使用。
- 撤权前真实数据库目标核验：`pnpm run oidc:lab:published:revoke:target --project-id <实际存在的专用工程 ID>`；只在已独立授权创建专用工程后允许手工执行，`REPEATABLE READ READ ONLY` / `ROLLBACK`。当前没有合法目标 ID，不得执行带示例 ID 的“成功验收”。
- 既有浏览器只读能力：`test-oidc-published-runtime-authorized.mjs`、`test-oidc-published-runtime-denied.mjs` 与共享 `installPublishedReadGuardInPage`；前者只接受 `d5b-` 前缀，后者的 404 为浏览器模拟，**不能直接声称已覆盖 D5b4 真实撤权**。后续独立专项须保持精确 `d5b4-revoke-` 前缀，不放宽原有脚本的 ID 白名单。

### 未来真实撤权前后验收矩阵（均未执行）

| 检查点               | 期望证据                                                                                                        | 失败处理                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 撤权前身份/租户      | 可信 Keycloak 同主体、固定 HTTPS 双 Origin；不输出 Cookie/Token                                                 | 身份缺失或不一致立即拒绝                           |
| 撤权前目标工程       | 已创建的唯一 D5b4 工程、首版/审计/零发布、四项精确 ACL                                                          | 拒绝进入撤权步骤，不自动创建                       |
| 撤权前旧 D5b1        | 原有工程与四项 ACL 保持原状                                                                                     | 任一漂移立即拒绝                                   |
| 撤权前双框架读取     | React/Vue 各一次真正同源 `GET /api/v1/projects/:id/releases/current` 返回 200、`UNRELEASED`、`no-store`，无快照 | 禁止以离线 Mock 或浏览器模拟 404 代替              |
| 经另行授权的撤权     | 必须由独立、经审批的窄范围事务完成，仅作用于该专用工程和单条 `release:read`；同事务重新复核基线                 | 本小批**不提供也不执行**写入口                     |
| 撤权后双框架读取     | React/Vue 真实同源 GET 返回预期拒绝，页面进入 denied、清空发布指针与快照并维持不可用质量                        | 任一 200、缓存复用、重定向或写请求均失败           |
| 撤权后数据库只读复核 | 专用工程恰好缺失目标 `release:read`；保留其他三项、首版/审计、零发布；旧 D5b1 四项 ACL 完整                     | 不自动恢复，不进行补偿写入                         |
| 资源与隐私           | 只记录状态码、计数、布尔安全摘要；停止读取后无额外 GET                                                          | Cookie、Token、工程正文、SQL、原始异常不得进入终端 |

### 本阶段可开发与验证的范围

允许新增 **纯离线** 的参数、阶段、状态码、权限快照及拒绝清理断言，或独立的只读浏览器验证脚本候选；所有请求方法须限定为 GET/HEAD，禁止以任何测试参数启用数据库写操作。必须分别测试“目标不存在时 fail-closed”和“有模拟数据的契约断言通过”，且明确模拟成功不能证明真实 SQL 或真实撤权。后续候选进入 PR 时执行 `vp check`、`docs:check` 与 `ready`；需真实 Windows/Keycloak/数据库的专项仍由维护者在独立授权后执行。本章节目前**只完成设计与仓库脚本核对**，没有执行上述新专项。

### D5b4d 双框架真实只读浏览器候选入口（尚未在 Windows 运行）

新增独立脚本 `scripts/test-oidc-published-revocation-readonly.mjs`，只允许精确的 `--phase before|after --project-id d5b4-revoke-<UUIDv4>`。两个阶段是**两次独立人工运行**，脚本绝不自动创建专用工程、增加或删除 ACL，也不在阶段之间自动修改数据库。沿用真实 Keycloak/BFF 登录、React/Vue HTTPS 双 Origin 和现有 `installPublishedReadGuardInPage`：在发布运行页挂载前加上只读响应观察器，只保留**实际 HTTP 状态码、no-store 和精确同源非重定向布尔值**，不替换响应、不模拟 404、不读取正文或令牌。

- `before`：要求已获另行授权创建的唯一工程先通过 D5b4c `READ ONLY` 数据库预检，随后 React/Vue 各从真实服务端执行**恰好一次 GET**，必须返回 200/no-store、UNRELEASED、代次 0、无快照、Tag 质量 UNAVAILABLE。
- `after`：只能在未来**另行明确授权并实际完成真实 ACL 撤销**之后执行，双端相同 GET 必须真实返回 404/no-store，UI 为 denied 且发布指针/静态快照清空、质量不可用；401、403、200、HTTP 重定向和额外请求都失败。**单纯 404 不能证明工程确实存在过或 ACL 已撤销**；仍需另行完成撤权后的真实 PostgreSQL 只读状态审计，并核对原 D5b1 工程不变。
- 两阶段均验证同一可信 BFF 主体、零默认工程 GET、无受控工程写入、停止读取后零新增 GET；只输出固定中文阶段与脱敏错误类别。`after` 不会自动恢复权限，运行失败亦不允许脚本补偿写入。

在**没有** D5b4 专用工程、也**没有**数据库写入授权的当前阶段，只允许使用以下离线质量命令：

```powershell
git fetch origin
git switch test/b35-d5b4d-release-revocation-readonly-acceptance
git pull --ff-only
git rev-parse HEAD

pnpm run test:published:oidc:revoke:readonly:config
if ($LASTEXITCODE -ne 0) { throw "D5b4d 只读安全测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "D5b4d Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "D5b4d 文档检查失败" }

pnpm run ready
Write-Host "D5b4d 完整质量链退出码：$LASTEXITCODE"
```

**未来的真实手工调用（本轮禁止执行）**：先由维护者获得单独授权、记录真实新建专用工程 ID 并完成 D5b4c 数据库只读预检，才允许运行 `pnpm run test:published:oidc:revoke:readonly:browser --phase before --project-id <真实 ID>`；再次获得独立撤权授权并完成实际 ACL 变更后才可运行 `--phase after`。两次浏览器成功也不替代后置数据库 ACL 审计。本次实际只做 GitHub 源码与隔离 V8 静态/纯函数检查（另以受限 V8 模拟执行 15 项测试定义，15/15），**未运行正式 Windows Node、`vp check`、`docs:check`、`ready` 或真实浏览器/数据库专项**。

## 2026-11-22 · D5b4e 撤权后 PostgreSQL 只读审计（Draft 候选）

PR #113 已由维护者 Windows 验收：D5b4d 独立离线安全门禁 **15/15**、`vp check` **388 格式文件/240 受检文件零告警**、`docs:check` **89 份**、完整 `ready` **680/680 单测、62/62 HTTP E2E、React/Vue/NestJS 构建成功、退出码 0**；经本次明确授权 Squash 合并为 `main@19f027838908a385f5966cc4285f41528a436dde`。Windows 日志未单独给出本机 `git rev-parse HEAD`，不作严格 SHA 绑定。

D5b4e 在原 D5b4c `scripts/preflight-oidc-published-revocation-target.mjs` 上复用**相同只读 SQL、身份、迁移与专用工程检查**，另提供 `scripts/preflight-oidc-published-revocation-after.mjs` 独立 CLI。只有 `--project-id d5b4-revoke-<UUIDv4>` 一种参数形态；不接受 `--apply`、`--revoke`、`--restore` 或附加参数。原 D5b4c 命令**默认仍校验撤权前恰好四项 ACL**，不会因为新增阶段而改变。新 D5b4e 命令只能检查撤权后的静态元数据：

- 只允许预绑定可信主体和本机 `adui_scada` / `adui_scada` 数据库用户、已完成发布迁移、零待解决迁移；仍要求租户内唯一 D5b4 专用工程及其首版修订号 1、唯一版本和审计、发布代次 0、无发布指针和事件。
- D5b4 专用工程只能**恰好存在** `project:read`、`version:read`、`version:append` 三项 `lab-engineer` ACL；`release:read` 仍存在、少掉基础授权、重复授权、其他主体或新增任意权限一律拒绝。
- 原 D5b1 工程必须仍保持原首版、未发布状态及**恰好四项** ACL。查询固定只针对这两个工程，不读取快照正文。
- 整个 SQL 流程保持 `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`、受控 `SELECT` 和 `ROLLBACK`，仅在所有检查通过后输出安全摘要。**没有 PostgreSQL INSERT/UPDATE/DELETE，也不恢复授权。**

**当前尚无 D5b4 专用工程，也未获创建或撤权写入授权，不能执行真正的撤权后数据库验收。** 即使未来只读脚本发现目标仅有三项 ACL，**也不能单独证明之前确实存在第四项或确实发生了一次经授权撤权**；必须关联此前真实 D5b4c 四项 ACL 预检、D5b4d `before` 双 Origin 真实 200、另行授权的撤权操作证据、D5b4d `after` 真实 404 和本只读结果。原 D5b1 不能用作目标工程。

当前只执行**离线代码安全门禁**；维护者可在 Windows 执行以下命令：

```powershell
git fetch origin
git switch test/b35-d5b4e-post-revocation-readonly-audit
git pull --ff-only
git rev-parse HEAD

pnpm run test:published:oidc:revoke:target:config
if ($LASTEXITCODE -ne 0) { throw "D5b4c 原有只读门禁失败" }

pnpm run test:published:oidc:revoke:after:config
if ($LASTEXITCODE -ne 0) { throw "D5b4e 后置只读门禁失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "D5b4e Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "D5b4e 文档检查失败" }

pnpm run ready
Write-Host "D5b4e 完整质量链退出码：$LASTEXITCODE"
```

**仅在未来已得到专用工程创建与真实撤权两项独立明确授权且操作完成后**，才允许使用真实现存 ID 人工执行下面的**只读**命令；本小批禁止执行：

```powershell
$projectId = "<维护者另行授权创建并撤权的真实 D5b4 工程 ID>"
pnpm run oidc:lab:published:revoke:after --project-id $projectId
Write-Host "D5b4e PostgreSQL 只读审计退出码：$LASTEXITCODE"
```

本批静态编写候选后，仅以隔离 V8 模拟 Node 断言验证**既有 10 + 新增 11 = 21/21** 源测试定义，**不是 Windows `node --test` 或 PostgreSQL 实际测试**。真实 OIDC、权限撤销和设备写入均未执行。

## 2026-11-22 · D5b4f 同一阶段只读验收编排（待 Windows 验收）

维护者在 Windows 执行 D5b4e 质量链：D5b4c **10/10**、D5b4e **11/11**、`vp check` **390 个文件格式正确、242 个受检文件零错误/警告**、`docs:check` **89 份**、`ready` **680/680 单测、62/62 HTTP E2E、React/Vue/NestJS 构建完成、退出码 0**。PR #114 经明确授权 Squash 合并为 `main@aa512cf30d4b524f187d6cb8e46c77840fd72036`。该 Windows 日志没有本地 Git HEAD，不能将实测严格绑定到远端提交。

D5b4f 新增 `scripts/test-oidc-published-revocation-sequence.mjs`，不修改 D5b4c、D5b4d、D5b4e 原有逻辑，只通过 **Node `process.execPath`、固定脚本文件、固定参数数组、`shell: false`** 顺序调用已有三个只读入口。只接受 `--phase before|after --project-id d5b4-revoke-<UUIDv4>`；不允许 `both/revoke/restore`、额外参数或任意脚本路径。两个阶段只能由维护者分别发起，**绝不自动创建工程、执行 ACL 撤销/恢复、切换阶段或写入发布指针**。

每次仅运行三步：**当前阶段 PostgreSQL 只读核查 → React/Vue 真实同源发布 GET → 同一阶段 PostgreSQL 只读复核**。首尾两次 PostgreSQL 都使用原有 `REPEATABLE READ READ ONLY` / `ROLLBACK`，其中 `before` 均要求目标四项 ACL、`after` 均要求目标恰好三项基础 ACL；原 D5b1 四项 ACL 每次均需完整。浏览器由现有 D5b4d 严格区分真实 200/404、未发布/拒绝、禁缓存和无额外写入。任一步退出码非零、进程失败或异常，立即停止剩余步骤并返回固定脱敏错误。浏览器期间任一数据库基线发生漂移，末次核查应拒绝。

**这不是跨阶段可审计原子事务。** 两次实际命令之间存在外部时间窗口；数据库并行事务仍可产生竞态，且“当前三项权限”不独立证明历史上发生授权撤销。完整验收必须使用同一真实专用工程 ID，保留审批与实际撤权操作记录、前后分别执行的原始成功日志，并额外由维护者评估时序和失败时的人工处置；本编排不会自动撤权或恢复，也不将任何 Cookie/Token、数据库连接串、快照正文写入日志。

当前**尚未授权创建 D5b4 专用工程，也尚未进行真实撤权**，因此本轮只允许执行以下离线门禁：

```powershell
git fetch origin
git switch test/b35-d5b4f-readonly-acceptance-sequence
git pull --ff-only
git rev-parse HEAD

pnpm run test:published:oidc:revoke:sequence:config
if ($LASTEXITCODE -ne 0) { throw "D5b4f 离线安全门禁失败" }

pnpm run test:published:oidc:revoke:target:config
if ($LASTEXITCODE -ne 0) { throw "D5b4c 既有门禁失败" }

pnpm run test:published:oidc:revoke:after:config
if ($LASTEXITCODE -ne 0) { throw "D5b4e 既有门禁失败" }

pnpm run test:published:oidc:revoke:readonly:config
if ($LASTEXITCODE -ne 0) { throw "D5b4d 既有门禁失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "D5b4f Vite+ 质量检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "D5b4f 文档检查失败" }

pnpm run ready
Write-Host "D5b4f 完整质量链退出码：$LASTEXITCODE"
```

以下仅供**未来分别获得真实专用工程创建、真实单项 ACL 撤销授权**之后参考，本小批**禁止执行**。必须在撤权前后使用同一个已真实存在的工程 ID，在两次运行之间由另行批准的独立受控流程完成实际 ACL 变更；本仓库 D5b4f 命令没有这个写入能力：

```powershell
$projectId = "<维护者已单独批准并创建的真实 D5b4 工程 ID>"
pnpm run oidc:lab:published:revoke:sequence --phase before --project-id $projectId
Write-Host "撤权前只读验收退出码：$LASTEXITCODE"

# 这里只允许另行批准、独立审核的实际权限变更，绝不由本脚本自动执行。

pnpm run oidc:lab:published:revoke:sequence --phase after --project-id $projectId
Write-Host "撤权后只读验收退出码：$LASTEXITCODE"
```

根 `test:published:oidc:revoke:sequence:config` 只运行 10 项离线测试并加入 `ready`；真实 `oidc:lab:published:revoke:sequence` 需要显式参数、真实 Keycloak/HTTPS/PostgreSQL 环境及维护者单独授权，**不纳入 `ready`**。协作端仅对当前 GitHub 源码隔离 V8 模拟执行新门禁定义 **10/10**，不是 Windows Node `--test`、本机真实浏览器或真实数据库验收。

## 2026-11-22 · D5b4g 单条 release:read 事务撤销候选（仅代码，不执行真实写入）

PR #115 D5b4f 的 Windows 原始日志确认：新增编排离线门禁 **10/10**、`vp check` **392 个格式文件/244 个受检文件零警告错误**、`docs:check` **89 份**、完整 `ready` **680/680 单测、62/62 HTTP E2E、React/Vue/NestJS 构建成功、退出码 0**；已按维护者明确授权 Squash 合并至 `main@7fa1ad5734aed653140cb0ec56a1473d036a8cd4`。原日志没有本机 `git rev-parse HEAD`，不冒充严格 SHA 绑定。

**D5b4g 当前仅编写并审查单条 ACL 撤销候选，不意味着已获得创建工程、撤权或任何数据库写入授权。** 新脚本 `scripts/revoke-oidc-published-read-target.mjs` 仅供可信本机 OIDC Lab 的 `d5b4-revoke-<UUIDv4>` 专用工程；默认为只读：仅接受 `--project-id <真实 ID>`，复用 D5b4c 的 `REPEATABLE READ READ ONLY` 事务和原 D5b1 完整基线。受控写入参数必须同时具备目标 ID、`--apply --confirm-lab adui_scada --confirm-project <完全相同的 ID>`，拒绝所有额外参数、旧 D5b1 工程、其他库及不可信身份。

在**未来再次独立授权 ACL 撤销**之后，写入候选才允许按以下固定流程执行：先通过 D5b4c 完整只读预检；在 `SERIALIZABLE` 事务锁定这份新工程的首版行；在同一事务内重新运行已有的迁移、可信身份、唯一工程、版本审计、零发布、目标四项 ACL 和原 D5b1 四项 ACL 校验；**仅一次**执行带 tenant、工程 ID、主体和精确 `permission = 'release:read'` 条件的 `DELETE … RETURNING subject_id, permission`，必须恰好返回预期一行；仍在事务内使用 D5b4e 的严格三项 ACL 校验；提交后再以独立 `READ ONLY` 事务复核。任何未通过的条件都不允许提交；结果不确定或提交后检查失败时**禁止自动重试或恢复**，必须由维护者人工只读审计。

- 绝不针对 `d5b-unreleased-*` 或其他 `b34-*` 工程执行撤权，也不能修改 `project:read`、`version:read`、`version:append`、其他主体或任何发布指针。
- 不新增服务端 ACL 管理 API、不改变 Prisma Schema/迁移或 Vue/React Runtime，不涉及 PLC/DCS/工业设备写入。
- 即使本候选未来成功执行一次 DELETE，也不代表 React/Vue 的真实 HTTP 404、草稿/画布保护或工业安全认证已通过；仍需手工运行原 D5b4f `after` 编排，并保留已获授权的 `before` 记录。
- 失败或连接中断时真实 COMMIT 结果可能不确定；**不能因为脚本退出码非零就假定数据库没有变化**，尤其不得自行重复执行写入模式。

当前允许维护者执行的**纯离线**质量门禁为：

```powershell
git fetch origin
git switch test/b35-d5b4g-target-release-read-revoke-guard
git pull --ff-only
git rev-parse HEAD

pnpm run test:published:oidc:revoke:single:config
if ($LASTEXITCODE -ne 0) { throw "D5b4g 单条撤权安全用例失败" }

pnpm run test:published:oidc:revoke:target:config
if ($LASTEXITCODE -ne 0) { throw "D5b4c 原只读安全用例失败" }

pnpm run test:published:oidc:revoke:after:config
if ($LASTEXITCODE -ne 0) { throw "D5b4e 原只读安全用例失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "D5b4g Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "D5b4g 文档检查失败" }

pnpm run ready
Write-Host "D5b4g 完整质量链退出码：$LASTEXITCODE"
```

**以下写入模式仅为未来技术审查的格式示意，本次严禁执行**：`pnpm run oidc:lab:published:revoke:single --project-id <真实 D5b4 专用工程 ID> --apply --confirm-lab adui_scada --confirm-project <同一真实 ID>`。即使只是独立只读预检，也必须先经单独授权成功创建真实专用工程；禁止把本节占位符当作实际工程 ID。此前用户明确未授权创建 D5b4 工程或执行任何数据库写入，此边界未改变。

本小批隔离 V8/Mock 只完成新增 **13/13** 及旧 D5b4c/e **21/21** 源测试定义复核，均**不是 Windows Node `node --test`、`vp check`、`ready` 或真实 PostgreSQL 写入实测**。正式验证结果需使用 Windows 完整工作区补证。

## 2026-11-22 · D5b4 真实撤权实验室终验（已完成的历史证据）

维护者已在本机可信 OIDC/Keycloak HTTPS Lab 使用**唯一新建的 D5b4 测试工程**，按 D5b4b 创建与授权 → D5b4c/f 撤权前只读/双框架 HTTP 200 → D5b4g 定向一次 `release:read` DELETE → D5b4e/f 撤权后只读/双框架 HTTP 404 的顺序完成**真实专项终验**。完整原始输出保存在维护者对话日志；本节只记录固定命令契约与结论，不在公开仓库散布真实 UUID、Cookie、Token、连接串或工程正文。

| 验收时点                   | 使用的已有脚本                                                                                                             | 维护者真实结果                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 真实工程准备               | `oidc:lab:published:revoke:fixture --apply --confirm-lab adui_scada`                                                       | 新工程、必要授权、首次真实 HTTP 200 成功                                                               |
| 撤权前两次数据库夹持浏览器 | `oidc:lab:published:revoke:sequence --phase before --project-id <真实工程 ID>`                                             | PostgreSQL 四项 ACL / 原 D5b1 完整；React/Vue 各一次真实 200；停止清理通过                             |
| 唯一一次定向撤权           | `oidc:lab:published:revoke:single --project-id <真实工程 ID> --apply --confirm-lab adui_scada --confirm-project <同一 ID>` | 写入前预检、单条权限撤销、提交后数据库只读审计成功                                                     |
| 撤权后两次数据库夹持浏览器 | `oidc:lab:published:revoke:sequence --phase after --project-id <同一 ID>`                                                  | PostgreSQL 仅三项基础 ACL、原 D5b1 完整；React/Vue 各一次真实 404 / denied；停止清理与末次只读复核通过 |

**顺序安全门禁已通过实际负向检验**：若在撤权之前运行 `oidc:lab:published:revoke:after` 或 `--phase after`，仍存在 `release:read`，应拒绝并在首次数据库检查处停止；维护者确实观察到这两条命令返回错误。手工 `Write-Host` 不代表任何测试通过。实际 D5b4g 撤权成功后重新运行后置检查，才得到本节最终通过结论。

**禁止复用本次写入步骤**：专用工程已撤权，重复运行 `--apply` 不属于已授权操作，自动恢复 ACL 同样禁止。当前没有进一步数据库写入授权；任何异常仅可先做独立只读审计。原 D5b1 工程与工业设备不在本次写入范围。

**验收不等于全产品安全覆盖**：上述真实浏览器测试检查发布运行页 GET 200/404、no-store、拒绝状态与清理，不会自动检查 Studio IndexedDB 草稿原始字节、未保存画布、双标签页竞态、生产网络或真实 PLC/DCS。下一个独立专项可先采用纯离线设计与双框架草稿/画布保护浏览器测试，但不得为了扩展测试而重新授予目标工程的 `release:read`。如需再次验证撤权前后两态，必须另行审批新测试工程及写入授权。

**证据可追溯性**：用户日志未显式打印 `git rev-parse HEAD` 及每条 `$LASTEXITCODE`，不将这些日志标为 SHA 严格绑定的自动化 CI。最终 D5b4f 正常完成信息与 D5b4g/e 成功信息是实际成功证据；文档追加本身未重新执行 `vp check`、`docs:check` 或 `ready`。

## 2026-11-22 · D5b5 Studio 已撤权发布 GET 与本地草稿保护（Draft，待 Windows 真实验收）

PR #117 已由维护者明确授权 Squash 合并，`main@3c2e51c385ddaacb5015b0ea600610e9f3f764a1`。历史 D5b4 专用工程已真实撤销其唯一 `release:read`，原 D5b1 工程四项权限保留；该专用工程现在仍拥有 `project:read`、`version:read`、`version:append`。**不能把撤销 `release:read` 错写成 Studio 工程载入接口失去权限**。本小批只验证两者的交叉影响，不修改生产 Vue/React 逻辑，不再次创建工程、授予、撤销或恢复 ACL。

新增 `scripts/test-oidc-studio-revoked-draft.mjs`（真实只读浏览器候选）与 `scripts/test-oidc-studio-revoked-draft.cases.mjs`（11 项离线安全测试候选）。脚本只接受 `--project-id d5b4-revoke-<UUIDv4>`，必须引用**已经真实撤销 `release:read` 的同一现存工程**，不能拿 D5b1 或伪造示例 ID 冒充测试数据。其功能仅在独立临时 Chrome/Edge Profile 中验证，分 React/Vue 两个可信本机 HTTPS Origin：

1. 在新页面脚本运行前安装现有 `installPublishedReadGuardInPage`，**拦截全部工程 API 的非 GET、跨 Origin、异常请求体/授权头**；真实 GET 保留正常响应。
2. 通过正式 Studio 工程管理 UI 分页找到该**同一 D5b4 工程**，确认服务端首版修订号 1，以现有 UI 的“确认载入”只读 GET 打开；本测试不执行服务端工程保存。
3. 在**隔离浏览器**中通过现有“保存草稿”按钮实际写入本地 IndexedDB，读取草稿记录数及 SHA-256、完整 SVG 内容（排除视口网格）、工程 JSON 导出 SHA-256、自动保存状态和服务端 CAS 基线；随后通过正式“+ 文本”按钮新增**未保存图元**，严格要求画布及工程 JSON 摘要已变化而草稿和 CAS 仍未变化。脚本故意不开启自动保存，防止测试产生非预期本地竞态。
4. **从 Studio 页面独立调用一次**真正同源 `GET /api/v1/projects/<同一工程 ID>/releases/current`，必须返回服务器的 404、`no-store`、无重定向、精确响应地址；**不注入模拟 404、不读取正文、不执行 POST**。只检查请求结果，不把它伪称为“Studio 自身通过某个按钮消费了发布拒绝响应”。
5. 读取第二次画布、JSON 摘要、IndexedDB 草稿数/哈希、自动保存标记及 CAS 基线，**逐项完全相等**；独立浏览器只读门禁必须显示恰好新增一条目标 GET 和零阻断写入。任何其他状态码、额外请求、错误路径或本地变化均失败。Node 侧仅打印固定中文进度及通过/失败类别，不向终端输出工程正文、Hash、Token、Cookie 或数据库连接信息。

**覆盖边界**：该专项可证明已撤权发布接口的真实 404 不会因本次**独立同源 Fetch** 改写正在编辑的 Studio 画布与草稿；它**不证明** Studio 自己消费发布失败时的状态机、迟到的 200/401/404 竞争响应、多标签页并发或字节级原始 IndexedDB 文件一致性。草稿测试比较记录数与基于读取值序列化的 SHA-256，并不比较 IndexedDB 底层文件字节。已有的 Studio 401/404 模拟与 CAS 专项仍不能替代未来真实会话/并发专项。当前已撤权工程不应被重新授予 `release:read` 以强行构造 before 阶段。

**本轮可先执行的离线 Windows 质量检查**：

```powershell
git fetch origin
git switch test/b35-d5b5-studio-revoked-draft-protection
git pull --ff-only
git rev-parse HEAD

pnpm run test:published:oidc:revoke:studio:config
if ($LASTEXITCODE -ne 0) { throw "D5b5 Studio 草稿保护离线安全测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "D5b5 Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "D5b5 文档检查失败" }

pnpm run ready
Write-Host "D5b5 完整质量链退出码：$LASTEXITCODE"
```

**未来单独进行真实只读浏览器验收（本轮未执行）**：仅在上述质量链完成、可信 Keycloak/HTTPS Lab 运行且原 D5b4 工程仍存在的前提下，维护者手动输入原实际 ID 运行：

```powershell
$projectId = (Read-Host "请输入已撤权的真实 D5b4 专用工程 ID").Trim()
pnpm run test:published:oidc:revoke:studio:browser --project-id $projectId
Write-Host "D5b5 真实双框架浏览器退出码：$LASTEXITCODE"
```

`test:published:oidc:revoke:studio:config` 纳入根 `ready`；`test:published:oidc:revoke:studio:browser` **不纳入 `ready`**，不会在自动质量链中打开真实浏览器。协作端仅从 GitHub 回读并以隔离 V8/Mock 执行新增 11 项源测试定义，**11/11** 符合预期；**不是 Windows Node `node --test` 或真实 Chrome/Edge/PostgreSQL 执行结果**。本批没有连接 Lab 执行任何工程或 ACL 写入。

## 2026-11-22 · E-075：D5b5 Windows 首轮原生 Node 测试失败后的复验顺序

维护者 Windows 首轮 `test:published:oidc:revoke:studio:config` **10/11**；唯一失败为跨 `node:vm` Realm 的嵌套请求参数对象误触发 `deepStrictEqual` 原型比较。原轮 `vp check` **396/248 零错误警告**、`docs:check` **89**、Vitest **680/680**，但完整 `ready` **退出码 1**，没有继续执行 HTTP E2E、构建。当前 PR #118 修复候选对离线用例改为 `assert.deepEqual(structuredClone(requests), expected)`；不更换真实发布 GET、不删除任何断言，不调用数据库。

须先在 Windows 取回最新测试分支，**打印本机 HEAD 并阻断失败**，不得将首轮的 `vp check`、`docs:check` 成功当作本次修正的验收：

```powershell
git fetch origin
git switch test/b35-d5b5-studio-revoked-draft-protection
git pull --ff-only
git rev-parse HEAD

pnpm run test:published:oidc:revoke:studio:config
if ($LASTEXITCODE -ne 0) { throw "D5b5 修复后原生 Node 门禁失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "D5b5 修复后 Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "D5b5 修复后文档检查失败" }

pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "D5b5 修复后完整质量链失败" }
Write-Host "D5b5 修复后完整质量链退出码：$LASTEXITCODE"
```

真实 `test:published:oidc:revoke:studio:browser` 仍须在上述全部通过后单独人工执行，且只允许读取**先前已真实撤权的同一现存工程**。本次没有授权恢复 ACL、重新创建测试工程或执行任何数据库写入。协作端只运行了原生 Node 跨 Realm 最小复现与六种负向请求篡改检查，尚不能宣称最新 PR HEAD 的 Windows 11/11 或真实浏览器专项通过。

## 2026-11-22 · D5b5 真实 Studio 双框架浏览器专项终验通过

维护者 Windows 原始日志确认 `main@039bfd01ecf34e3641556fc5536a6bda377cf732` 经 `git rev-parse HEAD` 变量校验一致（终端未独立打印 SHA）、Git 工作区清洁。此前此版本 D5b5 新增 Node 离线门禁 **11/11**、完整 `ready` **680/680 Vitest 单测、62/62 HTTP E2E、React/Vue/NestJS 构建成功、退出码 0**，均已完成。

本次只读真实终验依次执行并成功：

```powershell
# 仅记录历史已执行命令契约；工程 ID 为已存在并完成撤权的真实 D5b4 工程。
pnpm run oidc:lab:published:revoke:after --project-id $projectId
# 结果：撤权后三项基础 ACL / 原 D5b1 完整，PostgreSQL READ ONLY 通过。

pnpm run test:published:oidc:revoke:studio:browser --project-id $projectId
# 结果：React/Vue 通过真实 BFF 登录、Studio 首版只读载入、隔离浏览器本地草稿保存、
# 未保存图元准备与一次真实发布 GET 404，SVG、JSON、草稿摘要和 CAS 基线均不变。
# 原命令后逐项检查 $LASTEXITCODE，最终通过。
```

**仅此项安全结论成立**：这是 Studio 页面内独立真实同源 `fetch` 发布接口 404 后本地数据稳定性验收，并非 Studio 正式发布预检按钮或内部业务组件消费 404、迟到网络响应竞争、跨标签页并发或 IndexedDB 数据库底层文件逐字节比较。脚本仅在隔离浏览器本地创建草稿；服务端工程 API 的非 GET 被初始化前门禁阻断，不新增工程/ACL/发布状态写入。公开文档不收录真实测试工程 UUID、Cookie、Keycloak Token 或工程正文。

**后续测试准入**：如扩展为 React/Vue 同源双标签页竞争，先复用既有已撤权 D5b4 工程的 `project:read`、`version:read`，仅在独立浏览器本地草稿操作并发；所有服务端工程写入继续阻断，任一框架/标签页状态漂移即失败。只有在明确设计并验证真实响应时序控制后，才可把“Studio 自身迟到 200/401/404 处理”列为已覆盖。禁止重复执行撤权 `--apply` 或恢复 `release:read`；新 SQL 写入须另行授权。

**文档变更验证边界**：本次只是补录维护者既有真实 Windows 日志，未在最新文档分支运行 `vp check`、`docs:check` 或完整 `ready`；上述真实验收仅归属于已核验的合并代码，不可冒充文档 PR 的 CI 结果。

## 2026-11-22 · D5b5b React/Vue 同源双标签页撤权后只读回归（Draft 候选）

D5b5 第一小批已在真实 Windows Keycloak/HTTPS Lab 中使用**已撤销 `release:read` 的同一现存 D5b4 工程**完成 React/Vue Studio 本地画布、IndexedDB 草稿摘要与 CAS 保护验收；维护者 2026-11-22 又执行 `docs:check` **89 份**和 `vp check` **396 格式文件/248 受检零错误警告**，明确同意合并 PR #119；GitHub Squash 合并为 `main@8855becab403a334231be7b2fb253452a71c0c76`。本段先前 Windows 结果与此次候选新增代码无关，不能当作 D5b5b 验收通过。

新脚本 `scripts/test-oidc-studio-revoked-multitab.mjs` 仅接收 `--project-id d5b4-revoke-<UUIDv4>`。先用已有可信本机 HTTPS/Keycloak BFF 启动独立临时 Chrome/Edge Profile，然后在**同一 Profile、同一框架 Origin** 建立两个真实标签页；分别对 React 与 Vue 做如下回归：

1. **第一标签页**：真实工程管理列表及首版 `revision 1` 只读载入现存 D5b4 专用工程；通过正式“保存草稿”按钮**仅向隔离浏览器本地 IndexedDB 保存一次**，然后新增未保存文本图元并读取无网格 SVG、工程 JSON 摘要、草稿计数/哈希、自动保存与 CAS 基线。自动保存必须关闭。
2. **第二标签页**：通过实际 CDP `Page.bringToFront` 激活，验证第一标签页真实进入 `hidden`；使用同一 Keycloak 本地主体，真实 UI 只读载入相同首版工程。第二标签页**只读取**第一标签页已经保存的共享 IndexedDB 草稿，核对草稿计数和摘要一致；在自己的画布新增未保存文本，不再次保存草稿、不写服务端版本。
3. **交错只读请求**：先切回第一标签页并核对第二标签页已隐藏，严格对比两个标签各自的编辑与草稿快照；第一标签页从 Studio 页执行**独立真实同源 GET** `/api/v1/projects/<同一 ID>/releases/current`，必须单条 404、`no-store`、无重定向，且 SVG、JSON、IndexedDB 草稿及 CAS 未变化。切到第二标签页，执行相同独立真实 GET 404 与本地保护断言；最后切回第一标签页，重新严格比对两标签完整本地状态。
4. **全部工程 API Fetch 必须只读**：复用在页面导航前安装的 `installPublishedReadGuardInPage`，工程 API 非 GET、附带异常请求体或显式 Authorization 的请求被拦截；两个标签页的阻断计数始终为零。现存工程在数据库中仍保留 `project:read`、`version:read`、`version:append`；不授予或恢复 `release:read`。页面最终仅打印固定中文阶段与通过/失败，不输出 Cookie、Token、工程正文、草稿哈希或真实项目 ID。

**范围声明**：本次是**两个真实标签页并存、可见性切换、依次读取真实 404**的双框架测试。HTTP 请求不是并发挂起，也没有模拟迟到 200/401/404；发布 GET 由测试从 Studio 页面独立发起，**不是** Studio 正式发布功能自身消费失败响应。草稿比较为读取值 SHA-256 而非 IndexedDB 底层文件逐字节检查。若未来要测试迟到响应或真实双标签页并行写入，需要另立专项且不能复用本阶段“只读”验收结论。所有实际 D5b4 工程操作仅限现有授权范围，禁止再次创建工程、执行撤权 `--apply` 或恢复权限。

仅**离线测试**自动纳入根 `ready`，真实浏览器入口必须维护者手动执行。Windows 先验收新分支：

```powershell
git fetch origin
git switch test/b35-d5b5-multitab-revoked-readonly
git pull --ff-only
git rev-parse HEAD

pnpm run test:published:oidc:revoke:multitab:config
if ($LASTEXITCODE -ne 0) { throw "D5b5b 双标签页离线门禁失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "D5b5b Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "D5b5b 文档检查失败" }

pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "D5b5b 完整质量链失败" }
Write-Host "D5b5b 质量链退出码：$LASTEXITCODE"
```

未来**仅在本次离线质量链通过、可信 HTTPS/Keycloak Lab 已运行且原 D5b4 工程仍处于已撤权状态**时人工运行真实只读专项，不要复制虚构 UUID：

```powershell
$projectId = (Read-Host "请输入已撤权的真实 D5b4 工程 ID").Trim()
pnpm run oidc:lab:published:revoke:after --project-id $projectId
if ($LASTEXITCODE -ne 0) { throw "D5b4e 撤权后数据库只读复核失败" }

pnpm run test:published:oidc:revoke:multitab:browser --project-id $projectId
if ($LASTEXITCODE -ne 0) { throw "D5b5b 双框架真实双标签页专项失败" }
Write-Host "D5b5b 双标签页真实只读专项退出码：$LASTEXITCODE"
```

协作端仅回读 GitHub 源码、执行新脚本 V8 语法解析和 **11/11 隔离 V8/Mock 测试定义**；**不是 Windows 原生 Node `node --test`、`vp check`、`ready`、真实 Chrome/Edge 或 PostgreSQL 结果**。本小批没有连接 Lab，也没有进行任何远端写入。

## 2026-11-22 · D5b5c React/Vue 双标签真实 404 响应逆序交付（Draft 候选）

PR #120 已经维护者明确授权并 Squash 合并至 `main@eb3fdc5105d3cb5d88593db7fffd7702e91625c8`。维护者 Windows 的 D5b5b 离线门禁 **11/11**、`vp check` **398/250 零错误警告**、`docs:check` **89**、完整 `ready`（Vitest **680/680**、HTTP E2E **62/62**、React/Vue/NestJS 构建成功）**退出码 0**。日志未打印本地 `git rev-parse HEAD`，不把上述通过严格绑定到 GitHub SHA。**D5b5b 的真实 Keycloak/Chrome 双标签页专项尚未提供通过日志**，不得据此宣称浏览器已验收。

本批只扩展 **两个同 Origin、同临时 Chrome Profile 标签页各自独立发起的真实发布 GET 404 的页面交付时序**。复用已撤销 `release:read` 的唯一 D5b4 工程、可信 Keycloak/BFF 会话、Studio 正式 UI 首版只读载入及第一标签页仅一次 IndexedDB 本地草稿保存。两个标签各自追加未保存文本、读取无网格 SVG、工程 JSON、草稿 SHA-256 与 CAS 基线；工程 API 继续由导航前的只读守卫保护。

实现策略：两页分别通过原生 `fetch` 完成真实网络 GET 404，现有守卫先记录实际状态码；新增页面门禁**不模拟 Response，不重写 HTTP 状态，也不阻断底层网络**，仅暂缓 Promise 向各发起页交付已经返回的原始 Response。必须确认第一、第二标签的两个 Promise **同时 pending**，并在两页未保存内容、草稿和 CAS 不变的条件下先释放**第二页**、再释放**第一页**；每次都核对恰好新增一条原始 GET、`404 + no-store + 无重定向`、零工程写入以及完整快照不变。异常只输出脱敏的固定阶段与类别。

**不覆盖**：服务端 TCP/HTTP 网络层同时挂起、两个实际请求的服务端处理顺序、Studio 正式发布预检组件对迟到 200/401/404 的消费、客户端写入 CAS、跨框架共享同一个 Origin 或 IndexedDB 文件字节级比较。两个框架各在自身 Origin 独立测试两标签页。不得为执行专项新建工程、恢复 `release:read`、再次执行撤权、向生产库写入或访问工业设备。

Windows 质量链先单独验收（必须检查 `HEAD` 和退出码）：

```powershell
git fetch origin
git switch test/b35-d5b5c-revoked-late-read
git pull --ff-only
git rev-parse HEAD

pnpm run test:published:oidc:revoke:late:config
if ($LASTEXITCODE -ne 0) { throw "D5b5c 离线响应时序测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "D5b5c Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "D5b5c 文档检查失败" }

pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "D5b5c 完整质量链失败" }
Write-Host "D5b5c 质量链退出码：$LASTEXITCODE"
```

质量链通过后，若既有隔离 Lab 中 D5b4 工程的三项基础 ACL 仍完整，先执行 PostgreSQL **只读**后置审计，再在独立浏览器真实执行 D5b5b 顺序回归及 D5b5c 逆序响应专项：

```powershell
$projectId = (Read-Host "请输入已撤权的真实 D5b4 专用工程 ID").Trim()
pnpm run oidc:lab:published:revoke:after --project-id $projectId
if ($LASTEXITCODE -ne 0) { throw "D5b4e 撤权后数据库只读审计失败" }

pnpm run test:published:oidc:revoke:multitab:browser --project-id $projectId
if ($LASTEXITCODE -ne 0) { throw "D5b5b 真实顺序双标签测试失败" }

pnpm run test:published:oidc:revoke:late:browser --project-id $projectId
if ($LASTEXITCODE -ne 0) { throw "D5b5c 真实响应逆序交付失败" }
Write-Host "D5b5c 真实只读专项退出码：$LASTEXITCODE"
```

新离线用例使用 Node 原生 `node:test` 和 `node:vm`，覆盖精确工程前缀、单次 GET、两页 pending、逆序释放、错误状态码、缓存、重定向、重复请求、写入阻断与独立 CDP Realm。协作容器 Node **v22.16.0** 的本地原型 **13/13 通过**；正式 GitHub 分支文件仍需维护者在 Windows 复跑上述命令，不能以原型测试替代提交后的质量链或真实浏览器专项。真实浏览器不会被加入根 `ready`。

## 2026-11-22 · D5b5b/D5b5c 浏览器失败后的 E-077 分类诊断复测

维护者 Windows 已完成 D5b5c 离线 13/13、`vp check` 401/253 零告警、`docs:check` 89 份、全量 `ready` 退出码 0；既有撤权工程 PostgreSQL READ ONLY 审计亦成功。但真实 D5b5b 在 React 第一标签页发布 GET 后失败；D5b5c 在 React 第二标签页原始 404 Promise 优先交付后失败，两个浏览器专项均退出码 1。**这些失败不是全链检查通过的反证，仍然是必须单独关闭的业务验收阻塞**。D5b5c 的两个 pending 阶段已严格核对真实 404/no-store/无重定向；尚未得到释放后的精确失败分类。

本轮只调整测试代码的**失败诊断**：共享 `classifyD5b5PreservationFailure` 将原严格断言的失败映射为固定中文类别（工程 GET 数量、响应计数、真实 404/no-store/重定向或 SVG/JSON/IndexedDB/CAS 单项变化）；D5b5c 将该固定类别加入自己的安全白名单。仍须执行 `requireD5b5Preserved` 和所有原有零写入、草稿及 CAS 保护，遇失败照常退出 1；不输出任何工程正文、Hash、身份、Cookie、Token 或原始异常。未知异常仍脱敏。**真实差异根因待本次修补后的浏览器日志确认**，禁止擅自忽略额外 GET 或漂移。

先取得最新 PR #121 HEAD，执行以下离线检查，失败立即中止：

```powershell
git fetch origin
git switch test/b35-d5b5c-revoked-late-read
git pull --ff-only
git rev-parse HEAD

pnpm run test:published:oidc:revoke:multitab:config
if ($LASTEXITCODE -ne 0) { throw "D5b5b 修补后离线门禁失败" }

pnpm run test:published:oidc:revoke:late:config
if ($LASTEXITCODE -ne 0) { throw "D5b5c 修补后离线门禁失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "D5b5c 质量检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "D5b5c 文档检查失败" }

pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "D5b5c 完整质量链失败" }
Write-Host "D5b5c 修补后完整质量链退出码：$LASTEXITCODE"
```

随后继续使用**已经存在且保持撤权状态**的原实际 D5b4 工程，先单独执行 `oidc:lab:published:revoke:after`（仅只读），再运行 `test:published:oidc:revoke:multitab:browser` 和 `test:published:oidc:revoke:late:browser`。**必须先处理 D5b5b 的明确失败类别再评价 D5b5c 的最终状态**；遇失败保留终端固定类别与退出码即可，不收集 Cookie、Token 或完整工程快照。不重新运行撤权 `--apply`、不恢复 ACL、不新增 SQL、不得以开启生产写入或放宽安全断言作为修复。

## 2026-11-22 · E-078 已撤权工程双标签只读 GET 响应结算回归

此前 E-077 修补版的 Windows 离线门禁 D5b5b 16/16、D5b5c 14/14、`vp check` 401/253、`docs:check` 89、完整 `ready` 退出码 0。真实撤权后 PostgreSQL READ ONLY 审计通过，但 D5b5b React 在两次 404 成功后最终双页守卫检查失败；D5b5c React 在两个真实 404 Promise 同时挂起、先释放第二页后报告“工程响应数量不符”，均退出码 1，Vue 未覆盖。

新 E-078 候选不修改服务器、数据库、React/Vue 生产业务或真实 HTTP Response。仅让浏览器只读安全测试在比对守卫之前，等待此前已发出的真实 GET 完成；`paths` 比 `statuses` 多代表仍有请求未结算，最多轮询 80 次，每次间隔 150ms。没有返回、响应比路径多、守卫缺失或拦截到工程写入都禁止验收；仍逐次核对目标 GET 404 精确新增 1 次，原画布、工程 JSON、IndexedDB 草稿、自动保存和 CAS 保持不变。当前只能称之为针对**已证实时序机制**的候选修补，实际失败根因仍需真实复验确认。

Windows 先从 PR #121 最新分支读取并记录 HEAD，执行：

```powershell
git fetch origin
git switch test/b35-d5b5c-revoked-late-read
git pull --ff-only
git rev-parse HEAD

pnpm run test:published:oidc:revoke:multitab:config
if ($LASTEXITCODE -ne 0) { throw "D5b5b E-078 离线测试失败" }

pnpm run test:published:oidc:revoke:late:config
if ($LASTEXITCODE -ne 0) { throw "D5b5c 离线测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "E-078 Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "E-078 文档检查失败" }

pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "E-078 完整质量链失败" }
```

质量链通过后只对**同一现存、已撤权、经过明确只读审计的 D5b4 专用工程**执行 `oidc:lab:published:revoke:after --project-id <真实ID>`、`test:published:oidc:revoke:multitab:browser --project-id <真实ID>`，成功后再执行 `test:published:oidc:revoke:late:browser --project-id <真实ID>`。脚本需要独立隔离 Chrome/Edge 并手动登录已预绑定 Keycloak 测试身份，不能输入终端密码。真实浏览器仍不进入 `ready`。不得重新撤权、恢复 ACL、创建工程或调用任何生产设备写入。

## 2026-11-22 · E-079 D5b5c 逆序交付隐藏第一页后再切换可见性复验

已验证的 Windows HEAD `baa612ca029ff3f8a3bd6fe75b03ba24c7d85f9b`：D5b4e PostgreSQL READ ONLY 审计通过；**D5b5b React/Vue 双端真实双标签页、顺序发布 GET 404 及 SVG/草稿/CAS 保护全部通过**；D5b5c React 两页真实响应同时 pending、第二页先交付通过，却在**切回第一页后检查第一响应**时报“工程请求数量不符”，退出码 1，Vue 尚未验收。末尾若有单独的 `Write-Host`，它**不能代替**进程退出码 0。

E-079 候选将“切回第一标签”移到两次真实响应完成严格交付和计数检查之后，最后仍真正切回第一标签复核本地状态与完整工程 API 只读守卫。新增隐藏第一标签逆序交付 Node 用例，不跳过 HTTP 404/no-store 或任何额外 GET/写入拒绝。**尚待最新 Windows HEAD 复验**；原 14/14 和 `ready` 通过不自动继承至新 HEAD。

请复制为**一个 PowerShell 脚本块**执行，防止某条测试失败后仍手工执行无条件“通过”输出。先验证本地 HEAD 与最新 PR #121 一致（从 GitHub PR 取当前 SHA），然后执行：

```powershell
& {
    git fetch origin
    if ($LASTEXITCODE -ne 0) { throw "Git 更新远端引用失败" }
    git switch test/b35-d5b5c-revoked-late-read
    if ($LASTEXITCODE -ne 0) { throw "切换验收分支失败" }
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw "验收分支更新失败" }
    $actualHead = (git rev-parse HEAD).Trim()
    Write-Host "本次测试 HEAD：$actualHead"

    pnpm run test:published:oidc:revoke:multitab:config
    if ($LASTEXITCODE -ne 0) { throw "D5b5b 离线门禁失败" }
    pnpm run test:published:oidc:revoke:late:config
    if ($LASTEXITCODE -ne 0) { throw "D5b5c 离线门禁失败" }
    vp check
    if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }
    pnpm run docs:check
    if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
    pnpm run ready
    if ($LASTEXITCODE -ne 0) { throw "完整质量链失败" }

    $projectId = "d5b4-revoke-52c2ad3b-4800-42ca-8769-a7bee5da4d4a"
    pnpm run oidc:lab:published:revoke:after --project-id $projectId
    if ($LASTEXITCODE -ne 0) { throw "数据库只读审计失败" }
    pnpm run test:published:oidc:revoke:late:browser --project-id $projectId
    if ($LASTEXITCODE -ne 0) { throw "D5b5c 真实双框架浏览器专项失败" }
    Write-Host "D5b5c 真实浏览器专项退出码：$LASTEXITCODE"
}
```

只使用**已经存在且撤权状态未变化**的隔离工程；上轮 D5b5b 已真实双框架通过且本补丁不改变该脚本，可优先单独复测 D5b5c。若最终 D5b5c 通过，再根据维护者验收标准复核整条组合链。严格禁止恢复 `release:read`、再次执行撤权、生产数据库写入和设备控制。

## 2026-11-22 · D5b6 已撤权正式运行页真实隐藏重显专项（Draft 待验收）

在 PR #121 已合并、D5b5b/D5b5c 均具备 React/Vue 真实浏览器通过证据后，新增 **D5b6**：专门验证**正式已发布运行页**（不是 Studio 测试自己发的 GET）在独立 `release:read` 已撤权时，真实标签页隐藏/重显是否清空旧内容、只在重显时重新读取且仍安全拒绝。每个 Origin 的首次 GET 与重显 GET 都必须来自现有运行页业务生命周期，真实返回 `404 + no-store + 无重定向`。隐藏与停止不能增加请求，整个测试只能发 GET。使用同一个隔离 Chrome Profile 的两个同源标签页和同一真实预绑定身份，原生按钮触发，绝不造假 404，不恢复 ACL。

**Windows 先执行正式质量链**（异常时停止；不要将单独无条件打印的“通过”当成功）：

```powershell
& {
    git fetch origin
    if ($LASTEXITCODE -ne 0) { throw "远端引用更新失败" }
    git switch test/b35-d5b6-revoked-runtime-visibility
    if ($LASTEXITCODE -ne 0) { throw "切换 D5b6 分支失败" }
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw "D5b6 分支更新失败" }
    $head = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw "读取 Git HEAD 失败" }
    Write-Host "D5b6 本次验收 HEAD：$head"

    pnpm run test:published:oidc:revoke:visibility:config
    if ($LASTEXITCODE -ne 0) { throw "D5b6 离线安全测试失败" }

    vp check
    if ($LASTEXITCODE -ne 0) { throw "D5b6 Vite+ 零警告检查失败" }

    pnpm run docs:check
    if ($LASTEXITCODE -ne 0) { throw "D5b6 文档检查失败" }

    pnpm run ready
    if ($LASTEXITCODE -ne 0) { throw "D5b6 完整质量链失败" }
    Write-Host "D5b6 完整质量链实际退出码：$LASTEXITCODE"
}
```

**质量链通过后**仅在可信本机 HTTPS/Keycloak Lab、同一已撤权且当前仍保持三项基础授权的 D5b4 专用工程上，先只读审计，再真实运行页面生命周期，失败即停止：

```powershell
& {
    $projectId = "d5b4-revoke-52c2ad3b-4800-42ca-8769-a7bee5da4d4a"
    pnpm run oidc:lab:published:revoke:after --project-id $projectId
    if ($LASTEXITCODE -ne 0) { throw "D5b6 撤权后数据库只读复核失败" }

    pnpm run test:published:oidc:revoke:visibility:browser --project-id $projectId
    if ($LASTEXITCODE -ne 0) { throw "D5b6 已撤权真实隐藏重显专项失败" }
    Write-Host "D5b6 React/Vue 已发布运行真实浏览器专项通过"
}
```

真实浏览器需要在脚本启动的**独立隔离浏览器**中手动登录现有预绑定 Keycloak 测试用户，**不要在终端输入密码**。必须看到 React/Vue 各自的首次 404、隐藏清空、重显 404 和停止清理四类阶段通过。Node 离线 13 项、Vite+、docs、ready 和真实浏览器尚未获得新提交后的 Windows 执行记录，不能提前标记通过。新专项不测试 `verified → denied` 的真实已发布状态撤权竞争；生产安全门禁和设备写入仍关闭。

## 2026-11-22 · D5b7a 已验证快照撤权与迟到响应共享 Runtime 单测

本次只新增两项纯 Vitest 回归，**不操作任何数据库或工程授权**，不得将模拟的 `forbidden` / `not_found` 读取器错误说成真实 HTTP 或真实 ACL 撤销。先从最新 PR 专用分支明确记录 HEAD，再运行定向测试、无自动修复的 Vite+、文档与完整质量链。任何失败立即退出，不输出无条件“已通过”消息：

```powershell
& {
    git fetch origin
    if ($LASTEXITCODE -ne 0) { throw "远端引用更新失败" }
    git switch test/b35-d5b7a-published-runtime-denial-race
    if ($LASTEXITCODE -ne 0) { throw "切换 D5b7a 测试分支失败" }
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw "更新 D5b7a 测试分支失败" }
    $head = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw "读取 Git HEAD 失败" }
    Write-Host "D5b7a 验收 HEAD：$head"

    vp test run packages/runtime/test/published-runtime-refresher.test.ts
    if ($LASTEXITCODE -ne 0) { throw "D5b7a 共享 Runtime 定向测试失败" }

    vp check
    if ($LASTEXITCODE -ne 0) { throw "D5b7a Vite+ 检查失败" }

    pnpm run docs:check
    if ($LASTEXITCODE -ne 0) { throw "D5b7a 文档检查失败" }

    pnpm run ready
    if ($LASTEXITCODE -ne 0) { throw "D5b7a 完整质量链失败" }
    Write-Host "D5b7a 共享 Runtime 纯单测与质量链通过"
}
```

本候选保持 Draft，不新增真实浏览器或 ACL 写入命令。真正 `verified → denied` 端到端实验必须先验证有合法发布快照、独立测试工程、数据库/权限基线和可恢复方案；**需要单独明确许可**，且后续涉及的 PostgreSQL 操作必须在隔离环境附带完整 URL 验证及 `try/finally`。不可用刚通过 D5b6 的已撤权 D5b4 工程直接恢复授权或伪造发布状态。

## 2026-11-22 · D5b7b 已发布夹具元数据离线只读门禁

本批只提供纯函数元数据分类器与原生 Node 负向测试，不连接 PostgreSQL、Keycloak、浏览器或工业设备；不创建已发布夹具，不恢复 ACL，也不调用正式发布 API。测试用的 `d5b7b-published-<UUID v4>` 是**合成标识**，不得当成真实工程 ID。只有未来通过独立许可取得受控数据库只读记录，才能把结果作为下一步审核输入。

- `DENIED`：目标工程不存在或当前可信主体缺少独立 `release:read`；不读取也不暴露发布内容。
- `UNRELEASED`：授权存在，但代次为零，发布修订、摘要、末次事件均为空。
- `RELEASED_METADATA_ONLY`：授权、发布指针、目标版本摘要和末次事件元数据匹配；**不是**经过真实快照核验的 `verified`，也不证明夹具确实存在。

仓库内需依次运行下列 PowerShell 7 验收，任一步失败立即退出，不以 `--fix` 代替检查：

```powershell
& {
    git switch test/d5b7b-published-fixture-metadata
    if ($LASTEXITCODE -ne 0) { throw "切换 D5b7b 分支失败" }
    git pull --ff-only origin test/d5b7b-published-fixture-metadata
    if ($LASTEXITCODE -ne 0) { throw "更新 D5b7b 分支失败" }
    $head = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw "读取 D5b7b HEAD 失败" }
    Write-Host "D5b7b 验收 HEAD：$head"

    pnpm run test:published:oidc:fixture:metadata:config
    if ($LASTEXITCODE -ne 0) { throw "D5b7b 离线元数据测试失败" }
    vp check
    if ($LASTEXITCODE -ne 0) { throw "D5b7b Vite+ 检查失败" }
    pnpm run docs:check
    if ($LASTEXITCODE -ne 0) { throw "D5b7b 文档检查失败" }
    pnpm run ready
    if ($LASTEXITCODE -ne 0) { throw "D5b7b 完整质量链失败" }
}
```

**禁止执行真实发布或撤权实验。** 真实 `verified → denied` 需要维护者单独确认独立已发布工程、测试主体、隔离数据库、操作权限及恢复方案；若未来只读查询获准，必须使用显式目标、参数化 SQL、`REPEATABLE READ READ ONLY` 与 `ROLLBACK`，不查询快照正文、不回显身份凭据。

## 2026-11-22 · D5b7c 独立已发布夹具 PostgreSQL 只读审查候选

在 D5b7b 元数据离线分类器基础上新增 `scripts/inspect-published-fixture-readonly.mjs`，但**真实数据库连接不在 `ready` 内执行**。程序只接受 `--project-id` 加一份已经存在的 `d5b7b-published-<UUID v4>` 专用隔离工程；严禁把格式示例当作真实工程。无参数、额外参数及旧 D5b1/D5b4 工程一律在数据库连接之前拒绝。

审查工具沿用 D5b4 现有可信本机 OIDC Lab 目标校验，使用 **`BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`**，无论成功或失败均执行 `ROLLBACK`。它先核验本机数据库用户、三项已应用发布迁移、无未解决迁移、活动身份与预绑定，再读取同一租户目标工程和独立 `release:read`。没有权限时不读取发布指针、历史版本或事件。确实具有读取权限时仅查询**代次、修订、摘要与末次事件**，从不选择 `snapshot` JSON 正文；将这些元数据交给 D5b7b 纯函数输出 `DENIED`、`UNRELEASED` 或 `RELEASED_METADATA_ONLY`。

Windows PowerShell 7 离线验收：

```powershell
& {
    $ErrorActionPreference = "Stop"
    git fetch origin
    if ($LASTEXITCODE -ne 0) { throw "拉取远程提交失败" }
    git switch test/d5b7c-published-fixture-readonly
    if ($LASTEXITCODE -ne 0) { throw "切换 D5b7c 分支失败" }
    git pull --ff-only origin test/d5b7c-published-fixture-readonly
    if ($LASTEXITCODE -ne 0) { throw "更新 D5b7c 分支失败" }
    git rev-parse HEAD
    pnpm run test:published:oidc:fixture:readonly:config
    if ($LASTEXITCODE -ne 0) { throw "D5b7c 只读事务安全测试失败" }
    vp check
    if ($LASTEXITCODE -ne 0) { throw "D5b7c Vite+ 检查失败" }
    pnpm run docs:check
    if ($LASTEXITCODE -ne 0) { throw "D5b7c 文档检查失败" }
    pnpm run ready
    if ($LASTEXITCODE -ne 0) { throw "D5b7c 完整质量链失败" }
}
```

**真实 DB 只读执行不包含在上面命令中。** 仅当维护者另外核实唯一已存在、已合法发布、已授权、可审计的独立 Lab 工程及可信身份后，才允许手工运行 `pnpm run oidc:lab:published:fixture:readonly --project-id <人工核实的工程ID>`。这不是发布事务，也不会调用 ACL 删除/恢复；但即使它输出 `RELEASED_METADATA_ONLY`，仍**不能**将其视为真实快照 SHA-256 验证、受控发布来源证明、已发布运行 UI 通过或撤权授权。未经专项安全审批，不执行发布或撤权写入。

## 2026-11-22 · D5b7d Issue #126 原 D5b1 只读基线复核

在现有 D5b7c PostgreSQL 只读审查器中补齐**原 D5b1 工程的基线完整性**，所有基线查询与目标发布元数据保持在同一个 `REPEATABLE READ READ ONLY` 事务、统一 `ROLLBACK`。复核固定的原 D5b1 工程 `d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca`：必须恰好一份首版修订、可信操作者保存审计、发布代次 0 / 三项空指针 / 零发布事件、原主体四项固定权限。基线出现任何新增版本、发布、额外 ACL、撤权、审计或表字段异常，均在**查询 D5b7b 目标工程之前**拒绝；不会查询快照正文、执行数据库写入或自动补救。

此检查不证明目标已发布，只确认审查运行期间原 D5b1 基线未漂移。真实 D5b7b 已发布夹具仍没有可信存在证据，真实 `verified → denied` 仍未授权。以下只在 Windows 离线执行，不会连接 PostgreSQL：

```powershell
& {
    $ErrorActionPreference = "Stop"
    if (git status --porcelain) { throw "工作区存在未提交修改，停止切换分支" }
    git fetch origin
    if ($LASTEXITCODE -ne 0) { throw "获取远程分支失败" }
    git switch test/d5b7d-baseline-readonly
    if ($LASTEXITCODE -ne 0) { throw "切换 D5b7d 分支失败" }
    git pull --ff-only origin test/d5b7d-baseline-readonly
    if ($LASTEXITCODE -ne 0) { throw "更新 D5b7d 分支失败" }
    $head = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw "读取 HEAD 失败" }
    Write-Host "D5b7d 验收 HEAD：$head"
    pnpm run test:published:oidc:fixture:baseline:config
    if ($LASTEXITCODE -ne 0) { throw "原 D5b1 基线校验测试失败" }
    pnpm run test:published:oidc:fixture:readonly:config
    if ($LASTEXITCODE -ne 0) { throw "D5b7c 事务回归失败" }
    vp check
    if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }
    pnpm run docs:check
    if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
    pnpm run ready
    if ($LASTEXITCODE -ne 0) { throw "完整质量链失败" }
}
```

**禁止本批运行任何真实发布、回滚或撤权写入。** 如果随后获得真实独立已发布工程存在性、可信隔离目标及专项只读查询授权，再依既有 D5b7c 手动只读入口进行数据验证；不将合成元数据当成真实已发布状态。

## 2026-11-22 · D5b7e Issue #126 全量目标 ACL 只读门禁候选

D5b7d 已经维护者 Windows 完整验收并合并；本次继续修复 D5b7c 原始 SQL 的 ACL 覆盖缺口。旧查询额外限定 `subject_id = $3 AND permission = 'release:read'`，会在 SQL 层隐藏目标工程的其他主体授权、多余的发布权限与重复/缺失基础 ACL。即使 D5b7b 纯函数拒绝非单行输入，该查询也会预先剔除坏数据，使检查结果缺乏全量授权证据。

本批保留 `REPEATABLE READ READ ONLY`、同租户工程参数、D5b1 原基线与统一 `ROLLBACK`，将**目标工程**的 ACL 查询更改为：`SELECT subject_id, permission ... WHERE tenant_id = $1 AND project_id = $2`。进入纯元数据分类器前，必须校验全量 ACL 只能为：无 ACL（拒绝）、固定主体的三项基础 `project:read`/`version:read`/`version:append`（撤权后拒绝），或同一主体再加唯一 `release:read`（继续审查发布元数据）。任何额外权限、其他主体、缺失基础授权、重复或快照污染字段均 fail-closed，不再读取目标发布指针。原分类器仍仅接收零行或一行 `release:read`，不改变对外三态契约。工程不存在但存在孤立 ACL 时拒绝。

Windows 离线验收（**不会连接真实 PostgreSQL**）：

```powershell
& {
    $ErrorActionPreference = "Stop"
    if (git status --porcelain) { throw "工作区存在未提交修改，停止切换分支" }
    git fetch origin
    if ($LASTEXITCODE -ne 0) { throw "获取远程提交失败" }
    git switch test/d5b7e-target-acl-inventory
    if ($LASTEXITCODE -ne 0) { throw "切换 D5b7e 分支失败" }
    git pull --ff-only origin test/d5b7e-target-acl-inventory
    if ($LASTEXITCODE -ne 0) { throw "更新 D5b7e 分支失败" }
    git rev-parse HEAD
    pnpm run test:published:oidc:fixture:readonly:config
    if ($LASTEXITCODE -ne 0) { throw "D5b7e ACL 回归失败" }
    pnpm run test:published:oidc:fixture:baseline:config
    if ($LASTEXITCODE -ne 0) { throw "D5b7d 基线回归失败" }
    vp check
    if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }
    pnpm run docs:check
    if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
    pnpm run ready
    if ($LASTEXITCODE -ne 0) { throw "完整质量链失败" }
}
```

本批仅安全审查，不调用真实 PostgreSQL、发布、授权、撤权或恢复脚本。实际独立 RELEASED 夹具与真实 `verified → denied` 仍未确认，不因离线 ACL 回归通过而关闭 Issue #126。
