# ADui SCADA · 详细设计（初稿）

> 大部分数据结构和接口仍为 **候选契约**，不是已存在服务。V0.1 仅实现已标注的本地 Document/Tag/SVG 子集，见 [V0.1 实施记录](V0.1_IMPLEMENTATION.md)。范围编号见 [REQUIREMENTS](REQUIREMENTS.md)。

## 1. 需求追踪

| 需求                              | 详细设计             | 测试方向                 |
| --------------------------------- | -------------------- | ------------------------ |
| FR-002 / FR-005 / FR-006 / FR-013 | 文档、图元、编辑命令 | 跨框架工程往返、撤销重做 |
| FR-003 / FR-004 / FR-009 / FR-010 | Tag 与采集           | 模拟器、质量、断线重连   |
| FR-007 / FR-008 / FR-016          | Runtime 与发布       | 不可变快照、回滚         |
| FR-011 / FR-012 / FR-014          | 报警、归档和审计     | 状态机与追溯             |
| FR-001                            | 权限与 API           | 越权负面测试             |

## 2. ScadaDocument、节点与命令

```ts
type TagId = string;
interface ScadaDocument {
  schemaVersion: string;
  projectId: string;
  pages: ScadaPage[];
}
interface ScadaPage {
  id: string;
  name: string;
  size: { width: number; height: number };
  nodes: ScadaNode[];
}
interface ScadaNode {
  id: string;
  type: string;
  symbolVersion: string;
  transform: { x: number; y: number; width: number; height: number; rotation: number };
  props: Record<string, unknown>;
  bindings: Record<string, { tagId: TagId }>;
  rules: unknown[]; // 后续定义严格校验的判别联合类型
}
```

图元保存稳定 ID、图元版本、位置、静态属性与 Tag 绑定。新增/更新/删除/排序采用可逆 Command，支持 Batch 与撤销重做。Schema 版本变化必须配迁移与测试；外部 JSON 必须校验；不能执行组态中的任意 JS。

**V0.1 已实现**：`SCADA_SCHEMA_VERSION = "0.1.0"`、`parseScadaDocument(unknown)`；校验项目/页面/节点 ID、图元尺寸、纯 JSON 属性/规则、绑定标识及上限，拒绝版本不匹配、重复 ID、循环对象和危险键，并防御性复制输入。暂不实现 Command、迁移、持久化和严格 `rules` 判别联合。

## 3. TagValue 与采集服务

```ts
type TagQuality = "GOOD" | "UNCERTAIN" | "BAD" | "STALE";
type TagScalar = string | number | boolean | null;
interface TagValue {
  tagId: string;
  value: TagScalar;
  quality: TagQuality;
  sourceTimestamp: string | null;
  serverTimestamp: string;
  sequence: number;
}
interface DriverAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
```

驱动接口为最小占位，协议能力需 PoC 后定义。OPC UA 优先订阅；Modbus 分组限流轮询；MQTT Topic 订阅。每种协议保留错误码和诊断数据，不将所有错误归一为单个布尔离线值。最新值、历史、告警、实时订阅分别消费标准化 Tag 事件。

拟定 WebSocket 事件：`tag.subscribe`、`tag.unsubscribe`、`tag.snapshot`、`tag.delta`、`alarm.created`、`alarm.updated`、`gateway.status`。需要补齐字段、序列号策略、断线重同步、背压与鉴权。

**V0.1 已实现**：本地 `TagStore` 的 `snapshot`、`subscribe`、`apply`、`markStale`；逐 Tag sequence 单调递增判断，同批次验证失败不修改状态；超时标记质量但保留旧读数。模拟器生成三项水处理 Tag。**没有** DriverAdapter 实现或生产 WebSocket，重连后的跨进程/重启序列号尚待正式设计。

## 4. 工程发布

状态：Draft → Validating → Released；校验失败回 Draft，已发布快照不变。发布记录需保存 Schema 版本、快照哈希、操作者和时间；运行时通过原子发布指针读取快照。回滚只切换版本指针，不销毁历史。缺少图元/Tag 或资源时明确显示错误，不静默正常运行。**V0.1 尚未实现发布。**

## 5. 报警与历史

报警至少区分 ACTIVE_UNACKED、ACTIVE_ACKED、CLEARED_UNACKED、CLEARED_ACKED，阈值、死区、延时和恢复语义单独设计；确认不意味着工艺条件恢复。

历史数据保存 Tag ID、源时间/平台时间、类型化数值和质量；归档策略、保留期和数据库分区需基于容量估算。关系数据拟用 Prisma，TimescaleDB Hypertable 使用独立 SQL 迁移。**V0.1 尚未实现报警与历史。**

## 6. 候选 REST 接口与权限

