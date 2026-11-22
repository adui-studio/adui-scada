# ADui SCADA · 代码地图

> **开始编码前**：按根目录 [AGENTS.md](../AGENTS.md) 的要求，先重读 [AI 编码错误复盘清单](AI_MISTAKES.md) 全文；本文件只用来定位代码与文档，不能替代复盘与仓库规范。

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
- `packages/core/test/transform-gesture.test.ts`：新增 12 项 Core 单测，覆盖四角手柄、旋转、Shift 角度吸附、异常和预览/撤销。
- `apps/web-react/src/studio/StudioPage.tsx` 与 `apps/web-vue/src/studio/StudioPage.vue`：在单选图元上叠加四角矩形控制点、旋转圆形控制点；Pointer move 只预览，Pointer up 单次提交。
- 两套 `studio.css`：一致的缩放/旋转控制点、颜色和光标。
- 文档及约束详见 [SDD](SDD.md)、[V0.2 Studio](V0.2_STUDIO.md) 与 [ADR-0014](adr/0014-svg-transform-handles.md)。该分支依赖前两批未合并 PR。

## V0.2 旋转手柄光标资源

- `assets/cursors/rotate.svg`：仓库共享的透明环形旋转鼠标图形，32×32，光标中心热点。
- 双框架 `studio.css`：旋转控制点和旋转拖动状态共用一个 SVG 光标，浏览器不支持时使用 `grab`。
- 两套 `StudioPage`：仅在视图中标记当前是否正在旋转，松开、Esc 或 PointerCancel 清除；不写入工程 JSON。

## V0.2 第七批：八方向缩放

- `packages/core/src/transform-gesture.ts`：八方向 `RESIZE_HANDLES`、共享中文标签、`resizeHandlePosition` 与单轴/双轴旋转中心计算。
- `packages/core/src/editor.ts`：统一从 `@adui/scada-core/editor` 导出扩展后纯函数与标签，不更改原命令签名。
- `packages/core/test/transform-gesture.test.ts`：从 12 项扩充至 19 项，新增 7 项边中点坐标、局部轴、旋转锚点、精度和撤销/边界测试。
- React / Vue `src/studio/StudioPage`：复用共享定位函数绘制八个缩放点，Aria 名称使用中文位置。
- React / Vue `src/studio/studio.css`：边中点对应 `ns-resize`、`ew-resize`，四角和旋转光标继续保持一致。
- [ADR-0015](adr/0015-eight-direction-resize.md) 说明单轴投影与兼容性；验证见 [HARNESS](HARNESS.md)。

## V0.2 第八批：Shift 等比例缩放

- `packages/core/src/transform-gesture.ts`：在 `resolveResizeTransform` 增加可选 `lockAspectRatio` 参数，按主轴缩放因子同步宽高，保持原有局部旋转锚点计算。
- `packages/core/test/transform-gesture.test.ts`：新增 9 项单元用例，覆盖四角/边中点、原比例、旋转锚点、零位移、非法尺寸、不可变预览、撤销和 Tag 绑定。
- React/Vue 两套 `src/studio/StudioPage`：拖动时传入 `event.shiftKey`；缩放控制点增加统一中文 SVG 提示。两端现有 CSS 和 Runtime 未修改。
- `docs/adr/0016-aspect-ratio-resize.md`：记录相对缩放主轴选择、对侧锚点与精度取舍。

## V0.2 第九批：多图元逻辑组合与解组

- `packages/core/src/document.ts`：`ScadaNode.groupId?: string` 的稳定 ID、同页、最少两成员、命名冲突验证与防御性 JSON 往返。
- `packages/core/src/grouping.ts`：共享的 `expandGroupedSelection`，保证移动、框选和吸附在完整组合范围内操作。
- `packages/core/src/editor.ts`：`DocumentEditor.groupSelected/ungroupSelected`，组员自动选中、撤销重做及单体属性/对齐保护。
- `packages/core/src/snap.ts`：在计算网格/图元吸附前扩展全部组合成员，保证预览与提交一致。
- `packages/core/test/document.test.ts`、`packages/core/test/editor.test.ts`：新增 4 项 JSON 校验和 9 项组合编辑回归用例。
- `apps/web-react/src/studio/StudioPage.tsx`、`apps/web-vue/src/studio/StudioPage.vue`：双端「组合所选/解组」、分组归属显示及组合编辑权限禁用。
- [ADR-0017](adr/0017-node-grouping.md) 记录平面结构选择、JSON 兼容风险与暂未支持的操作。

## V0.2 第十批：Schema 0.2.0 迁移

- `packages/core/src/document.ts`：`SCADA_SCHEMA_VERSION` 升至 `0.2.0`，新增历史版本常量、`migrateScadaDocument` 与结构字段白名单。
- `packages/core/src/index.ts`：统一导出 Schema 迁移 API 和 `ScadaDocumentMigration` 类型。
- `packages/core/src/editor.ts`：`loadDocument` 通过迁移入口原子替换工程，返回迁移来源。
- React/Vue 两套 `src/studio/StudioPage`：历史工程导入成功提示升级并建议重新导出，导出只写当前版本。
- `packages/core/test/document.test.ts`、`packages/core/test/editor.test.ts`：新增 12 项版本、非法结构、组合保真和失败回滚用例。
- [ADR-0018](adr/0018-schema-version-migration.md) 记录兼容范围、限制与风险。

## V0.2 第十一批：本地工程草稿

- `packages/core/src/local-draft.ts`：框架无关的浏览器草稿存储接口、2 MiB 上限、工程 ID 隔离、包裹层与 Schema 校验及中文错误。
- `packages/core/src/index.ts`：导出本地草稿的公共 API 与类型。
- `packages/core/test/local-draft.test.ts`：10 项单测覆盖写入读取、项目隔离、Tag/组合保真、损坏数据、版本、容量和存储异常。
- `apps/web-react/src/studio/StudioPage.tsx`、`apps/web-vue/src/studio/StudioPage.vue`：手动保存/恢复/清除、二次确认、工程切换检测及中文状态。
- [ADR-0019](adr/0019-local-draft-persistence.md)：本地临时保存、Origin 隔离、风险和未实现的自动保存/正式发布边界。

## V0.2 第十二批：安全自动保存

- `packages/core/src/local-draft.ts`：新增 `LocalDraftAutoSaveSession`，共享工程脏状态、存储原始记录冲突检测、自动写入及人工保存后的基线同步。
- `packages/core/src/index.ts`：对外导出自动保存会话 API。
- `packages/core/test/local-draft-autosave.test.ts`：新增 12 项未改不写、连续保存、撤销、Tag/组合保真、外部修改/删除、损坏记录、跨工程、写入失败及人工保存基线测试。
- `apps/web-react/src/studio/StudioPage.tsx`：React 默认关闭、开启/暂停、1000 ms 防抖、跨标签页事件、恢复/清除/导入自动暂停。
- `apps/web-vue/src/studio/StudioPage.vue`：Vue 等价的保存定时与存储事件处理，保留已有手动操作入口。
- [ADR-0020](adr/0020-safe-local-autosave.md)：自动保存安全边界、竞态风险和未实现能力。

## V0.2 第十二批 IndexedDB 存储实现调整

- `packages/core/src/draft-repository.ts`：框架无关 `DraftRepository`、`DraftRecord`、`DraftAutoSaveSession`，异步保存会话按事务修订号串行提交、停止时等待已有写入。
- `packages/draft-storage/src/index.ts`：唯一 Dexie.js IndexedDB 适配，版本 1 的 `drafts` / `migrations` 表、事务内修订号校验、历史 `localStorage` 迁移、`BroadcastChannel` 通知。
- `packages/draft-storage/test/indexeddb-draft.test.ts`：通过 `fake-indexeddb` 验证首次保存、并发冲突、条件清除、历史组合/Tag 迁移与损坏数据保护。
- `packages/core/test/draft-repository.test.ts`：通过内存异步仓储验证会话脏状态、串行保存、停止、跨工程和冲突拒绝。
- `apps/web-react/src/studio/StudioPage.tsx`、`apps/web-vue/src/studio/StudioPage.vue`：改用同一异步 `DexieDraftRepository`，保留按钮/1 秒防抖/人工恢复确认/冲突提示。
- `pnpm-workspace.yaml` 与各相关 `package.json`：共享 Catalog 管理 `dexie`、`fake-indexeddb` 和 `@adui/scada-draft-storage`；`vite.config.ts` 加入存储测试，配置检查含新增 TSConfig。
- [ADR-0021](adr/0021-indexeddb-dexie-storage.md)：2026 年浏览器数据库技术选型、版本条件写入及迁移安全。

## V0.2 第十三批：演示 Tag 绑定编辑

- `packages/core/src/editor.ts`：`editableTagSlot` 与 `DocumentEditor.setSelectedBinding`，负责合法槽、单选、组合限制、原子历史。
- `packages/core/src/demo-document.ts`：`waterTreatmentDemoTagOptions` 模拟候选目录，供双框架共享。
- `apps/web-react/src/studio/StudioPage.tsx` / `apps/web-vue/src/studio/StudioPage.vue`：选取或清除模拟 Tag 绑定；两端 `studio.css` 新增选择控件样式。
- `packages/core/test/editor.test.ts`：新增六项绑定编辑与错误路径回归用例。

## V0.2 第十四批：多页面 Studio

- `packages/core/src/editor.ts`：`EditorSnapshot.activePageId`、页面创建/重命名/切换/删除及跨页面文档撤销历史；几何与框选支持可选 `pageId`。
- `packages/core/src/snap.ts`：`resolveDragSnap` 可以按 `pageId` 限定参考图元，旧调用仍默认第一页。
- `packages/runtime/src/runtime.ts`：`svgDataUrl` 可指定要渲染的工程页面，Runtime 旧调用继续展示第一页。
- `apps/web-react/src/studio/StudioPage.tsx`、`apps/web-vue/src/studio/StudioPage.vue`：页面导航与编辑作用域，保留双框架对等；两份 `studio.css` 增加导航样式。
- `packages/core/test/editor.test.ts`、`packages/runtime/test/runtime.test.ts`：页面隔离、工程级 ID、边界、历史以及 SVG 选页回归。
- `docs/adr/0022-multi-page-editor-scope.md`：解释会话态与 JSON 持久化的边界。

## V0.2 第十五批：页面复制、排序与跨页面图元复制

- `packages/core/src/editor.ts`：共享的工程级 ID 收集和重新分配、`cloneNodes` 组合重映射，以及 `DocumentEditor.duplicatePage/movePage/copySelectedToPage`。通过既有 Parser 和撤销历史原子提交。
- `apps/web-react/src/studio/StudioPage.tsx`、`apps/web-vue/src/studio/StudioPage.vue`：双框架页面复制、前移/后移按钮和跨页图元目标选择；相同中文错误与安全限制。
- `apps/web-react/src/studio/studio.css`、`apps/web-vue/src/studio/studio.css`：复制目标选择区共用版式。
- `packages/core/test/editor.test.ts`：新增 15 项页面副本、排序、复制选中、不同画布整体平移、组合保真和错误路径回归测试。
- [ADR-0023](adr/0023-page-copy-and-reordering.md)：记录全工程 ID 重映射、复制布局、默认 Runtime 页面及保存边界。

## V0.2 第十六批：Studio 会话图元剪贴板

- `packages/core/src/editor.ts`：`DocumentEditor.copySelected/cutSelected/pasteClipboard`、`EditorSnapshot.hasClipboard`；复用 `cloneNodes` 与全工程占用 ID 收集，保证同页/跨页安全复制和撤销历史。`loadDocument` 成功后清空剪贴板。
- `apps/web-react/src/studio/StudioPage.tsx` 与 `apps/web-vue/src/studio/StudioPage.vue`：剪贴板按钮和 `Ctrl/Cmd+C/X/V`，与现有输入控件及快捷键过滤兼容。
- `packages/core/test/editor.test.ts`：13 项复制、剪切、重复偏移、组合保真、跨页与边界、失败原子性、导入清理和 JSON 无剪贴板状态回归。
- [ADR-0024](adr/0024-session-node-clipboard.md)：会话边界、偏移策略和系统剪贴板隔离决策。

## V0.2 第十七批：图元锁定与可见性

- `packages/core/src/document.ts`：`STUDIO_NODE_STATE_KEY`、`studioNodeLocked/studioNodeVisible` 与共享 Parser 对 `props.__scadaStudio` 的严格校验。
- `packages/core/src/editor.ts`：`setSelectedLocked/setSelectedVisible` 两项可撤销批量命令，锁定提交保护、几何/图层排序与复制删除限制，隐藏框选过滤。
- `packages/core/src/snap.ts`：拖动吸附排除隐藏参考对象并拒绝移动锁定图元。
- `packages/core/src/svg.ts`：SVG Runtime 仅渲染可见图元，锁定不影响可见图元的只读显示。
- `apps/web-react/src/studio/StudioPage.tsx` 与 `apps/web-vue/src/studio/StudioPage.vue`：图层状态标记、锁定/可见性批量按钮及受保护的鼠标/键盘操作，两端样式文件同步状态呈现。
- `packages/core/test/document.test.ts`、`editor.test.ts`、`svg.test.ts`：Schema、核心锁定保护、批量历史、隐藏 SVG 与兼容性测试，共增加 19 项单测源码。
- [ADR-0025](adr/0025-node-lock-visibility.md)：描述状态放置、编辑安全与旧 Runtime 兼容性限制。

## V0.2 第十八批：图层精确排序与组合整体移动

- `packages/core/src/editor.ts`：共享 `DocumentEditor.moveLayer` 按目标边界插入源图元/组合；统一已锁定图元原始层序保护；旧 `reorderSelected` 对完整单组采用整体移动。
- `apps/web-react/src/studio/StudioPage.tsx`、`apps/web-vue/src/studio/StudioPage.vue`：图层列表逆序、原生拖放、目标位置指示和精确排序操作区；两端保持同一编辑命令及中文提示。
- `apps/web-react/src/studio/studio.css`、`apps/web-vue/src/studio/studio.css`：图层插入线、拖动柄及排序目标表单样式。
- `packages/core/test/editor.test.ts`：新增 17 项前后插入、组合源/目标、原四按钮兼容、锁定边界、隐藏节点、跨页隔离与 JSON 往返回归。
- [ADR-0026](adr/0026-precise-layer-order.md)：定义同页层序、组合连续移动与工业安全边界。

## V0.2 第十九批：组合树形图层管理

- `packages/core/src/layer-tree.ts`：导出 `buildLayerTree` 与 `LayerTreeGroup/LayerTreeNode`，按真实绘制顺序构建非持久化的组合树、过滤搜索、成员统计和层序不连续提示。
- `packages/core/src/index.ts`：公开图层树投影 API，供 Vue/React 适配层复用而不引入框架依赖。
- `packages/core/test/layer-tree.test.ts`：13 项组合树顺序、搜索、状态聚合、无污染，以及与编辑器选择/解组/撤销、跨页编辑的回归测试。
- `apps/web-react/src/studio/StudioPage.tsx` 与 `apps/web-vue/src/studio/StudioPage.vue`：可折叠组标题和成员行、搜索定位、组选中同步、临时会话清理及保留原有 HTML5 拖拽。
- 两份 `apps/web-*/src/studio/studio.css`：组合缩进、搜索区、折叠控件与图层列表滚动样式。
- [ADR-0027](adr/0027-layer-group-tree-projection.md)：说明树只做视图投影而非嵌套工程 Schema，并记录历史层序兼容性。

## V0.2 第二十批：TDesign UI 选型与共享属性元数据

- `pnpm-workspace.yaml`：新增四个 TDesign UI/图标包固定版本的 Catalog；`apps/web-react/package.json` 和 `apps/web-vue/package.json` 分别引用对应 UI 及图标包。
- `apps/web-react/src/studio/StudioPage.tsx`：首批替换 TDesign React 属性按钮、受控文本与搜索 `Input`、清除 `CloseIcon`，仅在 Studio 导入官方 CSS。
- `apps/web-vue/src/studio/StudioPage.vue`：对等使用 Vue Next `TButton/TInput`、Vue 版 `CloseIcon` 和官方 CSS；继续复用 Core 编辑命令和原几何/Tag 表单。
- 两份 `apps/web-*/src/studio/studio.css`：Studio 局部工业深色 TDesign 主题变量与输入/按钮样式；不改变运行时 SVG 样式。
- `packages/core/src/editor.ts`：统一导出 `GEOMETRY_PROPERTY_FIELDS`，替换双端五项几何名称的重复定义；`packages/core/test/editor.test.ts` 增加共享属性字段契约测试。
- `AGENTS.md` 与 [ADR-0028](adr/0028-tdesign-dual-framework-ui.md)：正式记录维护者新 UI 选型，避免未来误把 React Ant Design 当作已决定。
- `pnpm-lock.yaml`：因当前 Agent 环境无法联网安装，需要维护者 Windows 首次安装生成并提交，正式冻结安装前的必要前置工作。

## V7 品牌主题（ADR-0029）

- `packages/runtime/src/theme.css`：统一品牌颜色和工业深色工作台语义变量。
- `packages/runtime/src/runtime.css`：全局导航、监控页及公共交互引用共享主题变量。
- `apps/web-react/src/studio/studio.css`、`apps/web-vue/src/studio/studio.css`：TDesign 深色主题、画布操作和几何交互颜色统一。
- `apps/web-react/public/favicon.svg`、`apps/web-vue/public/favicon.svg`：V7 品牌包原版 SVG；同一图标也由各 Web 的 `public/brand/favicon.svg` 提供导航标志。
- 两套 Web 的 `main.ts(x)`：先导入 `@adui/normalize.css` 默认 Normalize，再导入共享 Runtime CSS。

## Tailwind CSS 与全视口 Studio（ADR-0030）

