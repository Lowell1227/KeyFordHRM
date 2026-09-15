<script setup lang="ts">
import { computed } from 'vue';
import type { BusinessDrawerVariant, DrawerBeforeClose } from './types';

const props = withDefaults(defineProps<{
  modelValue: boolean;
  title: string;
  subtitle?: string;
  variant?: BusinessDrawerVariant;
  loading?: boolean;
  saving?: boolean;
  beforeClose?: DrawerBeforeClose;
}>(), {
  subtitle: '',
  variant: 'standard',
  loading: false,
  saving: false,
  beforeClose: undefined,
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  closed: [];
}>();

const drawerSize = computed(() => ({
  standard: 'min(620px, 96vw)',
  workflow: 'min(960px, 96vw)',
  wide: 'min(1180px, 98vw)',
}[props.variant]));
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :title="title"
    :size="drawerSize"
    :before-close="beforeClose"
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    class="business-detail-drawer"
    data-testid="business-detail-drawer"
    :data-drawer-variant="variant"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="emit('closed')"
  >
    <div v-if="subtitle || $slots.summary" class="business-detail-drawer__summary">
      <p v-if="subtitle" class="business-detail-drawer__subtitle">{{ subtitle }}</p>
      <slot name="summary" />
    </div>
    <div v-loading="loading" class="business-detail-drawer__body" :aria-busy="loading">
      <slot />
    </div>
    <template v-if="$slots.footer" #footer>
      <div class="business-detail-drawer__actions" :aria-busy="saving">
        <slot name="footer" />
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.business-detail-drawer__summary {
  margin-bottom: 16px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-extra-light);
}

.business-detail-drawer__subtitle {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 20px;
}

.business-detail-drawer__body {
  min-height: 120px;
}

.business-detail-drawer__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.business-detail-drawer__actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

:global(.business-detail-drawer.el-drawer) {
  display: flex;
  max-width: 100vw;
  flex-direction: column;
}

:global(.business-detail-drawer .el-drawer__body) {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}

:global(.business-detail-drawer .el-drawer__footer) {
  flex: 0 0 auto;
  border-top: 1px solid var(--el-border-color-lighter);
}

@media (max-width: 768px) {
  :global(.business-detail-drawer.el-drawer) {
    width: 100% !important;
    max-width: none;
  }

  :global(.business-detail-drawer .el-drawer__header) {
    margin-bottom: 0;
    padding: 14px 16px;
    border-bottom: 1px solid var(--el-border-color-lighter);
  }

  :global(.business-detail-drawer .el-drawer__body) {
    padding: 14px 16px;
  }

  :global(.business-detail-drawer .el-drawer__footer) {
    padding: 12px 16px;
  }
}
</style>
