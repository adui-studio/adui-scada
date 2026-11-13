# ADR-0045：短期可信会话、租户身份与工程级 Guard

- 状态：Proposed
- 日期：2026-11-12
- 关联需求：FR-001、FR-002、FR-014、NFR-003、NFR-006
- 前置设计：[ADR-0041](0041-project-persistence-access-model.md)、[ADR-0043](0043-prisma-project-transaction-store.md)、[ADR-0044](0044-prisma-transaction-security-regression.md)

## 背景

此前只提供 `AuthenticatedProjectPrincipal` 的 TypeScript 形状及数据库 `scada_project_grants` ACL，但没有可证明主体真实来源的认证会话与请求级 Guard；直接开放版本 API 会造成伪造身份或跨租户越权。用户要求优先选择适合 NestJS 12 的安全依赖，并列出 JWT、日志、Swagger、Nano ID 等整体选型。

## 决策

本批建立**服务器端可撤销的不透明短期 Bearer 会话**，而非为不确定的身份提供方提前自发行 JWT。使用 Node 24 内置 `randomBytes(32)` 生成 256-bit 随机密钥，格式 `scada_s_<base64url>`，只在受信内部调用方签发时返回明文一次；数据库仅持久化 SHA-256 摘要。高熵随机令牌不是用户口令，因此固定时间比较或 Argon2 慢散列不属于当前必需路径；令牌查找使用摘要唯一索引。固定 15 分钟寿命，不自动续期；每次请求重新读取 DB 的过期、撤销和身份有效状态，减少状态缓存撤销窗口。未来接入 TLS、账号/OIDC、MFA、密码散列、日志审计和安全告警后才可以开放签发入口。

新增 `ScadaIdentity`（租户/主体复合主键、状态）和 `ScadaAuthSession`（UUID 会话主键、SHA-256 令牌摘要、到期/撤销、主体复合 FK）两张业务表，迁移附中文表/列及索引元数据、CHECK、FK，不修改任何历史迁移。停用主体立即使已存在会话认证失败。当前会话主键维持 `@db.Uuid`；Nano ID 将在后续新字符串字段中按需引入，不把 Nano ID 字符串写入 UUID 列。

`ScadaSessionGuard` 只接受 HTTP Authorization Bearer 且严格限定格式/长度，失败返回 401；通过后写入可信的 `request.scadaPrincipal`。组合 `RequireProjectPermission` 使 `ScadaProjectGuard` 在会话 Guard 后检查路由工程 ID，并以可信主体租户和主体查询数据库显式 ACL，复用既有 `hasProjectPermission`。缺少元数据、跨租户、未知/无授权工程统一拒绝，不根据前端请求体身份或角色判断。

**本批不导入 AppModule，不公开登录、会话签发、工程版本读写或工业设备写入接口**。将 Guard 用作未来可信 API 的可验证边界；真实业务事务仍需沿用 `PrismaProjectVersionStore` 的锁内 ACL 复核，Guard 不是唯一授权层。

## 未解决与后续

- `issueForVerifiedSubject` 是内部受信调用约定，**本批不存在真实密码登录、OIDC 或可信身份发行者适配**，因此不能宣称已经实现完整登录系统。
- 后续挂载身份模块与持久化模块前需统一 PrismaService 单例，并评审全局默认拒绝策略、健康路径明确豁免，以及缓存、审计、失效会话清理。
- Bearer 令牌在使用中仍可能被盗，正式部署必须启用 TLS、严格 CORS、敏感日志脱敏、限流和安全告警。
- Guard 认证后与 DB 事务之间可能发生会话撤销竞态；正式写入需在事务范围内复核当前凭据/授权，并明确中断和撤销的业务安全语义。
- 会话创建/撤销安全审计、密码散列/MFA、刷新令牌、会话绑定设备、登录失败锁定、RLS、生产 IAM 与账号运维均待后续专项实施。
- [依赖推荐清单](../DEPENDENCY_SELECTION.md) 对成熟库作阶段化选择，不在本次未使用它们时批量加入 npm 或改动锁文件。

## 预期验收

根 `ready` 预期 350 项普通单测与 5 项 NestJS E2E；隔离 PostgreSQL 在应用独立新迁移后预期 11 项真实测试。Docker 隔离烟测继续验证未公开的登录、工程与工业设备路由保持 404。**提交前未实际执行新的 Windows 质量链或数据库迁移，所有数量均为预计。**
