# ADR-0032：Studio 固定 16:9 画板、适应视口与无滚动缩放

- 状态：Superseded
- 替代决策：固定比例显示外框已由 [ADR-0033](0033-studio-full-bleed-canvas.md) 取代
- 日期：2026-11-11
- 关联需求：FR-005、FR-006、NFR-004、NFR-006
- 关联决策：[ADR-0031](0031-canvas-first-studio-workspace.md)

## 问题

维护者浏览器截图显示中央画布有纵向滚动条，放大操作会把 SVG 宽度改为 `zoom * 100%`，进而推高 SVG 高度；同时已有工程示例页面为 880×460，不是严格的 16:9。此前布局未定义“画板显示区域”和“工程文档页面尺寸”之间的区别。

## 参考行为

- [Figma Zoom/view options](https://help.figma.com/hc/en-us/articles/360041065034-Adjust-your-zoom-and-view-options)：新打开设计默认 Zoom to fit；人工缩放只改变画布视图，不改变侧栏尺寸。
- [draw.io Zoom](https://www.drawio.com/docs/manual/editor/zoom/)：Fit Window 可以跟随窗口大小重新适应，人工缩放退出自动适应。
- [Penpot Interface](https://help.penpot.app/user-guide/first-steps/the-interface/)：画布、侧栏、检查器独立分工。

仅参考可验证的交互理念，不复制任何第三方源代码。

## 决策

1. 两端 Studio 使用 `packages/tailwind/src/studio.css` 的固定宽三栏：桌面端左 252px、右 320px，中间 `minmax(0, 1fr)`；左右侧栏仍可按需隐藏。小于 930px 的窄屏布局继续纵向分区，以确保可访问性。
2. 画布工作区采用 `container-type: size`、`177.7778cqh` 和 `aspect-ratio: 16 / 9`，按照当前中央区域宽高计算可容纳的最大 16:9 画板；画布容器始终 `overflow: hidden`，不允许竖向或横向滚动条。
3. **16:9 指画板显示窗口，不是工程 Schema 的页面尺寸。** 既有 880×460 工程不会强制变形或重设图元坐标。SVG `preserveAspectRatio="xMidYMid meet"` 等比适配，原始页面比例与 16:9 不同时可出现留边，不拉伸图元。
4. 新增 `packages/core/src/studio-viewport.ts` 的共享 `studioViewBox`、`clampStudioPan`。默认为适应窗口（`zoom=1`）；点击加减后变更 `viewBox` 而非 SVG DOM 宽度，缩放倍率为相对适应视图的比例，不等于屏幕物理像素 100%。
5. 放大后支持鼠标中键拖动，或 Alt + 左键拖动画布空白区域平移。平移不会越过工程页面边界，也不写入文档、撤销栈、草稿或远端设备。恢复适应视图重置缩放和平移。
6. 网格/吸附、左右侧栏显隐合并进“视图设置”菜单；自动保存控制移入原“文件与草稿”菜单。所有既有点击事件、禁用状态和中文文案仍保留。

## 验收

- 对共享数学函数覆盖适应、放大、缩小、边界夹取和非法参数；对应单测由 `packages/core/test/studio-viewport.test.ts` 提供。
- Vue/React 各验证 1920×1080、1440×900、1024×768 及 125% 浏览器缩放；确认页面无外层滚动，中间画板无滚动，画板实测宽高比为 16/9。左右面板允许各自滚动。
- 交互回归：两端 50%—200% 缩放、重置适应、画布放大后平移、图元选中/拖动/八方向缩放/旋转、框选、网格与图元吸附以及 JSON 草稿跨框架互通。
- CSS 容器查询单位需要在目标 Chrome/Edge 和 Tauri 2 Windows WebView2 中验证。当前仅完成 GitHub 源码修改及静态核对，**尚未在本机运行 `pnpm run ready` 和实际 DOM 尺寸验收**。
