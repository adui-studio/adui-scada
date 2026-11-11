# ADR-0028：Vue/React 双框架统一采用 TDesign 组件体系

- 状态：已接受（技术选型已由维护者明确确认，组件迁移分批验收）
- 日期：2026-11-11
- 关联需求：FR-005、FR-006、FR-013、NFR-004、NFR-006
- 关联决策：[ADR-0027](0027-layer-group-tree-projection.md)、[V0.2 Studio](../V0.2_STUDIO.md)

## 背景

ADui SCADA 正式产品包含 Vue 3 和 React 双版本，当前 V0.2 Studio 多数操作区仍为原生 HTML 控件。维护者已在本轮明确指定两套 Web UI 全部逐步统一使用腾讯 TDesign，同时要求图标使用独立的框架对应 npm 包。此前工程规划中提过 React Ant Design，但**当前维护者确认的 TDesign 选型优先**，后续不可擅自替回。

## 选型

| 端 | UI 组件包 | 独立图标包 | 当前 Catalog 固定版本 |
| --- | --- | --- | --- |
| React | `tdesign-react` | `tdesign-icons-react` | `1.18.6` / `0.6.11` |
| Vue 3 | `tdesign-vue-next` | `tdesign-icons-vue-next` | `1.20.11` / `0.4.11` |

采用维护者指定的 [React 组件文档](https://tdesign.tencent.com/react/overview)、[Vue Next 组件文档](https://tdesign.tencent.com/vue-next/overview)、[React 图标文档](https://tdesign.tencent.com/react/components/icon) 与 [Vue 图标文档](https://tdesign.tencent.com/vue-next/components/icon) 作为使用依据。以当期 npm 正式包为版本来源，不采用预发布、外部 CDN 或自行假设的组件 API。已核对发布标签 `tdesign-react@1.18.6` 的 React peer 要求 `>=16.13.1`，`tdesign-vue-next@1.20.11` 的 Vue peer 要求 `>=3.1.0`，与当前仓库 React 19 / Vue 3 选型范围兼容；完整包安装与构建仍以本地 pnpm 实测为准。

## 决策

1. 新增四个正式依赖并统一放在根 `pnpm-workspace.yaml` Catalog；React 和 Vue 应用 `package.json` 只写 `catalog:`，不在子项目分散指定版本。不新增 Ant Design 或其他 UI 框架。
2. 首批迁移 Studio 属性面板的操作按钮和标签文本输入，以及左侧图层搜索输入与清除操作；分别使用 `Button/Input` 和独立按需 SVG 图标 `CloseIcon`。在各 Studio 入口加载对应 TDesign 样式，不全局注册整个组件库。
3. 不一次性替换所有 HTML 控件。已有几何输入依赖原生 `FormData` 和 `updateSelectedTransform` 的批量原子提交；Tag 绑定、文件导入和指针画布行为保持当前契约，后续分别迁移并补测试。迁移期间允许原生控件与 TDesign 并存，但新建表单/按钮默认使用 TDesign。
4. 新增 `GEOMETRY_PROPERTY_FIELDS` 共享常量作为编辑器几何属性元数据来源，Vue 和 React 不再各定义一套本地数组。保留 Core 独立于 UI 组件库、Runtime 不依赖 Editor、JSON Schema `0.2.0` 及 Dexie 草稿协议。
5. TDesign 样式在 `.studio-shell` 中配置深色工业主题变量；明确隔离于 Runtime 图元样式。不能通过更改 Tag 质量颜色或在工程中注入 CSS/JavaScript 来实现外观定制。
6. 文本编辑及图层搜索保持原来的受控状态、输入长度、权限和键盘快捷键保护。按钮操作继续调用共享 `DocumentEditor` 命令，避免两端存在不同业务语义。

## 延后事项与风险

- **真实颜色、边框、透明度编辑**需要先设计受校验的共享图元外观 Schema 和安全 SVG 序列化规则。水箱、泵等工业状态图元的报警/质量颜色不能被用户自定义外观覆盖；这一能力不在首批 UI 组件迁移中宣称已实现。
- UI 组件样式可能导致现有原生按钮和暗色变量的视觉差异，必须在 React/Vue 浏览器中实测，包括输入框焦点、表单提交、禁用态、缩放、组合锁定及窄屏布局。
- 本轮远端开发环境无法解析 npm Registry，**无法生成或核实完整的 `pnpm-lock.yaml`**。维护者首次拉取分支后须在联网的 Windows 工作区执行 `pnpm install --no-frozen-lockfile`，审查并提交新增的 `pnpm-lock.yaml` 变更，再执行 `pnpm install --frozen-lockfile` 和 `pnpm run ready`。不得手工猜测依赖完整性哈希、伪造锁文件或省略这一验收前置步骤。
- 第三方 TDesign 默认文案应通过自身简体中文配置保持一致，项目自有提示继续遵守仓库中文文案规范。TDesign 引入的依赖需经 lockfile/许可证与供应链审核，不自动视为通过。

## 验收

React/Vue 的 TDesign 按钮、文本输入、图层搜索与清除图标均可操作；图元选中、标签编辑、几何属性提交、撤销重做、锁定/隐藏、Dexie 草稿与旧 JSON 双向互通不回归。执行根目录完整 `pnpm run ready`，确认 Catalog、格式、Lint、类型、单测、E2E、文档及双框架构建成功。所有通过结论必须来自本地日志，不得使用历史批次统计替代。
