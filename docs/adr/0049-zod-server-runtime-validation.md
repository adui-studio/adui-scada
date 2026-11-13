# ADR-0049：NestJS 运行时启动配置采用 Zod 校验

- 状态：Proposed
- 日期：2026-11-13
- 关联：NFR-003、NFR-007、NFR-008
- 前置：[ADR-0010](0010-root-env-lf.md)、[ADR-0046](0046-pino-openapi-http-security.md)、[ADR-0047](0047-server-configuration-startup.md)、[ADR-0048](0048-security-audit-event-boundary.md)

## 背景

第十五批已将正式 NestJS 启动配置抽取为 `resolveServerStartupConfig(env)` 纯函数，修复根 `.env` 加载晚于 `AppModule` 初始化的问题。端口与监听地址此前通过手写 `Number.isInteger` 和字符串比较校验。随着受控 HTTP DTO、运维环境配置和外部数据接入逐步增加，需要建立可复用的运行时输入校验技术选型，但不能重写共享 Core 的工程 Schema 或改变现有工业安全规则。

## 决策

1. 采用 **Zod 4.6.7**，只在 `apps/server` 引入生产依赖，版本集中维护在根 `pnpm-workspace.yaml` Catalog；不升级 NestJS、Prisma、TypeScript 或其它依赖。
2. **本批仅替换服务端启动端口、监听地址的运行时校验**。输入仅来自已经加载的根 `.env` 与进程环境变量，不新建 HTTP DTO、公开 API 或工业网关接入。
3. 端口 Schema 先限定输入为字符串或数字，再做与历史 `Number(value)` 一致的转换，最后验证有限整数且范围为 1～65535；拒绝布尔值、对象、数组、非数字、无穷大、非法范围。保持 `SCADA_SERVER_PORT` 高于 `PORT`、默认 3001 的原有规则；显式无效的专用配置不得回退到通用值。
4. 监听地址使用 `z.enum(["127.0.0.1", "0.0.0.0"])`，保留 `SCADA_SERVER_HOST` 高于 `HOST`、默认 127.0.0.1 的规则。使用已有 `allowLocalOpenApi` 决定 Swagger 是否注册，仍要求显式开启、非生产、回环监听三个条件同时满足。
5. `safeParse` 失败只抛出**已有固定中文错误消息**，不得记录原始环境值、`ZodError`、数据库连接串或堆栈；返回值仅包括 `port`、`host`、`localDocs`。保持 `main.ts` 中根 `.env` 先加载再动态导入 `AppModule` 的次序和已有 `@nestjs/config` 配置。
6. 新增无数据库单测覆盖畸形值、敏感内容、配置优先级、额外环境变量和历史数字表示兼容。既有 5 项配置测试必须继续通过。

## 边界与后续

- 当前仅建立**服务端启动配置**的 Zod 运行时校验入口，不宣称已经对所有环境变量、所有 DTO、设备网关报文或工程文档完成 Schema 化。
- SCADA Core、工程快照、图元、Tag 等已经存在的共享 Schema 保持唯一事实来源；以后引入 HTTP DTO 或外部设备数据 Schema，应明确类型来源与契约对等，不复制维护两套冲突的校验规范。
- 第十六批已验证的 `createSafeSecurityAuditRecord` 四字段白名单保持不变；Zod 不能替代审计的固定字段重建，任何输入与校验错误对象都不能直接写入日志。
- 不挂载 `ScadaIdentityModule` / `ProjectPersistenceModule`，不开放登录、工程读写、工业设备写入或 Swagger 生产文档。
- 不修改 PostgreSQL、Prisma 模型或迁移，也不影响 React/Vue 双版本 UI。

## 依赖与验收状态

项目协作执行环境不能解析 npm Registry，无法可靠地执行 `pnpm install` 或由 pnpm 正式更新 `pnpm-lock.yaml`。本批先提交 Catalog、Manifest、代码和测试到独立 Draft PR。**锁文件更新属于合并前阻塞，不得手工编造 integrity、跳过冻结安装或宣称新增依赖已实际测试通过。**

第十六批 Windows 基线为 **367/367** 单测、**8/8** NestJS E2E、完整 `ready` 退出码 0，Docker 隔离烟测也通过。本批增加 4 项单测，**预期**普通单测 371、E2E 8；预期不代表本批已通过。

维护者在 Windows 的第十七批开发分支执行 `pnpm install`，核对后提交 pnpm 12 正式生成的锁文件，再执行 `pnpm install --frozen-lockfile`、`pnpm run ready` 和 `pnpm run test:docker:server`。生产镜像必须包含 Zod 运行时依赖且默认接口安全边界保持不变。验收通过并获得明确授权前，PR 保持 Draft，不合并。

## NestJS DTO 集成包兼容性复核补充（2026-11-13）

维护者提出将方案扩展为 `nestjs-zod + zod`。实际复核 `nestjs-zod@5.6.0` 的发行标签元数据发现，其 NestJS Peer 范围仅为 10 / 11、Swagger 仅包含 7 / 8 / 11；而本仓库为 NestJS 12.0.3 / Swagger 12.1.1。Zod 4 本身匹配，但**Nest 集成层尚不满足官方 Peer 范围**。根据最小改动与依赖安全规则，暂不在本 PR 中强行添加 `nestjs-zod` 或放宽依赖校验。

已调研名称不同的 `nest-zod`，其文档明确声明支持 NestJS 12 + Swagger 12 + Zod 4，亦可考虑 NestJS 12 原生 `StandardSchemaValidationPipe`。两者都属于替代方案而不是 `nestjs-zod` 的同名升级，只有在维护者确认集成选型后才能实施；未来新建 DTO 时必须统一 Schema、关闭原始 Zod 错误明文、保持 OpenAPI 受控且不开放业务路由。详见 [上游包声明](https://github.com/BenLorantfy/nestjs-zod/blob/v5.6.0/packages/nestjs-zod/package.json) 和 [候选兼容矩阵](https://nestzod.dev/guide/compatibility)。
