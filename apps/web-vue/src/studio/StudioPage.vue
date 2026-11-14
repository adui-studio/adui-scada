<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { Button as TButton, Input as TInput } from "tdesign-vue-next";
import { CloseIcon } from "tdesign-icons-vue-next";
import "tdesign-vue-next/es/style/index.css";
import {
  TAG_DATA_TYPE_LABELS,
  tagDefinitionSupportsSlot,
  WaterTreatmentSimulator,
  waterTreatmentDemoDocument,
  DraftAutoSaveSession,
  LOCAL_DRAFT_AUTO_SAVE_DELAY_MS,
  studioNodeLocked,
  studioNodeVisible,
  buildLayerTree,
  studioViewportRect,
  compareProjectDocuments,
} from "@adui/scada-core";
import type { ProjectSnapshot, ProjectVersionSummary, ScadaDocument } from "@adui/scada-core";
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
  LayerAction,
  NodeTransformPatch,
  ResizeHandle,
} from "@adui/scada-core/editor";
import { svgDataUrl } from "@adui/scada-runtime";
import "./studio.css";
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
const editor = new DocumentEditor(waterTreatmentDemoDocument);
const state = shallowRef(editor.snapshot());
const preview = shallowRef<{ id: string; x: number; y: number } | null>(null);
const geometryPreview = shallowRef<ScadaDocument | null>(null);
const rotating = ref(false);
const marquee = shallowRef<MarqueeState | null>(null);
const labelDraft = ref("");
const preferredCopyTargetPageId = ref("");
const preferredLayerTargetId = ref("");
const layerSearch = ref("");
const collapsedGroupIds = shallowRef<Set<string>>(new Set());
const layerTreeRef = ref<HTMLElement | null>(null);
const layerInsertPosition = ref<"before" | "after">("after");
const layerDrop = shallowRef<{ id: string; position: "before" | "after" } | null>(null);
let layerDrag: { pageId: string; nodeId: string } | null = null;
const notice = ref("可手动保存浏览器本地草稿 · 尚未连接工程保存服务");
const hasSavedDraft = ref(false);
const autoSaveEnabled = ref(false);
const historyRows = shallowRef<readonly ProjectVersionSummary[]>([]);
const historyProjectId = ref("");
const historyHasMore = ref(false);
const historyBusy = ref(false);
const historyError = ref("");
const inspectedVersion = shallowRef<ProjectSnapshot | null>(null);
let historyActionInProgress = false;
let autoSaveSession: DraftAutoSaveSession | null = null;
let draftActionInProgress = false;
let unsubscribeDraft: (() => void) | null = null;
const zoom = ref(1);
const pan = ref({ x: 0, y: 0 });
const viewportSize = ref({ width: 0, height: 0 });
const gridVisible = ref(true);
const gridSnap = ref(true);
const nodeSnap = ref(true);
const leftPanelVisible = ref(true);
const rightPanelVisible = ref(true);
const svgRef = ref<SVGSVGElement | null>(null);
let canvasResizeObserver: ResizeObserver | null = null;
let activePan: {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  scale: number;
} | null = null;

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
let activeDrag: DragState | null = null;
let activeMarquee: MarqueeState | null = null;
let activeGeometry: GeometryDragState | null = null;

const visibleHistoryRows = computed(() =>
  historyProjectId.value === state.value.document.projectId ? historyRows.value : [],
);
const historyComparison = computed(() =>
  inspectedVersion.value?.projectId === state.value.document.projectId
    ? compareProjectDocuments(state.value.document, inspectedVersion.value.document)
    : null,
);

const page = computed(() => {
  const result = state.value.document.pages.find((item) => item.id === state.value.activePageId);
  if (!result) throw new Error("工程文档不包含页面");
  return result;
});
const canvasViewport = computed(() => ({
  width: viewportSize.value.width || page.value.size.width,
  height: viewportSize.value.height || page.value.size.height,
}));
const visibleRect = computed(() =>
  studioViewportRect(page.value.size, canvasViewport.value, zoom.value, pan.value),
);
const selected = computed(() =>
  page.value.nodes.find((node) => node.id === state.value.selectedId),
);
const hasGroupedSelection = computed(() =>
  page.value.nodes.some(
    (node) => node.groupId !== undefined && state.value.selectedIds.includes(node.id),
  ),
);
const hasLockedSelection = computed(() =>
  page.value.nodes.some(
    (node) => state.value.selectedIds.includes(node.id) && studioNodeLocked(node),
  ),
);
const canGroup = computed(
  () =>
    state.value.selectedIds.length >= 2 && !hasGroupedSelection.value && !hasLockedSelection.value,
);
const layerEntries = computed(() => buildLayerTree(page.value.nodes, layerSearch.value));
const isLayerSearching = computed(() => layerSearch.value.trim().length > 0);
watch(
  () => [state.value.activePageId, state.value.selectedId],
  () => {
    const node = page.value.nodes.find((item) => item.id === state.value.selectedId);
    if (!node?.groupId || !collapsedGroupIds.value.has(node.groupId)) return;
    const next = new Set(collapsedGroupIds.value);
    next.delete(node.groupId);
    collapsedGroupIds.value = next;
  },
);
const lockedLayerGroups = computed(
  () =>
    new Set(
      page.value.nodes
        .filter(studioNodeLocked)
        .flatMap((node) => (node.groupId ? [node.groupId] : [])),
    ),
);
const canPreciselyMove = computed(() => {
  const node = selected.value;
  return (
    node !== undefined &&
    (state.value.selectedIds.length === 1 ||
      (node.groupId !== undefined &&
        state.value.selectedIds.every(
          (id) => page.value.nodes.find((item) => item.id === id)?.groupId === node.groupId,
        ))) &&
    !hasLockedSelection.value
  );
});
const layerTargetNodes = computed(() => {
  const chosen = selected.value;
  return page.value.nodes.filter(
    (node) =>
      node.id !== chosen?.id && (chosen?.groupId === undefined || node.groupId !== chosen.groupId),
  );
});
const layerTargetId = computed(() =>
  layerTargetNodes.value.some((node) => node.id === preferredLayerTargetId.value)
    ? preferredLayerTargetId.value
    : (layerTargetNodes.value[0]?.id ?? ""),
);
const activePageIndex = computed(() =>
  state.value.document.pages.findIndex((item) => item.id === state.value.activePageId),
);
const copyTargetPages = computed(() =>
  state.value.document.pages.filter((item) => item.id !== state.value.activePageId),
);
const copyTargetPageId = computed(() =>
  copyTargetPages.value.some((item) => item.id === preferredCopyTargetPageId.value)
    ? preferredCopyTargetPageId.value
    : (copyTargetPages.value[0]?.id ?? ""),
);
const bindingSlot = computed(() => {
  const node = selected.value;
  return node && state.value.selectedIds.length === 1 && !node.groupId && !studioNodeLocked(node)
    ? editableTagSlot(node.type)
    : null;
});
const demoTagCandidates = computed(() => {
  const slot = bindingSlot.value;
  return slot === null
    ? []
    : state.value.document.tags.filter((definition) =>
        tagDefinitionSupportsSlot(definition, slot),
      );
});
const selectedTagId = computed(() => {
  const node = selected.value;
  const slot = bindingSlot.value;
  return node && slot ? (node.bindings[slot]?.tagId ?? "") : "";
});
const missingBindingTag = computed(
  () =>
    selectedTagId.value !== "" &&
    !demoTagCandidates.value.some((option) => option.tagId === selectedTagId.value),
);
const selectedTagDefinition = computed(() =>
  state.value.document.tags.find((definition) => definition.tagId === selectedTagId.value),
);
const snapResult = computed(() => {
  const dragging = preview.value;
  if (!dragging) return null;
  const anchor = page.value.nodes.find((node) => node.id === dragging.id);
  if (!anchor) return null;
  return resolveDragSnap(
    state.value.document,
    state.value.selectedIds,
    dragging.x - anchor.transform.x,
    dragging.y - anchor.transform.y,
    { gridEnabled: gridSnap.value, nodeEnabled: nodeSnap.value },
    state.value.activePageId,
  );
});
const displayDocument = computed(() => {
  if (geometryPreview.value !== null) return geometryPreview.value;
  const movement = snapResult.value;
  return movement === null
    ? state.value.document
    : withNodesTranslated(
        state.value.document,
        state.value.selectedIds,
        movement.dx,
        movement.dy,
        state.value.activePageId,
      );
});
const displayNodes = computed(() => {
  const nodes = displayDocument.value.pages.find(
    (item) => item.id === state.value.activePageId,
  )?.nodes;
  return (nodes ?? []).filter(studioNodeVisible);
});
const imageUrl = computed(() =>
  svgDataUrl(displayDocument.value, previewTags, state.value.activePageId),
);

