# ADui SCADA · Skills 索引

> 以当前 `main` 的 `skills-lock.json` 与 `.agents/skills/` 为准。已安装不代表脚本和第三方来源自动可信；所有操作仍须服从 [AGENTS](../AGENTS.md)。

## 第十批选用原则

本批自建 PostgreSQL + Prisma ORM 7，重点阅读 `prisma-orm-setup`、`prisma-cli`、`postgresql-table-design`、`nestjs-best-practices`、`pnpm`，后续编写 PrismaService 和事务时再读取 `prisma-client-api`。

Prisma Postgres 云服务、Compute 与升级兼容技能并非自建 PostgreSQL 所需；`prisma-database-setup` 为已废弃兼容入口。考虑到未来任务及外部引用未核实，**本批不批量删除技能或改写锁文件**，如需清理应另外审查引用、许可与依赖。

## 已安装 Skills（37 个）

| Skill | 入口 | 当前用途 / 状态 |
| --- | --- | --- |
| `conventional-branch` | [SKILL.md](../.agents/skills/conventional-branch/SKILL.md) | 按任务选择，尚未专项审核 |
| `conventional-commit` | [SKILL.md](../.agents/skills/conventional-commit/SKILL.md) | 按任务选择，尚未专项审核 |
| `create-adaptable-composable` | [SKILL.md](../.agents/skills/create-adaptable-composable/SKILL.md) | 按任务选择，尚未专项审核 |
| `create-readme` | [SKILL.md](../.agents/skills/create-readme/SKILL.md) | 按任务选择，尚未专项审核 |
| `git-commit` | [SKILL.md](../.agents/skills/git-commit/SKILL.md) | 按任务选择，尚未专项审核 |
| `github-issues` | [SKILL.md](../.agents/skills/github-issues/SKILL.md) | 按任务选择，尚未专项审核 |
| `github-release` | [SKILL.md](../.agents/skills/github-release/SKILL.md) | 按任务选择，尚未专项审核 |
| `gitmoji` | [SKILL.md](../.agents/skills/gitmoji/SKILL.md) | 按任务选择，尚未专项审核 |
| `nestjs-best-practices` | [SKILL.md](../.agents/skills/nestjs-best-practices/SKILL.md) | 第十批辅助：NestJS 安全与服务层 |
| `pinia` | [SKILL.md](../.agents/skills/pinia/SKILL.md) | 按任务选择，尚未专项审核 |
| `pnpm` | [SKILL.md](../.agents/skills/pnpm/SKILL.md) | 第十批核心：Catalog 与锁文件 |
| `postgresql-optimization` | [SKILL.md](../.agents/skills/postgresql-optimization/SKILL.md) | 按任务选择，尚未专项审核 |
| `postgresql-table-design` | [SKILL.md](../.agents/skills/postgresql-table-design/SKILL.md) | 第十批核心：PG 表与索引 |
| `prisma-cli` | [SKILL.md](../.agents/skills/prisma-cli/SKILL.md) | 第十批核心：Prisma CLI/Migrate |
| `prisma-client-api` | [SKILL.md](../.agents/skills/prisma-client-api/SKILL.md) | 后续：查询与事务 API |
| `prisma-compute` | [SKILL.md](../.agents/skills/prisma-compute/SKILL.md) | 非本期：Prisma Compute |
| `prisma-database-setup` | [SKILL.md](../.agents/skills/prisma-database-setup/SKILL.md) | 兼容旧名：已由 prisma-orm-setup 替代 |
| `prisma-driver-adapter-implementation` | [SKILL.md](../.agents/skills/prisma-driver-adapter-implementation/SKILL.md) | 按任务选择，尚未专项审核 |
| `prisma-orm-setup` | [SKILL.md](../.agents/skills/prisma-orm-setup/SKILL.md) | 第十批核心：Prisma 版本/环境配置 |
| `prisma-postgres-setup` | [SKILL.md](../.agents/skills/prisma-postgres-setup/SKILL.md) | 非本期：托管云数据库接入 |
| `prisma-postgres-upgrade` | [SKILL.md](../.agents/skills/prisma-postgres-upgrade/SKILL.md) | 非本期：已有托管 PG 升级 |
| `prisma-postgres` | [SKILL.md](../.agents/skills/prisma-postgres/SKILL.md) | 非本期：Prisma 托管云数据库 |
| `ui-ux-pro-max` | [SKILL.md](../.agents/skills/ui-ux-pro-max/SKILL.md) | 按任务选择，尚未专项审核 |
| `unocss` | [SKILL.md](../.agents/skills/unocss/SKILL.md) | 按任务选择，尚未专项审核 |
| `vercel-composition-patterns` | [SKILL.md](../.agents/skills/vercel-composition-patterns/SKILL.md) | 按任务选择，尚未专项审核 |
| `vercel-react-best-practices` | [SKILL.md](../.agents/skills/vercel-react-best-practices/SKILL.md) | 按任务选择，尚未专项审核 |
| `vercel-react-view-transitions` | [SKILL.md](../.agents/skills/vercel-react-view-transitions/SKILL.md) | 按任务选择，尚未专项审核 |
| `vite` | [SKILL.md](../.agents/skills/vite/SKILL.md) | 按任务选择，尚未专项审核 |
| `vitest` | [SKILL.md](../.agents/skills/vitest/SKILL.md) | 按任务选择，尚未专项审核 |
| `vue-best-practices` | [SKILL.md](../.agents/skills/vue-best-practices/SKILL.md) | 按任务选择，尚未专项审核 |
| `vue-debug-guides` | [SKILL.md](../.agents/skills/vue-debug-guides/SKILL.md) | 按任务选择，尚未专项审核 |
| `vue-jsx-best-practices` | [SKILL.md](../.agents/skills/vue-jsx-best-practices/SKILL.md) | 按任务选择，尚未专项审核 |
| `vue-options-api-best-practices` | [SKILL.md](../.agents/skills/vue-options-api-best-practices/SKILL.md) | 按任务选择，尚未专项审核 |
| `vue-pinia-best-practices` | [SKILL.md](../.agents/skills/vue-pinia-best-practices/SKILL.md) | 按任务选择，尚未专项审核 |
| `vue-router-best-practices` | [SKILL.md](../.agents/skills/vue-router-best-practices/SKILL.md) | 按任务选择，尚未专项审核 |
| `vue-testing-best-practices` | [SKILL.md](../.agents/skills/vue-testing-best-practices/SKILL.md) | 按任务选择，尚未专项审核 |
| `vue` | [SKILL.md](../.agents/skills/vue/SKILL.md) | 按任务选择，尚未专项审核 |

[锁文件](../skills-lock.json) 保留来源及校验标识；第三方技能中的脚本运行前逐项审查安全与权限。技能变更须同步本索引和锁文件，不能覆盖项目工业安全规则。