- `packages/tailwind/package.json`、`src/styles.css`、`src/vite.ts`：共享 `@adui/tailwind` 包导出 Tailwind v4 无 Preflight 主题及 Vite 插件；显式收集 Vue/React 工具类。
- 两端 `main.ts(x)` 和 `vite.config.ts`：分别导入 `@adui/tailwind/styles.css` 和 `@adui/tailwind/vite`，不保留重复的本地 Tailwind CSS。
- `scripts/check-shared-config.mjs`：补充共享包导出、两端接入及 CSS 导入顺序静态契约。
- `pnpm-workspace.yaml`：统一固定版本，工作区共享包集中声明依赖。
- 两端 `App`：Studio 视口容器固定为动态视口高度；Runtime 保留可滚动页面。
- 两端 `StudioPage`：使用 Tailwind 布置顶部工具栏、三栏工作区和各自滚动的侧栏/画布，特殊 SVG/TDesign 样式仍保留原 CSS。

## V0.2 Studio 专业工作区重排（ADR-0031）

- `packages/tailwind/src/studio.css`：共享画布优先的工作台布局、悬浮菜单、可滚动图层树、属性面板、底部状态栏及窄屏响应式；由 `@adui/tailwind/studio.css` 导出。
- `apps/web-react/src/studio/StudioPage.tsx`、`apps/web-vue/src/studio/StudioPage.vue`：分别接入工程/页面操作菜单、图层辅助区、独立画布滚动区、可折叠高级属性和左右面板显隐；保留原编辑命令与 SVG 图元行为。
- 两份 `studio.css`：仅保留 TDesign 局部主题、图层行细节与 SVG 控制点；工作台布局统一使用共享样式。
- `scripts/check-shared-config.mjs`：增加新布局区域及共享 CSS 入口静态约束。

## V0.2 Studio 无滚动画板与操作分组（ADR-0032）

- `packages/core/src/studio-viewport.ts`：框架无关的 `studioViewBox` 和 `clampStudioPan` 视图计算，不修改工程 Schema 与图元坐标。
- `packages/core/test/studio-viewport.test.ts`：缩放、平移、边界限制和非法输入测试。
- `packages/tailwind/src/studio.css`：左 252px、右 320px 固定侧栏与中央自适应布局；通过 CSS 容器查询让画板保持 16:9，禁止中央滚动。
- Vue/React `StudioPage`：共享 Core SVG `viewBox` 缩放，中键或 Alt+空白处平移；合并视图设置菜单和自动保存入口。
- `scripts/check-shared-config.mjs`：补充画板比例、固定栏宽和双端 SVG 视图处理静态契约。

## V0.2 中央画布满尺寸修正（ADR-0033）

- `packages/tailwind/src/studio.css`：中央画布容器与 SVG 宽高 100%，删除原 16:9 独立外框及内边距，保持背景连续。
- `scripts/check-shared-config.mjs`：静态校验更新为满宽、满高、无滚动且不约束外框比例。
- 原 SVG `viewBox`、工程页面比例和双端编辑逻辑保留，避免图元变形。

## V0.2 全视口网格与工程页面分离（ADR-0034）

- `packages/core/src/studio-viewport-rect.ts`：根据实际 SVG 工作区宽高、工程页面大小及缩放/平移，计算等比、完整的 `viewBox` 范围。
- `packages/core/test/studio-viewport-rect.test.ts`：覆盖不同宽高比、缩放、平移和异常参数。
- React `StudioPage.tsx`、Vue `StudioPage.vue`：使用 `ResizeObserver` 更新可见视区；工作区网格矩形跟随 `visibleRect` 而非 `page.size`。
- `packages/tailwind/src/studio.css`：共享 `studio-page-boundary` 辅助线视觉，保留全屏画布与固定侧栏。
- `scripts/check-shared-config.mjs`：检测两端实际视口监听、全工作区网格和工程边界。

## 双框架 Studio 浏览器冒烟测试

- `scripts/test-studio-browser.mjs`：使用 Node.js 原生 WebSocket 和 Chrome/Edge 调试协议启动隔离浏览器，自动检查 React/Vue 画布布局、网格、缩放、面板和图层选择。
- `pnpm run test:browser`：独立运行入口，暂不强制纳入 `ready`，避免在无 GUI 浏览器的环境下阻塞原有构建质量链。

## V0.3 双框架工程互通浏览器验收

- `scripts/test-studio-browser.mjs --interop`：复用既有 Chrome/Edge 隔离浏览器、Vue/React Studio 导航与 CDP，实现真实文件导出 Blob 捕获、File/DataTransfer 导入、双端新增图元与双向 JSON 往返、非法 JSON 原子拒绝。
- `pnpm run test:interop`：专门验证 FR-013，独立于 `pnpm run test:browser` 布局检查和 `pnpm run ready` 构建链路。

## V0.3 工程快照基础（ADR-0035）

- `packages/core/src/project-snapshot.ts`：当前 Schema 严格校验的结构化结果，深冻结快照、稳定 SHA-256 摘要及外部快照严格回读；无 DOM、Vue/React 或服务端仓储依赖。
- `packages/core/test/project-snapshot.test.ts`：新增加 10 项非法输入、快照只读、哈希一致性与篡改、时间/修订号/大小边界测试。
- `packages/core/src/index.ts`：统一导出类型和函数，供未来 Vue/React 与 NestJS 共享，不改变现有 Runtime 行为。

## V0.3 第三批：本地历史版本仓储

- `packages/core/src/project-version-repository.ts`：项目级历史版本仓储接口、历史摘要及倒序分页参数；不引入数据库或框架依赖。
- `packages/draft-storage/src/version-repository.ts`：新 `DexieProjectVersionRepository`，独立 IndexedDB 存储历史与最新修订号，WebCrypto 事务外完成，事务内 CAS + 只追加；`ProjectVersionConflictError`。
- `packages/draft-storage/test/indexeddb-version.test.ts`：13 项真实 fake-indexeddb 版本仓储单测，覆盖并发、跨实例重开、分页、数据隔离、篡改与故障边界。
- `packages/core/src/index.ts` 和 `packages/draft-storage/src/index.ts`：统一导出新接口与实现；现有草稿仓储仍保持原来的导出与数据库。

## V0.3 第四批：Studio 版本历史界面

- `packages/core/src/project-version-compare.ts`：框架无关的同工程 JSON 内容比较与页面/图元/绑定数量摘要。
- `packages/core/test/project-version-compare.test.ts`：4 项比较单测。
- `apps/web-react/src/studio/StudioPage.tsx`、`apps/web-vue/src/studio/StudioPage.vue`：双端版本创建、倒序列表、差异查看和确认载入；不改 Schema/草稿事务。
- `packages/tailwind/src/studio.css`：两个框架共用的历史菜单布局及响应样式。
- `scripts/test-studio-browser.mjs --versions`：隔离浏览器进行两套 Studio 的本地历史创建/取消/载入完整交互验收；`package.json` 公开 `pnpm run test:versions`。

## V0.3 第五批：历史恢复安全回归

- `apps/web-react/src/studio/StudioPage.tsx` / `apps/web-vue/src/studio/StudioPage.vue`：在 JSON 异步读取阶段持有现有草稿操作锁，且历史操作不得与草稿/导入动作重叠。
- `packages/core/test/draft-repository.test.ts`：新增 2 项确定性自动保存停写和故障处理单测。
- `scripts/test-studio-browser.mjs --versions-safety`：真实浏览器双框架自动保存与历史恢复、持久化、Origin 隔离、存储权限异常、导入互斥验收；根 `test:versions:safety` 暴露命令。

## V0.3 第七批：双标签页浏览器故障回归

- `scripts/test-studio-browser.mjs --multitab`：复用隔离 Chrome/Edge profile 创建第二个真实标签页，检查 Vue/React 自动保存的外部通知、IndexedDB CAS、删除重建与模拟故障恢复；临时替换浏览器接口会在测试后恢复。
- `package.json`：增加 `pnpm run test:multitab` 作为独立浏览器验收入口；`ready` 不默认要求图形浏览器或两套开发服务器。
- `docs/adr/0039-multitab-browser-safety.md`：记录验证范围、故障模拟方法与真实环境限制。

## V0.3 第八批：服务端工程保存输入契约

- `packages/core/src/server-project-contract.ts`：未来 NestJS 可共享的严格工程保存请求校验；仅 `expectedRevision` 与 `document`，校验路由 ID、Schema 和 UTF-8 容量，不执行权限判断或写库。
- `packages/core/test/server-project-contract.test.ts`：覆盖首次/后续保存、字段白名单、伪造权限字段、无效修订号、路由不一致、旧 Schema、非法图元和超限内容。
- `packages/core/src/index.ts`：导出共享请求契约，不新增 NestJS 路由、依赖或数据库。
- [ADR-0040](adr/0040-server-project-contract.md)：记录候选 REST、可信身份来源、数据库 CAS 与后续实现门槛。

## V0.3 第九批：工程级访问策略与数据库方案

- `apps/server/src/projects/project-access-policy.ts`：服务端纯权限判断，按租户、工程、主体和明确权限默认拒绝，不引入 NestJS 路由或 Core 依赖。
- `apps/server/src/projects/project-access-policy.spec.ts`：11 项权限策略回归，覆盖授权读取/写入、只读、无身份、无授权、跨租户/工程/主体、未知权限与恶意标识符。
- [ADR-0041](adr/0041-project-persistence-access-model.md)：候选 PostgreSQL 四表复合键、事务 CAS、授权撤销串行化与审计一致性；设计文件并非数据库迁移。

## V0.3 第十批：Prisma + PostgreSQL 初始工程模型

- `apps/server/prisma/schema.prisma`：工程、权限、版本快照、成功提交审计、正式发布状态和发布事件六个 PostgreSQL Prisma 模型。
- `apps/server/prisma.config.ts`：按现有根 `.env` 读取 Prisma CLI 连接配置；未配置数据库不初始化连接。
- `apps/server/prisma/migrations/`：首次迁移 SQL 和 provider 锁，包含由 PostgreSQL 执行的额外 CHECK 约束。
- `deploy/docker/compose.postgres.dev.yaml`：本机隔离开发 PostgreSQL（loopback、独立命名卷、必须显式配置口令）。
- 根 `db:validate` / `db:generate` / `db:migrate:deploy` / `db:migrate:status` / `db:dev:up` / `db:dev:down`：独立数据库运维入口，不默认执行数据库迁移。
- [ADR-0042](adr/0042-postgresql-prisma-foundation.md)：版本选择、安全边界及验证依赖。

## V0.3 第十一批：PrismaService 与受控版本事务仓储

- `apps/server/src/database/prisma.service.ts`：NestJS 单实例 Prisma 7 Client 的初始化与释放（使用现有 PostgreSQL Adapter）。
- `apps/server/src/projects/prisma-project-version-store.ts`：工程行锁、ACL 复核、CAS、快照/水位/成功审计事务原子性，以及授权读取与摘要复核。
- `apps/server/src/projects/project-persistence.module.ts`：未导入 AppModule 的独立模块，不开放业务 HTTP API。
- `apps/server/src/projects/prisma-project-version-store.spec.ts`：14 项无需数据库的事务仓储模拟单测。
- `apps/server/test/prisma-project-version.db-spec.ts`、`apps/server/vitest.config.db.ts`：5 项只针对显式隔离 PostgreSQL 测试库运行的真实 DB 回归。
- 根 `test:db`、`ready` 和 server `db:generate`：保证 Prisma Client 在新工作区构建前生成；见 [ADR-0043](adr/0043-prisma-project-transaction-store.md)。

- `deploy/docker/Dockerfile.server`：运行镜像增加共享 `packages/core` 包清单与源码，防止工作区依赖在生产运行层缺失。

### 第十一批补充：数据库中文注释与 Lint Mock 修复

- `apps/server/prisma/schema.prisma`：六个业务模型及其全部字段、关联属性的中文 `///` 文档说明。
- `apps/server/prisma/migrations/20261112170000_add_chinese_table_comments/migration.sql`：新增不触及历史数据的中文 PostgreSQL 表、列、索引注释迁移。
- `apps/server/src/database/prisma-schema-comments.spec.ts`：2 项无数据库静态单测，校验新旧业务模型属性的中文说明及迁移 `COMMENT ON` 覆盖。
- `apps/server/test/prisma-project-version.db-spec.ts`：增加 PostgreSQL `pg_description` 查询，验证业务表/列注释在隔离真库中生效。
- `apps/server/src/projects/prisma-project-version-store.spec.ts`：7 处 Vitest Mock 显式函数泛型，保留现有业务测试逻辑。

### 第十一批补充：Core Node 构建与 TS5097 修复

- `packages/core/tsconfig.build.json`：复用 Core 原配置，生成 `dist/*.js` 和 `dist/*.d.ts`，显式重写相对导入的 `.ts` 扩展名。
- `packages/core/package.json`：`node` 条件导出 Core 编译产物；默认条件保留前端原始 TypeScript 源码，两个公共子路径均保持语义兼容。
- `package.json`：新增 `build:core`，`ready`、`prepare` 和常用测试脚本自动生成 Node 构建产物。
- `apps/server/package.json`：独立 NestJS 类型检查、构建和开发启动前先编译 Core。
- `deploy/docker/Dockerfile.server`：最终容器层改为复制 Core `dist`，避免 Node 在运行时加载 workspace TypeScript 源文件。
- `scripts/check-shared-config.mjs`：检查 Core 条件出口、构建选项和服务端脚本的自动生成链，防止后续回退触发 `TS5097`。

## V0.3 第十二批：真实事务与容器安全验收

- `apps/server/src/database/prisma.service.spec.ts`：新增无数据库配置缺失单测。
- `apps/server/test/prisma-project-version.db-spec.ts`：在原 6 项隔离 PostgreSQL 测试基础上新增 3 项：审计 CHECK 失败后的真实回滚、撤销授权与保存竞争、连接不可达及资源释放。使用独立随机租户，继续拒绝普通开发库。
- `scripts/test-server-container.mjs`：根目录显式 Docker 服务端隔离验证命令的宿主机入口。
- `apps/server/container-smoke.mjs`：仅供镜像内运行的健康/依赖/关闭路由烟测代码。
- `deploy/docker/Dockerfile.server`：仅增加独立烟测脚本的运行时 COPY，不调整正式 CMD。
- 根 `package.json` 的 `test:docker:server`：独立于 `ready` 和 `test:db`，无需数据库或工业网络。
- [ADR-0044](adr/0044-prisma-transaction-security-regression.md)：本批设计与验收边界。

## V0.3 第十三批：服务端可信身份与工程 Guard

- `apps/server/src/auth/auth-session.service.ts`：短期会话签发、服务端 SHA-256 摘要验证、撤销和主体禁用检查；没有公开签发路由。
- `apps/server/src/auth/scada-session.guard.ts`：严格解析 HTTP Bearer，建立可信 `scadaPrincipal`。
- `apps/server/src/auth/scada-project.guard.ts`：按租户/工程/主体查询数据库显式 ACL，缺失元数据/无授权默认拒绝。
- `apps/server/src/auth/require-project-permission.decorator.ts`：确保受保护工程路由未来先 Session Guard，再 Project Guard。
- `apps/server/src/auth/scada-identity.module.ts`：未导入 AppModule 的独立 NestJS 模块。
- `apps/server/src/auth/scada-identity.spec.ts`：10 项无需数据库的会话及 Guard 单元测试。
- `apps/server/prisma/schema.prisma`：新建两张有中文 `///` 属性注释的业务模型。
- `apps/server/prisma/migrations/20261113000000_trusted_identity_sessions/migration.sql`：两张表、12 个实际字段、中文元数据、FK/CHECK/索引的独立增量迁移。
- `apps/server/test/prisma-project-version.db-spec.ts`：新增 2 项独立 PostgreSQL 会话摘要、撤销、主体停用和过期验证。
- `apps/server/test/app.e2e-spec.ts` 与 `apps/server/container-smoke.mjs`：验证会话签发 API 与既有工程/设备写入 API 继续保持关闭。
- [ADR-0045](adr/0045-trusted-session-and-project-guard.md)、[依赖清单](DEPENDENCY_SELECTION.md) 记录阶段化安全选型。

## V0.3 第十四批：日志、OpenAPI 与安全头

- `apps/server/src/observability/http-logging.config.ts`：Pino HTTP 配置、日志等级白名单、服务端请求 ID、白名单日志字段与敏感字段脱敏。
- `apps/server/src/observability/http-logging.config.spec.ts`：4 项日志配置测试，涵盖 Pretty 测试线程隔离及请求日志白名单。
- `apps/server/src/openapi/scada-openapi.ts`：Swagger 本机受控开关与动态文档注册。
- `apps/server/src/openapi/scada-openapi.spec.ts`：2 项文档访问策略测试，拒绝生产环境和非回环监听。
- `apps/server/src/security/http-security.ts`：Helmet 安全头，开发 Swagger UI 局部 CSP 兼容。
- `apps/server/src/main.ts`、`apps/server/src/app.module.ts`、`apps/server/src/app.controller.ts`：正式启动日志桥接、Helmet 与健康路由的 OpenAPI 说明。
- `apps/server/test/app.e2e-spec.ts`：新增响应安全头、请求关联 ID、Swagger 默认拒绝与本机显式启用检查。
- `apps/server/container-smoke.mjs`：隔离容器复查安全头、请求 ID 与 Swagger JSON 路由关闭。
- 根 `.env.example`、`scripts/check-env-config.mjs`：增加日志级别和 API 文档开关的统一配置与校验。
- `pnpm-workspace.yaml`、`apps/server/package.json`：服务端新增七项依赖均使用 Catalog，已由维护者 Windows pnpm 12 生成并提交锁文件。
- [ADR-0046](adr/0046-pino-openapi-http-security.md) 记录依赖和安全边界。

## V0.3 第十五批：服务端安全启动配置

- `apps/server/src/config/server-startup.config.ts`：纯函数读取并校验监听端口、主机与本机 Swagger 策略；不直接加载环境文件。
- `apps/server/src/config/server-startup.config.spec.ts`：5 项无数据库配置回归，覆盖默认、优先级、非法端口、非法主机及 Swagger 默认关闭。
- `apps/server/src/main.ts`：先从根目录加载 `.env`，再动态导入 `AppModule`，修复 Pino 初始化配置读取时序。
- `scripts/check-env-config.mjs`：静态检查根环境变量先于动态模块导入，并检查运行时配置入口。
- [ADR-0047](adr/0047-server-configuration-startup.md)：说明启动时序和安全回归要求。

