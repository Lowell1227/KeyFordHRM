<script setup lang="ts">
import ChartCard from '@/components/common/ChartCard.vue';
import type { BusinessListVariant } from './types';

withDefaults(defineProps<{
  variant: BusinessListVariant;
  loading?: boolean;
}>(), {
  loading: false,
});
</script>

<template>
  <div
    class="page-stack app-list-page business-list-page"
    data-testid="business-list-page"
    :data-list-variant="variant"
    :aria-busy="loading"
  >
    <slot v-if="$slots.workspace" name="workspace" />
    <template v-else>
      <ChartCard class="list-page-header-card business-list-page__header">
        <template #title><slot name="title" /></template>
        <template v-if="$slots['primary-action']" #extra><slot name="primary-action" /></template>
        <p v-if="$slots.subtitle" class="business-list-page__subtitle"><slot name="subtitle" /></p>
        <slot name="summary" />
        <slot name="filters" />
      </ChartCard>

      <ChartCard :padded="false" class="list-result-card business-list-page__results">
        <slot name="feedback" />
        <div class="desktop-result-table"><slot name="desktop-list" /></div>
        <div class="mobile-result-list"><slot name="mobile-list" /></div>
        <slot name="pagination" />
      </ChartCard>

      <slot name="detail" />
    </template>
  </div>
</template>

<style scoped>
.business-list-page {
  min-width: 0;
}

.business-list-page__subtitle {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 20px;
}

.business-list-page__results {
  min-width: 0;
}

@media (max-width: 768px) {
  .business-list-page :deep(.chart-card__head) {
    align-items: flex-start;
    gap: 10px;
  }

  .business-list-page :deep(.chart-card__extra) {
    flex: 0 0 auto;
  }
}
</style>
