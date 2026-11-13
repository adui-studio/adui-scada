# ADR-0046：Pino 结构化日志、受控 Swagger 与 HTTP 安全响应头

- 状态：Proposed
- 日期：2026-11-13
- 关联：NFR-003、NFR-006、NFR-007、FR-001、FR-014
- 前置：[ADR-0043](0043-prisma-project-transaction-store.md)、[ADR-0045](0045-trusted-session-and-project-guard.md)

## 背景

第十三批已建立可信会话与工程级 Guard 的**内部模块**，但正式 AppModule 仍只有 `GET /health`，没有受信身份提供方、对外登录、授权管理或设备控制 API。下一阶段需要为正式 HTTP 入口补齐请求可观察性、敏感字段脱敏、安全响应头和受控 API 契约。在工业 SCADA 场景，日志本身不得成为泄露凭据或将来写入操作载荷的旁路。

仓库当前正式使用 NestJS 12.0.3、Node 24、TypeScript 6.0.3、Prisma 7.10.1 和 pnpm Catalog；不能未经验证改用多个日志库、旧 Nest Swagger 或额外一套 ORM。

## 选型与依赖

- `nestjs-pino@5.3.1` + `pino@10.4.0` + `pino-http@11.0.0`：为 NestJS 12 提供结构化日志与 AsyncLocalStorage 请求关联。v5 支持 NestJS 12.0.2+、Pino 10、pino-http 11；不另外引入 Winston。
- `@nestjs/swagger@12.1.1`：NestJS 12 对应的官方 ESM OpenAPI 实现，不引入旧 v11；只用于健康接口文档，未来业务契约仍须单独审查。
- `helmet@8.3.0`：现有 Express HTTP 入口的安全响应头，不能替代 TLS、身份认证、CORS、RBAC 或工业网络隔离。

这些包只在服务端 `apps/server/package.json` 声明，根 Catalog 固定版本；新增依赖须由 pnpm 12 自动生成锁文件，不能人工复制包的 integrity 或绕过 frozen-lockfile。

## 日志安全边界

1. `AppModule` 引入且只引入一次 `LoggerModule.forRoot`；NestFactory 接入 `nestjs-pino` Logger，并在 bootstrap 阶段缓存 Nest 启动日志。
2. HTTP 日志由服务端 `randomUUID()` 生成关联 ID，响应中只暴露 `x-request-id`，不接受客户端声称的任意关联 ID。
3. 默认日志等级 `info`，等级由 `SCADA_LOG_LEVEL` 白名单限制。日志请求只保留 ID 与方法，响应只保留状态码；**不记录 URL、查询字符串、Header、请求体或 Token**。Pino redact 为后续记录对象中的常见凭据字段提供第二道保护。
4. 应用启动失败时不打印完整数据库连接串、环境变量或原始异常堆栈，防止日志采集平台成为密码泄露源。实际错误原因另由受控本机诊断渠道分析。
5. 目前上述日志是运维可观察性记录，**不是防篡改的身份、工程或工业操作审计**。正式安全审计需独立定义保留期、权限、结果、可信主体和防篡改机制，不允许凭 Pino 日志宣称 FR-014 已满足。

## Swagger 与 HTTP 安全策略

1. `SCADA_API_DOCS_ENABLED` 缺省为 `false`。只有严格值 `true`、非 `NODE_ENV=production` 且服务端绑定 `127.0.0.1` 时，才加载 `@nestjs/swagger` 并注册 `/api/docs` 与 `/api/docs-json`。
2. 正式部署和任何 `0.0.0.0` 监听即使错误启用开关，也不会创建文档路由；本机端口转发/代理另需网络层防护，本代码不能保证外部代理不可转发。
3. 生产默认启用 Helmet 全部安全头。为使本机 Swagger UI 的脚本能够运行，仅在允许开发文档时关闭 CSP，不能将这一宽松配置复制到生产或 SCADA 浏览器应用。
4. OpenAPI 当前只描述已有 `GET /health`，不伪造尚未实现的登录、会话签发、工程写入或设备写入 API。
5. 新增测试验证文档默认 404、非法生产/非回环配置拒绝、开发文档仅包含健康接口、Helmet 安全头与关联 ID。原有版本、身份及工业设备写入禁用测试仍须通过。

## 实施状态与验收约束

分支代码与 Catalog/Manifest 已准备，但本协作环境无法访问 npm Registry，**目前尚未由 pnpm 更新 `pnpm-lock.yaml`**。这属于明确的交付阻塞，而不是可以忽略的差异。

维护者应在 Windows 上先运行 `pnpm install`、检查并提交 pnpm 12 生成的锁文件，再执行 `pnpm install --frozen-lockfile`、`pnpm run ready`、`pnpm run test:docker:server`。预计普通单测 355、NestJS E2E 8、原隔离 PostgreSQL 11；数字均为新增后预期，未经运行不能宣称通过。PR 在锁文件和验收记录齐全前保持 Draft 且禁止合并。

## 未来工作

真实账号/OIDC 认证、授权和会话持久化审计、统一异常契约、权限撤销并发竞态、生产 TLS 与 HTTP 限流、日志存储与生命周期、OpenAPI 文档授权策略以及工业设备控制边界，均属于后续独立任务，不应因本批引入 Swagger 或 Logger 而提前开放。
