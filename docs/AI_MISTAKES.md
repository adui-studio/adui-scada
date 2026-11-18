# ADui SCADA · AI 编码错误复盘与防复发清单

> **强制执行**：任何 AI Agent 在本仓库**每次开始编写或修改代码之前，必须先阅读本文件全文**，不能依赖上一次阅读、对话摘要或历史记忆替代。本要求由根目录 [AGENTS.md](../AGENTS.md) 强制执行。
>
> 适用范围：TypeScript、Vue、React、NestJS、Prisma、SQL、浏览器测试、构建脚本、部署配置、工程 Schema、依赖声明与锁文件。修复某项问题后，应在开始下一项代码修改前重新核对本文件及目标文件的相关约束。
>
> 本文只记录有仓库变更、维护者实测日志或复盘文档支撑的实际错误。**预防性规则**单独标明，不得将推测写成已发生的事故。

## 一、每次写代码前的检查顺序

1. **先读** `AGENTS.md` 与**本文件全文**；识别本次修改可能重复触发的错误编号。
2. 读取目标代码、相邻测试、现有工具配置、相关 `REQUIREMENTS` / `SDD` / `ARCHITECTURE` / ADR 及适用的仓库 Skills；以当前分支代码为准，不把规划能力当成已实现能力。
3. 检查依赖 Catalog、锁文件、Schema/迁移、Vue/React 共享契约、浏览器与工业安全边界；只作最小必要变更。
4. 写测试时先核对本仓库 Vitest、TypeScript 6、Vite+、Prisma 和浏览器 CDP 的实际约束；错误/日志/测试名称/注释使用简体中文。
5. 修改后执行对应的 `vp check`、`pnpm run test:unit`、`pnpm run docs:check`、`pnpm run ready` 等检查；**只有真实运行结果及退出码才能标记“通过”**。需要本机 Windows、隔离数据库或浏览器时明确标记“待维护者执行”。
6. 本次如出现新错误，先定位最小根因，修复并复验，然后在本文件增加案例；同步 `VALIDATION.md` / `PROJECT_CONTEXT.md`。禁止为了让测试通过而降低既有质量或安全断言。

## 二、已经发生过的错误

### E-001 · Dexie 逻辑版本误当成原生 IndexedDB 版本（第三十二批）

- **现象**：历史草稿浏览器测试中 `VersionError: The requested version (1) is less than the existing version (10).`。
- **原因**：把 Dexie `database.version(1)` 误当成原生 IndexedDB 版本，直接执行 `indexedDB.open(name, 1)`；实际数据库原生版本为 10。
- **避免**：不要向原生 `indexedDB.open` 传 Dexie 的逻辑版本；先由真实 Dexie 仓储初始化数据库，确认现有 stores 后以不带版本的 `indexedDB.open(name)` 访问测试数据。不得为使测试通过而修改线上 IndexedDB Schema。
- **验证**：React/Vue 两端真实浏览器旧草稿迁移、revision 推进和恢复，`pnpm run test:legacy:browser`。
- **证据**：[ADR-0064](adr/0064-legacy-browser-migration-validation.md)、PR #54、`docs/VALIDATION.md`。

### E-002 · CDP 注入函数引用 Node 作用域 helper（第三十二批）

- **现象**：旧 Project Snapshot 注入阶段 `ReferenceError: stableLegacyValue is not defined`。
- **原因**：`evaluateStudioPage` 通过 `action.toString()` 仅序列化当前函数，浏览器没有 Node 模块的词法闭包。
- **避免**：所有要在页面执行的函数必须自包含；只引用入参、函数内 helper 和真实浏览器 API。涉及快照 SHA-256 的递归对象键排序必须与 Core 的规范化算法一致。
- **验证**：真实浏览器旧快照校验、只读迁移、历史原摘要与原数据未被改写，`pnpm run test:legacy:browser`。
- **证据**：[ADR-0064](adr/0064-legacy-browser-migration-validation.md)、PR #54。

### E-003 · 忽视 Vite+ / Vitest 当前 Lint 规则（第三十三批）

- **现象**：`vp check --fix` 出现 7 条警告：五处无参数 `toThrow()`、一处 `catch` 分支内的条件式 `expect`、一处字符串 `[...raw]` 展开。
- **原因**：初稿未遵守 `vitest(require-to-throw-message)`、`vitest(no-conditional-expect)`、`typescript(no-misused-spread)`。
- **避免**：`toThrow()` 必须包含准确中文错误消息或受控正则；断言不应藏在条件分支中；检查控制字符时使用索引遍历与 `charCodeAt()`，而不是为字符串展开引入多余警告。
- **验证**：`vp check` 必须零警告、零错误；执行相关单测及 `pnpm run test:unit`。
- **证据**：PR #55、`apps/server/src/config/oidc-startup.config.spec.ts`、`docs/VALIDATION.md`。

### E-004 · PostgreSQL 中文注释 SQL 排版与既有测试契约不符（第三十三批）

- **现象**：`prisma-schema-comments.spec.ts` 失败，`TypeError: .toMatch() expects to receive a string, but got object`；首轮仅 447/448 单测通过。
- **原因**：新迁移的部分 `COMMENT ON TABLE/COLUMN/INDEX` 把 `IS` 与中文说明换到下一行；仓库已有测试按**单行** `COMMENT ON ... IS '中文';` 查找，导致未匹配而返回 `null`。
- **避免**：每条真实 PostgreSQL 注释必须写成一行 `COMMENT ON ... IS '中文说明';`；每个业务表/物理字段保留中文注释，常用索引也要有中文注释；先阅读 `apps/server/src/database/prisma-schema-comments.spec.ts`，不能通过弱化测试掩盖问题。**已应用的迁移严禁回改；只有未应用的新迁移可在提交前调整。**
- **验证**：`pnpm run test:unit` 中 Prisma 注释检查 2/2 与全量单测通过；实际 SQL 仍需在隔离 PostgreSQL 测试库核对元数据。
- **证据**：PR #55、`docs/VALIDATION.md`。

### E-005 · Vitest Mock 函数缺少类型参数（第三十二批之前）

- **现象**：`vitest(require-mock-type-parameters)` 提示 `vi.fn()` 缺少类型参数。
- **原因**：对有明确签名的 Mock 直接使用未泛型化的 `vi.fn()`。
- **避免**：根据真实函数签名显式写 `vi.fn<() => void>()` 或相应泛型，不使用 `any` 绕过类型限制。
- **验证**：`vp check` 和相应单测。
- **证据**：维护者 Windows `vp check --fix` 报错记录（2026-11-13），`apps/server/src/demo/local-demo-telemetry.controller.spec.ts`。

### E-006 · TypeScript 6 与单测/入口声明约束在初次集成时遗漏（V0.1）

- **现象**：初次 `vp check` 遇到 `erasableSyntaxOnly`、React CSS / Vue SFC 声明、Node 类型及 Vitest 断言规则等问题。
- **原因**：按通用 TypeScript 写法直接实施，没有先核对本仓库 TS6、根 Vite+ 共享配置及测试规则。
- **避免**：避免不支持的参数属性简写；使用仓库已有 CSS/Vue 声明、TSConfig、根工具配置和 Vitest 显式 `expect`；不要为单个子项目复制一套格式/Lint 配置。
- **验证**：`vp check`、`pnpm run typecheck:web`、`pnpm run typecheck:server`、`pnpm run ready`。
- **证据**：`docs/HARNESS.md`「工具链初次集成反馈」。

### E-007 · 把 Vite 开发代理当成桌面发布能力（V0.1）

- **现象**：Vue MSI 安装版读取 `/demo/project` 时得到 HTML，JSON 解析报 `Unexpected token '<'`。
- **原因**：开发环境的 Vite 代理不会自动出现在 Tauri 发布包中。
- **避免**：桌面模式显式使用已定义的离线模拟或受控正式服务地址；解析 JSON 前验证状态码和 `Content-Type`；`SIMULATION` 必须明确标识，数据中断不得伪装成 `GOOD`。
- **验证**：React/Vue **安装版**分别启动，演练离线、`STALE → GOOD` 恢复，不以开发服务器测试代替 MSI 安装测试。
- **证据**：`docs/HARNESS.md`「MSI 安装后的 HTML/JSON 数据源问题与回归测试」。

### E-008 · 将部分构建成功误写成全链通过（V0.1 和后续批次）

- **现象**：Tauri MSI 已输出，但 NSIS 工具下载 HTTP 504，原打包命令整体失败；部分 `ready` 日志只显示最后 Prisma Client 生成，还缺最终退出码。
- **原因**：把子步骤的成功或截断日志误认为整条命令成功。
- **避免**：区分单步成功、完整命令退出码、用户人工运行验收和生产/现场验收；`vp check --fix` 出现警告不是零警告通过；最后必须检查 `$LASTEXITCODE`。未提供最后一段日志时写“待确认”。
- **验证**：Windows 查看 `Write-Host "退出码：$LASTEXITCODE"`；桌面打包优先使用明确的 MSI 专用命令与安装运行验收。
- **证据**：`docs/HARNESS.md`「Windows Tauri Release 打包记录」、`docs/VALIDATION.md`。

### E-009 · 测试环境与真实运行上下文的初始化边界未核对（第三十二批）

- **现象**：旧浏览器迁移测试起初在 Dexie 数据库尚未由 Studio 初始化时直接写库；随后历史快照列表刷新需要明确控制菜单打开/关闭状态。
- **原因**：测试夹具把浏览器存储初始化、业务仓储、UI 刷新当成同一个同步操作。
- **避免**：先通过真实业务入口初始化存储，等待状态稳定，再注入隔离数据；恢复/版本菜单必须经过实际 UI 刷新，不能只靠修改 IndexedDB 后立即检查 DOM。
- **验证**：独立浏览器 Profile、React/Vue 双 Origin 的完整旧数据迁移与恢复。
- **证据**：PR #54、[ADR-0064](adr/0064-legacy-browser-migration-validation.md)。

### E-010 · 使用控制字符正则触发 ESLint no-control-regex（第三十三批阶段 B）

- **现象**：维护者 Windows 执行 `vp check --fix` 时，`oidc-login-transaction.service.ts` 的回跳路径校验触发 `eslint(no-control-regex)` 警告。
- **原因**：为了拒绝 URL 中的 ASCII 控制字符，直接使用包含 U+0000 至 U+001F、U+007F 的正则表达式；该规则会将此类正则判为需要人工审查。
- **避免**：对字符串逐字符调用 `charCodeAt()`，检查小于 32 或等于 127 的码元；不要关闭 ESLint 规则，也不要删除控制字符校验。测试应覆盖原始换行、NUL、DEL 与百分号编码的 CR/LF。
- **验证**：`vp check` 必须零警告、零错误；运行 OIDC 登录事务单测，确认原始控制字符和编码控制字符均被拒绝。
- **证据**：维护者 2026-11-14 Windows `vp check --fix` 日志；`apps/server/src/auth/oidc-login-transaction.service.ts`。

### E-011 · Mock 记录类型手工收窄第三方函数参数类型（第三十三批阶段 B）

- **现象**：维护者 Windows 执行 `vp check --fix` 时，`apps/server/src/auth/oidc-callback.service.spec.ts` 第 193 行触发 TS2322：`string | symbol | undefined` 不能赋值给 `string | undefined`。
- **原因**：Mock 调用记录类型 `GrantCall.checks.expectedState` 被手工写成 `string`，但 `openid-client@6.8.9` 的 `authorizationCodeGrant` 第三个参数中，`expectedState` 还允许 `skipStateCheck` 对应的 Symbol。生产代码传入普通 State 字符串没有问题，错误来自测试夹具自行缩窄了第三方 API 的类型。
- **避免**：Mock 参数记录、包装器和测试夹具应从被 Mock 的真实函数签名派生类型，不要凭当前调用值手写更窄的类型。对于可选参数，使用 `NonNullable<Parameters<typeof 函数>[参数索引]>["字段"]` 获取字段类型；不要使用 `as string`、`any` 或修改第三方声明绕过错误。
- **验证**：维护者 Windows 最新日志确认 `vp check`：286 个文件格式正确，146 个受检文件零警告/Lint/TypeScript 错误；`pnpm run test:unit`：43/43 文件、477/477 测试通过，其中 OIDC 回调 12/12；`pnpm run docs:check`：83 个 Markdown 通过；完整 `pnpm run ready` 最终退出码 **0**。
- **证据**：PR #55，`apps/server/src/auth/oidc-callback.service.spec.ts` 的 `OidcExpectedState` 类型别名，维护者 2026-11-14 Windows 验收日志。

### E-012 · Supertest Cookie 响应类型与 HTTP 测试断言未核对（第三十三批阶段 B）

- **现象**：维护者 Windows 执行 `vp check --fix` 时，OIDC Controller E2E 报 `vitest(expect-expect)`（401 测试只有 Supertest `.expect(401)`，没有 Vitest `expect` 断言）；`TS2339`（`response.headers["set-cookie"]` 在当前 Supertest 类型中是 `string`，不能调用 `.join()`）；数据库模块测试还报告 `ScadaAuthController` 导入未使用。
- **原因**：测试只依赖 Supertest 链式状态断言，未满足仓库 `expect-expect` 规则；将 Set-Cookie 头误认为始终是数组，没有核对当前依赖声明；此前自动修改模块测试时加入了 Controller 导入，却没有成功插入对应的模块元数据断言。
- **避免**：HTTP 状态测试在 `.expect(status)` 之外显式断言 `response.status` 或响应契约；按当前 Supertest 类型处理响应头，Set-Cookie 读取函数兼容字符串和数组，合并字符串只在受控 Cookie 名称前拆分，不能按逗号直接切分（Expires 自带逗号）；新增导入后确认其在实际断言中使用。
- **验证**：维护者 2026-11-14 Windows 复验已通过：`vp check` 291 个文件格式正确、151 个受检文件零警告/Lint/TypeScript 错误；`test:unit` 45/45 文件、494/494 测试；`test:e2e:server` 4/4 文件、26/26 测试，其中 OIDC Controller E2E 9/9；`docs:check` 83 个 Markdown；完整 `ready` 最终退出码 0。
- **证据**：维护者 2026-11-14 Windows `vp check --fix` 日志；PR #55 `oidc-auth.controller.e2e-spec.ts` 与 `database.module.spec.ts`。

### E-013 · NestJS 启动入口 Promise.catch 缺失闭合括号（第三十三批第六小批）

- **现象**：维护者 2026-11-16 在 Windows 执行 `vp check --fix`，格式化阶段报 `Expected ) but found EOF`，定位到 `apps/server/src/main.ts:73:1`，导致整批格式检查无法继续。
- **原因**：AI 修改 HTTP 启动入口后，将 `void bootstrap().catch((error: unknown) => { ... });` 的结尾误写为单独 `}`，漏掉关闭 `.catch(...)` 的 `);`；此前只检查静态导入路径，没有先解析整个 TypeScript 文件就推送候选提交。
- **避免**：对修改过的 TS/JS 文件至少执行语法解析，再执行仓库真实 `vp check`；静态检查相对导入、Git Blob 创建成功或 `git diff --check` 都不能代替语法检查。启动入口闭合函数后必须核对外层回调与调用表达式的括号。
- **验证**：已将末行修为 `});`。本次重建的完整文件 `git hash-object` 与 GitHub 新 Blob SHA `f7b575a927d51311c8a40d5688109e9ec7654e3b` 一致，容器中 TypeScript 5.8.3 语法解析为 **0 个错误**。2026-11-16 维护者 Windows 已完成回归：`vp check` 297 文件/157 受检零警告错误，`test:unit` 46 文件/505 项、`test:e2e:server` 5 文件/40 项全部通过（工程 API 单测 10/10、HTTP E2E 13/13），完整 `pnpm run ready` 退出码 0。**仅完成工程质量链验证；真实 PostgreSQL `test:db` 尚未执行。**
- **证据**：维护者 2026-11-16 Windows 原始报错、PR #55、`apps/server/src/main.ts`、`docs/VALIDATION.md`。

### E-014 · Node.js 内置测试注册 Promise 未显式处理（第三十三批空库迁移专项）

