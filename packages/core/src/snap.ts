import { parseScadaDocument } from "./document.ts";
import type { ScadaDocument, ScadaNode } from "./document.ts";
import { expandGroupedSelection } from "./grouping.ts";

/** 画布网格默认间距：20 个工程坐标单位。 */
export const DEFAULT_GRID_SIZE = 20;

export interface DragSnapOptions {
  readonly gridEnabled: boolean;
  readonly nodeEnabled: boolean;
  readonly gridSize?: number;
  readonly tolerance?: number;
}

export interface DragSnapResult {
  readonly dx: number;
  readonly dy: number;
  readonly verticalGuide: number | null;
  readonly horizontalGuide: number | null;
}

interface Bounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface AxisSnap {
  readonly delta: number;
  readonly guide: number | null;
}

/** 计算旋转图元的轴对齐外接框，不修改原始旋转和位置。 */
function nodeBounds(node: ScadaNode): Bounds {
  const t = node.transform;
  const angle = (t.rotation * Math.PI) / 180;
  const halfWidth =
    (Math.abs(Math.cos(angle)) * t.width + Math.abs(Math.sin(angle)) * t.height) / 2;
  const halfHeight =
    (Math.abs(Math.sin(angle)) * t.width + Math.abs(Math.cos(angle)) * t.height) / 2;
  const cx = t.x + t.width / 2;
  const cy = t.y + t.height / 2;
  return {
    left: cx - halfWidth,
    right: cx + halfWidth,
    top: cy - halfHeight,
    bottom: cy + halfHeight,
  };
}

function positions(bounds: Bounds, axis: "x" | "y"): number[] {
  const min = axis === "x" ? bounds.left : bounds.top;
  const max = axis === "x" ? bounds.right : bounds.bottom;
  return [min, (min + max) / 2, max];
}

function limit(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/** 先取整再按精确边界截断，避免小数边界再次取整导致预览与提交不一致。 */
function normalizeMove(value: number, min: number, max: number): number {
  return limit(Math.round(value), min, max);
}

/**
 * 选择改变量最小的可行吸附位置；距离相同时优先显示图元辅助线。
 * 计算结果属于编辑视图，不能写入工程 Schema。
 */
function snapAxis(
  source: number[],
  targets: number[],
  rawDelta: number,
  min: number,
  max: number,
  options: Required<DragSnapOptions>,
): AxisSnap {
  const raw = normalizeMove(rawDelta, min, max);
  const result: {
    best: { delta: number; gap: number; guide: number | null; priority: number } | null;
  } = { best: null };

  if (Math.abs(rawDelta) < 0.5) return { delta: raw, guide: null };

  function offer(position: number, target: number, nodeGuide: boolean): void {
    const delta = normalizeMove(target - position, min, max);
    const gap = Math.abs(delta - raw);
    if (gap > options.tolerance || Math.abs(position + delta - target) > 0.51) return;
    const priority = nodeGuide ? 0 : 1;
    if (
      result.best === null ||
      gap < result.best.gap ||
      (gap === result.best.gap && priority < result.best.priority)
    ) {
      result.best = { delta, gap, guide: nodeGuide ? target : null, priority };
    }
  }

  if (options.nodeEnabled) {
    for (const current of source) {
      for (const target of targets) offer(current, target, true);
    }
  }
  if (options.gridEnabled) {
    for (const current of source) {
      const gridTarget = Math.round((current + raw) / options.gridSize) * options.gridSize;
      offer(current, gridTarget, false);
    }
  }

  const chosen = result.best;
  if (chosen === null) return { delta: raw, guide: null };
  return { delta: chosen.delta, guide: chosen.guide };
}

/**
 * 根据指定页面中的非选中图元和画布网格，计算整组图元的预览位移。
 * 拖动预览与松开提交都应使用本函数；不会产生撤销历史或改变 Tag 绑定。
 */
export function resolveDragSnap(
  document: ScadaDocument,
  selectedIds: readonly string[],
  dx: number,
  dy: number,
  options: DragSnapOptions,
  pageId?: string,
): DragSnapResult {
  if (
    !options ||
    typeof options.gridEnabled !== "boolean" ||
    typeof options.nodeEnabled !== "boolean"
  ) {
    throw new TypeError("网格吸附和图元吸附开关必须为布尔值");
  }
  if (![dx, dy].every(Number.isFinite)) throw new TypeError("拖动位移必须是有限数");
  const gridSize = options.gridSize ?? DEFAULT_GRID_SIZE;
  const tolerance = options.tolerance ?? 6;
  if (!Number.isInteger(gridSize) || gridSize < 1 || gridSize > 1024) {
    throw new RangeError("网格间距必须是 1～1024 之间的整数");
  }
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 32) {
    throw new RangeError("吸附距离必须是 0～32 之间的有限数");
  }

  const pages = parseScadaDocument(document).pages;
  const page = pageId === undefined ? pages[0] : pages.find((item) => item.id === pageId);
  if (!page) throw new RangeError(pageId === undefined ? "工程文档不包含页面" : "未找到页面：" + pageId);
  const selected = expandGroupedSelection(page.nodes, selectedIds);
  const moving = page.nodes.filter((node) => selected.has(node.id));
  if (moving.length === 0) {
    return { dx: 0, dy: 0, verticalGuide: null, horizontalGuide: null };
  }

  // 与 withNodesTranslated 使用同一非旋转画布边界，保持预览与提交一致。
  const minX = Math.max(...moving.map((node) => -node.transform.x));
  const maxX = Math.min(
    ...moving.map((node) => page.size.width - node.transform.width - node.transform.x),
  );
  const minY = Math.max(...moving.map((node) => -node.transform.y));
  const maxY = Math.min(
    ...moving.map((node) => page.size.height - node.transform.height - node.transform.y),
  );
  if (minX > maxX || minY > maxY) throw new RangeError("所选图元无法完整放入当前页面");

  const bounds = moving.map(nodeBounds);
  const group: Bounds = {
    left: Math.min(...bounds.map((item) => item.left)),
    right: Math.max(...bounds.map((item) => item.right)),
    top: Math.min(...bounds.map((item) => item.top)),
    bottom: Math.max(...bounds.map((item) => item.bottom)),
  };
  const others = page.nodes.filter((node) => !selected.has(node.id)).map(nodeBounds);
  const config: Required<DragSnapOptions> = {
    gridEnabled: options.gridEnabled,
    nodeEnabled: options.nodeEnabled,
    gridSize,
    tolerance,
  };

  const x = snapAxis(
    positions(group, "x"),
    others.flatMap((item) => positions(item, "x")),
    dx,
    minX,
    maxX,
    config,
  );
  const y = snapAxis(
    positions(group, "y"),
    others.flatMap((item) => positions(item, "y")),
    dy,
    minY,
    maxY,
    config,
  );

  return {
    dx: x.delta,
    dy: y.delta,
    verticalGuide: x.guide,
    horizontalGuide: y.guide,
  };
}
