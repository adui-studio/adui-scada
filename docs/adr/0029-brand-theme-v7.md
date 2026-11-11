# ADR-0029：ADui SCADA V7 品牌主题与 CSS Normalize

- 状态：Proposed
- 日期：2026-11-11
- 关联需求：FR-005、FR-006、NFR-004、NFR-006
- 参考：[ADR-0028](0028-tdesign-dual-framework-ui.md)、[ADR-0004](0004-unified-web-apps.md)

## 背景

正式的 ADui SCADA V7 品牌包采用 Concept C（Realtime Signal Matrix），品牌主色为 `#0D63F3`，辅助科技青色为 `#00C8FF`，实时信号绿为 `#00D9A6`。原 Vue/React 页面及 TDesign 首批属性面板仍采用不同的青绿色硬编码颜色，需统一品牌而不破坏工业状态语义。

## 决策

1. 共享 `packages/runtime/src/theme.css` 作为 Vue/React 唯一的品牌及工作台语义 Token 入口；`runtime.css` 引入该文件，两套 Studio CSS 复用变量并保持内容对等。
2. Vue/React 统一使用 V7 品牌包提供的原始 `favicon.svg` 作为导航标志和 Web 图标；不修改 SVG 的路径、信号折点、端点及几何比例。导航旁保留产品名称文本。Tauri Windows 安装包图标在本批不更换。
3. TDesign React / Vue Next 保留 ADR-0028 已选定的组件、版本及分批迁移边界，仅将 Studio 中的 `--td-brand-color*` 等样式变量映射至共享主题，不改用 Ant Design。
4. 两个 Web 应用在主入口首先导入 `@adui/normalize.css@0.1.1` 默认入口，不导入 Reset、Forms 或 all.css，避免改变现有 TDesign 与原生控件的盒模型。
5. 颜色语义明确区分品牌主色（交互选中）、科技青色（辅助线）、实时信号绿（正常实时）、橙色（警告）与红色（错误和 BAD/STALE），避免使用品牌色覆盖报警或不可信数据标记。

## 兼容性与验证

- 原 SVG Runtime、Tag 数据、IndexedDB 草稿、Document Editor、SSE/离线模拟、NestJS 和设备只读边界不变。
- 需要在联网的 Windows 环境执行 `pnpm install --no-frozen-lockfile` 更新真实 `pnpm-lock.yaml`，审核依赖锁文件变更，随后执行 `pnpm install --frozen-lockfile` 和 `pnpm run ready`。当前环境无法联网解析 npm 依赖，**不得手工伪造 lockfile**。
- 人工验证 Vue/React 导航 Logo、TDesign 输入框焦点及按钮状态、图元选中和缩放、吸附辅助线、模拟 GOOD/BAD/STALE 状态、深色对比度和键盘可访问性。
- Tauri MSI 图标尚未更换，属于本批之外的遗留事项；本 ADR 不代表工业现场验收或桌面完整回归已完成。
