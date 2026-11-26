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

## 2026-11-25 · 官方结构验收及离线基线候选专项方案（待批准）

PR #215 已按授权合入 `c11e7ae5f37a37736c77d38050e5fcfe3ec21cea`；真实只读发布查询未发布样本 MATCHED、已发布样本 EMPTY、退出码 0。PR #216 已按授权合入 `647fd455d901d4786b2fb2c7b4d179290804d3f7`；维护者 Windows CLI 8/8、Vite+ 520 个格式文件与 361 个受检文件零警告错误、中文文案 388 文件、Markdown 96 份，增量退出码 0。固定 RC 官方 verifier 对保留的原生 Contract 及本机验收库报告 schema only (tolerant)、Database schema satisfies contract、退出码 0，连接诊断已脱敏并显示只读连接选项。该结果仅证明本次候选结构满足关系，不证明所有额外对象、标记状态、注释精确等价、基线 DDL 或非空发布关系。

本批直接读取合并提交中的八份历史 SQL，静态提取全部 COMMENT ON TABLE/COLUMN/INDEX 字面量：12 条表注释、87 条列注释（85 个不同字段）、22 条索引注释，共 121 条语句对应 119 个不同对象；均含中文。工程授权表 permission 的三次注释以 20261119180000_release_read_permission 中最终文案为准。22 个已注释索引包括 20 个非主键索引和两个归档表主键索引：`scada_tag_history_batches_pkey`（归档批次复合幂等键）、`scada_tag_history_records_pkey`（归档批次内记录唯一键）。既有 `inspect-prisma8-migration-readiness.mjs` 的 indexes 查询明确排除 indisprimary；constraints 查询检查主键列但未读取主键索引注释及完整索引定义。因此既有目录指纹仍是有效的限定范围证据，不能证明两项主键索引注释。这里只发现覆盖缺口，没有证据表明实际数据库缺少注释。

下一批建议先实现独立只读补充目录核验：在两个既有隔离库验证十二个主键约束与其底层索引的关联、物理名称、列顺序、唯一性、有效性、访问方法、完整定义及注释；按八项历史迁移最终 COMMENT 文案核对 12/85/22 个对象，并逐项比较两库主键索引目录。未声明注释的其他十个主键索引不强制新增注释，但比较其实际定义和注释。补充证据采用独立范围标识和指纹，不改写既有 `73079d85974ddc9cbabf59741f2a4a94dd7bfff3d70a23bab27a7283456e8c52`；只读事务、同一查询上下文、无并发 DDL，保留原历史登记和标记门禁。覆盖缺失主键索引、错误 conindid 关联、列序或索引属性漂移、注释缺失或更改、历史覆盖顺序错误及连接异常等负向回归。当前尚未实现或运行补充探针。

依据固定包内 [迁移模型](../../.agents/skills/prisma-8/references/migration-model.md) 和 [迁移参考](../../.agents/skills/prisma-8/references/migrations.md)，真正的空起点基线可先离线生成而无需数据库签名：`migration plan --from @empty --name scada_native_baseline`。本项目拟使用独立、无数据库连接的基线配置，独立忽略目录 `.artifacts/prisma8-native-baseline/` 下空迁移图，不复用当前带可选测试库连接的 native 配置；候选 Contract 必须复用已验收且保留的原生生成物，并复核已知物理与运行时差异、版本及内容标识。生成前拒绝已有输出、路径逃逸或迁移图/ref/snapshot 污染，不加载 .env，不回退任何业务连接；不改变历史迁移、正式生成物和已保留候选，不引入额外依赖。不开放任意 CLI 参数。该命令仅为待批准的离线方案，不是当前可执行的仓库入口，不允许直接绕过包装器执行。

离线基线评审要求：

- 唯一应用基线边的 manifest 起点为 null，目标存储哈希为已验收原生候选 `6eec3e7459bdfa2646dc156bd6eaf22ffe60b0a0eac309622262b9742a0c68cc`；保留官方生成的 migration.ts、migration.json、ops.json、目标 snapshot 及计划预览，确认无未填充 placeholder。核对框架渲染路径及迁移包对固定版本的依赖解析，不手工改 JSON、哈希或快照。
- 按实际 operation 和 SQL 预览逐项审查 12 表、85 字段、12 主键、13 外键、36 CHECK、20 非主键索引，以及主键底层索引和 119 项最终注释。拒绝未审查的破坏、数据改写、权限扩大、删除或弱化约束；不使用数据丢失许可绕过阻塞。历史 20261118000000 的 INSERT SELECT 是对既有工程的发布状态回填，空库基线不需要照搬该数据回填；现有库接管时也不得重新执行。
- 若官方规划未产生所需中文注释，先验证固定 RC 的受支持迁移操作和自发射能力，再独立评审补充方案；不得编辑生成的 ops.json 或 migrationHash，不得假定单次 rawSql 足以保障未来迁移保留。审查额外对象、索引、默认表达式、所有约束验证状态及权限/RLS/触发器等尚未覆盖元数据。
- 离线候选通过静态评审后，才另行提议由维护者明确批准的第三座新隔离空库重放和真实负向约束测试。不得以已存在的 adui_scada_test 或 adui_scada_fresh_prisma8_ref 作为原生空起点基线部署目标。独立空库证明、历史保留策略、标记/幂等性、数据与权限回归和已发布非空样本均为后续单独验收门禁。

