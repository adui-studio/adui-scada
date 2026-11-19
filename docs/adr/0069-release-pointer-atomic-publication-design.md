# ADR-0069：工程正式发布指针、事务审计与回滚安全边界

- 状态：Accepted
- 日期：2026-11-18
- 关联需求：FR-007、FR-008、FR-013、FR-014、FR-016、NFR-002、NFR-003、NFR-004、NFR-006
- 前置：[ADR-0035](0035-project-validation-snapshot.md)、[ADR-0041](0041-project-persistence-access-model.md)、[ADR-0043](0043-prisma-project-transaction-store.md)、[ADR-0045](0045-trusted-session-and-project-guard.md)、[ADR-0065](0065-oidc-bff-and-project-api.md)
- 与当前代码关系：**本 ADR 已获维护者明确批准；B/C1 已合并，D1 候选新增独立 `release:read` ACL 和当前发布快照只读 API，仍待真实 PostgreSQL 与 Windows 验收。生产发布门禁继续 fail-closed；共享 Runtime Core、React/Vue 接入、回滚和设备操作未开放。**

## 1. 背景与已验证事实

当前 `ScadaProject.headRevision` 表示**已保存的最新编辑版本水位**，`ScadaProjectVersion` 为不可变 SHA-256 快照，`ScadaProjectAudit` 只记录成功保存版本，数据库中**没有正式发布指针**。`ProjectAccessAction` 当前仅允许 `project:read`、`version:read`、`version:append`，没有发布或回滚权限。浏览器工程草稿和本地历史属于编辑态，不能成为运行时的发布依据。

第三十五批现有 `GET /api/v1/projects/:projectId/versions/:revision/release-preflight` 只对**当前已保存 head** 检查可信会话、`version:read` ACL、水位、快照完整性和 Core SVG 静态兼容性；它无任何发布副作用，也没有生产数据源和工业安全许可。其结果随版本、ACL 和运行环境变化而失效，不能当作后续事务的免检凭据。

目标是先界定不可变已发布内容、可审计原子切换和明确回滚语义，供独立架构与工业安全评审。**本 ADR 不改变当前任何运行行为。**

## 2. 术语与不变量

- **编辑 head**：`ScadaProject.headRevision`，追加已保存工程版本时递增，不代表已发布。
- **已发布指针**：租户 + 工程下唯一的当前生产运行版本引用；未发布时不存在目标，不隐式回落到编辑 head 或内置 Demo。
- **发布代次**：`releaseGeneration`，每次成功切换指针严格加一；即使先发布 5、回滚到 3、再发布 5，代次也不同，从而识别 ABA。
- **发布事件**：不可变、只追加的指针切换事实；与指针变更在同一事务提交。
- **正式发布**：把**当前已保存 head 的完整性校验快照**设置为发布指针；不能直接发布未保存画布、草稿、客户端上传的正文或过期预检结果。
- **回滚**：将指针切换至本工程**曾成功正式发布**过、仍可验证的不可变快照；不修改 `headRevision`，不删除版本、撤销草稿或改写旧审计。
- **不变量**：任何鉴权、版本、快照、兼容性、设备只读策略或审计失败，当前发布指针与代次**完全不变**，不得出现只有指针没有事件或只有事件没有指针的已提交状态。

## 3. 批准的持久化方向（尚未实现）

批准独立于编辑主表采用两种关系的持久化方向。B 阶段已通过 PR #99 将对应 Prisma 模型、索引、外键和增量迁移合并至 main；已应用迁移保持不可变。

### 3.1 `ScadaProjectReleaseState`（每工程最多一条）

