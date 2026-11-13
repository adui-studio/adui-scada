# ADR-0053：将共享水处理模拟 Tag 以受控本机只读接口接入 NestJS

- 状态：Proposed
- 日期：2026-11-13
- 关联：FR-002、FR-004、FR-006、FR-007、FR-009、NFR-001、NFR-002、NFR-003
- 前置：[ADR-0046](0046-pino-openapi-http-security.md)、[ADR-0050](0050-http-readiness-terminus.md)、[ADR-0052](0052-linux-sigterm-container-shutdown.md)

## 背景与选择

Vue/React 的 `DemoRuntime` 已通过 `/demo/project` 和 `/demo/events` 消费独立水处理模拟服务；两端共享 `ScadaDocument`、`TagStore`、`WaterTreatmentSimulator`、`snapshot/delta` 与 `GOOD/STALE` 质量协议。但是正式 NestJS 仅暴露存活与 HTTP 就绪接口，工程版本仓储及身份 Guard 尚未挂入正式 `AppModule`。此时直接开放工程版本或设备 API 会越过尚未实现的服务端认证与租户权限边界。

本批选择**仅本机、显式开启、非生产、只读的模拟 Tag 诊断接口**，便于在 NestJS Swagger 中直接查看共享工程、Tag 快照和 SSE 事件，验证由模拟数据到后端应用的协议复用。此接口不是正式工程/设备业务 API，也不是新的驱动或工业网关。

## 决策

1. 不新增 npm 依赖；使用已有 `@adui/scada-core`、NestJS 12、`rxjs`、Swagger 12 与 Pino/Helmet。保留独立水处理演示服务及 Vue/React 现有 `/demo` 代理，避免同阶段修改双框架运行时。
2. 新增唯一配置 `SCADA_LOCAL_DEMO_API_ENABLED=false`（根 `.env.example` 与 `env:check` 同步）。仅 `enabled === "true"`、`NODE_ENV !== "production"` 且 NestJS 实际解析的监听主机严格为 `127.0.0.1` 时允许注册模拟路由；包括 `0.0.0.0` 的任何非回环监听均禁止。开关缺失或大小写不同默认拒绝。该判断与 Swagger 文档开关独立，不会因为打开 Swagger 而意外开放模拟 API。
3. 保持原 `AppModule` 的 Controller/Provider/Import 契约不变。另定义 `LocalDemoAppModule` 组合已有 `AppModule` 与 `LocalDemoTelemetryModule`。只有正式 `main.ts` 在根 `.env` 加载和启动配置校验后明确允许本机演示时才选择该组合根模块；默认与生产启动继续选择原 `AppModule`，使模拟路由在该应用中真正不存在（404），而不是仅对所有请求返回 403。
4. 仅提供三个明确的只读接口：
   - `GET /api/dev/demo/project`：返回共享水处理 `waterTreatmentDemoDocument`，不访问数据库、不发布正式工程。
   - `GET /api/dev/demo/tags`：返回 `{ kind: "snapshot", values: TagValue[] }`，其中质量、序列号、时间戳采用共享 Core 契约。
   - `GET /api/dev/demo/events`：NestJS `@Sse` + RxJS 返回同一 `TagChange` 对象；新订阅者立即收到 snapshot，后续通过 TagStore 收到 delta。原生 SSE 自动禁止 HTTP 缓存和 Nginx 代理缓冲。
5. 服务只使用一份 `TagStore` + `WaterTreatmentSimulator`，固定三个水处理演示 Tag。启动时生成首批 GOOD 值；每秒模拟一次，沿用现有独立演示服务的 30 秒周期，其中后 8 秒停止采样并按超时将旧值标记 STALE，之后继续生成序列号更大的 GOOD 值。不从请求、环境或数据库读取设备地址，也不支持参数化设备操作或设备写入。
6. Nest `OnModuleDestroy` 必须清理定时器；RxJS 订阅撤销时移除 TagStore 监听器。API 通过 NestJS Swagger 自动描述仅实际存在的路由；Swagger 仍遵守单独的非生产、本机回环、显式启用三重开关。单纯开启本机模拟接口**不自动开放 Swagger**。
7. 现阶段仅用于本机诊断：即使监听回环，仍需警惕本机代理、端口转发或其他本机进程访问；禁止把该无鉴权接口当作生产正式实时订阅方案。未来正式 Tag 订阅必须增加可信身份、工程/Tag ACL、背压与连接配额、网关身份、心跳及断线重同步策略，并在专项 ADR 中明确。
8. 不修改 PostgreSQL/Prisma 模型、工业网关/PLC 接入、Vue/React、现有 Core 工程 Schema 或独立 Runtime 的已有 URL。当前不声称 FR-004、FR-009、FR-010 已全面交付，也不宣称设备实时数据已进入 NestJS。

## 测试与合并边界

- 新增访问策略单测：严格开关、非生产、回环地址、错误大小写。
- 新增服务单测：唯一模拟定时器、首次 snapshot、delta/取消订阅、STALE→GOOD 且序列号递增、停机清理。
- 原应用 E2E 新增默认模拟路由均 404；受控本机模块 E2E 覆盖只读工程、Tag 快照、Swagger JSON 的只读路由白名单，以及首条 SSE snapshot 和关闭连接。
- 维护者 2026-11-13 Windows 现已实测第二十一批（包括此前 Swagger 地址单测与本批显式 404 断言修复）**389/389 单测（33 个文件）、17/17 NestJS E2E（3 个文件）**，完整 `pnpm run ready` **退出码 0**。`vp check` 245 个文件格式正确、119 个源文件零警告/错误；69 份 Markdown 文档静态检查及 React/Vue/NestJS 构建通过。
- Windows 全量 `ready` 与独立 `pnpm run test:docker:server` 已实测退出码 **0**。Docker 冻结安装、隔离 HTTP 烟测、正式 Linux Node PID 1 的 SIGTERM 及正常退出码 0 均通过；未开放工程/工业设备接口保持 404。E2E 中的 Terminus 503 是主动模拟关闭的预期负面测试。额外的手工浏览器 Swagger/SSE 验证（在本机显式开启模拟及 Swagger 开关，结束后关闭并复验 404）**尚未收到结果**，不能将自动化 E2E 等同于手工交互或正式生产授权。生产/全网监听环境不可开放本机模拟 API。
- 本批不增加依赖、不变更锁文件、不部署、不允许工业写入。PR 必须 Draft、Assignee 为 `@adui-dev` 且创建后核验；未经维护者明确授权不得合并。

## 不包括

不包括真实数据库健康与迁移验证、工业现场设备接入、业务发布、权限认证、报警、历史数据、多客户端大规模并发以及 Vue/React 切换到 NestJS 模拟路径。它们仍需未来独立阶段交付。
