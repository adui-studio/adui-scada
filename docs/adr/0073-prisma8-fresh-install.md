# ADR-0073：Prisma 8 原生全新安装

> 2026-11-27 原生收敛： 正式根模块切换验收完成（PR #249）；后续清理不变更已初始化的 PSL、SQL 中文注释、存储指纹或数据库实例。正式生成只使用 Prisma 8 RC35 与 ORM RC25；旧 Prisma 7 客户端、迁移和隔离候选不再是任何质量门禁。仍须验证 Windows 锁文件、全量测试以及原生只读烟测，真实业务写入和生产安全准入另行验收。

- 状态：Accepted
- 日期：2026-11-27
- 关联需求：FR-001、FR-008、FR-013、FR-014、NFR-004、NFR-006
- 取代：[ADR-0072](0072-prisma8-migration-adoption-review.md)

## 决策及事实

维护者明确终止旧数据库接管与迁移实验，删除本项目旧容器、命名卷和网络并从零安装；不清理其他项目。维护者实际完成八个容器、六个命名卷、三个网络的删除，随后以现有 Compose 创建 PostgreSQL、Redis、Keycloak 基础设施。实际版本为 PostgreSQL 19.0、Redis 8.12.0、Keycloak 26.8.2；业务库 adui_scada 的 public 表数为零，Keycloak 使用独立逻辑库。第三方服务镜像使用 latest，Node 镜像和 pnpm、Prisma 固定版本不变。本机端口仍为 15432、16379、18443。

## 方案

- 独立原生 PSL 源与初始化中文注释纳入 Git，保留已评审模型、约束和注释，不回放 Prisma 7 迁移，不读取旧数据库或旧本地实验产物。原生源保留十二张表、八十五个物理字段、十二个主键、十三个外键、二十个非主键索引、三十六个 CHECK 和一百一十九条中文注释。此前验收的原生源指纹经重建复算一致，本次只修改源文件头部说明。
- 新配置只生成根目录 .artifacts/prisma8-fresh 的契约与声明，连接凭据使用现有本机 Docker 凭据加载器；不接收任意目标 URL、远程 Docker 或 Keycloak 业务库。固定 Prisma CLI 8.0.0-rc.35 与 PostgreSQL ORM 8.0.0-rc.25。
- 首次安装先执行官方 contract emit、容器身份和二十三类空库只读核验、官方 db update --dry-run --json；规划仅接受当前契约新增对象，不接受数据丢失、访问权限放宽或非新增操作。单独明确授权后再次核验空库和集群，执行官方 db update，独立事务写入并核验中文注释，再执行官方 db verify --strict。禁止自动清库、删除卷、失败重试和回退旧迁移。官方执行和注释不是同一事务，若后者失败应保留现场。
- 过渡期 docker:up 仅启动基础设施，不再自动执行 Prisma 7 历史迁移或启动尚未切换的业务应用。docker:db:init 必须带明确首次初始化确认，docker:db:status 使用新验证入口。
- 历史 Git 文件和旧实验测试暂保留作为历史资料；旧接管方案不再是新安装前置条件。后续需完成正式 NestJS Provider、业务事务和双框架运行链切换，以及独立部署策略评审。

## 验收与限制

本批仅在协作环境运行离线逻辑子集并核验源码指纹。固定 RC 的实际契约发射、PostgreSQL 19 规划、正式初始化、严格验证及 Windows 完整质量链尚待验证。官方规划结果格式不匹配时停止，不绕过门禁；仅返回白名单格式诊断码，不回显原始凭据或第三方异常正文。真实首次初始化须在预览通过、PR 合并且维护者单独明确授权后执行。当前不声明正式 Provider 已切换或生产部署已获许可。

## 2026-11-27 · 初始化验收与后续切换边界

