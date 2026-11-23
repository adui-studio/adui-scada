# ADui SCADA · 工业 Web 界面设计基线（D5c0l）

> 范围：React/Vue 应用导航、模拟运行监控、正式发布只读预览及 SVG Studio 工作台。本文件记录 **UI 候选实现**，不是新的工业协议或安全审批。

## 设计目标与依据

- **定位**：面向工程师、工艺监控人员和项目维护者的正式工业软件，不以消费级营销大屏、炫技动效或游戏化卡片作为默认视觉语言。
- **参考规范**：仓库 `ui-ux-pro-max` 的可访问性、信息密度、交互和响应式规则；`web-design-guidelines` 的语义控件、焦点、空状态、键盘路径和无障碍审查；`tdesign-skills` 的跨框架识别、当前组件优先和不猜测 API 原则。
- **现有实现**：Vue 3 使用 `tdesign-vue-next`，React 使用 `tdesign-react`；两套 Studio 既有 TDesign `Button/Input` 保持不变。当前协作环境没有 `tdesign-mcp-server`，本批不引入未经查询的组件 props、事件或新组件，只重用现有能力和项目自有布局类。
- **品牌与主题**：保留现有 Logo、品牌资源、`packages/runtime/src/theme.css` 的工业深色语义 Token；不猜测修改 V7 Logo SVG 路径，不更换第三方组件库，不新增外链字体或图标资源。

## 信息架构

| 页面       | 主要区域                                                              | 阅读和操作顺序                            | 关键约束                                               |
| ---------- | --------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| 应用导航   | 产品识别、运行监控、已发布运行、组态编辑、研发模式说明                | 自左至右，当前页面可识别                  | 导航不暗示连接现场设备                                 |
| 模拟监控   | 状态/连接诊断、Tag 质量、工艺 SVG、Tag 实时值、状态变化               | 首先标明模拟和数据质量，再阅读工艺画面    | 5→7 的序列变化不意味着数据完整                         |
| 已发布运行 | 工程选择/受控读取、发布代次摘要、静态 SVG 预览                        | 先确认受保护工程，再只读预览              | 静态发布快照不等于现场实时 Tag                         |
| Studio     | 主工具栏、工程页面标签、固定图元侧栏、16:9 编辑画布、属性侧栏、状态栏 | 常用撤销/草稿优先，高风险操作保持已有流程 | 不改工程 Schema、SVG viewBox、命令、画布比例和外层滚动 |

## 视觉基线

1. **专业层级**：统一 64px 应用顶栏、标题/状态分区、10px 面板圆角、12–16px 控件间距；不滥用彩虹渐变、强发光和大面积图标。
2. **语义颜色**：主操作继续使用现有 `--scada-primary`；实时、告警、过期等显示使用已有 live/warning/danger Token；文字始终同时提供状态文本，不仅凭颜色区分。
3. **工业数据**：Tag 数值、序列、代次使用等宽数字；长 Tag ID 和服务端信息允许换行，不截断关键错误。显示当前质量及模拟/只读边界。
4. **响应式**：宽屏运行监控使用工艺 SVG + Tag 指标并列、发布页工程选择与发布状态并列；较窄屏幕改为单列。Studio 桌面工作区保留左侧栏 **252px**、右侧栏 **320px**，中央画布占据剩余宽度；小屏继续使用既有工作区折叠/纵向处理。
5. **可访问性**：加入“跳转到主要内容”入口和 `tabindex=-1` 目标、可见焦点；状态文本保留 `role=status/alert`；无 Tag 显示文字空状态；保留所有原生按钮/标签的键盘事件和禁用语义。
6. **动效**：仅应用轻微背景/边框/文字色交互过渡，尊重 `prefers-reduced-motion`；不在 SVG 画布上增加滚动视差或装饰循环。
7. **双框架对等**：页面类名、字段名称、导航语义、文案、布局断点在 React/Vue 对齐；CSS 主规则只维护在共享 `@adui/scada-runtime/styles.css` 与 `@adui/tailwind/studio.css`，不复制新样式到两个应用包。

## TDesign 组件复用约束

