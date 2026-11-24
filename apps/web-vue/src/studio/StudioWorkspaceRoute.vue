<script setup lang="ts">
import { Button as TButton } from "tdesign-vue-next";
import { readWorkspaceStudioRoute } from "@adui/scada-draft-storage";
import { takeWorkspaceStudioEntry, workspaceStudioPath } from "@adui/scada-runtime";
import type { WorkspaceStudioEntry } from "@adui/scada-runtime";
import { computed, shallowRef, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import StudioPage from "./StudioPage.vue";

defineProps<{ themeMode: "light" | "dark" }>();
const route = useRoute();
const router = useRouter();
const projectId = computed(() =>
  typeof route.params.projectId === "string" && route.params.projectId ? route.params.projectId : undefined,
);
const loaded = shallowRef<{ entry: WorkspaceStudioEntry; session: number } | null>(null);
const error = ref("");
let session = 0;
let activeRoute: string | null = null;
let activeProject: string | null = null;

watch(
  projectId,
  (id, _previous, onCleanup) => {
    const routeId = id ?? "";
    if (activeRoute === routeId) return;
    if (id !== undefined && activeProject === id) {
      activeRoute = routeId;
      return;
    }
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    loaded.value = null;
    error.value = "";
    activeRoute = null;
    activeProject = null;
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      try {
        const entry = takeWorkspaceStudioEntry(id) ?? (await readWorkspaceStudioRoute(id));
        if (controller.signal.aborted) return;
        activeRoute = routeId;
        activeProject = entry.document.projectId;
        session += 1;
        loaded.value = { entry, session };
      } catch (cause) {
        if (!controller.signal.aborted) {
          error.value = cause instanceof Error ? cause.message : "工程载入失败";
        }
      }
    });
  },
  { immediate: true },
);

function changeProject(id: string) {
  activeProject = id;
  activeRoute = id;
  void router.replace(workspaceStudioPath(id));
}
</script>

<template>
  <StudioPage
    v-if="loaded"
    :key="loaded.session"
    :initial-document="loaded.entry.document"
    :initial-notice="loaded.entry.notice"
    :initial-clean="loaded.entry.clean"
    :theme-mode="themeMode"
    @project-change="changeProject"
  />
  <main v-else id="scada-main-content" class="scada-loading" :role="error ? 'alert' : 'status'">
    {{ error || "正在读取组态工程…" }}
    <TButton v-if="error" @click="router.push('/')">返回工作台</TButton>
  </main>
</template>
