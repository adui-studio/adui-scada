# ADR-0042：PostgreSQL + Prisma ORM 7 数据库基础设施

- 状态：Proposed
- 日期：2026-11-12
- 关联需求：FR-001、FR-002、FR-008、FR-013、FR-014、NFR-004、NFR-006
- 依赖：[ADR-0040](0040-server-project-contract.md)、[ADR-0041](0041-project-persistence-access-model.md)

## 决策

维护者确认使用独立 PostgreSQL + Prisma ORM。经核对 2026-11-12 Prisma 官方发布状态，Prisma 8 CLI 的 npm `latest` 仍指向 RC，不适合现阶段工业软件稳定基线；因此明确锁定 Prisma ORM **7.10.1**，并统一 `prisma`、`@prisma/client` 和 `@prisma/adapter-pg` 的版本。不是接入 Prisma Postgres 云服务。Node、pnpm、TypeScript 和 NestJS 继续按仓库既有配置，不因数据库选型改动工具链版本。

1. Prisma Schema 与初始迁移归属于 `apps/server/prisma/`；CLI 配置在 `apps/server/prisma.config.ts`，只读仓库根 `.env` 的 `SCADA_DATABASE_URL`。没有数据库 URL 时允许纯 Schema 校验和客户端生成，迁移必须提供实际 URL。
2. 复用 ADR-0041 的租户/工程复合键四模型：工程、逐项权限授权、只追加版本快照、成功提交审计。版本采用 PG BIGINT，快照采用 JSONB；额外 SQL CHECK 保证修订号安全范围、摘要格式、权限枚举和审计动作取值。将来增加授权、版本写入和成功审计必须在同一事务内完成 CAS 与一致性校验。
3. Prisma 7 客户端生成于服务端 `src/generated/prisma`，作为可再生成产物被 Git 忽略；共享 Core 和 Vue/React 不引入任何 Prisma 依赖。下一批才实现单实例 PrismaService、权限 Guard 与仓储适配，当前 NestJS 只公开 `GET /health`。
4. 本地 PostgreSQL 可独立使用 `deploy/docker/compose.postgres.dev.yaml` 启动，端口仅映射到 127.0.0.1，仓库根 `.env.example` 中提供公开的本地开发用户名、测试口令和配套 Prisma URL；维护者须复制为受忽略的 `.env` 并在正式部署前全部替换。Compose 使用独立命名卷，`down` 不自动清理历史数据。
5. 首次迁移文件是依据 Prisma Schema 和额外业务 CHECK **手工编写**，没有在实际数据库上执行。必须通过隔离开发库应用迁移、核对完整约束及 Prisma 漂移，在验证前不能当作已验收生产 DDL，更不能自动运行破坏性重置。

## 风险与后续

- 数据库 URL、用户权限、SSL/TLS、网络策略、连接池、超时、备份恢复、生产迁移授权、数据保留及审计失败封闭机制仍需独立确定。**真实数据库凭据**不能进入仓库或任何 `VITE_*` 环境变量；`.env.example` 中的公开开发测试密码不具备保密性，绝不可复用为生产凭据。
- Prisma 7 运行时将使用 `@prisma/adapter-pg`；**本批没有实例化 PrismaClient，也不建立连接池**。之后需设计 NestJS 单例生命周期并显式关闭连接。
- `BIGINT` 超出 JS 安全整数范围必须拒绝或经受控序列化，不能无损假定为 number；现有 Core 快照的 CAS 范围由业务验证保证。
- 当前 `pnpm-lock.yaml` 在仓库环境未能重新生成，维护者首次拉取分支后需要 `pnpm install` 生成并提交新的锁文件；在此之前 Docker `--frozen-lockfile` 也不会通过，不得宣称可复现构建。
- 当前仅提供模型和迁移，不提供工程 REST API、身份认证、发布指针、工业 Gateway 或设备写入。

## 技能审查

已读取 `prisma-orm-setup`、`prisma-cli`、`postgresql-table-design`、`nestjs-best-practices` 和 `pnpm` 的适用要求。仓库还包含 Prisma Postgres 云服务、Compute 与升级兼容技能，它们并非本期自建 PostgreSQL 必需，但没有证据证明已无人依赖，本批不做破坏性批量删除。Skills 索引同步更新，后续可在确认无引用和许可边界后再单独清理。

## 验收

维护者在 Windows 完成 `pnpm install` 与锁文件提交后，执行 `pnpm run db:validate`、`pnpm run db:generate` 和 `pnpm run ready`；然后针对隔离 PostgreSQL 执行 `pnpm run db:dev:up`、`pnpm run db:migrate:deploy`、`pnpm run db:migrate:status` 并检查关键 CHECK/外键。未实际运行前只标记待验收。
