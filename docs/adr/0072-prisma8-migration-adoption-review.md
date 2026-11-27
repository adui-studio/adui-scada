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

## 2026-11-26 · PR #221 结案与部署前独立候选离线复验

维护者 Windows 新增 10/10、DDL 8/8、基线 12/12、Vite+ 533/374 零警告错误、中文 401、文档 96，真实官方自发射、完整性检查及原件复核均退出 0，165 项操作，官方迁移标识 e6b95ed88834dce3f6448445a5ba12a00ba34c8e5c68f4335751659b15a77f17。最终 HEAD 47d2d5fe137e1cc58076f0b9243584edf49bb454 为两个脚本排版，维护者授权 Squash 合入 6dd53088aac7b48a7a76f37c594e6d176c65c1b0，E-145/E-146 关闭。

下一小批仅复验已有独立候选，不重新生成：从固定十文件原包及历史注释文本重构源码和完整操作，固定官方新迁移标识及无连接配置 SHA-256，要求八份迁移/契约/快照文件和六份原诊断精确清单，不接受额外目录、链接、硬链接或文件越界。已保存官方干跑与实际 manifest/ops 必须完整一致，历史 check 必须成功；仅在这些条件通过后以白名单环境运行固定 RC 源码 dry-run 及 migration check，复核每阶段原包、配置和十四文件字节未变。此为逻辑与文件门禁，不是操作系统网络或文件锁沙箱，禁止并发修改，信任已锁定本地依赖。输出按相对路径排序的十四文件长度及 SHA-256、配置 SHA-256、固定官方迁移标识和 PRISMA8_NATIVE_COMMENT_CANDIDATE_V1 证据指纹；指纹用于后续显式固定，并不把首次采集冒充历史字节证据，也不替代官方 migrationHash。真实候选尚未取回，新增只读入口待 Windows 实测；七项合成测试通过。成功仍仅 CANDIDATE_PREFLIGHT_REVIEW_REQUIRED。下一阶段另行确定第三座专用空库及严格 URL、空目录/marker/权限预检，独立授权部署后再实测全目录和 119 注释等价。ADR 保持 Proposed，Prisma 7 仍为唯一正式迁移执行器，签名和部署许可否。

## 2026-11-26 · PR #222 结案与第三座专用空库只读安全门禁

维护者 Windows 37/37、Vite+ 535/376 零警告错误、中文 403、文档 96，真实独立候选再次干跑及 migration check 退出 0，十四文件及 165 项完整操作不变，证据指纹 02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e。最终格式提交 bda0dd823417af24bf99280c6d747757099b9df8 仅三脚本排版，按授权 Squash 合入 4212160faabec482963b071bff5b34e1e06d3f50。

本批锁定真实十四文件清单及配置、迁移标识、证据指纹；已有离线复验先对照该清单与 SHA-256，再启动固定官方干跑和 migration check。证据清单按规范 JSON 重新计算得到维护者报告的实际指纹，不把它当作官方 migrationHash。第三座库暂定 adui_scada_fresh_prisma8_native，仅接受显式独立 URL 与唯一确认参数；强制本机 127.0.0.1:15432、固定库名、非空显式凭据，不继承业务库或其他测试库 URL，固定 pg 连接参数、仅本地禁用 TLS、不转发任意 URL options。真实数据库预检在候选复验成功之后才连接，以只读默认设置、显式 REPEATABLE READ READ ONLY、超时和 public 搜索路径运行固定目录 SELECT，验证实际库名、会话角色、所有者及建 schema / public 使用和创建权限，UTF8、UTC、标准字符串、非恢复状态，拒绝 23 类受检异常，包括额外 schema（含 Prisma marker schema）、public 用户对象（含历史 ledger）、非默认扩展、事件触发器、逻辑复制对象、外部服务器、大对象、默认 ACL、预备事务及其他会话。只读回滚关闭后再次复验原包、候选、历史和配置证据；失败脱敏并停止。该检查仅覆盖明确目录类别，不是操作系统或集群隔离证明，不锁住后续事务，不能把空库检查结果当作部署许可；部署前必须另行授权并重新检查。协作环境八项模拟测试通过，真实库尚未确认存在或连接，SQL 行为、Windows 完整验收待实测。未编写或运行部署、签名、创建/重置数据库命令。ADR 保持 Proposed，Prisma 7 为唯一正式迁移执行者。

## 2026-11-26 · PR #223 空库实测结案及第三座专用库迁移授权

维护者精确 HEAD f1c6b7cb 实测 47/47、538/378 零警告、中文 405、Markdown 96；真实 PostgreSQL 17.11 第三座专用库 23 类通过，固定十四文件及原件不变，回滚关闭，两个验收退出 0。PR #223 按授权 Squash 合入 2f8b692a8284f2eab182b5a44155bebaeff1c696。维护者明确同意仅第三座库独立原生迁移；不授权现有业务库签名或 Provider 切换。

新增独立在线配置与包装器，固定候选不变。仅第三座库专用 URL，经已有白名单解析后按标准 URL 编码传递到白名单子进程环境，不作为命令行参数；独立配置不加载 dotenv。先重复原离线及空库预检，以固定 RC 执行 db migrate --show --to 固定目标 --no-advance-ref，要求机器结果唯一 app 基线边（空起点、固定迁移标识及目标存储哈希）。单独显式确认应用后再次预检，官方 db migrate 执行唯一迁移，检查官方报告目标 marker 与唯一 applied 记录，再 db verify 和空剩余路径预览；全过程核对原件、固定十四文件、正式契约和历史。使用上游当前代码与仓库内 RC Skill 核对命令及候选响应字段，固定 RC.35 实际在线响应尚未验证，形状不符则拒绝，不把模拟当成实库证据。应用调用开始后任何失败均保留现场，不能自动重试或声称回滚。无 ref 推进，不使用 db sign、db update、策略覆盖或数据丢失许可。五项离线测试定义尚待实测；真实应用、官方校验、全目录/注释、约束、幂等及非空发布样本独立待验收，ADR 保持 Proposed，正式 Prisma 7 执行边界不变。

## 2026-11-26 · PR #224 首次真实迁移失败与恢复门禁

维护者真实 Windows 52/52、542/382 零警告、中文 409、Markdown 96，官方在线预览唯一固定基线边及指纹一致，退出 0；写入前空库预检通过，实际 db migrate 子进程失败且包装器丢失官方错误类别，包装退出 1。没有实际回滚、marker 或 ledger 结果，不能假定事务已回滚。E-150 暂冻结再次迁移确认，新增只读恢复入口和白名单错误码提取，保留原始迁移包、已验收独立候选、正式契约和历史。固定 RC 的真实 marker/ledger 字段和状态仍须本机取证；只读报告统计不替代逐项物理定义与中文注释等价评审。局部六项模拟测试通过，真实恢复待执行。若目录/标记均空且 23 类门禁通过，也只进入恢复评审，不自动重试；如存在已提交或部分对象，保持现场并独立审查。禁止 db sign、db update、重置、清理及正式 Provider 切换，ADR 保持 Proposed。

