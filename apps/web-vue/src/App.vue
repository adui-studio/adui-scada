<script setup lang="ts">
import { Button as TButton, Switch as TSwitch } from "tdesign-vue-next";
import { AppIcon, ChartBarIcon, FileIcon, EditIcon, SunnyIcon, MoonIcon } from "tdesign-icons-vue-next";
import { WORKSPACE_ROUTE_PATHS, workspaceViewFromRouteName, readWorkspaceTheme, transitionWorkspaceTheme } from "@adui/scada-runtime";
import type { WorkspaceView } from "@adui/scada-runtime";
import "tdesign-vue-next/es/style/index.css";
import { computed, nextTick, ref } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();
const view = computed(() => workspaceViewFromRouteName(route.name));
function navigate(next: WorkspaceView) {
  if (next !== view.value) void router.push(WORKSPACE_ROUTE_PATHS[next]);
}
function focusMainContent() {
  const main = document.getElementById("scada-main-content");
  if (main) {
    main.tabIndex = -1;
    main.focus();
  }
}
const themeMode = ref(readWorkspaceTheme());

function changeTheme(checked: unknown) {
  if (typeof checked !== "boolean") return;
  const next = checked ? "dark" : "light";
  void transitionWorkspaceTheme(next, async () => {
    themeMode.value = next;
    await nextTick();
  });
}

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
    <button class="scada-skip-link" type="button" @click="focusMainContent">跳转到主要内容</button>
    <nav class="scada-app-nav" aria-label="功能导航">
      <div class="scada-rail-brand">
        <span class="scada-app-brand">
          <img
            :src="themeMode === 'dark' ? '/brand/mark-dark.svg' : '/brand/mark-primary.svg'"
            alt=""
            aria-hidden="true"
          />
          <strong>ADui SCADA</strong>
        </span>
        <span class="scada-rail-product">ADui Studio</span>
      </div>
      <span class="scada-nav-kicker">工作空间</span>
      <div class="scada-nav-items">
        <TButton
          type="button"
          title="工作台"
          :aria-current="view === 'home' ? 'page' : undefined"
          @click="navigate('home')"
        >
          <span class="scada-button-content">
            <AppIcon aria-hidden="true" />
            <span class="scada-button-label">工作台</span>
          </span>
        </TButton>
        <TButton
          type="button"
          title="运行监控"
          :aria-current="view === 'runtime' ? 'page' : undefined"
          @click="navigate('runtime')"
        >
          <span class="scada-button-content">
            <ChartBarIcon aria-hidden="true" />
            <span class="scada-button-label">运行监控</span>
          </span>
        </TButton>
        <TButton
          type="button"
          title="已发布运行"
          :aria-current="view === 'published' ? 'page' : undefined"
          @click="navigate('published')"
        >
          <span class="scada-button-content">
            <FileIcon aria-hidden="true" />
            <span class="scada-button-label">已发布运行</span>
          </span>
        </TButton>
        <TButton
          type="button"
          title="组态编辑"
          :aria-current="view === 'studio' ? 'page' : undefined"
          @click="navigate('studio')"
        >
          <span class="scada-button-content">
            <EditIcon aria-hidden="true" />
            <span class="scada-button-label">组态编辑</span>
          </span>
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
        <div class="scada-app-header-actions">
          <span class="scada-app-safety">{{ safetyLabel }}</span>
          <span class="scada-theme-control">
            <TSwitch
              class="scada-theme-toggle"
              size="medium"
              :value="themeMode === 'dark'"
              role="switch"
              tabindex="0"
              aria-label="深色主题"
              :aria-checked="themeMode === 'dark'"
              @change="changeTheme"
              @keydown.space.prevent="changeTheme(themeMode !== 'dark')"
              @keydown.enter.prevent="changeTheme(themeMode !== 'dark')"
            />
            <span class="scada-theme-icons" aria-hidden="true">
              <SunnyIcon class="scada-theme-sun" />
              <MoonIcon class="scada-theme-moon" />
            </span>
          </span>
        </div>
      </header>
      <RouterView v-slot="{ Component }">
        <component v-if="view === 'home' || view === 'studio'" :is="Component" :theme-mode="themeMode" />
        <component v-else :is="Component" />
      </RouterView>
    </div>
  </div>
</template>
