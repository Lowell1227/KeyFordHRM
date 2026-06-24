<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    message?: string | null;
  }>(),
  {
    message: '该字段未在公示范围内展示。',
  },
);
</script>

<template>
  <div class="score-mask">
    <span class="score-mask__icon">🔒</span>
    <span class="score-mask__text">{{ props.message }}</span>
  </div>
</template>

<style scoped>
.score-mask {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  white-space: nowrap;
}

.score-mask__icon {
  font-size: 12px;
  line-height: 1;
}

.score-mask__text {
  line-height: 1.4;
}
</style>
