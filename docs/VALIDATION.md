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

| 命令 | 实测结果 |
| --- | --- |
| `pnpm run db:validate` | Prisma Schema 有效 |
| `pnpm run db:migrate:deploy` | 成功应用 `20261114000000_oidc_identity_transactions` |
| `pnpm run db:migrate:status` | 4 项迁移已登记，Schema 为最新 |
| `pnpm run test:db` | 2 个文件、16/16 测试通过，退出码 0 |

数据库测试包括 OIDC Schema 5/5 与既有工程版本数据库回归 11/11。OIDC 检查真实 PostgreSQL 中的迁移登记、两张表、15 个物理字段及中文表/字段注释、复合外键、检查约束、可空字段和三个业务索引及中文注释。

**范围说明**：本次只在已有的隔离 `adui_scada_test` 上应用增量迁移并执行测试；未删除或重置数据库。尚未从全新隔离数据库验证全部迁移的空库部署，也未执行第二次 `migrate deploy` 的幂等性检查。以上数据库结果来自维护者提供的 Windows 终端日志，不代表当前协作环境自行运行。

OIDC 登录、BFF Cookie/CSRF、工程 HTTP API、真实 IdP 联调及工业现场安全验证均未因此完成。开关继续默认关闭，未完成认证和 ACL 前服务端保持 fail-closed。
