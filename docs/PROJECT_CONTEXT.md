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

## 2026-11-11 · 修复隐藏图层导致画布不扩展（待本机复验）

维护者运行 `pnpm run test:browser`：React/Vue 在 1440×900 和 1024×768 各完成 19 项检查，其中仅“隐藏图层后画布自动扩展”失败，共 4 项失败；其余各 18 项通过。仓库 CSS 检查显示：`data-left-collapsed="true"` 将左侧 Grid 轨道改为 `0px` 并隐藏左侧 DOM 元素，Grid 自动布局因此可能把中央舞台放进第 1 个 `0px` 轨道，属性面板移入中间轨道。修复仅在共享 `@adui/tailwind/studio.css` 为图层侧栏、中间舞台和属性侧栏指定固定 `grid-column: 1/2/3`、`grid-row: 1`，而非改动两个框架的状态逻辑；窄屏 Flex 布局不受 Grid 列属性影响。共享配置静态检查新增显式列锚定契约，以防再次回归。**本批没有重新运行 Windows 双端浏览器验收或完整 `ready`，需维护者后续复验。**

## 2026-11-11 · V0.3 第一批：FR-013 双框架工程互通自动化

此前 V0.2 PR #22 已经通过维护者 Windows `ready`（270/270 单测、2/2 服务端 E2E、双 Web/NestJS 构建）和 `test:browser`（76/76）验收，并以 Squash Merge 提交 `85a9f943` 合并至 `main`。新分支 `test/v0.3-dual-framework-interop` 在此基线上新增独立 `test:interop`：真实 React/Vue UI 导入/导出双向往返，分别在两端增加图元后核对完整 JSON，验证非法 JSON 原子拒绝。使用隔离浏览器，保持旧 `ready`、Schema、设备只读边界与生产源码不变。本批仅已提交测试源码；**尚未取得新增命令的 Windows 实测结果，不能认定 FR-013 自动化验收完成**。

## 2026-11-11 · V0.3 第二批：工程校验与不可变版本快照基础（待验收）

V0.3 首批 PR #23 已于 2026-11-11 Squash Merge 到 `main`（`ef18ec1`）；维护者提供的 `test:interop`、`test:browser`（76/76）和 `ready`（270/270 单测、2/2 E2E、构建全部成功）日志仅对应此前版本。本批从最新 `main` 新建 `feat/v0.3-project-snapshot-foundation`，增加共享 Core 结构化首错校验与不可变 SHA-256 版本快照，包含严格回读、深冻结、摘要篡改保护及容量上限，不涉及 UI、正式发布、服务器存储或工业写入；新增 10 项 Core 单测。独立环境 TypeScript 编译及模拟 Parser 算法冒烟检查通过；**新分支的完整 Vite+ 检查、实际 Core 单测和 Windows 构建尚未执行，不可沿用上批测试通过的结论。** 详见 [ADR-0035](adr/0035-project-validation-snapshot.md)。

## 2026-11-11 · V0.3 第三批：本地工程历史快照仓储（待验收）

V0.3 第二批 PR #24 已 Squash Merge 至 `main`（`9a42ed5`），维护者提供的 `ready` 退出码 0、280/280 单测、2/2 E2E、双 Web 和 NestJS 构建均通过。第三批从该提交新建 `feat/v0.3-local-version-history`：在 Core 增加 `ProjectVersionRepository`；在原有 Dexie 包中新增独立本地历史库，使用 CAS 事务分配递增修订号、只追加快照及倒序分页查询；复用 ADR-0035 SHA-256 真实回读。新增 13 项 fake-indexeddb 单测，不修改 UI、草稿数据库或 Runtime。**新增测试尚未在维护者 Windows 实际执行，预计总单测 293 项不能认定为通过。** 此处只是本地版本仓储，非正式服务端发布、回滚和工业权限控制。参见 [ADR-0036](adr/0036-local-version-history.md)。

## 2026-11-11 · V0.3 第四批：双框架本地历史版本管理（待验收）

V0.3 第三批 PR #25 已 Squash Merge 至 `main`（`3e264990`）。维护者 Windows 实测 `pnpm run ready` 退出码 0、293/293 单测、2/2 E2E、双 Web/NestJS 构建通过。第四批从该基线建立独立分支 `feat/v0.3-studio-version-history-ui`：React/Vue 两端增加同构历史菜单、创建快照、分页历史、共享 Core 差异比较、受确认载入；确认后停用自动保存且不覆盖草稿；新增 4 项 Core 比较单测及隔离浏览器命令 `test:versions`。既有草稿/历史数据库、工程 Schema、工业只读 Runtime 均不变。本批测试**尚未在维护者 Windows 执行**，不可沿用第三批通过结论。详见 [ADR-0037](adr/0037-studio-version-history-ui.md)。

## 2026-11-11 · V0.3 第五批：本地版本恢复可靠性（浏览器已验收，完整质量链待复验）

V0.3 第四批 PR #26 已 Squash Merge 至 `main`（`6395c578`）。维护者的 Windows 日志确认 `pnpm run ready` 退出码 0、297/297 单测、2/2 服务端 E2E、双 Web/NestJS 构建通过，`test:browser` 76/76、`test:interop` 与 `test:versions` 双框架通过。第五批在独立 `test/v0.3-version-history-recovery-safety` 分支修复 JSON 导入未在异步等待期间持锁的竞态，补充自动保存队列停写/存储故障 2 项 Core 单测；新增隔离 Chrome/Edge 命令 `test:versions:safety` 覆盖真实 IndexedDB 草稿、载入取消与确认、刷新后历史、两 Origin 隔离、模拟权限异常与导入互斥。维护者已在 Windows 完成 `test:browser`（76/76）、`test:interop`、`test:versions`、`test:versions:safety` 四组浏览器验收且最终退出码为 0；**本批完整 `pnpm run ready` 尚未提供实测日志**；仍无正式服务器工程发布、回滚或设备写入。参见 [ADR-0038](adr/0038-version-recovery-safety.md)。

## 2026-11-11 · V0.3 第六批：草稿并发与停写安全测试（完整质量链通过，警告待复验）

第五批 PR #27 已 Squash Merge 至 `main`（`0388bd3`）；维护者已提供 `test:browser` 76/76、`test:interop`、`test:versions`、`test:versions:safety` 的实际通过日志与退出码 0，但第五批完整 `pnpm run ready` 尚无本批实测结果。第六批最初以第五批分支为基线，现已非强制同步最新 `main` 并将 PR #28 的目标调整为 `main`；第六批新增 Core 排队停写与临时故障重试 2 项、Dexie 现有草稿并发更新与保存/清除竞争 2 项，总计 4 项测试。维护者于 2026-11-11 提供真实 Windows `pnpm run ready` 输出：**18/18 文件、303/303 单元测试、2/2 NestJS E2E 通过，181 个文件格式检查、类型检查、53 份 Markdown 检查及 React/Vue/NestJS 构建通过，最终退出码 0**。同时 Vite+ 在 74 个受检文件中报告 **5 条 `vitest(no-conditional-expect)` 警告、0 错误**，均来自保存/清除竞争测试的条件断言。已改为无条件断言以保持分支覆盖，修复后完整 `ready` 仍待维护者重新执行；不得将初次通过当作零警告结果。 不变更工程 Schema 0.2.0、数据库结构、Vue/React 功能、Runtime、服务端正式发布或设备写入。

## 2026-11-11 · V0.3 第七批：真实双标签页草稿并发验收（最终通过并合并）

V0.3 第六批 PR #28 已经维护者授权、以 Squash Merge 合并到 `main`（`a951efc`）。维护者最终 Windows 实测 `pnpm run ready` 退出码 0、303/303 单测、2/2 NestJS E2E、181 个文件格式通过、74 个文件零警告/零错误、53 份 Markdown 检查及 React/Vue/NestJS 构建通过。第七批基于该提交补充 `pnpm run test:multitab`：在同一隔离浏览器内真正打开两个同源标签页，分别覆盖 React/Vue 的跨标签页广播停写、无广播 CAS 兜底、删除重建、模拟 IndexedDB 写入失败及恢复。本批没有修改 Core、工程 Schema、数据库结构、任何 Vue/React 业务 UI 或工业通信。维护者已在 Windows 实测：`pnpm run ready` 因 `CODEBASE_MAP.md`、`HARNESS.md`、`PROJECT_CONTEXT.md`、`VALIDATION.md`、`test-studio-browser.mjs` 共 5 个文件格式不符合要求而退出码 `1`；手动运行 `vp check --fix` 后格式检查通过，但另发现 1 条 `typescript(unbound-method)` 警告。独立 `test:multitab` 已通过 React 的 BroadcastChannel 通知、无广播 CAS 防覆盖及草稿清除重建三个场景，在模拟写入异常阶段失败（退出码 `1`），Vue 尚未执行。第七批已改用原生 `IDBObjectStore.put()` 注入故障，并使用 `Reflect.get()` 避免未绑定方法警告；**修复后的完整质量链和浏览器测试尚未实测，不能标记通过**。真实存储配额、Tauri WebView2 及现场工业网络仍不在本批验收范围。

## 2026-11-11 · V0.3 第八批：服务端工程请求契约（待 Windows 验收）

第七批 PR #29 经维护者真实 Windows 验收：`pnpm run ready` 退出码 0、303/303 单测、2/2 NestJS E2E、182 个文件格式正确、74 个文件零警告、54 个 Markdown 文档检查以及三端构建通过；`pnpm run test:multitab` React/Vue 共 8/8 场景通过。随后 Squash Merge 至 `main`（`4e4a8d9`）。

第八批从最新 `main` 建立新分支，在共享 Core 中新增 `parseServerProjectSaveRequest` 与 9 项单元测试，明确未来服务端工程保存请求的两字段白名单、修订号 CAS 预期、工程 ID 和 Schema 一致性及 2 MiB 容量限制；另新增 2 项 NestJS E2E，验证未开放的工程版本读/写路由继续返回 404；配套 ADR-0040 与文档。**尚未开放 NestJS 工程写入路由、用户认证、项目权限、数据库事务、发布或工业设备写入。** 维护者在 Windows 执行 `vp check --fix` 后，报告 Core 的 `server-project-contract.ts` 触发 `typescript(TS2304): Cannot find name 'TextEncoder'`（1 个错误、0 警告），格式化已完成。经检查 `@adui/tsconfig/core` 仅启用 ES2022 类型库，现改用现有 `project-snapshot.ts` 中无 DOM/Node 依赖的 UTF-8 编码函数，保持 2 MiB 校验语义及原有单测不变。**此修复提交后的 `vp check` 与完整 `pnpm run ready` 仍待维护者 Windows 实测，不得宣称通过。**

## 2026-11-12 · V0.3 第九批：工程级权限策略与 PostgreSQL 存储模型（待验收）

第八批 PR #30 已在维护者 Windows 通过完整 `pnpm run ready`：312/312 单测、4/4 NestJS E2E、185 个文件格式检查、76 个文件零警告和类型错误、55 个 Markdown 检查以及 React/Vue/NestJS 构建，最终退出码 0。维护者授权后 PR #30 Squash Merge 至 `main`（`f1b67ea`）。

第九批基于该 `main` 提出 ADR-0041：候选 PostgreSQL 工程/授权/版本/审计四表复合键、同一事务内 CAS 与成功审计、ACL 撤销和提交的锁顺序；并在 NestJS 目录添加默认拒绝的纯权限判断及 11 项单元测试，保证不从客户端推导身份或特权。**当前没有 PostgreSQL 数据库连接、实际迁移、可调用的 Guard、正式工程 API、项目发布或工业设备写入**。预计单测总数 323，实际 `pnpm run ready` 尚未运行，不能宣称验收通过。

## 2026-11-12 · V0.3 第十批：采用 PostgreSQL + Prisma 7（待环境验证）

第九批 PR #31 已由维护者 Windows 实测 `pnpm run ready` 退出码 0、323/323 单测、4/4 NestJS E2E、188 个文件格式正确、78 个文件零警告、56 份 Markdown 检查和 React/Vue/NestJS 构建成功，随后授权 Squash Merge 到 `main`（`bf2bef3`）。维护者此后在 `main` 新增多组 Prisma/PostgreSQL/NestJS 等仓库 Skills；第十批重新读取相关技能并明确选用稳定的 Prisma ORM 7.10.1，避免当前 Prisma 8 RC 的不兼容。

第十批新增 NestJS 专用 Prisma Schema、初始迁移、根 `.env` 的可选数据库配置与本机 PostgreSQL Compose，以及根/服务端 CLI 命令。**本轮提交尚未在维护者 Windows 安装新依赖，`pnpm-lock.yaml` 需由 `pnpm install` 更新并提交；Prisma 校验、生成、SQL 迁移、真实事务和完整 `ready` 尚未执行。** 服务端没有接入 PrismaService 或新工程 API，工业设备写入与生产发布均保持关闭。

## 2026-11-12 · V0.3 第十批：Prisma Client 生成后文案检查故障及修复（待复验）

维护者已在第十批 PR #32 分支提交更新的 `pnpm-lock.yaml`（提交 `21cf6e0`），并执行 `pnpm run db:generate` 后的完整 `pnpm run ready`。依赖目录（41 项 Catalog）、共享配置和环境检查通过；`messages:check` 因第三方生成代码及 `.env.example` 配置示例共报告 1,379 处英文注释，退出码非零。经核对脚本此前递归扫描 `apps/server/src/generated/prisma/`，未按 AGENTS.md 排除 Prisma 生成产物。本批修复增加精确路径排除，并对 Vite+ Format/Lint 同步忽略；仍保留自有中文文案约束。**本次修复之后的完整质量链、Prisma Schema 校验与真实 PostgreSQL 迁移尚待维护者重新验证。**

## 2026-11-12 · V0.3 第十批：根目录 PostgreSQL + Prisma 默认环境（待验收）

按维护者要求，在 `.env.example` 中给出实际生效的本机 PostgreSQL 主机、端口、库名和用户名默认值；数据库密码及 Prisma 完整 URL 已按维护者最新要求提供可直接配套使用的**公开本地开发测试默认值**，正式部署必须更换，禁止将公开测试凭据用于生产。同步更新 `scripts/check-env-config.mjs` 默认项及类型化校验、`compose.postgres.dev.yaml` 数据库名插值和服务端 README/Harness。Prisma CLI 仍只读取完整 `SCADA_DATABASE_URL`，不会拼接其他数据库变量。**该配置修改后的 `pnpm run env:check`、`pnpm run ready` 和实际 PostgreSQL 迁移仍需维护者 Windows 验证。**

## 2026-11-12 · V0.3 第十批：开发数据库 Compose 环境文件与端口修复（待 Windows 复验）

维护者截图显示，在仓库根目录复制了 `.env.example` 为 `.env` 后，`pnpm run db:dev:up` 仍报告 `SCADA_DB_USER` 和 `SCADA_DB_PASSWORD` 缺失。根因是 Docker Compose 命令只指定 `deploy/docker/compose.postgres.dev.yaml`，未明确指定仓库根环境文件；另外维护者将 PostgreSQL 端口更改为 15432，但 Prisma URL 仍指向 5432，根环境检查脚本仍使用其他应用旧端口值。现已修改脚本使用 `--env-file .env`，同步 `.env.example`、端口默认契约和 URL 一致性校验，保留维护者自定义的 15xxx 端口。根目录 `.env` 需维护者手动同步 Prisma 连接 URL 的端口。**新的 `pnpm run env:check`、`db:dev:up`、`pnpm run ready` 与数据库迁移尚未在维护者 Windows 实测。**

## 2026-11-12 · V0.3 第十一批：PrismaService 与事务版本仓储（待验收）

第十批 PR #32 经维护者 Windows 实测 PostgreSQL 17 容器启动、首次迁移 `20261112000000_init_scada_projects` 成功、迁移状态最新，以及完整 `pnpm run ready` 退出码 0（323/323 单测、4/4 NestJS E2E、192 个文件格式正确、79 个文件零警告、57 份文档通过、React/Vue/NestJS 构建通过）。维护者授权后 Squash Merge 至 `main`，提交 `b2c70d8`。

第十一批决定**不增加新的第三方依赖**。复用 Prisma 7 Client、PostgreSQL Adapter、NestJS 与共享 Core，实现独立 `ProjectPersistenceModule`（未挂载现有 AppModule）、单实例 PrismaService 生命周期与服务端版本事务仓储，覆盖工程行锁、ACL 复查、CAS、不可变快照、成功审计、授权读取及 SHA-256 校验。新增 14 项模拟单测和 5 项需要显式隔离测试库的真实 PostgreSQL 回归，更新生成脚本与文档。**尚未运行本批 `pnpm run ready` 或真实 `test:db`，不能声称通过**。当前仍无认证 Guard、工程/设备写入路由、正式发布指针或工业 Gateway。

## 2026-11-12 · V0.3 第十一批：Mock 泛型警告与中文数据库注释补齐（待验收）

维护者 Windows 执行 `vp check --fix`，实际报告 0 错误、7 处 `vitest(require-mock-type-parameters)` 警告；并在 Navicat 发现工程、授权、版本和审计四张业务表的中文表/字段注释为空。本次修改按仓库 Vitest、PostgreSQL 表设计、Prisma Skills 修复七处模拟函数泛型，在 `schema.prisma` 的 29 个模型属性中补全中文文档注释，并新增纯注释迁移，覆盖四表、23 个实际字段、4 个索引；不回改已经执行的初始迁移。

为防止以后新表/新列再遗漏，增加 2 项 Schema/SQL 注释静态测试和 1 项隔离 PostgreSQL 注释实测，且把强制中文注释纳入根 AGENTS.md 与项目设计/验收文档。预计普通单测 339、独立真库测试 6、NestJS E2E 4；**这些属于修改后预期，尚未经维护者 Windows 实际复验**。PR #33 仍为 Draft，不合并 `main`。

## 2026-11-12 · V0.3 第十一批：修复 NestJS NodeNext 消费 Core 源码的 TS5097（待实测）

维护者 Windows `pnpm run ready` 前置 Catalog、共享配置、环境、中文文案、Prisma Client 7.10.1 生成、`vp check`（200 格式文件、86 源文件零警告）和 Web/Draft 类型检查成功，但服务端 TypeScript 遇到 Core 源码显式 `.ts` 导入，共 23 处 `TS5097`，退出码 1。由于第十一批新增了服务端对 Core 的 workspace 依赖，原本针对浏览器源码的包导出成为 NestJS `NodeNext` 直接编译的边界问题。

本批保留 Core 所有 `.ts` 源文件与 Vue/React 默认出口，使用 TypeScript 6 编译出 Node 专用 `.js` 和 `.d.ts` 条件产物，构建命令自动衔接根 `ready`、NestJS build/typecheck、安装 prepare，Docker 运行层复制 Core dist。未新增第三方依赖、未修改 Prisma 数据库和业务 API。**最新完整 Windows `pnpm run ready`、Docker 构建及真库事务测试尚待重新执行**。

## 2026-11-12 · V0.3 第十二批：持久化事务安全回归与 Docker 容器烟测（待验收）

前十一批已通过维护者 Windows 完整质量链（339 单元测试、4 NestJS E2E，退出码 0）、本机 PostgreSQL 隔离库 6/6 真库测试及两个迁移，随后 PR #33 获明确授权经 Squash Merge 合入 `main`，提交 `b1396c3`。第十二批继续在主分支基础上开发**安全验证**而非对外发布功能。

本批不新增第三方依赖、不修改业务表/字段或 Prisma 迁移、不挂载 ProjectPersistenceModule。新增 1 项普通配置单测、3 项隔离 PostgreSQL 测试（审计 CHECK 失败真实回滚、授权锁竞争、连接拒绝），并提供 `test:docker:server` 独立 Docker 镜像健康和 404 边界验证。预期普通单测 340、真库测试 9、E2E 4。**本批尚未实测 Windows ready、真库回归及 Docker 构建；不能声称通过。**

## 2026-11-12 · V0.3 第十三批：可信会话与工程级 Guard 基础（待验收）

第十二批 PR #34 经维护者 Windows 实测 `pnpm run ready` 退出码 0（340 单测、4 NestJS E2E）、独立 PostgreSQL 9/9 和 Docker 隔离烟测成功，并经明确授权 Squash Merge 到 `main`，提交 `f1045ab`。第十三批选定**数据库支持即时撤销的短期不透明会话 + 两层受控工程 Guard**，优先使用已安装 NestJS/Prisma 与 Node `crypto`；暂不引入未安装的密码/JWT/日志/Swagger 包，整理阶段化 [依赖推荐清单](DEPENDENCY_SELECTION.md)。NestJS 新发布的 `@nestjs/authentication` / `@nestjs/authorization` 仍为 0.1.x，需经过成熟度与适配评审后再考虑。

本批新增可信身份/会话两业务模型及含完整中文元数据的独立迁移，提供不透明会话的 15 分钟有效期、SHA-256 摘要、主体状态与撤销验证；新增 Session Guard、工程 ACL Guard 和组合装饰器，单独模块**未挂入 AppModule**，不注册任何登录或工程业务 HTTP API。新增 10 项常规单测、2 项隔离 PostgreSQL 会话测试及未开放认证接口的 E2E 安全检查；预计普通单测 350、E2E 5、真库 11。**本批未实际运行完整质量链、Docker 或 PostgreSQL 新迁移，不能宣称通过，也未进入认证生产阶段。**

## 2026-11-13 · V0.3 第十四批：Pino、Swagger 与 HTTP 安全基线（Windows 质量链通过，Draft 待合并）

第十三批 PR #35 已获维护者明确授权，通过 Squash Merge 合并至 `main`，提交 `0e1849e`。维护者 Windows 实测该批完整 `ready` 退出码 0（350 单元测试、5 NestJS E2E）、隔离 PostgreSQL 11/11、Docker 安全烟测通过。当前第十四批按已决定的技术路径建设 `nestjs-pino` / Pino 10 结构化日志、受控 `@nestjs/swagger` 12 文档与 Helmet 安全响应头。

实现包含服务端随机请求 ID、URL 查询/头/体白名单日志脱敏，Swagger 文档仅允许显式本机非生产模式访问，默认不注册路由；健康响应和未开放的认证/工程/工业设备写入接口保持不变。另引入 `@nestjs/config` 与仅开发使用的 `pino-pretty`，并修复其在 Vitest 中创建日志工作线程的风险。现在共有六项日志/文档纯单测及三项新增 E2E，Windows 实测普通单测 356/356、E2E 8/8；本批未重测旧 PostgreSQL 真库 11 项。没有修改 PostgreSQL 表、迁移或 Prisma Client，也没有激活登录/工业设备控制。

**验收记录**：维护者已使用 pnpm 12.18.0 更新并推送锁文件；2026-11-13 Windows 单独 `pnpm run test:e2e:server` 8/8、退出码 0，完整 `pnpm run ready` 退出码 0：356/356 单测、8/8 E2E、219 个文件格式检查、100 个受检文件零错误/警告、62 份 Markdown 检查及 React/Vue/NestJS 构建通过。此前 `beforeAll` 10 秒超时在排除测试环境 Pretty Worker 后未复现。Docker 隔离镜像构建与烟测也已在该批前一次实测通过、退出码 0。当前 PR #36 仍为 Draft、未合并，真库 11 项回归及生产级安全审计不属于此次 `ready` 的验证结果。

## 2026-11-13 · V0.3 第十五批：NestJS 启动配置时序修复（Windows 验收通过，Draft 待合并）

第十四批 PR #36 已获维护者授权，以 Squash Merge 合入 `main`（`28f20c7`）。Windows 已实测单测 356/356、NestJS E2E 8/8、完整 `ready` 退出码 0，上一轮 Docker 隔离烟测也通过。本批以最新 main 为基线，在独立分支 `feat/v0.3-server-startup-config` 修复服务端先静态初始化 AppModule/Pino 后从根 `.env` 加载 `SCADA_LOG_LEVEL` 的时序风险。

实现改为根环境变量加载完成后才动态导入正式 AppModule，并抽取纯函数统一解析端口、监听主机和受控文档条件；根 `.env` 唯一加载入口、配置优先级、Swagger 生产关闭、日志凭据脱敏均不改变。新增 5 项启动配置测试，`scripts/check-env-config.mjs` 增加顺序回归约束。维护者 Windows 已实测常规单测 **361/361**、NestJS E2E **8/8**，`vp check` 222 个文件格式正确、102 个受检文件零告警，63 份 Markdown 检查通过，React/Vue/NestJS 构建通过，完整 `ready` 退出码 **0**。独立 Docker 隔离镜像构建及烟测也通过，退出码 **0**；本批未执行 PostgreSQL 真库回归。未新增依赖、未修改 pnpm 锁文件、Prisma 模型、正式认证或设备写入接口。配套 [ADR-0047](adr/0047-server-configuration-startup.md)；PR #37 仍保持 Draft，记录性文档更新后需最终格式复检，未经明确授权不合并。

## 2026-11-13 · V0.3 第十六批：Guard 安全事件白名单（Windows 质量链与 Docker 已通过，Draft 待合并）

第十五批 PR #37 获维护者明确授权后通过 Squash Merge 合入 `main`（`c1e8096`）。Windows 实测 `ready` 361/361 单测、8/8 NestJS E2E，退出码 0；Docker 隔离镜像构建与安全烟测亦通过。

本批基于该 `main` 创建 `feat/v0.3-security-audit-boundary`，为现有 `ScadaSessionGuard` 和 `ScadaProjectGuard` 增加可注入的安全事件记录服务。只写固定事件、允许/拒绝结果和原因码，不传 Header、Bearer、查询参数、工程路径、租户/主体标识或错误对象；允许/拒绝仍沿用现有 Guard 逻辑及 HTTP 异常语义。新增 4 项独立白名单单测和 2 项 Guard 审计单测，Windows 实测常规单测 **367/367**、NestJS E2E **8/8**，完整 `ready` **退出码 0**。模块未挂入正式 AppModule，当前事件不是可追溯的数据库持久化审计，也未开放任何认证、工程版本或工业写入接口。

本批未改 PostgreSQL/Prisma 模型和迁移、Vue/React、共享 Core、pnpm Catalog 及锁文件。维护者已在 Windows 实测 `vp check` 225 个格式文件全部通过、104 个受检文件无警告或错误，64 份 Markdown 检查、Vue/React/NestJS 构建及独立 Docker 隔离烟测均通过（退出码 0）。本批未执行隔离 PostgreSQL 真库测试，PR #38 保持 Draft，未经明确授权不合并。详见 [ADR-0048](adr/0048-security-audit-event-boundary.md)。

## 2026-11-13 · V0.3 第十七批：Zod 与 NestJS 原生 Standard Schema（Windows / Docker 验收通过，Draft 待合并）

第十六批 PR #38 已经 Squash Merge 至 `main`（`099fe8e`），基线 Windows `ready` 367/367 单测、8/8 E2E、退出码 0，Docker 隔离烟测通过。

本批从主线创建 `feat/v0.3-zod-runtime-config`，采用 `zod@4.6.7` 校验 NestJS 启动端口与监听地址；原有中文异常、配置优先级及 Swagger 三重限制保持不变。新增 4 项无数据库启动配置测试，以及 4 项 NestJS 请求/响应/Swagger 集成测试；不改共享 Core Schema、Vue/React、Prisma 或正式业务路由。

维护者 Windows 首次执行 `ready`：Catalog 51 项、格式文件 227/227、105 个受检文件零错误/警告，类型检查通过；普通单测 **370 通过、1 失败**，另一测试文件在模块导入时出错，整条链路在单测阶段中断，**并未完成 E2E、文档检查和构建**。根因一：使用 `??` 导致测试传入的非法 `null` 被识别为“未配置”；已调整为仅 `undefined` 才回退。根因二：`nest-zod@2.1.0` 的 `ZSerialize` OpenAPI 处理存在 `safeParse` 描述符恢复问题，且其实际 Peer 声明不包含 NestJS 12 / Swagger 12；已撤销第三方适配器并采用 NestJS 12 原生 Standard Schema Pipe、序列化与 OpenAPI 集成。

当前 Catalog/Manifest 仅保留 `zod`，测试文件改为 `standard-schema-integration.spec.ts`。维护者已使用 pnpm 重新计算并推送锁文件（GitHub 核对不再包含 `nest-zod`）。修复后 Windows 完整 `ready` **退出码 0**：格式 227/227、105 个受检代码文件零告警/错误、**375/375 单测**、**8/8 E2E**、65 份 Markdown 文档检查以及 React/Vue/NestJS 类型检查与构建通过。独立 Docker 镜像构建、冻结安装和隔离烟测也已通过，**退出码 0**；容器健康接口正常，工程与设备写入接口未开放。本批未运行 PostgreSQL 真库回归或工业现场测试。配套 ADR-0049 已同步修订。PR #39 仍保持 Draft，未经明确授权不合并。

