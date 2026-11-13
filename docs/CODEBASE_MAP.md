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

- `apps/server/prisma/schema.prisma`：工程、权限、版本快照和成功提交审计四个 PostgreSQL Prisma 模型。
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

- `apps/server/prisma/schema.prisma`：四个业务模型及其全部字段、关联属性的中文 `///` 文档说明。
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
- `pnpm-workspace.yaml`、`apps/server/package.json`：声明 `@nestjs/terminus@12.1.0` Catalog 和生产依赖，锁文件待维护者 Windows 正式生成。
- [ADR-0050](adr/0050-http-readiness-terminus.md)：区分 HTTP 就绪、数据库依赖和工业设备健康，解释暂缓全局限流的原因。