## V0.3 第十六批：身份和工程安全事件白名单

- `apps/server/src/security/scada-security-audit.ts`：固定枚举的安全事件契约、严格操作/结果/原因组合校验、四字段只读安全记录与 NestJS 日志适配；不记录请求或主体敏感字段。
- `apps/server/src/security/scada-security-audit.spec.ts`：4 项白名单、非法枚举、结果组合及额外凭据字段过滤单测。
- `apps/server/src/auth/scada-session.guard.ts`：会话凭据格式、失效和允许决策的固定审计原因；不传原始 Bearer。
- `apps/server/src/auth/scada-project.guard.ts`：权限元数据缺失、无主体、无效范围、ACL 拒绝与允许结果的固定审计原因；不记录工程路径。
- `apps/server/src/auth/scada-identity.module.ts`：仅在未挂载正式 HTTP 服务的身份模块中注入审计服务，不开放任何新接口。
- `apps/server/src/auth/scada-identity.spec.ts`：新增 2 项 Guard 审计单测，覆盖脱敏、撤销令牌及跨租户拒绝；现有测试继续有效。
- [ADR-0048](adr/0048-security-audit-event-boundary.md)：区分诊断事件与正式事务持久化安全审计。

## V0.3 第十七批：Zod + NestJS 12 原生 Standard Schema

- `pnpm-workspace.yaml` / `apps/server/package.json`：只保留 `zod@4.6.7` 的 Catalog/服务端运行依赖；`nest-zod` 因实际 Swagger 适配故障及 Peer 不兼容已移除，待维护者重新生成并提交锁文件。
- `apps/server/src/config/server-startup.config.ts`：使用 Zod 校验端口和监听主机，仅当值为 `undefined` 时应用默认值；非法 `null` 必须拒绝，固定中文异常不回显输入。
- `apps/server/src/config/server-startup.config.spec.ts`：原有 5 项测试 + 新增 4 项边界回归，涵盖非法输入类型、变量优先级、敏感值过滤和数字表示。
- `apps/server/src/validation/standard-schema-integration.spec.ts`：测试专用 Controller + 4 项 NestJS 原生 Schema 请求校验、参数转换、响应过滤与 OpenAPI 测试；不属于正式路由。
- [ADR-0049](adr/0049-zod-server-runtime-validation.md)：记录实测失败、移除不兼容适配器及后续锁文件和验收边界。

## V0.3 第十八批：NestJS HTTP 就绪探针

- `apps/server/src/health/http-readiness.indicator.ts`：只跟踪 NestJS HTTP 子系统应用初始化与关闭生命周期；不访问数据库、Redis 或工业设备。
- `apps/server/src/health/http-readiness.controller.ts`：新增 `GET /health/ready`，通过 `@nestjs/terminus` 返回标准就绪/不可用响应，禁止缓存。
- `apps/server/src/health/http-readiness.indicator.spec.ts`：3 项启动前、启动完成、关闭流程状态测试。
- `apps/server/src/app.module.ts`：只增加 `TerminusModule`、就绪探针及其 Controller；原 `/health` 不变。
- `apps/server/test/app.e2e-spec.ts`：新增 2 项就绪/关闭端到端测试，受控 Swagger 增加探针契约；原 8 项持续回归。
- `apps/server/container-smoke.mjs`：隔离容器验证存活与 HTTP 就绪及安全头；继续确认未开放接口返回 404。
- `pnpm-workspace.yaml`、`apps/server/package.json`、`pnpm-lock.yaml`：声明 `@nestjs/terminus@12.1.0` Catalog 和生产依赖，维护者已通过 Windows pnpm 正式生成、提交锁文件，并经 Docker 冻结安装/隔离烟测验证。
- [ADR-0050](adr/0050-http-readiness-terminus.md)：区分 HTTP 就绪、数据库依赖和工业设备健康，解释暂缓全局限流的原因。

## V0.3 第十九批：Node HTTP 限制与 NestJS 关闭请求保护

- `apps/server/src/security/http-server-policy.ts`：集中维护 `SCADA_NEST_HTTP_OPTIONS` 与 Node 原生 HTTP 接收/连接限制，应用启动前一次性设置，避免静默使用过大的默认上限。
- `apps/server/src/security/http-server-policy.spec.ts`：3 项无数据库单测覆盖资源限制、SSE 不受响应超时影响和策略幂等。
- `apps/server/src/main.ts`：在原根 `.env` / Pino / Swagger 启动流程中启用 `return503OnClosing`、调用 `applyHttpServerPolicy`，不注册新业务路由。
- `apps/server/test/http-server-policy.e2e-spec.ts`：2 项真实 Node HTTP Server 端到端用例，验证策略、探针及关闭流程内新请求 503 和 `Connection: close`，测试屏障在 `finally` 中释放。
- `apps/server/container-smoke.mjs`：Docker `--network none` 隔离环境读取实际 Node Server 属性并复核健康/未开放接口，使用相同的启动选项。
- [ADR-0051](adr/0051-http-ingress-shutdown-policy.md)：解释 Node 资源边界、Nest 原生关闭保护及生产级限制。

## V0.3 第二十批：Linux 容器 SIGTERM 测试与 PR Assignee 规则

- `apps/server/src/main.ts`：正式服务保留所有现有关闭钩子，改为 NestJS 12 原生 `enableShutdownHooks([], { useProcessExit: true })`，只有完成关闭生命周期后才以退出码 0 正常结束。
- `apps/server/container-signal-probe.mjs`：第二阶段测试脚本，仅在容器网络内回环轮询 HTTP 存活与就绪，并验证未开放的设备写入接口为 404。
- `deploy/docker/Dockerfile.server`：将测试专用回环探针带入隔离镜像，不改变正式服务默认 CMD 或生产监听地址。
- `scripts/test-server-container.mjs`：保留现有 `--network none` 隔离烟测，新增正式 Node PID 1 容器 SIGTERM/退出码 0 检查，并通过动态名称和 `finally` 清理容器。
- `AGENTS.md`：强制所有由 AI 创建的 PR（包括 Draft）即时指派 GitHub `@adui-dev` 并核对 Assignee；PR 未经明确授权不得合并。
- [ADR-0052](adr/0052-linux-sigterm-container-shutdown.md)：记录官方关闭选项、默认退出码变化及 Docker 信号验收范围。

## V0.3 第二十一批：NestJS 本机只读模拟工程与 Tag SSE

- `apps/server/src/demo/local-demo-access.ts`：严格限制独立环境开关、非生产与服务端回环监听。
- `apps/server/src/demo/local-demo-telemetry.service.ts`：复用 Core 的水处理工程、模拟器和 TagStore；实现每秒模拟、8 秒数据中断、STALE 恢复以及 NestJS 关闭定时器清理。
- `apps/server/src/demo/local-demo-telemetry.controller.ts`：只读模拟工程、Tag 快照、NestJS `@Sse` 实时事件；事件与 Core `TagChange` 格式一致。
- `apps/server/src/demo/local-demo-telemetry.module.ts`：独立模拟模块，**不由默认正式 AppModule 注册**。
- `apps/server/src/app.module.ts`：保留正式应用路由，额外声明只用于本机显式开启的 `LocalDemoAppModule`。
- `apps/server/src/main.ts`：解析根 `.env` 后根据独立开关与实际监听主机选择根模块，保留 Swagger、日志、安全头和优雅关闭。
- `apps/server/src/demo/*.spec.ts`：2 项开关策略与 4 项模拟生命周期测试；`apps/server/test/local-demo-telemetry.e2e-spec.ts`：4 项 REST/SSE/Swagger 集成测试；原 `app.e2e-spec.ts` 补 1 项默认路由 404。
- `.env.example` 和 `scripts/check-env-config.mjs`：新增统一根配置及布尔校验，不修改其它用户配置。
- [ADR-0053](adr/0053-local-readonly-demo-telemetry.md)：审查本机开发模式、数据质量及工业安全边界。

## V0.3 第二十二批：Runtime 只读 Tag 数据源抽象

- `packages/runtime/src/tag-source.ts`：只读数据源接口、可关闭订阅句柄和仅允许 `standalone` / `nest-local` 两个固定同源 SSE 路径预设；工程 fetch 禁缓存、可取消且拒绝 HTML。
- `packages/runtime/src/runtime.ts`：原 DemoRuntime 改从注入的数据源读取工程与订阅事件，默认原 `/demo` 不变；Core TagStore 统一验证 snapshot/delta；按代次屏蔽旧回调，断线需先收到新 snapshot。
- `packages/runtime/src/index.ts`：公开工厂和只读契约供 Vue/React 以及未来受控数据源适配使用。
- `packages/runtime/test/tag-source.test.ts`：4 项测试验证两个固定路径、网络失败、不接受任意设备 URL 与 AbortSignal。
- `packages/runtime/test/tag-source-runtime.test.ts`：7 项测试验证事件传递、断线恢复、坏消息关闭、加载中止、旧会话隔离、同步失败回收和 snapshot 门槛。
- `apps/web-react/src/runtime/RuntimePage.tsx` / `apps/web-vue/src/runtime/RuntimePage.vue`：代码不变，继续默认调用 `new DemoRuntime(listener)`；`packages/runtime/src/offline.ts` 仍为 Tauri 离线模拟。
- `apps/server/src/demo/*`：第二十一批受控本机模拟接口无变更，`nest-local` 预设不取消其服务端安全开关。详见 [ADR-0054](adr/0054-readonly-tag-source-adapters.md)。

## V0.3 第二十三批：SSE 心跳、传输与数据静默双计时器

- `examples/water-treatment/server.mjs`：独立水处理模拟 SSE 每 5 秒广播具名 heartbeat；关闭时清理心跳计时器，固定模拟工程与 Tag 协议不变。
- `apps/server/src/demo/local-demo-telemetry.controller.ts`：NestJS 本机非生产受控 SSE 每条订阅额外发送具名 heartbeat，订阅释放时清理计时器和 TagStore 监听器；不改变服务端安全开关。
- `apps/server/src/demo/local-demo-telemetry.controller.spec.ts`：验证 NestJS SSE 快照、心跳、取消订阅时的 timer/监听器释放。
- `packages/runtime/src/tag-source.ts`：EventSource 通过 heartbeat 事件刷新 15 秒传输静默窗口，超时重建原有同源连接，旧实例消息无效。
- `packages/runtime/src/runtime.ts`：独立 12 秒 Tag 数据超时监测，数据质量为 STALE 时提供 `stale` 状态与中文提示，不将心跳视为 Tag 更新。
- `packages/runtime/src/runtime.css`：Vue/React 共用的 `stale` 状态红色警示样式，避免 Tag 超时时沿用普通状态色。
- `packages/runtime/test/tag-source.test.ts`：新增 5 项具名心跳、传输静默、原生错误、同步停止及清理回归。
- `packages/runtime/test/tag-source-runtime.test.ts`：新增 3 项数据静默、空增量/STALE、网络重连与定时器回归。
- `packages/runtime/test/runtime.test.ts`：补充中文 `stale` 状态映射断言。详见 [ADR-0055](adr/0055-sse-heartbeat-and-tag-silence.md)。

## V0.3 第二十四批 · 浏览器 SSE 回归入口

- `scripts/test-runtime-sse-browser.mjs`：使用本机 Chrome/Edge 原生 EventSource 和 DevTools Protocol，对 Vue/React 两套运行时进行心跳保活、Tag 静默、传输静默重连及页面退出资源回收的浏览器自动化验证；仅在本机回环地址执行，不增加应用或服务端测试专用 API。
- `packages/runtime/src/tag-source.ts` 与 `packages/runtime/src/runtime.ts`：后台标签页恢复可见时分别复查 SSE 传输时间与 Tag 数据新鲜度，并在停止/关闭时回收 `visibilitychange` 监听。见 [ADR-0056](adr/0056-sse-browser-visibility-recovery.md)。

## V0.3 第二十五批 · SSE 容量保护与网络烟测

- `examples/water-treatment/sse-clients.mjs`：仅独立 Node 水处理模拟服务使用的客户端生命周期、32 路容量上限和 64 KiB 背压保护。
- `examples/water-treatment/sse-clients.test.mjs`：Node 内置测试器覆盖连接容量、关闭、广播隔离、写缓冲和异常；由 `test:sse:clients` 执行且包含在根 `ready` 中。
- `scripts/test-runtime-sse-network.mjs`：真实 HTTP SSE 六路订阅、心跳、断开隔离与新快照回归；默认直连本机模拟，`--proxy` 检查 Docker Nginx 的 React/Vue 两个代理。
- `examples/water-treatment/server.mjs`：在固定 `/events` 路由启用资源保护；不改变其他静态资源、工程快照或工业安全边界。详见 [ADR-0057](adr/0057-local-sse-capacity-and-proxy-validation.md)。

## V0.3 第二十六批 · TCP 传输静默回归入口

- `scripts/sse-fault-proxy.mjs`：仅本机 Node 测试使用的回环 TCP 透明代理，按连接隔离 SSE 下行字节，不修改运行环境与生产接口。
- `scripts/sse-fault-proxy.test.mjs`：Node 原生测试器回归 HTTP 透传、TCP SSE 下行阻断、其他连接隔离、关闭重入和非法目标拒绝；由 `test:sse:fault:unit` 执行并纳入根 ready。
- `scripts/test-runtime-sse-browser.mjs`：新增显式 `--transport-fault` 与 `--docker` 模式，分别运行真实 Vue/React 开发入口和 Docker Nginx 入口的半开样式浏览器恢复回归。
- `scripts/test-runtime-sse-network.mjs`：新增可选 `--soak` 六路 SSE 持续心跳/Tag 增量观测；默认网络烟测逻辑不变。详情见 [ADR-0058](adr/0058-tcp-sse-fault-and-soak-tests.md)。

## V0.3 第二十七批 · 本地实时链路诊断

- `packages/runtime/src/diagnostics.ts`：框架无关诊断类型、四质量统计、本地有效更新时间/年龄和中文格式化函数，不接触外部网络。
- `packages/runtime/src/runtime.ts`：单会话断连过程计数与接受有效 Tag 的本机时钟，按 `visibleSnapshot()` 输出含本地 STALE 的质量分布。
- `packages/runtime/src/offline.ts`：本机离线模拟复用诊断结构但无网络断连计数。
- `packages/runtime/test/diagnostics.test.ts`：纯诊断、数据年龄、断连阶段去重、旧序列、局部 STALE 和离线模式回归。
- `apps/web-react/src/runtime/RuntimePage.tsx`、`apps/web-vue/src/runtime/RuntimePage.vue`：双框架对等只读诊断面板；共用 `packages/runtime/src/runtime.css`。详见 [ADR-0059](adr/0059-runtime-local-diagnostics.md)。

## V0.3 第二十八批 · 会话状态时间线模块

- `packages/runtime/src/diagnostics.ts`：扩展 `RuntimeDiagnostics.statusEvents`，新增 `RuntimeStatusEvent`、20 条有界 `RuntimeStatusHistory`，独立于 UI 框架及网络协议。
- `packages/runtime/src/runtime.ts`：仅在状态发布时检查变化并记录本地时钟，新 `start` 清零，状态快照包含历史副本。
- `packages/runtime/src/offline.ts`：仅 `simulation` 事件，不记录伪造的重连/断流。
- `apps/web-react/src/runtime/RuntimePage.tsx` 和 `apps/web-vue/src/runtime/RuntimePage.vue`：对等渲染最近状态变化；`packages/runtime/src/runtime.css` 共享响应式时间线布局。
- `packages/runtime/test/diagnostics.test.ts`：状态去重、20 条限制、同毫秒序号、快照不回溯修改、重启与离线回归；`scripts/test-runtime-sse-browser.mjs` 扩展双框架 SSE 路径的状态事件断言。见 [ADR-0060](adr/0060-runtime-session-status-history.md)。

## V0.3 第二十九批 · Tag 定义目录

- `packages/core/src/tag-definition.ts`：Tag 数据类型、定义契约、稳定 ID 目录、内存重命名及实时值类型校验。
- `packages/core/src/tag-store.ts`：可选接入 `TagDefinitionCatalog`；`apply/replaceSnapshot` 在写入前校验类型，保持整批原子拒绝。
- `packages/core/src/demo-document.ts`：水处理演示三项 Tag 元数据及图元绑定槽候选。
- `packages/runtime/src/runtime.ts`、`offline.ts`：在线和离线模拟使用同一演示目录。
- `examples/water-treatment/server.mjs`：独立 SSE 模拟服务同样校验演示 Tag 类型。
- `apps/web-react/src/studio/StudioPage.tsx`、`apps/web-vue/src/studio/StudioPage.vue`：绑定候选展示类型、单位和描述；不增加独立目录逻辑。
- `packages/core/test/tag-definition.test.ts`：定义结构、重命名稳定 ID、类型校验、质量独立与原子拒绝。详见 [ADR-0061](adr/0061-tag-definition-catalog.md)。

## 2026-11-14 · 第三十一批项目 Tag 管理入口

- apps/web-react/src/studio/TagManager.tsx：React 项目 Tag 新增、编辑、删除表单，仅维护未保存草稿。
- apps/web-vue/src/studio/TagManager.vue：Vue 同等字段与命令入口，保持 Schema 与行为对等。
- apps/web-react/src/studio/StudioPage.tsx、apps/web-vue/src/studio/StudioPage.vue：将 TagManager 与共享 DocumentEditor 的 add/update/remove 命令连接，成功刷新状态，失败提示中文错误。
- scripts/test-studio-browser.mjs：新增 --tags 模式的真实浏览器表单回归，并从根 .env 读取开发端口。
- package.json：新增 test:tags:browser 测试入口。
- docs/adr/0063-studio-tag-management-dual-framework.md：记录第三十一批决策、兼容约束和验收边界。

## 2026-11-14 · 第三十二批旧工程迁移浏览器验收

- scripts/test-studio-browser.mjs：新增 --legacy 模式，使用隔离浏览器分别测试 React/Vue 的 localStorage 旧草稿迁移、IndexedDB 旧 Schema 事务升级与 Project Snapshot 历史摘要校验。
- package.json：新增 test:legacy:browser 入口。
- docs/adr/0064-legacy-browser-migration-validation.md：记录三条真实浏览器迁移路径、SHA-256 与原记录保留边界。

