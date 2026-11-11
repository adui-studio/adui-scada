import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  DragEvent as ReactDragEvent,
  FormEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  WaterTreatmentSimulator,
  waterTreatmentDemoDocument,
  waterTreatmentDemoTagOptions,
  DraftAutoSaveSession,
  LOCAL_DRAFT_AUTO_SAVE_DELAY_MS,
  studioNodeLocked,
  studioNodeVisible,
  buildLayerTree,
} from "@adui/scada-core";
import type { LayerTreeGroup, ScadaDocument, ScadaNode } from "@adui/scada-core";
import { DexieDraftRepository, InvalidLegacyDraftError } from "@adui/scada-draft-storage";
import {
  DEFAULT_GRID_SIZE,
  DocumentEditor,
  editableTagSlot,
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
function getLegacyStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
const drafts = new DexieDraftRepository({ legacyStorage: getLegacyStorage() });
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
  const [preferredCopyTargetPageId, setPreferredCopyTargetPageId] = useState("");
  const [preferredLayerTargetId, setPreferredLayerTargetId] = useState("");
  const [layerSearch, setLayerSearch] = useState("");
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set());
  const [locateLayerRequest, setLocateLayerRequest] = useState<{ key: string } | null>(null);
  const [layerInsertPosition, setLayerInsertPosition] = useState<"before" | "after">("after");
  const [layerDrop, setLayerDrop] = useState<{ id: string; position: "before" | "after" } | null>(
    null,
  );
  const [notice, setNotice] = useState("可手动保存浏览器本地草稿 · 尚未连接工程保存服务");
  const [hasSavedDraft, setHasSavedDraft] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const autoSaveSessionRef = useRef<DraftAutoSaveSession | null>(null);
  const draftActionRef = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [gridVisible, setGridVisible] = useState(true);
  const [gridSnap, setGridSnap] = useState(true);
  const [nodeSnap, setNodeSnap] = useState(true);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const geometryRef = useRef<GeometryDragState | null>(null);
  const layerDragRef = useRef<{ pageId: string; nodeId: string } | null>(null);
  const layerTreeRef = useRef<HTMLDivElement | null>(null);
  const selectionSyncRef = useRef<{ pageId: string; nodeId: string | null }>({
    pageId: state.activePageId,
    nodeId: state.selectedId,
  });

  const page = state.document.pages.find((item) => item.id === state.activePageId);
  const selected = page?.nodes.find((node) => node.id === state.selectedId);
  const snapResult = useMemo(() => {
    if (preview === null) return null;
    const anchor = state.document.pages
      .find((item) => item.id === state.activePageId)
      ?.nodes.find((node) => node.id === preview.id);
    if (!anchor) return null;
    return resolveDragSnap(
      state.document,
      state.selectedIds,
      preview.x - anchor.transform.x,
      preview.y - anchor.transform.y,
      { gridEnabled: gridSnap, nodeEnabled: nodeSnap },
      state.activePageId,
    );
  }, [preview, state.document, state.activePageId, state.selectedIds, gridSnap, nodeSnap]);
  const displayDocument = useMemo(
    () =>
      geometryPreview ??
      (snapResult === null
        ? state.document
        : withNodesTranslated(
            state.document,
            state.selectedIds,
            snapResult.dx,
            snapResult.dy,
            state.activePageId,
          )),
    [geometryPreview, snapResult, state.document, state.activePageId, state.selectedIds],
  );
  const image = useMemo(
    () => svgDataUrl(displayDocument, previewTags, state.activePageId),
    [displayDocument, state.activePageId],
  );

  if (!page) throw new Error("工程文档不包含页面");

  const hasGroupedSelection = page.nodes.some(
    (node) => node.groupId !== undefined && state.selectedIds.includes(node.id),
  );
  const hasLockedSelection = page.nodes.some(
    (node) => state.selectedIds.includes(node.id) && studioNodeLocked(node),
  );
  const canGroup = state.selectedIds.length >= 2 && !hasGroupedSelection && !hasLockedSelection;
  const layerEntries = useMemo(
    () => buildLayerTree(page.nodes, layerSearch),
    [page.nodes, layerSearch],
  );
  const isLayerSearching = layerSearch.trim().length > 0;
  const lockedLayerGroups = new Set(
    page?.nodes.filter(studioNodeLocked).flatMap((node) => (node.groupId ? [node.groupId] : [])),
  );
  const canPreciselyMove =
    selected !== undefined &&
    (state.selectedIds.length === 1 ||
      (selected.groupId !== undefined &&
        state.selectedIds.every(
          (id) => page?.nodes.find((node) => node.id === id)?.groupId === selected.groupId,
        ))) &&
    !hasLockedSelection;
  useEffect(() => {
    if (!locateLayerRequest) return;
    const rows = layerTreeRef.current?.querySelectorAll<HTMLButtonElement>("[data-layer-key]");
    const row = [...(rows ?? [])].find((item) => item.dataset.layerKey === locateLayerRequest.key);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [locateLayerRequest]);

  const layerTargetNodes = page
    ? page.nodes.filter(
        (node) =>
          node.id !== selected?.id &&
          (selected?.groupId === undefined || node.groupId !== selected.groupId),
      )
    : [];
  const layerTargetId = layerTargetNodes.some((node) => node.id === preferredLayerTargetId)
    ? preferredLayerTargetId
    : (layerTargetNodes[0]?.id ?? "");
  const activePageIndex = state.document.pages.findIndex((item) => item.id === state.activePageId);
  const copyTargetPages = state.document.pages.filter((item) => item.id !== state.activePageId);
  const copyTargetPageId = copyTargetPages.some((item) => item.id === preferredCopyTargetPageId)
    ? preferredCopyTargetPageId
    : (copyTargetPages[0]?.id ?? "");
  const bindingSlot =
    state.selectedIds.length === 1 && selected && !selected.groupId && !studioNodeLocked(selected)
      ? editableTagSlot(selected.type)
      : null;
  const demoTagCandidates =
    bindingSlot === null
      ? []
      : waterTreatmentDemoTagOptions.filter((option) => option.slots.includes(bindingSlot));
  const currentBindingTag = bindingSlot ? (selected?.bindings[bindingSlot]?.tagId ?? "") : "";
  const missingBindingTag =
    currentBindingTag !== "" &&
    !demoTagCandidates.some((option) => option.tagId === currentBindingTag);

  function switchPage(pageId: string) {
    try {
      if (!editor.switchPage(pageId)) return;
      clearLayerDrag();
      setLayerSearch("");
      setLocateLayerRequest(null);
      cancelDrag();
      setZoom(1);
      refresh();
      setNotice("已切换编辑页面；页面切换不会修改工程草稿");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function createPage() {
    apply(() => {
      editor.createPage();
      setLayerSearch("");
      cancelDrag();
    }, "已创建空白页面，可撤销");
  }

  function renamePage() {
    if (!page) return;
    const name = window.prompt("请输入新的页面名称", page.name);
    if (name === null) return;
    apply(() => editor.renamePage(page.id, name), "页面已重命名，可撤销");
  }

  function deletePage() {
    if (!page || !window.confirm("确定删除页面“" + page.name + "”及其图元吗？可撤销。")) {
      return;
    }
    apply(() => {
      editor.deletePage(page.id);
      cancelDrag();
    }, "页面已删除，可撤销");
  }

  function duplicatePage() {
    apply(() => {
      editor.duplicatePage();
      setLayerSearch("");
      cancelDrag();
    }, "已复制页面及其图元和 Tag 绑定，可撤销");
  }

  function movePage(direction: "previous" | "next") {
    apply(() => editor.movePage(state.activePageId, direction), "页面顺序已调整，可撤销");
  }

  function copySelectedToPage() {
    if (!copyTargetPageId) return;
    apply(
      () => editor.copySelectedToPage(copyTargetPageId),
      "已将所选图元复制到目标页面，可撤销；源页面保持不变",
    );
  }

  function changeTagBinding(slot: string, tagId: string) {
    apply(
      () => editor.setSelectedBinding(slot, tagId === "" ? null : tagId),
      "已修改模拟 Tag 绑定，可撤销",
    );
  }

  function refresh() {
    const next = editor.snapshot();
    const previous = selectionSyncRef.current;
    const node = next.document.pages
      .find((item) => item.id === next.activePageId)
      ?.nodes.find((item) => item.id === next.selectedId);
    if (next.activePageId !== previous.pageId || next.selectedId !== previous.nodeId) {
      if (node?.groupId) {
        const groupId = node.groupId;
        setCollapsedGroupIds((current) => {
          if (!current.has(groupId)) return current;
          const updated = new Set(current);
          updated.delete(groupId);
          return updated;
        });
      }
    }
    selectionSyncRef.current = { pageId: next.activePageId, nodeId: next.selectedId };
    setState(next);
    setLabelDraft(typeof node?.props.text === "string" ? node.props.text : "");
  }

  async function refreshDraftAvailability(projectId: string): Promise<string> {
    try {
      setHasSavedDraft((await drafts.get(projectId)) !== null);
      return "";
    } catch (error) {
      setHasSavedDraft(error instanceof InvalidLegacyDraftError);
      return "；本地草稿检测失败：" + (error instanceof Error ? error.message : String(error));
    }
  }

  async function pauseAutoSave(): Promise<void> {
    const session = autoSaveSessionRef.current;
    autoSaveSessionRef.current = null;
    setAutoSaveEnabled(false);
    await session?.stop();
  }

  useEffect(() => {
    const controller = new AbortController();
    void drafts.get(state.document.projectId).then(
      (saved) => {
        if (!controller.signal.aborted) setHasSavedDraft(saved !== null);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setHasSavedDraft(error instanceof InvalidLegacyDraftError);
        setNotice("本地草稿读取失败：" + (error instanceof Error ? error.message : String(error)));
      },
    );
    const unsubscribe = drafts.subscribe(state.document.projectId, (revision) => {
      if (controller.signal.aborted) return;
      setHasSavedDraft(revision !== null);
      const session = autoSaveSessionRef.current;
      if (session && revision !== session.currentRevision) {
        autoSaveSessionRef.current = null;
        setAutoSaveEnabled(false);
        void session.stop();
        setNotice("其他标签页已修改草稿，自动保存已暂停，请先核对");
      }
    });
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [state.document.projectId]);

  useEffect(() => {
    if (!autoSaveEnabled) return;
    const session = autoSaveSessionRef.current;
    if (!session) return;
    const document = state.document;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void session.saveIfDirty(document).then(
        (saved) => {
          if (controller.signal.aborted || autoSaveSessionRef.current !== session || !saved) return;
          setHasSavedDraft(true);
          setNotice(`本地草稿已自动保存（${saved.savedAt}）`);
        },
        (error: unknown) => {
          if (controller.signal.aborted || autoSaveSessionRef.current !== session) return;
          autoSaveSessionRef.current = null;
          setAutoSaveEnabled(false);
          void session.stop();
          setNotice("自动保存已暂停：" + (error instanceof Error ? error.message : String(error)));
        },
      );
    }, LOCAL_DRAFT_AUTO_SAVE_DELAY_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [autoSaveEnabled, state.document]);

  useEffect(() => {
    return () => {
      void autoSaveSessionRef.current?.stop();
      autoSaveSessionRef.current = null;
    };
  }, []);

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

      try {
        if (command && !event.altKey) {
          if (key === "z") handled = event.shiftKey ? editor.redo() : editor.undo();
          else if (key === "y") handled = editor.redo();
          else if (key === "c" && !event.shiftKey) {
            handled = editor.copySelected();
            if (handled) setNotice("已复制所选图元到会话剪贴板");
          } else if (key === "x" && !event.shiftKey) {
            handled = editor.cutSelected();
            if (handled) setNotice("已剪切所选图元，可撤销");
          } else if (key === "v" && !event.shiftKey && editor.snapshot().hasClipboard) {
            event.preventDefault();
            try {
              handled = editor.pasteClipboard().length > 0;
              if (handled) setNotice("已粘贴图元，可撤销");
            } catch (error) {
              setNotice("粘贴失败：" + (error instanceof Error ? error.message : String(error)));
            }
          } else if (key === "a") {
            const snapshot = editor.snapshot();
            editor.selectMany(
              snapshot.document.pages
                .find((item) => item.id === snapshot.activePageId)
                ?.nodes.filter((node) => studioNodeVisible(node) && !studioNodeLocked(node))
                .map((node) => node.id) ?? [],
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
      } catch (error) {
        event.preventDefault();
        setNotice(error instanceof Error ? error.message : String(error));
        return;
      }

      if (!handled) return;
      event.preventDefault();
      const next = editor.snapshot();
      setState(next);
      const selected = next.document.pages
        .find((item) => item.id === next.activePageId)
        ?.nodes.find((node) => node.id === next.selectedId);
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
        state.activePageId,
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

  function changeSelectedLocked(locked: boolean) {
    apply(
      () => editor.setSelectedLocked(locked),
      locked ? "已批量锁定图元，可撤销" : "已批量解锁图元，可撤销",
    );
    cancelDrag();
  }

  function changeSelectedVisible(visible: boolean) {
    apply(
      () => editor.setSelectedVisible(visible),
      visible ? "已批量显示图元，可撤销" : "已批量隐藏图元，可撤销",
    );
    cancelDrag();
  }

  function moveLayerPrecisely(nodeId: string, targetId: string, position: "before" | "after") {
    try {
      const changed = editor.moveLayer(nodeId, targetId, position);
      if (changed) {
        refresh();
        setNotice("图层已精确排序，可撤销");
      } else {
        setNotice("图层位置没有变化");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function clearLayerDrag() {
    layerDragRef.current = null;
    setLayerDrop(null);
  }

  function startLayerDrag(event: ReactDragEvent<HTMLButtonElement>, nodeId: string) {
    const node = page?.nodes.find((item) => item.id === nodeId);
    if (
      !page ||
      !node ||
      studioNodeLocked(node) ||
      (node.groupId !== undefined && lockedLayerGroups.has(node.groupId))
    ) {
      event.preventDefault();
      return;
    }
    layerDragRef.current = { pageId: page.id, nodeId };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-adui-scada-layer", nodeId);
  }

  function overLayer(event: ReactDragEvent<HTMLButtonElement>, targetId: string) {
    const dragging = layerDragRef.current;
    if (!dragging || dragging.pageId !== state.activePageId || dragging.nodeId === targetId) {
      return;
    }
    const source = page?.nodes.find((item) => item.id === dragging.nodeId);
    const target = page?.nodes.find((item) => item.id === targetId);
    if (!source || !target || (source.groupId && source.groupId === target.groupId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < bounds.top + bounds.height / 2 ? "after" : "before";
    setLayerDrop((current) =>
      current?.id === targetId && current.position === position
        ? current
        : { id: targetId, position },
    );
  }

  function dropLayer(event: ReactDragEvent<HTMLButtonElement>, targetId: string) {
    const dragging = layerDragRef.current;
    if (!dragging || dragging.pageId !== state.activePageId) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < bounds.top + bounds.height / 2 ? "after" : "before";
    clearLayerDrag();
    moveLayerPrecisely(dragging.nodeId, targetId, position);
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
    const node = page?.nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    if (studioNodeLocked(node)) {
      editor.select(id, event.shiftKey);
      refresh();
      setNotice("该图元已锁定，请在图层列表中解锁后编辑");
      event.preventDefault();
      return;
    }
    if (event.shiftKey) {
      editor.select(id, true);
      refresh();
      event.preventDefault();
      return;
    }
    if (!editor.snapshot().selectedIds.includes(id)) editor.select(id);
    const selectedIds = editor.snapshot().selectedIds;
    if (page?.nodes.some((item) => selectedIds.includes(item.id) && studioNodeLocked(item))) {
      refresh();
      setNotice("所选内容包含已锁定图元，请先解锁");
      event.preventDefault();
      return;
    }
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
        snapshot.activePageId,
      );
      editor.moveBy(movement.dx, movement.dy);
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function beginGeometry(event: ReactPointerEvent<SVGElement>, handle: ResizeHandle | "rotate") {
    if (
      event.button !== 0 ||
      state.selectedIds.length !== 1 ||
      !selected ||
      studioNodeLocked(selected)
    )
      return;
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
    const node = snapshot.document.pages
      .find((item) => item.id === snapshot.activePageId)
      ?.nodes.find((item) => item.id === gesture.nodeId);
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
      const next = withNodeTransform(
        snapshot.document,
        gesture.nodeId,
        patch,
        snapshot.activePageId,
      );
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

  async function toggleAutoSave() {
    if (draftActionRef.current) return;
    draftActionRef.current = true;
    try {
      if (autoSaveSessionRef.current) {
        await pauseAutoSave();
        setNotice("自动保存已暂停，当前工程不会被自动写入");
        return;
      }
      const session = await DraftAutoSaveSession.open(drafts, editor.snapshot().document);
      if (
        session.hasExistingDraft &&
        !window.confirm("数据库已有草稿，开启自动保存后新修改将覆盖该版本。确认开启吗？")
      ) {
        return;
      }
      autoSaveSessionRef.current = session;
      setAutoSaveEnabled(true);
      setNotice("IndexedDB 自动保存已开启：修改后约 1 秒保存，刷新后仍需手动恢复");
    } catch (error) {
      setNotice("开启自动保存失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      draftActionRef.current = false;
    }
  }

  async function saveDraft() {
    if (draftActionRef.current) return;
    draftActionRef.current = true;
    try {
      await pauseAutoSave();
      const document = editor.snapshot().document;
      const current = await drafts.get(document.projectId);
      if (current && !window.confirm("数据库已有草稿，确认使用当前画面覆盖吗？")) return;
      const saved = await drafts.save(document, current?.revision ?? null);
      setHasSavedDraft(true);
      setNotice(`已保存 IndexedDB 草稿（${saved.savedAt}），并非正式工程发布`);
    } catch (error) {
      setNotice("保存草稿失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      draftActionRef.current = false;
    }
  }

  async function restoreDraft() {
    if (!window.confirm("恢复数据库草稿将替换当前画面并清空撤销历史，确认吗？")) return;
    if (draftActionRef.current) return;
    draftActionRef.current = true;
    try {
      await pauseAutoSave();
      const saved = await drafts.get(state.document.projectId);
      if (!saved) {
        setHasSavedDraft(false);
        setNotice("当前工程没有可恢复的数据库草稿");
        return;
      }
      editor.loadDocument(saved.document);
      clearLayerDrag();
      setLayerSearch("");
      setCollapsedGroupIds(new Set());
      setLocateLayerRequest(null);
      cancelDrag();
      refresh();
      setHasSavedDraft(true);
      setNotice(`已恢复 IndexedDB 草稿（保存于 ${saved.savedAt}）`);
    } catch (error) {
      setNotice("恢复草稿失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      draftActionRef.current = false;
    }
  }

  async function clearDraft() {
    if (!window.confirm("确定清除当前工程的 IndexedDB 草稿吗？当前画面不会改变。")) return;
    if (draftActionRef.current) return;
    draftActionRef.current = true;
    try {
      await pauseAutoSave();
      let current = null;
      try {
        current = await drafts.get(state.document.projectId);
      } catch (error) {
        if (!(error instanceof InvalidLegacyDraftError)) throw error;
        // 已经获得用户确认，允许清理损坏旧草稿；事务版本核对继续保护数据库。
      }
      await drafts.remove(state.document.projectId, current?.revision ?? null);
      setHasSavedDraft(false);
      setNotice("数据库草稿已清除，当前编辑画面保持不变");
    } catch (error) {
      setNotice("清除草稿失败：" + (error instanceof Error ? error.message : String(error)));
    } finally {
      draftActionRef.current = false;
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
      const parsed = JSON.parse(await file.text()) as unknown;
      await pauseAutoSave();
      const migratedFrom = editor.loadDocument(parsed);
      clearLayerDrag();
      setLayerSearch("");
      setCollapsedGroupIds(new Set());
      setLocateLayerRequest(null);
      setPreview(null);
      refresh();
      const draftWarning = await refreshDraftAvailability(editor.snapshot().document.projectId);
      setNotice(
        (migratedFrom
          ? `已将工程从 ${migratedFrom} 迁移至当前版本，请重新导出 JSON 草稿`
          : "工程 JSON 已校验并载入本地编辑器") + draftWarning,
      );
    } catch (error) {
      setNotice("导入失败：" + (error instanceof Error ? error.message : String(error)));
    }
  }

  function groupExpanded(groupId: string): boolean {
    return isLayerSearching || !collapsedGroupIds.has(groupId);
  }

  function groupToggleLabel(groupId: string): string {
    return `${groupExpanded(groupId) ? "折叠" : "展开"}组合 ${groupId}`;
  }

  function toggleLayerGroup(groupId: string) {
    setCollapsedGroupIds((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function locateSelectedLayer() {
    const node = page?.nodes.find((item) => item.id === state.selectedId);
    if (!node) {
      setNotice("请先选择需要定位的图元");
      return;
    }
    setLayerSearch("");
    if (node.groupId) {
      setCollapsedGroupIds((previous) => {
        if (!previous.has(node.groupId!)) return previous;
        const next = new Set(previous);
        next.delete(node.groupId!);
        return next;
      });
    }
    setLocateLayerRequest({ key: node.groupId ? `group:${node.groupId}` : `node:${node.id}` });
    setNotice("已定位选中图元所在图层");
  }

  function renderLayerButton(
    node: ScadaNode,
    kind: "group" | "member" | "node",
    group?: LayerTreeGroup,
  ) {
    const groupHeader = kind === "group" ? group : undefined;
    const groupId = groupHeader?.groupId;
    const rowKey = groupHeader ? `group:${groupId}` : `node:${node.id}`;
    const selectedRow = groupHeader
      ? page.nodes.some(
          (item) => item.groupId === groupId && state.selectedIds.includes(item.id),
        )
      : state.selectedIds.includes(node.id);
    const lockedRow = groupHeader ? groupHeader.hasLockedMember : studioNodeLocked(node);
    const hiddenRow = groupHeader
      ? groupHeader.hiddenCount === groupHeader.totalCount
      : !studioNodeVisible(node);
    const draggable =
      !studioNodeLocked(node) &&
      (node.groupId === undefined || !lockedLayerGroups.has(node.groupId));

    return (
      <button
        key={rowKey}
        type="button"
        className="studio-layer"
        data-layer-key={rowKey}
        data-selected={selectedRow}
        data-hidden={hiddenRow}
        data-locked={lockedRow}
        data-drop-position={layerDrop?.id === node.id ? layerDrop.position : undefined}
        draggable={draggable}
        title={groupHeader ? "拖动整个组合调整图层" : "拖动调整图层，组合会整体移动"}
        onDragStart={(event) => startLayerDrag(event, node.id)}
        onDragOver={(event) => overLayer(event, node.id)}
        onDrop={(event) => dropLayer(event, node.id)}
        onDragEnd={clearLayerDrag}
        onClick={(event) => select(node.id, event.shiftKey)}
      >
        <span className="studio-layer-identity">
          <span aria-hidden="true">⋮⋮</span>{" "}
          {groupHeader ? `组合 ${groupId}` : node.id}
        </span>
        <small>
          {groupHeader ? `${groupHeader.totalCount} 个成员` : node.type}
          {groupHeader && groupHeader.members.length !== groupHeader.totalCount
            ? ` · 匹配 ${groupHeader.members.length}`
            : ""}
          {groupHeader?.fragmented ? " · 层序不连续" : ""}
          {groupHeader?.hasLockedMember ? " · 有锁定成员" : ""}
          {groupHeader && groupHeader.hiddenCount > 0
            ? ` · 隐藏 ${groupHeader.hiddenCount}`
            : ""}
          {!groupHeader && studioNodeLocked(node) ? " · 已锁定" : ""}
          {!groupHeader && !studioNodeVisible(node) ? " · 已隐藏" : ""}
        </small>
      </button>
    );
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
          <button type="button" onClick={toggleAutoSave} aria-pressed={autoSaveEnabled}>
            {autoSaveEnabled ? "暂停自动保存" : "开启自动保存"}
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
        {hasSavedDraft && !autoSaveEnabled ? " · 已发现本地草稿，可点击「恢复草稿」确认加载" : ""}
      </p>
      <div className="studio-page-bar" aria-label="工程页面管理">
        <div className="studio-page-tabs" aria-label="工程页面">
          {state.document.pages.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={item.id === state.activePageId ? "page" : undefined}
              onClick={() => switchPage(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <div className="studio-page-actions">
          <button type="button" onClick={createPage} disabled={state.document.pages.length >= 100}>
            + 新建页面
          </button>
          <button
            type="button"
            onClick={duplicatePage}
            disabled={state.document.pages.length >= 100}
          >
            复制页面
          </button>
          <button
            type="button"
            onClick={() => movePage("previous")}
            disabled={activePageIndex <= 0}
          >
            页面前移
          </button>
          <button
            type="button"
            onClick={() => movePage("next")}
            disabled={activePageIndex >= state.document.pages.length - 1}
          >
            页面后移
          </button>
          <button type="button" onClick={renamePage}>
            重命名
          </button>
          <button type="button" onClick={deletePage} disabled={state.document.pages.length <= 1}>
            删除当前页
          </button>
        </div>
      </div>
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
          <div className="studio-copy-tools">
            <label className="studio-field">
              复制选中图元到
              <select
                aria-label="跨页面复制目标"
                value={copyTargetPageId}
                onChange={(event) => setPreferredCopyTargetPageId(event.target.value)}
                disabled={copyTargetPages.length === 0}
              >
                {copyTargetPages.length === 0 && <option value="">暂无其他页面</option>}
                {copyTargetPages.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={copySelectedToPage}
              disabled={state.selectedIds.length === 0 || !copyTargetPageId}
            >
              复制选中图元
            </button>
          </div>
          <div className="studio-tree-controls">
            <label className="studio-field">
              搜索图元或组合
              <input
                type="search"
                aria-label="搜索图层"
                maxLength={128}
                value={layerSearch}
                placeholder="图元 ID、类型、文字或组合 ID"
                onChange={(event) => setLayerSearch(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={state.selectedIds.length === 0}
              onClick={locateSelectedLayer}
            >
              定位选中图层
            </button>
          </div>
          <div className="studio-layer-tree" ref={layerTreeRef} aria-label="图层树">
            {layerEntries.length === 0 && (
              <p className="studio-tree-empty">
                {page.nodes.length === 0 ? "当前页面暂无图元" : "没有匹配的图元或组合"}
              </p>
            )}
            {layerEntries.map((entry) =>
              entry.kind === "node" ? (
                renderLayerButton(entry.node, "node")
              ) : (
                <div className="studio-tree-group" key={entry.groupId}>
                  <div className="studio-tree-group-heading">
                    <button
                      type="button"
                      className="studio-tree-toggle"
                      aria-label={groupToggleLabel(entry.groupId)}
                      aria-expanded={groupExpanded(entry.groupId)}
                      disabled={isLayerSearching}
                      onClick={() => toggleLayerGroup(entry.groupId)}
                    >
                      {groupExpanded(entry.groupId) ? "▾" : "▸"}
                    </button>
                    {renderLayerButton(
                      page.nodes.find((node) => node.id === entry.anchorNodeId) ??
                        entry.members[0]!,
                      "group",
                      entry,
                    )}
                  </div>
                  {groupExpanded(entry.groupId) && (
                    <div
                      className="studio-tree-members"
                      role="group"
                      aria-label={`组合 ${entry.groupId} 的成员`}
                    >
                      {entry.members.map((node) => renderLayerButton(node, "member"))}
                    </div>
                  )}
                </div>
              ),
            )}
          </div>

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
            {page.nodes.filter(studioNodeVisible).map((node) => {
              const displayNode =
                displayDocument.pages
                  .find((item) => item.id === state.activePageId)
                  ?.nodes.find((entry) => entry.id === node.id) ?? node;
              const t = displayNode.transform;
              return (
                <g
                  key={node.id}
                  transform={`rotate(${t.rotation} ${t.x + t.width / 2} ${t.y + t.height / 2})`}
                >
                  <rect
                    role="button"
                    tabIndex={0}
                    aria-label={
                      studioNodeLocked(node) ? `选择已锁定图元 ${node.id}` : `选择并拖动 ${node.id}`
                    }
                    data-locked={studioNodeLocked(node)}
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
                  {state.selectedIds.length === 1 &&
                    state.selectedId === node.id &&
                    !studioNodeLocked(node) && (
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
            <div className="studio-tool-group" aria-label="图层锁定与可见性">
              <button
                type="button"
                disabled={state.selectedIds.length === 0}
                onClick={() => changeSelectedLocked(true)}
              >
                锁定所选
              </button>
              <button
                type="button"
                disabled={state.selectedIds.length === 0}
                onClick={() => changeSelectedLocked(false)}
              >
                解锁所选
              </button>
              <button
                type="button"
                disabled={state.selectedIds.length === 0 || hasLockedSelection}
                onClick={() => changeSelectedVisible(false)}
              >
                隐藏所选
              </button>
              <button
                type="button"
                disabled={state.selectedIds.length === 0 || hasLockedSelection}
                onClick={() => changeSelectedVisible(true)}
              >
                显示所选
              </button>
            </div>
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
            <div className="studio-tool-group" aria-label="图元剪贴板">
              <button
                type="button"
                disabled={state.selectedIds.length === 0}
                onClick={() => apply(() => editor.copySelected(), "已复制所选图元到会话剪贴板")}
              >
                复制所选
              </button>
              <button
                type="button"
                disabled={state.selectedIds.length === 0}
                onClick={() => apply(() => editor.cutSelected(), "已剪切图元，可撤销")}
              >
                剪切所选
              </button>
              <button
                type="button"
                disabled={!state.hasClipboard}
                onClick={() => apply(() => editor.pasteClipboard(), "已粘贴图元，可撤销")}
              >
                粘贴图元
              </button>
              <button
                type="button"
                onClick={() => apply(() => editor.deleteSelected(), "已删除图元，可撤销")}
                disabled={state.selectedIds.length === 0}
              >
                删除所选
              </button>
            </div>
            <div className="studio-exact-layer" aria-label="图层精确插入">
              <label className="studio-field">
                目标图元
                <select
                  aria-label="图层插入目标"
                  value={layerTargetId}
                  disabled={!canPreciselyMove || layerTargetNodes.length === 0}
                  onChange={(event) => setPreferredLayerTargetId(event.target.value)}
                >
                  <option value="">请选择目标图元</option>
                  {layerTargetNodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.id}
                      {node.groupId ? "（组合）" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="studio-field">
                插入位置
                <select
                  aria-label="图层插入位置"
                  value={layerInsertPosition}
                  onChange={(event) =>
                    setLayerInsertPosition(event.target.value as "before" | "after")
                  }
                >
                  <option value="after">目标上方（更靠前）</option>
                  <option value="before">目标下方（更靠后）</option>
                </select>
              </label>
              <button
                type="button"
                disabled={!canPreciselyMove || !layerTargetId || !selected}
                onClick={() =>
                  selected && moveLayerPrecisely(selected.id, layerTargetId, layerInsertPosition)
                }
              >
                移动到指定层
              </button>
            </div>
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
                        disabled={studioNodeLocked(selected)}
                      />
                    </label>
                  ))}
                  <button type="submit" disabled={studioNodeLocked(selected)}>
                    应用几何属性
                  </button>
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
                    disabled={studioNodeLocked(selected)}
                    onChange={(event) => setLabelDraft(event.target.value)}
                  />
                  <button type="button" onClick={changeLabel} disabled={studioNodeLocked(selected)}>
                    应用文案
                  </button>
                </label>
              )}
              <h3>Tag 绑定（模拟数据）</h3>
              {bindingSlot ? (
                <label className="studio-field">
                  {bindingSlot} · 选择模拟 Tag
                  <select
                    aria-label={selected.id + " 的 " + bindingSlot + " Tag 绑定"}
                    value={currentBindingTag}
                    onChange={(event) => changeTagBinding(bindingSlot, event.target.value)}
                  >
                    <option value="">不绑定</option>
                    {missingBindingTag && (
                      <option value={currentBindingTag} disabled>
                        {currentBindingTag}（不在当前模拟候选中）
                      </option>
                    )}
                    {demoTagCandidates.map((option) => (
                      <option key={option.tagId} value={option.tagId}>
                        {option.label} · {option.tagId}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="studio-tip">
                  请单选未组合的水箱、水泵或文本图元；管道暂不支持动态 Tag 绑定。
                </p>
              )}
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
        V0.2 · 框选/快捷键：Ctrl+A 全选，Ctrl+C 复制，Ctrl+X 剪切，Ctrl+V 粘贴，Ctrl+Z
        撤销，Ctrl+Shift+Z/Ctrl+Y 重做，方向键微移，Shift+方向键移动 10 格，Esc 取消选择 ·
        无设备写入
      </footer>
    </main>
  );
}
