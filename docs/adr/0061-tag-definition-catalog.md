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
