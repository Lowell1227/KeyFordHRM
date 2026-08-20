<script setup lang="ts">
import { ref } from 'vue';
import { ArrowDown, ArrowUp } from '@element-plus/icons-vue';

withDefaults(defineProps<{
  title?: string;
}>(), {
  title: '筛选条件',
});

const collapsed = ref(false);
</script>

<template>
  <section class="collapsible-filter-panel" :class="{ 'is-collapsed': collapsed }">
    <div class="collapsible-filter-panel__head">
      <strong>{{ title }}</strong>
      <el-button
        text
        type="primary"
        :icon="collapsed ? ArrowDown : ArrowUp"
        :aria-expanded="!collapsed"
        @click="collapsed = !collapsed"
      >
        {{ collapsed ? '展开筛选' : '收起筛选' }}
      </el-button>
    </div>
    <div v-show="!collapsed" class="collapsible-filter-panel__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.collapsible-filter-panel {
  flex: 0 0 auto;
  margin-bottom: 16px;
  overflow: hidden;
  border: 1px solid #e8edf5;
  border-radius: 8px;
  background: #fbfcff;
}

.collapsible-filter-panel__head {
  display: flex;
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 14px;
}

.collapsible-filter-panel__head strong {
  color: #344054;
  font-size: 13px;
}

.collapsible-filter-panel__body {
  padding: 12px 14px;
  border-top: 1px solid #edf1f7;
}

.collapsible-filter-panel.is-collapsed {
  background: #fff;
}

.collapsible-filter-panel.page-filter-panel {
  margin-bottom: 0;
}

@media (max-width: 768px) {
  .collapsible-filter-panel {
    margin-bottom: 12px;
  }
}
</style>
