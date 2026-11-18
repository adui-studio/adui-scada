<script setup lang="ts">
import { computed, onUnmounted, shallowRef } from "vue";
import { compareProjectDocuments } from "@adui/scada-core";
import type { ScadaDocument } from "@adui/scada-core";
import {
  isScadaAccessRejection,
  readCurrentServerReleasePreflight,
  ScadaApiError,
} from "@adui/scada-api-client";
import type {
  ScadaApiClient,
  StudioServerReleasePreflight,
} from "@adui/scada-api-client";

const props = defineProps<{
  api: ScadaApiClient;
  document: ScadaDocument;
  disabled: boolean;
}>();

const emit = defineEmits<{
  accessRejected: [error: ScadaApiError];
}>();

interface CheckedReleasePreflight extends StudioServerReleasePreflight {
  readonly requestedDocument: ScadaDocument;
}

const busy = shallowRef(false);
const checked = shallowRef<CheckedReleasePreflight | null>(null);
const failure = shallowRef<{ document: ScadaDocument; message: string } | null>(null);
const visible = computed(() =>
  checked.value?.requestedDocument === props.document ? checked.value : null,
);
const comparison = computed(() =>
  visible.value
    ? compareProjectDocuments(props.document, visible.value.snapshot.document)
    : null,
);
const error = computed(() =>
  failure.value?.document === props.document ? failure.value.message : "",
);

let inFlight = false;
let active = true;
onUnmounted(() => {
  active = false;
});

/** 只读版本预检不触发编辑操作，也不建立或清除 Studio CAS 基线。 */
async function checkSavedVersion(): Promise<void> {
  if (props.disabled || inFlight) return;
  inFlight = true;
  busy.value = true;
  checked.value = null;
  failure.value = null;
  const requestedDocument = props.document;
  try {
    const result = await readCurrentServerReleasePreflight(props.api, requestedDocument.projectId);
    if (active && props.document === requestedDocument) {
      checked.value = { ...result, requestedDocument };
    }
  } catch (cause) {
    if (active && props.document === requestedDocument) {
      if (isScadaAccessRejection(cause)) emit("accessRejected", cause);
      failure.value = {
        document: requestedDocument,
        message:
          cause instanceof ScadaApiError
            ? cause.message
            : "服务端发布预检失败，请检查当前登录和网络连接",
      };
    }
  } finally {
    inFlight = false;
    if (active) busy.value = false;
  }
}
</script>

<template>
  <section class="studio-version-panel" aria-label="服务端已保存版本发布预检">
    <p class="studio-version-help">
      服务端预检仅检查已保存的当前修订，与上方当前画布静态预检不同；不会保存、发布或修改草稿。
    </p>
    <button
      type="button"
      class="studio-version-more"
      :disabled="disabled || busy"
      @click="checkSavedVersion"
    >
      {{ busy ? "正在只读检查服务端版本…" : "检查服务端已保存版本" }}
    </button>
    <p v-if="error" class="studio-version-error" role="alert">
      {{ error }}；当前画布与 IndexedDB 草稿不变。
    </p>
    <p v-if="checked && !visible" class="studio-version-help">
      编辑内容已发生变化，之前的服务端预检结果已隐藏，请重新检查。
    </p>
    <div v-if="visible">
      <p class="studio-version-help" role="status">
        服务端已保存版本 #{{ visible.report.revision }}：{{
          visible.report.passed ? "静态兼容性通过" : "静态兼容性未通过"
        }}；{{
          comparison?.sameContent
            ? "当前画布与所检查的快照一致"
            : "当前画布与已保存快照不同，当前画布不能视为通过服务端预检"
        }}。该结果仅代表读取时的版本，不是正式发布许可。
      </p>
      <ol
        v-if="!visible.report.passed"
        class="studio-version-list"
        aria-label="服务端发布预检问题"
      >
        <li
          v-for="(issue, index) in visible.report.issues"
          :key="`${issue.code}:${issue.path}:${index}`"
          class="studio-version-item"
        >
          <code>{{ issue.path }}</code>
          <p class="studio-version-help">{{ issue.message }}</p>
        </li>
      </ol>
    </div>
  </section>
</template>
