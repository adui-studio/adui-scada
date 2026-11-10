import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  WaterTreatmentSimulator,
  waterTreatmentDemoDocument,
  hasLocalDraft,
  saveLocalDraft,
  readLocalDraft,
  clearLocalDraft,
} from "@adui/scada-core";
import type { ScadaDocument } from "@adui/scada-core";
import {
  DEFAULT_GRID_SIZE,
  DocumentEditor,
  RESIZE_HANDLES,
  RESIZE_HANDLE_LABELS,
  resizeHandlePosition,
  findNodesInRect,
  resolveDragSnap,
  resolveResizeTransform,
  resolveRotationTransform,
  withNodeTransform,
  withNodesTranslated,
} from "@adui/scada-core/editor";
import type {
  Alignment,
  EditableSymbol,
  EditorSnapshot,
  LayerAction,
  NodeTransformPatch,
  ResizeHandle,
} from "@adui/scada-core/editor";
import { svgDataUrl } from "@adui/scada-runtime";
import "./studio.css";

const previewTags = new WaterTreatmentSimulator().next(new Date("2026-11-09T00:00:00Z"));
const maxFileSize = 2 * 1024 * 1024;
const geometryFields = [
  ["x", "X 坐标"],
  ["y", "Y 坐标"],
  ["width", "宽度"],
  ["height", "高度"],
  ["rotation", "旋转角度（度）"],
] as const;

interface MarqueeState {
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  additive: boolean;
}

interface DragState {
  pointerId: number;
  id: string;
  originX: number;
  originY: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
}

interface GeometryDragState {
  pointerId: number;
  nodeId: string;
  handle: ResizeHandle | "rotate";
  startX: number;
  startY: number;
  lastPatch: NodeTransformPatch | null;
}

