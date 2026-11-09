<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from "vue";
import { DemoRuntime, OfflineDemoRuntime, initialRuntimeState, svgDataUrl } from "@adui/scada-runtime";

const state = shallowRef(initialRuntimeState);
const svg = computed(() =>
  state.value.document ? svgDataUrl(state.value.document, state.value.values) : null,
);
const onStateChange = (next: typeof initialRuntimeState) => {
  state.value = next;
};
const runtime = import.meta.env.MODE === "desktop"
  ? new OfflineDemoRuntime(onStateChange)
  : new DemoRuntime(onStateChange);
onMounted(() => {
  void runtime.start();
});
onUnmounted(() => runtime.stop());
</script>

<template>
  <main class="scada-shell">
    <header class="scada-header">
      <div>
        <p class="scada-eyebrow">ADui SCADA · V0.1</p>
        <h1>水处理实时监控</h1>
      </div>
      <span class="scada-status" :data-status="state.status">{{ state.status.toUpperCase() }}</span>
    </header>
    <p role="status" class="scada-message">{{ state.message }}</p>
    <section class="scada-panel" aria-label="模拟工业监控画面">
      <img v-if="svg" class="scada-svg" :src="svg" alt="水箱、水泵与流量模拟监控" />
      <p v-else>正在加载工程...</p>
    </section>
    <section class="scada-panel">
      <h2>Tag 质量与最近值</h2>
      <div class="scada-tags">
        <div v-for="tag in state.values" :key="tag.tagId" class="scada-tag">
          <strong>{{ tag.tagId }}</strong>
          <span>{{ tag.quality === "GOOD" ? String(tag.value ?? "--") : "--" }}</span>
          <small :data-quality="tag.quality">{{ tag.quality }}</small>
        </div>
      </div>
    </section>
    <footer>仅模拟数据 · 只读监控 · 不连接 PLC/DCS</footer>
  </main>
</template>