维护者在 Windows 已验收 PR #241 四组专项 54/54、Vite+ 592 格式/430 受检零警告错误、中文 457、Markdown 97、增量退出码 0；格式化提交 09385336fa9a7880965c89597b85dea7b1742a99 正常 Hook 通过并推送，实际原生发射及 PostgreSQL 19 空库只读预览退出 0（23 类、45 项新增）。明确授权后 Squash 合入 4a06766da5d9ec99bed96104dc26c17d21112d43。合并后再次空库预览成功；维护者另行授权并在检查分支、提交和干净工作区后真实首次初始化，返回 FRESH_DATABASE_INITIALIZED；独立 docker:db:status 返回 FRESH_DATABASE_VERIFIED，退出码 0、工作区干净。两次报告均为 serverVersion=190000、databaseInitialized=true、存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436、12 表、85 字段、36 CHECK、20 非主键索引、13 外键、119 注释。此后禁止重复首次初始化或运行旧迁移。

下一批先核对现有 Prisma 8 候选与真实原生生成物的类型兼容性，再切换正式注入。新增固定只读运行时评审入口：重新官方发射并核对存储、声明和中文注释，复用已评审的关系差异（末次发布事件六字段关联、无反向导航），保持历史标识门禁；用已安装 TypeScript 分别对旧生成物及内存替换的全新 JSON/声明进行完整服务端类型检查，不改写旧 Git 生成物。通过后复用现有本机 Docker 身份、严格 db verify 与注释核验，Prisma 8 使用全新原生契约及同一调用方 pg.Client；在查询前后核对真实集群、业务库角色、public Schema 与事务默认只读设置，只查询随机不存在的租户/工程联合键，要求 null，按顺序关闭客户端与连接，失败脱敏且不返回成功。无 DML、DDL、签名、迁移或业务值输出，不注册正式 NestJS Provider，不扩大既有隔离写入候选范围。只有评审通过才进入正式 Provider 与仓储装配阶段；真实应用启动、写入、事务、双框架及生产部署仍须分别验收。

## 2026-11-27 · 原生运行时评审与 Provider 切换实施

PR #242 维护者 Windows 实测 Core 构建与旧客户端离线生成成功，专项 24/24（17+7），Vite+ 594 格式/432 受检文件零警告错误，中文 459 文件、Markdown 97、增量退出 0；两份源码格式化正常提交 Hook 通过并推送 HEAD f1324c126bf7e7954cce30c207776f14d1d2412b，远端差异仅排版。实际 FRESH_RUNTIME_REVIEW_READY，PostgreSQL 190000、存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436、12 表、85 字段、36 CHECK、20 非主键索引、13 外键、119 注释；databaseInitialized、nativeRuntimeTypesVerified、missingScopeVerified、readOnlyBoundaryVerified 均 true，providerSwitched=false，退出码 0、工作区干净。已按维护者明确授权 Squash 合入 87c8382b41418bee1e65d354705ec12ccdeb2d69，未取得额外远端 CI 记录。

实现独立 Prisma8Service 与 Prisma8DatabaseModule，原生 PSL 离线发射到 src/generated/prisma8-runtime，固定版本、存储指纹、声明和注释门禁沿用全新安装入口；旧 Prisma 7 客户端及旧 Prisma 8 候选生成物暂保留，禁止互相覆盖。原生生成纳入服务端 db:generate 及构建/启动依赖，Git、Docker 上下文及共享 Format/Lint、中文扫描仅排除新增的精确生成路径。Provider 由 Nest 管理一个进程内连接池，初始仅支持本机 adui_scada:15432 固定开发边界，拒绝生产环境默认配置、远程/Keycloak/历史库、额外连接参数；启动查询核验实际数据库、角色、Schema、PostgreSQL 19、只读设置、集群标识及 app 原生标记 core_hash，不能把官方运行时的 marker 告警当作硬门禁。随后以实际原生 ORM 查询随机不存在工程联合键，再复核连接；启动失败或关闭期间拒绝暴露客户端，按顺序释放运行时和调用方连接池，保留脱敏失败阶段。单独只读烟测复用既有严格结构、注释和本机 Docker 集群身份核验，使用编译后的 Nest TestingModule 实际装配 Provider，配置只读且传入真实集群标识，确认启动、同一提供方客户端、关闭后拒绝访问。当前不导入正式身份或工程 HTTP 模块、不改变旧业务仓储隔离门禁；providerSwitched=false。正式生产角色及容器内连接策略、业务写事务、实际 Docker 构建和完整应用切换另行验收。

