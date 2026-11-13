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

项目协作执行环境不能解析 npm Registry，无法在该环境执行依赖安装；维护者已在 Windows 通过 pnpm 正式生成、重新同步并推送 `pnpm-lock.yaml`，远程检查确认不再包含 `nest-zod`。本批已完成冻结安装和完整 Windows/Docker 验收。锁文件不得手工编造 integrity，也不得跳过冻结安装。

第十六批 Windows 基线为 **367/367** 单测、**8/8** NestJS E2E、完整 `ready` 退出码 0。本批新增启动配置 4 项及隔离 NestJS 原生集成 4 项单测，维护者 Windows 实测 **375/375** 普通单测、**8/8** E2E、完整 `ready` **退出码 0**；Docker 隔离烟测 **退出码 0**。

维护者已在 Windows 第十七批开发分支正式更新锁文件，并完成 `pnpm run ready` 及包含冻结安装的 Docker 镜像构建与隔离烟测。生产镜像已通过本轮构建验证，默认未开放接口仍返回 404。记录性文档修改后可再次执行 `vp check` 与 `pnpm run docs:check`；PR 继续保持 Draft，未经明确授权不合并。

## 第十七批实测修订：改用 NestJS 12 原生 Standard Schema（2026-11-13）

维护者已授权选择实际更可靠的 NestJS + Zod 集成方案。此前曾评估 `nestjs-zod@5.6.0` 与 `nest-zod@2.1.0`：两者的已核对发行包 `peerDependencies` 均未明确包含本项目的 NestJS 12 / Swagger 12（即便 `nest-zod` 官网兼容性说明写有支持）。为了不忽略 Peer 校验，最初尝试了 `nest-zod + zod` 的隔离集成测试。

**实际失败已确认**：维护者 Windows 首次运行 `pnpm run ready`，`nest-zod/swagger` 的 `ZSerialize` 在装饰器求值时抛出 `TypeError: Property description must be an object: undefined`，整个测试套件没有执行。上游 `v2.1.0` 的 `src/openapi-schema.ts` 在 `withSynchronousOpenApiIntrospection` 中通过 `Reflect.getOwnPropertyDescriptor(schema, "safeParse")` 读取描述符，却不处理该方法继承于原型时返回 `undefined` 的情况，最终在 `Object.defineProperty` 恢复时出错。参见 [源代码](https://github.com/taugr/nest-zod/blob/v2.1.0/src/openapi-schema.ts) 和 [发行包 Peer 声明](https://github.com/taugr/nest-zod/blob/v2.1.0/package.json)。

**修订后的正式方案**：仅保留 `zod@4.6.7`。NestJS 12 已原生提供 `StandardSchemaValidationPipe`、`StandardSchemaSerializerInterceptor`、`@Body({ schema })`、`@Query(..., { schema })` 和 `@SerializeOptions({ schema })`。其 Swagger 12 可以直接从 Zod 4 的 Standard JSON Schema 生成 OpenAPI 请求体。该方案已由 [NestJS 12 官方文档](https://docs.nestjs.com/application/validation) 和 [OpenAPI 文档](https://docs.nestjs.com/openapi/introduction) 明确说明，不需要第三方 NestJS 适配器。

- 从根 Catalog 与 `apps/server/package.json` 移除 `nest-zod`。保留 Zod 4.6.7；不修改 NestJS、Swagger、Prisma 或 TypeScript 版本。
- 改用 `apps/server/src/validation/standard-schema-integration.spec.ts`，只在测试 NestJS 应用注册 `StandardSchemaValidationPipe` 与逐路由响应拦截器，沿用 4 项 DTO/查询/响应输出/Swagger 集成测试。正式 `AppModule` 不改动，不开放业务或工业设备接口。
- 启动配置只在值确实为 `undefined` 时回退到通用环境变量或默认值；非法 `null` 必须交给 Zod 拒绝。避免 `??` 把非法类型误当成未配置。
- 本批 Windows 失败记录：格式 227 个文件全部通过，105 个受检源文件无警告/错误；执行单测时 **370 通过、1 失败**，另有一个 `nest-zod` 测试套件在导入时失败，因此 `ready` **未完成**，后续 E2E 与构建未执行。不能将此记录标为成功。
- 修改后 Windows 实测普通单测 **375/375 项**（基线 367 + 启动配置 4 + 原生集成 4），NestJS E2E **8/8**，完整 `pnpm run ready` **退出码 0**；`vp check` 227 个文件格式通过、105 个受检源文件无警告或错误，65 份 Markdown 检查与 React/Vue/NestJS 类型检查及构建通过。
- 维护者已使用 pnpm 正式重新计算并推送 `pnpm-lock.yaml`，锁文件中不再包含 `nest-zod`。随后 Windows 完整 `ready` 实测通过；独立 Docker 镜像构建包含 `pnpm install --frozen-lockfile` 且隔离烟测 **退出码 0**，健康接口 200、未开放工程及设备写入接口保持 404。没有单独执行 PostgreSQL 真库回归，也不等于工业现场认证完成。记录性文档同步后建议复验 `vp check` 与 `pnpm run docs:check`。

安全边界保持不变：根目录 `.env` 先加载、Swagger 默认关闭、Guard 未挂载、工程写入和工业设备接口未开放。正式使用原生 Standard Schema 处理敏感业务请求时仍需专项校验异常输出，不得将未经清洗的错误详情写入审计。
