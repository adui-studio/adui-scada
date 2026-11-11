# ADui SCADA · 长期项目上下文

- 日期：2026-11-09
- 版本阶段：V0.1，**Web/Server 工具链、React/Vue MSI 构建及桌面安装启动/离线模拟展示已通过维护者本机验证；工业安全及生产能力仍未验收**。
- 品牌：ADui Studio。
- 结构：React/Vue 两个正式 Web 应用，共享 Core 与 Runtime 业务逻辑。Studio 与 Runtime 位于同一个 Web 应用、不同功能模块。

## 已实现的源码

- Vite+ / pnpm Monorepo、现有 Agent 工程文档、Skills。
- `packages/core` 工程 Schema 校验、Tag 状态、SVG 和模拟器。
- `packages/runtime` 只读 SSE、快照/增量、STALE 质量、重连逻辑。
- `apps/web-react` / `apps/web-vue` 两个最小 Web Runtime，分别参考各自默认模板。
- 根 Catalog 管理 TypeScript 6.0.3、Vitest、Vue/React、NestJS 及 Tauri CLI 的 JS 依赖；Core/Runtime/Server 测试统一 Vitest。
- 新增根目录唯一 `.editorconfig`，以及 `@adui/tsconfig`、`@adui/tooling` 两个共享规范包，Web/Server/Core/Runtime 通过各自入口继承配置。
- `apps/server`：参考 NestJS 12 默认 ESM 模板创建模块化 Server，仅 GET /health 本地进程探针。
- `apps/desktop`：参考 Tauri 2 模板创建 Rust 桌面壳，默认嵌入 React Web，支持 Vue 配置覆盖，未提供特权设备命令。

## 尚未交付

完整 Studio 编辑器（V0.2 仅实现首批本地操作）、生产业务后端接口、真实网关、报警/历史、工程发布、Tauri 生产离线运行能力、3D、数据库、认证授权、真实协议与现场性能/安全验证。
当前两个 Web 应用不包含编辑器，亦不能作为现场 SCADA 使用。

## 当前未完成的验收

- React/Vue MSI 已在维护者 Windows 环境安装并启动成功；仍需在全新 Windows 环境验证卸载、升级、兼容性及长期运行。两个构建共用安装包名称/产品标识，不支持默认并行安装。
- React 桌面离线模拟已截图验证 STALE 状态；仍需核验 STALE → GOOD 恢复全过程、Vue 相同阶段以及 Web 开发 SSE 的连接/断线语义。MSI 使用共享 Core 离线模拟，不内置 HTTP SSE 服务。
- 核对 Cargo.lock 与 pnpm-lock.yaml 的实际提交状态，确保构建可重现。
- 明确开源许可证、生产工业安全准入与真实网关的隔离边界。

[工具链](V0.1_TOOLCHAIN.md) · [Harness](HARNESS.md) · [代码地图](CODEBASE_MAP.md)

## 2026-11-09 · 首轮 Windows 质量检查反馈

`pnpm install`、`pnpm run deps:check`、`pnpm run config:check` 已由维护者运行成功。
`pnpm run ready` 首先被格式差异阻断；`vp check --fix` 暴露 7 个类型错误与 1 个测试规则警告。已对源代码和共享格式忽略规则做针对性修复，**等待维护者本机复验**。

## 2026-11-09 · Windows 桌面打包更新

React Web 与 Rust Release 编译成功，Windows WiX 已输出 MSI 文件；NSIS 依赖文件 `nsis_tauri_utils.dll` 下载遇到 HTTP 504，导致原先的 all-targets 打包命令失败。已新增 React/Vue 单独构建 MSI 的命令以绕过非必需的 NSIS 下载。维护者随后已成功构建两套 Release MSI；MSI 尚未完成独立安装及实时监控验收。

## 2026-11-09 · 双框架 MSI 构建验收成功

维护者已在 Windows 实际运行 `pnpm run desktop:build:react:msi` 和 `pnpm run desktop:build:vue:msi`，Tauri 日志均显示 Rust Release 编译成功以及 `Finished 1 bundle`。React MSI 1.92 MiB，Vue MSI 1.88 MiB，均使用 `ADui SCADA_0.1.0_x64_en-US.msi` 文件名；后构建可能覆盖前一个同名文件。此里程碑为**构建通过**，不等于安装测试、NSIS 打包或现场生产能力通过。

## 2026-11-09 · Vue MSI 安装首测与离线模拟修复

维护者提供的截图确认 Vue MSI **可以安装并启动桌面窗口**，但监控页出现 `Unexpected token '<'`：Tauri 发布版不包含 Vite 的 `/demo` 开发代理，工程请求实际得到 HTML。故安装启动通过、Runtime 数据链路未通过。

本轮在共享 Core/Runtime 添加显式离线模拟分支，并让两套 Tauri Web 构建使用 `--mode desktop`：共享水处理工程、模拟数据、`STALE` 状态，不访问 PLC/DCS，不注册额外 Tauri 权限。原浏览器开发 SSE 链路保持不变，网页正式后端连接仍未开发。本修复源代码已进入 PR，**Windows 重新构建、安装和实际数据演示待验证**。

## 2026-11-09 · Vue / React MSI 安装运行验收

维护者确认两套 MSI 均已完成安装并可启动桌面窗口。Vue 截图显示 `SIMULATION` 状态、水处理 SVG 和三项模拟数据（含 `GOOD` 品质）；React 截图显示同一水处理 SVG 在离线模拟中断阶段将数值及设备质量标为 `STALE`，旧值没有伪装为实时 `GOOD`。

因此 V0.1 的**双框架桌面安装与模拟运行里程碑已达成**。截图没有涵盖完整断线恢复循环、卸载升级或干净环境复现；本轮不能认定现场工业协议、生产运行、设备安全或完整 SCADA 系统已经验收。

## 2026-11-09 · STALE → GOOD 自动恢复人工验收通过

维护者继续运行桌面离线模拟后确认，模拟断线期间 `STALE` 正确展示，并能够按预期恢复 `GOOD`。至此 V0.1 React/Vue 桌面模拟的构建、安装、显示及质量恢复主要演示链路均获人工确认。该结论不涵盖生产设备、工业协议、真实网络故障恢复、系统升级与安全认证，PR 合并应另经代码审查。

## 2026-11-09 · Docker 部署能力预留

响应未来 Docker 部署目标，新增 `deploy/docker/` 下的 Compose 演示拓扑（React Web、Vue Web、NestJS 健康检查、Node SSE 模拟器），共享 Node 24 + pnpm workspace 构建，并通过 Nginx 为两端提供同源 `/demo` 接口。仅将 Web 的 8080/8081 映射到宿主机 loopback，不将模拟器和 Server 公开发布；所有真实网关、数据库、认证、生产 API、正式 Docker 发布流程均尚未实现。

当前状态：**配置/源码已补充，未在实际 Docker 环境构建或启动**。后续验收参见 [Docker 演示说明](../deploy/docker/README.md)。Tauri Windows MSI 继续独立发行。

## 2026-11-09 · 开发环境与部署环境变量规范

新增 `.env.example`（根 Docker 端口模板），以及 React、Vue、NestJS、SSE 模拟服务各自的 `.env.example`。前端 Vite 开发服务器读 `SCADA_*`；NestJS 与 SSE 服务通过 Node 内置 `loadEnvFile` 加载可选的本地变量；Docker Compose 开放的仅为可自定义的 loopback Web 端口。

