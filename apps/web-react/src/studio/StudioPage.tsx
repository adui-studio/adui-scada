import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Checkbox, Collapse, Dropdown, Input, Popup, Select, Upload } from "tdesign-react";
import type { DropdownProps } from "tdesign-react";
import { CloseIcon } from "tdesign-icons-react";
import "tdesign-react/es/style/index.css";
import type {
  DragEvent as ReactDragEvent,
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  TAG_DATA_TYPE_LABELS,
  tagDefinitionSupportsSlot,
  WaterTreatmentSimulator,
  waterTreatmentStudioDocument,
  DraftAutoSaveSession,
  LOCAL_DRAFT_AUTO_SAVE_DELAY_MS,
  studioNodeLocked,
  studioNodeVisible,
  buildLayerTree,
  studioViewportRect,
  studioFocusTransform,
  STUDIO_CANVAS_FIT_MARGIN,
  compareProjectDocuments,
  validateProjectReleasePreflight,
} from "@adui/scada-core";
import type {
  LayerTreeGroup,
  ProjectSnapshot,
  ProjectVersionSummary,
  ScadaDocument,
  ScadaNode,
} from "@adui/scada-core";
import {
  DexieDraftRepository,
  DexieProjectVersionRepository,
  InvalidLegacyDraftError,
} from "@adui/scada-draft-storage";
import {
  DEFAULT_GRID_SIZE,
  GEOMETRY_PROPERTY_FIELDS,
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
import {
  createScadaApiClient,
  createStudioServerProjectSession,
  isScadaAccessRejection,
  ScadaApiError,
} from "@adui/scada-api-client";
import { confirmStudioAction, promptStudioPageName } from "./StudioDialog.tsx";
import { TagManager } from "./TagManager.tsx";
import { ServerProjectBrowser } from "./ServerProjectBrowser.tsx";
import { ServerReleasePreflight } from "./ServerReleasePreflight.tsx";
import "@adui/tailwind/studio.css";

const previewTags = new WaterTreatmentSimulator().next(new Date("2026-11-09T00:00:00Z"));
function getLegacyStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
const drafts = new DexieDraftRepository({ legacyStorage: getLegacyStorage() });
const projectVersions = new DexieProjectVersionRepository();
const HISTORY_PAGE_SIZE = 10;
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

interface GeometryDragState {
  pointerId: number;
  nodeId: string;
  handle: ResizeHandle | "rotate";
  startX: number;
  startY: number;
  lastPatch: NodeTransformPatch | null;
}

export default function StudioPage() {
  const editor = useMemo(() => new DocumentEditor(waterTreatmentStudioDocument), []);
  const serverApi = useMemo(() => createScadaApiClient(), []);
  const serverSession = useMemo(() => createStudioServerProjectSession(serverApi), [serverApi]);
  const [state, setState] = useState<EditorSnapshot>(() => editor.snapshot());
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [geometryPreview, setGeometryPreview] = useState<ScadaDocument | null>(null);
  const [rotating, setRotating] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [preferredCopyTargetPageId, setPreferredCopyTargetPageId] = useState("");
  const [preferredLayerTargetId, setPreferredLayerTargetId] = useState("");
  const [layerSearch, setLayerSearch] = useState("");
  const [inspectorTab, setInspectorTab] = useState<"properties" | "tags">("properties");
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set());
  const [locateLayerRequest, setLocateLayerRequest] = useState<{ key: string } | null>(null);
  const [layerInsertPosition, setLayerInsertPosition] = useState<"before" | "after">("after");
  const [layerDrop, setLayerDrop] = useState<{ id: string; position: "before" | "after" } | null>(
    null,
  );
  const [notice, setNotice] = useState("可保存浏览器本地草稿 · 服务端工程需单独验证登录");
  const [hasSavedDraft, setHasSavedDraft] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const [historyRows, setHistoryRows] = useState<readonly ProjectVersionSummary[]>([]);
  const [historyProjectId, setHistoryProjectId] = useState("");
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [inspectedVersion, setInspectedVersion] = useState<ProjectSnapshot | null>(null);
  const [serverIdentity, setServerIdentity] = useState("尚未检查服务端身份");
  const [serverProjectId, setServerProjectId] = useState("");
  const [serverHeadRevision, setServerHeadRevision] = useState<number | null>(null);
  const [serverRows, setServerRows] = useState<readonly ProjectVersionSummary[]>([]);
  const [serverHasMore, setServerHasMore] = useState(false);
  const [serverError, setServerError] = useState("");
  const [serverRecoveryProjectId, setServerRecoveryProjectId] = useState("");
  const [serverAccessRevision, setServerAccessRevision] = useState(0);
  const [serverInspectedVersion, setServerInspectedVersion] = useState<ProjectSnapshot | null>(
    null,
  );
  const resumeValidationRef = useRef(false);
  const historyActionRef = useRef(false);
  const autoSaveSessionRef = useRef<DraftAutoSaveSession | null>(null);
  const draftActionRef = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [canvasTool, setCanvasTool] = useState<"select" | "hand">("select");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [gridVisible, setGridVisible] = useState(true);
  const [gridSnap, setGridSnap] = useState(true);
  const [nodeSnap, setNodeSnap] = useState(true);
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [leftPanelWidth, setLeftPanelWidth] = useState(256);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const panelResizeRef = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    scale: number;
  } | null>(null);
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
  const visibleHistoryRows = historyProjectId === state.document.projectId ? historyRows : [];
  const visibleServerRows = serverProjectId === state.document.projectId ? serverRows : [];
  const activeServerBaseline = serverSession.getBaselineRevision(state.document.projectId);
  const serverComparison = useMemo(
    () =>
      serverInspectedVersion?.projectId === state.document.projectId
        ? compareProjectDocuments(state.document, serverInspectedVersion.document)
        : null,
    [state.document, serverInspectedVersion],
  );
  const historyComparison = useMemo(
    () =>
      inspectedVersion?.projectId === state.document.projectId
        ? compareProjectDocuments(state.document, inspectedVersion.document)
        : null,
    [state.document, inspectedVersion],
  );
  const releasePreflight = useMemo(
    () => validateProjectReleasePreflight(state.document),
    [state.document],
  );
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
    () => svgDataUrl(displayDocument, previewTags, state.activePageId, "light"),
    [displayDocument, state.activePageId],
  );

  if (!page) throw new Error("工程文档不包含页面");
  const canvasViewport = {
    width: viewportSize.width || page.size.width,
    height: viewportSize.height || page.size.height,
  };
  const visibleRect = studioViewportRect(
    page.size,
    canvasViewport,
    zoom,
    pan,
    STUDIO_CANVAS_FIT_MARGIN,
  );
  const worldPerPixel = visibleRect.width / canvasViewport.width;
  const actualZoomPercent = Math.max(1, Math.round(100 / worldPerPixel));

  const hasGroupedSelection = page.nodes.some(
    (node) => node.groupId !== undefined && state.selectedIds.includes(node.id),
  );
  const hasLockedSelection = page.nodes.some(
    (node) => state.selectedIds.includes(node.id) && studioNodeLocked(node),
  );
  const canGroup = state.selectedIds.length >= 2 && !hasGroupedSelection && !hasLockedSelection;
  const layerEntries = buildLayerTree(page.nodes, layerSearch);
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
    const canvas = svgRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      setViewportSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

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
  const pageMenuOptions: NonNullable<DropdownProps["options"]> = [
    {
      content: "+ 新建页面",
      value: "create",
      disabled: state.document.pages.length >= 100,
    },
    {
      content: "复制页面",
      value: "duplicate",
      disabled: state.document.pages.length >= 100,
    },
    { content: "页面前移", value: "previous", disabled: activePageIndex <= 0 },
    {
      content: "页面后移",
      value: "next",
      disabled: activePageIndex >= state.document.pages.length - 1,
    },
    { content: "重命名", value: "rename" },
    { content: "删除当前页", value: "delete", disabled: state.document.pages.length <= 1 },
  ];
  const copyTargetPages = state.document.pages.filter((item) => item.id !== state.activePageId);
  const copyTargetPageId = copyTargetPages.some((item) => item.id === preferredCopyTargetPageId)
    ? preferredCopyTargetPageId
    : (copyTargetPages[0]?.id ?? "");
  const bindingSlot =
    state.selectedIds.length === 1 && selected && !selected.groupId && !studioNodeLocked(selected)
      ? editableTagSlot(selected.type)
      : null;
  const tagCandidates =
    bindingSlot === null
      ? []
      : state.document.tags.filter((definition) =>
          tagDefinitionSupportsSlot(definition, bindingSlot),
        );
  const currentBindingTag = bindingSlot ? (selected?.bindings[bindingSlot]?.tagId ?? "") : "";
  const missingBindingTag =
    currentBindingTag !== "" && !tagCandidates.some((option) => option.tagId === currentBindingTag);
  const selectedTagDefinition = state.document.tags.find(
    (definition) => definition.tagId === currentBindingTag,
  );

  function switchPage(pageId: string) {
    try {
      if (!editor.switchPage(pageId)) return;
      clearLayerDrag();
      setLayerSearch("");
      setLocateLayerRequest(null);
      cancelDrag();
      setZoom(1);
      setPan({ x: 0, y: 0 });
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

  async function renamePage() {
    if (!page) return;
    const name = await promptStudioPageName(page.name);
    if (name === null) return;
    apply(() => editor.renamePage(page.id, name), "页面已重命名，可撤销");
  }

  async function deletePage() {
    if (
      !page ||
      !(await confirmStudioAction("确定删除页面“" + page.name + "”及其图元吗？可撤销。"))
    ) {
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

  const handlePageMenuClick: NonNullable<DropdownProps["onClick"]> = ({ value }) => {
    switch (value) {
      case "create":
        createPage();
        break;
      case "duplicate":
        duplicatePage();
        break;
      case "previous":
        movePage("previous");
        break;
      case "next":
        movePage("next");
        break;
      case "rename":
        void renamePage();
        break;
      case "delete":
        void deletePage();
        break;
    }
  };

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

  function changeProjectTag(action: () => boolean, message: string): boolean {
    try {
      const changed = action();
      if (changed) refresh();
      setNotice(changed ? message : "项目 Tag 定义未发生变化");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      return false;
    }
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
          if (
            (key === "v" || key === "h") &&
            !event.shiftKey &&
            event.target instanceof Element &&
            event.target.closest(".studio-canvas-scroll")
          ) {
            setCanvasTool(key === "v" ? "select" : "hand");
            event.preventDefault();
            return;
          }
          if (key === "escape") {
            panDragRef.current = null;
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
    setCanvasTool("select");
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

  function startLayerDrag(event: ReactDragEvent<HTMLElement>, nodeId: string) {
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

  function overLayer(event: ReactDragEvent<HTMLElement>, targetId: string) {
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

  function dropLayer(event: ReactDragEvent<HTMLElement>, targetId: string) {
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
    const pageSize = page?.size;
    if (!pageSize) return;
    const nextZoom = Math.max(0.5, Math.min(8, Math.round((zoom + delta) * 100) / 100));
    setZoom(nextZoom);
    setPan(
      (current) =>
        studioViewportRect(pageSize, canvasViewport, nextZoom, current, STUDIO_CANVAS_FIT_MARGIN)
          .pan,
    );
  }

  function resizePanel(side: "left" | "right", width: number) {
    const next = Math.round(width);
    if (side === "left") setLeftPanelWidth(Math.max(200, Math.min(340, next)));
    else setRightPanelWidth(Math.max(260, Math.min(420, next)));
  }

  function beginPanelResize(event: ReactPointerEvent<HTMLDivElement>, side: "left" | "right") {
    if (event.button !== 0) return;
    const panel = event.currentTarget.parentElement?.querySelector(
      side === "left" ? ".studio-panel-layers" : ".studio-panel-properties",
    );
    if (!panel) return;
    panelResizeRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      width: panel.getBoundingClientRect().width,
    };
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function updatePanelResize(event: ReactPointerEvent<HTMLDivElement>, side: "left" | "right") {
    const drag = panelResizeRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    resizePanel(side, drag.width + (event.clientX - drag.x) * (side === "left" ? 1 : -1));
  }

  function endPanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (panelResizeRef.current?.pointerId === event.pointerId) panelResizeRef.current = null;
  }

  function resizePanelByKey(event: ReactKeyboardEvent<HTMLDivElement>, side: "left" | "right") {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const width = side === "left" ? leftPanelWidth : rightPanelWidth;
    resizePanel(side, width + direction * (side === "left" ? 10 : -10));
    event.preventDefault();
    event.stopPropagation();
  }

  function focusSelectedNode() {
    if (!page || !selected || !studioNodeVisible(selected)) return;
    const focus = studioFocusTransform(
      page.size,
      canvasViewport,
      selected.transform,
      STUDIO_CANVAS_FIT_MARGIN,
    );
    setZoom(focus.zoom);
    setPan(focus.pan);
  }

  function resetCanvasView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  // 抓手、中键或 Alt + 空白处拖动只修改视区；捕获阶段先于图元编辑。
  function beginCanvasPan(event: ReactPointerEvent<SVGSVGElement>): boolean {
    if (
      !(
        event.button === 1 ||
        (event.button === 0 &&
          (canvasTool === "hand" || (event.altKey && event.target === event.currentTarget)))
      )
    ) {
      return false;
    }
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix || matrix.a === 0) return false;
    panDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: visibleRect.pan.x,
      originY: visibleRect.pan.y,
      scale: matrix.a,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    return true;
  }

  function updateCanvasPan(event: ReactPointerEvent<SVGSVGElement>): boolean {
    const dragging = panDragRef.current;
    const pageSize = page?.size;
    if (!dragging || dragging.pointerId !== event.pointerId || !pageSize) return false;
    setPan(
      studioViewportRect(
        pageSize,
        canvasViewport,
        zoom,
        {
          x: dragging.originX - (event.clientX - dragging.startX) / dragging.scale,
          y: dragging.originY - (event.clientY - dragging.startY) / dragging.scale,
        },
        STUDIO_CANVAS_FIT_MARGIN,
      ).pan,
    );
    return true;
  }

  function finishCanvasPan(event: ReactPointerEvent<SVGSVGElement>): boolean {
    if (!panDragRef.current || panDragRef.current.pointerId !== event.pointerId) return false;
    panDragRef.current = null;
    return true;
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
    panDragRef.current = null;
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
    for (const [key, label] of GEOMETRY_PROPERTY_FIELDS) {
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

  async function runHistoryAction(
    label: string,
    action: () => Promise<void>,
    lockDraft = false,
  ): Promise<void> {
    if (historyActionRef.current || draftActionRef.current) return;
    historyActionRef.current = true;
    if (lockDraft) draftActionRef.current = true;
    setHistoryBusy(true);
    setHistoryError("");
    try {
      await action();
    } catch (error) {
      const message = label + "失败：" + (error instanceof Error ? error.message : String(error));
      setHistoryError(message);
      setNotice(message);
    } finally {
      historyActionRef.current = false;
      if (lockDraft) draftActionRef.current = false;
      setHistoryBusy(false);
    }
  }

  /** 工程管理、版本查询和保存共用的授权缓存失效处理。 */
  const invalidateServerAccess = useCallback((): void => {
    serverSession.invalidateAccess();
    setServerProjectId("");
    setServerHeadRevision(null);
    setServerRows([]);
    setServerHasMore(false);
    setServerInspectedVersion(null);
    setServerRecoveryProjectId("");
    setServerAccessRevision((revision) => revision + 1);
  }, [serverSession]);

  /** 从其他标签页返回时以真实服务端只读核对旧 CAS，不依赖本地跨页身份消息。 */
  useEffect(() => {
    const lifecycle = new AbortController();
    const revalidateOnVisible = () => {
      if (
        document.visibilityState !== "visible" ||
        resumeValidationRef.current ||
        historyActionRef.current ||
        draftActionRef.current
      ) {
        return;
      }
      const projectId = editor.snapshot().document.projectId;
      if (serverSession.getBaselineRevision(projectId) === null) return;
      resumeValidationRef.current = true;
      void serverSession
        .revalidateBaseline(projectId)
        .catch((error: unknown) => {
          if (lifecycle.signal.aborted || editor.snapshot().document.projectId !== projectId)
            return;
          const accessRejected = isScadaAccessRejection(error);
          const revisionConflict = error instanceof ScadaApiError && error.kind === "conflict";
          if (accessRejected) {
            invalidateServerAccess();
            setServerIdentity(
              error.kind === "unauthenticated"
                ? "未登录或服务端尚未启用身份接口"
                : "服务端身份或工程授权已变化",
            );
          } else if (revisionConflict) {
            setServerRecoveryProjectId(projectId);
            setServerHeadRevision(null);
            setServerRows([]);
            setServerHasMore(false);
            setServerInspectedVersion(null);
          }
          if (error instanceof ScadaApiError && (accessRejected || revisionConflict)) {
            setServerError(error.message);
            setNotice("标签页恢复校验发现变更：" + error.message + "；本地画布与草稿不变");
          } else if (error instanceof ScadaApiError && error.kind === "network") {
            setNotice("暂时无法复核服务端状态；原 CAS 基线保留，保存时仍需服务器校验");
          }
        })
        .finally(() => {
          resumeValidationRef.current = false;
        });
    };
    document.addEventListener("visibilitychange", revalidateOnVisible);
    return () => {
      lifecycle.abort();
      document.removeEventListener("visibilitychange", revalidateOnVisible);
    };
  }, [editor, invalidateServerAccess, serverSession]);

  function handleServerBrowserAccessRejected(error: ScadaApiError): void {
    invalidateServerAccess();
    setServerError(error.message);
    setNotice("授权工程列表访问失败：" + error.message + "；本地画布与草稿不变");
    if (error.kind === "unauthenticated" || error.kind === "not_found") {
      setServerIdentity("未登录或服务端尚未启用身份接口");
    }
  }

  async function runServerAction(
    label: string,
    action: () => Promise<void>,
    lockDraft = false,
  ): Promise<void> {
    const actionProjectId = editor.snapshot().document.projectId;
    await runHistoryAction(
      label,
      async () => {
        setServerError("");
        setServerRecoveryProjectId("");
        try {
          await action();
        } catch (error) {
          setServerError(error instanceof Error ? error.message : "服务端操作失败");
          if (error instanceof ScadaApiError && error.kind === "conflict") {
            setServerRecoveryProjectId(actionProjectId);
          }
          if (isScadaAccessRejection(error)) invalidateServerAccess();
          if (
            error instanceof ScadaApiError &&
            (error.kind === "unauthenticated" ||
              (label === "检查服务端身份" && error.status === 404))
          ) {
            setServerIdentity("未登录或服务端尚未启用身份接口");
          }
          throw error;
        }
      },
      lockDraft,
    );
  }

  async function checkServerIdentity(): Promise<void> {
    await runServerAction("检查服务端身份", async () => {
      await serverApi.getMe();
      setServerIdentity("服务端身份已验证");
      setNotice("服务端身份已验证；仅允许经授权的工程版本操作");
    });
  }

  async function saveServerProject(): Promise<void> {
    await runServerAction(
      "保存服务端工程",
      async () => {
        const document = editor.snapshot().document;
        const result = await serverSession.saveDocument(document);
        if (editor.snapshot().document.projectId !== document.projectId) return;
        setServerIdentity("服务端身份已验证");
        setServerRecoveryProjectId("");
        setServerProjectId(document.projectId);
        setServerHeadRevision(result.revision);
        setServerRows([]);
        setServerHasMore(false);
        setServerInspectedVersion(null);
        setNotice(
          result.created
            ? `已创建服务端工程版本 #${result.revision}；IndexedDB 草稿保持不变`
            : `已追加服务端版本 #${result.revision}；本地草稿未删除，不代表正式发布`,
        );
      },
      true,
    );
  }

  async function refreshServerHistory(): Promise<void> {
    await runServerAction("查询服务端版本", async () => {
      const projectId = editor.snapshot().document.projectId;
      const [summary, rows] = await Promise.all([
        serverApi.getProject(projectId),
        serverApi.listVersions(projectId, { limit: HISTORY_PAGE_SIZE }),
      ]);
      if (editor.snapshot().document.projectId !== projectId) return;
      setServerProjectId(projectId);
      setServerHeadRevision(summary.headRevision);
      setServerRows(rows);
      setServerHasMore(rows.length === HISTORY_PAGE_SIZE);
      setServerInspectedVersion(null);
      setNotice("已读取服务端工程版本摘要；当前画布和 IndexedDB 草稿均未改变");
    });
  }

  /** 冲突恢复仅只读核验与预览，实际载入必须由用户再次确认。 */
  async function previewServerConflict(): Promise<void> {
    await runServerAction(
      "只读预览最新服务端版本",
      async () => {
        const projectId = editor.snapshot().document.projectId;
        const version = await serverSession.previewLatestVersion(projectId);
        const rows = await serverApi.listVersions(projectId, { limit: HISTORY_PAGE_SIZE });
        if (editor.snapshot().document.projectId !== projectId) return;
        if (rows[0]?.revision !== version.headRevision) {
          throw new ScadaApiError("服务端历史版本又有更新，请重新只读预览", "conflict", 409);
        }
        setServerIdentity("服务端身份已验证");
        setServerProjectId(projectId);
        setServerHeadRevision(version.headRevision);
        setServerRows(rows);
        setServerHasMore(rows.length === HISTORY_PAGE_SIZE);
        setServerInspectedVersion(version.snapshot);
        setServerRecoveryProjectId("");
        setNotice(
          `已只读核验服务端最新版本 #${version.headRevision}；当前画布与草稿不变，载入前须再次确认`,
        );
      },
      true,
    );
  }

  async function loadMoreServerVersions(): Promise<void> {
    if (serverProjectId !== editor.snapshot().document.projectId) return;
    const last = serverRows[serverRows.length - 1];
    if (!last) return;
    await runServerAction("查询更早服务端版本", async () => {
      const rows = await serverApi.listVersions(serverProjectId, {
        limit: HISTORY_PAGE_SIZE,
        beforeRevision: last.revision,
      });
      if (editor.snapshot().document.projectId !== serverProjectId) return;
      setServerRows((previous) => [...previous, ...rows]);
      setServerHasMore(rows.length === HISTORY_PAGE_SIZE);
    });
  }

  async function inspectServerVersion(revision: number): Promise<void> {
    await runServerAction("查看服务端版本", async () => {
      const projectId = editor.snapshot().document.projectId;
      const result = await serverSession.readVersion(projectId, revision);
      if (editor.snapshot().document.projectId !== projectId) return;
      setServerInspectedVersion(result.snapshot);
      setServerHeadRevision(result.headRevision);
      setNotice(`已核验服务端版本 #${revision} 的 SHA-256，当前画布与草稿未改变`);
    });
  }

  async function loadServerVersion(revision: number): Promise<void> {
    await runServerAction(
      "载入服务端版本",
      async () => {
        const projectId = editor.snapshot().document.projectId;
        const result = await serverSession.readVersion(projectId, revision);
        if (editor.snapshot().document.projectId !== projectId) {
          throw new TypeError("当前工程已切换，拒绝载入其他工程的服务端历史");
        }
        if (
          !(await confirmStudioAction(
            `载入服务端版本 #${revision} 将替换当前画布并清空撤销历史。IndexedDB 草稿不会被清除，未保存的画布修改可能丢失，建议先保存草稿。确认继续吗？`,
          ))
        ) {
          return;
        }
        await serverSession.revalidateConfirmedLoad(result);
        if (editor.snapshot().document.projectId !== projectId) {
          throw new TypeError("确认载入期间当前工程已变化，拒绝覆盖本地画布");
        }
        await pauseAutoSave();
        editor.loadDocument(result.snapshot.document);
        serverSession.acceptLoadedVersion(result);
        setServerRecoveryProjectId("");
        clearLayerDrag();
        setLayerSearch("");
        setCollapsedGroupIds(new Set());
        setLocateLayerRequest(null);
        cancelDrag();
        refresh();
        setServerProjectId(projectId);
        setServerHeadRevision(result.headRevision);
        setServerInspectedVersion(null);
        const warning = await refreshDraftAvailability(projectId);
        setNotice(
          result.snapshot.revision === result.headRevision
            ? `已载入服务端最新版本 #${revision}，可按此修订号 CAS 保存；自动保存已暂停，本地草稿未覆盖` +
                warning
            : `已载入较早的服务端版本 #${revision}；不能直接覆盖最新版本，自动保存已暂停` + warning,
        );
      },
      true,
    );
  }

  async function openServerProject(projectId: string, headRevision: number): Promise<void> {
    await runServerAction(
      "打开服务端工程",
      async () => {
        const originalProjectId = editor.snapshot().document.projectId;
        const version = await serverSession.readVersion(projectId, headRevision);
        if (editor.snapshot().document.projectId !== originalProjectId) {
          throw new TypeError("当前编辑工程已发生变化，请重新选择服务端工程");
        }
        if (
          version.headRevision !== headRevision ||
          version.snapshot.revision !== version.headRevision
        ) {
          throw new ScadaApiError(
            "服务端工程版本已更新，请刷新工程列表后重新选择",
            "conflict",
            409,
          );
        }
        if (
          !(await confirmStudioAction(
            `打开工程“${projectId}”的最新版本 #${headRevision} 将替换当前画布、清空撤销历史并暂停自动保存。未保存的画布修改可能丢失；IndexedDB 草稿及本地历史不会被删除。请先保存需要保留的修改，确认打开吗？`,
          ))
        ) {
          return;
        }
        await serverSession.revalidateConfirmedLoad(version);
        if (editor.snapshot().document.projectId !== originalProjectId) {
          throw new TypeError("确认打开期间当前工程已变化，拒绝覆盖本地画布");
        }
        await pauseAutoSave();
        editor.loadDocument(version.snapshot.document);
        serverSession.acceptLoadedVersion(version);
        clearLayerDrag();
        setLayerSearch("");
        setCollapsedGroupIds(new Set());
        setLocateLayerRequest(null);
        cancelDrag();
        refresh();
        setHistoryProjectId("");
        setHistoryRows([]);
        setHistoryHasMore(false);
        setInspectedVersion(null);
        setServerProjectId(projectId);
        setServerHeadRevision(version.headRevision);
        setServerRows([]);
        setServerHasMore(false);
        setServerInspectedVersion(null);
        setServerIdentity("服务端身份已验证");
        const warning = await refreshDraftAvailability(projectId);
        setNotice(
          `已打开服务端工程“${projectId}”最新版本 #${version.headRevision}；CAS 基线已建立，自动保存已暂停，IndexedDB 草稿未删除` +
            warning,
        );
      },
      true,
    );
  }

  async function refreshVersionHistory(): Promise<void> {
    await runHistoryAction("读取历史版本", async () => {
      const projectId = editor.snapshot().document.projectId;
      const rows = await projectVersions.list(projectId, { limit: HISTORY_PAGE_SIZE });
      if (editor.snapshot().document.projectId !== projectId) return;
      setHistoryProjectId(projectId);
      setHistoryRows(rows);
      setHistoryHasMore(rows.length === HISTORY_PAGE_SIZE);
      setInspectedVersion(null);
    });
  }

  async function loadMoreVersions(): Promise<void> {
    if (historyProjectId !== editor.snapshot().document.projectId) return;
    const last = historyRows[historyRows.length - 1];
    if (!last) return;
    await runHistoryAction("读取更多历史版本", async () => {
      const rows = await projectVersions.list(historyProjectId, {
        limit: HISTORY_PAGE_SIZE,
        beforeRevision: last.revision,
      });
      if (editor.snapshot().document.projectId !== historyProjectId) return;
      setHistoryRows((previous) => [...previous, ...rows]);
      setHistoryHasMore(rows.length === HISTORY_PAGE_SIZE);
    });
  }

  async function createHistoryVersion(): Promise<void> {
    await runHistoryAction("创建历史快照", async () => {
      const document = editor.snapshot().document;
      const expectedRevision = await projectVersions.getHeadRevision(document.projectId);
      const saved = await projectVersions.append(document, expectedRevision);
      const rows = await projectVersions.list(document.projectId, { limit: HISTORY_PAGE_SIZE });
      if (editor.snapshot().document.projectId !== document.projectId) return;
      setHistoryProjectId(document.projectId);
      setHistoryRows(rows);
      setHistoryHasMore(rows.length === HISTORY_PAGE_SIZE);
      setInspectedVersion(saved);
      setNotice(`已创建本地历史版本 #${saved.revision}，不代表工程发布`);
    });
  }

  async function inspectHistoryVersion(revision: number): Promise<void> {
    await runHistoryAction("查看版本差异", async () => {
      const projectId = editor.snapshot().document.projectId;
      const saved = await projectVersions.get(projectId, revision);
      if (!saved) throw new TypeError("指定的历史版本不存在");
      if (editor.snapshot().document.projectId !== projectId) return;
      setInspectedVersion(saved);
      setNotice(`已查看本地版本 #${revision} 的数据差异，当前画面未改变`);
    });
  }

  async function loadHistoryVersion(revision: number): Promise<void> {
    await runHistoryAction(
      "载入历史版本",
      async () => {
        const projectId = editor.snapshot().document.projectId;
        const saved = await projectVersions.get(projectId, revision);
        if (!saved) throw new TypeError("指定的历史版本不存在");
        if (editor.snapshot().document.projectId !== projectId) {
          throw new TypeError("当前工程已切换，拒绝载入其他工程的历史版本");
        }
        if (
          !(await confirmStudioAction(
            `载入本地历史版本 #${revision} 将替换当前画面并清空撤销历史，未保存的修改可能丢失。建议先导出 JSON 备份。确认继续吗？`,
          ))
        ) {
          return;
        }
        await pauseAutoSave();
        editor.loadDocument(saved.document);
        serverSession.reset();
        clearLayerDrag();
        setLayerSearch("");
        setCollapsedGroupIds(new Set());
        setLocateLayerRequest(null);
        cancelDrag();
        refresh();
        setInspectedVersion(null);
        const warning = await refreshDraftAvailability(projectId);
        setNotice(
          `已载入本地版本 #${revision}，尚未保存草稿；自动保存已暂停，未进行正式发布` + warning,
        );
      },
      true,
    );
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
        !(await confirmStudioAction(
          "数据库已有草稿，开启自动保存后新修改将覆盖该版本。确认开启吗？",
        ))
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
      if (current && !(await confirmStudioAction("数据库已有草稿，确认使用当前画面覆盖吗？")))
        return;
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
    if (!(await confirmStudioAction("恢复数据库草稿将替换当前画面并清空撤销历史，确认吗？")))
      return;
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
      serverSession.reset();
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
    if (!(await confirmStudioAction("确定清除当前工程的 IndexedDB 草稿吗？当前画面不会改变。")))
      return;
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

  async function importJsonFile(file: File | undefined) {
    if (!file) return;
    if (historyActionRef.current || draftActionRef.current) {
      setNotice("已有工程操作正在进行，请完成后再导入 JSON");
      return;
    }
    // 文件读取是异步的，导入期间必须占用草稿操作门闩，禁止历史载入插入。
    draftActionRef.current = true;
    try {
      if (file.size > maxFileSize) throw new RangeError("JSON 文件不能超过 2 MiB");
      const parsed = JSON.parse(await file.text()) as unknown;
      await pauseAutoSave();
      const migratedFrom = editor.loadDocument(parsed);
      serverSession.reset();
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
    } finally {
      draftActionRef.current = false;
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
      ? (page?.nodes.some(
          (item) => item.groupId === groupId && state.selectedIds.includes(item.id),
        ) ?? false)
      : state.selectedIds.includes(node.id);
    const lockedRow = groupHeader ? groupHeader.hasLockedMember : studioNodeLocked(node);
    const hiddenRow = groupHeader
      ? groupHeader.hiddenCount === groupHeader.totalCount
      : !studioNodeVisible(node);
    const draggable =
      !studioNodeLocked(node) &&
      (node.groupId === undefined || !lockedLayerGroups.has(node.groupId));

    return (
      <Button
        tag="button"
        key={rowKey}
        type="button"
        theme="default"
        variant="text"
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
          <span aria-hidden="true">⋮⋮</span> {groupHeader ? `组合 ${groupId}` : node.id}
        </span>
        <small>
          {groupHeader ? `${groupHeader.totalCount} 个成员` : node.type}
          {groupHeader && groupHeader.members.length !== groupHeader.totalCount
            ? ` · 匹配 ${groupHeader.members.length}`
            : ""}
          {groupHeader?.fragmented ? " · 层序不连续" : ""}
          {groupHeader?.hasLockedMember ? " · 有锁定成员" : ""}
          {groupHeader && groupHeader.hiddenCount > 0 ? ` · 隐藏 ${groupHeader.hiddenCount}` : ""}
          {!groupHeader && studioNodeLocked(node) ? " · 已锁定" : ""}
          {!groupHeader && !studioNodeVisible(node) ? " · 已隐藏" : ""}
        </small>
      </Button>
    );
  }

  return (
    <main
      id="scada-main-content"
      tabIndex={-1}
      className="studio-shell flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden"
    >
      <header className="studio-toolbar">
        <div>
          <p className="scada-eyebrow">组态编辑 / 本地工作区</p>
          <h1>{state.document.projectId}</h1>
        </div>
        <div className="studio-actions">
          <div className="studio-history-actions">
            <Button
              tag="button"
              type="button"
              onClick={() => {
                editor.undo();
                refresh();
              }}
              disabled={!state.canUndo}
            >
              撤销
            </Button>
            <Button
              tag="button"
              type="button"
              onClick={() => {
                editor.redo();
                refresh();
              }}
              disabled={!state.canRedo}
            >
              重做
            </Button>
          </div>
          <div className="studio-save-actions">
            <Button tag="button" type="button" onClick={saveDraft}>
              保存草稿
            </Button>
          </div>
          <div className="studio-file-menu">
            <Popup
              attach=".studio-file-menu"
              trigger="click"
              placement="bottom-right"
              content={
                <div className="studio-file-popover">
                  <Button
                    tag="button"
                    type="button"
                    onClick={toggleAutoSave}
                    aria-pressed={autoSaveEnabled}
                  >
                    {autoSaveEnabled ? "暂停自动保存" : "开启自动保存"}
                  </Button>
                  <div className="studio-import">
                    <Upload
                      theme="custom"
                      accept=".json,application/json"
                      autoUpload={false}
                      files={[]}
                      allowUploadDuplicateFile
                      onSelectChange={(files) => {
                        void importJsonFile(files[0]);
                      }}
                    >
                      <Button tag="button" type="button" variant="outline">
                        导入 JSON
                      </Button>
                    </Upload>
                  </div>
                  <Button tag="button" type="button" onClick={exportJson}>
                    导出 JSON
                  </Button>
                  <Button
                    tag="button"
                    type="button"
                    onClick={restoreDraft}
                    disabled={!hasSavedDraft}
                  >
                    恢复草稿
                  </Button>
                  <Button tag="button" type="button" onClick={clearDraft} disabled={!hasSavedDraft}>
                    清除草稿
                  </Button>
                </div>
              }
            >
              <Button type="button" variant="outline">
                文件与草稿
              </Button>
            </Popup>
          </div>
          <div className="studio-version-menu studio-local-history-menu">
            <Popup
              attach=".studio-local-history-menu"
              trigger="click"
              placement="bottom-right"
              onVisibleChange={(visible) => {
                if (visible) void refreshVersionHistory();
              }}
              content={
                <div className="studio-version-panel" aria-label="本地工程历史版本">
                  <p className="studio-version-help">
                    当前工程：{state.document.projectId} · 浏览器本地历史，不是正式发布
                  </p>
                  <div className="studio-version-tools">
                    <Button
                      tag="button"
                      type="button"
                      disabled={historyBusy}
                      onClick={() => void createHistoryVersion()}
                    >
                      创建快照
                    </Button>
                    <Button
                      tag="button"
                      type="button"
                      disabled={historyBusy}
                      onClick={() => void refreshVersionHistory()}
                    >
                      刷新
                    </Button>
                  </div>
                  {historyBusy && <p className="studio-version-help">正在处理历史版本…</p>}
                  {historyError && (
                    <p className="studio-version-error" role="alert">
                      {historyError}
                    </p>
                  )}
                  {!historyBusy && visibleHistoryRows.length === 0 && (
                    <p className="studio-version-help">当前工程暂无本地历史版本。</p>
                  )}
                  <ol className="studio-version-list">
                    {visibleHistoryRows.map((item) => (
                      <li key={item.revision} className="studio-version-item">
                        <div className="studio-version-heading">
                          <strong>版本 #{item.revision}</strong>
                          <time dateTime={item.createdAt}>
                            {new Date(item.createdAt).toLocaleString("zh-CN")}
                          </time>
                        </div>
                        <code title={item.contentHash}>{item.contentHash.slice(0, 16)}…</code>
                        <div className="studio-version-item-actions">
                          <Button
                            tag="button"
                            type="button"
                            disabled={historyBusy}
                            onClick={() => void inspectHistoryVersion(item.revision)}
                          >
                            查看差异
                          </Button>
                          <Button
                            tag="button"
                            type="button"
                            disabled={historyBusy}
                            onClick={() => void loadHistoryVersion(item.revision)}
                          >
                            载入
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ol>
                  {historyComparison && inspectedVersion && (
                    <div className="studio-version-comparison" role="status">
                      <strong>
                        版本 #{inspectedVersion.revision} ·
                        {historyComparison.sameContent ? " 内容与当前一致" : " 与当前内容不同"}
                      </strong>
                      <p>
                        当前：{historyComparison.current.pageCount} 页 /
                        {historyComparison.current.nodeCount} 图元 /
                        {historyComparison.current.bindingCount} 绑定
                      </p>
                      <p>
                        历史：{historyComparison.historical.pageCount} 页 /
                        {historyComparison.historical.nodeCount} 图元 /
                        {historyComparison.historical.bindingCount} 绑定
                      </p>
                    </div>
                  )}
                  {visibleHistoryRows.length > 0 && historyHasMore && (
                    <Button
                      tag="button"
                      type="button"
                      className="studio-version-more"
                      disabled={historyBusy}
                      onClick={() => void loadMoreVersions()}
                    >
                      加载更早版本
                    </Button>
                  )}
                </div>
              }
            >
              <Button type="button" variant="outline">
                版本历史
              </Button>
            </Popup>
          </div>
          <div className="studio-version-menu studio-release-preflight-menu">
            <Popup
              attach=".studio-release-preflight-menu"
              trigger="click"
              placement="bottom-right"
              content={
                <div className="studio-version-panel" aria-label="工程发布前静态兼容性预检">
                  <p className="studio-version-help">
                    当前工程：{state.document.projectId} · 仅检查 SVG
                    静态兼容性，不保存、不发布，也不改动草稿。
                  </p>
                  {releasePreflight.passed ? (
                    <p className="studio-version-help" role="status">
                      静态兼容性检查通过；仍须完成服务端授权、数据源和正式发布事务校验。
                    </p>
                  ) : (
                    <div>
                      <p className="studio-version-error" role="status">
                        发现 {releasePreflight.issues.length} 项兼容性问题，当前工程不能视为可发布。
                      </p>
                      <ol className="studio-version-list" aria-label="发布预检问题">
                        {releasePreflight.issues.map((issue, index) => (
                          <li
                            className="studio-version-item"
                            key={`${issue.code}:${issue.path}:${index}`}
                          >
                            <code>{issue.path}</code>
                            <p className="studio-version-help">{issue.message}</p>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  <ServerReleasePreflight
                    key={`${state.document.projectId}:${serverHeadRevision ?? "未查询"}:${serverAccessRevision}`}
                    api={serverApi}
                    document={state.document}
                    disabled={historyBusy}
                    onAccessRejected={(error) => {
                      invalidateServerAccess();
                      setServerError(error.message);
                      setNotice(
                        "服务端发布预检访问失败：" + error.message + "；本地画布与草稿不变",
                      );
                      if (error.kind === "unauthenticated") {
                        setServerIdentity("未登录或服务端尚未启用身份接口");
                      }
                    }}
                  />
                </div>
              }
            >
              <Button tag="button" type="button" variant="outline">
                发布预检
              </Button>
            </Popup>
          </div>
          <ServerProjectBrowser
            key={serverAccessRevision}
            api={serverApi}
            currentProjectId={state.document.projectId}
            disabled={historyBusy}
            onOpen={openServerProject}
            onAccessRejected={handleServerBrowserAccessRejected}
          />
          <div className="studio-version-menu studio-server-version-menu">
            <Popup
              attach=".studio-server-version-menu"
              trigger="click"
              placement="bottom-right"
              content={
                <div className="studio-version-panel" aria-label="服务端工程版本">
                  <p className="studio-version-help">
                    当前工程：{state.document.projectId} · 受保护的工程版本保存，不代表正式发布
                  </p>
                  <p className="studio-version-help" role="status">
                    {serverIdentity} · 服务端最新修订号：
                    {serverProjectId === state.document.projectId && serverHeadRevision !== null
                      ? serverHeadRevision
                      : "未查询"}{" "}
                    · CAS 基线：
                    {activeServerBaseline ?? "未建立"}
                  </p>
                  <div className="studio-version-tools">
                    <Button
                      tag="button"
                      type="button"
                      disabled={historyBusy}
                      onClick={() => void checkServerIdentity()}
                    >
                      检查登录
                    </Button>
                    <Button
                      tag="button"
                      type="button"
                      disabled={historyBusy}
                      onClick={() => void saveServerProject()}
                    >
                      保存至服务端
                    </Button>
                    <Button
                      tag="button"
                      type="button"
                      disabled={historyBusy}
                      onClick={() => void refreshServerHistory()}
                    >
                      查询服务端历史
                    </Button>
                  </div>
                  <p className="studio-version-help">
                    服务器已有工程时，请先显式载入最新服务端版本再保存；冲突不会自动重试，草稿始终保留。
                  </p>
                  {historyBusy && <p className="studio-version-help">正在处理工程版本…</p>}
                  {serverError && (
                    <p className="studio-version-error" role="alert">
                      {serverError}
                    </p>
                  )}
                  {serverError && serverRecoveryProjectId === state.document.projectId && (
                    <div className="studio-version-help">
                      <p>当前画布与 IndexedDB 草稿已保留。可先只读对比最新版本，再决定是否载入。</p>
                      <Button
                        tag="button"
                        type="button"
                        disabled={historyBusy}
                        onClick={() => void previewServerConflict()}
                      >
                        只读预览最新版本
                      </Button>
                    </div>
                  )}
                  {!historyBusy && visibleServerRows.length === 0 && (
                    <p className="studio-version-help">尚无已查询的服务端历史版本。</p>
                  )}
                  <ol className="studio-version-list">
                    {visibleServerRows.map((item) => (
                      <li key={item.revision} className="studio-version-item">
                        <div className="studio-version-heading">
                          <strong>服务端版本 #{item.revision}</strong>
                          <time dateTime={item.createdAt}>
                            {new Date(item.createdAt).toLocaleString("zh-CN")}
                          </time>
                        </div>
                        <code title={item.contentHash}>{item.contentHash.slice(0, 16)}…</code>
                        <div className="studio-version-item-actions">
                          <Button
                            tag="button"
                            type="button"
                            disabled={historyBusy}
                            onClick={() => void inspectServerVersion(item.revision)}
                          >
                            查看差异
                          </Button>
                          <Button
                            tag="button"
                            type="button"
                            disabled={historyBusy}
                            onClick={() => void loadServerVersion(item.revision)}
                          >
                            载入
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ol>
                  {serverComparison && serverInspectedVersion && (
                    <div className="studio-version-comparison" role="status">
                      <strong>
                        服务端版本 #{serverInspectedVersion.revision} ·
                        {serverComparison.sameContent ? " 内容与当前一致" : " 与当前内容不同"}
                      </strong>
                      <p>
                        当前：{serverComparison.current.pageCount} 页 /{" "}
                        {serverComparison.current.nodeCount} 图元
                      </p>
                      <p>
                        历史：{serverComparison.historical.pageCount} 页 /{" "}
                        {serverComparison.historical.nodeCount} 图元
                      </p>
                    </div>
                  )}
                  {visibleServerRows.length > 0 && serverHasMore && (
                    <Button
                      tag="button"
                      type="button"
                      className="studio-version-more"
                      disabled={historyBusy}
                      onClick={() => void loadMoreServerVersions()}
                    >
                      加载更早服务端版本
                    </Button>
                  )}
                </div>
              }
            >
              <Button tag="button" type="button" variant="outline">
                服务端工程
              </Button>
            </Popup>
          </div>
        </div>
      </header>
      <div
        className="studio-workspace"
        data-left-collapsed={!leftPanelVisible}
        data-right-collapsed={!rightPanelVisible}
        style={
          {
            "--studio-left-preferred": `${leftPanelWidth}px`,
            "--studio-right-preferred": `${rightPanelWidth}px`,
          } as CSSProperties
        }
      >
        <aside className="studio-panel studio-panel-layers min-h-0 min-w-0" aria-label="图元列表">
          <div className="studio-page-bar" aria-label="工程页面管理">
            <div className="studio-page-tabs" aria-label="工程页面">
              {state.document.pages.map((item) => (
                <Button
                  tag="button"
                  key={item.id}
                  type="button"
                  aria-current={item.id === state.activePageId ? "page" : undefined}
                  onClick={() => switchPage(item.id)}
                >
                  {item.name}
                </Button>
              ))}
            </div>
            <div className="studio-page-menu">
              <Dropdown
                trigger="click"
                placement="bottom-right"
                options={pageMenuOptions}
                onClick={handlePageMenuClick}
              >
                <Button type="button" variant="outline">
                  页面管理
                </Button>
              </Dropdown>
            </div>
          </div>
          <div className="studio-pane-heading">
            <h2>图层</h2>
            <span className="studio-count">{page.nodes.length}</span>
          </div>
          <div className="studio-tree-controls">
            <label className="studio-field">
              搜索图元或组合
              <Input
                type="search"
                size="small"
                aria-label="搜索图层"
                maxlength={128}
                value={layerSearch}
                placeholder="图元 ID、类型、文字或组合 ID"
                onChange={(value) => setLayerSearch(value)}
              />
            </label>
            <Button
              variant="outline"
              size="small"
              disabled={state.selectedIds.length === 0}
              onClick={locateSelectedLayer}
            >
              定位选中图层
            </Button>
            <Button
              variant="text"
              size="small"
              disabled={layerSearch.length === 0}
              onClick={() => setLayerSearch("")}
            >
              <CloseIcon /> 清除搜索
            </Button>
          </div>
          <div className="studio-layer-tree min-w-0" ref={layerTreeRef} aria-label="图层树">
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
                    <Button
                      tag="button"
                      type="button"
                      className="studio-tree-toggle"
                      aria-label={groupToggleLabel(entry.groupId)}
                      aria-expanded={groupExpanded(entry.groupId)}
                      disabled={isLayerSearching}
                      onClick={() => toggleLayerGroup(entry.groupId)}
                    >
                      {groupExpanded(entry.groupId) ? "▾" : "▸"}
                    </Button>
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
          <div className="studio-side-more">
            <Collapse borderless defaultValue={[]}>
              <Collapse.Panel value="cross-page" header="跨页操作与使用帮助">
                <div className="studio-copy-tools">
                  <label className="studio-field">
                    复制选中图元到
                    <Select
                      value={copyTargetPageId}
                      disabled={copyTargetPages.length === 0}
                      options={
                        copyTargetPages.length === 0
                          ? [{ label: "暂无其他页面", value: "" }]
                          : copyTargetPages.map((item) => ({ label: item.name, value: item.id }))
                      }
                      onChange={(value) => {
                        if (typeof value === "string") setPreferredCopyTargetPageId(value);
                      }}
                    />
                  </label>
                  <Button
                    tag="button"
                    type="button"
                    onClick={copySelectedToPage}
                    disabled={state.selectedIds.length === 0 || !copyTargetPageId}
                  >
                    复制选中图元
                  </Button>
                </div>
                <p className="studio-tip">
                  Shift+点击多选；拖动空白区域框选；Ctrl+A 全选，Del 删除。
                </p>
              </Collapse.Panel>
            </Collapse>
          </div>
        </aside>
        {(["left", "right"] as const).map((side) =>
          (side === "left" ? leftPanelVisible : rightPanelVisible) ? (
            <div
              key={side}
              className="studio-panel-resizer"
              data-side={side}
              role="separator"
              tabIndex={0}
              aria-label={side === "left" ? "调整图层面板宽度" : "调整属性面板宽度"}
              aria-orientation="vertical"
              aria-valuemin={side === "left" ? 200 : 260}
              aria-valuemax={side === "left" ? 340 : 420}
              aria-valuenow={side === "left" ? leftPanelWidth : rightPanelWidth}
              onPointerDown={(event) => beginPanelResize(event, side)}
              onPointerMove={(event) => updatePanelResize(event, side)}
              onPointerUp={endPanelResize}
              onPointerCancel={endPanelResize}
              onLostPointerCapture={endPanelResize}
              onKeyDown={(event) => resizePanelByKey(event, side)}
            />
          ) : null,
        )}
        <section className="studio-stage min-h-0 min-w-0" aria-label="组态画布">
          <div className="studio-stage-caption">
            <span>
              {page.name} · {page.size.width} × {page.size.height} px · 静态模拟预览
            </span>
            <div className="studio-view-menu studio-view-settings-menu">
              <Popup
                attach=".studio-view-settings-menu"
                trigger="click"
                placement="bottom-right"
                content={
                  <div className="studio-view-popover">
                    <div className="studio-view-section">
                      <p>网格与吸附</p>
                      <div className="studio-canvas-settings">
                        <div className="studio-canvas-option">
                          <Checkbox
                            checked={gridVisible}
                            onChange={(checked) => setGridVisible(checked)}
                          >
                            显示网格
                          </Checkbox>
                        </div>
                        <div className="studio-canvas-option">
                          <Checkbox checked={gridSnap} onChange={(checked) => setGridSnap(checked)}>
                            网格吸附
                          </Checkbox>
                        </div>
                        <div className="studio-canvas-option">
                          <Checkbox checked={nodeSnap} onChange={(checked) => setNodeSnap(checked)}>
                            图元吸附
                          </Checkbox>
                        </div>
                      </div>
                    </div>
                    <div className="studio-view-section">
                      <p>工作区面板</p>
                      <label className="studio-panel-size">
                        <span>图层宽度 · {leftPanelWidth}px</span>
                        <input
                          type="range"
                          min={200}
                          max={340}
                          step={1}
                          value={leftPanelWidth}
                          onChange={(event) => setLeftPanelWidth(event.currentTarget.valueAsNumber)}
                        />
                      </label>
                      <label className="studio-panel-size">
                        <span>属性宽度 · {rightPanelWidth}px</span>
                        <input
                          type="range"
                          min={260}
                          max={420}
                          step={1}
                          value={rightPanelWidth}
                          onChange={(event) =>
                            setRightPanelWidth(event.currentTarget.valueAsNumber)
                          }
                        />
                      </label>
                      <div className="studio-panel-toggles" aria-label="面板显示">
                        <Button
                          tag="button"
                          type="button"
                          aria-pressed={leftPanelVisible}
                          onClick={() => setLeftPanelVisible((value) => !value)}
                        >
                          {leftPanelVisible ? "隐藏图层" : "显示图层"}
                        </Button>
                        <Button
                          tag="button"
                          type="button"
                          aria-pressed={rightPanelVisible}
                          onClick={() => setRightPanelVisible((value) => !value)}
                        >
                          {rightPanelVisible ? "隐藏属性" : "显示属性"}
                        </Button>
                      </div>
                    </div>
                  </div>
                }
              >
                <Button tag="button" type="button" variant="outline">
                  视图设置
                </Button>
              </Popup>
            </div>
            <div className="studio-zoom" aria-label="画布缩放">
              <Button
                tag="button"
                type="button"
                onClick={() => changeZoom(-0.25)}
                disabled={zoom <= 0.5}
              >
                −
              </Button>
              <Button
                tag="button"
                type="button"
                title="适应画板"
                aria-label="适应画板"
                onClick={resetCanvasView}
              >
                {actualZoomPercent}%
              </Button>
              <Button
                tag="button"
                type="button"
                onClick={() => changeZoom(0.25)}
                disabled={zoom >= 8}
              >
                +
              </Button>
              <Button
                tag="button"
                type="button"
                className="studio-focus-selection"
                title="定位选中图元"
                aria-label="定位选中图元"
                disabled={!selected || !studioNodeVisible(selected)}
                onClick={focusSelectedNode}
              >
                定位
              </Button>
            </div>
          </div>
          <div className="studio-canvas-scroll" tabIndex={0} aria-label="组态网格工作区">
            <div className="studio-canvas-board">
              <svg
                ref={svgRef}
                className="studio-svg"
                data-rotating={rotating ? "true" : undefined}
                data-canvas-tool={canvasTool}
                viewBox={`${visibleRect.x} ${visibleRect.y} ${visibleRect.width} ${visibleRect.height}`}
                preserveAspectRatio="xMidYMid meet"
                onPointerMove={(event) => {
                  if (updateCanvasPan(event)) return;
                  updateDrag(event);
                  updateMarquee(event);
                  updateGeometry(event);
                }}
                onPointerUp={(event) => {
                  if (finishCanvasPan(event)) return;
                  finishDrag(event);
                  finishMarquee(event);
                  finishGeometry(event);
                }}
                onPointerCancel={cancelDrag}
                onPointerDownCapture={(event) => {
                  if (event.button === 0) {
                    const canvas = event.currentTarget.closest(".studio-canvas-scroll");
                    if (canvas instanceof HTMLElement) canvas.focus({ preventScroll: true });
                  }
                  if (beginCanvasPan(event)) event.stopPropagation();
                }}
                onPointerDown={startMarquee}
                aria-label="可编辑 SVG 画布；使用抓手、中键或 Alt 加空白处拖动平移"
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
                <rect
                  className="studio-artboard-surface"
                  x={0}
                  y={0}
                  width={page.size.width}
                  height={page.size.height}
                  pointerEvents="none"
                />
                <image
                  href={image}
                  width={page.size.width}
                  height={page.size.height}
                  pointerEvents="none"
                />
                {gridVisible && (
                  <rect
                    x={visibleRect.x}
                    y={visibleRect.y}
                    width={visibleRect.width}
                    height={visibleRect.height}
                    fill="url(#scada-studio-grid)"
                    pointerEvents="none"
                  />
                )}
                <rect
                  className="studio-page-boundary"
                  x={0}
                  y={0}
                  width={page.size.width}
                  height={page.size.height}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
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
                          studioNodeLocked(node)
                            ? `选择已锁定图元 ${node.id}`
                            : `选择并拖动 ${node.id}`
                        }
                        data-locked={studioNodeLocked(node)}
                        x={t.x}
                        y={t.y}
                        width={t.width}
                        height={t.height}
                        fill="transparent"
                        data-selected={state.selectedIds.includes(node.id)}
                        data-primary={state.selectedId === node.id}
                        strokeWidth={1.5}
                        vectorEffect="non-scaling-stroke"
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
                                  x={position.x - 4 * worldPerPixel}
                                  y={position.y - 4 * worldPerPixel}
                                  width={8 * worldPerPixel}
                                  height={8 * worldPerPixel}
                                  vectorEffect="non-scaling-stroke"
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
                              y2={t.y - 24 * worldPerPixel}
                              vectorEffect="non-scaling-stroke"
                              pointerEvents="none"
                            />
                            <circle
                              className="studio-rotation-handle"
                              aria-label="旋转图元，按住 Shift 可按 15 度吸附"
                              cx={t.x + t.width / 2}
                              cy={t.y - 24 * worldPerPixel}
                              r={5 * worldPerPixel}
                              vectorEffect="non-scaling-stroke"
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
            </div>
          </div>
          <div className="studio-canvas-dock" aria-label="画布工具">
            <div className="studio-canvas-modes" role="group" aria-label="画布操作模式">
              <Button
                tag="button"
                type="button"
                title="选择工具（V）"
                aria-pressed={canvasTool === "select"}
                onClick={() => setCanvasTool("select")}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 3l14 10-7 1-3 7z" />
                </svg>
                选择
              </Button>
              <Button
                tag="button"
                type="button"
                title="抓手工具（H）"
                aria-pressed={canvasTool === "hand"}
                onClick={() => setCanvasTool("hand")}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8 13V7a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v7a7 7 0 0 1-14 0l-2-3a2 2 0 0 1 3-2z" />
                </svg>
                抓手
              </Button>
            </div>
            <div className="studio-library-label">图元库 · 点击添加</div>
            <div className="studio-add">
              <Button tag="button" type="button" onClick={() => addSymbol("tank")}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 5h16v14H4zM4 12h16M8 5V3m8 2V3" />
                </svg>
                + 水箱
              </Button>
              <Button tag="button" type="button" onClick={() => addSymbol("pump")}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM9 8l6 4-6 4z" />
                </svg>
                + 水泵
              </Button>
              <Button tag="button" type="button" onClick={() => addSymbol("pipe")}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 17h7V7h11" />
                </svg>
                + 管道
              </Button>
              <Button tag="button" type="button" onClick={() => addSymbol("label")}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 5h16M12 5v14M8 19h8" />
                </svg>
                + 文本
              </Button>
            </div>
          </div>
        </section>
        <aside
          className="studio-panel studio-panel-properties min-h-0 min-w-0"
          aria-label="属性与 Tag 工作区"
        >
          <div className="studio-inspector-tabs" role="group" aria-label="右侧工作区">
            <Button
              type="button"
              aria-pressed={inspectorTab === "properties"}
              onClick={() => setInspectorTab("properties")}
            >
              属性
            </Button>
            <Button
              type="button"
              aria-pressed={inspectorTab === "tags"}
              onClick={() => setInspectorTab("tags")}
            >
              项目 Tag（{state.document.tags.length}）
            </Button>
          </div>
          <div className="studio-inspector-content" hidden={inspectorTab !== "properties"}>
            <h2>属性 · 已选 {state.selectedIds.length}</h2>
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
                    {GEOMETRY_PROPERTY_FIELDS.map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <Input
                          type="number"
                          name={key}
                          defaultValue={String(selected.transform[key])}
                          disabled={studioNodeLocked(selected)}
                        />
                      </label>
                    ))}
                    <Button type="submit" disabled={studioNodeLocked(selected)}>
                      应用几何属性
                    </Button>
                  </form>
                ) : (
                  <p className="studio-tip">当前为多选状态，请单选一个图元编辑几何属性。</p>
                )}
                <p className="studio-tip">
                  拖动画布中的虚线框，或使用方向按钮微调。每次操作可撤销。
                </p>
                <div className="studio-nudge">
                  <Button type="button" onClick={() => nudge(-1, 0)}>
                    ←
                  </Button>
                  <Button type="button" onClick={() => nudge(0, -1)}>
                    ↑
                  </Button>
                  <Button type="button" onClick={() => nudge(0, 1)}>
                    ↓
                  </Button>
                  <Button type="button" onClick={() => nudge(1, 0)}>
                    →
                  </Button>
                </div>
                {selected.type === "label" && state.selectedIds.length === 1 && (
                  <label className="studio-field">
                    显示文案
                    <Input
                      value={labelDraft}
                      maxlength={256}
                      disabled={studioNodeLocked(selected)}
                      onChange={(value) => setLabelDraft(value)}
                    />
                    <Button
                      type="button"
                      onClick={changeLabel}
                      disabled={studioNodeLocked(selected)}
                    >
                      应用文案
                    </Button>
                  </label>
                )}
                <h3>Tag 绑定（项目数据）</h3>
                {bindingSlot ? (
                  <>
                    <label className="studio-field">
                      {bindingSlot} · 选择项目 Tag
                      <Select
                        aria-label={selected.id + " 的 " + bindingSlot + " Tag 绑定"}
                        value={currentBindingTag}
                        options={[
                          { label: "不绑定", value: "" },
                          ...(missingBindingTag
                            ? [
                                {
                                  label: `${currentBindingTag}（当前工程未定义或类型待确认）`,
                                  value: currentBindingTag,
                                  disabled: true,
                                },
                              ]
                            : []),
                          ...tagCandidates.map((option) => ({
                            label: `${option.displayName} · ${option.tagId} · ${TAG_DATA_TYPE_LABELS[option.dataType]}${option.unit ? " · " + option.unit : ""}`,
                            value: option.tagId,
                          })),
                        ]}
                        onChange={(value) => {
                          if (typeof value === "string") changeTagBinding(bindingSlot, value);
                        }}
                      />
                    </label>
                    {selectedTagDefinition && (
                      <p className="studio-tip">
                        {selectedTagDefinition.description}；质量由实时 Tag 数据动态提供
                      </p>
                    )}
                  </>
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
            <div className="studio-advanced">
              <Collapse borderless defaultValue={[]}>
                <Collapse.Panel value="advanced-tools" header="高级图元与图层操作">
                  <div className="studio-advanced-content">
                    <div className="studio-toolbox">
                      <div className="studio-tool-group" aria-label="图层锁定与可见性">
                        <Button
                          type="button"
                          disabled={state.selectedIds.length === 0}
                          onClick={() => changeSelectedLocked(true)}
                        >
                          锁定所选
                        </Button>
                        <Button
                          type="button"
                          disabled={state.selectedIds.length === 0}
                          onClick={() => changeSelectedLocked(false)}
                        >
                          解锁所选
                        </Button>
                        <Button
                          type="button"
                          disabled={state.selectedIds.length === 0 || hasLockedSelection}
                          onClick={() => changeSelectedVisible(false)}
                        >
                          隐藏所选
                        </Button>
                        <Button
                          type="button"
                          disabled={state.selectedIds.length === 0 || hasLockedSelection}
                          onClick={() => changeSelectedVisible(true)}
                        >
                          显示所选
                        </Button>
                      </div>
                      <div className="studio-tool-group" aria-label="图元组合">
                        <Button
                          type="button"
                          disabled={!canGroup}
                          onClick={() =>
                            apply(() => editor.groupSelected(), "已组合所选图元，可撤销")
                          }
                        >
                          组合所选
                        </Button>
                        <Button
                          type="button"
                          disabled={!hasGroupedSelection}
                          onClick={() => apply(() => editor.ungroupSelected(), "已解组，可撤销")}
                        >
                          解组
                        </Button>
                      </div>
                      <div className="studio-tool-group" aria-label="图元剪贴板">
                        <Button
                          type="button"
                          disabled={state.selectedIds.length === 0}
                          onClick={() =>
                            apply(() => editor.copySelected(), "已复制所选图元到会话剪贴板")
                          }
                        >
                          复制所选
                        </Button>
                        <Button
                          type="button"
                          disabled={state.selectedIds.length === 0}
                          onClick={() => apply(() => editor.cutSelected(), "已剪切图元，可撤销")}
                        >
                          剪切所选
                        </Button>
                        <Button
                          type="button"
                          disabled={!state.hasClipboard}
                          onClick={() => apply(() => editor.pasteClipboard(), "已粘贴图元，可撤销")}
                        >
                          粘贴图元
                        </Button>
                        <Button
                          type="button"
                          onClick={() => apply(() => editor.deleteSelected(), "已删除图元，可撤销")}
                          disabled={state.selectedIds.length === 0}
                        >
                          删除所选
                        </Button>
                      </div>
                      <div className="studio-exact-layer" aria-label="图层精确插入">
                        <label className="studio-field">
                          目标图元
                          <Select
                            value={layerTargetId}
                            disabled={!canPreciselyMove || layerTargetNodes.length === 0}
                            options={[
                              { label: "请选择目标图元", value: "" },
                              ...layerTargetNodes.map((node) => ({
                                label: node.id + (node.groupId ? "（组合）" : ""),
                                value: node.id,
                              })),
                            ]}
                            onChange={(value) => {
                              if (typeof value === "string") setPreferredLayerTargetId(value);
                            }}
                          />
                        </label>
                        <label className="studio-field">
                          插入位置
                          <Select
                            value={layerInsertPosition}
                            options={[
                              { label: "目标上方（更靠前）", value: "after" },
                              { label: "目标下方（更靠后）", value: "before" },
                            ]}
                            onChange={(value) => {
                              if (value === "after" || value === "before")
                                setLayerInsertPosition(value);
                            }}
                          />
                        </label>
                        <Button
                          type="button"
                          disabled={!canPreciselyMove || !layerTargetId || !selected}
                          onClick={() =>
                            selected &&
                            moveLayerPrecisely(selected.id, layerTargetId, layerInsertPosition)
                          }
                        >
                          移动到指定层
                        </Button>
                      </div>
                      <div className="studio-tool-group" aria-label="图层排序">
                        <Button type="button" onClick={() => layer("back")} disabled={!selected}>
                          置底
                        </Button>
                        <Button
                          type="button"
                          onClick={() => layer("backward")}
                          disabled={!selected}
                        >
                          下移层
                        </Button>
                        <Button type="button" onClick={() => layer("forward")} disabled={!selected}>
                          上移层
                        </Button>
                        <Button type="button" onClick={() => layer("front")} disabled={!selected}>
                          置顶
                        </Button>
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
                          <Button
                            type="button"
                            key={mode}
                            onClick={() => align(mode)}
                            disabled={state.selectedIds.length < 2 || hasGroupedSelection}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                </Collapse.Panel>
              </Collapse>
            </div>
          </div>
          <div className="studio-inspector-content" hidden={inspectorTab !== "tags"}>
            <h2>项目 Tag 定义</h2>
            <TagManager
              tags={state.document.tags}
              onCreate={(definition) =>
                changeProjectTag(
                  () => editor.addTagDefinition(definition),
                  "项目 Tag 已新增，可撤销",
                )
              }
              onUpdate={(tagId, changes) =>
                changeProjectTag(
                  () => editor.updateTagDefinition(tagId, changes),
                  "项目 Tag 已更新，可撤销",
                )
              }
              onRemove={(tagId) =>
                changeProjectTag(() => editor.removeTagDefinition(tagId), "项目 Tag 已删除，可撤销")
              }
            />
          </div>
        </aside>
      </div>
      <footer className="studio-statusbar">
        <div className="studio-status-message">
          <span className="studio-status-led" aria-hidden="true" />
          <p role="status" className="studio-notice">
            {notice}
            {hasSavedDraft && !autoSaveEnabled
              ? " · 已发现本地草稿，可点击「恢复草稿」确认加载"
              : ""}
          </p>
        </div>
        <div className="studio-status-meta">
          <span>仅模拟数据 · 无设备写入</span>
          <span>
            {page.nodes.length} 个图元 · 已选 {state.selectedIds.length}
          </span>
          <span title="Ctrl+A 全选，Ctrl+C 复制，Ctrl+X 剪切，Ctrl+V 粘贴，Ctrl+Z 撤销，Ctrl+Shift+Z / Ctrl+Y 重做，方向键微移，Shift+方向键移动 10 格，Esc 取消选择">
            快捷键 ⓘ
          </span>
        </div>
      </footer>
    </main>
  );
}
