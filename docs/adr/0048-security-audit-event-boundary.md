# ADR-0048：会话与工程 Guard 的安全事件白名单边界

- 状态：Proposed
- 日期：2026-11-13
- 关联需求：FR-001、FR-014、NFR-003、NFR-007
- 前置：[ADR-0045](0045-trusted-session-and-project-guard.md)、[ADR-0046](0046-pino-openapi-http-security.md)、[ADR-0047](0047-server-configuration-startup.md)

## 背景

已实现的 `ScadaSessionGuard` 和 `ScadaProjectGuard` 可以验证短期会话与工程 ACL，但此前没有明确的安全事件边界。单纯记录完整请求、Bearer 令牌、访问 URL 或异常对象会使日志成为新的凭据泄露渠道。Pino HTTP 请求日志属于可观测性，不能被误认为数据库事务级安全审计。

## 第十六批决策

1. 新增 `ScadaSecurityAuditService` 和 `SecurityAuditReporter`：将受控 Guard 的结果转换为固定枚举事件，通过 NestJS 应用日志写出。该服务仅注册在**尚未挂载到正式 AppModule 的** `ScadaIdentityModule` 内。
2. 只允许操作 `session.authenticate`、`project.authorize`；结果只能是 `allowed` 或 `denied`。原因码按操作和结果分别允许：会话验证通过、凭据格式错误、会话失效、非 HTTP 场景；工程权限通过、元数据缺失、无可信主体、租户/工程范围无效、权限拒绝或非 HTTP 场景。
3. `createSafeSecurityAuditRecord` 必须**从白名单重新构造对象**，只输出 `category`、`action`、`outcome`、`reason` 四个常量/固定枚举字段；无法通过额外字段注入令牌、Cookie、密码、URL、请求体、工程路径、租户/主体标识或异常堆栈。无效枚举和不合法的操作/结果/原因组合显式拒绝，不回显原始输入。
4. 会话 Guard 和工程 Guard 通过 NestJS 依赖注入获得审计服务；拒绝及允许分支统一调用 `record`。原有 HTTP 状态码、默认拒绝、可信主体来源及 ACL 查询语义不变；没有调整会话签发/撤销业务逻辑或持久化事务。
5. 失败事件使用 NestJS Logger 的 `warn`，通过事件使用 `log`；消息只含脱敏后的 JSON 字符串。正式 Pino Logger 仍遵守既有 HTTP 请求字段白名单和 Pretty 测试隔离策略。

## 明确不交付的生产能力

- **不创建新的 PostgreSQL 表或迁移**；当前事件只是可被运维日志采集的诊断记录，不是不可篡改的正式审计台账，不保证事务内原子写入、持久化、保留周期、跨节点可靠交付或查询追溯。
- 记录中不包含主体、租户、会话或工程标识，因此目前无法对操作人员开展精确归责。后续正式 FR-014 必须单独设计受信主体关联、独立安全审计仓储、存储加密、保留与隐私规则以及审计失败时的安全策略。
- 尚未对内部 `issueForVerifiedSubject`、`revokeForVerifiedSubject`、生产登录、工业命令写入和数据库异常路径建立完整事件审计；不将本批称为完成认证审计。
- Guard 及身份模块仍未接入正式 `AppModule`；既有未开放的登录、工程版本读写和工业设备写入 HTTP 接口继续保持 404。
- 不新增第三方依赖、不修改 pnpm Catalog、锁文件、Prisma 或 Vue/React/共享 Core。

## 验收与风险

本批新增 4 项事件白名单与恶意输入单测，并在既有身份 Guard 单测中新增 2 项事件路径测试；维护者 Windows 实测常规单测由第十五批的 361 项增加至 **367/367**，NestJS E2E **8/8**；`vp check` 零警告/错误，完整 `pnpm run ready` **退出码 0**，独立 Docker 隔离构建与烟测 **退出码 0**。未执行本批隔离 PostgreSQL 真库回归。

后续在 Guard 正式接入 HTTP API 之前，应补充请求关联 ID 的受信传递、日志失败/丢失处置、持久化强审计、速率限制和审计吞吐量验证。对于未来接入的请求 DTO、环境配置或外部事件，可选择 Zod 4 校验数据边界；但本批审计事件是内置固定枚举与仅四字段的安全输出，保留显式运行时白名单，**不因引入 Zod 而复制原始对象、不记录 `ZodError` 中的敏感输入、不新增无用依赖**。正式采用时须按 Catalog 与锁文件流程并完成安全复验。本批没有新增或开放任何生产控制能力。
