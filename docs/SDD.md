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

OIDC 配置解析器只在 `SCADA_OIDC_ENABLED=true` 时验证 Issuer、Client ID/Secret、Redirect URI、Origin 和 Base64URL 32 字节加密密钥；生产配置必须使用 HTTPS，非生产回环 HTTP 必须另行显式启用。所有错误均使用固定中文提示，不包含原始凭据。当前 main.ts 在 enabled 时拒绝启动，直到完整认证、Cookie/CSRF Guard 和工程 ACL HTTP 边界实施后才会移除此保护。

共享 DatabaseModule 持有唯一 PrismaService 提供方，ScadaIdentityModule 和 ProjectPersistenceModule 都只通过 imports 使用它；默认 AppModule 仍不导入上述模块。

新增 ScadaExternalIdentity，以复合主键 (issuer, subject) 关联现有本地 ScadaIdentity；新增 ScadaOidcTransaction，使用 stateHash 主键、浏览器绑定摘要、nonce、AES-GCM 加密密文、到期/消费时间及站内路径；为 ScadaAuthSession 添加可空 csrfTokenHash，兼容既有 Bearer 会话。上述模型与迁移已在维护者本机隔离 `adui_scada_test` 应用，`pnpm run test:db` 的 16/16 真库测试通过。阶段 B 第一、二小批已实现 Discovery、授权码登录发起、AES-256-GCM PKCE verifier 加密与一次性事务服务；维护者 Windows 已通过对应单测及完整 `ready`。第三小批授权码回调、ID Token 校验、预绑定身份查询和内部会话签发服务已提交，新增回调 Mock 单测待 Windows 验证。真实 IdP 联调、真实 PostgreSQL 并发消费、Cookie/CSRF HTTP Controller 尚未验收或实现。

### 第三十三批阶段 B 第一、二小批实际实现状态（2026-11-14）

- `OidcProviderDiscoveryService.getConfiguration()`：固定 Issuer 的惰性 Discovery，10 秒超时，成功配置进程内缓存；校验授权码、主体标识、RS256、PKCE S256 和端点协议边界。
- `OidcLoginTransactionService.start(returnPath, existingBrowserBinding?)`：生成独立 State/Nonce/PKCE verifier，计算 S256 challenge，构建固定 Redirect URI 的授权码请求；State 与浏览器绑定仅存 SHA-256 摘要，verifier 使用 AES-256-GCM 加密，登录事务有效期 5 分钟。
- `OidcLoginTransactionService.consume(state, browserBindingCookie)`：在 PostgreSQL 交互事务中按固定 Issuer、State 摘要、浏览器绑定、创建/过期时间和未消费条件筛选，再通过条件 `updateMany` 原子消费；消费后重新校验 Nonce 与站内回跳路径，再解密 verifier。密文使用 State 摘要作为 GCM AAD。
- 同一浏览器绑定 Cookie 可用于多个标签页，但每个事务独立生成 State/Nonce/verifier；无效、过期、跨浏览器、重复或并发失败均不返回 verifier。
- 当前只实现服务层，尚未注册 Controller；`main.ts` 对 `SCADA_OIDC_ENABLED=true` 仍 fail-closed。Cookie 的 HttpOnly/Secure/SameSite 属性、CSRF Guard 和工程 API 均未开放。
- 第一、二小批维护者 Windows 已通过 `vp check`、`test:unit`、`docs:check` 和完整 `ready`；第三小批回调单测尚待维护者执行。Mock 测试不代表真实 PostgreSQL 并发锁或真实 IdP 联调。

### 第三十三批阶段 B 第三小批：授权码回调、ID Token 与预绑定身份（代码已提交，待 Windows 验证）

- `OidcCallbackService.complete(response, browserBindingCookie)` 先通过 `OidcLoginTransactionService.consume()` 一次性消费 State 和浏览器绑定事务；OAuth 错误响应也消费事务，避免重放。
- 回调参数只接受单值 State、授权码及可选 `iss`；当 Discovery 元数据声明支持 Authorization Response Issuer 参数时必须提供，并始终要求其与固定 Issuer 完全一致。
- 使用服务端配置的固定 Redirect URI 构造回调 URL，不读取请求 Host/Forwarded Header；通过 openid-client 6.8.9 `authorizationCodeGrant()` 兑换授权码，显式传入 expectedState、expectedNonce、PKCE verifier 和 ID Token 必须存在的检查。
- ID Token 的签名、Issuer、Audience、有效期和 Nonce 基础验证由 openid-client 完成；应用层再检查固定 Issuer、Client ID Audience、azp、多 Audience、Nonce、Subject 的 ASCII/长度约束及时间声明类型。
- 只按精确 `(iss, sub)` 查询 `ScadaExternalIdentity`，要求关联 `ScadaIdentity.status = active`；未预绑定或已停用均拒绝，不按 email、用户名或 Claim 自动创建主体/租户。
- 验证成功后复用 `AuthSessionService.issueForVerifiedSubject()` 签发本地 15 分钟不透明会话。IdP Access/Refresh/ID Token 仅在兑换调用内存中短暂存在，不保存、不写日志；服务返回的本地 sessionToken 仅供后续服务端 Controller 设置 HttpOnly Cookie，当前没有 HTTP 路由。
- 新增 Mock 授权码兑换、Prisma 身份映射和会话服务测试；覆盖 State/浏览器绑定、OAuth 错误、`iss` 参数、PKCE/Nonce 检查参数、ID Token Claims、未绑定/停用身份、异常脱敏和 IdP Token 不进入结果。**代码与测试尚未在维护者 Windows 环境执行**；当前仍保持 OIDC fail-closed。