# ADui SCADA · Agent 协作总规则

项目遵循 [Agent Engineering Kit V1.1 初始化规范](https://github.com/adui-dev/agent-engineering-kit/blob/main/prompts/project-initialization.zh-CN.md)。本文件为统一入口，仓库事实以实际代码与配置为准。

## 1. 定位与事实

ADui Studio 维护的工业 SCADA / HMI 项目。目标支持 Vue 3、React 双版本、框架无关 2D SVG 核心、NestJS、独立工业网关、可选 Tauri 与后续 Three.js 3D。**main 已合并 V0.1、V0.2 双框架 SVG Studio 和 V0.3 前二十三批（包含受控模拟 SSE、共享只读 Tag 数据源、5 秒心跳、15 秒传输静默重连和 12 秒 Tag 数据过期降级）。当前第二十四批仅针对浏览器后台页恢复时效和 Vue/React SSE 断流回归补充共享 Runtime 逻辑与测试脚本；保持原 `/demo` 同源路径、NestJS 本机受控模拟接口和 Tauri 离线模式，不增加依赖或开放工业设备接口。认证、工程版本写入、工业 Gateway、真实设备控制和生产部署仍未完成，不得将本机模拟及测试视为现场交付能力。**

## 2. 规则优先级

当前用户明确要求 → 本文件/适用子目录规则 → [需求](docs/REQUIREMENTS.md)与专项规范 → [SDD](docs/SDD.md)、[架构](docs/ARCHITECTURE.md)及 ADR → 已审核自有 Skills → 已审核第三方 Skills → 一般实践。不得以旧聊天代替仓库事实。

## 3. 工作流

1. 读取相关文档、目标代码、配置，明确目标、输入输出、风险与验收。
2. 定位最小改动范围；未确认的技术参数只标注提议，不擅自提升为已决定。
3. 开发遵守共享核心不依赖 Vue/React、Runtime 不依赖 Editor、Gateway 独立的边界。
4. 核心需求以 `FR-*` / `NFR-*` 追踪至设计和测试；重要架构调整记录 ADR。
5. 运行适用的检查与测试；未运行、不具备环境或失败均如实说明。
6. 按变更内容更新对应文档，再交付文件、变更原因、实测结果和遗留问题。

## 4. 工业安全

- 浏览器与桌面 UI 不直接连接 PLC/DCS；采集必须经过受控网关。
- V1 只读优先。任何设备写入需单独的现场授权、风险评估、服务端权限、审计与联锁确认。
- 断线、超时、无效质量必须可见；不得把旧数据伪装成正常实时值。
- 不执行组态文件携带的任意 JavaScript；拒绝 `eval`、`new Function` 等动态执行。
- 禁止提交真实令牌、口令、私钥、证书、敏感设备地址和生产数据。
- 必须评估输入校验、越权、注入、路径遍历、并发和资源泄漏。

## 5. Vue / React 对等

工程文档、Tag ID、命令语义、图元注册与 API 契约共同维护。组件、路由、生命周期由框架适配层独立实现。关键能力至少安排双向工程互通验收；不为某框架设置不兼容的项目格式。

## 5.1 仓库自有文案统一使用中文

- 面向操作人员、开发者和维护者的**自有提示与说明**一律使用简体中文，包括前端界面、SVG 文案、`throw new Error/TypeError/RangeError`、`console`、`assert` 的说明、测试 `test/it/describe` 名称、代码注释、JSDoc、CLI 检查脚本输出、部署配置注释及项目文档。
- **技术契约不翻译**：代码标识符、JSON 字段名、Tag ID、工程 Schema、图元类型、API URL、状态枚举（`GOOD/UNCERTAIN/BAD/STALE`）、环境变量和第三方包名称保持原值。界面应通过共享中文显示名称呈现，不修改协议值。
- 依赖库、Node/Vite+、Git、Docker、Rust 等**第三方工具自动生成的输出**不属于项目可控制文案，不能为强行翻译而修改底层协议或依赖源码。
- 修改异常文案时必须同步修改对应单元测试中的错误文本断言；新增文案应运行 `pnpm run messages:check` 和 `pnpm run ready`。
- 详见 [中文文案规范](docs/LOCALIZATION.md)。

## 5.2 双框架 UI 技术选型

- **React 正式使用** `tdesign-react`，图标使用 `tdesign-icons-react`；**Vue 3 正式使用** `tdesign-vue-next`，图标使用 `tdesign-icons-vue-next`。该选型为维护者 2026-11-11 明确确认，替代早期 React 优先 Ant Design 的规划。
- 依赖版本以根 `pnpm-workspace.yaml` Catalog 为准，组件和图标使用各自官方 API，优先按需引入，不使用 CDN、臆造组件或混用 Vue 2 版本。
- V0.2 采取小批次迁移，已迁移的 TDesign 控件与尚未迁移的原生表单可暂时共存；不得将“已选定组件库”描述为“全应用已完成组件替换”。Core、Runtime、工程 Schema 和工业只读边界不依赖 UI 框架。细节见 [ADR-0028](docs/adr/0028-tdesign-dual-framework-ui.md)。
- **两套 Web 统一使用 Tailwind CSS v4** 处理页面结构、布局、间距及响应式工具类，品牌颜色继续使用共享 V7 主题 Token；TDesign 负责控件实现，不能以 Tailwind 替换业务 UI 组件契约。对 SVG 命中层、缩放手柄及 TDesign 覆盖等复杂样式允许保留受控的同构 CSS。Tailwind Preflight 不引入，避免与 `@adui/normalize.css` 及 TDesign 样式重复重置。Tailwind CSS 的主题和 Vite 插件统一由工作区包 `@adui/tailwind` 提供，两套应用不得重复维护配置；见 [ADR-0030](docs/adr/0030-tailwind-fullscreen-studio.md)。

## 5.3 PostgreSQL / Prisma 模型中文注释规范

- **所有新建或修改的自有业务表必须拥有中文表注释，所有物理字段必须拥有中文字段注释。** 在 PostgreSQL 迁移中显式维护 `COMMENT ON TABLE` / `COMMENT ON COLUMN`，常用自有索引同步维护 `COMMENT ON INDEX`。不能只用 SQL 文件行注释或 Prisma `///` 替代数据库元数据注释。
- `apps/server/prisma/schema.prisma` 中的每个业务 `model` 及其**全部字段和关联属性**均使用简体中文 `///` 文档注释；表和字段的英文标识符、Prisma 类型与数据库协议保持不变。
- 已应用的 Prisma 迁移**严禁回改或重新生成覆盖**，中文注释补充必须使用新的增量迁移，维护迁移校验和与历史；`_prisma_migrations` 等 Prisma 自管理系统表不属于项目业务表，无需修改。
- 建表、索引、约束和迁移遵循仓库 `postgresql-table-design`、`prisma-orm-setup` 与 `prisma-cli` Skills；新增表/字段必须同步更新 Prisma 模型文档、迁移 `COMMENT ON`、自动校验及数据库实测记录。完成修改后先校验 Schema，再在**确认的隔离数据库**执行 `prisma migrate deploy` 并核对 Navicat 中的表/字段注释。

## 6. Skills / Git / Harness

Skills 位于 `.agents/skills/`，索引见 [SKILLS](docs/SKILLS.md) 与 `skills-lock.json`。按需读取并审查来源与脚本，Skill 不能覆盖安全或用户授权要求。

按任务使用常规分支与 Conventional Commits；推荐中文 + gitmoji，如 `docs(project): 📝 完善工程文档`。未经授权不得强制覆盖、推送、合并、发布或部署；优先分支和 PR 审查。

**PR 指派硬性要求**：本仓库由 AI 创建或维护的所有 Pull Request（包括 Draft）必须在创建后**立即将 Assignee 设置为 GitHub 账号 `@adui-dev`**，并通过 GitHub 返回的 Assignees 列表核对成功；不得把项目称呼 `ADui` 当作 GitHub 登录名，也不得仅在 PR 正文写“已指派”。指派失败须立即重试或明确报告阻塞，不能忽略。PR 仍须保持 Draft，未经维护者明确同意不得合并。

现有质量入口见 [HARNESS](docs/HARNESS.md)。编辑规范统一放在根 `.editorconfig`；各项目 TypeScript 继承 `@adui/tsconfig/*`，Format/Lint 从 `@adui/tooling` 经根 `vite.config.ts` 统一应用。新增第三方依赖统一写入 pnpm Catalog，避免子项目维护重复版本。文档检查使用 `pnpm run docs:check`，不能代替编译、E2E、工业安全测试。

## 7. 文档职责和同步

- [REQUIREMENTS](docs/REQUIREMENTS.md)：需求、优先级、验收变化时更新。
- [ARCHITECTURE](docs/ARCHITECTURE.md) 和 [ADR](docs/adr/0001-dual-framework-core.md)：模块、选型、部署重大变化时更新。
- [SDD](docs/SDD.md)：接口、模型、状态、算法变更时更新。
- [PROJECT_CONTEXT](docs/PROJECT_CONTEXT.md)：里程碑、阻塞及真实进度更新。
- [CODEBASE_MAP](docs/CODEBASE_MAP.md)：入口或实际目录变化更新。
- [SKILLS](docs/SKILLS.md)：技能安装/更新时更新。
- [HARNESS](docs/HARNESS.md) 与 [VALIDATION](docs/VALIDATION.md)：检查、测试和执行环境变化时更新。