新增 `pnpm run env:check`，作为 `ready` 的前置检查。相关设计见 [环境变量说明](ENVIRONMENT.md) 与 [ADR-0008](adr/0008-env-configuration.md)。**当前仅提交开发配置代码及文档，等待维护者本机复验。**

## 2026-11-09 · V0.2 共享 SVG Studio 首批开发

在已合并的 V0.1 `main` 基线上新建 `feat/v0.2-svg-editor-foundation`，新增 `@adui/scada-core/editor` 框架无关编辑命令和单元测试，React/Vue Studio 双版本：图元选择、拖动及方向微调、Label 文案、撤销重做、本地 JSON 导入导出。现有 Runtime 仍按需独立加载，Demo/SSE/Docker/Tauri 默认运行监控入口不变。

**实际实现范围仅为本地首批编辑交互**，不包含服务端工程保存/版本发布、缩放、对齐、图层、复杂图元编辑、正式工业设备数据。开发分支仍待维护者本机 `pnpm run ready` 及两套框架交互测试，不得提前标记 V0.2 完成。

## 2026-11-09 · V0.2 编辑器互通验收与配置收敛

维护者实际验证 **React → Vue → React** 本地工程 JSON 往返，节点和 Tag 绑定一致，记录为已完成的人工交互验收；不扩展成全部 FR-013 或反向链路完成。

Windows 使用 `vp check --fix` 时大量 CRLF → LF，分析后保留项目的 LF 规范并增加 `.gitattributes` 强制检出 LF，避免重复格式化；.bat/.cmd 例外。将原本五处 `.env.example` 收敛为根目录唯一模板，各应用和 Docker 都读取根 `.env`；Nginx 上游端口也按 Compose 注入的变量同步生成。取代 ADR-0008 的分散环境方案，详见 [ADR-0010](adr/0010-root-env-lf.md)。

当前本轮代码修改尚待 Windows `pnpm run ready` 与 Docker 回归，不能将配置变更视为已运行成功。GitHub PR #4 仍为 Draft，main 不变。

维护者此前已确认 V0.1 Docker 本地演示成功运行；这项验收发生在本轮单一根 `.env` 和 Nginx 端口模板变更之前。本次 Docker 变更不能沿用旧结果，需重新验收。

## 2026-11-09 · V0.2 第二批画布能力开发

在 PR #4（共享 Studio 第一阶段与统一根 .env）获准并通过 GitHub Squash Merge 后，从最新 main `d0a6db5` 新建 `feat/v0.2-editor-canvas-operations`。新增共享 Core 多选/移动/对齐/图层排序及受控图元增删，并同步接入 React/Vue 的缩放与工具按钮。

**已提交源码的实现状态不等于通过本机验收**；新增 Core 用例、Vite+ 格式和 TS6、Web 双构建、双框架手动体验与 JSON 往返均需开发者在 Windows 实际执行后才能标记通过。本阶段不实现正式工程保存、网关或设备写入。

## 2026-11-09 · V0.2 框选与快捷键开发

在 PR #5 分支继续开发 Core 的 `findNodesInRect` 与原子 `selectMany`；React/Vue 两端增加框选 UI 和仅在 Studio 生命周期内有效的键盘操作。缩放和选择仍不持久化，不改变 Runtime、工业网关边界或工程 Schema。新增 5 个单元用例，共 22 个编辑器用例。

尚未获得本轮 Windows `ready`、浏览器操作、反向跨框架 JSON 往返的验收证据；PR #5 保持 Draft，不合并 main。

## 2026-11-10 · V0.2 Windows 回归测试阻塞

维护者执行 `pnpm run ready` 时，依赖/配置/根 .env/LF/Vite+ 检查及 React/Vue/NestJS 类型检查已通过；22 个编辑器单测及其他 Core/Runtime 共 41 项通过。NestJS Controller 单测在 5 秒时限超时，导致 **41/42 通过、ready 未通过**，E2E/文档/构建未执行。本次为减少不必要的测试启动成本，将 Controller 单测改为直接构造依赖并断言返回值，保留原 E2E 测试覆盖 Nest 容器与 HTTP 路由。不更改服务端业务代码或测试全局超时。

**状态：修复代码待本机 `pnpm run ready` 复验。PR #5 继续 Draft，不合并 main。**

## 2026-11-10 · 统一自有提示与测试描述为简体中文

维护者明确要求自有 `throw`、测试名称、日志、注释、JSDoc 等全部使用中文。本次在 V0.2 PR #5 开发分支统一 Core/Runtime/Studio/NestJS/示例服务/校验脚本/Docker/Tauri 的自有文案，同时保持工程 Schema、Tag ID、协议状态和 HTTP 路由不变。新增共享的 Tag 质量和 Runtime 状态中文显示名称，React/Vue 与 SVG 同步使用；单元测试名称与断言也随错误文案一起更新。

新增 `messages:check` 质量入口，并由 `ready` 执行，约束未来自有文案。仍需维护者本机测试所有修改；尚未提供本轮 `ready` 成功证据，PR #5 继续保持 Draft。

## 2026-11-10 · V0.2 画布网格与吸附开发

从已合并 PR #5 的 `main` 提交 `15f80ab` 开始下一批编辑器增强，分支 `feat/v0.2-canvas-grid-snap-guides`。新增独立共享 `snap.ts` 的网格与图元参考线吸附计算，Vue/React 采用相同拖动预览和提交位移；默认显示 20 单位网格，网格吸附、图元吸附可独立开关，参考线只在拖动时显示。

本批只处理视图和已有图元位置，工程 JSON、Tag ID、设备协议及 Runtime 保持不变；尚不包含属性尺寸/旋转面板、页面管理、保存发布。新增单元测试和自有中文文案，仍需维护者 Windows `pnpm run ready` 与两套 Studio 交互验收，不能预先声明测试通过。

## 2026-11-10 · 网格吸附小数边界一致性修复

复核 V0.2 画布吸附时发现：原 `resolveDragSnap` 对已限制在画布范围内的小数位移再次取整，可能造成拖动预览的落点与 `withNodesTranslated` 实际提交位置不一致。现调整为与共享 Core 一致的“先取整，再按精确边界截断”，分别增加靠近左、右小数边界的单元回归用例。不修改工程 Schema、双框架接口或工业数据链路。本修复仅完成源码/边界逻辑检查，新增测试及完整 `pnpm run ready` 仍待本机实际执行。

## 2026-11-10 · V0.2 网格编辑器 `ready` 格式化阻塞

维护者 Windows 首次执行本批 `pnpm run ready`：Catalog、共享配置、环境/LF 和中文文案检查通过；`vp check` 因 React Studio 的 JSX 网格叠加条件表达式缺少 `}` 而无法解析，同时列出 Vue Studio 与吸附测试的格式差异。本批的 TS、Vitest、E2E 和 Web/NestJS 构建尚未开始。本轮已直接修复 PR #6 分支中的 React 语法及相关格式，等待重新执行 `ready` 的完整结果，**不得把该次失败记录为测试通过**。

## 2026-11-10 · 吸附边界单元测试反馈

维护者再次执行 V0.2 `pnpm run ready`，前置环境、中文文案检查、格式/Lint 和双 Web/Server 类型检查均通过；57 个单测中 2 项小数边界失败（55 项通过）。根因是吸附提供的精确边界位移传入 `DocumentEditor.moveBy` 后，又被共享 `withNodesTranslated` 取整为 0。已在原 PR #6 分支修复边界端点保留逻辑、增加相应回归测试并更新详细设计；尚未运行修复后的 Vitest/ready，未开展 E2E 或构建，暂不合并。

