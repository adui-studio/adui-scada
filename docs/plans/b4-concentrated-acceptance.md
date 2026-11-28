# B4 集中验收清单

> 2026-11-28，PR #262 Draft。此文是集中验收候选清单，不是实际授权或验收通过证明。当前协作环境未运行完整 Vite+、原生仓储 Vitest、全部 Docker 脚本及真实 PostgreSQL/Docker。持久化和服务切换必须独立批准，不能因阅读本清单自动执行。C/D/E/F 不提前放行。

## 一、集中代码质量门禁

先核对远端 PR 分支及 HEAD，使用仓库锁定的 Node/pnpm 和本机隔离 Docker 环境，保证工作区干净。不跳过任何失败；不得用局部 Node 测试替代 `pnpm run ready`。通过完整 `pnpm run ready`（包含 Vite+、中文、文档、类型、单测、Docker/Prisma 专项及现有工程验收链）后，单独执行 `git diff --check`。任何格式、类型、测试、依赖或契约错误均先修复再进行后续阶段。

## 二、B3.3 实际隔离及 B4 双库原始计划

1. 只读运行 `pnpm run docker:db:status`、`pnpm run docker:db:role:isolation:status`，检查固定 PG 19.0 集群、契约、中文注释以及 `catalogIsolationPersisted=true`，保留实际 B3 计划指纹 I。B3 未实际隔离时停止，按原 B3.3 流程另行批准回滚及持久化，不跳过。
2. 正常既有本机 Keycloak 与 OIDC Discovery/JWKS 可用时运行 `pnpm run docker:db:role:b4:plan`，保存实际计划指纹 S、确认 isolationFingerprint=I，预期 3 专用角色、93 条固定目录语句（E-182 修复后的版本 3，详见第十七节）。
3. 运行 `pnpm run docker:db:role:keycloak:plan`，保存 `keycloak.ownershipPreview.planFingerprint` 为 K。维护者独立核对完整本机实际对象身份、依赖、ACL、实际镜像版本及 101 张目标表；聚合报告与计数不能代替审阅。两库计划、系统标识、部署端口和 B3 指纹必须来自同一固定环境。

## 三、两库回滚演练

以下 S、K、I、SC、KC 是上一步实际报告的 64 位小写十六进制指纹，不是字面参数。演练须由维护者分别确认、禁止并发管理员权限维护。

- SCADA：`pnpm run docker:db:role:b4:rehearse --confirm-rehearse-scada-b4 --confirm-rollback-business-fixtures --plan-fingerprint=S`。仅允许返回 SCADA_B4_ROLLBACK_REHEARSED、93 条目录语句、36 正向、15 精确权限拒绝、夹具回滚、原始独立基线匹配、rolledBack=true、committed=false、admissionPassed=false；记录 catalogFingerprint 为 SC。若真实过期 OIDC 记录存在，探针应停止而不是清除旧记录。
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

## 十四、E-179/E-180 已关闭，进入 SCADA 真实回滚演练（2026-11-28）

维护者在 d9f05cb411377eec639e24f467333b88035128f2 完成格式修复后的完整集中复验：28/28、225/225、Vite+ 564 格式/402 受检零警告错误、中文 428 文件、Markdown 100 份及 Git 差异检查通过。B3.3 前后已持久化基线、原生严格契约、OIDC 只读与 Docker 七服务通过。真实计划 I=`0d0ead9db7e280d0d6e66464f36d392212206d71f3bdf5f57f05dbea55b45e37`，S=`aac93ff83a3baaa8b97781bd32e35afb049209e38a40c63c8487d3511b65ade0`，K=`60ae2f485107105ee98172cd69fc79cface21a40878b3f1f5e50bccc8011bbeb`。SCADA 3 角色、92 固定目录语句、36/15 探针预期；Keycloak 101 表、101 语句、六类 687 项目录对象，原所有者和依赖目录核验通过。实际 K 已生成，未实际安装任何 B4 权限；人工对象身份审阅仍待完成。

本轮同步仅文档提交并复验 docs:check、git diff --check；重新只读确认 B3.3 及 I/S/K、原存储指纹和 PG 版本，保持既有 Keycloak 运行及 OIDC 探针可用。维护者须确认固定本机隔离环境、无并发管理员权限维护、接受短时锁及合成业务夹具的事务内临时写入和强制回滚，再单独运行第三节 SCADA 演练入口：

```powershell
pnpm run docker:db:role:b4:rehearse --confirm-rehearse-scada-b4 --confirm-rollback-business-fixtures --plan-fingerprint=aac93ff83a3baaa8b97781bd32e35afb049209e38a40c63c8487d3511b65ade0
```

