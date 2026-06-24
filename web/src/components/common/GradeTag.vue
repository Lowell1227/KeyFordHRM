<script setup lang="ts">
import { computed } from 'vue';
import type { PerfGrade } from '@/types/enums';
import { getGradeStyle, getGradeLabel } from '@/utils/grade';

const props = withDefaults(
  defineProps<{
    grade?: PerfGrade | null;
    size?: 'small' | 'default' | 'large';
    showLabel?: boolean;
  }>(),
  {
    size: 'default',
    showLabel: true,
  },
);

const style = computed(() => getGradeStyle(props.grade));
const label = computed(() => (props.showLabel ? getGradeLabel(props.grade) : props.grade ?? '-'));

const sizeClass = computed(() => ({
  'grade-tag--small': props.size === 'small',
  'grade-tag--large': props.size === 'large',
}));
</script>

<template>
  <span
    class="grade-tag"
    :class="sizeClass"
    :style="style"
  >
    {{ label }}
  </span>
</template>

<style scoped>
.grade-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  padding: 2px 10px;
  border-width: 1px;
  border-style: solid;
  border-radius: 4px;
  font-weight: 500;
  font-size: 13px;
  line-height: 20px;
}

.grade-tag--small {
  padding: 0 6px;
  font-size: 12px;
  line-height: 18px;
}

.grade-tag--large {
  padding: 4px 14px;
  font-size: 14px;
  line-height: 22px;
}
</style>
