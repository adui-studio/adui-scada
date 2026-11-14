# ADR-0065：厂商无关 OIDC、BFF 会话与服务端工程 API

- 状态：Accepted
- 日期：2026-11-14
- 关联需求：FR-001、FR-002、FR-008、FR-013、FR-014、NFR-001、NFR-002、NFR-003、NFR-004、NFR-006、NFR-008
- 前置：[ADR-0040](0040-server-project-contract.md)、[ADR-0041](0041-project-persistence-access-model.md)、[ADR-0043](0043-prisma-project-transaction-store.md)、[ADR-0045](0045-trusted-session-and-project-guard.md)、[ADR-0062](0062-project-tag-definitions-schema-030.md)、[ADR-0064](0064-legacy-browser-migration-validation.md)

## 背景

仓库已经具备服务端可信身份主体、短期可撤销会话、工程 ACL、Prisma 工程版本事务仓储和只读健康探针，但 AppModule 尚未导入身份/工程持久化模块，也没有正式认证或工程 HTTP API。现有 AuthSessionService.issueForVerifiedSubject() 明确要求可信上游身份，不能将浏览器提交的用户 ID、租户 ID、邮箱或角色当作可信主体。

Vue 与 React 是两个正式 Web 端，必须共用同源 API 契约、工程格式和权限语义。身份提供方尚未确定，不能把项目锁定到单一 SaaS、单一企业目录或某个厂商 SDK。

## 决策

### 1. 身份协议与依赖

- 使用厂商无关的 OpenID Connect 1.0，初始仅配置一个可信 Issuer；后续可扩展命名 Provider 注册表，不接受请求参数动态指定 Issuer。
- 服务端使用 openid-client 6.8.9 作为 OIDC Relying Party 客户端。该库提供 Discovery、Authorization Code Grant、PKCE、Nonce、State 与 ID Token 验证；不再额外引入 Passport、手写 JWT 验签或第二套会话框架。客户端认证固定使用 `client_secret_basic`，ID Token 签名算法固定为 `RS256`。
- 当前工作区使用 NestJS 12.0.3、Node >=22.18.0、ESM；依赖版本写入根 pnpm Catalog，具体锁文件由 pnpm 生成。当前不升级 NestJS，不引入 @nestjs/authentication 0.x 与现有自有会话/Guard 重复的状态机。
- 生产环境只允许 HTTPS Issuer、HTTPS Redirect URI 和可信 HTTPS Web Origin。Discovery 只读取服务端配置的固定 Issuer；不允许用户输入 URL、动态注册或从请求头推导回调地址，避免 SSRF、Issuer Mix-Up 和 Host Header 注入。
- 使用 Authorization Code Flow + PKCE S256；每次登录独立生成不可预测的 state、nonce、code_verifier。即使客户端是 confidential client，也强制 PKCE，并校验 State、Nonce、Issuer、Audience、签名和时间声明。仅使用 openid 必需身份声明；不采用 Implicit Flow、Resource Owner Password Credentials 或前端持有 IdP Token。
- redirect_uri 是服务端配置的固定精确地址。登录后的站内返回路径只允许经过校验的相对路径，不接受外部 URL、协议相对地址或反斜杠绕过。

### 1.1 Discovery 与元数据校验（第三十三批阶段 B 第一小批）

- Discovery 只能接收配置中的固定 Issuer Identifier，并调用 openid-client 6.8.9 的 `discovery()`；禁止把 Discovery 文档 URL 当作 Issuer。配置层拒绝包含 `/.well-known/` 的 Issuer 路径，避免触发库对直接 Discovery URL 的兼容分支并绕过 Issuer 一致性检查。
- 使用 10 秒发现超时，成功配置在进程内惰性缓存，并发首次请求共享同一发现任务；发现失败清除缓存，允许后续重试。OIDC 关闭或身份模块未挂载时不发起网络请求。
- 元数据必须声明授权码响应、主体标识类型、RS256、PKCE S256；若声明许可类型、Scope 或 Token Endpoint 认证方法，则必须包含 `authorization_code`、`openid` 和 `client_secret_basic`。缺省 Token Endpoint 认证方法按规范默认值使用 `client_secret_basic`。
- 必须存在 Authorization Endpoint、Token Endpoint 与 JWKS URI。发现端点及这三个元数据端点只允许 HTTPS；仅非生产环境显式开启本机测试模式时允许回环 HTTP。自定义 Fetch 校验每个请求 URL，保留 `redirect: manual`，不自动跟随端点重定向。
- Discovery 服务注册在 `ScadaIdentityModule` 中，采用惰性调用；第一小批提交时该模块尚未挂载。第五小批后，`main.ts` 仅在 `SCADA_OIDC_ENABLED=true` 且完整配置校验通过时挂载身份模块。Mock Fetch 单测不代表真实 IdP 联调已通过。

