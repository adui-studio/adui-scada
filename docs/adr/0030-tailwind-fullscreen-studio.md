# ADR-0030：Tailwind CSS 与全视口 Studio 工作台布局

- 状态：Proposed
- 日期：2026-11-11
- 关联需求：FR-005、FR-006、FR-013、NFR-004、NFR-006
- 参考：[ADR-0028](0028-tdesign-dual-framework-ui.md)、[ADR-0029](0029-brand-theme-v7.md)

## 背景

Studio 原布局在两端分别使用 `.studio-shell { max-width: 1580px; margin: auto; }` 和固定宽三栏 CSS Grid，且页面总高度不受视口限制。工具栏、页面管理、图层和几何属性叠加后，浏览器右侧出现外层滚动条、中央画布不能充分利用宽度。需要统一 Vue/React 布局，同时保留已投入使用的 TDesign 表单和编辑命令。

## 决策

1. 双框架正式引入 `tailwindcss@4.3.5`、`@tailwindcss/vite@4.3.5`，使用根目录 pnpm Catalog 固定版本；仅两套 Web 的 Vite+ 入口分别注册插件，运行时与共享 Core 不引入框架依赖。
2. 应用入口在 ADui Normalize 之后导入 Tailwind 主题和工具类，禁用 Tailwind Preflight（不引入 `preflight.css`），避免与 `@adui/normalize.css`、TDesign React/Vue Next 基础样式叠加。主题变量通过 `@theme inline` 引用 ADR-0029 共享品牌 Token。
3. Studio 模式下应用容器使用 `h-dvh min-h-0 overflow-hidden`，顶栏 `shrink-0`，Studio 主体 `flex-1 min-h-0`，三栏工作区使用同高度的 CSS Grid。**只禁止外层页面滚动**；图层面板、属性面板、中央画布分别以 `overflow-auto` 处理超出内容。
4. 桌面宽屏采用可伸缩画布及左右限宽侧栏；小于 Tailwind 默认 `lg` 断点时，以三个可分别滚动的纵向分区展示，避免水平裁切和屏幕外不可访问的操作。视口内的状态说明压缩为一行，保留完整内容的可访问文本。
5. Studio 结构布局与响应式边界优先使用 Tailwind 实用类；SVG 控制点、图元命中层、TDesign 深色主题覆盖等不适合实用类的精细样式继续留在两端一致的 `studio.css`。Runtime 保留原展示布局，后续按模块逐步迁移，不进行无关重构。
6. Vue/React 按相同的实用类布局实现，不修改 `ScadaDocument`、Tag、IndexedDB、Editor 指针事件、Runtime SSE 和工业只读安全边界。

## 风险与验收

- Tailwind v4 使用现代 CSS 特性，正式兼容范围须以目标浏览器及 Tauri WebView 实测确认；不能以开发环境截图代替生产兼容性结论。
- 初次安装需要联网执行 `pnpm install --no-frozen-lockfile` 更新 `pnpm-lock.yaml` 并审查真实依赖哈希；不得伪造锁文件。随后运行 `pnpm run ready`。
- 实测 React/Vue 下 1440×900、1024×768、768×768、移动窄宽度，以及浏览器 125%/150% 缩放；检查外层滚动条为零、三栏区域可滚动、键盘聚焦不会被裁切、图层定位可见、SVG 缩放/框选/拖动及撤销无回归。
- 尚无真实浏览器和 MSI 运行测试结果，不提前宣称通过。