| 候选字段                | 约束或含义                                                               |
| ----------------------- | ------------------------------------------------------------------------ |
| `tenantId`、`projectId` | 复合主键；外键指向现有 `ScadaProject`，租户隔离                          |
| `releasedRevision`      | 正安全整数、可空；空表示未发布，引用不可变版本                           |
| `releasedContentHash`   | 可空、与 `releasedRevision` 同时为空或同时存在；来自服务端实际已验证快照 |
| `releaseGeneration`     | 初始 0；仅成功发布或回滚时 +1，必须防溢出                                |
| `lastReleaseEventId`    | 可空；指向与当前指针状态对应的已提交发布事件                             |
| `updatedAt`             | 数据库时间；仅诊断展示，不参与版本 CAS                                   |

`ScadaProject.headRevision` 与 `releaseGeneration` **是两个独立并发水位**。运行时读取只能由发布指针选择快照，不允许从 head 推断或使用任意列表尾项。

### 3.2 `ScadaProjectReleaseEvent`（仅追加）

记录 `eventId`、`tenantId/projectId`、`generation`、`action`（候选 `PUBLISH` / `ROLLBACK`）、`fromRevision/fromContentHash`、`toRevision/toContentHash`、可信 `actorId`、服务端 `createdAt`、受控幂等标识及请求语义摘要。应以数据库约束保证同一工程同一代次最多一条，且外键指向**已存在、不可变**的工程历史版本；不能以 JSON 自由文本或客户端提交的 `actorId` 当作审计事实。幂等键不得包含 Token、Cookie、工程正文或设备地址。

业务版本的旧 `ScadaProjectAudit` **不应重命名或复用为发布事件**，以免保存版本被误统计为生产发布。失败请求只输出经过脱敏的固定安全诊断；是否引入持久失败审计、保留期及合规策略，留待专项审查。

## 4. 批准的身份、授权和 HTTP 契约方向（均未开放）

- 所有正式发布与回滚请求必须经可信 OIDC/BFF 会话、同源 Origin/Fetch Metadata/CSRF 和**独立发布权限**。批准新增明确的工程级 `release:publish` 与 `release:rollback` 授权动作；**不从 `version:append`、`version:read`、租户 ID、邮箱、OIDC Groups 或前端角色自动继承**，默认拒绝。具体权限存储与管理实现留待 B 阶段。
- 发布命令 `POST /api/v1/projects/:projectId/releases` 已由 C1 实现并合并；其生产安全门禁仍 fail-closed，当前真实应用请求返回 503。回滚命令 `POST /api/v1/projects/:projectId/releases/rollback` 与只读当前发布快照 `GET /api/v1/projects/:projectId/releases/current` 尚未实现，进入各阶段前仍须形成完整 HTTP 契约与测试。
- 发布命令至少需要受控的 `expectedHeadRevision`、`expectedReleaseGeneration`、`targetRevision`、幂等标识；**请求不得包含快照正文、可信主体、租户或最终 hash 的权威来源**。回滚命令不依赖当前编辑 head，却必须校验预期发布代次及历史真实已发布目标。
- 成功返回须区分已保存 head、当前已发布修订、发布代次和事件标识。409 表示版本/代次 CAS 冲突或同一幂等标识与不同语义冲突；未授权与不存在统一不泄露目标工程。缓存须显式禁止，未知错误不得泄露快照/凭据/数据源。

## 5. 批准的发布与回滚原子事务顺序

### 5.1 发布

1. **进入写事务前**验证输入形状、可信主体及可用服务状态；这些验证不能替代事务内复核。
2. **事务内按固定顺序锁定工程与发布状态行**（例如 `FOR UPDATE`，必要时先建立受控状态行），避免同工程发布、回滚和追加版本的锁顺序反转。具体 SQL/Prisma 锁实现需另行验证。
3. 在锁内重新验证活动会话映射、当前主体 `release:publish` 工程 ACL、当前 `headRevision === expectedHeadRevision === targetRevision`、`releaseGeneration === expectedReleaseGeneration`，并复核幂等请求是否已提交；无权优先于敏感版本状态返回。
4. 从数据库读取对应**不可变已保存快照**，调用 `readProjectSnapshot` 复算 SHA-256、比对版本/时间/存储列，重新调用 `validateProjectReleasePreflight`；不能信任先前 GET 报告或由客户端发送的 `passed`。正式发布还需独立的 Runtime 资源、Tag 绑定、生产数据源和安全政策审核，**当前这些门禁未实现，因此不得真正提交发布事务**。
5. 同一事务内仅在所有门禁明确通过后写入唯一发布事件、更新发布指针及严格递增代次；若任一步失败、事务超时、数据库故障或并发冲突，整体回滚并保留之前发布版本。
6. 事务提交后运行时可通过独立**只读**发布快照路由加载；不能把发布中间态、编辑 head 或异常空文档当作 `Released`。