## 2026-11-26 · PR #224 恢复验收结案与一次性诊断边界

维护者 Windows 58/58、544/384 零警告、中文 411、Markdown 96，增量退出 0。第三座专用 PostgreSQL 170011 恢复退出 0，业务目录和注释统计均为零，无 marker schema、marker、ledger 或旧迁移表，严格空库 23 类检查通过，十四文件指纹不变。按明确授权 PR #224 Squash 合入 0ffb6672134c4676da31970d74b9bf7f7462bf89。Docker 实际日志没有可关联首次官方迁移失败的直接错误。不能据受检空库结果证明首次执行的具体失败点或完整回滚，也不认为此前目标库不存在是实际迁移失败的已确认根因。

保留旧写入确认冻结。新增不同的人工确认参数，仅适用于恢复评审后的第三座专用库单次诊断性迁移。复用固定候选与版本、原件保护、URL 白名单、唯一在线迁移边及写入前重复空库检查；以独占创建本地尝试记录后才进入官方迁移调用，记录存在或无法保存立即拒绝，任何失败均不自动移除记录。记录位于已忽略的候选父目录，仅记录固定范围与指纹，不属于十四文件证据，不是数据库锁或跨工作区协调机制。新增直接官方错误封装白名单诊断，不降低成功结果验证或接受策略覆盖。新入口的 Windows 与实际 RC 验收待执行。不得自动重试、签名、重置、清理、推进 ref 或切换正式 Provider；仍需独立实测应用、物理目录及约束/注释等价、幂等与非空历史发布样本，ADR 保持 Proposed。

## 2026-11-26 · PR #225 单次恢复结束与严格结构只读对照

维护者在 HEAD `240d70a3a2fbb3efeb43257ac1bb874d594bd75c` 开始 Windows 验收，恢复 12/12、迁移 5/5、空库预检 10/10（合计 27/27），Vite+ 546 格式/386 受检零警告错误、中文 413、Markdown 96，增量退出 0，工作区干净。最终 HEAD `ef8782371e3aaa0f56d557d3772ccc88e6db6ac3` 相对验收起点仅一份测试排版；经维护者授权 PR #225 Squash 合入 `9a8bfe5bb630c0c2dbb8b2df1c505f33d0948664`。真实一次性执行两次空库预检、唯一在线路径及固定证据核对通过，独占尝试记录已登记；官方迁移退出 2、诊断 `MIGRATION.SCHEMA_VERIFY_FAILED`，包装退出 1。随后真实第三座库 PostgreSQL 170011 只读恢复退出 0，九类目录及注释计数均零，无 marker schema、marker、ledger 或旧迁移记录，严格空库 23 类通过，十四文件指纹 `02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e` 不变。该证据不证明实际迁移成功或全部回滚过程。

已核对固定 PostgreSQL Provider v8.0.0-rc.25 上游源码 `packages/3-targets/postgres/1-target/src/core/migrations/runner.ts`（https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/3-targets/postgres/1-target/src/core/migrations/runner.ts）：app 空间在执行计划后、提交事务和更新 marker/ledger 之前，以同一 driver introspect 并调用 verifySchema，默认 strictVerification 为 true；失败携带 meta.schemaIssues。既有 #216 是宽容 schema-only 对照，不能代替迁移严格验证。尚未确认固定 CLI rc.35 是否覆盖默认选项，也未保留此次 schemaIssues 具体内容，严格模式只是待验证的差异假设，不得认定历史登记、中文注释或某一约束为根因。

本批冻结原确认和已消耗的单次恢复确认（无论本地记录是否存在），保留一次性记录和原件。只在既有 CLI 白名单新增 `db native-schema-verify-strict`，映射固定 `db verify --schema-only --strict --json`，复用原生配置、原 adui_scada_test URL 守卫与 PostgreSQL default_transaction_read_only、超时和 search_path 参数；不扩大允许库名，不运行任何写入，不改第三座库、候选、历史、正式 Provider 或依赖。严格 JSON 是官方机器输出，仅供维护者在本机提取诊断码、结构路径和差异类别，不分享原始输出、凭据、任意元数据或业务值。严格对照可能返回历史 Prisma 7 登记等未声明对象，不能据此推断第三座库实际失败点，也不应删除对象、放宽验证或签名。 只有取得实际结构差异并独立评审后，才能另行提议修复；不允许再次执行第三座库写入。ADR 保持 Proposed，不改变 Prisma 7 正式迁移边界。

### 2026-11-26 · 严格控制库验收及离线执行检查调查

维护者 Windows 实测 CLI 9/9、恢复 12/12、迁移 5/5、空库 10/10，共 36/36；Vite+ 546 格式/386 受检零警告错误、中文 413、Markdown 96、增量退出 0、工作区干净。固定 RC 与两份 Contract SHA-256 通过；历史验收库真实宽容及严格 schema-only 均退出 0，严格官方机器结果 True。日志未单独输出本机 HEAD，远端 PR #226 HEAD ac0b7abad8094b0ce38036f1fe5a2a234709cbd7，经明确授权 Squash 合入 5797d5388eac7b531ae13e51e0b336ef770bf460。仅确认控制库结构符合契约，不证明第三座库迁移后的实际目录或失败原因。

固定 Provider rc.25 Runner 源码 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/3-targets/postgres/1-target/src/core/migrations/runner.ts 的 applyPlan 在 postcheck 和幂等检查均启用时先执行 postcheck；非空且全部满足则跳过该操作，否则继续执行 precheck、execute、postcheck，随后 app 空间整体 schema 验证。已有 DDL 对照只验证 execute 文本，并未分析真实 precheck/postcheck 参数及是否可能提前满足。此为调查方向，不能断言实际发生过跳过，也不能把空检查或相同检查判定为故障。控制库严格验证已通过，不再把宽容/严格差异单独作为根因。CLI rc.35 实际参数、真实失败 schemaIssues 和失败瞬时结构仍缺证据。

新增固定离线执行检查评审入口，仅校验已安装 CLI/Provider 版本及入口路径，不启动 CLI，不创建连接或子进程。复用固定原包十文件、独立候选十四文件、离线配置指纹门禁，读取候选 ops.json 后按已验收清单再次核对长度及 SHA-256；检查 46 项结构与 119 项注释顺序边界、唯一标识、additive/postgres/单 execute、precheck/postcheck 形状；导出结构操作的检查 SQL 和参数及缺失/相同检查标识，注释仅统计覆盖，不导出注释 SQL/参数、执行 SQL、任意元数据或连接凭据。输出前再核对原包和候选。不执行 SQL，不写任何候选或数据库，不授权签名、部署或再次迁移。报告是静态证据，不代表真实执行或 PostgreSQL 结构验证。

现有 Proposed 状态和全部冻结门禁不变。

### 2026-11-26 · 固定执行检查验收及直接结构验证差异调查

