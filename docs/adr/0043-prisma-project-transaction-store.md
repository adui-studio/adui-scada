# ADR-0043：PrismaService 与受控工程版本事务仓储

- 状态：Proposed
- 日期：2026-11-12
- 关联需求：FR-002、FR-008、FR-014、NFR-004、NFR-006
- 依赖：[ADR-0040](0040-server-project-contract.md)、[ADR-0041](0041-project-persistence-access-model.md)、[ADR-0042](0042-postgresql-prisma-foundation.md)

## 已选择的依赖与边界

维护者同意优先使用最适合项目的依赖，经核对 Prisma 7 官方生成客户端、Interactive Transactions 与 PostgreSQL Adapter 文档，本批**不增加第三方包**，直接复用已经锁定的 Prisma ORM 7.10.1、`@prisma/adapter-pg`、`pg`、NestJS 12 和 Vitest 5。NestJS 新增 `@adui/scada-core` 工作区依赖以复用文档校验及 SHA-256 快照，不复制 Core 算法，不引入另一套 ORM。

`PrismaService` 构建单个 `PrismaClient({ adapter: new PrismaPg({connectionString}) })`，实现 NestJS `OnModuleInit` / `OnModuleDestroy`；连接字符串只来自受控服务端环境，不在错误或日志中回显。`ProjectPersistenceModule` 将 PrismaService 与仓储注册为模块单例，但**不会导入 `AppModule`**；`GET /health`、Vue/React 和工业只读 Runtime 完全不受数据库可用性影响。Prisma 7 生成的客户端仍由 Git 忽略，仓库质量链和独立服务端构建必须先生成它。

## 写入事务与授权

`PrismaProjectVersionStore.append(principal,projectId,input)` 要求 `principal` 必须由后续可信认证层构造（当前无 Guard，不允许由客户端直接调用）。先拒绝空主体与非法工程 ID 并使用 Core 的 `parseServerProjectSaveRequest` 拒绝额外客户端权限字段、旧 Schema 与超限请求，随后进入 Prisma Interactive Transaction：

1. 通过**参数化 `$queryRaw`** 对 `scada_projects (tenant_id,project_id)` 查询并 `FOR UPDATE`；未知工程与无权限工程使用同一拒绝错误，不在对外响应中暴露工程存在性。
2. 锁内从 `scada_project_grants` 读取显式权限并执行现有 `hasProjectPermission`，拒绝无授权、跨租户与未知权限。未来授权撤销必须同样首先锁住工程行，使用相同锁顺序。
3. `expectedRevision:null` 仅对应已存在工程的数据库 head 为 0；其他情况与数据库 `BIGINT` head 严格比较，拒绝过期版本与超安全整数。客户端不能指定真实修订号、时间、摘要或审计人。
4. 由共享 Core 的 `createProjectSnapshot` 生成不可变 SHA-256 快照；事务内新增 `scada_project_versions`、推进 `scada_projects.head_revision`、新增 `scada_project_audit`。三项写入同事务提交或失败回滚；禁止在事务外另行提交审计。
5. Prisma 事务支持等待与执行超时，调用方需要处理超时、连接故障、冲突错误，不能自动忽略失败或重新提交同一过期版本。当前尚无失败尝试的独立安全审计通道。

读取 `read` 在工程 `FOR SHARE` 锁下复核 `version:read`，按复合键取历史版本，调用 Core `readProjectSnapshot` 验证 JSONB 快照摘要，并与表列的工程 ID、修订号、内容摘要和时间交叉比较。只有已授权但找不到历史修订号时才返回独立的版本不存在错误；其他未知工程和无授权统一拒绝。正式 HTTP 结果映射、审计日志脱敏及对外速率限制仍待设计。

## 两级验收与局限

- **普通单测**：14 项无数据库的仓储模拟测试，覆盖输入拒绝、授权、CAS、顺序、审计异常传播、快照读取与篡改拒绝。模拟事务不能证明 PostgreSQL 真实回滚与锁行为。
- **可选真实数据库测试**：5 项，在隔离的本机 `adui_scada_test` 库运行；要求显式提供 `SCADA_TEST_DATABASE_URL`，并在连接前检查回环地址和库名。测试随机租户建立工程与授权，只清理自建测试租户；验证首次持久化、并发双写、跨租户拒绝、授权读取与篡改检测。执行前须手动在测试库应用迁移。
- **尚未实测的能力**：隔离数据库审计失败强制回滚、授权撤销竞态、性能压力、数据库备份恢复、生产 RLS/角色隔离、连接池上限与异常重试策略。前述能力不能从单测或代码逻辑推断为已验收。

## 不实施

不修改数据库已有迁移，不新增后端 HTTP Controller，不注册可信认证之前的写入入口，不打开跨域或工业设备写入，不自动部署，不修改 `main`。PR 需维护者 Windows 完整 `pnpm run ready` 与隔离 PostgreSQL 真实测试完成并授权后方可合并。

运行镜像层目前不会导入持久化模块，但一旦服务端引用共享 Core，必须确保 Docker 最终阶段存在工作区 `packages/core` 的包清单及 TypeScript 源码；本批在 `Dockerfile.server` 增加对应 COPY，依赖 Node 24 对受控工作区 TypeScript 的加载能力。生产 Docker 构建与启动仍需维护者实测。
