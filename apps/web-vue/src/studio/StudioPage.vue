<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import {
  WaterTreatmentSimulator,
  waterTreatmentDemoDocument,
  waterTreatmentDemoTagOptions,
  DraftAutoSaveSession,
  LOCAL_DRAFT_AUTO_SAVE_DELAY_MS,
} from "@adui/scada-core";
import type { ScadaDocument } from "@adui/scada-core";
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
const editor = new DocumentEditor(waterTreatmentDemoDocument);
const state = shallowRef(editor.snapshot());
const preview = shallowRef<{ id: string; x: number; y: number } | null>(null);
const geometryPreview = shallowRef<ScadaDocument | null>(null);
const rotating = ref(false);
const marquee = shallowRef<MarqueeState | null>(null);
const labelDraft = ref("");
const preferredCopyTargetPageId = ref("");
const notice = ref("可手动保存浏览器本地草稿 · 尚未连接工程保存服务");
const hasSavedDraft = ref(false);
const autoSaveEnabled = ref(false);
let autoSaveSession: DraftAutoSaveSession | null = null;
let draftActionInProgress = false;
let unsubscribeDraft: (() => void) | null = null;
const zoom = ref(1);
const gridVisible = ref(true);
const gridSnap = ref(true);
const nodeSnap = ref(true);
const svgRef = ref<SVGSVGElement | null>(null);

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

