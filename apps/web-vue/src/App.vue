<script setup lang="ts">
import { defineAsyncComponent } from "vue";

// Studio will become a separate lazy-loaded feature when implemented.
const RuntimePage = defineAsyncComponent(() => import("./runtime/RuntimePage.vue"));
</script>

<template>
  <RuntimePage />
</template>