要求 SCADA_B4_ROLLBACK_REHEARSED、原 S、有效 64 位 catalogFingerprint（SC）、statementsExecuted=92、transactionCatalogMatched=true、independentBaselineMatched=true、rolledBack=true、committed=false、databaseWritten=false、businessDataWritten=false、ownerRolesPersisted=false、installationAllowed=false、issuerBindingVerified=false、definerSafetyVerified=false、rowLockVerified=false、rowAuthorizationVerified=false、businessAclApproved=false、admissionPassed=false、serviceSwitched=false。内层 runtimeProbe 要求 SCADA_B4_RUNTIME_STATEMENTS_MATCHED、positiveCount=36、deniedCount=15、fixturesRolledBack=true、runtimeStatementsVerified=true、rowLockConcurrencyVerified=false、rowAuthorizationVerified=false、businessDataWritten=false、admissionPassed=false。再次独立确认原 I/S/K、结构契约、OIDC 只读与服务状态，记录真实 SC，不使用模拟指纹。存在真实过期 OIDC 记录或锁失败时停止，不清除既有记录、不重试。新提交文档检查待复验，本记录不构成执行授权；Keycloak 对象审阅、停止窗口及演练独立批准，两库 apply、LOGIN、服务切换及合并均未批准。

## 十五、B4.2 真实角色目录阻塞，先独立只读恢复核验（2026-11-28）

维护者在 af5d57732284df753a9e62d6fd81cd67fc51c03b 实测文档 100 份、Git 差异、原 I/S/K、严格原生契约、OIDC 只读及七服务前置通过。实际 REHEARSE 后在安装后组合目录核验首组拒绝，报告专用角色属性及依赖不一致和已收到目录事务回滚标签；外部独立后置未执行、未进入 36/15 探针、未取得 SC 指纹。E-181 保留全部 SQL、期望矩阵、精确比较和审批，只追加固定预期角色及字段诊断，不输出实际目录名和值。局部 5/5 不是完整测试或真实权限通过。

同步诊断补丁后先执行 B3.3 独立状态、两库原始只读计划、严格契约、OIDC 只读和 Docker 状态，要求原 I=0d0ead9db7e280d0d6e66464f36d392212206d71f3bdf5f57f05dbea55b45e37、S=aac93ff83a3baaa8b97781bd32e35afb049209e38a40c63c8487d3511b65ade0、K=60ae2f485107105ee98172cd69fc79cface21a40878b3f1f5e50bccc8011bbeb 完全一致并保持 catalogIsolationPersisted=true、databaseWritten=false、admissionPassed=false、B4 planOnly=true；SCADA 原计划前置须证明三个专用角色未残留。失败保留现场，禁止删除角色、调整 ACL 或重试。完整权限目录定向（预计 10 项）、Docker（预计 226 项）、Vite+、中文、文档及 Git 差异复验后，维护者另行明确批准一次第十四节固定回滚演练，若失败仅收集新的脱敏角色字段诊断并独立只读复验，不自动重试。所有真实成功证据仍按第十四节验证。根因未确认，SCADA B4.2 未通过；不执行 Keycloak 停止、演练、两库 apply、LOGIN、服务切换或合并。

## 十六、E-181 已关闭，E-182 控制函数 ACL 溯源（2026-11-28）

维护者在 1dcb9234e33234983eb4ccc55b9977c4921beee8 实测权限目录 10/10、Docker 226/226、Vite+ 564 格式/402 受检零警告错误、中文 428 文件、Markdown 100 份及 Git 差异通过。真实演练失败字段仅为 Keycloak 运行角色和三个专用所有者的 clusterFunctionExecute，收到目录事务回滚标签；finally 独立原 I/S/K、严格契约、OIDC 只读和 Docker 七服务均通过。没有 SC 指纹、没有真实业务探针结果，原 92 条计划不得再执行。

已核实 B2 显式授予 SCADA 运行角色 pg_catalog.pg_control_system() EXECUTE，B4 固定候选未撤销该函数的 PUBLIC EXECUTE，预期矩阵仍要求仅 SCADA 运行角色有有效执行权。先仅在固定 SCADA 库的已核验管理身份、REPEATABLE READ READ ONLY 事务中通过 has_function_privilege 与 aclexplode/COALESCE(acldefault) 确认该函数的真实公共、直接与未知授权类别、所有者和授权选项，明确回滚并退出连接。只输出固定类别及布尔/计数，不输出未知名称、原始 ACL 或凭据。维护者同时审阅本库依赖该函数的监控、备份、维护及其他消费者。若确认 PUBLIC 来源，再独立评估增加唯一固定本库公共执行撤销候选；不手工执行 REVOKE，不放宽有效权限预期，不扩至其他库/函数。新增候选必须更新 92 条预期、重新生成 S（旧 S 禁用）、回归测试、文档和独立演练审批；I/K 仍需核验。本轮仅记录文档，实际 ACL 及修复待确认，E-182 和 B4.2 未关闭。

## 十七、E-182 已确证，计划版本 3 与 93 条目录语句（2026-11-28）