- **现象**：维护者 2026-11-16 在 Windows 执行 `vp check --fix`，`scripts/verify-fresh-postgres-migrations.cases.mjs` 的一处 `describe()` 与六处 `it()` 触发 `typescript(no-floating-promises)`，合计 7 条警告；格式化阶段成功但代码检查未达到零警告要求。
- **原因**：新增脚本采用 Node.js 内置 `node:test`，其测试注册函数返回 `Promise<void>`，初稿按旧式同步测试调用方式直接调用，没有核对本仓库 Vite+ 的 Promise 处理规则。
- **避免**：编写 `node:test` 测试时，若由 Node 测试运行器负责执行与报告失败，测试注册语句应显式使用 `void describe(...)` 与 `void it(...)`；不能通过关闭 `no-floating-promises`、删除断言或放宽数据库安全约束消除警告。新测试文件提交前必须执行仓库真实 `vp check`。
- **修复**：仅在现有七个调用表达式前添加 `void`，保留六个断言用例、数据库目标名称/地址/端口/Schema 校验及全部测试条件。
- **验证**：维护者的原始日志只确认 **7 条警告，格式化完成**；维护者 2026-11-16 Windows 复验已通过：`node --test scripts/verify-fresh-postgres-migrations.cases.mjs` 6/6；`vp check` 299 个文件格式正确，159 个受检文件零警告/错误；`pnpm run docs:check` 83 个 Markdown 通过；`pnpm run ready` 505/505 单元测试、40/40 HTTP E2E、SSE 8/8、故障代理 4/4、React/Vue/NestJS 构建成功，最终退出码 **0**。**E-014 已关闭；真实全新空库迁移与二次部署尚未执行**。
- **证据**：维护者 2026-11-16 Windows `vp check --fix` 输出、PR #55、本文件与 `docs/VALIDATION.md`。

### E-015 · Windows 子进程使用 shell: true 触发 DEP0190（第三十三批空库迁移验收）

- **现象**：维护者 2026-11-16 在本机全新隔离库 `adui_scada_fresh_20261116` 首次部署四项迁移时，Node.js 输出 `[DEP0190] Passing args to a child process with shell option true` 安全弃用警告；首次及重复部署最终仍成功，退出码 0。
- **原因**：`scripts/verify-fresh-postgres-migrations.mjs` 在 Windows 使用 `spawnSync("pnpm.cmd", [...], { shell: true })`，Node.js 会将参数交给 shell 重新解析，存在潜在命令行注入风险；虽然本脚本目前只传固定命令，但不应保留此调用方式。
- **避免**：从当前服务端依赖解析已安装的 Prisma CLI 入口，用 `spawnSync(process.execPath, [prismaCli, "migrate", 固定动作, "--config", "prisma.config.ts"], { cwd: server, shell: false })`（实际省略 shell 选项）直接启动。只允许 `deploy` 和 `status` 两种动作，不引入 `cmd.exe`、字符串拼接执行、浮动版本依赖或破坏性迁移命令。
- **修复与验证**：已准备去除 shell 的最小改动；当前协作容器 Node.js 22 下脚本语法检查通过，原有数据库连接保护测试 6/6 通过，并以模拟 Prisma CLI 验证了 Node 直接启动参数及环境传递（退出码 0）。**已在 Windows 用真实 Prisma 7.10.1 完成复验**：修复后保护测试 6/6、`vp check` 299 个格式文件/159 受检零警告错误、`docs:check` 83 Markdown、`ready` 505/505 单测、40/40 HTTP E2E，退出码 0；维护者另建全新空库 `adui_scada_fresh_20261116_b`，首次应用全部四项迁移、二次部署无待执行项、`migrate status` 最新、元数据一致，脚本退出码 0，**未再出现 DEP0190**。E-015 已完成 Windows 真实进程专项验收。两座空库均保留，不重置、不删除。
- **证据**：维护者 2026-11-16 PowerShell 迁移日志、PR #55、`scripts/verify-fresh-postgres-migrations.mjs`、`docs/VALIDATION.md`。

### E-016 · Vitest Mock 被接口宽化导致 unbound-method 警告（第三十三批第八小批）

- **现象**：2026-11-16 维护者在 Windows 执行 `vp check --fix`，`packages/api-client/test/studio-session.test.ts` 的 `vi.mocked(api.getProject)`、`expect(api.getMe)`、`expect(api.appendVersion)` 等共触发 **19 条 `typescript(unbound-method)` 警告**；受检 163 个文件零错误，但不是零警告通过。
- **原因**：测试夹具把由 `vi.fn<ScadaApiClient["方法"]>()` 构造的 Mock 对象显式注解为 `const client: ScadaApiClient`，返回值丢失每个属性的 Vitest Mock 类型，变成可能依赖 `this` 的普通接口方法；解引用并传入其他函数时触发 unbound-method。
- **避免**：对于需要继续配置 `mockResolvedValue`、`mockRejectedValueOnce` 或传给 `expect` 的测试夹具，使用 `const client = { ... } satisfies ScadaApiClient` 保留推断的 Mock 属性类型，并直接调用 `api.方法.mock*()`；保持 `vi.fn<真实函数类型>` 泛型。不要把整个 Mock 对象用接口注解宽化，不要为消除测试告警去修改正式 API 签名、禁用规则或删除断言。
- **修复候选**：仅调整 `packages/api-client/test/studio-session.test.ts` 的 `mockClient` 类型表达及 6 处 `vi.mocked` 调用，保留 **9 项测试、29 处 expect 调用**和所有身份、CAS、草稿保护断言。正式 API Client、React/Vue、IndexedDB 与 Prisma 均不改。
- **验证**：上述 19 条警告与格式化完成来自维护者 Windows **修复前**日志。修复候选已在 GitHub Blob 中做文本和断言数量检查；**2026-11-16 已由维护者 Windows 实测关闭**：`vp check --fix` 163 个受检文件零警告错误，完整 `ready` 中 305 个文件格式正确、163 个受检文件零警告错误；`test:unit` 共 48/48 文件、529/529 项通过（新增会话测试 9/9），NestJS HTTP E2E 40/40、SSE 8/8、故障代理 4/4、React/Vue/NestJS 构建完成，完整 `ready` 最终退出码 0；React 与 Vue 分别在 1440×900、1024×768 完成 19/19 浏览器回归，`test:versions:safety` 的草稿取消/确认、跨刷新持久化与跨 Origin 保护通过。**E-016 已关闭；真实 IdP、HTTPS Cookie 及服务端双框架端到端仍未验收。**
- **证据**：维护者 2026-11-16 上传的 `vp check --fix` 日志、PR #55、`packages/api-client/test/studio-session.test.ts` 与 `docs/VALIDATION.md`。

### E-017 · HTTPS 实际探针吞没失败类别，无法指导本机联调（第三十三批第十小批）

- **现象**：2026-11-16 维护者 Windows `pnpm run test:oidc:https:readonly` 9/9、`vp check` 310/168 零警告、完整 `ready` 529/529 单测及 40/40 HTTP E2E、退出码 0；紧接着单独执行 `pnpm run verify:oidc:https:readonly` 失败，退出码 **1**，仅显示一条泛化提示，无法判断是联调开关、服务未启动、证书链还是 HTTP 契约问题。**实际网络失败的根因尚未确定**，不能将此结果标为 TLS/IdP 通过。
- **代码原因**：`scripts/verify-oidc-https-readonly.mjs` 的 CLI 入口使用无参数 `catch`，将所有配置验证、TLS/网络错误与响应断言合并成同一句输出；这是诊断信息不足，不是可以降低安全检查的理由。
- **避免**：只允许固定中文配置断言和白名单中的 Node 网络/TLS 错误码映射为可公开的诊断；对未知异常返回固定通用提示，禁止直接输出 `error.message`、异常堆栈、证书路径、Cookie、Token、IdP 凭据和请求细节。不放宽可信 TLS、OIDC 开关、固定 Origin、匿名 401 JSON 及只读边界。
- **修复与验证**：新增 `describeReadonlyProbeFailure` 及两项安全测试，覆盖原始敏感错误脱敏、缺失开关、证书 SAN/证书链、端口未监听和未知错误。协作环境 Node.js 22 执行脚本语法检查和离线单测 **11/11 通过**；使用未配置 OIDC 的环境执行实际命令，返回受控缺少开关提示与退出码 **1**。**2026-11-16 Windows 最新日志**：`vp check` 315/171 零警告、完整 `ready` 530/530 单测且质量链完成，探针离线 11/11；在 NestJS 根模块注入修复后，真实 HTTPS 匿名路径从两个 Web Origin 均返回 401 JSON、退出码 **0**，诊断与联调专项完成。**E-017 已关闭**；实际 IdP 登录、Cookie/CSRF 和服务端工程互通仍待专项验证。
- **证据**：维护者 2026-11-16 Windows 第十小批完整日志、PR #55、`scripts/verify-oidc-https-readonly.mjs` 与其 `cases.mjs`、`docs/VALIDATION.md`。

### E-018 · NestJS OIDC 真实根模块启动时工程 Guard 跨模块依赖缺失（第三十三批真实联调）

- **现象**：维护者 2026-11-16 在本机 Keycloak 26.8.2 OIDC Discovery 成功、独立 PostgreSQL Lab 四项 Prisma 迁移成功后，运行 `dev:server` 的 TypeScript Watch 编译通过，但 NestJS `OidcEnabledAppModule` 初始化在 `ProjectApiModule` 上抛出 `UnknownDependenciesException`：`ScadaSessionGuard` 的第二项依赖 `ScadaSecurityAuditService` 无法解析。React HTTPS 已监听 15173，但 API Vite 代理访问 NestJS 13001 出现 `ECONNREFUSED`，真实匿名 401 探针因此失败。用户曾在日志中粘贴本机测试凭据；任何文档/PR/测试均不得复制其值，需后续受控轮换。
- **根因**：`ScadaIdentityModule` 将 `ScadaSessionGuard` 与 `ScadaProjectGuard` 导出给 `ProjectApiModule`，但未同时导出 Guard 在工程 Controller 装饰器上下文中所需的 `ScadaSecurityAuditService`、`SCADA_OIDC_STARTUP_CONFIG` 与共享 `DatabaseModule`。此前 HTTP E2E 以局部 TestingModule 独立注册 Mock Guard 依赖，没有编译真实 `OidcEnabledAppModule` 的跨模块图，无法捕获该启动缺陷。
- **修复**：只补充 `ScadaIdentityModule.exports` 中上述三个依赖的显式导出，保持身份模块只在 OIDC 显式启用的根模块中加载，沿用原数据库单例及现有 CSRF/ACL 拒绝逻辑；不设置 `@Global()`、不在工程模块创建第二份 Guard 或审计服务、不修改数据库与生产环境。新增静态导出契约单测和使用真实 OIDC 根模块装配、Mock Prisma/测试 OIDC 配置的 E2E，检查未登录身份及工程路由必须返回 401 JSON。
- **验证与关闭**：维护者 2026-11-16 Windows 实测 `test:e2e:server` **6/6 文件、42/42 项**（新增真实根模块装配 2/2）、`vp check` **315 格式文件/171 受检零警告**、`ready` **530/530 单测**且完整质量链已执行；真实 NestJS OIDC 根模块成功启动、`127.0.0.1:13001` 在监听，React/Vue 两端 HTTPS 匿名 `401 JSON` 专项 **退出码 0**。**E-018 已关闭**。未独立提供本地 HEAD 和 `ready` 数值退出码，亦未证明 Keycloak 完整用户登录、Secure Cookie/CSRF 或工程历史/CAS 互通；这些继续待验收。
- **证据**：维护者 2026-11-16 Windows NestJS `UnknownDependenciesException` 与 Vite `ECONNREFUSED` 原始日志、PR #55、`apps/server/src/auth/scada-identity.module.ts`、`apps/server/src/database/database.module.spec.ts`、`apps/server/test/oidc-module-bootstrap.e2e-spec.ts`。

### E-019 · ADR 状态混入验收说明导致文档门禁失败（第三十三批 Docker 单栈）

- **现象**：2026-11-16 维护者在 Windows 执行 `pnpm run docs:check`，报告 `ADR 状态无效：0066-single-local-compose-project.md`，退出码 1；同次 `pnpm run ready` 在文档检查阶段中止。此前 `test:docker` 17/17、`vp check` 318 个格式文件/175 个受检零告警、单测 530/530、NestJS E2E 42/42 均已通过，但不能宣称完整 `ready` 通过。
- **原因**：ADR-0066 写成 `- 状态：Proposed（Windows 实际切换待验收）`，而仓库 `scripts/validate-docs.mjs` 只接受严格的单行枚举值 `Proposed|Accepted|Rejected|Superseded|Deprecated`；额外中文括号说明使状态不匹配。
- **修复**：仅将状态拆分为 `- 状态：Proposed` 和独立 `- 验收：Windows 实际切换待执行`，不放宽或修改文档校验器，不改 Docker、OIDC、数据库或测试逻辑。
- **避免**：新增或修改 ADR 前检查 `scripts/validate-docs.mjs` 的状态枚举契约；业务状态和详细验收进度分行记录，提交前运行 `pnpm run docs:check`，并在 `ready` 执行到末尾后才报告其通过。
- **验证**：已对修复候选应用仓库相同的 ADR 状态正则进行静态核对；Windows `pnpm run docs:check`、`vp check` 与完整 `pnpm run ready` **修复后尚待维护者复验**。真实 Docker 项目迁移、数据备份与回归未因本次文档修复执行。
- **证据**：维护者 2026-11-16 Windows 验收日志、PR #55、`docs/adr/0066-single-local-compose-project.md`、`scripts/validate-docs.mjs`、`docs/VALIDATION.md`。

### E-020 · 把已删除的 Docker 历史卷当作必须存在，阻断全新安装

- **现象**：维护者已删除原 Demo、独立 PostgreSQL 与 OIDC Lab 三组 Docker 项目，随后确认连全部历史数据卷也已删除、没有数据库备份；而此前生成的单 Compose 仍通过 `external: true` 强制引用 `adui-scada-oidc-lab_*` 历史卷，并要求 `docker:migrate`。这种配置会在不存在历史卷时拒绝启动，不符合“只保留一个全新 adui-scada”需求。
- **根因**：只根据先前“保护已有身份数据”的上下文推断旧卷仍存在，没有及时根据维护者最新确认的实际状态收敛部署目标，同时 `.env.example` 中库名和端口存在与最新环境契约不一致的风险。
- **修复**：统一唯一 `deploy/docker/compose.yaml`，取消历史外部卷与 `docker:migrate`，由 Docker 创建新的 `adui-scada_postgres-data` / `adui-scada_redis-data`。业务库、账号统一 `adui_scada`，Keycloak 在同一 PostgreSQL 上创建独立逻辑库。根 `.env.example` 与校验脚本同步，随机密码保存在 Git 忽略目录；`docker:up` 首次启动后执行 Prisma `migrate deploy`，不触碰历史数据或生产环境。
- **避免**：部署方案必须先确认“全新安装、原位升级、数据库恢复”三种状态，不得将历史数据卷存在视为事实。检查 Compose 卷的 `external`、名称、端口及秘密文件生命周期，并验证复制默认 `.env.example` 就能启动。用户明确删除数据并无备份时，不得声称历史用户、工程或会话可以自动恢复。
- **验证**：新增单项目/新卷/数据库命名/Prisma 迁移连接保护离线测试；提交后的 Windows `test:docker`、`test:docker:db`、`env:check`、`ready` 及真实 Docker 首次启动均须维护者验收，尚未完成。
- **证据**：维护者最新 Docker Desktop 截图与“全部数据卷已删除、无备份”说明、PR #55、ADR-0066 与 `docs/VALIDATION.md`。

### E-021 · Docker 随机数据库密码与根 .env 旧密码混用导致 Prisma P1000