维护者 Windows 实测 PR #227：执行检查 4/4、DDL 8/8、候选完整性 7/7，共 19/19；Vite+ 549 格式/389 受检零警告错误，中文 416，Markdown 96，增量退出 0，工作区干净。真实固定离线报告退出 0，十四文件指纹 02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e 不变，46 项结构、119 项注释，缺前置 1、缺后置 1、相同前后 0，状态 EXECUTION_CHECK_REVIEW_REQUIRED。日志未打印具体操作标识或报告全文，不能断言两项为同一操作或判定实际发生错误跳过。日志未单独打印 HEAD；远端唯一 HEAD 8328529cd078bfb6ff37df206c426ca864c0dcd5，经明确授权 Squash 合入 46d9e0e757d1ad46c3b88f302f012612da4356f0。

新增上游证据：v8.0.0-rc.25 标签的 CLI 共享源码 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/1-framework/3-tooling/cli/src/control-api/operations/run-migration.ts 在 perSpaceOptions 显式传入 strictVerification: false，不能继续将 Runner 默认 true 当作实际迁移参数；此标签 CLI 源码不等同维护者已安装的 CLI rc.35，后者实际选项仍未核实。相同标签的 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/1-framework/3-tooling/cli/src/control-api/operations/db-verify.ts 使用 collectAggregateNamespaces(aggregate) introspect，再按空间 verify；而 Runner 使用 destinationContract 直接 introspect/verifySchema。Provider 公开控制入口 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/3-targets/postgres/9-facade/src/exports/control.ts 与 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/1-framework/3-tooling/cli/src/control-api/client.ts 的 schemaVerify 使用完整反序列化契约直接 introspect/verifySchema。该差异值得对照，但不证明第三座库失败由聚合或非严格模式导致。

新增固定直接只读入口，锁定 CLI rc.35/Provider rc.25 及原包、十四文件，核对唯一迁移目标快照与候选根契约的文件哈希和 JSON 深度相等。仅复用 adui_scada_test URL 守卫并进一步限定 127.0.0.1:15432、非空凭据及固定只读启动参数，不接受额外命令行参数；以公开 createPostgresControlClient、connect、schemaVerify、close 顺序执行宽容及严格两种直接验证。结果仅返回严格标志、真假、问题与警告计数及契约声明范围内脱敏路径；目标存储哈希、strict 及结果形状不一致即失败。连接、验证或关闭异常不回显原文；关闭后再核对证据。该公开 API 不暴露连接内独立 SQL 查询，因此只读启动设置由 URL 和 sessionSettings 固定，不声称已在同一事务查询 read_only 或复现失败瞬间；禁止并发 Schema 变更。未连接第三座库，不调用迁移、签名、自定义 SQL 或写入，不修改原包、候选、历史、依赖或正式 Provider。

ADR 保持 Proposed。不得由控制库结果推断第三座库迁移成功或解除冻结。

### 2026-11-26 · 固定快照真实直接结构对照结果

维护者 Windows 实测 PR #228：直接结构 4/4、执行检查 4/4、候选完整性 7/7，共 15/15；Vite+ 552 格式/392 受检，0 错误、1 条 eslint(no-unsafe-finally) 警告，中文文案 419、Markdown 96、增量退出码 0，工作区干净。日志未单独打印本机 HEAD；远端 b7d5bcd0e607485e75d11fd880447ea0bc8b0105 相对交付 HEAD ea5cb8760751cf60078e46e291500dd9710f0303 为三份源码排版提交。真实历史验收库 adui_scada_test 的直接宽容与严格验证均 ok=true，issueCount=0、warningCount=0、issuePaths=[]，退出 0，十四文件证据指纹 02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e 不变，状态 DIRECT_SCHEMA_REVIEW_REQUIRED，签名与部署均 false。这里的数据库结构警告为零不等于 Vite+ 零警告。

维护者从已存在的离线报告提取出 missingPrecheck 与 missingPostcheck 均仅为 schema.public，identicalChecks=[]。该项为已验收的 CREATE SCHEMA IF NOT EXISTS public（实际 SQL 使用双引号）；Runner 的空 postcheck 不会触发预满足跳过，其余 164 项均具备前后检查。不能据此确认实际执行情况，也没有证据将该项视为失败根因。历史库聚合、直接两种路径各自宽容与严格均通过；未复现失败事务内目录，仍无第三座库原始 schemaIssues，CLI rc.35 实际选项仍未核实。

E-152 仅修复证据复核控制流，保持固定证据、只读及迁移冻结。后续不重复历史库结构对照作为根因调查；应先评审可获取的原始失败诊断以及隔离复现方案，未经单独授权不得创建新库、执行 DDL 或再次迁移。ADR 保持 Proposed。

### 2026-11-26 · 固定候选失败证据提取及隔离复现提议

维护者在明确打印的 HEAD c10e154cb38170b4c58fa4ab9917a089e5bdadb6 实测 PR #228 E-152 修复：直接结构 7/7、执行检查 4/4、候选完整性 7/7，共 18/18，Vite+ 552 格式/392 受检零警告错误、中文 419、Markdown 96、增量退出 0，工作区干净。按明确授权 Squash 合入 3bfb92229980f5f46a1f7c9244d4e3c59ff83d4c。E-152 静态质量与模拟保护复验关闭；修复前真实历史库直接验证两种模式均通过，但此次日志未包含修复后的真实数据库复验，不重复登记为新的数据库实测。

固定 Provider rc.25 上游 Runner 源码 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/3-targets/postgres/1-target/src/core/migrations/runner.ts 在事务内结构验证失败时返回 MIGRATION.SCHEMA_VERIFY_FAILED 并携带 meta.schemaIssues；CLI 共享源码 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/1-framework/3-tooling/cli/src/utils/runner-failure-error.ts 将 failure.meta 保留在 CLI 错误对象。上游 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/1-framework/1-core/framework-components/src/control/schema-diff.ts 的 issueOutcome 明确从 expected/actual 是否存在派生 not-found、not-expected、not-equal；解释类别仅为 differs、possibly-equivalent。固定 CLI rc.35 的最终 JSON 序列化仍须实测，不能将 rc.25 标签共享源码认定为安装包完整实测。现有迁移包装器在内存捕获 stdout/stderr 后仅输出白名单错误码；一次性尝试记录只含范围和指纹。仓库代码未持久化原始 schemaIssues；不能确认维护者是否另有原始机器输出，也不能从恢复后空库反推失败时具体差异。

