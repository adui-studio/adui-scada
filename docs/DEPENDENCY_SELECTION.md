# ADui SCADA · 服务端依赖推荐清单

> 评估日期：2026-11-13。此文包含阶段化技术选型与第十四批**待安装**依赖声明，不是所有包均已安装。现有真实版本以根 `pnpm-workspace.yaml` 和 `pnpm-lock.yaml` 为准。新增依赖统一维护 pnpm Catalog 和锁文件，先验证 NestJS 12 / Node 24 / TypeScript 6 / Vite+ 兼容，再在独立 PR 引入；不擅自升级 Prisma、TDesign 或底层工具链。

| 领域                 | 优选依赖 / 版本                                                      | 状态与使用时机                                                                                                                  |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ORM 与数据库驱动     | `@prisma/client`、`@prisma/adapter-pg`、`pg`（已锁定 Prisma 7.10.1） | 已采用；继续统一 PostgreSQL 事务和工程权限数据源                                                                                |
| 短期可撤销服务端会话 | Node `crypto.randomBytes` + `createHash` + Prisma                    | **第十三批采用**；高熵不透明 Bearer，只保存 SHA-256 摘要，暂不暴露登录/签发 HTTP 路由                                           |
| JWT / JWKS 安全验证  | `jose` **6.2.17**                                                    | **建议后续引入**；当可信 IdP/JWT 场景确定后固定 `iss`、`aud`、`alg`、`exp`，避免自行实现 JWT 解析和签名                         |
| OIDC / 企业 SSO      | `openid-client` **6.8.9**                                            | 建议在企业身份联邦/统一登录阶段引入；必须采用授权码 + PKCE、状态/nonce、防重放与固定受信提供方                                  |
| 本地账号密码         | `argon2` **0.45.2**                                                  | 仅当正式实现本地账户时引入，使用 Argon2id 并规划成本校准、MFA 与凭据重置                                                        |
| 结构化日志           | `nestjs-pino` **5.3.1** + `pino` **10.4.0** + `pino-http` **11.0.0** | **第十四批代码已接入，锁文件待生成与 Windows 实测**；JSON 结构化日志、请求关联 ID、敏感头和 token 脱敏；NestJS 12.0.2+ 兼容     |
| 本地开发日志阅读     | `pino-pretty`（安装时核对稳定版本）                                  | 仅开发依赖，不用作生产日志引擎                                                                                                  |
| OpenAPI / Swagger    | `@nestjs/swagger` **12.1.1**                                         | **第十四批代码已接入，锁文件待生成与 Windows 实测**；NestJS 12 官方模块。生产环境默认不开放可交互文档，内部接口安全审查后才暴露 |
| 不透明字符串 ID      | `nanoid` **6.0.2**                                                   | 推荐新工程字符串标识、请求关联 ID 等；不能直接代替 `@db.Uuid` 字段                                                              |
| PostgreSQL UUID      | Node `crypto.randomUUID` 或 Prisma `uuid()`                          | 已有 UUID 数据类型继续保持，不因引入 Nano ID 做破坏性迁移                                                                       |
| API 速率限制         | `@nestjs/throttler` **6.7.1**                                        | 登录/认证端点启用时引入；多实例生产需 Redis 等共享存储，默认内存仅适合单进程                                                    |
| HTTP 安全响应头      | `helmet` **8.3.0**                                                   | 第十四批代码已接入，锁文件待生成与 Windows 实测；按 SPA 与 Swagger 的 CSP 单独配置，不能盲目全局放开                            |
| 输入 Schema          | `zod` **4.6.7**                                                      | 新管理 DTO 可评估；共享 Core 已有解析契约，不重复维护组态 Schema                                                                |
| Redis                | `redis` **6.3.1**                                                    | 后续统一会话缓存/分布式限流/状态同步；会话撤销权威状态仍以 PostgreSQL 为准                                                      |
| 异步任务与报警处理   | `@nestjs/bullmq` **12.0.1** + BullMQ（安装时验证版本）               | 后续报警、历史导出、延迟任务；不允许异步队列代替工业控制安全联锁                                                                |
| 观测与指标           | OpenTelemetry SDK、`prom-client`（实施前验证版本）                   | 后续接入追踪、错误率、请求耗时、网关质量和业务健康指标，不记录令牌明文                                                          |

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

- NestJS 配置注入：`@nestjs/config@12.0.1`（已声明于服务端依赖与 Catalog，待 pnpm 安装及锁文件验证）。根目录 `.env` 由 Node `loadEnvFile` 唯一加载，`ConfigModule` 设置 `ignoreEnvFile: true`，不直接增加 `dotenv`。
- 开发日志美化：`pino-pretty@13.2.0`（仅服务端 devDependency）。只在非生产且 stdout 为 TTY 时启用；其它环境保持 JSON 输出。
- 以上尚未在 Windows 验证，版本解析、锁文件和全量测试仍是合并前阻塞项。