### 5.2 回滚

1. 与发布相同的可信会话、CSRF、事务锁与代次 CAS；需要独立的 `release:rollback` 工程 ACL。
2. 目标必须是**本工程历史上已成功发布过**且仍存在并通过完整性校验的快照；不能任意指向未发布草稿、已保存但未发布版本、跨租户工程或不兼容版本。
3. 重新检查运行时兼容性与适用安全规则；因设备数据源、运行引擎或资源已经变化而不安全时必须拒绝，不得因为“曾发布”而自动通过。
4. 在同一事务只追加 `ROLLBACK` 事件并切换发布指针/代次；编辑 head、版本列表、草稿、旧事件和审计保持不变。没有可回滚的既有发布版本时显式拒绝。

### 5.3 并发和重试

- 同一工程的发布、回滚、版本追加必须具有确定的锁顺序。需要真实 PostgreSQL 双会话故障注入验证无死锁、无丢代次、无半写状态。
- 依靠 **`expectedReleaseGeneration` + 幂等标识**：网络迟到响应或同标识同语义重试不得追加第二个事件；同标识不同语义必须拒绝。对“不同幂等标识却选择同一版本”的期望（拒绝、无事件幂等或允许新事件）必须在协议评审中明确，不猜测。
- 一次真正回滚后再回到原修订的 ABA 场景必须因代次改变而让旧预期请求失败。客户端不应在 409 后静默自动重发写命令。

## 6. Runtime 与故障行为

Runtime 只从服务端受保护的当前发布指针解析快照；不可使用编辑缓存或任意用户草稿替代。需要定义运行时读者权限、断线时的已验证快照保留策略、版本切换原子可见性及多实例缓存失效机制。未发布、已发布快照丢失/摘要错误、Schema 不兼容、Tag 来源不可用、质量 `BAD/STALE` 时必须显示受控且可区分的状态，不能把旧数据伪装正常，也不能擅自触发控制写入。

本 ADR 不决定发布是否自动刷新所有运行画面、发布后的资源热切换顺序或历史趋势迁移。这些必须先在测试/沙箱环境做只读 Runtime 端到端验证。

## 7. 分批实施与验收门禁

| 阶段                 | 预期内容                                                                           | 必须实测的门禁                                                     |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A · 本 ADR           | 定义租户/工程发布指针、代次、ACL、原子事务及失败边界                               | 文档静态检查；评审设计冲突与未决事项                               |
| B · 权限与 Schema    | 通过评审后增量 Prisma 模型/迁移、中文表列索引注释、默认拒绝发布权限                | 隔离 PostgreSQL **首次/二次迁移**、权限和租户隔离、无生产连接      |
| C · 发布事务         | 服务端发布命令、幂等、锁内权限及静态/工业安全门禁                                  | 真实 DB 并发、故障回滚、旧请求/撤权/非法快照拒绝、日志脱敏         |
| D · 只读发布 Runtime | D1 服务端独立 `release:read` 与只读快照 API；后续共享 Runtime Core、React/Vue 接入 | 隔离 PostgreSQL 权限/摘要/租户测试，真实 TLS + OIDC 双框架运行验收 |
| E · 回滚事务         | 仅选择曾发布版本，独立权限和新代次事件                                             | 旧指针不变、跨租户拒绝、ABA/并发回滚、实际版本切换一致性           |
| F · 生产安全评审     | 数据源授权、实际资源和工业现场运行边界                                             | 专项审批与现场只读安全审查，**不包含 PLC/DCS 写入许可**            |