- **现象**：2026-11-16 维护者本机 Docker `postgres:17-alpine` 在 `127.0.0.1:15432` 正常运行，`pnpm run docker:db:init` 使用随机本机凭据实际完成全部 4 项 Prisma 迁移，退出码 0；但随后运行通用 `pnpm run db:migrate:status` 报 P1000 密码认证失败。容器内 `pg_isready` 和 Unix Socket `SELECT 1` 正常，并不能证明宿主机 TCP 密码一致。
- **根因**：Docker 初始化脚本从 `.local/docker/secrets.env` 读取首次生成的强随机数据库密码，而通用 `db:migrate:status` 经 `apps/server/prisma.config.ts` 从根目录 `.env` 读取历史手工密码和 URL。两套独立配置被误认为相同。维护者的 `.env` 同时包含上一环境的 OIDC Client Secret、事务密钥和旧证书路径；这些不应直接用于全新 Keycloak 联调。
- **修复**：为单项目 Docker 另增 `pnpm run docker:db:status`，复用 `scripts/init-docker-db.mjs` 的回环地址、随机凭据和受控 Prisma 子进程，通过唯一白名单 `--status` 执行只读 `prisma migrate status`。通用 `db:migrate:status` 不改动，以免影响外部受控数据库工作流；不自动修改 `.env`、密码、Keycloak、已有数据或 Prisma 迁移。
- **避免**：每个 Docker 本机数据库命令必须明确同一凭据来源；不要把容器内 Peer/Unix Socket 查询当作宿主 TCP 密码验证。新环境启用 NestJS OIDC 前，在本机核对并安全同步真实密码、Client Secret、证书路径和用户身份绑定；不复制旧密钥到仓库，也不以静态固定密码代替随机凭据。配置发生真实暴露时必须受控轮换。
- **验证**：维护者原 `docker:db:init`、`pg_isready`、`SELECT 1` 已实测通过；新增命令及防回归测试为代码候选。提交后 Windows `pnpm run test:docker:db`、`env:check`、`vp check`、`docs:check`、`ready` 与新 `docker:db:status` **尚待复验**，不得声称新命令已经连接成功。
- **证据**：维护者 2026-11-16 原始 P1000/Prisma 迁移/容器查询日志、PR #55、`scripts/init-docker-db.mjs`、`docs/VALIDATION.md`。

### E-022 · Docker 数据库状态命令的条件日志触发中文文案门禁（第三十三批）

- **现象**：2026-11-16 维护者 Windows 真实执行 `pnpm run test:docker:db` **9/9 通过**，`pnpm run docker:db:status` 成功检查 `127.0.0.1:15432/adui_scada` 的四项迁移为最新；`vp check` 320 个格式文件、177 个受检文件零告警；`docs:check` 84 个 Markdown 通过。但完整 `pnpm run ready` 在 `messages:check` 阶段报 `scripts/init-docker-db.mjs:104：日志文案缺少中文`，整体退出码 1，后续质量步骤尚未执行。
- **根因**：新增 CLI 使用 `console.log(action === "status" ? inspectDockerDatabase() : initializeDockerDatabase())`；虽然两个函数返回的日志文本都为中文，仓库 `scripts/check-chinese-messages.mjs` 仍按单行正则检测到 `console.log` 和英文字符串 `"status"`，且这一行没有中文，于是标记失败。此前只执行 `vp check`、Node 测试和数据库状态查询，没有在提交前单独执行仓库的 `messages:check`。
- **修复**：仅将分支计算与日志调用拆成两行，先计算 `result` 再 `console.log(result)`。输出内容、命令白名单、随机凭据及数据库操作完全不变；不放宽中文扫描规则。
- **避免**：新增日志即使输出来自中文结果函数，也要检查 `console` 调用所在行是否同时含英文协议字面量；优先分离计算与输出。每次添加脚本日志后必须先执行 `pnpm run messages:check`，再执行完整 `ready`，不以 `vp check` 或单元测试代替。
- **验证**：修复候选已按仓库原有单行扫描正则进行静态检查，未发现该文件触发相同规则的日志。**修复后的 Windows `messages:check`、`vp check`、`docs:check` 和完整 `ready` 尚待维护者重新执行**，不能宣称最终质量链已通过。
- **证据**：维护者 Windows 原始 `ready` 失败日志、PR #55、`scripts/init-docker-db.mjs`、`scripts/check-chinese-messages.mjs`、`docs/VALIDATION.md`。

### E-023 · OIDC 配置保护测试与共享校验的中文异常文案不一致（第三十四批第三小批）

- **现象**：维护者 2026-11-16 在 Windows 执行 `pnpm run test:projects:oidc:config`，7 项中 6 项通过、1 项失败；`ready` 在相同测试处退出码 1。失败信息明确显示 `assert.throws` 的期望正则是 `/必须显式启用可信 OIDC 开发代理/`，但共享 `resolveReadonlyProbeOrigins` 实际抛出“只读 HTTPS 探针要求显式启用可信 OIDC 开发代理”。
- **根因**：新增浏览器环境测试自行编写错误文案断言，没有以已存在且复用的 `scripts/verify-oidc-https-readonly.mjs` 为准；共享安全校验已经正确拒绝 `SCADA_OIDC_ENABLED=false`，失败只来自断言文本不匹配。
- **修复候选**：只调整 `scripts/test-project-browser-oidc.cases.mjs` 中这一处 `assert.throws` 正则，匹配共享校验已有的完整中文文案。保留测试用例数、其他全部拒绝断言和真实安全校验逻辑，不修改 OIDC/TLS/数据库白名单或任何业务代码。
- **避免**：测试复用共享验证函数时，先核对其当前抛错契约，不自行把“要求”改写为“必须”等近义词；涉及固定错误文案的检查应同时核对正反两种配置路径，并执行离线测试后再报告 `ready` 状态。
- **验证**：维护者修复前原始日志确认 `vp check` 328 格式文件、183 受检零警告，544/544 单测通过，新增 OIDC 离线检查 6/7；`ready` 退出码 1，其后的 HTTP E2E、文档与构建阶段未运行。**修复后的 Windows `test:projects:oidc:config`、`vp check`、`docs:check` 与完整 `ready` 尚待重新验收，不得标为已通过**。
- **证据**：维护者 2026-11-16 Windows 原始验收日志、PR #58、`scripts/test-project-browser-oidc.cases.mjs`、`scripts/verify-oidc-https-readonly.mjs` 及 `docs/VALIDATION.md`。

### E-024 · 真实 OIDC 登录后浏览器阶段异常被统一脱敏而不可定位（第三十四批第三小批）

- **现象**：维护者在 Windows 执行交互式 `pnpm run test:projects:oidc:browser`，真实 Keycloak 登录后出现“真实 OIDC 会话已在 React Origin 验证”，紧接着报告“浏览器页面操作失败，请检查当前 Studio 状态”，退出码 **1**；浏览器窗口被测试的 `finally` 关闭，未进入 Vue 验收。
- **已确认原因**：`ChromeSession.evaluate` 对所有 CDP `Runtime.evaluate.exceptionDetails` 都转换为同一个固定字符串，并且 `projectsInPage` 对任何非 2xx HTTP 直接抛出页面内部错误，终端既看不到所处测试阶段，也不能判断是否是工程列表的 401/403/404。**真实页面抛出的具体异常仍待新诊断日志确认**，不能猜测为认证失败、数据库故障或工程 ACL 问题。
- **修复候选**：继续在失败后清理隔离临时浏览器 Profile，不保持含有有效 Cookie 的调试窗口；对 CDP 错误只识别已知固定中文页面异常或 JavaScript 错误**类别**（不转发异常原文/堆栈/URL），对列表 HTTP 只返回状态数字；React/Vue 分别输出静态步骤标记，缺少授权工程时显示固定可执行提示。增加离线测试确保未知错误、私密 Cookie 与 Token 不会出现在诊断中。
- **避免**：新建需要真实登录的浏览器验收脚本时，必须在每个外部请求、页面导航和核心断言阶段提供可定位但脱敏的诊断；用户身份成功不能推导出已授予 `project:read` 和 `version:read`。操作开始前核对隔离 Lab 的工程 ACL；不得通过输出浏览器原始异常或关闭 TLS/认证规避故障。
- **验证**：维护者此前 `test:projects:oidc:config` **7/7**、`ready` 全链 **退出码 0**，但交互式浏览器脚本**退出码 1**。本补丁的离线错误脱敏测试、`vp check`、`ready` 和双端真实 OIDC 浏览器专项**均待修复后 Windows 复验**。浏览器窗口自动关闭本身不是故障，不应修改为保留有效登录会话。
- **证据**：维护者 2026-11-16 真实 OIDC 浏览器失败日志、PR #58、`scripts/test-project-browser-oidc.mjs`、`scripts/test-project-browser-oidc.cases.mjs`、`docs/VALIDATION.md`。

### E-025 · CDP 页面快照再次引用 Node 模块作用域 helper（第三十四批第三小批）

- **现象**：维护者 Windows 完成 `test:projects:oidc:config` **10/10**、`vp check` **328 文件格式正确/183 受检零错误** 和完整 `pnpm run ready` **544/544 单测、49/49 E2E、退出码 0**。在真实 `test:projects:oidc:browser` 中 Keycloak 登录、React 工程列表/分页及其 UI 比对已完成，随后在“React：正在验证临时 IndexedDB 草稿保存与自动保存”阶段报“浏览器页面操作失败：页面脚本引用异常”，专项退出码 **1**；Vue 尚未测试。
- **已确认根因**：`ChromeSession.evaluate(action)` 只把 `action.toString()` 发送到浏览器环境；`stateInPage()` 调用了只在 Node.js 模块中定义的 `readBrowserDraftsInPage()`。浏览器执行该独立函数时查不到模块闭包中的 helper，必然触发 `ReferenceError`。这是 **E-002 跨执行上下文错误的再次发生**，不涉及 OIDC 登录、前端 IndexedDB 模型或实际授权工程数据。浏览器失败后自动关闭属于临时 Profile 安全清理。
- **修复**：将 `stateInPage` 限定为自包含的 DOM/UI 状态函数；新增 `inspectStudioState(session)`，分别通过独立 CDP `evaluate` 执行 `stateInPage` 和 `readBrowserDraftsInPage`，仅在 Node 层合并已用于断言的画布/草稿摘要。四个状态快照断言均复用该入口，不改业务 API、Schema、OAuth、TLS、数据库或页面组件。
- **避免**：使用 `function.toString()` 的 CDP 代码边界必须逐一审核函数引用，不允许引用 Node 模块 helper 或局部闭包；涉及多段页面执行时在 Node 层组合结果，并用模拟 `session.evaluate` 的单元用例检查被序列化的函数名称与独立性。
- **验证**：补充 1 项离线回归，预计离线总数由 **10 增至 11**；修复前日志显示完整质量链通过但独立浏览器专项退出码 1。**修复后的 Windows `test:projects:oidc:config`、`vp check`、完整 `ready`、真实 React/Vue OIDC 浏览器专项尚未执行，不能宣称通过**。
- **证据**：维护者 2026-11-16 浏览器专项原始日志、PR #58、`scripts/test-project-browser-oidc.mjs`、`scripts/test-project-browser-oidc.cases.mjs`、`docs/VALIDATION.md`。

### E-026 · 模拟版本冲突的旧提示被当作后续确认载入失败（第三十四批第三小批）

- **现象**：维护者 2026-11-16 Windows 完整 `ready` 再次通过：544/544 单元测试、49/49 HTTP E2E、离线工程浏览器安全检查 11/11、退出码 0。真实 OIDC 浏览器已通过 React 登录、授权工程摘要、分页、IndexedDB 草稿保存、自动保存、取消载入和模拟远端水位冲突；进入“React：正在验证确认载入与 CAS 基线”后，抛出“浏览器页面操作失败：服务器工程载入阶段返回受控错误”，退出码 1。Vue 尚未开始。
- **根因分析**：`openProjectInPage` 每次点击后立即读取 `[aria-label="服务端工程版本"] [role="alert"]`，若存在错误便直接判失败；上一步模拟冲突故意产生的“服务端工程版本已更新”仍显示在页面中，而 React/Vue 的 `runServerAction` 只会在**下一次操作开始时**异步清空错误。故这一实现存在把前次错误误判成新请求结果的竞态。**这与实际症状吻合；由于原日志没有包含确认载入请求的最终结果，不能据此断言服务端确认载入必然成功。**
- **修复**：在点击确认前记录现有错误文案；新操作开始后，只有观察到本次“正在处理工程版本”或错误内容变化，才允许将非冲突错误作为本次失败；上次残留错误不再立刻终止。成功仍必须经历真实确认提示并匹配“CAS 基线已建立”，遇到本次真实错误仍拒绝。新增 2 项离线测试，覆盖**旧错误残留后新操作成功**与**新请求确实失败时仍失败**；保留双框架和自动保存/草稿哈希原断言。
- **避免**：E2E 连续执行“预期失败 → 成功”时，应区分前一操作 UI 错误与新请求的可观察状态。先等待业务操作开始/完成，不用“页面已有错误节点”直接判定新操作失败；须有反向回归证明真正失败不会被吞没。
- **验证**：修复前维护者实测 `test:projects:oidc:config` **11/11**、`vp check` **328/183 零告警**、`docs:check` **86 Markdown**、完整 `ready` **退出码 0**，但交互式浏览器专项 **退出码 1**。本补丁离线测试预计 **13 项**；**修复后的 Windows 离线/浏览器与质量链尚未执行，不能声称已通过**。
- **证据**：2026-11-16 维护者浏览器专项日志、PR #58、`scripts/test-project-browser-oidc.mjs`、`scripts/test-project-browser-oidc.cases.mjs` 和本仓库 `StudioPage.tsx`、`StudioPage.vue` 的 `runServerAction`。

> **2026-11-17 结案补录（E-023 至 E-026）**：上述各错误段落保留发生时的原始“待复验”描述作为历史证据，并非当前仍未修复。维护者在 PR #58 的最终 Windows 验收中确认离线 OIDC 浏览器测试 **13/13**、`vp check` **328 格式文件/183 受检文件零告警**、完整 `ready` **544/544 单测、49/49 HTTP E2E、退出码 0**；React/Vue 真实 OIDC 浏览器专项分别完成身份、草稿、取消载入、模拟冲突与确认载入，退出码 **0**。PR #58 已按维护者授权 Squash 合并至 `main@d95ee4d15bec64a047c519fde7b5f98b837cca05`。有数据的第二页与真实不同主体 PostgreSQL 并发 CAS 仍待第四小批独立专项，不属于 E-023 至 E-026 的历史问题未关闭。

### E-027 · HTTP 状态码数组排序缺少数值比较器（第三十四批第五小批）

- **现象**：2026-11-17 维护者 Windows 执行 `vp check --fix`，`apps/server/test/projects-cas-cookie-http.db-spec.ts` 新增的双 Cookie HTTP CAS 测试断言触发 `typescript(require-array-sort-compare)`；当次 184 个受检文件 **0 错误 / 1 警告**，格式化虽完成但不能视为零警告通过。
- **根因**：新增断言直接调用 `responses.map((response) => response.status).sort()`，省略了数值比较函数；JavaScript 默认的 `sort()` 基于字符串排序规则，且不符合仓库现有 TypeScript Lint 约束。这里测试预期是两个 HTTP 数值状态码恰好为 201 与 409。
- **修复**：仅在该断言中使用 `.sort((left, right) => left - right)`，不更改两个会话、CSRF、ACL、CAS、数据库和审计的测试语义。保留明确的 `expect(...).toEqual([201, 409])` 与成功/失败请求的独立断言。
- **避免**：数组为数值型状态码、修订号或时间戳时，在新增测试和业务代码中使用显式比较器；提交前先运行无 `--fix` 的 `vp check` 并确认零警告，再执行真实 HTTP/数据库回归，不把“自动格式化完成”当作 Lint 通过。
- **验证**：维护者在修复后提供的 Windows 日志确认 `vp check` **329 个格式文件正确、184 个受检文件零警告/Lint/类型错误**，OIDC 离线安全测试 **18/18**，完整 `pnpm run ready` 中单元测试 **544/544**、服务端 E2E **49/49**、React/Vue/NestJS 构建完成、质量链退出码 **0**；另以本机独立 PostgreSQL 运行 `pnpm run test:db`，**4/4 文件、29/29 用例通过，退出码 0**。本次文档追加提交后的 `docs:check` 需独立复核；上述结论只对应维护者提交日志时的测试候选代码。
- **证据**：PR #60、修复提交 `017aaa22729e987720a09d865726c8edcabff839`、`apps/server/test/projects-cas-cookie-http.db-spec.ts`、维护者 2026-11-17 Windows `vp check --fix` / `vp check` / `ready` / `test:db` 日志，以及 `docs/VALIDATION.md`。

### E-028 · 真实双 Keycloak 验收脚本保留三个未使用模块常量（第三十四批第六小批）

