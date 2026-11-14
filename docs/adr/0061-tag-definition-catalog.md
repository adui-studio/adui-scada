# ADR-0061：共享 Tag 定义目录与实时值类型一致性

- 状态：Proposed
- 日期：2026-11-14
- 关联：FR-004、FR-006、FR-009、NFR-001、NFR-002、NFR-003
- 前置：[ADR-0053](0053-local-readonly-demo-telemetry.md)、[ADR-0054](0054-readonly-tag-source-adapters.md)、[ADR-0059](0059-runtime-local-diagnostics.md)

## 背景

当前 `ScadaDocument 0.2.0` 的图元绑定只保存稳定 `tagId`，Tag 实时值包含标量、质量、时间戳和序列号；Studio 的 Tag 候选元数据仅包含显示标签和可绑定槽位。缺少框架无关的定义契约，无法在进入 TagStore 时检查实时值是否符合预期数据类型，Studio 也无法向维护者展示类型与单位。

直接向 `ScadaDocument 0.2.0` 顶层增加 Tag 列表会改变严格 JSON 契约，并影响本地草稿、版本快照、跨框架导入、服务端保存请求及历史工程迁移。本批不擅自升级 Schema；先为当前演示数据建立可复用的共享目录及值类型校验，后续持久化定义和地址映射须另行设计。

## 决策

1. 新增 `packages/core/src/tag-definition.ts`，定义 `TagDefinition`：稳定 `tagId`、可变 `displayName`、`dataType`（`number/boolean/string`）、`unit` 和中文描述。使用严格字段白名单、稳定 ASCII ID、长度上限及唯一 ID 校验；拒绝地址、连接串、未知字段和重复定义。
2. `TagDefinitionCatalog` 对定义进行防御性复制，提供 `get/snapshot/rename/validateValueType`。重命名返回新目录，只更改显示名称，不修改 `tagId`。现有工程绑定仍只存稳定 ID，故显示名称变化不要求遍历或重写图元绑定。当前重命名是**内存纯操作**，未接入持久化 UI 或工程 JSON。
3. 数据类型使用当前 `TagScalar` 的 number/boolean/string 三种标量类型。为保留“无有效读数”的表达，`null` 对任意定义均允许；非空值必须与定义类型一致。目录不固定质量，`GOOD/UNCERTAIN/BAD/STALE` 仍由每条实时 `TagValue.quality` 动态表达，质量变化不能被定义元数据覆盖。
4. `TagStore` 增加可选 `TagDefinitionCatalog` 构造参数。未传目录的通用 Store 保持原契约；传入目录后，`apply` 与 `replaceSnapshot` 先完成整批值结构、类型和重复 ID 校验，再修改状态，失败不得部分写入或清空已有快照。
5. 水处理本机模拟目录明确三项定义：`water.level`（number，%）、`water.pump.running`（boolean，无单位）、`water.flow`（number，m3/h）。Studio 原有图元槽位限制继续独立维护；两套 UI 在候选项展示数据类型、单位与描述，绑定字段仍为原有稳定 Tag ID。
6. 在线 Demo Runtime、Tauri OfflineDemoRuntime 和独立 Node SSE 模拟服务使用同一演示目录校验实时值类型。在线 Runtime 对类型不匹配的消息沿用既有无效消息路径，关闭当前订阅并进入 error，禁止错误值覆盖正常读数。自定义 `ReadonlyTagSource` 可通过 DemoRuntime 可选目录参数注入其对应定义。
7. 不增加设备地址、OPC UA NodeId、Modbus 寄存器、MQTT Topic、采样周期、写入权限或网关字段；不增加 Schema 字段、数据库表、IndexedDB 表或依赖。Tag 质量仍是实时值属性，目录仅是当前本机演示的内存元数据。

## 当前边界

- FR-004 仅完成**共享定义模型、数据类型和单位元数据、稳定 ID 语义、值类型校验**的本机模拟子集；正式项目级定义持久化、双框架编辑/重命名界面、跨工程目录管理、工业地址映射、权限和版本兼容仍未完成。
- 当前水处理定义通过代码常量提供，刷新后回到默认显示名称。纯函数重命名证明稳定 ID 不变，不等于用户修改已保存或跨 Vue/React 自动同步。
- `TagValue.quality` 是动态质量，目录不维护“默认 GOOD”或任何静态质量；不能用元数据将 BAD/STALE 改回 GOOD。
- 数据类型不匹配会被当作无效上游数据拒绝；本批不提供数据转换、单位换算或隐式强制转换。

## 验收计划

```powershell
pnpm run test:unit
pnpm run test:runtime
vp check
pnpm run docs:check
pnpm run ready

# 保持本机 Demo、React、Vue 运行后：
pnpm run test:sse:browser
pnpm run test:sse:fault:browser
```