本批只更新评审文档并记录静态发现，不生成迁移包、不新增 CLI 入口、不执行 SQL、签名、建库、重放、DDL 或数据库写入。下一步需要维护者明确批准离线候选生成范围；真实基线部署、写入夹具及签名分别另行授权。ADR 保持 Proposed，Prisma 7 仍为唯一正式迁移执行者，原生候选继续 STORAGE_REVIEW_REQUIRED_RUNTIME_BLOCKED。

## 2026-11-25 · PR #217 合入与主键索引、精确中文注释补充核验

PR #217 文档及 Vite+ 验收通过后按授权合入 `c228eff92d12f9b643128d6020ef0af239efc43f`。本批实现独立补充入口，不改变旧预检的元数据范围或验收指纹。主键索引 SELECT 仅在补充入口的各库原可重复读只读事务内执行，关联 pg_constraint.conindid、所属表、索引命名空间和主键类型；检查主键、唯一性、valid/ready/live/immediate、无表达式/谓词/额外列、btree、历史约束名称及列顺序，并逐项比较两库 pg_get_indexdef 与索引注释。十二个主键均参与对照；未在历史声明注释的其他十个主键索引不强制注释非空。

通过八项历史迁移既有名称顺序及 SHA-256 重新读取原文，受控提取单行 COMMENT ON 字面量，拒绝未审查的重复或格式，以 permission 的三次覆盖的最后文案为准，核对 121 条语句对应的 119 个最终对象（12 表、85 字段、20 非主键索引、2 主键索引）。必须同时通过旧目录指纹锁定及两库原始目录、查询上下文、迁移登记核验；独立补充指纹以 PRISMA8_PRIMARY_INDEX_AND_COMMENTS_V1、旧指纹及十二主键索引目录为输入，不将其替换为旧指纹。真实专项期间不得并发 DDL，不声称两库具有原子快照。七项合成目录离线测试局部实测通过，原预检新增三项测试定义，真实双库及 Windows 门禁尚待验收。

即使补充专项通过，结论仍为 MATCHED_REVIEW_REQUIRED、签名许可否。原生候选运行时阻塞 STORAGE_REVIEW_REQUIRED_RUNTIME_BLOCKED 与已发布非空样本缺失仍未消除；离线基线生成须单独明确授权，不执行迁移 plan、重放、DDL、签名或正式 Provider 切换。

## 2026-11-25 · PR #218 真实双库验收与独立离线基线候选门禁

维护者 Windows 验收前 HEAD `7e9362ef4bf6b62b2b1314946d62d21c4c80ed75`，预检 19/19、补充核验 7/7，Vite+ 523 个格式文件及 364 个受检文件零警告错误，中文文案 391、Markdown 96，增量退出码 0。真实两库补充核验原目录指纹 `73079d85974ddc9cbabf59741f2a4a94dd7bfff3d70a23bab27a7283456e8c52` 保持，主键索引 12、最终中文注释 119、补充指纹 `b7ce46a8e3a203dce7a63fc94bbf1a11d0244521b6efc697e64b1b1a34fd02ad`，MATCHED_REVIEW_REQUIRED、签名许可否、退出码 0。远端最终 HEAD `48b71dfd6b4ead3df51b5ea28bffbfca6bdc0e85` 相对此验收起点仅六份文件格式化；经明确授权 Squash 合入 `e98168711a1a52c0bba76adc6fe1ffcda3cd8076`。

本批实现独立离线规划包装器与配置，实际生成需要维护者显式确认参数 --confirm-offline-baseline。沿用固定 Prisma CLI 8.0.0-rc.35、ORM PostgreSQL 8.0.0-rc.25 与包内迁移模型/迁移参考文档，使用 migration plan --from @empty --name scada_native_baseline --json --no-interactive；命令固定且不允许外部参数或连接覆盖。复制已保留原生 PSL、JSON 与声明原文到全新忽略目录，预检拒绝已有目录/链接、错版 CLI、超出包内路径、未知物理及运行时差异，使用既有评审器核对历史物理结构、CHECK 名称及候选 PSL/IR 文字一致性、声明及固定契约标识；使用官方静态装载入口，无客户端或数据库连接。原始候选的哈希字段并非独立真实性证明，CHECK 文案与原数据库的精确等价仍依赖此前验收过的保留候选和后续真实 DDL 评审。

