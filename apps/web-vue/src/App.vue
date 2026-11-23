<script setup lang="ts">
import { Button as TButton } from "tdesign-vue-next";
import "tdesign-vue-next/es/style/index.css";
import { defineAsyncComponent, ref } from "vue";

const RuntimePage = defineAsyncComponent(() => import("./runtime/RuntimePage.vue"));
const PublishedRuntimePage = defineAsyncComponent(
  () => import("./runtime/PublishedRuntimePage.vue"),
);
const StudioPage = defineAsyncComponent(() => import("./studio/StudioPage.vue"));
const view = ref<"runtime" | "published" | "studio">("runtime");

const viewLabels = {
  runtime: "运行监控",
  published: "已发布运行",
  studio: "组态编辑",
} as const;
</script>

<template>
  <div class="scada-app-frame" :data-view="view">
    <a class="scada-skip-link" href="#scada-main-content">跳转到主要内容</a>
    <nav class="scada-app-nav" aria-label="功能导航">
      <div class="scada-rail-brand">
        <span class="scada-app-brand">
          <img src="/brand/favicon.svg" alt="" aria-hidden="true" />
          <strong>ADui</strong>
        </span>
        <span class="scada-rail-product">SCADA</span>
      </div>
      <span class="scada-nav-kicker">工作空间</span>
      <div class="scada-nav-items">
        <TButton
          type="button"
          :aria-current="view === 'runtime' ? 'page' : undefined"
          @click="view = 'runtime'"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M3 19h18M5 16V8m5 8V5m5 11v-6m4 6V7" stroke-linecap="round" />
          </svg>
          <span>运行监控</span>
        </TButton>
        <TButton
          type="button"
          :aria-current="view === 'published' ? 'page' : undefined"
          @click="view = 'published'"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <rect x="4" y="3" width="16" height="18" rx="2" />
            <path d="M8 8h8M8 12h8M8 16h4" stroke-linecap="round" />
          </svg>
          <span>已发布运行</span>
        </TButton>
        <TButton
          type="button"
          :aria-current="view === 'studio' ? 'page' : undefined"
          @click="view = 'studio'"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M4 4h16v16H4zM4 9h16M9 9v11" stroke-linejoin="round" />
            <path d="m13 15 2 2 4-5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>组态编辑</span>
        </TButton>
      </div>
      <div class="scada-rail-footer">
        <span class="scada-rail-environment">开发演示环境</span>
        <span class="scada-app-version">仅供开发验证</span>
      </div>
    </nav>
    <div class="scada-app-content">
      <header class="scada-app-topbar">
        <div class="scada-app-breadcrumb">
          <span>工作空间</span>
          <span aria-hidden="true">/</span>
          <strong>{{ viewLabels[view] }}</strong>
        </div>
        <span class="scada-app-safety">只读演示 · 非现场控制</span>
      </header>
      <RuntimePage v-if="view === 'runtime'" />
      <PublishedRuntimePage v-else-if="view === 'published'" />
      <StudioPage v-else />
    </div>
  </div>
</template>
