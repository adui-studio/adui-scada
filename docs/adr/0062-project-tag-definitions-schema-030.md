# ADR-0062：项目级 Tag 定义持久化与 ScadaDocument 0.3.0 迁移

- 状态：Proposed
- 日期：2026-11-14
- 关联：FR-002、FR-004、FR-006、FR-013、NFR-002、NFR-004
- 前置：[ADR-0061](0061-tag-definition-catalog.md)、[ADR-0018](0018-schema-version-migration.md)、[ADR-0019](0019-local-draft-persistence.md)、[ADR-0035](0035-project-validation-snapshot.md)

## 背景

第二十九批已在 Core 建立稳定 Tag ID、显示名称、数据类型、单位和描述的 `TagDefinitionCatalog`，但定义仍来自代码常量，未随项目 JSON 持久化。用户导出、跨 Vue/React 交换、浏览器草稿恢复和历史工程快照无法完整携带项目自己的 Tag 元数据。

把目录独立保存在浏览器数据库会造成工程 JSON、版本快照和导入导出出现第二份事实来源。故项目 Tag 定义必须进入框架无关的 `ScadaDocument`，由既有严格 Parser、Editor Command、JSON、Dexie 草稿和 Project Snapshot 共用。

## 决策

1. **Schema 升级**：`SCADA_SCHEMA_VERSION` 从 `0.2.0` 升级为 `0.3.0`。根结构新增必填 `tags: TagDefinition[]`，放在 `projectId` 与 `pages` 之间；严格字段白名单继续生效，当前 0.3.0 工程缺少 tags 或存在未定义 Tag 绑定时拒绝解析。Tag ID 全工程唯一，定义数量上限 4096。
2. **定义结构**：复用 ADR-0061 的 `tagId/displayName/dataType/unit/description`。稳定 ID 不可重命名，显示名称可变。质量、实时值、时间戳和序列号仍只存在于 `TagValue`，不进入静态目录。目录不含设备地址、连接参数、凭据、采样周期或写入能力。
3. **历史迁移**：显式 `migrateScadaDocument` 同时支持 `0.1.0 → 0.3.0` 与 `0.2.0 → 0.3.0`；`parseScadaDocument` 只接受当前 0.3.0。历史工程没有类型/单位元数据，迁移器从现有图元绑定中收集 Tag ID，生成 `dataType: "unknown"`、`unit: null`、显示名称为原 ID 的占位定义，保留所有绑定，**不猜测数据类型或单位**。未来或未知 Schema 仍拒绝。
4. **待确认类型**：`unknown` 仅表示历史迁移占位或尚未确认类型。TagStore 对其允许标量值通过，避免旧工程数据因迁移被误判；Studio 的绑定候选不把 unknown 作为新绑定候选，维护者必须先明确设置真实类型。明确类型后继续执行 number/boolean/string 严格校验。
5. **绑定完整性**：当前 0.3.0 工程所有节点绑定必须引用目录中的 Tag。Tag 删除若仍有任一图元槽引用则拒绝；先解除绑定再删除。Tag 重命名只改 displayName，不改变稳定 tagId。共享 `DocumentEditor` 提供 add/update/remove 定义命令并纳入撤销/重做，稳定 ID 不能通过更新接口修改。
6. **实时运行**：DemoRuntime 加载项目文档后从该文档构建 TagDefinitionCatalog，再创建 TagStore；Tauri OfflineDemoRuntime 和独立水处理 SSE 服务使用同一演示工程目录。实时质量仍动态更新，类型不匹配沿用既有无效上游消息路径并关闭订阅。
7. **持久化路径**：工程 JSON 导入/导出自然包含 tags；IndexedDB 草稿与 Project Snapshot 保存完整当前工程。读取既有 0.1/0.2 草稿时进行受控迁移；已有 IndexedDB 草稿在同一事务内写回 0.3.0 并推进 revision，通知其他标签页。旧 localStorage 草稿在读取/开启自动保存会话时升级后写回。历史 Project Snapshot 先按原始文档验证原 SHA-256，再返回带 `sourceContentHash` / `migratedFrom` 的 0.3.0 归一化查看副本；不原地改写原始历史记录。
8. **框架对等**：Vue/React Studio 从 `state.document.tags` 读取绑定候选与目录展示，按共享槽位规则过滤类型；不再把代码常量当作工程 Tag 目录。当前批只展示项目目录与支持 Core 命令，完整 Tag 新增/编辑/删除 UI 交由下一批完成。
9. **不做的事**：不创建 Prisma 表、不新增后端保存 API、不升级 Dexie 数据库版本、不修改 Project Snapshot 容器格式、不增加 IndexedDB Tag 独立表、不实现 OPC UA NodeId/Modbus 寄存器/MQTT Topic、设备连接或设备写入。项目级 Tag 持久化是工程 Schema 能力，不等同于工业地址映射或生产 Tag 配置中心。

## 迁移与兼容性

- 0.3.0 是当前唯一可编辑/保存的工程 Schema。
- 0.1.0/0.2.0 只能通过显式迁移入口进入当前版本；旧版本客户端仍不能读取 0.3.0。
- 迁移占位定义不会丢失原绑定。类型 unknown 期间禁止作为新绑定候选；维护者确认后才能将其改为明确类型。
- 删除仍被引用的 Tag 必须失败，不执行隐式级联解绑。
- 当前 Project Snapshot 容器格式仍为 1；旧快照读取时校验原始摘要，再返回归一化视图，附带源摘要和迁移来源，避免篡改历史数据。
- Dexie 现有数据库版本不变；只迁移其存储的工程文档内容，并在事务内递增草稿 revision。

## 验收计划

```powershell
pnpm run test:unit
pnpm run test:runtime
pnpm run test:e2e:server
vp check
pnpm run docs:check
pnpm run ready

pnpm run test:sse:browser
pnpm run test:sse:fault:browser
```

重点覆盖 0.1/0.2 两级迁移、未知 Tag 类型占位、绑定完整性、稳定 ID、Tag CRUD 撤销重做、TagStore 原子类型拒绝、IndexedDB/LocalStorage 草稿迁移、Project Snapshot 原始摘要与迁移视图完整性，以及 Vue/React 工程 JSON 往返。

## 当前未完成

- 本批没有实现可视化 Tag 管理表单；UI 目前展示目录并按项目目录筛选绑定候选，下一批继续实现双框架 Tag 管理。
- 当前演示目录不含工业地址/协议映射、权限、采样周期和数据源配置。
- 项目级 Tag 定义虽然已进入 JSON/草稿/历史快照，但尚无正式服务端项目保存、认证、多人协作和发布 API。
- Windows `test:unit`、`test:runtime`、`vp check`、`docs:check`、`ready` 与双框架浏览器回归仍待维护者实际执行；不得沿用第二十九批结果。
