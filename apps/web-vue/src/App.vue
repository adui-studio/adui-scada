<script setup lang="ts">
import { Button as TButton, Input as TInput, Switch as TSwitch, Upload as TUpload } from "tdesign-vue-next";
import { AppIcon, ChartBarIcon, FileIcon, EditIcon, SunnyIcon, MoonIcon, AddIcon, UploadIcon, ChevronRightIcon } from "tdesign-icons-vue-next";
import { waterTreatmentShowcaseDocument } from "@adui/scada-core";
import type { ScadaDocument } from "@adui/scada-core";
import {
  createWorkspaceDraft,
  listWorkspaceDrafts,
  readWorkspaceDraft,
  readWorkspaceJson,
} from "@adui/scada-draft-storage";
import type { WorkspaceDraftSummary } from "@adui/scada-draft-storage";
import {
  WORKSPACE_HOME_ENTRIES,
  filterWorkspaceHomeEntries,
  readWorkspaceTheme,
  transitionWorkspaceTheme,
} from "@adui/scada-runtime";
import "tdesign-vue-next/es/style/index.css";
import { computed, defineAsyncComponent, nextTick, ref, shallowRef, watch } from "vue";

const RuntimePage = defineAsyncComponent(() => import("./runtime/RuntimePage.vue"));
const PublishedRuntimePage = defineAsyncComponent(
  () => import("./runtime/PublishedRuntimePage.vue"),
);
const StudioPage = defineAsyncComponent(() => import("./studio/StudioPage.vue"));
const view = ref<"home" | "runtime" | "published" | "studio">("home");
const themeMode = ref(readWorkspaceTheme());

function changeTheme(checked: unknown) {
  if (typeof checked !== "boolean") return;
  const next = checked ? "dark" : "light";
  void transitionWorkspaceTheme(next, async () => {
    themeMode.value = next;
    await nextTick();
  });
}

const query = ref("");
const entries = computed(() => filterWorkspaceHomeEntries(query.value));
const initialDocument = shallowRef<ScadaDocument | null>(null);
const initialNotice = ref("");
const drafts = shallowRef<readonly WorkspaceDraftSummary[]>([]);
const draftStatus = ref("正在读取本地草稿…");
const busy = ref(false);
const visibleDrafts = computed(() =>
  drafts.value.filter((draft) =>
    draft.projectId.toLowerCase().includes(query.value.trim().toLowerCase()),
  ),
);
let lifetime: AbortController | null = null;

type AppView = typeof view.value;

function navigate(next: AppView) {
  if (next === "studio" && view.value !== "studio") {
    initialDocument.value = null;
    initialNotice.value = "";
  }
  view.value = next;
}

watch(
  view,
  (next, _previous, onCleanup) => {
    if (next !== "home") return;
    const controller = new AbortController();
    lifetime = controller;
    query.value = "";
    busy.value = false;
    drafts.value = [];
    draftStatus.value = "正在读取本地草稿…";
    onCleanup(() => controller.abort());
    void listWorkspaceDrafts().then(
      (rows) => {
        if (controller.signal.aborted) return;
        drafts.value = rows;
        draftStatus.value = rows.length ? "" : "暂无已保存的本地草稿";
      },
      () => {
        if (!controller.signal.aborted) {
          draftStatus.value = "本地草稿读取失败，请检查浏览器存储权限";
        }
      },
    );
  },
  { immediate: true },
);