| 接口                          | 意图     | 权限要求     |
| ----------------------------- | -------- | ------------ |
| `GET /projects`               | 工程列表 | 工程可见范围 |
| `POST /projects`              | 创建工程 | 设计人员     |
| `GET /projects/:id/pages`     | 页面信息 | 工程读权限   |
| `POST /projects/:id/releases` | 发布版本 | 工程发布权限 |
| `GET /tags/:id/history`       | 历史查询 | Tag 读权限   |
| `POST /alarms/:id/ack`        | 报警确认 | 报警确认权限 |

以上不是已存在的 API；待 OpenAPI 契约定义时统一错误码和输入验证。授权必须在服务端校验，前端按钮禁用不构成鉴权。V1 不提供通用控制写入 API。

**V0.1 当前已存在的 NestJS 路由仅为 `GET /health`，它只表示应用进程可响应，不代表 Gateway/数据库或工业设备健康。上述业务接口均未实现。**

## 7. V0.1 SVG 只读渲染

`renderSvgPage(document, pageId, values)` 是无框架纯函数，只序列化白名单图元 `tank`、`pump`、`pipe`、`label`；未知图元显示明确占位。读取 `bindings[level|running|value].tagId` 绑定，文字做 XML 转义，不拼接外部脚本、HTML 或 URL。BAD/STALE 不显示为 GOOD：水箱将实时百分比显示为 `--`，泵显示质量标记。每次重新渲染完整 SVG，后续视规模引入增量 DOM 优化。

## 8. 边界与测试

V0.1 已编写工程合法/恶意 JSON、错误版本、重复 ID、坏质量、乱序与模拟恢复等单元测试。后续仍需覆盖旧 Schema 迁移、工程保存、跨框架互通、断网/证书/发布/报警/权限、负载与真实设备。只有实际 PoC 通过后才把对应规划部分变更为实现设计。

## 9. V0.2 Studio 第一阶段：本地 Editor Command

新增 `@adui/scada-core/editor` 子入口（`packages/core/src/editor.ts`），与纯 SVG Runtime 依赖分离。它在两套框架中共享 `DocumentEditor`、`withNodePosition`：

- `snapshot()` 返回 Schema 校验后的独立工程副本、选中 ID、`canUndo` / `canRedo`；
- `select(nodeId|null)` 只选中当前第一页图元，不修改文档或历史；
- `moveSelected(x,y)` 在画布范围内取整/截断位置，生成不可变文档；单次拖动在松开时提交，记录一条可撤销命令；
- `setSelectedLabel(text)` 仅允许 Label 图元，最多 256 字符；由现有 SVG 转义渲染；
- `undo()/redo()` 保留最近最多 100 份历史文档；新的修改会清空重做栈；
- `loadDocument(unknown)` 校验任意外部 JSON，失败不改变当前文档，成功重置选中与历史。

React/Vue 通过各自生命周期、Pointer Events 和 SVG `getScreenCTM()` 将屏幕坐标转换为画布坐标；共享 `withNodePosition` 在拖动中预览，直到 pointerup 才产生历史记录。预览用本地静态模拟 Tag 快照，**不连接设备，也不宣称实时采样**。

JSON 导出由浏览器生成文件，导入限制 2 MiB 并调用现有 `parseScadaDocument`；跨框架统一 Schema `0.1.0`。不引入后端保存、身份认证、资源存储和发布；这些属于 FR-002/008/013 的后续完整验收。

## 10. V0.2 Studio 第二批：多选、图元和画布命令

核心 `DocumentEditor` 保留 `snapshot().selectedId` 向后兼容，同时新增 `selectedIds`，通过 `select(id, additive)` 实现 Shift 增量选择；选择只在编辑会话中存在，不写入 `ScadaDocument`。最后选中的 ID 为主选/对齐锚点。

新增命令均基于已有 `parseScadaDocument` 进行边界验证并生成新文档：

- `withNodesTranslated(document, ids, dx, dy)`：纯函数，先验证选择的唯一 ID 和有限位移，再按整组在画布可容纳的共同位移区间截断，保证相对位置不因单独截断而错乱。
- `moveBy(dx, dy)` / `moveSelected(x,y)`：移动全部选择的节点；一次松开只产生一条历史记录；无变化不入历史。
- `addNode(type,x?,y?)`：只允许 `tank/pump/pipe/label`，分配全工程唯一节点 ID，按画布边界放置图元；**bindings 默认为空**，不自动接任何 Tag/设备。
- `deleteSelected()`：删除已选节点，撤销可恢复；选择状态在删除后清空，撤销恢复文档但不自动恢复选择。
- `alignSelected(mode)`：按最后选择的图元，支持 `left/right/hcenter/top/bottom/vcenter` 六种对齐，作为一条命令；单选无操作。
- `reorderSelected(action)`：`front/back/forward/backward` 排序，保持多选节点的原有相对顺序。SVG 文档中排在后面的节点绘制在前面。
- `undo()/redo()` 仍为最多 100 份文档历史；删除图元后在历史移动时会自动筛除无效选中 ID。