watch(
  () => [selected.value?.id, selected.value?.props.text],
  () => {
    labelDraft.value =
      typeof selected.value?.props.text === "string" ? selected.value.props.text : "";
  },
  { immediate: true },
);

function refresh() {
  state.value = editor.snapshot();
}

function handleKey(event: KeyboardEvent) {
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
        if (handled) notice.value = "已复制所选图元到会话剪贴板";
      } else if (key === "x" && !event.shiftKey) {
        handled = editor.cutSelected();
        if (handled) notice.value = "已剪切所选图元，可撤销";
      } else if (key === "v" && !event.shiftKey && editor.snapshot().hasClipboard) {
        event.preventDefault();
        try {
          handled = editor.pasteClipboard().length > 0;
          if (handled) notice.value = "已粘贴图元，可撤销";
        } catch (error) {
          notice.value = "粘贴失败：" + (error instanceof Error ? error.message : String(error));
        }
      } else if (key === "a") {
        editor.selectMany(
          page.value.nodes
            .filter((node) => studioNodeVisible(node) && !studioNodeLocked(node))
            .map((node) => node.id),
        );
        handled = true;
      }
    } else if (!command && !event.altKey) {
      if (key === "escape") {
        activeDrag = null;
        activeMarquee = null;
        activeGeometry = null;
        preview.value = null;
        marquee.value = null;
        geometryPreview.value = null;
        rotating.value = false;
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
    notice.value = error instanceof Error ? error.message : String(error);
    return;
  }

  if (!handled) return;
  event.preventDefault();
  refresh();
}

async function checkLocalDraft() {
  try {
    hasSavedDraft.value = (await drafts.get(state.value.document.projectId)) !== null;
  } catch (error) {
    hasSavedDraft.value = error instanceof InvalidLegacyDraftError;
    notice.value = "本地草稿读取失败：" + (error instanceof Error ? error.message : String(error));
  }
}

async function pauseAutoSave() {
  const session = autoSaveSession;
  autoSaveSession = null;
  autoSaveEnabled.value = false;
  await session?.stop();
}

function subscribeDraft() {
  unsubscribeDraft?.();
  unsubscribeDraft = drafts.subscribe(state.value.document.projectId, (revision) => {
    hasSavedDraft.value = revision !== null;
    const session = autoSaveSession;
    if (session && revision !== session.currentRevision) {
      void pauseAutoSave();
      notice.value = "其他标签页已修改草稿，自动保存已暂停，请先核对";
    }
  });
}

onMounted(() => {
  window.addEventListener("keydown", handleKey);
  subscribeDraft();
  void checkLocalDraft();

  const canvas = svgRef.value;
  if (!canvas) return;
  canvasResizeObserver = new ResizeObserver(([entry]) => {
    if (!entry) return;
    const { width, height } = entry.contentRect;
    if (width <= 0 || height <= 0) return;
    if (viewportSize.value.width === width && viewportSize.value.height === height) return;
    viewportSize.value = { width, height };
  });
  canvasResizeObserver.observe(canvas);
});
onUnmounted(() => {
  canvasResizeObserver?.disconnect();
  canvasResizeObserver = null;
  window.removeEventListener("keydown", handleKey);
  unsubscribeDraft?.();
  void pauseAutoSave().then(() => drafts.close());
  projectVersions.close();
});
watch(
  () => state.value.document.projectId,
  () => {
    subscribeDraft();
    void checkLocalDraft();
  },
);

watch(
  () => [state.value.document, autoSaveEnabled.value] as const,
  ([document, enabled], _previous, onCleanup) => {
    if (!enabled || !autoSaveSession) return;
    const session = autoSaveSession;
    let active = true;
    const timer = window.setTimeout(() => {
      void session.saveIfDirty(document).then(
        (saved) => {
          if (!active || autoSaveSession !== session || !saved) return;
          hasSavedDraft.value = true;
          notice.value = `本地草稿已自动保存（${saved.savedAt}）`;
        },
        (error: unknown) => {
          if (!active || autoSaveSession !== session) return;
          void pauseAutoSave();
          notice.value =
            "自动保存已暂停：" + (error instanceof Error ? error.message : String(error));
        },
      );
    }, LOCAL_DRAFT_AUTO_SAVE_DELAY_MS);
    onCleanup(() => {
      active = false;
      window.clearTimeout(timer);
    });
  },
);

function startMarquee(event: PointerEvent) {
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
  activeMarquee = next;
  marquee.value = next;
  svgRef.value?.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function updateMarquee(event: PointerEvent) {
  if (!activeMarquee || activeMarquee.pointerId !== event.pointerId) return;
  const point = canvasPoint(event.clientX, event.clientY);
  if (!point) return;
  activeMarquee = { ...activeMarquee, x: point.x, y: point.y };
  marquee.value = activeMarquee;
}

function finishMarquee(event: PointerEvent) {
  const current = activeMarquee;
  if (!current || current.pointerId !== event.pointerId) return;
  const point = canvasPoint(event.clientX, event.clientY);
  activeMarquee = null;
  marquee.value = null;
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
      state.value.activePageId,
    );
    editor.selectMany(ids, current.additive);
  }
  refresh();
}

function updatePointer(event: PointerEvent) {
  if (updateCanvasPan(event)) return;
  updateDrag(event);
  updateMarquee(event);
  updateGeometry(event);
}

function finishPointer(event: PointerEvent) {
  if (finishCanvasPan(event)) return;
  finishDrag(event);
  finishMarquee(event);
  finishGeometry(event);
}

function selectNode(id: string | null, additive = false) {
  if (activeDrag !== null || activeGeometry !== null) return;
  editor.select(id, additive);
  refresh();
}

function apply(action: () => unknown, message: string) {
  try {
    action();
    refresh();
    notice.value = message;
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  }
}

function switchPage(pageId: string) {
  try {
    if (!editor.switchPage(pageId)) return;
    clearLayerDrag();
    layerSearch.value = "";
    cancelDrag();
    zoom.value = 1;
    pan.value = { x: 0, y: 0 };
    refresh();
    notice.value = "已切换编辑页面；页面切换不会修改工程草稿";
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  }
}

function createPage() {
  apply(() => {
    editor.createPage();
    layerSearch.value = "";
    cancelDrag();
  }, "已创建空白页面，可撤销");
}

function renamePage() {
  const name = window.prompt("请输入新的页面名称", page.value.name);
  if (name === null) return;
  apply(() => editor.renamePage(page.value.id, name), "页面已重命名，可撤销");
}

function deletePage() {
  if (!window.confirm("确定删除页面“" + page.value.name + "”及其图元吗？可撤销。")) {
    return;
  }
  apply(() => {
    editor.deletePage(page.value.id);
    cancelDrag();
  }, "页面已删除，可撤销");
}

function duplicatePage() {
  apply(() => {
    editor.duplicatePage();
    layerSearch.value = "";
    cancelDrag();
  }, "已复制页面及其图元和 Tag 绑定，可撤销");
}

function movePage(direction: "previous" | "next") {
  apply(() => editor.movePage(state.value.activePageId, direction), "页面顺序已调整，可撤销");
}

function selectCopyTarget(event: Event) {
  if (event.target instanceof HTMLSelectElement) {
    preferredCopyTargetPageId.value = event.target.value;
  }
}

function copySelectedToPage() {
  if (!copyTargetPageId.value) return;
  apply(
    () => editor.copySelectedToPage(copyTargetPageId.value),
    "已将所选图元复制到目标页面，可撤销；源页面保持不变",
  );
}