新增只读离线诊断解析器：只接受已有机器诊断的标准输入，16 MiB 上限，匹配唯一 db.migrate 结构失败封装，兼容直接错误、逐行事件最终错误及最终诊断数组；命令、严重度和结果状态矛盾、重复或畸形结果拒绝。仅输出契约白名单结构路径、由 expected/actual 存在性派生的类别、两种已知解释类别和数量，未知路径脱敏，不输出节点原值、摘要、解释正文、凭据、连接串或任意元数据；缺失列表与空列表分别用 null 与 0 表达，均不代表零差异通过。入口复用原包/固定十四文件门禁，另核对候选 contract.json 长度及 SHA-256，复用已有路径白名单，输出前复核固定证据。离线入口不认证日志来源，不调用 Prisma CLI、数据库驱动、迁移、签名或任何写入；不能通过旧错误码重构丢失的具体结构差异。退出 0 仅表示取得非空合法脱敏差异，4 表示唯一失败但缺少具体差异，1 表示输入或证据拒绝。所有报告 signingAllowed 和 deploymentAllowed 均为 false；旧迁移入口及写入冻结门禁不变。

下一阶段隔离复现方案（仅提议，尚未获得单独数据库操作授权）：保留第三座库、一次性尝试记录、历史验收库、参考库和固定原件。使用完全独立的本机临时 PostgreSQL 实例，选择未占用的专用回环端口、独立数据卷、专用库及一次性凭据，不继承现有容器卷、数据库连接串、根 .env 或其他服务网络。优先核对与既有 PostgreSQL 17.11 相同的实际镜像摘要及环境，不擅自升级。使用候选的独立只读来源副本，核对 CLI rc.35/Provider rc.25、十四文件证据和唯一空起点迁移边；任何执行入口须另行评审连接白名单、实际库/角色/版本、严格空库门禁及一次性授权。仅在明确批准的独立实例执行一次官方原生迁移，捕获官方机器输出，失败时在丢弃原文前提取脱敏 schemaIssues；成功也仅作隔离复现结果，保留现场并停止。若无法取得具体结构差异，再单独评审同一事务内逐项 DDL、目录读取与回滚的实验，而不是继续重复历史库验证。禁止自动创建、重置或清理数据库，禁止重试第三座库、改动正式 Provider、签名、发布或推进引用。本批未实现或执行任何新的在线复现入口。

本阶段仅准备离线诊断，ADR 保持 Proposed。

### 2026-11-26 · 第四座独立实例已授权及实际创建

维护者明确授权创建第四座独立临时 PostgreSQL 实例及一次原生迁移；前三库继续冻结。真实 Windows 已完成固定候选离线复验并创建同镜像 PostgreSQL 17.11 独立容器，独立卷、网络、随机口令和回环 15433 端口；实际库、角色及版本通过容器内查询。未执行迁移。新入口在同一只读事务内比较容器内 system_identifier 与宿主 TCP 实际集群标识及 23 类空库，复核固定原件和独立十四文件副本、CLI rc.35/Provider rc.25、唯一预览边，独占记录后仅执行一次固定官方迁移且不推进引用。原始捕获文本本机加密留存，公开报告只含固定退出码、白名单错误和脱敏结构差异；不保证中断时捕获完整。成功也只表示第四座实验，失败不允许自动重试、重置或清理，不推断第三座根因。ADR 仍 Proposed，正式 Prisma 7 唯一迁移执行者不变。

### 2026-11-26 · 第四座失败原因与独立源级修复候选

第四座固定镜像真实执行通过身份/空库与唯一边门禁，但官方迁移结构验证失败，退出 2，包装退出 1；两路机器输出加密保存成功且未报告捕获中断。单次尝试已消耗，固定十四文件证据与容器身份保持，未取得回滚后目录或实际操作数量。维护者两次离线认证诊断均退出 0，唯一两项为 scada_identities_status_check 与 scada_project_release_event_action_check 的 expression 文本差异。前者期望 100、实际 106 字符，后者期望 101、实际 107 字符，两个节点均 sql-check-constraint、not-equal、其他变化属性零、精确原文匹配 true。历史 SQL 分别约束 status IN ('active', 'disabled') 与 action IN ('PUBLISH', 'ROLLBACK')；期望为 VARCHAR 常量数组整体转换 text[]，实际为各常量逐个转换 text 后组成数组。

固定 Provider rc.25 的 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/2-sql-family/1-core/schema-ir/src/ir/sql-check-constraint-ir.ts 证明 exact-named 接收者按 expression 文本直接比较，wire-named 接收者按 id 比较。由实际密文证据与源码共同确认第四座失败直接原因；尚不能证明第三座的具体差异相同，也不认定上游新版本已经修复。

本批选择仅准备新的独立 PSL，按两项真实证据将 ARRAY_CAST 形式精确替换为 ELEMENT_CAST，保留历史原约束名、两组允许值及其他约束。以固定 CLI rc.35/Provider rc.25 的 contract emit 重新发射；严禁改写已有生成 JSON 或哈希。比较完整新旧 JSON，仅允许两处表达式与官方返回的新 storageHash 变化，复核声明标识并调用官方静态装载；复核原包、固定十四文件及历史注释 119 项。独立输出目录禁止覆盖；不生成迁移包，不连接数据库。实际 DDL 再重打印是否稳定仍未确认；已有历史验收库原先通过 exact-named 比较，改变表达式的候选可能不再匹配旧库文本，故空起点重放修复不能自动等同于历史库接管方案。任何新迁移图、119 项注释操作重发射、在线语义验证、上游缺陷发布或正式接管需独立评审，不放宽约束及结构校验。第四座写入入口与配置均冻结，四座数据库及证据保留。ADR 保持 Proposed。

### 2026-11-26 · 修复契约真实发射与新完整离线候选决策

维护者 Windows 在 HEAD 15b533cf43cb37b4d378a41248381cc46f3f5b66 完成 PR #231 验收：累计专项 45/45，Vite+ 564 格式/404 受检零警告错误、中文 431、Markdown 96，增量退出 0；固定 RC 官方修复契约发射退出 0，第四座十四文件指纹 02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e 单独复核退出 0。维护者授权后 Squash 合入 3537b9b878a2e33da442c9a7ce16d4c41eb9df26。新 storageHash 为 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436；仅两项已定位的 CHECK expression 与新存储标识改变，正式 Prisma 7 和四座数据库均不变。尚未验证 PostgreSQL 往返。

本批新增完整离线修复包入口：固定已验收三份修复契约 SHA-256、原包、正式生成物、八项历史迁移、119 项历史注释、原十四文件与第四座副本，使用固定 CLI rc.35/Provider rc.25 和两份固定无连接配置。仅在 apps/server/.artifacts/prisma8-native-check-repair-package 下新建 plan（十份证据）及 complete（十四份证据）；从 @empty 官方规划，核对完整快照及 46 项独立 DDL，并按原顺序深比较所有结构操作，只允许目标两张表的已知谓词原文替换，前后置检查及参数不可任意漂移。复用既有中文注释构造和 TS 语法节点插入、官方干跑、自发射及 migration check，要求完整 165 项操作与干跑一致，检查覆盖保持原有 schema.public 无前后置检查、其他无相同检查的事实。最终输出官方新迁移标识及本地独立证据指纹，后者不是官方迁移哈希；roundTripVerified、signingAllowed、deploymentAllowed 均 false。新输出目录禁止覆盖、失败保留诊断，精确排除生成目录而非全部 .artifacts；不读连接变量、不执行数据库命令、不改变旧迁移/正式 Provider/冻结策略、不推进引用。

