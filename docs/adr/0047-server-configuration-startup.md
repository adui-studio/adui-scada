# ADR-0047：NestJS 启动配置加载顺序与安全边界

- 状态：Proposed
- 日期：2026-11-13
- 关联：NFR-003、NFR-007
- 前置：[ADR-0010](0010-root-env-lf.md)、[ADR-0046](0046-pino-openapi-http-security.md)

## 背景与问题

V0.3 第十四批引入 Pino 日志后，`AppModule` 的 `LoggerModule.forRoot({ pinoHttp: createHttpLoggingOptions() })` 会在模块求值阶段读取 `process.env.SCADA_LOG_LEVEL`。此前 `main.ts` 静态导入 `AppModule`，而根目录 `.env` 的 Node.js `loadEnvFile` 在该导入链完成后才执行。因而从根 `.env` 配置的日志等级可能无法在 Logger 初始化时生效。

## 决策

1. 继续只使用仓库根目录 `.env` 作为本地环境文件，不增加 `dotenv`、新模块依赖或第二套配置来源。Docker 仍通过进程环境变量提供运行参数；保持 `ConfigModule.forRoot({ ignoreEnvFile: true })`。
2. `main.ts` 首先通过 Node.js `loadEnvFile` 加载存在的根 `.env`；启动函数随后解析参数，**最后才动态导入 `AppModule`**，确保 Pino/NestJS 模块初始化能读取已经生效的配置。不得再次引入 `AppModule` 的静态值导入。
3. 新增 `resolveServerStartupConfig(env)` 纯函数，统一校验端口和监听主机，并复用 `allowLocalOpenApi` 的原有三重文档开关策略。不改变现有配置优先级：`SCADA_SERVER_PORT` 高于 `PORT`，`SCADA_SERVER_HOST` 高于 `HOST`；未配置时默认 3001、127.0.0.1。
4. 无效端口或非白名单监听地址拒绝启动；错误提示只包含配置键及规则，不回显参数原值。文档只有显式 `true`、非生产、回环地址同时满足才注册；`0.0.0.0` 永远不启用 Swagger。
5. `scripts/check-env-config.mjs` 静态校验环境加载与动态导入次序。纯配置测试覆盖默认、覆盖优先级、非法端口、非法主机和 Swagger 禁止策略。

## 保持不变的安全边界

- `GET /health` 仅反映进程存活，不引入数据库连接、网关访问或设备操作。
- `ScadaIdentityModule` 和 `ProjectPersistenceModule` 继续不挂载正式 `AppModule`，不提供登录、会话签发、工程版本读写或工业设备写入接口。
- 不变更 PostgreSQL/Prisma 模型与迁移，不影响 Vue/React 或共享 Core，不新增 npm 依赖及锁文件变更。
- Pino 的字段白名单和敏感信息脱敏，以及生产 JSON/本机开发 Pretty 分流继续保持第十四批策略。

## 验收

基线为第十四批 Windows `ready` 实测：356 项单测、8 项 NestJS E2E、完整质量链退出码 0。本批额外增加 5 项无数据库单测，维护者已在 Windows 实测普通单测 **361/361**、E2E **8/8**、完整 `ready` **退出码 0**。

维护者 Windows 验证已覆盖 `env:check`、`vp check`、`ready` 及 Docker 隔离镜像构建和烟测，退出码均为 0；`vp check` 无警告/错误，Docker 中健康接口正常，工程及工业设备写入接口仍未开放。本批没有单独执行 `test:db`，亦没有提供通过实际启动日志对 `SCADA_LOG_LEVEL=debug` 进行端到端确认的记录；加载顺序由代码及 `env:check` 约束。记录性文档变更后仍建议执行 `vp check`、`pnpm run docs:check`；PR 保持 Draft，待维护者明确授权后才可合并。

## 后续演进

目前的配置抽取只覆盖正式服务启动边界；`@nestjs/config` 的统一类型化注入、完整配置 Schema、生产部署安全审计、OIDC/账号认证等仍属后续任务，不将本批视为已经交付。