## 2026-11-13 · V0.3 第十八批：Terminus HTTP 就绪探针（Windows / Docker 验收通过，Draft 待合并）

第十七批 PR #39 已获维护者明确授权，以 Squash Merge 合入 `main`（`8bba4de`）。维护者 Windows 已实测 `ready` 单测 375/375、E2E 8/8、退出码 0，Docker 冻结依赖安装、隔离镜像烟测退出码 0。本批基于该主线建立 `feat/v0.3-http-readiness-terminus`。

经核对已发布 `@nestjs/terminus@12.1.0` 发行包的 Peer 声明，支持仓库 NestJS 12 / Swagger 12 / Node 24。由于正式业务 HTTP 入口仅有健康接口，登录、工程版本和工业设备写入尚未开放，因此暂不引入 `@nestjs/throttler`，避免对容器健康探针造成全局限流误伤。本批只通过 Terminus 增加独立 `GET /health/ready`：HTTP 应用初始化后返回就绪，关闭时 503，禁止缓存，固定返回 `dependencies:"not_checked"`。保留 `GET /health` 进程存活契约及未开放业务 API 的 404。

新增 3 项就绪指示器单测和 2 项 NestJS E2E，Docker 隔离烟测新增 HTTP 就绪验证。维护者已在 Windows 用 pnpm 正式生成并推送锁文件；GitHub 确认包含 Terminus 12.1.0。**完整 `ready` 退出码 0**：30 个测试文件 **378/378 单测**、NestJS E2E **10/10**、231 个文件格式正确/108 个受检源文件零告警、66 份 Markdown 检查及 Vue/React/NestJS 构建通过。Docker `pnpm install --frozen-lockfile`、服务端镜像构建与隔离烟测均通过，**退出码 0**，HTTP 存活与就绪探针均正常，未开放工程/登录/设备接口仍为 404。E2E 中 503 / Terminus 失败日志属于预期关闭状态负面测试。无数据库/Prisma 迁移或 Redis/工业设备实测，不代表真实业务就绪或生产认证。详见 [ADR-0050](adr/0050-http-readiness-terminus.md)。PR 保持 Draft，未经授权不合并；记录性文档更新后建议复查格式与文档检查。

## 2026-11-13 · V0.3 第十九批：HTTP 连接资源保护与关闭拒绝（Windows / Docker 验收通过，Draft 待合并）

第十八批 PR #40 已经维护者明确授权，经 Squash Merge 合入 `main`（`c67261e`）。Windows `ready` **378/378 单元测试、10/10 E2E、退出码 0**，Docker 冻结安装与隔离镜像烟测退出码 0。当前第十九批从该提交建立 `feat/v0.3-http-ingress-shutdown-guard`，继续补充服务端可靠性基础，不提前开放登录、工程版本或工业设备写入接口。

核对 NestJS 12.0.3 官方 Express Adapter 源码确认 `return503OnClosing:true` 为已有功能，关闭一开始即可拒绝新请求，且不会主动销毁现有处理中请求。Node 24 原生 HTTP Server 提供请求接收/连接资源边界，无需额外依赖。正式 `main.ts` 继续先加载根 `.env` 后再导入 `AppModule`，仅调整已有 `NestFactory.create` 选项并在 `listen` 前配置 HTTP Server：请求头 15 秒、完整请求 60 秒、Keep-Alive 空闲 5 秒、请求头最多 100 个、单连接最多 1000 次请求。没有设置通用响应超时，以保留未来 SSE 长连接能力。

新增 3 项纯单测和 2 项真实 Node HTTP E2E（包含关闭钩子屏障和拒绝新连接 503）；Docker 隔离烟测复用正式 HTTP 限制配置。维护者 Windows 完整 `ready` **退出码 0**：31 个测试文件 **381/381 单测**、2 个 E2E 文件 **12/12 E2E**、`vp check` 235 个文件格式正确及 111 个文件零警告/错误、67 份 Markdown 检查、Vue/React/NestJS 类型检查及构建全部通过。Docker `pnpm install --frozen-lockfile`、服务端镜像构建和隔离烟测均通过，**退出码 0**；健康/就绪探针 200，未开放工程/设备接口 404。E2E 期间预期关闭状态 503 和 Terminus 错误日志不是非预期故障。本批无新依赖、Catalog/锁文件不变，不修改 Prisma、Vue/React、Core、工业网关或正式 API。真实 Linux SIGTERM、PostgreSQL 真库与工业现场仍未在本批验证。详见 [ADR-0051](adr/0051-http-ingress-shutdown-policy.md)。PR 保持 Draft，未经授权不合并；本次仅追加文档，建议复查 `vp check` 与 `pnpm run docs:check`。

## 2026-11-13 · V0.3 第二十批：Linux 容器实际 SIGTERM 关闭验证（Draft 待 Windows/Docker 验收）

第十九批 PR #41 已根据维护者明确授权通过 Squash Merge 合入 `main`（`711ef6c`），Windows 381/381 单测、12/12 NestJS E2E、完整 `ready` 退出码 0，Docker 冻结安装和隔离烟测退出码 0。本批在 `test/v0.3-linux-sigterm-container` 独立验证 Linux 正式 Node 进程作为容器 PID 1 收到 `SIGTERM` 后完成 NestJS 关闭钩子和正常退出。

实查 NestJS 12.0.3 源码：原 `enableShutdownHooks()` 会在清理后重发 SIGTERM，可能以 143 退出；正式入口改用上游原生 `enableShutdownHooks([], { useProcessExit: true })`，在全部关闭钩子执行完成后退出 0。Docker 同一隔离镜像新增第二阶段：`--network none` 启动正式 `CMD`，容器内部用回环探针等待就绪并确认工业设备写入仍为 404，再通过 Docker 发送真实 SIGTERM，等待并检查退出码严格为 0；最后无论成功失败清理容器。原有第一阶段烟测保留。

本批**无新 npm 依赖、Catalog、pnpm 锁文件、Prisma、Core、Vue/React 或业务 HTTP 路由变更**；维护者已在 Windows 实测 **381/381 单测、12/12 E2E**、完整 `ready` **退出码 0**，并通过 Docker 冻结安装、隔离烟测及正式 Linux Node PID 1 SIGTERM / 退出码 0 验证，Docker 退出码 0。此后追加仅在显式允许本机 Swagger 时打印实际文档地址的 Pino 启动日志，复用注册路由常量并增加 2 项单测；预计最新分支 **383 项单测、12 项 E2E**，新增改动仍待 Windows/Docker 复验。实际在途请求排空、SSE/WS、代理摘流与工业现场仍属于后续专项，见 [ADR-0052](adr/0052-linux-sigterm-container-shutdown.md)。

按维护者 2026-11-10 已确认的规则，所有由 AI 创建的 GitHub PR（包含 Draft）创建后立即指派 `@adui-dev` 并核验。此前漏掉的 PR #39、#40、#41 已补充指派，本批 PR 也必须在创建后验证；未经授权不合并。

## 2026-11-13 · V0.3 第二十一批：本机只读模拟工程与 Tag SSE（Windows / Docker 验收通过，Draft 待合并）

前第二十批 PR #42 已在维护者授权下通过 Squash Merge 合并至 `main`（`7e78de4`）。维护者曾实测 Swagger 日志增量前的 381/381 单测、12/12 E2E、完整 `ready` 与 Docker Linux SIGTERM 双阶段退出码 0；之后 2 项 Swagger URL 单测及终端编码说明仍缺最新合并提交的完整 Windows 验收，不能把 381 项当成 383 项已通过。

第二十一批选择为更贴近 FR-004、FR-009 的**本机诊断型模拟数据接入**，而非继续增加无关服务端依赖。正式 `AppModule` 仍只挂载健康与就绪接口；另有 `LocalDemoAppModule` 只在 `SCADA_LOCAL_DEMO_API_ENABLED=true`、非生产、实际监听 `127.0.0.1` 时由 `main.ts` 显式选择。新增 `GET /api/dev/demo/project`、`GET /api/dev/demo/tags`、`GET /api/dev/demo/events`，复用 Core 水处理工程、TagStore、WaterTreatmentSimulator 和 snapshot/delta 质量协议；所有数据均为本机模拟，模拟中断产生 STALE，恢复后新序列号递增。

新增访问策略 2 项单测、模拟服务 4 项单测、正式根模块默认 404 的 1 项 E2E，以及本机演示模块的 4 项 E2E（含 Swagger JSON、SSE 快照、断流清理），维护者 Windows 已实测 **389/389 单测（33 个文件）、17/17 E2E（3 个文件）**，完整 `ready` **退出码 0**，`vp check` **245 个格式文件通过、119 个受检文件零警告/错误**，69 个 Markdown 检查及 Web/Server 类型检查与构建成功。Docker 镜像冻结安装、原隔离烟测和正式 Linux SIGTERM / 退出码 0 回归通过，**Docker 退出码 0**；E2E 的 503 / Terminus 错误日志为预期关闭状态负面测试。无新依赖、锁文件、Prisma、Core、Vue/React 或工业接口修改。旧 `/demo` SSE 服务、双框架 Runtime 和 Docker 生产默认行为不变；这不是正式工业网关、真实认证、工程版本 API 或生产 Tag 流。本批未执行 PostgreSQL 真库回归、工业现场验证或手工 Swagger/SSE 浏览器交互验收；仅追加验收文档后建议复查格式和文档检查。PR #43 仍保持 Draft，未经明确授权不合并。参见 [ADR-0053](adr/0053-local-readonly-demo-telemetry.md)。

## 2026-11-13 · V0.3 第二十二批：共享 Runtime 只读 Tag 数据源抽象（Windows / Docker 已通过，Draft 待合并）

第二十一批 PR #43 已依据维护者明确授权 Squash Merge 至 `main`（`9d592c4`）。其 Windows 基线为 **389/389 单测、17/17 E2E**，完整 `pnpm run ready` 与 Docker 冻结安装/隔离烟测/Linux SIGTERM 退出码均为 0；尚无手动浏览器 Swagger/SSE 交互记录，不能当作正式生产订阅验证。

本批按照 [ADR-0054](adr/0054-readonly-tag-source-adapters.md) 将 `packages/runtime/src/runtime.ts` 内部的 `fetch("/demo/project")` 与 `EventSource("/demo/events")` 抽出为可注入 `ReadonlyTagSource`。同源固定预设 `standalone` 保持两套 Web 当前 `/demo` 行为不变，`nest-local` 仅指向上批已实现的受控 `/api/dev/demo` 路由；不新增任意 URL、自定义设备地址或浏览器代理。React/Vue 原有 Runtime 构造函数继续兼容；Tauri 离线模拟未修改。

新契约为 `loadProject(AbortSignal)`、`subscribe({onMessage,onDisconnected})`、`close()`，原始消息仍由共享 Core `applyDemoChange`、`TagStore` 校验；首次订阅或每次断线后必须接收 snapshot，才允许 delta。重新启动按代次隔离，stop 中止挂起请求、清理订阅并将旧值标记 STALE，防止迟到回调覆盖新会话。新增 4 项固定 SSE 适配器测试、7 项 Runtime 生命周期及安全回归。维护者于 2026-11-13 Windows 实测：**Runtime 专项 21/21（3 文件）**、**全量单测 400/400（35 文件）**、**NestJS E2E 17/17（3 文件）**，`vp check` **249 个文件格式正确、122 个文件零错误和零警告**；Prisma Client 7.10.1 生成、70 个 Markdown 检查、Core/双 Web/NestJS 类型检查及构建均通过，完整 `ready` **退出码 0**。Docker 镜像冻结安装、隔离烟测、正式 Linux PID 1 SIGTERM 进程正常退出 **退出码 0**，Docker 命令 **退出码 0**。E2E 中的 Terminus 503 是主动模拟关闭的预期负面用例。无依赖、数据库、NestJS、Vue/React 页面或工业 Gateway 变更；本批不算真实工业订阅实现，尚无手工页面断连演练、PostgreSQL 真库及工业现场测试。PR #44 保持 Draft，未经明确合并授权不合并；本次仅更新验收记录，建议复查格式与文档检查。

## 2026-11-13 · V0.3 第二十三批：模拟 SSE 心跳与 Tag 数据静默监测（Windows / Docker 验收通过，Draft 待合并）

第二十二批 PR #44 已经维护者明确授权 Squash Merge 合入 `main`（`23d29fa`）。维护者 Windows 实测基线 **400/400 单测、17/17 NestJS E2E**，完整 `ready` 与 Docker 独立镜像/HTTP 隔离烟测/Linux SIGTERM 退出码均为 0。上批新增的可注入 `ReadonlyTagSource`、固定同源 SSE 预设和 snapshot 优先策略已合并；人工浏览器断线演练与工业现场尚未验证。

本批依照 [ADR-0055](adr/0055-sse-heartbeat-and-tag-silence.md)，在原水处理 SSE 与本机受控 NestJS SSE 中每 5 秒发送一次**具名 heartbeat 事件**，不混入共享 `TagChange`；浏览器源适配器将任何 SSE 活动视为传输存活，连续 15 秒完全静默才关闭旧 EventSource 并以原固定同源 URL 重建；共享 Runtime 另以 12 秒无有效 Tag 值检测数据过期，降级旧读数为 STALE，增加中文 `stale` 状态，不允许心跳或空增量伪造正常更新。既有 30 秒模拟周期中的 8 秒停采样与质量演练保留，断连后仍要求先 snapshot 再 delta。

新增 5 项适配器心跳/重连单测、3 项 Runtime 数据质量单测及 1 项 NestJS SSE 控制器单测。维护者 2026-11-13 Windows 实测 **Runtime 专项 29/29、Server 专项 79/79、全量单测 409/409（36 个文件）、NestJS E2E 17/17（3 个文件）**；`vp check` **251 个文件格式正确、123 个受检文件零警告/错误**，Prisma Client 7.10.1 生成、71 份 Markdown 文档检查、Core/双框架/NestJS 类型检查及构建均成功，完整 `ready` **退出码 0**。Docker 镜像冻结安装、隔离 HTTP 烟测、正式 Linux PID 1 SIGTERM 退出码 0，**Docker 命令退出码 0**。E2E 的 HTTP 503 / Terminus 错误为预期关闭负面测试。无新依赖、锁文件、Prisma、Core Schema、Vue/React 页面、工业 Gateway 或生产 API 修改。Tauri 离线运行时和浏览器默认 `/demo` 保持不变；5/12/15 秒阈值仅为本机模拟参数。尚无人工浏览器断流演练、SSE 并发压测、PostgreSQL 真库和工业现场验证。本次仅追加验收文档后建议复查格式和文档检查。PR #45 保持 Draft，未经明确授权不得合并。

## 2026-11-13 · V0.3 第二十四批：浏览器 SSE 回归与前台恢复时效

基于已合并第二十三批的 `main`（`e9c2516`），在分支 `feat/v0.3-sse-browser-recovery` 开展本批工作。新增真实 Chrome/Edge 的 React/Vue SSE 浏览器回归脚本，模拟“具名心跳继续但 Tag 停更”和“整个 SSE 事件回调静默”两种独立故障，检查断流自动重建与退出页面后的资源释放。共享 Runtime 在后台标签页恢复前台时立即复查 15 秒传输静默与 12 秒 Tag 数据时效，并注销可见性监听，不修改双框架页面及真实工业接口。

当前仅实现源码与测试方案。新增浏览器脚本已在协作容器做 Node 语法检查，**Windows Vite+ 全链、真实 Chrome/Edge 浏览器执行、代理半开及多客户端负载仍待维护者实测**。具体设计见 [ADR-0056](adr/0056-sse-browser-visibility-recovery.md)，验收项见 [VALIDATION](VALIDATION.md)。本批 Draft PR 未获验收授权前不合并。

## 2026-11-13 · V0.3 第二十四批首轮 Windows 验收阻塞及修复

维护者提供首轮实际日志：`pnpm run test:sse:browser` 因 `fetch failed` 退出码 1（尚无三项服务的运行日志，原因未确认）；`pnpm run test:runtime` 结果为 **30/31**，新版前台唤醒用例在本地 `STALE` 后收到 `sequence=2` 不能恢复。复核发现将本地显示过期写回共享 TagStore 会占用远端序列号，存在真实新值被错拒风险。已在本批分支改为按 Tag 的 Runtime 展示层过期覆盖，不修改共享序列校验，补充旧序列仍被拒绝、下一条真实新序列恢复及多 Tag 独立恢复的回归。浏览器脚本同时读取根 `.env` 开发端口并补充可定位失败 URL 的前置检查。**修复后 Windows 专项和完整质量链尚未重新实测**；Draft PR #46 仍不合并。

## 2026-11-13 · V0.3 第二十四批：第二轮 Windows 自动化验收通过

维护者继第一轮失败后同步最新分支并重新执行了本机质量链，现已提供日志证明：**React / Vue SSE 浏览器回归均通过（`test:sse:browser` 退出码 0）、Runtime 专项 32/32（3 文件）、全量单测 412/412（36 文件）、NestJS E2E 17/17（3 文件）**；`vp check` 检查 253 个文件格式正确、124 个受检文件零错误零警告；72 份 Markdown 检查通过。完整 `pnpm run ready` 退出码 **0**，包含 Catalog/配置/中文文案、Prisma Client 7.10.1、双 Web 与 NestJS 类型检查和构建。此前 `fetch failed` 源于浏览器预检查服务/端口未与实际运行环境对齐，现脚本读取根 `.env` 并能确认两端本机地址；此前 STALE 与 sequence 冲突已通过 Runtime 展示层过期质量覆盖修复。

这证明本机浏览器接收/重连生命周期自动化成功，不等于真实网络丢包、Nginx 半开或工业现场可靠性已确认；本批未执行 Docker 增量回归、人工后台标签页节流、SSE 高并发、生产身份权限或 PostgreSQL 真库验证。**PR #46 仍保持 Draft、Assignee 为 `@adui-dev`，等待维护者明确合并授权**。上述实测发生在本次验收文档追加之前，文档最新提交需按需复查 `vp check` 和 `pnpm run docs:check`。

## 2026-11-13 · V0.3 第二十五批：本机 SSE 多客户端与背压保护（待验收）

以 PR #46 已合并的 `main` 提交 `a2b3685` 为基线，新建 `feat/v0.3-sse-backpressure-proxy-check`，针对独立 Node 水处理 SSE 模拟服务原先无连接数上限、无写缓冲背压处理的问题，增加 32 路上限、每路 64 KiB 待发送字节保护、慢客户端快速断开、响应关闭自动回收；新增六路并发真实 HTTP SSE 及 Docker Nginx 双框架代理独立烟测入口。共享 Core、Runtime、Vue/React 页面、NestJS、Tauri、工程 Schema、数据库与设备写入边界均未改变；不增加 npm 依赖。

已在协作容器以 Node 内置测试器对隔离副本执行连接管理 8 项检查，8/8 通过，其中包含真实回环 HTTP 32 路连接、超额 HTTP 503 和释放后重入；源文件静态语法检查亦完成。本批尚未完成维护者 Windows `pnpm run ready`、独立模拟服务实际端到端、Docker Nginx 双代理烟测、真实半开代理、后台页计时器及高并发现场性能验证。应按 [VALIDATION](VALIDATION.md) 和 [ADR-0057](adr/0057-local-sse-capacity-and-proxy-validation.md) 实测，Draft PR 未获授权前保持不合并。

## 2026-11-13 · 第二十五批首轮 Windows Lint 警告修复

维护者提供本批 `vp check --fix` 日志，发现 **9 条警告、0 个错误**：其中 8 条来自新 Node 原生测试未处理顶层 Promise，1 条来自 SSE 网络测试中的异步读取任务类型推断。仅对新增测试文件做最小必要修正：八项顶层 `await test(...)` 保持完整断言，网络客户端以 `Promise.resolve()` 声明可等待读取任务。没有修改 SSE 服务端容量、写缓冲、Tag 协议、Core 或双框架页面。最新修复完成静态语法检查，实际 Windows 质量链仍待重新执行；PR #47 继续 Draft、不合并。

### 第二十五批 Windows Docker Nginx 代理端口漂移（2026-11-13）

维护者实际执行了 `pnpm run test:sse:clients`：Node 资源测试 **8/8 通过**；`pnpm run test:sse:network`：本机 `127.0.0.1:14178/events` 六路快照、具名心跳、单路断开隔离及重订阅通过，**退出码 0**。`pnpm run docker:demo:up` 已完成四个镜像构建，Demo 和 NestJS 容器为 Healthy，React/Vue 容器已启动。

但 `pnpm run test:sse:proxy` 在首个 React 代理入口 `127.0.0.1:18080/demo/events` 返回 **ECONNREFUSED，退出码 1**，没有运行到 Vue 代理。Docker Desktop 显示实际宿主机发布端口为 React `8080`、Vue `8081`；维护者根目录 `.env` 则配置 `18080`、`18081`。检查发现 Docker 演示脚本的 Compose 命令缺少显式 `--env-file .env`，且 `scripts/check-env-config.mjs` 与 Compose 内端口回退值同根模板存在漂移。

本批补丁仅修复 Docker 配置读取：演示栈 `up/down/logs` 与新增 `ps` 命令统一显式加载仓库根 `.env`；Compose 四组端口回退值同步为根 `.env.example` 默认值；`env:check` 强制验证脚本及四组默认值，防止再次静默降级到旧端口。**没有修改 SSE 服务、NestJS 或 Vue/React 业务代码，也未执行 Docker 或重启维护者计算机上的容器。**

维护者同步分支后，建议在仓库根目录执行 `pnpm run env:check`、`pnpm run docker:demo:up`、`pnpm run docker:demo:ps` 和 `pnpm run test:sse:proxy`；`docker:demo:ps` 的宿主机端口应分别显示 `127.0.0.1:18080->8080/tcp` 和 `127.0.0.1:18081->8080/tcp`。如仍不一致，需检查 PowerShell 是否存在 `SCADA_REACT_PORT`/`SCADA_VUE_PORT` 同名进程环境变量覆盖；切勿粘贴完整 `docker compose config --environment`，其中可能包含凭据。修复后的 Windows Docker Nginx 代理烟测、`vp check`、`docs:check` 和完整 `ready` 尚未实测。

## 2026-11-13 · 第二十五批 Docker Nginx 代理复验通过

继旧 Compose 命令遗漏根 `.env` 造成端口漂移后，维护者已重新运行 `pnpm run env:check`、`pnpm run docker:demo:up`、`pnpm run docker:demo:ps` 和 `pnpm run test:sse:proxy`：环境/LF 检查通过，四镜像构建并启动，Demo/Server Healthy；Docker 真实宿主机映射为 React `18080->8080`、Vue `18081->8080`，两条 Nginx SSE 代理均通过六路 snapshot、具名 heartbeat、单路断开隔离和重订阅，**代理测试退出码 0**。结合上一份日志，独立 SSE 客户端单测 **8/8**、直连网络六路回归 **退出码 0**。

本批 Windows Docker 代理验收确认已完成，但 **最新 `vp check`、`docs:check` 和完整 `ready` 尚未提供**，真实 Nginx 半开故障、持续高并发、生产身份权限、真库和工业现场仍未验证。只追加验收记录，不修改已验收业务代码；PR #47 Draft 待最终验收与明确合并授权。

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

## 2026-11-13 · V0.3 第二十六批：TCP 下行静默与持续多客户端回归（待维护者验收）

从第二十五批已合并的 `main` 提交 `cf13808` 创建 `feat/v0.3-sse-transport-fault-soak`。本批只扩展本机 SSE 自动化：新增回环透明 TCP 代理，可让已建立的 SSE socket 保持连接、只暂停下行字节；基于现有 Chrome/Edge 检查 Vue/React Runtime 是否按 12/15 秒时效完成 STALE、主动重连、快照恢复与资源释放，并可通过 Docker Nginx 演示入口执行相同流程。另为已有 Node 六路 SSE 测试添加显式的至少 12 次心跳与增量持续观测。正常浏览器和网络烟测的默认行为不变，不增加依赖，不修改任何产品运行时或设备接口。

协作环境的 Node 22 原生 HTTP/TCP 故障代理单测 **3/3 通过**，证明工具自身可阻断真实下行字节而保留连接，其他 SSE 仍可收消息。分支源码已通过静态 JavaScript 解析。**尚未在维护者 Windows 完整 pnpm 工作区执行新脚本、真实 Chrome/Edge 双框架恢复、Docker Nginx 故障模式或六路持续测试**；`vp check`、`pnpm run docs:check` 与 `pnpm run ready` 待维护者实测。验收计划详见 [ADR-0058](adr/0058-tcp-sse-fault-and-soak-tests.md) 和 [VALIDATION](VALIDATION.md)。PR 保持 Draft，未经明确授权不合并。

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

## 2026-11-13 · V0.3 第二十七批：共享 Runtime 链路诊断（待 Windows 验收）

基于第二十六批已合并 `main`（`1ae6b29`），从 `feat/v0.3-runtime-diagnostics` 新增共享的本机运行时诊断快照，并在 Vue/React 两套运行监控页以相同字段展示：当前状态、断连过程累计次数、最后一次有效 Tag 被本机接受的时间、状态发布时的数据年龄、四档 Tag 质量分布。Tauri 离线模式复用快照但不虚构重连，且仅使用本机内存，不增加工业接口、数据库或新的依赖。诊断年龄是本机收到有效更新后的时长，不能解释为 PLC 采样或网络传输延迟。

新增 Vitest 回归覆盖断连去重、12 秒过期后显示质量、按序列恢复和重启清零等。本批代码、测试、ADR-0059 已提交开发分支；**维护者 Windows `test:runtime`、`ready`、双框架浏览器/桌面 UI 验证尚未执行**，不能继承第二十六批已通过结果。进度和验收边界见 [VALIDATION](VALIDATION.md) 与 [ADR-0059](adr/0059-runtime-local-diagnostics.md)。PR 保持 Draft，需经明确授权后才能合并。

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

## 2026-11-13 · V0.3 第二十八批：本机 Runtime 状态事件时间线（开发分支，待验收）

第二十七批 PR #49 已按维护者授权 Squash Merge，`main` 为 `ee996c0`。从该提交创建 `feat/v0.3-runtime-status-history`，仅扩展共享诊断快照：会话内最近 20 条状态变化，按连续状态去重，提供唯一序号与本机时间；React/Vue 共用字段、中文状态标签及样式，Tauri 离线模拟只记录 `simulation`。新增 Vitest 与浏览器 SSE 状态历史断言，不改变 Runtime 12/15 秒过期重连策略、TagStore、工业只读接口或 Schema。

本批新增逻辑与 ADR-0060 均提交开发分支，**Windows 的 `pnpm run test:runtime`、`vp check`、`docs:check`、`ready` 和双框架浏览器检查尚待维护者执行**，不能继承第二十七批 417/417 的成绩。工业报警/日志历史、PLC 端时间同步、生产认证、工业网关与现场设备均不在本批范围。PR 保持 Draft，明确授权后才能合并。

### 第二十八批 Windows 双框架 SSE 浏览器回归（2026-11-14）

维护者提供 PowerShell 实测日志，当前分支针对第二十八批状态时间线功能执行：

- `pnpm run test:sse:browser`：React `127.0.0.1:15173` 与 Vue `127.0.0.1:15174` 均输出“浏览器 SSE 心跳保活、Tag 过期、静默重连、资源清理通过”，**明确退出码 0**。脚本额外断言共享状态时间线初始 live、Tag 过期 stale、传输静默 reconnecting 与快照恢复 live，以及会话内事件上限。
- `pnpm run test:sse:fault:browser`：React/Vue 两端均输出“真实 TCP 下行阻断、STALE、主动重连及连接回收通过”。提供的输出到此结束，**未附 `Write-Host "TCP 故障退出码：$LASTEXITCODE"`**，因此只确认两端成功信息及脚本未输出错误，**暂不记录该命令的实际退出码**。

**仍待 Windows 实测**：`pnpm run test:runtime`、`vp check`、`pnpm run docs:check`、完整 `pnpm run ready`；以及手工 UI 和 Tauri 桌面验证。上述浏览器测试不能证明 Node/Vitest、Lint、类型、全量构建、真实工业网络、生产报警持久化已完成。

本次仅补充验收文档与 PR 说明，无业务代码变更。新增文档提交后的格式及文档静态检查仍待执行；PR #50 保持 Draft，需维护者明确授权方能合并。

## 2026-11-14 · V0.3 第二十九批：共享 Tag 定义目录与类型校验（待 Windows 验收）

