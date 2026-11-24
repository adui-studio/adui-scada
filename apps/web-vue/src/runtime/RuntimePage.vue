<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from "vue";
import { Button as TButton, Select as TSelect, Upload as TUpload } from "tdesign-vue-next";
import { readWorkspaceJson } from "@adui/scada-draft-storage";
import type { ScadaDocument, TagHistoryPoint } from "@adui/scada-core";
import { TAG_QUALITIES, TAG_QUALITY_LABELS } from "@adui/scada-core";
import {
  DemoRuntime,
  createLocalProjectSimulationSource,
  simulationHistoryCsv,
  simulationTrendPaths,
  OfflineDemoRuntime,
  formatRuntimeDataAge,
  formatRuntimeUpdateTime,
  initialRuntimeState,
  RUNTIME_STATUS_LABELS,
  svgDataUrl,
} from "@adui/scada-runtime";

import type { LocalProjectSimulationSource, RuntimeState } from "@adui/scada-runtime";

const state = shallowRef(initialRuntimeState);
const project = shallowRef<ScadaDocument | null>(null);
const pageId = ref<string | undefined>();
const historyTag = ref<string | undefined>();
const history = shallowRef<readonly TagHistoryPoint[]>([]);
const busy = ref(false);
const notice = ref("");
let generation = 0;
let runtime: DemoRuntime | OfflineDemoRuntime | null = null;
let source: LocalProjectSimulationSource | null = null;
const svg = computed(() =>
  state.value.document ? svgDataUrl(state.value.document, state.value.values, pageId.value) : null,
);
const paths = computed(() => simulationTrendPaths(history.value));
const csvUrl = computed(() =>
  "data:text/csv;charset=utf-8," + encodeURIComponent("\uFEFF" + simulationHistoryCsv(history.value)),
);

function startRuntime(document: ScadaDocument | null): void {
  runtime?.stop();
  state.value = initialRuntimeState;
  project.value = document;
  pageId.value = document?.pages[0]?.id;
  historyTag.value = document?.tags.find((tag) => tag.dataType === "number")?.tagId ??
    document?.tags[0]?.tagId;
  history.value = [];
  source = document ? createLocalProjectSimulationSource(document) : null;
  const currentSource = source;
  const onStateChange = (next: RuntimeState): void => {
    state.value = next;
    history.value = currentSource?.history() ?? [];
  };
  runtime = currentSource
    ? new DemoRuntime(onStateChange, currentSource)
    : import.meta.env.MODE === "desktop"
      ? new OfflineDemoRuntime(onStateChange)
      : new DemoRuntime(onStateChange);
  void runtime.start();
}

async function importProject(file: File): Promise<void> {
  const token = ++generation;
  busy.value = true;
  try {
    const result = await readWorkspaceJson(file);
    if (token !== generation) return;
    startRuntime(result.document);
    notice.value = "工程已校验，当前仅为本地模拟运行，未执行正式发布";
  } catch {
    if (token === generation) notice.value = "工程文件无效，保留当前运行会话";
  } finally {
    if (token === generation) busy.value = false;
  }
}

function onJsonSelected(files: File[]): void {
  const file = files[0];
  if (file) void importProject(file);
}

function resetProject(): void {
  generation += 1;
  busy.value = false;
  notice.value = "";
  startRuntime(null);
}

function changePage(value: unknown): void {
  if (typeof value === "string" && project.value?.pages.some((page) => page.id === value)) {
    pageId.value = value;
  }
}

function changeHistoryTag(value: unknown): void {
  if (typeof value !== "string" || !project.value?.tags.some((tag) => tag.tagId === value)) return;
  source?.selectHistoryTag(value);
  historyTag.value = value;
  history.value = [];
}

const pageOptions = computed(() =>
  project.value?.pages.map((page) => ({ label: page.name, value: page.id })) ?? [],
);
const historyOptions = computed(() =>
  project.value?.tags.map((tag) => ({ label: tag.displayName, value: tag.tagId })) ?? [],
);

onMounted(() => startRuntime(null));
onUnmounted(() => {
  generation += 1;
  runtime?.stop();
});
</script>