## 2026-11-10 · V0.2 质量链复验结果（用户 Windows 日志）

维护者在当前功能分支提供 `pnpm run ready` 日志：环境、中文文案、Vite+ 格式检查（124 文件）、Lint/静态检查（49 文件）、React/Vue 与 NestJS 类型检查均通过；**59 项单元测试全部通过、2 项 NestJS E2E 全部通过**，27 个 Markdown 文档检查通过，React/Vue Web 构建成功。终端已输出 `nest build`，但未包含最终退出状态，不将 NestJS 构建记为已确认成功。尚未收到网格、吸附、拖动、缩放、撤销/重做、跨框架 JSON 双向互通的浏览器实测结论。PR #6 继续保持 Draft，不合并 main。

## 2026-11-10 · V0.2 双框架画布交互验收确认

维护者已回复「验收完成」，据此将 V0.2 第四批网格/图元吸附/辅助线的 Vue/React 七项交互验收记录为**维护者确认通过**：网格与开关、吸附辅助线、多选整体拖动、缩放、边界与撤销重做、React→Vue→React JSON/Tag 互通、Runtime 模拟数据显示。此声明不自动扩大为正式工业现场验收。

之前的 Windows `pnpm run ready` 输出明确确认：59 项单测及 2 项 NestJS E2E 全部通过，双前端构建和各项静态质量检查通过；`nest build` 尚未提供最终退出状态。当前仍不包含生产设备接入、网关、正式工程发布或 Docker/Tauri 专项回归。PR #6 暂维持 Draft，`main` 不变，等待明确合并指令。

## 2026-11-10 · V0.2 第五批图元位置、尺寸与旋转属性编辑

在上一批网格与吸附 PR #6 完成维护者交互验收但尚未合并 main 的情况下，从其已确认的分支提交 `5537033` 创建后续功能分支 `feat/v0.2-node-transform-properties`，避免未经授权合并 main。新增共享 Core 几何属性编辑纯函数、原子命令及 6 项单元测试；Vue/React 同步添加五个数值输入的单选属性面板与统一样式。工程 JSON 使用既有 `transform` 字段，不增加 Schema 版本、依赖或工业设备控制。

验收范围为合法手工输入、越界与非法输入拒绝、撤销/重做、两框架 JSON 互通和旧 Runtime 回归。**本批未实际运行 Vite+/类型检查/测试/构建；此前 PR #6 的质量通过记录不自动继承为本分支通过**。新 PR 先保持 Draft，待维护者 Windows 验证后再讨论合并。

## 2026-11-10 · V0.2 第五批测试状态反馈

维护者对 PR #7 所属图元几何属性编辑任务回复「测试完成」。当前未提供完整 `pnpm run ready` 退出状态、65 项预计单测的实际运行结果或六项双框架交互用例的逐项结论，故记录为**已反馈测试完成，是否全部通过待明确确认**。PR #7 继续保持 Draft，基于尚未合并的 PR #6 分支开发；不改动 main，不扩展为工业现场验收。

## 2026-11-10 · 第五批维护者确认全部通过

维护者针对 V0.2 第五批「图元位置、尺寸与旋转属性编辑」明确回复「全部通过」，即确认本地 `pnpm run ready` 及 Vue/React 六项交互测试无错误。本批功能的测试和双框架交互验收可记录为**维护者确认通过**，不是 Agent 亲自执行所得的自动化记录。未提供实际单测数量与原始命令日志，因此不将预计 65 项当作已独立核对的统计；此次文档提交后也未重新运行检查。PR #7 为基于 PR #6 分支的 Draft，二者均未经授权合并至 main；工业现场、Docker 和 Tauri 专项验收不在此次范围内。

## 2026-11-10 · V0.2 第六批：SVG 四角缩放与旋转

在 PR #6 和 PR #7 经维护者人工验收但尚未获授权合并 `main` 的前提下，从 PR #7 最新已验收分支创建 `feat/v0.2-transform-handles`，继续开发 SVG 单图元四角缩放、旋转控制点和原子撤销。核心 `transform-gesture.ts` 计算旋转图元局部缩放，React/Vue 用同一组共享数学函数并提供一致的控制点样式；错误候选保留最后合法预览，松开提交一次，Shift 旋转以 15° 吸附。

新增 12 项纯 Core 单测，单测源码预计 77 项；`ScadaDocument 0.1.0`、Tag ID/绑定、工业安全与 Runtime 不变。此为新开发分支的源码状态，**尚未运行本批 `pnpm run ready` 或真实双框架浏览器验收**，不提前认定验证通过；继续使用 Draft PR，不擅自合并上一批或主分支。

## 2026-11-10 · 第六批验收反馈与旋转鼠标样式优化

维护者确认 PR #8 第六批 SVG 四角缩放和旋转功能验收通过，同时提出「旋转鼠标样式更换」。基于其已存在的格式化提交继续最小修改：新增统一 `assets/cursors/rotate.svg`，React/Vue Studio 旋转控制点和旋转拖动状态改为环形旋转光标，结束或取消时清除状态。未更改几何计算、工程 Schema、Tag、Runtime 或工业安全边界。**光标修改发生在维护者验收之后，新的质量检查与实际浏览器验证仍待执行**；PR #6、#7、#8 保持 Draft，未合并 main。

## 2026-11-10 · 旋转光标变更后的质量链复验

维护者 Windows 日志已确认 `pnpm run ready` 的依赖/配置/环境/中文文案、128 文件格式、51 文件静态检查、React/Vue/NestJS 类型检查、**77/77 单测（8 文件）**、**2/2 E2E**、29 个 Markdown 文档检查和 React/Vue 构建通过；此前新增的 12 项缩放旋转手柄测试均通过。终端停在 `nest build` 输出，缺少该构建最终退出状态。仓库当前分支 `feat/v0.2-transform-handles` 已包含维护者的代码格式化提交 `00a179a`（仅涉及 Vue/React Studio CSS），无需重做其格式修改。新旋转 SVG 光标在实际浏览器中的完整悬停/拖动/取消反馈仍未收到。PR #8 保持 Draft，未合并 main；工业现场安全及 Docker/Tauri 不包含在本次复验。

## 2026-11-10 · 旋转光标 UI 验收确认

维护者回复「旋转光标正常」，确认第六批后续变更的双框架旋转箭头光标交互通过人工验收。先前本地日志已确认 77/77 单测、2/2 E2E、格式/Lint/类型检查、文档检查及双 Web 构建通过，惟 `nest build` 最终退出状态没有出现在所提供日志中。PR #8 的用户端交互项现已确认完成。PR #6～#8 继续保持 Draft，未经明确授权不合并 `main`；工业现场安全验收不在此次范围内。

## 2026-11-10 · V0.2 第七批八方向缩放开始开发

上一批 PR #6/#7/#8 已由维护者授权按序合并到 `main`（最新合并提交 `cc442bf`），维护者随后给出 77/77 单测、2/2 E2E、双框架与 NestJS 构建结果，其中 NestJS 独立构建退出码为 0。本批从该 `main` 创建独立 `feat/v0.2-eight-direction-resize`，为 Vue/React SVG Studio 增加四边中点缩放，扩展为八方向，并保持已实现的旋转和四角交互。