- **优先使用现成组件**：按钮、表单控件、标签页、导航、卡片、描述列表、表格、树、弹窗、消息提示等先查对应技术栈的 TDesign 能力；已满足需求时直接使用官方组件，不新建同职责的自定义组件或样式套壳。
- **先查再写**：先读仓库已有 React/Vue 使用代码，再按 `tdesign-skills` 路由到相应专项资料，通过 `tdesign-mcp-server` 确认组件存在与具体 API；工具不可用时不臆造 props、事件或插槽，本批不开展无法验证的新组件迁移。
- **职责划分**：TDesign 负责控件、交互和自身设计变量，Tailwind v4 负责工作区布局、间距和响应式；自定义 CSS 只保留工业 SVG 画布、图元手柄和官方组件无法表达的特有结构，不重复维护两个框架的等价样式。
- **回归契约**：`scripts/test-studio-browser.mjs` 已要求 Studio 左侧栏固定 **252px**、右侧栏固定 **320px**，中央画布等于剩余宽度；视觉升级不得修改这些计算，也不得为美化而调整测试预期。
- **现存债务**：原应用中仍有原生 `button/input/select/details` 等控件；它们不是本批新增的封装。后续按实际可用的官方 API 分批迁移，不通过新增自制控件过渡，不以推测替换高风险的文件、草稿与发布交互。

## 通用能力与依赖复用规则

- **先查已有能力，再决定依赖**：先搜索仓库包和共享 API，使用已有实现或成熟库处理通用日期、校验、解析、缓存、请求与状态管理；不为了包装而包装，不新增与 TDesign/现有库等价的工具。
- **Zod**：根 Catalog 已声明 `zod@4.6.7`，后端的 Standard Schema 校验已使用它。新增结构化输入校验时先检查是否能复用已有 Schema；前端包如果确实需要直接使用 Zod，须声明消费端依赖、通过 pnpm 生成真实锁文件并完成跨端验证。不能因为 Catalog 已有就假定前端可以直接导入。
- **日期时间**：目前两个运行页面复用 Runtime 的 `formatRuntimeUpdateTime` / `formatRuntimeDataAge`；根 Catalog 未声明 Day.js。简单既有显示继续使用共享格式化入口，只有出现真正的跨时区、时长或日历计算需求，才评估引入 Day.js，且不得用显示格式化工具修改报警服务器时间的毫秒精度与来源信任语义。
- **TDesign**：现有 Button、Input、Select 等直接使用官方组件和版本 API；只有工业专用的 SVG 画布、命中层、实时工艺布局等组件库不提供的领域能力才自行实现。通用界面不重复封装官方控件。
- **依赖流程**：任何新增第三方库先核对许可证、体积、维护状态、已有 Catalog 和消费者，再按仓库 `pnpm` 规范更新工作区清单及锁文件，执行 `deps:check`、类型检查与双框架回归。没有明确收益时不新增依赖。

## D5c0m · 运行页实际截图反馈与布局修正

- **监控页**：现有截图中诊断独占首屏上半区，SVG 工艺流程被推到下方。宽屏（不小于 1200px）改为**左侧工艺画面、右侧链路诊断及 Tag**，顶部仍保留状态/错误说明。质量概览和最近状态变化沿用已有字段，不引入虚构 KPI。
- **已发布运行**：未读取有效发布快照时，既有空态只占很窄的一行，下方有大量无用途留白。共享发布预览卡片设置合理的最小高度、边界和居中空状态；仍只在 `verified` 且有受信快照时显示 SVG，绝不以模拟图代替正式发布。
- **宽度**：运行与发布页不再受共享外层 1600px 固定最大宽度限制，随视口宽度扩展；较小屏幕保持原单列。Studio 的 252px/320px 固定侧栏、16:9 画布与独立滚动**完全不变**。
- **技术与测试**：本批只改共享 `packages/runtime/src/runtime.css`、React/Vue 运行页的同一段静态展示顺序和文档。两端把工艺画面提前到诊断之前，避免窄屏 DOM 阅读顺序与视觉顺序不一致；不重新封装 UI 组件、不引入 Day.js 或新的 CSS 工具，也不修改 Zod、API、运行时订阅、发布鉴权和工业安全判断。CSS 静态检查不能代替真实浏览器截图验收。

## 本批实际修改

- `packages/runtime/src/runtime.css`：共享应用导航、Status、诊断/Tag 卡片、发布表单、桌面双列与移动单列布局。
- `packages/tailwind/src/studio.css`：共用 Studio 操作区、画布顶栏、图层选中态、左右侧栏、状态栏和焦点规范。
- `apps/web-react/src/App.tsx` / `apps/web-vue/src/App.vue`：跳转主内容入口、明确“研发预览 · 非现场控制”模式。
- 两端 `RuntimePage` / `PublishedRuntimePage`：添加页面语义类、工艺区域标题、Tag 空状态、工程表单名称及可聚焦主区域。
- 两端 `StudioPage`：只更新工作台说明与主内容焦点，不触碰编辑命令、草稿、版本、图元或事件处理。

## Windows / 浏览器验收要求（D5c0l 待执行）