协作容器 Node.js 22.16.0 实际运行新增边界与生命周期测试 8/8，TypeScript 5.8.3 对纯边界源码执行 strict noEmit 检查通过；对应源码 Blob 14712538534a11746fa32507f4579581ab292f7a、测试 Blob 82a5aa7df6d2b92fb9f41474f42a4e53160bba1f。测试覆盖 URL、角色和标记等边界漂移、启动前不可用、单次释放、启动失败、启动期间关闭、关闭失败及双重失败脱敏。该环境没有实际固定 Prisma RC、完整 NestJS 依赖、pnpm/vp 或维护者 PostgreSQL，未执行实际原生发射、新 Provider 编译/真实烟测、完整 Windows 质量链与 Docker 构建；不得把模拟测试描述为正式业务运行。

## 2026-11-27 · Provider 验收及身份 ACL 查询装配

PR #243 维护者 Windows 实测 Core 构建、Prisma 7 客户端及 Prisma 8 原生运行时契约离线生成成功（FRESH_RUNTIME_CONTRACT_EMITTED、databaseAccessed=false）；三组专项 34/34（25+7+2），Vite+ 600 格式文件/438 受检文件零警告错误，中文 465 文件、Markdown 97、NestJS 构建及增量退出码 0。三文件正常格式提交 34dc2a20f39770f33085a8babefb094d54a85931 已推送，远端核对仅排版。真实 FRESH_PROVIDER_SMOKE_READY，PostgreSQL 190000、providerReady/providerClosed/readOnlyBoundaryVerified/databaseInitialized=true、providerSwitched=false，原存储指纹及 12 表、85 字段、36 CHECK、20 非主键索引、13 外键、119 注释一致，退出码 0，工作区干净。按维护者明确授权 Squash 合入 b9248081590337c50f4151eb5cc2b5c09b1f9fce；未取得额外远端 CI 记录。

将正式 OIDC 回调的已验签外部身份预绑定查询与工程 Guard 的前置 ACL 查询从具体 Prisma 客户端抽离为 AuthorizationReadStore，保留旧模块显式 Prisma 7 过渡绑定及已有联合键、权限投影、会话签发、HTTP 与锁内授权语义。新增 Prisma8AuthorizationModule，仅导入已验收 Prisma8DatabaseModule，使用新原生生成 Contract 实现相同端口，不复制连接池，不使用旧隔离候选或将隔离库写入门禁改为业务库。身份只查询既有活跃映射，不自动注册；完整权限集合仍由 hasProjectPermission 按可信租户、主体、工程及操作判定，非法标识查询前拒绝，固定主体副本，数据库异常固定 503，不记录授权成功。原生仓储使用 Prisma8Service.readTransaction 及新 readPrisma8Transaction，在同一 ReadCommitted 事务前后核验实际数据库、角色、Schema、PG19、集群标识、原生 marker core_hash、配置与实际只读状态及非恢复模式；只有查询及边界复核均成功才返回结果。读仓储只包含 SELECT/ORM 查询；真实烟测强制 PostgreSQL 默认及事务只读，正常可写配置只核验模式一致，不宣称所有未来业务事务都强制只读。扩展原有真实 Provider 烟测：实际 Nest 装配原生端口及正式 ScadaProjectGuard，以随机不存在的身份及租户/工程联合键核验空映射、空授权、固定 404 与 permission_denied 审计，不打印凭据或业务行，不写业务数据、不挂载 HTTP 根模块。当前正式 HTTP 根模块仍明确使用旧过渡绑定，providerSwitched=false；会话及 OIDC 事务、工程版本和发布写事务统一切换后再启动原生正式应用，禁止混合两代数据库运行。

