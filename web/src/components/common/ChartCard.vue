<script setup lang="ts">
defineProps<{
  /** 卡片标题，如「绩效结果情况分析」 */
  title?: string;
  /** 内容内边距，默认 true */
  padded?: boolean;
}>();
</script>

<template>
  <div class="chart-card">
    <div v-if="title || $slots.title || $slots.extra" class="chart-card__head">
      <span class="chart-card__title">
        <slot name="title">{{ title }}</slot>
      </span>
      <div class="chart-card__extra">
        <slot name="extra" />
      </div>
    </div>
    <div class="chart-card__body" :class="{ 'chart-card__body--padded': padded !== false }">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.chart-card {
  background: var(--app-card-bg);
  border-radius: var(--app-radius);
  box-shadow: var(--app-shadow);
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  transition: box-shadow var(--app-transition);
}

.chart-card:hover {
  box-shadow: var(--app-shadow-hover);
}

.chart-card.list-page-header-card,
.chart-card.list-auxiliary-card,
.chart-card.list-result-card {
  height: auto;
  min-height: 0;
}

.chart-card.list-page-header-card,
.chart-card.list-auxiliary-card {
  flex: 0 0 auto;
}

.chart-card.list-auxiliary-card {
  max-height: 190px;
  overflow: hidden;
}

.chart-card.list-auxiliary-card .chart-card__body {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}

.chart-card.list-result-card {
  flex: 1;
  overflow: hidden;
}

.chart-card.list-result-card .chart-card__body {
  display: flex;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.chart-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 0;
}

.chart-card__title {
  font-size: 15px;
  font-weight: 800;
  color: #1f253d;
}

.chart-card__body {
  flex: 1;
}

.chart-card__body--padded {
  padding: 16px 20px 20px;
}

@media (max-width: 768px) {
  .chart-card.list-result-card {
    overflow: visible;
  }

  .chart-card.list-auxiliary-card {
    max-height: none;
    overflow: visible;
  }

  .chart-card.list-auxiliary-card .chart-card__body {
    overflow: visible;
  }

  .chart-card.list-result-card .chart-card__body {
    display: block;
    overflow: visible;
  }
}
</style>