- **现象**：2026-11-17 维护者 Windows 运行 `vp check --fix` 时，`scripts/test-oidc-dual-cas.mjs` 的 `PROJECT_NAME`、`CSRF_NAME`、`CSRF_PATTERN` 触发 **3 条 `eslint(no-unused-vars)` 警告、0 错误**，自动格式化完成但不得算作代码检查通过。
- **根因**：浏览器 CDP 的 `function.toString()` 执行要求函数自包含，页面内已使用相应固定字符串/正则；模块顶部残留的三个常量并未被任何 Node 代码引用。
- **修复**：仅删除三个未使用常量声明，不调整 OIDC、CSRF、同源请求、CAS、ACL、数据写入和既有离线断言，见 PR #61 提交 `0b7b57837b91921eeaae579e6ad440b292de1796`。
- **避免**：新写页面注入函数或测试脚本时，逐一核对模块级常量是否真正被引用；提交前运行不带 `--fix` 的 `vp check`，不能把格式化完成视为零警告。
- **验证**：维护者后续 Windows `vp check` **331 文件格式正确、186 受检文件零警告/Lint/类型错误**；`test:oidc:dual:config` **11/11**、`docs:check` **86 个 Markdown**、`pnpm run ready` **544/544 单元测试、49/49 服务端 E2E，退出码 0**。这些是本次新增身份提示改动**之前**的代码候选验收，不代表最新 HEAD 已复验。
- **证据**：PR #61、维护者 2026-11-17 Windows `vp check --fix` 与完整 `ready` 日志、`docs/VALIDATION.md`。

### E-029 · 双主体预检把同主体与跨租户误用合并为同一诊断（第三十四批第六小批）

- **现象**：2026-11-17 维护者在本机真实 Keycloak Lab 分别执行 `test:oidc:dual:preflight` 与显式 `test:oidc:dual:cas`，均在两次登录之后输出“**两次登录必须属于同一可信租户的不同主体**”，退出码均为 **1**。第一轮输出没有区分两窗口最终是同一本地主体还是分属不同租户；无法根据该日志断言具体是哪一种。
- **根因**：`requireDifferentSubjects` 用一个 `if (first.tenantId !== second.tenantId || first.subjectId === second.subjectId)` 对两个不同的合法性条件抛出相同中文消息。该保护本身按设计拒绝不合格主体，问题在于不够明确的可执行诊断，不是 HTTP CAS 或 PostgreSQL 已验证失败。
- **修复候选**：保持两项身份约束完全不变，分别输出固定的中文失败类别——“**两次登录所属租户不一致，请核对第二位测试用户的本机身份预绑定**”和“**两次登录映射到同一本地主体，第二个浏览器须使用另一位已预绑定的测试用户**”；加入安全错误白名单与离线回归，并在第二个浏览器登录前提示必须使用不同测试账号。**不打印租户、主体 ID、Keycloak UUID、Cookie、Token 或用户凭据**。
- **避免**：真实 OIDC 多主体测试必须区分“同主体”“不同租户”“身份无效”三种拒绝类别；只核对分类，不从脱敏错误推断外部用户具体身份。登录失败不能通过改 ACL、静默合并租户或复用同一账号绕过；第二位测试用户必须经受控本机工具预绑定到第一位所在租户的独立本地主体。
- **验证**：维护者在诊断修复前的 `test:oidc:dual:config` **11/11**、`vp check` 零警告、`ready` 退出码 0，但真实 `preflight` 和 `cas` 退出码均为 1。**修改后的离线、质量链和真实双登录尚未在 Windows 重新执行，不得标为通过；专用工程 CAS 的 201/409 尚无本小批真实验收证据**。
- **证据**：PR #61、`scripts/test-oidc-dual-cas.mjs`、`scripts/test-oidc-dual-cas.cases.mjs`、维护者原始 Windows 两条预检失败日志、`docs/VALIDATION.md`。

> **2026-11-17 结案补录（E-029）**：上文“尚待 Windows 复验”保留为错误发生和修复候选时的历史状态，不再是本专项的最新结论。维护者已用两个不同的 Keycloak 账号在独立隔离浏览器分别执行 `test:oidc:dual:preflight` 与 `test:oidc:dual:cas`，**两条命令退出码均为 0**；真实 BFF 身份为同租户不同主体，CAS 实际返回 **201＋409**，最终修订号 2、成功版本和审计操作者一致。修复后的最新文档 HEAD 的 `vp check` / `docs:check` / 完整 `ready` 以及本地提交 SHA 对照仍待补证；成功的交互式浏览器专项不等于整个新 HEAD 的所有质量检查通过。

### E-030 · ACL 测试 Mock 将 DELETE RETURNING 误归类为 SELECT（第三十四批第十小批）

- **现象**：候选脚本 `test-oidc-real-acl-revocation.cases.mjs` 新增 8 项离线测试后，协作端对真实脚本函数和相应测试以 V8 模拟运行，首次得到 **7/8**；“撤权只删除全新专用工程的第二主体三项固定 ACL”失败并返回安全诊断“专用工程权限撤销失败，必须核对定向 ACL”。**这不是 Windows Node `--test` 日志，也未调用真实 PostgreSQL。**
- **根因**：新数据库 Mock 先检查 `sql.includes("FROM public.scada_project_grants")`，而真实 SQL `DELETE FROM public.scada_project_grants … RETURNING permission` 同时包含这个子串，优先命中 SELECT 分支并错误返回已有授权数据；随后 `RETURNING permission` 校验按设计拒绝。根因属于**测试夹具 SQL 匹配次序**，不是真实数据库撤权代码已通过或已失败。
- **修复**：仅将 Mock 中 `sql.startsWith("DELETE FROM public.scada_project_grants")` 的匹配放到 `includes("FROM public.scada_project_grants")` 之前；真实串行化事务、工程前缀/主体/首版/三项权限保护、回滚与单元断言保持不变。
- **避免**：SQL 模拟测试若采用包含子串匹配，先处理有副作用的准确语句类型（DELETE/INSERT/UPDATE），后处理 SELECT；对 `DELETE … RETURNING` 必须断言返回的字段结构，并检查调用参数只命中随机专用工程和第二主体。不要为使测试通过修改生产 SQL 权限约束。
- **验证**：同一协作 V8 模拟条件复验 **8/8**；当前仅为非 Node/非 PostgreSQL 的候选自检，Windows `pnpm run test:oidc:revoke:config`、`vp check`、`ready` 与真实 Lab 撤权专项**均待维护者执行**，不得声明验收通过。
- **证据**：`scripts/test-oidc-real-acl-revocation.cases.mjs`、`scripts/test-oidc-real-acl-revocation.mjs`、`docs/VALIDATION.md`。

### E-031 · React 标签页恢复监听使用可变闭包标记与重复类型守卫（第三十四批第十一小批）

- **现象**：2026-11-17 维护者在 Windows 执行 `vp check --fix`，`apps/web-react/src/studio/StudioPage.tsx` 报 **1 条 React Compiler 警告** `react(immutability): Cannot reassign variable after render completes`（原第 1111 行）及 **1 条 TypeScript TS2339 错误** `Property 'kind' does not exist on type 'never'`（原第 1097 行）。检查涉及 188 个文件；**仅格式化步骤完成，Lint/类型检查失败**，不能记为已验收。
- **根因**：`useEffect` 内的 `let active = true` 在返回的 cleanup 中被重赋值，违反 React Compiler 的闭包不可变约束。后续同一错误对象已经通过 `error instanceof ScadaApiError` 收窄，却在 `(isScadaAccessRejection(error) || error.kind === "conflict")` 中重复调用返回 `error is ScadaApiError` 的类型谓词；在 `||` 的右分支，TypeScript 将其错误地视为不可能继续访问 `kind` 的 `never`。这两处均源于本小批新增的 React 页面恢复校验，不属于 Vue 或服务端权限失败。
- **最小修复**：将 Effect 生命周期变量改为 `const lifecycle = new AbortController()`，异步错误处理使用 `lifecycle.signal.aborted` 避免卸载后更新；cleanup 执行 `lifecycle.abort()` 并保持原有事件移除。提前以 `accessRejected` 和 `revisionConflict` 两个布尔值单次计算原有拒绝与冲突条件，在后续 UI 分支复用，避免条件表达式再次执行类型谓词。401/403/404、409、网络失败、SVG/IndexedDB 草稿保护以及跨框架契约全部不变。
- **避免**：React Compiler 启用时，Effect cleanup 不重赋值渲染期间捕获的普通 `let`，优先用可取消信号/受控 Ref 表达生命周期。类型谓词返回宽泛 `ScadaApiError` 时，不要在已收窄到同一类型的 `&&`/`||` 右分支再次调用该谓词并直接读取对象属性；先独立计算可复用的拒绝分类或使用真正可判别的子类型。不要通过禁用 Lint 或 `any` 绕过。
- **验证**：GitHub 候选提交 `e5bddb6c98682130fc80841368466fa1aacccb51` 只修改 React Studio 对应逻辑；协作容器 TypeScript **5.8.3** 对等价类型收窄最小片段执行 `tsc --noEmit --strict` **无错误**。**仓库实际 TypeScript 6、`vp check`、`test:unit`、`docs:check`、`ready` 和 React/Vue 真实浏览器恢复专项尚待 Windows 复验**；不得将该片段检查描述为整体零告警通过。
- **证据**：维护者 2026-11-17 的 `vp check --fix` 原始错误日志、PR #66、`apps/web-react/src/studio/StudioPage.tsx`、`docs/VALIDATION.md`。

### E-032 · 浏览器工程载入测试将旧错误跨忙碌阶段误判为新请求失败的风险（第三十四批第十四小批）

- **现象**：2026-11-17 维护者 Windows `test:projects:oidc:config` 28/28、`vp check` 333 个格式文件及 188 个受检文件零告警、完整 `ready` 566/566 单测及 49/49 HTTP E2E 通过。但交互式 `test:projects:oidc:save:browser`：React 409/401/503 三种延迟保存拒绝均通过，Vue 在“取消载入与画布保护”报“服务器工程载入阶段返回受控错误（确认前）”，**专项退出码 1**。
- **确认的代码问题**：`openProjectInPage` 一旦观察过 Busy，便在 Busy 结束后对任意仍可见的错误节点判失败，未确认该错误是否来自本轮操作。若原有错误节点没有及时清空，可能重现 E-026 的历史误报。**目前日志尚不能证明维护者此次 Vue 失败就是旧错误引起**，真实 HTTP/身份/快照错误类别仍待复测。
- **最小修复候选**：要求新错误与点击前不同，或实际观测到旧错误已清除后又出现；否则不将旧节点当成当前失败。保持确认对话框、CAS 状态与超时断言不放松。新增仅固定七类的中文错误类别白名单，可定位身份、授权、冲突、快照、网络、服务和协议问题而不输出敏感正文。
- **避免**：连续“故障模拟 → 恢复操作”或跨 React/Vue Origin 时，既要观察当前操作实际开始，也要区分旧错误残留；测试不能因为上一个动作留下错误就提前宣告当前动作失败。新错误即使与旧错误文本相同，观察到清空后再次出现时仍必须失败；不可通过自动重试、屏蔽真实错误或输出原始页面异常绕过。
- **验证**：新增三项离线回归，目标 `test:projects:oidc:config` **31/31**；协作端对实际修改的页面函数进行 V8 三分支时序模拟，通过旧错误取消、重新出现冲突拒绝及新身份错误分类，**不等于 Node/Chrome/Keycloak 验收**。Windows `vp check`、`ready` 和真实双框架浏览器专项修复后**均待复验**。
- **证据**：维护者 2026-11-17 Windows 原始日志、PR #69、`scripts/test-project-browser-oidc.mjs`、`scripts/test-project-browser-oidc.cases.mjs` 和 `docs/VALIDATION.md`。

### E-033 · 新增脱敏错误单测与已有安全回退文案相冲突（第三十四批第十四小批）

- **现象**：2026-11-17 维护者 Windows `pnpm run test:projects:oidc:config` 31 项中 **30 通过、1 失败**；失败位置为“工程载入诊断只允许固定阶段和类别，不返回真实页面正文”。实际 `describeProjectBrowserFailure(error)` 对不在白名单中的 `pageDiagnostic` 返回“浏览器页面操作失败，请检查当前 Studio 状态”，而新增用例期望“浏览器安全回归断言失败，检查终端测试条件及真实页面状态”。同次 `vp check` 333 文件/188 受检零警告，`ready` 在相同离线用例处提前退出码 **1**。
- **确认的根因**：原有“页面安全诊断不得输出任意未知错误内容”回归明确把未知 `pageDiagnostic` 脱敏为固定页面操作消息；新增用例没有复用该既有契约，错误地把“不认识的顶层异常”与“已识别页面操作异常但诊断类别未知”两种路径混为一谈。两条输出均为固定中文安全消息，故这不是敏感信息实际泄漏。
- **最小修复**：仅将新增断言的期望修为既有回退消息，保留完整白名单、含敏感文本的负向用例、固定分类和未知消息的强制脱敏。另将浏览器 `verifyStudio` 的 React/Vue BFF 身份布尔检查失败改为两条精确固定中文诊断，以便区分该阶段与页面脚本/工程保存；仍必须认证有效才能继续，不自动登录、不伪造身份或绕过 ACL。
- **避免**：新增测试复用已有安全诊断逻辑时，必须先阅读相邻的正向与负向回归，区分“顶层未知错误”和“已知外层错误下的未知诊断”；精确匹配实际契约，不为了让某一新用例通过而放宽全局脱敏策略。身份读取失败只能输出固定阶段和类别，不能打印页面原始错误或 Cookie。
- **验证**：维护者提供的原始 **30/31、`ready` 退出码 1** 为修复前证据；协作端已对最小调整后的真实脱敏函数做 V8 分支验证，安全白名单与固定回退结果相符，**尚未执行 Windows Node 31/31、完整 `ready` 或真实 Vue 浏览器专项**。原始浏览器第二次失败发生在 Vue “真实 BFF 会话与授权工程列表”阶段，尚不能仅凭通用报错推断具体 HTTP 失败根因。
- **证据**：PR #69、维护者 2026-11-17 第二轮 Windows CLI 输出、`scripts/test-project-browser-oidc.mjs`、`scripts/test-project-browser-oidc.cases.mjs` 与 `docs/VALIDATION.md`。

### E-034 · 浏览器专项的阶段超时被统一脱敏为无法定位的通用消息（第三十四批第十四小批）

- **现象**：维护者 2026-11-17 Windows `pnpm run test:projects:oidc:save:browser` 第三轮专项在 React 完成真实 OIDC 登录、授权工程、草稿、取消/冲突与确认载入后，打印 409、401、503 延迟保存场景开始提示；在 React 503 开始消息之后、Vue 开始之前报告“浏览器登录或 Studio 页面未达到预期状态，请检查隔离 Lab、登录与服务端工程”，**退出码 1**。该日志不能证明 React 503 已通过，具体等待阶段和真实错误原因尚未确定。
- **确认的代码问题**：`waitFor` 在超时抛出含测试阶段标签的固定中文错误，但 `describeProjectBrowserFailure` 把所有以“未达到预期状态”结尾的情况归为同一句通用失败，丢失了定位唯一版本 POST、保存 Busy/Disabled、合成响应后 UI 恢复或工程基线重新载入的能力。仅靠场景开始的日志无法证明各场景通过。
- **最小修复候选**：针对 React/Vue 两种固定框架与 401/409/503 三种固定模拟状态加入严格白名单诊断：在两段保存等待超时后只读取浏览器返回的命中计数及 Busy/Disabled/hasError 布尔状态，映射为有限中文类别；针对既有基线等待只允许两个具体固定标签。禁止输出项目 ID、身份、Cookie、Token、URL、异常正文或堆栈，拒绝附加敏感字段的伪造诊断。**不改变** 503 必须保留 CAS、401/409 必须失效 CAS、所有工程写入隔离等质量断言。
- **避免**：CDP E2E 多阶段异步测试中，一切“未达到预期状态”不能不加区别地丢失安全阶段；与其延长超时或掩盖异常，应以固定白名单暴露阶段，并在独立离线单测验证未知信息仍被脱敏。打印“开始测试”不是“通过测试”。
- **验证**：新增 2 项 Node 离线测试，预期 `test:projects:oidc:config` 由 **31/31 目标**增至 **33/33 目标**，协作端使用实际仓库函数在 V8 中验证安全类别与敏感附加内容拒绝、两份脚本均通过 V8 语法解析；**Windows Node、真实 `ready`、Chrome/Keycloak 双框架浏览器均需维护者重新执行**。原始 React 503 具体故障仍待新固定类别证据。
- **证据**：维护者 2026-11-17 第三轮 Windows 专项退出码 1、PR #69、`scripts/test-project-browser-oidc.mjs`、`scripts/test-project-browser-oidc.cases.mjs`、`docs/VALIDATION.md`。

### E-035 · Vue 保存 409 后共享 CAS 基线已清空但响应式展示未同步（第三十四批第十四小批）