共享 Core 增加统一手柄坐标与中文 Aria 名称；旋转图元单轴缩放按尺寸投影中心变化固定对侧边中点，忽略垂直于缩放轴的鼠标位移；工程 JSON、Tag 绑定及工业安全边界不变。新增 7 项测试，整仓预计 84 项。**本批未在维护者 Windows 上执行完整检查或浏览器验收**，先以 Draft PR 交付，不合并 main。

## 2026-11-10 · V0.2 第七批维护者验收通过

维护者确认 PR #9 的八方向缩放功能「验收通过」，涵盖 Vue/React 单选八个控制点、边中点单轴缩放、旋转后对侧锚点、合法预览和撤销重做、工程 JSON/Tag 互通及原只读 Runtime 回归。验收确认来源于维护者，未提供原始 `pnpm run ready` 命令日志或实际单测统计；预计 84 项仅为源码计算值，不等同于已独立核对数量。当前功能分支还包含维护者格式提交 `82042df`。本批维持 PR #9 Draft，不自动沿用前次 PR #6～#8 的合并授权，`main` 继续保持 `cc442bf`。

## 2026-11-10 · V0.2 第八批 Shift 等比例缩放

PR #9 的八方向缩放已根据维护者明确授权以 Merge commit 合并到 `main`，合并提交 `47ca2f4`。本批在该基线创建独立开发分支 `feat/v0.2-aspect-ratio-resize`，为 Vue/React Studio 八方向缩放增加按住 Shift 锁定图元原有宽高比例，同时保持已实现的 Shift 旋转 15° 吸附、撤销/重做、只读 Runtime 和跨框架 JSON/Tag 互通。

新增 9 项 Core 回归用例，整仓源码单测预计 93 项；通过静态检查和独立数值算例核对了目标数学公式，但**尚未运行当前分支真实完整质量链和 Vue/React 浏览器验收**。Schema、依赖、工业通信和服务端持久化不变。本批以 Draft PR 提交，不擅自合并 `main`。

## 2026-11-10 · 第八批首轮测试及两条 Lint 警告修复

维护者 Windows 日志确认本批 **93/93 单测、2/2 E2E、130 文件格式、React/Vue/NestJS 类型检查、31 份文档和两套 Web 构建通过**。`vp check` 报告 0 错误、2 条 Vitest 警告（`toThrow()` 缺少匹配条件），不视为零警告检查全部通过。已在功能分支将两处断言改为 `toThrow(/画布范围/)`，提交 `1c1279b`；本次修复未改几何或工业安全逻辑。最后 `nest build` 缺少退出码，真实 Vue/React 等比例缩放交互没有新的验收确认。**最新修复及文档提交后的质量检查仍待重新运行**，PR #10 保持 Draft，`main` 未改动。

## 2026-11-10 · 第八批完整 ready 复验通过，交互验收待确认

维护者在 `toThrow(/画布范围/)` 修复后重新执行 `pnpm run ready`，并给出最终 **退出码 0**。**130 文件格式检查、51 文件零警告 Lint/静态检查、React/Vue/NestJS 类型检查、93/93 单元测试、2/2 NestJS E2E、31 份文档检查、双 Web 构建与 NestJS 构建均通过**。这是维护者提供的 Windows 实测日志，非 Agent 自行执行；本次新增验收文档后未重新检查。

PR #10 的自动化质量链可标记为通过；React/Vue 的 Shift 缩放、旋转锚点、撤销重做和双方向 JSON/Tag 互通仍需实际浏览器人工确认。PR 保持 Draft，`main` 暂不合并。

## 2026-11-10 · 第八批 Shift 等比例缩放交互验收完成

维护者确认「交互验收通过」：PR #10 既定六项 Vue/React 浏览器交互验收均确认完成，包括原比例、边中点主轴、旋转与缩放坐标、撤销/非法边界、双向 JSON/Tag 与只读 Runtime。此前 Windows 日志已明确 `pnpm run ready` 最终退出码为 **0**，**93/93 单元测试、2/2 E2E、51 文件零警告、React/Vue/NestJS 构建通过**。这是维护者自动化日志及人工反馈，不代表 Agent 独立运行。本次仅更新验收文档，未改变业务代码；PR #10 继续保持 Draft，`main` 尚未合并本批。工业现场验收及正式发布仍未开展。

## 2026-11-10 · V0.2 第九批平面图元组合开发

在 PR #10 Shift 等比例缩放经维护者授权以 `752ef39` 合并到 `main` 后，创建 `feat/v0.2-node-grouping`。本批以平面逻辑组合 ID 实现 Vue/React 双框架组合与解组，沿用现有图元渲染、Tag 绑定和共享 Editor/Runtime 隔离。新增组合 JSON 校验、组员自动选中、纯吸附/移动组合扩展、单体编辑保护与原子历史；**新增 13 项测试，预计 106 项单测**。

本批未在 Windows 实机执行全量质量检查，也未完成 Vue/React 浏览器交互验收；从新分支提交 Draft PR，**不修改 main、不发布**。兼容性限制：`ScadaDocument 0.1.0` 新增可选 `groupId`，当前双框架共享 Parser 可以完整往返，旧版 Parser 可能丢弃组合元数据，正式 Schema 升级/迁移需另行决策。尚未建设正式工程保存/发布、工业网关或现场设备写入功能。

## 2026-11-10 · 第九批多图元逻辑组合维护者验收通过

维护者明确回复「验收通过」，确认 PR #11 既定 7 项质量及 Vue/React 交互验收清单整体完成。分支新增维护者格式整理提交 `9c06def`，声明 Vite+ 质量检查通过；未附完整 `pnpm run ready` 原始输出、单测实测项数或最终退出码，因此本批预计 106 项单测不能记为已独立验证的 106/106。

本次仅同步验收文档与 PR 清单，未变更图元组合业务代码。PR #11 继续 Draft，不自动合并 `main`；`ScadaDocument 0.1.0` 的可选 `groupId` 仍存在旧版本解析器丢失元数据的兼容性风险，后续需规划 Schema 版本与迁移。

## 2026-11-10 · V0.2 第十批 Schema 0.2.0 迁移开发

PR #11 已合并，最新 `main` 为 `3f20f10`，维护者确认该版 `pnpm run ready` **106/106 单测、2/2 E2E、零警告、退出码 0**，本地工作区干净。新分支 `feat/v0.2-schema-migration` 将工程 Schema 升至 `0.2.0`，仅允许合法 `0.1.0` 草稿通过共享 `migrateScadaDocument` 迁移，拒绝未知版本/结构字段，并保留已有 `groupId` 和 Tag 绑定。Editor 导入失败保持原状态；Vue/React 使用相同中文升级提示。

新增 **12 项**单测源码，整仓预计 **118 项**；本批**尚未执行完整质量链或双框架人工验收**。功能不改变 Runtime 工业只读边界、网关、后端持久化及工程发布。应在 Windows 验收通过后再讨论合并；Draft PR 默认分配 `@adui-dev`。

## 2026-11-10 · 第十批首次测试发现旧 SVG Fixture 并已修复

维护者 Windows `pnpm run ready` 在 Vitest 阶段失败：**115 项通过、1 个 SVG 测试文件加载失败，3 项 SVG 用例未运行**。原因是 `svg.test.ts` 测试 Fixture 固定写入 `schemaVersion: "0.1.0"`，与本批当前 Parser 仅接受 `0.2.0` 的契约冲突。依赖/配置/中文文案、133 文件格式、52 文件零警告 Lint、React/Vue/NestJS 类型检查已通过；E2E、文档检查和构建因早停未执行。

