<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from "vue";
import { Button as TButton, Input as TInput, Select as TSelect } from "tdesign-vue-next";
import "tdesign-vue-next/es/style/index.css";
import { createScadaApiClient } from "@adui/scada-api-client";
import {
  PUBLISHED_RUNTIME_EMPTY_HINTS,
  PUBLISHED_RUNTIME_STATUS_LABELS,
  PublishedRuntime,
  PublishedRuntimeRefresher,
  initialPublishedRuntimeState,
  publishedSnapshotSvg,
} from "@adui/scada-runtime";
import type { PublishedRuntimeState } from "@adui/scada-runtime";

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const projectId = shallowRef("");
const activeProjectId = shallowRef<string | null>(null);
const state = shallowRef<PublishedRuntimeState>(initialPublishedRuntimeState);
const message = shallowRef("");
const selectedPageId = shallowRef<string | null>(null);

const runtime = new PublishedRuntime((next) => {
  state.value = next;
}, createScadaApiClient());
const refresher = new PublishedRuntimeRefresher(runtime);

const pages = computed(() =>
  state.value.status === "verified" ? (state.value.snapshot?.document.pages ?? []) : [],
);
const activePageId = computed(() =>
  pages.value.some((page) => page.id === selectedPageId.value)
    ? selectedPageId.value
    : (pages.value[0]?.id ?? null),
);
const svg = computed(() =>
  state.value.status === "verified" && state.value.snapshot && activePageId.value
    ? publishedSnapshotSvg(state.value.snapshot, activePageId.value)
    : null,
);

function selectPage(value: unknown): void {
  if (typeof value === "string") selectedPageId.value = value;
}

function start(): void {
  const id = projectId.value.trim();
  if (!PROJECT_ID_PATTERN.test(id)) {
    message.value = "工程 ID 必须是 1～128 位字母、数字、点、下划线或连字符";
    return;
  }
  message.value = "";
  selectedPageId.value = null;
  activeProjectId.value = id;
  void refresher.start(id).catch(() => {
    message.value = "正式发布读取启动失败，已停止运行会话";
  });
}

function refresh(): void {
  message.value = "";
  void refresher.refresh().catch(() => {
    message.value = "发布指针刷新失败，请重新启动读取";
  });
}

function stop(): void {
  refresher.stop();
  activeProjectId.value = null;
  selectedPageId.value = null;
  message.value = "";
}

function onVisibilityChange(): void {
  void refresher.setVisible(document.visibilityState === "visible").catch(() => {
    message.value = "发布运行状态切换失败，请重新启动读取";
  });
}

function onPageHide(): void {
  stop();
}

onMounted(() => {
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);
});
onUnmounted(() => {
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("pagehide", onPageHide);
  refresher.stop();
});
</script>

<template>
  <main
    id="scada-main-content"
    tabindex="-1"
    class="scada-shell scada-shell--published"
    data-testid="published-runtime-page"
  >
    <header class="scada-header">
      <div>
        <p class="scada-eyebrow">ADui SCADA · 正式发布配置只读监控</p>
        <h1>已发布工程运行</h1>
      </div>
      <span class="scada-status" :data-status="state.status">
        {{ PUBLISHED_RUNTIME_STATUS_LABELS[state.status] }}
      </span>
    </header>
    <p class="scada-message" role="status" data-testid="published-runtime-status">
      {{ state.message }}
    </p>
    <div class="scada-published-layout">
      <div class="scada-published-sidebar">
        <section class="scada-panel scada-published-controls-panel" aria-label="正式发布工程选择">
          <h2>读取已发布工程</h2>
          <p class="scada-diagnostics-note">
            独立 release:read 权限 · 仅使用当前登录会话 · 不读取编辑草稿或模拟数据
          </p>
          <form class="scada-published-controls" @submit.prevent="start">
            <label>
              工程 ID
              <TInput
                name="projectId"
                v-model="projectId"
                type="text"
                :maxlength="128"
                autocomplete="off"
                :spell-check="false"
                placeholder="输入已授权工程 ID"
              />
            </label>
            <TButton type="submit">读取正式发布</TButton>
            <TButton type="button" variant="outline" :disabled="!activeProjectId" @click="refresh">
              立即刷新
            </TButton>
            <TButton type="button" variant="text" :disabled="!activeProjectId" @click="stop">
              停止读取
            </TButton>
          </form>
          <p v-if="message" role="alert">{{ message }}</p>
        </section>
        <section class="scada-panel scada-published-summary-panel" aria-label="正式发布状态">
          <h2>已提交发布指针</h2>
          <dl class="scada-diagnostics-grid">
            <div>
              <dt>工程</dt>
              <dd>{{ state.projectId ?? "未选择" }}</dd>
            </div>
            <div>
              <dt>发布代次</dt>
              <dd>{{ state.releaseGeneration ?? "--" }}</dd>
            </div>
            <div>
              <dt>发布修订</dt>
              <dd>{{ state.snapshot?.revision ?? "--" }}</dd>
            </div>
            <div>
              <dt>实时 Tag 质量</dt>
              <dd>不可用 · UNAVAILABLE</dd>
            </div>
          </dl>
        </section>
      </div>
        <section class="scada-panel scada-published-preview-panel" aria-label="已发布静态组态预览">
        <h2>已发布组态静态预览</h2>
        <div v-if="pages.length > 1" class="scada-published-controls">
          <label>
            组态页面
            <div data-testid="published-runtime-page-select">
              <TSelect
                :value="activePageId ?? ''"
                :options="pages.map((page) => ({ label: page.name, value: page.id }))"
                @change="selectPage"
              />
            </div>
          </label>
        </div>
        <p class="scada-diagnostics-note">
          此画面只来自已验证的正式发布快照；未连接现场 Tag。 画布内缺失值的 BAD
          占位不代表设备故障诊断。
        </p>
        <img
          v-if="svg"
          class="scada-svg"
          :src="svg"
          alt="已发布组态静态配置预览，实时 Tag 数据未接入"
          data-testid="published-runtime-svg"
        />
        <p v-else class="scada-diagnostics-empty">
          {{ PUBLISHED_RUNTIME_EMPTY_HINTS[state.status] }}
        </p>
      </section>
    </div>
    <footer>正式发布只读 · 未接入现场数据 · 不开放设备控制</footer>
  </main>
</template>