第二十八批 PR #50 已合并，`main` 当前提交 `b018518`。基于此创建 `feat/v0.3-tag-definition-catalog`，开始 FR-004 的本机演示子集：Core 定义稳定 Tag ID、可变展示名称、数据类型、单位与描述；TagStore 可选注入目录并在 `apply/replaceSnapshot` 前验证非空值类型，整批失败保持原状态。水处理三项 Tag 定义由在线 Runtime、Tauri 离线模拟、独立 SSE 服务共用；Vue/React Studio 的模拟绑定候选展示类型、单位和描述。质量仍由实时 TagValue 动态表达。

本批没有升级工程 Schema 0.2.0、没有持久化项目级 Tag 定义、没有设备地址或协议映射；目录内存重命名不代表已保存。新增 Core/Runtime 测试与 ADR-0061 已提交分支，**Windows `test:unit`、`test:runtime`、`vp check`、`docs:check`、`ready` 和双框架浏览器尚待验收**，不得继承第二十八批成绩。FR-004 继续部分实现，详见 [VALIDATION](VALIDATION.md) 和 [ADR-0061](adr/0061-tag-definition-catalog.md)。

### 第二十九批首轮 Windows `vp check --fix` 解析失败（2026-11-14）

维护者首次执行本批格式修复时报告 `apps/web-react/src/studio/StudioPage.tsx:2016` 的 JSX 三元分支根节点数量错误，`vp check --fix` 在解析阶段失败。本轮已在 PR #51 中加入 Fragment 修复，并检查、修正了新增 Core readonly 字段测试与 Vue 未绑定 Tag 的提示。**代码修复已经提交，但尚无本批 Windows 复验通过证据**；后续仍需执行 `vp check`、`test:unit`、`test:runtime`、`docs:check`、`ready`、Vue/React SSE 回归和人工 UI 验证。

### 第二十九批 Windows `ready` 检查 TS1294 阻塞与修复（2026-11-14）

维护者本轮执行 `pnpm run ready` 的实际结果：

- **已通过**：依赖 Catalog 检查（11 个清单、51 项）、共享配置（9 个 TSConfig 消费端）、统一环境和 LF、中文文案（159 个自有文件）、Prisma Client 7.10.1 生成、`@adui/scada-core` Node 构建（`tsc -p tsconfig.build.json`）、`vp check`（267 文件格式正确，133 个受检文件零警告、Lint 错误和类型错误）。
- **首次失败**：`typecheck:web` 阶段的 `tsc --build` 报 `TS1294`，定位 `packages/core/src/tag-store.ts:60` 的 `constructor(private readonly catalog?: TagDefinitionCatalog) {}`。项目启用 `erasableSyntaxOnly`，不允许该参数属性语法。`ready` 因此中断，**不能宣称单测、E2E、文档检查或 Web/Server 构建通过**。
- **已修复但尚待复验**：在同一 Draft PR #51 分支将上述参数属性替换为显式 `private readonly catalog?: TagDefinitionCatalog` 字段及 `constructor(catalog?: TagDefinitionCatalog) { this.catalog = catalog; }`。对外调用方式、目录可选行为及 TagStore 原子校验逻辑未改变；未升级依赖、修改 tsconfig、变更业务协议。
- **后续验证**：维护者同步分支后重跑 `pnpm run ready`，记录真正执行到单测、NestJS E2E、docs 和双框架构建的结果；必要时分别执行 `pnpm run test:runtime` 和 React/Vue SSE 浏览器回归。

本段仅记录实际日志与代码修复，不代表修复后的 `ready` 已通过。PR 继续保持 Draft 和 `@adui-dev` 指派，未经明确合并授权不合并。

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

## 2026-11-14 · V0.3 第三十批：项目级 Tag 定义持久化与工程 Schema 升级

第二十九批 PR #51 已合并至 `main`，合并提交为 `69f36d64189ec0c4d6acda0dab6e142ae9eb6d2b`。第三十批实施基线为 `feat/v0.3-project-tag-definitions`，当前仍是开发分支，尚未合并。

本批将项目 Tag 元数据纳入框架无关的 `ScadaDocument 0.3.0` 根字段 `tags`，沿用稳定 `tagId`、可变 `displayName`、`dataType`、`unit` 和 `description`。图元绑定继续只保存稳定 Tag ID；质量、实时值、时间戳和序列号仍属于动态 `TagValue`。

显式迁移入口支持 `0.1.0/0.2.0 → 0.3.0`。历史工程按现存绑定生成 `unknown` 类型占位定义，不推断工艺类型或单位、不改写原绑定；未知类型不进入新的绑定候选，维护者确认类型后再使用。当前解析器只接受 0.3.0，未来或未知 Schema 拒绝。

工程 JSON、IndexedDB 草稿、旧 localStorage 草稿和 Project Snapshot 共用迁移契约。IndexedDB 历史草稿在事务内升级并推进 revision；历史快照先验证原 SHA-256，再返回带来源元数据的 0.3.0 查看副本，不原地覆盖历史记录。Dexie 数据库版本和 Project Snapshot 容器格式保持不变。

Vue/React Studio 均从当前工程 `state.document.tags` 读取目录与绑定候选，不再以代码常量作为项目目录。本批不包含完整 Tag 新增/编辑/删除表单；不新增 Prisma 表、项目保存 API、设备地址字段、工业协议映射或设备写入。完整 Tag 管理 UI 留待后续独立批次双框架对等实现。

当前代码、迁移、草稿存储、快照和 Core 测试已提交开发分支；Windows `test:unit`、`test:runtime`、`test:e2e:server`、`vp check`、`docs:check`、`ready` 与双框架 SSE 浏览器回归尚未针对本批执行。不得继承第二十九批的验收结果。实施决策见 [ADR-0062](adr/0062-project-tag-definitions-schema-030.md)。

### 第三十批 Windows 首轮质量链问题定位（2026-11-14）

维护者在历史快照 TS2345/TS2322 修复后实测：`vp check`（268 文件、133 受检文件零错误）及 `docs:check`（78 份文档）通过；`ready` 已通过 Core 构建、Vue/React/Draft Storage/NestJS 类型检查，但在 Vitest 阶段出现一个 SVG 测试套件初始化失败与一个历史工程测试断言失败，未执行到完整 E2E/构建。原因均是 Schema 0.3.0 升级后测试夹具保留了错误版本结构，现已在第三十批功能分支调整。

React SSE 浏览器和 TCP 故障测试均在进入 EventSource 订阅前报 `error`，并未进入 Vue 验收。已为浏览器脚本增加工程版本及 Tag 目录预检查和实际 Runtime 错误文案输出。当前仅怀疑旧模拟服务进程未重启或返回不匹配的工程版本，缺少实际响应记录，不能据此声称已修复 SSE 运行时故障。代码修复提交后仍需维护者执行 Windows 全链、双框架浏览器及人工验证，详见 [VALIDATION](VALIDATION.md)。PR #52 保持 Draft，未合并。

### 第三十批 Windows 完整质量链已跑通，模拟服务版本阻塞 SSE 浏览器（2026-11-14）

维护者第二轮 PowerShell 实测确认：`test:unit` **438/438**（38 文件）、`test:runtime` **40/40**（4 文件）、`test:e2e:server` **17/17**（3 文件）通过；`vp check` **268 文件格式正确、133 文件零错误**，`docs:check` **78 份 Markdown 通过**。`pnpm run ready` 已执行完整单测、SSE 资源 8/8、TCP 故障代理 4/4、NestJS E2E 17/17、双框架类型检查和构建（React 3900、Vue 3845 模块）及 NestJS 构建，日志末尾没有报错；维护者未单独打印该命令的退出码。原有 SVG 测试夹具和历史工程迁移测试故障已被最新修复覆盖，不再复现。

`test:sse:browser` 和 `test:sse:fault:browser` **仍未通过**：React 入口经 Vite 代理读取 `/demo/project` 返回 **Schema 0.2.0、没有 tags**，而当前代码需要 0.3.0。两条测试均在 React 的工程预检查阶段终止，Vue 尚未执行。版本不一致已确认，但其具体进程原因仍须本机确认；不能把错误直接认定为已修复或宣称双框架浏览器回归通过。应确认实际监听端口的工程进程并停止旧 Demo，启动当前分支 `dev:demo`，确认两个 Web 入口代理都返回 0.3.0 与三项 Tag 后再回归 SSE。

本批尚待真实跨框架 Studio 人工验证、旧浏览器草稿及历史快照实际迁移、Tauri/工业现场等限定范围验收。PR #52 继续 Draft，Assignee `@adui-dev`；最新验收文档提交后仍需静态复验。

### 第三十批自动化质量链及双框架 SSE 浏览器回归通过（2026-11-14）

维护者 Windows 最终复验：全量单测 438/438、Runtime 专项 40/40、NestJS E2E 17/17、SSE 资源 8/8、TCP 故障代理 4/4、`vp check` 268 文件/133 受检文件零错误、`docs:check` 78 文档通过，`ready` 全链执行到 NestJS 构建完毕；React/Vue 双端 SSE 和 TCP 故障浏览器回归均成功，最终浏览器测试退出码 0。之前 `/demo/project` 返回 0.2.0 的旧服务版本阻塞已被解除。维护者已明确授权合并 PR #52；合并后续进度另行记录。

未人工验收的是 Studio 两框架目录操作、跨框架 JSON 历史导入导出、真实旧版 IndexedDB/localStorage 与历史快照迁移体验。工业网关、PLC/DCS、生产设备写入不在本次范围。详见 [VALIDATION](VALIDATION.md)。

### V0.3 第三十批合并与第三十一批双框架 Tag 管理启动（2026-11-14）

维护者明确授权后，PR #52 已通过 Squash Merge 合并至 main，合并提交为 5781d6903de83ba25f4df8172538f6208c0b0c5d；合并前 GitHub 核验无冲突、未解决审查线程 0，Assignee 为 @adui-dev。第三十批 Windows 自动化验收记录显示全量单测 438/438、Runtime 40/40、NestJS E2E 17/17，以及 Vue/React 双端 SSE 和 TCP 故障回归通过；Studio 人工目录与历史旧草稿真实迁移体验仍需单独验收。

第三十一批基于以上 main 提交创建 feat/v0.3-studio-project-tag-management。已在 Vue/React Studio 增加项目 Tag 新增、编辑、删除表单，保持稳定 Tag ID、unknown 历史占位及绑定保护，全部变更调用共享 Core Editor；另增加 test:tags:browser 双框架浏览器回归入口。本批不改工程 Schema 或工业协议，不提供设备写入。当前分支尚未执行 Windows ready 或完整浏览器验收，不得视为通过。详见 [ADR-0063](adr/0063-studio-tag-management-dual-framework.md)。

### 第三十一批 Windows 首轮验收与浏览器断言时序修复（2026-11-14）

维护者 Windows 日志确认第三十一批 `vp check`（271 文件、135 受检文件零错误）、`docs:check`（79 Markdown）及 `pnpm run ready` 完整执行至 NestJS build，438/438 单测、SSE 8/8、TCP 代理 4/4、NestJS E2E 17/17、React/Vue 类型检查和构建均通过。React/Vue 工程互通 `pnpm run test:interop` 通过，退出码 0。

`pnpm run test:tags:browser` 在 React 的绑定删除保护断言处失败。代码审查发现测试在捕获删除拒绝状态栏消息前先触发 JSON 导出，导出成功提示覆盖了删除拒绝提示；Core 删除保护逻辑仍然有效。已调整浏览器脚本为先等待并断言“仍被…绑定”提示，再导出 JSON 验证绑定 Tag 仍存在。此为测试时序修复，最新脚本尚未由维护者 Windows 重新执行，不能记录为通过；Vue 测试尚未在首轮失败时执行。详见 [VALIDATION](VALIDATION.md)。

### 第三十一批最终 Windows 验收通过（2026-11-14）

维护者复验确认：`pnpm run test:tags:browser` 中 React、Vue 两端的 Tag 新增、编辑、绑定删除保护、删除与 JSON 往返均通过，退出码 0；`vp check` 271 文件格式正确、135 个受检文件零错误；`docs:check` 79 Markdown 通过。此前同一分支 `ready` 全链及 `test:interop` 已通过。浏览器测试断言时序修复已在双框架实际浏览器中验证。PR #53 达到合并条件，维护者已明确授权合并。仍保留键盘/视觉人工检查与真正历史浏览器草稿迁移体验的后续核验。

### 第三十一批合并与第三十二批历史数据迁移浏览器验收启动（2026-11-14）

PR #53 已 Squash Merge 到 main，合并提交 7fccc1e2285d6ebb1190120142fcf998181460e6，并核验 main 指向同一 SHA；Assignee @adui-dev 已核验。维护者 Windows 实测 React/Vue 项目 Tag 新增、编辑、已绑定删除保护、删除及 JSON 往返均通过，test:tags:browser 退出码 0；vp check 271 文件/135 受检文件零错误，docs:check 79 Markdown 通过；此前 ready、test:interop 通过。键盘/视觉人工检查及旧浏览器草稿迁移体验仍需后续核验。

第三十二批基于该 main 提交创建 feat/v0.3-browser-legacy-project-migration。新增 pnpm run test:legacy:browser，准备在 React/Vue 两个真实浏览器 Origin 中分别验证旧 localStorage 草稿、已有 IndexedDB 0.2.0 草稿的事务迁移与 revision 推进、旧 Project Snapshot 的原 SHA-256 校验和只读归一化。测试不更改迁移业务代码、Schema、Dexie 版本或快照格式。当前只完成浏览器测试实现和 ADR-0064，尚未执行 Windows 浏览器测试与完整质量链，不得报告通过。

### 第三十二批 IndexedDB 浏览器测试夹具版本冲突修复（2026-11-14）

维护者首轮 `test:legacy:browser` 已通过 React localStorage 草稿迁移，随后报 `VersionError: requested version 1 < existing version 10`。原因是 Dexie `version(1)` 对应原生 IndexedDB version 10，而测试夹具把逻辑版本 1 传给原生 `indexedDB.open`。已修复两个测试夹具：先由 Studio/Dexie 初始化数据库，检查数据库存在后不带版本参数打开并校验现有 stores；历史快照路径也先通过 Studio 版本菜单初始化数据库并关闭菜单，再注入快照以触发后续刷新。此为浏览器测试夹具修复，不更改迁移业务实现。修复尚待 Windows 重新执行，IndexedDB 草稿、快照路径及 Vue 端仍未验证通过。

### 第三十二批 Project Snapshot 浏览器测试函数作用域修复（2026-11-14）

维护者第二轮实测：React localStorage 草稿迁移、旧副本清理与恢复通过；React IndexedDB 0.2.0 草稿事务迁移、revision 推进与恢复通过；Project Snapshot 注入报 `ReferenceError: stableLegacyValue is not defined`。根因是 CDP `evaluateStudioPage` 只序列化当前函数，不带 Node 作用域闭包。已把与 Core 相同的递归稳定排序函数内聚至 `seedLegacyProjectSnapshotInPage`，不更改 SHA-256 算法或快照格式。最新修复尚未由维护者 Windows 复验；Project Snapshot 和 Vue 路径仍待执行。

已将稳定排序 helper 内聚到 CDP 页面函数，并删除不再使用的 Node 作用域 helper；最新提交为后续 Windows 复验准备，仍未报告 Project Snapshot 或 Vue 路径通过。

### 第三十二批六条历史迁移路径与跨框架互通通过（2026-11-14）

维护者最新 Windows 日志确认 `pnpm run test:legacy:browser` 退出码 0：React、Vue 两端 localStorage 0.2.0 草稿迁移、旧副本清理与 Studio 恢复，IndexedDB 0.2.0 草稿事务迁移与 revision 推进，Project Snapshot 原 SHA-256 校验、只读归一化和原记录保留共六条路径全部通过。`pnpm run test:interop` 双向及完整 React→Vue→React→Vue 往返、非法导入保护通过，退出码 0。`vp check` 272 文件格式正确、135 个受检文件零错误；`docs:check` 80 Markdown 通过。此前 `ready` 输出确认 438/438 单测、SSE 8/8、TCP 故障 4/4、NestJS E2E 17/17、React/Vue 类型检查和构建通过，但提供的日志截断在最终 NestJS build 的 Prisma Client 生成阶段，没有最终 build 结束或 `ready` 退出码，故不能据此宣称完整 ready 成功。PR #54 继续等待最后全链证据和维护者合并授权。

### 第三十二批完整 ready 质量链最终确认（2026-11-14）

维护者补充确认 `pnpm run ready` 最终退出码为 **0**。结合此前日志，第三十二批完整质量链中的 438/438 单测、SSE 客户端 8/8、TCP 故障代理 4/4、NestJS E2E 17/17、React/Vue 类型检查与构建、NestJS 最终构建全部完成。历史迁移浏览器六路径及跨框架互通此前均退出码 0；本批自动化验收条件已满足。

### 第三十三批 OIDC 与服务端工程 API 规划获维护者同意（2026-11-14）

PR #54 已合并到 main，合并提交 8a9dbf5b37a14c3f46b00e28561abcedf5e92c96。第三十二批 Windows 实测六条历史迁移浏览器路径、test:interop、vp check、docs:check 和 pnpm run ready 全部通过，ready 最终退出码 0。

维护者同意第三十三批采用厂商无关 OIDC 架构，具体 Issuer 通过服务端配置决定。当前实施分支 feat/v0.3-oidc-project-api 已创建，先固化 ADR-0065 与实施计划：openid-client 6.8.9、Authorization Code + PKCE、预绑定 (iss, sub) 身份映射、BFF HttpOnly Cookie、CSRF、统一 PrismaService、/api/v1 工程版本 API 和共享 API Client。OIDC 默认关闭，未完成身份认证和工程 ACL 不挂载工程路由。此时只完成设计文档，未增加依赖、数据库迁移或业务代码，不能声称 OIDC 或工程 API 已实现。

### 第三十三批阶段 A · OIDC 默认关闭配置与数据库模块（2026-11-14）

维护者已在 Windows 执行本分支 `vp check`（274 个文件格式正确、135 个受检文件零错误）和 `pnpm run docs:check`（82 份 Markdown 通过，退出码 0）。以上均为本次代码新增**之前**的架构文档验收，不代表本次阶段 A 代码已经通过检查。

阶段 A 提交时：共享 DatabaseModule 统一提供 PrismaService，可信身份/工程持久化模块不再各自声明 PrismaService；OIDC Zod 启动配置默认关闭，严格验证固定 HTTPS Issuer、回调 URI、浏览器 Origin、客户端凭据和 32 字节 Base64URL 加密密钥。非生产回环 HTTP 测试必须显式开启。当时 `main.ts` 对 OIDC enabled 主动拒绝启动；第五小批后，完整配置通过且显式启用时会加载仅包含身份路由的 OidcEnabledAppModule，默认 AppModule 仍不连接数据库或注册身份/工程路由。

Prisma Schema 已增加 ScadaExternalIdentity 外部身份预绑定、ScadaOidcTransaction 一次性登录事务和 ScadaAuthSession 可空 CSRF 摘要，并新增带中文表/字段/索引注释的独立增量 SQL 迁移；**尚未在任何数据库执行迁移**。新增 OIDC 配置安全单测和 Nest 模块装配测试，尚未在 Windows 执行。openid-client 仍待下一次由 pnpm 原生安装并同步锁文件，当前不能声称 OIDC 流程或工程 API 已实现。

### 第三十三批 OIDC 单测规则警告修复（2026-11-14）

维护者 `vp check --fix` 报告 0 错误、7 警告（五处空 `toThrow()`、一处条件式 `expect`、一处字符串展开遍历）。本分支已将异常断言改为具体中文消息、完整异常正则校验，并将控制字符检测改为索引式 `charCodeAt` 遍历。仅更改 OIDC 配置及其单测，尚未收到修复后 Windows `vp check`、单测或完整质量链退出码；PR #55 仍为 Draft。

### 第三十三批 Prisma 注释单测失败及最小修复（2026-11-14）

维护者 `test:unit` 实测 447/448 通过，仅 Prisma 中文数据库注释约束测试失败。根因是新增 OIDC 增量迁移文件中部分 COMMENT ON TABLE/COLUMN/INDEX 语句的 `IS` 与中文文本分行，而仓库测试按单行解析，导致 commentText 返回 null。仅将 10 处注释规范为单行，无 DDL 和 Prisma 模型语义变化。按现有逐行匹配规则静态核对 8 个模型、全部 4 份迁移、58 个表/物理字段注释，均能匹配中文内容。仍待 Windows 重跑 `test:unit`，不可据静态检查宣称单测通过。PR #55 保持 Draft。

### 第三十三批阶段 A Windows 全链实测通过（2026-11-14）

维护者最新实测：`vp check` 278 文件格式正确、139 受检文件零错误；`test:unit` 40/40 文件、448/448 测试通过（OIDC 配置 7/7、共享数据库模块 3/3、Prisma 中文注释 2/2）；`docs:check` 82 Markdown 通过；完整 `pnpm run ready` 最终退出码 **0**，其中 SSE 8/8、TCP 故障代理 4/4、NestJS E2E 17/17、React/Vue 构建及 NestJS 构建成功。此前 SQL 单行中文注释测试失败已解决。PostgreSQL 实际增量迁移、OIDC 协议、Cookie/CSRF 和工程 API 尚未执行或实现；服务默认 fail-closed。

### 第三十三批 openid-client 依赖与 AI 复盘规范落地（2026-11-14）

维护者已在 Windows 使用 pnpm 12.18.0 将 `openid-client@6.8.9` 加入根 Catalog / Server Manifest 并生成 `pnpm-lock.yaml`；`pnpm install --frozen-lockfile` 成功，`deps:check` 确认 11 清单/52 Catalog，`vp check` 278 文件格式正确、139 受检文件零错误，`pnpm run ready` 最终退出码 0，448/448 单测、SSE 8/8、故障代理 4/4、NestJS E2E 17/17 和双框架/服务端构建通过。OIDC 仍默认关闭且 enabled 时 fail-closed；真实 PostgreSQL 增量迁移、OIDC Discovery/PKCE/CSRF、工程 HTTP API 尚未完成。

按维护者新要求，新增 `docs/AI_MISTAKES.md` 记录 9 项真实编码错误及避坑/复验方法，在 `AGENTS.md` 强制每次写代码之前重新阅读全文，在 `HARNESS.md` 与 `CODEBASE_MAP.md` 加入入口，文档校验脚本要求该文件存在。新增文档和校验脚本的修改**尚未进行 Windows 复验**；先前 82 份 Markdown 检查不覆盖新增文件。

### 第三十三批错误复盘文档后的最终静态检查（2026-11-14）

维护者 Windows 最新日志确认：`pnpm run docs:check` **83 个 Markdown 通过、退出码 0**；`vp check` **279 个文件格式正确，139 个受检文件零警告、Lint 和 TypeScript 错误**。两项结果已覆盖新增 `docs/AI_MISTAKES.md`、AGENTS 必读门禁、Harness/代码地图入口和文档检查器必需文件校验。

此前 pnpm 12.18.0 依赖安装、冻结安装、52 项 Catalog 检查、448/448 单测及完整 ready（退出码 0）已由维护者确认；完整 ready 当时的文档数是 82，最新 83 份则由本次单独 docs:check 确认。隔离 PostgreSQL 实际迁移仍待执行。

### 第三十三批 OIDC 增量迁移真实数据库测试用例（2026-11-14）

新增 `apps/server/test/oidc-schema.db-spec.ts`，纳入现有 `pnpm run test:db` 隔离数据库测试入口。测试严格限制连接目标为本机 `adui_scada_test`，核验迁移登记、OIDC 表/15 个字段/外键/约束/三个索引及中文数据库注释。该测试尚未执行；等待维护者创建独立数据库、应用迁移并提供 `db:migrate:deploy`、`db:migrate:status`、`test:db` 的退出码。不会使用普通开发库或生产库。

## 2026-11-14 · V0.3 第三十三批：OIDC 隔离 PostgreSQL 增量迁移验收通过

维护者在 Windows 本机对隔离数据库 `127.0.0.1:15432/adui_scada_test` 完成真实 PostgreSQL 验收，所有命令均有实际终端输出：

- `pnpm run db:validate`：Prisma Schema 校验通过。
- `pnpm run db:migrate:deploy`：成功应用 `20261114000000_oidc_identity_transactions` 增量迁移。
- `pnpm run db:migrate:status`：4 项迁移均已登记，数据库 Schema 为最新状态。
- `pnpm run test:db`：2 个测试文件、17/17 测试通过；OIDC Schema 5/5，既有工程版本数据库回归 11/11；最终退出码 **0**。

本次真实数据库检查覆盖迁移登记、两张 OIDC 新表、15 个新增物理字段及中文注释、复合外键、检查约束、可空字段和三个新增索引及其中文注释。未执行数据库重置、删除或重建，没有覆盖既有数据库数据。

**验收边界**：这是既有隔离测试库上的增量迁移与真库集成测试通过；尚未在另一全新隔离数据库从空库完整部署全部迁移，也尚未重复执行部署命令验证幂等。OIDC 协议流程、BFF Cookie/CSRF 和工程 HTTP API 仍未实现，`SCADA_OIDC_ENABLED` 必须保持默认关闭及服务端 fail-closed。PR #55 继续 Draft，Assignee 为 `@adui-dev`，未经维护者明确授权不得合并。

## 2026-11-14 · V0.3 第三十三批阶段 B 第一小批：固定 Issuer OIDC Discovery（代码已提交，待 Windows 验证）

在 PR #55 分支新增 `OidcProviderDiscoveryService`，使用仓库已锁定的 `openid-client@6.8.9`，不增加依赖：

- 仅从服务端固定 Issuer Identifier 执行 Discovery；配置层拒绝 `/.well-known/` 路径，避免使用 Discovery 文档 URL 绕过库的 Issuer 匹配校验。
- 10 秒超时、惰性发现、并发请求共享发现任务；成功配置进程内复用，失败后清理任务以便重试。
- 严格检查授权码响应、主体标识类型、RS256、PKCE S256，以及声明的授权码许可、openid Scope 和 `client_secret_basic` 能力。
- 必须提供 Authorization Endpoint、Token Endpoint、JWKS URI；端点只允许 HTTPS，显式非生产本机测试模式仅允许回环 HTTP。自定义 Fetch 不自动跟随重定向，错误不暴露 Issuer、端点、响应体或底层异常。
- 客户端认证固定为 `client_secret_basic`，ID Token 签名算法固定为 RS256。服务注册在未挂载的 `ScadaIdentityModule`，不会改变默认 AppModule 或现有 Bearer 会话。

新增 Mock Fetch 单测覆盖正常发现、并发复用、Issuer 不匹配、元数据能力拒绝、不安全端点、本机 HTTP 边界和失败重试。**这些测试代码尚未在维护者 Windows 环境执行**；当前仍需 `vp check`、`pnpm run test:unit`、`pnpm run docs:check` 和完整 `pnpm run ready` 实测。测试不访问真实 IdP；当时未开放登录接口，`main.ts` 对 `SCADA_OIDC_ENABLED=true` 保持 fail-closed。该状态已由第五小批更新为仅在配置完整时挂载身份路由。

下一小批再实现 Authorization Code + PKCE、State/Nonce 和数据库一次性事务；不得提前启用 OIDC。

## 2026-11-14 · V0.3 第三十三批阶段 B 第二小批：OIDC 一次性登录事务（代码已提交，待 Windows 验证）

新增 `OidcLoginTransactionService`，在服务端生成授权码请求并保存短时事务：

- 使用 openid-client 生成 State、Nonce、PKCE verifier 与 S256 challenge；授权请求使用固定 Redirect URI 和 `openid` Scope。
- State 与浏览器绑定 Cookie 仅保存 SHA-256 摘要；PKCE verifier 使用 AES-256-GCM 加密，State 摘要作为 AAD。
- 事务固定有效期 5 分钟；回调按固定 Issuer、浏览器绑定、创建/过期时间及未消费状态筛选，并通过数据库条件更新原子消费。
- 同一浏览器可复用短时绑定 Cookie 支持多标签页；每次登录仍有独立 State/Nonce/Verifier。
- 严格校验站内回跳路径，拒绝外部 URL、协议相对地址、反斜杠、片段和控制字符。
- 第二小批提交时服务仅注册在尚未挂载的 `ScadaIdentityModule`，当时没有 OIDC HTTP 路由；第五小批已补充身份 Controller 和显式启用根模块。

新增 Mock Prisma 单测覆盖授权请求、加密往返、重复/并发消费、跨浏览器、过期、回跳路径和异常脱敏。**尚未在维护者 Windows 环境执行**，需完成 `vp check`、`pnpm run test:unit`、`pnpm run docs:check` 和 `pnpm run ready`。

### 第三十三批阶段 B 第二小批控制字符 Lint 警告修复（2026-11-14）

