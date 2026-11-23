<script setup lang="ts">
import { computed, ref } from "vue";
import {
  Button as TButton,
  Dialog as TDialog,
  Input as TInput,
  Select as TSelect,
  Textarea as TTextarea,
} from "tdesign-vue-next";
import { TAG_DATA_TYPE_LABELS } from "@adui/scada-core";
import type { TagDefinition } from "@adui/scada-core";
import { confirmStudioAction } from "./StudioDialog";

type TagDataType = TagDefinition["dataType"];
type TagDefinitionChanges = Pick<
  TagDefinition,
  "displayName" | "dataType" | "unit" | "description"
>;

const props = defineProps<{
  readonly tags: readonly TagDefinition[];
  readonly onCreate: (definition: TagDefinition) => boolean;
  readonly onUpdate: (tagId: string, changes: TagDefinitionChanges) => boolean;
  readonly onRemove: (tagId: string) => boolean;
}>();

interface TagDraft {
  tagId: string;
  displayName: string;
  dataType: TagDataType;
  unit: string;
  description: string;
}

function emptyDraft(): TagDraft {
  return { tagId: "", displayName: "", dataType: "number", unit: "", description: "" };
}

const query = ref("");
const editorOpen = ref(false);
const editingId = ref<string | null>(null);
const draft = ref<TagDraft>(emptyDraft());
const formError = ref("");

const visibleTags = computed(() => {
  const search = query.value.trim().toLocaleLowerCase();
  return search
    ? props.tags.filter((tag) =>
        [tag.displayName, tag.tagId, tag.description, tag.unit ?? ""].some((value) =>
          value.toLocaleLowerCase().includes(search),
        ),
      )
    : props.tags;
});

function closeEditor() {
  editorOpen.value = false;
  editingId.value = null;
  draft.value = emptyDraft();
  formError.value = "";
}

function create() {
  editingId.value = null;
  draft.value = emptyDraft();
  formError.value = "";
  editorOpen.value = true;
}

function edit(definition: TagDefinition) {
  editingId.value = definition.tagId;
  draft.value = {
    tagId: definition.tagId,
    displayName: definition.displayName,
    dataType: definition.dataType,
    unit: definition.unit ?? "",
    description: definition.description,
  };
  formError.value = "";
  editorOpen.value = true;
}

/** React/Vue 只承担浏览与表单，写入仍由共享 Editor 校验及保护。 */
function submit() {
  const tagId = draft.value.tagId.trim();
  if (!draft.value.displayName.trim()) {
    formError.value = "请填写 Tag 显示名称。";
    return;
  }
  if (editingId.value === null && !tagId) {
    formError.value = "请填写稳定 Tag ID。";
    return;
  }
  if (editingId.value === null && props.tags.some((tag) => tag.tagId === tagId)) {
    formError.value = "Tag ID 已存在，请使用其他标识。";
    return;
  }

  const changes: TagDefinitionChanges = {
    displayName: draft.value.displayName,
    dataType: draft.value.dataType,
    unit: draft.value.unit.trim() || null,
    description: draft.value.description,
  };
  const successful = editingId.value
    ? props.onUpdate(editingId.value, changes)
    : props.onCreate({ tagId, ...changes });
  if (successful) closeEditor();
  else formError.value = "保存未完成，请检查工作台状态提示和字段内容。";
}

function changeTagDataType(value: unknown): void {
  if (value === "number" || value === "boolean" || value === "string" || value === "unknown") {
    draft.value.dataType = value;
    formError.value = "";
  }
}

async function remove(definition: TagDefinition) {
  if (
    !(await confirmStudioAction(
      "确定删除项目 Tag“" + definition.displayName + "”吗？被图元绑定的 Tag 不允许删除。",
    ))
  ) {
    return;
  }
  if (props.onRemove(definition.tagId) && editingId.value === definition.tagId) closeEditor();
}
</script>

