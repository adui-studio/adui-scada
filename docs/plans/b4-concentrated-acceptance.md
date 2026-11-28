# B4 集中验收清单

> 2026-11-28，PR #262 Draft。此文是集中验收候选清单，不是实际授权或验收通过证明。当前协作环境未运行完整 Vite+、原生仓储 Vitest、全部 Docker 脚本及真实 PostgreSQL/Docker。持久化和服务切换必须独立批准，不能因阅读本清单自动执行。C/D/E/F 不提前放行。

## 一、集中代码质量门禁

先核对远端 PR 分支及 HEAD，使用仓库锁定的 Node/pnpm 和本机隔离 Docker 环境，保证工作区干净。不跳过任何失败；不得用局部 Node 测试替代 `pnpm run ready`。通过完整 `pnpm run ready`（包含 Vite+、中文、文档、类型、单测、Docker/Prisma 专项及现有工程验收链）后，单独执行 `git diff --check`。任何格式、类型、测试、依赖或契约错误均先修复再进行后续阶段。

## 二、B3.3 实际隔离及 B4 双库原始计划

1. 只读运行 `pnpm run docker:db:status`、`pnpm run docker:db:role:isolation:status`，检查固定 PG 19.0 集群、契约、中文注释以及 `catalogIsolationPersisted=true`，保留实际 B3 计划指纹 I。B3 未实际隔离时停止，按原 B3.3 流程另行批准回滚及持久化，不跳过。
2. 正常既有本机 Keycloak 与 OIDC Discovery/JWKS 可用时运行 `pnpm run docker:db:role:b4:plan`，保存实际计划指纹 S、确认 isolationFingerprint=I，预期 3 专用角色、92 条固定目录语句。
3. 运行 `pnpm run docker:db:role:keycloak:plan`，保存 `keycloak.ownershipPreview.planFingerprint` 为 K。维护者独立核对完整本机实际对象身份、依赖、ACL、实际镜像版本及 101 张目标表；聚合报告与计数不能代替审阅。两库计划、系统标识、部署端口和 B3 指纹必须来自同一固定环境。

## 三、两库回滚演练

以下 S、K、I、SC、KC 是上一步实际报告的 64 位小写十六进制指纹，不是字面参数。演练须由维护者分别确认、禁止并发管理员权限维护。

- SCADA：`pnpm run docker:db:role:b4:rehearse --confirm-rehearse-scada-b4 --confirm-rollback-business-fixtures --plan-fingerprint=S`。仅允许返回 SCADA_B4_ROLLBACK_REHEARSED、92 条目录语句、36 正向、15 精确权限拒绝、夹具回滚、原始独立基线匹配、rolledBack=true、committed=false、admissionPassed=false；记录 catalogFingerprint 为 SC。若真实过期 OIDC 记录存在，探针应停止而不是清除旧记录。
- Keycloak：维护者另行确认并手动进入停止窗口，不自动停止、启动或重启服务。无其他目标库会话、实际对象身份已审阅才执行 `pnpm run docker:db:role:keycloak:rehearse --confirm-rehearse-keycloak-ownership --reviewed-keycloak-objects --confirm-keycloak-maintenance --plan-fingerprint=K`。仅允许返回 KEYCLOAK_OWNERSHIP_ROLLBACK_REHEARSED、101 条变更、投影匹配、独立原基线、rolledBack=true、committed=false、admissionPassed=false；保存 projectionFingerprint 为 KC。
- 任何真实目录、锁、SQLSTATE、回滚、连接关闭或宿主核验异常停止。保留现场，不自动修复权限或重新执行。

## 四、独立批准后才允许持久化

两条 apply 入口属于代码候选，目前未实机验证，也未获实际执行授权。必须先完成一至三节、确认所有真实证据，维护者明确批准对应的每一次实际目录事务；不能将两次提交合并成一个跨库原子事务。