维护者在 daa1eb9bc0b237663fc4523fd7480e481d1f7517 通过文档 100 份、Git 差异和真实固定 SCADA 库只读 ACL 诊断。管理者是函数所有者、显式 OWNER/PUBLIC/SCADA_RUNTIME 各一条 EXECUTE、均由所有者授权且无显式 grant option；PUBLIC/SCADA/Keycloak 有效 EXECUTE 均 true，SCADA 无 grant option，其他显式授权为零、残留专用角色为零；ROLLBACK 成功。根因确认。候选修复仅增加本库固定 REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM PUBLIC RESTRICT；前置精确原三项 ACL、安装后精确两项 ACL 及原有效权限矩阵；保留原业务权限、事务和独立回滚基线，原 B3.3 与 Keycloak 不改。

本节覆盖此前关于 92 条和旧 SCADA S 的执行指令：计划版本 3、93 条语句，旧 S aac93ff83a3baaa8b97781bd32e35afb049209e38a40c63c8487d3511b65ade0 禁止执行。第十四至十六节旧指纹和数量仅为历史证据。同步修复后，先完成四组完整 Node 定向（前置、权限目录、演练、宿主）、Docker 预期 226 项、Vite+、中文、文档和 Git 差异，重新验证 B3.3 I、Keycloak K 及真实新 S（93 条、3 角色、36/15，未写入）。只有维护者实际审阅 SCADA 库监控/备份/维护及其他依赖该函数的消费者、确认固定隔离环境、无并发权限维护，并独立批准新 S 的回滚演练时，才使用原回滚入口及新真实 S。验收第十四节所有真实条件不变，但 statementsExecuted=93；成功或失败后均独立核对新 S 原始计划（含原三项 ACL）、I/K、严格契约、OIDC 只读及 Docker 状态。不得自动接受旧 S、自动重试、手工撤销 ACL、实际持久化或切换服务。新 SC 仅从真实成功演练取得，E-182 仍待关闭；局部 Node 4/4 非完整专项或实机证据。

## 十八、E-182 关闭及 B4.3 Keycloak 独立回滚演练（2026-11-28）

维护者 Windows 在 273d34b4715a4272b9c842e4917ca2d2966e9683 实际通过四组定向 37/37（8/10/12/7）、Docker 226/226、Vite+ 564 格式/402 受检零警告错误、中文 428 文件、Markdown 100 份、Git 差异。明确输入 REHEARSE 后返回 SCADA_B4_ROLLBACK_REHEARSED、93 条目录语句、36/15 业务探针、夹具回滚及事务/独立基线匹配，rolledBack=true、committed=false、databaseWritten=false、businessDataWritten=false、ownerRolesPersisted=false、admissionPassed=false、serviceSwitched=false。外部 finally 再次独立确认 I/S/K、原三项控制函数 ACL、零残留所有者、严格契约、OIDC 只读与七服务，工作区干净。E-182 关闭、B4.2 通过，不重复原演练。

实际指纹：I=`0d0ead9db7e280d0d6e66464f36d392212206d71f3bdf5f57f05dbea55b45e37`，S=`cbfc3852bc860a6e576c933b5247e028d5b8056d408b42bc426cc038324f3314`，K=`60ae2f485107105ee98172cd69fc79cface21a40878b3f1f5e50bccc8011bbeb`，SC=`2d6b202e637bc16685557603b2aab496546bc1db6ac16b6c15530340abfcb360`。KC 尚未取得。旧版本 2 的 S 失效。

B4.3 使用既有入口，不新增 SQL。先在七服务正常状态复核原 I/S/K、严格契约、OIDC，维护者实际检查唯一固定 Keycloak 容器、实际 image ID 和版本，以及固定 Keycloak 库原目录的 101 普通表、252 普通索引、66 TOAST、66 TOAST 索引、101 行类型和 101 数组类型（共 687），核对名称、OID/父关系、原所有者和 clean/ACL 证据，不仅审阅聚合数量；不查询业务数据或提交对象清单。明确维护窗口及备份/恢复安排，禁止其他管理员与连接池并发访问。手动停止同一 Keycloak 容器，不拉取、重建、删除或自动停启。现有宿主要求唯一固定容器、状态 exited、running/paused/restarting=false、restart=no、原镜像标记和实际 image ID；目标库事务内多次验证没有其他会话，全目标表 NOWAIT 排他锁。仅在实际对象审阅及独立批准后运行：

```powershell
node apps/server/prisma8-fresh-install.mjs --role-keycloak-rehearse --confirm-rehearse-keycloak-ownership --reviewed-keycloak-objects --confirm-keycloak-maintenance --plan-fingerprint=60ae2f485107105ee98172cd69fc79cface21a40878b3f1f5e50bccc8011bbeb
```

