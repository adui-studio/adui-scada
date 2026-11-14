# ADR-0063：Vue/React Studio 项目 Tag 可视化管理与双框架对等

- 状态：Proposed
- 日期：2026-11-14
- 关联：FR-002、FR-004、FR-006、FR-013、NFR-002、NFR-004
- 前置：[ADR-0061](0061-tag-definition-catalog.md)、[ADR-0062](0062-project-tag-definitions-schema-030.md)

## 背景

第三十批将项目级 Tag 定义纳入 ScadaDocument 0.3.0，并在 Core 提供带撤销、重做的新增、更新、删除命令。React 和 Vue Studio 现有右侧属性区只能展示定义目录和选择绑定，无法通过可视化表单维护项目标签，也不能在浏览器内确认历史迁移占位的真实数据类型。

需要在不改变共享工程 Schema、不引入第二份 Tag 状态、不接触工业采集设备的前提下为两套正式 Web Studio 补齐维护入口。

## 决策

1. **双框架分别渲染，共享 Core 规则**：React 使用 Studio/TagManager.tsx，Vue 使用 Studio/TagManager.vue。两个组件仅持有尚未保存的表单草稿；Tag 列表始终来自各自 Studio 当前 state.document.tags。全部持久更改经 DocumentEditor.addTagDefinition/updateTagDefinition/removeTagDefinition 提交，不直接修改 JSON、IndexedDB 或其他客户端目录副本。
2. **表单字段**：新增 Tag 要填写稳定 tagId、显示名称、数据类型、可选单位和描述。ID 在编辑模式禁止修改；单位空字符串归一为 null。数值、布尔值、文本是允许的新增类型。历史 unknown 占位可选中编辑并改为明确类型，不在新建候选中显示。输入长度与合法字段最终由 Core 严格校验，界面长度限制仅辅助用户操作。
3. **删除保护**：删除须确认；已被任一页面、任一图元槽引用的 Tag 由共享 Editor 拒绝删除，界面展示中文错误且不修改工程，也不隐式解绑。更改 Tag 数据类型时仍须与全部现存已知槽兼容；不能将已确认类型退回 unknown。
4. **一致的交互结果**：成功变更刷新 EditorSnapshot，原有撤销、重做、JSON 导入导出与 IndexedDB 自动保存会话沿用已有机制。操作失败保留表单编辑内容，便于修正；成功或无变化时显示中文状态并清空表单。
5. **浏览器回归**：扩展现有 Chrome/Edge CDP Studio 验收脚本，以 pnpm run test:tags:browser 依次测试 Vue/React：创建 Tag、修改元数据、阻止删除被引用 Tag、删除未引用 Tag，并从实际导出 JSON 核对结果。脚本与其它本地浏览器回归统一读取根 .env 的开发端口，避免误连旧服务。

## 安全与兼容边界

- 不改动 ScadaDocument 0.3.0、TagValue、TagStore 质量规则、Dexie 数据库版本、历史快照容器格式或 NestJS API。
- 不新增 PLC/DCS、OPC UA/Modbus/MQTT 地址映射、设备写入、数据源配置、权限配置和工业网关连接。
- 不提供 Tag ID 批量重命名、级联解绑、类型推断或单位转换；这些行为需要另行需求和安全评审。
- 旧版 0.1.0/0.2.0 工程仍须经第三十批显式迁移进入当前文档；确认历史 unknown 数据类型后才可作为新绑定候选。

## 验收清单

- pnpm run test:unit
- vp check
- pnpm run docs:check
- pnpm run ready
- 启动当前分支 dev:demo、dev:react 和 dev:vue 后执行 pnpm run test:tags:browser
- 执行 pnpm run test:interop 检查双框架工程格式

额外人工核对：Vue/React 表单可视布局、Tab/键盘访问、未知类型的编辑确认、不兼容类型或重复 ID 的中文错误、已绑定 Tag 删除保护、撤销重做、草稿保存和双框架工程 JSON 往返。

**当前状态**：本批代码、文档和自动化入口已提交开发分支，但本协作环境没有可访问的完整 Windows Vite+ 浏览器运行环境；上述命令未针对本批执行，不能宣称测试已通过。未经维护者明确授权，不合并 Draft PR。