<template>
  <main id="scada-main-content" tabindex="-1" class="scada-shell scada-shell--overview">
    <header class="scada-header">
      <div>
        <p class="scada-eyebrow">ADui SCADA · 本地模拟运行</p>
        <h1>{{ project ? project.projectName ?? project.projectId : "水处理实时监控" }}</h1>
      </div>
      <span class="scada-status" :data-status="state.status">{{
        RUNTIME_STATUS_LABELS[state.status]
      }}</span>
    </header>
    <div class="scada-simulation-tools">
      <TUpload
        theme="custom"
        accept=".json,application/json"
        :auto-upload="false"
        :files="[]"
        allow-upload-duplicate-file
        :disabled="busy"
        @select-change="onJsonSelected"
      >
        <TButton size="small" variant="outline" :disabled="busy">导入工程模拟运行</TButton>
      </TUpload>
      <TButton v-if="project" size="small" theme="default" variant="outline" @click="resetProject">
        返回内置示例
      </TButton>
      <span v-if="notice" role="status">{{ notice }}</span>
    </div>
    <p role="status" class="scada-message">{{ state.message }}</p>
    <div class="scada-monitor-layout">
      <section class="scada-panel scada-process-panel" aria-label="模拟工业监控画面">
        <h2>{{ project ? "导入工程只读模拟" : "模拟工艺流程" }}</h2>
        <p class="scada-panel-subtitle">只读演示画面 · 不代表现场设备数据</p>
        <div v-if="project" class="scada-simulation-tools">
          <span>页面</span>
          <TSelect size="small" :value="pageId" :options="pageOptions" @change="changePage" />
        </div>
        <img v-if="svg" class="scada-svg" :src="svg" :alt="project ? '导入工程模拟监控' : '水箱、水泵与流量模拟监控'" />
        <p v-else>正在加载工程…</p>
      </section>
      <div class="scada-monitor-side">
        <section class="scada-panel scada-diagnostics" aria-label="本地实时链路诊断">
          <h2>实时链路诊断</h2>
          <p class="scada-diagnostics-note">
            本机只读观测 · 数据年龄为接受有效 Tag 后经过的时间，并非网络传输延迟
          </p>
          <dl class="scada-diagnostics-grid">
            <div>
              <dt>连接状态</dt>
              <dd>{{ RUNTIME_STATUS_LABELS[state.status] }}</dd>
            </div>
            <div>
              <dt>断连过程次数</dt>
              <dd>{{ state.diagnostics.reconnectCount }}</dd>
            </div>
            <div>
              <dt>最近有效更新</dt>
              <dd>{{ formatRuntimeUpdateTime(state.diagnostics.lastTagReceivedAt) }}</dd>
            </div>
            <div>
              <dt>观测时数据年龄</dt>
              <dd>{{ formatRuntimeDataAge(state.diagnostics.dataAgeMs) }}</dd>
            </div>
          </dl>
          <div class="scada-quality-summary" role="group" aria-label="Tag 质量分布">
            <div
              v-for="quality in TAG_QUALITIES"
              :key="quality"
              class="scada-quality-item"
              :data-quality="quality"
            >
              <span>{{ TAG_QUALITY_LABELS[quality] }}</span>
              <strong>{{ state.diagnostics.qualityCounts[quality] }}</strong>
            </div>
          </div>
          <p class="scada-diagnostics-total">当前 Tag 总数：{{ state.diagnostics.tagCount }}</p>
          <section class="scada-status-history" aria-label="最近状态变化">
            <h3>最近状态变化</h3>
            <p class="scada-diagnostics-note">最多 20 条 · 仅当前会话 · 非报警历史</p>
            <p v-if="state.diagnostics.statusEvents.length === 0" class="scada-diagnostics-empty">
              暂无状态变化
            </p>
            <ol v-else class="scada-status-events">
              <li
                v-for="event in state.diagnostics.statusEvents"
                :key="event.sequence"
                :data-status="event.status"
              >
                <span>{{ RUNTIME_STATUS_LABELS[event.status] }}</span>
                <time :datetime="new Date(event.occurredAt).toISOString()">
                  {{ formatRuntimeUpdateTime(event.occurredAt) }}
                </time>
              </li>
            </ol>
          </section>
        </section>
        <section v-if="project" class="scada-panel scada-simulation-history" aria-label="本地模拟趋势">
          <h2>本地模拟趋势</h2>
          <p class="scada-panel-subtitle">最近 120 秒 · 单 Tag · 当前会话 · 不写入数据库</p>
          <TSelect v-if="project.tags.length > 0" size="small" :value="historyTag" :options="historyOptions" @change="changeHistoryTag" />
          <svg viewBox="0 0 320 120" role="img" aria-label="模拟数值趋势，范围零至一百" class="scada-simulation-chart">
            <path d="M 8 8 H 312 M 8 60 H 312 M 8 112 H 312" class="scada-simulation-grid" />
            <path v-for="path in paths" :key="path" :d="path" class="scada-simulation-line" />
          </svg>
          <p class="scada-panel-subtitle">
            {{ history.length === 0 ? "暂无采样" : paths.length === 0 ? "当前没有正常数值点" : "合成数值范围 0～100，非工程量程" }}
          </p>
          <a v-if="history.length > 0" download="本地模拟历史.csv" :href="csvUrl">
            导出当前模拟历史 CSV（{{ history.length }} 条）
          </a>
        </section>
        <section class="scada-panel scada-values-panel" aria-label="Tag 质量与最近值">
          <h2>Tag 质量与最近值</h2>
          <p v-if="state.values.length === 0" class="scada-diagnostics-empty">
            暂无可显示的 Tag 数据
          </p>
          <div class="scada-tags">
            <div v-for="tag in state.values" :key="tag.tagId" class="scada-tag">
              <strong>{{ tag.tagId }}</strong>
              <span>{{ tag.quality === "GOOD" ? String(tag.value ?? "--") : "--" }}</span>
              <small :data-quality="tag.quality">{{ TAG_QUALITY_LABELS[tag.quality] }}</small>
            </div>
          </div>
        </section>
      </div>
    </div>
    <footer>仅模拟数据 · 只读监控 · 不连接 PLC/DCS</footer>
  </main>
</template>