新空起点迁移与历史库接管仍为不同问题，未确认数据库实际反打印稳定性。真实新包报告与实际离线完整性验证待完成，不允许据此签名、部署或执行任何数据库迁移；四座数据库持续冻结，ADR 保持 Proposed。

### 2026-11-26 · 固定修复迁移包与只读重复复验决策

维护者 Windows 在 HEAD `31851343f513681db6eb063bcd4aee286f9fad96` 实测 PR #232：累计专项 54/54、Vite+ 569 格式/409 受检零警告错误、中文文案 436、Markdown 96；固定 RC 真实完整离线迁移包生成及生成后质量复验均退出 0，工作区干净。GitHub 确认合并提交 `f39176464e1805a4443cd4360b70891fa0093cb2`。固定结构迁移标识 `fce9c3dfdc0b5300cc1d128b07a6be03f618f89df7dd8d43ed2712881aee93c8`，完整迁移标识 `5cc4b025c41e1b5479cf29a86d6252806ff5bd517ef5c24b80fa6b89cf3c182e`，真实目录 `20261126T0620_scada_native_check_repair`，24 文件及两份配置的证据清单指纹 `13360ad35e8a1742f7d6a8eea99162fc11f33aea4d45d2075390ce4d2bef9a86`。

新增固定证据清单与已有修复迁移包离线复验模式：先验证固定清单指纹，再逐个读取精确目录、拒绝链接或额外对象并核对实际文件长度及 SHA-256；复用历史原包、第四座保留副本、修复契约、固定 CLI rc.35/Provider rc.25、无连接配置门禁。逐项复核 46 项结构、两处允许谓词变化、119 项历史注释、完整 165 项操作、快照与保存的官方干跑，重新运行固定官方 --dry-run 与 migration check，动作前后及失败后重新核对原件，拒绝非零退出、信号、标准错误和证据漂移；失败短路，不覆盖文件、不写新日志、不重新规划或实际自发射、不读取数据库连接信息、不连接或改写数据库。只允许原验收工作区，因为已保存规划包含实际绝对路径。报告只证明离线复验，roundTripVerified、signingAllowed、deploymentAllowed 均 false，四座数据库继续冻结，正式 Prisma 7 不变。

实际固定 RC 的新入口复验尚待维护者验收。离线一致不证明 PostgreSQL 往返稳定或历史库接管；ADR 继续 Proposed。

### 2026-11-26 · 固定离线复验验收与最小往返计划

维护者 Windows 在 HEAD `687f17766b02f2d1e7a1b4747bd0545985e1bd64` 实测 PR #233 专项 25/25（10+8+7），Vite+ 573 格式/412 受检零警告错误，中文文案 439 文件、Markdown 96，增量及连续两次官方离线复验退出码均为 0，工作区干净。两份报告均为 NATIVE_CHECK_REPAIR_PACKAGE_LOCKED_REVIEW_REQUIRED、46 项结构、119 项注释、165 项完整操作、24 文件及两配置，证据指纹 `13360ad35e8a1742f7d6a8eea99162fc11f33aea4d45d2075390ce4d2bef9a86` 不变；offlineReviewPassed/evidencePreserved=true，regenerated/roundTripVerified/signingAllowed/deploymentAllowed=false。远端相对交付 HEAD 仅四份源码排版；按明确授权 Squash 合入 `713c638ecb3bb77b0fae85ce474e5b1298d0e407`。GitHub 未返回额外 CI 记录。该验收关闭固定离线复验阻塞，不等于 PostgreSQL 迁移成功。

下一批仅准备两个 CHECK 谓词最小往返验证的离线计划与观察判定器。固定 PostgreSQL Provider rc.25 上游 `packages/3-targets/postgres/2-adapter/src/core/control-adapter.ts`（https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/3-targets/postgres/2-adapter/src/core/control-adapter.ts）确实以 pg_get_expr(c.conbin, c.conrelid) 取得裸谓词并保留原文，筛选本地表 CHECK；不能以 pg_get_constraintdef 或自行格式归一化替代。计划绑定原始及修复契约、已验收 24 文件两配置证据，复用完整官方离线复验。仅目标 public.scada_identities.status 和 public.scada_project_release_events.action，保留实际 varchar(16)、NOT NULL、exact-named 约束名。每项包含 legacy（已确认第四座的旧形式到修复形式差异）、repair（直接提交修复形式）、replay（未来将已核验相同的 repair 反向提取原文再次提交）三阶段；后两阶段预期 pg_get_expr 原文与修复形式逐字一致。共六个阶段，每阶段两个允许值、五个非法值及一个 NULL，预期分别为 accepted、23514、23502，共 48 项计划输入。NULL 拒绝来自 NOT NULL 而非 CHECK。本计划省略其他业务列及默认值，仅测试单列显式输入，不能证明完整表及迁移行为。

本批不包含数据库客户端、SQL 执行器、创建容器或新数据库命令。未来如另获授权，须在独立 PostgreSQL 17.11（170011）、同镜像及经核实的排序规则环境，以相同 public 表名分别创建最小关系并在阶段间回滚恢复空目录；通过 pg_catalog 核对约束元数据及精确表达式，用受控合成输入和独立保存点检查结果及错误码，核实回滚和退出，不访问业务数据。实际报告采集及来源认证、隔离目标身份、一次性执行门禁另批实现并评审。观察判定器严格要求固定计划指纹、版本、六个有序阶段、元数据、提交与提取原文、48 个结果，只输出匹配分类和计数，不回显任意输入；匹配仍不证明来源真实，始终 observationSourceAuthenticated/roundTripVerified/historicalAdoptionVerified/databaseExecutionAllowed/signingAllowed/deploymentAllowed=false。四座现存数据库及证据持续冻结，不创建第五座，不启用旧入口，不签名、部署、切换正式 Provider 或修改历史迁移。ADR 保持 Proposed。

协作容器 Node.js 22.16.0 实际运行新增纯离线回归 8/8，通过源文件及测试 node --check（既有契约修复模块 Git Blob f1c0ce1e1b8c3df6cc4e7f4892b73387d16e4047 与远端一致）；本地新增核心 Blob 3b1eb946c0315b6e9e1184190072a7dbbbb386cd、测试 Blob 9cc21795c6c356becb38c935e9f18c98c5ef3b8a 与远端一致。未取得固定 RC 完整运行环境、真实候选和 Vite+，未执行服务端入口真实离线计划、全仓检查或任何 PostgreSQL 操作，48 项是待执行的真实实验输入而非已通过数据库用例。

### 2026-11-26 · 固定 CHECK 往返事务模拟与隔离边界

