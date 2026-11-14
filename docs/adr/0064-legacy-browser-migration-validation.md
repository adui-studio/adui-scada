# ADR-0064：旧版工程、浏览器草稿与历史快照的真实浏览器迁移验收

- 状态：Proposed
- 日期：2026-11-14
- 关联：FR-002、FR-004、FR-006、FR-013、NFR-002、NFR-004
- 前置：[ADR-0062](0062-project-tag-definitions-schema-030.md)、[ADR-0063](0063-studio-tag-management-dual-framework.md)

## 背景

第三十批已将工程 Schema 升级到 0.3.0，并为 0.1.0/0.2.0 工程提供显式迁移。旧 localStorage 草稿、已有 IndexedDB 草稿以及 Project Snapshot 也具备各自迁移逻辑；Core 和 Dexie 单元测试已覆盖关键边界。但真实浏览器的持久化、页面启动读取、UI 恢复、IndexedDB revision 推进和历史快照只读归一化尚未形成一条端到端回归。

第三十一批已完成 Vue/React 项目 Tag 可视化 CRUD。需要验证历史工程进入两套 Studio 后，未知类型不会被猜测、旧绑定不丢失，且旧持久化记录按既有事务与摘要契约迁移。

## 决策

1. **仅扩展现有浏览器验收设施**：在 scripts/test-studio-browser.mjs 增加 --legacy 模式，并新增 pnpm run test:legacy:browser。复用当前 Chrome/Edge CDP 会话、根 .env 端口和现有 Studio UI 操作，不新增测试专用应用 API。
2. **localStorage 草稿路径**：真实写入原格式 { formatVersion: 1, savedAt, document }，其中工程为 0.2.0 且不包含根 tags；刷新 Studio 后等待现有 DexieDraftRepository.get 迁移，验证旧副本只在 IndexedDB 事务提交后清理，Tag 生成 unknown 占位且原绑定保持，再通过 UI 的“恢复草稿”载入并导出核对。
3. **已有 IndexedDB 草稿路径**：使用真实数据库 adui-scada-studio 的既有 drafts/migrations stores，写入 0.2.0 历史记录和原 revision 4；重新启动 Studio，验证事务升级到 0.3.0、revision 推进到 5、Tag 类型为 unknown、绑定不变，并通过 UI 恢复。
4. **Project Snapshot 路径**：使用真实数据库 adui-scada-studio-versions 的既有 heads/versions stores，构造包含 0.2.0 工程的 formatVersion 1 历史快照，并按 Core stableValue 规范计算原 SHA-256。通过 Studio 版本历史载入，验证返回的工程副本迁移到 0.3.0、Tag 为 unknown、绑定保留；随后重新读取 IndexedDB 原记录，确认原 Schema 与原摘要没有被改写。
5. **双框架对等**：React 和 Vue 分别执行上述三条迁移路径，使用不同 Origin 的隔离存储；结果均从真实 UI 导出 JSON 并核对，不允许用模拟内存对象代替浏览器持久化。
6. **失败即停止**：旧记录损坏、摘要不匹配、迁移失败或旧备份清理时序不符合契约，测试必须失败并保留可诊断错误；不得为通过测试而跳过 SHA-256 校验、降低 Schema 校验或静默清除历史数据。

## 安全与兼容边界

- 不更改 Schema 0.3.0、LocalDraft 格式版本 1、Dexie 数据库版本 1、Project Snapshot 容器 formatVersion 1、Core 迁移策略或工业协议。
- 历史 Tag 类型继续使用 unknown，不推断 number/boolean/string 或单位。
- 测试仅在 Chrome/Edge 临时用户目录和本机开发服务执行，不连接生产数据库、PLC/DCS、工业网关或现场设备。
- 不清理用户真实浏览器 Profile；所有旧记录只写入脚本启动的隔离浏览器 Profile。

## 验收

- pnpm run test:legacy:browser：React/Vue 均完成 localStorage、IndexedDB 草稿与 Project Snapshot 迁移。
- pnpm run test:interop：双框架工程 JSON 互通。
- vp check、pnpm run docs:check、pnpm run ready。
- 人工检查失败时的原记录保留、unknown 提示、Tag 管理 UI 与历史恢复提示。

**当前状态**：浏览器测试入口与用例已提交开发分支，尚未在维护者 Windows 环境运行。所有验收项保持待验证；本批不修改迁移业务实现。未经维护者明确授权，Draft PR 不合并。
