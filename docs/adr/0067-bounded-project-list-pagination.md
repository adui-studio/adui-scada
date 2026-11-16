# ADR-0067 · 受保护工程摘要列表的有界 ID 游标分页

- 状态：Proposed
- 日期：2026-11-16
- 验收：第三十四批第一小批 Windows 与隔离 PostgreSQL 尚待执行

## 背景

第三十三批合并后，`GET /api/v1/projects` 已按可信租户和 `project:read` 过滤工程，但 Prisma `findMany` 未设置 `take`，随着授权工程数量增加，会持续扩大数据库读取量与响应体积；而共享 API Client 对 JSON 响应采用 2 MiB 限制。无限列表不满足服务端容量可控的要求。

## 决策

1. 不修改受保护的 GET 路由、会话 Guard、`Cache-Control: no-store` 和 `ScadaProjectSummary[]` 返回格式。只增加可选 `limit`（默认 20、最大 100）及 `afterProjectId`。非法、重复、未知字段和越界数据使用既有 `ProjectRequestValidationError` 映射为 HTTP 400。
2. 工程 ID 在当前工程生命周期内不可变，按 `projectId ASC` 排序并用 `projectId > afterProjectId` 作为稳定游标，搭配数据库 `take` 限制。不使用 OFFSET 或会随编辑而变化的 `updatedAt` 作为游标。**本次将先前的更新时间倒序改为 ID 升序**。
3. 服务端每页重新执行可信 `tenantId` 和 `project:read` 过滤，`afterProjectId` 只限定检索范围，不能修改租户或主体权限。结果只查询工程摘要四字段，不读完整 JSONB。
4. `ProjectListQuery` 作为框架无关 Core 类型，Vue/React 共用 `@adui/scada-api-client` 的 `listProjects(query?)`，客户端验证参数、返回数量与工程 ID 严格递增。下一页使用上一页最后一个 ID，不持久化租户信息或敏感会话。
5. 不新增依赖与 Prisma 迁移，不修改工程 Schema、正式发布指针、历史回滚、OPC UA/Modbus/MQTT 工业网关和设备写入。

## 兼容与验收边界

原 `GET /projects` 无参数调用仍返回数组，但新默认行为是**第一批最多 20 条且按工程 ID 升序**。依赖旧版“所有授权工程一次返回”或“最近更新时间排序”的 UI/SDK 必须迁移为显式翻页；本批不新增独立工程中心 UI。并发新建、权限撤销时，游标遍历不承诺单个数据库快照，但每页必须执行当前权限过滤。

验收覆盖 Core/共享客户端、NestJS 请求边界、Mock HTTP E2E、真库租户隔离与游标耗尽。正式生产数据库、跨多实例容量性能、企业 IdP 与工业现场安全认证仍需独立评估。只有实际 Windows 质量链和隔离 PostgreSQL 验证提供通过日志后，才可登记本次代码验收通过。