<template>
  <div class="studio-tag-manager">
    <div class="studio-tag-toolbar">
      <span class="studio-tag-toolbar-title">Tag 目录</span>
      <TButton type="button" size="small" theme="primary" @click="create">新建 Tag</TButton>
    </div>
    <TInput
      v-model="query"
      size="small"
      class="studio-tag-search"
      aria-label="搜索项目 Tag"
      placeholder="搜索名称、ID 或描述"
    />
    <div class="studio-tag-summary" role="status">
      {{
        query.trim()
          ? "找到 " + visibleTags.length + " / " + tags.length + " 项"
          : "共 " + tags.length + " 项定义"
      }}
      <span>工程内元数据</span>
    </div>
    <div class="studio-tag-list" role="list" aria-label="项目 Tag 目录">
      <div v-if="visibleTags.length === 0" class="studio-tag-empty">
        <strong>{{ tags.length === 0 ? "还没有 Tag 定义" : "没有匹配的 Tag" }}</strong>
        <p>{{ tags.length === 0 ? "点击「新建 Tag」添加工程数据定义。" : "尝试修改搜索关键词。" }}</p>
      </div>
      <div v-for="tag in visibleTags" :key="tag.tagId" role="listitem" class="studio-tag-item">
        <div class="studio-tag-item-heading">
          <strong :title="tag.displayName">{{ tag.displayName }}</strong>
          <span class="studio-tag-type">{{ TAG_DATA_TYPE_LABELS[tag.dataType] }}</span>
        </div>
        <span class="break-all studio-tag-id" :title="tag.tagId">{{ tag.tagId }}</span>
        <p
          v-if="tag.unit || tag.description || tag.dataType === 'unknown'"
          class="studio-tag-item-note"
          :title="tag.description"
        >
          {{ tag.unit ? "单位 " + tag.unit + (tag.description ? " · " : "") : "" }}
          {{ tag.description }}
          {{ tag.dataType === "unknown" ? " · 数据类型待确认" : "" }}
        </p>
        <div class="studio-tag-actions" :aria-label="tag.displayName + ' 操作'">
          <TButton type="button" size="small" variant="text" @click="edit(tag)">编辑</TButton>
          <TButton
            type="button"
            size="small"
            theme="danger"
            variant="text"
            @click="() => void remove(tag)"
          >
            删除
          </TButton>
        </div>
      </div>
    </div>
    <p class="studio-tag-catalog-help">
      定义随工程草稿保存，已绑定的 Tag 不能删除或改为不兼容类型。
    </p>
    <TDialog
      class="studio-tag-dialog"
      :visible="editorOpen"
      :header="editingId ? '编辑 Tag 定义' : '新建 Tag 定义'"
      width="min(700px, calc(100vw - 32px))"
      :footer="false"
      :destroy-on-close="true"
      :close-on-esc-keydown="true"
      :close-on-overlay-click="false"
      @close="closeEditor"
    >
      <p class="studio-tag-form-intro">配置工程内的数据定义，不涉及现场设备连接或写入。</p>
      <form
        class="studio-tag-form"
        aria-label="项目 Tag 编辑表单"
        @submit.prevent="submit"
      >
        <div class="studio-tag-form-grid">
          <label class="studio-field">
            显示名称 <span class="studio-tag-required">*</span>
            <TInput
              v-model="draft.displayName"
              :maxlength="128"
              placeholder="例如 模拟水位"
              @change="formError = ''"
            />
          </label>
          <label class="studio-field">
            稳定 Tag ID <span class="studio-tag-required">*</span>
            <TInput
              v-model="draft.tagId"
              :maxlength="128"
              :disabled="editingId !== null"
              placeholder="例如 water.pressure"
              @change="formError = ''"
            />
            <small class="studio-tag-field-help">
              {{ editingId ? "创建后不可修改" : "创建后不可更改，将用于工程绑定" }}
            </small>
          </label>
          <label class="studio-field">
            数据类型 <span class="studio-tag-required">*</span>
            <TSelect
              :value="draft.dataType"
              :options="[
                ...(editingId !== null && draft.dataType === 'unknown'
                  ? [{ label: '待确认（历史迁移占位）', value: 'unknown' }]
                  : []),
                { label: '数值', value: 'number' },
                { label: '布尔值', value: 'boolean' },
                { label: '文本', value: 'string' },
              ]"
              @change="changeTagDataType"
            />
          </label>
          <label class="studio-field">
            单位 <span class="studio-tag-optional">选填</span>
            <TInput
              v-model="draft.unit"
              :maxlength="32"
              placeholder="例如 m³/h"
              @change="formError = ''"
            />
          </label>
          <label class="studio-field studio-tag-description-field">
            描述 <span class="studio-tag-optional">选填</span>
            <TTextarea
              v-model="draft.description"
              :autosize="{ minRows: 3, maxRows: 5 }"
              :maxlength="512"
              placeholder="说明数据含义、用途或绑定约束"
              @change="formError = ''"
            />
          </label>
        </div>
        <p v-if="formError" class="studio-tag-form-error" role="alert">{{ formError }}</p>
        <div class="studio-tag-form-footer">
          <span class="studio-tag-form-footnote">变更支持工作台撤销 / 重做</span>
          <div class="studio-tag-form-actions">
            <TButton type="button" variant="outline" @click="closeEditor">取消</TButton>
            <TButton type="submit" theme="primary">
              {{ editingId ? "保存修改" : "创建 Tag" }}
            </TButton>
          </div>
        </div>
      </form>
    </TDialog>
  </div>
</template>