- 基本质量：`pnpm run messages:check`、`vp check`、`pnpm run docs:check`、`pnpm run ready`，所有检查成功才算静态与构建门禁完成。
- 实际布局：在 Chrome/Edge Windows 实测 **1440×900、1024×768**，分别进入 React 和 Vue 的模拟监控、已发布运行、Studio；检查水平溢出、焦点遮挡、侧栏滚动和中央画布比例。
- 键盘：按 Tab 访问“跳转到主要内容”，Enter 后焦点到当前主区域；导航、工具栏、页面标签和可见弹层须有焦点状态。
- 运行安全：模拟运行显示状态与质量、离线不显示伪 GOOD；发布页在无授权/无发布/断线时仍显示只读拒绝及空画面；两端 Studio 的 JSON 导入导出、草稿和视图操作不回归。
- 浏览器专项：按仓库现有环境执行 `pnpm run test:browser`、`pnpm run test:tags:browser`、`pnpm run test:interop`；后续正式已发布真实 OIDC 浏览器专项仍按既有人工安全约束，不因 UI 改造自动触发。

**验收边界**：本批当前仅 GitHub 代码静态核对，尚未执行 Windows Web 构建、完整 `ready` 或真实浏览器视觉验收。不能把 PR #176 的历史检查当成本分支质量证明。正式工业网关、报警事件与设备写入不在本批范围。

## D5c0n · 已发布运行控件与空画面语义

- **TDesign 官方控件直接复用**：正式发布只读页面的“读取正式发布 / 立即刷新 / 停止读取”使用 React `tdesign-react/Button` 和 Vue `tdesign-vue-next/Button`，沿用 Studio 中已经存在并验证过的 `type="submit"`、`type="button"`、`variant="outline/text"` 及 `disabled` 写法。不新增 Button 包装组件、额外依赖或一套表单状态机。
- **保留浏览器安全契约**：工程 ID 输入保留原生 `input`、原 `id`/`name` 和受控更新；多页面 `select`、`data-testid`、同源只读 GET、身份/CAS/权限检查、停止读取时清空画面均不变。两个控件的官方迁移以确认对应 TDesign API 和真实 CDP 输入兼容性为前提，不为追求组件覆盖率破坏已发布安全验收。
- **七种状态空态共用文案**：新增 `PUBLISHED_RUNTIME_EMPTY_HINTS` 与 `PUBLISHED_RUNTIME_STATUS_LABELS` 一一对应，分别提示未启动、读取中、尚未发布、已验证但不可展示、离线、拒绝、错误。React/Vue 直接渲染同一共享文案，不将静态快照误称为 GOOD 实时数据。
- **视觉与回归**：空态提升至 14px 便于工业桌面阅读，保留预览区域的清晰边界；TDesign 组件仍需 Windows 双框架手工与自动浏览器专项复验。没有新引入 Zod、Day.js 等工具，因为本批不涉及新的通用校验或复杂日期逻辑。

## D5c0o · @adui/theme 全局设计 Token 第一阶段