预期 KEYCLOAK_OWNERSHIP_ROLLBACK_REHEARSED、planFingerprint=K、两个真实 64 位 baselineFingerprint/projectionFingerprint、statementsExecuted=101、transactionCatalogMatched=true、independentBaselineMatched=true、operatorObjectReviewConfirmed=true、operatorMaintenanceConfirmed=true、rolledBack=true、committed=false、databaseWritten=false、ownershipTransferAllowed=false、ownerProjectionVerified=false、schemaEvolutionVerified=false、runtimeLoginAllowed=false、businessAclApproved=false、admissionPassed=false、serviceSwitched=false。记录 projectionFingerprint 为 KC（不预填）。成功或失败均在停机窗口内独立只读核验 I/K、两库原目录及 SCADA 原始控制函数 ACL、严格契约；异常保留现场，不自动重试、回收权限或启动。仅在回滚及独立核验明确成功后，维护者另行确认手动启动原容器，不变更镜像或身份；待服务就绪再复核原 I/S/K、OIDC 只读及七服务。此阶段不执行 apply、LOGIN、正式 Schema 迁移或服务切换；B4.3 待实机验收，不进入 C，不合并。

## 十九、B4.3 实测通过，进入 B4.4a SCADA 独立持久化（2026-11-28）

维护者在 77b32f67a163525dc18b2f826691e7f8b2a4ee29 实测文档 100 份、Git 差异、原生严格契约、OIDC 只读通过。实际 Keycloak 26.8.2、image ID sha256:7e66a96e4739239070aeaf72e4c5decf0f7f682cfc725b9f7ea2b336eaba38b3、restart=no；固定只读身份确认及 687 项真实对象审阅完成（逐行核对所有者、clean、OID 和父关系）。独立确认 REHEARSE 后，101 条真实所有权语句、事务投影、独立原基线及回滚通过，未提交、未持久化或切换服务。KC=`877ba8254960856e364edd816281f74ab24c4f6fa3a815d9a52fea4fe8192ab9`，原始 Keycloak 目录指纹=`ad6a85a866cffc738b0b1e1c8d7b467382685a786b5150c2ba43386ff40d8879`。外部停机窗口原 I/K、原 SCADA ACL/零专用角色和严格契约复核通过；恢复同一既有容器后前两次 Discovery 连接失败、第三次完整 OIDC、契约、I/S/K 和七服务通过。未取得启动失败根因的独立证据，不修改安全门禁。第十八节 I/S/SC/K 与本节 KC 合为五个真实指纹，双库回滚阶段关闭，不重复执行。

仅 B4.4a：保持既有 Keycloak 运行且 OIDC 只读可用，确认本机隔离集群、备份恢复安排（日志未证明备份可恢复）、无并发权限维护和业务夹具冲突，重新核对原 I/S/K 与已审阅证据一致。维护者独立明确批准 SCADA 目录持久化，而非再次回滚演练；使用既有固定入口：

```powershell
node apps/server/prisma8-fresh-install.mjs --role-b4-apply --confirm-apply-scada-b4 --confirm-rehearsal-verified --confirm-rollback-business-fixtures --plan-fingerprint=cbfc3852bc860a6e576c933b5247e028d5b8056d408b42bc426cc038324f3314 --catalog-fingerprint=2d6b202e637bc16685557603b2aab496546bc1db6ac16b6c15530340abfcb360 --keycloak-plan-fingerprint=60ae2f485107105ee98172cd69fc79cface21a40878b3f1f5e50bccc8011bbeb
```

预期 SCADA_B4_PERSISTED_STATE_VERIFIED、planFingerprint=S、catalogFingerprint=SC、statementsExecuted=93、runtimeProbe 正向 36/拒绝 15/fixturesRolledBack=true、transactionCatalogMatched=true、independentInstalledStateMatched=true、rolledBack=false、committed=true、databaseWritten=true（仅角色及目录 ACL/例程）、businessDataWritten=false、ownerRolesPersisted=true、runtimeLoginAllowed=false、businessAclApproved=false、admissionPassed=false、serviceSwitched=false。确认后独立执行：

```powershell
node apps/server/prisma8-fresh-install.mjs --role-b4-status --phase=scada-installed --isolation-fingerprint=0d0ead9db7e280d0d6e66464f36d392212206d71f3bdf5f57f05dbea55b45e37 --scada-catalog-fingerprint=2d6b202e637bc16685557603b2aab496546bc1db6ac16b6c15530340abfcb360 --keycloak-plan-fingerprint=60ae2f485107105ee98172cd69fc79cface21a40878b3f1f5e50bccc8011bbeb
```

预期 B4_SCADA_INSTALLED_STATE_VERIFIED、phase=scada-installed、I/SC/K 精确匹配、keycloakCatalogFingerprint 为本节原始目录指纹、b4OwnerRoleCount=3、b4OwnerDatabasePermissionsDenied=true、catalogIsolationPersisted=true、scadaCatalogMatched=true、keycloakBaselineMatched=true、keycloakOwnerProjectionMatched=false、independentConnectionsClosed=true、databaseWritten=false、businessDataWritten=false、runtimeLoginAllowed=false、admissionPassed=false、serviceSwitched=false。此后严格契约、OIDC 只读、七服务复验。安装后原始 B3.3 与原始计划入口不再是安装态检查依据，不能尝试重新执行旧计划；任何提交结果未知、关闭或独立核验失败不得自动重试/逆向变更，先独立只读核查明确阶段并保留现场。