### 2. OIDC 事务与外部身份映射

- 新增短时 OIDC 登录事务表：只存储 state 的 SHA-256 摘要、预期 nonce、PKCE verifier 的 AES-256-GCM 密文、浏览器绑定 Cookie 摘要、固定站内返回路径、Issuer、创建/过期/消费时间。
- 登录事务默认有效期 5 分钟；回调通过数据库条件更新原子消费，过期、重复回调、浏览器绑定不匹配或解密失败均拒绝。密钥来自独立环境变量，不进入仓库、日志或前端；不得使用数据库明文存储 PKCE verifier。
- 使用短时 HttpOnly + Secure + SameSite=Lax + Path=/ 浏览器绑定 Cookie 将 OIDC 登录事务与发起登录的浏览器绑定，防止攻击者在自己的浏览器发起登录后诱导受害者完成登录 CSRF。Cookie 不设置 Domain；多标签页事务使用同一短时浏览器绑定值，事务仍按独立 State 消费。
- 新增外部身份映射表，以 (issuer, subject) 唯一映射到已有本地 (tenantId, subjectId)。iss + sub 是外部身份主键；邮箱、用户名、显示名称、组/角色 Claim 不得作为唯一身份键或自动租户来源。
- 禁止默认 JIT 自动建用户/租户。首次登录必须已经存在映射，且对应 ScadaIdentity.status = active；无映射、停用主体或跨租户映射均拒绝。外部身份绑定由受信运维流程预配置，不能由普通用户 API 自助认领。
- 本批不实现密码登录、账号注册、MFA、自动租户发现、角色 Claim 自动映射、账号邀请和外部身份自助绑定。

### 3. BFF 与内部会话

- OIDC 回调成功后，只从已验证 ID Token 的 iss、sub 查询外部身份映射，再调用现有 AuthSessionService.issueForVerifiedSubject() 签发内部会话。
- 浏览器不保存 IdP Access Token、Refresh Token 或 ID Token；不把会话令牌放入 localStorage、sessionStorage、URL 或前端日志。
- 内部会话沿用现有高熵随机不透明令牌、数据库 SHA-256 摘要、15 分钟有效期、每请求回查撤销/过期/主体状态的机制。只在浏览器 Cookie 中返回令牌明文。
- 会话 Cookie 名称为 __Host-adui-scada-session，属性固定 HttpOnly; Secure; SameSite=Lax; Path=/，不设置 Domain；登出时撤销服务端会话并清除 Cookie。当前登出只结束 ADui SCADA 本地会话，不承诺结束 IdP 自身 SSO 会话。
- 增加独立 CSRF Cookie/请求头同步令牌：随机令牌仅以 SHA-256 摘要存储在会话记录中；浏览器将可读 CSRF Cookie 的值放入 X-SCADA-CSRF。所有基于 Cookie 的非安全方法还必须通过精确 Origin 白名单、Fetch Metadata 检查和常量时间 CSRF 摘要比对。Bearer 请求与 Cookie 请求的认证方式不得混用或静默回退。
- ScadaSessionGuard 保留现有 Bearer 兼容能力，并新增 Cookie 会话分支；Cookie 会话的写请求必须通过 CSRF 检查。认证失败、CSRF 失败只记录固定原因码，不记录 Cookie、Authorization、State、Code、Token、URL 或异常原文。
- 当前 NestJS 为 12.0.3，不依赖 12.1+ 的 app.enableCsrfProtection()；本批由专用 Guard/安全策略显式实现并测试。

