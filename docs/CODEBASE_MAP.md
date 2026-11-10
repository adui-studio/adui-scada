# ADui SCADA · 代码地图

> 2026-11-09，基于 V0.1 Web 整合开发分支；分支尚待完整本地依赖安装、类型检查及构建验收。

| 路径                                            | 已实现职责                                                   |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `apps/web-react/src/App.tsx`                    | React Web 应用根，按需加载 Runtime                           |
| `apps/web-react/src/runtime/RuntimePage.tsx`    | React 只读水处理监控                                         |
| `apps/web-vue/src/App.vue`                      | Vue Web 应用根，按需加载 Runtime                             |
| `apps/web-vue/src/runtime/RuntimePage.vue`      | Vue 只读水处理监控                                           |
| `apps/server/src/`                              | NestJS 12 ESM 模块化启动和本地 GET /health                   |
| `apps/server/test/`                             | Vitest + Supertest E2E 验证                                  |
| `apps/desktop/src-tauri/`                       | Tauri 2 Rust 桌面壳及最小能力权限                            |
| `apps/desktop/src-tauri/tauri.vue.conf.json`    | 选择 Vue Web 构建目标                                        |
| `packages/core/src/`                            | 工程文档、TagStore、模拟器、SVG                              |
| `packages/core/src/demo-document.ts`            | HTTP 演示与离线 MSI 复用的水处理工程                         |
| `packages/runtime/src/`                         | SSE 浏览器订阅、质量状态、样式                               |
| `packages/runtime/src/offline.ts`               | MSI 专用离线模拟 Tag、模拟断线和定时器清理                   |
| `packages/core/test/`、`packages/runtime/test/` | Vitest 单元测试                                              |
| `examples/water-treatment/`                     | 非生产模拟服务及诊断页面                                     |
| `.editorconfig`                                 | 唯一编辑器格式基线（含 Rust 4 空格规则）                     |
| `packages/tsconfig/*.json`                      | `@adui/tsconfig/{react,vue,nest,node,vue-node,core,browser}` |
| `packages/tooling/src/`                         | `@adui/tooling/{format,lint,staged}` 统一代码规范            |
| `pnpm-workspace.yaml`                           | 统一依赖版本的 Catalog                                       |
| `vite.config.ts`                                | Vite+ 的格式、Lint、Vitest 配置                              |
| `scripts/check-dependency-catalog.mjs`          | Catalog 依赖一致性检查                                       |
| `scripts/check-shared-config.mjs`               | 共享 TSConfig / Format / Lint 引用检查                       |
| `scripts/validate-docs.mjs`                     | 文档静态检查                                                 |

当前桌面 MSI 使用 `--mode desktop` 静态切换离线模拟；Web 开发仍使用 `/demo` 代理。两种模式共用一份演示工程，均不得被解释为现场生产数据。

目标但**尚未完整实现**：完整 Studio 图元管理和编辑能力、`apps/gateway`、生产 NestJS API、Tauri 生产离线数据能力与 3D 引擎。V0.2 首批 `src/studio` 已建立，Studio 与 Runtime 共用一个 Web 应用，但 Runtime 不依赖编辑器代码。

[架构](ARCHITECTURE.md) · [开发进度](PROJECT_CONTEXT.md) · [Harness](HARNESS.md)

## V0.1 Docker 本地演示

- `deploy/docker/compose.demo.yaml`：双框架 Web + NestJS /health + SSE 模拟器的本地演示 Compose。
- `deploy/docker/Dockerfile.web`：通过 `WEB_APP` 参数选择构建 React / Vue，Nginx 静态运行。
- `deploy/docker/Dockerfile.server`：NestJS 多阶段构建、Node 24 运行时。
- `deploy/docker/Dockerfile.demo`：独立模拟 SSE 服务；无工业设备权限。
- `deploy/docker/nginx.conf`：同源代理固定演示接口，关闭 SSE 缓冲，避免 SPA 错误回退。
- `.dockerignore`：限制 Docker build context，不上传本地依赖、构建产物及私有环境文件。

