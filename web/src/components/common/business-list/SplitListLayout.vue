<script setup lang="ts">
withDefaults(defineProps<{
  scopeOpen: boolean;
  scopeTitle?: string;
  selectedScopeLabel?: string;
}>(), {
  scopeTitle: '选择范围',
  selectedScopeLabel: '',
});

const emit = defineEmits<{
  'update:scopeOpen': [value: boolean];
}>();
</script>

<template>
  <section class="split-list-layout" data-testid="split-list-layout">
    <aside class="split-list-layout__scope">
      <slot name="scope" />
    </aside>
    <section class="split-list-layout__content">
      <div class="split-list-layout__mobile-bar">
        <el-button @click="emit('update:scopeOpen', true)">选择范围</el-button>
        <span v-if="selectedScopeLabel">{{ selectedScopeLabel }}</span>
      </div>
      <slot />
    </section>

    <el-drawer
      :model-value="scopeOpen"
      :title="scopeTitle"
      direction="ltr"
      size="100%"
      class="split-list-layout__mobile-drawer"
      @update:model-value="emit('update:scopeOpen', $event)"
    >
      <slot name="scope" />
    </el-drawer>
  </section>
</template>

<style scoped>
.split-list-layout {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: minmax(220px, 260px) minmax(0, 1fr);
  gap: 16px;
}

.split-list-layout__scope,
.split-list-layout__content {
  min-width: 0;
  min-height: 0;
}

.split-list-layout__scope {
  overflow: auto;
  padding-right: 12px;
  border-right: 1px solid var(--el-border-color-lighter);
  overscroll-behavior: contain;
}

.split-list-layout__content {
  display: flex;
  flex-direction: column;
}

.split-list-layout__mobile-bar {
  display: none;
}

@media (max-width: 768px) {
  .split-list-layout {
    display: block;
  }

  .split-list-layout__scope {
    display: none;
  }

  .split-list-layout__mobile-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
    padding: 0 2px;
    color: var(--el-text-color-regular);
    font-size: 13px;
  }

  .split-list-layout__mobile-bar span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.split-list-layout__mobile-drawer.el-drawer) {
    width: 100% !important;
  }
}
</style>
