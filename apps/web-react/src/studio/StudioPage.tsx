import { useMemo, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";
import { WaterTreatmentSimulator, waterTreatmentDemoDocument } from "@adui/scada-core";
import { DocumentEditor, withNodePosition } from "@adui/scada-core/editor";
import type { EditorSnapshot } from "@adui/scada-core/editor";
import { svgDataUrl } from "@adui/scada-runtime";
import "./studio.css";

const previewTags = new WaterTreatmentSimulator().next(new Date("2026-11-09T00:00:00Z"));
const maxFileSize = 2 * 1024 * 1024;

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
  const [labelDraft, setLabelDraft] = useState("");
  const [notice, setNotice] = useState("本地草稿 · 尚未连接工程保存 API");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const page = state.document.pages[0];
  const selected = page?.nodes.find((node) => node.id === state.selectedId);
  const displayDocument = useMemo(
    () =>
      preview === null
        ? state.document
        : withNodePosition(state.document, preview.id, preview.x, preview.y),
    [preview, state.document],
  );
  const image = useMemo(() => svgDataUrl(displayDocument, previewTags), [displayDocument]);

  if (!page) throw new Error("No page in editor document");

  function refresh() {
    const next = editor.snapshot();
    setState(next);
    const node = next.document.pages[0]?.nodes.find((item) => item.id === next.selectedId);
    setLabelDraft(typeof node?.props.text === "string" ? node.props.text : "");
  }

  function select(id: string | null) {
    if (dragRef.current !== null) return;
    editor.select(id);
    refresh();
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
    editor.select(id);
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
      editor.moveSelected(x, y);
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function cancelDrag() {
    dragRef.current = null;
    setPreview(null);
  }

  function nudge(dx: number, dy: number) {
    if (!selected) return;
    editor.moveSelected(selected.transform.x + dx, selected.transform.y + dy);
    refresh();
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
          {page.nodes.map((node) => (
            <button
              type="button"
              className="studio-layer"
              data-selected={node.id === state.selectedId}
              key={node.id}
              onClick={() => select(node.id)}
            >
              <span>{node.id}</span>
              <small>{node.type}</small>
            </button>
          ))}
        </aside>
        <section className="studio-stage" aria-label="组态画布">
          <div className="studio-stage-caption">
            {page.name} · {page.size.width} × {page.size.height} · 静态模拟预览
          </div>
          <svg
            ref={svgRef}
            className="studio-svg"
            viewBox={`0 0 ${page.size.width} ${page.size.height}`}
            onPointerMove={updateDrag}
            onPointerUp={finishDrag}
            onPointerCancel={cancelDrag}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) select(null);
            }}
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
                    stroke={state.selectedId === node.id ? "#f0ae4d" : "transparent"}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    className="studio-hitbox"
                    onPointerDown={(event) => beginDrag(event, node.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        select(node.id);
                      }
                    }}
                  />
                </g>
              );
            })}
          </svg>
        </section>
        <aside className="studio-panel" aria-label="图元属性">
          <h2>属性</h2>
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
      <footer>V0.2 第一阶段 · 本地 JSON 草稿 · 不连接 PLC/DCS · 暂无发布与服务端保存</footer>
    </main>
  );
}
