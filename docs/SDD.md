# ADui SCADA · 详细设计（初稿）

> 大部分工业服务与协议接口仍为 **候选契约**，不是已存在服务。当前共享工程 Schema 为 0.3.0，已实现本地项目 Tag 定义目录、历史迁移与双框架 Studio 子集；生产保存、工业地址映射、Gateway、报警与历史仍未实现。范围编号见 [REQUIREMENTS](REQUIREMENTS.md)。

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
  schemaVersion: "0.3.0";
  projectId: string;
  tags: TagDefinition[];
  pages: ScadaPage[];
}
interface TagDefinition {
  tagId: string;
  displayName: string;
  dataType: "unknown" | "number" | "boolean" | "string";
  unit: string | null;
  description: string;
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

## 19. V0.2 第十批：工程 Schema 0.2.0 与显式迁移

共享工程格式升级为 `SCADA_SCHEMA_VERSION = "0.2.0"`，唯一允许导入升级的旧格式是 `LEGACY_SCADA_SCHEMA_VERSION = "0.1.0"`。Schema 版本号独立于 npm 包版本。本批仅改变本地工程 JSON 契约，不更改工业采集或服务端 API。

- `parseScadaDocument(input)` **只接受当前 0.2.0**，供 Runtime、SVG、编辑器内部命令和快照使用；旧版不能在编辑过程中自动升级。
- `migrateScadaDocument(input)` 是唯一的历史导入校验入口，返回 `{ document: ScadaDocument, migratedFrom: "0.1.0" | null }`。对 `0.1.0` 先执行历史字段校验，再将候选结果送入当前 Parser 二次验证并输出 `0.2.0`；当前版直接严格解析，未知、缺失、未来版全部拒绝。
- 对根、页面、尺寸、图元、几何与 Tag 绑定条目实行**已知结构字段白名单**，禁止静默丢弃未知字段；动态 `props` 与 `rules` 保留原有安全 JSON 校验。旧版 `0.1.0` 草稿含合法 `groupId` 时必须保留组合；不含组合的旧工程不新增空组合属性。
- `DocumentEditor.loadDocument` 全部校验成功后才修改工程并重置选择与撤销历史，导入失败不污染旧快照；方法返回迁移来源版本以供 Vue/React 展示相同的中文升级提示。导出总是 `0.2.0`，不支持降级保存。
- 旧版 Parser 在读取 `0.2.0` 工程时因版本不匹配而拒绝；**旧版客户端不能编辑新版工程**，历史二进制版本的行为仍须专项实测。

兼容性只覆盖严格校验的 `0.1.0 → 0.2.0` 迁移。未实现多级迁移链、服务端发布/持久化、资源包或版本协商。Runtime/Tag/工业网关的只读安全边界不变。详见 [ADR-0018](adr/0018-schema-version-migration.md)。

## 20. V0.2 第十一批：浏览器本地工程草稿

- `@adui/scada-core` 增加 `local-draft.ts`：`LocalDraftStorage` 存储适配接口，以及 `localDraftKey`、`hasLocalDraft`、`saveLocalDraft`、`readLocalDraft`、`clearLocalDraft`。Core 不访问 `window` 或 `localStorage`，使用注入式接口便于 Node 单测。
- 存储键 `adui-scada:studio:draft:<projectId>`；包裹层 `{ formatVersion: 1, savedAt: ISO8601, document: ScadaDocument }`，与工程 Schema 版本独立。限额 **2 MiB UTF-8 字节**，文档必须通过当前 `0.2.0` Parser 校验，未知包裹层结构或错误版本拒绝。
- Vue/React 增加同义的「保存草稿」「恢复草稿」「清除草稿」。已有记录覆盖、恢复替换当前画面以及清除需用户明确确认；页面首次进入只检测可恢复记录，**不自动恢复、不自动保存**。导入其他工程时根据当前 `projectId` 重新检测。
- 恢复调用现有 `DocumentEditor.loadDocument`，成功时重置选择和历史；错误文档、损坏存储、受限浏览器权限、容量不足均用中文提示，失败不能污染正在编辑的工程，也不得自动删除损坏草稿。清除只作用于对应工程的存储键。
- 本地保存不代表工程发布、服务器备份、跨设备或跨端口同步；浏览器本地存储未加密，不应写入真实设备凭据。Runtime 继续只读，完全不访问 Studio 草稿。详细取舍参见 [ADR-0019](adr/0019-local-draft-persistence.md)。

本批不实现自动保存、多标签页并发保护、历史快照、跨 Origin 同步或后端持久化。正式工程存储与发布仍须按 FR-002/008 单独设计和验收。

## 21. V0.2 第十二批：安全的本地草稿自动保存

- `LocalDraftAutoSaveSession(storage, source)` 为无框架依赖 Core 会话，记录当前 `projectId`、经过 `parseScadaDocument` 验证的工程 JSON 基线及存储原始字符串。初始化读取并验证已有草稿，损坏或不兼容格式拒绝开启，`hasExistingDraft` 供界面提示覆盖确认。
- `isDirty(source)` 仅比较当前 `ScadaDocument` 内容，不将图元选择、光标、SVG 预览或组件状态写入工程；`saveIfDirty(source)` 在内容变化时检查存储原始字符串是否仍等于会话认知的记录，冲突明确拒绝并由 UI 停写；成功写入后刷新基线。`acceptSaved(saved)` 仅用于**人工保存成功后**同步会话基线与存储版本。
- Vue/React 默认 `autoSaveEnabled = false`，用户点击开启且确认原有草稿后才建立会话。两端均用 **1000 ms** 防抖，变更、暂停或卸载时取消待写定时器；收到同一 Origin 的 `storage` 事件后暂停并提示。成功导入其他工程、恢复或清除草稿时暂停会话，手动保存仍可用。
- 进入页面时只显示本地草稿存在提醒，不自动调用 `DocumentEditor.loadDocument`。恢复需用户确认，加载成功才重置撤销历史；自动写入失败时当前画面不变、原记录不被删除，用户可导出 JSON 备份。
- `localStorage` 没有跨标签页 CAS 原子操作，**写入前冲突核对不是严格事务锁**；页面立即关闭可能损失尚未到达 1 秒的待保存修改；均须在 UI 操作与文档中明确。严格并发、恢复快照、服务端发布和工业设备写入不在本批。参见 [ADR-0020](adr/0020-safe-local-autosave.md)。

## 22. V0.2 第十二批 IndexedDB 草稿仓储（ADR-0021）

- Core 新增异步 `DraftRepository` 契约：`get(projectId): Promise<DraftRecord | null>`、`save(document, expectedRevision)`、`remove(projectId, expectedRevision)` 和跨标签页通知 `subscribe`，其中 `DraftRecord` 独立携带整数 `revision`、`savedAt`、`projectId` 和严格 `ScadaDocument 0.2.0`。编辑器仍不依赖 Dexie。
- 新建 `packages/draft-storage`，由 `DexieDraftRepository` 使用 `dexie@4.4.7`。数据库 `adui-scada-studio` 版本 1，`drafts` 主键为工程 ID，并有保存时间索引；`migrations` 记录旧草稿成功迁移或被清除的工程，防止历史备份重新复活。
- `save` 在 `rw` 事务中读取最新记录，确认 `expectedRevision` 与最新版本一致后递增修订号并写入；`remove` 在事务中按版本条件清除并留下标记。两个标签页并发写入只有满足版本条件的事务能成功。广播通知仅用于提前刷新视图状态，不能替代版本条件校验。
- 读取时优先采用已存在的 IndexedDB 工程。若无对应记录及迁移标记，再验证旧 `localStorage` 草稿，数据库草稿与标记同事务提交成功之后才尝试删除旧记录；损坏 JSON、不兼容 Schema 和其他非法字段一律拒绝载入并保留原始记录。
- Vue/React 的人工保存/恢复/清除与自动保存统一改为异步仓储；人工操作前停止自动保存会话并等待已开始的写入结束。自动恢复仍禁止，必须通过现有 `DocumentEditor.loadDocument` 受控载入。保存使用修订号条件写入，拒绝较旧标签页覆盖新记录。
- 依赖统一登记 pnpm Catalog，锁定 `dexie: 4.4.7` 与测试专用 `fake-indexeddb: 6.2.8`。新增存储包 TSConfig 使用 `@adui/tsconfig/browser`，类型检查接入 `typecheck:web`；模拟 IndexedDB 用例加入根 Vitest。
- 旧同步 `LocalDraftStorage` 和 `LocalDraftAutoSaveSession` 暂保留为**历史迁移与原测试兼容代码**，Vue/React 不再用它们进行正式草稿读写。数据库 schemaVersion 和 SCADA 工程 Schema 版本独立，不能互相替代。

本批 IndexedDB 只负责浏览器临时草稿；未实现历史版本列表、正式工程发布、服务器权限、工业设备直连或 PLC 写入。存储配额、禁止敏感凭据、跨 Origin 不互通和浏览器清理风险依旧存在。详见 [ADR-0021](adr/0021-indexeddb-dexie-storage.md)。

## 23. IndexedDB 事务安全补充（第十二批）

- `migrations[projectId]` 除记录旧草稿迁移或删除标记，还保存可选 `lastRevision`。保存时计算 `max(当前草稿 revision, 标记 lastRevision) + 1`，与数据写入在同一 Dexie `rw` 事务完成；删除时保留水位，避免删除重建的 ABA 修订号复用。到达安全整数上限时拒绝保存。
- 旧 `localStorage` 草稿的校验异常包装为 `InvalidLegacyDraftError`，与 IndexedDB 访问故障及浏览器权限故障区分。仅确定为损坏历史草稿时允许人工确认清除；版本条件删除仍不可绕过。
- `DraftAutoSaveSession.saveIfDirty` 按 Promise 异步接口统一抛错语义，非法工程不会在 Promise 返回前同步抛错；对应回归测试与 Windows 全量检查仍待维护者执行。

## 24. V0.2 第十三批：模拟 Tag 绑定编辑

- 共享 Core 提供 `editableTagSlot(type)` 和 `DocumentEditor.setSelectedBinding(slot, tagId | null)`。仅 `tank.level`、`pump.running`、`label.value` 可编辑。未单选、已组合及不支持的槽均拒绝。
- `null` 删除选定槽；重复设置不增加历史；新 Tag ID 通过既有严格 `parseScadaDocument` 校验后才提交，失败不修改工程或撤销栈。
- `waterTreatmentDemoTagOptions` 供双框架展示候选：`water.level` 支持 `level/value`，`water.pump.running` 支持 `running/value`，`water.flow` 支持 `value`。原有未知候选保留并提示不可选择。
- 所有操作沿用 `ScadaDocument 0.2.0`、JSON 导入导出和 IndexedDB 草稿；不修改 Runtime 渲染器的质量语义，不涉及真实工业设备或写入接口。

本批新增 6 项 Core 单测源码，尚需维护者 Windows `pnpm run ready`、两套浏览器交互和 JSON/草稿往返验收。

## 25. V0.2 第十四批：多页面编辑与会话作用域

- `EditorSnapshot.activePageId` 表示编辑器当前页面，不属于 `ScadaDocument`；构造、导入默认第一页，`switchPage` 不修改工程或撤销历史，并清除选择。
- `createPage` 创建与当前画布同尺寸的空页，自动生成全工程无冲突的 `page-N` ID；`renamePage` 保留 ID、节点、Tag；`deletePage` 不允许删除最后一页，删除活动页时切至相邻页。
- 页面的增删改与当前页图元修改共享最多 100 条文档历史。历史记录包含操作前后的 `pageId`，跨页面撤销/重做激活对应页面；从未修改过的页切换不会产生撤销项。
- 公共几何、框选、吸附函数与 `svgDataUrl` 增加可选页面 ID，省略时仍操作第一页；现有旧单页调用、Runtime、Schema 版本继续兼容。
- 画布图元选择、组合、对齐、几何手柄、模拟 Tag 绑定等 `DocumentEditor` 命令全部按当前页解析；Vue/React 的 `displayDocument`、SVG 预览、Pointer 手势和 Ctrl+A 同步切至当前页。
- 工程 Schema 与 Dexie `DraftRepository` 完全保持原状；切换当前页面不触发自动保存，创建、重命名、删除及图元内容变化仍遵循之前的 1 秒防抖与乐观并发修订号校验。

本批新增 12 项 Core 测试及 1 项 Runtime 测试源码，累计预计 179 项；维护者尚需执行 `pnpm run ready` 与双框架交互验收。

## 26. V0.2 第十五批：复制页面、调整顺序与跨页复制图元

- 共享 `DocumentEditor.duplicatePage(pageId?)` 默认复制当前页，将副本插在源页之后并激活新页。沿用页面尺寸与图元顺序，默认名称追加「 副本」，保留 Tag/属性/规则与几何；新页面/图元/组合分别使用 `page-N`、`node-N`、`group-N`，按全工程 ID 空间避让。
- `DocumentEditor.movePage(pageId, "previous" | "next")` 仅交换相邻页面顺序；边界操作返回 `false` 且不生成历史。实际页面顺序变更作为一条可撤销的文档命令。
- `DocumentEditor.copySelectedToPage(targetPageId)` 必须指定不同的现有目标页，并要求当前页已选图元；选择包含组合成员时先扩展完整组合。复制结果追加到目标页，组 ID 完整映射，图元 ID 唯一，Tag ID 保留；源页面及当前选择状态不变。
- 跨页复制对所选图元的非旋转矩形整体包围盒判断目标画布容量。可容纳时对全部副本施加相同的 X/Y 平移，使布局在目标范围内；不可容纳时拒绝，不静默缩放或拆组。
- `parseScadaDocument` 仍负责 Schema 白名单、全工程 ID 唯一、组合至少两成员同页、最多 100 页和 2000 个图元的统一原子校验。成功命令保留当前既有撤销/重做、JSON 和 Dexie 自动保存语义，失败保留原文档。
- Vue/React Studio 均提供「复制页面」「页面前移」「页面后移」和明确目标页的「复制选中图元」入口；选择状态、当前页面 ID 不写入工程 Schema。默认 Runtime 继续读取 `pages[0]`，重排后默认显示的页面可能变化。

关联决策：[ADR-0023](adr/0023-page-copy-and-reordering.md)。本批新增 15 项 Core 回归测试源码，整仓预计 194 项单元测试；未独立执行维护者 Windows `pnpm run ready`。

## 27. V0.2 第十六批：会话图元剪贴板

- `DocumentEditor` 增加 `copySelected(): boolean`、`cutSelected(): boolean`、`pasteClipboard(): string[]`；`EditorSnapshot.hasClipboard` 仅表示当前编辑会话可用粘贴内容，不属于 `ScadaDocument`。
- 复制从严格 Parser 校验过的工程副本提取当前页面所选图元；组成员自动完整展开。复制不写撤销历史；剪切删除源图元并建立单条可撤销历史；粘贴生成新图元和组 ID，提交单条可撤销历史并选中新副本。
- 剪贴板保存捕获时的图元、Tag 绑定、属性、规则、几何与层序。复用 `cloneNodes`/`occupiedIds` 保持全工程唯一 ID 和组完整性；导入/恢复工程成功后丢弃剪贴板。
- 每次成功粘贴从原始坐标尝试增加 `(20n, 20n)` 整体偏移，目标页不足时对全部图元使用相同的边界限制，保持相对布局和尺寸；整组包围盒超过画布则原子拒绝，不增加粘贴计数。
- 无选中复制/剪切返回 `false`，无剪贴板粘贴返回 `[]`，均不写文档或历史。Vue/React 统一拦截工作区非可编辑内容中的 `Ctrl/Cmd+C/X/V`，输入框/文本区域/选择控件/可编辑元素保持浏览器默认行为；系统剪贴板不读写。
- 工程 JSON、IndexedDB Dexie 草稿版本与 `Runtime` 工业只读边界不变；复制不触发按需自动保存，剪切/粘贴沿用已实现的安全保存会话。

关联决策：[ADR-0024](adr/0024-session-node-clipboard.md)。本批新增 13 项 Core 单测源码，整仓预计 207 项单测，仍须维护者 Windows `pnpm run ready` 和 Vue/React 浏览器验收。

## 28. V0.2 第十七批：图元状态、编辑保护和图层管理

- 使用既有 `ScadaNode.props.__scadaStudio` 记录可选的 `locked: boolean`、`visible: boolean`。缺省为未锁定且可见；解锁/显示时移除缺省字段，状态对象空时删除。`parseScadaDocument` 严格拒绝未知子字段、非对象和非布尔值。
- `studioNodeLocked/studioNodeVisible` 位于共享 `@adui/scada-core`。`DocumentEditor.setSelectedLocked(boolean)` / `setSelectedVisible(boolean)` 批量更新当前所选图元，每次修改最多一条撤销历史，未变化不入历史。
- 中央提交校验保护锁定图元的节点内容，只有显式锁定状态命令允许更改 `locked` 字段；移动、几何、文本、Tag、组合、解组、删除、剪切、复制选中、跨页复制和删除包含锁定图元的页面均受保护。独立几何/吸附 API 同样检查锁定。图层排序不允许间接改变锁定图元序号。
- Runtime `renderSvgPage` 和 Studio 画布仅渲染 `visible !== false` 图元；隐藏图元不参与框选或吸附目标，但仍可通过图层列表选中、恢复显示。`Ctrl+A` 仅选择可见未锁定图元。锁定不影响实时 Tag 展示、数据质量和只读属性。
- Vue/React 共用命令语义和中文状态提示，图层列表标识「已锁定/已隐藏」，面板提供批量锁定/解锁、隐藏/显示。输入焦点下原快捷键屏蔽保持，锁定编辑异常会在事件处理器中转换为提示。
- 保留工程 `schemaVersion: 0.2.0`、IndexedDB 草稿保存与 JSON 导入导出；早期 Runtime 对 `props` 可透传但不能正确隐藏图元，正式发布需独立版本兼容控制。

详见 [ADR-0025](adr/0025-node-lock-visibility.md)。本批新增 19 项 Core 回归测试源码，整仓单测预计 226 项，实际验证待维护者 Windows 执行。

## 29. V0.2 第十八批：精确图层插入和组合整体移动

- 新增 `DocumentEditor.moveLayer(sourceNodeId, targetNodeId, "before" | "after"): boolean`，根据当前编辑页 `nodes[]` 操作。源节点所属组合全部成员按当前顺序提取为一段，目标属于组合时以其首/末成员为插入边界。自拖放、同组拖放或最终顺序未改变返回 `false`；非法 ID 和方向明确拒绝。
- 锁定源图元或源组含锁定成员时立即拒绝；所有成功的候选顺序还必须满足原页面已锁定图元索引不变。失败不调用文档提交，不污染撤销/重做。
- 既有 `reorderSelected` 在选中内容恰好为完整单组时，将前移/后移、置顶/置底转换为相对于相邻图元或页边界的 `moveLayer` 调用；普通多选沿用原有逐层与整体操作。
- React/Vue 图层列表逆序显示 `nodes[]`（越靠上越在视觉顶层），支持 HTML5 会话内拖放，目标行上半部对应插入到目标上方（数组 after），下半部对应下方（数组 before），并显示临时插入线。
- Vue/React 均提供目标图元与插入位置选择框以及显式提交按钮，允许不拖拽的精确排序。若选择了混合多图元且不属于单一组合，则禁用该按钮；组合成员拖动仍以整组为单位。切页时清理拖拽会话状态。
- 只修改 `ScadaDocument 0.2.0` 的图元数组顺序，保留已有严格 Parser、历史上限、JSON、Dexie 草稿和只读 Runtime 行为；单纯悬停不修改文档。详见 [ADR-0026](adr/0026-precise-layer-order.md)。

本批新增 17 项 Core 回归测试源码，整仓预计 **243 项单元测试**，需要维护者 Windows `pnpm run ready` 和双框架交互复验。

## 30. V0.2 第十九批：图层树投影与编辑会话视图

- `packages/core/src/layer-tree.ts` 新增 `buildLayerTree(nodes, query?)`。输入为当前页 `readonly ScadaNode[]`，输出 `LayerTreeNode | LayerTreeGroup`；从 `nodes[]` 逆序投影，保证视觉最上层优先，组合首次在最上层组员处出现并包含全部成员，组员仍按原相对层序逆序展示。
- 组标题保存 `groupId`、`anchorNodeId`、匹配的 `members`、`totalCount`、`hasLockedMember`、`hiddenCount`、`fragmented`。旧工程的非连续组只报告 `fragmented`，不改变原数组和 Runtime 绘制顺序。
- 搜索统一在共享 Core 中进行大小写不敏感的字符串匹配：ID、类型、`props.text`、`props.name`、组 ID；组 ID 命中显示整组，成员命中只显示相关成员及组标题，空白关键字显示所有节点。非字符串搜索值显式拒绝，避免意外运行时类型。
- Vue/React 框架 UI 各自维护搜索字符串与折叠组 ID 集合。搜索期间匹配组临时展开；未搜索时折叠/展开独立于工程修改，不产生撤销历史、草稿变更或 JSON 字段；切页清空搜索，成功导入/恢复清空所有图层树临时状态。
- 组标题与成员按钮都调用既有 `editor.select(realNodeId, additive)`，由 `groupId` 语义扩展组合选中；从画布改变选中时自动展开当前组选中。定位按钮清空查询、展开当前组并滚动到图层面板行，不自动改变 SVG 视口与缩放。
- 继承第十八批的同页原生拖拽和 `moveLayer` 精确排序，组标题用 `anchorNodeId`，成员用自身 ID；组内锁定成员禁用拖动，实际锁定校验仍由共享 Core 负责。搜索与折叠只改变图层呈现，不直接修改 Tag、组 ID、层序或其他业务数据。

决策记录：[ADR-0027](adr/0027-layer-group-tree-projection.md)。本批新增 13 项共享 Core 测试源码，整仓预计 **256 项单元测试**，需维护者 Windows `pnpm run ready` 及双框架浏览器验收。

## 31. V0.2 第二十批：TDesign 双端 UI 与共享几何字段

- 根 `pnpm-workspace.yaml` Catalog 固定 React `tdesign-react@1.18.6`、`tdesign-icons-react@0.6.11`；Vue `tdesign-vue-next@1.20.11`、`tdesign-icons-vue-next@0.4.11`。两个 Web 应用各自依赖对应框架的 UI 与图标包，其他 Workspace 不添加 UI 依赖。
- React Studio 从 TDesign 按需导入 `Button`/`Input` 及独立 SVG `CloseIcon`；Vue Studio 对等导入 `Button as TButton`、`Input as TInput` 与 Vue 图标组件。分别在 Studio 页面引入官方样式，并通过 `.studio-shell` CSS 变量配置工业深色主题。
- 首轮将右侧属性面板按钮及显示文案 `Input`、左侧图层搜索和清空操作迁为 TDesign；保持既有 `editor.setSelectedLabel()`、图层过滤与定位、快捷键屏蔽、图元锁定和操作回退行为。
- 几何表单的字段与中文名称由共享 `GEOMETRY_PROPERTY_FIELDS` 决定，原来的 `FormData` → `updateSelectedTransform()` 数值校验/撤销事务仍不改变；文件输入、Tag 绑定下拉和其他原生控件在后续独立批次迁移。
- 本批不新增 `ScadaNode` 的外观字段，也不改变严格 JSON Parser、Runtime SVG 输出、Tag GOOD/STALE/BAD 语义或工业网关权限；需另行设计安全的颜色/边框/透明度 Schema。
- TDesign 安装及版本应通过完整 pnpm lockfile 校验：当前 Agent 环境无法访问 npm Registry，须由维护者联网工作区生成 `pnpm-lock.yaml` 并经检查提交。详见 [ADR-0028](adr/0028-tdesign-dual-framework-ui.md)。

本批新增 1 项共享几何字段回归测试源码，整仓预计 **257 项单测**、**2 项 E2E**、**43 份 Markdown**，所有数字仍需 Windows 实测确认。

## V0.3 第二批：工程结构化校验与离线不可变快照（ADR-0035）

- `validateProjectDocument(input:unknown): ProjectValidationResult` 复用当前严格 Parser，不自动迁移；成功返回防御性工程副本与空问题列表，失败返回 `DOCUMENT_INVALID`、`error`、字段路径与中文说明。仅返回 Parser 首错，暂不检查生产 Tag、规则可执行性或资源加载。
- `createProjectSnapshot(source,{revision,createdAt}):Promise<ProjectSnapshot>` 在 Core 中校验并防御性复制工程，要求正安全整数修订号、UTC ISO 8601 毫秒时间、最多 2 MiB 规范化 JSON；调用原生 WebCrypto SHA-256，结果包含 `formatVersion:1`、`projectId`、`revision`、`createdAt`、`hashAlgorithm`、`contentHash` 和深冻结 `document`。
- `readProjectSnapshot(input:unknown):Promise<ProjectSnapshot>` 严格验证容器字段、元数据、Schema 与完整内容摘要，并返回重新复制与深冻结的工程。哈希包括版本元数据及工程；排序对象键，数组保持原顺序。
- 修订号分配及唯一性必须由未来受控存储层提供；发布记录和 Runtime 原子切换仍待服务端鉴权与事务设计。**本模块不是已发布工程或可信签名，也不控制工业设备。**

## V0.3 第三批：本地工程版本仓储数据契约（ADR-0036）

`@adui/scada-core` 新增 `ProjectVersionRepository` 接口与 `ProjectVersionSummary/ProjectVersionQuery` 类型。接口定义：

- `getHeadRevision(projectId): Promise<number|null>`：查询本地最新版本的安全修订号，缺少时为 `null`；
- `append(document,expectedRevision,createdAt?): Promise<ProjectSnapshot>`：首次提交要求 `expectedRevision=null`，后续必须等于最后成功提交的正整数修订号；创建新快照只追加，冲突拒绝，不覆盖既有版本；
- `get(projectId,revision): Promise<ProjectSnapshot|null>`：读取单版本并验证完整内容摘要，返回防御性冻结副本；
- `list(projectId,{limit?,beforeRevision?}): Promise<readonly ProjectVersionSummary[]>`：按修订号倒序且严格排除游标，缺省 20、最多 100 项，返回元数据摘要。

`@adui/scada-draft-storage` 中的 `DexieProjectVersionRepository` 使用独立 IndexedDB `adui-scada-studio-versions`，模式 `heads: projectId`、`versions: [projectId+revision],projectId`。先在事务外使用 WebCrypto 创建快照，再在单一 `rw` 事务内重新比较当前版本、`add` 快照、更新 head，以保障并发写入只成功一次。历史快照不可修改或删除。**该 head 不得用于正式发布或 Runtime 加载**，跨 Origin 不共享；服务器事务、认证、发布指针及版本回滚均为后续独立功能。

## V0.3 第四批：本地历史版本界面与结构差异（ADR-0037）

- 新增纯 Core `compareProjectDocuments(current,historical)`：两份 `ScadaDocument 0.2.0` 经严格校验后检查同一 `projectId`，递归比较 JSON 内容；对象键顺序不计差异，数组顺序保真。返回 `{sameContent,current:{pageCount,nodeCount,bindingCount},historical:{...}}`。
- React/Vue Studio “版本历史”菜单复用 `DexieProjectVersionRepository`：打开/刷新读 `list(projectId,{limit:10})`，分页读 `beforeRevision`，点击差异时调用 `get` 重新校验摘要；“创建快照”调用 `getHeadRevision` + `append`，CAS 冲突显示中文错误。
- 历史载入再次校验快照，要求当前工程 ID 未切换且用户同意替换；确认之后等待 `pauseAutoSave` 完成，再通过共享 `DocumentEditor.loadDocument` 原子载入，清理图层/拖动会话与撤销重做。草稿数据库、历史列表和正式发布状态不被修改。取消/校验失败不修改编辑文档。
- 版本历史仅保留本地快照，不新增正式服务端 API、角色权限或发布指针。

## V0.3 第五批：恢复互斥与异常验收（ADR-0038）

- JSON 导入在文件异步读取开始前取得现有草稿操作锁，并在成功/失败后通过 `finally` 释放；所有历史操作与正在进行的导入、草稿写入互斥。没有引入新的工程 JSON 字段。
- 版本载入沿用既有确认 → `DraftAutoSaveSession.stop()` 等待事务 → `DocumentEditor.loadDocument` 的顺序；取消不停止原自动保存；确认不自动向草稿数据库写回历史内容。
- `test:versions:safety` 通过独立浏览器 profile 读取真实草稿 object store，验证内容和修订号，模拟版本历史库不可访问后确认错误反馈、已保存记录保持可用；额外测试异步 JSON 读取过程中历史载入拒绝插入。Core 新增两个确定性异步停写测试。

## V0.3 第八批：服务端工程保存契约与信任边界（ADR-0040）

- 共享 Core 的 `ServerProjectSaveRequest` 仅包含 `expectedRevision: number | null` 与 `document: ScadaDocument`；`parseServerProjectSaveRequest(input, routeProjectId)` 严格校验普通对象、两个字段白名单、正安全整数或 null、路由 ID 格式、工程 ID 一致性、现有 Schema 0.2.0 及 2 MiB UTF-8 请求容量。
- `expectedRevision:null` 只表示客户端声明首次创建，**不代表无条件覆盖**；未来写入仍需服务端在同一数据库事务里读取并比较实际 head。版本修订号、`createdAt` 与 SHA-256 摘要由受控服务端生成，不接受客户端伪造的版本元数据。
- 规划候选 REST：`POST /api/projects/:projectId/versions` 接收上述请求体；`GET /api/projects/:projectId/versions` 获取授权可见的历史摘要；`GET /api/projects/:projectId/versions/:revision` 取严格校验的快照。这些 URL **目前未注册**，响应码、分页、幂等键和部署认证方式仍需专门评审，不能据此联调生产接口。
- 写入前必须从可信服务端认证层取得主体，在服务端检查工程级权限；不能从请求体、客户端 Tag、Origin 或由浏览器传入的角色推断权限。未授权不能泄露项目是否存在。版本提交和审计须具备明确的事务一致性设计；真实发布与回滚另走审批流程。
- 不修改 `ProjectVersionRepository` 的浏览器本地历史语义、Dexie、NestJS 当前健康检查、Vue/React UI 或只读 Runtime。

## V0.3 第九批：工程级访问判定与 PostgreSQL 候选事务（ADR-0041）

- `AuthenticatedProjectPrincipal` 只能由未来受信 NestJS 身份层形成，包含 `tenantId` 与 `subjectId`；`ProjectPermissionGrant` 由服务端存储层加载，包含 `tenantId`、`projectId`、`subjectId` 与明确授权的 `permissions`。`hasProjectPermission(principal,scope,grant,action)` 在任一字段无效、缺失、未知或不一致时返回 `false`，不做管理员隐式越权或角色推断。
- 当前只区分 `project:read`、`version:read`、`version:append`；不包含工程发布、设备写入、平台管理员或跨租户特权。权限判定纯函数**不是 Guard**，不能保证传入 principal 真正经过认证。
- PostgreSQL 设计使用 `scada_projects`、`scada_project_grants`、`scada_project_versions` 和 `scada_project_audit`，以复合外键约束租户/工程范围；版本和审计只追加、修订号递增且服务端分配。工程项目必须在受控后台预先创建，不能把 `expectedRevision:null` 等价成匿名自动建项目。
- 候选版本写入顺序：服务端身份认证 → 解析可信租户工程范围 → 读取 ACL 并拒绝未授权 → 校验第八批请求格式 → 在数据库事务内锁工程行并复核授权及当前 head → CAS 比较 → 写入严格快照、head 与成功审计 → 提交。权限撤销必须与提交使用相同锁顺序；失败回滚不得声称成功审计已持久化。该事务**尚未实现**。
- 未授权或不存在的工程在最终 API 不得泄露存在性；冲突错误、幂等键、事务重试、审计失败保护、身份体系以及 ORM/迁移方案仍为待评审事项。

## V0.3 第十批：Prisma 模型与迁移配置（ADR-0042）

- `apps/server/prisma/schema.prisma` 包含 `ScadaProject`、`ScadaProjectGrant`、`ScadaProjectVersion`、`ScadaProjectAudit` 四模型，使用 `@@map`、`@map` 映射 ADR-0041 的 `snake_case` PostgreSQL 表字段，保持 `(tenantId,projectId)` 复合租户隔离。
- 版本使用 PostgreSQL `BIGINT`（Prisma `BigInt`）存储，未来业务 API 转换时须显式限制到 JS 安全整数范围；快照 `Json @db.JsonB`、UTC 时间 `@db.Timestamptz(6)`。审计与每次成功版本写入一对一；不得复用浏览器 IndexedDB 的事务语义。
- `apps/server/prisma.config.ts` 只从仓库根 `.env` 获取 `SCADA_DATABASE_URL`，生成和校验不要求生产数据库；`db:migrate:deploy` 必须在维护者配置了独立数据库后显式运行。原始 SQL 首次迁移含额外 CHECK，变更不得用无审查的 `db push` 覆盖历史。
- 本批**不实例化 PrismaClient、不注册 NestJS 工程接口、不执行版本 CAS 或生产审计**。下一批增加服务端单实例 PrismaService、可信 Guard 和真实 PostgreSQL 事务测试，先完成授权后才能开放接口。

## V0.3 第十一批：事务仓储接口与错误语义（ADR-0043）

- `PrismaService` 使用现有 `@prisma/adapter-pg` 构建单实例 `PrismaClient`，NestJS 模块初始化时 `$connect`，销毁时 `$disconnect`；缺少 `SCADA_DATABASE_URL` 直接拒绝实例化，但模块当前未挂载 `AppModule`。
- `PrismaProjectVersionStore.append(principal,projectId,input)`：身份有效性预检 → Core 请求解析 → Prisma 事务 `SELECT head_revision ... FOR UPDATE`（参数化）→ 工程有效授权查询（`version:append`）→ `expectedRevision` CAS → `createProjectSnapshot` → `scada_project_versions` → 更新 `scada_projects.head_revision` → `scada_project_audit` → 原子提交。数据库 head 使用 bigint，只在 JS 安全整数范围内转为修订号。
- `PrismaProjectVersionStore.read(principal,projectId,revision)`：事务内 `FOR SHARE` 锁工程行 → 校验 `version:read` → 读取复合主键的 JSONB 快照 → Core `readProjectSnapshot` SHA-256 验证 → 比较数据库摘要、修订号、时间及工程 ID。无授权或未知工程统一 `ProjectVersionAccessDeniedError`；版本冲突为 `ProjectRevisionConflictError`；已授权但版本不存在为 `ProjectRevisionNotFoundError`。上述错误当前**不映射到 HTTP**。
- 仓储接收的 `AuthenticatedProjectPrincipal` 必须由未来受信认证层产生；当前纯类型不能证明身份已认证，也没有授权管理端点。授权撤销流程未来必须先锁同一工程行再修改授权，防止事务之间竞态。客户端无法指定成功审计主体或服务端修订号。
- `pnpm run ready` 先执行 `db:generate`，避免未提交到 Git 的 Prisma Client 生成文件缺失；独立 server build/typecheck 也会生成客户端。真实数据库测试命令 `pnpm run test:db` 要求显式 `SCADA_TEST_DATABASE_URL` 指向本机 `adui_scada_test`，不允许直接对 `adui_scada` 或生产库运行。

### PostgreSQL 业务表和模型注释契约

- Prisma 模型 `ScadaProject`、`ScadaProjectGrant`、`ScadaProjectVersion`、`ScadaProjectAudit` 及全部 29 个模型属性（包含虚拟关联属性）均提供中文 `///` 说明，便于源码/Prisma Client 维护。
- Prisma 迁移 `20261112170000_add_chinese_table_comments` 通过 PostgreSQL `COMMENT ON` 写入 **4 张业务表、23 个物理字段、4 个自有索引**的中文元数据说明，Navicat 展示取自这些 PostgreSQL 元数据，而不是 Prisma `///`。
- 迁移仅更新描述信息，不更改表结构、主外键、现有数据或授权；已应用的初始迁移不可回改。静态单测覆盖后续新增模型/字段的注释要求；隔离 PostgreSQL 测试读取 `obj_description` 与 `col_description` 验证注释真实存在。

### 第十一批补充：跨框架共享 Core 的 NodeNext 构建契约

`@adui/scada-core` 保留 `exports["."].default="./src/index.ts"` 与 `exports["./editor"].default="./src/editor.ts"` 供 Vue/React（Bundler）使用；`exports.*.node.types` 指向相应 `dist/*.d.ts`，`exports.*.node.default` 指向 `dist/*.js`，由 `packages/core/tsconfig.build.json` 继承现有 Core tsconfig，显式覆盖 `noEmit=false` 并开启 `declaration` 与 `rewriteRelativeImportExtensions`。NestJS `NodeNext` 类型解析只读取声明，发射的服务端 JS 从 Node 条件导出加载 Core ESM 构建产物，而不会再次编译 Core 源码。

`build:core` 应在根质量链 `vp check` 和 NestJS 独立 `typecheck/build/start` 之前执行，避免生成物缺失造成的偶发失败。Core JS 和声明均属于忽略的 `dist` 产物；容器运行层需复制对应 `packages/core/dist`。

## V0.3 第十二批：事务原子性及数据库异常验证

- **真实审计回滚**：测试库中经隔离 Prisma Client Query Extension 修改审计 `action`，触发 `scada_project_audit_action_check`，确认版本 `scada_project_versions`、工程 `head_revision` 与 `scada_project_audit` 都保持在失败前状态，随后相同 `expectedRevision=null` 可成功保存。仅测试扩展能够注入故障，正式仓储仍不可由请求体修改审计操作。
- **授权撤销与版本保存竞态**：测试管理事务先在 `scada_projects` 取得 `FOR UPDATE` 锁，再删除同一工程的 `version:append` 授权；并发 `append` 等待锁释放后，必须因重新查询授权而拒绝，保持 head 为 0，不生成版本或成功审计。本批**不新增授权撤销路由或服务**；将锁顺序作为未来权限服务必须遵循的约束。
- **连接异常**：普通单测验证缺失 `SCADA_DATABASE_URL` 时拒绝构建 `PrismaService`；隔离数据库集成测试验证指定不可达的本地回环端口时查询失败，随后释放 Prisma 资源。错误日志不得主动打印完整连接 URL/密码。
- **容器验证**：以独立 Docker 镜像在 `--network none` 下加载编译后的 Prisma 仓储/共享 Core，并从容器内部验证回环 `/health` 和未开放路由；不影响当前工业安全边界。

本批不修改 `schema.prisma` 或历史迁移，所有新增测试数据只归属于随机生成的测试租户，测试结束按 FK 顺序清理。

## V0.3 第十三批：会话与租户工程权限契约

- `ScadaIdentity`：`(tenantId,subjectId)` 复合主键，状态仅允许 `active/disabled`，不保存密码或角色。
- `ScadaAuthSession`：UUID 主键，租户+主体 FK，令牌 SHA-256 摘要唯一，令牌过期时间必须晚于签发时间，显式撤销时间可为空；数据库端有 CHECK、FK、索引及全字段中文注释。
- `AuthSessionService.issueForVerifiedSubject(principal)`：仅未来受信身份提供者可调用；主体必须在 DB 存在且 active，使用 `randomBytes(32)` 签发高熵令牌，固定有效期 15 分钟，返回一次性明文与 UUID 会话标识；**当前无公开调用入口**。
- `AuthSessionService.authenticate(token)`：仅接受格式正确的 `scada_s_` Bearer 密钥，SHA-256 查唯一索引，每次复核撤销、时间、身份状态，返回冻结的最小主体上下文，失败统一返回 null。
- `AuthSessionService.revokeForVerifiedSubject(principal,sessionId)`：仅精确匹配当前主体与 UUID 会话，重复/跨租户撤销失败，不提供公开 API。
- `ScadaSessionGuard`：仅 HTTP，拒绝空、过长、重复头和无效 Bearer，成功才写 `request.scadaPrincipal`；不会接受请求体中的主体字段。
- `ScadaProjectGuard`：拒绝未声明 `RequireProjectPermission` 元数据的路由、无主体、非法工程 ID、URL 中跨租户、没有当前主体的精确工程授权；通过 `scada_project_grants` + 共享权限策略评估 `project:read/version:read/version:append`。缺少授权统一呈现为资源不可访问（404），无可信主体为 401。
- **安全边界**：上述代码尚未挂入 `AppModule`、未注册 HTTP 路由，Guard 只作为未来保护路由的基础；读取/写入仍须按业务事务再复查权限，令牌撤销与进行中的写入之间的竞态、完整账号生命周期和真实身份提供者仍待独立安全评审。

## V0.3 第十四批：日志与 API 文档契约

- `SCADA_LOG_LEVEL` 仅接受 `fatal/error/warn/info/debug/trace/silent`，默认 `info`。非法等级在服务端兜底为 `info`，环境检查对明确设置的无效值直接报错。
- 每个 HTTP 请求通过 Node `randomUUID()` 产生新的请求关联 ID，并写入 `x-request-id` 响应头。**不直接信任用户提交的关联 ID**。日志仅允许请求 ID / 方法和响应状态码，URL 查询、Header、Body 不进入常规日志；Pino 的 `redact` 对常见敏感字段再次防护。
- `SCADA_API_DOCS_ENABLED` 默认 `false`，仅值 `true` 可启用；且要求 `NODE_ENV !== production`、NestJS 监听 `127.0.0.1`。任何条件不满足时不注册 `/api/docs` 与 `/api/docs-json`。开发 Swagger 开启时禁用 CSP 仅为交互 UI 兼容，正式部署仍使用 Helmet 默认 CSP。
- `GET /health` 在 OpenAPI 中只包含 `status='ok'` 与 `service='adui-scada-server'`；**不能视为数据库就绪/工业网关可用的证明**。OpenAPI 中没有登录、会话签发、工程版本读写或工业设备写入方法。
- 生产 Pino 运行时使用 `nestjs-pino` v5 + Pino v10 + `pino-http` v11；Swagger 使用 `@nestjs/swagger` v12、HTTP 安全头使用 `helmet` v8。本批不升级现有 NestJS 12 / Prisma 7 / Vite+ / TypeScript 6。
- 相关依赖已由维护者使用 pnpm 12.18.0 更新锁文件，第十四批 Windows 已实测 `ready` 退出码 0（356 单测、8 E2E）；此时只属于健康 HTTP 基线而非生产认证发布。

## V0.3 第十五批：安全启动配置与环境加载契约

- `main.ts` 必须先通过 Node.js `loadEnvFile` 加载根目录 `.env`，**随后**动态导入正式 `AppModule`，以免 `LoggerModule.forRoot` 在根环境变量生效之前读取日志等级。
- `resolveServerStartupConfig(env)` 是纯函数：专用 `SCADA_SERVER_PORT` / `SCADA_SERVER_HOST` 优先于通用 `PORT` / `HOST`；默认值仍为 3001 和 127.0.0.1。端口必须是 1～65535 的整数；监听主机仅允许 127.0.0.1 或 0.0.0.0，不回显非法原始输入。
- Swagger 沿用 `allowLocalOpenApi` 的原有条件，`SCADA_API_DOCS_ENABLED=true`、非生产且本地回环三个条件必须同时成立；该配置不能绕过生产禁用策略。
- 单独的配置测试和 `env:check` 静态顺序断言共同避免回归，见 [ADR-0047](adr/0047-server-configuration-startup.md)。

## V0.3 第十六批：安全审计事件契约

- `SecurityAuditDecision` 包含 `action`、`outcome`、`reason` 三项固定枚举；服务端 `createSafeSecurityAuditRecord` 只增加固定的 `category="scada_security"`，**不得复制任何外来属性**，也不允许将 Header、原始令牌、错误对象或租户/工程路径放入事件。
- `action` 仅为 `session.authenticate` 和 `project.authorize`，`outcome` 仅为 `allowed` 与 `denied`。会话允许原因只能是 `verified`，拒绝原因仅有 `unsupported_context`、`malformed_authorization`、`invalid_session`；工程允许原因只能是 `permission_granted`，拒绝原因仅有 `unsupported_context`、`missing_policy`、`missing_principal`、`invalid_scope`、`permission_denied`。
- 未定义事件、无效结果或错误搭配必须拒绝且不在异常提示中回显输入值。Guard 在已有授权语义中记录固定决策，不得改变授权结果或异常 HTTP 状态码。
- `ScadaSecurityAuditService` 通过 NestJS `Logger` 发送仅含白名单字段的 JSON 消息；**不是强一致、可回放、可归责的持久化安全审计系统**，不替代工程版本事务审计或未来工业控制审计。模块仍未挂载正式 AppModule，详见 [ADR-0048](adr/0048-security-audit-event-boundary.md)。

## V0.3 第十七批：Zod 与 NestJS 12 原生 Schema 契约

- `serverPortSchema` 仅接受字符串或数字，转换为有限整数并限制在 1～65535；`serverHostSchema` 仅允许 `127.0.0.1` 和 `0.0.0.0`。仅在值为 `undefined` 时应用通用变量或默认值，非法 `null`、布尔值及其它非字符串环境值必须拒绝。
- `SCADA_SERVER_PORT` 高于 `PORT`、`SCADA_SERVER_HOST` 高于 `HOST`；默认 3001 / 127.0.0.1。校验失败只抛固定中文消息，不记录原始值或 `ZodError`。Swagger 仍遵守显式开启、非生产、回环地址三重条件。
- HTTP DTO 采用 NestJS 12 原生 `@Body({ schema })`、`@Query(..., { schema })` 和 `StandardSchemaValidationPipe`；响应允许使用 `StandardSchemaSerializerInterceptor` 与 `@SerializeOptions({ schema })`，Swagger 12 从 Zod 4 Standard JSON Schema 生成请求文档。
- 本阶段仅通过 `standard-schema-integration.spec.ts` 的独立测试 Controller 验证该技术契约，正式 `AppModule` 不挂载任何新业务 API 或全局 Pipe。之前的 `nest-zod@2.1.0` 因 Windows 实测 Swagger 装饰器故障及 Peer 版本声明不满足 NestJS 12，已移除。
- 输入校验不能代替 Session/ACL Guard、事务复核或敏感日志白名单。共享 Core 工程 Schema、Pino、Prisma、Vue/React 均保持不变。参见 [ADR-0049](adr/0049-zod-server-runtime-validation.md)。

## V0.3 第十八批：HTTP 就绪探针契约

- `GET /health` 继续返回 HTTP 200 以及原有 `{status:"ok",service:"adui-scada-server"}`，仅用于 Liveness，不检查任何外部依赖。
- `GET /health/ready` 仅在 NestJS `onApplicationBootstrap` 已完成且未进入 `beforeApplicationShutdown` 时返回 HTTP 200；其他状态通过 Terminus `HealthCheckService` 返回 HTTP 503。结果固定报告 `http` 指示器以及 `scope:"http"` 和 `dependencies:"not_checked"`；`Cache-Control` 禁止缓存。Swagger 在本机受控文档中包含就绪探针，不额外公开文档。
- 本批没有注册数据库、网关与设备状态检查，不能据此判断 PLC 采集、Tag 实时质量或控制通道就绪。将来引入真正业务依赖就绪时须增设检查与安全评审，避免误用存活探针。
- 现有 `ScadaSessionGuard`、工程 ACL、版本读写、工业设备写入路由仍未注册；暂不对健康探针引入 `@nestjs/throttler` 全局配额，未来受保护业务 API 的限流策略另行设计，见 [ADR-0050](adr/0050-http-readiness-terminus.md)。

## V0.3 第十九批：HTTP 原生接收与连接策略

- `SCADA_NEST_HTTP_OPTIONS`：`cors:false`、`bufferLogs:true` 延续原契约，增加 `return503OnClosing:true`；不设置 `forceCloseConnections`，使已进入处理阶段的请求有机会完成。
- `applyHttpServerPolicy` 在 `app.listen` 前配置 Node HTTP Server：`headersTimeout=15000` ms、`requestTimeout=60000` ms、`keepAliveTimeout=5000` ms、`maxHeadersCount=100`、`maxRequestsPerSocket=1000`。`requestTimeout` 限制**请求接收**，不对业务 Handler 及 SSE 长期响应设置统一超时。
- 应用进入关闭流程时，新请求可直接收到 NestJS 12 适配器生成的 503 / `Connection: close`，健康探针仍符合原语义，但在关闭过程中可能被入口统一拒绝。关闭测试通过 `app.close()` 与延迟销毁钩子模拟，不冒充 Windows SIGTERM 测试。
- 不修改请求/响应 JSON、HTTP 安全响应头、Swagger 默认关闭、Pino 脱敏和 `/health`、`/health/ready` 正常期契约。未开放的登录、工程版本读写和工业设备写入继续为 404。详见 [ADR-0051](adr/0051-http-ingress-shutdown-policy.md)。

## V0.3 第二十批：Linux SIGTERM 与退出码契约

- `main.ts` 使用 NestJS 12 `enableShutdownHooks([], { useProcessExit: true })`，保持默认信号集合；关闭钩子成功完成后进程退出码为 0（不同于默认清理后重发 SIGTERM 的 143），异常清理仍按 Nest 实现返回失败。
- Docker 第二阶段以 Node 作为正式容器 PID 1，不映射宿主端口、`--network none`；探针必须在回环地址验证 `GET /health`、`GET /health/ready` 为 200，未开放 `POST /api/devices/write` 为 404。
- `docker stop --signal SIGTERM --timeout 10` 结束服务，`inspect` 校验退出码 0，非零或超时必须失败；`finally` 清理独立容器，正常 E2E 与第一阶段烟测保持不变。
- 本批验证正式镜像的 Linux 信号，不验证实际在途请求持续时间、SSE/WS/网关断线、业务审计一致性或 PostgreSQL 连接收尾；参见 [ADR-0052](adr/0052-linux-sigterm-container-shutdown.md)。

## V0.3 第二十一批：本机模拟工程与 Tag 只读接口

- 根 `.env` 新增 `SCADA_LOCAL_DEMO_API_ENABLED=false`，只有严格 `true` + 非生产 + 有效服务端监听地址 `127.0.0.1` 才允许在主 Nest 入口选择 `LocalDemoAppModule`；否则仅挂载原正式 `AppModule`，演示接口实际不存在（404）。Swagger 使用独立的 `SCADA_API_DOCS_ENABLED` 白名单，二者不会相互启用。
- `GET /api/dev/demo/project`：只读共享 `waterTreatmentDemoDocument`；`GET /api/dev/demo/tags`：只读共享 `TagStore.snapshot()`，固定 `{kind:"snapshot",values:[...]}`；`GET /api/dev/demo/events`：SSE 初次订阅输出 snapshot，此后输出 delta，事件数据结构直接使用 `TagChange`，不新增协议封装。
- 模拟器每秒更新一批固定 Tag，30 秒循环的后 8 秒不再采样，旧值超过 2.5 秒标记为 STALE，恢复后通过 `resumeAfter` 保证新 sequence 严格递增。模块关闭释放定时器，SSE 断开取消 TagStore 订阅。
- 本批没有真实工程版本 HTTP API、正式认证/ACL、工业写入、数据库/网关、现场设备与生产消息总线。Vue/React Web 仍使用既有独立模拟服务 `/demo`，只有本机 Nest Swagger 供新接口诊断。见 [ADR-0053](adr/0053-local-readonly-demo-telemetry.md)。

## V0.3 第二十二批：只读 Tag Source 契约与 Snapshot 门槛

```ts
interface ReadonlyTagSource {
  loadProject(signal: AbortSignal): Promise<unknown>;
  subscribe(handlers: ReadonlyTagSourceHandlers): ReadonlyTagSubscription;
}
interface ReadonlyTagSourceHandlers {
  onMessage(raw: unknown): void;
  onDisconnected(): void;
}
interface ReadonlyTagSubscription {
  close(): void;
}
type DemoTagSourcePreset = "standalone" | "nest-local";
```

`createSseTagSource()` 默认使用 `/demo/project`、`/demo/events`，`createSseTagSource("nest-local")` 固定使用 `/api/dev/demo/project`、`/api/dev/demo/events`；禁止绝对 URL、用户输入地址或协议降级。工程加载使用 `fetch` 的 `cache:"no-store"` 与调用方 `AbortSignal`，非 2xx 或 HTML 响应明确失败。EventSource 保持原生重连；只向 Runtime 传递原始消息，不在适配器中绕过 Core 校验。

`DemoRuntime(listener, source = createSseTagSource())` 保持现有单参调用兼容。每次 `start` 创建独立 `generation` 和 AbortController；`stop` 中止加载、关闭订阅、标记旧值 STALE 并使迟到消息失效。加载工程、连接 SSE 和 onMessage 过程中都要检查代次，尤其处理订阅回调可能在 subscribe 返回前同步发生的边界。首次连接和每次 onDisconnected 后必须先通过 snapshot 原子替换数据，后续 delta 才能通过原有 `TagStore.apply` 接受。无效事件进入 error 并关闭订阅，不允许之后的迟到数据将它改回 live。

桌面 `OfflineDemoRuntime` 仍用原本纯本机模拟，不被新的浏览器网络接口取代。Vue 与 React Runtime 继续共享相同实例化代码路径，未新增 UI 切换选项；真实发布快照与经过鉴权的在线订阅属于后续范围。参见 [ADR-0054](adr/0054-readonly-tag-source-adapters.md)。

## V0.3 第二十三批：心跳和静默超时的协议细节

- 模拟 SSE 每 5 秒额外发送：`event: heartbeat`、`data: {}` 和 SSE 事件间隔空行；原默认 `data: {"kind":"snapshot"|"delta","values":[...]}` 不变。具名 heartbeat 不进入 `TagChange` 校验链，不能更新 Tag 时间戳、序列号或质量。
- `packages/runtime/src/tag-source.ts` 的 transport watchdog 为 15 秒：EventSource 的默认 onmessage 或具名 heartbeat 都表示传输活动，原生 `onerror` 保留自动重连；连续 15 秒无事件时调用 `onDisconnected`、关闭旧 EventSource 并重建相同固定同源路由。旧实例事件按对象身份阻断，close 后不得重建。
- `packages/runtime/src/runtime.ts` 仅统计 Core 校验成功的非空 snapshot 或被 TagStore 按序列号接受的 delta；空增量和重复旧序列不能更新数据时钟，以 12 秒作为 Tag 数据静默窗口。第二十四批起达到窗口后仅在 Runtime 展示层按 Tag ID 降级 `STALE`（不再调用会消耗上游序列号的 `markDisconnected`）；当上游发送含 STALE 的 Tag 时也展示 stale，仅相应 Tag 收到有效的新序列 GOOD 才恢复其质量，所有 Tag 均恢复后才显示 live。网络断连仍执行 `markDisconnected`。心跳和空 delta 不是有效数据更新。网络断连维持 reconnecting，新的 SSE 会话必须先收到 snapshot。
- 水处理既有 30 秒模拟周期含 8 秒停采样不变；服务端心跳计时器和 Runtime 数据计时器必须在关闭或非法事件时清理。以上 5/12/15 秒仅为本机模拟参数，不可直接推广为生产设备采样 SLA。
- 不修改工程文档、TagValue/TagChange 正式字段，Vue/React/桌面 API 保持兼容，禁止新增设备写入和任意 PLC 地址。见 [ADR-0055](adr/0055-sse-heartbeat-and-tag-silence.md)。

## 2026-11-13 · V0.3 第二十四批：页面可见性恢复复查

仅在现有模拟只读 SSE 数据源和共享 DemoRuntime 增加 `visibilitychange` 前台恢复处理：SSE 看门狗保存最近一次有效网络事件接收时间，回到前台时若已连续超过 15 秒没有 Tag/SSE 心跳则先通知断连、关闭旧连接并创建同源新 EventSource；Runtime 回到前台时若已连续 12 秒没有被 TagStore 接受的新 Tag 则显示 `stale`，不得借心跳伪造数据新鲜度。监听在 `close()`、`stop()` 和无效数据会话失败时清理。本批修正数据超时处理：展示层按 Tag ID 标记过期，不改变 Core TagStore 的原始序列，单个 Tag 恢复不清除其他 Tag 的过期状态。没有增加外部订阅接口、工程 Schema 字段、Tag 协议类型和设备写入能力。见 [ADR-0056](adr/0056-sse-browser-visibility-recovery.md)。

## 2026-11-13 · V0.3 第二十五批 SSE 模拟写入与连接生命周期

独立本机 `GET /events` 保留现有 `text/event-stream`、默认 `snapshot/delta` 及具名 `heartbeat` 格式。最多 32 个连接，超过时返回 HTTP 503、`Retry-After: 5` 与中文错误说明；不发送 SSE 成功头。每路响应在写入前检查 `writableLength + UTF-8 字节数 <= 64 * 1024`；写入出现 `false` 背压、异常或超限则立刻删除并销毁该慢客户端，剩余连接正常广播。断开检测基于响应 `close` 事件，Node 进程收到终止信号时结束所有响应和计时器。

本批无协议字段变更、不重试或缓冲旧增量；恢复使用新的 snapshot。固定本机代理测试通过 `test:sse:network`/`test:sse:proxy` 完成，不包含真实网关或生产级消息可靠性。见 [ADR-0057](adr/0057-local-sse-capacity-and-proxy-validation.md)。

## 2026-11-13 · V0.3 第二十六批：TCP SSE 半开样式测试行为

仅在测试进程执行 `startSseFaultProxy`：接受 loopback HTTP 根地址，分配回环随机端口，将普通 HTTP/TCP 流直接透传；对已确认 snapshot 的唯一 SSE 会话设置下行字节丢弃，不主动发送 FIN/RST，新连接正常通过。Chrome/Edge 真实浏览器使用既有 Runtime 展示状态进行验收：live → stale → 旧 EventSource 主动 close → 新 EventSource snapshot → live；离开 Runtime 后要求测试代理 SSE socket 数量归零。不修改 runtime 5/12/15 秒阈值、消息 Schema、Tag 序列、质量枚举或业务路由。长连接测试仅在显式 `--soak` 时对六路订阅追加至少 12 次心跳、增量到达及最大间隔检查，正常测试运行不增加等待。见 [ADR-0058](adr/0058-tcp-sse-fault-and-soak-tests.md)。

## 2026-11-13 · V0.3 第二十七批：共享 Runtime 诊断快照契约

`RuntimeState` 新增必填字段 `diagnostics: RuntimeDiagnostics`，由 `packages/runtime/src/diagnostics.ts` 创建，字段为 `reconnectCount: number`、`lastTagReceivedAt: number | null`、`dataAgeMs: number | null`、`tagCount: number` 及 `qualityCounts: Readonly<Record<TagQuality, number>>`。计数器每次 start 归零，仅在状态进入 reconnecting 时增加；重复 onDisconnected 不重复计算。最近数据时间只取本机通过 Core 校验的非空 snapshot 或接受了新序列的 delta 到达时间，心跳与旧/空增量不刷新。年龄在 publish 时由本机时间差构造，不附加计时器或假定源端时钟准确。质量计数基于最终对外展示的 values，包括局部 STALE 覆盖；离线模拟继承该类型，断连次数固定为零。Vue/React 只绑定同一字段，不产生各自的诊断算法；见 [ADR-0059](adr/0059-runtime-local-diagnostics.md)。

## 2026-11-13 · V0.3 第二十八批：Runtime 状态历史契约

`RuntimeDiagnostics` 新增必填只读数组 `statusEvents: readonly RuntimeStatusEvent[]`。`RuntimeStatusEvent` 包含 `sequence: number`（会话内序号）、`status: RuntimeStatus` 与 `occurredAt: number`（本机毫秒时间）。共享 `RuntimeStatusHistory` 的 `record` 连续相同状态去重，`snapshot` 返回副本，`clear` 在新会话开始时复位，容量固定 20 条并保持最新在前。只有 Runtime 的 `publish` 会写入状态变化；不保存动态错误、Tag 值或原始网络帧，`stop` 不额外向已离开的页面发布 idle。Vue/React 展示组件共用 `runtime.css`，不实现独立状态判定。详见 [ADR-0060](adr/0060-runtime-session-status-history.md)。

## 2026-11-14 · V0.3 第二十九批：Tag 定义与 TagValue 类型边界

`packages/core/src/tag-definition.ts` 定义 `TagDataType = number | boolean | string` 和 `TagDefinition`（`tagId/displayName/dataType/unit/description`）。`TagDefinitionCatalog` 对输入执行严格字段、ID、长度、类型及重复 ID 校验，返回防御性副本；`rename(tagId, displayName)` 返回新目录，仅更改可变显示名称，图元绑定仍按稳定 `tagId` 引用。

`TagStore(catalog?)` 保持可选目录：不传目录时维持通用标量契约；传入目录时，`apply` 与 `replaceSnapshot` 在状态修改前校验每个非空值的 JS 类型与定义一致，任何一项失败均不部分提交。空值 `null` 保留为无有效读数；质量不进入静态定义，仍由 `TagValue.quality` 动态表达。当前水处理目录为水位 number/%、水泵 boolean/无单位、流量 number/m3/h。DemoRuntime、OfflineDemoRuntime 与独立 SSE 服务共享目录，双框架绑定候选展示类型、单位及描述。

此批未升级工程 Schema 0.2.0，Tag 目录未持久化，重命名不是保存操作；没有地址映射、协议 NodeId/寄存器/Topic、单位转换、设备连接或写入。见 [ADR-0061](adr/0061-tag-definition-catalog.md)。

## 2026-11-14 · V0.3 第三十批：项目级 Tag 定义与 Schema 0.3.0

### 工程根结构

`ScadaDocument` 从 `0.2.0` 升级为 `0.3.0`，新增必填 `tags: TagDefinition[]`。定义字段为稳定 `tagId`、可变 `displayName`、`dataType`、`unit`、`description`。当前 `dataType` 包括 `unknown/number/boolean/string`；`unknown` 仅用于历史迁移占位，不能作为新的绑定候选。Tag 定义不存质量、值、设备地址、连接串或写入权限。

### 解析与迁移

- `parseScadaDocument` 仅接受当前 0.3.0，必须包含 Tag 定义数组，所有图元绑定必须引用已定义 Tag；Tag ID 全工程唯一，目录上限 4096。
- `migrateScadaDocument` 显式接受 0.1.0 和 0.2.0，收集历史工程绑定的 Tag ID，为其创建 `unknown` 类型占位定义，保留原绑定。未知/未来版本拒绝。
- 历史类型未知时不推断 number/boolean/string。TagStore 在定义为 unknown 时允许已有标量通过，Studio 不允许将 unknown 作为新绑定候选；维护者确认真实类型后启用严格类型校验。
- 当前工程删除 Tag 前检查所有页面绑定，存在引用则拒绝；稳定 tagId 不允许更新。新增/修改/删除项目 Tag 定义通过共享 DocumentEditor 命令，支持撤销/重做。

### 持久化与历史兼容

- 工程 JSON 根结构直接携带 `tags`，跨 Vue/React 导入导出不依赖第二份本地目录。
- LocalStorage 与 Dexie 草稿读取支持 0.1/0.2 → 0.3 迁移；Dexie 已存在草稿在同一事务内写入迁移结果并递增 revision，跨标签页收到更新通知。
- Project Snapshot 仍使用容器 formatVersion 1。读取旧 Schema 时先验证原始文档的 SHA-256，再生成当前 Schema 查看副本，保存 `sourceContentHash` 和 `migratedFrom`，归一化视图自身也重新计算摘要；原始历史记录不被原地改写。
- 现有数据库无需新增 Tag 表或 Dexie object store；Tag 定义与页面/绑定属于同一工程文档版本。

### 编辑器与 UI

`DocumentEditor.addTagDefinition/updateTagDefinition/removeTagDefinition` 修改工程根 tags 并纳入撤销/重做。更新接口不接受 tagId；删除被引用 Tag 时失败。Vue/React 绑定候选从当前工程 tags 派生，按 level:number、running:boolean、value:scalar 的共享槽位规则过滤；目录展示显示名称、ID、类型、单位与描述。当前批没有完成可视化新增/编辑/删除表单，后续批次继续。

### 验收边界

项目级 Tag 定义现在随工程 JSON、草稿和本地历史快照持久化，但没有生产服务端项目 API、用户权限、工业地址映射、OPC UA/Modbus/MQTT 驱动、真实设备或写入接口。历史 unknown 定义需维护者确认；自动迁移不等于推测类型。

## 2026-11-14 · V0.3 第三十一批：项目 Tag 可视化管理交互契约

### 组件与命令边界

React 的 TagManager.tsx 与 Vue 的 TagManager.vue 只保存用户正在填写的临时表单草稿，绑定候选和定义列表始终来自各自 Studio 当前工程的 tags。新建通过 DocumentEditor.addTagDefinition，编辑通过 updateTagDefinition，删除通过 removeTagDefinition，返回值和异常交由 Studio 更新快照和中文通知。所有数据校验、绑定关系与历史命令仍只由共享 Core 决定。

### 字段、错误和持久化

- 新建输入 tagId（稳定 ASCII 1～128 字符）、displayName（1～128 字符）、dataType（number/boolean/string）、可选 unit（空值转 null、非空 1～32 字符）和 description（最长 512 字符）。
- 编辑显示只读稳定 ID；历史 unknown 可修改为明确类型。Core 阻止已确认类型退回 unknown、不兼容图元槽位的类型修改以及仍被绑定的 Tag 删除。
- 删除需要明确确认，不隐式清理任何绑定。操作失败保持表单内容供修正，并将 Core 中文异常展示到 Studio 通知。
- 操作成功由 DocumentEditor 生成新工程并纳入 undo/redo；工程 JSON、本地 IndexedDB 草稿和历史快照无需单独新增 Tag 存储路径。

### 浏览器验证

新增 pnpm run test:tags:browser，使用当前已有 CDP 浏览器验收设施，在 React/Vue 两端验证新增、编辑、删除保护和删除，并读取实际导出的 JSON 做一致性断言。维护者 Windows 实测两端通过，退出码 0；ready 和 test:interop 同样通过。键盘/视觉人工检查仍可后续完善。

见 [ADR-0063](adr/0063-studio-tag-management-dual-framework.md)。

## 2026-11-14 · V0.3 第三十二批：历史工程与浏览器持久化迁移回归契约

浏览器 CDP 测试新增 --legacy 模式，按 React、Vue 两个 Origin 分别执行三条真实迁移路径：

1. localStorage：构造 LocalDraft 格式版本 1 包装和 0.2.0 工程，刷新 Studio 触发真实 DexieDraftRepository 读取迁移，验证写入 IndexedDB 后才清理旧键，并通过 UI 恢复草稿。
2. IndexedDB：在既有 adui-scada-studio 数据库中写入 revision 4 的 0.2.0 草稿，刷新 Studio 触发事务迁移，验证 Schema 0.3.0、revision 5、unknown Tag 及原绑定，并通过 UI 恢复。
3. Project Snapshot：在既有 adui-scada-studio-versions 数据库中构造 formatVersion 1 的 0.2.0 历史快照，按 Core 稳定键排序规则计算原 SHA-256；经 Studio 版本历史载入，验证当前文档副本迁移到 0.3.0、Tag 为 unknown、绑定保留，同时读取原记录确认原摘要与旧文档未被改写。

三条路径在 Vue/React 两端独立执行；测试只使用隔离 Chrome/Edge 用户目录和本机开发服务，不触碰真实用户 Profile、生产数据库或工业设备。新增 pnpm run test:legacy:browser，详见 [ADR-0064](adr/0064-legacy-browser-migration-validation.md)。当前仅完成测试代码与静态审查，未在 Windows 实际运行。

## 2026-11-14 · V0.3 第三十三批：OIDC、BFF 会话与服务端工程 API 契约

### 认证流程

服务端固定 Issuer Discovery，使用 Authorization Code + PKCE S256；每次登录生成独立 state、nonce、code_verifier。OIDC 登录事务存 PostgreSQL，state 只存摘要，PKCE verifier 用 AES-256-GCM 加密，事务 5 分钟过期并通过条件更新一次性消费。短时 HttpOnly 浏览器绑定 Cookie 将登录事务绑定到发起浏览器，回调地址固定使用服务端配置，不信任 Host/Forwarded Header。

ID Token 由 openid-client 验证签名、Issuer、Audience、时间声明和 Nonce。只用 iss/sub 查预先绑定的外部身份映射，必须关联 active 的 ScadaIdentity；不使用 email、用户名、groups、roles 或客户端提交的 tenant/subject 作为身份和 ACL 来源，不做 JIT 用户创建。

### 内部会话与 CSRF

认证成功后调用现有 AuthSessionService 签发 15 分钟内部不透明会话。浏览器只持有 HttpOnly/Secure/SameSite=Lax/Path=/ 的 Host Cookie，不存储 IdP Token 或内部令牌到 Web Storage。Cookie 写请求必须同时验证精确 Origin 白名单、Fetch Metadata 和绑定当前会话的 CSRF Cookie/Header；Bearer 与 Cookie 认证路径不可混用。退出只撤销 ADui SCADA 本地会话。

### 工程 API

API 使用同源 /api/v1 前缀。初始提供 OIDC start/callback、me、logout、工程创建/列表/摘要、版本列表/读取/追加。工程创建把工程行、创建者 ACL、首个 Project Snapshot、head revision 和成功审计放入同一 PostgreSQL 事务；追加沿用 CAS 与工程行锁；读取/列表在服务端重新校验 tenant/subject ACL。API DTO 不接受 actorId、tenantId、subjectId 或角色字段。当前不含发布指针、审批、回滚、删除或设备写入。

### 模块和部署

新增共享 DatabaseModule，保证身份模块和工程持久化模块复用同一个 PrismaService。OIDC 模块仅在 SCADA_OIDC_ENABLED=true 且配置完整时注册；默认 AppModule 仍只提供健康探针且不连接数据库。React/Vue Vite 与 Docker Nginx 使用同源 /api 代理，不开放宽泛 CORS。框架无关 API Client 统一 Cookie、CSRF、响应和错误契约。

详见 [ADR-0065](adr/0065-oidc-bff-and-project-api.md) 与 [实施计划](plans/v0.3-batch-33-oidc-project-api.md)。

### 第三十三批阶段 A 已实施的配置与数据库结构

OIDC 配置解析器只在 `SCADA_OIDC_ENABLED=true` 时验证 Issuer、Client ID/Secret、Redirect URI、Origin 和 Base64URL 32 字节加密密钥；生产配置必须使用 HTTPS，非生产回环 HTTP 必须另行显式启用。所有错误均使用固定中文提示，不包含原始凭据。阶段 A 当时 `main.ts` 对 enabled 拒绝启动；第五小批完成身份 HTTP 边界后，当前入口仅在完整配置通过时挂载身份模块，工程 API 仍未开放。

共享 DatabaseModule 持有唯一 PrismaService 提供方，ScadaIdentityModule 和 ProjectPersistenceModule 都只通过 imports 使用它；默认 AppModule 仍不导入上述模块。

新增 ScadaExternalIdentity，以复合主键 (issuer, subject) 关联现有本地 ScadaIdentity；新增 ScadaOidcTransaction，使用 stateHash 主键、浏览器绑定摘要、nonce、AES-GCM 加密密文、到期/消费时间及站内路径；为 ScadaAuthSession 添加可空 csrfTokenHash，兼容既有 Bearer 会话。上述模型与迁移已在维护者本机隔离 `adui_scada_test` 应用，`pnpm run test:db` 的 16/16 真库测试通过。阶段 B 第一、二小批已实现 Discovery、授权码登录发起、AES-256-GCM PKCE verifier 加密与一次性事务服务；维护者 Windows 已通过对应单测及完整 `ready`。第三小批授权码回调、ID Token 校验、预绑定身份查询和内部会话签发服务已提交，新增回调 Mock 单测待 Windows 验证。真实 IdP/JWKS 联调、真实 PostgreSQL 并发消费和生产浏览器 Cookie/HTTPS 代理验收仍待完成；第四、五小批 HTTP Controller 与 Guard 已通过维护者 Windows Mock E2E 和完整工程质量链。

### 第三十三批阶段 B 第一、二小批实际实现状态（2026-11-14）

- `OidcProviderDiscoveryService.getConfiguration()`：固定 Issuer 的惰性 Discovery，10 秒超时，成功配置进程内缓存；校验授权码、主体标识、RS256、PKCE S256 和端点协议边界。
- `OidcLoginTransactionService.start(returnPath, existingBrowserBinding?)`：生成独立 State/Nonce/PKCE verifier，计算 S256 challenge，构建固定 Redirect URI 的授权码请求；State 与浏览器绑定仅存 SHA-256 摘要，verifier 使用 AES-256-GCM 加密，登录事务有效期 5 分钟。
- `OidcLoginTransactionService.consume(state, browserBindingCookie)`：在 PostgreSQL 交互事务中按固定 Issuer、State 摘要、浏览器绑定、创建/过期时间和未消费条件筛选，再通过条件 `updateMany` 原子消费；消费后重新校验 Nonce 与站内回跳路径，再解密 verifier。密文使用 State 摘要作为 GCM AAD。
- 同一浏览器绑定 Cookie 可用于多个标签页，但每个事务独立生成 State/Nonce/verifier；无效、过期、跨浏览器、重复或并发失败均不返回 verifier。
- 截至第一、二小批完成时只实现服务层，尚未注册 Controller；后续第四小批实现 Cookie/CSRF Guard，第五小批注册身份 HTTP Controller。真实 IdP 与工程 API 仍待完成。
- 第一、二小批维护者 Windows 已通过 `vp check`、`test:unit`、`docs:check` 和完整 `ready`；第三小批回调单测尚待维护者执行。Mock 测试不代表真实 PostgreSQL 并发锁或真实 IdP 联调。

### 第三十三批阶段 B 第三小批：授权码回调、ID Token 与预绑定身份（代码已提交，待 Windows 验证）

- `OidcCallbackService.complete(response, browserBindingCookie)` 先通过 `OidcLoginTransactionService.consume()` 一次性消费 State 和浏览器绑定事务；OAuth 错误响应也消费事务，避免重放。
- 回调参数只接受单值 State、授权码及可选 `iss`；当 Discovery 元数据声明支持 Authorization Response Issuer 参数时必须提供，并始终要求其与固定 Issuer 完全一致。
- 使用服务端配置的固定 Redirect URI 构造回调 URL，不读取请求 Host/Forwarded Header；通过 openid-client 6.8.9 `authorizationCodeGrant()` 兑换授权码，显式传入 expectedState、expectedNonce、PKCE verifier 和 ID Token 必须存在的检查。
- ID Token 的签名、Issuer、Audience、有效期和 Nonce 基础验证由 openid-client 完成；应用层再检查固定 Issuer、Client ID Audience、azp、多 Audience、Nonce、Subject 的 ASCII/长度约束及时间声明类型。
- 只按精确 `(iss, sub)` 查询 `ScadaExternalIdentity`，要求关联 `ScadaIdentity.status = active`；未预绑定或已停用均拒绝，不按 email、用户名或 Claim 自动创建主体/租户。
- 验证成功后复用 `AuthSessionService.issueForVerifiedSubject()` 签发本地 15 分钟不透明会话。IdP Access/Refresh/ID Token 仅在兑换调用内存中短暂存在，不保存、不写日志；服务返回的本地 sessionToken 仅供后续服务端 Controller 设置 HttpOnly Cookie。本小批提交时尚无 HTTP 路由，路由由第五小批新增。
- 新增 Mock 授权码兑换、Prisma 身份映射和会话服务测试；覆盖 State/浏览器绑定、OAuth 错误、`iss` 参数、PKCE/Nonce 检查参数、ID Token Claims、未绑定/停用身份、异常脱敏和 IdP Token 不进入结果。维护者 Windows 已通过 `vp check`（286 文件格式正确、146 个受检文件零警告/错误）、`test:unit`（43 文件/477 测试，回调 12/12）、`docs:check`（83 Markdown）和完整 `ready`（最终退出码 0）。真实 IdP/JWKS 联调、真实浏览器 Cookie 与生产 HTTPS 代理验收仍未完成；HTTP Controller 已由第五小批提交，Windows 验证待执行。

### 第三小批 Windows 全链验收结果（2026-11-14）

维护者 Windows 已对 OIDC 回调服务和 Mock 测试完成验证：`vp check` 286 文件格式正确、146 个受检文件零警告/Lint/TypeScript 错误；`test:unit` 43/43 文件、477/477 测试（回调 12/12）；`docs:check` 83 Markdown 通过；完整 `ready` 最终退出码 0，SSE 8/8、故障代理 4/4、NestJS E2E 17/17、React/Vue/NestJS 构建通过。

该验收只证明当前代码质量链和 Mock 测试通过，不代表真实 IdP/JWKS 联调、HTTP Cookie/CSRF 或工程 API 已完成。

### 第三十三批阶段 B 第四小批：BFF Cookie 与 CSRF 会话保护（Windows 工程质量验收通过）

- `AuthSessionService.issueForVerifiedSubject()` 为每个新会话生成独立 `scada_csrf_` 随机令牌，数据库只写入 SHA-256 摘要；`authenticateCookieSession()` 只接受有合法 CSRF 摘要的活动会话，并对请求 CSRF Token 摘要作常量时间比较。旧 Bearer 会话 `csrfTokenHash = null` 仍可走 Bearer，不允许升级为 Cookie。
- `scada-auth-cookie.ts` 统一生成 `__Host-adui-scada-session`（HttpOnly）与 `__Host-adui-scada-csrf`（可读）Set-Cookie 头，均为 Secure、SameSite=Lax、Path=/、无 Domain；提供对称清除头。
- `ScadaSessionGuard` 支持显式 Bearer 与 Cookie 两条路径；混合凭据、重复/格式错误认证 Cookie、孤立 CSRF Cookie 均拒绝。Cookie 非安全方法额外校验精确 Origin 白名单、`Sec-Fetch-Site: same-origin`、CSRF Cookie/Header 双提交和数据库 CSRF 摘要；只审计固定原因码。
- Guard 将认证方式、当前会话 ID 和可信 Principal 写入请求上下文，Bearer/Cookie 两条路径均可供 Controller 精确撤销当前会话。第四小批提交时 Controller 尚未注册；第五小批将 Guard 与 Controller 仅挂载到 OIDC 启用根模块，默认 AppModule 不加载身份路由。
- 新增 Cookie 序列化测试与 Guard Mock 测试，覆盖 Cookie 属性、清除属性、Bearer 兼容、凭据混用、Cookie 安全读取、写请求 CSRF、Origin、Fetch Metadata、重复 Cookie、数据库 CSRF 摘要拒绝和审计脱敏。**需维护者 Windows 执行静态检查、单测和完整 ready；真实浏览器与 HTTPS 反向代理行为待后续 Controller 联调。**

### 第三十三批阶段 B 第五小批：OIDC BFF HTTP 控制器与认证路由（Windows 工程质量验收通过）

- 新增 `ScadaAuthController`，只在 `ScadaIdentityModule` 中注册，提供 `GET /api/v1/auth/oidc/start`、`GET /api/v1/auth/oidc/callback`、`GET /api/v1/auth/me` 和 `POST /api/v1/auth/logout`。
- 登录发起读取可选 `returnTo` 和现有浏览器绑定 Cookie，复用 `OidcLoginTransactionService.start()`；仅重定向至固定 Issuer 授权 URL，并设置短时 `__Host-adui-scada-oidc-browser` Cookie。
- 回调只转发 State、Code、OAuth Error 与 `iss` 给 `OidcCallbackService.complete()`；成功后设置 Session HttpOnly Cookie 和可读 CSRF Cookie，再跳转至服务端已校验的站内路径。浏览器绑定 Cookie 保留至自然过期，以支持同一浏览器多个标签页并行登录。
- `GET /me` 通过 `ScadaSessionGuard` 返回最小可信 `tenantId/subjectId`，响应禁止缓存且不返回会话令牌；`POST /logout` 通过 Guard 的 Cookie CSRF 或显式 Bearer 认证撤销当前本地会话，数据库撤销未确认时返回 503 且不清除 Cookie。
- 新增 `OidcEnabledAppModule`，仅在启动配置 `SCADA_OIDC_ENABLED=true` 且完整校验通过时由 `main.ts` 选择；该根模块只组合 `AppModule + ScadaIdentityModule`，不挂载 `ProjectPersistenceModule`。默认 AppModule 保持健康接口，不连接 PostgreSQL、不注册身份路由；OIDC 与本机模拟 API 同时启用时启动拒绝。
- 新增 Controller E2E 测试覆盖登录重定向、浏览器绑定 Cookie、多标签页复用、回调 Cookie 签发、`me` 最小身份返回、未认证拒绝、CSRF 注销、Bearer 注销和审计脱敏；默认 AppModule 继续验证四条身份路由均为 404。
- **维护者 Windows 已验收**：`vp check` 291 个文件格式正确、151 个受检文件零警告/Lint/TypeScript 错误；`test:unit` 45/45 文件、494/494 测试；`test:e2e:server` 4/4 文件、26/26 测试（OIDC Controller 9/9）；`docs:check` 83 Markdown；完整 `ready` 最终退出码 0。Mock HTTP E2E 不代表真实 IdP、真实 HTTPS 浏览器 Cookie、反向代理或生产身份接入已经验收。

### 第三十三批阶段 B 第四、五小批 Windows 工程质量验收（2026-11-14）

维护者 Windows 实测：`vp check` 291 个文件格式正确、151 个受检文件零警告/Lint/TypeScript 错误；`test:unit` 45/45 文件、494/494 测试；`test:e2e:server` 4/4 文件、26/26 测试（OIDC Controller 9/9）；`docs:check` 83 Markdown；SSE 客户端 8/8、故障代理 4/4；React/Vue/NestJS 构建成功；完整 `ready` 最终退出码 0。E-012 已复验关闭。真实 IdP/JWKS、生产 HTTPS/反向代理和企业身份映射不在本次 Mock E2E 验收范围。

## 2026-11-15 · 第三十三批第六小批：工程 HTTP API 候选契约（待验证）

本节只描述候选提交中的代码，**尚未推送至 PR #55 功能分支，未运行 Vite+、NestJS E2E 或真实 PostgreSQL 验收**。不改变共享 ScadaDocument 0.3.0、ProjectSnapshot 和原有历史迁移规则。

工程接口前缀固定为 `/api/v1/projects`。除登录入口之外，工程接口只在 OIDC 配置完整且显式启用的根模块中注册。默认 AppModule 下所有工程接口继续为 404。项目身份与租户来自已验证的 Session Guard，不接收前端声明的 `tenantId`、`subjectId` 或角色。

| 方法 | 路径                                             | HTTP 成功状态 | 授权与返回值                                                                                          |
| ---- | ------------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------- |
| POST | `/api/v1/projects`                               | 201           | 已认证；仅接受 `{document}`，创建工程、三项创建者 ACL、revision=1 快照和成功审计；返回 ProjectSummary |
| GET  | `/api/v1/projects`                               | 200           | 已认证；仅列出当前主体有 `project:read` 的工程摘要                                                    |
| GET  | `/api/v1/projects/:projectId`                    | 200           | `project:read`；事务共享锁内复核，返回 ProjectSummary                                                 |
| GET  | `/api/v1/projects/:projectId/versions`           | 200           | `version:read`；返回按 revision 倒序的历史摘要数组                                                    |
| GET  | `/api/v1/projects/:projectId/versions/:revision` | 200           | `version:read`；返回经内容 SHA-256、工程 ID、修订号和时间验证的 ProjectSnapshot                       |
| POST | `/api/v1/projects/:projectId/versions`           | 201           | `version:append`；使用共享 Core 的 `{expectedRevision,document}` 契约进行 CAS 追加，返回完整快照      |

`ProjectSummary` 包括 `projectId: string`、`headRevision: number`、`createdAt: string` 与 `updatedAt: string`。历史摘要与 Core 的 `ProjectVersionSummary` 相同，包括 `projectId/revision/createdAt/contentHash`，不含完整文档。历史列表只接受 `limit`（默认 20，范围 1～100）与 `beforeRevision`（大于零的安全整数），采用小于指定修订号的倒序分页。

工程未知或无权限时统一返回 404，客户端校验失败返回 400，重复工程 ID 与 CAS 冲突返回 409。Cookie 写请求除身份认证外必须通过 Origin 白名单、Fetch Metadata 与 CSRF Token 双提交。工程接口成功响应显式设置 `Cache-Control: no-store`；请求体统一使用 2 MiB 上限。客户端不得指定审计操作人、版本号、创建时间和快照摘要。

候选测试范围包括 HTTP Bearer/Cookie 认证、ACL 404、CSRF 403、输入 400、冲突 409、事务回滚、租户隔离与默认根模块 404；当前不代表生产身份接入、真实浏览器 HTTPS Cookie 或 PostgreSQL 事务已验收。工程发布、回滚、删除、共享授权管理和 PLC/DCS 写入均不开放。

### 第六小批工程创建者身份并发保护（候选补充）

工程创建事务在写入工程记录前，通过参数化 SQL 对 `scada_identities(tenant_id,subject_id)` 执行 `FOR SHARE` 并验证 `status=active`。这补充了请求开始时的 Session Guard 检查，避免主体已被停用后依旧原子创建新工程及创建者授权。共享锁与并发主体状态更新的行锁冲突，保证创建事务内身份状态稳定。身份未知或已停用统一按不可枚举的工程无权访问语义拒绝，并且不写入工程、ACL、历史快照或成功审计。仍需真实隔离 PostgreSQL 测试和并发停用专项验证。

### 第三十三批第七小批：框架无关工程 API Client 初始边界

独立工作区 `packages/api-client`（`@adui/scada-api-client`）只依赖共享 `@adui/scada-core`，不依赖 Vue、React、NestJS 或浏览器持久化组件。对外 `createScadaApiClient({ fetcher?, readCookie? })` 提供 `getMe/logout/createProject/listProjects/getProject/listVersions/readVersion/appendVersion`，固定服务端同源 `/api/v1` 路由。仅允许安全的工程 ID、正安全整数修订号、限制最大 100 条的分页和现有 Core `ScadaDocument/ProjectSnapshot` 契约；JSON 响应验证 Content-Type、字段白名单、时间与摘要格式，并在读取完整快照时再次用 Core 验证 SHA-256 与工程 ID/修订号一致性。

浏览器 Cookie 请求固定 `credentials: same-origin`，Fetch 固定 `mode: same-origin`、`redirect: error`、`cache: no-store`、`referrerPolicy: no-referrer`。POST 请求每次从当前可读 `__Host-adui-scada-csrf` Cookie 获取格式正确且唯一的随机 CSRF Token，并写入 `X-SCADA-CSRF`；会话 Cookie 仍为 HttpOnly，不向客户端代码暴露。失败响应仅按状态返回中文领域错误，不展示任何原始上游异常、响应体或 Token。跨租户工程资源统一 404，CAS 冲突 409，网络异常不自动重试写入。

本批客户端包只完成共享协议层和 Mock 测试，不改写现有 Vue/React Studio 交互，不开放工程发布/回滚、密码登录或 PLC/DCS 写入。真实 OIDC、HTTPS 同源代理、CSRF Cookie 兼容和离线草稿保留逻辑须待后续浏览器 E2E 实测；当前不能认为生产已启用服务端工程保存功能。

### 第三十三批第八小批：Studio 服务端工程 CAS 会话与本地草稿隔离

Vue/React Studio 使用同一个 `@adui/scada-api-client` 的 `StudioServerProjectSession` 管理本次页面会话内的服务端版本水位；此基线只在用户**实际载入服务端最新快照**（且 Core 已完成 SHA-256 校验）后建立，按 `projectId/tenantId/subjectId/revision` 绑定，不保存至 localStorage、sessionStorage 或 IndexedDB。服务端不存在工程时可以尝试创建第一版，但 404 同时可能意味着无权访问，是否允许创建仍由服务端独立 ACL 和租户唯一键决定。若已有服务端工程却未载入、用户切换、读到更新的服务器水位或 CAS 409，均拒绝追加，不能用刚查询得到的 headRevision 替代显式载入基线。

服务器保存先解析独立工程副本，再检查可信会话和远程水位，最后调用共享客户端的 `appendVersion(expectedRevision,document)`；任何失败都不得调用草稿仓储的 `save/remove`、不得改变当前编辑器或自动恢复草稿。服务端版本列表提供分页摘要；查看差异使用已通过 SHA-256 校验的服务器快照与当前画布做 Core 内容比较。确认载入服务端版本时先等待 `DraftAutoSaveSession.stop()`，再调用现有 `editor.loadDocument`；不会自动修改已保存草稿。用户执行 JSON 导入、IndexedDB 草稿恢复或本地历史载入后，旧服务器 CAS 基线必须立即失效；载入较早服务器版本也不能建立覆盖最新版本的保存基线。

该接口只交付受保护的工程历史版本保存，不产生正式发布指针、发布审批、回滚或 PLC/DCS 控制请求。OIDC 默认关闭且两端尚未配置真实同源 HTTPS 代理；UI 只能在完成后续身份/代理联调后作为生产功能使用。第八小批新代码的 TS6/Vite+ 和浏览器双框架专项尚待实测。

### 第三十三批第九小批：Vite 本机 HTTPS 同源代理边界

共享脚本 scripts/oidc-https-dev-proxy.mjs 和其 .d.mts 声明只为 Vue/React Vite serve 提供配置。SCADA_OIDC_DEV_HTTPS_ENABLED 默认为 false；只有显式开启时才从本机绝对路径读取证书/私钥、验证 TLS 上下文并代理正则 ^/api/v1(?:/|$) 至固定回环 NestJS。生产构建和现有 /demo 代理路径保持不变。

启动需满足非生产、Web/NestJS 均绑定 127.0.0.1、可信 OIDC 已开启且不安全 HTTP/模拟开关关闭、React/Vue/Server 独立端口、两个精确 HTTPS Web Origin 与唯一固定回调地址。代理 changeOrigin=false、xfwd=false、ws=false，不重写 Cookie/Origin/业务 API 路由、不引入 CORS 或客户端身份推断。Nest 仍由 OidcEnabledAppModule 与 Session Guard/ACL/CSRF 授权决定哪些接口可用；未启用或未认证时默认拒绝。

此为**本机非生产开发代理**，不能代替受控生产 HTTPS 终止代理或真实 OIDC/JWKS/跨框架浏览器验收。证书/私钥、Issuer 和客户端密钥不进入 Git、日志、浏览器构建或 Docker 镜像。

## 2026-11-16 · 第三十四批第一小批：工程摘要列表有界分页

受保护接口 `GET /api/v1/projects` 接收 `limit`（缺省 20、最大 100，严格正安全整数）和 `afterProjectId`（ASCII 工程 ID 白名单），其他 Query 字段、重复参数值和越界值返回受控 400。返回仍为 `ScadaProjectSummary[]`，包含 `projectId/headRevision/createdAt/updatedAt`，不包含工程 JSONB。服务端认证成功后使用可信主体的 `tenantId` 与 `project:read` 条件，按 `projectId ASC` 与 `projectId > afterProjectId` 执行有界 Prisma 查询。客户端 `ProjectListQuery` 来自共享 Core，Vue/React 同用 `@adui/scada-api-client.listProjects(query?)`，要求响应不超页长且工程 ID 严格递增；下一页以最后一个已返回项目 ID 继续。

与第三十三批的 `updatedAt DESC` 不同，**本批明确改为稳定 ID 升序**；无参数访问保持相同路径和数组形状，但只返回首 20 项。按更新时间排序、一次读取全部工程、并发分页快照一致性不在本小批契约中；未来项目中心 UI 需要独立设计按更新时间检索。任何页面操作不能依靠客户端参数绕过 ACL；不新增工程发布、版本回滚或工业写入。

## 2026-11-16 · 第三十四批第二小批：双框架 Studio 工程浏览与载入

Studio 工具栏新增独立“工程管理”弹层，与原“服务端工程”历史版本工具分开。首次打开时调用 `@adui/scada-api-client` 的 `listProjects({ limit: 10 })`，在共享框架无关 `StudioProjectBrowser` 里管理页号、历史 ID 游标、空末页、刷新和并发排斥；React/Vue 仅分别实现交互和生命周期。列表只显示授权摘要字段 `projectId`、`headRevision`、`updatedAt`，在用户明确操作时才加载完整工程快照。失败信息仅显示 API Client 受控文案；401、403、404 后清空此前的授权列表与游标，避免展示过期权限的工程摘要。

打开按钮调用既有 `StudioServerProjectSession.readVersion(projectId, headRevision)`，此流程会校验用户身份、通过 Core SHA-256 校验快照并重新读取服务端最新修订号。只有三者一致，且当前编辑工程未在等待时切换、用户确认覆盖当前画布之后，才执行 `DraftAutoSaveSession.stop()`，再由 `DocumentEditor.loadDocument` 替换工程并清空撤销记录，最后调用 `acceptLoadedVersion` 建立当前用户/租户的 CAS 保存基线。任何不一致或取消均不得变更编辑器及 IndexedDB 草稿。打开其他工程后历史列表与比较状态重置，Vue 重新订阅当前工程的 IndexedDB 草稿，避免之前工程的订阅继续影响页面。

本批的“工程管理”仅是 Studio 内的只读浏览+显式打开入口，不等于独立工程管理中心，也不代表正式发布。OIDC 默认关闭时不会自动发起授权或写请求；生产使用仍需可信 OIDC 和 HTTPS 部署、真实双端浏览器确认。见 [ADR-0068](adr/0068-dual-studio-project-browser.md)。

## 2026-11-16 · 第三十四批第三小批：真实 OIDC 工程管理浏览器专项

新增 `scripts/test-project-browser-oidc.mjs`。配置先复用现有 `resolveReadonlyProbeOrigins` 约束，额外核对本机 Keycloak Issuer / `adui-scada` Realm、`SCADA_DATABASE_URL` 的精确本机 Lab 数据库白名单、可信 Node 根证书。只允许非生产、已显式启用 OIDC HTTPS 的两套 Vite Origin。登录由维护者在**临时隔离 Chrome/Edge Profile** 内访问真实 `/api/v1/auth/oidc/start` 手动完成，脚本从浏览器的同源 GET `/api/v1/auth/me` 确认可信主体，绝不输出 Cookie、Code、Token、密码或身份详情。

React 和 Vue 在一个真实临时浏览器中分别进入 Studio：对比工程管理列表与服务端 `GET /api/v1/projects?limit=10` 摘要、检查 ID/修订号及分页按钮；若有下一页，使用 `afterProjectId` 对比 UI 上下页。通过真实 Studio“保存草稿”按钮只写当前**临时浏览器 IndexedDB** 并开启自动保存；点击“打开”时分别模拟取消、在 API Client 初始化前安装的受控 `GET /api/v1/projects/:id` 响应水位故障、最后确认打开当前最新服务端快照。前两条要求画布与草稿摘要不变、自动保存保持开启；确认后要求 CAS 基线与最新修订号相符、自动保存暂停且原草稿 SHA-256 不变。所有工程 HTTP API 请求均为 GET，水位冲突模拟不是实际数据库竞争写入。脚本不会自行创建、更新、发布或删除服务端工程；真实身份登录会产生隔离 Lab 正常的登录事务。无真实用户/授权工程则必须明确失败，不伪造自动化成功。

## 2026-11-17 · 第三十四批第四小批：真实多页游标与独立连接 CAS 验收

- 沿用 `PrismaProjectVersionStore.list` 的按 `projectId ASC`、`afterProjectId` 严格大于游标、精确租户与 `project:read` 的现有 PostgreSQL 查询。真库测试在随机测试租户中使用现有 `create` 事务准备 12 个获授权工程与 1 个同租户但无当前主体读取权限的工程，断言真实 `10 + 2 + 0`、完整 12 项只读摘要、修订号 1、无权工程不可枚举；测试退出时只清理该随机租户记录。
- 沿用 `PrismaProjectVersionStore.append` 的工程行 `FOR UPDATE`、ACL 复查、`expectedRevision` 比较、版本追加/水位推进/成功审计同事务规则。两个不同 `subjectId` 分别通过两个独立 `PrismaService` 连接并发提交 `expectedRevision=1`：要求一成功、一 `ProjectRevisionConflictError`；数据库最终仅有修订 1/2 的两条历史与两条审计记录，修订 2 的审计操作者必须等于真实获胜主体。此验证在仓储层，不是两条 OIDC HTTP 请求，也不会测试新的发布或设备写入。
- 交互式 `test:projects:oidc:browser:pages` 复用原真实 Keycloak/HTTPS/Chrome/Edge 临时浏览器专项，额外强制 React 与 Vue 都进行**有数据的第二页**前后翻页；普通 `test:projects:oidc:browser` 行为保持不变。命令不向 Lab 写入项目、ACL、版本或身份；授权工程不足 11 项时以中文固定错误和非零退出码停止，禁止伪造多页通过结论。
- 独立 `pnpm run test:db` 仍必须显式配置 `SCADA_TEST_DATABASE_URL` 指向本机 `adui_scada_test`，与根环境业务库 `adui_scada` 严格隔离；不新增数据库表、字段、索引、迁移和依赖。

## 2026-11-17 · 第三十四批第五小批：两会话 HTTP CAS 409 隔离验收

`apps/server/test/projects-cas-cookie-http.db-spec.ts` 构造真实 NestJS `ProjectApiController` 与 `ScadaSessionGuard`/`ScadaProjectGuard`、真实 `AuthSessionService` 和 `PrismaProjectVersionStore`，**不替换 Guard、会话或仓储为 Mock**。测试先在本机 `adui_scada_test` 的随机租户中创建两个 `active` 主体；使用仅供服务端可信身份流程调用的内部 `issueForVerifiedSubject` 为每个主体创建独立 Cookie 与 CSRF 配对，再通过现有工程创建事务建立修订 1 并显式授予另一主体同工程的读取/追加 ACL。通过 Supertest 发出的请求实际经过 HTTP 控制器、Origin/Fetch Metadata、会话 Cookie、CSRF 双提交、ACL 和 PostgreSQL 行锁事务。

四项独立测试分别验证：双主体读取工程摘要且未登录拒绝；错误 CSRF、非法 Origin、Bearer 与 Cookie 混用均失败并保持数据库不变；具备合法会话但缺少 `version:append` 时返回 404；两个会话同时发送 `expectedRevision=1`，恰好得到 201/409，失败重试仍为 409，最终 head 为 2，历史/审计仅有修订 1、2，修订 2 的 `createdBy`/审计 `actorId` 与成功 HTTP 请求主体一致。单独用例只清理自己的随机测试租户的会话、审计、历史、授权、工程和身份。

不修改 HTTP 响应契约；本专项覆盖真实 BFF Cookie 与 PostgreSQL 的 HTTP 行为，**不覆盖真实 Keycloak 授权码回调、真实浏览器 TLS Cookie、多个服务端进程或生产环境安全认证**。不得把它混称为真实双 IdP 登录测试。

## 2026-11-17 · 第三十四批第六小批：真实双 Keycloak 身份交互式 CAS

新增 `scripts/test-oidc-dual-cas.mjs` 与对应 `cases.mjs`，不更改正式身份或工程模块。前置条件是同一个本机隔离 Keycloak Realm 的**两位不同用户**已经通过现有 `oidc:lab:identity` 的受控流程绑定为同租户、不同且有效的本地主体（脚本**不会自动新建用户或绑定身份**）。

测试通过两个独立的 Chrome/Edge `--user-data-dir` 临时 Profile，分别走现有 `/api/v1/auth/oidc/start` 与回调，校验浏览器当前同源 `/api/v1/auth/me`。第一个主体保留在 React HTTPS Origin；第二个主体先经 React 固定回调完成标准登录，再导航到 Vue HTTPS Origin 验证会话。Node 端只接收受控主体 ID 做**内存比较和 SQL 参数**，绝不输出 Cookie、密码、OIDC code、Token、租户或主体标识；页面 CDP 回调是完全自包含函数，不引用 Node 模块闭包。结束时关闭浏览器、删除隔离 Profile；退出时的敏感异常统一脱敏。

`--run-cas --confirm-lab adui_scada` 明确允许写入时，用第一个真实 BFF 会话的可读 CSRF Cookie 和正式 `POST /api/v1/projects` 新建 `b34-oidc-cas-<UUID>`、单页、零 Tag、零图元的 `ScadaDocument 0.3.0`。Node 使用服务端既有 `pg` 依赖连接严格验证过的本机 `adui_scada` Lab，在 SERIALIZABLE 事务中确认该新工程唯一且水位为 1、首版创建者为第一主体、两身份仍 active、仅第一主体具有原生三项创建者 ACL；随后仅给第二主体授予 `project:read`、`version:read`、`version:append`，绝不触及已有工程和角色权限。

两浏览器分别读取 `/versions/1` 并核对空白工程文档及内容摘要，然后各自使用不同真实会话与 CSRF 同时提交修订 1 的 CAS。检查 201/409 结果和成功 SHA-256；Node 以只读、参数化 PostgreSQL 查询核对版本 1/2、`head_revision=2`、两条成功审计与获胜主体匹配；双方再通过原 BFF HTTP 路由读取修订 2 一致。脚本不会直接修改修订号、覆盖既有工程、伪造 Cookie、禁用 TLS 或自动删除测试审计数据。该验收覆盖**本机单服务进程、真实两次 Keycloak 登录/HTTPS 浏览器与数据库**，仍不能视为跨实例部署/生产环境工业安全验收。

### 第三十四批第八小批 · 服务端拒绝访问后的双框架状态失效语义

`packages/api-client/src/index.ts` 导出 `isScadaAccessRejection(error)`：只将共享 `ScadaApiError` 的 `unauthenticated`（401）、`forbidden`（403）、`not_found`（404）视作需要丢弃旧授权缓存的拒绝信号；不把普通 `network`、`conflict`、`invalid_response` 或未知异常混入。HTTP 404 同时表示不存在和无权访问，前端不能推断真实授权，也不解析错误响应体。

`StudioServerProjectSession.readVersion/saveDocument` 在确认的拒绝后立即失效旧基线。`invalidateAccess(projectId?)` 同时保留单工程的短期创建阻断标记：原来已有 CAS 基线的工程发生 404 后**不尝试 POST 创建**，重复保存亦直接受控拒绝；`acceptLoadedVersion()` 仅在服务端授权重新读取并由用户确认后清除阻断、重建 CAS 基线。`reset()` 为导入 JSON、本地草稿/本地历史恢复等显式上下文切换使用；失败没有浏览器持久化凭据和权限信息。首次保存真正未载入过的新工程仍可按既有服务端唯一约束尝试创建。

React 的 `runServerAction` 与 Vue 对应处理在拒绝后清除旧 `serverProjectId`、`serverHeadRevision`、`serverRows`、`serverHasMore` 和 `serverInspectedVersion`；Vue 同时清除界面缓存的 `serverBaselineRevision`。两套 `ServerProjectBrowser` 以访问失效的组件 `key` 重新建立独立游标会话，旧请求即使随后返回也不能覆盖已重建的组件。提示仍使用受控中文 `ScadaApiError.message`，身份失效时标记未登录。所有处理**只清理服务端派生缓存**，不调用 `DocumentEditor.loadDocument`、不删除 IndexedDB 草稿、不触碰本地撤销历史。

**验收**：共享 API Client 与 CAS 会话单测覆盖 401/403/404、重复保存阻断、合法重新载入恢复、首次创建不回归、网络中断仍保留基线；Windows `vp check`、`test:unit`、`ready` 和 React/Vue 两端现有工程浏览器验收。真正服务端权限撤销的全链安全性已由第七小批独立 `adui_scada_test` 实测覆盖，**不需要也不允许本批为 UI 模拟而写现有 OIDC Lab 授权表**。没有后台主动推送，因此“即时清空”特指实际请求收到拒绝后的状态更新。
无论拒绝首先来自 Studio 的保存/历史查询，还是独立工程列表的分页刷新，均使用相同的父级授权失效处理：React 子组件通过 `onAccessRejected(error)` 回调、Vue 子组件通过 `accessRejected` 事件通知 Studio；父级清空旧 CAS 和服务端历史摘要并重建工程管理列表组件。子组件中的临时错误显示不承担父级缓存失效职责。重新挂载使旧分页请求无法把迟到响应写回新列表。

### 第三十四批第九小批 · 临时浏览器权限拒绝模拟与写入阻断

复用已有 `scripts/test-project-browser-oidc.mjs` 的本机 OIDC HTTPS/Keycloak/数据库白名单、Chrome CDP 独立 Profile、`Page.addScriptToEvaluateOnNewDocument`、React/Vue 同源 BFF 登录、已授权工程列表、确认载入与 IndexedDB 摘要检测。新增互斥模式 `--simulate-access-denial`；`resolveProjectBrowserMode` 严格拒绝与 `--prepare-multipage --confirm-lab` 等写入模式组合。正常浏览器命令和既有多页准备流程保持原样。

`installAccessDenialFaultInPage(runtime=globalThis)` 必须在每次页面初始化前注入，包装应用捕获的 `fetch`。对于所有路径为 `/api/v1/projects` 或其子路径的非 GET/HEAD 请求，包装器**先于底层 Fetch**返回静态 403，同时只记录本地 `writeAttempts` 计数；不携带请求 Cookie 或正文，不打开远程数据库。不论当前是否触发模拟拒绝，该写入保护在整个模拟 Profile 中持续有效。只有显式 `armAccessDenialInPage(projectId,scope,status)` 时，才将同 Origin、指定项目和路径范围的 GET 返回固定 401/403/404，记录命中计数，普通 OIDC `/auth/me`、其他 Origin 和非目标只读请求不得被伪造。页面注入函数以 `function.toString()` 独立执行，禁止引用 Node 模块闭包辅助函数（防复发 E-002/E-025）。

模拟专项每轮重新导航、以真实 BFF 只读打开既有授权工程并确认 CAS 基线，然后通过 UI 操作触发：①查询服务端历史→401；②授权工程列表刷新→403，确认子组件拒绝通知清除父级基线；③点击保存前查询工程水位→404，确认再次点击保存也不会请求创建版本。等待浏览器可观测状态稳定后，比较服务端水位、历史和工程列表全部失效、本地画布与 IndexedDB 草稿 Hash 不变、`writeAttempts=0`。模拟器只返回状态码，没有真实 ACL 更新；既有后台真库 31/31 验证了真实权限拒绝的服务端行为，二者应分别报告验收结论。

### 第三十四批第十小批 · 真实 ACL 撤销的双框架浏览器事务与证据边界

新增 `scripts/test-oidc-real-acl-revocation.mjs`，复用第六小批的 `startBrowser`、`waitForLogin`、同源真实身份读取、`createCasProjectInPage`、`grantSecondSubject` 和 `readCasProjectInPage`，并复用第九小批的 Studio 页面快照、IndexedDB 草稿 SHA-256、授权列表翻页、确认载入、访问失效 DOM 探针及在第二用户浏览器始终运行的工程写入拦截器。只将原测试模块的部分已有函数显式导出，**不变更**正常脚本的 CLI 行为。

`resolveRevocationMode([])` 只允许两位普通 Keycloak 用户的真实独立会话预检。必须明确传入 `--run-revoke --confirm-lab adui_scada` 才能写入；先使用 `resolveProjectBrowserLab` 和 `resolveLabIdentityTarget` 拒绝远程、不可信 TLS/Realm/Origin、生产模式或数据库连接。执行时每个框架只新建一份 `b34-oidc-cas-<UUID>` 空白首版工程，不使用已有项目 ID、也不修改历史工程；第二主体先真实取得三项最小 ACL 并经 Studio 显式确认首版载入，随后才开始撤销事务。

`revokeSecondSubject` 在 PostgreSQL `BEGIN ISOLATION LEVEL SERIALIZABLE` 中 `SELECT … FOR UPDATE` 锁定本次新工程，仅当仍为创建者首版、修订号 1、第一主体三项及第二主体恰好三项固定 ACL（无其他额外授权）时，以租户 ID、专用工程 ID、第二主体 ID 和三项权限为完整条件执行一次 `DELETE … RETURNING permission`。提交后用 `verifyRevokedProject` 对比三项创建者授权、仅有一个版本和成功审计、首版操作主体；重复撤销时无 SQL 删除。若创建后流程中途失败，`finally` 在同样范围约束下尝试撤销新授予的 ACL；不做全租户批量撤销，不修改身份映射/已存在 Lab 工程，不清除测试工程。

第二主体的 React 与 Vue 浏览器按顺序验证（分别创建两份专用工程，避免撤销后重新授权造成旧状态不可信）。UI 测试经真实 HTTPS/Keycloak/BFF `GET` 获取首版、查找授权列表并在确认对话后建立 CAS 基线；实际撤销后直接从相同 Origin 读取详情、历史、首版并断言 `[404,404,404]`，`/auth/me` 仍匹配第二主体。用户界面查询服务端历史后必须清空旧服务端摘要和授权列表、保留本地 SVG 与 IndexedDB 草稿；重复保存必须显示受控的访问失效提示且没有工程写入。主体验证另一浏览器仍能读首版；在数据库再次检查水位仍为 1、版本/成功审计仍为 1。所有诊断只输出静态中文步骤与本次测试项目 ID，不输出主体信息、Cookie、Token、原始 SQL 错误或 HTTP 正文。

### 第三十四批第十一小批 · `StudioServerProjectSession.revalidateBaseline` 与前台恢复事件

共享 `packages/api-client/src/studio-session.ts` 新增 `revalidateBaseline(projectId): Promise<"unchanged" | "skipped">`。仅当当前 `projectId` 与已确认保存基线一致时执行两个顺序 GET：`getMe()` 和 `getProject(projectId)`；不读取或修改 IndexedDB、工程 Schema，不调用 `createProject`/`appendVersion`。检测已认证主体的 `tenantId/subjectId` 与旧基线不一致时，以受控 `forbidden` 403 拒绝；响应 401/403/404 时经现有 `invalidateAccess` 保留原 ID 的自动创建阻断；`headRevision` 与保存基线不一致则按 `conflict` 409 丢弃基线。网络失败原样抛出且不误清 CAS。

调用开始时保存原基线对象引用，每次 `await` 后核对其仍是最新；用户在等待中清空或重新确认载入新基线时，旧请求以 `skipped` 返回，不允许覆盖或清空新基线。React 与 Vue 均只监听 `visibilitychange` 的可见状态（不是后台轮询/权限推送），并在主动历史、草稿或前一次复核进行中跳过本次事件；发生授权/版本变化时仅重置服务端修订号、远端历史和对比快照，不重载画布、不停止本地自动保存。组件卸载时移除事件监听，迟到结果不更新已卸载的组件。

独立浏览器回归复用已有安全 CDP 脚本的 `--simulate-resume-check` 单模式，以真实 Keycloak/BFF 读取并显式载入既有授权工程，随后调用自包含的 `triggerStudioResumeInPage` 派发可见事件。模拟 401 只定向当前 Origin 的 `GET /api/v1/auth/me`，模拟 404 只定向既有项目 GET 详情；修订号漂移仍借已有受控 GET 响应摘要模拟器将 `headRevision` 增加 1。隔离 Profile 永久拦截工程 API 非 GET/HEAD 写请求。每轮比较恢复前后 SVG DOM、IndexedDB SHA-256、自动保存状态，并验证 UI CAS/旧水位失效和零工程写入尝试。本专项**不在真实数据库中修改 ACL 或版本号**。

## 2026-11-17 · 第三十四批第十二小批：服务端读取上下文代次保护

`StudioServerProjectSession` 为 `readVersion(projectId, revision)` 捕获启动时的 `contextGeneration`，在 `getMe`、`readVersion`、`getProject` 每次异步返回后复核，并在 `catch` 处理拒绝之前再复核。代次变化表明另一项明确的用户动作已经重置或更换了当前保存上下文；此时统一返回受控 `ScadaApiError(kind="conflict", status=409)`，不得再触发 `invalidateAccess(projectId)` 或返回旧快照给调用者确认。没有上下文变动的 401/403/404 继续执行原有权限失效与防误创建逻辑。

代次在 `reset`、`invalidateAccess`、`acceptLoadedVersion` 以及当前已有保存/冲突处理引起的 CAS 基线变更时推进。该计数只在当前 `StudioServerProjectSession` 实例中有效，不持久化、不用于服务端授权或版本 CAS；服务端仍以真实 Cookie 会话、ACL 和预计修订号作最终判定。React/Vue 无需维护各自的第二套代次规则，不修改 SVG 画布或 IndexedDB。

## 2026-11-17 · 第三十四批第十三小批：服务端保存异步上下文保护

共享 `StudioServerProjectSession` 继续复用第十二小批的 `contextGeneration`。`saveDocument` 在取得 `saving` 互斥锁后捕获代次，所有会让任务异步暂停的 `getMe`、`getProject`、`createProject`、`appendVersion` 均通过 `awaitSaveStep` 等待：`try/finally` 在 Promise 成功或失败后都校验旧代次。旧代次被替换时强制抛出受控 409，并在外层权限拒绝处理以及追加版本冲突处理之前检查代次，避免旧 401/404/409 清空或阻断新的合法基线。新代次出现于显式 reset、权限失效、重新确认载入以及既有 CAS 更新；保存成功仍按原有版本与身份规则推进基线。

**已发送的服务端 POST 不可依赖浏览器回滚**：即使保存异步完成时已切换上下文，服务器仍可能已创建工程或追加不可变版本。当前客户端不接受该迟到回包来写入本地新基线，而是以“写入可能已生效，请重新读取最新版本”的固定中文冲突文案提示人工复核。禁止自动重试或在没有服务端证据时回退数据库审计。工业设备写入不在此 API 内，NestJS 仍负责 CSRF、授权与版本 CAS。React/Vue 无需各自复制代次状态机。

测试通过 Mock API 控制异步阶段，并且分别断言迟到失败与迟到成功后的新基线不变、旧请求不会额外创建或追加工程、当前业务规则仍由原有测试覆盖。此小批未改服务端 HTTP 协议或物理浏览器多标签事件。

## 2026-11-17 · 第三十四批第十四小批：浏览器保存延迟拒绝专项

复用 `scripts/test-project-browser-oidc.mjs` 的临时 Chrome/Edge CDP Profile、真实 Keycloak 登录、双 Origin、`prepareAccessDenialBaseline` 与 `inspectStudioState`；不改正式 API Client、SCADA Core 或 React/Vue 页面。通过新模式 `--simulate-save-timing` 单独运行：先于客户端初始化安装已有 `installAccessDenialFaultInPage`，保持所有工程非只读请求在页面内终止；仅当显式 `armSaveTimingInPage` 后匹配同源当前工程的 `POST /api/v1/projects/:projectId/versions` 才挂起响应。调用真实“保存至服务端”按钮两次，等待 POST 命中且 UI Busy、按钮 Disabled，检查只尝试一次；之后 `releaseSaveTimingInPage` 以固定 409、401、503 状态依次交付合成响应。

409 与 401 必须让现有 CAS 基线失效，503 属暂时服务器故障必须保留基线；三种场景都检查不存在自动重试以及本地 SVG、IndexedDB、自动保存未变。每种状态前重新以真实 GET 载入授权工程，避免前一场景的 UI 结果串扰。脚本的 Node 断言只接收命中计数、Busy、Disabled、是否有错误、CAS 是否清空等布尔摘要，不打印 Cookie、工程正文或服务器错误详情；浏览器注入函数不得引用 Node 模块作用域。不存在 201/成功 POST 模拟，更不声称服务器实际提交或回滚。未涉及工业设备写入与生产安全评审。

## 2026-11-17 · 第三十四批第十四小批补充：取消载入测试应区分旧错误残留

`openProjectInPage` 在点击工程列表项前记录现有服务端错误节点。仅观察到“正在处理工程版本”并不代表忙碌结束后仍存在的错误属于新请求；修复后，只有错误内容与旧错误不同，或本次确实观察到旧错误被清空后重新出现，才将该错误判作当前载入失败。完成成功路径依旧要求正常的 `window.confirm` 与后续 CAS 提示，真实的新错误仍必须拒绝载入，未得到有效确认会超时失败，不能通过放宽页面断言掩盖失败。

新拒绝仅使用受审核固定阶段与类别，`describeBrowserPageException`、`describeProjectBrowserFailure` 均以完整白名单正则检查后才将安全类别交付 Node 终端。新类别不代表真实 HTTP 状态码，也不携带工程 ID、身份、Cookie、响应正文或异常堆栈。此变更仅涉及 CDP 专项脚本与离线回归，不改变 Vue/React 页面业务逻辑或服务器授权。

## 2026-11-17 · 第三十四批第十四小批补充：Vue 保存异常后 CAS 响应式缓存对齐

正式共享 `StudioServerProjectSession.saveDocument` 收到服务端版本冲突 409 时清除其 CAS 基线；401/403/404 按访问拒绝规则失效相关缓存，503 临时故障仍保留现有 CAS 并由后续真实服务端请求重新校验。React Studio 的 `activeServerBaseline` 每次渲染直接从共享会话读取；Vue 则在 `serverBaselineRevision` 响应式变量中保存镜像，原先在成功保存、确认载入、主动访问失效时更新，但在仅有 409 的保存错误路径漏更新镜像。

最小修复在 Vue `runServerAction` 错误路径且标签为“保存服务端工程”时，将 `serverBaselineRevision.value` 重新赋值为共享会话针对**当前编辑工程**的真实 `getBaselineRevision`。此变更不更改共享会话的授权、CAS 算法、实际 POST 或 React 页面；保持 Vue 409 失效展示、503 保留基线及既有访问失效流程。隔离浏览器 `verifySaveTimingScenarios` 已经同时对 React/Vue 检查 401、409 清基线与 503 保留基线；新增固定错误类别使失败时只输出框架/HTTP 模拟状态和“CAS 基线状态不符合预期”，绝不输出工程 ID、Cookie、Token 或原始响应。

## 2026-11-17 · 第三十四批第十五小批：真实提交后的旧回包与更新水位复核

继续使用已有 `StudioServerProjectSession` 的 `contextGeneration` 和 `awaitSaveStep`，不新增业务状态或公开 API。共享 Vitest 用例借助受控 Promise 将一次 appendVersion 的修订号 2 成功回包暂缓；在此期间模拟服务器已由另一会话推进到 3，客户端显式 `reset` 后通过 `readVersion(..., 3)` 和 `acceptLoadedVersion` 建立新基线。解除旧 Promise 后，保存必须以“服务端保存期间工程上下文已变化，写入可能已生效，请重新读取最新版本”受控 409 拒绝，而**不得覆盖新基线 3**；下一次 `saveDocument` 预期必须是 CAS 3→4。

既有 NestJS 真实数据库测试 `projects-cas-cookie-http.db-spec.ts` 新增一项：先通过第一 Cookie/CSRF 会话真实 HTTP POST 返回 201 并实际提交到隔离 PostgreSQL 版本 2 和审计；在**测试消费端 Promise** 持有该真实响应期间，第二 Cookie/CSRF 会话基于 2 追加 3；真实 GET 详情和快照返回修订号 3，随后把旧 201 交付给模拟客户端，再尝试以旧预期 2 写入，服务端必须返回 409 且持久化水位/版本/审计保持 3。延迟点在测试消费端而非真实 TCP 传输；数据库真实读取在释放前已证明事务提交。每项测试由 `withFixture` 创建随机租户，`finally` 仅清理本租户的版本、审计、授权、会话和身份。

两个测试共同验证协议与会话逻辑，但没有让同一浏览器 Session 直接与 PostgreSQL 实例联动，也没有模拟网络丢包、断电、进程崩溃或跨 Origin Cookie 复用。保持只读设备边界。

## 2026-11-17 · 第三十四批第十六小批：真实双浏览器 201 延迟消费专项设计

复用 `scripts/test-oidc-dual-cas.mjs` 的隔离浏览器、可信 BFF、严格随机项目创建和串行化 ACL 准备流程。新增显式 `--run-late-response` 写入模式与原 `--run-cas` 互斥；两者均要求 `--confirm-lab adui_scada`，默认仍只读。

浏览器内自包含的 `armHeldCasResponseInPage` 仅对当前随机专用工程发起一次同源 CSRF 保护 POST。获取真实 201 后先解析克隆体核对 `revision=2` 和 SHA-256 形状，把原始 `Response` 保留在临时 Profile 内；`heldCasResponsePhaseInPage` 仅公开固定相位，不暴露 HTTP 正文和 Cookie；`releaseHeldCasResponseInPage` 仅允许一次显式消费。超时、非 201、非法快照、错误项目、跨 Origin、缺少 CSRF 或重复启动均拒绝，不做隐式重试。

Node 编排第二主体读取 2、再 POST CAS 2→3，随后释放旧 201、第一主体过期 CAS 2→409、两端只读核对版本 3。只在本轮创建的随机项目上通过 `pg` 的只读 SQL 核对 `head_revision=3`、精确三条版本与审计记录及主体/摘要。失败时仍清理两个隔离浏览器 Profile，成功或失败均不自动删除测试专用工程，以免误删人工 Lab 数据。

此项**不修改** `StudioServerProjectSession`、React/Vue 页面、NestJS、Prisma Schema、迁移、授权接口或工业控制权限。它比第十五小批的两层分离 Mock/DB 测试增加真实双浏览器与真实 BFF 的连续请求，但响应延后只发生在测试脚本中，尚未证明真实 Studio UI 接收到旧 201 后如何恢复；这一边界必须在验收报告中保留。

## 2026-11-17 · 第三十四批第十七小批：Studio 真实保存 201 的浏览器测试设计

新增独立的 `scripts/test-oidc-studio-real-late.mjs`，复用现有双主体 Keycloak 登录、同源 BFF、随机测试工程创建、`grantSecondSubject` 与 `verifyLateCasAudit`，以及 `test-project-browser-oidc.mjs` 中已被 Windows 验证的 Studio 页面导航、分页载入、草稿与状态检查函数。原浏览器文件仅额外导出已有 `enableAutoSaveInPage`，不修改实现。

隔离浏览器的 `Page.addScriptToEvaluateOnNewDocument` 在 UI 初始化前注入自包含 Fetch 包装器，默认拒绝任何工程非 GET/HEAD 请求。仅显式 arm 时允许当前 UUID 专用工程发出**一次**同源 `POST /api/v1/projects/:projectId/versions`，严格核对工程 ID、`expectedRevision=1`、CSRF Cookie 与请求头、同源 Fetch 属性。其他写请求都在浏览器中返回 403，绝不进入 Lab。真实 201 和快照摘要验证通过后，拦截器持有原始 `Response` 并保持 UI Promise 挂起；不能将合成 201 冒充实际服务端提交。

真实 Studio UI 通过工程管理分页选择本轮测试工程、`window.confirm` 明确确认载入、保存真实 IndexedDB 草稿并开启自动保存，然后调用原“保存至服务端”按钮两次。只有第一条版本 POST 允许穿透。等待状态仅允许公开计数、布尔值和 CAS 修订号，不输出 Cookie、Token、正文、外部主体 ID 或 URL。挂起期间点击原“恢复草稿”控件，预期现有互斥标记拒绝恢复；不会注入共享 Session 或修改组件内部私有状态。

第二主体经真实 BFF 读取已提交版本 2 并以 CAS 2→3 提交，第一浏览器此时才释放原始 201。待页面正常结束保存并显示基线 2 后，派发实际 `visibilitychange`（页面必须可见），由现有 `revalidateBaseline` 发起真实只读请求发现 head=3，从而清除旧 CAS 与服务端摘要。随后从 UI 再次点击保存验证没有 POST 到达。最终比对 SVG、IndexedDB 数量/SHA-256、自动保存状态，且只在本轮两个专用工程上读取 PostgreSQL 三条版本/审计，测试项目保留供人工检查。

该策略检验**当前合法保存上下文中旧成功回包已交付后的水位复核**；不声称在 UI 互斥锁持有期间强行切换到新上下文，后者已由共享 Session Promise 单元测试覆盖。离线安全测试只模拟包装器/命令参数，真正 Chrome、Keycloak、TLS、PostgreSQL 与 UI 集成必须在 Windows 单独执行，物理 TCP 故障不在本批范围。

## 2026-11-17 · 第三十四批第十七小批：真实 Studio 迟到回包阶段诊断补充

维护者首轮 Windows 实际执行中，React Studio 已真实提交版本 2，201 到达浏览器并被拦截器挂起；随后测试输出通用“真实 Studio 迟到保存未达到受控状态”，退出码 1。现有脚本在释放旧 201、等待 UI 成功状态、浏览器可见性、CAS 水位复核和最终过期保存拒绝等多个阶段复用同一错误，无法定位是哪一个状态断言未满足。**真实失败阶段与底层原因仍待复测**，不把它推断为生产 UI、API 或 PostgreSQL 缺陷。

候选仅为真实浏览器脚本新增 `waitForStudioState`，分别标记固定阶段；超时后重新读取一次页面状态，仅输出经过字段白名单构造的 `phase`、POST/写入/拒绝计数、Busy/Disabled、CAS 基线、服务端摘要清空、错误提示及 document 可见性。第二主体读取修订 2、追加 CAS 2→3、释放旧 201 均增加固定阶段日志。没有传回工程/主体标识、Cookie、Token、响应正文、URL 或原始异常。既有真实请求、数据库事务、共享 Session、UI CAS 算法及安全门禁不变；失败仍然返回非零退出码。新增可见性布尔字段仅用于受控诊断与离线状态测试。

## 2026-11-17 · 第十七小批：双窗口真实可见性复核最小修复

维护者第二轮真实专项已经确认 React Studio 原始 201 交付成功、第二主体真实版本 3 提交成功，但独立 Chrome/Edge 窗口在执行 `Page.bringToFront` 后仍报告 `document.visibilityState=hidden`，导致原先正确的可见性安全断言失败。CDP `Page.bringToFront` 只激活目标标签页，并不负责 Windows 两个隔离浏览器窗口的显隐关系。

只在本次专用测试脚本新增 `setSecondaryBrowserWindowState`：第二主体操作前通过 `Browser.getWindowForTarget` 精确获取**第二主体测试 Profile**的窗口 ID，并用 `Browser.setWindowBounds` 设为 `normal`；第二主体成功推进版本 3、第一主体已消费原始 201 后，将第二窗口设为 `minimized`，再次对第一主体执行 `Page.bringToFront`。仍然要求真实 `document.visibilityState === "visible"` 才能派发已有的只读复核事件、检查远端新水位 3 和清除过期 CAS。ID 不合法、CDP 失败或真实页面继续隐藏时照常失败，不伪造 getter 或关闭断言。窗口管理只发生于隔离测试进程，完成后仍由现有 `finally` 关闭两份独立浏览器 Profile。

## 2026-11-17 · 第十七小批：本地数据变化的严格分阶段诊断

维护者第三轮真实 Lab 运行已经证明 React 的第二主体 HTTP 201 推进修订 3、第一主体消费旧 201，以及独立浏览器可见性恢复均能完成；此后脚本报“真实 Studio 迟到保存的本地数据发生变化”。按照该脚本顺序，最终失败位于 CAS 基线清空及 UI 拒绝旧 CAS 再次保存之后的本地快照一致性检查。当前日志**未区分** SVG、自动保存、草稿数量、草稿哈希，也未证明根因属于业务代码。

测试脚本只增加纯函数 `classifyStudioLocalDrift`，把原 SVG 内容全等、自动保存布尔值全等、IndexedDB 草稿数量全等、原始记录 SHA-256 全等转成四个布尔诊断字段。`requireUnchangedDocument` 仍按**任一变化即拒绝**执行，不引入等待重试、自动修正草稿、修改生产 UI 或修改数据仓储。分别在保存挂起、远端版本 3 已提交、Studio 消费旧 201、CAS 只读复核完成、过期保存被 UI 拒绝后检查。只在出现差异时显示固定阶段和布尔状态，不暴露原始 SVG、草稿、摘要或用户身份。

## 2026-11-17 · 第十七小批：SVG 视口网格与工程图元的快照边界

第四轮真实浏览器日志在 React CAS 只读复核后确认 `canvasChanged=true`，但 `autoSaveChanged`、`draftCountChanged` 与 `draftHashChanged` 均为 false。源码调查发现 `scripts/test-project-browser-oidc.mjs` 的共享页面快照使用 `.studio-svg.innerHTML`，React/Vue SVG 包含一个直系 `rect[fill="url(#scada-studio-grid)"]`，它的 `x/y/width/height` 来自随浏览器视口变化的 `visibleRect`。因此直接比较全部 `innerHTML` 存在视口辅助网格变化造成误报的可能；**尚无真实 DOM 差异证据确认本轮只有网格变化**。

只在新 `scripts/test-oidc-studio-real-late.mjs` 联合验收中加入自包含的 `readStudioContentCanvasInPage`：克隆 SVG 节点，仅从克隆的直系子节点中移除唯一的视口网格矩形，再返回完整剩余 `innerHTML` 供五个原有操作边界做强制一致性比较。画布不存在或发现多个直系视口网格时继续拒绝；渲染图片的 `href`、真实图元、边界、命中区域及其他 SVG 内容均保留。现有 `inspectStudioState` 及其其他 OIDC 浏览器回归不修改，原草稿 SHA/数量与自动保存等检查保留。真实业务 SVG 发生变化时仍触发 `canvasChanged=true`。不接入浏览器持久化、Core、React/Vue 业务或 NestJS 变更。

## 2026-11-17 · 第三十四批第十八小批：409 冲突恢复的只读预览与水位双核验

共享 `packages/api-client/src/studio-session.ts` 新增 `previewLatestVersion(projectId): Promise<ServerProjectVersion>`，与现有 `readVersion` 共用 `contextGeneration` 代次与权限失效语义，但**不调用** `acceptLoadedVersion`。请求顺序为 `getMe → getProject(首水位) → readVersion(首水位) → getProject(末水位)`；每次 await 后校验代次，且快照的 `projectId`、`revision` 与两次远端 `headRevision` 必须一致。并发改版返回受控 409，既不提交版本也不把已过期快照返回给 UI；过期 401/404 不能污染后来重建的基线。当前请求发生真实 401/403/404 时按共享 `invalidateAccess` 拒绝后续误创建；网络失败保持合法基线。只读预览返回快照与身份信息，但**不使其成为 CAS 保存基线**。

两端 `StudioPage` 仅记录当前冲突对应的 `projectId`，避免工程切换后显示错误操作入口；409（包括前台可见性真实水位冲突）出现时提供“只读预览最新版本”。用户点击后沿用现有 `runServerAction`、历史忙碌与草稿互斥，先调用共享预览，再以真正受保护的 `listVersions(limit=10)` 读取第一页。只接受第一页最新修订号与刚核验的 `headRevision` 相同的结果，防止异步历史列表把已经过期的版本当作最新；之后更新 `serverRows`、`serverHeadRevision`、`serverInspectedVersion`，显示已有 `compareProjectDocuments` 内容差异。成功只读操作不改 `editor`、IndexedDB 和共享 CAS。用户仍必须单独点击已有版本“载入”并明确确认，才会暂停自动保存、替换画布及建立新基线。

复用 `scripts/test-project-browser-oidc.mjs --simulate-save-timing` 的隔离真实 Keycloak 浏览器模式：合成 409 被释放后，React/Vue Studio 必须显示预览按钮，点击后由真实 BFF 通过全部 GET 核验最新版本，预览比较可见且不创建 CAS，浏览器写入拦截器必须仍只记录先前的一个被拦截 POST；画布、草稿 SHA-256 与自动保存状态不变。此模式的 409 是**浏览器本地合成拒绝**，不是另行发生真实 PostgreSQL 写入冲突；此前真实 BFF/PostgreSQL CAS 验收另有独立证据。失败或不具备可信 OIDC 环境时保持拒绝，不泄露身份、Cookie、Token、响应正文或 SQL。

## 2026-11-17 · 第三十四批第十九小批：确认载入后的身份和水位复核

已有流程 `readVersion → window.confirm → pauseAutoSave → editor.loadDocument → acceptLoadedVersion` 在用户确认对话框期间存在时间差：`readVersion` 返回的最新水位可能已过期，确认后仍可能加载旧快照并错误提示“已载入最新版本”，虽然下一次 CAS 写入仍会被服务器拒绝。

新增框架无关的 `StudioServerProjectSession.revalidateConfirmedLoad(version): Promise<void>`，仅在用户**同意载入之后**调用。顺序：`getMe` → 校验当前 contextGeneration 与原 principal tenant/subject → `getProject(version.snapshot.projectId)` → 再校验 contextGeneration 与远端 `headRevision === version.headRevision`。身份不一致受控返回 403；远端水位变化受控返回 409，同时清除同工程的过期 CAS 基线（其他工程基线不受影响）；实时 401/403/404 走既有 `invalidateAccess`，阻断误创建；503/network 保留此前合法基线。所有请求都是 GET，不读取或写入 IndexedDB，不创建、追加、回滚或删除工程。过期异步请求在 catch 中仍核对 contextGeneration，不会清除后来已重新确认的有效基线。

React/Vue 原 `loadServerVersion` 及 `openServerProject` 确认对话后，先 await `revalidateConfirmedLoad`，再检查原编辑工程 ID 未发生变化，之后才执行现有 `pauseAutoSave`、`loadDocument` 与 `acceptLoadedVersion`。没有把预览自动转换成 CAS，也没有修改原确认提示或 IndexedDB 草稿持久化。早期历史版本如果服务端最新水位保持不变仍可载入，按既有规则得到空 CAS 基线。确认期间异步水位改变必须先失败，禁止替换 SVG；此防护不承诺对最终 GET 之后的远端写入提供事务级原子性，未来保存依旧由服务端行锁与 CAS 判断。

浏览器新增两种独立回归：原工程列表“打开”的测试钩子仅在 `window.confirm` 返回同意之后，针对本轮专用工程的一个 GET 摘要**合成水位 +1**，检查双框架拒绝载入、画布/草稿/自动保存不变；此数据不写入 PostgreSQL。原 409 保存模拟专项完成真实 BFF 最新版只读预览后，再点击**真实服务端版本列表的“载入”按钮**，接受原确认、执行真实 GET 复核，必须建立原最新 CAS 并暂停自动保存，同时保持 IndexedDB 草稿和写入拦截计数。测试不将合成 GET 漂移称为真实并发数据库提交，也不扩大工业设备控制权限。

## 2026-11-18 · 第三十四批第二十小批：真实多标签页 BFF 会话与 CAS 复核

新增 scripts/test-oidc-real-multitab.mjs 与 scripts/test-oidc-real-multitab.cases.mjs，不修改 StudioServerProjectSession、React/Vue Studio、NestJS、Prisma Schema、迁移或设备权限。测试复用现有 test-project-browser-oidc.mjs 的 Studio 页面动作、草稿摘要与写请求阻断器，复用 test-oidc-dual-cas.mjs 的专用工程创建、版本追加和真实 OIDC 登录，并复用 test-oidc-studio-real-late.mjs 的 SVG 语义快照（仅排除经源码确认的单个视口网格）。

真实浏览器使用一个临时 Profile 和四个 CDP Target：React 写入/跟随标签页、Vue 写入/跟随标签页。四个页面在导航前安装自包含可见性观察函数；两个跟随页面另外安装工程写请求本地阻断器。测试只通过 CDP Page.bringToFront 激活真实标签页，并要求浏览器报告 document.visibilityState === "visible" 且可见事件计数递增；不覆盖 DOM 属性、不手动派发 visibilitychange。一次真实 Keycloak 登录后，四个标签页各自从本机 React/Vue HTTPS Origin 请求 /api/v1/auth/me，并核对租户与主体相同，以证明两个 Origin 实际共享同一 Host Cookie BFF 会话。

专用工程通过正式同源 POST /api/v1/projects 创建，React 写入端以 CAS 1→2、Vue 写入端以 CAS 2→3 追加真实版本。React/Vue 跟随页切回前台后，现有 StudioServerProjectSession.revalidateBaseline 必须通过 BFF GET /auth/me 与工程摘要发现远端水位变化并清除旧 CAS；跟随页真实点击保存时，页面内写入阻断器记录的工程 POST 必须为零。之后两跟随页分别经现有人工确认载入最新修订 3，建立有效基线并恢复自动保存。

注销场景由 React 写入标签页向同源 /api/v1/auth/logout 发送真实 POST，使用当前 __Host-adui-scada-csrf Cookie 的双提交 X-SCADA-CSRF；浏览器自动附带 Origin/Sec-Fetch 元数据。隐藏跟随页在未切回前仍保持其内存状态，重新可见后各自真实请求 /auth/me 收到 401 并由现有页面逻辑清除服务端 CAS/授权缓存。全程不广播账户状态、不复制 Cookie、不读取或打印身份主体或令牌。

每个跟随页的画布、IndexedDB 草稿数量/整记录 SHA-256 和自动保存开关都进行前后比较。只在本轮随机专用工程创建首版及追加 2/3 版；工程保留供维护者复核，不修改既有工程、既有 ACL、身份映射和生产数据；新工程仅由现有创建 API 按既定事务创建创建者默认权限，不手工新增其他主体授权。离线测试只覆盖参数门禁、可见性状态、身份一致性、CSRF 注销契约、脱敏状态摘要及本地一致性断言；真实 Chrome/Edge、Keycloak、HTTPS 和 BFF 集成必须由维护者独立执行。

## 2026-11-18 · 第三十四批第二十二小批：同一 Profile 四标签页注销后身份核验

在原 `scripts/test-oidc-real-multitab.mjs` 中，React 写入页执行一次真实的、CSRF 保护的注销 HTTP 204。保留两个跟随页在仍隐藏时 CAS 为修订号 3 的原始保护断言；随后对注销发起的 React 写入页直接以当前 Origin 的 `readAuthStatusInPage` 获取真实 `/api/v1/auth/me` 状态，并要求严格 401。

React/Vue 跟随页仍按原顺序真实切换为可见，验证已有 `StudioServerProjectSession` 的 CAS/授权缓存清除、旧保存零写入及画布/草稿/自动保存不变。最后将原本未参加注销后状态验证的 Vue 写入页从隐藏切换到真实可见，在 Vue Origin 执行同源 `GET /api/v1/auth/me` 并要求 HTTP 401。以 Node 侧纯函数 `requireLogoutHttp401` 复用严格状态判断，任何非 401（包括网络错误映射的 0）均拒绝；CDP 注入函数保持自包含，不引用 Node 侧 helper。

本次不增加注销广播机制或主动推送，也不触发额外工程 POST、数据库查询或生产业务改动。测试窗口的 Cookie/Token/身份不输出，继续在结束时销毁隔离 Profile。

## 2026-11-18 · 第三十四批第二十三小批：写入页 Studio 基线与共享注销全页复核

真实四标签页专项继续先由 React/Vue 写入页使用受控 API 创建并追加专用工程至修订号 3，再让写入页各自真正进入 Studio、通过授权列表确认载入当前修订号 3。两个跟随页原有版本漂移、CAS 恢复、草稿保护流程不变。

新增 `prepareWriterReadOnlySession(session, revision)`，先对写入页执行自包含的 `installAccessDenialFaultInPage` 使后续项目 POST 被本地阻断，再通过 `inspectProtectedState` 只读抓取 SVG 内容、IndexedDB 草稿数量与全记录 SHA-256 和自动保存布尔值。读取 `readMultiTabSessionStateInPage` 并强制 `baselineRevision === revision` 与 `writeAttempts === 0`；使用原 `requireUnchangedStudioState` 检验快照完整性。不调用 `saveDraftInPage` 或 `enableAutoSaveInPage`，避免污染同 Origin 跟随页的共享 IndexedDB。

注销时先确认 React/Vue 跟随页、Vue 写入页均真实隐藏，React 写入页调用现有 CSRF 注销并直接验证同源 HTTP 401。随后依次实际激活 React 跟随、Vue 跟随、Vue 写入与 React 写入，四者均调用原 `verifyLogoutRevalidation`，验证 UI 中 CAS/远端水位与授权缓存失效、BFF GET 401、SVG/草稿/自动保存不变和旧保存零工程写入。所有额外调用仅针对本次隔离工程或只读 BFF 身份接口，严格保留浏览器脱敏和 Profile 释放。

此专项并非跨独立 Profile 的注销广播，也不涉及生产业务接口、工业设备控制或数据库迁移。

## 2026-11-18 · 第三十四批第二十四小批：隐藏页身份失效前的全量快照

原 `scripts/test-oidc-real-multitab.mjs` 的注销流程在 React 写入页 HTTP 204 后，对三个隐藏 Studio 标签页仅比较 `baselineRevision === 3` 和 `identityRejected === false`，完整 SVG/IndexedDB/自动保存检查直到它们恢复可见才执行。本批保留既有正式注销、真实页面恢复、零 POST 等全部验收约束，补充注销后、**任何隐藏页恢复可见前**的保护阶段。

新增 Node 侧纯断言 `requireHiddenSessionUnchanged(state, expectedRevision)`，对修订号、`baselineCleared`、`headCleared`、`identityRejected`、`busy`、`writeAttempts` 使用严格值比较；无效输入或提前变化统一抛出既有脱敏中文错误，不回显项目 ID、主体、Cookie、草稿内容或摘要。

新增内部 `verifyHiddenTabBeforeResume(session, beforeState)`：先通过既有 CDP 探针严格等待真实 `hidden`，只读提取会话摘要并断言 CAS/水位/零写入；再复用 `inspectProtectedState` 和 `requireUnchangedStudioState` 比较全量 SVG、IndexedDB 与自动保存状态。分别对 React 跟随、Vue 跟随、Vue 写入页调用，基准取各自已有的修订号 3 保护快照。React 注销发起页仍保持可见且通过真实 GET 获取 401，因此不属于隐藏页预检范围。

上述预检完成后仍沿用原有四个 Studio 页面真实可见性切换、BFF 401、CAS/授权缓存清理、原保存按钮零工程 POST 及本地数据保护测试。不会额外调用设备写入、清理数据库或修改测试工程 ACL。

## 2026-11-18 · 第三十四批第二十五小批：已注销会话对工程只读 API 的拒绝

真实多标签页脚本保留前序一次 CSRF 注销 HTTP 204、三个 hidden 页恢复前快照检查、四个 Studio 页真实可见性恢复、同源身份 GET 401、旧 CAS 保存阻断与 SVG/IndexedDB/自动保存保护。新增检查只在这组已有断言全部成功之后执行，不创建额外工程版本或改变测试隔离 Profile。

`readLogoutProjectStatusesInPage(origin, projectId, runtime)` 是可由 CDP 独立序列化的自包含页面函数，先以严格正则验证专用 `b34-oidc-cas-<UUID>` 工程 ID 与当前页面 Origin，校验失败不发请求并返回 `null`。随后顺序执行 **两个只读同源 GET**：列表 `?limit=10` 和本轮项目 `versions/3`，始终禁用重定向及缓存，仅将 HTTP 状态数字组成二元数组；网络、TLS 或重定向故障映射为 `0`，不读取响应正文与凭据。以 Node 侧 `requireLogoutProjectDenied` 要求数组长度恰好为 2 且两个状态均严格等于 401，任何其他结果以固定中文安全错误失败。

React 写入页和 Vue 写入页各执行一次完整二元探针，分别由独立白名单阶段标识失败 Origin；四标签页原 CAS/授权缓存检查不被替换。离线回归核对具体固定路径、只读请求选项、跨 Origin/非法项目 ID 零请求和网络及 HTTP 各类异常的 fail-closed 结果。此测试不证明不同浏览器 Profile 的注销传播或设备安全性。

## 2026-11-18 · 第三十四批第二十六小批：BFF 工程只读接口注销后的全路径校验

依据 `apps/server/src/projects/project-api.controller.ts` 的真实 `@Get()` 路由确认工程列表、工程详情、历史版本列表和单个历史版本四条 GET 均有 `ScadaSessionGuard`，其中详情额外要求 `project:read`，历史版本两个路由额外要求 `version:read`。本批不修改这些生产 Guard，而是扩展已合并第二十五小批的 `readLogoutProjectStatusesInPage` 页面侧同源只读探针。

页面函数仍然严格验证当前 Origin 与本轮 `b34-oidc-cas-<UUID>` 工程 ID，并依次访问 `?limit=10`、`/:id`、`/:id/versions?limit=10`、`/:id/versions/3` 四条固定 GET；保留 `credentials/mode: same-origin`、`redirect: error`、`cache: no-store`、`Accept: application/json`、无请求体、不读取响应正文。网络及 TLS 故障继续以数字状态 0 呈现，仅返回恰好四项状态数组到 Node 端。

`requireLogoutProjectDenied` 保持原中文脱敏诊断并将门禁从严格两项 401 扩展到**四项每一项都为 401**；不足、超量、缺失、200/3xx/403/5xx 均拒绝。真实浏览器脚本仍在原四 Studio 标签页和本地数据保护断言完成后，各从 React、Vue 写入页复用一次同一探针，不制造第二次注销或新的工程版本。

离线测试将原两个 GET 路由用例扩展至四路由，再新增一项逐个路由注入 200 的回归，验证任何单一路由放行都会失败、只读探针不会访问响应 `json()` 或 `text()`；目标离线总数 **20 项**。这不等于真实浏览器已经验证通过。

## 2026-11-18 · 第三十四批第二十七小批：Guard 早期拒绝响应禁止缓存

`apps/server/src/auth/scada-session.guard.ts` 的 `canActivate` 在确认 HTTP 上下文后、解析 Cookie/Authorization 前通过 NestJS `context.switchToHttp().getResponse()` 获取响应，将 `Cache-Control: no-store` 和 `Pragma: no-cache` 作为安全默认值设置。此位置早于所有 HTTP 401/403 拒绝，因此不依赖业务 Controller 装饰器成功返回之后才设置的 `@Header`；原鉴权分支、审计类别、CSRF 双提交、同源来源检查及 Bearer/Cookie 不混用逻辑均保持不变。

为避免将 NestJS 或 Express 全量响应对象引入身份模块类型约束，仅定义 `setHeader(name: string, value: string): void` 的局部窄接口。`ScadaSessionGuard` 原单元测试 `context` 夹具只读记录被设置的头；新增拒绝 401/403 单元用例，同时断言拒绝前不调用任何会话仓储。`OidcEnabledAppModule` 装配 E2E 在真实 NestJS HTTP 层核对 `auth/me` 和工程列表匿名 401 响应含 `no-store` / `no-cache`，没有真实数据库连接。

这是对拒绝路径的预防性加强，**不是**已有生产缓存泄漏的事故结论。需 Windows 真实质量链验证，新 HEAD 未运行前不声明完成或通过。依赖、工程 Schema、BFF Cookie/Token、授权流程、React/Vue 及工业网关均不变。

## 2026-11-18 · 第三十四批第二十八小批：真实 NestJS Guard 403 禁缓存 E2E

沿用 `apps/server/test/oidc-module-bootstrap.e2e-spec.ts` 的 `OidcEnabledAppModule` 真正装配路径，不单独 Mock Controller、Guard 或 HTTP 异常处理；外部 `PrismaService` 仍以 `{ client: {} }` 替换，不允许数据库查询。使用现有 `ScadaAuthController` 的 `POST /api/v1/auth/logout`，测试值满足 `scada_s_<43 chars>` / `scada_csrf_<43 chars>` 协议形状但不对应任何真实用户。

第一条用例带可信 `Origin`、`Sec-Fetch-Site: same-origin` 和两种 Cookie，刻意缺少 `X-SCADA-CSRF`，预期在 `ScadaSessionGuard` 的 CSRF 双提交检查中提前返回 403。第二条用例带匹配的 CSRF 请求头，但使用不可信 `Origin`，必须在 Origin 白名单检查处提前拒绝为 403。两条用例都逐项检查 JSON 403、安全固定中文原因、`Cache-Control: no-store`、`Pragma: no-cache`，并要求 `Set-Cookie` 与 `Location` 缺失，避免把未完成注销误报为清理成功。

不新增测试依赖，不改现有代码路径或异常吞吐；先前 401 HTTP 根模块用例保持不变。此次在已有 49 项 HTTP E2E 上新增 2 项，**新目标为 51/51（待 Windows 实测）**；Vitest 单元测试总数仍为 583 项，不改变浏览器、多标签页或工业现场验收边界。

## 2026-11-18 · PR #75 历史专项与新主线合流设计

在 `main` 已有的 `scripts/test-oidc-real-multitab.mjs` 四标签共享会话注销专项之外，保留 `scripts/test-oidc-studio-multitab.mjs` 的**同一 Origin 双标签 CAS** 功能。通过原有 `startBrowser` 在同一临时 Chrome/Edge Profile 创建第二 CDP 标签页，逐个 Origin 复用真实 BFF 身份、工程列表及 Studio 控件，只在明确确认的本机 OIDC HTTPS Lab 新建随机工程。两个标签的写入守卫在页面导航之前安装，工程 GET/HEAD 透传；非 GET/HEAD 默认拒绝，仅分别为 CAS=1 与 CAS=2 允许单次目标工程 POST。不得引用模块级常量进入被 CDP `function.toString()` 序列化的页面函数。

每个 Origin 的双标签页先载入修订 1，第二页创建 IndexedDB 草稿并启用自动保存。第一页真实保存修订 2 后，第二页通过真实可见性恢复触发只读水位复核，失效过期 CAS、拒绝旧版本 POST、保留画布/草稿/自动保存；然后真实只读预览、人工载入修订 2 并追加修订 3。第一页恢复可见后也必须拒绝旧 CAS。最终从唯一隔离 PostgreSQL 租户/工程过滤读取头版本、版本行与审计行，三版的内容摘要必须匹配两个实际 HTTP 201 结果。

复用现有 `createCasProjectInPage` 的安全边界，在新页面函数中**内联精确工程 ID 正则**，防止重复 E-002/E-025/E-039 的浏览器脚本引用 Node 模块闭包问题。离线用例在原 18 项基础上新增 1 项序列化边界检查，目标 19/19；它只能证明纯函数/安全门禁，不能代替真实 Keycloak/Chrome/PostgreSQL 验收。未更改任何生产 React/Vue、共享 Core、NestJS、Prisma 模型或迁移。

## 2026-11-18 · V0.3 第三十五批第一小批：工程发布前只读 SVG 兼容性契约

新增 `packages/core/src/release-preflight.ts`，对外导出 `validateProjectReleasePreflight(input: unknown): ProjectReleasePreflightResult`、`ProjectReleasePreflightIssue`。它首先调用已有 `validateProjectDocument`，只在严格 0.3.0 Parser 返回防御性工程副本时继续。Schema 错误使用同一 `DOCUMENT_INVALID` 问题结构；通过返回 `{ passed: true, issues: [] }`，否则返回 `{ passed: false, issues: [带 code、severity、path、message 的只读问题] }`。其中 `passed` 严格定义为**静态 SVG 兼容性门禁**，不得在客户端或服务端用它直接发起发布。

当前 `renderSvgPage` switch 仅实现 `tank`/`pump`/`pipe`/`label`，均使用现有 `symbolVersion: "1"` 的基础图元契约；定义相对应的只读槽位映射，依次验证图元类型、图元版本、非空 `rules`、绑定槽、绑定 Tag 类型。错误码为 `UNSUPPORTED_SYMBOL`、`UNSUPPORTED_SYMBOL_VERSION`、`UNSUPPORTED_RULES`、`UNSUPPORTED_BINDING_SLOT`、`UNRESOLVED_BOUND_TAG`。即使图元当前被隐藏，也不跳过规则和兼容性验证；有效但未绑定的 `unknown` Tag 不会被错误升级或阻断。

遍历严格按照 Parser 的页面、图元和绑定插入顺序返回稳定问题路径。不会调用 `createProjectSnapshot`、任何 DraftRepository、IndexedDB、网络或数据库；不更改原来的 `validateProjectDocument`、工程 JSON、运行 SVG renderer、Tag 类型定义，也没有授权写入口。当前 SVG/绑定映射由受支持的四种图元静态列出，未来扩展 SVG 注册/规则引擎时须同步更新，不能误把被渲染器忽略的值当成已支持。

这是 FR-008 的一个**可测试前置步骤**，并未实现完整发布校验流程。正式发布仍须后续独立设计服务器授权、发布记录与不可变快照、事务指针及回滚、发布快照运行时加载、实时 Tag 来源与数据质量、安全审计；本小批不会开放工业写入。

## 2026-11-18 · 第三十五批第二小批：React/Vue Studio 静态发布预检 UI

React `StudioPage.tsx` 用 `useMemo(() => validateProjectReleasePreflight(state.document), [state.document])` 派生结果；Vue `StudioPage.vue` 用 `computed(() => validateProjectReleasePreflight(state.value.document))` 派生结果。两端都不维护独立的可过期报告缓存，也不将结果存进 Schema、IndexedDB、服务端或新的状态管理包；用户切换、载入、编辑工程后均依当前 `document` 重新计算。

在现有 `studio-version-menu` 折叠菜单中新增「发布预检」，复用共享 `studio-version-panel` / `studio-version-list` 样式和无障碍状态文案。通过显示明确的**只读静态兼容性**结论；失败枚举全部 `issues`，分别显示 `path` 与中文 `message`，不输出/执行任意文档规则内容，不利用文档值构建 HTML。DOM 文本由 React/Vue 自动转义；不发出任何网络请求。

新增 `scripts/test-studio-browser.mjs --release-preflight` 和根脚本 `test:release:preflight:browser`。测试基于现有临时 Chromium Profile、React/Vue HTTP 开发端口，浏览器里只调用正式 Studio JSON 导入/导出按钮，使用 Schema 合法却含未来图元类型、未实现规则及历史 `unknown` 已绑定 Tag 的隔离内存数据模拟失败，再恢复原 JSON 并检查没有过期问题。专项不能被当作正式发布接口或数据库/工业现场验收。

## 2026-11-18 · 第三十五批第三小批：SVG 图元属性消费边界

共享 Core 的静态预检新增 `UNSUPPORTED_SYMBOL_PROP`，只对已支持的 `tank` / `pump` / `pipe` / `label` 按现有 `renderSvgPage` 消费范围检查 `props`。水箱、水泵、管道仅允许 Studio 的 `__scadaStudio` 编辑状态；文本图元另外允许 `text` 与 `unit`。不受支持的属性即使符合 Schema 的 JSON 安全约束，也不得被静态预检误判为 SVG 运行时已经处理，逐项返回 `pages[i].nodes[j].props.属性名` 及中文原因。未知图元仍以 `UNSUPPORTED_SYMBOL` 拒绝，不为未知类型猜测属性契约。

此规则不改 `parseScadaDocument`、编辑器、渲染器、Schema、工程快照及版本写入；未来 SVG 图元真正支持新属性时，必须同步更新预检消费映射与测试。当前静态预检通过仍不代表可正式发布、具备工业数据源或运行时安全保障。本批新增三个 Core 单测；Windows 质量链与双框架浏览器专项待实测。

## 2026-11-18 · 第三十五批第四小批：服务端已保存版本只读发布预检

新增 `GET /api/v1/projects/:projectId/versions/:revision/release-preflight`，只由已启用可信 OIDC 的 `ProjectApiController` 注册。执行顺序：

1. `ScadaSessionGuard` 验证可信会话，`ScadaProjectGuard` 根据服务端可信主体与工程 ACL 预检查 `version:read`；错误默认拒绝。Controller 使用现有安全正整数解析器拒绝非法 revision。
2. `PrismaProjectVersionStore.preflightRelease` 再检查主体/工程 ID，进入现有 `$transaction`，对工程执行 `FOR SHARE` 行锁，并在锁内复核 `version:read` 权限；只有 `head_revision === revision` 才继续，否则以既有 `ProjectRevisionConflictError` 返回 409。先做权限复核再检查水位，不泄漏未授权工程的 head。
3. 在同一事务读取对应历史快照，调用 `readProjectSnapshot` 验证文档、SHA-256，比较 `projectId`、`revision`、`contentHash`、`createdAt` 与数据库列，异常不得返回成功报告。
4. 调用共享 Core `validateProjectReleasePreflight(snapshot.document)`，只返回如下**只读报告**，不包含完整工程正文：
   ```json
   {
     "projectId": "water-demo",
     "revision": 1,
     "headRevision": 1,
     "contentHash": "SHA-256 十六进制摘要",
     "passed": true,
     "issues": []
   }
   ```

`passed` 仅代表检查时该已保存版本满足现有 SVG 静态兼容性，**不是发布许可**；响应始终 `Cache-Control: no-store`。锁的保护范围仅限该次读取事务；请求结束后版本仍可能继续追加，因此未来真实发布必须重新在独立发布事务中比较版本、授权及安全门禁，而不能信任本次预检结果。新增只读路由没有发布历史表、设备连接、工业命令或数据源访问。

单元测试覆盖有效当前版本、静态属性错误、过期水位、授权缺失/工程不存在、损坏摘要与无效 revision；HTTP E2E 覆盖 200/401/404/409/400 与零工程写入。服务端没有直接接收未保存的 Studio 编辑态；React/Vue 仍使用当前共享 Core 的本地静态预检，接入服务端报告须独立设计工程保存/载入及水位保护。

## 2026-11-18 · 第三十五批第七小批：框架无关服务端预检 API Client 契约

`packages/api-client/src/index.ts` 的 `ScadaApiClient` 新增 `preflightRelease(projectId: string, revision: number): Promise<ScadaReleasePreflightReport>`。服务端路由与 Prisma 事务完全沿用第四、第五小批已实现的只读行为。共享 Client 构造的 GET 目标固定为 `/api/v1/projects/{projectId}/versions/{revision}/release-preflight`，不得输入外部 Origin，使用已有 `credentials: same-origin`、`mode: same-origin`、`redirect: error`、`cache: no-store`、`referrerPolicy: no-referrer`，不读取 CSRF Cookie，也不携带请求体。

新的响应解析器要求精确六个根字段；`revision` 与 `headRevision` 都等于本次请求的正安全整数，`projectId` 必须一致，`contentHash` 必须是小写 SHA-256 格式（不重新计算服务端快照摘要，服务端仍负责持久化完整性核对）。`issues` 必须为最多 10000 条的数组，每条精确为 `code/severity/path/message`，代码只允许共享 Core 当前的 `DOCUMENT_INVALID`、`UNSUPPORTED_SYMBOL`、`UNSUPPORTED_SYMBOL_VERSION`、`UNSUPPORTED_BINDING_SLOT`、`UNSUPPORTED_SYMBOL_PROP`、`UNRESOLVED_BOUND_TAG`、`UNSUPPORTED_RULES`；severity 必须为 `error`，非空路径和中文原因的长度上限 512，`passed` 与有无 issue 必须一致。API 200 也必须包含 `Cache-Control: no-store`，否则 `invalid_response`。严格拒绝多余的 `document`、`snapshot`、`token`、`published` 等字段。

本批仅扩展框架无关 Client 类型与请求/解析能力，不持久化报告、不改 Studio UI、工程 Schema、服务端模块、CAS 基线、权限或数据库迁移。预检报告通过不等于正式发布许可；工程后续仍可能被其他主体更新，未来发布事务必须重新复核身份、授权、修订水位、静态兼容性以及工业安全条件。新增 8 条 API Client Vitest 反向/正向用例，并更新现有 Studio 会话测试 Mock 以满足新的接口签名。

## 2026-11-18 · 第三十五批第八小批：双框架只读服务端预检 UI 与共享水位编排

新增 `packages/api-client/src/server-release-preflight.ts` 的 `readCurrentServerReleasePreflight(api, projectId)`，只接受 `getProject/readVersion/preflightRelease` 三个只读依赖。执行 `GET project head → GET 具备 SHA-256 校验的完整版本快照 → GET 只读预检报告 → GET 最终 head`；快照的工程/修订号与请求必须一致，预检内容摘要必须与完整快照一致，第二次 head 变化抛出受控 `conflict/409`。不创建 CAS 基线、不修改工程或身份/授权缓存，也不保留持久化报告。新增 5 项 Vitest，覆盖正常、并发版本推进、摘要损坏、错版快照和身份/权限拒绝。

`ServerReleasePreflight.tsx` / `ServerReleasePreflight.vue` 是同构 UI 适配层：手动触发，不对当前文档自动发网络请求；在内存保存与请求时文档对象关联的已保存快照和预检报告，只在仍是发起请求时的编辑文档时显示。用共享 Core `compareProjectDocuments` 判断当前画布是否与远端快照一致；即使服务端 `passed=true`，不一致时必须显式提示“当前画布不能视为通过服务端预检”，且无论匹配与否都明确不是正式发布许可。编辑对象变化隐藏旧报告，父级服务端修订号/授权变化导致子面板重新挂载。认证/ACL 被拒绝时通知父级原有 `invalidateServerAccess`，但不清空本地画布与 IndexedDB。无授权、网络错误、409 和无效响应均只显示既有脱敏错误，不触发新建或版本追加。

原 `test:release:preflight:browser` 只读检查增加“双框架有独立服务端预检手动按钮，未点击前不会渲染服务端通过状态”；不模拟真实 Keycloak，会继续保留既有合法/不兼容 JSON 往返保护。真实受保护 UI 点击浏览器联调需要未来独立专项，不能将此 UI 结构断言视为已通过真实身份、服务端版本或发布事务验收。

## 2026-11-18 · 第三十五批第九小批：真实 OIDC Studio 按钮只读浏览器验收架构

新 `scripts/test-oidc-studio-release-preflight.mjs` 复用既有 `startBrowser`、`waitForLogin`、`readReleasePreflightInPage`、工程列表分页及 `openProjectInPage` 真实确认载入流程。先用真实同源 GET 选取已授权、拥有版本读取权限的现有工程，绝不为测试创建工程或修改 ACL；登录后通过 CDP `Page.addScriptToEvaluateOnNewDocument` 注入**自包含**工程 Fetch 安全门禁，使 API Client 构造前即捕获受控 Fetch。门禁阻止工程 POST/DELETE 与跨 Origin 工程请求，记录固定 `head/snapshot/preflight` 路由类别；401/404/409 仅对当前授权工程指定版本的预检 GET 生成受控 `Response`，不传播为服务器写入或更改权限。

正常场景断言唯一 `head → snapshot → preflight → head` GET 顺序、结果修订与静态问题数量、当前画布与已保存快照一致；用导出 JSON SHA-256、去除视口网格后的完整 SVG、IndexedDB 草稿整记录摘要、自动保存开关和 CAS 基线对比预检前后状态。使用正式“+ 文本”按钮对临时编辑画布造成**未保存**变化；核对旧结果被隐藏，再次服务端预检只说明已保存版本通过，不把改变后的本地画布当作服务端已验证。409 检查错误展示与基线不变，401/404 检查访问失效后的 CAS 清空、画布/草稿/自动保存不变；最后撤销模拟并真实 GET 核验远端水位与摘要。

`scripts/test-oidc-studio-release-preflight.cases.mjs` 共 12 项 Node 离线正反向用例，验证默认禁止写入参数、跨域与工程写入阻断、四段 GET、模拟返回、参数界限、页面按钮、默认无成功报告、CDP 序列化独立性及脱敏。根 `test:release:preflight:oidc:studio:config` 纳入 `ready`，交互式 `test:release:preflight:oidc:studio:browser` **不得**纳入 `ready`。不修改正式 UI、Core、API Client、NestJS、Prisma 或工程 Schema；FR-008 正式发布事务依旧缺失。

## 2026-11-18 · 第三十五批第十小批：迟到 401 对等传播与只读故障注入

React `ServerReleasePreflight.tsx`、Vue `ServerReleasePreflight.vue` 的异步 `catch` 中将两类副作用拆开：**会话级**身份/ACL 拒绝通知由 `active` 生命周期控制，独立于本地文档引用；**仅针对发起时文档的局部错误显示**继续验证当前文档引用一致。成功报告的文档绑定与 Core `compareProjectDocuments` 不变；不影响共享 `readCurrentServerReleasePreflight` 的四段 GET、无请求体、no-store 和最终水位检查。父级原有 `invalidateServerAccess` 负责清理远端摘要和 CAS，绝不删除本地编辑器或 IndexedDB 草稿。

既有 `scripts/test-oidc-studio-release-preflight.mjs` 的预检 GET 安全门禁增加 `holdStudioPreflight401InPage` / `releaseStudioPreflight401InPage`，只允许已 arm 的当前工程修订号、401 且单次挂起状态，禁止挂起时再次设置目标；释放的是已合成的本地拒绝，不向真实 BFF 发出写入。真实 React/Vue Studio 自动化在预检响应未返回期间通过正式按钮新增未保存图元，断言释放 401 后原会话 CAS 已失效、报告未显示且 SVG、JSON、草稿、自动保存未因预检变化。新增 1 项 Node 离线安全测试，保留原 12 项及真实 409、404 回归。测试和浏览器均不得用模拟成功或修改授权代替真实 Keycloak 登录。

## 2026-11-18 · 第三十五批第十一小批：正式发布指针/回滚事务方案待评审

[ADR-0069](adr/0069-release-pointer-atomic-publication-design.md)（**Proposed**）定义今后写入功能的设计边界，而**不是现有 NestJS/Prisma 的可调用接口**。核心区分为：`headRevision` 仅代表编辑版本水位；独立 `releasedRevision/releasedContentHash` 只表示当前运行发布版本；`releaseGeneration` 为严格单调的发布/回滚 CAS 代次，防止发布→回滚→再发布相同修订号时的 ABA 问题。事务写入候选须在锁内复核可信主体、独立 `release:publish`/`release:rollback` ACL、期望版本及代次，重新读取并校验不可变 ProjectSnapshot 和 Core 兼容性，并在同一事务中追加发布事件与切换指针。回滚目标必须是曾实际发布过的快照，不能直接指向任意已保存工程版本或草稿。

当前真实代码只有 `project:read/version:read/version:append` 三种 ACL、不可变工程历史、版本追加审计和**只读** `release-preflight` GET，没有发布表、指针、事务、角色、路由或 Runtime 发布态加载。是否采用本 ADR 的候选列名、API 路径、幂等与审计策略仍需维护者审核；新增正式写入之前必须先完成迁移中文注释、隔离数据库并发/故障回滚、双框架运行时只读安全等专项。任何预检 `passed=true` 均不能代替发布事务内重新校验。

## 2026-11-18 · 第三十五批第十二小批：发布写事务准入评审

[正式发布事务评审决策与验收矩阵](RELEASE_TRANSACTION_REVIEW.md) 仅提供 ADR-0069 **Proposed** 状态下的 R-01～R-08 待决建议、编辑/发布指针独立不变量 I-01～I-06、T-01～T-22 未来故障注入验收。包含同工程并发 CAS、ABA、撤权竞争、幂等重试、跨租户不可枚举、审计与指针单事务、Runtime 只认已提交冻结快照等测试义务。**矩阵中的拟定 ACL、路由、模型和 HTTP 错误不代表当前 NestJS/Prisma 已支持**；只有获得独立架构与工业安全审查、实施迁移并经真实数据库验证后才允许写入实现。
