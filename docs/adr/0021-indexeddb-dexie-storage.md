# ADR-0021：以 Dexie.js 实现 IndexedDB 工程草稿仓储

- 状态：Proposed
- 日期：2026-11-10
- 关联需求：FR-002、FR-013、FR-016、NFR-004、NFR-006
- 参考：[ADR-0019](0019-local-draft-persistence.md)、[ADR-0020](0020-safe-local-autosave.md)
- 外部文档：https://dexie.org/docs/Dexie/Dexie.transaction()

## 决策背景与选型

前两批用 `localStorage` 完成手动保存/恢复和工程脏状态、防抖原型，但本地草稿规模、多个工程与标签页冲突保护不能长期依赖同步键值存储。2026-11-10 核对候选库：`idb@8.0.4` 作为 Promise 化 IndexedDB 薄封装非常轻量；`dexie@4.4.7` 提供类型化表、索引、数据库迁移与读写事务；`localForage` 偏异步键值层，难以承载未来工程历史版本等数据组织。综合长期离线工程需求，选择 **Dexie.js 4.4.7**（Apache-2.0），并在 pnpm Catalog 锁定；仅在测试环境引入 `fake-indexeddb@6.2.8`，避免 Vue/React 两端分别依赖数据库细节。

## 模块与职责

- 共享 `@adui/scada-core` 只提供 `DraftRepository`、`DraftRecord`、`DraftAutoSaveSession` 异步契约及受验证的 `ScadaDocument 0.2.0`；**不引入 Dexie、DOM、React、Vue**。
- 新增 `@adui/scada-draft-storage` 包，专门实现 `DexieDraftRepository`；浏览器数据表在 IndexedDB `adui-scada-studio`，数据库版本 `1`。`drafts` 表以 `projectId` 为主键，包含 `revision`、`savedAt`、`document`，并索引保存时间；`migrations` 记录历史草稿完成迁移或被用户清除的工程 ID。
- Vue/React Studio 依赖同一个仓储实现，但仍分别管理 UI 生命周期。人工保存/恢复/清除和按需自动保存均调用异步仓储。页面启动仅检测记录，仍**不自动恢复**；用户确认恢复时才调用原子 `DocumentEditor.loadDocument`。
- `DraftAutoSaveSession` 保持工程内容脏状态和 1000 ms 防抖约定，按提交顺序排队并使用版本条件保存；人工保存、导入、清除或恢复先等待会话已有写入停止，再执行事务，避免异步写入晚于清除操作。

## 事务与并发

1. `save(document, expectedRevision)` 先严格验证 Schema，再在 **同一个 Dexie `rw` 事务**内读取 `drafts[projectId]`，比较当前修订号与 `expectedRevision`，一致才递增 `revision` 并写入；冲突时拒绝，不覆盖较新的工程。
2. `remove(projectId, expectedRevision)` 同样执行事务条件删除，并写入 `migrations` 标记。成功后才通知其他页面。
3. `BroadcastChannel` 仅用于同一 Origin 的跨标签页即时状态通知；**事务中的修订号比较才是防止旧状态覆盖的权威校验**。浏览器不支持频道通知时，下一次写入仍会因版本冲突而失败。
4. 不在 IndexedDB 读写事务内等待网络请求、定时器或第三方异步操作，避免事务提前提交。数据库事务仅保证**同一浏览器 Origin 本地草稿**的版本条件写入，不等于服务端跨用户协作锁。

## 历史数据迁移与恢复安全

- 首次读取一个工程时，若 IndexedDB 尚无草稿、`migrations` 无标记，可检查旧 `adui-scada:studio:draft:<projectId>` localStorage 数据。旧记录必须先通过原草稿包裹层、工程 ID、Schema `0.2.0` 和 2 MiB 校验。
- 只有在 IndexedDB 的草稿+迁移标记同一事务**成功提交之后**，才尝试删除旧 localStorage 副本；若旧记录删除失败，仍保留迁移标记，防止删除 IndexedDB 草稿后旧备份再次自动出现。遇到损坏、不兼容或拒绝存储时保持当前 Editor，不自动清除旧记录。
- 已有 IndexedDB 草稿优先于历史副本；自动保存开启前仍要确认覆盖已有草稿。旧工程文件的 `0.1.0 → 0.2.0` 显式迁移继续由编辑器导入入口负责，不能绕过 Schema 校验。
- IndexedDB 同样可能受浏览器配额、清理站点数据、隐身模式或禁用存储影响。草稿不是正式工程发布、加密备份或长期可靠服务端持久化，重要工程仍需 JSON 文件备份。

## 本批未实现

不新增历史快照 API、资源 Blob 管理、正式工程服务端版本管理、权限、自动恢复、离线协作同步或工业控制写入。未来可基于新的仓储契约迭代 `projects`、`revisions` 与资源存储，但不能将表设计当作已有功能。

## 质量与验收

执行 Catalog/共享 TSConfig 检查、中文文案、格式/Lint、Core 和新浏览器存储包类型检查、Vitest+模拟 IndexedDB 测试、NestJS E2E、文档及三端构建。人工在 Vue/React 分别验证：既有 localStorage 草稿成功迁移、首次不自动覆盖、修改后自动保存、两个标签页并发写入修订号冲突、清除后旧副本不复活，以及异常数据/拒绝权限时不会污染当前工程。完整验证以维护者 Windows 实测为准。