1. SCADA 安装需要既有正式 OIDC 探针可用。恢复既有服务须另外获得批准。原始 B3 及双库计划仍匹配，才可执行 `pnpm run docker:db:role:b4:apply --confirm-apply-scada-b4 --confirm-rehearsal-verified --confirm-rollback-business-fixtures --plan-fingerprint=S --catalog-fingerprint=SC --keycloak-plan-fingerprint=K`。期望 SCADA_B4_PERSISTED_STATE_VERIFIED、committed=true、ownerRolesPersisted=true、businessDataWritten=false、admissionPassed=false、serviceSwitched=false。独立核验：`pnpm run docker:db:role:b4:status --phase=scada-installed --isolation-fingerprint=I --scada-catalog-fingerprint=SC --keycloak-plan-fingerprint=K`。必须保持原 B3 指纹、三个所有者无数据库连接/临时/创建权限、SCADA 目录匹配及 Keycloak 原始基线。
2. Keycloak 所有权持久化需要重新进入独立维护窗口并确认实际镜像、对象身份及无并发连接，另行批准；`pnpm run docker:db:role:keycloak:apply --confirm-apply-keycloak-ownership --confirm-rehearsal-verified --reviewed-keycloak-objects --confirm-keycloak-maintenance --isolation-fingerprint=I --scada-catalog-fingerprint=SC --keycloak-plan-fingerprint=K --projection-fingerprint=KC`。期望 KEYCLOAK_OWNERSHIP_PERSISTED_STATE_VERIFIED、committed=true、ownershipPersisted=true、businessDataWritten=false、runtimeLoginAllowed=false、admissionPassed=false。
3. 保持 Keycloak 停止；`pnpm run docker:db:role:b4:status --phase=dual-installed --isolation-fingerprint=I --scada-catalog-fingerprint=SC --keycloak-plan-fingerprint=K --projection-fingerprint=KC`。独立双库只读目录必须匹配、隔离指纹不变、101 个共享表所有权依赖精确，Keycloak 投影指纹匹配。不同数据库事务快照不是原子快照，必须维持维护窗口并禁止并发管理员操作。双库状态成功仍不允许 LOGIN 或服务切换。
4. 任一 COMMIT 结果未知、提交标签已收到但独立复核失败、关闭失败均停止；先用相应的明确阶段只读入口核查实际状态，不重试、不自动逆向转移或删除角色。未安装、半安装及不符合两个明确阶段的目录必须拒绝，保留现场交由维护者独立评审恢复方案。

## 五、双连接锁与行级权限证据

新增独立双连接探针以维护者实际审阅过、已存在的本机隔离测试工程为夹具。固定文件 `.local/docker/b4-lock-fixture.json` 只含 tenantId、projectId、subjectId、otherSubjectId 四个标识，不放凭据，不提交 Git；两个主体不同且活动，第一主体恰有三项初始权限 project:read、version:read、version:append，第二主体在同一工程无授权。当前不能假定实际夹具存在，若没有须独立批准准备隔离测试数据；本入口不创建、提交、删除业务数据，不自动选择生产行。

在双库安装状态已确认、维护窗口继续保持且已审阅该夹具时，运行 `pnpm run docker:db:role:b4:lock-probe --confirm-reviewed-existing-fixture --isolation-fingerprint=I --scada-catalog-fingerprint=SC --keycloak-plan-fingerprint=K --projection-fingerprint=KC`。要求两个独立连接，同一集群，先取得无冲突排他锁，回滚后运行角色调用身份及授权共享锁例程，第二管理连接 FOR UPDATE NOWAIT 得到两次精确 SQLSTATE 55P03，共享锁事务回滚后排他锁重新成功，其他主体的授权结果为空；两连接回滚并关闭，完整双库目录前后一致。只验证身份与授权行锁冲突及释放，不等于实际撤权、会话撤销、发布事件、OIDC 消费和 CAS 的全部并发证明。

B4 完整行级验收还需在真实隔离环境对原生仓储的可信主体绑定、跨租户访问、禁用/撤权并发、会话及 OIDC 单次消费、CAS/失败原子回滚、不可变历史及发布门禁执行正反向验证。列 ACL 与有参数的锁例程不是数据库 RLS，不能声明 runtime 角色无法直接读取所有其他租户的已授权列。当前 `rowLockConcurrencyVerified`、`rowAuthorizationVerified` 保持 false；不能把双连接两项冲突或模拟测试标记为完整权限验收。

## 六、Keycloak Schema 演进策略