## 2026-11-14 · 第三十三批目标目录（规划，尚未落地）

- apps/server/src/database/database.module.ts：计划统一导出 PrismaService 单例。
- apps/server/src/auth/oidc/：计划实现固定 Issuer Discovery、OIDC 登录事务、外部身份映射和 BFF 回调。
- apps/server/src/projects/：计划扩展工程创建/列表/摘要/历史版本 API，沿用现有事务仓储和 ACL。
- `packages/api-client/src/index.ts`：已新增独立共享工程 API Client，统一同源 Fetch、Cookie CSRF、中文错误、工程摘要/历史快照及 CAS 协议；不依赖 Vue/React UI。
- `packages/api-client/test/api-client.test.ts`：Mock Fetch 覆盖安全请求、异常状态、请求字段白名单、SHA-256 读取与追加等。
- `packages/api-client/package.json`、两端 Web Manifest、`pnpm-lock.yaml`、根 `vite.config.ts` 与共享质量入口：双框架引用同一包并纳入 Vitest/类型检查；真实 pnpm/TypeScript 6/Vite+ 验收仍待运行。
- docs/adr/0065-oidc-bff-and-project-api.md、docs/plans/v0.3-batch-33-oidc-project-api.md：本批架构决策和实施计划。以上代码路径均为计划，不代表当前 main 已存在。

## 2026-11-14 · 第三十三批阶段 A 实际落地的文件

- `apps/server/src/database/database.module.ts`：共享 PrismaService 单例提供方，只有显式引入的业务模块才可实例化。
- `apps/server/src/auth/scada-identity.module.ts` 与 `apps/server/src/projects/project-persistence.module.ts`：改为导入 DatabaseModule。
- `apps/server/src/config/oidc-startup.config.ts`：OIDC 默认关闭配置、HTTPS/开发回环地址、固定回调及加密密钥校验。
- `apps/server/src/config/oidc-startup.config.spec.ts`：配置、密钥、URL、安全开关负面测试。
- `apps/server/src/database/database.module.spec.ts`：共享 Prisma 模块与默认不挂载的安全装配检查。
- `apps/server/src/main.ts`：认证流程未实现前的 OIDC enabled 显式拒绝启动。
- `apps/server/prisma/schema.prisma`：外部身份预绑定、短期 OIDC 事务与会话可空 CSRF 摘要。
- `apps/server/prisma/migrations/20261114000000_oidc_identity_transactions/migration.sql`：增量 PostgreSQL DDL、约束、索引及中文数据库元数据注释。
- 根 `.env.example` 与 `scripts/check-env-config.mjs`：默认禁用的 OIDC 配置占位和环境检查。

OIDC 登录/回调、加密服务、HTTP Controller、工程 API、API Client 及第三方依赖锁文件仍未实现；上述路径不可被视作已开放的认证能力。

### 第三十三批阶段 A 实际目录补充（2026-11-14）

- `docs/AI_MISTAKES.md`：AI 每次编码前必读的真实错误复盘与防复发清单（9 项案例）。
- `apps/server/src/database/database.module.ts`：共享 PrismaService 单例模块。
- `apps/server/src/config/oidc-startup.config.ts`：默认关闭的 OIDC 启动配置校验。
- `apps/server/prisma/migrations/20261114000000_oidc_identity_transactions/migration.sql`：外部身份、OIDC 事务和 CSRF 摘要的增量 SQL。
- OIDC 依赖 `openid-client@6.8.9` 已加入 Catalog、Server Manifest 和锁文件；登录/回调、会话 Cookie/CSRF 及工程 Controller 仍未实现。

### 第三十三批新增真实 PostgreSQL 测试

- `apps/server/test/oidc-schema.db-spec.ts`：独立 `test:db` 入口，验证 OIDC 增量迁移真实落库、迁移登记、外键/约束/索引及中文数据库元数据；仅允许本机 `adui_scada_test`。

### 第三十三批阶段 B 第一小批：OIDC Discovery

- `apps/server/src/auth/oidc-provider-discovery.service.ts`：固定 Issuer Discovery、元数据能力校验、HTTPS/回环 HTTP 请求边界、惰性缓存与安全错误映射。
- `apps/server/src/auth/oidc-provider-discovery.service.spec.ts`：Mock Fetch Discovery、元数据负例、端点协议边界、并发复用及失败重试测试。
- `apps/server/src/auth/scada-identity.module.ts`：通过严格启动配置 Token 注册 Discovery 服务；该模块仍未由默认 AppModule 挂载。
- `apps/server/src/config/oidc-startup.config.ts`：拒绝将 `/.well-known/` Discovery 文档路径误配为 Issuer。
- `apps/server/src/main.ts`：继续在认证、CSRF 与工程 ACL 全部完成前拒绝启用 OIDC。

### 第三十三批阶段 B 第二小批：OIDC 一次性登录事务

- `apps/server/src/auth/oidc-login-transaction.service.ts`：生成 State/Nonce/PKCE、AES-256-GCM 加密 verifier、浏览器绑定摘要、站内回跳路径校验、PostgreSQL 一次性原子消费。
- `apps/server/src/auth/oidc-login-transaction.service.spec.ts`：授权请求参数、密文往返、跨浏览器/过期/重复/并发消费、回跳路径和数据库异常测试。
- `apps/server/src/auth/scada-identity.module.ts`：注册事务服务；模块仍未由默认 AppModule 挂载。

### 第三十三批阶段 B 第三小批：OIDC 授权码回调

- `apps/server/src/auth/oidc-callback.service.ts`：固定回调 URI、Authorization Code + PKCE 兑换、State/Nonce/Issuer/Audience/azp/Subject 校验、预绑定 `(iss, sub)` 身份查询与本地会话签发。
- `apps/server/src/auth/oidc-callback.service.spec.ts`：Mock 授权码兑换、ID Token Claims、外部身份映射、会话签发与错误脱敏测试。
- `apps/server/src/auth/scada-identity.module.ts`：注入 openid-client `authorizationCodeGrant` 并注册回调服务；模块仍未由默认 AppModule 挂载。
- 当前尚无 OIDC Controller；回调服务的 sessionToken 仅供后续服务端 Controller 设置 HttpOnly Cookie。

### 第三十三批阶段 B 第四小批：BFF Cookie 与 CSRF 会话保护

- `apps/server/src/auth/auth-session.service.ts`：新会话同时签发独立 CSRF Token、只存摘要；提供 Cookie 会话验证和旧 Bearer 兼容。
- `apps/server/src/auth/scada-auth-cookie.ts`：构造/清除 `__Host-` Session 与 CSRF Cookie，统一 Secure、HttpOnly、SameSite、Path 和有效期属性。
- `apps/server/src/auth/scada-session.guard.ts`：显式 Bearer/Cookie 双路径、凭据混用拒绝、精确 Origin、Fetch Metadata、CSRF 双提交与数据库摘要验证。
- `apps/server/src/auth/scada-auth-cookie.spec.ts`：Cookie 签发与清除属性测试。
- `apps/server/src/auth/scada-session.guard.spec.ts`：Bearer 兼容、Cookie 请求、CSRF/Origin/Fetch Metadata 和审计脱敏测试。
- `apps/server/src/auth/scada-identity.spec.ts`：会话 CSRF 摘要存储、Cookie 校验与旧 Bearer 会话兼容回归。
- `apps/server/src/security/scada-security-audit.ts`：新增 Cookie/CSRF/Origin/Fetch Metadata 固定拒绝原因码。
- 当前无 HTTP Controller；Identity 模块仍未由默认 AppModule 挂载。

### 第三十三批阶段 B 第五小批：OIDC BFF HTTP 控制器与认证路由

- `apps/server/src/auth/scada-auth.controller.ts`：OIDC 登录发起/回调、最小本地身份查询与当前会话注销；只编排既有服务，不重复实现 OIDC 协议。
- `apps/server/src/auth/scada-auth-cookie.ts`：新增短时 `__Host-adui-scada-oidc-browser` Cookie 与严格 Cookie 读取函数，保留 Session/CSRF Cookie 签发和清除。
- `apps/server/src/auth/scada-identity.module.ts`：仅在 OIDC 启用根模块中注册 `ScadaAuthController`。
- `apps/server/src/app.module.ts`：新增 `OidcEnabledAppModule`，只组合基础 AppModule 和 ScadaIdentityModule，不加载工程持久化模块。
- `apps/server/src/main.ts`：根据完整 OIDC 配置选择根模块；默认健康模块保持数据库隔离，OIDC 与本机模拟 API 冲突时拒绝启动。
- `apps/server/test/oidc-auth.controller.e2e-spec.ts`：登录重定向、Cookie、回调、`me/logout`、CSRF 与 Bearer 兼容 HTTP E2E。
- `apps/server/src/database/database.module.spec.ts`、`apps/server/test/app.e2e-spec.ts`：模块装配与默认根模块身份路由 404 回归。

## 第三十三批第六小批：服务端工程 API（待验收草稿）

- `apps/server/src/projects/prisma-project-version-store.ts`：扩展可信主体的工程创建、ACL 筛选列表、共享锁详情、历史摘要分页，继续保留事务 CAS 追加和历史快照读取。
- `apps/server/src/projects/project-api.controller.ts`：六条 `/api/v1/projects` HTTP API，使用 Session Guard 与工程权限 Guard。
- `apps/server/src/projects/project-api.exception-filter.ts`：明确 400/404/409 领域错误响应。
- `apps/server/src/projects/project-api.module.ts`：OIDC 启用根模块专用工程 API 模块，复用身份模块与工程持久化模块。
- `apps/server/src/projects/project-api.store.spec.ts`：Mock 事务仓储单元测试。
- `apps/server/test/projects-api.e2e-spec.ts`：Supertest 工程 HTTP、Bearer、Cookie CSRF、授权与错误映射回归。
- `apps/server/test/project-api.db-spec.ts`：只对本机隔离 `adui_scada_test` 测试库执行工程创建、租户、竞争与审计事务回滚回归。
- `apps/server/src/main.ts`、`apps/server/src/security/http-server-policy.ts`：HTTP 2 MiB JSON 请求体限制。
- `apps/server/src/database/database.module.spec.ts`、`apps/server/test/app.e2e-spec.ts`：模块挂载和默认根模块 404 边界测试。

以上内容仍需实际运行 `vp check`、`ready` 与 `test:db`，不得当作已通过验收。

## 第三十三批 · 全新空库迁移专项工具（未完成真实空库验收）

- `scripts/verify-fresh-postgres-migrations.mjs`：从根目录本机 `adui_scada` 连接推导人工创建的 `adui_scada_fresh_*` 隔离库；确认目标为空后执行两次 Prisma 迁移部署，核对迁移登记和业务表，不创建、删除或重置数据库。
- `scripts/verify-fresh-postgres-migrations.cases.mjs`：使用 Node.js 内置 `node:test` 验证连接来源、数据库命名、地址、端口及 Schema 拒绝策略；与通用 Vitest 测试文件命名隔离。
- 验收命令与注意事项见 `docs/HARNESS.md`；纯逻辑单测 6/6 通过不代表真实 PostgreSQL 空库迁移已经通过。

## 第三十三批第八小批 · Studio 服务端工程 UI 与共享会话逻辑

- `packages/api-client/src/studio-session.ts`：框架无关的服务端 CAS 保存基线；按工程、租户、主体和显式载入的修订号约束写入，冲突失效基线，无 IndexedDB 访问。
- `packages/api-client/test/studio-session.test.ts`：9 项 Mock API Client 会话安全测试（候选，待真实 Vitest 验收）。
- `apps/web-react/src/studio/StudioPage.tsx`、`apps/web-vue/src/studio/StudioPage.vue`：新增对应的“服务端工程”菜单，提供身份检查、服务端保存、分页历史、内容对比及确认载入；本地草稿、浏览器历史入口与原持久化逻辑不变。
- 旧版/本地草稿恢复、JSON 导入和本地历史载入显式清理云端 CAS 基线；真实 IdP、同源 HTTPS、双框架云端 E2E 未纳入本批已验收范围。

## 第三十三批第九小批：本机 OIDC HTTPS 开发代理

- scripts/oidc-https-dev-proxy.mjs、scripts/oidc-https-dev-proxy.d.mts：React/Vue 共用的默认关闭、仅本机 TLS 和精确 Origin/回调校验的开发代理策略。
- scripts/oidc-https-dev-proxy.cases.mjs：10 项 Node 内置配置测试，覆盖生产/非回环/端口/Origin/回调/证书/固定代理目标。
- apps/web-react/vite.config.ts、apps/web-vue/vite.config.ts：仅显式开启的 Vite serve 增加 HTTPS 与 /api/v1 同源代理，原 /demo 不变。
- .env.example、scripts/check-env-config.mjs：新增关闭状态及证书文件空占位，并维持根目录唯一 .env 校验。
- docs/HARNESS.md：维护者真实 HTTPS、IdP、同源 Cookie、React→服务端→Vue 往返验收步骤；尚未实际联调。

### 第三十三批第十小批：OIDC 本机 HTTPS 匿名只读诊断

- `scripts/verify-oidc-https-readonly.mjs`：从仓库根 `.env` 读取联调开关和已登记的两个 HTTPS Origin，仅向 `127.0.0.1` 发起无 Cookie 的 `GET /api/v1/auth/me`；使用 Node 原生证书校验，并拒绝重定向、HTML 回退或非预期 401 JSON。
- `scripts/verify-oidc-https-readonly.cases.mjs`：九项本机目标、开关、证书前置契约对应的离线 Mock 请求测试；不访问真实 IdP、PostgreSQL 或工业设备。
- 根 `package.json`：`test:oidc:https:readonly` 纳入 `ready`；`verify:oidc:https:readonly` 为显式人工真实网络检查，不纳入默认质量链。
- `docs/HARNESS.md`：真实 TLS 只读联调的前置配置、Windows 操作和失败即停止规则。本批不更改 Vue/React 应用业务行为、NestJS 身份策略或数据库 Schema。

### 本机 OIDC Lab 依赖栈（第三十三批）

- `deploy/docker/compose.oidc.lab.yaml`：与演示和原有开发数据库互不共享命名卷的单一 Docker Compose 项目；提供回环绑定的 PostgreSQL、Redis 与 Keycloak。
- `deploy/docker/oidc-lab/init-keycloak-db.sql`：只在新 PostgreSQL Lab 数据卷首次初始化时创建专用 Keycloak 数据库；不清空或重置现有库。
- `deploy/docker/oidc-lab/adui-scada-realm.json`：Keycloak 首次启动导入的本机 Realm、机密客户端、严格 React 回调和 PKCE 配置，不含静态 Client Secret。
- `scripts/prepare-oidc-lab.mjs`：显式 `docker:lab:up` 的本机 mkcert/秘密文件准备入口，不修改根 `.env`，不把随机凭据写进 Git 或 Docker 构建上下文。
- `scripts/prepare-oidc-lab.cases.mjs`：六项离线启动安全测试。
- `.local/oidc-lab/`：运行时生成的机密和本机证书目录，Git/Docker 忽略，不是仓库可提交文件；Redis 目前未接入 NestJS。

### 第三十三批真实 OIDC 根模块 Guard 注入修复（E-018）

- `apps/server/src/auth/scada-identity.module.ts`：向仅有 `ProjectApiModule` 消费的身份依赖导出共享 `DatabaseModule`、`ScadaSecurityAuditService` 和 `SCADA_OIDC_STARTUP_CONFIG`，供 Controller 上的 `@UseGuards` 在工程模块上下文解析；不改变 Guard 业务逻辑。
- `apps/server/src/database/database.module.spec.ts`：新增完整导出契约检查，防止未来将 Guard 与其安全依赖拆开导出。
- `apps/server/test/oidc-module-bootstrap.e2e-spec.ts`：以真实 `OidcEnabledAppModule` 进行 Nest 模块编译和 HTTP 初始化，但替换 Prisma 和测试 OIDC 配置；不访问真实数据库/IdP，检查未认证身份与工程 API 保持 401 JSON。

### 第三十三批第十三小批：OIDC Lab 受控身份预绑定工具

- `scripts/oidc-lab-identity.mjs`：显式运营工具，必须由维护者从 Keycloak Users 详情页提供 UUID；只允许已启用可信 HTTPS 的本机 Lab Realm 和独立 `adui_scada_oidc_lab` PostgreSQL，默认预览回滚；需 `--apply --confirm-lab adui_scada_oidc_lab` 才会在可串行化事务中创建可信本地主体与唯一外部映射，拒绝冲突、停用主体、已有工程 ACL 和未经迁移的数据库。通过服务端已有 `pg` 依赖执行参数化 SQL，不新增依赖或公开 API。
- `scripts/oidc-lab-identity.cases.mjs`：14 项不连接数据库的命令参数、回环目标、幂等、事务提交/回滚与权限保护离线用例。
- `package.json`：新增 `test:oidc:identity` 并纳入默认 `ready`；`oidc:lab:identity` 为显式手工绑定命令，绝不由 `ready`、`docker:lab:up` 自动执行。

### 本机 Docker 唯一 Compose 入口（第三十三批）

- `deploy/docker/compose.yaml`：唯一受维护的 `adui-scada` Compose；7 服务，单一 PostgreSQL 容器（SCADA + Keycloak 逻辑数据库），保留原 SCADA/Keycloak 与 Redis 持久化卷。
- `scripts/docker-stack.mjs`：白名单历史容器迁移及最新 `plan/migrate/up/down/ps/logs` 命令；不运行旧开发 PostgreSQL，不删除已有卷。
- `scripts/docker-stack.cases.mjs`：17 项受控配置、旧容器标签和持久化保护用例。
- `scripts/prepare-oidc-lab.mjs`：仅用于本机 HTTPS 证书和随机凭据准备，并不再创建单独的 OIDC Lab Compose 项目。
- `package.json`：`docker:*` 只保留新统一入口；`test:docker` 加入 `ready`，历史 `docker:demo/lab/all` 与 `db:dev` 命令删除。

### 第三十三批 · 单一 Docker 全新安装最终入口

