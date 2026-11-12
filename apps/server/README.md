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
