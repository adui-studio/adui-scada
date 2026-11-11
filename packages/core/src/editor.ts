import {
  migrateScadaDocument,
  parseScadaDocument,
  STUDIO_NODE_STATE_KEY,
  studioNodeLocked,
  studioNodeVisible,
} from "./document.ts";
import type { ScadaDocument, ScadaNode, ScadaNodeType } from "./document.ts";
import { expandGroupedSelection } from "./grouping.ts";

export interface EditorSnapshot {
  readonly document: ScadaDocument;
  readonly activePageId: string;
  readonly selectedId: string | null;
  readonly selectedIds: readonly string[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly hasClipboard: boolean;
}

export type Alignment = "left" | "right" | "hcenter" | "top" | "bottom" | "vcenter";
export type LayerAction = "front" | "back" | "forward" | "backward";
export type EditableSymbol = "tank" | "pump" | "pipe" | "label";
export type NodeTransformPatch = Partial<ScadaNode["transform"]>;

/** 几何属性名称由共享 Core 统一提供，Vue/React 属性面板不再重复定义。 */
export const GEOMETRY_PROPERTY_FIELDS = [
  ["x", "X 坐标"],
  ["y", "Y 坐标"],
  ["width", "宽度"],
  ["height", "高度"],
  ["rotation", "旋转角度（度）"],
] as const satisfies readonly (readonly [keyof NodeTransformPatch, string])[];

const HISTORY_LIMIT = 100;
const LOCKED_NODE_MESSAGE = "所选图元包含已锁定图元，请先解锁";

/** 只更新共享 Schema 中受验证的 Studio 扩展状态，不修改业务属性。 */
function withStudioState(node: ScadaNode, key: "locked" | "visible", enabled: boolean): ScadaNode {
  const previous = node.props[STUDIO_NODE_STATE_KEY] as Record<string, boolean> | undefined;
  const metadata = { ...previous };
  if (key === "locked" ? enabled : !enabled) metadata[key] = enabled;
  else delete metadata[key];
  const props = { ...node.props };
  if (Object.keys(metadata).length > 0) props[STUDIO_NODE_STATE_KEY] = metadata;
  else delete props[STUDIO_NODE_STATE_KEY];
  return { ...node, props };
}

/** 锁定状态变更本身可撤销，但不得同时修改受锁定保护的其他内容。 */
function withoutLockState(node: ScadaNode): string {
  const props = { ...node.props };
  const raw = props[STUDIO_NODE_STATE_KEY];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const flags = { ...(raw as Record<string, boolean>) };
    delete flags.locked;
    if (Object.keys(flags).length > 0) props[STUDIO_NODE_STATE_KEY] = flags;
    else delete props[STUDIO_NODE_STATE_KEY];
  }
  return JSON.stringify({ ...node, props });
}

/** 当前 SVG 图元的可编辑绑定槽；不允许向其他图元添加未知槽。 */
export function editableTagSlot(type: string): "level" | "running" | "value" | null {
  switch (type) {
    case "tank":
      return "level";
    case "pump":
      return "running";
    case "label":
      return "value";
    default:
      return null;
  }
}

const DEFAULT_SYMBOLS: Record<EditableSymbol, { width: number; height: number }> = {
  tank: { width: 140, height: 160 },
  pump: { width: 110, height: 110 },
  pipe: { width: 200, height: 24 },
  label: { width: 200, height: 32 },
};