## 2026-11-27 · 原生身份事务接入候选

PR #244 Windows 修复后 Core 构建、双契约离线生成、Vite+ 607 格式文件/445 受检文件零警告错误、中文 472、Markdown 97、NestJS 构建、git diff --check 均通过，增量退出 0；此前修复前专项与 HTTP E2E 137/137。正常 Hook 格式化提交 c0990870e13e8cf143af144344c3f96d49b563ae 已推送，五文件远端差异仅排版。真实 FRESH_PROVIDER_SMOKE_READY，PostgreSQL 190000、databaseInitialized/providerReady/providerClosed/readOnlyBoundaryVerified/authorizationReadVerified/missingProjectDenied=true、providerSwitched=false，存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436、12 表、85 字段、36 CHECK、20 非主键索引、13 外键、119 注释，退出 0、工作区干净。维护者明确授权 Squash 合入 02087974c7cba37857cae1984c0a5fc2a09fb16d；无额外远端 CI 记录。E-157 的 Windows 类型修复已复验，历史隔离库写入测试未执行。

新增共享 Prisma8AuthTransactionPort、Prisma8SessionOperations 与 Prisma8OidcLoginOperations；共享层仅使用参数化 raw/query/execute，历史候选保持原构造签名、隔离库名、只读模式、隔离级别、专用随机测试 Issuer 及旧清理定时器门禁，独立原生实现通过 Prisma8Service.readTransaction/writeTransaction 接入新生成 Contract。原生写事务明确拒绝只读配置，在同一 ReadCommitted 事务业务执行前后复核真实业务库、角色、Schema、PG19、集群标识（配置时严格比对）、原生 marker core_hash、可写模式及非恢复状态，后置校验抛错依 SDK 事务约定回滚。保留会话十秒/OIDC 五秒事务超时、主体共享锁与独立摘要、租户主体会话精确撤销、State/浏览器绑定摘要、PKCE S256、AES-GCM、Nonce、一次性 FOR UPDATE 加条件更新和按 Issuer 的 128 条有界清理。原生身份模块仅绑定现有会话及 OIDC 服务令牌、共享授权模块与原生数据库，不挂 HTTP 路由，不导入旧数据库模块；旧正式根模块不变。只读烟测覆盖随机不存在会话、Bearer/Cookie 拒绝、会话签发撤销与 OIDC 创建消费清理的拒绝，使用内存合成 OIDC 配置和禁止网络访问的发现替身；原生模块暂不启动清理定时器，正式根模块切换后另行验收。

协作容器无固定 Prisma SDK、NestJS 依赖、pnpm/vp 和维护者数据库，不能执行完整工程类型检查或真实烟测；TypeScript 5.8.3 --noCheck 转译与远端 Blob d9dfed983c91273f13cc6da2698ef8ed29e50327 一致的事务包装器及 Blob 14712538534a11746fa32507f4579581ab292f7a 一致的原有身份边界，Node.js 22.16.0 实际模拟回归 6/6（正常提交顺序、只读早拒绝、错误/缺失身份、后置漂移模拟回滚、业务异常、原只读查询）；不代表实际 PostgreSQL 提交回滚或 SDK 类型已验证。静态逐字比较原候选移入共享层的八条业务 SQL 完全一致，新增 9 项身份 Vitest 和 1 项模块装配断言待 Windows 实测；历史 4 项会话及 5 项 OIDC 单元测试亦须回归。未执行数据库写入、重复初始化、历史迁移或真实 IdP 调用。

## 2026-11-27 · 维护者再次确认仅推进全新原生应用

停止增加旧数据库迁移、兼容适配和对照验收；只以当前已初始化的 PostgreSQL 19 业务库及原生 Contract 开发，不再为旧隔离库增加功能。保留新系统自身的工程版本与审计，避免把版本管理误当作旧数据迁移。原生工程读写统一装配；完成原生发布事务与其他正式依赖后集中切换 HTTP 根模块并清理废弃入口。不得重新初始化已有新库或提前混合两代提供方。

