# ADui SCADA · NestJS API

基于用户上传的 NestJS 12 ESM 默认模板初始化。仅用于 V0.1 工程验证，非生产 API。

```powershell
pnpm --filter @adui/scada-server run start:dev
pnpm --filter @adui/scada-server run test
pnpm --filter @adui/scada-server run test:e2e
pnpm --filter @adui/scada-server run typecheck
pnpm --filter @adui/scada-server run build
```

启动后访问 `http://127.0.0.1:3001/health`。这是进程存活检查，**不代表数据库、Gateway 或真实设备在线**。

默认仅绑定 loopback、禁用跨域、没有认证/数据库/设备接口；接入业务 API 前必须完成身份验证与授权设计。TS6、NestJS 与测试依赖统一从根目录 `pnpm-workspace.yaml` Catalog 解析。

## V0.3 第十批：PostgreSQL + Prisma 7 数据库基础

数据库只为未来受控工程版本存储准备；目前不会在 NestJS 启动时连接数据库，也未注册业务读写接口。

```powershell
# 第一次切换本批分支后先同步依赖和锁文件
pnpm install

# 校验模型与生成客户端（无需运行 PostgreSQL）
pnpm run db:validate
pnpm run db:generate

# 从根目录 .env.example 复制到 .env（如已存在，请勿覆盖）。
# 开发库默认使用 127.0.0.1:15432 / adui_scada，模板已填写匹配的测试密码与 Prisma URL。
# 这些凭据公开且仅适用于隔离本机环境，正式部署前必须更换。
# Prisma 不会自动把 SCADA_DB_PASSWORD 拼进 URL，更改密码或端口后须同步更新 URL。
# db:dev:up/down 会显式从仓库根目录加载 .env；请勿将其输出的数据库口令贴到公开日志。
pnpm run db:dev:up
pnpm run db:migrate:deploy
pnpm run db:migrate:status

# 仅停止容器，保留开发数据卷
pnpm run db:dev:down
```

首次迁移文件由本批按 Prisma 模型手工编写，包含额外的 PostgreSQL CHECK 约束，必须使用隔离开发库核对实际 DDL；未通过真实迁移与回滚设计审查前不能用于生产。**严禁使用 `prisma migrate reset`、`db push --force-reset` 或 `db push --accept-data-loss` 清理现有数据库。**

## V0.3 第十一批：工程版本事务仓储

`ProjectPersistenceModule` 包含 `PrismaService` 和 `PrismaProjectVersionStore`，但**没有导入 AppModule**。数据库不会在现有健康接口启动时自动连接，任何工程版本 HTTP API 也尚未注册。未来必须先接入可信身份认证、工程级 Guard 与受控授权管理，再考虑导入模块和开放版本接口。

`pnpm run ready`、独立服务端 `typecheck` 和 `build` 会在使用生成客户端前执行 `db:generate`。仓储单测由 `test:unit` 覆盖；实际 PostgreSQL 双写、权限和快照读取使用隔离测试库执行 `pnpm run test:db`，详细隔离测试步骤见 [Harness](../../docs/HARNESS.md)。

### Navicat 中查看 PostgreSQL 中文表/字段注释

Prisma `///` 为源码文档注释，不会自动写入 PostgreSQL 元数据。第十一批新增 Prisma 迁移 `20261112170000_add_chinese_table_comments`，为 4 张业务表、23 个物理字段及 4 个索引写入中文 `COMMENT ON`。请先确认连接的是隔离开发数据库，再运行 `pnpm run db:migrate:deploy` 与 `pnpm run db:migrate:status`；成功后刷新 Navicat 表列表/设计视图，中文说明会显示在“注释”列。Prisma 自管理的 `_prisma_migrations` 不属于业务表，不在该迁移中修改。

### 共享 Core 的 Node.js 构建出口

服务端事务仓储依赖 `@adui/scada-core`，而共享 Core 现有源码内部使用显式 `.ts` 扩展名。为避免 NestJS 的 `NodeNext` 类型检查报 `TS5097`、或服务端构建把工作区外的 Core 源码编进 `rootDir`，Core 为 Node 消费端增加 `dist/*.js` 和 `dist/*.d.ts` 条件导出，Vue/React 继续从原 `src/*.ts` 导入。