export default function StudioPage() {
  const editor = useMemo(() => new DocumentEditor(waterTreatmentDemoDocument), []);
  const [state, setState] = useState<EditorSnapshot>(() => editor.snapshot());
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [geometryPreview, setGeometryPreview] = useState<ScadaDocument | null>(null);
  const [rotating, setRotating] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [notice, setNotice] = useState("可手动保存浏览器本地草稿 · 尚未连接工程保存服务");
  const [hasSavedDraft, setHasSavedDraft] = useState(() => {
    try {
      return hasLocalDraft(window.localStorage, waterTreatmentDemoDocument.projectId);
    } catch {
      return false;
    }
  });
  const [zoom, setZoom] = useState(1);
  const [gridVisible, setGridVisible] = useState(true);
  const [gridSnap, setGridSnap] = useState(true);
  const [nodeSnap, setNodeSnap] = useState(true);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const geometryRef = useRef<GeometryDragState | null>(null);

  const page = state.document.pages[0];
  const selected = page?.nodes.find((node) => node.id === state.selectedId);
  const snapResult = useMemo(() => {
    if (preview === null) return null;
    const anchor = state.document.pages[0]?.nodes.find((node) => node.id === preview.id);
    if (!anchor) return null;
    return resolveDragSnap(
      state.document,
      state.selectedIds,
      preview.x - anchor.transform.x,
      preview.y - anchor.transform.y,
      { gridEnabled: gridSnap, nodeEnabled: nodeSnap },
    );
  }, [preview, state.document, state.selectedIds, gridSnap, nodeSnap]);
  const displayDocument = useMemo(
    () =>
      geometryPreview ??
      (snapResult === null
        ? state.document
        : withNodesTranslated(state.document, state.selectedIds, snapResult.dx, snapResult.dy)),
    [geometryPreview, snapResult, state.document, state.selectedIds],
  );
  const image = useMemo(() => svgDataUrl(displayDocument, previewTags), [displayDocument]);

  if (!page) throw new Error("工程文档不包含页面");

  const hasGroupedSelection = page.nodes.some(
    (node) => node.groupId !== undefined && state.selectedIds.includes(node.id),
  );
  const canGroup = state.selectedIds.length >= 2 && !hasGroupedSelection;

  function refresh() {
    const next = editor.snapshot();
    setState(next);
    const node = next.document.pages[0]?.nodes.find((item) => item.id === next.selectedId);
    setLabelDraft(typeof node?.props.text === "string" ? node.props.text : "");
  }

  function refreshDraftAvailability(projectId: string): string {
    try {
      setHasSavedDraft(hasLocalDraft(window.localStorage, projectId));
      return "";
    } catch (error) {
      setHasSavedDraft(false);
      return "；本地草稿检测失败：" + (error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        (event.target instanceof Element &&
          event.target.closest("input, textarea, select, [contenteditable]"))
      )
        return;

      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      let handled = false;

      if (command && !event.altKey) {
        if (key === "z") handled = event.shiftKey ? editor.redo() : editor.undo();
        else if (key === "y") handled = editor.redo();
        else if (key === "a") {
          editor.selectMany(
            editor.snapshot().document.pages[0]?.nodes.map((node) => node.id) ?? [],
          );
          handled = true;
        }
      } else if (!command && !event.altKey) {
        if (key === "escape") {
          dragRef.current = null;
          marqueeRef.current = null;
          geometryRef.current = null;
          setPreview(null);
          setMarquee(null);
          setGeometryPreview(null);
          setRotating(false);
          editor.select(null);
          handled = true;
        } else if (key === "delete" || key === "backspace") {
          handled = editor.deleteSelected();
        } else if (key.startsWith("arrow")) {
          const step = event.shiftKey ? 10 : 1;
          const moves: Record<string, [number, number]> = {
            arrowleft: [-step, 0],
            arrowright: [step, 0],
            arrowup: [0, -step],
            arrowdown: [0, step],
          };
          const move = moves[key];
          if (move) handled = editor.moveBy(move[0], move[1]);
        }
      }

      if (!handled) return;
      event.preventDefault();
      const next = editor.snapshot();
      setState(next);
      const selected = next.document.pages[0]?.nodes.find((node) => node.id === next.selectedId);
      setLabelDraft(typeof selected?.props.text === "string" ? selected.props.text : "");
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [editor]);

  function startMarquee(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const point = canvasPoint(event.clientX, event.clientY);
    if (!point) return;
    const next: MarqueeState = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      x: point.x,
      y: point.y,
      additive: event.shiftKey,
    };
    marqueeRef.current = next;
    setMarquee(next);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function updateMarquee(event: ReactPointerEvent<SVGSVGElement>) {
    const current = marqueeRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const point = canvasPoint(event.clientX, event.clientY);
    if (!point) return;
    const next = { ...current, x: point.x, y: point.y };
    marqueeRef.current = next;
    setMarquee(next);
  }

  function finishMarquee(event: ReactPointerEvent<SVGSVGElement>) {
    const current = marqueeRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const point = canvasPoint(event.clientX, event.clientY);
    marqueeRef.current = null;
    setMarquee(null);
    const endX = point?.x ?? current.x;
    const endY = point?.y ?? current.y;
    if (Math.hypot(endX - current.startX, endY - current.startY) < 4) {
      if (!current.additive) editor.select(null);
    } else {
      const ids = findNodesInRect(
        editor.snapshot().document,
        current.startX,
        current.startY,
        endX,
        endY,
      );
      editor.selectMany(ids, current.additive);
    }
    refresh();
  }

  function select(id: string | null, additive = false) {
    if (dragRef.current !== null) return;
    editor.select(id, additive);
    refresh();
  }

  function apply(action: () => unknown, message: string) {
    try {
      action();
      refresh();
      setNotice(message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function addSymbol(type: EditableSymbol) {
    apply(() => editor.addNode(type), "已新增图元（未绑定任何设备）");
  }

  function align(mode: Alignment) {
    apply(() => editor.alignSelected(mode), "所选图元已按主选图元对齐");
  }

  function layer(action: LayerAction) {
    apply(() => editor.reorderSelected(action), "已调整图元层级");
  }

  function changeZoom(delta: number) {
    setZoom((current) => Math.max(0.5, Math.min(2, Math.round((current + delta) * 100) / 100)));
  }

  function canvasPoint(clientX: number, clientY: number) {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    return new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  }

  function beginDrag(event: ReactPointerEvent<SVGRectElement>, id: string) {
    if (event.button !== 0) return;
    const point = canvasPoint(event.clientX, event.clientY);
    if (!point) return;
    const node = page.nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    if (event.shiftKey) {
      editor.select(id, true);
      refresh();
      event.preventDefault();
      return;
    }
    if (!editor.snapshot().selectedIds.includes(id)) editor.select(id);
    refresh();
    dragRef.current = {
      pointerId: event.pointerId,
      id,
      originX: node.transform.x,
      originY: node.transform.y,
      startX: point.x,
      startY: point.y,
      lastX: node.transform.x,
      lastY: node.transform.y,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function updateDrag(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = canvasPoint(event.clientX, event.clientY);
    if (!point) return;
    drag.lastX = drag.originX + point.x - drag.startX;
    drag.lastY = drag.originY + point.y - drag.startY;
    setPreview({ id: drag.id, x: drag.lastX, y: drag.lastY });
  }

  function finishDrag(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = canvasPoint(event.clientX, event.clientY);
    const x = point ? drag.originX + point.x - drag.startX : drag.lastX;
    const y = point ? drag.originY + point.y - drag.startY : drag.lastY;
    dragRef.current = null;
    setPreview(null);
    try {
      const snapshot = editor.snapshot();
      const movement = resolveDragSnap(
        snapshot.document,
        snapshot.selectedIds,
        x - drag.originX,
        y - drag.originY,
        { gridEnabled: gridSnap, nodeEnabled: nodeSnap },
      );
      editor.moveBy(movement.dx, movement.dy);
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function beginGeometry(event: ReactPointerEvent<SVGElement>, handle: ResizeHandle | "rotate") {
    if (event.button !== 0 || state.selectedIds.length !== 1 || !selected) return;
    const point = canvasPoint(event.clientX, event.clientY);
    if (!point) return;
    geometryRef.current = {
      pointerId: event.pointerId,
      nodeId: selected.id,
      handle,
      startX: point.x,
      startY: point.y,
      lastPatch: null,
    };
    setRotating(handle === "rotate");
    dragRef.current = null;
    marqueeRef.current = null;
    setPreview(null);
    setMarquee(null);
    setGeometryPreview(null);
    svgRef.current?.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function updateGeometry(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = geometryRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const point = canvasPoint(event.clientX, event.clientY);
    if (!point) return;
    const snapshot = editor.snapshot();
    const node = snapshot.document.pages[0]?.nodes.find((item) => item.id === gesture.nodeId);
    if (!node) return;
    try {
      const patch: NodeTransformPatch =
        gesture.handle === "rotate"
          ? {
              rotation: resolveRotationTransform(
                node.transform,
                gesture.startX,
                gesture.startY,
                point.x,
                point.y,
                event.shiftKey,
              ).rotation,
            }
          : resolveResizeTransform(
              node.transform,
              gesture.handle,
              point.x - gesture.startX,
              point.y - gesture.startY,
              event.shiftKey,
            );
      const next = withNodeTransform(snapshot.document, gesture.nodeId, patch);
      gesture.lastPatch = patch;
      setGeometryPreview(next);
    } catch {
      // 越界或尺寸不合法时，保留最近一次合法预览。
    }
  }

  function finishGeometry(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = geometryRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    updateGeometry(event);
    geometryRef.current = null;
    setGeometryPreview(null);
    setRotating(false);
    if (gesture.lastPatch === null) return;
    try {
      if (editor.updateSelectedTransform(gesture.lastPatch)) {
        refresh();
        setNotice("图元缩放或旋转已应用，可撤销");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function cancelDrag() {
    dragRef.current = null;
    marqueeRef.current = null;
    geometryRef.current = null;
    setPreview(null);
    setMarquee(null);
    setGeometryPreview(null);
    setRotating(false);
  }

  function nudge(dx: number, dy: number) {
    if (!selected) return;
    apply(() => editor.moveBy(dx, dy), "已移动所选图元");
  }

  function changeLabel() {
    try {
      editor.setSelectedLabel(labelDraft);
      refresh();
      setNotice("文案已更新，可撤销");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function changeGeometry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const patch: NodeTransformPatch = {};
    for (const [key, label] of geometryFields) {
      const raw = values.get(key);
      if (typeof raw !== "string" || raw.trim() === "") {
        setNotice(`请填写${label}`);
        return;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        setNotice(`${label}必须是有限数`);
        return;
      }
      patch[key] = value;
    }
    try {
      const changed = editor.updateSelectedTransform(patch);
      refresh();
      setNotice(changed ? "图元几何属性已更新，可撤销" : "图元几何属性未发生变化");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function saveDraft() {
    try {
      const storage = window.localStorage;
      const projectId = editor.snapshot().document.projectId;
      if (
        hasLocalDraft(storage, projectId) &&
        !window.confirm("当前工程已有本地草稿，确认使用现有画面覆盖吗？")
      ) {
        return;
      }
      const saved = saveLocalDraft(storage, editor.snapshot().document);
      setHasSavedDraft(true);
      setNotice(`当前工程已保存到此浏览器（${saved.savedAt}），并非正式工程发布`);
    } catch (error) {
      setNotice("保存草稿失败：" + (error instanceof Error ? error.message : String(error)));
    }
  }

  function restoreDraft() {
    if (!window.confirm("恢复本地草稿将替换当前工程并清空撤销历史，确认恢复吗？")) return;
    try {
      const saved = readLocalDraft(window.localStorage, state.document.projectId);
      if (!saved) {
        setHasSavedDraft(false);
        setNotice("当前工程没有可恢复的本地草稿");
        return;
      }
      editor.loadDocument(saved.document);
      cancelDrag();
      refresh();
      setHasSavedDraft(true);
      setNotice(`已恢复浏览器本地草稿（保存于 ${saved.savedAt}）`);
    } catch (error) {
      setNotice("恢复草稿失败：" + (error instanceof Error ? error.message : String(error)));
    }
  }

  function clearDraft() {
    if (!window.confirm("确认永久清除当前工程的浏览器本地草稿吗？当前画面不会改变。")) return;
    try {
      clearLocalDraft(window.localStorage, state.document.projectId);
      setHasSavedDraft(false);
      setNotice("已清除当前工程的本地草稿，当前编辑画面保持不变");
    } catch (error) {
      setNotice("清除草稿失败：" + (error instanceof Error ? error.message : String(error)));
    }
  }

  function exportJson() {
    const json = JSON.stringify(state.document, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.document.projectId}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice("已导出本地 JSON 草稿（并非工程发布）");
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      if (file.size > maxFileSize) throw new RangeError("JSON 文件不能超过 2 MiB");
      const migratedFrom = editor.loadDocument(JSON.parse(await file.text()) as unknown);
      setPreview(null);
      refresh();
      const draftWarning = refreshDraftAvailability(editor.snapshot().document.projectId);
      setNotice(
        (migratedFrom
          ? `已将工程从 ${migratedFrom} 迁移至当前版本，请重新导出 JSON 草稿`
          : "工程 JSON 已校验并载入本地编辑器") + draftWarning,
      );
    } catch (error) {
      setNotice("导入失败：" + (error instanceof Error ? error.message : String(error)));
    }
  }

  return (
    <main className="studio-shell">
      <header className="studio-toolbar">
        <div>
          <p className="scada-eyebrow">ADui SCADA · V0.2 Studio</p>
          <h1>SVG 组态编辑器</h1>
        </div>
        <div className="studio-actions">
          <button
            type="button"
            onClick={() => {
              editor.undo();
              refresh();
            }}
            disabled={!state.canUndo}
          >
            撤销
          </button>
          <button
            type="button"
            onClick={() => {
              editor.redo();
              refresh();
            }}
            disabled={!state.canRedo}
          >
            重做
          </button>
          <label className="studio-import">
            导入 JSON
            <input
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                void importJson(event);
              }}
            />
          </label>
          <button type="button" onClick={exportJson}>
            导出 JSON
          </button>
          <button type="button" onClick={saveDraft}>
            保存草稿
          </button>
          <button type="button" onClick={restoreDraft} disabled={!hasSavedDraft}>
            恢复草稿
          </button>
          <button type="button" onClick={clearDraft} disabled={!hasSavedDraft}>
            清除草稿
          </button>
        </div>
      </header>
      <p role="status" className="studio-notice">
        {notice}
      </p>
      <div className="studio-workspace">
        <aside className="studio-panel" aria-label="图元列表">
          <h2>图元 · {page.nodes.length}</h2>
          <p className="studio-tip">Shift+点击多选；拖动空白区域框选；Ctrl+A 全选，Del 删除。</p>
          <div className="studio-add">
            <button type="button" onClick={() => addSymbol("tank")}>
              + 水箱
            </button>
            <button type="button" onClick={() => addSymbol("pump")}>
              + 水泵
            </button>
            <button type="button" onClick={() => addSymbol("pipe")}>
              + 管道
            </button>
            <button type="button" onClick={() => addSymbol("label")}>
              + 文本
            </button>
          </div>
          {page.nodes.map((node) => (
            <button
              type="button"
              className="studio-layer"
              data-selected={state.selectedIds.includes(node.id)}
              key={node.id}
              onClick={(event) => select(node.id, event.shiftKey)}
            >
              <span>{node.id}</span>
              <small>
                {node.type}
                {node.groupId ? ` · 组合 ${node.groupId}` : ""}
              </small>
            </button>
          ))}
        </aside>
        <section className="studio-stage" aria-label="组态画布">
          <div className="studio-stage-caption">
            <span>
              {page.name} · {page.size.width} × {page.size.height} · 静态模拟预览
            </span>
            <div className="studio-canvas-settings">
              <label className="studio-canvas-option">
                <input
                  type="checkbox"
                  checked={gridVisible}
                  onChange={(event) => setGridVisible(event.target.checked)}
                />
                显示网格
              </label>
              <label className="studio-canvas-option">
                <input
                  type="checkbox"
                  checked={gridSnap}
                  onChange={(event) => setGridSnap(event.target.checked)}
                />
                网格吸附
              </label>
              <label className="studio-canvas-option">
                <input
                  type="checkbox"
                  checked={nodeSnap}
                  onChange={(event) => setNodeSnap(event.target.checked)}
                />
                图元吸附
              </label>
            </div>
            <div className="studio-zoom" aria-label="画布缩放">
              <button type="button" onClick={() => changeZoom(-0.25)} disabled={zoom <= 0.5}>
                −
              </button>
              <button type="button" onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" onClick={() => changeZoom(0.25)} disabled={zoom >= 2}>
                +
              </button>
            </div>
          </div>
          <svg
            ref={svgRef}
            className="studio-svg"
            data-rotating={rotating ? "true" : undefined}
            style={{ width: `${zoom * 100}%` }}
            viewBox={`0 0 ${page.size.width} ${page.size.height}`}
            onPointerMove={(event) => {
              updateDrag(event);
              updateMarquee(event);
              updateGeometry(event);
            }}
            onPointerUp={(event) => {
              finishDrag(event);
              finishMarquee(event);
              finishGeometry(event);
            }}
            onPointerCancel={cancelDrag}
            onPointerDown={startMarquee}
            aria-label="可编辑 SVG 画布"
          >
            <defs>
              <pattern
                id="scada-studio-grid"
                width={DEFAULT_GRID_SIZE}
                height={DEFAULT_GRID_SIZE}
                patternUnits="userSpaceOnUse"
              >
                <path
                  d={`M ${DEFAULT_GRID_SIZE} 0 L 0 0 0 ${DEFAULT_GRID_SIZE}`}
                  fill="none"
                  stroke="#8295ac"
                  strokeWidth="0.8"
                  opacity="0.45"
                />
              </pattern>
            </defs>
            <image
              href={image}
              width={page.size.width}
              height={page.size.height}
              pointerEvents="none"
            />
            {gridVisible && (
              <rect
                x={0}
                y={0}
                width={page.size.width}
                height={page.size.height}
                fill="url(#scada-studio-grid)"
                pointerEvents="none"
              />
            )}
            {page.nodes.map((node) => {
              const displayNode =
                displayDocument.pages[0]?.nodes.find((entry) => entry.id === node.id) ?? node;
              const t = displayNode.transform;
              return (
                <g
                  key={node.id}
                  transform={`rotate(${t.rotation} ${t.x + t.width / 2} ${t.y + t.height / 2})`}
                >
                  <rect
                    role="button"
                    tabIndex={0}
                    aria-label={`选择并拖动 ${node.id}`}
                    x={t.x}
                    y={t.y}
                    width={t.width}
                    height={t.height}
                    fill="transparent"
                    stroke={
                      state.selectedId === node.id
                        ? "#f0ae4d"
                        : state.selectedIds.includes(node.id)
                          ? "#39c9ba"
                          : "transparent"
                    }
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    className="studio-hitbox"
                    onPointerDown={(event) => beginDrag(event, node.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        select(node.id, event.shiftKey);
                      }
                    }}
                  />
                  {state.selectedIds.length === 1 && state.selectedId === node.id && (
                    <>
                      {RESIZE_HANDLES.map((handle) => {
                        const position = resizeHandlePosition(t, handle);
                        return (
                          <rect
                            key={handle}
                            className="studio-resize-handle"
                            data-handle={handle}
                            aria-label={`缩放图元${RESIZE_HANDLE_LABELS[handle]}`}
                            x={position.x - 5}
                            y={position.y - 5}
                            width={10}
                            height={10}
                            onPointerDown={(event) => beginGeometry(event, handle)}
                          >
                            <title>按住 Shift 保持宽高比</title>
                          </rect>
                        );
                      })}
                      <line
                        className="studio-rotation-stem"
                        x1={t.x + t.width / 2}
                        x2={t.x + t.width / 2}
                        y1={t.y}
                        y2={t.y - 26}
                        pointerEvents="none"
                      />
                      <circle
                        className="studio-rotation-handle"
                        aria-label="旋转图元，按住 Shift 可按 15 度吸附"
                        cx={t.x + t.width / 2}
                        cy={t.y - 26}
                        r={7}
                        onPointerDown={(event) => beginGeometry(event, "rotate")}
                      />
                    </>
                  )}
                </g>
              );
            })}
            {snapResult?.verticalGuide != null && (
              <line
                className="studio-alignment-guide"
                x1={snapResult.verticalGuide}
                x2={snapResult.verticalGuide}
                y1={0}
                y2={page.size.height}
                pointerEvents="none"
              />
            )}
            {snapResult?.horizontalGuide != null && (
              <line
                className="studio-alignment-guide"
                x1={0}
                x2={page.size.width}
                y1={snapResult.horizontalGuide}
                y2={snapResult.horizontalGuide}
                pointerEvents="none"
              />
            )}
            {marquee !== null && (
              <rect
                className="studio-marquee"
                x={Math.min(marquee.startX, marquee.x)}
                y={Math.min(marquee.startY, marquee.y)}
                width={Math.abs(marquee.x - marquee.startX)}
                height={Math.abs(marquee.y - marquee.startY)}
                pointerEvents="none"
              />
            )}
          </svg>
        </section>
        <aside className="studio-panel" aria-label="图元属性">
          <h2>属性 · 已选 {state.selectedIds.length}</h2>
          <div className="studio-toolbox">
            <div className="studio-tool-group" aria-label="图元组合">
              <button
                type="button"
                disabled={!canGroup}
                onClick={() => apply(() => editor.groupSelected(), "已组合所选图元，可撤销")}
              >
                组合所选
              </button>
              <button
                type="button"
                disabled={!hasGroupedSelection}
                onClick={() => apply(() => editor.ungroupSelected(), "已解组，可撤销")}
              >
                解组
              </button>
            </div>
            <button
              type="button"
              onClick={() => apply(() => editor.deleteSelected(), "已删除图元，可撤销")}
              disabled={state.selectedIds.length === 0}
            >
              删除所选
            </button>
            <div className="studio-tool-group" aria-label="图层排序">
              <button type="button" onClick={() => layer("back")} disabled={!selected}>
                置底
              </button>
              <button type="button" onClick={() => layer("backward")} disabled={!selected}>
                下移层
              </button>
              <button type="button" onClick={() => layer("forward")} disabled={!selected}>
                上移层
              </button>
              <button type="button" onClick={() => layer("front")} disabled={!selected}>
                置顶
              </button>
            </div>
            <h3>多选对齐（以最后选中的图元为准）</h3>
            <div className="studio-tool-group" aria-label="图元对齐">
              {(
                [
                  ["left", "左"],
                  ["hcenter", "水平居中"],
                  ["right", "右"],
                  ["top", "上"],
                  ["vcenter", "垂直居中"],
                  ["bottom", "下"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  type="button"
                  key={mode}
                  onClick={() => align(mode)}
                  disabled={state.selectedIds.length < 2 || hasGroupedSelection}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {selected ? (
            <>
              <p>
                <strong>{selected.id}</strong> · {selected.type}
              </p>
              {state.selectedIds.length === 1 ? (
                <form
                  key={`${selected.id}:${JSON.stringify(selected.transform)}`}
                  className="studio-geometry"
                  onSubmit={changeGeometry}
                  noValidate
                >
                  {geometryFields.map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        name={key}
                        step="any"
                        defaultValue={selected.transform[key]}
                      />
                    </label>
                  ))}
                  <button type="submit">应用几何属性</button>
                </form>
              ) : (
                <p className="studio-tip">当前为多选状态，请单选一个图元编辑几何属性。</p>
              )}
              <p className="studio-tip">拖动画布中的虚线框，或使用方向按钮微调。每次操作可撤销。</p>
              <div className="studio-nudge">
                <button type="button" onClick={() => nudge(-1, 0)}>
                  ←
                </button>
                <button type="button" onClick={() => nudge(0, -1)}>
                  ↑
                </button>
                <button type="button" onClick={() => nudge(0, 1)}>
                  ↓
                </button>
                <button type="button" onClick={() => nudge(1, 0)}>
                  →
                </button>
              </div>
              {selected.type === "label" && state.selectedIds.length === 1 && (
                <label className="studio-field">
                  显示文案
                  <input
                    value={labelDraft}
                    maxLength={256}
                    onChange={(event) => setLabelDraft(event.target.value)}
                  />
                  <button type="button" onClick={changeLabel}>
                    应用文案
                  </button>
                </label>
              )}
              <h3>Tag 绑定（只读）</h3>
              {Object.entries(selected.bindings).map(([slot, binding]) => (
                <p className="studio-binding" key={slot}>
                  {slot} → {binding.tagId}
                </p>
              ))}
            </>
          ) : (
            <p className="studio-tip">选择左侧图元或画布中的图元查看属性。</p>
          )}
        </aside>
      </div>
      <footer>
        V0.2 · 框选/快捷键：Ctrl+A 全选，Ctrl+Z 撤销，Ctrl+Shift+Z/Ctrl+Y
        重做，方向键微移，Shift+方向键移动 10 格，Esc 取消选择 · 无设备写入
      </footer>
    </main>
  );
}
