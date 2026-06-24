<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    percent?: number;
    status?: 'success' | 'warning' | 'exception' | '';
    strokeWidth?: number;
    showText?: boolean;
  }>(),
  {
    percent: 0,
    status: '',
    strokeWidth: 8,
    showText: true,
  },
);

const safePercent = computed(() => Math.max(0, Math.min(100, props.percent ?? 0)));
</script>

<template>
  <el-progress
    class="progress-bar"
    :percentage="safePercent"
    :status="status"
    :stroke-width="strokeWidth"
    :show-text="showText"
  />
</template>

<style scoped>
.progress-bar {
  width: 100%;
}
</style>
