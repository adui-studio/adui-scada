# Docker 原生运行角色准备预览（B1）

- 状态：B1 已合并；B2 真实回滚演练通过，待维护者独立正式创建验收
- 日期：2026-11-28
- 前置：[原生业务连接安全评审](docker-native-business-connection-review.md)、[ADR-0073](../adr/0073-prisma8-fresh-install.md)、[ADR-0065](../adr/0065-oidc-bff-and-project-api.md)
- 关联：FR-001、FR-008、FR-013、FR-014、NFR-006
- 基线：PR #257 已 Squash 合入 feat/mvp-first-integration 的 8d94a418021376d6803b16bb793eefcf4a79b280。

## 1. 真实证据及本批边界

A 阶段维护者实测 PostgreSQL 19.0，当前 adui_scada 是两个逻辑库共用的登录超级用户，具备创建数据库、创建角色、复制及绕过 RLS 权限，未发现成员关系；两个拟议独立运行角色均不存在。两个数据库均由当前角色拥有，PUBLIC CONNECT=true，SCADA 12 张及 Keycloak 101 张 public 表均由该角色拥有且具备全部核查权限；两库额外非系统 Schema 和 public 序列数均为 0，原生存储指纹及结构注释不变。详见 [验收记录](../VALIDATION.md)。

本批只实现从最新真实目录核查结果到固定 SQL 准备预览的确定性映射，不运行该 SQL，不创建或登录角色，不修改现有角色、密码、ACL、所有权、Compose、Provider、OIDC、业务数据、原生契约或运行服务。新增独立命令 `pnpm run docker:db:role:plan`。不接收外部 JSON、任意 SQL、数据库地址或应用参数；复用已验收的本机 Docker、固定端口、随机秘密、集群前后复核、两库独立只读事务、严格 Prisma 8 契约及中文注释核验。

预览只接受当前真实基线：PG 19.0、固定指纹、12 表/85 字段/36 CHECK/20 索引/13 外键/119 注释、两个运行角色不存在、共享角色属性及零成员、两库所有权及有效权限、Schema、12/101 表权限计数、零额外 Schema/序列、marker 与集群函数权限均一致。任一基线漂移拒绝生成方案，不自动放宽，不自动重试。新版本或 Keycloak 表计数变化必须重新核查和评审。

## 2. 固定准备预览（不是执行许可）

| 对象                           | 本批 SQL 预览                                                                                 | 不授予                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| adui_scada_runtime             | NOLOGIN、无密码、NOSUPERUSER、NOCREATEDB、NOCREATEROLE、NOREPLICATION、NOBYPASSRLS、NOINHERIT | 登录、成员关系、管理权限、所有权                        |
| adui_scada_keycloak_runtime    | 同样的 NOLOGIN 属性及本库 CONNECT                                                             | 登录、业务库权限、Schema 创建、对象所有权、Keycloak DML |
| SCADA 数据库                   | 显式 CONNECT                                                                                  | CREATE、直接新增 TEMP 权限                              |
| public、prisma_contract        | SCADA 运行角色 USAGE                                                                          | CREATE                                                  |
| public.scada_projects          | SELECT (tenant_id, project_id, head_revision)，仅覆盖当前 Provider 启动缺失工程查询           | 整表读写、正式工程 API 权限                             |
| prisma_contract.marker         | SELECT (space, core_hash)，仅覆盖当前契约标记查询                                             | UPDATE、DELETE、DDL                                     |
| pg_catalog.pg_control_system() | SCADA 运行角色精确 EXECUTE                                                                    | 广泛监控角色或超级用户权限                              |

预览包含两条固定 CREATE ROLE 和六条固定 GRANT，均以 adui_scada 为执行数据库预案；CREATE ROLE 是集群范围操作。命令仅输出这些固定文本与状态，不连接新角色，不执行任何 CREATE、GRANT、REVOKE 或 ALTER。NOLOGIN 并非完整的有效权限隔离，其他角色成员关系和 PUBLIC 仍须核查；当前 PUBLIC CONNECT 允许连接，不得把上述显式 CONNECT 解释为对其他库的拒绝。实际创建和授权仍需维护者单独明确授权及下一批受控执行器，禁止直接复制预览 SQL 执行。

## 3. 正式业务权限需求矩阵（源码事实，未批准授权）

