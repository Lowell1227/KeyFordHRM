<script setup lang="ts">
import { ref } from 'vue';
import { ArrowDown, ArrowUp } from '@element-plus/icons-vue';

withDefaults(
  defineProps<{
    title: string;
    collapsible?: boolean;
  }>(),
  {
    collapsible: false,
  },
);

const expanded = ref(true);
</script>

<template>
  <section class="performance-context-panel">
    <header class="performance-context-panel__header">
      <h2>{{ title }}</h2>
      <el-tooltip v-if="collapsible" :content="expanded ? '收起' : '展开'" placement="top">
        <button
          class="performance-context-panel__toggle"
          type="button"
          :aria-label="expanded ? '收起' : '展开'"
          :aria-expanded="expanded"
          @click="expanded = !expanded"
        >
          <el-icon><component :is="expanded ? ArrowUp : ArrowDown" /></el-icon>
        </button>
      </el-tooltip>
    </header>

    <div v-show="expanded" class="performance-context-panel__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.performance-context-panel {
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.performance-context-panel__header {
  min-height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 16px;
  border-bottom: 1px solid #edf0f4;
}

.performance-context-panel__header h2 {
  margin: 0;
  color: #20283a;
  font-size: 15px;
  font-weight: 650;
}

.performance-context-panel__toggle {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: #697386;
  background: transparent;
  cursor: pointer;
}

.performance-context-panel__toggle:hover {
  color: #1d5fd1;
  background: #f3f6fb;
}

.performance-context-panel__body {
  min-width: 0;
  min-height: 0;
  flex: 1;
  padding: 12px 8px;
  overflow: auto;
}

@media (max-width: 768px) {
  .performance-context-panel {
    height: auto;
  }

  .performance-context-panel__header {
    min-height: 42px;
    padding: 0 12px;
  }

  .performance-context-panel__body {
    padding: 8px 10px;
    overflow: visible;
  }
}
</style>