B4.4b Keycloak 持久化必须在 B4.4a 实测完成后另行独立批准，重新进入固定维护窗口；本阶段不提交 Keycloak 所有权，不开启 LOGIN，不切换服务身份，不进入 C/D/E/F 或合并。此次文档提交不代表真实持久化已完成。

## 二十、B4.4a 已正式持久化，进入 B4.4b Keycloak 所有权持久化（2026-11-28）

维护者在 1fb8b8e042fa927014b75cc8270968f177c6149c 实测文档 100 份、Git 差异、严格契约、OIDC 只读、七服务、原 I/S/K 前置通过，明确输入 APPLY-SCADA；真实 SCADA_B4_PERSISTED_STATE_VERIFIED、93 条、36/15 探针、夹具回滚、事务目录及独立安装态匹配，committed=true、databaseWritten=true、businessDataWritten=false、ownerRolesPersisted=true。内嵌与外部 B4_SCADA_INSTALLED_STATE_VERIFIED 均确认 I/SC/K 及 Keycloak 原始目录 ad6a85a866cffc738b0b1e1c8d7b467382685a786b5150c2ba43386ff40d8879、3 专用所有者数据库权限拒绝、SCADA 目录匹配、原 Keycloak 基线匹配、独立连接关闭，无 LOGIN、准入或服务切换。后置严格契约、OIDC 只读及七服务通过，工作区干净。B4.4a 已关闭，现只用 scada-installed 状态核验，不再执行 SCADA apply 或原始计划/隔离状态作为安装态依据。

B4.4b 先在原服务运行状态以 scada-installed 独立复验 I/SC/K、原 Keycloak 目录及严格契约、OIDC 只读，复核此前已审阅的 101 表/687 对象、实际 Keycloak 26.8.2 及固定 image ID sha256:7e66a96e4739239070aeaf72e4c5decf0f7f682cfc725b9f7ea2b336eaba38b3，明确备份/恢复安排和独立维护窗口。维护者手动只停止唯一原 Keycloak 容器，不自动停启、不重建、不变镜像；核对 exited、running/paused/restarting=false、restart=no，无其他数据库客户端、连接池或管理员并发访问目标库。停止后重新核验 scada-installed，再单独批准实际 Keycloak 目录提交（不是回滚）。执行既有固定入口：

```powershell
node apps/server/prisma8-fresh-install.mjs --role-keycloak-apply --confirm-apply-keycloak-ownership --confirm-rehearsal-verified --reviewed-keycloak-objects --confirm-keycloak-maintenance --isolation-fingerprint=0d0ead9db7e280d0d6e66464f36d392212206d71f3bdf5f57f05dbea55b45e37 --scada-catalog-fingerprint=2d6b202e637bc16685557603b2aab496546bc1db6ac16b6c15530340abfcb360 --keycloak-plan-fingerprint=60ae2f485107105ee98172cd69fc79cface21a40878b3f1f5e50bccc8011bbeb --projection-fingerprint=877ba8254960856e364edd816281f74ab24c4f6fa3a815d9a52fea4fe8192ab9
```

预期 KEYCLOAK_OWNERSHIP_PERSISTED_STATE_VERIFIED、planFingerprint=K、baselineFingerprint=ad6a85a866cffc738b0b1e1c8d7b467382685a786b5150c2ba43386ff40d8879、projectionFingerprint=KC、statementsExecuted=101、transactionCatalogMatched=true、independentInstalledStateMatched=true、operatorObjectReviewConfirmed=true、operatorMaintenanceConfirmed=true、rolledBack=false、committed=true、databaseWritten=true（仅所有权目录）、businessDataWritten=false、ownershipPersisted=true、runtimeLoginAllowed=false、schemaEvolutionVerified=false、businessAclApproved=false、admissionPassed=false、serviceSwitched=false。保持维护窗口及 Keycloak 停止，独立执行：

```powershell
node apps/server/prisma8-fresh-install.mjs --role-b4-status --phase=dual-installed --isolation-fingerprint=0d0ead9db7e280d0d6e66464f36d392212206d71f3bdf5f57f05dbea55b45e37 --scada-catalog-fingerprint=2d6b202e637bc16685557603b2aab496546bc1db6ac16b6c15530340abfcb360 --keycloak-plan-fingerprint=60ae2f485107105ee98172cd69fc79cface21a40878b3f1f5e50bccc8011bbeb --projection-fingerprint=877ba8254960856e364edd816281f74ab24c4f6fa3a815d9a52fea4fe8192ab9
```

