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

### 小数边界位移的提交一致性

当图元处于小数坐标且移动范围边缘为非整数时，`resolveDragSnap` 返回的 `dx/dy` 可能是精确边界小数。`withNodesTranslated` 在传入位移**恰好等于可行区间端点**时保留该值，避免吸附预览和 `DocumentEditor.moveBy` 的最终落点不同；普通非边界位移依旧按原有整数取整规则处理。此行为不更改工程 Schema、Tag 绑定及撤销历史结构。

## 14. V0.2 第五批：图元几何属性面板

在 `packages/core/src/editor.ts` 增加共享纯函数 `withNodeTransform(document, nodeId, patch)` 与 `DocumentEditor.updateSelectedTransform(patch)`，复用 `ScadaDocument 0.1.0` 的 `transform` 五个字段 `x/y/width/height/rotation`，**不新增 Schema 字段**。

- 属性面板仅支持单选图元；一次“应用几何属性”提交五项数值，形成一条可撤销命令。位置和尺寸允许合法小数，手动数值编辑不应用拖动吸附算法。
- `patch` 只接受普通对象及白名单字段，所有提供的字段必须是有限数；宽高按现有 Schema 限制为 0.1～16384，旋转角为 -360～360 度。
- 修改后图元的**未旋转布局矩形**须完整位于第一页画布内，不能出现负坐标或超过页面尺寸的结果；错误必须拒绝整批提交且保留文档和撤销历史。对旋转后的视觉外接框尚不施加单独裁切约束。
- 空修改、与原数据完全一致的修改不产生历史；文档校验与 Tag 绑定、防御性复制、最多 100 条历史记录仍由共享 Core 处理。
- React/Vue 通过各自原生表单提交数值，输入尚未点击“应用”时只改变 UI；选中图元或其几何值发生变化时恢复显示最新值。多选时隐藏单图元几何编辑表单，仅保留已有移动、对齐和图层操作。
- Runtime、工业网关、Tag 采集、设备写入、工程持久化及正式发布流程均不受本批影响。

设计记录：[ADR-0013](adr/0013-node-transform-properties.md)。此批次为待本机测试的开发分支，不代表 V0.2 全部功能完成。

## 15. V0.2 第六批：SVG 四角缩放与旋转手柄

新增 `packages/core/src/transform-gesture.ts`，由已有 `@adui/scada-core/editor` 子入口导出 `RESIZE_HANDLES`、`resolveResizeTransform`、`resolveRotationTransform`，不依赖 Vue、React 或浏览器 DOM。

- **四角缩放**：`nw/ne/se/sw` 手柄将世界坐标 Pointer 位移按图元当前角度转换至局部坐标，修改宽高和位置，使旋转后的对角锚点保持固定；几何输出保留两位小数。
- **旋转手柄**：以图元中心为旋转轴，计算起点与当前位置的夹角变化；按住 Shift 时角度以 15 度为单位吸附。返回角度限制在 Schema 已允许的 -360～360 度范围内。
- **边界及历史**：每次预览调用现有 `withNodeTransform` 做大小、页面边界及有限数校验，非法候选不会覆盖上一帧合法预览；松开 Pointer 后调用 `DocumentEditor.updateSelectedTransform` 一次，整次操作仅形成一条撤销历史。指针取消、Esc 清除临时预览。
- **双框架一致**：React/Vue 各自使用 SVG 原生 `rect/circle` 展示四角缩放和旋转控制点，Pointer 坐标经 `getScreenCTM()` 统一转换；所有缩放和旋转数值由共享 Core 计算。单选才显示手柄，多选仍使用原来的整体移动及对齐。
- **限制**：以未旋转布局矩形进行画布边界判断，旋转后外接框可能伸出画布；暂不含边中点手柄、任意非矩形路径变形、锁定宽高比或多图元批量缩放。原拖动网格吸附只应用于平移，不对手柄缩放做额外吸附。

工程 Schema、Tag ID/绑定、Runtime、工业网关和设备写入通道均未改变。参见 [ADR-0014](adr/0014-svg-transform-handles.md)。

## 16. V0.2 第七批：八方向图元缩放

扩展 `@adui/scada-core/editor` 的 `RESIZE_HANDLES` 为 `nw/n/ne/e/se/s/sw/w` 八方向；共享 `RESIZE_HANDLE_LABELS` 与 `resizeHandlePosition`，分别为双框架提供中文无障碍名称和局部控制点位置。现有 `resolveResizeTransform` 四参数接口不变。

- **四角双轴**：仍可同时修改宽度与高度。**边中点单轴**：`n/s` 仅改变高度，`e/w` 仅改变宽度；单轴切线方向的 Pointer 位移不改变几何数据。
- **旋转几何**：世界坐标 Pointer 位移按当前图元角度逆旋转到局部；根据实际宽高增量及手柄方向计算局部中心偏移，再旋转回世界坐标，固定对侧角点或对侧边中点。解决在旋转图元上沿无关方向拖动会造成中心偏移的问题。
- **精度与安全**：变化的宽、高、位置仍保留两位小数，未变化的轴保留原有精度；零位移和纯切线位移原样返回；非法手柄、非有限位移、宽高不足 0.1 均由 Core 拒绝；原 `withNodeTransform` 校验画布边界。
- **视图交互**：React/Vue 只绘制八方向小矩形，分别使用 `ns/ew/nwse/nesw-resize` CSS 光标，复用已有 Pointer 捕获、实时预览、合法候选与松开原子提交。旋转圆形手柄、Shift 15 度旋转、画布缩放、框选和群组操作保持原状。