独立双库状态报告生成绑定实际已停止容器本地 image ID 和五个目录指纹的 KEYCLOAK_SCHEMA_POLICY_REVIEW_ONLY 候选。正式正常启动候选使用 validate、initialize-empty=false、auto-create-missing-indexes=false；独立迁移窗口候选使用 manual 及后两项 false，先核对备份恢复、实际固定镜像版本、官方 SQL 输出及对象变更，再按独立授权执行迁移、重新生成所有权指纹并复验。依据 [Keycloak 数据库配置](https://www.keycloak.org/server/db)、[全部 Provider 配置](https://www.keycloak.org/server/all-provider-config) 与 [升级指南](https://www.keycloak.org/docs/latest/upgrading/)。当前 Compose 仍为 latest 和旧共享管理身份，不在本轮改写、拉取或启动；真实镜像版本兼容性和启动 validate 尚未验证。表所有权天然保留自身 ALTER/DROP 能力，不宣称只有 DML 权限。后续正常部署须固定可审阅的镜像 digest、独立角色凭据及 validate 配置，并在隔离环境实际验证运行角色的 Schema 状态；不赋予 public CREATE，不自动恢复旧管理角色运行方式。schemaEvolutionVerified=false、runtimeLoginAllowed=false。

## 七、完整验收关闭条件

全质量链真实通过，B3.3 真实隔离，B4 两库回滚和逐次批准持久化、独立状态核验、真实对象身份评审、真实并发/应用层行级权限及 Keycloak Schema 兼容性证据齐全，全部失败和未知状态已排除，才能由维护者明确确认 B4 完成。当前不满足全部关闭条件。不得以本清单、候选代码、局部测试或目录匹配宣称 B4 完成，不得提前进入 C/D/E/F、合并 PR 或启用发布/运行准入。

## 八、首轮 Windows 失败记录与重新进入条件（2026-11-28）

首轮 HEAD fc658f8336de1def3169746e151c8139a1c7d7e8 的 ready 在两条 Keycloak 中文异常检查处退出 1，已按 E-174 调整为等价模板字符串；完整质量链必须重新执行。Docker 七服务、数据库严格契约及只读 OIDC 通过，但 B3.3 实际报告 catalogIsolationPersisted=false、publicConnectRetained=true；不能继续 B4。重新验证每个阶段时在一个 PowerShell 脚本块中执行，显式检查原生命令退出码和报告字段，失败后整个脚本块停止，不执行末尾成功提示；禁止使用失败后遗留或空的指纹。先通过完整 ready，再只读生成当前 B3.3 计划，按原 [Docker 原生角色初始化方案](docker-native-role-bootstrap-plan.md) 的消费者审阅、独立回滚演练和另行明确持久化审批完成 B3.3 后，才重新生成 B4 双库计划。不得修改安全门禁或使用历史指纹跳过隔离；不自动持久化、不切换服务。

## 九、Windows 完整质量门禁已通过，B3.3 只读计划已复验（2026-11-28）

维护者实测 df3737688f49c6ad9102b6d6c13df29dc7eb6c61：完整 ready 成功、Docker 222/222、单测 969/969、HTTP E2E 71/71、Vite+ 564 格式/402 受检零警告错误、Markdown 100 份及 React/Vue/NestJS 构建通过，git diff --check 通过且工作区干净。React 构建存在非阻塞分块大小提示（591.62 kB）。E-178 已复验关闭。

真实 B3.3 只读状态与计划的指纹一致，五库、19 角色、25 项原 ACL、8 项待移除 PUBLIC ACL、17 项预计保留 ACL、95 项有效权限和 5 条固定 REVOKE；尚未实际隔离。下一步按原隔离方案实际审阅三组消费者（含现有连接、维护/备份/监控工具、模板及未连接任务），维护窗口内禁止并发权限维护，重新确认当前计划指纹与已审阅证据一致，再独立批准回滚演练。演练只允许 DOCKER_DB_ROLE_ISOLATION_REHEARSED、catalogIsolationVerified=true、catalogIsolationPersisted=false、catalogStatementsExecuted=true、publicConnectRetained=true、rolledBack=true、committed=false、databaseWritten=false、businessDataWritten=false、serviceSwitched=false、admissionPassed=false、postVerificationPassed=true；再独立读取原状态和既有 Docker/OIDC 回归。消费者确认参数不是自动认证。实际持久化须另行明确批准，不因质量门禁通过而提前执行。不进入 B4 持久化或 C/D/E/F，不合并 PR。本记录只更新文档，新的文档检查仍待运行。

## 十、B3.3 真实回滚演练已通过，待独立持久化（2026-11-28）

维护者在 5eac0a25bdf15443a1f058a955b3bc2174ee5e0d 通过文档检查（100 份）及 Git 差异检查。三组消费者审阅声明已确认（REHEARSE），真实固定五库计划及回滚演练指纹为 `0d0ead9db7e280d0d6e66464f36d392212206d71f3bdf5f57f05dbea55b45e37`；演练实际执行目录语句、验证隔离、确认回滚且 postVerificationPassed=true，独立只读状态确认原 PUBLIC CONNECT 保留、无持久化，回滚后严格结构契约、OIDC 只读检查及七服务状态通过。未执行真实持久化、业务写入、LOGIN 或服务切换。

下一步仅在本机固定隔离 Docker 环境、工作区干净、三组消费者和无并发权限维护再次确认、原始状态及新生成计划指纹与该次实机证据完全相符、维护者独立明确批准持久化时，使用原有入口：

```powershell
pnpm run docker:db:role:isolation:execute --confirm-apply-isolation --confirm-rehearsal-verified --reviewed-business-consumers --reviewed-maintenance-consumers --reviewed-template-consumers --plan-fingerprint=0d0ead9db7e280d0d6e66464f36d392212206d71f3bdf5f57f05dbea55b45e37
```

预期退出 0 且 DOCKER_DB_ROLE_ISOLATION_APPLIED，原指纹不变，catalogStatementsExecuted=true、catalogIsolationVerified=true、catalogIsolationPersisted=true、publicConnectRetained=false、committed=true、rolledBack=false、databaseWritten=true、businessDataWritten=false、serviceSwitched=false、admissionPassed=false、isolationPassed=false、postVerificationPassed=true。单独执行 `pnpm run docker:db:role:isolation:status`，要求 DOCKER_DB_ROLE_ISOLATION_STATUS_READY、同指纹、catalogIsolationVerified=true、catalogIsolationPersisted=true、publicConnectRetained=false、catalogStatementsExecuted=false、databaseWritten=false、committed=false、rolledBack=true（只读核验事务本身回滚，不代表撤销已提交 ACL），再复验数据库严格契约、OIDC 只读与 Docker 服务。提交结果未知或后置/关闭失败时停止，不重试、不恢复 ACL、不继续 B4，先独立核查状态。只有以上均通过才依第二节重新生成 B4 双库只读计划；仍不自动执行 B4 安装或所有权变更，不提前放行 C/D/E/F。此追加记录不是持久化授权，新提交文档检查待复验。

## 十一、B3.3 持久化通过，进入双库只读计划（2026-11-28）

维护者在 00c1e65315edb41451f15221a4d94320d5227c9c 实际完成独立 APPLY 审批、正式隔离事务及独立后置核验。原计划指纹 I 为 `0d0ead9db7e280d0d6e66464f36d392212206d71f3bdf5f57f05dbea55b45e37`，存储指纹与 PG 19.0 保持一致。DOCKER_DB_ROLE_ISOLATION_APPLIED、catalogStatementsExecuted=true、catalogIsolationVerified=true、catalogIsolationPersisted=true、committed=true、publicConnectRetained=false、postVerificationPassed=true；独立状态确认已持久化，原生结构契约、OIDC 只读、Docker 七服务及文档检查通过。业务数据未写入，服务未切换，admissionPassed=false、isolationPassed=false。不得重复执行 B3.3 apply。

第二节前置条件在本次实机验收已满足。同步最新仅文档提交并复验 docs:check、git diff --check 后，重新只读确认 B3 状态及原指纹，正常运行既有 Keycloak，无并发权限维护，分别执行：

```powershell
pnpm run docker:db:role:b4:plan
pnpm run docker:db:role:keycloak:plan
```

每条命令须显式检查退出码；SCADA 预期 SCADA_B4_REHEARSAL_PLAN_ONLY、isolationFingerprint=I、roleCount=3、statementCount=92、expectedPositiveCount=36、expectedDeniedCount=15、planOnly=true、installationAllowed=false、issuerBindingVerified=false、admissionPassed=false、databaseWritten=false。保存其 planFingerprint 为 S。Keycloak 外层预期 DOCKER_DB_ROLE_OBJECT_REVIEW_READY、planFingerprint=I、catalogIsolationPersisted=true、directoryReviewPassed=true、ownershipTransferAllowed=false、businessAclApproved=false、databaseWritten=false、serviceSwitched=false、admissionPassed=false；内层 keycloak.ownershipPreview 预期 KEYCLOAK_OWNERSHIP_PLAN_READY、planOnly=true、tableCount=101、statementCount=101、objectIdentityReviewed=false、ownershipTransferAllowed=false、runtimeLoginAllowed=false、databaseWritten=false、serviceSwitched=false、admissionPassed=false，保存其 planFingerprint 为 K。实际报告必须核验，不以预期代替实测；两份指纹须为实际 64 位小写十六进制值。再次独立核验 B3 原指纹及已持久化状态，确认双库计划未写入。

本轮只允许生成只读计划和审阅实际目录；不自动停止 Keycloak，不执行 SCADA 或 Keycloak 回滚演练，不提交 B4 ACL，不转移所有权。聚合计划不能证明实际 Keycloak 对象身份，须另行核对完整目标表及依赖、当前镜像和 Schema 策略后分别批准演练。B4 完整验收、C/D/E/F 尚未完成，PR 保持 Draft。本次仅文档更新，新提交文档检查待 Windows 复验。

## 十二、SCADA 真实计划通过，Keycloak 目录诊断阻塞（2026-11-28）

维护者实测 29225762d5b2da872a6d354d1a8ecb58d184aa2e 的文档 100 份、Git 差异、B3.3 已持久化状态、严格结构契约、OIDC 只读及 Docker 七服务通过。SCADA 计划指纹 S 为 `aac93ff83a3baaa8b97781bd32e35afb049209e38a40c63c8487d3511b65ade0`，3 角色、92 条固定语句、36/15 探针预期、hostBoundaryVerified=true、rolledBack=true、databaseWritten=false。Keycloak 返回对象类型、名称、所有者或 ACL 不一致，未取得 K 指纹，脚本中止且本轮后置独立核验未执行。不得使用旧指纹、模拟目录或只通过 SCADA 计划跳过 Keycloak 阻塞。

先独立确认 B3.3 状态及固定集群，使用同一代码版本的 inventorySql 在 REPEATABLE READ READ ONLY 事务中聚合对象校验失败数，分别统计种类、名称正则、大小写差异、父对象标识、所有者、clean；不输出未知对象名、实际 ACL 内容、业务数据、凭据。若 clean 失败再细分目录属性，若存在不符合命名规则的对象，先核对实际 Keycloak 创建来源及安全标识规则。诊断必须确认回滚与连接结束；错误停止，不自动修改对象或 ACL。不预设失败原因，不改变白名单、权限限制、指纹算法或计划执行边界。根因确认后按实际影响决定最小修复及实测验证，再重新运行完整双库只读计划及后置独立核验。当前不得进入 B4 两库回滚演练、持久化或 C/D/E/F。PR 继续保持 Draft。

## 十三、E-179 真实索引名称误拒绝修复，待重新验收（2026-11-28）

同集群真实目录只读诊断通过固定身份、B3.3 已持久化基线及回滚；六类共 687 项：101 表、252 普通索引、101 行类型、101 数组类型、66 TOAST、66 TOAST 索引。仅普通索引 bad_name=4、ascii_case_only=3，其他聚合断言均为零失败，第四个具体名称未取得。根因为普通索引复用了表 SQL 标识符白名单；仅改普通索引名称为非空、无 NUL、UTF-8 无损且不超过 63 字节的目录证据，原名完整参与指纹和投影，不进入表锁、所有权 SQL 或公开报告。其余五类名称、对象种类、OID、父依赖、所有者、ACL、安全属性、普通表固定数量及所有审批门禁不变。

同步修复提交后，先实际通过 Keycloak 完整定向测试、全 Docker 专项、Vite+、中文文案、文档及 Git 差异检查；协作容器已实测纯计划和投影源码片段局部 4/4（修复前 2/4），非完整测试链。再重新执行第二节及第十一节所述双库只读计划与独立后置核验。SCADA 指纹预期保持 aac93ff83a3baaa8b97781bd32e35afb049209e38a40c63c8487d3511b65ade0，Keycloak 预期取得真实 K 指纹、101 条表候选及六类对象完整计数；若实际对象或指纹变化，先停止并审阅，不自动接受。真实对象身份及第四个索引名称仍需本机审阅；当前不批准回滚演练、持久化、LOGIN、服务切换或合并。完整真实复验通过后才关闭 E-179。