已提交测试 Fixture 最小修复 `a6e94a5`，使用共享 `SCADA_SCHEMA_VERSION`，**未改生产校验规则**。等待修复后完整质量链与浏览器验收，不将此前 115 项通过当作 118 项全部通过。PR #12 保持 Draft，仍分配 `@adui-dev`。

## 2026-11-10 · 第十批 Schema 迁移 ready 全部通过，交互验收待确认

维护者在分支格式整理提交 `c0bb653` 后提供 `pnpm run ready` 完整 Windows 日志：**118/118 单测、2/2 NestJS E2E、133 文件格式、52 文件零警告 Lint/静态检查、React/Vue/NestJS 类型检查、33 份文档校验与三端构建均通过；退出码 0**。修复后的 `svg.test.ts` **3/3** 恢复运行。该结果属于维护者真实测试，并非 Agent 本地执行。

本批自动化质量链验收完成，仍待 Vue/React 旧版工程导入升级提示、合法组合/Tag 保真、当前版双向互通、非法版本/未知字段回滚、只读 Runtime 与编辑器无回归等人工交互验收。仅记录已获证据的自动化项，不提前宣称浏览器交互通过或合并 PR #12。

## 2026-11-10 · 第十批 Schema 迁移双框架交互验收完成

维护者明确回复「验收通过」，确认 PR #12 的 Vue/React 历史 `0.1.0` 导入升级、合法组合与 Tag 保真、当前 `0.2.0` 双向 JSON 往返、非法版本/未知字段拒绝、失败导入原子性、只读 Runtime 和原编辑功能回归等**剩余六项人工验收整体通过**。此前维护者 Windows 实测 `pnpm run ready` 已完成 **118/118 单元测试、2/2 E2E、全部三端构建并退出码 0**。人工结论不是 Agent 独立浏览器验证；新增文档后未重跑完整检查。

PR #12 已具备全部七项验收结论，仍保留 Draft、分配 `@adui-dev`，等待维护者另行授权合并 `main`。本批仅解决单段 Schema `0.1.0 → 0.2.0` 的受控迁移，不代表正式发布/工业设备接入完成。

## 2026-11-10 · V0.2 第十一批浏览器工程草稿开发

在 PR #12 已合并到 `main`（`fe6581c`）后，建立 `feat/v0.2-local-drafts`。此前维护者在 Schema 迁移特性分支上运行完整 `pnpm run ready`，**118/118 单测、2/2 E2E、三端构建及退出码 0**，并确认双框架交互；该结果不代表本批或合并后 `main` 已独立复验。

本批新增无框架依赖的 `local-draft.ts`，通过 `LocalDraftStorage` 注入支持按工程 ID 保存、读取、清除浏览器草稿及校验版本、容量、完整结构。Vue/React 均提供手动按钮与覆盖/恢复/删除确认，避免页面启动时自动覆盖工程。新增 **10 项** Core 单元测试，整仓单测入口预计 **128 项**；实际 `pnpm run ready`、浏览器刷新恢复、存储异常与双框架互通仍待维护者 Windows 验证。

实现仍属浏览器临时草稿，不是服务端工程管理、正式持久化/发布、自动保存或工业网关。开发分支 Draft PR 应分配给 `@adui-dev`，未经授权不得合并 `main`。

## 2026-11-10 · 第十一批 Vite+ 检查阻塞修复（待复验）

维护者 `vp check --fix` 实际发现 Core `TextEncoder` 无类型定义 **2 处 TS2304 错误**，以及 React Effect 同步状态更新、Vitest 空 `toThrow()` **2 项 Lint 警告**；格式化完成不代表检查通过。已在 PR #13 分支提交 `6ea0c00` 修复这四项问题，并加强中文多字节的 2 MiB 容量测试，不修改生产 Schema、不新增依赖。Node 独立字节计数样例与原生 `TextEncoder` 输出一致，但尚未得到本分支全量 `ready` 实测结果。PR 保持 Draft，仍由 `@adui-dev` 验收。

## 2026-11-10 · 第十一批自动化复验进展

维护者已提供 Windows `pnpm run ready` 日志：依赖/配置/中文文案 **75 文件**、**136 文件格式**、**54 文件零警告静态检查**、React/Vue/NestJS 类型检查、**128/128 单测**、**2/2 E2E**、**34 份 Markdown** 校验和两套 Web 构建均通过。日志结尾开始执行 `nest build`，**缺少最后退出码**，暂不登记完整 `ready` 退出码 0。新增维护者格式提交 `ed6a857` 仅修改代码排版。

单独 Node UTF-8 字节计数对照已验证 ASCII、中文、Emoji、孤立代理项与大文本结果同 `TextEncoder`，但不能替代仓库质量链；Vue/React 本地草稿交互验收仍未确认。PR #13 继续 Draft、分配给 `@adui-dev`，不自动合并。

## 2026-11-10 · 第十一批本地草稿保存验收与合并授权

维护者补充 `pnpm run ready` 最终退出码 **0**。此前 Windows 完整日志确认 **128/128 单元测试、2/2 NestJS E2E、34 份文档、136 文件格式、54 文件零警告、React/Vue/NestJS 类型检查和三端构建通过**。维护者明确回复「保存验证成功，同意合并」，因此**本地草稿保存功能已确认验收且 PR #13 已获合并授权**。未收到全部六项浏览器场景的逐项独立测试记录，不能额外声称所有操作已手动复测。

该结果由维护者终端日志与人工反馈提供，不是 Agent 独立 Windows/浏览器执行。新增本次文档后尚未重新运行文档检查，服务端正式工程管理、多标签页冲突和生产现场安全不包含在本批结果中。

## 2026-11-10 · V0.2 第十二批安全自动保存开发（待验收）

在第十一批 PR #13 已合并并核对 `main` 为 `27a2229` 后，从该提交创建 `feat/v0.2-safe-autosave`。上一批维护者 Windows 实际执行 `pnpm run ready` **128/128 单测、2/2 E2E、三端构建通过、退出码 0**，并确认本地草稿保存功能；这不是第十二批的测试结果。

本批在既有 `local-draft.ts` 扩展 `LocalDraftAutoSaveSession`，统一工程脏状态、同一存储记录冲突检测与人工保存基线；Vue/React 均增加默认关闭的自动保存开关、1000 ms 防抖、浏览器跨标签页停写，以及导入/恢复/清除时暂停。现有原子 `DocumentEditor.loadDocument`、`0.2.0` Schema 和工业只读 Runtime 不变。新增 **12 项** Core 单元测试，预计整仓 **140 项**，新增 ADR-0020 后文档预计 **35 份**。尚未在维护者 Windows 实测 `pnpm run ready`、浏览器并发及真实刷新恢复，不能声称功能已验收。

`localStorage` 无原子 CAS，保存前冲突检测只是尽力而为；本批不实现严格跨标签页锁、服务端工程版本/发布、自动恢复或工业设备写入。开发分支应保持 Draft PR，按规则分配 `@adui-dev`，未经单独授权不合并 `main`。

## 2026-11-10 · 第十二批改用 Dexie IndexedDB（待质量复验）

