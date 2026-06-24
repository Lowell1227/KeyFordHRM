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
</style>
