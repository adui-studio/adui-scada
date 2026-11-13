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

第十七批维护者 Windows 基线：**375/375 单测、8/8 NestJS E2E**、完整 `ready` 退出码 0，Docker 隔离镜像烟测退出码 0。本批新增 3 项 `HttpReadinessIndicator` 单测，NestJS E2E 新增 2 项，**预计普通单测 378 项、E2E 10 项**。这只是预期，当前未取得本批 Windows 实测。

验证重点：`GET /health` 仍为 200 且响应完全不变；`GET /health/ready` 仅在 HTTP 应用完成初始化时返回 200、禁止缓存，返回 `http.status="up"`、`scope="http"`、`dependencies="not_checked"`；生命周期转入关闭时就绪接口返回 503，但存活接口不修改。Swagger 受控本机开发文档包含新探针，生产文档依然不可访问。Docker `--network none` 烟测验证服务端可加载 `@nestjs/terminus` 且探针可正常响应，未开放工程/登录/设备写入继续保持 404。

**合并前阻塞**：已声明 `@nestjs/terminus@12.1.0`，Peer 兼容 NestJS 12，但本协作环境不能联网生成 pnpm 锁文件。需维护者 Windows `pnpm install` 并审查提交 `pnpm-lock.yaml`，再运行 `pnpm install --frozen-lockfile`、`vp check`、`pnpm run ready` 和 `pnpm run test:docker:server`。不应通过跳过冻结安装或篡改 Peer 校验验收。PostgreSQL 真库、Redis 及工业现场设备未在本批测试中验证。