### 4. 数据库与 NestJS 模块

- 新增共享 DatabaseModule，统一导出单例 PrismaService。ScadaIdentityModule 与 ProjectPersistenceModule 从该模块注入同一实例，禁止在两个模块分别声明 PrismaService 造成多连接池/生命周期不一致。
- 新增 ScadaExternalIdentity 与 ScadaOidcTransaction 表；为 ScadaAuthSession 增加可空 CSRF 摘要字段，保留已有 Bearer 会话记录兼容。所有新增表/字段/索引/约束必须在增量 Prisma 迁移中提供中文表、字段、索引注释；严禁修改已应用迁移。
- OIDC 与工程持久化模块只在 SCADA_OIDC_ENABLED=true 且完整配置校验通过时挂载。默认 AppModule 仍只提供健康探针；OIDC 未启用时 /api/v1/auth/_、/api/v1/projects/_ 不注册、不暴露，不能因为导入模块而隐式连接 PostgreSQL。
- 根 .env 新增非敏感开关与配置说明；Client Secret、事务加密密钥和数据库凭据只由进程环境/秘密管理系统提供。任何启动错误不得回显原始密钥或连接串。

### 5. 服务端工程 API 与权限

第一阶段提供以下最小 API，统一位于 /api/v1，React/Vue 通过同源 Vite/Nginx 代理访问：

| 方法 | 路径                                           | 权限                  | 语义                                             |
| ---- | ---------------------------------------------- | --------------------- | ------------------------------------------------ |
| GET  | /api/v1/auth/oidc/start                        | 公开入口              | 建立登录事务并重定向至固定 Issuer                |
| GET  | /api/v1/auth/oidc/callback                     | 公开回调              | 校验并消费事务，建立本地会话                     |
| GET  | /api/v1/auth/me                                | 已认证                | 返回最小本地身份上下文，不返回令牌               |
| POST | /api/v1/auth/logout                            | 已认证 + CSRF         | 撤销当前本地会话并清除 Cookie                    |
| POST | /api/v1/projects                               | 已认证                | 原子创建工程、初始版本、创建者 ACL 和成功审计    |
| GET  | /api/v1/projects                               | 已认证                | 仅列出当前租户/主体被明确授权的工程              |
| GET  | /api/v1/projects/:projectId                    | project:read          | 读取工程当前修订摘要                             |
| GET  | /api/v1/projects/:projectId/versions           | version:read          | 列出授权工程的历史版本摘要                       |
| GET  | /api/v1/projects/:projectId/versions/:revision | version:read          | 读取并校验不可变快照                             |
| POST | /api/v1/projects/:projectId/versions           | version:append + CSRF | 携带 expectedRevision 追加版本，CAS 冲突明确返回 |

- 权限只从服务端可信 Principal 和数据库 ACL 获取；请求体不接受 tenantId、subjectId、actorId、角色或权限字段。
- 工程创建时在一个 PostgreSQL 事务中创建工程、创建者三项最小 ACL、首个不可变快照、修订水位和成功审计；任何一步失败全部回滚。
- 追加/读取沿用现有 PrismaProjectVersionStore 的行锁内 ACL 复核、CAS、摘要校验与审计，不允许只依赖 Guard 的前置查询。
- 列表查询必须按当前 Principal 的 tenant/subject 过滤；不存在与无权限统一返回，不泄露其他租户工程是否存在。
- 只交付工程保存版本 API，不等同于正式发布。本批不提供发布指针、发布审批、版本回滚、项目删除、共享权限管理、设备配置、工业地址映射、PLC/DCS 连接或设备写入。

### 6. Vue / React 与部署

