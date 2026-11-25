# ADR-0072：Prisma 8 迁移接管前的历史与原生约束保留评审

- 状态：Proposed
- 日期：2026-11-25
- 关联需求：FR-001、FR-008、FR-013、FR-014、NFR-004、NFR-006
- 依赖：[ADR-0042](0042-postgresql-prisma-foundation.md)、[ADR-0043](0043-prisma-project-transaction-store.md)、[ADR-0069](0069-release-pointer-atomic-publication-design.md)

## 背景与当前事实

Prisma 7.10.1 仍是唯一迁移执行者；Prisma 8 CLI 8.0.0-rc.35、PostgreSQL ORM 8.0.0-rc.25 与生成 Contract 已隔离引入，历史、工程、发布、身份会话、OIDC 和 ACL 数据访问候选已完成分批隔离验收。当前 Prisma 8 配置没有数据库连接，根 CLI 包装器仅允许 Skills 同步、列表和离线 Contract emit。尚未接管生产 NestJS Provider。

仓库现有八项 Prisma 7 迁移、十二张业务表、八十五个物理字段、十二个主键、十三个外键、三十六个 CHECK 和二十个非主键索引。当前生成 Contract 的存储哈希为 `054113c40b1e6f3b7609641e09868e45c0e969d8035e6e1376d10ac3e5148424`。这些数量由当前历史 SQL 和生成产物静态提取，不代表本机实际数据库已经重新核对。

## 已确认的表达差异

1. 原生 SQL 的三十六个 CHECK 不在当前生成的表级 Contract 表达中。包括修订号与批次序列范围、摘要格式、身份状态、会话时效、OIDC 绑定、ACL 白名单、发布事件和状态生命周期、历史归档边界。
2. 历史迁移 `20261119000000_release_state_event_integrity` 的 `scada_project_release_state_last_event_fkey` 使用六字段复合引用：租户、工程、发布代次、目标修订、目标摘要及最后事件 ID 对应事件表六字段。生成 Contract 只表达 `last_release_event_id → event_id`。该差异源于现有 Prisma 模型可空关联的表达边界，不能将简化关联用于替换更强的数据库约束。
3. 原生 SQL 的中文表、列和索引注释，以及默认表达式、索引细节与其他目录元数据需要独立保留和比对。生成 Contract 的存储哈希不是这些原生约束完整性的证明。

## 建议分阶段执行（待维护者评审）

A. 本批实施只读预检：不加载根 .env，不回退业务 URL，只接受显式本机 15432/adui_scada_test 目标；连接默认只读并开启 REPEATABLE READ READ ONLY。核对实际数据库和 public Schema、Prisma 7 登记、每份 LF 原文 SHA-256、完成/回滚状态、Prisma 8 标记/命名空间是否存在、物理表和字段形状、已验证约束、实际六项 ACL 表达式、完整外键列和动作、非主键索引及中文注释。生成实际目录指纹，最终 ROLLBACK 并关闭连接。不读取工程、身份、令牌或历史业务行。未知标记、重复/失败历史、缺失/弱化关键约束均拒绝；即使通过也返回 REVIEW_REQUIRED，签名许可始终为否。

B. 另批审查固定版本 Prisma 8 的签名及基线工具实际行为，先明确 PostgreSQL 原生 CHECK、六字段外键、注释、默认表达式及索引保留策略。通过独立全新隔离库重放已锁定历史迁移作为参考；用同一 PostgreSQL 主版本与查询上下文比对完整目录定义，不以预检的名称/类型/数量检查或目录哈希单独替代完整语义审查。不得自动建立、重置或删除数据库，写入及夹具范围须另行授权。

C. 仅在 B 的方案和隔离目标得到明确批准后，按固定版本包内 Skills 的 brownfield 流程评估签名与生成正式基线。官方流程涉及 Contract emit、db sign、migration plan、db verify；签名会写入数据库标记，默认还可能写入本地 ref 和快照，计划会写入迁移包。必须审查每个生成操作以及新库基线重放，证明不会弱化任何历史约束或丢失中文注释；基线 SQL 与真实负向约束回归均通过后才可以讨论迁移唯一所有权切换。此处不批准任何签名、命令执行或数据库写入。

D. 正式切换单独评审：备份恢复演练、迁移所有权唯一性、NestJS Provider 及两版接口一致性、全部真实数据库回归、完整质量链与发布安全门禁。保留旧历史文件和 `_prisma_migrations` 证据；退役旧工具入口不等于删除历史。未经明确审批禁止删除历史迁移、重写标记、绕过迁移策略、重置数据库、对现有开发/生产库签名或部署。

## 验收边界

