<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    description?: string;
  }>(),
  {
    description: '暂无数据',
  },
);
</script>

<template>
  <el-empty class="empty-state" :description="description">
    <slot />
  </el-empty>
</template>

<style scoped>
.empty-state {
  padding: 32px 0;
}
</style>