PR #234 已按维护者明确授权合入集成分支，Squash 提交 `1641e2277706c00903d6350b7aa803d3adb20d36`。维护者 Windows 实际 HEAD `92d32648ff23e7d1dd501fc5635a0691630d66d7` 的四组专项 33/33（8+10+8+7）、共享配置、Vite+ 575 格式文件/414 受检文件零警告错误、中文 441 文件、Markdown 96 份均通过；增量退出码 0，真实固定包离线计划退出码 0，工作区干净。远端相对交付 HEAD 仅三份源码排版调整，未返回额外 CI 记录。真实计划指纹 `17c106877fe8e3177d405ac31fb335ce76c714511ce1eef537d3cf139e723d3a`，六阶段 48 个计划输入，所有执行、真实往返、接管、签名和部署许可均 false。

本批将真实验收指纹固定到既有离线计划入口和事务协议模拟器，复算完整 payload 并要求所有许可仍为 false；计划篡改后重算亦拒绝。拟议第五座仅为模拟配置：PostgreSQL 17.11（170011），沿用第四座的镜像 ID，独立容器 `adui-scada-prisma8-check-roundtrip`、同名前缀独立卷 `-data` 与网络 `-net`、仅回环 `127.0.0.1:15434`、数据库 `adui_scada_fresh_prisma8_roundtrip`、角色 `adui_scada_native_roundtrip`。端口可用性与实际镜像、卷、网络、排序规则及集群身份尚未核验。模拟边界要求本机 Linux Docker、独立资源、容器与 TCP 集群标识相等且不同于四座冻结库的标识（允许旧库共享集群）、参照与目标排序规则元数据完全相同、23 类空库及无其他会话、数据库所有权与默认只读。模拟事实不认证来源，真实采集和同一连接的事务内复核、独占一次性许可及真实证据留存仍未实现。

模拟器按两项目标各 legacy、repair、replay 六阶段发出固定 BEGIN / CREATE TABLE / 目录反向提取；核对真实计划预期的精确谓词、约束名、列、类型、非空、验证、本地、普通持久关系及唯一单列 CHECK 等元数据，replay 只接受上一 repair 目录返回且已精确核验的表达式。每个合成值单独 SAVEPOINT，参数化 INSERT RETURNING，接受必须返回一行精确值；23514 必须对应本表指定 CHECK，23502 必须对应本表指定列。每项均 ROLLBACK TO SAVEPOINT 再 RELEASE；每阶段外层仅 ROLLBACK，确认命令状态并重新检查空库和身份。失败停止并尽力回滚，独立保留回滚与后置核验失败分类，不回显任意异常原文。该协议仅由注入的模拟适配器运行，没有真实驱动、Docker 或数据库入口，报告为 NATIVE_CHECK_ROUNDTRIP_EXECUTION_SIMULATED，所有真实许可和来源认证均 false。没有运行任何 PostgreSQL SQL、创建第五座、访问或修改四座冻结库、删除证据、重试旧迁移、签名或部署；正式 Prisma 7 不变，ADR 保持 Proposed。

协作容器 Node.js 22.16.0 实际运行新增纯模拟测试 12/12、两文件 node --check 通过，远端 Git Blob 与本地一致：核心 `3cbd314dddc3099db0d65783ca81639d25b96683`、测试 `07f4f8b43df0a7fcfc4f802bd4d17a4a056a0da9`。模拟覆盖固定指纹与篡改、身份及排序规则、六阶段 48 次参数化保存点、真实目录输出的模拟漂移、错误约束与列、错误 SQLSTATE、事务开始失败、保存点回滚异常、外层回滚失败、后置边界漂移及失败停止。没有完整仓库工具链、固定 RC 产物或 PostgreSQL 服务；Windows Vite+、文案、文档、原固定包真实离线计划复验尚待验收。48 项为模拟输入结果，不是数据库实际验证。

### 2026-11-26 · 第五座创建前宿主机只读预检

PR #235 已按维护者明确授权 Squash 合入集成分支 `449a81b406de2a895639126e68327072f22c60e9`。Windows 验收 HEAD `091af5eaef1ae80ed19479d9b5b5edbc03e3b945`：三组专项 30/30（12+8+10），Vite+ 577 格式文件、416 受检文件零警告错误，443 个中文文案文件、96 份 Markdown，增量和真实离线计划退出码 0，工作区干净。固定计划指纹 `17c106877fe8e3177d405ac31fb335ce76c714511ce1eef537d3cf139e723d3a`，全部数据库执行及签名部署许可仍为 false。

本批只增加第五座创建前宿主机只读预检。拒绝非 Windows、附加参数和 Docker 环境覆盖；先从本机上下文取得端点，仅允许两种固定 Windows 命名管道，后续 Docker 查询显式固定 --host，并要求 Linux 引擎、第四座保留容器镜像 ID 与本机固定镜像完全相同、第五座容器/卷/网络均不存在（含停止容器），再用无 Profile 的固定 Windows PowerShell Get-NetTCPConnection 检查所有本地 TCP 记录中的 15434。任何子进程异常、非零、信号、标准错误、资源重名或端口异常均短路并仅返回固定中文诊断；子进程不继承数据库连接串或凭据。不执行 Docker exec、run、pull、create、删除或 PostgreSQL 操作。报告 NATIVE_CHECK_ROUNDTRIP_HOST_REVIEW_REQUIRED，仅表示当前宿主机观察通过，不认证真实数据库来源；portReserved、resourceCreationAllowed、observationSourceAuthenticated、databaseExecutionAllowed、roundTripVerified、historicalAdoptionVerified、signingAllowed、deploymentAllowed 均为 false。端口检查不是端口预留，不能证明排除端口范围、未来竞争或 Docker 发布成功。第五座仍未创建，后续身份、排序规则、23 类空库与实际执行许可需分别核实；四座数据库及正式 Prisma 7 保持冻结边界。

ADR 仍为 Proposed；本批不提供实例创建入口或数据库执行入口。

### 2026-11-26 · 冻结库排序规则只读核验决策

维护者 Windows 在 HEAD `ea010893095dcaf434f06dba844f819822b4e45a` 实测 PR #236：三组定向专项 28/28（8+12+8），共享配置通过，Vite+ 579 个格式文件/418 个受检文件零警告错误，445 个自有代码或配置文件通过中文文案，96 份 Markdown 通过；增量及真实离线计划、宿主机只读预检退出码 0，工作区干净。固定计划指纹 `17c106877fe8e3177d405ac31fb335ce76c714511ce1eef537d3cf139e723d3a` 不变。真实宿主机报告 NATIVE_CHECK_ROUNDTRIP_HOST_REVIEW_REQUIRED，hostPreflightPassed/portObservedUnused=true，portReserved、resourceCreationAllowed、observationSourceAuthenticated、databaseExecutionAllowed、roundTripVerified、historicalAdoptionVerified、signingAllowed、deploymentAllowed 均 false。GitHub 核实最终 HEAD 与 Windows 日志一致、无冲突和未解决审查意见，维护者明确授权后 Squash 合入 `41a13e7679668c60307e85a8db583b88eba6d209`。端口观察不是预留，未创建第五座实例。

