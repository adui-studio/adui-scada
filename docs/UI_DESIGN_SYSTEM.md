# ADui SCADA · 精密工程工作台 UI/UX 设计系统（D5c1）

> 状态：**单 PR 整体重设计候选**。本基线替换原 D5c0l 至 D5c0x 深蓝水平导航视觉方案；只有最终统一验收成功才可合并。此处不定义或开放任何新工业写入、报警或发布权限。

## 1. 设计依据与决策

本次使用仓库内 `.agents/skills/ui-ux-pro-max/SKILL.md`、`references/quick-reference.md`、`references/pro-rules.md` 与技能自带 `products.csv` / `styles.csv` / `colors.csv` / `typography.csv` / `ui-reasoning.csv` 的工业相邻类别进行设计筛选。对应的可核对匹配为：

- **产品特征**：Smart Home/IoT Dashboard 的实时状态、Status Page / Incident Management 的事故与状态可识别性、RPA / Automation Dashboard 的高密度运营界面；
- **风格基线**：Real-Time Monitoring + Data-Dense Dashboard，辅以 Minimalism & Swiss Style 和 Accessible & Ethical；
- **适配理由**：本产品不是营销大屏，也不是全屏游戏化 HUD。组态工程师需要更适合阅读长文本、辨识按钮与检查权限的浅色操作区域；中央 SVG 绘图应与监控背景隔离，采用不抢夺注意力的深色专用画布；
- **最终差异化方案**：技能中的 IoT 类别偏好深色监控，但本项目是“编辑器 + 实时观测”的双用途软件，因此主动选择**浅色精密工作区 + 深色组态画布**，而不是机械套用推荐色板。品牌严格采用 V7 原标识与颜色，不重绘 SVG 几何。

用户职责优先级：**核查数据可信度 → 找到当前工程和页面 → 执行受控命令 → 收到反馈 → 复核结果**。不以装饰性动画、彩色光晕或虚构指标替代以上流程。

## 2. 全局信息架构

| 区域 | 新结构 | UX 要求 |
| --- | --- | --- |
| 应用外壳 | 左侧 84px 独立功能导航轨道 + 顶部 54px 当前页面路径 | 导航只含运行监控、已发布运行、组态编辑三项真实能力；当前态和键盘焦点明确 |
| 模拟运行 | 页面标题/连接状态 → 明确的模拟声明 → 工艺画面主区域 → 右侧质量、最近状态与 Tag 值 | 工艺画面永远优先，质量文本与状态时间线不可被绿色样式代替；数据过期依旧显示原真实质量 |
| 已发布运行 | 左侧只读工程选择与发布指针元数据，右侧独立验证快照画面 | 未授权、未发布、离线、校验失败均只显示对应空态；无正式快照不得显示模拟 SVG |
| 组态编辑 | 工程命令工具栏 → 页面标签 → 固定资源/图层侧栏 → 深色 16:9 SVG 画布 → 属性/Tag 侧栏 → 会话状态栏 | 关键保存/撤销随时可见，工具栏窄屏内部滚动；左右侧栏宽度 252px / 320px，画布占其余宽度 |
| 组件浮层 | TDesign Dropdown / Popup / Dialog / Collapse / Upload | 沿用经过确认的官方 API；取消、Esc、退出动画、幂等关闭的真实语义不改变 |
| 底部反馈 | 状态消息、模拟/只读警示、图元与选中数量 | 保持具体中文反馈；不会把本地草稿/模拟服务冒称正式发布或设备控制 |

三条功能路由继续沿用现有懒加载与原本的业务事件处理。React 19 适配器、Vue 生命周期、Core 编辑器、IndexedDB CAS、OIDC 拒绝与发布快照校验均不更改。

## 3. 色彩和排版 Token

所有色彩、字号、间距统一由 `@adui/theme` 定义，再通过 TDesign 官方 CSS Variables 映射；应用与 Studio 仅消费语义变量。

| 用途 | Token | 值/规则 |
| --- | --- | --- |
| V7 主品牌 | `--adui-scada-blue` | `#0D63F3`，**原品牌不变** |
| V7 科技青 | `--adui-scada-cyan` | `#00C8FF`，原品牌不变 |
| V7 信号绿 | `--adui-scada-teal` | `#00D9A6`，原品牌不变 |
| 工作区底 | `--adui-color-bg` | `#EDF1F5` |
| 正文面板 | `--adui-color-surface` | `#FFFFFF` |
| 导航轨道 | `--adui-color-nav` | `#151E2C` |
| SVG 专用画布 | `--adui-color-stage` | `#101A29` |
| 画布命令条 | `--adui-color-stage-elevated` | `#182538` |
| 主文字 | `--adui-color-text-strong` | `#142338` |
| 次级文字 | `--adui-color-text-secondary` | `#4D6176` |
| 状态 | `--adui-color-success/warning/danger` | 浅色背景上可读的独立语义色，永远配套文字 |
| 焦点 | `--adui-color-focus-ring` | `#0D63F3`，不得删除键盘轮廓 |
| 字体 | `--adui-font-family` | Inter + 中文系统字体回退；不依赖在线字体 |
| 排版 | `--adui-font-size-*` | 既有 11/12/13/14/16/18/24/28px 刻度，标签与正文按场景使用 |
| 空间 | `--adui-space-*` | 0/2/4/6/8/12/16/20/24/32px 刻度，禁止新增第二套 Tailwind Token |
| 浮层 | `--adui-shadow-floating` | 仅浮层使用明显阴影；其他内容通过分组和边界识别 |