预期 B4_DUAL_INSTALLED_STATE_VERIFIED、phase=dual-installed、I/SC/K/KC 精确匹配、b4OwnerRoleCount=3、b4OwnerDatabasePermissionsDenied=true、catalogIsolationPersisted=true、scadaCatalogMatched=true、keycloakOwnerProjectionMatched=true、keycloakBaselineMatched=false、keycloakMaintenanceVerified=true、crossDatabaseAtomicSnapshotVerified=false、independentConnectionsClosed=true、databaseWritten=false、businessDataWritten=false、runtimeLoginAllowed=false、schemaEvolutionVerified=false、rowLockConcurrencyVerified=false、rowAuthorizationVerified=false、admissionPassed=false、serviceSwitched=false。取得实际 dualCatalogFingerprint 及内嵌 KEYCLOAK_SCHEMA_POLICY_REVIEW_ONLY 的 planFingerprint；必须绑定原实际 image ID、正常 validate 候选和维护 manual 候选及两者 initialize-empty=false、auto-create-missing-indexes=false。候选明确禁止自动迁移及 Schema CREATE、保留表所有者 ALTER/DROP 能力，要求独立备份恢复审阅、固定部署镜像及隔离启动验证。不得将候选等同实际 Schema 验证，不声称跨库原子快照。

成功后在停机窗口只读严格契约、固定容器状态及独立目录再次核对；本阶段不执行 OIDC 连通探针作为停机态通过条件，不直接启动旧管理身份 Keycloak。B4.5 真实并发及行级权限和 Schema 演进实际验证仍待完成。任何执行失败、提交未知、独立核验失败或容器身份变化必须保留现场，禁止自动重试 apply、逆向转移所有权、删除角色或恢复旧服务。此文档提交不等于 B4.4b 通过；不开放 LOGIN、服务切换、C/D/E/F 或合并。

## 二十一、B4.4b 实测通过，进入 B4.5 双连接锁验收（2026-11-28）

维护者在 16aa8d548064100ae1fce6e771305406f6ab01c6 完成文档 100 份、Git 差异、严格契约、停机前 OIDC 只读、scada-installed、原容器及 Keycloak 26.8.2/image ID sha256:7e66a96e4739239070aeaf72e4c5decf0f7f682cfc725b9f7ea2b336eaba38b3 核验。手动停止原容器、独立明确输入 APPLY-KEYCLOAK，真实 KEYCLOAK_OWNERSHIP_PERSISTED_STATE_VERIFIED、101 条、事务目录及独立安装态匹配、committed=true、databaseWritten=true、businessDataWritten=false、ownershipPersisted=true。内嵌和外部 B4_DUAL_INSTALLED_STATE_VERIFIED 均通过 I/SC/K/KC、三专用所有者数据库权限拒绝、两库目录、维护停机与独立连接关闭。DC=`5327e4a3e6c1abefad8824048c6b5e20af29a866dde348d50085091500524862`，Schema 策略候选 KP=`f4b7ac5a5aac70c21ca38107a1fad8124d11d95992d7a55a5d4309e3aee4097b`，绑定原镜像及 validate/manual 参数。严格契约及原容器停止状态、干净工作区通过。B4.4 两库分别持久化关闭，禁止重复 apply；crossDatabaseAtomicSnapshotVerified、runtimeLoginAllowed、schemaEvolutionVerified、rowLockConcurrencyVerified、rowAuthorizationVerified、admissionPassed、serviceSwitched 均仍 false。

B4.5 先在维护停机窗口以 dual-installed 独立只读确认 I/SC/K/KC/DC/KP、严格契约、原容器身份。只读统计已有 SCADA 工程、活动身份、授权及满足三项精确授权与另一活动无授权主体条件的候选数量，不输出标识、不自动选择或创建业务行。固定 .local/docker/b4-lock-fixture.json 必须是维护者实际审阅的现有隔离测试工程，只含 tenantId、projectId、subjectId、otherSubjectId 四个标识，两个不同活动主体，第一主体恰有 project:read/version:read/version:append，另一主体对该工程无授权；Git 忽略、无链接、无凭据、不提交。若不存在或无法确认，不运行探针，另行批准隔离测试数据准备，不将聚合计数当作对象审阅。

实际审阅并单独批准短时锁探针后执行既有入口：

```powershell
node apps/server/prisma8-fresh-install.mjs --role-b4-lock-probe --confirm-reviewed-existing-fixture --isolation-fingerprint=0d0ead9db7e280d0d6e66464f36d392212206d71f3bdf5f57f05dbea55b45e37 --scada-catalog-fingerprint=2d6b202e637bc16685557603b2aab496546bc1db6ac16b6c15530340abfcb360 --keycloak-plan-fingerprint=60ae2f485107105ee98172cd69fc79cface21a40878b3f1f5e50bccc8011bbeb --projection-fingerprint=877ba8254960856e364edd816281f74ab24c4f6fa3a815d9a52fea4fe8192ab9
```

