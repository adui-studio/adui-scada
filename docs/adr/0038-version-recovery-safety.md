# ADR-0038：历史版本恢复的自动保存与浏览器持久化安全验收

- 状态：Proposed
- 日期：2026-11-11
- 关联需求：FR-002、FR-008、FR-013、FR-016、NFR-004、NFR-006
- 依赖：[ADR-0021](0021-indexeddb-dexie-storage.md)、[ADR-0036](0036-local-version-history.md)、[ADR-0037](0037-studio-version-history-ui.md)

## 背景

V0.3 第四批已完成两端 Studio 的本地历史菜单，`test:versions` 验证过创建、比较、取消、确认载入；但并未针对正在自动保存的会话、浏览器刷新/Origin 隔离、IndexedDB 不可访问或异步 JSON 导入竞争进行专项回归。Core 的 `DraftAutoSaveSession.stop()` 本身已采用队列停写机制，缺口主要在双框架 UI 调用入口的互斥与端到端验收。

## 决策

1. **不引入新仓储或工程格式。** 保留 `ScadaDocument 0.2.0`、现有 Dexie 草稿/历史数据库和 WebCrypto SHA-256；本批只修复和验证恢复过程的可靠性，不新增正式发布接口或设备写入。
2. **异步导入互斥。** Vue/React 的 JSON 导入在开始等待 `file.text()` **之前**占用现有 `draftActionInProgress / draftActionRef` 门闩，并在 `finally` 中释放。历史版本操作在草稿/导入操作进行中不启动，以避免异步导入与历史恢复重叠。被拒绝的操作不得静默覆盖工程。
3. **自动保存停写。** 历史版本载入取消时不暂停自动保存，也不改变编辑内容；确认后先等待 `DraftAutoSaveSession.stop()` 处理已开始的数据库事务，再加载历史工程。恢复动作本身不覆盖已保存草稿。新增 Core 确定性测试，验证停写确实等待正在执行的异步保存，以及写入失败后队列仍可终止。
4. **隔离浏览器验收。** 新增 `pnpm run test:versions:safety`，沿用现有 Chrome/Edge 临时用户目录，分别通过真实 Vue/React 页面：创建历史、启用自动保存、修改工程并等到 IndexedDB 草稿落盘；取消/确认历史载入并比较当前工程和数据库记录；刷新页面重新查询历史；模拟历史数据库无法打开，确认显示中文错误且画面不变；解除故障后可继续追加历史；模拟异步 JSON 读取尚未结束时点击历史载入，确认互斥。最后重进 React，核对不同 Origin 的历史互不污染。
5. **测试数据安全。** 浏览器验收只使用启动脚本创建的临时 Chrome/Edge 配置目录，不清空真实用户站点存储；错误注入仅暂时覆盖当前隔离页面的 IndexedDB 打开方法并在 `finally` 恢复。测试失败应非零退出并保留明确中文诊断。
6. **真实环境边界。** 此测试模拟拒绝打开 IndexedDB，不能证明各浏览器存储配额、断电、浏览器沙盒、Tauri WebView2、跨设备备份或正式生产工程发布场景已经通过。自动保存与历史版本仍是当前 Origin 的浏览器本地能力。

## 验收

- `pnpm run ready`：新增 2 项 Core 自动保存会话边界测试（此前主分支 297 项，预计达到 299 项）；其余类型/Lint/E2E/文档/双 Web 与服务器构建保持通过。
- 同时启动 `pnpm run dev:react`、`pnpm run dev:vue` 后，执行 `pnpm run test:browser`、`pnpm run test:interop`、`pnpm run test:versions`、`pnpm run test:versions:safety`。
- 补充人工验证真实浏览器自动保存开启后的多标签页冲突、存储配额不足和 Tauri WebView2；这些边界不在本批自动化覆盖范围内。

**状态说明：** 本分支的浏览器脚本已通过离线 JS 语法解析与远端文件静态校验；Windows 上的真实 `ready`、新增 Vitest 与 Chrome/Edge 自动化尚未执行，不能标记为已通过。
