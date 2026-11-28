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
4. 写测试时先核对本仓库 Vitest、TypeScript 6、Vite+、Prisma 和浏览器 CDP 的实际约束；错误/日志/测试名称/注释使用简体中文。 新增 JSDoc 类型标签（包括 `@type`）须在同一行保留中文说明；提交前单独执行 `messages:check` 或在环境受限时用未修改的检查器进行局部复现与验证，不以 Lint 通过代替中文门禁。
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
- 验证边界：上述 12 项错误来自维护者提供的修复前 Windows 日志。修复后维护者 Windows 已实测 `db:validate`、`db:generate`、`vp check`（354 格式文件、207 受检文件零警告错误）及 `test:unit`（51/51 文件、618/618 项）退出码均为 0；`docs:check` 88 份通过。`test:db`、隔离 PostgreSQL 首次/二次迁移与完整 `ready` 仍待执行。日志未提供 `git rev-parse HEAD`，不绑定 GitHub 当前 SHA。
- 证据：维护者 2026-11-18 Windows vp check --fix 原始日志、PR #99、apps/server/prisma/schema.prisma、apps/server/test/project-api.db-spec.ts。

### E-055 · 正式发布迁移 SQL 被多轮字符串拼接截断并重复追加（第三十五批 B 阶段）

- 现象：维护者 Windows 对 PR #99 执行 pnpm run db:migrate:deploy，PostgreSQL 在 20261118000000_release_state_and_events 的 CREATE TABLE 中返回 SQLSTATE 42601 / P3018。回读 GitHub 原迁移发现 request_semantic_hash 与 released_content_hash 的正则字符串均缺少结尾，文件后半段重复追加状态/事件约束和 COMMENT 语句。
- 根因：迁移 SQL 在远程文件编辑时被多次字符串替换/追加，未在每次修改后读取完整文件并核对结构；把提交成功误当作文件完整性验证，导致 SQL 语句截断、约束落在 CREATE TABLE 外部且重复出现。
- 修复：完整重建迁移；四条 SHA-256 CHECK 均使用完整的 64 位小写十六进制正则；状态生命周期、事件主体及回滚来源约束放回对应 CREATE TABLE；移除所有重复尾部；迁移增加显式 BEGIN/COMMIT。最初的“约束不存在才创建”恢复保护后来被 E-059 纠正为事务内 DROP CONSTRAINT IF EXISTS 后重新 ADD 五项权限 CHECK。新增静态回归检查四条哈希约束、两张表、事务边界及旧权限约束替换。
- 防复发：生成 SQL 文件后必须回读完整文件，核对 CREATE TABLE/INDEX/COMMENT 数量、每条 CHECK 的完整闭合、约束归属、无孤立逗号/括号和重复尾段；迁移应在 PostgreSQL 单一事务内完成。静态字符串检查不能替代真实 PostgreSQL 首次/二次迁移。
- 验证边界：维护者 Windows 已实测修复后的隔离库首次迁移应用成功、二次部署无待执行项、部署后 `migrate status` up to date；`test:db` 5/5 文件、41/41 项通过；`pnpm run ready` 最终退出码 0（包括 618/618 单测、55/55 HTTP E2E、88 份文档检查及 React/Vue/Server 构建）。原 `adui_scada` 的历史 P3018/P3009 失败迁移仍未恢复；不能把它描述为已回滚，也不能假定失败前的首条 ALTER TABLE 未生效。维护者日志未提供本机 HEAD SHA，故不将结果绑定到具体提交。
- 证据：维护者 2026-11-18 上传的迁移日志、PR #99、apps/server/prisma/migrations/20261118000000_release_state_and_events/migration.sql、apps/server/src/database/prisma-schema-comments.spec.ts。

### E-056 · 工程创建事务新增发布状态后遗漏单元测试事务 Mock（第三十五批 B 阶段）

- 现象：维护者 Windows pnpm run test:unit 和完整 pnpm run ready 均为 615/616，唯一失败位于 apps/server/src/projects/project-api.store.spec.ts 的工程创建用例：tx.scadaProjectReleaseState 为 undefined，读取 create 时抛出 TypeError。
- 根因：生产 PrismaProjectVersionStore.create 已在创建工程后、创建权限前新增 scadaProjectReleaseState.create，但对应 createHarness 的事务客户端 Mock 未新增相同 delegate，也没有更新事务步骤断言。
- 修复：为 createHarness 增加带真实参数类型的 releaseStates.create Mock，记录“创建未发布状态”；将该步骤加入原子写入顺序断言，并核对租户、工程和 releaseGeneration=0。不修改生产事务顺序、不使用 any 或可选链掩盖缺失依赖。
- 防复发：生产 Prisma 事务新增或调整 delegate 时，必须同步检索所有 PrismaClient/事务 tx Mock、$extends Mock 和测试步骤序列；Mock 应反映实际调用契约，不能仅依赖 vp check 通过。
- 验证边界：失败来自维护者上传的真实 Windows 日志。新 Mock 和断言已更新到 PR #99；维护者 Windows 已实测 `test:unit` 51/51 文件、618/618 项通过，工程创建事务用例 13/13 通过；随后完整 `pnpm run ready` 最终退出码 0，服务端构建成功。另一次隔离 PostgreSQL `test:db` 41/41 通过。维护者日志未提供本机 HEAD SHA，不能绑定到具体提交。
- 证据：维护者 2026-11-18 Windows Vitest 日志、PR #99、apps/server/src/projects/prisma-project-version-store.ts、apps/server/src/projects/project-api.store.spec.ts。

### E-057 · 数据库迁移验收指令遗漏隔离 URL 覆盖，误连开发库（第三十五批 B 阶段）

- 现象：维护者按助手先前给出的直接 pnpm run db:migrate:deploy 指令执行；Prisma 日志明确显示目标为本机 127.0.0.1:15432/adui_scada，而非隔离测试库 adui_scada_test。随后 pnpm run test:db 因未显式设置 SCADA_TEST_DATABASE_URL，5 个数据库测试文件均在加载阶段按安全规则拒绝启动、没有执行任何测试。
- 根因：助手虽然文字提醒“必须使用 adui_scada_test”，却没有在可复制命令中沿用 docs/HARNESS.md 的 PowerShell 临时覆盖 SCADA_DATABASE_URL / SCADA_TEST_DATABASE_URL 与 try/finally 恢复流程，导致实际 Prisma CLI 继续读取根 .env 的开发库 URL。这是助手提供验收命令不完整，不归咎于维护者。
- 修复：在 PR #99 的验收说明与 docs/HARNESS.md 增加明确的本机 adui_scada_test URL 覆盖、主机/数据库名核验、首次/二次迁移、状态检查、数据库测试及环境恢复步骤；保留测试入口缺少 SCADA_TEST_DATABASE_URL 时 fail-closed 的行为。
- 防复发：任何 Prisma 写迁移或真实数据库测试命令都必须与显式隔离 URL 设置放在同一可复制步骤中；不能只在正文提醒目标库。不得直接在 .env 默认指向 adui_scada 时执行 db:migrate:deploy；不得为通过测试删除 SCADA_TEST_DATABASE_URL 白名单或把测试 URL 改成开发/生产库。
- 当前安全处置：原 `adui_scada` 中该迁移已登记为失败；维护者只读确认旧三项权限 CHECK 仍存在、两张发布表不存在。修复迁移已在独立 `adui_scada_test` 首次/二次部署及 41/41 数据库测试中通过，但这不代表原开发库已恢复。未经可恢复备份和维护者明确授权，仍禁止对 `adui_scada` 执行 `migrate resolve`、再次部署、删除约束/表或手工清理 `_prisma_migrations`。
- 验证边界：维护者日志已证明最初的错误目标库、P3018/P3009 及测试环境变量缺失。随后维护者使用修订后的 PowerShell `try/finally` 流程在隔离 `adui_scada_test` 完成首次迁移、二次迁移、部署后 status，均退出码 0；`test:db` 5/5 文件、41/41 项通过，完整 `ready` 退出码 0。原 `adui_scada` 仍保持历史失败状态，未执行恢复写入。
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
- **验证边界**：维护者只读查询退出码 0，已确认 `adui_scada` 的失败记录、旧 CHECK 定义和两张表缺失。修复后 Windows 已在隔离 `adui_scada_test` 实测首次迁移、二次迁移和部署后 status 全部退出码 0；`test:db` 5/5 文件、41/41 项通过；完整 `ready` 最终退出码 0。对原 `adui_scada` 的 `migrate resolve` 与迁移重试仍未授权、尚未执行；Windows 日志未提供本地 HEAD SHA。
- **证据**：维护者 2026-11-18 PostgreSQL 只读查询原始输出、PR #99、`apps/server/prisma/migrations/20261118000000_release_state_and_events/migration.sql`、`apps/server/src/database/prisma-schema-comments.spec.ts`。

### E-060 · 将 Prisma 待执行迁移状态的退出码 1 误判为数据库故障（第三十五批 B 阶段）

- **现象**：维护者在本机隔离数据库 `adui_scada_test` 执行 `pnpm run db:migrate:status`，Prisma 成功连接 `127.0.0.1:15432`，报告 5 条迁移已发现，唯一待执行迁移为 `20261118000000_release_state_and_events`，没有报告失败迁移；该命令返回退出码 1。助手先前提供的 PowerShell 包装仅以退出码是否为 0 判断状态，并抛出“隔离数据库迁移状态异常”，导致流程在迁移部署前停止。
- **根因**：把 Prisma CLI 的状态输出与退出码割裂判断，并错误假设“存在 pending migration 时 status 必须退出码 0”。本项目当前 Prisma 7.10.1 的实际 Windows 日志证明：仅有待执行迁移时也会返回 1；不能用通用经验覆盖仓库实际版本输出。
- **最小修复**：本次不修改 Prisma 或数据库。将状态结果解释为“5 条已应用、1 条待执行、未见 failed migration”，直接进入隔离库首次 `migrate deploy`；部署后再运行 `migrate status`，此时应输出 up to date 且退出码 0。
- **防复发**：执行 `migrate status` 时同时检查完整文本和退出码。输出仅列出待执行迁移且未出现失败迁移/P3009 时，属于正常部署前状态；出现 failed migration、P3009、连接错误或其他数据库错误时才停止。不要把所有非零退出码一概忽略，也不要只凭退出码判断迁移是否失败。
- **验证边界**：维护者先实测隔离库状态为 5 条迁移已发现、1 条待执行，status 退出码 1；随后使用 `try/finally` 在同一 `adui_scada_test` 完成首次部署、二次部署和部署后 status，均退出码 0，`test:db` 5/5 文件、41/41 项通过，完整 `ready` 最终退出码 0。PowerShell 环境变量已按 finally 恢复。
- **证据**：维护者 2026-11-19 Windows `pnpm run db:migrate:status` 原始输出、PR #99、`apps/server/package.json` 的 `db:migrate:status` 脚本、`docs/HARNESS.md`。

### E-061 · 新增发布状态外键后数据库测试夹具未按依赖顺序清理（第三十五批 B 阶段）

- **现象**：维护者 Windows 在隔离库 `adui_scada_test` 完成正式发布迁移首次部署、二次部署和 `migrate status`，均退出码 0；随后 `pnpm run test:db` 为 4 个文件通过、1 个文件失败，30 项通过、11 项失败。11 项全部集中在 `projects-cas-cookie-http.db-spec.ts` 的 `withFixture` finally 清理阶段，删除 `scada_projects` 时触发 `scada_project_release_state_project_fkey`。
- **根因**：`PrismaProjectVersionStore.create` 已为每个新工程创建 `ScadaProjectReleaseState`，该状态通过 `ON DELETE RESTRICT` 外键引用工程。旧双 Cookie HTTP 测试夹具仍按旧顺序删除审计、版本、授权后直接删除工程，没有先清理发布状态。类似清理逻辑也存在于工程版本 DB 测试；工程 API DB 测试虽已删除发布表记录，但原顺序先删事件再删状态，与状态对最后事件的外键方向不一致。
- **最小修复**：在 `projects-cas-cookie-http.db-spec.ts` 和 `prisma-project-version.db-spec.ts` 的租户清理中，先删除 `ScadaProjectReleaseState`，再删除 `ScadaProjectReleaseEvent`，然后按审计、版本、授权、工程顺序清理；在 `project-api.db-spec.ts` 将状态/事件删除顺序调整为状态在前、事件在后。只修改测试夹具，不删除或放宽任何生产外键，不修改迁移和业务数据。
- **错误日志辨析**：日志中 `数据库工程版本元数据与快照不一致` 来自最后一个用例主动篡改随机租户版本摘要；该用例明确期待 HTTP 500 且检查响应不泄漏内部错误。它不是这 11 项失败的共同根因；实际失败栈均指向 finally 中删除工程时的 RESTRICT 外键。
- **防复发**：新增带 RESTRICT 外键的业务表后，必须检索全部真实 PostgreSQL 测试夹具的 teardown/afterAll；按引用方向先删引用方，再删被引用方。发布状态引用最后事件，因此先删状态；发布事件引用历史版本，因此再删事件，之后才能删版本和工程。不得通过 CASCADE、删除外键或放宽 RESTRICT 规避测试清理问题。
- **验证边界**：首次修复前，维护者实测 `test:db` 为 4/5 文件、30/41 项通过；三处清理代码按外键依赖顺序修复后，维护者再次实测 `test:db` 5/5 文件、41/41 项通过，双 Cookie HTTP CAS 用例 11/11 通过；完整 `pnpm run ready` 最终退出码 0。修复仅修改测试清理逻辑与文档，没有修改数据库、迁移 SQL 或生产外键。
- **证据**：维护者 2026-11-19 Windows `test:db` 日志、PR #99、`apps/server/test/projects-cas-cookie-http.db-spec.ts`、`apps/server/test/prisma-project-version.db-spec.ts`、`apps/server/test/project-api.db-spec.ts`、`apps/server/prisma/schema.prisma`。

### E-062 · 正式发布状态的末次事件与不可变版本缺少租户工程代次及摘要复合闭包（第三十五批 B 阶段）

- **发现方式**：对 PR #99 的 Prisma Schema、已应用迁移和 ADR-0069 I-01/I-02 做静态代码评审时发现。原 lastReleaseEventId 仅以全局 UUID 引用发布事件；发布状态与发布事件、不可变版本的修订号和 SHA-256 摘要也没有全部绑定。**没有证据表明该缺口已被正式发布 API 使用或造成真实跨工程数据写入**；当时发布 API 尚未实现。
- **风险**：数据库原约束允许发布状态引用另一工程的事件；也允许状态/事件中的修订号存在但其内容摘要与实际不可变版本不一致，或状态代次与最后事件代次不一致。这违反 I-01/I-02 对指针、代次、事件、租户和工程闭包的要求。
- **最小修复**：不修改已在隔离 PostgreSQL 应用的 20261118000000_release_state_and_events。新增 20261119000000_release_state_event_integrity 增量迁移：为不可变版本建立 tenant/project/revision/contentHash 复合唯一键；发布事件来源/目标版本和发布状态目标版本均使用包含 SHA-256 的复合外键；发布状态末次事件使用包含租户、工程、代次、目标修订、目标摘要和事件 UUID 的复合外键。Prisma Schema 同步建模这些关系，并为复合外键提供必要索引及中文索引注释。
- **防复发**：多租户数据模型中的跨表引用不能只使用全局 ID；应将 tenantId、projectId 与业务修订号、内容摘要、代次一起纳入复合键/外键。涉及不可变快照时必须将摘要绑定到版本主键；涉及状态指针时必须让指针、最后事件和代次保持数据库级一致，不能只依赖未来应用层校验。
- **验证边界**：维护者 2026-11-19 Windows 已在本机隔离 `127.0.0.1:15432/adui_scada_test` 实测第二条迁移 `20261119000000_release_state_event_integrity` 首次部署成功（退出码 0）、二次部署无待执行迁移（退出码 0）、`migrate status` 为 up to date（退出码 0）；`pnpm run test:db` 为 **5/5 文件、42/42 项通过**（退出码 0）。其中发布 Schema 测试 6/6，包含跨工程事件引用、错误代次、错误状态摘要、错误事件目标摘要拒绝及合法关联成功。`TypeError: 数据库工程版本元数据与快照不一致` 是另一个随机测试租户主动篡改摘要的预期 HTTP 500 负向用例日志，该用例通过，不是数据库测试失败。此次结果证明 E-062 复合引用闭包已由真实 PostgreSQL 验证；原开发库 `adui_scada` 未执行恢复写入。
- **证据**：PR #99、apps/server/prisma/schema.prisma、apps/server/prisma/migrations/20261119000000_release_state_event_integrity/migration.sql、apps/server/test/release-schema.db-spec.ts、apps/server/src/database/prisma-schema-comments.spec.ts、ADR-0069 I-01/I-02。

### E-063 · Prisma Schema 字段级 @relation 属性被错误拆分为多行（第三十五批 B 阶段）

- **现象**：维护者 2026-11-19 Windows 在 PR #99 最新候选执行 `pnpm run db:validate`，Prisma 7.10.1 报 P1012、28 条 Schema 解析错误，集中在 `schema.prisma` 的 `releasedVersion`、`lastReleaseEvent`、`fromVersion`、`toVersion` 四个字段。`pnpm run db:generate` 同样因 P1012 失败；`pnpm run test:unit` 在 Vitest 启动前调用 `db:generate`，因此也未进入单元测试。同期 `vp check` 355 个文件格式正确、207 个受检文件零警告/错误；`docs:check` 89 个 Markdown 通过。
- **根因**：Prisma Schema 的字段级 `@relation(...)` 属性被按多行函数调用方式编写。Prisma Schema Language 将字段定义按单行解析，换行后的关系参数被当作独立字段/属性，导致 `This line is not a valid field or attribute definition`。这不是 SQL 迁移语法或 PostgreSQL 连接问题。
- **最小修复**：将四个字段的完整 `@relation(...)` 属性恢复为单行声明，保留原关系名称、fields、references、onDelete 和 onUpdate 参数；新增静态回归，要求每个包含 `@relation(` 的字段行同一行存在闭合 `)`。不修改已应用迁移、数据库、权限逻辑或复合外键设计。
- **防复发**：Prisma Schema 关系属性必须按仓库 Prisma 7.10.1 的实际语法保持单行；不能把 TypeScript/JavaScript 的多行函数调用格式套用到 `.prisma` 字段定义。新增或修改关系后必须先执行 `pnpm run db:validate`，再 `pnpm run db:generate`，之后才执行 `vp check`、单元测试和数据库专项。
- **验证边界**：E-063 的 28 条字段解析错误已在维护者后续 Windows `db:validate` 中消失，随后暴露的独立一对一唯一性问题另记为 E-064。E-064 修复后，Prisma Client 7.10.1 已在 Windows 单元测试与完整 `ready` 中成功生成；单测 **620/620**、隔离 PostgreSQL **42/42**、完整 `ready` 退出码 0。故 E-063 的字段级语法问题已关闭；这些后续结果不改变本案例最初的错误事实。
- **证据**：维护者 2026-11-19 Windows 原始 P1012 日志、PR #99、`apps/server/prisma/schema.prisma`、`apps/server/src/database/prisma-schema-comments.spec.ts`、`docs/VALIDATION.md`。

### E-064 · Prisma 一对一关联复合唯一键包含可空字段（第三十五批 B 阶段）

- **现象**：维护者 2026-11-19 Windows 在 HEAD `e02e48e4ae46fb0e02ab6ee3ab3b21872d58134f` 重新执行 `db:validate`，此前 E-063 的 28 条 Schema 解析错误已消失，但 Prisma 7.10.1 又报告 1 条 P1012：`lastReleaseEvent` 一对一关系的 defining side 六个关联字段不具备匹配的唯一约束。`db:generate` 同样失败；`test:unit` 在生成 Client 阶段中止，Vitest 未启动。同期 `vp check` 355 个文件格式正确、207 个受检文件零警告/错误；`docs:check` 89 个 Markdown 通过。
- **根因**：该关系原先同时把 `tenantId`、`projectId`、`releaseGeneration`、可空 `releasedRevision`、可空 `releasedContentHash`、可空 `lastReleaseEventId` 作为 Prisma 关系标量。Prisma 提示添加六字段 `@@unique`，但 Prisma Schema 规则要求 `@@unique` 中的字段全部必填；当前三个发布指针字段必须可空以表达“尚未发布”，不能为了通过校验将其改为必填或伪造复合唯一键。`lastReleaseEventId` 本身已有单字段 `@unique`，对应数据库唯一索引。
- **最小修复**：Prisma ORM 的一对一导航关系仅使用已有唯一字段 `lastReleaseEventId -> ScadaProjectReleaseEvent.eventId`；保持 `lastReleaseEventId` 可空且 `@unique`。数据库层不降级：已存在的 `20261119000000_release_state_event_integrity` 仍通过六字段复合外键校验租户、工程、代次、目标修订、目标摘要和事件 UUID。无需新增或修改迁移，也不需要增加重复唯一索引。
- **防复发**：Prisma ORM 关系映射与 PostgreSQL 额外约束可以分层：当复合关系包含可空字段、无法声明 Prisma `@@unique` 时，可用稳定且全局唯一的业务键表达 ORM 导航关系，同时必须保留并测试数据库更强的复合外键。不要把可空业务状态字段改成必填，不要把一对一关系改成一对多来规避校验，也不要因 ORM 无法表达全部列而删除数据库级租户/工程闭包。
- **验证边界**：E-064 修复后，Prisma Client 7.10.1 在 Windows `test:unit` 和完整 `ready` 中均成功生成；单测 **620/620**、Vite+ 355 个文件格式正确/207 个受检文件零警告错误、`docs:check` 89 份通过、完整 `ready` 退出码 0。随后隔离 PostgreSQL 第二条迁移首次/二次部署、`migrate status` 和 `test:db` **42/42** 均通过。Prisma ORM 使用唯一事件 ID 的一对一导航关系与 PostgreSQL 六字段复合外键同时得到验证；本案例已关闭。维护者日志未附 `git rev-parse HEAD`，不能把测试结果严格绑定到当前远端 SHA。
- **证据**：维护者 2026-11-19 Windows P1012 日志、PR #99、`apps/server/prisma/schema.prisma`、`apps/server/prisma/migrations/20261119000000_release_state_event_integrity/migration.sql`、`apps/server/src/database/prisma-schema-comments.spec.ts`、Prisma 7 Schema API 对 `@@unique` 必填字段的规则。

### E-065 · 发布末次事件复合外键静态断言误将 SQL 排版当成约束错误（第三十五批 B 阶段）

- **现象**：维护者 2026-11-19 Windows 复验中 `pnpm run db:validate` 与 `db:generate` 均退出码 0，Prisma Client 7.10.1 成功生成；`vp check` 355 个文件格式正确、207 个受检文件零警告/Lint/类型错误，`docs:check` 89 份通过。单元测试进入 Vitest 后为 **619/620**，仅 `apps/server/src/database/prisma-schema-comments.spec.ts` 的“发布状态、事件与不可变版本通过复合外键保持租户工程代次和摘要闭包”失败；`test:unit` 退出码 1。
- **确认根因**：静态测试对 `20261119000000_release_state_event_integrity/migration.sql` 使用单行 `toContain('FOREIGN KEY (...)')` 和 `toContain('REFERENCES ... (...)')`，但真实迁移将六个字段逐行排版，严格字符串匹配因此失败；同一六字段 `FOREIGN KEY` 断言还被意外重复写入。现有日志**没有执行数据库迁移或真实 PostgreSQL 外键负向测试**，不能把这一次静态断言失败解释成已发现数据库外键缺失，也不能称真实外键已通过。
- **最小修复**：只修正 `prisma-schema-comments.spec.ts` 中的六字段末次事件检查，先对迁移 SQL 与预期完整约束片段分别消除排版空白，再匹配同一个 `ADD CONSTRAINT`、六个外键字段、六个目标字段和 `ON DELETE RESTRICT ON UPDATE CASCADE` 的连续组合；移除重复断言。其他摘要/版本外键、事务、索引及中文注释检查原样保留。**不修改任何 Prisma Schema、迁移 SQL、数据库或正式发布业务逻辑**。
- **防复发**：静态 DDL 校验对多行 `FOREIGN KEY/REFERENCES` 不能默认单行排版；只归一化空白、不归一化字段名称或顺序，并让外键与其目标表、引用字段、约束名保持同一组合校验。对 SQL 校验脚本先用真实迁移文本做正向匹配，再用错误列名/列序或错误删除规则做负向自检；不可通过删除安全断言或回改已应用迁移使测试变绿。
- **验证边界**：修复后维护者 Windows 实测 `pnpm run test:unit` **51/51 文件、620/620 项通过**，`vp check` 355 个文件格式正确、207 个受检文件零警告/Lint/类型错误，`docs:check` 89 份通过，完整 `pnpm run ready` 退出码 **0**；随后隔离 PostgreSQL 新迁移首次/二次部署、status 均退出码 0，`test:db` **5/5 文件、42/42 项通过**。因此该静态断言误报已修复并通过 Windows 与真实 PostgreSQL 验收。数据库测试日志中的元数据/快照不一致 TypeError 属于主动篡改摘要的预期负向用例，最终 42 项全部通过。用户提供的最新日志未附本地 `git rev-parse HEAD`；当前 GitHub 分支在本轮记录时为 `d217dde085a5654d8dfe4cc01ef3756ab338466e`，测试结果不作超出日志的 SHA 绑定声明。
- **证据**：维护者 2026-11-19 Windows 复验日志、PR #99、`apps/server/src/database/prisma-schema-comments.spec.ts`、`apps/server/prisma/migrations/20261119000000_release_state_event_integrity/migration.sql`、`docs/VALIDATION.md`。

### E-066 · 正式发布事务单测 Mock 缺少显式类型并触发 unbound-method（第三十五批 C1，已关闭）

- **现象**：维护者 2026-11-19 Windows 首次执行 `vp check --fix`，`apps/server/src/projects/prisma-project-release-store.spec.ts` 报告 8 条警告、0 个错误：7 处 `vitest(require-mock-type-parameters)`，另有 1 处 `typescript(unbound-method)`。
- **根因**：新增测试夹具没有沿用仓库 E-005 的显式 `vi.fn<真实函数签名>()` 约束；安全门禁夹具把生产类方法与测试 Mock 作为联合对象暴露，随后将类方法直接传入 `expect`。
- **最小修复**：为 7 个 Mock 补充明确函数签名及返回类型；将测试安全门禁 Mock 独立暴露为 `gateAssertReady`，断言不再解引用类实例方法。未修改生产服务、事务顺序或测试场景。
- **防复发**：新增 Prisma/Vitest 事务测试时，Mock 输入和返回值按真实调用契约显式类型化；断言调用次数时保留独立箭头 Mock 引用。提交前执行不带 `--fix` 的 `vp check`，要求零警告、零错误。
- **验证结论**：维护者随后 Windows 实测 `vp check` **359 个文件格式正确、211 个受检文件零警告/Lint/类型错误，退出码 0**；发布事务定向测试 13/13、全量 `pnpm run test:unit` 52/52 文件且 633/633 项通过，退出码 0。E-066 已关闭。完整 `ready` 和真实 PostgreSQL 专项仍分别待执行，不能由本次单测代替。
- **提交绑定说明**：维护者本轮终端日志未提供本地 `git rev-parse HEAD`。GitHub 候选分支当前 HEAD 为 `7c619941f486b639298e4015d6538b995919d8c5`，但不将未提供的本地 SHA 伪写为实测绑定。
- **证据**：维护者 2026-11-19 Windows `vp check --fix` 与后续 `vp check`、`test:unit` 日志；候选分支 `apps/server/src/projects/prisma-project-release-store.spec.ts`。

### E-067 · 发布请求单测用统一错误正则掩盖了目标修订不匹配的专属校验（第三十五批 C1，已关闭）

- **现象**：维护者 2026-11-19 Windows 首次复验中 `vp check` 已零警告；`pnpm run test:unit` 为 51/52 文件、632/633 项通过，唯一失败是发布仓储无效输入测试收到“首次正式发布目标必须等于预期工程 head 修订号”，而统一断言只接受“正式发布请求”或“Idempotency-Key”。
- **根因**：请求白名单、目标修订与预期 head 不一致、幂等键格式错误被放进同一循环，却共用一个宽泛错误正则；生产校验按设计触发了目标修订专属错误，测试错误地将其判为失败。
- **最小修复**：为七类非法输入分别声明 `expectedMessage`，精确匹配请求白名单、目标修订不一致和 Idempotency-Key 错误；保留“非法输入不得开启数据库事务”的断言。没有修改生产校验逻辑或错误文案。
- **防复发**：参数化测试混合不同校验层级时，每个用例必须携带自己的错误类别；同时断言拒绝原因和副作用边界，避免使用宽泛正则掩盖实际分支。
- **验证结论**：维护者 Windows 定向测试 `vp test run apps/server/src/projects/prisma-project-release-store.spec.ts` **13/13 通过**，退出码 0；全量 `pnpm run test:unit` **52/52 文件、633/633 项通过**，退出码 0；`vp check` **359 个文件格式正确、211 个受检文件零警告/Lint/类型错误**，退出码 0；`docs:check` **89 个 Markdown 通过**，退出码 0。E-067 已关闭。HTTP E2E、真实 PostgreSQL `test:db` 和完整 `ready` 尚未执行，不能将其写为通过。
- **提交绑定说明**：维护者本轮终端日志未提供本地 `git rev-parse HEAD`。GitHub 候选分支当前 HEAD 为 `7c619941f486b639298e4015d6538b995919d8c5`，但不将未提供的本地 SHA 伪写为实测绑定。
- **证据**：维护者 2026-11-19 Windows 定向测试、全量单测、`vp check`、`docs:check` 日志；候选分支 `apps/server/src/projects/prisma-project-release-store.spec.ts`。

### E-068 · C1 PostgreSQL 验收指令再次遗漏显式隔离 URL 环境设置（第三十五批 C1，待复验）

- **现象**：维护者 2026-11-19 Windows 执行 `pnpm run test:db`，此前 `docs:check` 89 份 Markdown 通过、`vp check` 359 个文件格式正确且 211 个受检文件零警告/错误，均退出码 0；数据库专项的 6 个测试文件全部在模块加载时因 `SCADA_TEST_DATABASE_URL` 未设置而退出，Vitest 显示 6 个失败 Suite、0 个测试，命令退出码 1。失败位置分别是 OIDC Schema、工程版本、工程 API、双会话 HTTP、发布 Schema 和正式发布事务 DB spec 的 URL 前置保护。
- **根因**：此前助手只要求“按 `docs/HARNESS.md` 的 PowerShell `try/finally` 流程执行”，却没有在回复中给出本轮可直接复制的环境设置命令。维护者随后直接运行裸 `pnpm run test:db`，当前 PowerShell 进程没有 `SCADA_TEST_DATABASE_URL`。这是对历史 E-057 同类问题的再次复发，属于助手验收指引不完整，不归咎于维护者。
- **影响边界**：测试文件在导入阶段即 fail-closed，Vitest 没有执行任何 DB 测试用例；日志没有显示连接 PostgreSQL、执行 SQL、创建/删除随机租户或修改数据库。该失败不能解释为发布事务、数据库约束或并发测试失败。`pnpm run test:db` 前置的 Core 构建和 Prisma Client 7.10.1 生成已成功。
- **最小修复**：在 `docs/HARNESS.md` 增加 C1 专用“仅运行 test:db、不执行迁移”的完整 PowerShell `try/finally` 代码块：从根 `.env` 读取开发 URL，只在当前进程将数据库名替换为 `adui_scada_test`，验证 URL scheme/host/path，设置 `SCADA_DATABASE_URL` 与 `SCADA_TEST_DATABASE_URL`，运行测试并在 `finally` 恢复两个原值。不修改测试 URL 白名单、不修改生产代码、不执行迁移。
- **防复发**：凡要求真实 PostgreSQL 测试，回复必须把环境设置、隔离目标验证、测试命令和 `finally` 恢复写在同一个可复制 PowerShell 代码块中；只写“参考 HARNESS”或“临时指向隔离库”不算完整指引。C1 不新增 Prisma 迁移，不要把 B 阶段 `migrate deploy/status` 模板原样带入本轮。
- **验证结论（已关闭）**：维护者随后按 `docs/HARNESS.md` 的 C1 专用 PowerShell `try/finally` 包装，在本机隔离 `adui_scada_test` 执行 `pnpm run test:db`，**6/6 文件、52/52 用例通过，退出码 0**。同一轮最终验收中 `vp check` 为 359 个文件格式正确、211 个受检文件零警告/Lint/TypeScript 错误；`docs:check` 89 个 Markdown 通过；完整 `pnpm run ready` 退出码 0。首次裸命令因缺少测试 URL 在导入阶段 fail-closed、没有执行用例的历史事实仍保留；后续隔离包装已验证可正常运行。C1 不新增迁移；原开发库 `adui_scada` 的历史失败迁移继续冻结。
- **证据**：维护者 2026-11-19 上传的 `pnpm run test:db` 原始 Vitest 输出；`apps/server/test/release-transaction.db-spec.ts` 及其他五个 DB spec 的 `SCADA_TEST_DATABASE_URL` 导入前置校验；`docs/HARNESS.md` 的隔离 PostgreSQL 既有模板。

### E-069 · 双 Cookie PostgreSQL 测试模块遗漏正式发布仓储依赖

- **现象**：维护者 2026-11-19 Windows 在正确设置隔离数据库环境变量后运行服务端真实 PostgreSQL 专项。Core Node 构建与 Prisma Client 7.10.1 生成成功；六个数据库 Suite 中五个通过，分别为 OIDC Schema 6/6、工程版本 12/12、工程 API 7/7、发布 Schema 6/6、正式发布事务 10/10。唯一失败的 `projects-cas-cookie-http.db-spec.ts` 在 NestJS 测试模块初始化时抛出 `Nest can't resolve dependencies of the ProjectApiController (PrismaProjectVersionStore, ?)`，缺少 `PrismaProjectReleaseStore`。Vitest 汇总为 5/6 文件通过、41 项通过、11 项跳过、1 个 Suite 失败，退出码 1；该文件 11 项测试没有执行。
- **根因**：正式 `ProjectApiController` 构造函数已从仅注入 `PrismaProjectVersionStore` 扩展为同时注入 `PrismaProjectReleaseStore`；生产 `ProjectPersistenceModule` 已注册两个仓储及 `ProjectReleaseSafetyGate`，但双 Cookie 真实 HTTP 数据库测试使用手工 `Test.createTestingModule`，只注册旧版本仓储，遗漏新发布仓储及其安全门禁依赖。这是测试模块装配未随 Controller 构造依赖同步更新，不是 PostgreSQL 约束或发布事务断言失败。
- **最小修复**：仅在 `apps/server/test/projects-cas-cookie-http.db-spec.ts` 中导入并将真实 `PrismaProjectReleaseStore`、默认 fail-closed 的 `ProjectReleaseSafetyGate` 注册到测试模块 providers；沿用该测试模块已有的真实隔离 `PrismaService`。不修改生产 Controller、生产模块、发布事务、权限、Schema、迁移或数据库。
- **防复发**：任何 NestJS Controller 构造函数依赖变化，都必须检索所有手工 `Test.createTestingModule` / `controllers: [该 Controller]` 测试模块并核对完整 provider 图。真实 PostgreSQL HTTP 测试应注册真实仓储及生产默认安全门禁；不能用空对象或放行型 Mock 掩盖依赖缺失，也不能因当前用例暂不访问新路由就忽略 Controller 必须完成实例化的依赖。
- **验证结论（已关闭）**：修复提交 `055e2115174fba27cc745f2277e251b94ab4eb74` 补齐真实 `PrismaProjectReleaseStore` 与默认 fail-closed 的 `ProjectReleaseSafetyGate` Provider。维护者随后 Windows 实测 PostgreSQL 专项 **6/6 文件、52/52 用例通过，退出码 0**，其中双 Cookie HTTP CAS 11/11、正式发布事务 10/10；`vp check` 359 个文件格式正确、211 个受检文件零警告/Lint/TypeScript 错误；`docs:check` 89 个 Markdown 通过；完整 `pnpm run ready` 退出码 0。PR #100 已 Squash 合并，合并提交 `8db55e4b1bb97d69c08dc9238eb61f76071b7e72`；上述测试对应合并前验收 HEAD `f576cacaadd2376f8e75d5270482ac9a356f81ed`。原始 5/6、41 passed 是修复前的模块装配失败，保留为历史证据；E-069 已关闭。生产安全门禁仍默认拒绝。
- **证据**：维护者 2026-11-19 Windows PostgreSQL 测试日志；`apps/server/src/projects/project-api.controller.ts`；`apps/server/src/projects/project-persistence.module.ts`；`apps/server/src/projects/prisma-project-release-store.ts`；`apps/server/src/projects/project-release-safety-gate.ts`；PR #100 修复提交 `055e2115174fba27cc745f2277e251b94ab4eb74`。

### E-070 · D5a 浏览器输入原生 setter 解引用触发 unbound-method（第三十五批 D5a，已关闭）

- **现象**：维护者 2026-11-20 Windows 执行 `vp check --fix`，`scripts/test-oidc-published-runtime-readonly.mjs:104` 报 `typescript(unbound-method)`，224 个检查文件中 0 错误、1 警告；格式化完成不代表质量门禁通过。
- **根因**：为模拟真实 React/Vue 受控输入，浏览器专项从 `HTMLInputElement.prototype` 的 `value` 属性描述符抽取 `set` 函数再调用 `.call(input, projectId)`。虽然显式绑定了接收者，但对原生方法的独立函数引用被 Vite+ 的 `unbound-method` 规则拒绝。
- **最小修复**：保留原生 `value` setter 存在性检查，改用 `Reflect.set(inputPrototype, "value", projectId, input)`，由属性设置机制以 `input` 为 receiver 调用原生 setter；仍派发冒泡 `input` 事件。原页面导航、工程 ID 白名单、同源只读请求及安全断言不变；在原 10 项门禁测试中扩充受控输入自有 setter 旁路、原生 setter 的 `this`、事件派发及无 setter 拒绝断言，并通过独立 VM 执行页面函数验证没有 Node 词法依赖。
- **防复发**：受控输入的浏览器脚本应保留原生 setter 与事件语义，不以 `input.value = ...` 替代；避免把可能依赖 `this` 的原生方法解引用为独立变量，也不要全局忽略 `unbound-method`。相关回归应覆盖原生 receiver、事件与无 setter 的 fail-closed。
- **验证结论**：维护者 2026-11-20 Windows 实测 D5a `test:published:oidc:config` 10/10 通过、`vp check` 372 个格式文件 / 224 个受检文件零警告错误、`docs:check` 89 份通过、完整 `ready` 包含 680/680 单测与 62/62 HTTP E2E 且退出码 0。E-070 的 setter Lint 问题已关闭；本地日志未附 Git HEAD，不将这些结果严格绑定到远程 SHA。真实浏览器专项另有独立等待逻辑错误，记录为 E-071。
- **证据**：维护者 Windows `vp check --fix` 原始日志、PR #106、`scripts/test-oidc-published-runtime-readonly.mjs`、`scripts/test-oidc-published-runtime-readonly.cases.mjs` 与 `docs/VALIDATION.md`。

### E-071 · D5a 登录后等待函数误引用不存在的 browser 并吞没异常（第三十五批 D5a，已关闭）

- **现象**：维护者 2026-11-20 Windows 的 D5a 离线 10/10、`vp check` 372/224 零告警、`docs:check` 89 份与完整 `ready` 退出码 0，随后真实 `test:published:oidc:browser` 在人工 Keycloak 登录成功后报“正式发布运行只读专项真实登录失败”，退出码 1。该诊断并不能证明登录失败。
- **根因**：脚本先通过共享 `waitForLogin` 成功取得可信 BFF 主体，才进入双 Origin 循环。该循环调用外部 `waitForState(fn)`：它错误地访问仅定义于 `run()` 局部作用域的 `browser`，又对已经包含 `browser.evaluate(...)` 的回调重复调用 `browser.evaluate(fn)`。未定义标识符产生的 `ReferenceError` 被通用 `catch` 静默吞掉，最终所有重试均失败并误报“真实登录失败”。现有代码与唯一报错路径共同支持本次定位；后续页面行为仍待复测。
- **最小修复**：`waitForState` 直接 `await fn()`，不引用外层 `browser`；只重试已知的 CDP 导航执行异常“隔离浏览器页面执行失败”，其他错误立即向上抛出并在顶层安全脱敏。首次登录与 React/Vue 重新导航后的 BFF 会话失败使用不同的固定中文标签。新增两项 Node 用例，验证回调确实调用、导航切换重试、非导航错误立即失败和合法超时拒绝；保留真实同主体、404、零快照和零工程写入断言。
- **防复发**：浏览器异步等待器的参数必须明确是“操作函数”还是“浏览器页面函数”，不允许在 helper 中重复序列化；作用域中的 CDP Session 要作为参数或由调用者闭包封装。重试仅针对已知暂时性错误，不能用无差别 `catch` 把 `ReferenceError` 等编码错误伪装成登录与业务失败。Node 回归测试必须在没有全局 `browser` 的独立环境执行。
- **验证边界**：本批修复后需在 Windows 最新 HEAD 执行 `pnpm run test:published:oidc:config`、`vp check`、`pnpm run docs:check`、完整 `pnpm run ready`，并在可信 Keycloak/HTTPS Lab 中独立执行 `pnpm run test:published:oidc:browser`。原有 10 项测试通过不能证明本次新增 2 项通过，且修复源码不等于真实 D5a 专项已验收。未修改任何生产权限、API、数据库迁移或工业设备读写逻辑。
- **证据**：维护者 2026-11-20 Windows 真实浏览器原始错误及完整质量日志、PR #106、`scripts/test-oidc-published-runtime-readonly.mjs`、`scripts/test-oidc-published-runtime-readonly.cases.mjs` 与 `docs/VALIDATION.md`。

### E-072 · D5a 真实浏览器阶段异常被统一脱敏为无从定位（第三十五批 D5a，已关闭）

- **现象**：维护者 2026-11-20 Windows 在本机 HEAD `e12599a94c0c11f97e95a26ff978281812ee39ac` 实测 D5a 门禁 12/12、`vp check` 372/224 零告警、`docs:check` 89 份、680/680 单测、62/62 服务端 E2E 和完整 `ready` 退出码 0。交互式 `pnpm run test:published:oidc:browser` 在人工 Keycloak 登录成功后迅速退出，仅显示“正式发布运行只读专项未通过，内部诊断已脱敏”，退出码 1。脚本 `finally` 关闭隔离浏览器及会话是安全设计，不能据此推断浏览器崩溃。
- **当前可确认的问题**：D5a 脚本多个 CDP 页面操作及断言失败后经过 `describePublishedReadonlyFailure` 统一脱敏，除少量固定异常外仅返回通用错误，导致无法区分 React/Vue BFF 会话、SPA 导航按钮、只读门禁、页面入口、表单输入、发布读取及安全断言中的哪一步失败。实际内部异常类别和失败步骤尚未获得诊断证据，不能猜为 Keycloak、React/Vue 业务页面或 404 契约错误。
- **最小修复候选**：在每一步读取前报告固定中文阶段；登录后先等待真实 React/Vue 页面 `document.readyState === "complete"` 和导航中的“已发布运行”按钮存在、可用，再安装安全门禁并点击；对后续异常只返回严格白名单的阶段名、CDP 已脱敏错误类别或“安全断言不符”，绝不展示原始错误、堆栈、Cookie、Token、工程 ID、数据库地址和工程正文。保留失败后关闭临时浏览器、原有 404/同主体/零写入断言以及生产 fail-closed。
- **防复发**：真实登录后的多阶段 CDP 脚本必须区分阶段并等待业务 DOM 准备就绪；纯粹“登录成功”不能证明 SPA 路由已经渲染。对诊断字符串使用固定阶段和安全类别白名单，并在 Node 隔离 VM 回归中验证非法阶段及敏感诊断无法回显。
- **验证边界**：新增两项 Node 门禁测试后需在最新 PR HEAD 复验 `test:published:oidc:config`、`vp check`、`docs:check`、完整 `ready`，再执行可信 Keycloak/HTTPS 双框架真实浏览器专项。之前的 12/12、680/680、62/62 只证明旧 HEAD 的离线检查通过，不是新候选通过。D5b 未开始。
- **证据**：维护者 2026-11-20 Windows 原始 D5a 日志、PR #106、`scripts/test-oidc-published-runtime-readonly.mjs`、`scripts/test-oidc-published-runtime-readonly.cases.mjs`、`docs/VALIDATION.md`。

**E-071/E-072 最终 Windows 验收（2026-11-20）**：本机 `git rev-parse HEAD` 为 `1b7eaab6e4637361e4c84d316902a62cd6f09d9a`；D5a Node 14/14，`vp check` 372/224 零错误警告，`docs:check` 89 份，`pnpm run ready` 包含单测 680/680、HTTP E2E 62/62 且退出码 0。随后真实 Keycloak/HTTPS 双 Origin 浏览器专项逐阶段确认 React/Vue 可信会话、零默认请求、单一 GET 404、零 SVG/零写入，退出码 0。PR #106 已 Squash 合并至 `main`（`fede2b649c4c6d6ca0ffcc79ee3b56ccef9d932a`）。只代表未授权/不存在工程拒绝成功，**不代表真实已授权 UNRELEASED/RELEASED、撤权、断网或工业现场验证通过**。

### E-073 · D5b1 真实授权测试复用示例工程 ID，404 被等待器误报为未知异常（第三十五批 D5b1，待 Windows 复验）

- **现象**：维护者 2026-11-20 Windows D5b1 `test:published:oidc:authorized:config` 7/7、`vp check` 374/226 零警告错误、`docs:check` 89 份、完整 `ready` 包含 680/680 单测及 62/62 E2E 且退出码 0。随后复制 `docs/HARNESS.md` 中 `d5b-unreleased-12345678-1234-4234-8234-123456789abc` 格式示例运行真实授权浏览器；真实登录及 React 页面导航、工程输入完成后，在“React：发布读取”阶段返回“异常已脱敏”、退出码 1。没有抓取受控 HTTP 状态，**不能认定实际返回了 404**。
- **确认的设计与诊断问题**：示例 ID 仅满足参数正则，并未由脚本创建，也没有任何证据证明该 ID 属于隔离库中真实存在且已授予当前主体独立 `release:read` 的工程；文档提供可直接复制执行的假 ID，容易误导验收。脚本提交后只等待 `unreleased/verified`，实际 `denied/offline/error` 不能终止等待，超时又被阶段异常包装掩盖，无法判断是缺少测试数据、会话拒绝、网络问题还是客户端验证错误。
- **最小修复候选**：浏览器状态等待接受全部五种明确终态，之后严格核对单次同源 GET 路径、阻断计数及唯一 HTTP 状态。对 404 使用不可区分的固定诊断“预置工程不存在或未授予 release:read”；401、403、非 200、200 但页面拒绝均单独安全分类。顶层异常只回显白名单原因，不输出工程 ID、HTTP 正文、Token、Cookie、SQL 或堆栈；增加 3 项 Node 回归。HARNESS 改为人工输入**真实已预置**的工程 ID，删除可直接运行的伪数据示例。
- **防复发**：真实 E2E 验收不能将正则合规的示例 ID 冒充已存在工程；必须区分参数校验与外部数据存在性。轮询应识别成功与受控失败终态，拒绝状态应 fail-closed 并在安全诊断中明确区分 HTTP 类别；测试不能为成功而绕过发布写入安全门禁。
- **验证边界**：本批源码修复后的 Node 门禁预计由 7 项升至 10 项；需在 Windows 最新 PR HEAD 重新执行 `test:published:oidc:authorized:config`、`vp check`、`docs:check` 和完整 `ready`。真实 Keycloak/HTTPS 的 `UNRELEASED` 仍必须先有**实际存在且已授权**的隔离工程，`RELEASED` 仍需已合法预置发布快照；两种真实浏览器均未通过。无数据库、API、ACL、发布记录、Schema 或工业设备读写更改。
- **证据**：维护者 2026-11-20 本轮 Windows 真实浏览器日志、先前 D5b1 离线质量日志、PR #107、`scripts/test-oidc-published-runtime-authorized.mjs`、`scripts/test-oidc-published-runtime-authorized.cases.mjs`、`docs/HARNESS.md` 与 `docs/VALIDATION.md`。

### E-074 · 接近 2 MiB 的测试请求在构造期间重复序列化导致 5 秒超时（第三十五批 D5b4c）

- **现象**：维护者 2026-11-22 在 PR #112 Windows 执行 `test:published:oidc:revoke:target:config` **10/10**、`vp check` **386 格式文件 / 238 受检文件零警告错误**、`docs:check` **89** 份均通过；完整 `pnpm run ready` 在全量 Vitest **57 个文件、680 项单测**中，`apps/server/src/projects/project-api.store.spec.ts` 的“接近 2 MiB 的合法请求若最终快照超限则受控拒绝且不写入”触发 `Test timed out in 5000ms`，当轮记录该项耗时约 **14.1 秒**、总数 **679/680**、`ready` 退出码 **1**。后续 E2E、文档和构建步骤因命令链中断未执行。
- **已确认的测试代码性能风险**：该用例原来每添加一个 `paddingN` 属性，就重新对整份日益接近 2 MiB 的 `{ expectedRevision, document }` 调用 `JSON.stringify` 与 `TextEncoder.encode`，最多执行 256 次完整编码，累计拷贝的数据量远大于最终请求；高负载 Windows 并行测试时容易超过统一 5000 ms 超时。日志无法独立证明所有耗时只由重复编码造成，不应将本次失败归因于 Prisma、真实 PostgreSQL 或生产发布大小校验。
- **最小修复**：只优化该测试的填充夹具：初始编码一次空 `props` 请求，随后按每个固定 ASCII 字段名的 JSON 引号、冒号、逗号和不超过 8192 的填充值累计字节；结束时再完整编码一次进行独立比对。仍严格断言请求 **`PROJECT_SNAPSHOT_MAX_BYTES - 24` 字节**、创建快照时受控抛出“工程版本快照超过 2 MiB 限制”、Prisma 事务和工程 INSERT **从未发生**。不增大测试超时，不改业务限制、Schema、生产快照构造或权限。
- **防复发**：临近容量上限的性能/安全边界测试，应先计算固定序列化开销并增量构造，最后只做一次独立全量序列化核验；不在逐项填充循环内重复序列化整个大型对象。必须检查 UTF-8 与 ASCII 长度假设、Schema 单属性 **8192** 和对象 **256** 项限制，不弱化负向拒绝断言。
- **验证边界**：已对与原测试等价的纯 ASCII 模拟数据比对新旧构造字节数、字段数量和最后字段长度一致；该模拟**不是** Windows TypeScript / 仓库 Vitest 验收。修复后的定向 `vp test`、`vp check`、`docs:check` 与完整 `ready` 仍待维护者复验。PR #112 必须继续保持 Draft，不能依据修复前的 679/680 结果合并。
- **证据**：维护者 2026-11-22 上传的 `ready` 原始 Vitest 失败日志、`apps/server/src/projects/project-api.store.spec.ts` 及 `packages/core/src/document.ts`、`docs/VALIDATION.md`、PR #112。

> **2026-11-22 · E-074 Windows 修复结案补录**：维护者上传修复后实际执行记录：`pnpm run build:core` 完成；`vp test run apps/server/src/projects/project-api.store.spec.ts` **13/13**（整个文件 122 ms，原超时用例 103 ms）；D5b4c 独立只读安全门禁 **10/10**；`vp check` **386 个文件格式正确、238 个受检文件零警告/错误**；`docs:check` **89 份通过**；完整 `pnpm run ready` **57/57 文件、680/680 单测、6/6 文件、62/62 HTTP E2E、React/Vue 与 NestJS 构建成功**，最终**退出码 0**。该近 2 MiB 用例在全量并行测试中为 **254 ms**，原 5000 ms 超时未再发生，E-074 的已知质量阻塞据此关闭。GitHub 当次核对 PR #112 HEAD 为 `061c42ba756ccbf8d91788a57f615c1faac9b406`；上传日志未包含本机 `git rev-parse HEAD`，不将 Windows 实测严格绑定到该 SHA。本次补录属于后续文档变更，不冒充文档更新后已重跑 `ready`。**未创建 D5b4 专用工程；真实 PostgreSQL 目标只读核验、ACL 撤销和真实服务端拒绝均未执行。**

### E-075 · Node VM 跨 Realm 嵌套请求对象导致 deepStrictEqual 误报（第三十五批 D5b5）

- **现象**：维护者 2026-11-22 Windows 原生执行 `pnpm run test:published:oidc:revoke:studio:config`，新增 **11 项中 10 通过、1 失败**；唯一失败为“独立 CDP 页面函数只发一次同源 GET，不读取工程响应正文”，位置在 `scripts/test-oidc-studio-revoked-draft.cases.mjs:90`，`assert.deepStrictEqual` 报 `Values have same structure but are not reference-equal`。同轮 `vp check` **396 个格式文件、248 个受检文件零警告错误**，`docs:check` **89 份**，Vitest **680/680**；完整 `ready` 在同一个 Node 安全用例处退出码 **1**，未继续完成后续 HTTP E2E 与构建。本轮没有提供本机 `git rev-parse HEAD`，不将结果严格绑定到 GitHub SHA。
- **已确认根因**：测试通过 `runInNewContext` 创建独立 CDP 函数，函数内部构造的 `fetch` 请求 `options` 对象具有 VM Realm 的 `Object.prototype`。外层 Node Mock 将其存入本地 `requests` 数组；即使键和值完全相同，`assert.deepStrictEqual(requests, expected)` 仍因嵌套对象的原型归属不同而失败。此前协作端隔离 V8/Mock 使用 `JSON.stringify` 模拟 `deepEqual`，**没有真实复现 Node 原生跨 Realm 严格比较语义**，因此 11/11 模拟通过并不代表正式 Node 测试通过。
- **最小修复**：只在失败用例比较时把 `assert.deepEqual(requests, [...])` 改为 `assert.deepEqual(structuredClone(requests), [...])`，把可序列化的嵌套请求记录完整复制到当前 Node Realm 后，继续对**请求条数、路径、全部选项键值与无额外属性**进行原有严格断言。保持 `runInNewContext`、真实 `fetch` 观察、404/no-store/禁止写入及全部其他安全用例不变；不改生产代码、不关闭 Lint、不替换为只比较字符串或放宽断言。
- **防复发**：使用 `node:vm` / CDP 独立上下文测试时，不能只对顶层对象展开或使用自行编造的简化断言器替代 Node `assert`。需要区分“跨 Realm 原型不同”与“真正请求参数错误”：保留严格比较，必要时使用受控 `structuredClone` 跨 Realm 归一化，并以字段、额外字段及数量的负向用例证明断言仍有判别力。最终仍须以原生 Node/Windows 全链实测为准。
- **验证边界**：在协作容器 **Node v22.16.0** 使用真实 `node:vm` 与 `node:assert/strict` 最小复现：原断言抛出 `ERR_ASSERTION`，`structuredClone` 后严格断言通过；另用 6 种请求字段、条数及额外属性篡改复核，均被严格断言拒绝。**这不是仓库完整 `node --test`、Windows `vp check` 或 `ready` 在最新修复 HEAD 的通过证据**，正式复测仍待维护者执行。本次未运行真实 Keycloak/HTTPS 浏览器、数据库写入或 ACL 恢复。
- **证据**：维护者 2026-11-22 D5b5 Windows 失败日志、`scripts/test-oidc-studio-revoked-draft.cases.mjs`、PR #118、`docs/VALIDATION.md`。

### E-076 · D5b5b 双标签页测试遗留未使用导入（第三十五批 D5b5b，待 Windows 复验）

- **现象**：维护者 2026-11-22 在 PR #120 分支执行 `vp check --fix`，报告 `scripts/test-oidc-studio-revoked-multitab.mjs:30` 存在 1 条 `eslint(no-unused-vars)` 警告：`describeD5b5StudioFailure` 已导入但未使用；同轮为 0 个错误、1 个警告，并完成格式化。**不能据此判定零警告验收通过**。
- **根因**：新增同源双标签页脚本复用 D5b5 单标签页的状态读取与安全断言时，同时复制了单标签页的异常描述函数导入；实际双标签页脚本已经定义并调用 `describeD5b5MultiTabFailure`，无需旧异常描述函数。
- **最小修复**：只移除双标签页脚本中未使用的 `describeD5b5StudioFailure` 导入；保留原有异常脱敏、离线负向断言、浏览器只读守卫及 React/Vue 双标签执行流程。不修改单标签页脚本、生产应用或权限逻辑。
- **防复发**：新增脚本复制已有 import 列表后，应逐项核对是否使用；提交前运行仓库正式 `vp check`，要求零警告、零错误，不以 `--fix` 格式化完成代替验收。
- **验证边界**：此条记录基于维护者提供的真实 Windows 警告日志及 GitHub 远端源码；修复后 `pnpm run test:published:oidc:revoke:multitab:config`、`vp check`、`docs:check`、完整 `ready` 和真实 Keycloak/Chrome 双标签页均**待 Windows 复验**，不得记为已通过。本次不执行数据库写入、ACL 恢复或服务端工程写入。
- **证据**：维护者 2026-11-22 `vp check --fix` 日志、PR #120、`scripts/test-oidc-studio-revoked-multitab.mjs`、`docs/VALIDATION.md`。

> **2026-11-22 · E-076 Windows 结案补录**：维护者提供 PR #120 修复后的本机实际日志：`test:published:oidc:revoke:multitab:config` **11/11**、`vp check` **398 个格式文件/250 个受检文件零警告错误**、`docs:check` **89 份**、完整 `pnpm run ready` **退出码 0**（Vitest **680/680**、HTTP E2E **62/62**、React/Vue/NestJS 构建成功）。原始日志未打印本地 Git HEAD，不能将本机结果严格绑定到远端提交。维护者已明确授权合并；PR #120 已 Squash 合并到 `main@eb3fdc5105d3cb5d88593db7fffd7702e91625c8`，**E-076 的零警告质量门禁阻塞已关闭**。本轮没有新增 D5b5b 真实 Chrome/Keycloak 双标签页执行证据；该浏览器专项仍待独立验收。此结案补录本身未在 Windows 重新执行完整 `ready`。

### E-077 · D5b5b/D5b5c 真实浏览器保护断言被二次通用脱敏（第三十五批 D5b5c）

- **现象**：维护者 2026-11-22 Windows 已运行 D5b5c 离线 **13/13**、`vp check` **401 个格式文件/253 受检零告警错误**、`docs:check` **89 份**、完整 `ready`（Vitest **680/680**、HTTP E2E **62/62**、双框架及服务端构建）**退出码 0**。随后同一现存 D5b4 工程的撤权后 PostgreSQL **READ ONLY** 审计通过；真实 D5b5b 浏览器停在“React：第一标签页真实发布读取”，报“工程 API 只读约束或发布 GET 404 不符合预期”；D5b5c 在两个真实 404 Promise 同时挂起后，停在“React：先交付第二标签页真实 404”，报“内部异常已脱敏”。**两项真实浏览器退出码均为 1**；Vue 真实浏览器阶段没有执行完。
- **可确认代码缺陷**：`test-oidc-studio-revoked-multitab.mjs` 的 `verifySingleRevokedGet` 使用无参数 `catch` 把 `requireD5b5Preserved` 的三类已审核失败（工程请求序列、HTTP 404/no-store/重定向、本地 SVG/草稿/CAS 变化）统合成一个错误；`test-oidc-studio-revoked-late-multitab.mjs` 直接复用该严格断言，但它的 `SAFE_ERRORS` 未包含被复用的三类错误，导致已知异常又被映射为“内部异常已脱敏”。**最终导致浏览器失败的具体字段/请求是否真的漂移还没有证据，不应推断为后台请求竞态或生产数据损坏**。
- **最小修复**：保留 `requireD5b5Preserved` 的全部原始严格条件，不删除任何 GET/HTTP/草稿/CAS 断言；新增只返回固定中文枚举的 `classifyD5b5PreservationFailure`，区分守卫缺失、被阻断写入、额外工程 GET、异步响应计数、原有请求记录变化、目标路径/404、HTTP 缓存/重定向以及 SVG、工程 JSON、IndexedDB、自动保存、CAS 和工程关联变化。D5b5b/D5b5c 分别在原断言抛错后调用分类器，其顶层安全白名单只允许这些固定字符串。未知异常保持脱敏，不输出真实工程 ID、工程正文、摘要、Token、Cookie、数据库连接或异常堆栈。
- **防复发**：真实 CDP 安全专项不得把**已知保护性断言**无条件折叠成通用异常；复用另一脚本的固定异常时同步核对当前脚本的白名单。分类器仅在断言确实失败后观察安全字段，不得代替/放宽断言或通过忽略背景 GET 使红灯变绿。请求并发顺序需要从下一轮真实阶段分类确认，不从一行错误消息推测。
- **验证边界**：维护者的 Windows **13/13** 与完整 `ready` 是修补前代码的真实证据。候选已为 D5b5b 增加 **5 项**真实断言负向回归，为 D5b5c 增加 **1 项**白名单透传回归；**修补后的 Windows Node、`vp check`、`docs:check`、`ready`、双框架真实浏览器都待复测**。没有执行数据库写入、恢复 ACL、服务端 POST 或工业设备控制。
- **证据**：维护者 2026-11-22 D5b5b/D5b5c 真实浏览器失败日志和完整 Windows 质量日志、PR #121、`scripts/test-oidc-studio-revoked-multitab.mjs`、`scripts/test-oidc-studio-revoked-late-multitab.mjs`、`docs/VALIDATION.md`。

### E-078 · 双标签页只读 GET 先记路径后记响应导致过早断言（第三十五批 D5b5c，待真实复验）

- **现象**：维护者 2026-11-22 Windows 已对 E-077 修补版完成 D5b5b **16/16**、D5b5c **14/14** 离线回归、`vp check` **401/253 零告警错误**、`docs:check` **89**、完整 `ready`（680/680 Vitest、62/62 E2E、React/Vue/NestJS 构建）**退出码 0**。同一已撤权 D5b4 工程再次通过 PostgreSQL **READ ONLY** 审计。真实 D5b5b 的 React 第一、第二标签页发布读取均已通过，却在“切回第一标签页并复核”报“工程 API 只读约束或发布 GET 404 不符合预期”，退出码 1；真实 D5b5c 两页已经持有真实 404 并通过同时 pending 检查，却在第二页优先交付后明确报“工程响应数量不符”，退出码 1。**Vue 阶段未覆盖，不得记为通过**。
- **已确认的时序机制**：既有页面只读守卫 `installPublishedReadGuardInPage` 在发出原生 `fetch` 前先向 `paths` 追加请求路径，而在 `Promise.resolve(original(...)).then(...)` 中、真实响应完成后才向 `statuses` 追加 HTTP 状态。Studio 的可见性恢复和 UI idle 不保证所有后台只读 GET 已结束。D5b5b 在最后检查时直接要求 `paths.length === statuses.length`；D5b5c 在新 GET 之前没有等待旧记录结算，却立即要求新请求导致两个数组**同时恰好新增 1**。**尚未获得网络级请求时间线和原始计数，不能断言两次真实失败只因已有 GET 未完成；未排除异常请求或生产状态变化。**
- **最小修复候选**：仅在测试脚本增加 `requireD5b5ReadGuardProgress` 与 `waitForD5b5ReadGuardSettled`，要求守卫存在、`blocked === 0`、两个数组合法且响应数量不反超请求数量；若尚有 `paths` 未对应到 `statuses` 则通过现有 `waitForState` **最多 80 次、每次 150ms** 有界等待真实完成，超时或真实 Fetch 永远未返回仍失败。D5b5b 在每次主动 GET 前后及切回最终对照前结算，D5b5c 在两页分别挂起前、各次释放后和最终检查前结算。保留 `requireD5b5Preserved` 的“每次目标请求与响应严格各增加 1”及原始历史一致检查；保留最终完整 SVG、JSON、IndexedDB 草稿、自动保存、CAS 和零写入断言。**不清理/忽略额外请求，不伪造 404，不允许继续挂起无限等待，不改生产 API/ACL。**
- **防复发**：异步请求计数型安全测试必须在记录基线前确保先前请求结算；等待只解决时间上的未完成，不允许以宽松的总数比较或清空记录绕过额外目标 GET。通过原生 Node 测试覆盖异步一前一后、阻断写入、破损数组、状态数反超与额外 GET 严格拒绝，最终仍需在真实 Keycloak/Chrome 双框架证明。
- **验证边界**：本候选新增 D5b5b **4 项**离线门禁定义（总数由 16 增至 **20**），D5b5c 原 **14 项**不变；最新 HEAD 的 Windows Node、Vite+、文档、完整 `ready`、D5b5b 和 D5b5c 真实浏览器**均待维护者重新验收**。上次 Windows 通过记录适用于**修补前**代码。没有修改或恢复数据库授权、创建工程、写入发布版本、设备控制或生产数据。
- **证据**：本次维护者 D5b4e READ ONLY 与两项真实浏览器失败日志、`scripts/test-oidc-published-runtime-readonly.mjs`、`scripts/test-oidc-studio-revoked-multitab.mjs`、`scripts/test-oidc-studio-revoked-late-multitab.mjs`、PR #121、`docs/VALIDATION.md`。

### E-079 · D5b5c 在第一响应严格核验前切回可见页，混入标签恢复期工程读取（第三十五批 D5b5c，待真实复验）

- **真实验收结果**：维护者 2026-11-22 Windows 显式打印并验证本地 HEAD 为 `baa612ca029ff3f8a3bd6fe75b03ba24c7d85f9b`；同一已撤权 D5b4 工程的 PostgreSQL `READ ONLY` 审计通过，仅缺少 `release:read`，其他三项 ACL 和 D5b1 基线完整。**D5b5b 真实 Chrome/Keycloak 的 React 与 Vue 各自同源双标签页、顺序真实 404、可见性恢复、SVG/草稿/CAS 与零工程写入全部通过**。D5b5c React 已通过两个真实 404 同时挂起与**第二标签先交付**，随后在“后交付第一标签页真实 404”报 `D5b5 双标签读取期间工程请求数量不符`，进程退出码 1；Vue 未执行。末尾 PowerShell 单独运行的 `Write-Host "D5b5b / D5b5c 真实浏览器验收通过"` 不依赖退出码，**不能用作 D5b5c 成功证据**。
- **已确认的测试顺序缺陷**：`scripts/test-oidc-studio-revoked-late-multitab.mjs` 先向第二标签释放原始 404 并完成校验，随后**在第一标签的响应交付和“目标 GET 恰好增加一次”严格断言之前**调用 `switchToTab(browser, second)`，使第一标签恢复可见。该调用可能触发 Studio 正常的可见性恢复只读 GET，并混入本次单一发布读取严格记录比较。现有日志没有曝光安全请求数量或生命周期，**不应断言新增 GET 一定由该切换触发**，亦不能认定生产逻辑存在错误。
- **最小修复候选**：仅将这一处 `switchToTab(browser, second)` **从第一标签的响应交付前移动到两次响应均交付、`requireD5b5Preserved` 均成功之后的最终可见性恢复复核阶段**。第一标签通过真实 CDP 的 `evaluate` 在隐藏状态消费已收到的原始 HTTP 404；浏览器此前已对隐藏第一标签读取 pending 状态，因此无新增执行通道。最终仍切回第一标签检查 SVG、工程 JSON、IndexedDB 草稿摘要、自动保存、CAS 和两个标签零工程写入。保持原有顺序 **先第二页、后第一页**，原始 HTTP 404/no-store/无重定向以及每次**恰好一个**目标 GET/404、守卫日志完整性、所有失败拒绝条件不变。无忽略、清空或篡改背景 GET。
- **防复发**：当安全断言要求恰好一次主动请求时，避免在取基线与核验该请求的窗口内执行会主动改变页面可见性的附加动作；如果要验证最终可见性恢复，应将其作为两个请求严格核验之后的独立阶段。离线测试增加隐藏页消费真实 Response 的独立模拟，验证两页均精确一次 GET、零被阻断写入；模拟无法证明 Chrome 实际会触发哪些后台 GET。
- **验证边界**：新增 D5b5c **1 项**离线测试定义，预计由 **14 增至 15 项**；D5b5b 保持 20 项，E-078 已由维护者 Windows 实测 20/20、14/14、`vp check` 401/253 零告警、`docs:check` 89、完整 `ready` 退出码 0，但它们属于**修补前的 HEAD**。本次候选的 Windows Node、`vp check`、`docs:check`、`ready`、D5b5c React/Vue 真实浏览器均**待重新验收**；不创建或改变数据库、工程 ACL、发布状态和工业设备。
- **证据**：维护者 2026-11-22 最新真实 Windows 日志、PR #121、`scripts/test-oidc-studio-revoked-late-multitab.mjs`、`scripts/test-oidc-studio-revoked-late-gate.cases.mjs` 与 `docs/VALIDATION.md`。

> **2026-11-22 · E-079 Windows 结案补录**：维护者提供后续真实 Windows 完整日志，D5b5c Node **15/15**、`vp check` **401/253 零告警错误**、`docs:check` **89 份**、Vitest **680/680**、NestJS HTTP E2E **62/62**、React/Vue/NestJS 构建及完整 `ready` **退出码 0**；相同已撤权 D5b4 工程通过 PostgreSQL **READ ONLY** 审计。D5b5c **React 与 Vue 两端真实 Keycloak/Chrome** 均完成两个真实 404 同时挂起、第二页先交付、第一页面保持隐藏完成后交付、最终可见性恢复以及 SVG/工程 JSON/草稿/CAS 保持不变，真实浏览器无失败退出。D5b5b React/Vue 顺序双标签专项已在此前真实通过。维护者明确同意合并，GitHub 已核实 PR #121 Squash 合并到 `main@87f50a56fdf4372afdf9d65e2ddef9e476b0bcfc`，**E-079 的 D5b5c 真实浏览器阻塞关闭**。附带日志未打印此次本地 Git HEAD，故不将 Windows 日志严格等同于具体 SHA 的直接证明；这仍不涉及工业设备控制与生产发布授权。

### E-080 · D5b7c 元数据只读审查遗漏原 D5b1 基线保护（第三十五批 D5b7d，待 Windows 复验）

- **现象**：Issue #126 要求核对合法发布目标时同时保护原 D5b1 的未发布基线、审计及 ACL。已合并的 PR #128 只在 `READ ONLY` 事务中校验目标工程自身的迁移、身份、授权、版本摘要和末次发布事件，没有查询或核对原 D5b1 基线。因此在目标元数据一致但原工程发生不应有的编辑/发布/授权漂移时，工具仍可能返回 `RELEASED_METADATA_ONLY`。这是审查工具的覆盖缺口，不是已发现原数据库发生真实漂移，也不代表生产 API 存在相同缺陷。
- **根因**：将 D5b4c 的前置审查复用范围缩减到连接目标和事务保护，却遗漏了 Issue #126 明确要求的“原工程基线”复核；原测试 Mock 只模拟单一工程，不区分原基线和目标工程，因此无法发现遗漏。
- **最小修复**：从 PR #128 合并后的最新主线建立 D5b7d 独立分支，新增纯函数基线校验与 5 项 Node 负向测试；在现有 D5b7c 同一 `REPEATABLE READ READ ONLY` + `ROLLBACK` 事务内，先验证固定原 D5b1 的首版、保存审计、代次 0 / 空发布指针 / 零事件与四项固定 ACL，再查询 D5b7b 目标；原基线不符立即拒绝。扩展原 Mock 区分两工程、验证任意漂移时零目标查询，不改生产服务、数据库、ACL 或发布安全门禁。
- **防复发**：工业安全预检涉及“新目标 + 不得影响原资产”时，测试必须覆盖目标本身与原资产基线，且使用同一个只读快照和明确的租户/工程参数；不能因为已有事务或权限测试就声称原资产未变。审查报告须区分合成 Mock、真实数据库与真实 HTTP 快照三层证据。
- **验证边界**：独立 Node.js 22.16.0 已对新纯函数运行 `node --check` 和 5/5 本地负向测试；**D5b7d 最新 GitHub HEAD 的原生 Node 集成回归、Windows `vp check`、`docs:check`、`ready` 与真实 PostgreSQL READ ONLY 均待实测**，不得提前关闭。真实已发布夹具尚未确证存在，生产 `ProjectReleaseSafetyGate` 继续 fail-closed；未执行任何数据库写入、ACL 恢复或正式发布。

> **2026-11-22 · E-080 Windows 结案补录**：维护者提供 D5b7d PR #129 的真实 Windows 质量日志：原 D5b1 基线 **5/5**、原只读事务回归 **14/14**、Vite+ **409 文件格式正确 / 261 文件零警告错误**、`docs:check` **89 份**、Vitest **682/682**、HTTP E2E **62/62**、React/Vue/NestJS 构建及完整 `ready` 通过。经最新 HEAD `a3168d553cf030f6bcd5130c4fb7ac6ef9acf549` 与初始审查 HEAD 比较，仅有排版调整；按明确授权 Squash 合并到 `main@fb320f4731cd59535c0bd00222be93ce3fe486b7`，**E-080 离线基线缺口已关闭**。这仍未包含原 D5b1 的本次真实数据库 READ ONLY 审计或任何真实已发布工程的 `verified → denied` 实验，Issue #126 继续开放。

### E-081 · D5b7c 目标 ACL 在 SQL 层预过滤导致异常授权不可见（第三十五批 D5b7e，待 Windows 复验）

- **现象**：Issue #126 规定真实只读审查必须覆盖授权状态，已合并 D5b7c 的目标 ACL 查询却限定 `subject_id = $3 AND permission = 'release:read'`。当目标工程同时存在其他主体授权、多余正式发布权限或不完整基础 ACL 时，这些行在查询阶段就被剔除，下游 D5b7b 元数据分类器仅看到一行正常读取授权，可能仍给出 `RELEASED_METADATA_ONLY`。原 D5b7d 只保护 D5b1 基线，没有覆盖目标全量 ACL。此次发现是审查脚本缺口，**并无数据库遭到真实越权或发布状态漂移的证据**。
- **根因**：用“是否存在单项读取权限”的查询结果代替“整个工程授权集合是否符合预期”，模拟行集也仅包含该读取权限，致使额外 ACL 被过滤的路径无测试覆盖。
- **最小修复**：从 PR #129 合并后的最新主线创建 D5b7e 独立分支，在同一 `REPEATABLE READ READ ONLY` + `ROLLBACK` 中按可信租户和工程读取全量 `subject_id, permission`；严格核对原主体三项基础 ACL、第四项唯一 `release:read`，或只读拒绝态，异常主体、重复、多余发布权限及缺少基础 ACL 均在目标发布指针查询前拒绝。通过全量校验后仅将规范化的零行或单行交给原分类器。新集成 Mock 增加 3 项测试定义、完善真实查询参数断言。
- **防复发**：涉及 ACL 集合完整性的测试必须使用**不按具体权限预过滤的真实查询形状**，主动注入跨主体与多余权限行并证明读取门禁拒绝。不能只根据过滤后的“命中目标授权”就声称整个 ACL 正常。只读工具与业务权限服务的语义应分别报告，不以离线 Mock 冒充正式运行验收。
- **验证边界**：已完成 GitHub 源码/Schema/既有 D5b4 ACL 契约核对；新 D5b7e HEAD 的 17 项 Node、Windows Vite+、文档及 `ready` 尚未实测。未执行 PostgreSQL 写入、ACL 恢复、真实发布或撤权，独立已发布夹具仍无存在性证据。

### E-082 · ADR-0070 状态附加审批说明导致 docs:check 再次失败（第三十五批 D5b8，修复待复验）

- **实际现象**：2026-11-22 维护者在 Windows 验收 PR #132 时，`pnpm run docs:check` 报 `ADR 状态无效：0070-isolated-published-fixture-safety-review.md`，退出码 1；`pnpm run ready` 虽通过 Vite+ 格式/Lint、682/682 单测、各项离线专项和 62/62 HTTP E2E，仍在末尾文档检查失败并退出码 1。终端随后独立执行的绿色 `Write-Host` 不能证明 `ready` 通过。没有任何证据显示此次错误涉及数据库或运行时业务。
- **根因**：ADR-0070 将状态写为 `- 状态：Proposed（待维护者与工业安全专项评审，**未授权实施**）`。仓库现行 `scripts/validate-docs.mjs` 严格要求整行等于 `- 状态：Proposed` 等枚举值。此问题与已经记录的 **E-019** 完全同类；编码前虽重读复盘，却没有将该 ADR 状态的形式校验真正应用到新增文件，导致同类错误复发。
- **最小修复**：仅把 ADR-0070 状态改为独立的 `- 状态：Proposed` 与下一行 `- 审批：待维护者与工业安全专项评审，**未授权实施**`。不放宽文档校验器、不把 Proposed 改为 Accepted、不修改工业安全门禁、代码、数据库或 ACL。
- **防复发**：新增 ADR 时在提交前对最终文件应用与 `validate-docs.mjs` 完全相同的枚举行正则，并优先运行真实 `pnpm run docs:check`；任何附加说明必须单独成行。最终质量链的成功信息必须绑定实际 `$LASTEXITCODE -eq 0`，不能把中途单测通过和后续手动打印的绿色提示当成整个 `ready` 成功。
- **验证边界**：已在 GitHub 修复分支上用**仓库原有严格 ADR 状态正则**检查修正文本符合要求；原 Windows 日志仍是修复前 `docs:check` / `ready` **失败**。**修复后的实际 Windows `docs:check`、`vp check` 与完整 `ready` 尚未执行**，不可声称本批最终质量链通过。
- **证据**：维护者 2026-11-22 D5b8 Windows 日志、PR #132、ADR-0070、`scripts/validate-docs.mjs`、E-019、`docs/VALIDATION.md`。

## 三、从已发生问题提炼的预防性门禁

以下是**防复发规则**，并不表示每项都曾发生真实事故：

- **依赖与锁文件**：根 `pnpm-workspace.yaml` Catalog、消费端 `package.json` 与 `pnpm-lock.yaml` 必须保持一致；新增依赖应使用仓库 pnpm Skill 推荐的原生命令生成锁文件。不要手工编造完整 lockfile 或只改 manifest 就声称完成安装。执行 `pnpm install --frozen-lockfile`、`pnpm run deps:check`。
- **Prisma 迁移**：`prisma generate`、Schema 静态注释检查和 `ready` **不能代替真实 PostgreSQL 迁移测试**。任何有写入行为的测试必须连接明确确认的隔离测试库；未经用户明确授权不能修改现有开发或生产数据库。
- **OIDC 与工程权限**：身份、Issuer、Tenant、ACL 及用户数据不能从不可信客户端推断；认证/CSRF/工程 ACL 未完成时保持 `SCADA_OIDC_ENABLED=false` 和服务端 fail-closed，不开放半成品工程接口，也不开放工业设备写入。
- **Vue/React 对等**：共用 Core、工程 Schema、Tag 规则和 API 契约；涉及浏览器存储与 UI 的改动必须安排真实浏览器双框架互通验证。
- **GitHub 审批**：AI 创建或维护 Draft PR 时，必须立即将 Assignee 设为实际 GitHub 账号 `@adui-dev` 并读取 GitHub 返回结果核对；未经维护者本次明确授权不得合并。
- **日志与文档**：修复后的测试结果要记录所用分支/提交、实际命令与退出码；历史失败日志可以保留，但要追加明确的最终结果，不能留下容易误读的“当前仍失败”表述。

# E-083 · D5b8a 发布门禁测试重复遗漏 Vitest Mock 泛型（第三十五批，已关闭）

- **现象**：维护者在 Windows 执行 `vp check --fix` 时，对 `apps/server/src/projects/project-release-safety-gate.spec.ts:77` 的 `const query = vi.fn();` 报 `vitest(require-mock-type-parameters)` 警告 1 条、错误 0 条；终端仅显示格式化完成，不能认定 `vp check` 通过。此次无证据表明发布事务或工业设备发生变更。
- **根因**：新增安全门禁负向测试时未落实已存在的 **E-005**（Vitest Mock 必须显式声明函数签名），在仅检查 SQL 零调用的 Mock 上使用了无泛型 `vi.fn()`。
- **最小修复**：在原 PR #133 的同一测试文件，仅将其修改为 `vi.fn<() => Promise<unknown[]>>()`；Mock 仍不实际执行，原 `expect(query).not.toHaveBeenCalled()` 保持不变，不改 `ProjectReleaseSafetyGate`、NestJS 接口或任何发布权限。
- **防复发**：新增 `vi.fn` 时先查看仓库类似测试的签名写法，始终显式传入类型参数；审查提交前搜索新增测试中的裸 `vi.fn()`，执行 `vp check` **无警告**，不要把 `vp check --fix` 的“格式化完成”视为质量链成功。
- **验证结果**：维护者 2026-11-22 Windows 实测：`vp check` **412 个文件格式正确、264 个受检文件零警告/错误**；`pnpm run test:unit` **58/58 文件、688/688 项**（门禁 6/6），`docs:check` **89**，完整 `pnpm run ready` 包括 NestJS HTTP E2E **62/62**、React/Vue/NestJS 构建均执行成功。该日志未输出本地 HEAD SHA，不能无证据地将测试绑定到远端最终 HEAD；本条原始 Mock 泛型警告已有零告警复验，**E-083 已关闭**。之后对 PR #133 E2E 非空阻塞诊断的新增测试改动，仍需单独重新验收，不能沿用该日志。
- **证据**：维护者 2026-11-22 Windows Vite+ 警告原文、PR #133、E-005、`docs/VALIDATION.md`。

##

# E-084 · HTTP 失败日志默认 err 序列化保留堆栈与本机路径（D5b8g，已关闭）

- **现象**：维护者 2026-11-22 Windows `ready` / HTTP E2E 日志包含预期的 HTTP 503 拒绝，但 Pino HTTP 失败记录仍自动带有 `err.message` 和 `err.stack`，堆栈中出现本机工程绝对路径。已有日志未证明真实密钥泄漏；风险在于将来某些错误可能携带其他内部细节。该 HTTP 503 属于测试成功覆盖的拒绝行为，不能混淆为 E2E 失败。
- **根因**：`createHttpLoggingOptions` 已设置 `req` / `res` 白名单序列化和常用键名 `redact`，但缺少 `err` 序列化器；Pino 对失败请求的默认错误序列化会包括原始消息和调用堆栈，常见敏感字段名称的 `redact` 不会自动消除自由文本里的本机路径。
- **最小修复**：仅在既有 `apps/server/src/observability/http-logging.config.ts` 的 `serializers` 下新增 `err(_error: unknown)`，返回唯一固定 `{ type: "HTTP_ERROR" }`；不读取传入错误、不依赖异常属性、不修改原有请求 ID、方法、响应状态、日志等级、HTTP 状态码或安全拒绝逻辑。新增三项 Vitest 用例覆盖异常消息/堆栈/原因/任意附加字段、恶意 getter，以及实际 Pino JSON 输出对原始异常和 URL 的脱敏。此修复仅保护该 Pino HTTP 序列化入口，不承诺应用其他自定义日志调用的所有自由文本均已审计。
- **防复发**：修改 Pino / `pino-http` 相关配置时，必须分别检查 `req`、`res`、`err` 三个默认日志对象的输出；不因 `redact` 存在就认定异常消息、堆栈已安全。测试不允许以真实凭据、生产设备地址或生产数据库连接串作为样例。
- **验证结果**：维护者 2026-11-22 Windows 在精确 PR #139 HEAD `dd0c72ec3ddfebde701c4d8bd4fc811454a193bd` 执行单测 **702/702**（HTTP 日志 7/7）、HTTP E2E **63/63**、`vp check` **413 文件格式正确/264 受检零警告错误**、`docs:check` **90 份**、完整 `pnpm run ready` 与 React/Vue/NestJS 构建，均实际通过。HTTP 503 E2E 日志中的 `err` 仅含固定 `type: HTTP_ERROR`，不再含 `err.stack` 或本机路径。该结果属于 HTTP 日志脱敏专项，不代表其他自定义日志均通过全域审计。经维护者明确授权，PR #139 Squash 合并至 `main@ba1fa7f896ea57d6dfa9516f645bd460ac7955c0`，**E-084 已关闭**。
- **证据**：维护者 D5b8f Windows 验收日志、`http-logging.config.ts`、`http-logging.config.spec.ts`、`docs/VALIDATION.md`。

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

### E-085 · D5b9n 报警订阅外部取消函数重入会干扰新会话（D5b9o，已关闭）

- **现象与证据**：静态审查 PR #153 合并后的 `AlarmSubscriptionAdapter.stop()`，发现先调用可由宿主实现的 `cancelCheck/unsubscribe`，最后才撤销 `controller` 中的当前基线与令牌。取消函数若同步重入 `start()`，可能让新会话沿用旧令牌和代次；旧 `stop()` 随后仍有机会清空新会话。已定位为源码可重入缺口，**尚无 Windows 故障日志或工业现场事故证据**。
- **原因**：将外部可重入的资源清理置于本地会话失效之前；原 `start()` 仅通过 `running` 判断资源安装是否仍有效，没有再次核对原令牌；旧 `start` 发生异常时可能误停止重入建立的新会话。
- **最小修复候选**：先清空当前运行标记、资源引用，再通过 `controller.disconnect` 撤销旧基线和令牌，最后用 `try/finally` 依次尝试两项取消。订阅和调度返回后同时核对运行标记及原令牌；旧会话的异常处理只有在令牌仍匹配时才停止。新增 4 项测试，包含重入、安装异常和两次取消均抛错。外部取消函数抛错时不声称其实际完成释放。
- **防复发**：任何第三方 `unsubscribe/cancel/close`、回调或定时器清理都应按**先使内部会话失效、再调用外部回调**检查，并增加同步重入和旧初始化返回的回归测试；不可仅通过代次数字识别回调身份。
- **验证结论**：维护者 2026-11-23 Windows 复验 PR #154：订阅适配器定向测试 **17/17**、`vp check` **435 格式文件/286 受检零警告错误**、文档 **90**、中文文案 **310**；按明确授权 Squash 合并至 `main@255c5a2ec3b88f0dd4dc54894cb6c03dda0aca6d`。此验证不代表真实取消函数可保证成功释放网络资源，也不代表 FR-011 工业安全验收完成。

### E-086 · D5b9o 重入测试在条件分支内使用 expect（PR #154，已关闭）

- **现象与证据**：维护者 Windows 执行 `vp check --fix` 时，`packages/core/test/alarm-subscription-adapter.test.ts:280` 报 `vitest(no-conditional-expect)` **1 条警告、0 错误**。格式化完成不等于零警告通过；没有本批定向测试或再次 `vp check` 成功证据。
- **根因**：为检查周期取消回调重入时“旧基线已清空”，将 `expect(adapter.snapshot().baseline).toBeNull()` 直接写进 `if (cancellations === 1)` 内，重复违反既有 E-003 的 Vitest 规则。
- **最小修复候选**：保持原有重入测试逻辑，在第一次取消的分支内只记录布尔值 `baselineClearedBeforeCancellation`，在 `adapter.stop()` 返回后的测试主流程以 `expect(...).toBe(true)` 断言；若首次取消未发生，默认 `false` 亦使测试失败，不能把未发生重入误判通过。不改业务函数、令牌顺序及公共接口。
- **防复发**：在嵌套回调、条件或循环中先收集结果，`expect` 放在测试主体；编码前必须复查 E-003，`vp check --fix` 出警告时单独修复并运行不带 `--fix` 的 `vp check`。
- **验证结论**：维护者 2026-11-23 Windows 已重新运行 17/17 定向测试及 `vp check`（435 格式文件、286 受检零警告错误）、`docs:check`（90）、`messages:check`（310），此前条件式断言警告已实测消除。PR #154 经授权 Squash 合并，E-086 关闭。

### E-087 · D5b9o 外部取消异常会覆盖订阅原始故障（D5b9p，已关闭）

- **现象与证据**：静态审查 `main@255c5a2ec3b88f0dd4dc54894cb6c03dda0aca6d` 的 `AlarmSubscriptionAdapter`：`stop()` 中 `try/finally` 的订阅取消异常会覆盖周期取消异常；`start/forward` 先遇到订阅、调度或时钟错误再执行 `stop()` 时，取消异常可能覆盖原始故障。该问题由实际源码控制流支持，**并无已复现的工业现场事故或本批 Windows 失败日志**。
- **根因**：资源清理虽保持尝试顺序与内部令牌失效，但没有统一记录多个外部故障对象；清理过程中二次抛错会覆盖上一个异常。
- **最小修复候选**：分别捕获两项取消异常并保留其顺序；单项失败原样抛出，双项失败使用中文固定消息 `AggregateError`。原始业务故障伴随清理失败时，外层 `AggregateError` 保留 `[原始故障, 清理故障]`；仅对仍有效的旧令牌执行清理，避免影响已经重入的新会话。修改原有断言、增加 3 项异常路径单测定义，不改公开 API。
- **防复发**：受控回调中调用外部 `cancel/unsubscribe/close` 应测试单项失败、全部失败、主故障叠加清理失败及最终会话失效。聚合的异常对象**不得直接写入未脱敏日志或返回浏览器**，参考 E-084。
- **验证结论**：维护者 2026-11-23 Windows 已运行 PR #155 报警订阅适配器单测 **20/20**、`vp check` **435 格式文件/286 受检零警告错误**、文档 **90** 与中文文案 **310**；按明确授权 Squash 合并至 `main@bec400c3cb8ad8cef22416712eaaf481e1e9105d`。异常保留验证不等于外部取消函数成功释放网络资源，也不代表工业报警已获生产验收。

### E-088 · 报警订阅调度未执行时读取仍可能暴露超龄基线（D5b9q，已关闭）

- **现象与证据**：静态审查 PR #155 合并后的 `AlarmSubscriptionAdapter.snapshot()` 发现它仅返回 `controller.snapshot()`，依靠外部 `every()` 调用 `checkFreshness` 才会失效。若注入调度器暂停或执行延迟，外部读取者可能获得超过 `maxAgeMs` 的旧 GOOD 基线。该结论来自代码控制流，**没有维护者 Windows 失败日志或工业现场故障证据**。
- **根因**：把后台时效检查当作读取数据的唯一时效保护，缺少读取边界再次核验；外部调度的实际间隔并非 Core 可以保证。
- **最小修复候选**：不新增时钟或网络依赖，仅在 `AlarmSubscriptionAdapter.snapshot()` 对正在运行且持有的基线，通过现有注入 `nowMs()` 同步调用 `controller.checkFreshness`；复用原有 `forward/stop` 完成过期后撤销和清理。无基线等待期、已停止订阅时不读取时钟。新增 4 项测试定义，覆盖调度未触发而基线过期、正常读取稳定、读取时钟故障清理及等待初始快照不读取时钟。
- **防复发**：工业候选数值的读取边界不能把外部调度准确性视为已证明；任何能对外返回旧数据的入口都必须有明确的新鲜度、质量与会话归属前提。读取发生的状态失效与异常传播要写清楚，不要把原始快照引用当作可永久复用的合法候选。
- **验证结论**：维护者 2026-11-23 Windows 已执行 PR #156 订阅适配测试 **24/24**、`vp check` **435 格式文件/286 受检零警告错误**、`docs:check` **90 份**与 `messages:check` **310 个自有文件**。经明确授权 Squash 合并至 `main@fe02273d38d3291c2483061dbe8990b6024deff0`。此防护不能清理调用方此前缓存的旧状态，也不证明真实工业数据源或调度时钟可信。

### E-089 · 新鲜 delta 可续接已超龄的旧报警序列基线（D5b9r，已关闭）

- **现象与证据**：静态审查 `main@fe02273d38d3291c2483061dbe8990b6024deff0` 的 `transitionAlarmBaselineSession`：在 `delta` 路径直接调用 `advanceAlarmTagDeltaBaseline`，后者只检查**本次输入**的时间窗口、质量和递增序列。若外部定时检查与适配器 `snapshot()` 均未执行，旧基线已超龄，新的同代次有效 delta 仍可能被接受。尚无真实设备采集故障或本批 Windows 测试失败的证据。
- **根因**：将“旧基线合法”的建立时事实视为持续有效，缺少在续接序列前针对**先前基线本身**的时效复核；D5b9q 只防护适配器读取，不能覆盖直接归约和新 delta 输入路径。
- **最小修复候选**：在共享会话归约器的已核验 `delta` 分支，调用既有 `classifyTimelyNumericAlarmSample` 对旧基线重新检查时间窗口。旧基线超龄或位于未来时清空基线并拒绝当前 delta，包括未更新目标 Tag 的增量；只有同代次合格 snapshot 可重建。未核验来源保持已有 `UNVERIFIED_SOURCE` 优先级，精确最大年龄端点不误拒绝。
- **防复发**：时间敏感的状态推进必须同时验证当前输入与其依赖的历史基线，不应只在读操作或周期调度中校验时效。跨阶段消息处理应测试漏调度、无读操作、超时、未来时钟、边界和后续重建路径。
- **验证结论**：维护者 2026-11-23 Windows 已执行 PR #157 会话归约器 16/16、订阅适配器 25/25（合计 **41/41**），`vp check` **435 个格式文件/286 受检零警告错误**、`docs:check` **90 份**、`messages:check` **310 个文件**。PR 经明确授权 Squash 合并至 `main@54cec31bd1e7a6c1ae0d1e1a0b3d2a128515e845`，E-089 关闭。该验证仍不证明独立底层增量 API 已完整阻断超龄基线，也不证明可信数据源或工业报警可用。

### E-090 · 直接调用底层增量 API 仍可绕过旧基线时效保护（D5b9s，已关闭）

- **现象与证据**：静态审查 `main@54cec31bd1e7a6c1ae0d1e1a0b3d2a128515e845` 中的公开函数 `advanceAlarmTagDeltaBaseline`：其检查旧基线 Tag 和序列后只验证新读数的质量与时效，未复查旧基线的 GOOD、数值或服务器时间。D5b9r 的保护位于会话归约器内，直接调用该公开函数仍能接受超龄或异常旧基线。未有生产现场事件或本批 Windows 失败日志。
- **根因**：把调用方会使用高层归约器当作低层公共 API 的前置条件，但并无签名或类型强制保证；历史测试夹具也让原本超龄的基线被当作合法输入。
- **最小修复候选**：在低层函数验证来源、消息种类、会话代次及目标 Tag 后，复用 `classifyTimelyNumericAlarmSample(previous, nowMs, maxAgeMs)` 阻断旧基线超龄、未来、坏质量或非数值。拒绝不返回数值或新基线，空增量也不得掩盖过期。修正原「合法」测试夹具为年龄 1000ms，并增加 6 项直接调用测试（包含最大年龄边界和来源拒绝优先级）。原高层归约器防护保持不变以避免破坏其拒绝语义。
- **防复发**：对公开提供的分层 API，应分别在低层入口验证所有关键前置条件，不得仅依赖上一层调用者；测试夹具必须满足它声称的全部输入约束，不能依赖实现缺口作为成功条件。
- **验证结论**：维护者 2026-11-23 Windows 已执行 PR #158 三份关联测试 **56/56**、`vp check` **435 格式文件/286 受检零警告错误**、`docs:check` **90**、`messages:check` **310**；在明确授权下 Squash 合并至 `main@ac39b5876fa2f255d993b0e8665cad51fe675bff`。这不能证明源认证、可信时钟、生产报警规则或工业现场安全。

### E-091 · 同会话第二次快照能够重置已接受的报警序列基线（D5b9t，待 Windows 验收）

- **现象与证据**：审查 `main@ac39b5876fa2f255d993b0e8665cad51fe675bff` 的 `transitionAlarmBaselineSession`：每次本代次 `change.kind === "snapshot"` 都重新调用 `establishAlarmSnapshotBaseline`，没有先判断 `state.baseline` 是否已建立。有效的第二份 snapshot 可能把严格递增的序列从 5 重设为 1，再接收在旧基线下本应视为倒退的 delta。该风险来自可达的源码控制流，尚无现场生产事故证据。
- **根因**：将初始快照当成可在任意时刻重复应用的读数，忽视“每个订阅会话只能先建立一次初始基线、后续依靠严格递增 delta 推进”的约束；单独验证快照的质量、时间或会话代次不能防止同代次序列重置。
- **最小修复候选**：在共享归约器已有基线的 snapshot 分支直接返回 `BASELINE_INVALIDATED/SNAPSHOT_ALREADY_ESTABLISHED`，不接受完全相同、更低或更高序列的二次快照。复用现有托管器撤销令牌、订阅适配器清理资源的路径。允许受控上游在显式重启并递增代次后重新接受新的首次快照。新增 5 项测试定义，覆盖纯归约、托管器、活动订阅及同步初始化回调。
- **防复发**：所有以 snapshot 初始化严格递增数据流的状态机都必须区分“首次初始化”和“已建立后重复初始化”；同代次重同步应作为异常信号 fail-closed，真实重新订阅必须明确分配新代次。
- **验证边界**：D5b9t 仅提交代码与测试定义，尚无维护者 Windows 定向测试或 `vp check`、文档和中文文案检查结果。此处令牌身份仅用于本进程回调隔离，不是来源身份认证；FR-011 生产报警仍未实现。

### E-092 · D5b9t 旧测试未同步重复快照拒绝优先级（PR #159，待 Windows 复验）

- **现象**：维护者 2026-11-23 Windows 定向回归，会话归约器 17/18、托管器 10/10、订阅适配器 27/27，合计 **54/55**，命令失败。原测试在已有基线时再次输入坏质量 snapshot，期望 QUALITY_NOT_GOOD，实际 SNAPSHOT_ALREADY_ESTABLISHED；基线已清空。没有本轮后续检查结果。
- **根因**：D5b9t 已将同代次第二份 snapshot 视为非法重初始化，安全拒绝优先于其数值质量检查；旧测试断言仍依赖先前优先级，测试未与新契约同步。此失败不能证明生产快照防护失效。
- **最小修复**：仅调整 packages/core/test/alarm-baseline-session.test.ts 原用例，保留未核验 delta 的拒绝断言；为已有基线重复坏质量快照断言 SNAPSHOT_ALREADY_ESTABLISHED；为无基线首次坏质量快照独立断言 QUALITY_NOT_GOOD。两种路径都必须保持 baseline 为 null。生产代码、公共 API、其余用例均不改。
- **防复发**：修改状态机拒绝优先级时，应检查旧测试是否错误复用已有基线夹具，将首次初始化和重复初始化的负向场景分开断言；不能为通过而削弱 fail-closed 保护。
- **验证边界**：54/55 是修复前 Windows 结果，修复后的 55 项 Vitest、vp check、docs:check 和 messages:check 均待 Windows 复测。FR-011 来源认证、报警触发、确认授权和不可变审计仍未实现。
- **证据**：维护者 Windows 日志、PR #159、packages/core/test/alarm-baseline-session.test.ts、docs/VALIDATION.md。

> **2026-11-23 · E-091 / E-092 结案补录**：维护者 Windows 在修复旧断言后实测三份 Core 定向测试 **55/55**、`vp check` **435/286 零警告错误**、`docs:check` **90**、`messages:check` **310**。GitHub 按明确授权 Squash 合并 PR #159 至 `main@8cbd1d721f8e2a2c7b83733ff64bdb88b28d0dd6`。此前 E-091/E-092 中的“待 Windows 复验”是历史阶段陈述，已由上述单批质量验证关闭；不代表真实数据源认证与工业报警实现。

### E-093 · 失效后的纯归约器仍能在同一代次接受新快照（D5b9u，待 Windows 复验）

- **发现方式**：审查 PR #159 合并后的 `transitionAlarmBaselineSession`：失效时只把 `baseline` 清空。原 `alarm-baseline-session.test.ts` 中的序列倒退和超龄测试甚至明确断言在同一代次通过 snapshot 恢复为 `BASELINE_ESTABLISHED`。这是可达的公开纯函数路径，而不是现场事故或受控托管器已失效的证据。
- **根因**：归约器使用 `baseline: null` 同时表示「新会话尚未初始化」与「本会话已被拒绝并终止」，导致同代次后续 snapshot 重走初始化逻辑；Controller 和订阅适配器虽有令牌撤销但无法覆盖直接使用纯归约 API 的调用者。
- **最小修复**：在 `AlarmBaselineSessionState` 增加只读可选终止标记 `invalidated?: true`，所有 `BASELINE_INVALIDATED` 都清空数值并写入该标记；同代次所有后续操作固定 `SESSION_INVALIDATED` 且保留原冻结状态，旧代次保持忽略；只有显式 `restartAlarmBaselineSession` 严格递增代次才可接受新的首次 snapshot。原有直接同代次恢复断言改为拒绝，新增三项纯归约器回归，托管器一处对象断言同步；不修改 Controller/Adapter 生产逻辑。
- **防复发**：状态机不能单用数据值 `null` 同时表达「尚未初始化」和「明确终止」，否则新的初始化消息可能复活已经失效的会话。对可独立调用的公共层接口同时覆盖首次失败、后续重入、超时、旧代次、显式重启和冻结状态；纯函数终止标记不等于来源身份认证，外部仍需持有受控令牌。
- **验证边界**：本批仅有源码及测试定义，目标会话归约器 **21 项**、托管器 **10 项**、适配器 **27 项**，合计 **58 项**。D5b9u 最新候选尚无维护者 Windows 定向 Vitest、`vp check`、`docs:check`、`messages:check` 实测；不得提前关闭 E-093。未修改真实工业网关、报警规则、确认、审计或正式发布 Gate。
- **证据**：PR #159 已合并代码、D5b9u 功能分支、`packages/core/src/alarm-baseline-session.ts`、两份相关测试、`docs/VALIDATION.md`。

> **2026-11-23 · E-093 结案补录**：维护者 Windows 已实测 PR #160 Core 定向测试 **58/58**、`vp check` **435/286 零警告错误**、文档 **90** 份及中文文案 **310** 个文件通过。经维护者明确授权，GitHub 核对最后一次仅排版提交并将 PR #160 Squash 合并至 `main@8f09f296fc5c3fc5df1c6633939ce80414e137f8`。E-093 的同代次复活问题已在本批门禁验证关闭；不代表工业生产系统已认证。

### E-094 · 直接调用低层序列比较仍可能续接超龄报警基线（D5b9v，待 Windows 复验）

- **发现方式**：在 D5b9u 合并后静态审查公开 `classifyOrderedNumericAlarmSample`，该函数只验证新读数的 GOOD、数值、时间窗口，以及旧读数格式、Tag ID、序列号；不复核旧基线是否仍有 GOOD 质量、有限数值和当前时效。因此直接调用它、或通过 `classifySessionBoundNumericAlarmSample` 的同代次包装，可能接受与旧失效基线关联的新候选。尚无工业现场事故证据。
- **根因**：D5b9s 只为更高层的公开 `advanceAlarmTagDeltaBaseline` 增加旧基线复查；更底层公共序列函数沿用「旧基线初次接受后永久合法」的假设。既有两个旧测试夹具甚至将年龄 2000ms 的前一读数用于 1000ms 最大年龄的所谓合法场景，没有暴露缺口。
- **最小修复**：仅在底层序列函数检查新读数 READY、旧读数存在并与 Tag ID 一致之后，复用 `classifyTimelyNumericAlarmSample(previous, nowMs, maxAgeMs)` 拒绝坏质量、非数值、超龄和未来旧基线。保留原有拒绝枚举、当前输入优先级、序列严格递增与端点规则。两份测试夹具修正为合法年龄 1000ms，新增 3 项直接序列和 1 项代次包装回归，原有负向断言不删除。上层复查保持不变。
- **防复发**：层级公开 API 的每层都要重新审查其依赖的历史状态合法性，不能把某上层调用者的安全检查当成所有直接调用都成立的前提。测试正常输入必须实际满足时间边界；新增反向回归应同时覆盖坏质量、数值、过去、未来及精确上限端点。
- **验证边界**：本轮候选只有 GitHub 源码和测试定义，关联六份文件的 Windows 回归目标为 **89** 项，`vp check`、`docs:check`、`messages:check` 均待维护者复测；未执行真实工业采集、授权确认、审计、数据库或全量 ready。不能将静态核对写成测试通过。
- **证据**：合并后主线的 `packages/core/src/alarm-tag-sequence.ts`、`alarm-tag-delta.ts`、两份相关测试文件、PR #160 与 `docs/VALIDATION.md`。

> **2026-11-23 · E-094 结案补录**：维护者 Windows 在 PR #161 实测六份 Core 关联测试 **89/89**、`vp check` **435/286 零警告错误**、文档检查 **90**、中文文案 **310**；GitHub 确认无冲突和未解决审查意见，按明确授权 Squash 合并至 `main@0db4b4f48511a5d6d6e7606586a16f12c6500088`。E-094 的底层旧基线复查缺口已获得本批定向验收，原“待 Windows”仅为修复前历史阶段。未进行真实工业采集、来源认证或完整 ready。

### E-095 · 递增序列可携带倒退服务器时间推进报警候选（D5b9w，待 Windows 复验）

- **发现方式**：审查 D5b9v 合并后的 `classifyOrderedNumericAlarmSample`，发现它先确认新旧 Tag 样本分别有效，再只比较 `sequence` 严格递增。两条 `serverTimestamp` 即使出现先后倒退，只要都在有效窗口内，下一条仍可返回 `READY`。这是源码构造可达的候选输入路径，并没有现场采集事故证据。
- **根因**：序列顺序与服务端时间窗口校验独立，缺少针对同一会话**新旧服务端时间相对顺序**的判定。D5b9v 的旧基线有效性检查不能自动阻止尚未过期的旧时间。
- **最小修复**：仅在 `alarm-tag-sequence.ts` 对旧基线合法且新序列递增的分支增加 `Date.parse(input.serverTimestamp) < Date.parse(previous.serverTimestamp)`，拒绝原因 `SERVER_TIMESTAMP_REGRESSED`；仍允许相同毫秒时间，且从不使用未经证实的 `sourceTimestamp` 决定顺序。新增 5 项用例定义覆盖低层序列、代次包装、增量接口、纯归约终止以及适配器回收。上层沿用既有安全传播，不增加新依赖或设备操作。
- **防复发**：时效检查只能验证样本对本机时钟仍不过期；不能自动证明有序流中的服务端时间没有回拨。报警候选需分别校验时间窗、序列单调和服务端时间非倒退。并保留来源认证、时钟可信性、会话令牌的独立限制；不能仅凭本地时间比较宣称真实数据源可信。
- **验证边界**：本批只在远程分支创建代码和测试，目标六份关联测试 **94 项**，`vp check`、`docs:check`、`messages:check` 与 Windows 原生 Vite+ 均待运行。未变更 SCADA 正式报警触发、确认、审计、NestJS/Prisma、工业网关、UI 或生产发布 Gate；不能提前关闭 E-095。
- **证据**：PR #161 合并代码、D5b9w 候选分支、`alarm-tag-sequence.ts`、五份关联回归及 `docs/VALIDATION.md`。

> **2026-11-23 · E-095 结案补录**：维护者 Windows 实测 PR #162 六份 Core 定向测试 **94/94**、`vp check` **435/286 零警告错误**、文档 **90** 份、中文文案 **310** 个文件通过。GitHub 核验合并前 SHA `37a3e5a12521ad52105d0136b7a72edd27cfa29e`，无未解决审查意见；经明确授权 Squash 合并至 `main@fd783df24b3748870c4a4b3825886cfb560f7152`。E-095 时间倒退保护的定向门禁已完成，但不等于现场采集可信、完整 ready 或生产报警认证。

### E-096 · 等待首份快照时的显式时效检查绕过无效时钟参数（D5b9x，待 Windows 复验）

- **发现方式**：静态审查 PR #162 合并后的 `transitionAlarmBaselineSession`：已建立基线时会通过 `classifyTimelyNumericAlarmSample` 验证 `nowMs/maxAgeMs`，但等待首份快照的 `CHECK_FRESHNESS` 先返回 `WAITING_SNAPSHOT`。可直接构造本代次传入 `NaN`、负数、非安全整数或非法最大年龄而不撤销令牌，再接收首份有效快照的路径。没有现场事故证据。
- **根因**：把 `baseline === null` 视为时效检查可直接成功等待的条件，忽视显式执行检查时受控时钟和窗口配置本身也必须合法；这不同于无基线读取接口根本不访问时钟的设计。
- **最小修复**：只在 Core 归约器的 `CHECK_FRESHNESS` 分支增加与原时效分类器一致的 `Number.isSafeInteger`、非负当前时间、正最大年龄校验，失败返回既有 `BASELINE_INVALIDATED/INVALID_INPUT` 及冻结终止态，不新增枚举；托管器按原逻辑撤销旧令牌，适配器按原逻辑清理订阅。新增 3 项测试定义覆盖无效时间/配置、严格代次及显式重启、定时回调和同步调度安装。其他代次先忽略，断连不依赖时钟，`snapshot()` 无基线不读时钟。
- **防复发**：状态机的等待阶段不能把外部时钟/配置损坏当成正常无数据；对于明确收到的安全检查命令，必须先核验命令自身参数，再决定是否因没有基线而等待。跨托管器与适配器验证失效令牌、旧闭包、取消资源；不要通过无效时钟下主动读取空基线来伪造检查发生。
- **验证边界**：该分支只提交 GitHub 源码与测试定义，关联六份定向测试预期 **97 项**，实际 Windows Vitest、`vp check`、`docs:check`、`messages:check` 尚未执行。未涉及可信源认证、PLC/DCS、报警触发、确认授权、不可变审计、数据库或完整 ready，禁止提前关闭 E-096。
- **证据**：最新主线 `alarm-baseline-session.ts`、D5b9x 分支三份测试、PR #162 与 `docs/VALIDATION.md`。

> **2026-11-23 · E-096 结案补录**：维护者 Windows 实测 PR #163 六份关联测试 **97/97**、`vp check` **435/286 零警告错误**、文档 **90** 份及中文文案 **310** 个文件通过。GitHub 确认最终 HEAD `9364ae11753ba22d642221f27249bf411fc623ec` 仅增加格式化测试排版提交，无未解决审查意见；经明确授权 Squash 合并至 `main@2a0834c454e332ae2d9182748503f95039822091`。E-096 的定向门禁已完成，但不代表现场时钟可信、完整 ready 或生产报警认证。

### E-097 · 显式时效检查会将错代次或错目标基线视为未变化（D5b9y，待 Windows 复验）

- **发现方式**：静态审查 PR #163 合并后的 `transitionAlarmBaselineSession`。公开纯函数在 `CHECK_FRESHNESS` 有基线时只调用质量与时效筛选；可直接构造新鲜且 GOOD 的 `baseline.generation !== state.generation` 或 `baseline.value.tagId !== expectedTagId`，获得 `BASELINE_UNCHANGED`。正常托管器不会主动产生这种错配，尚无工业现场复现证据。
- **根因**：增量路径已经依赖 `advanceAlarmTagDeltaBaseline` 检查基线的代次与 Tag 归属，但独立的显式时效检查路径未实施同样的一致性前提。
- **最小修复**：在归约器 `CHECK_FRESHNESS` 的有效时间参数和非空基线分支先复核 `baseline.generation === state.generation` 和 `baseline.value.tagId === expectedTagId`。不一致分别返回已有 `BASELINE_INVALIDATED/SESSION_MISMATCH` 或 `BASELINE_INVALIDATED/TAG_MISMATCH`，冻结清空基线，禁止同代次复活。不增加枚举或改变外部订阅接口。
- **防复发**：每个公开归约事件的成功结果都应核对其依赖状态的身份归属，不可仅假设已有上游增量入口验证过。分别覆盖错代次、错 Tag、过期、错误质量、旧代次忽略、冻结和显式重启；不将公共纯函数的输入一致性误称作来源认证。
- **验证边界**：当前仅在 GitHub 候选分支定义两项回归；六份关联测试目标 **99 项**，`vp check`、`docs:check`、`messages:check` 均待 Windows 实测；未执行全量 ready、设备协议采集、报警触发、确认、权限或审计。本批不改变生产发布门禁。
- **证据**：`packages/core/src/alarm-baseline-session.ts`、`packages/core/test/alarm-baseline-session.test.ts`、D5b9y 分支、PR #163、`docs/VALIDATION.md`。

> **2026-11-23 · E-097 结案补录**：维护者 Windows 在 PR #164 实测六份 Core 定向回归 **99/99**、`vp check` **435/286 零警告错误**、文档检查 **90** 份及中文文案检查 **310** 个文件通过。GitHub 复核最后 HEAD `b87985092b60e45623ebcecf1c411526591b29fc` 较上轮仅含测试格式调整；经明确授权 Squash 合并至 `main@e8d36863b4887ad151f9e41affed4042556a02a0`。E-097 定向门禁已关闭，不表示完整 ready 或现场工业报警生产验收。

### E-098 · 矛盾失效态可能通过归约返回值继续暴露旧报警基线（D5b9z，待 Windows 复验）

- **发现方式**：静态审查 PR #164 合并后的 `transitionAlarmBaselineSession`。公开状态允许 `invalidated: true` 同时存在非空 `baseline`。本代次事件命中原终止判断后返回原状态，其他代次事件则优先忽略并返回原状态，因此都能在返回的 `state` 内留下过期工艺候选。受控 Controller 正常不会生成此矛盾对象；没有真实工业现场复现。
- **根因**：终止态分支假设 `invalidated` 与 `baseline === null` 总是一致，未在公共纯函数边界阻断可能由直接调用者传入的矛盾组合；旧代次优先忽略可能不经清理回传旧数据。
- **最小修复**：只在归约器完成事件代次合法性校验后、其他代次判断前，检测 `invalidated === true && baseline !== null`，固定返回 `BASELINE_INVALIDATED/SESSION_INVALIDATED` 与新的冻结空基线状态。原有已正确失效状态的对象引用、旧代次忽略、首次快照与递增代次重启语义不变。新增两项纯归约测试定义，未修改其他生产 API。
- **防复发**：公共状态契约若通过多个可独立设置的字段表达安全不变量，要覆盖字段互相矛盾时的返回值内容，不能只测试正常内部工厂产生的对象；任何拒绝结果都不应携带旧的报警候选值。此本地修复不等于可信数据源认证，也不能防止完全伪造新会话状态。
- **验证边界**：D5b9z GitHub 分支只含生产守卫、两项测试定义与文档；六份关联测试目标 **101**，`vp check`、`docs:check`、`messages:check` 待 Windows 验收；未执行完整 ready、工业采集、报警触发、确认权限或不可变审计。
- **证据**：`alarm-baseline-session.ts`、`alarm-baseline-session.test.ts`、D5b9z 分支、PR #164、`docs/VALIDATION.md`。

> **2026-11-23 · E-098 结案补录**：维护者 Windows 在 PR #165 实测六份关联单测 **101/101**，`vp check` **435/286 零警告错误**，文档检查 **90** 和中文文案检查 **310** 均通过。GitHub 确认无未解决审查意见和冲突，按明确授权锁定 HEAD `c5b1a78c4879cbafbda7761a5e1c75640aa6dc1a` Squash 合并至 `main@25a468aa7fc45e0a09712c9295bebb04f6618459`。该定向验收不等于完整 ready、可信工业源认证或正式报警验收。

### E-099 · 报警候选服务器时间允许无时区格式导致跨宿主解释歧义（D5c0a，待 Windows 复验）

- **发现方式**：静态审查最新主线 `validateTagValue` 和 `classifyTimelyNumericAlarmSample`。通用校验允许任意 `Date.parse` 可解析的字符串，报警候选直接比较解析得到的时间。无 `Z` / `±HH:mm` 的日期时间通常按宿主本地时区解释，不同环境可能对同一输入得出不同新鲜度判定。尚无生产设备或真实事故证据。
- **根因**：通用实时 Tag 可解析的宽松格式被直接当作报警候选的严格时间协议；质量、数值、绝对时间窗和服务端时间非倒退校验，均不能弥补输入时间**没有明确时区**时的跨主机解释差异。
- **最小修复**：只在 `alarm-tag-freshness.ts` 的 GOOD 数值候选分支要求服务器时间具有完整日期时间与明确 `Z` 或偏移量，允许等价时区表示；缺少时区抛中文 TypeError，上层依既有异常映射 fail-closed。不改 TagStore、源时间字段、公共枚举或函数签名。新增 5 项测试定义覆盖筛选、初始快照、直接增量、归约终止和订阅资源清理。
- **防复发**：时间是否可被 `Date.parse` 接受，不等于跨语言/跨时区传输语义明确；报警类决策必须同时明确源时间、服务端时间、时区/偏移与可信赋值方的边界。不要为修复候选路径擅自调整通用 Tag Schema 或历史迁移数据，也不能把有时区解释成真实性认证。
- **验证边界**：当前只有 GitHub 远程候选代码和测试定义，八份关联测试目标 **119 项**，`vp check`、`docs:check`、`messages:check` 均待维护者 Windows 实测；未执行真实工业协议/浏览器、服务端可信源认证、报警触发、确认与不可变审计或全量 ready。
- **证据**：`alarm-tag-freshness.ts`、`tag-store.ts`、五份关联测试、PR #165 及 `docs/VALIDATION.md`。

> **2026-11-23 · E-099 结案补录**：维护者 Windows 已实测 PR #166 八份 Core 关联测试 **119/119**、`vp check` **435/286 零警告错误**、文档检查 **90** 份和中文文案 **310** 个文件通过。GitHub 复核最后 HEAD `319e424005cf0bb6a6c77f74037e85f5a93f8678` 的额外提交仅为测试排版，经明确授权 Squash 合并至 `main@abc6c0913c1510da0797c2a6dd9acd6761c9370c`。此验证不代表生产工业报警已完成或完整 ready 通过。

### E-100 · 日期字符串可解析却不存在，导致报警时间被自动滚动（D5c0b，待 Windows 复验）

- **发现方式**：静态审查 D5c0a 合并后的 `alarm-tag-freshness.ts`。明确时区正则只检查年月日的数字形状，`validateTagValue` / `Date.parse` 可能把 `2026-02-30T09:00:00.000Z` 解析为 3 月 2 日相同时刻。独立 Node 22 复现了 2026-02-30、2025-02-29、2026-04-31 的归一化；未发现真实设备事故。
- **根因**：把 `Date.parse` 可解析当作公历日期有效性判断，忽略了宿主对某些越界日的隐式规范化；D5c0a 的明确时区要求不能证明日期实际存在。
- **最小修复**：只在报警候选时效分类器的有时区格式匹配后，对捕获的年月日执行真实公历月长及闰年校验，失败抛 `TypeError("报警服务器时间戳日期无效")`，不产出候选数值。保留现有 GOOD/非数值/时区拒绝优先级、Date.parse 时间窗口、服务端时间非倒退、TagStore 宽松兼容契约及会话失效逻辑。新增五项测试定义，涵盖底层、初始快照、直接增量、纯归约终止和适配器资源清理。
- **防复发**：时间字符串格式合法、能被宿主解析、代表真实公历日期是三个不同的条件。涉及工艺报警候选时，应当检查每项前提；测试在无效日期被归一化后恰位于有效窗口的时钟下运行，避免因超龄而产生假阳性。不得将纯输入格式校验当成可信来源认证。
- **验证边界**：独立 Node 22 日期归一化复现与 7/7 日历规则样例验证不代表项目 Vitest。D5c0b 的八份关联测试目标 **124**，`vp check`、`docs:check`、`messages:check` 均待 Windows 执行。没有工业协议、正式报警规则、授权确认、审计、数据库和完整 ready 实测；发布安全 Gate 保持 fail-closed。
- **证据**：`alarm-tag-freshness.ts`、五份新测试、GitHub D5c0b 分支、PR #166、`docs/VALIDATION.md`。

> **2026-11-23 · E-100 结案补录**：维护者 Windows 在 PR #167 实测八份 Core 关联测试 **124/124**、`vp check` **435/286 零警告错误**、文档检查 **90** 份及中文文案 **310** 个文件通过。GitHub 核对最终 HEAD `1ccf2d7ac7a9fcd7a1cdb17bc71d892fdef9ce87`、11 个修改文件、无未解决意见和冲突，并按本轮明确授权 Squash 合并至 `main@1acb4b1d3750a67f6741ae7899d49c017b8946a8`。E-100 的定向安全回归已验收，不等同完整 ready、可信工业源认证或生产报警上线。

### E-101 · 二十四时表示可被 Date.parse 自动映射为次日零点（D5c0c，待 Windows 复验）

- **发现方式**：静态审查 PR #167 合并后的报警候选时效分类器，发现原有明确时区正则匹配任意两位小时。Node/V8 可将 `2026-02-28T24:00:00.000Z` 解析为次日零点，因而在窗口内得到 `READY`；RFC 3339 §5.6 的互联网时间格式仅允许 00–23 小时，而更宽泛的 ISO 8601 允许 24:00 表达日末。此处是跨格式消费者的一致性风险，不是生产工业事故。参考：https://www.rfc-editor.org/rfc/rfc3339#section-5.6。
- **根因**：D5c0b 只保证公历日期存在，D5c0a 只保证时区明确；将剩余小时范围交给具有 ISO 日末归一化行为的 `Date.parse`，与报警候选期望使用的无隐式跨日格式不一致。
- **最小修复**：在 `alarm-tag-freshness.ts` 的现有时间格式捕获小时并拒绝大于 23 的值，抛 `TypeError("报警服务器时间戳小时无效")`；规范的次日 `00:00` 和日末 `23:59:59.999` 均允许。仍保留 GOOD/数值、时区、公历日期与时效拒绝优先级，TagStore 宽松解析与公共类型不变。新增 5 项测试定义覆盖底层时效、快照、增量、纯会话归约和订阅回收。
- **防复发**：格式上允许的 ISO 日末表示、可被运行时解析、符合项目跨端传输协议是三个不同的前提；报警候选应使用明确的规范子集，并由可信服务端统一时间格式。不得将 Node 的自动归一化冒充原始传感器时间，也不得为了实现规范校验修改通用 Tag Schema 或关闭来源认证门禁。
- **验证边界**：当前只有 Node 日期解析小复现与 GitHub 远程候选源码/测试，八份关联测试目标 **129 项**；`vp check`、`docs:check`、`messages:check`、完整 ready、真实工业网关均未在 D5c0c 执行，须由维护者 Windows 独立验收。暂不实现正式报警触发/确认或不可变审计，发布 Gate 继续 fail-closed。
- **证据**：`alarm-tag-freshness.ts`、新增五份测试、D5c0c 候选分支、PR #167 和 `docs/VALIDATION.md`。

> **2026-11-23 · E-101 结案补录**：维护者 Windows 已实测 PR #168 八份 Core 关联测试 **129/129**、`vp check` **435/286 零告警错误**，`docs:check` **90 份**、`messages:check` **310 个文件**通过。GitHub 复核最终 PR HEAD `97cc7e91eae4de44253e0319554fed64d5033c69` 无阻塞，经本轮明确授权 Squash 合并至 `main@93d3fe63b47c37a2c9ad72901920cbfe4ef33104`。该结果仅代表定向候选与质量门禁，不代表完整 ready、真实网关或生产报警已通过。

### E-102 · 任意长度小数秒被解析器截断后绕过细粒度时间顺序（D5c0d，待 Windows 复验）

- **发现方式**：静态审查 D5c0c 合并后的 `alarm-tag-freshness.ts`：正则允许任意长度 `\.\d+`，`Date.parse` 却只保留毫秒。`2026-11-22T09:00:00.000900Z` 对毫秒时钟被解析为“当前”而不视为未来；同会话 `08:59:59.999900Z` → `08:59:59.999100Z` 的原始亚毫秒倒退被解析为相同毫秒，不触发既有低层 `SERVER_TIMESTAMP_REGRESSED`。独立 JS 复现了这些值的毫秒碰撞；没有生产工艺事故证据。
- **根因**：将高精度时间传给毫秒整数时间接口时缺少输入精度前提，隐式截断造成新鲜度和相对顺序信息丢失。
- **最小修复**：仅在报警候选时间正则中捕获小数秒，长度大于三位时抛 `TypeError("报警服务器时间戳精度超过毫秒")`；原质量、时区、日期、小时、时效及序列校验顺序不变。上层 TypeError 继续映射为终止代次的 `INVALID_INPUT`，不修改通用 TagStore。六项新增测试定义覆盖底层时效/序列、初始快照、直接增量、会话归约与订阅资源清理。
- **防复发**：对精度敏感的时间协议须明确输入表示与判定时钟的单位，不能将解析器舍弃的数字位误认为已经验证。未来上游如提供微秒或纳秒时间，应在可信系统中显式定义规范化和有序性，不能静默截断；小数秒能否解析不证明采集来源真实。
- **验证边界**：本次只完成 GitHub 代码、差异静态核对和独立 JavaScript 正则/解析样例检查（8/8）；八份关联回归目标 **135 项**，项目 `vp check`、Vitest、文档和中文门禁、完整 ready、真实工业网关仍待维护者 Windows 执行。没有修改生产报警触发、确认、审计、数据库或设备写入。
- **证据**：`packages/core/src/alarm-tag-freshness.ts`、六份关联测试、D5c0d 分支、PR #168 和 `docs/VALIDATION.md`。

> **2026-11-23 · E-102 结案补录**：维护者 Windows 已在 PR #169 提供八份 Core 定向测试 **135/135**、`vp check` **435 文件格式正确/286 受检零警告错误**、文档检查 **90**、中文文案检查 **310** 均通过的日志；GitHub 复核最新 HEAD `b9977f6f2d2cf0506eaa8580e8609b7143ee6b89`，按明确授权 Squash 合并至 `main@50148bfd5ce5f66bdf18c32009ce2b076ddb9e3f`。E-102 的本地时间精度修复已完成定向验收，但不证明完整 ready、可信工业上游或生产报警链路已通过。

> **后续设计风险提示（非新错误编号）**：当前逐 Tag `sequence` 是**严格单调增长**而非已确认连续。未经需求与上游协议确认，不能把任何跳号强制判断为丢包，也不能凭严格增长保证中间报警变化未遗漏。后续 FR-011 开发应先完成来源身份、序列域、跳号/重同步、可信时钟和不可变审计的 ADR 与隔离联调计划；不要把尚未实现的服务端报警身份认证写成已通过的本地测试。

### E-103 · D5c0j 进程内 Lab JSDoc 纯类型行触发中文文案门禁（PR #175，待 Windows 复验）

- **现象**：维护者 Windows 执行 `node --experimental-strip-types --test scripts/lab-alarm-inprocess.cases.mjs` **5/5 通过**，独立 Lab 诊断符合预期；`vp check` **439 个格式文件 / 288 个受检零警告错误**，`docs:check` **92 份 Markdown 通过**。随后 `messages:check` 在 `scripts/lab-alarm-inprocess.mjs` 的四处单行 JSDoc `@type` 注释报告“注释缺少中文”，退出码 **1**，整个 `&&` 命令链失败。本问题不属于 Lab 报警候选运行故障，且不能把前面的成功记成完整门禁通过。
- **根因**：仓库 `scripts/check-chinese-messages.mjs` 对自有注释按**单行**识别；`/** @type {...} */` 含英文类型、无中文描述，触发已有中文化规则。先前只执行了格式/Lint/运行测试，没有在推送 PR 前独立运行文案门禁。
- **最小修复**：只在四处原有 JSDoc 的 `@type` 类型表达式后补上中文说明，保留 TypeScript 类型约束、模拟数据、核心逻辑、五项测试、默认无网络/无正式报警安全边界；不修改中文检查器、不关闭规则、不删除类型声明。
- **防复发**：新增或修改 JSDoc 类型标注时，同一条注释也必须包含简体中文说明。提交前按 `node --experimental-strip-types --test`、`vp check`、`docs:check`、`messages:check` 顺序完整执行；`&&` 链中任何一步失败即为整体失败。
- **验证边界**：已从 GitHub 最新候选内容逐行对照 `check-chinese-messages.mjs` 的注释判定条件，四处静态扫描不再命中；**修复后 Windows Node/Vite+/文档/中文门禁尚未复验**。PR #175 继续 Draft，不能据此前测试结果合并，也不代表真实网关认证、序列完整性或工业报警验收。
- **证据**：维护者 2026-11-23 Windows 原始输出、PR #175、`scripts/lab-alarm-inprocess.mjs`、`scripts/check-chinese-messages.mjs`、`docs/VALIDATION.md`。

> **2026-11-23 · E-103 Windows 结案补录**：维护者修复四处 JSDoc 中文注释后，在 Windows 实际运行 `pnpm run messages:check` **312 个文件通过**，并执行 `vp check` **439 格式/288 受检零警告错误**、`docs:check` **92 份**、Node 进程内 Lab **5/5** 和独立诊断，均通过。GitHub 复核最后 PR #175 HEAD `9f7fecfab4432f37e9be7ae882f5d481d5c8870f`，按维护者授权 Squash 合并至 `main@54a3d4b9868474e94ecbed81f088cdd8c259710e`。原条目“待 Windows 复验”是历史阶段说明，本次中文文案门禁阻塞已经关闭。Windows 日志未输出本地 HEAD，不将其冒充为合并 SHA 的直接运行证据；FR-011 正式可信采集与报警仍未上线。

### E-104 · D5c0l UI 视觉改造覆盖既有 Studio 侧栏宽度契约（PR #177，待 Windows 复验）

- **现象**：维护者 Windows 对 PR #177 执行 `pnpm run ready`，输出显示 `messages:check` **312 文件**、`vp check` **440 格式/288 受检零警告错误**、Vitest **863/863**、S0 Lab **5/5**、NestJS E2E **63/63**、文档 **93 份**与双框架 Web 构建均成功；但原始日志未单独打印 `ready` 最终退出码。随后 `pnpm run test:browser` 在 React/Vue 的 **1440×900** 和 **1024×768** 四组场景均为 **16/19**：固定左宽 252px、固定右宽 320px 与“画布占据剩余宽度”三项失败，整个命令链退出码 1，`test:tags:browser`、`test:interop` 因 `&&` 未运行。
- **根因**：新共享 `packages/tailwind/src/studio.css` 的末尾覆盖了既有 `--studio-left-width: 252px` 与 `--studio-right-width: 320px`，设置成 260px/324px，并在不超过 1250px 时再次覆盖为 238px/292px。先前只做了 CSS 括号/双端类名静态核对，没有逐项比对 `scripts/test-studio-browser.mjs` 对工作区几何的实际验收断言。此为视觉改造引入的回归，不能通过改测试宽度或放宽断言消除。
- **最小修复**：仅删除 D5c0l 新增 CSS 中这两组布局变量覆盖，保留原共享工作区的 **252px/320px** 与画布 `minmax(0,1fr)` 计算。不修改现有脚本、图元、交互、工程文档、React/Vue 页面或组件 API。
- **防复发**：修改 UI 前先检查现有 CSS Token、可执行浏览器断言、分辨率和真实组件依赖。布局与控件职责分开：复用 `tdesign-react` / `tdesign-vue-next` 及官方 Token，不为 TDesign 已支持的 Button、Input、Select、Tabs、Dialog、Table、Tree 等重新封装同职责控件；Tailwind 管布局，受控 CSS 只用于工业画布等独特交互。尚未查询的 TDesign API 不能猜测。修复浏览器回归时优先修生产 CSS，不降低现成测试要求。
- **验证边界**：GitHub 已静态核对主线宽度定义及脚本三项几何断言；删除覆盖后的浏览器回归、`vp check`、`docs:check`、`ready` 与后续双端视觉检查 **均待维护者 Windows 在最新 HEAD 重新执行**。此修复不能标记为已通过。
- **证据**：维护者 2026-11-23 Windows 原始 `ready` 与 `test:browser` 日志、`scripts/test-studio-browser.mjs`、`packages/tailwind/src/studio.css`、PR #177、`docs/VALIDATION.md`。

### E-105 · D5c0p 主题 CSS 静态测试忽略媒体查询覆盖（待 Windows 复验）

- **现象**：新主题测试最初使用 `findLastRule(css, selector)` 检查某个 CSS 选择器的 Token。静态复核发现 `.scada-app-nav` 和 `.scada-app-nav > button` 在共享样式中同时有基础规则与后面的窄屏 `@media` 规则，最后一条不一定声明正在检查的属性，因此原断言会错误失败。
- **根因**：把 CSS 中最后出现的同名选择器当作唯一目标规则，忽略媒体查询对不同属性分别设置响应式覆盖的合法写法。
- **修复**：改为 `findRules(css, selector)` 获取所有匹配规则，再检查至少一条确实声明预期 Token；不改媒体查询、不取消响应式覆盖、不削弱样式原值和 Studio 252px/320px 的独立断言。
- **规避与验证**：未来写静态 CSS 断言先检查选择器是否在 `@media` 中重现，不能假定最后声明包含所有属性；对样式改动逐行比较原值与替换后的 Token 解析值，确认结果相等。已在 GitHub 源码静态核对 19 处 Runtime、11 处 Studio 替换值不变；Windows `vp test run packages/runtime/test/theme-tokens.test.ts`、`vp check` 和浏览器验收**尚未执行**。
- **证据**：D5c0p 开发分支的 `packages/runtime/test/theme-tokens.test.ts`、`packages/runtime/src/runtime.css`、`packages/tailwind/src/studio.css`。

> **2026-11-23 · E-105 Windows 复验补录**：维护者在 PR #181 的 Windows 日志中实际完成 `theme-tokens.test.ts` **6/6**、`vp check` **445 格式/289 受检零警告错误**，完整 Vitest **870/870**、NestJS E2E **63/63**、文档 **93** 份、React/Vue 构建均通过。最后一次远程提交 `44cd8b562f5b0434172d1823531f7a780f00b919` 仅增加测试格式化修改；经维护者授权 Squash 合并至 `main@66c006de3fb915138ca79608afac5bb1b9c542a7`。因日志未给本地 HEAD、完整命令退出码和浏览器记录，不把这些缺失证据视为已验证；本次确认 CSS 重复选择器断言不再阻断 Windows 主题测试。

### E-106 · D5c0u 双标签页由 React 切换到 Vue 时异步工作台未挂载（PR #186，待定位）

- **维护者 Windows 真实现象**：PR #186 的 `typecheck:web` 通过，`vp check` **446 个格式文件/289 个受检零告警错误**，`docs:check` **94 份**，`test:browser` React/Vue 四组 **120/120**，`test:interop`、`test:versions:safety`、`test:legacy:browser` 均通过。独立 `test:multitab` 中 React 广播停写、无广播 CAS、墓碑重建及 IndexedDB 故障恢复四阶段通过；切换 Vue 时首次 `navigateStudioForInterop` 在 `enterStudioInPage()` 报“点击组态编辑后未能加载工作台”，退出码 **1**。Vue 导航按钮已激活，页面只见导航，未到 Vue 多标签页的业务断言。
- **已确认的代码背景**：Vue `App.vue` 使用 `defineAsyncComponent(() => import('./studio/StudioPage.vue'))`。`runStudioMultiTabSafety` 用 `Promise.all` 同时导航两个标签页；`enterStudioInPage()` 点击编辑后等待 `.studio-workspace` 和 `.studio-svg`。这个控制流解释失败发生的阶段，**还不能确认是模块网络请求、Vue 运行时、Popup 组件、服务资源或同时导航所致**。其他 Vue 专项通过不等于当前多标签页已经通过。
- **当前最小诊断候选**：仅修改 `scripts/test-studio-browser.mjs` 的 `enterStudioInPage`，在导航期间监听脚本错误、资源失败与未处理异步拒绝，并通过固定布尔字段说明是否发出 Studio 模块请求、是否观察到模块加载异常。保留原有 **15 秒 + 5 秒** 严格等待和真实双标签页断言；在 `finally` 清除监听器，不输出原始错误或资源 URL，不重试或吞掉失败。未修改正式 Vue/React 页面、草稿 CAS、Popup 或浏览器实例管理。
- **防复发**：带异步组件的双端浏览器测试，应将“导航已经切换”与“组件实际挂载”区分；定位失败前记录严格白名单诊断，再依据真实证据修复，不得只延长超时、串行化业务断言、禁用安全测试或将其他专项通过冒充当前通过。
- **待验证**：维护者在 PR #186 最新 HEAD 上执行 `node --check scripts/test-studio-browser.mjs`、`vp check`、`pnpm run test:multitab`。若复现，依据新增分类确定后续最小修复；即使偶发通过，也不能凭一次结果断言根因解决。**本条为已发生的测试阻塞和待核实诊断，非结案。**

> **2026-11-23 · E-106 第二次 Windows 诊断补录（根因仍待定位）**：维护者在未修改业务逻辑的诊断分支实测 `node --check`、`vp check`（446/289 零告警）与 `docs:check`（94 份）均通过；`test:multitab` 再次退出码 **1**。React 四阶段仍通过，Vue 第一次导航观测为工作台=false、SVG=false、模块请求=true、模块加载异常=true、脚本异常=false、未处理异步拒绝=true、脚本/样式资源失败=false。这证明异步导入已被请求且发生失败，**未提供失败资源的 HTTP 状态码或 Chromium 网络错误，不能直接认定 Vite 缓存或 504**。
> **进一步最小诊断**：仅在 `test:multitab` 首次 Vue 双标签并发导航期间启用 CDP `Network` 事件观察，按首/次标签记录同源 Studio 模块、Vite 预构建依赖、Vue 应用模块或工作区模块的 HTTP 失败状态和白名单网络错误类别；遇到失败时追加汇总，不输出资源 URL、Cookie、请求/响应正文或底层异常。保留真实两标签同时导航、全部 CAS 安全断言和现有 15s/5s 门禁；尚未运行新提交的 Windows 验收，因此 E-106 **仍未关闭**。

> **2026-11-23 · E-106 第三次 Windows 诊断与预构建候选（待复验）**：维护者再次执行 `node --check`、`vp check`（446/289 零告警）与 `docs:check`（94 份）均通过，但 `test:multitab` 仍退出码 **1**。双标签网络诊断报告首标签 `Studio模块HTTP=200` 且 `Vite预构建依赖:其他网络错误`，次标签 `Studio模块HTTP=200` 且 `其他同源资源:导航中断`；动态导入模块源文件可响应，至少一个预构建依赖在首次双标签加载时发生网络错误。**未取得准确 Chromium 错误码或明确 HTTP 504；不把缓存过期当作已证实根因。** 截图中的正常 Vue 运行监控不代表按需 Studio 已加载，且不能直接证明与脚本隔离的 Chromium 会话是同一浏览器上下文。
> **最小候选变更**：`apps/web-vue/vite.config.ts` 的 dev `optimizeDeps.include` 增加项目已安装的 `tdesign-vue-next`、`tdesign-icons-vue-next`，针对 `App.vue` 按需 `import('./studio/StudioPage.vue')` 首次发现 TDesign 依赖而重新预构建的可能性；不升级依赖、不修改业务、React/Vue DOM、HTTPS 或工业数据。浏览器网络监视器对不在已知中文映射中的错误仅输出通过 `^net::ERR_[A-Z0-9_]{1,64}$` 限制的 Chromium 固定码，拒绝原始 URL、Cookie、请求正文和异常文本。两标签同时导航、15s/5s 门禁、CAS 保护均不变。配置改动需要**重启 Vue Vite 开发进程并强制预构建**才可有效复验；如果仍失败，保留真实错误码进一步定位，不能以缓存假设替代事实。Windows 验收尚未执行，E-106 仍待结案。

> **2026-11-23 · E-106 第四次 Windows 复验：已确定 Chromium HTTP 缓存写入失败**：维护者的最新 `node --check`、`pnpm run typecheck:web`、`vp check`（446 格式/289 受检零告警）和 `docs:check`（94）通过；`test:browser` React/Vue 四组 **120/120** 通过。`test:multitab` React 广播、无广播、墓碑及 IndexedDB 故障保护四阶段均通过，但 Vue 首次异步 Studio 加载仍退出 1。CDP 明确报告首标签 `Studio模块HTTP=200`、`Vite预构建依赖:Chromium错误码=net::ERR_CACHE_WRITE_FAILURE`，次标签 Studio 模块 200、未见其他失败。这说明 Chromium 读取开发资源时 HTTP 缓存写入发生故障，不能把它等同 Vite 返回 504 或 TDesign 源码错误；具体文件系统容量、权限或安全软件原因仍未验证。
> **最小隔离候选**：撤回上一轮未能解决问题的 `apps/web-vue/vite.config.ts` 中 `optimizeDeps.include`（配置恢复至 PR #185 合并主线）；仅在 `scripts/test-studio-browser.mjs` 的 Vue 双标签测试进入导航前，通过官方 CDP `Network.enable` 和两次 `Network.setCacheDisabled({ cacheDisabled: true })` 让两个标签页忽略 HTTP 缓存。禁用的仅是测试会话的网络缓存，不触碰 IndexedDB、BroadcastChannel、草稿修订号或 CAS，也不放宽 HTTPS、等待阈值和并发导航断言。失败仍保持非零退出，保留网络诊断。参考 Chrome DevTools Protocol Network.setCacheDisabled 官方文档。
> **待 Windows 验证**：运行 `node --check scripts/test-studio-browser.mjs`、`vp check`、`pnpm run docs:check`、`pnpm run test:multitab`。若仍报告 `ERR_CACHE_WRITE_FAILURE`，进一步检查 Chromium 临时配置目录所在盘的剩余空间、系统安全软件和本机文件权限，不删除任何个人浏览器配置、不关闭 TLS、不跳过 Vue 多标签。未经复验不能关闭 E-106 或合并 PR #186。

> **2026-11-23 · E-106 Windows 验收补录（阻塞已绕过，系统诱因仍待查）**：维护者在 PR #186 最终候选实测 `node --check`、`vp check`（446 格式/289 受检零告警）、`docs:check`（94）和多标签页专项。此前反复出现的 Vue Studio `net::ERR_CACHE_WRITE_FAILURE` 在测试 CDP 为 Vue 双标签调用 `Network.setCacheDisabled({cacheDisabled:true})` 后，本轮 React 与 Vue 各 4 阶段（BroadcastChannel、无广播过期 CAS、墓碑修订号、模拟 IndexedDB 故障恢复）全部通过，失败退出检查未触发。**确认的是受控测试环境 HTTP 缓存隔离有效，不意味着 Windows 磁盘权限或 Chromium 缓存的系统成因已修复，也不证明永远不会复发**。GitHub PR #186 最终 HEAD `c67bc33d1520b10a0a046e51d52213a8115bff0c`，经维护者授权 Squash 合并 `main@1faca1a386c83314e24f245b7ea394c80f1c7cb0`。日志没有单独提供本地 HEAD；历史四次失败证据保留，后续发现同类异常仍须按分类复诊。

### E-107 · D5c0v 测试 Popup 关闭超时在 finally 内抛出异常（PR #187）

- **维护者 Windows 现象**：PR #187 在追加本地历史迁移 Popup 关闭同步后，执行 `vp check --fix` 报 `eslint(no-unsafe-finally)`：`scripts/test-studio-browser.mjs:1743` 的 `finally` 内抛出「TDesign 文件草稿弹层关闭超时」。Vite+ 报 **0 错误、1 告警**，格式化阶段完成；不能将其记录为零告警通过。
- **根因**：`studioDraftFileActionInPage` 为等待 TDesign 弹层关闭，把 5 秒轮询与 `throw` 放在恢复 `window.confirm` 的 `finally` 中；如果此前点击操作已经失败，`finally` 再抛出异常会覆盖原始失败，并违反仓库 `no-unsafe-finally` 约束。
- **最小修复**：保留原有真实按钮操作、12 秒业务通知等待及异常传播，将成功通知先记录在局部变量；`finally` 只负责恢复 `window.confirm` 和触发关闭；正常完成后在 `finally` 外继续等待面板隐藏，并保留原 5 秒关闭超时与中文报错。业务动作失败时先传播原始错误，不让关闭检查覆盖它；不修改 React/Vue 组件、草稿数据或其他版本安全断言。
- **防复发及验证**：浏览器测试中的 `finally` 仅执行不改变控制流的清理，不在其中 `throw`、`return` 或 `break`；等待可能失败的关闭流程应安排在正常路径，避免掩盖真正的断言或 I/O 异常。修复已提交 PR #187 功能分支；**修复后的 Windows `node --check`、`vp check`、`docs:check`、`test:legacy:browser`、`test:versions:safety` 及发布预检测试尚待真实复验**，不得写成已通过。
- **证据**：维护者 2026-11-23 Windows `vp check --fix` 原始输出、`scripts/test-studio-browser.mjs` 和 PR #187。

### E-108 · D5c0w 首次批量迁移未先核对 React Collapse 的面板导出契约

- **发现阶段**：全量 TDesign 迁移候选初稿误将 React `CollapsePanel` 当作 `tdesign-react@1.18.6` 可直接命名导出的组件，套用了与 Vue `CollapsePanel` 相同的写法。随后在正式提交交付前复核固定版本官方源码的 `collapse/index.ts` 与 `Collapse.tsx`，确认 React 应使用 `Collapse.Panel` 静态子组件；Vue Next `1.20.11` 才直接提供 `CollapsePanel`。此为代码候选阶段发现的**真实 API 使用错误**，尚没有 Windows 类型检查失败日志，不得伪称实测报错。
- **修复**：将 React Studio 三处 `CollapsePanel` 改为 `Collapse.Panel`，移除错误命名导入；Vue 保持 `TCollapsePanel`。React/Vue 通用组件替换仍须分别核对各自固定版本，不凭名称相似假设 API 完全一致。
- **防复发与验证**：代码批量替换前核对固定版本的组件入口、Props、事件、插槽与真实 HTML 语义；发生 JSX 标签替换时检查首尾配对、残留标签和浏览器测试的旧 DOM 选择器。已在 GitHub 候选分支静态确认误用移除；`pnpm run typecheck:web`、`vp check` 及真实浏览器仍待维护者在最终 PR HEAD 运行。
- **证据**：D5c0w 分支 `apps/web-react/src/studio/StudioPage.tsx` 历史修改、Tencent TDesign React 固定版本 `Collapse.tsx` 和 `docs/TDESIGN_COMPONENT_AUDIT.md`。

### E-109 · D5c0w React TDesign Button 拖拽事件类型与 Select 值域不一致（PR #188）

- **Windows 实测现象**：维护者执行 `vp check --fix`，在 `apps/web-react/src/studio/StudioPage.tsx` 的 `startLayerDrag`、`overLayer`、`dropLayer` 调用处出现 TypeScript **TS2345 共 3 个错误**；`apps/web-react/src/runtime/PublishedRuntimePage.tsx` 一处、`StudioPage.tsx` 三处 `String(value)` 出现 `typescript(no-base-to-string)` **共 4 条告警**。输出为 291 个受检文件，格式化完成**不能视为类型和 Lint 通过**。
- **根因**：把原生按钮批量改为 TDesign React `Button` 后，`onDragStart/onDragOver/onDrop` 暴露的是 `DragEvent<HTMLElement>`，原函数仍要求更窄的 `DragEvent<HTMLButtonElement>`。当前固定版本 `tdesign-react@1.18.6` 的 Select `onChange` 返回 `SelectValue`，可能为字符串、数字、布尔、选项对象或数组；对整个联合类型调用 `String(value)` 可能把对象错误转换为 `[object Object]`，重复 E-052 隐式字符串化风险。
- **最小修复候选**：仅修改 React 两个页面文件：三个现有图层拖拽处理函数参数改为 `ReactDragEvent<HTMLElement>`；四处 Select 回调先检查 `typeof value === "string"`，只接受合法字符串 ID，不转换对象、数组或布尔值。不修改拖拽/命中算法、Vue 适配、Tag/工程 Schema、CAS、已发布工程权限、数据持久化、既有测试或 TDesign 依赖版本。
- **防复发与复验**：迁移基础 UI 控件时不能假定 TDesign 事件泛型与原生标签完全一致；确认官方回调联合类型后收窄再写入状态，禁止靠类型断言或关闭 Lint 规避。请在最终 PR HEAD 上运行 `pnpm run typecheck:web`、不带 `--fix` 的 `vp check`、`pnpm run docs:check`，并执行图层拖拽与 Select 操作的 React/Vue 浏览器回归。**截至本记录仅完成 GitHub 静态修复，尚未获得修复后的 Windows 检查结果。**
- **证据**：维护者 2026-11-23 `vp check --fix` 原始输出、PR #188 的 React 代码和固定版本 TDesign React `select/type.ts`。

### E-110 · D5c0w Vue TDesign Select 回调签名遗漏 bigint 与模板类型推断错误（PR #188）

- **Windows 实测现象**：维护者执行 `pnpm run typecheck:web`，React `tsc --build` 后进入 Vue `vue-tsc --build`，共报 **7 个错误**，最终命令退出码 1（Vue 递归脚本退出码 2）。其中六条 TS2322 分布在 Vue 已发布运行页 1 处、Studio 4 处、TagManager 1 处；另有一条 TS2339 位于 Studio 模板 `TAG_DATA_TYPE_LABELS[option.dataType]`。后续 `vp check`、`messages:check`、`docs:check`、单测及浏览器脚本因 PowerShell 失败即中断，**均未在本轮执行**。日志未单独给出本地 HEAD，不伪造验证对应的 SHA。
- **根因**：D5c0w 首次批量迁移为 TDesign Vue Select 自行声明了 `string | number | (string | number)[]` 类型的回调，但固定 Catalog `tdesign-vue-next@1.20.11` 的官方 `SelectValue` 还包含 `bigint`、布尔值、选项对象与递归列表，回调参数因此不能直接匹配。Tag 候选项在 Vue 模板的多行 `:options` 表达式中拼接导入的 `TAG_DATA_TYPE_LABELS`，触发了 `vue-tsc` 对该 Record 的 `.value` 访问诊断。
- **最小修复候选**：只修改三个 Vue SFC。六处 `@change` 处理函数参数类型统一为 `unknown`，函数内部仍只接收字符串 ID 或限定枚举；拒绝将对象、数组、数字、`bigint` 转成非法 Tag/页面/图层 ID。把 Tag 绑定下拉候选项提为 `<script setup>` 中的 `tagBindingOptions = computed(...)`，模板仅使用 `:options="tagBindingOptions"`。保留“未绑定”、历史缺失 Tag 占位、数据类型中文标签及原有 Tag 类型约束；不触碰 React、Core、Schema、CAS、OIDC 与工业写入边界。
- **防复发与验证**：双框架 UI 组件事件回调不能按原生 `select` 事件的值域自行缩窄形参；先核对各自固定版本 API，宽接受、窄校验。复杂选项列表放在脚本 `computed`，减少 Volar 模板自动展开的歧义。**目前只完成 GitHub 源码静态核对；修复后的 Windows `pnpm run typecheck:web`、`vp check`、`docs:check` 及双框架浏览器测试仍待真实执行**，不可将本次改动视为质量门禁通过。
- **证据**：维护者 2026-11-23 Windows PowerShell 中 `vue-tsc` 七条错误及最终失败退出码、PR #188 的三个 Vue SFC、`tdesign-vue-next@1.20.11` 固定官方 `select/type.ts`。

### E-111 · D5c0w 全量 TDesign 迁移后残留原生样式导致 Studio 控件视觉不一致

- **真实现象**：2026-11-23 维护者提交 React/Vue TDesign 全量迁移后 Studio 深色页面截图，红框标示左侧图层区的输入描边、图层行与侧栏分界，以及右侧 Tag 定义区的编辑/删除按钮：焦点/边框过亮、右侧按钮纵向大块堆叠、同一区域按钮尺寸不一致。维护者同期 Windows `typecheck:web`、`vp check`（448/291 零告警）、`messages:check`（318 文件）、`docs:check`（94 文档）通过；**这些静态检查并不能证明视觉质量或所有浏览器安全测试通过**。PR #188 经明确授权 Squash 合并为 `main@30d1133e711361640e9b86bd89664a19aee6c085`。
- **源码原因**：迁移后两套 `apps/web-*/src/studio/studio.css` 仍向全部 TDesign Button 注入 `height:auto` 和最小高度，遗留 `.studio-field input/select/textarea` 的原生边框与填充；`packages/tailwind/src/studio.css` 对所有原生控件无差别应用强烈的青色 `:focus-visible` 轮廓。TagManager 的条目与表单操作沿用未专门布局的 `studio-toolbox`，所以旧式全宽按钮行为与新 TDesign `size=small` 并存；左侧图层选中边框及侧栏边界叠加强调。
- **修复候选**：新 D5c0x 分支最小范围内，将 Tag 条目和表单动作明确分为各自 2 列并统一 `--adui-control-height-sm`（28px），编辑/删除分别使用现有 TDesign Text Button 及 danger 语义，不再堆叠整列主色按钮；两端图层行复用 TDesign Text Button，搜索使用 `size=small`。清理两端旧按钮通用高度覆盖和原生输入二次描边；共享 CSS 将焦点交给 TDesign 自己管理，仅保留专用图层键盘焦点状态，同时柔化侧栏分界与选中边框。不改 Tag 删除确认、Tag ID、图层命中/拖拽、工程 Schema、CAS 或工业安全边界。
- **防复发**：迁移 UI 组件时必须同时清理旧原生控件尺寸/轮廓覆盖，而不是仅替换 JSX/Vue 标签；对同一业务区域增加真实 DOM 的尺寸/布局断言。已在 `test:tags:browser` 对两端 Tag 行及表单动作增加双列、等宽、等高约束。**截至候选提交未执行 Windows Vite+/真实浏览器，静态 CSS 和源码检查不等于完成验收**。
- **证据**：维护者 2026-11-23 Studio 截图、两端 `TagManager` 和 `studio.css`、共享 `@adui/tailwind/studio.css`、原 `scripts/test-studio-browser.mjs` 及 PR #188。

### E-112 · React 19 未加载 TDesign 官方适配器导致 DialogPlugin 无法挂载（PR #189）

- **Windows 实测现象**：维护者在 PR #189 分支执行 `pnpm run typecheck:web`、`vp check`（448 格式文件 / 291 受检文件零告警）、`messages:check`（318 文件）、`docs:check`（94 份）和 `test:browser`（React/Vue × 1440×900/1024×768，四组各 **33/33**）均通过，但 `test:tags:browser` 在真实点击 Tag 的「删除」后等待 TDesign Dialog 确认按钮超时，报 `Tag 删除确认弹层未出现`，整个命令链退出码非零。其后 `test:interop`、`test:versions:safety`、`test:multitab` 未执行。日志未单独打印本地 Git HEAD，不能把通过记录绑定为修复后提交。
- **确定的源码缺口**：根 Catalog 声明 `react@19.3.1`、`react-dom@19.3.1` 与 `tdesign-react@1.18.6`，React 入口 `apps/web-react/src/main.tsx` 未加载官方 React 19 适配器。对照 TDesign 固定版本 `packages/components/_util/react-render.ts`：React 19 下既没有 ReactDOM 旧版 `render`，也不会自动初始化 `legacyCreateRoot`；`DialogPlugin.confirm` 调用该内部渲染函数时可无内容挂载。官方 `packages/tdesign-react/site/docs/getting-started.md` 的「如何在 React 19 中使用」明确要求 `import "tdesign-react/es/_util/react-19-adapter"`。组件按钮、确认文案和原 `.t-dialog__confirm` 选择器不是已证实的根因，不通过弱化测试规避问题。
- **最小修复**：只在 React 入口 `main.tsx` 的 `createRoot` 导入后、`App` 导入前加入官方适配器副作用 import，不新增依赖、不修改 DialogPlugin Promise 取消/确认契约、不替换为 `window.confirm`、不改 Vue 端。保留 Tag 删除前真实 Dialog 授权和已绑定 Tag 删除保护。针对双框架 `test:tags:browser` 增加「点击取消后工程 JSON 中该 Tag 仍存在」断言，原确认删除/受绑定拒绝用例继续有效。
- **防复发**：引入需要 React Portals / 插件式动态渲染的 UI 库时，必须按当前 React 主版本阅读固定依赖的兼容说明，不能以普通 Button/Input 类型检查通过推断插件式 Dialog 正常。浏览器专项除静态 DOM 选择外必须点击确认与取消两条路径，并验证项目 JSON 未被取消操作修改。
- **验证边界**：以上为固定版本官方源码与仓库现状的确定性诊断及 GitHub 修复候选，**尚未拿到新 HEAD 的 Windows `typecheck:web`、`vp check`、`test:tags:browser` 或 Vue/React 真实 Dialog 结果，不能声称已复验通过**。后续依次执行质量检查及 `test:browser`、`test:tags:browser`、`test:interop`、`test:versions:safety`、`test:multitab`。
- **证据**：维护者 2026-11-23 Windows PowerShell 输出、`apps/web-react/src/main.tsx`、`apps/web-react/src/studio/StudioDialog.tsx`、`scripts/test-studio-browser.mjs`、TDesign React `tdesign-react@1.18.6` 官方 `react-render.ts`、`react-19-adapter.ts` 和 `getting-started.md`。

### E-113 · Tag 浏览器验收导航失败缺少 Chromium 级诊断（PR #189）

- **Windows 实测现象**：维护者在 PR #189 最新一轮执行 `pnpm run typecheck:web` 成功、`vp check` **448 格式文件/291 受检零告警错误**、`messages:check` **318 文件**、`docs:check` **94 Markdown** 后，`test:tags:browser` 在第一个 React URL `https://127.0.0.1:15173/?scada_interop_check=tag-management` 导航阶段失败，退出码 1。未到 Tag 删除 Dialog 检查阶段；后续其他浏览器专项未执行。用户日志没有附上当前本地 HEAD，不能将先前 React 19 适配器缺口直接断定为本次导航失败的原因。
- **定位结果**：`navigateStudioForInterop` 用固定 60 次 × 150ms 读取目标地址和 `document.readyState === "complete"`，失败时仅输出实际 URL，没有 Chromium `Page.navigate.errorText`、文档状态或同源模块网络错误；单凭该异常无法区分 TLS、网络中断、Chromium 缓存、Vite 热重建及其他资源原因。先前 E-106 在隔离多标签页中**实测**出现 `net::ERR_CACHE_WRITE_FAILURE`，通过 CDP `Network.setCacheDisabled` 绕过，但本次 Tag 导航尚未取得同种错误码，不能把 E-106 当成已证实的新根因。
- **最小候选**：仅改 `scripts/test-studio-browser.mjs`。在 `--tags` 独立临时 Chromium 中调用 `Network.enable` 与 `Network.setCacheDisabled({cacheDisabled:true})`，使本机开发资源不依赖有故障记录的 HTTP 磁盘缓存；**不触碰 IndexedDB、BroadcastChannel、业务 CAS、TLS 校验或设备数据**。对 `--tags` 的真实导航开启已有 `watchStudioModuleNetwork` 观察器，只在失败时附加按同源资源类别脱敏的诊断，在 `finally` 关闭监听。导航失败错误增加白名单 `net::ERR_[A-Z0-9_]{1,64}`、地址匹配布尔值和 `document.readyState`，同时补充 React 入口、React 19 适配器、React/Vue Studio 模块分类；不输出 HTTP 正文、Cookie、授权信息或异常堆栈。
- **防复发与验收**：不延长原 60 × 150ms 门槛，不重试掩盖失败，不取消真实 Tag 确认/取消和已绑定拒绝断言。若隔离 HTTP 缓存后通过，仅证明该会话可继续验收，不能据此认定本次原失败根因就是缓存；若仍失败，先据新诊断分类查网络/证书/模块再改正式应用。**本批仅已提交 GitHub 候选，尚未运行 Windows `node --check`、`vp check`、`test:tags:browser`，不得声称修复已实测通过。**
- **证据**：维护者本轮 Windows 原始失败日志、`scripts/test-studio-browser.mjs` 现有导航/网络诊断、历史 E-106 Chromium 缓存实测记录和 PR #189。

### E-114 · Tag 浏览器脚本可能点击退出动画中的旧 Dialog（PR #189，待 Windows 复验）

- **真实现象**：2026-11-23 维护者在 PR #189 上执行 `node --check scripts/test-studio-browser.mjs` 与 `vp check`（448 个格式文件/291 个受检文件，零告警错误）通过；`pnpm run test:tags:browser` 已越过 React 首次导航、新建/编辑、取消删除及已绑定 Tag 删除保护，最终失败于「React 删除 Tag 后工程仍包含该定义」，退出码 1。Vue 端及后续专项未执行。该日志只说明最终导出仍含 Tag，不能单独证明 Core 删除功能有缺陷。
- **源码分析（候选根因）**：浏览器函数 `clickTagRowActionInPage` 在连续三次 Dialog 确认/取消之间从整个文档选取首个带 `t-dialog__confirm`/`t-dialog__cancel` 的可见按钮；固定版本 `tdesign-react@1.18.6` 的插件 `destroy` 经 `requestAnimationFrame` 调用，Dialog 具有约 300ms 退出动画。前次弹窗残留节点可能被再次命中，导致脚本没有确认新一轮删除。当前无 Chromium DOM 快照，故仅属与源码及症状一致的竞态推断，不视为实证根因。
- **最小修复候选**：点击业务按钮前记录已有 `.t-dialog` 节点，只在本次新增的弹窗内定位确认/取消按钮；保持原 12 秒弹窗门槛、真实点击和旧弹窗拒绝。最终删除先等待现有成功提示「项目 Tag 已删除，可撤销」，再导出实际工程 JSON 校验 Tag 不存在；已绑定 Tag 必须拒绝删除，取消必须保留定义，原有断言不变。仅修改 `scripts/test-studio-browser.mjs`，不动 React/Vue UI、Core Tag 规则、持久化、权限或工业边界。
- **防复发与验证边界**：连续使用插件式 Dialog 的浏览器验收应按弹窗实例隔离定位，不以全局首个按钮或固定延时推断操作已经完成。协作容器仅对选择器模拟场景执行 Node 22 的 2/2 烟雾用例与语法检查；**未执行本仓库完整 `vp check`、Windows React/Vue Chromium `test:tags:browser` 或后续专项**。这些均须在最新 PR HEAD 复验。
- **证据**：维护者本轮 PowerShell 日志、PR #189 最新源码、`scripts/test-studio-browser.mjs`、`apps/web-react/src/studio/StudioDialog.tsx`、TDesign React 1.18.6 `dialog/plugin.tsx` 与 `Dialog.tsx`。

### E-115 · D5c0y 历史载入确认误点旧 Dialog 的回归风险（PR #189 合并后）

- **Windows 真实现象**：维护者在 PR #189 Squash 合并后的回归中运行 `pnpm run test:versions` 与 `pnpm run test:versions:safety`，均在「等待版本历史操作结果超时：已载入本地版本 #1」处退出 1；未提供新的完整 HEAD、真实 Dialog DOM 快照或历史库内容。同期 `test:interop` React→Vue→React→Vue 与非法 JSON 保护全部通过，普通 `test:browser` 四视口各 33/33 通过。
- **源码定位（待真实浏览器验证的根因候选）**：`studioVersionActionInPage` 连续点击「取消载入」与「确认载入」时，使用全局第一个 `.t-dialog .t-dialog__confirm`/`.t-dialog__cancel`。固定 TDesign 版本的 Dialog 销毁经过异步关闭动画，旧弹窗节点可能仍有布局，继而误点上一轮按钮。此路径与已修复的 E-114 Tag 删除竞态同类；不能凭超时本身推断真实编辑器、IndexedDB、CAS 或历史快照损坏。
- **候选修复与防复发**：点击历史载入前快照当前 `.t-dialog` 节点，只在本轮新生成的 Dialog 内定位真实确认/取消按钮；保持原 12 秒等待与成功提示、JSON 复原、自动保存暂停、取消不覆盖、草稿未被改写及存储失败恢复的全部断言。不修改 React/Vue 正式组件或 Core/Schema。
- **验收边界**：补丁在功能分支提交后仍需 Windows 最新 HEAD 的 `node --check`、`vp check`、`test:versions` 和 `test:versions:safety` 复验；没有运行实机前不能宣布 E-115 关闭。

### E-116 · D5c0y 文件草稿 Popup 退出动画期间切换触发器可能重新打开

- **Windows 真实现象**：PR #189 合并后 `pnpm run test:multitab` 通过 React BroadcastChannel 停写和无广播 IndexedDB CAS 阶段，进入后续草稿操作时抛「TDesign 文件草稿弹层关闭超时」，退出码 1；Vue 尚未执行。用户日志不包含关闭时 Popup 内部 visible 状态，不能将超时认定为草稿删除失败。
- **源码定位（候选）**：`studioDraftFileActionInPage` 完成操作后只要 `.studio-file-popover` 仍有布局矩形，就再次 `trigger.click()`。Dialog 确认可能已使 Popup 逻辑关闭，但 CSS 退出动画期间保留布局；此时点击触发器可能把 Popup 重新打开。TDesign React 1.18.6 与 Vue Next 1.20.11 固定源码均监听文档 `mousedown` 进行外部关闭。
- **候选修复与防复发**：改为向文档外部区域发送 `mousedown`，无论 Popup 正在关闭或仍展开均只请求关闭，不使用切换开关；继续在 `finally` 只执行清理、在正常控制流等待实际 DOM 收起，保留 5 秒超时，不吞没真实操作异常。同时为连续草稿确认按钮复用 E-114 的新 Dialog 实例定位，原 CAS、墓碑、恢复保存和故障注入断言不变。
- **验收边界**：仅核验固定版本源码，仍需 Windows `test:multitab` React/Vue 全阶段及相关旧草稿与历史专项；不应把候选路径说成已实测根因。工业设备与生产数据未涉及。

> **2026-11-23 · PR #190 Windows 复验关闭 E-115 / E-116 阻塞**：维护者在修复候选后的真实 Windows 浏览器依次通过 `node --check`、`vp check`（448 格式文件 / 291 受检零警告错误）、`messages:check`（318 文件）、`docs:check`（94 Markdown）、双端 `test:versions`、双端 `test:versions:safety`（含 Origin 隔离）、双端 `test:multitab`（各 4 阶段）、双端 `test:legacy:browser`（各 3 条路径）及普通 Studio 四视口 132/132。原超时路径在本轮未复现，回归阻塞解除；未记录 Dialog/Popup 内部逐帧 DOM，因此不将候选竞态机理上升为已实证的唯一根因。PR #190 经明确授权 Squash 合并至 `main@493a793614dbbe21c7d97a3c6400442de9d88bff`；本轮日志未打印本地完整 HEAD，证据边界保留。

### 2026-11-23 · D5c1 跨页面重设计预防性检查（非新错误编号）

- **已完成验收的旧阻塞**：维护者在 PR #190 最新候选真实 Windows 回归中已通过 React/Vue 本地历史、历史安全、多标签页四阶段、旧草稿三路径、普通 Studio 132/132；PR #191 在 HEAD `031f496d68782bbd0beacea87cca171d588dbe9b` 上真实通过双端 Tag 128 字符窄屏和 CDP Tab 焦点、新增/编辑/绑定删除保护/确认删除、四视口 Studio 以及 JSON 互通，已依授权合并至 `main@66c14fd067dea7c20cf69a085ab004a83d307081`。E-114/E-115/E-116 原超时阻塞在相应场景未复现；没有逐帧 DOM 证据能唯一证明此前候选根因。
- **当前预防性要求**：重新设计页面时，不可将上批固定深色主题静态测试视为新方案必须延续的视觉契约；修改 `@adui/theme`、TDesign `theme-mode`、React/Vue 壳层和共享 CSS 时必须**同步更新**静态主题门禁与真实双端 12 场景 UI 测试；保留 252/320 侧栏、16:9 SVG、TDesign Dialog 旧节点隔离、CAS、只读发布权限与模拟状态。旧的视觉截图/旧 CSS 检查不证明新 UI 可读可用。
- **不假装完成**：D5c1 设计与测试目前只是功能分支候选，完整 `ready`、React/Vue 浏览器与真实视觉截图尚未运行；不得写成已通过、不得跳过用户最终一次性验收，更不能仅用 CSS 静态检查替代工业安全验收。

### E-117 · 将复杂 Tag 编辑常驻在 320px 属性栏导致 UX 结构性失败（D5c1）

- 真实证据：维护者上传截图，显示 3 条 Tag 定义及其描述、重复编辑/删除操作和全部五字段表单在单一狭窄侧栏串联，主次操作没有明显任务区分，字段与提交距离过远。原浏览器 CRUD 通过不能证明设计合理。
- 根因：旧组件把资源目录、列表操作、全量表单及危险确认混为同一面板，后续主题换色与等高按钮仅是视觉表面修复。
- 修复候选：React/Vue 均采用可搜索的精简目录 + 独立 TDesign Dialog，双列必填/选填、字段错误就近反馈、编辑 ID 锁定与底部保存/取消；保留共享 Core CRUD、图元绑定拒绝、历史 JSON 与受控工业读写边界。FUXA 仅为信息架构参考，不复制其设备连接或源码。
- 防复发：真实 Chromium 必须检查侧栏无常驻表单、弹窗宽度/双列与字段错误、目录检索、键盘、窄屏、取消确认、绑定删除拒绝和工程 JSON。PR #192 尚未运行 Windows ready 或浏览器，只有最终统一验收与实际截图审阅后才能关闭 E-117。

### D5c1 · 防止将“默认画板大小”误解为修改全部历史工程（预防项，非已发生错误）

- 新画布默认 1920×1080 只适用于全新的 Studio 初始演示页面，不是 Schema 尺寸白名单。历史 JSON、草稿、快照、旧水处理只读示例及正式发布页面均可能保持 880×460 或其他合法尺寸。
- 原 `createPage` 明确继承**当前页面尺寸**；不能为了强制 1920×1080 而重构该命令或自动迁移用户工程。
- 由于原演示 880×460 图元定位是业务测试基线，新 Studio 使用共享 Core 派生的新默认文档，统一缩放与居中示例图元，不修改原示例、旧版解析器或图元几何语义；跨 Vue/React 必须复用同一实例定义。
- 强制覆盖核心单测的 1920×1080、16:9、图元一致比例、旧工程原尺寸；真实浏览器校验两个框架与两个视口。PR #192 完整 Windows / Chromium 验证未执行，不能提前声称全部通过。

### E-118 · Figma 式画板只改外层底色时内部 SVG 仍绘制深色背景（D5c1）

- **预防性源码检查**：共享 `renderSvgPage` 默认会在 SVG 内嵌一个深色全页矩形；如果仅把 Studio 外部 SVG 或舞台 CSS 改成白色，图片数据层仍完整覆盖白色底板，用户看到的仍是深色演示画面。当前是根据源码和维护者 Figma 参考发现的设计不一致风险，尚无新分支真实 Chromium 画面佐证。
- **候选修复**：为 Core SVG 渲染增加显式 `appearance="light"` 选项，默认 `dark` 严格向后兼容，Studio 的 `svgDataUrl` 显式传入 light；图元文字、设备背景随选项适配，但 Tag 质量和数据不变。工程 JSON、已发布只读 Runtime、工业网关和默认模拟监控不变。
- **进一步防复发**：页面/图层应进入左侧导航，创建按钮应位于底部可达的独立工具组；不得因为移动按钮而丢失真实点击能力。React/Vue、新默认1920×1080、视口 48px 留白、首页/运行模式切换及 SSE 资源清理须覆盖对应的真实浏览器/单元测试。
- **验证边界**：目前只有 Github 提交和源码比对，`vp check`、`ready`、Chromium 16 场景与截图未执行；不得把预防性候选写成已实测修复。

### E-119 · 适应画板留白引入同作用域重复变量声明（PR #192）

- **源码证据**：`studio-viewport-rect.ts` 中用于留白的 `const width` / `const height` 与之后计算 SVG 世界视区的同名常量在同一函数作用域重复声明，阻止 TypeScript 正常解析。
- **最小修复**：将扣除留白的 CSS 像素变量命名为 `availableWidth` / `availableHeight`，世界坐标计算及平移约束不变。
- **防复发**：视口像素、逻辑页面尺寸与世界坐标采用不同语义变量名；最终执行 `vp check` 和 `studio-viewport-rect.test.ts`，不能以 GitHub 文件提交替代编译验收。
- **验证边界**：当前根据源码确认重复声明并提供修复候选，Windows 完整门禁仍待执行。

### E-120 · React Tag 编辑表单条件 JSX 缺少闭合花括号（PR #192）

- **Windows 真实现象**：维护者拉取 HEAD `eadc44fdc8b76e41fe16e37068dc9fcb4679c65b` 后运行 `vp check --fix`，在 `apps/web-react/src/studio/TagManager.tsx:298` 报 Expected `}` but found Identifier，格式化中止，尚未进入后续 Lint/类型检查。
- **确定根因及最小修复**：第 290–297 行全局表单错误条件渲染以 `{formError && ... && (` 开始，却只以 `)` 结束，缺少闭合 `}`；补为 `)}`。Vue 对应的 `v-if` 块无此缺口，保持不变。Tag 验证、提交、取消、删除保护及共享 Core 不变。
- **局部实测**：协作容器 Node.js 22.16.0、TypeScript 5.8.3 使用 `createSourceFile` 的 TSX 模式解析从仓库取出的错误区域（外包最小函数和表单）：原片段复现 `'}' expected` 等 5 条语法诊断，修正后 0 条。不是完整文件或项目类型检查，不代表 Windows 格式化、构建和浏览器通过。
- **防复发**：修改 JSX 条件渲染必须核对括号与花括号配对；涉及双端大批修改时，先运行实际语法/格式检查再声称开发候选完成。不能用标签计数替代 TSX 解析；未取得完整工具链时须标注验证范围。
- **待验收**：Windows 最新 HEAD 的 `vp check --fix`、`vp check`、`typecheck:web` 与最终统一回归。当前不得宣称 E-120 已通过项目实测。

### E-121 · Studio 浏览器脚本三项 Lint 警告（PR #192，E-070 同类复发）

- **Windows 实测**：维护者在 E-120 修复后执行 `vp check --fix`，格式化完成，292 个受检文件零错误、3 条警告。分别为未使用的 `inspectScadaUIInPage(view)` 参数、百分比后缀正则以及范围输入原生 setter 的独立引用（`unbound-method`）。完整质量门禁尚未通过。
- **最小修复**：移除未使用参数及 CDP 序列化调用实参；用 `endsWith("%")` 替换后缀正则；复用 E-070 已验证的 `Reflect.set` 原生 receiver 模式，保留 setter 存在性检查，并在设置失败时拒绝继续，保留冒泡 `input`、`change` 事件。仅修改浏览器脚本，不调整业务断言或正式 UI。
- **验证**：从候选脚本提取实际修改后的函数执行独立 JavaScript 模拟，原生 receiver、自有 setter 旁路、两个事件及缺失 setter 拒绝均符合预期；百分比断言 5 个边界场景通过。未运行 Windows Vite+ 或真实 Chromium，需复验。
- **防复发**：新增浏览器受控输入时优先复用 E-070 的原生 setter 模式；删除不再使用的 CDP 参数需同步调用端，简单字符串后缀采用标准方法。不得禁用 Lint 规则。

### E-122 · Studio 顶部工具栏裁剪 TDesign Popup（PR #192，待实机复验）

- 现象：维护者截图报告文件与草稿、版本历史、发布预检、工程管理、服务端工程菜单点击无效果。
- 源码原因候选：五个 Popup 附着于工具栏内的菜单容器，而工具栏横向自动滚动、纵向隐藏。布局矩形存在不能证明弹层在屏幕上可见。另工程管理自身收到授权拒绝时已清空目录，父组件仍因授权修订号变更立即卸载菜单，错误可能无法展示。
- 最小修复：工具栏改自动换行和可见溢出，保留官方 Popup；工程目录自身拒绝时只跳过目录自身重建，服务端会话、CAS、历史摘要、预检失效保持清理，其他授权失效仍重建目录。
- 防复发：真实浏览器以 elementFromPoint 检查浮层是否实际命中，覆盖五项菜单及外部关闭，不以 DOM 存在或截图代替可交互性；React/Vue 的真实权限和版本安全测试保持不变。
- 验收：候选源码与浏览器断言尚需 Windows 最新 HEAD 复验，不能将静态定位视为实际双端通过。

### E-123 · Studio 共享样式迁移后配置检查仍读取旧文件（PR #192）

- **Windows 实测**：HEAD `6c756a48cd0a268e545f3282438e8f0cc5cfba12`，pnpm 12.18.0 的依赖安装及冻结锁文件安装成功，13 个清单、54 项 Catalog 检查通过；`ready` 在 `scripts/check-shared-config.mjs:246` 读取已删除的 React Studio CSS 时发生 ENOENT，退出码 1。
- **确定根因**：两份本地 Studio CSS 已合并为 `packages/tailwind/src/studio.css`，但末段中央画布滚动条槽位检查仍逐端读取旧路径，固定侧栏宽度断言也遗留旧设计。
- **修复候选**：检查共享 CSS 的画布槽位，显式拒绝恢复两份重复文件，验证实际生效的可调整侧栏与视口上限；保留共享导出、双端导入、区域、画板尺寸和视区计算断言。
- **防复发**：移动或删除公共资源时同步审查所有配置校验及测试的读文件路径，不以保留空壳文件掩盖迁移错误。完整 `config:check` 与 `ready` 待最新 HEAD Windows 复验。

### E-124 · 运行监控选中导航文字对比度验收失败（PR #192）

- **Windows 实测**：同一 HEAD 的 `test:ui:browser` 通过 React 1440×900 浅色工作台，随后在浅色运行监控的当前导航文字对比度断言失败，退出码 1；其余场景未执行。
- **源码定位**：明暗最终选中色 Token 的静态对比度分别约为 5.80:1 与 5.61:1，均高于 4.5:1。原导航存在颜色和透明背景过渡、历史工作台专用选中色规则；浏览器日志未提供计算颜色，尚不能确定具体失败是过渡中间态还是组件样式层叠。
- **修复候选**：移除重复历史选中色规则，统一四工作区选中态的成对前景/不透明背景并取消导航颜色渐变；浏览器读取实际文字节点的颜色并在失败时打印色值与对比度，不放宽 4.5:1 门槛、不跳过场景。
- **验收**：Token 数值计算不代表实际 Chromium 通过；须复验双端、两视口、两主题、四工作区共 32 场景。保留原用户锁文件，不涉及数据库或设备写入。

### E-125 · 文件草稿单层文本菜单尺寸回归失败（PR #192）

- **Windows 实测**：HEAD `3729db9a4966bfc07216a5d2f3ed65516b85fe84`，普通 Studio 浏览器 React/Vue 两端两视口各 77/78，仅「文件草稿为单层浮层且五项操作统一使用文本菜单」失败，合计 308/312。其他浮层可见、导入包裹层和关闭断言已通过。原日志未分离数量、类名、对齐及高度，不能确定唯一根因。
- **候选修复**：已核对固定 React 1.18.6、Vue Next 1.20.11 Button 官方类名及共同样式；保留五项 TDesign Text Button 与危险操作语义，集中共享 CSS 的宽度、边框盒 28px 高度、左对齐和尺寸稳定性，Upload 触发容器满宽。取消菜单按钮尺寸相关过渡，不修改 Popup 的业务行为。
- **防复发**：失败时输出单层判断、按钮数及逐项非敏感计算样式，仍要求五项文本按钮、左对齐、精确 28px CSS 高度及实际边框盒高度；仅容许 0.5px 浏览器几何精度偏差，不放宽逻辑尺寸或业务断言。
- **验收**：最新 HEAD 的 Vite+ 与真实四视口浏览器待复验，后续 Tag、互通、版本安全及 SSE 专项尚未执行；不合并未通过的 PR。

#### E-125 · 2026-11-24 实机诊断补充

- **确认证据**：维护者在 HEAD `66ed77bf29063b4364560546f9ea36d3a1db78dd` 复验，Vite+ 456 个格式文件、298 个受检文件零警告错误，95 个 Markdown 通过；普通 Studio 四视口仍各 77/78。新增诊断表明四视口共 20 个菜单按钮的单层、数量、文本变体、border-box、计算高度/最小/最大高度及渲染高度全部符合要求，唯一不符为浏览器返回 `justifyContent = "flow-start"`，原断言只接受 `flex-start`。
- **最小修复**：仅修改浏览器测试，接受起始对齐的序列化值 `flex-start`、`flow-start`、`start`，同时要求横排 LTR、实际可见文本左边界与按钮边框及内边距之和相符（1 CSS px 几何容差）。使用 DOM Range 测量实际非空文本节点而非可能满宽的组件包装层；保留五项、单层、28px 全部尺寸与诊断，不接受居中或末端对齐。不修改正式 UI 或锁文件。
- **防复发**：跨浏览器的 CSS 计算值不宜只做单一字符串比较；语义等价值必须辅以实际布局测量，且失败时保留完整诊断。最新补丁仍须 Windows 四视口实测后才能关闭 E-125。

> **2026-11-24 · E-125 Windows 复验关闭**：维护者在 HEAD `c31c86ef1bf25e51987251fe277bade1de38c027` 实际通过浏览器脚本语法、Vite+（456 格式文件、298 受检零警告错误）、95 份 Markdown 及 React/Vue 两视口各 78/78，合计 312/312。起始对齐计算值和实际文本位置修复验证通过。后续 Tag 专项遇到独立的 E-126 阻塞，不代表所有回归已通过。

### E-126 · Tag 编辑弹窗入场期间测量宽度失败（PR #192）

- **Windows 实测**：同一 HEAD 普通 Studio 312/312 通过，随后 `test:tags:browser` 在 React 报「Tag 编辑弹窗宽度不足」，退出码 1；Vue 和后续专项未执行。日志没有实际宽度、动画状态及计算样式，尚不能唯一确认实机根因。
- **源码定位**：React/Vue TagManager 都设置 `min(700px, calc(100vw - 32px))`，固定版本官方 Dialog 的宽度转换均保留该 CSS 字符串。官方共同样式 `tDialogZoomIn` 从 scale(.01) 开始，组件入场时长约 300ms；测试只等表单拥有布局矩形即读取 `getBoundingClientRect().width`，可能测得动画中间尺寸。这是有源码依据的候选原因，并非已经实测的唯一根因。
- **最小修复**：仅在测试测量函数中等待 Dialog 动画不再运行、可见且不透明、实际边界宽度与布局宽度相符，以及连续两次稳定采样；仍使用最终实际边界矩形断言至少 600px，不以通过宽度门槛作为等待条件。保留双列、五字段、操作主次、CRUD、删除保护与 JSON 断言。超时或宽度不足时输出实际宽度、布局宽度、CSS 计算宽度、变换、不透明度及动画状态，不输出业务正文。
- **防复发与验收**：测量具有入场动画的组件时，DOM 存在不代表最终视觉几何稳定；不得缩小验收阈值或为测试关闭正式动效。最新补丁的语法、Vite+ 和真实双端 Tag 浏览器仍须复验，正式 UI 与依赖不变。

### E-127 · Vue Tag Dialog 初始隐藏内容仍挂载在目录内（PR #192）

- **Windows 实测**：维护者在 HEAD `bd9e699d95890a5a06ec0d10d4ccc5e09e476ab6` 通过脚本语法、Vite+（456 格式文件、298 受检零警告错误）、95 份 Markdown；React Tag 专项完整通过，E-126 的 React 宽度阻塞解除。Vue 在首次目录检查时仅 `noSidebarForm: false` 失败，行操作 flex、两个按钮及紧凑尺寸均符合要求，后续八项专项未执行。
- **源码定位**：固定版 TDesign Vue Next 1.20.11 的 `dialog.tsx` 初始化 `cardVisible = !props.lazy || props.visible`，首次 `shouldRender` 返回 `!lazy`，Teleport 在无有效挂载目标时禁用；仅设置 destroyOnClose 不能阻止首次隐藏表单渲染。原 Vue TagManager 未指定 attach 和 lazy。这解释 DOM 断言失败的候选机制，不证明用户看见常驻表单。
- **最小修复**：Vue TagManager 显式使用官方 `attach="body"` 与 `lazy`，保留关闭销毁、Esc、遮罩保护、700px 配置、原 CRUD 与共享 Core。浏览器保留目录无表单断言；成功新建和编辑后等待旧表单实际销毁，编辑时也检查弹窗脱离侧栏及稳定宽度，避免关闭动画与再次打开竞争。
- **防复发与验收**：跨框架 Dialog 须分别核对固定版本的挂载、初次渲染及关闭销毁语义，不能将隐藏 DOM 当成可见布局，也不能通过放宽断言掩盖实际挂载错误。Vue 真实浏览器与最新 HEAD Vite+、文档和剩余专项待复验；不提前关闭 E-126/E-127 或合并。

> **2026-11-24 · E-126/E-127 Windows 复验关闭**：维护者在 Windows HEAD `a5ff6a855e79d8b6d8a4306545c138ec752f96b8` 实测脚本语法、Vite+ 456/298 零警告错误、95 份 Markdown、双端 Tag 全流程、双框架 JSON 互通、历史版本及安全、多标签页各四阶段、历史迁移各三路径、发布预检双端全部通过。E-126/E-127 原验收阻塞已解除。

### E-128 · SSE 浏览器专项遗留 HTTP 地址与正式路由（PR #192）

- **Windows 实测**：同一 HEAD 七项浏览器专项通过后，普通 SSE 在 React 首页预检使用 http://127.0.0.1:15173/，fetch failed（other side closed），退出码 1；维护者 JetBrains 截图明确 React 15173、Vue 15174 均已启动 HTTPS。故障专项尚未运行。
- **确定根因**：两项 SSE 命令共用 test-runtime-sse-browser.mjs，开发地址仍硬编码 HTTP，未复用 E-049 已实现的本机 HTTPS 开关和目标解析。另静态发现 Hash 路由切换后仍比较旧首页 URL；原故障代理只接受 HTTP，不可直接转发 TLS 密文。这两项是源码预防性修复，不是已实测后续失败。
- **修复候选**：普通和故障浏览器复用 resolveStudioBrowserTargets；预检 HTTPS 显式严格校验证书和配置 CA，读取首页与模拟工程响应，保留内容类型和 Schema 校验。真实导航后按完整 URL 的 #/runtime 路由检查。故障代理继续限定 127.0.0.1，HTTPS 使用已有本机联调证书建立两段 TLS/HTTP1.1 连接，在代理内部识别 SSE 请求并阻断真实解密下行字节，保留旧 socket、STALE、重建及回收断言；Docker HTTP 不变。不关闭证书校验、不提交证书或私钥，不用于认证或生产流量。
- **防复发**：所有本机浏览器入口需统一协议解析、保留真实路由和目标检查；故障注入必须明确 TLS 边界，不能对 TLS 密文使用 HTTP 请求行匹配，不以忽略证书或协议降级绕过测试。Windows 新 HEAD 的代理单测、配置单测及两个真实 SSE 专项待复验，不提前关闭 E-128。

> **2026-11-24 · E-128 Windows 复验关闭**：维护者 Windows 最终日志：两份 SSE 脚本语法检查、Vite+（456 格式文件、298 受检零警告错误）、95 Markdown、协议配置 6/6、代理单测 5/5 均通过；React/Vue HTTPS 15173/15174 的普通 SSE 心跳、Tag 过期、静默重连、资源清理及真实下行阻断、STALE、主动重连、连接回收均通过，九项功能专项累计完成。最终日志未单独打印本地 SHA；GitHub 核对候选 HEAD ae249f55d372fc3babb2aec8011fdca45c62f99e 相对 85f30ff7 仅有条件语句格式化，无语义改动。维护者明确同意合并。 原 HTTP/HTTPS 协议阻塞解除；本机两段 TLS 代理实际通过，不代表生产工业通信或认证流量故障注入验收。

### E-129 · 历史缓冲区稀疏数组测试触发 no-new-array（PR #194）

- **Windows 实测**：维护者运行 `vp check --fix`，301 个受检文件零错误、1 项 `unicorn(no-new-array)` 警告，位于 `packages/core/test/tag-history-buffer.test.ts` 的 `new Array<TagValue>(2)`；格式化已完成。日志未单独打印本地 HEAD，当前远端候选仍存在该写法，尚未提供本轮 25 项测试结果。
- **根因与候选修复**：单参数 Array 构造器违反项目 Lint 规则。普通 `Array.from({ length: 2 })` 会创建含显式 undefined 的稠密数组，不能等价覆盖稀疏数组空位。改为数组字面量包含首个采样，再扩展 length 至 2；增加长度及 `Object.hasOwn(values, 1) === false` 断言，仍要求拒绝整批、已有历史不变。
- **防复发**：构造稀疏数组测试须同时符合 Lint 和真正空位语义，不禁用规则，不把空位替换为普通 undefined，不放宽原子性断言。不修改生产代码；最新 HEAD 的 Windows Vite+、25 项定向测试、中文文案和文档检查待复验。

> **2026-11-24 · E-129 Windows 复验关闭**：维护者 Windows 实测：Vite+ 459 文件格式正确、301 个受检文件零警告和错误；历史缓冲区 11/11、历史查询 8/8、TagStore 6/6，共 25/25；中文文案 328 文件及 Markdown 95 份全部通过。日志未独立打印本地 SHA；GitHub 最终候选 54b116e64a96acad12d0af75bbe9c23898c9b4f7 相对 069c63b9 仅三份 TypeScript 文件格式化，无业务或测试语义变化。维护者明确授权合并。 稀疏数组空位和批次原子性用例已通过，原 Lint 阻塞解除。

### E-130 · 历史归档不可变性测试遗漏异常断言约束（PR #196，E-003 同类复发）

- **Windows 实测**：Vite+ 461 文件格式正确，303 个受检文件零错误、1 项 `vitest(require-to-throw-message)` 警告，位于归档测试的无参数 `toThrow()`；46 项正式定向测试结果尚未提供。
- **根因与修复候选**：原测试以 Object.assign 修改冻结记录并使用无参数异常断言，违反 E-003。改为 `expect(Reflect.set(batch.records[0], "value", 300)).toBe(false)`，直接验证写入被拒绝，无需匹配不同引擎的原生 TypeError 文案。保留批次、数组、记录冻结及原始值、缓冲记录不变断言，不修改生产代码。
- **验证与防复发**：Node.js 22.16.0 独立实验确认冻结对象的 Reflect.set 返回 false、原值不变、Object.assign 抛出 TypeError；并非完整仓库测试。编写异常断言前核对 E-003，原生不可写属性可使用 Reflect.set 的布尔结果验证，禁止禁用规则或删除行为断言。Windows 最新候选零警告检查、46 项定向测试、中文文案及文档待复验。

> **2026-11-24 · E-130 Windows 复验关闭**：维护者 Windows 实测 D5c5：Vite+ 461 文件格式正确、303 个受检文件零警告和错误；归档 8/8、采样 13/13、历史缓冲区 11/11、历史查询 8/8、TagStore 6/6，共 46/46；中文文案 330 文件及 Markdown 95 份全部通过。日志未独立打印本地 SHA，当前远端候选为 73a06349e114a73465dd6551723820eb02cd589b。维护者明确授权合并。定向测试不代表完整 ready、生产采集、真实数据库持久化或现场工业安全验收。 冻结对象拒绝写入及数据不变断言通过，原 Lint 阻塞解除。

### E-131 · React 运行页替换时保留旧 Effect 尾部和重复变量（PR #198，待 Windows 复验）

- **Windows 实测**：维护者执行 `vp check --fix`，格式化在 `apps/web-react/src/runtime/RuntimePage.tsx:123:4` 报 Unexpected token 并中止。日志未打印本地 HEAD，远端文件 Blob d2a50e98e4d0277990dacbbc87e6025deba83811 确有同一残留。
- **根因**：扩展 RuntimeMonitor 时使用首次匹配的 return 作为旧组件替换边界，误匹配 Effect 的清理回调，遗留旧回调结束语句与同作用域第二个 svg 声明。与 E-013、E-055、E-119、E-120 同类，独立核心逻辑检查不能代替最终 TSX 解析。
- **最小修复**：删除旧回调及重复 svg 声明所在的五行（含分隔空行），保留当前 Effect 的清理函数、project 依赖及含 pageId 的 SVG 渲染。Vue、共享模拟源、历史事务和工业安全门禁不变。
- **实际复验**：协作容器 Node.js 22.16.0 / TypeScript 5.8.3 对完整修复前文件（git hash-object 与原 GitHub Blob 一致）以 ScriptKind.TSX 解析，得到 3 条语法诊断，其中 123:4 与维护者报错位置一致；修复后完整文件为 0 条。修复 Blob 5ce8ad1f52d20b72a3d0c7ce5f7d8ca845e148fb 与 GitHub 回读一致。正式 TypeScript 6、Vite+、Lint、类型检查及浏览器仍待 Windows 实测。
- **防复发**：组件重构不得以首个通用 return 字符串确定替换边界；必须使用唯一的结构化定位、检查完整差异、解析每个变更 TSX 文件，并对提交后 Blob 回读校验。无真实项目工具链时明确记录局部验证范围，不能用独立 Core 测试结果替代页面解析。

> **2026-11-24 · E-131 语法阻塞复验通过**：维护者后续 Windows 日志显示 Prisma Schema、Client 生成、Core 编译完成，`vp check --fix` 格式化完成，`vp check` 469 个文件格式正确、311 个受检文件零警告、Lint 或类型错误。原 TSX 解析阻塞不再出现。独立 Web 类型检查另报 E-133，不能据此认定完整质量链通过；维护者日志未打印 HEAD。

### E-132 · PR #198 验收顺序未先刷新生成产物（E-054 同类复发，已关闭）

- **现象**：维护者先运行 `vp check --fix`，出现 25 个类型错误、零警告；服务端无法识别 Core 历史导出和新 Prisma 模型，随之出现隐式 any。重新拉取源码后直接检查仍报相同错误。
- **根因**：验收指令把 Vite+ 类型检查放在 Prisma Client 生成与 Core Node 构建之前。Core 的 Node 条件导出读取 dist 声明，Prisma Client 亦由本地生成，Git 拉取不会同步这些产物。不是源码缺少相关导出。
- **修复和实际复验**：维护者依次执行 db:validate、db:generate、build:core、vp check --fix 和 vp check；Prisma 7.10.1 成功生成，Core 编译成功，469 个格式文件、311 个受检文件零警告错误，原 25 项错误消失。未执行数据库迁移，不新增依赖，不以 any 或重复导出掩盖错误。
- **防复发**：凡涉及 Core 公共导出或 Prisma Schema，给出验收指令时先校验 Schema、生成 Client、构建 Core，再做 Vite+ 与双端独立类型检查。保留现有 ready 的产物准备顺序。

### E-133 · 共享历史类的构造函数参数属性违反前端 erasableSyntaxOnly（E-006 同类复发，待 Windows 复验）

- **Windows 实测**：修复生成产物顺序后，Prisma 校验/生成、Core 编译与 Vite+ 均通过，`pnpm run typecheck:web` 在 React 的 tsc --build 阶段报四项 TS1294。TagHistoryArchiveWriter 的 buffer/storage 以及 TagHistorySampler 的 buffer/tagId 使用 private readonly 参数属性。Web 后续检查及文案、文档尚未执行。
- **根因**：共享 Core 使用 NodeNext 构建配置，未启用 erasableSyntaxOnly；浏览器共享 TSConfig 启用该限制，React/Vue 直接消费 Core 源码。因此 Core 编译成功和根 Vite+ 检查通过不足以证明前端独立类型检查通过。
- **最小修复**：两个类分别改为显式 private readonly 字段与构造函数赋值，保留参数顺序、类型、初始化和校验顺序、采样判定、归档幂等与回执语义。后端专用类、TSConfig、依赖、数据库 Schema 和迁移不变。
- **实际局部复验**：Node.js 22.16.0、TypeScript 5.8.3 对修复前后 GitHub 构造函数摘录（其余依赖为最小类型声明）使用 strict、ES2023、Bundler 与 erasableSyntaxOnly 执行 tsc --noEmit，修复前复现 4 项 TS1294、退出码 2；修复后 0 项、退出码 0。Node 原生类型擦除实际验证字段绑定、非法采样配置拒绝、工程范围冻结及重复归档写入者拒绝。不是完整仓库编译或 Vitest；Windows TypeScript 6、双端类型检查、正式单测与 ready 仍待运行。
- **远端修复证据**：TagHistoryArchiveWriter 提交 b0c1d7f7fc4eccbe91d9c46431f34a3bd599290e，Blob b9ac92dd13a62611b2b3e3f346810dd3d1431738；TagHistorySampler 提交 1098b214e4d89fa98719ce017aca99765510dc37，Blob e0d7dbbe53cd40d5ebf2bba76aa763c6e914bddc。均回读与预期最小修改一致。
- **防复发**：所有供浏览器消费的共享包使用可擦除 TypeScript 语法，不采用参数属性简写，不为兼容修复而关闭严格配置；把独立 Web 类型检查与 Core 编译均视为必须通过的门禁。不能将仅面向 Node 的构建或根 Vite+ 通过视为全链完成。

### E-134 · Prisma Skills 重复生成进入工作区质量检查（PR #202，待 Windows 复验）

- **Windows 实测**：HEAD `81ac5185e6d8f990a65b0a5d0a2b365ed93ff688`，固定依赖安装、Skills 同步和两版 Prisma 生成成功。Skills 列表显示三项技能分别写入服务端四个 Agent 目录；`vp check --fix` 报 317 个错误、68 个警告（498 个受检文件），命令链退出码 1，后续 ready 未执行。
- **根因**：原根脚本使用 pnpm filter 将 CLI 运行目录切换到 apps/server，且未限制 agents；第三方脚本进入项目自有代码检查。已核对 CLI 8.0.0-rc.35 源码，Skills 以进程 cwd 为根，配置路径不改变 cwd。
- **最小修复**：统一从仓库根启动已安装的 Prisma 8 CLI，显式指向原服务端配置，限制 agents 为 agents 并保留 check；只允许同步、列表、离线生成，沿用根目录已有格式化/Lint 排除规则。旧的本机重复副本需备份移出且撤销对应新增路径暂存；共享配置检查拒绝残留。无依赖、锁文件、Schema、迁移或正式查询语义变更。
- **防复发与验证**：Node.js 22.16.0 使用模拟 CLI 的三项独立入口测试通过；须 Windows 真实 Skills 同步、列表、两版生成及完整 ready 复验。不得通过关闭第三方过期检查或修改其代码消除告警。

### E-135 · Prisma 8 公开客户端工厂泄漏传递依赖类型（PR #202，待 Windows 复验）

- **Windows 实测**：同一日志在 `prisma8-readonly-client.ts` 触发 TS2883，工厂推断返回类型无法脱离 pnpm 中 @prisma/orm-family-sql 的 NoCollectionClasses 命名。
- **根因与候选修复**：Prisma ORM PostgreSQL 8.0.0-rc.25 的 runtime 公开导出 `PostgresClient<TContract>`，默认集合泛型由库内部处理。将项目类型别名改为 `PostgresClient<Contract>` 并显式声明工厂返回值，保留同一强类型 Contract、连接池与关闭语义；不使用 any、传递依赖深层路径或关闭类型检查。
- **验证**：固定版本公开类型源码已核对，正式 TypeScript 6、Vite+、Vitest 与真实 PostgreSQL 只读对照尚待维护者复验。

### E-136 · Prisma 8 CLI 前置配置参数导致命令解析失败（PR #202，待 Windows 复验）

- **Windows 实测**：HEAD `5be430a6dec9d071fc1827ee8b47a4f7f6671977`；pnpm 12.23.0 冻结安装、原三项模拟 CLI 测试通过，但真实 `db:prisma8:skills` 报 `CLI.UNKNOWN_COMMAND`，将 `--config` 识别为命令，退出码 2；后续列表与配置检查未执行。
- **根因**：入口把共享配置选项放在命令路径之前，模拟 CLI 只回显参数，未验证真实解析语法。固定 Prisma CLI 8.0.0-rc.35 的上游 `packages/cli-engine/tests/config.test.ts`（`--config on the command line`）验证命令在前、配置选项在后；Skills 上游测试同样先传入命令路径。
- **最小修复**：保持根 cwd、显式服务端配置、无 Shell、固定命令白名单及退出码传递，仅调整子进程参数顺序为命令路径、`--config`、配置路径。模拟 CLI 现在拒绝错误命令顺序并返回 2，保留原有安全用例。
- **局部复验**：Node.js 22.16.0 使用加强后的三项模拟测试，原入口 2/3 通过（退出码 1），修复后 3/3 通过（退出码 0），两个脚本语法检查通过。脚本 Git Blob 分别为 `bb4fae533f364b2a982370ca6c34103810efa160`、`189da799cae43b3cc2cd3f7c208b197207fdbca3`。协作环境访问 npm Registry 发生 DNS EAI_AGAIN，无法执行固定版本真实 CLI。真实 Skills 列表、同步、契约生成及完整 ready 尚待复验。
- **防复发**：包装第三方 CLI 时核对已锁定版本的命令语法及官方测试；模拟必须拒绝实际不合法的参数顺序，不能只检查回显与自设预期一致。先执行真实无写入的 Skills 列表，再执行同步及离线生成，随后进行完整质量门禁。

> **2026-11-25 · E-136 Skills 命令解析复验通过**：维护者 Windows 在 HEAD `a141b5a58eba622fb89a6f09f1a23fc2640b79a0` 通过加强后的模拟入口测试 3/3、真实 Skills 列表、同步及再次列表。CLI 报告根目录 D:\Workspace\adui-studio\adui-scada、check enabled，两项当前包内技能均为 synced；原 UNKNOWN_COMMAND 阻塞已解除。后续 config:check 因本地旧副本保护而退出 1；契约生成入口、E-134 完整质量验收和 E-135 类型检查尚未复验。

### E-137 · 包内 Skills 孤立副本被 Git 跟踪且本地重复目录残留（PR #202）

- **Windows 实测**：同一 HEAD 同步成功后，CLI 删除根目录的 `prisma-composer-core-concepts`；Git 显示其 SKILL.md 被删除。共享配置检查在 `apps/server/.agents/skills/prisma-8` 正确拒绝本地旧副本，退出码 1；不能认定其他旧目录全部存在或已清理。
- **根因**：此前保留了已跟踪的 Composer 生成技能，但当前仓库根 CLI 只识别 Prisma ORM PostgreSQL 与 prisma 两个技能来源。官方同步按已安装来源、配置 Agent 和元数据识别孤立技能并清理；Git 快进不会清除未跟踪的旧工作区目录。远端完整 Git 树核实服务端四个 Agent 目录未被跟踪，旧 Composer 文件不属于 skills-lock.json 的索引。
- **最小修复**：从候选分支移除该单一孤立 Composer 文件，更新 Skills 索引说明和验证记录；不安装额外依赖，不改 pnpm 配置、锁文件或质量检查。维护者仅备份迁出本机已知旧 Prisma 目录，保留其他 Agent 配置及原有根 Skills。
- **防复发与验收**：包内生成 Skills 的实际列表以固定依赖在仓库根运行的 CLI 为准，不能因过去的安装日志而保留失效生成文件；先核实 Git 跟踪状态，再处理本地残留。同步后应无重复副本且不产生孤立 Composer 删除记录。完整 config:check、ready 和只读数据库专项尚待实测。

> **2026-11-25 · E-134/E-135/E-136/E-137 局部门禁复验**：维护者在 Windows HEAD `e281d595efec99724798b837a1dc646435e8bdff` 备份迁出 12 个旧 Prisma 技能目录，CLI 入口测试 3/3、根目录重复同步及列表、config:check 退出码 0，Git 当时干净。Prisma 7 Schema 校验、Client 7.10.1 生成、Prisma 8 Contract 生成和 Core Node 构建通过；vp check --fix 及 vp check 均无警告、Lint 或类型错误（482 格式文件、324 受检文件），原 TS2883 未再出现，未报告 Skills 过期。旧副本与 CLI 入口阻塞解除；独立服务端类型检查、完整 ready 和真实数据库仍需验收。

### E-138 · 模拟 CLI 的机器输出触发中文文案门禁（E-022 同类复发，PR #202）

- **Windows 实测**：同一 HEAD 执行 ready，在 deps:check、config:check、env:check 和 LF 检查通过后，messages:check 在 scripts/prisma8-cli.cases.mjs:28 报一处日志文案缺少中文，整体退出码 1；后续单测、HTTP E2E 和构建未执行。格式化后 Git 出现四份自有源码及 pnpm Skills 忽略文件差异；维护者随后提交 ff92a981，纳入根目录两项包内技能的 132 个文件并保留自有源码格式化。
- **根因**：测试把模拟子进程的 JSON 数据输出写成字符串形式的 console.log，单行扫描器同时识别 console 调用和字符串字面量，误判为面向用户的日志。此前局部入口测试未独立执行实际文案检查。
- **最小修复**：仅将该模拟进程改为 process.stdout.write 输出 JSON，并添加中文说明；保留 JSON.parse、命令参数、退出码断言及全部安全用例。检查器不变，不关闭中文门禁，不修改第三方技能或覆盖维护者格式化。
- **局部复验**：Node.js 22.16.0 最小目录中使用与 ff92a981 Git Blob 一致的真实文案检查器和两个入口脚本；修复前复现唯一报错（退出码 1），修复后局部文案检查 8 个文件通过（退出码 0），Node 语法检查及三项入口测试 3/3 通过。修复后测试脚本 Blob 为 10aed9bfe70cf8905d82cb23c98daf55d9704bcb。未运行全仓文案检查、Vite+、完整 ready 或真实 PostgreSQL。
- **防复发**：测试进程的机器协议数据使用标准输出直接写入，面向用户的日志继续中文化；修改脚本后先执行 messages:check 和对应专项测试，再运行完整 ready。不能将局部复现通过记录为全仓验收。

> **2026-11-25 · E-134 至 E-138 工程质量复验关闭**：维护者 Windows HEAD `06a38de6680308a1ed49644450b43e5256f69922` 全仓中文文案 351 文件通过，CLI 3/3，Prisma 双版本生成、Core、独立类型检查、Vite+ 482 格式及 324 受检零警告错误、979/979 单测、63/63 HTTP E2E、95 Markdown、全部构建、ready 退出码 0；真实根目录 Skills 同步已在此前 HEAD 复验。上述结案仅对应工程质量，不等于历史非空查询已验收。

### E-139 · 历史只读专项遗漏数据库迁移前置核验（PR #202）

- **Windows 实测**：完整 ready 已通过。首次真实只读专项在 URL 安全门禁失败，屏蔽输入原始密码并构造完整 URL 后工程真实查询 MATCHED，历史阶段失败。数据库只读预检确认第八项历史归档迁移未应用，两张历史表及索引不存在。维护者明确确认后，Prisma 7 migrate deploy 成功，8 项迁移状态最新；只读专项 2/2、退出码 0，但历史 EMPTY。
- **根因**：先前验收指引未先确认本机历史结构及迁移状态，通用历史阶段脱敏提示不能区分缺表与查询缺陷。另将完整连接串作为 Read-Host 提示会泄漏凭据且不构成默认值，输入格式不能凭遮蔽字符推断。
- **防复发与验证**：不修改既有只读门禁或泄露第三方异常；先只读检查迁移和实际表/索引，缺失时须经明确授权仅用现有 Prisma 7 增量迁移，禁止重置或 Prisma 8 签名。密码仅屏蔽输入并编码，不回显 URL。EMPTY 只表示空结果，非空对照另用明确授权的随机合成夹具，先检查隔离连接及历史结构，严格验证正向结果后按本次联合主键事务清理。维护者已实测前述迁移及只读空查询通过；新增非空专项的真实执行仍待 Windows 验收。

> **2026-11-25 · E-139 非空对照复验关闭**：维护者 Windows 在 b12727f7 拉取、格式化后通过 483/325 Vite+ 零警告错误、352 自有文案文件及 95 Markdown、真实只读 2/2 和非空三方 1/1（专用夹具清理通过）、979 单测、63 HTTP E2E、完整 ready 退出码 0；后续格式化提交 b87eb651 已核对为纯排版。PR #202 按授权合入集成分支 f649105a。非空读取验收缺口关闭，但不证明 Prisma 8 写入事务或生产数据库接管。后续新增写入专项必须保持严格隔离 URL、真实数据库边界、迁移前置核验、约束与失败脱敏，不自动重试、签名或修改生产仓储。

### E-140 · 迁移预检参数化测试异构数组触发对象展开告警（PR #210，E-003/E-051 同类复发）

- **Windows 实测**：507 个格式文件、348 个受检文件零错误、1 条 `typescript(no-misused-spread)` 警告，定位 `scripts/inspect-prisma8-migration-readiness.cases.mjs:323` 的 `...changes`；375 个中文文案文件、96 份 Markdown 通过。日志未提供本轮 HEAD、九项离线测试及真实数据库预检完整结果。
- **根因与修复**：异构二维数组的元素被推断为普通联合类型数组，解构的 changes 可能包含 RegExp。仅将五组参数改为具名对象 `{ changes, expected }`，保持原错误正则、拒绝断言、五次调用及回滚关闭顺序；九项测试定义全部保留，不调整生产逻辑或 Lint 规则。修复提交 `5cee243361a1ebfac7560b019b5e59a05db0fe0e` 已回读一致。
- **局部实测及防复发**：Node.js 22.16.0 独立参数与合并结果等价测试 5/5、独立示例语法检查通过；TypeScript 5.8.3 声明生成确认原数组元素包含 RegExp、修复后 changes 为对象且 expected 为 RegExp。异构参数化测试优先采用具名对象，避免未收窄的数组联合类型展开，不禁用规则。协作环境无 pnpm/vp 且 GitHub 域名解析失败，正式 Vite+ 零警告、九项离线测试和真实 PostgreSQL 只读预检仍待 Windows 复验；不得签名或迁移。

> **2026-11-25 · E-140 Windows 复验关闭**：维护者在 HEAD `06990a536c931884f4d593e51a336cb7f9843329` 实际通过 Contract emit、CLI 3/3、离线预检 9/9、Vite+ 507 个格式文件与 348 个受检文件零警告错误、375 个中文文案文件、96 份 Markdown，增量退出码 0；真实 PostgreSQL 只读预检退出码 0，目录指纹 `73079d85974ddc9cbabf59741f2a4a94dd7bfff3d70a23bab27a7283456e8c52`，标记不存在、UTC、REVIEW_REQUIRED、签名许可否。日志最后两份脚本有格式化差异；远端最终 HEAD `adc3d55f1b4adb59d55a15213c9315641a4e1bc9` 相对验收 HEAD 仅两份脚本格式调整，归一化空白/尾逗号、字符串常量与 SQL 模板核对未发现业务语义变化。维护者明确授权后 PR #210 Squash 合入 `24391af99df003f19dbcec5a46d891874df03be7`。E-140 关闭，不代表迁移接管完成。

### E-141 · 原生 CHECK 谓词中的美元符号被测试替换字符串解释（原生 Contract 候选，局部复验通过）

- **现象**：协作容器 Node.js 22.16.0 使用与远端 Blob 一致的原生候选评审脚本及初版测试，实际执行为 7/8，首项逐字保留谓词测试失败；预期字符串中的正则结尾美元符号紧接单引号，触发 String.replace 的特殊替换序列，实际生成器输出仍为原始谓词。
- **根因与修复**：测试用字符串作为 replace 的第二个参数，动态 SQL 中的美元替换元字符被解释。修复提交 `ba3a821909a431aa63a468741962bc2e471d6ad6` 改为返回文本的替换回调，保留精确断言，不修改生成器或放宽 SQL 约束。
- **复验与防复发**：Node 语法检查及实际八项离线测试 8/8；本地评审模块 Blob `ba3fc5678489e7a9f50ea9776791e2b1b7ac42f9`、修复后测试 Blob `30d43d57a0a23a27a2033695df33c590d51cae8b` 与远端一致。对任意 SQL/正则等动态内容使用替换回调，避免特殊替换序列；不得通过删除美元锚点或归一化谓词掩盖测试错误。固定 Prisma 8 CLI 真实生成和 Windows Vite+ 全仓回归仍待验收。

> **2026-11-25 · E-141 Windows 复验关闭**：维护者在 HEAD `6fbc054ad0627520c44cc7765a696f68723735d7` 实测原生评审 8/8，真实候选生成及三十六项 CHECK 物理 IR 评审退出码 0。另有独立 E-142 排序告警，不影响本条谓词修复的复验结论。

### E-142 · 原生候选表映射集合缺少显式排序比较器（PR #213，待 Windows 复验）

- **现象**：维护者 Windows 在上述 HEAD 实测 CLI 4/4、预检/对照 16/16、重放门禁 9/9、原生候选 8/8；Vite+ 515 个格式文件、356 个受检文件零错误但一条 `typescript(require-array-sort-compare)`，位于 `scripts/prisma8-native-contract-review.mjs:81` 的 `[...mapped].sort()`。增量退出码 0 不能替代零警告要求。
- **根因与修复**：新增物理表映射集合未显式限定元素类型及排序比较器，触发与 E-027 同类规则。使用 Set<string> 的 JSDoc 和按字符串 UTF-16 码元比较的显式比较器，保持原默认字符串排序及历史基线语义，不使用地区排序改变数字与下划线顺序；不改变 PSL 模板、CHECK、外键、比较范围、指纹或 Lint 配置。代码修复 `06f427fc44f8e9ff8abb6a8d8a2aacf34c41adce`，新增排序回归 `17cf375756e5cc6c05c6a437296d860362e52d38`。
- **实际验证**：协作容器 Node.js 22.16.0 对修复后提取的 materializeNativeContract 函数、依赖的比较辅助代码进行语法检查和四项局部实测（字典序与模板顺序、缺失及重复表拒绝、与原默认排序等价、CHECK 谓词逐字保留）4/4 通过；提取片段本地与远端 1624 个 UTF-8 字节及 FNV-1a 32 位校验值 f02ba9ae 一致。不是完整九项仓库测试或 Vite+ 复验，待维护者确认。新增测试后本专项应为 9 项；保留已生成候选证据，不重复迁移、签名或清理目录。

> **2026-11-25 · E-142 Windows 复验关闭**：维护者在 HEAD `8252e1fc058b8f517f46efa5d93b7c71a4393633` 实际通过原生候选九项测试 9/9、Vite+ 515 个格式文件及 356 个受检文件零警告错误。中文检查另有 E-143 阻塞，增量链退出码 1，文档检查未执行；排序规则修复已得到实测验证，不代表整个 PR 已验收。

### E-143 · 原生候选集合 JSDoc 缺少中文说明（PR #213，E-103 同类复发）

- **现象**：维护者 Windows 在上述 HEAD 实测九项原生候选测试全部通过，Vite+ 零警告错误，但 `scripts/prisma8-native-contract-review.mjs:62` 的单行 `@type {Set<string>}` 注释触发中文文案检查，发现一处待处理内容，退出码 1，后续 docs:check 未运行。
- **根因与最小修复**：E-142 新增 JSDoc 时遗漏同一行中文说明，重复触发 E-103；之前仅验证排序及局部逻辑，没有复验新增注释的文案门禁。修复提交 `a19457229be7c590850f329f8c0af36f3ef64a9e` 仅在类型标注后追加“已映射的物理表名称集合”，保留类型、排序比较器、所有九项测试、生成及安全逻辑，不修改扫描器或 Lint 配置。
- **实测与防复发**：Node.js 22.16.0 使用与远端 Git Blob `00127f6ba4d622de026246be6fc0eca011099d5d` 完全一致的原中文检查器，在独立七文件最小夹具复现一处错误（退出码 1），追加相同中文说明后退出码 0，Node 语法检查通过。远端目标完整源码按原扫描器的单行判定逻辑核对，修复前一处、修复后零处，回读确认仅一行注释变化。新增 JSDoc 后必须先检查中文文案，不能仅修 Lint；局部夹具不是全仓库检查。协作环境仍无 pnpm/vp，修复后正式 Windows 九项测试、Vite+、messages:check、docs:check 待复验。保留现有候选及双库，不执行重放、签名、迁移或清理。

> **2026-11-25 · E-143 Windows 复验关闭**：维护者实际通过原生候选 9/9、Vite+ 515/356 零警告错误、中文文案 383 文件、Markdown 96 份及增量退出码 0，工作区干净。PR #213 按授权 Squash 合入 `4bada62a85fd099eb7a24857f66e2b411eb6a2bf`，未解除原生候选运行时阻塞。

### E-144 · Prisma 8 离线规划模拟结构与固定 RC 的真实机器响应不一致（PR #219，待 Windows 复验）

- **现象**：维护者 Windows 在 PR #219 通过原离线 9/9、原生评审 9/9、运行时评审 6/6、Vite+ 527/368 零警告错误、395 个自有文件中文检查、96 份 Markdown、增量退出码 0 后，实际离线规划包装器报“离线规划包含未填充、非新增操作或缺少预览”，退出码 1。官方子进程已退出 0，独立目录保留完整迁移包。
- **根因**：模拟 CLI 使用无封装顶层结果并强制要求 pendingPlaceholders=false；固定 CLI 8.0.0-rc.35 实际输出 kind=result、commandId=migration.plan、envelope.ok=true、envelope.exitCode=0，结果在 envelope.result，成功结果没有 pendingPlaceholders。直接读取顶层字段的检查必然错误拒绝。上传原包确认 46 项新增操作、无 placeholder 调用、无诊断，完整目标 JSON 与原生 JSON 深度相等，仅序列化不同。
- **修复候选**：按真实封装严格校验，区分失败阶段；仅允许缺省或明确 false 的占位符状态，并继续检查迁移源码；严格对照操作摘要和 PostgreSQL 执行 SQL 预览、拒绝非新增/未知参数/已应用语句及非空扩展目录。新增固定只读复验入口，复用历史、候选、版本、声明和目录完整性门禁，不启动规划器，不改原件、不覆盖、不自动重试。保持完整快照比较及签名/部署拒绝。
- **局部验证**：协作容器 Node.js 22.16.0 基于修复前同逻辑本地源码的补丁实际执行 12/12 回归及语法检查；对维护者真实 ZIP 独立解包后直接执行修正后的核心检查器，46 项操作摘要/预览与 ops.json 逐项匹配、目标 JSON 深度相等、三项声明哈希匹配，十个文件复验前后 SHA-256 均不变。远端保持维护者已有格式并应用同一逻辑，尚未执行最新 HEAD 的 Windows Vite+、中文/文档及完整复验入口。
- **防复发**：第三方 RC 的机器接口应先从实际成功和失败产物提取结构，再建立回归夹具，不能把文档列举字段当作无封装顶层的严格必填结构；生成器的成功与包装门禁成功分开记录，检查失败应给出具体阶段。迁移包的内部一致不等于物理等价、迁移标识重算或可部署。实际生成 SQL 无任何 COMMENT ON，历史 119 个中文注释仍是独立阻塞，不得篡改官方 JSON 或运行迁移来掩盖。
- **证据**：维护者实际上传 prisma8-native-baseline-review-20261125-172955.zip，SHA-256 55c1cc0c899095cdcdee3be8bd4e197592706e08b593dda302fa382bbd5b2af2；PR #219、docs/VALIDATION.md、ADR-0072。

> **2026-11-25 · E-144 Windows 复验关闭**：维护者 Windows 实测 12/12 基线、9/9 原生、6/6 运行时、Vite+ 527 格式/368 受检零警告错误、中文文案 395、文档 96、真实已有候选复验 46 项，目标、原文及迁移标识与原包一致，退出码 0。日志未单独打印本机 HEAD；远端最终 `fbe2fc2e370ab3cca807311fbb134a40022f5e0e` 相对 `21fcc5472fc0a91a283d924186ba8161fb50fbc8` 仅两份文件排版。经维护者授权 PR #219 Squash 合入 `55688fe7e261bdade6f7f72cb80329d31b1d478b`，E-144 关闭。 仅关闭真实 CLI 封装及已有候选只读复验阻塞，不代表注释完整、迁移哈希重算、自发射、部署或正式接管。

### E-145 · Unicode 正则中的裸右花括号导致新增测试无法解析（局部已修复）

- **现象与根因**：协作容器 Node.js 22.16.0 首次运行新增注释自发射逻辑测试时，匹配 rawSql 导入结束花括号的正则使用 Unicode 标志却未转义右花括号，触发 SyntaxError，测试未开始。
- **最小修复与复验**：仅对正则中的右花括号进行转义，保留匹配目标及原有断言；修复后核心、测试语法检查及八项离线测试 8/8 通过。修复在首次提交前完成，测试 Blob a4c5290e19b08715cd02d43d3d233e3917a97bae。固定 RC 与 Windows 全仓质量门禁未运行。
- **防复发**：使用 Unicode 正则时对语法保留字符明确转义，先 node --check 再运行实际测试；不得把语法检查或模拟测试当作真实迁移自发射验收。

### E-146 · 真实原生基线脚手架被固定排版匹配拒绝（PR #221，修复待 Windows 复验）

- **Windows 实测**：HEAD 87cade6f47db3bcd13a53f05f183ce108b89289a 开始验收，新增注释 8/8、DDL 8/8、基线 12/12；Vite+ 533 格式文件、374 受检零警告错误，401 个中文文案文件、96 份 Markdown，增量退出码 0。真实入口确认原包十文件、46 项 DDL、119 项注释及固定指纹，随后报“官方空起点迁移脚手架形状变化”，退出码 1。远端维护者格式提交 2ed5199726d95b8a8cc21e57a0186930b9f324dc。
- **根因范围**：此前以单行 import、固定空格/换行及完整文件结尾匹配脚手架，真实固定原件未通过其中一个断言；当前协作容器无法取回原 ZIP 的 migration.ts，无法确认具体不匹配的文本。失败发生于创建独立输出目录及启动自发射之前，不代表官方 self-emit 失败。
- **最小修复**：复用仓库已有 TypeScript，以语法树定位唯一官方命名导入、默认空起点迁移类、目标快照、单一 getter 返回数组及末尾官方入口；原文件十项哈希门禁不变。仅在原语法节点末尾插入 rawSql 导入及操作，不重排原有源码；再次解析并逐字核对原操作表达式。拒绝重复导入、非空起点、非数组、占位符、错误入口及语法错误。各阶段独立中文诊断；不放宽生成物、完整操作、快照或官方哈希比较。
- **局部验证与防复发**：Node 22.16.0、容器已装 TypeScript 5.8.3，以同逻辑源码执行新增两项及原八项回归 10/10，语法检查通过，新增夹具包含 CRLF、分行导入、尾逗号、返回类型、字符串内数组闭合标记及逐字恢复原源码断言。不是固定 RC 原文件或项目 TypeScript 6 全仓验证。今后不得把第三方代码生成的排版当作语义契约；真实产物仍需用已固定原件复验，失败保留诊断，不运行数据库或自动清理。

> **2026-11-26 · E-145/E-146 Windows 真实复验关闭**：维护者在 HEAD f4f134dd0a7772f57963d9ba8f8e85d01ac1874e 实测注释 10/10、DDL 8/8、基线 12/12，Vite+ 533 格式/374 受检零警告错误、中文文案 401、Markdown 96，增量退出码 0。实际独立 self-emit 干跑、完整 165 项比较、自发射及官方 migration check 均通过，原件与正式契约复核通过，官方新迁移标识 e6b95ed88834dce3f6448445a5ba12a00ba34c8e5c68f4335751659b15a77f17，退出码 0，工作区干净。远端最终 47d2d5fe137e1cc58076f0b9243584edf49bb454 相对验收起点仅两个脚本排版变化，维护者明确授权后 PR #221 Squash 合入 6dd53088aac7b48a7a76f37c594e6d176c65c1b0。关闭脚手架与离线生成阻塞，不代表数据库迁移及签名许可。

### E-147 · 第三座空库预检控制字符正则触发警告（PR #223，E-010 同类复发）

- **Windows 实测**：维护者运行五组专项共 45/45 通过，Vite+ 538 格式文件、378 受检文件零错误但两条 eslint(no-control-regex) 警告，中文 405 文件、文档 96，增量退出 0。独立候选固定十四文件及 165 项、官方再次干跑与完整性检查通过，证据指纹 02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e；真实空库预检另有 E-148。
- **根因与最小修复**：原始 URL 与百分号解码后口令分别使用控制字符正则，再次触发 E-010。改为逐码元 charCodeAt 检查，原 URL 仍拒绝 ASCII 0 至 32、127 及反斜杠，解码口令仍拒绝 ASCII 0 至 31 及 127，保留合法编码空格、原始 URL 和连接白名单、既有确认参数；不禁用规则、不降低安全门禁。
- **复验与防复发**：协作容器 Node.js 22.16.0 对与远端 Blob 完全一致的完整新核心、测试及固定 JSON 清单执行语法检查和十项测试 10/10 通过，新增穷举 ASCII 控制字符及编码边界回归。Vite+ Windows 零警告复验仍待完成；本地没有 vp，不能宣称全仓 Lint 通过。后续 URL 校验统一复用字符码检查，不再使用控制字符正则。

### E-148 · 第三座空库真实只读失败未区分连接与目录查询（PR #223，E-017 同类复发）

- **现象**：维护者 Windows 45 项回归、固定候选复验通过；在第三座专用库确认参数的真实入口中，原包十文件、46 项 DDL、119 项注释再次匹配，随后只输出“第三座专用库只读查询失败”，退出码 1。未取得库存在性、身份验证或具体 SQL 错误证据。
- **根因范围**：第三方异常在连接、启动事务、边界查询及目录查询的公共 catch 中统一脱敏，无法定位真实失败阶段；原始原因未确认，不能据此断言空库不存在、密码错误、SQL 有缺陷或权限不足。
- **最小修复**：保留既有 SQL、23 类检查、固定连接及证据白名单和回滚关闭；新增固定阶段以及已知 SQLSTATE/Node 网络错误码分类，涵盖 3D000、28P01、42501、42703、57014、ECONNREFUSED 等；未知错误仅输出固定中文回退，禁止回显原始异常、SQL 详情、连接串或凭据。回滚及关闭失败同样分类，不把失败当作成功。参照 PostgreSQL 官方错误码表，不依据通用失败消息改动数据库。
- **复验**：完整新核心 Git Blob 8393fec0fc3dedd504a3b7f5eeef51e2c1382bf1、测试 Blob 9c60881b6aad355bba3c3525ce1b837c64071cda、既有证据 Blob 6de926fef297190822192df32cf7aa5e8f9d6fc6 与本地文件一致，Node.js 22.16.0 实际 node --check 两模块及 node --test 10/10 通过；新增模拟各阶段已知错误及未知敏感错误码不回显断言。实际 PostgreSQL 新诊断及 Windows Vite+ / 中文 / 文档待复验。尚未创建、清理或迁移数据库；E-148 真实根因保持未确认。

### E-149 · 空库预检模拟参数的冗余 undefined 默认值（PR #223）

- **Windows 实测**：维护者五组专项 10+7+10+8+12=47/47，Vite+ 538 格式/378 受检，0 错误、1 条 typescript(no-useless-default-assignment) 警告，中文 405、Markdown 96，增量退出码 0。E-147 两条控制字符正则警告未再出现；E-148 的实际数据库失败原因尚未确认。
- **最小修复**：移除模拟客户端 failureCode 的冗余默认赋值，以可选 JSDoc 字段保留缺省 undefined，并显式标注固定错误诊断用例的元组类型。十项预检测试和全部原断言不变，不修改正式预检核心、固定证据、SQL 或数据库权限。
- **局部验证与防复发**：协作容器 Node.js 22.16.0 对修改后的模拟函数执行两项独立回归（含九组错误码）均通过，局部语法及 TypeScript 5.8.3 JavaScript 类型检查通过。仅删除默认值会使未显式声明的解构属性在局部 JavaScript 类型检查中产生错误，故保留可选类型。未执行最新提交的完整十项专项、Windows Vite+、全仓文案及文档检查，仍须维护者复验。
- **数据库边界**：维护者已明确授权仅创建本机第三座专用空库 adui_scada_fresh_prisma8_native；尚无实际创建或连接成功证据。若同名库已存在则保持原状，不重建、改所有者或清理。创建不等于部署授权；保持签名、迁移部署及正式 Provider 切换禁止。

> **2026-11-26 · E-147/E-148/E-149 Windows 结案补录**：维护者 HEAD f1c6b7cbaeb27a232413560c42b8811cba096cdc 实测五组 47/47、Vite+ 538 格式/378 受检零警告错误、中文 405、Markdown 96，增量退出 0；真实第三座 PostgreSQL 17.11 专用空库 23 类通过，回滚关闭、原件及十四文件指纹一致，退出 0，工作区干净。E-148 原始失败具体根因仍无独立证据；真实预检阻塞解除。经明确授权 PR #223 Squash 合入 2f8b692a8284f2eab182b5a44155bebaeff1c696。维护者已单独同意第三座专用库原生迁移；不代表正式 Provider 切换或其他库签名许可。

### E-150 · 第三座专用库真实迁移失败时官方错误封装被丢弃（PR #224，E-017/E-148 同类复发）

- **Windows 实测**：六组 52/52、Vite+ 542 格式/382 受检零警告错误、中文 409、Markdown 96，增量退出 0，工作区干净。维护者未单独打印本机 HEAD；远端最终 87b8e4d43144fda3e1118e43856bed395b63c4f1 相对 7b5256870c78d73d8367feb6638af23cbd3b6d24 仅两份脚本排版。真实空库及官方在线路径两次通过，固定十四文件证据一致；进入官方 db migrate 后包装器只输出子进程未确认成功，退出 1。未取得官方退出码、结构化错误或实际数据库回滚证据。
- **根因范围**：已确认包装器在 spawnSync 非零结果时丢弃 stdout/stderr/error 中的诊断，无法判断真实迁移失败类别。不能断言实际 DDL、注释、权限、前后置条件或 marker 的问题，也不能按文档所述事务原子性直接认定本次已经回滚。
- **修复候选**：在原分支冻结再次写入确认，不提供运行时绕过；保留原包、独立候选、历史、固定 CLI/Provider、SQL 与连接边界。新增只读恢复入口，复用专用 URL 白名单，检查实际目标、角色、所有者、其他会话及可重复读只读事务，读取 public 表/列/约束/索引/非空注释计数与固定 marker/ledger 表存在性、匹配统计；仅在未发现表或标记 schema 等时另行复用原二十三类空库门禁。回滚关闭后再核对证据，不执行迁移、签名、重置或业务数据查询。新增官方错误码、SQLSTATE 及进程错误白名单，仅从匹配命令的结构化封装提取固定代码，不回显原始异常、SQL、连接串、凭据或元数据。
- **实测及防复发**：Node.js 22.16.0 局部语法检查与六项模拟恢复回归 6/6；新核心 Blob bfd14ffc327b058eec860b74bcfa776bd35d3046、测试 Blob b9a779585572c8b6213b4ad6366def6098b021fd 与本地实测文件一致。依赖为仓库现有源码摘录，不是完整 Windows 或真实 PostgreSQL 验收。实际固定 RC 的 marker/ledger 字段及读取结果仍待验证，若不符以失败类别停止，不能据模拟统计宣称回滚或已迁移。原始失败诊断未被保留，须先检查数据库现状及必要的本机日志，再决定是否允许新的受控执行。

> **2026-11-26 · E-150 恢复验收补录**：维护者 Windows 七组 58/58、Vite+ 544 格式/384 受检零警告错误、中文 411、Markdown 96、增量退出 0；真实 PostgreSQL 170011 恢复检查退出 0，业务目录及注释九类计数均零，无 marker schema、marker、ledger 或旧迁移表，严格空库 23 类通过，十四文件指纹不变，工作区干净。远端最后 c5d77e6e23667a77662bfb5111d47396ba2ca57b 为格式化提交，经维护者授权 PR #224 Squash 合入 0ffb6672134c4676da31970d74b9bf7f7462bf89。此证据确认恢复后的受检空库状态，不证明首次执行的具体失败点或完整回滚。维护者补充容器日志，实际运行 postgres:17-alpine，健康检查通过；最后一条为 2026-11-26 00:48:31 UTC 目标库不存在，早于后来成功预检与原生迁移；其余为连接中断、认证超时和启动期间连接失败，未取得可关联首次官方迁移的错误。E-150 诊断丢失防护与只读恢复已验收，首次官方迁移失败根因仍待查。后续仅提供新一次性人工确认入口；旧写入确认继续拒绝，不自动重试，不调整数据库或候选。

> **2026-11-26 · E-150 诊断码复验补录**：维护者在 HEAD `240d70a3a2fbb3efeb43257ac1bb874d594bd75c` 开始 Windows 验收，恢复 12/12、迁移 5/5、空库预检 10/10（合计 27/27），Vite+ 546 格式/386 受检零警告错误、中文 413、Markdown 96，增量退出 0，工作区干净。最终 HEAD `ef8782371e3aaa0f56d557d3772ccc88e6db6ac3` 相对验收起点仅一份测试排版；经维护者授权 PR #225 Squash 合入 `9a8bfe5bb630c0c2dbb8b2df1c505f33d0948664`。真实一次性执行两次空库预检、唯一在线路径及固定证据核对通过，独占尝试记录已登记；官方迁移退出 2、诊断 `MIGRATION.SCHEMA_VERIFY_FAILED`，包装退出 1。随后真实第三座库 PostgreSQL 170011 只读恢复退出 0，九类目录及注释计数均零，无 marker schema、marker、ledger 或旧迁移记录，严格空库 23 类通过，十四文件指纹 `02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e` 不变。该证据不证明实际迁移成功或全部回滚过程。 原始直接错误诊断码已经取得，E-150 只读恢复及错误码识别已通过真实验收；具体结构差异仍未确认。

### E-151 · 宽容模式验收不能覆盖迁移后严格结构校验，且结构差异未保留

- **实际现象**：PR #225 已取得真实官方结构验证失败码及恢复证据，但原白名单诊断只返回固定错误码，未保留具体 schemaIssues。不能把已通过的宽容校验视为严格迁移验证成功。
- **源码核查与边界**：已核对固定 PostgreSQL Provider v8.0.0-rc.25 上游源码 `packages/3-targets/postgres/1-target/src/core/migrations/runner.ts`（https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/3-targets/postgres/1-target/src/core/migrations/runner.ts）：app 空间在执行计划后、提交事务和更新 marker/ledger 之前，以同一 driver introspect 并调用 verifySchema，默认 strictVerification 为 true；失败携带 meta.schemaIssues。既有 #216 是宽容 schema-only 对照，不能代替迁移严格验证。尚未确认固定 CLI rc.35 是否覆盖默认选项，也未保留此次 schemaIssues 具体内容，严格模式只是待验证的差异假设，不得认定历史登记、中文注释或某一约束为根因。
- **最小后续候选**：本批冻结原确认和已消耗的单次恢复确认（无论本地记录是否存在），保留一次性记录和原件。只在既有 CLI 白名单新增 `db native-schema-verify-strict`，映射固定 `db verify --schema-only --strict --json`，复用原生配置、原 adui_scada_test URL 守卫与 PostgreSQL default_transaction_read_only、超时和 search_path 参数；不扩大允许库名，不运行任何写入，不改第三座库、候选、历史、正式 Provider 或依赖。严格 JSON 是官方机器输出，仅供维护者在本机提取诊断码、结构路径和差异类别，不分享原始输出、凭据、任意元数据或业务值。严格对照可能返回历史 Prisma 7 登记等未声明对象，不能据此推断第三座库实际失败点，也不应删除对象、放宽验证或签名。
- **验证**：协作容器 Node.js 22.16.0 核对 CLI Blob `16308a36bfddaf90380afc42000c155b853f7aff` 及现有 URL 守卫 Blob `3a84f36578e21973f9f1c4fe6a60e391e80fd32b` 与本地一致，CLI 语法检查通过；独立模拟子进程 5/5（严格参数与根 cwd、只读选项、退出码，宽容行为保持，非法目标/选项、附加参数/写命令拒绝，离线环境隔离）。首次局部测试受 Node 22.16 默认未启用 TS 类型擦除影响为 3/5，使用 NODE_OPTIONS=--experimental-strip-types 后 5/5；不是 Windows Node 24 仓库九项回归，不是固定 RC 实际结构验收。Windows CLI 9 项、恢复 12 项、迁移 5 项、空库 10 项及 Vite+、中文、文档与真实严格对照尚待维护者执行。

> **2026-11-26 · E-151 严格控制库验收补录**：维护者 Windows 实测 CLI 9/9、恢复 12/12、迁移 5/5、空库 10/10，共 36/36；Vite+ 546 格式/386 受检零警告错误、中文 413、Markdown 96、增量退出 0、工作区干净。固定 RC 与两份 Contract SHA-256 通过；历史验收库真实宽容及严格 schema-only 均退出 0，严格官方机器结果 True。日志未单独输出本机 HEAD，远端 PR #226 HEAD ac0b7abad8094b0ce38036f1fe5a2a234709cbd7，经明确授权 Squash 合入 5797d5388eac7b531ae13e51e0b336ef770bf460。仅确认控制库结构符合契约，不证明第三座库迁移后的实际目录或失败原因。

固定 Provider rc.25 Runner 源码 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/3-targets/postgres/1-target/src/core/migrations/runner.ts 的 applyPlan 在 postcheck 和幂等检查均启用时先执行 postcheck；非空且全部满足则跳过该操作，否则继续执行 precheck、execute、postcheck，随后 app 空间整体 schema 验证。已有 DDL 对照只验证 execute 文本，并未分析真实 precheck/postcheck 参数及是否可能提前满足。此为调查方向，不能断言实际发生过跳过，也不能把空检查或相同检查判定为故障。控制库严格验证已通过，不再把宽容/严格差异单独作为根因。CLI rc.35 实际参数、真实失败 schemaIssues 和失败瞬时结构仍缺证据。

> **2026-11-26 · E-151 执行检查真实验收补录**：维护者 Windows 实测 PR #227：执行检查 4/4、DDL 8/8、候选完整性 7/7，共 19/19；Vite+ 549 格式/389 受检零警告错误，中文 416，Markdown 96，增量退出 0，工作区干净。真实固定离线报告退出 0，十四文件指纹 02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e 不变，46 项结构、119 项注释，缺前置 1、缺后置 1、相同前后 0，状态 EXECUTION_CHECK_REVIEW_REQUIRED。日志未打印具体操作标识或报告全文，不能断言两项为同一操作或判定实际发生错误跳过。日志未单独打印 HEAD；远端唯一 HEAD 8328529cd078bfb6ff37df206c426ca864c0dcd5，经明确授权 Squash 合入 46d9e0e757d1ad46c3b88f302f012612da4356f0。

新增上游证据：v8.0.0-rc.25 标签的 CLI 共享源码 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/1-framework/3-tooling/cli/src/control-api/operations/run-migration.ts 在 perSpaceOptions 显式传入 strictVerification: false，不能继续将 Runner 默认 true 当作实际迁移参数；此标签 CLI 源码不等同维护者已安装的 CLI rc.35，后者实际选项仍未核实。相同标签的 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/1-framework/3-tooling/cli/src/control-api/operations/db-verify.ts 使用 collectAggregateNamespaces(aggregate) introspect，再按空间 verify；而 Runner 使用 destinationContract 直接 introspect/verifySchema。Provider 公开控制入口 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/3-targets/postgres/9-facade/src/exports/control.ts 与 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/1-framework/3-tooling/cli/src/control-api/client.ts 的 schemaVerify 使用完整反序列化契约直接 introspect/verifySchema。该差异值得对照，但不证明第三座库失败由聚合或非严格模式导致。

### E-152 · 直接结构验证入口在 finally 中抛出证据复核异常（PR #228，E-107 同类复发）

- **实际现象**：维护者 Windows 实测 PR #228：直接结构 4/4、执行检查 4/4、候选完整性 7/7，共 15/15；Vite+ 552 格式/392 受检，0 错误、1 条 eslint(no-unsafe-finally) 警告，中文文案 419、Markdown 96、增量退出码 0，工作区干净。日志未单独打印本机 HEAD；远端 b7d5bcd0e607485e75d11fd880447ea0bc8b0105 相对交付 HEAD ea5cb8760751cf60078e46e291500dd9710f0303 为三份源码排版提交。真实历史验收库 adui_scada_test 的直接宽容与严格验证均 ok=true，issueCount=0、warningCount=0、issuePaths=[]，退出 0，十四文件证据指纹 02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e 不变，状态 DIRECT_SCHEMA_REVIEW_REQUIRED，签名与部署均 false。这里的数据库结构警告为零不等于 Vite+ 零警告。
- **根因与最小修复**：最小修复：E-107 同类复发。入口原 finally 中直接 throw 违反 no-unsafe-finally，且证据复核失败会覆盖先前验证或关闭失败。将成功与异常路径统一交给 runLockedDirectSchemaReview：先等待原只读验证及关闭，捕获既有脱敏诊断，再独立复核固定指纹；指纹不同或复核异常都记录固定中文原因，最后在普通控制流汇总抛出，不在 finally 内改变控制流。成功或失败均执行证据复核，双重失败不输出成功 JSON、不掩盖原始脱敏阶段，不回显第三方异常。保持原 CLI 参数、连接白名单、超时、只读设置、快照、候选、输出格式、退出码 0/4/1、签名及部署冻结。
- **验证与防复发**：协作容器 Node.js 22.16.0 使用与远端当前三个源码及 URL 守卫 Blob 字节一致的文件进行修改；真实执行三份新增修改后源码 node --check 与 node --experimental-strip-types --test scripts/prisma8-native-direct-schema-review.cases.mjs，7/7 通过（保留原 4 项并新增 3 项：关闭后复核及保留不匹配报告、成功验证后指纹变化/读取异常阻断、验证与关闭失败同时证据异常的汇总脱敏）。修复后核心 Blob 5f46984ef13c58344eff20f018434d6301c2e96b、测试 13fd48c16052cddb7fb13ce01f5a11b185b42023、入口 9da69724fd8834e1d4a76008426ef49da93cc8b4 与本地相同。容器没有完整仓库、固定 RC、真实数据库、pnpm 或 Vite+，修复后的 Windows 格式、零警告、文案、文档及真实入口尚待复验；不冒称已经消除全仓警告或迁移成功。
- **真实证据补录**：维护者从已存在的离线报告提取出 missingPrecheck 与 missingPostcheck 均仅为 schema.public，identicalChecks=[]。该项为已验收的 CREATE SCHEMA IF NOT EXISTS public（实际 SQL 使用双引号）；Runner 的空 postcheck 不会触发预满足跳过，其余 164 项均具备前后检查。不能据此确认实际执行情况，也没有证据将该项视为失败根因。历史库聚合、直接两种路径各自宽容与严格均通过；未复现失败事务内目录，仍无第三座库原始 schemaIssues，CLI rc.35 实际选项仍未核实。

> **2026-11-26 · E-152 Windows 复验关闭**：维护者在明确打印的 HEAD c10e154cb38170b4c58fa4ab9917a089e5bdadb6 实测 PR #228 E-152 修复：直接结构 7/7、执行检查 4/4、候选完整性 7/7，共 18/18，Vite+ 552 格式/392 受检零警告错误、中文 419、Markdown 96、增量退出 0，工作区干净。按明确授权 Squash 合入 3bfb92229980f5f46a1f7c9244d4e3c59ff83d4c。E-152 静态质量与模拟保护复验关闭；修复前真实历史库直接验证两种模式均通过，但此次日志未包含修复后的真实数据库复验，不重复登记为新的数据库实测。

> **E-150/E-151 取证后续**：固定 Provider rc.25 上游 Runner 源码 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/3-targets/postgres/1-target/src/core/migrations/runner.ts 在事务内结构验证失败时返回 MIGRATION.SCHEMA_VERIFY_FAILED 并携带 meta.schemaIssues；CLI 共享源码 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/1-framework/3-tooling/cli/src/utils/runner-failure-error.ts 将 failure.meta 保留在 CLI 错误对象。上游 https://github.com/prisma/orm/blob/v8.0.0-rc.25/packages/1-framework/1-core/framework-components/src/control/schema-diff.ts 的 issueOutcome 明确从 expected/actual 是否存在派生 not-found、not-expected、not-equal；解释类别仅为 differs、possibly-equivalent。固定 CLI rc.35 的最终 JSON 序列化仍须实测，不能将 rc.25 标签共享源码认定为安装包完整实测。现有迁移包装器在内存捕获 stdout/stderr 后仅输出白名单错误码；一次性尝试记录只含范围和指纹。仓库代码未持久化原始 schemaIssues；不能确认维护者是否另有原始机器输出，也不能从恢复后空库反推失败时具体差异。

新增只读离线诊断解析器：只接受已有机器诊断的标准输入，16 MiB 上限，匹配唯一 db.migrate 结构失败封装，兼容直接错误、逐行事件最终错误及最终诊断数组；命令、严重度和结果状态矛盾、重复或畸形结果拒绝。仅输出契约白名单结构路径、由 expected/actual 存在性派生的类别、两种已知解释类别和数量，未知路径脱敏，不输出节点原值、摘要、解释正文、凭据、连接串或任意元数据；缺失列表与空列表分别用 null 与 0 表达，均不代表零差异通过。入口复用原包/固定十四文件门禁，另核对候选 contract.json 长度及 SHA-256，复用已有路径白名单，输出前复核固定证据。离线入口不认证日志来源，不调用 Prisma CLI、数据库驱动、迁移、签名或任何写入；不能通过旧错误码重构丢失的具体结构差异。退出 0 仅表示取得非空合法脱敏差异，4 表示唯一失败但缺少具体差异，1 表示输入或证据拒绝。所有报告 signingAllowed 和 deploymentAllowed 均为 false；旧迁移入口及写入冻结门禁不变。

### E-153 · 独立迁移配置在暂存文件检查时缺少 Node 全局类型（PR #230，待 Windows 复验）

- **Windows 实测**：维护者六组专项 51/51、Vite+ 559 格式/399 受检零警告错误、中文文案 426、Markdown 96、增量退出 0。全仓格式化留下五份暂存文件。真实迁移指令在工作区干净门禁处拒绝，未读取专用口令、未启动复现入口、未消耗一次性尝试。JetBrains Git 提交触发共享 staged 的 vp check --fix，对五份暂存文件检查报 apps/server/prisma8-native-repro.config.ts 的 process.env TS2591，退出 1；提交 Hook 回退任务产生的修改，不得把全仓检查通过视为提交检查通过。
- **根因范围**：根 tsconfig 仅包含 vite.config.ts，服务端 tsconfig 仅包含 src、test 及 vitest.config 文件；独立 Prisma 配置位于服务端根，未被其 include 直接覆盖。共享 staged 单独检查暂存路径，Node 全局类型未加载是实际错误所指向的原因；固定 Vite+ 内部选择 TypeScript 项目的完整过程仍待实际复验。根与服务端已声明 @types/node，不新增依赖或放宽共享检查。
- **最小修复**：仅在第四座专用配置文件顶部显式声明 Node 类型引用，保持原 process.env、连接白名单、独立路径、候选和冻结门禁不变。不修改共享 tsconfig、不关闭 Hook、不绕过类型检查。
- **局部实测**：协作容器 Node.js 22.16.0、TypeScript 5.8.3，模拟 types=[]、已安装 Node 类型和两个 Prisma 配置模块声明。原配置 Git Blob d2c867d9c56e7e91a3323309359ec9ba6c07cdf7 精确复现 TS2591，退出 2；独立最小夹具中仅导入 node:process 仍报 TS2307，退出 2；添加文件级 Node 类型引用后完整配置 Blob 4f81c22c14a30e60f88def57f7671352dce096c2 检查退出 0。使用模拟配置工厂实际验证合法专用 URL 及七种错误/缺失 URL，共 8/8 通过。该结果不是固定 Prisma RC 或 Vite+ 实测，Windows 暂存路径检查及真实 pre-commit 仍待复验。
- **防复发**：独立 Node 配置须确认文件自身具备必要类型来源；全仓检查后新增暂存文件专项验证并实际通过 Git Hook，保存格式化改动后同步远端，核对最终提交及干净工作区才允许第四座一次性实验。不通过删除尝试记录、跳过 Hook、增加全局类型或更改数据库授权解决。

> **2026-11-26 · E-153 复验及 E-150/E-151 取证补录**：维护者 Windows 六组 51/51、Vite+ 559 格式/399 受检零警告错误、中文 426、Markdown 96、增量退出 0，修复后的格式提交 a25962d7f4eee6db5a7b5cd35080486ec205c0bd 已推送且真实实验明确核验本机与远端一致，工作区干净；未独立取得成功 Hook 输出。PR #230 经授权合入 265c02a7fd679abf3771140c4196135b1cbdb40f。第四座真实迁移官方退出 2，MIGRATION.SCHEMA_VERIFY_FAILED，两项 CHECK 的实际失败诊断已认证解密、精确确认 ARRAY_CAST 与 ELEMENT_CAST 差异；E-150/E-151 的诊断缺失问题在第四座实验中取得实证，但第三座旧失败的原始差异仍不可恢复。后续新候选须从独立源文件发射，禁止根据长度推测而直接改写旧 JSON 或哈希，禁止仅依据控制库比对通过宣称迁移重放成功。固定版本 exact-named CHECK 比较文本，不能以字符串规范化自行放宽任意约束。原第四座入口及配置明确冻结，不依赖本地证据文件存在；不删除任何证据或重试。

### E-154 · 第四座复现实验保留候选被中文文案扫描误纳入（PR #231，待 Windows 复验）

- **Windows 实测**：五组专项 43/43（7+9+7+8+12），Vite+ 563 文件格式通过、403 个受检文件零警告错误。messages:check 对 apps/server/.artifacts/prisma8-native-repro-candidate 根契约声明及目标快照声明报四处 Prisma 自动生成英文注释，退出 1；后续文档检查未执行，增量退出 1。日志未提供本机 HEAD 或工作区状态；尚无新修复契约实际发射结果。
- **根因**：第四座单次实验创建的独立十四文件副本位于服务端工作区 .artifacts 下，中文扫描从 apps 递归进入该目录；已有排除清单只覆盖正式生成物和独立注释候选，没有同步纳入第四座副本。共享 Format/Lint 清单也缺少这一精确路径，故补齐以保护保留证据；未证明此次 Vite+ 已改写副本。
- **最小修复**：沿用现有归一化相对路径排除机制，仅新增 apps/server/.artifacts/prisma8-native-repro-candidate 及共享 Format/Lint 中同一路径的子树模式。相邻路径和其他自有源码继续受检，不排除整个 .artifacts 或放宽中文判定，不翻译、删除或修改官方生成物、固定指纹、候选、数据库连接或冻结逻辑。新增实际子进程扫描回归两项，并注册 test:messages 至 ready。
- **局部实测**：Node.js 22.16.0、原扫描器 Blob 3fa8fc77f683c931510d39855f6dee775252e42f，独立临时目录包含根声明、嵌套快照、原注释候选及自有源码。修复前新增两项回归均失败（退出 1）；修复后 2/2 通过（退出 0），断言根及快照声明原文保持不变，自有英文注释与名称相近的其他目录仍被拒绝。局部自有文案扫描 7 文件通过；语法检查通过。修复扫描器 Blob af4904e7fcb233d712da2b16bf3c5cafa9d914bb、测试 Blob 8b05d9dcb232ffb4a48536da9da581e9c51150ba 与远端一致。真实 Windows 完整扫描、共享 Vite+、文档检查及第四座副本实际十四文件指纹待复验；不能把临时夹具视为真实实验目录验收。
- **防复发**：新增第三方独立生成目录时同步检查中文文案、格式化与 Lint 精确边界，并增加真实目录形状回归；任何已保留的迁移证据必须先复核字节及指纹，再继续离线候选生成。若真实副本不符，应保留现场，不恢复、不覆盖、不重试数据库迁移。

> **E-154 Windows 复验关闭（2026-11-26）**：维护者 Windows 在 HEAD 15b533cf43cb37b4d378a41248381cc46f3f5b66 完成 PR #231 验收：累计专项 45/45，Vite+ 564 格式/404 受检零警告错误、中文 431、Markdown 96，增量退出 0；固定 RC 官方修复契约发射退出 0，第四座十四文件指纹 02c5020befa825293d7e7dae68fd274f32c089aecb7e0d7929cdf06d2a79321e 单独复核退出 0。维护者授权后 Squash 合入 3537b9b878a2e33da442c9a7ce16d4c41eb9df26。新 storageHash 为 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436；仅两项已定位的 CHECK expression 与新存储标识改变，正式 Prisma 7 和四座数据库均不变。尚未验证 PostgreSQL 往返。 本批沿用同一精确边界，将新独立迁移包目录加入中文扫描、共享格式化与 Lint 的排除清单，并扩展临时目录回归，实测中文回归 2/2，仍拒绝相邻目录和自有英文注释；实际新迁移包生成后全仓复验待执行。

### E-155 · 将两个缺失排序规则版本误报为版本匹配（PR #237 后续）

- **真实现象**：PR #237 已经维护者明确授权 Squash 合入 `fc459570f39708cc3746bc140d8d9e3fe96d6425`。Windows 增量验收四组专项 35/35（7+8+12+8），共享配置通过，Vite+ 582 格式文件/421 受检零警告错误，中文文案 448 文件、Markdown 96，退出码 0、工作区干净；增量日志未独立打印本机 HEAD。维护者另行明确授权四个冻结库系统目录只读核验，并在已打印的合并 HEAD 上实际执行固定离线计划与目录采集，退出码 0；计划指纹 `17c106877fe8e3177d405ac31fb335ce76c714511ce1eef537d3cf139e723d3a` 不变，四库两集群、UTF8、libc（c）、LC_COLLATE/LC_CTYPE 均为 en_US.utf8、locale=null、记录版本=null，旧报告 recordedCollationVersionMatches=true。旧源码将实际版本与记录版本作严格相等比较，由此可知实际版本亦为 null；这只能证明目录字段相同，不能视为排序规则版本或运行库身份已获认证。八项宿主机许可均为 false。
- **确定根因**：旧目录采集以 `row.version === row.actualVersion` 校验，两个值同为 null 时也成立，随后无条件将 recordedCollationVersionMatches 设为 true；目录元数据相等与存在可核实的版本不是同一结论。前一轮候选生成时另静态发现 SQL 模板转义及 Docker 参数下标错误，均在本次验收前更正；未将其伪称 Windows 失败。
- **修复与防复发**：本批修正 PR #237 的目录报告语义，保留已记录的历史原始结果，不改 SQL 查询、只读事务、角色、库名、端口、固定证据及正式 Prisma 7。新增 actualVersion 字段；仅两版本均存在且相等才报告 recordedCollationVersionAvailable=true、recordedCollationVersionMatches=true、recordedCollationVersionStatus=MATCHED；libc 两版本均为 null 时报告 false/null/UNAVAILABLE，缺失字段、单侧 null、版本不一致、非 libc 双 null、自定义规则均拒绝。保留 allFrozenCollationsMatch 兼容字段，其含义仅为目录元数据一致，并以 allFrozenCollationCatalogMetadataMatch 明确说明。两座容器必须与已固定镜像 ID 相同；仅通过 Docker inspect 的固定模板读取挂载目标 JSON（不读取源路径或环境），并以两次 docker diff 检查指定 libc/locale 路径及其祖先和子树的可见变更。路径不规范、挂载覆盖、可见文件变更、异常输出均先于数据库连接拒绝，保留固定中文诊断。本次保守规则也可能因 Docker 报告的祖先目录变更而拒绝正常容器，须评审实际观察，不删除、重建、清理或修改冻结容器以通过。成功仅报告 containerImageIdentityMatched=true、localeRuntimePathsObservedUnchanged=true，collationRuntimeIdentityVerified 始终为 false；Docker inspect/diff 不是实际进程加载库的内容哈希或 locale 行为认证，亦不排除未列路径、环境覆盖、并发变化。第五座尚未创建，后续创建与真实执行仍须分别授权；所有许可及来源认证继续为 false。
- **实际验证**：协作容器 Node.js 22.16.0 实际运行目录专项 12/12（原 7 项扩展为 12 项）及宿主机专项 8/8，共 20/20，零失败、零跳过；核心、测试、宿主机、入口及宿主机测试的 node --check 均通过。缺少确认参数及非 Windows 环境的真实入口均实测退出 1，未调用 Docker。两个变更文件 Git Blob `ed27fd1d673de3e651313bc819419e1c0a7e8af7`、`66eef27a877a9f5ac61944bd2e337ceebdeefcad`，原宿主机 `a7a56e5e7bbd0ef499c22e6b8712e5d296a36cf9`、宿主机测试 `cc58bd01b67b6e37c7cf92fe797a360f3d09443f`、入口 `e526e21c3362ce05d65ef8b2843f3be4a3a9bc1b` 与本地实测文件字节一致；执行模块仅取原始两个固定导出，未运行完整依赖环境。真实 Windows Docker inspect/diff、更新后的四库目录采集、完整 Vite+、中文文案及 Markdown 待维护者复验；本批未执行任何 PostgreSQL SQL、未创建或修改任何数据库资源。

### E-156 · 全新安装对象及诊断码缺少显式字符串排序比较器（PR #241，E-142 同类复发）

- **现象**：维护者 Windows 四组专项 52/52（11+13+15+13），共享配置通过，Vite+ 592 格式文件、430 受检文件零错误但三条 typescript(require-array-sort-compare) 警告；中文 457 文件、Markdown 97 份通过。尚无真实官方发射或 PostgreSQL 19 只读预览结果。
- **根因与修复**：全新安装核心存在四处默认字符串排序，测试另有一处默认排序。核心统一显式 UTF-16 码元比较器，并明确对象标识及诊断码集合的字符串类型，JSDoc 同行保留中文说明；测试使用固定预期清单，新增数字、下划线、乱序输入及诊断码去重回归两项。不使用地区排序，不放宽任何对象、指纹、诊断、数据库身份或权限门禁，不改变 PSL、注释 SQL 或依赖。
- **局部实测**：协作容器 Node.js 22.16.0 对实际修改的规划与诊断函数提取片段、原夹具和两个新增测试执行语法检查及测试，另验证比较器与原默认字符串排序等价，共 3/3 通过，提取片段 4874 个 UTF-16 码元、FNV-1a 校验值 1d9d1de5；源码及测试 Git Blob 分别为 7295a31fd1e4da7509a51a43a81a107a2f450668、764c8c968e7aba985fb4d89e1bd1acb05184e096，远端回读一致。不是完整十三项测试或 Vite+ 验收。Windows 专项及质量链仍待复验。
- **防复发**：所有新增字符串排序须检查元素类型并显式保留原码元顺序；新增类型注释同步核对中文门禁，提交前实测完整质量链。真实初始化仍须先完成只读预览、合并并取得维护者独立授权。

> **2026-11-27 · E-156 Windows 复验关闭**：维护者 Windows 四组专项 54/54（13+13+15+13），Vite+ 592 格式文件/430 受检文件零警告错误，中文 457 文件、Markdown 97 份、增量退出码 0。八份源码格式化经正常提交 Hook 后推送 HEAD 09385336fa9a7880965c89597b85dea7b1742a99，官方发射及真实 PostgreSQL 19 只读规划通过，45 项新增操作、23 类空库检查、databaseInitialized=false。PR #241 按维护者授权 Squash 合入 4a06766da5d9ec99bed96104dc26c17d21112d43。合并后再次预览通过；维护者另行授权并实际在已核验的合并提交运行首次初始化和独立严格校验，分别返回 FRESH_DATABASE_INITIALIZED、FRESH_DATABASE_VERIFIED，databaseInitialized=true，严格校验退出码 0，工作区干净。仅数据库结构及中文注释已验收，不代表正式 NestJS Provider 已切换。

### E-157 · 授权仓储注入改造遗漏历史 ACL 对照测试构造调用（PR #244，待 Windows 复验）

- **现象**：维护者 Windows 修复前全新原生专项 28/28、原生运行时 7/7、四份身份及装配专项 39/39、HTTP E2E 63/63，共 137/137；Core 构建、双版本客户端/契约生成及共享配置通过。vp check --fix 在 445 个受检文件中报告 TS2739 一项错误、零警告，格式化完成但增量退出码 1；后续独立 vp check、中文、文档、服务端构建和真实原生授权只读烟测未执行。日志未给本机 HEAD。
- **根因**：ScadaProjectGuard 首个参数已由具体 PrismaService 改为 AuthorizationReadStore，历史 ACL 对照测试仍传入 { client, onModuleInit, onModuleDestroy }，缺少 findActiveExternalIdentity 与 readProjectGrants；属于 E-047/E-069 同类测试依赖同步遗漏。
- **最小修复**：仅为 apps/server/test/prisma8-project-acl.db-spec.ts 中的历史 Prisma 7 Guard 构造调用补充 Prisma7AuthorizationReadStore 导入并包装原 database；复用现有适配器，不新建客户端、不改变 Prisma 8 对照 Guard、隔离库 URL、授权断言、撤权及清理逻辑。不改生产代码、数据库或配置。
- **验证边界**：已逐一读取当前 PR HEAD 的 59 份服务端 spec、db-spec、e2e-spec，核对两个改造构造函数的直接调用及显式 provider 匹配，并复核正式身份模块及原生烟测；仅发现上述直接构造调用仍传原数据库对象。协作容器 Node.js 22.16.0 / TypeScript 5.8.3 用最小依赖类型声明及对应真实端口签名复现旧调用 TS2345（缺少同样两个方法，退出 2），包装后 strict noEmit 退出 0。此为最小类型复现，不是仓库 TypeScript 6 或真实 SDK 编译；完整 Windows Vite+、中文、文档、服务端构建、原生只读烟测仍待复验，未执行历史数据库专项或数据库写入。
- **防复发**：改变注入端口或构造函数签名时，按当前功能分支全树逐一核对正式模块、所有直接 new 调用、测试 provider 与全部历史 db-spec/e2e-spec；不能以定向 Vitest/E2E 全绿替代全仓类型检查。先生成依赖产物再执行 Vite+，保持历史隔离测试不连接新业务库，不用 any 或类型断言掩盖类型不兼容。
- **证据**：维护者 Windows TS2739 原始日志、PR #244、apps/server/test/prisma8-project-acl.db-spec.ts、docs/VALIDATION.md。

> **2026-11-27 · E-157 Windows 复验关闭**：PR #244 Windows 修复后 Core 构建、双契约离线生成、Vite+ 607 格式文件/445 受检文件零警告错误、中文 472、Markdown 97、NestJS 构建、git diff --check 均通过，增量退出 0；此前修复前专项与 HTTP E2E 137/137。正常 Hook 格式化提交 c0990870e13e8cf143af144344c3f96d49b563ae 已推送，五文件远端差异仅排版。真实 FRESH_PROVIDER_SMOKE_READY，PostgreSQL 190000、databaseInitialized/providerReady/providerClosed/readOnlyBoundaryVerified/authorizationReadVerified/missingProjectDenied=true、providerSwitched=false，存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436、12 表、85 字段、36 CHECK、20 非主键索引、13 外键、119 注释，退出 0、工作区干净。维护者明确授权 Squash 合入 02087974c7cba37857cae1984c0a5fc2a09fb16d；无额外远端 CI 记录。E-157 的 Windows 类型修复已复验，历史隔离库写入测试未执行。 本条仅关闭类型构造遗漏，不代表新身份写入已验收。

### E-158 · 共享身份事务端口泄漏原生 Contract 类型并保留冗余默认值（PR #245，待 Windows 复验）

- **Windows 实测**：维护者 Windows 首轮 Core 构建、Prisma 7 客户端与新原生运行时契约离线生成（databaseAccessed=false）、共享配置通过；全新专项 28/28、运行时 7/7、身份与装配 58/58、HTTP E2E 63/63，合计 156/156。vp check --fix 报历史会话与 OIDC 候选 operation(tx) 两项 TS2345，原生身份测试 timeout 默认值一项 typescript(no-useless-default-assignment) 警告（451 受检文件）；格式化完成但增量退出 1。日志未提供本机 HEAD，后续独立检查、文案、文档、构建、真实烟测未运行。
- **根因与修复**：根因为共享端口 Pick<Prisma8Transaction, raw/query/execute> 仍携带新原生 Contract，历史 Contract 的主键声明缺少新生成物要求的 name，raw.sql 类型不可赋值。改为仅暴露参数化文本查询与影响行数的共享端口，两套适配器分别以自身强类型事务构造和执行 SDK 计划；保留相同的八条业务 SQL（模板逐字核对）、参数、事务超时、历史隔离库/Issuer 门禁、原生前后边界及只读拒绝、业务锁和影响行数判断。不跨契约断言、不拼接 SQL、不新增连接或修改生成产物。返回列缺失或非文本时失败关闭；移除测试模拟函数冗余默认值。新增两项 Vitest 候选覆盖两代适配器参数转发及异常行、原生签发遇异常行模拟回滚。
- **验证边界**：协作容器 Node.js 22.16.0、TypeScript 5.8.3，以最小 SDK 类型模型（两代 Contract 主键 name 差异、参数化 raw/query/execute 签名）复现旧端口类型不兼容并通过新端口 strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes 检查；四项独立模拟测试通过，覆盖两代适配器参数转发、影响行数及缺失/继承/非文本列拒绝。该模型不等于已安装 Prisma 8 RC 或仓库 TypeScript 6；协作容器无固定 SDK、完整依赖、pnpm/vp 或本机 PostgreSQL。Windows 完整增量质量门禁及真实只读烟测仍待复验。保持 Draft，不切换正式根模块、不启用定时清理、不执行数据库写入或迁移。
- **防复发**：共享端口不直接 Pick 含具体 Contract 的 SDK 事务成员；对历史及原生各自的真实事务上下文进行编译验收，保留参数化计划与同一事务安全门禁；检查测试 Mock 参数默认值，定向 Vitest 通过不代替全仓类型检查。
- **证据**：维护者 2026-11-27 Windows 原始日志、PR #245、apps/server/src/auth/prisma8-auth-transaction-port.ts、docs/VALIDATION.md。

> **2026-11-27 · E-158 Windows 复验关闭**：维护者 Windows 复验全新专项 28/28、原生运行时 7/7、身份与装配 60/60（原生身份 11/11）、HTTP E2E 63/63，共 158/158；Vite+ 613 格式文件/451 受检零警告错误、中文 478、Markdown 97、NestJS 构建和 git diff --check 均通过，增量退出码 0。正常 Hook 格式化提交 da0c6a5eb348e5c4238b032bf30eed26f0ee937b 已推送，核对 13 文件差异仅排版。真实 FRESH_PROVIDER_SMOKE_READY，PostgreSQL 190000、12 表、85 字段、36 CHECK、20 非主键索引、13 外键、119 注释及存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436 一致，databaseInitialized/providerReady/providerClosed/readOnlyBoundaryVerified/authorizationReadVerified/sessionReadVerified/identityWriteDenied/oidcDiscoverySkipped/missingProjectDenied=true，providerSwitched=false，退出 0、工作区干净。维护者明确授权 Squash 合入 feat/mvp-first-integration 的 961c4b0278d3de5fbd4fdc3515b3783fb58f43e8；E-158 类型与 Lint 复验关闭，真实身份写入、并发消费及回滚仍未验收。

### E-159 · 原生工程事务后置身份漂移测试遗漏异常消息（PR #247，E-003 同类复发）

- **Windows 实测**：维护者 Windows 在 2cdbbd7441c7bb7bc7b74d5cfbba9b7ff3f1c781 完成全新专项 28/28、原生工程写入 11/11、查询 10/10、模块装配 9/9，共 58/58；Vite+ 619 格式文件/457 受检文件零错误但一条 vitest(require-to-throw-message) 警告，中文 484 文件、Markdown 97 份、NestJS 构建、git diff --check 及增量退出码 0。正常 Hook 格式化提交 bc8c9ecd03988c97c1349427be59f9aca7c374c4 已推送，三文件差异仅排版。真实 FRESH_PROVIDER_SMOKE_READY，PostgreSQL 190000、存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436、12 表/85 字段/36 CHECK/20 索引/13 外键/119 注释一致，全部既有只读核验及 projectWriteDenied=true，providerSwitched=false，退出 0、工作区干净。
- **根因与最小修复**：后置身份漂移夹具将 role 改为 wrong，实际由 requirePrisma8RuntimeIdentity 抛出“Prisma 8 运行时数据库身份、标记或连接边界不一致”。仅将无参数 toThrow 改为该确定文案，保留边界执行顺序、模拟拒绝及未提交断言，不改变业务 SQL、提供方或数据库。静态复核唯一替换及该文件无无参数 toThrow；Windows 原生写事务定向测试、Vite+ 零警告及中文/文档检查待复验。
- **防复发**：编写所有新增异常测试时逐项核对真实抛出点及专属消息；提交前扫描无参数 toThrow，禁止禁用 Lint、放宽断言或以退出码 0 代替零警告验收。真实 PostgreSQL 写入和回滚仍未验收，不执行旧库专项。
- **证据**：维护者 Windows 日志、PR #247、apps/server/src/projects/prisma8-runtime-project-version-store.spec.ts、docs/VALIDATION.md。

> **2026-11-27 · E-159 Windows 复验关闭**：维护者 Windows E-159 复验 HEAD 8d18844f189afb726a27e95f66b84ffeda41e7b2：原生工程写入 11/11、619 格式文件、457 受检文件零警告/Lint/类型错误、中文文案 484、Markdown 97、git diff --check 均通过，退出码 0、工作区干净。此前 58/58 增量及 PostgreSQL 19 真实 FRESH_PROVIDER_SMOKE_READY（projectWriteDenied=true、providerSwitched=false、指纹和结构数量一致）通过，修复只修改测试及文档，未改变业务或烟测代码。维护者明确授权，PR #247 已 Squash 合入 feat/mvp-first-integration 的 6ef45e964c2b2bb87b4a01eed1e66cd3321fda9d。E-159 已关闭。 禁止用退出码替代零警告门禁，后续新增异常断言继续核对专属消息。

### E-160 · 原生清理后注释测试条件断言与身份标记错误文案未同步（PR #250，E-003 / E-023 / E-086 同类复发）

- **Windows 实测**：维护者完成 pnpm 12.23.0 锁文件刷新及 frozen 安装，退出码 0，移除 Prisma 7 三项直接依赖及 98 个包。原生契约离线生成通过，12 表、85 字段、36 CHECK、20 索引、13 外键、119 注释及存储指纹保持一致。全新专项 28/28、CLI 4/4、React/Vue/NestJS 类型检查、全量 82 文件 966/966 单测均通过。Vite+ 498 格式文件、339 受检文件零错误但存在两条 vitest(no-conditional-expect) 警告。身份绑定专项 13/14，原断言 /缺少已完成/ 与实际“本机业务库未通过 Prisma 8 原生存储标记验证”不一致，ready 退出码 1。维护者已推送锁文件和格式化提交 fb46b1d6710deea055fa90a92b4df97c3a2c73db。
- **根因与修复候选**：原生模型中文注释测试在两个条件分支内直接调用 expect；改为收集声明与前置注释，再在测试主流程断言模型数量及所有不合格声明为空。身份测试未同步旧迁移错误文案；改为精确匹配实际原生标记异常，同时覆盖预览和显式写入的拒绝、回滚、无插入及无提交。仅修改两个测试文件，不更改安全门禁、数据库、依赖或运行时代码。
- **防复发**：每次替换校验机制及中文异常文案必须同步搜索旧文案断言，按当前实际抛出点验证所有调用模式；条件分支只收集数据，测试主流程统一断言，禁止禁用规则或放宽安全断言。检查警告数量，不能把退出码 0 视为零警告。
- **验证边界**：协作环境对当前 PSL 复核 12 模型、122 项模型与属性声明均有中文注释；分别移除模型文档注释和字段文档注释的反例均被收集逻辑识别，实际身份错误文案与拒绝回滚路径已静态核对。Windows 定向测试、Vite+ 零警告、完整 ready 及真实只读原生 Provider 烟测尚待复验，不登记为通过。
- **证据**：PR #250、维护者 Windows 日志、apps/server/src/database/prisma-schema-comments.spec.ts、scripts/oidc-lab-identity.cases.mjs、docs/VALIDATION.md。

> **2026-11-27 · E-160 Windows 复验关闭**：维护者 Windows 已完成 PR #250 最终复验：中文注释 2/2、OIDC 身份 14/14、全新安装 28/28、CLI 4/4、82 个文件 966/966 单测、6 个文件 65/65 HTTP E2E；498 格式文件、339 受检零警告/Lint/类型错误，中文 365 个自有文件、文档 97 份，React/Vue/NestJS 构建通过。React 单个 chunk 591.62 kB 的构建体积警告暂保留。锁文件刷新与冻结安装已通过，移除 Prisma 7 三项直接依赖及 98 个包。真实 PostgreSQL 19 只读 FRESH_PROVIDER_SMOKE_READY，存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436、12 表/85 字段/36 CHECK/20 索引/13 外键/119 注释一致，所有原生根模块及只读标志为 true，最终退出码 0、工作区干净。远端验收提交 dbab7c2a7ca3737e23fd451811aef92981378801，维护者明确授权，PR #250 已 Squash 合并至 feat/mvp-first-integration 的 94106b29b328833d944f35361004411b5a3ddab2。E-160 已关闭。 两个测试文件修复及完整质量链已实测；防复发规则仍保留。

### E-161 · HTTPS 探针误拒绝 SSE 重复 no-store 响应头（局部修复通过，待 Windows 复验）

- **真实现象**：协作环境 Node.js 22.16.0 与真实 Nginx 隔离夹具使用候选共享模板、临时可信 CA/回环 IP SAN 证书及模拟上游；原探针在上游也返回 Cache-Control: no-store 时抛「本机 HTTPS 代理响应异常」。既有模拟服务 headers() 本身就发送 no-store，Nginx 的 SSE location 也追加 no-store，因此不能只比较单条字符串。该问题未在维护者 Windows 实际发生。
- **最小修复**：仅在探针将合并头按逗号拆分、去空白和忽略指令大小写，每个指令必须是 no-store，允许重复但拒绝缺失、public、max-age 或混合策略。不修改模拟服务、Nginx 缓存门禁、TLS、路由或业务数据。新增仓库回归定义覆盖单值、重复、大小写和四类拒绝。
- **验证与防复发**：已实际复现旧探针失败，修复后 Node TLS 六项及真实 Nginx 三项通过，探针 Git Blob 471574addbead49c7c467b1616ce34e3b0548d3b 与本地一致；新增断言与启动相关共八项在 V8 隔离模拟中通过。代理链的响应头可能被合并，须按协议语义校验且保留冲突拒绝。Windows 完整 Docker 22 项、真实七服务 HTTPS 和 Vite+ 零警告仍待验收，不提前关闭本条。

> **2026-11-27 · E-161 Windows 复验关闭**：维护者 Windows 在候选 HEAD 3e677cd2dca74b0d621cb8bed029018f8b5e62a0 实测 Docker 22/22、环境和 LF、中文文案 367 文件、Markdown 97 份、Vite+ 500 格式/341 受检零警告错误、git diff --check、四镜像构建、七服务运行、容器原生只读、双端 HTTP 及宿主 HTTPS 探针均通过，增量与真实验收退出码均 0。正常 Hook 格式化提交 56f48c2f81e9df95f9d97253098abef300ea665d 已推送，远端三文件差异仅 Markdown 围栏及 JavaScript 排版，无业务变化；无审查阻塞或额外远端 CI 记录。经维护者明确授权 PR #252 Squash 合入 feat/mvp-first-integration 的 b1218c0fd290344cf152500b4105e24ee9b29745。E-161 已关闭。日志未包含双端真实浏览器渲染证据，不将其视为浏览器或登录验收。

### E-162 · 独立诊断码被中文文案门禁误识别为英文异常提示（局部复验通过）

- **实际现象**：协作环境 Node.js 22.16.0 对与远端 Blob 3b0b0a862ca3b15018d8fbd04cbb8f1eceb99cd9 完全一致的中文检查器运行最小目录。初稿虽由 OidcProbeError 构造函数生成中文消息，但 19 处 throw new OidcProbeError 的首个字面参数是 INPUT、CA、JWKS_KEYS 等固定机器码，原单行扫描器将其判为缺少中文，退出 1。尚未发生维护者 Windows 失败。
- **最小修复**：将错误类明确区分 message 与 code，由同一 oidcFailure 工厂构造真实中文提示和独立诊断码；所有失败分支的拒绝条件、阶段、代码、异常类型、进程退出值与父进程白名单保持不变。不修改扫描器、不禁用规则、不翻译机器码、不隐藏第三方异常以外的实际失败状态。
- **实际复验与防复发**：修复后真实检查器在十文件最小目录退出 0，Node 语法、TypeScript 5.8.3 局部 JS 类型检查、十项离线门禁及七项真实 Node TLS 夹具全部通过，核心 Blob bcd4a4637a775ffcb213324d6b2a75220198d939 与远端一致。错误类必须明确区分用户可见文案与机器协议状态，新增异常分支应先执行中文检查再交付。局部复验不是全仓文案或 Windows Vite+，完整 35 项和真实 Docker Keycloak 联调仍待验收。

> **2026-11-27 · E-162 Windows 复验关闭**：维护者 Windows 在候选 HEAD f75b7e6fd06f7031b475b62be7b30b0b8f0e8a05 实测 Docker 35/35（编排 25、Keycloak 探针 10），环境/LF、中文文案 370 文件、Markdown 97 份、Vite+ 503 格式/344 受检零警告错误、git diff --check、四镜像构建、七服务运行、容器原生只读、双端 HTTP/HTTPS 及真实宿主与容器 Keycloak Discovery/JWKS 一致性均通过，增量与真实验收退出码均 0。正常 Hook 格式化提交 b74a3fe6b8ac5e2d1b2d4da9dfb2524d4375799d 已核对五文件仅排版；经维护者授权 PR #253 Squash 合入 feat/mvp-first-integration 的 b5378e263962d25883894e3416038472f845f1cb。E-162 已关闭。尚无正式授权码兑换、ID Token 验签或登录会话实测证据。

### E-163 · 正式 OIDC SDK 未显式开启应用层 JWS 签名验证（源码核实，候选待验收）

- **源码核实**：当前锁定 openid-client 6.9.1 / oauth4webapi 3.8.9。上游固定标签 v6.9.1 的 src/index.ts 中 enableNonRepudiationChecks 明确注册 validateApplicationLevelSignature，授权码流程仅在启用时执行该签名检查；OIDC Core 允许直接 TLS Token 响应依赖传输层验证，但项目 ADR-0065 明确要求验签。原 Discovery 服务仅固定 RS256 算法，没有启用此扩展，不能将已通过的公钥探针或历史 Mock 当作签名已验证。此为静态契约缺口，不声称已观察到真实伪造 Token 登录。
- **最小修复**：在既有正式配置完成元数据核验后调用 SDK enableNonRepudiationChecks，保留库的 State、Nonce、PKCE、Issuer、Audience、时间和算法验证，不另行手写 JWT 协议。新增真实 SDK 回归使用临时 RSA 密钥生成合法签名及错误私钥签名，分别断言成功和拒绝且都读取 JWKS；尚需 Windows 安装依赖执行。Docker 特定连接适配固定公开 Issuer、内部 keycloak:8443、可信 CA、TLS IP 身份及路径/方法/请求头门禁，无不安全回退。
- **验证与防复发**：协作环境执行独立适配器六项离线测试及七项实际临时 TLS 测试 13/13，局部 TypeScript 5.8.3 使用固定 SDK 接口最小声明检查通过；未运行实际 SDK 测试、全仓 Vite+ 或真实 Keycloak 正式登录。以后升级 SDK 须同时核对固定版本协议行为和真实有效/无效签名回归，而非只检查签名算法元数据。

> **2026-11-27 · E-163 Windows 复验关闭**：维护者 Windows 实测 PR #254：Docker 编排/只读探针/传输 41/41，Discovery 9/9（含真实 SDK 合法及错误 RSA 签名），Callback 12/12，共 62/62；Vite+ 505 格式文件/346 受检零警告错误、中文文案 372、Markdown 97、NestJS 构建及 git diff --check 通过，增量退出码 0。四镜像构建、七服务、容器原生只读、双端 HTTP/HTTPS、宿主与容器正式 OIDC Discovery/JWKS 通过，真实验收退出码 0。验收起点 d4494ef95e7b8c2aa0af799cfe0b9f68cfdbb20c，Hook 格式化提交 8f517321f2f4d2b10f85e960438f9b6db18f0821 经远端逐文件核对仅排版，无语义变更；维护者明确授权 Squash 合入 feat/mvp-first-integration 的 88024689f43419a01f9008b047643181498b853c。E-163 SDK 验签回归关闭，不代表真实 Keycloak 授权码、登录或写事务已验收。

本次常驻数据库连接候选防复发：E-021 继续区分宿主根环境与 Docker 随机凭据；E-139/E-148 先严格复核新库目录、标记及集群，失败不生成绑定、不启动应用；E-157/E-158 复用正式唯一原生提供方和事务端口；E-107 不在 finally 改写控制流；E-017 固定错误提示不输出凭据。协作环境局部类型检查首次因 Node 类型声明路径未定位而失败，改用已安装声明目录后通过；不是项目源码诊断。V8 编排夹具没有真实 WHATWG URL，明确跳过原 URL 专项，不能记为完整 Docker Node 测试。尚无 Windows 新代码故障证据。

### E-164 · PR #255 默认根模块 HTTP 回归缺少 Vitest 显式断言（E-012 复发）

- **现象**：维护者 Windows 在 de8dc9e07e2fe265658984b7cf6c662830b89db9 执行完整增量验收，Docker 49/49、HTTP E2E 71/71 均通过，vp check 仍报告 apps/server/test/app.e2e-spec.ts:32 的 vitest(expect-expect)，510 个格式文件、351 个受检文件，1 警告 0 错误；退出码 0 不能代替零警告。真实七服务、常驻 Prisma 8 原生只读、双端 HTTP/HTTPS 和正式 OIDC Discovery/JWKS 均已通过。
- **原因**：新增默认根模块隔离回归仅调用 Supertest .expect(404)，没有仓库 Vitest 规则识别的显式 expect，未落实 E-012 已记载的预防措施。
- **最小修复**：保留 GET /health/database 与 Supertest .expect(404)，取得 response 后追加 expect(response.status).toBe(404)，不改变被测路由、期望状态、业务代码或 Lint 规则。
- **验证边界**：修复测试提交 a2829cad1b38b611fcbe1439b1f4fc736744c467，远端 Blob 71eee900f3771ae3cea1d333c0f6a97973f0abbd；回读与预期唯一替换逐字一致，提取实际测试体并模拟 Supertest/Vitest 验证 404 通过、200 与 503 拒绝，3/3。协作环境没有完整项目依赖及 Vite+，真实 E2E 与全仓零警告待 Windows 复验；不宣称问题已关闭。
- **防复发**：每个新增 HTTP 测试必须检查 Vitest 显式断言，并在真实 Vite+ 报告确认零警告，禁止以 Supertest 链式断言、退出码或禁用规则代替。

> **2026-11-27 · E-164 Windows 复验关闭**：维护者 Windows 在 HEAD e7be1b522cf66e507ab7e2af5d83e61d51cb98b6 复验 HTTP E2E 7 文件/71 项、Vite+ 510 格式文件/351 受检零警告、Lint、类型错误、Markdown 97、git diff --check，退出码 0、工作区干净；前一轮 Docker 49/49 与真实七服务、常驻原生严格只读连接、双端 HTTP/HTTPS、正式 OIDC Discovery/JWKS 验收有效。维护者明确同意后 PR #255 Squash 合入 feat/mvp-first-integration 的 1870937aa0c2d77103c06a55f219491a1c87dd34，E-164 关闭。未取得额外远端 CI 运行记录。 本批候选新增测试均使用明确断言；仍需维护者对新提交复验完整 Vite+ 门禁，不得以退出码代替零警告。

### E-165 · Node 原生 assert.throws 正则匹配包含异常名称（PR #256，待 Windows 复验）

- **Windows 实测**：维护者 Core Node 构建、Prisma 8 原生契约离线生成及 NestJS 类型检查通过；Docker 五套件 59/60（新增临时事务 8/8，宿主编排 28/29）。唯一失败位于 scripts/docker-stack.cases.mjs 第 185 行，带首尾锚点的异常正则预期未包含 Error: 前缀，增量退出码 1；HTTP E2E、环境、中文、文档、Vite+ 和真实容器验收未执行。日志未独立打印本地 HEAD，远端原交付 HEAD dbea8ac0f84c5c3066922e0648bc4c35f4d993d2 的对应源码一致。
- **根因**：Node 内置 assert.throws 在直接传入 RegExp 时匹配异常的字符串表示而非仅 message。上轮隔离 V8 自定义断言只匹配 error.message，导致错误未被发现。真实宿主返回的固定脱敏异常文案正确，不是数据库或探针业务故障。
- **最小修复**：仅将该测试的三个机器诊断 expected 改为 name 与 message 的精确对象断言，保持严格数据库失败、执行中止、报告不完整、已知阶段和未知敏感阶段脱敏等原断言及测试总数，拒绝多余文本；不修改生产代码、数据库、容器、依赖或权限。测试修复提交 ea109ccdead21c08bbd7b504873c388637a44113，Git Blob a9136d9c7df17d9fec5ac3c9454aae2e221cf158，提交后全文回读与预期一致。
- **局部实测**：协作环境 Node.js 22.16.0 使用原生 node:assert/strict 和 node:test，对远端实际事务诊断分支（1580 个字符，FNV-1a 1a4c7578）及实际参数化测试循环（891 个字符，FNV-1a 1588db86）提取复现。旧断言失败，错误与维护者日志一致，退出 1；修复后三组诊断通过，附加测试验证文案附加模拟敏感值、错误异常名称、不抛异常均被拒绝，共两项局部测试通过，退出 0。修复循环 990 个字符、FNV-1a bebd0a69，与远端回读一致。使用最小外围夹具，不等于全量 Docker 测试；完整 Windows 60 项、71 项 HTTP E2E、Vite+ 零警告及真实临时事务仍待验收。
- **防复发**：不得使用自定义断言替代原生 Node/Vitest 断言验证实际异常语义；精确异常契约优先使用 name/message 对象；环境受限时直接使用真实运行时的断言进行最小复现。保留错误脱敏负例，不通过移除锚点放宽安全检查。

> **2026-11-27 · E-165 Windows 复验关闭**：维护者 Windows 于 2026-11-27 在 HEAD 47b84f8e2ece8cffebe931013b1cca865dc3cc41 完成两轮增量验收，均退出 0；Core 编译、Prisma 8 原生契约离线生成（databaseAccessed=false）、NestJS 类型检查、Docker 五套件 60/60（独立临时事务模拟 8/8）、HTTP E2E 七文件 71/71、环境及 LF、中文文案 380 文件、Markdown 97 份、Vite+ 513 格式文件/354 受检文件零警告、Lint、类型错误及 git diff --check 均通过。首次增量后工作区干净。存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436，12 表、85 字段、36 CHECK、20 索引、13 外键、119 注释保持一致。 同一候选的四个 Docker 应用镜像构建、七服务启动、容器独立原生只读及常驻连接、React/Vue HTTP 和宿主 HTTPS、宿主与容器正式 OIDC Discovery/JWKS 严格只读验证均通过，常驻只读回归退出 0。OIDC 登录尚未启用。没有真实临时表 DDL/DML、SDK 实际提交/回滚/清理、正式业务写入或浏览器登录证据。 远端 47b84f8e2ece8cffebe931013b1cca865dc3cc41 相较 83ba2f3ba6585691f0f08696e230f2d1de637c73 的五文件差异已核对仅为排版。E-165 已关闭；PR #256 仍保持 Draft，真实临时事务门禁未关闭，不将模拟或常驻只读回归视为写事务验收。

### E-166 · B2 真实角色事务核验错误粒度过粗（PR #259，E-017/E-148 同类复发）

- **实际现象**：维护者 Windows 实测 PR #259：Docker 83/83（角色事务 8/8、事务内目录 2/2），Prisma 8 全新专项 29/29，共 112/112；环境/LF、中文 386 文件、Markdown 99 份、Vite+ 521 格式文件及 360 受检文件零警告/Lint/类型错误、git diff --check 均通过，增量退出码 0。维护者已推送格式化提交 6426a35570f6fd71d5b3baedc5eef44004da2b67，相较 1f009bd683dc28263a6501837e9a02b1e2a5d4f3 的四文件差异已核对为排版。真实 `docker:db:role:bootstrap --confirm-rehearse-docker-roles` 进入角色属性、精确授权及有效权限核验阶段后失败，退出码 1；&& 短路导致独立状态核查未执行。未获得具体 SQLSTATE、断言差异及独立角色状态；不据此宣称数据库层根因已定位或真实演练通过。
- **已确认代码缺陷与最小修复**：最小诊断修复：仅修改 `scripts/docker-db-role-bootstrap.mjs` 及对应 Node 测试。对角色属性、直接 ACL、有效对象权限、有效列权限、切换运行角色、运行角色身份及标记、启动工程读取、恢复管理身份八个固定步骤分别脱敏；仅允许 PostgreSQL 官方白名单 SQLSTATE（未知为 UNKNOWN），精确匹配失败仅报告预期/实际行数、未匹配的固定预期项序号和预期字段名，不回显实际目录名、值、连接串、凭据、SQL 原文或第三方错误正文。失败路径只有收到 ROLLBACK 命令标签才补充回滚确认，回滚未知及提交未知仍拒绝成功、禁止自动重试。原八条 SQL、所有权限白名单、精确匹配条件、确认参数、Compose、业务数据和正式准入均不变；真实根因尚待新诊断证据。
- **复验边界**：协作环境 Node.js 22.16.0 从格式化前已有 Git Blob 精确本地副本应用同一诊断修复，真实 `node --check` 两文件及 `node --test` 10/10 通过（原八项加两项参数化诊断回归，涵盖 12 类故障）。远端使用相同修改保留维护者的既有格式化，新增诊断核心块 3107 个字符/FNV-1a 202e8a23、两个新增测试块 1927 个字符/FNV-1a c8a5594f 与本地实测逐字校验一致；远端两个文件全文回读一致，但本地测试文件整体 Blob 仍与远端存在既有排版差别，不冒称完整最新远端字节实测。核心修复提交 adb3d4d70fe0164e26bb76a2f46be6fde358f4f8、测试提交 edbc67493bef64b7438d6bb3838d7a2ed87b72af。完整 Windows Vite+、中文/文档、Docker 预计 85 项与真实 PostgreSQL 演练未执行。
- **防复发与恢复**：在固定真实数据库事务中，所有关键 SQL 查询及证据断言须具备可区分的脱敏诊断；未知失败保留原拒绝行为，模拟测试不能替代 PostgreSQL 实机。先单独执行 `pnpm run docker:db:role:bootstrap:status` 并检查退出码 0、`rolesPrepared=false`；若已存在角色、状态不一致或失败，停止并保留现场，不删除、不回收权限、不执行创建。再完成定向测试与全仓增量质量复验，只有只读状态明确确认两个角色不存在且质量门禁通过后，才单独重新执行已明确确认的回滚演练；如仍失败，只提供新脱敏诊断，不执行正式创建或反复重试。PR #259 保持 Draft。

> **2026-11-28 · E-166 诊断复验关闭**：维护者 2026-11-28 Windows 于 096f5962c8126646773062ad8f0faf33c746bf7e 实测：演练前角色只读状态退出 0、rolesPrepared=false；Docker 85/85（角色事务 10/10）、Prisma 8 全新专项 29/29，合计 114/114；环境及 LF、中文 386 文件、Markdown 99 份、Vite+ 521 格式文件/360 受检文件零警告、Lint/类型错误及 git diff --check 全通过，增量退出 0。真实演练进入有效对象权限查询后返回 SQLSTATE=42809，并明确报告事务已确认回滚，退出 1；演练后独立只读状态退出 0，rolesPrepared=false、admissionPassed=false、databaseWritten=false、publicConnectRetained=true，存储指纹 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436 不变。维护者随后推送 195194ec103c846b995f3e0a1e8692ec31b3d870，两文件差异核对仅为格式化。E-166 的脱敏分阶段诊断及失败回滚确认已获真实证据，诊断缺陷关闭，但 B2 演练仍未通过。

### E-167 · 混合关系目录权限函数依赖布尔求值顺序（PR #259，待 PostgreSQL 实机复验）

- **实际现象及代码缺陷**：SQLSTATE 42809 是 wrong_object_type。当前有效对象权限 SQL 从含表、索引等多种 relkind 的 pg_class 查询混合关系目录，却依赖 AND/OR 中 relkind 过滤保护类型专用权限函数。依据 PostgreSQL 19 [表达式求值规则](https://www.postgresql.org/docs/19/sql-expressions.html) 与 [访问权限查询函数](https://www.postgresql.org/docs/19/functions-info.html)，优化器可调整布尔表达式求值顺序；官方源码 acl.c 的 has_sequence_privilege_id_id 对非序列 OID 抛出 ERRCODE_WRONG_OBJECT_TYPE。已确认存在该查询缺陷，与实测阶段及错误码一致，但尚无数据库原始错误正文或执行计划来确认具体先执行了哪个函数。最小修复在 effectiveSql 与 effectiveColumnsSql 的表/列、序列及列 SELECT 三处使用 CASE WHEN relkind ... THEN 对应权限函数 ELSE false END，确保仅对适用对象调用函数。保持原关系类型、Schema、权限集合、八条角色准备 SQL、十项直接 ACL、五项列权限及所有精确证据断言不变；不吞掉 42809，不增加授权，不改角色属性、业务数据、Compose、PUBLIC 或服务绑定。
- **复验边界**：协作环境 Node.js 22.16.0 对包含相同修复的已有本地副本执行两文件 node --check 及真实 node:test，11/11 通过；新增用例检查实际传入查询函数的三个 CASE 保护结构，既有参数化负例新增 noSequencePrivileges=false，仍拒绝并确认回滚。将新增测试与未修复查询组合执行，定向旧 SQL 回归按预期 ERR_ASSERTION、退出 1；修复后退出 0。两处 SQL 替换及新增测试块 FNV-1a 分别为 a562a4a6、4a8f5f71、2b7bcccf，与远端新增块逐字节校验摘要一致；本地副本未包含此前全部排版调整，不声称最新远端整体 Blob 已在 Node 实测。远端修复核心提交 324881c3cb36eefdb35345551fb169dc224a872f、测试提交 e28f9fcdaeeac7e7dd053e8a3ef22db6b0cdf8fd，两个文件回读一致。协作环境没有 PostgreSQL/Docker，网络也无法安装依赖，未执行实际 PG 查询；新增离线测试只验证 SQL 结构和模拟负例，不代替真实执行计划或权限语义。
- **防复发**：对 pg_class 等混合目录中的类型专用函数，必须显式 CASE 或使用具有求值边界的关系集合，不能用 AND 的书写顺序假设短路。权限查询负例应保持原范围和拒绝条件；须在真实 PostgreSQL 上执行原生查询。先同步代码并单独运行 docker:db:role:bootstrap:status，确认退出 0、rolesPrepared=false；再运行 test:docker（预计 86 项）、test:prisma8:fresh（29 项）、env/messages/docs、Vite+ 零警告、git diff --check。仅在质量检查及只读状态通过后，独立执行 docker:db:role:bootstrap --confirm-rehearse-docker-roles，确认真实混合目录查询和完整角色演练通过；无论结果如何，再独立运行 docker:db:role:bootstrap:status，确认角色仍不存在。失败保留现场，提供固定脱敏诊断；不执行正式创建，不自动重试、清理或调整权限。PR #259 保持 Draft。

> **2026-11-28 · E-167 真实复验关闭**：维护者 2026-11-28 Windows 于 HEAD b67c230a140d79664620962805fecffd2e18c1be 实测：演练前独立角色状态核查退出 0、rolesPrepared=false；Docker 九套件 86/86（角色事务 11/11）、Prisma 8 全新专项 29/29，合计 115/115；环境及 LF、中文文案 386 文件、Markdown 99 份、Vite+ 521 格式文件及 360 受检文件零警告、Lint 和类型错误、git diff --check 均通过，退出 0，工作区干净。随后真实 PostgreSQL 19.0 回滚演练返回 DOCKER_DB_ROLE_BOOTSTRAP_REHEARSED、catalogStatementsExecuted=true、rolledBack=true、committed=false、rolesPrepared=false、directoryReviewPassed=true、postVerificationPassed=true、admissionPassed=false、databaseWritten=false、businessDataWritten=false、serviceSwitched=false、publicConnectRetained=true，退出 0；演练后独立状态核查返回 DOCKER_DB_ROLE_BOOTSTRAP_STATUS_READY、rolesPrepared=false，退出 0。存储指纹始终为 9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436。E-167 对象类型保护修复通过真实完整演练，关闭；无需再次改动已验收 SQL。 原始失败时具体先被求值的函数未从数据库错误正文或执行计划单独取证；关闭依据为修复后的真实完整演练，不把离线 SQL 结构测试当作真实数据库测试。正式持久化提交尚未执行。

### E-168 · 例程配置数组与角色报告形状不一致（PR #262，局部修复待真实复验）

- **源码审查现象**：基线 321646adcf73fd311929b6e7797fcc68deabf8e9 的例程目录 SQL 使用 jsonb_build_array(..., p.proconfig)，但统一 evidence 校验只接受 null、字符串、布尔值，故合法配置数组会被拒绝；其固定锁角色测试访问 report.roles，但输出未返回该字段，且角色属性未拒绝已有锁角色 LOGIN=true。另仅匹配 search_path=pg_catalog, public 未显式排除临时 Schema 的隐式优先搜索，不能标为安全例程。以上为源码与现有测试夹具对照确认，未执行旧版完整测试或真实数据库复现。
- **修复及防复发**：仅例程配置槽允许 null/有界字符串数组；固定运行及可选锁角色的七个高权限/登录/继承布尔值必须均为 false，输出固定名称和属性，不回显 OID。将安全计数改为精确配置匹配计数：pg_temp 显式置末尾、row_security=on 两项匹配，始终 definerSafetyVerified=false；还须验证 Schema 可写主体、函数体、所有者和 PUBLIC EXECUTE。不因目录形状修复而开放权限。依据 [PostgreSQL SECURITY DEFINER](https://www.postgresql.org/docs/current/sql-createfunction.html)。
- **复验**：修复后的远端对象评审模块/测试 Git Blob 71e1e6d2c7ce3edbb73d605057752fe3f8e4016b / 87502ea5630446595be0a7e34db7f87c91b43973 与本地完全一致；Node.js 22.16.0 语法检查退出 0、独立目录夹具 7/7 通过（外围连接依赖替身未调用）。真实 PostgreSQL 查询与完整质量链未执行，保留真实复验门禁。

### E-169 · 候选 Blob 创建与实际分支提交、测试证据混淆（PR #262）

- **现象**：上一轮协作中途报告新增锁例程测试 5/5，但当轮未取得实际 Node 运行记录，且仅创建两个 Git Blob、未生成提交或更新 Draft 分支。上一轮最终回复已纠正，未计入正式验收；这是协作交付记录问题，不是 PostgreSQL 实测故障。
- **复验与防复发**：本轮取回原 Blob，使用 Node.js 22.16.0 执行实际语法检查及独立 `node --test`，五项通过；按 E-142 预防规则补齐字符串排序比较器后再次运行五项通过。模块 SHA 8da25f8e87df69061c12a0d9e697908d857997b2，最终测试 SHA 8cb34e74c2ad3b8b7dd970a70cd7dfbaaef92be2。必须通过 Git Tree、Commit、非强制 ref 更新与 PR HEAD 回读，才能报告已提交；实际测试必须与最终 Blob 对应，不能将候选 SQL 文本或模拟结果视为真实数据库执行。全仓检查及真实 PostgreSQL 仍待验收。

### E-170 · 局部测试文件中文占位符替换误扫历史 PSL 对照测试（PR #262）

- **现象**：协作容器编写 B4 前置模块/测试时，临时生成脚本对局部目录所有 `.mjs` 用 `@@` 检查未替换占位符；已有真实 PSL 对照测试本来包含 `@@map`，导致转换中途 AssertionError。初次 Node 新专项 4/6，两项错误文案断言仍为占位符。并非 PostgreSQL、正式业务或真实授权故障。
- **修复与防复发**：将替换严格限定为本次新增测试文件及具体占位符，不扫描、替换既有协议标识，不删减错误文案精确断言。核对原三组代码、测试和 PSL 的 Git Blob 均未改变。临时文件生成脚本应使用固定目标路径并在失败时停止后续测试，不能以生成步骤失败后的部分测试结果声称全绿。
- **复验**：修复后新专项 6/6，补强检查及集成测试后的实际 Node 22.16.0 四组专项 23/23、零失败零跳过；最终新增模块/测试 SHA 7f17038c8c7107cd6b5a7a2b9805345afbb9ed99 / 3fb963c721c2bc3b752d4a25d4008ed99d07e597，与远端实际 Blob 一致。未执行全仓质量链或真实 PostgreSQL，B4 安装未验收。

### E-171 · 回滚演练测试文件压缩传输完整性失败

- **现象**：2026-11-28，本地七组 B4 Node 测试 48/48 后，上传新增测试文件时压缩传输解码报 `invalid match`；没有生成错误 Blob，也没有修改远端分支。
- **修复与防复发**：改用原始源码直接传输，核对远端 Blob SHA 与本地已实测文件完全一致（`1a885a31670c27d47fc90f0b5d6282628e287ad1`）。以后任何传输/解码失败必须先停止提交，复核原始字节与 Git Blob，不能用手工推测的内容替代已验证文件。
- **复验边界**：本次为协作交付链异常，不是 PostgreSQL 或业务故障；原 48 项本地回归证据不变，真实数据库与完整质量链仍未验收。

### E-172 · 只读 SQL 断言误把 GRANT OPTION 查询当成授权语句

- **现象**：2026-11-28，新 Keycloak 目录预览专项首次实际 Node 22.16.0 运行 6/7，唯一失败为只读 SQL 形状断言。查询含 `has_database_privilege` 的合法权限参数 `CONNECT WITH GRANT OPTION`，旧正则只查找 `GRANT ` 子串而误判存在写入授权。
- **修复与防复发**：测试按语句起始边界拒绝 ALTER TABLE、GRANT、REVOKE、REASSIGN OWNED 和 DROP OWNED，保留两条固定 WITH 目录查询、权限参数与所有安全断言；不删除权限查询或改写 SQL 以迁就测试。增加真实对象身份尚未审核的报告断言，复验 7/7，零失败零跳过；最终模块和测试 Blob 分别为 `9cd850423014786a6a4a39b63c6fce50c9e57299` / `83a8086204cddf44a9e61862b2b16488f44acabf`，与远端代码提交一致。测试 SQL 读写边界应检查语句命令及完整参数，不把权限名称或字符串常量当作 DDL。静态正则断言不是实际数据库语法或权限执行证明。
- **边界**：此为离线测试匹配缺陷，未在真实 PostgreSQL 执行任何语句；完整质量链、真实对象身份、权限和回滚仍待验收。

### E-173 · SCADA 回滚后原连接关闭失败仍尝试独立复核（PR #262，待组合实测）

- **源码审查现象**：原 runScadaB4RollbackRehearsal 只依据 rolledBack 开启独立连接；即使 client.end() 抛错也继续读取目录及宿主，虽然最终会失败，却违反原连接关闭明确后才允许独立核验的约束。未取得真实 PostgreSQL 故障记录。
- **最小修复**：记录 closed 仅在 end 成功后为 true；独立复核及成功返回均要求 rolledBack && closed，保留原回滚标签、禁止重试及脱敏诊断。新增 Node 回归要求关闭失败时只创建一条连接、仅一次宿主核验、无独立连接及 COMMIT；代码提交 cd4bbc47c5ab452d48fe20b3fc0bb9cda5805174，尚未实际执行该组合 Node 用例。
- **防复发**：独立连接前逐项核验原事务完成标签和原连接关闭证据，失败不得继续尝试或误报独立核验；模拟回归与真实数据库证据分开。全质量链及真实复验仍待集中验收。

### E-174 · 拼接英文首段触发中文异常检查，交互式验收未整体停止（PR #262）

- **维护者实测**：HEAD fc658f8336de1def3169746e151c8139a1c7d7e8，Windows Node 24.18.0、pnpm 12.23.0；冻结安装、依赖/配置/环境/LF 检查通过，ready 在 scripts/docker-db-role-keycloak-plan.mjs 第 183、306 行中文检查失败（2 处，退出码 1）。PowerShell 逐条粘贴在 throw 后仍执行后续 Write-Host，不能将其视为成功证据。Docker 七服务运行、PG 19.0 严格契约（12 表/85 列/36 检查/20 索引/13 外键/119 注释）及正式 Discovery/JWKS 只读检查通过；B3.3 状态 catalogIsolationPersisted=false、publicConnectRetained=true，两库计划按设计拒绝，SCADA 演练因无指纹未执行。
- **最小修复**：仅将两个 DockerKeycloakOwnershipError 的拼接字面量改为单个模板字符串，实际异常文案、固定阶段、脱敏及权限逻辑不变，不改扫描器或测试期望。使用一个完整 PowerShell 脚本块执行阶段，失败抛错后不得继续下一个阶段或打印成功。B3.3 未持久化是独立审批门禁，不放宽、不自动执行。
- **复验边界**：协作容器 Node 22.16.0 使用原检查器 Git Blob 3b0b0a862ca3b15018d8fbd04cbb8f1eceb99cd9 在七文件最小夹具复现两处失败（退出码 1），替换两行后退出码 0，夹具语法检查退出码 0。对完整远端目标源码应用原异常匹配规则，前两处、后零处，确认仅 183/306 行变化。修复后完整 messages:check、ready、组合 Node 和原生仓储 Vitest 未执行；不宣称已通过。不写数据库，不切换角色或服务，不合并。

> **2026-11-28 · E-174 Windows 复验**：维护者在 HEAD 8e00b77d61b2a9cbe3e10b4f343e92398ae2f0fa 实测中文文案 428 文件、专项 2/2 通过；完整 ready 继续到 Prisma 8 专项 31/33 后退出 1（见 E-175）。本轮 PowerShell 整块在失败后停止，未进入数据库操作。E-174 的中文文案及脚本停止边界已有实测证据，完整质量链仍未通过。

### E-175 · B4 持久化入口新增后原 CLI 拒绝断言未同步（PR #262）

- **维护者实测**：HEAD 8e00b77d61b2a9cbe3e10b4f343e92398ae2f0fa，中文文案 428 文件、专项 2/2、原生契约生成通过（databaseAccessed=false）；test:prisma8:fresh 33 项中 31 通过、2 失败，ready 退出 1。scripts/prisma8-fresh-install.cases.mjs 第 325、339 行对不完整的 SCADA/Keycloak apply 仍要求旧通用诊断 /必须明确指定/u，新专用解析器正确拒绝并返回“B4 持久化或状态命令必须完整明确指定确认参数”。本轮未进入 Docker 与 B3.3 核验，无新增数据库写入证据。
- **最小修复**：仅修改该 CLI 测试文件，保留所有原非法参数拒绝用例；对两条不完整 apply 单独精确断言专用诊断，改正旧测试名称；新增顶层 freshAction 分派回归，覆盖两个独立持久化动作、两种明确安装阶段及双连接探针，逐项删除确认参数/指纹、附加 commit、非法阶段和无效指纹均拒绝。不修改生产解析器、数据库逻辑、门禁及测试脚本配置。
- **实际局部复验**：协作容器 Node.js 22.16.0 从当前仓库提取真实 freshAction 函数及其依赖的固定定义、原两项测试和最终三项测试；完整专用参数模块及五项测试 Git Blob 分别为 762e8ec97e9b3a77cf75242f6c558f25f4e486d1、45be64355f6b56bd30438c9a977a862b55cbf053，与远端一致。原两项真实 Node 复现 0/2、退出 1；修复后的三项片段与五项专用参数测试 8/8、零失败零跳过，退出 0；片段语法检查通过。该验证未运行完整原生契约测试文件或全仓；正式 test:prisma8:fresh 目标 34 项，完整 ready、Vite+、文档和实机仍待验收。最终完整测试候选 Blob a0ce694eec42ac832dd9841a4ac5da543f8d1b29；远端差异仅原两项及新增一项测试范围。增加 CLI 动作时同步审查所有顶层分派及旧拒绝断言，不能仅通过新专用解析器测试就宣称集成通过。保持 Draft，不实际授权或切换服务。

> **2026-11-28 · E-175 Windows 复验关闭**：维护者在 HEAD b67101a482df729ceb68f479178135bc3fb4dd75 实测 Prisma 8 34/34、B4 参数 5/5、Prisma CLI 4/4、中文文案 428 文件，Core Node 构建通过。完整 ready 在格式化门禁失败，随后正常 Hook 格式化提交 5b8ca25c7d76090f4f3e5d3080f4882eaf81d519 已推送；仍有七项 Lint 警告，见 E-176。E-175 两项原 CLI 回归关闭，不代表完整质量链通过。

### E-176 · B4 异构数组推断与夹具未使用绑定触发类型感知 Lint（PR #262）

- **维护者实测**：HEAD b67101a482df729ceb68f479178135bc3fb4dd75 的 ready 到 Vite+ 格式检查时失败，56 文件格式问题；vp check --fix 完成格式化后 402 个受检文件零错误、7 警告：隔离夹具三个故意丢弃的字段未使用、原生例程测试异构数组的 name 字符串化、权限目录检查异构数组的 step 三处字符串化。维护者推送格式化提交 5b8ca25c7d76090f4f3e5d3080f4882eaf81d519；再次运行旧 HEAD 验收脚本在版本门禁停止，未执行数据库阶段。
- **最小修复**：隔离夹具三个故意丢弃字段绑定为下划线开头的局部变量；原生例程九个测试项及安装后五个目录检查项分别由异构数组改为具名对象，明确字符串字段，保留顺序、SQL、参数、预期行、断言和诊断。不关闭规则、不调整权限范围。对三个完整候选文件逐一反向还原后与父提交原文完全相同，核实变更范围。
- **实际复验及防复发**：协作容器 Node.js 22.16.0 实际执行完整原生例程测试 5/5、零失败零跳过；测试、原生例程及文本事务端口本地 Git Blob 分别为 02cc205944b68213ec935c19d12df0e6beef6b07、3f0f00be7394ba6f1ad3c4fc9a1285eef78098b0、a85164e465f0a1fed66ea2494c42034b4744c638，与远端候选一致。容器无法解析 GitHub 域名，缺少 pnpm/vp，未执行完整隔离/目录测试或 Vite+。异构 JS 用例优先具名对象，故意丢弃的解构字段遵循 Lint 命名；格式化提交后验收固定实际远端 SHA，不能复用旧 SHA，也不删除版本门禁。维护者自动修复提交含排版及部分测试字符串判断改写，未完成全文件语义等价证明。全仓质量及 B3.3/B4 实机仍待验收，不实际授权、切换身份或合并。

> **2026-11-28 · E-176 Windows 复验关闭**：维护者在 HEAD c1b48b6ee80d109ab18945e0edb66db9736aa110 实测三组 B4 专项 26/26，Vite+ 564 格式文件、402 个受检文件零警告、Lint 或类型错误；完整 ready 继续通过中文、Prisma 8、Core 构建及双端与服务端类型检查，单测 962/969 后退出 1（见 E-177）。E-176 已关闭，完整质量链仍未通过。

### E-177 · B4 身份行锁替换遗漏既有会话 Guard 模拟查询（PR #262，E-047 同类复发）

- **维护者实测**：HEAD c1b48b6ee80d109ab18945e0edb66db9736aa110，B4 定向 26/26、Vite+ 564 格式/402 受检零警告错误、中文 428 文件、Prisma 8 34/34、CLI 4/4、Core 构建、双端/共享包/服务端类型检查通过。完整 ready 在全量单测 81/82 文件、962/969 用例处退出 1。七项失败集中于 apps/server/src/auth/scada-identity.spec.ts，依赖会话签发的测试报告脱敏 ServiceUnavailableException，未知租户测试期望 ForbiddenException。后续 Docker 专项、HTTP E2E、B3.3 与 B4 真实数据库阶段未执行。
- **根因和最小修复**：正式 Prisma8SessionOperations 已使用 lockB4Identity 的固定参数化 SELECT status FROM public.scada_lock_identity 例程；旧 makeSessionService 模拟仅识别 FROM public.scada_identities，触发未预期查询错误并由正式事务端口脱敏。仅修改该测试夹具，精确匹配新例程 SQL 及两项类型转换，原租户、主体、状态联合筛选不变；原拒绝用例追加未知主体与零会话写入断言。不修改生产仓储、SQL、异常语义、权限或其他测试。检查现有 auth spec 与 server test 共 15 个文件，未发现另一处同样的直接身份表查询匹配；正式 E2E 尚未实际执行。
- **实际局部验证**：协作容器 Node.js 22.16.0 使用真实签发逻辑、nativePort、模拟 query/execute 源码片段（FNV-1a 分别为 99b34979、6db4b27a、57e780fe、db75177d，与远端提取逐字校验一致），完整原生例程和文本事务端口本地 Blob 3f0f00be7394ba6f1ad3c4fc9a1285eef78098b0、a85164e465f0a1fed66ea2494c42034b4744c638 与远端一致；NestJS 异常采用最小替身，另组装模拟事务与 Node 测试。旧条件 1/5（退出 1），修复后 5/5（退出 0），覆盖签发仅保存摘要、跨租户/未知/非法/禁用主体拒绝且零写入。不是原完整 Vitest 文件实测。候选测试 Blob 88e4045442f5b83bc9ae23c870b297977df55399，经反向还原仅目标三处变更。完整身份 14 项、全量 969 项及后续 ready 仍待维护者复验。
- **防复发**：SQL 表访问替换为固定例程时，同步检索所有模拟查询路由、HTTP 装配及旧字符串断言；保留原拒绝和不写入断言。不能将新版专项通过替代所有复用旧夹具的全量测试；不得把 Mock 失败当作真实 PostgreSQL 或权限失效证据。保持 Draft，不实际授权或合并。

> **2026-11-28 · E-177 Windows 复验关闭**：维护者在 HEAD ac056982cf5a3d4221a25fdea8997bcd00086aa9 实测身份四组 49/49（其中原失败文件 14/14）、Vite+ 564 格式/402 受检零警告错误，完整单测 82/82 文件、969/969 用例通过。ready 继续至 Docker 专项 221/222 后退出 1，见 E-178。E-177 关闭；未执行后续真实数据库阶段。

### E-178 · 双库报告脱敏断言误匹配合法对象审阅标志（PR #262，E-172 同类）

- **维护者实测**：HEAD ac056982cf5a3d4221a25fdea8997bcd00086aa9，身份专项 49/49、Vite+ 564 格式/402 受检零警告错误、中文 428 文件、Prisma 8 34/34、CLI 4/4、Core 构建与双端/共享包/服务端类型检查、全量单测 82/82 文件及 969/969 用例通过；报警 5/5、SSE 客户端 8/8、故障代理 5/5、OIDC 代理 10/10、Lab 准备 6/6、身份预绑定 14/14 通过。Docker 专项 221/222，唯一失败为 scripts/docker-db-role-keycloak-plan.cases.mjs 第 928 行双库投影脱敏断言，ready 退出 1；其后 Docker DB、HTTP E2E、文档、构建与 B3.3/B4 实际数据库阶段未执行。
- **根因和最小修复**：原 doesNotMatch 对 JSON 整体查找 objectId 子串，合法安全状态键 objectIdentityReviewed 也被命中。报告实际返回该标志 false。只修改该断言，将 objectId 限定为完整单词边界，保持 kc_fixture、databasechangelog、ALTER TABLE 检查，增加 objectIdentityReviewed 必须为 false 的独立断言。保留双库独立查询、依赖数量、指纹、其他未准入标志、原 SQL 检查及所有负向用例，不修改生产报告、权限、数据库或审批门禁。
- **实际局部复验**：协作容器 Node.js 22.16.0 使用维护者日志中完整真实 JSON 与 node:assert/strict、node:test 复现原断言 0/1（退出 1）；修复后 7/7（退出 0）：原报告接受，注入嵌套 objectId 键、独立 objectId 文本、夹具名、内部表名、ALTER TABLE 语句，以及将审阅标志改为 true 的六个反例均拒绝。GitHub 目标文件反向还原与原文完全一致；这是实际报告样本的断言级复验，不是完整 Keycloak 专项或真实数据库实测。协作容器无法解析 GitHub 域名，缺少 pnpm/vp；完整 Docker 目标 222/222、Windows Vite+ 与 ready 仍待执行。
- **防复发**：脱敏断言必须区分完整敏感标识与合法报告状态字段；对禁止泄漏的实际键、文本与 SQL 分别保留负向验证，不删除安全标志或通过改生产报告绕过测试。不得将模拟目录成功视为实际权限或 Schema 演进验收。保持 Draft，未实际隔离、授权、切换服务或合并。

> **2026-11-28 · E-178 Windows 复验关闭**：维护者在 HEAD df3737688f49c6ad9102b6d6c13df29dc7eb6c61 两次实际通过 Docker 专项 222/222（零失败零跳过），Vite+ 564 个格式文件、402 个受检文件零警告错误，全量单测 82/82 文件、969/969 用例，HTTP E2E 7/7 文件、71/71 用例，Markdown 100 份及 React/Vue/NestJS 构建。完整 ready 通过：维护者的整块脚本继续完成 git diff --check、B3.3 状态与计划并打印结束标志，工作区无变更。React 构建存在 591.62 kB 分块体积提示，不等于 Lint 警告，不阻塞本轮构建。E-178 关闭。真实只读隔离计划通过不代表实际隔离，消费者审阅、真实回滚演练及独立持久化仍待执行。
