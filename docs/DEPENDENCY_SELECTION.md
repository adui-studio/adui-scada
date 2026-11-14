# ADui SCADA · 服务端依赖推荐清单

> 评估日期：2026-11-13。此文包含阶段化技术选型与第十四批已锁定的服务端依赖及后续候选项，不是所有候选包均已安装。现有真实版本以根 `pnpm-workspace.yaml` 和 `pnpm-lock.yaml` 为准。新增依赖统一维护 pnpm Catalog 和锁文件，先验证 NestJS 12 / Node 24 / TypeScript 6 / Vite+ 兼容，再在独立 PR 引入；不擅自升级 Prisma、TDesign 或底层工具链。

| 领域                 | 优选依赖 / 版本                                                      | 状态与使用时机                                                                                                                       |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| ORM 与数据库驱动     | `@prisma/client`、`@prisma/adapter-pg`、`pg`（已锁定 Prisma 7.10.1） | 已采用；继续统一 PostgreSQL 事务和工程权限数据源                                                                                     |
| 短期可撤销服务端会话 | Node `crypto.randomBytes` + `createHash` + Prisma                    | **第十三批采用**；高熵不透明 Bearer，只保存 SHA-256 摘要，暂不暴露登录/签发 HTTP 路由                                                |
| JWT / JWKS 安全验证  | `jose` **6.2.17**                                                    | **建议后续引入**；当可信 IdP/JWT 场景确定后固定 `iss`、`aud`、`alg`、`exp`，避免自行实现 JWT 解析和签名                              |
| OIDC / 企业 SSO      | `openid-client` **6.8.9**                                            | 建议在企业身份联邦/统一登录阶段引入；必须采用授权码 + PKCE、状态/nonce、防重放与固定受信提供方                                       |
| 本地账号密码         | `argon2` **0.45.2**                                                  | 仅当正式实现本地账户时引入，使用 Argon2id 并规划成本校准、MFA 与凭据重置                                                             |
| 结构化日志           | `nestjs-pino` **5.3.1** + `pino` **10.4.0** + `pino-http` **11.0.0** | **第十四批代码已接入，锁文件已生成，Windows E2E 待复验**；JSON 结构化日志、请求关联 ID、敏感头和 token 脱敏；NestJS 12.0.2+ 兼容     |
| 本地开发日志阅读     | `pino-pretty`（安装时核对稳定版本）                                  | 仅开发依赖，不用作生产日志引擎                                                                                                       |
| OpenAPI / Swagger    | `@nestjs/swagger` **12.1.1**                                         | **第十四批代码已接入，锁文件已生成，Windows E2E 待复验**；NestJS 12 官方模块。生产环境默认不开放可交互文档，内部接口安全审查后才暴露 |
| 不透明字符串 ID      | `nanoid` **6.0.2**                                                   | 推荐新工程字符串标识、请求关联 ID 等；不能直接代替 `@db.Uuid` 字段                                                                   |
| PostgreSQL UUID      | Node `crypto.randomUUID` 或 Prisma `uuid()`                          | 已有 UUID 数据类型继续保持，不因引入 Nano ID 做破坏性迁移                                                                            |
| API 速率限制         | `@nestjs/throttler` **6.7.1**                                        | 登录/认证端点启用时引入；多实例生产需 Redis 等共享存储，默认内存仅适合单进程                                                         |
| HTTP 安全响应头      | `helmet` **8.3.0**                                                   | 第十四批代码已接入，锁文件已生成，Windows E2E 待复验；按 SPA 与 Swagger 的 CSP 单独配置，不能盲目全局放开                            |
| 输入 Schema          | `zod` **4.6.7**                                                      | 新管理 DTO 可评估；共享 Core 已有解析契约，不重复维护组态 Schema                                                                     |
| Redis                | `redis` **6.3.1**                                                    | 后续统一会话缓存/分布式限流/状态同步；会话撤销权威状态仍以 PostgreSQL 为准                                                           |
| 异步任务与报警处理   | `@nestjs/bullmq` **12.0.1** + BullMQ（安装时验证版本）               | 后续报警、历史导出、延迟任务；不允许异步队列代替工业控制安全联锁                                                                     |
| 观测与指标           | OpenTelemetry SDK、`prom-client`（实施前验证版本）                   | 后续接入追踪、错误率、请求耗时、网关质量和业务健康指标，不记录令牌明文                                                               |

## 不立即采用的候选

NestJS 官方 `@nestjs/authentication`（当前 **0.1.5**）与 `@nestjs/authorization`（当前 **0.1.3**）提供完整的官方能力，但截至本次评估属于初期 `0.x` API。工业 SCADA 先沿用已审核的 `hasProjectPermission`、NestJS Guard 和独立 PostgreSQL 会话模型，后续如有充分测试和迁移收益再专项评估，避免同时维护两套权限策略。也不并行引入 Passport、多个 JWT 包、Winston 或第二套 ORM。

## 安全实施顺序