function changeTagBinding(event: Event) {
  const slot = bindingSlot.value;
  if (slot === null || !(event.target instanceof HTMLSelectElement)) return;
  const tagId = event.target.value;
  apply(
    () => editor.setSelectedBinding(slot, tagId === "" ? null : tagId),
    "已修改模拟 Tag 绑定，可撤销",
  );
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
      notice.value = "图层已精确排序，可撤销";
    } else {
      notice.value = "图层位置没有变化";
    }
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  }
}

function clearLayerDrag() {
  layerDrag = null;
  layerDrop.value = null;
}

function startLayerDrag(event: DragEvent, nodeId: string) {
  const node = page.value.nodes.find((item) => item.id === nodeId);
  if (
    !node ||
    studioNodeLocked(node) ||
    (node.groupId !== undefined && lockedLayerGroups.value.has(node.groupId))
  ) {
    event.preventDefault();
    return;
  }
  layerDrag = { pageId: page.value.id, nodeId };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-adui-scada-layer", nodeId);
  }
}

function overLayer(event: DragEvent, targetId: string) {
  const dragging = layerDrag;
  if (!dragging || dragging.pageId !== state.value.activePageId || dragging.nodeId === targetId) {
    return;
  }
  const source = page.value.nodes.find((item) => item.id === dragging.nodeId);
  const target = page.value.nodes.find((item) => item.id === targetId);
  if (!source || !target || (source.groupId && source.groupId === target.groupId)) return;
  if (!(event.currentTarget instanceof HTMLButtonElement)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const bounds = event.currentTarget.getBoundingClientRect();
  const position = event.clientY < bounds.top + bounds.height / 2 ? "after" : "before";
  if (layerDrop.value?.id !== targetId || layerDrop.value.position !== position) {
    layerDrop.value = { id: targetId, position };
  }
}

function dropLayer(event: DragEvent, targetId: string) {
  const dragging = layerDrag;
  if (!dragging || dragging.pageId !== state.value.activePageId) return;
  if (!(event.currentTarget instanceof HTMLButtonElement)) return;
  event.preventDefault();
  const bounds = event.currentTarget.getBoundingClientRect();
  const position = event.clientY < bounds.top + bounds.height / 2 ? "after" : "before";
  clearLayerDrag();
  moveLayerPrecisely(dragging.nodeId, targetId, position);
}

function toggleLayerGroup(groupId: string) {
  const next = new Set(collapsedGroupIds.value);
  if (next.has(groupId)) next.delete(groupId);
  else next.add(groupId);
  collapsedGroupIds.value = next;
}

function groupExpanded(groupId: string): boolean {
  return isLayerSearching.value || !collapsedGroupIds.value.has(groupId);
}

function layerGroupSelected(groupId: string): boolean {
  return page.value.nodes.some(
    (node) => node.groupId === groupId && state.value.selectedIds.includes(node.id),
  );
}

async function locateSelectedLayer() {
  const node = page.value.nodes.find((item) => item.id === state.value.selectedId);
  if (!node) {
    notice.value = "请先选择需要定位的图元";
    return;
  }
  layerSearch.value = "";
  if (node.groupId) {
    const next = new Set(collapsedGroupIds.value);
    next.delete(node.groupId);
    collapsedGroupIds.value = next;
  }
  const key = node.groupId ? `group:${node.groupId}` : `node:${node.id}`;
  await nextTick();
  const rows = layerTreeRef.value?.querySelectorAll<HTMLButtonElement>("[data-layer-key]");
  const row = [...(rows ?? [])].find((item) => item.dataset.layerKey === key);
  row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  notice.value = "已定位选中图元所在图层";
}

function selectLayerTarget(event: Event) {
  if (event.target instanceof HTMLSelectElement) {
    preferredLayerTargetId.value = event.target.value;
  }
}

function selectLayerPosition(event: Event) {
  if (!(event.target instanceof HTMLSelectElement)) return;
  if (event.target.value === "before" || event.target.value === "after") {
    layerInsertPosition.value = event.target.value;
  }
}

function moveSelectedLayerPrecisely() {
  const node = selected.value;
  if (!node || !canPreciselyMove.value || !layerTargetId.value) return;
  moveLayerPrecisely(node.id, layerTargetId.value, layerInsertPosition.value);
}

function layer(action: LayerAction) {
  apply(() => editor.reorderSelected(action), "已调整图元层级");
}

function changeZoom(delta: number) {
  const nextZoom = Math.max(0.5, Math.min(2, Math.round((zoom.value + delta) * 100) / 100));
  zoom.value = nextZoom;
  pan.value = studioViewportRect(page.value.size, canvasViewport.value, nextZoom, pan.value).pan;
}

function resetCanvasView() {
  zoom.value = 1;
  pan.value = { x: 0, y: 0 };
}

// 中键或 Alt + 画布空白处拖动，避免改变工程图元坐标。
function beginCanvasPan(event: PointerEvent): boolean {
  if (
    zoom.value <= 1 ||
    !(
      event.button === 1 ||
      (event.button === 0 && event.altKey && event.target === event.currentTarget)
    )
  ) {
    return false;
  }
  const matrix = svgRef.value?.getScreenCTM();
  if (!matrix || matrix.a === 0) return false;
  activePan = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: visibleRect.value.pan.x,
    originY: visibleRect.value.pan.y,
    scale: matrix.a,
  };
  svgRef.value?.setPointerCapture(event.pointerId);
  event.preventDefault();
  return true;
}

function updateCanvasPan(event: PointerEvent): boolean {
  const dragging = activePan;
  if (!dragging || dragging.pointerId !== event.pointerId) return false;
  pan.value = studioViewportRect(page.value.size, canvasViewport.value, zoom.value, {
    x: dragging.originX - (event.clientX - dragging.startX) / dragging.scale,
    y: dragging.originY - (event.clientY - dragging.startY) / dragging.scale,
  }).pan;
  return true;
}

function finishCanvasPan(event: PointerEvent): boolean {
  if (!activePan || activePan.pointerId !== event.pointerId) return false;
  activePan = null;
  return true;
}

function startCanvasPointer(event: PointerEvent) {
  if (!beginCanvasPan(event)) startMarquee(event);
}

function canvasPoint(clientX: number, clientY: number) {
  const matrix = svgRef.value?.getScreenCTM();
  if (!matrix) return null;
  return new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
}

