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

## 2026-11-25 · 独立历史重放验收与原生 PSL 候选

PR #212 已通过 Windows 27 项离线回归及真实独立参考库八项历史首次/二次部署、双库目录及迁移登记稳定性验证；双方目录指纹 `73079d85974ddc9cbabf59741f2a4a94dd7bfff3d70a23bab27a7283456e8c52`，MATCHED_REVIEW_REQUIRED、签名许可否。PR #212 按授权 Squash 合入 `e4afdd4040dca4ebcdfb3a1abfcdb6ff2b86a473`，保留参考库，不再重放。

本批采用独立原生 PSL 模板及已匹配目录的 CHECK 谓词填充。模板明确保留历史十二表、八十五列、十二主键、十三外键及二十非主键索引；唯一索引仍使用 @@index(..., unique: true, map: ...) 而非新增唯一约束，六字段末次事件 FK 以物理原名和完整列及动作表达。依据固定包内 Contract 参考及上游当前实现源码（仅辅助参考，不能替代固定 RC 实测），单值反向关系可能要求与 FK 完全相同的唯一列集；历史结构已有较小唯一键，不能因此增加冗余物理唯一约束或把正式一对一改为一对多。本物理优先候选暂不声明 ScadaProjectReleaseEvent.currentReleaseState 反向导航；正式过渡契约及关系不动。候选运行时元数据变化是明确阻塞，不因物理匹配消除。后续须评审固定版本 TS builder/PSL 能力及现有查询、类型、生成器实际兼容性。

候选生成时重新执行双库只读完整匹配，锁定已有目录指纹及正式存储哈希，提取 36 项普通 CHECK 定义内 PostgreSQL 原始重打印谓词并按原名填入原生 PSL；独立无数据库连接的固定配置只离线生成至根忽略目录，拒绝覆盖现有结果，不改生成 JSON 或正式生成物。生成 IR 与已审查基线核对所选物理结构和运行时元数据；物理一致不证明官方 schema verifier 或实际迁移 DDL、中文注释、RLS、触发器、权限等全部等价。此阶段还未运行真实固定 RC emit，也未执行官方 db verify、签名、基线生成或部署。ADR 保持 Proposed，Prisma 7 唯一正式迁移执行者。

## 2026-11-25 · 原生 PSL 实测结果与运行时兼容阻塞

PR #213 维护者 Windows 使用固定 Prisma 8 实际生成独立原生候选，并通过受检物理 IR 审查（36 个精确命名 CHECK、13 个外键含六字段末次事件、12 张表、85 字段、12 主键与 20 非主键索引），候选存储哈希 `6eec3e7459bdfa2646dc156bd6eaf22ffe60b0a0eac309622262b9742a0c68cc`，正式生成物不变，execution/profile 哈希相同。原名称 SQL 谓词的 PN_EXACT_NAME_BODY_COMPARISON 提示符合此前预期，尚未完成官方结构验证。实际返回 STORAGE_REVIEW_REQUIRED_RUNTIME_BLOCKED，报告 ScadaProjectReleaseEvent.currentReleaseState 及 ScadaProjectReleaseState.lastReleaseEvent 两个运行时关系差异，不能凭 executionHash 相同认定运行时等价；候选 d.ts 依赖可见性及独立配置 Skills 提示也待核验。E-142 排序警告最小修复及九项离线专项待 Windows 复验。候选及两隔离库均须保留，不修改正式 Contract、历史 SQL、Provider 或数据库，不批准签名、迁移规划或部署，后续需确认运行时关系兼容及官方结构验证、新基线 DDL 与全部约束和注释的等价性。ADR 状态仍为 Proposed。

## 2026-11-25 · 运行时兼容性离线评审候选

PR #213 已通过维护者 Windows 零警告增量验收并按授权合入 `4bada62a85fd099eb7a24857f66e2b411eb6a2bf`。当前十二个名称含 prisma8 的非测试服务端生产模块未发现两个关系名直接引用；发布仓储按租户/工程与 lastReleaseEventId 显式读取事件并校验代次、修订和摘要。此静态检查不证明动态调用或未来代码不会依赖导航。优先验证现有查询和类型，而非增加冗余唯一约束或将一对一改为一对多。

