<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { WaterTreatmentSimulator, waterTreatmentDemoDocument } from "@adui/scada-core";
import { DocumentEditor, withNodePosition } from "@adui/scada-core/editor";
import { svgDataUrl } from "@adui/scada-runtime";
import "./studio.css";

const previewTags = new WaterTreatmentSimulator().next(new Date("2026-11-09T00:00:00Z"));
const maxFileSize = 2 * 1024 * 1024;
const editor = new DocumentEditor(waterTreatmentDemoDocument);
const state = shallowRef(editor.snapshot());
const preview = shallowRef<{ id: string; x: number; y: number } | null>(null);
const labelDraft = ref("");
const notice = ref("本地草稿 · 尚未连接工程保存 API");
const svgRef = ref<SVGSVGElement | null>(null);

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

const page = computed(() => {
  const result = state.value.document.pages[0];
  if (!result) throw new Error("No page in editor document");
  return result;
});
const selected = computed(() =>
  page.value.nodes.find((node) => node.id === state.value.selectedId),
);
const displayDocument = computed(() =>
  preview.value === null
    ? state.value.document
    : withNodePosition(
        state.value.document,
        preview.value.id,
        preview.value.x,
        preview.value.y,
      ),
);
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

function selectNode(id: string | null) {
  if (activeDrag !== null) return;
  editor.select(id);
  refresh();
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
  editor.select(id);
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
    editor.moveSelected(x, y);
    refresh();
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  }
}

function cancelDrag() {
  activeDrag = null;
  preview.value = null;
}

function displayTransform(id: string) {
  const node = displayNodes.value.find((item) => item.id === id);
  if (!node) throw new RangeError("Unknown node: " + id);
  const t = node.transform;
  return `rotate(${t.rotation} ${t.x + t.width / 2} ${t.y + t.height / 2})`;
}

function nudge(dx: number, dy: number) {
  if (!selected.value) return;
  editor.moveSelected(selected.value.transform.x + dx, selected.value.transform.y + dy);
  refresh();
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
        <button
          v-for="node in page.nodes"
          :key="node.id"
          type="button"
          class="studio-layer"
          :data-selected="node.id === state.selectedId"
          @click="selectNode(node.id)"
        >
          <span>{{ node.id }}</span><small>{{ node.type }}</small>
        </button>
      </aside>
      <section class="studio-stage" aria-label="组态画布">
        <div class="studio-stage-caption">
          {{ page.name }} · {{ page.size.width }} × {{ page.size.height }} · 静态模拟预览
        </div>
        <svg
          ref="svgRef"
          class="studio-svg"
          :viewBox="`0 0 ${page.size.width} ${page.size.height}`"
          aria-label="可编辑 SVG 画布"
          @pointermove="updateDrag"
          @pointerup="finishDrag"
          @pointercancel="cancelDrag"
          @pointerdown.self="selectNode(null)"
        >
          <image
            :href="imageUrl"
            :width="page.size.width"
            :height="page.size.height"
            pointer-events="none"
          />
          <g
            v-for="node in displayNodes"
            :key="node.id"
            :transform="displayTransform(node.id)"
          >
            <rect
              role="button"
              tabindex="0"
              :aria-label="`选择并拖动 ${node.id}`"
              :x="node.transform.x"
              :y="node.transform.y"
              :width="node.transform.width"
              :height="node.transform.height"
              fill="transparent"
              :stroke="state.selectedId === node.id ? '#f0ae4d' : 'transparent'"
              stroke-width="2"
              stroke-dasharray="6 4"
              class="studio-hitbox"
              @pointerdown="beginDrag($event, node.id)"
              @keydown.enter.prevent="selectNode(node.id)"
              @keydown.space.prevent="selectNode(node.id)"
            />
          </g>
        </svg>
      </section>
      <aside class="studio-panel" aria-label="图元属性">
        <h2>属性</h2>
        <template v-if="selected">
          <p><strong>{{ selected.id }}</strong> · {{ selected.type }}</p>
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
      V0.2 第一阶段 · 本地 JSON 草稿 · 不连接 PLC/DCS · 暂无发布与服务端保存
    </footer>
  </main>
</template>