1. 第十三批：短期不透明会话、状态/撤销校验、工程级 Guard、数据库约束及拒绝测试；**不接入公开登录**。
2. 后续：实际本地账号或 OIDC 身份提供方、登录/登出/MFA、会话凭据轮换、反暴力破解、权限撤销竞态与安全审计。
3. 随正式 API 建设同步引入 Pino 与 Swagger（受控文档）、Helmet、限流，确保敏感信息不入日志且生产文档默认不暴露。
4. 在多实例/报警/历史需求确立后再按需引入 Redis、队列与指标，不为依赖数量而增加复杂度。

### 核对来源

- [NestJS Authentication](https://docs.nestjs.com/security/authentication) / [NestJS Authorization](https://docs.nestjs.com/security/authorization)
- [NestJS Swagger](https://github.com/nestjs/swagger/releases) / [nestjs-pino](https://www.npmjs.com/package/nestjs-pino)
- [jose](https://www.npmjs.com/package/jose) / [openid-client](https://www.npmjs.com/package/openid-client) / [Nano ID](https://www.npmjs.com/package/nanoid)
- [@nestjs/throttler](https://www.npmjs.com/package/@nestjs/throttler) / [helmet](https://www.npmjs.com/package/helmet)

## 第十四批依赖补充

- NestJS 配置注入：`@nestjs/config@12.0.1`（已声明于服务端依赖与 Catalog，pnpm 锁文件已提交）。根目录 `.env` 由 Node `loadEnvFile` 唯一加载，`ConfigModule` 设置 `ignoreEnvFile: true`，不直接增加 `dotenv`。
- 开发日志美化：`pino-pretty@13.2.0`（仅服务端 devDependency）。只在非生产、非测试且 stdout 为 TTY 时启用；其它环境保持 JSON 输出。
- Windows 已安装并提交锁文件，静态检查与 355 项单测通过，Docker 隔离测试通过；E2E 初始化超时。Pretty 测试隔离补丁新增一项单测，预期 356 项，完整 ready 尚待复验。

## 第十六批验收与 Zod 引入边界

2026-11-13，维护者 Windows 验证第十六批 `ready` **367/367 单测、8/8 NestJS E2E、退出码 0**，独立 Docker 服务端隔离构建与烟测 **退出码 0**。该批使用现有 TypeScript 固定枚举和运行时安全白名单，不添加新依赖。

经核对 npm 官方版本列表，`zod@4.6.7` 为当前稳定版本；建议优先用于**未来不可信数据入口**：NestJS HTTP DTO、环境配置、外部设备/网关数据和安全审计事件输入 Schema。现有共享 Core 工程文档已经有解析校验契约，不能建立第二套相互矛盾的 Schema。即便启用 Zod，安全审计仍须从可信字段白名单重新构造输出，**不得直接记录 `safeParse` 失败对象、原始输入或包含令牌的校验上下文**。

第十六批 PR #38 未安装 Zod，也未修改 pnpm Catalog / 锁文件；正式引入时应单独明确消费包、固定版本、由 pnpm 12 正式更新锁文件，并重新执行类型检查、单测、E2E、`ready` 及 Docker 回归。

## 第十七批：Zod 运行时启动配置校验

- npm 官方稳定版 `zod@4.6.7`；只将其作为 `apps/server` 生产依赖加入 Catalog 和 Manifest，不扩展到 Vue/React 或共享 Core。采用 Zod 的 `safeParse` 校验端口与监听地址，保持现有优先级、默认值、Swagger 访问条件和固定中文错误提示。
- 原始输入、`ZodError`、环境密钥和数据库连接串不得被写入诊断日志或安全审计。第十六批固定四字段事件记录不做自动对象序列化替换。
- 当前执行环境无法访问 npm Registry，**第十七批移除 nest-zod 后的锁文件已经由维护者正式重新同步**；Windows 全量质量链与 Docker 冻结安装已实测通过，仍需保持合并授权边界；参见 [ADR-0049](adr/0049-zod-server-runtime-validation.md)。

### 第十七批 NestJS 集成方案复核与实测修订（2026-11-13）

- `nestjs-zod@5.6.0` 的发行包 Peer 仅声明 NestJS 10/11；`nest-zod@2.1.0` 虽在官网文档宣称支持 NestJS 12 / Swagger 12，但其 [发行包元数据](https://github.com/taugr/nest-zod/blob/v2.1.0/package.json) 同样只声明 NestJS 10/11 / Swagger 8/11。因此**不能以官方文档的兼容性表替代实际包约束**。
- 维护者 Windows 实测 `nest-zod/swagger` 的 `ZSerialize` 在测试类加载阶段抛出 `TypeError: Property description must be an object: undefined`；[上游源码](https://github.com/taugr/nest-zod/blob/v2.1.0/src/openapi-schema.ts) 显示 Schema 的 `safeParse` 属性描述符可能为 `undefined`，而恢复逻辑没有防护。
- **最终选择 `NestJS 12 原生 Standard Schema + zod@4.6.7`**。使用官方 `StandardSchemaValidationPipe`、`StandardSchemaSerializerInterceptor` 与 `@Body({ schema })`、`@Query(..., { schema })`，Swagger 12 原生转换 Zod 4.2+ JSON Schema；相关文档见 [官方验证](https://docs.nestjs.com/application/validation)、[序列化](https://docs.nestjs.com/application/serialization) 和 [OpenAPI](https://docs.nestjs.com/openapi/introduction)。
- 移除 `nest-zod` 的 Catalog 和服务端依赖声明，保留 `zod`，不降级 NestJS、不忽略 Peer、不引入第二套工程 Schema。原生校验在本批仅用于隔离测试 Controller，不对正式业务路由全局启用。
- 第十七批首次 Windows `ready`：格式与 Lint/类型检查已通过；单测 **370 通过、1 失败**，另有适配器测试文件导入失败，完整质量链中断。修正代码后，Windows 已复验 **375/375 单测、8/8 E2E**、完整 `ready` **退出码 0**，Docker 隔离镜像烟测 **退出码 0**。
- 上轮包含 `nest-zod` 的锁文件已由维护者使用 pnpm 正式重新生成并推送；新锁文件仅保留 Zod，GitHub 核对无 `nest-zod`。Docker 构建中冻结安装成功，未绕过 Peer 校验，不手写包完整性数据。

## 第十八批：优先选择 HTTP 就绪检查，推迟全局限流

经核对 `@nestjs/terminus@12.1.0` 官方发行包 `package.json` 的 Peer 版本覆盖 NestJS 12、Swagger 12、RxJS 7 和 Node 24，且该版本使用原生 ESM；选为正式 HTTP 就绪探针依赖。仅在 `apps/server` 生产依赖及根 Catalog 声明，不引入旧 `@godaddy/terminus`、数据库健康探针的新连接或额外日志引擎。

与之相比，`@nestjs/throttler@6.7.1` 虽然已核对 Peer 支持 NestJS 12，但当前正式服务没有已开放的登录、会话签发、工程版本或工业设备控制 API。此时全局启用进程内限流无法实现生产反暴力破解，反而可能误伤 `/health`、`/health/ready` 容器探针。**暂不安装 Throttler**，待正式身份/API 实施时再做分路由限流、受信代理 IP 解析及 Redis 共享计数器审查。

当前 `GET /health/ready` 只证明 HTTP 应用初始化并接受请求，响应明确 `dependencies: "not_checked"`，不能替代真正的 PostgreSQL、Redis、工业网关与 Tag 数据质量健康。正式数据库/网关接入后再扩展 Readiness 指标及超时策略。以上见 [ADR-0050](adr/0050-http-readiness-terminus.md)。

第十八批维护者已在 Windows 通过 pnpm 正式更新并提交 `pnpm-lock.yaml`，远程 GitHub 核对确认包含 `@nestjs/terminus@12.1.0`；完整 `ready` **378/378 单测、10/10 E2E、退出码 0**，Docker 隔离构建内冻结安装与健康探针烟测 **退出码 0**。E2E 中预期 503 对应模拟关闭状态，并非非预期故障。当前 HTTP 就绪仍不代表 PostgreSQL、Redis 或工业网关就绪。记录性文档更新后建议复查 `vp check` 与 `pnpm run docs:check`。

## 第十九批：原生 HTTP 安全能力，无新依赖

经核对本仓库 NestJS 12.0.3 Express Adapter 的 `return503OnClosing` 选项和 Node 24 HTTP Server 的资源配置 API，本批直接使用现有 `@nestjs/core`、`@nestjs/platform-express` 与 Node `http`；不引入请求超时拦截器、第三方 Graceful Shutdown 包、`@nestjs/throttler`、Redis 或新 HTTP 客户端。原因是当前正式业务入口仅包括 HTTP 健康探针，增加外部依赖并不能替代部署阶段的真实连接排空或流量管理。

通过 [ADR-0051](adr/0051-http-ingress-shutdown-policy.md) 约束：`headersTimeout=15s`、`requestTimeout=60s`、`keepAliveTimeout=5s`、请求头最多 100 个、单 Socket 最多 1000 个请求；这些数值在大文件上传、受信代理链路或高频订阅实现后需要重新压测。**不设置全局响应超时**，以免破坏规划中的 SSE。无第三方依赖/锁文件改动，仍须 Windows `ready` + Docker 隔离烟测验收。

## 第三十三批：OIDC Relying Party 客户端（已选型，待加入依赖）

选择 openid-client 6.8.9 作为服务端 OIDC Relying Party 库。官方 API 覆盖 Authorization Server Metadata Discovery、Authorization Code Grant、PKCE S256、State、Nonce、ID Token 验证及 Issuer Identification；当前 Node.js 最低要求低于仓库 Node >=22.18.0，ESM 与 TypeScript 声明符合现有服务端结构。

不额外引入 Passport、独立 jose JWT 验证流程或第二套身份会话框架；继续复用仓库已有 AuthSessionService、ScadaSessionGuard、ScadaProjectGuard 和 PrismaProjectVersionStore。当前分支仅记录选型，尚未将 openid-client 写入 Catalog/Server manifest，也未生成锁文件。正式加入依赖时必须由 pnpm 更新 pnpm-lock.yaml 并通过 frozen-lockfile 安装检查。

参考：[openid-client 官方仓库与 API](https://github.com/panva/openid-client)、[RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html)、[OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)。