新离线探针仅接受已验收正式及候选哈希标识，并比较完整领域模型、根及执行信息，唯一允许差异为正向可空六字段关联和缺少事件反向单值导航。哈希标识检查不是内容真实性证明或目录复验。复用服务端已安装的 TypeScript 和现有 tsconfig，通过编译器内存 Host 将保留候选 JSON/d.ts 原文映射至正式生成物路径，分别执行正式基线和候选 noEmit 类型检查，确认编译器确实读取对应原文并解析服务端已有契约类型包。沿用现有类型检查配置（含 skipLibCheck），不声称单独验证第三方声明内部全部类型或真实数据库执行；正式与候选文件均不改写。独立配置补齐同样的根目录 Skills 设置，仅增加固定列表查询入口，不执行同步或关闭版本检查。即使双轮类型检查通过也保留 STORAGE_REVIEW_REQUIRED_RUNTIME_BLOCKED，仍需真实隔离库查询语义、官方 verifier、新基线 DDL 和所有历史约束等价性独立评审。当前不授权签名、迁移、接管或数据库修改，ADR 保持 Proposed。

## 2026-11-25 · 双契约编译验收与实际关系查询专项

维护者 Windows 在 `c3a03056f7375d9dd4d42969720cb8e6ae6de625` 实测 CLI 5/5、物理评审 9/9、运行时评审 6/6；正式与原生候选服务端离线类型检查均通过；Prisma 两项根 Skills 已同步（ORM Postgres 8.0.0-rc.25、CLI 8.0.0-rc.35）。Vite+ 517 个格式文件、358 个受检文件零警告错误，中文文案 385、Markdown 96，增量退出码 0。最终 HEAD `8310c986a1619a47b9b121d6e3db172b8d8f30cb` 仅两份脚本排版变化，按授权 Squash 合入 `63cdc5d9ff5fca03267a3a52d15cdb9189f3447f`。

先独立只读复验已验收测试库目录及 UTC 时区，拒绝标记或目录漂移；再使用一个调用方持有的 pg.Client，于 REPEATABLE READ READ ONLY 事务内使用独立 SQL 六字段关联为基准，分别执行正式和保留原生候选的状态正向 include 和按租户/工程/事件 ID 显式读取。最多抽取一条已发布和一条未发布，不改业务数据；EMPTY 明确为缺少覆盖。目录预检和查询是不同快照，专项期间不得并发 DDL。六字段真实行为对照尚待维护者运行；没有证明全部查询、写入、反向导航或官方 verifier 等价。保留 STORAGE_REVIEW_REQUIRED_RUNTIME_BLOCKED，ADR 状态 Proposed，禁止签名、迁移和正式 Provider 切换。

## 2026-11-25 · 官方 Schema-only verifier 入口候选

固定版本 Prisma 8 Skill 的 migrations 参考明确将 db verify 定义为独立诊断，--schema-only 跳过 marker，--strict 才会把 Contract 之外的数据库对象视为错误。当前测试库尚无 Prisma 8 marker，且必须保留 Prisma 7 历史迁移元数据，因此候选入口仅运行 db verify --schema-only，不启用 strict。通过根 CLI 精确白名单只允许原生配置验证；复用现有本机测试库 URL 守卫，并将连接参数限制为 PostgreSQL 默认事务只读、5 秒 statement timeout、2 秒 lock timeout、public search_path。连接 URL 通过配置环境注入，不进入子进程命令参数；非验证的离线 emit/Skills 命令主动移除测试数据库 URL。该入口没有任何签名、迁移、基线规划或 DDL 命令映射。

当前只增加 CLI 入口、八项模拟测试和操作文档；模拟测试不证明 Prisma 8 RC 官方 verifier 的实际行为。维护者须在 Windows 对 adui_scada_test 单独运行官方验证，保留退出码及 schemaIssues。若官方 verifier 返回 4，停止并人工审查物理差异，不自动修改 Contract/数据库；返回 2 则诊断执行环境。原生候选真实发布状态样本仍为 EMPTY，非空发布关系未验收。ADR 状态保持 Proposed；Prisma 7 继续唯一正式迁移执行者，禁止签名、迁移、基线规划和 Provider 切换。