## 2026-11-27 · 全新原生发布仓储

维护者 Windows E-159 复验 HEAD 8d18844f189afb726a27e95f66b84ffeda41e7b2：原生工程写入 11/11、619 格式文件、457 受检文件零警告/Lint/类型错误、中文文案 484、Markdown 97、git diff --check 均通过，退出码 0、工作区干净。此前 58/58 增量及 PostgreSQL 19 真实 FRESH_PROVIDER_SMOKE_READY（projectWriteDenied=true、providerSwitched=false、指纹和结构数量一致）通过，修复只修改测试及文档，未改变业务或烟测代码。维护者明确授权，PR #247 已 Squash 合入 feat/mvp-first-integration 的 6ef45e964c2b2bb87b4a01eed1e66cd3321fda9d。E-159 已关闭。

新增 Prisma8RuntimeProjectReleaseStore，统一由 Prisma8ProjectPersistenceModule 与工程读写仓储共用 Prisma8Service，直接采用原生 Contract 的 readTransaction/writeTransaction；严格只读时三个需行锁入口均提前拒绝。当前发布读取不读取编辑 head；发布按现有双 CAS 与幂等契约；内部回滚独立 release:rollback ACL、正发布代次、仅限同租户工程较早 PUBLISH 事件证明的目标快照，不依赖或更改编辑 head。锁内复核会话、活动主体、完整 ACL、指针、目标摘要和安全门禁；幂等按租户/工程/主体/动作/UUID v4 作用域，复核语义摘要、目标和原代次。同一目标的新请求拒绝；原同键同语义重放复用原事件。事件及指针 CAS 使用统一原生写事务并回读一致性，固定安全门禁始终拒绝新发布/回滚且不提供可注入放行参数。 本批只面向当前原生业务库，旧库实验源码不再扩展，不增加旧数据库专项或迁移。真实正向写入及并发仍未验收，正式根模块暂不混合两代提供方。

## 2026-11-27 · 正式根模块切换至原生业务提供方

维护者 Windows 完成 PR #248 全新专项 28/28、原生运行时 7/7、发布/回滚 15/15、工程写入 11/11、工程查询 10/10、装配 9/9，共 80/80；Vite+ 621 文件格式正确、459 受检文件零警告/Lint/类型错误、中文 486、Markdown 97、NestJS 构建及 git diff --check 均通过，增量退出码 0。格式化提交 ef817ad58bb2eae05322d674c8b3353cc5494ad8 已推送，三文件差异为排版与尾逗号。真实 PostgreSQL 190000 FRESH_PROVIDER_SMOKE_READY，原存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436、12 表/85 字段/36 CHECK/20 索引/13 外键/119 注释一致，releaseLockedReadDenied/releaseWriteDenied/rollbackWriteDenied 及既有只读标志均 true，providerSwitched=false，退出码 0，工作区干净。维护者明确授权，PR #248 已 Squash 合入 feat/mvp-first-integration 的 a6b388334addb25b39e3a06a9f4b2da77339b09c。

正式 OidcEnabledAppModule 仍经 ProjectApiModule 导入 ScadaIdentityModule 与 ProjectPersistenceModule，二者直接复用已验收的 Prisma8IdentityModule、Prisma8AuthorizationModule、Prisma8ProjectPersistenceModule，共用唯一 Prisma8DatabaseModule/Prisma8Service。身份模块通过重新导出原生模块提供会话、授权及可信 OIDC 配置，保留现有 Controller、Guard、CSRF、审计和授权码兑换；工程控制器既有两个类令牌暂以 useExisting 指向同一原生版本/发布仓储实例，不实例化旧 Prisma 7 仓储，不增加旧库兼容适配。默认 AppModule 仍无数据库、身份或工程 API；OIDC 启用的正式应用代码已切换，保持本机非生产连接白名单，实际新根模块验收待完成。正式可写模式恢复当前 Issuer 每 30 秒、最多 128 条过期 OIDC 登录事务清理，启动幂等、关闭清理定时器并等待正在执行的任务；严格只读模式禁用调度。发布/回滚生产安全门禁不变，回滚仍无公开 HTTP 路由，不增加工业设备操作。

