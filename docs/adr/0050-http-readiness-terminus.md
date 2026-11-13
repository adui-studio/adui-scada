# ADR-0050：区分 HTTP 存活与就绪探针，按需采用 Terminus

- 状态：Proposed
- 日期：2026-11-13
- 关联：NFR-003、NFR-006、NFR-007、NFR-008
- 前置：[ADR-0046](0046-pino-openapi-http-security.md)、[ADR-0047](0047-server-configuration-startup.md)、[ADR-0049](0049-zod-server-runtime-validation.md)

## 背景

正式 `AppModule` 当前只挂载公开的 `GET /health`，该接口语义始终是进程存活，不代表 PostgreSQL、工业网关或设备状态健康。虽然独立仓储、会话与工程 Guard 已具备测试基础，它们**尚未挂载正式业务路由**，正式运行时不应为了健康检查提前连接数据库或 PLC/DCS。

候选方案包括手写 HTTP 就绪状态、`@nestjs/terminus` 健康检查框架，以及全局 `@nestjs/throttler`。当前尚未开放登录或业务 API，全局限流可能误伤容器探针，而独立 HTTP 就绪语义更符合现阶段运维需求。

经核对 `@nestjs/terminus@12.1.0` 发行标签 `package.json`，其 Peer 范围包含 NestJS 12、Swagger 12、RxJS 7，并要求 Node.js 20.19+/22.12+/24+；与仓库当前 NestJS 12.0.3、Swagger 12.1.1、Node 24.22.2 兼容。该发行版为原生 ESM，不依赖旧版 `@godaddy/terminus`。

## 决策

1. 保持现有 `GET /health` 返回 `{ "status": "ok", "service": "adui-scada-server" }`，不添加数据库访问、网络请求或流量限制。
2. 在根 pnpm Catalog 与 `apps/server` 声明 `@nestjs/terminus@12.1.0`。仅为正式 `AppModule` 注册 `TerminusModule`、`HttpReadinessController` 和 `HttpReadinessIndicator`。
3. 新增 `GET /health/ready`，只表示 **NestJS HTTP 服务已完成应用初始化、尚未进入关闭流程**。指示器在 `onApplicationBootstrap` 转为就绪，`beforeApplicationShutdown` 时撤销就绪。使用 `HealthCheckService.check` 产生标准状态与 HTTP 503，不手写错误返回。
4. 结果只包含固定状态、`scope: "http"`、`dependencies: "not_checked"`；不报告真实数据库连接串、工业地址、凭据、组件列表或设备 Tag。健康探针响应必须禁止缓存，以免代理缓存过期的成功状态。
5. `@HealthCheck({ noCache: true, swaggerDocumentation: false })` 仅提供运行时语义，Swagger 说明单独采用已有中文装饰器，确保调试文档仍只在显式启用且本机回环的非生产环境可见。
6. 不通过 `PrismaHealthIndicator` 或其它检查器在当前正式 AppModule 挂载尚未正式交付的数据库/网关能力；未来需要定义真正的全业务服务就绪时，在单独 ADR 中新增真实依赖、明确失败策略、超时/缓存与生产授权。
7. 暂不引入 `@nestjs/throttler`：等正式登录或受保护 API 上线前再为这些路由增加分级限流。不得对存活与就绪探针全局执行普通用户 API 配额；多实例需要 Redis 等共享存储和可信代理地址规范，不能只用进程内计数器冒充全局防护。

## 不变边界

- 不修改 `apps/server/src/main.ts` 根 `.env` 加载顺序、Swagger/Pino/Helmet 规则。
- 不引入数据库迁移、Redis、工业网关实例或 HTTP 业务路由；会话与 ACL Guard 未挂载。
- 不修改 Vue/React、共享 Core、工程 Schema、Tag 实时值或状态质量标准。
- `/health/ready` 返回 200 **不表示 PostgreSQL、Redis、网关、PLC、报警与 SCADA 业务链路就绪**；严禁将 HTTP 子系统就绪作为设备可控或可写入依据。

## 测试与交付

新增 3 项指示器单测，涵盖启动前失败、应用初始化成功、关闭流程撤销；现有 NestJS E2E 增加 2 项分别测试 200/不缓存和关闭时 503，原 `/health` 仍为 200。Swagger 本机开发文档应该描述新探针。Docker 隔离烟测增加 HTTP 就绪检查，不依赖生产数据库，也不映射宿主机端口。

第十七批 Windows 基线为 **375/375 单测、8/8 E2E**，完整 `ready` 和 Docker 隔离烟测均退出码 0。第十八批预计 **378 项单测、10 项 E2E**，仅为待验证预期。

**本批增加生产依赖**：GitHub 侧无法在维护者 Windows 环境执行 pnpm 冻结安装；合并前必须通过 pnpm 12 正式重算 `pnpm-lock.yaml`，审查提交，再执行 `pnpm install --frozen-lockfile`、`vp check`、`pnpm run ready`、`pnpm run test:docker:server`。未实际运行不能宣称通过。未经维护者明确授权，不合并 main，不部署，不开放工业设备写入。