本批仅开发第五座创建前的冻结库系统目录只读采集入口，不提供创建或写入命令。单独确认参数 `--confirm-frozen-catalog-readonly` 之外的任何参数均拒绝；先复用既有宿主机预检，在同一个已核验 Windows 本机 Docker 端点内，以固定 Compose 项目/服务标签定位唯一历史 PostgreSQL 容器并核对运行状态和完整容器 ID；核对第四座容器运行状态、独立实验标签、固定镜像与不同容器 ID。仅两次固定 `docker exec`：通过容器内 `postgres` 系统用户、清空进程继承环境、固定 Unix socket、非交互 psql、不加载 psqlrc、不提示口令，分别访问 adui_scada_test 和第四座专用库。每次使用 `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`、固定超时及 default_transaction_read_only、只读 SELECT `pg_catalog.pg_database`/`pg_control_system()` 并 ROLLBACK；前三库通过同一共享系统目录精确核对三条目标元数据，不分别连接其业务数据库。真实连接身份、角色、170011 版本、当前和默认只读、重复读、目标数据库集合、两个集群标识不重复均须通过。仅比较四个冻结库的 UTF8、locale provider、LC_COLLATE、LC_CTYPE、locale、记录版本及实际排序规则版本；缺失、未知、自定义 ICU 规则或版本漂移一律停止另行评审。不读取业务表、配置凭据、根 .env 或完整容器环境，不修改数据库、容器、卷、网络、访问权限或既有证据，不自动降级认证或重试。此阶段保守地要求四个库的排序规则完全相同；实际存在不同合法设置也必须人工评审，不能为通过而刷新排序规则版本。报告只输出经白名单校验的参考排序规则及计数，不输出容器/集群原始标识。报告状态 NATIVE_CHECK_ROUNDTRIP_REFERENCE_REVIEW_REQUIRED，observedDatabaseCount=4、observedClusterCount=2、referenceCatalogObserved/allFrozenCollationsMatch/recordedCollationVersionMatches=true，沿用宿主机八个 false 许可字段；不认证后续目标 TCP 集群或保证下一次状态不变。第五座创建、独立凭据、目标同一连接内核验及真实 48 项实验仍须单独授权和实现。

PostgreSQL 17 系统目录与排序规则版本参考 https://www.postgresql.org/docs/17/catalog-pg-database.html 和 https://www.postgresql.org/docs/17/functions-admin.html 。新实例初始化参数应由真实参考目录决定，不能仅凭镜像或默认 locale 推断。ADR 保持 Proposed；正式 Prisma 7 唯一迁移执行者不变。

### 2026-11-27 · 排序规则版本不可用与受限运行环境观察

PR #237 已经维护者明确授权 Squash 合入 `fc459570f39708cc3746bc140d8d9e3fe96d6425`。Windows 增量验收四组专项 35/35（7+8+12+8），共享配置通过，Vite+ 582 格式文件/421 受检零警告错误，中文文案 448 文件、Markdown 96，退出码 0、工作区干净；增量日志未独立打印本机 HEAD。维护者另行明确授权四个冻结库系统目录只读核验，并在已打印的合并 HEAD 上实际执行固定离线计划与目录采集，退出码 0；计划指纹 `17c106877fe8e3177d405ac31fb335ce76c714511ce1eef537d3cf139e723d3a` 不变，四库两集群、UTF8、libc（c）、LC_COLLATE/LC_CTYPE 均为 en_US.utf8、locale=null、记录版本=null，旧报告 recordedCollationVersionMatches=true。旧源码将实际版本与记录版本作严格相等比较，由此可知实际版本亦为 null；这只能证明目录字段相同，不能视为排序规则版本或运行库身份已获认证。八项宿主机许可均为 false。

本批修正 PR #237 的目录报告语义，保留已记录的历史原始结果，不改 SQL 查询、只读事务、角色、库名、端口、固定证据及正式 Prisma 7。新增 actualVersion 字段；仅两版本均存在且相等才报告 recordedCollationVersionAvailable=true、recordedCollationVersionMatches=true、recordedCollationVersionStatus=MATCHED；libc 两版本均为 null 时报告 false/null/UNAVAILABLE，缺失字段、单侧 null、版本不一致、非 libc 双 null、自定义规则均拒绝。保留 allFrozenCollationsMatch 兼容字段，其含义仅为目录元数据一致，并以 allFrozenCollationCatalogMetadataMatch 明确说明。两座容器必须与已固定镜像 ID 相同；仅通过 Docker inspect 的固定模板读取挂载目标 JSON（不读取源路径或环境），并以两次 docker diff 检查指定 libc/locale 路径及其祖先和子树的可见变更。路径不规范、挂载覆盖、可见文件变更、异常输出均先于数据库连接拒绝，保留固定中文诊断。本次保守规则也可能因 Docker 报告的祖先目录变更而拒绝正常容器，须评审实际观察，不删除、重建、清理或修改冻结容器以通过。成功仅报告 containerImageIdentityMatched=true、localeRuntimePathsObservedUnchanged=true，collationRuntimeIdentityVerified 始终为 false；Docker inspect/diff 不是实际进程加载库的内容哈希或 locale 行为认证，亦不排除未列路径、环境覆盖、并发变化。第五座尚未创建，后续创建与真实执行仍须分别授权；所有许可及来源认证继续为 false。

后续第五座的拟定初始化元数据来自真实目录：UTF8、libc、en_US.utf8 的 LC_COLLATE/LC_CTYPE；不可将目录元数据或镜像 ID 当作实际运行库等价的充分证据。实际初始化、目标 locale 可用性及集群身份须另行核验。ADR 仍为 Proposed。

### 2026-11-27 · 第五座实验宿主机端口调整

维护者明确要求将尚未创建的第五座 CHECK 往返实验宿主机端口由 15434 改为 15444。当前唯一固定目标为 `127.0.0.1:15444`，容器内 PostgreSQL 端口仍为 5432；其他目标身份、镜像、库名、角色、卷、网络和四个冻结库均保持原状。此决定取代前文的第五座 15434 拟议配置，不修改前文历史验收证据。`roundTripTarget.port` 是运行时单一配置源；宿主机预检继续要求所有目标端口 TCP 记录为空数组，旧 15434 及其他目标端口的模拟身份拒绝。不接受环境或参数覆盖，不自动选择端口，不清理进程，不改变创建或执行许可。固定离线往返计划不包含宿主机端口，计划指纹 `17c106877fe8e3177d405ac31fb335ce76c714511ce1eef537d3cf139e723d3a` 不变。15444 实际可用性、排除端口范围及未来发布绑定尚未核实。

ADR 仍为 Proposed；不授权实例创建、数据库写入或 Provider 切换。

### 2026-11-27 · 第五座独立实例待审批创建契约