本批仅定义只读预检及九项离线测试，不新增 DDL、Contract、迁移包、生产 Provider、依赖或设备写入功能。真实数据库预检须由维护者对现有隔离库显式执行，尚未获得本批实际日志。普通 CHECK 完整表达式、默认表达式和索引排序等细节记录于目录指纹，尚未与独立参考库逐项比对；本批不是 Prisma 8 官方 db verify、生产签名或迁移接管许可。正式发布安全门禁继续 fail-closed。

## 2026-11-25 · 阶段 A 验收与阶段 B 原生约束保留策略候选

阶段 A 已在维护者 Windows 通过九项离线测试、真实 PostgreSQL 只读预检（退出码 0）及增量质量检查，PR #210 已合入集成分支。验收库目录指纹 `73079d85974ddc9cbabf59741f2a4a94dd7bfff3d70a23bab27a7283456e8c52`；标记不存在，UTC，签名许可否。此证据只针对当时所查目录，不证明所有 PostgreSQL 对象或迁移基线等价性。

根据仓库固定 `@prisma/orm-postgres` 8.0.0-rc.25 包内 [Contract 参考](../../.agents/skills/prisma-8/references/contract.md) 与 [迁移参考](../../.agents/skills/prisma-8/references/migrations.md)，现有 prisma7Schema 转换仍是过渡输入，不能将当前缺失的 CHECK 当成 Prisma 8 不支持。原生候选应优先评估独立 PSL Contract 的 ``@@check(expression: sql`…`, map: "原物理约束名")``（或固定版本 TS builder 等价表达），采用 PostgreSQL 自身重打印的谓词，而非自行改变括号、类型转换、逻辑或命名。map 模式按原名及表达式字节比较，官方包文档明确会提示 PN_EXACT_NAME_BODY_COMPARISON；保留并审核，不以忽略告警掩盖实际差异。候选 Contract 必须验证全部三十六项名称/谓词、六字段末次发布复合外键及关联可空性、目标唯一约束、RESTRICT/CASCADE、运行时根与关系类型兼容。若 PSL 或 builder 无法原生表达，须验证固定版本支持的扩展/DDL 操作与 verifier、后续 planner 保留机制；单次 rawSql 恢复约束不足以证明未来计划不会删除它。中文表/列/索引注释必须按精确目录定义保留。不得修改已生成 Contract JSON、伪造哈希或将临时单字段外键替代历史六字段约束。

本批新增两个隔离库的只读目录对照，以已经独立重放八项 Prisma 7 迁移的 `adui_scada_fresh_prisma8_ref` 为参考候选，原 `adui_scada_test` 为实际验收库。每库独立读取同一预检 SQL；先验证历史、标记、物理结构及关键约束，再核对相同版本与查询上下文，逐项比较已采集表、列、CHECK/主外键、非主键索引及中文注释完整目录行，最后核对指纹。参考库必须有明确批准的创建与重放证据，且对照期间无并发 DDL；本工具不会自行创建、迁移或判定库是如何创建的。目录未覆盖的主键索引底层属性、触发器、RLS/权限、其他对象与未来规划/部署行为仍须另行审计；即使目录匹配也只返回 MATCHED_REVIEW_REQUIRED。当前不执行 contract infer、db verify、db sign、migration plan 或任何 DDL；候选 Contract 原生表达与新基线生成留待后续评审批准，ADR 状态仍为 Proposed。

## 2026-11-25 · 阶段 B 只读对照工具验收与独立历史重放门禁

PR #211 的十五项离线测试及原隔离验收库真实只读预检回归均已通过 Windows 增量验收；验收库目录指纹 `73079d85974ddc9cbabf59741f2a4a94dd7bfff3d70a23bab27a7283456e8c52` 与 PR #210 一致。PR #211 已按维护者授权 Squash 合入集成分支 `ce8c1fefe1a3a8bcd56fb42f30274cdd6109d97d`。此处不声称真实双库目录已完成对照。

新批提供独立参考库重放候选：只接受明确确认的、本机 127.0.0.1:15432、由维护者手工建立的 adui_scada_fresh_prisma8_ref 空库；使用独立 Prisma 7 配置，不加载根 .env，不回退业务连接，固定 Prisma 7.10.1 和已验收指纹/契约。空库只读检查拒绝已有用户对象及其他连接；首次和二次仅允许固定 deploy/status，分别执行双库目录对照及迁移登记稳定性比较。所有写入仅限独立参考库历史 SQL 和 Prisma 7 自管理登记，现有验收库只读。空库检查并非全对象证明或跨 CLI 排他锁，维护者必须确认来源及无并发 DDL/连接；脚本不创建、重置或删除数据库，也不自动恢复或重试。真实重放尚待维护者执行；即使匹配也只为后续原生 Contract 候选提供参考证据，不批准 Prisma 8 签名、基线生成或接管。ADR 仍为 Proposed。
