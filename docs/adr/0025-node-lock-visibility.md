# ADR-0025：图元锁定、可见性与批量图层状态

- 状态：Proposed
- 日期：2026-11-10
- 关联需求：FR-005、FR-006、FR-007、FR-013、NFR-004、NFR-006
- 参考：[ADR-0018](0018-schema-version-migration.md)、[ADR-0023](0023-page-copy-and-reordering.md)、[ADR-0024](0024-session-node-clipboard.md)

## 背景与取舍

V0.2 Studio 已有图元层序、组合、跨页面复制、会话剪贴板和 IndexedDB 草稿，但缺少持久化的图元锁定和显示状态。直接新增 `ScadaNode.locked/visible` 顶层字段会让仍运行旧版严格 Schema 白名单的消费端拒绝相同版本的工程文件，若同步升级 Schema 又会扩大当前批次的迁移范围。

## 决策

1. 在 `ScadaDocument 0.2.0` 既有 `ScadaNode.props.__scadaStudio` 中增加可选的 `locked`、`visible` 布尔字段。未声明时为未锁定、可见；`locked: true` 代表锁定，`visible: false` 代表隐藏。解锁或重新显示时删除对应字段，整个状态对象为空时删除 `__scadaStudio`。
2. `parseScadaDocument` 对该命名空间进行严格验证，拒绝非对象、非布尔值、未知键；普通业务 `props`、Tag ID 和 rules 保持原状。这是**扩展约定**，不是生产访问权限模型，也不添加顶层 Schema 字段。
3. 共享 `DocumentEditor.setSelectedLocked(locked)` 和 `setSelectedVisible(visible)` 支持单选及多选，批量变更为一条撤销历史，未变化返回 `false`。图元选择仍允许锁定或隐藏成员，供图层列表解锁与恢复显示。
4. 当操作涉及已锁定图元时，移动、几何、Tag 绑定、文案、对齐、组合、解组、删除、剪切、复制选中及跨页图元复制须拒绝；删除包含锁定图元的页面也须拒绝。层序调整不能选中锁定图元，也不能间接改变锁定图元在当前页的序号。整页复制仍可复制锁定状态，适合备份和建新页面。
5. 只有显式解锁命令可以改变已锁定图元的 `locked` 标记，其他属性与元数据仍须保持不变；隐藏/显示受锁定约束。保护规则由共享 Core 提交边界和独立几何/吸附 API 共同执行，不靠单纯禁用按钮。
6. 最新 SVG Runtime 仅渲染可见图元，锁定不影响只读显示。隐藏图元不参与画布命中、框选和其他节点的吸附参考，但仍留在工程 JSON、图层列表、Tag 与历史中；在图层列表选择后可以恢复。`Ctrl+A` 仅选取可见、未锁定图元。
7. Vue/React Studio 统一提供「锁定所选、解锁所选、隐藏所选、显示所选」及图层状态标记，复用原有列表排序、组合和属性面板。锁定时无法启动画布拖动和几何手柄；快捷键失败显示中文错误而不抛出未处理异常。

## 兼容性与安全边界

- 保留工程 Schema `0.2.0`、`pages[]` 和原 Dexie 草稿存储，支持 JSON、跨 Vue/React 导入导出与保存后恢复；不升级第三方依赖。
- 旧版本 Parser 可保留原有合法 `props` 扩展，但**旧版 Runtime 不会识别隐藏语义**；因此已使用 `__scadaStudio.visible` 的工程不得交由未升级的 Runtime 执行。后续正式发布流程必须校验 Runtime 能力或引入显式兼容版本策略。
- 图元锁定只是编辑器防误操作功能，**不是身份授权、工业控制安全策略或设备写入许可**；真实 PLC/DCS 通讯、Tag 权限、工程发布及版本管理不在此批实现。
- 所有锁定、可见性修改均参与 JSON/IndexedDB 草稿与撤销/重做；显示/隐藏不改变 Tag 质量，断线/STALE 数据仍由 Runtime 按既有规则处理。

## 验证要求

新增 Core 编辑器、Schema、SVG 渲染回归用例覆盖默认状态、非法输入、批量修改/撤销、锁定编辑保护、组合及页面删除、层序、隐藏框选/吸附、JSON 往返和 Runtime 过滤。维护者须分别运行 Vue/React Studio、检查只读 Runtime 并在 Windows 执行 `pnpm run ready`；源码静态检查不能替代这些验证。