`pnpm run build:core` 编译 Core 的 Node 产物；根 `ready`、安装 `prepare` 与服务端独立 `build/typecheck/start:dev` 会自动先构建。服务端 Docker 最终层携带 `packages/core/dist/`，不需要 Node 运行时擦除 TypeScript 源码。切换分支后请先 `pnpm run build:core` 再运行单独的 `vp check`。

## V0.3 第十二批：真实事务安全和服务端容器验收

本批延用现有 Prisma 7.10.1、PostgreSQL 17、NestJS、Vitest、Docker，不引入新依赖或修改数据库模型。独立 `pnpm run test:db` 新增真实 PostgreSQL 约束失败回滚、授权撤销与保存竞争、连接不可达测试，要求显式使用本机隔离 `adui_scada_test`，不允许回退到开发库或生产库。普通 `pnpm run ready` 新增一项无数据库的缺失 URL 单测。

另有 `pnpm run test:docker:server`，只构建独立服务端测试镜像并使用 `docker run --network none` 在容器内验证事务仓储模块导入、`/health` 及工程/设备写入路由继续返回 404；该命令**不会启动现有 Compose 演示栈、不会映射宿主机端口、不会尝试连接 PostgreSQL 或工业设备**。Dockerfile 仅增加一份明确可执行的容器内烟测脚本，不改变 NestJS 正式入口。

## V0.3 第十三批：可信身份主体、可撤销会话与工程级 Guard

当前新增 `ScadaIdentityModule`、`AuthSessionService`、`ScadaSessionGuard`、`ScadaProjectGuard` 和 `RequireProjectPermission` 装饰器，**均未导入 AppModule，也没有公开登录/签发或工程版本 HTTP 接口**。服务端已有 `/health` 不依赖数据库，未开放工程读写和工业设备写入仍为 404。

`AuthSessionService` 仅供未来经过可信登录/OIDC 身份验证的内部调用者使用：从 PostgreSQL 活跃主体记录签发一次性可见的 32 字节高熵不透明 Bearer 令牌；数据库仅保存 SHA-256 摘要、15 分钟过期时间和撤销状态，每次请求都重新核验主体是否停用。绝不能把浏览器提交的 `tenantId` / `subjectId` / `role` 直接用于调用内部签发方法。未来身份接入必须建立真实认证来源、发行者信任及安全审计。

新增 Prisma `ScadaIdentity` 和 `ScadaAuthSession` 两个业务模型，字段均有中文文档与 PostgreSQL 中文元数据注释。迁移为 `20261113000000_trusted_identity_sessions`，**不会重写旧迁移**。服务端实际接入前必须由管理员在隔离数据库执行迁移并验证完整授权测试。`scada_auth_sessions.session_id` 继续为 PostgreSQL UUID；Nano ID 只适用于后续新建字符串型不透明标识，不能未经迁移写入 UUID 字段。技术依赖选型见 [依赖推荐清单](../../docs/DEPENDENCY_SELECTION.md)。

## V0.3 第十四批：受控日志、OpenAPI 与 HTTP 安全基线

本批对已存在的 NestJS `/health` 服务接入 `nestjs-pino@5.3.1` / Pino 10 / `pino-http@11`，使用**仅记录请求 ID、HTTP 方法、响应状态码**的白名单序列化；不记录查询字符串、Authorization、Cookie、请求体或令牌，另外对可能进入后续日志对象的凭据字段开启 Pino redact。请求关联 ID 由服务端 Node `randomUUID` 生成，作为 `x-request-id` 响应头返回，**不信任客户端传入的请求 ID**。