- **现象**：维护者 Windows OIDC 浏览器离线安全测试 **32/33**（唯一失败是带 `；secret` 的未知超时诊断期望错误，实际仍安全脱敏）；独立双框架保存专项 **退出码 1**。React 409/401/503 均通过真实 UI 的延迟 POST 挂起与合成错误释放；Vue 通过真实 BFF、工程列表和确认载入，在 409 合成响应已释放后出现通用断言失败，**不能宣称双框架通过**。
- **确认的代码问题**：共享 `saveDocument` 对版本冲突 409 清空内部 CAS 基线；React 在渲染时直接调用 `serverSession.getBaselineRevision`，Vue 显示 `serverBaselineRevision` 响应式副本。Vue `runServerAction` 的 409 保存失败分支原先仅记录 `serverError`，而不更新 `serverBaselineRevision`，因此 UI 可能继续显示旧修订号。这个不同步问题通过代码核对成立，与浏览器日志吻合；但原始错误被通用脱敏，不能独立证明它是唯一失败的断言。
- **最小修复**：只在 Vue“保存服务端工程”操作失败时，从当前工程的共享 Session 读取 CAS 并同步响应式状态；保证 409 显示未建立、503 继续保留、401 依旧清理，不改共享存储或服务端接口。对新增离线测试仅对齐已有未知错误安全回退文案，不能放行 `secret` 附加内容。浏览器已有 CAS 断言原样保留，新增固定“Vue 延迟保存 409：CAS 基线状态不符合预期”安全诊断和相邻正反向单元断言。
- **避免**：跨框架共享会话状态发生变更时，React 直接读取共享对象与 Vue 单独缓存 `ref` 的视图必须同步验证，尤其是在拒绝/冲突的异常路径。不能只测试成功保存与权限撤销；模拟拒绝后需同时核对共享内部基线与 UI 状态。新增脱敏负向断言要核对真实安全回退文案，不按相似描述推断。
- **验证边界**：协作端完成源码静态比较、V8 语法解析与诊断函数固定分支模拟；本次未实际运行 Windows `test:projects:oidc:config`（目标 33/33）、`vp check`、`docs:check`、`ready` 或真实双框架浏览器。旧日志仍是 **32/33、浏览器退出码 1**，不得将修复候选当作已经验收通过。
- **证据**：维护者第四次 Windows 两段原始日志、PR #69、`apps/web-vue/src/studio/StudioPage.vue`、`packages/api-client/src/studio-session.ts`、`scripts/test-project-browser-oidc.mjs`、`scripts/test-project-browser-oidc.cases.mjs`、`docs/VALIDATION.md`。

> **2026-11-17 E-032 至 E-035 结案补录**：保留上述历史失败与候选阶段描述作为证据，不再将其误读为 PR #69 最新状态。维护者 Windows 最新回归 `pnpm run test:projects:oidc:config` **33/33**、`vp check` **333 格式文件/188 受检零告警**、`docs:check` **86 份**、完整 `ready` 已执行至末尾且非零断言未触发（566/566 单测、49/49 HTTP E2E、双框架及服务端构建）。**React/Vue 真实浏览器均完成合成延迟保存 409/401/503**，`test:projects:oidc:save:browser` PowerShell 明确退出码 **0**，测试期间所有工程写请求均在浏览器端阻断。Vue 409 的 `serverBaselineRevision` 与共享 CAS 同步回归得到实际验证；未知错误附带敏感正文仍由严格安全白名单拒绝。日志未给出本地 Git HEAD，新增结案文档提交后也尚未重跑 `ready`；合成 POST 拒绝**不代表**真实 PostgreSQL 写入后回包、跨标签竞态或工业设备安全已验收。

### E-036 · 异步工程快照工厂的 Promise 误传给 Vitest 同步 Mock 值（第三十四批第十五小批）

- **现象**：维护者 2026-11-17 Windows 执行 `vp check --fix`，`packages/api-client/test/studio-session.test.ts:676` 报 **TS2740**：`Promise<ProjectSnapshot>` 缺少 `ProjectSnapshot` 的 `formatVersion`、`projectId`、`revision` 等字段。188 个文件内 1 个类型错误、0 警告，格式化完成但检查未通过。
- **已确认原因**：当前 `packages/core/src/project-snapshot.ts` 将 `createProjectSnapshot` 声明为 `async (...): Promise<ProjectSnapshot>`，内部还计算 SHA-256 摘要；新增客户端用例直接传入 `api.appendVersion.mockResolvedValueOnce(createProjectSnapshot(...))`。Vitest 的 `mockResolvedValueOnce` 期望 Mock 方法解析后的 `ProjectSnapshot`，不能把工厂 Promise 当作快照对象。
- **最小修复**：只在已有 `async it` 中使用 `mockResolvedValueOnce(await createProjectSnapshot(...))`。保留真实快照与 SHA-256 校验，不用 `as ProjectSnapshot`、`any`、禁用类型检查或替代伪造对象，不改变生产代码及隔离数据库测试。
- **防复发**：使用异步 Core 工厂准备 Vitest Mock 返回值前，先核对工厂签名；`mockResolvedValueOnce` 传已解析的值，需要延迟计算或异步拒绝则用符合接口签名的 `mockImplementationOnce`。不能从函数名推断返回同步对象；提交前应对新增测试运行真实 `vp check` 和对应单测。
- **验证边界**：维护者原始 **TS2740 失败** 已确认；PR #70 的修复表达式与 Core 异步签名经静态复核，**修复后 Windows TypeScript 6、`vp check`、共享会话 31/31、`ready` 和隔离 PostgreSQL `test:db` 均未重新实测**，不得标为通过。
- **证据**：维护者原始 Windows `vp check --fix` 日志、PR #70、`packages/core/src/project-snapshot.ts`、`packages/api-client/test/studio-session.test.ts`、`docs/VALIDATION.md`。

### E-037 · SSE 故障代理使用随机禁用 HTTP 端口导致 Node Fetch 拒绝（第三十四批第十五小批）

- **现象**：维护者 2026-11-17 Windows 在隔离 PostgreSQL 专项 **32/32、退出码 0**，单元测试 **567/567**、`vp check` **333 格式文件/188 受检零告警** 后运行完整 `pnpm run ready`；SSE 客户端 **8/8** 通过，随后 `scripts/sse-fault-proxy.test.mjs` **4 项中 2 失败**，两项分别是普通 HTTP 透传和双 SSE 订阅，错误 `TypeError: fetch failed`、内部 `Error: bad port`；Keep-Alive `node:http` 用例通过，`ready` **实际退出码 1**。
- **原因与证据边界**：故障代理用 `server.listen(0, "127.0.0.1")` 从 OS 临时端口池选取任意监听端口；测试用全局 `fetch(new URL("...", proxy.url))` 请求代理。WHATWG Fetch 标准会屏蔽一些端口（如 6000、6667、10080），Node 内置 Fetch 同样可能返回 `bad port`；`node:http` 不受相同 Fetch 端口阻止，因此症状高度吻合。**用户日志没有给出实际绑定端口号，不能确定是哪一个端口**；不将该推断当作已观测的精确端口。
- **最小修复**：保持代理只绑定 `127.0.0.1`、仍严格拒绝非本机或非 HTTP 目标；随机监听只从明确避开所有已知 Fetch 禁用端口的 **20000～49151** 高端口范围选择，遇到 `EADDRINUSE` 或 Windows `EACCES` 最多重新尝试 32 次，资源与连接关闭流程不变。原 SSE 四项测试的 `withOrigin` 夹具增加端口范围断言；保留 Fetch 请求、真实 TCP 静默阻断、Keep-Alive 复用、连接回收测试。
- **防复发**：测试代理或临时浏览器服务不能假设 `listen(0)` 选择的端口一定允许浏览器/Fetch 访问。随机端口应满足协议客户端的安全限制并覆盖端口占用重试；不要用绕过浏览器禁用端口、关闭认证/TLS、改用不安全生产端口或删测试来掩盖。遇到随机端口失败先区分 `fetch` 的 `bad port`、TCP 拒绝和 SSE 协议失败，避免错修业务逻辑。
- **验证**：修复前维护者实测 `test:sse:fault:unit` 在 `ready` 中 **2/4**、`ready` 退出码 **1**；当前 GitHub 代码补丁只经静态核对，**修复后 Windows `test:sse:fault:unit`、`vp check`、`docs:check` 及完整 `ready` 均待复验**。此前同一分支 `test:db` **32/32，退出码 0**，不代表新代理补丁已经验证通过。
- **证据**：维护者 Windows 原始 SSE `bad port` 错误日志、PR #70、`scripts/sse-fault-proxy.mjs`、`scripts/sse-fault-proxy.test.mjs`、`docs/VALIDATION.md`。

> **2026-11-17 · E-036 / E-037 最终 Windows 结案补录**：历史段落中的“尚待复验”仅描述候选阶段。维护者已在 Windows 通过异步快照 Mock 修复后的 `vp check` **333/188 零告警错误**、共享会话 **31/31** 与全量 Vitest **567/567**、SSE 故障代理独立 **4/4** 及完整 `pnpm run ready` **退出码 0**（包含 OIDC 浏览器离线安全 33/33、NestJS HTTP E2E 49/49 和双框架/服务端构建）。此前独立真实 PostgreSQL `test:db` 也已 **32/32、退出码 0**。E-036 的 Promise/Mock 类型错误与 E-037 的故障代理 Fetch `bad port` 均有实测通过证据；未记录随机禁用端口具体数值，不推断 Windows 测试精确 Git HEAD。新结案文档提交本身未重新执行 Windows 质量链，PR #70 仍需维护者明确授权后才可合并。

### E-038 · 未提供执行记录却在 PR 描述中声称协作环境冒烟 20 次（第三十四批第十六小批）

- **现象**：PR #71 初稿描述写有“Node 22 的 `Response.clone().json()` 延迟解析机制在隔离容器重复 20 次基础冒烟通过”，但当前可核对的协作记录**没有该 Node 命令、原始运行输出或退出码**。此类说法不得进入验收统计。
- **原因**：把候选机制的分析或静态核对误写成已经实际运行的多次冒烟结果，没有逐项检查工具调用证据。
- **修正**：从 PR #71 验收复选框撤去这一条未证实的 20/20 成功断言，改为仅记录维护者 Windows 真正执行的 `test:oidc:dual:config` **16/16**、独立真实 `test:oidc:dual:late` **退出码 0**、`vp check` 和完整 `ready` **退出码 0**。明确区分仓库真实测试、静态检查、机制推断。
- **防复发**：每一项“已运行、N/N 通过、退出码 0”均须有对应实际命令、输出和执行位置；仅查看源码、用模型推理或假设测试能够成功时必须注明“尚未执行”，不能伪造试验次数。用户日志没有 `git rev-parse HEAD` 时亦不得将通过证据绑定到具体 SHA。
- **验证与边界**：维护者实际 Windows 日志已提供上述质量链及双浏览器成功记录；本次仅更正文档历史表述，**没有补跑此前所称协作容器 20 次测试**。当前文档新增提交尚未重新执行 `docs:check` / `ready`。
- **证据**：PR #71 初稿及后续验收正文、2026-11-17 维护者 Windows PowerShell 日志、`docs/VALIDATION.md`。

### E-039 · 真实 Studio 浏览器测试初稿未复用严格工程前缀与 CDP 自包含约束（第三十四批第十七小批）

- **现象**：本批初稿新增的真实 Studio 迟到响应脚本使用了 `b34-studio-late-<UUID>` 前缀，而已存在的 `createCasProjectInPage` 和 `grantSecondSubject` 只允许 `b34-oidc-cas-<UUID>`；另一处页面注入函数 `armStudioRealLateInPage` 引用了 Node 模块作用域的 `PROJECT_PATTERN`。这两项在 GitHub 候选静态审查时发现，**没有真实浏览器执行失败日志**，不能记为 Windows 已发生的故障。
- **根因**：在复用既有严格安全辅助函数时未先对齐它们的工程 ID 契约，并在函数被 CDP `function.toString()` 独立序列化执行时误用模块作用域常量，再次触及 E-002 / E-025 的已知边界。
- **修正与防复发**：只改回既有的随机 `b34-oidc-cas-<UUID>` 测试工程前缀，将页面函数正则内联为自包含字面量；原创建/授权 SQL 白名单绝不放宽。新增 CDP 页面函数前逐一核对它实际运行的作用域和已有测试夹具权限约束。
- **验证边界**：候选源码静态语法检查及隔离 V8 Mock 中的单次 201 保留/释放、拒绝额外写入路径已核对，但新脚本的 Node 单元测试、Windows `vp check` / `ready` 与真实 Keycloak/PostgreSQL 浏览器仍待执行，不宣称综合测试通过。
- **证据**：本批分支初稿与修正提交、`scripts/test-oidc-studio-real-late.mjs`、`scripts/test-oidc-dual-cas.mjs`、`docs/VALIDATION.md`。

### E-040 · String.raw 生成 Markdown 时保留代码反引号转义（第三十四批第十七小批）

- **现象**：本批候选文档首次提交后在六份新增章节中出现多余的反斜杠加反引号，导致行内代码与 `powershell` 代码围栏不能按预期展示。由对 GitHub Blob 的静态检查发现，**没有维护者 Windows `docs:check` 失败日志**。
- **根因**：在 JavaScript `String.raw` 模板中为了包裹 Markdown 反引号添加转义字符，`String.raw` 会保留原始反斜杠，而不是将其移除。
- **修正与防复发**：仅在六份文档的第十七小批新增章节中把 `反斜杠＋反引号` 还原为合法 Markdown 反引号；不改历史记录。后续先检查实际生成的文件内容，核对代码围栏成对出现，不能只验证 JS 模板字符串本身能解析。
- **验证边界**：新增 HARNESS 章节含两组成对 PowerShell 代码围栏，新增文档不再含上述转义序列。完整仓库 `docs:check`、`vp check` 与 `ready` 仍需维护者 Windows 实际执行并提供退出码。
- **证据**：本批文档候选及修正提交、`docs/HARNESS.md`、`docs/VALIDATION.md`。

### E-041 · 真实 Studio 迟到 201 浏览器专项多个等待阶段复用同一通用错误（第三十四批第十七小批）

- **现象**：维护者 Windows 首次执行 `pnpm run test:oidc:dual:studio:late`，两位真实 Keycloak 主体登录、两个专用工程创建与授权、React Studio 确认载入及真实 201 到达/挂起均已输出成功阶段；紧接着报告“真实 Studio 迟到保存未达到受控状态”，专项退出码 **1**。该信息无法区分第二主体推进、释放旧 201、Studio 成功状态恢复、页面可见性、CAS 复核或过期保存拒绝中的具体失败点。
- **已确认的代码诊断缺陷**：新专项将 `releaseStudioRealLateInPage` 和多段 `waitFor` 都复用相同中文错误，且等待超时不输出阶段与状态摘要。**真实浏览器专项的确切失败阶段及底层原因仍待复测**；不能推断为 PostgreSQL CAS、React/Vue 生产 UI 或 BFF 已损坏。
- **最小修正**：新增 `waitForStudioState`，每个关键等待使用固定阶段名称；超时只输出经过白名单构造的页面状态枚举、POST/写入计数、Busy/Disabled、CAS 基线/摘要清除、错误提示与可见性布尔值。第二主体读取版本 2、追加 3 和旧 201 释放也增加固定阶段输出。禁止输出工程 ID、主体、Cookie、Token、数据库 URL、响应正文、原始异常或堆栈；所有失败仍然退出码 1，不放宽 CAS/CSRF/ACL/TLS/单次写入约束。
- **避免**：真实浏览器测试中不得让多个异步阶段共用同一“未达到预期状态”错误。每个等待都必须对应明确阶段，并在超时时只读回传足以区分状态的固定安全字段；开始日志不能代替完成日志。若现有证据只能定位到一个阶段，必须将根因标记为“待确认”，不猜测业务缺陷。
- **验证**：维护者已提供修正前 Windows 离线测试 **9/9**、`vp check` **335 文件/190 受检零警告错误**、`docs:check` **86** 份和完整 `ready` **退出码 0**；同次真实 Studio 专项**退出码 1**。新增阶段诊断候选已完成静态语法检查，**修正后的 Node 9/9、Windows `vp check` / `docs:check` / `ready` 与真实双框架 Lab 浏览器均待复验**。维护者日志未提供 `git rev-parse HEAD`，不能将前述成功结果绑定到某个 PR SHA。
- **证据**：维护者 2026-11-17 Windows 首轮真实 Studio 迟到 201 专项及完整质量链日志、PR #72、`scripts/test-oidc-studio-real-late.mjs`、`scripts/test-oidc-studio-real-late.cases.mjs`、`docs/VALIDATION.md`。

