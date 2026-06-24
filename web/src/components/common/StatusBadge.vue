<script setup lang="ts">
import { computed } from 'vue';
import type { TaskStatus } from '@/types/enums';
import { TASK_STATUS_META } from '@/types/enums';

const props = withDefaults(
  defineProps<{
    status: TaskStatus;
    size?: 'small' | 'default' | 'large';
  }>(),
  {
    size: 'default',
  },
);

const meta = computed(() => TASK_STATUS_META[props.status] ?? { label: props.status, type: 'info' });

const sizeClass = computed(() => ({
  'status-badge--small': props.size === 'small',
  'status-badge--large': props.size === 'large',
}));
</script>

<template>
  <el-tag
    class="status-badge"
    :class="sizeClass"
    :type="meta.type as any"
    effect="light"
  >
    {{ meta.label }}
  </el-tag>
</template>

<style scoped>
.status-badge {
  border-radius: 4px;
}

.status-badge--small :deep(.el-tag__content) {
  font-size: 12px;
}

.status-badge--large :deep(.el-tag__content) {
  font-size: 14px;
}
</style>