维护者明确要求采用 IndexedDB 并核实当前最佳库。在比较 Dexie、idb 和 localForage、核对 npm 已发布版本与许可证之后，选择 `dexie@4.4.7` 作为浏览器持久化层，测试依赖 `fake-indexeddb@6.2.8`，均使用 Catalog。改动继续保留于既有 `feat/v0.2-safe-autosave` / PR #14 Draft，不改 `main`。

本批新增 `@adui/scada-draft-storage` 包与独立的 Core 异步 `DraftRepository` 契约，Vue/React 改用共享 IndexedDB 数据仓储。保存时在读写事务内验证 `revision` 并写入，支持标签页冲突拒绝；旧 `localStorage` 合法草稿首次读取后受控迁移，数据库成功提交之前不删除原始草稿。Core 原同步函数仍保留支持历史迁移和单测。新增 **7 项异步 Core 用例与 9 项模拟 IndexedDB 用例**；加上已有第十二批 12 项，整仓单测源码预计 **156 项**、文档预计 **36 份**。该数字属于静态源码统计，**尚未完成新依赖安装及本批完整 `ready`**。

新增存储包及 TSConfig 检查、两套 Web 对等适配未在维护者 Windows 浏览器验收；正式服务端持久化、历史快照、工业网关、PLC/DCS 写入仍未实现，不能因为引入 Dexie 视为正式工程数据库已经交付。

## 2026-11-10 · 第十二批 Dexie 修复审查补充（待复验）

PR #14 仍为 Draft。继维护者 `2189eb4` 修复历史草稿确认删除后，新增 `0ef9c76`：统一异步拒绝错误，区分损坏历史草稿与数据库/浏览器存储权限故障；新增 `cbab4c8`：在事务内持久化 `lastRevision` 水位，避免删除重建后修订号归 1 导致旧标签页 ABA 覆盖。源码合计预计 **160 项单测**，**不代表已执行通过**；首次新依赖安装、双端 IndexedDB 验收和完整质量链仍待维护者 Windows 日志。

保留原有工业只读安全限制及 Vue/React 共享 Core 契约；不扩展服务端持久化、正式发布或 PLC/DCS 写入。

## 2026-11-10 · V0.2 第十三批模拟 Tag 绑定编辑（待验收）

已合并 PR #14 的 `main` 为本批基线，分支 `feat/v0.2-demo-tag-bindings`。共享 Core 新增 Tag 绑定编辑命令与槽约束，Vue/React Studio 同步提供水处理模拟 Tag 候选选择与解除，工程 Schema `0.2.0`、JSON 互通、IndexedDB 草稿和只读 Runtime 不变。

本批新增 6 项共享编辑器单元测试源码，整仓预计从此前维护者实测 **160 项增加到 166 项**。这只是静态统计，本轮还没有真实运行 `pnpm run ready` 或 Vue/React 交互验收。上批的 160/160 单测、2/2 E2E 和退出码 0 不得替代本轮结果。未经本批维护者验收与单独授权不合并 `main`。

## 2026-11-10 · V0.2 第十四批多页面编辑开发（待验收）

PR #15（模拟 Tag 绑定编辑）已获得维护者 Windows `pnpm run ready` **166/166 单测、2/2 E2E、三端构建成功、退出码 0** 验收，并合并至 `main`，合并提交 `a9d7aa6`。本轮从该基线新建 `feat/v0.2-multi-page-studio`，没有改变 `main`。

本批共享 `DocumentEditor` 支持页面创建、重命名、切换、删除与关联的撤销上下文；按页面扩展框选、移动、吸附和 SVG 预览，Vue/React 双端显示同样的页面管理导航。仍使用已存在的 `ScadaDocument 0.2.0` 的 `pages`，维持 Dexie 草稿存储、只读 Runtime 与设备隔离。

新增 12 项 Core 编辑器用例及 1 项 Runtime SVG 选页用例，整仓**源码预计 179 项单元测试**，NestJS E2E 预期仍 2 项，增加 ADR-0022 后文档预计 37 份。以上为源码静态计数；**本轮没有执行 Windows `pnpm run ready`、浏览器多页面实际交互、Docker/Tauri 或工业现场验收**，不能沿用此前 166/166 通过结果。待用户验收后另行确认合并权限。

## 2026-11-10 · V0.2 第十五批复制页面与跨页图元复制（待验收）

PR #16 多页面编辑管理已根据维护者授权以 Squash Merge 合并 `main`（提交 `850b7cd`），其最新 Windows `pnpm run ready` 完整日志为 **179/179 单测、2/2 E2E、146 文件格式、零警告、37 份 Markdown、三端构建成功、退出码 0**。该结果不代表第十五批代码的实际质量检查。

本批在独立分支 `feat/v0.2-page-copy-order` 实现页面复制、相邻排序和跨页面选中图元复制。共享 Core 统一生成全工程唯一的页面、图元及组合 ID，保护 Tag/规则/几何，保留原内容；复制组合不会拆散，不同画布目标超限则原子拒绝。Vue/React Studio 同步新增操作入口，仍使用 `ScadaDocument 0.2.0` 与现有 Dexie IndexedDB 草稿。增加 [ADR-0023](adr/0023-page-copy-and-reordering.md)。

新增 **15 项 Core 单元测试源码**，整仓预计 **194 项单元测试**，NestJS E2E 预计 **2 项**，Markdown 预计 **38 份**。这些均为源码静态计数，本批还未在维护者 Windows 运行 `pnpm run ready` 或完成双框架浏览器验收；不沿用先前 PR 的测试通过结论，也未获得本批合并授权。

## 2026-11-10 · V0.2 第十六批会话图元剪贴板（待验收）

第十五批 PR #17 已获得维护者完整 Windows `pnpm run ready` **194/194 单测、2/2 E2E、147 文件格式检查、零警告、38 份文档、三端构建成功、退出码 0** 验收，并经明确授权合并到 `main`，合并提交 `7bda1bb`。这些结果仅适用于第十五批。

本批在新分支 `feat/v0.2-node-clipboard` 实现共享 `DocumentEditor` 会话内图元复制、剪切、重复粘贴，支持组合成员自动展开、ID 重映射、跨页粘贴、整体边界限制及撤销重做。Vue/React Studio 同步增加按钮与 `Ctrl/Cmd+C/X/V`，保持用户文本输入和系统剪贴板隔离，不新增依赖、不升级 Schema、不影响 Dexie 草稿与只读 Runtime。新增 [ADR-0024](adr/0024-session-node-clipboard.md)。

本批新增 **13 项 Core 单测源码**，整仓预计 **207 项单元测试**、2 项 E2E、39 份 Markdown；**本轮没有运行完整 `pnpm run ready`，也没有在维护者 Windows 浏览器完成实际交互验收**。在获得本批日志与另行合并授权前，PR 保持 Draft，`main` 不变。

## 2026-11-10 · V0.2 第十七批图层锁定与显示隐藏（待验收）

第十六批 PR #18（会话图元剪贴板）已获得维护者 Windows `pnpm run ready` **207/207 单测、2/2 E2E、148 文件格式、零告警、39 份 Markdown 与三端构建、退出码 0** 的验收，明确授权合并 `main`（合并提交 `3c025e5`）。本记录仅是上一批实测，不代表第十七批结果。

当前从最新 `main` 新建 `feat/v0.2-node-layer-state`，新增 `props.__scadaStudio` 的严格布尔值校验、共享 Core 锁定和可见性批量命令、统一编辑提交保护、SVG Runtime 隐藏过滤、Vue/React 双端图层管理 UI。沿用 Schema `0.2.0` 与现有 Dexie 草稿；为防严格白名单兼容问题不增加顶层字段，新增 ADR-0025 明确旧 Runtime 无法识别隐藏的风险。