每阶段在独立 Draft PR 中维护测试证据及 `AGENTS.md` / `docs/AI_MISTAKES.md` 约束。**当前进度：A 已批准；B 已完成；C1 发布事务已完成并通过真实 PostgreSQL/完整质量链验收；C 的工业安全门禁仍 fail-closed；D1 服务端读取基础设施已在候选分支实现、等待专项验收；共享 Runtime Core、React/Vue 接入、E、F 尚未开始。** Accepted 不代表 FR-008 全部完成。

**评审入口**：另见 [正式发布事务评审决策与验收矩阵](../RELEASE_TRANSACTION_REVIEW.md)。该清单将本 ADR 未决内容拆分为 R-01～R-08 和未来 T-01～T-22 负向场景，方便维护者逐项批准、修改或驳回。**本 ADR 现为 Accepted；附加评审矩阵记录了本次批准的 R-01～R-08 基线。Accepted 不等于生产发布写入授权，也不改变设备写入仍需独立工业安全审批的边界。**

## 8. 已批准的决策边界

维护者于 **2026-11-18** 明确批准本 ADR 进入 **Accepted**，并批准评审矩阵中的 **R-01～R-08 推荐基线**。该批准只确认架构与安全边界，不代表对应代码、数据库、API 或 Runtime 已实现。

1. **发布/回滚权限**：采用独立工程级 `release:publish` 与 `release:rollback`，默认拒绝，不从编辑、读取权限或 OIDC Groups 自动继承。
2. **生产审批**：V0.3 先在隔离 Lab 完成设计与验证；生产启用前必须明确审批责任和双人复核方案。在双人审批方案完成前不开放生产发布。
3. **首次发布版本**：只能针对事务内重新验证的当前已保存 head；使用 `expectedHeadRevision`、`targetRevision` 和 `expectedReleaseGeneration`，正文与权威 hash 均由服务端读取。
4. **幂等与冲突**：幂等键按租户/工程/操作主体/操作类型隔离；同键同语义重试复用已提交结果，同键不同语义返回受控冲突；不得写入 Token、Cookie、工程正文或设备地址。
5. **回滚范围**：只能回滚到本工程历史上成功正式发布、仍可验证的不可变版本；回滚必须重新执行当前适用安全门禁并产生新的发布代次。
6. **Runtime**：只认独立发布指针；事务提交前不可见；发布版本不可用时 fail-closed，不回落到编辑 head、浏览器草稿或模拟正常数据。
7. **事务与审计**：成功发布/回滚事件、发布指针与 `releaseGeneration` 在同一 PostgreSQL 事务中原子提交；任何门禁、并发、数据库或审计失败均保持旧发布状态。
8. **工业安全**：发布前必须重新核对 Tag 绑定、数据源质量、Runtime/资源兼容性和只读工业策略；本 ADR 不授予任何 PLC/DCS 或其他设备控制写入权限。

**后续 B～F 阶段仍必须分别通过 Prisma 数据模型/迁移、真实 PostgreSQL 并发故障注入、React/Vue Runtime、Keycloak/HTTPS 和工业安全专项验收后才能逐步实现。**

## 2026-11-19 · ADR-0069 B 阶段完成与 C1 发布事务候选状态

B 阶段发布状态/事件 Prisma Schema、独立发布权限和复合引用完整性已通过 PR #99 合并至 `main`（合并提交 `3ba7b2728ca345a5a2962e6815c5d76069ade822`）。