- 新增框架无关 @adui/scada-api-client，统一处理同源请求、credentials: same-origin、CSRF 请求头、中文 API 错误映射和响应校验；不持有长期令牌，不依赖 Vue/React。
- Vue 与 React 只负责各自 UI 和生命周期，工程 API、身份模型、权限和 JSON 契约共用。浏览器工程 IndexedDB 草稿仍可离线工作；服务端保存失败不得清空本地草稿。
- 两套 Vite 开发服务器增加 /api 同源代理到 NestJS；Docker Nginx 在 /api/health 之外代理 /api/v1/* 到 NestJS，未注册路由仍由 NestJS 返回 404。生产部署必须使用 HTTPS 和固定可信反向代理。
- 不开启宽泛 CORS，不把 Client Secret 或其他服务端变量暴露为 VITE_*。

## 数据流

1. 浏览器访问 OIDC start；服务端生成 state/nonce/PKCE，持久化加密事务并绑定浏览器 Cookie。
2. 浏览器跳转固定 Issuer；IdP 完成认证后回到固定 callback。
3. 服务端原子消费事务，使用 openid-client 完成 Code Exchange 和 ID Token 校验。
4. 以精确 (iss, sub) 查找预配置外部身份，确认本地身份 active。
5. 复用 AuthSessionService 签发内部会话，设置安全 Cookie 和 CSRF Cookie，跳回固定站内路径。
6. Vue/React 通过共享 API Client 访问工程 API；Session Guard 验证会话，Project Guard 和事务仓储分别执行 ACL，数据库事务完成版本保存。

## 配置契约（实现时加入 Zod 校验）

- SCADA_OIDC_ENABLED=false：默认关闭。
- SCADA_OIDC_ISSUER：固定 Issuer URL。
- SCADA_OIDC_CLIENT_ID / SCADA_OIDC_CLIENT_SECRET：服务端 confidential client 凭据。
- SCADA_OIDC_REDIRECT_URI：精确预注册回调 URI。
- SCADA_OIDC_WEB_ORIGINS：React/Vue 的精确可信 Origin 白名单。
- SCADA_OIDC_TRANSACTION_ENCRYPTION_KEY：32 字节 Base64URL/AES-256-GCM 密钥。
- 仅在非生产、Issuer 为 loopback 且显式启用专用开发开关时，才允许本机 HTTP OIDC 测试；生产永远要求 HTTPS。
- 以上值不进入前端构建、不写入仓库真实 .env、不写日志。env.example 只给出开关和空白占位。

## 风险与未决事项

- 身份映射运维：本批先要求外部身份预绑定；后续需设计安全的管理员身份目录和绑定审批流程。
- IdP 差异：不同 Issuer 的组、租户、注销端点和可选 Claim 不一致；本批不把厂商 Claim 当成通用权限标准。
- 反向代理：必须由固定配置提供公开 Origin/Redirect URI，代理信任边界、Host/Forwarded Header 和 HTTPS 终止策略需在部署验收时核对。
- 多实例：OIDC 事务和会话存 PostgreSQL，允许多实例共享状态；Discovery/JWKS 缓存需有界且处理密钥轮换。
- 审计：现有安全审计当前是诊断日志，不是防篡改持久审计；本批只沿用已有成功版本审计，认证成功/失败的持久安全审计、告警和保留策略仍是后续专项。
- 账号安全：MFA、登录风险策略、IdP 账号停用同步、跨设备会话管理和上游全局登出不在本批承诺范围。
- 生产验收：没有真实 Issuer 配置、TLS、DNS、回调注册和租户映射前，只能通过 Mock OIDC 测试验证实现，不能声称已完成企业 IdP 联调。

## 实施顺序

详见 [第三十三批实施计划](../plans/v0.3-batch-33-oidc-project-api.md)。先完成配置/模块隔离与数据库迁移，再完成 OIDC/BFF 会话和身份映射，随后工程事务 API、共享 API Client、双框架代理与安全回归。每一阶段保持默认关闭；全部安全测试通过后才允许维护者显式启用。

## 参考标准与库

- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700.html)
- [openid-client v6 API](https://github.com/panva/openid-client)

### 2.1 State、Nonce 与 PKCE 一次性登录事务（第三十三批阶段 B 第二小批）

- 每次登录由 openid-client 生成独立随机 State、Nonce 和 PKCE verifier，并计算 S256 challenge；授权请求只包含服务端固定 Redirect URI 与 `openid` Scope。
- State 仅以 SHA-256 摘要作为数据库主键；浏览器绑定值使用独立 32 字节随机 Cookie，数据库只存其 SHA-256 摘要。有效绑定 Cookie 可供同一浏览器多个标签页复用，每次登录仍使用独立 State/Nonce/Verifier。
- PKCE verifier 使用 AES-256-GCM 加密，随机 12 字节 IV、16 字节认证标签；State 摘要作为 AAD，密文使用带版本的 Base64URL 格式。解密严格校验版本、长度、规范编码和认证标签。
- 登录事务有效期为 5 分钟。回调使用固定 Issuer、State 摘要、浏览器绑定摘要、创建/过期时间和 `consumedAt IS NULL` 条件，在单个 PostgreSQL 交互事务中执行条件更新；并发回调只有一个能消费成功。成功消费后再次校验 Nonce 格式与回跳路径规范性，再在内存中解密 verifier；持久化数据被篡改、密文错误时均不返回 verifier。多实例部署必须共享同一事务加密密钥；密钥轮换需等待旧事务全部过期后再切换。
- 回跳路径只接受站内以单斜杠开头的路径，拒绝外部 URL、协议相对地址、反斜杠、片段、控制字符及编码 CR/LF/反斜杠；不接受客户端指定回跳 Origin。
- 本小批仅提供服务层，不注册 HTTP Controller，不解除 `main.ts` 的 OIDC fail-closed 保护。浏览器绑定 Cookie 的 HttpOnly/Secure/SameSite 属性由后续 Controller 负责设置。

### 2.2 授权码回调、ID Token 与预绑定身份（第三十三批阶段 B 第三小批）

- 回调先通过一次性事务服务验证并消费 State 与浏览器绑定；OAuth 错误响应也消费事务，避免重放。回调输入仅允许单值 State、Code 和可选 `iss`，拒绝数组/重复参数、控制字符及不符合格式的值。
- 若 Discovery 元数据 `authorization_response_iss_parameter_supported` 为 true，回调必须携带 `iss`；只要携带就必须与服务端固定 Issuer 精确相等。Token Exchange 的回调 URL 从服务端固定 Redirect URI 构造，不使用请求 Host、Forwarded Header 或客户端传入的回调地址。
- 使用 openid-client 6.8.9 `authorizationCodeGrant()`，传入 `expectedState`、`expectedNonce`、PKCE verifier 和 `idTokenExpected: true`。签名/JWKS、Issuer、Audience、有效期及 Nonce 的协议验证交由该库执行；应用层再检查固定 Issuer、Client ID Audience、`azp`、多 Audience 规则、Nonce、Subject 格式及时间声明类型。
- 只使用已验证 ID Token 的精确 `(iss, sub)` 查询 `ScadaExternalIdentity`，关联 `ScadaIdentity` 必须为 active；没有预绑定或主体停用均拒绝，不使用 email、用户名、groups/roles Claim 自动创建或映射内部身份。
- 验证成功后复用 `AuthSessionService.issueForVerifiedSubject()` 创建本地短期不透明会话。IdP Access/Refresh/ID Token 不保存、不记录；本地 sessionToken 仅作为服务层结果交给未来 Controller 设置 HttpOnly Cookie，不得作为 JSON 返回。当前尚未注册 Controller，`main.ts` 仍保持 OIDC fail-closed。
- 代码与 Mock 单测已提交；维护者 Windows 验证待执行。Mock Token Endpoint/Claims 不代表真实 IdP 的签名验证、JWKS 轮换、网络故障或企业 SSO 联调已经验收。

### 3.1 Cookie 会话与 CSRF Guard（第三十三批阶段 B 第四小批）

- `AuthSessionService.issueForVerifiedSubject()` 在签发 15 分钟内部会话时同时生成独立 32 字节随机 CSRF Token；数据库只存储 `csrfTokenHash` 的 SHA-256 摘要。现有 `csrfTokenHash` 可空字段已存在，旧 Bearer 会话保持兼容，不新增迁移。
- Cookie 名称固定为 `__Host-adui-scada-session` 与 `__Host-adui-scada-csrf`。两个 Cookie 均设置 `Secure; SameSite=Lax; Path=/` 且不设置 Domain；会话 Cookie 额外设置 HttpOnly，CSRF Cookie 保持可读供前端写入 `X-SCADA-CSRF`。
- Cookie 序列化与清除由纯函数统一构造，严格校验会话/CSRF Token 格式和 15 分钟以内有效期；清除 Cookie 使用相同名称、Path 和安全属性。
- `ScadaSessionGuard` 保留显式 Bearer 路径，新增 Cookie 路径。Bearer 与任一 ADui 认证 Cookie 同时出现时拒绝；无 Bearer 时不会从无效 Cookie 静默回退。旧 CSRF 摘要为空的 Bearer 会话不得升级为 Cookie 会话。
- Cookie 安全方法仅允许 GET/HEAD/OPTIONS，不要求 CSRF Header；Cookie 非安全方法必须满足 Origin 与 `SCADA_OIDC_WEB_ORIGINS` 精确匹配、`Sec-Fetch-Site: same-origin`、CSRF Cookie 与 `X-SCADA-CSRF` 双提交一致，并再次与数据库会话 CSRF 摘要进行常量时间校验。
- Guard 仅把验证后的 Principal、Cookie 会话 ID 与认证方式写入请求上下文；审计只记录固定原因码，不记录 Cookie、Token、Origin 或请求原文。
- 本小批只实现会话服务、Cookie 构造函数和 Guard，不注册 Controller、不挂载到默认 AppModule，也不改变 `main.ts` 的 OIDC fail-closed 启动保护。真实浏览器 Cookie 行为和 HTTPS 部署验收仍待后续 HTTP Controller/浏览器回归。

### 3.2 OIDC BFF HTTP 路由与模块启用边界（第三十三批阶段 B 第五小批）

- `ScadaAuthController` 仅注册在 `ScadaIdentityModule`，路由固定为 `/api/v1/auth/oidc/start`、`/api/v1/auth/oidc/callback`、`/api/v1/auth/me` 和 `/api/v1/auth/logout`。Start/Callback 只负责 HTTP 参数与 Cookie/重定向编排，协议校验仍由既有登录事务和回调服务负责。
- Start 的站内回跳参数仍由 `OidcLoginTransactionService` 严格规范化；授权 URL 来自固定 Issuer Discovery。短时浏览器绑定 Cookie 使用 `__Host-adui-scada-oidc-browser`、HttpOnly、Secure、SameSite=Lax、Path=/、不设置 Domain，确保 IdP 顶层 GET 回调携带且不暴露给脚本。
- Callback 只把单值 State/Code/Error/`iss` 交给回调服务；服务成功后通过 `Set-Cookie` 写入本地 Session 与 CSRF Cookie，Location 只使用事务中已校验的站内相对路径。响应设置 `Cache-Control: no-store` 与 `Referrer-Policy: no-referrer`，不返回 Session/CSRF Token JSON。
- `GET /me` 由 `ScadaSessionGuard` 保护，只返回服务端可信租户/主体标识；`POST /logout` 同样由 Guard 保护，Cookie 请求必须通过 Origin、Fetch Metadata 和 CSRF，Bearer 兼容请求使用已验证的当前会话 ID。撤销数据库失败时不清除 Cookie、不谎报注销成功。
- 新增 `OidcEnabledAppModule` 仅组合基础 `AppModule` 和 `ScadaIdentityModule`；`main.ts` 只有在 OIDC 开关与完整配置校验通过时才选择该根模块。默认 `AppModule` 仍不导入身份/数据库模块；本机模拟 API 与 OIDC 同时开启时 fail-fast。工程持久化模块尚未挂载，因此当前没有工程 HTTP API。
- HTTP Controller 和 Mock E2E 通过不等同于真实 IdP/JWKS、生产 HTTPS、反向代理、浏览器 SameSite Cookie 或企业身份映射已验收；维护者 Windows 完整质量链仍是启用前门禁。