本批新增 Core 编辑器 14 项、Schema 3 项、SVG 2 项回归测试源码，**预计 226 项单测**、2 项 E2E、40 份 Markdown。尚未执行维护者 Windows `pnpm run ready` 或双端浏览器人工验收；不得沿用第十六批结果。未经本批明确合并授权，保留 Draft PR 且不修改 `main`。

## 2026-11-11 · V0.2 第十八批精确图层排序（待验收）

第十七批 PR #19 已经维护者 Windows `pnpm run ready` 验收：**226/226 单测、2/2 E2E、149 文件格式、零告警、40 份 Markdown 及 React/Vue/NestJS 构建通过，退出码 0**，并获明确授权合并 `main`（Squash 合并提交 `5341986`）。该结论仅适用于第十七批。

从当前 `main` 建立 `feat/v0.2-precise-layer-order`，共享 Core 新增 `moveLayer` 精确插入与源组合连续搬运；已有四个排序按钮对单一组合按整组移动，中央锁定图元索引约束继续生效。React/Vue 图层列表倒序展示并接入 HTML5 原生拖放与目标图元精确选择，不引入依赖、不升级 Schema、不修改 Runtime。新增 [ADR-0026](adr/0026-precise-layer-order.md)。

本批新增 **17 项共享 Core 单元测试源码**，整仓静态预计 **243 项单测**、2 项 E2E，新增 ADR 后 Markdown 静态预计 **41 份**。**本批尚未在维护者 Windows 执行 `pnpm run ready`、浏览器图层拖拽或草稿恢复实测**；不能沿用 PR #19 的 226 项成功记录。Draft PR 未获单独合并授权，`main` 不变。

## 2026-11-11 · V0.2 第十九批组合图层树（待验收）

上一批 PR #20 精确图层排序已获维护者回复「验收通过，同意合并」，于 GitHub 通过 Squash Merge 合并到 `main`（提交 `e7b276e`）。最新分支提交说明称已完成 Vite+ 质量检查，但在此前对话未获得完整 `pnpm run ready` 日志；因此 **243 项单测**属于上一批源码预期数，不能冒称当前环境独立实测。

本批从该 `main` 建立 `feat/v0.2-layer-group-tree`，在共享 Core 新增不持久化的 `buildLayerTree` 一层平面组合树投影，按真实 `nodes[]` 构建组和成员、搜索过滤、隐藏/锁定统计及非连续层序提示。Vue/React 图层面板同时增加组折叠、搜索、定位已选和画布选中同步；继续复用原 Core 的选择和拖拽命令，保持 Schema `0.2.0`、Dexie 草稿和只读 Runtime 边界。新建 [ADR-0027](adr/0027-layer-group-tree-projection.md)。

本批新增 **13 项 Core 回归测试源码**，整仓静态预计 **256 项单测**，NestJS E2E 预计 **2 项**，Markdown 预计 **42 份**。当前仅有 GitHub 远端源码提交与静态核对，**尚未执行维护者 Windows 的 `pnpm run ready`、双框架浏览器交互、IndexedDB 恢复实测**；本批必须单独验收并另行授权才能合并。

## 2026-11-11 · V0.2 第二十批 TDesign UI 选型与属性区首轮迁移（待验收）

上一批 PR #21 组合图层树已获维护者 Windows `pnpm run ready` 成功日志：**256/256 单测、2/2 E2E、153 文件格式检查、42 份 Markdown 及 React/Vue/NestJS 构建通过、退出码 0**；经明确授权 Squash 合并到 `main`（提交 `c836ca2`）。这仅是上一批实测结果。

维护者明确将双端 UI 选为 `tdesign-react` 与 `tdesign-vue-next`，图标使用 `tdesign-icons-react` 和 `tdesign-icons-vue-next`。本批从 `main` 创建 `feat/v0.2-tdesign-property-panel`，Catalog 固定版本，React/Vue Studio 首批迁移属性操作按钮与文案输入、图层搜索与清除图标；共享 Core 统一五项几何字段名称，Schema `0.2.0`、Runtime 和 IndexedDB 草稿不改。新增 [ADR-0028](adr/0028-tdesign-dual-framework-ui.md)，并在 AGENTS 固化新选型。

本批新增加 1 项 Core 测试源码，预计 **257 项单测**、2 项 E2E、43 份 Markdown。当前远端工具环境无法访问 npm Registry，尚未提交新的 `pnpm-lock.yaml`；维护者需在联网 Windows 更新锁文件并加入功能分支后，执行冻结安装、`vp check --fix` 与完整 `pnpm run ready`。**本批未在当前 Agent 环境完成实际安装、类型检查、编译、浏览器或工业现场验收**。Draft PR 未获本批明确合并授权，不能改 `main`。

## 2026-11-11 · 目标分支 V7 品牌主题统一（待维护者验收）

在 `feat/v0.2-tdesign-property-panel` 中保留已确认的 React/Vue TDesign 技术选型，新增共享主题 Token，统一 V7 品牌蓝、科技青与实时绿的语义，接入品牌包原版 SVG Logo，并通过两端主入口加载 `@adui/normalize.css@0.1.1` 默认 Normalize。不改变 Core、工程 Schema、Tag、工业只读边界或 TDesign 控件业务行为。未将原生样式统一替换为 UI 组件；Tauri 桌面窗口图标未在本批更换。

由于当前远端执行环境无法访问 npm Registry，本批未更新依赖解析锁文件；需要维护者在联网的 Windows 环境运行安装、`pnpm run ready` 与 React/Vue 浏览器手工回归，本次仅完成代码提交，不将未执行的检查标为通过。详见 [ADR-0029](adr/0029-brand-theme-v7.md)。

## 2026-11-11 · Tailwind CSS 与 Studio 全屏布局（待本机验收）

用户反馈旧 Studio 居中限宽和浏览器外层滚动条。依据仓库 `ui-ux-pro-max` 布局/无障碍规则，在 `feat/v0.2-tdesign-property-panel` 继续实施：Vue/React 接入 Tailwind CSS 4.3.5（关闭 Preflight）、共享 V7 设计 Token、替换 Studio 布局为动态视口全屏和内部滚动，保留 TDesign 组件与独立 SVG 交互逻辑。尚未联网更新 `pnpm-lock.yaml`、未在 Windows 执行完整 `pnpm run ready`、未实测两端浏览器及桌面 MSI。技术决策见 [ADR-0030](adr/0030-tailwind-fullscreen-studio.md)。

## 2026-11-11 · Tailwind 共享包与 React CSS 构建阻塞修复（待本机复验）

维护者 Windows 日志确认当前功能分支完成 Catalog、共享配置、环境、中文文案、159 个文件格式检查、61 文件静态检查、双 Web/Server 类型检查、**257/257 项单元测试、2/2 项 NestJS E2E 及 45 份 Markdown 静态校验**。进入 React Web 生产构建后，Vite+/Lightning CSS 因 Tailwind CSS 的 `@import ... source("./") layer(utilities)` 顺序产生不合法的 `@media layer(utilities)`，构建失败；后续 Vue Web/NestJS 构建未运行，因此该次 `pnpm run ready` **未通过**。