### E-042 · 双独立浏览器窗口下 Page.bringToFront 不能保证页面可见（第三十四批第十七小批）

- **现象**：维护者第二轮 Windows 真实 `test:oidc:dual:studio:late` 在 React Studio 完成真实版本 2 保存、第二主体真实读取版本 2、CAS 2→3 返回 HTTP 201、第一主体消费原始 201 并显示基线 2 后，停在“浏览器切换到可见状态”，诊断状态为 `phase=released`、`writeAttempts=1`、`baselineRevision=2`、`savedSecondVersion=true`、**`visible=false`**，专项退出码 **1**。后续水位复核和 Vue 流程没有执行。
- **已确认的测试假设缺陷**：原脚本仅执行 CDP `Page.bringToFront` 然后等待浏览器真正的 `document.visibilityState === "visible"`。CDP 该命令定义为“激活标签页”，不承诺把另一独立 Chrome/Edge 窗口从前台移走；实际 Windows 日志已证明它不足以满足当前可见性前置条件。**仍无法断言具体是遮挡、最小化、系统前台策略还是 Chromium 窗口生命周期造成隐藏**，不能据此判定生产 Studio、CAS 或 PostgreSQL 失败。
- **最小修复候选**：只对真实测试的**第二主体隔离窗口**调用 CDP `Browser.getWindowForTarget` 与 `Browser.setWindowBounds`；在第二主体读/写前恢复为 `normal`，在其追加版本 3 后、第一主体完成旧 201 消费后设为 `minimized`，再激活第一主体标签并严格等待真实 `visible === true`。仅允许 `normal/minimized` 两个窗口状态并校验有效窗口 ID；失败返回固定中文安全消息，不修改 `document.visibilityState`、不模拟可见事件、不移除后续真实 GET/CAS/画布/草稿/审计断言。
- **防复发**：跨两个独立浏览器 Profile 的 CDP 专项必须区分“激活标签页”和“操作系统窗口前台/可见”；可见性是需要真实观察的环境前置条件，绝不能用覆盖浏览器 DOM getter、强制派发隐藏状态下的 `visibilitychange` 或关闭 UI 校验来制造通过。浏览器窗口管理仅限测试临时 Profile，不依赖 Win32 外部提权或人工凭据。
- **验证边界**：第二轮真实浏览器失败日志及恢复前状态已确认；新增窗口切换函数和拒绝用例为**修复候选**。候选的 Windows Node 离线测试、`vp check`、`docs:check`、`ready` 与双框架真实 Lab 专项尚未复验。上轮通过的质量链退出码 0 不能覆盖本次新增代码；本次用户日志也未提供本地 Git HEAD。
- **证据**：PR #72、维护者第二轮 Windows 浏览器日志、`scripts/test-oidc-studio-real-late.mjs`、`scripts/test-oidc-studio-real-late.cases.mjs`、CDP 官方 `Page.bringToFront` 与 `Browser.setWindowBounds` 协议文档、`docs/VALIDATION.md`。

### E-043 · 真实 Studio CAS 恢复后本地数据比较仅返回笼统失败（第三十四批第十七小批）

- **现象**：维护者第三轮 Windows 真实 `test:oidc:dual:studio:late` 已通过 React 真实 HTTP 201 保存、第二主体 CAS 2→3、旧 201 交付和页面恢复可见；日志打印“Studio 页面已可见，触发服务端 CAS 只读复核”后，测试以“真实 Studio 迟到保存的本地数据发生变化”退出码 **1**。依据当前脚本执行顺序，CAS 复核必须已使旧基线与服务端头信息失效，之后再次点击保存必须进入受控错误状态且工程写入计数仍为 1，才会执行到最后一条本地比较；本轮未执行最终 SQL 三版审计和 Vue 流程。
- **已确认的测试诊断缺陷**：`requireUnchangedDocument` 将 SVG、自动保存开关、IndexedDB 草稿数量及整个原始草稿记录 JSON 哈希四项条件合并为一个异常，且未标记对比发生在哪个操作阶段。现有日志**不足以确认具体变化字段及其发生时间**；尤其不能推断是 IndexedDB 自动保存元数据变化、SVG 实际改变或生产 CAS 业务错误。
- **候选最小修复**：新增纯函数 `classifyStudioLocalDrift`，仅返回 `canvasChanged`、`autoSaveChanged`、`draftCountChanged`、`draftHashChanged` 四个布尔值；原任一不一致即失败的断言**完全保留**。为已有保存挂起、第二主体提交 3、旧 201 消费、CAS 只读复核、过期保存拒绝五个检查点逐一添加固定中文阶段，仅在失败时输出布尔分类，不输出 SVG、草稿记录、哈希、Cookie、Token、主体 ID 或 HTTP 正文。新增两个离线用例覆盖无变化与四类独立变化及敏感数据拒绝。
- **防复发**：保护性 E2E 断言应能判断变化的实际类别与首次发生阶段；没有具体证据前不得删除草稿哈希比较、忽略自动保存修订号、延迟无限等待或声称数据一定未改变。若下轮仅出现 `draftHashChanged=true`，需再区分 IndexedDB 记录正文与保存元数据，而不是直接放宽判断。
- **验证边界**：第三轮真实浏览器**退出码 1**为用户已提供证据；新增分类纯函数在隔离 V8 中以五种输入核对全为预期，但这**不是仓库 Node 测试或真实浏览器验证**。候选离线测试目标 **13/13**；最新补丁的 Windows `vp check`、`docs:check`、`ready` 及真实 Keycloak/PostgreSQL/React/Vue 专项都尚待实测。用户日志仍未附本地 Git HEAD。
- **证据**：PR #72、第三轮 Windows 真实 Studio 浏览器日志、`scripts/test-oidc-studio-real-late.mjs`、`scripts/test-oidc-studio-real-late.cases.mjs`、`docs/VALIDATION.md`。

### E-044 · Studio SVG 快照将随视口变化的辅助网格误当成工程内容（第三十四批第十七小批）

- **现象**：维护者第四轮 Windows `pnpm run test:oidc:dual:studio:late` 已完成 React 真正保存版本 2、第二主体真实追加版本 3、旧 201 交付及浏览器可见性恢复；CAS 只读复核后严格本地检查输出 `{"canvasChanged":true,"autoSaveChanged":false,"draftCountChanged":false,"draftHashChanged":false}`，专项**退出码 1**。后续 PostgreSQL 最终审计和 Vue 联合流程没有执行。
- **已确认的测试设计缺陷**：现有 `inspectStudioState` 使用 `.studio-svg.innerHTML` 代表整个画布，但 React/Vue 画布都在 SVG 内直接渲染 `fill="url(#scada-studio-grid)"` 的辅助网格矩形，`x/y/width/height` 与 `visibleRect` 绑定并可随真实窗口可见性/尺寸变化重新计算。原始 `innerHTML` 并非稳定的工程内容快照。**本轮变化是否确实仅由网格坐标引起尚待 Windows 复验**，不能据此认定生产数据已经损坏或完全无异常。
- **最小修复候选**：仅在第十七小批真实浏览器专项引入 `readStudioContentCanvasInPage`，克隆当前 SVG，精确移除**顶层、填充为 `url(#scada-studio-grid)` 的一个视口辅助网格 `rect`**。其他完整 SVG 内容，包括渲染 `image`、背景、边界、图元、命中层及辅助交互节点继续严格比较。缺失画布或重复视口网格安全失败。保留原 `classifyStudioLocalDrift` 的四项布尔输出、五个阶段对比以及 IndexedDB 草稿整记录 SHA-256、数量、自动保存状态、CAS 和 SQL 审计全部断言；不修改 React/Vue 生产业务代码、Core 或数据库。
- **防复发**：涉及画布的端到端快照必须区别“工程内容”和“随窗口/缩放变化的视口辅助元素”；不能随意将整个 DOM `innerHTML` 当作持久化 Schema。只排除经源码明确确认的非持久化动态节点，并用负向用例证明业务 SVG 真改变仍失败。不得把此次候选说成真实根因已实测结案。
- **验证边界**：新增三个 Node 离线测试定义（目标由 **13** 项增加至 **16** 项），覆盖视口网格变化不影响内容、图元或渲染变化仍被识别、重复网格/画布缺失拒绝。页面函数从仓库源码提取后在隔离 V8 Mock 执行以上三类路径符合预期，**但不是 Node 16/16 或 Windows 真实浏览器通过证据**。最新候选 `vp check`、`docs:check`、`ready`、React/Vue 真 Lab 均未复验。
- **证据**：维护者第四轮 Windows 原始日志、PR #72、`apps/web-react/src/studio/StudioPage.tsx`、`apps/web-vue/src/studio/StudioPage.vue`、`scripts/test-project-browser-oidc.mjs`、`scripts/test-oidc-studio-real-late.mjs`、`docs/VALIDATION.md`。

> **2026-11-17 · E-041～E-044 Windows 最终验收补录**：以上四项的“候选 / 待复测”仅描述各轮历史状态。维护者现已在 Windows 真实完成 `pnpm run test:oidc:dual:studio:config` **16/16 通过**、`vp check` **335 格式文件 / 190 受检零告警错误**、`docs:check` **86 份 Markdown** 和完整 `pnpm run ready` **退出码 0**（Vitest **567/567**、NestJS HTTP E2E **49/49**，React/Vue/NestJS 构建完成）。另在两个全新隔离测试工程上，由两位真实预绑定 Keycloak 主体分别执行 React/Vue Studio 真实 UI 的迟到 HTTP 201 测试，均完成版本 2→3、真实可见性恢复、远端水位只读复核、过期 CAS 拒绝、SVG 内容和 IndexedDB 草稿保持不变、仅三版历史和审计；交互式 `pnpm run test:oidc:dual:studio:late` **退出码 0**。E-041 的阶段错误已通过明确状态诊断定位；E-042 的双窗口可见性障碍未再复现；E-043 的本地差异已按阶段区分；E-044 的非持久化视口网格已从此专项 SVG 内容快照中精确排除，其余图元仍严格比较。**注意**：没有独立的原始 SVG DOM diff 证明前轮变化完全源自网格；最终通过仅证明新的测试口径及其所有保留断言满足。201 暂缓是浏览器对已到达真实响应的消费时序，**非 TCP 断流**。成功日志没有本地 Git HEAD，新补录文档提交尚未重新运行 Windows 全链；PR #72 仍 Open/Draft 并指派 `@adui-dev`，等待明确合并授权。

### E-045 · 初始空白标签页未安装可见性探针导致真实 OIDC 登录前阻塞（第三十四批第二十小批）

- **现象**：维护者截图显示同一 Chrome 窗口的初始标签页及四个测试标签页仍为 `about:blank`；上传日志中离线安全用例 9/9、`vp check` 零告警、Vitest 581/581、服务端 E2E 49/49，但未包含真实多标签页浏览器专项的终端命令、退出码或完成记录。不能单凭截图断言真实专项的最终退出阶段。
- **确认的代码缺陷**：`installPageProbes` 只调用 `Page.addScriptToEvaluateOnNewDocument`，该注入默认不执行于已经存在的空白文档。`activateTab` 却先于 `waitForLogin` 导航读取当前文档的可见性计数，并要求隐藏变可见时计数递增。协作容器真实 Chromium 对照显示旧逻辑 `probe=null`，在当前空白文档立即执行探针安装后可观察到 `visibleEvents=1`。
- **最小修复**：保持新文档注入与真实 `Page.bringToFront`，额外在新标签页创建时调用一次 `session.evaluate(installMultiTabVisibilityProbeInPage)` 初始化已存在的空白文档。页面探针自身幂等，不修改 `document.visibilityState`、不人工派发 `visibilitychange`，不放宽后续真实 BFF、CAS、草稿与权限约束。新增离线顺序断言。
- **避免**：CDP 新文档注入与已存在执行上下文是两个不同的生命周期；测试如果在首次 `Page.navigate` 之前读取当前 DOM 状态，就必须先在当前文档初始化依赖项，并保留导航后的注入；不能以空白页面作为真实 OIDC 登录失败的证据。
- **验证边界**：协作容器已执行 `node --test /mnt/data/test_multitab_patch.mjs`，独立顺序模拟 **1/1** 通过；`node /mnt/data/verify_blank_visibility.mjs` 在真实 Chromium 观察到旧空白文档未注入、修复后 `visibleEvents=1`。两项验证仅覆盖本次探针初始化机制；当前 GitHub 新提交的 Windows `vp check`、完整 `ready`、真实 Keycloak/HTTPS/PostgreSQL 浏览器专项待执行，不能声称 PR #76 全链通过。
- **证据**：维护者 2026-11-18 上传的五标签页截图及质量链日志、PR #76、`scripts/test-oidc-real-multitab.mjs`、`scripts/test-oidc-real-multitab.cases.mjs`、`docs/VALIDATION.md`。

### E-046 · 将 CAS 状态摘要误当作 SVG/草稿保护快照（第三十四批第二十小批）

- **现象**：维护者 Windows 真实执行 `pnpm run test:projects:oidc:multitab:browser`，单次 Keycloak 登录完成、四个标签页已核对为同一 BFF 主体，随后报“标签页恢复改变了本地画布”，浏览器专项 **退出码 1**；没有进入远端版本推进、注销与 Vue 完整验收。
- **已确认的代码原因**：`openStudioProject` 返回 `readMultiTabSessionStateInPage` 的 CAS/身份 UI 状态摘要，不包含 `canvas` 或 `drafts`；真实脚本在 React/Vue 各自首次 `openStudioProject` 后创建草稿、开启自动保存，却立即用 `requireSameCanvasAndDrafts(initialSummary, draftSnapshot)` 比较二者。摘要 `canvas` 为 `undefined`，与从真实 SVG 读取的字符串必然不相等。这里是测试快照类型混用导致的确定性误报，**不能据此推断现场工程画布有变化**。
- **最小修复**：保留 `openStudioProject` 对正式工程 UI 确认与 CAS 修订号的校验；React/Vue 均只在 `prepareFollowerDraft` 成功完成草稿创建和自动保存启用后，取得 `inspectProtectedState` 全量快照作为后续基准。删除初始化阶段两处无效的摘要与草稿比较，不删除后续版本漂移、CAS 恢复和注销时 SVG 内容、IndexedDB 整记录摘要、草稿数量、自动保存状态、零工程 POST 的严格断言。
- **避免**：不能把只读 CAS 状态摘要当作持久化数据快照。建立本地数据保护基准应在业务初始化完成后、行为复核之前；初始化自身会有意创建草稿并启用自动保存，不应对初始化前后状态使用“完全不变”断言。新增 Node 离线用例验证 `prepareFollowerDraft` 返回完整画布/草稿状态，CAS 摘要仍被严格比较函数拒绝。
- **验证边界**：维护者提供的**修复前** Windows 日志：多标签页离线 **10/10**、`vp check` **337 格式文件/192 受检零告警**、`docs:check` **86 个 Markdown**、Vitest **581/581**、HTTP E2E **49/49**；上传内容显示 `ready` 构建到末尾，**没有最终退出码**。真实浏览器专项明确退出码 **1**。当前修复候选的离线目标 **11/11**，Windows `vp check`、`docs:check`、完整 `ready`、真实 React/Vue/Keycloak/PostgreSQL 专项均须重新执行。
- **证据**：维护者 2026-11-18 浏览器终端输出、PR #76、`scripts/test-oidc-real-multitab.mjs`、`scripts/test-oidc-real-multitab.cases.mjs`、`docs/VALIDATION.md`。

### E-047 · Session Guard 新增 HTTP 响应接口后遗漏旧身份测试夹具（第三十四批第二十七小批）