维护者 Windows `vp check --fix` 报告 OIDC 回跳路径控制字符正则触发 `eslint(no-control-regex)`（0 错误、1 警告）。已改为逐字符 `charCodeAt()` 检查，继续拒绝 ASCII 控制字符，不关闭规则；增加原始换行、NUL、DEL 测试输入。**修复后尚未收到 Windows 复验结果**，需重新执行 `vp check` 与单测，不能将格式化完成等同于零警告通过。

### 第三十三批阶段 B 第一、二小批 Windows 全链验收通过（2026-11-14）

维护者 Windows 最新日志确认：`vp check` 284 个文件格式正确、144 个受检文件零警告/Lint/TypeScript 错误；`pnpm run test:unit` 42/42 文件、465/465 测试通过（OIDC Discovery 7/7、登录事务 10/10）；`pnpm run docs:check` 83 份 Markdown 通过；完整 `pnpm run ready` 最终退出码 **0**。该次 ready 同时通过依赖 11 清单/52 Catalog、中文文案 170 个文件、SSE 8/8、故障代理 4/4、NestJS E2E 17/17、React/Vue 与 NestJS 构建。

### 第三十三批阶段 B 第三小批：OIDC 授权码回调与身份验证（代码已提交，待 Windows 验证）

新增 `OidcCallbackService` 与 Mock 单测：先消费一次性 State/浏览器绑定事务，使用 openid-client 6.8.9 `authorizationCodeGrant()` 兑换授权码并验证 State、Nonce、PKCE；按 Discovery 元数据要求校验响应 `iss`；使用固定服务端 Redirect URI 构造 Token Exchange 回调地址，不信任请求 Host。ID Token 由 openid-client 验签并检查 Issuer/Audience/有效期/Nonce，应用层补充 `azp`、Subject 和时间声明边界。

认证成功后只按 `(iss, sub)` 查询预绑定外部身份，要求本地身份 active，再复用 `AuthSessionService` 签发内部会话；不按邮箱/用户名自动创建主体，不保存或记录 IdP Token。第三小批提交时服务仅在未挂载的 `ScadaIdentityModule` 中注册，尚无 HTTP Controller；第五小批已新增 Controller，将内部 sessionToken 仅写入 HttpOnly Cookie。**本小批新增代码和 Mock 测试尚未在维护者 Windows 执行**；真实 IdP、JWKS 轮换、Cookie/CSRF 和工程 API仍未验收，OIDC 继续 fail-closed。

### 第三十三批阶段 B 第三小批：OIDC 回调测试夹具修复及完整质量链通过（2026-11-14）

维护者 Windows 实测确认：修复 `oidc-callback.service.spec.ts` 中 Mock 记录类型过窄导致的 TS2322 后，`vp check` 286 个文件格式正确、146 个受检文件零警告/Lint/TypeScript 错误；`pnpm run test:unit` 43/43 文件、477/477 测试通过（OIDC Discovery 7/7、登录事务 10/10、OIDC 回调 12/12）；`pnpm run docs:check` 83 个 Markdown 通过；完整 `pnpm run ready` 最终退出码 **0**，SSE 8/8、故障代理 4/4、NestJS E2E 17/17 及 React/Vue/NestJS 构建全部完成。

本次 TS2322 的根因、类型派生修复和复验命令已记录为 `docs/AI_MISTAKES.md` E-011。阶段 B 第三小批服务层代码及 Mock 测试通过当前 Windows 工程质量链；真实 IdP/JWKS 联调、HTTP Controller、Cookie/CSRF 和工程 API仍未完成，`SCADA_OIDC_ENABLED=true` 继续 fail-closed。

### 第三十三批阶段 B 第三小批最终 Windows 全链验收（2026-11-14）

维护者最新日志确认，修复 OIDC 回调 Mock 类型 TS2322 后：

- `vp check`：286 个文件格式正确，146 个受检文件零警告、Lint 错误和 TypeScript 错误。
- `pnpm run test:unit`：43/43 文件、477/477 测试通过；OIDC Discovery 7/7、登录事务 10/10、回调 12/12。
- `pnpm run docs:check`：83 个 Markdown 文件通过。
- 完整 `pnpm run ready`：依赖 11 清单/52 Catalog、中文文案 172 个文件、SSE 客户端 8/8、故障代理 4/4、NestJS E2E 17/17、React/Vue/NestJS 构建全部通过，最终退出码 **0**。

E-011 已在 `docs/AI_MISTAKES.md` 记录；其类型派生修复与第三小批代码现已通过 Windows 工程质量链。真实 IdP/JWKS 联调、生产 HTTPS Cookie 和工程 API仍未完成；第五小批已提交身份 HTTP Controller，启用仍需维护者质量验收。

### 第三十三批阶段 B 第四小批提交时状态记录（2026-11-14）

第四小批提交时，Cookie/CSRF 会话服务、Cookie 头构造函数和 Bearer/Cookie 双路径 `ScadaSessionGuard` 已进入 PR #55；当时尚未注册 HTTP Controller，默认 AppModule 不加载身份模块，`main.ts` 仍 fail-closed。该状态已由第五小批更新：身份 Controller 仅在 OIDC 启用根模块中注册。第四、五小批仍待维护者 Windows 质量验收；真实浏览器 Cookie/HTTPS 代理行为待联调。

### 第三十三批阶段 B 第五小批：OIDC BFF HTTP 控制器与认证路由（Windows 工程质量验收通过）

新增 `ScadaAuthController`，提供 `/api/v1/auth/oidc/start`、`/api/v1/auth/oidc/callback`、`/api/v1/auth/me` 和 `/api/v1/auth/logout`。Start/Callback 复用现有 OIDC 登录事务与回调服务；使用短时 HttpOnly 浏览器绑定 Cookie，成功回调后仅通过安全 Session/CSRF Cookie 建立浏览器会话，不在响应 JSON 暴露令牌。`/me` 只返回已验证的租户/主体上下文；`/logout` 撤销当前本地会话并清理 Cookie，Cookie 写请求继续受 CSRF Guard 保护。

新增 `OidcEnabledAppModule`，`main.ts` 仅在 OIDC 配置完整且开关启用时选择该根模块；它只加载 `AppModule + ScadaIdentityModule`，没有加载 `ProjectPersistenceModule`。默认 `AppModule` 仍不注册身份路由、不连接 PostgreSQL；OIDC 与本机模拟 API 同时启用会拒绝启动。新增认证 Controller HTTP E2E 与默认根模块 404 回归。

**验收状态**：维护者 2026-11-14 Windows 已完成第四、五小批完整质量验收：`vp check` 291 个文件格式正确、151 个受检文件零警告/Lint/TypeScript 错误；`test:unit` 45/45 文件、494/494 测试；`test:e2e:server` 4/4 文件、26/26 测试（OIDC Controller 9/9）；`docs:check` 83 Markdown；完整 `ready` 最终退出码 0，React/Vue/NestJS 构建成功。Mock E2E 不代表真实 IdP/JWKS、HTTPS 浏览器 Cookie、反向代理或企业身份映射已验收。工程 API 仍未开放，工业设备写入仍未实现。

### 第三十三批阶段 B 第五小批：Windows 首轮静态检查问题修复（已复验通过）

维护者首次 `vp check --fix` 反馈：401 E2E 缺少 Vitest 显式断言、Supertest `set-cookie` 类型为字符串却被当数组调用 `.join()`、数据库模块测试导入 Controller 后未使用。已分别补充状态断言、兼容字符串/数组且避开 Expires 逗号的 Cookie 头解析函数，以及身份模块 Controller 元数据断言。防复发记录为 `docs/AI_MISTAKES.md` E-012。

**状态**：修复已提交至 PR #55，并已由维护者 Windows 完整复验通过。`vp check` 291 文件/151 受检零警告错误；单测 494/494；NestJS E2E 26/26（OIDC Controller 9/9）；文档 83 Markdown；完整 `ready` 最终退出码 0。详细记录见 `docs/VALIDATION.md`。

### 第三十三批阶段 B 第四、五小批最终 Windows 验收（2026-11-14）

维护者提供的最新 Windows 日志确认：`vp check` 291 个文件格式正确、151 个受检文件零警告/Lint/TypeScript 错误；`pnpm run test:unit` 45/45 文件、494/494 测试通过；`pnpm run test:e2e:server` 4/4 文件、26/26 测试通过，其中 OIDC Controller E2E 9/9；`pnpm run docs:check` 83 个 Markdown 通过；SSE 客户端 8/8、故障代理 4/4；React、Vue、NestJS 构建成功；完整 `pnpm run ready` 最终退出码 **0**。

E-012 的 HTTP 测试断言、Supertest Set-Cookie 类型和 Controller 元数据导入问题已复验关闭。当前阶段 B 第四、五小批工程质量验收通过；真实 IdP/JWKS、真实浏览器 Secure Cookie、生产 HTTPS/反向代理和企业身份映射仍需专项验收。工程 HTTP API 尚未开放。

## 2026-11-14 · 第三十三批第六小批工程 API 实施草稿

本批在功能分支准备工程 API 事务仓储扩展、六条 NestJS 工程路由、明确的领域错误映射及单元/HTTP E2E/隔离 PostgreSQL 测试。工程列表只返回有权限的摘要；创建操作对工程、创建者 ACL、revision 1 快照、水位和成功审计执行原子事务。不新增数据库 Schema 与迁移、不开放删除/发布/回滚/工业写入。默认 AppModule 保持 API 404；OIDC 根模块在完整配置启用时才挂载工程接口。

**重要**：该第六小批目前只是待验证的代码实施草稿。当前执行环境没有仓库 pnpm 依赖及本机隔离 PostgreSQL，不能声称 `vp check`、`ready`、真实数据库或 HTTP E2E 已通过；第五小批此前的 Windows 验收仍独立有效，不适用于本批新增代码。

### 第三十三批第六小批候选安全复核（2026-11-15）

候选工程 API 的六条成功响应新增 `Cache-Control: no-store`，防止工程文档和版本摘要被 HTTP 缓存。创建事务增加本地受信主体 `active` 状态的 `FOR SHARE` 共享锁内复核，避免 Guard 验证后主体被停用却继续写入工程、ACL 与审计。单元和隔离 PostgreSQL 用例已补充，但尚未执行。候选提交仍未进入 PR #55 功能分支，不得沿用第五小批质量验收结果。

### 第三十三批第六小批 · 2026-11-16 启动入口语法修复

维护者在已推送至 PR #55 的第六小批候选代码上运行 `vp check --fix`，于 `apps/server/src/main.ts:73` 遇到 EOF 缺少 `)` 的格式化解析错误。已定位为启动入口 `bootstrap().catch(...)` 结尾只写了 `}`，缺失 `);`，按最小改动修复为 `});`。修正后 Git Blob 内容与容器内完整文件 SHA 一致，TypeScript 5.8.3 语法解析 0 错误。记录为 `docs/AI_MISTAKES.md` E-013；当前未执行完整 Windows 工程质量链或真实 PostgreSQL 测试，第六小批继续保持 Draft 待验收。

### 第三十三批第六小批 · 2026-11-16 Windows 工程质量验收结果

维护者最新 PowerShell 日志确认：`vp check` 297 文件/157 受检零警告错误；单元测试 46/46 文件、505/505 项通过（新增工程 API 仓储单测 10/10）；NestJS HTTP E2E 5/5 文件、40/40 项通过（工程 API E2E 13/13）；SSE 客户端 8/8 和故障代理 4/4；83 份 Markdown 检查、React/Vue/NestJS 构建成功；完整 `pnpm run ready` 最终退出码 **0**。`main.ts` EOF 的 E-013 已由 Windows Vite+ 复验关闭。功能分支最新已检索到用户格式化提交 `e15f058b`；该日志没有独立输出 Git HEAD，不能强称日志包含精确提交指纹。

第六小批**工程质量门禁通过、真实 PostgreSQL 与真实身份/代理专项仍待验收**。`project-api.db-spec.ts` 新增测试不属于通用 `ready`；未取得本批 `test:db` 结果，不标记事务竞争、租户隔离或审计失败回滚在真实数据库中通过。PR #55 保持 Draft，未经维护者明确授权不得合并。本记录同步后仍需执行最新文档提交的 `docs:check`。

### 第三十三批第六小批 · 2026-11-16 PostgreSQL 真实事务验收补录

维护者 Windows 在本机隔离库 `127.0.0.1:15432/adui_scada_test` 完成 Prisma Schema 校验、迁移状态检查及 `pnpm run test:db`。现有四项迁移均无待执行项；真实数据库测试 3/3 文件、22/22 项通过（OIDC 5/5、工程版本 11/11、工程 API 6/6）。与此前 `ready` 退出码 0、单测 505/505、E2E 40/40 的工程质量验收分别记录。首次漏配 `SCADA_TEST_DATABASE_URL` 引发的 0-test 拒绝为安全门禁生效，补充受控变量后成功完成全部测试。

下一项“全新隔离空库首次迁移及重复部署”仅准备了受控 Node 脚本和目标校验单测（6/6 静态/纯逻辑验证）；尚未在 Windows 新建空库并运行真实 Prisma 迁移。此项与真实 IdP、HTTPS Cookie/代理和 Vue/React API Client 仍待验收。PR #55 继续保持 Draft，未经明确授权不得合并。

### 2026-11-16 · 空库迁移专项测试的七条 Lint 警告修复

维护者最新 `vp check --fix` 日志显示，新增 `node:test` 文件的一处 `describe()` 和六处 `it()` 因未显式处理 `Promise<void>` 触发 `typescript(no-floating-promises)` 七条警告，虽然格式化已经完成，但不满足零警告质量门禁。按 E-014 最小修复为 `void describe(...)` 与 `void it(...)`，不调整六个数据库目标保护测试的断言和空库安全策略。修复后 `vp check`、`node --test`、`docs:check`、`ready` 以及真实空库迁移尚待实测，PR #55 继续保持 Draft。

### 2026-11-16 · E-014 与空库目标校验工具 Windows 全链验收通过

维护者 PowerShell 完整日志确认，`node --test scripts/verify-fresh-postgres-migrations.cases.mjs` 6/6 通过，`vp check` 299 个格式正确文件、159 个受检文件零警告/错误，`docs:check` 83 份 Markdown 通过。完整 `ready` 中单测 505/505、NestJS HTTP E2E 40/40、SSE 客户端 8/8、故障代理 4/4、React/Vue/NestJS 构建均通过，最终退出码 0；E-014 的 7 条 Promise Lint 警告已经复验关闭。

当前功能分支 GitHub 已有格式化提交 `7e5aac7`，该日志没有单独输出本地 Git HEAD，不强称已验证精确提交指纹。现有隔离 PostgreSQL 事务测试 22/22 已由此前维护者日志证实；**全新空库首次迁移及二次部署幂等性仍未运行**，实际数据库连接与真实 IdP、HTTPS Cookie、代理、React/Vue 互通继续待专项验收。PR #55 保持 Draft，未获合并授权。

### 2026-11-16 · 空库迁移全链实测通过，E-015 子进程警告待复验

维护者已在本机新建空库 `adui_scada_fresh_20261116` 实际完成四项 Prisma 迁移首次部署、第二次无待执行迁移以及 `migrate status`，八个预期业务表和迁移元数据均通过脚本检查，最终退出码 0；`docs:check` 同时通过 83 份 Markdown。阶段 A 的**全新空库及重复部署专项正式通过**，区别于先前 `adui_scada_test` 的 22/22 事务回归。

本次日志同时暴露 Node.js `DEP0190`：Windows `pnpm.cmd` 配合 `shell: true` 传参。已按 E-015 最小改为当前 Prisma CLI 由 `process.execPath` 无 shell 调用，保留现有隔离和失败即停止策略；协作容器只验证了语法、目标保护 6/6 与模拟进程执行，**真实 Windows Prisma 调用及最新质量链仍待复验**。现有空库不得重置或用于再次执行“全新空库”的验证；实际复验必须另建新空库。PR #55 继续 Draft，不合并。

### 2026-11-16 · E-015 Windows Prisma 无 shell 子进程专项验证通过

维护者修复后 Windows `node --test` 6/6、`vp check` 299 格式文件/159 受检零警告错误、`docs:check` 83 Markdown、`ready` 505 单测、40 HTTP E2E、SSE 8/8、故障代理 4/4、React/Vue/NestJS 构建通过，最终退出码 0。随后在另一座全新空库 `adui_scada_fresh_20261116_b` 上运行无 shell Prisma 7.10.1 子进程：四项迁移全部首次成功，二次无待执行项、`migrate status` 最新、迁移元数据一致、退出码 0，**未再出现 DEP0190**。E-015 已关闭，原有 `adui_scada_fresh_20261116` 和本轮新空库均保留；不能用已部署的库冒充空库。Prisma 8 RC 更新提示无需升级。

目前第三十三批数据库专项与工程 API 的单元/Mock E2E/隔离 PostgreSQL 事务均通过；真实 IdP/JWKS、生产 HTTPS 安全 Cookie/同源代理、React/Vue 双框架 API Client 及现场安全仍未验收。PR #55 继续保持 Draft，不合并。用户日志未单独输出本地 HEAD SHA，文档变更后的 `docs:check` 仍待复验。

### 2026-11-16 · 第三十三批第七小批：共享工程 API Client 候选

新增工作区 `@adui/scada-api-client`，将身份 `me/logout`、六条受保护工程 API 的请求/响应契约、同源 Fetch、CSRF Cookie 读取、中文错误映射与 Core SHA-256 快照验证封装为框架无关代码。React/Vue Manifest 引用同一个工作区包，但本小批不接入现有 Studio 保存按钮，不改变 IndexedDB 离线草稿或现有演示 SSE，不开启真实 OIDC，也不开放 PLC/DCS 写入。Core 和服务器业务接口保持不变。

已在协作容器 Node 22/TypeScript 5.8.3 临时 Core 声明下完成源码类型检查和模拟 Core 的 Fetch 烟测；**尚未运行仓库 TypeScript 6 / Vite+ / Vitest / pnpm 12 完整检查**。新工作区仅引用既有 `@adui/scada-core`、`@adui/tsconfig`、TypeScript 和 Vite+，锁文件仅作已知 workspace 链接增量，必须在维护者 Windows 使用真实 pnpm 生成及验证。真实 IdP、HTTPS Cookie/同源代理、Vue/React Studio 接线和浏览器互通仍待后续专项，PR #55 保持 Draft。

### 2026-11-16 · 第三十三批第七小批共享 API Client：Windows 全链通过

维护者 Windows 日志确认独立工作区 `@adui/scada-api-client` 已通过 TypeScript 6 对应的根质量门禁：`vp check` 303 格式文件/161 受检零告警错误、`typecheck:web`（含新增客户端包）、单元测试 47 文件 **520/520**（新增 Mock Fetch **15/15**）、NestJS E2E **40/40**、SSE 客户端 8/8、故障代理 4/4、文档 83 个 Markdown 与 React/Vue/NestJS 全部构建；完整 `pnpm run ready` 最终退出码 **0**。仓库当前功能分支仅额外存在一次源码/测试格式提交 `d95bf224`；用户日志未显示本地 Git SHA，不冒充精确提交指纹证据。

目前共享 API Client 的**工程质量门禁已通过**，但上传日志未证明 pnpm 12.18.0 `--lockfile-only` 和 `--frozen-lockfile` 安装专项通过；React/Vue UI 未接线，真实 OIDC/JWKS、HTTPS Cookie/同源代理及浏览器工程互通仍未验收。继续保持 PR #55 Draft，后续优先核对锁文件冻结安装，再分批接线 Vue/React，不改变 IndexedDB 草稿与设备只读安全边界。

### 2026-11-16 · 第七小批 pnpm 冻结锁文件验收完成

维护者 Windows 已实际执行 `pnpm install --frozen-lockfile`，覆盖 12 个 workspace，锁文件供应链策略通过，提示锁文件已是最新并跳过依赖解析，pnpm 版本 12.18.0；随后 `docs:check` 83 个 Markdown 通过、最终退出码 0。结合此前共享 API Client 15/15 Mock Fetch、全量 520/520 单测、40/40 E2E、`vp check` 303/161 零警告与 `ready` 退出码 0，第七小批的**工程质量及冻结锁文件安装验收完成**。

仅有 `--frozen-lockfile` 的明确执行证据，没有 `--lockfile-only` 独立执行记录；此次文档更新后需重新执行 `docs:check`。React/Vue UI 接线、同源代理、真实 IdP/JWKS、HTTPS Cookie 与双框架浏览器互通仍待下一小批，PR #55 保持 Draft，不合并。

### 2026-11-16 · 第三十三批第八小批：双框架 Studio 服务端工程操作候选代码

在已验收的共享 `@adui/scada-api-client` 上新增 `StudioServerProjectSession`：必须由当前可信服务端身份与显式载入的最新修订号建立会话内 CAS 保存基线；本地 IndexedDB 修订号与服务端版本绝不混用，首次创建与版本追加失败不清理草稿、不静默覆盖画布。React/Vue 两端各新增独立“服务端工程”菜单，支持检查登录、保存服务端工程、查询分页历史、查看差异及确认后载入；保留原有本地草稿与本地版本功能。导入 JSON、恢复草稿、载入本地历史均撤销旧服务端基线，服务端载入先停止并等待本地自动保存会话结束。

新增 9 项 Mock 测试候选；**尚未执行本批仓库真实 TS6 / Vite+ / 单测 / ready 与浏览器 E2E，不能把第七小批 520/520 验收当作本批通过**。真实 OIDC/JWKS、HTTPS Cookie/同源代理仍待联调，默认模块不暴露受保护路由，也没有工业写入或正式发布。PR #55 继续 Draft，不合并。

### 2026-11-16 · 第八小批首次 Windows 检查与 E-016 修复候选

`vp check --fix` 在新增 `studio-session.test.ts` 中发现 `typescript(unbound-method)` **19 条警告**（163 个受检文件零错误），第八小批质量门禁尚未通过。根因是 Mock 夹具被显式声明为 `ScadaApiClient` 后丢失各字段 Vitest Mock 类型。已准备最小测试夹具修复：使用 `satisfies ScadaApiClient` 保留方法 Mock 属性类型，去除 6 次冗余 `vi.mocked` 包裹，保留全部 9 项安全测试与 29 处断言。需维护者 Windows 重跑 `vp check`、单测、`ready`，成功后方可将 E-016 关闭。本次未改动 React/Vue、服务端权限或 IndexedDB 草稿逻辑，真实 OIDC/HTTPS 浏览器集成仍待验收，PR #55 保持 Draft。

### 2026-11-16 · 第八小批 E-016 关闭、第九小批本机 HTTPS 联调准备

维护者 Windows 已通过第八小批 vp check（305 格式文件、163 受检零警告）、529/529 单测（新增 CAS 9/9）、40/40 NestJS E2E、SSE 8/8、故障代理 4/4，React/Vue 双分辨率各 19/19 浏览器回归及历史安全回归；全部构建、83 Markdown、完整 ready 退出码 0。E-016 已关闭；尚未进行真正的 IdP/HTTPS 浏览器写入验收。

第九小批准备共享的本机 Vite HTTPS 代理：默认关闭，开启时要求可信 OIDC、回环 Web/Nest、精确 React/Vue HTTPS Origin 和固定回调，代理 /api/v1 到回环 NestJS。协作容器 Node 22 的配置安全测试 10/10 通过，真实 Windows 全链和实际 TLS/IdP 仍待维护者执行。默认 AppModule 不开放未认证工程 API，工业设备写入仍禁止。PR #55 保持 Draft。

### 2026-11-16 · 第九小批 Windows 验收归档与第十小批真实 HTTPS 前置检查

维护者 Windows 复验第九小批：HTTPS 本机代理配置测试 10/10、`vp check` 308 文件格式/166 受检零警告、单元测试 529/529、NestJS HTTP E2E 40/40、SSE 客户端 8/8、故障代理 4/4、83 个 Markdown 与 React/Vue/NestJS 全部构建成功，完整 `pnpm run ready` 退出码 0。日志未包含本地 Git HEAD 的独立证据。

第十小批仅新增本机 HTTPS **匿名只读** `/api/v1/auth/me` 诊断脚本和九项安全测试。离线测试属于默认 `ready`，实际 TLS 网络探针保持单独显式命令；不得将配置单测或匿名 401 响应解释为已完成 OIDC IdP、Cookie/CSRF 或服务端工程保存联调。无需改动 React/Vue Studio、NestJS Guard、Prisma、数据库迁移或共享 API Client。真实本机 TLS、IdP/JWKS、隔离测试租户与跨框架服务端往返仍待维护者单独验收。PR #55 保持 Draft，Assignee 继续指派 `@adui-dev`，未获授权不合并。

### 2026-11-16 · 第十小批 Windows 工程质量通过，真实 HTTPS 专项继续受阻

维护者上传的 Windows 日志确认：HTTPS 匿名只读离线测试 9/9、`vp check` 310 格式文件/168 受检零警告、`docs:check` 83、全量单测 529/529、OIDC 代理配置 10/10、HTTP E2E 40/40、SSE 8/8、故障代理 4/4 及 React/Vue/NestJS 构建均通过，完整 `ready` 退出码 0。随后真实 `verify:oidc:https:readonly` **退出码 1**，仅输出通用联调失败消息；不将之判定为 TLS 或 OIDC 实际通过。维护者本地 `.env`、启动服务和证书状态未随日志提供，失败根因待排查。

针对反馈，脚本已增强脱敏失败分类并增加两项安全测试；Node.js 22 候选验证 11/11，通过但需要新提交后的 Windows `vp check`、`ready` 及真实探针专项复验。保持 OIDC 和 HTTPS 开关默认关闭，不创建伪造 IdP 或匿名工程写入，不访问生产数据库，PR #55 仍 Draft。

### 2026-11-16 · OIDC Lab 一键依赖栈与复制即用的根环境模板

在 PR #55 功能分支中为本机联调新增独立 `deploy/docker/compose.oidc.lab.yaml`，以单一 Compose 项目管理本机 PostgreSQL、Redis、Keycloak；新增 `scripts/prepare-oidc-lab.mjs`，自动生成并复用不会入库的随机凭据与 mkcert 回环 HTTPS 证书，默认不改写根 `.env` 和现有数据库。根 `.env.example` 增加三个 Lab 端口并维持 OIDC/HTTPS 默认关闭，因此直接复制可用于原有普通 HTTP 开发；真实 OIDC 需要可信 Client、预绑定身份和隔离测试数据库才能另行启用。

已在隔离 Node.js 22 环境完成脚本语法、六项准备脚本离线安全测试及 Compose YAML/Realm JSON 静态解析；**Windows Docker 启动、Keycloak Discovery、PostgreSQL 实例、Redis 实例、React/Vue HTTPS/真实登录与生产单镜像交付尚未实测**。保留 PR #55 Draft，Assignee `@adui-dev`；不触及 Prisma 历史迁移或生产数据。

### 2026-11-16 · OIDC Lab 联调真实启动被 E-018 阻断

维护者 Windows 已通过 Keycloak OIDC Discovery HTTP 200、隔离 `adui_scada_oidc_lab` 四项 Prisma 迁移及 React HTTPS 15173 启动，首次真实启用 OIDC 根模块发现 `ProjectApiModule` 内 `ScadaSessionGuard` 的审计服务跨模块注入失败，NestJS 无法监听 13001，Vite 代理报 `ECONNREFUSED`，匿名 401 探针失败。修复候选仅向身份模块导出审计、OIDC 配置及共享数据库模块，增加真实根模块的 Mock 数据库 E2E，维持原 Guard、CSRF、ACL 与默认关闭策略。Windows 新提交的工程质量链和真实 NestJS 启动待验收。此前粘贴的本机秘密需受控轮换，不得写入仓库。

### 2026-11-16 · 第十二小批 E-018 真实 Windows 复验关闭

维护者 Windows 已验证：`test:e2e:server` 6 文件/42 项、`vp check` 315 格式/171 受检零告警；完整 `ready` 48 文件/530 单测、HTTP E2E 42、OIDC 代理 10、OIDC Lab 6、HTTPS 匿名离线 11、SSE 8、TCP 故障 4、83 Markdown 与双 Web/服务端构建均通过。真实 `OidcEnabledAppModule`、`ProjectApiModule`、`ScadaIdentityModule` 初始化成功，NestJS `127.0.0.1:13001` 实际监听；React/Vue 两端 HTTPS 同源 `/api/v1/auth/me` 匿名探针均为受控 401 JSON，退出码 **0**，**E-018 关闭**。原日志未独立打印本地 HEAD 和完整 `ready` 的数字退出码，依其连续执行和失败即停止分支确认本次质量链已完成。