const page = computed(() => {
  const result = state.value.document.pages.find((item) => item.id === state.value.activePageId);
  if (!result) throw new Error("工程文档不包含页面");
  return result;
});
const selected = computed(() =>
  page.value.nodes.find((node) => node.id === state.value.selectedId),
);
const hasGroupedSelection = computed(() =>
  page.value.nodes.some(
    (node) => node.groupId !== undefined && state.value.selectedIds.includes(node.id),
  ),
);
const canGroup = computed(() => state.value.selectedIds.length >= 2 && !hasGroupedSelection.value);
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
  return node && state.value.selectedIds.length === 1 && !node.groupId
    ? editableTagSlot(node.type)
    : null;
});
const demoTagCandidates = computed(() => {
  const slot = bindingSlot.value;
  return slot === null
    ? []
    : waterTreatmentDemoTagOptions.filter((option) => option.slots.includes(slot));
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
const displayNodes = computed(
  () =>
    displayDocument.value.pages.find((item) => item.id === state.value.activePageId)?.nodes ?? [],
);
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

  if (command && !event.altKey) {
    if (key === "z") handled = event.shiftKey ? editor.redo() : editor.undo();
    else if (key === "y") handled = editor.redo();
    else if (key === "a") {
      editor.selectMany(page.value.nodes.map((node) => node.id));
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
});
onUnmounted(() => {
  window.removeEventListener("keydown", handleKey);
  unsubscribeDraft?.();
  void pauseAutoSave().then(() => drafts.close());
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
  updateDrag(event);
  updateMarquee(event);
  updateGeometry(event);
}

function finishPointer(event: PointerEvent) {
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
    cancelDrag();
    zoom.value = 1;
    refresh();
    notice.value = "已切换编辑页面；页面切换不会修改工程草稿";
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  }
}

function createPage() {
  apply(() => {
    editor.createPage();
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

function layer(action: LayerAction) {
  apply(() => editor.reorderSelected(action), "已调整图元层级");
}

function changeZoom(delta: number) {
  zoom.value = Math.max(0.5, Math.min(2, Math.round((zoom.value + delta) * 100) / 100));
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
  if (event.shiftKey) {
    editor.select(id, true);
    refresh();
    event.preventDefault();
    return;
  }
  if (!editor.snapshot().selectedIds.includes(id)) editor.select(id);
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
  if (event.button !== 0 || state.value.selectedIds.length !== 1 || !selected.value) return;
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
  for (const [key, label] of geometryFields) {
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
  try {
    if (file.size > maxFileSize) throw new RangeError("JSON 文件不能超过 2 MiB");
    const parsed = JSON.parse(await file.text()) as unknown;
    await pauseAutoSave();
    const migratedFrom = editor.loadDocument(parsed);
    preview.value = null;
    refresh();
    notice.value = migratedFrom
      ? `已将工程从 ${migratedFrom} 迁移至当前版本，请重新导出 JSON 草稿`
      : "工程 JSON 已校验并载入本地编辑器";
  } catch (error) {
    notice.value = "导入失败：" + (error instanceof Error ? error.message : String(error));
  }
}
</script>

<template>
  <main class="studio-shell">
    <header class="studio-toolbar">
      <div>
        <p class="scada-eyebrow">ADui SCADA · V0.2 Studio</p>
        <h1>SVG 组态编辑器</h1>
      </div>
      <div class="studio-actions">
        <button type="button" :disabled="!state.canUndo" @click="undo">撤销</button>
        <button type="button" :disabled="!state.canRedo" @click="redo">重做</button>
        <label class="studio-import">
          导入 JSON
          <input type="file" accept=".json,application/json" @change="importJson" />
        </label>
        <button type="button" @click="exportJson">导出 JSON</button>
        <button type="button" @click="saveDraft">保存草稿</button>
        <button type="button" :aria-pressed="autoSaveEnabled" @click="toggleAutoSave">
          {{ autoSaveEnabled ? "暂停自动保存" : "开启自动保存" }}
        </button>
        <button type="button" :disabled="!hasSavedDraft" @click="restoreDraft">恢复草稿</button>
        <button type="button" :disabled="!hasSavedDraft" @click="clearDraft">清除草稿</button>
      </div>
    </header>
    <p role="status" class="studio-notice">
      {{ notice }}
      <span v-if="hasSavedDraft && !autoSaveEnabled">
        · 已发现本地草稿，可点击「恢复草稿」确认加载
      </span>
    </p>
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
      <div class="studio-page-actions">
        <button type="button" :disabled="state.document.pages.length >= 100" @click="createPage">
          + 新建页面
        </button>
        <button type="button" :disabled="state.document.pages.length >= 100" @click="duplicatePage">
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
    </div>
    <div class="studio-workspace">
      <aside class="studio-panel" aria-label="图元列表">
        <h2>图元 · {{ page.nodes.length }}</h2>
        <p class="studio-tip">Shift+点击多选；拖动空白区域框选；Ctrl+A 全选，Del 删除。</p>
        <div class="studio-add">
          <button type="button" @click="addSymbol('tank')">+ 水箱</button>
          <button type="button" @click="addSymbol('pump')">+ 水泵</button>
          <button type="button" @click="addSymbol('pipe')">+ 管道</button>
          <button type="button" @click="addSymbol('label')">+ 文本</button>
        </div>
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
        <button
          v-for="node in page.nodes"
          :key="node.id"
          type="button"
          class="studio-layer"
          :data-selected="state.selectedIds.includes(node.id)"
          @click="selectNode(node.id, $event.shiftKey)"
        >
          <span>{{ node.id }}</span
          ><small>{{ node.type }}{{ node.groupId ? ` · 组合 ${node.groupId}` : "" }}</small>
        </button>
      </aside>
      <section class="studio-stage" aria-label="组态画布">
        <div class="studio-stage-caption">
          <span
            >{{ page.name }} · {{ page.size.width }} × {{ page.size.height }} · 静态模拟预览</span
          >
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
          <div class="studio-zoom" aria-label="画布缩放">
            <button type="button" :disabled="zoom <= 0.5" @click="changeZoom(-0.25)">−</button>
            <button type="button" @click="zoom = 1">{{ Math.round(zoom * 100) }}%</button>
            <button type="button" :disabled="zoom >= 2" @click="changeZoom(0.25)">+</button>
          </div>
        </div>
        <svg
          ref="svgRef"
          class="studio-svg"
          :data-rotating="rotating ? 'true' : undefined"
          :style="{ width: `${zoom * 100}%` }"
          :viewBox="`0 0 ${page.size.width} ${page.size.height}`"
          aria-label="可编辑 SVG 画布"
          @pointermove="updatePointer"
          @pointerup="finishPointer"
          @pointercancel="cancelDrag"
          @pointerdown.self="startMarquee"
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
            :width="page.size.width"
            :height="page.size.height"
            fill="url(#scada-studio-grid)"
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
            <template v-if="state.selectedIds.length === 1 && state.selectedId === node.id">
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
      </section>
      <aside class="studio-panel" aria-label="图元属性">
        <h2>属性 · 已选 {{ state.selectedIds.length }}</h2>
        <div class="studio-toolbox">
          <div class="studio-tool-group" aria-label="图元组合">
            <button
              type="button"
              :disabled="!canGroup"
              @click="apply(() => editor.groupSelected(), '已组合所选图元，可撤销')"
            >
              组合所选
            </button>
            <button
              type="button"
              :disabled="!hasGroupedSelection"
              @click="apply(() => editor.ungroupSelected(), '已解组，可撤销')"
            >
              解组
            </button>
          </div>
          <button
            type="button"
            :disabled="state.selectedIds.length === 0"
            @click="apply(() => editor.deleteSelected(), '已删除图元，可撤销')"
          >
            删除所选
          </button>
          <div class="studio-tool-group" aria-label="图层排序">
            <button type="button" :disabled="!selected" @click="layer('back')">置底</button>
            <button type="button" :disabled="!selected" @click="layer('backward')">下移层</button>
            <button type="button" :disabled="!selected" @click="layer('forward')">上移层</button>
            <button type="button" :disabled="!selected" @click="layer('front')">置顶</button>
          </div>
          <h3>多选对齐（以最后选中的图元为准）</h3>
          <div class="studio-tool-group" aria-label="图元对齐">
            <button
              type="button"
              :disabled="state.selectedIds.length < 2 || hasGroupedSelection"
              @click="align('left')"
            >
              左
            </button>
            <button
              type="button"
              :disabled="state.selectedIds.length < 2 || hasGroupedSelection"
              @click="align('hcenter')"
            >
              水平居中
            </button>
            <button
              type="button"
              :disabled="state.selectedIds.length < 2 || hasGroupedSelection"
              @click="align('right')"
            >
              右
            </button>
            <button
              type="button"
              :disabled="state.selectedIds.length < 2 || hasGroupedSelection"
              @click="align('top')"
            >
              上
            </button>
            <button
              type="button"
              :disabled="state.selectedIds.length < 2 || hasGroupedSelection"
              @click="align('vcenter')"
            >
              垂直居中
            </button>
            <button
              type="button"
              :disabled="state.selectedIds.length < 2 || hasGroupedSelection"
              @click="align('bottom')"
            >
              下
            </button>
          </div>
        </div>
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
            <label v-for="[key, label] in geometryFields" :key="key">
              {{ label }}
              <input type="number" :name="key" step="any" :value="selected.transform[key]" />
            </label>
            <button type="submit">应用几何属性</button>
          </form>
          <p v-else class="studio-tip">当前为多选状态，请单选一个图元编辑几何属性。</p>
          <p class="studio-tip">拖动画布中的虚线框，或使用方向按钮微调。每次操作可撤销。</p>
          <div class="studio-nudge">
            <button type="button" @click="nudge(-1, 0)">←</button>
            <button type="button" @click="nudge(0, -1)">↑</button>
            <button type="button" @click="nudge(0, 1)">↓</button>
            <button type="button" @click="nudge(1, 0)">→</button>
          </div>
          <label
            v-if="selected.type === 'label' && state.selectedIds.length === 1"
            class="studio-field"
          >
            显示文案
            <input v-model="labelDraft" maxlength="256" />
            <button type="button" @click="changeLabel">应用文案</button>
          </label>
          <h3>Tag 绑定（模拟数据）</h3>
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
                {{ option.label }} · {{ option.tagId }}
              </option>
            </select>
          </label>
          <p v-else class="studio-tip">
            请单选未组合的水箱、水泵或文本图元；管道暂不支持动态 Tag 绑定。
          </p>
          <p v-for="(binding, slot) in selected.bindings" :key="slot" class="studio-binding">
            {{ slot }} → {{ binding.tagId }}
          </p>
        </template>
        <p v-else class="studio-tip">选择左侧图元或画布中的图元查看属性。</p>
      </aside>
    </div>
    <footer>
      V0.2 · 框选/快捷键：Ctrl+A 全选，Ctrl+Z 撤销，Ctrl+Shift+Z/Ctrl+Y
      重做，方向键微移，Shift+方向键移动 10 格，Esc 取消选择 · 无设备写入
    </footer>
  </main>
</template>
