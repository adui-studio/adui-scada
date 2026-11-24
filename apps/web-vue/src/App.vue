<script setup lang="ts">
import { Button as TButton } from "tdesign-vue-next";
import "tdesign-vue-next/es/style/index.css";
import { computed, defineAsyncComponent, ref } from "vue";

const RuntimePage = defineAsyncComponent(() => import("./runtime/RuntimePage.vue"));
const PublishedRuntimePage = defineAsyncComponent(
  () => import("./runtime/PublishedRuntimePage.vue"),
);
const StudioPage = defineAsyncComponent(() => import("./studio/StudioPage.vue"));
const view = ref<"home" | "runtime" | "published" | "studio">("home");

const safetyLabel = computed(() => {
  switch (view.value) {
    case "studio":
      return "本地组态编辑 · 非现场控制";
    case "published":
      return "受控只读预览 · 非现场控制";
    case "runtime":
      return "模拟只读监控 · 非现场控制";
    default:
      return "开发工作台 · 非现场控制";
  }
});

const viewLabels = {
  home: "工作台",
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
          title="工作台"
          :aria-current="view === 'home' ? 'page' : undefined"
          @click="view = 'home'"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
            <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
            <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
            <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
          </svg>
          <span>工作台</span>
        </TButton>
        <TButton
          type="button"
          title="运行监控"
          :aria-current="view === 'runtime' ? 'page' : undefined"
          @click="view = 'runtime'"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <path d="M3 19h18M5 16V8m5 8V5m5 11v-6m4 6V7" stroke-linecap="round" />
          </svg>
          <span>运行监控</span>
        </TButton>
        <TButton
          type="button"
          title="已发布运行"
          :aria-current="view === 'published' ? 'page' : undefined"
          @click="view = 'published'"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <rect x="4" y="3" width="16" height="18" rx="2" />
            <path d="M8 8h8M8 12h8M8 16h4" stroke-linecap="round" />
          </svg>
          <span>已发布运行</span>
        </TButton>
        <TButton
          type="button"
          title="组态编辑"
          :aria-current="view === 'studio' ? 'page' : undefined"
          @click="view = 'studio'"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
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
        <span class="scada-app-safety">{{ safetyLabel }}</span>
      </header>
      <main v-if="view === 'home'" id="scada-main-content" class="scada-home">
        <div class="scada-home-heading">
          <span class="scada-home-eyebrow">ADui Studio / 工作空间</span>
          <h1>工程工作区</h1>
          <p>打开工程进行设计，或进入独立的只读运行环境。</p>
        </div>
        <section class="scada-home-section" aria-labelledby="scada-home-demo">
          <div class="scada-home-section-head">
            <h2 id="scada-home-demo">工程示例</h2>
            <span>内置 · 本地模拟</span>
          </div>
          <button type="button" class="scada-home-project" @click="view = 'studio'">
            <span class="scada-home-project-preview" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 8h18M9 8v13" />
              </svg>
            </span>
            <span class="scada-home-project-detail">
              <strong>水处理演示工程</strong>
              <span>本地模拟 · Studio 默认画板 1920 × 1080</span>
            </span>
          </button>
        </section>
        <section class="scada-home-section" aria-labelledby="scada-home-start">
          <div class="scada-home-section-head">
            <h2 id="scada-home-start">其他工作区</h2>
            <span>选择现有功能</span>
          </div>
          <div class="scada-home-card-grid">
            <button type="button" class="scada-home-card" @click="view = 'studio'">
              <span class="scada-home-card-icon" aria-hidden="true"
                ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 8h18M9 8v13" /></svg
              ></span>
              <strong>打开组态编辑器</strong>
              <span>设计 1920 × 1080 画板，管理图层和 Tag</span>
              <small>打开 ↗</small>
            </button>
            <button type="button" class="scada-home-card" @click="view = 'runtime'">
              <span class="scada-home-card-icon" aria-hidden="true"
                ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path d="M3 19h18M5 16V9m5 7V5m5 11v-4m4 4V7" stroke-linecap="round" /></svg
              ></span>
              <strong>查看模拟运行</strong>
              <span>监控水处理模拟状态、链路和质量</span>
              <small>打开 ↗</small>
            </button>
            <button type="button" class="scada-home-card" @click="view = 'published'">
              <span class="scada-home-card-icon" aria-hidden="true"
                ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <rect x="5" y="3" width="14" height="18" rx="2" />
                  <path d="M8 8h8M8 12h8M8 16h4" stroke-linecap="round" /></svg
              ></span>
              <strong>查看已发布工程</strong>
              <span>经受控接口读取只读发布快照</span>
              <small>打开 ↗</small>
            </button>
          </div>
        </section>
        <p class="scada-home-footnote">
          最近文件尚无可信统一数据源。已有浏览器草稿请在 Studio 文件菜单中查看和恢复；
          本页不开放现场设备控制。
        </p>
      </main>
      <RuntimePage v-else-if="view === 'runtime'" />
      <PublishedRuntimePage v-else-if="view === 'published'" />
      <StudioPage v-else />
    </div>
  </div>
</template>
