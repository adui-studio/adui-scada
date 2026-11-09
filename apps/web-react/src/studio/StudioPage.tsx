import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";
import { WaterTreatmentSimulator, waterTreatmentDemoDocument } from "@adui/scada-core";
import { DocumentEditor, findNodesInRect, withNodesTranslated } from "@adui/scada-core/editor";
import type {
  Alignment,
  EditableSymbol,
  EditorSnapshot,
  LayerAction,
} from "@adui/scada-core/editor";
import { svgDataUrl } from "@adui/scada-runtime";
import "./studio.css";

const previewTags = new WaterTreatmentSimulator().next(new Date("2026-11-09T00:00:00Z"));
const maxFileSize = 2 * 1024 * 1024;

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

export default function StudioPage() {
  const editor = useMemo(() => new DocumentEditor(waterTreatmentDemoDocument), []);
  const [state, setState] = useState<EditorSnapshot>(() => editor.snapshot());
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [notice, setNotice] = useState("本地草稿 · 尚未连接工程保存 API");
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);

  const page = state.document.pages[0];
  const selected = page?.nodes.find((node) => node.id === state.selectedId);
  const displayDocument = useMemo(() => {
    if (preview === null) return state.document;
    const anchor = state.document.pages[0]?.nodes.find((node) => node.id === preview.id);
    if (!anchor) return state.document;
    return withNodesTranslated(
      state.document,
      state.selectedIds,
      preview.x - anchor.transform.x,
      preview.y - anchor.transform.y,
    );
  }, [preview, state.document, state.selectedIds]);
  const image = useMemo(() => svgDataUrl(displayDocument, previewTags), [displayDocument]);

  if (!page) throw new Error("No page in editor document");

  function refresh() {
    const next = editor.snapshot();
    setState(next);
    const node = next.document.pages[0]?.nodes.find((item) => item.id === next.selectedId);
    setLabelDraft(typeof node?.props.text === "string" ? node.props.text : "");
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
          setPreview(null);
          setMarquee(null);
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
      editor.moveBy(x - drag.originX, y - drag.originY);
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function cancelDrag() {
    dragRef.current = null;
    marqueeRef.current = null;
    setPreview(null);
    setMarquee(null);
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
      editor.loadDocument(JSON.parse(await file.text()) as unknown);
      setPreview(null);
      refresh();
      setNotice("工程 JSON 已校验并载入本地编辑器");
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
              <small>{node.type}</small>
            </button>
          ))}
        </aside>
        <section className="studio-stage" aria-label="组态画布">
          <div className="studio-stage-caption">
            <span>
              {page.name} · {page.size.width} × {page.size.height} · 静态模拟预览
            </span>
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
            style={{ width: `${zoom * 100}%` }}
            viewBox={`0 0 ${page.size.width} ${page.size.height}`}
            onPointerMove={(event) => {
              updateDrag(event);
              updateMarquee(event);
            }}
            onPointerUp={(event) => {
              finishDrag(event);
              finishMarquee(event);
            }}
            onPointerCancel={cancelDrag}
            onPointerDown={startMarquee}
            aria-label="可编辑 SVG 画布"
          >
            <image
              href={image}
              width={page.size.width}
              height={page.size.height}
              pointerEvents="none"
            />
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
                </g>
              );
            })}
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
                  disabled={state.selectedIds.length < 2}
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
              <div className="studio-fields">
                <span>X：{selected.transform.x}</span>
                <span>Y：{selected.transform.y}</span>
                <span>宽：{selected.transform.width}</span>
                <span>高：{selected.transform.height}</span>
              </div>
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
              {selected.type === "label" && (
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
