<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { WaterTreatmentSimulator, waterTreatmentDemoDocument } from "@adui/scada-core";
import {
  DEFAULT_GRID_SIZE,
  DocumentEditor,
  findNodesInRect,
  resolveDragSnap,
  withNodesTranslated,
} from "@adui/scada-core/editor";
import type { Alignment, EditableSymbol, LayerAction } from "@adui/scada-core/editor";
import { svgDataUrl } from "@adui/scada-runtime";
import "./studio.css";

const previewTags = new WaterTreatmentSimulator().next(new Date("2026-11-09T00:00:00Z"));
const maxFileSize = 2 * 1024 * 1024;
const editor = new DocumentEditor(waterTreatmentDemoDocument);
const state = shallowRef(editor.snapshot());
const preview = shallowRef<{ id: string; x: number; y: number } | null>(null);
const marquee = shallowRef<MarqueeState | null>(null);
const labelDraft = ref("");
const notice = ref("本地草稿 · 尚未连接工程保存 API");
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
let activeDrag: DragState | null = null;
let activeMarquee: MarqueeState | null = null;

const page = computed(() => {
  const result = state.value.document.pages[0];
  if (!result) throw new Error("工程文档不包含页面");
  return result;
});
const selected = computed(() =>
  page.value.nodes.find((node) => node.id === state.value.selectedId),
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
  );
});
const displayDocument = computed(() => {
  const movement = snapResult.value;
  return movement === null
    ? state.value.document
    : withNodesTranslated(state.value.document, state.value.selectedIds, movement.dx, movement.dy);
});
const displayNodes = computed(() => displayDocument.value.pages[0]?.nodes ?? []);
const imageUrl = computed(() => svgDataUrl(displayDocument.value, previewTags));

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
      preview.value = null;
      marquee.value = null;
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

onMounted(() => window.addEventListener("keydown", handleKey));
onUnmounted(() => window.removeEventListener("keydown", handleKey));

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
    );
    editor.selectMany(ids, current.additive);
  }
  refresh();
}

function updatePointer(event: PointerEvent) {
  updateDrag(event);
  updateMarquee(event);
}

function finishPointer(event: PointerEvent) {
  finishDrag(event);
  finishMarquee(event);
}

function selectNode(id: string | null, additive = false) {
  if (activeDrag !== null) return;
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
    );
    editor.moveBy(movement.dx, movement.dy);
    refresh();
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  }
}

function cancelDrag() {
  activeDrag = null;
  activeMarquee = null;
  preview.value = null;
  marquee.value = null;
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
    editor.loadDocument(JSON.parse(await file.text()) as unknown);
    preview.value = null;
    refresh();
    notice.value = "工程 JSON 已校验并载入本地编辑器";
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
      </div>
    </header>
    <p role="status" class="studio-notice">{{ notice }}</p>
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
        <button
          v-for="node in page.nodes"
          :key="node.id"
          type="button"
          class="studio-layer"
          :data-selected="state.selectedIds.includes(node.id)"
          @click="selectNode(node.id, $event.shiftKey)"
        >
          <span>{{ node.id }}</span
          ><small>{{ node.type }}</small>
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
            <button type="button" :disabled="state.selectedIds.length < 2" @click="align('left')">
              左
            </button>
            <button
              type="button"
              :disabled="state.selectedIds.length < 2"
              @click="align('hcenter')"
            >
              水平居中
            </button>
            <button type="button" :disabled="state.selectedIds.length < 2" @click="align('right')">
              右
            </button>
            <button type="button" :disabled="state.selectedIds.length < 2" @click="align('top')">
              上
            </button>
            <button
              type="button"
              :disabled="state.selectedIds.length < 2"
              @click="align('vcenter')"
            >
              垂直居中
            </button>
            <button type="button" :disabled="state.selectedIds.length < 2" @click="align('bottom')">
              下
            </button>
          </div>
        </div>
        <template v-if="selected">
          <p>
            <strong>{{ selected.id }}</strong> · {{ selected.type }}
          </p>
          <div class="studio-fields">
            <span>X：{{ selected.transform.x }}</span>
            <span>Y：{{ selected.transform.y }}</span>
            <span>宽：{{ selected.transform.width }}</span>
            <span>高：{{ selected.transform.height }}</span>
          </div>
          <p class="studio-tip">拖动画布中的虚线框，或使用方向按钮微调。每次操作可撤销。</p>
          <div class="studio-nudge">
            <button type="button" @click="nudge(-1, 0)">←</button>
            <button type="button" @click="nudge(0, -1)">↑</button>
            <button type="button" @click="nudge(0, 1)">↓</button>
            <button type="button" @click="nudge(1, 0)">→</button>
          </div>
          <label v-if="selected.type === 'label'" class="studio-field">
            显示文案
            <input v-model="labelDraft" maxlength="256" />
            <button type="button" @click="changeLabel">应用文案</button>
          </label>
          <h3>Tag 绑定（只读）</h3>
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
