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

### 2026-11-28 · B3.2 实机验收及剩余 MVP 累计开发

维护者于 d3a7429779c5735e64c645e764017ffa7fc047b2 验收：Docker 98/98、Prisma 8 全新专项 29/29（合计 127/127），Vite+ 525 格式/364 受检零警告错误，中文 390、Markdown 99、环境及 LF 和 git diff --check 通过；格式化提交 e04775bcfa559b7d51001c9bb19c6ce319aa4690 已推送。真实 PG19.0 隔离预览 5 库/19 角色/25 ACL/95 有效权限，拟移除 8 项 PUBLIC ACL 并保留 17 项直接 ACL，指纹 0d0ead9db7e280d0d6e66464f36d392212206d71f3bdf5f57f05dbea55b45e37，rolesPrepared=true、rolledBack=true、databaseWritten=false、changeAllowed=false、isolationPassed=false；OIDC 只读和七服务回归退出 0。PR #261 经明确授权 Squash 合入 d8363fb476ee08521e1c9fb107ecd1088914ae2b。

维护者要求剩余 B3.3/B4/C/D/E/F 在累计分支开发并集中验收，不取消真实目录、授权、登录及服务切换的独立安全门禁。当前累计分支先实现 B3.3 候选：复用同一固定事务锁与原计划指纹，完整前后状态分别严格验证，五条固定 REVOKE，回滚演练及独立提交参数，提交后官方严格结构、注释、双库目录与独立只读状态复核。不改变角色 LOGIN、业务行、服务身份或发布门禁；未连接数据库，未实测 Windows 全链。B4 正式业务最小权限/行锁及 Keycloak 全对象所有权、C 正式运行连接、D 真登录、E 双端业务互通、F 完整验收仍待实现或实际验证。新增 mvp:verify:baseline 仅集中既有质量链与真实只读基线，不得作为 MVP 完成证据。

## B3.3 候选执行入口

- `pnpm run docker:db:role:isolation:status`：只读核查完整未隔离或完整隔离状态；混合状态、未知对象及其他漂移拒绝。仍不代表网络连接隔离或登录许可。
- `pnpm run docker:db:role:isolation:execute --confirm-rehearse-isolation --reviewed-business-consumers --reviewed-maintenance-consumers --reviewed-template-consumers --plan-fingerprint=<当前真实指纹>`：仅在维护者逐组实际复核消费者并明确授权后执行回滚演练，之后单独执行 status。三个确认参数只表达操作者声明，不能认证消费者身份。
- 独立持久化模式代码使用 `--confirm-apply-isolation --confirm-rehearsal-verified` 替代演练确认，保留其他参数；只有实机演练、独立状态及质量门禁通过且维护者另行明确授权后才可执行。当前不安排实际提交。禁止并发权限维护、未知结果重试或手工回收/恢复权限。状态核查仅适用于 B2 原角色权限与 B3 数据库级隔离，不覆盖后续 B4 权限变化。

### B4 双库对象清单只读候选

新增 `pnpm run docker:db:role:object-review`。首先通过原生严格契约、注释、双库与 B3 完整状态核查，再分别以固定管理角色及 REPEATABLE READ READ ONLY 事务读取两库对象目录。核对 Schema、关系、显式列 ACL、例程、类型、默认 ACL、扩展、策略、事件触发器、外部服务/包装器、发布定义以及当前数据库共享角色依赖。对象名称与 ACL 仅在本地用于稳定 SHA-256 证据；报告输出分类数量、所有者类别、未知所有者及角色依赖数量，不返回原始对象名、函数正文、订阅连接信息、外部服务选项、业务行或凭据。该目录不等于所有可执行权限、完整所有权转移方案或行锁最小权限评审；仍需要核对实际 Keycloak 版本全部对象类型及 Schema 管理需求。缺失、重复或未知目录形状失败，角色或集群漂移拒绝结果。前后 B3 计划指纹和隔离状态必须一致。B4 正式授权、所有权转移、C 正式模式和 D/E 真联调仍未实现，不自动授予 UPDATE、GRANT ALL 或切换服务。

集中基线命令 `pnpm run mvp:verify:baseline` 串联现有完整 ready、严格数据库状态、上述双库对象评审、现有 OIDC 只读探针及七服务状态；只用于集中质量链和真实只读基线，不执行隔离、所有权变更、LOGIN 或业务写入。新增隔离前后投影/事务/故障测试、参数确认测试及对象目录离线回归尚未运行完整项目工具链；不登记为通过。

### B4 共享依赖范围修正

依据 PostgreSQL 19 官方 `pg_shdepend` 定义，该目录是全集群共享目录，`dbid=0` 表示共享对象，非零 `dbid` 指向对象所属数据库；依赖类型至少区分 OWNER、ACL、INITACL 和 POLICY。此前候选只筛选当前数据库 `dbid`，会漏掉同一集群其他数据库及共享对象的依赖。现改为按固定四个角色 OID 汇总全集群所有依赖，记录数据库范围分类、对象目录 OID、子对象号和依赖类型，原始 OID 仅用于指纹，不回显。新增当前库、其他库、集群共享及 INITACL 回归，并拒绝数据库 OID 与范围标签矛盾。该修正仍是只读审计，不执行任何角色变更或 ACL 授权。

### B4 全集群共享依赖复核补充