已核对 [原生会话](../../apps/server/src/auth/prisma8-session-operations.ts)、[OIDC 登录事务](../../apps/server/src/auth/prisma8-oidc-login-operations.ts)、[授权读取](../../apps/server/src/auth/prisma8-authorization-read-store.ts)、[工程版本](../../apps/server/src/projects/prisma8-runtime-project-version-store.ts)、[工程查询](../../apps/server/src/projects/prisma8-project-query-store.ts)、[发布仓储](../../apps/server/src/projects/prisma8-runtime-project-release-store.ts)、[历史归档](../../apps/server/src/history/prisma8-tag-history-store.ts)、[原生 Provider](../../apps/server/src/database/prisma8.service.ts) 的当前真实语句。下表描述业务实际访问，不是本批 GRANT 白名单，也不替代逐列 SQL 检查和实际角色测试。

| 业务表                       | 当前代码的必要读取/修改范围                                      | 不得据此放开                      |
| ---------------------------- | ---------------------------------------------------------------- | --------------------------------- |
| scada_identities             | 可信主体查询及 FOR SHARE 锁                                      | 直接修改主体状态、租户或主体标识  |
| scada_external_identities    | 预绑定映射读取                                                   | 自动创建映射或改租户              |
| scada_auth_sessions          | 查询、签发 INSERT、仅 revoked_at 更新；发布读取锁会话            | 任意会话字段修改或删除            |
| scada_oidc_transactions      | 创建、条件消费 consumed_at、按 Issuer 和过期条件有界 DELETE      | 任意清表或复用登录事务            |
| scada_projects               | 列表及详情、创建 INSERT、head_revision/updated_at CAS 更新及行锁 | 删除工程、任意修改租户或主键      |
| scada_project_grants         | 完整 ACL 读取；创建工程时固定三项权限 INSERT；发布读取行锁       | 任意授权、提升为发布权限          |
| scada_project_versions       | 不可变版本 INSERT 与读取；发布读取 FOR SHARE                     | 更新或删除历史快照                |
| scada_project_audit          | 版本成功审计 INSERT 与回读                                       | 修改或删除审计                    |
| scada_project_release_state  | 创建工程时初始化代次 0；当前发布读取锁                           | 发布指针 UPDATE、代次推进         |
| scada_project_release_events | 当前发布事件读取与锁；发布写路径受固定安全门禁拒绝               | INSERT/UPDATE/DELETE 正式发布事件 |
| scada_tag_history_batches    | 内部归档批次 INSERT、冲突读取                                    | 更新或删除已提交批次              |
| scada_tag_history_records    | 内部明细批量 INSERT 与有界读取                                   | 更新或删除历史记录                |

