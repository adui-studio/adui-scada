# ADui SCADA · 仓库代码索引

> 基于 2026-11-09 `main` 仓库检查，文档及校验脚本为**本次新增**；规划目录与实际目录分开。

## 已存在与本次新增

| 路径 | 当前定位 |
| --- | --- |
| `package.json` | Node/pnpm 要求；Vite+ 根脚本；本次新增 docs:check |
| `pnpm-workspace.yaml` | 匹配 apps/*、packages/*、tools/*，catalog |
| `vite.config.ts` | 格式、lint 与 staged 规则 |
| `tsconfig.json`、`pnpm-lock.yaml` | TypeScript 与依赖 |
| `.vite-hooks/pre-commit` | `vp staged` |
| `.agents/skills/`、`skills-lock.json` | 7 个已安装 Skills 与锁索引 |
| `.vscode/` | Starter 自带编辑器配置 |
| `README.md` / `AGENTS.md` | 项目说明和协作规则（本次完善） |
| `docs/*.md`、`docs/adr/*.md` | 本次新增的工程文档及 ADR |
| `scripts/validate-docs.mjs` | 本次新增文档静态校验 |

`pnpm-workspace.yaml` 的 glob 不代表目录存在。`apps/*`、`packages/*`、`tools/*` 目前没有业务模块。Starter `website#dev` 入口也不存在。

## 规划结构（尚未创建）

```text
apps/
  studio-react/   studio-vue/
  runtime-react/  runtime-vue/
  console-react/  console-vue/
  desktop/  server/  gateway/
packages/
  core/ document/ editor-core/ renderer-svg/
  symbols/ tag-engine/ api-client/
  adapter-react/ adapter-vue/
  renderer-three/   # 后续 3D
contracts/ database/ infra/ examples/
```

只在相应功能真正实现时建立目录和包，不创建空模块充数。

## 任务索引

需求与验收 → [REQUIREMENTS](REQUIREMENTS.md)；API/模型 → [SDD](SDD.md)；技术与模块边界 → [ARCHITECTURE](ARCHITECTURE.md)；状态 → [PROJECT_CONTEXT](PROJECT_CONTEXT.md)；Skills → [SKILLS](SKILLS.md)；质量检查 → [HARNESS](HARNESS.md) 和 [VALIDATION](VALIDATION.md)。
