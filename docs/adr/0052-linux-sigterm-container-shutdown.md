# ADR-0052：在 Linux 隔离容器内验证正式 NestJS 进程 SIGTERM 退出

- 状态：Proposed
- 日期：2026-11-13
- 关联：NFR-003、NFR-006、NFR-007、NFR-008
- 前置：[ADR-0050](0050-http-readiness-terminus.md)、[ADR-0051](0051-http-ingress-shutdown-policy.md)

## 背景与依据

前十九批已完成 NestJS 12 的 HTTP 就绪探针、关闭阶段新请求 503、Node 24 HTTP 入口资源限制，并使用 Windows `app.close()` 进行基础 E2E 验证。然而 Windows 本地测试不能等同于 Linux 运行镜像以 PID 1 接收 Docker 实际 `SIGTERM`。

经核对 **仓库所用 NestJS 12.0.3 实际源码**（`packages/core/nest-application-context.ts`），`enableShutdownHooks()` 默认在关闭钩子完成后再向自身发送原信号，因此正常收到 `SIGTERM` 后的退出码可能为 **143**。同版本 `ShutdownHooksOptions.useProcessExit` 明确支持在关闭钩子完成后调用 `process.exit(0)`，并说明此选项可能影响其它第三方信号监听器及编排平台对退出码的解释。不能把“默认退出码 143”误报为失败，也不能仅通过放宽退出码断言掩盖真正的 SIGKILL（常见退出码 137）。

本批选择统一的**成功退出码 0**，使 Docker 隔离信号测试可以验证 NestJS 关闭钩子成功结束；实际业务系统上线后需结合生产编排策略复审这一选择。

## 决策

1. 正式 `main.ts` 从 `app.enableShutdownHooks()` 改为 `app.enableShutdownHooks([], { useProcessExit: true })`；空列表沿用 NestJS 的默认受支持信号集合，`return503OnClosing`、HTTP 资源限制、Pino 与启动环境顺序保持不变。NestJS 在完整调用关闭生命周期后以退出码 0 结束进程；异常清理仍依照上游逻辑退出非零。若未来第三方库另有信号处理器，必须重新检查 `useProcessExit` 行为。
2. 不添加新的 npm 依赖、环境变量、数据库迁移或业务 HTTP 路由。Docker 镜像保持原 Node 24 / pnpm 冻结安装环境；隔离测试继续不映射宿主端口、不启动 Compose、不连接外部网络或工业网关。
3. 保留原 `scripts/test-server-container.mjs` 的第一阶段模块加载与 HTTP 路由烟测。第二阶段在**同一镜像中**用 `docker run --detach --network none` 启动正式 `CMD ["node", "apps/server/dist/main.js"]`，进程以 Node 身份担任 PID 1，监听同一容器内回环地址。
4. `apps/server/container-signal-probe.mjs` 作为测试专用脚本，通过 `docker exec` 进入容器，轮询 `GET /health/ready` 直至 200，确认 `GET /health` 为 200、未开放的设备写入 API 继续 404。使用有限重试及每次请求的 `AbortSignal.timeout`，不从宿主机暴露端口。
5. 健康探针成功后，从宿主机通过 `docker stop --signal SIGTERM --timeout 10` 发送**真正的 Linux 信号**到正式进程；随后通过 `docker inspect --format "{{.State.ExitCode}}"` 检查退出码严格为 **0**，区别于超时强制结束时常见的 137。无论成功失败，均使用动态唯一容器名，并在 `finally` 中执行 `docker rm --force` 清理测试容器。
6. 使用同一根脚本 `pnpm run test:docker:server` 执行两阶段检查，不增加要求维护者手动操作容器的独立脚本。测试依赖 Docker Desktop 的 Linux 容器运行模式；宿主系统为 Windows 不影响容器内真实信号行为。
7. 按已确认的项目协作规则，**所有由 AI 创建的 PR（包括 Draft）必须立即指派给 GitHub `@adui-dev` 并核验 Assignee**，且未经明确授权不合并。

## 验证与风险边界

- 第十九批维护者 Windows 基线：**381/381 单测、12/12 E2E**，完整 `pnpm run ready` 和 Docker 隔离烟测均为退出码 0。第二十批不增加普通 Vitest/E2E 测试数量，新增的 Linux SIGTERM 测试在 Docker 两阶段烟测中执行，因此预计仍为 **381 单测、12 E2E**；这是待复验预期，不是本批实际结果。
- 通过 Windows `pnpm install --frozen-lockfile`、`vp check`、`pnpm run ready`、`pnpm run test:docker:server` 及最终 Git 状态检查进行验收。**本执行环境没有运行本批完整质量链和 Docker**，不得将 GitHub 代码提交当作测试通过。
- 检查真实 Linux SIGTERM 后的正常退出**不等于**已验证业务请求排空、长时间 SSE / WebSocket 断线重连、事务提交补偿、网关 PLC 连接收尾、反向代理摘流或 Kubernetes 滚动升级。当前正式服务没有这些已开放的业务组件；未来接入后应增加真实在途请求与数据一致性的专项演练。
- `useProcessExit: true` 是有意识改变 Unix 退出码语义的决策，不可用于掩盖清理异常；正常退出必须依赖 NestJS 完成关闭阶段，测试仍应对超时、异常退出与容器残留报错。

参考：
- [NestJS 12.0.3 关闭信号源码](https://github.com/nestjs/nest/blob/v12.0.3/packages/core/nest-application-context.ts)
- [NestJS 12.0.3 关闭选项](https://github.com/nestjs/nest/blob/v12.0.3/packages/common/interfaces/shutdown-hooks-options.interface.ts)
- [Docker stop 文档](https://docs.docker.com/reference/cli/docker/container/stop/)