当前已具备真实 Keycloak OIDC 登录的网络前置条件，但服务端发出的 302 不等于真实用户成功登录；身份预绑定、Secure Cookie/CSRF 及双框架服务端工程历史/CAS 往返仍未验收。此前在对话暴露的本地 Lab 随机密钥需要受控轮换并同步配置，禁止在 PR/文档/日志中出现原值。PR #55 继续 Draft，未获授权不合并。

### 2026-11-16 · 第十三小批 OIDC Lab 身份预绑定最小实现

此前 Keycloak OIDC Discovery、NestJS 根模块及双框架匿名 HTTPS 401 已由维护者 Windows 实测（E-017/E-018 已关闭）。为开启真正的普通用户登录联调，在原 PR #55 中新增本机隔离 Lab 的**显式预绑定**工具：Keycloak 用户由人工创建并核对 UUID，工具默认只读、在严格回环数据库和 Issuer 校验通过后，仅经 `--apply --confirm-lab adui_scada_oidc_lab` 才创建 active 本地主体和一条外部映射。会阻止已有权限主体被错误绑定，不自动授予工程 ACL、创建工程或开放写接口，亦不改变现有 Prisma Schema/迁移。

新增 14 项离线测试，使用隔离 V8 运行环境对原候选逻辑及 Mock PG 事务验证 **14/14**，但并非本机完整 Node/Vite+ 检查，Windows `ready`、真实隔离数据库写入、Keycloak 用户授权码回调、Secure Cookie/CSRF 与跨框架工程往返均待专门验收。此前粘贴的本机 Lab 测试密钥需后续安全轮换，不保存在仓库文档。

### 2026-11-16 · 单 Compose 本机统一栈候选

维护者 Chrome 已验证 React/Vue 共享同一 SCADA OIDC 本地身份 `lab-tenant/lab-engineer`，Docker Desktop 当前有 3 个项目组。第十三小批后续新增统一本机 `adui-scada` Compose 项目候选，包含 Demo 4 服务、OIDC Lab 3 服务及旧开发 PostgreSQL 1 服务（旧数据库单独 profile），继续绑定原 Keycloak/SCADA/Redis 三份数据卷，不自动迁移或清库、不更改原 `.env` 的数据库凭据，也不把 HTTP Demo 当成真正的 OIDC HTTPS 部署。

新增显式预检/迁移/启动/关闭命令与 13 项 Node.js Mock 回归测试。当前协作环境 Node.js 22 的候选测试 13/13 通过，Python YAML 结构和回环端口校验通过；协作容器**没有 Docker CLI**，真实 `docker compose config`、老项目切换、新容器健康、Keycloak 现有主体与双框架认证仍待 Windows 验收。正式单应用镜像打包属于后续独立工作。

### 2026-11-16 · 统一本机 Docker 最终收敛为一个 PostgreSQL

维护者明确要求删除遗留开发数据库及重复 Docker 配置，只保留项目名 `adui-scada`。因此新版本仅保留 `deploy/docker/compose.yaml`，七个容器：React/Vue/NestJS Demo/模拟服务、单 PostgreSQL、Redis、Keycloak。旧开发库 `15432` 不再启动；现有 SCADA/Keycloak 数据所在的 PostgreSQL `15433` 继续挂原持久化卷，两套逻辑数据库保留原名避免重建或丢失 OIDC 预绑定。原物理卷名称虽然带历史 OIDC Lab 前缀，但 Docker Desktop 项目名将固定为 `adui-scada`，不再运行其他 Compose 项目。

旧 `compose.demo.yaml`、`compose.postgres.dev.yaml`、`compose.oidc.lab.yaml`、`compose.all.dev.yaml` 和对应多套命令清理。新 `docker:plan` / `docker:migrate` 白名单识别历史容器，显式迁移不会删除卷；日常使用 `docker:up` 等单一入口。候选 17/17 隔离 V8 Mock 逻辑检查通过，Windows 真实 `vp check`/`ready`、Docker Compose 配置解析、备份和容器切换仍待维护者实测。

### 2026-11-16 · Docker 单 Compose Windows 首次质量验收受文档规则阻断

维护者的唯一 `adui-scada` 七服务、单 PostgreSQL 方案已完成 Windows `test:docker` 17/17、`env:check`、`vp check` 318/175 零告警、530/530 单测及 NestJS 42/42 E2E。首次 `docs:check` 在 ADR-0066 上发现状态行带额外括号说明，违反严格枚举；完整 `ready` 因此中断，不能记为通过。按 E-019 将 ADR 状态改成单独 `Proposed` 并分离验收说明；修复后 Windows `docs:check` / `ready` 和真实 Docker 迁移继续待验收，旧数据库及 Keycloak 数据卷未执行删除。

### 2026-11-16 · 维护者删除旧三个 Docker 项目及旧数据卷，改用全新安装

维护者确认旧的 Demo、旧开发 PostgreSQL、OIDC Lab 三组容器已全部删除，随后明确连其数据卷也删除且未留数据库备份。新方案因此不再保留“复用旧卷/迁移旧数据库”的假设：仅一份 `adui-scada` Compose，七服务、一个 PostgreSQL 容器；业务库与用户固定 `adui_scada`，Keycloak 逻辑库 `adui_scada_keycloak`；数据存储在新项目的两个持久化卷。根 `.env.example` 重新整理，默认不开启 OIDC，首次 `docker:up` 使用本机安全随机凭据、证书并运行 Prisma `migrate deploy`，无需旧卷。旧 Keycloak 用户、身份预绑定与项目历史**没有恢复**，后续需重新创建和验收。Windows Docker 实际执行尚待验收。

### 2026-11-16 · 单 Docker 新安装 PostgreSQL 端口收敛为 15432

维护者在已确认旧三个项目及数据卷均删除、无备份后，进一步要求 **PostgreSQL 端口统一为 15432**。最新 `adui-scada` 单 Compose 的 PostgreSQL 服务仍映射容器内 `5432`，宿主机端口改为 `127.0.0.1:15432`；根环境模板、默认检查、初始化、OIDC 身份绑定用例与端口拒绝测试按此同步。数据库名、用户 `adui_scada`，Keycloak 独立逻辑库 `adui_scada_keycloak`、数据卷及安全策略不变。此前旧 Lab `15433` 仅属于历史实施记录。Windows 实际 `ready`、新容器与 Prisma 迁移尚待验收。

### 2026-11-16 · 唯一 Docker PostgreSQL 四项迁移成功，status 需匹配随机密码

最新 `adui-scada` 单项目容器已由维护者启动。Windows 实测 `docker:db:init` 在业务库 `adui_scada`（回环 15432）成功部署 4 项 Prisma 迁移，退出码 0；容器内 PostgreSQL `pg_isready` 与 `SELECT 1` 均成功。通用 `db:migrate:status` 仍使用根目录 `.env` 里的旧固定密码，因与 `.local/docker/secrets.env` 中新 Docker 随机密码不同而报 P1000。新增 Docker 专用 `docker:db:status`，通过同一安全脚本调用只读 Prisma 状态查询，禁止回显/提交密码，不修改数据库、卷或通用命令；Windows 真实新命令与全量质量链待复验。宿主机 OIDC Client Secret、事务加密密钥和证书路径也需针对新 Keycloak 在本机安全同步并重新验收。

### 2026-11-16 · Docker 数据库状态真实验收成功、ready 在中文日志门禁被阻断（E-022）

维护者本机 `test:docker:db` 已 9/9 通过，`docker:db:status` 对 15432 端口的 `adui_scada` 业务库真实返回最新迁移状态（共 4 项），`vp check` 320/177 零警告，`docs:check` 84 个 Markdown 通过；但本轮 `ready` 在 `messages:check` 发现 `scripts/init-docker-db.mjs` 内包含英文 `"status"` 的单行 `console.log`，未进入本轮后续单元测试、E2E 或构建。E-022 最小修复只拆分分支计算与中文结果输出，复验后方可宣称完整 `ready` 通过。OIDC 全新 Keycloak 用户绑定与真正 HTTPS 认证尚未完成验收。

### 2026-11-16 · 第三十三批主业务闭环通过，继续 HTTP 安全收尾

维护者已提供 E-022 修复后完整 `ready` 退出码 0 的 Windows 日志，且实际通过新 Keycloak 用户身份绑定、React/Vue 双 HTTPS 认证、Cookie 安全属性、CSRF 拒绝和跨端注销浏览器检查；服务端工程创建/历史版本/CAS 409/IndexedDB 草稿保护六项也由维护者确认通过。详细实测与候选补测边界记录于 `docs/VALIDATION.md`。

下一小批不修改 Guard 或数据库，仅向既有 NestJS OIDC HTTP E2E 增加跨 Origin、异常 Fetch Metadata、Bearer/Cookie 混用拒绝回归。候选必须先经 Windows `test:e2e:server`、`vp check`、`docs:check` 和 `ready` 复验；真实旧 Session 凭据持久化撤销、跨租户 ACL、过期及工业生产安全另行专项验收。

### 2026-11-16 · 第三十三批 HTTP 安全回归 Windows 通过，数据库会话断言待复验

维护者原始日志确认：`test:e2e:server` 45/45、`vp check` 320/177 零警告、`docs:check` 84 Markdown、完整 `ready` 530/530 单测与 45/45 HTTP E2E，React/Vue/NestJS 构建成功，最终退出码 0。已追加 PR #55 验收记录。原有真实 PostgreSQL 测试涵盖跨租户 ACL、并发 CAS、Session 撤销和到期拒绝；本轮只增补已存在用例中的 Cookie 旧凭据重放、CSRF 摘要、撤销持久化和主体停用覆盖。**新增真实数据库断言待 Windows 在专用 `adui_scada_test` 复验，绝不运行在开发业务库或生产库。**

### 2026-11-16 · 第三十三批隔离 PostgreSQL 与全量质量链复验完成

维护者已在 Windows 上创建独立 `adui_scada_test`（回环 15432），四项 Prisma 迁移首次应用全部成功，`migrate status` 为最新；`pnpm run test:db` **3/3 文件、22/22 项通过**，包括真实 PostgreSQL 下的 Session/CSRF 摘要、撤销时间持久化、旧 Bearer/Cookie 失效、主体停用/过期拒绝、跨租户 ACL 及并发 CAS。随后单独 `vp check` 320/177 零告警、`docs:check` 84 Markdown，通过完整 `ready` 的 530/530 单测、45/45 HTTP E2E、两套 Web 与 NestJS 构建；末尾退出码检查未触发异常，未额外显示 `ready` 数字退出码。**本机 V0.3 第三十三批主闭环与受控回归完成，生产安全/密钥轮换另行验收。** PR #55 仍应保持 Draft、Assignee `@adui-dev`，未经批准不得合并。

### 2026-11-16 · 第三十三批最终 Review P1/P2 最小修复待复验

在已有主业务与安全验收后，PR #55 审查发现匿名 OIDC 登录事务会持续累积，以及有效保存请求在追加快照元数据后可能超过 2 MiB 并返回 500。已补服务进程内速率/并发兜底、每 30 秒限量回收已过期事务、最终快照明确容量错误映射 400，并追加单元和 HTTP E2E 用例；不修改已应用迁移和工业设备接口。**本批补丁尚待 Windows Vite+ / 全量质量链 / 隔离 PostgreSQL 验收；多实例统一网关限流属生产上线前置条件。**

补充真实 PostgreSQL 回收专项：在已有隔离 `adui_scada_test` 数据库测试中新增 1 项，对到期与有效 OIDC 登录事务进行真实创建、分批清理及状态核验，并在 `finally` 清理测试行；必须由维护者在 Windows 重新执行 `test:db`，且确认环境只指向隔离库。

### 2026-11-16 · 第三十三批合并完成，第三十四批工程分页候选

PR #55 已由维护者授权 Squash 合并至 `main`，合并提交 `412a5475fd206e43e1f862b3c4d5a37cdd0e9d40` 已通过 GitHub 核验。维护者此前 Windows 运行完整 `ready`：534/534 单测、47/47 HTTP E2E、退出码 0；隔离 `adui_scada_test` 真库 `test:db` 23/23、退出码 0。这些结果仅属于**第三十三批已合并代码**，不代表本批代码通过。

第三十四批第一小批新增按工程 ID 的有界列表、Core 共享查询类型、API Client 参数和响应验证，以及 Mock 单元/HTTP E2E/隔离 PostgreSQL 游标测试。原租户 ACL、OIDC 默认关闭、Vue/React 工程格式、浏览器草稿与工业只读边界保持不变。**候选尚未在 Windows 执行 Vite+、单测、真库与完整 ready**。参见 [ADR-0067](adr/0067-bounded-project-list-pagination.md)。

### 2026-11-16 · 第三十四批第一小批正式合并，第二小批 Studio 工程管理候选

PR #56 经维护者授权已 Squash 合并到 `main`，提交 `30aa9908fdd43953df6ce1306cdadc2ac4f5c073`。前一小批维护者 Windows `ready` 537/537 单测、49/49 HTTP E2E、退出码 0，受控隔离 `test:db` 23/23、退出码 0；不把这些结果当作第二小批的验收。

本小批创建新的工程浏览 UI，Vue/React 共用 `StudioProjectBrowser` 分页游标会话；用户显式选择服务端最新版本时复用现有 SHA-256、身份和 CAS 验证，暂停自动保存，保持 IndexedDB 草稿不变；服务端未启用、未登录或无权时失败关闭，绝不静默打开工程。Vue 工程切换后同步重订阅正确的草稿来源。当前只是 GitHub 功能分支**候选代码**，真实 Windows `vp check`、`ready`、双端浏览器/UI 互通还没有执行。未修改工业网关、Prisma Schema 或设备写入权限。

### 2026-11-16 · 第三十四批第二小批合并、第三小批 OIDC 浏览器专项候选

PR #57 经维护者人工验收和单独合并授权，以 Squash Commit `c426d26855d3d707a75869f8c770b65e8b55c82f` 合并 `main`。维护者上一小批 Windows 质量链 `ready` 544/544 单测、49/49 HTTP E2E、86 Markdown，双端 76/76 通用浏览器检查与草稿版本安全专项均通过；这些只是第三十四批第二小批已合并代码的证据。

第三小批候选专注新增交互式真实 OIDC 工程浏览器验收工具和离线环境白名单测试，不改变 Vue/React 业务组件、Core Schema、NestJS、Prisma 或工业接口。维护者必须先准备隔离 Lab 的普通预绑定测试身份、已有获授权工程和可信 HTTPS，再运行真实浏览器。脚本不发服务端工程写请求，取消/模拟冲突路径比较临时浏览器画布与草稿摘要，确认打开则检查可见 CAS 基线与停写保护；不把模拟冲突描述为实数据库并发验收。**所有新脚本及当前 HEAD 质量验证待维护者 Windows 实测，不得宣称通过**。

### 2026-11-16 · 第三十四批第三小批真实 OIDC 登录后脚本失败、E-024 候选修复

维护者已通过 Windows 全量 `ready`：544/544 单元测试、49/49 HTTP E2E、7/7 新 OIDC 离线配置用例及 React/Vue/NestJS 构建，退出码 0。但首次 `test:projects:oidc:browser` 实测仅证明 React Origin 的真实 Keycloak / BFF 登录成功，随后被不透明的 CDP 页面异常阻断，退出码 1；浏览器按安全清理流程关闭，不代表 Vue 或工程 CAS 实际完成。新补丁只改测试脚本的分阶段脱敏诊断、受控 HTTP 状态和离线回归测试，明确 `project:read` / `version:read` 验收前提；尚未执行最新 HEAD 质量链或真实双端 OIDC 浏览器复验。PR #58 继续保持 Draft，不能因登录成功而合并。

### 2026-11-16 · 第三十四批第三小批 E-025：真实 OIDC 浏览器草稿快照跨上下文异常

维护者已实测新诊断版本：`test:projects:oidc:config` 10/10、Windows `vp check` 328/183 零告警、完整 `ready` 544/544 单测、49/49 HTTP E2E 和两 Web/NestJS 构建退出码 0。Keycloak / React BFF 会话和工程管理授权摘要与分页已运行到草稿阶段，随后 CDP 页面脚本出现 `ReferenceError`，浏览器专项退出码 1、Vue 尚未测试。确认是 `stateInPage` 序列化后引用 Node 模块的 `readBrowserDraftsInPage`，重现旧 E-002 错误；已按 E-025 拆分独立页面调用并补离线回归，**新分支 HEAD 的完整质量链与真实浏览器验收仍待维护者 Windows 复验**。PR #58 保持 Draft，未获合并授权。

### 2026-11-16 · 第三十四批第三小批 E-026：冲突后的真实确认载入测试时序候选修复

维护者已再次通过 Windows 完整质量链（544 单测、49 HTTP E2E、11 项浏览器离线检查，`ready` 退出码 0）。真实 Keycloak、React 工程列表、分页、草稿保存、取消与模拟冲突均执行至确认载入阶段，但旧冲突提示可能被原浏览器脚本立即当作新请求失败，专项退出码 1，Vue 仍未验证。最小补丁仅为浏览器测试增加新操作开始的可观察条件，并补“旧错误残留后成功 / 真正新错误仍失败”两项正反用例（预计离线 13 项）。不修改生产业务代码和隔离 Lab 数据。**新的 Windows 质量链与真实双端浏览器成功证据仍待验收**，PR #58 继续 Draft / 未合并。

### 2026-11-17 · 第三十四批第四小批：真实多页与独立 Prisma 连接 CAS

第三十四批第三小批 PR #58 已经维护者授权 Squash 合并至 `main@d95ee4d1`。完整 Windows `ready` 已通过（544/544 单测、49/49 HTTP E2E、13/13 专项离线、退出码 0）；真实 OIDC 浏览器 React/Vue 双端确认打开与模拟水位冲突专项也已通过，但实际授权工程少于 11 项，没有覆盖有数据的第二页与真实 PostgreSQL 双主体竞争。

第四小批在现有独立 `test:db` 里补真实 PostgreSQL 的 12 项工程分页/ACL 与两套 Prisma 连接双主体同水位 CAS 冲突测试；另给真实 OIDC 浏览器增加显式 `--require-multipage` 严格验收入口，不自动创建、授权或覆盖运行中 Lab 的任何工程。**本批没有修改 SCADA 业务接口、前端组件、Schema、迁移、工业设备协议或设备写入权限**。新测试均未在 Windows 实际运行；PR 应保持 Draft，独立真库写测试只允许显式指定的本机 `adui_scada_test`，严格浏览器模式需受控准备至少 11 项现有授权工程，否则必须报告未通过。

## 2026-11-17 · 第三十四批第四小批：严格多页 Lab 数据准备候选

维护者 Windows 真实 PostgreSQL `adui_scada_test` 迁移状态最新，`test:db` **25/25 通过**、退出码 0。严格 OIDC 浏览器多页专项已触发真实 React 登录/工程列表，但第二页数据条件尚未覆盖，退出码 1，未进入 Vue；不把它冒充两端多页通过。

维护者现已明确授权为本机可信 OIDC Lab 准备严格多页所需的测试工程。PR #59 原有隔离浏览器工具增加**单独显式命令** `oidc:lab:projects:pages`，要求确认 `adui_scada` 本机 Lab、真实 Keycloak 普通测试账号登录与合法 CSRF，通过正式工程 API 只补齐当前账号的可读工程至 11 项，后端事务自动创建首版、三项权限和审计。使用无 Tag/图元的空白组态，不复制现有内容、不直接写数据库表、不中断服务、不清理卷。正常浏览器验收仍保持只读，准备命令不会纳入 `ready`。**代码候选已更新，尚未在维护者本机执行数据准备、完整 Windows 检查或再次运行严格双端浏览器专项**；PR 继续 Draft，合并仍须明确授权。

## 2026-11-17 · 第三十四批第五小批：真实 HTTP 双 BFF Cookie 会话 CAS 专项（待验收）

第四小批 PR #59 已合并至 `main@4c3cb0d7`，真实 PostgreSQL 25/25 与 React/Vue 严格多页（本机预绑定普通 Keycloak 用户、11 项授权工程）均由维护者 Windows 退出码 0 验证。为关闭仓储层竞争与 HTTP 409 映射之间的缺口，新分支只增加真实数据库 HTTP 集成测试，使用两个不同可信主体和独立 BFF Cookie/CSRF，会话持久化、Guard、ACL、控制器、Prisma 事务、审计全走真实业务实现。四项新用例预计将独立数据库测试总数提升到 29；只触碰本机显式隔离测试库内随机租户并定向清理，不变更业务代码、前端工程、数据库迁移或生产控制权限。

**测试本身不包含双 Keycloak 授权码登录**，也不验证企业 IdP、生产 TLS 或多进程部署。最新本地 `ready`、新增 HTTP CAS 的真实 PostgreSQL 结果与原第 34 批四小批准备工具的 18/18 离线回归仍待 Windows 证据，PR 将保持 Draft 直至人工验收及明确合并授权。

## 2026-11-17 · 第三十四批第五小批：Windows 双 BFF Cookie HTTP CAS 验收完成

维护者 Windows 实测候选：新增真实双 Cookie HTTP CAS 专项 **4/4**，全部隔离 PostgreSQL 回归 **29/29**、退出码 0；离线 OIDC 浏览器保护 **18/18**、`vp check` **329 个格式文件 / 184 个受检文件零告警**、完整 `pnpm run ready` **544/544 单元测试、49/49 服务端 E2E**、React/Vue/NestJS 构建成功、退出码 0。HTTP 竞争场景验证两份真实服务端签发并存储的 Cookie/CSRF 会话只产生一个 HTTP 201 与一个 HTTP 409，数据库修订号、历史与审计一致；并非两次真实 Keycloak 授权码登录。

此前数值数组未带比较器导致的 Vite+ 1 条 Lint 警告，已最小修复并在复验日志中关闭，记录 E-027。PR #60 仍保持 Draft、Assignee `@adui-dev`，未获本次合并授权。Windows 日志未附 `git rev-parse HEAD`，新补的文档提交须再跑 `docs:check`；不需要再次运行会写入随机测试租户的数据库专项来验证纯文档变化，除非代码 HEAD 又发生改变。

## 2026-11-17 · 第三十四批第六小批：真实双 Keycloak 主体 HTTP CAS 候选（待验收）

以已合并 PR #60 的 `main@e7c345b8` 为基线，新增两个独立浏览器 Profile 的真实 Keycloak 双主体登录与受控 HTTP CAS 专项。已有第一位普通预绑定用户，**第二位同租户不同本地主体是否已在 Lab 中预绑定尚未确认**；工具不能创建 Keycloak 身份，不模拟第二用户。默认预检只核对两次真实 BFF 会话；需维护者显式执行 `test:oidc:dual:cas` 才通过正式 API 创建新专用空白工程，并仅给第二主体授予这一新工程的三项 ACL；两个浏览器从 React/Vue Origin 同时提交相同修订号，核对 201/409、最终快照、PostgreSQL 水位/审计。新工程保留、不删除、不触碰现有 11 项分页测试工程。

本批暂只有候选 GitHub 代码及有限语法/Mock 静态核对，真实两个 Keycloak 用户登录、Windows 质量链、隔离 Lab 写入验证均待维护者执行；不修改生产业务、工程 Schema、Prisma 迁移、工业协议或设备写入权限。PR 必须保持 Draft 并指派 `@adui-dev`，未获明确授权不得合并。

## 2026-11-17 · 第三十四批第六小批：Windows 全量质量链已过，真实双主体身份待核对

维护者 Windows 日志确认候选：`test:oidc:dual:config` 11/11、`vp check` 331 个格式文件 / 186 个受检文件零警告、`docs:check` 86 份、完整 `ready` 单测 544/544、NestJS HTTP E2E 49/49、React/Vue/Server 构建成功及退出码 0。E-028 三个模块级未使用变量已经移除且该代码候选获得零告警复验。

真实 OIDC 双人预检与显式 CAS 测试在两个浏览器登录后均因本机可信身份不满足“同租户、不同主体”而**退出码 1**。原有断言把“重复本地主体”和“跨租户”混合为一条错误，因此尚不清楚真实 Lab 的具体冲突原因。失败发生在工程创建及第二主体 ACL 授权前，不能将本轮记为 CAS 201/409 通过。为改进真实诊断，PR #61 在不改身份逻辑前提下细分两种中文脱敏失败信息和离线断言，记录为 E-029；**最新诊断与文档提交仍待 Windows `vp check` / `ready` / 真实双人预检复验**。PR 保持 Draft 并指派 `@adui-dev`，不在身份未核实时写业务工程或扩大权限。

## 2026-11-17 · 第三十四批第六小批真实双 Keycloak 主体 CAS 已完成本机验收

维护者先用 Keycloak `adui`、`test` 两个不同普通账号分别在独立隔离浏览器登录，本机 OIDC Lab 的 `test:oidc:dual:preflight` 证明**同租户不同主体、退出码 0**；预检未创建工程或修改 ACL。随后执行 `test:oidc:dual:cas` **退出码 0**：新建一份 `b34-oidc-cas-<UUID>` 专用空白工程，仅将该工程的三项固定 ACL 授予第二主体，双方真实 BFF HTTP 并发提交同一修订号得到**201＋409**，最终修订号 2，版本、内容摘要及审计主体核对通过；测试工程与审计按设计保留。至此，第五小批的内部签发双 Cookie HTTP 真库 CAS 与第六小批的**真实双 Keycloak 用户授权码登录 CAS**都有独立成功证据。

**尚待结束项**：用户这次的日志没有本地 HEAD SHA，也没有包含 E-029 诊断与本文档新提交之后的完整 `ready`、`vp check`、`docs:check` 结果。PR #61 仍为 Draft / 未合并，且需维护者明确合并授权；不应将该专项扩大解释为多实例或生产现场验收。

## 2026-11-17 · 第三十四批第七小批：会话注销与工程 ACL 即时撤销候选

第六小批 PR #61 已由维护者明确授权 Squash 合并至 `main@669c9ff3bb2d6194890cbc5049b58803ca775c5e`。维护者 Windows 已实测第六小批完整 `ready` **544/544 单测、49/49 服务端 E2E、退出码 0**，真实不同 Keycloak 用户在两个独立浏览器通过 HTTP CAS **201 + 409**，修订号 2 与审计一致；原始日志未附本地 SHA 对照，这一限制已在合并提交保留。

第七小批只补两项**独立真实 PostgreSQL HTTP** 回归：注销主体 A 的当前 BFF Cookie 会话后旧凭据立即拒绝但主体 B 仍能成功保存；撤销主体 B 在唯一测试工程上的全部 ACL 后原身份仍有效但不可发现、查看历史或追加该工程，主体 A 不受影响。复用现有随机租户夹具及定向清理，不实现对外用户/ACL 管理接口，不对真实 Lab 两位用户及历史工程做任何写入，不修改前端、Core、Prisma Schema、迁移或工业控制权限。本批预期独立 `test:db` **31/31**，**尚未执行 Windows 实测**，完整质量链和真实数据库专项必须经维护者验证后才能申请合并。新 PR 保持 Draft 并立即指派 `@adui-dev`。

## 2026-11-17 · 第三十四批第八小批：React/Vue 共享服务端授权失效状态（候选）

PR #62 经维护者授权已 Squash 合并至 `main@d743e17df42fda97a1cd9bce8676ad75b5ed37c9`；第七小批的独立本机 PostgreSQL 真库已实际通过 **31/31**，以及 Windows `vp check`、`docs:check`、完整 `ready` 的 544/544 单测和 49/49 HTTP E2E。第八小批聚焦下一次真实服务端请求收到 401/403/404 时对过时授权信息的前端保护：共享 API Client 失效 CAS 基线并阻断被撤权工程自动创建、重复保存；React/Vue 同构清空服务端历史摘要和授权工程分页缓存、保留 IndexedDB 草稿及当前画布。只有显式重新确认合法服务端版本载入才恢复 CAS；网络中断不误判权限撤销。

本批无 Prisma 迁移、OIDC 后端或工业控制写入变更；新增 6 项共享单测，预计普通单测 **550 项**，**尚未在维护者 Windows 运行 `vp check`、`ready` 或真实浏览器回归**。因没有在 OIDC Lab 做破坏性 ACL 变更，不能把前端“撤权 UI”称作真实多用户 E2E 已验收。新分支提交 Draft PR、必须指派 `@adui-dev`，未经单独授权不得合并。

## 2026-11-17 · 第三十四批第九小批：浏览器模拟访问拒绝候选

PR #63 已由维护者授权 Squash 合并为 `main@6f09e1930fe55f567245708bf5eb80edacd7b42a`。此前双端已通过真实 Keycloak 正常授权 OIDC 浏览器专项，完整 `ready` 550/550 单测、49/49 服务端 E2E、退出码 0。第九小批复用同一浏览器/CDP 测试框架新增独立 `test:projects:oidc:denial`：在临时 Profile 安装对工程写请求的永久拒绝，并对三个固定只读 API 路径模拟 401/403/404，分别验证 React/Vue 的旧 CAS/工程摘要清理、本地 SVG 与 IndexedDB 草稿保护及 404 后重复保存无误创建。普通 OIDC 浏览器命令和真实用户/ACL/数据库保持不变。

