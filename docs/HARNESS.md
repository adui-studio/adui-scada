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

可独立执行 `pnpm run test:docker:server`，验证镜像仍可加载 NestJS/共享 Core，认证会话签发及工程/设备写入 API 均保持关闭。现有容器烟测不导入身份模块，因此不连接数据库。真实 OIDC 登录、会话发行端点、生产 HTTPS、身份撤销并发与审计待后续专项验收。

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