React/Vue 继续使用同一 Core。画布缩放通过前端视图 CSS 宽度调整 `50%–200%`，SVG `getScreenCTM` 转换坐标，缩放值不写 JSON、不产生编辑历史。两端使用一致的图元列表/属性/层级/对齐按钮；Demo Runtime 的固定模拟数据和状态质量逻辑不作变更。

**本阶段仍无**多页面管理、服务端保存/发布、可编辑 Tag 绑定、网关设备写入、完善的键盘快捷键及复杂工程渲染优化。跨框架新增/删除、排序后 JSON 往返需额外实测。

## 11. V0.2 Studio：框选与快捷键

`@adui/scada-core/editor` 增加 `findNodesInRect(document,startX,startY,endX,endY)` 和 `DocumentEditor.selectMany(ids,additive?)`。框选支持反向拖动，使用第一页节点**旋转后轴对齐外接矩形**与框选范围相交的命中方式；零面积矩形不命中，NaN/Infinity 坐标拒绝。批量选择先检查全部 ID，再一次更新选择，不产生文档历史或改变 Schema。

React/Vue 的 SVG Pointer Events 在空白区域按下时开始框选，移动时只显示视图叠加层，松开一次性提交选择；小于 4 工程单位按单击处理。Shift 框选追加选择。两端仅在 Studio 挂载期间监听键盘，忽略输入框、可编辑内容、已处理事件和 IME：Ctrl/Cmd+A 全选；Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z、Ctrl+Y 撤销重做；Delete/Backspace 删除；方向键 ±1，Shift+方向键 ±10；Esc 清选。

当前只处理第一页，旋转图元采用保守 AABB 命中并非逐像素精确选取；未增加工业设备连接或正式工程发布。

## 12. V0.2 自有提示中文化与协议隔离

遵循 `AGENTS.md` 的中文文案规则：`parseScadaDocument`、`TagStore`、`DocumentEditor`、运行时及模拟服务的错误文本、日志、测试名称、源码注释均改为中文。禁止为翻译而修改 `ScadaDocument` 字段、Tag ID、图元类型、`GOOD/UNCERTAIN/BAD/STALE` 质量枚举以及 HTTP 端点。

共享 Core 新增 `TAG_QUALITY_LABELS`，Runtime 新增 `RUNTIME_STATUS_LABELS`，分别映射内部枚举到中文显示名称。SVG、React 和 Vue 读取这些映射，保证双框架 UI 对等。默认水处理演示工程的页面标题、静态文本和泵运行状态显示中文，导入旧 JSON 仍按原 Schema 校验，不执行任何内嵌脚本。

项目质量链新增 `messages:check` 静态检查；其作用是避免新写的自有提示、测试标题和注释回退为英文，不能替代真实浏览器访问、协议兼容或工业安全验收。

## 13. V0.2 网格、图元吸附与对齐辅助线

新增框架无关 `packages/core/src/snap.ts`，通过已有 `@adui/scada-core/editor` 子入口导出 `DEFAULT_GRID_SIZE` 与 `resolveDragSnap(document, selectedIds, dx, dy, options)`。

- 网格默认间距为 20 工程单位，吸附容差默认 6 工程单位，均可通过受限参数配置；当前两个 Web 端以固定默认值使用。
- 网格吸附和图元吸附分别启用；支持选中图元组整体移动，吸附目标只从非选中图元的旋转轴对齐外接框提取，避免组内图元彼此吸附。
- 参与计算的参考点包含组外接框和目标外接框的起点、中心及终点；分别求水平/垂直最小吸附修正，位移超出画布允许范围时不能吸附越界。
- 同等修正距离优先显示图元参考线；结果包含 `dx/dy` 与可选 `verticalGuide/horizontalGuide`，辅助线只出现在拖动预览期间。
- 输入坐标必须为有限数，网格间距只能为 1～1024 的整数，容差只能为 0～32；未知或重复图元会被拒绝。
- 预览与最终提交都调用同一个纯函数；最终位移仍由原 `withNodesTranslated` 与 `DocumentEditor.moveBy` 校验并提交一条可撤销命令。

Vue / React 通过原生 SVG `pattern` 绘制网格，并以 `line` 显示图元对齐辅助线。网格可隐藏；网格吸附与图元吸附可以分别开关。网格、开关和辅助线均不写入 `ScadaDocument`，运行时不 import `snap.ts`。

本批不做自动缩放适配容差、跨页面吸附、复杂路径精确命中或导出网格背景；涉及旋转图元时，吸附采用保守外接框而非旋转边沿。正式工程保存、发布及设备控制仍不在范围内。