C1 当前在 PR #100 Draft 候选分支实现正式发布命令与事务：事务内锁定工程、会话/身份、ACL、发布状态和不可变版本；执行 head/releaseGeneration 双 CAS、UUID v4 幂等、快照完整性与静态兼容性检查；在同一事务追加发布事件并更新指针。生产 `ProjectReleaseSafetyGate` 固定 fail-closed，Runtime/Tag/数据源/资源/审批及工业安全门禁未完成前不允许真实发布成功。

维护者 Windows 已通过 C1 发布仓储定向测试 13/13、全量单测 633/633、`vp check` 零警告错误及 `docs:check` 89 份；真实 PostgreSQL `test:db` 与完整 `ready` 尚待执行。当前实现不代表 T-01～T-22 全部验收完成，也不开放 Runtime、回滚、生产发布或工业设备写入。

## 2026-11-19 · B/C1 实施状态与 D 阶段准入

B 阶段通过 PR #99 合并发布状态/事件 Prisma Schema、独立发布权限动作和复合引用完整性。C1 通过 PR #100 合并 `POST /api/v1/projects/:projectId/releases` 与事务实现：锁内复核可信会话、主体、ACL、head/releaseGeneration 双 CAS、幂等和不可变快照；发布事件与发布指针同事务提交。维护者 Windows 最终验收 PostgreSQL 6/6 文件、52/52 用例，单测 633/633、HTTP E2E 59/59、`vp check`、`docs:check` 及完整 `ready` 均通过。PR #100 合并提交为 `8db55e4b1bb97d69c08dc9238eb61f76071b7e72`。

生产 `ProjectReleaseSafetyGate` 仍默认拒绝，真实应用发布请求返回 503；这不是生产发布授权。当前没有回滚路由；当前发布快照读取路由仅存在于 D1 候选分支，尚未合并或完成真实数据库验收。

D 阶段只读 Runtime 的读取权限已获维护者批准：新增独立工程 ACL `release:read`，默认拒绝，不从 `project:read`、`version:read` 或其他权限继承。D1 候选在 `ProjectAccessAction` 中加入该动作，并提供 `GET /api/v1/projects/:projectId/releases/current`；读取事务仅锁定工程身份行，不查询 `head_revision`，并按工程、会话/主体、ACL、发布状态、不可变版本、最后事件顺序持有共享锁，校验发布状态、事件与快照 SHA-256。该候选尚待隔离 PostgreSQL、Windows 质量链和真实 OIDC/HTTPS 验收；共享 Runtime Core、React/Vue 接入及运行时 Tag 质量状态仍未交付。

## 2026-11-19 · 第三十五批 D1 服务端只读发布读取候选

D1 候选在 `ProjectAccessAction` 中新增独立 `release:read`，默认拒绝，不加入工程创建时的 `OWNER_PERMISSIONS`，不从 `project:read`、`version:read` 或 `release:publish` 继承。增量迁移 `20261119180000_release_read_permission` 仅扩展 `scada_project_grants_permission_check` 白名单并更新权限列中文注释，不自动授予任何既有主体，也不修改已应用迁移。

候选只读接口为 `GET /api/v1/projects/:projectId/releases/current`，使用可信 OIDC/BFF 会话、工程 Guard、独立 ACL 和 `Cache-Control: no-store`。未发布工程返回 `UNRELEASED`；已发布工程返回发布修订、摘要、代次、最后事件元数据和通过 `readProjectSnapshot` 校验的不可变快照。仓储事务只选择并共享锁定工程 `project_id`，**不查询 `head_revision`**；随后按工程、有效会话/主体、ACL、状态、不可变版本、最后发布事件的顺序持有共享锁，并核对最后发布事件与指针一致。权限缺失、租户不匹配、状态/事件不一致或快照摘要错误均 fail-closed。

本候选仅交付服务端只读读取基础设施，不包含 Runtime Core、SSE 数据源、动态 Tag 质量状态、React/Vue Runtime UI、回滚或生产发布许可。迁移、真实 PostgreSQL、单测、HTTP E2E、`vp check`、`docs:check` 和完整 `ready` 均待维护者在对应分支实测。