function beginDrag(event: PointerEvent, id: string) {
  if (event.button !== 0) return;
  const point = canvasPoint(event.clientX, event.clientY);
  if (!point) return;
  const node = page.value.nodes.find((candidate) => candidate.id === id);
  if (!node) return;
  if (studioNodeLocked(node)) {
    editor.select(id, event.shiftKey);
    refresh();
    notice.value = "该图元已锁定，请在图层列表中解锁后编辑";
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
  if (page.value.nodes.some((item) => selectedIds.includes(item.id) && studioNodeLocked(item))) {
    refresh();
    notice.value = "所选内容包含已锁定图元，请先解锁";
    event.preventDefault();
    return;
  }
  refresh();
  activeDrag = {
    pointerId: event.pointerId,
    id,
    originX: node.transform.x,
    originY: node.transform.y,
    startX: point.x,
    startY: point.y,
    lastX: node.transform.x,
    lastY: node.transform.y,
  };
  svgRef.value?.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function updateDrag(event: PointerEvent) {
  const drag = activeDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const point = canvasPoint(event.clientX, event.clientY);
  if (!point) return;
  drag.lastX = drag.originX + point.x - drag.startX;
  drag.lastY = drag.originY + point.y - drag.startY;
  preview.value = { id: drag.id, x: drag.lastX, y: drag.lastY };
}

function finishDrag(event: PointerEvent) {
  const drag = activeDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const point = canvasPoint(event.clientX, event.clientY);
  const x = point ? drag.originX + point.x - drag.startX : drag.lastX;
  const y = point ? drag.originY + point.y - drag.startY : drag.lastY;
  activeDrag = null;
  preview.value = null;
  try {
    const snapshot = editor.snapshot();
    const movement = resolveDragSnap(
      snapshot.document,
      snapshot.selectedIds,
      x - drag.originX,
      y - drag.originY,
      { gridEnabled: gridSnap.value, nodeEnabled: nodeSnap.value },
      snapshot.activePageId,
    );
    editor.moveBy(movement.dx, movement.dy);
    refresh();
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  }
}

function beginGeometry(event: PointerEvent, handle: ResizeHandle | "rotate") {
  if (
    event.button !== 0 ||
    state.value.selectedIds.length !== 1 ||
    !selected.value ||
    studioNodeLocked(selected.value)
  )
    return;
  const point = canvasPoint(event.clientX, event.clientY);
  if (!point) return;
  activeGeometry = {
    pointerId: event.pointerId,
    nodeId: selected.value.id,
    handle,
    startX: point.x,
    startY: point.y,
    lastPatch: null,
  };
  rotating.value = handle === "rotate";
  activeDrag = null;
  activeMarquee = null;
  preview.value = null;
  marquee.value = null;
  geometryPreview.value = null;
  svgRef.value?.setPointerCapture(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}

function updateGeometry(event: PointerEvent) {
  const gesture = activeGeometry;
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
    const next = withNodeTransform(snapshot.document, gesture.nodeId, patch, snapshot.activePageId);
    gesture.lastPatch = patch;
    geometryPreview.value = next;
  } catch {
    // 越界或尺寸不合法时，保留最近一次合法预览。
  }
}

function finishGeometry(event: PointerEvent) {
  const gesture = activeGeometry;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  updateGeometry(event);
  activeGeometry = null;
  geometryPreview.value = null;
  rotating.value = false;
  if (gesture.lastPatch === null) return;
  try {
    if (editor.updateSelectedTransform(gesture.lastPatch)) {
      refresh();
      notice.value = "图元缩放或旋转已应用，可撤销";
    }
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  }
}

function cancelDrag() {
  activePan = null;
  activeDrag = null;
  activeMarquee = null;
  activeGeometry = null;
  preview.value = null;
  marquee.value = null;
  geometryPreview.value = null;
  rotating.value = false;
}

function displayTransform(id: string) {
  const node = displayNodes.value.find((item) => item.id === id);
  if (!node) throw new RangeError("未找到图元：" + id);
  const t = node.transform;
  return `rotate(${t.rotation} ${t.x + t.width / 2} ${t.y + t.height / 2})`;
}

function nudge(dx: number, dy: number) {
  if (!selected.value) return;
  apply(() => editor.moveBy(dx, dy), "已移动所选图元");
}

function changeLabel() {
  try {
    editor.setSelectedLabel(labelDraft.value);
    refresh();
    notice.value = "文案已更新，可撤销";
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  }
}

function undo() {
  editor.undo();
  refresh();
}

function redo() {
  editor.redo();
  refresh();
}

function changeGeometry(event: Event) {
  const values = new FormData(event.currentTarget as HTMLFormElement);
  const patch: NodeTransformPatch = {};
  for (const [key, label] of GEOMETRY_PROPERTY_FIELDS) {
    const raw = values.get(key);
    if (typeof raw !== "string" || raw.trim() === "") {
      notice.value = `请填写${label}`;
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      notice.value = `${label}必须是有限数`;
      return;
    }
    patch[key] = value;
  }
  try {
    const changed = editor.updateSelectedTransform(patch);
    refresh();
    notice.value = changed ? "图元几何属性已更新，可撤销" : "图元几何属性未发生变化";
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  }
}

async function runHistoryAction(
  label: string,
  action: () => Promise<void>,
  lockDraft = false,
): Promise<void> {
  if (historyActionInProgress || draftActionInProgress) return;
  historyActionInProgress = true;
  if (lockDraft) draftActionInProgress = true;
  historyBusy.value = true;
  historyError.value = "";
  try {
    await action();
  } catch (error) {
    const message = label + "失败：" + (error instanceof Error ? error.message : String(error));
    historyError.value = message;
    notice.value = message;
  } finally {
    historyActionInProgress = false;
    if (lockDraft) draftActionInProgress = false;
    historyBusy.value = false;
  }
}

async function refreshVersionHistory(): Promise<void> {
  await runHistoryAction("读取历史版本", async () => {
    const projectId = editor.snapshot().document.projectId;
    const rows = await projectVersions.list(projectId, { limit: HISTORY_PAGE_SIZE });
    if (editor.snapshot().document.projectId !== projectId) return;
    historyProjectId.value = projectId;
    historyRows.value = rows;
    historyHasMore.value = rows.length === HISTORY_PAGE_SIZE;
    inspectedVersion.value = null;
  });
}

async function loadMoreVersions(): Promise<void> {
  if (historyProjectId.value !== editor.snapshot().document.projectId) return;
  const last = historyRows.value[historyRows.value.length - 1];
  if (!last) return;
  await runHistoryAction("读取更多历史版本", async () => {
    const rows = await projectVersions.list(historyProjectId.value, {
      limit: HISTORY_PAGE_SIZE,
      beforeRevision: last.revision,
    });
    if (editor.snapshot().document.projectId !== historyProjectId.value) return;
    historyRows.value = [...historyRows.value, ...rows];
    historyHasMore.value = rows.length === HISTORY_PAGE_SIZE;
  });
}

async function createHistoryVersion(): Promise<void> {
  await runHistoryAction("创建历史快照", async () => {
    const document = editor.snapshot().document;
    const expectedRevision = await projectVersions.getHeadRevision(document.projectId);
    const saved = await projectVersions.append(document, expectedRevision);
    const rows = await projectVersions.list(document.projectId, { limit: HISTORY_PAGE_SIZE });
    if (editor.snapshot().document.projectId !== document.projectId) return;
    historyProjectId.value = document.projectId;
    historyRows.value = rows;
    historyHasMore.value = rows.length === HISTORY_PAGE_SIZE;
    inspectedVersion.value = saved;
    notice.value = `已创建本地历史版本 #${saved.revision}，不代表工程发布`;
  });
}

async function inspectHistoryVersion(revision: number): Promise<void> {
  await runHistoryAction("查看版本差异", async () => {
    const projectId = editor.snapshot().document.projectId;
    const saved = await projectVersions.get(projectId, revision);
    if (!saved) throw new TypeError("指定的历史版本不存在");
    if (editor.snapshot().document.projectId !== projectId) return;
    inspectedVersion.value = saved;
    notice.value = `已查看本地版本 #${revision} 的数据差异，当前画面未改变`;
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
        !window.confirm(
          `载入本地历史版本 #${revision} 将替换当前画面并清空撤销历史，未保存的修改可能丢失。建议先导出 JSON 备份。确认继续吗？`,
        )
      ) {
        return;
      }
      await pauseAutoSave();
      editor.loadDocument(saved.document);
      clearLayerDrag();
      layerSearch.value = "";
      collapsedGroupIds.value = new Set();
      cancelDrag();
      refresh();
      inspectedVersion.value = null;
      await checkLocalDraft();
      notice.value = `已载入本地版本 #${revision}，尚未保存草稿；自动保存已暂停，未进行正式发布`;
    },
    true,
  );
}

function onVersionMenuToggle(event: Event): void {
  const menu = event.currentTarget as HTMLDetailsElement;
  if (menu.open) void refreshVersionHistory();
}

async function toggleAutoSave() {
  if (draftActionInProgress) return;
  draftActionInProgress = true;
  try {
    if (autoSaveSession) {
      await pauseAutoSave();
      notice.value = "自动保存已暂停，当前工程不会被自动写入";
      return;
    }
    const session = await DraftAutoSaveSession.open(drafts, editor.snapshot().document);
    if (
      session.hasExistingDraft &&
      !window.confirm("数据库已有草稿，开启自动保存后新修改将覆盖该版本。确认开启吗？")
    ) {
      return;
    }
    autoSaveSession = session;
    autoSaveEnabled.value = true;
    notice.value = "IndexedDB 自动保存已开启：修改后约 1 秒保存，刷新后仍需手动恢复";
  } catch (error) {
    notice.value = "开启自动保存失败：" + (error instanceof Error ? error.message : String(error));
  } finally {
    draftActionInProgress = false;
  }
}

async function saveDraft() {
  if (draftActionInProgress) return;
  draftActionInProgress = true;
  try {
    await pauseAutoSave();
    const document = editor.snapshot().document;
    const current = await drafts.get(document.projectId);
    if (current && !window.confirm("数据库已有草稿，确认使用当前画面覆盖吗？")) return;
    const saved = await drafts.save(document, current?.revision ?? null);
    hasSavedDraft.value = true;
    notice.value = `已保存 IndexedDB 草稿（${saved.savedAt}），并非正式工程发布`;
  } catch (error) {
    notice.value = "保存草稿失败：" + (error instanceof Error ? error.message : String(error));
  } finally {
    draftActionInProgress = false;
  }
}

async function restoreDraft() {
  if (!window.confirm("恢复数据库草稿将替换当前画面并清空撤销历史，确认吗？")) return;
  if (draftActionInProgress) return;
  draftActionInProgress = true;
  try {
    await pauseAutoSave();
    const saved = await drafts.get(state.value.document.projectId);
    if (!saved) {
      hasSavedDraft.value = false;
      notice.value = "当前工程没有可恢复的数据库草稿";
      return;
    }
    editor.loadDocument(saved.document);
    clearLayerDrag();
    layerSearch.value = "";
    collapsedGroupIds.value = new Set();
    cancelDrag();
    refresh();
    hasSavedDraft.value = true;
    notice.value = `已恢复 IndexedDB 草稿（保存于 ${saved.savedAt}）`;
  } catch (error) {
    notice.value = "恢复草稿失败：" + (error instanceof Error ? error.message : String(error));
  } finally {
    draftActionInProgress = false;
  }
}

async function clearDraft() {
  if (!window.confirm("确定清除当前工程的 IndexedDB 草稿吗？当前画面不会改变。")) return;
  if (draftActionInProgress) return;
  draftActionInProgress = true;
  try {
    await pauseAutoSave();
    let current = null;
    try {
      current = await drafts.get(state.value.document.projectId);
    } catch (error) {
      if (!(error instanceof InvalidLegacyDraftError)) throw error;
      // 用户已明确确认清理损坏旧草稿，数据库修订号不一致仍会拒绝清除。
    }
    await drafts.remove(state.value.document.projectId, current?.revision ?? null);
    hasSavedDraft.value = false;
    notice.value = "数据库草稿已清除，当前编辑画面保持不变";
  } catch (error) {
    notice.value = "清除草稿失败：" + (error instanceof Error ? error.message : String(error));
  } finally {
    draftActionInProgress = false;
  }
}

function exportJson() {
  const json = JSON.stringify(state.value.document, null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${state.value.document.projectId}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  notice.value = "已导出本地 JSON 草稿（并非工程发布）";
}

async function importJson(event: Event) {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (historyActionInProgress || draftActionInProgress) {
    notice.value = "已有工程操作正在进行，请完成后再导入 JSON";
    return;
  }
  // 文件读取期间也持有互斥标记，避免历史载入与导入交错执行。
  draftActionInProgress = true;
  try {
    if (file.size > maxFileSize) throw new RangeError("JSON 文件不能超过 2 MiB");
    const parsed = JSON.parse(await file.text()) as unknown;
    await pauseAutoSave();
    const migratedFrom = editor.loadDocument(parsed);
    clearLayerDrag();
    layerSearch.value = "";
    collapsedGroupIds.value = new Set();
    preview.value = null;
    refresh();
    notice.value = migratedFrom
      ? `已将工程从 ${migratedFrom} 迁移至当前版本，请重新导出 JSON 草稿`
      : "工程 JSON 已校验并载入本地编辑器";
  } catch (error) {
    notice.value = "导入失败：" + (error instanceof Error ? error.message : String(error));
  } finally {
    draftActionInProgress = false;
  }
}
</script>

<template>
  <main class="studio-shell flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
    <header class="studio-toolbar">
      <div>
        <p class="scada-eyebrow">ADui SCADA · V0.2 Studio</p>
        <h1>SVG 组态编辑器</h1>
      </div>
      <div class="studio-actions">
        <div class="studio-history-actions">
          <button type="button" :disabled="!state.canUndo" @click="undo">撤销</button>
          <button type="button" :disabled="!state.canRedo" @click="redo">重做</button>
        </div>
        <div class="studio-save-actions">
          <button type="button" @click="saveDraft">保存草稿</button>
        </div>
        <details class="studio-file-menu">
          <summary>文件与草稿</summary>
          <div class="studio-file-popover">
            <button type="button" :aria-pressed="autoSaveEnabled" @click="toggleAutoSave">
              {{ autoSaveEnabled ? "暂停自动保存" : "开启自动保存" }}
            </button>
            <label class="studio-import">
              导入 JSON
              <input type="file" accept=".json,application/json" @change="importJson" />
            </label>
            <button type="button" @click="exportJson">导出 JSON</button>
            <button type="button" :disabled="!hasSavedDraft" @click="restoreDraft">恢复草稿</button>
            <button type="button" :disabled="!hasSavedDraft" @click="clearDraft">清除草稿</button>
          </div>
        </details>
        <details class="studio-version-menu" @toggle="onVersionMenuToggle">
          <summary>版本历史</summary>
          <div class="studio-version-panel" aria-label="本地工程历史版本">
            <p class="studio-version-help">
              当前工程：{{ state.document.projectId }} · 浏览器本地历史，不是正式发布
            </p>
            <div class="studio-version-tools">
              <button type="button" :disabled="historyBusy" @click="createHistoryVersion">
                创建快照
              </button>
              <button type="button" :disabled="historyBusy" @click="refreshVersionHistory">
                刷新
              </button>
            </div>
            <p v-if="historyBusy" class="studio-version-help">正在处理历史版本…</p>
            <p v-if="historyError" class="studio-version-error" role="alert">
              {{ historyError }}
            </p>
            <p v-if="!historyBusy && visibleHistoryRows.length === 0" class="studio-version-help">
              当前工程暂无本地历史版本。
            </p>
            <ol class="studio-version-list">
              <li
                v-for="item in visibleHistoryRows"
                :key="item.revision"
                class="studio-version-item"
              >
                <div class="studio-version-heading">
                  <strong>版本 #{{ item.revision }}</strong>
                  <time :datetime="item.createdAt">
                    {{ new Date(item.createdAt).toLocaleString("zh-CN") }}
                  </time>
                </div>
                <code :title="item.contentHash">{{ item.contentHash.slice(0, 16) }}…</code>
                <div class="studio-version-item-actions">
                  <button
                    type="button"
                    :disabled="historyBusy"
                    @click="inspectHistoryVersion(item.revision)"
                  >
                    查看差异
                  </button>
                  <button
                    type="button"
                    :disabled="historyBusy"
                    @click="loadHistoryVersion(item.revision)"
                  >
                    载入
                  </button>
                </div>
              </li>
            </ol>
            <div
              v-if="historyComparison && inspectedVersion"
              class="studio-version-comparison"
              role="status"
            >
              <strong>
                版本 #{{ inspectedVersion.revision }} ·
                {{ historyComparison.sameContent ? "内容与当前一致" : "与当前内容不同" }}
              </strong>
              <p>
                当前：{{ historyComparison.current.pageCount }} 页 /
                {{ historyComparison.current.nodeCount }} 图元 /
                {{ historyComparison.current.bindingCount }} 绑定
              </p>
              <p>
                历史：{{ historyComparison.historical.pageCount }} 页 /
                {{ historyComparison.historical.nodeCount }} 图元 /
                {{ historyComparison.historical.bindingCount }} 绑定
              </p>
            </div>
            <button
              v-if="visibleHistoryRows.length > 0 && historyHasMore"
              type="button"
              class="studio-version-more"
              :disabled="historyBusy"
              @click="loadMoreVersions"
            >
              加载更早版本
            </button>
          </div>
        </details>
      </div>
    </header>
    <div class="studio-page-bar" aria-label="工程页面管理">
      <div class="studio-page-tabs" aria-label="工程页面">
        <button
          v-for="item in state.document.pages"
          :key="item.id"
          type="button"
          :aria-current="item.id === state.activePageId ? 'page' : undefined"
          @click="switchPage(item.id)"
        >
          {{ item.name }}
        </button>
      </div>
      <details class="studio-page-menu">
        <summary>页面管理</summary>
        <div class="studio-page-actions">
          <button type="button" :disabled="state.document.pages.length >= 100" @click="createPage">
            + 新建页面
          </button>
          <button
            type="button"
            :disabled="state.document.pages.length >= 100"
            @click="duplicatePage"
          >
            复制页面
          </button>
          <button type="button" :disabled="activePageIndex <= 0" @click="movePage('previous')">
            页面前移
          </button>
          <button
            type="button"
            :disabled="activePageIndex >= state.document.pages.length - 1"
            @click="movePage('next')"
          >
            页面后移
          </button>
          <button type="button" @click="renamePage">重命名</button>
          <button type="button" :disabled="state.document.pages.length <= 1" @click="deletePage">
            删除当前页
          </button>
        </div>
      </details>
    </div>
    <div
      class="studio-workspace"
      :data-left-collapsed="!leftPanelVisible"
      :data-right-collapsed="!rightPanelVisible"
    >
      <aside class="studio-panel studio-panel-layers min-h-0 min-w-0" aria-label="图元列表">
        <div class="studio-pane-heading">
          <h2>资源与图层</h2>
          <span class="studio-count">{{ page.nodes.length }}</span>
        </div>
        <div class="studio-library-label">图元库 · 点击添加</div>
        <div class="studio-add">
          <button type="button" @click="addSymbol('tank')">+ 水箱</button>
          <button type="button" @click="addSymbol('pump')">+ 水泵</button>
          <button type="button" @click="addSymbol('pipe')">+ 管道</button>
          <button type="button" @click="addSymbol('label')">+ 文本</button>
        </div>
        <div class="studio-tree-section-title">图层列表</div>
        <div class="studio-tree-controls">
          <label class="studio-field">
            搜索图元或组合
            <TInput
              v-model="layerSearch"
              type="search"
              aria-label="搜索图层"
              :maxlength="128"
              placeholder="图元 ID、类型、文字或组合 ID"
            />
          </label>
          <TButton
            variant="outline"
            size="small"
            :disabled="state.selectedIds.length === 0"
            @click="locateSelectedLayer"
          >
            定位选中图层
          </TButton>
          <TButton
            variant="text"
            size="small"
            :disabled="layerSearch.length === 0"
            @click="layerSearch = ''"
          >
            <CloseIcon /> 清除搜索
          </TButton>
        </div>
        <div ref="layerTreeRef" class="studio-layer-tree min-w-0" aria-label="图层树">
          <p v-if="layerEntries.length === 0" class="studio-tree-empty">
            {{ page.nodes.length === 0 ? "当前页面暂无图元" : "没有匹配的图元或组合" }}
          </p>
          <template
            v-for="entry in layerEntries"
            :key="entry.kind === 'group' ? entry.groupId : entry.node.id"
          >
            <div v-if="entry.kind === 'group'" class="studio-tree-group">
              <div class="studio-tree-group-heading">
                <button
                  type="button"
                  class="studio-tree-toggle"
                  :aria-label="`${groupExpanded(entry.groupId) ? '折叠' : '展开'}组合 ${entry.groupId}`"
                  :aria-expanded="groupExpanded(entry.groupId)"
                  :disabled="isLayerSearching"
                  @click="toggleLayerGroup(entry.groupId)"
                >
                  {{ groupExpanded(entry.groupId) ? "▾" : "▸" }}
                </button>
                <button
                  type="button"
                  class="studio-layer"
                  :data-layer-key="`group:${entry.groupId}`"
                  :data-selected="layerGroupSelected(entry.groupId)"
                  :data-hidden="entry.hiddenCount === entry.totalCount"
                  :data-locked="entry.hasLockedMember"
                  :data-drop-position="
                    layerDrop?.id === entry.anchorNodeId ? layerDrop.position : undefined
                  "
                  :draggable="!entry.hasLockedMember"
                  title="拖动整个组合调整图层"
                  @dragstart="startLayerDrag($event, entry.anchorNodeId)"
                  @dragover="overLayer($event, entry.anchorNodeId)"
                  @drop="dropLayer($event, entry.anchorNodeId)"
                  @dragend="clearLayerDrag"
                  @click="selectNode(entry.anchorNodeId, $event.shiftKey)"
                >
                  <span class="studio-layer-identity">
                    <span aria-hidden="true">⋮⋮</span> 组合 {{ entry.groupId }}
                  </span>
                  <small>
                    {{ entry.totalCount }} 个成员
                    {{
                      entry.members.length !== entry.totalCount
                        ? ` · 匹配 ${entry.members.length}`
                        : ""
                    }}
                    {{ entry.fragmented ? " · 层序不连续" : "" }}
                    {{ entry.hasLockedMember ? " · 有锁定成员" : "" }}
                    {{ entry.hiddenCount > 0 ? ` · 隐藏 ${entry.hiddenCount}` : "" }}
                  </small>
                </button>
              </div>
              <div
                v-if="groupExpanded(entry.groupId)"
                class="studio-tree-members"
                role="group"
                :aria-label="`组合 ${entry.groupId} 的成员`"
              >
                <button
                  v-for="node in entry.members"
                  :key="node.id"
                  type="button"
                  class="studio-layer"
                  :data-layer-key="`node:${node.id}`"
                  :data-selected="state.selectedIds.includes(node.id)"
                  :data-hidden="!studioNodeVisible(node)"
                  :data-locked="studioNodeLocked(node)"
                  :data-drop-position="layerDrop?.id === node.id ? layerDrop.position : undefined"
                  :draggable="!studioNodeLocked(node) && !lockedLayerGroups.has(entry.groupId)"
                  title="拖动成员时移动整个组合"
                  @dragstart="startLayerDrag($event, node.id)"
                  @dragover="overLayer($event, node.id)"
                  @drop="dropLayer($event, node.id)"
                  @dragend="clearLayerDrag"
                  @click="selectNode(node.id, $event.shiftKey)"
                >
                  <span class="studio-layer-identity">
                    <span aria-hidden="true">⋮⋮</span> {{ node.id }}
                  </span>
                  <small>
                    {{ node.type }}
                    {{ studioNodeLocked(node) ? " · 已锁定" : "" }}
                    {{ !studioNodeVisible(node) ? " · 已隐藏" : "" }}
                  </small>
                </button>
              </div>
            </div>
            <button
              v-else
              type="button"
              class="studio-layer"
              :data-layer-key="`node:${entry.node.id}`"
              :data-selected="state.selectedIds.includes(entry.node.id)"
              :data-hidden="!studioNodeVisible(entry.node)"
              :data-locked="studioNodeLocked(entry.node)"
              :data-drop-position="layerDrop?.id === entry.node.id ? layerDrop.position : undefined"
              :draggable="!studioNodeLocked(entry.node)"
              title="拖动调整图层"
              @dragstart="startLayerDrag($event, entry.node.id)"
              @dragover="overLayer($event, entry.node.id)"
              @drop="dropLayer($event, entry.node.id)"
              @dragend="clearLayerDrag"
              @click="selectNode(entry.node.id, $event.shiftKey)"
            >
              <span class="studio-layer-identity">
                <span aria-hidden="true">⋮⋮</span> {{ entry.node.id }}
              </span>
              <small>
                {{ entry.node.type }}
                {{ studioNodeLocked(entry.node) ? " · 已锁定" : "" }}
                {{ !studioNodeVisible(entry.node) ? " · 已隐藏" : "" }}
              </small>
            </button>
          </template>
        </div>
        <details class="studio-side-more">
          <summary>跨页操作与使用帮助</summary>
          <div class="studio-copy-tools">
            <label class="studio-field">
              复制选中图元到
              <select
                aria-label="跨页面复制目标"
                :value="copyTargetPageId"
                :disabled="copyTargetPages.length === 0"
                @change="selectCopyTarget"
              >
                <option v-if="copyTargetPages.length === 0" value="">暂无其他页面</option>
                <option v-for="item in copyTargetPages" :key="item.id" :value="item.id">
                  {{ item.name }}
                </option>
              </select>
            </label>
            <button
              type="button"
              :disabled="state.selectedIds.length === 0 || !copyTargetPageId"
              @click="copySelectedToPage"
            >
              复制选中图元
            </button>
          </div>
          <p class="studio-tip">Shift+点击多选；拖动空白区域框选；Ctrl+A 全选，Del 删除。</p>
        </details>
      </aside>
      <section class="studio-stage min-h-0 min-w-0" aria-label="组态画布">
        <div class="studio-stage-caption">
          <span
            >{{ page.name }} · {{ page.size.width }} × {{ page.size.height }} · 静态模拟预览</span
          >
          <details class="studio-view-menu">
            <summary aria-label="视图设置">视图设置</summary>
            <div class="studio-view-popover">
              <div class="studio-view-section">
                <p>网格与吸附</p>
                <div class="studio-canvas-settings">
                  <label class="studio-canvas-option">
                    <input v-model="gridVisible" type="checkbox" />
                    显示网格
                  </label>
                  <label class="studio-canvas-option">
                    <input v-model="gridSnap" type="checkbox" />
                    网格吸附
                  </label>
                  <label class="studio-canvas-option">
                    <input v-model="nodeSnap" type="checkbox" />
                    图元吸附
                  </label>
                </div>
              </div>
              <div class="studio-view-section">
                <p>侧栏显示</p>
                <div class="studio-panel-toggles" aria-label="面板显示">
                  <button
                    type="button"
                    :aria-pressed="leftPanelVisible"
                    @click="leftPanelVisible = !leftPanelVisible"
                  >
                    {{ leftPanelVisible ? "隐藏图层" : "显示图层" }}
                  </button>
                  <button
                    type="button"
                    :aria-pressed="rightPanelVisible"
                    @click="rightPanelVisible = !rightPanelVisible"
                  >
                    {{ rightPanelVisible ? "隐藏属性" : "显示属性" }}
                  </button>
                </div>
              </div>
            </div>
          </details>
          <div class="studio-zoom" aria-label="画布缩放">
            <button type="button" :disabled="zoom <= 0.5" @click="changeZoom(-0.25)">−</button>
            <button type="button" @click="resetCanvasView">
              {{ zoom === 1 ? "适应" : `${Math.round(zoom * 100)}%` }}
            </button>
            <button type="button" :disabled="zoom >= 2" @click="changeZoom(0.25)">+</button>
          </div>
        </div>
        <div class="studio-canvas-scroll" tabindex="0" aria-label="组态网格工作区">
          <div class="studio-canvas-board">
            <svg
              ref="svgRef"
              class="studio-svg"
              :data-rotating="rotating ? 'true' : undefined"
              :viewBox="`${visibleRect.x} ${visibleRect.y} ${visibleRect.width} ${visibleRect.height}`"
              preserveAspectRatio="xMidYMid meet"
              aria-label="可编辑 SVG 画布；放大后可用中键或 Alt 加空白处拖动平移"
              @pointermove="updatePointer"
              @pointerup="finishPointer"
              @pointercancel="cancelDrag"
              @pointerdown="startCanvasPointer"
            >
              <defs>
                <pattern
                  id="scada-studio-grid"
                  :width="DEFAULT_GRID_SIZE"
                  :height="DEFAULT_GRID_SIZE"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    :d="`M ${DEFAULT_GRID_SIZE} 0 L 0 0 0 ${DEFAULT_GRID_SIZE}`"
                    fill="none"
                    stroke="#8295ac"
                    stroke-width="0.8"
                    opacity="0.45"
                  />
                </pattern>
              </defs>
              <image
                :href="imageUrl"
                :width="page.size.width"
                :height="page.size.height"
                pointer-events="none"
              />
              <rect
                v-if="gridVisible"
                :x="visibleRect.x"
                :y="visibleRect.y"
                :width="visibleRect.width"
                :height="visibleRect.height"
                fill="url(#scada-studio-grid)"
                pointer-events="none"
              />
              <rect
                class="studio-page-boundary"
                :x="0"
                :y="0"
                :width="page.size.width"
                :height="page.size.height"
                fill="none"
                vector-effect="non-scaling-stroke"
                pointer-events="none"
              />
              <g v-for="node in displayNodes" :key="node.id" :transform="displayTransform(node.id)">
                <rect
                  role="button"
                  tabindex="0"
                  :aria-label="`选择并拖动 ${node.id}`"
                  :x="node.transform.x"
                  :y="node.transform.y"
                  :width="node.transform.width"
                  :height="node.transform.height"
                  fill="transparent"
                  :stroke="
                    state.selectedId === node.id
                      ? '#f0ae4d'
                      : state.selectedIds.includes(node.id)
                        ? '#39c9ba'
                        : 'transparent'
                  "
                  stroke-width="2"
                  stroke-dasharray="6 4"
                  class="studio-hitbox"
                  @pointerdown="beginDrag($event, node.id)"
                  @keydown.enter.prevent="selectNode(node.id, $event.shiftKey)"
                  @keydown.space.prevent="selectNode(node.id, $event.shiftKey)"
                />
                <template
                  v-if="
                    state.selectedIds.length === 1 &&
                    state.selectedId === node.id &&
                    !studioNodeLocked(node)
                  "
                >
                  <rect
                    v-for="handle in RESIZE_HANDLES"
                    :key="handle"
                    class="studio-resize-handle"
                    :data-handle="handle"
                    :aria-label="`缩放图元${RESIZE_HANDLE_LABELS[handle]}`"
                    :x="resizeHandlePosition(node.transform, handle).x - 5"
                    :y="resizeHandlePosition(node.transform, handle).y - 5"
                    :width="10"
                    :height="10"
                    @pointerdown.stop="beginGeometry($event, handle)"
                  >
                    <title>按住 Shift 保持宽高比</title>
                  </rect>
                  <line
                    class="studio-rotation-stem"
                    :x1="node.transform.x + node.transform.width / 2"
                    :x2="node.transform.x + node.transform.width / 2"
                    :y1="node.transform.y"
                    :y2="node.transform.y - 26"
                    pointer-events="none"
                  />
                  <circle
                    class="studio-rotation-handle"
                    aria-label="旋转图元，按住 Shift 可按 15 度吸附"
                    :cx="node.transform.x + node.transform.width / 2"
                    :cy="node.transform.y - 26"
                    :r="7"
                    @pointerdown.stop="beginGeometry($event, 'rotate')"
                  />
                </template>
              </g>
              <line
                v-if="snapResult?.verticalGuide != null"
                class="studio-alignment-guide"
                :x1="snapResult.verticalGuide"
                :x2="snapResult.verticalGuide"
                :y1="0"
                :y2="page.size.height"
                pointer-events="none"
              />
              <line
                v-if="snapResult?.horizontalGuide != null"
                class="studio-alignment-guide"
                :x1="0"
                :x2="page.size.width"
                :y1="snapResult.horizontalGuide"
                :y2="snapResult.horizontalGuide"
                pointer-events="none"
              />
              <rect
                v-if="marquee"
                class="studio-marquee"
                :x="Math.min(marquee.startX, marquee.x)"
                :y="Math.min(marquee.startY, marquee.y)"
                :width="Math.abs(marquee.x - marquee.startX)"
                :height="Math.abs(marquee.y - marquee.startY)"
                pointer-events="none"
              />
            </svg>
          </div>
        </div>
      </section>
      <aside class="studio-panel studio-panel-properties min-h-0 min-w-0" aria-label="图元属性">
        <h2>属性 · 已选 {{ state.selectedIds.length }}</h2>
        <template v-if="selected">
          <p>
            <strong>{{ selected.id }}</strong> · {{ selected.type }}
          </p>
          <form
            v-if="state.selectedIds.length === 1"
            :key="`${selected.id}:${JSON.stringify(selected.transform)}`"
            class="studio-geometry"
            novalidate
            @submit.prevent="changeGeometry"
          >
            <label v-for="[key, label] in GEOMETRY_PROPERTY_FIELDS" :key="key">
              {{ label }}
              <input
                type="number"
                :name="key"
                step="any"
                :value="selected.transform[key]"
                :disabled="studioNodeLocked(selected)"
              />
            </label>
            <TButton type="submit" :disabled="studioNodeLocked(selected)">应用几何属性</TButton>
          </form>
          <p v-else class="studio-tip">当前为多选状态，请单选一个图元编辑几何属性。</p>
          <p class="studio-tip">拖动画布中的虚线框，或使用方向按钮微调。每次操作可撤销。</p>
          <div class="studio-nudge">
            <TButton type="button" @click="nudge(-1, 0)">←</TButton>
            <TButton type="button" @click="nudge(0, -1)">↑</TButton>
            <TButton type="button" @click="nudge(0, 1)">↓</TButton>
            <TButton type="button" @click="nudge(1, 0)">→</TButton>
          </div>
          <label
            v-if="selected.type === 'label' && state.selectedIds.length === 1"
            class="studio-field"
          >
            显示文案
            <TInput v-model="labelDraft" :maxlength="256" :disabled="studioNodeLocked(selected)" />
            <TButton type="button" :disabled="studioNodeLocked(selected)" @click="changeLabel">
              应用文案
            </TButton>
          </label>
          <h3>Tag 绑定（项目数据）</h3>
          <label v-if="bindingSlot" class="studio-field">
            {{ bindingSlot }} · 选择模拟 Tag
            <select
              :value="selectedTagId"
              :aria-label="selected.id + ' 的 ' + bindingSlot + ' Tag 绑定'"
              @change="changeTagBinding"
            >
              <option value="">不绑定</option>
              <option v-if="missingBindingTag" :value="selectedTagId" disabled>
                {{ selectedTagId }}（不在当前模拟候选中）
              </option>
              <option v-for="option in demoTagCandidates" :key="option.tagId" :value="option.tagId">
                {{ option.displayName }} · {{ option.tagId }} · {{ TAG_DATA_TYPE_LABELS[option.dataType]
                }}{{ option.unit ? " · " + option.unit : "" }}
              </option>
            </select>
          </label>
          <p v-if="selectedTagDefinition" class="studio-tip">
            {{ selectedTagDefinition.description }}；质量由实时 Tag 数据动态提供
          </p>
          <p v-else-if="!bindingSlot" class="studio-tip">
            请单选未组合的水箱、水泵或文本图元；管道暂不支持动态 Tag 绑定。
          </p>
          <p v-for="(binding, slot) in selected.bindings" :key="slot" class="studio-binding">
            {{ slot }} → {{ binding.tagId }}
          </p>
        </template>
        <p v-else class="studio-tip">选择左侧图元或画布中的图元查看属性。</p>
        <details class="studio-advanced">
          <summary>高级图元与图层操作</summary>
          <div class="studio-advanced-content">
            <div class="studio-toolbox">
              <div class="studio-tool-group" aria-label="图层锁定与可见性">
                <TButton
                  type="button"
                  :disabled="state.selectedIds.length === 0"
                  @click="changeSelectedLocked(true)"
                >
                  锁定所选
                </TButton>
                <TButton
                  type="button"
                  :disabled="state.selectedIds.length === 0"
                  @click="changeSelectedLocked(false)"
                >
                  解锁所选
                </TButton>
                <TButton
                  type="button"
                  :disabled="state.selectedIds.length === 0 || hasLockedSelection"
                  @click="changeSelectedVisible(false)"
                >
                  隐藏所选
                </TButton>
                <TButton
                  type="button"
                  :disabled="state.selectedIds.length === 0 || hasLockedSelection"
                  @click="changeSelectedVisible(true)"
                >
                  显示所选
                </TButton>
              </div>
              <div class="studio-tool-group" aria-label="图元组合">
                <TButton
                  type="button"
                  :disabled="!canGroup"
                  @click="apply(() => editor.groupSelected(), '已组合所选图元，可撤销')"
                >
                  组合所选
                </TButton>
                <TButton
                  type="button"
                  :disabled="!hasGroupedSelection"
                  @click="apply(() => editor.ungroupSelected(), '已解组，可撤销')"
                >
                  解组
                </TButton>
              </div>
              <div class="studio-tool-group" aria-label="图元剪贴板">
                <TButton
                  type="button"
                  :disabled="state.selectedIds.length === 0"
                  @click="apply(() => editor.copySelected(), '已复制所选图元到会话剪贴板')"
                >
                  复制所选
                </TButton>
                <TButton
                  type="button"
                  :disabled="state.selectedIds.length === 0"
                  @click="apply(() => editor.cutSelected(), '已剪切图元，可撤销')"
                >
                  剪切所选
                </TButton>
                <TButton
                  type="button"
                  :disabled="!state.hasClipboard"
                  @click="apply(() => editor.pasteClipboard(), '已粘贴图元，可撤销')"
                >
                  粘贴图元
                </TButton>
                <TButton
                  type="button"
                  :disabled="state.selectedIds.length === 0"
                  @click="apply(() => editor.deleteSelected(), '已删除图元，可撤销')"
                >
                  删除所选
                </TButton>
              </div>
              <div class="studio-exact-layer" aria-label="图层精确插入">
                <label class="studio-field">
                  目标图元
                  <select
                    aria-label="图层插入目标"
                    :value="layerTargetId"
                    :disabled="!canPreciselyMove || layerTargetNodes.length === 0"
                    @change="selectLayerTarget"
                  >
                    <option value="">请选择目标图元</option>
                    <option v-for="node in layerTargetNodes" :key="node.id" :value="node.id">
                      {{ node.id }}{{ node.groupId ? "（组合）" : "" }}
                    </option>
                  </select>
                </label>
                <label class="studio-field">
                  插入位置
                  <select
                    aria-label="图层插入位置"
                    :value="layerInsertPosition"
                    @change="selectLayerPosition"
                  >
                    <option value="after">目标上方（更靠前）</option>
                    <option value="before">目标下方（更靠后）</option>
                  </select>
                </label>
                <TButton
                  type="button"
                  :disabled="!canPreciselyMove || !layerTargetId"
                  @click="moveSelectedLayerPrecisely"
                >
                  移动到指定层
                </TButton>
              </div>
              <div class="studio-tool-group" aria-label="图层排序">
                <TButton type="button" :disabled="!selected" @click="layer('back')">置底</TButton>
                <TButton type="button" :disabled="!selected" @click="layer('backward')"
                  >下移层</TButton
                >
                <TButton type="button" :disabled="!selected" @click="layer('forward')"
                  >上移层</TButton
                >
                <TButton type="button" :disabled="!selected" @click="layer('front')">置顶</TButton>
              </div>
              <h3>多选对齐（以最后选中的图元为准）</h3>
              <div class="studio-tool-group" aria-label="图元对齐">
                <TButton
                  type="button"
                  :disabled="state.selectedIds.length < 2 || hasGroupedSelection"
                  @click="align('left')"
                >
                  左
                </TButton>
                <TButton
                  type="button"
                  :disabled="state.selectedIds.length < 2 || hasGroupedSelection"
                  @click="align('hcenter')"
                >
                  水平居中
                </TButton>
                <TButton
                  type="button"
                  :disabled="state.selectedIds.length < 2 || hasGroupedSelection"
                  @click="align('right')"
                >
                  右
                </TButton>
                <TButton
                  type="button"
                  :disabled="state.selectedIds.length < 2 || hasGroupedSelection"
                  @click="align('top')"
                >
                  上
                </TButton>
                <TButton
                  type="button"
                  :disabled="state.selectedIds.length < 2 || hasGroupedSelection"
                  @click="align('vcenter')"
                >
                  垂直居中
                </TButton>
                <TButton
                  type="button"
                  :disabled="state.selectedIds.length < 2 || hasGroupedSelection"
                  @click="align('bottom')"
                >
                  下
                </TButton>
              </div>
            </div>
          </div>
        </details>
      </aside>
    </div>
    <footer class="studio-statusbar">
      <div class="studio-status-message">
        <span class="studio-status-led" aria-hidden="true" />
        <p role="status" class="studio-notice">
          {{ notice }}
          <span v-if="hasSavedDraft && !autoSaveEnabled">
            · 已发现本地草稿，可点击「恢复草稿」确认加载
          </span>
        </p>
      </div>
      <div class="studio-status-meta">
        <span>仅模拟数据 · 无设备写入</span>
        <span>{{ page.nodes.length }} 个图元 · 已选 {{ state.selectedIds.length }}</span>
        <span
          title="Ctrl+A 全选，Ctrl+C 复制，Ctrl+X 剪切，Ctrl+V 粘贴，Ctrl+Z 撤销，Ctrl+Shift+Z / Ctrl+Y 重做，方向键微移，Shift+方向键移动 10 格，Esc 取消选择"
          >快捷键 ⓘ</span
        >
      </div>
    </footer>
  </main>
</template>