见 [部署说明](../deploy/docker/README.md)。**尚未 Docker 运行验收**，不代表生产部署能力。

## 统一环境变量与 LF

- `.env.example`：**唯一**根目录模板；本地配置为被 Git 忽略的根 `.env`。
- `apps/web-react/vite.config.ts` / `apps/web-vue/vite.config.ts`：共享根 `envDir`，各自开发端口和本机模拟代理。
- `apps/server/src/main.ts` / `examples/water-treatment/server.mjs`：Node `loadEnvFile` 读取根目录。
- `deploy/docker/compose.demo.yaml`：读取同一根 `.env`；Nginx 模板与进程健康检查使用一致的容器内部端口。
- `deploy/docker/nginx.conf` + `Dockerfile.web`：官方 Nginx 启动时执行 envsubst，不把 `.env` 打包进静态镜像。
- `scripts/check-env-config.mjs`：唯一模板、端口与 Git LF 静态检查。
- `.gitattributes` / `.editorconfig`：Git 工作区与编辑器统一 LF；`.bat/.cmd` 使用 CRLF。

详见 [环境配置说明](ENVIRONMENT.md) 与 [ADR-0010](adr/0010-root-env-lf.md)。

## V0.2 Studio 第一阶段新增入口

- `packages/core/src/editor.ts`：`@adui/scada-core/editor` 的框架无关 DocumentEditor / withNodePosition，验证及撤销重做。
- `packages/core/test/editor.test.ts`：移动、回退、非法输入和 JSON 互通单测。
- `apps/web-react/src/studio/StudioPage.tsx`：React 编辑器视图，原生 SVG 与 Pointer Events。
- `apps/web-vue/src/studio/StudioPage.vue`：Vue 编辑器视图，消费相同 Command / Schema。
- `apps/web-react/src/studio/studio.css`、`apps/web-vue/src/studio/studio.css`：各框架独立 UI 样式。
- `apps/web-react/src/App.tsx`、`apps/web-vue/src/App.vue`：按需加载 Runtime 与 Studio 的视图导航。

两套 Studio 功能以共享 Core 实现一致，不引入设备写入；当前只能导入导出本地 JSON 草稿，尚未实现正式工程持久化。详见 [Studio 使用与验收](V0.2_STUDIO.md)。

## V0.2 第二批画布操作

- `packages/core/src/editor.ts`：扩充 `DocumentEditor` 的 `selectedIds`、`moveBy`、`addNode`、`deleteSelected`、`alignSelected`、`reorderSelected`，导出 `withNodesTranslated` 用于组合拖拽预览。
- `packages/core/test/editor.test.ts`：新增多选、边界移动、节点增删、对齐、图层排序、撤销、JSON 往返的单元用例。
- `apps/web-react/src/studio/StudioPage.tsx` / `apps/web-vue/src/studio/StudioPage.vue`：新增缩放工具、图元添加/删除、Shift 多选、图层按钮与对齐按钮。
- `apps/web-react/src/studio/studio.css` / `apps/web-vue/src/studio/studio.css`：完全一致的画布滚动、缩放栏和操作按钮样式。
- 操作方法及限制见 [V0.2 Studio](V0.2_STUDIO.md)。

## V0.2 框选与键盘辅助交互

- `packages/core/src/editor.ts`：`findNodesInRect`（旋转外接矩形相交）、`DocumentEditor.selectMany`（原子批量选择）。
- `apps/web-react/src/studio/StudioPage.tsx`：空白 SVG 框选与 React Effect 键盘监听，卸载时清理。
- `apps/web-vue/src/studio/StudioPage.vue`：相同框选逻辑，`onMounted` / `onUnmounted` 管理键盘监听。
- 两端 `studio.css`：不参与命中的选区叠加框。
- `packages/core/test/editor.test.ts`：反向框选、旋转命中、非法输入、批量选择、框选后移动撤销。

## 简体中文提示与诊断输出