覆盖目录结构/重复 ID/未知字段、稳定 ID 重命名、单位和类型展示、数值/布尔/文本匹配、类型不匹配原子拒绝、未知 Tag 拒绝、空值与动态质量独立，以及 Runtime 收到错误类型时安全进入 error。

## 当前执行状态

代码与单元测试已提交独立开发分支；当前协作环境未执行 Windows pnpm 工作区的 Vitest、Vite+、类型检查、完整构建或浏览器测试。不得沿用上一批测试结果。PR 创建后必须立即指派并核验 `@adui-dev`，保持 Draft，未经维护者明确授权不得合并。

### 第二十九批 Windows 完整质量链复验通过（2026-11-14）

维护者上传最新完整 PowerShell 日志，确认此前 React JSX 分支解析错误与 `TagStore` 的 `TS1294` 参数属性错误已消除；`pnpm run ready` 已从头执行至最后的 NestJS 构建并返回 **退出码 0**：

- 单独 `pnpm run test:unit`：**426/426 通过（38 个文件），明确退出码 0**。其中新增 `tag-definition.test.ts` **6/6**，包括定义校验、稳定 ID、重命名、原子拒绝及动态质量。
- 单独 `pnpm run test:runtime`：**40/40 通过（4 个文件），明确退出码 0**。其中 `diagnostics.test.ts` **8/8**，包含错误值类型被 Runtime 拒绝的回归。
- `vp check`：**267 个文件格式正确、133 个受检文件零警告、Lint 错误或类型错误**；`pnpm run docs:check`：**77 个 Markdown 文件检查通过**。
- `pnpm run ready`：**退出码 0**；依赖 Catalog **11 个清单 / 51 项**、共享配置 **9 个 TSConfig 消费端**、环境/LF、中文文案 **159 个自有文件**、Prisma Client **7.10.1**、Core Node 构建、React/Vue/草稿存储与 NestJS 类型检查均通过。
- `ready` 中全量 Vitest 再次 **426/426（38 文件）**，Node SSE 连接资源 **8/8**、TCP 故障代理 **4/4**、NestJS E2E **17/17（3 文件）**，React **3900 个模块**和 Vue **3845 个模块**完成构建，NestJS 服务端构建结束。
- E2E 日志中预期的 HTTP 503、Health Check 失败由负面测试产生，不代表 E2E 失败；最终 **17/17 通过**。

**尚待本批专项实测**：React/Vue Studio 手工检查水位/水泵/流量 Tag 的类型、单位、描述和绑定撤销/导入导出，以及 `pnpm run test:sse:browser` 与 `pnpm run test:sse:fault:browser`。本轮 `ready` 不包含浏览器测试。Tauri 桌面人工测试、项目级 Tag 持久化、工业驱动、真实设备和工业现场同样不在本批已验证范围。

以上是**维护者 Windows 实测日志**，不是当前协作环境自行执行的结果。本次只新增验收文档记录；**最新文档提交后的 `vp check` / `docs:check` 尚未再次执行**。PR #51 保持 Draft，Assignee `@adui-dev`，未经明确授权不合并。

### 第二十九批 Windows 双框架 SSE 浏览器与最新静态检查通过（2026-11-14）

维护者在第二十九批 Tag 目录类型校验修复后再次执行本机检查，实际日志确认：

- `vp check`：**267 个文件格式正确，133 个受检文件零警告、Lint 错误和类型错误**。
- `pnpm run docs:check`：**77 个 Markdown 文件静态检查通过**。
- `pnpm run test:sse:browser`：React `http://127.0.0.1:15173`、Vue `http://127.0.0.1:15174` 均输出 SSE 心跳保活、Tag 过期、静默重连和资源清理通过，**退出码 0**。
- `pnpm run test:sse:fault:browser`：React/Vue 均输出真实本机 TCP 下行阻断、STALE、主动重连与连接回收通过，**退出码 0**。

结合上一轮完整 `pnpm run ready` **退出码 0**、全量 Vitest **426/426**、Runtime **40/40**、NestJS E2E **17/17**，本批自动化质量链及双框架 SSE 专项已得到 Windows 实测通过。

**未验收内容**：React/Vue Studio 手工检查三项演示 Tag 的类型、单位、描述、稳定 ID、绑定撤销、工程导入导出；Tauri 桌面人工回归；项目级 Tag 持久化、真实工业协议和现场设备。浏览器 SSE 通过不等于 Studio Tag 管理 UI 已人工确认。

本次仅更新验收文档及 PR 正文，不改变业务代码。**上述日志对应文档更新前的分支；最新验收文档提交后的 `vp check` / `docs:check` 尚未重跑**。PR #51 保持 Draft，指派 `@adui-dev`，未经维护者明确授权不得合并。