async function openFromHome(load: () => Promise<{ document: ScadaDocument; notice: string }>) {
  const controller = lifetime;
  if (!controller || controller.signal.aborted || busy.value || view.value !== "home") return;
  busy.value = true;
  try {
    const result = await load();
    if (controller.signal.aborted || view.value !== "home") return;
    initialDocument.value = result.document;
    initialNotice.value = result.notice;
    view.value = "studio";
  } catch {
    if (!controller.signal.aborted) {
      draftStatus.value = "工程操作失败，请检查文件或本地存储";
    }
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

function openEntry(next: AppView) {
  if (next === "studio") {
    initialDocument.value = waterTreatmentShowcaseDocument;
    initialNotice.value = "已打开水处理总览示例 · 静态模拟预览";
    view.value = "studio";
  } else {
    navigate(next);
  }
}

function newProject() {
  void openFromHome(async () => {
    const draft = await createWorkspaceDraft();
    return { document: draft.document, notice: "已创建并保存独立本地工程" };
  });
}

function importProject(files: File[]) {
  const file = files[0];
  if (!file) return;
  void openFromHome(async () => {
    const result = await readWorkspaceJson(file);
    return {
      document: result.document,
      notice: result.migratedFrom
        ? `已从 ${result.migratedFrom} 迁移工程，请重新保存或导出`
        : "工程 JSON 已校验，请按需保存本地草稿",
    };
  });
}

function openDraft(projectId: string) {
  void openFromHome(async () => {
    const latest = await readWorkspaceDraft(projectId);
    return { document: latest.document, notice: "已打开最新本地草稿" };
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
    <a class="scada-skip-link" href="#scada-main-content">跳转到主要内容</a>
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
      <main v-if="view === 'home'" id="scada-main-content" class="scada-home flex min-w-0 flex-col">
        <div class="scada-home-heading flex flex-wrap items-center justify-between">
          <div>
            <h1>工程工作区</h1>
            <p>设计、管理与只读监控</p>
          </div>
          <div class="scada-home-search">
            <TInput
              v-model="query"
              placeholder="搜索工作区、工程、Tag"
              aria-label="搜索工作区"
              clearable
            />
          </div>
        </div>
        <div class="scada-home-quick-grid grid">
          <button type="button" class="scada-home-quick" :disabled="busy" @click="newProject">
            <span class="scada-home-card-icon" aria-hidden="true"><AddIcon /></span>
            <strong>新建组态工程</strong>
            <ChevronRightIcon aria-hidden="true" />
          </button>
          <div class="scada-home-upload">
            <TUpload
              theme="custom"
              accept=".json,application/json"
              :auto-upload="false"
              :files="[]"
              allow-upload-duplicate-file
              :disabled="busy"
              @select-change="importProject"
            >
              <button type="button" class="scada-home-quick" :disabled="busy">
                <span class="scada-home-card-icon" aria-hidden="true"><UploadIcon /></span>
                <strong>导入 JSON 工程</strong>
                <ChevronRightIcon aria-hidden="true" />
              </button>
            </TUpload>
          </div>
          <button
            v-for="entry in WORKSPACE_HOME_ENTRIES"
            :key="entry.view"
            type="button"
            class="scada-home-quick"
            @click="openEntry(entry.view)"
          >
            <span class="scada-home-card-icon" aria-hidden="true">
              <EditIcon v-if="entry.view === 'studio'" aria-hidden="true" />
              <ChartBarIcon v-else-if="entry.view === 'runtime'" aria-hidden="true" />
              <FileIcon v-else aria-hidden="true" />
            </span>
            <strong>{{ entry.action }}</strong>
            <ChevronRightIcon aria-hidden="true" />
          </button>
        </div>
        <section class="scada-home-section" aria-labelledby="scada-home-explore">
          <div class="scada-home-section-head">
            <h2 id="scada-home-explore">探索 ADui SCADA</h2>
            <span>工业可视化与组态</span>
          </div>
          <div class="scada-home-banner-grid grid">
            <article class="scada-home-banner scada-home-banner-brand">
              <div>
                <strong>ADui SCADA</strong>
                <p>工业组态 · 实时监控</p>
                <small>从工艺画面开始构建工程</small>
              </div>
              <img
                class="scada-home-brand-mark"
                :src="themeMode === 'dark' ? '/brand/mark-dark.svg' : '/brand/mark-primary.svg'"
                alt=""
              />
            </article>
            <article class="scada-home-banner">
              <div>
                <strong>精密组态设计</strong>
                <p>1920 × 1080 默认画板</p>
                <small>图层、图元、属性与 Tag</small>
              </div>
              <EditIcon aria-hidden="true" />
            </article>
            <article class="scada-home-banner scada-home-banner-runtime">
              <div>
                <strong>只读运行监控</strong>
                <p>模拟数据与正式发布分离</p>
                <small>设备写入未开放</small>
              </div>
              <ChartBarIcon aria-hidden="true" />
            </article>
          </div>
        </section>
        <section class="scada-home-section" aria-labelledby="scada-home-start">
          <div class="scada-home-section-head">
            <h2 id="scada-home-start">工程与工作区</h2>
            <span>共 {{ entries.length }} 个入口</span>
          </div>
          <div class="scada-home-card-grid grid">
            <button
              v-for="entry in entries"
              :key="entry.view"
              type="button"
              class="scada-home-card"
              @click="openEntry(entry.view)"
            >
              <span class="scada-home-thumbnail" :data-kind="entry.view">
                <img
                  v-if="entry.preview"
                  :src="entry.preview"
                  alt="内置水处理工程静态预览，无实时值"
                />
                <span v-else aria-hidden="true">
                  <EditIcon v-if="entry.view === 'studio'" aria-hidden="true" />
              <ChartBarIcon v-else-if="entry.view === 'runtime'" aria-hidden="true" />
              <FileIcon v-else aria-hidden="true" />
                </span>
              </span>
              <strong>{{ entry.title }}</strong>
              <span class="scada-home-status" :data-kind="entry.view">{{ entry.status }}</span>
              <span class="scada-home-description">{{ entry.description }}</span>
              <small>{{ entry.detail }}</small>
            </button>
          </div>
          <p v-if="entries.length === 0" role="status">没有匹配的工作区，请尝试其他关键词。</p>
        </section>
        <section class="scada-home-section" aria-labelledby="scada-home-drafts">
          <div class="scada-home-section-head">
            <h2 id="scada-home-drafts">我的草稿</h2>
            <span>最近 50 个已保存的本地工程</span>
          </div>
          <p v-if="draftStatus" role="status">{{ draftStatus }}</p>
          <p v-if="drafts.length > 0 && visibleDrafts.length === 0">没有匹配的本地草稿</p>
          <div class="scada-home-draft-grid">
            <button
              v-for="draft in visibleDrafts"
              :key="draft.projectId"
              type="button"
              class="scada-home-draft"
              :disabled="busy"
              @click="openDraft(draft.projectId)"
            >
              <strong>{{ draft.projectId }}</strong>
              <span>{{ draft.pageCount }} 个页面 · {{ draft.tagCount }} 个 Tag</span>
              <small
                >修订 {{ draft.revision }} ·
                {{ new Date(draft.savedAt).toLocaleString("zh-CN") }}</small
              >
            </button>
          </div>
        </section>
        <p class="scada-home-footnote">草稿仅保存在当前浏览器；本页不展示未经核实的发布状态。</p>
      </main>
      <RuntimePage v-else-if="view === 'runtime'" />
      <PublishedRuntimePage v-else-if="view === 'published'" />
      <StudioPage v-else :initial-document="initialDocument" :initial-notice="initialNotice" />
    </div>
  </div>
</template>
