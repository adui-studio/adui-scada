# Docker 原生运行角色准备预览（B1）

- 状态：代码候选，预览待 Windows 实机验收；角色尚未创建
- 日期：2026-11-28
- 前置：[原生业务连接安全评审](docker-native-business-connection-review.md)、[ADR-0073](../adr/0073-prisma8-fresh-install.md)、[ADR-0065](../adr/0065-oidc-bff-and-project-api.md)
- 关联：FR-001、FR-008、FR-013、FR-014、NFR-006
- 基线：PR #257 已 Squash 合入 feat/mvp-first-integration 的 8d94a418021376d6803b16bb793eefcf4a79b280。

## 1. 真实证据及本批边界

A 阶段维护者实测 PostgreSQL 19.0，当前 adui_scada 是两个逻辑库共用的登录超级用户，具备创建数据库、创建角色、复制及绕过 RLS 权限，未发现成员关系；两个拟议独立运行角色均不存在。两个数据库均由当前角色拥有，PUBLIC CONNECT=true，SCADA 12 张及 Keycloak 101 张 public 表均由该角色拥有且具备全部核查权限；两库额外非系统 Schema 和 public 序列数均为 0，原生存储指纹及结构注释不变。详见 [验收记录](../VALIDATION.md)。

本批只实现从最新真实目录核查结果到固定 SQL 准备预览的确定性映射，不运行该 SQL，不创建或登录角色，不修改现有角色、密码、ACL、所有权、Compose、Provider、OIDC、业务数据、原生契约或运行服务。新增独立命令 `pnpm run docker:db:role:plan`。不接收外部 JSON、任意 SQL、数据库地址或应用参数；复用已验收的本机 Docker、固定端口、随机秘密、集群前后复核、两库独立只读事务、严格 Prisma 8 契约及中文注释核验。

预览只接受当前真实基线：PG 19.0、固定指纹、12 表/85 字段/36 CHECK/20 索引/13 外键/119 注释、两个运行角色不存在、共享角色属性及零成员、两库所有权及有效权限、Schema、12/101 表权限计数、零额外 Schema/序列、marker 与集群函数权限均一致。任一基线漂移拒绝生成方案，不自动放宽，不自动重试。新版本或 Keycloak 表计数变化必须重新核查和评审。

## 2. 固定准备预览（不是执行许可）

| 对象 | 本批 SQL 预览 | 不授予 |
| --- | --- | --- |
| adui_scada_runtime | NOLOGIN、无密码、NOSUPERUSER、NOCREATEDB、NOCREATEROLE、NOREPLICATION、NOBYPASSRLS、NOINHERIT | 登录、成员关系、管理权限、所有权 |
| adui_scada_keycloak_runtime | 同样的 NOLOGIN 属性及本库 CONNECT | 登录、业务库权限、Schema 创建、对象所有权、Keycloak DML |
| SCADA 数据库 | 显式 CONNECT | CREATE、直接新增 TEMP 权限 |
| public、prisma_contract | SCADA 运行角色 USAGE | CREATE |
| public.scada_projects | SELECT (tenant_id, project_id, head_revision)，仅覆盖当前 Provider 启动缺失工程查询 | 整表读写、正式工程 API 权限 |
| prisma_contract.marker | SELECT (space, core_hash)，仅覆盖当前契约标记查询 | UPDATE、DELETE、DDL |
| pg_catalog.pg_control_system() | SCADA 运行角色精确 EXECUTE | 广泛监控角色或超级用户权限 |

预览包含两条固定 CREATE ROLE 和六条固定 GRANT，均以 adui_scada 为执行数据库预案；CREATE ROLE 是集群范围操作。命令仅输出这些固定文本与状态，不连接新角色，不执行任何 CREATE、GRANT、REVOKE 或 ALTER。NOLOGIN 并非完整的有效权限隔离，其他角色成员关系和 PUBLIC 仍须核查；当前 PUBLIC CONNECT 允许连接，不得把上述显式 CONNECT 解释为对其他库的拒绝。实际创建和授权仍需维护者单独明确授权及下一批受控执行器，禁止直接复制预览 SQL 执行。

## 3. 正式业务权限需求矩阵（源码事实，未批准授权）

已核对 [原生会话](../../apps/server/src/auth/prisma8-session-operations.ts)、[OIDC 登录事务](../../apps/server/src/auth/prisma8-oidc-login-operations.ts)、[授权读取](../../apps/server/src/auth/prisma8-authorization-read-store.ts)、[工程版本](../../apps/server/src/projects/prisma8-runtime-project-version-store.ts)、[工程查询](../../apps/server/src/projects/prisma8-project-query-store.ts)、[发布仓储](../../apps/server/src/projects/prisma8-runtime-project-release-store.ts)、[历史归档](../../apps/server/src/history/prisma8-tag-history-store.ts)、[原生 Provider](../../apps/server/src/database/prisma8.service.ts) 的当前真实语句。下表描述业务实际访问，不是本批 GRANT 白名单，也不替代逐列 SQL 检查和实际角色测试。