按维护者要求，抽取 `packages/tailwind` 作为内部 `@adui/tailwind` 包，两端应用统一引用共享 CSS 和 Vite 插件；从源头改正 `layer(utilities) source(none)` 顺序并通过显式 `@source` 扫描两套应用，避免组件样式漂移或意外引入 Tailwind Preflight。新增共享配置静态契约。此次修复在远端仓库直接提交，**尚未运行更新后的 pnpm 依赖安装、React/Vue 构建、完整 ready 或浏览器交互**，以维护者后续 Windows 复验为准。详见 [ADR-0030](adr/0030-tailwind-fullscreen-studio.md)。

## 2026-11-11 · V0.2 专业编辑器布局重排（待本机验收）

基于 Penpot、Figma、diagrams.net 和 Ignition Designer 的工作区分工，维护者要求改进原编辑器过度平铺按钮、画布权重不足、左右面板混乱的问题。本批在 `feat/v0.2-tdesign-property-panel` 重排双框架 Studio：顶部工程/页面操作收进可访问的展开菜单，左侧固定图元库并独立滚动图层树，中部画布独立滚动且允许侧栏隐藏，右侧几何与 Tag 属性优先展示，高级编排操作折叠到底部；状态与模拟警告移至底栏。

新增 `@adui/tailwind/studio.css` 作为 Vue/React 共享布局样式，未改变 Core、工程 Schema、Tag、SSE/模拟、Dexie 和 PLC/DCS 只读边界。已通过远端源码静态结构核对；**未运行改造后的 `pnpm run ready`、React/Vue 构建和浏览器交互测试，不能沿用上一轮 257/257 单测日志宣称本批通过。** 详见 [ADR-0031](adr/0031-canvas-first-studio-workspace.md)。

## 2026-11-11 · 16:9 画板无滚动与视图按钮合并（待本机验收）

维护者截图确认画布有纵向滚动条，要求 **画板 16:9、左右侧栏固定宽度、中部自适应，合并部分操作按钮**。本批在 `feat/v0.2-tdesign-property-panel` 中新增共享 Core 视区数学函数，将原 `zoom * 100%` DOM 宽度缩放改为 SVG `viewBox` 缩放和边界内平移；共享 `@adui/tailwind/studio.css` 使用 `container-type: size` 与 `100cqh` 让 16:9 画板等比适配中央可用空间，移除中间滚动条并保持桌面 252px / 320px 固定侧栏。网格、吸附和侧栏显隐折叠为“视图设置”；自动保存入口归入“文件与草稿”。

不强制更改已有 880×460 工程页面，以避免图元变形或 Schema 兼容性问题。Vue/React 双端逻辑对应，新增六项共享 Core 单测源码及静态校验。**该批尚未执行本机实际构建、自动化测试、浏览器/桌面端视觉验收。** 以维护者后续 `pnpm run ready` 及截图回归为准。详见 [ADR-0032](adr/0032-studio-16x9-fit-viewport.md)。

## 2026-11-11 · 修正画布四周留白（待本机验收）

维护者截图明确指出外框周围存在留白，本次在 `feat/v0.2-tdesign-property-panel` 上直接删除共享 CSS 中的 16:9 画板外框约束和桌面/窄屏画布内边距，中间编辑区改为全宽全高、背景连续、不出现独立画板边框。仍保留 SVG viewBox 与 `preserveAspectRatio="xMidYMid meet"`，不改变存量工程 880×460 的数据和图元比例。固定外框决策由 ADR-0033 取代 ADR-0032。尚未实测 React/Vue 浏览器几何尺寸或运行完整 ready。

## 2026-11-11 · 工作区网格铺满与工程页面分离（待本机验收）

维护者最新截图表明 CSS 虽已撑满中央工作区，网格 `rect` 仍仅使用 `page.size`，且 SVG 的等比适配在工程页面与工作区比例不同时出现空白。本批依据仓库 `ui-ux-pro-max` 的滚动、布局、键盘交互原则以及 Penpot、draw.io、Figma、Ignition Designer 的官方工作区设计，新增共享 Core `studioViewportRect`，React/Vue 各通过 `ResizeObserver` 采集真实 SVG 宽高，计算与可见工作区同宽高比的 SVG `viewBox`，用 `visibleRect` 铺满世界坐标网格，并单独绘制工程页面边框。保留原 `ScadaDocument` 的尺寸、图元坐标、模拟数据和工业设备安全边界，网格与边框不进入运行时或导出内容。

补充 6 项视区计算单测源码和双端静态配置检查。**这次远端提交后尚未执行本机 `pnpm run ready` 或浏览器真实 DOM 尺寸回归**；由维护者在 Windows 工作区验收。详见 [ADR-0034](adr/0034-studio-full-viewport-grid.md)。

## 2026-11-11 · 中央画布滚动条槽位与视区负零修复（待本机复验）

维护者浏览器截图中的画布右侧竖条来自双框架 `studio.css` 遗留的 `.studio-panel, .studio-stage { scrollbar-gutter: stable; }`：即使共享布局已设置 `overflow: hidden`，浏览器仍会为画布预留滚动条槽位。现仅移除该错误组合规则；真正可滚动的属性面板和图层树继续通过共享 `@adui/tailwind/studio.css` 独立预留滚动条空间，不修改 SVG 或页面布局。

维护者本机 `pnpm run ready` 已通过代码规范、类型检查并运行到单测；269 项中 268 通过，唯一失败是 `studioViewportRect` 返回 `y: -0`，导致严格对象比较与正零不相等。现由共享 Core 统一将零平移规范为 `+0`，新增负零回归测试并在 `config:check` 增加 Vue/React 画布槽位静态约束。**更新后的 `ready`、Web 构建和浏览器右侧间距仍待本机复验。**

## 2026-11-11 · V0.2 浏览器级回归入口（待 Windows 双端验收）

维护者最新反馈 `pnpm run ready` **退出码 0**，且 270/270 项单测、2/2 项 NestJS E2E、React/Vue 构建、NestJS 构建和文档检查全部通过。为覆盖此前多次出现的“网格未铺满、画布留白、滚动槽位、侧栏挤压、缩放不一致”等静态检查无法确认的问题，新增 `pnpm run test:browser`。脚本在隔离的 Chrome/Edge 中对两套 Web 的 1440×900、1024×768 页面执行实际 DOM 边界测量与基本交互冒烟测试，失败退出非零；不改 Schema、Core、UI 组件业务逻辑或工业安全边界，不增加 npm 依赖，也不改变已通过的 `ready`。**该测试尚未在维护者真实应用中运行，不能宣称浏览器 E2E 已通过。** 详见 [HARNESS](HARNESS.md)。

## 2026-11-11 · 修复浏览器验收默认入口与导航竞态（待本机复验）

维护者提供的 `pnpm run ready` 再次退出码 0（270 项单测、2 项服务端 E2E、React/Vue/NestJS 构建及文档检查通过），但 `pnpm run test:browser` 报 `未找到元素：.studio-workspace`。审查双框架 `App` 后确认：React/Vue 默认显示运行监控，浏览器验收脚本却未点击“组态编辑”即开始查找 Studio。现仅修复 `scripts/test-studio-browser.mjs`：先找到顶部导航按钮并点击、等待异步编辑器和 SVG 挂载；为每个视口生成不同本地测试 URL 规避连续导航竞态；新增详细失败诊断。已在独立 DOM 模拟中检查从运行监控进入编辑器与已在编辑器时无需重复点击两种路径；**尚未得到维护者 Windows 真实浏览器重新验收结果**，原 270/270 单测通过仅属于修复前版本。