`helmet@8.3.0` 默认提供安全响应头，Swagger UI 的 CSP 仅在本机开发且显式启用文档时做有限放宽。`@nestjs/swagger@12.1.1` 通过 NestJS 的 DocumentBuilder 注册文档，默认**根本不创建路由**；只有 `SCADA_API_DOCS_ENABLED=true`、`NODE_ENV` 非 production 且 `SCADA_SERVER_HOST=127.0.0.1` 时可访问本机 `/api/docs` 和 `/api/docs-json`。当前文档只包含已有 `GET /health`，不存在可以调用的登录、工程写入或工业设备写入 API。服务启动依旧不连接 PostgreSQL 或 PLC。

依赖已由 pnpm 12.18.0 生成并提交锁文件。Windows 首轮 E2E 曾在 `beforeAll` 超时；隔离 Vitest 中的 Pretty Transport 后再次实测，单独 E2E **8/8、退出码 0**，完整 `pnpm run ready` **退出码 0**（单测 356/356、E2E 8/8、React/Vue/NestJS 构建和文档检查通过）；Docker 隔离烟测在前一轮已通过。

日志与 HTTP 响应头属于运维可观测性，不是不可篡改的认证安全审计或工业操作审计。身份颁发、权限管理端点和真实设备写入仍保持关闭。详见 [ADR-0046](../../docs/adr/0046-pino-openapi-http-security.md)。

### 第十四批补充：配置与开发日志

`@nestjs/config@12.0.1` 在 `AppModule` 注册为全局配置模块，但根目录 `.env` 仍由 `main.ts` 使用 Node.js 原生 `loadEnvFile` 唯一加载；不直接依赖 `dotenv`。本阶段保留已有环境变量读取方式，不误称已完成配置 Schema 校验。

本地交互式终端仅在非生产、非测试环境启用 `pino-pretty@13.2.0`，便于查看中文日志；Vitest、生产环境及非交互式日志管道保持 JSON。不要在日志记录 Authorization、Cookie、数据库连接字符串、请求体或写入数据。锁文件、Windows E2E 和完整质量链均已通过本批验收；修改后仍应运行 `vp check`、`pnpm run ready`，并按变更影响复验 `pnpm run test:docker:server`。

## V0.3 第十五批：启动配置加载顺序与校验

根 `.env` 仍由 `main.ts` 使用 Node.js 原生 `loadEnvFile` 统一加载。此前静态导入 `AppModule` 导致其 Pino Logger 配置可能早于根环境变量生效；现改为先解析环境变量，再动态导入模块。纯函数 `resolveServerStartupConfig` 对主机、端口及本机 Swagger 开关进行集中校验，保留 `SCADA_SERVER_PORT` 优先于 `PORT`、`SCADA_SERVER_HOST` 优先于 `HOST` 的规则。生产不开放 Swagger，不新增任何业务 HTTP 入口。

维护者 Windows 已执行 `pnpm run env:check`、`vp check` 与 `pnpm run ready`：**361/361** 单测、**8/8** NestJS E2E、React/Vue/NestJS 构建及 63 份文档检查全部通过，完整 `ready` 退出码 **0**。独立 `pnpm run test:docker:server` 也已通过，退出码 **0**。本批未单独进行 PostgreSQL 真库回归，记录性文档提交后可复核 `vp check` 与 `pnpm run docs:check`。详见 [ADR-0047](../../docs/adr/0047-server-configuration-startup.md)。

## V0.3 第十六批：会话与工程权限安全事件边界

新增 `ScadaSecurityAuditService`，用于尚未挂入正式 AppModule 的 `ScadaIdentityModule`、`ScadaSessionGuard` 与 `ScadaProjectGuard`。所有允许/拒绝事件只输出固定操作、结果和原因码，由白名单构造字段后使用 NestJS Logger 记录，**不会附带 Bearer、Cookie、查询参数、请求体、工程路径或身份标识**。这属于运维诊断记录，不具备安全审计持久化、归责、事务一致性或日志丢失补偿能力；真实登录和业务写入接口仍关闭。

单元测试覆盖敏感字段过滤、非法事件组合、会话撤销和工程越权拒绝；预计本批常规单测 367 项、E2E 8 项，须由维护者 Windows 执行 `pnpm run ready` 与可选 Docker 隔离烟测后确认。详见 [ADR-0048](../../docs/adr/0048-security-audit-event-boundary.md)。