| 业务表 | 当前代码的必要读取/修改范围 | 不得据此放开 |
| --- | --- | --- |
| scada_identities | 可信主体查询及 FOR SHARE 锁 | 直接修改主体状态、租户或主体标识 |
| scada_external_identities | 预绑定映射读取 | 自动创建映射或改租户 |
| scada_auth_sessions | 查询、签发 INSERT、仅 revoked_at 更新；发布读取锁会话 | 任意会话字段修改或删除 |
| scada_oidc_transactions | 创建、条件消费 consumed_at、按 Issuer 和过期条件有界 DELETE | 任意清表或复用登录事务 |
| scada_projects | 列表及详情、创建 INSERT、head_revision/updated_at CAS 更新及行锁 | 删除工程、任意修改租户或主键 |
| scada_project_grants | 完整 ACL 读取；创建工程时固定三项权限 INSERT；发布读取行锁 | 任意授权、提升为发布权限 |
| scada_project_versions | 不可变版本 INSERT 与读取；发布读取 FOR SHARE | 更新或删除历史快照 |
| scada_project_audit | 版本成功审计 INSERT 与回读 | 修改或删除审计 |
| scada_project_release_state | 创建工程时初始化代次 0；当前发布读取锁 | 发布指针 UPDATE、代次推进 |
| scada_project_release_events | 当前发布事件读取与锁；发布写路径受固定安全门禁拒绝 | INSERT/UPDATE/DELETE 正式发布事件 |
| scada_tag_history_batches | 内部归档批次 INSERT、冲突读取 | 更新或删除已提交批次 |
| scada_tag_history_records | 内部明细批量 INSERT 与有界读取 | 更新或删除历史记录 |

当前工程读取、身份签发及发布读取存在 PostgreSQL FOR SHARE / FOR UPDATE 行锁。PostgreSQL 19 [权限文档](https://www.postgresql.org/docs/19/ddl-priv.html) 明确此类查询除 SELECT 外还要求至少一列 UPDATE 权限；严格只读事务亦不能使用这些行锁。因此不能只给 SELECT 后声称既有根模块全部能运行，也不能为通过测试给身份状态、ACL、不可变版本或发布事件任意 UPDATE。项目现有 [发布安全门禁](../../apps/server/src/projects/project-release-safety-gate.ts) 固定拒绝，保持不变。实际角色只提供数据库对象权限边界，不代替应用租户/ACL/CAS；后续须评审能保持现有锁内授权、不可变性和并发语义的最小方案（包括是否需要专用锁入口）。不得直接取消行锁，不将整个表 UPDATE 当作锁权限捷径；涉及 SQL 函数、额外 Schema 或对象变动须专项评审其安全、search_path、权限与严格原生契约影响。

## 4. 后续实施门禁

1. B1 预览真实成功后，再审批独立 NOLOGIN 角色创建及精确启动读权的受控事务实现。实际执行须重新严格核验集群、候选角色不存在、当前基线及固定预览，不接受任意 SQL；成功须复验原生契约、角色属性、无成员/所有权、实际有效权限及无业务行改动，失败保持现场。回退只允许明确授权后针对本次新角色及精确授权，禁止 DROP OWNED、全局 REASSIGN OWNED、清库及卷操作。预览成功或 NOLOGIN 角色存在均不等于正式准入。
2. 核对所有可连接数据库及 PUBLIC CONNECT/TEMP、有效权限和已有消费者。只有明确评审影响范围后才能回收具体权限；不能仅检查两个业务数据库就宣称整个集群隔离。
3. Keycloak 独立核对实际对象类型、所有权、ACL、默认权限及 Schema 演进需要。101 张表均由旧共享管理角色拥有，但报告不覆盖全部对象类型，不能用全局所有权转移或 GRANT ALL 代替。暂不调整 Keycloak 镜像、数据库所有权、服务身份或密码。[Keycloak 官方数据库指南](https://www.keycloak.org/server/db) 当前 PostgreSQL 支持列表最高为 18，仓库本机 PG 19.0 与 Keycloak 已完成的只读回归不等于官方支持或生产升级资格；保持维护者当前版本选择，后续独立实测启动及 Schema 管理，不擅自降级。
4. 审查 SCADA 行锁及正式业务最小权限；分别证明应允许的实际连接、固定读取及事务路径，以及拒绝跨库、身份/ACL 越权、快照及审计篡改、正式发布、管理权限和 DDL。正式 LOGIN、独立凭据、既有容器凭据切换、OIDC 与双框架联调均须独立授权及验收。默认服务继续当前严格只读。

## 5. 验证

协作环境 Node.js 22.16.0 对新增核心及测试文件执行 node --check 和 node --test，5/5 通过；Git Blob 分别为 937c3594940f0d18513bb39453f4ba4a724bffef 和 96bf64fc0ebb58387b7329af3fecdac4ffa2943b，与远端回读一致。另从维护者本次真实验收日志提取完整 JSON，离线调用同一纯函数，返回 DOCKER_DB_ROLE_BOOTSTRAP_PLAN_READY、8 条固定 SQL、planOnly=true、admissionPassed=false、databaseWritten=false，退出 0；没有连接数据库或执行 SQL。新增实际入口、环境静态门禁及全仓质量链待 Windows 验收，真实预览仅在维护者本机执行。

Windows 增量：`pnpm run test:docker`（预计 73 项）、`pnpm run test:prisma8:fresh`（预计 29 项）、`pnpm run env:check`、`pnpm run messages:check`、`pnpm run docs:check`、`vp check --fix`、`vp check`、`git diff --check`。之后单独执行 `pnpm run docker:db:role:plan`，预期状态 DOCKER_DB_ROLE_BOOTSTRAP_PLAN_READY、directoryReviewPassed=true、planOnly=true、admissionPassed=false、databaseWritten=false、serviceSwitched=false 及退出 0。无需重建镜像或重新初始化数据库；预览 SQL 不执行。