- **现象**：维护者 Windows 在 PR #83 初版候选执行 `vp check` **337 个格式文件、192 个受检文件零警告错误**；`pnpm run test:unit` **580/583**、3 项失败，均在 `apps/server/src/auth/scada-identity.spec.ts` 的既有 Bearer 拒绝/成功/审计用例中报告 `TypeError: http.getResponse is not a function`。完整 `pnpm run ready` 于单测处退出码 **1**；独立 NestJS HTTP E2E **49/49**、`docs:check` 86 份通过。这些是**修复前的实测结果**。
- **确认根因**：本批生产 `ScadaSessionGuard.canActivate` 为确保被 Guard 提前拒绝的 401/403 同样禁止缓存，在 HTTP 上下文调用 `context.switchToHttp().getResponse()` 并设置 `Cache-Control: no-store` / `Pragma: no-cache`。新增的 `scada-session.guard.spec.ts` Mock 已同步提供 `getResponse`，但另一份长期存在的 `scada-identity.spec.ts` 公共 `context()` 仍只实现 `getRequest()`；测试在执行原身份与审计逻辑前抛出 TypeError。这是旧测试夹具漏更，不是可据此断言真实 BFF 发生认证放行或数据泄漏。
- **最小修复**：仅补全 `scada-identity.spec.ts` 的共用 HTTP Context 夹具，保留既有 `getRequest`、权限 Metadata、身份与审计断言，追加可记录头部的 `getResponse().setHeader()`。在原无效 Bearer 401 和有效会话成功场景分别断言 `no-store` / `no-cache`，无须更改正式 Guard、绕过响应对象读取或弱化测试断言。
- **防复发**：任何 NestJS Guard/Interceptor 新增 `ExecutionContext` 访问方法时，必须全文检索**所有**共用与独立测试夹具，并为该方法补上最小 Mock；单个新测试通过与真实装配 E2E 通过，不能替代全量单元测试。检查失败的真实异常类别，不因三项用例同时失败就修改已正确执行的生产身份逻辑。
- **验证边界**：原 Windows `vp check`、HTTP E2E、文档检查通过与 `ready` 失败均已实测。当前 PR #83 修复候选只已通过 GitHub 源码和补丁静态核对，**修复后 Windows `pnpm run test:unit`（目标 583/583）、`vp check`、`docs:check`、完整 `pnpm run ready` 均待执行**；不可将原 `580/583` 宣称已修复通过。
- **证据**：维护者 2026-11-18 Windows 日志、PR #83、`apps/server/src/auth/scada-identity.spec.ts`、`apps/server/src/auth/scada-session.guard.ts`、`docs/VALIDATION.md`。

> **2026-11-18 · E-047 Windows 结案补录**：上述“修复后待测”是候选阶段的历史边界。维护者 Windows 在修复公共 `ExecutionContext` Mock 后实际运行 `pnpm run test:unit`，**49/49 文件、583/583 用例通过，退出码 0**；完整 `pnpm run ready` **退出码 0**，包括 `vp check` 337/192 零告警、HTTP E2E 49/49、文档 86 份以及双框架和服务端构建。旧 3 项 TypeError 未再发生。PR #83 已经维护者明确授权 Squash 合并至 `main@650b084f770bb92241b3b93a02689160b7b8bc41`。原日志没有本机 `git rev-parse HEAD`，合并后新提交没有额外执行 Windows 复测；不可将此结论延伸为工业现场安全认证。

### E-048 · 旧同源双标签页专项在 CDP 中引用 Node 模块常量（第三十四批遗留 PR #75）

- **现象**：2026-11-18 排查长期保持 Draft 的 PR #75 时，在旧 `scripts/test-oidc-studio-multitab.mjs` 中发现 `createMultitabProjectInPage` 和 `armStudioMultiTabWriteInPage` 的项目 ID 检查依赖模块级 `PROJECT_PATTERN`。二者被 `session.evaluate` 使用 `function.toString()` 独立发往真实浏览器，页面内没有 Node 模块词法环境，因而存在确定的 `ReferenceError` 风险。**没有 Windows 运行失败证据，不能记作真实浏览器事故。**
- **根因**：原离线单测直接调用导出函数，与 Node 模块一起运行，可以访问该常量，未模拟 CDP 序列化边界；重复违反 E-002、E-025 与 E-039 的已知规则。
- **修正**：只在两段浏览器页面函数内联已审核的 `b34-oidc-multitab-<UUID>` 精确正则，仍拒绝其他工程；Node 侧数据库审计和随机工程生成继续使用模块级常量。新增 Node 内置测试，要求两段页面函数的序列化源码均不包含 `PROJECT_PATTERN`；原 18 项测试保持不变，目标增加到 19 项。未修改现有 BFF、CSRF、真实工程访问保护或数据库。
- **合流说明**：PR #75 的旧文档曾暂用 E-045/E-046/E-047 记录三处静态候选问题；这三个编号后来被 `main` 的真实四标签页与身份 Guard 错误正式占用，**绝不以旧分支编号覆盖主线历史**。保留 PR #75 的改动历史，通过带双父提交的合流和主线文档重建保留当前正式编号。
- **防复发**：页面运行函数必须自包含；CDP `evaluate` 与 Node 直接调用是两个不同环境。对新脚本先检查序列化源码，不允许引用 import/模块常量，再运行 Node 离线、`vp check`、完整 `ready` 和真实 Chrome/Keycloak 专项；单测静态断言不等于浏览器实测。
- **验证边界**：截至此次远程候选，**未执行** Windows Node 19/19、`vp check`、`docs:check`、`ready` 或真实 React/Vue 本机 Lab 浏览器。原 PR #75 声称的隔离 V8 18/18 仅属于旧代码、并非当前提交的真实 Node 测试。
- **证据**：PR #75、`scripts/test-oidc-studio-multitab.mjs`、`scripts/test-oidc-studio-multitab.cases.mjs`、`docs/VALIDATION.md`。

### E-049 · HTTPS 开发服务被旧 Studio 浏览器脚本误判为未启动（第三十五批第三小批）

- **现象**：2026-11-18 维护者在 Windows 同时启动 React/Vue，本机 Vite+ 实际分别监听 `https://127.0.0.1:15173/` 与 `https://127.0.0.1:15174/`；独立 `test:browser` 和 `test:release:preflight:browser` 都在 React 连接探测时报告“开发服务未启动：http://127.0.0.1:15173/”，**两项退出码均为 1**。同批 `test:unit` **596/596**、`vp check` **341/196 零告警**、`docs:check` **86 份**、完整 `ready` **退出码 0**，证明离线质量链通过，但不能替代浏览器专项。
- **确认根因**：`scripts/test-studio-browser.mjs` 在缺少 `SCADA_REACT_URL` / `SCADA_VUE_URL` 覆盖时无条件拼接 `http://`，未读取本仓库已有的 `SCADA_OIDC_DEV_HTTPS_ENABLED=true`。原预检 `fetch` 因协议不一致在启动浏览器之前失败；“服务未启动”属于误导性的网络诊断，**并不是 React/Vue 应用实际未启动或正式发布预检功能失败的证据**。
- **最小修复候选**：新增 `scripts/studio-browser-targets.mjs`，根据现有 HTTPS 开关和回环端口生成双框架 URL，显式覆写仅允许回环 Web 首页，HTTPS 模式禁止降级为 HTTP；原脚本用共用解析和只读连接探测。HTTPS 探测使用 Node `https.request` 严格 `rejectUnauthorized: true`，根证书可从 `NODE_EXTRA_CA_CERTS` 显式读取，以兼容脚本启动后才加载根 `.env` 的场景；对 TLS/文件错误仅返回固定中文类别。**不允许**关闭 Node TLS 校验、为 Chrome/Edge 增加忽略证书参数、修改 OIDC/数据库/设备。
- **防复发**：浏览器专项应从当前实际 Vite 服务协议推导目标，且 HTTP/HTTPS 模式、用户覆写、非法远程地址和证书验证都必须有离线反向测试；`ready` 里的离线质量链不等于真实 Chrome/Edge 已连接双 Origin。新命令 `test:studio:browser:config` 纳入 `ready`，而实际浏览器专项仍须独立执行。
- **验证边界**：协作容器对 GitHub 当前两个新文件的 Blob SHA 完整比对一致，Node.js 22 的 `node --test` **6/6 通过**；使用临时本机自签 HTTPS 服务实际确认“未知证书拒绝”与“显式信任本机 CA 后接受”两条路径，未关闭证书校验。**Windows 新 HEAD 的 `vp check`、完整 `ready` 和两个浏览器专项尚未执行**；自签服务模拟不是 Windows Chrome/Edge 验收。
- **证据**：维护者 2026-11-18 Vite+ 截图、PowerShell 两项专项退出码 1、质量日志、PR #87、`scripts/studio-browser-targets.mjs` 与 `scripts/studio-browser-targets.cases.mjs`、`docs/VALIDATION.md`。

### E-050 · 数据库专项新用例多余解构触发 Vite+ 未使用参数错误（第三十五批第五小批）

- **现象**：维护者 2026-11-18 在 PR #89 Windows 分支运行 `vp check --fix`，`apps/server/test/projects-cas-cookie-http.db-spec.ts:539` 同时报告 `eslint(no-unused-vars)` 和 `typescript(TS6133)`，均指向新增测试的 `sessionA` 解构。格式化完成，但代码检查仍是 **1 个错误、1 个警告**，不可声称通过。
- **根因**：新增“版本推进后旧预检 409”用例从 `withFixture` 解构了 `sessionA`，但实际通过 `{ tenantId, subjectId: subjectA }` 构造可信仓储主体，只在 HTTP GET 中使用 `sessionB`；会话 `sessionA` 从未读取。这是测试参数多取，不是服务端认证或事务逻辑失效的证据。
- **最小修复**：只把该用例的 `async ({ tenantId, sessionA, sessionB })` 改为 `async ({ tenantId, sessionB })`。不修改 `subjectA`、任何测试断言、随机租户清理、数据库白名单或生产代码。
- **防复发**：对新增回调中的参数解构逐项检查使用位置；区分真实会话变量与既有主体标识常量；PR 创建前运行 `vp check` 并确保错误和警告均为零，不以“格式化成功”替代 Lint/类型检查。
- **验证边界**：已从 GitHub 最新分支重新读取修复后的目标文件，静态确认该测试块不再出现 `sessionA`，原 409/不兼容报告断言仍在；**修复后 Windows `vp check`、`pnpm run ready` 与独立 `pnpm run test:db` 尚未执行**。不能将静态核对冒充完整复验。
- **证据**：维护者本轮原始 `vp check --fix` 输出、PR #89、`apps/server/test/projects-cas-cookie-http.db-spec.ts`、`docs/VALIDATION.md`。

### E-051 · OIDC 发布预检测试将联合类型的数组当对象展开（第三十五批第六小批）

- **现象**：维护者 2026-11-18 在 PR #90 Windows 分支执行 `vp check --fix`，`scripts/test-oidc-release-preflight.cases.mjs:190` 的 `body: { ...old.body, ...change.patch }` 触发 `typescript(no-misused-spread)` **1 条警告、0 错误**；格式化完成不等于 Lint 零告警。
- **确认根因**：测试夹具的 `Map` 同时存放工程列表数组、历史版本数组及发布预检报告对象；`map.get(path)?.body` 因此可能是数组。原代码未证明其为非数组对象就展开，正好重复违反 E-003 的类型安全规则。这是 Mock 类型收窄缺失，不是发布预检服务端写入或身份接口故障证据。
- **最小修复候选**：仅在“篡改水位、摘要、正文额外字段及缺少 no-store 必须拒绝”用例的 `map.set` 前增加 `assert.ok(old?.body && !Array.isArray(old.body), "发布预检测试夹具正文必须为对象")`；保证非数组对象之后才执行原来的浅层合并。保留四个负向报告场景及其断言，不更改正式 API、浏览器脚本、安全配置或 Core。
- **防复发**：对由 `Map`、联合类型或 JSON Mock 取出的值，在对象展开前必须明确排除数组与空值；不得以类型断言、禁用规则或 `Object.assign` 模糊数组与对象的差异。提交前执行不带 `--fix` 的 `vp check` 并确认零警告。
- **验证边界**：本轮已从 GitHub 回读新分支文件，确认单处保护断言存在且原四种错误报告和全部 11 条测试仍保留；**修复后的 Windows `vp check`、`test:release:preflight:oidc:config` 与完整 `ready` 尚未执行**，不能声称告警已实测关闭。
- **证据**：维护者 Windows `vp check --fix` 原始输出、PR #90、`scripts/test-oidc-release-preflight.cases.mjs`、`docs/VALIDATION.md`。

### E-052 · OIDC Studio 浏览器只读专项的测试方法绑定与 Fetch 对象隐式字符串化警告（第三十五批第九小批）

- **现象**：2026-11-18 维护者 Windows 在 PR #93 分支运行 `vp check --fix`，测试脚本共 **0 错误、3 条警告**：`scripts/test-oidc-studio-release-preflight.cases.mjs` 的两处 `runtime.fetch` 取值与比较触发 `typescript(unbound-method)`；`scripts/test-oidc-studio-release-preflight.mjs` 的 `String(input)` 触发 `typescript(no-base-to-string)`。自动格式化完成不能代表 Lint/类型检查通过。
- **已确认根因**：测试夹具使用对象方法简写 `async fetch(...) {}`，其签名可能依赖 `this`；将 `runtime.fetch` 当作裸函数值用于比较虽未调用，仍触发无绑定方法检查，重复 E-016 的风险。新浏览器 Fetch 守卫允许 `input` 是未知对象时通过默认 `Object.prototype.toString` 被转换成 `[object Object]`，没有先显式读取 URL/Request 的安全字符串属性。
- **最小修复候选**：仅将测试夹具方法改为箭头属性 `fetch: async (...) => { ... }`，保留原有“可信 Origin 不安装守卫且 Fetch 引用不变”的两项断言；守卫明确只从字符串、Request 的 `url` 或 URL 的 `href` 读取地址，对不符合条件的输入抛出固定中文“真实 Studio 发布预检请求地址无效”，不再调用 `String(input)`。在现有离线用例中增加 URL 对象合法读取和异常对象阻断两条反向校验，**12 项既有测试均保留**；不关闭 Lint、不修改真实 React/Vue/NestJS、OIDC、CAS、草稿或设备逻辑。
- **防复发**：Node 测试中的伪 Fetch 如需比较引用，应优先使用不依赖 `this` 的箭头函数；真实 Fetch 入参属于明确的 `string/Request/URL`，对未知对象应 fail-closed，不依赖隐式字符串化。新增测试/浏览器脚本需要执行未附带 `--fix` 的 `vp check`，确认零警告后再执行离线和真实浏览器专项。
- **验证边界**：三条警告来自用户提供的**修复前** Windows 输出；当前修复已在 GitHub 分支修改了两个文件并保留原有断言。**修复后 Windows 的 `vp check`、`test:release:preflight:oidc:studio:config`、完整 `ready` 与真实 Keycloak 双框架按钮专项尚未执行**，不可将前一轮格式化成功或协作端模拟结果当作修复已实际验收。
- **证据**：维护者 2026-11-18 PowerShell 警告日志、PR #93、`scripts/test-oidc-studio-release-preflight.mjs`、`scripts/test-oidc-studio-release-preflight.cases.mjs`、`docs/VALIDATION.md`。

### E-053 · 发布预检请求中途编辑画布时迟到的授权拒绝被旧文档门禁吞掉（第三十五批第十小批）

- **现象**：静态核对 `apps/web-react/src/studio/ServerReleasePreflight.tsx` 与 `apps/web-vue/src/studio/ServerReleasePreflight.vue`，两端捕获服务端预检请求异常时，把 `isScadaAccessRejection(cause)` 及父级 `invalidateServerAccess` 通知包在“当前文档仍与请求发起时引用相同”的条件内。**尚无 Windows 实际触发该迟到路径的失败日志**；这是源码可确定的潜在安全状态失效缺陷，不能误记为用户现场事故。
- **根因**：本地文档引用检查本来只用于抑制过时的 UI 报告和错误文案，却一并抑制了身份过期、授权撤销的独立状态信号。当用户在只读 GET 挂起时继续编辑，同一工程的新文档对象使延迟返回的 401/403/404 不会通知父级清理受保护工程摘要及 CAS 基线。
- **最小修复候选**：React/Vue 均改为：组件仍挂载时，任何 `isScadaAccessRejection` 先独立通知父级 `invalidateServerAccess`；仅当当前文档与请求时文档仍相同时才显示属于该文档的局部错误。保持原成功结果文档门禁、卸载后忽略、只读四段 GET、画布/草稿不变。原真实 OIDC Studio 浏览器脚本扩展**仅当前隔离页面的一次模拟 401**：在第三条预检 GET 等待时点击真实“+ 文本”，再释放 401，确认 CAS 失效且本地完整 SVG/导出摘要/草稿及自动保存不变。不得向真实 Lab 提交工程或修改 ACL。
- **防复发**：将“过期页面结果不显示”和“身份/权限拒绝必须传播”分为两条独立保护条件；异步请求期间用户切换编辑内容不应复用过时报告，也不得抑制对全会话有效的 401/403/404。原浏览器专项需测试迟到拒绝，不能仅测试用户不编辑时的立即拒绝。
- **验证边界**：本批只在 GitHub 功能分支修改双框架 UI 与原只读浏览器脚本，离线安全门禁从 12 项增为 **13 项**；从最新 GitHub 源码在隔离 V8 模拟运行 **13/13**（非正式 Node 运行结果）。**Windows `vp check`、`test:release:preflight:oidc:studio:config`、完整 `ready`、真实 Keycloak 双框架延迟 401 仍待实测**。
- **证据**：PR #94 候选代码、第三十五批第九小批已合并组件、`scripts/test-oidc-studio-release-preflight.mjs` / `.cases.mjs`、`docs/VALIDATION.md`。

