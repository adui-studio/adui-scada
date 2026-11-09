import { parseScadaDocument } from "./document.ts";
import type { ScadaDocument, ScadaNode } from "./document.ts";

export interface EditorSnapshot {
  readonly document: ScadaDocument;
  readonly selectedId: string | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

const HISTORY_LIMIT = 100;

function firstPage(document: ScadaDocument) {
  const page = document.pages[0];
  if (!page) throw new RangeError("Document has no pages");
  return page;
}

/**
 * Immutable, validated node movement shared by Studio UIs.
 * Canvas coordinates are rounded and clamped to the page bounds.
 */
export function withNodePosition(
  document: ScadaDocument,
  nodeId: string,
  x: number,
  y: number,
): ScadaDocument {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError("Node position must be finite");
  }
  const checked = parseScadaDocument(document);
  const page = firstPage(checked);
  const selected = page.nodes.find((node) => node.id === nodeId);
  if (!selected) throw new RangeError(`Unknown node: ${nodeId}`);
  const nextX = Math.round(
    Math.min(Math.max(x, 0), Math.max(0, page.size.width - selected.transform.width)),
  );
  const nextY = Math.round(
    Math.min(Math.max(y, 0), Math.max(0, page.size.height - selected.transform.height)),
  );
  return parseScadaDocument({
    ...checked,
    pages: checked.pages.map((candidate) =>
      candidate.id !== page.id
        ? candidate
        : {
            ...candidate,
            nodes: candidate.nodes.map((node) =>
              node.id !== nodeId
                ? node
                : { ...node, transform: { ...node.transform, x: nextX, y: nextY } },
            ),
          },
    ),
  });
}

/** Framework-independent V0.2 editor: selection, reversible commands and JSON reloading. */
export class DocumentEditor {
  private current: ScadaDocument;
  private selectedId: string | null = null;
  private readonly past: ScadaDocument[] = [];
  private readonly future: ScadaDocument[] = [];

  constructor(source: unknown) {
    this.current = parseScadaDocument(source);
  }

  snapshot(): EditorSnapshot {
    return {
      document: parseScadaDocument(this.current),
      selectedId: this.selectedId,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
    };
  }

  select(nodeId: string | null): void {
    if (nodeId !== null && !firstPage(this.current).nodes.some((node) => node.id === nodeId)) {
      throw new RangeError(`Unknown node: ${nodeId}`);
    }
    this.selectedId = nodeId;
  }

  moveSelected(x: number, y: number): boolean {
    if (this.selectedId === null) return false;
    const node = this.getSelected();
    if (!node) return false;
    const next = withNodePosition(this.current, node.id, x, y);
    const nextNode = firstPage(next).nodes.find((item) => item.id === node.id);
    if (
      !nextNode ||
      (nextNode.transform.x === node.transform.x && nextNode.transform.y === node.transform.y)
    ) {
      return false;
    }
    this.commit(next);
    return true;
  }

  setSelectedLabel(text: string): boolean {
    if (typeof text !== "string" || text.length > 256) {
      throw new TypeError("Label text must be at most 256 characters");
    }
    const node = this.getSelected();
    if (!node || node.type !== "label") throw new TypeError("Select a label node");
    if (node.props.text === text) return false;

    const page = firstPage(this.current);
    const next = parseScadaDocument({
      ...this.current,
      pages: this.current.pages.map((candidate) =>
        candidate.id !== page.id
          ? candidate
          : {
              ...candidate,
              nodes: candidate.nodes.map((item) =>
                item.id === node.id ? { ...item, props: { ...item.props, text } } : item,
              ),
            },
      ),
    });
    this.commit(next);
    return true;
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(this.current);
    this.current = previous;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.current);
    this.current = next;
    return true;
  }

  /** Import is an explicit new session; invalid input leaves the current document unchanged. */
  loadDocument(source: unknown): void {
    const next = parseScadaDocument(source);
    this.current = next;
    this.selectedId = null;
    this.past.length = 0;
    this.future.length = 0;
  }

  private getSelected(): ScadaNode | undefined {
    return firstPage(this.current).nodes.find((node) => node.id === this.selectedId);
  }

  private commit(next: ScadaDocument): void {
    this.past.push(this.current);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.current = next;
    this.future.length = 0;
  }
}
