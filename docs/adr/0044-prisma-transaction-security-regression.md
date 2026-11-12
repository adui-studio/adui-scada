# ADR-0044：工程事务失败回滚、授权撤销竞态与 Docker 安全回归

- 状态：Proposed
- 日期：2026-11-12
- 关联需求：FR-002、FR-008、FR-014、NFR-004、NFR-006
- 依据：[ADR-0041](0041-project-persistence-access-model.md)、[ADR-0042](0042-postgresql-prisma-foundation.md)、[ADR-0043](0043-prisma-project-transaction-store.md)

## 背景与约束

第十一批已验证 PostgreSQL 17 真实版本快照保存、修订号 CAS、跨租户拒绝、内容哈希以及数据库中文注释，尚缺真实**审计失败后的整体回滚**、**权限撤销与版本保存竞态**、数据库连接故障处理与 Docker 最终镜像加载/路由安全验收。工业安全要求继续保持 AppModule 仅注册健康接口，不开放工程 REST API、工业设备写入或前端直连 PLC。所有测试只对独立本机 `adui_scada_test` 使用随机租户，不修改生产或开发业务数据。

## 决策

1. **真实回滚验证**：在现有 PostgreSQL 隔离测试库中，为单项测试构建 Prisma 查询扩展，将 `scadaProjectAudit.create` 的审计 `action` 改为不允许的值。由 PostgreSQL 原有 CHECK 约束拒绝该实际 SQL INSERT。此前在同一个 `$transaction` 中写入的版本和更新的工程 head 必须回滚，审计行数也为零；再使用同一预期修订号正常保存应成功。扩展仅在测试中创建，不影响生产 PrismaService/PrismaProjectVersionStore，不新增数据库触发器或迁移。
2. **权限撤销竞态**：测试管理侧事务先对目标 `scada_projects` 取得 `FOR UPDATE` 工程行锁，在锁内删除 `version:append` 授权，再释放锁；竞争的版本追加必须在取得工程锁后重新加载 ACL 并拒绝。管理侧事务仅在测试中模拟，未来正式授权管理服务必须遵循此**先锁工程行、后改授权**的锁顺序。无可信身份认证和 Guard 之前，不提供授权管理 HTTP 路由。
3. **连接异常**：常规单测覆盖缺少 `SCADA_DATABASE_URL` 时拒绝实例化，隔离数据库测试覆盖本机不可达端口，查询必须失败且可以调用 `$disconnect` 释放资源。真实断网和自动重试策略仍不实现，避免将非幂等写入静默重试。
4. **Docker 隔离烟测**：保持现有 Dockerfile.server 正式 CMD，另外复制一份固定、非动态求值的本机烟测脚本。宿主命令显式 `docker build` 并使用 `docker run --rm --network none`，不暴露宿主端口；容器内部加载编译的 Prisma 仓储与共享 Core，临时监听回环端口，检查健康响应以及两个未开放 API 继续返回 404，随后释放 NestJS 应用资源。依赖已有 `.dockerignore` 排除 `.env`、私钥和本地环境文件。
5. 不新增 npm 依赖、数据库表/字段、Prisma 迁移或 schema 注释；因此不触发数据库模型注释变更。使用仓库已有 PostgreSQL、Prisma、NestJS、Vitest、Docker 和 Node 内置模块。

## 验收与剩余边界

`pnpm run ready` 预计 340 项单测、4 项 NestJS E2E，`pnpm run test:db` 预计 9 项仅限隔离 PostgreSQL 测试，`pnpm run test:docker:server` 为单独运行的本机容器验收。**所有新结果尚待维护者在 Windows 实测，不以代码提交代替通过证明。**

测试侧权限撤销仅覆盖一个可控的锁顺序场景，不验证未来认证层、Guard、真实管理 API、连接中断期间精确故障恢复、不同隔离级别压力、生产 RLS、持久审计失败尝试、PostgreSQL 灾备或工业现场写入。下一阶段若接入授权管理服务，必须追加更全面双向竞态与身份验收。