- `deploy/docker/compose.yaml`：唯一 `adui-scada` Compose，7 容器、1 PostgreSQL，SCADA `adui_scada` 和 Keycloak `adui_scada_keycloak` 分为两个逻辑数据库，使用 Docker 新项目自有的 PostgreSQL/Redis 命名卷。
- `scripts/docker-stack.mjs`：只提供本机 `plan/up/down/ps/logs`，旧项目容器若存在则拒绝启动，不读取/删除旧数据卷。
- `scripts/docker-stack.cases.mjs`：14 项本机新库/新卷和历史项目隔离安全检查。
- `scripts/prepare-oidc-lab.mjs`：在 `.local/docker/` 生成/复用本机随机凭据与 TLS 文件，保留原业务函数名称以最小化影响，不能自动覆盖已有秘密。
- `scripts/init-docker-db.mjs`：从 Git 忽略的随机凭据构造固定回环数据库 URL，调用 Prisma `migrate deploy`；`scripts/init-docker-db.cases.mjs` 校验独立数据库和密码保护。
- `deploy/docker/oidc-lab/init-keycloak-db.sql`：首次 PostgreSQL 初始化时创建 Keycloak 独立逻辑库。
- `.env.example`、`scripts/check-env-config.mjs`：统一数据库名称 `adui_scada`、端口 `15432`，OIDC 默认关闭，密码不入 Git。

### 本机 Docker 数据库状态查询（第三十三批 E-021）

- `scripts/init-docker-db.mjs`：原 `docker:db:init` 继续幂等执行 `prisma migrate deploy`；新增白名单 `--status` 由 `docker:db:status` 调用，使用与 Docker 启动一致的 Git 忽略本机随机凭据执行只读 `prisma migrate status`，不修改通用 `db:migrate:status` 的根 `.env` 语义。
- `scripts/init-docker-db.cases.mjs`：覆盖只读参数白名单、旧根 `.env`/进程密码覆盖、数据库地址精确回环及旧库拒绝。
- `package.json`、`scripts/check-env-config.mjs`：注册并校验 `docker:db:status`，不得将新命令变为破坏性迁移或输出凭据。

### 第三十四批第二小批：双框架 Studio 授权工程浏览器

- `packages/api-client/src/project-browser.ts`：React/Vue 共用的十条一页工程列表游标、刷新/前后翻页、末页空响应保留、错误重试、并发互斥、登录失效清空摘要；不持久化主体/身份或工程快照。
- `packages/api-client/test/project-browser.test.ts`：单测覆盖首页、上下页、最后一页、恰满空页、失败恢复、并发与清理列表。
- `apps/web-react/src/studio/ServerProjectBrowser.tsx` 与 `apps/web-vue/src/studio/ServerProjectBrowser.vue`：双端对等的独立工具栏“工程管理”弹层，只读取授权工程摘要，提供打开前的显式操作；`packages/tailwind/src/studio.css` 共享工业品牌主题样式。
- `apps/web-react/src/studio/StudioPage.tsx` 与 `apps/web-vue/src/studio/StudioPage.vue`：协调原有 `StudioServerProjectSession.readVersion`、用户确认、`pauseAutoSave`、`editor.loadDocument`、`acceptLoadedVersion` 和按工程重新读取草稿状态；取消与远端修订变化均不覆盖本地画布。
- 未修改公共工程 Schema、NestJS 路由、OIDC 登录事务、Prisma Schema/迁移或任何工业设备写入。

### 第三十四批第三小批 · 双端工程管理 OIDC 浏览器测试

- `scripts/test-project-browser-oidc.mjs`：仅在本机隔离 OIDC HTTPS Lab 下执行，维护者手动在临时 Chrome/Edge 完成真实 OIDC 登录。验证 React/Vue 授权工程列表、分页（足量时）、明确取消、预加载的只读 GET 水位故障注入、确认载入、可见 CAS 基线、自动保存停写与 IndexedDB 原草稿不变。无需第三方浏览器依赖，不访问正式工业设备，不执行服务端工程 POST；失败诊断固定白名单脱敏。
- `scripts/test-project-browser-oidc.cases.mjs`：纯离线 Node 测试，验证两套固定 HTTPS Origin、本机 Keycloak Issuer、回环 Lab PostgreSQL、证书与生产/不安全选项拒绝；已纳入 `ready`。
- 根 `package.json`：新增 `test:projects:oidc:config` 与交互式 `test:projects:oidc:browser`，后者永不加入默认质量链，避免 CI 自动登录或连接真实数据库。

### 第三十四批第四小批 · 真库分页与独立连接 CAS / 双端多页严格模式

- `apps/server/test/project-api.db-spec.ts`：在经白名单验证的本机 `adui_scada_test` 随机租户中用真实创建事务准备 12 个授权工程与 1 个同租户不可见工程，验证 `10 + 2 + 0` 分页、ACL 与摘要白名单；清理严格限定测试租户。
- `apps/server/test/prisma-project-version.db-spec.ts`：两套独立 Prisma 连接与不同受信主体同时追加同一个修订号，断言一个成功、一个冲突，以及精确水位、不可变版本和获胜者成功审计。
- `scripts/test-project-browser-oidc.mjs`：新增可选 `--require-multipage`，必须真正翻入有数据的第二页并返回第一页，双框架都成功才算通过。默认登录与单页安全回归模式不变，不向 OIDC Lab 写入工程或权限。
- `scripts/test-project-browser-oidc.cases.mjs`：新增严格模式拒绝空第二页的离线用例，随既有 `ready` 检查。根 `package.json` 新增交互式 `test:projects:oidc:browser:pages`，不加入 `ready`。

## V0.3 第三十四批第五小批 · 真实双 Cookie 会话 HTTP CAS 回归

- `apps/server/test/projects-cas-cookie-http.db-spec.ts`：独立真实 PostgreSQL HTTP 测试（与已有 `apps/server/vitest.config.db.ts` 的 `test/**/*.db-spec.ts` 匹配）。使用真正的 NestJS Guard、Session Service、Project API Controller、PrismaProjectVersionStore；由可信测试主体内部签发两份 BFF Cookie/CSRF 会话。对同工程修订竞争断言 HTTP 201/409 和数据库审计一致性，包含错误 CSRF、Origin、混用凭据、ACL 拒绝。仅针对随机 `test-<UUID>` 租户清理。
- 根 `pnpm run test:db`：旧 **25 项**真实 PostgreSQL 回归预计增加 **4 项**，共预计 **29 项**；以维护者在本机真实数据库的最终报告为准。默认 `ready` 不连接/写入数据库。

## 第三十四批第六小批 · 真实双 Keycloak 主体 CAS 测试

- `scripts/test-oidc-dual-cas.mjs`：两个独立临时 Chrome/Edge Profile 的真实 Keycloak 登录、同源 BFF 会话与专用新建工程的双会话 CAS 竞争；写入必须 `--run-cas --confirm-lab adui_scada`。复用现有 OIDC Lab 配置白名单、正式工程 API 与服务端已安装的 `pg`，不添加新的第三方依赖。
- `scripts/test-oidc-dual-cas.cases.mjs`：11 项 Node 内置离线测试，覆盖配置门禁、不同主体、同源与 CSRF、专用工程限制、201/409 与审计、错误脱敏，不访问浏览器或数据库。
- 根 `package.json`：`test:oidc:dual:config`（包含在 `ready`）、`test:oidc:dual:preflight`（只读验证；OIDC 登录会正常生成会话）、`test:oidc:dual:cas`（显式写入全链专项，默认质量链不执行）。

## 第三十四批第七小批 · 会话注销与工程 ACL 动态撤销的真库 HTTP 回归

- `apps/server/test/projects-cas-cookie-http.db-spec.ts`：在已有双 Cookie 会话 HTTP CAS 四项测试基础上新增两项。测试容器同时注册真实 `ScadaAuthController` 和 `ProjectApiController`，使用真实 `AuthSessionService`、Session/Project Guards、Prisma；仅无关 OIDC 授权码前置入口依赖使用测试占位符。覆盖一个会话注销后旧 Cookie 401/另一主体仍能写入，以及有效身份被撤销工程 ACL 后列表不可见、详情/历史/写入 404。
- 运行入口保持 `pnpm run test:db`：现有 `apps/server/vitest.config.db.ts` 自动收集 `test/**/*.db-spec.ts`，新候选从此前 29 项预计增加至 31 项。默认 `pnpm run ready` 不连接真实 PostgreSQL，也不修改已有本机 OIDC Lab 数据。

## 第三十四批第八小批 · 服务端权限拒绝的双框架失效保护

- `packages/api-client/src/index.ts`：新增 `isScadaAccessRejection`，统一 401/403/404 受控拒绝分类，不读取服务端原始错误正文。
- `packages/api-client/src/studio-session.ts`：`StudioServerProjectSession` 在访问失效时作废 CAS 基线，禁止已有基线工程 404 后错误触发创建，并防止重复保存重新尝试；授权版本重新读取和确认载入后方可恢复。
- `apps/web-react/src/studio/StudioPage.tsx`、`apps/web-vue/src/studio/StudioPage.vue`：同一安全规则清除服务端修订号、历史摘要、对比快照及工程管理游标缓存；原画布、IndexedDB 草稿与本地历史不变。
- `packages/api-client/test/api-client.test.ts`、`packages/api-client/test/studio-session.test.ts`：新拒绝类型、403/404 权限撤销、401 身份过期、重复保存保护、重新加载恢复与网络错误保持原基线的回归。
- `apps/web-react/src/studio/ServerProjectBrowser.tsx`、`apps/web-vue/src/studio/ServerProjectBrowser.vue`：使用共享拒绝分类；列表请求 401/403/404 时除了清空自身游标，还通过 `onAccessRejected` / `accessRejected` 通知父级 Studio 立即清理旧 CAS 和服务端历史，而不是只清空子组件列表。

## 第三十四批第九小批 · 双框架 HTTP 拒绝模拟浏览器专项

- `scripts/test-project-browser-oidc.mjs`：在现有真实 OIDC 双框架只读工程浏览器脚本中增加 `--simulate-access-denial` 独立模式，仅在隔离浏览器安装写入阻断和定向 401/403/404 只读 Fetch 模拟；复用真正的 Keycloak Cookie、受控同源工程读取及原有草稿哈希断言。不改生产 Web 或 NestJS 实现。
- `scripts/test-project-browser-oidc.cases.mjs`：新增离线测试，检查模式互斥、工程写请求永不转发真实 Fetch、模拟状态仅命中目标路径和状态、普通登录 GET 不被改写；原 18 项预计增至 21 项。
- `package.json`：新增 `test:projects:oidc:denial`，与常规 `test:projects:oidc:browser` 及需显式写入确认的多页准备命令分离。

## 第三十四批第十小批 · 真实双 Keycloak 主体 ACL 撤销与 React/Vue 浏览器专项

- `scripts/test-oidc-real-acl-revocation.mjs`：独立 OIDC 双人只读预检与显式本机 Lab 写入测试；只创建两份 UUID 专用空白工程，在串行化 PostgreSQL 事务中对第二主体严格定向撤销三项 ACL，复核真实 404、原 BFF 身份、React/Vue CAS 与本地草稿保护、创建者保留读取以及单首版审计；异常时尝试回收本轮授予的权限。
- `scripts/test-oidc-real-acl-revocation.cases.mjs`：八项离线安全回归，覆盖写入模式门禁、任意工程拒绝、同租户不同主体、固定 ACL 精确删除与回滚、幂等、版本/审计和浏览器 GET 脱敏。
- `scripts/test-oidc-dual-cas.mjs` 与 `scripts/test-project-browser-oidc.mjs`：仅将必要的已存在 Chrome/CDP 及 Studio 页面检查辅助函数显式导出；已有 CAS 和模拟拒绝专项的行为不变。
- 根目录 `package.json`：增加 `test:oidc:revoke:config`、`test:oidc:revoke:preflight`、`test:oidc:revoke:browser`；仅把离线配置测试接入 `ready`，真实 PostgreSQL 撤权浏览器测试必须手动显式确认执行。

## 第三十四批第十一小批 · React/Vue 标签页恢复时只读复核

- `packages/api-client/src/studio-session.ts`：`StudioServerProjectSession.revalidateBaseline` 比较当前可信身份、工程授权可读性和最新 `headRevision`，处理 401/403/404、主体切换、409 及网络中断；过期异步请求不能清除已切换的合法新基线。
- `packages/api-client/test/studio-session.test.ts`：新增 8 项共享单测，覆盖无基线零请求、正常复核、注销、ACL 撤销、换号、CAS 水位、网络故障与迟到结果保护。
- `apps/web-react/src/studio/StudioPage.tsx`、`apps/web-vue/src/studio/StudioPage.vue`：仅在页面从后台恢复为可见时发起只读检查，跳过已有保存/草稿等互斥操作并清除过时的服务端 UI 摘要；不改本地编辑和 IndexedDB 草稿。
- `scripts/test-project-browser-oidc.mjs`、`scripts/test-project-browser-oidc.cases.mjs`：独立 `--simulate-resume-check` 模式，增加 3 项离线测试，真实 OIDC 登录 + 模拟可见事件 + 模拟服务端拒绝/水位变化，所有工程写请求仍被隔离浏览器阻断。
- 根 `package.json`：新增只读交互命令 `test:projects:oidc:resume`；普通浏览器模式、真实 PostgreSQL 撤权专项、版本持久化、OIDC Lab 权限映射及工业设备路径不变。

## 第三十四批第十二小批 · 服务端版本读取迟到结果防污染

- `packages/api-client/src/studio-session.ts`：共享 Studio 工程会话增加仅在内存中使用的上下文代次；`readVersion` 在逐步读取身份、快照、工程最新水位及异常处理时检查代次，以受控冲突丢弃已经切换上下文的旧结果，不影响活跃请求的 401/403/404 权限保护。
- `packages/api-client/test/studio-session.test.ts`：3 项新回归分别覆盖旧 401 不清空新确认的 CAS、旧 404 不污染本地工程首次创建、迟到合法快照不能被新上下文接受。React/Vue 继续共用此会话实现，不触碰各框架组件、API 协议或工程 Schema。

## 第三十四批第十三小批 · 服务端保存迟到结果防污染

- `packages/api-client/src/studio-session.ts`：在既有 `contextGeneration` 基础上为 `saveDocument` 添加 `awaitSaveStep`，四类异步身份、水位、创建及追加操作均在结果返回或拒绝时核对当前会话代次；POST 可能已执行时使用明确的受控 409 中文提示，旧错误不得覆盖新基线。
- `packages/api-client/test/studio-session.test.ts`：新增五项 Promise 时序回归（旧 401、旧 404、迟到创建成功、迟到追加成功、迟到追加冲突）。React 与 Vue 使用共享实现，无需 UI 双份代码；本批不新增浏览器测试入口、依赖或服务器接口。

## 第三十四批第十四小批 · 双框架浏览器延迟保存安全回归

- `scripts/test-project-browser-oidc.mjs`：原有 OIDC 浏览器测试增加单独 `--simulate-save-timing`，通过已有浏览器工程写入阻断钩子在同源版本 POST 上增加限定的延迟 401/409/503 拒绝；对 React/Vue 均验证真实 UI 重复提交、CAS 状态与本地画布/草稿/自动保存保护。
- `scripts/test-project-browser-oidc.cases.mjs`：补充新模式白名单、互斥、固定项目 POST 拦截、写入绝不穿透、请求释放和 UI 状态摘要的离线测试。根 `package.json` 增加 `test:projects:oidc:save:browser` 入口。共享客户端、Web 页面、NestJS 和数据库无需更改。

## 第三十四批第十五小批 · 真实数据库提交与迟到回包分层回归

- `apps/server/test/projects-cas-cookie-http.db-spec.ts`：复用已有随机租户、双 Cookie/CSRF 和真实 NestJS/PostgreSQL 事务装配；新增真实 201 提交后延迟向消费端交付、第二主体追加 3、旧预期 CAS 409、快照与审计一致性回归。仍由 `pnpm run test:db` 单独触发，**不进入默认 `ready`**。
- `packages/api-client/test/studio-session.test.ts`：新增旧追加成功 Promise 迟到、用户重新载入更高修订号及后续 CAS 正常追加的会话测试，继续由 `pnpm run test:unit` 和 `ready` 执行。
- 生产 `StudioServerProjectSession`、React/Vue 页面、NestJS Controller、Prisma、数据库迁移和工业网关均不修改。

## 第三十四批第十六小批 · 真实双浏览器迟到 201

- `scripts/test-oidc-dual-cas.mjs`：保留原只读预检/真实双主体同修订 CAS；新增互斥 `--run-late-response` 模式，浏览器内暂存已经实际返回的 201，第二主体推进至 3，旧 CAS 409，并从真实 PostgreSQL 只读核对三版/审计。
- `scripts/test-oidc-dual-cas.cases.mjs`：原 11 项离线用例新增 5 项，覆盖显式模式门禁、同源单次 POST、失败/重复启动/无 CSRF、合法 CAS 范围与三版审计一致性。
- 根 `package.json`：增加 `test:oidc:dual:late` 手工写入入口，**不加入 `ready` 的真实浏览器和数据库执行链**；离线安全回归继续使用原 `test:oidc:dual:config`。

## 第三十四批第十七小批 · 真实 React/Vue Studio 迟到 201 UI 联合验收

- `scripts/test-oidc-studio-real-late.mjs`：独立真实双主体、双框架 Studio UI、正式 HTTPS BFF 和 PostgreSQL 的版本 2→3、迟到真实 201、标签页可见只读复核、重复提交/草稿保护验收脚本；默认拒绝，须显式确认本机 Lab。
- `scripts/test-oidc-studio-real-late.cases.mjs`：9 项 Node 内置离线用例，验证显式模式、项目写请求白名单、真实 Response 保留/释放、CSRF、重复/异常拒绝、脱敏状态及原草稿恢复 UI 点击辅助。
- `scripts/test-project-browser-oidc.mjs`：只把既有 `enableAutoSaveInPage` 改为命名导出，复用其真实页面辅助函数而不改已有只读/合成拒绝模式。
- 根目录 `package.json`：新增 `test:oidc:dual:studio:config` 到 `ready`，新增独立**手工写入**的 `test:oidc:dual:studio:late`；没有修改生产 React/Vue/NestJS/Core、数据库迁移和工业设备权限。