/** 省略页面 ID 时仍定位第一页，兼容现有单页面调用。 */
function firstPage(document: ScadaDocument, pageId?: string) {
  const page =
    pageId === undefined ? document.pages[0] : document.pages.find((item) => item.id === pageId);
  if (!page)
    throw new RangeError(pageId === undefined ? "工程文档不包含页面" : "未找到页面：" + pageId);
  return page;
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${label} 必须为有限数`);
}

function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(Math.round(value), Math.max(0, Math.floor(maximum))));
}

/** 以统一的受限位移移动整组图元，保持组内相对位置。 */
export function withNodesTranslated(
  document: ScadaDocument,
  nodeIds: readonly string[],
  dx: number,
  dy: number,
  pageId?: string,
): ScadaDocument {
  finite(dx, "水平位移");
  finite(dy, "垂直位移");
  const checked = parseScadaDocument(document);
  const page = firstPage(checked, pageId);
  const selected = expandGroupedSelection(page.nodes, nodeIds);
  const nodes = page.nodes.filter((node) => selected.has(node.id));
  if (nodes.length === 0) return checked;
  if (nodes.some(studioNodeLocked)) throw new TypeError(LOCKED_NODE_MESSAGE);

  const minDx = Math.max(...nodes.map((node) => -node.transform.x));
  const maxDx = Math.min(
    ...nodes.map((node) => page.size.width - node.transform.width - node.transform.x),
  );
  const minDy = Math.max(...nodes.map((node) => -node.transform.y));
  const maxDy = Math.min(
    ...nodes.map((node) => page.size.height - node.transform.height - node.transform.y),
  );
  if (minDx > maxDx || minDy > maxDy) {
    throw new RangeError("所选图元无法完整放入当前页面");
  }
  // 吸附结果可能恰好落在小数边界上，不能再次取整。
  // 其他位移仍先取整，再限制到精确可行区间。
  function normalizeShift(value: number, minimum: number, maximum: number): number {
    if (value === minimum || value === maximum) return value;
    return Math.max(minimum, Math.min(Math.round(value), maximum));
  }
  const shiftX = normalizeShift(dx, minDx, maxDx);
  const shiftY = normalizeShift(dy, minDy, maxDy);

  return parseScadaDocument({
    ...checked,
    pages: checked.pages.map((candidate) =>
      candidate.id !== page.id
        ? candidate
        : {
            ...candidate,
            nodes: candidate.nodes.map((node) =>
              !selected.has(node.id)
                ? node
                : {
                    ...node,
                    transform: {
                      ...node.transform,
                      x: node.transform.x + shiftX,
                      y: node.transform.y + shiftY,
                    },
                  },
            ),
          },
    ),
  });
}

/**
 * 返回指定页面中与拖动选框相交的图元 ID。
 * 旋转图元采用保守的轴对齐外接矩形进行命中计算。
 * 选择状态和画布缩放由调用方管理，不写入工程 JSON。
 */
export function findNodesInRect(
  document: ScadaDocument,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  pageId?: string,
): string[] {
  for (const coordinate of [startX, startY, endX, endY]) finite(coordinate, "框选坐标");
  const left = Math.min(startX, endX);
  const right = Math.max(startX, endX);
  const top = Math.min(startY, endY);
  const bottom = Math.max(startY, endY);
  if (right === left || bottom === top) return [];
  const page = firstPage(parseScadaDocument(document), pageId);

  return page.nodes
    .filter((node) => {
      if (!studioNodeVisible(node)) return false;
      const t = node.transform;
      const angle = (t.rotation * Math.PI) / 180;
      const halfX =
        (Math.abs(Math.cos(angle)) * t.width + Math.abs(Math.sin(angle)) * t.height) / 2;
      const halfY =
        (Math.abs(Math.sin(angle)) * t.width + Math.abs(Math.cos(angle)) * t.height) / 2;
      const centerX = t.x + t.width / 2;
      const centerY = t.y + t.height / 2;
      return (
        centerX + halfX >= left &&
        centerX - halfX <= right &&
        centerY + halfY >= top &&
        centerY - halfY <= bottom
      );
    })
    .map((node) => node.id);
}

/** 保留兼容旧调用方式的单图元绝对定位方法。 */
export function withNodePosition(
  document: ScadaDocument,
  nodeId: string,
  x: number,
  y: number,
  pageId?: string,
): ScadaDocument {
  finite(x, "图元 X 坐标");
  finite(y, "图元 Y 坐标");
  const page = firstPage(document, pageId);
  const node = page.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new RangeError(`未找到图元：${nodeId}`);
  return withNodesTranslated(
    document,
    [nodeId],
    x - node.transform.x,
    y - node.transform.y,
    pageId,
  );
}

/** 原子修改单个图元的几何属性；未旋转的布局矩形必须完整位于页面内。 */
export function withNodeTransform(
  document: ScadaDocument,
  nodeId: string,
  patch: NodeTransformPatch,
  pageId?: string,
): ScadaDocument {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError("图元几何属性必须为普通对象");
  }
  const prototype = Object.getPrototypeOf(patch);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("图元几何属性必须为普通对象");
  }
  for (const [key, value] of Object.entries(patch)) {
    if (!["x", "y", "width", "height", "rotation"].includes(key)) {
      throw new TypeError(`不支持的图元几何属性：${key}`);
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`图元几何属性 ${key} 必须为有限数`);
    }
  }

  const checked = parseScadaDocument(document);
  const page = firstPage(checked, pageId);
  const node = page.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new RangeError(`未找到图元：${nodeId}`);
  if (studioNodeLocked(node)) throw new TypeError(LOCKED_NODE_MESSAGE);
  if (node.groupId) throw new TypeError("已组合图元不能单独修改几何属性，请先解组");

  const transform = { ...node.transform, ...patch };
  if (
    transform.width < 0.1 ||
    transform.width > 16384 ||
    transform.height < 0.1 ||
    transform.height > 16384
  ) {
    throw new RangeError("图元宽度和高度必须在 0.1～16384 之间");
  }
  if (transform.rotation < -360 || transform.rotation > 360) {
    throw new RangeError("图元旋转角度必须在 -360～360 度之间");
  }
  if (
    transform.x < 0 ||
    transform.y < 0 ||
    transform.x + transform.width > page.size.width ||
    transform.y + transform.height > page.size.height
  ) {
    throw new RangeError("图元位置或尺寸超出当前画布范围");
  }

  return parseScadaDocument({
    ...checked,
    pages: checked.pages.map((candidate) =>
      candidate.id !== page.id
        ? candidate
        : {
            ...candidate,
            nodes: candidate.nodes.map((item) =>
              item.id === nodeId ? { ...item, transform } : item,
            ),
          },
    ),
  });
}

/** 整个工程内的页面、图元和组合共用同一个标识符命名空间。 */
function occupiedIds(document: ScadaDocument): Set<string> {
  const ids = new Set<string>();
  for (const page of document.pages) {
    ids.add(page.id);
    for (const node of page.nodes) {
      ids.add(node.id);
      if (node.groupId) ids.add(node.groupId);
    }
  }
  return ids;
}

/** 先保留新 ID，保证单次复制中的所有实体也不会发生冲突。 */
function allocateId(used: Set<string>, prefix: "page" | "node" | "group"): string {
  let ordinal = 1;
  while (used.has(`${prefix}-${ordinal}`)) ordinal++;
  const id = `${prefix}-${ordinal}`;
  used.add(id);
  return id;
}

/** 完整复制图元与组合关系，Tag ID 保持原值，原始节点不受影响。 */
function cloneNodes(source: readonly ScadaNode[], used: Set<string>, dx = 0, dy = 0): ScadaNode[] {
  const groups = new Map<string, string>();
  for (const node of source) {
    if (node.groupId && !groups.has(node.groupId)) {
      groups.set(node.groupId, allocateId(used, "group"));
    }
  }
  return source.map((node) => ({
    ...node,
    id: allocateId(used, "node"),
    ...(node.groupId ? { groupId: groups.get(node.groupId)! } : {}),
    transform: {
      ...node.transform,
      x: node.transform.x + dx,
      y: node.transform.y + dy,
    },
  }));
}

/** 锁定图元的原始层序不可因其他图元排序而间接变化。 */
function assertLockedLayerIndices(original: readonly ScadaNode[], next: readonly ScadaNode[]) {
  for (let index = 0; index < original.length; index++) {
    const node = original[index]!;
    if (studioNodeLocked(node) && next.findIndex((item) => item.id === node.id) !== index) {
      throw new TypeError("调整层级会移动已锁定图元，请先解锁");
    }
  }
}

function equalDocuments(left: ScadaDocument, right: ScadaDocument): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * 框架无关的 V0.2 组态编辑会话。
 * 图元选择和视图状态不会写入可跨框架交换的 ScadaDocument JSON。
 */
export class DocumentEditor {
  private current: ScadaDocument;
  private activePageId: string;
  private selection: string[] = [];
  private clipboard: { nodes: ScadaNode[]; pasteCount: number } | null = null;
  private readonly past: { document: ScadaDocument; pageId: string; redoPageId: string }[] = [];
  private readonly future: { document: ScadaDocument; pageId: string; redoPageId: string }[] = [];

  constructor(source: unknown) {
    this.current = parseScadaDocument(source);
    this.activePageId = firstPage(this.current).id;
  }

  snapshot(): EditorSnapshot {
    return {
      document: parseScadaDocument(this.current),
      activePageId: this.activePageId,
      selectedId: this.selection.at(-1) ?? null,
      selectedIds: [...this.selection],
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      hasClipboard: this.clipboard !== null,
    };
  }

  /** 切换页面只改变编辑会话的视图，不修改工程文件或撤销历史。 */
  switchPage(pageId: string): boolean {
    firstPage(this.current, pageId);
    if (this.activePageId === pageId) return false;
    this.activePageId = pageId;
    this.selection = [];
    return true;
  }

  /** 添加与当前页面尺寸一致的空白页，页面 ID 在工程内保持唯一。 */
  createPage(name?: string): string {
    if (this.current.pages.length >= 100) throw new RangeError("页面数量不能超过 100");
    const used = new Set([
      ...this.current.pages.map((page) => page.id),
      ...this.current.pages.flatMap((page) =>
        page.nodes.flatMap((node) => [node.id, ...(node.groupId ? [node.groupId] : [])]),
      ),
    ]);
    let ordinal = 1;
    while (used.has(`page-${ordinal}`)) ordinal++;
    const id = `page-${ordinal}`;
    const pageName = name ?? `新建页面 ${ordinal}`;
    if (typeof pageName !== "string" || pageName.trim().length === 0) {
      throw new TypeError("页面名称不能为空");
    }
    const size = { ...firstPage(this.current, this.activePageId).size };
    this.commit(
      parseScadaDocument({
        ...this.current,
        pages: [...this.current.pages, { id, name: pageName, size, nodes: [] }],
      }),
      id,
    );
    this.activePageId = id;
    this.selection = [];
    return id;
  }

  /** 重命名时保留页面 ID、图元、Tag 及顺序，可撤销。 */
  renamePage(pageId: string, name: string): boolean {
    firstPage(this.current, pageId);
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new TypeError("页面名称不能为空");
    }
    return this.commit(
      parseScadaDocument({
        ...this.current,
        pages: this.current.pages.map((page) =>
          page.id === pageId ? { ...page, name: name.trim() } : page,
        ),
      }),
    );
  }

  /** 至少保留一页；删除当前页后切换到相邻页，撤销可完整恢复内容。 */
  deletePage(pageId: string): boolean {
    const index = this.current.pages.findIndex((page) => page.id === pageId);
    if (index < 0) throw new RangeError("未找到页面：" + pageId);
    if (this.current.pages.length === 1) throw new TypeError("工程至少需要保留一个页面");
    const pages = this.current.pages.filter((page) => page.id !== pageId);
    const removedActive = this.activePageId === pageId;
    const nextPageId = removedActive
      ? pages[Math.min(index, pages.length - 1)]!.id
      : this.activePageId;
    this.commit(parseScadaDocument({ ...this.current, pages }), nextPageId);
    if (removedActive) {
      this.activePageId = nextPageId;
      this.selection = [];
    }
    return true;
  }

  /** 复制指定页面并紧邻源页插入；全工程 ID 重映射，保留图元布局与 Tag 绑定。 */
  duplicatePage(pageId = this.activePageId): string {
    if (this.current.pages.length >= 100) {
      throw new RangeError("页面数量不能超过 100");
    }
    const sourceIndex = this.current.pages.findIndex((page) => page.id === pageId);
    if (sourceIndex < 0) throw new RangeError("未找到页面：" + pageId);
    const source = this.current.pages[sourceIndex]!;
    const used = occupiedIds(this.current);
    const id = allocateId(used, "page");
    const copy = {
      id,
      name: source.name.slice(0, 253) + " 副本",
      size: { ...source.size },
      nodes: cloneNodes(source.nodes, used),
    };
    const pages = [...this.current.pages];
    pages.splice(sourceIndex + 1, 0, copy);
    this.commit(parseScadaDocument({ ...this.current, pages }), id);
    this.activePageId = id;
    this.selection = [];
    return id;
  }

  /** 将页面与相邻页面交换，边界移动不产生撤销历史。 */
  movePage(pageId: string, direction: "previous" | "next"): boolean {
    if (direction !== "previous" && direction !== "next") {
      throw new TypeError("页面排序方向无效");
    }
    const index = this.current.pages.findIndex((page) => page.id === pageId);
    if (index < 0) throw new RangeError("未找到页面：" + pageId);
    const nextIndex = index + (direction === "previous" ? -1 : 1);
    if (nextIndex < 0 || nextIndex >= this.current.pages.length) return false;
    const pages = [...this.current.pages];
    [pages[index], pages[nextIndex]] = [pages[nextIndex]!, pages[index]!];
    return this.commit(parseScadaDocument({ ...this.current, pages }));
  }

  /**
   * 将当前页选中图元完整复制到另一页面。
   * 若整组几何范围超过目标画布则拒绝，不自动缩放或拆散组合。
   */
  copySelectedToPage(targetPageId: string): string[] {
    if (typeof targetPageId !== "string" || targetPageId.length === 0) {
      throw new TypeError("目标页面 ID 必须为非空字符串");
    }
    const source = firstPage(this.current, this.activePageId);
    const target = firstPage(this.current, targetPageId);
    if (source.id === target.id) {
      throw new TypeError("请选择其他页面作为复制目标");
    }
    if (this.selection.length === 0) {
      throw new TypeError("请先选择需要复制的图元");
    }
    const selected = expandGroupedSelection(source.nodes, this.selection);
    const nodes = source.nodes.filter((node) => selected.has(node.id));
    if (nodes.some(studioNodeLocked)) throw new TypeError(LOCKED_NODE_MESSAGE);
    if (nodes.length === 0) throw new TypeError("请先选择需要复制的图元");

    const left = Math.min(...nodes.map((node) => node.transform.x));
    const top = Math.min(...nodes.map((node) => node.transform.y));
    const right = Math.max(...nodes.map((node) => node.transform.x + node.transform.width));
    const bottom = Math.max(...nodes.map((node) => node.transform.y + node.transform.height));
    if (right - left > target.size.width || bottom - top > target.size.height) {
      throw new RangeError("所选图元整体尺寸超过目标页面画布，无法保持布局");
    }
    const dx = left < 0 ? -left : Math.min(0, target.size.width - right);
    const dy = top < 0 ? -top : Math.min(0, target.size.height - bottom);
    const copies = cloneNodes(nodes, occupiedIds(this.current), dx, dy);
    const pages = this.current.pages.map((page) =>
      page.id === targetPageId ? { ...page, nodes: [...page.nodes, ...copies] } : page,
    );
    this.commit(parseScadaDocument({ ...this.current, pages }));
    return copies.map((node) => node.id);
  }

  /** 复制当前页所选图元与完整组合到会话剪贴板，不修改工程。 */
  copySelected(): boolean {
    const nodes = this.captureSelectedNodes();
    if (nodes.length === 0) return false;
    this.clipboard = { nodes, pasteCount: 0 };
    return true;
  }

  /** 剪切所选图元：先校验删除，再保存剪贴板；失败时原状态不变。 */
  cutSelected(): boolean {
    const nodes = this.captureSelectedNodes();
    if (nodes.length === 0) return false;
    const removed = new Set(nodes.map((node) => node.id));
    const page = firstPage(this.current, this.activePageId);
    const next = parseScadaDocument({
      ...this.current,
      pages: this.current.pages.map((item) =>
        item.id === page.id
          ? { ...item, nodes: item.nodes.filter((node) => !removed.has(node.id)) }
          : item,
      ),
    });
    if (!this.commit(next)) return false;
    this.selection = [];
    this.clipboard = { nodes, pasteCount: 0 };
    return true;
  }

  /**
   * 粘贴为当前页面中的新图元和新组合；每次成功粘贴尝试增加 20 像素偏移。
   * 为保留完整布局，只整体平移；目标画布不足时拒绝且不修改任何状态。
   */
  pasteClipboard(): string[] {
    const clipboard = this.clipboard;
    if (!clipboard) return [];
    const page = firstPage(this.current, this.activePageId);
    const nodes = clipboard.nodes;
    const left = Math.min(...nodes.map((node) => node.transform.x));
    const top = Math.min(...nodes.map((node) => node.transform.y));
    const right = Math.max(...nodes.map((node) => node.transform.x + node.transform.width));
    const bottom = Math.max(...nodes.map((node) => node.transform.y + node.transform.height));
    if (right - left > page.size.width || bottom - top > page.size.height) {
      throw new RangeError("剪贴板图元整体尺寸超过当前页面画布，无法保持布局");
    }
    const offset = (clipboard.pasteCount + 1) * 20;
    const dx = Math.max(-left, Math.min(offset, page.size.width - right));
    const dy = Math.max(-top, Math.min(offset, page.size.height - bottom));
    const copies = cloneNodes(nodes, occupiedIds(this.current), dx, dy);
    const next = parseScadaDocument({
      ...this.current,
      pages: this.current.pages.map((item) =>
        item.id === page.id ? { ...item, nodes: [...item.nodes, ...copies] } : item,
      ),
    });
    if (!this.commit(next)) return [];
    clipboard.pasteCount++;
    this.selection = copies.map((node) => node.id);
    return [...this.selection];
  }

  /** 点击组合成员时自动选中整个组合，Shift 再次点击则整体切换。 */
  select(nodeId: string | null, additive = false): void {
    if (nodeId === null) {
      this.selection = [];
      return;
    }
    const nodes = firstPage(this.current, this.activePageId).nodes;
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) throw new RangeError(`未找到图元：${nodeId}`);
    const ids = node.groupId
      ? nodes.filter((item) => item.groupId === node.groupId).map((item) => item.id)
      : [nodeId];
    if (additive && ids.every((id) => this.selection.includes(id))) {
      const removed = new Set(ids);
      this.selection = this.selection.filter((id) => !removed.has(id));
      return;
    }
    const next = additive ? this.selection.filter((id) => !ids.includes(id)) : [];
    // 保留点击成员作为最后选中的主选图元。
    this.selection = [...next, ...ids.filter((id) => id !== nodeId), nodeId];
  }

  /** 框选与全选自动展开组合成员，选中状态不写入工程文档。 */
  selectMany(nodeIds: readonly string[], additive = false): void {
    const nodes = firstPage(this.current, this.activePageId).nodes;
    const uniqueInput = [...new Set(nodeIds)];
    const expanded = expandGroupedSelection(nodes, uniqueInput);
    const unique = [
      ...uniqueInput,
      ...nodes.filter((node) => expanded.has(node.id)).map((node) => node.id),
    ];
    const next = additive ? [...this.selection, ...unique] : unique;
    this.selection = [...new Set(next)];
  }

  /** 将两个以上未组合图元绑定为一个可持久化的平面组合。 */
  groupSelected(): string {
    if (this.selection.length < 2) throw new TypeError("请至少选择两个图元后组合");
    const page = firstPage(this.current, this.activePageId);
    const selected = new Set(this.selection);
    const nodes = page.nodes.filter((node) => selected.has(node.id));
    if (nodes.length !== selected.size) throw new RangeError("所选图元不存在");
    if (nodes.some(studioNodeLocked)) throw new TypeError(LOCKED_NODE_MESSAGE);
    if (nodes.some((node) => node.groupId !== undefined)) {
      throw new TypeError("所选图元已有组合，请先解组再重新组合");
    }
    const used = new Set([
      ...this.current.pages.map((item) => item.id),
      ...this.current.pages.flatMap((item) =>
        item.nodes.flatMap((node) => [
          node.id,
          ...(node.groupId === undefined ? [] : [node.groupId]),
        ]),
      ),
    ]);
    let index = 1;
    while (used.has(`group-${index}`)) index++;
    const groupId = `group-${index}`;
    const next = page.nodes.map((node) => (selected.has(node.id) ? { ...node, groupId } : node));
    this.replaceActivePageNodes(next);
    return groupId;
  }

  /** 将所选组合全部解散，保留原图元和 Tag 绑定。 */
  ungroupSelected(): boolean {
    const groups = new Set(
      firstPage(this.current, this.activePageId)
        .nodes.filter((node) => this.selection.includes(node.id) && node.groupId !== undefined)
        .map((node) => node.groupId),
    );
    if (groups.size === 0) return false;
    const chosen = firstPage(this.current, this.activePageId).nodes.filter(
      (node) => node.groupId !== undefined && groups.has(node.groupId),
    );
    if (chosen.some(studioNodeLocked)) throw new TypeError(LOCKED_NODE_MESSAGE);
    const nodes = firstPage(this.current, this.activePageId).nodes.map((node) => {
      if (!node.groupId || !groups.has(node.groupId)) return node;
      const copy = { ...node };
      delete copy.groupId;
      return copy;
    });
    return this.replaceActivePageNodes(nodes);
  }

  /** 兼容旧版绝对移动接口；多选时按同一受限位移整体移动。 */
  moveSelected(x: number, y: number): boolean {
    const anchor = this.getSelected();
    if (!anchor) return false;
    finite(x, "图元 X 坐标");
    finite(y, "图元 Y 坐标");
    return this.moveBy(x - anchor.transform.x, y - anchor.transform.y);
  }

  moveBy(dx: number, dy: number): boolean {
    if (this.selection.length === 0) return false;
    return this.commit(
      withNodesTranslated(this.current, this.selection, dx, dy, this.activePageId),
    );
  }

  addNode(type: EditableSymbol, x = 40, y = 40): string {
    if (!Object.hasOwn(DEFAULT_SYMBOLS, type)) throw new TypeError("不支持的图元类型");
    finite(x, "图元 X 坐标");
    finite(y, "图元 Y 坐标");
    const page = firstPage(this.current, this.activePageId);
    const existing = new Set([
      ...this.current.pages.map((candidate) => candidate.id),
      ...this.current.pages.flatMap((candidate) => candidate.nodes.map((node) => node.id)),
    ]);
    let ordinal = 1;
    while (existing.has(`${type}-${ordinal}`)) ordinal++;
    const id = `${type}-${ordinal}`;
    const size = DEFAULT_SYMBOLS[type];
    const node: ScadaNode = {
      id,
      type: type as ScadaNodeType,
      symbolVersion: "1",
      transform: {
        x: clamp(x, page.size.width - size.width),
        y: clamp(y, page.size.height - size.height),
        width: size.width,
        height: size.height,
        rotation: 0,
      },
      props: type === "label" ? { text: "新建文本" } : {},
      bindings: {},
      rules: [],
    };
    const next = parseScadaDocument({
      ...this.current,
      pages: this.current.pages.map((candidate) =>
        candidate.id === page.id ? { ...candidate, nodes: [...candidate.nodes, node] } : candidate,
      ),
    });
    this.commit(next);
    this.selection = [id];
    return id;
  }

  deleteSelected(): boolean {
    if (this.selection.length === 0) return false;
    const page = firstPage(this.current, this.activePageId);
    const selected = new Set(this.selection);
    const next = parseScadaDocument({
      ...this.current,
      pages: this.current.pages.map((candidate) =>
        candidate.id === page.id
          ? { ...candidate, nodes: candidate.nodes.filter((node) => !selected.has(node.id)) }
          : candidate,
      ),
    });
    const changed = this.commit(next);
    if (changed) this.selection = [];
    return changed;
  }

  /** 以最后选中的图元为基准对齐，每次位置修改记录为一条命令。 */
  alignSelected(alignment: Alignment): boolean {
    const page = firstPage(this.current, this.activePageId);
    const selected = new Set(this.selection);
    const anchor = this.getSelected();
    if (!anchor || selected.size < 2) return false;
    if (page.nodes.some((node) => selected.has(node.id) && studioNodeLocked(node))) {
      throw new TypeError(LOCKED_NODE_MESSAGE);
    }
    if (page.nodes.some((node) => selected.has(node.id) && node.groupId)) {
      throw new TypeError("已组合图元不能逐个对齐，请先解组");
    }
    if (!["left", "right", "hcenter", "top", "bottom", "vcenter"].includes(alignment)) {
      throw new TypeError("不支持的对齐方式");
    }
    const a = anchor.transform;
    const nodes = page.nodes.map((node) => {
      if (!selected.has(node.id) || node.id === anchor.id) return node;
      const t = node.transform;
      let x = t.x;
      let y = t.y;
      switch (alignment) {
        case "left":
          x = a.x;
          break;
        case "right":
          x = a.x + a.width - t.width;
          break;
        case "hcenter":
          x = a.x + (a.width - t.width) / 2;
          break;
        case "top":
          y = a.y;
          break;
        case "bottom":
          y = a.y + a.height - t.height;
          break;
        case "vcenter":
          y = a.y + (a.height - t.height) / 2;
          break;
      }
      return {
        ...node,
        transform: {
          ...t,
          x: clamp(x, page.size.width - t.width),
          y: clamp(y, page.size.height - t.height),
        },
      };
    });
    return this.replaceActivePageNodes(nodes);
  }

  /**
   * 以指定图元或组合为锚点精确插入层级。
   * 组合中的任一成员被拖动时，整组成员按原有相对顺序连续移动。
   */
  moveLayer(nodeId: string, targetId: string, position: "before" | "after"): boolean {
    if (position !== "before" && position !== "after") {
      throw new TypeError("图层插入方向必须为 before 或 after");
    }
    const page = firstPage(this.current, this.activePageId);
    const source = page.nodes.find((node) => node.id === nodeId);
    const target = page.nodes.find((node) => node.id === targetId);
    if (!source) throw new RangeError("未找到待移动图元：" + nodeId);
    if (!target) throw new RangeError("未找到目标图元：" + targetId);

    const movingIds = new Set(
      page.nodes
        .filter((node) =>
          source.groupId ? node.groupId === source.groupId : node.id === source.id,
        )
        .map((node) => node.id),
    );
    const targetIds = new Set(
      page.nodes
        .filter((node) =>
          target.groupId ? node.groupId === target.groupId : node.id === target.id,
        )
        .map((node) => node.id),
    );
    if (movingIds.has(target.id)) return false;
    const picked = page.nodes.filter((node) => movingIds.has(node.id));
    if (picked.some(studioNodeLocked)) throw new TypeError(LOCKED_NODE_MESSAGE);

    const others = page.nodes.filter((node) => !movingIds.has(node.id));
    const targetIndices = others.flatMap((node, index) => (targetIds.has(node.id) ? [index] : []));
    const insertion =
      position === "before" ? Math.min(...targetIndices) : Math.max(...targetIndices) + 1;
    const next = [...others.slice(0, insertion), ...picked, ...others.slice(insertion)];

    assertLockedLayerIndices(page.nodes, next);
    return this.replaceActivePageNodes(next);
  }

  /** 页面节点顺序即 SVG 绘制顺序，后面的图元显示在前面。 */
  reorderSelected(action: LayerAction): boolean {
    if (!["front", "back", "forward", "backward"].includes(action)) {
      throw new TypeError("不支持的图层操作");
    }
    if (this.selection.length === 0) return false;
    const nodes = [...firstPage(this.current, this.activePageId).nodes];
    if (nodes.some((node) => this.selection.includes(node.id) && studioNodeLocked(node))) {
      throw new TypeError(LOCKED_NODE_MESSAGE);
    }
    const applyOrder = (next: ScadaNode[]): boolean => {
      assertLockedLayerIndices(nodes, next);
      return this.replaceActivePageNodes(next);
    };
    const selected = new Set(this.selection);
    const chosen = nodes.filter((node) => selected.has(node.id));
    const groupId = chosen[0]?.groupId;
    if (groupId && chosen.length > 1 && chosen.every((node) => node.groupId === groupId)) {
      const source = chosen[0]!;
      const otherNodes = nodes.filter((node) => node.groupId !== groupId);
      if (otherNodes.length === 0) return false;
      const first = nodes.findIndex((node) => node.groupId === groupId);
      const last = nodes.map((node) => node.groupId).lastIndexOf(groupId);
      const destination =
        action === "front"
          ? otherNodes.at(-1)
          : action === "back"
            ? otherNodes[0]
            : action === "forward"
              ? nodes.slice(last + 1).find((node) => node.groupId !== groupId)
              : nodes
                  .slice(0, first)
                  .reverse()
                  .find((node) => node.groupId !== groupId);
      if (!destination) return false;
      return this.moveLayer(
        source.id,
        destination.id,
        action === "front" || action === "forward" ? "after" : "before",
      );
    }
    if (action === "front" || action === "back") {
      const picked = nodes.filter((node) => selected.has(node.id));
      const others = nodes.filter((node) => !selected.has(node.id));
      return applyOrder(action === "front" ? [...others, ...picked] : [...picked, ...others]);
    }
    if (action === "forward") {
      for (let i = nodes.length - 2; i >= 0; i--) {
        if (selected.has(nodes[i]!.id) && !selected.has(nodes[i + 1]!.id)) {
          [nodes[i], nodes[i + 1]] = [nodes[i + 1]!, nodes[i]!];
        }
      }
    } else {
      for (let i = 1; i < nodes.length; i++) {
        if (selected.has(nodes[i]!.id) && !selected.has(nodes[i - 1]!.id)) {
          [nodes[i - 1], nodes[i]] = [nodes[i]!, nodes[i - 1]!];
        }
      }
    }
    return applyOrder(nodes);
  }

  /** 仅允许单选图元修改几何属性，一次应用只产生一条撤销记录。 */
  updateSelectedTransform(patch: NodeTransformPatch): boolean {
    if (this.selection.length !== 1) {
      throw new TypeError("请先单选一个图元再编辑几何属性");
    }
    return this.commit(
      withNodeTransform(this.current, this.selection[0]!, patch, this.activePageId),
    );
  }

  /** 批量锁定或解锁所选图元：每次提交为一条可撤销命令。 */
  setSelectedLocked(locked: boolean): boolean {
    if (typeof locked !== "boolean") throw new TypeError("图元锁定状态必须为布尔值");
    if (this.selection.length === 0) return false;
    const selected = new Set(this.selection);
    const page = firstPage(this.current, this.activePageId);
    const changed = page.nodes.some(
      (node) => selected.has(node.id) && studioNodeLocked(node) !== locked,
    );
    if (!changed) return false;
    const nodes = page.nodes.map((node) =>
      selected.has(node.id) ? withStudioState(node, "locked", locked) : node,
    );
    return this.replaceActivePageNodes(nodes, true);
  }

  /** 隐藏图元不会删除 Tag/规则；锁定中的图元须先解锁才能修改显示状态。 */
  setSelectedVisible(visible: boolean): boolean {
    if (typeof visible !== "boolean") throw new TypeError("图元可见状态必须为布尔值");
    if (this.selection.length === 0) return false;
    const selected = new Set(this.selection);
    const page = firstPage(this.current, this.activePageId);
    const chosen = page.nodes.filter((node) => selected.has(node.id));
    if (chosen.some(studioNodeLocked)) throw new TypeError(LOCKED_NODE_MESSAGE);
    if (chosen.every((node) => studioNodeVisible(node) === visible)) return false;
    const nodes = page.nodes.map((node) =>
      selected.has(node.id) ? withStudioState(node, "visible", visible) : node,
    );
    return this.replaceActivePageNodes(nodes);
  }

  /** 单选图元的 Tag 绑定修改记录为一条可撤销命令。 */
  setSelectedBinding(slot: string, tagId: string | null): boolean {
    const node = this.getSelected();
    if (!node) throw new TypeError("请先单选一个图元再修改 Tag 绑定");
    if (node.groupId) throw new TypeError("已组合图元不能单独修改 Tag 绑定，请先解组");
    if (this.selection.length !== 1) {
      throw new TypeError("请先单选一个图元再修改 Tag 绑定");
    }
    if (editableTagSlot(node.type) !== slot) {
      throw new TypeError("该图元不支持指定的 Tag 绑定槽");
    }
    if (tagId !== null && typeof tagId !== "string") {
      throw new TypeError("Tag ID 必须为字符串或 null");
    }
    if ((node.bindings[slot]?.tagId ?? null) === tagId) return false;

    const bindings = { ...node.bindings };
    if (tagId === null) delete bindings[slot];
    else bindings[slot] = { tagId };

    const nodes = firstPage(this.current, this.activePageId).nodes.map((item) =>
      item.id === node.id ? { ...item, bindings } : item,
    );
    return this.replaceActivePageNodes(nodes);
  }

  setSelectedLabel(text: string): boolean {
    if (typeof text !== "string" || text.length > 256) {
      throw new TypeError("文本内容不能超过 256 个字符");
    }
    const node = this.selection.length === 1 ? this.getSelected() : undefined;
    if (!node || node.type !== "label") throw new TypeError("请先选择文本图元");
    if (node.props.text === text) return false;
    const nodes = firstPage(this.current, this.activePageId).nodes.map((item) =>
      item.id === node.id ? { ...item, props: { ...item.props, text } } : item,
    );
    return this.replaceActivePageNodes(nodes);
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push({
      document: this.current,
      pageId: previous.redoPageId,
      redoPageId: previous.pageId,
    });
    this.current = previous.document;
    this.activePageId = previous.pageId;
    this.reconcileSelection();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push({
      document: this.current,
      pageId: next.redoPageId,
      redoPageId: next.pageId,
    });
    this.current = next.document;
    this.activePageId = next.pageId;
    this.reconcileSelection();
    return true;
  }

  /** 显式迁移历史 JSON，成功后重置编辑历史；失败时保留全部原有状态。 */
  loadDocument(source: unknown): string | null {
    const { document, migratedFrom } = migrateScadaDocument(source);
    this.current = document;
    this.activePageId = firstPage(document).id;
    this.selection = [];
    this.clipboard = null;
    this.past.length = 0;
    this.future.length = 0;
    return migratedFrom;
  }

  /** 从严格校验的工程副本取得选中内容，避免后续编辑影响剪贴板。 */
  private captureSelectedNodes(): ScadaNode[] {
    if (this.selection.length === 0) return [];
    const selected = expandGroupedSelection(
      firstPage(this.current, this.activePageId).nodes,
      this.selection,
    );
    const document = parseScadaDocument(this.current);
    const nodes = firstPage(document, this.activePageId).nodes.filter((node) =>
      selected.has(node.id),
    );
    if (nodes.some(studioNodeLocked)) throw new TypeError(LOCKED_NODE_MESSAGE);
    return nodes;
  }

  private getSelected(): ScadaNode | undefined {
    const id = this.selection.at(-1);
    return firstPage(this.current, this.activePageId).nodes.find((node) => node.id === id);
  }

  private replaceActivePageNodes(nodes: ScadaNode[], allowLockStateChange = false): boolean {
    const page = firstPage(this.current, this.activePageId);
    return this.commit(
      parseScadaDocument({
        ...this.current,
        pages: this.current.pages.map((candidate) =>
          candidate.id === page.id ? { ...candidate, nodes } : candidate,
        ),
      }),
      this.activePageId,
      allowLockStateChange,
    );
  }

  private commit(
    next: ScadaDocument,
    redoPageId = this.activePageId,
    allowLockStateChange = false,
  ): boolean {
    if (equalDocuments(this.current, next)) return false;
    for (const page of this.current.pages) {
      const nextPage = next.pages.find((item) => item.id === page.id);
      for (const node of page.nodes) {
        if (!studioNodeLocked(node)) continue;
        const nextNode = nextPage?.nodes.find((item) => item.id === node.id);
        if (
          !nextNode ||
          (allowLockStateChange
            ? withoutLockState(nextNode) !== withoutLockState(node)
            : JSON.stringify(nextNode) !== JSON.stringify(node))
        ) {
          throw new TypeError(LOCKED_NODE_MESSAGE);
        }
      }
    }
    this.past.push({ document: this.current, pageId: this.activePageId, redoPageId });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.current = next;
    this.future.length = 0;
    return true;
  }

  private reconcileSelection(): void {
    const page = this.current.pages.find((item) => item.id === this.activePageId);
    if (!page) this.activePageId = firstPage(this.current).id;
    const valid = new Set(firstPage(this.current, this.activePageId).nodes.map((node) => node.id));
    this.selectMany(this.selection.filter((id) => valid.has(id)));
  }
}

export {
  RESIZE_HANDLES,
  RESIZE_HANDLE_LABELS,
  resizeHandlePosition,
  resolveResizeTransform,
  resolveRotationTransform,
} from "./transform-gesture.ts";
export type { ResizeHandle } from "./transform-gesture.ts";

export { DEFAULT_GRID_SIZE, resolveDragSnap } from "./snap.ts";
export type { DragSnapOptions, DragSnapResult } from "./snap.ts";