已将 `pg_shdepend` 读取从当前数据库改为全集群共享目录：按固定四个角色过滤，包含 `dbid=0` 的共享对象及其他数据库中的依赖，并按 OWNER、ACL、INITACL、POLICY 等依赖类别与共享/当前库/其他库范围汇总。原始对象 OID 仅进入指纹，不在报告中输出。该目录在 PostgreSQL 19 官方文档中明确为全集群共享目录，且 `dbid` 为零表示共享对象；依赖类型区分所有权、ACL、初始 ACL 和策略引用。参考：[PostgreSQL 19 pg_shdepend](https://www.postgresql.org/docs/19/catalog-pg-shdepend.html)。

### B4 业务列权限候选与例程配置防护

在既有 `docker:db:role:object-review` 的 SCADA 固定只读事务内，新增 `scripts/docker-db-role-business-acl.mjs`。依据原生 `apps/server/prisma/contract.prisma` 的 12 表、85 物理列及实际认证、工程版本/查询、发布读取、历史归档 SQL，逐项检查两个运行角色的 170 个有效列权限组合。只接受 B2 已验收的三个启动 SELECT，其余列读写、表级授权、所有者能力、REFERENCES 与 grant option 必须均为 false。缺失、重复、未知字段、额外角色/表/列、权限漂移拒绝生成候选。SQL 对混合目录使用 CASE 保证类型保护；报告不输出目录中的未知名称或业务值。

仅生成固定列名的 SELECT/INSERT/UPDATE 文本和 SHA-256 候选指纹，排除已有三个启动列授权；直接 UPDATE 仅允许工程 head_revision/updated_at、会话 revoked_at、OIDC consumed_at 作为待评审候选。身份/外部身份/授权/发布状态/发布事件只生成读取候选；快照、审计、历史已写入记录不生成 UPDATE/DELETE。列级 ACL 不能替代租户/行级/状态机约束：会话撤销与 OIDC 消费仍需验证条件更新、不可复用及并发语义。五张仅为行锁而需要 UPDATE 的保护表（身份、工程授权、版本、发布状态、发布事件）明确阻塞；工程初始 ACL INSERT、初始发布状态 INSERT、OIDC 过期清理 DELETE 也必须经过固定范围的专用操作边界评审，不能自动授予。列权限预览既不执行 SQL，也不等于运行角色准入或实际最小权限验收。

同时修正 B4 对 pg_proc.proconfig 的形状校验（可为 NULL 或文本数组）及角色属性报告；两个运行角色和可选锁专用角色不允许 LOGIN、SUPERUSER、CREATEDB、CREATEROLE、REPLICATION、BYPASSRLS、INHERIT。锁专用角色是否存在、成员关系、所有权和实际 ACL 仍须独立核查。SECURITY DEFINER 配置仅在固定 search_path=pg_catalog, public, pg_temp 及 row_security=on 两项精确匹配时计数，始终报告 definerSafetyVerified=false；显式 pg_temp 最后，函数体、PUBLIC EXECUTE、实际 Schema 写权与所有者均尚未验收。参考 [PostgreSQL 19 权限](https://www.postgresql.org/docs/19/ddl-priv.html) 与 [SECURITY DEFINER 安全要求](https://www.postgresql.org/docs/current/sql-createfunction.html)。不创建角色、例程或 Schema；不改变既有业务 SQL、Prisma 契约、连接模式及 Compose。

新增离线候选测试纳入 test:docker 及既有 ready；原生契约对照、严格负向矩阵及固定查询结构均需后续累计验收。B3.3 的真实执行、B4 专用行锁/受限写入及 Keycloak 所有权、C/D/E/F 尚未完成；本批不提出中间验收命令或实际授权。

协作容器 Node.js 22.16.0 实际执行四个变更模块/测试文件的 node --check（退出 0）。`node --test scripts/docker-db-role-business-acl.cases.mjs` 5/5，通过真实 Git 原生契约文件的 12 表/85 列对照；`node --test scripts/docker-db-role-object-review.cases.mjs` 7/7，使用模拟目录及未被用例调用、调用即抛错的两个外围连接依赖替身。两组共 12/12、零失败、零跳过；不是完整 test:docker。模块/测试 Git Blob 分别为 8fc36c801048255151ac624bbebd8a1bf82c01f0、bd3b2b93bcff3e7e7f5918784e9e39494b23ef5e、71e1e6d2c7ce3edbb73d605057752fe3f8e4016b、87502ea5630446595be0a7e34db7f87c91b43973，原生契约 b325d67b3e212c94bbbe51da9dada79cdf343294，逐个复算与远端一致。纯函数固定夹具输出 22 条待评审列级 GRANT、72 个新增 SELECT 列权限、47 个 INSERT 列权限、4 个 UPDATE 列权限、8 项阻塞；候选指纹 21c5df043b16f96e848aafe73435776969532fbd05f7acc0f13ffe5ce05b732c，admissionPassed=false。实际 Git 网络访问失败（无法解析 github.com），无 pnpm、Vite+、Docker、psql；未克隆完整仓库，未执行全仓质量链、实际 PostgreSQL 权限查询、真实双库事务、任何授权语句或服务切换。真实目录及权限语义仍待累计验收。

### B4 固定行锁例程候选（2026-11-28）

新增 `scripts/docker-db-role-lock-routines.mjs`，在既有 SCADA 业务列权限只读报告中返回 `lockRoutinePreview`，独立 SHA-256 指纹，不改变 B3.3、原 22 条直接列授权候选及其指纹。根据现有原生身份会话、工程版本和发布仓储 SQL，生成五张保护表及会话联合锁所需九条固定例程候选：身份状态、会话与身份联合共享锁、工程授权、目标版本、发布状态读/写锁、末次发布事件、幂等事件和较早 PUBLISH 事件。限定参数、返回列及锁强度，不生成通用动态 SQL。例程候选采用专用 NOLOGIN 所有者 `adui_scada_lock_owner`，预览 13 条所有者授权（Schema USAGE、六表限定 SELECT 与各一列 UPDATE）；运行角色仅候选 EXECUTE，不直接获得保护表 UPDATE。所有者 UPDATE 本身仍是高风险能力，不得赋予登录、成员或表/Schema 所有权；每个例程生成独立 CREATE、撤销 PUBLIC、所有者变更、运行角色 EXECUTE 文本。必须在同一事务内部署和核查，确认可信 Schema、实际例程签名/正文/ACL、所有者成员关系、角色配置及没有意外授权。当前例程尚未安装，原生仓储尚未改用它们，五张表 ROW_LOCK 仍列为阻塞，不能把文本预览当作行锁或行级授权验证。参数由可信服务传递，不是数据库租户身份认证；严格只读事务仍禁止行锁。B3 原基线不接受新增角色及对象变化，后续 B4 需要独立后置目录投影，禁止直接复用原基线或放宽严格原生契约。

工程初始化必须通过真正插入新工程的同一事务控制初始 ACL 和发布状态，不能独立对已有工程补授权；OIDC 清理仍需绑定可信 Issuer 及过期、批量和并发条件。正式发布/回滚安全门禁保持拒绝，Keycloak 对象所有权、受限写操作、角色实际创建、原生仓储适配及真实双库测试待完成。所有候选均只读生成，不执行 SQL、不切换服务或 LOGIN。

### B4 受限写入候选与直接授权进一步收敛（2026-11-28）

新增 `scripts/docker-db-role-restricted-writes.mjs`，只读报告增加 `restrictedWritePreview`。独立 `adui_scada_project_create_owner` 与 `adui_scada_oidc_cleanup_owner` 为拟议不可登录、无成员关系的最小职责角色，均未创建；不扩展锁所有者的写入权限。工程创建固定例程先验证首版参数及活动身份共享锁，再真正插入新工程（联合键冲突直接返回 EXISTS，禁止对已有工程补授权），将初始 head=1、不可变首版、未发布状态、创建者三项 `project:read`/`version:read`/`version:append` ACL 与首版审计在同一函数调用及调用方事务内写入。各次影响行数必须精确匹配，异常不得部分提交；不生成发布、回滚或任何通用授权修改入口。例程只核对传入快照元数据和摘要形状，尚不等于重新计算共享 Core 规范化 SHA-256、租户认证或权限校验；原生仓储仍须保留可信主体绑定、请求/快照校验、2 MiB 限制及写后回读。当前未更换仓储 SQL，数据库函数语法/原子性/并发/失败回滚均待真实验证。

为防止绕开原子创建，移除 `scada_projects` 五列直接 INSERT 候选；最新业务直接 GRANT 由 22 降至 21 条（72 SELECT、42 INSERT、4 UPDATE、0 DELETE），原 B2 三项启动 SELECT 不变，新指纹 c4e69c175afe9533da6867cb05dc9cf8884e06197984efe7bb7128df783b847f。八项阻塞全部保留，不能把生成候选当作可执行 ACL。专用清理函数仅在后续由可信部署配置核对本机 HTTPS 回环端口、固定 Realm 及真实 Discovery 后生成，默认只读报告不猜测端口、不输出具体清理 DDL。独立候选构造器校验十进制 1–65535 端口，按既有 Docker OIDC 规则规范化 `https://127.0.0.1:<port>/realms/adui-scada`；生成零参数函数，调用者不能传任意 Issuer 或未来截止时间。使用数据库 CURRENT_TIMESTAMP 双重过期过滤、固定排序、128 条上限，返回删除计数；专用所有者仅拥有目标表 DELETE 与三个必要 SELECT 列，不直接向运行角色授予 DELETE。真实清理、并发与数据库/应用时钟差异待验证；部署端口变化需要重新核对绑定及指纹。候选的 `issuerBindingVerified`、`definerSafetyVerified`、`businessAclApproved` 与 `admissionPassed` 均为 false。后续需要扩展 B4 独立目录后置验证以覆盖三个专用所有者、固定成员/配置/ACL、例程体与 Schema 安全；B3.3 原事务及严格原生契约不改。Keycloak 所有权和 C/D/E/F 仍待开发。

### B4 安装前置与未授权所有者核验（2026-11-28）

新增 `scripts/docker-db-role-b4-preflight.mjs`，将固定安装前置查询接入现有 `docker:db:role:object-review` 的 SCADA 库 REPEATABLE READ READ ONLY 事务。继续使用原 B3.3 事务及前后隔离基线、集群和严格原生契约门禁，不增加新 CLI 或实际授权入口。单条固定 SELECT 返回 16 项聚合证据：固定本机业务库管理身份及只读事务、两个运行角色的 NOLOGIN/无密码/无高权限/NOINHERIT 属性、三个候选所有者均不存在、受控角色及 pg_database_owner 无额外显式成员关系或角色设置、public 与 pg_catalog 的预期可信所有者、其他角色有效 CREATE 和 PUBLIC CREATE 为零、管理身份全局及 public 默认函数 ACL 为零、11 个预留例程名在当前库无碰撞（包括重载）、public 无未经审查的例程/运算符、无非内部触发器、事件触发器、业务表 RLS 启用及策略。当前采用全新业务库严格基线，不将合法扩展或额外对象自动归为安全；如发现任何漂移，应保留现场并单独评审。密码只在 pg_authid 中作 IS NULL 谓词，不返回密码字段、原始对象名或 ACL。严格检查结果形状、布尔值及计数；任意证据不符返回固定中文诊断。先核验前置，再采集既有 170 项业务列权限，失败不生成业务授权候选；Keycloak 库仍走原对象目录核查。

前置通过后只输出三个固定 NOLOGIN/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS/NOINHERIT/PASSWORD NULL 角色创建候选及独立 SHA-256 指纹，`installationAllowed=false`、`ownerRolesCreated=false`、`ownerRolePrivilegesVerified=false`、`definerSafetyVerified=false`、`issuerBindingVerified=false`、`admissionPassed=false`。预留角色与例程清单以真实九条行锁及两条受限写入模块对照测试约束，21 条直接列授权、72/42/4 列权限与八项真实阻塞不变。当前门禁仅证明所采集的安装前目录基线，不证明函数正文、安全执行或实际行级授权。依据 [PostgreSQL 19 ALTER FUNCTION](https://www.postgresql.org/docs/current/sql-alterfunction.html)，固定管理超级用户候选可转移例程所有权，无需将 Schema CREATE 授予专用所有者；后续必须在同一受控事务内验证，而非据此宣称已完成安装。

另实现 `verifyScadaB4NewOwnerRoles`，供未来已获授权的可写安装事务在创建三个角色后、授予任何 ACL 前使用。固定管理身份、业务库及可写模式，三个角色逐个九项严格布尔断言：身份、强化角色属性及密码空值、无成员、无设置、无全集群共享对象依赖、无任何数据库 CONNECT/TEMPORARY/CREATE、无 Schema CREATE、无 public/prisma_contract 表或列访问、无序列访问。表列与序列权限函数仍按 relkind CASE 保护；缺失、重复、额外角色或任一布尔值漂移拒绝。仅查询证据，尚未接入写事务，不执行 CREATE ROLE、GRANT、REVOKE、ALTER、业务 DML 或服务切换。后续必须实现可写事务内重新验证前置、例程正文/签名/安全配置及精确直接/有效 ACL 后置核查、实际回滚与独立状态确认；Keycloak 对象所有权、原生仓储接入与 C/D/E/F 仍待开发。

### B4 安装后例程目录精确核验（2026-11-28）

新增 `scripts/docker-db-role-b4-routine-review.mjs`，从已有九条锁例程及工程创建、固定部署 Issuer 清理候选构造 11 个预期例程，不接收外部 SQL 或从未知目录生成写入语句。`verifyScadaB4InstalledRoutines(query, port)` 供未来独立 B4 安装后核验调用；单条固定 SELECT 确认 PG 19.0、业务库及共享管理身份，并读取 public 全部例程与当前库其他模式中同名预留例程，不预过滤重载、未知授权或异常定义。逐条比较限定模式、完整签名、参数名及类型、返回列与类型、所有者、语言、普通函数类型、STRICT、SECURITY DEFINER、VOLATILE、PARALLEL UNSAFE、非 LEAKPROOF、无默认参数/可变参数/支持函数/二进制实现/转换/解析后的 SQL 体，精确比较原始 prosrc 和两项固定 proconfig。遵循 PostgreSQL 目录反编译规范：`timestamptz` 输出 `timestamp with time zone`，表返回类型为 `TABLE(...)`；仅在预期模型转换这两种已知格式，不忽略正文、参数顺序或任意目录差异。参考 [PostgreSQL 系统信息函数](https://www.postgresql.org/docs/current/functions-info.html) 和 [ruleutils.c](https://doxygen.postgresql.org/ruleutils_8c_source.html)。

对显式 proacl 使用 aclexplode，精确比较 23 个 EXECUTE ACL 项（含 11 个函数所有者显式普通执行权限、11 个运行角色授权以及工程创建专用角色调用身份锁的 1 项额外权限），grantor 必须是对应所有者，禁止授权选项、PUBLIC、Keycloak 运行角色或其他直接授权；另扫描所有非超级用户的有效 EXECUTE 集合，禁止意外继承权限。配置、ACL 和角色集合的读取顺序不影响核验，重复项、缺失项、额外字段、签名/正文/安全配置或清理 Issuer 漂移均拒绝。报告仅返回固定状态、数量和 SHA-256 指纹，不回显实际例程正文、角色目录值或底层异常。此为目录证据层，不替代成员 SET ROLE 路径、专用角色表列与跨库权限、Schema 信任、触发器与策略、真实锁及 DML、回滚和部署 Issuer 信任核验；管理超级用户不纳入非超级用户执行权限矩阵，后续仍须维持 B3 与 B4 前后管理基线。当前未接入实际安装事务或 CLI，所有准入、真实安全与数据库写入标志为 false；不改变 B3.3、原业务列权限及正式发布安全门禁。

### B4 安装后角色与表列权限精确核验（2026-11-28）

新增 `scripts/docker-db-role-b4-permission-review.mjs`；共享抽取 `scadaBusinessGrantCandidates()`，前置预览与安装后预期复用同一 21 条直接业务列授权定义，不改变前置 170 项基线及原候选指纹 c4e69c175afe9533da6867cb05dc9cf8884e06197984efe7bb7128df783b847f。仅从固定原生物理列及既有专用例程所有者授权候选构造预期，不使用外部 SQL 或实际目录生成授权。当前验证阶段限定为 SCADA 业务库例程及 ACL 安装后、Keycloak 对象所有权转移前，五角色保持 NOLOGIN、无密码、无管理能力、无成员/角色设置。五条固定 SELECT 依次核对角色和对象依赖（含共享及跨库依赖、模式信任、非预期 CREATE、PUBLIC CREATE、pg_database_owner 显式成员、默认 ACL、序列及 marker 权限），全集群五角色×五库 25 项有效 CONNECT/CREATE/TEMPORARY 与 grant option，205 项精确直接 ACL，五角色×十二业务表 60 项有效关系权限，425 项 public 业务物理列权限及两项 marker 启动读权。三个专用角色不得连接任何库；两个运行角色仅各自库 CONNECT。直接 ACL 核验不限预期对象/权限，检查受控角色作为 grantee 或 grantor 的数据库、模式、关系、列及非 public 例程显式 ACL；授权者必须为对应对象所有者且不带 grant option。public 例程 ACL 由独立例程目录核验覆盖。有效业务关系/列查询同时检查非系统模式的额外实际授权，混合关系目录使用 CASE 保护类型专用权限函数；不尝试回收系统公开目录的正常读取权限。参照 [PostgreSQL 19 权限查询函数](https://www.postgresql.org/docs/19/functions-info.html)、[共享对象依赖](https://www.postgresql.org/docs/19/catalog-pg-shdepend.html) 及 [GRANT](https://www.postgresql.org/docs/19/sql-grant.html)。

205 项直接 ACL 预期分布：SCADA 运行角色 127、Keycloak 运行角色 1、锁专用所有者 43、工程创建专用所有者 29、OIDC 清理专用所有者 5；锁专用角色仅六列 UPDATE，工程创建专用角色仅五表 26 列 INSERT、两列 SELECT 及 public USAGE（身份锁 EXECUTE 另计），清理专用角色仅目标表三列 SELECT、整表 DELETE 及 public USAGE。SCADA 运行角色保留 public 75 SELECT（含三项 B2 启动列）、42 INSERT、4 UPDATE，另有两项 marker SELECT 及原精确启动权限，不给运行角色整表写入/DELETE。所有缺失、重复、额外、错误授权者、类型/布尔值或权限漂移均拒绝，按固定阶段脱敏失败，不返回实际角色、对象、凭据和原始异常。`verifyScadaB4InstalledCatalog(query, port)` 顺序组合本模块和前一轮 11 例程/23 EXECUTE ACL 核验，必须由后续受控事务在同一经确认快照内调用；合计六条目录 SELECT，返回独立 SHA-256 指纹及 installedCatalogMatched，不批准安装、不视为真实业务准入。当前预期矩阵仅适用上述 B4 中间阶段，不作为完成 Keycloak 所有权后的状态模型；尚未接入实际写入事务或 CLI。真实目录语义、全部前后信任对象与严格原生契约、真实锁/DML 正反向、独立回滚确认、Issuer 信任、Keycloak 及 C/D/E/F 仍待完成，所有安全与准入标志为 false。B3.3、正式发布门禁、数据库及服务身份保持不变。

### B4 受控安装回滚演练核心（2026-11-28）

新增 `buildScadaB4RehearsalPlan` 与 `runScadaB4RollbackRehearsal`。计划指纹绑定固定集群身份、存储标识、B3.3 隔离指纹、部署端口、前置与业务候选指纹及固定目录语句序列；不接受调用方替换候选 SQL。执行必须同时具备独立确认参数 `--confirm-rehearse-scada-b4`、精确计划指纹与可信宿主、事务内 B3.3 隔离核验适配器。前置适配器须验证实际严格原生契约、中文注释、集群和正式 OIDC Discovery 及规范化 Issuer。核心在 SERIALIZABLE READ WRITE 事务内获取既有执行锁，重新核对 B3.3 已隔离基线及固定候选，打开 check_function_bodies，创建三个专用角色并先核验未授权状态，再按固定依赖顺序执行 92 条目录语句（包含 11 例程及 21 条业务授权），逐条核对 pg.Result.command，并调用组合安装后目录门禁。核心没有 COMMIT 路径；仅在收到 ROLLBACK 标签、关闭原连接且新独立只读事务复核 B3.3 和 B4 原始基线、宿主证据复核均匹配后，才返回演练结果。失败不自动重试；事务开始、回滚或连接关闭结果未知时禁止重试，不输出原始异常。

本次只交付编排核心和模拟驱动回归，不注册实际 CLI，不接入真实宿主或 B3.3 同事务适配器，不允许实际安装，不切换角色和服务。后续仍需完成可信宿主接入、真实 PostgreSQL 目录/锁及 DML 正负向测试、独立回滚确认、Keycloak 对象所有权及剩余准入门禁。所有正式授权及发布准入标志继续为 false。

### B4 真实宿主适配与受控 CLI（2026-11-28）

新增 `scripts/docker-db-role-b4-host.mjs`，将已有回滚演练核心接入实际宿主入口。`createScadaB4IsolationReader` 固定双运行角色已创建且两业务库 PUBLIC CONNECT 已隔离的基线，复用 B2 的角色与启动授权核验以及 B3.3 的全集群精确目录核验，前后比较管理身份与业务目录，并在调用者提供的同一连接/事务中获取真实隔离指纹；不自行建立第二个事务替代当前事务证据。`createScadaB4HostReader` 依次核对本机 Docker PostgreSQL 集群身份、官方严格原生契约、真实中文注释及宿主/容器正式 OIDC Discovery/JWKS，最后再次核对集群身份；只有全部证据匹配才生成固定宿主报告。宿主入口在前后复核 `.env`、现有随机凭据文件、Compose 环境文件及双库目录报告是否变化，不回显文件内容。`readScadaB4HostPlan` 在独立 REPEATABLE READ READ ONLY 事务中前后核验 B3.3，读取原固定 B4 准备报告并生成计划指纹，必须收到 ROLLBACK、关闭连接并再次核对宿主证据。原 92 条目录语句、21 条业务授权候选及其他安全门禁保持不变。

新增 `docker:db:role:b4:plan` 与 `docker:db:role:b4:rehearse` 两个固定 CLI：只读计划不接受其他参数；回滚演练严格要求 `--confirm-rehearse-scada-b4` 及 `--plan-fingerprint=<64 位小写十六进制>`，先独立生成真实计划并与确认指纹比较，再进入原强制回滚核心。复用已有本机 Windows Docker Desktop、固定业务库连接和正式 OIDC 探针；不接受任意 URL、SQL、外部验证报告或任意端口覆盖，不提供 B4 apply/commit 模式。此处是 CLI 实现候选，不代表在真实宿主执行成功；B3.3 必须实际隔离完成，服务和固定 OIDC Discovery/JWKS 必须具备，真实 PostgreSQL 例程安装/回滚及锁和业务 DML 测试仍需独立授权验收。保留 Keycloak 对象所有权与运行角色 LOGIN、业务连接切换和发布准入的独立边界。

### B4 Keycloak 逐对象所有权只读候选（2026-11-28）

新增 `scripts/docker-db-role-keycloak-plan.mjs` 与独立根脚本 `docker:db:role:keycloak:plan`。仅适用 B3.3 已实际隔离、B4 SCADA 目录仍处于安装前基线的本机阶段；复用现有严格契约/中文注释、固定 PG 19.0 集群、双库角色核查及前后 B3.3 状态核验，不改变原 `docker:db:role:object-review` 行为。Keycloak 库同一 REPEATABLE READ READ ONLY 事务新增两条固定 SELECT：七项强化前置证据及 public 普通表、索引、关联 TOAST 与 TOAST 索引、表行类型和数组类型的所有权图。前置拒绝异常运行角色属性/成员/设置、跨库连接或数据库 CREATE/TEMP/CONNECT grant option、非可信 public ACL、额外用户 Schema、受检范围内未知对象/例程/扩展/默认 ACL 及非唯一目标库 CONNECT 共享依赖；pg_database_owner 自身的 Schema 权限不是其他普通角色 CREATE，仍拒绝该角色的显式成员关系。对象目录不预过滤不支持的 public 关系或类型；拒绝非永久普通表、序列、视图、分区/继承、RLS、非内部触发器、显式关系/列/类型 ACL、扩展成员、无效索引、未知所有者及不完整依赖。原验收记录为 101 张表、零序列；完整实际表清单尚未取得。当前候选以该计数、五个 Keycloak/Liquibase 标志性表名、安全标识符及实际目录为约束，标志性表名仅为待实机核对的候选限制，不能将计数或名称形状等同于全部对象身份已审核。成功时本地构造按表名稳定排序的 101 条 `ALTER TABLE ONLY public."<name>" OWNER TO adui_scada_keycloak_runtime` 候选，不生成全局 REASSIGN OWNED、GRANT、REVOKE 或数据库/Schema 所有权变更。公开报告仅输出聚合数量和 SHA-256，绑定固定集群、原生存储指纹、B3.3 隔离指纹及规范化对象身份/所有者/依赖图和候选语句；不回显目录对象名、OID 或 SQL。该指纹不是完整表定义、约束、扩展、业务数据或并发状态证明。`verifyKeycloakOwnershipProjection` 仅对输入目录图检查普通表及五类从属对象所有者均由管理角色转为固定 Keycloak 角色，其他证据不变；未连接写事务。依据 PostgreSQL ALTER TABLE OWNER 与上游 AlterTypeOwnerInternal 的数组所有者联动（https://www.postgresql.org/docs/19/sql-altertable.html、https://doxygen.postgresql.org/typecmds_8c_source.html），仍须实机核验索引、TOAST、行类型/数组以及 pg_shdepend 投影，不能由纯函数结果认定真实传播已成功。

当前 Compose Keycloak 仍用原共享管理身份，目标独立角色继续 NOLOGIN；候选只转移表所有权，不授予 public CREATE，也不切换数据库/Schema 所有权、连接串、密码、镜像或迁移策略。Keycloak 现有自动 Schema 演进与对象所有权方案须独立评审，表所有者天然拥有本表 ALTER/DROP 能力，不能将其描述为仅 DML 角色；根据 [Keycloak 数据库指南](https://www.keycloak.org/server/db) 和 [升级指南](https://www.keycloak.org/docs/26.8.0/upgrading/)，后续评估正常启动时 validate 与独立迁移窗口的权限分离，或经独立授权仅允许 Keycloak 库 public CREATE，不扩大至数据库 CREATE 或 SCADA 权限。本轮不做该选择，也没有实际演练/执行入口。`objectIdentityReviewed`、`ownershipTransferAllowed`、`ownerProjectionVerified`、`runtimeLoginAllowed`、`businessAclApproved` 与 `admissionPassed` 均为 false。下一步须取得实际对象清单及经认可的确切指纹、验证 Schema 演进权限和角色/共享依赖的后置投影，更新 B2/B3/B4 分阶段状态模型后才可编写受控所有权回滚事务；真实执行及服务切换需另外授权。

### B4 Keycloak 所有权前后精确目录门禁（2026-11-28）

扩展 `scripts/docker-db-role-keycloak-plan.mjs`。原 `readKeycloakOwnershipPreview` 仍只返回两条只读目录查询生成的脱敏报告，原 101 条候选 SQL 与计划指纹算法不变；`readKeycloakOwnershipCandidate` 仅供受控事务内部使用，严格区分 REPEATABLE READ READ ONLY 与 SERIALIZABLE READ WRITE 两种前置模式，不得直接输出对象清单或 SQL。新增 `verifyKeycloakOwnershipBaseline` 与 `verifyKeycloakOwnershipCatalog`，分别核验原始状态（演练前可写事务或回滚后独立只读事务）和所有权变更后的同一可写事务投影。先从原候选重新计算并精确匹配计划指纹、目录图、候选语句及报告，再执行四条固定目录 SELECT（含 WITH）。在原七项强化基线上核对六类对象图、集群 system_identifier、Keycloak 角色全部共享依赖、全集群数据库 ACL 中该角色作为被授权者或授权者的记录、两运行角色对 101 张普通表的 202 项有效权限组合。所有权转移前及回滚后预期仅 1 条本库 CONNECT ACL 依赖；投影状态预期恰为该依赖加 101 条普通表所有权依赖。索引、TOAST、自动行类型和数组类型的所有者应随表变更，但不是独立所有权依赖，参见 [PostgreSQL ATExecChangeOwner](https://doxygen.postgresql.org/tablecmds_8h.html) 与 [AlterTypeOwner_oid](https://doxygen.postgresql.org/typecmds_8c_source.html)、[共享依赖](https://www.postgresql.org/docs/19/catalog-pg-shdepend.html)。禁止未知依赖、跨库直接 ACL、额外授权者和 grant option。有效表权限矩阵检查八项表权限及其授权选项、四项任意列权限和 public USAGE/CREATE；固定 C 排序且 CASE 保护类型专用权限查询。原始状态两角色无表列权限；投影状态 Keycloak 所有者具备其表的全部八项有效权限及固有授权选项，SCADA 角色仍无表列权限，双方无 public CREATE 或 USAGE grant option。这里的所有者权限包含 ALTER/DROP 等固有能力，不是纯 DML 账号，也不开放运行角色 LOGIN。前后原始目录指纹必须相同，投影指纹与原始指纹不同；报告不含原始对象名称、OID、SQL 或底层异常。

本次不执行任何所有权转移，不注册写入/回滚 CLI，不改变 B2/B3.3 或 SCADA B4 安装前后核验模型。真实 Keycloak 对象身份仍未审核、实际系统目录与权限语义未验证，`schemaEvolutionVerified`、`ownershipTransferAllowed`、`runtimeLoginAllowed`、`admissionPassed` 均为 false。依据 [Keycloak 官方数据库指南](https://www.keycloak.org/server/db)，正式启动的 Schema 演进策略可独立评审 validate/manual/update，当前建议优先验证 validate 加隔离维护窗口，不修改 Compose 或自动选定策略。仍须确认真实对象清单、实际镜像版本与 Schema 演进、B3/B4 分阶段状态模型及受控回滚事务（包括停用并发 Keycloak 消费者、锁、失败回滚、独立新连接核验），之后才可获得独立实际执行授权。此轮仅验证目录候选和模拟证据，不宣称实际所有权或权限已改变。

### 2026-11-28 · B4 双库受控回滚演练及业务探针

Keycloak 新增独立 `docker:db:role:keycloak:rehearse` 入口，要求 `--confirm-rehearse-keycloak-ownership --reviewed-keycloak-objects --confirm-keycloak-maintenance --plan-fingerprint=<当前 Keycloak 所有权预览指纹>`。指纹取自 `docker:db:role:keycloak:plan` 报告的 `keycloak.ownershipPreview.planFingerprint`，不是外层 B3 隔离指纹。对象审阅及维护确认是操作者声明，不是自动审批；维护者必须实际核对完整对象身份、关闭并发消费者，并保持固定本机 Keycloak 容器明确停止且不自动重启。CLI 不自行停启服务。宿主验证唯一容器 ID、Compose 项目/服务标签、镜像、退出状态、重启策略、集群、原生严格契约、中文注释、B2/B3.3 基线和本地环境文件稳定性。在 SERIALIZABLE READ WRITE 事务内验证执行锁、其他会话不存在、原始目录及固定指纹，按稳定顺序对 101 个候选表加排他锁并执行固定所有权变更，再验证六类对象及 102 项共享依赖、202 项权限投影；强制回滚后以独立只读连接和宿主再次核验原始状态。失败或状态不确定禁止自动重试。不授予 public CREATE、不开放 LOGIN、不执行 COMMIT。

SCADA 回滚演练在原 92 条目录语句及组合目录核验后调用 `verifyScadaB4RuntimeProbe`。以随机合成租户、工程、会话与摘要在同一事务 SAVEPOINT 内切换固定角色，验证九条锁例程、两个受限写入例程、工程首版及重复/禁用身份、版本追加 CAS、审计、历史归档、会话签发撤销、OIDC 过期清理及消费、受保护操作与 Keycloak 业务访问拒绝。预期 36 项正向断言和 15 项精确 SQLSTATE 42501 拒绝断言；夹具及每项拒绝操作均使用 SAVEPOINT 回滚，并核验管理身份恢复与夹具不存在。OIDC 清理测试先取得短时表锁并拒绝任何符合既有清理条件的真实登录事务，不自动清理现场数据；此限制可能阻止已有过期记录的真实环境验收。新演练要求额外独立参数 `--confirm-rollback-business-fixtures`，计划指纹算法版本从 1 提升至 2，旧指纹和旧命令不能进入新演练。原 21 条直接业务授权候选、92 条目录语句和 B3.3 不变。探针使用合成 SQL 业务路径而非正式应用仓储；不宣称真实并发锁、行级授权或应用接入已验证。

本批两个入口只允许回滚，不是正式授权或所有权持久化入口。验收安排调整为 B4 代码完整后由维护者集中运行一次验证流程；不要求中途验收，不自动越过持久化审批。剩余：B3.3 实际隔离；B4 持久化及跨阶段安装状态核验设计/实现、真实对象身份与 Keycloak Schema 演进策略、原生仓储接入专用例程及并发/行级授权证据；最终 Windows 全质量链、真实双库演练及独立授权后的持久化验收。后续 C/D/E/F 不提前放行。

### 2026-11-28 · B4 双库跨阶段目录投影与回滚关闭门禁

新增内部只读 `readKeycloakInstalledOwnership`，在 REPEATABLE READ READ ONLY 中检查持久化投影的七项基线、六类对象、102 共享依赖、202 有效权限组合。只从当前完整已转移对象图恢复原管理所有者候选，重新生成并精确比较操作者此前确认的 Keycloak 计划指纹；不接受外部对象清单，也不放宽原只读计划或回滚演练基线。内部表 OID 不进入公开报告。新增 `verifyScadaB4CompletedCatalog`，从上述目录证据获得 101 张普通表的固定 OID 白名单，先于原 SCADA 五组权限及例程核验独立检查本机集群、Keycloak 库、目标角色、依赖类型、对象类别、子对象标识和完整对象集合。仅在此专用路径允许这些精确共享依赖；原安装后核验函数保持六条目录查询及原指纹算法、不允许 Keycloak 转移后的依赖。不接受任意 SQL、角色、数据库名称或任意跨库依赖放行。两库必须分别由调用者持有独立只读事务并维持维护窗口；两个快照并非跨库原子快照，`crossDatabaseAtomicSnapshotVerified=false`。本轮尚未接入实际宿主、CLI 或持久化事务；角色保持 NOLOGIN，未改变 B3.3、授权候选、92 条目录语句、正式发布门禁或服务身份。该投影不能替代独立真实宿主核验、完整前后契约或 Schema 演进验证。

SCADA 回滚演练与 Keycloak 保持一致：仅在收到外层 ROLLBACK 命令标签且原连接关闭成功后，才可创建独立只读连接并复核原始目录和宿主；若连接关闭失败，保留禁止重试诊断，不再尝试独立连接。新增回归覆盖原连接关闭失败不继续复核。源码提交 cd4bbc47c5ab452d48fe20b3fc0bb9cda5805174。

协作环境 Node.js 22.16.0 实际执行新增 `docker-db-role-b4-phase.cases.mjs` 3/3、两文件语法检查退出 0，实测 Git Blob 71ab57b847329554245659126910c5ccf860962c / 67f1511221caf858701f584a3cd69b710fcc59a7 与代码提交一致。另对修改的模块和测试作 V8 去除导入/导出声明后的语法解析；以替代摘要、URL、深比较和克隆实现运行远端实际目录编排及夹具成功路径（Keycloak 四次、SCADA 七次查询）、旧 SCADA 六次查询路径、五类拒绝场景。首次 V8 探索因环境没有 URL 全局失败，加入限定的外围替身后成功；这不是原生 Node 集成测试或真实 SQL 验收。新增 Keycloak 三项和回滚一项 Node 集成用例已注册在既有 test:docker 套件中，尚未实际执行。仍需 B4 正式持久化及跨阶段真实宿主、Keycloak Schema 演进策略、原生仓储接入与并发锁/行级权限；不安排中间 Windows 验收、不自动批准安装或合并。

### 2026-11-28 · B4 原生业务仓储接入固定行锁与工程首版例程

新增 `apps/server/src/database/prisma8-b4-routines.ts`，复用 `Prisma8TextTransaction` 的参数化原生查询计划和文本返回列验证。九条锁例程均以固定 public 限定名称、精确参数顺序与 PostgreSQL 类型显式转换调用，不接受任意 SQL、动态例程名或直接受保护表锁的失败回退。会话签发改用身份例程；发布读取、发布请求、内部回滚改用会话身份、授权、发布状态、版本、事件、幂等请求和历史发布证明例程。保留工程表本身已有的行锁及发布安全门禁，未增加发布或回滚 DML 授权。

工程创建改为共享 Core 首版快照校验后，在原生写事务内调用 `scada_create_project`，明确区分 CREATED、EXISTS、DENIED，其他返回、例程错误或缺失均拒绝。取消仓储直接创建工程、初始发布状态及创建者授权 DML；首版与追加共享不可变快照、工程水位和成功审计回读。首版额外核对发布代次零、空发布指针及创建者恰有三项初始权限（project:read、version:read、version:append）；任何漂移使同一事务失败。版本追加保留项目行锁、CAS、快照和审计 DML，并在事务内使用专用身份及工程授权行锁重新核查活动主体与授权。追加仍以已有可信主体接口为输入，不将应用层授权宣称为数据库级完整租户 RLS；真实锁冲突、撤权和并发失败路径待独立实测。

本次在 Draft 分支直接切换上述原生业务 SQL，不引入高权限兼容回退。因此执行会话签发、创建、追加、发布锁定读取等路径前必须完成 B4 例程安装及准入，尚未安装时失败是预期阻塞；现有部署的连接角色、严格只读入口、Compose、数据库合同、21 条直接授权及 92 条目录语句均未改变。OIDC 清理仍待接入零参数固定 Issuer 例程；必须先落实清理例程与应用 Issuer 的可信绑定，不能凭应用输入扩大删除范围。还需正式权限持久化与跨阶段真实宿主核验、Keycloak Schema 演进、真实并发锁及行级权限验证，才进入集中实机验收。不执行实际授权、不切换身份、不合并。

代码提交 f8930a8c597ea2b117b23fadc2c05c2c81825eac。协作容器 Node.js 22.16.0 执行新增 `node --experimental-strip-types --test scripts/docker-db-role-b4-native-routines.cases.mjs`，5/5，零失败、零跳过，退出码 0；类型剥离产生该 Node 版本的实验性提示。适配层、既有文本事务端口及测试文件的 Git Blob 分别为 f0530f54d044060e8d6347585048fffc18d6733e、a85164e465f0a1fed66ea2494c42034b4744c638、7e498e9521b442c952dcb3ba444c79dcf3c59c1c，本地逐字节 Git 哈希与远端一致。真实 Node 专项使用模拟原生事务驱动，不执行 PostgreSQL。三组 Vitest 原生仓储用例已同步更新，尚未执行；完整 test:docker、Vite+ 格式/Lint/类型、中文/文档、ready、真实数据库与 Docker 仍待验收。

### 2026-11-28 · B4 集中验收候选编排

固定 Issuer 清理函数体由原生仓储与安装 SQL 共用；仓储调用同一 SQL 核验固定函数签名、所有者、安全属性、prosrc 与配置后才调用零参数清理，返回精确 0–128。非本机固定 Realm 或漂移拒绝，不回退直接 DELETE。登录及消费不改变；非固定部署 Issuer 的过期清理目前拒绝，待独立部署模型评审。

新增三个固定所有者的全集群隔离投影（先验证无登录/继承/数据库访问、成员、数据库 ACL 及会话，恢复原 B3 指纹），安装后精确角色/例程目录仍单独验证完整安全属性。两个明确阶段的独立状态入口不复用原 B3.3 原始目录，也不接受未知状态。SCADA 持久化与 Keycloak 所有权持久化分开确认；同事务重跑已审阅计划、运行探针/投影后比较演练目录指纹才允许 COMMIT，关闭原连接后再次独立核验。未知提交、关闭或后置失败禁止重试。新增双连接现有夹具锁探针及 Keycloak 固定镜像 Schema 策略候选。完整集中步骤和未完成证据见 [B4 集中验收清单](b4-concentrated-acceptance.md)。

当前未执行任何真实授权、目录提交、服务切换或 LOGIN。真实全质量链、双库 SQL 及完整并发/原生应用权限和 Keycloak 实际启动兼容性仍未验证，不能宣布 B4 完成。PR #262 保持 Draft。
