import { parseScadaDocument } from "./document.ts";
import type { ScadaDocument, ScadaNode, ScadaNodeType } from "./document.ts";

export interface EditorSnapshot {
  readonly document: ScadaDocument;
  readonly selectedId: string | null;
  readonly selectedIds: readonly string[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export type Alignment = "left" | "right" | "hcenter" | "top" | "bottom" | "vcenter";
export type LayerAction = "front" | "back" | "forward" | "backward";
export type EditableSymbol = "tank" | "pump" | "pipe" | "label";

const HISTORY_LIMIT = 100;

const DEFAULT_SYMBOLS: Record<EditableSymbol, { width: number; height: number }> = {
  tank: { width: 140, height: 160 },
  pump: { width: 110, height: 110 },
  pipe: { width: 200, height: 24 },
  label: { width: 200, height: 32 },
};

function firstPage(document: ScadaDocument) {
  const page = document.pages[0];
  if (!page) throw new RangeError("工程文档不包含页面");
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
): ScadaDocument {
  finite(dx, "水平位移");
  finite(dy, "垂直位移");
  const checked = parseScadaDocument(document);
  const page = firstPage(checked);
  const selected = new Set(nodeIds);
  if (selected.size !== nodeIds.length) throw new TypeError("选择中包含重复图元");
  const nodes = page.nodes.filter((node) => selected.has(node.id));
  if (nodes.length !== selected.size) throw new RangeError("所选图元不存在");
  if (nodes.length === 0) return checked;

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
  // 原始坐标包含小数时，可行位移区间内可能没有整数值。
  // 将取整后的位移限制在精确可行区间内，避免图元越出画布。
  const shiftX = Math.max(minDx, Math.min(Math.round(dx), maxDx));
  const shiftY = Math.max(minDy, Math.min(Math.round(dy), maxDy));

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
 * 返回第一页中与拖动选框相交的图元 ID。
 * 旋转图元采用保守的轴对齐外接矩形进行命中计算。
 * 选择状态和画布缩放由调用方管理，不写入工程 JSON。
 */
export function findNodesInRect(
  document: ScadaDocument,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): string[] {
  for (const coordinate of [startX, startY, endX, endY]) finite(coordinate, "框选坐标");
  const left = Math.min(startX, endX);
  const right = Math.max(startX, endX);
  const top = Math.min(startY, endY);
  const bottom = Math.max(startY, endY);
  if (right === left || bottom === top) return [];
  const page = firstPage(parseScadaDocument(document));

  return page.nodes
    .filter((node) => {
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
): ScadaDocument {
  finite(x, "图元 X 坐标");
  finite(y, "图元 Y 坐标");
  const page = firstPage(document);
  const node = page.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new RangeError(`未找到图元：${nodeId}`);
  return withNodesTranslated(document, [nodeId], x - node.transform.x, y - node.transform.y);
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
  private selection: string[] = [];
  private readonly past: ScadaDocument[] = [];
  private readonly future: ScadaDocument[] = [];

  constructor(source: unknown) {
    this.current = parseScadaDocument(source);
  }

  snapshot(): EditorSnapshot {
    return {
      document: parseScadaDocument(this.current),
      selectedId: this.selection.at(-1) ?? null,
      selectedIds: [...this.selection],
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
    };
  }

  /** 按住 Shift 点击可追加选择，最后选中的图元为对齐基准。 */
  select(nodeId: string | null, additive = false): void {
    if (nodeId === null) {
      this.selection = [];
      return;
    }
    if (!firstPage(this.current).nodes.some((node) => node.id === nodeId)) {
      throw new RangeError(`未找到图元：${nodeId}`);
    }
    if (!additive) {
      this.selection = [nodeId];
    } else if (this.selection.includes(nodeId)) {
      this.selection = this.selection.filter((id) => id !== nodeId);
    } else {
      this.selection = [...this.selection, nodeId];
    }
  }

  /** 原子替换或追加所选图元；批量选择顺序遵循传入的图元顺序。 */
  selectMany(nodeIds: readonly string[], additive = false): void {
    const valid = new Set(firstPage(this.current).nodes.map((node) => node.id));
    if (nodeIds.some((id) => !valid.has(id))) {
      throw new RangeError("所选图元不存在");
    }
    const unique = [...new Set(nodeIds)];
    this.selection = additive
      ? [...this.selection, ...unique.filter((id) => !this.selection.includes(id))]
      : unique;
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
    return this.commit(withNodesTranslated(this.current, this.selection, dx, dy));
  }

  addNode(type: EditableSymbol, x = 40, y = 40): string {
    if (!Object.hasOwn(DEFAULT_SYMBOLS, type)) throw new TypeError("不支持的图元类型");
    finite(x, "图元 X 坐标");
    finite(y, "图元 Y 坐标");
    const page = firstPage(this.current);
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
    const page = firstPage(this.current);
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
    const page = firstPage(this.current);
    const selected = new Set(this.selection);
    const anchor = this.getSelected();
    if (!anchor || selected.size < 2) return false;
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
    return this.replaceFirstPageNodes(nodes);
  }

  /** 页面节点顺序即 SVG 绘制顺序，后面的图元显示在前面。 */
  reorderSelected(action: LayerAction): boolean {
    if (!["front", "back", "forward", "backward"].includes(action)) {
      throw new TypeError("不支持的图层操作");
    }
    if (this.selection.length === 0) return false;
    const nodes = [...firstPage(this.current).nodes];
    const selected = new Set(this.selection);
    if (action === "front" || action === "back") {
      const picked = nodes.filter((node) => selected.has(node.id));
      const others = nodes.filter((node) => !selected.has(node.id));
      return this.replaceFirstPageNodes(
        action === "front" ? [...others, ...picked] : [...picked, ...others],
      );
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
    return this.replaceFirstPageNodes(nodes);
  }

  setSelectedLabel(text: string): boolean {
    if (typeof text !== "string" || text.length > 256) {
      throw new TypeError("文本内容不能超过 256 个字符");
    }
    const node = this.getSelected();
    if (!node || node.type !== "label") throw new TypeError("请先选择文本图元");
    if (node.props.text === text) return false;
    const nodes = firstPage(this.current).nodes.map((item) =>
      item.id === node.id ? { ...item, props: { ...item.props, text } } : item,
    );
    return this.replaceFirstPageNodes(nodes);
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(this.current);
    this.current = previous;
    this.reconcileSelection();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.current);
    this.current = next;
    this.reconcileSelection();
    return true;
  }

  /** 工程导入具备原子性；成功导入后重新开始编辑历史。 */
  loadDocument(source: unknown): void {
    const next = parseScadaDocument(source);
    this.current = next;
    this.selection = [];
    this.past.length = 0;
    this.future.length = 0;
  }

  private getSelected(): ScadaNode | undefined {
    const id = this.selection.at(-1);
    return firstPage(this.current).nodes.find((node) => node.id === id);
  }

  private replaceFirstPageNodes(nodes: ScadaNode[]): boolean {
    const page = firstPage(this.current);
    return this.commit(
      parseScadaDocument({
        ...this.current,
        pages: this.current.pages.map((candidate) =>
          candidate.id === page.id ? { ...candidate, nodes } : candidate,
        ),
      }),
    );
  }

  private commit(next: ScadaDocument): boolean {
    if (equalDocuments(this.current, next)) return false;
    this.past.push(this.current);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.current = next;
    this.future.length = 0;
    return true;
  }

  private reconcileSelection(): void {
    const valid = new Set(firstPage(this.current).nodes.map((node) => node.id));
    this.selection = this.selection.filter((id) => valid.has(id));
  }
}

export { DEFAULT_GRID_SIZE, resolveDragSnap } from "./snap.ts";
export type { DragSnapOptions, DragSnapResult } from "./snap.ts";
