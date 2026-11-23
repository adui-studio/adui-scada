<script setup lang="ts">
import { Button as TButton, Popup as TPopup } from "tdesign-vue-next";
import { onUnmounted, shallowRef } from "vue";
import {
  createStudioProjectBrowser,
  isScadaAccessRejection,
  ScadaApiError,
  STUDIO_PROJECT_PAGE_SIZE,
} from "@adui/scada-api-client";
import type { ScadaApiClient } from "@adui/scada-api-client";

const props = defineProps<{
  api: ScadaApiClient;
  currentProjectId: string;
  disabled: boolean;
}>();
const emit = defineEmits<{
  open: [projectId: string, headRevision: number];
  accessRejected: [error: ScadaApiError];
}>();

/** 只维护列表和分页；工程切换、CAS 与草稿互斥属于 Studio。 */
const browser = createStudioProjectBrowser(props.api);
const page = shallowRef(browser.snapshot());
const loading = shallowRef(false);
const error = shallowRef("");
let inFlight = false;
let active = true;

onUnmounted(() => {
  active = false;
});

async function loadPage(action: "refresh" | "next" | "previous"): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  loading.value = true;
  error.value = "";
  try {
    const result = await browser[action]();
    if (active) page.value = result;
  } catch (cause) {
    if (active) {
      if (isScadaAccessRejection(cause)) {
        page.value = browser.reset();
        emit("accessRejected", cause);
      }
      error.value =
        cause instanceof ScadaApiError ? cause.message : "工程列表读取失败，请检查登录与服务端连接";
    }
  } finally {
    inFlight = false;
    if (active) loading.value = false;
  }
}

function onPopupVisibleChange(visible: boolean): void {
  if (visible) void loadPage("refresh");
}
</script>

<template>
  <div class="studio-version-menu studio-project-browser-menu">
    <TPopup
      attach=".studio-project-browser-menu"
      trigger="click"
      placement="bottom-right"
      @visible-change="onPopupVisibleChange"
    >
      <TButton type="button" variant="outline">工程管理</TButton>
      <template #content>
        <section
          class="studio-version-panel studio-project-browser-panel"
          aria-label="授权工程管理"
        >
          <div class="studio-project-browser-heading">
            <div>
              <strong>服务端工程</strong>
              <p class="studio-version-help">仅显示已授权工程，不包含完整组态文件</p>
            </div>
            <TButton type="button" :disabled="disabled || loading" @click="loadPage('refresh')">
              刷新
            </TButton>
          </div>
          <p class="studio-version-help">
            打开其他工程前会校验最新修订号；本地草稿不会删除，也不会自动发布。
          </p>
          <p v-if="loading" role="status" class="studio-version-help">正在读取授权工程…</p>
          <p v-if="error" role="alert" class="studio-version-error">{{ error }}</p>
          <p
            v-if="page.loaded && !loading && page.projects.length === 0"
            class="studio-project-browser-empty"
            role="status"
          >
            当前页暂无可访问的工程。
          </p>
          <ul class="studio-project-browser-list">
            <li
              v-for="project in page.projects"
              :key="project.projectId"
              class="studio-project-browser-item"
            >
              <div class="studio-project-browser-info">
                <code :title="project.projectId">{{ project.projectId }}</code>
                <span
                  v-if="project.projectId === currentProjectId"
                  class="studio-project-browser-current"
                >
                  当前编辑
                </span>
                <small>
                  修订 #{{ project.headRevision }} · 最近更新：
                  <time :datetime="project.updatedAt">
                    {{ new Date(project.updatedAt).toLocaleString("zh-CN") }}
                  </time>
                </small>
              </div>
              <TButton
                type="button"
                :disabled="disabled || loading"
                :aria-label="'打开工程 ' + project.projectId"
                @click="emit('open', project.projectId, project.headRevision)"
              >
                打开
              </TButton>
            </li>
          </ul>
          <div class="studio-project-browser-pagination">
            <TButton
              type="button"
              :disabled="disabled || loading || !page.hasPrevious"
              @click="loadPage('previous')"
            >
              上一页
            </TButton>
            <span role="status"
              >第 {{ page.pageNumber }} 页 · 每页 {{ STUDIO_PROJECT_PAGE_SIZE }} 条</span
            >
            <TButton
              type="button"
              :disabled="disabled || loading || !page.hasNext"
              @click="loadPage('next')"
            >
              下一页
            </TButton>
          </div>
        </section>
      </template>
    </TPopup>
  </div>
</template>