- `packages/core/src/tag-store.ts` 的 `TAG_QUALITY_LABELS`：只为 `GOOD/UNCERTAIN/BAD/STALE` 提供中文可见名称，原协议值不变。
- `packages/runtime/src/runtime.ts` 的 `RUNTIME_STATUS_LABELS`：只为内部 Runtime 状态提供统一中文显示名称。
- `packages/core/src/svg.ts`：SVG 质量标记、泵运行状态与未知图元提示改为中文；演示工程标题及文本见 `packages/core/src/demo-document.ts`。
- `apps/web-react/src/runtime/RuntimePage.tsx`、`apps/web-vue/src/runtime/RuntimePage.vue`：两端统一使用共享中文状态与质量名称。
- `scripts/check-chinese-messages.mjs`：扫描自研异常、测试标题、日志与注释的中文化质量门禁，根 `package.json` 的 `messages:check` 和 `ready` 调用它。
- 统一约束见 [中文文案规范](LOCALIZATION.md) 与根 [AGENTS](../AGENTS.md)。

## V0.2 网格与吸附模块

- `packages/core/src/snap.ts`：默认网格常量、可选网格/图元吸附、旋转外接框参考点、边界保护与辅助线结果。
- `packages/core/src/editor.ts`：经 `@adui/scada-core/editor` 子入口导出独立吸附计算函数。
- `packages/core/test/snap.test.ts`：纯函数用例，验证网格、参考线、无意跨轴移动防护、组合移动、边界和非法输入。
- `apps/web-react/src/studio/StudioPage.tsx`、`apps/web-vue/src/studio/StudioPage.vue`：网格显示、吸附开关、预览及最终提交复用共享位移。
- `apps/web-react/src/studio/studio.css`、`apps/web-vue/src/studio/studio.css`：相同的开关与辅助线样式。
- 使用方式见 [V0.2 Studio](V0.2_STUDIO.md) 与 [ADR-0012](adr/0012-grid-snap-guides.md)。

## V0.2 第五批图元几何属性编辑

- `packages/core/src/editor.ts`：新增 `withNodeTransform` 和 `DocumentEditor.updateSelectedTransform`；合法单选、原子变更、严格数值/边界验证及撤销历史。
- `packages/core/test/editor.test.ts`：增加 6 项几何编辑回归测试，覆盖单次提交、撤销/重做、非法字段及数值、画布边界、多选保护。
- `apps/web-react/src/studio/StudioPage.tsx`：React 原生数值表单，单选后可编辑 X/Y/宽高/旋转；提交调用共享 Core。
- `apps/web-vue/src/studio/StudioPage.vue`：Vue 同等属性表单与中文反馈；继续复用 Core 契约。
- 两套 `studio.css`：同步的双列几何表单样式。
- 验收与设计参见 [V0.2 Studio](V0.2_STUDIO.md)、[SDD](SDD.md) 和 [ADR-0013](adr/0013-node-transform-properties.md)。此分支以 PR #6 为基础，尚未在 Windows 执行本批测试。

## V0.2 第六批 SVG 缩放与旋转手柄

- `packages/core/src/transform-gesture.ts`：新增纯数学 `resolveResizeTransform` / `resolveRotationTransform` 与 `RESIZE_HANDLES`，可处理旋转图元缩放的局部坐标与对角锚点。
- `packages/core/src/editor.ts`：从现有 `@adui/scada-core/editor` 导出手柄计算能力，统一由 `withNodeTransform` 验证最终布局。
- `packages/core/test/transform-gesture.test.ts`：新增 11 项 Core 单测，覆盖四角手柄、旋转、Shift 角度吸附、异常和预览/撤销。
- `apps/web-react/src/studio/StudioPage.tsx` 与 `apps/web-vue/src/studio/StudioPage.vue`：在单选图元上叠加四角矩形控制点、旋转圆形控制点；Pointer move 只预览，Pointer up 单次提交。
- 两套 `studio.css`：一致的缩放/旋转控制点、颜色和光标。
- 文档及约束详见 [SDD](SDD.md)、[V0.2 Studio](V0.2_STUDIO.md) 与 [ADR-0014](adr/0014-svg-transform-handles.md)。该分支依赖前两批未合并 PR。