新增 3 项离线安全测试，预期相关 Node 专项 21 项；**尚未在维护者 Windows 执行真实浏览器、完整 ready 或 vp check**，不能提前标记通过。本批是对客户端拒绝处理的真实 UI + 模拟 HTTP 测试，不是从 Keycloak 撤销实际权限的完整 E2E。后续需在独立临时权限夹具和受控事务下补全真实 ACL revoke 浏览器专项，不能直接删改 Lab 用户的历史工程权限。

## 2026-11-17 · 第三十四批第十小批：真实双 Keycloak ACL 撤销浏览器候选

第三十四批第九小批 PR #64 已按维护者明确授权 Squash 合并到 `main@d59df5e9ef2d702954f6b20173990abe53dffc3a`，维护者 Windows 实际通过离线 21/21、550/550 单测、49/49 E2E，以及真实 Keycloak 登录＋React/Vue 浏览器模拟 401/403/404、CAS/草稿保护（专项退出码 0）。第十小批为该模拟验证补充**真正的本机 PostgreSQL ACL 撤销及 React/Vue UI 端到端证据**。

候选分支只新增独立双主体登录与专用工程撤权脚本、8 项 Node 离线安全测试和根脚本，并复用暴露原有浏览器 CDP/Studio 辅助函数，无产品前端或 NestJS/Prisma 变更。写入模式必须显式确认本机 `adui_scada` Lab，每框架新建一份 UUID 空白工程；严格串行化事务核对首版、创建者和 ACL 后定向撤销第二主体三项授权，UI 及 API 检查真实 404、CAS 状态和草稿保护，异常清理只针对新项目。旧用户/工程/ACL 和生产工业设备数据保持不变；不自动清除新测试工程审计。

候选**尚无 Windows `vp check`、完整 `ready` 或真实权限撤销浏览器输出**。协作端有限 V8 模拟复核修正新测试 Mock 的 SQL 分支顺序后 8/8 通过，不能当成真实 Node/PG/Chrome 成功。下一步维护者需先运行只读预检并核对实际数据库连接，再单独执行显式写入浏览器专项；PR 仅 Draft，立即指派实际 GitHub 账户 `@adui-dev`，未经明确授权不得合并。

## 2026-11-17 · 第三十四批第十一小批：切回标签页时复核已确认 CAS 基线（候选）

第十小批 PR #65 已按维护者授权 Squash 合并到 `main@e809d306743bd20508630c1809d6993b755f1874`。维护者 Windows 已真实完成 React/Vue 两份新专用空白工程的 PostgreSQL ACL 撤销、HTTP 404、CAS 状态/草稿保护及首版审计（浏览器专项退出码 0），质量链单测 550/550、服务端 HTTP E2E 49/49。该实测不能替代本小批的重新可见事件验收。

本批只扩展共享 `StudioServerProjectSession.revalidateBaseline`、React/Vue Studio 的 `visibilitychange` 可见事件监听、原有单元测试及只读 OIDC 浏览器模拟专项。已建立 CAS 基线的后台标签恢复时，按原始已加载的可信租户/主体与 revision 重新读取真实 BFF 身份与工程摘要：401/403/404、主体换号会失效旧基线并保留误创建阻断，远端水位变化清空旧 CAS、普通网络失败保留原基线，不覆盖 SVG 或 IndexedDB 草稿，旧请求异步返回不能清空新加载基线。未建立基线、正在保存或卸载的组件不强制发起请求。

新增 8 项共享单测和 3 项 OIDC 浏览器离线安全测试，预计常规单测 **558 项**、浏览器离线 **24 项**，真实交互专项 `test:projects:oidc:resume` 尚待维护者 Windows 验证。此模式是**真实 BFF 登录＋模拟可见事件与 HTTP 拒绝**，不是后台推送或真正的其他标签注销 E2E；不动 Keycloak 用户、Lab ACL 和现有工程，不发送工业设备写入请求。新分支 PR 默认 Draft、立即指派实际 GitHub 账号 `@adui-dev`，未经维护者再授权不得合并。

## 2026-11-17 · 第三十四批第十一小批 React 检查修复与待复验

PR #66 仍为 Draft，维护者在 Windows `vp check --fix` 实测发现 React Studio 恢复监听中的 `react(immutability)` **1 条警告**与 TypeScript **TS2339 1 个错误**，188 个受检文件的格式化完成但完整检查失败。修复已提交至同一 PR 分支：`e5bddb6c98682130fc80841368466fa1aacccb51`，以 `AbortController` 替代 Effect cleanup 可变闭包标记，并提前缓存访问拒绝/CAS 冲突两种条件，保留 Vue/React 功能与共享状态机。已在协作容器 TypeScript 5.8.3 对等价收窄片段进行严格静态编译，未运行项目 TS6/Vite+。本批仍须 Windows 重新执行 `vp check`、完整质量链及双框架只读浏览器专项；**不应将格式化成功写成 Lint 或构建通过**，不得提前合并。错误复盘见 E-031。

## 2026-11-17 · 第三十四批第十一小批 Windows 验收结果

PR #66 的 React / Vue 标签页恢复只读复核已由维护者在 Windows 完成复验：`vp check` **333/188 零警告错误**；OIDC 浏览器离线 **24/24**；完整 `pnpm run ready` 中 Vue `vue-tsc --build`、React 类型检查、Vitest **558/558**、NestJS HTTP E2E **49/49**、React/Vue/Server 构建及文档检查 **86 个 Markdown** 均完成，质量链结束后未触发退出码断言。独立的 `test:projects:oidc:resume` 中 React/Vue 均通过模拟 401、404、修订水位变化三组页面重新可见场景，退出码 **0**；本地画布、IndexedDB 草稿和自动保存不变，浏览器内阻断真实工程写入，未修改 Lab ACL。

此前 React Compiler/TS2339、Vue TS2339 及浏览器准备阶段失败保留为历史错误记录，目前 Windows 已复验通过。**仍需确认本机 `git rev-parse HEAD` 与 PR 最新 HEAD 一致**；此次文档更新提交后需要按需重跑检查。该专项使用真实 Keycloak/BFF 登录但模拟标签页可见事件及受控 GET 失败，不能等同多物理标签真实注销或生产工业安全验证。PR #66 保持 Open/Draft、指派 `@adui-dev`，未经当前批次明确合并授权不合并。

## 2026-11-17 · 第三十四批第十二小批：迟到版本读取与新工程上下文隔离（候选）

前置 PR #66 已获维护者单独授权并 Squash 合并到 `main@19752e6219bffd3de9b672e89e95e6dabfb14535`；第十一小批 Windows `ready`、React/Vue 标签页恢复浏览器模拟专项已通过（真实测试退出码 0，详见 VALIDATION）。本小批进一步补齐共享 `readVersion` 的异步上下文边界：旧读请求在 `reset`、新的服务端确认载入或 CAS 推进后才结束时，原先旧 401/404 的统一拒绝处理可能污染新基线，旧正常响应也可能在新上下文被确认载入。

候选最小修改只涉及共享 `packages/api-client/src/studio-session.ts` 和 3 项单测，使用内存代次保护迟到只读结果；生产代码不依赖 React/Vue、未新增依赖、数据库、服务端写入或工业设备权限。初版预期 `test:unit` **561/561**（旧 558 + 新 3），实际结果须以 Windows TypeScript 6、Vite+、Vitest 与完整 `ready` 输出为准。浏览器真实旧请求竞态尚无专项 E2E；本次既不模拟真实撤权也不触碰 Lab ACL。Draft PR 默认指派 `@adui-dev`，未经单独授权不得合并。

## 2026-11-17 · 第三十四批第十二小批：Windows 全链验收通过，PR #67 待审查

维护者 Windows 已真实执行本批 `pnpm run test:unit`：**561/561** 通过，新增共享会话迟到 401/404/正常快照回归包含在 **25/25** 项内；独立 `vp check`：333 个文件格式正确、188 个受检文件零警告或错误；完整 `pnpm run ready`：React/Vue/共享包/NestJS TypeScript 检查、561/561 单测、SSE 8/8、故障代理 4/4、OIDC 浏览器安全规则 24/24、NestJS HTTP E2E 49/49、86 个 Markdown 检查和 React/Vue/NestJS 构建均成功，PowerShell **退出码 0**。

本批仅涉及共享 API Client 的 `readVersion` 内存代次保护和 3 项单元测试，未修改 React/Vue UI、数据库、服务端授权、OIDC Lab、工业控制设备写入。日志未提供 `git rev-parse HEAD`，新文档提交后的完整质量链也尚未复验；新增竞态真实浏览器专项仍未执行。PR #67 仍为 Draft，指派 `@adui-dev`，未经维护者明确授权不得合并。

## 2026-11-17 · 第三十四批第十三小批：保存过程中切换工程上下文（候选）

前置 PR #67 已按维护者明确授权 Squash 合并为 `main@0d5962b5b7d5b208a550d8cd3ba9a4b72b508c6d`，维护者 Windows 已在上一批通过 561/561 单测、49/49 服务端 E2E、`vp check`、React/Vue/NestJS 构建与 `ready` 退出码 0。本批复核了共享 `saveDocument` 的网络等待边界：若本地会话中途 `reset`、重新确认载入或访问失效，迟到的旧 401/404/409、创建或追加成功回包不能覆盖/清空新 CAS 基线；服务端 POST 已发出时仍可能成功，所以必须提示人工重新读取最新版本，不可自动重试或冒称远端已回滚。

候选仅更改 `packages/api-client/src/studio-session.ts`、新增五项 `studio-session.test.ts` 单测并同步需求/设计/验收等文档。Vue/React 仍共用现有服务端会话；未修改编辑器、IndexedDB、API、Prisma、OIDC Lab、工业设备。目标单测共享 **30/30**、全量 **566/566**，**本批 Windows `vp check`、`test:unit`、`docs:check`、`ready` 均待实测**；现有浏览器专项不能替代此批异步写入竞态回归。Draft PR 指派 `@adui-dev`，未经单独明确授权不得合并。

## 2026-11-17 · 第三十四批第十三小批：Windows 全链验收通过，PR #68 待审查

维护者 Windows 实测确认共享 Studio 服务端会话 **30/30**、整仓 Vitest **566/566**（49 文件），新增的五项“保存请求中切换上下文”的迟到 401/404/创建或追加回包回归均包含其中。独立 `vp check` **333 个格式文件 / 188 个受检文件零警告错误**；`docs:check` 86 份 Markdown 通过；完整 `pnpm run ready` 完成 React/Vue/共享包/NestJS 类型检查、OIDC 工程浏览器离线 24/24、SSE 8/8、故障代理 4/4、服务端 HTTP E2E 49/49 以及 React/Vue/Server 构建，PowerShell **退出码 0**。此前文档中的“候选、待复验”属于开发当时的历史状态，不代表当前仍未通过。

本批仍限定共享 API Client 的保存会话状态保护、五项 Promise 单测及相关文档，不执行真实 Lab 工程写入、ACL 修改、数据库迁移或工业设备控制。验收日志未显示本机 Git HEAD；新增竞态尚无真实浏览器/真实 PostgreSQL 延迟写入验证；本段文档提交后的质量链没有重新运行。PR #68 保持 Open / Draft，Assignee 为 `@adui-dev`，必须单独获得维护者明确合并授权。

## 2026-11-17 · 第三十四批第十四小批：浏览器延迟保存与重复提交回归（候选）

PR #68 已获维护者明确授权并 Squash 合并为 `main@a1e710d2be86675f156fe0c36534e528b2203cae`。上批 Windows `ready` 566/566 单测及 49/49 HTTP E2E 通过；第十三小批的 POST 迟到成功/拒绝仍仅有共享 Promise 单测。本小批按原有 Lab 边界增加 React/Vue 实际浏览器按钮行为验收：真实 Keycloak 登录、同源工程只读 GET 建立 CAS；模拟延迟 POST 409、401、503 在浏览器端返回，不会写真实工程、版本或 ACL。断言重复点击只尝试一次、等待时按钮禁用、CAS 状态正确，以及 SVG/IndexedDB/自动保存状态不变。

候选仅涉及现有 `scripts/test-project-browser-oidc.mjs`、`scripts/test-project-browser-oidc.cases.mjs`、根 `package.json` 和相关文档，不改变 React/Vue 业务代码、共享 Core/客户端、NestJS、Prisma、OIDC 用户或工业网关。预计 Node 离线浏览器安全用例 28/28（原 24 + 新 4），所有实际 `vp check`、`ready` 与双框架交互式专项均待维护者 Windows 复验。PR 仍保持 Draft，必须指派 `@adui-dev`，未获单独授权不得合并。

## 2026-11-17 · 第三十四批第十四小批：Windows 全链通过，Vue 交互式回归仍待修复后复验

维护者 Windows 已实际通过 OIDC 浏览器离线 **28/28**、`vp check` **333/188 零警告错误**、完整 `ready`（Vitest **566/566**、HTTP E2E **49/49**、React/Vue/NestJS 构建及 86 份 Markdown），但独立 `test:projects:oidc:save:browser` **退出码 1**。React 完整保存时序 409、401、503 通过；Vue 完成真实登录、分页及 IndexedDB 草稿，在“取消载入与画布保护”的载入确认之前失败，未进入 Vue 三种保存拒绝场景。

PR #69 已针对浏览器脚本确认存在的旧错误残留判定风险最小修正，并新增脱敏的受控错误类别及三项离线回归（预期 **31/31**），未修改 React/Vue 组件、共享 API Client、NestJS、PostgreSQL、OIDC ACL 或工业设备。原始失败的具体 HTTP/页面根因尚无证据定论；修复提交后的 Windows 全链和实际 Vue 交互式浏览器结果**仍待复验**。PR 继续保持 Open/Draft，Assignee `@adui-dev`，未经明确授权不得合并。

## 2026-11-17 · 第三十四批第十四小批：第二轮 Windows 失败与测试诊断契约修复

第二轮真实 Windows `test:projects:oidc:config` **30/31**：新增诊断用例把既有安全脱敏回退文案误认成另一句通用提示；`vp check` **333/188** 零警告，`ready` 中共享 Vitest **566/566** 通过，但在相同 30/31 离线测试处终止，完整质量链**退出码 1**。交互式浏览器专项 React 的 409/401/503 延迟保存均通过，Vue 在“真实 BFF 会话与授权工程列表”阶段失败，退出码 **1**；该阶段的原有布尔断言导致具体失败类别被通用错误信息覆盖，身份/网络原因尚未判定。

候选已对齐原有脱敏契约测试，追加 React/Vue BFF 会话固定中文拒绝诊断并保留必须身份有效的验证。预计离线测试 **31/31**，但该候选及新 HEAD 的 `ready`、真实 Vue BFF/浏览器保存专项均**未在 Windows 复验**。不修改前端业务组件、生产 API、Cookie、Lab ACL、数据库或工业设备接口。PR #69 保持 Draft，等待后续实际验收和单独合并授权。

## 2026-11-17 · 第三十四批第十四小批：第三次浏览器专项停在 React 503 场景

第三次 Windows 真实 `test:projects:oidc:save:browser` 退出码 **1**：React 完成正式登录、授权工程列表/分页、草稿、取消与模拟冲突、确认载入；随后依次进入 409、401、503 延迟保存，**在打印 503 开始消息后、尚未进入 Vue 前**抛出被统一脱敏的页面未达到预期状态。场景标题不是通过证据，503 内具体超时阶段未知。上一轮 `test:projects:oidc:config` 30/31、`ready` 失败属于历史日志，本轮没有新的质量链成功记录。

PR #69 继续只修改浏览器测试脚本和离线保护测试，用严格固定分类保留等待阶段超时及保存等待的布尔状态，新增两项用例（目标离线 **33 项**），不改变测试的真实登录、工程 API 写入阻断、CAS、SVG/IndexedDB/自动保存断言，不触碰 NestJS/Prisma/工业接口。协作端的 V8 静态解析与分类函数模拟不代表 Windows 验收；当前真实 503/双框架专项仍未通过，PR Draft、Assignee `@adui-dev`，未经授权不合并。

## 2026-11-17 · 第三十四批第十四小批：第四次 Windows 失败后的双框架 CAS 显示修复候选

维护者新日志明确 `test:projects:oidc:config` **32/33**、退出码 1：仅新加的未知超时诊断断言与仓库已有固定安全回退消息不一致；已最小修正预期，未放宽脱敏。真实 `test:projects:oidc:save:browser` **退出码 1**：React 409/401/503 全部完成请求挂起与合成响应释放；Vue 已通过真实 BFF、授权分页、草稿、取消、冲突和确认载入，并在 409 POST 合成回包释放后报告通用安全断言失败。

静态检查发现 Vue Studio 的 `serverBaselineRevision` 独立响应式缓存未在 409 保存失败后跟随共享会话清空，而 React 直接读取共享 CAS。候选补丁仅同步 Vue 保存异常后的当前共享 CAS 基线（503 保留、409 清除、401 继续失效）；新增固定安全诊断，保留已有真实 UI、唯一 POST、无真实写入、草稿保护断言。离线测试仍 33 项，尚未经过本机修复后完整验收。PR #69 继续保持 Open / Draft，未合并，Assignee `@adui-dev`，未经授权不得合并。

## 2026-11-17 · 第三十四批第十四小批：Windows 全链及双框架延迟保存专项验收通过

维护者最新 Windows 真实执行确认 `test:projects:oidc:config` **33/33**、`vp check` **333 个格式文件 / 188 个受检文件零错误警告**、`docs:check` **86 份 Markdown**；完整 `pnpm run ready` 已执行到末尾且非零退出码断言未触发，包含 Vitest **566/566**、共享 Studio Session **30/30**、SSE **8/8**、TCP 故障代理 **4/4**、NestJS HTTP E2E **49/49**、React/Vue/Server 类型检查与构建。独立 `test:projects:oidc:save:browser` 通过：React/Vue 在可信 Keycloak/BFF Lab 分别载入授权工程并完整通过合成 POST **409/401/503**、一次写入尝试/忙碌互斥、错误后 CAS 状态与本地草稿保护，维护者明确报告**退出码 0**。浏览器写入拦截仍生效，未修改真实 Lab 工程版本和 ACL。

此前第四轮 **32/33**、Vue 409 合成响应后的失败和更早的脱敏/载入问题保留为历史；Vue CAS 响应式副本不同步的 E-035 已经获得双框架真实 UI 回归结果支持，当前本批验收通过。**尚缺本机 `git rev-parse HEAD`**，不声称 Windows 运行提交与 PR 最新 HEAD 精确一致；本段文档提交后的质量链也未重新执行。本批不覆盖真实 PostgreSQL 完成 POST 后的延迟回包、跨会话写入或工业设备控制。PR #69 仍为 Open / Draft、Assignee `@adui-dev`，等待最终审查与明确合并授权。

## 2026-11-17 · 第三十四批第十五小批：真实数据库提交后的迟到回包分层验收候选

前置第十四小批 PR #69 经维护者明确授权已 Squash 合并至 `main@c5df29fb7a769235237c5c4da33f20a0c013fe2e`。前批已在 Windows 通过离线保护 33/33、Vitest 566/566、HTTP E2E 49/49、`ready` 全链及 React/Vue 双框架真实浏览器合成 409/401/503 保存拒绝专项（退出码 0）。这些不是本批真实数据库新用例的运行结果。

本批针对“POST 确实已成功提交，旧 201 较晚交付”补齐两层互补测试：共享 `StudioServerProjectSession` 的旧成功回包迟到后保护新修订号 3 并安全续写 CAS 4；以及原有独立 PostgreSQL `test:db` 中真实双 Cookie HTTP 写入到 2，再由另一主体写到 3，延迟把先前真实 201 交给模拟消费端，旧 CAS 2 必须返回 409，数据库水位/版本/审计均保持 3。只向原有随机临时租户写入并在 finally 清理，不操作实际 Lab 或已有业务工程。前后两个测试**不是同一条真实浏览器/数据库链路**；模拟延迟为消费端交付门控，而非物理网络断流。

候选仅改共享客户端测试、真实数据库 HTTP 测试和配套需求/设计/验收文档，无生产代码、依赖或迁移变更。目标全量 Vitest **567/567**、共享会话 **31/31**、真实 `test:db` **30/30**，均**等待 Windows 实际执行**；`test:db` 不在默认 `ready` 中。Draft PR 必须指派 `@adui-dev` 并核实，未获维护者本次明确授权不得合并。

## 2026-11-17 · 第三十四批第十五小批：TS2740 单点修复待 Windows 复验

首次 Windows `vp check --fix` 报新增共享 Session 单测一处 **TS2740、0 警告**，格式化虽完成但 Lint/类型检查没有通过。原因是 Core 异步 `createProjectSnapshot` 返回 `Promise<ProjectSnapshot>`，而 `mockResolvedValueOnce` 需要已解析快照。PR #70 原分支仅在 `mockResolvedValueOnce` 中先 `await createProjectSnapshot`，不更改共享会话业务逻辑、真实 PostgreSQL HTTP 测试或测试库安全约束。

修复后本地 `vp check`、Vitest 31/31（全量目标 567/567）、`ready` 及单独 `test:db` 仍需维护者重新执行。保持 Draft、Assignee `@adui-dev`、未经授权不得合并。

## 2026-11-17 · 第三十四批第十五小批：真实 PostgreSQL 回归通过，SSE 代理坏端口阻断 ready

维护者最新 Windows 验收确认本机隔离 `adui_scada_test` 四项迁移为最新，`pnpm run test:db` **4/4 文件、32/32 项通过、退出码 0**；这覆盖新加的真实 HTTP 201 已提交/旧回包迟到/第二主体 CAS 追加/持久化审计一致性。历史计划预期 `30/30` 已被真实统计 `32/32` 覆盖。单独 `test:unit` **567/567**、`vp check` **333/188 零告警**、`docs:check` **86** 项通过。但完整 `ready` 在 SSE 故障代理四项中两项 `fetch failed: bad port` 处停止，**退出码 1**；同次质量链后续保护与构建未执行完毕。

已在原 Draft PR #70 的 SSE 故障代理测试工具内将 OS 随机端口改为 Fetch 允许的随机高端口（20000～49151，本机监听，冲突重试最多 32 次），并在现有四项 SSE 测试夹具中增加安全端口断言；不改变实际 SSE 业务行为、SCADA Core、PostgreSQL、NestJS 或工业设备接口。禁用端口这一机制与日志吻合，但**未保存真实端口号码**，修复后 `test:sse:fault:unit` / `ready` 仍待 Windows 复验。PR #70 继续 Open/Draft、Assignee `@adui-dev`，不得提前合并。

## 2026-11-17 · 第三十四批第十五小批：Windows 完整质量链结案通过

维护者最新 Windows 再次执行 SSE 故障代理专项 **4/4**、`vp check` **333/188 零警告错误**、`docs:check` **86**；随后 `pnpm run ready` 完整执行至 React/Vue/NestJS 构建结束，**退出码 0**，包括单测 **567/567**、共享 Session **31/31**、SSE 客户端 **8/8**、故障代理 **4/4**、工程浏览器安全离线 **33/33**、NestJS HTTP E2E **49/49**。此前 PostgreSQL 隔离库 `test:db` **32/32、退出码 0** 且 4 项迁移最新的实测结论保持成立。原始 `ready` 的 `bad port` 失败已有修复后复验通过证据，E-037 结案；E-036 的 TS2740 Mock 修复也已在 Windows TypeScript、`vp check` 与单测中通过。

上述结果覆盖本批预定共享 Session 和真实数据库分层 CAS 验收；不等于同一真实浏览器内物理 TCP 断流或工业现场验证。Windows 原始日志未打印本地 HEAD，因此无法精确匹配 PR Git SHA；本次结案文档追加提交后质量链亦未再次执行。PR #70 继续 Open/Draft、Assignee `@adui-dev`，仍待本次明确合并授权。

## 2026-11-17 · 第三十四批第十六小批：真实浏览器迟到 201 联合验收候选

基于 PR #70 已授权合并的 `main@95fb9df6cb590b87de3c4a71842e54bce86d6df4`，仅扩展已有真实双 Keycloak 主体 CAS 测试脚本和本机 Lab 命令。目标：第一浏览器收到真实 201 后暂缓消费、第二浏览器读取 2 并写入 3、旧 201 最终交付、旧 CAS 必须 409、两端实际读取版本 3、PostgreSQL 三条版本与审计完全一致。原双主体写入门禁与仅新建随机专用工程限制不变。

新增 5 项 Node 离线安全测试，原 `test:oidc:dual:config` 从 11 项预计增至 **16 项**；完整 `ready` 仍需 Windows 实测，真实 `test:oidc:dual:late` 必须额外在安全隔离的本机 Keycloak/HTTPS/PostgreSQL Lab 中手工执行并提供最终退出码。当前未获得本次候选的 Windows 运行证据，不声称联合场景通过、真实物理 TCP 断流被覆盖或 Studio UI 内部恢复被验证。Draft PR 不合并。

## 2026-11-17 · 第三十四批第十六小批：Windows 验收通过，PR #71 待审

维护者 Windows 已实测 `test:oidc:dual:config` **16/16**，独立 `vp check` **333 文件/188 受检零告警**、`docs:check` **86 个 Markdown**、完整 `pnpm run ready` **退出码 0**（567/567 单元测试、49/49 NestJS HTTP E2E、SSE 8/8 与 4/4、React/Vue/NestJS 类型检查及构建）。

独立 `pnpm run test:oidc:dual:late` 在本机可信 Keycloak 双主体、两套隔离浏览器、React/Vue HTTPS BFF 和 PostgreSQL Lab 上 **退出码 0**：新建随机专用工程，真实版本 2 已提交、原 201 浏览器暂缓消费，第二主体推进至 3，释放旧 201 后再使用旧 CAS 得到 409，最终三版历史、摘要和审计核对一致。测试工程按设计保留。此专项不同于物理 TCP 断流，也不调用 Studio UI 保存按钮和共享 Session。

上传日志未记录本地 `git rev-parse HEAD`。补录前 GitHub PR #71 HEAD `e2f2133d1db25a054591e3b5fa9a243a0f4cc8ba`；维护者新增的一次提交只有两份测试脚本格式化变化。此次文档补录后尚未重跑质量链；PR #71 继续 Open/Draft，Assignee `@adui-dev` 已核对，**等待明确合并授权**。

## 2026-11-17 · 第三十四批第十七小批：真实 Studio 迟到 201 联合浏览器候选

已获授权合并的 PR #71 进入 `main@c6460177fe38aa3532e4a956aad60143e7fd2d14`。新小批只增加独立安全浏览器专项和离线测试，不改变现有共享 `StudioServerProjectSession`、React/Vue 页面业务流程、NestJS API、Schema、Prisma、工业设备权限或第三方依赖。

上一小批虽然让双浏览器通过真实 BFF API 推进版本 2→3，但没有操作 Studio 保存按钮。本批针对两位真实 Keycloak 测试主体分别在 React/Vue Studio 建立首版 CAS、保存本地草稿、真实 UI 提交版本 2 并持有已到达的 201；第二主体推进 3 后再释放旧回包，通过页面可见性只读复核撤销旧 CAS，阻止 UI 再次提交，并比较本地画布/草稿。复用原 UUID 专用工程及三项 ACL 门禁，测试工程留存。默认 `ready` 仅运行新增的 **9 项**离线安全测试。

**当前状态：候选，尚无 Windows `test:oidc:dual:studio:config` / `vp check` / `ready` 及双框架真实 Lab 浏览器专项通过证据。** 离线 Node 9/9 和完整质量链的实际退出码必须来自维护者运行；真正写入也须先确认本机可信 OIDC Lab，并使用显式命令。Draft PR 继续要求 Assignee `@adui-dev`，未经授权不合并。

## 2026-11-17 · 第三十四批第十七小批：Windows 首轮质量链通过，真实 Studio 专项待定位

维护者 Windows 已提供第十七小批候选的离线安全测试 **9/9**、`vp check` **335 文件格式正确/190 受检零警告错误**、`docs:check` **86 Markdown**，完整 `pnpm run ready` 已执行至 React/Vue 与 NestJS 构建完成，最终退出码 **0**。单测 **567/567**、NestJS HTTP E2E **49/49**、SSE 客户端 **8/8**、故障代理 **4/4**、双主体离线 **16/16**。

