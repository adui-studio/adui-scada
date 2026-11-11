# ADR-0033：中央画布撑满编辑工作区

- 状态：Proposed
- 日期：2026-11-11
- 关联决策：[ADR-0031](0031-canvas-first-studio-workspace.md)、[ADR-0032](0032-studio-16x9-fit-viewport.md)

## 原因

维护者实际截图指出顶部、左右和底部存在明显空白；源于原有 `studio-canvas-scroll` 的内边距及 `studio-canvas-board` 的 16:9 外框比例约束。中央工作区的实际宽高由浏览器窗口、顶部工具栏和固定侧栏决定，并不恒定为 16:9。强制限定独立画板的外框比例必然在一边产生空白。

## 决策

1. `studio-canvas-scroll`、`studio-canvas-board`、`studio-svg` 在中间可用区域内全部使用 `width:100%;height:100%`，移除 `padding`、`margin`、`border`、`aspect-ratio` 和 `cqh` 尺寸约束，背景色一致；外层不产生滚动条。
2. 左 252px、右 320px 侧栏保持固定宽度，中间 `minmax(0,1fr)` 填满剩余区域。窄屏时按现有规则改为纵向分区，但不重新引入画布内边距。
3. 原工程页面如 880×460 保持尺寸和图元坐标。SVG 仍使用 `preserveAspectRatio="xMidYMid meet"` 与共享 `studioViewBox`，在不同工作区比例下不拉伸图元。现阶段 16:9 是工程画布设计目标，不是浏览器编辑区的强制物理比例；严格 16:9 外框与任意窗口全铺满无法同时满足，除非裁切或变形，本阶段不采取这两种方式。
4. 仅修改共享 `@adui/tailwind/studio.css` 与对应测试规则，不调整 Vue/React 编辑器交互和工程 Schema。左右面板内部仍允许独立滚动。

## 验收

- React/Vue 在 1920×1080、1440×900、1024×768 和缩放 125% 下，中间 SVG 元素的边界应贴合 `studio-canvas-scroll` 内容区域四边；中央无滚动条和额外内边距。
- 隐藏左右侧栏后画布继续撑满。缩放、框选、拖动、Tag、撤销和草稿功能不得回归。
- 本次已更新源码和静态校验，**尚未运行真实浏览器尺寸检查、`pnpm run ready` 和端到端测试**。