### 第十七小批首轮失败后的阶段诊断补充

- `scripts/test-oidc-studio-real-late.mjs`：新增 `waitForStudioState`，分别报告真实 201 挂起、第二主体读取 2/追加 3、Studio 消费 201、页面可见、CAS 失效与过期保存拒绝阶段；超时状态仅包含枚举、计数和布尔值。
- `scripts/test-oidc-studio-real-late.cases.mjs`：扩展状态脱敏回归，覆盖 document 可见性布尔值。
- 真实浏览器首轮在“React 真实 201 已到达并挂起”之后退出码 1，根因待新的阶段诊断日志确认；不得把该失败标记为已经修复。

### 第十七小批 · 独立 Chrome/Edge 双窗口可见性修复候选

- `scripts/test-oidc-studio-real-late.mjs`：增加只允许第二主体浏览器窗口 `normal/minimized` 的 CDP 管理函数。真正版本 2→3 读写时恢复第二窗口；提交成功、旧 201 交付后最小化第二窗口，再严格等待第一主体真实 `visible`，后续 CAS/IndexedDB/审计断言原样保留。
- `scripts/test-oidc-studio-real-late.cases.mjs`：从原 9 项新增 2 项窗口命令与失败封闭离线回归，目标 11 项，尚需 Node 实际执行。

### 第十七小批 · 本地数据异常的分阶段分类检查

- `scripts/test-oidc-studio-real-late.mjs`：新增 `classifyStudioLocalDrift`，将 `canvasChanged`、`autoSaveChanged`、`draftCountChanged`、`draftHashChanged` 四项变化分类，并在原保存/远端提交/旧 201 消费/真实 CAS 复核/过期保存拒绝五个阶段执行原强制不变断言，失败只报告字段类别。
- `scripts/test-oidc-studio-real-late.cases.mjs`：增加两项纯函数分类及敏感信息脱敏用例；预期离线总数由 11 增至 **13**。Node/Windows 真实测试待执行。

### 第十七小批 · SVG 内容快照排除动态视口网格

- `scripts/test-oidc-studio-real-late.mjs`：`readStudioContentCanvasInPage` 仅在本联合专项克隆 SVG 并移除单个直系视口网格 `rect`；`inspectStudioProtectedState` 复用原 `inspectStudioState` 的 IndexedDB 与自动保存观察数据，只将 `canvas` 切换为保留其余 SVG 的语义快照。
- `scripts/test-oidc-studio-real-late.cases.mjs`：新增 3 项离线用例，确保动态网格尺寸变化不误报、渲染图元变化仍拒绝、画布缺失和重复网格失败；累计目标 **16 项**。
- 没有修改 React/Vue 生产画布、共享 `test-project-browser-oidc.mjs` 的既有快照、IndexedDB 仓储或安全写入门禁。

## 第三十四批第十八小批 · 冲突后只读核验最新服务端版本

- `packages/api-client/src/studio-session.ts`：新增 `previewLatestVersion`，用真实可信身份和两次服务端水位包围一次经 SHA 校验的最新快照读取；旧上下文、改版竞态和访问拒绝均保持 fail-closed，不建立 CAS、不发写入。
- `packages/api-client/test/studio-session.test.ts`：增加 6 项 Mock 测试，覆盖只读预览、旧基线不可升级为新 CAS、水位并发、迟到 404 不污染新基线、实时权限拒绝和临时网络失败；新增用例仍需 Windows Vitest 实测。
- `apps/web-react/src/studio/StudioPage.tsx` 与 `apps/web-vue/src/studio/StudioPage.vue`：409 后仅对对应工程提供相同中文“只读预览最新版本”操作，核验最新快照与历史第一页水位一致再显示差异；保留既有人工确认载入入口。
- `scripts/test-project-browser-oidc.mjs`：扩展原只读/合成 409 专项，点击真实 React/Vue Studio 恢复按钮，验证真实 GET 对比与零额外工程写入。
- `scripts/test-project-browser-oidc.cases.mjs`：新增 2 项页面按钮与脱敏状态离线回归（目标由 33 项增至 **35 项**）；不新增依赖、HTTP 路由、数据库迁移、Schema 或设备写入权限。

## 第三十四批第十九小批 · 人工确认载入后的安全水位闭环

- `packages/api-client/src/studio-session.ts`：新增 `revalidateConfirmedLoad`，在人工确认后再次只读核对主体、修订号和会话代次，区分 403、409、401/404 和临时网络故障，不产生任何工程写入或提前建立 CAS。
- `packages/api-client/test/studio-session.test.ts`：新增 **8 项** Vitest Mock 回归：最新版本人工确认、显式旧历史版本、确认期间水位变化、旧基线失效、登录主体切换、撤权 404、网络 503、迟到 404 不影响新基线。共享 Session 目标 **45 项**，全量 Vitest 目标 **581 项**。
- `apps/web-react/src/studio/StudioPage.tsx`、`apps/web-vue/src/studio/StudioPage.vue`：既有版本历史“载入”与授权工程列表“打开”都在确认后、暂停自动保存之前调用相同共享只读验证；未改变编辑器引擎、工程格式或后端。
- `scripts/test-project-browser-oidc.mjs`：原真实 Keycloak 双框架 Lab 专项扩展 `confirm-drift` 合成 GET 版本差异，阻止确认后覆盖；409 预览后经真实服务端版本列表按钮进行人工确认载入，核对 CAS 恢复、草稿未覆盖、自动保存暂停且无额外版本 POST。
- `scripts/test-project-browser-oidc.cases.mjs`：新增 **2 项** Node 内置离线保护测试，目标 OIDC 工程浏览器安全离线共 **37 项**；沿用原严格 Lab 环境、临时 Profile、CSRF 和全部工程写请求本地阻断。

## 第三十四批第二十小批 · 真实多标签页 OIDC 会话回归

- scripts/test-oidc-real-multitab.mjs：一个隔离 Chrome/Edge Profile 内创建 React/Vue 写入与跟随四个真实标签页；通过真实标签切换触发既有前台 BFF/CAS 复核，使用正式同源 CSRF 注销接口验证共享会话失效。仅创建一份随机专用工程并追加修订 2/3；创建只使用现有 API 的创建者默认权限，不手工授予其他主体，跟随标签页工程 POST 始终本地阻断。
- scripts/test-oidc-real-multitab.cases.mjs：Node 内置离线安全测试覆盖显式本机数据库确认、真实可见事件计数、同一租户/主体、注销 CSRF 契约、脱敏状态摘要、本地画布/草稿/自动保存一致性及错误脱敏。
- 根 package.json：增加 test:projects:oidc:multitab:config 并纳入 ready；增加独立手工执行的 test:projects:oidc:multitab:browser，不把真实登录、工程写入和注销放入默认质量链。

## 第三十四批遗留 PR #75 · 同源双标签页 CAS 验收工具

- `scripts/test-oidc-studio-multitab.mjs`：一个隔离 Chrome/Edge Profile 内的两页同源 Studio CAS 协同专项，分别覆盖 React/Vue 的修订 1→2→3、真实页面可见性、只读预览、人工载入、草稿保护及同主体数据库审计；仅在明确本机 Lab 确认后启动。
- `scripts/test-oidc-studio-multitab.cases.mjs`：19 项 Node 内置离线安全测试，新增 CDP 页面函数不得引用模块级工程正则的边界回归。
- 根目录 `package.json`：新增 `test:oidc:dual:studio:multitab:config` 纳入 `ready`；`test:oidc:dual:studio:multitab` 为必须单独手动执行的真实浏览器专项。

## V0.3 第三十五批第一小批 · 发布前 SVG 静态兼容性 Core

- `packages/core/src/release-preflight.ts`：框架无关只读 `validateProjectReleasePreflight`，复用现有 Schema 校验，报告未知图元/版本、未消费绑定槽、待确认已绑定 Tag 类型及不受支持的图元规则。无发布写入、权限或数据库依赖。
- `packages/core/src/index.ts`：导出预检函数及结构化问题/结果类型，供未来 React/Vue、后端服务复用；不修改现有 `project-snapshot` 或渲染器行为。
- `packages/core/test/release-preflight.test.ts`：10 项 Vitest 回归覆盖合法演示、结构失败、历史版本不隐式迁移、隐藏未知图元、版本、已绑定 Tag 待确认、未绑定 Tag 保留、非法槽位、未实现规则及多问题稳定路径/无副作用。

## V0.3 第三十五批第二小批 · Studio 发布静态预检入口

- `apps/web-react/src/studio/StudioPage.tsx`、`apps/web-vue/src/studio/StudioPage.vue`：复用 Core `validateProjectReleasePreflight`，在各自工具栏「发布预检」菜单对当前文档实时显示状态及结构化路径/原因，不保存校验副本，不发起任何发布请求。
- `scripts/test-studio-browser.mjs`：新增 `--release-preflight` 的临时隔离浏览器专项，React/Vue 各自演练合法文档通过、含未知图元/规则/已绑定 unknown Tag 的 JSON 导入后失败，以及恢复原文档后的结果重算和工程 JSON 无损。
- `package.json`：新增 `test:release:preflight:browser` 独立命令，不纳入自动 `ready`，需要本机 Web 服务及可用 Chrome/Edge。

## 2026-11-18 · 双框架 Studio 浏览器测试协议探测

- `scripts/studio-browser-targets.mjs`：依据本机 OIDC HTTPS 配置解析并安全探测两套 Web 首页；拒绝远程地址、协议降级及不受信任的证书。供 `scripts/test-studio-browser.mjs` 复用。
- `scripts/studio-browser-targets.cases.mjs`：6 项 Node 离线地址、协议与安全配置回归，由根命令 `test:studio:browser:config` 调用，并纳入 `ready`。

## 2026-11-18 · 第三十五批第四小批服务端只读发布预检

- `apps/server/src/projects/project-api.controller.ts`：只在可信 OIDC 根模块注册的 `GET :projectId/versions/:revision/release-preflight`，会话 Guard + `version:read` 工程 Guard，返回无缓存的静态报告。
- `apps/server/src/projects/prisma-project-version-store.ts`：`preflightRelease` 在同一个只读共享锁事务里复核主体、授权、head 与完整历史快照，委托共享 Core `validateProjectReleasePreflight`；不访问设备或写工程版本。
- `apps/server/src/projects/prisma-project-version-store.spec.ts`：6 项预检安全/完整性单测；`apps/server/test/projects-api.e2e-spec.ts`：4 项受保护 HTTP 路由 Mock E2E。

## 2026-11-18 · 第三十五批第五小批真实发布预检数据库回归

- `apps/server/test/projects-cas-cookie-http.db-spec.ts`：继续复用随机隔离租户和真实 NestJS HTTP + Cookie + PostgreSQL 夹具，新增 4 项当前版本发布预检 200/401、旧版本 409、ACL 撤销 404、随机测试版本摘要破坏 500 的回归。代码不改变 `PrismaProjectVersionStore`、HTTP Controller 或工程 API 契约。
- 独立入口仍为 `pnpm run test:db`（服务端 `vitest.config.db.ts`），未加入常规 `ready`；执行前必须确认 `SCADA_TEST_DATABASE_URL` 是本机 `adui_scada_test` 已迁移隔离库。

## 2026-11-18 · 第三十五批第六小批真实 Keycloak 发布预检浏览器专项

- `scripts/test-oidc-release-preflight.mjs`：复用现有本机受控 OIDC 环境与隔离 Chrome/Edge，人工登录一次，React/Vue 双 HTTPS Origin 中仅通过 BFF Cookie 发 GET，检查已授权工程的当前版本发布预检 200 / 非法修订号 400 / 过期水位 409 / no-store / 摘要一致；返回节点不携带快照或凭据。脚本**没有写入模式**。
- `scripts/test-oidc-release-preflight.cases.mjs`：11 项纯 Node 配置/浏览器请求契约测试；根命令 `test:release:preflight:oidc:config` 纳入 `ready`，交互式 `test:release:preflight:oidc:browser` 必须手动执行。

## 2026-11-18 · 第三十五批第七小批共享发布预检 API Client

- `packages/api-client/src/index.ts`：`ScadaApiClient.preflightRelease`、`ScadaReleasePreflightReport` 和服务端响应白名单解析；只使用现有同源 GET、`Cache-Control: no-store`、OIDC/BFF Cookie，拒绝未知问题码与跨工程/修订号响应。
- `packages/api-client/test/api-client.test.ts`：新增 8 项只读路径、输入限制、合法错误报告、禁缓存、响应结构、错误映射测试。
- `packages/api-client/test/studio-session.test.ts`：增加与共享 Client 扩展保持类型一致的预检 Mock；既有 CAS 逻辑与断言保持不变。

## 2026-11-18 · 第三十五批第八小批 Studio 双框架服务端预检

- `packages/api-client/src/server-release-preflight.ts`：共享当前服务端版本头/快照 SHA-256/只读报告/最终水位的四步 GET 编排，遇到摘要不一致或版本推进拒绝成功。
- `packages/api-client/test/server-release-preflight.test.ts`：新增 5 项当前版本、并发更新、摘要不一致、快照错版及 ACL 拒绝回归。
- `apps/web-react/src/studio/ServerReleasePreflight.tsx` 与 `apps/web-vue/src/studio/ServerReleasePreflight.vue`：独立于本地静态兼容性预检的手动服务端已保存版本预检；对比当前画布与真实快照、显示中文安全告知、授权失败时回报父级。
- `apps/web-react/src/studio/StudioPage.tsx` 与 `apps/web-vue/src/studio/StudioPage.vue`：接入上述双端组件，按工程/已知最新水位/授权上下文强制清理旧 UI 结果，不修改保存和 IndexedDB 流程。
- `scripts/test-studio-browser.mjs`：现有 `--release-preflight` 浏览器流程检查双端手动服务端入口存在、未执行时不展示服务端成功，继续保留 JSON 导入/恢复静态结果检查。

## 2026-11-18 · 第三十五批第九小批真实 Studio Keycloak 预检专项

- `scripts/test-oidc-studio-release-preflight.mjs`：复用已有隔离 Chrome/Edge、真实 Keycloak 登录与只读工程选择，顺序点击 React/Vue 正式 UI“检查服务端已保存版本”，守卫只允许同源工程 GET 并模拟预检 409/401/404，核对远端水位/摘要与本地画布/草稿/CAS。
- `scripts/test-oidc-studio-release-preflight.cases.mjs`：12 项纯 Node 契约、安全模式、CDP 序列化及 UI 选择器测试；`test:release:preflight:oidc:studio:config` 随 `ready` 自动执行，交互式 `test:release:preflight:oidc:studio:browser` 独立运行。

## 2026-11-18 · 第三十五批第十小批迟到认证拒绝回归

- `apps/web-react/src/studio/ServerReleasePreflight.tsx`、`apps/web-vue/src/studio/ServerReleasePreflight.vue`：预检失败的会话级授权拒绝与当前文档局部错误显示解耦，防止编辑期间延迟 401/403/404 丢失父级 CAS 失效信号。
- `scripts/test-oidc-studio-release-preflight.mjs`：原真实双 HTTPS Origin 浏览器专项新增指定当前版本的单次延迟 401，编辑画布后释放，严格比对 CAS 失效、本地 SVG/JSON/草稿不变。
- `scripts/test-oidc-studio-release-preflight.cases.mjs`：新增第 13 项 Node 离线门禁，覆盖单次延迟 401、拒绝提前释放或重臂、零网络写入。

## 2026-11-18 · 第三十五批第十一小批正式发布方案

- `docs/adr/0069-release-pointer-atomic-publication-design.md`：**Proposed** 的发布指针/代次、发布事件、独立 ACL、事务锁序、回滚目标、Runtime 只读加载及分阶段验收边界。尚无对应生产源码/数据库变更；不能将 ADR 视为已实现功能。

## 2026-11-18 · 第三十五批第十二小批发布事务评审矩阵

- `docs/RELEASE_TRANSACTION_REVIEW.md`：ADR-0069 Proposed 设计的 R-01～R-08 维护者决策、I-01～I-06 不变量和 T-01～T-22 未来数据库/HTTP/Runtime 安全负向测试；当前只用于评审，不包含可执行发布代码。
- `docs/adr/0069-release-pointer-atomic-publication-design.md`：新增评审矩阵交叉引用，**状态仍为 Proposed**。

## 2026-11-18 · 第三十五批第十三小批 ADR-0069 Accepted 架构决策

- `docs/adr/0069-release-pointer-atomic-publication-design.md`：ADR-0069 已由维护者批准为 **Accepted**；仅确定正式发布指针、代次、原子事务、独立权限、回滚、Runtime 和工业安全边界，不代表功能实现。
- `docs/RELEASE_TRANSACTION_DECISION_RECORD.md`：记录维护者批准的 R-01～R-08 决策基线及后续实施顺序。
- `docs/RELEASE_TRANSACTION_REVIEW.md`：记录已批准的 R-01～R-08、I-01～I-06 不变量和 T-01～T-22 **未来测试义务**；T 场景尚未执行。
- FR-008 继续规划中；当前 main 无正式发布/回滚写 API、Runtime 发布指针加载或设备写入许可。

## 2026-11-19 · 第三十五批 B 阶段正式发布 Schema 复合引用

- apps/server/prisma/schema.prisma：六个工程持久化模型；发布状态、发布事件和不可变版本通过租户/工程/修订/摘要/代次复合关系保持引用闭包。
- apps/server/prisma/migrations/20261118000000_release_state_and_events/migration.sql：正式发布状态/事件表及默认拒绝的独立发布权限；已应用迁移保持不可变。
- apps/server/prisma/migrations/20261119000000_release_state_event_integrity/migration.sql：版本摘要复合唯一键、发布状态与事件的复合外键及其中文索引注释。
- apps/server/test/release-schema.db-spec.ts：隔离 PostgreSQL 验证跨工程事件引用、错误代次、错误版本摘要和正确状态引用。

## 2026-11-19 · 第三十五批 C1 正式发布事务（已合并）