新增两项原生 OIDC 清理生命周期测试及两项正式根模块 HTTP E2E，现有九项模块装配断言更新为实际原生路径；HTTP 工程 Mock 改为直接授权读取端口，不再借用旧 Prisma 7 Mock ORM。真实 Provider 烟测编译实际 OidcEnabledAppModule，覆盖两个正式 Controller、唯一原生服务、旧 DatabaseModule/PrismaService 未注册、两个工程令牌与原生实例相同及原生授权/会话绑定。烟测仅对进程模块导入临时设置同步静默日志并恢复原环境值，强制真实业务库严格只读且禁止 IdP 网络发现，不监听 HTTP 端口，不启动过期清理。成功后由探针本身返回 nativeRootAssemblyVerified、singleNativeProviderVerified、legacyProviderAbsent、providerSwitched=true；独立 runtime-review 不验证根模块，不能代替本烟测。 本批仅在功能分支提交正式装配代码，真实正向写入、正式运行及生产准入未验收。禁止退回旧数据库连接，下一批清理遗留类令牌、旧依赖与实验入口。

## 2026-11-27 · 原生清理验收与 Docker 启动候选

维护者 Windows 已完成 PR #250 最终复验：中文注释 2/2、OIDC 身份 14/14、全新安装 28/28、CLI 4/4、82 个文件 966/966 单测、6 个文件 65/65 HTTP E2E；498 格式文件、339 受检零警告/Lint/类型错误，中文 365 个自有文件、文档 97 份，React/Vue/NestJS 构建通过。React 单个 chunk 591.62 kB 的构建体积警告暂保留。锁文件刷新与冻结安装已通过，移除 Prisma 7 三项直接依赖及 98 个包。真实 PostgreSQL 19 只读 FRESH_PROVIDER_SMOKE_READY，存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436、12 表/85 字段/36 CHECK/20 索引/13 外键/119 注释一致，所有原生根模块及只读标志为 true，最终退出码 0、工作区干净。远端验收提交 dbab7c2a7ca3737e23fd451811aef92981378801，维护者明确授权，PR #250 已 Squash 合并至 feat/mvp-first-integration 的 94106b29b328833d944f35361004411b5a3ddab2。E-160 已关闭。

恢复唯一 adui-scada Compose 七服务一键启动，新增 docker:infra 保留三服务基础设施入口。docker:up 先准备本机随机凭据与证书、验证 Compose 和固定本机 Linux Docker Desktop 命名管道，等待基础设施，再执行已有 Prisma 8 --status 官方严格结构/标记及真实中文注释只读验证；只在成功后构建并启动 server、demo、web-react、web-vue，等待应用服务运行。容器内显式探针经 server 的 lab 网络访问固定 postgres:5432/adui_scada，必须严格只读且与宿主验证的 PostgreSQL 集群 systemIdentifier 一致；复用正式原生根模块全部只读核验与关闭流程。凭据从现有 Git 忽略的随机秘密文件读取，仅经 docker exec -T 标准输入传给一次性探针，不进入服务环境、命令行或报告。两端 Web 探针验证容器网络内静态入口、/api/health、/demo/project、/demo/events 的响应状态及 SSE 内容类型、受保护工程路由保持 404。宿主默认连接白名单和正式数据库生产禁令保持不变。Docker HTTP Server 仍显式关闭 OIDC，不开放身份、工程或设备写入接口；Keycloak 本轮仅验证容器启动，不验证真实登录、JWKS、HTTPS 回调、Cookie 或双端浏览器渲染。不存在数据库自动初始化、迁移、清卷、失败回退、旧库接管或自动授权。 本次对 ADR-0066 的启动顺序作原生化补充，已有单项目/双逻辑库/不删除卷约束不变。生产连接及真实登录必须另行评审，禁止把严格只读容器探针作为生产写入许可。