维护者 Windows 在 HEAD `1321aab1a1a1f52289e1d43d5b6f9b50aef4201b` 完成四组专项 40/40、共享配置、Vite+ 582 格式/421 受检文件零警告错误、中文 448 文件、Markdown 96，增量退出码 0。15434 实际由其他项目容器占用，按维护者决定改用 15444；历史及第四座容器退出后已由维护者恢复原有容器运行。固定离线计划及四库目录真实复验退出码 0，15444 观察无占用，四库两集群及固定镜像、指定路径检查均通过。UTF8、libc、LC_COLLATE/LC_CTYPE 均为 en_US.utf8，locale/version/actualVersion 均 null；recordedCollationVersionAvailable=false、recordedCollationVersionMatches=null、状态 UNAVAILABLE，collationRuntimeIdentityVerified=false，八项许可均 false。工作区干净，维护者明确授权后，PR #238 Squash 合入 `fb0cbd681b19ddd8997401b8f5b9d95ab86fd4ea`，无额外远端 CI 记录。端口未预留，尚未创建第五座。

本批仅增加第五座待审批创建契约及请求匹配器。只读入口复用同一固定本机 Docker 端点的四库目录采集，要求整份参考报告与 PR #238 真实观察完全一致；拒绝缺失、额外、伪造许可、旧端口、资源或镜像变化、排序规则漂移。计划固定 127.0.0.1:15444 -> 5432、原镜像 ID、新独立容器/本地命名卷/专用 bridge 网络、禁止复用现存资源、禁止拉取镜像、禁止自动重启，部分创建失败应保留现场。卷目标拟定为 /var/lib/postgresql/data；实际固定镜像卷声明及入口行为尚待验证。初始化拟定 UTF8、libc、--locale=en_US.utf8（统一 locale 类别，不将其他类别视为已核验）、本地和 TCP 均 SCRAM-SHA-256；专用角色作为隔离实例 bootstrap superuser，禁止用于生产。凭据策略为专用环境变量 SCADA_PRISMA8_NATIVE_ROUNDTRIP_PASSWORD、32 字节随机数十六进制编码；本批不读取、生成、保存或输出任何真实凭据，不修改根 .env。实际初始化阶段不得提前开启阻止 bootstrap 的全局只读；初始化后未来受控连接必须验证默认只读设置。参数根据 PostgreSQL 17 initdb 文档 https://www.postgresql.org/docs/17/app-initdb.html 拟定，Docker 固定镜像实际初始化、SCRAM 本地认证及 locale 可用性仍需后续验证，失败不得降级、改变既有库或自动重试。创建计划 SHA-256 独立于原 CHECK 往返计划指纹。请求匹配器仅核对专用确认字符串与重新计算的创建计划指纹，不能认证操作者、消费一次性授权或发出 Docker 写命令；当前只读 CLI 不接受创建参数，没有实例创建入口。即使请求匹配，所有许可、creationAttemptClaimed 及完整运行时身份认证仍为 false。未来须在单独明确授权后实现并复验创建执行器、一次性记录、目标资源所有权与竞争检查、凭据传递、实际集群身份排除、排序规则、23 类空库及其他会话检查；不得将已匹配指纹当作真实写入授权。

ADR 仍为 Proposed，正式 Prisma 7 Provider 不变。

### 2026-11-27 · 停止态创建与启动初始化分离

维护者 Windows 在 HEAD `9fb7261f692b7d1b2756a18719a660c13f36b5d0` 完成 PR #239 验收：五组专项 48/48、共享配置、Vite+ 585 格式/424 受检文件零警告错误、中文 451 文件、Markdown 96、增量退出码 0；正常提交并推送两份源码格式化，远端核对无业务语义变化，真实离线往返计划及创建计划复验退出码 0，工作区干净。原往返计划指纹 `17c106877fe8e3177d405ac31fb335ce76c714511ce1eef537d3cf139e723d3a`、创建计划指纹 `69cd50940b9e3ff9752aa45eea3ff60bc34214ca7127908259a54897c6013dd7` 均一致，所有许可及 creationAttemptClaimed=false。维护者明确授权后 Squash 合入 `8b8f5b569b375e11a0fb0c4d2bcd1caec302caa1`，无额外远端 CI 记录。

本批新增受控停止态资源创建执行器：固定 Windows 本机、已验收的专用确认字符串及创建计划指纹，专用凭据只接受 64 位小写十六进制格式，不将格式检查视为随机性证明。重新执行已授权的四库系统目录只读采集，并保留同一预检取得的本机 Docker 端点（不改变原公开报告）；严格复算创建计划并检查固定镜像 ID、唯一卷声明 /var/lib/postgresql/data、入口 docker-entrypoint.sh 和命令 postgres。首次 Docker 写命令前，在同一工作区根目录 `.artifacts/prisma8-native-check-roundtrip-creation` 原子独占创建目录并以 wx 及 flush 写入 attempt.json，记录固定指纹与 128 位随机尝试标识，不含凭据；路径链接、任何已有目录或登记失败均拒绝。依次创建专用 local 数据卷、bridge 网络、停止态容器，仅回环 127.0.0.1:15444 映射 5432，镜像 pull=never、restart=no、volume-nocopy，所有资源带固定 scope 与本次尝试标签；检查卷驱动、标签、无额外选项、容器占用，网络完整 ID、唯一名称、标签及端点占用，随后检查容器完整 ID、created 状态、固定镜像、卷挂载、HostConfig 端口配置、网络模式、禁止特权/自动移除/全部端口发布、入口及命令，最后复验卷与网络归属并独占保存 result.json。Docker volume create 同名可能复用，不能仅凭返回名称判成功；任何异常均停止、保留记录和部分资源，不清理、不重试、不启动。专用环境变量 SCADA_PRISMA8_NATIVE_ROUNDTRIP_PASSWORD 仅通过创建容器子进程 POSTGRES_PASSWORD 传递，不进入命令参数、报告、记录或源码；其他子进程仅继承既有系统白名单。不读取完整容器环境，Docker 管理员仍可访问容器保存的环境值，后续必须保护该本机凭据。停止态成功报告只描述观察到的资源及已消费的尝试记录；containerStarted、databaseInitialized、portReserved、resourceCreationAllowed、databaseExecutionAllowed、roundTripVerified 等均 false。停止态端口映射配置不等于实际端口绑定，卷标签及本地登记不能防御具备 Docker/文件系统管理权限的并发操作者或跨工作区故意重置；实际启动前须重新核验归属、容器配置、端口及证据。本批未创建真实资源、未运行 Docker start/SQL/迁移，不改变四个冻结库、历史证据或正式 Prisma 7。真实停止态创建必须在验收、合并后取得维护者单独明确授权；启动与初始化仍为后续独立阶段。

Docker 行为依据：同名卷可能被复用（https://docs.docker.com/reference/cli/docker/volume/create/），`docker container create` 不启动容器（https://docs.docker.com/reference/cli/docker/container/create/），volume-nocopy 禁止默认文件复制（https://docs.docker.com/engine/storage/volumes/）。ADR 仍为 Proposed，实际启动初始化和真实 SQL 执行保持冻结。
