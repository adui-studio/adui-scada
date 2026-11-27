# ADui SCADA · 文档校验机制

> 2026-11-27 最新决策：维护者已删除旧开发数据库环境，停止历史迁移接管及专用实例实验。后续以 [ADR-0073](adr/0073-prisma8-fresh-install.md) 为准；下文旧实验记录仅供追溯，不是当前验收前置条件。

## 执行

```powershell
pnpm run docs:check
# 或
node scripts/validate-docs.mjs
```

脚本仅使用 Node.js 内置模块，无额外依赖。

## 自动检查范围

1. 核心文档、ADR 和脚本是否存在。
2. Markdown 相对链接路径是否存在。
3. 需求表中 FR-NNN / NFR-NNN 编号是否重复。
4. ADR 文件编号、状态是否有效。
5. `skills-lock.json` 的技能是否有对应 `.agents/skills/<name>/SKILL.md`。

错误显示文件及原因，退出码非零。外部 URL、Markdown 锚点语义、实际图片/图表渲染不在此脚本范围。

## 必须进行的人工或运行验证

需求与 SDD 是否语义一致、Mermaid 是否正常渲染、代码与命令能否执行、Skills 的许可及安全性、工业协议兼容、控制写入边界、性能与现场认证，均不能由文件存在性检查证明。

文档、需求编号、Skills 或 ADR 结构变化时同步更新脚本与本说明；CI 只有在实际测试和维护条件具备后再配置。

## 编辑器浏览器几何和交互检查

`pnpm run test:browser` 是独立的本地浏览器冒烟检查，不属于 `pnpm run ready` 默认链路。需要启动 React/Vue 开发服务器并安装 Chrome/Edge；测试使用隔离浏览器数据，不访问生产设备。详见 [Harness](HARNESS.md) 的 V0.2 浏览器交互回归小节。

## V0.3 第三批：本地版本仓储检查范围

除既有 `pnpm run ready` 质量链外，新增 `packages/draft-storage/test/indexeddb-version.test.ts` 验证实际 fake-indexeddb 事务并发、历史不覆盖、数据库重新打开、工程隔离、列表分页、数据库损坏与哈希校验。测试使用工作区现有 `dexie@4.4.7` 和 `fake-indexeddb@6.2.8`，不新增依赖。正式端到端服务器存储、运行时发布指针、RBAC 及 Tauri 仍不在本批验证范围。

## V0.3 第四批：本地历史版本 UI 验收

`pnpm run test:versions` 独立于 `ready`，沿用无新依赖的 Chrome/Edge DevTools Protocol；要求 React/Vue 开发服务器同时运行。测试会使用临时隔离浏览器数据目录创建真实 IndexedDB 历史，检查历史版本恢复的确认与取消分支、JSON 无损恢复及两次版本创建后的倒序列表。另用共享 Core 的 `project-version-compare.test.ts` 覆盖 4 种内容比较边界。手动核对当前浏览器自动保存的停写和版本历史持久性；正式发布/回滚未纳入此批。

## V0.3 第五批：浏览器恢复与异常回归

新增 `test:versions:safety` 基于真实浏览器、实际 IndexedDB 草稿，验证恢复过程中自动保存不会覆盖历史、历史恢复不会覆盖草稿、刷新后版本仍存、不同 Origin 隔离和存储异常可观察且可恢复。测试以隔离浏览器目录启动，不访问真实用户数据；模拟 `IDBFactory.open` 权限失败并在 `finally` 还原。另新增 Core 自动保存会话停写等待与失败回收测试，运行 `ready` 后需单独启动 React/Vue dev 服务执行浏览器验收。自动化覆盖不等于跨设备/正式服务端版本管理验证。

## V0.3 第六批：并发与重试边界

Core 新增两项自动保存会话回归：停写必须等待正在执行的事务并取消尚未开始的排队写入；暂时写入失败可通过新的同会话调用重试，修订号不提前推进。Dexie 新增两项 `fake-indexeddb` 事务回归：已有修订号的两个实例竞争时仅一个成功；保存与清除并发时不能双成功，清除重建也不复用旧修订号。

以上是**模拟仓储实例和事务的自动化回归**，不等于真实双标签页浏览器测试。仍需在工作区实际运行 `pnpm run ready`，不能预先宣称通过；不替代真实配额异常、Tauri WebView2 或跨设备验证。

## V0.3 第七批：真实双标签页浏览器验收

`pnpm run test:multitab` 需要两套 Web 开发服务器和 Chrome/Edge，同时在同一个临时 profile 内打开两个真实同源标签页；测试用 DOM 操作与 IndexedDB 只读回查区分“当前画面”和“真正提交的草稿”。覆盖 BroadcastChannel 通知、无广播时 CAS 拒绝覆盖、清除重建的修订号水位、模拟 IndexedDB 草稿对象仓库 `put()` 写入失败及恢复。React 与 Vue 分别执行，不在两个不同 Origin 间共享数据库。失败必须返回非零退出码。**测试代码与静态语法验证不能替代 Windows 真实浏览器实测**；不包含真实浏览器配额耗尽、Tauri/工业现场安全认证。

## V0.3 第八批：服务端工程请求边界

`packages/core/test/server-project-contract.test.ts` 验证普通对象与字段白名单、首次/更新预期修订号、工程 ID 路由一致性、严格当前 Schema、独立工程副本、UTF-8 2 MiB 上限和客户端伪造身份字段拒绝。该校验不能证明服务端已经实现身份认证、项目授权、数据库 CAS、审计或发布；现有 NestJS 不开放相关工程 API。新增 2 项 NestJS E2E 验证当前工程版本 GET/POST 路由仍返回 404，防止在认证和数据库尚未落地时意外开放接口。需执行 `pnpm run ready` 并检查实际结果。

## V0.3 第九批：服务端权限与 PostgreSQL 方案边界

`apps/server/src/projects/project-access-policy.spec.ts` 随根 `pnpm run test:unit` 执行，检查可信主体、工程范围、显式权限、默认拒绝与跨租户/工程/主体负例。原有 4 项 NestJS E2E 仍应确保未开放的工程版本读写和设备写入接口返回 404。ADR-0041 的候选 PostgreSQL DDL、事务 CAS 与成功审计规则目前仅做设计审查，**没有实际数据库、迁移、事务冲突测试或真实身份认证**；`pnpm run ready` 不能证明这些生产能力已实现。

## V0.3 第十批：Prisma PostgreSQL 配置与真实迁移

采用 Prisma ORM 7.10.1 稳定版和独立 PostgreSQL。完成 `pnpm install` 后，`pnpm run db:validate` 检查 Prisma 模型；`pnpm run db:generate` 生成服务端专用客户端。数据库迁移只能在明确核对 `SCADA_DATABASE_URL` 指向隔离本地实例之后执行 `db:migrate:deploy`，再检查 `db:migrate:status`。首次 SQL 迁移含 Prisma Schema 未声明的 PostgreSQL CHECK 约束，应核对实际库中的约束和 Schema 漂移，不能直接把文件存在解释为真实迁移通过。现有 323 项单测和 4 项 E2E 只是第九批验收基线，本批需重新执行；真实并发 CAS 和审计一致性待后续实现。

## V0.3 第十批：Prisma 生成目录排除规则回归

`pnpm run db:generate` 会在 `apps/server/src/generated/prisma/` 生成第三方自动维护的 TypeScript 和英文注释。中文检查、Format 和 Lint 必须只排除该**精确生成目录**，不能全局跳过 `generated` 目录或任何项目自有注释、异常与日志。`.env.example` 中注释形式的 `# SCADA_DB_PORT=5432` 属于环境变量示例，不应误判为英文文案。Windows 与 POSIX 路径分隔符均需支持；完整验证仍以维护者 Windows 的 `pnpm run ready` 为准。

## V0.3 第十批：开发 PostgreSQL Compose 与 Prisma URL 一致性

本地 PostgreSQL Compose 使用子目录 `deploy/docker/compose.postgres.dev.yaml`。根命令 `db:dev:up/down` 必须显式传入 `--env-file .env`，避免 Compose 基于首个 `-f` 文件目录选择错误的环境文件。环境配置脚本要求 `.env.example` 默认端口与配置契约匹配；当本地 `.env` 提供 `SCADA_DATABASE_URL` 时，须验证 PostgreSQL 协议、DB 主机、端口、库名、账号及密码和单独配置字段一致，**错误输出不能泄漏 URL 或密码**。当前本地 PostgreSQL 映射端口为 15432，`SCADA_DATABASE_URL` 必须指向该端口。仓库静态校验不代表 Docker 实际启动和 Prisma 数据库迁移完成。

## V0.3 第十一批：Prisma 事务仓储两级测试

普通 `pnpm run ready` 新增 14 项模拟数据库事务单测，验证无身份/无授权、请求白名单、过期 CAS、事务调用顺序、审计异常传播、安全整数上界及已授权版本读取时的 SHA-256/元数据复核。**模拟对象不能证明 PostgreSQL 真正加锁或回滚。**

另外提供 `pnpm run test:db` 的 5 项 PostgreSQL 集成测试，严格要求显式 `SCADA_TEST_DATABASE_URL`，URL 主机必须为本地回环、数据库名必须为 `adui_scada_test`；不自动创建/迁移数据库。真实测试包括持久化版本/审计、同一预期修订号并发双写仅一项成功、跨租户隔离、完整读取、摘要篡改拒读。权限撤销与保存竞态、数据库异常回滚、断网、RLS 与性能压力测试仍待后续专项实现/验证。

## 第十一批补充：Prisma 与 PostgreSQL 中文注释验收

- `apps/server/src/database/prisma-schema-comments.spec.ts` 自动遍历全部 Prisma `model`、属性及关联关系，检查每个模型和属性的中文 `///` 文档注释；同时从版本化 Prisma 迁移中核对每个业务表和物理字段的中文 `COMMENT ON`。未来新增字段或模型遗漏注释时，应使普通 `pnpm run ready` 检查失败。
- 真实数据库测试查询 PostgreSQL `obj_description` / `col_description`，验证四张业务表和全部字段的中文注释已经被迁移写入。测试必须在 `adui_scada_test` 隔离库中运行，迁移应用前不应误判通过。
- 检查 `vp check` 已消除 7 处缺少 Mock 泛型的警告；`pnpm run ready` 和新增迁移仍须维护者 Windows 实际执行，不能以模拟检查替代。
- 不修改已生效的 `20261112000000_init_scada_projects`，新增 `20261112170000_add_chinese_table_comments` 为纯注释迁移，不影响现有业务数据。

## 第十一批补充：共享 Core 与 NestJS NodeNext 兼容

验证 `pnpm run build:core` 生成 Core 的 Node ESM `dist/index.js` 和类型声明 `dist/index.d.ts`，且编译后相对路径为 `.js`。在 `pnpm run typecheck:server` 中确保 NestJS 不将 Core 源码作为带显式 `.ts` 后缀的外部 TS 文件重新编译，拒绝 `TS5097` 与 `TS6059`。独立 `pnpm run build:server` 确保 NestJS `rootDir` 不被工作区外源码污染；React/Vue 原始类型检查和构建仍须通过。Docker 最终层须包含 Core `dist/`，不能依赖旧 `src/` 路径。此配置修复不代表新的数据库迁移或隔离并发事务测试已经运行。

## V0.3 第十二批：真实安全失败路径与容器验收

- `pnpm run ready`：预计 340 项常规单测、4 项 NestJS E2E，必须保留 Vue/React/Core、Prisma Client、NestJS 类型与构建、中文文案、格式和文档校验。
- `pnpm run test:db`：预计 9 项隔离 PostgreSQL 真库测试；新增审计 `CHECK` 约束失败的完整回滚（版本、head 和成功审计均无残留，原修订号可重试）、工程行锁下撤销授权后保存拒绝、连接不可达失败及资源释放。严格保留 `SCADA_TEST_DATABASE_URL` 的本机 `adui_scada_test` 守卫。
- `pnpm run test:docker:server`：构建仅用于本地验证的服务端镜像，容器运行强制 `--network none`、无宿主端口映射；验证 Core/Prisma 模块加载、健康路由与未开放业务接口的 404。**不运行 Docker 生产发布或设备写入**。
- 后续需继续补充双向授权竞态压力测试、数据库崩溃/恢复、长期连接池监控、RLS、备份恢复和生产镜像供应链校验。本次没有实现认证 Guard，也没有提交数据库迁移。

以上新测试未实际执行，结果须根据维护者 Windows 终端输出更新。

## V0.3 第十三批：可信身份前置能力验收

普通 `ready` 预计 350 单测和 5 项 E2E，覆盖 32 字节高熵令牌只存摘要、无效/停用主体拒绝签发、会话过期/撤销、异常 Bearer 请求头拒绝、服务端主体写入请求上下文、工程 ACL 默认拒绝、跨租户和精确操作权限。现有完整 Vue/React/Core 与 NestJS 类型/构建不可回退。

隔离 `adui_scada_test` 在应用新迁移后预计 11 项 PostgreSQL 测试，新增令牌摘要持久化与即时撤销、主体禁用与过期。完整业务表和字段中文注释继续由 Prisma 模型静态测试与 SQL 元数据查询覆盖；新迁移不覆盖历史迁移。容器测试确保登录/签发路由仍未开放。

所有新增测试尚需 Windows 实测。未覆盖密码/OIDC 登录、生产 TLS、令牌被盗响应、MFA、身份审计、长期会话清理、Redis 分布式限流及生产工业安全认证。

## V0.3 第十四批：结构化日志、OpenAPI 与 Helmet 安全回归

上一批维护者已在 Windows 实测 `ready` 350 项普通单测、5 项 E2E、隔离 PostgreSQL 11/11 和 Docker 服务端烟测通过。第十四批新增 4 项 Pino 日志配置单测（含测试运行器 Pretty Transport 隔离）、2 项 Swagger 访问策略单测以及 3 项 E2E（Helmet/请求 ID、Swagger 默认 404、仅本机显式开启且只描述健康接口），实测 **356 项常规单测、8 项 E2E**；真实数据库逻辑未修改，原有 **11 项隔离回归**未在本批重新执行。

2026-11-13 Windows 已通过 pnpm 12.18.0 生成并提交锁文件。首轮 `ready` 静态检查无警告、单测 355/355，但 E2E 的 `beforeAll` 超时导致整条链路中断。排除测试环境 Pretty Transport 后，维护者再次实测：单独 `pnpm run test:e2e:server` **8/8 通过、退出码 0**；完整 `pnpm run ready` **退出码 0**，包含单测 **356/356**、E2E **8/8**、格式文件 **219/219**、100 个受检代码文件零错误/警告、62 份 Markdown 静态检查以及 React、Vue、NestJS 构建通过。本批 Docker 隔离镜像烟测已在上一轮实测退出码 0。

仍待开展的生产安全审计包括：真正登录事件持久化、异常访问告警、日志脱敏压力与攻击输入回归、跨节点请求追踪、日志保留与删除策略、CSP 针对前端的细化、生产 TLS 与真实身份提供方。

### 第十四批 E2E 初始化修复补丁

本次补丁排除 Vitest 测试环境的 `pino-pretty` 工作线程，并为实际日志选项补充测试断言。Windows 修复后单元测试 **356/356**、单独 E2E **8/8**、完整 `ready` **退出码 0**。现象已消失，未提高 hook 超时；这证明补丁后验收成功，不等于获得了导致此前超时的独立性能剖析证据。

## V0.3 第十五批：启动配置与 Pino 环境时序安全回归

第十四批 Windows 基线为 356/356 项单测、8/8 项 NestJS E2E 和 `pnpm run ready` 退出码 0。本批新增 5 项启动配置单测；维护者已在 Windows 实测 **361/361 单测、8/8 NestJS E2E**，完整 `pnpm run ready` **退出码 0**。

`apps/server/src/config/server-startup.config.spec.ts` 验证本机默认监听、SCADA 专用配置优先于通用配置、端口上下界、非法监听地址拒绝，以及文档在生产和 0.0.0.0 监听下保持关闭。根 `env:check` 增加静态加载顺序校验，防止回退为环境变量尚未加载就静态初始化 `AppModule`。运行 `vp check`、`pnpm run env:check`、`pnpm run ready`，并按需进行独立 `pnpm run test:docker:server` 验证。

2026-11-13 Windows 验收记录：依赖 Catalog、共享配置、环境变量和中文文案检查通过；`vp check` 检查 **222 个文件格式全部正确**，102 个源文件无警告、Lint 错误或类型错误；Prisma Client 7.10.1 生成、React/Vue/Server 类型检查及构建通过；27 个测试文件共 **361/361 单测**，NestJS E2E **8/8**，63 份 Markdown 文档静态检查通过；`ready` 最终退出码 **0**。独立 `pnpm run test:docker:server` 完成镜像构建和隔离运行，退出码 **0**，健康接口正常且未开放的工程/设备接口继续返回 404。新增配置修改不涉及数据库；本批未单独运行 `pnpm run test:db`，也不代表真实工业现场或生产认证已完成。以上结果来自维护者提供的 Windows 终端与 Docker 日志，记录性文档提交后仍建议复验 `vp check`、`pnpm run docs:check`。

## V0.3 第十六批：身份 Guard 安全事件诊断与脱敏验收

第十五批 Windows `ready` 基线为 361/361 单测、8/8 NestJS E2E。第十六批新增 `scada-security-audit.spec.ts` 的 4 项白名单/非法事件/恶意输入测试与 `scada-identity.spec.ts` 的 2 项 Guard 审计测试，Windows 已实测 **367/367 项单测** 和 **8/8 项 NestJS E2E**，完整 `pnpm run ready` 退出码 **0**。验证必须确认完整令牌、Authorization、Cookie、请求体、项目路径、主体信息和动态异常对象均无法进入安全审计记录；授权拒绝 HTTP 状态和未开放 API 的 404 不变。

2026-11-13 Windows 验收：`vp check` 检查 **225 个文件格式正确**、104 个受检代码文件零警告、零 Lint 错误及类型错误；28 个单测文件 **367/367**、NestJS E2E **8/8**、Prisma Client 7.10.1 生成、Vue/React/NestJS 类型检查与构建、64 份 Markdown 静态检查完成；完整 `ready` 退出码 **0**。独立 Docker 构建成功，`pnpm install --frozen-lockfile` 和服务端构建正常；容器隔离烟测验证健康接口及未开放工程和设备接口，**退出码 0**。

此阶段的事件只写安全白名单诊断日志，不含归责必需的可信主体，不依赖真实数据库；旧隔离 PostgreSQL 11 项测试与本批实现无直接数据模型关联，未重新执行不得称为通过。正式身份审计持久化、日志失败处置、保留和风险告警仍待后续专项验证。

## V0.3 第十七批：Zod 与 NestJS 12 原生 Standard Schema 验收

第十六批 Windows 基线：367/367 单测、8/8 E2E、完整 `ready` 退出码 0，Docker 独立隔离烟测通过。

**本批第一次 Windows 实测失败**（2026-11-13）：Catalog 检查 51 项、文案检查 131 个文件、`vp check` 格式 227/227、105 个受检文件零警告或错误，类型检查通过；普通单测阶段 370 项通过、1 项失败，另有一套件导入报错，因此 `ready` 中断，未执行该轮 E2E、文档检查和全部构建。失败原因：

1. `server-startup.config.spec.ts` 测试非法 `null` 值时，旧实现 `??` 将其当作未配置，错误回退到默认端口。已改为仅在环境值为 `undefined` 时回退，确保 `null` 进入 Zod 校验并按固定中文消息拒绝。
2. `nest-zod-integration.spec.ts` 在 `@ZSerialize` 的 OpenAPI Schema 生成阶段导入失败（`TypeError: Property description must be an object: undefined`）；上游缺少继承的 `safeParse` 属性描述符恢复保护，且官方发行包 Peer 未声明支持 NestJS 12。已撤销该测试及 `nest-zod` 依赖声明，替换为 NestJS 12 官方 Standard Schema 集成测试。

**修复后已完成 Windows 验收**：保留 `zod@4.6.7`，新增 4 项启动配置回归及 4 项只在测试模块注册的 `standard-schema-integration.spec.ts`。维护者实测普通单测 **375/375 项**、NestJS E2E **8/8 项**，完整 `pnpm run ready` **退出码 0**。测试覆盖非法环境值、优先级、中文错误不泄密、`StandardSchemaValidationPipe` 请求体/查询转换、`StandardSchemaSerializerInterceptor` 响应字段过滤及 Swagger 12 文档。

维护者已通过 pnpm 重新生成并推送 `pnpm-lock.yaml`，GitHub 核对确认锁文件不再包含 `nest-zod`，仅保留 Zod 4.6.7。修复后 Windows：依赖检查 11 个清单/50 项 Catalog、中文文案检查 131 个文件，`vp check` 格式 **227/227**、105 个受检源文件无告警/错误，29 个测试文件 **375/375 单测**、NestJS E2E **8/8**、65 份 Markdown 静态检查，React/Vue/NestJS 类型检查与构建全部通过，`ready` **退出码 0**。独立 `pnpm run test:docker:server` 构建通过，包含 `pnpm install --frozen-lockfile`，容器内健康接口为 200、未开放工程/设备接口保持 404，Docker **退出码 0**。本批未重新运行 PostgreSQL 真库回归，也未进行工业现场验证；记录性文档更新后建议复验 `vp check` 与 `pnpm run docs:check`。

## V0.3 第十八批：HTTP 存活和就绪探针验收

第十七批维护者 Windows 基线：**375/375 单测、8/8 NestJS E2E**、完整 `ready` 退出码 0，Docker 隔离镜像烟测退出码 0。本批新增 3 项 `HttpReadinessIndicator` 单测，NestJS E2E 新增 2 项；**2026-11-13 Windows 实测 378/378 单测（30 个文件）、10/10 E2E**，完整 `pnpm run ready` **退出码 0**。

验证重点：`GET /health` 仍为 200 且响应完全不变；`GET /health/ready` 仅在 HTTP 应用完成初始化时返回 200、禁止缓存，返回 `http.status="up"`、`scope="http"`、`dependencies="not_checked"`；生命周期转入关闭时就绪接口返回 503，但存活接口不修改。Swagger 受控本机开发文档包含新探针，生产文档依然不可访问。Docker `--network none` 烟测验证服务端可加载 `@nestjs/terminus` 且探针可正常响应，未开放工程/登录/设备写入继续保持 404。

**实际验收记录**：维护者已在 Windows 用 pnpm 正式更新并提交 `pnpm-lock.yaml`，远程 PR #40 已核实包含 `@nestjs/terminus@12.1.0`。Catalog 11 个清单/51 项依赖、中文文案检查 134 个文件、`vp check` 231 个文件格式正确且 108 个检查文件无告警/错误；Vue/React/NestJS 类型检查及构建通过、Prisma Client 7.10.1 生成正常、66 份 Markdown 静态检查通过。独立 Docker 镜像构建包含 `pnpm install --frozen-lockfile` 且成功，`--network none` 容器烟测确认 `/health`、`/health/ready` 均返回 200，未开放的 Swagger/工程/登录/设备接口仍返回 404，**Docker 退出码 0**。E2E 日志中的 Terminus `Health Check has failed!` / HTTP 503 来自**主动模拟关闭流程的负面测试**，10/10 均通过，不能误记为程序故障。PostgreSQL 真库、Redis 及工业现场设备仍未在本批验证；验收后只追加文档，建议最终复查 `vp check` 与 `pnpm run docs:check`。

## V0.3 第十九批：HTTP 请求接收边界与关闭阶段防护

基线：第十八批 Windows `ready` **378/378 单测、10/10 NestJS E2E、退出码 0**，Docker 镜像冻结安装及 `--network none` 隔离烟测退出码 0。本批新增 3 项 `http-server-policy.spec.ts` 单测、2 项 `http-server-policy.e2e-spec.ts`；维护者 Windows 实测 **381/381 单测（31 个文件）、12/12 E2E（2 个文件）**，完整 `pnpm run ready` **退出码 0**。

验收关注：Node `Server` 请求头/完整请求接收时限、Keep-Alive 空闲和 Header/Socket 请求数量确实固定且非零；`server.timeout` 未被配置成全局响应超时。NestJS 启动选项明确 `return503OnClosing:true`、不启用强制销毁连接。E2E 使用 `ShutdownBarrier.onModuleDestroy()` 持有关闭过程，验证新请求收到 503、`Connection: close`；`finally` 必须释放屏障并等待应用关闭，不能残留端口或句柄。Docker 使用相同的正式配置验证 Server 属性，原健康接口 200、Swagger 默认不可见、未开放业务接口 404。

仅检查 HTTP 入口保护，不表示生产网络的反 DDoS、限流、Nginx 摘流、Linux SIGTERM 超时排空、SSE/WS 断线重连或工业网关事务已验证。Windows 对 SIGTERM 的限制使本批采用 `app.close()` 验证原生关闭生命周期；真实 Linux 容器信号回归和 PostgreSQL 真库测试均未在本批执行。E2E 中 Terminus 的 `Health Check has failed!` 与 HTTP 503 是此前就绪探针主动模拟关闭的**预期负面测试**，12/12 E2E 全部通过。

第十九批没有新增依赖，`pnpm-lock.yaml` 和 Catalog 不发生修改。维护者 Windows 已完成依赖/配置/环境/中文文案检查（11 个 Manifest、51 项 Catalog、137 个自有文件），`vp check` **235/235 文件格式正确、111 个受检文件零警告或错误**，Core 构建与 React/Vue/服务端 TypeScript 检查通过，Prisma Client 7.10.1 正常生成、67 份 Markdown 静态检查通过、Web 双端及 NestJS 均构建通过，完整 `ready` **退出码 0**。独立 Docker 镜像冻结安装及服务端构建成功，隔离烟测验证 HTTP 资源与关闭策略已加载、健康/就绪返回 200、未开放工程/设备接口仍为 404，**Docker 退出码 0**。本轮没有真正验证 Linux SIGTERM 或工业现场。记录性文档更新后建议仅复查 `vp check` 与 `pnpm run docs:check`。

## V0.3 第二十批：Linux Docker 正式进程 SIGTERM 退出验收

第十九批基线：Windows `pnpm run ready` **381/381 单测、12/12 E2E、退出码 0**，独立 Docker `test:docker:server` 退出码 0。本批不增加 Vitest 测试文件、不新增依赖，预计普通单测 **381**、E2E **12**，待维护者实际复验。新增的信号回归位于 Docker 构建后的第二阶段，不能只执行 `ready` 就宣称第二十批全部通过。

Docker 隔离测试应依次验证：

1. 已有容器模块加载、HTTP 安全、健康/就绪 200、未开放 API 404，继续通过。
2. `--network none`、无端口映射的正式服务端容器作为 Node PID 1 启动；`docker exec` 在容器回环接口等待 `/health/ready` 200，确认 `/health` 200、设备写入 404。
3. `docker stop --signal SIGTERM --timeout 10` 向真正的 Linux PID 1 发送信号，`docker inspect` 核对退出码 **0**，排除超时 SIGKILL 或清理失败。
4. `finally` 中强制移除测试容器，测试失败后也不得遗留后台容器；任何阶段失败必须使根脚本退出非零。

`enableShutdownHooks([], { useProcessExit: true })` 与原默认 143 退出码语义不同，已经在 ADR-0052 明确；不能通过放宽退出码断言取代真实测试。本批没有验证在途事务排空、Linux 编排滚动升级、SSE/WS 或工业网关联锁。

维护者首次 Windows 和 Docker 实测（本机 Swagger 启动日志追加之前）均已通过：Catalog 11 个清单、51 项依赖，`vp check` **237 个文件格式正确、112 个受检文件零告警/错误**；31 个测试文件 **381/381 单测**、2 个 E2E 文件 **12/12 E2E**，68 份 Markdown 检查及 Web/Server 类型检查与构建均成功，完整 `pnpm run ready` **退出码 0**。独立 Docker 构建冻结安装成功，原隔离烟测通过；新增正式 Node PID 1 Linux 容器接收 SIGTERM 并以退出码 **0** 正常结束，Docker 根命令 **退出码 0**。此前 Terminus 503 日志仍为故意模拟关闭的成功负面测试。

**后续增量变更（待重新验证）**：根据维护者要求，在 Swagger 仅本机显式启用的情况下，NestJS 完成监听后使用 Pino 输出 `http://127.0.0.1:<port>/api/docs`。将 `api/docs` 路由路径复用为常量，新增 2 项普通单测，预期最新版普通单测 **383 项**、E2E **12 项**；新代码尚未实际重新运行。必须再次执行 `vp check`、`pnpm run ready`、`pnpm run test:docker:server` 并核对退出码，不能将上轮 381/381 结果当作最新 383 项测试已通过。文档默认关闭、生产与非回环禁用策略不变，禁止在日志输出密钥或设备信息。

## V0.3 第二十一批：本机只读 Tag 演示接入验证（Windows / Docker 已通过）

本批以已合并的第二十批为基线，保留 HTTP 安全头、Swagger 默认关闭、完整 `ready` 和 Linux Docker SIGTERM 测试。新增 2 项启用策略、4 项共享模拟服务测试、1 项正式默认模块 404 E2E、4 项本机演示模块 E2E。维护者 2026-11-13 Windows 实测：**389/389 单测（33 个测试文件）、17/17 NestJS E2E（3 个测试文件）**；此前 `vitest(expect-expect)` 警告修复后，`vp check` **245/245 个文件格式正确、119 个受检文件零警告/零错误**。

应重点确认严格的三条件白名单（独立开关 true、非 production、127.0.0.1）；默认 AppModule 真实不存在 `/api/dev/demo/*` 路由；显式开发模块只含已标注为模拟的工程、Tag 快照和 SSE；Swagger 本机 OpenAPI 不出现身份签发、工程版本或设备写入能力；TagStore 初始快照及 delta、断线 STALE 与恢复时 sequence 单调递增、客户端取消订阅与模块关闭定时器清理。

完整 Windows `pnpm run ready` **退出码 0**：11 个 Manifest / 51 项 Catalog 依赖检查成功，中文文案检查 145 个自有文件，Prisma Client 7.10.1 生成成功，Core、React/Vue、Draft Storage、NestJS 类型检查及构建通过，**69 个 Markdown 文件**静态检查成功。独立 Docker 镜像构建包含 `pnpm install --frozen-lockfile` 和服务端构建；隔离烟测中存活与 HTTP 就绪探针 200，未开放的工程/工业设备接口保持 404；正式 Node PID 1 容器接收 Linux SIGTERM 后退出码 **0**，`pnpm run test:docker:server` **退出码 0**。E2E 中 Terminus `Health Check has failed!` / HTTP 503 是模拟关闭状态的**预期负面测试**，17/17 E2E 通过，并非非预期故障。

本批没有执行 PostgreSQL 真库回归、工业现场验证或手工交互式浏览器 Swagger/SSE 验证；自动化 E2E 已覆盖模拟工程、Tag 快照、只读 Swagger 路由、SSE 首条 snapshot 与关闭连接。记录性文档更新在上述实测之后，建议最新 HEAD 复查 `vp check` 和 `pnpm run docs:check`。

## V0.3 第二十二批：Runtime 数据源抽象与会话隔离（Windows / Docker 已通过）

第二十一批维护者 Windows 基线为 **389/389 单测（33 文件）**、**17/17 NestJS E2E（3 文件）**。第二十二批新增 4 项 `tag-source.test.ts` 与 7 项 `tag-source-runtime.test.ts`，维护者在 Windows 已实测 **Runtime 专项 21/21（3 文件）、全量单测 400/400（35 文件）、NestJS E2E 17/17（3 文件）**，全部通过。此前 `erasableSyntaxOnly` 的 TS1294 参数属性报错已修复；独立 `vp check` 和完整 `ready` 内的检查均显示 **249 个文件格式正确、122 个源文件无类型/Lint 警告或错误**。

重点验收固定同源路由预设与拒绝外部 URL、工程 HTTP/Content-Type/AbortSignal、snapshot→delta 共享协议校验、断线 STALE/新 snapshot 恢复、首次 delta 拒绝、非法消息关闭连接、stop 中止请求、旧代次回调隔离、同步订阅错误回收。生产默认 Nest API、Vue/React Web 默认 `/demo`、Tauri 离线模拟均保持不变；不新增设备写入、认证接口或外网接入。

维护者 Windows **完整 `pnpm run ready` 退出码 0**：11 个 Manifest / 51 项 Catalog 依赖检查通过，中文文案检查 148 个自有文件，Prisma Client 7.10.1 生成成功，Core、Vue、React、Draft Storage、NestJS 类型检查与构建通过，**70 份 Markdown** 静态检查通过。独立 Docker 镜像执行 `pnpm install --frozen-lockfile` 和服务端构建，隔离 HTTP 烟测的健康/就绪接口正常，未开放工程及工业设备接口仍为 404；正式 Linux Node PID 1 接收 SIGTERM 后退出码 0，**`pnpm run test:docker:server` 退出码 0**。E2E 中 Terminus `Health Check has failed!` 和 HTTP 503 是预期关闭状态负面测试。Docker 验证的是既有服务端安全与关闭机制，不应当作 Runtime 本身的容器端到端测试。

本批**未验证** PostgreSQL 真库、工业现场、生产鉴权、SSE 并发背压、浏览器切换到 Nest 数据源，也没有收到人工 Vue/React 页面断连演练记录。验收文档补写后建议重新执行 `vp check` 和 `pnpm run docs:check`，不能把本次记录性提交当作已重跑质量链。

## V0.3 第二十三批：SSE 具名心跳与 Tag 数据静默回归（Windows / Docker 已通过）

本批从维护者已实测的第二十二批 **400 单测、17 NestJS E2E** 基线出发，新增 5 项 SSE 适配器测试、3 项 Runtime 数据质量测试、1 项 NestJS SSE 心跳资源测试。维护者 2026-11-13 Windows 实测：**Runtime 专项 29/29（3 个文件）、Server 专项 79/79（16 个文件）、全量单测 409/409（36 个文件）、NestJS E2E 17/17（3 个文件）**。此前新增的 SSE 控制器测试中 Vitest Mock 泛型和 NestJS MessageEvent 类型问题已修复；`vp check` 检查 **251 个文件格式正确、123 个受检文件零警告、零错误**。

验证范围：原独立 SSE 与 NestJS 本机受控 SSE 具名 heartbeat 每 5 秒发送、停机/取消订阅清理；适配器保持固定同源路由和既有 EventSource 原生重连，15 秒完全静默后强制新建流，禁止旧流消息；Runtime 只有收到通过 Core 校验的非空快照或被 TagStore 接受的新序列增量才刷新 12 秒数据时钟，上游 STALE、空 delta、重复旧序列、断线及数据沉默不能展示伪造 GOOD，恢复后按序列号和新会话快照重新计算状态。原 8 秒数据暂停保留，正常心跳不会错误取消过期质量。

维护者 Windows **完整 `pnpm run ready` 退出码 0**：11 个 Manifest、51 项 Catalog 依赖检查通过；中文文案检查 149 个自有文件；Prisma Client 7.10.1 生成成功；Core、Vue、React、Draft Storage、NestJS 类型检查与构建均通过；**71 个 Markdown** 文档静态检查通过。独立 Docker 构建执行 `pnpm install --frozen-lockfile` 与 NestJS 构建，隔离烟测验证存活/就绪接口 200、工程及设备写入等未开放接口 404；正式 Linux Node PID 1 接收 SIGTERM 后正常退出码 **0**，`pnpm run test:docker:server` **退出码 0**。E2E 中 Terminus `Health Check has failed!` / HTTP 503 是主动模拟关闭的预期负面用例，并非失败。Docker 验证的是服务端容器隔离与退出机制，**不等同于浏览器 Runtime 的真实 SSE 长连接测试**。

尚未收到人工浏览器心跳可见性、异常断线恢复演练记录；SSE 长时间压力、浏览器后台定时器节流、Nginx 反向代理、生产身份权限、PostgreSQL 真库和现场工业设备仍未验证。本次验收记录在上述实测后更新，建议最新 HEAD 复查 `vp check` 与 `pnpm run docs:check`；不能将记录性文档变更视为已重复执行全量质量链。

## 2026-11-13 · V0.3 第二十四批验证清单（Windows 自动化已通过）

- [x] 独立环境验证新增 `scripts/test-runtime-sse-browser.mjs` 可以通过 `node --check`；此检查只覆盖 JavaScript 语法。
- [x] `pnpm run test:runtime`：维护者 Windows 实测 32/32 通过（3 个文件），退出码 0；包含后台标签页恢复前台和多 Tag 独立质量恢复。
- [x] `pnpm run test:sse:browser`：维护者 Windows 实测 React（127.0.0.1:15173）和 Vue（127.0.0.1:15174）均输出心跳保活、Tag 过期、静默重连、资源清理通过；退出码 0。需保持本机 Demo、React、Vue 服务运行。
- [x] `vp check`：253 个文件格式正确、124 个受检文件零警告/零错误；`pnpm run docs:check`：72 份 Markdown 通过；完整 `pnpm run ready` 退出码 0，包含全量单测 412/412（36 文件）、NestJS E2E 17/17（3 文件）、双 Web/NestJS 类型检查与构建。
- [ ] Windows Chrome/Edge 人工后台标签页恢复以及 Nginx 代理断流现场演练。
- [ ] 真实高并发 SSE、生产鉴权、PostgreSQL 真库与工业网关现场验收；均不属当前原型完成范围。

本批测试脚本的故障注入只屏蔽 EventSource 回调而非真实网络报文；不能把浏览器脚本通过解释为代理断流、半开 TCP 和工业现场稳定性已经验收。详见 [ADR-0056](adr/0056-sse-browser-visibility-recovery.md)。

### 第二十四批首轮 Windows 反馈与定向修复（2026-11-13）

维护者实际执行 `pnpm run test:runtime`：**30/31 通过（3 个文件），退出码 1**，新增“后台标签页返回前台”用例在本地过期后收到 `sequence=2` 仍为 `stale`。经代码检查，原 Runtime 调用 `TagStore.markDisconnected()` 生成合成过期事件并递增序列，导致上游下一条真实递增序列与合成序列冲突。现修正为 **仅在 Runtime 展示层逐 Tag 标记过期**，旧上游序列不恢复、实际接受的新序列仅恢复对应 Tag，新增多 Tag 部分恢复回归；保留网络断连必须新 snapshot 的规则。

维护者实际执行 `pnpm run test:sse:browser`：预检查报告 `fetch failed`，**退出码 1**；未提供三项本机服务的运行日志，不能推定具体端口或代理根因。脚本现按根 `.env` 解析开发端口，分别检查页面和模拟工程接口，报错包含 URL、底层错误及必要启动命令。上述两项修复提交后 **尚未收到重新执行结果**，不得标记通过。维护者下次需分别在三个终端启动 Demo、React、Vue 后，再运行浏览器回归及 Runtime 单测，最后执行 `vp check`、`pnpm run docs:check` 和 `pnpm run ready`。

### 第二十四批第二轮 Windows 自动化复验（2026-11-13）

维护者上传的 15:32 左右实际测试日志确认：**本批原先两处阻塞均已消除**。

- `pnpm run test:sse:browser`：先检查 React `http://127.0.0.1:15173` 与 Vue `http://127.0.0.1:15174`，两端分别报告 SSE 心跳保活、Tag 过期、静默重连和资源清理通过；**退出码 0**。
- `pnpm run test:runtime`：**32/32 通过（3 文件），退出码 0**。此前 STALE 与上游 sequence 冲突已由共享 Runtime 展示层隔离解决，补充的多 Tag 独立恢复用例通过。
- `vp check`：**253 个文件格式正确**，124 个受检文件**无警告、Lint 或类型错误**。
- `pnpm run docs:check`：**72 份 Markdown 文件通过**。
- `pnpm run ready`：**退出码 0**。全量单元测试 **412/412（36 文件）**，NestJS E2E **17/17（3 文件）**；11 个清单/51 项 Catalog 依赖检查、9 个 TSConfig 共享配置检查、根环境和 LF 检查、150 个自有文件中文文案检查、Prisma Client 7.10.1 生成、Vue/React/NestJS 类型检查及构建成功。
- E2E 中 Terminus 的预期 HTTP 503 / `Health Check has failed!` 是故意模拟服务关闭的负面测试，**不是未通过项**；构建中的 Rolldown 性能分析提示也不是失败。

**边界：** 本次浏览器脚本在真实 Chrome/Edge 与原生 SSE 上运行，但故障注入仅屏蔽 EventSource 回调；没有验证真实 TCP 断网、Nginx 半开连接、高并发/背压、人工后台标签页节流、生产鉴权、PostgreSQL 真库、Docker 本批增量回归或工业现场。该次日志对应文档记录性更新前的已验收代码；本次更新文档本身尚未重新执行 `vp check` 和 `pnpm run docs:check`。PR #46 继续 Draft，等待维护者明确合并授权。

## 2026-11-13 · V0.3 第二十五批验收清单（待维护者执行）

- [x] 协作容器内 Node 内置测试器对隔离代码副本执行八项连接资源单测：**8/8 通过**（包括真实本机 HTTP 32 路、超额 503 与释放后重连）；这不是 Windows 仓库全量质量链结果。
- [x] `pnpm run test:sse:clients`：维护者 Windows 仓库实测 **8/8 通过，0 失败**，包含真实回环 HTTP 32 路上限、第 33 路 503、断开重入、背压及响应异常。
- [x] `pnpm run test:sse:network`：维护者 Windows 实测独立模拟服务 `127.0.0.1:14178/events`，六路快照、heartbeat、单路断开隔离与重新订阅通过，**退出码 0**。
- [x] `pnpm run test:sse:proxy`：修正 Docker Compose 根 `.env` 读取后，维护者 Windows 实测 React `127.0.0.1:18080/demo/events` 与 Vue `127.0.0.1:18081/demo/events` 均通过六路快照、heartbeat、断开隔离与重新订阅，**退出码 0**；Docker Demo/Server 为 Healthy。
- [x] `vp check`：257 个文件格式正确、127 个受检文件零告警/错误、退出码 0；`pnpm run docs:check`：73 份 Markdown 通过、退出码 0；`pnpm run ready`：退出码 0，全量 Vitest 412/412（36 文件）、SSE Node 8/8、NestJS E2E 17/17（3 文件），Vue/React/NestJS 类型检查及构建通过。
- [ ] 真实代理断网/半开、慢客户端长时负载、持续 32 路连接压力、Windows 长时间后台页恢复、生产认证、PostgreSQL 真库和工业现场：均未验证（短时 32 路 HTTP 上限与 503 已在 Node 回归中验证）。

本批固定 32 路/64 KiB 仅为本机模拟服务防护；直接网络烟测和 Docker Nginx 代理烟测不代表工业现场连接容量或生产容灾性能。参见 [ADR-0057](adr/0057-local-sse-capacity-and-proxy-validation.md)。

### 第二十五批首轮 Windows 格式/Lint 反馈与修复（2026-11-13）

维护者执行 `vp check --fix` 后报告 **0 个错误、9 个警告（127 个受检文件）**，同时提示格式修复已完成。警告均出自本批新增的两个测试文件：

- `examples/water-treatment/sse-clients.test.mjs`：8 次 `node:test` 顶层 `test(...)` 返回 `Promise<void>` 未显式处理，触发 `typescript(no-floating-promises)`；已统一修改为顶层 `await test(...)`，逐项等待测试完成，并保留全部断言和连接清理。
- `scripts/test-runtime-sse-network.mjs`：测试客户端对象的 `task: null` 使类型分析无法确认它是 Promise，触发 `typescript(await-thenable)`；现以 `Promise.resolve()` 初始化，随后赋值实际异步读取任务，`close()` 继续等待任务退出。

两个文件的修改后源码已做静态 JavaScript 语法解析；隔离环境也确认 `node:test` 返回可等待的 Promise，顶层 `await test` 会继续运行后续测试并准确报告失败。**修复后的 Windows `vp check`、`test:sse:clients`、`test:sse:network`、`test:sse:proxy` 和完整 `ready` 尚待维护者执行，不得将本轮 Lint 报告视为修复后通过。**

### 第二十五批 Windows Docker Nginx 代理端口漂移（2026-11-13）

维护者实际执行了 `pnpm run test:sse:clients`：Node 资源测试 **8/8 通过**；`pnpm run test:sse:network`：本机 `127.0.0.1:14178/events` 六路快照、具名心跳、单路断开隔离及重订阅通过，**退出码 0**。`pnpm run docker:demo:up` 已完成四个镜像构建，Demo 和 NestJS 容器为 Healthy，React/Vue 容器已启动。

但 `pnpm run test:sse:proxy` 在首个 React 代理入口 `127.0.0.1:18080/demo/events` 返回 **ECONNREFUSED，退出码 1**，没有运行到 Vue 代理。Docker Desktop 显示实际宿主机发布端口为 React `8080`、Vue `8081`；维护者根目录 `.env` 则配置 `18080`、`18081`。检查发现 Docker 演示脚本的 Compose 命令缺少显式 `--env-file .env`，且 `scripts/check-env-config.mjs` 与 Compose 内端口回退值同根模板存在漂移。

本批补丁仅修复 Docker 配置读取：演示栈 `up/down/logs` 与新增 `ps` 命令统一显式加载仓库根 `.env`；Compose 四组端口回退值同步为根 `.env.example` 默认值；`env:check` 强制验证脚本及四组默认值，防止再次静默降级到旧端口。**没有修改 SSE 服务、NestJS 或 Vue/React 业务代码，也未执行 Docker 或重启维护者计算机上的容器。**

维护者同步分支后，建议在仓库根目录执行 `pnpm run env:check`、`pnpm run docker:demo:up`、`pnpm run docker:demo:ps` 和 `pnpm run test:sse:proxy`；`docker:demo:ps` 的宿主机端口应分别显示 `127.0.0.1:18080->8080/tcp` 和 `127.0.0.1:18081->8080/tcp`。如仍不一致，需检查 PowerShell 是否存在 `SCADA_REACT_PORT`/`SCADA_VUE_PORT` 同名进程环境变量覆盖；切勿粘贴完整 `docker compose config --environment`，其中可能包含凭据。修复后的 Windows Docker Nginx 代理烟测、`vp check`、`docs:check` 和完整 `ready` 尚未实测。

### 第二十五批 Docker Nginx 双框架第二轮验收通过（2026-11-13）

维护者上传 PowerShell 实测：`pnpm run env:check` 检查根目录环境配置、LF 均通过；`pnpm run docker:demo:up` **四个镜像构建完成、四个容器启动**，其中 Demo/Server 为 Healthy。`pnpm run docker:demo:ps` 显示宿主机真实端口为 React `127.0.0.1:18080->8080/tcp`、Vue `127.0.0.1:18081->8080/tcp`，与根 `.env` 一致。

`pnpm run test:sse:proxy` 先访问 React `18080/demo/events` 再访问 Vue `18081/demo/events`，**两端均验证六路 snapshot、具名 heartbeat、单路断开不影响其他连接与重订阅，退出码 0**。这证实前一轮 `ECONNREFUSED` 的端口漂移问题已在本机修复；该实测验证的是运行中的 Docker Nginx 代理，未模拟真实网卡断开、代理半开或长时间高并发压测。

上一份 Windows 实测还确认 `test:sse:clients` **8/8** 与 `test:sse:network` **退出码 0**。**本次附件没有给出最新 `vp check`、`pnpm run docs:check` 或完整 `pnpm run ready` 日志，仍保持待验收状态**。本段验收记录提交后的文档/格式检查亦尚未执行；PR #47 继续保持 Draft，未经明确授权不合并。

### 第二十五批 Windows 完整质量链最终复验（2026-11-13）

维护者上传 PowerShell 实测日志，针对本批已修复代码确认：

- `vp check`：**257 个文件格式正确**，127 个受检文件**无警告、Lint 错误或类型错误**，命令退出码 **0**。此前 9 条类型感知 Lint 警告均已消除。
- `pnpm run docs:check`：**73 份 Markdown 文档通过**，退出码 **0**。
- `pnpm run ready`：**退出码 0**。依赖检查 **11 个清单、51 项 Catalog**，共享配置 9 个 TSConfig 消费端，中文文案 153 个自有文件，根环境与 LF 检查通过；Prisma Client **7.10.1** 生成成功。
- 全量 Vitest **412/412 通过（36 个文件）**；纳入 ready 的 SSE Node 专项 **8/8 通过**，含真实回环 HTTP 32 路容量、第 33 路 HTTP 503 和释放后重新订阅。
- NestJS E2E **17/17 通过（3 个文件）**，包含预期的服务关闭负面检查；日志中的 HTTP 503 / `Health Check has failed!` 属于通过的故障场景，不是失败。
- Vue、React、NestJS 类型检查与构建全部通过。
- 结合此前维护者独立网络日志：`test:sse:network` 实际六路 HTTP SSE 通过、退出码 0；`test:sse:proxy` 在 React `18080` 与 Vue `18081` 的 Docker Nginx 双入口通过、退出码 0，Demo 与 Server 为 Healthy。

**自动化验收结论：第二十五批 Windows 完整质量链及 Docker Nginx SSE 代理专项均通过。** 注意本段验收记录追加后尚未再次执行最新文档的格式与静态检查，建议合并审查前运行 `vp check`、`pnpm run docs:check`。仍未验证真实 Nginx 半开连接、持续高并发/慢消费者长期负载、生产认证、PostgreSQL 真库和工业现场设备；不能把本机 Demo 资源上限视为工业 SLA。PR #47 继续 Draft，待维护者明确同意后才能合并。

## 2026-11-13 · V0.3 第二十六批 TCP SSE 故障与长连接验收清单（待维护者执行）

- [x] 协作环境 Node 原生 HTTP/TCP 故障代理模块隔离测试 **3/3 通过**：非法外部目标拒绝、普通 HTTP 透传、真实 SSE 下行字节阻断且 socket 保持开放、其他订阅继续接收、连接关闭后重订阅。
- [x] 新增 JS 文件及修改后的网络/浏览器脚本完成静态 JavaScript 语法解析，根 `package.json` JSON 检查通过；**这不等同于 Vite+ Lint 或真实浏览器运行通过**。
- [x] `pnpm run test:sse:fault:unit`：维护者 Windows 通过完整 `ready` 执行，**4/4 通过**，包含真实 Keep-Alive 重用后 SSE 分类与阻断回归。
- [x] `pnpm run test:sse:fault:browser`：维护者 Windows 实测 React、Vue 均打印真实 TCP 下行阻断、STALE、主动重连及连接回收通过，**退出码 0**。
- [x] `pnpm run test:sse:fault:proxy`：维护者 Windows Docker/Nginx 实测 React、Vue 均完成真实 TCP 下行阻断、STALE、主动重连和连接回收，**退出码 0**；测试进程未修改容器配置。
- [x] `pnpm run test:sse:soak` 和 `pnpm run test:sse:soak:proxy`：维护者 Windows 实测独立 Demo 及 Docker React/Vue 代理分别六路持续收到至少 12 次 heartbeat 和新 delta，断开与资源清理通过，**两个命令退出码均为 0**。
- [x] `vp check`：**260 个文件格式正确、129 个受检文件零告警/错误，退出码 0**；`pnpm run docs:check`：**74 个 Markdown 文件通过**；完整 `pnpm run ready` **退出码 0**，包含全量 Vitest 412/412（36 文件）、Node SSE 资源 8/8、Node 故障代理 4/4、NestJS E2E 17/17（3 文件），Vue/React/NestJS 类型检查与构建通过。
- [ ] 真实 Nginx 半开故障、长时间高并发与慢消费者压力、生产鉴权、PostgreSQL 真库及工业现场：不属于当前可证实交付范围。

本批仅在本机 `127.0.0.1` 注入 TCP **下行静默样式**故障，不能声称已造成生产线路半开；临时测试代理可视为测量工具而不是 SCADA 部署组件。见 [ADR-0058](adr/0058-tcp-sse-fault-and-soak-tests.md)。

### 第二十六批首轮 Windows 浏览器与 Lint 反馈（2026-11-13）

维护者已启动 `dev:react`（`127.0.0.1:15173`）和 `dev:vue`（`127.0.0.1:15174`），均显示 Vite+ Ready。运行 `pnpm run test:sse:fault:browser` 后，**React 的真实 TCP 下行阻断、STALE、主动重连和连接回收通过**；Vue 在注入前断言失败：`故障注入前必须只有一条有效 SSE TCP 流`（实际 **0 !== 1**），因此整条命令退出码 1，**不能标记为双框架通过**。`vp check --fix` 反馈 129 个受检文件 **0 errors、1 warning**：浏览器脚本 `recovered` 变量未使用，并已运行格式修复。

**已定位代码根因：** 测试专用 TCP 故障代理原先仅用 socket 的第一条 HTTP 请求行决定是否为 SSE；浏览器可能复用 Keep-Alive 连接，先获取 Vue 页面资源，再在同一 socket 上请求 `/demo/events`，从而出现 UI 已经 live、代理 `activeSseCount() === 0` 的分类遗漏。该结论来自代理实现缺陷；当前日志没有直接抓到 Vue 每个 socket 的请求顺序，故不将复用行为描述为已经抓包证实。

**本分支定向修正：** TCP 代理对同一个下游连接持续识别后续的 `GET /demo/events`/`GET /events` 请求行，使用最多 256 字节尾部缓存跨 TCP 分块解析，不改变普通流的转发规则。新增第 4 条 Node 回归，用同一个 `http.Agent({ keepAlive: true, maxSockets: 1 })` 确认同一 socket 先访问 `/health`、再访问 `/demo/events`，随后可以冻结真实 SSE 字节且完成连接回收。浏览器脚本要求页面恰有一条有效 EventSource 且测试代理恰有一条 SSE socket，稳定 400ms 才故障注入，消除初次页面加载时的判断竞态；`recovered` 现参与同源订阅路径一致性断言，修复未使用变量警告。

**修复后验证状态：** 代码通过静态 JavaScript 语法解析，协作环境的独立 Node 22 Keep-Alive 实验复现成功，但**没有在完整仓库执行修改后的四项 Node 单测、双框架真实 Chrome/Edge、`vp check` 或 `pnpm run ready`**。维护者需同步分支后重跑 `pnpm run test:sse:fault:unit`、`pnpm run test:sse:fault:browser`、`vp check`、`pnpm run docs:check`、`pnpm run ready`；Docker 专项与持续长连接仍独立待测。

只更新测试工具和验收文档，没有改动共享 Runtime、Core、Vue/React 页面或生产服务；PR #48 继续 Draft，不经明确授权不合并。

### 第二十六批第二轮 Windows 双框架与完整质量链复验通过（2026-11-13）

维护者上传最新 PowerShell 日志证实：`pnpm run test:sse:fault:browser` 分别打印 **React 和 Vue 真实 TCP 下行阻断、STALE、主动重连及连接回收通过**，浏览器测试退出码 **0**。此前 Vue 的 `0 !== 1` SSE socket 分类失败已由 Keep-Alive 复用识别及稳定就绪判断修复；本轮不再复现。

`vp check` 实测 **260 个文件格式正确，129 个受检文件零警告、零错误，退出码 0**；此前 `recovered` 未使用变量告警已经消除。`pnpm run docs:check` **74 个 Markdown 文件通过**。`pnpm run ready` **退出码 0**，包括依赖检查 11 个清单/51 项 Catalog、9 个 TSConfig 消费端、155 个自有文件中文文案检查、根环境与 LF 检查、Prisma Client 7.10.1 生成、Vue/React/NestJS 类型检查和构建。全量 Vitest **412/412（36 文件）**、Node SSE 连接资源专项 **8/8**、Node TCP 故障代理专项 **4/4**（含同一 Keep-Alive socket 的后续 SSE 请求）、NestJS E2E **17/17（3 文件）**。

E2E 中的 HTTP 503 / `Health Check has failed!` 属于主动模拟服务不可用的预期负面测试，不代表 E2E 失败。

**仍待独立验收：** `pnpm run test:sse:fault:proxy`（Docker Nginx 双框架故障注入）、`pnpm run test:sse:soak` 与 `pnpm run test:sse:soak:proxy`（六路持续心跳及增量）。本批实际故障注入为本机测试代理阻断 TCP 下行字节，不等同真实 Nginx 半开、长时高并发、生产鉴权、PostgreSQL 真库或工业现场验收。

本次仅提交验收文档，**文档提交后的 `vp check` 与 `docs:check` 尚未重新执行**。PR #48 保持 Draft、Assignee `@adui-dev`，没有收到明确合并授权。

### 第二十六批最终 Docker TCP 故障与持续连接验收通过（2026-11-13）

维护者提供最新 Windows PowerShell 日志，本批剩余 **3 条专项测试全部通过，均退出码 0**：

- `pnpm run docker:demo:ps`：本机演示栈 Demo、NestJS Server 均 `healthy`；React 宿主机映射 `127.0.0.1:18080->8080/tcp`，Vue `127.0.0.1:18081->8080/tcp`，与统一根 `.env` 一致。该日志不代表更改或重新部署 Docker。
- `pnpm run test:sse:fault:proxy`：**React/Vue Docker Nginx 双框架均通过**真实 TCP SSE 下行静默注入、Tag STALE、主动重连、快照恢复和连接回收，**退出码 0**。
- `pnpm run test:sse:soak`：独立 Demo `127.0.0.1:14178/events` 六路流通过首包快照、具名心跳、单路断开隔离、新快照，随后每路持续至少 **12 次心跳和有效增量**、连接清理通过，**退出码 0**。
- `pnpm run test:sse:soak:proxy`：Docker Nginx 的 React `18080/demo/events` 与 Vue `18081/demo/events` 两入口各六路全部通过上述持续事件与连接回收验证，**退出码 0**。
- 专项完成后再次执行 `vp check`：**260 个文件格式正确、129 个受检文件零警告零错误，退出码 0**；`pnpm run docs:check`：**74 份 Markdown 文件通过，退出码 0**。

结合前轮维护者实测，双框架开发环境 `test:sse:fault:browser` **退出码 0**，完整 `pnpm run ready` **退出码 0**：全量 Vitest **412/412（36 文件）**、Node SSE 资源 **8/8**、Node TCP 故障代理 **4/4**、NestJS E2E **17/17（3 文件）**，双框架和 NestJS 类型检查、构建通过。**第二十六批本机 Windows/Docker 自动化验收项已全部通过。**

**范围限制：** 真实被阻断的是本机测试代理内的 TCP SSE 下行字节，未直接模拟真实 Nginx 宕机、物理断网、工业网关故障。有限六路持续观测不是长期高并发/慢消费内存背压或生产 SLA，生产鉴权、PostgreSQL 真库与现场设备仍未验收。本次仅追加验收记录，**最新文档提交后的 `vp check` 与 `docs:check` 尚未重新执行**；建议合并前再做一次静态复查。PR #48 继续 Draft，未经维护者明确授权不得合并。

## 2026-11-13 · V0.3 第二十七批共享 Runtime 诊断验收清单（待执行）

- [x] `pnpm run test:runtime`：维护者 Windows 实测退出码 0；新增 `diagnostics.test.ts` **5/5 通过**，并覆盖共享 Runtime、TagSource 与离线 Runtime。
- [x] `vp check`：维护者 Windows 实测 **263 个文件格式正确、131 个受检文件零警告/错误，退出码 0**。
- [x] `pnpm run docs:check`：维护者 Windows 实测 **75 个 Markdown 文件通过，退出码 0**。
- [x] `pnpm run ready`：维护者 Windows 实测 **退出码 0**；全量 Vitest **417/417（37 文件）**、Node SSE 资源 **8/8**、TCP 故障代理 **4/4**、NestJS E2E **17/17（3 文件）**，Vue/React/NestJS 类型检查与构建通过。
- [x] `pnpm run test:sse:browser` 与 `pnpm run test:sse:fault:browser`：维护者 Windows 实测 React、Vue 均通过，两个命令退出码均为 0；浏览器自动化检查诊断面板存在、四种质量数量之和与可见 Tag 数一致、STALE 质量统计及重连计数。**手工视觉验收仍未单独报告。**
- [ ] Tauri 桌面端离线页面人工确认；当前仅安排 OfflineDemoRuntime 单元测试，不宣称 MSI 或桌面安装包已验收。
- [ ] 真实 PLC/DCS 采集延时、经校时的端到端 RTT、生产鉴权、PostgreSQL 真库、长期高并发与工业现场：不属于本批交付范围。

本批只新增浏览器本地内存的实时诊断快照。测试通过不得据此推断工业网关、生产可用性、故障报警历史、数据持久化或设备写入已完成。详见 [ADR-0059](adr/0059-runtime-local-diagnostics.md)。

### 第二十七批 Windows 完整质量链与双框架浏览器复验通过（2026-11-13）

维护者上传 PowerShell 日志，确认本批新增诊断与既有 SSE 能力在 Windows 仓库工作区通过：

- `pnpm run test:runtime`：**退出码 0**；其中新增 `packages/runtime/test/diagnostics.test.ts` **5/5 通过**，共享 Runtime、TagSource 与离线 Runtime 测试通过。
- `vp check`：**263 个文件格式正确，131 个受检文件零警告、Lint 错误与类型错误，退出码 0**。
- `pnpm run docs:check`：**75 个 Markdown 文件通过，退出码 0**。
- `pnpm run ready`：**退出码 0**；依赖 11 个清单/51 项 Catalog、9 个 TSConfig 消费端、157 个自有代码或配置文件中文文案检查、根 `.env` 与 LF 检查通过；Prisma Client **7.10.1** 生成成功。
- 全量 Vitest：**417/417（37 个文件）**；其中 Runtime 诊断测试 5/5。
- Node SSE 连接资源专项：**8/8**；TCP 故障代理专项：**4/4**。
- NestJS E2E：**17/17（3 个文件）**。其中主动模拟关闭的 HTTP 503 / Terminus Health Check 失败日志属于预期负面测试，不是失败。
- Vue、React、NestJS 类型检查及构建全部通过；日志显示 React 3899 个模块、Vue 3844 个模块完成构建，NestJS 服务端构建完成。
- `pnpm run test:sse:browser`：React、Vue 的 SSE 心跳、Tag 过期、静默重连和资源清理通过，**退出码 0**。
- `pnpm run test:sse:fault:browser`：React、Vue 的真实 TCP 下行阻断、STALE、主动重连和连接回收通过，**退出码 0**。该浏览器脚本同时检查诊断面板存在、四档质量总数与可见 Tag 数一致、STALE 统计和重连过程计数。

**本批 Windows 自动化质量链与双框架浏览器回归通过。** 浏览器自动化断言已覆盖诊断面板的数据一致性；维护者尚未单独报告手工视觉验收或 Tauri 桌面人工验收，因此不将两项标记为完成。

诊断的 `dataAgeMs` 仍只代表本机接受有效 Tag 后经过的时间，不是 PLC 采样延迟或网络 RTT；`reconnectCount` 是去重后的连续断连过程数，不是实际 TCP 重建计数。生产认证、真实工业网关、PostgreSQL 真库、历史诊断持久化及工业现场尚未验收。

本段为验收记录追加后，**尚未重新执行最新文档的 `vp check` / `docs:check`**；建议合并审查前再运行一次。PR #49 继续保持 Draft，Assignee `@adui-dev`，未经明确授权不得合并。

## 2026-11-13 · V0.3 第二十八批状态事件时间线验收清单（待实测）

- [ ] `pnpm run test:runtime`：`RuntimeStatusHistory` 相同状态去重、20 条容量、同毫秒唯一序号、状态快照隔离、重新启动清空及离线 simulation 回归。
- [ ] `vp check`：格式、Lint、类型检查零告警、零错误。
- [ ] `pnpm run docs:check`：工程 Markdown 静态链接及结构检查通过。
- [ ] `pnpm run ready`：全量 Vitest、Node SSE 资源和 TCP 故障代理、NestJS E2E、Vue/React/NestJS 类型检查与构建通过；记录实际退出码。
- [x] `pnpm run test:sse:browser`：维护者 Windows 实测 React/Vue 两端均输出心跳、Tag 过期、静默重连及资源清理通过，**命令退出码 0**；浏览器脚本包含 live → stale → reconnecting → live 与事件上限断言。
- [x] `pnpm run test:sse:fault:browser`：维护者 Windows 日志显示 React/Vue 两端均输出 TCP 下行阻断、STALE、主动重连与连接回收通过；**未提供该命令的独立退出码**，待补充确认。
- [ ] Tauri 桌面端人工视觉验收与实际部署；单元测试不等于 MSI 安装已验证。
- [ ] 工业报警持久历史、生产身份鉴权、真库、PLC 时钟同步、长时高并发及工业现场：本批未验证。

本次状态事件仅是当前本机会话内存中的有界观察结果；不得宣传为工业报警中心、生产审计记录或真实设备事件历史。见 [ADR-0060](adr/0060-runtime-session-status-history.md)。

### 第二十八批 Windows 双框架 SSE 浏览器回归（2026-11-14）

维护者提供 PowerShell 实测日志，当前分支针对第二十八批状态时间线功能执行：

- `pnpm run test:sse:browser`：React `127.0.0.1:15173` 与 Vue `127.0.0.1:15174` 均输出“浏览器 SSE 心跳保活、Tag 过期、静默重连、资源清理通过”，**明确退出码 0**。脚本额外断言共享状态时间线初始 live、Tag 过期 stale、传输静默 reconnecting 与快照恢复 live，以及会话内事件上限。
- `pnpm run test:sse:fault:browser`：React/Vue 两端均输出“真实 TCP 下行阻断、STALE、主动重连及连接回收通过”。提供的输出到此结束，**未附 `Write-Host "TCP 故障退出码：$LASTEXITCODE"`**，因此只确认两端成功信息及脚本未输出错误，**暂不记录该命令的实际退出码**。

**仍待 Windows 实测**：`pnpm run test:runtime`、`vp check`、`pnpm run docs:check`、完整 `pnpm run ready`；以及手工 UI 和 Tauri 桌面验证。上述浏览器测试不能证明 Node/Vitest、Lint、类型、全量构建、真实工业网络、生产报警持久化已完成。

本次仅补充验收文档与 PR 说明，无业务代码变更。新增文档提交后的格式及文档静态检查仍待执行；PR #50 保持 Draft，需维护者明确授权方能合并。

## 2026-11-14 · V0.3 第二十九批 Tag 定义目录验收清单（待执行）

- [x] `pnpm run test:unit`：维护者 Windows 实测 **426/426（38 文件），退出码 0**；新增 Tag 定义测试 **6/6**，覆盖定义白名单、稳定 ID、目录副本、类型与质量独立和原子拒绝。
- [x] `pnpm run test:runtime`：维护者 Windows 实测 **40/40（4 文件），退出码 0**；诊断测试 **8/8**，包含 Runtime 收到不匹配类型后进入 error。
- [x] `vp check`：维护者 Windows 实测 **267 个文件格式正确，133 个受检文件零警告/错误**；完整 `ready` 内同项再次通过。
- [x] `pnpm run docs:check`：维护者 Windows 实测 **77 个 Markdown 文件通过**；完整 `ready` 内再次通过。
- [x] `pnpm run ready`：维护者 Windows 实测 **退出码 0**；全量 Vitest **426/426**、SSE 资源 **8/8**、TCP 故障代理 **4/4**、NestJS E2E **17/17**，React/Vue/NestJS 类型检查与构建通过。
- [ ] React/Vue Studio 人工检查三项演示 Tag 的数据类型、单位、描述与稳定 ID 显示一致，绑定/撤销/导入导出不变。
- [x] `pnpm run test:sse:browser` 与 `pnpm run test:sse:fault:browser`：维护者 Windows 实测 React/Vue 均通过心跳、Tag 过期、静默重连、TCP 阻断、STALE 及连接回收，两项命令**退出码均为 0**。
- [ ] 项目级 Tag 元数据持久化、Schema 迁移、地址映射、驱动配置、PLC/DCS、工业现场：不属于本批交付。

本批 FR-004 仅部分实现；代码内演示目录的重命名不持久化，TagQuality 仍属于动态 TagValue，不得把元数据校验宣传为生产 Tag 配置中心。详见 [ADR-0061](adr/0061-tag-definition-catalog.md)。

### 第二十九批首轮 Windows 格式检查阻塞与修复（2026-11-14）

维护者运行 `vp check --fix` 时，React Studio `StudioPage.tsx:2016` 出现 JSX 解析错误：`bindingSlot` 三元表达式的分支中相邻的 `label` 和条件段落未使用单一根节点，导致格式检查在解析阶段失败。**本次检查未通过，也没有执行后续 Lint、类型或构建验收**。

现已在 PR #51 分支用 React Fragment 包裹两段 JSX，并同步整理缩进。额外修正 Core 测试对 `readonly displayName` 的直接写入，以及 Vue 未选 Tag 时的错误提示。修复已提交 GitHub，**维护者尚未重新执行 `vp check --fix` / `vp check` / `pnpm run ready`**；不得宣称修复已经通过 Windows 实测。

### 第二十九批 Windows `ready` 检查 TS1294 阻塞与修复（2026-11-14）

维护者本轮执行 `pnpm run ready` 的实际结果：

- **已通过**：依赖 Catalog 检查（11 个清单、51 项）、共享配置（9 个 TSConfig 消费端）、统一环境和 LF、中文文案（159 个自有文件）、Prisma Client 7.10.1 生成、`@adui/scada-core` Node 构建（`tsc -p tsconfig.build.json`）、`vp check`（267 文件格式正确，133 个受检文件零警告、Lint 错误和类型错误）。
- **首次失败**：`typecheck:web` 阶段的 `tsc --build` 报 `TS1294`，定位 `packages/core/src/tag-store.ts:60` 的 `constructor(private readonly catalog?: TagDefinitionCatalog) {}`。项目启用 `erasableSyntaxOnly`，不允许该参数属性语法。`ready` 因此中断，**不能宣称单测、E2E、文档检查或 Web/Server 构建通过**。
- **已修复但尚待复验**：在同一 Draft PR #51 分支将上述参数属性替换为显式 `private readonly catalog?: TagDefinitionCatalog` 字段及 `constructor(catalog?: TagDefinitionCatalog) { this.catalog = catalog; }`。对外调用方式、目录可选行为及 TagStore 原子校验逻辑未改变；未升级依赖、修改 tsconfig、变更业务协议。
- **后续验证**：维护者同步分支后重跑 `pnpm run ready`，记录真正执行到单测、NestJS E2E、docs 和双框架构建的结果；必要时分别执行 `pnpm run test:runtime` 和 React/Vue SSE 浏览器回归。

本段仅记录实际日志与代码修复，不代表修复后的 `ready` 已通过。PR 继续保持 Draft 和 `@adui-dev` 指派，未经明确合并授权不合并。

### 第二十九批 Windows 完整质量链复验通过（2026-11-14）

维护者上传最新完整 PowerShell 日志，确认此前 React JSX 分支解析错误与 `TagStore` 的 `TS1294` 参数属性错误已消除；`pnpm run ready` 已从头执行至最后的 NestJS 构建并返回 **退出码 0**：

- 单独 `pnpm run test:unit`：**426/426 通过（38 个文件），明确退出码 0**。其中新增 `tag-definition.test.ts` **6/6**，包括定义校验、稳定 ID、重命名、原子拒绝及动态质量。
- 单独 `pnpm run test:runtime`：**40/40 通过（4 个文件），明确退出码 0**。其中 `diagnostics.test.ts` **8/8**，包含错误值类型被 Runtime 拒绝的回归。
- `vp check`：**267 个文件格式正确、133 个受检文件零警告、Lint 错误或类型错误**；`pnpm run docs:check`：**77 个 Markdown 文件检查通过**。
- `pnpm run ready`：**退出码 0**；依赖 Catalog **11 个清单 / 51 项**、共享配置 **9 个 TSConfig 消费端**、环境/LF、中文文案 **159 个自有文件**、Prisma Client **7.10.1**、Core Node 构建、React/Vue/草稿存储与 NestJS 类型检查均通过。
- `ready` 中全量 Vitest 再次 **426/426（38 文件）**，Node SSE 连接资源 **8/8**、TCP 故障代理 **4/4**、NestJS E2E **17/17（3 文件）**，React **3900 个模块**和 Vue **3845 个模块**完成构建，NestJS 服务端构建结束。
- E2E 日志中预期的 HTTP 503、Health Check 失败由负面测试产生，不代表 E2E 失败；最终 **17/17 通过**。

**尚待本批专项实测**：React/Vue Studio 手工检查水位/水泵/流量 Tag 的类型、单位、描述和绑定撤销/导入导出，以及 `pnpm run test:sse:browser` 与 `pnpm run test:sse:fault:browser`。本轮 `ready` 不包含浏览器测试。Tauri 桌面人工测试、项目级 Tag 持久化、工业驱动、真实设备和工业现场同样不在本批已验证范围。

以上是**维护者 Windows 实测日志**，不是当前协作环境自行执行的结果。本次只新增验收文档记录；**最新文档提交后的 `vp check` / `docs:check` 尚未再次执行**。PR #51 保持 Draft，Assignee `@adui-dev`，未经明确授权不合并。

### 第二十九批 Windows 双框架 SSE 浏览器与最新静态检查通过（2026-11-14）

维护者在第二十九批 Tag 目录类型校验修复后再次执行本机检查，实际日志确认：

- `vp check`：**267 个文件格式正确，133 个受检文件零警告、Lint 错误和类型错误**。
- `pnpm run docs:check`：**77 个 Markdown 文件静态检查通过**。
- `pnpm run test:sse:browser`：React `http://127.0.0.1:15173`、Vue `http://127.0.0.1:15174` 均输出 SSE 心跳保活、Tag 过期、静默重连和资源清理通过，**退出码 0**。
- `pnpm run test:sse:fault:browser`：React/Vue 均输出真实本机 TCP 下行阻断、STALE、主动重连与连接回收通过，**退出码 0**。

结合上一轮完整 `pnpm run ready` **退出码 0**、全量 Vitest **426/426**、Runtime **40/40**、NestJS E2E **17/17**，本批自动化质量链及双框架 SSE 专项已得到 Windows 实测通过。

**未验收内容**：React/Vue Studio 手工检查三项演示 Tag 的类型、单位、描述、稳定 ID、绑定撤销、工程导入导出；Tauri 桌面人工回归；项目级 Tag 持久化、真实工业协议和现场设备。浏览器 SSE 通过不等于 Studio Tag 管理 UI 已人工确认。

本次仅更新验收文档及 PR 正文，不改变业务代码。**上述日志对应文档更新前的分支；最新验收文档提交后的 `vp check` / `docs:check` 尚未重跑**。PR #51 保持 Draft，指派 `@adui-dev`，未经维护者明确授权不得合并。

## 2026-11-14 · V0.3 第三十批：项目级 Tag 定义持久化与 Schema 0.3.0（待 Windows 验收）

实施分支：`feat/v0.3-project-tag-definitions`。基线为第二十九批 PR #51 合并提交 `69f36d6`。本批首次将项目 Tag 定义写入工程 Schema；**不得沿用第二十九批的 426/426、40/40、17/17 或 SSE 浏览器结果作为本批验收证据**。

- [x] `pnpm run test:unit`：Windows 单独实测 438/438 通过（38 文件），验证 0.1.0/0.2.0 历史工程迁移、0.3.0 Tag 目录白名单、绑定引用完整性、Tag 编辑命令撤销/重做、历史快照摘要与本地草稿恢复。
- [x] `pnpm run test:runtime`：Windows 单独实测 40/40 通过（4 文件），验证在线 Runtime、离线模拟和独立演示服务均使用当前工程 Tag 目录，实时值类型拒绝保持原子性，TagQuality 仍由 TagValue 动态表达。
- [x] `pnpm run test:e2e:server`：Windows 单独实测 17/17 通过（3 文件），确认现有 NestJS 只读边界和健康检查无回归；不把 E2E 结果解释为生产数据库或工业网关已实现。
- [x] `vp check`：Windows 实测 268 个文件格式正确、133 个受检文件零警告、Lint 和 TypeScript 错误。
- [x] `pnpm run docs:check`：Windows 实测 78 份 Markdown 文档静态检查通过（最新验收文档追加后尚未重跑）。
- [x] `pnpm run ready`：Windows 日志已执行至最终 NestJS 构建完成，期间 438/438 Vitest、Node SSE 8/8、TCP 故障 4/4、NestJS E2E 17/17、React/Vue/NestJS 类型检查与构建全部完成；未单独打印最终退出码，不将其记作显式证据。
- [ ] `pnpm run test:sse:browser`：React/Vue 心跳、Tag 过期、静默重连和连接回收通过。
- [ ] `pnpm run test:sse:fault:browser`：React/Vue TCP 故障注入、STALE、主动重连和连接回收通过。
- [ ] 人工检查 React/Vue Studio：绑定候选来自当前工程目录；按共享槽位类型筛选；展示名称、稳定 ID、类型、单位和描述一致；历史 unknown Tag 不作为新绑定候选；导入/导出往返保留 tags 与原绑定。
- [ ] 历史兼容检查：0.1.0/0.2.0 工程升级后原绑定不变、unknown 占位不猜测类型；未来版本和非法结构明确拒绝；IndexedDB 迁移事务推进 revision；历史快照原始摘要校验不被绕过。

**当前验收状态：** 维护者在 Windows 提供本批第三十批完整测试日志，单测、Runtime、E2E、Vite+ 检查、文档检查及完整 `ready` 已通过各自输出；浏览器 SSE 两条命令因旧的 0.2.0 模拟服务而在 React 预检查阶段失败，尚未运行至 Vue 回归。人工 UI、历史持久化实环境集成及本节新增文档的最终静态复验仍待执行。

**明确不属于本批：** 完整 Tag 管理表单、Prisma Tag 表、生产项目保存 API、身份认证/多人协作、OPC UA/Modbus/MQTT 地址映射、工业网关和设备写入；Tauri 安装包也不作为本批自动化验收结论。

### 第三十批首次 Windows `vp check --fix` 类型检查阻塞及修复（2026-11-14）

维护者执行 `vp check --fix` 后，工具报告格式化处理已完成，但类型检查失败（**2 个错误、0 个警告**）：

- `packages/core/src/project-snapshot.ts:260`：`TS2345`，历史快照迁移分支构造的 `snapshot` 与 `ProjectSnapshot` 参数类型不一致。
- `packages/core/src/project-snapshot.ts:261`：`TS2322`，`deepFreeze(snapshot)` 的结果类型无法赋值给 `ProjectSnapshot`。
- **共同根因**：原迁移分支的 `payload` 对象属性 `migratedFrom` 被拓宽推断为 `string`，而公共快照契约仅允许 `"0.1.0" | "0.2.0"`。

已在 PR #52 中仅将该分支声明改为 `const payload: Omit<ProjectSnapshot, "contentHash"> = { ... }`，不改变历史源 SHA-256 校验、迁移元数据、快照大小约束或业务流程。修复提交为 `757d5012`。独立 TypeScript 5.8.3 严格编译最小复现确认原始类型拓宽报错与显式约束方案的编译行为，**不能替代完整仓库检查**。

**待复验**：同步最新分支后重跑 `vp check`、`pnpm run test:unit`、`pnpm run docs:check` 与 `pnpm run ready`。本批所有完整质量链与浏览器验收仍保持待执行；不可将格式化完成视为类型检查通过。

### 第三十批 Windows 完整质量链首次复验失败与修复（2026-11-14）

维护者提供完整 PowerShell 日志；该轮执行发生在本节修复提交之前：

- **通过**：`vp check` 显示 **268 个文件格式正确、133 个受检文件零警告/Lint/类型错误**；`pnpm run docs:check` **78 份 Markdown 通过**。`ready` 内依赖 Catalog 11 个清单 / 51 项、共享配置 9 个 TSConfig、环境与 LF、中文文案 159 个文件、Prisma Client 7.10.1、Core 构建、React/Vue/Draft Storage/NestJS 类型检查均已通过。
- **`ready` 未通过**：全量 Vitest 报 **38 个文件中 36 通过、2 失败；433 个测试中 432 通过、1 失败**。其中 `packages/core/test/svg.test.ts` 在加载时因当前 0.3.0 测试文档缺少必填 `tags` 导致测试套件失败（0 项测试运行）；`packages/core/test/document.test.ts` 的历史工程测试将版本设为 0.1.0 但仍保留 0.3.0 的 `tags`，被严格根字段校验优先拒绝，未执行至预期的非法组合断言。后续 SSE 资源测试、NestJS E2E、Web/Server 构建没有运行到完成，不得标记通过。
- **浏览器 SSE 未通过**：`test:sse:browser` 与 `test:sse:fault:browser` 都在 React 启动阶段进入 `error`，EventSource 连接列表为空且 Tag 数量为 0，两个命令均以失败结束，**未执行到 Vue 回归**。从未创建 EventSource 只能判断故障位于订阅启动之前；旧模拟进程返回上一版 Schema 只是可能原因，尚无接口内容证据，不能直接归因。
- **已提交修复**：在 `svg.test.ts` 增加符合 Schema 0.3.0 的 Tag 定义；在 `document.test.ts` 正确移除旧工程不支持的根 `tags` 字段，同时调整其他旧版夹具，避免假阳性；在 `test-runtime-sse-browser.mjs` 校验 `/demo/project` 返回的版本和 Tag 目录，超时诊断附带实际 Runtime 错误消息。未放宽工程解析安全边界，也未更改生产 Tag 质量或设备访问。
- **待复验**：维护者同步最新分支后重新执行 `pnpm run test:unit`、`vp check`、`pnpm run docs:check`、`pnpm run ready`；停止旧的 `dev:demo` 进程后重新启动当前分支模拟服务、React/Vue 开发服务，分别复测 `pnpm run test:sse:browser`、`pnpm run test:sse:fault:browser`。应记录 `/demo/project` 实际 Schema 和错误消息，不得在 SSE 故障未定位前称本批验收完成。

本记录仅使用维护者日志描述修复前的结果；新增提交后的完整质量链尚未在本协作环境实测。PR #52 继续保持 Draft、指派 `@adui-dev`，未经授权不得合并。

### 第三十批 Windows 第二轮质量链通过，SSE 旧服务版本已明确（2026-11-14）

维护者在 `feat/v0.3-project-tag-definitions` 提供最新 PowerShell 实测日志：

- `pnpm run test:unit`：**38 文件、438/438 测试通过**，之前 `svg.test.ts` 加载失败和 `document.test.ts` 历史夹具失败均已消除。
- `pnpm run test:runtime`：**4 文件、40/40 通过**；单独 `pnpm run test:e2e:server`：**3 文件、17/17 通过**。E2E 日志中的 HTTP 503 和 Health Check 失败是主动模拟的负面用例，最终测试结果仍通过。
- `vp check`：**268 文件格式正确，133 个受检文件零警告、Lint 或类型错误**。`pnpm run docs:check`：**78 份 Markdown 通过**。
- `pnpm run ready` 从依赖 Catalog 11 个清单/51 项、配置 9 个 TSConfig、环境、中文文案、Prisma Client 7.10.1、Core/双端/NestJS 类型检查开始，完成全量 Vitest **438/438**、Node SSE 资源 **8/8**、TCP 故障代理 **4/4**、NestJS E2E **17/17**、React 构建 **3900 模块**、Vue 构建 **3845 模块**及最后的 NestJS 服务构建；日志未再报告失败。**此轮未附独立的 `ready` 退出码打印**，不把未展示的退出码记为实测数值。
- `pnpm run test:sse:browser` 和 `pnpm run test:sse:fault:browser` **仍失败（退出码 1）**。新预检查直接读取 `http://127.0.0.1:15173/demo/project`，发现实际返回 **Schema `0.2.0` 且缺少 `tags`**，与当前 `0.3.0` 工程契约不一致。两项测试在 React 预检查即停止，**未进入 Vue 浏览器验收、故障注入和回收阶段**。
- 目前确定的是**当前 Vite 代理所连接的模拟服务返回旧版工程文档**，而不是 Core 解析器需要放宽校验；是否因旧 Node 进程、代理指向错误目录或端口不匹配仍需本机进程信息才能进一步确认。应先核对监听进程及当前 `/demo/project` 响应，停掉确认属于该工程的旧 Demo 进程并重启 `pnpm run dev:demo`。再次确认模拟接口 Schema 为 `0.3.0`、包含三项 Tag 定义后，分别重跑两项 SSE 浏览器脚本。

**未完成**：React/Vue 双端 SSE 浏览器专项；Studio 人工查看、0.1/0.2 工程导入导出、真实旧 IndexedDB/localStorage 草稿与历史快照迁移体验、Tauri 人工验收。该日志不代表生产数据库、工业网关、现场设备或设备写入已验收。以上是维护者在文档更新前的 Windows 实测；此文档更新后的静态检查尚未重跑。PR #52 继续 Draft、Assignee `@adui-dev`，没有合并授权。

### 第三十批 Windows 最终自动化验收通过（2026-11-14）

维护者在本地 Windows 提供第三十批最新复验日志（先前 Schema `0.2.0` 的旧 Demo 服务已排除）。本节是**维护者执行记录**，并非 GitHub 文档提交后的自动化重新执行：

- `pnpm run test:unit`：38 文件，**438/438 通过**；`pnpm run test:runtime`：4 文件，**40/40 通过**；`pnpm run test:e2e:server`：3 文件，**17/17 通过**。
- `vp check`：268 个文件格式正确，133 个受检文件零格式、Lint、类型错误；`pnpm run docs:check`：78 个 Markdown 文件通过。
- `pnpm run ready`：从依赖目录、共享配置、环境、中文文案、Prisma 生成、Core 构建与全栈类型检查，执行至单测（438/438）、SSE 客户端资源测试（8/8）、TCP 故障代理（4/4）、NestJS E2E（17/17）、React（3900 模块）和 Vue（3845 模块）构建及最后 NestJS build，日志无失败。此轮并未单独打印 `ready` 的退出码，不额外编造。
- **`pnpm run test:sse:browser`**：React 和 Vue 都明确输出心跳保活、Tag 过期、静默重连、资源清理通过。
- **`pnpm run test:sse:fault:browser`**：React 和 Vue 都明确输出真实 TCP 下行阻断、STALE、主动重连及连接回收通过，两个浏览器脚本最后的 `$LASTEXITCODE` 为 **0**。因此上一轮因模拟工程接口返回 0.2.0 导致的浏览器回归阻塞已在重启正确版本的服务后解除。
- NestJS E2E 期间出现的预期 HTTP 503 / Health Check 失败属于负面测试分支，不是 E2E 总体失败。

**仍需独立验收（不阻止维护者本次明确授权的代码合并）**：Vue/React Studio 手工目录与绑定交互、历史 Schema JSON 跨框架导入导出、真正旧浏览器 IndexedDB/localStorage 草稿和历史快照迁移体验。真实工业网关、生产采集、现场控制、设备写入不在第三十批范围。

本节只更新验收事实与 PR 描述，不更改已通过测试的业务代码；文档更新后的 `vp check` / `docs:check` 未重新执行。

## 2026-11-14 · V0.3 第三十一批：项目 Tag 双框架可视化管理（待验收）

基线：PR #52 已合并到 main（5781d690）；实施分支为 feat/v0.3-studio-project-tag-management。第三十批 438/438 等通过记录不能沿用为第三十一批新增 UI 的验证结果。

- [ ] vp check：新建 React TSX、Vue SFC、Studio 接线、CSS 与脚本的格式、Lint、TypeScript 检查。
- [ ] pnpm run docs:check：检查本批新增 ADR 与相关文档。
- [ ] pnpm run test:unit：原有共享 Editor Tag CRUD 与 Schema 校验回归。
- [ ] pnpm run ready：React/Vue/NestJS 类型检查、单测、E2E 和 Web/Server 构建全链。
- [ ] pnpm run test:tags:browser：React/Vue 两端 Tag 新建、编辑、删除保护、删除及实际工程 JSON 断言。
- [ ] pnpm run test:interop：React→Vue→React 项目 JSON 往返，包括 tags 稳定 ID 和元数据。
- [ ] 人工 UI：表单控件、暗/亮主题、键盘焦点、ID 禁止修改、unknown 类型确认、非法字段/重复 ID/类型不兼容提示、删除确认。
- [ ] 草稿与历史：Tag 变更撤销重做、浏览器草稿保存恢复、实际旧 0.1/0.2 工程与旧 IndexedDB/localStorage 草稿迁移。
- [ ] 与第三十批 SSE 运行时互不干扰（按需要复跑 test:sse:browser 与 test:sse:fault:browser）。

**验收状态**：本协作环境已经完成分支上的实现和静态代码审查，未运行本批 Windows Vite+ 测试或真实浏览器自动化，不报告测试通过。生产工业协议、现场设备与写入仍不在范围。Draft PR 未经授权不得合并。

### 第三十一批 Windows 首轮质量链通过与 Tag 浏览器测试时序修复（2026-11-14）

维护者提供 Windows PowerShell 实测日志：

- `vp check`：271 个文件格式正确，135 个受检文件零警告、Lint 或 TypeScript 错误。
- `pnpm run docs:check`：79 份 Markdown 通过。
- `pnpm run ready`：依赖目录 11 清单/51 项、共享配置 9 TSConfig、环境与 LF、中文文案 161 文件、Prisma Client 7.10.1、Core 构建、React/Vue/Draft Storage/Server 类型检查、Vitest **438/438**、SSE 客户端 **8/8**、TCP 故障代理 **4/4**、NestJS E2E **17/17**、React 构建 **3901 模块**、Vue 构建 **3847 模块**和 NestJS 构建均完成；日志末尾未报告失败。
- `pnpm run test:interop`：React → Vue、Vue → React 的工程 JSON / 页面 / 图元 / Tag 绑定往返通过，双端非法 JSON 导入保护通过，退出码 **0**。
- `pnpm run test:tags:browser`：React 新增、编辑、导出 JSON、绑定 Tag 删除保护检查中失败，输出 `React 未说明已绑定 Tag 的删除保护`，退出码 **1**。这不是完整 Tag UI 通过记录，也没有执行到 Vue。
- **根因（测试断言时序）**：测试点击删除绑定中的 `water.level` 后先导出 JSON，再读取状态栏提示。导出操作会更新状态栏成功文案，覆盖之前的 Core 删除拒绝提示；测试因此读取到导出提示，而不是 `Tag water.level 仍被 1 个图元槽绑定`。Core `DocumentEditor.removeTagDefinition` 仍在删除前统计所有页面绑定并拒绝删除，业务逻辑无需放宽。
- **已提交修复**：`scripts/test-studio-browser.mjs` 在点击删除后轮询并先断言状态栏包含“仍被…绑定”，捕获提示后再导出 JSON 检查 Tag 仍存在；失败信息附带实际状态栏文案。该修复仅调整浏览器测试时序，不改变 UI 或 Core 行为。

**待复验**：维护者同步最新提交后重跑 `pnpm run test:tags:browser`，确认 React 与 Vue 两端均输出成功；随后重跑 `vp check`、`pnpm run docs:check`（本记录更新后）及必要的 `pnpm run ready`。本协作环境未执行本批本地命令，不把修复提交视为测试通过。第三十一批仍保持 Draft。

### 第三十一批最终 Windows Tag 管理浏览器回归通过（2026-11-14）

维护者在修复浏览器断言时序后重新执行并提供实测日志：

- `pnpm run test:tags:browser`：React 项目 Tag 新增、编辑、绑定删除保护、删除与 JSON 往返通过；Vue 同样通过；命令退出码 **0**。
- `vp check`：**271 个文件格式正确，135 个受检文件零警告、Lint 或 TypeScript 错误**。
- `pnpm run docs:check`：**79 个 Markdown 文件通过**（本节验收记录追加后尚未重新执行）。
- 此前同一分支的 `pnpm run ready` 已执行完成，Vitest 438/438、SSE 客户端 8/8、TCP 故障代理 4/4、NestJS E2E 17/17、React/Vue 类型检查和构建均通过；`pnpm run test:interop` 双框架工程 JSON 往返及非法导入保护通过，退出码 0。

本批浏览器 CRUD 专项此前的失败是脚本先导出 JSON、再读取状态栏，导出提示覆盖删除拒绝提示；修复后已由 React、Vue 两端真实浏览器操作复验通过。Core 删除保护没有放宽。

**尚未单独完成的人工验收**：键盘无障碍与视觉细节、真正旧 0.1/0.2 工程和历史 IndexedDB/localStorage 草稿迁移的用户体验复验。以上不改变本次已通过的自动化结果。工业现场设备、网关、设备写入不属于本批。

## 2026-11-14 · V0.3 第三十二批：旧工程与浏览器持久化迁移（待 Windows 验收）

实施分支：feat/v0.3-browser-legacy-project-migration，基线为 PR #53 合并提交 7fccc1e2。

- [ ] vp check：新浏览器脚本格式、Lint、类型检查。
- [ ] pnpm run docs:check：ADR-0064 与本批文档静态检查。
- [ ] pnpm run test:unit：现有 Core 迁移、Project Snapshot 摘要和 Dexie 事务回归。
- [ ] pnpm run ready：完整依赖、类型、单测、E2E 与双框架构建。
- [ ] pnpm run test:legacy:browser：React/Vue 的 localStorage 0.2.0 草稿迁移、旧副本清理、IndexedDB revision 4→5 事务迁移、旧 Project Snapshot SHA-256 校验与只读归一化。
- [ ] pnpm run test:interop：迁移后的工程 JSON 双向互通。
- [ ] 人工确认历史 unknown Tag 明确显示待确认，不推断类型/单位；旧快照原记录保持不变；迁移失败保留原始数据。
- [ ] 视改动情况复跑 pnpm run test:tags:browser，确保第三十一批 Tag CRUD 不回归。

**当前验收状态**：本批只提交真实浏览器测试代码和文档，尚未在维护者 Windows 环境运行；不继承第三十、三十一批的测试结果。没有修改迁移业务实现、Schema、Dexie 数据库版本、快照格式或工业设备访问。

### 第三十二批首轮浏览器迁移测试阻塞与 IndexedDB 夹具修复（2026-11-14）

维护者首轮执行 `pnpm run test:legacy:browser`：React 的 localStorage 0.2.0 草稿迁移、旧副本清理和 Studio 恢复已通过；随后在注入 IndexedDB 历史草稿时失败，退出码 1：

`VersionError: The requested version (1) is less than the existing version (10).`

**根因**：Dexie 的 `database.version(1)` 逻辑版本映射为原生 IndexedDB 版本 10；测试夹具错误调用 `indexedDB.open("adui-scada-studio", 1)`，将 Dexie 逻辑版本误用为原生版本，触发降级请求。历史快照夹具也有同样的错误调用，必须一并修复。

**已提交修复**：两个测试夹具现在先通过 `indexedDB.databases()` 确认数据库已由实际 Studio/Dexie 仓储初始化，再调用不带版本参数的 `indexedDB.open(name)`，并校验现有 object stores；不再在测试夹具中自行升级或创建已存在数据库的 stores。草稿库由 localStorage 迁移步骤初始化；历史快照库先通过 Studio 版本菜单初始化并确认为空，随后关闭菜单、注入旧快照，再重新打开菜单刷新列表。此改动只修正测试夹具，不改变 Dexie 数据库版本、迁移业务代码或 SHA-256 校验。

**待维护者复验**：同步最新分支后重新执行 `pnpm run test:legacy:browser`。目前仅确认 localStorage 路径通过；IndexedDB 草稿和历史 Project Snapshot 路径尚未获得通过日志，Vue 端也尚未开始。不得把测试夹具修复提交等同于迁移验收通过。

### 第三十二批 Project Snapshot 浏览器注入函数作用域修复（2026-11-14）

维护者第二轮执行 `pnpm run test:legacy:browser`：

- React localStorage 0.2.0 草稿迁移、旧副本清理和 Studio 恢复：通过。
- React IndexedDB 0.2.0 草稿事务迁移、revision 推进和 Studio 恢复：通过。
- Project Snapshot 注入阶段失败：`ReferenceError: stableLegacyValue is not defined`，退出码 1；尚未进入快照读取、SHA-256 校验及 Vue 路径。

**根因**：`evaluateStudioPage` 通过 `action.toString()` 将单个函数序列化后在浏览器页面执行，不会携带 Node 脚本作用域的闭包。快照注入函数引用了外部 `stableLegacyValue`，在页面上下文中不可见。

**已提交修复**：将与 Core `project-snapshot.ts` 中 `stableValue` 一致的递归对象键排序函数内聚到 `seedLegacyProjectSnapshotInPage` 内部。它对数组递归映射、对对象按键排序并创建无原型对象，计算 SHA-256 前不再引用外部函数。Core 摘要算法、快照容器、迁移逻辑和持久化数据均未改变。

**待复验**：同步最新提交后重新运行 `pnpm run test:legacy:browser`。当前仅 React 的 localStorage 和 IndexedDB 草稿路径获得通过日志；Project Snapshot 和 Vue 三条路径均未完成验收。不得将函数作用域修复视为浏览器测试通过。

**补充清理**：稳定排序函数现仅保留在浏览器注入函数内部，已删除原 Node 模块作用域的未使用 helper，避免重复实现和未使用声明。函数片段已静态核对为自包含；仍需 Windows 实际执行确认。

### 第三十二批 Windows 历史迁移与互通最终浏览器回归通过（2026-11-14）

维护者提供的最新 Windows PowerShell 日志确认：

- `pnpm run test:legacy:browser`：**退出码 0**。React 与 Vue 两端分别通过 localStorage 0.2.0 草稿迁移、旧副本清理和 Studio 恢复；IndexedDB 0.2.0 草稿事务迁移、revision 推进和恢复；Project Snapshot 原 SHA-256 校验、只读归一化及原始记录保留。六条浏览器迁移路径全部通过。
- `pnpm run test:interop`：React → Vue、Vue → React 工程 JSON、页面、图元和 Tag 绑定一致；非法 JSON 导入被拒绝且现有工程不变；完整 React → Vue → React → Vue 往返通过，**退出码 0**。
- `vp check`：**272 个文件格式正确；135 个受检文件零警告、Lint 和 TypeScript 错误**。
- `pnpm run docs:check`：**80 个 Markdown 文件通过**（本次验收记录追加后尚未重跑）。
- `pnpm run ready`：日志已确认依赖 Catalog 11 清单/51 项、共享配置 9 TSConfig、环境/LF、中文文案 161 文件、Prisma Client 7.10.1、Core 构建、React/Vue/Draft Storage/Server 类型检查、Vitest **438/438**、SSE 客户端 **8/8**、TCP 故障代理 **4/4**、NestJS E2E **17/17**、React 构建 **3901 模块**、Vue 构建 **3847 模块**均通过。所提供日志最后到达 NestJS `build:server` 的 Prisma Client 生成，未包含 Nest build 完成输出或 `ready` 最终退出码，因此**完整 ready 的最终成功尚未由该片段单独证明**，不能记为全链明确通过。

**结论**：第三十二批核心历史迁移浏览器专项与跨框架互通已通过；静态检查通过。尚需补齐 `ready` 的最终 NestJS build 完成/退出码证据，并在验收文档更新后复跑 `docs:check`。本批不更改迁移业务代码、Schema、Dexie 数据库版本或快照格式。

### 第三十二批完整质量链最终退出码确认（2026-11-14）

维护者补充提供 `pnpm run ready` 最终 PowerShell 退出码：**0**。结合前述同一轮完整日志，依赖 Catalog、共享配置、环境与中文文案检查、Prisma Client 生成、Core 构建、全栈类型检查、Vitest **438/438**、SSE 客户端 **8/8**、TCP 故障代理 **4/4**、NestJS E2E **17/17**、React/Vue 构建及 NestJS 最终构建均已完成，第三十二批完整 `ready` 质量链确认通过。

结合前述 Windows 实测：`test:legacy:browser` 六条 React/Vue 历史迁移路径全部通过（退出码 0），`test:interop` 跨框架互通通过（退出码 0），`vp check` 272 文件格式正确/135 受检文件零错误，`docs:check` 80 Markdown 通过。此后追加的验收文档更新尚未再次执行 `docs:check`，故 80 份是维护者本轮执行时的实际数量，不表示新增记录后的数量。

### 第三十二批最终验收状态（维护者授权合并前确认）

**本节覆盖并取代本文件此前第三十二批条目中的“待 Windows 验收”“待复验”状态。** 维护者最终提供完整实测证据：

- `test:legacy:browser`：React/Vue 两端 localStorage、IndexedDB 草稿、Project Snapshot 六条路径全部通过，退出码 0。
- `test:interop`：双框架完整工程往返及非法导入保护通过，退出码 0。
- `vp check`：272 文件格式正确、135 个受检文件零错误。
- `docs:check`：80 个 Markdown 文件通过。
- `pnpm run ready`：维护者补充最终退出码 0；全量 438/438 单测、SSE 客户端 8/8、TCP 故障代理 4/4、NestJS E2E 17/17、React/Vue 类型检查与构建、NestJS 最终构建完成。

第三十二批自动化验收通过，维护者已明确授权 PR #54 合并。历史 Tag 未知类型仍保持 unknown，旧绑定和历史快照原始记录均通过浏览器断言确认保留。本批不代表生产工业网关、现场 PLC/DCS 或设备写入能力已验收。

## V0.3 第三十三批：厂商无关 OIDC 与服务端工程 API（待实施）

分支：feat/v0.3-oidc-project-api；基线：PR #54 合并提交 8a9dbf5b。

- [ ] ADR-0065 与实施计划经静态文档检查。
- [ ] openid-client 6.8.9 加入 pnpm Catalog，pnpm-lock.yaml 由 pnpm 生成并冻结安装验证。
- [ ] OIDC 配置默认关闭；缺失/非法 Issuer、Client、Redirect URI、Web Origin、加密密钥拒绝启动，且错误不回显密钥。
- [ ] 外部身份映射、OIDC 登录事务、CSRF 摘要增量 Prisma 迁移及中文数据库注释。
- [ ] OIDC Mock Issuer 验证 Discovery、PKCE、State、Nonce、Issuer/Audience/签名/过期、重复回调和浏览器绑定。
- [ ] Cookie 会话、CSRF、Origin/Fetch Metadata、Bearer 兼容、撤销和过期安全测试。
- [ ] 工程创建/ACL/首版快照/水位/成功审计原子事务；跨租户、无权限、CAS 并发与回滚负面测试。
- [ ] React/Vue 共用 API Client、同源代理、工程 JSON 双向互通和浏览器登录/保存回归。
- [ ] pnpm run deps:check、config:check、env:check、messages:check、db:validate、db:generate、vp check、typecheck:web、typecheck:server、test:unit、test:e2e:server、test:db（仅隔离库）、docs:check、build:web、build:server、ready。
- [ ] 维护者配置真实 Issuer、TLS、Redirect URI 和预绑定身份后，完成实际 IdP 联调；Mock Issuer 通过不能代替此项。

**当前状态**：本分支只包含 ADR-0065 与实施计划文档；未新增依赖、Prisma 模型/迁移、HTTP 路由或前端 API Client。所有实现和测试均待后续提交。

### 第三十三批阶段 A 本轮新增代码待验证（2026-11-14）

维护者先前执行的 `vp check` 结果为 **274 文件格式正确、135 受检文件无警告/Lint/TypeScript 错误**，`docs:check` 为 **82 份 Markdown 通过、退出码 0**。这些结果发生在本轮新代码提交之前，不能作为阶段 A 的通过证据。

本轮代码已提交：共享 DatabaseModule、NestJS 身份/持久化模块去重、OIDC 默认关闭/严格校验、启用时 fail-closed、Oidc 配置单测、数据库模块装配单测、Prisma Schema/增量迁移及中文注释。**尚未执行数据库迁移、Prisma validate/generate、TypeScript、Vitest 或完整 ready**。

- [ ] `pnpm run env:check`：检查 OIDC 配置模板和本地根环境。
- [ ] `pnpm run db:validate`、`pnpm run db:generate`：校验 Prisma 模型、生成更新后的 Client。
- [ ] `vp check`：新配置、模块及测试的格式/Lint/类型检查。
- [ ] `pnpm run test:unit`：OIDC 配置拒绝、共享数据库模块元数据及原有会话安全测试。
- [ ] `pnpm run docs:check`：验证新增阶段 A 文档。
- [ ] `pnpm run ready`：完整质量链与构建。
- [ ] **仅隔离 PostgreSQL**：核对增量迁移的表/字段/索引/外键/中文注释；禁止使用生产或普通开发库进行验证。
- [ ] 安装 `openid-client@6.8.9` 并通过 pnpm 原生命令同步 Catalog、Server manifest 和锁文件。

本批目前没有 OIDC 登录、回调、会话 Cookie/CSRF 签发、工程 API 或真实 IdP 联调。当前启用 OIDC 会被服务端拒绝启动，这是阶段 A 的明确安全限制，不是已实现的登录功能。

### 第三十三批 OIDC 配置测试警告修复（2026-11-14）

维护者执行 `vp check --fix` 报告 **0 错误、7 警告**：其中 `oidc-startup.config.spec.ts` 有五处 `vitest(require-to-throw-message)`、一处 `vitest(no-conditional-expect)`，`oidc-startup.config.ts` 有一处 `typescript(no-misused-spread)`。格式修复已由维护者本机命令执行，但这不代表静态检查零警告。

已在开发分支最小修复：为五处异常断言指定准确中文错误消息；使用锚定正则校验完整异常消息以验证敏感字符串不会泄露，并删除条件式 `expect`；使用索引和 `charCodeAt()` 检测 UTF-16 码元控制字符，不再展开字符串。未改变 OIDC 开关、验证策略、Prisma 模型、SQL 迁移或工程 API。

当前仅完成远端代码修改和静态片段核对；尚未取得修复后的 Windows `vp check`、Vitest 或 `ready` 运行结果，**不得标记本次修复已通过完整验证**。

### 第三十三批 Windows 单测：Prisma 中文注释跨行格式修复（2026-11-14）

维护者运行 `pnpm run test:unit`：Core Node 构建通过、Prisma Client 7.10.1 生成成功；**40 个测试文件中 39 个通过、1 个失败，448 项测试中 447 通过、1 失败，退出码 1**。新增 OIDC 配置测试 7/7、共享数据库模块测试 3/3 均通过。

唯一失败项：`apps/server/src/database/prisma-schema-comments.spec.ts` 的“所有 Prisma 业务表和实际持久化字段都有中文数据库注释”。该测试读取全部迁移 SQL，并逐行匹配 `COMMENT ON COLUMN "表"."列" IS '中文说明';`。第三十三批新增 SQL 迁移将部分 `COMMENT ON` 的 `IS` 和中文注释值拆分到两行，导致 `commentText` 返回 null，在 `.toMatch()` 处报 `TypeError: .toMatch() expects to receive a string, but got object`。

**最小修复**：仅调整 `apps/server/prisma/migrations/20261114000000_oidc_identity_transactions/migration.sql` 中 10 处跨行的 COMMENT ON TABLE/COLUMN/INDEX 为一行，不修改 DDL、Prisma Schema、中文注释内容、约束、索引、身份逻辑，也不更改测试判定规则。通过模拟现有测试的逐行 `commentText` 匹配，对 4 份迁移 SQL 和 8 个 Prisma 业务模型进行静态核对：**58 个表/物理字段注释均存在中文内容，无缺失项**。

**待维护者复验**：`pnpm run test:unit`、`vp check`、`pnpm run docs:check`。此前的 447/448 是失败的真实运行结果，本次代码修复尚未实际执行 Vitest，不得记录为通过。

### 第三十三批阶段 A Windows 完整质量链通过（2026-11-14）

维护者提供完整 PowerShell 实测日志，确认修复新增 OIDC 增量迁移 `COMMENT ON` 单行格式后的质量链结果：

- `vp check`：**278 个文件格式正确，139 个受检文件零警告、Lint 与 TypeScript 错误**。
- `pnpm run test:unit`：Core 构建、Prisma Client **7.10.1** 生成成功，Vitest **40/40 个文件、448/448 项测试全部通过**；其中 OIDC 启动配置 7/7、共享数据库模块 3/3、Prisma 中文注释检查 2/2。
- `pnpm run docs:check`：**82 个 Markdown 文件通过**。
- `pnpm run ready`：**最终退出码 0**，依赖目录 11 清单/51 项 Catalog 依赖、共享配置 9 个 TSConfig、环境/LF、165 个自有文件中文文案检查、Prisma Client 生成、Core 构建、React/Vue/Draft Storage/Server 类型检查、448/448 单测、SSE 客户端 **8/8**、故障代理 **4/4**、NestJS E2E **17/17**、React 构建 3901 个模块、Vue 构建 3847 个模块以及 NestJS 最终构建均完成。

该日志消除了此前 447/448 的 Prisma 中文注释单测阻塞，确认新增 Schema、配置与模块装配代码能够通过当前完整质量链。

**未在本次日志中验证**：真实 PostgreSQL 上应用新增 OIDC 增量迁移及数据库注释、OIDC Identity Provider 协议联调、Cookie/CSRF、工程 HTTP API。当前服务端 `SCADA_OIDC_ENABLED=true` 仍主动拒绝启动；这属于阶段 A 的安全边界。上述能力及迁移隔离测试待后续阶段完成。

### 第三十三批依赖安装与全链复验（2026-11-14，维护者 Windows 日志）

维护者在 Windows / pnpm **12.18.0** 实际执行：

- `pnpm --filter @adui/scada-server add --save-catalog openid-client@6.8.9`：安装结束，生成 pnpm Catalog 及 Server `catalog:` 引用；命令曾输出一次来自不同来源的替换警告，但最终安装成功，实际远端工作分支的 Catalog、Server Manifest、`pnpm-lock.yaml` 均可见 openid-client 6.8.9。
- `pnpm install --frozen-lockfile`：11 个工作区项目，锁文件供应链策略通过，安装成功。
- `pnpm run deps:check`：11 个依赖清单、**52 项 Catalog 依赖**通过。
- `vp check`：**278 个文件格式正确，139 个受检文件零警告/Lint/TypeScript 错误**。
- `pnpm run ready`：**最终退出码 0**；Prisma Client 7.10.1 生成、全栈类型检查、Vitest **40/40 文件及 448/448 测试**、SSE 8/8、TCP 故障 4/4、NestJS E2E 17/17、文档检查 **82 份 Markdown**、React 3901 模块构建、Vue 3847 模块构建以及 NestJS 构建均成功。

**范围说明**：上述实测发生在本次 AI 错误复盘文档新增及文档验证器修改之前；现在增加了 `docs/AI_MISTAKES.md`，因此应重新运行 `pnpm run docs:check` 和 `vp check`，不能将此前 82 份 Markdown 的通过直接记为当前新文件已验证。实际 PostgreSQL 增量迁移和 OIDC 协议安全测试仍未执行；当前不开放工程 API。

### AI 编码前错误复盘强制流程（2026-11-14）

按维护者要求，新增 `docs/AI_MISTAKES.md`，从已核实错误中整理 Dexie 原生版本误用、CDP 函数闭包、Vitest/TypeScript Lint、Prisma 中文 SQL 注释、Mock 泛型、TS6 工具链、Tauri 发布代理误用、半程日志误报通过、浏览器测试初始化等 9 项反例与复验要求。根目录 `AGENTS.md` 要求所有 Agent **每次编码前全文复读**；`HARNESS.md` 与 `CODEBASE_MAP.md` 提供直达入口，`scripts/validate-docs.mjs` 将文件纳入必需文档。此流程是仓库协作规范，不能机械保证阅读行为；今后任务由 Agent 先执行读取，并在有新错误时追加案例。

### 第三十三批 AI 错误复盘门禁新增后的 Windows 文档与静态检查（2026-11-14）

维护者在包含 `docs/AI_MISTAKES.md` 和文档校验器必需文件检查的最新分支执行：

- `pnpm run docs:check`：**83 个 Markdown 文件通过**，退出码 **0**。
- `vp check`：**279 个文件格式正确；139 个受检文件零警告、Lint 错误和 TypeScript 错误**。

以上日志是 AI 复盘文档、AGENTS 强制必读、HARNESS/CODEBASE_MAP 入口和 `validate-docs.mjs` 必需文件检查提交后的真实 Windows 验收，覆盖此前尚未复验的新增文档与校验脚本。

此前维护者已执行 `pnpm install --frozen-lockfile`、`deps:check`（11 清单、52 项 Catalog）、`pnpm run test:unit`（448/448）、完整 `pnpm run ready`（退出码 0）。其中完整 ready 的 `docs:check` 当时为 82 份 Markdown，不能将其计为新增文档后的 83 份；最新 83 份由本次单独 `docs:check` 确认。

**仍待完成**：隔离 PostgreSQL 上真实执行 OIDC 增量迁移并核对外键/索引/中文 COMMENT；OIDC Discovery/PKCE/State/Nonce、Cookie/CSRF、工程 API 尚未实现/验收。当前服务端启用 OIDC 仍 fail-closed。

### 第三十三批 OIDC PostgreSQL 迁移实测用例已增加（2026-11-14，待维护者运行）

新增 `apps/server/test/oidc-schema.db-spec.ts`，由既有独立入口 `pnpm run test:db` 自动发现，**不加入不依赖 PostgreSQL 的 `pnpm run ready` / `test:unit`**。该测试在模块初始化时强制校验 `SCADA_TEST_DATABASE_URL` 只能指向本机 `127.0.0.1/localhost` 的 `adui_scada_test`，并在结束时释放 Prisma 连接、恢复原环境变量。

实测断言覆盖：

- Prisma `_prisma_migrations` 中 OIDC 迁移成功记录；
- 两张 OIDC 新表及其中文表注释；
- 15 个新增物理字段、中文字段注释和允许为空的 CSRF/消费时间字段；
- 外部身份复合外键、OIDC 状态/过期/回跳路径约束及会话 CSRF 摘要约束；
- 三个新增业务索引及其中文索引注释。

**当前状态**：测试代码已提交，尚未在 Windows 或任何 PostgreSQL 实例运行。执行前必须先创建本机独立数据库 `adui_scada_test`，将迁移命令和测试进程的连接 URL 显式指向该数据库；禁止使用普通开发库 `adui_scada` 或生产数据库。完成后执行 `pnpm run db:migrate:deploy`、`pnpm run db:migrate:status`、`pnpm run test:db` 并提供各命令退出码。不得把 Prisma Client 生成、Schema 单测或静态 SQL 审查视为真实迁移通过。

## V0.3 第三十三批：OIDC PostgreSQL 增量迁移真实验收（2026-11-14）

维护者 Windows 实测目标为本机隔离数据库 `127.0.0.1:15432/adui_scada_test`，命令及结果如下：

| 命令                         | 实测结果                                             |
| ---------------------------- | ---------------------------------------------------- |
| `pnpm run db:validate`       | Prisma Schema 有效                                   |
| `pnpm run db:migrate:deploy` | 成功应用 `20261114000000_oidc_identity_transactions` |
| `pnpm run db:migrate:status` | 4 项迁移已登记，Schema 为最新                        |
| `pnpm run test:db`           | 2 个文件、17/17 测试通过，退出码 0                   |

数据库测试包括 OIDC Schema 5/5 与既有工程版本数据库回归 11/11。OIDC 检查真实 PostgreSQL 中的迁移登记、两张表、15 个物理字段及中文表/字段注释、复合外键、检查约束、可空字段和三个业务索引及中文注释。

**范围说明**：本次只在已有的隔离 `adui_scada_test` 上应用增量迁移并执行测试；未删除或重置数据库。尚未从全新隔离数据库验证全部迁移的空库部署，也未执行第二次 `migrate deploy` 的幂等性检查。以上数据库结果来自维护者提供的 Windows 终端日志，不代表当前协作环境自行运行。

OIDC 登录、BFF Cookie/CSRF、工程 HTTP API、真实 IdP 联调及工业现场安全验证均未因此完成。开关继续默认关闭，未完成认证和 ACL 前服务端保持 fail-closed。

## V0.3 第三十三批阶段 B 第一小批：固定 Issuer OIDC Discovery

新增 `apps/server/src/auth/oidc-provider-discovery.service.spec.ts`，通过 Mock Fetch 验证 openid-client 6.8.9 的固定 Issuer Discovery，不调用真实 IdP。覆盖：

- 固定 Issuer、标准 Discovery 文档路径、成功配置缓存及并发调用合并。
- Issuer 不匹配、缺少授权码响应、PKCE S256、RS256 或受支持主体标识时拒绝。
- 声明的授权码许可、openid Scope、Token Endpoint 客户端认证方法与当前策略冲突时拒绝。
- 外部 HTTP、不安全端点、本机回环 HTTP 开关边界及失败重试。
- 错误信息不包含底层网络异常、Issuer、端点或秘密。

维护者需在当前分支执行 `vp check`、`pnpm run test:unit`、`pnpm run docs:check` 和 `pnpm run ready`。本测试只使用 Mock Fetch；即使单测通过，也不代表真实 IdP 联调、OIDC 登录路由、PKCE 回调、会话 Cookie 或 CSRF 已实现。当前 `main.ts` 仍拒绝 `SCADA_OIDC_ENABLED=true`。

## V0.3 第三十三批阶段 B 第二小批：OIDC 一次性登录事务

新增 `apps/server/src/auth/oidc-login-transaction.service.spec.ts`，Mock Prisma 与 openid-client Configuration，不连接真实数据库或 IdP。覆盖：

- 授权码请求固定 Redirect URI、`openid` Scope、State、Nonce 与 PKCE S256。
- State 与浏览器绑定只保存 SHA-256 摘要；AES-256-GCM verifier 密文可正确解密并与 challenge 对应。
- 同一浏览器多标签页绑定复用、不同 State 独立事务。
- 站内回跳路径校验、外部/协议相对/反斜杠/片段/编码控制字符拒绝。
- 跨浏览器、无效 State、过期、未来创建、重复及并发回调拒绝。
- 密文篡改、数据库中的 Nonce/回跳路径篡改、数据库创建和事务异常的安全失败。

当前代码尚未在维护者 Windows 环境执行。需运行 `vp check`、`pnpm run test:unit`、`pnpm run docs:check` 与 `pnpm run ready`；Mock 测试不代表真实 PostgreSQL 并发锁、真实 IdP 回调或 HTTP Cookie 行为已验收。

### 第三十三批阶段 B 第二小批控制字符 Lint 警告修复（2026-11-14）

维护者 Windows `vp check --fix` 报告 OIDC 回跳路径校验触发 `eslint(no-control-regex)`，结果为 0 错误、1 警告。已将正则控制字符检测替换为逐字符 `charCodeAt()` 检查，保留 U+0000–U+001F 与 U+007F 拒绝逻辑；新增原始换行、NUL、DEL 回归输入，未关闭 Lint 规则、未弱化安全校验。

**待维护者复验**：`vp check`、OIDC 登录事务单测、`pnpm run test:unit`、`pnpm run docs:check` 与 `pnpm run ready`。本条记录的是已收到的警告与已提交修复，不代表修复后命令已经通过。

### 第三十三批阶段 B 第一、二小批 Windows 全链验收（2026-11-14）

维护者提供的 Windows PowerShell 日志确认：

- `vp check`：284 个文件格式正确，144 个受检文件零警告、Lint 与 TypeScript 错误。
- `pnpm run test:unit`：42/42 文件、465/465 测试通过；OIDC Discovery 7/7、登录事务 10/10。
- `pnpm run docs:check`：83 个 Markdown 文件通过。
- `pnpm run ready`：最终退出码 **0**；依赖 11 清单/52 Catalog、中文文案 170 文件、SSE 8/8、故障代理 4/4、NestJS E2E 17/17、React/Vue/NestJS 构建全部完成。

该日志验证的是阶段 B 第一、二小批及当时分支代码。第三小批回调服务和测试在该次 Windows `ready` 之后加入，不能将 465/465 或 ready 退出码 0 延伸为第三小批已通过。

### 第三十三批阶段 B 第三小批：OIDC 授权码回调与身份验证（待维护者 Windows 验证）

新增 `apps/server/src/auth/oidc-callback.service.spec.ts`，使用 Mock 授权码兑换、Discovery、Prisma 身份映射和会话签发服务。覆盖固定 Redirect URI、State/Nonce/PKCE 检查参数、可选响应 `iss`、ID Token Claims 的 Issuer/Audience/azp/Subject/时间边界、无 ID Token、OAuth 错误、外部身份未绑定/停用、数据库/IdP 错误脱敏，以及 IdP Access/Refresh/ID Token 不进入服务结果。

**待执行**：`vp check`、`pnpm run test:unit`、`pnpm run docs:check`、`pnpm run ready`。这些 Mock 测试不证明真实 IdP 的 RSA 签名/JWKS 轮换、真实 Token Endpoint、PostgreSQL 并发事务、Cookie/CSRF 或企业 SSO 联调已通过。OIDC HTTP Controller 尚未注册，`main.ts` 对 `SCADA_OIDC_ENABLED=true` 继续 fail-closed。

### 第三十三批阶段 B 第三小批：OIDC 回调测试夹具类型修正（2026-11-14）

维护者 Windows 执行 `vp check --fix` 时，`apps/server/src/auth/oidc-callback.service.spec.ts` 的 Mock 调用记录在 `expectedState` 处触发 TS2322：`string | symbol | undefined` 不能赋给 `string | undefined`。

**原因**：测试夹具 `GrantCall.checks.expectedState` 被手工收窄为 `string`，但 `openid-client@6.8.9` 的 `authorizationCodeGrant` 第三个参数 `checks.expectedState` 还允许 `skipStateCheck` 符号。生产回调代码传入普通 State 字符串没有问题，错误仅发生在测试记录类型。

**最小修复**：新增 `OidcExpectedState` 类型别名，从 `Parameters<OidcAuthorizationCodeGrant>[2]["expectedState"]` 对应的实际函数参数类型派生（通过 `NonNullable` 处理可选 checks 参数），让测试夹具与锁定版本 API 保持一致；不使用 `as string`、不修改第三方类型、不改变生产逻辑。

**待维护者复验**：`vp check`、`pnpm run test:unit`、`pnpm run docs:check` 和 `pnpm run ready`。当前远端代码已修正，但未在本协作环境执行 Windows Vite+，不得将本次修复标记为已通过。

### 第三十三批阶段 B 第三小批：OIDC 回调测试夹具 TS2322 修复及 Windows 全链验收通过（2026-11-14）

维护者最初执行 `vp check --fix` 时，`oidc-callback.service.spec.ts` 的 `GrantCall.checks.expectedState` 手工收窄为 `string`，与 openid-client 6.8.9 实际允许的 `string | symbol | undefined` 不一致，触发 TS2322。

已修复为从真实函数签名派生：

```ts
type OidcExpectedState = NonNullable<Parameters<OidcAuthorizationCodeGrant>[2]>["expectedState"];
```

没有使用强制类型断言，没有修改生产回调逻辑或第三方类型声明。

**维护者随后提供的 Windows 验收日志确认修复已通过：**

- `vp check`：286 个文件格式正确；146 个受检文件零警告、Lint 错误和 TypeScript 错误。
- `pnpm run test:unit`：43/43 测试文件、477/477 测试通过；OIDC Discovery 7/7、登录事务 10/10、OIDC 回调 12/12。
- `pnpm run docs:check`：83 个 Markdown 文件通过。
- `pnpm run ready`：重复执行 477/477 单测、SSE 客户端 8/8、故障代理 4/4、NestJS E2E 17/17，React/Vue 与 NestJS 构建通过；最终退出码 **0**。

因此，原先本节记录的“待维护者复验”已由上述 Windows 实测结果关闭。该结果验证当前分支静态检查、单测和工程质量链，不代表真实 IdP/JWKS 联调、HTTP Cookie/CSRF 或 OIDC 生产启用已验收。

## 2026-11-14 · 第三十三批阶段 B 第三小批 TS2322 修复后 Windows 全链验收通过

维护者补充的 Windows PowerShell 日志确认，OIDC 回调 Mock 类型修复后的当前分支完整质量链通过：

| 验收项                | 实测结果                       |
| --------------------- | ------------------------------ |
| `vp check`            | 286 个文件格式正确             |
| Lint / TypeScript     | 146 个受检文件，零警告、零错误 |
| `pnpm run test:unit`  | 43/43 文件、477/477 测试通过   |
| OIDC Discovery        | 7/7                            |
| OIDC 登录事务         | 10/10                          |
| OIDC 回调             | 12/12                          |
| `pnpm run docs:check` | 83 个 Markdown 文件通过        |
| SSE 客户端            | 8/8                            |
| SSE 故障代理          | 4/4                            |
| NestJS E2E            | 17/17                          |
| React / Vue 构建      | 均成功                         |
| NestJS 构建           | 成功                           |

完整 `pnpm run ready` 最终退出码 **0**。该日志同时再次运行了单测、SSE、故障代理、NestJS E2E 和双框架/服务端构建。

**验收边界**：本结果覆盖第三小批 OIDC 回调服务、Mock 单测、E-011 类型修复及当前工程质量链；不代表真实 IdP/JWKS 轮换联调、HTTP Controller、浏览器 Cookie/CSRF 或工程 API 已完成，也不代表允许解除 `SCADA_OIDC_ENABLED=true` 的 fail-closed 保护。

## 第三十三批阶段 B 第四小批：BFF Cookie 与 CSRF 会话保护（待维护者 Windows 验证）

新增测试：

- `apps/server/src/auth/scada-auth-cookie.spec.ts`：验证 Session Cookie 的 HttpOnly、CSRF Cookie 可读、Secure、SameSite=Lax、Path=/、不设置 Domain、有效期边界及对称清除。
- `apps/server/src/auth/scada-session.guard.spec.ts`：验证 Bearer 兼容、Bearer/Cookie 混用拒绝、Cookie 安全读取、写请求精确 Origin、Fetch Metadata、CSRF 双提交、重复/孤立 Cookie、会话/CSRF 摘要拒绝和审计脱敏。
- `apps/server/src/auth/scada-identity.spec.ts`：验证新会话只保存 CSRF 摘要、有效 Cookie 会话认证、错误 CSRF 拒绝、旧 Bearer 会话不能升级为 Cookie 但仍可 Bearer 认证。
- `apps/server/src/auth/oidc-callback.service.spec.ts`：验证回调服务向未来 Controller 提供本地 CSRF Token，不暴露 IdP Token。

**待执行**：维护者 Windows `vp check`、`pnpm run test:unit`、`pnpm run docs:check`、`pnpm run ready`。本批无 Prisma Schema 或迁移变更；单测使用 Mock，不代表真实浏览器 Set-Cookie、HTTPS 终止代理、Cookie 域名/端口行为或真实 IdP 登录已验收。HTTP Controller 已由第五小批提交，OIDC 启用仍需维护者质量验收。

## 第三十三批阶段 B 第五小批：OIDC BFF HTTP 控制器与认证路由（Windows 验收通过）

新增 `apps/server/test/oidc-auth.controller.e2e-spec.ts`，通过 NestJS TestingModule 与 Supertest 验证真实 HTTP 路由/Guard/响应头，外部 IdP、PostgreSQL 与真实浏览器均使用 Mock/不连接。覆盖：

- OIDC 登录发起 302、固定授权地址、短时 HttpOnly/Secure/SameSite=Lax 浏览器绑定 Cookie、无缓存/无 Referer。
- 同一浏览器多个标签页复用绑定 Cookie；回调转发 State/Code/`iss` 和绑定值，成功后设置 Session HttpOnly 与 CSRF 可读 Cookie，再跳转至站内路径。
- `/me` 未认证拒绝，已认证只返回 tenantId/subjectId 且不缓存、不返回令牌。
- Cookie `/logout` 必须通过 Origin、Fetch Metadata、CSRF 双提交并撤销当前会话；缺少 CSRF 不触发撤销；Bearer 注销继续兼容。
- 审计记录不包含 Session/CSRF Token 或 Origin；默认 `AppModule` 的四条身份路由保持 404。

新增 Cookie helper 测试覆盖浏览器绑定 Cookie、重复 Cookie 名称/多值请求头拒绝。`database.module.spec.ts` 覆盖 OIDC 根模块只挂载身份模块，不挂载工程持久化模块。

**待执行**：维护者 Windows `vp check`、`pnpm run test:unit`、`pnpm run test:e2e:server`、`pnpm run docs:check` 和完整 `pnpm run ready`，最终记录 PowerShell `$LASTEXITCODE`。这些 Mock E2E 不代表真实 IdP/JWKS、浏览器 Secure Cookie、生产 HTTPS 反向代理或企业身份映射已验收。

## 第三十三批阶段 B 第五小批：首次 Windows 静态检查反馈与最小修复（2026-11-14）

维护者首次执行 `vp check --fix`，发现以下问题：

- `oidc-auth.controller.e2e-spec.ts` 的未认证身份测试只使用 Supertest `.expect(401)`，触发 `vitest(expect-expect)`；现已补充对 `response.status` 的显式 Vitest 断言。
- 同一 E2E 将 `response.headers["set-cookie"]` 当作数组调用 `.join()`，但当前 Supertest 类型声明为 `string`，触发 TS2339；现新增 `getSetCookieHeaders()`，兼容字符串/数组，并仅在下一个受控 `__Host-adui-scada-*` Cookie 名称前拆分合并字符串，避免错误拆分 Expires 日期中的逗号。所有 Set-Cookie 数量与内容断言统一使用该函数。
- `database.module.spec.ts` 导入 `ScadaAuthController` 后没有实际使用，触发 `no-unused-vars` 与 TS6133；现增加 `ScadaIdentityModule` Controller 元数据断言，确认认证 Controller 只注册在身份模块中。

上述是代码修复记录，**尚未收到修复后的 Windows 复验日志**。需重新执行 `vp check`、`pnpm run test:unit`、`pnpm run test:e2e:server`、`pnpm run docs:check` 和完整 `pnpm run ready`，最终记录 PowerShell `$LASTEXITCODE`；不得将格式化完成或代码已推送描述为测试通过。对应错误防复发规则记录在 `docs/AI_MISTAKES.md` E-012。

## 2026-11-14 · 第三十三批阶段 B 第四、五小批 Windows 完整验收通过

维护者提供的 Windows PowerShell 日志确认，修复 E-012 后，当前功能分支完成以下验证：

| 验收项                     | 实测结果                       |
| -------------------------- | ------------------------------ |
| `vp check` 格式检查        | 291 个文件正确                 |
| Lint / TypeScript          | 151 个受检文件，零警告、零错误 |
| `pnpm run test:unit`       | 45/45 文件、494/494 测试通过   |
| `pnpm run test:e2e:server` | 4/4 文件、26/26 测试通过       |
| OIDC Controller E2E        | 9/9 测试通过                   |
| `pnpm run docs:check`      | 83 个 Markdown 文件通过        |
| SSE 客户端测试             | 8/8 通过                       |
| SSE 故障代理测试           | 4/4 通过                       |
| React Web 构建             | 成功                           |
| Vue Web 构建               | 成功                           |
| NestJS Server 构建         | 成功                           |
| 完整 `pnpm run ready`      | 最终退出码 **0**               |

本次完整 `ready` 实际执行依赖目录、共享配置、环境变量与换行符、中文文案、Prisma Client 生成、Core 构建、Vite+ 格式/Lint/TypeScript、React/Vue/Draft Storage 类型检查、Server 类型检查、494 项单测、SSE 客户端 8 项、SSE 故障代理 4 项、NestJS E2E 26 项、83 份 Markdown 检查、React/Vue Web 构建和 NestJS 构建。

E-012 的三个问题均已由本次 Windows 复验关闭：401 E2E 存在显式 Vitest 断言；Supertest Set-Cookie 字符串类型已正确处理；身份模块 Controller 元数据断言已生效。上述结果记录的是 Mock OIDC HTTP 路由与工程质量链通过，**不代表真实 IdP/JWKS、生产 HTTPS/反向代理、真实浏览器 Cookie 或企业身份映射已经验收**。阶段 A 的真实 PostgreSQL 迁移测试 17/17 通过记录保持独立，不因本次 `ready` 而扩大其验证范围。

## 第三十三批阶段 B 第六小批：服务端工程 API 待验证（2026-11-14）

本小批准备新增六条工程 HTTP 接口、工程创建/ACL/版本事务、领域异常映射，以及新增仓储单元测试、HTTP E2E 和隔离 PostgreSQL 测试。默认 `AppModule` 继续要求六条工程路由 404；OIDC 启用根模块才挂载工程接口；所有数据库写入仍使用确认的测试隔离环境。

**当前验证结果：未执行。** 当前执行环境没有本仓库依赖、pnpm 和本机隔离 PostgreSQL；不能以第五小批此前的 494/494 单测、26/26 E2E 或完整 ready 退出码 0 代替本小批验证。

维护者 Windows 的必需命令按顺序为：

```powershell
vp check
pnpm run test:unit
pnpm run test:e2e:server
pnpm run docs:check
pnpm run ready
Write-Host "退出码：$LASTEXITCODE"
```

真实数据库验收只允许通过明确配置的本机 `adui_scada_test`：

```powershell
pnpm run db:migrate:status
pnpm run test:db
Write-Host "退出码：$LASTEXITCODE"
```

真实 IdP/JWKS、生产 HTTPS/Cookie 和双框架同源代理尚未验收。只有收到真实日志及最终退出码后，才可更新 PR #55 的第六小批勾选项。

## 2026-11-15 · 第三十三批第六小批补充静态审查（非运行验收）

- 已通过 GitHub 读取候选提交及 1059 个 Git Tree 文件条目，并逐一检查本批新增/变更的 13 个 TypeScript 文件的相对导入，未发现缺失的仓库内源码导入；`../generated/prisma/client.js` 属于按既有规则运行 `pnpm run db:generate` 后生成的 Git 忽略文件，不构成已验证的运行环境。
- 新增工程接口六条成功响应的 `Cache-Control: no-store` 声明，并补充 Bearer HTTP E2E 的缓存响应头与重复工程/非法修订号负面测试。更新 SDD 与需求文件记录候选 API 协议。
- 执行容器中 Node.js 22、TypeScript 5.8.3 可用，但本仓库要求 Node 24、TypeScript 6、pnpm 12 和 Vite+；Git 克隆实测 DNS 失败，错误为 `Could not resolve host: github.com`。因此**不能执行**仓库格式/Lint/类型检查、Vitest、E2E、Prisma 生成、PostgreSQL 事务测试或完整 ready。
- 本次静态检查不能替代维护者 Windows 下 `vp check`、`pnpm run test:unit`、`pnpm run test:e2e:server`、`pnpm run docs:check`、`pnpm run ready`，以及明确隔离测试库内的 `pnpm run test:db`。候选提交未推送至当前 PR 分支，原第五小批验收结果不覆盖本批代码。

## 2026-11-15 · 第六小批创建者状态复核补充（未执行真库验证）

静态安全审查指出：仅在 HTTP Guard 入口验证身份状态，不能保证进入较长的工程创建事务后主体仍保持有效。候选仓储已增加参数化 `SELECT ... FOR SHARE` 与 `active` 检查，配套 Mock 单测与本机隔离 PostgreSQL 停用主体负面测试；真正的事务内身份状态锁定、创建竞争、审计回滚、Cookie 防护及默认 404 仍须执行真实测试并检查退出码。本条是预防性安全增强，不作为新增真实事故或已验收结论。

## 2026-11-16 · 第三十三批第六小批：main.ts EOF 语法修复（待 Windows 回归）

维护者在已推送的分支 `feat/v0.3-oidc-project-api` 上执行 `vp check --fix` 失败：`apps/server/src/main.ts:73:1` 报 `Expected ) but found EOF`。根因是 `void bootstrap().catch(...)` 末行缺少 `);`，导致格式化解析中止。此次代码仅将原末行 `}` 更正为 `});`，没有改变 OIDC 启用逻辑、HTTP 请求体限制或服务安全策略。

已实施的验证：

- 修复文件的 Git Blob SHA 为 `f7b575a927d51311c8a40d5688109e9ec7654e3b`；从仓库源文件重建得到相同 `git hash-object` 值，确认语法检查与提交内容相同。
- 容器 Node.js 22 / TypeScript 5.8.3 `createSourceFile(..., ScriptKind.TS).parseDiagnostics` 报告 **0 个语法错误**。
- **尚未执行**仓库 Node 24 / TypeScript 6 / Vite+ 的真实 `vp check`、单元测试、HTTP E2E、`pnpm run ready` 或隔离 PostgreSQL 测试，不能将语法恢复误记为第六小批验收通过。

维护者须先同步本修复提交，再运行 `vp check`（不需要仅为修括号执行 `--fix`），按实际报错修复后执行 `pnpm run test:unit`、`pnpm run test:e2e:server`、`pnpm run docs:check`、完整 `pnpm run ready` 与最后退出码。真实数据库回归只在已确认的本机 `adui_scada_test` 隔离库运行 `pnpm run test:db`。本条对应 `docs/AI_MISTAKES.md` E-013。

## 2026-11-16 · 第三十三批第六小批：Windows 工程质量链验收通过

维护者提供 Windows PowerShell 实测日志，涵盖第六小批修复后的工程 API 和新增测试。功能分支 `feat/v0.3-oidc-project-api` 已确认当前格式化提交为 `e15f058b7d557cd394184f8dec03bb2c7056f7a0`，它基于 EOF 修复提交 `79f7ed5a`。**本次日志未单独记录 `git rev-parse HEAD`，因此 GitHub HEAD 与测试时工作树的一致性仍以维护者本地 Git 记录为准。**

| 验收项                               | 2026-11-16 实测结果                                               |
| ------------------------------------ | ----------------------------------------------------------------- |
| `vp check`                           | 297 个文件格式正确，157 个受检文件零警告、零 Lint/类型错误        |
| `pnpm run test:unit`                 | 46/46 测试文件、505/505 项通过；`project-api.store.spec.ts` 10/10 |
| `pnpm run test:e2e:server`           | 5/5 测试文件、40/40 项通过；`projects-api.e2e-spec.ts` 13/13      |
| `pnpm run ready` 中 SSE 客户端测试   | 8/8 通过                                                          |
| `pnpm run ready` 中 SSE 故障代理测试 | 4/4 通过                                                          |
| `pnpm run docs:check`                | 83 个 Markdown 文件通过（在本次验收日志对应的工作树上）           |
| Web React/Vue 构建                   | 两端成功                                                          |
| NestJS Server 构建                   | 成功                                                              |
| 完整 `pnpm run ready`                | **退出码 0**                                                      |

这次 HTTP E2E 的 `Health Check has failed` 日志为模拟就绪检查失败并验证 HTTP 503 的预期场景；E2E 最终 40/40 通过。E-013 的 `main.ts` EOF 括号问题已在 Windows 实测 `vp check` 中复验关闭。新增工程 API 的单测、Mock HTTP E2E、默认 AppModule 路由 404 验证属于本次工程质量链；**并不代表实际 PostgreSQL 事务、真实 OIDC 提供方、浏览器安全 Cookie 或生产网络配置已通过验证**。

**未完成的专项验证**：本次日志没有 `pnpm run test:db`，新增的 `project-api.db-spec.ts` 真实 PostgreSQL 场景（创建、隔离、并发、主体停用、审计失败回滚）仍需在确认的本机隔离 `adui_scada_test` 中执行；真实 IdP/JWKS、生产 HTTPS 终止代理及 React/Vue 同源 API Client 继续待验收。此前阶段 A 17/17 真实数据库通过记录不替代本次新数据库测试。

本条为维护者日志的历史验收证据；**本次文档更新后的新提交未在该日志中运行 `docs:check` 或 `ready`**，需要独立复核。不对生产设备执行写入。

## 2026-11-16 · 第三十三批第六小批 PostgreSQL 隔离事务验收通过

维护者已在 Windows 以 `127.0.0.1:15432/adui_scada_test` 为目标运行真实数据库专项检查。`db:validate` 通过；`db:migrate:deploy` 检查到四项迁移且没有待应用项；`db:migrate:status` 显示数据库结构最新。`pnpm run test:db` 最终通过 **3/3 个测试文件、22/22 个用例**：OIDC Schema 5/5、工程版本事务 11/11、工程 API 事务 6/6。

首次运行 `test:db` 时，因未显式设置 `SCADA_TEST_DATABASE_URL` 而被三个测试文件主动拒绝（0 个测试执行，退出码 1）；补充指向独立 `adui_scada_test` 的受控环境变量后，重新运行全部 22 项测试通过。原始失败属于安全门禁正常触发，不是业务断言失败，也没有放宽测试库检查。

本次结果与先前 **505/505 单元测试、40/40 HTTP E2E、`ready` 退出码 0** 分别成立，不能把已有隔离库的“无待应用迁移”误认为验证过全新空库初始化。真实 IdP、HTTPS Cookie、反向代理和 React/Vue 同源 API Client 尚未验收。

## 2026-11-16 · 全新空库首次迁移与重复部署：工具准备完成，真库待执行

为独立验证空库初始化和迁移幂等性，新增 `scripts/verify-fresh-postgres-migrations.mjs`，**只连接人工新建且为空的 `adui_scada_fresh_*` 本机数据库**。脚本先检查用户对象和非系统 Schema，再首次执行 `db:migrate:deploy`，核对与仓库目录一致的迁移登记和八个预期业务表；第二次执行 `db:migrate:deploy`、`db:migrate:status` 后比较迁移元数据完全一致。脚本不执行数据库创建、删除、重置或清理，也不改变原 `.env` 文件。

独立验证已完成：`node --check` 成功，`node --test scripts/verify-fresh-postgres-migrations.cases.mjs` **6/6 通过**（在当前协作容器 Node 22 环境）。**没有连接真实 PostgreSQL，也未运行两次 migrate deploy；空库迁移专项继续待维护者 Windows 实测**。此新增脚本的仓库 `vp check`、`ready`、`docs:check` 均需在应用补丁后复验。

## 2026-11-16 · 空库迁移测试文件 Node.js Promise Lint 修复（待复验）

维护者在最新空库迁移工具提交上执行 `vp check --fix`，格式化成功，但 `scripts/verify-fresh-postgres-migrations.cases.mjs` 因 `node:test` 的 `describe` 和六个 `it` 调用返回 `Promise<void>`，触发 **7 条 `typescript(no-floating-promises)` 警告**。此日志的“格式化完成”不代表全仓零警告通过。

采用最小修复：为测试注册添加一处 `void describe` 和六处 `void it`，不修改既有断言或安全校验；记录为 `docs/AI_MISTAKES.md` E-014。**修改后还没有维护者 Windows 的 `vp check`、6/6 `node --test`、`docs:check` 或完整 `ready` 复验结果**，不覆盖此前既有隔离数据库 `test:db` 22/22 的独立通过记录。全新空库首次迁移与二次部署仍未取得真实 PostgreSQL 日志。

## 2026-11-16 · E-014 Windows 复验通过，空库迁移专项仍待执行

维护者提供的 Windows PowerShell 完整日志确认：新增 Node 内置测试 `node --test scripts/verify-fresh-postgres-migrations.cases.mjs` **6/6 通过**；`vp check` **299 个文件格式正确、159 个文件零警告/零错误**，先前的 7 条 `typescript(no-floating-promises)` 警告已消失；`pnpm run docs:check` **83 个 Markdown 文件通过**。随后完整执行 `pnpm run ready`，包括依赖 Catalog 11 清单/52 项、环境配置/LF/中文文案、Prisma Client 7.10.1 生成、Core 构建、React/Vue/NestJS 类型检查、**46 文件 505/505 单测**、SSE 客户端 **8/8**、故障代理 **4/4**、**5 文件 40/40 NestJS HTTP E2E**（工程 API E2E 13/13）、83 份文档检查、React/Vue 与 NestJS 构建，最终 `$LASTEXITCODE` 为 **0**。E-014 经本次 Windows 实测关闭。

HTTP E2E 中的 `Health Check has failed` 以及 HTTP 503 是预期负面测试，最终 E2E 40/40 通过，不属于运行失败。此次日志没有单独输出 `git rev-parse HEAD`；GitHub 查询当前 PR #55 分支的最新格式化提交是 `7e5aac77c6a322adc4893f7f38da202734d5282a`，**不能将其等同于测试日志独立证明的提交标识**。

**验证边界**：本次 6/6 是隔离数据库目标校验的纯逻辑测试，**没有实际运行** `node scripts/verify-fresh-postgres-migrations.mjs <数据库名>`，没有证明全新空库首次部署和重复部署幂等性；此前已在 `adui_scada_test` 上通过的 22/22 真实 PostgreSQL 事务测试是另一项独立验收。真实 IdP/JWKS、HTTPS Cookie/反向代理、React/Vue 双框架 API Client 和工业现场安全仍未验收。

本条是对维护者实际运行日志的归档。**此后文档提交未包含在该次 `docs:check` 和 `ready` 验收中**，须针对新文档提交再次执行 `pnpm run docs:check`。未更改依赖、迁移、设备连接或工业写入。

## 2026-11-16 · 本机全新隔离 PostgreSQL 空库首次迁移与重复部署通过

维护者 Windows 实测执行 `pnpm run docs:check`，**83 份 Markdown 文件通过**；随后运行 `node scripts/verify-fresh-postgres-migrations.mjs adui_scada_fresh_20261116`，目标为本机 `127.0.0.1:15432/adui_scada_fresh_20261116`。脚本首先确认空库，首次执行 `prisma migrate deploy` 将现存四项迁移全部应用成功：`20261112000000_init_scada_projects`、`20261112170000_add_chinese_table_comments`、`20261113000000_trusted_identity_sessions`、`20261114000000_oidc_identity_transactions`。第二次 `prisma migrate deploy` 提示无待执行迁移，`prisma migrate status` 显示数据库结构最新；脚本确认四项登记、预期业务表及前后二次迁移元数据一致，最终退出码 **0**。脚本保留数据库，未创建、删除、重置或清理现有数据库。

日志在首次迁移后出现一次 Node.js `DEP0190` 警告：Windows 下 `spawnSync` 对 `pnpm.cmd` 使用 `shell: true` 及参数数组。**这不推翻本次迁移及幂等性验收，但属于已发生的进程安全问题，记录为 E-015。** 本批最小修复改为解析已安装的服务端 Prisma 7 CLI，并通过 `process.execPath` 无 shell 启动固定的 `migrate deploy/status`。协作容器 Node.js 22 已完成语法校验、既有空库目标保护 6/6 和模拟 Prisma CLI 子进程参数/环境传递测试；**Windows Prisma 7.10.1 的新调用路径与 `vp check`、`ready` 尚未实际复验**，不可将 E-015 提前标记为关闭。

`adui_scada_fresh_20261116` 现已部署迁移，不再是空库。要专项验证新启动方式，须另建一个**从未使用过**的本机 `adui_scada_fresh_*` 空库；不得对已通过验收的开发库、现有测试库或本次空库执行清理、重置或删除。真实 OIDC/JWKS、HTTPS 浏览器 Cookie/反向代理、React/Vue 共享 API Client 与工业现场安全仍未验收。此验收日志没有单独输出 `git rev-parse HEAD`，不能把 GitHub 分支 SHA 当作本机执行证明；新文档提交后还须再次运行 `docs:check`。

## 2026-11-16 · E-015 Windows 真实 Prisma 无 shell 子进程复验完成

维护者在修复 `spawnSync` 无 shell 调用后，先执行 `node --test scripts/verify-fresh-postgres-migrations.cases.mjs` **6/6 通过**，`vp check` **299 个文件格式正确、159 个受检文件零警告/错误**，`pnpm run docs:check` **83 个 Markdown 文件通过**。完整 `pnpm run ready` 已执行，**505/505 单测**、**40/40 HTTP E2E**、SSE 客户端 8/8、故障代理 4/4、React/Vue/NestJS 构建均通过，最终退出码 **0**。以上结果来自维护者 2026-11-16 Windows PowerShell 日志；未单独记录本地 Git SHA，不把远程提交 SHA 冒充本机实测提交证明。

随后维护者另建并检查本机新空库 `127.0.0.1:15432/adui_scada_fresh_20261116_b`，执行 `node scripts/verify-fresh-postgres-migrations.mjs adui_scada_fresh_20261116_b`：首次 `migrate deploy` **4/4 项迁移全部应用**，第二次报告 `No pending migrations to apply`，`migrate status` 显示 `Database schema is up to date!`；脚本确认迁移元数据在重复部署后不变，最终 `$LASTEXITCODE` 为 **0**。**本次真实 Windows Prisma 7.10.1 子进程未再出现 Node.js DEP0190**，E-015 已关闭；旧空库 `adui_scada_fresh_20261116` 与新空库 `adui_scada_fresh_20261116_b` 都保留，脚本未删除、重置或清理它们。

日志中 Prisma 提示可升级至 `8.0.0-rc.33` 只是更新提醒，不是构建或迁移错误，本批仍使用已锁定的 **Prisma 7.10.1**，不升级依赖或变更迁移历史。当前工程质量、本机真实 PostgreSQL 事务 22/22、两座新空库首次部署与幂等性回归均具备独立证据，**真实 IdP/JWKS、生产 HTTPS Cookie/代理、React/Vue 同源工程 API Client 和工业现场安全仍未验收**。本次仅补录文档，文档提交后仍需要重新运行 `pnpm run docs:check`。

## 2026-11-16 · 第三十三批第七小批：框架无关工程 API Client（代码候选，待 Windows 全链）

本批在已有六条受保护工程 API 与 ADR-0065 契约上新增独立工作区包 `@adui/scada-api-client`（`packages/api-client`）。统一封装同源 `/api/v1`、`credentials: same-origin`、`redirect: error`、`cache: no-store`、Cookie CSRF 双提交请求头、受控中文错误类型、响应字段与时间校验、调用 Core 的 `parseServerProjectSaveRequest` 和 `readProjectSnapshot` 完整性检查；只提供 `/auth/me`、`/auth/logout`、工程创建/列表/详情/版本列表/读取/CAS 追加。不提供可配置外站 URL、Bearer 凭据、Token 持久化、设备读写、自动重试或正式发布。

新增 `packages/api-client/test/api-client.test.ts` Mock Fetch 测试，覆盖固定同源请求、身份响应字段白名单、CSRF 缺失/重复/伪造在发送前拒绝、工程创建字段白名单、路由 ID、摘要与分页、SHA-256 快照校验、CAS 冲突/修订号一致性、状态码映射、HTML/错误 JSON/异常响应和网络失败时不重试。React 与 Vue 各自在依赖中引用相同的工作区包；**当前尚未改写 Studio 的实际保存按钮、历史草稿或登录页面，也未配置开发代理和真实 IdP**。

**已执行的有限验证**：协作容器 Node.js 22 / TypeScript 5.8.3 使用临时 Core 类型声明完成该包源代码类型检查（0 个诊断）；通过临时模拟 Core 的 Mock Fetch 烟测，核对创建工程、受控同源请求、CSRF、列表、409 错误和注销。以上不等价于仓库 TypeScript 6.0.3、Vite+、Vitest 全量测试，也不构成真实 HTTP、浏览器 Cookie 或 PostgreSQL 联调。新增工作区包的 `pnpm-lock.yaml` 仅由既有工作区依赖链接推导并作最小增量，协作环境无法联网运行 pnpm 12.18.0；**须由 Windows 维护者执行 `pnpm install --lockfile-only`、`pnpm install --frozen-lockfile` 和 `pnpm run ready` 实际复验锁文件**，如 pnpm 生成差异，以该命令的真实输出为准。

未完成：新增 Mock Fetch 测试在仓库真实 Vite+ 下运行；两端 Studio UI 接线、同源代理、真实 OIDC/JWKS、HTTPS Cookie/Origin/Fetch Metadata 和浏览器双向工程互通。第六小批 505/505 单测、40/40 E2E 及 E-015 数据库验收仅针对先前代码；**不能冒充第七小批质量验收通过**。

## 2026-11-16 · 第三十三批第七小批共享 API Client：Windows 质量验收通过

维护者上传的 Windows PowerShell 完整日志证明，新增 `@adui/scada-api-client` 的工程质量链已完成本机验收：

| 检查项                               | 实测结果                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `vp check`                           | 303 个文件格式正确，161 个受检文件零警告、零 Lint/类型错误                                         |
| `deps:check` / `config:check`        | 12 个清单、52 项 Catalog；10 个 TSConfig 消费端                                                    |
| `env:check` / `messages:check`       | 根 `.env` 与 LF 约束通过；187 个自有代码/配置文件中文文案检查通过                                  |
| `typecheck:web` / `typecheck:server` | React、Vue、草稿仓储、共享 API Client、NestJS 类型检查通过                                         |
| `pnpm run test:unit`                 | 47/47 个测试文件、**520/520 项通过**；`packages/api-client/test/api-client.test.ts` 新增 **15/15** |
| SSE 客户端 / 故障代理                | 8/8、4/4 通过                                                                                      |
| `test:e2e:server`                    | 5/5 测试文件，40/40 项通过；工程 API HTTP E2E 13/13                                                |
| `pnpm run docs:check`                | 83 个 Markdown 文件通过                                                                            |
| React / Vue / NestJS 构建            | 全部成功                                                                                           |
| 完整 `pnpm run ready`                | **最终 `$LASTEXITCODE = 0`**                                                                       |

`Health Check has failed` 与 HTTP 503 对应 NestJS 健康检查的预期负面 E2E 场景，本次 E2E 最终 40/40 通过。最新 GitHub 功能分支格式化提交为 `d95bf2244390597394850c939980e076c9bf2fbf`，该提交仅调整 API Client 源码与测试格式；**日志没有独立输出本地 `git rev-parse HEAD`，不能将远程 SHA 当作维护者运行时的 SHA 证明**。

**尚未验收**：本次上传日志未列出 `pnpm install --lockfile-only`、`pnpm install --frozen-lockfile` 的独立执行与结果，故锁文件冻结安装专项仍待确认；运行 `ready` 并不替代该检查。React/Vue Studio 尚未实际调用共享客户端，浏览器同源代理、真实 IdP/JWKS、HTTPS Secure/SameSite Cookie 与 Origin/Fetch Metadata、双框架工程互通和生产工业安全均未验收。本次只是追加验证文档；**该文档提交本身尚未经过新的 `docs:check`**。

## 2026-11-16 · 第三十三批第七小批：pnpm 冻结锁文件与最新文档复验通过

维护者 Windows PowerShell 实测 `pnpm install --frozen-lockfile`：`Scope: all 12 workspace projects`；锁文件通过供应链策略校验；`Lockfile is up to date, resolution step is skipped`；使用 **pnpm 12.18.0**，命令成功结束。随后 `pnpm run docs:check` 静态检查 **83 个 Markdown 文件通过**，最终 `$LASTEXITCODE` 为 **0**。因此第七小批新增 `packages/api-client` 后，**冻结锁文件安装与当前文档静态检查门禁均已由 Windows 运行结果证实**。

该验证与前一份 `vp check`（303 文件格式/161 受检零警告错误）、`pnpm run ready`（520/520 单测，新增 Mock Fetch 15/15；NestJS E2E 40/40；退出码 0）形成第七小批工程质量验收证据。**本次日志没有独立执行 `pnpm install --lockfile-only`**，不能写成已运行；`--frozen-lockfile` 校验通过不要求额外变更锁文件。日志未输出独立的本地 `git rev-parse HEAD`，不把远程 SHA 冒充本地测试 SHA。此次仅更新验收文档，**新文档提交后的 `docs:check` 尚未执行**。

未完成：React/Vue Studio 调用共享 API Client、浏览器同源代理、真实 OIDC/JWKS 身份、HTTPS Secure/SameSite Cookie/Origin/Fetch Metadata、双框架工程互通及生产工业安全。OIDC 默认关闭，工程 API 仍只在完整配置下受控启用，不开放设备写入。

## 2026-11-16 · 第三十三批第八小批：React/Vue 双端服务端工程操作接线（候选，待实测）

本批在第七小批共享 API Client 上新增 `packages/api-client/src/studio-session.ts`，对服务端工程保存维护**仅在当前浏览器会话有效**的 CAS 基线。新工程在服务端明确返回 404 后尝试创建；已有工程必须由用户**显式载入服务端最新版本**建立基线后才可追加。保存前对照最新远程修订号、租户和主体，服务端版本推进、身份变化、409 冲突均拒绝覆盖；网络异常不自动重试，也不访问 IndexedDB。

React 的 `apps/web-react/src/studio/StudioPage.tsx` 与 Vue 的 `apps/web-vue/src/studio/StudioPage.vue` 以一致的“服务端工程”独立菜单提供检查会话、创建/追加服务端工程、分页查询版本、查看 SHA-256 校验后的内容差异与**确认后载入服务端历史**。原来的“保存草稿”“本地版本历史”保持独立；服务端操作失败不得清除、覆盖或恢复本地草稿，也不得改变当前画布。载入远程版本需先显式确认，再停止并等待本地自动保存退出后替换当前编辑内容；本地历史载入、IndexedDB 草稿恢复、JSON 导入会失效旧的服务端 CAS 基线，避免使用非当前服务器内容进行误保存。

新增 `packages/api-client/test/studio-session.test.ts` 九个 Mock 测试，覆盖首次创建、缺少基线拒写、载入最新版本后 CAS、旧版本拒写、他端更新、身份变化、409 后失效基线、本地恢复重置和同一会话重复提交。测试目前是**已新增但未经仓库 Vite+ 实测的候选代码**；本次协作环境不能运行完整依赖与 Windows 本地浏览器，**没有执行新的 `vp check`、`pnpm run ready`、React/Vue 浏览器 E2E 或真实 OIDC 网络联调**。第七小批既有 520/520 单测、40/40 E2E 和冻结安装记录不能替代本批新增代码验收。

服务端默认 `AppModule` 只挂健康检查，OIDC/工程 API 仍默认关闭，因而在默认开发服务器中点击服务端菜单可能得到 404；这属于既有 fail-closed 安全策略，并不代表当前已配置真实业务保存。两端 Vite 开发代理未在本批开放 `/api/v1`；真实 IdP/JWKS、HTTPS Cookie/CSRF/反向代理、双框架浏览器读写往返均待专项配置和验证。没有开放工业设备写入、发布或自动服务器保存。

## 2026-11-16 · 第三十三批第八小批首次 Windows Lint：19 条 unbound-method 警告（E-016）

维护者执行 `vp check --fix`：Vite+ 在 `packages/api-client/test/studio-session.test.ts` 中发现 **19 条 `typescript(unbound-method)`**，汇总为 `Found 0 errors and 19 warnings in 163 files`；格式化阶段报告成功。该结果**不是零警告验收通过**，也不能据此判断 9 项会话测试已经运行。

已定位为 Mock 夹具 `const client: ScadaApiClient` 宽化后，`api.getMe/getProject/createProject/appendVersion` 被当成潜在依赖 `this` 的接口方法。候选最小修复改为 `const client = { ... } satisfies ScadaApiClient` 保留 Vitest Mock 类型，并将 6 处 `vi.mocked(api.*)` 改为 Mock 本身的 `.mock*` 调用，保留 9 个测试、29 个 `expect` 调用及业务断言。没有修改正式业务 API、认证或 CAS 规则，没有关闭 Lint。

**本次仅核查 GitHub 仓库代码及上传日志，未能在维护者 Windows 环境执行修复后 `vp check` 或 `pnpm run ready`。** 请复验 `vp check`（零警告/错误）、`pnpm run test:unit`（新增 9 项运行通过）、`pnpm run ready`（完整退出码 0），再关闭 E-016。真实 OIDC/JWKS、HTTPS Cookie、代理及 React/Vue 服务端往返仍未验收。

## 2026-11-16 · 第三十三批第八小批 Windows 最终验收、E-016 关闭

维护者 Windows 实测：完整 ready 中 305 文件格式正确、163 文件零警告；单测 48/48 文件、529/529 项，其中共享 CAS 会话 9/9；HTTP E2E 40/40、SSE 客户端 8/8、故障代理 4/4、React/Vue/NestJS 类型检查及构建全部成功，ready 退出码 0。React 与 Vue 的 1440×900、1024×768 浏览器回归各 19/19，历史版本保存取消/确认、跨刷新持久化和跨 Origin 隔离均通过。E-016 原 19 条 unbound-method 警告经真实 Windows 复验关闭。此结果**不等于真实 OIDC/HTTPS 与服务器跨框架写入已通过**。

## 2026-11-16 · 第三十三批第九小批：本机 OIDC HTTPS 代理候选（待 Windows 验收）

新增 scripts/oidc-https-dev-proxy.mjs 与 .d.mts 类型声明，Vue/React Vite serve 仅在 SCADA_OIDC_DEV_HTTPS_ENABLED=true 时读取本机 TLS 文件，并代理精确的 /api/v1 路由到固定回环 NestJS。必须非生产、Web/NestJS 绑定 127.0.0.1、可信 OIDC 已启用、React/Vue 独立端口与双 HTTPS Origin 白名单精确匹配，回调使用预注册固定路径；不允许不安全 HTTP OIDC 或模拟 API 冲突。默认 HTTP /demo 模式和生产构建不变，无 CORS 开放或 PLC 写入。

已执行：协作容器 Node 22 中两个脚本 node --check 通过，源文件 Git Blob 一致性核对通过，10/10 项 Node 内置配置安全测试通过。尚未执行仓库 TypeScript 6、Vite+、完整 ready、真实 TLS/IdP 登录、双框架工程 API 写入往返。由于本次仅新增候选代码，**不得声称真实身份或生产安全验收完成**。最新文档提交本身也需另外执行 docs:check。

## 2026-11-16 · 第三十三批第九小批 Windows 验收与第十小批 HTTPS 只读探针

维护者提交的 Windows PowerShell 完整日志确认：`pnpm run test:oidc:proxy` **10/10**，`vp check` **308 个文件格式正确、166 个受检文件零警告/错误**；完整 `pnpm run ready` 包含 Vitest **48/48 文件、529/529 项**、SSE 客户端 **8/8**、故障代理 **4/4**、HTTPS 配置安全测试 **10/10**、NestJS E2E **40/40**、83 个 Markdown 校验和 React/Vue/NestJS 构建，最终 `$LASTEXITCODE` **0**。日志未独立记录 `git rev-parse HEAD`，不将远程 SHA 冒充为 Windows 运行时提交指纹。

第十小批新增 `scripts/verify-oidc-https-readonly.mjs` 与同目录安全用例，只使用可信 TLS 发起两个回环 HTTPS Origin 的匿名 `GET /api/v1/auth/me`。拒绝非本机或不安全配置、证书校验失败、跳转、非 401、HTML 回退、无效 JSON 及不符合现有 NestJS 未认证响应契约。请求不带 Cookie、不会登录或写入数据库。新增独立离线测试命令 `pnpm run test:oidc:https:readonly` 并纳入 `ready`；真实网络检查 `pnpm run verify:oidc:https:readonly` 必须单独显式运行，**不纳入默认 ready**。

协作容器 Node.js 22 对候选脚本执行了语法检查和 Node 内置测试，**9/9 通过**。本次新增文件入库后的 Windows `vp check`、完整 `ready`、实际 TLS 握手、真实 IdP 登录、Secure Cookie/CSRF 和 React/Vue 服务端工程版本往返**均待独立验收**。第九小批的工程质量链通过不等于第十小批或真实认证通过。默认 OIDC 关闭，PR #55 保持 Draft，不开放匿名写入或设备写入。

## 2026-11-16 · 第三十三批第十小批 Windows 验收及真实探针失败诊断

维护者上传原始 PowerShell 日志：`pnpm run test:oidc:https:readonly` **9/9 通过**；`vp check` **310 个文件格式正确、168 个受检文件零警告/Lint/类型错误**；`pnpm run docs:check` **83 份 Markdown 通过**；完整 `pnpm run ready` 包含 48/48 Vitest 文件、**529/529** 单测、SSE 8/8、TCP 故障代理 4/4、OIDC 代理配置 10/10、HTTPS 只读离线探针 9/9、HTTP E2E **40/40**、React/Vue/NestJS 构建完成，**最终退出码 0**。此前第九小批质量验收同样通过，但不能替代真实 TLS 和登录联调。日志未包含本地 `git rev-parse HEAD` 独立结果。

随后维护者显式执行 `pnpm run verify:oidc:https:readonly`，输出通用“请检查本机证书信任、两端代理和服务端安全配置”并以 **退出码 1** 结束。**当前真实 HTTPS 探针未通过**；日志没有给出具体环境配置或 Node 网络错误码，不能认定是证书不可信、服务未启动、OIDC 未启用或其他某项的确定故障。默认 `.env.example` 的 `SCADA_OIDC_ENABLED=false` 和 `SCADA_OIDC_DEV_HTTPS_ENABLED=false` 将使该专项按设计失败；完整 `ready` 不会自动启动 HTTPS 开发服务。

为改进定位而不泄露敏感内容，本次在匿名只读探针 CLI 入口增加固定中文失败类别和白名单 TLS/网络错误映射，并增加两项离线测试：配置缺失、安全 TLS 信任、IP SAN、端口未监听、异常契约和未知错误均不能输出原始秘密。协作环境 Node.js 22 语法检查及更新后的 **11/11** 项离线测试通过；在缺少 OIDC 联调配置时该 CLI 仍以失败退出。**本次新的代码尚未在 Windows 执行 `vp check`、`ready` 或真实 TLS 探针**，不能将 11/11 候选测试外推为本机或生产验收。

仍待维护者在独立非生产环境准备可信 HTTPS 证书、真实 IdP、注册回调及预绑定测试主体，启动 NestJS/React/Vue 后执行真实匿名只读 401 验收；后续再验 Secure Cookie/CSRF 和 React↔NestJS↔Vue 服务端工程版本/CAS/IndexedDB 安全。不绕过鉴权，不接触生产库或设备写入。PR #55 继续 Draft，不合并。

## 2026-11-16 · OIDC Lab Docker 依赖栈候选静态验证

在隔离 Node.js **22.16.0** 环境中执行 `node --check scripts/prepare-oidc-lab.mjs`、`node --check scripts/prepare-oidc-lab.cases.mjs` 和 `node --test scripts/prepare-oidc-lab.cases.mjs`，新增准备逻辑的 **6/6** 项离线测试通过，覆盖高熵随机凭据、首次文件、重复执行保留秘密、缺少 `.env`、不安全监听与非法端口、既有机密文件损坏拒绝重置。使用 Python YAML/JSON 解析确认 Compose 结构包含 PostgreSQL、Redis、Keycloak 及 `adui-scada` Realm 的 `adui-scada-bff` Client。以上测试使用隔离临时目录和 Mock 证书准备，不曾启动 Docker、创建真实数据卷或登录身份提供方。

根 `.env.example` 在保持现有默认值与 OIDC 禁用状态的前提下，增加 Lab 端口；根 `scripts/check-env-config.mjs` 同步校验新环境变量，依赖保护测试加入 `ready`。**候选入库后的 Windows `vp check`、`pnpm run env:check`、`pnpm run ready`、`docker:lab:up`、真实 Keycloak TLS/Discovery、数据库与 Redis 连通性、以及完整 OIDC 回调/Cookie/CSRF 均待维护者实测**；不将离线 YAML/JSON 解析记作真实容器正常运行。

## 2026-11-16 · 第三十三批真实 OIDC 联调定位跨模块 Guard 注入缺陷（E-018）

维护者 Windows 实测：Keycloak 26.8.2 已完成 Realm 导入，可信 OIDC Discovery HTTP 200；独立 PostgreSQL `adui_scada_oidc_lab` 在回环 15433 上实际应用全部四项历史 Prisma 迁移，`migrate status` 报告 Schema 最新；React Vite HTTPS 15173 启动成功。**NestJS 未启动成功**：`OidcEnabledAppModule` 装配到 `ProjectApiModule` 时，`ScadaSessionGuard` 无法解析 `ScadaSecurityAuditService`（索引 1），因此前端 `/api/v1` 代理连接回环 13001 被拒绝，真实匿名只读探针退出码 **1**。本次失败不应归因于 Keycloak Realm、TLS 证书或数据库迁移；且未完成真正的登录、Cookie/CSRF 与跨框架工程往返。

代码修复仅在 `ScadaIdentityModule` 导出共享 `DatabaseModule`、审计服务、OIDC 配置 Token；现有默认 AppModule 仍不加载受保护路由或数据库。新增一项模块导出契约单测及两项真实 OIDC 根模块装配 E2E；E2E 通过测试配置和 Prisma Mock 避免访问任何实际 IdP/数据库，并验证匿名 `/api/v1/auth/me` 和 `/api/v1/projects` 返回 401 JSON。**新提交尚未执行 Windows `vp check`、`pnpm run test:unit`、`pnpm run test:e2e:server`、完整 `ready` 或实际 NestJS 联调启动**，不得声称通过。恢复联调后先验证 13001 监听，再执行真正的 HTTPS 匿名只读探针；后续需受控轮换已在聊天粘贴的本机测试凭据，不在仓库记录值。

## 2026-11-16 · 第三十三批第十二小批 Windows 实测结项：E-018 已关闭，双 Web HTTPS 匿名 401 通过

维护者在 Windows / PowerShell / WebStorm 使用功能分支代码完成了实际验收（上传日志未单独提供 `git rev-parse HEAD`，本记录**不将远程 HEAD 误称为本机提交指纹**）：

- `pnpm run test:e2e:server`：**6/6 文件、42/42 用例通过**；新增 `oidc-module-bootstrap.e2e-spec.ts` 的 2/2 真实 OIDC 根模块装配与未认证 401 检查通过。
- `vp check`：**315 个文件格式正确、171 个受检文件零 warning/Lint/类型错误**；后续 `vp check --fix` 也显示 171 个受检文件零告警。
- 完整 `pnpm run ready` 顺序执行完成且紧随其后的失败即停止检查未抛异常。包含 Vitest **48/48 文件、530/530 单测**；SSE 8/8、TCP 故障代理 4/4、OIDC 代理 10/10、Lab 准备 6/6、HTTPS 匿名探针离线 11/11、NestJS HTTP E2E 42/42、83 份 Markdown 文档检查及 React、Vue、NestJS 构建。原始日志没有单独打印 `ready` 的数值退出码，不能伪造该字段。
- 真实 NestJS `OidcEnabledAppModule`、`ProjectApiModule` 与 `ScadaIdentityModule` 均已初始化，身份与工程路由已注册，并明确输出 `Nest application successfully started`；PowerShell `Get-NetTCPConnection -LocalPort 13001 -State Listen` 证实 **127.0.0.1:13001 在监听**。
- `NODE_USE_SYSTEM_CA=1` 环境下独立执行 `pnpm run verify:oidc:https:readonly`：**React/Vue 共 2 个本机 HTTPS Origin 均返回受控 401 JSON，最终退出码 0**。先前 Vite `ECONNREFUSED` 是 NestJS 依赖注入失败后的连锁影响，现已复测解除；E-018 关闭。安全审计中 `malformed_authorization` 与 401 体现匿名拒绝；启动后观察到的 302 只能说明有重定向响应，**不能直接证明登录成功**。

**验收范围与待办**：本次确认真实 TLS/同源转发/NestJS 匿名拒绝链路可达，以及实际根模块启动成功；没有收到浏览器 OIDC 完整登录、Keycloak `sub` 到隔离库可信主体预绑定、Secure/SameSite Cookie、CSRF 写请求、React ↔ NestJS ↔ Vue 工程版本历史/CAS 往返的实测通过证据。默认 OIDC 关闭策略、数据库隔离和工业只读边界不变。维护者此前在对话中粘贴的本机 Lab 密钥应受控轮换，不在仓库复制或回显。文档追记后新的 `docs:check` 尚未运行。

## 2026-11-16 · 第三十三批第十三小批 OIDC 受控身份绑定候选验证

新增 `scripts/oidc-lab-identity.mjs`，复用服务端现有 `pg` 依赖，严格限制本机 `adui_scada_oidc_lab`、已登记 Keycloak Issuer、HTTPS/Origin/OIDC 配置、用户名/主体标识模式与独立的数据库事务，不提供匿名注册、工程 ACL 授予或设备写入。默认只读预览统一回滚，显式 `--apply --confirm-lab adui_scada_oidc_lab` 才可能写入身份映射。新增 `scripts/oidc-lab-identity.cases.mjs` 的 14 项隔离测试。

已对 GitHub 候选源码执行动态语法编译及测试逻辑模拟：在无 Node 文件系统/数据库网络的 V8 隔离环境载入原脚本主体和原测试回调，用 Mock PostgreSQL 和 URL/Node 断言适配运行，**14/14 通过**（命令参数与 UUID、非生产精确连接约束、只读回滚、事务提交、幂等、非法绑定和 SQL 错误脱敏）。**此结果不等同于 Node.js 22/24 的 `node --test`、仓库 `vp check`、`pnpm run ready` 或真实 PostgreSQL/OIDC 联调通过**。提交后 Windows 必须实跑 `pnpm run test:oidc:identity`、`vp check`、`pnpm run docs:check`、完整 `pnpm run ready`，再经维护者明确选择的 Lab UUID 先预览后写入测试库；真实登录/CSRF/React-Vue 工程操作另行验收。

本批不重新应用已完成的四项 Prisma 迁移，不执行 `down -v`，不轮换或打印本地秘密，不触碰生产数据库。

## 2026-11-16 · 统一本机 Docker Compose 迁移候选验证

新增 8 服务的统一 Compose 文件，项目名 `adui-scada`，3 个现有数据卷使用 `external: true` + 原完整卷名。旧 dev PostgreSQL 和 OIDC Lab PostgreSQL 分属不同服务与卷，不发生同名服务覆盖；Keycloak 数据库地址仅将 Compose 服务主机名从 `postgres` 改为 `postgres-lab`。本机 HTTP Demo 端口与真实 OIDC HTTPS 开发端口保留不同用途。

已在协作环境 Node.js **22.16.0** 执行 `node --check` 与 `node --test`：新增 `scripts/docker-all-dev.cases.mjs` **13/13 通过**，覆盖端口/回环、旧容器检测、3 卷完整性、预检失败不停止旧服务、禁止 `down -v`、显式迁移顺序、统一项目名、Docker 命令白名单与只读状态操作。Python YAML 静态解析确认服务、依赖、外部卷、回环端口及旧数据库 profile 均存在。此为脚本候选的模拟 Docker 验证，**当前环境未安装 Docker CLI**，因此没有执行真正 `docker compose config`、实际容器切换、数据库恢复、Web 浏览器或身份登录复验，不能据此声称迁移已经成功。

Windows 更新分支后应先执行 `pnpm run test:docker:all`、`pnpm run env:check`、`vp check`、`pnpm run docs:check`、完整 `pnpm run ready`，再在人工确认备份与数据卷后显式 `pnpm run docker:all:plan` / `pnpm run docker:all:migrate`，最终 `pnpm run docker:all:ps` 与 Keycloak Discovery、已绑定普通身份、旧开发库和 React/Vue 两端回归。不要删除旧数据卷，不对生产环境执行该操作。

## 2026-11-16 · 单一 PostgreSQL 与唯一 Docker Compose（最新候选）

根据维护者要求，删除三套历史 Compose 和此前八服务临时整合配置，最终仅 `deploy/docker/compose.yaml`（`name: adui-scada`）含 7 项服务、**1 个 PostgreSQL 17 容器**。原 OIDC Lab 物理 PostgreSQL/Redis 卷以 `external: true` 复用，现有 Keycloak Realm、SCADA 身份预绑定以及迁移记录不需要重置；旧开发 PostgreSQL `15432` 不再作为新服务挂载，旧卷暂时保留。Keycloak 与 SCADA 的两个逻辑数据库依然共用同一个实例。

新增 `scripts/docker-stack.mjs` 和 17 项 Node 测试，用白名单核对三个旧项目的容器标签、两份必须存在的卷、唯一数据库与本机端口、完整 Compose 静态配置；默认普通 `up` 拒绝与旧容器并存，显式 `migrate` 仅 stop/rm 已核验旧容器，不调用 `down -v`、`volume rm`。更新 `.env.example` 与 `env:check`，不再公开固定数据库密码或默认指向旧 15432。17 项候选测试回调已在隔离 V8 / 模拟 Docker 环境 **17/17 通过**；这是脚本逻辑检查，**不是**实际 Node `node --test`、Windows `vp check`、`ready` 或真实 Docker 迁移。

下一步需维护者 Windows 检查 `pnpm run test:docker`、`pnpm run env:check`、`vp check`、`pnpm run docs:check`、`pnpm run ready` 和 `docker:plan`，确认 Keycloak/SCADA 可恢复逻辑备份后再显式 `docker:migrate`。请在验收记录中核对两个卷、Keycloak Discovery、现存 SCADA 业务身份、SSE 与 Docker Desktop 仅一个项目组。不自动删除旧开发库卷、不触碰生产数据。

## 2026-11-16 · 单 Compose Docker Windows 首轮验收与 ADR-0066 修复（E-019）

维护者 Windows 实际运行 `pnpm run test:docker`：**17/17 通过**；`pnpm run env:check`：环境配置与 LF 检查通过；`vp check`：**318 个文件格式正确、175 个受检文件零告警/Lint/类型错误**；`pnpm run ready` 已完成 48 文件 **530/530 单元测试**、SSE 8/8、故障代理 4/4、OIDC HTTPS 代理 10/10、OIDC Lab 6/6、身份绑定 14/14、Docker 17/17、HTTPS 只读探针 11/11 和 NestJS **42/42 E2E**。其后 `docs:check` 报 `ADR 状态无效：0066-single-local-compose-project.md`，`ready` 因此中断；不能称完整 `ready` 通过，后续 `build:web` 与 `build:server` 在该次 `ready` 中未执行。

E-019 原因是 ADR 状态行包含验收说明，违反 `scripts/validate-docs.mjs` 的严格枚举状态契约。最小修复为将 `Proposed` 与 Windows 验收说明拆为两行，未修改校验器或 Docker/数据库。当前仅对新增 ADR 状态做同等正则静态核对，**修复后的 Windows `pnpm run docs:check`、完整 `ready` 尚待维护者执行**。后续进行一次性 `docker:migrate` 前，仍须确认现有 PostgreSQL 逻辑备份可恢复，绝不删现有数据卷。

## 2026-11-16 · 唯一 Docker 项目全新安装候选（旧数据无备份）

按维护者最新状态，旧 Docker 项目及旧数据卷都已删除且无数据库备份。Docker 现在只需建立 `adui-scada`，七个服务、一个 PostgreSQL 容器、两个新命名卷。业务库 `adui_scada` / Keycloak 逻辑库 `adui_scada_keycloak` 在同一 PostgreSQL 中隔离。取消旧卷强制检查和 `docker:migrate`，初次 `docker:up` 完成 Compose 启动后自动执行 Prisma `migrate deploy`；追加 `docker:db:init` 提供幂等手动重试。

新测试覆盖单项目/单 PostgreSQL/新存储卷、回环端口限制、拒绝旧数据库 URL、禁止自动清理历史容器、随机本机凭据及 Prisma URL 安全规则。原先 17 项旧卷迁移测试被全新安装测试替代；Windows `pnpm run test:docker`、`test:docker:db`、`test:oidc:lab`、`test:oidc:identity`、`vp check`、`docs:check`、`ready` 和实际 Docker/Prisma/Keycloak 联调均待实跑，不得声称旧数据库、会话或用户已恢复。

当前改动不执行任何 Docker 删除操作，不触碰生产设备/数据库；不恢复、清空或重置历史数据。

## 2026-11-16 · PostgreSQL 统一端口 15432 的配置与测试修订

在唯一 `adui-scada` 新安装方案上，仅将 PostgreSQL 宿主机映射以及 `.env.example` 的 `SCADA_DB_PORT` / `SCADA_LAB_POSTGRES_PORT` 从 15433 统一改为 **15432**，Compose 内部保持 5432。同步调整 `scripts/check-env-config.mjs`、`docker-stack.mjs`、`init-docker-db.mjs` 与 Docker、OIDC、凭据相关测试默认值，并把测试里“错误端口”调整为已废弃的 15433；未修改数据库名称、Schema、Keycloak Issuer、数据卷与安全限制。最新部署说明以 `docs/HARNESS.md` 对应章节及 ADR-0066 为准；早期日志中的 15433 是历史记录，不代表当前预期。

修改后必须在 Windows 实际运行 `pnpm run test:docker`、`test:docker:db`、`test:oidc:lab`、`test:oidc:identity`、`env:check`、`vp check`、`docs:check` 与完整 `ready`；随后确认 15432 空闲，使用新根 `.env` 实行 `docker:plan`、`docker:up` 和 `docker:ps`，再验证 Prisma 迁移与 Keycloak。未经实跑不能宣称任何一项 Windows 或 Docker 真实验证通过。

## 2026-11-16 · 新 Docker 数据库迁移实际成功、status 凭据不一致（E-021）

维护者 Windows 已运行 `pnpm run docker:db:init`，Prisma 实际连接 `127.0.0.1:15432/adui_scada`，4 项迁移首次成功应用，输出 `All migrations have been successfully applied.` 和 `全新业务数据库 Prisma 迁移完成`，最终退出码 **0**。随后 `pnpm run db:migrate:status` 报 P1000（数据库用户密码认证失败）并退出 1；`docker exec adui-scada-postgres-1 pg_isready -U adui_scada -d adui_scada` 接受连接，容器内 `SELECT 1` 返回 1。根据当前仓库代码，前一个命令从 Git 忽略的 `.local/docker/secrets.env` 读取随机密码，后一命令从仓库根 `.env` 读取此前配置的历史静态密码；已检查维护者粘贴的 `.env` 确实存在旧固定密码及旧 OIDC Client Secret 与密钥。P1000 为凭据不匹配，不是迁移未应用，也不能因容器内 Unix Socket 查询成功推断宿主机密码有效。

新增专用只读 `docker:db:status`，复用 `init-docker-db.mjs` 已建立的随机凭据/数据库校验，通过 Node 直接启动 Prisma `migrate status`，覆盖旧进程环境变量而不输出/回写秘密；通用 `db:migrate:status` 语义不变。补充测试校验命令白名单、旧根 URL 和进程密码覆盖及旧数据库/远程连接拒绝；不修改 Prisma Schema、历史迁移、Docker 卷和 OIDC 权限。

**补丁后的真实验证尚未完成**：Windows `test:docker:db`、`env:check`、`vp check`、`docs:check`、完整 `ready`、新命令 `docker:db:status` 均待运行。已成功的四项真实迁移无需重新部署或重置。

## 2026-11-16 · E-022：Docker 状态查询后完整 ready 在中文日志检查阶段中止

维护者 Windows 真实运行 `pnpm run test:docker:db` **9/9 通过**；`pnpm run docker:db:status` 使用新 Docker 随机凭据连接 `127.0.0.1:15432/adui_scada`，Prisma 报 `Database schema is up to date!` 且成功输出中文完成消息。单独 `vp check`：320 个文件格式正确、177 个受检文件零警告/Lint/类型错误；单独 `pnpm run docs:check`：84 份 Markdown 通过。但本次 `pnpm run ready` 在依赖/共享配置/环境检查通过后，`pnpm run messages:check` 报 `scripts/init-docker-db.mjs:104：日志文案缺少中文`，整条 `ready` 退出码 1，**后续生成、单测、E2E 与构建没有在本次 ready 中执行**。

检查仓库源码确认：原有静态检查器在日志调用所在行同时检出 `console.log`、英文 `"status"` 且没有中文，因此尽管分支函数实际返回中文，也被判为违规。E-022 仅将计算分支与 `console.log(result)` 分开，不修改检查器、测试用例、Prisma 凭据、数据库或 Docker。候选已用原检查器的日志行正则核对，不再触发该条规则；**Windows 修复后 `messages:check`、`vp check`、`docs:check`、完整 `ready` 仍待实际运行与退出码确认**。

## 2026-11-16 · 第三十三批 HTTP 安全边界回归候选

维护者提供的最新 Windows 日志确认 E-022 修复后完整 `ready` 退出码为 0，单测 530/530、NestJS E2E 42/42、两个 Web 及 NestJS 构建成功。后续由维护者在新 Docker 环境中成功提交并只读核对 OIDC 身份映射，在 React/Vue 两端实际读取相同可信主体，并完成 Cookie 属性、React CSRF 缺失/错误拒绝、合法注销及 Vue 跨端 401 验收；React/Vue 服务端工程历史、CAS 冲突与 IndexedDB 草稿保护六项流程亦得到维护者人工确认。以上不代表生产安全验收完成。

本轮最小测试补丁只补充 `apps/server/test/oidc-auth.controller.e2e-spec.ts` 的三项 HTTP 层安全回归：不可信 Origin、缺失或非 `same-origin` 的 Fetch Metadata、Bearer 与浏览器 Cookie 混用。拒绝请求须为 403/401 且不得调用撤销服务，审计须输出固定失败原因码；不修改正式 Guard、会话、Cookie、数据库或工程 API。

**尚待 Windows 验收**：本测试候选的 `pnpm run test:e2e:server`、`vp check`、`pnpm run docs:check` 和完整 `pnpm run ready` 均未在维护者机器执行。旧 Session 令牌持久化撤销、会话过期、跨租户 ACL 及生产反向代理属于独立专项；不得把 Mock E2E 当作真实数据库验收。

## 2026-11-16 · 第三十三批 HTTP 安全回归 Windows 验收完成

维护者在 Windows PowerShell 对本批 HTTP 拒绝测试执行了独立 `pnpm run test:e2e:server`：**6/6 文件、45/45 项通过**（OIDC Controller 12/12）；`vp check` **320 个格式文件、177 个受检文件零警告/错误**，`docs:check` **84 个 Markdown 通过**。完整 `pnpm run ready` 实际完成：中文文案 201 文件、单测 **48/48 文件、530/530 项**、SSE 8/8、TCP 故障 4/4、OIDC 代理 10/10、凭据 6/6、身份预绑定 14/14、Docker 单栈 14/14、数据库保护 9/9、HTTPS 匿名探针离线 11/11、服务端 HTTP E2E **45/45**，React/Vue 与 NestJS 构建成功，最终打印 **“第三十三批安全回归退出码：0”**。健康检查测试中的预期 503 日志不代表 E2E 失败。此处为维护者提供的真实 Windows 日志，不代表部署或生产工控安全验收。

本轮下一项只增强已有 `apps/server/test/prisma-project-version.db-spec.ts`：真实 PostgreSQL 下校验 Session/CSRF 的 SHA-256 持久化、外国租户撤销不生效、合法撤销将 `revokedAt` 落库、旧 Bearer/Cookie 失效、停用主体和过期会话的 Cookie 拒绝。现有隔离数据库测试已经覆盖跨租户 ACL 与真实并发 CAS，不再重复新建测试文件。**本次新增的数据库断言尚未在 Windows `adui_scada_test` 执行，必须单独运行 `pnpm run test:db`，不属于默认 `ready` 的覆盖范围。**

## 2026-11-16 · 第三十三批独立 PostgreSQL 22/22 与最终质量链实测

维护者在 Windows PowerShell 7 上明确将 `SCADA_DATABASE_URL` 和 `SCADA_TEST_DATABASE_URL` 临时指向本机回环 `127.0.0.1:15432/adui_scada_test`；该库与业务库 `adui_scada`、Keycloak 库 `adui_scada_keycloak` 逻辑隔离。执行 `pnpm run db:migrate:deploy` 首次成功应用四项原有 Prisma 迁移（`20261112000000_init_scada_projects`、`20261112170000_add_chinese_table_comments`、`20261113000000_trusted_identity_sessions`、`20261114000000_oidc_identity_transactions`），随后 `pnpm run db:migrate:status` 明确返回 `Database schema is up to date!`。

在上述明确的隔离测试库中执行 `pnpm run test:db`，**3/3 文件、22/22 用例通过**：OIDC Schema 5/5、工程版本/Session 11/11、工程 API 6/6。此次覆盖新增的 CSRF/Session SHA-256 持久化检查、`revokedAt` 真实落库、旧 Bearer/Cookie 会话撤销后拒绝、主体停用/到期拒绝，以及既有跨租户 ACL 和 PostgreSQL 并发 CAS。测试命令完成后输出维护者自定义的中文成功提示；独立测试输出未额外打印数值退出码，不据此编造独立的退出码统计。

维护者随后重新执行 `vp check`：**320** 个文件格式正确，**177** 个文件零警告、Lint/类型错误；`pnpm run docs:check`：**84** 个 Markdown 通过；完整 `pnpm run ready` 顺利运行至 NestJS 构建完成，单测 **48/48 文件、530/530 项**、HTTP E2E **6/6 文件、45/45 项**，SSE 8/8、TCP 故障 4/4、OIDC HTTPS 代理 10/10、OIDC Lab 6/6、OIDC 身份预绑定 14/14、Docker 安全 14/14、Docker DB 9/9、HTTPS 匿名探针离线 11/11，React/Vue/NestJS 构建成功。日志中末尾 `if ($LASTEXITCODE -ne 0) { throw "完整质量链失败" }` 未触发；**未单独打印 `ready` 数值退出码**。健康检查负面用例产生预期 503 日志，不是 E2E 失败。

**结论**：第三十三批本机 OIDC / 工程版本主业务链路、HTTP 拒绝及真实隔离 PostgreSQL 安全回归的本轮验收已完成。该结论不包括生产/现场部署安全评估、真实密钥暴露后的受控轮换证明、跨浏览器实际恶意站点演练，也不将离线 Mock 检查等同于生产安全审计。没有运行数据库 reset、删除数据卷或修改既有 Prisma 迁移。

## 2026-11-16 · PR #55 静态审查 P1 / P2 资源边界修复候选

根据提交 `7cafdbcc` 的正式 COMMENT Review，针对匿名 OIDC start 缺乏资源保护与快照 2 MiB 容量边界错误，实施**最小受控补丁**：

- OIDC start 在每个进程中实行 60 秒固定窗口最多 60 次、同时最多 8 个未完成请求，超额返回受控 HTTP 429；使用单进程全局计数，不信任代理用户 IP。生产公网或多实例使用必须由可信反向代理追加统一限流和连接配额。每 30 秒批量查找并删除最多 128 条已过期登录事务，按过期时间排序，删除时重复核验 `expiresAt`，避免误删仍有效的 State；清理失败只输出固定中文告警并等待下一周期。没有新增依赖、Prisma 字段或迁移。
- 工程请求解析仍使用 Core 的 2 MiB 校验；创建完整快照时额外的版本元数据可能使最终 JSON 超限，现将该确定的 `RangeError` 转为受控 `ProjectRequestValidationError` / HTTP 400，保留非容量异常、CAS 与事务回滚语义。新增生成靠近 2 MiB 容量边界的单元用例与 Mock HTTP 状态测试。
- 增加 OIDC 60 次窗口限额、8 个并发拒绝、128 条批次回收用例。仅服务端及其测试修改，Vue/React 共用 API 协议和本地 IndexedDB 未变。

**候选验证状态**：GitHub 已创建补丁，但尚未执行 Windows `vp check`、`pnpm run test:unit`、`pnpm run test:e2e:server`、`pnpm run test:db`、`pnpm run docs:check` 或完整 `pnpm run ready`；不能继续使用上轮的 530/530 和 45/45 作为新提交通过证据。实际通过前不改变 PR Draft 或合并状态。清理服务定时启动和 429 的真实 HTTP 行为还需独立测试环境校验。

补充：OIDC Controller HTTP E2E 使用受控 Mock 返回 429，验证匿名登录超额请求不再下发 Cookie；服务层单元测试独立验证限额计数和并发释放。此项是候选新增用例，尚未经 Windows 执行。

本轮额外新增 `apps/server/test/oidc-schema.db-spec.ts` 的隔离 PostgreSQL 真库验证：使用本机强制白名单 `adui_scada_test`，插入 2000 年到期事务和当前有效事务，通过实际 Prisma 清理后分别核对删除与保留；`finally` 删除本用例创建的记录。原有 `test:db` 22 项预计增至 23 项，但**当前只是候选代码，尚未执行真实数据库**，不得称测试已通过。

## 2026-11-16 · 第三十四批第一小批工程列表有界分页（候选，待 Windows 验收）

本批基于已合并 `main@412a5475`。服务端 `GET /api/v1/projects` 保持摘要数组和同源认证，但查询默认 20、最大 100，`afterProjectId` 严格白名单且按工程 ID 升序，数据库依旧过滤可信租户与 `project:read`。Core 新增 `ProjectListQuery`，API Client 的 `listProjects(query?)` 与 React/Vue 共用请求、安全校验及响应顺序检查。

新增回归：非法/额外查询字段、重复 Query 参数、页面大小与游标限制；客户端越界或乱序响应拒绝；HTTP 200 转发/400 领域错误；独立 `adui_scada_test` 真库跨租户、第一页/末页与耗尽条件。**所有新增代码与测试当前尚未在 Windows 执行 `vp check`、`pnpm run ready`、`pnpm run docs:check` 或隔离 `pnpm run test:db`，不以此前第三十三批通过结果冒充新代码已验收。** 真实 PostgreSQL 测试必须仅在已确认的本机 `adui_scada_test` 执行，绝不能连接业务库 `adui_scada` 或清理任何 Docker 持久卷。

## 2026-11-16 · 第三十四批第二小批：Vue/React 授权工程列表和显式打开（候选）

基于已合并的 `main@30aa9908` 新建功能分支。新增共享工程列表游标会话的单元覆盖、两个 Studio 工程管理入口及统一的分页样式。浏览器中的服务端工程列表只在用户展开面板时发请求，继续使用固定同源 `/api/v1/projects`、受保护会话和租户 ACL。打开工程复用既有 SHA-256、当前 headRevision 与主体校验，且必须经人工确认和自动保存停止；取消、401/403/404、工程在网络等待期间已被切换或服务端水位变化时，不应改变原画布与 IndexedDB 草稿。

**待维护者 Windows 验证**：`vp check`、`pnpm run messages:check`、`pnpm run docs:check`、`pnpm run ready` 完整退出码；React/Vue 实际 OIDC 同源 HTTPS 业务浏览器流程需要分别验证 1440×900、1024×768：打开工程管理、授权列表前后翻页、未登录拒绝、远端版本变化拒绝、取消保持画布、确认打开且 CAS 基线正确、草稿原记录和修订号不变、自动保存停止、再按新工程重新查看本地草稿。无真实 OIDC 环境时允许只验收匿名拒绝，不得冒充真实登录、工程切换通过。数据库层沿用 PR #56 已验收的分页查询，无新增迁移或数据库写入专项，不能把第一小批测试结果宣称为本小批新测试通过。

原第三十四批第一小批 Windows 本机结果：`vp check` 321/177 零告警，`ready` 537/537 单测、49/49 HTTP E2E、85 Markdown 和两 Web/NestJS 构建退出码 0；`test:db` 23/23 退出码 0。此为上一小批的事实基线。

## 2026-11-16 · 第三十四批第三小批：OIDC 工程管理真实浏览器专项（待验收）

基于 PR #57 合并提交 `c426d26855d3d707a75869f8c770b65e8b55c82f` 新增 `test:projects:oidc:config`（7 项离线安全配置用例并纳入 `ready`）以及需人工完成可信 Keycloak 登录的 `test:projects:oidc:browser`。使用 Chrome/Edge 临时 Profile、Node 可信 CA、真实 React/Vue HTTPS Origin 和有权限的隔离 Lab 工程。测试读取列表与修订号，确认两套 Studio 前后页状态（有足量授权工程时），取消打开与模拟 GET 水位冲突时不得改画布、自动保存和已保存草稿；确认载入最新版本后须具有可见 CAS 基线，暂停自动保存且保存前后 IndexedDB 草稿摘要一致。另验证服务端工程不会被新增或覆盖，浏览器 Profile 结束后清理。

**当前仅提交候选源代码与测试，并未在维护者 Windows 实际运行**：`pnpm run test:projects:oidc:config`、`vp check`、`pnpm run messages:check`、`pnpm run docs:check`、`pnpm run ready` 及交互式 `pnpm run test:projects:oidc:browser` 全部待执行。不得把 PR #57 的 544/544 单测、49/49 E2E、76/76 通用浏览器基础回归或维护者人工验收冒充为本次新增脚本已执行。配置检查与登录专项不能代替生产 TLS/IdP/数据库安全评估；水位竞争只在浏览器读取响应中模拟，不是实数据库事务冲突。

## 2026-11-16 · 第三十四批第三小批 Windows 首次质量链失败与 E-023 最小修复候选

维护者本机原始日志：`pnpm run test:projects:oidc:config` **7 项中 6 通过、1 失败**，报 `assert.throws` 的正则 `/必须显式启用可信 OIDC 开发代理/` 与共享 HTTPS 探针真实异常“只读 HTTPS 探针要求显式启用可信 OIDC 开发代理”不一致。随后 `vp check` **328 个文件格式正确、183 个受检文件零警告零错误**；`pnpm run ready` 在相同新增离线安全测试处终止，退出码 **1**。其前置质量环节、单测 **49/49 文件、544/544 项**、SSE / OIDC / Docker 的其他离线检查均通过；**本次 `ready` 没有执行到后续 NestJS HTTP E2E、`docs:check` 和 React/Vue/NestJS 构建，不能声称完整通过**。

排查确认拒绝非法配置的生产逻辑正常执行，问题仅在测试断言错用了“必须”而不是实际共享错误的“要求”。E-023 修复候选仅使 `scripts/test-project-browser-oidc.cases.mjs` 中该正则与真实共享异常一致，**不修改** `resolveReadonlyProbeOrigins`、业务接口、Keycloak、数据库或 TLS 安全策略。当前尚无修复后 Windows 命令退出码。维护者需依次重跑 `pnpm run test:projects:oidc:config`、`vp check`、`pnpm run docs:check` 和完整 `pnpm run ready`；交互式 `test:projects:oidc:browser` 仍属独立待执行验收，离线 7/7 不能替代真实 OIDC 登录。

## 2026-11-16 · 第三十四批第三小批真实 OIDC 登录成功后浏览器阶段故障（E-024）

维护者 Windows `pnpm run test:projects:oidc:browser` 实际进入隔离 Chrome/Edge，Keycloak 登录成功，脚本输出“真实 OIDC 会话已在 React Origin 验证”，说明 React BFF `/api/v1/auth/me` 已返回可信身份；随后直接报告“浏览器页面操作失败，请检查当前 Studio 状态”，退出码 **1**，Vue 尚未开始专项验收。测试 `finally` 关闭临时浏览器是凭据安全清理行为，非 IdP 主动踢出。**真实后续页面异常的具体成因未被当前日志区分，不能认定为工程 API/ACL 已通过或失败。**

E-024 最小修复为交互式验收增加 React/Vue **静态阶段进度**、CDP 异常白名单类别诊断、列表 API 的仅 HTTP 状态码反馈，且在没有已授权工程时保留固定中文引导；不输出浏览器堆栈、Cookie、Token、工程正文或数据库连接字符串，不更改认证/授权行为，不把测试 Browser Profile 保留给用户。新增 3 项离线异常分类/泄密防护用例，离线总数由 **7 增至 10**（待 Windows 实测）。已确认服务端载入快照还要求 `version:read`，仅拥有 `project:read` 不足以完成载入验收；请由维护者在隔离 Lab 受控核对现有权限，不自动执行任何 ACL 或数据库写入。

**此刻仅有补丁代码与静态核对，没有修复后 Windows 实测**。待执行 `pnpm run test:projects:oidc:config`、`vp check`、`pnpm run docs:check`、`pnpm run ready`，以及完成真实 OIDC 登录后重跑 `pnpm run test:projects:oidc:browser`，记录最后显示的受控阶段、退出码与是否完成 Vue。新增异常诊断不能代替真实数据库 CAS 并发验收。

## 2026-11-16 · 第三十四批第三小批：真实工程分页通过后 IndexedDB 状态快照触发 E-025

维护者本机上传的完整 PowerShell 日志确认：`pnpm run test:projects:oidc:config` **10/10**、`vp check` **328 文件格式通过/183 受检零告警**，完整 `pnpm run ready` **544/544 单测、49/49 HTTP E2E、86 Markdown 及 React/Vue/NestJS 构建**成功、退出码 **0**。真实 `pnpm run test:projects:oidc:browser` 已完成 Keycloak / React BFF 会话、工程列表、工程管理摘要与分页步骤；在“React：正在验证临时 IndexedDB 草稿保存与自动保存”阶段报 **“浏览器页面操作失败：页面脚本引用异常”**，最终退出码 **1**；尚未执行 Vue 部分、取消保护、冲突注入与 CAS 基线。浏览器自动关闭是 `finally` 清理临时测试 Profile，不是 OAuth 会话丢失。

检查 PR #58 源码后确定，`stateInPage()` 在 CDP 独立页面上下文执行时直接引用 Node 模块的 `readBrowserDraftsInPage()`，符合 E-002 的已知跨作用域失败；本次作为 **E-025** 回归。最小修复将页面 DOM 状态和 IndexedDB 草稿摘要分为两个独立的 `session.evaluate` 调用，在 Node 侧组合结果，保留原四处画布、自动保存、草稿哈希和 CAS 断言。同步新增 1 项离线动作序列化测试，离线预计由 **10 增至 11**，安全开关、登录、服务端 API、Prisma、生产数据和设备写入全部不变。

**修复后尚无 Windows 运行结果**；需要重新执行 `pnpm run test:projects:oidc:config`、`vp check`、`pnpm run docs:check`、完整 `pnpm run ready` 和 `pnpm run test:projects:oidc:browser`，验证双端直到 CAS 和草稿保护全部通过。此前完整 `ready` 退出码 0 只对应修复前 HEAD，不能当作本提交质量链通过证据。

## 2026-11-16 · 第三十四批第三小批 E-026：模拟冲突后旧错误提示导致确认载入误判

维护者 Windows 最新真实日志：`test:projects:oidc:config` **11/11**、`vp check` **328 文件格式正确、183 受检文件零错误**、`docs:check` **86 Markdown**、完整 `pnpm run ready` **544/544 单测、49/49 HTTP E2E、React/Vue/NestJS 构建通过，退出码 0**。交互式 `test:projects:oidc:browser` 已通过真实 Keycloak 登录、React BFF、授权工程列表/分页、临时 IndexedDB 草稿、自动保存、取消载入和模拟远端水位冲突阶段；随后在“React：正在验证确认载入与 CAS 基线”阶段报告“服务器工程载入阶段返回受控错误”，退出码 **1**，尚未进入 Vue。

结合真实代码分析，前一次模拟冲突**故意设置**服务端错误提示；测试 `openProjectInPage` 在下一次点击“打开”后直接读取同一错误节点并立即判错，没有等待新 `runServerAction` 清除旧错误与启动操作。这个测试竞态与症状吻合，**现有日志无法单独证明真实确认载入请求已失败或成功**。本次最小修复在页面测试动作中记录点击前错误，只有观察到新的忙碌状态或错误变化，且新操作不再进行中时，才允许对当前真实错误作失败判断；成功分支仍必须满足确认回调和“CAS 基线已建立”。补充两项正反回归，离线配置/测试预计由 **11 增至 13**。不修改 React/Vue、API Client、OIDC、数据库、Prisma、TLS、工业设备接口或任何现有真实安全断言。

**当前 HEAD 尚未执行 Windows 修复后测试**。维护者应先执行 `pnpm run test:projects:oidc:config` 与 `vp check`、`pnpm run docs:check`，然后独立重跑 `pnpm run test:projects:oidc:browser`；双框架真实 OIDC 专项成功后再完成全链 `pnpm run ready` 确认。隔离浏览器在成功与失败后均按凭据安全策略自动关闭，不能以窗口关闭本身判定成功与否。

## 2026-11-17 · 第三十四批第四小批真实多页与双主体 CAS 候选验收

基于 PR #58 合并提交 `d95ee4d15bec64a047c519fde7b5f98b837cca05`，新增隔离测试数据库 `apps/server/test/project-api.db-spec.ts` 的 12 项授权工程真实游标分页与同租户不可见工程验证，以及 `apps/server/test/prisma-project-version.db-spec.ts` 的两个独立 Prisma 连接/两个授权主体抢同一 `expectedRevision` 的真实 PostgreSQL CAS 原子性与审计操作者核验。只在已显式配置的本机独立 `adui_scada_test` 执行真实数据库读写，随机测试租户限定数据范围；预计真库独立用例从 23 增至 25。没有更改 NestJS API、数据库迁移或任何工业设备写入。

`scripts/test-project-browser-oidc.mjs` 保留原成功的普通交互式模式，新增 `--require-multipage` 强制 React/Vue 均访问过真实有数据的第二页并返回；根命令为 `test:projects:oidc:browser:pages`。未人为准备当前主体至少 11 个已授权工程时严格测试必须非零退出；脚本不修改运行中 Lab 工程/授权。新增一项离线模式约束测试（预计 14 项）随 `ready` 执行。

**当前仅为 GitHub 候选代码与静态差异**：新 `test:projects:oidc:config`、`vp check`、`docs:check`、`ready`、真实 `test:db` 和真人 `test:projects:oidc:browser:pages` 均待维护者 Windows 验收。此前 PR #58 的 13/13、544/544、49/49、真实双端 OIDC 专项退出码 0 不能替代本 HEAD 的测试结果。真实 BFF 两会话 HTTP CAS/409 与生产工业安全验收仍未覆盖。

## 2026-11-17 · 第三十四批第四小批本机 Lab 多页测试数据准备（待 Windows 运行）

维护者提供的 Windows 日志已确认前一候选：`test:projects:oidc:config` **14/14**、`ready` **544/544 单元测试、49/49 HTTP E2E、退出码 0**；本机独立 `adui_scada_test` 四项迁移最新，`test:db` **3/3 文件、25/25 项、退出码 0**。独立严格浏览器 `test:projects:oidc:browser:pages` 在 React 分页阶段因未覆盖有效第二页而退出码 **1**，Vue 未进入该轮测试。此失败不构成真实分页业务逻辑错误或 PostgreSQL CAS 失败。

本次新增 `oidc:lab:projects:pages` 显式数据准备命令，复用既有隔离 Chrome/Edge 浏览器与 Keycloak 真人登录；入口必须 `--prepare-multipage --confirm-lab adui_scada`，并复用可信 OIDC Lab 环境/数据库安全白名单。通过登录后的 BFF Session 和 CSRF 向当前测试主体发起正式工程创建请求，只补齐至 11 项授权工程。空白 `ScadaDocument 0.3.0` 不含现存工程的数据。旧工程、现存 ACL、迁移、业务接口与工业设备权限不修改；测试数据新建后保留，不自动清理。

新增四项纯离线保护与状态回归（配置门禁、已足额时零写入、补齐与重复执行、跨 Origin / 缺失 CSRF 拒绝），预计该文件 **18/18**，但**尚无维护者 Windows 的 Vite+、完整 ready、真实浏览器数据准备或严格 React/Vue 多页成功日志**；此前 14/14 不能冒充新候选通过。GitHub 原始 JavaScript 已完成有限的 V8 语法解析与模拟 Fetch 行为核对，不等同于仓库完整质量链或真实 PostgreSQL 写入。执行前应人工确认当前 NestJS 实际连接的 Lab 数据库和根环境一致，运行后独立执行严格多页验收。

## 2026-11-17 · 第三十四批第五小批双 BFF Cookie HTTP CAS 候选验证

以已合并 PR #59 的 `main@4c3cb0d7` 为起点，新增 `apps/server/test/projects-cas-cookie-http.db-spec.ts`，仅在现有独立 `vitest.config.db.ts` 下执行真实 PostgreSQL HTTP 集成测试。四项用例使用两个不同 `active` 主体通过内部 `AuthSessionService.issueForVerifiedSubject` 获取独立短期 BFF Cookie + CSRF；真正的 NestJS Session Guard、Project Guard、Project API Controller、Prisma 仓储与本机隔离 PostgreSQL 处理请求。核验 HTTP 201/409 竞争，水位 2、两个 SHA-256 版本、成功审计操作者、旧版本再次提交 409，及错误 CSRF / Origin / 凭据混用 / ACL 的拒绝路径。独立 `test:db` 预计由原 25 项增加至 **29 项**，尚待 Windows 实际验收。没有改变业务接口、数据库 Schema/迁移、客户端、工业协议或权限行为。

**验证证据边界**：候选文件已进行 TypeScript 语法解析及有限 transpile 检查（无语法诊断），但当前协作容器无仓库可安装的 pnpm/Vite+ 项目依赖、无用户本机 PostgreSQL，不具备对本次 Head 执行真实 `vp check`、`test:db`、`ready` 的条件。必须以维护者实际 Windows 日志和退出码为准。第四小批真实 Keycloak React/Vue 严格多页通过记录仍然有效，但两份 Cookie 在**本隔离测试里不是分别通过真实 Keycloak 授权码回调建立**；不得扩写为 IdP 双登录验收。

## 2026-11-17 · 第三十四批第五小批 Windows 完整验收记录（PR #60）

维护者在 Windows 本机 `D:\Workspace\adui-studio\adui-scada` 针对第五小批候选执行实际质量检查，并提供完整运行日志：

- `pnpm run test:projects:oidc:config`：**18/18** 通过。
- `vp check`：**329** 个文件格式正确，**184** 个受检文件零警告、Lint 或类型错误；此前 `vp check --fix` 的 `typescript(require-array-sort-compare)` 一条警告已通过显式数值比较器修复。该问题记录为 E-027。
- `pnpm run docs:check`：**86** 个 Markdown 文件通过。
- `pnpm run ready`：依赖/配置/环境/中文文案与核心构建通过；**49/49 文件、544/544 单元测试**；SSE、OIDC 代理、OIDC Lab、身份、Docker、HTTPS、浏览器离线保护及服务器 E2E 专项均执行成功；**6/6 文件、49/49 NestJS E2E**；React、Vue、NestJS 均构建完成，**最终退出码 0**。
- `pnpm run test:db`：本机显式隔离 PostgreSQL 测试 **4/4 文件、29/29 用例通过，退出码 0**。其中新增 `projects-cas-cookie-http.db-spec.ts` **4/4**，包含两个不同可信主体持久化 BFF Cookie/CSRF 会话竞争相同修订号，真实 HTTP **201/409** 以及最后历史版本、事务水位、成功审计操作主体一致性。

**验收边界**：此次真实 Cookie 会话由服务端测试接口为两个受控可信主体签发，并不是分别经真实 Keycloak 授权码流程建立两次会话；不代表企业 IdP、生产 TLS 或跨进程部署验收。没有修改工业设备写入权限或既有业务数据库/卷。

**提交与复验边界**：维护者日志未包含 `git rev-parse HEAD` 与 `git status --short`，因此不能独立证明日志所运行的本地提交 SHA 与 PR 的每一个 GitHub Blob 完全相同。本次将 E-027 和最终验收结果补充到仓库文档后，仅文档 HEAD 发生变化；仍需运行 `pnpm run docs:check` 核对新文档版本。真实数据库 29/29、已有代码的 `ready` 成功不因文档变更被改写为失败，但不冒充**文档新提交后**已重新执行完整质量链。

## 2026-11-17 · 第三十四批第六小批真实双 Keycloak 主体候选

新增独立 `scripts/test-oidc-dual-cas.mjs`、`scripts/test-oidc-dual-cas.cases.mjs`，以及根命令 `test:oidc:dual:config`（新增 11 项、加入 `ready`）、`test:oidc:dual:preflight` 和 `test:oidc:dual:cas`。首个模式只验证两份来自真实 Keycloak 授权码登录的独立 BFF 会话对应同租户不同主体；写入模式除固定 `--run-cas --confirm-lab adui_scada` 外还须通过已有本机 Lab 配置白名单，在独立专用空白工程上执行受控授权、真实 HTTP CAS 201＋409、PostgreSQL 历史/审计核对。不触碰其他工程、工业设备或生产数据库。

候选源码完成了**有限 V8 语法解析与模拟页面/SQL 行为核对**，包括不完整命令拒绝、相同主体拒绝、专用工程 ID 限制、单次新建、错误脱敏、固定 ACL 授权；未在用户 Windows 运行真实 Node 测试、`vp check`、完整 `pnpm run ready` 或两次 Keycloak 真人登录，也没有访问本机 PostgreSQL。完整候选状态必须以维护者终端日志及退出码为准。第六小批与第五小批已有的双 BFF Cookie HTTP 真库 29/29 通过证据不同，不能冒充本批真实双 Keycloak 登录已通过。

## 2026-11-17 · 第三十四批第六小批 Windows 质量链通过、真实双身份条件未满足

维护者实测最新候选（身份错误诊断细分**之前**）：`pnpm run test:oidc:dual:config` **11/11**，`vp check` **331 个格式文件 / 186 个受检文件零警告、Lint 或类型错误**，`pnpm run docs:check` **86 个 Markdown**，完整 `pnpm run ready` **544/544 单元测试、49/49 NestJS HTTP E2E、React/Vue/NestJS 构建成功、最终退出码 0**。此前 `vp check --fix` 的 3 条 `eslint(no-unused-vars)` 已经最小删除并由维护者复验关闭，记录 E-028。

随后在真实本机隔离 Keycloak Lab 执行：

- `pnpm run test:oidc:dual:preflight`：两个浏览器均已到达真实登录后的身份比较，失败提示“**两次登录必须属于同一可信租户的不同主体**”，退出码 **1**。
- `pnpm run test:oidc:dual:cas`：同样在身份比较阶段失败，退出码 **1**；**尚未进入创建专用工程、授予该工程 ACL 或提交 HTTP CAS 阶段**。正常 OIDC 登录可能生成本地短期会话，但无本批专用工程写入证据。

由于现有诊断把“同本地主体”和“跨租户”合并，**当前不知哪一条件触发**，不能认定第二位用户必然没有绑定、两次登录必然同一账户，更不能归因于 CAS 数据库事务。补丁仅在 `requireDifferentSubjects` 中将两种错误拆为固定、脱敏的中文类别，并在第二次登录前提示更换账号；测试更新为分别断言对应失败消息，身份拒绝逻辑未放宽。诊断不足记录 E-029。

**仍待 Windows 复验**：最新 HEAD 的 `test:oidc:dual:config`、`vp check`、`docs:check`、`ready`；随后只跑 `test:oidc:dual:preflight` 检查两个不同 Keycloak 账号是否绑定到同一受控租户。**只有预检通过并明确确认当前 NestJS 实际连接本机 `adui_scada` Lab 后**才应执行会写入的 `test:oidc:dual:cas`。没有真实的双用户 201/409 结果，PR 仍 Draft，不合并。

## 2026-11-17 · 第三十四批第六小批真实双 Keycloak CAS 验收通过

维护者 Windows 在本机受控 OIDC Lab 先运行 `pnpm run test:oidc:dual:preflight`：两个独立浏览器分别通过真实 Keycloak 登录普通用户 `adui` 与 `test`，BFF 服务端确认属于同一可信租户、不同本地主体，终端显示“只读预检通过；没有创建工程或修改授权”，**退出码 0**。此前身份校验阶段失败已在真实身份预绑定核对后解除，不需弱化校验。

随后维护者执行显式写入命令 `pnpm run test:oidc:dual:cas`，**退出码 0**。日志确认两个独立 Keycloak/BFF 会话通过主体和租户校验，正式 HTTP API 在本机 Lab 创建专用空白工程 `b34-oidc-cas-0d3b3199-24ec-4740-b9cb-5c7a6087f7ad`，第二主体仅取得该新工程的限定 ACL；两个浏览器实际读取首版后对 `expectedRevision=1` 并发保存，返回**恰好一次 HTTP 201 与一次 HTTP 409**，最终修订号 **2**、真实 PostgreSQL 成功版本与审计主体一致，双方读取最终快照一致。专用工程及审计记录按设计保留供复核，**无需重建、不得无故清理数据库卷**。

**验收范围**：本次证据覆盖真实的两位 Keycloak 用户、两个隔离浏览器、React/Vue HTTPS Origin 的同源 BFF 请求、同一专用工程的服务端 ACL 与 PostgreSQL CAS；不证明多服务进程部署、生产 TLS 基础设施或工业现场安全。维护者此前已对本批诊断修复前候选提供 `test:oidc:dual:config` **11/11**、`vp check` **331/186 零告警**、`docs:check` **86 份**、完整 `ready` **544/544 单测与 49/49 E2E、退出码 0**。此次日志**未附 `git rev-parse HEAD` 与最新诊断文档改动后的完整质量链**；本次更新验收文档后还需对新 HEAD 执行 `vp check`、`docs:check`、`ready` 并核对 SHA。不能把前次质量链记录冒充最新提交验证。

## 2026-11-17 · 第三十四批第七小批会话注销与 ACL 动态撤销候选（待 Windows 验收）

以 PR #61 Squash Merge 的 `main@669c9ff3` 为基线，**只扩展现有真实数据库 HTTP 集成测试**：`apps/server/test/projects-cas-cookie-http.db-spec.ts` 增加 `ScadaAuthController` 的真实 `POST /api/v1/auth/logout` 路由，保留原有 `AuthSessionService`、`ScadaSessionGuard`、`ScadaProjectGuard`、`PrismaProjectVersionStore` 与实际 PostgreSQL，不替换登录会话、Guard、权限或工程仓储为 Mock。仅 OIDC 授权码发起/回调的两个**无关且不调用的**依赖在测试容器中使用空对象提供者，不冒充真实 IdP 登录。

新增两个隔离租户用例：一是注销主体 A 当前 Cookie/CSRF 会话后真正回查 PostgreSQL `revokedAt`，再次复用旧 Cookie 的身份、工程列表和写请求均必须立即 401，而主体 B 的身份、工程保存 201 与成功审计不受影响；二是在会话仍有效时定向删除随机测试工程上主体 B 的三项 ACL，B 仍可读取 `/auth/me`，但工程列表为空，详情、历史、版本写入均 404；主体 A 仍正常读取并追加修订号 2，历史/审计保持一致。本批既无产品代码更改也无 Prisma 迁移；所有写入限定于本机独立 `adui_scada_test` 的随机租户并由已有夹具定向清理。

旧数据库专项已由维护者 Windows 验收 **29/29**；新候选预计 **31/31**，尚无 Windows `vp check`、`docs:check`、`ready`、`test:db` 新 HEAD 通过日志。必须把实际退出码和 `git rev-parse HEAD` 与 PR SHA 核对后才能标为通过。默认 `ready` 不执行真实数据库写入，执行 `test:db` 前要核实测试库环境与迁移状态。测试结论不能扩展为真实双 Keycloak 用户退出登录、跨实例权限同步或生产安全评审通过。

## 2026-11-17 · 第三十四批第八小批前端访问失效保护候选（待 Windows 复验）

维护者已完成第七小批的 Windows 真实 PostgreSQL **31/31**、`vp check` 零警告、完整 `ready` 中 **544/544 单元测试及 49/49 服务端 HTTP E2E**；PR #62 经明确授权 Squash 合并到 `main@d743e17df42fda97a1cd9bce8676ad75b5ed37c9`。上述记录只代表第七小批通过，不代表本次前端修改已完成验证。

本批针对已查明的前端授权缓存风险：服务端工程此前已建立合法 CAS 基线，后续收到 HTTP 404（不存在/无权访问不可区分）时不能再落入“新建工程”路径；并且禁止第二次点击保存再误发起新建。共享服务端会话增加受控访问失效、单工程重复创建阻断、重新授权读取后恢复和 401/403/404 分类；Vue/React 对等失效服务端水位/历史/对比与授权列表游标，不改变本地画布、IndexedDB 草稿和撤销历史。保留普通网络中断及已有 CAS 409 处理语义，不添加后端权限 API、自动推送或数据库写入。

新增 6 项共享单元测试，预计 `test:unit` **550/550**；`vp check`、`docs:check`、完整 `ready` 与双端真实浏览器正常路径均**待维护者 Windows 执行**，本协作环境尚无可运行 Vite+/Vue/React/真实 OIDC Lab 的对应测试结果。拒绝后的浏览器 UI 尚未使用自动化权限撤销场景验证，不得标为已通过。
复审补充：工程管理列表本身的 401/403/404 若只清除子组件游标，父级 Studio 的旧修订号和 CAS 基线仍可能显示；本批进一步增加 React `onAccessRejected` 回调 / Vue `accessRejected` 事件并复用父级失效处理函数。**该父子联动目前仍待 Windows TypeScript / Vue SFC 类型检查及浏览器回归**。

## 2026-11-17 · 第三十四批第九小批模拟服务端拒绝的 React/Vue 浏览器回归候选

基线：PR #63 已经维护者明确同意并 Squash 合并到 `main@6f09e1930fe55f567245708bf5eb80edacd7b42a`。前批真实 Windows 已经完成普通浏览器 OIDC 专项（React/Vue 皆通过，退出码 0）、`ready` **550/550** 单测、**49/49** HTTP E2E 和构建，完整退出码 0；这些不能冒充本批新增模拟专项的通过结果。

第九小批增加了**可人工复验、浏览器内无服务端工程写入**的专项：仅在 `--simulate-access-denial` 模式下，将工程只读 GET 的历史接口、授权工程列表接口和工程当前水位接口依次模拟为 401、403、404，在 React/Vue 每个 Origin 上检查 CAS 基线/服务端版本水位/列表旧摘要清除、IndexedDB 草稿 Hash 与画布一致；404 后重复保存不能触发真实工程创建或追加。模拟 wrapper 在程序捕获 Fetch 之前安装，**所有工程路径非 GET/HEAD 方法先被硬性拦截**，只对匹配的当前 Origin 和具体路由 GET 模拟状态，不重写 Cookie/身份、不触碰 Keycloak/ACL。新增 3 项 Node.js 离线测试证明写入拦截、Scope/状态白名单、参数组合互斥；预计 `test:projects:oidc:config` 从 **18 项到 21 项**。

**当前验证：** GitHub 分支已提交候选源码；协作端仅做有限 JS 函数语法解析与变更锚点检查，**尚未在 Windows 执行新 HEAD 的 `test:projects:oidc:config`、`vp check`、`docs:check`、`ready` 或 React/Vue 交互浏览器专项**。无真实测试证据时不能声称 21/21 或拒绝 UI 测试已经通过。第七小批 PostgreSQL 31/31 的真实 ACL 即时撤销测试是服务端独立证据；本批模拟状态不证明真实 Keycloak ACL 撤销后的端到端一致性，也不意味着工业生产安全验证完成。

## 2026-11-17 · 第三十四批第十小批真实 ACL 撤销双框架浏览器候选（待 Windows 验收）

PR #64 已按维护者授权 Squash 合并为 `main@d59df5e9ef2d702954f6b20173990abe53dffc3a`。维护者已实际执行旧模拟拒绝浏览器专项：React/Vue 401/403/404 均通过、退出码 0，`test:projects:oidc:config` 21/21、`vp check` 331/186 零告警、`docs:check` 86，完整 `ready` 550/550 单测、49/49 服务端 E2E 和双端/NestJS 构建完成。**此前仅有模拟 HTTP 拒绝，不是真实数据库 ACL 撤销后的 UI 验收。**

本批新增 `scripts/test-oidc-real-acl-revocation.mjs`：默认通过两份真实独立 Keycloak 登录核对同租户不同本地主体，不执行写入；显式确认 `--run-revoke --confirm-lab adui_scada` 后，在本机受控 OIDC Lab 分别创建 React/Vue 专用随机空白工程，仅对新工程授予第二主体三项权限并于真实 Studio 确认载入后定向撤销。随后第二主体真实 HTTP 详情/历史/首版 404，身份仍有效，UI 的旧 CAS/水位/授权列表被清除，重复保存受控拒绝，SVG 画布与 IndexedDB 草稿保持不变；第一主体仍能读取旧首版、PostgreSQL 修订号和成功审计仍为 1。所有测试工程保留供人工复核，不触碰历史工程、其他主体 ACL、真实生产或工业采集设备。

新增 `scripts/test-oidc-real-acl-revocation.cases.mjs` 共 8 项离线安全测试；仅此 8 项会进入 `ready`，浏览器与 Lab 写入必须单独人工执行。协作端使用 V8 分段解析脚本与测试通过；首次模拟中 8 项为 7 通过/1 失败，定位到**SQL 测试 Mock 的 DELETE 匹配落入普通 SELECT 分支**，只调整 Mock 判断先后，再次模拟 **8/8**，未放宽真实 SQL 事务保护与断言。**这不是 Windows `node --test` 的实际运行结果**，也未执行本批 `vp check`、`docs:check`、`ready`、真实 Prisma/Keycloak/浏览器专项。全链仅为待验收候选，不能声称真实撤权已验证通过。

## 2026-11-17 · 第三十四批第十一小批：标签页重新可见时 BFF 身份与 CAS 复核候选

基线为按维护者明确授权 Squash 合并的 PR #65：`main@e809d306743bd20508630c1809d6993b755f1874`。第十小批维护者实际通过 React/Vue 真实 PostgreSQL ACL 撤销浏览器专项，退出码 0；原本 550/550 单测、49/49 服务端 E2E、8/8 撤权离线测试、21/21 OIDC 浏览器离线规则与完整质量链的终端证据已登记。前一批通过并不意味着本批页面可见事件功能已实测。

本批新逻辑在已确认的工程 CAS 基线上，页面从隐藏变为可见时只读获取 BFF 身份与工程水位（独立 GET，仍走后端 Session/ACL），检测其它标签页注销所产生的 401、撤权 404、账号切换、修订号变化 409，丢弃旧 CAS 与服务端摘要，不删除/重置本地画布、IndexedDB 草稿或自动保存状态。**网络故障不清除基线；从没有建立基线的工程不自动查询**。重新载入新基线后，旧异步校验的迟到结果不得清掉新状态。React/Vue 生命周期对等，在卸载时移除可见事件监听。

共享 `studio-session.test.ts` 新增 8 项单测；OIDC 浏览器独立 `--simulate-resume-check` 模式使用真实 Keycloak/BFF 登录和既有工程 GET，只模拟 DOM `visibilitychange`、身份 401、工程 404 和水位变化，实际工程写请求始终在临时 Profile 内拒绝。对应浏览器离线新 3 项，预计普通单测 **558/558**、离线浏览器 **24/24**，服务端 E2E 仍为 **49/49**。此专项不能证明真实两个物理标签同时可见或后台即时授权推送，只用于校验重新可见时的只读 UI 行为。

**当前验证**：候选代码在 GitHub 独立分支，**尚未在 Windows 执行新 HEAD 的 `vp check`、`test:unit`、`test:projects:oidc:config`、`docs:check`、`ready` 或新浏览器交互专项**。不能冒充通过或提前合并。

## 2026-11-17 · 第三十四批第十一小批 React Compiler 与 TypeScript 检查问题修复候选

维护者 Windows 实际执行 `vp check --fix`，报告 **188 个受检文件中 1 个错误和 1 个警告**，同时显示 Formatting completed；具体是 `apps/web-react/src/studio/StudioPage.tsx` 的 `react(immutability)`（Effect cleanup 对 `active` 重赋值）和 TS2339（在 `isScadaAccessRejection(error)` 的类型谓词否定分支中读取 `error.kind`，被推断为 `never`）。该输出表示**格式化执行完毕，不代表检查通过**，不能继续标记 `ready` 已通过。

针对 PR #66 新增 React 代码提交 `e5bddb6c98682130fc80841368466fa1aacccb51`：仅将临时 `let active` 替换为 `AbortController.signal.aborted` 生命周期保护，并在分支前分别计算 `accessRejected` 与 `revisionConflict`，复用原错误分类而不重写权限/CAS 逻辑。协作容器以 TypeScript **5.8.3** 的等价收窄片段运行 `tsc --noEmit --strict` 成功；**尚未运行本项目 TypeScript 6 或 Vite+，也未验证 Windows 本地 `vp check` 零错误**。不得将未执行的 `test:projects:oidc:config`（目标 24/24）、`test:unit`（目标 558/558）、`docs:check`、`ready` 和 `test:projects:oidc:resume` 写成已通过。详见 `docs/AI_MISTAKES.md` E-031。

## 2026-11-17 · PR #66 Windows 复验与待排查问题

- 维护者 Windows 已执行：`pnpm run test:projects:oidc:config` **24/24 通过**、`pnpm run test:unit` **558/558 通过**、`vp check` **333 个文件格式正确 / 188 个受检文件零警告错误**、`pnpm run docs:check` **86 个 Markdown 通过**。
- `pnpm run ready` **未通过**：`apps/web-vue/src/studio/StudioPage.vue:1221` 出现 TS2339（重复类型谓词导致 `error.kind` 收窄成 `never`），已在 PR #66 原分支采用与 React 对等的布尔分类最小修复，**修复后完整质量链待 Windows 复验**。
- `pnpm run test:projects:oidc:resume` **未通过，退出码 1**：React 第一组“认证会话过期”场景在准备独立 CAS 基线时的工程载入阶段返回受控错误；当时尚未注入本轮 401，不得将此日志直接认定为复核逻辑的 401 失败。
- 浏览器脚本增加仅含固定白名单文案的“确认前 / 确认后”诊断分类及对应测试断言；不公开页面原始错误正文、网络响应、Cookie、令牌或堆栈。此项是**诊断增强，不代表真实浏览器问题已经修复**。
- 后续验收：`pnpm --filter @adui/scada-web-vue run typecheck`、`vp check`、`pnpm run test:projects:oidc:config`、`pnpm run ready`、`pnpm run test:projects:oidc:resume`，分别记录真实退出码；若浏览器仍失败，使用新的固定阶段信息继续定位。PR 保持 Draft，未经单独授权不合并。

## 2026-11-17 · PR #66 Windows 最终复验：质量链与双框架标签页恢复专项通过

维护者在 Windows 提供完整终端日志：`vp check` 检查 **333 个格式文件正确、188 个受检文件零警告/错误**；`pnpm run test:projects:oidc:config` **24/24**；`pnpm run ready` 连续完成 React `tsc --build`、Vue `vue-tsc --build`、共享包/服务端类型检查、Vitest **558/558（49 文件）**、SSE 客户端 **8/8**、故障代理 **4/4**、NestJS HTTP E2E **49/49（6 文件）**、Markdown **86 个**及 React/Vue/NestJS 构建，脚本结束回到 PowerShell 提示符，随后 `if ($LASTEXITCODE -ne 0) { throw "完整质量链失败" }` 未触发异常。此事实关闭此前 Vue TS2339 的 Windows 编译阻塞。

维护者随后独立执行 `pnpm run test:projects:oidc:resume`：React 与 Vue 均完成真实 BFF 登录、授权工程分页、IndexedDB 草稿及自动保存、取消载入与水位冲突、确认载入 CAS，以及**标签页恢复模拟身份 401、工程详情 404、远端修订变化**三场景；脚本明确报告“双框架标签页重新可见只读复核专项通过；工程写入已在浏览器阻断，Lab ACL 未修改”，PowerShell 输出专项退出码 **0**。此前一次浏览器准备阶段退出码 1 为历史失败，当前复验已通过；由于缺少中间失败的具体安全阶段诊断，不对其真实根因作猜测。

**证据边界**：上述测试由维护者在本机 Windows 运行，协作端未代为执行；日志未给出 `git rev-parse HEAD`，因此不能断言该运行精确对应 GitHub 最新提交。此条文档本身提交后尚无新的文档检查或完整质量链日志。专项中 401/404/版本漂移是隔离浏览器只读模拟，不代表真实物理双标签并发、真实 Keycloak 跨标签注销或生产工业安全认证。PR #66 继续保持 Draft，需维护者单独明确授权才可合并。

## 2026-11-17 · 第三十四批第十二小批：共享 readVersion 迟到结果保护候选

基线为维护者授权 Squash 合并的 PR #66：`main@19752e6219bffd3de9b672e89e95e6dabfb14535`。上一小批真实 Windows `ready` 包含 558/558 单元测试、49/49 HTTP E2E、React/Vue/Server 构建及文档检查；独立 React/Vue OIDC 标签页恢复专项最终退出码 0。这些**不是**本小批新代码的已验证结果。

代码复查发现：既有 `revalidateBaseline` 使用原基线引用识别旧请求，但相邻 `readVersion` 的 `catch` 会直接按旧请求返回的 401/403/404 调用 `invalidateAccess(projectId)`，如果期间用户 `reset` 或重建了基线，存在将旧授权错误应用到新上下文的风险。旧成功结果在上下文改变后也可能继续传给 UI。候选修复为共享会话增加内存代次，在每个 `await` 与异常路径确认一致，过期结果受控 409 拒绝；原有当前请求的权限拒绝及 CAS 安全规则保持不变。

新增 3 项 Vitest 回归，目标全量 **561/561**、共享会话 **25/25**，本批不新增数据库迁移、不修改 React/Vue 组件/IndexedDB、服务端 ACL 或工业设备接口。**候选版本目前未经本机 Windows TS6 / Vite+ / Vitest / 完整 ready 或独立浏览器复验；不得标记通过。** 完成后须核对本机 `git rev-parse HEAD` 与 PR 最新 HEAD，再提交实际退出码、失败原因与验证记录。PR 保持 Draft、未合并。

## 2026-11-17 · PR #67 Windows 质量链实际验收结果

维护者已上传 Windows PowerShell 完整日志，以下数据均为**实际执行结果**，不再是候选预期：

- `pnpm run test:unit`：49 个测试文件、**561/561** 个测试通过，其中共享 `packages/api-client/test/studio-session.test.ts` **25/25**（包含本批新增的 3 项迟到请求竞态回归）；其后的 PowerShell 非零退出码校验未触发。
- 独立 `vp check`：333 个文件格式正确、188 个文件零告警 / Lint / 类型错误；非零退出码校验未触发。
- `pnpm run ready`：依赖目录、共享配置、环境与 LF、中文文案、Prisma Client 和 Core 构建均完成；React `tsc --build`、Vue `vue-tsc --build`、共享包及 NestJS 类型检查成功；再次执行 561/561 单测、SSE 客户端 **8/8**、故障代理 **4/4**、OIDC 工程浏览器离线门禁 **24/24**、NestJS HTTP E2E **49/49**、Markdown **86 份**及 React/Vue/NestJS 构建成功。PowerShell 明确输出：**完整质量链退出码：0**。
- E2E 日志中存在测试故意构造的 HTTP 503 健康检查失败输出，所属 `app.e2e-spec.ts` 与整个 E2E 文件均报告通过，不作为本次实际质量链失败。

**边界与待核对**：原始终端日志没有附 `git rev-parse HEAD`，不能证明本机运行的精确 Git SHA；当前 PR 分支仍须按实际提交核对。日志不包含本批新增竞态的真实浏览器并发重现、真实 Keycloak/ACL 撤销或独立 `test:projects:oidc:resume` 执行；离线 24/24 不能冒充后者。此条验收文档提交发生在上述本机 `ready` 之后，故不能称**文档更新后的新 HEAD** 已再次经过 `docs:check` 或 `ready`。PR #67 保持 Draft，未经维护者本次明确授权不得合并。

## 2026-11-17 · 第三十四批第十三小批：共享保存中旧请求隔离候选

本批基线为 PR #67 已合并的 `main@0d5962b5b7d5b208a550d8cd3ba9a4b72b508c6d`。上一批已由维护者 Windows 完成共享会话 25/25、全量 Vitest 561/561、HTTP E2E 49/49 和完整 `ready` 退出码 0；这不是本批新提交的测试证据。

代码检查发现 `saveDocument` 之前只对正常保存互斥，异步身份、水位、工程创建或追加等待期间若本地上下文被显式切换，旧请求完成后仍可误用新基线或清空新授权缓存。候选补丁复用既有 `contextGeneration`，在每一项异步请求成功/拒绝后检查代次，旧请求统一受控拒绝；已发 POST 的请求不保证远端未生效，故在冲突文案中明确提示重新读取服务器最新版本。当前代次的 401/403/404/409/网络错误路径保留已有语义。

新增五项共享单测，覆盖迟到身份 401、水位 404、创建成功、追加成功、追加 409 时新 CAS 基线保护，以及拒绝不必要的工程写入；预期共享 **30/30**、整仓 **566/566** 单测，正式结果必须以 Windows CLI 运行数据为准。此时**尚未实际执行本批源代码的 TypeScript 6、Oxfmt/Vite+、Vitest、完整 `ready` 或真实浏览器竞态专项**，不得标为通过。未修改数据库或工业设备权限；PR 将保持 Draft，未经维护者明确同意不合并。

## 2026-11-17 · PR #68 Windows 完整质量链复验通过

维护者提交了本地 Windows PowerShell 原始验收日志，确认本批第三十四批第十三小批新增的共享保存上下文防污染代码经过以下**实际**检查：

- `pnpm run test:unit`：**49/49** 个测试文件、**566/566** 个测试通过；共享 `packages/api-client/test/studio-session.test.ts` **30/30**，包括保存中身份迟到 401、水位迟到 404、创建回包迟到、追加成功回包迟到、追加冲突迟到等本批五项新用例；非零退出码断言未触发。
- `vp check`：**333** 个格式文件正确，**188** 个受检文件零警告、Lint 或类型错误；非零退出码断言未触发。
- `pnpm run docs:check`：**86** 个 Markdown 通过；这一检查仅覆盖静态文档。
- `pnpm run ready`：12 个依赖清单及 52 项 Catalog 检查、10 个 TSConfig 消费端、根环境与 LF、212 个自有文件中文文案、Prisma Client 7.10.1 生成、Core 构建、React `tsc --build`、Vue `vue-tsc --build`、共享包和 NestJS 类型检查均成功；再次通过 Vitest **566/566**、SSE 客户端 **8/8**、故障代理 **4/4**、OIDC 工程浏览器离线保护 **24/24**、HTTP E2E **49/49**、文档 **86 份**及 React/Vue/NestJS 构建。PowerShell 明确输出**“完整质量链退出码：0”**，随后非零退出码断言未触发。
- 健康检查 E2E 中故意构造的 HTTP 503 和对应框架日志属于已通过的测试场景，不能将其误记为本批 `ready` 失败。

**证据边界**：上述验收由维护者在 Windows 本机执行，协作端没有代跑全链。原始日志没有 `git rev-parse HEAD`，因此只能确认该批功能和测试输出与预期相符，不能宣称已经核实本地运行提交与 GitHub PR 最新 HEAD 完全一致。日志不包含新增保存竞态的真实浏览器/真实 PostgreSQL 延迟回包专项，也未独立执行旧 `test:projects:oidc:resume`；24/24 为浏览器安全**离线**测试，不能替代真实交互式浏览器。此文档记录是 Windows 运行后追加的，最新文档提交本身**尚未重新通过** `docs:check` 或 `ready`。PR #68 保持 Draft，不经维护者明确授权不合并。

## 2026-11-17 · 第三十四批第十四小批：延迟保存双框架浏览器专项待验收

本批以 `main@a1e710d2be86675f156fe0c36534e528b2203cae` 为基线。前一批 Windows 完整 `ready` 566/566 单元测试、49/49 HTTP E2E、双框架及服务端构建、退出码 0 属于已提供的历史验收，不是新浏览器专项的结果。

候选新增单一隔离浏览器模式 `--simulate-save-timing` 和 `test:projects:oidc:save:browser`；通过真实 Keycloak/BFF 同源只读载入建立基线，并在浏览器拦截所有工程非 GET/HEAD，只有当前工程版本追加 POST 会被延迟并得到受控 401/409/503 错误。Node 接收的只包括命中数、按钮 Busy/Disabled、是否出错与 CAS 摘要，不带工程数据或敏感会话信息。React/Vue 均检查两次连续点击只尝试一次 POST、无自动重试、409/401 失效 CAS、503 保持 CAS，以及本地 SVG/IndexedDB/自动保存完整性。离线新增 4 项，预期总数从 24 增至 28；不修改 Lab ACL、数据库、工程版本和生产设备。

协作端已对两份脚本进行了去除 ESM 导入后的 **V8 语法解析静态检查，均无语法错误**；该检查**不等同于 Node.js `node --test`、Oxfmt、完整 TypeScript 6 或真实浏览器验证**。此处仍需 Windows `pnpm run test:projects:oidc:config`、`vp check`、`docs:check`、`pnpm run ready` 及独立 `pnpm run test:projects:oidc:save:browser` 的原始日志、真实退出码和本地 HEAD 核对。特别地，合成 POST 失败不证明真实 PostgreSQL 写入已发生或被回滚，也不涵盖第十三小批真实写入成功后客户端切换上下文时的后端时序。

## 2026-11-17 · PR #69 Windows 验收：质量链通过，真实 Vue 浏览器专项仍失败

维护者 Windows PowerShell 日志显示 `pnpm run test:projects:oidc:config` **28/28**、`vp check` **333 个格式文件正确、188 个受检文件零告警/错误**。完整 `pnpm run ready` 完成 React/Vue/共享包/NestJS 类型检查、Vitest **566/566**、SSE 客户端 **8/8**、故障代理 **4/4**、OIDC 工程浏览器离线 **28/28**、NestJS HTTP E2E **49/49**、86 个 Markdown 检查及 React/Vue/NestJS 构建；后续 PowerShell 的失败退出码断言未触发。以上是**新增修复前原分支的真实 Windows 质量链证据**。

独立 `pnpm run test:projects:oidc:save:browser` **失败，实际退出码 1**：React 完整工程管理及延迟保存 **409/401/503** 三场景通过后，Vue 成功进行首页、真实 BFF、授权分页和临时 IndexedDB 草稿步骤，但在“**取消载入与画布保护**”阶段出现固定安全诊断“**浏览器页面操作失败：服务器工程载入阶段返回受控错误（确认前）**”；Vue 尚未进入延迟保存三场景。**不得将 React 通过或全链 `ready` 通过等同双框架专项通过**。

检查现有 `openProjectInPage` 发现判定缺陷：此前将“本次看到忙碌”直接和“最终仍有错误节点”组合为失败，未要求错误必须属于本次新请求，存在与 E-026 同类的**旧错误跨越忙碌阶段误判风险**。此条件问题已通过增加“前后错误变化 / 曾经清空”核对作最小修正；固定白名单诊断新增身份过期、授权拒绝、版本冲突、快照校验、网络故障、服务故障、协议响应类别，不打印原始错误文案。新增三项 Node 离线用例：旧错误跨忙碌、相同错误清空再出现、诊断脱敏；预期离线总数 **31**。协作端使用当前实际 `openProjectInPage` 函数在 Code Mode V8 模拟三个时序分支，分别得到正确的取消结果、受控版本冲突和受控身份过期；**并非 Windows Node/CDP/Keycloak 复验**。

**根因边界**：日志只有脱敏的“确认前”，无法判定此次 Vue 阻塞究竟来自旧 UI 错误残留、真实 API 401/403/404、版本漂移、网络或快照校验。修复解决了确定存在的测试判定缺陷并增强诊断，但**实际 Vue 失败尚未确认关闭**。后续在最新 PR HEAD 先执行 `pnpm run test:projects:oidc:config`、`vp check`、`pnpm run docs:check`、`pnpm run ready`，再独立复测 `pnpm run test:projects:oidc:save:browser`，记录真实退出码及新的固定类别；严禁输出认证 Cookie、Token、工程正文或浏览器原始堆栈。新文档提交之后同样尚未复验。PR #69 保持 Draft，等待维护者明确授权才可合并。

## 2026-11-17 · PR #69 第二次 Windows 验收：新增诊断断言失败，Vue BFF 阶段未通过

维护者已提供第二轮 Windows PowerShell 原始记录：`pnpm run test:projects:oidc:config` **31 项中 30 通过、1 失败**。唯一失败是新增的“工程载入诊断只允许固定阶段和类别，不返回真实页面正文”，断言实际为已有固定脱敏消息“浏览器页面操作失败，请检查当前 Studio 状态”，而本批新增测试错误地期望另一条通用失败文案。这是**新增测试预期与已有安全契约冲突**，不是敏感数据泄漏。另行 `vp check` **333 个格式文件、188 个受检文件零警告/错误**；`pnpm run ready` 运行到 Vitest **566/566**、SSE 等步骤后，在同一 OIDC 离线用例 **30/31** 处退出码 1；后续 HTTP E2E、文档及构建没有由该次 `ready` 执行完成，**不能标记完整质量链通过**。

独立 `pnpm run test:projects:oidc:save:browser` 再次 **退出码 1**。React 的身份、工程浏览、草稿及模拟延迟保存 409/401/503 全部完成；Vue 完成首页与 Studio 入口后，在“真实 BFF 会话与授权工程列表”阶段得到“浏览器安全回归断言失败”通用诊断，未进入 Vue 工程列表及保存模拟。代码检查显示此阶段首先执行 `authenticatedInPage(origin)` 的布尔断言；认证结果为 false 时原先被通用断言脱敏路径吞没，但**尚不能由日志区分 Origin 不匹配、HTTP 401/403、网络或身份响应契约异常**。不能据此推断 Vue 真实授权已失效，也不能把该问题当成保存操作失败。

已在原 PR 分支最小修复：新用例按照已有安全规则期望固定消息，并补充已审核的 `React BFF 会话未通过验证` / `Vue BFF 会话未通过验证` 失败类别，保持业务身份检查必须为 true 后才继续工程读取；未开放 Cookie、URL、Token、用户信息或原始异常正文。两份 MJS 在协作端完成 V8 语法解析，脱敏函数的固定返回结果与新增断言一致，**但不是本机 Node `--test` 或真实 Chrome/CDP 验收**。预计离线仍 **31/31**（不删除任何测试），实际复验 `test:projects:oidc:config`、`vp check`、`docs:check`、完整 `ready` 和 `test:projects:oidc:save:browser` 均待维护者在最新 HEAD 上执行并记录退出码。

## 2026-11-17 · PR #69 第三次 Windows 交互式验收：React 503 阶段通用超时

维护者本机 Windows 再次执行 `pnpm run test:projects:oidc:save:browser`，返回 **退出码 1**。真实 Keycloak 登录、React Studio 工程列表、IndexedDB 草稿、取消载入、模拟水位冲突、确认 CAS 基线均完成；随后 React 依次打印“旧 CAS 水位冲突”（409）、“服务端身份过期”（401）和“服务端暂时不可用”（503）的**场景开始**消息，但在 503 消息之后、Vue 第一条步骤消息之前，终端报告“浏览器登录或 Studio 页面未达到预期状态，请检查隔离 Lab、登录与服务端工程”。**仅凭场景开始消息不能证明 React 503 已通过，更不能称 Vue 本轮通过或失败**。本轮仅提供独立浏览器日志，不能反推最新 `ready`、`vp check`、33 项离线测试的执行结果。

代码复查发现，通用 `waitFor` 在超时时抛出“阶段标签＋未达到预期状态”，但 `describeProjectBrowserFailure` 将所有该类标签统一掩盖为一条通用消息，无法区分 503 期间是重新读取工程基线、唯一版本 POST 未挂起，还是模拟回包后 UI 没有结束或未显示错误。**实际失败的具体阶段尚未确定**，因此本批不修改共享 API Client 或 React/Vue 生产逻辑、不改变 HTTP 503 的保留 CAS 预期。

候选最小改动只在浏览器测试：允许输出严格白名单内的 React/Vue“权限模拟首页加载 / 工程列表加载”超时阶段；对 401/409/503 两段保存等待使用仅含固定状态的诊断（指定 POST 未命中、写入次数异常、Busy 未保持、按钮未禁用、保存未结束、未显示错误或页面状态不可读）。不打印工程 ID、响应正文、Cookie、Token、原始异常或堆栈；原有“唯一 POST、按钮禁用、503 保留基线、画布/IndexedDB 不变”所有断言保留。新增加两项 Node 安全离线用例，目标 `test:projects:oidc:config` **33/33**（前版 31 项），用例覆盖正向阶段分类、错误类别严格匹配、附带 Bearer 信息的伪造诊断不放行。协作端已完成两份 MJS 的 **V8 语法解析**及真实分类函数的有限状态模拟，分别得到固定类别并拒绝敏感拼接；**不等同 Windows Node、`ready` 或 Chrome/Keycloak 浏览器复验**。

下一步维护者必须核对本机 Git SHA，在最新 PR HEAD 上执行 `pnpm run test:projects:oidc:config`、`vp check`、`pnpm run docs:check`、完整 `pnpm run ready` 以及最后独立的 `pnpm run test:projects:oidc:save:browser`。若仍失败，应收集最新固定阶段/状态类别与退出码，再判断业务修复方向；严禁删除用例、伪造 HTTP 成功、绕过真实身份或把工程写请求发至 Lab。PR #69 保持 Open/Draft，未获明确合并授权不得合并。

## 2026-11-17 · PR #69 第四次 Windows 验收：离线 32/33 与 Vue 409 合成拒绝后失败

维护者提交的实际 Windows 日志：`pnpm run test:projects:oidc:config` 执行 **33** 项，**32 通过、1 失败、退出码 1**。唯一失败为“保存拒绝完成超时区分操作未结束和错误提示未显示”，位于 `scripts/test-project-browser-oidc.cases.mjs` 对带 `；secret` 的伪造阶段超时诊断的断言。实际 `describeProjectBrowserFailure` 正确返回固定的“浏览器安全回归断言失败，检查终端测试条件及真实页面状态”，测试错误期望另一条安全通用文案。本次修复**只改测试期望**，没有允许任意错误或敏感信息透传。

维护者随后仍运行 `pnpm run test:projects:oidc:save:browser`，**真实退出码 1**。此次日志已明确包含新增阶段标记：React 409、401、503 各自都“保存已触发，等待唯一版本 POST”且“已释放合成拒绝，等待界面恢复”，之后完成进入 Vue；Vue 真实 BFF、授权分页、IndexedDB 草稿、取消/冲突/确认载入与 CAS 基线均完成；Vue 409 同样成功进入唯一版本 POST 并释放合成拒绝后，报告固定的“浏览器安全回归断言失败”。**不能将 Vue 409 或整套浏览器专项标为通过**。该次日志未提供具体断言分支或最新 `ready` 退出码。

对照 `packages/api-client/src/studio-session.ts` 与两个 Studio 页面确认一个可复现的代码契约差异：共享会话对 409 清除内部 CAS 基线；React 在渲染时动态读取该会话基线，而 Vue 使用单独 `serverBaselineRevision` 响应式缓存，仅在成功保存/确认载入及显式权限失效时更新。Vue `runServerAction` 的 409 错误路径未同步该缓存，可能继续显示旧 CAS 修订号，与本次“409 回包已释放后失败”现象吻合。**原始通用错误不足以证明这就是唯一失败断言**，但此缓存一致性缺陷可由代码确定，必须修复。

PR #69 原分支最小候选已增加：仅在 Vue“保存服务端工程”失败后，从共享 `serverSession.getBaselineRevision(当前工程)` 刷新响应式缓存；409 反映 null、401 仍按原授权拒绝失效、503 继续保留原 CAS 值。浏览器测试现有真实 UI 断言不放宽，并增加严格白名单的 `Vue 延迟保存 409：CAS 基线状态不符合预期` 诊断以防下一轮仍无法定位。离线用例保持 **33 项**，增加同用例内的成功/冲突分支与附带敏感文本拒绝断言。

协作端确认修改后两份 JS 文件 V8 语法解析成功、共享会话 409 清基线与 Vue 响应式同步路径静态匹配、诊断函数对 409/401/503 正反分支及敏感附加文本拒绝正确；**未运行 Windows 真实 Node、TypeScript 6、Vite+、完整 `ready` 或真实 Chrome/Keycloak 双框架专项**。下一步必须在本地最新 PR HEAD 重跑 `test:projects:oidc:config`（目标 33/33）、`vp check`、`docs:check`、`pnpm run ready` 与独立 `test:projects:oidc:save:browser`，记录完整实际退出码和 HEAD。不能删除用例、放宽现有安全断言或向 Lab 转发工程 POST。

## 2026-11-17 · PR #69 第五次 Windows 验收：双框架延迟保存专项通过

维护者本机 Windows PowerShell 最新提交的两份原始日志已将第三十四批第十四小批从“候选”推进到**实际验收通过**：

- `pnpm run test:projects:oidc:config`：**33/33**，Node.js 测试套件全部通过、0 失败、0 跳过，后续非零退出码断言未触发，覆盖先前失败的固定脱敏文案以及 Vue 409 CAS 基线诊断用例。
- 独立 `vp check`：**333** 个文件格式正确、**188** 个文件零警告/Lint/类型错误；`pnpm run docs:check`：**86** 个 Markdown 文件通过。
- `pnpm run ready`：依赖 Catalog **12 清单、52 项依赖**、共享 TSConfig **10 个消费端**、根环境与 LF、中文文案 **212** 个自有文件、Prisma Client **7.10.1**、Core、React `tsc --build`、Vue `vue-tsc --build`、草稿存储/共享 API Client 与 NestJS 类型检查均完成；Vitest **49/49** 测试文件、**566/566** 单测（共享会话 **30/30**）、SSE 客户端 **8/8**、TCP 故障代理 **4/4**、OIDC 工程浏览器离线规则 **33/33**、NestJS HTTP E2E **6/6** 文件 **49/49**、Markdown **86** 份以及 React/Vue/NestJS 构建均通过。PowerShell 在命令结束后执行 `if ($LASTEXITCODE -ne 0) { throw "完整质量链失败" }`，**没有触发异常**；原始日志没有再单独打印 `ready` 的数值退出码。HTTP E2E 健康检查刻意产生的 503/ERROR 日志属于通过的测试场景，并非完整质量链失败。
- 独立 `pnpm run test:projects:oidc:save:browser`：在真实可信本机 Keycloak/BFF 和两套 HTTPS Web Origin 下，React 与 Vue 均完整通过授权工程列表/分页、临时 IndexedDB 草稿与自动保存、取消载入、模拟 CAS 冲突、确认载入；**每个框架都完成模拟 409/401/503 三种保存拒绝**，明确记录唯一版本 POST 挂起和合成响应释放。脚本输出“双框架延迟保存拒绝与重复提交专项通过；版本 POST 已在浏览器阻断，Lab 工程与 ACL 未修改”，且维护者 PowerShell 明确输出 **“双框架延迟保存专项退出码：0”**，后续失败断言未触发。

**修复结论**：此前 Vue 409 时共享 `serverSession` CAS 基线已清除但响应式 `serverBaselineRevision` 未同步的缺陷（E-035），以及新增离线脱敏断言文案不一致（E-033/E-034 相关回归），均已通过这轮离线和真实浏览器质量门禁验证；历史几轮退出码 1 仅保留为故障及修复经过，**不是当前验收结论**。

**证据边界**：双框架专项是**真实浏览器 UI ＋ 合成 POST 拒绝**，浏览器永久阻断工程写入；并非真实 PostgreSQL 写入已成功后的网络延迟或真实跨会话/跨标签写竞争专项，不扩大工业设备写入权限。本轮日志**未包含 `git rev-parse HEAD`**，不能精确证明 Windows 运行 SHA；在记录前，PR #69 的远端 HEAD 为 `a16e3f946e28dc8b155ad5f33fde82b198a5b511`，较上一轮 `3600c4246b7748cbbe50ca922fe3f7cc83cf4484` 仅多一个离线测试文件整理提交。补录验收结果会产生新的文档提交，**文档新 HEAD 尚未再次经过 Windows 质量链**。PR 继续保持 Open / Draft、Assignee `@adui-dev`，未经维护者单独明确授权不合并。

## 2026-11-17 · 第三十四批第十五小批：真实提交后迟到 201 / CAS 回归候选待验收

基线为第十四小批已合并的 `main@c5df29fb7a769235237c5c4da33f20a0c013fe2e`。前批 Windows 日志已有共享 Session 30/30、全量 566/566 单测、HTTP E2E 49/49、离线 OIDC 33/33、`vp check` 与 `ready` 完成和浏览器合成拒绝专项退出码 0，但**不能视为本批新增真实 DB 用例已运行**。

本批新代码只涉及 `packages/api-client/test/studio-session.test.ts` 与 `apps/server/test/projects-cas-cookie-http.db-spec.ts`：新增 1 项 Promise 时序单测，要求旧成功 2 回包在客户端重建 CAS 3 后必须受控拒绝，基线保持 3，后续以 3 追加到 4；新增 1 项隔离 PostgreSQL + 真实 Cookie/CSRF/ACL + HTTP 事务测试，第一主体在旧 201 暂未交付应用消费端时完成真实数据库版本 2 和审计，第二主体再追加版本 3；真实 GET 读取版本 3，之后释放旧 201，客户端尝试旧 CAS 2 必须返回 409，数据库不得产生额外版本/审计。所有写入只使用原 `withFixture` 生成的随机租户，清理范围由 tenantId 限定，测试目标明确拒绝外部数据库。延迟实现是**收到真实 HTTP 响应后在消费端 Promise 暂留**，不控制 TCP 传输本身。两层用例独立，不等于已经打通真实浏览器 UI 直接处理这一 PostgreSQL 回包。

期望共享 Session **31/31**、全量 Vitest **567/567**；真实 `pnpm run test:db` 预计 **30/30**，必须额外执行且要求真实退出码 0。候选提交后**尚未在 Windows 执行 `vp check`、`pnpm run test:unit`、`pnpm run docs:check`、`pnpm run ready` 或 `pnpm run test:db`**，不得写成已通过。若现有测试数据库缺少迁移/连接失败，不得转向生产库解决。未更改真实 OIDC 用户/ACL、NestJS 业务 Controller、Prisma Schema、工业设备或前端工程保存逻辑。PR 保持 Draft；只有维护者明确同意才能合并。

## 2026-11-17 · 第三十四批第十五小批首次 Windows Vite+ 类型检查：TS2740 修复候选

维护者本机执行 `vp check --fix`，格式化阶段已完成，但 **188 个受检文件内 1 个 TypeScript TS2740 错误、0 警告**，因此**本次质量检查失败**。错误定位 `packages/api-client/test/studio-session.test.ts:676`，新增旧保存回包迟到场景将 `createProjectSnapshot(waterTreatmentDemoDocument, { revision: 4, createdAt })` 直接传入 `api.appendVersion.mockResolvedValueOnce`。仓库实际 Core `project-snapshot.ts` 中此工厂为 `async`，返回 `Promise<ProjectSnapshot>`；Vitest 的 `mockResolvedValueOnce` 对该 Mock 要求已解析的 `ProjectSnapshot`。不能把格式化完成等同 `vp check` 通过。

已在 Draft PR #70 原分支将唯一不匹配调用改为 `mockResolvedValueOnce(await createProjectSnapshot(...))`，复用原 async `it`，保留原有真实 SHA-256 快照生成、CAS 3→4、期望调用次数及旧回包上下文保护。改动**仅一处测试值**，不更改生产 API Client、Core、NestJS、Schema 或真实数据库行为。经 GitHub 代码确认新表达式恰好位于 async 测试内，且 Core 工厂返回 Promise；此项是静态类型原因核对，不是本机 TS6 / `vp check` 通过证据。

**修复后待 Windows 复验**：`vp check` 零错误警告；`pnpm run test:unit` 目标共享会话 31/31、全量 567/567；`pnpm run docs:check` 与 `pnpm run ready` 实际退出码 0；真实本机隔离 PostgreSQL `pnpm run test:db` 目标 30/30 且退出码 0。原始日志不包含本机 HEAD 校验和后续测试，通过前不能合并 PR。

## 2026-11-17 · PR #70 Windows 实测：真实数据库 32/32 通过，ready 被 SSE 代理禁用端口中断

维护者 Windows 原始日志已确认本机独立测试数据库 `adui_scada_test`（`127.0.0.1:15432`）的 `prisma migrate status` 显示 **4 项迁移、Database schema is up to date**。随后独立 `pnpm run test:db` 在真实 PostgreSQL、NestJS HTTP、Cookie/CSRF 和 ACL 下 **4/4 文件、32/32 项通过，退出码 0**。其中新增的“真实 PostgreSQL 已提交版本后延迟交付旧 201，最新水位与审计不得回退”实际通过，包含 CAS 旧水位拒绝与版本/审计核对。**此前文档将数据库专项预计为 30/30 不准确，以维护者实际 32/32 为准**。隔离数据库测试完成不等于工业现场验证。

维护者附带的完整 Windows 质量日志另行证明：`pnpm run test:unit` **49/49 文件、567/567 用例（共享 Studio Session 31/31）通过**；`vp check` **333 个文件格式正确、188 个受检文件零警告/Lint/类型错误**；`pnpm run docs:check` **86 份 Markdown 通过**。完整 `pnpm run ready` 已通过依赖/环境/LF/中文文案/Prisma/Core、双框架及服务端类型检查、单测 567/567、SSE 客户端 **8/8**，但在 `test:sse:fault:unit` 报 **4 项中 2 通过、2 失败**，均为 `TypeError: fetch failed`，原因链 `Error: bad port`；完整 `ready` **实际退出码 1**。因此该次 `ready` 之后的 OIDC 保护、HTTP E2E、文档和构建阶段**未在该次质量链执行完成**，不能宣称整条 `ready` 已通过。

复核 `scripts/sse-fault-proxy.mjs` 原实现发现代理对 `127.0.0.1` 使用 `server.listen(0)` 接受操作系统随机分配端口；失败的两个测试经 Node 内置 `fetch` 访问代理，第三个 Keep-Alive 测试走 `node:http` 并通过。Fetch 标准会拒绝部分 HTTP 禁用端口，日志中的 `bad port` 与随机选择该端口的风险吻合；**本次输出没有记录代理实际选中的端口号，不能精确断言具体是哪一个禁用端口**。为避免重现，仅在测试故障代理内改为从 **20000～49151** 的安全高端口范围随机绑定本机监听，遇 `EADDRINUSE` 或 Windows `EACCES` 最多重试 32 次并保留固定中文错误，测试夹具断言所有实际监听端口都在该范围。保留原有 SSE 字节阻断、Keep-Alive、资源回收与外部目标拒绝断言，不关闭 Fetch 安全保护。

该修复**尚未在 Windows 重新实测**。维护者应先执行 `pnpm run test:sse:fault:unit`（目标 4/4），再执行 `vp check`、`pnpm run docs:check`、完整 `pnpm run ready` 并记录退出码。原有真实数据库 **32/32 通过**证据仍成立；本轮修复未更改数据库测试、Schema、迁移或服务端生产代码。GitHub 最新文档提交本身也尚未通过新的 Windows 质量链。PR #70 保持 Draft，等待维护者明确合并授权。

## 2026-11-17 · PR #70 Windows 复验结案：真实 PostgreSQL 32/32 与完整 ready 退出码 0

维护者最新 Windows PowerShell 文件记录了此前 SSE 禁用端口修复后的真实复验：单独 `pnpm run test:sse:fault:unit` **4/4、0 失败**；单独 `vp check` **333 个格式文件正确、188 个受检文件零警告/Lint/类型错误**；`pnpm run docs:check` **86 个 Markdown 通过**。随后完整 `pnpm run ready` 执行到 React Web、Vue Web 与 NestJS Server 构建结束，PowerShell 明确输出 **“完整质量链退出码：0”**，失败断言未触发。本轮日志相较上轮 `ready` 退出码 1 已覆盖相同的 SSE `fetch failed: bad port` 失败路径，故 E-037 的**受控端口修复已获得真实 Windows 回归通过证据**。

完整 `ready` 本轮覆盖：Catalog **12 清单/52 项依赖**、共享 TSConfig **10 个消费端**、根环境/LF/中文文案、Prisma Client **7.10.1**、共享 Core、React/Vue/草稿仓储/API Client/NestJS 类型检查；Vitest **49/49 文件、567/567 用例**（共享 Studio Session **31/31**）、SSE 客户端 **8/8**、SSE 故障代理 **4/4**、OIDC HTTPS 代理 **10/10**、Lab 凭据 **6/6**、身份预绑定 **14/14**、Docker **14/14**、Docker 数据库保护 **9/9**、匿名 HTTPS 探针 **11/11**、工程浏览器离线 **33/33**、双主体 CAS 安全预检 **11/11**、ACL 撤销安全门禁 **8/8**、NestJS HTTP E2E **6/6 文件、49/49 用例**、文档 **86 份**及 React/Vue/NestJS 构建成功。HTTP E2E 中受控健康检查故意返回的 503/ERROR 属测试覆盖的预期路径，**并非 ready 失败**。

结合此前维护者已提供的隔离 PostgreSQL `adui_scada_test` Prisma **4 项迁移最新**及 `pnpm run test:db` **4/4 文件、32/32 用例、退出码 0**，第三十四批第十五小批的**既定两层验收门禁已经通过**：真实数据库旧 201 迟到/另一个 Cookie 会话推进水位/旧 CAS 409/持久化审计一致性和共享 Session 旧成功回包迟到后的新 CAS 基线保护。数据库专项是此前独立执行的结果，不属于 `ready`；没有改变原有真实响应仅在测试消费端延迟交付这一边界，也没有测试工业设备写入或生产环境。

**Git 证据边界**：上传的两段 Windows 日志均未附 `git rev-parse HEAD`，故无法将 Windows 成功结果绑定到**精确提交 SHA**。本次追加结案文档将再产生新的 Git HEAD，文档新提交本身**尚未再次运行 Windows `vp check`/`docs:check`/`ready`**。截至补录前 PR #70 仍为 Draft，Assignee `@adui-dev`；即使验收通过，未经维护者明确授权也不得自动合并。

## 第三十四批第十六小批 · 真实双浏览器迟到 201 验收边界

新候选沿用 `scripts/test-oidc-dual-cas.mjs`，通过 `pnpm run test:oidc:dual:late` 独立手工触发。离线 `pnpm run test:oidc:dual:config` 新增 5 项，目标 **16/16**；数字为候选预期，不是已执行结果。实际 HTTP 请求由两个临时隔离的 Chrome/Edge Profile 经 React/Vue HTTPS Origin 的正式 BFF 发出；首个 `201` 已在浏览器收到并校验克隆体，但原响应暂缓被测试消费端读取；第二主体推进版本 3 后再交付原 `201`，过期 CAS 必须返回 `409`。真实 PostgreSQL 只读检查版本、审计/操作者与摘要。

**风险与约束**：脚本复用已有 `resolveProjectBrowserLab` / `resolveLabIdentityTarget` 安全门禁，需要已预绑定的同租户不同主体、可信本机 HTTPS / Keycloak 和本机 `adui_scada` Lab；显式写入模式只创建新的 UUID 专用空白工程并授权第二主体，保留工程供复核，不连接 `adui_scada_test`、不修改现有工程、不接触 PLC/DCS。默认 `ready` 只执行离线配置测试，不启动真实浏览器写入。该模式是浏览器 API 级真实网络 + 真库联动，**不等于 Studio UI 点击保存、TCP 故障注入或客户端共享 Session 的完整 E2E**。

待维护者 Windows 核对 Git HEAD 与分支后执行 `pnpm run test:oidc:dual:config`、`vp check`、`pnpm run docs:check`、`pnpm run ready`；确认隔离 Lab 完整运行后单独执行 `pnpm run test:oidc:dual:late` 并打印 `$LASTEXITCODE`。只可复制固定阶段和退出码；不得在日志中粘贴 Cookie、口令、Token、主体 ID、数据库 URL 或原始响应正文。任何退出码非零均不得标记为通过。

## 2026-11-17 · 第三十四批第十六小批 Windows 最终验收结果

维护者提交的 Windows PowerShell 日志确认以下**实际运行结果**（此前本文件“候选 / 待执行”描述为本轮验收前历史状态）：

- `pnpm run test:oidc:dual:config`：新增模式在内的 Node 安全回归 **16/16**、0 失败；后续 `ready` 中再次运行 **16/16**。
- `vp check`：**333** 个文件格式正确、**188** 个受检文件零警告、零 Lint/类型错误。
- `pnpm run docs:check`：**86** 个 Markdown 检查通过。
- `pnpm run ready`：完整运行至 React/Vue 两端与 NestJS 构建结束，PowerShell **“完整质量链退出码：0”**。覆盖 Vitest **49 文件/567 项**（共享 Studio Session **31/31**）、SSE 客户端 **8/8**、SSE 故障代理 **4/4**、OIDC 工程浏览器离线 **33/33**、双主体离线 **16/16**、ACL 离线 **8/8**、NestJS HTTP E2E **6 文件/49 项**，以及环境、中文文案、类型检查和构建。
- 独立交互式 `pnpm run test:oidc:dual:late`：两位不同的真实 Keycloak 已预绑定主体在隔离 Chrome/Edge 浏览器中建立同租户独立 BFF 会话，成功创建**本轮新 UUID 专用工程**；第一主体真实 POST 提交版本 2 且 201 暂缓消费，第二主体真实读取版本 2 并追加版本 3，之后旧 201 交付且旧 CAS 2 返回 409，最终 PostgreSQL 版本/审计断言通过，明确打印“真实迟到 201 专项通过”，PowerShell **“真实迟到 201 专项退出码：0”**。新建专用工程保留供复核。

**验收边界**：独立交互式专项操作的是本机可信 `adui_scada` OIDC Lab，而非前批另行运行的 `adui_scada_test` 数据库专项；真实 HTTP 201 已到达浏览器，由测试代码延迟消费原始 Response，**没有造成物理 TCP 断流**。浏览器直接调用正式同源工程 API，不通过 React/Vue Studio 真实保存按钮，因此**不证明 Studio UI/共享 Session 接收真实迟到 201 的完整端到端安全性**。E2E 中被刻意触发的健康检查 503/ERROR 是测试负例，实际质量链以最终退出码 0 为准。

**Git 证据边界**：本次两段日志都没有 `git rev-parse HEAD`，无法把 Windows 通过结果精确归属到 PR #71 的某个 Git SHA。GitHub 核对在补录前 PR HEAD 为 `e2f2133d1db25a054591e3b5fa9a243a0f4cc8ba`，其较此前候选 `74297e3` 多出维护者的一次**仅两份测试脚本格式化**提交；日志通过的 `vp check` 与之相符但不能证明该 SHA。当前新增验收文档提交**尚未经 Windows 重新运行** `vp check`、`docs:check`、`ready`。PR #71 仍须保持 Draft，指派 `@adui-dev`，未经新一轮明确合并授权不得合并。

## 第三十四批第十七小批 · 真实 Studio UI 迟到 201 候选验收

新测试仅操作本轮两个随机 `b34-oidc-cas-<UUID>` 专用空白工程；真实提交由 React/Vue Studio UI 的“保存至服务端”发起，第二 Keycloak 主体通过独立浏览器正式 BFF API 追加第三版。两个浏览器同租户不同已预绑定本地主体，严格本机可信 HTTPS 和 `adui_scada` Lab；项目授权仅来自已审核的 `grantSecondSubject`，不会自动清理已有业务工程或用户。所有测试工程写请求默认由浏览器拒绝，只放行单次严格匹配的专用工程版本追加。

本批目标：`pnpm run test:oidc:dual:studio:config` 新增 **9 项**离线保护；原 `pnpm run test:oidc:dual:config` 仍为 16 项；完整 `pnpm run ready` 的既有 Vitest **567** 项及 NestJS E2E **49** 项不应因测试工具修改而改变（仅为参考，不能代替实测）。静态语法检查不代表 Node 测试通过。独立真实浏览器专项 `pnpm run test:oidc:dual:studio:late` 必须手工在本机可信 Keycloak/HTTPS/PostgreSQL Lab 执行，目标 React 与 Vue 都完成真实 201 延迟、远端 3、可见性 CAS 失效、无额外 POST 和三版审计，命令退出码须为 0。

**待验证/风险**：当前没有 Windows `vp check`、`docs:check`、完整 `ready` 或真实 Lab 的通过日志。正式 Studio UI 对保存中的历史载入、JSON 导入、草稿恢复存在互斥保护；本专项仅在互斥阻止切换后，核对旧响应交付和可见性水位变化的状态安全，不模拟通过私有状态强行切换工程，也不模拟 TCP 断流。保存后的首版 CAS 2 可能短暂显示在 UI，必须由实际只读复核清除后才能阻止下一次旧水位提交。失败时不得关闭登录/CSRF/TLS/工程权限，或放行未知工程写入，也不能复制 Cookie、Token、私钥、用户身份和 SQL 内部信息。

## 第十七小批 · Windows 首轮真实浏览器失败与阶段诊断

维护者提供的首轮 Windows 日志确认：`pnpm run test:oidc:dual:studio:config` **9/9**；`vp check` **335 个文件格式正确、190 个受检文件零警告/Lint/类型错误**；`docs:check` **86 个 Markdown**；完整 `pnpm run ready` 最终退出码 **0**，包括 Vitest **567/567**、SSE **8/8**、SSE 故障代理 **4/4**、OIDC 工程浏览器离线 **33/33**、双主体离线 **16/16**、NestJS HTTP E2E **49/49** 和 React/Vue/NestJS 构建。

但单独的 `pnpm run test:oidc:dual:studio:late` **退出码 1**。真实 Keycloak 双主体登录、两个随机专用工程创建/授权/首版读取、React Studio 确认载入及真实版本 2 的 201 到达并挂起均已输出。之后只有通用“真实 Studio 迟到保存未达到受控状态”，尚不能确认失败来自第二主体读取/追加、旧响应释放、UI 消费成功、可见性事件、CAS 复核或后续过期保存断言。不得将离线安全测试与 `ready` 通过误写成真实浏览器通过。

候选诊断修正：`scripts/test-oidc-studio-real-late.mjs` 的每个关键等待已分配独立固定阶段；超时只返回页面请求阶段、受控计数、忙碌/禁用、CAS/摘要状态、错误提示和可见性等安全字段；第二主体读 2/写 3 与释放旧 201 也有阶段日志。未知异常、工程 ID、身份、Cookie、Token、URL、响应正文和堆栈继续脱敏。**诊断修正尚未由维护者 Windows 复验**，需要重新执行离线 9 项、`vp check`、`docs:check`、完整 `ready`，再单独运行真实双框架专项。前次日志未包含 `git rev-parse HEAD`，不可将其绑定到 PR #72 当前 HEAD。

## 第十七小批 · 第二轮 Windows 真实窗口可见性失败及修复候选

真实 `pnpm run test:oidc:dual:studio:late` 第二轮 **退出码 1**：两位真实 Keycloak 测试主体、两个新建专用工程准备正常；React Studio 原始 201 已到并挂起，第二主体实际读到修订 2、POST 以 HTTP **201** 将真实数据库推进修订 3，随后 React 消费原始 201 并显示旧 CAS 基线 2。浏览器在执行 `Page.bringToFront` 后仍然报告 `phase=released`、`writeAttempts=1`、`rejectedWrites=0`、`busy=false`、`baselineRevision=2`、`savedSecondVersion=true`、**`visible=false`**。故本次尚未触发真实可见性 GET 水位复核，也未执行 Vue。

候选最小修复只涉及测试脚本中的第二主体隔离浏览器窗口：使用有官方定义的 CDP `Browser.getWindowForTarget` / `Browser.setWindowBounds`，在第二主体操作前切为正常窗口、操作完成后最小化，再激活第一主体标签。原 `document.visibilityState === "visible"` **原样保持为严格阻断条件**，不得通过覆盖属性或伪造可见事件绕过；所有真实 CAS、工程白名单、CSRF、草稿和三版审计断言保留。离线安全测试从 9 项增加至目标 **11 项**，**本补丁后的 Node、`vp check`、`docs:check`、`ready`、真实 Lab 尚未执行**。用户日志未包括本地 Git SHA，不能把上轮结果绑定到最新补丁。

## 第十七小批 · 第三轮 Windows 真实本地数据失败与分类补丁

用户第三轮 Windows 真实 `test:oidc:dual:studio:late` 日志：两个隔离 Keycloak 会话、新建随机测试工程、React 真实 201 保存、第二主体真实版本 2 读取、HTTP 201 追加修订号 3、第一主体旧 201 交付全部成功；测试随后确认“Studio 页面已可见，触发服务端 CAS 只读复核”。之后以“真实 Studio 迟到保存的本地数据发生变化”失败，**专项退出码 1**。按本版本测试脚本的最后执行顺序，旧 CAS 只读复核和再次保存拒绝的前置校验已完成；但具体是哪种本地数据发生变化、何时发生，原日志无法区分。此次未达到最终 PostgreSQL 三版审计和 Vue 全流程，绝不可记录为全部通过。

修复候选只改测试断言的**可定位性**：分类 SVG 画布、自动保存状态、IndexedDB 草稿数目和原始草稿记录 SHA-256 是否变化，五个业务阶段逐一运行原本的强制不变断言；失败只输出固定阶段及布尔结果，不泄漏画布/草稿/摘要正文。新增两项离线安全用例，目标由 11 项增至 **13/13**。目前只对纯诊断函数运行过隔离 V8 模拟，五种输入与预期匹配；**没有最新补丁的 Node 13/13、`vp check`、`docs:check`、`ready`、真实浏览器成功日志**。原先的 Windows `ready` 退出码 0 属于更早候选，不能套用到现版本。第三轮用户日志没有本地 `git rev-parse HEAD`。

## 第十七小批 · 第四轮 Windows SVG 差异分类与视口网格候选修复

维护者第四轮 `pnpm run test:oidc:dual:studio:late` 输出：真实 Keycloak 双主体与新建测试工程准备成功，React Studio 真实 201 到达后挂起，第二主体真实读取修订 2 并通过 HTTP 201 推进至 3，第一主体消费旧 201，页面真实恢复为 `visible` 并触发 CAS 只读复核。随后在**“CAS 只读复核后”**的严格本地比较报告 `{"canvasChanged":true,"autoSaveChanged":false,"draftCountChanged":false,"draftHashChanged":false}`，**专项退出码 1**。未执行 PostgreSQL 最终三版审计与 Vue 流程。不能把前面的真实 CAS 步骤成功扩大为整体联合验收通过。

原因分析：两端实际 SVG 页面都包含由 `visibleRect` 控制的网格矩形，旧测试比较整个 `.studio-svg.innerHTML`；在窗口恢复可见或尺寸变化后可能发生不属于工程数据的网格变更，形成假阳性。这一解释与观察相符，**但没有本次 DOM diff 证据证明变更仅来自网格**。候选只在真实 Studio 联合专项中克隆 SVG 并移除单个直系 `fill="url(#scada-studio-grid)"` 网格元素后比较所有剩余 SVG 子节点。原草稿 SHA-256、草稿数、自动保存、真实 CAS 单次 POST 与审计断言不变；业务 SVG 渲染图元变化继续严格失败。

新增 3 项离线安全测试，目标从 13 提升为 **16/16**。从仓库源码提取的纯页面快照函数在隔离 V8 Mock 下覆盖网格变化、图元变化和重复网格拒绝路径，**非仓库 Node、浏览器、PostgreSQL 或完整质量链成功证据**。当前新补丁 `pnpm run test:oidc:dual:studio:config`、`vp check`、`pnpm run docs:check`、`pnpm run ready` 及真实 `pnpm run test:oidc:dual:studio:late` 均待 Windows 实测。用户第四轮日志未打印本地 Git SHA，不能绑定 PR 当前 HEAD。

## 2026-11-17 · 第三十四批第十七小批 Windows 最终验收结案

维护者 Windows PowerShell 已分别运行离线质量链与隔离 Lab 真实浏览器专项，均已提供明确执行输出：

- `pnpm run test:oidc:dual:studio:config`：**16/16 通过**（本批最终新增 3 项 SVG 视口网格回归在内），失败 0；完整 `ready` 内再次执行 **16/16 通过**。
- `vp check`：**335** 个文件格式正确，**190** 个受检文件零警告、零 Lint / TypeScript 错误。
- `pnpm run docs:check`：**86** 份 Markdown 通过。
- 完整 `pnpm run ready`：**退出码 0**。依赖、配置、环境与中文文案门禁、Prisma Client 7.10.1 生成、Core 构建、React/Vue/Server 类型检查、Vitest **49 文件 / 567 项全通过**（Studio 共享 Session **31/31**）、SSE 客户端 **8/8**、TCP 故障代理 **4/4**、OIDC 工程浏览器安全离线 **33/33**、双主体 CAS 离线 **16/16**、本批 Studio 离线 **16/16**、ACL 撤销安全离线 **8/8**、NestJS HTTP E2E **6 文件 / 49 项全通过**，以及 React/Vue 与 NestJS 构建均执行至结尾。HTTP E2E 中预设的 401/404/503 负向响应与健康检查错误日志是受控测试，不代表整体命令失败。
- 独立交互式 `pnpm run test:oidc:dual:studio:late`：维护者 PowerShell 明确输出 **“真实 Studio 专项退出码：0”**。两位不同、同租户且已预绑定的 Keycloak 主体进入独立隔离浏览器，创建**两个新的随机专用空白工程**。React 和 Vue 分别通过真实 Studio UI 建立首版 CAS、真实 POST 写入修订 2；原 HTTP 201 到达浏览器后暂缓交付，第二主体真实读取修订 2 并以 HTTP 201 追加至 3；第一主体随后消费旧 201，真实页面恢复可见并完成服务器水位只读复核，旧 CAS 撤销，受控拒绝额外版本写入。两端均打印“真实 UI 迟到 201、CAS 复核失效、草稿保护与三版审计检查完成”，最终确认每个工程仅存在 1/2/3 三版，SVG 组态内容、IndexedDB 草稿与自动保存状态不被改写。测试工程按设计保留。

**证据与边界**：前四轮在真实浏览器中的测试夹具阶段错误、窗口可见性错误及非持久化 SVG 网格快照误报，最终候选未再阻断 Windows 双框架专项；但此前具体 DOM 差异没有独立抓取，不能断言第四轮变化只由网格引起。当前“画布内容未改变”依据的是排除单个视口网格的**工程内容快照**，仍严格比较其余 SVG 子节点、草稿整记录哈希和 CAS/审计。HTTP 201 延迟属于浏览器端在真实响应到达后的消费过程，**不是物理 TCP 断流**，也不是现场工业设备安全验证。真实 Lab 在受控本机 `adui_scada` 执行，此次**没有另行运行** `adui_scada_test` 32/32 或全新 Prisma 迁移。

**SHA 限制**：两段 Windows 日志没有本地 `git rev-parse HEAD`，不能精确绑定通过结果到 Git SHA；GitHub 补录前 PR #72 HEAD 为 `a69cf0c456ae39e157b015b366d00424941df155`，相较上次候选 `c681feba` 多出涉及两份测试脚本的一次提交。**本次新增验收和结案文档提交本身尚未经 Windows 再次运行** `vp check`、`docs:check` 或 `ready`。PR #72 继续 Draft，Assignee `@adui-dev`；未经维护者新的明确授权不合并。

## 第三十四批第十八小批 · 409 只读冲突恢复候选验收

新增的 `StudioServerProjectSession.previewLatestVersion` 只读读取身份、首版水位、快照及再次确认水位；每个 await 后验证上下文代次，拒绝并发修改、水位与快照不匹配和过期请求；当前 401/403/404 继续使旧权限缓存失效，503/network 继续保留合法 CAS。**只有后续真实人工确认载入**才允许重新建立 CAS。React/Vue 的恢复按钮仅在本工程发生 409 后显示，不允许预览行为更新画布和 IndexedDB；读完快照再次读取历史列表第一页并核验最新修订号，避免预览被后续变更悄悄覆盖。

新增测试目标：共享 CAS Session 由 **31 增至 37** 项，Vitest 全量由上一轮 **567 增至 573** 项；`test:projects:oidc:config` 由 **33 增至 35** 项。真正的 `test:projects:oidc:save:browser` 使用两端隔离 Chrome/Edge + Keycloak/BFF 会话、合成 409 后只读核验真实版本，必须保持浏览器非 GET 工程写入拦截及原本 401/503 回归；不涉及新增数据库写入或 Lab ACL 变更，也不等于另一场真实 PostgreSQL 并发 409。

**当前所有新增数字均为预期，不是实测通过记录。** 需要在 Windows 实际执行 `pnpm run test:projects:oidc:config`、`vp check`、`pnpm run docs:check`、完整 `pnpm run ready`，再在受控本机可信 OIDC HTTPS 环境独立执行 `pnpm run test:projects:oidc:save:browser`，分别核对 React/Vue 409 预览、仅一次被拦截 POST、真实 GET 与本地草稿保持不变，并记录每条命令退出码及 `git rev-parse HEAD`。不得从旧 PR #72 的成功日志推断本批通过。

## 第三十四批第十九小批 · 确认后再复核最新水位的验收要求

本批针对既有 `readVersion → window.confirm → loadDocument` 的时间差增加共享 `revalidateConfirmedLoad`，要求**用户确认后才发起**登录身份与服务端水位只读核验，核验全部成功且编辑工程上下文不变时才能暂停自动保存并替换画布。当前工程历史“载入”及授权工程“打开”在 React/Vue 中采用相同顺序，不自动覆盖草稿、重试写入或变更 CAS 语义。旧历史版本仍不能作为最新 CAS 基线；权限撤销必须阻断误创建；网络 503 保留原基线；延迟旧权限拒绝不能污染新会话。

新测试计划：共享 Session **8 项新增**，目标 **45/45**；全量 Vitest 目标 **581/581**，浏览器离线新增 2 项，目标 `test:projects:oidc:config` **37/37**。真实 `test:projects:oidc:save:browser` 在 React/Vue 原“取消载入、模拟水位冲突、确认载入”之间增加**确认后才合成远端 HEAD 漂移**的负向检查：必须先出现一次确认，再得到受控冲突，保持画布、草稿和自动保存，CAS 不被错误建立。原 409 保存模拟的最新版本只读预览完成后，还需真正点版本列表“载入”并确认；再次真实只读 GET 成功后，CAS 基线正确恢复，自动保存暂停，IndexedDB 草稿及 Lab 工程未写入，401/503 场景继续安全通过。

安全边界：浏览器模拟的确认后水位漂移及版本 POST 409/401/503 属于本机隔离 Profile 的合成拒绝/GET 替换，不是再次执行真实 PostgreSQL 并发写入；真实 GET 仍走受保护的 HTTPS BFF，浏览器隔离层截断所有工程 POST。单次确认后 GET 不保证数据库锁或原子一致性，服务端保存时继续原 CAS。**候选尚未实际运行 Windows Node/Vitest/类型检查、`vp check`、`docs:check`、完整 `ready` 或本机 Keycloak 浏览器专项**，不能使用上一小批的成功日志作为新改动的验收结果。需记录本机 HEAD SHA 与命令退出码。

## 第三十四批第二十小批 · 真实多标签页 OIDC 会话与 CAS 候选验收

新增 scripts/test-oidc-real-multitab.mjs 与 scripts/test-oidc-real-multitab.cases.mjs。离线用例目标 **9/9**，根 ready 新增 test:projects:oidc:multitab:config；真实浏览器命令 test:projects:oidc:multitab:browser 不纳入 ready，必须显式确认本机隔离数据库并手工运行。

真实专项使用一个临时浏览器 Profile 内的 React 写入/跟随、Vue 写入/跟随四个标签页。单用户登录后通过正式 BFF 创建唯一随机专用工程；React 与 Vue 写入端分别真实提交版本 2 和 3，两个跟随端分别切回前台验证 visibilitychange 后的真实身份/水位 GET、旧 CAS 清除、真实保存按钮拒绝旧基线且零工程 POST。最后通过真实 CSRF /api/v1/auth/logout 注销共享 Cookie 会话，两个跟随端重新可见时分别验证 401、服务端缓存失效及本地数据保持。

当前分支为 feature/v0.3-b34-multitab-oidc-session，基线 main@8cd2223853e7e5dc05695b8ab1226911ec7bd734。**当前仅有代码与文档候选，没有 Windows Node、vp check、docs:check、完整 ready 或真实 Chrome/Keycloak/PostgreSQL 浏览器执行记录。** 目标数量不能作为通过结果；验收时必须提供 git rev-parse HEAD、各命令输出及退出码。专用工程会按设计保留；不触碰其他工程、既有 ACL、身份映射、数据库迁移或工业设备；新工程仅由现有创建 API 按既定流程创建创建者默认权限，不手工增加其他主体授权。

## 2026-11-18 · 第二十小批首次空白标签页可见性探针缺陷修复候选

维护者提供的质量链日志已确认独立多标签页离线 9/9、`vp check` 337 格式文件 / 192 受检零错误、`docs:check` 86 Markdown、Vitest 581/581、NestJS HTTP E2E 49/49；日志末尾截至 NestJS Prisma Client 生成，缺少完整 `ready` 的最终退出码，也没有真实 `test:projects:oidc:multitab:browser` 命令及退出码。截图中五个标签页均显示 `about:blank`，具体浏览器专项结束状态尚不能由日志独立确认。

静态复核发现测试脚本在首次导航之前只注册 `Page.addScriptToEvaluateOnNewDocument`，但立即调用真实 `Page.bringToFront` 并要求可见性计数递增，存在当前空白文档尚未注册监听器而超时的问题。协作容器真实 Chromium 对照验证：旧空白文档 `probe=null`，额外调用一次 `session.evaluate(installMultiTabVisibilityProbeInPage)` 后，切回标签页可记录 `visibleEvents=1`。协作容器独立初始化顺序测试 **1/1** 通过；两者不是仓库 Windows 全量测试。本次只增加当前文档初始化及离线执行顺序断言，不更改生产业务代码、真实 `visibilitychange` 语义、OIDC 认证、CSRF、CAS 或 Lab 安全限制。

当前 GitHub 修复候选尚未由维护者 Windows 执行新离线目标 10/10、`vp check`、完整 `ready` 或真实多标签页专项。以上旧质量链数据不能等同本次修复已验收；需记录当前本地 `git rev-parse HEAD` 与各命令退出码。

## 2026-11-18 · 第二十小批真实四标签页首次工程载入误报修复候选（E-046）

维护者本机已执行 `pnpm run test:projects:oidc:multitab:browser`：真实 Keycloak 登录完成，四个标签页均确认同一 BFF 主体；进入 React/Vue Studio 工程复核后，报“标签页恢复改变了本地画布”，**专项退出码 1**。这一输出不能证明 SVG 数据丢失，也不能说明远端版本推进、注销或四标签页最终一致性已通过。

经当前 PR #76 源码核对，`openStudioProject` 返回的只是 `readMultiTabSessionStateInPage` 的 CAS/身份 UI 状态摘要，`canvas` 和 `drafts` 均不存在；而 React/Vue 首次确认打开工程后，用该摘要与刚创建草稿、开启自动保存所得的完整快照调用 `requireSameCanvasAndDrafts`，必然报画布差异。草稿创建、自动保存开启本就属于初始化的预期状态变更。候选最小修复只删除**首次初始化阶段**这两处错误跨类型比较，以初始化完成后的 `inspectProtectedState` 作为后续保护基准，新增离线回归模拟真实初始化操作。远端 CAS 水位变化、服务端身份失效、人工恢复后的所有 SVG/草稿数量/整记录 SHA-256/自动保存以及零工程 POST 断言全部保留。

本次维护者提供的**修复前** Windows 质量记录：离线 10/10、`vp check` 337 格式文件/192 受检零告警、`docs:check` 86 份、单测 581/581、HTTP E2E 49/49；`ready` 最后显示 Prisma Client 生成，缺少最终退出码。当前候选离线目标 **11/11**，新 HEAD 的 `vp check`、`docs:check`、完整 `ready` 和真实 Keycloak 浏览器专项待维护者执行。只根据本次代码修正无法声称多标签页真实测试已通过。

## 2026-11-18 · 第三十四批第二十一小批：多标签页本地快照有效性门禁候选

从已合并 PR #76 的真实浏览器专项继续，检查到 `requireSameCanvasAndDrafts` 原比较使用可选链，前后快照都缺失 IndexedDB `drafts` 时，`undefined === undefined` 会误判为没有变化。自动保存前后都缺失时也存在类似误判。该问题属于**测试断言边界**，不是已经证实发生的生产数据丢失事故。

本批只修改 `scripts/test-oidc-real-multitab.mjs` 的比较前有效性判断及对应 Node 离线用例：要求 SVG 快照为字符串、草稿数量为至少 1 的安全整数、整记录摘要为 64 位十六进制 SHA-256、自动保存为明确布尔值；任何缺失或损坏均按原有脱敏中文错误拒绝，正常快照的逐项严格比较和全部真实 CAS/注销保护保留。离线目标从 11 项增加至 **13 项（候选，尚未执行）**。不修改 React/Vue 正式页面、OIDC、工程 API、数据库、工业设备权限，也不创建或删除 Lab 工程。

**验收边界**：当前仅为 GitHub 代码候选，尚未执行新 HEAD 的 Windows `test:projects:oidc:multitab:config`、`vp check`、`docs:check`、`ready` 或真实四标签页专项，不得沿用 PR #76 已通过的退出码；若依赖和业务代码均未变化，可优先执行离线与完整质量链，再评估是否重跑真实专项。

## 2026-11-18 · 第三十四批第二十一小批 Windows 结案与第二十二小批候选

维护者 Windows 对第二十一小批提交的日志显示：`test:projects:oidc:multitab:config` **13/13**、退出码 **0**；完整 `pnpm run ready` 退出码 **0**，其中 `vp check` **337** 个格式文件和 **192** 个受检文件零警告/错误、Vitest **581/581**、HTTP E2E **49/49**、`docs:check` **86** 个 Markdown、React/Vue/NestJS 构建完成。日志未单独包含本地 `git rev-parse HEAD`；本批未重跑真实四标签页专项。维护者已明确授权，PR #77 经 GitHub Squash 合并至 `main@1969ae47ac5da2a9c5b3cc5c36003642f35f245f`。这是已合并旧提交的 Windows 验收，不等于下一批新代码已通过。

第二十二小批只扩展 `scripts/test-oidc-real-multitab.mjs` 与离线安全用例：原注销 HTTP 204 后增加 React **写入页**自身同源 `/auth/me` HTTP 401 核验；两个跟随页的所有 CAS/草稿/零写入断言不变；最后真实激活 Vue **写入页**并验证 Vue Origin 的 HTTP 401。新增 Node 纯函数在 200/204/403/500、网络失败 0、缺值及跨 Origin 时必须拒绝。离线目标 **14/14**，仅为候选目标，尚未执行新 HEAD 的 Windows 专项、`vp check`、`docs:check`、`ready` 或真实 Chrome/Keycloak 四标签页浏览器测试；不得以 PR #77 的结果代替。真实测试仍会按已有显式确认仅创建随机测试工程并追加修订 2/3，工程按原惯例保留，不清理既有数据。

建议维护者复核当前本地 HEAD 后执行：

```powershell
git rev-parse HEAD
pnpm run test:projects:oidc:multitab:config
Write-Host "离线专项退出码：$LASTEXITCODE"
pnpm run ready
Write-Host "完整质量链退出码：$LASTEXITCODE"
```

完整质量链通过后，在已启动受控本机 OIDC HTTPS Lab 且确认会创建一份新的专用工程、注销当前隔离浏览器会话时，再单独执行 `pnpm run test:projects:oidc:multitab:browser` 并记录最终退出码。禁止在终端输入或记录 Keycloak 密码。以上不代表工业现场或生产验收。

## 2026-11-18 · 第三十四批第二十二小批结案与第二十三小批候选

维护者 Windows 第二十二小批日志显示：`test:projects:oidc:multitab:config` **14/14**、退出码 **0**；完整 `pnpm run ready` 退出码 **0**，其中 `vp check` 337 个格式文件 / 192 受检零告警，Vitest **581/581**、HTTP E2E **49/49**、`docs:check` **86** 份及 React/Vue/NestJS 构建均成功。另有本机真实 `test:projects:oidc:multitab:browser` 退出码 **0**，确认四标签页 BFF 身份 GET 401、两个跟随 Studio 页的 CAS/草稿保护及旧 CAS 零写入；上传日志未单独包含 `git rev-parse HEAD`，无法独立确认本机 SHA。用户明确授权后，PR #78 已经 GitHub Squash 合并至 `main@43a2236bec8b528e0d7e1763dba58a558ddfab0a`。

第二十三小批新增**两个写入页**真实 Studio 确认载入修订 3、只读草稿快照与页面工程写入阻断，最终让 React/Vue 写入/跟随四个 Studio 页均通过现有可见性恢复、BFF 401、CAS/远端水位失效、旧保存零 POST、SVG/草稿/自动保存不变的全套断言。新增 Node 离线用例，目标 **15/15**，并未更改正式 React/Vue、NestJS、Prisma 或工业接口。真实 Lab 专项仍创建且保留单份随机专用工程、真实追加 2/3、执行一次隔离会话注销，不涉及已有项目或 ACL。

协作容器只对新增辅助函数的**同逻辑独立 Node 模拟**运行 `node --check` 与契约断言，**2/2** 通过；这不是仓库源码的真实 Node 离线测试，更不是 Windows `ready`、CDP/Keycloak 集成或工业安全验收。新 HEAD 的 `vp check`、`docs:check`、完整 `ready` 和真实四 Studio 标签页专项均**尚未执行**，旧批次通过的日志不能当成新批验收证据。

Windows 建议先执行 `git rev-parse HEAD`，再执行 `pnpm run test:projects:oidc:multitab:config` 和 `pnpm run ready`，记录每条最终退出码；质量链通过后再在已确认的本机隔离 OIDC HTTPS Lab 执行 `pnpm run test:projects:oidc:multitab:browser`，用真实 Chrome/Edge 完成单次 Keycloak 手动登录，最终核对浏览器专项退出码。测试将创建并保留新专用工程且注销隔离会话，禁止终端输入密码或输出令牌。

## 2026-11-18 · 第三十四批第二十三小批验收及第二十四小批候选

维护者 Windows 提供的第二十三小批日志已确认 `test:projects:oidc:multitab:config` **15/15**、退出码 **0**；完整 `pnpm run ready` 退出码 **0**，其中 `vp check` **337** 个格式文件、**192** 个受检文件零警告/错误，Vitest **581/581**、NestJS HTTP E2E **49/49**、`docs:check` **86** 份 Markdown，以及 React/Vue/NestJS 类型检查和构建完成。真实 Keycloak 四个 Studio 标签页专项退出码 **0**：四页经真实可见性切换失效 CAS/授权缓存，收到 BFF 401，本地 SVG/IndexedDB 草稿/自动保存保持不变，旧 CAS 保存未产生工程写入。原日志没有本地 `git rev-parse HEAD`，未独立关联确切 SHA；PR #79 按维护者明确授权 Squash 合并到 `main@922a72d808658e81d80930436dfabae081b4f83c`。

第二十四小批仅扩展注销后尚未恢复可见的三个隐藏 Studio 标签页的保护检查：原 CAS 水位及未拒绝身份必须保留，后台操作不忙碌、写入计数为零；更重要的是在切回前台之前即重新取得完整 SVG 内容、IndexedDB 草稿数量及整记录 SHA-256、自动保存状态，并逐项比对注销前基线。缺失或发生变化必须失败。新增 2 项 Node 离线用例：一项覆盖非法隐藏页 CAS/水位/后台写入，一项通过真实测试辅助函数 Mock 验证先确认 hidden 再只读读取完整快照，并拒绝草稿哈希变化；**目标 17/17（仅候选目标）**；四个 Studio 页面注销后的已有真实 BFF 401、CAS/授权失效、零保存写入与快照断言均保留。

**当前尚未执行第二十四小批新 HEAD 的仓库 Node 离线测试、`vp check`、`docs:check`、完整 `pnpm run ready` 或真实 Chrome/Edge/Keycloak 四标签页专项**。协作环境无法通过公共网络获取此 GitHub 仓库以复跑完整测试；上批通过结果不可冒充新提交验收。新测试仍在已确认的本机隔离 Lab 中通过既有受控创建接口生成并保留一份随机测试工程，真实追加版本 2/3 并注销隔离会话，不碰已有工程和授权。

Windows 下一轮应先 `git rev-parse HEAD` 确认当前 PR 提交，再运行 `pnpm run test:projects:oidc:multitab:config` 和 `pnpm run ready`，记录各自最终退出码；质量链均通过且已确认本机隔离 OIDC HTTPS Lab 后，手动执行 `pnpm run test:projects:oidc:multitab:browser` 并检查最终退出码。禁止把 Keycloak 口令输入终端、复用生产数据或输出敏感令牌。

## 2026-11-18 · 第三十四批第二十四小批 Windows 结案及第二十五小批候选

维护者提供的第二十四小批 Windows 日志：`pnpm run test:projects:oidc:multitab:config` **17/17**、退出码 **0**；完整 `pnpm run ready` **退出码 0**，其中 `vp check` **337** 格式文件和 **192** 个受检文件零警告/错误，Vitest **581/581**、NestJS HTTP E2E **49/49**、`docs:check` **86** 份，React/Vue/NestJS 类型检查和构建完成。真实 `pnpm run test:projects:oidc:multitab:browser` **退出码 0**，三个隐藏 Studio 页恢复前的 CAS、SVG、IndexedDB 草稿、自动保存和零写入安全断言通过，四页恢复后同源身份 HTTP 401 及旧 CAS 零工程写入通过。日志无独立 `git rev-parse HEAD`；经核对，PR #80 后续只多一处测试断言排版提交，并已在用户明确授权后 Squash 合并到 `main@2559d6ff7375cac22ad9741d98e121408269e3ad`。不得将第二十四小批结果等同于下一批的新 HEAD 验收。

第二十五小批只增强测试脚本中**注销后受保护工程只读 API 的真实 HTTP 拒绝验证**：React 与 Vue 两个 HTTPS Origin 的工程列表 `GET /api/v1/projects?limit=10` 和本轮随机专用工程历史版本 `GET /api/v1/projects/{id}/versions/3` 均必须返回 **401**。只读探针拒绝任意其他工程 ID/跨 Origin，且不读取返回正文。新增两项 Node 离线回归（同源/只读路径白名单与异常 HTTP/网络拒绝），**目标 19/19，仅为候选数量**。不改变正式 UI、共享 API Client、NestJS、Prisma、数据库或工业权限，也不削弱原四标签页、CAS/本地数据安全断言。

**新 HEAD 的 Windows `test:projects:oidc:multitab:config`、`vp check`、`docs:check`、完整 `pnpm run ready` 和真实 Keycloak 四标签页专项均尚未执行。** 必须记录真实退出码与本地 `git rev-parse HEAD`。真实专项仍需显式确认本机隔离 Lab，会创建并保留一份随机测试工程、追加版本 2/3 并注销隔离会话；禁止输入终端密码、输出 Cookie/Token、触碰既有工程或生产数据库。

## 2026-11-18 · 第三十四批第二十五小批验收结案与第二十六小批候选

维护者提交的第二十五小批 Windows 日志：`pnpm run test:projects:oidc:multitab:config` **19/19**，退出码 **0**；完整 `pnpm run ready` **退出码 0**，其中 `vp check` 337 个格式文件、192 个受检文件零警告/Lint/类型错误，Vitest **581/581**，HTTP E2E **49/49**，`docs:check` **86** 份，React/Vue/NestJS 类型检查与构建均成功。真实 `pnpm run test:projects:oidc:multitab:browser` **退出码 0**：四个 Studio 页 CAS/身份/本地数据保护及零过期工程写入保持，两个 HTTPS Origin 的工程列表和指定修订版本 GET 真实返回 401。维护者日志未提供独立的 `git rev-parse HEAD`；GitHub 核对 PR #81 最新提交仅包含测试排版调整，无断言语义变化。维护者明确授权后已 Squash 合并为 `main@21085c1ebde325c8420e7f31e75294e030d8cd0a`。

第二十六小批经真实 NestJS Controller 确认工程共有四条受保护 GET 路由。仅对原脚本已存在的双 Origin 注销后探针补充工程详情 `GET /:id` 和历史版本列表 `GET /:id/versions?limit=10`，连同已覆盖的列表与指定版本，要求**四条全部真实返回 HTTP 401**。严格同源只读、随机专用工程 ID、无响应正文与零额外工程写入，原四 Studio 页恢复及 SVG/IndexedDB/自动保存断言不变。现有 19 项离线用例中两项按四路由调整，额外新增一项逐路径失败回归；**新目标 20/20（尚未执行）**。

**第二十六小批新 HEAD 的 Windows `test:projects:oidc:multitab:config`、`vp check`、`docs:check`、完整 `pnpm run ready` 和真实 Keycloak 四标签页专项尚未执行。** 旧 PR #81 退出码不得视为本批结果。建议在 Windows 先执行 `git rev-parse HEAD` 记录测试对应 SHA，再按顺序执行上述离线专项与完整质量链；全部真实退出码为 0 后，再在显式确认的本机 OIDC HTTPS Lab 运行 `pnpm run test:projects:oidc:multitab:browser`。交互式测试仍创建并保留随机专用工程、追加修订 2/3、注销当前隔离会话，禁止输入终端密码、输出真实令牌或操作生产工程。

## 2026-11-18 · 第三十四批第二十六小批结案及第二十七小批候选

维护者 Windows 已提交第二十六小批日志：`test:projects:oidc:multitab:config` **20/20**、退出码 **0**；完整 `pnpm run ready` **退出码 0**，其中 `vp check` **337** 个格式文件 / **192** 受检文件零警告，Vitest **581/581**、NestJS HTTP E2E **49/49**、`docs:check` **86** 份且 React/Vue/NestJS 类型检查与构建成功。真实 `pnpm run test:projects:oidc:multitab:browser` **退出码 0**，React/Vue 双 Origin 四条工程只读 GET 实际返回 BFF 401，四 Studio 标签页 CAS/授权失效和本地 SVG/IndexedDB/自动保存/零写入保护均通过。日志未单独包含本地 `git rev-parse HEAD`；GitHub 对 PR #82 附加提交的 diff 确认为一处测试断言排版。用户明确授权后 PR #82 经 Squash 合并至 `main@9fd3b863af8c2af7518d1f8a2e256c85e3bc08ab`。

第二十七小批针对 NestJS Session Guard 在 Controller 执行前拒绝 401/403 的响应缓存策略，仅在该 Guard HTTP 路径提前设置 `Cache-Control: no-store` 和 `Pragma: no-cache`，不修改任何权限分支或写入。新增两项 Guard 单测，原 Vitest **581 项**基础上目标 **583 项**；真实 OIDC 根模块 E2E 在已有两项匿名 401 用例增加响应头检查，**E2E 数量仍为 49 项**。这些数字为待执行目标，尚非运行结果。

**新 HEAD 尚未执行** Windows `vp check`、`pnpm run test:unit`、`pnpm run test:e2e:server`、`docs:check`、完整 `pnpm run ready` 或真实 Keycloak OIDC Lab 回归。需先核对 `git rev-parse HEAD`，再执行完整 `ready` 记录最终退出码；此批不改浏览器前端，如需复验真实多标签页，现有 `test:projects:oidc:multitab:browser` 仍涉及新建并保留一份专用工程及注销隔离会话，必须继续使用显式本机 Lab 确认。不得以此前 PR #82 的结果代替本批验证，也不得声称生产现场或工业设备安全认证。

## 2026-11-18 · 第三十四批第二十七小批 Windows 首轮失败与 E-047 修复候选

维护者 Windows 在 PR #83 原候选上执行 `vp check`：**337** 个格式文件正确、**192** 个受检文件零警告/Lint/类型错误；`pnpm run test:unit`：**580/583**（49 个文件中 48 个通过，`scada-identity.spec.ts` 有 **3 项失败**）；`pnpm run test:e2e:server`：**49/49**；`pnpm run docs:check`：**86** 份 Markdown 通过；完整 `pnpm run ready` 在相同三项单测失败处中止，**退出码 1**。因此原 HEAD **未通过完整质量链**，不能因 49/49 E2E 成功就标记验收通过。日志未提供本地 `git rev-parse HEAD` 结果，不擅自关联具体 SHA。

三项失败具有同一代码根因：`ScadaSessionGuard` 新增 `context.switchToHttp().getResponse().setHeader()` 以在早期 401/403 阻止缓存，但 `apps/server/src/auth/scada-identity.spec.ts` 的共用 `context()` Mock 尚未实现 `getResponse`，实际抛出 `TypeError: http.getResponse is not a function`，导致原 Unauthorized/成功/审计断言未进入目标流程。修复候选仅补充此 Mock 的 `setHeader()` 及响应头记录，并在原失败场景加入对 `no-store` / `no-cache` 的正向断言；正式 Guard、授权逻辑和原 583 项测试数量不变。

**修复后的新 HEAD 尚未运行 Windows 复验**。优先在候选分支执行 `pnpm --filter @adui/scada-server exec vp test run src/auth/scada-identity.spec.ts` 或按现有 `pnpm run test:unit` 做全量回归；应获得 **583/583** 后再执行 `vp check`、`pnpm run docs:check`、完整 `pnpm run ready` 并核对最终退出码。此次测试 Mock 修复不要求创建新的 Keycloak 测试工程，不影响 React/Vue 业务页面或工业设备读写；真实浏览器如需再次复核，仍须遵守隔离 Lab 的明确确认限制。参见 E-047。

## 2026-11-18 · 第三十四批第二十七小批结案与第二十八小批候选

维护者 Windows 在 PR #83 的 E-047 Mock 修复后提供了实际 `pnpm run test:unit`：**49/49 文件、583/583 用例通过，退出码 0**；完整 `pnpm run ready` **退出码 0**，包含 `vp check` **337** 个格式文件、**192** 个受检文件零警告/Lint/类型错误，SSE **8/8**、故障代理 **4/4**、OIDC 多标签离线 **20/20**、NestJS HTTP E2E **49/49**、`docs:check` **86** 份、React/Vue/NestJS 类型检查及构建成功。由此 E-047 历史 580/583、`ready` 退出码 1 已关闭。维护者日志未提供本地 `git rev-parse HEAD`，仅能按已核查的后续 GitHub 提交记录判断差异；PR #83 按明确授权 Squash 合并到 `main@650b084f770bb92241b3b93a02689160b7b8bc41`。

第二十八小批只扩充 `apps/server/test/oidc-module-bootstrap.e2e-spec.ts` 的真实 OIDC 根模块 HTTP 403 路径。分别模拟可信来源但缺少 CSRF 请求头，以及有正确测试 CSRF 值但不可信来源，均要求 `POST /api/v1/auth/logout` 返回 403 JSON、`Cache-Control: no-store`、`Pragma: no-cache`、无 `Set-Cookie` 清除、无重定向。真实 Guard 被调用但 Prisma 是空 Mock，不可接触真实会话、真实数据库或 Keycloak。原 49 项 HTTP E2E 目标扩展为 **51/51**；Vitest 单元测试维持 **583/583**（均仅为待测目标）。

**第二十八小批的新 HEAD 尚未运行** Windows `vp check`、`pnpm run test:e2e:server`、`pnpm run test:unit`、`pnpm run docs:check` 或完整 `pnpm run ready`。上批 583/583、49/49 和 `ready` 0 是**已合并旧代码**的真实结果，不能用来声明新提交通过。维护者应先记录 `git rev-parse HEAD`，再执行 HTTP E2E（目标 51/51）和完整 `ready`（最终退出码必须 0）。此批不需要额外启动真实 Keycloak、创建测试工程或执行数据库写操作。

## 2026-11-18 · PR #84 已验收合并与 PR #75 冲突修复候选

维护者 Windows 在 PR #84 新增的真实 OIDC 根模块 403 禁缓存 E2E 后执行 `pnpm run test:e2e:server` **6/6 文件、51/51 用例、退出码 0**；完整 `pnpm run ready` **退出码 0**，含 `vp check` **337** 格式文件 / **192** 受检零警告错误、Vitest **583/583**、HTTP E2E **51/51**、文档 **86** 份与 React/Vue/NestJS 构建。PR #84 按用户明确授权 Squash 合并至 `main@fd2a600b45f4c2c7400984932b69c46da18ab028`；用户日志未提供本地 `git rev-parse HEAD`。

审查发现此前遗留的 PR #75 仍 Open / Draft，基于老的 `main@8cd2223853e7e5dc05695b8ab1226911ec7bd734`，与当前主线文档/`package.json` 冲突；它新增的**同一 Origin 双标签 CAS** 与后来已合并的四页注销专项并不相同，不能直接关闭丢弃。原 PR #75 文档中使用的 E-045/E-046/E-047 错误编号与现主线发生冲突，冲突解决仅保留主线的这些复盘，旧分支局部错误整理入新的 E-048。原分支 18 项离线用例**从无 Windows 实测结果**，不视为通过。

按当前 `main` 构造双父提交的 Git 合流，保留旧 PR #75 全部历史并保留主线所有后续安全代码和文档；在新脚本内修正两处 CDP 页面函数对 Node 作用域 `PROJECT_PATTERN` 的非法引用，新增 1 项序列化边界回归，离线安全目标 **19/19**；根 `package.json` 仅添加两个专项命令且仅将**离线**配置专项加入现有 `ready`。新分支源码尚未运行本地 Node、Windows `vp check`、`docs:check`、完整 `ready` 或真实 Keycloak/双 Origin/数据库浏览器专项；**不能将 PR #84 的成功日志迁移到 PR #75**。待真实日志与 `$LASTEXITCODE` 完成之后，再请求新一轮合并授权。

## 2026-11-18 · 第三十五批第一小批静态发布预检待验收

第三十四批遗留 PR #75 已在 Windows 实测：双标签离线 19/19、完整 ready 退出码 0、真实 React/Vue 同源双标签 Chrome + Keycloak + PostgreSQL CAS 专项退出码 0；单元测试 583/583、HTTP E2E 51/51、vp check 339 格式文件及 194 受检零告警，docs:check 86 份。PR #75 在明确授权后 Squash 合并到 main@46dd07177bdd9528443f7fe621f1a48deac483a0。日志没有独立本地 HEAD，不将执行记录绑定到未核实的精确 SHA。

本小批新建 Core 静态预检 validateProjectReleasePreflight，新增 10 项 Vitest，目标全量 593/593（**尚未执行**）。预检只校验当前 SVG 能否消费工程图元、版本、绑定与规则，不创建发布版本，不操作远端数据库或现场设备。Windows 新 HEAD 的 vp check、typecheck、test:unit、docs:check 和完整 pnpm run ready **均待运行**，上一批成功不能代替此批结果。

## 2026-11-18 · PR #85 合并验收与第三十五批第二小批待测

维护者上传的 Windows 原始日志：PR #85 第一小批 Core 发布静态预检 `pnpm run test:unit` **50/50 文件、593/593 用例通过，退出码 0**；`vp check` **341** 格式文件、**196** 受检文件零警告错误、退出码 **0**；完整 `pnpm run ready` **退出码 0**，含 593/593 Vitest、51/51 NestJS HTTP E2E、docs:check 86 份、React/Vue/NestJS 类型检查与构建。用户日志未单独提供 `git rev-parse HEAD`；GitHub 最后一个 HEAD 仅对两份文档做尾部空行格式清理。经用户明确授权，PR #85 Squash 合并至 `main@b0bf3f683030d3e87e2f3a9b360294ff332cdbc7`。此结论不代表已经提供正式发布服务。

第三十五批第二小批仅对 React/Vue Studio 新增「发布预检」菜单，借助 Core 根据当前文档展示静态兼容性通过提示，或逐项显示错误路径与中文原因。结果从当前编辑器快照派生，工程切换/导入/修改后不保留旧报告；菜单没有写入动作。另在既有 `scripts/test-studio-browser.mjs` 添加 `--release-preflight` 双框架隔离浏览器专项、根 `test:release:preflight:browser` 命令。专项通过真实 JSON 导入/导出测试合法演示、不支持的图元/规则/已绑定 unknown Tag、恢复合法工程，保留原始数据且不发工程网络请求。

**新 HEAD 尚未运行 Windows** `vp check`、`typecheck:web`、`test:unit`（目标仍 593/593）、`test:browser`（双视口）、`test:release:preflight:browser`、`docs:check` 或完整 `ready`，不得借用 PR #85 质量链成功来声明本次 Vue/React UI 已通过。浏览器专项在默认 `ready` 之外，必须单独执行并记录退出码。本批不产生工程发布、数据库事务或工业设备写入。

## 2026-11-18 · PR #86 授权合并与第三十五批第三小批待验收

维护者提交的 Windows `pnpm run test:unit` 结果为 **593/593**，`vp check` 为 **341 格式文件 / 196 受检文件零告警**，完整 `pnpm run ready` **退出码 0**，含 HTTP E2E **51/51**、文档 **86 份**、React/Vue 与 NestJS 构建成功。GitHub PR #86 合并前 HEAD 为 `d4ef0b68d91658b60204587a22c63cf26e473f72`，获维护者本次明确授权 Squash 合并为 `main@a934a33ba2251880f934ff4f5e9937ff78711f5c`。日志**未提供本地 Git HEAD**，**未提供** `test:browser` 和 `test:release:preflight:browser` 的独立结果；这两项仍须补测。

第三十五批第三小批变更 `release-preflight.ts` 的 SVG 图元已消费属性白名单，新增三项反向/正向 Core 单测，预期单元测试目标为 **596/596**（仅预测，非实测）。请在 Windows 新分支 `feat/v0.3-b35-preflight-prop-compatibility` 核对 `git rev-parse HEAD` 并执行 `pnpm run test:unit`、`vp check`、`pnpm run docs:check`、`pnpm run ready`；在 React/Vue Web 本机服务启动后执行 `pnpm run test:browser` 和 `pnpm run test:release:preflight:browser`，逐项记录退出码。所有待验收项目均不得标记为通过。

## 2026-11-18 · PR #87 Windows 离线验收与 HTTPS 浏览器探测修复候选

维护者在 Windows 第三十五批第三小批执行的原始日志显示：`pnpm run test:unit` **50/50 文件、596/596 用例、退出码 0**；`vp check` **341 个格式文件、196 个受检文件零警告错误、退出码 0**；`pnpm run docs:check` **86 份 Markdown、退出码 0**；完整 `pnpm run ready` **退出码 0**，含 HTTP E2E **51/51**、React/Vue/NestJS 类型检查与构建通过。日志未给独立 `git rev-parse HEAD`，不能将结果绑定到本次后续新增的浏览器补丁提交。

维护者同时启动的两套 Vite Web 均为 HTTPS（React 15173、Vue 15174），但 `scripts/test-studio-browser.mjs` 原探测仍为 HTTP：`pnpm run test:browser` 和 `pnpm run test:release:preflight:browser` **均在 React 首页探测处退出码 1**，没有开始浏览器内容校验。确认是测试目标 URL 协议拼接错误，不是本轮已证明的前端业务缺陷。

修复候选将目标解析独立到 `scripts/studio-browser-targets.mjs`，读取既有 `SCADA_OIDC_DEV_HTTPS_ENABLED`，仅访问回环地址，HTTPS 禁止降级；通过严格 Node HTTPS 证书校验并显式读取 `NODE_EXTRA_CA_CERTS` 只读探测，不关闭 TLS。新增 `test:studio:browser:config` 并纳入 `ready`，有 **6 项** Node 离线用例。协作容器使用与 GitHub Blob SHA 相同的两个文件，`node --test` **6/6 通过**，另以临时本机自签 HTTPS 服务验证不可信证书拒绝、显式信任后通过；不代表真实 Windows 双框架专项通过。

**新 HEAD 仍待 Windows 实测**：`pnpm run test:studio:browser:config`、`vp check`、`pnpm run docs:check`、`pnpm run ready`、`pnpm run test:browser` 和 `pnpm run test:release:preflight:browser`；Chrome/Edge 必须信任本机 CA，不得使用忽略证书参数。新增配置测试不计入 596 项 Vitest，完整 `ready` 应包含独立 Node 6 项检查。

## 2026-11-18 · PR #87 合并与第三十五批第四小批服务端预检待测

维护者上传 Windows 原始记录证明 PR #87 的 `test:browser`：React/Vue × 两分辨率各 **19/19**，退出码 **0**；`test:release:preflight:browser` 双框架均通过，退出码 **0**；`test:unit` **596/596**，`vp check` **343 文件格式正确 / 198 受检零告警**，`docs:check` **86 Markdown**，完整 `ready` **退出码 0**，包括 HTTP E2E **51/51**、双框架/服务端构建。日志未附本地 `git rev-parse HEAD`。GitHub HEAD 经核对为 `c16595774798e213f2da4bfea4cfd718677cf3be`，维护者明确授权后 PR #87 Squash 合并至 `main@602540baa570dfca21bd56f71ec634bb0263312d`。

第三十五批第四小批引入只读 `GET /api/v1/projects/:projectId/versions/:revision/release-preflight`；只允许经 OIDC/BFF 认证且拥有 `version:read` 的用户读取与当前水位完全匹配的服务端历史快照兼容报告。使用同事务工程行共享锁、权限复核、历史快照 SHA-256/数据库字段检查与 Core 静态门禁。新加 **6** 项仓储 Vitest、**4** 项 NestJS Mock HTTP E2E。拟定目标 **602/602** 单测、**55/55** HTTP E2E、`vp check` 零警告、文档检查与完整 `ready` 退出码 **0**；目标不是实测结果。

需 Windows 在最新功能分支记录 `git rev-parse HEAD`，分别运行 `pnpm run test:unit`、`pnpm run test:e2e:server`、`vp check`、`pnpm run docs:check`、`pnpm run ready` 并保留各自退出码。现有真实 PostgreSQL `test:db` 未为新接口新增专用数据库场景；Mock HTTP E2E 不等于真实 OIDC + PostgreSQL 只读 HTTP 实测。此批不改 Prisma 迁移，不建立正式发布权限或数据写入。

## 2026-11-18 · PR #88 验收合并与第三十五批第五小批真实 PostgreSQL HTTP 发布预检候选

维护者上传的 Windows 原始日志已确认第四小批 `pnpm run test:unit` **602/602**、`pnpm run test:e2e:server` **55/55**、`vp check` **343 格式文件/198 受检零告警**、`docs:check` **86 份**、完整 `pnpm run ready` **退出码 0**，React/Vue 与 NestJS 构建成功；完整 `ready` 包括 Node 浏览器协议安全门禁。原始日志未包含独立本机 `git rev-parse HEAD`，因此不宣称这些结果已经严格绑定到 GitHub SHA。PR #88 的 GitHub HEAD `874ea667e5858e73eeb7363c005c104f2bc34fe5` 已核对，按维护者本轮明确授权 Squash 合并至 `main@058277f20088d20e0d3f6cd58ff553868cc92c48`。

第五小批只修改 **`apps/server/test/projects-cas-cookie-http.db-spec.ts`** 的隔离 PostgreSQL + NestJS Cookie HTTP 回归，并沿用该文件原有的 `SCADA_TEST_DATABASE_URL` 本机 `adui_scada_test` 白名单及 `withFixture` 随机租户清理。新增 **4 项**：两个会话的当前版本只读报告及匿名 401，真实修订水位推进后的旧版 409 与新版本兼容性错误，撤销第二主体 `version:read` ACL 后 404，以及**仅在本次随机测试租户**破坏历史快照数据库摘要后 500 且不产生新版本。成功/拒绝请求均对照真实 PostgreSQL 的 head、版本数量和审计数量；绝不访问既有租户工程、生产数据库或工业设备。被破坏的测试行在 `finally` 内随随机租户清理，不引入迁移。

**候选暂未实测**：新分支需要 Windows `git rev-parse HEAD`，分别执行 `vp check`、`pnpm run docs:check`、`pnpm run ready` 和独立 **`pnpm run test:db`**。现有 `ready` 不包含真实数据库专项；旧 `602/602`、`55/55` 为第四小批实测基线，不能视为当前新 HEAD 已验收。此批复用服务端内部测试可信主体签发，**不执行真实 Keycloak 授权码/JWKS 交互**；只证明隔离库真实 HTTP/Cookie/ACL/Prisma 路径，不代替真实 OIDC 浏览器验收与发布安全审查。

## 2026-11-18 · PR #89 新用例未使用会话参数的 Vite+ 修复待复测

维护者 Windows 执行 `vp check --fix` 报告 `apps/server/test/projects-cas-cookie-http.db-spec.ts:539`：`eslint(no-unused-vars)` 1 条警告及 `typescript(TS6133)` 1 条错误，都是新数据库发布预检用例未使用的 `sessionA` 解构；该次**格式化完成，但代码检查失败**。没有证据表明后续 `test:db` 或完整 `ready` 已运行。

已在 PR #89 同一功能分支最小删除该用例未使用的 `sessionA` 参数，保留 `tenantId`、`sessionB`、原 `subjectA` 主体标识、版本水位、静态兼容报告和审计断言。GitHub 回读源码的静态核对通过；**新的 Windows `vp check`、`docs:check`、`ready` 和隔离 PostgreSQL `test:db` 均待维护者执行**，未以代码修复冒充测试通过。详见 `docs/AI_MISTAKES.md` E-050。运行 `vp check --fix` 可能留下本地格式变动，更新远端分支前应先检查 `git status --short` 和 `git diff`，不得直接清理用户本地改动。

## 2026-11-18 · PR #89 授权合并与第三十五批第六小批真实 Keycloak 发布预检候选

第五小批 PR #89 的 Windows 原始证据：本机独立 `adui_scada_test` 的 4 项 Prisma 迁移最新、`pnpm run test:db` **4/4 文件、36/36 项，退出码 0**；`vp check` **343 格式文件、198 受检零告警**，`test:unit` **602/602**、HTTP E2E **55/55**、86 份 Markdown 文档检查、完整 `ready` **退出码 0**。测试负向分支故意破坏随机测试租户摘要时，NestJS 内部 ERROR 堆栈是预期受控 500 的服务端日志，不是对外响应泄漏，也不影响整套测试最终成功。用户日志未含本机 `git rev-parse HEAD`，不能把测试结果严格绑定到某 SHA。GitHub PR #89 合并前 HEAD 为 `8f09025a0a3b15e6e8ac0d134103a51a7606e284`，获维护者本轮明确授权 Squash 合并至 `main@9825a80badffa7863590b893a337c4c52e9e0d29`。

第六小批在该主线新分支增加 `scripts/test-oidc-release-preflight.mjs`、同名 `.cases.mjs` 与根命令。浏览器专项只复用已有可信 Keycloak 登录 / HTTPS 双 Origin，选取真实 `project:read` + `version:read` 的已保存工程，逐一 GET 读取与核对版本、摘要、200 报告、无缓存、400、409，检查 React/Vue 返回一致且工程 head 未变化。没有任何正式发布写入或工业设备请求；不创建、删除、更新工程/ACL，也不从浏览器读取 Cookie 或密钥。新离线用例共 **11 项**，独立 Node 命令已加入常规 `ready`；真实交互式浏览器专项必须另行执行。

**协作环境中已完成的验证仅限于**：从 GitHub 最新页面函数源码提取后在隔离 V8 直接执行的 11/11 安全契约用例，以及额外 8/8 正向/负向请求模拟；这不是 Windows Node `node --test`、Vite+、完整 `ready` 或真实 Keycloak 浏览器执行记录。**本分支这些 Windows 命令与真实 Keycloak 登录均待实测**，不得宣称已经通过。原先的 Vitest 602/602、NestJS HTTP E2E 55/55 与 test:db 36/36 只属于合并前验收基线。

## 2026-11-18 · PR #90 OIDC 发布预检测试对象展开 Lint 警告与修复候选

维护者在 Windows 执行 `vp check --fix` 时，`scripts/test-oidc-release-preflight.cases.mjs:190` 出现 **1 条** `typescript(no-misused-spread)` 警告、**0 错误**。原因是 Mock `Map` 中的响应正文存在数组/对象联合类型，测试将 `old.body` 未经非数组对象校验直接展开；格式化完成不能视为静态检查通过。

PR #90 功能分支已最小增加 `assert.ok(old?.body && !Array.isArray(old.body), "发布预检测试夹具正文必须为对象")` 后才展开原正文，保留所有四个负向断言。GitHub 回读已验证此断言存在。**新 HEAD 的 Windows `vp check`、`pnpm run test:release:preflight:oidc:config`、`pnpm run docs:check`、完整 `pnpm run ready` 及交互式真实 Keycloak 浏览器专项均待执行**；不得将修复前的检查或其他 V8 模拟结果记作 Windows 新 HEAD 通过。参见 `docs/AI_MISTAKES.md` E-051。

## 2026-11-18 · PR #90 合并与第三十五批第七小批共享 API Client 待验收

PR #90 已依据维护者明确授权 Squash 合并至 `main@1e891193f0a4fb9191b1f24bdf369713c7e54aeb`，合并前 GitHub HEAD `72437a996c163fec05f55560f68f782eea8da488`，Assignee `@adui-dev`。Windows 原始日志中 `pnpm run test:release:preflight:oidc:config` **11/11**、`vp check` **345 格式文件/200 受检零告警**、`docs:check` **86 份**、完整 `ready` **退出码 0**（Vitest **602/602**、HTTP E2E **55/55**、三端构建成功）；另由维护者两次实际执行真实 Keycloak React/Vue 双 Origin 发布预检浏览器专项，结果均通过、退出码均 **0**。日志没有独立本地 Git HEAD，不得将 Windows 结果宣称为严格 SHA 级绑定。

第七小批仅修改 `@adui/scada-api-client` 和对应测试/文档：添加只读 `preflightRelease(projectId, revision)` 与响应字段、摘要、问题码、no-store 的白名单验证；单测新增 **8** 项，已有 Studio 会话测试 Mock 补齐新方法。服务端 NestJS GET 与 React/Vue UI 不改，正式发布/回滚/工业设备写入不开放。新分支在协作环境中完成源码与现有契约静态核对，**未实际执行 Windows `vp check`、`test:unit`、`test:e2e:server`、`docs:check`、完整 `ready` 或双框架真实浏览器专项**。下一轮目标：Vitest **610/610**、HTTP E2E **55/55**、Vite+ 零警告、文档检查及完整 `ready` 退出码 0，目标不是已取得的结果。测试应先核对 `git rev-parse HEAD` 与工作区状态，不覆盖维护者本地改动。

## 2026-11-18 · PR #91 授权合并与第三十五批第八小批待验收

PR #91 Windows 原始测试证据：`pnpm run test:unit` **50/50 文件 610/610 项，退出码 0**；`test:e2e:server` **6/6 文件 55/55 项，退出码 0**；`vp check` **345 格式文件 / 200 受检零告警，退出码 0**；`docs:check` **86 份，退出码 0**；`pnpm run ready` **退出码 0**，React/Vue/NestJS 编译与构建成功。HTTP E2E 中 Health 503 是显式模拟就绪失败的负向用例，不代表 E2E 整体失败。测试日志没有独立本地 Git HEAD，因此不严格绑定到单笔 SHA。PR #91 GitHub 合并前 HEAD `ea4c6f93cf16edabb070e81fb0c9fc23c455c3f0`，获得维护者明确授权后 Squash 合并至 `main@1e4626bf7e8a2f08e5c4bc52c8907f3bc2149b28`。

第八小批只读共享水位编排新增 5 项 Vitest，React/Vue 同步增加手动点击后对照已保存快照的服务端预检组件及 ACL 失败通知，并调整既有静态发布预检浏览器专项的手动按钮/默认未查询断言。保持工程 Schema、Studio 保存/载入、草稿和 CAS 状态逻辑不变。**当前新 HEAD 未执行 Windows `test:unit`、`vp check`、`docs:check`、`ready`、`test:release:preflight:browser` 或真实 Keycloak UI 点击验收**。预期 Vitest **615/615**、HTTP E2E **55/55**、完整 `ready=0`，仅属待实测目标。真实浏览器专项需在 React/Vue 开发服务已启动的环境执行；如 HTTPS 代理已启用，沿用现有可信 TLS Lab 设置，不可降级证书验证。

## 2026-11-18 · PR #92 合并与第三十五批第九小批 OIDC Studio UI 候选

第八小批维护者 Windows 日志：`pnpm run test:unit` 51/51 文件、**615/615 项通过，退出码 0**；`test:e2e:server` 6/6 文件、**55/55 项通过，退出码 0**；`vp check` **349/204 零告警**，`docs:check` **86 份**，完整 `ready` **退出码 0**，双框架/服务端构建通过；`test:release:preflight:browser` React/Vue 双端通过退出码 0。没有单独本地 HEAD。经用户本轮授权，PR #92 从 GitHub HEAD `8c779edf1cbd59d2700e842fa75a6750ead8aeb2` Squash 合并至 `main@172181972b424a19f8a00def6127fd35cb15a389`。

第九小批候选新增真实 OIDC Studio 手动预检按钮专项、12 项 Node 离线契约及命令。浏览器在页面初始化前阻断任何工程写入，使用已有授权工程核对双框架真实 UI 四段 GET、已保存快照与未保存画布的区分、401/404/409 模拟拒绝和 IndexedDB/CAS 保护，结束时复核真实工程水位与摘要。本轮协作环境从 GitHub 实际源文件提取函数后，使用受控 V8 模拟运行新增契约 **12/12**，这**不是** Windows Node `--test`、真实 Chrome/Edge/Keycloak 登录或完整仓库检查通过。新分支 `pnpm run test:release:preflight:oidc:studio:config`、`vp check`、`test:unit`、`docs:check`、`ready` 与真实 `test:release:preflight:oidc:studio:browser` 均**待实测**，不得提前标为已通过。原有 Vitest 615/615 与 E2E 55/55 是合并前基线。

## 2026-11-18 · PR #93 E-052 两处测试文件 Lint 警告最小修复待验收

维护者 Windows 在第三十五批第九小批 Draft PR #93 上实际执行 `vp check --fix`：**0 错误 / 3 警告 / 206 个受检文件**，分别是 `typescript(unbound-method)` 两条（Node 测试夹具直接引用对象方法 `runtime.fetch`）与 `typescript(no-base-to-string)` 一条（浏览器只读守卫使用 `String(input)`）。`--fix` 只完成格式化，**没有**取得零告警验收。

本轮远程最小修复在原 Draft 分支上将夹具 Fetch 定义为箭头函数，保持原引用相等的断言；正式页面注入的 Fetch 守卫改为从字符串、Request.url 或 URL.href 中严格读取地址，无法识别的对象固定中文拒绝、不发送网络请求；既有 12 项离线单测不删减，新增 URL 对象成功读取与未知对象拒绝的内部断言。后续需以 GitHub 最新 HEAD 对齐 Windows 本地工作区，执行 `pnpm run test:release:preflight:oidc:studio:config`、`vp check`、`pnpm run docs:check` 和完整 `pnpm run ready`，再于可信本机 Lab 单独执行真实 `test:release:preflight:oidc:studio:browser`，每条记录退出码。**修复后这些 Windows 测试及真实浏览器专项均尚未执行**；此前 PR #92 的完整 `ready=0` 不代表 PR #93 质量验收。

## 2026-11-18 · PR #93 授权合并与第三十五批第十小批迟到 401 候选

用户 Windows 上传原始日志：`pnpm run test:release:preflight:oidc:studio:config` **12/12**、`vp check` **351/206 零警告和错误**、`docs:check` **86 份**，Vitest **51/51 文件 615/615**、HTTP E2E **6/6 文件 55/55**，React/Vue/Server 类型检查、构建及完整 `pnpm run ready` **退出码 0**。用户另独立真实执行 `test:release:preflight:oidc:studio:browser`，React/Vue 均完成真实 Keycloak 登录、工程载入、GET 预检、未保存画布及模拟 409/401/404 的安全检查，退出码 **0**。未提供本机独立 HEAD，GitHub 合并前 HEAD `f0f09b5fb48fb488a12a01c393c07da33e046358` 与上一版差异仅格式化；维护者明确授权 Squash 合并至 `main@3d1a08ba44b5a3d7a78a90b9dbb2fd515a67f77f`。Windows 日志不能声称严格 SHA 绑定。

第十小批仅修复 React/Vue 预检请求期间编辑后迟到 401/403/404 的父级会话拒绝传播，并扩展既有真实 OIDC 浏览器专项的单次延迟 401 挂起与安全释放；增加 Node 离线第 **13** 项。GitHub 最新文件的页面安全函数及 13 条契约已在隔离 V8 等价测试环境中模拟 **13/13 通过**；**这不是** Windows `node --test`、`vp check`、完整 `ready` 或真实 Keycloak 浏览器验收。新分支 Windows 必须重新执行 `test:release:preflight:oidc:studio:config`、`vp check`、`docs:check`、`ready` 和真实 `test:release:preflight:oidc:studio:browser` 并提供退出码；Vitest **615/615** 与 HTTP E2E **55/55** 为待测预期。没有发布写入/回滚或设备操作。

## 2026-11-18 · PR #94 正式验收与第三十五批第十一小批 ADR-0069 待评审

用户 Windows 附件实际验证 PR #94：`pnpm run test:release:preflight:oidc:studio:config` **13/13、退出码 0**；`vp check` **351 个文件格式正确、206 个受检文件零告警/错误，退出码 0**；`docs:check` **86 份退出码 0**；完整 `pnpm run ready` **退出码 0**，其中 Vitest **615/615**、NestJS HTTP E2E **55/55**、React/Vue/Server 编译与构建均通过。独立真实 Keycloak 双 HTTPS Origin Studio 浏览器专项，React/Vue 均通过编辑期间迟到 401、409/404 与草稿/CAS 保护，退出码 **0**。该日志未附本地独立 HEAD，不能宣称严格 SHA 绑定；维护者明确授权，GitHub PR #94 HEAD `19f86ee6c99632b4c2e1b8ea17c634e083da8855` Squash 合并为 `main@9727acdcf45516661f92a9f094d1158aa2c24651`。E-053 仅属已修正的潜在逻辑问题，不应据此宣称真实生产事故。

第十一小批新增独立 **Proposed** [ADR-0069](adr/0069-release-pointer-atomic-publication-design.md)，讨论独立发布指针、发布代次、只追加事件、事务内权限/快照校验、回滚以及 Runtime 正式发布态读取。文档仅用于安全与架构评审；**没有**可运行的新发布 API、Prisma 迁移或 Runtime 指针消费。新分支 `docs:check`、`vp check`、完整 `ready` **尚未执行**；文档数预计由 **86 增至 87**，仅为待测计数，不是实测。先验证文档状态与相对链接，再按 `docs/HARNESS.md` 运行完整质量链；FR-008 仍为规划中。

## 2026-11-18 · PR #95 已合并与第三十五批第十二小批评审矩阵候选

前批 PR #95 的 Windows 质量链：`docs:check` **87 份，退出码 0**；`vp check` **352 格式文件、206 受检文件零告警/错误，退出码 0**；完整 `pnpm run ready` **退出码 0**，包括 Vitest **615/615**、HTTP E2E **55/55**、OIDC Studio 离线安全 **13/13**、React/Vue/NestJS 类型检查和构建。维护者明确授权，PR #95 GitHub HEAD `d5ceea382b92734b408b41d546b9ba93646e9914` Squash 合并到 `main@0bc70202f8d1cced27edd72d49fb1de05c44c58f`；原始日志没有 `git rev-parse HEAD`，不作 SHA 级严格绑定。文档验收不等于 ADR-0069 被批准，ADR 仍 Proposed。

第十二小批新增 `docs/RELEASE_TRANSACTION_REVIEW.md`，列出八项待维护者正式决定的发布/回滚权限、审批、幂等、回滚范围、Runtime、审计与工业安全选择，以及二十二项**未执行**数据库/HTTP/Runtime 负向测试，供下一阶段准入评审。本次未改生产代码，不宣称发布写事务、权限或真实 PostgreSQL 发布测试已实现。新增一份 Markdown 后预计文档检查 **88 份**，仅为待测试计数。**新分支 Windows `pnpm run docs:check`、`vp check`、`pnpm run ready` 均待实际运行**，此前 615/615 与 55/55 仅是合并前基线。

## 2026-11-19 · PR #97 ADR-0069 Accepted 决策文档同步（Windows 待验收）

维护者已于 2026-11-18 明确批准 ADR-0069 进入 Accepted，并批准 R-01～R-08 推荐基线。PR #97 将 ADR、决策记录、评审矩阵及 PROJECT_CONTEXT 设为 Accepted；本轮复核又发现 ARCHITECTURE、SDD、REQUIREMENTS、CODEBASE_MAP、HARNESS 和 VALIDATION 中仍保留“Proposed/待批准”现状描述，已在 PR #97 分支进行最小文档同步。

本轮仅修改文档，不涉及生产代码、Prisma Schema、数据库迁移、API、Runtime 或设备接口。FR-008 仍为规划中；T-01～T-22 仍是未来验收义务，不是已通过测试。

PR #97 当前分支：`docs/v0.3-b35-release-decision-record`。该分支新增/修改的 Markdown 文档同步完成后，**Windows `pnpm run docs:check` 尚待执行**；预计文件数需以实际命令输出为准。未提供本轮本地 HEAD 与退出码，不得将 PR #99 的 88 份文档检查结果外推为 PR #97 通过。

## 2026-11-18 · PR #99 Prisma Client 生成与测试解构错误修复待复测

维护者 Windows 在 PR #99 分支执行 `vp check --fix`，出现 12 项 TypeScript 错误：旧生成的 Prisma Client 不包含新发布模型 delegate；`project-api.db-spec.ts` 的 `Promise.all` 新增第五项查询但只解构四个变量，导致 `releaseState` 未声明及相邻推断错误。该次只证明格式化完成，代码检查失败。

已在 PR #99 最小修复：

- 补齐 `ScadaProjectVersion.releaseTargetEvents` 与发布事件目标版本关系的反向 Prisma 字段。
- 将工程创建数据库测试解构补齐第五个 `releaseState` 变量。
- 新增 E-054 记录防复发要求：Schema 变更后先 `pnpm run db:validate`、`pnpm run db:generate`，再执行 `vp check`。

**修复后尚未取得 Windows 新结果**。请先在正确分支执行 Schema validate 与 Client generate，再运行 `vp check`；随后执行隔离 PostgreSQL 首次/二次迁移、数据库测试、单元测试和完整 `ready`。旧生成客户端错误不能用类型断言或 `any` 绕过；格式化完成不能视为质量检查通过。参见 `docs/AI_MISTAKES.md` E-054。

## 2026-11-18 · PR #99 发布迁移 P3018、错误目标库与测试 Mock 修复待验收

维护者 Windows 原始日志确认：

- `pnpm run db:validate` 退出码 **0**；Prisma 7.10.1 Schema 有效。
- `pnpm run db:generate` 退出码 **0**；新 Prisma Client 生成成功。
- `vp check` **354 个文件格式正确、207 个受检文件零告警/错误，退出码 0**。
- `pnpm run db:migrate:deploy` 首次失败 **P3018 / SQLSTATE 42601**；随后二次部署 **P3009**，迁移状态显示 `20261118000000_release_state_and_events` 失败。
- **该次迁移目标实际为本机 `127.0.0.1:15432/adui_scada`，不是隔离库 `adui_scada_test`。** 不得把这次操作记录为隔离数据库验收。
- `pnpm run test:db` 因没有显式设置 `SCADA_TEST_DATABASE_URL`，5 个数据库测试文件在加载阶段全部拒绝运行、0 项测试执行；这是既有安全前置按设计工作，不应移除。
- `pnpm run test:unit` **50/51 文件、615/616 项**，唯一失败是 `project-api.store.spec.ts` 的事务 Mock 缺少 `scadaProjectReleaseState.create`；完整 `ready` 同样在该项退出码 **1**。
- `pnpm run docs:check` **88 份 Markdown，退出码 0**。

### 已在 PR #99 修复的代码问题

1. 重建 `20261118000000_release_state_and_events/migration.sql`：完整修复四条 SHA-256 CHECK，移除重复 SQL 片段，将 lifecycle/actor/rollback 约束放回正确 CREATE TABLE；加入显式 `BEGIN/COMMIT`；对首条权限 CHECK 增加存在性保护，以便在确认部分 DDL 后可安全制定恢复步骤。
2. `prisma-schema-comments.spec.ts` 新增迁移静态回归，检查四条完整哈希约束、两张表和事务边界。
3. `project-api.store.spec.ts` 的 `createHarness` 新增发布状态事务 Mock，核对创建工程后先建立 generation=0 未发布状态，再创建三项权限/版本/审计。

### 数据库安全处置

原 `adui_scada` 的失败迁移记录及首条 ALTER 是否已生效尚未通过只读 SQL 核对。**在检查前，不要再次对 `adui_scada` 执行迁移，不要执行 `migrate resolve`、DROP、DELETE 或手工清理 `_prisma_migrations`。** 已在 `docs/HARNESS.md` 增加只读状态查询及显式隔离 URL 的 PowerShell `try/finally` 流程。

修复后的迁移、静态回归、事务 Mock 和文档目前只完成 GitHub 源码静态核对；**尚未在 PostgreSQL 执行，也没有修复后 Windows Vitest/ready 结果**。后续必须先在独立 `adui_scada_test` 执行首次/二次迁移与 `test:db`，另行只读检查原 `adui_scada` 失败状态。详见 `docs/AI_MISTAKES.md` E-055～E-057。
本次修复另在现有 Prisma 注释测试文件增加 1 项迁移完整性静态回归，因此修复后的单元测试验收目标为 **618/618**（原始 615/616 是修复前日志，新增测试后计数同步增加 1）。该目标尚未由 Windows 实际运行确认。

## 2026-11-18 · PR #99 PostgreSQL 只读诊断命令路径修正（E-058）

维护者执行上一版只读检查时，Docker Compose 在读取 `deploy/docker/compose.postgres.dev.yaml` 阶段报文件不存在；**命令没有启动 psql、没有连接 PostgreSQL、没有执行 SQL，也没有修改数据库**。原命令中的 `public.\\_prisma_migrations` 另有多余反斜杠，若执行到 SQL 解析阶段会导致标识符语法错误。

已根据当前仓库真实配置核对并修正 `docs/HARNESS.md`：

- 当前唯一 Compose 文件：`deploy/docker/compose.yaml`。
- 项目名：`adui-scada`。
- PostgreSQL 服务名：`postgres`。
- Compose 环境文件：根 `.env` 与本机 `.local/docker/compose.env`。
- 正确系统表标识符：`public._prisma_migrations`，不带反斜杠。

修正后的 Windows 只读查询仍待维护者执行；原 `adui_scada` 的失败迁移记录、首条权限 CHECK 和发布表状态依旧**未检查**。本次 Compose 路径失败不代表 PostgreSQL 或数据库状态查询失败。详见 `docs/AI_MISTAKES.md` E-058。

## 2026-11-18 · PR #99 开发库失败迁移只读结果与权限约束恢复修复（E-059）

维护者 Windows 使用当前唯一 Compose 文件 `deploy/docker/compose.yaml` 执行只读查询，退出码 **0**。结果确认：

- 当前数据库为 `adui_scada`。
- `20261118000000_release_state_and_events` 迁移记录存在；`started_at=2026-11-18 07:03:15.496457+00`，`finished_at=NULL`、`rolled_back_at=NULL`。
- `scada_project_grants_permission_check` 存在，但定义仍只包含 `project:read`、`version:read`、`version:append`。
- `scada_project_release_events` 与 `scada_project_release_state` 均不存在。

这证明原迁移首条 ALTER 已持久化，后续建表未完成；此前“约束不存在才创建”的恢复保护会错误跳过该旧定义。PR #99 已修正迁移：事务内先 `DROP CONSTRAINT IF EXISTS`，再创建包含五项权限的新 CHECK；并在 `prisma-schema-comments.spec.ts` 新增静态回归，验证先删除后重建、完整权限集合。E-059 已记录该问题。

**尚未执行任何数据库恢复写入**。修复迁移需先在隔离 `adui_scada_test` 完成首次/二次部署、状态检查与 `test:db`；对现有 `adui_scada` 的 `migrate resolve --rolled-back` 和迁移重试，必须等待可恢复备份与维护者明确授权。修复后的 Windows 单测、Vite+、数据库专项与完整 `ready` 仍待执行。

## 2026-11-18 · PR #99 Windows Schema / Vite+ / Vitest 复验通过，PostgreSQL 与 ready 待验收

维护者最新 Windows 原始输出确认：

| 命令                   | 结果                                                      | 退出码 |
| ---------------------- | --------------------------------------------------------- | -----: |
| `pnpm run db:validate` | Prisma Schema valid                                       |      0 |
| `pnpm run db:generate` | Prisma Client 7.10.1 生成成功                             |      0 |
| `vp check`             | 354 个文件格式正确；207 个受检文件零警告、Lint 与类型错误 |      0 |
| `pnpm run test:unit`   | 51/51 文件、618/618 项通过                                |      0 |
| `pnpm run docs:check`  | 88 份 Markdown 通过                                       |      0 |

Vitest 日志明确包含 `apps/server/src/database/prisma-schema-comments.spec.ts` 4 项测试通过、`apps/server/src/projects/project-api.store.spec.ts` 13 项通过，说明迁移哈希/事务静态回归、旧权限约束替换静态回归及工程创建发布状态事务 Mock 均已进入并通过本轮单测。

**本轮未提供 `git rev-parse HEAD`，因此不能把上述 Windows 结果严格绑定到 GitHub 当前 PR #99 HEAD。** 本轮只证明 Schema、生成客户端、静态检查、全量单测和文档检查通过；不能据此声称真实 PostgreSQL 已执行修复迁移。

### 尚待执行

1. 按本文件引用的 `docs/HARNESS.md` PowerShell `try/finally` 流程，将 Prisma CLI 与 DB 测试的环境变量临时指向本机隔离库 `adui_scada_test`。
2. 修复迁移首次部署成功。
3. 同一隔离库二次部署无待执行迁移。
4. `migrate status` 显示最新。
5. `pnpm run test:db` 全部数据库测试通过，且迁移表/字段/索引中文注释、CHECK、FK、初始化状态均符合预期。
6. 执行完整 `pnpm run ready` 并记录最终退出码。

原开发库 `adui_scada` 的失败迁移记录和旧三项权限 CHECK 已由维护者只读确认。**仍未执行 `migrate resolve --rolled-back` 或任何开发库恢复写入**；必须先完成隔离库验收、可恢复备份，并取得维护者明确授权。

## 2026-11-19 · PR #99 隔离数据库迁移状态确认（E-060）

维护者 Windows 已确认：

- `docs:check`：88 份 Markdown 通过，退出码 **0**。
- 本机 Docker PostgreSQL 中存在数据库 `adui_scada_test`，数据库列表查询退出码 **0**。
- 将 `SCADA_DATABASE_URL` 与 `SCADA_TEST_DATABASE_URL` 临时指向该隔离库后，`pnpm run db:migrate:status` 成功连接 `127.0.0.1:15432/adui_scada_test`。
- Prisma 报告 5 条迁移已发现，唯一待执行迁移为 `20261118000000_release_state_and_events`；输出未报告 failed migration / P3009。
- 当前 Prisma CLI 对该 pending 状态返回退出码 **1**，PowerShell 包装因此提前停止；`finally` 已恢复原环境变量。本次没有执行任何迁移写入。

**判断**：这是预期的部署前状态，不是数据库故障。不得只按 status 退出码判断；必须结合输出区分 pending migration 与 failed migration。修复后的迁移可进入隔离库首次部署；部署成功后再进行第二次部署、status 和 `test:db`。

本轮更新 `docs/HARNESS.md` 与 E-060，明确当前 Prisma 7.10.1 对 pending 状态的实际退出码语义。**首次/二次部署、部署后 status、真实 `test:db` 和完整 `ready` 均仍待 Windows 执行。**

## 2026-11-19 · PR #99 隔离 PostgreSQL 迁移通过，DB 测试发现发布状态清理外键问题

维护者 Windows 最新日志确认，所有数据库命令均在本机隔离库 `adui_scada_test`（`127.0.0.1:15432`）执行：

| 验收项                     | 实际结果                                           | 退出码 |
| -------------------------- | -------------------------------------------------- | -----: |
| 首次 `db:migrate:deploy`   | 成功应用 `20261118000000_release_state_and_events` |      0 |
| 二次 `db:migrate:deploy`   | No pending migrations to apply                     |      0 |
| 部署后 `db:migrate:status` | Database schema is up to date                      |      0 |
| `test:db`                  | 4/5 文件、30/41 项通过；1 文件 11 项失败           |      1 |

11 项失败全部集中在 `projects-cas-cookie-http.db-spec.ts` 的 finally 清理。Prisma 报 `scada_project_release_state_project_fkey` RESTRICT：新建工程会同时创建发布状态行，旧测试清理没有先删除该状态便删除工程。日志中的“数据库工程版本元数据与快照不一致”来自主动篡改快照摘要的最后一个安全测试；该测试期望 HTTP 500 并验证内部错误不会泄漏，不是 11 项失败的共同根因。

### 已在 PR #99 修复

- 双 Cookie HTTP DB 测试：先删发布状态，再删发布事件、审计、版本、授权、工程。
- 工程版本 DB 测试：补齐发布状态/事件清理。
- 工程 API DB 测试：将原先先删事件、后删状态调整为状态优先，符合状态对最后事件的外键方向。
- `docs/HARNESS.md` 增加带 RESTRICT 外键的测试夹具清理顺序。
- `docs/AI_MISTAKES.md` 新增 E-061。

本次仅修改测试清理逻辑与文档；没有放宽/删除生产外键，没有修改迁移 SQL，没有执行数据库清理写入。**修复后的 `test:db`、最新文档 `docs:check` 和完整 `ready` 仍待 Windows 复验。**

## 2026-11-19 · PR #99 正式发布 Schema 隔离 PostgreSQL 与完整质量链验收通过

维护者最新 Windows 日志确认：修复后的三处 PostgreSQL 测试清理逻辑已在真实隔离库验证通过。

### 隔离 PostgreSQL 专项（独立于 `ready` 执行）

| 验收项                   | 实际结果                                         | 退出码 |
| ------------------------ | ------------------------------------------------ | -----: |
| 首次 `db:migrate:deploy` | 已应用 `20261118000000_release_state_and_events` |      0 |
| 二次 `db:migrate:deploy` | No pending migrations to apply                   |      0 |
| `db:migrate:status`      | Database schema is up to date                    |      0 |
| `test:db`                | 5/5 文件、41/41 项通过                           |      0 |

`projects-cas-cookie-http.db-spec.ts` 11/11、`prisma-project-version.db-spec.ts` 12/12、`project-api.db-spec.ts` 7/7、`oidc-schema.db-spec.ts` 6/6、`release-schema.db-spec.ts` 5/5 全部通过。日志中的“数据库工程版本元数据与快照不一致”是最后一个测试主动篡改摘要时产生的预期服务端异常；该测试本身通过，不是测试失败。

### 完整 `pnpm run ready`

| 验收项                                            | 实际结果                                              |
| ------------------------------------------------- | ----------------------------------------------------- |
| 依赖目录                                          | 12 个清单、52 项 Catalog 依赖通过                     |
| 共享配置 / 环境 / LF                              | 10 个 TSConfig 消费端通过；根环境和换行检查通过       |
| 中文文案                                          | 231 个自有代码或配置文件检查通过                      |
| Vite+                                             | 354 文件格式正确；207 受检文件零警告、Lint 和类型错误 |
| 单元测试                                          | 51/51 文件、618/618 项通过                            |
| React / Vue / draft-storage / API Client 类型检查 | 全部通过                                              |
| Server 类型检查                                   | 通过                                                  |
| SSE 客户端 / TCP 故障单测                         | 8/8、4/4 通过                                         |
| OIDC、Docker、浏览器配置安全门禁                  | `ready` 中各脚本均执行成功                            |
| HTTP E2E                                          | 6/6 文件、55/55 项通过                                |
| 文档检查                                          | 88 份 Markdown 通过                                   |
| React / Vue 构建                                  | 均成功                                                |
| NestJS Server 构建                                | 成功                                                  |

维护者最终输出：`pnpm run ready` **退出码 0**。`test:db` 是单独执行的隔离 PostgreSQL 专项，并不包含在 `ready` 脚本内；两者分别通过。

### 验证边界与后续

- 维护者上传的 Windows 日志没有包含 `git rev-parse HEAD`，因此本记录不声称所有上述执行结果严格绑定到 GitHub 当前分支 SHA；PR 分支后续文档提交还需重跑 `docs:check`。
- 原开发库 `adui_scada` 的历史失败迁移记录仍未恢复；隔离库通过不代表开发库已完成迁移。对原库执行 `migrate resolve --rolled-back` 与迁移重试仍须可恢复备份及维护者明确授权。
- 正式发布 API、回滚 API、Runtime 发布指针切换、CAS/幂等业务逻辑、双人审批和任何工业设备写入均未在本批开放。
- PR #99 继续保持 Draft，Assignee 为 `@adui-dev`；PR #97 已完成 Accepted 决策文档验收并合并至 `main`，PR #99 后续评审以前置决策已进入主线为准。

## 2026-11-19 · PR #97 合并与 PR #99 分支同步

PR #97 已完成维护者 Windows 文档验收后 Squash 合并至 `main`，合并提交为 `8a622f8766856069065ee7d5cbadeb826646e676`。该提交正式将 ADR-0069 Accepted 决策、R-01～R-08 批准基线及对应文档同步纳入主线。

PR #99 已从原功能分支 `c38de5ca38cc619a1128a84b63eca3523f42c9d7` 合流最新 `main`。本次只合并 PR #97 的十份文档变更；PR #99 原有 Prisma Schema、迁移 SQL、权限实现和测试源码保持不变。该同步不执行任何数据库命令，也不触碰原开发库 `adui_scada`。

PR #97 的 Windows `docs:check` 为 89 份 Markdown、退出码 0；该终端记录没有同时提供本地 HEAD，因此不声称其结果严格绑定到 PR #99 同步后的 HEAD。PR #99 同步后仍须在 Windows 最新 HEAD 执行 `vp check` 与 `pnpm run docs:check`；此前 618/618 单测、41/41 隔离 PostgreSQL 测试、55/55 HTTP E2E 和完整 `ready=0` 对应的代码未被本次文档合流修改，但本次同步本身不构成重新执行这些测试的证据。

PR #99 继续保持 Open / Draft，Assignee 为 `@adui-dev`。原开发库 `adui_scada` 的失败迁移仍冻结；恢复操作必须等待可恢复备份和维护者单独明确授权。

## 2026-11-19 · PR #99 发布状态复合外键完整性修复（E-062，隔离 PostgreSQL 验收通过）

静态评审发现原发布 Schema 中，状态表的 last_release_event_id 只引用全局事件 UUID；没有同时约束租户、工程、发布代次、目标修订和 SHA-256。状态及发布事件对历史版本的外键也只绑定修订号，不能由数据库保证摘要与不可变快照一致。该问题在发布 API 尚未实现时发现，不是已发生的跨工程写入事故。

PR #99 已新增不可变增量迁移 20261119000000_release_state_event_integrity，不修改已经在隔离库应用的 20261118000000_release_state_and_events。新迁移增加：

- 工程版本 tenant_id/project_id/revision/content_hash 复合唯一键。
- 发布事件来源与目标版本的复合外键，确保 SHA-256 与实际版本一致。
- 发布状态目标版本复合外键，确保指针摘要与不可变快照一致。
- 发布状态末次事件复合外键，确保租户、工程、代次、目标修订、摘要与事件 UUID 完全一致。
- 上述复合外键所需索引及中文数据库索引注释。

新增 prisma-schema-comments.spec.ts 静态回归和 release-schema.db-spec.ts 真实 PostgreSQL 负向用例，覆盖跨工程事件引用、错误代次、错误状态摘要、错误事件目标摘要拒绝及正确关联成功。测试清理遵循发布状态、发布事件、历史版本、工程的外键依赖顺序。

**维护者 Windows 实测结果**：

| 验收项              |                                                实际结果 | 退出码 |
| ------------------- | ------------------------------------------------------: | -----: |
| 第二条迁移首次部署  | 成功应用 `20261119000000_release_state_event_integrity` |      0 |
| 第二条迁移二次部署  |                                            无待执行迁移 |      0 |
| `db:migrate:status` |                           Database schema is up to date |      0 |
| `test:db`           |                                      5/5 文件、42/42 项 |      0 |

发布 Schema DB 测试 6/6，真实 PostgreSQL 已拒绝跨工程事件引用、错误代次、错误状态摘要和错误事件目标摘要，并接受合法关联。原开发库 `adui_scada` 未执行迁移恢复或其他写操作。

## 2026-11-19 · PR #99 Prisma Schema 关联属性 P1012 修复（E-063，已修复并通过后续验收）

维护者 Windows 在最新候选执行 `pnpm run db:validate`，Prisma 7.10.1 对 `releasedVersion`、`lastReleaseEvent`、`fromVersion`、`toVersion` 四个字段级关系报 P1012（28 条解析错误）。原因是 `@relation(...)` 参数被拆成多行；Prisma Schema 字段级属性需要保持单行。`db:generate` 同样失败；`test:unit` 在 Vitest 启动前调用 `db:generate`，因此没有执行任何 Vitest 用例。

PR #99 已将四个 `@relation(...)` 属性恢复为单行，并在 `prisma-schema-comments.spec.ts` 新增静态回归，确保每个关系属性都在同一字段行闭合。维护者随后在 HEAD `e02e48e4ae46fb0e02ab6ee3ab3b21872d58134f` 重新执行 `db:validate`，原 28 条解析错误已消失，但继续暴露 `lastReleaseEvent` 一对一关系的复合唯一约束问题；该独立问题已记录为 E-064。未修改已应用迁移、第二条增量迁移 SQL、数据库或权限业务逻辑。

维护者在 E-063 修复后的后续 Windows 检查结果：

- `vp check`：355 个文件格式正确；207 个受检文件零警告、Lint 与类型错误。
- `docs:check`：89 个 Markdown 文件通过。
- `db:validate`、`db:generate`：原字段多行解析错误已消失，但随后因 `lastReleaseEvent` 一对一复合字段不唯一而返回 P1012，退出码 1。
- `test:unit`：在 db:generate 阶段因同一 P1012 失败，Vitest 未启动，不能计作单测失败项或通过项。
- 本轮没有执行 `db:migrate:deploy`、`test:db` 或完整 `ready`，没有数据库写入证据。

**修复后待维护者 Windows 执行**：

| 验收项                    |                               目标 |
| ------------------------- | ---------------------------------: |
| `pnpm run db:validate`    |                           退出码 0 |
| `pnpm run db:generate`    |                           退出码 0 |
| `vp check`                |                     零警告、零错误 |
| `pnpm run test:unit`      |                            620/620 |
| 隔离 PostgreSQL `test:db` |                              42/42 |
| `pnpm run docs:check`     | 89 份 Markdown，实际计数以命令为准 |
| 完整 `pnpm run ready`     |                           退出码 0 |

数据库迁移专项仍须使用 `docs/HARNESS.md` 中的 PowerShell `try/finally` 环境变量保护流程，仅连接本机隔离 `adui_scada_test`。原开发库 `adui_scada` 的失败迁移保持冻结，不执行 resolve、deploy、reset、DROP、DELETE 或手工修改 `_prisma_migrations`。

## 2026-11-19 · PR #99 Prisma 一对一发布事件关系 P1012 修复（E-064，已修复并通过后续验收）

维护者在 HEAD `e02e48e4ae46fb0e02ab6ee3ab3b21872d58134f` 的 Windows 检查中，E-063 的字段多行解析错误已消失；Prisma 7.10.1 继续报告 `lastReleaseEvent` 一对一关系 defining side 的六个字段不具备唯一约束。`db:generate` 同样失败，`test:unit` 在 Vitest 启动前因 Client 生成失败而中止。`vp check` 355 个文件格式正确、207 个受检文件零警告/错误；`docs:check` 89 份通过。

根因是原关系将三个可空发布指针字段纳入复合关系，而 Prisma `@@unique` 要求组合字段全部必填。不能把“未发布”状态字段改为必填，也不能通过改成一对多弱化业务关系。

PR #99 已将 Prisma ORM 一对一导航关系改为使用已有全局唯一 `lastReleaseEventId -> eventId`；`lastReleaseEventId` 仍可空且保留 `@unique`。第二条迁移中的六字段 PostgreSQL 复合外键保持不变，仍强制校验租户、工程、代次、目标修订、摘要和事件 UUID。无需新增迁移或额外唯一索引。

静态回归已同步断言：Prisma 关系只使用唯一事件 ID，而 SQL 仍包含完整六字段复合外键。此次未修改任何迁移 SQL 或数据库。

**结案验证（后续维护者 Windows 实测）**：

- Prisma Client 7.10.1 生成成功，说明 E-064 修复后的 Prisma Schema 已被 Prisma 解析。
- `pnpm run test:unit`：51/51 文件、620/620 项通过，退出码 0。
- `vp check`：355 文件格式正确、207 受检文件零警告/Lint/类型错误，退出码 0。
- `pnpm run ready`：最终退出码 0。
- 第二条增量迁移部署后，隔离 PostgreSQL `test:db`：5/5 文件、42/42 项通过，退出码 0。

本案例已关闭。原开发库 `adui_scada` 的失败迁移保持冻结，不执行 resolve、deploy、reset、DROP、DELETE 或手工修改 `_prisma_migrations`。

## 2026-11-19 · PR #99 发布复合外键静态断言误报修复（E-065，Windows 与隔离 PostgreSQL 验收通过）

维护者新一轮 Windows 测试确认：`db:validate` 退出码 **0**，`db:generate` 退出码 **0**，Prisma Client 7.10.1 正常生成；`vp check` 为 355 个格式文件和 207 个受检文件零警告错误，退出码 **0**；`docs:check` 89 份 Markdown 通过，退出码 **0**。

`test:unit` 已实际执行 Vitest，共 **51 个测试文件（50 通过、1 失败），619/620 项通过，退出码 1**。唯一失败处位于 `prisma-schema-comments.spec.ts:119`：对六字段末次发布事件外键和其引用表使用了单行字符串查找，而迁移 SQL 实际将列名逐行排版。测试中该六字段 `FOREIGN KEY` 断言还重复出现。错误属于静态断言的空白格式依赖；不能据此推断真实 PostgreSQL 外键失败，也没有运行新迁移或数据库专项的证据。

本次仅修改上述静态用例：精确检查 `ADD CONSTRAINT scada_project_release_state_last_event_fkey`、外键侧六字段、被引用事件表的六字段及 `ON DELETE RESTRICT ON UPDATE CASCADE` 的连续组合，只忽略 SQL 排版空白，不改变字段名、顺序或完整性门禁。移除重复断言。没有改动已应用的迁移 SQL、Schema、数据库或发布业务写入。

维护者随后提供 Windows 最新质量链结果：`pnpm run test:unit` **51/51 文件、620/620 项通过**，退出码 0；`vp check` 355 个文件格式正确、207 个受检文件零警告/Lint/类型错误，退出码 0；`docs:check` 89 个 Markdown 通过，退出码 0；完整 `pnpm run ready` 覆盖依赖目录、共享配置、环境、中文文案、Prisma Client 生成、Web/Server 类型检查、单元测试、SSE/OIDC/Docker 配置专项、HTTP E2E **6/6 文件、55/55 项**、文档检查，以及 React、Vue、NestJS 构建，最终退出码 **0**。Prisma Client 7.10.1 在单测与 ready 中均成功生成。

**后续真实 PostgreSQL 验收现已完成**：维护者在本机隔离 `127.0.0.1:15432/adui_scada_test` 首次应用 `20261119000000_release_state_event_integrity`，退出码 0；二次部署 `No pending migrations to apply`，退出码 0；`db:migrate:status` 为 up to date，退出码 0；`pnpm run test:db` 为 **5/5 文件、42/42 项通过**，退出码 0。发布 Schema 文件 6/6，其中四类非法复合引用均被真实 PostgreSQL 拒绝，合法关联成功。此前 41/41 是第一条迁移验收，42/42 是新增第二条迁移后的最终结果。

**验证边界**：维护者提供的本轮终端日志未包含 `git rev-parse HEAD`，故上述 Windows 结果只能记录为本轮实际日志，不能严格绑定到当前 GitHub SHA `1296814729a6ba0ae8f7d1d9a6c01bcce3c53f79`。本次文档同步后还需重新执行 `docs:check`。原开发库 `adui_scada` 失败迁移继续冻结，未经可恢复备份与维护者明确授权不得执行恢复写入。

## 2026-11-19 · PR #99 E-065 修复后的完整工程质量链与真实 PostgreSQL 验收通过

维护者提供的 Windows 日志显示：

- `pnpm run test:unit`：51/51 文件、620/620 项通过，退出码 0；其中 Prisma Schema 注释与复合外键静态回归 6/6 通过。
- `vp check`：355 个文件格式正确，207 个受检文件零警告、Lint 和类型错误，退出码 0。
- `pnpm run docs:check`：89 个 Markdown 文件通过，退出码 0。
- 完整 `pnpm run ready`：退出码 0；依赖目录 12 清单/52 项 Catalog、共享配置、根环境与 LF、231 个文件中文文案检查、Prisma Client 7.10.1 生成、React/Vue/Draft Storage/API Client 类型检查、Server 类型检查、620/620 单测、SSE 客户端 8/8、TCP 故障代理 4/4、OIDC/Docker/浏览器专项配置、NestJS HTTP E2E 6/6 文件/55/55 项、89 份文档及 React/Vue/NestJS 构建全部执行完成。

本次日志没有给出 `git rev-parse HEAD`，不得把这组实测结果声称为严格绑定到当前远端 SHA。此前单独 `db:validate` 退出码 0、`db:generate` 退出码 0 的日志已证明 Prisma Schema 语义校验通过；本轮 `test:unit` 和 `ready` 又实际成功运行 Prisma Client 生成。

**第三十五批 B 阶段当前验收结论**：工程质量链与第二条迁移的真实 PostgreSQL 专项均已通过。完整 `ready` 不包含 `db:migrate:deploy` 或 `test:db`，因此本次分别执行并记录，不能把两类验收互相替代。第二条迁移首次/二次部署、status 和 42/42 数据库测试的具体结果见本节上方 E-062/E-065 记录。

维护者本轮 Windows 日志没有附 `git rev-parse HEAD`。当前 GitHub PR 分支在本次文档更新前的 HEAD 为 `d217dde085a5654d8dfe4cc01ef3756ab338466e`；该提交只调整三份文档的格式，没有改动本批代码或迁移。不能将日志未提供的本地 SHA 伪写为已核验。原开发库 `adui_scada` 的失败迁移仍冻结，不执行 `migrate resolve`、`migrate deploy`、reset、DROP、DELETE 或手工编辑 `_prisma_migrations`；恢复仍须可恢复备份和维护者单独明确授权。

## 2026-11-19 · 第三十五批 B 阶段最终验收汇总

维护者 Windows 已提供以下实际结果：

| 检查               |                                                                                                                                 结果 | 退出码 |
| ------------------ | -----------------------------------------------------------------------------------------------------------------------------------: | -----: |
| `docs:check`       |                                                                                                                       89 份 Markdown |      0 |
| `test:unit`        |                                                                                                               51/51 文件、620/620 项 |      0 |
| `vp check`         |                                                                                   355 文件格式正确、207 受检文件零警告/Lint/类型错误 |      0 |
| 完整 `ready`       | 依赖、配置、环境、中文文案、Prisma Client、类型检查、单测、SSE/OIDC/Docker/浏览器专项、HTTP E2E 55/55、React/Vue/NestJS 构建全部完成 |      0 |
| 第二条迁移首次部署 |                                                      `20261119000000_release_state_event_integrity` 成功应用到隔离 `adui_scada_test` |      0 |
| 第二条迁移二次部署 |                                                                                                                         无待执行迁移 |      0 |
| 迁移状态           |                                                                                                        Database schema is up to date |      0 |
| `test:db`          |                                                                                                                   5/5 文件、42/42 项 |      0 |

真实 PostgreSQL 发布 Schema 用例 6/6，覆盖两张发布表和中文注释、约束与索引、generation=0 初始状态，以及跨工程事件引用、代次不匹配、状态摘要不匹配、事件目标摘要不匹配拒绝和合法引用成功。日志中“数据库工程版本元数据与快照不一致”的 TypeError 是主动篡改随机测试租户摘要的预期负向 HTTP 500，相关测试通过，不构成失败。

**提交绑定说明**：维护者日志没有包含 `git rev-parse HEAD`。本次执行时 GitHub 远端分支已存在仅调整文档格式的提交 `d217dde085a5654d8dfe4cc01ef3756ab338466e`（父提交 `f725bbb21df5fc3861782d3ca206abdd2916ef4f`）；该提交没有修改业务代码、Prisma Schema 或迁移 SQL。测试结果按维护者提供的真实日志记录，不虚构本地 SHA。

原开发库 `adui_scada` 的历史失败迁移继续冻结；本轮所有迁移和真实数据库测试均限定在本机隔离 `adui_scada_test`，没有获得或执行原开发库恢复授权。

## 2026-11-19 · 第三十五批 C1 Mock 警告修复候选（E-066，待 Windows 复验）

维护者 Windows 的首次 `vp check --fix` 在 `prisma-project-release-store.spec.ts` 报告 8 条警告、0 个错误。候选提交 `6bc35e269b4f7c6099fa1c8da9933263cad3f0a5` 已为 7 个 Mock 增加显式函数签名，并将安全门禁调用 Mock 独立为 `gateAssertReady`，避免 unbound-method。

GitHub 回读静态核对确认该文件不再包含无泛型参数的 `vi.fn()`，也不再直接引用 `harness.gate.assertReady`。这只是源码静态核对，**不是 Windows Lint 或测试通过记录**。修复后的 `vp check`、发布仓储单测、全量 `pnpm run test:unit`、`pnpm run docs:check` 与完整 `pnpm run ready` 均待维护者实测。未提供的命令退出码不得推断。

## 2026-11-19 · 第三十五批 C1 请求校验测试断言修复候选（E-067，待 Windows 复验）

维护者 Windows 最新日志：`vp check` 359 个文件格式正确、211 个受检文件零警告/错误（退出码 0）；`test:unit` 51/52 文件、632/633 项通过，唯一失败是发布仓储输入校验测试将目标修订不匹配的专属错误误判为失败；`docs:check` 89 个 Markdown 通过（退出码 0）。

候选修复只调整 `prisma-project-release-store.spec.ts`：七类非法输入分别声明预期错误正则，覆盖请求字段白名单、目标修订必须等于预期 head、UUID v4 幂等键格式。生产校验、异常文案和事务逻辑均不修改。**修复后 Windows 定向测试、全量单测、vp check、docs:check 和完整 ready 尚待执行**；当前不能宣称 C1 单测通过。

## 2026-11-19 · 第三十五批 C1 发布事务单元阶段验收通过（E-066/E-067 关闭）

维护者 Windows 在修复最新候选代码后提供以下实际结果：

| 验证项                | 实际结果                                                                                        | 退出码 |
| --------------------- | ----------------------------------------------------------------------------------------------- | -----: |
| 发布事务定向测试      | `vp test run apps/server/src/projects/prisma-project-release-store.spec.ts`，1/1 文件、13/13 项 |      0 |
| `vp check`            | 359 个文件格式正确；211 个受检文件零警告、Lint、TypeScript 错误                                 |      0 |
| Prisma Client         | Prisma 7.10.1 生成成功                                                                          |      0 |
| `pnpm run test:unit`  | 52/52 文件、633/633 项                                                                          |      0 |
| `pnpm run docs:check` | 89 个 Markdown 文件                                                                             |      0 |

E-066（7 个 Mock 类型参数和 1 个 unbound-method 警告）与 E-067（目标修订不匹配用例的宽泛错误断言）均已关闭。生产请求校验逻辑没有因测试修复而放宽。

**提交绑定边界**：维护者日志没有提供本地 `git rev-parse HEAD`。GitHub PR #100 当前候选分支 HEAD 为 `7c619941f486b639298e4015d6538b995919d8c5`；本节只记录维护者实际提供的 Windows 结果，不声称这些日志已严格绑定到该 SHA。

**仍待执行的 C1 验收**：

- `pnpm run test:e2e:server`（完整 `ready` 中会执行）。
- 按 `docs/HARNESS.md` 的 PowerShell `try/finally` 隔离环境流程执行 `pnpm run test:db`，目标仅限本机 `adui_scada_test`。
- `pnpm run ready`，覆盖配置、环境、中文文案、双框架/Server 类型检查、HTTP E2E、文档和构建。

C1 不新增 Prisma 迁移。`test:db` 必须使用本机隔离库；原开发库 `adui_scada` 的历史失败迁移继续冻结，不执行恢复写入。当前生产 `ProjectReleaseSafetyGate` 仍默认 fail-closed，不能把单元测试中的测试门禁替身视为生产放行。

## 2026-11-19 · 第三十五批 C1 PostgreSQL 首次执行被环境变量保护阻断（E-068，待复验）

维护者 Windows 日志确认：

| 验证项             | 实际结果                                                                         |                               退出码 |
| ------------------ | -------------------------------------------------------------------------------- | -----------------------------------: |
| `docs:check`       | 89 个 Markdown 文件通过                                                          |                                    0 |
| `vp check`         | 359 个文件格式正确；211 个受检文件零警告/Lint/TypeScript 错误                    |                                    0 |
| Core 构建          | 通过                                                                             | 0（由 test:db 前置脚本继续执行确认） |
| Prisma Client      | 7.10.1 生成成功                                                                  |                                    0 |
| `pnpm run test:db` | 6 个 Suite 在模块加载阶段因缺少 `SCADA_TEST_DATABASE_URL` 退出；0 个测试用例执行 |                                    1 |

**原因与安全结论**：当前 PowerShell 进程未设置 `SCADA_TEST_DATABASE_URL`。六个 DB spec 的导入前置检查按设计拒绝运行；没有证据显示测试连接 PostgreSQL 或执行数据库写入。这不是事务、迁移、约束或并发测试失败。不得删除环境变量保护或把测试 URL 改为开发库/生产库。

**修复方式**：`docs/HARNESS.md` 新增 C1 专用 PowerShell `try/finally` 包装，自动从根 `.env` 推导本机 `adui_scada_test`，在当前进程同时设置两个数据库 URL，运行 `pnpm run test:db` 后恢复原环境变量。C1 不新增迁移，因此该重跑步骤不执行迁移部署。

**待执行**：维护者按 `docs/HARNESS.md` 新增的完整脚本重跑 `pnpm run test:db`。文档更新后还须重新执行 `pnpm run docs:check` 与 `vp check`；本节记录的 89 份/359 文件结果来自本次文档更新之前的 Windows 日志，不能冒充更新后的检查结果。原开发库 `adui_scada` 的失败迁移继续冻结。

## 2026-11-19 · 第三十五批 C1 PostgreSQL 双 Cookie 测试模块依赖修复（E-069，待复验）

维护者 Windows 在正确设置隔离 PostgreSQL 环境后执行服务端数据库专项，Core Node 构建与 Prisma Client 7.10.1 生成成功。实际结果：

| 数据库测试文件                        |                            结果 |
| ------------------------------------- | ------------------------------: |
| `oidc-schema.db-spec.ts`              |                             6/6 |
| `prisma-project-version.db-spec.ts`   |                           12/12 |
| `project-api.db-spec.ts`              |                             7/7 |
| `projects-cas-cookie-http.db-spec.ts` | 测试模块初始化失败，11 项未执行 |
| `release-schema.db-spec.ts`           |                             6/6 |
| `release-transaction.db-spec.ts`      |                           10/10 |

Vitest 汇总：5/6 文件通过，41 项通过、11 项 skipped，1 个 Suite 初始化失败，命令退出码 1。失败原因为 `ProjectApiController` 构造函数新增的 `PrismaProjectReleaseStore` 未注册到双 Cookie 数据库测试的手工 NestJS TestingModule；其依赖 `ProjectReleaseSafetyGate` 也缺失。该错误发生在测试模块编译阶段，不是 11 项断言失败，也不能据此判定发布事务或 PostgreSQL Schema 有缺陷。

**最小修复**：PR #100 提交 `055e2115174fba27cc745f2277e251b94ab4eb74` 仅为 `projects-cas-cookie-http.db-spec.ts` 增加 `PrismaProjectReleaseStore` 和 `ProjectReleaseSafetyGate` 的导入及 Provider 注册，继续复用现有真实 PrismaService 与默认 fail-closed 安全门禁。未修改生产代码、数据库 Schema、迁移或测试断言。

**待维护者复验**：先运行双 Cookie 定向数据库测试，再完整运行 `pnpm run test:db`；通过后执行 `vp check` 和完整 `pnpm run ready`。当前尚无修复后的 Windows 实测结果，不得将本次 5/6、41 passed 记录为修复已通过。

## 2026-11-19 · 第三十五批 C1 最终验收与 PR #100 合并（E-068 / E-069 结案）

维护者 Windows 在 PR #100 最终验收 HEAD `f576cacaadd2376f8e75d5270482ac9a356f81ed` 完成完整质量链。此前 E-068 的隔离 URL 缺失问题通过 `docs/HARNESS.md` 的 PowerShell `try/finally` 包装解决；E-069 的双 Cookie 测试 NestJS Provider 遗漏通过最小测试夹具修改解决。

| 验收项目                           |                                                    最终结果 |              退出码 |
| ---------------------------------- | ----------------------------------------------------------: | ------------------: |
| PostgreSQL 专项                    |                                        6/6 文件、52/52 用例 |                   0 |
| 双 Cookie HTTP CAS                 |                                                       11/11 | 0（包含于 test:db） |
| 正式发布事务 PostgreSQL            |                                                       10/10 | 0（包含于 test:db） |
| 发布 Schema 完整性                 |                                                         6/6 | 0（包含于 test:db） |
| `vp check`                         | 359 文件格式正确；211 个受检文件零警告/Lint/TypeScript 错误 |                   0 |
| `docs:check`                       |                                         89 个 Markdown 文件 |                   0 |
| 单元测试                           |                                    52/52 文件、633/633 用例 |                   0 |
| SSE 客户端 / 故障代理              |                                                    8/8、4/4 |                   0 |
| OIDC / Docker / 浏览器配置安全专项 |                                                    全部通过 |                   0 |
| NestJS HTTP E2E                    |                                        6/6 文件、59/59 用例 |                   0 |
| React / Vue / NestJS 构建          |                                                      均成功 |                   0 |
| 完整 `pnpm run ready`              |                                                    全链完成 |               **0** |

数据库日志中的“数据库工程版本元数据与快照不一致”来自随机测试租户主动篡改摘要的预期负向用例；对应 HTTP 测试通过，不是 Suite 失败。

**合并记录**：PR #100 已按维护者明确授权 Squash 合并至 `main`，合并提交为 `8db55e4b1bb97d69c08dc9238eb61f76071b7e72`。PR Assignee 为 `@adui-dev`。测试结果对应合并前 HEAD `f576cacaadd2376f8e75d5270482ac9a356f81ed`。

E-068 与 E-069 均已关闭。C1 交付的是服务端发布事务及其默认 fail-closed 安全门禁；生产 `ProjectReleaseSafetyGate` 仍返回 503。Runtime 发布态读取、回滚事务、运行时读取授权、双人审批和生产安全评审仍未完成；不授予任何 PLC/DCS 或其他设备写入权限。原开发库 `adui_scada` 的历史失败迁移继续冻结，未执行恢复写入。

## 2026-11-19 · 第三十五批 D1 服务端只读发布读取候选（待维护者验收）

候选分支 `codex/b35-d1-release-read-runtime` 新增独立 `release:read` ACL、`GET /api/v1/projects/:projectId/releases/current` 和权限 CHECK 增量迁移 `20261119180000_release_read_permission`。本轮没有修改 React/Vue、SSE、生产发布安全门禁或设备接口。

**新增自动化覆盖（尚未执行）**：

- 权限单测：工程读取、历史版本读取和发布写权限均不能继承 `release:read`。
- 发布仓储单测：未发布状态不读取 head/快照；已发布读取核对不可变快照 SHA-256、数据库元数据及最后发布事件。
- HTTP E2E：独立 ACL、可信会话、未发布状态和 no-store。
- 隔离 PostgreSQL：权限 CHECK 接受 `release:read`；未授权拒绝、显式授权读取、仅 release:read 访问、跨租户相同工程 ID 隔离及快照正文篡改拒绝。
- 迁移必须在本机隔离 `adui_scada_test` 首次/重复部署并核对状态；原开发库 `adui_scada` 的历史失败迁移继续冻结，禁止将本迁移应用到生产库。

**尚未实测**：本候选尚未执行 TypeScript/Lint、单测、NestJS HTTP E2E、隔离 PostgreSQL 迁移/测试、文档检查或完整质量链。不得把源码静态核对当作测试通过。

维护者验收顺序：在根目录确认工作区和分支后，先用 `docs/HARNESS.md` 的隔离数据库 PowerShell `try/finally` 模板将当前进程的 `SCADA_DATABASE_URL` 与 `SCADA_TEST_DATABASE_URL` 限定到本机 `adui_scada_test`；执行 `pnpm run db:migrate:deploy`、`pnpm run db:migrate:status`、`pnpm run test:db`。随后执行 `vp check`、`pnpm run test:unit`、`pnpm run test:e2e:server`、`pnpm run docs:check`、`pnpm run typecheck:server` 和 `pnpm run build:server`；最后可执行完整 `pnpm run ready`。每条命令记录独立退出码。

## 2026-11-20 · 第三十五批 D1 隔离 PostgreSQL 迁移与真实数据库专项验收通过

维护者 Windows 在仓库根目录按限定本机隔离数据库的 PowerShell `try/finally` 流程执行；Prisma 明确报告目标是 `127.0.0.1:15432/adui_scada_test`，脚本结束时输出「数据库环境变量已恢复」。对应测试日志：

- 首次 `pnpm run db:migrate:deploy`：识别 **7 条迁移**，成功应用 `20261119180000_release_read_permission`。
- 第二次 `pnpm run db:migrate:deploy`：仍识别 7 条迁移，提示 `No pending migrations to apply`。
- `pnpm run db:migrate:status`：`Database schema is up to date!`。
- `pnpm run test:db`：**6/6 个测试文件、57/57 项测试通过**；其中 `release-transaction.db-spec.ts` **15/15**，包含 D1 新增的独立 `release:read` 授权、未发布状态、仅发布读取权限、同名跨租户工程隔离和快照正文篡改拒绝；`release-schema.db-spec.ts` **6/6**。完整流程输出「D1 PostgreSQL 专项验收通过」。

两条 NestJS `ExceptionsHandler` 错误堆栈分别是主动篡改随机测试租户中工程版本元数据和已发布快照摘要的预期负向测试；对应 Suite 全部通过。不能为了隐藏错误日志降低完整性校验或跳过负向测试。

**前次误操作及保护边界**：维护者此前未设置隔离环境而直接运行迁移命令，Prisma 指向已冻结的 `adui_scada` 并返回 P3009；随后 `test:db` 因缺少 `SCADA_TEST_DATABASE_URL`，6 个 Suite 在导入阶段拒绝、0 测试执行。这些失败命令不属于本次通过的隔离数据库验收；原 `adui_scada` 开发库仍冻结，不得执行迁移修复、重置、修改历史表或生产操作。

**后续质量门禁**：此前另一次维护者日志已有 `vp check` 359/211 零告警、单测 633/633、HTTP E2E 59/59、文档 89 份通过，但该日志未提供 `git rev-parse HEAD`，不能严格绑定 D1 远程最新提交。GitHub D1 PR #102 于本次记录前已出现格式调整提交 `45eb631f452f10aeffa0dbe30a8485afc37864aa`；数据库日志同样未包含本地 SHA。此次仅确认 D1 隔离数据库专项通过；最新 HEAD 的 `vp check`、全量 `pnpm run ready` 等仍需维护者复验。PR 保持 Draft，未经明确授权不得合并。

## 2026-11-20 · 第三十五批 D2a 共享发布只读 Runtime 候选（待验收）

基线：PR #102 已 Squash 合并至 `main`（`7056a4bd1347cdbc9741e2aebdfa96e19bd347bc`）。维护者 D1 Windows 隔离 PostgreSQL 6/6 文件、57/57 用例、迁移 7/7，最终 `pnpm run ready` 退出码 0；单测 639/639、NestJS HTTP E2E 62/62、`vp check` 359/211、`docs:check` 89 份通过。测试日志未提供本地 `git rev-parse HEAD`，不宣称严格 SHA 绑定。

D2a 在独立 Draft PR 中新增 Core 发布响应严格校验、同源 API Client 发布指针读取、共享 Runtime 发布态以及三组负向测试。验收应覆盖：

- 解析：只接受 `UNRELEASED` 或字段齐全的 `RELEASED`；拒绝额外 head、错误摘要、跨工程、非法事件与时间、被篡改快照。
- 网络：同源 Cookie GET、`no-store`、响应大小限制、401/403/404、AbortSignal、非法工程 ID。
- Runtime：只有验证过的发布态允许 `verified`，Tag 质量始终 `UNAVAILABLE`；断网/撤权清空正文，代次回退和同代次变更拒绝，新代次合法回滚允许较低修订，stop/旧请求不能覆盖最新状态。

**当前未实际执行** D2a 的 `vp check`、`pnpm run test:unit`、`pnpm run docs:check` 和完整 `pnpm run ready`，不能把测试源文件存在当成测试通过。D2a 无数据库迁移或 PostgreSQL 数据写入，默认不要求重新执行 D1 的迁移。D2a 不属于生产发布授权或真实 Keycloak/HTTPS 现场验收。

## 2026-11-20 · 第三十五批 D2b 发布指针刷新候选（待维护者验收）

**基线**：PR #103 已获得维护者合并授权并 Squash 合并到 main，提交 `5f45bacbc90dd841dfb8b1992605d4652464361a`。D2a Windows 全量单测 662/662、HTTP E2E 62/62、`vp check` 364/216、`docs:check` 89 份、完整 `ready` 退出码 0。本轮 D2b 新增测试**尚未实际运行**。

D2b 增量测试覆盖：单次定时刷新对新发布代次切版；未变化发布指针仍验证权限与 SHA-256；离线 1x/2x/4x 有界退避并在恢复时重读发布快照；401/403/404 撤权和坏摘要停止自动刷新；隐藏页清除正文、重显时拒绝回退；请求无响应触发超时撤下旧画面并恢复；手动/定时并发单 GET；跨工程旧回包和已取消定时回调失效；合法新代次回滚与非法代次变更；stop 资源清理与非法配置/工程 ID 拒绝。

维护者在 Windows 的独立验收建议：

```powershell
git fetch origin
git switch --track origin/feat/b35-d2b-release-pointer-refresh
git rev-parse HEAD
vp check
Write-Host "vp check 退出码：$LASTEXITCODE"
pnpm run test:unit
Write-Host "单测退出码：$LASTEXITCODE"
pnpm run docs:check
Write-Host "文档检查退出码：$LASTEXITCODE"
pnpm run ready
Write-Host "完整质量链退出码：$LASTEXITCODE"
```

若本地已有同名分支，使用 `git switch feat/b35-d2b-release-pointer-refresh` 并执行 `git pull --ff-only`。切换前先处理未提交修改；D2b 不增加 Prisma 模型或迁移，默认无需对冻结开发库、生产库或隔离库执行数据库部署。不得把代码存在、模拟时钟单测或旧批次的 Windows 结果误记成 D2b 实测通过。生产发布门禁、PLC/DCS 写入均继续默认拒绝。

## 2026-11-20 · 第三十五批 D3/D4 双框架已发布运行 UI 候选（待维护者实测）

D2b PR #104 已按维护者授权合并，main 合并 SHA `95c1c0e4b3423ba9acfcf425f3b82de304f04633`；Windows 实测 D2b 的 `vp check` 366/218、单测 677/677、HTTP E2E 62/62、`docs:check` 89 份，`ready` 退出码 0。此批新增两套“已发布运行”入口、共享静态发布 SVG 渲染与对应单测；**未在当前候选 HEAD 上执行任何质量检查**。

候选验收边界：React/Vue 导航均独立出现已发布运行入口，未输入工程 ID 时零发布 API 请求；非法 ID 无网络请求；未授予 release:read 或无有效 Cookie 返回安全拒绝；未发布返回独立状态；真实已提交发布快照通过 SHA-256 校验才可显示静态 SVG；断网、10 秒超时、撤权、代次回退及切后台都必须撤下旧画面；停止/导航离开清除会话，返回时不会恢复草稿或 Demo；静态 SVG 不填充模拟 Tag、没有现场 GOOD，BAD 占位不当作故障诊断。

建议维护者 Windows 在最新 PR HEAD 上执行：

```powershell
git status --short
git fetch origin
git switch --track origin/feat/b35-d3-d4-dual-published-runtime-ui
git rev-parse HEAD
vp check
Write-Host "vp check 退出码：$LASTEXITCODE"
pnpm run test:unit
Write-Host "单元测试退出码：$LASTEXITCODE"
pnpm run docs:check
Write-Host "文档检查退出码：$LASTEXITCODE"
pnpm run ready
Write-Host "完整质量链退出码：$LASTEXITCODE"
```

如果本地已有分支则正常 switch/pull；提交前处理工作区未保存修改。本批不需要 Prisma 迁移。**真实双浏览器 Keycloak/HTTPS、release:read 独立授权、无发布/已发布/撤权和可见性等 E2E 尚未执行**，不可把静态检查和 Demo 浏览器测试视为正式发布 Runtime 工业安全验收。

## 2026-11-20 · 第三十五批 D5a 真实 OIDC/HTTPS 已发布运行只读拒绝候选（待验收）

基线：PR #105 已处于 Merged，合并 SHA `637ebbce3191c998b3264733645da947a3739e9f`，与 main HEAD 一致。维护者此前日志确认 PR #105 单测 680/680、NestJS HTTP E2E 62/62、React/Vue/Server 构建通过，`vp check` 370/222、`docs:check` 89 份及完整 `ready` 退出码 0，但未提供本地 SHA；不作为 D5a 的验收证据。

D5a 独立候选包含只读浏览器安全门禁、10 项 Node cases 和真实双 Origin OIDC 浏览器运行程序。候选源文件**尚未在 Windows 上实际运行**，不能声称类型/Lint、自动测试、真实 IdP、TLS 或浏览器专项通过。

候选 Windows 验收顺序：

```powershell
git status --short
git fetch origin
git switch --track origin/test/b35-d5a-published-runtime-oidc-readonly
git rev-parse HEAD
pnpm run test:published:oidc:config
Write-Host "D5a 门禁单测退出码：$LASTEXITCODE"
vp check
Write-Host "vp check 退出码：$LASTEXITCODE"
pnpm run docs:check
Write-Host "docs:check 退出码：$LASTEXITCODE"
pnpm run ready
Write-Host "ready 退出码：$LASTEXITCODE"
```

真实浏览器专项仅在先按 `docs/HARNESS.md` 核对本机可信 Keycloak/HTTPS 双 Origin、预绑定身份、证书 CA 和当前数据库目标**之后**，另行显式运行：

```powershell
pnpm run test:published:oidc:browser
Write-Host "真实发布只读浏览器专项退出码：$LASTEXITCODE"
```

如本地分支已存在，正常 `git switch` 并 `git pull --ff-only`，先保护工作区未提交修改。

**边界**：D5a 只验证随机不存在工程的拒绝，绝不创建工程、发布记录、数据库授权或写入。真实已授权 `release:read`、已发布快照、ACL 撤销、页面隐藏/恢复与断网专项另行实现，禁止将 D5a 自动化当作全部 D5 验收。生产 `ProjectReleaseSafetyGate` 继续 fail-closed，冻结开发库不得被执行迁移操作。

## 2026-11-20 · 第三十五批 D5a 浏览器原生 setter Lint 修复（PR #106，待 Windows 复验）

维护者在 D5a 候选 `test/b35-d5a-published-runtime-oidc-readonly` 上运行 `vp check --fix`，实际得到 224 个文件、**0 错误 / 1 条 `typescript(unbound-method)` 警告**，位置为发布读取脚本 `HTMLInputElement.prototype.value` setter 解引用。该次检查不能记录为零警告通过。

修复仅涉及 D5a 页面输入注入：改用 `Reflect.set(inputPrototype, "value", projectId, input)` 通过原生属性 setter 绑定输入框接收者，保留安全 ID 校验、缺失 setter 拒绝、冒泡 `input` 事件和真正的 React/Vue 页面交互。在原 10 项 Node 安全门禁中扩充受控输入 setter/事件/VM 独立作用域回归；不放宽真实 404、同源只读请求、Token/Cookie 脱敏或服务端安全门禁。

**已执行的仅是协作环境 Node.js 22 等价函数隔离行为验证：5/5 检查通过。** 该环境不能解析 github.com，未检出完整仓库，所以没有运行真实 `test:published:oidc:config`、`vp check`、`docs:check`、`ready` 或真实 Keycloak/HTTPS 浏览器专项；待 Windows 维护者按上文 D5a 验收顺序在最新 HEAD 复验，不得用该局部验证冒充整仓通过。PR 保持 Draft、不合并。

## 2026-11-20 · D5a Windows 离线质量通过，真实登录后等待作用域错误（PR #106，待复验）

维护者在 Windows 实际运行 D5a 的 `pnpm run test:published:oidc:config` **10/10 通过，退出码 0**；`vp check` **372 个格式文件 / 224 个受检文件零警告、错误，退出码 0**；`pnpm run docs:check` **89 份通过，退出码 0**；完整 `pnpm run ready` **680/680 单元测试、62/62 服务端 E2E、双框架和服务端构建完成，退出码 0**。该日志未记录 `git rev-parse HEAD`，不能将结果绑定到最新远程 SHA。上一节 E-070 的原生 setter Lint 故障已由 Windows 检查关闭。

真实 `pnpm run test:published:oidc:browser` 在维护者人工 Keycloak 登录成功后输出“正式发布运行只读专项真实登录失败”，退出码 **1**。经仓库源码定位，该文本对应共享 `waitForLogin` 已返回后 React/Vue 循环中的错误等待：`waitForState` 引用了 `run()` 局部 `browser`，又重复执行 CDP evaluate，`ReferenceError` 被通用捕获吞没。不是已证实的 Keycloak/HTTPS/BFF 登录失败。

E-071 候选仅修正等待回调执行、收紧导航异常重试，并将首次 OIDC 登录与 React/Vue BFF 后续会话检查的失败标签分离；Node 门禁增加 2 项，**修复后完整 Windows 质量链和真实浏览器专项均待重新验收**。不修改正式发布授权、ACL、迁移或生产安全门禁；PR 仍为 Draft，未合并。

## 2026-11-20 · D5a Windows HEAD 绑定质量通过，真实浏览器失败阶段待定位（E-072）

维护者提供本地 `git rev-parse HEAD` = `e12599a94c0c11f97e95a26ff978281812ee39ac`，`test:published:oidc:config` **12/12 通过**，`vp check` **372 文件格式正确 / 224 文件零警告错误**，`docs:check` **89 份通过**，单测 **680/680**、服务端 HTTP E2E **62/62**，完整 `ready` **退出码 0**；E-071 等待作用域修复已通过该 HEAD 的离线质量检查。随后独立 `test:published:oidc:browser` 在人工登录后输出统一脱敏错误，**退出码 1**。现有错误不能定位到具体页面步骤，也不能视为 Keycloak 登录失败或浏览器崩溃。浏览器在 `finally` 中按设计关闭隔离 Profile。

E-072 候选增加固定阶段和安全错误类别诊断，登录后等待 React/Vue 实际导航 DOM 完成再进入页面，防止页面尚未渲染时误点。新增两项 Node 防回归，预计由 12 项增至 14 项。本批**尚未在 Windows 执行修复后的门禁、完整 `ready` 与真实浏览器专项**；不能将上一 HEAD 的通过日志当作新提交的执行证据。未修改 NestJS、Prisma、用户 ACL、正式发布指针、生产发布门禁或工业设备写入。

## 2026-11-20 · D5a 最终真实双框架验收并合并 PR #106

维护者 Windows HEAD `1b7eaab6e4637361e4c84d316902a62cd6f09d9a` 的离线安全门禁 **14/14 通过**，`vp check` **372 文件格式正确 / 224 受检零告警错误**，`docs:check` **89 份通过**，`pnpm run ready` 单测 **680/680**、服务端 HTTP E2E **62/62**、React/Vue/Server 构建完成且完整退出码 **0**。独立 `pnpm run test:published:oidc:browser` 在真实 Keycloak/HTTPS 双 Origin 中 React/Vue 两端均验证相同可信主体、发布入口、无选择时零请求、随机不存在工程 GET 404、安全拒绝、零发布 SVG 和零工程写入，退出码 **0**。经明确授权 PR #106 Squash 合并，合并 SHA 与 `main` HEAD 均为 `fede2b649c4c6d6ca0ffcc79ee3b56ccef9d932a`，E-071/E-072 已关闭。该验收**不涵盖**真实授权、发布快照、撤权或故障恢复。

## 2026-11-20 · 第三十五批 D5b1 真实授权只读状态专项候选（待 Windows 验收）

在已合并的 D5a 基线上新增 `test:published:oidc:authorized:config`（默认加入 `ready`）和 `test:published:oidc:authorized:browser`（必须由维护者在可信本机 Keycloak/HTTPS Lab 中主动启动）。脚本只接受 `--status UNRELEASED|RELEASED --project-id d5b-(unreleased|released)-<UUID v4>` 且状态与前缀必须一致。必须使用事先由授权维护者创建的、真实绑定当前登录主体独立 `release:read` 权限的本机隔离工程；脚本本身**不执行**创建工程、ACL 授予、正式发布或任何数据库写入。

真实浏览器操作使用 D5a 的同源 GET 门禁与真实 DOM 导航，确保两端同一 BFF 主体、选择前零发布请求、目标仅请求一次 `GET /api/v1/projects/:projectId/releases/current` 且 HTTP 200；`UNRELEASED` 必须显示无 SVG、generation 0，`RELEASED` 必须由共享 Core/Runtime 完整性校验后展示非空 SVG 与正修订号/代次，两端状态摘要一致，Tag 均维持 `UNAVAILABLE`。不输出工程正文、凭据、工程 ID 或 SVG 源码，异常只报告固定阶段。**不能使用生产发布 API 构造测试数据**，因为 `ProjectReleaseSafetyGate` 仍默认拒绝；已发布场景只有预置合法隔离快照才能进行，未预置则应拒绝并记录阻塞，不能伪装测试通过。

候选预计新增 **7 项** Node 安全测试（尚未在 Windows 实测）；仓库修改、`vp check`、`docs:check`、`ready` 与真实 Keycloak/HTTPS 授权场景仍需完整验证。没有启动真实数据库写入、调整生产发布安全门禁或开放工业设备写入。

## 2026-11-20 · D5b1 Windows 离线通过，真实授权读取在示例 ID 处失败（E-073）

维护者实际运行 `test:published:oidc:authorized:config` **7/7 通过，退出码 0**，`vp check` **374 文件格式正确 / 226 受检零告警**，`docs:check` **89 份通过**，完整 `pnpm run ready` **680/680 单测、62/62 HTTP E2E、React/Vue/Server 构建完成，退出码 0**。原始完整质量日志未附 `git rev-parse HEAD`；不能将结果严格绑定到后续修复提交。

随后维护者直接使用 HARNESS 中展示的 `d5b-unreleased-12345678-1234-4234-8234-123456789abc` 示例 ID。真实 Keycloak 登录成功，React BFF、导航与输入成功；在 React 发布读取阶段输出“异常已脱敏”，专项 **退出码 1**，Vue 未执行。该示例 ID 的真实工程存在性和独立 `release:read` ACL **尚未得到证实**；原脚本只等待成功状态，可能将 HTTP 404 等受控拒绝误报为超时，不能从本日志断定实际 HTTP 状态。

E-073 候选改为同时识别成功/拒绝/离线/错误终态，对单一 GET 的 HTTP 404（工程不存在或未授权）、401、403、非 200 与客户端状态不一致分别固定脱敏诊断；新增 3 项 Node 回归，预计从 7 项增至 10 项；HARNESS 改为人工输入已存在工程 ID，不再提供可直接复制的虚构 UUID。保持 D5b1 一次只读 GET、零数据库写入、默认发布安全门禁 fail-closed。新提交的 Windows 全量 `ready`、真实 UNRELEASED/RELEASED 两种授权浏览器仍待验证，PR 保持 Draft。

## 2026-11-20 · D5b1 专用未发布工程准备候选（明确授权、尚未执行）

维护者实际验证 Docker `adui_scada` 数据库完成 7/7 Prisma 迁移、未解决迁移 0、保留 39 工程/168 ACL、39 条有效 UNRELEASED 状态和 0 发布事件；此前已备份 SHA-256 校验并在隔离恢复副本上完成 `pg_restore` 和迁移回放。随后授权仅为本机可信 Lab 创建一个 D5b1 专用未发布工程并为已验证 `lab-engineer` 授予该工程独立 `release:read`。

新增 `scripts/prepare-oidc-published-unreleased.mjs` 和 9 项 Node 安全回归；默认只读预检，显式 `--apply --confirm-lab adui_scada` 才调用受保护的工程创建 HTTP API 并在 SQL SERIALIZABLE 事务内加一条 ACL。已有工程、其他权限、发布状态与工业设备不写入。失败后不自动删除已创建工程，须按 ID 单独核查。工具编写阶段已完成 V8 隔离函数行为检查（7 项基本检查通过），**并非整仓 Node 9/9 或 Windows 真实数据库/浏览器测试通过**。新提交的 `test:published:oidc:fixture:config`、`vp check`、`docs:check`、`ready` 和真实夹具写入/双框架读取仍待执行。PR #107 保持 Draft，不提前合并。

## 2026-11-20 · D5b2 本机双框架发布只读故障注入（待真实验收）

在已由维护者成功完成的 PR #107 / D5b1 真实授权 `UNRELEASED` 基础上，新增 9 项本地 Node 故障模拟安全用例和 `test:published:oidc:offline:browser`。先通过真实 Keycloak/BFF、React/Vue HTTPS 同源读取已授权工程，后**仅在浏览器 JS Fetch 层**模拟一次精确 GET 网络异常，检查离线态清空、Tag 质量 `UNAVAILABLE`、真实刷新恢复与停止读取，所有工程 API 受先前只读门禁保护。绝不在 DB 写入、删除 ACL、变更发布指针或启用设备输出。本批尚未运行 Windows Node/浏览器测试、`vp check` 和完整 `ready`，不要将模拟故障表述为真实 TCP 断网。

## 2026-11-20 · D5b3 只读模拟 HTTP 404 安全拒绝专项（待 Windows 真实验收）

前置证据：维护者 D5b2 Windows `test:published:oidc:offline:config` 9/9、`vp check` 378/230 零警告、`docs:check` 89 份、`ready` 680/680 单测和 62/62 E2E 且最终退出码 0；真实 React/Vue HTTPS Keycloak 浏览器首次读取→单次模拟 Fetch 网络失败→恢复与停止退出码 0；PR #108 已 Squash 合并至 `main`，提交 `0b073e574daf93c9b521c53bf56a8ebdc125a525`。

新 D5b3 只新增 browser 测试和 Node 9 项安全门禁：通过真实受保护 GET 200 确认当前 UNRELEASED，浏览器仅为当前工程模拟一次本地 404（非真实授权拒绝），验证 `denied` 无快照及清空状态，再通过真实 GET 200 恢复、停止读取。不删除真实 ACL，不写工程，不发布，设备安全边界不变。新增 `test:published:oidc:denied:config` 进入 `ready`，手工浏览器为 `test:published:oidc:denied:browser`。新代码尚未在 Windows 运行，真实 ACL 撤销和 RELEASED 快照仍待独立验收。

## 2026-11-20 · D5b3 Windows 全量验收完成 / D5b4a 只读预检候选

维护者提交真实日志：D5b3 Node 安全门禁 **9/9**，Vite+ **380 个格式文件/232 个受检文件零告警**，Markdown **89 份**，完整 `ready` 最终退出码 **0**，包含 **680/680** 单测与 **62/62** 服务端 E2E、React/Vue/NestJS 构建；双框架真实 Keycloak/HTTPS 授权读取、浏览器模拟单次 404、真实授权恢复及停止均退出码 **0**。该实测与“真实 ACL 撤销”有明确区别。PR #109 Squash 合并 `main@33c8d31d8eae6c46b8a3ab5ddaabf44a3f8fa227`。

新增 D5b4a `preflight-oidc-published-revocation.mjs` 和 **10 项** Node 只读安全测试，根 `test:published:oidc:revoke:preflight:config` 纳入 `ready`。真实预检命令为 `pnpm run oidc:lab:published:revoke:preflight`，严格本机 Keycloak/HTTPS 与 PostgreSQL 目标；事务为 `REPEATABLE READ READ ONLY`，在 ROLLBACK 后结束，核对原 D5b1 测试夹具及授权、迁移、预绑定身份，D5b4 工程必须尚不存在。没有 INSERT/UPDATE/DELETE/发布或浏览器写入，不能使用旧 D5b1 工程做真实撤权。新 Node 和本机数据库预检尚未实测，PR 继续保持 Draft，等待维护者验证。

## 2026-11-20 · D5b4a 已验收合并，D5b4b 隔离工程准备候选

D5b4a 真实本机 PostgreSQL READ ONLY 预检和 Windows 质量链均由维护者确认退出码 **0**。新增 10/10 Node；`vp check` 382/234 零告警，`docs:check` 89 份；完整 `ready` 680/680 单测、62/62 E2E、React/Vue/NestJS 构建成功，退出码 0；PR #110 Squash 合并至 `main@bbcf827b95d609b73052aaa2076d137ae01e92b5`。数据库无 D5b4 工程，原 D5b1 专用工程和四项 ACL 未变。

本批 D5b4b 只新增独立测试工程准备脚本与 11 项 Node 守卫：命令 `oidc:lab:published:revoke:fixture` 默认仅只读检查前置条件，唯一候选写入模式要求 `--apply --confirm-lab adui_scada` 且需维护者另外授权；正式工程 API 仅创建 `d5b4-revoke-<UUIDv4>` 的最小空白首版；新增 ACL 只允许该工程的 `release:read`，整个过程中事务内核对 D5b1 原 ACL 保持完整。真实浏览器在创建后只读验证 200/UNRELEASED。未在本批执行写入、撤权或双框架 HTTP 404 真实验收。候选 Windows `ready` 与真实预检尚待执行，不能计入已通过项。

## 2026-11-22 · D5b4b 已验收合并，D5b4c 单工程只读预检候选

维护者提交 Windows 真实日志：D5b4b 安全门禁 **11/11**、`vp check` **384 格式文件 / 236 受检文件零警告**、`docs:check` **89** 份、完整 `pnpm run ready` **680/680** 单测与 **62/62** E2E，双框架与 NestJS 构建成功，退出码 **0**；真实 PostgreSQL Lab 默认只读预检退出码 **0**。PR #111 Squash 合并到 `main@67526a8972f90325ed534ef8c05a5d43cffd7357`；**尚无 D5b4 工程或真实撤权**。

新增 D5b4c `preflight-oidc-published-revocation-target.mjs` 和 10 项 Node 只读安全测试；严格从参数传入受控 `d5b4-revoke-<UUIDv4>` 工程，PG `REPEATABLE READ READ ONLY` 原子快照比对 D5b4 工程唯一性、首版/审计/未发布、恰好四项权限以及 D5b1 基线工程完整性。结束后 ROLLBACK，拒绝任何工程/ACL 写入。新专用工程尚未创建，真实预检不应被当成已通过；Windows 质量链和 Node 10 项仍待验收。

## 2026-11-22 · D5b4c 首轮 Windows 质量链 5 秒超时与最小修复候选

维护者提交的真实日志显示：`test:published:oidc:revoke:target:config` **10/10 通过**，`vp check` **386 格式文件/238 受检文件零告警**，`docs:check` **89 份**；完整 `ready` 的单元测试运行到 **679/680**，仅原有 `project-api.store.spec.ts` 接近 2 MiB 边界用例在 Vitest 默认 **5000ms** 内没有完成（该用例耗时约 14.1 秒），因此 `ready` **退出码 1**；后续 E2E、文档和构建**没有执行**，不可写成通过。D5b4 独立工程还未创建，实际数据库只读目标核验尚无夹具且未运行。

PR #112 补丁仅优化测试用例构造方式：把循环里最多 256 次整份接近 2 MiB JSON 序列化，改为初始 1 次和完成时 1 次序列化，中间累积 ASCII 字段与填充值的精确字节；保持每字段 8192 字符上限、请求容量 `PROJECT_SNAPSHOT_MAX_BYTES - 24`、受控超限异常、事务和工程 INSERT 零调用的断言。无生产代码、权限、Prisma 或快照上限变更。新逻辑仅作隔离纯 JS 等价性检查；`vp test run apps/server/src/projects/project-api.store.spec.ts`、`vp check`、`docs:check` 和完整 `pnpm run ready` **仍需在 Windows 当前最新 PR HEAD 重新执行**。参见 `docs/AI_MISTAKES.md` E-074。

## 2026-11-22 · D5b4c PR #112 Windows 修复后全量质量链通过（合并前验收）

维护者上传的 Windows PowerShell 原始输出确认：`pnpm run build:core` 成功；`vp test run apps/server/src/projects/project-api.store.spec.ts` **13/13**，其中接近 2 MiB 的合法请求与超限拒绝用例 **103 ms**，整份定向测试 **122 ms**。新增 `pnpm run test:published:oidc:revoke:target:config` **10/10**；`vp check` **386 个文件格式正确、238 个受检文件零警告/Lint/类型错误**；`pnpm run docs:check` **89 个 Markdown 通过**。修复后完整 `pnpm run ready` 包含 **57/57 单元测试文件、680/680 测试**（近 2 MiB 用例全量并行耗时 **254 ms**）、**6/6 HTTP E2E 文件、62/62 测试**、SSE/本机安全配置及 React/Vue 与 NestJS 构建，命令最终打印 **退出码 0**。首轮 **679/680、退出码 1** 的历史失败记录保留，不代表当前仍受该超时阻塞。

GitHub 合并前复核 PR #112 候选 HEAD 为 `061c42ba756ccbf8d91788a57f615c1faac9b406`，对 `main@67526a8972f90325ed534ef8c05a5d43cffd7357` 领先 3 提交、落后 0 提交，Draft 且 Assignee 为 `@adui-dev`。**原始 Windows 复验日志未包含本地 `git rev-parse HEAD`**，因此不把运行结果伪称为对该 SHA 的严格本机绑定。本段属于验收后文档补录，不能视为补录提交再次完成 Windows `docs:check` 或 `ready`。

本小批只完成独立工程**存在后**的只读 SQL 门禁和离线安全测试。维护者尚未授权创建 `d5b4-revoke-<UUIDv4>` 工程，故真实 PostgreSQL 目标预检前置条件不足，**未运行、不得伪造成功**；没有执行 ACL 删除、恢复、真实授权 404、发布状态写入或工业设备操作。后续创建专用工程与真实撤权须分别获得明确授权。

## 2026-11-22 · D5b4d 真实撤权前后只读验收契约（未执行的测试计划）

已核对 `scripts/preflight-oidc-published-revocation-target.mjs` 的真实只读事务、`scripts/prepare-oidc-published-revocation.mjs` 的显式写入入口，以及既有 D5b1/D5b3 双框架发布读取脚本。当前实现的 D5b4c 目标只读预检必须先有唯一合法专用工程；D5b3 的 404 为浏览器内部模拟，不是生产服务端真实 ACL 撤销后的 404。下一阶段验收矩阵与前置条件详见 `docs/HARNESS.md`。

本次仅更新文档规划，无业务代码/权限/SQL/迁移/脚本变动，未连接数据库、未创建专用工程、未撤销或恢复 ACL、未启动真实 Keycloak 浏览器专项。**没有执行 D5b4d 新增的 Node、Windows `vp check`、`docs:check` 或完整 `ready`；不得将 PR #112 的验证结果记作本分支测试通过。** 后续任何新增写入操作需单独明确授权，且不得复用旧 D5b1 工程。

## 2026-11-22 · PR #113 D5b4d 双阶段真实只读浏览器候选与离线安全门禁

新增 `scripts/test-oidc-published-revocation-readonly.mjs` 与 `scripts/test-oidc-published-revocation-readonly.cases.mjs`，根 `test:published:oidc:revoke:readonly:config` 加入 `ready`，`test:published:oidc:revoke:readonly:browser` 仅人工执行。离线测试定义 **15 项**，包括严格阶段/随机 ID、CDP 自包含原生输入、响应不篡改、真实 Fetch 状态、no-store 与重定向拒绝、POST/跨 Origin 拦截、200/404 不可互换、401/403 拒绝、非法页面状态、额外 GET、资源清理及异常脱敏；这些是**用例定义数量，并非 Node 14/14 通过证据**。

本次从 GitHub 回读脚本并移除 ESM import/export 后，在隔离 V8 中完成两份脚本语法解析；选取主脚本的 12 条纯函数 Mock 路径进行对照，**12/12**；另用隔离 V8 配合受限 Node 断言/测试函数代理执行本批 15 条源测试定义，**15/15**。这两项均**不是**正式 Node `node --test`、Chrome 或 PostgreSQL 实测。这只能作为有限开发自检；**Windows 真实 Node 15 项、`vp check`、`docs:check`、完整 `ready`、React/Vue 登录浏览器与真实数据库只读检查仍未运行**。新增文档提交本身亦未经 Windows 质量链验证，具体 HEAD 需 Windows `git rev-parse HEAD` 对照。

没有创建 D5b4 专用工程、进行数据库 INSERT/DELETE/UPDATE、撤销 ACL、恢复权限、正式发布、工程内容写入或工业设备操作。新浏览器脚本的 `after` 阶段即使返回 HTTP 404，也**不证明 ACL 被真实撤销或工程真实存在**，后续必须单独授权、执行真实 PostgreSQL 撤权后只读审计并核对旧 D5b1 基线完整。

## 2026-11-22 · D5b4e 撤权后 PostgreSQL 只读审计候选（待 Windows 与真实数据库授权）

PR #113 Windows 原始日志：D5b4d Node 15/15、`vp check` 388 个格式文件/240 受检文件零告警、`docs:check` 89 份、`pnpm run ready` 680/680 单测和 62/62 HTTP E2E、React/Vue/NestJS 构建成功，退出码 0；经维护者明确授权 Squash 合并至 `main@19f027838908a385f5966cc4285f41528a436dde`。日志没有本机 `git rev-parse HEAD`，不得把它写为严格 SHA 验收。真实 D5b4 工程、ACL 撤销和双框架服务端撤权 404 没有执行。

本小批仅在 `scripts/preflight-oidc-published-revocation-target.mjs` 增加撤权后阶段严格 ACL 断言，**复用原 SQL、固定身份/迁移及只读事务**；新建独立 `scripts/preflight-oidc-published-revocation-after.mjs` CLI 和 **11 项** Node 安全用例。原 D5b4c 撤权前默认四项权限检查保持不变。根 `test:published:oidc:revoke:after:config` 加入 `ready`，真实数据库 `oidc:lab:published:revoke:after` 不加入 `ready` 且必须由维护者另行授权准备真实目标工程后手工执行。

协作端从 GitHub 回读新旧源码并以隔离 V8 模拟运行原 10 项与新增 11 项断言，**21/21** 符合预期，相关脚本 V8 语法解析通过。**该结果不是 Node `node --test`、Windows `vp check`、`docs:check`、完整 `ready` 或真实 PostgreSQL 证明**；本 PR 尚无这些独立验收结果。未连接数据库、未创建工程、未撤销/恢复 ACL、未执行 SQL 写入、未修改发布状态或工业设备。单次“恰好三项 ACL”快照也无法独立证明历史撤权操作确实发生。

## 2026-11-22 · D5b4f 同一阶段真实只读验收编排候选

维护者提供的 PR #114 Windows 日志：D5b4c 10/10、D5b4e 11/11、`vp check` 390 格式文件/242 受检零警告、`docs:check` 89 份、完整 `ready` 680/680 单测及 62/62 HTTP E2E，React/Vue/NestJS 构建成功且退出码 0。该 PR 已按维护者明确授权 Squash 合并至 `main@aa512cf30d4b524f187d6cb8e46c77840fd72036`。用户日志未包含 `git rev-parse HEAD`，不虚构本机 SHA 对照。

D5b4f 只新建只读编排脚本与 10 项 Node 安全测试，使用同一显式专用工程 ID，分别对 `before` 和 `after` 执行**已有 PostgreSQL 阶段只读核查、已有 React/Vue 真实只读 GET、重复 PostgreSQL 只读核查**，任一步失败即停止。子进程通过 `process.execPath` 固定 Node 脚本/参数执行且 `shell:false`，不调用数据库写入、工程创建或 ACL 撤销/恢复；真实命令没有纳入 `ready`，只有离线门禁加入。历史 D5b4a～e 的安全契约和生产源码未更改。

已回读 GitHub 脚本并在隔离 V8 以受控 Node Assert 模拟执行新测试定义 **10/10**，两份脚本 V8 语法通过。**尚未运行** Windows 原生 `node --test`、`vp check`、`docs:check`、完整 `ready`，也没有已授权的 D5b4 专用工程、真实撤权、前后浏览器或 PostgreSQL 专项结果。跨阶段验收、真实 ACL 变更及生产/设备安全仍未完成。

## 2026-11-22 · D5b4g 单条撤权事务代码候选与验收边界

维护者 PR #115 Windows 日志已确认：D5b4f 离线安全用例 **10/10**，`vp check` **392 个格式文件/244 受检零警告错误**，`docs:check` **89 份**，完整 `pnpm run ready` **680/680 单测、62/62 NestJS HTTP E2E、React/Vue/NestJS 构建成功、退出码 0**。PR #115 经明确授权 Squash 合并至 `main@7fa1ad5734aed653140cb0ec56a1473d036a8cd4`；上传日志未包含本地 `git rev-parse HEAD`，不假设 Windows SHA 完全一致。

新候选仅增加 `scripts/revoke-oidc-published-read-target.mjs` 与 **13 项**对应 Node 安全测试，根 `test:published:oidc:revoke:single:config` 进入 `ready`，真实 `oidc:lab:published:revoke:single` 不进入自动链。它只在明确确认的未来本机 Lab 中，复用 D5b4c/e 原只读查询与完整三/四 ACL 断言；默认只读，未来写入需精确 `--apply --confirm-lab adui_scada --confirm-project <同一目标 ID>`；事务锁内只能删除专用工程单条 `release:read`，对旧 D5b1 和其余三项权限始终只读，失败回滚、未知 COMMIT/后置只读失败禁止自动重试或授权恢复。抽取的共用查询不改变 D5b4c/e 原事务次序和只读性质。

从当前 GitHub 候选源码执行**隔离 V8/Mock 模拟**：新增 D5b4g **13/13**、原 D5b4c/e **21/21**，三项脚本语法解析通过。此项**不是**正式 Windows Node、真实 PostgreSQL、`vp check`、`docs:check` 或完整 `ready` 通过证明；正式质量链与任何真实写入执行均未进行。本轮未创建 D5b4 专用工程、未连接真实数据库、未执行 DELETE/INSERT/UPDATE、未撤销或恢复 ACL、未修改工业设备。

## 2026-11-22 · D5b4 真实单条 ACL 撤销与 React/Vue 前后验收已通过

维护者已明确授权在可信本机 OIDC Lab 中仅为一份新 `d5b4-revoke-<UUIDv4>` 专用工程执行真实创建、独立 `release:read` 授权及一次定向撤销；原 D5b1 工程不得写入。以下结论来自维护者两轮 Windows PowerShell 实际日志，**不是离线 Mock、模拟 404 或本协作端直接连接数据库的结果**。真实测试工程 ID 以维护者本地日志为准，不在公开验收文档完整披露。

- **D5b4b 创建成功**：脚本首先确认无其他 D5b4 专用工程，随后使用真实 Keycloak/BFF 会话经正式工程 API 创建唯一新工程；数据库事务添加该工程一条 `release:read`，真实发布 GET 200 / UNRELEASED 验证通过。创建后未重试，也未自动删除或清理测试工程。
- **D5b4c/f 撤权前成功**：明确传入同一真实工程 ID，PostgreSQL `REPEATABLE READ READ ONLY` 验证其首版、审计、零发布、恰好四项 ACL 与原 D5b1 四项授权完整；`--phase before` 按数据库只读 → React/Vue 真实 HTTPS 同源读取各一次 HTTP 200 → 数据库只读复核顺序完成，两个框架均通过停止读取后的资源清理。
- **D5b4g 单条权限撤销成功**：写入前单独只读预检通过；维护者随后明确调用一次 `--apply --confirm-lab adui_scada --confirm-project <同一 ID>`。脚本报告定向 `release:read` 撤销及提交后的独立 PostgreSQL 只读审计通过；没有自动重试、ACL 恢复或发布状态变更。
- **D5b4e/f 撤权后成功**：单独 `oidc:lab:published:revoke:after` 确认专用工程仅缺少 `release:read`、其余 `project:read` / `version:read` / `version:append` 完整且原 D5b1 工程不变。`--phase after` 按数据库只读 → React/Vue 真实 HTTPS 同源 GET 各一次 HTTP 404 / denied → 停止读取清理 → 数据库再次只读复核完成，最终打印本阶段三项检查通过。

维护者**曾在实际撤权之前提前运行** D5b4e `after` 命令，返回“独立工程 release:read 权限不符合预期”，D5b4f `after` 则在首次数据库核查失败后停止；这是正常 fail-closed，不属于真实撤权失败。随后按顺序执行 D5b4g 单条撤权，再次执行后置审计和双框架检查才真正通过。此前仅打印的“闭环通过”手工 `Write-Host` 不能作为证据；本结论依赖后续真实命令完整成功输出。

**核验证据边界**：用户提交的日志未逐条打印 `$LASTEXITCODE` 或本机 `git rev-parse HEAD`，但 D5b4f 最终成功消息只有在子步骤均返回 0 时才会输出，且没有失败或异常输出。因此记录为**基于本机真实命令成功输出的专项验收通过**，不宣称已独立核验本机提交 SHA。GitHub 记录时 `main@2dd95347c86c15261dfb71f6f0a756d9d0a61362` 是当前已合并实现，但不能据此逆推本机 HEAD 精确一致。本次文档补录没有重新运行 Windows `vp check`、`docs:check`、`ready`。

**未覆盖**：真实发布态 `RELEASED`、Studio 画布/IndexedDB 草稿字节级保护、撤权期间多标签页竞态、长时断网与工业现场控制。因此仅将 **D5b4 独立测试工程的发布运行时真实撤权闭环** 标记通过，不升级为完整 SCADA 工业安全认证。测试工程保持撤权后仅三项基础 ACL 的现状，未获得额外授权前不得恢复权限或对其他工程撤权。

## 2026-11-22 · D5b5 Studio 同工程撤权后发布 GET 与本地草稿保护候选

PR #117 已按维护者明确授权 Squash 合并至 `main@3c2e51c385ddaacb5015b0ea600610e9f3f764a1`，补录 D5b4 真实专用工程创建、单条 `release:read` 撤销、React/Vue 200→404、前后 PostgreSQL 只读终验。该历史成功日志未附本地 Git HEAD 或所有独立退出码，补录文档时亦未重新执行完整质量链。

本小批新增 `scripts/test-oidc-studio-revoked-draft.mjs` 与 **11 项** `scripts/test-oidc-studio-revoked-draft.cases.mjs`，通过现有真实 Studio 工程列表 UI 只读打开同一仍拥有三项基础 ACL 的 D5b4 工程，在隔离浏览器存储本地草稿并形成未保存画布编辑，发起独立同源真实发布指针 GET 404，前后严格比对无网格 SVG、工程 JSON SHA-256、IndexedDB 草稿数及内容摘要、自动保存状态与 CAS 基线。项目 API 的非 GET 在页面脚本执行前被已审核的只读门禁阻断。该 GET **不是 Studio 正式发布状态消费流程**，不得宣称真实 401/404 迟到处理或多标签页竞争已通过。

从 GitHub 候选源码在隔离 V8/Mock 中完成两份脚本语法解析和 **11/11** 测试定义模拟执行，涵盖工程 ID 白名单、请求只读同源、404/no-store/非重定向、真实未保存图元准备、草稿/画布/CAS 漂移、额外请求和脱敏；**不是**原生 Windows Node、`vp check`、`docs:check`、完整 `ready`、真实浏览器或 PostgreSQL 实测。本批未运行任何真实远端写入，未重新授予或撤销 ACL、创建/恢复工程或修改服务端/工业设备。Windows 实际验证与浏览器结果待维护者补证。

## 2026-11-22 · D5b5 Windows 首轮失败与 E-075 跨 Realm 断言最小修复

维护者提供 PR #118 Windows 原始执行日志：`pnpm run test:published:oidc:revoke:studio:config` **11 项中 10 通过、1 失败**，唯一失败为独立 CDP 页面 GET 的请求记录 `assert.deepStrictEqual`，报告 `Values have same structure but are not reference-equal`，位于 `scripts/test-oidc-studio-revoked-draft.cases.mjs:90`。同轮 `vp check` **396 格式文件/248 受检零警告错误**，`docs:check` **89 份**通过；完整 `pnpm run ready` 中 Vitest **680/680** 通过，但在同一 D5b5 Node 用例处停止，**最终退出码 1**，未执行后续 HTTP E2E 和双框架构建。原日志未提供本机 `git rev-parse HEAD`。

**原因**：`runInNewContext` 独立 Realm 中构造的 `fetch` 选项对象被 Node 侧 Mock 缓存为嵌套属性，虽字段相同但严格相等还比较原型；之前隔离 V8/Mock 的简化 `deepEqual` 未覆盖 Node 原生跨 Realm 对象语义，因此此前“11/11 模拟符合预期”不能替代本次原生测试失败。**最小修复只改测试 1 行**，将 `requests` 以 `structuredClone` 转到当前 Node Realm 后继续严格 `assert.deepEqual`，并未修改生产代码、请求内容、参数白名单、GET/404/no-store、草稿保护断言或安全边界。

协作环境用 Node **v22.16.0** 的真实 `node:vm` / `node:assert/strict` 独立复现：旧断言触发 `ERR_ASSERTION`，新断言通过；请求方法、凭据、缓存、重定向、额外请求和多余字段六种负向篡改仍严格拒绝。**本修复 HEAD 的 Windows `node --test`、`vp check`、`docs:check`、完整 `ready` 均待维护者重新执行**。尚未执行 D5b5 真实 Keycloak/HTTPS 双框架浏览器；没有重新创建专用工程、恢复 ACL 或执行数据库写入。

## 2026-11-22 · D5b5 React/Vue Studio 真实已撤权发布 GET 本地保护专项验收通过

维护者在 Windows 本机 `main` 执行 D5b5 真实 Keycloak/HTTPS 浏览器专项，Git 工作区无未提交变更，`git fetch`、`git switch main`、`git pull --ff-only` 均正常；脚本设置 `expectedHead=039bfd01ecf34e3641556fc5536a6bda377cf732`，读取实际 `git rev-parse HEAD` 并检查相等，未抛出异常。这提供了**通过分支 HEAD 一致性校验**的证据；原始终端没有独立回显 `actualHead` 字符串，不能冒充直接打印的本地 SHA。

此前同一修复版本的 Windows 离线验收已完成：`test:published:oidc:revoke:studio:config` **11/11**、`vp check` **396 格式文件/248 受检零警告错误**、`docs:check` **89 份**、完整 `ready` **680/680 Vitest 单测、62/62 NestJS HTTP E2E、React/Vue/NestJS 构建成功、退出码 0**，已获明确授权合并 PR #118，Squash 后为上述 `main` HEAD。本次文档追加没有重新运行这些离线质量检查。

本次真实专项顺序和结果：

1. `pnpm run oidc:lab:published:revoke:after --project-id <既有已撤权 D5b4 工程 ID>`：D5b4e PostgreSQL 只读审计**通过**，工程仍仅缺少 `release:read`，其余三项工程/版本基础授权和原 D5b1 基线完整；未执行任何 ACL 写入或恢复。
2. `pnpm run test:published:oidc:revoke:studio:browser --project-id <同一工程 ID>`：真实受控 Keycloak BFF 登录后，**React** 按正式 UI 只读载入首版、在独立隔离浏览器保存 IndexedDB 草稿、新增未保存图元，执行一次同源真实发布 GET 404，逐项检查 SVG、工程 JSON 摘要、草稿数量与内容摘要、自动保存标记及 CAS 基线，全部保持不变；**Vue** 完成同样动作并通过。
3. 双框架脚本最终报告“同工程跨界面只读回归通过；没有创建工程、恢复 ACL 或写入服务端”；紧随其后的 `$LASTEXITCODE -ne 0` 保护分支未触发，最终人工成功输出只作为辅助，不独立替代脚本真实成功信息。

**正式结论**：D5b5 第一小批“React/Vue Studio 页面独立真实同源发布读取 404 后本地草稿和未保存画布保护”**真实浏览器验收通过**，且已使用先前完成撤权的现存专用工程，未创建新的数据库夹具或再次执行授权撤销。该结果是**真实浏览器与 PostgreSQL 只读回归**，不是浏览器模拟 404。

**不可扩大范围**：发布 GET 是从 Studio 页面发起的独立同源 Fetch，**不是** Studio 业务组件本身消费拒绝响应的发布状态机；草稿比较基于浏览器内读取值的记录数量和 SHA-256，而非 IndexedDB 物理文件字节；也未验证迟到 200/401/404 的真实时序竞态、同源多标签页同时编辑、真正生产设备或完整工业安全认证。后续专项应优先采用同一已撤权工程且零服务端写入的设计，不可为了重复构造撤权前状态恢复 `release:read`。

## 2026-11-22 · D5b5b 同源双标签页撤权后只读草稿保护候选

维护者 Windows 在 PR #119 文档分支执行 `docs:check` **89 份通过**、`vp check` **396 个格式文件/248 个受检文件零错误警告**，并明确授权合并；GitHub 已将文档 Squash 合并为 `main@8855becab403a334231be7b2fb253452a71c0c76`。用户日志未包含本地 `git rev-parse HEAD`，不把那次 Windows 结果严格绑定到 GitHub SHA，也不把此前 PR #118 的 `ready` 误写为此候选新增脚本的验收。

本小批新增 `scripts/test-oidc-studio-revoked-multitab.mjs` 与 **11 项**离线 `.cases.mjs`：复用已合并的 D5b5 单标签页 Studio 工程列表只读载入、SVG/JSON/IndexedDB 草稿/CAS 快照、真实发布 GET 404 安全断言及同源 Chrome 第二标签页连接/真实可见性切换。每个框架两标签都需属于同一真实 Keycloak/BFF 主体、首版修订号 1；**只在第一标签页手动保存一次本地 IndexedDB 草稿**，第二标签仅读取共享记录并建立自己的未保存图元。依次切换真实可见标签执行真实同源发布 GET 404、返回第一标签复核两页本地数据及零受阻工程 API Fetch。该流程**不调用任何服务端工程写入 API**、不创建测试工程、不恢复 `release:read`。

严格区别：本候选仅覆盖**同源双标签页并存、真实可见性切换、顺序只读 HTTP 404 与本地快照保持**；没有交错挂起多个 GET、模拟迟到 HTTP 200/401/404、验证 Studio 自身发布预检状态机，亦不覆盖 IndexedDB 物理文件字节一致性或工业控制认证。用户既有 D5b4 工程仍缺 `release:read`，原 D5b1 权限保持不变；若已不存在或被改变，脚本必须失败，不能调用写入修复测试状态。

已从 GitHub 分支回读三份相关 JS 脚本并执行**隔离 V8 语法解析**，新增 11 项测试在隔离 V8/Mock 中 **11/11 符合预期**。这个简化模拟无法证明 Node `node:vm` 跨 Realm 的原生 `deepStrictEqual` 或真实 CDP 行为，因此**不是**正式 Windows Node、`vp check`、`docs:check`、`ready`、Keycloak/HTTPS/Chrome 或 PostgreSQL 的通过证据。本分支正式质量链及真实浏览器专项均待维护者验收。

## 2026-11-22 · PR #120 D5b5b 双标签页测试未使用导入修复（待复验）

维护者 Windows 在 PR #120 的 `vp check --fix` 中发现 `scripts/test-oidc-studio-revoked-multitab.mjs:30` 的 `eslint(no-unused-vars)` 警告：导入了未使用的 `describeD5b5StudioFailure`；同轮工具报告 **0 个错误、1 条警告**，并完成格式化，故**不是零警告验收**。

远端候选仅删除这一项多余导入，保留双标签页专用的 `describeD5b5MultiTabFailure` 脱敏函数，未修改生产业务、工程 API、ACL 或测试断言。新增复盘为 E-076。当前协作环境不能执行维护者 Windows 的完整 Vite+/pnpm 与真实 HTTPS/Keycloak/Chrome 专项，因此修复后的原生 Node **11 项离线安全用例**、`vp check` 零警告、`docs:check`、`ready` 及 React/Vue 真实双标签页均**待验证**；此前的 V8/Mock 11/11 结果不能替代正式验收。目标继续只读复用已撤权 D5b4 工程，不恢复授权、不新增工程、不写入服务端。

## 2026-11-22 · PR #120 合并及 D5b5b Windows 全量验收补证

维护者提供的 Windows 日志确认 `pnpm run test:published:oidc:revoke:multitab:config` **11/11**、`vp check` **398 个格式文件/250 个受检文件零警告及错误**、`docs:check` **89 份**、完整 `pnpm run ready` **退出码 0**。其中 Vitest **57/57 文件、680/680 用例**、NestJS HTTP E2E **6/6 文件、62/62 用例**、React/Vue/NestJS 构建完成。E-076 的未使用导入问题由上述质量检查记录关闭。日志未包含本机 HEAD 的明确输出，不把实测严格绑定到某个 GitHub commit。

维护者随后明确授权合并 PR #120；GitHub 已将 `test/b35-d5b5-multitab-revoked-readonly@17fe4520e87d40aa2a31ee79265d9e2bce59e9f3` Squash 合并为 `main@eb3fdc5105d3cb5d88593db7fffd7702e91625c8`。**该日志只证明离线质量链**：D5b5b 真实双标签页 Chrome/Keycloak 测试未提供执行记录，不能在本文件记作通过。

## 2026-11-22 · D5b5c 已撤权发布双标签逆序交付候选

新增只读页面门禁、13 项 Node 测试定义及独立 React/Vue 真实浏览器脚本。目标是两页各真实读取同一已撤权 D5b4 工程的发布接口 404，待底层 `fetch` 获得真实 Response 后让两个页面 Promise 同时保持 pending，**先消费第二页，再消费第一页**。每个阶段需比较无网格 SVG、工程 JSON、IndexedDB 草稿数与摘要、自动保存状态及 CAS 基线，原有守卫必须统计每页精确一条目标 GET、无新增写入。只输出固定脱敏阶段及安全类别。

协作容器 Node 22.16.0 对同用途纯门禁原型执行了 `node --check` 与原生 `node --test`：**13/13 测试通过**，包含独立 VM 序列化与故障反向断言。该运行发生在隔离原型文件上，不冒充 GitHub 提交的正式 Windows `vp check` / `docs:check` / `ready`，也不代表真实 CDP、Keycloak、PostgreSQL 或工业安全验收。新 GitHub 分支的完整质量链和真实浏览器测试均**待维护者执行**。

本次不修改 React/Vue 生产业务、NestJS、Prisma 或工业网关。新增门禁不会模拟 HTTP 404，也不会保留 TCP 层挂起连接；它只控制**已到达响应在页面 Promise 的交付时序**。不能将其称为 Studio 自身处理迟到授权拒绝、真实 HTTP 网络竞态或工程写入 CAS 竞争。复用既有工程，不创建数据、不恢复 ACL、不做服务端写入。

## 2026-11-22 · D5b5c Windows 完整质量通过，但双项真实浏览器失败（E-077）

维护者 Windows 在本机执行 `test:published:oidc:revoke:late:config` **13/13**、`vp check` **401 个格式文件/253 个受检文件零警告错误**、`docs:check` **89 份**、完整 `pnpm run ready` **退出码 0**，包含 **680/680 Vitest 单测**、**62/62 HTTP E2E** 与 React/Vue/NestJS 构建。上传日志没有显示运行时本机 `git rev-parse HEAD` 输出，不能把结果严格绑定到某个远端提交。上述质量链通过不能替代真实 OIDC 浏览器专项。

维护者随后复用已撤销 `release:read` 的既有 D5b4 工程执行 PostgreSQL 撤权后 **READ ONLY** 审计，明确确认三项基础 ACL 和原 D5b1 基线完整，未执行写入或恢复。真实 D5b5b 双标签测试完成 React 双标签首版载入、本地草稿与未保存编辑准备，在**第一标签页发布读取**后的保护断言失败，退出码 **1**。真实 D5b5c 双标签测试进一步运行到两页原始响应都已完成网络读取并通过 pending 阶段严格的 `404 + no-store + 无重定向` 检查，在**第二标签页优先释放**后报告“内部异常已脱敏”，退出码 **1**，未覆盖 Vue。当前不能得出最终草稿、CAS 或后台 GET 一定出错的结论。

源码确认 D5b5b 在 `requireD5b5Preserved` 外层合并三种已知错误；D5b5c 没有将复用的保护错误列入安全白名单。修补方案只增加两条浏览器入口共享的固定中文失败分类与 **5+1 项**离线负向回归，原严格断言和 CDP/CDP 网络行为不变。可能出现的“多余工程 GET”“404/no-store 异常”“本地 SVG/IndexedDB/CAS 变化”将分别归类，未知异常仍不能回显敏感内容。

**尚待 Windows 最新 HEAD 重新执行**：`test:published:oidc:revoke:multitab:config`（原 11 项加 5 项），`test:published:oidc:revoke:late:config`（原 13 项加 1 项）、`vp check`、`docs:check`、完整 `ready`；再按 `docs/HARNESS.md` 先只读审计、依次运行真实 D5b5b 和 D5b5c。若首个真实专项仍失败，先用固定类别定位，不需重复 D5b4 授权撤销、不创建工程或修改数据库。失败继续保持 PR #121 Draft，不合并。

## 2026-11-22 · E-078 双标签真实只读响应结算时序候选

维护者 Windows 对上次 E-077 修补后的源码执行 D5b5b **16/16**、D5b5c **14/14**、`vp check` **401 格式文件/253 受检零警告**、`docs:check` **89**、完整 `ready` **退出码 0**（680/680 Vitest、62/62 NestJS HTTP E2E 与 React/Vue/NestJS 构建）。同一既有 D5b4 专用工程的撤权后 PostgreSQL READ ONLY 审计通过，`release:read` 仍缺失，三项基础权限及原 D5b1 基线未变化；没有执行 SQL 写入或恢复。

真实 Keycloak/Chrome 再次验收：D5b5b React 两标签的真实发布 GET 404 都已通过，最后“切回第一标签页并复核”报告“工程 API 只读约束或发布 GET 404 不符合预期”，退出码 1；D5b5c React 两标签真实 404 都已到达页面，两个 Promise 同时 pending 已验证，第二页优先交付之后报“工程响应数量不符”，退出码 1；**Vue 未执行，仍未通过双框架验收**。这些日志没有输出请求数量与请求生命周期，不能推断有额外写入或后台 GET 一定是根因。

源码证实 `installPublishedReadGuardInPage` 先 push `paths`，待 `fetch` 结束再 push `statuses`；先前脚本没有在记基线前保证旧 GET 的响应已结算。E-078 候选新增共享的有界等待：守卫必须 `blocked === 0`、请求与响应数组存在、状态数量不能反超路径数量；等未完成的原生 GET 补齐后才继续。**原严格每次只增加一条目标 GET/404、请求历史不可变化、最终 SVG/JSON/IndexedDB/自动保存/CAS 完全一致仍全部执行**，等待超时仍失败；不清空或忽略任何记录。新增 D5b5b 4 项离线测试定义（20 项），D5b5c 14 项不变。

**待维护者 Windows 在最新 HEAD 重验**：D5b5b 20/20、D5b5c 14/14、`vp check`、`docs:check`、完整 `ready`，随后 D5b4e 只读审计、D5b5b/D5b5c 真实 React/Vue。上次完整质量链不能替代新补丁测试；未知请求异常、长时间未返回或任何本地漂移均保持 fail-closed。

## 2026-11-22 · E-079 D5b5b 真实双框架通过，D5b5c 第一页逆序交付仍失败

维护者 Windows 明确打印 `git rev-parse HEAD = baa612ca029ff3f8a3bd6fe75b03ba24c7d85f9b` 并通过版本一致性检查；D5b4e PostgreSQL 撤权后只读审计**通过**，原 D5b4 工程仍仅缺少 `release:read`，三项基础 ACL 及 D5b1 基线完整。随后 D5b5b 真实 Keycloak/Chrome **React 与 Vue 各自两标签页**都完成正式 Studio 首版只读载入、第一标签保存一次 IndexedDB 草稿、分别新增未保存图元、顺序真实发布 GET 404、真实页面可见性切换与最终 SVG/JSON/草稿/CAS 不变检查，脚本整体退出码 0；**D5b5b 真实浏览器阻塞本轮关闭**。

D5b5c React 两个已完成网络读取的真实 404 Response 的 Promise 同时 pending、第二页优先交付严格通过；随后在第一标签后交付阶段失败，类别为 `D5b5 双标签读取期间工程请求数量不符`，进程退出码 **1**。Vue 尚未进入 D5b5c 阶段。末尾单独的无条件 `Write-Host` 打印“真实浏览器验收通过”不是测试成功结果，不能据此关闭 D5b5c。原脚本在**第一标签严格核验前主动切回第一可见标签**；可见性恢复可能引入常规背景 GET，但尚无请求数量的原始证据证明这就是唯一根因。

E-079 候选只将这一处 `switchToTab(browser, second)` 延后到两个原始 404 各自完成**严格单次目标 GET + HTTP 404 + no-store + 无重定向 + 本地完整状态**校验后的最终可见性恢复阶段。第一标签在仍然隐藏时完成原始 Response 交付，不伪造响应、不改变原守卫、不忽略额外 GET；最后仍切回第一标签执行 SVG/工程 JSON/IndexedDB/CAS 和零写入复核。新加 1 项隐藏标签页仍能独立完成逆序交付且两标签各一次 GET 的 Node 测试定义，D5b5c 目标由 **14 增至 15 项**。

本次 E-079 修补**尚未在 Windows 测试或真实 Chrome/Keycloak 复验**。上轮 D5b5b 20/20、D5b5c 14/14、`vp check` 401/253、`docs:check` 89、完整 `ready` 退出码 0 为**旧 HEAD** 的证据，不代表 E-079 新提交已通过。PR #121 保持 Draft；不修改 React/Vue/NestJS 生产代码、不恢复 ACL、不创建工程、不执行数据库或设备写入。

## 2026-11-22 · D5b6 已撤权正式发布运行页隐藏与重显只读候选

**前序真实验收结案**：维护者 Windows 对 PR #121 的 E-079 完整质量链执行 D5b5c Node 15/15、Vite+ 401/253 零警告/错误、文档 89、Vitest 680/680、HTTP E2E 62/62、React/Vue/NestJS 构建及 `pnpm run ready` 退出码 0。原已撤权 D5b4 专用工程通过 PostgreSQL **READ ONLY** 审计，仅缺 `release:read`，其他三项工程 ACL 和旧 D5b1 基线完整。真实 Chrome/Keycloak **D5b5c React 与 Vue 均**完成双页真实 404 同时挂起、第二页先交付、第一页后交付及最终 SVG/工程 JSON/IndexedDB/CAS 不变；D5b5b 顺序双标签 React/Vue 已在上一轮真实通过。上传日志未单独显示本地 HEAD；GitHub 已按维护者明确授权把 PR #121 Squash 合并至 `main@87f50a56fdf4372afdf9d65e2ddef9e476b0bcfc`，该证据不等于现场工业系统验收。

**本批只验证已实现的正式运行页业务生命周期**：不复用 Studio 手工发起 GET 来冒充运行页逻辑。React/Vue 各在自身可信 HTTPS Origin 中，用同一预绑定 Keycloak 会话与一个隔离 Chrome Profile，通过真实“已发布运行”入口、原生输入与“读取正式发布”按钮选择**原已撤权 D5b4 专用工程**。预先安装已有工程 API Fetch 只读守卫和 D5b4 原始响应观察器；运行页应从默认 `idle`、零 GET 开始，首次真实 GET 404 后进入 `denied`、零 SVG、发布代次/修订为空、Tag 质量 `UNAVAILABLE`。

随后打开第二个同源标签页并真实切换前台，第一运行页在真实 `visibilitychange` 后必须清空为 `idle`，**不得产生第二条 GET**。切回第一标签后，已存在的共享 `PublishedRuntimeRefresher.setVisible(true)` 必须重新向同一目标发起**恰好第二条**真实 GET 404，再次进入 `denied`，无快照、无发布水位、质量不可用。最后点击真实“停止读取”并核对 `idle`、运行内容清空且无第三条请求。每个阶段严格核对 `guard.paths/statuses` 与只读 Observer 的真实 `404 + no-store + 无重定向`，`blocked=0`，拒绝任何额外路径、重复请求、状态码错误、被阻断写入或本地残留发布数据。

**重要限制**：这只证明已撤权工程在运行页真实隐藏重显期间的拒绝和零陈旧显示；不覆盖真实已发布快照从 `verified` 到撤权的竞态、Studio 业务预检迟到拒绝、网络 TCP 级请求乱序、实时 Tag 正常质量、真实发布/回滚写入或工业设备。无写入模式、不新建工程、不变更 ACL、不再次撤权，也不运行现场设备指令。

新增 `test:published:oidc:revoke:visibility:config`（13 项 Node 安全回归定义，纳入 `ready`）和独立的 `test:published:oidc:revoke:visibility:browser`（真实浏览器，需要手动登录，**不纳入 `ready`**）。新代码刚提交 GitHub，协作端无法运行本机 pnpm/Vite+/Keycloak；**本批的 Windows Node/Vite+/docs/ready、真实 React/Vue 专项及数据库事后复核均待实际执行**。本批保持 Draft，未经维护者再次明确授权不得合并。

## 2026-11-22 · D5b6 真实双框架隐藏重显与数据库前后只读审计结案

**已补齐 Windows 真实验收**：维护者在本机完成 `test:published:oidc:revoke:visibility:browser`，脚本启动独立隔离 Chrome/Keycloak 会话，React 和 Vue 两端各自按真实“已发布运行”业务入口完成：初始零 GET → 首次真实 `404 + no-store + 无重定向` 并进入 `denied` → 第二标签使运行页隐藏并清空为 `idle`，无新增 GET → 第一标签恢复可见后发起恰好第二次真实 404 并继续 `denied` → 点击“停止读取”后保持 `idle`、无第三次 GET。原守卫同时核对工程只读、发布快照/代次/修订为空和 Tag 质量不可用。React 和 Vue 各自报告全阶段通过，实际进程结束后 `$LASTEXITCODE` 检查未触发异常，**真实浏览器专项退出码 0**。

**数据库前后对照**：同一已存在的随机 D5b4 专用工程在浏览器执行**前**和执行**后**均实际运行 `pnpm run oidc:lab:published:revoke:after --project-id <既有工程ID>`，两次 PostgreSQL **READ ONLY** 审计都通过：仅缺少 `release:read`，其他三项授权和原 D5b1 基线保持完整；命令明确未执行数据库写入或授权恢复。**只读状态符合预期，不单独证明撤权操作何时发生**。未新建工程、发布版本、恢复 ACL 或执行工业设备操作。

**版本关联**：维护者在浏览器完成后的同一 Windows 仓库明确打印 `git rev-parse HEAD = eda30a5f66930dfbfc9b39f404e1161e157b0613`，与 PR #122 合并前最终 HEAD 一致。PR #122 已按维护者明确授权 Squash 合并为 `main@28c057b5e551c54bc95c0864753718e0a8b348d4`；这是合并对应的内容来源，**并非声称 Windows 真实浏览器直接运行在该 Squash SHA**。此前维护者 Windows 已验证 D5b6 Node **13/13**、`vp check` **403 文件格式正确/255 受检零警告错误**、`docs:check` **89 份**、Vitest **680/680**、HTTP E2E **62/62**、React/Vue/NestJS 构建与完整 `pnpm run ready` **退出码 0**。

**结论与边界**：D5b6 已撤权运行页真实隐藏/重显、再次拒绝、停止清理及数据库前后只读状态的双框架验收完成，可据此结案 Issue #123。该验收仅针对已撤权且无可读取正式发布内容的工程，**不代表**真正已发布 `verified → denied` 运行中授权撤销竞态、迟到响应状态机、真实网络故障、生产发布/回滚写入或工业现场安全验证通过。本次仅补录文档，没有重新执行 Windows `vp check`、`docs:check` 或 `ready`；文档提交需要单独静态验收。

## 2026-11-22 · D5b7a 共享已发布 Runtime 刷新撤权与迟到响应的纯单测候选

PR #124 已经维护者同意并在 Windows `docs:check` **89**、`vp check` **403/255 零告警**后 Squash 合并为 `main@b0f00aa5034cd2f9a7196c506e3affbe4825abe4`；Issue #123 已按 `completed` 关闭。D5b6 实测仅证明同一已撤权的未发布隔离工程在正式运行页上的 React/Vue 首次 404、隐藏清空、重显再次 404、停止零新增 GET，以及浏览器前后 PostgreSQL **READ ONLY** 审计；不证明真实已发布工程在线撤权。

本小批 D5b7a 从该主线创建独立分支，**只在既有 `packages/runtime/test/published-runtime-refresher.test.ts` 新增 2 项 Vitest**，复用共享 `PublishedRuntime`、`PublishedRuntimeRefresher`、有效发布快照工厂和 `manualClock`。用注入的只读读取器模拟受控顺序：

1. 首次完整且可校验的 `RELEASED` 响应进入 `verified`；已开始的第二次刷新尚未结束时必须立刻切到 `loading`、撤下旧 snapshot 与发布代次、Tag 质量仍为 `UNAVAILABLE`；随后模拟 `forbidden`（对应 HTTP 403 语义）拒绝，必须进入 `denied`、旧画面及水位保持空、无新定时器或多余读取。
2. 已校验 `RELEASED` 后的一次自动刷新挂起且底层忽略中止；真实生命周期的 `setVisible(false)` 必须使旧 AbortSignal 失效并立即清空页面。重显后第三次读取模拟 `not_found`（对应 HTTP 404 语义），最终成为 `denied`；此时再向旧已废弃 Promise 释放一个本可验证的合法 `RELEASED` 响应，**绝不能恢复** `verified`、旧 snapshot、发布代次或后台刷新。

这两个测试不引入新生产 API、不访问数据库、Keycloak、网络、浏览器或工业网关，模拟状态**不能**冒称真实 HTTP 403/404、真实 PostgreSQL ACL 变更或生产“正在运行时撤权”场景已经通过。已有正式单测包含基础的 `verified → denied`、自动轮询停止与隐藏重新校验，本次新增覆盖它们之间的异步交错保护。

**验证状态**：代码及文档已推送候选分支并做 GitHub 静态回读，最新分支 Windows 真实 `vp test run packages/runtime/test/published-runtime-refresher.test.ts`（预计原 15 项增至 17 项）、`vp check`、`docs:check`、完整 `pnpm run ready`（Vitest 预计 682 项）均**尚未执行**。真实已发布工程的合法发布快照与受控撤权 Lab 准备、权限操作、浏览器 `verified → denied` 和数据库前后审计均独立待评审，**不得使用已撤权 D5b4 工程去恢复 ACL 或写入发布快照**。

## 2026-11-22 · D5b7b 已发布夹具只读元数据预检候选

从已合并的 `main@834defd4e50ad8f8e199e130e9bfc986a618ff52` 建立 `test/d5b7b-published-fixture-metadata`，只新增 `scripts/audit-published-fixture-metadata.mjs` 及 `.cases.mjs`，并在 `package.json` 加入离线脚本及 `ready`。本次不增加生产 HTTP/API、Prisma 模型或迁移、ACL 操作、Keycloak/Chrome 脚本、真实已发布工程、工业数据源或设备写入。

元数据分类器严格限定显式 `d5b7b-published-<UUID v4>`、可信本机 Lab 数据库用户/租户/主体、独立 `release:read`、安全整数代次及修订、64 位小写 SHA-256、末次事件 UUID、版本/事件与发布指针复合一致性。仅输出 `DENIED`、`UNRELEASED`、`RELEASED_METADATA_ONLY`；输入若夹带快照正文、数据库连接字段或元数据不一致，则返回固定中文拒绝。模拟 `RELEASED_METADATA_ONLY` **绝不等于**生产 `verified` 或实际已发布夹具存在。

**当前实测范围**：独立隔离容器 Node.js v22.16.0 已执行新脚本的 `node --check`，原生 `node --test` **14/14 通过**。第一次独立测试曾暴露 `head_revision` 超出安全整数上限仍被接受；修复安全上限后重新执行 14/14 通过。该运行发生在提交 GitHub 前的隔离代码副本，不是仓库完整工具链，也不等于 Windows 最终 HEAD 的验收。

**仍待维护者 Windows 复验**：记录分支完整 HEAD，运行 `pnpm run test:published:oidc:fixture:metadata:config`、`vp check`、`pnpm run docs:check` 与完整 `pnpm run ready`。未进行 PostgreSQL READ ONLY 实测、真实 Keycloak/Chrome、已发布工程证明或在线 ACL 撤权；生产 `ProjectReleaseSafetyGate` 继续固定 fail-closed。详见 Issue #126。

## 2026-11-22 · D5b7c 已发布夹具 PostgreSQL 只读审查候选

PR #127 已由维护者提供 Windows 离线 14/14、`vp check` 405/257 零错误告警、`docs:check` 89 份、`ready` 682/682 Vitest、62/62 HTTP E2E、双框架/服务端构建完整通过后，按明确授权 Squash 合并到 `main@0c3d3b2592121c6963c9e7a7112a92a8920b3ef0`。合并前 HEAD `98cbe816e0a1aaa91c1af71e4a68f5870611e2ac` 与前次审查相比只包含测试格式调整；未执行历史分支清理。

本批从最新 `main` 建立 `test/d5b7c-published-fixture-readonly`。新增仅用于手动调用的 PostgreSQL **READ ONLY** 审查脚本与原生 Node 安全 Mock 测试，所有 SQL 为带参数的元数据 `SELECT`，查询严格处于 `REPEATABLE READ READ ONLY` + `ROLLBACK`，不选取 `snapshot` 正文、不读取凭据、不触发写入。活动身份与 OIDC 预绑定先于目标工程查询；无 `release:read` 不访问发布状态。根 `package.json` 只把离线用例纳入 `ready`，真实 PostgreSQL 连接为另外的显式命令。

**验收现状**：本次完成 GitHub 源码、Schema 字段与迁移契约静态核对，**尚未在 Windows 正式运行新分支的 Node 离线专项、`vp check`、`docs:check` 或完整 `ready`**；也没有对真实 PostgreSQL 发起查询或证明存在 D5b7b 已发布夹具。只有真正执行后才能填报退出码。生产 `ProjectReleaseSafetyGate` 继续固定拒绝；任何真实 `verified → denied` 和 ACL 操作仍待独立授权。

## 2026-11-22 · D5b7d Issue #126 原 D5b1 只读基线安全门禁候选

PR #128 已经维护者 Windows 离线 12/12、`vp check` 407/259 零告警、`docs:check` 89、全量 Vitest 682/682、HTTP E2E 62/62、React/Vue/NestJS 构建与完整 `ready` 验收，按明确授权 Squash 合并至 `main@bdc35bafb9951b911dccfc4f99976b33e28a24ae`。合并前远程 HEAD `17296dcaaece30a3e35feb911e5e9ba1cbc80a13`，其最后一次提交仅涉及测试/源码格式调整。

本批依据 Issue #126 原工程基线要求，在 `test/d5b7d-baseline-readonly` 新增纯函数 `assertPublishedFixtureBaselineRows`，复核 D5b1 首版、原审计、零发布状态/事件及四项 ACL，并在 PostgreSQL **同一 READ ONLY + ROLLBACK 事务**中于读取目标工程之前执行。扩展 D5b7c 原 Mock 测试，要求原基线漂移时不查询目标工程；所有 SQL 仅为元数据 SELECT，不含 snapshot。

**实际执行**：隔离 Node.js 22.16.0 先对新增的纯函数及其单测文件运行 `node --check`，原生 `node --test` **5/5 通过**（实施前的独立代码副本）。这是新增纯函数的局部验证，**不是**当前 GitHub 完整 HEAD 的实际 Windows 验收。整合后 D5b7c Mock 的 14 项定义、`vp check`、`docs:check`、`pnpm run ready`、真实 PostgreSQL READ ONLY、Keycloak/双框架在线撤权均待执行，不能推断成功。

当前仍未确认存在真正已发布且具备受控授权的独立 D5b7b Lab 工程；不能据此关闭真实 `verified → denied` 阻塞，也不能调整 `ProjectReleaseSafetyGate` 或执行写入。

## 2026-11-22 · D5b7e Issue #126 全量目标 ACL 元数据保护候选

PR #129 已按维护者明确合并授权 Squash 合并至 `main@fb320f4731cd59535c0bd00222be93ce3fe486b7`，合并前 HEAD `a3168d553cf030f6bcd5130c4fb7ac6ef9acf549`；后者相比前次审查 HEAD 只调整了代码和文档格式。维护者 Windows D5b7d 基线专项 **5/5**、D5b7c 事务回归 **14/14**、`vp check` **409/261**、`docs:check` **89**、Vitest **682/682**、HTTP E2E **62/62**、双框架与服务端构建、完整 `ready` **通过**。历史分支清理继续暂停。

在最新主线发现 D5b7c SQL **先筛除非 `release:read` 授权行**，导致纯分类器不能看到异常授权、额外其他主体与多余发布权限的真实数据。D5b7e 最小修改目标 ACL 查询为同租户同工程**全量授权元数据**；先校验受控主体三项基础授权或四项含读取授权，无授权/三项仅返回 DENIED，其他异常 fail-closed；原 D5b1 基线和只读事务不变。D5b7c Mock 回归从 14 项定义扩为 **17 项**，新增完整 ACL 形态、额外/跨主体/重复/缺失权限以及孤立 ACL 拒绝用例。

**当前验证级别**：GitHub 远端代码/Schema/已有 D5b4 ACL 契约静态核对，尚未提供本批最新 HEAD 的 Node、`vp check`、`docs:check`、完整 Windows `ready` 实测日志；没有执行真实 PostgreSQL/Keycloak/浏览器操作，仍缺合法 RELEASED 夹具与实时撤权证据。此批不改生产发布安全门禁或 ACL 写入。

## 2026-11-22 · PR #132 Windows 修复验收与 D5b8a 服务端门禁代码候选

维护者提供 PR #132 修复后 Windows 日志：`docs:check` **90 个 Markdown 通过**；`vp check` **412 个格式文件、263 个受检文件零警告或错误**；完整 `pnpm run ready` 已执行并完成 Vitest **682/682**、D5b7f Node **16/16**、D5b7c **17/17**、HTTP E2E **62/62**、Vue/React 构建、NestJS 构建，最终退出码 0（原先 E-082 的 ADR 状态失败已复验关闭）。此次用户日志未包含 HEAD，因此不能把它伪装成与 PR #132 远程最终 SHA 一一绑定；PR #132 保持 Draft，不因用户说“继续”就自动合并。

D5b8a 在独立分支对正式 `ProjectReleaseSafetyGate` 增加安全阻塞评估，只输出固定类别、路径并保持原安全拒绝异常；含模拟 Tag 的工程、无 Tag 的纯静态工程均**不能发布**，数据库事务内没有新增任何写入。新增 `apps/server/src/projects/project-release-safety-gate.spec.ts` 六项 Vitest 测试定义，覆盖上下文隔离、Runtime 不兼容、无来源 Tag、静态工程仍拒绝、不触发 SQL 和异常信息脱敏。

**验证边界**：已在 GitHub 对照现存 Core `validateProjectReleasePreflight`、NestJS `PrismaProjectReleaseStore.publish` 调用顺序和严格安全门禁，并静态核对更新后的源码；**当前 D5b8a 最新 HEAD 尚未在 Windows 运行 `vp check`、`pnpm run test:unit`、`docs:check` 或完整 `ready`**。本批代码只是完成门禁审查能力的第一步，真正的 Runtime/Tag/工业资源策略仍需专项设计、实现和真实验收，不允许以 6 项离线测试替代。

## 2026-11-22 · D5b8a 首次 Windows Vite+ Mock 泛型警告与最小修复

维护者在 Windows 执行 `vp check --fix` 时，`apps/server/src/projects/project-release-safety-gate.spec.ts:77` 出现 **1 条 `vitest(require-mock-type-parameters)` 警告、0 条错误**：`const query = vi.fn();` 未声明 Mock 函数泛型。命令随后报告“Formatting completed”，**并不代表零告警的 `vp check` 已通过**。这是已记录的 E-005 同类缺陷复发，新增 E-083。

PR #133 已在原分支将上述单行改为 `const query = vi.fn<() => Promise<unknown[]>>();`，仍只断言 `expect(query).not.toHaveBeenCalled()`，不实际访问事务或数据库，不修改生产 Gate、HTTP 503 错误或发布指针。已完成 GitHub 远程文件回读与差异检查，**尚未取得修复后 Windows `vp check`、Vitest 及完整 `pnpm run ready` 的运行结果**；PR 保持 Draft，Issue #126 不因修复 Lint 就结案。

## 2026-11-22 · D5b8a 修复后 Windows 验收及 503 非空阻塞诊断新增回归

维护者上传 D5b8a Windows 真实日志：`vp check` **412 个格式文件、264 个受检文件零警告/错误**；`pnpm run test:unit` **58/58 文件、688/688 测试**，新服务端门禁 **6/6**；`pnpm run docs:check` **89 个 Markdown**；完整 `pnpm run ready` 已通过核心构建、类型检查、所有离线专项、Vitest 688/688、NestJS HTTP E2E **6/6 文件、62/62 用例**、React/Vue 和 NestJS 构建，末尾退出码检查无异常。E-083 原有 `vi.fn()` 无类型参数警告已由零告警复验关闭。日志没有打印本地 `git rev-parse HEAD`，不得将其直接绑定至 GitHub 最终提交 SHA。

在上述已验收版本之后，继续于原 Draft PR #133 **仅增强既有 HTTP E2E 的一条 503 安全断言**：构造包含 `TAG_SOURCE_UNVERIFIED`、`RUNTIME_ADMISSION_UNAVAILABLE`、`INDUSTRIAL_READ_POLICY_UNAVAILABLE` 的真实错误对象，检查 HTTP 响应仍严格等于 `{ statusCode: 503, message: 固定中文说明 }`，不泄漏内部阻塞代码、字段路径或 Prisma 信息。不修改发布安全门禁实现、正式事务、数据库、权限或设备控制。

**新的 E2E 断言尚未在 Windows 实测**，因此先前 62/62 / 688/688 / 完整 `ready` 的成绩仅作为原修复版本的证据，不能当作本次最终 HEAD 的运行通过。PR #132、#133 仍保持 Draft；Issue #126 的真实已发布独立夹具及 `verified → denied` 仍受安全门禁与独立审批阻塞，不得假装结案。

## 2026-11-22 · D5b7f 无 ID 已发布夹具受控只读发现候选

用户没有独立已发布 Lab 工程的真实 ID。针对 Issue #126，从 `main@4a39abc42e267f541c7990b3402d368658307866` 新建 `feat/d5b7f-readonly-discovery`。不把“没有 ID”当作“数据库不存在已发布工程”，也不绕过仍固定 fail-closed 的 `ProjectReleaseSafetyGate`。

本批新增 `scripts/discover-published-fixture-readonly.mjs` 以及 `.cases.mjs`，只允许无参数 CLI，在已验证本机 Lab、发布迁移、活动身份/预绑定和原 D5b1 基线的 `REPEATABLE READ READ ONLY` 事务中，按固定专用工程前缀/租户/主体独立读取授权和非零发布指针过滤，`LIMIT 2`，只查询 `project_id`。零个和多个均不暴露任何 ID；恰好一个符合 UUIDv4 的候选时，仍须使用已合并 D5b7c～D5b7e 审查器**重新开启只读事务**核对 ACL/发布指针/版本/事件，才允许输出该 ID 与 `RELEASED_METADATA_ONLY`。没有实际快照正文检验，不得声称 verified。

离线安全测试定义 **16 项**（参数拒绝、唯一性与上限、原基线漂移、迁移及可信身份、查询范围、SQL 故障回滚、二次复核拒绝、异常信息脱敏），增加 `test:published:oidc:fixture:discover:config` 并纳入 `ready`；**真实数据库命令** `oidc:lab:published:fixture:discover` 保持单独手动运行。本次已从 GitHub 回读代码与配置，但尚未执行 Windows 原生 Node/Vite+/文档/完整 ready，**也没有访问真实 PostgreSQL 或证明任何合法已发布夹具存在**，所有退出码以维护者未来真实日志为准。

无 Vue/React/NestJS 业务变更、SQL 写入、ACL 变更、设备控制或发布门禁调整。真实只读发现需要维护者在本机另行确认隔离 Lab 与只读操作边界，Issue #126 继续 Open。

## 2026-11-22 · D5b8 已发布测试夹具正式设计候选的验证边界

本批基于 `main@53e686d04e7bce5ad360c8901aa965db6e838cfe` 新建 `chore/d5b8-published-fixture-design`，只新增状态为 `Proposed` 的 [ADR-0070](adr/0070-isolated-published-fixture-safety-review.md) 并同步正式发布评审矩阵、项目上下文与代码定位。没有代码、数据库连接或写入。用户真实 Windows D5b7f 只读发现结果为 `NOT_FOUND`、退出码 1；这一结果是未发现符合**固定专用筛选条件**的工程，而不是所有发布状态均为空。

**当前仅有仓库代码与文档静态核对证据**：已读取 `AGENTS.md`、`AI_MISTAKES.md`、ADR-0069、`RELEASE_TRANSACTION_REVIEW`，核对正式发布仓储和 `ProjectReleaseSafetyGate`。后者目前固定拒绝是正确安全边界；不因本 ADR 提议而解除。尚未在当前分支 Windows 执行 `pnpm run docs:check`、`vp check` 或完整 `pnpm run ready`；**没有任何真实发布/回滚/撤权成功记录**，LF-01～LF-12 为未来需逐项提供的证据，不能标记通过。

维护者在验收分支后执行：`git rev-parse HEAD`、`pnpm run docs:check`、`vp check`、`pnpm run ready`，逐项核对退出码与 ADR 相对链接。不应运行 `db:migrate`、`test:db`、真实发现、发布、ACL 撤销或其他需额外审批的操作。文档检查成功不代表工业安全设计已被批准，Draft PR 合并也不授予发布权限。

## 2026-11-22 · D5b8 PR #132 首次 Windows 质量链失败与 E-082 状态修复

维护者提供 2026-11-22 在 `chore/d5b8-published-fixture-design` 的实际验收日志：首次 `pnpm run docs:check` 报 `ADR 状态无效：0070-isolated-published-fixture-safety-review.md`，**退出码 1**；`vp check` **412 个文件格式正确、263 个受检文件零警告或错误**；完整 `pnpm run ready` 已执行并通过 Vitest **57/57 文件、682/682 用例**、SSE/安全离线专项、D5b7b 元数据 14/14、D5b7d 基线 5/5、D5b7c ACL 17/17、D5b7f 无 ID 发现 16/16、NestJS HTTP E2E **6/6 文件、62/62 用例**，但在末尾再次因 ADR 状态失败，`ready` **退出码 1，不能记录为通过**。失败后的 `Write-Host "D5b8 质量链验收通过"` 为独立打印，不属于 `ready` 成功证据。

根因与 E-019 相同：原文件使用 `- 状态：Proposed（待维护者与工业安全专项评审，**未授权实施**）`，仓库 `scripts/validate-docs.mjs` 只接受状态行精确匹配枚举。PR #132 本分支已最小修改为 `- 状态：Proposed` 与独立 `- 审批：...`，不放宽正则、不修改业务逻辑；同步 E-082 复盘。远程修正文案已按现有正则静态核对，**尚未获得修复后 Windows `docs:check`、`vp check` 和完整 `ready` 的实际日志**，当前 PR 仍须重新验收且不能自动合并。

Issue #126 仍未结案：D5b7f 真实发现 `NOT_FOUND`，Proposed ADR-0070 只是正式发布安全门禁及独立夹具的待审批设计，未开放任何发布、撤权、数据库写入或现场设备操作。

## 2026-11-22 · D5b8b 已发布 Runtime 二次准入待验收

PR #132 Squash 合并 `86d078b942766d9bac2e5d383e91295385260621`；PR #133 在处理四份重叠文档的冲突后 Squash 合并 `129f804b2c3ff0055ef3b9d6a554e02c5e8c9aae`。维护者的 Windows 日志曾通过 688/688 Vitest、62/62 HTTP E2E、`vp check` 412/264、89 份 Markdown 和完整 `ready`，但日志未打印本地 HEAD；PR #133 后续合并冲突处理只移动文档段落，不将该记录伪称最终合并 SHA 的独立实测。

D5b8b 本轮仅新增共享 Runtime 二次静态兼容性检查：真实有效的已发布快照若与当前 Core SVG Runtime 不兼容，则不进入 `verified`，静态 SVG 渲染函数也拒绝继续输出。新增两项 Vitest 负向用例定义，另有一项循环验证规则/版本不兼容。代码已提交到独立分支，尚未运行 Windows Vitest、Vite+、文档检查、完整 `ready` 或真实双框架浏览器；以下为维护者后续验收命令，不属于已通过证据：

```powershell
git rev-parse HEAD
pnpm run test:unit
if ($LASTEXITCODE -ne 0) { throw "共享 Runtime 单元测试失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "完整质量链失败" }
```

此项不能替代真实 Runtime 资源可用性、Tag 数据源、工业只读准入的专项审批；不执行 PostgreSQL、发布 POST、ACL 撤销、设备控制与分支清理。Issue #126 继续 Open。

## 2026-11-22 · D5b8b 合并验收与 D5b8c Tag 安全阻塞候选

维护者 Windows 在 PR #134 合并前实测 **58/58 测试文件、690/690 Vitest**、`vp check` **413 个文件格式通过/264 个受检零警告错误**、文档 **90** 份、服务端 HTTP E2E **62/62** 及 React/Vue/NestJS 完整 `ready` 成功；未附本地 HEAD SHA。PR #134 最新 HEAD `4a5122e5e47590acd501b78967b9e063a7fba83c` 通过维护者本轮明确授权合并到主线 `445424024b7faf82dd94c0a4faa6620a7d3049bd`，并没有测试用安全放行代码。

D5b8c 仅增强 `ProjectReleaseSafetyGate` 的静态 Tag 可信来源与绑定诊断，不新增真实来源记录、数据源认证、写操作、测试用通行证或运行时质量伪造。新增 3 项 Vitest 测试定义，覆盖隐藏绑定、`unknown` 类型、元数据伪造与诊断脱敏；服务端门禁仍在评估后无条件抛错，HTTP 响应继续固定 503 中文消息。**本轮没有执行仓库真实 Vite+ / Vitest / 完整 `ready` 测试，目标用例数不能写成已通过结果**。

维护者在本地同步 D5b8c Draft PR 最新 HEAD 后可执行：

```powershell
git rev-parse HEAD
pnpm --filter @adui/scada-server run test
if ($LASTEXITCODE -ne 0) { throw "D5b8c 服务端测试失败" }
pnpm run test:unit
if ($LASTEXITCODE -ne 0) { throw "D5b8c 全量单测失败" }
pnpm --filter @adui/scada-server run test:e2e
if ($LASTEXITCODE -ne 0) { throw "D5b8c HTTP E2E 失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "D5b8c Vite+ 检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "D5b8c 文档检查失败" }
pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "D5b8c 完整质量链失败" }
```

离线质量链不含真实已发布夹具、正式发布 POST、ACL 撤权、工业网关与设备数据质量；这些工作需独立工业安全审核及明确操作授权，不能据本批结果改变 Issue #126 未完成状态。

## 2026-11-22 · D5b8d 工业只读阻塞细分待 Windows 验收

D5b8c 的维护者 Windows 日志包含明确 `git rev-parse HEAD = c555caf56c1208cf46c584aec72dd3533344072e`，与 PR #135 远程 HEAD 相同；实际 `pnpm run test:unit` **693/693**、`vp check` **413 文件格式通过/264 文件零警告或错误**、`docs:check` **90 份**，完整 `pnpm run ready` 包含 **693/693 Vitest、62/62 HTTP E2E** 和 React/Vue/NestJS 构建成功。维护者本轮明确同意合并后 PR #135 Squash 合并至 `main@b0e37d57e6c6c755e1a0ebe4198f3aa0905fbc23`；不将本次离线结果泛化为现场工业安全评审。

D5b8d 独立候选仅添加两类工业只读风险标记：图元绑定缺少工业只读操作策略证明、`rules[]` 非空表示存在未经审核的潜在执行规则。检查不执行规则、不尝试解释动作字段、不访问网络/数据库/设备，且包含隐藏/非首屏图元；仍无条件抛 `ProjectReleaseGateUnavailableError`。新增 **3 项单测定义**，既有 9 项加 3 项的目标值是 12 项，**不是已运行结果**。当前 GitHub 协作环境未执行 Windows Vite+、Vitest、HTTP E2E 或完整 `ready`；请在 PR 当前 HEAD 上逐一执行：

```powershell
git rev-parse HEAD

pnpm run test:unit
if ($LASTEXITCODE -ne 0) { throw "D5b8d 单元测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "D5b8d Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "D5b8d 文档检查失败" }

pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "D5b8d 完整质量链失败" }

Write-Host "D5b8d Windows 离线验收通过" -ForegroundColor Green
```

该验收不包含真实 `adui_scada_test` PostgreSQL、Keycloak/HTTPS 已发布夹具、工业网关白名单、真实 Tag 质量/时效、规则安全审计或任何发布/撤权操作。ADR-0070 S0～S5 授权不得因单测绿灯而自动获得；生产 HTTP 503、禁止设备写入与 Issue #126 Open 均保持不变。

## 2026-11-22 · D5b8d Windows 实测与 D5b8e 安全评估异常兜底待验收

D5b8d PR #136 已由维护者 Windows 实测 **696/696 Vitest**（Gate **12/12**）、HTTP E2E **62/62**、Vite+ **413 格式文件/264 受检零告警错误**、Markdown **90** 份及完整 `pnpm run ready` 成功，随后凭维护者本轮明确授权 Squash 合并至 `main@e76d82e63fa36c754ed0ce0affb656c5a5bb0efb`。该日志未打印 `git rev-parse HEAD`，不能据此声称本机测试已严格绑定远端 HEAD；也未做真实工业网关或已发布夹具现场验证。

D5b8e 候选只改 `ProjectReleaseSafetyGate.assertReady` 的**评估异常**拒绝分类：发生评估错误时返回唯一固定内部代码 `SAFETY_ASSESSMENT_UNAVAILABLE`，不透出原始属性 getter 异常与工程数据；仍抛既有固定安全错误，对外 HTTP 503 不变。2 项新 Vitest 测试为**定义**而非已运行结果，预计 Gate **14**、全量单测 **698**，必须以本机实际输出为准。

在本地同步 D5b8e Draft PR 后执行：

```powershell
git rev-parse HEAD

pnpm run test:unit
if ($LASTEXITCODE -ne 0) { throw "D5b8e 单元测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "D5b8e Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "D5b8e 文档检查失败" }

pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "D5b8e 完整质量链失败" }

Write-Host "D5b8e Windows 离线验收通过" -ForegroundColor Green
```

本次静态代码和 GitHub 差异核查不能替代上述实际 Vitest/Vite+。未执行正式发布 POST、ACL 更改、现场只读策略/Tag 数据源验收、真实 OIDC 已发布快照及动态撤权。正式 `assertReady` 在正常和异常路径均固定拒绝；Issue #126 Open、ADR-0070 Proposed。

## 2026-11-22 · D5b8f 正式发布静态工程与 HTTP 异常跨层回归待验收

D5b8e PR #137 在维护者 Windows **精确 HEAD `88c2c285b8361fd99c51eed48df8e6130484e647`** 实测 Vitest **698/698**、Gate **14/14**、Vite+ **413/264 零错误警告**、文档 **90**、HTTP E2E **62/62**、React/Vue/NestJS 构建及完整 `ready` 成功。获本轮明确授权后已 Squash 合并至 `main@a56549dbe614e4f4c18d17e0d01e7eff6d7a4c70`。

D5b8f 仅新增两项测试定义：

1. **仓储级**：合法静态快照（零 Tag/绑定/规则）经过现有真实 `publish` 事务及生产 `assertReady`，仍返回两类固定安全阻塞，发布事件不插入，发布指针与代次不更新。
2. **HTTP E2E**：已有 `ProjectReleaseGateUnavailableError` 携带 `SAFETY_ASSESSMENT_UNAVAILABLE` 时，正式 POST 只响应固定中文 503、`Cache-Control: no-store`，不暴露代码、路径或原始消息；不调用其他工程写入口。

**待验收，未在本轮 GitHub 协作环境执行真实质量链**。预计全量 Vitest **699**、正式发布仓储定向 **19**、HTTP E2E **63**；所有数量以维护者 Windows 实测为准，不能将测试定义冒充运行结果。请在 Draft PR 最新 HEAD 执行：

```powershell
git rev-parse HEAD

pnpm run test:unit
if ($LASTEXITCODE -ne 0) { throw "D5b8f 单元测试失败" }

pnpm --filter @adui/scada-server run test:e2e
if ($LASTEXITCODE -ne 0) { throw "D5b8f HTTP E2E 失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "D5b8f Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "D5b8f 文档检查失败" }

pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "D5b8f 完整质量链失败" }

Write-Host "D5b8f Windows 离线验收通过" -ForegroundColor Green
```

以上是离线质量验收，不代表真实 PostgreSQL、Keycloak HTTPS 双框架 RELEASED、网关策略、工业只读主管审批和动态 `verified → denied` 已交付。正式发布 `assertReady` 仍无条件拒绝；Issue #126 保持 Open、ADR-0070 Proposed，任何创建夹具、真实发布和撤权写入必须单独授权。

## 2026-11-22 · D5b8g HTTP 失败日志脱敏待 Windows 验收

D5b8f 的维护者 Windows 质量日志显示原 HEAD `6012008684253b36e92168312baebcde667cfd11` 上单测 **699/699**、HTTP E2E **63/63**、`vp check` **413/264 零错误或警告**、Markdown **90** 及完整 `ready` 成功。合并前远端 HEAD `1347566d1aef13cfee9875f7ba963d76e6699a91` 仅增加 `docs/VALIDATION.md` 一行列表排版空行，已对比并记录，随后经维护者明确授权 Squash 合并至 `main@a738086b088c025176adcd4d9c49be7ae9414648`；该空行提交没有独立 Windows 全量复验记录。

D5b8g 候选在既有 `pino-http` 配置中新增 `err` 结构化固定序列化。**修复前**的实际 HTTP E2E 日志出现 Pino 默认 `err.stack` 与本机绝对路径，而非发布失败或泄漏真实生产凭据的证据。目标是不再序列化原始 HTTP Error 消息、堆栈、cause 和附加字段；继续保留请求 ID、方法、响应状态及固定中文成功/失败文案。这不意味着其他任意自定义应用日志都已经接受敏感内容专项评审。

新增 **3 项 Vitest 测试定义**，预计全量单测 **702**、HTTP E2E **63**，**本批当前尚未实测**，需核对本机精确 HEAD 后执行：

```powershell
git rev-parse HEAD

pnpm run test:unit
if ($LASTEXITCODE -ne 0) { throw "D5b8g 单元测试失败" }

pnpm --filter @adui/scada-server run test:e2e
if ($LASTEXITCODE -ne 0) { throw "D5b8g HTTP E2E 失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "D5b8g Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "D5b8g 文档检查失败" }

pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "D5b8g 完整质量链失败" }

Write-Host "D5b8g Windows 离线质量链验收通过" -ForegroundColor Green
```

验收时还应核对 HTTP 503 日志仅包含受控 `err.type`，不再出现 `err.stack` 与原始异常消息；如果未得到此证据，不得声称真实 HTTP 日志已完成脱敏修复。本小批不包含 PostgreSQL、Keycloak/HTTPS 实际会话、工业网关或真正已发布测试夹具；正式发布 `assertReady()` 仍无条件拒绝。Issue #126 Open、ADR-0070 Proposed。

## 2026-11-22 · D5b9a 共享发布 Runtime 错误分类修复：只验新增差异

PR #139 维护者已在**精确 HEAD** `dd0c72ec3ddfebde701c4d8bd4fc811454a193bd` 实测单测 **702/702**、HTTP E2E **63/63**、Vite+ **413 格式/264 零警告错误**、Markdown **90**、完整 `ready` 成功；HTTP 503 失败日志仅 `err.type=HTTP_ERROR`，未出现原始 `err.stack`。该修复已合并为 `main@ba1fa7f896ea57d6dfa9516f645bd460ac7955c0`，不再重复验证。

D5b9a 仅在共享发布 Runtime `failureStatus` 的不可信 `kind` 属性访问处添加异常兜底，并新增 1 项定向 Vitest（原文件 11 → 12 项）：从已校验的发布态刷新遇到抛错 getter，`load` 不再冒泡、旧快照清空、最终状态固定 `error` 且 Tag 质量 `UNAVAILABLE`，不输出异常消息。**本候选测试尚未实际执行**；只针对新变更验收，避免重复跑上批完整安全专项、HTTP E2E、React/Vue 构建或 `ready`。

在本机检出当前 Draft PR 最新 HEAD 后仅需：

```powershell
git rev-parse HEAD

vp test run packages/runtime/test/published-runtime.test.ts
if ($LASTEXITCODE -ne 0) { throw "D5b9a 发布 Runtime 定向测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "D5b9a Vite+ 静态检查失败" }
```

只有这两个命令均成功，才能按新 HEAD 记录 D5b9a 本次修复的验收；并不因此宣称真实 PostgreSQL/Keycloak、双框架发布态浏览器与工业网关已经验收。生产 `ProjectReleaseSafetyGate.assertReady` 保持无条件拒绝，Issue #126 Open、ADR-0070 Proposed。

## 2026-11-22 · D5b9b 发布刷新取消等待：仅针对新增差异验收

上轮 D5b9a PR #140 由维护者 Windows 在精确 HEAD `8071ecdbbfcb5ea1cf20e62772f718f26de27f8d` 实测共享 Runtime **12/12**，`vp check` **413 格式文件、264 受检零警告错误**，据此按明确授权 Squash 合并为 `main@38dea9628c1130f532736ccd76f8d4202d0dfa41`。沿用 PR #139 已验收的完整 `ready` 与 HTTP E2E，不重复运行未改动套件。

本轮 D5b9b 只改共享 `PublishedRuntimeRefresher` 的隐藏/停止**本地等待结算**与定向测试；新用例故意令只读 Reader 永久挂起，断言不需触发超时回调即可在隐藏与停止后结束等待、取消 AbortSignal 并保持旧发布画面清空。变更未运行本机测试，预计目标定向用例由 17 → **18 项**，**不是已通过数量**。

维护者检出本 PR 最新 HEAD 后仅需执行：

```powershell
git rev-parse HEAD

vp test run packages/runtime/test/published-runtime-refresher.test.ts
if ($LASTEXITCODE -ne 0) { throw "D5b9b 发布刷新器定向测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "D5b9b Vite+ 检查失败" }
```

不要重复上批完整 `ready`、HTTP E2E、React/Vue 构建或已验证的发布安全门禁测试。定向测试证明的是**本地生命周期回收**，不能宣称忽略 AbortSignal 的第三方网络操作已经物理取消；真实 OIDC/HTTPS、RELEASED Lab 夹具、工业网关审批和 Tag 质量仍不在本批范围。正式发布默认拒绝，ADR-0070 Proposed，Issue #126 Open。

## 2026-11-22 · D5b9c 已发布多页面只读预览差异验收

D5b9b PR #141 已在维护者 Windows **精确 HEAD `7b8cc314b394d6a850ad5c33b5a7c9e27ecf1c8e`** 实测发布刷新器 **18/18**、`vp check` **413/264 零警告错误**，经授权 Squash 合并为 `main@9bbad56e76ae9a9de83c193950ec29fbd2c13979`。不重复执行已通过、且本批未修改的完整 `ready`、HTTP E2E。

D5b9c 新增已验证静态发布快照按页面 ID 渲染，以及 React/Vue 对等“组态页面”切换。共享单测覆盖真实有效多页面快照、默认首页、指定页面、非法页面拒绝和空 Tag 静态质量；双端从当前 `verified` 快照推导列表，切换不会重新访问发布服务器，失效页面回退新快照首页。**本批新测试与双框架静态检查尚未实测**；无需运行上批完整质量链，仅在 PR 最新 HEAD 做以下定向验收：

```powershell
git rev-parse HEAD

vp test run packages/runtime/test/published-runtime-view.test.ts
if ($LASTEXITCODE -ne 0) { throw "D5b9c 发布多页面预览定向测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "D5b9c Vite+ 检查失败" }
```

预计 `published-runtime-view.test.ts` 由 4 项变为 **5 项**，**不是本轮已通过证据**。真实 React/Vue 多页面已发布现场浏览器专项需要独立合法的 RELEASED 夹具，当前生产门禁无条件拒绝，不能为了演示私自创建夹具、修改数据库或临时开启发布。即使定向单测和静态检查通过，也不能据此声称真实 OIDC/HTTPS 多页面浏览器验收完成。Issue #126 Open，ADR-0070 Proposed。

## 2026-11-22 · D5b9d 共享报警生命周期状态机仅验证新增差异

D5b9c PR #142 维护者在精确 HEAD `36c1ecd6d096e5403559a2f92fa6a50be6b846ba` 实测发布静态 SVG 定向 **5/5** 与 Vite+ **413 格式文件、264 受检零警告错误**，经明确授权合并到 `main@228965e702e372d67737a9866f1af77107b3bc55`。旧批完整 `ready`、NestJS HTTP E2E 和 React/Vue 构建不重复执行。

本轮 D5b9d 为 FR-011 新增纯 Core 状态机及 **8 项**单元测试定义，不涉及真实设备触发、Tag 质量阈值、授权或任何报警确认写入。覆盖四个正式状态、三种纯事件、重复事件幂等、恢复/确认独立性、重触发清除旧确认、无实例及非法输入拒绝。**尚未在维护者 Windows 运行，因此 8 项仅为待验收目标，不是通过证据**。

维护者检出本 PR 的最新 HEAD 后仅执行一次：

```powershell
git rev-parse HEAD

vp test run packages/core/test/alarm-state.test.ts
if ($LASTEXITCODE -ne 0) { throw "FR-011 Core 报警状态机定向测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "FR-011 Vite+ 检查失败" }
```

无需重复上批完整 `pnpm run ready`、HTTP E2E、React/Vue 构建或真实已发布 Lab 浏览器。代码没有真实阈值与工业只读授权，定向单测通过也**不能**把 FR-011 标记为生产报警能力已实现；正式发布 Gate 仍无条件拒绝，Issue #126 Open，ADR-0070 Proposed。

## 2026-11-22 · D5b9e FR-011 报警事件回放：仅新增差异待验收

维护者已在 PR #143 **精确 HEAD `11b8f90689415974a1c74db2d610b471007c4f73`** 实测 Core 四态状态机 8/8，`vp check` **415 格式文件/266 受检零警告错误**；本轮明确授权 Squash 合并至 `main@597a6eabde176f4b5d17dfb7eb685c253c71c2ea`。此结果只属于已验收代码，未重复全量 `ready`。

D5b9e 纯内存 `replayAlarmEvents` 的新增 **5 项** Vitest 用例目前为代码定义，**并未实测**。拟验证空输入、触发→确认→恢复→重触发、有记录但不改变状态的重复事件、非法序列整体拒绝及输入不变。没有 HTTP、Prisma、工业网关、生产报警确认写入或 React/Vue UI 变更。因此仅需在 Draft PR 最新 HEAD 定向执行：

```powershell
git rev-parse HEAD

vp test run packages/core/test/alarm-replay.test.ts
if ($LASTEXITCODE -ne 0) { throw "FR-011 报警事件回放定向测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "FR-011 Vite+ 检查失败" }
```

避免重复执行已通过且无本批变更的完整 `ready`、HTTP E2E、React/Vue 构建或工业专项。定向测试即使通过也只验证纯内存状态回放：不证明报警规则阈值、真实 Tag 质量、持久化审计、操作者授权、时间顺序和工业安全。FR-011 仍规划中，正式发布 Gate 继续无条件拒绝；Issue #126 与 ADR-0070 维持原有独立安全边界。

## 2026-11-22 · D5b9f 数值报警输入质量筛选待 Windows 验收

PR #144 已由维护者在精确 HEAD `3e44212868462bfbc2f86f64d6f973510429ef9f` 实测事件回放 5/5、Vite+ 417/268 零警告错误，授权 Squash 合并至 `main@ed32c0807148cd3370f8213a7f9d113c34f0c81b`。D5b9f 新增数值质量筛选 **5 项测试定义，未实测**。仅修改共享 Core、公共导出、定向测试和文档；没有服务端或双端运行界面修改。请在本批精确 HEAD 执行：

```powershell
git rev-parse HEAD
vp test run packages/core/test/alarm-tag-quality.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警 Tag 质量筛选测试失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
```

有新增自有中文 JSDoc 和异常路径但不新增 throw 文案，需按仓库当前门禁结果补查 `messages:check`。以上定向质量测试不验证可信工业数据源、报警条件、服务端事件持久化和确认权限，不替代生产安全评审；本批不要求重复未改动模块的 HTTP E2E、React/Vue 浏览器与完整 ready。

## 2026-11-22 · D5b9g FR-011 报警时间窗口筛选候选：Windows 待验收

维护者 Windows 在 PR #145 `d41a4859fae150031f8fe96d45fd74c2e23e313e` 验收 5/5、Vite+ 419/270 零警告、文档 90 通过；最终合并源仅有另一次测试断言自动排版，差异已审查但未单独运行 Windows 测试。Squash 合并 `main@cd7b9df5a92c0876bac02a7e7dda1af1c424f9e8`。

D5b9g 新增 **6 项定义，尚未实测**。请在 Draft PR 精确 HEAD 验收：

```powershell
git rev-parse HEAD
vp test run packages/core/test/alarm-tag-freshness.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警时间窗口筛选测试失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批无现场可信时间来源、自动报警、确认 API、报警持久化、工业网关、发布能力或双端业务组件改动；未改动的 HTTP E2E、浏览器专项与完整 ready 不在本轮增量范围。真实工业报警与发布安全仍不得标为通过。

## 2026-11-22 · D5b9h FR-011 同会话报警序列候选待验收

PR #146 的维护者 Windows 实测精确 HEAD `d4d1575e931a40d57a4a9fafe54d12f5c2abefad`：时间窗口单测 6/6，Vite+ 421 格式文件及 272 受检零警告错误，docs:check 90，messages:check 296。Squash 合并后 `main@4729211eb48dd1914a4be9e22e1bae6a5dadcc11`。本次 D5b9h 新增 **6 项测试只是定义，未在 Windows 实测**。

请在 PR 最新精确 HEAD 运行：

```powershell
git rev-parse HEAD
vp test run packages/core/test/alarm-tag-sequence.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警候选序列检查测试失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批无协议接入、服务端采集会话、真实可信时间来源、报警触发/确认、数据库落地或工业设备写入；本地单元测试不意味着工业安全验收。未改动的 HTTP E2E、React/Vue 构建及完整 ready 不重复执行。

## 2026-11-22 · D5b9i FR-011 报警候选会话代次隔离待 Windows 验收

PR #147 在精确 HEAD `c5ed85ffe34503b9c085ffa02c20433bf79c4a28` 的维护者 Windows 定向测试 **6/6**，`vp check` **423/274** 零警告错误，文档 **90**、中文文案 **298**，授权 Squash 合并至 `main@c3444faa00bbb74ffbcb8228e93e1d21cb118126`。本轮 D5b9i **6 项测试仅定义，尚未实测**，在本 PR 最新 HEAD 执行：

```powershell
git rev-parse HEAD
vp test run packages/core/test/alarm-session-generation.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警会话代次隔离定向测试失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批不改既有网络、数据库及 UI，避免重复 HTTP E2E、React/Vue 浏览器测试与完整 ready。测试即使通过也不代表来源认证、服务端会话代次、不可变审计及生产工业安全完成；正式发布安全门禁仍 fail-closed。

## 2026-11-22 · D5b9j FR-011 初始快照基线：Windows 待验收

维护者已在 PR #148 精确 HEAD `c7b63389bc41a61eb5b29dbb85f107cd9ec303e2` 验收 **6/6** 定向测试、`vp check` **425/276** 零警告错误、文档 **90**、中文文案 **300**。PR #148 获授权 Squash 合并至 `main@9d11fedaf044598ccb57b1bc596ac2f3d2668d20`。D5b9j 本批仅有新增 **7 项测试代码定义**，**未执行 Windows 新增测试及完整 Vite+ 检查**。

在 PR 最新精确 HEAD 上执行：

```powershell
git rev-parse HEAD

vp test run packages/core/test/alarm-snapshot-baseline.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警初始快照基线测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批不修改浏览器、HTTP、Prisma、工业网关或数据源适配器，暂不重复无差异的完整 ready 与双端浏览器/E2E。定向测试即使通过，也不能证明上游 `sourceVerified` 真实、会话代次可信或生产报警/审计可用；正式发布 Gate 仍保持 fail-closed。

## 2026-11-22 · D5b9k FR-011 同会话增量基线：Windows 待验收

维护者 Windows 提供 PR #149 新增快照基线单测 **7/7**、`vp check` **427 格式文件/278 受检零警告错误**、`docs:check` **90 份**、`messages:check` **302 个自有文件**。PR #149 已经明确授权 Squash 合并至 `main@f5fdc99a8247299aa76f77005594788c916f1ac4`，合并前一笔额外提交只调整单测格式，无业务变化。

D5b9k 新增的 **9 项测试仅为代码定义，尚未 Windows 实测**。维护者可先按既定流程运行 `vp check --fix` 并提交必要格式改动，不要求固定或核对 HEAD；然后在当前 PR 分支执行：

```powershell
vp test run packages/core/test/alarm-tag-delta.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警增量基线测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

仅新增共享 Core 增量纯函数、定向单测、公共导出和对应文档；未修改 HTTP、双框架组件、Prisma 或工业采集，避免重复完整 ready / HTTP E2E / 双端浏览器专项。此测试不能证明 `sourceVerified` 的真实性，`DELTA_REJECTED` 及抛错后的基线废弃由未来上游实现；生产工业报警与发布许可仍未通过验收。

## 2026-11-23 · D5b9l FR-011 报警候选基线会话生命周期：Windows 待验收

PR #150 维护者 Windows 定向测试 **9/9**、`vp check` **429 格式文件/280 受检零警告错误**、`docs:check` **90 份**、`messages:check` **304 份**；经明确授权，Squash 合并至 `main@83cf07da36ced869a26f6ebbdb1b992a6cad92f7`。D5b9l 新增 **11 项测试定义，尚未在 Windows 执行**。

维护者可以先运行 `vp check --fix`，如有格式修改可正常提交；不要求手动检查或锁定 HEAD。在本批功能分支执行：

```powershell
vp test run packages/core/test/alarm-baseline-session.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警基线会话归约测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批仅修改共享 Core、定向测试、公共导出和文档，未涉及 HTTP、数据库、双端 UI 或协议适配，故不重复未改动模块的完整 ready 与浏览器专项。归约器返回基线清空结果不代表外部调用方已经安装/应用它；来源可信性、会话管理、工业报警与正式发布安全仍未验收。

## 2026-11-23 · D5b9m FR-011 会话回调令牌与本地状态托管待 Windows 验收

PR #151 维护者 Windows 对新增会话归约单测 **11/11**、`vp check` **431 格式/282 受检零警告错误**、文档 **90**、中文文案 **306** 均实测通过，经明确授权 Squash 合并至 `main@1c27139a205f8074beb83f64ea5b473457dc9c71`。本批 D5b9m 新增 **9 项单测为定义，尚未在 Windows 实测**。

维护者可以先执行 `vp check --fix`，正常提交所需格式化差异，不要求核对 HEAD。在当前 PR 功能分支执行：

```powershell
vp test run packages/core/test/alarm-session-controller.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警会话托管器定向测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批只增加 Core 同步状态托管、定向测试、公共导出及文档，无 HTTP、真实网络连接、自动定时器、Prisma、Vue/React 或工业网关改动。无需重复未改动模块的完整 ready、HTTP E2E 和双框架浏览器专项。令牌引用检查不是安全认证；没有可信时钟定期调用，已持有的 GOOD 基线不会自行超时；真实工业报警、审计和生产发布门禁不在本轮验收范围。

## 2026-11-23 · D5b9n FR-011 报警订阅适配与时效检查：Windows 待验收

维护者已在 PR #152 Windows 实测本地会话托管器定向单测 **9/9**、`vp check` **433 文件格式正确 / 284 受检零警告错误**、`docs:check` **90 份**、`messages:check` **308 文件**。PR #152 已获授权 Squash 合并至 `main@ae0ed62b9fab5cf2f91a1999bd26603f778d64f0`。本批 D5b9n **13 项测试仅为代码定义，尚未在维护者 Windows 实测**。

维护者可按既定流程先运行 `vp check --fix` 并提交自动格式化差异，不要求手动核对或固定 HEAD；然后在当前 PR 功能分支执行：

```powershell
vp test run packages/core/test/alarm-subscription-adapter.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警只读订阅适配测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批代码位于 Core 注入适配层，无真实网络/数据库/双框架页面或设备驱动变更，故不重复完整 ready、HTTP E2E 和 React/Vue 浏览器专项；适配器只演示外部回调与调度契约。单测通过也不代表调度实际间隔、系统时间可靠、来源核验真实或工业报警安全可用；正式发布安全 Gate 保持 fail-closed。

## 2026-11-23 · D5b9o FR-011 订阅资源取消重入保护：Windows 待验收

PR #153 维护者 Windows 已实际通过新增订阅适配单测 **13/13**、`vp check` **435 格式文件/286 受检零警告错误**、`docs:check` **90**、`messages:check` **310**；经明确同意，Squash 合并到 `main@7d82b3d2889db16c4b8423cd140e09e180d40bf0`。本批 D5b9o 在此基础上修改现有适配器及其定向测试，**新增 4 项、当前文件合计 17 项，仅为定义，尚无 Windows 实测**。

先更新远程分支并切换到本批分支，再按维护者习惯运行 `vp check --fix`；若有变更，可正常提交。无需手动核对 HEAD。随后执行：

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "获取远程代码失败" }

git switch fix/d5b9o-alarm-adapter-reentrant-cleanup
if ($LASTEXITCODE -ne 0) {
    git switch --track origin/fix/d5b9o-alarm-adapter-reentrant-cleanup
}
if ($LASTEXITCODE -ne 0) { throw "切换验收分支失败" }

vp check --fix
if ($LASTEXITCODE -ne 0) { throw "Vite+ 自动修正失败" }

vp test run packages/core/test/alarm-subscription-adapter.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警订阅资源重入保护测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

此次仅改适配器资源清理顺序、旧代次回调保护、测试和文档，没有真实网络协议、HTTP、UI、数据库或工业网关变更；定向检查不替代完整生产安全验收。外部取消函数一旦抛错，仅能确认其已尝试调用，**不能宣称真实资源肯定已释放**。正式发布安全 Gate 仍 fail-closed。

## 2026-11-23 · D5b9o PR #154 条件式断言警告修复待复验

维护者 Windows 在本批运行 `vp check --fix`，报告 `packages/core/test/alarm-subscription-adapter.test.ts:280` 的 `vitest(no-conditional-expect)` **1 条警告、0 个错误**，且显示格式化完成。此输出**不是** `vp check` 零警告通过。现已按 E-003/E-086 将条件中的断言改为仅记录布尔结果，在 `adapter.stop()` 后统一执行断言；不改变实际重入场景和业务代码。该改动**尚未在 Windows 执行或复验**。请在本 PR 分支更新后重新运行定向测试及 `vp check`、`docs:check`、`messages:check`，核对退出码。

## 2026-11-23 · D5b9p FR-011 报警订阅异常原因保留：Windows 待验收

PR #154 已获维护者授权合并：Windows 定向单测 **17/17**、`vp check` **435 格式文件/286 受检零警告错误**、`docs:check` **90 份**、`messages:check` **310 份**；此前 `no-conditional-expect` 警告已复验消除。Squash 进入 `main@255c5a2ec3b88f0dd4dc54894cb6c03dda0aca6d`。本批 D5b9p 更新错误传播逻辑、增加 **3 项单测定义（本文件共 20 项）**，未执行新批 Windows 代码验证。

维护者先获取远程代码、切换功能分支；按既定习惯可运行 `vp check --fix` 并提交实际格式差异，不要求核对 HEAD，然后执行：

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "获取远程代码失败" }

git switch fix/d5b9p-alarm-cleanup-error-reporting
if ($LASTEXITCODE -ne 0) {
    git switch --track origin/fix/d5b9p-alarm-cleanup-error-reporting
}
if ($LASTEXITCODE -ne 0) { throw "切换功能分支失败" }

git pull --ff-only origin fix/d5b9p-alarm-cleanup-error-reporting
if ($LASTEXITCODE -ne 0) { throw "更新功能分支失败" }

vp check --fix
if ($LASTEXITCODE -ne 0) { throw "自动修正失败" }

vp test run packages/core/test/alarm-subscription-adapter.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警订阅异常保留定向测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批仅修改框架无关 Core 适配器及其测试和文档，暂不重复无改动的 HTTP E2E、完整 ready 和双框架浏览器专项。异常保留只用于受控诊断，不证明取消函数实际成功释放资源，更不能当作设备来源身份认证或工业报警安全验收；正式发布 Gate 保持 fail-closed。

## 2026-11-23 · D5b9q FR-011 读取时效防护：Windows 待验收

PR #155 维护者 Windows 实测报警订阅异常保留 **20/20**、`vp check` **435 格式文件/286 受检零警告错误**、`docs:check` **90 份**、`messages:check` **310 个自有文件**；经明确授权 Squash 合并至 `main@bec400c3cb8ad8cef22416712eaaf481e1e9105d`。本批 D5b9q 新增 **4 项测试代码定义（同文件合计 24 项）**，**尚未执行本批 Windows 验收**。

请先获取远程分支并切换。可按维护者工作流执行 `vp check --fix`，必要时正常提交格式化差异，不要求手动核对 HEAD：

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "获取远程代码失败" }

git switch fix/d5b9q-alarm-snapshot-read-freshness
if ($LASTEXITCODE -ne 0) {
    git switch --track origin/fix/d5b9q-alarm-snapshot-read-freshness
}
if ($LASTEXITCODE -ne 0) { throw "切换功能分支失败" }

git pull --ff-only origin fix/d5b9q-alarm-snapshot-read-freshness
if ($LASTEXITCODE -ne 0) { throw "更新功能分支失败" }

vp check --fix
if ($LASTEXITCODE -ne 0) { throw "Vite+ 自动修正失败" }

vp test run packages/core/test/alarm-subscription-adapter.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警候选读取时效测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批仅调整共享 Core 订阅适配器的状态读取路径、定向测试和文档，没有 HTTP、真实采集、数据库或双端 UI 修改，暂不重复无变更的完整 ready 与浏览器 E2E。读取快照触发过期时可以停止订阅；外部消费者不得缓存旧值宣称仍为可信报警候选。时钟正确性、真实周期调度、可信来源核验和 FR-011 工业安全验收均尚未完成，发布 Gate 仍 fail-closed。

## 2026-11-23 · D5b9r FR-011 旧基线超龄续接阻断：Windows 待验收

PR #156 已经维护者 Windows 实测：订阅适配单测 **24/24**，`vp check` **435 格式文件/286 受检零警告错误**，`docs:check` **90 份**、`messages:check` **310 份**；按维护者明确授权 Squash 合并至 `main@fe02273d38d3291c2483061dbe8990b6024deff0`。本批 D5b9r 在此基础上新增 **6 项测试定义**，会话归约器 **16 项**、订阅适配器 **25 项**，**尚无 Windows 实测记录**。

保留维护者要求的 `git fetch origin` 和 `git switch`；可以在分支上先运行 `vp check --fix`，必要时提交格式变更，不要求核对 HEAD。后续验收：

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "获取远程代码失败" }

git switch fix/d5b9r-alarm-stale-baseline-delta
if ($LASTEXITCODE -ne 0) {
    git switch --track origin/fix/d5b9r-alarm-stale-baseline-delta
}
if ($LASTEXITCODE -ne 0) { throw "切换功能分支失败" }

git pull --ff-only origin fix/d5b9r-alarm-stale-baseline-delta
if ($LASTEXITCODE -ne 0) { throw "更新功能分支失败" }

vp check --fix
if ($LASTEXITCODE -ne 0) { throw "Vite+ 自动修正失败" }

vp test run packages/core/test/alarm-baseline-session.test.ts packages/core/test/alarm-subscription-adapter.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警基线与订阅适配定向测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批只修改共享 Core 会话归约器及定向测试与文档，不涉及 HTTP、Vue/React 页面、Prisma 或工业设备接入；不重复完整 ready 与浏览器专项。静态代码检查不能证明时钟可信、订阅调度有效、来源确实核验或 FR-011 生产报警安全。正式发布 Gate 保持 fail-closed。

## 2026-11-23 · D5b9s FR-011 底层报警增量旧基线时效：Windows 待验收

PR #157 维护者 Windows 已执行 `alarm-baseline-session.test.ts` **16/16**、`alarm-subscription-adapter.test.ts` **25/25**（合计 **41/41**），`vp check` **435 格式文件/286 受检零警告错误**、`docs:check` **90**、`messages:check` **310**；维护者明确授权后 Squash 合并至 `main@54cec31bd1e7a6c1ae0d1e1a0b3d2a128515e845`。D5b9s 本批新增 **6 项测试定义**，`alarm-tag-delta.test.ts` 共 **15 项**，尚未进行本批 Windows 实测。

维护者流程保留 `git fetch origin` 与 `git switch`，首次切换支持 `--track`，执行 `vp check --fix` 后可以提交必要格式修正；不要求手动核对 HEAD：

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "获取远程代码失败" }

git switch fix/d5b9s-alarm-direct-delta-freshness
if ($LASTEXITCODE -ne 0) {
    git switch --track origin/fix/d5b9s-alarm-direct-delta-freshness
}
if ($LASTEXITCODE -ne 0) { throw "切换功能分支失败" }

git pull --ff-only origin fix/d5b9s-alarm-direct-delta-freshness
if ($LASTEXITCODE -ne 0) { throw "更新功能分支失败" }

vp check --fix
if ($LASTEXITCODE -ne 0) { throw "自动修正失败" }

vp test run packages/core/test/alarm-tag-delta.test.ts packages/core/test/alarm-baseline-session.test.ts packages/core/test/alarm-subscription-adapter.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警增量与会话回归测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批只改共享 Core 的底层增量 API 和对应单测、文档，未增加 UI、服务端接口、数据库或工业网关变动。上述检查不代表来源认证、可信时间、真实调度、报警阈值、确认授权或生产安全验收通过；发布 Gate 仍 fail-closed。

## 2026-11-23 · D5b9t FR-011 重复 snapshot 序列重置保护：Windows 待验收

PR #158 已由维护者 Windows 实测三份测试文件 **56/56**、`vp check` **435 格式文件/286 受检零警告错误**、`docs:check` **90**、`messages:check` **310**；经明确授权 Squash 合并至 `main@ac39b5876fa2f255d993b0e8665cad51fe675bff`。本批 D5b9t 仅新增 **5 项测试代码定义**，会话归约器 **18 项**、托管器 **10 项**、订阅适配器 **27 项**，**当前尚未 Windows 实测**。

保留维护者要求的 `git fetch origin` 和 `git switch`；首次切换可用 `--track`，执行 `vp check --fix` 后可正常提交所需的格式化差异，不要求核对 HEAD。请执行：

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "获取远程代码失败" }

git switch fix/d5b9t-alarm-duplicate-snapshot
if ($LASTEXITCODE -ne 0) {
    git switch --track origin/fix/d5b9t-alarm-duplicate-snapshot
}
if ($LASTEXITCODE -ne 0) { throw "切换功能分支失败" }

git pull --ff-only origin fix/d5b9t-alarm-duplicate-snapshot
if ($LASTEXITCODE -ne 0) { throw "更新功能分支失败" }

vp check --fix
if ($LASTEXITCODE -ne 0) { throw "Vite+ 自动修正失败" }

vp test run packages/core/test/alarm-baseline-session.test.ts packages/core/test/alarm-session-controller.test.ts packages/core/test/alarm-subscription-adapter.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警快照会话回归测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批没有 HTTP、Prisma、Vue/React 或真实工业采集变动，不重复此前未改模块的完整 ready 与浏览器专项。重复快照在托管器中使会话失效、订阅适配器清理资源，不代表外部取消函数真实完成释放；上游来源与时间仍待认证，正式发布 Gate 继续 fail-closed。

## 2026-11-23 · D5b9t PR #159 Windows 首轮 54/55 与断言修正

维护者 Windows 执行三份 Core 定向测试：alarm-baseline-session.test.ts **17/18**、alarm-session-controller.test.ts **10/10**、alarm-subscription-adapter.test.ts **27/27**；合计 **54/55**，Vitest 命令失败，PowerShell 中断正常触发。尚无本轮 vp check、docs:check 与 messages:check 结果。

唯一失败来自已有基线的第二份坏质量 snapshot：测试期望 QUALITY_NOT_GOOD，新安全契约先返回 SNAPSHOT_ALREADY_ESTABLISHED 并清空基线。E-092 最小修复仅调整旧测试，保留未核验来源拒绝，验证重复坏质量快照先按重复初始化拒绝，并独立验证首次坏质量快照仍按质量拒绝。生产归约器及现有测试数量不变。

**修复后待 Windows 验收**：三份定向 Vitest 目标 55/55、vp check 零警告、pnpm run docs:check、pnpm run messages:check。没有修复后实际退出码，不能声称已通过；PR #159 保持 Draft，不提前合并。不涉及 NestJS、Prisma、Vue/React、设备采集或正式发布门禁。

## 2026-11-23 · PR #159 Windows 复验通过与 D5b9u 待验收

维护者本机 Windows 对 PR #159 的会话归约器 **18/18**、托管器 **10/10**、订阅适配器 **27/27**，合计 **55/55**，`vp check` **435 格式文件/286 受检零警告错误**、`pnpm run docs:check` **90 份**、`pnpm run messages:check` **310 个文件**。原 54/55 是修复前 E-092 历史日志，已以本次实际回归关闭；GitHub 按明确授权 Squash 合并 PR #159 至 `main@8cbd1d721f8e2a2c7b83733ff64bdb88b28d0dd6`，并再次确认 merged。该日志未附维护者本机 HEAD，不冒充对具体 SHA 的逐字本机复验，亦不等于完整 ready 或现场工业安全验收。

D5b9u 仅在共享 Core 添加失效态终止标记与固定拒绝结果，更新纯归约器既有测试及托管器一项对象断言；新增三项测试定义后目标 **21+10+27=58** 项。失效前首次正常 snapshot 和递增 delta 的契约不变，失效后的同代次重建路径改为拒绝，必须显式递增代次。**D5b9u 尚无 Windows 实测结果**。

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "获取远程代码失败" }

git switch fix/d5b9u-alarm-invalidated-session
if ($LASTEXITCODE -ne 0) {
    git switch --track origin/fix/d5b9u-alarm-invalidated-session
}
if ($LASTEXITCODE -ne 0) { throw "切换分支失败" }

git pull --ff-only origin fix/d5b9u-alarm-invalidated-session
if ($LASTEXITCODE -ne 0) { throw "更新功能分支失败" }

vp check --fix
if ($LASTEXITCODE -ne 0) { throw "自动修正失败" }

vp test run packages/core/test/alarm-baseline-session.test.ts packages/core/test/alarm-session-controller.test.ts packages/core/test/alarm-subscription-adapter.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警会话定向测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批未更改 HTTP、Prisma、Vue/React、真实协议或工业设备写入，当前只要求上述 Core 定向与静态门禁；如出现关联回归失败需扩大覆盖，不把未运行的全量 ready 或浏览器专项算作通过。PR 默认保持 Draft，必须经维护者新一轮验收并明确授权才能合并。

## 2026-11-23 · D5b9u PR #160 Windows 通过合并与 D5b9v 待验收

维护者提供 PR #160 Windows 定向结果：`alarm-baseline-session.test.ts` **21/21**、`alarm-session-controller.test.ts` **10/10**、`alarm-subscription-adapter.test.ts` **27/27**，合计 **58/58**；`vp check` **435 个格式文件 / 286 个受检文件零警告错误**；文档检查 **90**、中文文案 **310**。GitHub 合并前核对 `f8a5818` 仅有测试排版提交、无未解决审查意见与冲突；按维护者授权 Squash 合并 PR #160 至 `main@8f09f296fc5c3fc5df1c6633939ce80414e137f8`。Windows 日志未打印本机 HEAD，不把它编造为该提交的直接本机复验；没有完整 ready 及工业现场安全验收。

D5b9v 为底层序列函数补充先前基线复查，修正两份旧夹具并新增 **4 项测试定义**。当前仅静态核对 GitHub 差异，没有 D5b9v Windows 运行记录。验收覆盖序列 **9**、代次 **7**、低层增量 **15**、会话归约器 **21**、托管器 **10**、适配器 **27**，总计目标 **89** 项。

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "获取远程代码失败" }

git switch fix/d5b9v-alarm-ordered-baseline-freshness
if ($LASTEXITCODE -ne 0) {
    git switch --track origin/fix/d5b9v-alarm-ordered-baseline-freshness
}
if ($LASTEXITCODE -ne 0) { throw "切换功能分支失败" }

git pull --ff-only origin fix/d5b9v-alarm-ordered-baseline-freshness
if ($LASTEXITCODE -ne 0) { throw "更新功能分支失败" }

vp check --fix
if ($LASTEXITCODE -ne 0) { throw "Vite+ 自动修正失败" }

vp test run packages/core/test/alarm-tag-sequence.test.ts packages/core/test/alarm-session-generation.test.ts packages/core/test/alarm-tag-delta.test.ts packages/core/test/alarm-baseline-session.test.ts packages/core/test/alarm-session-controller.test.ts packages/core/test/alarm-subscription-adapter.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警旧基线质量时效回归失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批不需要真实 PostgreSQL、工业协议或浏览器写入；所有这些系统保持不变。当前仓库依赖未在协作环境完整安装，未执行本批 `vp` 或完整 `ready`，不得把预期 89/89 冒充验收通过。新的 Draft PR 须经维护者独立验收并另行授权后才允许 Squash 合并。

## 2026-11-23 · D5b9v PR #161 复验合并与 D5b9w 待验收

维护者 Windows 已运行 PR #161 六份定向测试：低层序列 **9/9**、会话代次 **7/7**、底层增量 **15/15**、纯会话归约 **21/21**、托管器 **10/10**、订阅适配器 **27/27**，合计 **89/89**；`vp check` **435 文件格式正确 / 286 文件受检零警告错误**、`docs:check` **90 份**、`messages:check` **310 个文件**。GitHub 复核原 PR HEAD `489cb9d101988519c0e75bf5570d4e73343fda7f`、8 个文件和零未解决审查意见后，在明确授权下 Squash 合并至 `main@0db4b4f48511a5d6d6e7606586a16f12c6500088`。用户 Windows 日志无本地 HEAD 输出，不将其误写为本机 SHA 核验结果；未执行完整 `ready`、数据库及工业现场认证。

D5b9w 新增低层有序数值候选的 `SERVER_TIMESTAMP_REGRESSED` 拒绝状态。五项测试定义分别验证低层、同代次包装、直接增量、纯会话归约和适配器失效。原有测试不删除，关联测试目标：序列 **10**、会话代次 **8**、底层增量 **16**、会话归约 **22**、托管器 **10**、适配器 **28**，合计 **94** 项。尚无该新分支 Windows 原生运行结果。

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "获取远程代码失败" }

git switch fix/d5b9w-alarm-server-timestamp-regression
if ($LASTEXITCODE -ne 0) {
    git switch --track origin/fix/d5b9w-alarm-server-timestamp-regression
}
if ($LASTEXITCODE -ne 0) { throw "切换功能分支失败" }

git pull --ff-only origin fix/d5b9w-alarm-server-timestamp-regression
if ($LASTEXITCODE -ne 0) { throw "更新功能分支失败" }

vp check --fix
if ($LASTEXITCODE -ne 0) { throw "自动修正失败" }

vp test run packages/core/test/alarm-tag-sequence.test.ts packages/core/test/alarm-session-generation.test.ts packages/core/test/alarm-tag-delta.test.ts packages/core/test/alarm-baseline-session.test.ts packages/core/test/alarm-session-controller.test.ts packages/core/test/alarm-subscription-adapter.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警候选服务端时间顺序回归失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

这批只修改 Core 和文档，不涉及网络协议、数据库迁移、UI 或设备写入；暂不把 full ready、现场采集、报警触发与发布 Gate 视为已验收。协作容器无法解析 GitHub 域名，且没有 pnpm/vp 命令，无法在当前容器运行仓库真实质量链；目标 **94/94** 是待 Windows 执行的验收值。PR 默认 Draft，须经维护者另行授权才能合并。

## 2026-11-23 · D5b9w PR #162 Windows 通过合并及 D5b9x 待验收

维护者 Windows 已对 PR #162 六份共享 Core 定向测试 **94/94** 通过：低层序列 10、会话代次 8、增量 16、纯会话归约 22、托管器 10、订阅适配器 28；`vp check` **435 个格式文件/286 个受检零警告错误**、`docs:check` **90 份**、`messages:check` **310 个文件**。GitHub 在明确授权下按 HEAD `37a3e5a12521ad52105d0136b7a72edd27cfa29e` Squash 合并 PR #162 至 `main@fd783df24b3748870c4a4b3825886cfb560f7152`。用户日志无本机 HEAD，不冒充合并 SHA 的本机实测，也不把该定向验证视为完整 ready 或工业现场安全认证。

D5b9x 仅新增等待首次快照时显式 `CHECK_FRESHNESS` 的时钟及最大年龄参数校验，任何非法输入都通过已有拒绝结果终止代次。原有正常等待、其他代次忽略、断连时无时钟依赖和无基线被动 `snapshot()` 不读时钟契约保持。新定义三项回归：纯归约器 22→23，托管器 10→11，订阅适配器 28→29；其余低层序列 10、代次包装 8、直接增量 16 不变，六份关联回归目标 **97**。D5b9x 尚未得到 Windows 实测结果。

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "获取远程代码失败" }

git switch fix/d5b9x-alarm-pending-freshness-invalid-clock
if ($LASTEXITCODE -ne 0) {
    git switch --track origin/fix/d5b9x-alarm-pending-freshness-invalid-clock
}
if ($LASTEXITCODE -ne 0) { throw "切换功能分支失败" }

git pull --ff-only origin fix/d5b9x-alarm-pending-freshness-invalid-clock
if ($LASTEXITCODE -ne 0) { throw "更新功能分支失败" }

vp check --fix
if ($LASTEXITCODE -ne 0) { throw "自动修正失败" }

vp test run packages/core/test/alarm-tag-sequence.test.ts packages/core/test/alarm-session-generation.test.ts packages/core/test/alarm-tag-delta.test.ts packages/core/test/alarm-baseline-session.test.ts packages/core/test/alarm-session-controller.test.ts packages/core/test/alarm-subscription-adapter.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警等待快照参数安全回归失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批未执行任何数据库迁移、真实工业网关或设备写入。协作端尚未运行项目完整 `vp`/Vitest 或 `ready`，目标 **97/97** 只是计划值；在维护者 Windows 实测与新一轮明确授权前，Draft PR 不得合并。

## 2026-11-23 · D5b9x PR #163 复验合并与 D5b9y 待验收

维护者 Windows 已对 PR #163 六份共享 Core 定向测试实测 **97/97**：序列10、代次8、增量16、纯归约23、托管11、适配29；`vp check` **435 个文件格式正确/286 个受检零警告错误**、`docs:check` **90 份**、`messages:check` **310 个文件**。GitHub 复核最新 HEAD `9364ae11753ba22d642221f27249bf411fc623ec` 的额外差异仅是测试排版，无未解决审查意见，按明确授权 Squash 合并至 `main@2a0834c454e332ae2d9182748503f95039822091`。用户本机日志未打印 HEAD，因此不冒充对该具体合并 SHA 的本地复验；定向质量通过不等于完整 ready 和工业现场安全认证。

D5b9y 只在共享会话归约器明确执行 `CHECK_FRESHNESS` 且已有基线时增加代次和目标 Tag 归属校验，不一致通过既有原因拒绝并冻结终止态。新增两项测试定义：归约器 23→25；序列10、代次8、增量16、托管11、适配29 不变，六份回归目标 **99**。没有实际 D5b9y Windows 测试结果。

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "获取远程代码失败" }

git switch fix/d5b9y-alarm-freshness-baseline-identity
if ($LASTEXITCODE -ne 0) {
    git switch --track origin/fix/d5b9y-alarm-freshness-baseline-identity
}
if ($LASTEXITCODE -ne 0) { throw "切换功能分支失败" }

git pull --ff-only origin fix/d5b9y-alarm-freshness-baseline-identity
if ($LASTEXITCODE -ne 0) { throw "更新功能分支失败" }

vp check --fix
if ($LASTEXITCODE -ne 0) { throw "自动修正失败" }

vp test run packages/core/test/alarm-tag-sequence.test.ts packages/core/test/alarm-session-generation.test.ts packages/core/test/alarm-tag-delta.test.ts packages/core/test/alarm-baseline-session.test.ts packages/core/test/alarm-session-controller.test.ts packages/core/test/alarm-subscription-adapter.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警时效基线归属回归测试失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

未修改 NestJS、Prisma、工业网关、React/Vue、真实 PLC/DCS 或设备写入。当前仅完成远程静态代码检查，D5b9y 的 99/99 与四项质量门禁仍待维护者 Windows 执行；正式发布 Gate 持续 fail-closed。

## 2026-11-23 · D5b9y PR #164 Windows 通过合并与 D5b9z 待验收

维护者 Windows 已执行 PR #164 六份共享 Core 定向测试：序列 **10/10**、会话代次 **8/8**、增量 **16/16**、纯归约 **25/25**、托管 **11/11**、适配 **29/29**，共 **99/99**；`vp check` **435 文件格式正确/286 文件受检零警告错误**，`docs:check` **90 份**，`messages:check` **310 个文件**。GitHub 最终 HEAD `b87985092b60e45623ebcecf1c411526591b29fc` 的附加提交仅为一处测试排版，按维护者授权 Squash 合并至 `main@e8d36863b4887ad151f9e41affed4042556a02a0`。维护者日志未打印本机 HEAD，不宣称该合并 SHA 已被直接实测；这些检查不是完整 ready 或真实现场安全认证。

D5b9z 仅对公共纯归约器的 `invalidated: true` 且仍有非空旧基线的矛盾状态进行入口清理，同代次和旧代次都不得借返回状态继续暴露旧候选值。正常已失效状态仍保留原对象引用，其他路径不变。新增两项纯归约器测试定义，六份关联测试预计：低层序列 **10**、代次 **8**、增量 **16**、会话归约 **27**、托管 **11**、适配 **29**，总计 **101**。该分支目前只完成 GitHub 静态核对，尚无 Windows 实测。

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "获取远程代码失败" }

git switch fix/d5b9z-alarm-invalidated-state-leak
if ($LASTEXITCODE -ne 0) {
    git switch --track origin/fix/d5b9z-alarm-invalidated-state-leak
}
if ($LASTEXITCODE -ne 0) { throw "切换功能分支失败" }

git pull --ff-only origin fix/d5b9z-alarm-invalidated-state-leak
if ($LASTEXITCODE -ne 0) { throw "更新功能分支失败" }

vp check --fix
if ($LASTEXITCODE -ne 0) { throw "Vite+ 自动格式化失败" }

vp test run packages/core/test/alarm-tag-sequence.test.ts packages/core/test/alarm-session-generation.test.ts packages/core/test/alarm-tag-delta.test.ts packages/core/test/alarm-baseline-session.test.ts packages/core/test/alarm-session-controller.test.ts packages/core/test/alarm-subscription-adapter.test.ts
if ($LASTEXITCODE -ne 0) { throw "矛盾终止态与报警候选安全回归失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批未修改真实设备通信、NestJS、Prisma、Vue/React、报警触发/确认、不可变审计或发布安全 Gate。当前 **101/101** 是新增定义后的验收目标，未经维护者 Windows 运行不能声称通过。PR 保持 Draft，需另一次明确合并授权。

## 2026-11-23 · D5b9z PR #165 Windows 通过合并与 D5c0a 待验收

维护者 Windows 已对 PR #165 六份共享 Core 定向测试运行：低层序列 **10/10**、代次 **8/8**、直接增量 **16/16**、会话归约 **27/27**、托管 **11/11**、适配 **29/29**，合计 **101/101**；`vp check` **435 个格式文件/286 个受检零警告错误**；`docs:check` **90 份**、`messages:check` **310 个自有文件**通过。GitHub 锁定 HEAD `c5b1a78c4879cbafbda7761a5e1c75640aa6dc1a` 按本轮授权 Squash 合并至 `main@25a468aa7fc45e0a09712c9295bebb04f6618459`。用户本机日志没有 HEAD，不能宣称在合并 SHA 上直接跑完本地质量链；定向验证不代表完整 ready、真实来源认证或工业现场安全。

D5c0a 只增强报警候选层的服务器时间格式约束：GOOD 数值候选必须有明确 `Z` 或 `±HH:mm` 的时区；无时区字符串不能因宿主 `Date.parse` 本地解释而被接收，`sourceTimestamp` 与通用 TagStore 的历史兼容性保持不变。上层现有 TypeError 映射为本代次 `INVALID_INPUT` 并撤销回调；没有接口/数据库/双框架改动。新测试定义包括时效筛选 7、初始快照 8、低层序列 10、代次包装 8、直接增量 17、会话归约 28、托管 11、订阅适配 30，八份回归目标 **119 项**，尚无 D5c0a Windows 实测。

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "获取远程代码失败" }

git switch fix/d5c0a-alarm-explicit-server-timezone
if ($LASTEXITCODE -ne 0) {
    git switch --track origin/fix/d5c0a-alarm-explicit-server-timezone
}
if ($LASTEXITCODE -ne 0) { throw "切换功能分支失败" }

git pull --ff-only origin fix/d5c0a-alarm-explicit-server-timezone
if ($LASTEXITCODE -ne 0) { throw "更新功能分支失败" }

vp check --fix
if ($LASTEXITCODE -ne 0) { throw "Vite+ 自动格式化失败" }

vp test run packages/core/test/alarm-tag-freshness.test.ts packages/core/test/alarm-snapshot-baseline.test.ts packages/core/test/alarm-tag-sequence.test.ts packages/core/test/alarm-session-generation.test.ts packages/core/test/alarm-tag-delta.test.ts packages/core/test/alarm-baseline-session.test.ts packages/core/test/alarm-session-controller.test.ts packages/core/test/alarm-subscription-adapter.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警候选服务器时区回归失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批未改变数据库、真实设备协议、NestJS、Vue/React 或工业写入。当前协作端没有执行 D5c0a 的原生 Vite+/Vitest，**119/119 为预计验收目标**，只有维护者 Windows 运行记录才能将其标记为通过。Draft PR 须另行验收和授权后才能合并。

## 2026-11-23 · D5c0a PR #166 Windows 通过合并与 D5c0b 待验收

维护者 Windows 已实测 PR #166 八份共享 Core 定向测试：时效 **7/7**、快照 **8/8**、序列 **10/10**、代次 **8/8**、增量 **17/17**、归约 **28/28**、托管 **11/11**、适配 **30/30**，合计 **119/119**；`vp check` **435 个格式文件正确/286 个受检零警告错误**，文档 **90** 份及中文文案 **310** 个文件通过。GitHub 最终 HEAD `319e424005cf0bb6a6c77f74037e85f5a93f8678` 额外提交仅格式化测试数组，经维护者明确授权 Squash 合并至 `main@abc6c0913c1510da0797c2a6dd9acd6761c9370c`。用户本机日志没有 HEAD，不把合并 SHA 冒充为本机精确实测，也不能将定向测试等同完整 ready 或工业安全专项。

D5c0b 新增报警候选日期实际存在性检查，避免 `2026-02-30` 等不存在的日期被 `Date.parse` 归一化后当作新鲜采集值。通用 TagStore、已有 UTC/偏移时间和质量/时效顺序不变。五项新增测试使八份回归定义目标成为：时效 **8**、快照 **9**、序列 **10**、代次 **8**、增量 **18**、归约 **29**、托管 **11**、适配 **31**，合计 **124 项**。**D5c0b 尚无 Windows 实测**；仅独立 Node 22 复现了隐式日期滚动并验证 7 个日历样例。

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "获取远程代码失败" }

git switch fix/d5c0b-alarm-invalid-calendar-date
if ($LASTEXITCODE -ne 0) {
    git switch --track origin/fix/d5c0b-alarm-invalid-calendar-date
}
if ($LASTEXITCODE -ne 0) { throw "切换功能分支失败" }

git pull --ff-only origin fix/d5c0b-alarm-invalid-calendar-date
if ($LASTEXITCODE -ne 0) { throw "更新功能分支失败" }

vp check --fix
if ($LASTEXITCODE -ne 0) { throw "Vite+ 自动修正失败" }

vp test run packages/core/test/alarm-tag-freshness.test.ts packages/core/test/alarm-snapshot-baseline.test.ts packages/core/test/alarm-tag-sequence.test.ts packages/core/test/alarm-session-generation.test.ts packages/core/test/alarm-tag-delta.test.ts packages/core/test/alarm-baseline-session.test.ts packages/core/test/alarm-session-controller.test.ts packages/core/test/alarm-subscription-adapter.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警候选公历日期有效性回归失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批未新增 HTTP、数据库迁移、工业网关、双框架页面或设备写入；正式报警触发、确认授权与不可变审计仍未交付。D5c0b 的 **124/124** 仅为测试定义的验收目标，必须取得 Windows 实际结果后才能按新授权合并。

## 2026-11-23 · D5c0b PR #167 Windows 通过合并与 D5c0c 待验收

维护者 Windows 对 PR #167 八份定向测试实测：时效 **8/8**、快照 **9/9**、序列 **10/10**、会话代次 **8/8**、增量 **18/18**、会话归约 **29/29**、托管 **11/11**、适配 **31/31**，合计 **124/124**；`vp check` **435 个文件格式正确 / 286 个受检零警告错误**、`docs:check` **90 份**、`messages:check` **310 个文件**。GitHub 在最新 HEAD `1ccf2d7ac7a9fcd7a1cdb17bc71d892fdef9ce87`、零未解决意见且无冲突的条件下，按维护者授权 Squash 合并至 `main@1acb4b1d3750a67f6741ae7899d49c017b8946a8`。本机 Windows 输出没有 HEAD，不伪称合并后的 SHA 被直接测试，也不能由定向结果推导完整 ready 和现场安全认证。

D5c0c 仅补充报警候选服务器时间的规范小时范围：严禁 `24:00` 被 Date.parse 隐式跨日规范化；允许规范次日 `00:00`、日末 `23:59:59.999` 和明确时区的真实时间。新增五项回归定义：时效筛选 **9**、快照 **10**、序列 **10**、代次 **8**、增量 **19**、会话归约 **30**、托管 **11**、订阅适配 **32**；八份关联目标 **129** 项。**当前只有静态 GitHub 复核及独立 Node 日期解析复现，D5c0c 尚无 Windows 项目运行日志。**

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "获取远程代码失败" }

git switch fix/d5c0c-alarm-midnight-rollover
if ($LASTEXITCODE -ne 0) {
    git switch --track origin/fix/d5c0c-alarm-midnight-rollover
}
if ($LASTEXITCODE -ne 0) { throw "切换功能分支失败" }

git pull --ff-only origin fix/d5c0c-alarm-midnight-rollover
if ($LASTEXITCODE -ne 0) { throw "更新功能分支失败" }

vp check --fix
if ($LASTEXITCODE -ne 0) { throw "Vite+ 自动修正失败" }

vp test run packages/core/test/alarm-tag-freshness.test.ts packages/core/test/alarm-snapshot-baseline.test.ts packages/core/test/alarm-tag-sequence.test.ts packages/core/test/alarm-session-generation.test.ts packages/core/test/alarm-tag-delta.test.ts packages/core/test/alarm-baseline-session.test.ts packages/core/test/alarm-session-controller.test.ts packages/core/test/alarm-subscription-adapter.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警候选时间规范回归失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

该补丁没有数据库变更、真实网关接入、Vue/React 改动、PLC/DCS 写入或生产报警事件行为。未经维护者 Windows 独立执行不能声称 129/129 已通过，PR 默认 Draft、未获本批明确合并授权前不得合并。

## 2026-11-23 · D5c0c PR #168 Windows 合并与 D5c0d 待验收

维护者 Windows 对 PR #168 八份定向测试实测：时效 **9/9**、快照 **10/10**、序列 **10/10**、代次 **8/8**、增量 **19/19**、归约 **30/30**、托管 **11/11**、适配 **32/32**，共 **129/129**。`vp check` **435 个文件格式正确/286 个受检文件零告警错误**；`docs:check` **90 份**、`messages:check` **310 个文件**。GitHub 确认最终 PR HEAD `97cc7e91eae4de44253e0319554fed64d5033c69`，无冲突和审查阻塞；经明确授权 Squash 合并至 `main@93d3fe63b47c37a2c9ad72901920cbfe4ef33104`。用户 Windows 日志未打印本地 HEAD，不能冒充合并提交在 Windows 实际测试，以上验收不代表完整 ready 或现场工业安全认证。

D5c0d 只在报警候选对服务端时间毫秒精度增加显式边界：无小数秒、1/2/3 位小数秒继续允许，4 位及更多小数秒不能在 `Date.parse` 中被静默截断后参与未来时间或递增序列判断。仅 Core 一处生产文件变更，六项新增测试定义，使八份关联目标达到：时效 **10**、快照 **11**、序列 **11**、代次 **8**、增量 **20**、归约 **31**、托管 **11**、适配 **33**，合计 **135** 项。**D5c0d 尚未进行 Windows 项目验收**。

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "获取远程代码失败" }

git switch fix/d5c0d-alarm-submillisecond-truncation
if ($LASTEXITCODE -ne 0) {
    git switch --track origin/fix/d5c0d-alarm-submillisecond-truncation
}
if ($LASTEXITCODE -ne 0) { throw "切换功能分支失败" }

git pull --ff-only origin fix/d5c0d-alarm-submillisecond-truncation
if ($LASTEXITCODE -ne 0) { throw "更新功能分支失败" }

vp check --fix
if ($LASTEXITCODE -ne 0) { throw "Vite+ 自动格式化失败" }

vp test run packages/core/test/alarm-tag-freshness.test.ts packages/core/test/alarm-snapshot-baseline.test.ts packages/core/test/alarm-tag-sequence.test.ts packages/core/test/alarm-session-generation.test.ts packages/core/test/alarm-tag-delta.test.ts packages/core/test/alarm-baseline-session.test.ts packages/core/test/alarm-session-controller.test.ts packages/core/test/alarm-subscription-adapter.test.ts
if ($LASTEXITCODE -ne 0) { throw "报警毫秒精度与会话安全回归失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }
```

本批不涉及 NestJS、Prisma、Vue/React、工业网关、设备写入或发布门禁。目标 **135/135** 仅是测试定义数量，协作端没有运行原生仓库 Vitest、Vite+ 或完整 `ready`；必须取得维护者 Windows 实测后再授权合并。

## 2026-11-23 · PR #169 Windows 验收完成，D5c0e 设计门禁候选

维护者 Windows 提供 PR #169 八份 Core 定向测试 **135/135**：时效10、快照11、序列11、代次8、增量20、归约31、托管11、适配33；`vp check` **435 个文件格式正确/286 个受检文件零警告错误**、`docs:check` **90 份 Markdown**、`messages:check` **310 个文件**通过。GitHub 合并前 HEAD `b9977f6f2d2cf0506eaa8580e8609b7143ee6b89` 无未解决审查意见与冲突；经本轮授权 Squash 合并至 `main@50148bfd5ce5f66bdf18c32009ce2b076ddb9e3f`。本机 Windows 日志未包含 HEAD，不能视为对 Squash SHA 直接运行，也未运行完整 `ready`、数据库、OIDC 或工业现场验收。

D5c0e 仅补录 **FR-011 可信采集、时钟与序列缺口的待决设计门禁**，不修改 Core、TagStore、Runtime、NestJS、Prisma、工程 Schema、双框架 UI、测试源码、HTTP 或工业网关；本批无新增 Vitest 用例，原 135 项测试状态来自**上一批 PR #169**，不能当作 D5c0e 新分支的运行证据。文档核查建议在维护者 Windows 最新分支执行：

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "获取远程代码失败" }

git switch docs/d5c0e-alarm-trust-sequence-gate
if ($LASTEXITCODE -ne 0) {
    git switch --track origin/docs/d5c0e-alarm-trust-sequence-gate
}
if ($LASTEXITCODE -ne 0) { throw "切换功能分支失败" }

git pull --ff-only origin docs/d5c0e-alarm-trust-sequence-gate
if ($LASTEXITCODE -ne 0) { throw "更新功能分支失败" }

vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }

pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }

pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "中文文案检查失败" }

Write-Host "PR 文档门禁 Windows 验收全部通过"
```

**验收边界**：D5c0e 只要求文档契约明确区分当前“严格增长”与尚未设计的“连续/缺口恢复”，并列出可信来源、时钟、重连、服务端报警状态和不可变审计的待决条件。没有新增业务代码，不需重复八份 Core 定向测试；未经 Windows 运行不能声称本 PR 的 `vp check`、`docs:check`、`messages:check` 通过。正式发布安全 Gate 继续 fail-closed。

## 2026-11-23 · D5c0h FR-011 业务序列跳号既有契约回归候选

维护者已在 Windows 对 PR #172 最终 HEAD `ca3bf22a0b9877b6ce3dea5bb809d8a1228f6f23` 运行文档专项：`vp check` **437 个格式文件/286 个受检零警告错误**、`docs:check` **92 份**、`messages:check` **310 个文件**均通过。GitHub 核验仅新增一份决策评审文档、无未解决审查线程、`@adui-dev` 已指派，按明确授权 Squash 合并至 `main@e50d41e6bd546a25082fe889958839eb4199b1c9`。上述记录不代表 D1～D5 技术方案已批准，更不代表正式报警链路上线。

D5c0h 在既有共享 Core **仅追加三个回归用例**：`TagStore` 允许版本从 5 跳至 7，迟到的 6 不覆盖；底层报警候选允许 5→7 但拒绝服务端时间倒退；报警增量允许 5→7 但拒绝 `sourceVerified: false`。这些测试固定**当前严格递增、不要求连续**的业务序列契约，既不证明中间数据没有丢失，也不证明 `sourceVerified: true` 可以鉴别真实身份。没有改变 Core 生产代码、公共协议、网关、正式报警事件或发布安全 Gate。

本批三个目标测试文件原有 5、11、20 项，新增后定义合计 **39 项**；以下命令仍需维护者在 Windows 上针对最新 D5c0h HEAD 实际执行，**不能提前标为通过**：

```powershell
git fetch origin &&
git switch test/d5c0h-alarm-sequence-noncontinuous-regression &&
git pull --ff-only &&
git rev-parse HEAD &&
vp test run packages/core/test/tag-store.test.ts packages/core/test/alarm-tag-sequence.test.ts packages/core/test/alarm-tag-delta.test.ts &&
vp check &&
pnpm run docs:check &&
pnpm run messages:check
```

本批仅为共享 Core 现有语义的定向单测，不等同 FR-011 D1～D5 决策批准、可信工业入口、服务端时间赋值、可靠游标、缺口重放、报警确认/审计、完整 `ready` 或现场安全验收。

## 2026-11-23 · PR #173 Windows 验收完成与 D5c0i 会话级跳号回归候选

维护者 Windows 运行 D5c0h 的三份 Core 定向测试，`TagStore` **6/6**、底层报警序列 **12/12**、直接报警增量 **21/21**，合计 **39/39**。后续 `vp check` **437 个格式文件/286 个受检文件零警告错误**、`docs:check` **92 份**、`messages:check` **310 个文件**均通过。GitHub 检查 PR #173 的最后 HEAD 为 `beffe5089bf475340f5a04078c2ee53eaffda8c6`、五份差异、无未解决线程或冲突、Assignee `@adui-dev`，经明确授权 Squash 合并至 `main@6cee05def85e2d9026d43a633dca577ddbff2c96`。**维护者这批日志未打印本机 HEAD**，不能冒充在合并 SHA 或确定同一 HEAD 上直接实测，也不代表完整 `ready`。

D5c0i 在上述已有低层回归基础上，只为 `AlarmBaselineSessionController` 与 `AlarmSubscriptionAdapter` 各增加一项跨层回归：当前同代次 GOOD 且服务器时间不回退时允许 Tag 业务序列 **5→7**；随后未核验来源的增量要终止当前候选，清空基线、撤销令牌或释放订阅资源；显式重新启动新代次后，旧订阅的迟到增量、断连、调度回调不能污染新会话。**只验证现有状态机，不能据此证明来源认证、传输完整性、报警事件持久化或可靠历史重放。**

本批只修改这两份已有测试及验收进度文档，Core 生产代码、公开协议、工程 Schema、React/Vue、NestJS、Prisma、工业网关与发布安全 Gate 均不变。两份目标测试原有 11 与 33 项，新测试定义合计 **46 项**，但 D5c0i 的 Vitest、`vp check`、`docs:check`、`messages:check` 均**待 Windows 实测**：

```powershell
git fetch origin &&
git switch test/d5c0i-alarm-session-jump-lifecycle &&
git pull --ff-only &&
git rev-parse HEAD &&
vp test run packages/core/test/alarm-session-controller.test.ts packages/core/test/alarm-subscription-adapter.test.ts &&
vp check &&
pnpm run docs:check &&
pnpm run messages:check
```

D1～D5 仍需维护者逐项确认。此处 `sourceVerified` 只是 Core 已有布尔输入，不是网络机器身份凭据；不启用任何正式报警事件生成、确认权限或工业设备写入。

## 2026-11-23 · D5c0j FR-011 进程内只读报警候选 Lab（待 Windows 验收）

维护者在 Windows 对 D5c0i 两份 Core 测试实测 **46/46**（托管器 12/12、订阅适配器 34/34）、`vp check` **437 个格式文件/286 个受检零警告错误**、`docs:check` **92 份**及 `messages:check` **310 个文件**通过。GitHub 对 PR #174 核对最新 HEAD `82f2300102c7be5fc4d8b4e16555cae735266a74`、四份差异、`@adui-dev` 指派、无未解决线程与冲突后，按维护者授权 Squash 合并至 `main@0297a74bd67a87a985f195b0d7c40d6697b886e2`。用户原始终端日志未包含 `git rev-parse HEAD`，不能把该结果写成在 Squash SHA 上直接执行的记录。

D5c0j 新增独立的 `scripts/lab-alarm-inprocess.mjs` 和 `scripts/lab-alarm-inprocess.cases.mjs`，只在单个 Node 进程中复用现有 `TagStore` 与 `AlarmSubscriptionAdapter`：模拟 GOOD 初始快照（序列 5）、合法业务跳号至 7、迟到序列 6 被 TagStore 忽略、将**本地实验标志**切为未核验后通过 8 终止候选并清理订阅、之后 Store 继续收到 9 但旧回调无法恢复候选。报告明确标记 `machineIdentityAuthenticated: false`、`transportHistoryComplete: false`、`formalAlarmEvents: 0`。模拟标志为 true 也**不构成机器来源认证**；TagStore 仍可存储输入，不能作为可信工业报警入口或传输完整性证据。

本批未新增网络监听、真实定时器、设备 I/O、数据库访问、凭据、告警触发/确认、正式服务端入口或 Web UI；仅增加独立 Lab 脚本、五项 Node 测试和文档。Windows 在最新分支执行以下命令（不需启动数据库、Docker、Keycloak 或工业设备）：

```powershell
git fetch origin &&
git switch test/d5c0j-alarm-inprocess-lab &&
git pull --ff-only &&
git rev-parse HEAD &&
node --experimental-strip-types --test scripts/lab-alarm-inprocess.cases.mjs &&
node --experimental-strip-types scripts/lab-alarm-inprocess.mjs &&
vp check &&
pnpm run docs:check &&
pnpm run messages:check
```

**验收边界**：五项测试是当前分支定义数量，并非已通过。协作容器无法通过网络获取 GitHub 仓库，未执行这组项目 Node 测试、`vp check`、文档及中文门禁。未来 D1～D5 的认证、服务端时间权威、独立传输游标、缺口恢复和报警事务仍待维护者专项审批；该 Lab 不属于正式实现，也不改变默认 fail-closed 发布门禁。

## 2026-11-23 · PR #175 D5c0j Windows 首轮结果与 JSDoc 中文门禁修复

维护者在 Windows 提供 D5c0j 首轮实测：`node --experimental-strip-types --test scripts/lab-alarm-inprocess.cases.mjs` **5/5 通过**；独立执行 `scripts/lab-alarm-inprocess.mjs` 的报告为初始序列 5、接受 7、迟到 6 不覆盖、来源模拟撤销后候选终止、资源各清理一次、Store 继续到 9、来源身份与历史完整性均未证明、正式报警事件为 0；`vp check` **439 格式文件 / 288 受检零警告错误**，`docs:check` **92 份通过**。最后 `messages:check` 因 Lab 的四处单行 JSDoc `@type` 缺少中文说明失败，退出码 **1**，因此**本批整条质量链未通过**。原终端日志未提供本地 HEAD，不能将这组成功结果严格绑定到远程最新提交。

针对上述真实错误，D5c0j 在 `scripts/lab-alarm-inprocess.mjs` 的四个 `@type` 注释后增补中文说明，并在 `docs/AI_MISTAKES.md` 记录 **E-103**。无测试、逻辑、类型表达式或工业安全条件变化；已按照仓库中文检查器同样的行匹配规则静态确认原四处不再触发，但**修改后未在 Windows 复验，不可标记通过**。

请在 PR #175 最终 HEAD 上重新运行：

```powershell
git pull --ff-only &&
git rev-parse HEAD &&
node --experimental-strip-types --test scripts/lab-alarm-inprocess.cases.mjs &&
node --experimental-strip-types scripts/lab-alarm-inprocess.mjs &&
vp check &&
pnpm run docs:check &&
pnpm run messages:check
```

本批仍仅为 FR-011 S0 进程内模拟与候选验证，不涉及任何已认证工业网关、真实采样时间权威、传输连续游标、报警事件持久化、确认授权或现场验收。

## 2026-11-23 · PR #175 完成 Windows 验收、D5c0k S0 自动质量门禁候选

维护者 Windows 对 D5c0j 最终修复候选重新执行 `pnpm run messages:check` **312 个文件通过**、`vp check` **439 格式文件 / 288 受检零警告错误**、`pnpm run docs:check` **92 份通过**、Node 原生 S0 Lab **5/5 通过**，并独立运行 Lab 得到初始 5、跳号 7、迟到 6 不覆盖、候选失效清理、Store 仍推进到 9 且身份/历史完整性均未证明、正式报警事件 0 的诊断。GitHub 检查 PR #175 的最终 HEAD 为 `9f7fecfab4432f37e9be7ae882f5d481d5c8870f`，仅涉及 5 份已审文件、`@adui-dev` 已指派、没有未解决意见或冲突，按维护者授权 Squash 合并到 `main@54a3d4b9868474e94ecbed81f088cdd8c259710e`。本批原始 Windows 日志**未打印本地 HEAD**，不能声称这些检查直接运行在合并提交。E-103 的中文注释修复已通过 Windows `messages:check` 实际复验。

D5c0k 仅在根 `package.json` 新增 `test:alarm:lab` 和 `lab:alarm`，将原有 **5 项 S0 Node 测试**固定纳入 `ready` 的 `test:unit` 之后、SSE 客户端检查之前；不改 Lab 源码、Core 生产代码或任何安全决策。新增质量门禁为同步离线验证，不应自动执行现场设备、真实 OIDC、PostgreSQL、工业网关、正式报警或其他带副作用操作。

**D5c0k 待执行的 Windows 检查**（需在最新分支执行；不代表已通过）：

```powershell
git fetch origin &&
git switch test/d5c0k-alarm-lab-ready-gate &&
git pull --ff-only &&
git rev-parse HEAD &&
pnpm run test:alarm:lab &&
pnpm run lab:alarm &&
pnpm run messages:check &&
vp check &&
pnpm run docs:check &&
pnpm run ready
```

`ready` 将再次执行 `test:alarm:lab`，需要在完整日志中确认新步骤被执行、原有步骤没有被跳过且最终进程退出码为 0。此处新增自动门禁只是进程内模拟覆盖，不等于 FR-011 正式认证、可靠游标、历史重放、报警事件事务或生产上线验收；D1～D5 仍待维护者专项批准。

## 2026-11-23 · D5c0l 双框架工业 UI 候选与待执行验收

PR #176 在 Windows 已验证 S0 Lab **5/5**（包括 `ready` 中实际运行）、Vitest **863/863**、NestJS E2E **63/63**，以及 React/Vue Web 构建、`vp check` **439/288 零警告错误**、`docs:check` **92 份**、`messages:check` **312 个文件**通过。GitHub 在合并前复核 13 份文件、新增的两套设计 Skill 与 `skills-lock.json`、最终 HEAD `ef26992f43c4eae6da2100a19a8d23be5da97b69`、Assignee `@adui-dev` 及无冲突后，按授权 Squash 合并至 `main@a3bca59ba176eb6d367b12c9d0264405d589d397`。**上传日志尾部没有 `ready` 最终退出码，不能把完整 ready 视为已经验收。** 原终端日志也未打印本地 HEAD，不能绑定到新 Squash 提交直接运行。

D5c0l 修改共享 Runtime 和 Studio UI 层，以及 Vue/React 三类现有页面的少量语义标记：导航焦点跳转、模拟运行响应式工艺与 Tag 面板、发布状态与只读预览、Studio 工作区视觉统一。没有更改 TagStore、报警候选、Runtime 数据解析、工程 Schema、OIDC API、Prisma、PLC/DCS 或正式发布 Gate。

以下命令与人工验收**当前均尚未在 D5c0l 分支实际执行**，不能提前标记通过：

```powershell
git fetch origin &&
git switch feat/d5c0l-industrial-ui-shell &&
git pull --ff-only &&
git rev-parse HEAD &&
pnpm run messages:check &&
vp check &&
pnpm run docs:check &&
pnpm run ready
```

Windows 真实浏览器还需分别在 React/Vue **1440×900 与 1024×768** 验收导航、模拟监控、已发布运行和 Studio：画布比例与网格、左右侧栏独立滚动、Popover、Tag 空状态、键盘 Tab→跳过导航、禁用/错误状态与无横向溢出。已有 `pnpm run test:browser`、`pnpm run test:tags:browser`、`pnpm run test:interop` 可作为功能回归，必要的真实 OIDC 发布专项需要独立受控环境和授权。可访问性与视觉合格需要截图和人工审阅，不得以 `vp check`、Vitest 或本批 CSS 静态核对替代。

相关 UI 基线：`docs/UI_DESIGN_SYSTEM.md`。工业来源认证、服务端正式报警、传输游标和设备控制均不属于本批。

## 2026-11-23 · PR #177 Windows 首轮结果、E-104 Studio 侧栏回归修复候选

维护者 Windows 在本批分支运行 `pnpm run ready`：依赖/配置/环境、中文文案 **312**、`vp check` **440 格式/288 受检零警告错误**、React/Vue 类型检查、Vitest **863/863**、报警 Lab **5/5**、NestJS E2E **63/63**、文档 **93 份**、React/Vue Web 构建均有成功记录；最后显示 NestJS 构建中的 Prisma Client 生成，日志**没有显示完整 `ready` 的最终退出码或本地 HEAD**，不可将其伪写为已证明整体返回 0。

随后 `pnpm run test:browser` 在 React/Vue 两端的 **1440×900、1024×768** 各报告 **16/19**，失败项均为“左侧栏固定 252px”“右侧栏固定 320px”“画布占据剩余宽度”，并以退出码 **1** 停止。该命令与 `test:tags:browser`、`test:interop` 用 `&&` 连接，因此后两项**没有执行**，不能将它们登记为通过或失败。对应问题记录为 **E-104**。

GitHub 远端源码与 `scripts/test-studio-browser.mjs` 的验收条件一致：原 `packages/tailwind/src/studio.css` 的共享基础值是 **252px/320px**，D5c0l 新加覆盖分别改成 260px/324px 和小屏的 238px/292px。修复候选已经**删除这两组新加覆盖**，不修改测试、业务和编辑器行为。此次代码与文档提交只进行远程静态核对，**修复后 Windows 浏览器及质量门禁尚未重新运行**。

请在 **PR #177 最新 HEAD** 执行以下命令；第一步须显示当前 HEAD，以便与 GitHub 验收绑定：

```powershell
git fetch origin &&
git switch feat/d5c0l-industrial-ui-shell &&
git pull --ff-only &&
git rev-parse HEAD &&
pnpm run test:browser &&
pnpm run test:tags:browser &&
pnpm run test:interop &&
vp check &&
pnpm run docs:check
```

若上述通过，再按需要运行 `pnpm run ready` 并显式打印 `$LASTEXITCODE`。同时在双框架 1440×900、1024×768 复查画布不溢出、面板内滚动、键盘焦点与 TDesign 控件行为；没有新建等价自定义 UI 组件。当前 PR 继续 Draft，不允许在此待验收状态下合并。

## 2026-11-23 · D5c0m 运行监控首屏与已发布空态布局候选

PR #177 的维护者 Windows 验收在最终候选 HEAD `7611dc27ac8ca70c19d80f29d1b4fae4725faec1` 上运行了完整 `pnpm run ready` 并明确打印 **退出码 0**；其中 Vitest **863/863**、S0 报警 Lab **5/5**、NestJS E2E **63/63**、双框架构建、`vp check` **440/288** 和文档 **93 份**均有通过记录。浏览器专项先前也确认 React/Vue 两个分辨率各 **19/19**、Tag CRUD 和完整双向工程 JSON 往返成功。GitHub 在无未解决线程、Assignee `@adui-dev`、分支可合并的情况下按明确授权 Squash 合并至 `main@76a2e697eba6d8034bc095e498328e68e0482edf`。`ready` 日志打印的是合并前功能 HEAD，不能误写为在 Squash SHA 上直接执行。

维护者提供运行监控、已发布运行和 Studio 的实际截图：Studio 基本保持全宽工作区，运行监控的诊断区占据首屏上方且工艺图较晚出现，已发布页面无有效快照时空状态区域过矮且剩余留白偏多。本次 D5c0m **只调整 Vue/React 共享运行样式及运行页静态展示顺序**：监控页扩大可用宽度，宽屏工艺图置于左侧、链路诊断及 Tag 置于右侧；两端 DOM 也将工艺图置于诊断之前，窄屏自然单列。发布页保持相同受控状态机，只让已存在的静态预览空态获得可辨认的区域与合理最小高度。Studio 的固定 252px/320px 侧栏和 16:9 画布保持不变。

依赖审查：Zod **4.6.7** 已在根 Catalog，现有服务端使用 Zod/Standard Schema；Day.js 当前**未列入 Catalog**，Runtime 页面已复用 `formatRuntimeUpdateTime` 和 `formatRuntimeDataAge`。本批没有新写日期/校验工具，也不引入新包、修改锁文件、改动发布权限或工业数据链路。今后有明确复杂日期/校验需要时先复用已有库，新增依赖须遵循 Catalog 与 pnpm 锁文件真实生成流程。

本批尚未执行项目命令及浏览器视觉测试；**PR #177 的历史通过结果不能等同新分支 D5c0m 已通过**。Windows 在当前分支验收：

```powershell
git fetch origin &&
git switch feat/d5c0m-runtime-workspace-layout &&
git pull --ff-only &&
git rev-parse HEAD &&
pnpm run ready &&
pnpm run test:browser &&
pnpm run test:tags:browser &&
pnpm run test:interop
```

额外需在 React/Vue **1440×900 和 1024×768** 实际查看运行监控工艺图、右侧诊断滚动、Tag 空态、已发布页面的无权限/无快照占位，以及页面是否横向溢出；发布仅显示已验证快照，不能用模拟 Tag 代替。截图视觉评审仍为独立验收项，不应由 CSS 静态检查、Studio 浏览器 19/19 或 `ready` 代替。

## 2026-11-23 · PR #178 合并与 D5c0n 正式发布 UI 待验收记录

维护者 Windows 对 PR #178 最终 HEAD `3f0998a5728015ea22ff3ffc0a34678e2fc32427` 执行 `git rev-parse HEAD && pnpm run ready && pnpm run test:browser && pnpm run test:tags:browser && pnpm run test:interop`：Vitest 863/863、S0 Lab 5/5、NestJS E2E 63/63、Vite+ 440/288 零警告错误、文档 93 份、双框架构建、Studio 76/76、Tag CRUD 与工程 JSON 完整互通均显示通过；日志未再次单独打印 `$LASTEXITCODE`，但后续 `&&` 子命令均实际执行且成功。三张新截图覆盖监控、未启动的已发布页面和 Studio，但不能代替真实授权发布快照的 OIDC 浏览器专项。GitHub 最终核对无未解决线程、可合并、Assignee `@adui-dev`，在维护者明确授权下将 PR #178 Squash 合并至 `main@be5084ef9621f93fa8ede3cc539686d56c248db5`。这是合并前 HEAD 的实测，不代表在 Squash SHA 上重新运行。

D5c0n 基于该主线仅调整已发布只读页面的三个可见操作按钮和无快照说明：React/Vue 均直接使用既有 TDesign `Button`；保留测试依赖的原生工程输入和多页选择器，以避免破坏 OIDC/CDP `HTMLInputElement` 原生 setter、表单提交、按钮禁用及 `data-testid` 语义；由 `@adui/scada-runtime` 输出七种受控状态的中文空态提示，拒绝态和离线态不误用一般“无画面”说明。新增针对状态映射的 Runtime Vitest 测试定义，未更改任何服务端发布指针校验、发布刷新时序、设备写入边界或实时 Tag 质量。

**本批尚未运行 Windows Vite+、Vitest、Web Build 或浏览器测试**。Windows 最小验收：

```powershell
git fetch origin &&
git switch feat/d5c0n-published-runtime-controls-empty-state &&
git pull --ff-only &&
git rev-parse HEAD &&
vp test run packages/runtime/test/published-runtime-view.test.ts &&
vp check &&
pnpm run docs:check &&
pnpm run messages:check &&
pnpm run build:web &&
pnpm run test:browser &&
pnpm run test:tags:browser &&
pnpm run test:interop
```

另需真实浏览器核对双框架未启动、无授权、未发布、离线、服务端异常及已验证快照的文字与按钮状态，确认既有同源 GET 和零写入保护。完整 `ready` 作为最终合并前的全链门禁；不能将 PR #178 的 863/863 作为本批的测试记录。

## 2026-11-23 · PR #179 Windows 回归及 D5c0o @adui/theme 待验收

PR #179 Windows 日志显示完整 `ready` 的 Vitest **864/864**、Lab **5/5**、NestJS E2E **63/63**、双 Web 构建、文档 **93** 份等步骤成功；后续通过同一个 `&&` 命令链继续运行 `test:browser` 双框架两种分辨率各 **19/19**、`test:tags:browser`、`test:interop` 均成功。**日志未单独打印本地 HEAD 和最终退出码**，但后续子命令的成功足以确认它们被实际执行；不能将其描述为在 GitHub Squash SHA 上直接测试。GitHub 复核 PR #179 头 `3b1ebfbb89fd67ff52404a19352d735869e693e6`、Assignee `@adui-dev`、无未解决评论且无合并冲突；经明确授权 Squash 合并至 `main@33c594c61d6155b2bc782d6114ccae0e43d2e9d8`。

D5c0o 基于上述 main 新增 `@adui/theme` CSS-only 包及 Runtime `workspace:*` 引用，将老主题入口改为兼容导入；两个 Web 的 TDesign 深色根选择器、Tailwind 基础字体间距和对等 Studio 局部变量迁移同步完成。新增静态单测验证 Token 唯一性、原颜色别名、双端主题加载和 Studio 左右固定侧栏。当前只完成 GitHub 远端源码静态检查，**未运行 Windows 构建或本批新单元测试，真实锁文件也尚未生成**。

先在当前分支使用仓库 pnpm 12.18.0 更新锁文件（这次仅为新工作区包和本地 workspace 链接，不应出现新增网络包）：

```powershell
git fetch origin &&
git switch feat/d5c0o-shared-theme-tokens &&
git pull --ff-only &&
pnpm install --lockfile-only &&
pnpm install --frozen-lockfile &&
git diff -- pnpm-lock.yaml &&
git status --short
```

人工审查后将真实生成的 `pnpm-lock.yaml` 提交/推送到当前 PR；**不要手工构造、跳过提交或要求 `ready` 忽略锁文件错误**。之后执行 `pnpm run ready && pnpm run test:browser && pnpm run test:tags:browser && pnpm run test:interop`，并在 Windows React/Vue 的 1440×900、1024×768 对比旧新主题：检查背景、字号与行高、操作间距、TDesign Button/TagManager 禁用状态与键盘焦点、画布 16:9、固定侧栏、Tag STALE/GOOD 和已发布 `UNAVAILABLE` 展示。当前 PR 必须保持 Draft；所有测试结果须绑定最终 HEAD。

## 2026-11-23 · PR #180 Windows 通过；D5c0p 共享主题等值迁移待验收

维护者提供的 PR #180 Windows 日志确认：`ready` 的依赖清单 13、中文扫描 316、Vite+ 445 个格式文件及 289 个受检零告警、Vitest **868/868**（其中主题 4/4）、Lab 5/5、NestJS E2E 63/63、Docs 93、React/Vue/NestJS 构建完成；紧接的 React/Vue 两种分辨率 Studio 4 组各 19/19，Tag CRUD 与跨框架 JSON 往返通过。同一 `&&` 命令链各步骤均执行，但日志没有单独列出本地 SHA 和 `$LASTEXITCODE`，不能称为在最终 Squash SHA 上重新实测。经 GitHub 检查 PR #180 `e93eb74e16325c34e7daf29a793ba7fd17552059` 可合并、无未解决审查线程、Assignee `@adui-dev`，锁文件只增加 `packages/theme` importer 和 Runtime 工作区依赖；明确授权后合并至 `main@8ff4ca82b8f983a32bbd9f98bdf99087b41877c0`。

D5c0p 从此主线仅修改 `packages/runtime/src/runtime.css` 的 19 条声明和 `packages/tailwind/src/studio.css` 的 11 条声明，把已存在的等值像素、字号、字重、圆角或行高换成共享 `@adui/theme` CSS Variables，不涉及新增依赖、更新锁文件或任何业务逻辑。GitHub 源码逐行比对证实两份 CSS 行数不变，恰有 **19 + 11** 行不同，所有新 `var()` 展开后均与原始声明完全相等；这只是静态证据，不能代替真实编译、浏览器和桌面运行结果。

新增 `theme-tokens.test.ts` 的两项 CSS 引用回归断言：覆盖 Runtime 导航/空态、Studio 工程列表、既有 Token 数值和固定 252px/320px 侧栏。初版断言误取最后一个同名 CSS 规则，在基础规则之后存在窄屏媒体查询时误报；已调整为扫描所有匹配规则，记录为 E-105。本批尚未实际运行 `vp check` 或测试，不能称为通过。

Windows 最小检查：

```powershell
git fetch origin &&
git switch feat/d5c0p-theme-typography-spacing &&
git pull --ff-only &&
vp test run packages/runtime/test/theme-tokens.test.ts &&
vp check &&
pnpm run messages:check &&
pnpm run docs:check &&
pnpm run build:web &&
pnpm run test:browser &&
pnpm run test:tags:browser &&
pnpm run test:interop
```

随后执行完整 `pnpm run ready`，检查 `$LASTEXITCODE` 并核对最终 HEAD。手工比较 React/Vue 1440×900、1024×768 的导航、发布空态、状态诊断、工程列表、聚焦/禁用颜色及 16:9 固定侧栏；静态 Token 数值一致不意味着各浏览器的最终计算样式已实测一致。正式工业现场验证、OIDC 真实发布授权专项与生产设备写入均不在本批范围。

## 2026-11-23 · PR #181 Windows 质量链与 D5c0q 下一批验收计划

维护者上传的 PR #181 Windows 日志：`vp check` **445 格式文件/289 受检零告警**，`theme-tokens.test.ts` **6/6**，完整单测 **70/70 文件、870/870 用例**，报警 Lab **5/5**、SSE 客户端 **8/8**、故障代理 **4/4**、NestJS E2E **63/63**，文档 **93** 份、中文扫描 **316** 份、React/Vue 构建均完成。服务端构建输出至 Prisma Client 生成，无进一步输出；日志未单独打印 `ready` 最终退出码、本地 HEAD 或本次浏览器/Tag/互通测试，不能认定这些缺失环节已通过。GitHub 实际核验最终 HEAD `44cd8b562f5b0434172d1823531f7a780f00b919`，审查线程为空、Assignee `@adui-dev`，经维护者明确授权 Squash 合并为 `main@66c006de3fb915138ca79608afac5bb1b9c542a7`。

D5c0q 仅在共享 `studio.css` 对属性面板的现有字体、间距与圆角做**数值等价**的 Token 引用替换，另外让保存草稿、添加图元、页面标签中的本地 hover 强调只针对非禁用按钮；保留 `focus-visible`、TDesign 原生状态、DOM、252px/320px 侧栏及 SVG 几何。主题静态回归从 6 项扩充到目标 **8 项**，新增对等值刻度、禁用 hover 和官方 TDesign 状态变量的检查。此处只是 GitHub 候选代码与静态核对，**未运行 Windows Vite+、Vitest、浏览器或完整 ready**。

Windows 复验（在本项目根目录，先确保当前分支及工作区修改已妥善处理）：

```powershell
git fetch origin
git switch feat/d5c0q-theme-property-controls
git pull --ff-only
git rev-parse HEAD
vp test run packages/runtime/test/theme-tokens.test.ts
if ($LASTEXITCODE -ne 0) { throw "主题回归失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "代码检查失败" }
pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "完整质量链失败" }
pnpm run test:browser
if ($LASTEXITCODE -ne 0) { throw "Studio 浏览器回归失败" }
pnpm run test:tags:browser
if ($LASTEXITCODE -ne 0) { throw "Tag 浏览器回归失败" }
pnpm run test:interop
if ($LASTEXITCODE -ne 0) { throw "跨框架工程互通失败" }
git status --short
```

人工比较 React/Vue 1440×900 和 1024×768：属性面板表单布局及文字密度、不可编辑图元的 TDesign Input/Button 禁用状态、可见键盘焦点、无选中图元空态、工具栏按钮 hover、缩放和侧栏固定宽度。测试不连接现场 PLC/DCS，也不授权任何设备写入。

## 2026-11-23 · PR #182 完整验收与 D5c0r 分级复验

PR #182 维护者 Windows 日志：`ready` 质量链的 `vp check` 445 文件格式/289 个受检零告警，Vitest **872/872**（主题 **8/8**）、NestJS E2E **63/63**、文档 **93** 份、双框架 Web 及 Server 构建完成，退出检查未触发。初次浏览器测试因本机 HTTPS CA 不受信任而失败；维护者恢复受信任证书后，React/Vue 1440×900、1024×768 四组各 **19/19**，合计 **76/76**，两端 Tag 管理与 JSON 互通均通过。未关闭 TLS 校验；日志没有单独输出本地 HEAD。GitHub 最终 HEAD `54ebf3236c39d2ab66f1ea68b055714a4d8e1ddb`，获明确授权后 Squash 合并为 `main@62265b14f11d20580c0dd58123977fef8304ccdb`。

**增量验收去重规则**：

- `pnpm run ready` **已包含** `vp check`、完整单测（包括主题专项）、前后端类型检查、离线安全/配置测试、NestJS E2E、`docs:check` 和构建。若同一 HEAD 的 `ready` 已成功，不应重复执行这些被覆盖的命令。
- `pnpm run test:browser`、`pnpm run test:tags:browser`、`pnpm run test:interop` **不属于** `ready`，需按改动实际影响选择。仅影响 Studio CSS 布局时要跑 `test:browser`；涉及 Tag CRUD 或工程导入导出语义时才额外跑对应专项。
- 小型 CSS Token 变更采用定向主题测试、`vp check`、`docs:check` 和双端真实浏览器几何回归，不要求每次提交重复完整 `ready`；核心业务、依赖、权限/审计、数据库、安全边界或关键发布路径变更，需升级为完整质量链及相关集成专项。所有执行结果均绑定当前 HEAD，旧 PR 结果不能冒充新代码已实测。
- HTTPS 测试需要受信任的 CA（可用 `NODE_EXTRA_CA_CERTS`）；禁止 `NODE_TLS_REJECT_UNAUTHORIZED=0` 和忽略证书错误。

D5c0r 本批仅对版本历史弹层进行 12 条 CSS **等值** Token 迁移，并新增 1 项主题静态测试，预计专项 **9 项**。GitHub 已静态检查声明及新断言，但本分支 Windows 测试**尚未执行**。建议在最终 HEAD 运行：

```powershell
git fetch origin
git switch feat/d5c0r-theme-version-history
git pull --ff-only
git rev-parse HEAD
vp check
if ($LASTEXITCODE -ne 0) { throw "代码检查失败" }
vp test run packages/runtime/test/theme-tokens.test.ts
if ($LASTEXITCODE -ne 0) { throw "主题专项失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run test:browser
if ($LASTEXITCODE -ne 0) { throw "双框架 Studio 浏览器回归失败" }
git status --short
```

人工检查版本弹层的打开/关闭、滚动边界、焦点可见性以及 1440×900、1024×768 下的布局，确保 252px/320px 侧栏和 16:9 SVG 画布不受影响。无工程写入或现场设备操作。

## 2026-11-23 · D5c0s TDesign 组件复用审计和后续真实浏览器验收门禁

维护者对 PR #183 的实测：`vp check` 445 格式/289 受检零告警、主题 9/9、文档 93 份、React/Vue 双分辨率 Studio 76/76；无失败退出检查，工作区 `git status --short` 为空。Windows 未单独输出本地 SHA；PR 最终 HEAD `3c7cc6800ba095ca6134356ab927317672282a92`，明确获准后 Squash 合并至 `main@e252ecce8630e38e12a51bdef088ebb8b905c846`。

组件能力核对见 [TDesign 组件复用审计](TDESIGN_COMPONENT_AUDIT.md)。当前每框架 10 处自定义 `details`（Studio 9 + 工程管理 1），后续改为 Dropdown/Popup/Collapse 等时，既有 `test-studio-browser.mjs`、Tag/互通及 OIDC/发布预检测试中有直接通过 `details.open`、`summary` 和 CSS 类名定位的真实页面操作，**必须随真实 UI 更新测试路径，不能删除业务、安全、几何断言**。

后续首批页面管理 Dropdown 验收需同时覆盖 React/Vue：真实点击菜单打开、选项禁用状态（页数 100、首页/末页、仅一页）、命令后的页面和 JSON 语义、菜单选择后关闭、Esc/外部点击、键盘焦点与 1440×900/1024×768 下无裁切。固定侧栏 252px/320px、16:9 画布、Tag 绑定/保存和工业只读安全边界始终不变。先用 Catalog 固定版本的官方 TDesign 类型/文档核实 API，构建/浏览器实际执行才可宣告通过。本批只有文档修改，未运行 Windows 新分支测试。

## 2026-11-23 · PR #184 文档验收；D5c0t TDesign 页面菜单双端候选

PR #184 维护者 Windows `docs:check`：**94 份 Markdown 通过**，不能据此推断 UI 或业务测试。GitHub 最终头 `1f41a45783b0f827060a805003bb5d0e7161efe4`，经授权 Squash 合并为 `main@343120d9019e28d59a254977c3bc6e70c5f7c4b1`。

D5c0t 仅替换页面管理 `details/summary + 绝对定位菜单` 为 React/Vue 官方 TDesign Dropdown（对应 Catalog 版本 `1.18.6` / `1.20.11`），未动其他弹层或页面 CRUD 实现。浏览器脚本的原 19 个断言全部保留并新增 8 个：TDesign 触发按钮、六项命令、禁用边界、创建页面、执行后关闭、禁用命令不修改工程、点击外部收起、键盘焦点。双端四视口**预期 27/27 × 4 = 108**；只是验收目标，**尚未运行**。

本小批建议 Windows 根目录依次检查最新 PR HEAD、Web 类型、Vite+、文档与实际浏览器，不机械重复上批 `ready`/Tag/互通：

```powershell
git fetch origin
git switch feat/d5c0t-tdesign-page-dropdown
git pull --ff-only
git rev-parse HEAD
pnpm run typecheck:web
if ($LASTEXITCODE -ne 0) { throw "前端类型检查失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run test:browser
if ($LASTEXITCODE -ne 0) { throw "Studio 双框架浏览器测试失败" }
git status --short
```

真实浏览器验收同时人工检查页面菜单 Esc、键盘导航、选项滚动与 1024×768 下贴边定位。本批自动浏览器只验证触发器可聚焦，未声称已完全覆盖键盘导航。菜单关闭行为通过官方组件执行；工程文件、Tag、报警、OIDC、发布和设备写入边界不在本次代码变化中。

## 2026-11-23 · PR #185 质量验收；D5c0u 文件草稿 Popup 定向回归

PR #185：Windows 实测 `pnpm run typecheck:web` 成功、`vp check` **446 个格式文件/289 受检零告警**、`docs:check` **94 份**，React/Vue 1440×900 和 1024×768 四组 Studio 测试分别 **27/27**，总 **108/108**。失败退出检查未触发。GitHub 最终 HEAD `9963000ac0cdd42dd281df928809922582b25c86`、Squash 合并 `main@63cce4d6a0824ae766a4b9f436e65665ad568030`；本机日志未单独提供 HEAD，不能宣称在合并 SHA 上运行。

D5c0u 只迁移「文件与草稿」Popup 容器，TDesign React/Vue 固定版本 API 已核对；JSON 导入仍使用原生文件输入及自有校验，未发生网络上传。`test-studio-browser.mjs` 只更新文件菜单的真实点击入口，并增加 3 项 Popup 断言，原 27 项 Studio 断言全部保留，目标每视口 **30 项 × 4 = 120**。这批牵涉 JSON 互通、自动保存、历史加载竞争，故除了 `test:browser` 还必须独立运行 `test:interop`、`test:versions:safety`、`test:legacy:browser` 和 `test:multitab`（必要时 `test:versions`）。不机械重复无关 NestJS/网关全量 `ready`；若出现代码/安全边界变化再扩大验证。**上述均为待验收目标，不是已执行结果。**

Windows 根目录定向验收（先确认本机可信 HTTPS 证书和测试服务）:

```powershell
git fetch origin
git switch feat/d5c0u-tdesign-file-popup
git pull --ff-only
git rev-parse HEAD
pnpm run typecheck:web
if ($LASTEXITCODE -ne 0) { throw "双框架类型检查失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "代码检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run test:browser
if ($LASTEXITCODE -ne 0) { throw "Studio 双框架 Popup 回归失败" }
pnpm run test:interop
if ($LASTEXITCODE -ne 0) { throw "双框架 JSON 互通失败" }
pnpm run test:versions:safety
if ($LASTEXITCODE -ne 0) { throw "历史版本并发安全失败" }
pnpm run test:legacy:browser
if ($LASTEXITCODE -ne 0) { throw "历史草稿迁移失败" }
pnpm run test:multitab
if ($LASTEXITCODE -ne 0) { throw "多标签页 CAS 保护失败" }
git status --short
```

人工复核：文件菜单首次开启/反复开合/点击外部/Esc/键盘焦点；导入文件选择和取消、合法/非法/超过 2 MiB JSON，导出 Blob 下载，草稿恢复/清除的确认取消分支，以及 1440×900/1024×768 菜单不被裁切。不得通过关闭 TLS 校验或删除原有工程、权限、CAS 断言让脚本过关。

## 2026-11-23 · D5c0u PR #186 Windows 多标签页阻塞与安全诊断候选

维护者在 Windows 对 PR #186 执行顺序验收：`typecheck:web`、`vp check`（446 格式文件/289 受检零告警）、`docs:check`（94）、`test:browser` React/Vue 四视口 **30/30 × 4 = 120/120**、`test:interop` 完整双框架往返、`test:versions:safety` React/Vue、`test:legacy:browser` React/Vue 迁移与快照校验，均通过。`test:multitab` React 四个阶段通过后，在**首次 Vue 两标签页导航进入 Studio** 时失败：导航按钮已激活但 `.studio-workspace` 未按时出现，`ELIFECYCLE` 退出码 1；**Vue 多标签页未执行，PR 不具备合并条件**。该日志未单独打印本地 HEAD，不能严格绑定 GitHub SHA。

已在现有 Draft 分支仅增强 `scripts/test-studio-browser.mjs` 中异步工作台导航失败的分类诊断：观察模块请求、脚本异常、资源失败和未处理 Promise 拒绝；仍坚持原 15s/5s 工作台/SVG 等待和原多标签页 BroadcastChannel、IndexedDB CAS、墓碑及故障恢复断言，不自动重试、不跳过 Vue、不拉长超时，不输出异常正文或资源 URL。由于原始日志不足以证明具体原因，此修改只是**诊断候选，尚未解决根因，也未重新通过 Windows 验收**。

最新分支建议最小复验（先核对本地 HEAD；不需要重复运行前七项已完成的业务专项）：

```powershell
git fetch origin
git switch feat/d5c0u-tdesign-file-popup
git pull --ff-only
git rev-parse HEAD
node --check scripts/test-studio-browser.mjs
if ($LASTEXITCODE -ne 0) { throw "浏览器脚本语法检查失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run test:multitab
if ($LASTEXITCODE -ne 0) { throw "多标签页安全测试仍失败，请保留新增诊断类别" }
```

若首次 Vue 加载再次失败，提供日志中的**固定布尔诊断项**即可，不必提供原始异常、Cookie、Token 或工程数据。如多标签页通过，后续仍须评估此前是否为不稳定异步加载，必要时多次仅复验该专项；不能在根因未明时声称 E-106 已关闭。

## 2026-11-23 · E-106 第二次失败后补充 CDP 同源模块 HTTP 诊断

Windows 最新日志确认：`node --check`、`vp check`（446 文件格式正确/289 受检零告警）和 `docs:check`（94 份）均通过，但 `test:multitab` 再次在 React 四阶段完成后、首次 Vue 双标签进入 Studio 时失败。页面分类为工作台=false、SVG=false、模块请求=true、模块加载异常=true、脚本异常=false、未处理异步拒绝=true、脚本或样式资源失败=false，命令退出码 **1**。这是对动态 import 失败的证据，**不是 HTTP 504 的证据**。

当前 Draft 仅进一步修改测试脚本：在原本 `Promise.all` 的 Vue 首次双标签导航期间启用 CDP `Network.enable`，观察本地同源的脚本/预构建依赖请求；失败时追加 `首标签`/`次标签` 的 `Studio模块HTTP`、`失败请求`（按请求类别、HTTP 状态或固定网络错误类别），随后仍按原失败退出。关闭观察者并清理请求 Map，不输出资源 URL、正文、私钥、Cookie、Token 或原始网络异常；React/Vue 业务、15s/5s 等待、HTTPS 校验、Studio 几何及全部 CAS 多标签安全断言未变。

如果输出为 `Vite预构建依赖:HTTP504`，再核对 Vue Vite 服务端优化器日志、依赖缓存版本及是否存在动态路由依赖发现；是否使用官方 `optimizeDeps.include` 应结合具体失败模块确定，不能一概调整。若为 4xx/其他 5xx、证书、连接拒绝或网络失败，则分别诊断对应来源；未观察到响应不代表 HTTP 200。

本批仅需在最新 HEAD 运行 `node --check scripts/test-studio-browser.mjs`、`vp check`、`pnpm run docs:check` 和 `pnpm run test:multitab`。前七项业务专项在之前候选中已通过，不机械重复 `ready`。**根因与新提交的测试结果都待 Windows 验证，PR #186 仍为 Draft，不能合并。**

## 2026-11-23 · E-106 第三次网络诊断与 Vue Studio 依赖预构建候选

维护者 Windows 第三次 `test:multitab` 退出 1；React 四组双标签 CAS 安全场景通过后，Vue 首次并发进入 Studio 失败。CDP 网络诊断：首标签 `Studio模块HTTP=200`、`失败请求=Vite预构建依赖:其他网络错误`；次标签 `Studio模块HTTP=200`、`失败请求=其他同源资源:导航中断`。`node --check`、`vp check`（446/289 零告警）和 `docs:check`（94）通过。网络层尚未暴露准确 Chromium 错误码，**不存在已证实的 HTTP 504 或具体依赖文件名**。

本批只在 Vue Vite 配置添加开发期 `optimizeDeps.include: ['tdesign-vue-next', 'tdesign-icons-vue-next']`，因为 Vue `App.vue` 动态加载 Studio 且两个包主要在 Studio 中首次引入。Vite 官方指南说明新依赖被发现时可能触发重新预构建和页面重载；此配置用于**预先发现依赖**，不是关闭优化器、安全验证或动态加载。`test-studio-browser.mjs` 补充受限 Chromium `net::ERR_*` 错误码；不输出资源地址、网络正文、会话标识、原始异常。该修复是待验证假设，React/Vue 业务、Schema、IndexedDB CAS、15s/5s 导航门禁与真实并发完全未变。参考：https://vite.dev/guide/dep-pre-bundling.html。

Windows 验收必须先让原 Vue 开发终端停止并使用新配置重启，建议在该终端执行 `vp dev --force`（先运行 `vp dev --help` 确认当前 Vite+ 1.5.0 接受 `--force`；不能直接改写其他进程）。React 开发服务保持原运行状态。仅当确认 HTTPS 15174 服务启动且可信 CA 正常后，在新的 PowerShell 中运行：

```powershell
git fetch origin
git switch feat/d5c0u-tdesign-file-popup
git pull --ff-only
git rev-parse HEAD
node --check scripts/test-studio-browser.mjs
if ($LASTEXITCODE -ne 0) { throw "浏览器脚本语法检查失败" }
pnpm run typecheck:web
if ($LASTEXITCODE -ne 0) { throw "双框架类型检查失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "代码检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run test:multitab
if ($LASTEXITCODE -ne 0) { throw "多标签页安全测试失败，请保留 Chromium 错误码" }
git status --short
```

若多标签页通过，应在同一新 HEAD 和干净开发进程下再运行一次该专项验证稳定性，随后复验 `pnpm run test:browser`（当前候选的 Vite 配置影响 Vue 开发构建）。无需重复原已通过的 interop、legacy、versions 或全量 `ready`，除非又有业务/依赖变化。**PR #186 保持 Draft，Vue 多标签 CAS 和修复效果未取得真实通过证据前不合并。**

## 2026-11-23 · E-106 已捕获 Chromium ERR_CACHE_WRITE_FAILURE，改为定向 HTTP 缓存隔离

维护者第四次 Windows 日志：`node --check` 成功，`typecheck:web` React/Vue/API Client/草稿存储通过，`vp check` **446 格式/289 受检零告警**，`docs:check` **94 份**，普通 `test:browser` React/Vue 1440×900、1024×768 **120/120** 通过。独立 `test:multitab` React 四阶段成功，Vue 第一次双标签导航失败、退出码 1；CDP 首标签 `Studio模块HTTP=200`、`Vite预构建依赖:Chromium错误码=net::ERR_CACHE_WRITE_FAILURE`；次标签 `Studio模块HTTP=200` 且无可见失败。HTTP 200 证明 Studio 模块源请求已返回，**实际失败在 Chromium 本地 HTTP 缓存写入**，不是可确认的 504 或数据库 CAS 错误。日志中本地 Git HEAD 没有单独输出。

**当前修复候选**：回滚未能消除错误的 Vue `optimizeDeps.include`，恢复 Vite 配置与 `main` 一致；在 `--multitab` 的 Vue 首次导航前仅对两个 CDP 标签页调用 `Network.setCacheDisabled` 并等待命令成功。Chrome DevTools Protocol 对该参数的定义是“忽略每个请求的 HTTP 缓存”，不是禁止 IndexedDB、CacheStorage、BroadcastChannel 或数据库事务。**无需更改 Vue 页面、TDesign 依赖、业务功能、草稿 CAS、工控安全边界或原有 15s/5s 超时。**

验证只需在 PR #186 最新 HEAD 执行：

```powershell
git fetch origin
git switch feat/d5c0u-tdesign-file-popup
git pull --ff-only
git rev-parse HEAD
node --check scripts/test-studio-browser.mjs
if ($LASTEXITCODE -ne 0) { throw "脚本语法检查失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 代码检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run test:multitab
if ($LASTEXITCODE -ne 0) { throw "多标签页安全测试失败" }
git status --short
```

前七项类型/业务/浏览器专项已在前轮运行，且这次没有新应用代码或数据模型变更，不机械重复完整 `ready`、Tag、互通、版本安全与普通 Studio 120 项。若本次 `test:multitab` 通过，为排除测试不稳定可再独立复验一次；**新候选仍未 Windows 实测，不能报告修复完成**。

若 Chromium 仍出现 `ERR_CACHE_WRITE_FAILURE`，再检查测试进程临时 Chromium 用户目录的剩余空间/权限/安全软件策略，不要删除用户正常 Chrome Profile；保留安全分类日志即可，不收集原始请求 URL、会话令牌、Cookies 或工程数据。

## 2026-11-23 · PR #186 合并验收；D5c0v 本地版本历史 Popup 定向测试

维护者 Windows 最终复测 `node --check`、`vp check`（446 个格式文件/289 个受检零警告或类型错误）、`docs:check`（94）通过；`test:multitab` React 与 Vue 各四个安全场景全部通过，退出检查未触发。之前同 PR 的普通 Studio **120/120**、双框架 JSON 互通、版本安全和旧草稿迁移及 `typecheck:web` 已执行通过。GitHub PR #186 经明确授权从最终 HEAD `c67bc33d1520b10a0a046e51d52213a8115bff0c` Squash 合并到 `main@1faca1a386c83314e24f245b7ea394c80f1c7cb0`；测试日志未单独显示本地 SHA，不能称为在合并 SHA 上直接运行。`ERR_CACHE_WRITE_FAILURE` 的本轮测试阻塞通过隔离 Chromium HTTP 缓存绕过，系统环境诱因仍待定位。

D5c0v 将 React/Vue「本地版本历史」由原生 `details` 改为 TDesign Popup，打开触发原有历史刷新，维护原始 SHA-256、IndexedDB CAS、历史差异、取消/确认载入、旧草稿迁移及导入竞争校验。新版浏览器脚本使用真实 Popup 按钮操作，保留全部版本/安全断言；普通 Studio 四组额外增加 3 项，目标 **33/33 × 4 = 132/132**，尚未实跑。

本批涉及本地版本操作及历史库失败，应在同一最终 HEAD 上执行以下定向验收，而不是机械重跑整套 `ready`：

```powershell
git fetch origin
git switch feat/d5c0v-tdesign-local-history-popup
git pull --ff-only
git rev-parse HEAD
pnpm run typecheck:web
if ($LASTEXITCODE -ne 0) { throw "双框架类型检查失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run test:browser
if ($LASTEXITCODE -ne 0) { throw "双框架 Studio 浏览器回归失败" }
pnpm run test:versions
if ($LASTEXITCODE -ne 0) { throw "本地历史版本操作失败" }
pnpm run test:versions:safety
if ($LASTEXITCODE -ne 0) { throw "历史版本并发安全失败" }
pnpm run test:legacy:browser
if ($LASTEXITCODE -ne 0) { throw "旧工程历史快照迁移失败" }
pnpm run test:release:preflight:browser
if ($LASTEXITCODE -ne 0) { throw "独立发布预检入口回归失败" }
git status --short
```

人工查看 React/Vue 1440×900、1024×768 下的版本历史弹层开合、外部点击、Esc/键盘焦点、长列表滚动、查看差异、取消及确认载入，以及发布预检和服务端版本入口仍可访问。保留本地草稿 CAS、业务错误拒绝与 SVG 画布约束；当前代码仅经 GitHub 静态差异检查，**不能声称测试已通过**。

## 2026-11-23 · PR #187 Windows 历史迁移超时与 Popup 关闭同步候选

维护者在本次 Windows 定向验收中执行：`typecheck:web` 通过；`vp check` **446 格式/289 受检零警告**；`docs:check` **94 份**；普通 Studio React/Vue 四视口 **132/132**；`test:versions` 两端通过；`test:versions:safety` 两端及不同 Origin 隔离通过。接着 `pnpm run test:legacy:browser` 在 React localStorage 0.2.0 和 IndexedDB 0.2.0 草稿迁移分别通过后，由 `studioVersionRowsInPage` 抛出「历史版本列表加载超时」，命令退出码 **1**。旧 Project Snapshot 与 Vue 三条旧数据迁移路径尚未完成；因为检查链中断，`test:release:preflight:browser` 尚未执行。本轮日志未单独输出本地 HEAD，不能断言通过结果对应 GitHub 的最终分支 SHA。

**当前最小候选**：仅修改 `scripts/test-studio-browser.mjs`，使文件草稿菜单的真实 TDesign Popup 关闭后等待面板不可见；本地历史库初始化后明确点击关闭并等待隐藏，再向既有 IndexedDB 版本库注入旧快照；版本列表等待超时区分面板未挂载、不可见或忙碌。仍使用真实按钮触发，不调用旧 `details.open`；保留 12 秒列表加载门禁、原始 SHA-256、只读归一化、历史恢复以及 React/Vue 全部安全断言。**异步关闭与后续打开竞争目前是代码层面的怀疑，不是经实测确认的唯一根因。** 未修改正式业务组件、IndexedDB Schema、CAS、权限或工业通信。

**待维护者在最新 HEAD Windows 复验**：`node --check scripts/test-studio-browser.mjs`、`vp check`、`pnpm run docs:check`、`pnpm run test:legacy:browser`；如通过，再运行 `pnpm run test:versions`、`pnpm run test:versions:safety` 和 `pnpm run test:release:preflight:browser`。失败时保留新状态分类，不通过放宽时间、删除断言或覆盖真实迁移数据掩盖问题。PR #187 继续 Draft，未经完整验收及明确授权不得合并。

## 2026-11-23 · PR #187 E-107 修复 finally 抛错导致 Vite+ 告警

维护者对上一版 PR #187 执行 `vp check --fix` 的真实日志：`eslint(no-unsafe-finally)` 报告 `scripts/test-studio-browser.mjs:1743` 在 `finally` 中抛出「TDesign 文件草稿弹层关闭超时」可能覆盖原始异常，**0 错误、1 告警**，格式化完成。因存在告警，本轮不能标记为质量门禁通过，且尚未提供修复后浏览器验收结果。

本次已将 `studioDraftFileActionInPage` 的 5 秒 Popup 关闭等待移至 `finally` 外；`finally` 只恢复测试临时替换的 `window.confirm` 并触发关闭。成功通知改用局部变量保留，正常操作后再检查关闭结果，原有 12 秒业务等待、失败异常传播和关闭超时均保留；未更改正式组件、历史版本仓储及安全断言。详见 E-107。

**最新候选待 Windows 实测**：同步 PR #187 HEAD 后执行 `node --check scripts/test-studio-browser.mjs`、`vp check`、`pnpm run docs:check` 和 `pnpm run test:legacy:browser`。只有完整通过后再运行 `pnpm run test:versions`、`pnpm run test:versions:safety`、`pnpm run test:release:preflight:browser`；不得以 `vp check --fix` 的「Formatting completed」代替零告警结论。PR 保持 Draft，未经明确授权不得合并。

## 2026-11-23 · PR #187 最终验收通过；D5c0w 全量 TDesign UI 迁移待验收

维护者在 PR #187 最终 Windows 验收链上运行 `node --check` 成功、`vp check` **446 个格式文件/289 个受检文件零警告/错误**、`docs:check` **94 份**，旧本地数据迁移 React/Vue 各 localStorage、IndexedDB 草稿、历史 Project Snapshot 共 **六条**、`test:versions`、`test:versions:safety`（包含双 Origin 隔离）与 `test:release:preflight:browser` 均通过。合并前一轮普通 Studio **132/132** 通过；用户明确批准，PR #187 Squash 合并为 `main@6c2200fe3d0419bb31f4226eec524e944d0c524e`。本地 HEAD 不在日志中，不将其捏造成对应合并提交直接跑过测试。

### D5c0w · 需对同一最新 HEAD 完成的整批测试

本批改动跨 React/Vue 全部通用组件、真实 Dialog、Upload 和 OIDC 浏览器辅助脚本。**下列测试为要求，不是已经执行成功的结果**。必须先通过前置质量检查，再运行同一最终分支的业务安全和视觉回归。测试中出现的安全确认不可通过恢复 `window.confirm`、降低断言、绕过 OIDC、放宽 CAS 或延长等待上限来掩盖。

```powershell
git fetch origin
git switch feat/d5c0w-tdesign-unified-ui
git pull --ff-only
git rev-parse HEAD

$checks = @(
  "pnpm run typecheck:web",
  "vp check",
  "pnpm run messages:check",
  "pnpm run docs:check",
  "pnpm run test:unit",
  "pnpm run test:browser",
  "pnpm run test:tags:browser",
  "pnpm run test:interop",
  "pnpm run test:versions",
  "pnpm run test:versions:safety",
  "pnpm run test:legacy:browser",
  "pnpm run test:release:preflight:browser",
  "pnpm run test:multitab"
)
foreach ($check in $checks) {
  Write-Host "执行：$check"
  Invoke-Expression $check
  if ($LASTEXITCODE -ne 0) { throw "验收失败：$check" }
}
```

另须在**先前已授权且仍隔离的本机 OIDC HTTPS Lab**，按仓库现有专项入口运行涉及服务端工程管理、确认后版本漂移、延迟拒绝、只读发布预检、真实双标签权限的相关测试；本 PR 未授权新建/删除数据库、修改 ACL、发起设备写入或部署生产。不能把 Node 模拟测试等同真实 IdP/HTTPS/CAS 验证。需要人工核对 React/Vue 的两个视口（1440×900、1024×768）中 Popup 与 Dialog 的 Esc/焦点、取消不写入、长列表滚动和贴边位置，以及 252px/320px 侧栏与 16:9 SVG 画布不回归。

已执行证据仅限 GitHub 源码静态复核、固定版本官方组件 Props 检查及部分 Node 脚本函数语法解析；以上 Windows/真实业务测试均未在本分支执行。只有最终 HEAD 的完整通过输出才能进入合并评审；新 PR 默认 Draft、指派 `@adui-dev`，未经维护者授权不合并。

## 2026-11-23 · PR #188 首次 Windows Vite+ 类型错误（E-109，待修复后验收）

维护者实际运行 `vp check --fix`：在 React Studio 图层拖拽三处报 **TS2345（3 错误）**，已发布运行页及 Studio 的 Select 回调共 **4 条 `no-base-to-string` 告警**；291 个受检文件，格式化阶段完成，但该命令 **未通过质量门禁**。输出未提供本地 HEAD SHA，也没有本轮 Web 类型检查或浏览器结果。

PR #188 已提交最小修复候选：图层拖拽事件签名由 `ReactDragEvent<HTMLButtonElement>` 放宽为符合 TDesign `Button` 回调的 `ReactDragEvent<HTMLElement>`；四处 Select `onChange` 仅对 `typeof value === "string"` 的 ID 更新状态，拒绝对选项对象等使用 `String(value)`。保留既有图层顺序、Tag 绑定、工程页面选择和已发布页面切换逻辑。

**待复验（不代表通过）**：`pnpm run typecheck:web`、`vp check`（不带 `--fix`）、`pnpm run docs:check`；通过后继续 `pnpm run test:browser`、`pnpm run test:tags:browser`、`pnpm run test:interop`、`pnpm run test:versions:safety` 以及 PR #188 原有完整验收列表。需真实检查 React 图层拖拽排序、Tag 绑定/图层目标 Select 和已发布工程多页面切换；不得从类型通过推断交互已验证。PR 保持 Draft，未获完整 Windows 验收与合并授权。

## 2026-11-23 · PR #188 Vue Select 类型检查 7 错误与 E-110 修复候选

维护者 Windows 在 D5c0w PR #188 执行 `pnpm run typecheck:web`，React `tsc --build` 后进入 Vue `vue-tsc --build`，Vue 返回 **TS2322 × 6**（TDesign Select `@change` 值域不兼容，包含 `bigint`）及 **TS2339 × 1**（模板 `TAG_DATA_TYPE_LABELS[option.dataType]` 被检查为不存在的 Record `.value`），合计 **7 个错误**；`pnpm run typecheck:web` 失败并使 PowerShell 验收链停止。**本轮后续 `vp check`、`messages:check`、`docs:check`、`test:unit`、普通浏览器、Tag、互通、版本、安全、旧迁移、发布预检与多标签页均没有运行**，不得借用前一轮不同 HEAD 的结果。

本次已将 `apps/web-vue/src/runtime/PublishedRuntimePage.vue`、`apps/web-vue/src/studio/StudioPage.vue`、`apps/web-vue/src/studio/TagManager.vue` 共六个 `@change` 回调形参改为 `unknown` 并保持具体 ID/枚举的运行时收窄；Studio 标签下拉的内联 `:options` 移为脚本 `computed`。未改已发布页权限、Tag 持久化、图层拖拽或确认载入时 CAS。GitHub 静态检查已确认六处旧签名均已消失、模板仅绑定 `tagBindingOptions`；这是源码候选而非编译或浏览器通过的证据。详见 E-110。

**待在 PR 最新 HEAD Windows 复验**：先执行 `pnpm run typecheck:web`、不带 `--fix` 的 `vp check`、`pnpm run messages:check`、`pnpm run docs:check`；只有全部通过才继续 `pnpm run test:unit`、`pnpm run test:browser`、`pnpm run test:tags:browser`、`pnpm run test:interop`、`pnpm run test:versions`、`pnpm run test:versions:safety`、`pnpm run test:legacy:browser`、`pnpm run test:release:preflight:browser`、`pnpm run test:multitab`。需验证 Vue 已发布页面切换、跨页复制、Tag 绑定、图层目标与插入位置、Tag 数据类型的实际选项选择，保留类型与历史缺失占位保护。PR #188 保持 Draft，不合并。

## 2026-11-23 · PR #188 授权合并与 D5c0x Studio 控件视觉回归待验收

维护者提供 Windows 四项检查通过：`pnpm run typecheck:web`（React/Vue/草稿及 API Client）、`vp check`（448 个格式文件，291 个受检文件零告警/错误）、`messages:check`（318 文件）、`docs:check`（94 Markdown）。维护者同时明确「同意合并，继续」，PR #188 经 GitHub Squash Merge 至 `main@30d1133e711361640e9b86bd89664a19aee6c085`。**本轮未提供单元测试、普通/Tag/互通/历史版本/多标签浏览器专项的成功输出，也未提供本地 HEAD；不能把上述四项静态检查当作全量安全回归通过。**

新分支 `feat/d5c0x-studio-controls-polish` 针对截图红框做视觉收敛：两端 Tag 操作统一为 TDesign Text Button/28px 双列，图层行改 Text Button、搜索尺寸对齐；清理旧样式的按钮自动高度、原生输入边框及全局亮青焦点环；弱化侧栏和 Tag 边界。保持当前已有的左 252px/右 320px、SVG 16:9、Tag ID、CAS、删除保护等现有门禁。

**专项新增**：`scripts/test-studio-browser.mjs` 的 `--tags` 流程在真实 React/Vue Tag 面板展开后读取两组按钮实际 `getBoundingClientRect()` 和网格列数，要求各 2 个按钮、双列、可见、每组同高同宽；保留后续 Tag 新增/编辑/绑定删除保护/删除的原始业务断言。

**待维护者 Windows 实测（尚未通过）**：同一最新 HEAD 执行 `pnpm run typecheck:web`、`vp check`、`pnpm run messages:check`、`pnpm run docs:check`、`pnpm run test:browser`、`pnpm run test:tags:browser`；再运行 `pnpm run test:interop`、`pnpm run test:versions:safety` 与 `pnpm run test:multitab` 确保跨端/存储安全无意外回归。在 1440×900、1024×768 双版本检查图层选中/键盘焦点、Tag 条目编辑删除、表单提交/重置、长 ID 折行和两侧栏宽度。未获得最终验收结果前新 PR 保持 Draft、指派 `@adui-dev`，不合并。

## 2026-11-23 · PR #189 Tag 删除 Dialog 未挂载与 React 19 官方适配修复候选

维护者本轮 Windows 依次运行以下检查，**仅这些已获得成功证据**：`pnpm run typecheck:web` 成功；`vp check` **448 个格式文件/291 个受检文件零告警错误**；`messages:check` 318 文件；`docs:check` 94 Markdown；`test:browser` React/Vue 在 1440×900、1024×768 **四组各 33/33**。随后 `test:tags:browser` 失败：`clickTagRowActionInPage` 等待 TDesign Tag 删除确认 Dialog 超时。PowerShell 在失败时退出，因此 `test:interop`、`test:versions:safety`、`test:multitab` **未运行**。

已审查固定 `tdesign-react@1.18.6` 的官方 React 19 支持机制，发现生产入口缺少 `tdesign-react/es/_util/react-19-adapter` 副作用导入。其 `react-render.ts` 在 React 19 且未加载适配器时无法进行插件动态渲染，这可以解释 `DialogPlugin.confirm` 没有实际挂载，而非由视觉上按钮变小造成。已在 `apps/web-react/src/main.tsx` 按官方文档添加适配器；原 `test:tags:browser` 继续真实点击确认并新增取消不写入断言，Tag 绑定保护没有删除。详见 AI 错误复盘 E-112。

**修复候选尚未运行 Windows 验收**。待同一最新 HEAD 复验：`pnpm run typecheck:web`、`vp check`、`pnpm run messages:check`、`pnpm run docs:check`、`pnpm run test:browser`、`pnpm run test:tags:browser`；通过后继续 `pnpm run test:interop`、`pnpm run test:versions:safety`、`pnpm run test:multitab`。关注 React/Vue Tag 删除确认/取消、已绑定 Tag 拒绝、工程 JSON 往返，及 React 19 各插件式 Dialog（草稿覆盖和历史版本载入）的可见性与安全语义。新 PR 仍保持 Draft，未经维护者明确同意不合并。

## 2026-11-23 · PR #189 React 首次 Tag 导航失败及隔离网络候选（E-113）

维护者新一轮在 Windows 执行 `typecheck:web`、`vp check` **448/291 零错误警告**、`messages:check` **318 文件**与 `docs:check` **94 份**全部通过；`test:tags:browser` 在第一个 React 页面导航阶段失败，报 `React 页面导航失败：https://127.0.0.1:15173/?scada_interop_check=tag-management`，退出码非零。由于失败即中断，本轮尚未运行 `test:versions`、`test:versions:safety`、`test:interop`、`test:multitab` 和 `test:browser`。前一次通过的四视口 `test:browser` 结果不代表当前提交通过。不能把这次导航失败误记为仍发生在删除 Dialog 上。

已提交候选：`--tags` 在临时 Chromium 测试会话中使用 CDP 禁用**HTTP 缓存**，这是 E-106 已有浏览器缓存故障的受控隔离手段；同时为真实导航失败补充地址匹配、加载状态、白名单 Chromium 错误码和同源模块请求失败分类。保留既有导航次数及间隔、真实按钮点击、取消不写入、已绑定 Tag 删除拒绝、IndexedDB 与 HTTPS 约束。**本次故障尚无 Chromium 错误码，不能断言缓存是根因；新的 Windows 运行结果仍待提交。**

复验建议（在 PR 最新 HEAD 且隔离本机开发服务已启动的前提下）：

```powershell
git fetch origin
git switch feat/d5c0x-studio-controls-polish
git pull --ff-only
git rev-parse HEAD
node --check scripts/test-studio-browser.mjs
vp check
pnpm run test:tags:browser
```

只有 `test:tags:browser` 通过后，再运行 `pnpm run test:versions`、`pnpm run test:versions:safety`、`pnpm run test:interop`、`pnpm run test:multitab`、`pnpm run test:browser`。如果仍导航失败，请保留新输出的「地址匹配 / 文档状态 / Chromium导航错误 / 同源网络诊断」，不修改协议或跳过安全断言。PR 保持 Draft，未经维护者明确授权不合并。

## 2026-11-23 · PR #189 React Tag 确认删除断言与旧 Dialog 竞态（E-114）

维护者 Windows 在先前 E-113 导航诊断候选后，`node --check` 成功、`vp check` 448/291 零错误告警；真实 `test:tags:browser` 已执行到 React 最后「删除 Tag 后工程仍包含该定义」断言失败（退出码 1），不再是首次导航失败。新增/编辑、取消删除与已绑定 Tag 删除保护已跨过对应断言；**未证明最终删除成功或 Vue 端通过**。

代码检查发现：`clickTagRowActionInPage` 在多次 Dialog 之间选择全局首个 `.t-dialog` 确认/取消按钮；TDesign 1.18.6 Dialog 异步销毁存在退出动画，旧弹窗可能残留。候选修复仅记录点击前旧 Dialog，限定新建弹窗按钮，再等待实际「项目 Tag 已删除，可撤销」业务提示后导出 JSON；不放松取消/绑定拒绝/最终定义消失的安全断言，也不变更 UI、Core 和工业只读边界。**当前尚无本机 Chromium DOM 证据断定旧按钮就是实际根因。**

候选改动仅完成 GitHub 源码静态复核及独立 Node 22 选择器烟雾验证 **2/2**，**Windows 最新 HEAD 尚未验收**。请在本机开发服务启动后依次执行：

```powershell
git fetch origin
git switch feat/d5c0x-studio-controls-polish
git pull --ff-only
git rev-parse HEAD
node --check scripts/test-studio-browser.mjs
pnpm run typecheck:web
vp check
pnpm run messages:check
pnpm run docs:check
pnpm run test:tags:browser
```

只有 Tag 浏览器专项在 React/Vue 两端完全通过后，继续 `pnpm run test:versions`、`pnpm run test:versions:safety`、`pnpm run test:interop`、`pnpm run test:multitab`、`pnpm run test:browser`。若再次失败，保留实际错误和本轮业务提示结果，不擅自判定 Core 错误或降低测试约束。PR #189 保持 Draft、指派 `@adui-dev`，未经维护者明确授权不合并。

## 2026-11-23 · D5c0y PR #189 合并后本地历史/多标签页回归阻塞（E-115 / E-116）

维护者 Windows 对 PR #189 合并后的源码回归：`test:versions` 与 `test:versions:safety` 均在本地版本 #1 确认载入后未出现预期提示而失败；`test:multitab` 已通过 React BroadcastChannel 通知与停写保护、无广播 IndexedDB 旧修订拒绝，随后文件草稿 Popup 关闭超时；`test:interop` 完整 React/Vue JSON 往返及非法导入保护通过；`test:browser` React/Vue × 1440×900、1024×768 均 33/33 通过。日志未打印当前本地 HEAD，因此只将上述结果归于维护者反馈的回归轮次。

按固定 `tdesign-react@1.18.6`、`tdesign-vue-next@1.20.11` 源码复核：历史版本与草稿辅助函数使用全局 Dialog 首按钮，可能点击仍在退出动画的旧节点；草稿 Popup 的收尾通过再次点击触发器切换开关，可能在已关闭但动画未结束时重新打开。**属于与源码吻合的候选原因，尚无真实浏览器 DOM 快照最终确认。**

D5c0y 仅修改 `scripts/test-studio-browser.mjs`：两类确认均快照旧 Dialog，只能点击本次新 Dialog；文件草稿 Popup 改为文档外部 `mousedown` 幂等关闭，正常流程继续严格检查面板消失。不改等待时长、真实业务按钮、CAS、删除/恢复、IndexedDB 版本水位、旧版迁移、Schema、OIDC 或工业只读边界。

在最新 Draft PR HEAD、隔离浏览器环境和本地开发服务已正常启动时，依次运行：

```powershell
git fetch origin
git switch fix/d5c0y-studio-popup-browser-regression
git pull --ff-only
git rev-parse HEAD
node --check scripts/test-studio-browser.mjs
if ($LASTEXITCODE -ne 0) { throw "浏览器脚本语法检查失败" }
vp check
if ($LASTEXITCODE -ne 0) { throw "Vite+ 检查失败" }
pnpm run messages:check
if ($LASTEXITCODE -ne 0) { throw "文案检查失败" }
pnpm run docs:check
if ($LASTEXITCODE -ne 0) { throw "文档检查失败" }
pnpm run test:versions
if ($LASTEXITCODE -ne 0) { throw "历史版本测试失败" }
pnpm run test:versions:safety
if ($LASTEXITCODE -ne 0) { throw "历史版本安全测试失败" }
pnpm run test:multitab
if ($LASTEXITCODE -ne 0) { throw "多标签页测试失败" }
pnpm run test:legacy:browser
if ($LASTEXITCODE -ne 0) { throw "旧草稿迁移测试失败" }
pnpm run test:browser
if ($LASTEXITCODE -ne 0) { throw "普通 Studio 测试失败" }
```

其中 `test:interop` 与 `test:tags:browser` 已在 PR #189 前后运行过，最新 HEAD 如有后续相关变更仍需重跑；本次候选尚未在维护者 Windows 运行。只有真实 React/Vue 全阶段退出码 0 才能关闭 E-115 / E-116。PR 默认 Draft，须验收后由 `@adui-dev` 明确授权合并。

## 2026-11-23 · PR #190 已验收合并；D5c0z Tag 窄屏与键盘回归候选

维护者本轮 Windows 执行 `node --check`、`vp check`（448 格式/291 受检零错误警告）、`messages:check`（318 文件）、`docs:check`（94 文档），`test:versions`、`test:versions:safety` React/Vue 均通过；`test:multitab` React/Vue 广播停写、无广播 CAS、墓碑重建、模拟故障恢复各四阶段全部通过；`test:legacy:browser` 两端各三条迁移路径通过；普通 Studio 双端 × 两分辨率共 **132/132** 通过。此前 `test:interop` 和 `test:tags:browser` 已在相应主线候选通过。上述日志没有附上本地 HEAD，本轮不据此声称完整 `ready` 或工业安全实测完成。PR #190 经授权 Squash 合并为 `main@493a793614dbbe21c7d97a3c6400442de9d88bff`，Assignee `@adui-dev` 已核对，E-115/E-116 对应阻塞解除。

下一候选 D5c0z 仅扩充已有 `test:tags:browser`：将隔离浏览器改为 1024×768，临时向渲染层注入最大长度 128 的无断点 Tag ID 检查真实 CSS 折行、行容器及按钮不溢出，`finally` 还原原值且不产生输入事件；使用 CDP `Input.dispatchKeyEvent` 发送真实 Tab，检查 TDesign 「编辑→删除」顺序、`:focus-visible` 与按钮仍在视口内，再恢复 1440×900 并运行原有新增、编辑、取消、绑定拒绝、正常删除及 JSON 往返断言。React/Vue 产品源码、工程模型、存储、权限及工业网关都不修改。**新浏览器用例和最新 PR HEAD 尚未在 Windows 运行，不能提前宣称通过。**

## 2026-11-23 · PR #191 Windows 验收与 D5c1 统一 UI/UX 门禁

PR #191 实际 HEAD `031f496d68782bbd0beacea87cca171d588dbe9b`：维护者 Windows `node --check`、`vp check`（448 文件格式、291 受检零警告错误）、`messages:check`（318 文件）、`docs:check`（94 Markdown）通过；`test:tags:browser` React/Vue 长 ID 窄屏换行、Tab 焦点、Tag CRUD 与 JSON 往返均通过；普通 `test:browser` 双端四视口 132/132 通过；`test:interop` 完整 React→Vue→React→Vue 与双端非法 JSON 保护通过。经维护者明确授权，PR #191 Squash 合并至 `main@66c14fd067dea7c20cf69a085ab004a83d307081`，并完成 GitHub 主线 SHA 核对。以上**不**代表新 D5c1 UI 已经验收。

D5c1 新增 `pnpm run test:ui:browser`，在隔离 Chrome/Edge 依次检验 React/Vue × 1440×900/1024×768 × 三页面，共 12 场景：真正的按钮导航/当前页语义、84px 左导航、非现场控制说明、整页无横向溢出、阅读顺序、发布未读取时绝不出现快照、Studio 深浅面板与可读对比度。该入口只读页面 DOM，不修改登录会话、工程、IndexedDB、Tag 或服务端快照。

**唯一最终验收命令**（所有 UI 与测试调整完成后再执行，不拆成多轮）：

```powershell
git fetch origin
git switch feat/d5c1-full-ui-ux-rebuild
git pull --ff-only
git rev-parse HEAD
node --check scripts/test-studio-browser.mjs
if ($LASTEXITCODE -ne 0) { throw "浏览器脚本语法检查失败" }
pnpm run ready
if ($LASTEXITCODE -ne 0) { throw "完整就绪链路失败" }
$env:SCADA_UI_SCREENSHOTS = "1"
pnpm run test:ui:browser
if ($LASTEXITCODE -ne 0) { throw "三页面 UI/UX 验收失败" }
pnpm run test:browser
if ($LASTEXITCODE -ne 0) { throw "Studio 四视口验收失败" }
pnpm run test:tags:browser
if ($LASTEXITCODE -ne 0) { throw "Tag 管理回归失败" }
pnpm run test:interop
if ($LASTEXITCODE -ne 0) { throw "双框架互通验收失败" }
pnpm run test:versions
if ($LASTEXITCODE -ne 0) { throw "本地版本历史验收失败" }
pnpm run test:versions:safety
if ($LASTEXITCODE -ne 0) { throw "本地版本安全验收失败" }
pnpm run test:multitab
if ($LASTEXITCODE -ne 0) { throw "多标签页安全验收失败" }
pnpm run test:legacy:browser
if ($LASTEXITCODE -ne 0) { throw "旧工程迁移验收失败" }
```

由于协作容器无法访问仓库完整工作区和已有 React/Vue 依赖安装，以上全量质量链及 Windows Chromium **截至本记录均未执行**。不把新主题的静态断言、CSS 差异检查或以往旧设计截图当作真实构建通过；如有编译或可访问性失败，应留在本 PR 内一次修正，不能降低业务、质量或授权断言来掩盖。

## 2026-11-24 · PR #192 FUXA 参考下的 Tag 独立编辑器（待最终统一验收）

用户提供实际截图，证明旧 320px 属性栏将 Tag 目录、说明、操作按钮和五字段表单堆在同一纵向滚动区域，存在明显的阅读与操作层级问题；并指定 FUXA 为竞品参考。根据其公开的 Editor、Connections 和布局文档，仅借鉴任务隔离方式，不复制其源代码，也不引入真实设备连接。

React/Vue 已同步重写 TagManager 为轻量搜索目录与独立 TDesign Dialog 编辑器，表单按双列布局、字段旁错误与底部主次操作组织，编辑时保持稳定 Tag ID 禁用。共享 Studio CSS 移除旧常驻表单与宽行级按钮样式，沿用原共享 Core 的新增/更新/绑定删除保护/JSON/CAS。浏览器 --tags 专项同步检查列表搜索、对话框宽度与双列、字段旁错误、ID 锁定、窄屏、真实 Tab 和已有全部业务断言。

这只是远端提交与固定版本 TDesign API 的静态核对；新变更尚未实际运行 Windows vp check、ready 或 Chrome 视觉回归。遵从用户要求，不分批请求验收，继续在唯一 PR #192 内完成设计与测试调整，最终一次集中验证。

## 2026-11-24 · PR #192 新增 Figma 画板思路与 1920×1080 默认页面

维护者明确补充：竞品可同时参考 Figma，不应只研究 SCADA；新 Studio 画板默认 **1920×1080**。按共享 Core 方案实现 `STUDIO_DEFAULT_PAGE_SIZE` 和 `waterTreatmentStudioDocument`：把原本 880×460 的演示布局等比例放大且居中，仅改变 React/Vue 新进 Studio 的默认页面，**不重写**原 880×460 只读水处理演示、不改变已有工程尺寸或 `createPage` 继承当前页面尺寸的业务规则。浏览器窗口仍通过 SVG viewBox 按需适应，不设置固定 DOM 1920px。

增加 `packages/core/test/studio-default-document.test.ts` 三组预防性断言、`test:ui:browser` 对双端 × 1440×900/1024×768 的默认画板实际宽高断言，并在双端界面显示 `px` 单位。合入与此前 FUXA 任务型 Tag 面板修复同一个 PR #192，仍保持 Draft。**本次仅远端代码/静态结构核对，尚未获得 Windows `ready`、真实浏览器与截图的最终验收**；没有另开 PR、没有要求阶段性验收。

## 2026-11-24 · PR #192 Figma UI3 参考后的统一验收扩展（尚未执行）

本轮在 FUXA/Tag 改版的基础上，对照维护者提供的 Figma 首页和编辑器截图，调整了四个工作模式：新增**真实入口**的首页，左导航宽度非编辑 184px、编辑 52px；Studio 页面列表移至左 236px 图层区，右 288px 属性面板；中性灰画布、白色画板、底部图元工具组与 48px 适应留白。新增 Core/Runtime 的轻量 SVG 外观可选参数，确保仅 Studio 浅色预览而真实运行默认仍深色。两个框架使用相同的共享核心画板/渲染契约。

本批测试源代码已同步：`test:ui:browser` 新增首页并更新导航宽度，场景矩阵从 12 增至 **16**；普通 Studio 浏览器检查真实左页面条、底部工具岛与 SVG 白色画板以及 236/288 面板；Core `studio-viewport-rect.test.ts` 覆盖只读缩放留白；SVG Core/Runtime 单测验证 light/dark 严格隔离；SSE/TCP 浏览器测试改为从新首页实际导航到运行监控，并继续要求有效真实数据及连接回收。

**全部尚未在实际 Windows 环境运行；请在 #192 其余 UI 收敛完成后一次性执行原统一验收链并审阅 `SCADA_UI_SCREENSHOTS=1` 产生的 16 张截图。** 不应将静态检查写成实际通过，也不得为使浏览器测试变绿而删除工业安全或数据保真断言。

### D5c1 · Figma 工具模式与不遮挡画布补充验收（PR #192 Draft）

- Core 适应留白的像素变量与世界坐标变量分离；原视区单测仍需执行。
- 双端 Studio 普通浏览器四视口新增：顶部视图栏及底部工具栏不覆盖 SVG、默认选择模式、抓手禁止图元指针编辑、恢复选择可交互、缩放入口归位底部工具栏。
- 抓手放大后平移、图元上拖动不改变几何、添加后恢复选择以及界面截图由最终实机复验确认。当前未运行全量 Windows 门禁或 Chromium，不得标记通过。

### D5c1 · 维护者重新设计授权后的布局验收变更

旧固定宽度及 Studio 纵向全局轨道验收被替换为：顶部横向工作空间切换、可调整左右面板宽度、画布占据剩余空间、折叠后准确扩展、缩放位于视图栏、真实工程入口及安全说明。保留既有工程数据、Tag、草稿、权限、运行时及图元业务回归，不因视觉变化放宽安全断言。待最终实机验证。

### D5c1 · 操作工作区与精密画布候选验证

新增定位旋转图元及最大倍率限制单测；真实浏览器验证选择手柄适应与放大后的 CSS 像素尺寸、主选图元定位、实际缩放显示及画布 V/H 工具模式切换。运行和发布工作区改为顶部导航与独立画面/诊断面板，继续执行原 SSE、断连恢复、只读预览与权限检查。未执行的实机验证不得记为通过。

共享视区数学候选 Blob `2f387e1bc7e50b26b83c9cc7a5c58c75d79e1d11` 在协作容器中重建并核对 Git Blob 哈希一致，Node.js 22.16.0 TypeScript strip-types 独立测试 10/10 通过（含边界、旋转定位、四角度与两视区手柄数学）；非仓库 Vitest、非双框架构建。新增真实浏览器分隔条方向键及宽度恢复断言；完整 pnpm/Vite+ 工程与真实浏览器尚未运行。

### D5c1 · React Tag 表单 JSX 格式化阻塞 E-120

维护者在 HEAD `eadc44fdc8b76e41fe16e37068dc9fcb4679c65b` 实测 `vp check --fix` 因 TagManager.tsx 条件表达式缺少闭合花括号中止。最小修复将第 297 行 `)` 改为 `)}`；原始局部 TSX 片段经 TypeScript 5.8.3 解析 5 条错误，修正后 0 条，未运行完整文件、仓库格式化、类型检查及 Chromium。保留原业务和安全断言；PR #192 继续 Draft，完整验收待复验。

### D5c1 · 浏览器脚本 Lint 警告 E-121

维护者报告 E-120 修复后 `vp check --fix` 格式化完成，292 个受检文件零错误、3 条警告。候选修复仅修改 `scripts/test-studio-browser.mjs` 中未使用参数、百分比后缀判断、原生 setter 调用，沿用 E-070 的 `Reflect.set` 方案。实际修改后的局部函数独立 JavaScript 模拟通过，未执行完整 Vite+ 与 Chromium，PR #192 保持 Draft。

### D5c1 · Pixso 参考视觉调整

维护者已提供上一候选的 Windows 格式、Lint、前端类型和文档检查通过日志；本次新候选改为共享真实工作台目录、搜索、SVG 缩略图、工程卡片网格与 Studio 工具图标，并新增工作台搜索、空态、恢复和实际 SVG 图片加载断言。此前的检查不能证明新提交通过。当前协作环境实测 GitHub 域名无法解析，未能拉取完整工作树；未执行新候选的 Vite+、完整 ready、Chromium 或截图审阅，仍需 Windows 统一验收。

### D5c1 · 工程工作台与总览候选验证范围

在 GitHub HEAD `96dafd4b6463d286569748ad1b4f5557c18656aa` 核对了新增工程、真实草稿接口、双端图元库及静态总览。新增两个浏览器辅助函数经 V8 语法解析通过；完整 3026 行浏览器脚本主体在仅移除静态 import、替换 import.meta.url 后也经 V8 语法解析通过，未执行脚本。新测试候选覆盖空白工程 Schema、指标卡质量占位、真实浏览器新建/添加图元/保存/重新打开；尚未执行这些仓库测试。当前环境实际尝试 GitHub Git 拉取因域名解析失败；完整 pnpm/Vite+、双端 Chromium 及截图未验证。维护者无需进行分批验收，最终按统一质量门禁执行。

### D5c1 · V7 明暗双主题

维护者提供 Windows vp check（448 格式文件、293 受检文件零警告错误）、typecheck:web 和 docs:check（94 份）通过日志，未给本地 SHA，不绑定为本轮新提交通过。真实截图显示紫色按钮正文对比度不足；源码确认 TDesign anti 前景被映射为深色正文。候选恢复 V7 科技蓝、独立实色按钮白字及状态按钮色，新增深色语义覆盖、双端主题切换、偏好持久化、原版透明标识及中性弱按钮。

本轮实测：品牌包 mark-primary.svg 的 Git Blob 为 3d55e6c9e9f7ac5f54804b33585a5e860fee470d，mark-dark.svg 为 4938c0a49a0d9b26100035fc13d386be6ace52d7，远程双端文件均逐一匹配。37 个深色覆盖变量均有基础定义，Runtime/Studio 使用的 adui 变量均已定义。按 WCAG 相对亮度计算，浅色/深色正文对比度分别为 12.14/12.91，主按钮均为 5.13，选中项为 5.80/5.61，三种状态文本均不低于 4.84。浏览器脚本主体经 V8 语法解析，未执行脚本。新增双框架 × 双分辨率 × 双主题 × 四工作区共 32 场景和刷新恢复断言，仍需 Windows 实际执行。

### D5c1 · 图标、深色提示与适应画板

本轮根据真实截图修改现有 PR #192。源码确认 Catalog 固定版本为 tdesign-icons-react 0.6.11、tdesign-icons-vue-next 0.4.11；官方图标仓库存在所选 SVG 名称，固定版本包的 TypeScript 导出仍需本机类型检查确认。双端应用首页无手写 SVG 图标，Studio 保留实际工业 SVG。适应画板共享边距改为 8 CSS px，并新增共享视区单测和真实 DOM 图标、限制轴间距及提示栏对比度断言。当前环境 npm 域名解析失败，未执行 Vite+、Vitest 或 Chromium；最终 Windows 验收待执行。

### D5c1 · 工作区底部网格连续性

维护者截图澄清：问题为网格没有覆盖工具带周围，而非画板尺寸。已提交双端工具带网格、共享相位计算及原 48px 适应边距恢复。新增核心相位断言及 DOM 覆盖范围、缩放对齐、显隐同步断言，保留原不遮挡、画板尺寸及编辑交互验证。未实际执行 Windows Vitest、Vite+、Chromium 或截图检查，不能认定实机通过。

### D5c1 · 工作区视觉连续性

维护者截图指出底部双渲染层与左上标题区域视觉割裂。本轮删除独立工具带、双端 CSS 补画逻辑及仅供其使用的 Core 相位函数，改为单一 SVG 网格和浮动工具栏。新增实际 DOM 边界、唯一网格、标题基线、默认画板无遮挡及缩放/网格开关断言；保留既有工程尺寸及图元、面板交互检查。远程提交已写入原 PR #192；完整 Vite+、真实浏览器与截图尚未执行，不能以源码核对替代。

### D5c1 · 图标文案对齐与主题开关

维护者截图显示工具按钮内图标、文案未垂直居中，并要求主题使用 Switch。已核对 Catalog 固定版本 React/Vue Next Switch 的 value、label、change 及根元素源码，候选统一内容层和开关受控状态，浏览器断言改为 aria-checked、实际 checked class、刷新恢复，并检查导航和底部按钮图标/文案与按钮中线误差不超过 1 CSS px。完整类型检查、Vite+ 与真实 Chromium 尚未执行。

### D5c1 · TDesign 官网式主题过渡

已查阅 Tencent/tdesign 的 packages/site-components/src/components/td-theme-tabs/index.ts 与 style.less：官网使用双图标、滑动选中块及 document.startViewTransition，不另加圆形扩散。本候选保留真实 TDesign Switch 并共享原生过渡与减少动效降级路径。补充源码断言及浏览器双图标、真实开关状态、过渡完成后的主题和刷新检查；实际浏览器、类型及格式检查待执行。

### D5c1 · 官网斜切主题动画与深色画板

维护者上传暗色画板仍白色截图及官网主题录屏。附件在当前环境仅为一帧 PNG，无法逐帧复验；进一步查阅官网 td-theme-tabs 及 animation.less，确认真实动效为 8 度斜切遮罩、1 秒双向扫屏，并非默认交叉淡入淡出。已提交共享 CSS，新增 studio-dark 预览及双端主题传递，替换旧白色画板断言，补充内嵌 SVG 背景、金属设备、指标卡、数据质量及原运行渲染兼容性测试。尚未执行 Vite+、Vitest、Chromium 或实际录屏对比。

### D5c1 · 图层搜索清空入口

维护者标出独立清除搜索按钮。核对现有双端 Input 及固定版本官方清空实现后，改用 clearable，删除独立按钮及未使用 CloseIcon，定位按钮独占一行；补充双端源码契约断言。尚未执行 Vite+、类型检查或真实浏览器清空回归。

### D5c1 · 工程重命名与视图按钮

新增工程可选名称、撤销重做、JSON/快照摘要和草稿目录展示，保留无名称文档的原结构及工程身份。补充 Core 名称校验、编辑历史、快照摘要及真实浏览器重命名保存重开、按钮等高断言。源码已提交候选，未执行完整 Vite+、Vitest、Chromium，待实机复验。旧版严格 Schema 读取器不接受新增字段，命名文档须与本次更新的 Core/服务端配套使用。

### D5c1 · 双端图标统一

基于两套固定版本官方图标源码核对通用图标名称。替换字符式缩放、展开、拖拽与微调，视图设置及定位采用 TDesign 图标；三个工业设备图标采用共享本地矢量资源。浏览器候选继续验证底部六项操作的实际图标、图标与文字对齐、共享工业资源尺寸、视图按钮等高及可访问名称，并补充微调与拖拽图标断言。完整 Vite+、类型检查、真实 Chromium 与视觉验收尚未执行。

### D5c1 · 顶部菜单裁剪回归

维护者报告顶部五个菜单点击无效果。源码确认工具栏使用 overflow-x:auto 与 overflow-y:hidden，而五个 Popup 挂载在其内部；改为 flex-wrap:wrap 与 overflow:visible。浏览器候选增加五个弹层实际命中检查，避免仅以 getClientRects 判定可见；保留原业务回归和外部关闭断言。工程管理自身授权拒绝时继续清空授权缓存和 CAS，仅保留已清空的目录组件以展示错误。完整 Windows Vite+ 与真实双端浏览器仍待验证。

### D5c1 · 双框架 Router 候选

已核对 React Router 7.18.5 / Vue Router 4.6.5 固定版本官方包 peer 声明。候选新增四个真实工作区路由、工程 ID 路径、本地工程解析、路由离开与刷新保护及共享路由单测，浏览器断言同步检查实际 Hash 地址、取消离开、前进后退和刷新草稿。当前 npm 无法连接且缺少 pnpm 12.18.0，锁文件未生成，冻结安装、Vite+、类型检查、构建、真实 Chromium 与 Tauri 均待验收。禁止把候选源码提交描述为已通过。

### D5c1 · 单层浮层视觉回归

维护者截图显示 Popup 内重复背景、圆角、描边和阴影，导入 JSON 还存在额外带边框包裹层。候选移除重复外观，文件五项改为统一文本按钮，复杂面板使用轻量分隔线。已核对两套固定版本官方 Button 的 theme / variant / size 与 Popup 的 content 容器；保留真实文件选择、禁用及危险确认。浏览器新增计算样式断言（透明内容、无内边框、无内阴影、等高文本按钮），原五项实际命中与关闭断言保留。完整 Vite+、类型和真实 Chromium 尚未执行。

### D5c1 · 首轮集中验收与 E-123 / E-124 修复

维护者在 Windows HEAD `6c756a48cd0a268e545f3282438e8f0cc5cfba12` 完成 pnpm 12.18.0 安装、冻结安装、两份浏览器脚本语法及 13 清单 / 54 Catalog 检查。本地 pnpm-lock.yaml 有修改、尚未同步到远端。完整 ready 因旧 Studio CSS 路径 ENOENT 中止；UI 浏览器通过 React 1440×900 浅色工作台，随后运行监控导航对比度不足而中止。候选修复共享样式检查、统一选中色并增加计算样式诊断，保持 4.5:1 门槛。完整配置、Vite+、类型、构建及真实浏览器复验待执行，不继承先前 HEAD 的验证结果。

### D5c1 · E-125 文件菜单尺寸复验候选

维护者在 Windows HEAD `3729db9a4966bfc07216a5d2f3ed65516b85fe84` 普通 Studio 四视口均为 77/78（308/312），唯一失败为文件草稿五项文本菜单联合断言。已核对官方 Button 类名，候选将共享菜单样式集中为 28px 边框盒等高、左对齐且无尺寸过渡，Upload 触发容器满宽；新增分项计算样式诊断，保留单层浮层与五项按钮及原功能断言。真实浏览器待复验，不将源码检查作为通过证据。

### D5c1 · E-125 对齐计算值误判修正

维护者在 Windows HEAD `66ed77bf29063b4364560546f9ea36d3a1db78dd` 验证 Vite+ 456/298 零警告错误、文档 95 份通过，普通 Studio 四视口仍为 308/312。逐项诊断确认全部 20 个按钮的单层、数量、文本变体和 28px 尺寸均符合预期，唯一失败属性为计算值 flow-start，而原断言仅允许 flex-start。候选只修改测试：兼容起始对齐的计算值并使用 DOM Range 测量真实文本左侧位置，保留精确 28px、按钮数及单层断言。待最新 HEAD 的真实四视口复验；未修改正式 UI、依赖或锁文件。

### D5c1 · E-125 关闭与 E-126 Tag 弹窗候选

维护者 Windows HEAD `c31c86ef1bf25e51987251fe277bade1de38c027`：脚本语法、Vite+ 456/298 零警告错误、95 Markdown、普通 Studio 四视口 312/312 均通过，E-125 关闭。随后 React Tag 专项弹窗宽度不足而中止。核对固定版本官方 Dialog 宽度转换和缩放入场动画后，候选仅修改测量时机，等待实际稳定边界并保留 600px、双列、五字段及全部业务门槛，失败输出计算尺寸及动画诊断。真实 Tag React/Vue 复验尚未执行，不能宣布 E-126 关闭。

### D5c1 · E-126 React 通过与 E-127 Vue Tag 初始挂载候选

维护者 Windows HEAD `bd9e699d95890a5a06ec0d10d4ccc5e09e476ab6`：脚本语法、Vite+ 456/298 零警告错误、95 Markdown、React Tag 专项通过；Vue 首次紧凑目录断言仅 noSidebarForm 失败，后续八项未运行。候选依据固定版 TDesign Vue Next 1.20.11 Dialog 源码显式指定 attach=body、lazy，保留 destroyOnClose；测试仍要求无侧栏表单，成功保存后等表单实际销毁，再次编辑时复核独立弹窗与稳定宽度。最新候选尚未实测，不改变 Tag 数据、依赖或安全门槛。普通 Studio 312/312 是此前 HEAD 的已完成验收证据，不重复运行未受影响的普通场景。

### D5c1 · 七项功能回归通过与 E-128 SSE 协议阻塞

维护者在 Windows HEAD `a5ff6a855e79d8b6d8a4306545c138ec752f96b8` 实测脚本语法、Vite+ 456/298 零警告错误、95 份 Markdown、双端 Tag 全流程、双框架 JSON 互通、历史版本及安全、多标签页各四阶段、历史迁移各三路径、发布预检双端全部通过。E-126/E-127 原验收阻塞已解除。 普通 SSE 首页预检仍使用 HTTP，但实际 Vite+ 为 HTTPS；候选复用已有安全回环地址解析、严格 TLS 预检、真实 Hash 路由检查，并补充本机双段 TLS SSE 故障代理，明文 Docker 路径不变。原下行阻断、Tag 过期、重连及资源回收门槛不变；HTTPS 代理仅用于隔离浏览器模拟验收，不作 OIDC 或工业生产测试。最新代理单测、Vite+、文档及两项 SSE 浏览器尚未实测。

### D5c1 · 最终分层验收完成（PR #192）

维护者 Windows 最终日志：两份 SSE 脚本语法检查、Vite+（456 格式文件、298 受检零警告错误）、95 Markdown、协议配置 6/6、代理单测 5/5 均通过；React/Vue HTTPS 15173/15174 的普通 SSE 心跳、Tag 过期、静默重连、资源清理及真实下行阻断、STALE、主动重连、连接回收均通过，九项功能专项累计完成。最终日志未单独打印本地 SHA；GitHub 核对候选 HEAD ae249f55d372fc3babb2aec8011fdca45c62f99e 相对 85f30ff7 仅有条件语句格式化，无语义改动。维护者明确同意合并。 此前分层日志已记录 900/900 单测、63/63 HTTP E2E、32/32 UI 场景及 312/312 Studio 断言；七项专项在 a5ff6a85 完成。以上为多次提交的累计验收，不宣称最终 HEAD 单次完整 ready 已重新执行。E-123 至 E-128 的对应回归阻塞已解除。此记录仅补充文档，不改源码；不代表生产安全认证、真实设备协议或生产发布验收。

### D5c2 · FR-012 历史趋势共享 Core 候选

新增 8 项定向用例定义，覆盖 Tag 隔离、左闭右开区间、四种质量、原值/源时间保留、重复及跳号序列、同毫秒顺序、无数据/超点数、查询参数、非规范 UTC 时间及非法标量/质量。Windows 待运行 `vp test run packages/core/test/tag-history.test.ts packages/core/test/tag-store.test.ts`、`vp check`、`pnpm run messages:check`、`pnpm run docs:check`。仅验证本地纯数据契约，不宣称已实现数据库归档、历史完整性、可信来源或趋势 UI。

### D5c2 · Windows 定向验收完成（PR #193）

维护者 Windows 实测 D5c2 定向验收通过：Vite+ 458 个格式文件、300 个受检文件零警告错误，历史查询 8/8、TagStore 6/6，合计 14/14；中文文案 327 文件、Markdown 95 份均通过。最终日志未打印本地 HEAD；GitHub 候选 b51b8e9e6ce40a8a886c261d011ff186cf1c9c4e 相对初始候选 7f6bbe1d 仅测试排版变化。维护者明确同意合并。仅证明定向本地契约及既有 TagStore 回归，不代表全量 ready、持久化历史或现场工业验收。

### D5c3 · FR-012 有界历史缓冲区候选

新增 11 项定向测试定义，覆盖非法容量、跨 Tag 总容量、整批拒绝、质量保留及派生质量拒绝、全部记录校验、引用隔离、显式清理、迟到保护、空记录与实例隔离、稀疏数组拒绝和源时间长度上限。原历史查询 8 项与 TagStore 6 项继续回归；目标三份测试共 25 项。Windows 待执行 `vp test run packages/core/test/tag-history-buffer.test.ts packages/core/test/tag-history.test.ts packages/core/test/tag-store.test.ts`、`vp check`、`pnpm run messages:check`、`pnpm run docs:check`。不宣称完整 ready 或工业历史归档验收。

### D5c3 · E-129 稀疏数组构造 Lint 警告

维护者 Windows `vp check --fix` 报 301 文件零错误、1 项 no-new-array 警告。候选仅调整稀疏数组测试构造，使用字面量后扩展 length，并断言真实空位存在；保留整批拒绝与已有记录不变断言，不修改正式历史缓冲区实现。仍需 Windows `vp check` 零警告、三份定向测试 25 项、中文文案与文档检查。

### D5c3 · Windows 定向验收完成（PR #194）

维护者 Windows 实测：Vite+ 459 文件格式正确、301 个受检文件零警告和错误；历史缓冲区 11/11、历史查询 8/8、TagStore 6/6，共 25/25；中文文案 328 文件及 Markdown 95 份全部通过。日志未独立打印本地 SHA；GitHub 最终候选 54b116e64a96acad12d0af75bbe9c23898c9b4f7 相对 069c63b9 仅三份 TypeScript 文件格式化，无业务或测试语义变化。维护者明确授权合并。 E-129 关闭。本轮证明本地缓冲与查询契约回归，不代表持久化归档、生产采集或最终全量 ready。

### D5c4 · FR-012 历史采样策略候选

新增 13 项定向用例定义，覆盖首次、周期边界、变化累积和双向阈值、周期重计、四种质量、数值可用性、非数值及非 GOOD、不启用阈值、两类写入失败基线保护、跳过后的时间顺序、输入校验、策略复制及实例隔离。既有 25 项历史缓冲、历史查询及 TagStore 继续回归，目标四份测试共 38 项。Windows 待执行 `vp test run packages/core/test/tag-history-sampler.test.ts packages/core/test/tag-history-buffer.test.ts packages/core/test/tag-history.test.ts packages/core/test/tag-store.test.ts`、`vp check`、`pnpm run messages:check`、`pnpm run docs:check`；完整 ready 独立待执行。本批不代表生产历史、来源认证或数据库归档验收。

协作容器 Node.js 22.16.0 使用独立 node:test 驱动运行 13 个对应采样场景，13/13 通过、0 失败、0 跳过；受测 tag-history.ts 与 tag-store.ts 的 Git Blob SHA 分别为 372572d59850f021e5b732ade763bef9b9566c2b 和 78e22557523275fecb9e6172cc6b02230c60c58b，均与远端候选一致。GitHub 域名在容器无法解析，未直接克隆完整仓库；独立 Node 测试不等同正式 Vitest、Vite+、全量 ready 或真实工业归档验收。

### D5c4 · Windows 定向验收完成（PR #195）

维护者 Windows 实测 D5c4：Vite+ 460 文件格式正确、302 个受检文件零警告和错误；采样策略 13/13、历史缓冲区 11/11、历史查询 8/8、TagStore 6/6，共 38/38；中文文案 329 文件、Markdown 95 份全部通过。日志未独立打印本地 SHA；GitHub 最终候选 27786fc8ec54fd7fc43ca19863158840520c6f1c 相对 62f59651 仅测试格式化。维护者明确授权合并。定向测试不代表完整 ready、生产采集、持久化归档或现场工业安全验收。

### D5c5 · FR-012 本地归档批次候选

新增 8 项定向测试定义，覆盖空批次及上限、跨 Tag 入缓冲顺序与质量保留、不可变性、同批次重试、追加及迟到记录保护、跨实例/伪造/重复确认拒绝、待确认清理保护、确认释放容量后采样器重试。原四份 38 项测试继续回归，目标五份测试共 46 项。Windows 待执行 `vp test run packages/core/test/tag-history-archive.test.ts packages/core/test/tag-history-sampler.test.ts packages/core/test/tag-history-buffer.test.ts packages/core/test/tag-history.test.ts packages/core/test/tag-store.test.ts`、`vp check`、`pnpm run messages:check`、`pnpm run docs:check`。完整 ready 待运行，不宣称真实归档、数据库事务或持久化幂等验收。

协作容器 Node.js 22.16.0 独立 node:test 验证：新增归档对应 8 项及既有采样对应 13 项，共 21/21 通过、0 失败、0 跳过。受测 tag-history.ts、tag-store.ts 的 Git Blob SHA 分别为 28a2cc4e90135ebdf658ed9ff67ed701dd77632b、78e22557523275fecb9e6172cc6b02230c60c58b，与远端完全一致。首次仅 strip-types 参数不能处理已存在的 TypeScript 参数属性，未执行用例；切换 Node 支持的 experimental-transform-types 后实际通过。容器 GitHub 域名解析失败、无 Vite+，独立原生断言测试不等同仓库 Vitest 或完整 ready。

### D5c5 · E-130 不可变性测试 Lint 候选修复

维护者 Windows Vite+ 461 文件格式正确、303 个受检文件零错误、1 项 require-to-throw-message 警告。仅改归档不可变性测试为 Reflect.set 返回 false 的显式拒绝断言，保留三层冻结及原值不变验证；Node.js 22.16.0 独立冻结对象实验通过，未执行正式 Vitest 或 Vite+。五份定向测试 46 项、零警告、中文文案和文档仍待复验。

### D5c5 · Windows 定向验收完成（PR #196）

维护者 Windows 实测 D5c5：Vite+ 461 文件格式正确、303 个受检文件零警告和错误；归档 8/8、采样 13/13、历史缓冲区 11/11、历史查询 8/8、TagStore 6/6，共 46/46；中文文案 330 文件及 Markdown 95 份全部通过。日志未独立打印本地 SHA，当前远端候选为 73a06349e114a73465dd6551723820eb02cd589b。维护者明确授权合并。定向测试不代表完整 ready、生产采集、真实数据库持久化或现场工业安全验收。 E-130 关闭。

### D5c6 · FR-012 历史持久化端口候选

新增 9 项正式测试定义，覆盖空缓冲/上限、成功确认及序号、模拟提交后回执丢失、七类错配回执、同步异常、并发提交、单写入者、复合键范围及外部批次改变。既有五份 46 项继续回归，目标六份共 55 项。协作容器 Node.js 22.16.0 独立 node:test 共 30/30（新增持久化 9 项、既有归档 8 项、采样 13 项）通过，0 失败。新增测试采用原 Vitest 用例逻辑及 Node 断言适配（仅替换测试入口及相对导入）；既有归档、采样为此前独立对应场景。源码本地 Git Blob：tag-history-persistence.ts 9a9d52cfbaec98c7ca82cee942a762df953b0d54、tag-history.ts 28a2cc4e90135ebdf658ed9ff67ed701dd77632b、tag-store.ts 78e22557523275fecb9e6172cc6b02230c60c58b；新增仓库测试还原导入后的 Blob f5e514878ad8306431c4d107149bfc3665e07dce。未运行正式 Vitest、Vite+ 或完整 ready；模拟端口不代表真实数据库事务、幂等约束或崩溃恢复。

Windows 待执行 `vp check`、`vp test run packages/core/test/tag-history-persistence.test.ts packages/core/test/tag-history-archive.test.ts packages/core/test/tag-history-sampler.test.ts packages/core/test/tag-history-buffer.test.ts packages/core/test/tag-history.test.ts packages/core/test/tag-store.test.ts`、`pnpm run messages:check`、`pnpm run docs:check`；完整 ready 待执行。

### D5c7 首个 MVP 集成分支验收矩阵（待执行）

D5c6 的维护者实际定向结果：vp check 463 格式/305 受检零警告错误，六文件 55/55，messages:check 332 文件，docs:check 95 份。合并提交 4aabaa8a49e944daa3fe3c4232edc3f22cc7dd0c。

D5c7 候选新增规范编码 4 项、真实 PostgreSQL 归档 5 项、共享模拟 Runtime 3 项。真实数据库测试仅允许显式 SCADA_TEST_DATABASE_URL 指向本机 adui_scada_test，新增迁移须先验证 Prisma Schema、生成 Client，再经明确隔离环境授权部署；不执行 reset，不使用普通开发库/生产库。完整门禁包含 ready、UI/Studio、Tag CRUD、工程互通、草稿安全、版本及多标签、历史迁移、发布预检、SSE 与故障恢复。新增双端导入模拟验收：由 Studio 导出同一工程，另一框架导入运行；选择多页面，验证类型匹配、unknown BAD、不访问服务器、趋势单 Tag 和 CSV 真实质量；错误 JSON 保持当前会话，切换/返回/离开清理定时器，正式发布路由不变。模拟导出不代表数据库历史查询。未执行的门禁一律标为待执行，不要求维护者逐小批复验。

#### D5c7 独立契约检查记录

协作环境通过 GitHub 读取当前源码，针对实际历史缓冲、规范编码与本地模拟模块仅擦除 TypeScript 类型后进行独立 JavaScript 执行，工程解析使用已校验形状的替身，时钟与定时器采用可控替身。8/8 场景通过：原始值及质量往返、负零保留、批次与派生字段边界、损坏记录拒绝、模拟快照类型、单订阅及 120 秒窗口、切换隔离与停止回收、趋势断点及 CSV 文本保护。来源 Blob：tag-store.ts 78e22557523275fecb9e6172cc6b02230c60c58b、tag-history.ts 28a2cc4e90135ebdf658ed9ff67ed701dd77632b、tag-history-record-codec.ts 5f6eefe3c3ef2c28a726b1b3ef4a606e4f132110、local-project-simulation.ts 6d8ff8b7d342f4152d4a0d06986ba93a6942050c。

另外对 schema.prisma b4d60d7122f13a0e8f3da9fc3fa54c79c9372816 与 migration.sql 8eafcbee4bb2c7c7101b7f1e68d8834ccd7db9d6 独立静态检查 8/8：单事务、两表及 15 个物理字段中文注释、关联说明、复合外键名称、查询索引和反向关系。现有全新库迁移验证脚本动态枚举迁移目录，无须固定数量调整。

以上不是正式 Vitest、Prisma validate、Vite+、类型检查、真实数据库或浏览器验收。协作容器 Node.js 22.16.0 低于仓库最低 22.18.0，未安装 pnpm/Vite+，无法解析 GitHub 与 npm Registry 域名；PR #198 初始提交未返回 CI 运行记录。保留 Draft，继续将完整质量链及实际浏览器作为统一验收前置条件，不请求维护者执行中间定向验收。

#### D5c7 · E-131 React 运行页语法阻塞修复

维护者 Windows 首次执行 PR #198 的 vp check --fix 在 RuntimePage.tsx:123:4 遇到 Unexpected token，格式化失败，后续质量门禁未执行。远端旧 Blob d2a50e98e4d0277990dacbbc87e6025deba83811 经完整文件回读确认残留旧 Effect 和重复 svg 声明。仅删除残留；修复提交 15f98671dfe5f8a01c35f463b0b1cdeb040faef2 的 Blob 5ce8ad1f52d20b72a3d0c7ce5f7d8ca845e148fb 与容器完整文件 git hash-object 一致。Node.js 22.16.0 / TypeScript 5.8.3 的 TSX createSourceFile 解析诊断由 3 条降至 0 条；未执行项目真实 TypeScript 6、Vite+、Lint、Vitest、数据库和浏览器。维护者先在最新分支执行 vp check --fix、vp check 与 pnpm run typecheck:web，再继续统一验收。

#### D5c7 · E-131/E-132 实测及 E-133 修复

维护者 Windows 按 db:validate → db:generate → build:core → vp check --fix → vp check 执行，Prisma 7.10.1 Schema 校验/Client 生成、Core 编译完成；469 文件格式正确、311 受检文件零警告错误。原 TSX 语法阻塞与因旧生成产物造成的 25 项类型错误消失。独立 Web 检查在 React tsc --build 报 4 项 TS1294，后续检查尚未运行；日志无 HEAD，不将结果严格绑定到某提交。

修复共享 Core 两个历史类的四个参数属性，改为显式只读字段赋值；远端提交 b0c1d7f7fc4eccbe91d9c46431f34a3bd599290e、1098b214e4d89fa98719ce017aca99765510dc37。协作端使用 Node.js 22.16.0/TypeScript 5.8.3，对实际构造函数摘录（最小依赖类型声明）执行启用 erasableSyntaxOnly 的严格编译实验，修复前四项 TS1294、退出码 2，修复后零项、退出码 0；Node 原生类型擦除构造验证通过。该实验不代替完整 TypeScript 6 项目检查。

本次复验顺序：db:validate、db:generate、build:core、vp check --fix、vp check、typecheck:web、typecheck:server、messages:check、docs:check。前序门禁通过后再运行原有历史专项、ready 与隔离数据库及双端浏览器验收。禁止根据本次局部检查执行自动合并或生产数据库操作。

#### MVP · 依赖升级独立分支验收门禁（待执行）

维护者此前 Windows 日志显示旧依赖下 Prisma 校验及生成、Core 构建、Vite+ 469 格式文件及 311 受检零警告错误、独立 Web/Server 类型检查、79 文件 956/956 单测、6 文件 63/63 HTTP E2E、React/Vue 构建通过；该记录不能覆盖新依赖。

升级候选按维护者 Registry 输出更新 Catalog，普通外部 npm 依赖采用 ^，TypeScript 固定 6.x 范围。Vite/Vitest 保留与已安装 Vite+ 精确配套的版本，依赖检查脚本将核对其实际 package.json 声明。Prisma 8 RC 需要单独迁移，不改变现有 Schema、迁移、事务或安全门禁。按维护者最新要求保留 Node.js 24.18.0、Node 类型 ^24.19.2，三个 Dockerfile 使用 Node 24.18.0 基础镜像。维护者已报告全局 vp upgrade 从 1.5.0 成功更新为 1.8.0，项目内依赖安装、pnpm 12.23.0、Tauri Rust 依赖及新版 Docker 镜像仍待实际验证。

实际验收顺序：Node.js 24.18.0 与 pnpm 12.23.0 → pnpm install --no-frozen-lockfile → pnpm install --frozen-lockfile → pnpm run deps:check → Prisma Schema 校验/Client 生成 → Core 构建 → vp check --fix / vp check → 独立 Web/Server 类型检查及完整 ready。桌面端在原 Cargo.toml 所在目录执行 cargo update、cargo check --locked，并复验两端 MSI 构建。提交真实生成的两份锁文件前不得合并。Docker 镜像仅配置升级，禁止启动已有数据库卷；备份恢复演练、PostgreSQL 主版本迁移、Redis 数据兼容、Keycloak 登录与隔离库测试另行验证。协作端没有实际执行 Registry 解析、Cargo、Docker 或正式测试。

#### MVP · 依赖升级 Windows 实测与合并范围

维护者 Windows 在 f99b2a483037041346e6269c0728bdeb2b64254a 拉取后使用 Node.js 24.18.0、pnpm 12.23.0、Vite+ 1.8.0 实际完成依赖安装与冻结锁文件复验，依赖目录 13 清单 / 54 Catalog 项通过，Vite+ 469 格式文件 / 311 受检零警告错误，独立 Web 与 Server 类型检查通过，Vitest 5.1.1 单元 79 文件 956/956、HTTP E2E 6 文件 63/63、文档 95 份及 React/Vue 构建通过。日志末尾显示 NestJS 构建的 Prisma Client 生成完成，未独立打印 ready 最终退出码。维护者随后提交 9f1ff67f1230c1d27051fa564d685be4463dd96e，锁文件、供应链精确例外清单与 Vue 格式调整已在 GitHub 核对。React 有一个超过 500 kB 的分包警告，不影响该次构建成功。

Rust Cargo.lock 未更新，仍锁定 tauri 2.12.5 与 tauri-build 2.7.4；恢复原 Cargo.toml 的 2.x 声明，避免合入已知不匹配的冻结锁文件。桌面 Rust 升级另行执行真实 Cargo 解析与构建。维护者明确授权 PR #199 合入 MVP 集成分支，而非 main；该授权不等价于真实 PostgreSQL、Redis、Keycloak、浏览器、桌面或生产环境升级验收。未启动新 Docker 镜像、未迁移或清空数据库。Prisma 8 将在独立候选分支渐进迁移。

#### MVP · Prisma 8 第一阶段验证记录（2026-11-24）

基线为 PR #199 合并提交 9424b167a78f8ab3b4a85683ce03249ed8786d80。已读取 Prisma 官方 PostgreSQL 渐进迁移指南，新增双版本配置与独立契约生成入口。协作容器 Node.js 22.16.0 运行新兼容 CLI 解析测试 `node --test prisma7-cli.cases.mjs`，4/4 通过、退出码 0；实际测试为临时模拟安装包目录中的清单及入口解析，不执行 Prisma CLI、不连接数据库。源码 Git Blob c5428de111a2463fc242120ff8d705a7fe997cec、测试 Blob 7beb2e40b76c883871cebf3ef1a209a63b7810a2 与远端一致。

正式验收顺序：在 Node.js 24.18.0 与 pnpm 12.23.0 环境通过真实 Registry 安装并生成锁文件，冻结安装，核对 prisma 和 prisma7 CLI 主版本；执行 db:validate、db:generate、db:prisma8:emit、test:docker:db、空库迁移脚本的离线保护用例与完整 ready。需要提交真实生成的 pnpm-lock.yaml 和 Prisma 8 契约文件，检查生成物不包含连接凭据。尚未实际执行新版 CLI、生成契约、数据库迁移、正式 Vite+ 及项目回归，不标记通过。真实 PostgreSQL 测试须明确绑定隔离库，禁止操作现有业务库；迁移所有权仍属 Prisma 7。

#### MVP · Prisma 8 阶段二验证（候选）

PR #200 获明确授权后合并至 MVP 集成分支 e75a763821d6215c6b66a1e01a43051d7c7275b3。前一批 Windows 实际结果仅适用于合并前工具链与业务基线，不自动覆盖本批。协作容器 Node.js 22.16.0 对新 URL 校验源码进行独立断言验证，源码 Blob 42ecba9ee018495c466457e739e1717f351c7b34 与远端一致；接受 4 种合法地址、拒绝 17 种异常地址，21/21 断言通过，退出码 0。该运行未使用正式 Vite+/Vitest、未安装 Prisma 8 依赖、未连接数据库。Windows 待执行冻结安装、两版生成、Core 构建、定向 URL 单测、独立类型检查与完整 ready 并打印最终退出码。真实 PostgreSQL 独立专项需显式提供已存在且已迁移的本机隔离库，遵守 HARNESS；本阶段不运行任何迁移。EMPTY 仅证明不存在工程查询，不证明已有样本及单项错配过滤。

### 2026-11-24 · Prisma 8 只读运行时及历史查询候选

PR #201 的维护者 Windows 日志记录 HEAD `3fe7985a0f5553ee73fb91efff21f7a9330c8a3e`，冻结安装、Prisma 7/8 生成、独立类型检查、974/974 单测、63/63 HTTP E2E、全部构建与 `ready` 退出码 0；真实隔离库专项未提供执行记录。Skills `synced none` 提示仍存在；React 主分包 591.62 kB 提示非构建失败。

下一批新增历史查询候选的五项单测及两项真实数据库专项定义，尚未执行正式 Vitest、Vite+ 或数据库验收。协作环境仅对从远端取得且 Git blob SHA 核对一致的历史读取器、历史对照探针、客户端工厂和数据库专项文件执行 TypeScript 5.8.3 语法解析，四文件零语法诊断；不等价于 TypeScript 6 类型检查或实际运行。真实对照仅针对选中样本所在的 1 ms 时间窗口；空库只验证缺失作用域，不证明已有数据读取一致性。需在本机已准备好的 `adui_scada_test` 隔离库验证，不为制造样本而写入或迁移数据库。

### 2026-11-25 · PR #202 Skills 目录及客户端类型修复候选

维护者 Windows 日志确认 HEAD `81ac5185e6d8f990a65b0a5d0a2b365ed93ff688` 的冻结安装、三项 Skills 同步至服务端四目录、Prisma 7 校验/生成、Prisma 8 契约生成和 Core 构建完成。随后的 Vite+ 报 317 个错误、68 个警告（498 个受检文件），命令链退出码 1；979 项预期单测、63 项 E2E、完整 ready 与真实 PostgreSQL 专项均未获得本批执行结果。

修复候选统一根目录 Skills 同步与列表及契约生成，保留版本检查、现有质量规则和原契约输出路径；共享配置检查拒绝旧的重复副本。另使用固定 ORM PostgreSQL 8.0.0-rc.25 官方公开客户端类型消除 TS2883 候选根因。协作容器 Node.js 22.16.0 执行模拟 CLI 三项测试（3/3，退出码 0），覆盖三个命令的根 cwd、固定配置、子进程退出码、禁止数据库写入与不可信入口；两个脚本的 Git Blob 分别为 e026a2cbedd397eb8c59a415b258d36cc2832cd2 和 eed6146573cd73aeb0360b6c3a7c9c98b345fec6。未执行真实 Prisma CLI、Vite+、正式类型检查或真实数据库。需先迁出本地重复副本（若仍存在），再运行根脚本、核对 Skills 列表和契约哈希、执行完整 ready 及已授权隔离库只读专项。

### 2026-11-25 · PR #202 Prisma 8 CLI 参数顺序复验

维护者 Windows 在 HEAD `5be430a6dec9d071fc1827ee8b47a4f7f6671977` 实际通过 pnpm 冻结安装和原入口测试 3/3；真实 Skills 同步报 `CLI.UNKNOWN_COMMAND`（`--config`），退出码 2。后续列表、配置检查、完整 ready 及数据库专项未执行。E-134/E-135 尚未关闭。

本次按固定 CLI 上游测试修正参数顺序为命令在前、配置选项在后。协作环境 Node.js 22.16.0 加强模拟后复现原入口测试 2/3（退出码 1），修复后 3/3（退出码 0），两脚本语法检查通过；远端候选文件 Blob 与局部实测一致。npm Registry DNS EAI_AGAIN，真实 CLI 未能在协作环境运行。Windows 应先运行 `pnpm run db:prisma8:skills:list` 验证配置解析及根目录，再运行同步、列表、配置检查和原有完整验收。

### 2026-11-25 · Prisma 8 根目录 Skills 真实同步通过及本地残留

维护者 Windows HEAD `a141b5a58eba622fb89a6f09f1a23fc2640b79a0` 的 Node.js 24.18.0 环境实际通过 CLI 入口测试 3/3、真实 Skills 列表、同步和再次列表。项目目录为仓库根，check enabled；prisma-8（8.0.0-rc.25）和 prisma-platform-core-concepts（8.0.0-rc.35）均指向 .agents/skills 且 synced。原 CLI.UNKNOWN_COMMAND 阻塞解除。同步自动移除孤立 Composer Skill；Git 显示其单一跟踪文件被删除。config:check 正确拒绝 apps/server/.agents/skills/prisma-8 本机残留，整条命令链退出 1。

远端完整 Git 树核对：四个服务端 Agent 目录均没有跟踪文件；Composer Skill 不在 skills-lock.json 中，当前实际同步列表未包含该技能。候选分支仅删除根目录这一孤立跟踪文件并更新文档，保留全部脚本、依赖和质量保护。需维护者备份迁出本机旧副本，再验证列表、重复同步、配置检查、契约生成及完整 ready；未执行数据库迁移或真实只读专项。

### 2026-11-25 · PR #202 根目录治理及类型检查通过，文案门禁修复

维护者 Windows HEAD `e281d595efec99724798b837a1dc646435e8bdff` 实际备份迁出 12 个旧 Prisma 技能目录；CLI 3/3、真实根目录同步和列表、config:check 退出码 0，Git 当时干净。两项包内技能均 synced，check enabled。Prisma 7 校验及 Client 7.10.1 生成、Prisma 8 Contract 生成和 Core Node 构建通过；Contract 输出仍在 apps/server/src/generated/prisma8，storageHash 为 054113c40b1e6f3b7609641e09868e45c0e969d8035e6e1376d10ac3e5148424，未见 Skills 过期提示。vp check --fix 与 vp check 均通过，482 个格式文件、324 个受检文件零警告、Lint 或类型错误。原 TS2883 不再出现。

ready 在依赖目录检查（13 清单、57 Catalog）、共享配置检查（10 TSConfig）、环境与 LF 检查通过后，因模拟 CLI JSON 日志触发 messages:check 退出码 1。正式 979 项预期单测、63 项 HTTP E2E、独立类型检查、文档检查、最终构建及真实数据库专项未执行。维护者后续提交 ff92a98167ce01507d43ec45ca80e876d8a4887c，纳入 132 个根 Skills 文件及已格式化的四份自有源码，保留该提交。

本次仅修改模拟 CLI 的 JSON 输出方式及文档。协作端 Node.js 22.16.0 以真实检查器和两个远端一致的入口脚本构造最小目录，复现文案检查退出 1，修改后局部检查 8 文件、入口测试 3/3、语法检查均通过（退出码 0）；不是完整仓库检查。修复后脚本 Blob 为 10aed9bfe70cf8905d82cb23c98daf55d9704bcb。仍须 Windows 全仓 messages:check、两版生成、独立类型检查、完整 ready 及隔离库只读专项复验。

### 2026-11-25 · PR #202 完整 ready 与真实隔离库迁移/只读验收

维护者 Windows HEAD `06a38de6680308a1ed49644450b43e5256f69922` 全仓中文文案 351 文件、CLI 独立测试 3/3、共享配置 10 TSConfig、依赖 13 清单及 57 Catalog、统一环境与 LF、Prisma 7 Schema/Client 7.10.1、Prisma 8 Contract、Core 构建均通过；vp check 为 482 个格式文件、324 个受检文件零警告及错误；React/Vue/服务端独立类型检查、81 文件 979/979 单测（历史候选 5/5、URL 安全 18/18）、6 文件 63/63 HTTP E2E、95 份 Markdown 和 React/Vue/NestJS 构建通过，完整 ready 退出码 0，工作区干净。React 主分包 591.62 kB 超过 500 kB 警告是独立非阻塞优化项，不扩大本批范围。E-134 至 E-138 已完成相应 Windows 工程质量复验。

真实只读专项首次因 URL 门禁拒绝未进入数据库，改为屏蔽输入原始密码、URL 编码并构造隔离地址后，已有工程查询真实 MATCHED；历史阶段仍失败。只读预检确认本机 15432/adui_scada_test、readonly on、迁移表存在，但历史两表及索引不存在，20261124100000_tag_history_archive 未应用。维护者显式确认 DEPLOY adui_scada_test，Prisma 7 migrate status 仅有第八项待应用，deploy 成功，复查 8 项迁移且 schema up to date。随后 Prisma 8 真实只读专项 1 文件 2/2，退出码 0；已有工程 MATCHED，历史为 EMPTY，仅证明缺失作用域查询，不是非空数据验收。未执行 Prisma 8 签名或数据库接管。

### 2026-11-25 · Prisma 7 / 8 / PostgreSQL 历史非空对照候选

维护者明确授权在同一隔离库使用随机专用工程和合成历史数据、结束后清理且暂不合并。新增独立测试覆盖五批十点、四种质量、负零、数值、文本、布尔和 null；十一组严格查询对照（主窗口、首/次毫秒、左右边界、两个真实隔离工程、不同 Tag 及三个缺失作用域），另核对 maxPoints 恰好五条、原生超量哨兵、两版超量与 1001 上限拒绝。原只读专项、业务仓储、Schema、依赖及锁文件不变。写入客户端只接受显式隔离连接、实际数据库与 Schema 预检；只读池独立。夹具清理严格限定三个联合主键，外键顺序及事务内零残留；创建/清理结果未知时不得自动扩大清理或重试，失败诊断脱敏。

协作容器 Node.js 22.16.0、TypeScript 5.8.3 对新增测试语法解析及转换零诊断，LF 通过；与仓库原检查器 Blob 00127f6ba4d622de026246be6fc0eca011099d5d 一致的局部中文文案检查 7 文件通过。独立内存模拟执行候选测试的正常路径、错误数据库、非法 URL、创建结果不明、写入失败、排序错误、隔离错误及清理失败八条路径均通过；模拟不是 Prisma 或 PostgreSQL 实测。候选测试 Blob 为 f1e180cacb5467b3f65da48efac684f49b1d38f1。当前容器无固定依赖、pnpm、PostgreSQL 实例且 npm Registry 无法解析，未执行正式 Vite+、TypeScript 6、Vitest、完整 ready 或真实新专项；必须由 Windows 复验后方可认定非空 MATCHED。

### 2026-11-25 · PR #202 非空历史对照真实验收及合并

维护者 Windows 在 b12727f7f457afa473f320139c4f683dae09ef44 拉取后执行两版生成、Core Node 构建、vp check --fix/vp check（483 格式文件、325 受检零警告错误）、352 自有文案文件、服务端独立类型、95 Markdown，退出码 0。真实只读专项 2/2（工程 MATCHED，历史 EMPTY）；独立非空三方对照 1/1，测试执行 665 ms，整个专项 1.92 秒，专用夹具清理通过，退出码 0。完整 ready：81 文件 979/979 单测、6 文件 63/63 HTTP E2E、CLI 3/3、双框架/服务端类型和构建通过，退出码 0。React 591.62 kB 主分包警告仍为非阻塞优化项。维护者提交 b87eb651bb2a1665c3628bb504bfc838640efa14 的格式差异已逐行核对，仅 7 行新增、9 行删除，最后本地执行 SHA 未单独打印，不能绑定该远端 SHA 为直接实测证据。维护者明确授权后 PR #202 Squash 合并至 feat/mvp-first-integration@f649105aafb635a8519f1fb6eed47809e756435c，主 MVP PR #198 继续 Draft。

### 2026-11-25 · Prisma 8 历史写入事务候选

新增独立候选仓储、五项 Vitest 单测源文件和真实隔离库写入专项一项；正式 Prisma 7 仓储、只读探针及三方对照、依赖与锁文件、Schema 和迁移保持不变。写入使用 Prisma 8 固定版本 rc.25 官方公开事务类型，已核对该版本的 raw.sql/affectedCount、SQL builder insert、事务 ReadCommitted/timeout、原生 SQLSTATE 归一化及默认标记警告源码与测试。真实专项覆盖首次与重复提交、两版互相重放、跨版本同内容竞争、新版不同内容竞争、负零与内容/顺序冲突、只读拒绝、复合外键、真实唯一约束回滚、回滚后同键正常提交、真实租户/工程隔离、清理与释放；尚未运行。

协作容器 Node.js 22.16.0 / TypeScript 5.8.3 对三个新增 TS 文件语法解析和转换零诊断、LF 通过；复用原中文文案检查器（Blob 00127f6ba4d622de026246be6fc0eca011099d5d）局部检查 9 文件通过。使用模拟 Core 编码器及测试接口执行五项候选校验源用例 5/5；用模拟 Prisma 事务接口执行首次/重放、错误库、只读、异常计数、部分写入、明细异常、缺失批次、缺失记录、未知提交结果及无效输入的 11 条控制路径 11/11。以上为局部和模拟验证，未运行正式 Vitest、TypeScript 6、Vite+、完整 ready 或 PostgreSQL。npm Registry DNS EAI_AGAIN，容器无固定依赖、pnpm 或 PostgreSQL。新增文件远端 Blob 须与局部验证版本一致；Windows 需先生成两版客户端、构建 Core 并通过格式/类型/文案/文档，正式定向五项单测、真实写入专项及原只读/历史三方对照、完整 ready，才能进入合并验收。

### 2026-11-25 · Prisma 8 工程版本持久化候选验收

PR #203 的维护者 Windows 实际验收记录：984/984 单测、63/63 HTTP E2E、四项真实数据库专项、完整 ready 退出码 0，最终工作区干净；最终测试对应 SHA 未单独打印。已按授权合并为 2b0030232a32745f944373cdeb68cc559e208ffd。

新批次新增五项请求边界单测定义及一项真实 PostgreSQL 综合专项定义，覆盖双版本创建/追加、三项 ACL、初始未发布状态、CAS、SHA-256、成功审计、唯一约束故障回滚、跨租户与只读拒绝、精确清理。已通过 GitHub 接口回读源码并核对写入一致；协作容器 Node.js 22.16.0、TypeScript 5.8.3，无 pnpm，GitHub 域名解析失败，未执行固定版本 TypeScript 6、Vite+、Vitest、ready 或 PostgreSQL。必须由维护者 Windows 实测后才能认定新候选通过；不得自动重试或执行迁移、签名。

### 2026-11-25 · Prisma 8 工程版本写入结案及查询候选验证范围

PR #204 维护者 Windows 实测最终 HEAD `07983561cf1bc87a84e9ba3f5519423ee01750c0`：989/989 单测（83 文件）、63/63 HTTP E2E、5/5 真实 Prisma 8 数据库测试、489 个格式化文件、331 个受检文件零错误警告、358 个中文文案检查文件、95 份 Markdown、完整 ready 退出码 0，最终工作区干净。按明确授权 Squash 合并至 `e7718de45e77f40bb46acfe44989d5924c4f75b9`。

本批定义六项工程查询单测、一项真实 PostgreSQL 综合专项。综合专项使用两个随机租户、三个随机身份及四个复合工程键，生成十二个连续修订并验证两位数数值排序、稳定游标、五项双版本查询、权限隔离、摘要篡改拒绝、旧 head 预检拒绝、撤权与零残留；正常查询前后对照专用记录。查询候选不执行 DML，夹具准备、故障注入及清理由专用测试执行。

已通过 GitHub 接口写入与回读，检查根脚本 JSON 可解析，并修正文本化修订号排序风险。协作容器实查 Node.js 22.16.0、TypeScript 5.8.3，pnpm 不在 PATH，GitHub 域名解析无结果；无法直接拉取并执行项目固定工具链。本批没有实际运行 TypeScript 6、Vite+、Vitest、ready 或 PostgreSQL。Windows 必须实际执行新增六项单测、五个数据库专项入口和完整 ready；预期 995 项单测、63 项 HTTP E2E、6 项 Prisma 8 数据库测试，不得作为已通过记录。

### 2026-11-25 · Prisma 8 查询结案及发布候选验证范围

维护者在 PR #205 最终 HEAD `37f5d89761bf51c8fa5b48e153e0f3e7b91f6ebe` 实测 492 格式文件、334 受检文件零警告错误、361 中文文案、95 Markdown、6/6 定向查询、995/995 全量单测、63/63 HTTP E2E、6/6 Prisma 8 真实数据库用例、完整 ready 退出码 0，工作区干净；按授权合并至 `d7d768100771a615708de11602a8a1ba40b851fe`。React 仍有既有大于 500 kB 分块提示，不影响此次构建成功，不属于本后端迁移修复范围。

新批定义五项发布请求及默认门禁单测和一项真实数据库综合专项；覆盖未发布与已发布指针对照、默认门禁零写入、隔离测试门禁下双版本幂等、跨版本并发 CAS、编辑与发布水位分离、真实指针 CAS 失败后的事务回滚、撤权与会话失效以及夹具零残留。未运行项目固定工具链或真实数据库；实际通过须以 Windows 日志为准。此处事务回滚表示 PostgreSQL 原子性，不是历史发布回滚执行能力。

按维护者本轮明确要求，常规批次不重复执行完整 ready；本批需 Vite+、服务端类型检查、中文文案与文档检查、关联发布/安全门禁定向单测及新增真实发布数据库专项。阶段集成与 MVP 验收继续保留完整 ready；涉及共享契约、依赖、Schema 或跨模块变化时增加对应回归。

### 2026-11-25 · Prisma 8 发布候选结案与身份会话专项

维护者 Windows 在 PR #206 最终 HEAD `ecdb4abec813b2f93fec48970214f5d9c97edaf1` 实测 38/38 定向单测（新版发布 5、旧版发布 19、安全门禁 14）、1/1 真实 PostgreSQL 发布专项（1229 ms）、495 格式文件、337 受检文件零错误警告、服务端类型检查、364 中文文案、95 Markdown，工作区干净。按明确授权 Squash 合并至 `be332e87977b60ee6fae13de33d8d0c9f0fd0f39`。按增量验收约定未重复执行完整 ready。

本批定义四项输入单测及一项真实 PostgreSQL 综合专项：两个随机租户、同名主体、随机 Issuer 下精确外部身份绑定，双版本会话互认、摘要与时效、旧 Bearer 不升级、跨会话 CSRF 拒绝、跨租户及并发撤销、过期、未来签发、主体停用、专用夹具精确清理。固定阶段脱敏失败，不自动重试。GitHub 源码写入回读一致性和脚本 JSON 检查属于静态协作检查；本批未实际执行 Vite+、项目 TypeScript、Vitest 或 PostgreSQL，待维护者执行增量验收后方能认定通过。OIDC 登录事务、生产认证 Provider 和真实 IdP 端到端不在本批范围。

### 2026-11-25 · Prisma 8 身份会话结案与 OIDC 登录事务验证范围

维护者 Windows PR #207 最终 HEAD `7ac87c77a2e8a6ae3577bc631f1ecd7c885f79f4` 实测 498 格式文件、340 受检文件零错误警告、服务端类型检查、367 中文文案、95 Markdown、39/39 定向单测（候选 4、身份 13、Guard 10、回调 12）、真实 PostgreSQL 专项 1/1（738 ms），工作区干净。按明确授权 Squash 合入 `46d3142ae6afa156baf4de0771127ad553a51b6f`。本批未重复完整 ready。

新批定义五项输入及脱敏测试、一项真实 PostgreSQL 综合专项；真实专项先核对现有 OIDC 迁移登记与表、索引，使用两个随机专用 Issuer 和合成 Discovery 元数据。验证 Prisma 7/8 互相创建及消费、独立 PKCE challenge 复核、摘要与五分钟时效、跨浏览器及 Issuer 拒绝、跨版本并发恰好一次成功、过期与未来创建、跨 State 密文/Nonce/路径篡改的拒绝及不可恢复消费、138 条本 Issuer 过期记录按 128+10 回收、其他 Issuer 及未过期记录保护、已确认主键精确清理。测试不启动后台清理定时器，不连接真实 IdP，不读取任何真实凭据。

协作端已通过 GitHub 源码写入回读与根脚本 JSON 检查；本地 Node 22.16.0 环境无 pnpm 且 GitHub 域名解析失败，未执行仓库固定 TypeScript/Vite+/Vitest 或 PostgreSQL。新候选的增量质量、相关单测及真实数据库专项仍待维护者 Windows 执行，不以旧 PR 成功代替本批实测。

### 2026-11-25 · Prisma 8 OIDC 登录事务结案与工程 ACL 专项

PR #208 维护者 Windows 实测 501 格式文件、343 受检文件零错误警告、服务端类型检查、370 中文文案、95 Markdown、30/30 单测（候选 5、现有登录事务 13、回调 12）、真实 PostgreSQL OIDC 专项 1/1（1178 ms），日志末尾 HEAD 为 `30a58668771a8c687ba2fad9435e093efecec34e` 且 Git 工作区无输出；远端最终 HEAD `f032c8ec0eb7778e420f666562b020b594baede5` 多一次三文件排版提交，已核对未发现业务逻辑变化。按明确授权 Squash 合入 `920c95d1669bc4a0e8e9f5cb8617caae60d67318`。本批不重复完整 ready。

新批定义七项 ACL Guard 单测和一项真实 PostgreSQL 综合专项。测试核对实际隔离库及 release:read 迁移登记、授权索引、工程/身份/会话/发布结构，构造两个随机租户、四个身份和三个工程；比较两版 Guard 六项独立权限、同名工程、同名主体、跨租户/跨工程拒绝、缺失权限及未知动作、固定审计码，正常查询前后对照全部专用工程记录。在专用工程排他行锁内仅撤销指定版本追加和发布读取权限，验证两版 Guard 再次拒绝、两版仓储拒绝已通过 Guard 的过时请求、编辑及发布状态和其他权限不变，最后按确认创建的复合键精确清理。测试不执行发布、回滚、真实 IdP 或设备操作。

协作容器实查 Node.js 22.16.0、TypeScript 5.8.3，pnpm、vp 不在 PATH，GitHub 域名解析无结果；通过 GitHub 接口写入回读、LF、根脚本 JSON 和差异范围核对，不等于运行项目类型检查、Vite+、Vitest 或真实 PostgreSQL。新候选须经维护者 Windows 增量验收，未替换正式 Prisma 7 Guard 或迁移管理。

### 2026-11-25 · Prisma 8 ACL 结案与迁移接管预检

维护者 Windows PR #209 日志 HEAD `1289802eca1d442cc13b8a63cd88dcb90cd922c7`：504 格式文件、346 受检文件零错误警告、服务端类型检查、373 中文文案、95 Markdown、43/43 定向单测（候选 7、身份 13、会话 Guard 10、纯权限策略 13）、真实数据库 ACL 专项 1/1（1013 ms），工作区无输出。远端后续三文件排版 HEAD `7b9d0e0cbedf392259d18ffddefefa39248abf57` 已复核，明确授权后 Squash 合入 `8bc5458deb13541c90f7b8b2e298ca2b94a296c5`。未重复完整 ready。

本批静态读取固定八项历史 SQL 和生成 Contract，确认十二业务表、八十五列、十二主键、十三外键、三十六 CHECK、二十非主键索引，存在末次发布事件复合外键和 CHECK 表达差异。定义九项离线测试和人工只读隔离库预检；验证历史校验和、实际只读边界/标记、字段、已验证约束、主外键完整形状、六项 ACL 实际定义、索引和中文注释。目录指纹含实际定义与注释，其他 CHECK 及默认表达式完整语义、索引细节待独立参考库比对。预检通过仍为 REVIEW_REQUIRED，禁止签名。

协作端实查 Node 22.16.0、TypeScript 5.8.3，缺少 pnpm/vp，GitHub 域名解析失败。GitHub 文件回读、JSON、仓库静态盘点不等同于 Windows Node 离线测试、Vite+ 或 PostgreSQL 实测；本批待执行增量质量、CLI 限制回归、九项离线测试及真实只读预检。

### 2026-11-25 · PR #210 迁移预检参数化测试告警修复

维护者 Windows 日志显示 507 个格式文件、348 个受检文件零错误及一条 typescript(no-misused-spread) 警告，375 个中文文案文件和 96 份 Markdown 通过；未提供九项离线测试、真实 PostgreSQL 预检和本地 HEAD 的完整记录。E-140 仅将五组异常参数改为具名对象，原有九项测试定义及全部断言不变；修复提交 `5cee243361a1ebfac7560b019b5e59a05db0fe0e` 回读一致。Node.js 22.16.0 独立参数等价性 5/5 及独立示例语法检查通过，TypeScript 5.8.3 声明生成确认类型分离；不等于运行仓库实际九项测试或 Vite+。待维护者 Windows 执行 CLI 3/3、预检 9/9、Vite+ 零警告错误、中文文案、文档与真实只读预检并记录目录指纹。PR 保持 Draft，接管状态仍需审查，禁止签名。

### 2026-11-25 · PR #210 结案及独立参考库目录对照候选

维护者 Windows HEAD `06990a536c931884f4d593e51a336cb7f9843329`：CLI 3/3、离线预检 9/9、507 个格式文件、348 个受检文件零警告错误、中文文案 375 文件、96 份 Markdown、增量退出码 0。实际只读预检退出码 0：八迁移、十二业务表、八十五列、三十六 CHECK、十三外键、二十非主键索引；UTC、Prisma 8 标记不存在，契约存储哈希 `054113c40b1e6f3b7609641e09868e45c0e969d8035e6e1376d10ac3e5148424`，目录指纹 `73079d85974ddc9cbabf59741f2a4a94dd7bfff3d70a23bab27a7283456e8c52`，REVIEW_REQUIRED，签名许可否。日志末尾两份脚本有格式化变更；最终远端 `adc3d55f1b4adb59d55a15213c9315641a4e1bc9` 差异核对为排版，按授权 Squash 合入 `24391af99df003f19dbcec5a46d891874df03be7`。E-140 关闭，未运行完整 ready。

新批在原九项定义上增加六项离线测试：互相隔离的 URL 白名单、逐项一致、默认表达式/CHECK/注释/索引定义偏差、实际参考库名及标记/登记、查询上下文差异、失败即停止。真实对照使用独立已重放历史的本机 `adui_scada_fresh_prisma8_ref` 与原验收库；两个快照各自通过同一基线预检后逐项比较现有受检目录行并检查指纹。双方必须具有相同 PostgreSQL 完整版本号、编码、collation/ctype、UTC、DateStyle、search_path 及 standard_conforming_strings。禁止在对照期间并发 DDL；目录查询覆盖范围不包含所有 PostgreSQL 对象、主键索引底层属性、所有权限/RLS/触发器及部署行为，不以匹配结果授予签名。

协作容器 Node.js 22.16.0、TypeScript 5.8.3：与远端 Blob 一致的目标保护文件通过独立严格 tsc，新增 CLI 源码及重建的快照/对照函数摘录通过 Node 语法检查；用模拟查询、历史和目录验证器执行独立九项检查 9/9，CLI 缺少连接和额外参数均退出 1。目标保护及 CLI 本地 Git Blob 分别为 `3a84f36578e21973f9f1c4fe6a60e391e80fd32b`、`de06652b80bb12c6596144c50adb3e492562d852`，与远端一致。此处不等于正式十五项离线测试、固定版本 Vite+、完整 ready 或真实 PostgreSQL 已通过；协作端缺少 pnpm/vp，GitHub 域名无法解析。参考库尚未确认建立或重放，待维护者明确授权和提供独立重放证据。不得自动建库、部署、签名或重置。

### 2026-11-25 · PR #211 结案与独立参考库历史重放候选

维护者 Windows 初始 HEAD `32afc5e33bc6832179ee7708b5288469a8c6786d`：Prisma 8 Contract emit 成功，CLI 3/3、迁移预检与对照离线 15/15、Vite+ 508 个格式文件与 349 个受检文件零警告错误、服务端独立类型检查、376 个中文文案文件、96 份 Markdown，增量退出码 0。原隔离验收库真实只读预检回归退出码 0，标记不存在、UTC、目录指纹 `73079d85974ddc9cbabf59741f2a4a94dd7bfff3d70a23bab27a7283456e8c52`，与 PR #210 一致。最终 HEAD `a50077a417959520ab6dd5790116b17f1cbc75a9`，工作区干净；远端两份脚本格式化差异已按归一化空白、尾逗号及字符串常量、SQL 模板核对。维护者明确授权后 Squash 合入 `ce8c1fefe1a3a8bcd56fb42f30274cdd6109d97d`。真实独立参考库对照尚未执行；本次合并不代表迁移管理接管通过，未重复完整 ready。

新批定义独立参考库重放门禁：仅已由维护者手工建立的本机 127.0.0.1:15432/adui_scada_fresh_prisma8_ref，显式确认参数、独立 Prisma 7 配置、锁定 7.10.1、已验收指纹和契约、实际只读空库/其他会话检查、固定 deploy/status 子进程。两次部署均需双库目录与已验收指纹一致，并比较八项迁移登记的 ID、名称、校验和、开始/完成/回滚时间及步数；失败即停止，无自动重试、恢复、清理或签名。空库元数据检查不是所有 PostgreSQL 对象的完整枚举，也不是跨 Prisma CLI 的原子排他锁，必须由维护者确认全新建立且无并发 DDL/连接。

协作容器 Node.js 22.16.0 已使用与远端 Git Blob 一致的重放脚本 `8121c6edc1d38fa1db82bc66d84571461dbc498f`、九项测试 `1c44c68bd14033fde4b96686b9e3994ab60d3a6c`、专用配置 `9fa6eaf7cde1d10ec829a98c61f50e92f8a5cca7`，及实际原 URL 门禁和 Prisma 7 CLI 解析器。Node 语法检查通过，新增九项测试 9/9；该局部重建目录中的未调用原预检集成导出使用拒绝执行替身（异常类原样保留），不等同完整仓库回归。专用配置使用 defineConfig 恒等替身完成八个输入保护路径 8/8，缺少 CLI 显式连接退出 1；用原中文文案检查逻辑限定三份新增文件检查通过。未执行真实 Prisma CLI 配置加载、pnpm、Vite+、固定 TypeScript 6、真实 PostgreSQL 或完整 ready，待 Windows 验收。未创建、迁移或重置任何数据库。

### 2026-11-25 · PR #212 结案与原生 Contract 候选评审

维护者 Windows 初始 HEAD `ec5a5b3056fae4e0fbb262b5eebdd615f61a88d3` 实际通过 CLI 3/3、预检/对照 15/15、重放门禁 9/9、Vite+ 511 个格式文件及 352 个受检文件零警告错误、服务端类型检查、379 个中文文案文件、96 份 Markdown，增量退出码 0。真实独立参考库八项迁移首次/二次 deploy/status、双库目录对照及迁移登记稳定性验证通过，双方指纹 `73079d85974ddc9cbabf59741f2a4a94dd7bfff3d70a23bab27a7283456e8c52`，MATCHED_REVIEW_REQUIRED、签名许可否，专项退出码 0。远端最终 HEAD `25bc208392f296e7bfc343008b8b6e4259f4f3ad` 额外两份脚本的完整 diff 为格式、尾逗号及 await 括号调整；用户日志未提供最后本地 HEAD 与状态。维护者明确授权后 Squash 合入 `e4afdd4040dca4ebcdfb3a1abfcdb6ff2b86a473`。保留参考库，不再次重放。

新批以物理结构优先建立原生 PSL 模板，静态核对十二模型、八十五物理字段、十三外键、十二主键、二十非主键索引，明确恢复历史六字段外键，不增设冗余唯一约束。运行时采集使用已有双库只读事务与已审查目录指纹，提取普通 pg_get_constraintdef 的 CHECK 外包装内精确谓词并以 map 原名插入 36 项；独立离线生成并审查物理 IR、根、领域字段/映射、关系及生成器。故意不在本候选定义事件反向 currentReleaseState 单值导航，正式过渡 Contract 仍保留原关系；是否支持固定版本替代写法和实际运行时类型兼容待验证。输出位于根忽略目录 .artifacts/prisma8-native，拒绝覆盖旧结果，禁止签名、迁移、Provider 切换或改写正式生成物。

协作容器 Node.js 22.16.0：新增评审模块与测试文件的本地 Git Blob 与远端一致，首次 7/8（E-141），修复后语法检查和实际离线测试 8/8；真实 CLI 包装器及 Mock CLI 测试 Blob `5589af7aa288f1939d75f026008bb176f89987ef`、`76c6b7d80c3f0e896ba824f48bf13553314fcea4` 与远端一致，语法检查、四项进程回归 4/4；新增编排脚本 Blob `4f27db066967d26f80bfe94b41fe217502ce4586` 与远端一致，Node 语法检查通过。以上为真实 Node 运行的离线模拟，不是 Prisma 8 原生 PSL 编译、生成类型应用编译、真实双库采集或完整仓库验收。协作容器缺 pnpm/vp 且 GitHub/npm 域名解析不可用；预检新增第十六项与其余原测试、Windows 固定工具链及真实候选生成待维护者运行。未进行数据库写入。

### 2026-11-25 · PR #213 原生候选真实生成验收与排序警告修复

维护者 Windows HEAD `6fbc054ad0627520c44cc7765a696f68723735d7` 实测正式 Contract emit、CLI 4/4、迁移预检及对照 16/16、重放门禁 9/9、原生评审 8/8，合计 37/37；515 个格式文件、356 个受检文件零错误但 E-142 排序告警一条，服务端类型检查通过，383 中文文案文件与 96 Markdown 通过，增量退出码 0。最终日志 HEAD 同上且 status 未输出修改。随后远端 HEAD `2bedb38ab479a9b650f0f1bbccb4afb673fb7f93` 相对实测 HEAD 的五份脚本差异已核对为格式、尾逗号和引号风格调整，未发现语义变化。

真实原生候选生成成功、受检物理 IR 核验通过，CHECK 36/36，存储哈希 `6eec3e7459bdfa2646dc156bd6eaf22ffe60b0a0eac309622262b9742a0c68cc`，executionHash `a4d7e4794290fb3681a486309f2b191b6a804c75c010f175cdf453bcfc66df79`、profileHash `3916f444a8a17ad749191acf9e08dad97d1a327b88c2f1d45d12f240296aa8b2` 与正式一致，正式生成物不变，评审退出码 0。结果 STORAGE_REVIEW_REQUIRED_RUNTIME_BLOCKED，差异仅报告 ScadaProjectReleaseEvent.currentReleaseState 和 ScadaProjectReleaseState.lastReleaseEvent，签名许可否。Prisma 输出 PN_EXACT_NAME_BODY_COMPARISON 的 36 个已采用 CHECK 提示（预期，仍需后续官方验证），另提示候选 d.ts 无法找到 @prisma/orm-postgres、独立配置的 Skills synced none。该包实际在服务端清单而非根清单，候选位于根忽略目录，类型依赖可见性及独立配置 Skills 作用域需要后续核验；本次不新增根依赖、不关闭 Skills 检查、不迁移产物路径，服务端现有类型检查通过不等于候选 d.ts 应用类型检查通过。

E-142 最小修复提交 `06f427fc44f8e9ff8abb6a8d8a2aacf34c41adce` 及新增回归 `17cf375756e5cc6c05c6a437296d860362e52d38`，局部 Node.js 22.16.0 提取函数四项测试 4/4、语法检查通过，提取片段本地/远端字节数及校验值一致（1624 字节、FNV-1a f02ba9ae）。正式 Windows 新九项测试及 Vite+ 零警告仍待复验。只改变表名排序的显式类型及等价比较器和新增测试，无 PSL、历史 SQL 或数据库变更；保留此前真实候选产物，无须重复重放或重建候选。PR #213 保持 Draft，未获得本次合并授权。

### 2026-11-25 · PR #213 E-142 复验及 E-143 中文注释修复

维护者 Windows HEAD `8252e1fc058b8f517f46efa5d93b7c71a4393633`：原生候选 9/9，Vite+ 515 个格式文件、356 个受检文件零警告/Lint/类型错误，E-142 关闭。中文检查在脚本第 62 行报告一处 JSDoc 缺少中文，增量退出码 1；后续 docs:check 未执行，日志最后工作区干净。E-143 仅补充同一行中文说明，修复提交 `a19457229be7c590850f329f8c0af36f3ef64a9e`，远端 Blob `f187b89caa8e952bbaa08bdd8db7d0b6ef6cc9a0` 回读确认仅一行注释变化。

协作容器 Node.js 22.16.0：原中文检查器 Blob `00127f6ba4d622de026246be6fc0eca011099d5d` 与远端一致，在独立七文件最小夹具实测修复前退出码 1（单处 JSDoc 失败），修复后退出码 0、Node 语法检查通过；按原扫描器单行判定逻辑核对完整远端目标源码，前一处后零处。未执行修复后全仓 Vite+、九项测试、messages:check 或 docs:check，需 Windows 增量复验。仅注释修复，不改变物理 IR 或运行时关系阻塞，不重复真实生成、数据库重放或完整 ready，保持 Draft 和签名禁止。

### 2026-11-25 · PR #213 关闭与原生候选离线运行时兼容评审

维护者 Windows 原生候选 9/9、Vite+ 515/356 零警告错误、messages:check 383 文件、docs:check 96 份、增量退出码 0；E-143 关闭，PR #213 按授权 Squash 合入 `4bada62a85fd099eb7a24857f66e2b411eb6a2bf`，本机 HEAD 已确认。

新批复用已保留的 .artifacts/prisma8-native 真实候选，不运行 emit 或数据库命令。远端静态检查十二个名称含 prisma8 的非测试服务端生产模块未发现两个关系名的直接引用；发布仓储显式读取 lastReleaseEventId 对应事件并验证完整性。新增六项离线测试，协作容器 Node.js 22.16.0 / TypeScript 5.8.3 使用最小独立编译夹具实测 6/6，验证两种关系差异白名单、哈希标识拒绝、虚拟声明和 JSON 实际装载、类型不匹配拒绝、磁盘原件不变及禁止写入。新脚本 Blob `f0c8dcb15b1012513b6fe70a9d72818bb200d46e` 和测试 Blob `2b828b98e8a97c225b9d518df05e9a94c2334a75` 与本地实测一致。CLI 新增原生配置 Skills 只读列表及模拟回归；真实固定版本 Skills 列表、真实候选与正式契约双轮服务端类型检查、全仓 vp check、messages:check、docs:check 尚待维护者 Windows 实测。局部编译器测试不代表实际仓库或固定 RC 类型兼容。仍保持 STORAGE_REVIEW_REQUIRED_RUNTIME_BLOCKED，禁止签名、迁移、重放、DDL 和正式 Provider 切换。

### 2026-11-25 · PR #214 关闭与原生候选实际查询评审

维护者 Windows 在 `c3a03056f7375d9dd4d42969720cb8e6ae6de625` 实测 CLI 5/5、物理评审 9/9、运行时评审 6/6；正式与原生候选服务端离线类型检查均通过；Prisma 两项根 Skills 已同步（ORM Postgres 8.0.0-rc.25、CLI 8.0.0-rc.35）。Vite+ 517 个格式文件、358 个受检文件零警告错误，中文文案 385、Markdown 96，增量退出码 0。最终 HEAD `8310c986a1619a47b9b121d6e3db172b8d8f30cb` 仅两份脚本排版变化，按授权 Squash 合入 `63cdc5d9ff5fca03267a3a52d15cdb9189f3447f`。

本批新增发布关系查询只读探针与七项离线回归。协作容器 Node.js 22.16.0 实测 `node --test scripts/prisma8-native-query.cases.mjs` 7/7、`node --check` 新探针及核心脚本通过；三个远端 Git blob 与本地测试文件一致。离线回归覆盖 bigint、六字段逐项漂移、空关联、事件类型、显式读取差异及错误租户/工程拒绝。真实候选及隔离 PostgreSQL 仅位于维护者本机，真实查询、项目 Node 24、Vite+、中文文案和文档检查待验收。没有执行数据库写入、签名、迁移、重放、生成物覆盖或 Provider 切换。

### 2026-11-25 · 原生候选官方 Schema-only 验证入口

固定 Prisma 8 Skill 的 db verify 为独立诊断；--schema-only 跳过当前尚不存在的 Prisma 8 marker，只检查候选 Contract 对应的数据库结构。新增根目录白名单入口 pnpm run db:prisma8:native:schema:verify，仅使用独立原生配置和受限的本机 adui_scada_test，不接受通用 CLI 参数或 --db URL 命令行参数。包装器先复用现有只读目标 URL 守卫，再通过连接参数强制 default_transaction_read_only=on、5 秒 statement timeout、2 秒 lock timeout 和 search_path=public；密码不进入子进程参数。非验证命令删除测试库环境变量，保持离线 emit 与 Skills 列表离线。未使用 --strict，允许数据库保留不属于 Prisma 8 Contract 的 Prisma 7 历史元数据。CLI 模拟回归扩展为 8 项，覆盖命令顺序、目标白名单、只读会话参数、离线命令隔离及写入命令拒绝。当前仅新增入口与模拟测试，真实 Prisma 8 固定 RC 官方 verifier、Windows Vite+、文案和文档检查尚待维护者执行；未运行 verifier、签名、迁移、基线规划或任何数据库写入。

### 2026-11-25 · PR #216 结案与基线静态覆盖审查

维护者 Windows 实测 CLI 8/8、520 个格式文件及 361 个受检文件零警告/Lint/类型错误、中文文案 388 文件、Markdown 96 份、增量退出码 0。官方 verifier 实测读取 .artifacts/prisma8-native/contract.json，schema only (tolerant)，隔离库 URL 脱敏且显示只读会话参数，Database schema satisfies contract，退出码 0。远端最终 HEAD `adec9fa04873263ac35eef06b22974c24c460667` 与先前提交的差异为三份文件格式化，维护者日志未给出本机 HEAD；按授权合入 `647fd455d901d4786b2fb2c7b4d179290804d3f7`。这不等同严格目录等价或实际基线重放。

协作端直接读取合并提交中八份 migration.sql，按当前历史字面量 COMMENT ON 形状静态提取（非通用 SQL 解析器），确认 121 条注释语句覆盖 119 个不同对象：表 12/12、列 87 条对应 85 字段、索引 22 个，均含中文。permission 字段注释出现三次，最后一次来自 release_read_permission 迁移。两个带注释主键索引分别为 scada_tag_history_batches_pkey 和 scada_tag_history_records_pkey。现有目录查询明确排除 indisprimary，因此已有 20 个非主键索引目录及指纹不覆盖这两项；主键列检查不是底层索引检查。未来独立补充只读核验及负向回归定义见 ADR-0072；真实目录补充查询、离线基线生成、迁移包检查、新空库重放、全量 Windows 质量门禁均尚未执行。协作容器 Node 22.16.0，缺 pnpm/vp，GitHub 域名解析失败，无法在本地完整检出并执行 docs:check。本批仅文档审查，不新增运行时或脚本。

### 2026-11-25 · PR #217 合入与主键索引、精确中文注释补充核验

维护者 Windows `pnpm run docs:check && vp check` 实测 96 份 Markdown、520 个格式文件和 361 个受检文件零警告错误；增量退出码 0、git status --short 无输出，日志未单列本机 HEAD。PR #217 已按授权 Squash 合入 `c228eff92d12f9b643128d6020ef0af239efc43f`。

协作容器 Node.js 22.16.0：新独立补充判定核心和七项合成目录测试实际 7/7 通过，入口语法检查通过；核心 Blob `d36ab0e8e00217ae6a2ef973e528af359d2a88f1`、测试 Blob `d8b83185554eda152f715aa79e0c393042dd4dd4`、真实入口 Blob `28576419e50327d4c983f352613c6d0319d70fed` 均与本地验证文件一致。再次从合并提交真实八项 SQL 静态核对得到 121 条注释、119 个最终对象、permission 三次覆盖及两个主键索引准确文案。原预检增加三项测试定义，共十九项；七项补充测试及十九项预检测试纳入 ready，真实双库补充核验保持独立执行。未运行 Windows 全仓 Vite+、messages:check、docs:check、十九项预检回归或真实 PostgreSQL 双库专项；容器无 pnpm/vp 且 GitHub 域名解析失败。无真实补充指纹，不能宣布实际目录补充通过。保留旧指纹、原候选及两库，禁止签名、迁移、重放、DDL、生产接管。

### 2026-11-25 · PR #218 真实双库验收与独立离线基线候选门禁

维护者 Windows 验收前 HEAD `7e9362ef4bf6b62b2b1314946d62d21c4c80ed75`，预检 19/19、补充核验 7/7，Vite+ 523 个格式文件及 364 个受检文件零警告错误，中文文案 391、Markdown 96，增量退出码 0。真实两库补充核验原目录指纹 `73079d85974ddc9cbabf59741f2a4a94dd7bfff3d70a23bab27a7283456e8c52` 保持，主键索引 12、最终中文注释 119、补充指纹 `b7ce46a8e3a203dce7a63fc94bbf1a11d0244521b6efc697e64b1b1a34fd02ad`，MATCHED_REVIEW_REQUIRED、签名许可否、退出码 0。远端最终 HEAD `48b71dfd6b4ead3df51b5ea28bffbfca6bdc0e85` 相对此验收起点仅六份文件格式化；经明确授权 Squash 合入 `e98168711a1a52c0bba76adc6fe1ffcda3cd8076`。

协作容器 Node.js 22.16.0 对新增独立门禁执行 `node --test scripts/prisma8-native-baseline.cases.mjs` 的本地等内容文件，九项全部通过，退出码 0；核心及真实入口的 `node --check` 通过。测试使用临时隔离目录及模拟 CLI，实际启动 Node 子进程，不安装或执行真实 Prisma CLI，不连接数据库。核心 Blob `2ef2f72852c54f468d662b029845e8875d966dd2`、测试 Blob `2adadabfe8de7895bfc4d2bb0f3616f346370c77`、配置 Blob `e32064442ff4d63969f9c730cf1f7b95ef87297b`、入口 Blob `cabb8bfc75925533988ed8a303520ce20a9746f7` 已核对与本地文件一致。覆盖固定确认、环境变量白名单、拒绝已有目录和链接、版本/入口路径、真实模拟进程输出、保留原件及失败诊断、非新增操作、占位符、额外对象、空起点/目标/路径/快照异常。协作容器无 pnpm/vp，GitHub 域名解析失败，未执行完整仓库 Windows Vite+、中文文案、文档门禁、真实固定 RC 规划及独立配置类型检查；模拟结果不能替代固定 RC 的实际 JSON/路径/操作类形状。未取得实际迁移包、计划预览或迁移哈希，不能声称基线 DDL 或 119 项注释已经生成或验证。历史与两库保留，禁止签名、部署或 Provider 切换。

### 2026-11-25 · PR #219 实际 RC 离线规划与 E-144 修复候选

维护者真实 Windows：原离线 9/9、原生 9/9、运行时 6/6、Vite+ 527 格式/368 受检零警告错误、中文 395、Markdown 96、增量退出码 0，工作区干净。原真实规划包装器退出 1；按源码控制流官方子进程退出 0，原件复核和 plan.json 解析已完成。远端 612c63be1b7b0e149e98e15281aa1ae4cad0cc0a 相对初始 HEAD 711fb449 仅三份文件格式调整。

维护者上传原始 ZIP（SHA-256 55c1cc0c899095cdcdee3be8bd4e197592706e08b593dda302fa382bbd5b2af2）。实际为 kind=result、commandId=migration.plan、envelope.ok=true、exitCode=0、diagnostics=[]，envelope.result.ok=true/noOp=false、from=null、to=既有原生存储哈希；无 pendingPlaceholders 字段，源码无 placeholder 调用。46 项 additive，包含 1 schema、12 建表、20 非主键索引和 13 外键操作；预览文本统计 12 主键及 36 CHECK，六字段末次事件外键存在，未见 COMMENT ON。完整 JSON 深度相等，三项声明哈希一致。原始迁移标识 f2878cca953d47c94a4eca5b500165a1e623d49ef5a8a6c3e730ddf818bd24bd，原生 JSON 文件 SHA-256 850ef15fcfc0455491ba73f66419f42a394f963b1a99a02870bad5cae964cffa，计划文件 SHA-256 048606f3358a11647bc5abdac19bc516a2145a9e44ad33acf9cc9b54836ee360。上述标识仅记录实物，不代表迁移哈希独立重算、全部 DDL 语义或部署验收。

协作容器 Node.js 22.16.0 在原本地源码施加同逻辑修复（远端保留维护者格式）执行核心、入口语法检查及十二项回归，12/12 通过；独立解包原 ZIP，直接运行修正核心 inspectBaselinePackage，返回 BASELINE_ARTIFACT_REVIEW_REQUIRED、46、签名/部署许可否；计划与 ops 摘要及预览与执行语句逐项一致，声明三个哈希匹配，十个文件复验前后 SHA-256 均一致。未运行完整项目入口或真实 Prisma 子进程、Windows pnpm/vp/全仓中文及文档检查；必须在最新 HEAD 复验 12+9+6 项及 db:prisma8:native:baseline:review。未上传生成物到 Git，不执行 SQL、签名、重放、数据库变更或 Provider 切换。119 个注释仍缺失，非空发布样本及完整 DDL/依赖评审仍阻塞。

### 2026-11-25 · PR #219 结案与固定原生基线 DDL/注释文本审查

维护者 Windows 实测 12/12 基线、9/9 原生、6/6 运行时、Vite+ 527 格式/368 受检零警告错误、中文文案 395、文档 96、真实已有候选复验 46 项，目标、原文及迁移标识与原包一致，退出码 0。日志未单独打印本机 HEAD；远端最终 `fbe2fc2e370ab3cca807311fbb134a40022f5e0e` 相对 `21fcc5472fc0a91a283d924186ba8161fb50fbc8` 仅两份文件排版。经维护者授权 PR #219 Squash 合入 `55688fe7e261bdade6f7f72cb80329d31b1d478b`，E-144 关闭。

协作容器 Node.js 22.16.0 新增 DDL/注释文本回归 8/8，核心语法检查通过。新模块 Git Blob 9e7198de6a190431398e0cdc07e1ad2fb1872d03、测试 Blob fd59ce2feb90cdbd01ff83e42d6676cc6143c904 与实际本地执行源码一致；复用本地此前已验证的注释提取模块等逻辑源码。直接读取维护者上传原 ZIP（SHA-256 55c1cc0c899095cdcdee3be8bd4e197592706e08b593dda302fa382bbd5b2af2）解包的独立副本，十文件 SHA-256 全部匹配，46 项 execute SQL 与根据原生 IR 独立构造的全文逐项匹配，统计 12 表、85 列、12 主键、36 CHECK、20 非主键索引、13 外键；仅篡改临时副本 stderr 一文件后拒绝、恢复后十文件再次匹配，原 ZIP SHA-256 不变。原包无 COMMENT ON。

协作端另从当前合并提交实际读取八份历史 SQL，按顺序提取 121 条 COMMENT ON，permission 三次覆盖，最终 119 项（12 表、85 列、22 索引）。使用 UTF-8 SHA-256（已用空串和 abc 标准向量校验的独立实现）计算八份原文及按对象键字典序、public 限定、LF 结尾的 119 条最终注释审查文本；文本 14907 字节，SHA-256 为 06a47418f3477c263cb19c7a3550a6be3810a4ffd9c22afada7ecd28f6322fb7。用实际原生 IR 的合成注释字典在 Node 核对 119 项对象覆盖；尚未在完整仓库用真实历史 SQL 运行新集成入口，不将独立提取和局部实测冒充完整 Windows 专项。新测试纳入 ready，真实固定包专项不纳入 ready。协作环境无 pnpm/vp 且无法完整检出，Windows 最新 HEAD 的 8/8、12/12、Vite+、中文、文档、DDL/注释集成入口仍待实测。

固定原包字节指纹检查不是官方 migrationHash 算法重算；全文对照不是 PostgreSQL 解析、数据库目录证明、预/后置检查语义或依赖解析证明。未执行迁移源码、自发射、SQL、写库、签名、部署或 Provider 切换。

### 2026-11-26 · PR #220 合入与中文注释独立自发射候选

维护者已提交格式调整 d82078733318d722a1fe5607784966e3c7854fde 并明确授权，PR #220 Squash 合入 66dd3bb6aff59ed158f9373d5e63041bda65d40c。此前 Windows DDL 8/8、基线 12/12、Vite+ 370 个受检文件零警告错误、Markdown 96 份通过，真实原包及 119 项文本审查退出码 0；未将历史验收记录冒充合并 SHA 的重新执行。

协作容器 Node.js 22.16.0 执行新增纯逻辑测试 8/8、核心与测试及自发射包装器 node --check 通过。核心 Blob 7a1ced4c5d6d0515dd20bb7632ea5d02222dbbe5、测试 Blob a4c5290e19b08715cd02d43d3d233e3917a97bae、包装器 Blob 772782980788f43fff02c71e381532e02c8a701f 均与本地测试或语法检查文件一致。另从维护者上次 Windows 注释审查日志提取 119 条真实 COMMENT ON 文本，SHA-256 06a47418f3477c263cb19c7a3550a6be3810a4ffd9c22afada7ecd28f6322fb7，实际转换得到 85 字段、22 索引、12 表操作。测试覆盖 SQL 字面量、对象限定、拒绝非法输入、脚手架锚点、干跑输出、原 DDL 全字段与注释操作、元数据及重复标识。测试夹具不是官方实际迁移源码或实库结果。固定依赖未安装，协作容器无法直接检出仓库，未运行真实 self-emit、migration check、集成入口、Windows Vite+、全仓文案及文档门禁；真实候选产物与新 migrationHash 均未获得。保留原包及历史，不连接数据库、签名、部署或切换 Provider。

### 2026-11-26 · PR #221 Windows 首次增量验收通过，真实脚手架门禁失败（E-146）

维护者 Windows HEAD 87cade6f47db3bcd13a53f05f183ce108b89289a，8+8+12=28 项测试通过，Vite+ 533 格式/374 受检零警告错误，中文 401 文件、Markdown 96，增量退出码 0。真实入口十文件、46 项 DDL、119 项注释及原有指纹匹配；脚手架固定文本匹配拒绝，退出码 1，未启动 self-emit。远端维护者已提交格式调整 2ed5199726d95b8a8cc21e57a0186930b9f324dc。原包与历史保留。

本次在该格式化版本上修复 E-146，改用已存在的 TypeScript 语法树，只在原导入与数组最后节点插入文本，原操作表达式逐字对照，保持固定文件指纹、原操作、目标及官方自发射门禁。协作容器 Node 22.16.0、TypeScript 5.8.3 对同逻辑本地代码实际执行 10/10 及语法检查；新增排版变体与错误结构回归。未取回原 ZIP migration.ts，具体失败断言未知；未运行固定 RC、仓库 TypeScript 6、Vite+ 全仓及真实集成入口。需 Windows 复验，不得根据合成测试宣称 165 项实际生成。

### 2026-11-26 · PR #221 Windows 真实自发射验收关闭，独立候选部署前离线复验

维护者在 f4f134dd0a7772f57963d9ba8f8e85d01ac1874e 实测注释 10/10、DDL 8/8、基线 12/12，Vite+ 533 格式/374 受检零警告错误、中文 401、Markdown 96，增量退出码 0。真实候选成功完成干跑、自发射、165 项完整比较及官方 migration check，原包十文件、历史迁移和正式契约不变；新迁移标识 e6b95ed88834dce3f6448445a5ba12a00ba34c8e5c68f4335751659b15a77f17，COMMENTS_EMITTED_REVIEW_REQUIRED，退出码 0。远端最终格式提交 47d2d5fe137e1cc58076f0b9243584edf49bb454 核对仅两个脚本排版；维护者授权后 PR #221 Squash 合入 6dd53088aac7b48a7a76f37c594e6d176c65c1b0，E-145/E-146 关闭。

本批增加既有独立候选只读复验：固定真实新迁移标识与已验收配置 SHA-256，严格十四文件和目录清单，拒绝链接、硬链接、越界及额外对象；从原包重新构造源码和 119 项操作、检查原 46 项及整个 manifest，复验已保存干跑与完整性成功封装。实际入口再运行官方 dry-run 和 migration check、逐阶段核对原包和候选字节不变；输出路径、长度、逐文件 SHA-256 与独立证据指纹，原始诊断不输出正文。Node 22.16.0 / TypeScript 5.8.3 协作容器七项合成文件系统与逻辑测试实际 7/7、两份新增模块语法检查通过；核心 Blob b73744f3e3a67a79d7ab188e3f633d47af710f27、测试 Blob 60ca8c3811abf142d125118cf343c18f9639d448 与实测源码一致，复用本地同逻辑的已验收注释模块。配置 Blob 825eba5dba88608ae8cbb1b787d4e03086077eb4 与远端一致。未取得真实新候选十四文件、未在固定 RC 下执行新增只读入口、未运行 Windows Vite+ / 全仓中文及文档检查；新的证据指纹不能预填。此次不连接数据库、未创建第三座隔离空库或编写部署执行入口，签名和部署许可均否。

### 2026-11-26 · PR #222 真实候选复验结案与第三座专用空库只读门禁

维护者 Windows HEAD 9f4ec0e1787c9e1c4af7afa690468395cabcad71 实测候选 7/7、注释 10/10、DDL 8/8、基线 12/12，共 37/37；Vite+ 535 格式/376 受检零警告错误，中文 403 个文件、Markdown 96，增量退出码 0。真实原件十文件及十四文件候选、165 项完整操作、官方再次 dry-run 与 migration check、字节不变检查通过，证据指纹 02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e，CANDIDATE_PREFLIGHT_REVIEW_REQUIRED，退出码 0，工作区干净。远端最终 bda0dd823417af24bf99280c6d747757099b9df8 核对仅三脚本排版变化，维护者授权后 Squash 合入 4212160faabec482963b071bff5b34e1e06d3f50。

本批从维护者真实 JSON 输出逐项录入十四份文件的路径、长度、SHA-256、配置哈希及迁移标识；协作容器 Node.js 22.16.0 独立重算清单的规范 JSON SHA-256 与上述实际指纹一致，新增八项 Node 测试实际 8/8，核心及测试语法检查通过。核心 Blob c21254f7418f916dcb4010734b172a14eba5378a、测试 Blob e7c4baee8facd967df8e3bc6babb0cec23e9c78b、证据清单 Blob 2e3a973c51d98899023338d008947eec5dbc28c9 与本地实测文件一致。测试使用明确标记的合成凭据和模拟 pg 客户端，覆盖证据漂移、连接目标、参数、事务与所有者/必要权限、23 类目录与其他会话检查、连接/查询/回滚/关闭失败。不是实际 SQL 或实库验证。未在协作环境执行真实固定 RC、完整 Windows Vite+、中文文案、文档检查及新预检入口，未创建或连接第三座数据库。第三座名称暂定 adui_scada_fresh_prisma8_native，真实存在性、数据库所有者及目录检查结果待维护者单独确认。部署执行、签名及正式接管仍禁止。

### 2026-11-26 · PR #223 首次 Windows 验收与 E-147/E-148 修复

维护者实际 8+7+10+8+12=45 项测试通过，Vite+ 538 格式/378 受检，0 错误、2 条 eslint(no-control-regex) 警告，中文 405、Markdown 96，增量退出码 0。真实独立候选复验 14 文件、165 操作，固定证据指纹 02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e 一致，官方再次干跑和完整性检查退出 0；真实第三座空库入口随后仅显示通用只读查询失败、退出 1，未取得实际失败阶段或 SQLSTATE。远端维护者格式提交为 0fb52919af843e2511f84caf542f27a56a5d1c2c。

本补丁保留固定原包、独立候选、SQL、连接保护及只读边界，仅以 charCodeAt 等价替代两处控制字符正则，增加连接/事务/边界/目录/回滚/关闭固定阶段和已知 SQLSTATE/网络错误码脱敏分类。Node.js 22.16.0 真实完整专项 10/10，两个模块 node --check 通过；本地三份文件 Git Blob 分别 8393fec0fc3dedd504a3b7f5eeef51e2c1382bf1、9c60881b6aad355bba3c3525ce1b837c64071cda、6de926fef297190822192df32cf7aa5e8f9d6fc6，与待提交树完全一致。未运行本机 PostgreSQL、固定 RC 新集成入口或 Windows Vite+ / 中文 / 文档复验，真实故障根因尚未确认。此次无数据库创建、写入、重置、签名或部署。

### 2026-11-26 · PR #223 第二次 Windows 验收与 E-149

维护者 Windows 五组专项 47/47，Vite+ 538 格式/378 受检，0 错误、1 条 typescript(no-useless-default-assignment) 警告，中文 405、Markdown 96，增量退出码 0。E-147 原两条控制字符正则警告已消失；不能据退出码 0 认定零警告。修复仅调整预检测试模拟的可选错误码参数及元组类型，原十项测试、固定十四文件证据及数据库 SQL 不变。协作容器 Node.js 22.16.0 模拟函数独立回归 2/2（覆盖未提供错误码及九组显式错误码）、语法及 TypeScript 5.8.3 局部 JavaScript 类型检查通过，不是完整仓库专项或 Windows Vite+ 复验。

维护者已明确授权创建本机第三座专用空库 adui_scada_fresh_prisma8_native；尚无实际创建或新预检结果。仅允许在确认目标实例、角色、同名数据库不存在后新建独立 UTF8 空库；已存在则不重建、不清理、不修改所有者。创建后仍需用明确专用连接执行既有只读门禁，确认 23 类目录、固定证据及回滚关闭，签名和部署许可均否。E-148 实际失败原因待真实脱敏诊断，PR #223 保持 Draft。

### 2026-11-26 · PR #223 真实预检结案及原生独立迁移候选

维护者在精确 HEAD f1c6b7cbaeb27a232413560c42b8811cba096cdc 实测 47/47、538/378 零警告错误、中文 405、Markdown 96、增量退出 0；真实 PostgreSQL 170011 第三座专用库 23 类空目录检查通过，官方再次干跑及完整性检查、固定十四文件指纹不变，回滚关闭，退出 0，工作区干净。按明确授权 Squash 合入 2f8b692a8284f2eab182b5a44155bebaeff1c696。维护者同意第三座专用库迁移。

新增固定 RC 专用迁移配置及独立包装入口，保留原离线配置和候选字节；仅接受唯一预览或迁移确认参数，复用预检 URL 白名单和固定 CLI 解析，凭据仅在白名单子进程环境传递。先复验原件、官方干跑、空库及唯一在线迁移边，再在应用前重新预检；仅执行 db migrate --to 固定目标 --no-advance-ref，禁止签名、策略覆盖及自动重试。应用后要求官方成功结果、目标标记、官方 db verify、剩余路径为空及原件不变。上游当前实现的机器结果字段用于严格候选门禁；固定 RC.35 真实在线机器响应尚未取得，形状不符立即停止，写入调用后若失败视为状态待查。五项离线测试定义，协作环境无 pnpm/vp、仓库检出及维护者 PostgreSQL，完整测试及真实预览/迁移均待执行。业务库、两座旧库及正式 Provider 不变；不代表实际数据库物理结构、注释和约束负向验证已经完成。

### 2026-11-26 · PR #224 真实在线预览通过，实际原生迁移失败（E-150）

维护者 Windows 六组 52/52，Vite+ 542 格式/382 受检零警告错误、中文 409、Markdown 96，增量退出 0、工作区干净。远端 87b8e4d43144fda3e1118e43856bed395b63c4f1 相对 7b5256870c78d73d8367feb6638af23cbd3b6d24 仅两脚本格式化；日志未单独打印本机 HEAD。实际在线预览唯一固定空起点边及十四文件指纹一致，退出 0；真实写入前再次空库预检通过，官方独立迁移子进程未确认成功，包装退出 1，未进入应用结果/官方 verify/剩余路径校验。无官方原始错误码或实际数据库回滚证据。

本补丁冻结再次迁移入口，新增只读恢复检查、固定进程退出码和白名单诊断，拒绝原始敏感异常输出。恢复报告只读统计业务目录、注释数和 marker/ledger 固定匹配计数；无表及标记时另外执行原 23 类空库检查；不将数字一致视为全结构或语义等价。Node.js 22.16.0 对与远端 Blob 一致的核心 bfd14ffc327b058eec860b74bcfa776bd35d3046 及测试 b9a779585572c8b6213b4ad6366def6098b021fd 实际语法及 6/6 模拟测试通过，复用既有本地源码摘录；新入口、实际 SQL/固定 RC 元数据形状、Windows Vite+ / 中文 / 文档待复验。未再次连接或写入维护者数据库，禁止自动重试、清理、签名和正式接管。PR #224 保持 Draft。

### 2026-11-26 · PR #224 恢复验收结案与一次性诊断候选

维护者 Windows 七组 58/58、Vite+ 544 格式/384 受检零警告错误、中文 411、Markdown 96，增量退出 0、工作区干净。第三座 PostgreSQL 170011 真实恢复检查退出 0，九类业务目录及注释计数均零，无 marker schema、marker、ledger 或旧迁移表，严格空库 23 类通过，固定十四文件指纹 02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e 不变。按明确授权 PR #224 Squash 合入 0ffb6672134c4676da31970d74b9bf7f7462bf89。Docker 实测 postgres:17-alpine 健康；现有四小时错误日志未提供可关联首次官方写入失败的错误码，最后目标库不存在错误早于成功预检，不据此推断实际迁移失败原因。

新候选保持旧确认冻结，新增单独显式一次性确认；依然执行原件、固定 RC/Provider、空库、唯一在线边及再次空库预检，在官方迁移调用前以独占创建方式登记独立尝试记录；记录已存在、路径异常、指纹变化或无法写入即拒绝。记录不含凭据且位于候选目录之外，不自动删除。扩展固定官方直接错误封装识别，保留原命令匹配、白名单及成功条件，不输出摘要、原始异常、连接串或任意元数据。Node.js 22.16.0 新核心 Blob d026bd03d3e8ae4833b3641080bc912413461d99 与测试 Blob 610e0bd261a5e01d029ddd73c034732bd24e9ba2 本地一致，语法检查及独立五项测试 5/5；另对现有诊断函数同逻辑摘录做三项直接/包装/错命令及脱敏断言通过，不等同完整恢复专项。Windows 合并后完整专项、Vite+、中文及文档未运行；实际 RC 诊断与迁移仍待维护者单独确认执行。禁止自动重试、删除记录、重置、签名、改动旧库、正式 Provider 切换。

### 2026-11-26 · PR #225 真实诊断与严格结构只读对照候选

维护者在 HEAD `240d70a3a2fbb3efeb43257ac1bb874d594bd75c` 开始 Windows 验收，恢复 12/12、迁移 5/5、空库预检 10/10（合计 27/27），Vite+ 546 格式/386 受检零警告错误、中文 413、Markdown 96，增量退出 0，工作区干净。最终 HEAD `ef8782371e3aaa0f56d557d3772ccc88e6db6ac3` 相对验收起点仅一份测试排版；经维护者授权 PR #225 Squash 合入 `9a8bfe5bb630c0c2dbb8b2df1c505f33d0948664`。真实一次性执行两次空库预检、唯一在线路径及固定证据核对通过，独占尝试记录已登记；官方迁移退出 2、诊断 `MIGRATION.SCHEMA_VERIFY_FAILED`，包装退出 1。随后真实第三座库 PostgreSQL 170011 只读恢复退出 0，九类目录及注释计数均零，无 marker schema、marker、ledger 或旧迁移记录，严格空库 23 类通过，十四文件指纹 `02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e` 不变。该证据不证明实际迁移成功或全部回滚过程。

已核对固定 PostgreSQL Provider v8.0.0-rc.25 上游源码 `packages/3-targets/postgres/1-target/src/core/migrations/runner.ts`（https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/3-targets/postgres/1-target/src/core/migrations/runner.ts）：app 空间在执行计划后、提交事务和更新 marker/ledger 之前，以同一 driver introspect 并调用 verifySchema，默认 strictVerification 为 true；失败携带 meta.schemaIssues。既有 #216 是宽容 schema-only 对照，不能代替迁移严格验证。尚未确认固定 CLI rc.35 是否覆盖默认选项，也未保留此次 schemaIssues 具体内容，严格模式只是待验证的差异假设，不得认定历史登记、中文注释或某一约束为根因。

本批冻结原确认和已消耗的单次恢复确认（无论本地记录是否存在），保留一次性记录和原件。只在既有 CLI 白名单新增 `db native-schema-verify-strict`，映射固定 `db verify --schema-only --strict --json`，复用原生配置、原 adui_scada_test URL 守卫与 PostgreSQL default_transaction_read_only、超时和 search_path 参数；不扩大允许库名，不运行任何写入，不改第三座库、候选、历史、正式 Provider 或依赖。严格 JSON 是官方机器输出，仅供维护者在本机提取诊断码、结构路径和差异类别，不分享原始输出、凭据、任意元数据或业务值。严格对照可能返回历史 Prisma 7 登记等未声明对象，不能据此推断第三座库实际失败点，也不应删除对象、放宽验证或签名。

协作容器 Node.js 22.16.0 核对 CLI Blob `16308a36bfddaf90380afc42000c155b853f7aff` 及现有 URL 守卫 Blob `3a84f36578e21973f9f1c4fe6a60e391e80fd32b` 与本地一致，CLI 语法检查通过；独立模拟子进程 5/5（严格参数与根 cwd、只读选项、退出码，宽容行为保持，非法目标/选项、附加参数/写命令拒绝，离线环境隔离）。首次局部测试受 Node 22.16 默认未启用 TS 类型擦除影响为 3/5，使用 NODE_OPTIONS=--experimental-strip-types 后 5/5；不是 Windows Node 24 仓库九项回归，不是固定 RC 实际结构验收。Windows CLI 9 项、恢复 12 项、迁移 5 项、空库 10 项及 Vite+、中文、文档与真实严格对照尚待维护者执行。

### 2026-11-26 · 严格控制库验收及执行检查条件离线评审候选

维护者 Windows 实测 CLI 9/9、恢复 12/12、迁移 5/5、空库 10/10，共 36/36；Vite+ 546 格式/386 受检零警告错误、中文 413、Markdown 96、增量退出 0、工作区干净。固定 RC 与两份 Contract SHA-256 通过；历史验收库真实宽容及严格 schema-only 均退出 0，严格官方机器结果 True。日志未单独输出本机 HEAD，远端 PR #226 HEAD ac0b7abad8094b0ce38036f1fe5a2a234709cbd7，经明确授权 Squash 合入 5797d5388eac7b531ae13e51e0b336ef770bf460。仅确认控制库结构符合契约，不证明第三座库迁移后的实际目录或失败原因。

固定 Provider rc.25 Runner 源码 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/3-targets/postgres/1-target/src/core/migrations/runner.ts 的 applyPlan 在 postcheck 和幂等检查均启用时先执行 postcheck；非空且全部满足则跳过该操作，否则继续执行 precheck、execute、postcheck，随后 app 空间整体 schema 验证。已有 DDL 对照只验证 execute 文本，并未分析真实 precheck/postcheck 参数及是否可能提前满足。此为调查方向，不能断言实际发生过跳过，也不能把空检查或相同检查判定为故障。控制库严格验证已通过，不再把宽容/严格差异单独作为根因。CLI rc.35 实际参数、真实失败 schemaIssues 和失败瞬时结构仍缺证据。

新增固定离线执行检查评审入口，仅校验已安装 CLI/Provider 版本及入口路径，不启动 CLI，不创建连接或子进程。复用固定原包十文件、独立候选十四文件、离线配置指纹门禁，读取候选 ops.json 后按已验收清单再次核对长度及 SHA-256；检查 46 项结构与 119 项注释顺序边界、唯一标识、additive/postgres/单 execute、precheck/postcheck 形状；导出结构操作的检查 SQL 和参数及缺失/相同检查标识，注释仅统计覆盖，不导出注释 SQL/参数、执行 SQL、任意元数据或连接凭据。输出前再核对原包和候选。不执行 SQL，不写任何候选或数据库，不授权签名、部署或再次迁移。报告是静态证据，不代表真实执行或 PostgreSQL 结构验证。

协作容器 Node.js 22.16.0 三份新增源码 node --check 通过，四项独立模拟测试 4/4；实际远端源码 Blob 与本地一致。未获得维护者本机固定候选原文，未执行真实离线入口、完整 Windows Vite+、中文和文档检查；不能宣称真实 165 项提取成功。

后续须在 Windows 检查四项定向测试及 Vite+、中文、文档，并使用原候选运行只读入口；仍禁止重复迁移、签名或切换正式 Provider。

### 2026-11-26 · PR #227 验收及固定迁移快照直接结构评审候选

维护者 Windows 实测 PR #227：执行检查 4/4、DDL 8/8、候选完整性 7/7，共 19/19；Vite+ 549 格式/389 受检零警告错误，中文 416，Markdown 96，增量退出 0，工作区干净。真实固定离线报告退出 0，十四文件指纹 02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e 不变，46 项结构、119 项注释，缺前置 1、缺后置 1、相同前后 0，状态 EXECUTION_CHECK_REVIEW_REQUIRED。日志未打印具体操作标识或报告全文，不能断言两项为同一操作或判定实际发生错误跳过。日志未单独打印 HEAD；远端唯一 HEAD 8328529cd078bfb6ff37df206c426ca864c0dcd5，经明确授权 Squash 合入 46d9e0e757d1ad46c3b88f302f012612da4356f0。

新增上游证据：v8.0.0-rc.25 标签的 CLI 共享源码 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/1-framework/3-tooling/cli/src/control-api/operations/run-migration.ts 在 perSpaceOptions 显式传入 strictVerification: false，不能继续将 Runner 默认 true 当作实际迁移参数；此标签 CLI 源码不等同维护者已安装的 CLI rc.35，后者实际选项仍未核实。相同标签的 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/1-framework/3-tooling/cli/src/control-api/operations/db-verify.ts 使用 collectAggregateNamespaces(aggregate) introspect，再按空间 verify；而 Runner 使用 destinationContract 直接 introspect/verifySchema。Provider 公开控制入口 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/3-targets/postgres/9-facade/src/exports/control.ts 与 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/1-framework/3-tooling/cli/src/control-api/client.ts 的 schemaVerify 使用完整反序列化契约直接 introspect/verifySchema。该差异值得对照，但不证明第三座库失败由聚合或非严格模式导致。

新增固定直接只读入口，锁定 CLI rc.35/Provider rc.25 及原包、十四文件，核对唯一迁移目标快照与候选根契约的文件哈希和 JSON 深度相等。仅复用 adui_scada_test URL 守卫并进一步限定 127.0.0.1:15432、非空凭据及固定只读启动参数，不接受额外命令行参数；以公开 createPostgresControlClient、connect、schemaVerify、close 顺序执行宽容及严格两种直接验证。结果仅返回严格标志、真假、问题与警告计数及契约声明范围内脱敏路径；目标存储哈希、strict 及结果形状不一致即失败。连接、验证或关闭异常不回显原文；关闭后再核对证据。该公开 API 不暴露连接内独立 SQL 查询，因此只读启动设置由 URL 和 sessionSettings 固定，不声称已在同一事务查询 read_only 或复现失败瞬间；禁止并发 Schema 变更。未连接第三座库，不调用迁移、签名、自定义 SQL 或写入，不修改原包、候选、历史、依赖或正式 Provider。

协作容器 Node.js 22.16.0（显式 --experimental-strip-types）三份新增源码语法检查通过，四项模拟测试 4/4；核心 Blob 27975369355abf757ea8df78a72988a9b7716fc3、测试 045165935ef3c738f4e2ec1238018b6852a850f7、入口 2b00d373fe1a5b39e80a95ecbc516f585ecf5d9a 与本地一致，既有 URL 守卫 Blob 3a84f36578e21973f9f1c4fe6a60e391e80fd32b 一致。协作容器无固定 RC、真实候选、数据库、Vite+ 或 pnpm；未执行实际直接入口、完整 Windows 格式/Lint/类型、中文及文档检查。首次实现的 finally 直接抛出关闭异常可能覆盖原失败，提交前改为保留两个固定阶段原因并再次通过同四项模拟；不得以模拟代替真实 RC。

后续真实验收仍仅在历史库进行，原迁移冻结不变。

### 2026-11-26 · PR #228 真实直接结构验收及 E-152 修复候选

维护者 Windows 实测 PR #228：直接结构 4/4、执行检查 4/4、候选完整性 7/7，共 15/15；Vite+ 552 格式/392 受检，0 错误、1 条 eslint(no-unsafe-finally) 警告，中文文案 419、Markdown 96、增量退出码 0，工作区干净。日志未单独打印本机 HEAD；远端 b7d5bcd0e607485e75d11fd880447ea0bc8b0105 相对交付 HEAD ea5cb8760751cf60078e46e291500dd9710f0303 为三份源码排版提交。真实历史验收库 adui_scada_test 的直接宽容与严格验证均 ok=true，issueCount=0、warningCount=0、issuePaths=[]，退出 0，十四文件证据指纹 02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e 不变，状态 DIRECT_SCHEMA_REVIEW_REQUIRED，签名与部署均 false。这里的数据库结构警告为零不等于 Vite+ 零警告。

维护者从已存在的离线报告提取出 missingPrecheck 与 missingPostcheck 均仅为 schema.public，identicalChecks=[]。该项为已验收的 CREATE SCHEMA IF NOT EXISTS public（实际 SQL 使用双引号）；Runner 的空 postcheck 不会触发预满足跳过，其余 164 项均具备前后检查。不能据此确认实际执行情况，也没有证据将该项视为失败根因。历史库聚合、直接两种路径各自宽容与严格均通过；未复现失败事务内目录，仍无第三座库原始 schemaIssues，CLI rc.35 实际选项仍未核实。

最小修复：E-107 同类复发。入口原 finally 中直接 throw 违反 no-unsafe-finally，且证据复核失败会覆盖先前验证或关闭失败。将成功与异常路径统一交给 runLockedDirectSchemaReview：先等待原只读验证及关闭，捕获既有脱敏诊断，再独立复核固定指纹；指纹不同或复核异常都记录固定中文原因，最后在普通控制流汇总抛出，不在 finally 内改变控制流。成功或失败均执行证据复核，双重失败不输出成功 JSON、不掩盖原始脱敏阶段，不回显第三方异常。保持原 CLI 参数、连接白名单、超时、只读设置、快照、候选、输出格式、退出码 0/4/1、签名及部署冻结。

协作容器 Node.js 22.16.0 使用与远端当前三个源码及 URL 守卫 Blob 字节一致的文件进行修改；真实执行三份新增修改后源码 node --check 与 node --experimental-strip-types --test scripts/prisma8-native-direct-schema-review.cases.mjs，7/7 通过（保留原 4 项并新增 3 项：关闭后复核及保留不匹配报告、成功验证后指纹变化/读取异常阻断、验证与关闭失败同时证据异常的汇总脱敏）。修复后核心 Blob 5f46984ef13c58344eff20f018434d6301c2e96b、测试 13fd48c16052cddb7fb13ce01f5a11b185b42023、入口 9da69724fd8834e1d4a76008426ef49da93cc8b4 与本地相同。容器没有完整仓库、固定 RC、真实数据库、pnpm 或 Vite+，修复后的 Windows 格式、零警告、文案、文档及真实入口尚待复验；不冒称已经消除全仓警告或迁移成功。

### 2026-11-26 · PR #228 合并及原生迁移结构失败离线诊断候选

维护者在明确打印的 HEAD c10e154cb38170b4c58fa4ab9917a089e5bdadb6 实测 PR #228 E-152 修复：直接结构 7/7、执行检查 4/4、候选完整性 7/7，共 18/18，Vite+ 552 格式/392 受检零警告错误、中文 419、Markdown 96、增量退出 0，工作区干净。按明确授权 Squash 合入 3bfb92229980f5f46a1f7c9244d4e3c59ff83d4c。E-152 静态质量与模拟保护复验关闭；修复前真实历史库直接验证两种模式均通过，但此次日志未包含修复后的真实数据库复验，不重复登记为新的数据库实测。

固定 Provider rc.25 上游 Runner 源码 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/3-targets/postgres/1-target/src/core/migrations/runner.ts 在事务内结构验证失败时返回 MIGRATION.SCHEMA_VERIFY_FAILED 并携带 meta.schemaIssues；CLI 共享源码 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/1-framework/3-tooling/cli/src/utils/runner-failure-error.ts 将 failure.meta 保留在 CLI 错误对象。上游 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/1-framework/1-core/framework-components/src/control/schema-diff.ts 的 issueOutcome 明确从 expected/actual 是否存在派生 not-found、not-expected、not-equal；解释类别仅为 differs、possibly-equivalent。固定 CLI rc.35 的最终 JSON 序列化仍须实测，不能将 rc.25 标签共享源码认定为安装包完整实测。现有迁移包装器在内存捕获 stdout/stderr 后仅输出白名单错误码；一次性尝试记录只含范围和指纹。仓库代码未持久化原始 schemaIssues；不能确认维护者是否另有原始机器输出，也不能从恢复后空库反推失败时具体差异。

新增只读离线诊断解析器：只接受已有机器诊断的标准输入，16 MiB 上限，匹配唯一 db.migrate 结构失败封装，兼容直接错误、逐行事件最终错误及最终诊断数组；命令、严重度和结果状态矛盾、重复或畸形结果拒绝。仅输出契约白名单结构路径、由 expected/actual 存在性派生的类别、两种已知解释类别和数量，未知路径脱敏，不输出节点原值、摘要、解释正文、凭据、连接串或任意元数据；缺失列表与空列表分别用 null 与 0 表达，均不代表零差异通过。入口复用原包/固定十四文件门禁，另核对候选 contract.json 长度及 SHA-256，复用已有路径白名单，输出前复核固定证据。离线入口不认证日志来源，不调用 Prisma CLI、数据库驱动、迁移、签名或任何写入；不能通过旧错误码重构丢失的具体结构差异。退出 0 仅表示取得非空合法脱敏差异，4 表示唯一失败但缺少具体差异，1 表示输入或证据拒绝。所有报告 signingAllowed 和 deploymentAllowed 均为 false；旧迁移入口及写入冻结门禁不变。

协作容器 Node.js 22.16.0 实际执行三份新增文件 node --check 及 node --test scripts/prisma8-native-schema-failure-review.cases.mjs，7/7 通过；覆盖三类差异、逐行及最终错误/诊断数组、缺失或空列表、命令/严重度/结果状态冲突、重复封装、畸形数据及输入数量/大小限制。核心 Blob a90b88abba2f3a63554512206a756be402b20ea2、测试 Blob 515b710723eb2cc6318d6239eccd35582872c4e6、入口 Blob 00045f5532d1dd1741facd7b0d1a08975a69c335 与实际本地检查文件一致。现有直接结构路径白名单仅增加导出，未改变其逻辑。容器无完整仓库、固定 RC、真实候选、原始失败机器输出、pnpm 或 Vite+；未实际运行固定候选离线入口、完整 Windows 质量链或数据库。不得宣称真实失败诊断已恢复、具体根因已确认或原生迁移成功。

下一阶段隔离复现方案（仅提议，尚未获得单独数据库操作授权）：保留第三座库、一次性尝试记录、历史验收库、参考库和固定原件。使用完全独立的本机临时 PostgreSQL 实例，选择未占用的专用回环端口、独立数据卷、专用库及一次性凭据，不继承现有容器卷、数据库连接串、根 .env 或其他服务网络。优先核对与既有 PostgreSQL 17.11 相同的实际镜像摘要及环境，不擅自升级。使用候选的独立只读来源副本，核对 CLI rc.35/Provider rc.25、十四文件证据和唯一空起点迁移边；任何执行入口须另行评审连接白名单、实际库/角色/版本、严格空库门禁及一次性授权。仅在明确批准的独立实例执行一次官方原生迁移，捕获官方机器输出，失败时在丢弃原文前提取脱敏 schemaIssues；成功也仅作隔离复现结果，保留现场并停止。若无法取得具体结构差异，再单独评审同一事务内逐项 DDL、目录读取与回滚的实验，而不是继续重复历史库验证。禁止自动创建、重置或清理数据库，禁止重试第三座库、改动正式 Provider、签名、发布或推进引用。本批未实现或执行任何新的在线复现入口。

## 2026-11-26 · 第四座独立实例真实创建与取证入口待验收

维护者日志：PR #229 四组 33/33、Vite+ 555/395 零警告错误、中文 422、Markdown 96、增量退出 0；未打印本机 HEAD 或工作区状态，PR 已合并 68e9cf856d6f8d95b0cea84f69c8cd073c7fb29c。之后真实离线候选复验 0，10 原件、14 候选、165 操作及固定 SHA-256 匹配，官方干跑与完整性检查通过。维护者明确授权并创建第四座独立实例，实测 127.0.0.1:15433、adui_scada_fresh_prisma8_repro、adui_scada_native_repro、PostgreSQL 170011；独立容器、卷、网络与实际镜像 ID 已提供。尚未运行迁移。

新代码定义八项隔离门禁/记录/两路解析/加密回归及两项第四座身份预检回归，Windows 零警告、文案、文档、真实固定 RC、Docker 和 TCP 联合检查均待执行。真实实验必须在这些离线质量门禁通过后人工运行一次；不可删除候选副本或尝试记录以获得重试。成功或失败均保留现场，报告未确认成功不等于回滚证明。捕获文本有进程超时和缓冲上限；进程中断时可能不完整，不允许分享原始内容或凭据。签名、正式接管及前三库迁移继续冻结。

协作容器 Node.js 22.16.0 实际执行新增隔离门禁核心、测试及既有诊断解析器的 node --check，随后 node --test 新增八项全部通过，退出 0；最终核心 Blob b4f0f67c1b6e902fe5c2a1c6f019f88de0d78ff3、测试 Blob bd3fd7dbdf6ff3acaaa78545e953dc7745cfbd13、既有解析器 Blob a90b88abba2f3a63554512206a756be402b20ea2 与本地实测文件一致。此次容器没有完整仓库、固定 RC、Docker、PostgreSQL、pnpm 或 Vite+；两项新增第四座空库回归及完整原空库专项、入口配置、真实命令、中文和文档门禁尚待 Windows 验收。单次真实迁移不得与离线回归混为一谈。

## 2026-11-26 · PR #230 增量验收及 E-153 暂存检查修复候选

维护者 Windows 六组专项 8+12+7+5+7+12=51/51，Vite+ 559 格式/399 受检零警告错误，中文 426、Markdown 96，增量退出 0。五份文件经格式化后处于暂存状态，真实执行指令在工作区干净保护处停止，未启动复现入口、未执行迁移或消耗单次授权。JetBrains 提交时共享 staged 检查五份文件，独立迁移配置 process.env 报 TS2591，提交 Hook 退出 1，故 PR 尚未完成提交质量验收。

仅在 apps/server/prisma8-native-repro.config.ts 顶部增加文件级 Node 类型引用。协作容器 Node.js 22.16.0 / TypeScript 5.8.3 在 types=[] 与模拟 Prisma 模块声明夹具中，原配置 Blob d2c867d9c56e7e91a3323309359ec9ba6c07cdf7 复现 TS2591 退出 2，修复配置 Blob 4f81c22c14a30e60f88def57f7671352dce096c2 检查退出 0；模拟配置工厂验证专用 URL 与七种非法/缺失输入 8/8。不是固定 Prisma RC、真实 Vite+ 或 Windows Git Hook 实测。须保留本地格式化改动、同步修复、复验定向及全仓检查并通过真实提交 Hook，核对最新远端 HEAD 后再执行已授权的第四座单次实验；前三库、候选原件、签名与正式接管继续冻结。

## 2026-11-26 · 第四座真实迁移取证结案及离线 CHECK 修复候选

维护者在实际执行中打印本机与远端 HEAD a25962d7f4eee6db5a7b5cd35080486ec205c0bd；六组专项 51/51、559 格式/399 受检零警告错误、中文 426、Markdown 96、增量退出 0、工作区干净。E-153 修复后的格式提交已推送，未单独提供 Hook 原始成功日志；PR #230 获授权后 Squash 合并 265c02a7fd679abf3771140c4196135b1cbdb40f。

第四座真实实验：身份和 23 类空库、在线唯一空起点迁移边、一次性记录通过；官方退出 2、包装退出 1、MIGRATION.SCHEMA_VERIFY_FAILED，operationsExecuted=null、captureInterrupted=false、encryptedOutputSaved/evidencePreserved/identityPreserved/attemptConsumed=true。真实密文认证解密后的诊断及表达式专项均退出 0，两个 exact-named CHECK 节点差异仅 expression：scada_identities_status_check 长度 100→106，scada_project_release_event_action_check 长度 101→107，均 ARRAY_CAST→ELEMENT_CAST 且 exactHypothesisMatch=true、omittedChangedFieldCount=0。固定十四文件指纹不变，签名及部署均 false。未取得第四座回滚后目录，不据此证明事务已回滚或第三座失败相同。

本次新增修复源和契约严格差异门禁，协作容器 Node.js 22.16.0 对两组实际运行 16/16（新专项 7/7、原独立复现及冻结 9/9），对应核心和测试 Blob 087b847253f7019549a48006ee8d0fc90d6d4ea2、70c02d06228be9858122f34bc8cc3267eb3f730b、cf9b42cf05c684e9679e34553a359ac0b707bc3b、4ad3d92d2015218c9fd03374ae35d7bb82592a02。新发射入口 node --check 通过，Blob c6e35c9283f1787657990d8a7c620212c61bd901；配置 1c4e07db9899fd4cb734879c3a0e496ef658f1f7，其原文 SHA-256 为 1ccda04b90a5f26e95a84c67ef8c1726689430955bd0ccecd6dc0baa7e2b250f。首次传输两份 PSL 模板代码字节不一致已修正，最终与实测 Blob 一致。没有固定 RC、Docker、PostgreSQL、pnpm、Vite+ 或完整 Windows 仓库，未执行真实契约发射、全仓质量链、冻结入口真实运行、任何数据库连接或迁移。模拟新契约不等于官方生成结果。

验收须先运行新专项、原复现与候选门禁、Vite+ 全仓及暂存路径零警告、中文和文档检查。只在干净已审查提交执行独立 contract emit，报告 roundTripVerified、migrationPackageGenerated、signingAllowed、deploymentAllowed 均 false；原件与固定候选复核不变。若官方发射产生额外字段、目录或失败，保留诊断和独立目录，不修改门禁来通过。新迁移包及注释重发射、SQL 实际往返与历史接管策略另行评审。

## 2026-11-26 · PR #231 中文文案生成物误报与 E-154 修复

维护者 Windows 五组专项 43/43（CHECK 修复 7、独立复现及冻结 9、候选 7、DDL 8、恢复 12），Vite+ 563 格式/403 受检零警告错误；中文文案扫描第四座独立副本的根 contract.d.ts 及嵌套快照声明误报四处官方英文注释，增量退出 1，docs:check 因命令链停止未执行。未打印本机 HEAD、工作区状态，也没有真实离线修复契约发射结果。

仅在中文扫描与共享 Format/Lint 增加第四座独立副本的精确目录排除，保留所有自有源码检查和原有排除范围；未修改任何实际证据、迁移候选或数据库。新增两个临时目录子进程测试，注册 test:messages 并纳入 ready。协作容器 Node.js 22.16.0 实际用原扫描器 Blob 3fa8fc77f683c931510d39855f6dee775252e42f 复现回归 0/2（退出 1），修复后 2/2（退出 0），根和快照声明未被写入，自有英文及相邻目录仍拒绝；局部自有文案 7 文件通过，语法检查通过。扫描器 Blob af4904e7fcb233d712da2b16bf3c5cafa9d914bb、测试 Blob 8b05d9dcb232ffb4a48536da9da581e9c51150ba 已核对一致。无真实 Windows Vite+ 或完整仓库执行环境，须复验 test:messages、messages:check、config:check、vp check、docs:check，并以既有十四文件指纹门禁核对实际第四座副本。若证据异常保留现场，禁止覆盖或重试；未获得新发射结果前不宣布 CHECK 修复成功。四座数据库继续冻结。

## 2026-11-26 · PR #231 结案与 CHECK 修复完整离线迁移包专项

维护者 Windows 在 HEAD 15b533cf43cb37b4d378a41248381cc46f3f5b66 完成 PR #231 验收：累计专项 45/45，Vite+ 564 格式/404 受检零警告错误、中文 431、Markdown 96，增量退出 0；固定 RC 官方修复契约发射退出 0，第四座十四文件指纹 02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e 单独复核退出 0。维护者授权后 Squash 合入 3537b9b878a2e33da442c9a7ce16d4c41eb9df26。新 storageHash 为 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436；仅两项已定位的 CHECK expression 与新存储标识改变，正式 Prisma 7 和四座数据库均不变。尚未验证 PostgreSQL 往返。

本批新增完整离线修复包入口：固定已验收三份修复契约 SHA-256、原包、正式生成物、八项历史迁移、119 项历史注释、原十四文件与第四座副本，使用固定 CLI rc.35/Provider rc.25 和两份固定无连接配置。仅在 apps/server/.artifacts/prisma8-native-check-repair-package 下新建 plan（十份证据）及 complete（十四份证据）；从 @empty 官方规划，核对完整快照及 46 项独立 DDL，并按原顺序深比较所有结构操作，只允许目标两张表的已知谓词原文替换，前后置检查及参数不可任意漂移。复用既有中文注释构造和 TS 语法节点插入、官方干跑、自发射及 migration check，要求完整 165 项操作与干跑一致，检查覆盖保持原有 schema.public 无前后置检查、其他无相同检查的事实。最终输出官方新迁移标识及本地独立证据指纹，后者不是官方迁移哈希；roundTripVerified、signingAllowed、deploymentAllowed 均 false。新输出目录禁止覆盖、失败保留诊断，精确排除生成目录而非全部 .artifacts；不读连接变量、不执行数据库命令、不改变旧迁移/正式 Provider/冻结策略、不推进引用。

协作容器实际 Node.js 22.16.0 执行新增纯离线专项 8/8、中文扫描实际子进程回归 2/2，均退出 0。核对本机与远端 Blob：共享规划检查 bd6d87702881de12be81b66227965dc3b4b32784、修复包核心 ae67598198fef821af8d6d7f88a116249126cc3f、测试 0a63a04c27802b91cc7618b69537a2a6a35e99e5、既有修复契约核心 f1c0ce1e1b8c3df6cc4e7f4892b73387d16e4047、中文扫描 48564f4a5fda754f6ab2f9df9b24f4755be29019、中文回归 a1d93726f0d1d0ac2dc4d69e1323f78fe150215b。协作容器缺少完整仓库、固定 Prisma RC、pnpm、Vite+，未执行真实规划、自发射、完整性检查、全仓质量链或任何数据库命令。必须由 Windows 验收实际官方产物；若 RC 输出或检查条件与已固定证据不同，拒绝并保留，不能放宽门禁以通过。

Windows 增量验收：新专项、原规划/DDL/注释/候选回归、test:messages、config:check、vp check、messages:check、docs:check；干净已审查提交执行 pnpm run db:prisma8:native:baseline:check-repair-package --confirm-offline-check-repair-package，提供报告、两个官方迁移标识、24 文件证据指纹及退出码。既有候选验收结果不得代替新包真实生成结果；不再次发射已验收契约，不删除已有证据。

## 2026-11-26 · PR #232 结案与修复迁移包固定证据复验

维护者 Windows 在 HEAD `31851343f513681db6eb063bcd4aee286f9fad96` 实测 PR #232：累计专项 54/54、Vite+ 569 格式/409 受检零警告错误、中文文案 436、Markdown 96；固定 RC 真实完整离线迁移包生成及生成后质量复验均退出 0，工作区干净。GitHub 确认合并提交 `f39176464e1805a4443cd4360b70891fa0093cb2`。固定结构迁移标识 `fce9c3dfdc0b5300cc1d128b07a6be03f618f89df7dd8d43ed2712881aee93c8`，完整迁移标识 `5cc4b025c41e1b5479cf29a86d6252806ff5bd517ef5c24b80fa6b89cf3c182e`，真实目录 `20261126T0620_scada_native_check_repair`，24 文件及两份配置的证据清单指纹 `13360ad35e8a1742f7d6a8eea99162fc11f33aea4d45d2075390ce4d2bef9a86`。

新增固定证据清单与已有修复迁移包离线复验模式：先验证固定清单指纹，再逐个读取精确目录、拒绝链接或额外对象并核对实际文件长度及 SHA-256；复用历史原包、第四座保留副本、修复契约、固定 CLI rc.35/Provider rc.25、无连接配置门禁。逐项复核 46 项结构、两处允许谓词变化、119 项历史注释、完整 165 项操作、快照与保存的官方干跑，重新运行固定官方 --dry-run 与 migration check，动作前后及失败后重新核对原件，拒绝非零退出、信号、标准错误和证据漂移；失败短路，不覆盖文件、不写新日志、不重新规划或实际自发射、不读取数据库连接信息、不连接或改写数据库。只允许原验收工作区，因为已保存规划包含实际绝对路径。报告只证明离线复验，roundTripVerified、signingAllowed、deploymentAllowed 均 false，四座数据库继续冻结，正式 Prisma 7 不变。

协作容器 Node.js 22.16.0 实际新增纯离线回归 10/10，核心、测试及新服务端模块 node --check 通过；本地与远端 Git Blob 一致：核心 `698f377a503d1f82800fdfac5571fbfef8ec6928`、测试 `45533fc2727e37828bbaf125f8b2c2f77aa5b481`、清单 `f1349416d5d365c3553720d58491d40f320c86c3`、服务端复验模块 `4704f7ff307d1429e6124acf01d6bff7d4173ffe`。清单从维护者上传的真实生成报告独立提取并重算指纹匹配；协作容器没有真实候选的 24 文件、完整仓库、固定 RC 或 Vite+，没有执行新入口真实官方复验及全仓检查，不能把清单一致或模拟命令测试视为真实复验通过。

Windows 验收：新专项 10 项、旧修复包专项 8 项、旧候选专项 7 项、共享配置、Vite+、中文文案及文档；在最终已提交的干净原工作区连续两次执行 `pnpm run db:prisma8:native:baseline:check-repair-package:review`，均应退出 0，报告证据指纹一致、offlineReviewPassed 和 evidencePreserved 为 true，regenerated、roundTripVerified、signingAllowed、deploymentAllowed 为 false。任一步失败停止，不重新生成、不删除现场。

## 2026-11-26 · PR #233 验收结案及最小 CHECK 往返计划

维护者 Windows 在 HEAD `687f17766b02f2d1e7a1b4747bd0545985e1bd64` 实测 PR #233 专项 25/25（10+8+7），Vite+ 573 格式/412 受检零警告错误，中文文案 439 文件、Markdown 96，增量及连续两次官方离线复验退出码均为 0，工作区干净。两份报告均为 NATIVE_CHECK_REPAIR_PACKAGE_LOCKED_REVIEW_REQUIRED、46 项结构、119 项注释、165 项完整操作、24 文件及两配置，证据指纹 `13360ad35e8a1742f7d6a8eea99162fc11f33aea4d45d2075390ce4d2bef9a86` 不变；offlineReviewPassed/evidencePreserved=true，regenerated/roundTripVerified/signingAllowed/deploymentAllowed=false。远端相对交付 HEAD 仅四份源码排版；按明确授权 Squash 合入 `713c638ecb3bb77b0fae85ce474e5b1298d0e407`。GitHub 未返回额外 CI 记录。该验收关闭固定离线复验阻塞，不等于 PostgreSQL 迁移成功。

下一批仅准备两个 CHECK 谓词最小往返验证的离线计划与观察判定器。固定 PostgreSQL Provider rc.25 上游 `packages/3-targets/postgres/2-adapter/src/core/control-adapter.ts`（https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/3-targets/postgres/2-adapter/src/core/control-adapter.ts）确实以 pg_get_expr(c.conbin, c.conrelid) 取得裸谓词并保留原文，筛选本地表 CHECK；不能以 pg_get_constraintdef 或自行格式归一化替代。计划绑定原始及修复契约、已验收 24 文件两配置证据，复用完整官方离线复验。仅目标 public.scada_identities.status 和 public.scada_project_release_events.action，保留实际 varchar(16)、NOT NULL、exact-named 约束名。每项包含 legacy（已确认第四座的旧形式到修复形式差异）、repair（直接提交修复形式）、replay（未来将已核验相同的 repair 反向提取原文再次提交）三阶段；后两阶段预期 pg_get_expr 原文与修复形式逐字一致。共六个阶段，每阶段两个允许值、五个非法值及一个 NULL，预期分别为 accepted、23514、23502，共 48 项计划输入。NULL 拒绝来自 NOT NULL 而非 CHECK。本计划省略其他业务列及默认值，仅测试单列显式输入，不能证明完整表及迁移行为。

协作容器 Node.js 22.16.0 实际运行新增纯离线回归 8/8，通过源文件及测试 node --check（既有契约修复模块 Git Blob f1c0ce1e1b8c3df6cc4e7f4892b73387d16e4047 与远端一致）；本地新增核心 Blob 3b1eb946c0315b6e9e1184190072a7dbbbb386cd、测试 Blob 9cc21795c6c356becb38c935e9f18c98c5ef3b8a 与远端一致。未取得固定 RC 完整运行环境、真实候选和 Vite+，未执行服务端入口真实离线计划、全仓检查或任何 PostgreSQL 操作，48 项是待执行的真实实验输入而非已通过数据库用例。

本批不包含数据库客户端、SQL 执行器、创建容器或新数据库命令。未来如另获授权，须在独立 PostgreSQL 17.11（170011）、同镜像及经核实的排序规则环境，以相同 public 表名分别创建最小关系并在阶段间回滚恢复空目录；通过 pg_catalog 核对约束元数据及精确表达式，用受控合成输入和独立保存点检查结果及错误码，核实回滚和退出，不访问业务数据。实际报告采集及来源认证、隔离目标身份、一次性执行门禁另批实现并评审。观察判定器严格要求固定计划指纹、版本、六个有序阶段、元数据、提交与提取原文、48 个结果，只输出匹配分类和计数，不回显任意输入；匹配仍不证明来源真实，始终 observationSourceAuthenticated/roundTripVerified/historicalAdoptionVerified/databaseExecutionAllowed/signingAllowed/deploymentAllowed=false。四座现存数据库及证据持续冻结，不创建第五座，不启用旧入口，不签名、部署、切换正式 Provider 或修改历史迁移。ADR 保持 Proposed。

Windows 在原工作区先执行 `pnpm run test:prisma8:native:baseline:check-roundtrip`、既有固定复验专项与共享配置、Vite+、中文文案、文档门禁，再在干净提交执行 `pnpm run db:prisma8:native:baseline:check-roundtrip:plan`；预期 NATIVE_CHECK_ROUNDTRIP_PLAN_REVIEW_REQUIRED、六阶段及固定证据指纹，所有数据库执行及签名/部署许可为 false。失败保留现场。不得把计划输出当作真实观察。

### 2026-11-26 · 固定 CHECK 往返事务模拟与隔离边界

PR #234 已按维护者明确授权合入集成分支，Squash 提交 `1641e2277706c00903d6350b7aa803d3adb20d36`。维护者 Windows 实际 HEAD `92d32648ff23e7d1dd501fc5635a0691630d66d7` 的四组专项 33/33（8+10+8+7）、共享配置、Vite+ 575 格式文件/414 受检文件零警告错误、中文 441 文件、Markdown 96 份均通过；增量退出码 0，真实固定包离线计划退出码 0，工作区干净。远端相对交付 HEAD 仅三份源码排版调整，未返回额外 CI 记录。真实计划指纹 `17c106877fe8e3177d405ac31fb335ce76c714511ce1eef537d3cf139e723d3a`，六阶段 48 个计划输入，所有执行、真实往返、接管、签名和部署许可均 false。

协作容器 Node.js 22.16.0 实际运行新增纯模拟测试 12/12、两文件 node --check 通过，远端 Git Blob 与本地一致：核心 `3cbd314dddc3099db0d65783ca81639d25b96683`、测试 `07f4f8b43df0a7fcfc4f802bd4d17a4a056a0da9`。模拟覆盖固定指纹与篡改、身份及排序规则、六阶段 48 次参数化保存点、真实目录输出的模拟漂移、错误约束与列、错误 SQLSTATE、事务开始失败、保存点回滚异常、外层回滚失败、后置边界漂移及失败停止。没有完整仓库工具链、固定 RC 产物或 PostgreSQL 服务；Windows Vite+、文案、文档、原固定包真实离线计划复验尚待验收。48 项为模拟输入结果，不是数据库实际验证。

新增 `pnpm run test:prisma8:native:baseline:check-roundtrip-execution`（12 项纯模拟，纳入 ready）。原工作区同时复验 `pnpm run test:prisma8:native:baseline:check-roundtrip`、`pnpm run test:prisma8:native:baseline:check-repair-package-review`、共享配置、Vite+、中文文案、Markdown；格式化正常提交后工作区干净，再执行 `pnpm run db:prisma8:native:baseline:check-roundtrip:plan`。计划必须仍为已验收指纹，全部许可 false，退出 0。不要连接任何数据库，不提供新实例创建或执行命令；若不符停止保留现场。实际隔离实例准备和真实运行须分别明确授权。

## 2026-11-26 · PR #235 验收结案与第五座宿主机只读预检

PR #235 已按维护者明确授权 Squash 合入集成分支 `449a81b406de2a895639126e68327072f22c60e9`。Windows 验收 HEAD `091af5eaef1ae80ed19479d9b5b5edbc03e3b945`：三组专项 30/30（12+8+10），Vite+ 577 格式文件、416 受检文件零警告错误，443 个中文文案文件、96 份 Markdown，增量和真实离线计划退出码 0，工作区干净。固定计划指纹 `17c106877fe8e3177d405ac31fb335ce76c714511ce1eef537d3cf139e723d3a`，全部数据库执行及签名部署许可仍为 false。

本批只增加第五座创建前宿主机只读预检。拒绝非 Windows、附加参数和 Docker 环境覆盖；先从本机上下文取得端点，仅允许两种固定 Windows 命名管道，后续 Docker 查询显式固定 --host，并要求 Linux 引擎、第四座保留容器镜像 ID 与本机固定镜像完全相同、第五座容器/卷/网络均不存在（含停止容器），再用无 Profile 的固定 Windows PowerShell Get-NetTCPConnection 检查所有本地 TCP 记录中的 15434。任何子进程异常、非零、信号、标准错误、资源重名或端口异常均短路并仅返回固定中文诊断；子进程不继承数据库连接串或凭据。不执行 Docker exec、run、pull、create、删除或 PostgreSQL 操作。报告 NATIVE_CHECK_ROUNDTRIP_HOST_REVIEW_REQUIRED，仅表示当前宿主机观察通过，不认证真实数据库来源；portReserved、resourceCreationAllowed、observationSourceAuthenticated、databaseExecutionAllowed、roundTripVerified、historicalAdoptionVerified、signingAllowed、deploymentAllowed 均为 false。端口检查不是端口预留，不能证明排除端口范围、未来竞争或 Docker 发布成功。第五座仍未创建，后续身份、排序规则、23 类空库与实际执行许可需分别核实；四座数据库及正式 Prisma 7 保持冻结边界。

协作容器 Node.js 22.16.0 运行新增核心与测试的 node --check 和 node --test 8/8，通过源码 Git Blob 比对（核心 `8dbd9191313017b067023106587902326684bef3`、测试 `1264935cfc29631d2f964fc6920a843d9b0384f1`）。局部夹具仅复用了原模块两个固定导出的原文，未安装完整仓库依赖；8 项为注入子进程模拟，不是 Windows Docker 或 PostgreSQL 实测。完整 Vite+、中文文案、Markdown、真实宿主机预检待维护者执行。

## 2026-11-26 · PR #236 结案及第五座创建前冻结库目录只读采集

维护者 Windows 在 HEAD `ea010893095dcaf434f06dba844f819822b4e45a` 实测 PR #236：三组定向专项 28/28（8+12+8），共享配置通过，Vite+ 579 个格式文件/418 个受检文件零警告错误，445 个自有代码或配置文件通过中文文案，96 份 Markdown 通过；增量及真实离线计划、宿主机只读预检退出码 0，工作区干净。固定计划指纹 `17c106877fe8e3177d405ac31fb335ce76c714511ce1eef537d3cf139e723d3a` 不变。真实宿主机报告 NATIVE_CHECK_ROUNDTRIP_HOST_REVIEW_REQUIRED，hostPreflightPassed/portObservedUnused=true，portReserved、resourceCreationAllowed、observationSourceAuthenticated、databaseExecutionAllowed、roundTripVerified、historicalAdoptionVerified、signingAllowed、deploymentAllowed 均 false。GitHub 核实最终 HEAD 与 Windows 日志一致、无冲突和未解决审查意见，维护者明确授权后 Squash 合入 `41a13e7679668c60307e85a8db583b88eba6d209`。端口观察不是预留，未创建第五座实例。

本批仅开发第五座创建前的冻结库系统目录只读采集入口，不提供创建或写入命令。单独确认参数 `--confirm-frozen-catalog-readonly` 之外的任何参数均拒绝；先复用既有宿主机预检，在同一个已核验 Windows 本机 Docker 端点内，以固定 Compose 项目/服务标签定位唯一历史 PostgreSQL 容器并核对运行状态和完整容器 ID；核对第四座容器运行状态、独立实验标签、固定镜像与不同容器 ID。仅两次固定 `docker exec`：通过容器内 `postgres` 系统用户、清空进程继承环境、固定 Unix socket、非交互 psql、不加载 psqlrc、不提示口令，分别访问 adui_scada_test 和第四座专用库。每次使用 `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`、固定超时及 default_transaction_read_only、只读 SELECT `pg_catalog.pg_database`/`pg_control_system()` 并 ROLLBACK；前三库通过同一共享系统目录精确核对三条目标元数据，不分别连接其业务数据库。真实连接身份、角色、170011 版本、当前和默认只读、重复读、目标数据库集合、两个集群标识不重复均须通过。仅比较四个冻结库的 UTF8、locale provider、LC_COLLATE、LC_CTYPE、locale、记录版本及实际排序规则版本；缺失、未知、自定义 ICU 规则或版本漂移一律停止另行评审。不读取业务表、配置凭据、根 .env 或完整容器环境，不修改数据库、容器、卷、网络、访问权限或既有证据，不自动降级认证或重试。此阶段保守地要求四个库的排序规则完全相同；实际存在不同合法设置也必须人工评审，不能为通过而刷新排序规则版本。报告只输出经白名单校验的参考排序规则及计数，不输出容器/集群原始标识。报告状态 NATIVE_CHECK_ROUNDTRIP_REFERENCE_REVIEW_REQUIRED，observedDatabaseCount=4、observedClusterCount=2、referenceCatalogObserved/allFrozenCollationsMatch/recordedCollationVersionMatches=true，沿用宿主机八个 false 许可字段；不认证后续目标 TCP 集群或保证下一次状态不变。第五座创建、独立凭据、目标同一连接内核验及真实 48 项实验仍须单独授权和实现。

协作容器 Node.js 22.16.0 实际执行新增 7 项注入子进程回归与原宿主机 8 项回归，15/15 通过；四份相关脚本语法检查通过，缺少确认参数、非 Windows 环境的真实入口均拒绝。新目录核心 Blob `35dbbbec74705491daaae49b845500caafd2597a`、测试 `2b5f67a20fefff915dd48890cc4902a3633cace5`、入口 `430e349669d27fe9721ce389af5c4fae1d192fe4` 与本地实际运行文件一致；原宿主机复用相同逻辑的本地夹具，原模块两个固定导出取自既有源码。协作环境没有真实 Windows Docker、PostgreSQL、完整仓库工具链；没有执行真实冻结库目录读取、全仓 Vite+、中文文案、Markdown 或数据库写入。真实入口依赖两座容器当前均运行、允许本地 socket 的固定角色非交互连接以及 PostgreSQL 17 系统函数；若认证、版本、目录或输出不匹配则保留固定诊断停止，不改变认证规则或数据库以通过。

## 2026-11-27 · PR #237 结案及排序规则证据语义修正

PR #237 已经维护者明确授权 Squash 合入 `fc459570f39708cc3746bc140d8d9e3fe96d6425`。Windows 增量验收四组专项 35/35（7+8+12+8），共享配置通过，Vite+ 582 格式文件/421 受检零警告错误，中文文案 448 文件、Markdown 96，退出码 0、工作区干净；增量日志未独立打印本机 HEAD。维护者另行明确授权四个冻结库系统目录只读核验，并在已打印的合并 HEAD 上实际执行固定离线计划与目录采集，退出码 0；计划指纹 `17c106877fe8e3177d405ac31fb335ce76c714511ce1eef537d3cf139e723d3a` 不变，四库两集群、UTF8、libc（c）、LC_COLLATE/LC_CTYPE 均为 en_US.utf8、locale=null、记录版本=null，旧报告 recordedCollationVersionMatches=true。旧源码将实际版本与记录版本作严格相等比较，由此可知实际版本亦为 null；这只能证明目录字段相同，不能视为排序规则版本或运行库身份已获认证。八项宿主机许可均为 false。

本批修正 PR #237 的目录报告语义，保留已记录的历史原始结果，不改 SQL 查询、只读事务、角色、库名、端口、固定证据及正式 Prisma 7。新增 actualVersion 字段；仅两版本均存在且相等才报告 recordedCollationVersionAvailable=true、recordedCollationVersionMatches=true、recordedCollationVersionStatus=MATCHED；libc 两版本均为 null 时报告 false/null/UNAVAILABLE，缺失字段、单侧 null、版本不一致、非 libc 双 null、自定义规则均拒绝。保留 allFrozenCollationsMatch 兼容字段，其含义仅为目录元数据一致，并以 allFrozenCollationCatalogMetadataMatch 明确说明。两座容器必须与已固定镜像 ID 相同；仅通过 Docker inspect 的固定模板读取挂载目标 JSON（不读取源路径或环境），并以两次 docker diff 检查指定 libc/locale 路径及其祖先和子树的可见变更。路径不规范、挂载覆盖、可见文件变更、异常输出均先于数据库连接拒绝，保留固定中文诊断。本次保守规则也可能因 Docker 报告的祖先目录变更而拒绝正常容器，须评审实际观察，不删除、重建、清理或修改冻结容器以通过。成功仅报告 containerImageIdentityMatched=true、localeRuntimePathsObservedUnchanged=true，collationRuntimeIdentityVerified 始终为 false；Docker inspect/diff 不是实际进程加载库的内容哈希或 locale 行为认证，亦不排除未列路径、环境覆盖、并发变化。第五座尚未创建，后续创建与真实执行仍须分别授权；所有许可及来源认证继续为 false。

协作容器 Node.js 22.16.0 实际运行目录专项 12/12（原 7 项扩展为 12 项）及宿主机专项 8/8，共 20/20，零失败、零跳过；核心、测试、宿主机、入口及宿主机测试的 node --check 均通过。缺少确认参数及非 Windows 环境的真实入口均实测退出 1，未调用 Docker。两个变更文件 Git Blob `ed27fd1d673de3e651313bc819419e1c0a7e8af7`、`66eef27a877a9f5ac61944bd2e337ceebdeefcad`，原宿主机 `a7a56e5e7bbd0ef499c22e6b8712e5d296a36cf9`、宿主机测试 `cc58bd01b67b6e37c7cf92fe797a360f3d09443f`、入口 `e526e21c3362ce05d65ef8b2843f3be4a3a9bc1b` 与本地实测文件字节一致；执行模块仅取原始两个固定导出，未运行完整依赖环境。真实 Windows Docker inspect/diff、更新后的四库目录采集、完整 Vite+、中文文案及 Markdown 待维护者复验；本批未执行任何 PostgreSQL SQL、未创建或修改任何数据库资源。

## 2026-11-27 · PR #238 原端口验收及 15444 调整

维护者在原端口候选 HEAD `9addf51f408c1a326183c4bf0593bdc38bfbfc0c` 的 Windows 验收：四组专项 40/40，共享配置通过，Vite+ 582 格式/421 受检零警告错误，中文 448、Markdown 96，增量退出 0；真实离线计划成功并返回固定指纹，随后真实只读入口因宿主机端口存在 TCP 记录或检查结果异常而退出 1，工作区干净。未定位到具体占用或输出异常原因，未取得更新后的四库目录报告。

维护者明确要求将尚未创建的第五座 CHECK 往返实验宿主机端口由 15434 改为 15444。当前唯一固定目标为 `127.0.0.1:15444`，容器内 PostgreSQL 端口仍为 5432；其他目标身份、镜像、库名、角色、卷、网络和四个冻结库均保持原状。此决定取代前文的第五座 15434 拟议配置，不修改前文历史验收证据。`roundTripTarget.port` 是运行时单一配置源；宿主机预检继续要求所有目标端口 TCP 记录为空数组，旧 15434 及其他目标端口的模拟身份拒绝。不接受环境或参数覆盖，不自动选择端口，不清理进程，不改变创建或执行许可。固定离线往返计划不包含宿主机端口，计划指纹 `17c106877fe8e3177d405ac31fb335ce76c714511ce1eef537d3cf139e723d3a` 不变。15444 实际可用性、排除端口范围及未来发布绑定尚未核实。

更换端口后协作容器 Node.js 22.16.0 实际运行独立局部夹具五项测试，5/5 通过：新目标接受并拒绝 15434/15433/5432、真实日志计划指纹完整复算、新端口 PowerShell 命令及八项许可保持 false、非空及异常 TCP 结果拒绝、目录入口在新端口占用时停止。宿主机模块与远端 Blob `a7a56e5e7bbd0ef499c22e6b8712e5d296a36cf9` 一致；执行核心仅复刻其固定目标、计划和隔离校验相关片段，目录采集使用不会被正常调用的拒绝桩。两份局部模块语法检查通过。不是完整仓库四组测试或真实 Docker/PostgreSQL 验收；Windows 新端口及全仓增量链仍需复验。

## 2026-11-27 · PR #238 结案及第五座待审批创建契约

维护者 Windows 在 HEAD `1321aab1a1a1f52289e1d43d5b6f9b50aef4201b` 完成四组专项 40/40、共享配置、Vite+ 582 格式/421 受检文件零警告错误、中文 448 文件、Markdown 96，增量退出码 0。15434 实际由其他项目容器占用，按维护者决定改用 15444；历史及第四座容器退出后已由维护者恢复原有容器运行。固定离线计划及四库目录真实复验退出码 0，15444 观察无占用，四库两集群及固定镜像、指定路径检查均通过。UTF8、libc、LC_COLLATE/LC_CTYPE 均为 en_US.utf8，locale/version/actualVersion 均 null；recordedCollationVersionAvailable=false、recordedCollationVersionMatches=null、状态 UNAVAILABLE，collationRuntimeIdentityVerified=false，八项许可均 false。工作区干净，维护者明确授权后，PR #238 Squash 合入 `fb0cbd681b19ddd8997401b8f5b9d95ab86fd4ea`，无额外远端 CI 记录。端口未预留，尚未创建第五座。

本批仅增加第五座待审批创建契约及请求匹配器。只读入口复用同一固定本机 Docker 端点的四库目录采集，要求整份参考报告与 PR #238 真实观察完全一致；拒绝缺失、额外、伪造许可、旧端口、资源或镜像变化、排序规则漂移。计划固定 127.0.0.1:15444 -> 5432、原镜像 ID、新独立容器/本地命名卷/专用 bridge 网络、禁止复用现存资源、禁止拉取镜像、禁止自动重启，部分创建失败应保留现场。卷目标拟定为 /var/lib/postgresql/data；实际固定镜像卷声明及入口行为尚待验证。初始化拟定 UTF8、libc、--locale=en_US.utf8（统一 locale 类别，不将其他类别视为已核验）、本地和 TCP 均 SCRAM-SHA-256；专用角色作为隔离实例 bootstrap superuser，禁止用于生产。凭据策略为专用环境变量 SCADA_PRISMA8_NATIVE_ROUNDTRIP_PASSWORD、32 字节随机数十六进制编码；本批不读取、生成、保存或输出任何真实凭据，不修改根 .env。实际初始化阶段不得提前开启阻止 bootstrap 的全局只读；初始化后未来受控连接必须验证默认只读设置。参数根据 PostgreSQL 17 initdb 文档 https://www.postgresql.org/docs/17/app-initdb.html 拟定，Docker 固定镜像实际初始化、SCRAM 本地认证及 locale 可用性仍需后续验证，失败不得降级、改变既有库或自动重试。创建计划 SHA-256 独立于原 CHECK 往返计划指纹。请求匹配器仅核对专用确认字符串与重新计算的创建计划指纹，不能认证操作者、消费一次性授权或发出 Docker 写命令；当前只读 CLI 不接受创建参数，没有实例创建入口。即使请求匹配，所有许可、creationAttemptClaimed 及完整运行时身份认证仍为 false。未来须在单独明确授权后实现并复验创建执行器、一次性记录、目标资源所有权与竞争检查、凭据传递、实际集群身份排除、排序规则、23 类空库及其他会话检查；不得将已匹配指纹当作真实写入授权。

协作容器 Node.js 22.16.0：新建核心、入口、测试通过 node --check；8 项离线测试全部通过。局部测试仅从已合并执行模块原文提取固定目标与计划指纹导出，无 Docker、PostgreSQL 或完整 Vite+ 工具链。另从维护者上传的 PR #238 真实只读成功报告提取 JSON，实际调用新核心复算创建计划并核对请求：`69cd50940b9e3ff9752aa45eea3ff60bc34214ca7127908259a54897c6013dd7`，resourceCreationAllowed=false；原计划指纹 `17c106877fe8e3177d405ac31fb335ce76c714511ce1eef537d3cf139e723d3a` 不变。三个新增源码远端 Git Blob 与本地实测源码一致：核心 `47bf970c49b88bb608bd600572ae8fb1a92d7908`、入口 `83ea8fa70c7f580cfad847ddf6b67ac14b146b57`、测试 `2bb406e41a536e5d7855e1f2a5866af957a7e547`。完整 Windows 增量 48 项、Vite+、中文、Markdown 与新 CLI 的现场只读复验仍待执行；未执行任何真实数据库创建、DDL、迁移、签名或部署。

## 2026-11-27 · PR #239 结案及第五座停止态创建执行器

维护者 Windows 在 HEAD `9fb7261f692b7d1b2756a18719a660c13f36b5d0` 完成 PR #239 验收：五组专项 48/48、共享配置、Vite+ 585 格式/424 受检文件零警告错误、中文 451 文件、Markdown 96、增量退出码 0；正常提交并推送两份源码格式化，远端核对无业务语义变化，真实离线往返计划及创建计划复验退出码 0，工作区干净。原往返计划指纹 `17c106877fe8e3177d405ac31fb335ce76c714511ce1eef537d3cf139e723d3a`、创建计划指纹 `69cd50940b9e3ff9752aa45eea3ff60bc34214ca7127908259a54897c6013dd7` 均一致，所有许可及 creationAttemptClaimed=false。维护者明确授权后 Squash 合入 `8b8f5b569b375e11a0fb0c4d2bcd1caec302caa1`，无额外远端 CI 记录。

本批新增受控停止态资源创建执行器：固定 Windows 本机、已验收的专用确认字符串及创建计划指纹，专用凭据只接受 64 位小写十六进制格式，不将格式检查视为随机性证明。重新执行已授权的四库系统目录只读采集，并保留同一预检取得的本机 Docker 端点（不改变原公开报告）；严格复算创建计划并检查固定镜像 ID、唯一卷声明 /var/lib/postgresql/data、入口 docker-entrypoint.sh 和命令 postgres。首次 Docker 写命令前，在同一工作区根目录 `.artifacts/prisma8-native-check-roundtrip-creation` 原子独占创建目录并以 wx 及 flush 写入 attempt.json，记录固定指纹与 128 位随机尝试标识，不含凭据；路径链接、任何已有目录或登记失败均拒绝。依次创建专用 local 数据卷、bridge 网络、停止态容器，仅回环 127.0.0.1:15444 映射 5432，镜像 pull=never、restart=no、volume-nocopy，所有资源带固定 scope 与本次尝试标签；检查卷驱动、标签、无额外选项、容器占用，网络完整 ID、唯一名称、标签及端点占用，随后检查容器完整 ID、created 状态、固定镜像、卷挂载、HostConfig 端口配置、网络模式、禁止特权/自动移除/全部端口发布、入口及命令，最后复验卷与网络归属并独占保存 result.json。Docker volume create 同名可能复用，不能仅凭返回名称判成功；任何异常均停止、保留记录和部分资源，不清理、不重试、不启动。专用环境变量 SCADA_PRISMA8_NATIVE_ROUNDTRIP_PASSWORD 仅通过创建容器子进程 POSTGRES_PASSWORD 传递，不进入命令参数、报告、记录或源码；其他子进程仅继承既有系统白名单。不读取完整容器环境，Docker 管理员仍可访问容器保存的环境值，后续必须保护该本机凭据。停止态成功报告只描述观察到的资源及已消费的尝试记录；containerStarted、databaseInitialized、portReserved、resourceCreationAllowed、databaseExecutionAllowed、roundTripVerified 等均 false。停止态端口映射配置不等于实际端口绑定，卷标签及本地登记不能防御具备 Docker/文件系统管理权限的并发操作者或跨工作区故意重置；实际启动前须重新核验归属、容器配置、端口及证据。本批未创建真实资源、未运行 Docker start/SQL/迁移，不改变四个冻结库、历史证据或正式 Prisma 7。真实停止态创建必须在验收、合并后取得维护者单独明确授权；启动与初始化仍为后续独立阶段。

协作容器 Node.js 22.16.0 实际通过新增八项及宿主机八项、参考目录十二项、创建计划八项局部回归，共 36/36，零失败、零跳过；新增核心、测试及修改后的宿主机模块语法检查通过，无参数实际入口退出 1。测试使用注入子进程和真实独立临时文件系统，不接触 Docker。新增核心 Git Blob `2fbd04b1dc32f135aa2f3a50b88b57953d639767`、测试 `e38e3162b114c1258582ba5ac1ca81330196a447`、修改后宿主机 `2a1f00b806026d8a16eedc00753bfa1e82e2d101` 与远端一致；固定参考与创建核心、宿主机专项副本亦与合并基线一致，执行模块仅取固定导出，参考与创建专项使用等价局部源码副本（未同步全部排版）。未运行完整仓库、真实 Windows Docker、Vite+、中文、Markdown 或 PostgreSQL，Windows 六组 56 项和静态质量链待验收。

## 2026-11-27 · 全新安装候选验证

维护者清理旧项目八容器、六命名卷、三网络；新基础设施实际 PostgreSQL 19.0、Redis 8.12.0、Keycloak 26.8.2，PostgreSQL 与 Redis 健康检查通过，Keycloak 启动，业务库 public 表数为零。未证明 OIDC 联调或业务应用运行通过。

协作环境 Node.js 22.16.0 对远端 Git Blob 0e215f3d6cfdbf56cb7c07d09f7db00c98a6121b 核心进行语法检查；测试 Blob 75243c1f50266dc08e0921e62a9333cabd5243f8 与远端一致，筛选执行十项纯逻辑测试，10/10 通过。首次运行额外源文件测试因容器没有完整检出、缺少 PSL 文件而失败；随后筛选十项通过，不登记全十一项通过。远端原生 PSL 源重建前指纹与此前验收一致，仅调整文件头说明，新源 SHA-256 e35bc6e946220df310ce39bdc61e3072ac00630c76efdbb449770e6606e8d61b，十二模型、三十六 CHECK；最终注释 SQL 指纹 06a47418f3477c263cb19c7a3550a6be3810a4ffd9c22afada7ecd28f6322fb7 与历史最终评审一致，共一百一十九条。完整 Windows 新增测试、原预检与 Docker 回归、Vite+ 质量链及真实官方 CLI 发射、PostgreSQL 19 只读规划待验证；未执行真实初始化、迁移、数据写入或启动业务应用。

## 2026-11-27 · PR #241 排序告警修复复验

维护者 Windows 修复前四组专项 52/52，配置通过，Vite+ 592 格式文件/430 受检文件零错误、三条排序告警，中文 457 文件及 Markdown 97 份通过。该结果不代表零告警或真实数据库通过。

本批核心四处显式字符串码元比较，新增两处中文集合类型说明，测试固定预期顺序并增加两项回归；未修改原生 PSL、中文注释 SQL、固定依赖或数据库安全门禁。协作容器 Node.js 22.16.0 对提取片段执行 node --check 及三项局部测试（两项新增回归与比较器等价性）均通过；片段 4874 个 UTF-16 码元，FNV-1a 1d9d1de5，核心及测试 Git Blob 7295a31fd1e4da7509a51a43a81a107a2f450668、764c8c968e7aba985fb4d89e1bd1acb05184e096 已回读一致。完整仓库未检出，协作容器无 pnpm/vp，修复后完整四组专项预期 54 项、Vite+、中文文案、Markdown 和真实官方发射及 PostgreSQL 19 只读预览仍待 Windows 实测。未执行数据库初始化、历史迁移或业务启动。复盘见 E-156。

## 2026-11-27 · 全新数据库正式初始化与原生运行时评审候选

维护者在 Windows 已验收 PR #241 四组专项 54/54、Vite+ 592 格式/430 受检零警告错误、中文 457、Markdown 97、增量退出码 0；格式化提交 09385336fa9a7880965c89597b85dea7b1742a99 正常 Hook 通过并推送，实际原生发射及 PostgreSQL 19 空库只读预览退出 0（23 类、45 项新增）。明确授权后 Squash 合入 4a06766da5d9ec99bed96104dc26c17d21112d43。合并后再次空库预览成功；维护者另行授权并在检查分支、提交和干净工作区后真实首次初始化，返回 FRESH_DATABASE_INITIALIZED；独立 docker:db:status 返回 FRESH_DATABASE_VERIFIED，退出码 0、工作区干净。两次报告均为 serverVersion=190000、databaseInitialized=true、存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436、12 表、85 字段、36 CHECK、20 非主键索引、13 外键、119 注释。此后禁止重复首次初始化或运行旧迁移。

下一批先核对现有 Prisma 8 候选与真实原生生成物的类型兼容性，再切换正式注入。新增固定只读运行时评审入口：重新官方发射并核对存储、声明和中文注释，复用已评审的关系差异（末次发布事件六字段关联、无反向导航），保持历史标识门禁；用已安装 TypeScript 分别对旧生成物及内存替换的全新 JSON/声明进行完整服务端类型检查，不改写旧 Git 生成物。通过后复用现有本机 Docker 身份、严格 db verify 与注释核验，Prisma 8 使用全新原生契约及同一调用方 pg.Client；在查询前后核对真实集群、业务库角色、public Schema 与事务默认只读设置，只查询随机不存在的租户/工程联合键，要求 null，按顺序关闭客户端与连接，失败脱敏且不返回成功。无 DML、DDL、签名、迁移或业务值输出，不注册正式 NestJS Provider，不扩大既有隔离写入候选范围。只有评审通过才进入正式 Provider 与仓储装配阶段；真实应用启动、写入、事务、双框架及生产部署仍须分别验收。

协作容器 Node.js 22.16.0 实际执行新探针及测试的 node --check 和四项注入连接/运行时测试，4/4 通过；对应 Git Blob db61af31268ba26e3505e83eb89ce0d603746b5d、e481204204aac4b05a94ed1f8f2193e9c868af61。协作环境无完整仓库、pnpm、Vite+、固定 Prisma 8 依赖或本机 PostgreSQL；旧/新完整类型检查、运行时真实连接、其余专项与代码质量链尚未执行。Windows 预期 test:prisma8:fresh 17 项及 test:prisma8:native:runtime 7 项；新增评审不进入自动 ready 的真实连接阶段。未执行任何真实数据库操作。

## 2026-11-27 · 原生运行时评审通过与 NestJS Provider 候选

PR #242 维护者 Windows 实测 Core 构建与旧客户端离线生成成功，专项 24/24（17+7），Vite+ 594 格式/432 受检文件零警告错误，中文 459 文件、Markdown 97、增量退出 0；两份源码格式化正常提交 Hook 通过并推送 HEAD f1324c126bf7e7954cce30c207776f14d1d2412b，远端差异仅排版。实际 FRESH_RUNTIME_REVIEW_READY，PostgreSQL 190000、存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436、12 表、85 字段、36 CHECK、20 非主键索引、13 外键、119 注释；databaseInitialized、nativeRuntimeTypesVerified、missingScopeVerified、readOnlyBoundaryVerified 均 true，providerSwitched=false，退出码 0、工作区干净。已按维护者明确授权 Squash 合入 87c8382b41418bee1e65d354705ec12ccdeb2d69，未取得额外远端 CI 记录。

实现独立 Prisma8Service 与 Prisma8DatabaseModule，原生 PSL 离线发射到 src/generated/prisma8-runtime，固定版本、存储指纹、声明和注释门禁沿用全新安装入口；旧 Prisma 7 客户端及旧 Prisma 8 候选生成物暂保留，禁止互相覆盖。原生生成纳入服务端 db:generate 及构建/启动依赖，Git、Docker 上下文及共享 Format/Lint、中文扫描仅排除新增的精确生成路径。Provider 由 Nest 管理一个进程内连接池，初始仅支持本机 adui_scada:15432 固定开发边界，拒绝生产环境默认配置、远程/Keycloak/历史库、额外连接参数；启动查询核验实际数据库、角色、Schema、PostgreSQL 19、只读设置、集群标识及 app 原生标记 core_hash，不能把官方运行时的 marker 告警当作硬门禁。随后以实际原生 ORM 查询随机不存在工程联合键，再复核连接；启动失败或关闭期间拒绝暴露客户端，按顺序释放运行时和调用方连接池，保留脱敏失败阶段。单独只读烟测复用既有严格结构、注释和本机 Docker 集群身份核验，使用编译后的 Nest TestingModule 实际装配 Provider，配置只读且传入真实集群标识，确认启动、同一提供方客户端、关闭后拒绝访问。当前不导入正式身份或工程 HTTP 模块、不改变旧业务仓储隔离门禁；providerSwitched=false。正式生产角色及容器内连接策略、业务写事务、实际 Docker 构建和完整应用切换另行验收。

协作容器 Node.js 22.16.0 实际运行新增边界与生命周期测试 8/8，TypeScript 5.8.3 对纯边界源码执行 strict noEmit 检查通过；对应源码 Blob 14712538534a11746fa32507f4579581ab292f7a、测试 Blob 82a5aa7df6d2b92fb9f41474f42a4e53160bba1f。测试覆盖 URL、角色和标记等边界漂移、启动前不可用、单次释放、启动失败、启动期间关闭、关闭失败及双重失败脱敏。该环境没有实际固定 Prisma RC、完整 NestJS 依赖、pnpm/vp 或维护者 PostgreSQL，未执行实际原生发射、新 Provider 编译/真实烟测、完整 Windows 质量链与 Docker 构建；不得把模拟测试描述为正式业务运行。

## 2026-11-27 · 原生 Provider 验收与身份 ACL 查询端口接入

PR #243 维护者 Windows 实测 Core 构建、Prisma 7 客户端及 Prisma 8 原生运行时契约离线生成成功（FRESH_RUNTIME_CONTRACT_EMITTED、databaseAccessed=false）；三组专项 34/34（25+7+2），Vite+ 600 格式文件/438 受检文件零警告错误，中文 465 文件、Markdown 97、NestJS 构建及增量退出码 0。三文件正常格式提交 34dc2a20f39770f33085a8babefb094d54a85931 已推送，远端核对仅排版。真实 FRESH_PROVIDER_SMOKE_READY，PostgreSQL 190000、providerReady/providerClosed/readOnlyBoundaryVerified/databaseInitialized=true、providerSwitched=false，原存储指纹及 12 表、85 字段、36 CHECK、20 非主键索引、13 外键、119 注释一致，退出码 0，工作区干净。按维护者明确授权 Squash 合入 b9248081590337c50f4151eb5cc2b5c09b1f9fce；未取得额外远端 CI 记录。

将正式 OIDC 回调的已验签外部身份预绑定查询与工程 Guard 的前置 ACL 查询从具体 Prisma 客户端抽离为 AuthorizationReadStore，保留旧模块显式 Prisma 7 过渡绑定及已有联合键、权限投影、会话签发、HTTP 与锁内授权语义。新增 Prisma8AuthorizationModule，仅导入已验收 Prisma8DatabaseModule，使用新原生生成 Contract 实现相同端口，不复制连接池，不使用旧隔离候选或将隔离库写入门禁改为业务库。身份只查询既有活跃映射，不自动注册；完整权限集合仍由 hasProjectPermission 按可信租户、主体、工程及操作判定，非法标识查询前拒绝，固定主体副本，数据库异常固定 503，不记录授权成功。原生仓储使用 Prisma8Service.readTransaction 及新 readPrisma8Transaction，在同一 ReadCommitted 事务前后核验实际数据库、角色、Schema、PG19、集群标识、原生 marker core_hash、配置与实际只读状态及非恢复模式；只有查询及边界复核均成功才返回结果。读仓储只包含 SELECT/ORM 查询；真实烟测强制 PostgreSQL 默认及事务只读，正常可写配置只核验模式一致，不宣称所有未来业务事务都强制只读。扩展原有真实 Provider 烟测：实际 Nest 装配原生端口及正式 ScadaProjectGuard，以随机不存在的身份及租户/工程联合键核验空映射、空授权、固定 404 与 permission_denied 审计，不打印凭据或业务行，不写业务数据、不挂载 HTTP 根模块。当前正式 HTTP 根模块仍明确使用旧过渡绑定，providerSwitched=false；会话及 OIDC 事务、工程版本和发布写事务统一切换后再启动原生正式应用，禁止混合两代数据库运行。

协作容器 Node.js 22.16.0 实测新增纯端口查询键和不可变主体测试 3/3；源码 Git Blob d911e761803f1f267000e62298bb9e2ba1468b2b、测试 Blob 272d9afe2f0969e996999e3da703c88ab6704823 与远端一致。对原生事务包装器 Blob e9518cc0c923508bd059bd67e869c9f399ee63a1 使用 TypeScript 5.8.3 noCheck 转译并在模拟事务上验证正常前后核验、错误库/只读状态/隔离级别及查询后标记漂移，5/5 通过；这不是 SDK 类型检查或真实 PostgreSQL 验收。新增六项原生仓储 Vitest、Guard 脱敏错误及模块装配断言尚待维护者 Windows 执行；协作容器无完整仓库、固定 Prisma RC、pnpm/vp 或本机 PostgreSQL。未执行实际业务写入、完整工程测试或真实烟测。

### 2026-11-27 · PR #244 E-157 历史 ACL 构造调用修复

维护者 Windows 修复前全新原生专项 28/28、原生运行时 7/7、四份身份及装配专项 39/39、HTTP E2E 63/63，共 137/137；Core 构建、双版本客户端/契约生成及共享配置通过。vp check --fix 在 445 个受检文件中报告 TS2739 一项错误、零警告，格式化完成但增量退出码 1；后续独立 vp check、中文、文档、服务端构建和真实原生授权只读烟测未执行。日志未给本机 HEAD。

仅为 apps/server/test/prisma8-project-acl.db-spec.ts 中的历史 Prisma 7 Guard 构造调用补充 Prisma7AuthorizationReadStore 导入并包装原 database；复用现有适配器，不新建客户端、不改变 Prisma 8 对照 Guard、隔离库 URL、授权断言、撤权及清理逻辑。不改生产代码、数据库或配置。

已逐一读取当前 PR HEAD 的 59 份服务端 spec、db-spec、e2e-spec，核对两个改造构造函数的直接调用及显式 provider 匹配，并复核正式身份模块及原生烟测；仅发现上述直接构造调用仍传原数据库对象。协作容器 Node.js 22.16.0 / TypeScript 5.8.3 用最小依赖类型声明及对应真实端口签名复现旧调用 TS2345（缺少同样两个方法，退出 2），包装后 strict noEmit 退出 0。此为最小类型复现，不是仓库 TypeScript 6 或真实 SDK 编译；完整 Windows Vite+、中文、文档、服务端构建、原生只读烟测仍待复验，未执行历史数据库专项或数据库写入。

保持 Draft；验收通过并经维护者授权后才可合并。

### 2026-11-27 · PR #244 复验结案与原生身份事务候选

PR #244 Windows 修复后 Core 构建、双契约离线生成、Vite+ 607 格式文件/445 受检文件零警告错误、中文 472、Markdown 97、NestJS 构建、git diff --check 均通过，增量退出 0；此前修复前专项与 HTTP E2E 137/137。正常 Hook 格式化提交 c0990870e13e8cf143af144344c3f96d49b563ae 已推送，五文件远端差异仅排版。真实 FRESH_PROVIDER_SMOKE_READY，PostgreSQL 190000、databaseInitialized/providerReady/providerClosed/readOnlyBoundaryVerified/authorizationReadVerified/missingProjectDenied=true、providerSwitched=false，存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436、12 表、85 字段、36 CHECK、20 非主键索引、13 外键、119 注释，退出 0、工作区干净。维护者明确授权 Squash 合入 02087974c7cba37857cae1984c0a5fc2a09fb16d；无额外远端 CI 记录。E-157 的 Windows 类型修复已复验，历史隔离库写入测试未执行。

新增共享 Prisma8AuthTransactionPort、Prisma8SessionOperations 与 Prisma8OidcLoginOperations；共享层仅使用参数化 raw/query/execute，历史候选保持原构造签名、隔离库名、只读模式、隔离级别、专用随机测试 Issuer 及旧清理定时器门禁，独立原生实现通过 Prisma8Service.readTransaction/writeTransaction 接入新生成 Contract。原生写事务明确拒绝只读配置，在同一 ReadCommitted 事务业务执行前后复核真实业务库、角色、Schema、PG19、集群标识（配置时严格比对）、原生 marker core_hash、可写模式及非恢复状态，后置校验抛错依 SDK 事务约定回滚。保留会话十秒/OIDC 五秒事务超时、主体共享锁与独立摘要、租户主体会话精确撤销、State/浏览器绑定摘要、PKCE S256、AES-GCM、Nonce、一次性 FOR UPDATE 加条件更新和按 Issuer 的 128 条有界清理。原生身份模块仅绑定现有会话及 OIDC 服务令牌、共享授权模块与原生数据库，不挂 HTTP 路由，不导入旧数据库模块；旧正式根模块不变。只读烟测覆盖随机不存在会话、Bearer/Cookie 拒绝、会话签发撤销与 OIDC 创建消费清理的拒绝，使用内存合成 OIDC 配置和禁止网络访问的发现替身；原生模块暂不启动清理定时器，正式根模块切换后另行验收。

协作容器无固定 Prisma SDK、NestJS 依赖、pnpm/vp 和维护者数据库，不能执行完整工程类型检查或真实烟测；TypeScript 5.8.3 --noCheck 转译与远端 Blob d9dfed983c91273f13cc6da2698ef8ed29e50327 一致的事务包装器及 Blob 14712538534a11746fa32507f4579581ab292f7a 一致的原有身份边界，Node.js 22.16.0 实际模拟回归 6/6（正常提交顺序、只读早拒绝、错误/缺失身份、后置漂移模拟回滚、业务异常、原只读查询）；不代表实际 PostgreSQL 提交回滚或 SDK 类型已验证。静态逐字比较原候选移入共享层的八条业务 SQL 完全一致，新增 9 项身份 Vitest 和 1 项模块装配断言待 Windows 实测；历史 4 项会话及 5 项 OIDC 单元测试亦须回归。未执行数据库写入、重复初始化、历史迁移或真实 IdP 调用。

### 2026-11-27 · PR #245 E-158 双 Contract 身份端口类型修复

维护者 Windows 首轮 Core 构建、Prisma 7 客户端与新原生运行时契约离线生成（databaseAccessed=false）、共享配置通过；全新专项 28/28、运行时 7/7、身份与装配 58/58、HTTP E2E 63/63，合计 156/156。vp check --fix 报历史会话与 OIDC 候选 operation(tx) 两项 TS2345，原生身份测试 timeout 默认值一项 typescript(no-useless-default-assignment) 警告（451 受检文件）；格式化完成但增量退出 1。日志未提供本机 HEAD，后续独立检查、文案、文档、构建、真实烟测未运行。

根因为共享端口 Pick<Prisma8Transaction, raw/query/execute> 仍携带新原生 Contract，历史 Contract 的主键声明缺少新生成物要求的 name，raw.sql 类型不可赋值。改为仅暴露参数化文本查询与影响行数的共享端口，两套适配器分别以自身强类型事务构造和执行 SDK 计划；保留相同的八条业务 SQL（模板逐字核对）、参数、事务超时、历史隔离库/Issuer 门禁、原生前后边界及只读拒绝、业务锁和影响行数判断。不跨契约断言、不拼接 SQL、不新增连接或修改生成产物。返回列缺失或非文本时失败关闭；移除测试模拟函数冗余默认值。新增两项 Vitest 候选覆盖两代适配器参数转发及异常行、原生签发遇异常行模拟回滚。

协作容器 Node.js 22.16.0、TypeScript 5.8.3，以最小 SDK 类型模型（两代 Contract 主键 name 差异、参数化 raw/query/execute 签名）复现旧端口类型不兼容并通过新端口 strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes 检查；四项独立模拟测试通过，覆盖两代适配器参数转发、影响行数及缺失/继承/非文本列拒绝。该模型不等于已安装 Prisma 8 RC 或仓库 TypeScript 6；协作容器无固定 SDK、完整依赖、pnpm/vp 或本机 PostgreSQL。Windows 完整增量质量门禁及真实只读烟测仍待复验。保持 Draft，不切换正式根模块、不启用定时清理、不执行数据库写入或迁移。

### 2026-11-27 · PR #245 E-158 结案及原生工程查询接管候选

维护者 Windows 复验全新专项 28/28、原生运行时 7/7、身份与装配 60/60（原生身份 11/11）、HTTP E2E 63/63，共 158/158；Vite+ 613 格式文件/451 受检零警告错误、中文 478、Markdown 97、NestJS 构建和 git diff --check 均通过，增量退出码 0。正常 Hook 格式化提交 da0c6a5eb348e5c4238b032bf30eed26f0ee937b 已推送，核对 13 文件差异仅排版。真实 FRESH_PROVIDER_SMOKE_READY，PostgreSQL 190000、12 表、85 字段、36 CHECK、20 非主键索引、13 外键、119 注释及存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436 一致，databaseInitialized/providerReady/providerClosed/readOnlyBoundaryVerified/authorizationReadVerified/sessionReadVerified/identityWriteDenied/oidcDiscoverySkipped/missingProjectDenied=true，providerSwitched=false，退出 0、工作区干净。维护者明确授权 Squash 合入 feat/mvp-first-integration 的 961c4b0278d3de5fbd4fdc3515b3783fb58f43e8；E-158 类型与 Lint 复验关闭，真实身份写入、并发消费及回滚仍未验收。

将已实现的历史 Prisma 8 工程查询候选五项业务逻辑抽出 Prisma8ProjectQueryOperations，历史构造签名、隔离库名、读已提交且非只读事务门禁不变。原生 Prisma8RuntimeProjectQueryStore 和独立 Prisma8ProjectQueryModule 仅使用已验收 Prisma8Service/Prisma8DatabaseModule，不增加连接池、控制器或正式根模块。将 E-158 已验收的参数化文本适配器移至数据库公共层 Prisma8TextTransaction，分别使用历史与原生强类型 SDK 事务构造计划，增加 BigInt 参数支持并保留身份适配器原错误文案；工程端口仅暴露 queryText 与完整 ACL 投影，不暴露 executeCount。

五条业务 SQL 模板逐字比较一致，保留租户/主体/工程联合条件、工程 ID 升序及稳定游标、历史修订号 BigInt 倒序分页、最多 100 条、轻量摘要与原 SHA-256/元数据完整性、发布预检 head 一致性。详情、历史列表、指定快照及发布预检必须先取得同一工程共享锁，再查询完整权限集合并使用既有纯策略复核，拒绝未知权限；不得把前置 Guard 当成锁内授权。原生列表允许严格只读，四项锁内查询要求非只读事务配置（PostgreSQL 不允许 READ ONLY 执行 FOR SHARE），在取得事务前调用现有 assertWritable 拒绝，不通过无锁替代、自动改变连接模式或 DML 绕过；正常非只读模式仅执行 SELECT/ORM 查询，统一由 readTransaction 在同一 ReadCommitted 事务前后核验真实身份与标记，超时十秒。

协作容器 Node.js 22.16.0 使用与远端 Git Blob 18e7d905a9d1b3c70b5e0301bc728c01d43cb4a1 一致的 Prisma8TextTransaction 源码，执行 node --experimental-strip-types --test 的六项独立模拟测试，6/6 通过，覆盖两代参数化 BigInt 转发、影响行数、缺失/继承/非文本列及调用方错误消息。源码迁移的五条业务 SQL 模板已静态逐字比较一致。容器 DNS 无法访问 GitHub、未安装固定 Prisma SDK、NestJS、pnpm/vp 或维护者 PostgreSQL；新增十项仓库 Vitest、一个模块装配断言、历史/身份回归、完整 Windows 质量链与真实只读烟测均待执行，不声称真实锁并发、正向授权工程读取或写事务通过。真实烟测扩展为随机不存在主体的空工程列表与四项锁查询提前拒绝，新增 projectListReadVerified、projectLockedReadDenied；原全部字段保留，providerSwitched=false。未执行数据库写入、历史迁移、重复初始化或正式 HTTP 启动。后续工程创建/追加版本的 CAS、审计与发布初始状态事务单独迁移并验收。

### 2026-11-27 · PR #246 验收关闭与全新原生工程写入

PR #246 维护者 Windows 专项 175/175（全新 28、运行时 7、工程查询 16、身份与装配 61、HTTP E2E 63），Vite+ 617/455 零警告错误，中文 482、Markdown 97、构建及增量退出 0；实际 PostgreSQL 19 只读烟测 FRESH_PROVIDER_SMOKE_READY，projectListReadVerified/projectLockedReadDenied/missingProjectDenied=true、providerSwitched=false、指纹及 12 表/85 字段/36 CHECK/20 索引/13 外键/119 注释一致。验收 HEAD 2a9e4c2b47611dde4764a7097a7c6af16a06a83d，合并 c4ebce33dc210e5e4b38492f37f726aede28ed22。

本批只开发全新原生写事务：原有九条业务 SQL 模板静态逐字核对，新增十一项原生 Vitest 模拟回归，独立模块装配及真实只读烟测新增 projectWriteDenied 标志。协作环境无法安装固定 SDK、执行完整 Windows 工具链或连接维护者数据库，新增测试、完整编译与真实烟测待验收；模拟拒绝不等于真实 PostgreSQL 回滚。不得为本批运行历史数据库或迁移专项。

### 2026-11-27 · PR #247 原生工程写入验收及 E-159 修复

维护者 Windows 在 2cdbbd7441c7bb7bc7b74d5cfbba9b7ff3f1c781 完成全新专项 28/28、原生工程写入 11/11、查询 10/10、模块装配 9/9，共 58/58；Vite+ 619 格式文件/457 受检文件零错误但一条 vitest(require-to-throw-message) 警告，中文 484 文件、Markdown 97 份、NestJS 构建、git diff --check 及增量退出码 0。正常 Hook 格式化提交 bc8c9ecd03988c97c1349427be59f9aca7c374c4 已推送，三文件差异仅排版。真实 FRESH_PROVIDER_SMOKE_READY，PostgreSQL 190000、存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436、12 表/85 字段/36 CHECK/20 索引/13 外键/119 注释一致，全部既有只读核验及 projectWriteDenied=true，providerSwitched=false，退出 0、工作区干净。

后置身份漂移夹具将 role 改为 wrong，实际由 requirePrisma8RuntimeIdentity 抛出“Prisma 8 运行时数据库身份、标记或连接边界不一致”。仅将无参数 toThrow 改为该确定文案，保留边界执行顺序、模拟拒绝及未提交断言，不改变业务 SQL、提供方或数据库。静态复核唯一替换及该文件无无参数 toThrow；Windows 原生写事务定向测试、Vite+ 零警告及中文/文档检查待复验。 保持 Draft，维护者已同意继续，但零警告复验完成前不合并。无旧库迁移、初始化或真实业务写入。

### 2026-11-27 · E-159 复验关闭与全新原生发布仓储验收边界

维护者 Windows E-159 复验 HEAD 8d18844f189afb726a27e95f66b84ffeda41e7b2：原生工程写入 11/11、619 格式文件、457 受检文件零警告/Lint/类型错误、中文文案 484、Markdown 97、git diff --check 均通过，退出码 0、工作区干净。此前 58/58 增量及 PostgreSQL 19 真实 FRESH_PROVIDER_SMOKE_READY（projectWriteDenied=true、providerSwitched=false、指纹和结构数量一致）通过，修复只修改测试及文档，未改变业务或烟测代码。维护者明确授权，PR #247 已 Squash 合入 feat/mvp-first-integration 的 6ef45e964c2b2bb87b4a01eed1e66cd3321fda9d。E-159 已关闭。

协作容器 Node.js 22.16.0 对从远端源码摘取的请求解析、语义哈希和十进制安全整数校验逻辑（Unicode 等价转义、最小领域错误类）运行 node --experimental-strip-types --test，6/6 通过；验证发布/回滚白名单、代次、UUID、摘要字段顺序与作用域、非规范整数和溢出。远端静态核对 13 条参数化 SQL、2 条 DML 仅位于固定门禁之后、15 项新增 Vitest 无无参数 toThrow。协作容器 GitHub Git 网络 DNS 不可达，未安装固定 Prisma SDK、pnpm/vp 和完整 NestJS 依赖，新增仓库 Vitest、类型检查、构建、真实 PostgreSQL 烟测待 Windows 实测；未执行真实业务写入、发布、回滚、旧迁移、重新初始化或正式根模块切换。模拟拒绝或幂等重放不等于真实成功发布事务通过。

新增原生只读烟测标志 releaseLockedReadDenied、releaseWriteDenied、rollbackWriteDenied；此前全部标志及存储指纹/结构保持不变。通过只读拒绝并不证明具有真实授权的当前发布正向读取或写入回滚已经验收。