预期 B4_IDENTITY_GRANT_LOCK_CONCURRENCY_VERIFIED、sharedLockConflictCount=2、lockReleaseVerified=true、authorizedGrantRowsMatched=true、otherSubjectGrantRowsEmpty=true、identityGrantLockConcurrencyVerified=true、rowLockConcurrencyVerified=false、rowAuthorizationVerified=false、businessDataWritten=false、databaseWritten=false、admissionPassed=false、serviceSwitched=false。实际两个独立会话先验证无冲突排他锁，再验证运行角色共享锁及管理连接两次精确 SQLSTATE 55P03，回滚共享锁后重新取得排他锁；全部事务回滚及连接关闭、内部双库证据一致。成功或失败后均外部只读复验 dual-installed、DC/KP、严格契约及固定维护窗口，不自动重试。仅此两项行锁冲突不构成全部行锁/应用层行级授权或 RLS 证明。仍需真实原生仓储主体绑定、跨租户、禁用撤权并发、会话/OIDC 单次消费、CAS/失败原子回滚、不可变历史、发布门禁和 Keycloak Schema 实际启动兼容性；不得开启 LOGIN、恢复旧管理身份 Keycloak、服务切换、业务准入或合并。本提交只更新文档，B4.5 尚未实机执行。

## 二十二、B4.5 前置实测通过，专用空库合成夹具生命周期设计（2026-11-28）

维护者在 7a0c1454b0aa6a30fc8893aebfa32e43cf505fc7 实测文档 100 份、Git 差异、dual-installed 前后两次独立复验及 I/SC/K/KC/DC/KP、固定维护窗口、严格契约和现有并发锁模拟专项 3/3 均通过。REPEATABLE READ READ ONLY 固定 SCADA 库身份核验为 1，工程/身份/活动身份/授权/合格授权组均为 0，ROLLBACK 成功；固定本机夹具文件不存在。按第二十一节门禁停止，未创建或清理任何业务行、未执行真实双连接锁探针。前置通过，B4.5a 尚未完成；不是权限故障，也不重复任何 apply。

### 专用夹具候选约束（尚未实现）

真实两个独立连接无法读取另一未提交事务内的新行，因此需要单独批准临时合成业务行的提交及后续精确清理；不能把已有回滚探针的合成快照直接持久化。候选须复用现有固定 Docker、严格契约、双库状态读取器和维护窗口校验；读取全部原生业务表的空基线，不能仅凭本次三个业务表的计数推断其他表为空。以随机专用租户标识隔离两个不同活动主体与一个测试工程，不绑定真实 OIDC 身份、不创建会话，不读取或选择已有业务工程。使用共享 Core 的真实快照创建及读取校验，复用已安装的 scada_create_project 例程（仅在管理连接事务内 SET LOCAL ROLE 切换为现有 NOLOGIN 运行角色），不新增生产 ACL 或绕过正式发布安全门禁。需要先验证全部有关表的外键、CHECK 及精确列契约，事务内固定参数化语句、锁超时、语句超时及无其他业务/权限维护；加锁后重新核对空基线，不能用旧报告代替。创建前先保存仅本机的随机标识和独立清理证据，任何文件不覆盖已有夹具、不含凭据且不得提交 Git。

| 业务表 | 唯一允许的夹具增量 |
| --- | ---: |
| scada_identities | 2（active） |
| scada_projects | 1 |
| scada_project_versions | 1（首版及真实摘要） |
| scada_project_grants | 3（授权主体恰有 project:read、version:read、version:append） |
| scada_project_audit | 1（version:append） |
| scada_project_release_state | 1（未发布，generation=0） |
| 其余业务表 | 0 |

创建与清理须各有独立明确审批、事务内精确回读、独立连接复核、真实提交/回滚标签及关闭证据；维护窗口内先验证原双库指纹。创建完成后独立核对六张表共 9 行及其余表零增量，实际审阅本机四字段 JSON（tenantId、projectId、subjectId、otherSubjectId）与清理清单，才可单独批准既有锁探针，禁止把准备成功当作锁测试成功。探针后不自动清理；保留证据，校验夹具未变化、无任何外部或额外依赖，独立批准后按引用依赖顺序仅删除本次精确行（发布状态、审计、授权、版本、工程、身份；若存在发布事件、会话、外部身份、历史或其他非预期依赖则停止），核对每条语句的预期影响行数，禁止 TRUNCATE、CASCADE、通用租户删除或删除现有业务记录。事务内再次确认所有业务表回到原空基线，提交后独立复验空基线、DC/KP、严格契约、原容器与连接关闭；最后只在清理成功后按本机审阅流程处置夹具文件。