配置 parent: false 且不提供 db.connection，不加载 dotenv，固定子进程环境白名单不传数据库及注入变量，生成图和日志仅写入独立目录，不是操作系统网络隔离。回读正式生成物、保留候选、隔离副本、独立配置及历史迁移检查未发生变化。拒绝任何现存输出、额外迁移/refs/快照、非 additive 计划、占位符、缺少预览、非空起点或目标哈希及目标 JSON 内容不符；失败保留产物和诊断，不自动重试。只检查官方迁移标识的格式，尚不自行重算 migrationHash 或证明 ops.json 与预览/DDL 的全部语义等价。九项模拟 CLI/文件系统回归已在协作容器通过，固定 RC 实际规划、生成文件形状与 Windows 门禁尚待维护者实测。

即使生成门禁通过，也仅进入 BASELINE_ARTIFACT_REVIEW_REQUIRED，后续逐项检查官方迁移操作、SQL 预览、119 项最终中文注释、六字段末次事件外键、36 项 CHECK 等，确认依赖解析并另行审查注释缺口。若固定 RC 实际输出与文档假设不同，停止并保留证据，不能放宽门禁或手工更改官方生成物。两座既有隔离库不参与该生成，不执行任何数据库写入或签名。部署、第三座新隔离库、已发布非空样本、Provider 切换均分别待独立批准；ADR 状态 Proposed，Prisma 7 仍为唯一正式迁移执行者。

## 2026-11-25 · PR #219 真实 RC 规划与只读复验（E-144）

维护者实际离线规划已生成唯一空起点候选，原包装器退出 1 是误读真实 CLI 成功封装，不是已证实的官方规划失败。上传原包证明 envelope.result、46 项 additive、没有 pendingPlaceholders 字段且源码无占位符；快照 JSON 与原生 JSON 完整深度相等，声明哈希相符。新增只读复验入口保持原件及生成入口禁止覆盖，不接受失败诊断、非新增操作或非空已应用语句、临时值和扩展目录；对照实际操作摘要与 SQL 预览/执行文本，保留目标与历史约束门禁。预览统计 12 表、12 主键、36 CHECK、13 外键、20 非主键索引，但 COMMENT ON 为零，119 项中文注释缺口成立。局部 Node 12/12 和真实归档核心检查通过，维护者最新 HEAD 全仓与只读入口复验尚待完成。

本次只确认原始候选及计划一致性，不独立重算 migrationHash、不保证 precheck/postcheck、全部 SQL 语义和依赖解析、不执行自发射、DDL 或部署。后续须另行评审正式补充中文注释的迁移策略及验证步骤，保留官方生成物；原生运行时阻塞及已发布非空样本缺失仍未解除。ADR 保持 Proposed，签名许可否，部署许可否，Prisma 7 为唯一正式迁移执行者。

## 2026-11-25 · PR #219 结案与固定原生基线 DDL/注释文本审查

维护者 Windows 实测 12/12 基线、9/9 原生、6/6 运行时、Vite+ 527 格式/368 受检零警告错误、中文文案 395、文档 96、真实已有候选复验 46 项，目标、原文及迁移标识与原包一致，退出码 0。日志未单独打印本机 HEAD；远端最终 `fbe2fc2e370ab3cca807311fbb134a40022f5e0e` 相对 `21fcc5472fc0a91a283d924186ba8161fb50fbc8` 仅两份文件排版。经维护者授权 PR #219 Squash 合入 `55688fe7e261bdade6f7f72cb80329d31b1d478b`，E-144 关闭。

固定维护者上传的十文件原包及八份历史 SQL 原文 SHA-256；在既有运行时、物理 IR、快照及操作一致性门禁之后，从已核验原生 IR 独立构造当前 RC 七种物理字段类型、varchar 长度、timestamptz 精度、三个默认值形状、可空性、命名主键及 CHECK 原谓词、索引及完整外键 DDL；按操作标识一一匹配实际 execute SQL 全文，拒绝缺失、重复、非新增、参数和依赖阶段变化。真实原包独立局部检查 46 项文本一致（1 schema、12 建表、20 索引、13 外键），含 85 字段、12 主键、36 CHECK 及六列末次事件外键；十文件字节匹配。不是通用 SQL 生成器或 PostgreSQL 语义证明。

