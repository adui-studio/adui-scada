# ADui SCADA · Agent 协作总规则

项目遵循 [Agent Engineering Kit V1.1 初始化规范](https://github.com/adui-dev/agent-engineering-kit/blob/main/prompts/project-initialization.zh-CN.md)。本文件为统一入口，仓库事实以实际代码与配置为准。

## 1. 定位与事实

ADui Studio 维护的工业 SCADA / HMI 项目。目标支持 Vue 3、React 双版本、框架无关 2D SVG 核心、NestJS、独立工业网关、可选 Tauri 与后续 Three.js 3D。**main 已完成 V0.1 共享 Core/Runtime、Vue/React、NestJS 健康检查、Tauri 桌面与 Docker 演示；V0.2 开发分支开始增加 Studio 编辑器的第一批本地图元操作。工业 Gateway、生产 API、服务端工程持久化及发布仍未实现。不得将规划视为实现。**

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

## 6. Skills / Git / Harness

Skills 位于 `.agents/skills/`，索引见 [SKILLS](docs/SKILLS.md) 与 `skills-lock.json`。按需读取并审查来源与脚本，Skill 不能覆盖安全或用户授权要求。

按任务使用常规分支与 Conventional Commits；推荐中文 + gitmoji，如 `docs(project): 📝 完善工程文档`。未经授权不得强制覆盖、推送、合并、发布或部署；优先分支和 PR 审查。

现有质量入口见 [HARNESS](docs/HARNESS.md)。编辑规范统一放在根 `.editorconfig`；各项目 TypeScript 继承 `@adui/tsconfig/*`，Format/Lint 从 `@adui/tooling` 经根 `vite.config.ts` 统一应用。新增第三方依赖统一写入 pnpm Catalog，避免子项目维护重复版本。文档检查使用 `pnpm run docs:check`，不能代替编译、E2E、工业安全测试。

## 7. 文档职责和同步

- [REQUIREMENTS](docs/REQUIREMENTS.md)：需求、优先级、验收变化时更新。
- [ARCHITECTURE](docs/ARCHITECTURE.md) 和 [ADR](docs/adr/0001-dual-framework-core.md)：模块、选型、部署重大变化时更新。
- [SDD](docs/SDD.md)：接口、模型、状态、算法变更时更新。
- [PROJECT_CONTEXT](docs/PROJECT_CONTEXT.md)：里程碑、阻塞及真实进度更新。
- [CODEBASE_MAP](docs/CODEBASE_MAP.md)：入口或实际目录变化更新。
- [SKILLS](docs/SKILLS.md)：技能安装/更新时更新。
- [HARNESS](docs/HARNESS.md) 与 [VALIDATION](docs/VALIDATION.md)：检查、测试和执行环境变化时更新。