### E-054 · 新 Prisma 模型未生成客户端且数据库测试结果解构遗漏（第三十五批 B 阶段）

- 现象：维护者在 PR #99 Windows 分支运行 vp check --fix，报告 12 项 TypeScript 错误：PrismaClient 类型没有 scadaProjectReleaseState / scadaProjectReleaseEvent delegate；测试中的 grants.map 参数退化为隐式 any；releaseState 未声明。该次格式化完成，但检查失败。
- 已确认根因：
  1. 当前工作区的 Prisma Client 仍是旧 Schema 生成物。仓库的 vp check 不负责生成 Prisma Client，PR 新增模型后必须先执行 pnpm run db:generate，再运行 TypeScript 检查。
  2. apps/server/test/project-api.db-spec.ts 的 Promise.all 新增第五个发布状态查询，却仍只声明四个解构变量，随后直接引用未声明的 releaseState。
  3. Prisma 新增 ScadaProjectReleaseEvent.toVersion 关系时，必须在 ScadaProjectVersion 模型提供匹配的反向关系字段。
- 最小修复：补充 ScadaProjectVersion.releaseTargetEvents 反向关系；将数据库测试解构改为五个变量。不使用 any、类型断言或关闭规则绕过错误。
- 防复发：新增/修改 Prisma model 后，严格按 db:validate、db:generate、vp check 顺序执行；新增 Promise.all 查询时逐项核对数组项与解构变量数量；每条 Prisma relation 必须核对两端模型的正反向关系。
- 验证边界：上述 12 项错误来自维护者提供的修复前 Windows 日志。GitHub PR #99 已修复 Schema 反向关系和测试解构；修复后 Windows db:validate、db:generate、vp check、单元/数据库测试和完整 ready 尚未执行。
- 证据：维护者 2026-11-18 Windows vp check --fix 原始日志、PR #99、apps/server/prisma/schema.prisma、apps/server/test/project-api.db-spec.ts。

### E-055 · 正式发布迁移 SQL 被多轮字符串拼接截断并重复追加（第三十五批 B 阶段）

- 现象：维护者 Windows 对 PR #99 执行 pnpm run db:migrate:deploy，PostgreSQL 在 20261118000000_release_state_and_events 的 CREATE TABLE 中返回 SQLSTATE 42601 / P3018。回读 GitHub 原迁移发现 request_semantic_hash 与 released_content_hash 的正则字符串均缺少结尾，文件后半段重复追加状态/事件约束和 COMMENT 语句。
- 根因：迁移 SQL 在远程文件编辑时被多次字符串替换/追加，未在每次修改后读取完整文件并核对结构；把提交成功误当作文件完整性验证，导致 SQL 语句截断、约束落在 CREATE TABLE 外部且重复出现。
- 修复：完整重建迁移；四条 SHA-256 CHECK 均使用完整的 64 位小写十六进制正则；状态生命周期、事件主体及回滚来源约束放回对应 CREATE TABLE；移除所有重复尾部；迁移增加显式 BEGIN/COMMIT，并将可能已部分执行的 scada_project_grants_permission_check 改为检查约束是否存在后再创建。新增静态回归检查四条哈希约束、两张表和事务边界。
- 防复发：生成 SQL 文件后必须回读完整文件，核对 CREATE TABLE/INDEX/COMMENT 数量、每条 CHECK 的完整闭合、约束归属、无孤立逗号/括号和重复尾段；迁移应在 PostgreSQL 单一事务内完成。静态字符串检查不能替代真实 PostgreSQL 首次/二次迁移。
- 验证边界：维护者已实测 db:validate、db:generate、vp check 均退出码 0；原迁移在 adui_scada 上首次部署 P3018、二次部署 P3009。重建后的 SQL 目前仅完成 GitHub 源码结构静态核对，尚未在任何数据库执行。不能把原失败迁移描述为已回滚，也不能假定失败前的首条 ALTER TABLE 未生效。
- 证据：维护者 2026-11-18 上传的迁移日志、PR #99、apps/server/prisma/migrations/20261118000000_release_state_and_events/migration.sql、apps/server/src/database/prisma-schema-comments.spec.ts。

### E-056 · 工程创建事务新增发布状态后遗漏单元测试事务 Mock（第三十五批 B 阶段）

- 现象：维护者 Windows pnpm run test:unit 和完整 pnpm run ready 均为 615/616，唯一失败位于 apps/server/src/projects/project-api.store.spec.ts 的工程创建用例：tx.scadaProjectReleaseState 为 undefined，读取 create 时抛出 TypeError。
- 根因：生产 PrismaProjectVersionStore.create 已在创建工程后、创建权限前新增 scadaProjectReleaseState.create，但对应 createHarness 的事务客户端 Mock 未新增相同 delegate，也没有更新事务步骤断言。
- 修复：为 createHarness 增加带真实参数类型的 releaseStates.create Mock，记录“创建未发布状态”；将该步骤加入原子写入顺序断言，并核对租户、工程和 releaseGeneration=0。不修改生产事务顺序、不使用 any 或可选链掩盖缺失依赖。
- 防复发：生产 Prisma 事务新增或调整 delegate 时，必须同步检索所有 PrismaClient/事务 tx Mock、$extends Mock 和测试步骤序列；Mock 应反映实际调用契约，不能仅依赖 vp check 通过。
- 验证边界：失败来自维护者上传的真实 Windows 日志。新 Mock 和断言已更新到 PR #99；修复后 Windows test:unit 与完整 ready 尚未重跑。
- 证据：维护者 2026-11-18 Windows Vitest 日志、PR #99、apps/server/src/projects/prisma-project-version-store.ts、apps/server/src/projects/project-api.store.spec.ts。

### E-057 · 数据库迁移验收指令遗漏隔离 URL 覆盖，误连开发库（第三十五批 B 阶段）

- 现象：维护者按助手先前给出的直接 pnpm run db:migrate:deploy 指令执行；Prisma 日志明确显示目标为本机 127.0.0.1:15432/adui_scada，而非隔离测试库 adui_scada_test。随后 pnpm run test:db 因未显式设置 SCADA_TEST_DATABASE_URL，5 个数据库测试文件均在加载阶段按安全规则拒绝启动、没有执行任何测试。
- 根因：助手虽然文字提醒“必须使用 adui_scada_test”，却没有在可复制命令中沿用 docs/HARNESS.md 的 PowerShell 临时覆盖 SCADA_DATABASE_URL / SCADA_TEST_DATABASE_URL 与 try/finally 恢复流程，导致实际 Prisma CLI 继续读取根 .env 的开发库 URL。这是助手提供验收命令不完整，不归咎于维护者。
- 修复：在 PR #99 的验收说明与 docs/HARNESS.md 增加明确的本机 adui_scada_test URL 覆盖、主机/数据库名核验、首次/二次迁移、状态检查、数据库测试及环境恢复步骤；保留测试入口缺少 SCADA_TEST_DATABASE_URL 时 fail-closed 的行为。
- 防复发：任何 Prisma 写迁移或真实数据库测试命令都必须与显式隔离 URL 设置放在同一可复制步骤中；不能只在正文提醒目标库。不得直接在 .env 默认指向 adui_scada 时执行 db:migrate:deploy；不得为通过测试删除 SCADA_TEST_DATABASE_URL 白名单或把测试 URL 改成开发/生产库。
- 当前安全处置：原 adui_scada 中该迁移已登记为失败；是否保留了迁移开始前的首条权限 CHECK 尚待只读查询确认。禁止直接再次部署、执行 migrate resolve、删除约束/表或手工清理 _prisma_migrations，应先核对迁移记录、约束和目标表，再制定针对该数据库的恢复步骤。
- 验证边界：维护者日志已证明错误目标库、P3018/P3009 及测试环境变量缺失；隔离 adui_scada_test 尚未执行本批迁移。修订后的 PowerShell 流程只完成文档静态核对，Windows 真实首次/二次迁移和 test:db 待执行。
- 证据：维护者 2026-11-18 上传的完整 PowerShell 日志、PR #99、docs/HARNESS.md PostgreSQL 隔离测试库章节、apps/server/prisma.config.ts、五个数据库测试文件的 URL 前置校验。

### E-058 · PostgreSQL 只读诊断命令引用已移除 Compose 文件且错误转义系统表标识符（第三十五批 B 阶段）

- **现象**：维护者 Windows 执行数据库只读检查时，Docker Compose 在启动 psql 前报 `compose.postgres.dev.yaml` 不存在；命令未进入容器、未连接 PostgreSQL、未执行任何 SQL。该命令中的 `public.\\_prisma_migrations` 还多写了反斜杠；即使 Compose 路径正确，PostgreSQL 也无法将其解析为预期的系统表标识符。
- **根因**：助手沿用已删除的旧双 Compose 文件路径，没有先读取当前 `deploy/docker/compose.yaml` 与 `scripts/docker-stack.mjs` 的唯一 Compose 参数；同时把 Markdown 转义误带入 PowerShell 双引号中的 SQL。PowerShell 不使用反斜杠转义 SQL 标识符。
- **修复**：只读诊断改用当前唯一文件 `deploy/docker/compose.yaml`、项目 `adui-scada`、服务 `postgres`，并同时加载根 `.env` 与 `.local/docker/compose.env`；系统表写为 `public._prisma_migrations`，不加反斜杠。`docs/HARNESS.md` 已同步修正。
- **防复发**：提供 Docker 命令前先核对 `scripts/docker-stack.mjs` 的 `COMPOSE_ARGS` 和 `deploy/docker/compose.yaml` 服务名；不得从历史文档推断当前文件存在。PowerShell 双引号内 SQL 使用原生 SQL 标识符，不附加 Markdown 转义反斜杠。先运行只读命令，确认输出后再讨论任何数据库恢复动作。
- **验证边界**：首次错误命令仅在 Compose 路径解析阶段失败，没有执行 SQL 或修改数据库。维护者随后使用修正后的当前 Compose 命令在 Windows 实际执行成功，退出码 0；该查询结果进一步记录于 E-059。不得把首次路径错误描述为 PostgreSQL 查询失败。
- **证据**：维护者 2026-11-18 PowerShell 输出、PR #99、`scripts/docker-stack.mjs`、`deploy/docker/compose.yaml`、`docs/HARNESS.md`。

### E-059 · 失败迁移的约束存在性保护误跳过旧版权限定义（第三十五批 B 阶段）

- **现象**：维护者对 `adui_scada` 执行只读检查，确认失败迁移 `20261118000000_release_state_and_events` 的记录存在，`started_at` 有值、`finished_at` 与 `rolled_back_at` 均为空；`scada_project_grants_permission_check` 仍存在，但定义只允许 `project:read`、`version:read`、`version:append`；发布状态表和事件表均不存在。由此确认原迁移首条 ALTER 已持久化，后续 CREATE TABLE 未成功。
- **根因**：重建迁移时为兼容部分失败状态加入“同名约束不存在才创建”的保护。该判断只验证约束名称存在，不验证其定义；在本次真实数据库中旧三项权限约束已存在，因此重试会跳过创建，继续保留不包含 `release:publish` / `release:rollback` 的旧定义，导致数据库与 Prisma 权限动作不一致。
- **最小修复**：新迁移事务内明确执行 `ALTER TABLE ... DROP CONSTRAINT IF EXISTS scada_project_grants_permission_check`，随后按五项权限重新 `ADD CONSTRAINT`。无论首次空库部署还是从本次失败状态恢复，都会得到同一完整约束；DDL 与后续建表、回填和 COMMENT 位于同一个 `BEGIN/COMMIT`。静态测试新增断言，确保先 DROP 再 ADD 且五项权限全部存在。
- **防复发**：迁移恢复不能只按约束名称判断对象存在；必须核对实际定义或采用事务内显式替换。失败迁移恢复前先只读检查 `_prisma_migrations`、约束定义和目标表；修订后的迁移先在独立 `adui_scada_test` 首次/二次部署验证，再考虑开发库恢复。未经维护者明确授权，不执行 `migrate resolve` 或任何现有数据库写入。
- **验证边界**：维护者本轮只读查询退出码 0，已确认数据库名、失败记录、旧 CHECK 定义和两张表缺失。GitHub PR #99 已修订迁移及静态回归；**修复后的 Windows `db:validate`、`db:generate`、`vp check`、单元测试、隔离 PostgreSQL 首次/二次迁移、`test:db` 和 `ready` 均尚未执行**。对 `adui_scada` 的 `migrate resolve` 与迁移重试也尚未授权、尚未执行。
- **证据**：维护者 2026-11-18 PostgreSQL 只读查询原始输出、PR #99、`apps/server/prisma/migrations/20261118000000_release_state_and_events/migration.sql`、`apps/server/src/database/prisma-schema-comments.spec.ts`。

## 三、从已发生问题提炼的预防性门禁

以下是**防复发规则**，并不表示每项都曾发生真实事故：

- **依赖与锁文件**：根 `pnpm-workspace.yaml` Catalog、消费端 `package.json` 与 `pnpm-lock.yaml` 必须保持一致；新增依赖应使用仓库 pnpm Skill 推荐的原生命令生成锁文件。不要手工编造完整 lockfile 或只改 manifest 就声称完成安装。执行 `pnpm install --frozen-lockfile`、`pnpm run deps:check`。
- **Prisma 迁移**：`prisma generate`、Schema 静态注释检查和 `ready` **不能代替真实 PostgreSQL 迁移测试**。任何有写入行为的测试必须连接明确确认的隔离测试库；未经用户明确授权不能修改现有开发或生产数据库。
- **OIDC 与工程权限**：身份、Issuer、Tenant、ACL 及用户数据不能从不可信客户端推断；认证/CSRF/工程 ACL 未完成时保持 `SCADA_OIDC_ENABLED=false` 和服务端 fail-closed，不开放半成品工程接口，也不开放工业设备写入。
- **Vue/React 对等**：共用 Core、工程 Schema、Tag 规则和 API 契约；涉及浏览器存储与 UI 的改动必须安排真实浏览器双框架互通验证。
- **GitHub 审批**：AI 创建或维护 Draft PR 时，必须立即将 Assignee 设为实际 GitHub 账号 `@adui-dev` 并读取 GitHub 返回结果核对；未经维护者本次明确授权不得合并。
- **日志与文档**：修复后的测试结果要记录所用分支/提交、实际命令与退出码；历史失败日志可以保留，但要追加明确的最终结果，不能留下容易误读的“当前仍失败”表述。

## 四、如何持续更新

遇到 AI 造成的新错误时，修复后在「已经发生过的错误」中新增连续编号，至少记录：

| 字段       | 必填内容                                   |
| ---------- | ------------------------------------------ |
| 编号与场景 | `E-010` 起递增，注明模块/批次              |
| 现象       | 真实错误、警告、失败用例或截图结论         |
| 根因       | 已查证的代码或流程原因；未确定时写“待确认” |
| 避免       | 下一次编码前可执行的约束                   |
| 验证       | 能够复验的真实命令、用例或人工步骤         |
| 证据       | 对应代码、PR、ADR、VALIDATION 或 HARNESS   |

新案例不应包含密码、令牌、内部网络/生产设备地址、个人身份信息和完整带凭据日志。只记录可复用的技术结论，不以“记住了”代替入库。

**每次下一项代码改动开始之前，重新从本文件第一节读起。**

> **2026-11-17 E-031 结案补录**：维护者在 Windows 最新复验中确认 React/Vue 类型检查均通过，`vp check` 333 个文件格式正确、188 个受检文件零告警，`ready` 包含 558/558 单测及 49/49 HTTP E2E、双框架及服务端构建成功，双框架 `test:projects:oidc:resume` 的 401/404/远端版本变化模拟全部通过（专项退出码 0）。Vue 同类 TS2339 已在原分支按相同的独立布尔分类修复。此前独立浏览器曾在新一轮基线载入时报受控错误，具体根因未获独立诊断证据，故只记录复验通过，不推断其根因。完整日志未包含本机 HEAD SHA，不能冒充 GitHub 最新文档提交的复验记录。