- `apps/server/src/projects/project-release-safety-gate.ts`：正式发布安全门禁接口；生产默认 Provider 固定 fail-closed，门禁未完成返回 503。
- `apps/server/src/projects/prisma-project-release-store.ts`：发布事务仓储，负责输入白名单、会话/身份/ACL 事务内复核、工程/发布状态/不可变版本行锁、双 CAS、幂等、快照完整性、Core 静态预检、事件与发布指针原子提交。
- `apps/server/src/projects/prisma-project-release-store.spec.ts`：发布事务仓储单元测试，13 项覆盖输入、会话、权限、CAS、快照、默认门禁、事务提交和幂等。
- `apps/server/src/projects/project-api.controller.ts`：增加 `POST /api/v1/projects/:projectId/releases`，要求 `release:publish` 和 UUID v4 `Idempotency-Key`。
- `apps/server/src/projects/project-api.exception-filter.ts`：映射发布冲突、会话失效、静态预检失败和门禁未就绪；错误响应禁止缓存。
- `apps/server/src/projects/project-persistence.module.ts`：注册发布仓储和默认安全门禁 Provider。
- `apps/server/test/projects-api.e2e-spec.ts`：HTTP 路由、独立权限、CSRF、no-store 和默认门禁错误映射；完整服务端 E2E 59/59 通过。
- `apps/server/test/release-transaction.db-spec.ts`：真实隔离 PostgreSQL 发布事务测试，10 项覆盖事件/指针原子性、幂等、并发 CAS、撤权/会话锁竞争及 fail-closed 场景；最终 10/10 通过。
- `apps/server/test/projects-cas-cookie-http.db-spec.ts`：双 Cookie 真实 HTTP + PostgreSQL CAS 测试，11 项覆盖身份隔离、CSRF/Origin、并发 CAS、迟到响应、注销、ACL 撤销和只读预检；最终 11/11 通过。测试模块注册真实发布仓储与默认 fail-closed 安全门禁。

## 2026-11-19 · 第三十五批 C1 合并与验收状态

PR #100 已合并至 main（`8db55e4b1bb97d69c08dc9238eb61f76071b7e72`）。C1 新增发布事务仓储、默认 fail-closed 安全门禁和发布 HTTP 路由；生产发布请求仍返回 503。最终 Windows 验收：PostgreSQL 6/6 文件、52/52 用例；单测 633/633；HTTP E2E 59/59；React/Vue/Server 构建及完整 `ready` 通过。

## 2026-11-19 · 第三十五批 D1 服务端只读发布读取候选

- `apps/server/src/projects/project-access-policy.ts`：增加独立工程权限 `release:read`；不加入工程创建者默认权限。
- `apps/server/src/projects/prisma-project-release-store.ts`：增加 `readCurrent`；事务内复核会话、主体、ACL、发布状态、最后发布事件和不可变快照摘要；工程锁只查询 `project_id`，不读取 `head_revision`。
- `apps/server/src/projects/project-api.controller.ts`：增加 `GET /api/v1/projects/:projectId/releases/current`，独立 `release:read` Guard 与 `no-store`。
- `apps/server/prisma/migrations/20261119180000_release_read_permission/migration.sql`：扩展工程授权权限 CHECK 白名单并更新中文列注释，不自动授予现有主体。
- `apps/server/src/projects/project-access-policy.spec.ts`、`prisma-project-release-store.spec.ts`：覆盖权限不继承、未发布状态、发布事件/指针和快照摘要校验。
- `apps/server/test/projects-api.e2e-spec.ts`、`release-transaction.db-spec.ts`、`release-schema.db-spec.ts`：覆盖 HTTP 会话/ACL、未发布、仅 release:read、跨租户同 ID、快照篡改和真实数据库权限约束。

本节记录的是 D1 候选分支内容；测试与迁移结果须以维护者 Windows 和隔离 PostgreSQL 实测为准。

## 2026-11-20 · 第三十五批 D2a 共享发布态基础设施候选

- `packages/core/src/published-release.ts`：严格解析当前正式发布响应，验证指针、事件、不可变快照和 SHA-256；由 Core `index.ts` 导出。
- `packages/core/test/published-release.test.ts`：未发布、已发布、回滚、跨工程、异常状态、额外字段和篡改负向测试。
- `packages/api-client/src/index.ts`：增加 `ScadaApiClient.readCurrentRelease(projectId, signal?)`，复用同源 Cookie Fetch 安全协议；为发布快照响应预留有限元数据容量。
- `packages/api-client/test/published-release.test.ts`：同源、禁止缓存、响应大小、授权拒绝、快照与网络失败测试；`studio-session.test.ts` 同步既有完整接口 Mock。
- `packages/runtime/src/published-runtime.ts`：`PublishedRuntime` 及发布状态机；由 Runtime `index.ts` 导出，不混用演示 `DemoRuntime`。
- `packages/runtime/test/published-runtime.test.ts`：未发布/已验证、离线、撤权、事件代次回退、合法回滚、跨工程旧响应、停止取消、非法 ID 等用例。

没有新增后端路由、数据库迁移、设备写入或前端 UI 变更。

## 2026-11-20 · 第三十五批 D2b 发布指针刷新与版本切换候选

- `packages/runtime/src/published-runtime-refresher.ts`：新增 `PublishedRuntimeRefresher`，通过外部 `start/refresh/setVisible/stop` 控制串行发布指针 GET；定时刷新默认 15 秒、单次请求超时默认 10 秒、离线有界退避默认最多 60 秒；测试可注入调度器。
- `packages/runtime/src/published-runtime.ts`：补充 `expire()` 处理无响应读取超时，以及 `suspend()` 隐藏时清空可显示正文但不清除同会话单调发布水位；原 `stop()` 仍彻底清理。
- `packages/runtime/src/index.ts`：导出刷新器和调度器配置类型。
- `packages/runtime/test/published-runtime-refresher.test.ts`：新增定时切版、未变化指针校验、离线退避/恢复、授权撤销、摘要篡改、隐藏/重显、水位防回退、并发单请求、超时迟到响应、停止/工程切换资源回收及参数校验测试。

没有新数据库迁移、API 写入、React/Vue UI 变更或工业设备操作。

## 2026-11-20 · 第三十五批 D3/D4 双框架正式发布只读 UI 候选

- `packages/runtime/src/published-runtime-view.ts`：共享发布状态中文名称及 `publishedSnapshotSvg`；仅空 Tag 静态 SVG、Schema 白名单，不混入模拟值。
- `packages/runtime/src/index.ts`：导出只读发布视图契约。
- `packages/runtime/test/published-runtime-view.test.ts`：状态中文文案、静态 SVG 不携带模拟 Tag 和空页面拒绝的基础单测。
- `apps/web-react/src/runtime/PublishedRuntimePage.tsx`：React 页面挂载创建受控会话，输入工程 ID、显式读取/刷新/停止、可见性与卸载清理、静态组态预览。
- `apps/web-vue/src/runtime/PublishedRuntimePage.vue`：Vue Composition API 对等实现，复用相同运行时控制器和状态。
- `apps/web-react/src/App.tsx`、`apps/web-vue/src/App.vue`：新增对等第三导航项“已发布运行”，两端均懒加载新页，不取代原模拟监控或 Studio。
- `packages/runtime/src/runtime.css`：共享只读工程 ID 输入、按钮和发布状态样式，无新样式依赖。

无 Prisma Schema、发布写事务、生产安全门禁或外部依赖变更。

## 2026-11-20 · 第三十五批 D5a 真正 OIDC/HTTPS 发布读取只读拒绝候选

- `scripts/test-oidc-published-runtime-readonly.mjs`：复用可信 Keycloak Lab 和 Chrome/Edge CDP，真实 React/Vue 页面点击“已发布运行”，固定随机不存在工程 ID 的只读发布路径，断言拒绝、无静态 SVG、Tag `UNAVAILABLE` 与零工程写入；浏览器页面函数自包含且只输出安全类别。
- `scripts/test-oidc-published-runtime-readonly.cases.mjs`：新增 10 项 Node 自有门禁测试，覆盖无参模式、同源 GET、非 GET/跨站/正文拦截、身份路由透传、重复安装、CDP 独立作用域、真实按钮选择、非法 ID、脱敏状态及异常脱敏。
- 根 `package.json`：`test:published:oidc:config`（加入 `ready`）、`test:published:oidc:browser`（手工启动，需真实 HTTPS 与 IdP 登录）。
- 对应需求、SDD、架构、验收与上下文文档同步；不新增运行时依赖、数据库迁移或设备接口。

## 2026-11-20 · D5b1 本机未发布授权夹具准备入口

- `scripts/prepare-oidc-published-unreleased.mjs`：受限 OIDC Lab 真实已授权未发布夹具准备；默认仅预检迁移与可信主体，显式确认后通过现有 HTTP 工程创建 API 建立随机新工程，再以单一可回滚 SQL 事务补充此工程的 `release:read`，最后只读核对 UNRELEASED。
- `scripts/prepare-oidc-published-unreleased.cases.mjs`：9 项 Node 安全回归，包括非法/生产参数拒绝、CSRF 同源工程创建、首版/审计/状态/ACL 核验、回滚及脱敏、只读发布 GET。
- 根 `package.json`：`test:published:oidc:fixture:config` 加入 `ready`；`oidc:lab:published:unreleased` 为必须人工显式执行的真实数据准备工具，不加入 `ready`。

本小批不改变共享 Core、Vue/React、NestJS 实现、Prisma Schema/迁移、生产发布安全门禁或设备读写，新增数据只在维护者明确授权的本机 Lab 手工执行时产生。

## 2026-11-20 · D5b2 已授权未发布离线恢复安全测试

- `scripts/test-oidc-published-runtime-offline.mjs`：双框架 HTTPS OIDC 浏览器专项，已存在的 `d5b-unreleased-<UUIDv4>` 只读工程，真实 GET 200 → 一次 Fetch 网络拒绝（模拟）→ 离线无快照 → 真实 GET 200 恢复 → 停止读取；不连接设备、不修改数据库或权限。
- `scripts/test-oidc-published-runtime-offline.cases.mjs`：9 项离线故障输入边界、注入时序、一次性失败、跨 Origin 与写入拒绝、真实控件、清空状态、请求审计和脱敏门禁。
- `package.json`：`test:published:oidc:offline:config` 加入 `ready`；`test:published:oidc:offline:browser` 保持需要维护者手工登录的独立真实浏览器专项。

## 2026-11-20 · D5b3 单次模拟 HTTP 404 访问拒绝与恢复

- `scripts/test-oidc-published-runtime-denied.mjs`：本机双框架可信 HTTPS OIDC 浏览器只读专项；真实 200 UNRELEASED → 只对精确当前工程发布 GET 本地构造一次 HTTP 404 → 状态 denied/无快照 → 真实 200 恢复 → 停止读取；绝不进行数据库 ACL 删除或发布写入。
- `scripts/test-oidc-published-runtime-denied.cases.mjs`：9 项默认只读参数、单次 404 模拟、跨站/非 GET 拦截、状态清理、请求白名单和错误脱敏门禁。
- `package.json`：`test:published:oidc:denied:config` 加入完整 `ready`；`test:published:oidc:denied:browser` 需要维护者手动 Keycloak 登录，独立验收且不加入 `ready`。

## 2026-11-20 · D5b4a 真实发布读取 ACL 撤销前只读预检

- `scripts/preflight-oidc-published-revocation.mjs`：强制无参数，使用现有受控本机 Keycloak/HTTPS/PG Lab 校验器；在 PostgreSQL `REPEATABLE READ READ ONLY` 事务内确认原 D5b1 工程、四项权限、发布迁移和可信身份完整，以及尚无 `d5b4-revoke-%` 专用工程；最终 ROLLBACK/关闭连接。
- `scripts/preflight-oidc-published-revocation.cases.mjs`：10 项 Node 脱敏、只读 SQL、事务回滚、数据库/迁移/身份/工程/ACL 漂移拒绝安全门禁。
- `package.json`：`test:published:oidc:revoke:preflight:config` 加入 `ready`；`oidc:lab:published:revoke:preflight` 为维护者手工执行的真实数据库只读检查（不加入 `ready`）。
- 后续真实撤权须对全新独立工程单独授权，**绝不复用或删除已通过 D5b1～D5b3 专项的原工程授权**。

## 2026-11-20 · D5b4b 独立撤权夹具准备

- `scripts/prepare-oidc-published-revocation.mjs`：默认无参只读检查 D5b4a 基线；单独授权后才能使用显式双确认，生成全新 `d5b4-revoke-<UUIDv4>`，通过正式同源 BFF POST / Cookie CSRF 创建唯一空白首版，`SERIALIZABLE` 检查首版/审计、D5b1 原授权并仅给新工程 INSERT 一条 `release:read`，最后只读验证 `200 UNRELEASED`，不做 ACL 删除。
- `scripts/prepare-oidc-published-revocation.cases.mjs`：11 项 Node 测试覆盖写入参数、跨 Origin、CSRF、工程 ID、授权限域、事务回滚、原工程保护、发布 GET 只读与脱敏。
- `package.json`：新增 `test:published:oidc:revoke:fixture:config` 并加入 `ready`；新增只读默认入口 `oidc:lab:published:revoke:fixture`，独立真实 Lab 验收必须手动执行，写入仍需额外批准。

## 2026-11-22 · D5b4c 实际撤权前的专用工程只读核验

- `scripts/preflight-oidc-published-revocation-target.mjs`：要求明确传入现有 `d5b4-revoke-<UUIDv4>`，只在可信本机 OIDC/PG Lab 的 `REPEATABLE READ READ ONLY` 事务中检查独立工程唯一性、首版/未发布/四项 ACL，并核对原 D5b1 工程和授权完整；零数据写入。
- `scripts/preflight-oidc-published-revocation-target.cases.mjs`：10 项 Node 测试覆盖严格参数、数据库/迁移/身份、工程唯一性、首版/事件、目标与旧项目 ACL、SQL READ ONLY、回滚及诊断脱敏。
- `package.json`：`test:published:oidc:revoke:target:config` 加入 `ready`；`oidc:lab:published:revoke:target` 必须在维护者另行授权创建独立工程后手动运行。当前无工程时应安全失败，不得伪造成功。

## 2026-11-22 · D5b4d 双阶段真实只读浏览器安全验收候选

- `scripts/test-oidc-published-revocation-readonly.mjs`：只接受 `--phase before|after --project-id d5b4-revoke-<UUIDv4>`；复用原双框架 OIDC/HTTPS CDP 与只读工程 Fetch 门禁，新增不改响应的 `no-store` 和非重定向同源观察器；严格要求撤权前真实 200/UNRELEASED、撤权后真实 404/denied、零快照与零写入，并检查停止读取后无新增 GET。
- `scripts/test-oidc-published-revocation-readonly.cases.mjs`：15 项 Node 安全回归定义，覆盖参数拒绝、独立 CDP 函数、GET 及缓存头、跨 Origin/写入拦截、阶段错位、状态清理和诊断脱敏。
- `package.json`：`test:published:oidc:revoke:readonly:config` 进入 `ready`；`test:published:oidc:revoke:readonly:browser` 为需要独立授权专用工程/未来真实撤权后的手工运行入口，不加入 `ready`。

本批不变更服务端权限、Prisma Schema/SQL、React/Vue 生产 UI、工程数据、工业设备。当前仅完成候选代码与隔离自检，正式 Windows/Keycloak/PostgreSQL 验收尚待执行。

## 2026-11-22 · D5b4e 撤权后 PostgreSQL 只读审计候选

- `scripts/preflight-oidc-published-revocation-target.mjs`：原 D5b4c 只读 SQL 与前置四项 ACL 默认校验不变；额外导出撤权后目标 ACL 严格三项判定，支持仅内部调用的 `after` 阶段，继续核对原 D5b1 工程与全部安全元数据，始终 READ ONLY/ROLLBACK。
- `scripts/preflight-oidc-published-revocation-after.mjs`：D5b4e 独立只读 CLI，只接受明确的 `d5b4-revoke-<UUIDv4>` 工程 ID，复用可信本机 OIDC/PG 目标检查和原 SQL，不提供创建、撤权或恢复操作。
- `scripts/preflight-oidc-published-revocation-after.cases.mjs`：11 项 Node 测试定义，覆盖三项最小权限、旧 D5b1 四项、首版/审计/发布状态、迁移/可信身份、唯一工程、只读事务/回滚、非法参数和错误脱敏。
- 根 `package.json`：`test:published:oidc:revoke:after:config` 加入 `ready`；`oidc:lab:published:revoke:after` 为人工运行、不会自动触发的真实 PostgreSQL READ ONLY 核验入口。

本批不修改 NestJS 业务、Vue/React Runtime、Prisma Schema/迁移或工业设备读写功能，禁止真实数据库写入。

## 2026-11-22 · D5b4f 同阶段只读验收编排

- `scripts/test-oidc-published-revocation-sequence.mjs`：手工 CLI，阶段仅可为 `before` / `after` 且工程 ID 必须是 `d5b4-revoke-<UUIDv4>`；固定串行调用同阶段 PostgreSQL 只读核验 → React/Vue 真实只读 GET → PostgreSQL 再核验，所有命令使用 Node `process.execPath` / `shell: false`，任意失败立即中止。
- `scripts/test-oidc-published-revocation-sequence.cases.mjs`：10 项离线安全门禁，覆盖非法参数、固定脚本及顺序、双阶段差异、首次失败/浏览器失败/末次漂移停止、异步串行和异常脱敏。
- 根 `package.json`：`test:published:oidc:revoke:sequence:config` 纳入 `ready`；真实 `oidc:lab:published:revoke:sequence` 仅供以后获单独授权人工执行，不在自动检查中。

D5b4f 不更改 D5b4c/D5b4d/D5b4e 原有安全脚本、NestJS/Prisma、Vue/React 生产业务代码或工业设备读写能力。

## 2026-11-22 · D5b4g 专用单条发布读取授权撤销候选

