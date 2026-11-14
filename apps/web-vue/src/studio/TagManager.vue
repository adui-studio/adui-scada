<script setup lang="ts">
import { ref } from "vue";
import { Button as TButton, Input as TInput } from "tdesign-vue-next";
import { TAG_DATA_TYPE_LABELS } from "@adui/scada-core";
import type { TagDefinition } from "@adui/scada-core";

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

const editingId = ref<string | null>(null);
const draft = ref<TagDraft>(emptyDraft());

function reset() {
  editingId.value = null;
  draft.value = emptyDraft();
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
}

/** 与 React 端共用 Editor 命令契约；本组件不持有第二份工程目录。 */
function submit() {
  const changes: TagDefinitionChanges = {
    displayName: draft.value.displayName,
    dataType: draft.value.dataType,
    unit: draft.value.unit.trim() || null,
    description: draft.value.description,
  };
  const successful = editingId.value
    ? props.onUpdate(editingId.value, changes)
    : props.onCreate({ tagId: draft.value.tagId.trim(), ...changes });
  if (successful) reset();
}

function remove(definition: TagDefinition) {
  if (
    !window.confirm(
      "确定删除项目 Tag“" + definition.displayName + "”吗？被图元绑定的 Tag 不允许删除。",
    )
  ) {
    return;
  }
  if (props.onRemove(definition.tagId) && editingId.value === definition.tagId) reset();
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3">
    <div class="flex min-w-0 flex-col gap-2" role="list" aria-label="项目 Tag 目录">
      <p v-if="tags.length === 0" class="studio-tip">当前工程尚未定义 Tag</p>
      <div v-for="tag in tags" :key="tag.tagId" class="studio-binding min-w-0" role="listitem">
        <strong>{{ tag.displayName }}</strong> ·
        <span class="break-all">{{ tag.tagId }}</span>
        <p class="studio-tip">
          {{ TAG_DATA_TYPE_LABELS[tag.dataType] }}{{ tag.unit ? " · " + tag.unit : "" }}
          {{ tag.dataType === "unknown" ? " · 需要确认数据类型" : "" }}
        </p>
        <p v-if="tag.description" class="studio-tip">{{ tag.description }}</p>
        <div class="studio-toolbox">
          <TButton type="button" size="small" @click="edit(tag)">编辑</TButton>
          <TButton type="button" size="small" @click="remove(tag)">删除</TButton>
        </div>
      </div>
    </div>
    <form
      class="flex min-w-0 flex-col gap-2"
      aria-label="项目 Tag 编辑表单"
      @submit.prevent="submit"
    >
      <strong>{{ editingId ? "编辑项目 Tag" : "新增项目 Tag" }}</strong>
      <label class="studio-field">
        稳定 Tag ID
        <TInput
          v-model="draft.tagId"
          :maxlength="128"
          :disabled="editingId !== null"
          placeholder="例如 water.pressure"
        />
      </label>
      <label class="studio-field">
        显示名称
        <TInput v-model="draft.displayName" :maxlength="128" />
      </label>
      <label class="studio-field">
        数据类型
        <select v-model="draft.dataType" aria-label="项目 Tag 数据类型">
          <option v-if="editingId !== null && draft.dataType === 'unknown'" value="unknown">
            待确认（历史迁移占位）
          </option>
          <option value="number">数值</option>
          <option value="boolean">布尔值</option>
          <option value="string">文本</option>
        </select>
      </label>
      <label class="studio-field">
        单位（可选）
        <TInput v-model="draft.unit" :maxlength="32" placeholder="留空表示无单位" />
      </label>
      <label class="studio-field">
        描述（可选）
        <textarea v-model="draft.description" rows="3" maxlength="512" />
      </label>
      <div class="studio-toolbox">
        <TButton type="submit">{{ editingId ? "保存修改" : "新增 Tag" }}</TButton>
        <TButton type="button" @click="reset">{{ editingId ? "取消编辑" : "清空" }}</TButton>
      </div>
    </form>
    <p class="studio-tip">
      Tag ID 创建后不可更改。定义随工程 JSON、草稿和本地历史版本保存，支持撤销和重做； 已绑定 Tag
      不允许删除或改成不兼容类型。这里只管理元数据，不涉及设备连接或写入。
    </p>
  </div>
</template>
