<script setup lang="ts">
defineOptions({ inheritAttrs: false });
defineProps<{ modelValue: boolean; title: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; close: [] }>();
</script>

<template>
  <el-drawer
    v-bind="$attrs"
    :model-value="modelValue"
    :title="title"
    class="performance-result-drawer"
    size="min(720px, 100vw)"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
    @close="emit('close')"
  >
    <slot />
    <template #footer>
      <div class="performance-result-actions">
        <slot name="footer"><el-button @click="emit('update:modelValue', false)">关闭</el-button></slot>
      </div>
    </template>
  </el-drawer>
</template>
