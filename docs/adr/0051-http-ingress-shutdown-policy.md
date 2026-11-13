# ADR-0051：使用 Node 原生 HTTP 资源限制与 NestJS 12 安全关闭选项

- 状态：Proposed
- 日期：2026-11-13
- 关联：NFR-003、NFR-006、NFR-007、NFR-008
- 前置：[ADR-0046](0046-pino-openapi-http-security.md)、[ADR-0047](0047-server-configuration-startup.md)、[ADR-0050](0050-http-readiness-terminus.md)

## 背景

第十八批新增 HTTP 存活与就绪探针，`GET /health/ready` 在关闭期间报告 503。正式 NestJS 入口已经通过 `app.enableShutdownHooks()` 监听可支持的系统终止信号，但 **Node HTTP Server 的请求接收资源限制仍使用默认值**，且 Express 适配器默认未启用关闭阶段对新请求的统一拒绝。

本批检查 NestJS 12.0.3 **实际源码**，其 `NestApplicationOptions.return503OnClosing` 默认关闭；开启后 Express Adapter 在 `beforeClose` 阶段拒绝新到请求、返回 503 和 `Connection: close`，不会主动杀掉已经在处理的请求。无需额外终止信号中间件、外部代理依赖或新库。Node 24 原生 `http.Server` 支持 `headersTimeout`、`requestTimeout`、`keepAliveTimeout`、`maxHeadersCount` 和 `maxRequestsPerSocket`。

## 决策

1. 使用已有 Node 24 + NestJS 12，不新增任何 npm 依赖或配置文件。不修改根 `.env` 加载时序、现有 Swagger 三重访问条件、Pino/Helmet、Zod 与项目工程 Schema。
2. 将正式 `NestFactory.create` 的参数集中为 `SCADA_NEST_HTTP_OPTIONS`：保持 `cors:false`、`bufferLogs:true`，增加 `return503OnClosing:true`。**不启用 `forceCloseConnections`**，避免强制中断尚在处理的请求。正式入口的 `enableShutdownHooks` 原样保留。
3. 新增 `applyHttpServerPolicy(server)`，在 `app.listen` 之前对现有 Node 原生 HTTP Server 赋值：`headersTimeout=15_000` 毫秒、`requestTimeout=60_000` 毫秒、`keepAliveTimeout=5_000` 毫秒、`maxHeadersCount=100`、`maxRequestsPerSocket=1_000`。集中在一个文件维护数值，避免生产入口与隔离测试维护两套不同限制。
4. `requestTimeout` 只表示**接收完整 HTTP 请求的时间限制**，不是 Handler 运行时长或响应超时。不得设定通用 `server.timeout`、RxJS 响应 `timeout()` 或统一中断时限，以免破坏未来 SSE 长连接、实时订阅或工业数据回传。未来如明确需要大体积上传、代理慢链路或长时间请求流，应专项评审这些限制和部署代理配置。
5. 已存在的 `GET /health` 和 `GET /health/ready` HTTP 契约不修改；正式关闭流程中，适配器会在任何新请求到达时直接返回 503（包括健康探针），与第十八批的生命周期就绪状态共同防止关闭中的新请求进入业务层。
6. 这些配置不是完整的生产抗 DDoS、反向代理和高可用方案；未来需要按受信反向代理、分布式限流、访问控制与实际性能数据专项评估。不会因为本批配置而开放登录、工程读写或设备控制 API。

## 测试与风险

- 新增 `http-server-policy.spec.ts` 三项单测：固定非零接收限制、不会设置应用响应超时、重复配置幂等及关闭选项固定。
- 新增 `http-server-policy.e2e-spec.ts` 两项测试：真实 Nest HTTP Server 接收策略和探针回归；`onModuleDestroy` 的测试屏障模拟已开始但尚未完成的关闭流程，验证新请求返回 503 且 `Connection: close`，然后释放屏障使程序正常关闭，避免泄漏端口及句柄。
- Docker `--network none` 镜像烟测复用正式配置函数和启动选项，检查 Node 原生 Server 限制确实生效，并回归健康接口 200、未开放业务接口 404。
- 不改 Prisma / PostgreSQL、Redis、Gateway、Vue/React、共享 Core 或业务协议；第十八批 Windows 实测基线为 **378/378 普通单测、10/10 E2E**、`ready` 和 Docker 退出码 0。第十九批预计 **381 项单测、12 项 E2E**，属于待运行数字，未经 Windows 实测不得标为通过。
- 由于本批无新依赖，`pnpm-workspace.yaml`、`apps/server/package.json` 与 `pnpm-lock.yaml` 均不应变化；仍必须执行冻结安装、静态检查、完整 `ready`、Docker 隔离烟测。**Windows 平台不支持像 Linux 一样可靠拦截 SIGTERM**，因此 E2E 使用 Nest 官方 `app.close()` 触发真实关闭钩子与服务器关闭保护；不能将它表述为实际部署中接收 SIGTERM 的验证。

## 待后续专项

真正生产环境的 SIGTERM 时限、负载均衡流量摘除顺序、仍在执行的请求的完成/强制终止策略，以及后续 SSE/WebSocket/工业网关订阅的关闭和重连，需要在正式发布与部署阶段评估；不能以这次基础 HTTP 保护冒充端到端优雅停机认证。

参考：

- [NestJS 12.0.3 Express 适配器](https://github.com/nestjs/nest/blob/v12.0.3/packages/platform-express/adapters/express-adapter.ts)
- [NestJS 生命周期](https://docs.nestjs.com/fundamentals/lifecycle-events)
- [Node.js 24 HTTP Server](https://nodejs.org/download/release/latest-v24.x/docs/api/http.html)