- `scripts/preflight-oidc-published-revocation-target.mjs`：提取不含事务控制的 `readPublishedRevocationRows` 查询，供原 D5b4c/e READ ONLY 检查与新锁内事务复用；原前后 ACL 断言、查询 SQL、READ ONLY/ROLLBACK 流程保持不变。
- `scripts/revoke-oidc-published-read-target.mjs`：独立候选，默认只读；未来写入需目标工程 ID 双重确认和受控 Lab，`SERIALIZABLE` 锁目标工程行，锁内复核全部基线，仅单条定向 `DELETE … RETURNING`，再校验 D5b4e 三项 ACL 和原 D5b1，提交后独立 READ ONLY 复核；任何不确定状态禁止自动重试。
- `scripts/revoke-oidc-published-read-target.cases.mjs`：新增 13 项 Node 离线安全用例定义，覆盖非法参数、精确删除范围、前后 ACL、并发漂移模拟、回滚、未知 COMMIT 与安全脱敏。
- 根 `package.json`：`test:published:oidc:revoke:single:config` 纳入 `ready`；`oidc:lab:published:revoke:single` 为必须单独授权并人工运行的受控入口，绝不自动调用。

本批没有修改 NestJS ACL 管理服务、Prisma Schema/迁移、React/Vue 业务代码或工业设备，**尚未执行任何数据库写入**。

## 2026-11-22 · D5b5 Studio 同工程撤权发布读取与草稿保护候选

- `scripts/test-oidc-studio-revoked-draft.mjs`：双框架真实只读浏览器入口，仅接收已存在的 `d5b4-revoke-<UUIDv4>`；临时独立浏览器 Profile、BFF 可信登录、Studio 正式项目列表与首版载入、IndexedDB 草稿保存、未保存 SVG/JSON 编辑、同一工程真实发布指针 GET 404/no-store、前后本地数据与 CAS 严格比对。远端工程写请求全部拦截，不能创建工程、撤销/恢复 ACL。
- `scripts/test-oidc-studio-revoked-draft.cases.mjs`：11 项离线 Node 测试定义，覆盖只读请求白名单、页面 CDP 自包含、响应来源/缓存、草稿准备判别力、编辑/草稿/CAS 漂移、请求多发及错误脱敏。
- 根 `package.json`：`test:published:oidc:revoke:studio:config` 加入 `ready`；`test:published:oidc:revoke:studio:browser` 仅供真实 Lab 单独人工执行，不自动接入 `ready`。

不修改 React/Vue Studio 生产源码、Schema、NestJS 授权、Prisma SQL 及工业设备功能。

## 2026-11-22 · D5b5b React/Vue 同源双标签页只读回归候选

- `scripts/test-oidc-studio-revoked-multitab.mjs`：严格只接收已撤权 `d5b4-revoke-<UUIDv4>`；复用现有 Chrome/Edge 临时 Profile 和第二标签页 CDP、真实 OIDC 同主体、两标签首版 Studio 只读载入、第一标签本地 IndexedDB 草稿保存、两标签未保存文本、真实页面可见性切换及顺序单次同源发布 GET 404；前后 SVG、JSON SHA-256、草稿摘要、CAS 必须严格不变，工程 API Fetch 写入由已有只读守卫拦截。
- `scripts/test-oidc-studio-revoked-multitab.cases.mjs`：新增 **11 项** Node 离线安全门禁，覆盖命令参数拒绝、共享草稿数量/哈希、首版 CAS/自动保存、各标签本地数据漂移、守卫阻断及独立 CDP 可见性/安全诊断。
- `scripts/test-oidc-studio-revoked-draft.mjs`：只导出已有首版载入和 Studio 本地快照函数供第二小批复用，原第一小批运行流程、断言和真实登录契约不变。
- `scripts/test-oidc-studio-multitab.mjs`：只导出已存在的 `openCompanionChromeTab`，不调用该旧脚本的创建工程、服务端保存或数据库审计流程。
- 根 `package.json`：`test:published:oidc:revoke:multitab:config` 纳入 `ready`；`test:published:oidc:revoke:multitab:browser` 必须手工运行，绝不在自动质量链连接 Keycloak。

**覆盖界限**：这是同一 Origin 的真实双标签页**顺序**只读发布 GET 与本地保护，并非同时挂起多个响应、Studio 内部迟到响应状态机或真实多标签工程写入竞态。未修改 React/Vue 生产逻辑、NestJS/Prisma、工业设备或权限授权。

## 2026-11-22 · D5b5c 双标签页真实 404 逆序交付测试候选

- `scripts/test-oidc-studio-revoked-late-gate.mjs`：独立 CDP 页面函数及纯 Node 断言，只挂起已到达真实 HTTP 404 的 Response 交付，保证同源、单次 GET、禁缓存、零重定向及固定诊断状态；不制造模拟响应。
- `scripts/test-oidc-studio-revoked-late-gate.cases.mjs`：13 项原生 Node 安全用例，含双页 Promise 同时 pending、逆序释放、重复请求、意外状态、CDP Realm 自包含与敏感信息脱敏。
- `scripts/test-oidc-studio-revoked-late-multitab.mjs`：React/Vue 两 Origin 各用同一隔离 Profile 的两个真实标签页，在一次本地 IndexedDB 草稿和未保存编辑基础上逆序交付两个真实 GET 404，严格核对 SVG、JSON、草稿与 CAS。
- `scripts/test-oidc-studio-revoked-multitab.mjs`：仅导出原有 `waitForStudioReady`、`switchToTab` 两个辅助函数供新浏览器脚本复用；原顺序执行逻辑不变。
- 根 `package.json`：`test:published:oidc:revoke:late:config` 纳入 `ready`，`test:published:oidc:revoke:late:browser` 仅限维护者本机可信 Lab 手工执行。

**不修改** React/Vue/NestJS/Prisma/工程授权或工业设备；测试不会在服务端创建工程、回滚撤权或执行版本 POST。

## 2026-11-22 · E-077 D5b5b/D5b5c 已知错误精确诊断

- `scripts/test-oidc-studio-revoked-multitab.mjs`：新增 `D5B5_PROTECTION_REASONS` 与 `classifyD5b5PreservationFailure`；`verifySingleRevokedGet` 在原有 `requireD5b5Preserved` 抛错后输出白名单类别，不合并请求、响应及草稿异常。
- `scripts/test-oidc-studio-revoked-late-multitab.mjs`：复用同一诊断分类，避免 D5b5c 将 D5b5 的已知固定错误再次泛化；完整原 404/草稿/CAS 断言保留。
- `scripts/test-oidc-studio-revoked-multitab.cases.mjs`：增加 5 项原严格断言正反向及分类覆盖；`scripts/test-oidc-studio-revoked-late-gate.cases.mjs`：增加 1 项安全白名单透传测试。
- `scripts/test-oidc-studio-revoked-draft.mjs` 与只读网络守卫、React/Vue Studio、NestJS、Prisma、工程 ACL 均未修改。浏览器失败的实际底层差异仍待 Windows 真实阶段分类。

## 2026-11-22 · E-078 异步工程只读 GET 守卫响应等待

- `scripts/test-oidc-studio-revoked-multitab.mjs`：新增 `requireD5b5ReadGuardProgress` 与 `waitForD5b5ReadGuardSettled`，只等待真实 `fetch` 已发出但尚未登记的状态返回；两次发布 GET 前后及最终复核前使用，有界超时保持失败。
- `scripts/test-oidc-studio-revoked-late-multitab.mjs`：复用同一只读响应结算等待，避免第二页真实 Response 交付后拿未完成的后台 GET 状态做严格数量比较；仍完整执行相同的 404/no-store/无重定向、SVG/JSON/草稿/CAS 与零写入检查。
- `scripts/test-oidc-studio-revoked-multitab.cases.mjs`：新增 4 项异步响应补齐、只读门禁异常、额外 GET 严格拒绝的离线用例，目标由 16 项变成 20 项。D5b5c 原 14 项未修改。
- 原有 `scripts/test-oidc-published-runtime-readonly.mjs` 的响应记录机制、业务代码与数据库权限均不变。

## 2026-11-22 · E-079 D5b5c 响应逆序交付与可见性恢复顺序

- `scripts/test-oidc-studio-revoked-late-multitab.mjs`：第二标签先交付并完成单次目标 GET/404 检查后，**第一标签保持隐藏完成后交付及相同严格检查**；随后 `switchToTab(browser, second)` 恢复第一标签可见，执行最终 SVG/JSON/IndexedDB/CAS 和零工程写入复核。可见性切换不会插入两次响应交付的严格请求计数窗口。
- `scripts/test-oidc-studio-revoked-late-gate.cases.mjs`：新增 1 项 Node 负向边界用例，验证隐藏的第一标签仍能接收真实 Response、第二标签先交付且两页各只发一次只读 GET；总数由 14 增至 15 项。
- `scripts/test-oidc-studio-revoked-multitab.mjs`、已合并 D5b5b 顺序浏览器行为、原始只读 HTTP 守卫、Vue/React/NestJS 生产代码、Prisma 与 ACL 均未修改。

## 2026-11-22 · D5b6 已撤权已发布运行页隐藏重显只读验收

- `scripts/test-oidc-published-revoked-visibility.mjs`：真实 React/Vue“已发布运行”业务导航与原生按钮、可信 OIDC/BFF、两个同源 Chrome 标签页可见性切换；复用既有工程 API 只读守卫和 D5b4 状态观察器，逐阶段严格比较首次 404、隐藏清空、重显第二次真实 404、停止后零新增请求及 Tag `UNAVAILABLE`。
- `scripts/test-oidc-published-revoked-visibility.cases.mjs`：新增 13 项 Node 离线安全门禁，严格拒绝不可信工程 ID、额外 GET/状态码、缓存或重定向、残留发布数据、被阻断写入及诊断敏感泄漏。
- 根 `package.json`：`test:published:oidc:revoke:visibility:config` 加入 `ready`；`test:published:oidc:revoke:visibility:browser` 需维护者本机可信 HTTPS/Keycloak Lab 手工执行，不自动进 `ready`。
- 复用 `apps/web-react/src/runtime/PublishedRuntimePage.tsx`、`apps/web-vue/src/runtime/PublishedRuntimePage.vue`、`PublishedRuntimeRefresher` 和已存在 D5b4/D5b5 CDP 辅助函数，不修改生产代码或数据库/ACL。

## 2026-11-22 · D5b7a 已发布运行拒绝与迟到合法响应纯测试

- `packages/runtime/test/published-runtime-refresher.test.ts`：沿用 `published()` 合法快照夹具、`manualClock()` 单次调度与 `fixture()` 注入，只新增 2 项 `verified → loading → denied` 和 `verified → loading → hidden → denied → late 200 ignored` 测试。现有 15 项变为预计 17 项；无生产 Runtime 代码变更。
- 根 `pnpm run ready` 本身已包含共享 Vitest，**无需新增 package.json 命令**。`docs/HARNESS.md` 提供 Windows 定向 `vp test` 与完整质量链指令，不涉及 Keycloak、PostgreSQL、Lab 写入、ACL 恢复或工业设备。

## 2026-11-22 · D5b7b 已发布工程元数据离线分类

- `scripts/audit-published-fixture-metadata.mjs`：纯函数核验显式独立工程 ID、可信本机 Lab 元数据、`release:read` 授权、未发布空指针及已发布版本/事件一致性；只返回 `DENIED`、`UNRELEASED` 或 `RELEASED_METADATA_ONLY`，不读取快照正文、连接数据库或操作 ACL。
- `scripts/audit-published-fixture-metadata.cases.mjs`：14 项原生 Node 安全回归，含非法参数、租户/主体/授权、版本摘要、事件、未发布状态、额外敏感字段及无副作用保护。
- 根 `package.json`：新增 `test:published:oidc:fixture:metadata:config` 并纳入 `ready`；没有真实数据库/浏览器自动命令。

此处仅建立 Issue #126 后续只读审查的**离线元数据门禁**，真实已发布夹具、发布快照校验、在线 `verified → denied` 和工业安全审批均未完成。

## 2026-11-22 · D5b7c 发布夹具数据库只读审查入口

- `scripts/inspect-published-fixture-readonly.mjs`：显式独立工程 ID 入口，复用现有可信本机 OIDC Lab 目标校验，查询三项已完成迁移、活动身份/预绑定、工程权限、发布指针/版本/事件最小元数据；严格 `REPEATABLE READ READ ONLY` 和 `ROLLBACK`，不会读取快照正文。
- `scripts/inspect-published-fixture-readonly.cases.mjs`：原生 Node 离线 Mock 负向测试，覆盖唯一读授权、真实 SQL 参数、发布/未发布/撤权状态、缺失迁移、身份、版本/事件漂移、SQL 故障及脱敏。
- `package.json`：增加 `test:published:oidc:fixture:readonly:config` 并加入 `ready`；单独手动入口 `oidc:lab:published:fixture:readonly` 不属于自动质量链。

不修改 React/Vue、NestJS、Runtime、Prisma 迁移、ACL 或发布门禁；无真实已发布夹具或正式撤权验证证据。

## 2026-11-22 · D5b7d 原 D5b1 未发布基线只读保护

- `scripts/assert-published-fixture-baseline.mjs`：纯函数严格核验固定 D5b1 原工程首版、版本保存审计、零发布代次/指针/事件及四项原主体 ACL；只接受最小元数据字段，不读取工程正文。
- `scripts/assert-published-fixture-baseline.cases.mjs`：原基线完整、漂移/跨主体/额外权限/污染字段和输入不可变性等 5 项 Node 独立安全测试。
- `scripts/inspect-published-fixture-readonly.mjs`：复用既有事务，在验证身份和读取目标之前查询六类原工程元数据，基线漂移安全拒绝并 ROLLBACK。
- `scripts/inspect-published-fixture-readonly.cases.mjs`：扩展原 Mock 区分目标与 D5b1 原工程，新增原基线漂移/SQL 故障导致目标查询数为零的测试。
- 根 `package.json`：新增 `test:published:oidc:fixture:baseline:config` 并纳入 `ready`；真实数据库只读工具仍为独立人工入口。

本轮仅是 Issue #126 的离线安全前置条件，不证明已发布 fixture 存在、快照真实 verified 或已完成在线 ACL 撤权。

## 2026-11-22 · D5b7e 目标工程完整 ACL 只读安全核验

- `scripts/inspect-published-fixture-readonly.mjs`：目标 ACL `SELECT subject_id, permission` 只按租户/工程限定，不再 SQL 先过滤指定主体或单个读取权限；`normalizePublishedFixtureTargetGrants` 检查全量权限元数据仅属于可信主体的三项基础权限或四项加唯一读取权限，拒绝重复/多余/跨主体/污染字段、孤立 ACL。保留 D5b7d 原 D5b1 基线、`READ ONLY` 事务与 `ROLLBACK`。
- `scripts/inspect-published-fixture-readonly.cases.mjs`：原 14 项集成测试扩展为 17 项定义，新增完整授权、撤权仅三项、混入额外发布权限/其他主体/重复/缺失授权和工程不存在但残留 ACL 的失败场景。

不修改原 D5b7b 分类器契约、实际权限、发布状态、Prisma Schema、生产 API 或工业设备。


## 2026-11-22 · D5b8a 发布安全门禁受控阻塞清单

- `apps/server/src/projects/project-release-safety-gate.ts`：新增 `assessProjectReleaseSafety(snapshot, context)`，对真实服务端发布输入汇总固定的上下文、Runtime、Tag 来源及工业安全未交付阻塞类别；`ProjectReleaseSafetyGate.assertReady` 已接入该检查，但仍**无条件**抛 `ProjectReleaseGateUnavailableError`，仅新增不可回传原始正文的结构化内部诊断，绝不打开发布写入。
- `apps/server/src/projects/project-release-safety-gate.spec.ts`：6 项 Vitest 负向测试定义；使用共享 Core 生成真实结构的项目快照，覆盖双框架共用 Runtime 预检与正式门禁默认拒绝、SQL 零调用、主体与工程隔离及诊断脱敏。
- 现有 `PrismaProjectReleaseStore.publish` 调用点与事务/幂等/CAS/发布事件逻辑未改；Core 与前端未变。新阻塞检查不执行 SQL 或调用工业设备，也不创建、修改或删除测试夹具。

D5b8a 的静态代码检视不等于生产门禁安全评审完成；Issue #126 继续 Open。

## 2026-11-22 · D5b7f 无工程 ID 受控只读发现

- `scripts/discover-published-fixture-readonly.mjs`：无参数的本机可信 Lab 只读发现器；先核实发布迁移、可信身份和原 D5b1 基线，再限于 `d5b7b-published-%`、独立 `release:read`、非零已发布指针及最多两条 ID 的查询。零条/多条不泄漏 ID；唯一候选通过现有完整只读审查后才显示 ID 和元数据结论。
- `scripts/discover-published-fixture-readonly.cases.mjs`：16 项 Node Mock 安全回归定义，覆盖非法参数、严格命名空间、只读事务、迁移/主体/基线、查询上限、异常回滚及第二次审查拒绝。
- 根 `package.json`：`test:published:oidc:fixture:discover:config` 仅运行离线 Mock 并加入 `ready`；`oidc:lab:published:fixture:discover` 为单独、须确认 Lab 授权才能手动运行的真实 PostgreSQL 只读入口。

本批没有修改现有业务 API、Schema、迁移、ACL、生产发布门禁、工业设备或 Vue/React 行为。

## 2026-11-22 · D5b8 正式已发布夹具准入方案（仅文档）

- `docs/adr/0070-isolated-published-fixture-safety-review.md`：**Proposed**；定义 Issue #126 真实独立已发布 Lab 夹具合法产生所需的发布安全门禁、设计/操作分层审批、真实版本/事件/HTTP 证据、单项撤权与恢复边界，以及 LF-01～LF-12 未来验收矩阵。没有可执行写入。
- `docs/RELEASE_TRANSACTION_REVIEW.md`：说明它与已批准 ADR-0069 R-01～R-08、现存固定拒绝门禁之间的关系；新增方案不改变既有正式发布事务和只读发现工具。
- `docs/PROJECT_CONTEXT.md`、`docs/VALIDATION.md`：记录 D5b7f 本机 `NOT_FOUND` 的真实证据、D5b8 Proposed 状态及未执行/未授权的边界。

生产代码 `apps/server/src/projects/project-release-safety-gate.ts` 仍为 fail-closed；没有新的 Prisma 模型、迁移、NestJS API、客户端、网关或设备写入。
