<script setup lang="ts">
import { defineAsyncComponent, ref } from "vue";

const RuntimePage = defineAsyncComponent(() => import("./runtime/RuntimePage.vue"));
const StudioPage = defineAsyncComponent(() => import("./studio/StudioPage.vue"));
const view = ref<"runtime" | "studio">("runtime");
</script>

<template>
  <nav class="scada-app-nav" aria-label="功能导航">
    <span class="scada-app-brand"><img src="/brand/favicon.svg" alt="" aria-hidden="true" />ADui SCADA</span>
    <button
      type="button"
      :aria-current="view === 'runtime' ? 'page' : undefined"
      @click="view = 'runtime'"
    >
      运行监控
    </button>
    <button
      type="button"
      :aria-current="view === 'studio' ? 'page' : undefined"
      @click="view = 'studio'"
    >
      组态编辑
    </button>
    <span class="scada-app-version">V0.2 本地原型</span>
  </nav>
  <RuntimePage v-if="view === 'runtime'" />
  <StudioPage v-else />
</template>