当前工程读取、身份签发及发布读取存在 PostgreSQL FOR SHARE / FOR UPDATE 行锁。PostgreSQL 19 [权限文档](https://www.postgresql.org/docs/19/ddl-priv.html) 明确此类查询除 SELECT 外还要求至少一列 UPDATE 权限；严格只读事务亦不能使用这些行锁。因此不能只给 SELECT 后声称既有根模块全部能运行，也不能为通过测试给身份状态、ACL、不可变版本或发布事件任意 UPDATE。项目现有 [发布安全门禁](../../apps/server/src/projects/project-release-safety-gate.ts) 固定拒绝，保持不变。实际角色只提供数据库对象权限边界，不代替应用租户/ACL/CAS；后续须评审能保持现有锁内授权、不可变性和并发语义的最小方案（包括是否需要专用锁入口）。不得直接取消行锁，不将整个表 UPDATE 当作锁权限捷径；涉及 SQL 函数、额外 Schema 或对象变动须专项评审其安全、search_path、权限与严格原生契约影响。

## 4. 后续实施门禁

1. B1 预览真实成功后，再审批独立 NOLOGIN 角色创建及精确启动读权的受控事务实现。实际执行须重新严格核验集群、候选角色不存在、当前基线及固定预览，不接受任意 SQL；成功须复验原生契约、角色属性、无成员/所有权、实际有效权限及无业务行改动，失败保持现场。回退只允许明确授权后针对本次新角色及精确授权，禁止 DROP OWNED、全局 REASSIGN OWNED、清库及卷操作。预览成功或 NOLOGIN 角色存在均不等于正式准入。
2. 核对所有可连接数据库及 PUBLIC CONNECT/TEMP、有效权限和已有消费者。只有明确评审影响范围后才能回收具体权限；不能仅检查两个业务数据库就宣称整个集群隔离。
3. Keycloak 独立核对实际对象类型、所有权、ACL、默认权限及 Schema 演进需要。101 张表均由旧共享管理角色拥有，但报告不覆盖全部对象类型，不能用全局所有权转移或 GRANT ALL 代替。暂不调整 Keycloak 镜像、数据库所有权、服务身份或密码。[Keycloak 官方数据库指南](https://www.keycloak.org/server/db) 当前 PostgreSQL 支持列表最高为 18，仓库本机 PG 19.0 与 Keycloak 已完成的只读回归不等于官方支持或生产升级资格；保持维护者当前版本选择，后续独立实测启动及 Schema 管理，不擅自降级。
4. 审查 SCADA 行锁及正式业务最小权限；分别证明应允许的实际连接、固定读取及事务路径，以及拒绝跨库、身份/ACL 越权、快照及审计篡改、正式发布、管理权限和 DDL。正式 LOGIN、独立凭据、既有容器凭据切换、OIDC 与双框架联调均须独立授权及验收。默认服务继续当前严格只读。

## 5. 验证

协作环境 Node.js 22.16.0 对新增核心及测试文件执行 node --check 和 node --test，5/5 通过；Git Blob 分别为 937c3594940f0d18513bb39453f4ba4a724bffef 和 96bf64fc0ebb58387b7329af3fecdac4ffa2943b，与远端回读一致。另从维护者本次真实验收日志提取完整 JSON，离线调用同一纯函数，返回 DOCKER_DB_ROLE_BOOTSTRAP_PLAN_READY、8 条固定 SQL、planOnly=true、admissionPassed=false、databaseWritten=false，退出 0；没有连接数据库或执行 SQL。新增实际入口、环境静态门禁及全仓质量链待 Windows 验收，真实预览仅在维护者本机执行。

Windows 增量：`pnpm run test:docker`（预计 73 项）、`pnpm run test:prisma8:fresh`（预计 29 项）、`pnpm run env:check`、`pnpm run messages:check`、`pnpm run docs:check`、`vp check --fix`、`vp check`、`git diff --check`。之后单独执行 `pnpm run docker:db:role:plan`，预期状态 DOCKER_DB_ROLE_BOOTSTRAP_PLAN_READY、directoryReviewPassed=true、planOnly=true、admissionPassed=false、databaseWritten=false、serviceSwitched=false 及退出 0。无需重建镜像或重新初始化数据库；预览 SQL 不执行。

## 6. B2 独立角色事务候选

PR #258 已经维护者 102/102 自动化及真实预览验收，Squash 合入集成分支 `569bc45c2162eda28d8161011455d5810e6804fc`。

B2 候选实现复用 B1 八条固定 SQL，在独立 SERIALIZABLE READ WRITE 事务中获取固定事务级 advisory lock，前后重验同一业务库目录、集群、会话身份及读写模式。仅允许两个既定 NOLOGIN/NOSUPERUSER/无密码角色及原预览启动读权；验证角色属性、成员和配置不存在、无非预期所有权/跨库依赖、十项直接 ACL（包含五个列权限）、有效表/列/序列/Schema/数据库 CREATE 边界，并以 SET LOCAL ROLE 执行固定启动读取探针，再恢复管理身份。明确保留 PUBLIC CONNECT，两个候选角色仍可获得跨库有效 CONNECT，尚未完成隔离或正式 LOGIN 准入；Keycloak 对象所有权、完整权限及业务写入授权仍待专项。事务演练执行真实目录 DDL 和 GRANT 但 ROLLBACK，随后重新严格结构、注释与双库只读核查确认两角色不存在；独立创建模式只有精确确认参数才可 COMMIT，提交后重验相同基线和实际角色属性/ACL。提交结果未知、关闭失败、后置失败均拒绝成功，不自动重试、删除角色、清理容器或卷。没有业务 DML、现有角色密码或服务绑定修改；不启用 OIDC、发布或正式运行身份。事务级锁仅协调同一执行器，不替代对外部并发管理员变更的控制；实际操作前禁止并发权限维护。

### 入口与验收边界

- `pnpm run docker:db:role:bootstrap --confirm-rehearse-docker-roles`：真实事务回滚演练，必须明确确认；预期 `DOCKER_DB_ROLE_BOOTSTRAP_REHEARSED`、`catalogStatementsExecuted=true`、`rolledBack=true`、`committed=false`、`rolesPrepared=false`、`postVerificationPassed=true`、`databaseWritten=false`、`businessDataWritten=false`、`admissionPassed=false`、`serviceSwitched=false`。这里的 databaseWritten=false 指没有提交本次目录变更，而非未执行目录 DDL。
- `pnpm run docker:db:role:bootstrap:status`：只读状态核查，预期 `DOCKER_DB_ROLE_BOOTSTRAP_STATUS_READY`。演练后应为 `rolesPrepared=false`，若两个角色已存在则必须重新精确核验。单一角色存在、基线或权限漂移均失败；失败须保留现场。
- 正式创建模式已实现，必须使用不同的独立确认参数，并在演练、代码及实机验收通过后由维护者另行授权；本批不安排实际提交。程序的精确参数校验不替代维护者的审批流程，也未持久化演练审批凭证。
- 不进入 docker:up 或 ready；仅新增离线测试进入 test:docker。状态/演练需当前本机固定 Docker PostgreSQL 集群及严格原生契约；不需要重建镜像、停止服务或重新初始化。

本次协作环境 Node.js 22.16.0 对新增执行核心及测试文件执行 node --check 和 node --test，8/8 通过；实际执行文件 Git Blob 核心 6435e52a8a998070921ca3ce16f8f35eee45276e、测试 b91cf3685dd6085e469b3f96e49b24a9a9520aad 与远端回读一致。新增两项事务内目录核查测试及扩展 CLI 参数断言、完整 Docker 专项预计 83 项、Prisma 8 全新专项预计 29 项、env/messages/docs、Vite+、真实 PG19 SQL 与演练均待维护者 Windows 复验；未连接数据库或执行 SQL。

增量验收先执行 `pnpm run test:docker`、`pnpm run test:prisma8:fresh`、`pnpm run env:check`、`pnpm run messages:check`、`pnpm run docs:check`、`vp check --fix`、`vp check`、`git diff --check`，再执行独立回滚演练及只读状态核查；任何失败均停止，不尝试正式提交或自动修复权限。严格原生结构在事务外复核，不能把尚未实际执行的目录提交与 Prisma 严格兼容性视为已证实。

## 7. B2 真实演练失败及诊断恢复门禁（E-166）

维护者 Windows 实测 PR #259：Docker 83/83（角色事务 8/8、事务内目录 2/2），Prisma 8 全新专项 29/29，共 112/112；环境/LF、中文 386 文件、Markdown 99 份、Vite+ 521 格式文件及 360 受检文件零警告/Lint/类型错误、git diff --check 均通过，增量退出码 0。维护者已推送格式化提交 6426a35570f6fd71d5b3baedc5eef44004da2b67，相较 1f009bd683dc28263a6501837e9a02b1e2a5d4f3 的四文件差异已核对为排版。真实 `docker:db:role:bootstrap --confirm-rehearse-docker-roles` 进入角色属性、精确授权及有效权限核验阶段后失败，退出码 1；&& 短路导致独立状态核查未执行。未获得具体 SQLSTATE、断言差异及独立角色状态；不据此宣称数据库层根因已定位或真实演练通过。

最小诊断修复：仅修改 `scripts/docker-db-role-bootstrap.mjs` 及对应 Node 测试。对角色属性、直接 ACL、有效对象权限、有效列权限、切换运行角色、运行角色身份及标记、启动工程读取、恢复管理身份八个固定步骤分别脱敏；仅允许 PostgreSQL 官方白名单 SQLSTATE（未知为 UNKNOWN），精确匹配失败仅报告预期/实际行数、未匹配的固定预期项序号和预期字段名，不回显实际目录名、值、连接串、凭据、SQL 原文或第三方错误正文。失败路径只有收到 ROLLBACK 命令标签才补充回滚确认，回滚未知及提交未知仍拒绝成功、禁止自动重试。原八条 SQL、所有权限白名单、精确匹配条件、确认参数、Compose、业务数据和正式准入均不变；真实根因尚待新诊断证据。

诊断预期项序号对应代码中固定预期数组的 1 起始顺序；例如直接 ACL 的 10 个预期项是两个数据库 CONNECT、两个 Schema USAGE、五个列 SELECT、一个函数 EXECUTE。缺失行和多余行仍严格失败，不能仅因回滚确认就判定验收成功。先单独执行 `pnpm run docker:db:role:bootstrap:status` 并检查退出码 0、`rolesPrepared=false`；若已存在角色、状态不一致或失败，停止并保留现场，不删除、不回收权限、不执行创建。再完成定向测试与全仓增量质量复验，只有只读状态明确确认两个角色不存在且质量门禁通过后，才单独重新执行已明确确认的回滚演练；如仍失败，只提供新脱敏诊断，不执行正式创建或反复重试。PR #259 保持 Draft。

## 8. B2 混合对象类型保护修复（E-167）

维护者 2026-11-28 Windows 于 096f5962c8126646773062ad8f0faf33c746bf7e 实测：演练前角色只读状态退出 0、rolesPrepared=false；Docker 85/85（角色事务 10/10）、Prisma 8 全新专项 29/29，合计 114/114；环境及 LF、中文 386 文件、Markdown 99 份、Vite+ 521 格式文件/360 受检文件零警告、Lint/类型错误及 git diff --check 全通过，增量退出 0。真实演练进入有效对象权限查询后返回 SQLSTATE=42809，并明确报告事务已确认回滚，退出 1；演练后独立只读状态退出 0，rolesPrepared=false、admissionPassed=false、databaseWritten=false、publicConnectRetained=true，存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436 不变。维护者随后推送 195194ec103c846b995f3e0a1e8692ec31b3d870，两文件差异核对仅为格式化。E-166 的脱敏分阶段诊断及失败回滚确认已获真实证据，诊断缺陷关闭，但 B2 演练仍未通过。

SQLSTATE 42809 是 wrong_object_type。当前有效对象权限 SQL 从含表、索引等多种 relkind 的 pg_class 查询混合关系目录，却依赖 AND/OR 中 relkind 过滤保护类型专用权限函数。依据 PostgreSQL 19 [表达式求值规则](https://www.postgresql.org/docs/19/sql-expressions.html) 与 [访问权限查询函数](https://www.postgresql.org/docs/19/functions-info.html)，优化器可调整布尔表达式求值顺序；官方源码 acl.c 的 has_sequence_privilege_id_id 对非序列 OID 抛出 ERRCODE_WRONG_OBJECT_TYPE。已确认存在该查询缺陷，与实测阶段及错误码一致，但尚无数据库原始错误正文或执行计划来确认具体先执行了哪个函数。最小修复在 effectiveSql 与 effectiveColumnsSql 的表/列、序列及列 SELECT 三处使用 CASE WHEN relkind ... THEN 对应权限函数 ELSE false END，确保仅对适用对象调用函数。保持原关系类型、Schema、权限集合、八条角色准备 SQL、十项直接 ACL、五项列权限及所有精确证据断言不变；不吞掉 42809，不增加授权，不改角色属性、业务数据、Compose、PUBLIC 或服务绑定。

协作环境 Node.js 22.16.0 对包含相同修复的已有本地副本执行两文件 node --check 及真实 node:test，11/11 通过；新增用例检查实际传入查询函数的三个 CASE 保护结构，既有参数化负例新增 noSequencePrivileges=false，仍拒绝并确认回滚。将新增测试与未修复查询组合执行，定向旧 SQL 回归按预期 ERR_ASSERTION、退出 1；修复后退出 0。两处 SQL 替换及新增测试块 FNV-1a 分别为 a562a4a6、4a8f5f71、2b7bcccf，与远端新增块逐字节校验摘要一致；本地副本未包含此前全部排版调整，不声称最新远端整体 Blob 已在 Node 实测。远端修复核心提交 324881c3cb36eefdb35345551fb169dc224a872f、测试提交 e28f9fcdaeeac7e7dd053e8a3ef22db6b0cdf8fd，两个文件回读一致。协作环境没有 PostgreSQL/Docker，网络也无法安装依赖，未执行实际 PG 查询；新增离线测试只验证 SQL 结构和模拟负例，不代替真实执行计划或权限语义。

先同步代码并单独运行 docker:db:role:bootstrap:status，确认退出 0、rolesPrepared=false；再运行 test:docker（预计 86 项）、test:prisma8:fresh（29 项）、env/messages/docs、Vite+ 零警告、git diff --check。仅在质量检查及只读状态通过后，独立执行 docker:db:role:bootstrap --confirm-rehearse-docker-roles，确认真实混合目录查询和完整角色演练通过；无论结果如何，再独立运行 docker:db:role:bootstrap:status，确认角色仍不存在。失败保留现场，提供固定脱敏诊断；不执行正式创建，不自动重试、清理或调整权限。PR #259 保持 Draft。

## 9. B2 正式角色创建验收门禁

维护者 2026-11-28 Windows 于 HEAD b67c230a140d79664620962805fecffd2e18c1be 实测：演练前独立角色状态核查退出 0、rolesPrepared=false；Docker 九套件 86/86（角色事务 11/11）、Prisma 8 全新专项 29/29，合计 115/115；环境及 LF、中文文案 386 文件、Markdown 99 份、Vite+ 521 格式文件及 360 受检文件零警告、Lint 和类型错误、git diff --check 均通过，退出 0，工作区干净。随后真实 PostgreSQL 19.0 回滚演练返回 DOCKER_DB_ROLE_BOOTSTRAP_REHEARSED、catalogStatementsExecuted=true、rolledBack=true、committed=false、rolesPrepared=false、directoryReviewPassed=true、postVerificationPassed=true、admissionPassed=false、databaseWritten=false、businessDataWritten=false、serviceSwitched=false、publicConnectRetained=true，退出 0；演练后独立状态核查返回 DOCKER_DB_ROLE_BOOTSTRAP_STATUS_READY、rolesPrepared=false，退出 0。存储指纹始终为 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436。E-167 对象类型保护修复通过真实完整演练，关闭；无需再次改动已验收 SQL。

下一步为维护者独立执行正式创建验收，先同步仅追加文档的候选、检查工作区干净、文档检查及只读状态，确认 rolesPrepared=false、退出 0；确认本机固定 Docker 集群及无并发数据库权限维护后，使用已存在的精确确认命令 `pnpm run docker:db:role:bootstrap --confirm-create-docker-roles`。该命令会持久化两个 NOLOGIN、无密码、无管理权限角色及原八条固定语句对应的十项直接 ACL，不修改现有角色、业务行、PUBLIC CONNECT、Compose、服务凭据、OIDC 或发布门禁。只有返回 DOCKER_DB_ROLE_BOOTSTRAP_CREATED、rolesPrepared=true、committed=true、rolledBack=false、catalogStatementsExecuted=true、directoryReviewPassed=true、postVerificationPassed=true、databaseWritten=true、businessDataWritten=false、admissionPassed=false、serviceSwitched=false、publicConnectRetained=true、退出 0，并独立状态核查 rolesPrepared=true、原生指纹不变及既有 OIDC 只读和七服务状态回归通过，才完成 B2 持久化验收。无论创建结果如何都独立核查状态；失败或提交结果未知时禁止重试、手动删除或调整授权，保留现场。当前协作环境仅同步文档，不操作维护者数据库；未重新执行新增文档后的全仓检查。PR #259 保持 Draft 至真实持久化验收及维护者明确合并授权。B3 全集群 PUBLIC/跨库隔离及 B4 正式业务 ACL、Keycloak 所有权均不提前实施。

### 2026-11-28 · B2 正式角色持久化验收完成

维护者 Windows 于 `cb45fdaede179f82ec4c7f93e67f0ae9295abc87` 实测：99 份 Markdown 通过；前置状态 rolesPrepared=false，正式创建 committed=true、rolesPrepared=true、postVerificationPassed=true、databaseWritten=true、businessDataWritten=false，退出 0；独立状态 rolesPrepared=true、退出 0；存储指纹保持一致，OIDC Discovery/JWKS 只读探针、七容器状态及 git diff --check 通过，工作区干净。PR #259 经维护者授权 Squash 合入集成分支 `2278e69b6cce9b163d3d9f0046e1de41bb5a77b8`。PUBLIC CONNECT 保留，正式准入、登录及服务切换未启用。

## 10. B3 全集群 PUBLIC 权限与跨库隔离设计门禁

先实现只读清单及变更预览，不执行 REVOKE。清点 pg_database 全部数据库（含模板及禁止连接项），记录允许连接标记、所有者、连接限制、显式或默认 ACL 来源及 PUBLIC CONNECT/TEMP/CREATE；分别核对两个候选角色与现有服务身份的有效 CONNECT/TEMP/CREATE，以及角色成员关系、所有权和授权路径。不可连接数据库不得被静默遗漏。目录可连接资格不等于真实网络登录成功。

预览须识别每个受影响的现有消费者、连接池、维护任务及未知角色；未知消费者或权限漂移阻塞变更。不得通过对单个角色 REVOKE 抵消 PUBLIC 授权。不得盲目回收模板库或维护库权限，不授予额外业务对象权限。后续执行器需独立确认、固定 SQL 白名单、事务内前后验证和回滚演练；确保现有服务直接连接权限不被误撤销。正式提交需维护者另行授权。禁止切换服务身份、启用 LOGIN、修改密码、业务数据、Keycloak 所有权或正式准入。B2 既有核查中 PUBLIC 保留的基线条件须在 B3 执行器设计时明确区分变更前后状态，不得简单删除断言。

验收分为只读目录完整性、预览差异及未知消费者阻断、真实事务回滚、独立持久化状态核查和现有服务回归；实际连接拒绝验证留待独立登录阶段，不能用 NOLOGIN 角色的有效权限查询冒充真实连接测试。本提交仅为设计和验收记录，未实现或运行 B3 查询、测试或数据库变更。

## 11. B3.1 全集群数据库权限只读核查候选（PR #260）

新增独立命令 `pnpm run docker:db:role:isolation:inspect`。仅使用已持久化的 B2 角色和既有固定本机 Docker 连接边界；先执行官方严格结构与标记验证、中文注释和双库现状复核，再在 B2 的 REPEATABLE READ READ ONLY 事务内精确验证已准备角色、直接 ACL、有效对象与列权限和固定读取探针，恢复管理身份后采集全集群目录，后置业务目录一致、确认 ROLLBACK 和连接关闭，再核对本机 Docker 集群身份。角色缺失、目录不一致、查询/回滚/关闭异常均拒绝成功，不自动重试。既有 B2 创建与回滚演练 SQL 不变。

核查包含六条固定 SELECT：全部 pg_database 行（含模板、禁止连接和额外数据库、所有者、连接限制、ACL 来源与行数）；全部 pg_roles 行；aclexplode 展开的数据库 ACL（datacl 为 NULL 才使用 acldefault，显式空 ACL 保持空）；所有数据库与所有角色的 CONNECT/TEMPORARY/CREATE 有效权限矩阵；全部显式角色成员关系及 ADMIN/INHERIT/SET 选项；pg_stat_activity 当前客户端连接按库和角色聚合的数量。检查固定名称、OID 唯一性和引用完整性、每库 ACL 行数及全矩阵覆盖。仅允许固定的数据库/角色名称进入输出，未知名称为 null 并保留当前集群 OID，禁止回显查询正文、客户端地址、应用名称、凭据或原始异常。SQL 采用 PostgreSQL 19 官方访问权限查询与 ACL 函数及目录定义：[权限查询函数](https://www.postgresql.org/docs/19/functions-info.html)、[角色成员关系](https://www.postgresql.org/docs/19/catalog-pg-auth-members.html)。

输出 status=DOCKER_DB_ROLE_ISOLATION_INSPECT_READY、rolesPrepared=true、rolledBack=true、committed=false、catalogStatementsExecuted=false、databaseWritten=false、businessDataWritten=false、serviceSwitched=false、admissionPassed=false、directoryReviewPassed=true；inventory 包含 databases、roles、acl、effective、memberships、sessions、unknownLoginRoleCount、unknownDatabaseCount、unresolvedSessionCount 及 consumerReviewRequired=true、changeAllowed=false、isolationPassed=false。现有共享管理角色下的连接无法区分 SCADA、Keycloak、连接池、工具或其他消费者，且瞬时连接统计包含核查自身、不涵盖未连接的服务和未来维护任务；有效权限并不证明真实网络连接、登录或认证成功，pg_database_owner 的隐式当前库所有者语义亦不能用显式成员清单代替。未知库、角色和会话需人工核对用途，不输出原始名称；即使未知计数为零，也必须独立确认消费者，不能自动回收 PUBLIC 权限。本轮只采集目录与统计，不生成变更 SQL，不执行 REVOKE、GRANT、ALTER ROLE、业务 DML 或服务切换；未进入 B3.2 预览和 B3.3 执行器。

增量验收：协作环境 Node.js 22.16.0 对新增隔离目录模块及独立测试执行 node --check、node --test，4/4 通过。最终本地 Git Blob 模块 d9ed5183ce8fcb51427b2eaaeb1c87c38f678b3d、测试 3fddcb2fad9fae0aa8bdd38ca6400a89f25fea69。另新增三项 B2 事务集成回归与 CLI 白名单断言，预计 Docker 93 项、Prisma 8 全新专项 29 项；这些及全仓 Vite+、环境、中文文案、文档检查和真实 PostgreSQL 19 查询尚待维护者 Windows 验收。执行 `pnpm run test:docker`、`pnpm run test:prisma8:fresh`、`pnpm run env:check`、`pnpm run messages:check`、`pnpm run docs:check`、`vp check --fix`、`vp check`、`git diff --check`，再独立执行 B2 状态核查及 B3.1 只读核查。任何失败保留现场，不运行正式角色创建或权限变更。不需要重建镜像、停止服务或初始化数据库。

### 2026-11-28 · B3.1 真实验收完成

维护者 Windows 在 `4ba641356db84b4286fa58350efd98138b88af66` 实测 Docker 93/93、Prisma 8 全新专项 29/29、Vite+ 523 个格式文件/362 个受检文件零警告错误、中文 388、Markdown 99、环境及 LF 和 git diff --check，增量退出 0。正常 Hook 格式化提交 `b3c6e5c433d63025456765aa0c310796cd604f09` 已推送，五文件仅排版。真实 B2 状态及 B3.1 目录核查均退出 0，5 库、19 角色、25 ACL、95 有效权限、3 显式成员关系、两组共享管理身份连接各 2，未知数据库/登录角色/未解析会话均 0；确认回滚、存储指纹不变、七服务及 OIDC Discovery/JWKS 只读回归退出 0。PR #260 经明确授权 Squash 合入 `0c25d7477693e15abeea6bb094b880c3f0943ec6`；无额外远端 CI 状态记录。未执行 PUBLIC 权限回收或登录切换。

## 12. B3.2 精确变更预览候选

新增 `pnpm run docker:db:role:isolation:plan`，复用 B3.1 真实只读连接、原生严格验证、B2 精确角色及 ACL 复核和同一事务目录采集。只有确认 ROLLBACK、关闭连接和 Docker 集群身份未变后，调用纯函数。新模块无数据库客户端，不执行 SQL；不接入 ready/docker:up 的真实执行路径，不新增执行确认参数。以本机 PostgreSQL 19.0 已验收目录为固定基线：5 库、19 角色（15 个脱敏角色 OID 固定为已观察值，不能据此确认用途或系统角色身份）、25 ACL、95 有效权限、3 显式成员关系；未知库/登录角色/未解析连接为零，所有者、连接标志、默认与显式 ACL 来源、角色属性及逐行权限均精确比对，任何漂移拒绝生成。数据库与新运行角色的 OID 从本次固定目录取值并绑定指纹；管理身份与已观察掩码角色 OID 固定。不同 PG 小版本、集群或对象变化须重新评审。

建议完整 ACL 隔离候选拆为 BUSINESS（两业务库 CONNECT/TEMPORARY）、MAINTENANCE（postgres CONNECT/TEMPORARY）、TEMPLATE（template0/template1 CONNECT）三组，合计 5 条固定 REVOKE ... FROM PUBLIC RESTRICT 语句文本、8 条 PUBLIC ACL，预测 17 条直接 ACL 保留；各组 separateApprovalRequired=true，不生成 GRANT/ALTER ROLE/CASCADE，不改变数据库 allowConnections、模板属性、管理角色、密码、连接或其他对象。预测完整方案下共享管理身份的 CONNECT/TEMP/CREATE 保持，两个 NOLOGIN 运行角色仅各自库 CONNECT，不获得 TEMP/CREATE；postgres 原默认 ACL 变为显式 ACL。仅为全部三组获批并真实成功后的预测，不是当前目录或实际登录保证。模板库、维护库、连接池、备份、监控、维护及未来服务消费者须逐组评审；template0 当前禁止连接，回收 ACL 不改变连接标志。CONNECT 在连接启动时检查，现有连接不等于新连接成功；共享高权限会话无法证明所有消费者。参照 [REVOKE](https://www.postgresql.org/docs/19/sql-revoke.html)、[权限](https://www.postgresql.org/docs/19/ddl-priv.html) 与 [预定义角色](https://www.postgresql.org/docs/19/predefined-roles.html)。

报告绑定实际集群 systemIdentifier、存储指纹、固定顺序目录、有效权限、成员及语句为 SHA-256 planFingerprint，不包含凭据或瞬时连接数量；指纹不是签名或授权。仍保持 consumerReviewRequired=true、changeAllowed=false、isolationPassed=false、admissionPassed=false、databaseWritten=false、publicConnectRetained=true。B3.3 另行设计：必须区分 B2 的 PUBLIC 保留基线和后置预期，复核各组消费者及精确授权，独立回滚演练和单独持久化授权；不得直接执行本次预览文本。

验证：协作环境 Node.js 22.16.0 对两个新增文件 node --check 与 5 项 node:test，5/5 通过。真实日志离线提取 B3.1 JSON，以合成集群标识调用同一函数，返回 25/8/17、5 条语句、95 项矩阵及每库预测，退出 0；原始报告没有系统标识，不能把合成指纹冒充真实指纹。模块 Git Blob c3ea305c6472b91a740747c00c13d5818ea6aeea、测试 614258ff458215bd1680be1e56cb28050d759382。全仓及入口集成待 Windows 复验：Docker 预计 98、Prisma 8 全新专项 29、env/messages/docs、Vite+ 零警告及 git diff --check；再独立执行 B2 状态、B3.2 只读预览及 OIDC 只读和七服务回归。无需重建、停机、创建角色或权限写入。