同一轮单独执行 `pnpm run test:oidc:dual:studio:late` 时，两位主体登录、两份专用工程准备以及 React Studio 真实 201 到达/挂起均已输出；随后在推进/释放/消费阶段报通用“真实 Studio 迟到保存未达到受控状态”，退出码 **1**。当前没有证据区分其具体失败阶段，**不能宣称真实 Studio 双框架专项通过**。

PR #72 候选已新增固定阶段与安全状态摘要，方便下一轮定位；本次修改后 Windows 离线测试、质量链和真实浏览器均需重跑。维护者提供的日志未包含 `git rev-parse HEAD`，不能将此前质量链结果归属到 PR 的某个精确 SHA。PR 保持 Draft、Assignee `@adui-dev`，不合并。

## 2026-11-17 · 第三十四批第十七小批：第二轮真实 Studio 窗口可见性故障

维护者第二轮 Windows `test:oidc:dual:studio:late` 已实测 React 双主体真实 CAS 2→3 HTTP 201 成功、第一主体保存真实 201 消费成功且 UI 显示 CAS 基线 2；但 `Page.bringToFront` 后仍输出 `visible=false`，专项退出码 **1**。后续真实只读 CAS 复核、旧水位阻止第四版以及 Vue 全流程**没有得到本次通过证据**。

候选仅修正隔离测试的第二浏览器窗口管理，不修改生产 UI、共享 CAS、API、数据库与工业控制安全：第二主体真实操作时使用正常窗口，第一主体恢复可见前最小化第二窗口，仍严格要求真实 `visible`。新增 2 项离线测试（目标 **11/11**）。新代码和文档尚未经 Windows `vp check`、`docs:check`、`ready` 与真实 Lab 复验；PR #72 保持 Draft、Assignee `@adui-dev`，不合并。

## 2026-11-17 · 第三十四批第十七小批：第三轮真实浏览器本地一致性异常

维护者第三轮 `pnpm run test:oidc:dual:studio:late` 仍然**退出码 1**。此次已越过第二轮窗口可见性阻塞：React 真实版本 2 的 201 交付、第二主体 CAS 2→3、Studio 返回可见均成功。日志随后报本地数据变化；结合当前脚本顺序，真实 CAS 复核使基线清空、UI 再次保存被拒绝且无额外 POST 等前置断言也已通过，失败在最后的 SVG、IndexedDB 草稿及自动保存一致性比较，Vue 与最终 PostgreSQL 三版审计尚未执行。

尚不知道哪类数据改变，也无法判断发生于 CAS 复核还是最终再次点击保存。PR #72 新增四类布尔脱敏诊断及五个强制比较点，**没有放宽数据安全断言**、没有改生产业务逻辑。离线测试新增两项，目标 **13/13**。最新候选仍待 Windows Node、`vp check`、`docs:check`、`ready`、真实浏览器复验；PR Open/Draft，Assignee `@adui-dev`，未经授权不合并。

## 2026-11-17 · 第三十四批第十七小批：第四轮 SVG 内容误报候选修正

维护者第四轮真实 Lab `pnpm run test:oidc:dual:studio:late` **退出码 1**：React 完成真实 POST 201、第二主体 CAS 2→3、旧 201 交付、浏览器恢复可见及 CAS 只读复核；本地变化分类确认**仅 `canvasChanged=true`**，自动保存、IndexedDB 草稿数量和原始记录哈希均未改变。真实数据库最终三版审计与 Vue 整套测试仍未执行。

源码检查发现 `.studio-svg.innerHTML` 包含位置随 `visibleRect` 的辅助视口网格矩形；当前提出仅调整本专项的画布快照口径，忽略**单个直系网格元素**，保留其余全部 SVG/草稿/SQL 安全断言和 React/Vue 业务逻辑。根因是否仅为网格重算仍需真实浏览器验证。新增 3 项离线安全用例，累计目标 **16/16**；当前未取得该补丁的 Windows `vp check`、`ready` 或真实 Lab 退出码 0。PR #72 继续 Draft，Assignee `@adui-dev`，未获合并授权。

## 2026-11-17 · 第三十四批第十七小批：Windows 双框架真实迟到 201 验收通过

维护者 Windows 完整 `pnpm run ready` **退出码 0**；Studio 本批 Node 离线 **16/16**、`vp check` **335 文件格式正确 / 190 受检零警告错误**、`docs:check` **86 份**、Vitest **567/567**、NestJS HTTP E2E **49/49**、SSE 客户端 **8/8** 与故障代理 **4/4**、React/Vue/NestJS 类型检查和构建均完成。此前文档标记的“最新补丁待 Windows 实测”为验收前历史状态，最新结论以此段为准。

独立真实 `pnpm run test:oidc:dual:studio:late` 也**退出码 0**：两个不同的真实 Keycloak 预绑定主体分别在隔离浏览器中建立同租户会话；React 与 Vue 的真实 Studio 保存按钮在两个新建的专用工程上分别提交修订 2，第二主体推进至 3，再交付已到达的旧 201；页面恢复可见后，真实只读复核撤销过期 CAS，阻止额外写入，并核对工程 SVG 内容、IndexedDB 草稿与数据库三版审计。每个专用工程只保留 1/2/3 三版并留存供复核。视口辅助网格不属于持久化工程内容，测试仅将其排除于 SVG 内容快照，其余图元继续严格比较。

未模拟物理 TCP 断流、生产或工业现场安全验收。成功日志未含本地 Git HEAD，无法绑定具体 SHA；本次结案文档提交后未重新运行质量链。PR #72 保持 **Open / Draft**，已指派 `@adui-dev`，仍待明确合并授权，不合并。

## 2026-11-17 · 第三十四批第十八小批：409 后只读查看最新版本候选

基线为维护者授权合并的 PR #72（`main@cee62c31a7b9750f75765f3236ecaba9a38b58da`）。当前共享 `StudioServerProjectSession` 已覆盖真实迟到成功回包、过期 CAS 复核与权限失效，但保存返回 409 后界面只能提示手动查询历史。本批候选为 React/Vue 双端增加一条**用户主动执行的只读恢复路径**，复用共享上下文代次保护和人工确认载入；不自动覆盖画布、不修改 IndexedDB、不引入工业设备写入。

新增 6 项共享 Vitest 测试和 2 项 Node 浏览器离线安全用例；现有 `test:projects:oidc:save:browser` 的 409 分支扩展只读预览，所有工程非 GET 请求仍由浏览器拦截。若本批代码基于上一轮质量数据未变，理论目标为共享 Session **37 项**、Vitest **573 项**、工程浏览器离线 **35 项**；数字仅为候选目标，**当前尚无该代码的 Windows `vp check`、完整 `ready` 或真实浏览器复验日志**。PR 保持 Open/Draft 并指派 `@adui-dev`，需明确合并授权。

## 2026-11-17 · 第三十四批第十九小批：人工确认后水位复核候选

以维护者授权合并的 PR #73（`main@41f731afa73231011e65bb57aa26d6009a0a8e3d`）为基线。第十八小批已实现 React/Vue 409 冲突后的只读最新预览，Windows `ready` 与真实 Keycloak 双框架浏览器专项均有退出码 0 的维护者证据。本批针对预览之后及从工程列表直接“打开”时**确认对话框内远端水位/主体变化**的剩余风险，新增共享只读复核与双框架对等调用。

生产变更限于 `StudioServerProjectSession` 一个方法、React/Vue 两处确认载入顺序；不新增 API、依赖、Prisma 迁移、Schema 或设备写入。共享 Session 新增 **8 项** Mock 测试，工程浏览器安全测试新增 **2 项**；预计全量 Vitest **581** 项、共享 Session **45** 项、OIDC 工程浏览器离线 **37** 项，均仅为**目标数量**。真实浏览器新增模拟确认后 GET 修订号漂移和真实 409 预览后的人工确认载入检查。当前这些测试与最新 `vp check`、`docs:check`、完整 `ready` 尚未在 Windows 执行。

并发边界：再次 GET 检查不能提供跨浏览器事务锁；最后一次只读校验之后仍可能发生新的远端提交，后续保存必须继续使用原服务端 CAS 和标签页恢复只读复核。PR 默认 Open/Draft、Assignee `@adui-dev`；未经维护者新授权不得合并。

## 2026-11-18 · 第三十四批第二十小批：真实多标签页会话与工程一致性候选

基于已合并 PR #74 的 main@8cd2223853e7e5dc05695b8ab1226911ec7bd734 新建分支 feature/v0.3-b34-multitab-oidc-session。本批先补真实浏览器验收工具，不修改生产 React/Vue 页面、共享 API Client、NestJS、Prisma、数据库迁移或工业设备权限。

新增一个隔离 Chrome/Edge Profile 中的四个真实标签页：React 写入/跟随、Vue 写入/跟随。只登录一次 Keycloak 普通预绑定测试用户，通过同一 Host 的 React/Vue HTTPS Origin 验证 Cookie 会话共享；正式 API 创建一份随机专用工程并真实推进版本 1→2→3。两个跟随标签页实际切回前台时，验证原有 visibilitychange 复核发现远端水位变化、失效 CAS，且保存操作没有工程 POST 穿透。随后真实 CSRF 注销 BFF 会话，隐藏标签页保持既有内存状态，分别切回前台后由真实 BFF 401 失效服务端缓存。

新增 scripts/test-oidc-real-multitab.mjs 和 9 项 Node 离线安全测试；根 ready 纳入离线配置门禁，真实浏览器写入/注销专项仅在 --run-multitab --confirm-lab 数据库名 显式确认后手工执行。当前属于开发候选：Windows Node 离线、vp check、docs:check、完整 ready 和真实四标签页 Keycloak/HTTPS 浏览器专项均尚未执行；所有测试数量均为目标，不作为通过证据。测试专用工程按既有安全测试惯例保留；新工程仅由现有创建 API 创建创建者默认权限，不手工授予其他主体或修改既有 ACL。

## 2026-11-18 · 第三十四批第二十一小批：测试快照缺失即拒绝（候选）

PR #76 已获维护者明确授权并通过 GitHub Squash 合并，main@7d2adb04e08bea3303797a6ac379d33068ac7322。维护者日志显示前批离线 11/11、完整 ready 退出码 0，真实 Keycloak 四标签页专项退出码 0；日志未单独证明本地 Git HEAD。

本批以已合并 main 为基线，新增多标签页保护快照的缺失/无效值安全门禁和两项 Node 用例，不调整生产行为。此批后续 Windows 离线目标 13/13，完整质量链和真实浏览器尚未执行，PR 默认 Draft 且指派 @adui-dev，未经新的授权不合并。

## 2026-11-18 · 第三十四批第二十二小批：真实四标签页注销后身份全覆盖候选

第二十一小批 PR #77 经维护者授权已 Squash 合并，`main@1969ae47ac5da2a9c5b3cc5c36003642f35f245f`。原 Windows 质量记录为多标签页离线 13/13、`ready` 退出码 0（Vitest 581/581，NestJS HTTP E2E 49/49，双 Web/NestJS 构建通过）；原日志无本地 HEAD 且第二十一小批未重跑真实 Keycloak 浏览器专项。

本批仅补足原四标签页脚本中两个**写入页**的注销后真实 BFF 状态核验：React 写入页注销后同源身份 GET 必须 401，Vue 写入页重新真实可见后自身 Origin 身份 GET 必须 401，两个跟随页已有的真实 CAS 失效、草稿/画布保护及零工程 POST 断言不变。仅修改测试脚本、离线用例及相应需求/设计/验收文档，不修改正式双框架、认证后端、数据库或工业权限。新离线目标 14 项，**尚未执行**新候选的 Windows 质量链与真实四标签页浏览器；PR 应保持 Draft、指派 `@adui-dev`，不得在未获新授权前合并。

## 2026-11-18 · 第三十四批第二十三小批：四个 Studio 页注销恢复安全回归候选

PR #78 经维护者授权已 Squash 合并到 `main@43a2236bec8b528e0d7e1763dba58a558ddfab0a`；对应维护者 Windows 离线 14/14、完整 `ready` 退出码 0，真实 Keycloak 四标签页专项退出码 0。日志未单独给出本机 HEAD；前批写入页只检查 BFF 401，**没有**进入 Studio 进行页面 CAS 清理验收。

本批在完成原随机工程真实修订 1→2→3 后，增加两个写入页的 Studio 授权确认载入、只读保护快照和写请求本地阻断。注销后四个标签页各自真实变为可见并验证 CAS/授权失效、BFF 401、本地 SVG/IndexedDB/自动保存保持与旧 CAS 保存零穿透。由于同 Origin 标签页共享 IndexedDB，写入页不再次保存草稿或开启自动保存，避免测试自身改写跟随页草稿。正式 React/Vue 页面、共享 API Client、NestJS、数据库和工业网关逻辑未改变。

新增 1 项 Node 安全回归，目标为 15/15；当前尚未在新 HEAD 执行 Windows 离线、`vp check`、`docs:check`、`ready` 或真实四 Studio 标签页专项，PR 默认 Open/Draft 且必须指派 `@adui-dev`，未经新授权不合并。

## 2026-11-18 · 第三十四批第二十四小批：后台隐藏页快照保护候选

第三十四批第二十三小批 PR #79 已获维护者明确授权并通过 GitHub Squash 合并，`main@922a72d808658e81d80930436dfabae081b4f83c`。Windows 维护者日志确认离线 **15/15**、完整 `ready` 退出码 0，真实 Keycloak 四 Studio 标签页专项退出码 0；没有独立本地 HEAD 输出，不能宣称日志绑定 GitHub 新提交。

本批检查到前批注销后仅即时比较三个隐藏页的 CAS 修订号和身份标记，完整本地保护快照直到恢复可见才比较；后台页在恢复前的异常修改缺乏第一现场的单独验收。本批扩展隐藏页只读验证：真实隐藏状态、CAS 修订号及水位不提前失效、后台操作不忙/零工程写入、SVG 内容与 IndexedDB 草稿及自动保存保持原值。四页恢复后的原断言全部保留；仅修改浏览器测试脚本、其离线安全用例及需求/设计/验证文档，不更改正式 React/Vue、共享 API、NestJS、Prisma 或工业控制权限。

新增 2 项离线测试，覆盖隐藏页异常状态拒绝与严格读取顺序，目标 **17/17**；新候选尚未在 Windows 执行 `vp check`、离线脚本、完整 `ready` 和真实四 Studio 标签页专项，维持 Draft PR、指派 `@adui-dev`，未经新授权不合并。

## 2026-11-18 · 第三十四批第二十五小批：共享注销后受保护工程只读 API 安全回归候选

第二十四小批 PR #80 已经维护者 Windows 通过离线 17/17、完整 `ready` 退出码 0、真实 Keycloak 四 Studio 标签页专项退出码 0，并获明确授权 Squash 合并至 `main@2559d6ff7375cac22ad9741d98e121408269e3ad`。用户日志缺少独立本地 Git HEAD，不臆断验收执行的精确提交。

本批从已验收四页注销后身份 BFF 401 出发，补齐同一 Cookie 会话对真实工程业务只读接口的拒绝：分别在 React/Vue Origin 确认列表及本轮专用工程第三版 GET 均为 401，拒绝 200、302、403、网络失败及非法工程 ID，且不读取工程响应正文或输出凭据。新增 2 项 Node 安全回归，目标离线 **19/19**。保留全部原可见性、CAS、水位、草稿/画布/自动保存和零工程 POST 断言。仅修改浏览器测试脚本、Node 用例及需求/设计/验证文档，不改正式双框架或服务端工业权限。

本批仅为 GitHub 候选，**尚未**运行新 HEAD 的 Windows 离线、`vp check`、`docs:check`、完整 `ready` 或真实 Keycloak 四标签页专项；新 PR 默认 Draft，Assignee 立即指派并核实 `@adui-dev`，未经本批新明确授权不合并。

## 2026-11-18 · 第三十四批第二十六小批：注销后全部工程 GET 路由拒绝候选

第二十五小批 PR #81 经维护者 Windows 验收离线 19/19、完整 `ready` 退出码 0、真实 Keycloak 四标签页浏览器专项退出码 0；已在维护者新明确授权后经 GitHub Squash 合并至 `main@21085c1ebde325c8420e7f31e75294e030d8cd0a`。日志未提供独立本地 Git HEAD，不能将执行证据自动关联至确切 SHA。

核对 NestJS 当前 Controller 而非按规划推断：工程共四条受保护 GET 路由。上批已验收工程列表与指定版本两个 GET，本批新增工程详情及历史版本列表两个 GET，在同一个真实注销会话的 React/Vue 两个 HTTPS Origin 上均要求 HTTP 401。只读请求仅访问本轮随机专用工程，不读取响应正文，不触碰正式 React/Vue、NestJS、Prisma、ACL 或工业设备权限；原四 Studio 页身份/CAS/画布/草稿/零写入断言继续保留。

两项已有离线用例调整为四路由契约，并新增一项逐路由拒绝回归，目标 Node 离线 **20/20**。当前只是 GitHub 候选，**尚未执行**新 HEAD 的 Windows 离线、`vp check`、`docs:check`、完整 `ready` 和真实 Keycloak 浏览器专项；PR 默认 Draft，立即指派并复核 `@adui-dev`，未获本批新的明确授权不得合并。

## 2026-11-18 · 第三十四批第二十七小批：Session Guard HTTP 拒绝响应禁缓存候选

第二十六小批 PR #82 经维护者实际 Windows 验证：多标签页离线 **20/20**、完整 `ready` 退出码 0、真实 Keycloak 四 Studio 标签页专项退出码 0，已在用户明确授权后 Squash 合并至 `main@9fd3b863af8c2af7518d1f8a2e256c85e3bc08ab`。原上传日志未包含独立本地 HEAD，不能将其与当前候选新提交的验收结果混同。

本批经 NestJS Controller/Guard 代码核对发现：成功路由的 `@Header(no-store)` 无法单独证明被 Guard 提前拒绝的 401/403 也禁止缓存。本批做最小服务端防护：Session Guard 在 HTTP 分支所有认证逻辑之前统一设置 `Cache-Control: no-store` 与 `Pragma: no-cache`，不更改原鉴权、CSRF、BFF Cookie、租户或 ACL 逻辑。新增 Guard 401/403 单测及两条真实根模块装配 E2E 的响应头断言。只改服务端 Guard、相邻测试与对应项目文档，Vue/React 双版本、SCADA Core、Prisma、工业网关与设备权限保持不变。

新 Vitest 目标 **583/583**，NestJS HTTP E2E 仍 **49/49**（仅为目标）；**新 HEAD 尚未在 Windows 实际执行** `vp check`、`ready` 或真实 Lab 浏览器专项。PR 默认 Draft，立即指派并核验 `@adui-dev`，未经本批新的合并授权不得合并。

## 2026-11-18 · 第三十四批第二十七小批 E-047 单元测试 Mock 修复候选

维护者 Windows 首轮质量验收：`vp check` **337/192** 零警告，HTTP E2E **49/49**、`docs:check` **86** 份均通过；但全量 Vitest **580/583**，有三项 `scada-identity.spec.ts` 原身份与审计回归失败，`ready` 退出码 **1**。原因已由日志与候选源码定位为该文件共用 HTTP Context Mock 缺少本批 Guard 新依赖的 `getResponse().setHeader`，并非已观察到生产认证策略错误。

PR #83 修复候选只补全旧身份测试的共用 Context Mock，保留生产 `no-store/no-cache`、401/403、Bearer/Cookie、CSRF、会话审计与工程权限；在既有无效 Bearer 和正常认证场景检查响应头。错误复盘编号 E-047。**修复后 Windows 单测目标 583/583，完整 `ready` 尚待真实退出码为 0 的验收**；PR 保持 Draft、Assignee `@adui-dev`，不得在本轮未获新合并授权时合并。

## 2026-11-18 · 第三十四批第二十八小批：OIDC 根模块 CSRF/Origin 403 禁缓存候选

第二十七小批 PR #83 曾因旧 `scada-identity.spec.ts` Mock 缺失 `getResponse` 触发 E-047 的 3 项失败（580/583、`ready` 退出码 1）；修复后维护者 Windows 已通过 **583/583**、完整 `ready` **退出码 0**，含 HTTP E2E **49/49**。PR #83 经新的明确授权 Squash 合并到 `main@650b084f770bb92241b3b93a02689160b7b8bc41`；用户日志未提供独立本地 Git HEAD，对测试执行 SHA 不做额外推断。

本批核对真实 `OidcEnabledAppModule` E2E 发现之前只有两个匿名 401 HTTP 响应头断言，虽然 Guard 单测覆盖 403，还没有通过根模块实际 HTTP 异常处理验证 CSRF/Origin 拒绝时的禁止缓存头。仅在既有 E2E 增加两条受保护 `POST /api/v1/auth/logout` 测试：缺少 CSRF Header 或不可信 Origin 时，真实 HTTP 403、no-store/no-cache、无会话 Cookie 清除或重定向。测试使用无效但格式合法的静态测试 Cookie 与 Mock Prisma，不访问真实数据库/Keycloak；正式服务端业务逻辑、React/Vue、Prisma、ACL、工程 Schema 和工业设备权限不变。

新增 2 条 HTTP E2E，目标由 **49** 增至 **51/51**；Vitest 单元测试仍为 **583/583**。新提交尚未 Windows 实测，维持 Draft PR、立即指派并复核 `@adui-dev`，未经本批明确授权不合并。

## 2026-11-18 · 第三十四批历史遗留 PR #75 合流候选

PR #84（第三十四批第二十八小批）已根据维护者提供的 51/51 HTTP E2E、583/583 Vitest 和完整 `ready` 退出码 0 实测记录，由用户明确同意后 Squash 合并到 `main@fd2a600b45f4c2c7400984932b69c46da18ab028`。

排查遗留 PR #75 确认其仍为 Open / Draft，最早在 PR #74 之后创建，实际保留两份尚未集成的同源双标签 CAS 浏览器与 Node 安全测试脚本。当前已有的四标签共享 OIDC 注销测试不能代替同一 Origin 两标签提交同一工程的版本 1→2→3、过期 CAS 阻断、只读预览、人工载入及同主体审计。因为 #75 老主线基线与后续代码、文档冲突，本轮以**保留原分支历史和最新 main 内容**的双父提交合流，修复两处 CDP 模块常量引用并补 1 项离线测试，不回改正式业务源码。

本批新候选安全离线目标 **19/19**、HTTP E2E 保持 **51/51**、Vitest 保持 **583/583**，全部都**需要在新分支实际执行复验**。真正的同源双标签 Lab 仅可显式确认后独立手动启动；会新建两份随机测试工程和有限版本，用户/ACL/既有工程及工业设备不做任何修改。PR #75 继续 Draft、Assignee `@adui-dev`，无新明确合并授权不合并。

## 2026-11-18 · V0.3 第三十五批第一小批：FR-008 发布静态预检候选

PR #75 的同源双标签 CAS 质量和真实浏览器专项经 Windows 19/19、ready 退出码 0、React/Vue 实测退出码 0 验收后，已按明确授权 Squash 合并 main@46dd07177bdd9528443f7fe621f1a48deac483a0；没有剩余 Open PR。

下一阶段从反复的 OIDC/CAS 回归转向 FR-008 的静态安全基础。新候选只在共享 Core 增加 validateProjectReleasePreflight 与 10 项测试，识别当前 SVG 运行时不支持的图元及版本、未消费的绑定、已绑定 unknown Tag 和规则。不会创建发布指针、数据库写入或设备命令，也不会改变 React/Vue 现有版本保存。预检通过不等于有权限发布或可进行工业现场运行。

新候选 Vitest 目标 593/593，Windows vp check、单元测试、docs:check 和完整 ready 尚待执行。PR 默认 Draft，必须指派并复核 @adui-dev；用户未明确授权此新 PR 合并之前不得合并。

## 2026-11-18 · 第三十五批第二小批：React/Vue Studio 发布静态预检候选

前批共享 Core 静态预检 PR #85 在 Windows 完成单测 593/593、`vp check` 341/196 零警告、完整 `ready` 退出码 0，获用户明确授权后 Squash 合并至 `main@b0bf3f683030d3e87e2f3a9b360294ff332cdbc7`。维护者日志未附独立的本地 Git HEAD，保留此证据边界。

本批将已有 `validateProjectReleasePreflight` 接入 React/Vue 双框架 Studio 工具栏的「发布预检」只读面板。两端均根据当前文档派生结果：兼容时明确只为静态 SVG 预检通过，不兼容时展示数量、字段路径和中文原因；不创建版本、不触碰草稿与 CAS。另新增临时 Chrome/Edge 双框架独立专项 `test:release:preflight:browser`，通过合法/不支持/恢复三个实际 JSON 导入阶段验证结果更新与工程无损。

新 UI 与浏览器测试尚未在 Windows 完成 `vp check`、全量 `ready`、`test:browser` 和 `test:release:preflight:browser`；不得将第一小批的 Core 单测通过视为本批双框架 UI 验收。PR 默认 Draft、必须指派并核验 GitHub `@adui-dev`，无新明确合并授权不合并。正式发布授权/持久化、运行时发布态、回滚及工业安全仍未交付。

## 2026-11-18 · 第三十五批第三小批：SVG 属性静态兼容性候选

PR #86 依据维护者明确授权 Squash 合并至 `main@a934a33ba2251880f934ff4f5e9937ff78711f5c`。维护者上传日志证明单元测试 593/593、HTTP E2E 51/51、`vp check` 341/196 零告警、完整 `ready` 退出码 0；**未提供**单独 Git HEAD、`test:browser` 和 `test:release:preflight:browser` 退出码。该浏览器验收缺口保持待补，不得记作已通过。

第三小批继续 FR-008 静态门禁：Core 增加已知 SVG 图元 `props` 消费检查，对未被渲染器处理的属性报告路径与受控错误，不改变现有工程文件或工业设备。新增三项单测，候选全量 Vitest 目标为 596/596。候选的 `vp check`、`docs:check`、`ready` 和浏览器专项均待执行；新 PR 保持 Draft，需先验收并取得独立合并授权。

## 2026-11-18 · PR #87 HTTPS Studio 浏览器专项探测修复候选

维护者 Windows 新上传日志：本批 Core 属性兼容性预检的 Vitest **596/596**、HTTP E2E **51/51**、`vp check` **341/196 零告警**、文档 **86 份**、完整 `ready` **退出码 0**。但真实 Vite Web 为 HTTPS 15173/15174，旧 `test-studio-browser.mjs` 默认探测 HTTP，导致布局与发布预检浏览器专项均在 React 首页阶段 **退出码 1**，其余 UI 断言未运行。

当前 Draft PR #87 追加不降级协议的双 Web 回环地址解析、Node 可信 TLS GET 预检、6 项配置/安全离线测试，并将配置专项纳入 `ready`。协作容器已以 GitHub 原文件 Blob 校验执行 Node 离线 6/6，并以临时 HTTPS 服务验证证书拒绝/显式信任路径；Windows 新 HEAD 的 `vp check`、`ready`、真实 React/Vue Chrome/Edge 布局与发布预检专项尚待维护者复测。PR 保持 Open / Draft，未获本次单独合并授权，不合并。

## 2026-11-18 · PR #87 授权合并与第三十五批第四小批服务端只读预检

维护者 Windows 已真实完成 PR #87：React/Vue 两种分辨率共四组浏览器布局 **19/19**，双框架发布预检专项退出码 **0**；Vitest **596/596**，HTTP E2E **51/51**，`vp check` **343/198** 零告警，文档 **86 份**，完整 `pnpm run ready` **退出码 0**。日志未附本机 Git HEAD；GitHub PR #87 合并前 HEAD 为 `c16595774798e213f2da4bfea4cfd718677cf3be`，维护者本次明确授权后 Squash 合并到 `main@602540baa570dfca21bd56f71ec634bb0263312d`。

第四小批从该 main 建立 `feat/v0.3-b35-server-release-preflight-readonly`：NestJS 工程 API 新增受 OIDC 会话及 `version:read` ACL 保护的 GET 当前版本预检，Prisma 在单个工程共享锁事务里检查 head、完整历史快照，再复用 Core SVG 只读报告。新增 6 项仓储单测与 4 项 HTTP E2E；全量 Vitest 目标 **602/602**、NestJS HTTP E2E 目标 **55/55**，都只是候选目标，**Windows 尚未实测**。不实现正式发布指针、写入、回滚、ACL 变更或工业设备操作；新 PR 继续 Draft 并指派 `@adui-dev`。

## 2026-11-18 · 第三十五批第五小批：真实隔离 PostgreSQL 只读发布预检联调

第四小批 PR #88 在维护者 Windows `602/602` Vitest、`55/55` HTTP E2E、Vite+ `343/198` 零告警、完整 `ready` 退出码 0 的证据下，经本轮明确授权 Squash 合并至 `main@058277f20088d20e0d3f6cd58ff553868cc92c48`；仍未获得本地 Git HEAD 与真实 Keycloak+PostgreSQL 新 GET 专项结果。