V7 Logo 原 SVG 和几何不动，导航缩放使用现有 `/brand/favicon.svg`。不下载或分发字体文件，不引入新图标库。背景保持不透明，避免监控关键数值被模糊玻璃或透视效果降低可读性。

## 4. 关键 UX 流程

1. **运行监控**：进入应用首先看到「水处理实时监控」、真实运行状态和「模拟运行」说明；工艺 SVG 占主区域，侧边依次展示连接状态、断线次数、最新有效更新、数据年龄、质量分布、状态变化和 Tag 质量值。BAD/STALE 仍以占位和文字表达。
2. **已发布运行**：进入后先看到工程 ID 表单和 `release:read` 限制说明；未选工程时预览空态完整占位，点击读取只能触发原受控会话，切换页面只显示已验证快照。停止后清空画面。
3. **组态设计**：功能轨道进入 Studio；工具栏将撤销/重做、保存草稿、文件/版本/服务端操作分组，水平空间不足时仅工具栏滚动；页面标签可辨认当前页；左侧图元/图层独立滚动，右侧属性和 Tag 独立滚动，中间网格占剩余画布；所有编辑继续使用共享 Core 命令。
4. **高风险操作**：原确认弹窗、删除绑定拒绝、历史版本载入、自动保存 CAS 和跨标签页防写仍保持原始业务处理与文案。重设计不跳过确认，也不自动进行设备操作。
5. **反馈**：读取/刷新/保存的现有异步提示与错误继续出现在语义 `role=status/alert` 区域；失效/拒绝不呈现 GOOD 假象。

## 5. 键盘、可访问性与响应式

- 应用保持可聚焦的「跳转到主要内容」入口；导航三项真实按钮、`aria-current=page`、清楚的 `:focus-visible`。
- Studio 图层/Tag 真实 Tab 顺序沿用 PR #191 已验证交互；不可通过视觉改造把图元拖拽变成唯一选择方式。
- 本批文字对比度目标 **WCAG AA 常规文字 4.5:1**，深色画布和浅色操作区分别检测；真实场景见浏览器统一验收。
- 1440×900、1024×768 同时检查 React/Vue 的三张主视图，共 12 个状态矩阵；不足 740px 时导航收至 72px，运行/发布内容自动堆叠。桌面 Studio 不因响应式而修改持久化的画布尺寸或 viewBox。
- 长 Tag ID、错误消息和工程 ID 应自然换行；按钮禁用必须可识别，不能只用颜色区分状态。
- 动效仅用于按钮悬停/导航激活等轻量状态；尊重 `prefers-reduced-motion`，不出现长循环呼吸灯或背景视差。
- 所有真实图元选中、缩放、旋转、框选、辅助线及图层拖拽仍由现有领域组件处理，通用控件继续交给 TDesign。

## 6. 修改地图和唯一 PR 边界

| 模块 | 设计修改 | 严禁修改 |
| --- | --- | --- |
| `packages/theme` | 共享明亮工作区 Token、官方 TDesign Light 映射 | V7 Logo 几何与原始品牌色 |
| `apps/web-{react,vue}/src/App` | 全新功能轨道、当前视图路径、模式提醒 | 业务权限判断、非预期路由 |
| `apps/web-{react,vue}/src/runtime` | 模拟工艺大画布布局与发布读取/预览两栏结构 | TagStore、网络订阅、发布快照校验 |
| `packages/runtime/src/runtime.css` | 从零重建应用与监控/发布页面 CSS | 底层运行时 API |
| `packages/tailwind/src/studio.css` | 全新 Studio 视觉层级与舞台皮肤 | SVG 变换坐标、252/320 侧栏和固定 viewBox |
| `packages/runtime/test/theme-tokens.test.ts` | 重设计 Token、语义样式、双框架同构静态检查 | 放宽已有工业安全逻辑 |
| `scripts/test-studio-browser.mjs --ui` | 新增 12 场景三页面真实浏览器视觉语义门禁 | 真实告警、危险写入或测试环境伪数据 |

**提交策略**：所有界面均在 `feat/d5c1-full-ui-ux-rebuild` 中汇总，最终只创建一个 Draft PR，立刻指派 `@adui-dev`。不再拆批要求维护者重复验收；先完成实现与现有测试适配，再集中进行一次质量和视觉回归。PR 必须等待最终显式授权才可合并。

## 7. 最终一次性验收矩阵（待执行）

`node --check`、`vp check`、`pnpm run ready`、`pnpm run test:ui:browser`（React/Vue × 1440/1024 × 运行/发布/Studio）、`pnpm run test:browser`、`pnpm run test:tags:browser`、`pnpm run test:interop`、`pnpm run test:versions`、`pnpm run test:versions:safety`、`pnpm run test:multitab`、`pnpm run test:legacy:browser`。若真实发布/OIDC Lab 需要受保护凭据或专用数据库，必须按原隔离方案执行，不能用视觉测试替代授权验收。

**当前验证事实**：仅 PR #191 在其已记录 HEAD 完成了用户提供的 Windows 验收，并已合并。D5c1 分支的新 UI、浏览器脚本、Vue/React CSS 和构建尚未在维护者 Windows 实际验证；文档不是通过证明。
