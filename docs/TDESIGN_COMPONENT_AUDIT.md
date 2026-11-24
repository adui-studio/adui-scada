# ADui SCADA · TDesign 组件复用审计（D5c0s）

> 审计日期：2026-11-23。目标是停止把样式定制误当成组件复用。本文为**设计审计和迁移计划**，并不表示后续组件替换、运行验收或工业安全审查已经完成。

## 1. 现有依赖与权威依据

| 项目  | 当前固定版本               | 官方源码（与 Catalog 固定版本匹配）                                                                                                                                                                                                                                                                                                                                            |
| ----- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| React | `tdesign-react@1.18.6`     | [Dropdown](https://github.com/Tencent/tdesign-react/blob/tdesign-react%401.18.6/packages/components/dropdown/type.ts)、[Popup](https://github.com/Tencent/tdesign-react/blob/tdesign-react%401.18.6/packages/components/popup/type.ts)、[Dialog](https://github.com/Tencent/tdesign-react/blob/tdesign-react%401.18.6/packages/components/dialog/type.ts)                      |
| Vue 3 | `tdesign-vue-next@1.20.11` | [Dropdown](https://github.com/Tencent/tdesign-vue-next/blob/tdesign-vue-next%401.20.11/packages/components/dropdown/type.ts)、[Popup](https://github.com/Tencent/tdesign-vue-next/blob/tdesign-vue-next%401.20.11/packages/components/popup/type.ts)、[Dialog](https://github.com/Tencent/tdesign-vue-next/blob/tdesign-vue-next%401.20.11/packages/components/dialog/type.ts) |

版本来源为仓库根目录 [pnpm Catalog](../pnpm-workspace.yaml)，不是当前官网浮动示例。TDesign 官网入口：[React](https://tdesign.tencent.com/react/overview)、[Vue Next](https://tdesign.tencent.com/vue-next/overview)。两端 API 相似但不可假定完全相同；任何交互迁移都要分别检查当前版本的类型、示例及源码。

本次已核对官方对应版本的 `Dropdown`、`Popup`、`Dialog`、`Drawer`、`Collapse`、`Upload`、`Select`、`Tabs`、`Tree`、`Table`、`Pagination`、`Popconfirm`、`Tooltip` 的类型定义。**没有声称逐个运行或穷尽阅读整个 TDesign 组件库**。当前连接工具未提供仓库 TDesign Skill 所要求的 `tdesign-mcp-server` 组件查询，因此正式代码迁移前仍须恢复该能力或取得项目许可使用当前已核对的官方版本类型/源码作直接校验；不能凭记忆猜 props。

## 2. 已存在、应优先复用的组件能力

| 用途                     | TDesign 候选            | 已核验 API/边界                                                                                                                        |
| ------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 简单动作下拉菜单         | `Dropdown`              | `options`、`trigger='click'`、`placement`、`disabled`、`hideAfterItemClick`、`onClick`；React/Vue 都存在，回调须按**各自版本**类型处理 |
| 含表单、列表等复杂浮层   | `Popup`                 | `visible`、`onVisibleChange`、`trigger`、`placement`、`attach`、`destroyOnClose`、`overlayInnerClassName`；应让组件处理定位及外部关闭  |
| 高风险确认或需聚焦的对话 | `Dialog` / `Popconfirm` | `visible`、确认/取消回调、Esc/遮罩关闭配置；工程删除、草稿覆盖等业务二次确认逻辑仍属于项目                                             |
| 繁多内容的侧面板         | `Drawer`                | 有显示状态、遮罩/ESC 关闭选项；适合服务端工程详情或长列表，是否替换必须先看操作流程                                                    |
| 属性侧栏的展开区块       | `Collapse`              | `value/defaultValue`、`CollapsePanel`、`disabled`；替代手工 `details`，但不可把普通块变成模态浮层                                      |
| JSON 文件选择            | `Upload`                | `accept`、`autoUpload`、`onSelectChange` 已在两个当前版本核实；必须关闭自动上传，保持当前本地文件大小、Schema、权限及回滚校验          |
| 工程选择/页面切换        | `Select` / `Tabs`       | 单/多选及当前值/变化回调；迁移时验证页面数量上限、溢出、切换命令及视图状态                                                             |
| 图层树                   | `Tree`                  | 存在 `data`、`expanded`、`onClick` 等接口；现有 SVG 选择、拖拽、组合/命中行为复杂，**不能直接替换并假定等价**                          |
| 授权工程列表             | `Table` / `Pagination`  | 支持列、数据、分页；需先确认服务端游标/页码契约，不能伪造总页数或绕过 ACL                                                              |
| 简短状态说明/禁用解释    | `Tooltip`               | React/Vue 都有，不能只靠颜色提示设备质量                                                                                               |

## 3. D5c0s 审计时的双框架重复实现盘点

D5c0s 审计基线：`StudioPage.tsx` 与 `StudioPage.vue` 每端各有 **9 处**原生 `details/summary`，`ServerProjectBrowser` 每端另有 **1 处**，合计 **20 处**。D5c0t 分支已将每端的「页面管理」入口各迁移 1 处，因此候选代码中每端还剩 **9 处**（Studio 8 + 工程管理 1），双端共 **18 处**；这个计数不代表所有入口都该使用 Dropdown。

| 现有入口（React/Vue 同构）       | 目标组件候选                            | 风险、需要保留的语义                                                                                 |
| -------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 页面管理（6 个命令）             | **优先试点：Dropdown**                  | 禁用项：页数达 100、第一页/最后一页、仅一页禁止删除；菜单项点击后调用现有命令，不重写业务逻辑        |
| 文件与草稿                       | Popup + Upload，简单动作可评估 Dropdown | 导入是本地 `File` 而非网络上传；现有互通/自动保存浏览器用例直接查找 `.studio-file-menu` 的 `details` |
| 本地版本历史                     | **Popup**，长列表再评估 Drawer          | 打开时 `refreshVersionHistory`、创建快照、查看差异、载入/分页及 CAS、失败状态必须保留                |
| 发布预检                         | Popup 或 Drawer                         | 内含服务端发布前只读预检，必须保留当前工程与未保存版本区别、HTTP 401/409/404 拒绝边界                |
| 服务端工程版本                   | Popup 或 Drawer                         | 登录/ACL、当前 head、版本保存/对比、冲突只读流程和禁止过期结果覆盖                                   |
| 工程管理（ServerProjectBrowser） | Popup，必要时配 Pagination              | 原有 `onToggle` 发起刷新；不能绕过工程授权或引入自动写操作                                           |
| 跨页操作与使用帮助               | Popup                                   | 涉及跨页面图元复制，保留无效目标及命令禁用策略                                                       |
| 视图设置                         | Popup + Checkbox/Switch                 | 网格、吸附、左右侧栏折叠；现有浏览器测试直接设置 `details.open`，迁移时同步重做**真实点击路径**      |
| 项目 Tag 定义                    | **Collapse**                            | 属于侧栏**行内折叠**，不是浮层；Tag 管理与绑定删除保护必须独立保留                                   |
| 高级图元与图层操作               | **Collapse**                            | 行内折叠；保持几何变换、旋转、层级命令和 SVG 画布指针行为                                            |

此外，需按模块审查项目中的原生 `button`、`window.confirm/prompt`、表单与手写弹层。不能简单统计元素数量就全部替换，必须保持工业组态编辑器对精度、交互延迟及受控操作的契约。

## 4. 为什么前一阶段的做法需要纠正

最近几批着重将旧 CSS 替换成 `@adui/theme` 等值 Token，但 **CSS 变量不负责浮层定位、键盘操作、外部点击关闭、焦点回收或菜单禁用语义**。对已有 Dropdown/Popup 能解决的行为，继续维护 `details/summary + position:absolute + z-index` 只会留下重复实现。应停止把纯视觉 Token 迁移当作这类 UI 的主要进度。

迁移不可以直接删旧 CSS 而不修浏览器测试：`scripts/test-studio-browser.mjs` 的导入/导出、发布预检、网格/侧栏设置等用例直接修改 `details.open` 或按 `summary` 查找；更换 TDesign 后这些测试必须通过真实触发器点击、ARIA/可见状态及对应 DOM 检查，**不能删除既有业务断言来消除失败**。还有其他 OIDC/版本浏览器脚本可能存在同样依赖，必须先逐项检索。

## 5. 最小迁移次序与门禁

1. **D5c0t：页面管理试点**。分别采用对应 TDesign 版本的 Dropdown + Button，保留原六条命令及禁用逻辑；新增两端真实浏览器菜单可见/隐藏、点击触发、禁用项、Esc/外部点击和页面状态测试。移除这一入口不再使用的 CSS，不改其他菜单。
2. **D5c0u：文件与草稿**。优先 Popup 管控浮层和焦点；本地文件选择按 TDesign Upload 的 `autoUpload=false` 机制核对行为，保留用户触发的本地 JSON 验证及全部浏览器互通测试。
3. **D5c0v：本地版本历史及工程管理**。使用 Popup/Drawer 承载动态内容，页面打开/关闭、数据刷新、权限和迟到响应仍由现有业务控制器管理；需同步修复 OIDC 与版本脚本的入口定位。
4. **后续**：视图设置 Popup、属性面板 Collapse、确认 Dialog/Popconfirm，再审查其他表格/图层树。对复杂图层 DnD 不做凭组件名称的盲迁移。

每批先核对 **固定 Catalog 版本** 的当前组件 props、事件和样例，再改 React/Vue 的同一功能，最后清理旧 CSS 并执行受影响的类型检查、Vite+ 与真实浏览器专项。首批先做菜单行为验证，不重复跑无关工业网关/数据库测试；合并前保留 Draft 和 `@adui-dev` 指派。Studio 252px/320px 固定侧栏、16:9 画布、不可用质量显示、工程 Schema 和任何设备写入安全边界均不得改变。

## 6. 尚未完成与依赖

- 尚无本次迁移后的 Windows `vp check`、`typecheck:web`、React/Vue 浏览器焦点/键盘测试；当前只是版本匹配的官方源码阅读与本项目代码盘点。
- 尚未通过项目要求的 `tdesign-mcp-server get-component-docs` 查询精确 API，因为当前连接中没有该服务；若继续执行源代码迁移，需先解决查询能力，或者经维护者明确接受以两个**固定 tag** 的 TypeScript 类型与官方示例为替代验收依据。
- 本文不申请改变工业业务操作，也不要求安装其他组件库、改变依赖或修改 Lockfile。

## 7. D5c0t · 页面管理 Dropdown 迁移候选（待 Windows 验收）

- **React / Vue 对等实现**：仅将 `StudioPage.tsx` 和 `StudioPage.vue` 的「页面管理」原生 `details/summary` 替换为官方 `Dropdown` + `Button`。当前 Catalog 使用 React **1.18.6**、Vue Next **1.20.11**，按各自对应 Git tag 的 `dropdown/type.ts`、`Dropdown/DropdownMenu/DropdownItem`（React）与 `dropdown/dropdown-menu/dropdown-item`（Vue）核对 API 和实际禁用点击处理。两端均采用 `trigger='click'`、`placement='bottom-right'`、`options` 和 `onClick`；未引入其他组件库。
- **六条命令**：新建页面、复制页面、页面前移、页面后移、重命名、删除当前页均调用原有编辑器方法。达到 100 页禁用新建和复制；第一页禁用前移；末页禁用后移；仅一页禁用删除。原有 `window.prompt`/`window.confirm` 仅作为既有业务流程保留，后续应独立评估 Dialog/Popconfirm，当前批不擅自改变数据覆盖确认。
- **旧 CSS 清理**：删除 `.studio-page-menu > summary` 和 `.studio-page-actions` 的手工背景、绝对定位、宽度、栅格及 hover 规则。保留 `.studio-page-menu` 布局容器；新菜单的定位、挂载和关闭交由 TDesign Popup 内部实现。
- **浏览器验收**：在 `scripts/test-studio-browser.mjs` 正常 Studio 双框架双分辨率测试中新增 8 个真实菜单检查（触发器、选项齐全、禁用条件、创建、关闭、禁用阻止、外部关闭、键盘聚焦），原 19 项几何/图层/画布断言全部保留，**目标每组 27 项，四组共 108 项**。确认禁用项 `t-dropdown__item--disabled` 与对应版本源码一致。菜单的 Esc 行为需要 Windows 手工检查，未据此声称已支持完整键盘导航。
- **验收状态**：本提交仅完成 GitHub 代码变更与静态核对，尚未运行 Windows `vp check`、Web 类型检查或真实浏览器。项目指定的 `tdesign-mcp-server` 当前不可用，本次是对固定官方 tag 类型与组件实现的直接校验，不能等同 MCP 查询成功。

## 8. D5c0u · 文件与草稿 TDesign Popup 迁移候选

- React 与 Vue Studio 各将一处 `details/summary` 文件菜单替换为固定版本 `Popup + Button`，使用官方 `trigger='click'`、`placement='bottom-right'`、`attach='.studio-file-menu'` 和 Vue 的 `#content` 插槽 / React 的 `content` 属性。挂载在已有菜单容器内以保留现有只读 DOM 查询契约；可见性、浮层定位与点击外部关闭由 TDesign 负责，不保留手工绝对定位。
- 五项既有功能保持：自动保存开关、导入 JSON、导出 JSON、恢复草稿、清除草稿。特别保留 `<input type='file' accept='.json,application/json'>` 的本地文件事件与原有 2 MiB 大小限制、工程 Schema 校验、加载失败保护、异步互斥、IndexedDB 修订号 CAS 和危险操作原生确认。**此批没有引入网络 Upload，也未修改业务或历史版本载入。**
- 本次优先替换 Popup 容器，原生 File input 与 CRUD 按钮暂不更换；后续使用 TDesign `Upload` 时，必须另外验证 `autoUpload=false`、本地文件尺寸、异步防并发和合法/非法工程往返。不得为了组件一致性改变业务验证顺序或擅自上传工程文件。
- `scripts/test-studio-browser.mjs` 的原始用例以前设置 `details.open`。当前已将文件/草稿相关操作改为点击 TDesign 触发器、等待实际可见面板、完成动作并关闭；版本历史并发用例仍要检查旧逻辑被正确拒绝。独立浏览器 Studio 每视口新增 3 项 Popup 断言，目标从 27 项增加到 30 项，React/Vue 四组目标合计 **120 项**；其他导入导出、旧草稿迁移、版本安全与多标签页集成测试必须另行验收。
- **验证状态**：仅完成 GitHub 分支源码及固定 TDesign React `1.18.6` / Vue Next `1.20.11` 的 `popup/type.ts`、组件事件与挂载定义核对。尚未实跑 Windows `typecheck:web`、`vp check`、浏览器或真实文件导入；不得将静态匹配表述为正式测试通过。

## 9. D5c0v · 本地版本历史 Popup 双框架迁移候选

- **实际范围**：仅将 React/Vue Studio 工具栏「版本历史」1 处/框架的原生 `details/summary` 更换为当前 Catalog 版本 `tdesign-react@1.18.6`、`tdesign-vue-next@1.20.11` 的 `Popup + Button`。按各版本官方 `popup/type.ts` 核对 `attach`、`trigger`、`placement` 和 `onVisibleChange`；Vue 使用 `#content`，React 使用 `content` JSX。新的唯一挂载选择器为 `.studio-local-history-menu`，不会误挂到同样使用 `.studio-version-menu` 的发布预检和服务端历史。
- **保留业务**：打开面板时触发原 `refreshVersionHistory()`；创建快照、刷新、查询分页、版本差异、取消/确认载入、CAS/自动保存暂停、历史 SHA-256/原记录保留和 IndexedDB 错误处理的生产函数没有改变。面板采用 Popup 负责定位及点击外部关闭，共享 CSS 仅增加对本地面板的 `position: static`，其余两个旧版历史菜单仍使用原 CSS；未动发布预检、OIDC 权限或服务端发布读写。
- **真实浏览器门禁**：将 `test-studio-browser.mjs` 中针对本地历史的 `menu.open` 修改为真实 Popup 触发器。保持历史库异常、旧 0.2.0 快照、差异/取消/载入/分页和导入期间历史覆盖保护的所有原有断言。新增 3 项普通 Studio Popup 回归，目标每视口 **33 项**，四组 **132 项**；版本历史专项、版本安全、旧版草稿和发布预检还须单独复验。
- **当前仅是 GitHub 候选**：所有 Windows `typecheck:web`、`vp check`、`docs:check`、`test:browser`、`test:versions`、`test:versions:safety`、`test:legacy:browser` 与 `test:release:preflight:browser` 均待维护者在最终 HEAD 执行，不把早期测试结果冒充本批通过。当前工具没有仓库要求的 `tdesign-mcp-server`，已核对两个安装版本官方源码与 Props，但不能称为 MCP 查询完成。

## 10. D5c0w · 双框架通用 UI 控件全量 TDesign 迁移候选

本批按照维护者「**同一 PR 完成所有通用控件替换，完成后统一验收**」的要求执行。基础分支为 PR #187 已授权并合并后的 main，不继续拆分小型弹层 PR。**以下为候选源码范围，不是 Windows 运行通过的结论。**

| 类型                                       | React                                   | Vue 3                          | 保留的业务边界                                       |
| ------------------------------------------ | --------------------------------------- | ------------------------------ | ---------------------------------------------------- |
| 普通动作及危险操作按钮                     | `Button`（原生按钮显式 `tag="button"`） | `TButton`                      | 原禁用态、提交类型、事件和权限判断                   |
| 文件、历史、发布预检、服务端工程、视图设置 | `Popup`                                 | `TPopup`                       | 打开刷新、CAS、历史 SHA-256、只读发布预检            |
| 工程管理                                   | `Popup`                                 | `TPopup`                       | 仅在展开时请求授权列表及分页                         |
| 侧栏跨页操作、Tag、高级图层工具            | `Collapse.Panel`                        | `TCollapsePanel`               | 原编辑命令、拖拽/图层状态                            |
| Tag 数据类型、绑定、跨页复制及图层插入目标 | `Select`                                | `TSelect`                      | 共享 Tag ID、Schema、类型约束                        |
| 网格与吸附                                 | `Checkbox`                              | `TCheckbox`                    | 原布尔配置和画布渲染                                 |
| Tag 描述                                   | `Textarea`                              | `TTextarea`                    | 原 512 字符上限                                      |
| 已发布工程 ID/页面、属性几何与常规输入     | `Input`/`Select`                        | `TInput`/`TSelect`             | 输入验证、只读渲染和实际画布几何                     |
| 本地 JSON 导入                             | `Upload`，`autoUpload=false`            | `TUpload`，`auto-upload=false` | 仅在本机读取；原 2 MiB、JSON/Schema 校验及导入互斥   |
| 页重命名、删除、草稿覆盖、历史与服务端载入 | `DialogPlugin` + `Input`                | `DialogPlugin` + `TInput`      | Esc/关闭/取消不执行，确认后沿用原 CAS 和自动保存暂停 |

**自有 UI 与第三方控件的边界**：14 个 React/Vue 入口和页面候选源码中不再保留原生 `button/input/select/textarea/details/summary` 交互标签及 `window.confirm/prompt`；React/Vue 分别通过对应固定版本的 TDesign API 实现。HTML `form`、`label`、语义表格及结构容器不是需要替换的组件。SVG 图元、图层树拖拽命中层、框选、旋转、缩放、网格和 16:9 画布属于工业组态专用交互，继续使用仓库自研 Core/Runtime/Editor 实现；未经功能对等证明不把它们改为通用 TDesign Tree/Canvas 的行为替代品。

**测试同步**：更新 `test-studio-browser.mjs` 中原生菜单、Tag 表单、真实 TDesign Dialog 操作及 JSON 导入竞争辅助函数；更新 OIDC 工程管理、发布预检、多标签页及其 Node 模拟单测，仍保留原有无授权拒绝、版本漂移、CAS、IndexedDB 草稿与旧版迁移断言。浏览器必须通过真实 DOM 触发，而不是绕过用户确认。审计仍须核对 Popup 键盘焦点/外部关闭、Dialog Esc/取消、长列表和 1024px 视口。

**源码检查边界**：已按 `tdesign-react@1.18.6`、`tdesign-vue-next@1.20.11` 固定官方 Git tag 类型/实现确认 Button、Popup、Collapse、Input/Select/Upload、Dialog 的 API；React 的折叠面板使用官方 `Collapse.Panel`，Vue 使用 `TCollapsePanel`。未新增组件库、锁文件或工业接口。本批 GitHub 代码仅进行了静态检索和 Node 脚本源码解析（不执行测试）；真实 Windows `vp check`、TypeScript/Vue 类型检查、单元和浏览器安全回归 **尚未执行，不得标记为通过**。

## 11. D5c1 · Tag 目录与表单任务分离及 FUXA 参考

维护者要求停止在 320px 右侧属性栏内常驻五字段 Tag 表单，并提供 FUXA 的公开项目作为参考。参考其 Editor 和 Connections 的任务组织方式，而不复制第三方实现。当前 ADui SCADA 项目 Tag 仍是工程元数据定义，并非实际 PLC 设备 Tag 采集或写入面板。

React/Vue 对等采用官方 TDesign Button、Input、Select、Textarea 与 Dialog/TDialog。已核对固定版本 React 1.18.6、Vue Next 1.20.11 的 Dialog visible、width、dialogClassName、footer、destroyOnClose、closeOnEscKeydown、closeOnOverlayClick 和 onClose API。目录常驻侧栏，支持搜索、紧凑行和新建入口；编辑表单在独立 Dialog 内以两列排布，错误就近提示，编辑时稳定 ID 不可变。危险删除仍调用原 confirmStudioAction，并由共享 Editor 拒绝已绑定 Tag。

浏览器测试覆盖真实按钮流程、目录搜索、弹窗所在位置和宽度、主表单两列、字段错误、不可变 ID、长 ID 与 Tab 焦点，保留原工程 CRUD 和 JSON 往返断言。尚未执行新 HEAD 的 Windows vp check/类型检查/真实浏览器，不能宣称已经完成验收。

## 12. D5c1 · 明暗主题 Switch 与按钮内容对齐

固定版本 React 1.18.6 与 Vue Next 1.20.11 Switch 支持 value、label、change，React 根节点是 role=switch 的原生 button，Vue 根节点为 div，故 Vue 补充 role、tabindex、aria-checked 和键盘操作。沿用既有主题持久化，不自行绘制开关，不添加依赖。导航和底部工具继续使用 TDesign Button 与官方图标，仅统一内部内容对齐。实际双端浏览器验收待执行。

## 13. D5c1 · 官网主题切换动效

对照 Tencent/tdesign 官网 td-theme-tabs 源码，而非假定 Switch 自带整页动效。业务仍使用固定版本 TDesign Switch，双图标来自现有图标包，整页过渡由原生 View Transition API 处理；减少动态效果及不支持该 API 时直接切换。未引入动画库。双框架实际视觉验收待执行。