- **唯一来源**：`packages/theme` 的 `@adui/theme/styles.css` 组合 `tokens.css` 与 `tdesign.css`。Vue/React 继续通过共享 `@adui/scada-runtime/styles.css` 加载；`packages/runtime/src/theme.css` 只保留兼容导入，不再定义自己的颜色。
- **配色**：品牌 `#0D63F3`、科技青 `#00C8FF`、正常状态 `#00D9A6`、警告 `#F0AE4D`、错误和过期 `#F16C75`；页面背景 `#0B1320`、面板 `#132236`、画布 `#0C1728`。所有 `--scada-*` 与 V7 `--adui-scada-*` 均以别名保留；不能用品牌蓝替换工业报警语义色。
- **字号**：`--adui-font-size-2xs/xs/sm/md/lg/xl/2xl/3xl` 分别为 **11/12/13/14/16/18/24/28px**，正文默认 14px/1.5；中文系统字体优先，数值仍用现有等宽数字规则，不加载外链字体。
- **间距**：`--adui-space-0…9` 为 **0/2/4/6/8/12/16/20/24/32px**；圆角 `--adui-radius-sm/md/lg/panel` 为 **4/6/8/10px**，控件高度为 **28/32/36px**。Tailwind v4 通过共享 `@theme inline` 引用基础字体、4px 间距、圆角刻度；不修改 Preflight。
- **TDesign**：两个 `index.html` 使用 `theme-mode="dark"`，官方 CSS Variables 在 `packages/theme/src/tdesign.css` 统一映射交互色、背景、文字、禁用态、字体及尺寸。采用更具体的 `html:root[theme-mode="dark"]` 以覆盖懒加载的组件默认主题，而非额外重绘 `Button/Input`。官方机制依据：[TDesign Web 主题说明](https://github.com/Tencent/tdesign-common/blob/develop/docs/web/theme.md) 与 [React 自定义主题](https://tdesign.tencent.com/react/custom-theme)。
- **迁移边界**：本批只替换旧主题入口、两端重复的 TDesign 变量和基础排版/Tailwind Token 映射。Runtime/Studio 中尚存单次写入的像素值，后续逐批替换，**不声称已完成所有历史 CSS 迁移**。Studio 252px/320px 固定侧栏、画布 16:9、报警质量、数据读取与只读权限保持原样。
- **安装前置**：新增 `@adui/scada-runtime -> @adui/theme` 的 `workspace:*` 依赖；须使用项目 pnpm 12.18.0 **实际生成并提交** `pnpm-lock.yaml` 的工作区 importer 变更，不允许手工猜测锁文件。验证前先重新安装，再运行 `ready`、双端浏览器与 TDesign 禁用/焦点/对比度检查。

## D5c0p · 共享字号与间距的等值迁移

- **策略**：在已经合并的 `@adui/theme` 基础上逐批替换历史散落的字号、间距与圆角；第一组仅针对共享 Runtime 的导航、状态提示、诊断卡片、正式发布空态，以及共享 Studio 的导航/工程列表等低风险视觉元素。
- **等值原则**：本组将 19 处 Runtime 与 11 处 Studio 的原字面值改为已有 `--adui-font-size-*`、`--adui-space-*`、`--adui-radius-*`、`--adui-line-height-normal` 或 `--adui-font-weight-semibold` 引用，**不修改计算后的 px、行高、字重、圆角**。例如 `12px → var(--adui-font-size-xs)`、`13px → var(--adui-font-size-sm)`、`6px → var(--adui-space-3)`、`24px → var(--adui-space-8)`。
- **保持原样**：浏览器缩放与响应式边界、Studio 固定侧栏 252/320px、16:9 SVG、图层命中层与指针坐标、TDesign API/组件状态、Tag/报警质量及发布只读权限都不变。特殊尺寸（如 15/17/19px 或 34/38px 控件高度）未强行映射到不同档位，以免视觉漂移。
- **验证**：主题静态测试新增导航与诊断/发布空态 Token 引用、Studio 工程列表及固定侧栏的断言。静态差异复核已确认两份共享 CSS 只有 30 行属性值替换，所有 Token 展开后与原声明相同；但真实 Vite+、React/Vue 构建与 Windows 视觉回归尚待执行。

## D5c0q · 属性面板密度与控件交互状态收敛

- **属性面板密度**：在共享 `studio.css` 内把属性说明的 12px、面板标题下间距及几何表单的 12px、分组标题 8px、工具组 6px、折叠区域圆角 6px 映射到已有 `@adui/theme` Token。只更换数值来源，保留实际像素值、表单结构、SVG 画布与 252px/320px 固定侧栏。
- **禁用态**：仅让 Studio 保存草稿强调按钮、图元添加按钮和页面标签的本地 hover 强调规则对 `:not(:disabled)` 生效，避免未来禁用时仍出现可操作的 hover 提示；原生 `disabled`、TDesign `Button/Input` 官方状态处理和鼠标事件全部保留。
- **焦点与可访问性**：既有 `:focus-visible` 边框不变；TDesign 的 `--td-brand-color-focus`、`--td-brand-color-disabled`、`--td-text-color-disabled` 和禁用组件背景继续从共享主题取值。本批不覆盖 TDesign 组件内部选择器，也不自行实现同职责控件。
- **验收边界**：新增两项静态回归，检查等值 Token、禁用 hover 守卫及 TDesign 焦点/禁用变量。实际 `vp check`、Vitest、React/Vue 两端 1440×900 和 1024×768 浏览器视觉、键盘焦点和禁用态仍须 Windows 执行。

## D5c0r · 历史版本弹层共享排版 Token

- **范围**：共享 Studio 历史版本弹层的提示/错误文本、版本工具栏、列表、时间戳和比较摘要；React/Vue 自动共用，不另建适配组件。
- **等值原则**：12 条 CSS 声明将 6/8/12px 间距、11/12px 字号及 1.5 行高映射到现有 `--adui-space-3/4/5`、`--adui-font-size-2xs/xs`、`--adui-line-height-normal`，计算值保持不变。7/9/10px 等无匹配 Token 的特殊值保留。
- **不变项**：弹层宽度 `min(378px, calc(100vw - 24px))`、最大高度 `min(70vh, 610px)`、Studio 252px/320px 侧栏、16:9 SVG、版本保存/载入/回滚语义、禁用和键盘焦点规则全部不变。
- **测试边界**：新增一项静态主题回归检查所用 Token 与弹层几何；Windows Vite+ 和双端浏览器验证仍待执行。
