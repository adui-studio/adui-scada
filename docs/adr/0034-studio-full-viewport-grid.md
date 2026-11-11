# ADR-0034：全工作区坐标网格与有界工程页面

- 状态：Proposed
- 日期：2026-11-11
- 关联：[ADR-0031](0031-canvas-first-studio-workspace.md)、[ADR-0032](0032-studio-16x9-fit-viewport.md)、[ADR-0033](0033-studio-full-bleed-canvas.md)

## 背景

浏览器截图显示：共享 CSS 虽已使 `studio-canvas-scroll`、`studio-canvas-board` 和 SVG 撑满工作区，但网格仍只填充 `page.size`（示例 880×460）的矩形；与此同时 SVG `preserveAspectRatio="xMidYMid meet"` 受视口与页面不同宽高比影响，画面上下出现明显空白，视觉上未达到“网格撑满”。

需要明确区分：**编辑器工作区的世界坐标网格**与**实际工程页面的有限边界**。不得把工程 JSON 的页面尺寸改成浏览器视口尺寸，也不得使用 CSS 拉伸 SVG 图元。

## 参考与取舍

- [Penpot Workspace Basics](https://help.penpot.app/user-guide/designing/workspace-basics/)：视口与可导出画板是两个概念，画板无需占据完整编辑器工作区。
- [draw.io Page View](https://www.drawio.com/docs/manual/editor/panels/editor-page-view/)：网格可延伸至整个画布，页面轮廓是可选编辑辅助信息；编辑网格不属于导出图像。
- [Figma View Options](https://help.figma.com/hc/en-us/articles/360041065034-Adjust-your-zoom-and-view-options)：打开设计默认适应窗口，缩放只作用于画布内容，不改变左右面板。
- [Ignition Designer UI](https://www.docs.inductiveautomation.com/docs/8.3/platform/designer/designer-user-interface)：保留左右项目/属性面板与中央编辑区域的职责划分。

借鉴视图分离、网格延展、适应窗口与上下文属性概念；不复制其插件体系、无限文档模型、完整面板停靠或专有交互。

## 决策

1. `@adui/tailwind/studio.css` 继续负责满宽满高、无滚动中央区域；桌面左右 252px / 320px 固定，中部 `minmax(0, 1fr)`。工作区网格不使用固定 CSS 背景图，避免缩放/平移时与真实 SVG 世界坐标、网格吸附错位。
2. 在共享 Core 中新增 `studioViewportRect(page, viewport, zoom, pan)`：使用 SVG 元素经 `ResizeObserver` 读到的**实际 CSS 宽高**计算 `fitScale = min(viewportWidth/pageWidth, viewportHeight/pageHeight)`，使 `viewBox` 的宽高比始终等于真实工作区宽高比。在页面比例不同时，向周围扩展可见世界坐标，而不是强制页面拉伸。
3. Vue/React 在现有 SVG `viewBox` 上使用共享可见视区；网格覆盖该视区的完整 `x/y/width/height`，`patternUnits=userSpaceOnUse` 保证网格与工程坐标、吸附规则统一。网格显示与吸附设置仍各自独立。
4. 添加仅编辑器可见的工程页面边界辅助 `rect`，保留原始页面大小、图元坐标和 `preserveAspectRatio="xMidYMid meet"`；此边界与网格均不通过 `renderSvgPage` 或 `svgDataUrl` 导出，也不写入工程文档。
5. 缩放和平移使用当前视口尺寸计算，界面改变大小或隐藏侧栏自动重新适应；平移限制在工程页面附近，避免把页面拖到视野外。放大后继续使用既有中键 / Alt + 空白拖动；恢复适应视图不修改文档。
6. 事件处理、工程 Schema、IndexedDB、Tag、SSE、工业设备只读边界保持不变。Vue/React 独立实现 `ResizeObserver` 绑定和组件生命周期，核心数学函数共享。

## 验收与风险

- 在 1920×1080、1440×900、1024×768 以及 125% 缩放下确认：网格覆盖中央 SVG 全部可见区域，不再出现上下左右的断层；固定侧栏不影响网格；工程边界在完整网格内可辨识。
- 两端操作网格显隐、图元与网格吸附、拖动、框选、缩放、平移、页面切换、草稿恢复及 Vue/React JSON 往返；切换侧栏或停靠开发者工具后验证视区无拉伸与不丢失图元。
- `packages/core/test/studio-viewport-rect.test.ts` 覆盖宽屏、窄屏、缩放、平移夹取和非法尺寸；静态配置脚本验证双端使用共享函数、监听真实尺寸和完整网格矩形。
- 当前远端环境没有联网的工程依赖安装和浏览器交互工具，**仅确认源代码和静态契约，不能宣称 `pnpm run ready`、单测或视觉回归已经通过**。
