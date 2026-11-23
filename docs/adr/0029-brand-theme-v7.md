# ADR-0029：ADui SCADA V7 品牌主题与 CSS Normalize

- 状态：Proposed
- 日期：2026-11-11
- 关联需求：FR-005、FR-006、NFR-004、NFR-006
- 参考：[ADR-0028](0028-tdesign-dual-framework-ui.md)、[ADR-0004](0004-unified-web-apps.md)

## 背景

正式的 ADui SCADA V7 品牌包采用 Concept C（Realtime Signal Matrix），品牌主色为 `#0D63F3`，辅助科技青色为 `#00C8FF`，实时信号绿为 `#00D9A6`。原 Vue/React 页面及 TDesign 首批属性面板仍采用不同的青绿色硬编码颜色，需统一品牌而不破坏工业状态语义。

## 决策

1. 独立工作区包 `@adui/theme` 维护 Vue/React 唯一的品牌、工业语义色、字体、间距及圆角 Token；原 `packages/runtime/src/theme.css` 保留兼容导入入口，`runtime.css` 引用它。两端不再各自定义 TDesign 颜色。
2. Vue/React 统一使用 V7 品牌包提供的原始 `favicon.svg` 作为导航标志和 Web 图标；不修改 SVG 的路径、信号折点、端点及几何比例。导航旁保留产品名称文本。Tauri Windows 安装包图标在本批不更换。
3. TDesign React / Vue Next 保留 ADR-0028 已选定的组件及版本；通过官方 Web CSS Variables 机制在根 `theme-mode="dark"` 统一覆盖 `--td-brand-color`、文本、背景、字体和尺寸 Token，移除双端 Studio 局部重复声明，不改用 Ant Design。
4. 两个 Web 应用保留当前实际使用的 `@adui/normalize.css/all.css`、共享 Tailwind 与 Runtime 样式加载顺序，不在主题改造中引入新的 Reset/Preflight；HTML 根标记 `theme-mode="dark"` 以启用 TDesign 官方深色语义。
5. 颜色语义明确区分品牌主色（交互选中）、科技青色（辅助线）、实时信号绿（正常实时）、橙色（警告）与红色（错误和 BAD/STALE），避免使用品牌色覆盖报警或不可信数据标记。

## 兼容性与验证

- 原 SVG Runtime、Tag 数据、IndexedDB 草稿、Document Editor、SSE/离线模拟、NestJS 和设备只读边界不变。
- 需要在联网的 Windows 环境执行 `pnpm install --no-frozen-lockfile` 更新真实 `pnpm-lock.yaml`，审核依赖锁文件变更，随后执行 `pnpm install --frozen-lockfile` 和 `pnpm run ready`。当前环境无法联网解析 npm 依赖，**不得手工伪造 lockfile**。
- 人工验证 Vue/React 导航 Logo、TDesign 输入框焦点及按钮状态、图元选中和缩放、吸附辅助线、模拟 GOOD/BAD/STALE 状态、深色对比度和键盘可访问性。
- Tauri MSI 图标尚未更换，属于本批之外的遗留事项；本 ADR 不代表工业现场验收或桌面完整回归已完成。

## D5c0o · 独立主题包与兼容迁移

- 新增 `packages/theme`，提供 `@adui/theme/styles.css`、`tokens.css`、`tdesign.css` 三个 CSS 导出；不依赖 React、Vue、Runtime、Core 或第三方主题包装库。
- 当前 `@adui/scada-runtime` 是唯一直接消费者（`workspace:*`）；它通过既有 `styles.css` 加载主题，因此 React/Vue 不各自持有颜色和字号常量。原 `--scada-*` 与 V7 `--adui-scada-*` 名称仍保留，语义色保持原值。
- TDesign 的 CSS 变量是官方扩展点（[Web 主题说明](https://github.com/Tencent/tdesign-common/blob/develop/docs/web/theme.md)）；当前使用 `html:root[theme-mode="dark"]` 提高 Token 优先级，避免 React/Vue 的懒加载组件 CSS 在后续覆盖根主题；不修改或重编译第三方包的 CSS。
- `@adui/tailwind` 的字号、间距与圆角基础量引用同一业务 Token；不启用 Preflight，不改变 Studio 左右侧栏 252px/320px 与 SVG viewBox。旧页面中仍有大量直接写入的像素值，**本批只建立统一基线和低风险入口，不声称已完成全部历史样式迁移**。
- 新增工作区依赖后须在联网的 Windows 环境使用真实 pnpm 12.18.0 生成并提交 `pnpm-lock.yaml` 的 importer 更新；禁止手工构造锁文件。重新安装后执行双 Web 构建、主题 Token 单元测试、浏览器焦点/禁用状态和 Studio 几何回归。未经实测不能宣称新主题通过或深色对比度全部达标。