八项历史 SQL 中 121 条注释最终覆盖 119 项（12 表、85 列、22 索引，含两个已声明注释的主键索引）；permission 三次覆盖取最后，按对象键固定排序、public 显式限定、SQL 单引号倍写，生成仅供审查的 UTF-8 LF 文本，SHA-256 06a47418f3477c263cb19c7a3550a6be3810a4ffd9c22afada7ecd28f6322fb7。输出不写原始包或数据库；原包注释仍为 0，保持 DDL_TEXT_MATCHED_COMMENTS_BLOCKED。新增八项回归已在独立 Node 22.16.0 环境通过；真实 Windows 完整专项待复验。固定原包检查不替代 migrationHash 官方算法、precheck/postcheck 实库语义或运行时依赖检查。

后续优先在另行批准的独立迁移图副本中研究固定 RC 支持的迁移 authoring API：非工厂支持的 rawSql DDL 必须有审查过的活体 schema precheck、postcheck；只经框架支持的 migration.ts 自发射更新 ops.json 与 migration.json，不手改官方哈希、原包或快照，先离线核对全部原有 46 项及 119 注释的目标、完整文案和拒绝条件。此处仅方案，尚未构造、运行 self-emit 或决定同边补充/独立不变量路径，须依据固定版本行为专项评审。真实空库重放、非空发布样本、签名及正式接管须分别授权。ADR 保持 Proposed，Prisma 7 唯一正式迁移执行者。

## 2026-11-26 · PR #220 合入与中文注释独立自发射候选

PR #220 经维护者明确授权 Squash 合入 66dd3bb6aff59ed158f9373d5e63041bda65d40c，最终 HEAD d82078733318d722a1fe5607784966e3c7854fde 为三个文件排版调整。原包继续 DDL_TEXT_MATCHED_COMMENTS_BLOCKED。

选择在同一未部署空起点边的独立副本追加注释，而不是在已应用迁移上改写历史或创建无结构变化的自环。原包十文件、八份历史迁移及正式契约门禁保持，独立目录使用 apps/server/.artifacts/prisma8-native-baseline-comments，使官方迁移源码能按 Node 原生规则解析服务端固定依赖，禁止链接及覆盖。原计划 JSON 与日志保留在原目录，不复制为新图的官方计划。独立配置不加载 dotenv、无数据库连接、parent: false；子进程复用环境白名单，不属于网络沙箱。生成目录仅作为第三方生成物从现有 Format/Lint/中文文案扫描中精确排除，不排除项目自有代码。

已核对上游 PostgreSQL rawSql 身份工厂、脚手架 operations getter、SQL 步骤参数及 runner 布尔检查接口。逐行解析已审查的 public 注释文本，按表、列、索引构造 additive 操作，precheck 必须目标存在且注释为空，postcheck 必须目标存在且 UTF-8 字节精确相等；列限定普通表、正属性号、未删除属性，索引限定普通索引，目录查询全限定 pg_catalog、参数绑定。已有正确注释由 runner 幂等检查跳过；不同注释不得被覆盖。该语义仍须以后在另行授权的真实隔离空库验证。

只改独立副本 migration.ts 的官方导入与操作列表，先运行官方 self-emit --dry-run，要求原 46 项完整操作（含全部预/后置检查、目标及执行参数）与新增 119 项完整操作逐项相同，其他 manifest 元数据及空起点边不变、哈希改变；干跑不改任何候选文件。正式自发射结果须与干跑完全一致，再运行 migration check --space app --json，要求官方成功封装、无诊断及无 findings。原件、契约、快照及独立配置回读核对；失败保留证据，不自动重试。没有手工写入新 ops.json、manifest 或计算迁移哈希。

固定 RC 实际自发射、迁移图完整性及 Windows 门禁尚未运行；八项纯逻辑回归及历史 119 项文本转换在协作容器通过。若真实 RC 输出或官方脚手架不同，停止并保存原始诊断，不放宽门禁。即使成功也仅 COMMENTS_EMITTED_REVIEW_REQUIRED，签名/部署许可均否。ADR 保持 Proposed，Prisma 7 仍是唯一正式迁移执行者。

## 2026-11-26 · E-146 官方脚手架排版与语义分离

首次 Windows 工程质量验收通过，真实脚手架文本匹配退出 1，原包十文件及 46/119 审查均通过。改用已有 TypeScript 语法解析定位唯一导入、空起点类、目标快照、操作数组及官方入口，只插入源码文本并对照原操作表达式；保留原件指纹、实际完整 165 项操作与官方哈希重算、干跑、自发射及 migration check 门禁。局部新增测试通过，未取得原 ZIP 具体脚手架文本、未执行固定 RC 自发射；需要真实复验。ADR 仍 Proposed，签名和部署许可仍否。