新增工具必须覆盖错误指纹、非空库、非法或重复主体、文件已存在或被链接/替换、额外授权/依赖、真实快照校验失败、影响行数异常、锁冲突、事务失败、未知 COMMIT、回滚及资源关闭失败等离线正反用例，并纳入适用的 Node Docker 测试门禁；另做真实 Windows 验收。未知提交结果或独立核验失败不得自动重试或逆向删除，先保留标识和现场证据，再独立只读确认。备份恢复可用性仍未获实测证据；在真实写入前须另行核对。整个生命周期的创建/清理确实有临时业务写入，不能报告为始终 databaseWritten=false；仅既有锁探针本身无 DML/COMMIT。当前仅为设计与验收记录，无可执行创建或删除入口，不批准任何真实 DML。B4.5a、B4.5b、Keycloak Schema 实际兼容性及 C/D/E/F 仍未完成，NOLOGIN、原 Keycloak 维护停机、正式发布门禁及 Draft 不变。

### 专用夹具生命周期实现候选（2026-11-28）

前述“尚未实现”作为历史设计记录保留；本批新增脚本及 CLI 候选，不代表已实际创建或清理。根命令 docker:db:role:b4:fixture:preflight/create/cleanup 均固定要求 I、SC、K、KC、DC、KP，依次传入 --isolation-fingerprint、--scada-catalog-fingerprint、--keycloak-plan-fingerprint、--projection-fingerprint、--dual-catalog-fingerprint、--schema-policy-fingerprint。预检独立确认 --confirm-readonly-fixture-preflight，使用只读事务检查全部 12 张表、集群身份、维护状态、短时独占核验锁、无其他本库会话及本机两个证据文件不存在，实际生成并校验内存中的空白首版 Core 快照后 ROLLBACK；不保留候选标识，不写业务行或文件。预期 B4_LOCK_FIXTURE_PREFLIGHT_VERIFIED、businessTableCount=12、businessRowCount=0、coreSnapshotVerified=true、businessTablesEmpty=true、fixturePrepared=false、databaseWritten=false、dualCatalogMatched=true、independentConnectionsClosed=true、runtimeLoginAllowed=false、admissionPassed=false。先完成 Windows 定向测试、Vite+、文档/中文及本入口实测，不执行创建或清理。

创建命令的独立确认参数依次为 --confirm-create-isolated-fixture、--confirm-exclusive-maintenance、--confirm-backup-restore-reviewed；清理将第一项换为 --confirm-cleanup-isolated-fixture，并在六项指纹后附加 --manifest-fingerprint=<创建报告的实际 SHA-256>。这两个命令只在维护者审阅备份恢复、真实独占维护环境并分别批准后运行，不将本次开发批准当成实际 DML 授权。独占维护必须包括其他管理员、客户端和本机证据目录写入者；事务锁与前后检查不构成跨库原子快照或对恶意本机管理员的隔离证明。创建使用 READ COMMITTED READ WRITE，先取固定独占事务核验锁、十二表 SHARE ROW EXCLUSIVE NOWAIT 锁、空基线和会话验证，在首次 DML 前独占创建并同步本机 b4-lock-fixture-manifest.json（绑定集群、六指纹、随机标识、真实 Core 首版快照、审计标识和微秒事务时间），不覆盖任何证据文件。管理会话创建两条合成活动身份，SET LOCAL ROLE 调用现有受限 scada_create_project 例程，RESET ROLE 后逐表核对全库九行及全部字段预期；确认 COMMIT 标签、连接关闭、独立只读九行及双库目录复验后才发布既有并发探针需要的四字段 b4-lock-fixture.json。预计 B4_LOCK_FIXTURE_CREATED_VERIFIED、businessRowCount=9、manifestFingerprint=<实际值>、fixturePrepared=true、businessDataWritten=true、databaseWritten=true；仅表示合成夹具，不是实际并发或行级授权证明。

清理在原锁探针完成且夹具未变时独立批准；核对清单 SHA-256、真实 Core 快照、四字段证据、全部十二表精确行数与联合字段、锁和连接身份，在同一锁内按发布状态、审计、授权、版本、工程、身份顺序删除 1/1/3/1/1/2 行，拒绝任何额外会话、授权、发布、历史或其他业务记录；确认空基线后才提交并独立复验。预计 B4_LOCK_FIXTURE_CLEANUP_VERIFIED、businessRowCount=0、fixturePrepared=false、fixtureFilesRetained=true、businessDataWritten=true、databaseWritten=true。两个本机证据文件在清理后保留供维护者审阅，不自动删除；未知提交、失败回滚、连接关闭、证据发布或后置复验失败时保留现场，尤其只有清单没有四字段文件时禁止通过创建重试或手工拼凑后盲目清理。当前清理契约仅覆盖原九行不变夹具；B4.5b 如果需要修改版本、身份或授权，必须在 B4.5a 夹具清理后另行设计可回收隔离用例，不得绕过此精确清理门禁。

真实 PostgreSQL 19.0、实际 Core/CLI、备份恢复、原容器与 Windows Vite+ 尚待实测；禁止开启 LOGIN、启动 Keycloak、执行权限 apply、恢复旧管理身份、切换服务或合并 Draft。
