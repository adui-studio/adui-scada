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
