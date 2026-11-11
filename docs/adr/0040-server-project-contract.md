# ADR-0040：服务端工程保存请求契约与授权边界

- 状态：Proposed
- 日期：2026-11-11
- 关联需求：FR-001、FR-002、FR-008、FR-013、FR-014、NFR-004、NFR-006
- 依赖：[ADR-0035](0035-project-validation-snapshot.md)、[ADR-0036](0036-local-version-history.md)、[ADR-0039](0039-multitab-browser-safety.md)

## 背景

V0.3 前七批已有严格的 `ScadaDocument 0.2.0`、SHA-256 不可变快照、IndexedDB 本地历史与真实双标签页 CAS 保护；NestJS 当前只提供本地 `GET /health`，尚无用户认证、项目授权或生产数据库。将浏览器本地历史直接当作服务端项目仓库，或先开放匿名保存路由，都会破坏工业软件的权限和可追溯要求。

## 决策

1. **只先建立共享请求校验，不开放 API。** `@adui/scada-core` 导出 `ServerProjectSaveRequest` 与 `parseServerProjectSaveRequest(input,routeProjectId)`。请求体只允许 `{expectedRevision, document}`；禁止客户端携带 `actorId`、`tenantId`、角色、审核状态、发布时间、服务端修订号或摘要。
2. **严格的工程与版本意图。** 路由工程 ID 必须使用当前稳定 ASCII 标识规则且与文档 `projectId` 完全一致；工程使用当前 Schema 严格 Parser，旧版必须先由明确迁移流程转换。首次版本以 `expectedRevision:null` 表示客户端未见过 head；后续必须使用正安全整数。客户端声明不等于可信数据库状态，服务端必须在一个事务内 CAS 校验后分配真实修订号。
3. **容量约束。** 首阶段请求数据按 UTF-8 计不超过 2 MiB，沿用 Core 现有快照最大容量常量；后续 NestJS 还需在请求体解析层设置独立上限，且完整快照需再通过摘要及大小校验。此限制不是生产数据规模承诺。
4. **可信主体与授权顺序。** 未来认证主体必须由受信服务端 Guard/身份层构造；读取、写入、版本查询、发布等动作先完成工程级授权，不从客户端角色或 Origin 推导。访问控制必须避免跨工程和跨租户信息泄露；用户/角色/租户体系在独立设计中确认，不能通过本请求 DTO 假设已经实现。
5. **规划接口（未注册）。** 候选 `POST /api/projects/:projectId/versions` 保存新版本、`GET /api/projects/:projectId/versions` 查询历史摘要、`GET /api/projects/:projectId/versions/:revision` 读取受校验快照。最终响应码（含冲突）、错误结构、分页、幂等键及部署认证方式在真正实现 NestJS 前另行评审。
6. **审计与发布分离。** 未来持久化应把工程版本提交、修订号水位与审计视为受控事务过程；正式发布需要独立审批、只读发布指针与回滚控制。SHA-256 只能验证内容完整性，不能作为身份签名或发布授权。
7. **本批不实现。** 不修改 NestJS 现有健康检查、数据库模式、Vue/React UI、Dexie、本地版本仓储或只读 Runtime；不接入 PLC/DCS，不开放设备写入。只有新增契约和单测完成后才能讨论下一批 API 适配。

## 验收

新增 Core 单测覆盖：正常首次创建、已有修订号、恶意容器、缺失或未知字段、非法修订号、路由 ID 不一致、旧 Schema/坏图元、无原型 JSON 容器及 2 MiB UTF-8 上限。要求 `pnpm run ready` 完整通过、零 Lint 警告；NestJS E2E 另外验证工程版本读/写路由在本批均返回 404，防止未授权功能被提前暴露。**提交源码和 ADR 不等于完成认证、数据库、工程发布或工业安全验收。**