第五小批从该 main 建立 `feat/v0.3-b35-release-preflight-db-http`，**不修改生产接口**，只在既有隔离数据库 Cookie HTTP E2E 的随机租户夹具中新增 4 项真实 PostgreSQL 回归，覆盖报告 200/401、旧 head 409/当前版本不兼容报告、动态 ACL 404、篡改测试版摘要 500 与零额外版本/审计。沿用 `SCADA_TEST_DATABASE_URL` 仅允许本机 `adui_scada_test` 的前置保护；不引入 Keycloak 交互、测试库之外的写入、Schema 迁移或工业设备写入。候选 Windows `vp check`、`docs:check`、`ready` 与独立 `test:db` **待运行**，Draft PR 等待新一轮验收和授权。

## 2026-11-18 · 第三十五批第六小批：真实 OIDC 发布预检只读联调候选

PR #89 在维护者 Windows 真实 PostgreSQL 36/36、单测 602/602、HTTP E2E 55/55、Vite+ 343/198 零警告、完整 `ready` 退出码 0 的证据下获明确授权，已 Squash 合并至 `main@9825a80badffa7863590b893a337c4c52e9e0d29`。终端日志没有本地 HEAD，不能声明严格 SHA 绑定。

本批从该 main 创建 `feat/v0.3-b35-oidc-release-preflight-readonly`，不改生产 Controller/仓储/Schema/双 Web UI，只增加复用真实 Keycloak 隔离浏览器及双 HTTPS Origin 的服务端发布预检 GET 验收脚本和 11 项 Node 离线安全测试。浏览器仅检查已有、同时具备工程和版本读取权限的当前已保存工程，核对报告/摘要/水位与 400/409/no-store，不修改工程、版本、ACL、数据库 Schema 或工业设备。离线专项纳入 `ready`；真实交互需要手工登录并单独运行。Windows 质量链与真实 Keycloak 浏览器结果**待维护者复验**。FR-008 正式发布与回滚仍未交付，新 PR 必须 Draft 并指派 `@adui-dev`。

## 2026-11-18 · PR #90 授权合并与第三十五批第七小批候选

维护者上传 PR #90 Windows 原始日志：OIDC 发布预检 Node 专项 **11/11**、`vp check` **345 格式文件 / 200 受检文件零告警**、86 份文档检查、Vitest **602/602**、NestJS HTTP E2E **55/55**、React/Vue/NestJS 类型检查与构建及完整 `ready` **退出码 0**。真实 Keycloak 双 HTTPS Origin 发布预检浏览器专项独立连续执行两次，React/Vue 版本摘要、400/409、无缓存均通过，两次退出码均 **0**。未提供独立 `git rev-parse HEAD`，不能声称 Windows 结果已严格 SHA 绑定。经本轮维护者明确授权，PR #90 已 Squash 合并至 `main@1e891193f0a4fb9191b1f24bdf369713c7e54aeb`。

第七小批从新 main 建立 `feat/v0.3-b35-api-release-preflight-readonly`，仅增加共享 API Client 的 `preflightRelease` 同源 GET、服务端最小只读报告严格解析及 8 项单测；更新现有 Studio 会话类型 Mock 和需求/设计/代码索引。React/Vue Studio 尚**未**改用此 API，当前本地静态预检 UI 保持不变；正式发布、发布回滚与设备写入仍未实现。候选 Vitest **610/610** 为待测目标，既有 HTTP E2E **55/55** 亦须复验；新分支 Windows `vp check`、`test:unit`、`docs:check`、`ready` 均尚未执行，新 PR 必须 Draft 并指派 `@adui-dev`。

## 2026-11-18 · 第三十五批第八小批双框架 Studio 服务端只读预检候选

维护者 Windows 已真实通过 PR #91：Vitest **610/610**、NestJS HTTP E2E **55/55**、Vite+ **345 文件格式 / 200 文件零告警**、86 个 Markdown 文档检查、React/Vue/NestJS 类型检查与构建，完整 `pnpm run ready` **退出码 0**。维护者本轮明确授权后，PR #91 以 `ea4c6f93cf16edabb070e81fb0c9fc23c455c3f0` Squash 合并到 `main@1e4626bf7e8a2f08e5c4bc52c8907f3bc2149b28`。用户原始日志未附单独本地 `git rev-parse HEAD`，因此不声明严格 SHA 绑定。

第八小批从新 main 建立 `feat/v0.3-b35-studio-server-preflight-readonly`；新增共享 API Client 四段 GET 编排及 5 项单测，React/Vue Studio 独立手动预检面板，保留本地当前画布静态预检、对照已保存快照避免把未保存编辑内容误认为已获服务端许可。更新原浏览器 `test:release:preflight:browser` 对应 UI 入口检查。**候选尚未在 Windows 执行新的 `vp check`、`test:unit`、`docs:check`、`ready` 或浏览器专项**；目标 Vitest **615/615**、HTTP E2E **55/55** 为待测基线。正式发布、回滚、工程发布指针和工业设备写入未开放。

## 2026-11-18 · PR #92 已授权合并与第三十五批第九小批候选

维护者 Windows 原始日志确认 PR #92：Vitest **615/615**（51 文件）、NestJS HTTP E2E **55/55**（6 文件）、`vp check` **349 格式文件/204 受检零告警**、文档检查 **86 份**，React/Vue/Server 类型检查与构建均通过，完整 `pnpm run ready` 最终退出码 **0**；独立 `test:release:preflight:browser` React/Vue 双端合法、问题展示、JSON 恢复通过，退出码 **0**。日志未附独立 `git rev-parse HEAD`，不能严格 SHA 绑定；GitHub PR #92 HEAD `8c779edf1cbd59d2700e842fa75a6750ead8aeb2`，经本轮维护者明确授权 Squash 合并至 `main@172181972b424a19f8a00def6127fd35cb15a389`。

第九小批从该 main 创建 `feat/v0.3-b35-oidc-studio-preflight-browser`，只新增真实 Keycloak 双框架**UI 按钮点击**的交互浏览器专项及 12 项离线安全用例和根命令/文档。通过现有授权工程的正式 UI 载入后，以只读门禁检查四段 GET、未保存画布变更/旧结果清理、401/404/409 模拟拒绝，以及本地草稿/CAS 保护。**没有正式发布/回滚/设备写入，也没有新增工程或 ACL 写入模式**。隔离 V8 正反向模拟 12/12 仅属本轮源码模拟，Windows Node `--test`、`vp check`、完整 `ready` 与真实 Keycloak 浏览器**均待维护者实测**。

## 2026-11-18 · PR #93 E-052 质量门禁提醒

维护者 Windows 提供 PR #93 的首次 `vp check --fix`：206 个受检文件，**0 错误但 3 条 TypeScript Lint 警告**（两条对象方法未绑定、一条未知 Fetch 对象隐式字符串化）。原分支的 12 项 Node 安全用例和真实 Keycloak UI 验收不能因此声明已通过。GitHub 当前 Draft 分支仅修复两个脚本的相关表达式与测试断言，继续保持安全的只读 GET、跨 Origin/非 GET 阻断和 React/Vue 对等要求，未改生产代码。Windows 无警告 `vp check`、完整 `ready` 与真实浏览器按钮专项继续待验收，不合并 PR #93。

## 2026-11-18 · PR #93 验收合并与第三十五批第十小批候选

用户 Windows 日志：Studio OIDC 配置 **12/12**，`vp check` **351 格式文件/206 受检零告警**，Vitest **615/615**、HTTP E2E **55/55**、文档 **86 份**、完整 `ready` **退出码 0**；另独立真实 Keycloak 双 HTTPS Origin Studio 发布预检按钮专项 React/Vue 均通过，退出码 **0**，包含当前画布与已保存版本差异及模拟 409/401/404。日志没有独立 `git rev-parse HEAD`，不能严格绑定 GitHub SHA。PR #93 经本轮维护者明确授权 Squash 合并至 `main@3d1a08ba44b5a3d7a78a90b9dbb2fd515a67f77f`，合并前 HEAD `f0f09b5fb48fb488a12a01c393c07da33e046358`。

第十小批从新 main 建立 `fix/v0.3-b35-preflight-late-auth-rejection`，按源码发现的 E-053 对等修复 React/Vue：即使只读预检期间编辑导致文档引用变化，迟到的 401/403/404 仍必须让父级服务端授权和 CAS 失效；过时报告和局部错误不转移至新画布。扩展原真实 Keycloak 专项的单次延迟 401 并新增 1 项离线测试，预计离线 **13/13**，Vitest **615/615** 和 E2E **55/55** 为候选目标，**尚未在 Windows 实测**。未新增数据库、Schema、工程写入或正式发布；FR-008 发布事务仍未实现。

## 2026-11-18 · PR #94 验收合并与第十一小批正式发布方案候选

维护者 Windows 原始日志确认 PR #94：Node Studio OIDC 离线安全测试 **13/13**，`vp check` **351 格式文件/206 受检零告警**，Vitest **51/51 文件、615/615**，NestJS E2E **6/6 文件、55/55**，Markdown **86 份**，React/Vue/Server 类型检查与构建均通过，完整 `pnpm run ready` **退出码 0**。维护者另在本机可信 Keycloak 双 HTTPS Origin 真实运行 Studio 按钮专项：React/Vue 的编辑期间迟到 401、409、404、CAS 失效和草稿保护均通过，退出码 **0**。日志未附独立 `git rev-parse HEAD`，不能严格 SHA 绑定。PR #94 经本轮明确授权，从 GitHub HEAD `19f86ee6c99632b4c2e1b8ea17c634e083da8855` Squash 合并至 `main@9727acdcf45516661f92a9f094d1158aa2c24651`。

第三十五批第十一小批从新 main 建立 `docs/v0.3-b35-release-transaction-design`，仅增加 [ADR-0069](adr/0069-release-pointer-atomic-publication-design.md) **Proposed**，形成正式发布指针、发布代次 CAS、成功审计事件、事务内授权、回滚限制与双框架 Runtime 安全验收的**候选**契约；同步需求、设计、架构与测试边界。**没有新增 Schema、迁移、发布 ACL、HTTP 写入或设备操作，也没有将 FR-008 标为已完成**。该文档分支的 Windows `docs:check` 与完整 `ready` 尚待维护者执行。

## 2026-11-18 · PR #95 授权合并与第三十五批第十二小批候选

维护者 Windows 原始日志确认 PR #95：文档检查 **87 份**、Vite+ **352 格式文件/206 受检零告警**、Vitest **615/615**、HTTP E2E **55/55**、OIDC Studio 离线安全 **13/13**、React/Vue/Server 类型检查及构建通过，完整 `pnpm run ready` **退出码 0**。GitHub 合并前 HEAD `d5ceea382b92734b408b41d546b9ba93646e9914`，获得维护者本轮明确授权后 Squash 合并至 `main@0bc70202f8d1cced27edd72d49fb1de05c44c58f`。Windows 日志未含本地独立 HEAD，不能严格绑定到该 SHA。

第十二小批从新 main 建立 `docs/v0.3-b35-release-decision-gates`，新增 [发布事务评审决策与验收矩阵](RELEASE_TRANSACTION_REVIEW.md)，把 Proposed ADR-0069 未决项拆分为 R-01～R-08 推荐但未批准的选项、I-01～I-06 不变量和 T-01～T-22 **未来**安全测试。同步需求/架构/SDD/代码索引与验收。此次**未新增** Prisma 迁移、权限、HTTP 写接口、Runtime 发布状态或工业设备操作；Windows `docs:check`、`vp check`、完整 `ready` 尚待实测。ADR-0069 继续 Proposed、FR-008 继续规划中。

## 2026-11-18 · 第三十五批第十三小批：ADR-0069 已获维护者批准

PR #96 的发布事务评审矩阵已完成 Windows 质量验收并经维护者明确授权后合并。随后维护者明确同意 ADR-0069 进入 **Accepted**，并批准 R-01～R-08 推荐基线。

本次批准确定以下架构边界：

- 发布与回滚采用独立工程级 `release:publish` / `release:rollback`，默认拒绝，不从编辑或读取权限自动继承。
- 首次正式发布只能针对事务内重新验证的当前已保存 head，使用 `expectedHeadRevision`、`targetRevision` 和 `expectedReleaseGeneration`。
- 幂等按租户/工程/操作主体/操作类型隔离；同语义重试复用成功结果，异语义冲突。
- 回滚只能指向本工程历史上成功正式发布且仍可验证的不可变版本，并产生新的发布代次。
- Runtime 只认独立发布指针，发布事务提交前不可见，异常时 fail-closed，不回落到编辑 head 或浏览器草稿。
- 成功发布/回滚事件、发布指针和 `releaseGeneration` 必须在同一 PostgreSQL 事务中原子提交。
- 发布前必须重新执行 Tag、数据源、Runtime/资源和工业安全门禁；本 ADR **不授予 PLC/DCS 或其他设备写入权限**。

ADR-0069 Accepted 只完成架构决策，不代表 FR-008 已实现。当前仍没有正式发布/回滚写 API、Prisma 发布模型、Runtime 发布指针加载或工业设备写入能力。后续 B～F 阶段必须分别建立独立 Draft PR，并完成隔离 PostgreSQL、双框架 Runtime、真实 Keycloak/HTTPS 和工业安全专项验收后再进入下一阶段。

当时 PR #97 承载本次 Accepted 决策文档更新并保持 Draft，Assignee 为 `@adui-dev`；该句记录的是本段形成时的状态，不代表当前 PR 状态。

## 2026-11-18 · PR #99 B 阶段 Prisma Client 类型错误修复待复验

维护者在 PR #99 Windows 分支执行 `vp check --fix`，发现 12 项 TypeScript 错误：本地 Prisma Client 仍为旧 Schema 生成物，缺少发布状态/事件 delegate；工程创建 DB 测试新增第五个 Promise 查询后遗漏第五个解构变量，导致 `releaseState` 未声明；发布事件目标版本关系还需补齐 Prisma 反向关系。

PR #99 已最小修复：

- `ScadaProjectVersion.releaseTargetEvents` 反向关系。
- `project-api.db-spec.ts` 五项查询与五个解构变量对应。
- 在 `docs/AI_MISTAKES.md` E-054 与 `docs/VALIDATION.md` 记录防复发及验收边界。

**修复后尚未在 Windows 复验**。下一步必须先执行 `pnpm run db:validate`、`pnpm run db:generate`，再运行 `vp check`；随后进行隔离 PostgreSQL 首次/二次迁移、`test:db`、`test:unit`、文档检查及完整 `ready`。不把旧生成客户端造成的类型错误解释成数据库模型已经迁移成功。

## 2026-11-18 · PR #99 B 阶段迁移与单测失败修复待 Windows 复验

维护者上传的 PR #99 Windows 日志：

- Prisma `db:validate` **0**、`db:generate` **0**，Vite+ **354 格式文件、207 受检文件零告警/错误，退出码 0**。
- 新迁移首次部署 **P3018 / SQLSTATE 42601**，二次部署 **P3009**。
- 日志显示迁移目标是本机开发库 `adui_scada`，**不是** `adui_scada_test`；不能计为隔离 PostgreSQL 验收。
- 真实 DB 测试未配置 `SCADA_TEST_DATABASE_URL`，5 个数据库测试文件按既有安全保护拒绝加载，没有执行用例。
- Vitest **615/616**：唯一失败是工程创建单测 Mock 缺少新增的发布状态 delegate；完整 `ready` 同样退出码 1。
- 文档检查 **88 份通过**。

PR #99 已修复：

- 完整重建正式发布 migration，恢复哈希/生命周期/事件约束，移除重复片段并用单一事务包裹；首条权限 CHECK 做存在性保护。
- 增加迁移 SQL 静态回归。
- 补齐工程创建测试的 `releaseStates.create` Mock、调用顺序及 generation=0 断言。
- 同步 `docs/HARNESS.md` 隔离库流程、`docs/VALIDATION.md` 和 E-055～E-057。

**重要：原 `adui_scada` 数据库中是否已保留首条权限 CHECK 尚未确认。** 暂停对该库的迁移和任何 resolve/删除操作，先做只读检查。修复后的 SQL 尚未在 PostgreSQL 执行，Vitest/ready 也尚未复验。下一步只允许把 `SCADA_DATABASE_URL` 与 `SCADA_TEST_DATABASE_URL` 临时指向本机 `adui_scada_test`，按 `docs/HARNESS.md` 的 `try/finally` 步骤完成首次/二次迁移和数据库测试；随后再根据只读检查结果制定原 `adui_scada` 的恢复方案。
本轮新增 1 项迁移 SQL 静态回归，修复后全量单元测试验收目标为 **618/618**；这是待 Windows 实测目标，不是通过结果。

## 2026-11-18 · PR #99 失败迁移状态已只读确认，修复约束恢复逻辑待验收

维护者 Windows 使用仓库当前 Compose 参数完成 PostgreSQL 只读检查，退出码 0。实际数据库为 `adui_scada`；迁移 `20261118000000_release_state_and_events` 有 started_at、finished_at 与 rolled_back_at 均为空。首条 `scada_project_grants_permission_check` 已持久化，但仍只允许原三项工程/版本权限；发布事件表和发布状态表均不存在。

因此原失败迁移留下了部分 DDL，不能称为整体回滚。PR #99 已将迁移开头改为在事务内先删除同名旧 CHECK，再按五项权限重建，并增加静态测试防止只按约束名称存在性而跳过旧定义（E-059）。**开发库尚未执行任何恢复写入**。

下一步：先在独立 `adui_scada_test` 验收修复迁移首次/二次部署、状态及数据库测试；对现有 `adui_scada` 完成可恢复备份并取得维护者明确授权后，才执行 `migrate resolve --rolled-back` 和修复迁移重试。修复后的 Windows `vp check`、`test:unit`、`test:db`、`ready` 均待复验。另：本轮对话上传的根 `.env` 含有凭据类配置，应按已披露凭据受控轮换，具体见安全提醒；不得将值写入仓库文档。

## 2026-11-18 · PR #99 Windows 代码质量复验通过，隔离 PostgreSQL 验收待执行

维护者提供的最新 Windows 日志：

- `pnpm run db:validate`：Prisma Schema valid，退出码 0。
- `pnpm run db:generate`：Prisma Client 7.10.1 生成成功，退出码 0。
- `vp check`：354 个文件格式正确，207 个受检文件零警告、Lint/TypeScript 错误，退出码 0。
- `pnpm run test:unit`：51/51 文件、**618/618** 项通过，退出码 0。
- `pnpm run docs:check`：88 份 Markdown 通过，退出码 0。

本轮单测已覆盖发布 Schema SQL 静态完整性、失败迁移旧权限 CHECK 替换和新工程 generation=0 状态 Mock；此前 615/616 的唯一失败已关闭。日志未提供本机 `git rev-parse HEAD`，不作 GitHub HEAD 严格绑定。

**尚未完成**：本机隔离 `adui_scada_test` 的首次/二次迁移、`migrate status`、真实 PostgreSQL `test:db` 和完整 `pnpm run ready`。现有开发库 `adui_scada` 的部分失败迁移已只读确认，仍保留旧三项权限 CHECK；未经隔离库验收、可恢复备份及维护者明确授权，不执行 `migrate resolve --rolled-back` 或任何开发库恢复写入。PR #99 继续 Draft，Assignee `@adui-dev`。

## 2026-11-19 · PR #99 隔离数据库状态已确认，待执行正式发布迁移

维护者 Windows 已确认 `adui_scada_test` 存在，`docs:check` 88 份通过，退出码 0。隔离库 `db:migrate:status` 成功连接本机 `127.0.0.1:15432/adui_scada_test`，报告 5 条已发现迁移及唯一待执行项 `20261118000000_release_state_and_events`，未报告 failed migration / P3009；该状态命令在当前 Prisma CLI 下返回退出码 1，PowerShell `finally` 已恢复原环境变量，且本次没有执行迁移写入。

这表示隔离库处于正常待部署状态，不是迁移失败。E-060 已记录退出码误判，`docs/HARNESS.md` 已修正。下一步在确认 PR 分支 HEAD 后，直接在隔离库执行首次 `db:migrate:deploy`、二次部署、部署后 `migrate status` 和 `test:db`；之后执行完整 `ready`。原开发库 `adui_scada` 的部分失败迁移仍不做恢复，等待隔离库验收、可恢复备份和维护者明确授权。

## 2026-11-19 · PR #99 隔离迁移通过，数据库测试清理逻辑已修复待复验

维护者 Windows 在本机隔离 PostgreSQL `adui_scada_test` 上实测：

- 首次 `db:migrate:deploy` 成功应用正式发布迁移，退出码 0。
- 二次部署提示无待执行迁移，退出码 0。
- `db:migrate:status` 提示 Database schema is up to date，退出码 0。
- `test:db`：4/5 文件、30/41 项通过；双 Cookie HTTP 数据库测试 11 项失败，均因 fixture finally 删除工程前未删除新建的发布状态行，触发 `scada_project_release_state_project_fkey` RESTRICT。

PR #99 已修复三个真实 PostgreSQL 测试文件的 teardown 顺序：先删发布状态，再删发布事件，再删审计、版本、授权和工程；并在 HARNESS / VALIDATION / AI_MISTAKES E-061 记录。生产外键、迁移 SQL 与业务代码均未修改。

**待 Windows 复验**：修复后的 `pnpm run test:db`、最新 `docs:check` 和完整 `pnpm run ready`。原开发库 `adui_scada` 的失败迁移仍不恢复，直到隔离验收、可恢复备份和维护者明确授权。

## 2026-11-19 · 第三十五批 B 阶段正式发布 Schema 验收通过

维护者 Windows 已完成 PR #99 对应候选代码的隔离 PostgreSQL 专项与完整质量链：

- 隔离库 `adui_scada_test`：正式发布迁移首次部署成功、二次部署无待执行项、部署后 `migrate status` up to date，均退出码 0。
- `pnpm run test:db`：5/5 文件、41/41 项通过；双 Cookie HTTP CAS 11/11、工程版本 12/12、工程 API 7/7、OIDC Schema 6/6、发布 Schema 5/5。
- `pnpm run ready`：最终退出码 0；包括 618/618 单测、55/55 HTTP E2E、354 文件格式正确、207 受检文件零警告/错误、88 份文档检查、React/Vue/Server 类型检查及三端构建。

此前新增发布状态 RESTRICT 外键导致的 11 项 DB 测试清理失败已通过调整测试夹具依赖顺序修复；没有放宽或删除生产外键，没有修改已应用迁移。

**仍未完成**：维护者日志没有提供 `git rev-parse HEAD`，所以实测结果不能严格绑定到当前 GitHub SHA；本次文档同步后需再运行 `docs:check`。原开发库 `adui_scada` 的历史失败迁移仍未恢复，必须先备份并取得维护者明确授权。正式发布/回滚 API、Runtime 发布指针切换、CAS/幂等业务逻辑、双人审批和工业设备写入仍未开放。

当时 PR #99 继续保持 Open / Draft，Assignee 为 `@adui-dev`；当时 PR #97 仍为 Open / Draft，需先完成 Accepted 决策文档验收与合并。该记录是 PR #97 合并前的历史状态。

## 2026-11-19 · PR #97 合并与 PR #99 分支同步

PR #97 已完成维护者 Windows 文档验收后 Squash 合并至 `main`，合并提交为 `8a622f8766856069065ee7d5cbadeb826646e676`。该提交正式将 ADR-0069 Accepted 决策、R-01～R-08 批准基线及对应文档同步纳入主线。

PR #99 已从原功能分支 `c38de5ca38cc619a1128a84b63eca3523f42c9d7` 合流最新 `main`。本次只合并 PR #97 的十份文档变更；PR #99 原有 Prisma Schema、迁移 SQL、权限实现和测试源码保持不变。该同步不执行任何数据库命令，也不触碰原开发库 `adui_scada`。

PR #97 的 Windows `docs:check` 为 89 份 Markdown、退出码 0；该终端记录没有同时提供本地 HEAD，因此不声称其结果严格绑定到 PR #99 同步后的 HEAD。PR #99 同步后仍须在 Windows 最新 HEAD 执行 `vp check` 与 `pnpm run docs:check`；此前 618/618 单测、41/41 隔离 PostgreSQL 测试、55/55 HTTP E2E 和完整 `ready=0` 对应的代码未被本次文档合流修改，但本次同步本身不构成重新执行这些测试的证据。

PR #99 继续保持 Open / Draft，Assignee 为 `@adui-dev`。原开发库 `adui_scada` 的失败迁移仍冻结；恢复操作必须等待可恢复备份和维护者单独明确授权。

## 2026-11-19 · PR #99 发布状态复合引用完整性修复（E-062）

PR #99 分支同步 PR #97 后的静态评审发现，原发布状态 lastReleaseEventId 仅以全局 UUID 引用发布事件，没有在数据库级绑定租户、工程、发布代次、目标修订和摘要；发布状态及事件的版本引用也未把 SHA-256 与不可变版本联合约束。该问题在正式发布 API 尚未实现时发现，没有真实跨工程发布写入事故证据。

已在 PR #99 新增增量迁移 20261119000000_release_state_event_integrity，不修改已应用的 20261118000000_release_state_and_events。新迁移为工程版本建立摘要复合唯一键，将发布事件来源/目标版本、发布状态目标版本与最后发布事件全部改为租户/工程/修订/摘要/代次复合外键；Prisma Schema、静态迁移测试和隔离 PostgreSQL 负向测试同步更新。目标是让 PostgreSQL 直接拒绝跨工程事件引用、代次不匹配和摘要不匹配。

新增 Windows 验收目标：单测 **620/620**、隔离 PostgreSQL **42/42**，另需新迁移首次/二次部署、status、vp check、docs:check 和完整 ready 实测。此前 618/618、41/41 和完整 ready=0 属于本次完整性修复之前的代码，不得作为新迁移验收结果。

原开发库 adui_scada 的失败迁移仍冻结；本次新增迁移只允许先在隔离 adui_scada_test 验收。PR #99 继续保持 Open / Draft，Assignee 为 @adui-dev，未获得合并授权。

## 2026-11-19 · PR #99 Prisma Schema 关联属性语法修复（E-063）

维护者 Windows 在最新候选执行 db:validate 时，Prisma 7.10.1 对 releasedVersion、lastReleaseEvent、fromVersion、toVersion 四个字段报告 P1012；根因是将字段级 @relation(...) 属性拆成多行，Prisma Schema 解析器不接受这种字段声明形式。db:generate 同样失败；test:unit 在 Vitest 启动前执行 db:generate，因此本次没有进入单元测试。

已在 PR #99 将四个完整 @relation 属性恢复为单行，并在 prisma-schema-comments.spec.ts 增加静态回归，防止再次拆行。保留关系名称、复合字段、引用字段和删除/更新行为；没有修改两条迁移 SQL、数据库或业务权限代码。

维护者随后在 HEAD e02e48e4ae46fb0e02ab6ee3ab3b21872d58134f 重新执行 db:validate 与 db:generate：E-063 的 28 条字段解析错误已消失，但出现 lastReleaseEvent 一对一复合字段不唯一的第二条 P1012（E-064）；test:unit 在 Prisma Client 生成阶段中止，Vitest 未启动。同期 vp check 355 个格式文件、207 个受检文件零警告/错误，docs:check 89 份通过。这些是 E-064 修复前结果。

## 2026-11-19 · PR #99 Prisma 一对一发布事件关系修复（E-064）

维护者 Windows 在 HEAD e02e48e4ae46fb0e02ab6ee3ab3b21872d58134f 重新执行 Prisma 检查时，E-063 的字段多行解析错误已消失；Prisma 7.10.1 随后报告 lastReleaseEvent 一对一关系的六个关联字段没有匹配唯一约束。db:generate 同样失败，test:unit 在 Vitest 启动前因 Prisma Client 生成失败而中止。vp check 355/207 零警告错误、docs:check 89 份通过。

根因是复合关系字段包含 releasedRevision、releasedContentHash、lastReleaseEventId 三个可空字段；Prisma @@unique 要求全部组合字段必填，不能通过修改未发布状态语义解决。

已将 Prisma ORM 导航关系改为使用已有唯一 lastReleaseEventId -> eventId 建立一对一；数据库层第二条迁移中的六字段复合外键保持不变，继续校验租户、工程、代次、目标修订、摘要与事件 UUID。没有新增或修改迁移 SQL，也没有执行数据库写入。静态回归同步检查 ORM 单字段关系与 SQL 六字段约束。

本次修复后仍待 Windows 重新执行 db:validate、db:generate、vp check、test:unit（目标 620/620）、隔离 PostgreSQL test:db（42/42）、docs:check 与完整 ready。原开发库 adui_scada 的失败迁移继续冻结。