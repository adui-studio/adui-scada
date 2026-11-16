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
