# ADui SCADA · 文档校验机制

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
