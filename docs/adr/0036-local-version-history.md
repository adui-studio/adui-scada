# ADR-0036：IndexedDB 本地工程历史版本仓储与修订号并发控制

- 状态：Proposed
- 日期：2026-11-11
- 关联需求：FR-002、FR-008、FR-013、NFR-004、NFR-006
- 依赖：[ADR-0021](0021-indexeddb-dexie-storage.md)、[ADR-0035](0035-project-validation-snapshot.md)

## 背景

V0.3 第二批已有共享 Core 的严格工程校验和 SHA-256 不可变快照，但没有历史版本仓储、稳定修订号或版本列表。现有 Dexie 草稿数据库只保存可覆盖的最新草稿，不适合作为不可覆盖的历史库；尚未建设 NestJS 正式工程服务、RBAC、审计与数据库事务模型。此阶段先验证浏览器本地、按工程隔离的历史存储和并发约束，为后续受控服务端仓储提供可迁移的数据契约。

## 决策

1. **独立版本仓储。** 在现有 `@adui/scada-draft-storage` 包新增 `DexieProjectVersionRepository`，但使用独立默认数据库 `adui-scada-studio-versions`。这样完全不迁移或修改现有 `adui-scada-studio` 的 `drafts/migrations`；正式项目发布版本不能依赖该浏览器数据库。
2. **框架无关接口。** `@adui/scada-core` 增加 `ProjectVersionRepository`（`getHeadRevision/append/get/list`）及只含 `projectId/revision/createdAt/contentHash` 的历史摘要，Vue/React 可以共享接口但本批不接入 UI。
3. **只追加快照。** `versions` 使用复合主键 `[projectId+revision]`，`heads` 使用 `projectId` 记录最后一次成功修订号。没有修改、删除旧历史和回滚指针操作；每个工程从修订号 1 开始，后续严格递增，完整内容由 ADR-0035 的 `createProjectSnapshot/readProjectSnapshot` 校验。
4. **乐观并发原子事务。** 调用 `append(source,expectedRevision,createdAt?)` 时，`expectedRevision=null` 表示调用方确认该工程尚无版本。先读取并验证 head，计算下一个修订号与 SHA-256 快照；**WebCrypto 异步计算必须发生在 IndexedDB 事务外**。随后一个 Dexie `rw` 事务中重新读取 head、比较预期修订号、用 `add` 写入新版本并更新 head；版本过期抛出 `ProjectVersionConflictError`。该事务保证同一 IndexedDB 数据库的提交原子性，不能作为跨 Origin 或多机服务器锁。
5. **历史查询。** `get(projectId,revision)` 查询并重新校验 SHA-256，返回独立冻结副本；`list(projectId,{limit?,beforeRevision?})` 通过复合主键倒序读取，`limit` 为 1～100、缺省 20，`beforeRevision` 严格排除边界。列表也验证每份快照，仅返回摘要，不返回文档大对象。
6. **安全约束。** 错误工程 ID、Schema、修订号、日期、快照摘要和数据损坏均拒绝，不创建不完整历史。不同 `projectId` 隔离；完整快照的容量限制仍为 ADR-0035 的 2 MiB。没有导入不可信旧历史，也不在浏览器数据库中保存设备密码、凭据或生产工业连接信息。
7. **持久化边界。** 这是单浏览器、单 Origin 的 IndexedDB 本地历史，可被清除、受浏览器配额约束，不保证备份和跨端同步。不能把 `head` 视为正式发布指针，不能由 Runtime 直接加载，也不等价于 PostgreSQL 正式版本库。未来 NestJS 服务端仍需独立的角色权限、持久事务、审计、发布审批、生产只读快照与回滚机制。

## 验收

新增 `packages/draft-storage/test/indexeddb-version.test.ts` 的 13 项用例，覆盖：首次追加、追加不覆盖、数据库重开、工程隔离、倒序分页、跨实例首次创建及更新冲突、过期写入、非法输入、返回快照冻结、底层版本内容被篡改和 head 指向缺失快照。继续执行完整 `pnpm run ready` 和 React/Vue 既有回归检查。

当前 ADR 为 Proposed。新增测试与整仓 Vite+ 检查还需要维护者在 Windows 运行并反馈，未经通过不合并 `main`。