只对单选图元显示八方向手柄；不实现保持宽高比、镜像翻转、多选批量缩放或旋转后可视 AABB 精确裁切。工程 Schema `0.1.0`、Tag ID/绑定、Runtime、后端与工业只读边界不变。详见 [ADR-0015](adr/0015-eight-direction-resize.md)。

## 17. V0.2 第八批：按住 Shift 等比例缩放

在共享 `resolveResizeTransform(transform, handle, dx, dy)` 末尾新增可选布尔参数 `lockAspectRatio = false`，保持此前调用与默认行为兼容。Vue/React 的 SVG PointerMove 和 PointerUp 在**缩放**操作时传入 `event.shiftKey`；已有**旋转**操作仍使用 Shift 15° 角度吸附，不互相覆盖。

- **原比例定义**：使用图元拖动开始时的 `width:height`，不是固定 1:1。四角 `nw/ne/se/sw` 以 X、Y 两个局部方向的相对变化量中绝对值较大的分量为主，按同一缩放比例改变宽与高。
- **四边中点**：`n/s` 的主轴为高度，锁比例时宽度沿中心向两侧对称改变，固定对侧边中点；`e/w` 的主轴为宽度，锁比例时高度沿中心对称改变，也固定对侧边中点。松开 Shift 恢复现有单轴行为。
- **旋转图元**：使用已有逆旋转局部投影和基于实际尺寸差的中心变化，保持视觉对侧锚点位置。尺寸取两位小数，允许舍入误差；宽高比近似等于原值而非无限精度相等。
- **安全及历史**：缩放因子非有限、非正或结果任一尺寸不足 0.1 时拒绝；超过 16384、未旋转布局矩形越界等交由 `withNodeTransform` 原有白名单及画布校验。PointerMove 仅进行不可变预览，PointerUp 原子提交一次命令；零位移和无尺寸变化保持原属性精度与撤销历史。
- **视图**：八个缩放手柄增加 SVG 原生提示「按住 Shift 保持宽高比」，不改既有光标、事件捕获、选中逻辑和 Runtime。

限制：未实现从中心等比缩放、强制 1:1、尺寸磁吸或多选比例缩放；仍沿用未旋转矩形画布边界校验，旋转后的显示包围盒可能外溢。依然只有单页面本地编辑，不提供正式工程发布、PLC/DCS 写入或工业网关。见 [ADR-0016](adr/0016-aspect-ratio-resize.md)。

## 18. V0.2 第九批：平面图元组合与解组

本批为 FR-005、FR-013 增加轻量**逻辑组合**，不重构现有 `ScadaNode[]` 的平面绘制顺序。共享 `ScadaNode` 新增可选 `groupId?: string`，同一页面至少两个图元以同一个稳定 ID 表示组合；未组合节点不写入 `groupId`。编辑器生成 `group-1`、`group-2` 等不会与现有页面、节点及其他组合 ID 冲突的标识。已组合成员不能直接加入另一个组合；不支持嵌套或跨页面组合。

- **导入校验**：`parseScadaDocument` 验证组合 ID 为 1～128 字符的安全 ASCII 标识、每个组合至少两名成员、ID 不与任何页面或节点碰撞、同一组合不得跨页面。返回防御性副本，保留组员原有 transform、props、bindings、rules；非法组合拒绝导入并保持既有文档不变。
- **选中语义**：`DocumentEditor.select(id, additive?)` 点击任一组员扩展整组，Shift 选择可整组切换；`selectMany` 框选/全选同样展开，选中结果仍是编辑会话状态，不另增 JSON 字段。多组 Shift 选择可同时移动、排序、删除或解组。
- **命令**：`groupSelected()` 要求至少两个且均未组合的节点，提交一次历史并返回新组合 ID；`ungroupSelected()` 移除当前所选组合成员的 `groupId`，提交一次历史。导入/导出、撤销/重做保留组合与 Tag ID。删除组合中任一成员的选中集合时删除整组，不制造单成员的非法组合。
- **移动与安全**：`grouping.ts` 中 `expandGroupedSelection` 统一服务 `withNodesTranslated` 和 `resolveDragSnap`，即便纯函数收到单个组合成员也按完整组员计算吸附、画布边界和位移。组内单独 `withNodeTransform`、属性面板、文本修改及逐节点对齐被禁止，以免破坏组合形状；原图层排序继续按照平铺节点顺序处理。
- **渲染与框架**：Vue/React 左侧列表显示组合 ID；右侧提供「组合所选」「解组」且按选择状态禁用不适用操作。图元仍以原有 SVG 及 Tag 绑定分别渲染，`Runtime` 不依赖 Editor，也不执行 JSON 中的脚本。

**Schema 兼容性取舍**：仍使用预发布 `ScadaDocument 0.1.0` 的可选字段形式，可无损读取没有 `groupId` 的旧文档；新 Vue/React 使用相同 Parser 时 JSON 往返可保留组合信息。**旧版本解析器可能丢弃新增 `groupId`，因此不保证旧版编辑器重新导出后的组合保真。**正式跨版本兼容、Schema 版本号与迁移路径在发布工程持久化前必须另行确定。设计见 [ADR-0017](adr/0017-node-grouping.md)。

限制：仅第一页面的本地编辑；没有嵌套组合、整体旋转/缩放、组合包围框、跨页面组合、组合整体精确层序或正式持久化/发布。工业网关、PLC/DCS 设备写入、Tag 采集和工业安全边界没有变化。
