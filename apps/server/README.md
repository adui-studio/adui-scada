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
# 默认使用 127.0.0.1:5432 / adui_scada；填写本地强密码和完整 SCADA_DATABASE_URL。
# Prisma 不会自动把 SCADA_DB_PASSWORD 拼进 URL，必须保持两个配置一致。
pnpm run db:dev:up
pnpm run db:migrate:deploy
pnpm run db:migrate:status

# 仅停止容器，保留开发数据卷
pnpm run db:dev:down
```

首次迁移文件由本批按 Prisma 模型手工编写，包含额外的 PostgreSQL CHECK 约束，必须使用隔离开发库核对实际 DDL；未通过真实迁移与回滚设计审查前不能用于生产。**严禁使用 `prisma migrate reset`、`db push --force-reset` 或 `db push --accept-data-loss` 清理现有数据库。**
