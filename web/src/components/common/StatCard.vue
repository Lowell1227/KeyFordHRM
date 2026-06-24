<script setup lang="ts">
import { computed } from 'vue';
import type { Component } from 'vue';

type GradientKey = 'blue' | 'purple' | 'red' | 'gold' | 'green';

const props = withDefaults(
  defineProps<{
    /** 指标名称，如「参评人数」 */
    label: string;
    /** 主数值（已格式化的字符串或数字） */
    value: string | number;
    /** 数值单位，如「分」「%」 */
    unit?: string;
    /** 环比变化，正负数；不传则不显示 */
    delta?: number | null;
    /** delta 的单位，默认与主单位一致的箭头标签 */
    deltaUnit?: string;
    /** 左上角图标组件（来自 @element-plus/icons-vue 或自定义） */
    icon?: Component;
    /** 渐变徽章配色 */
    gradient?: GradientKey;
  }>(),
  {
    gradient: 'blue',
  },
);

const deltaText = computed(() => {
  if (props.delta == null) return '';
  const sign = props.delta > 0 ? '+' : '';
  return `${sign}${props.delta}${props.deltaUnit ?? ''}`;
});

const deltaUp = computed(() => (props.delta ?? 0) >= 0);
</script>

<template>
  <div class="stat-card">
    <div class="stat-card__icon" :style="{ background: `var(--grad-${gradient})` }">
      <el-icon v-if="icon"><component :is="icon" /></el-icon>
    </div>
    <div class="stat-card__label">{{ label }}</div>
    <div class="stat-card__value-row">
      <span class="stat-card__value">{{ value }}</span>
      <span v-if="unit" class="stat-card__unit">{{ unit }}</span>
      <span v-if="delta != null" class="stat-card__delta" :class="deltaUp ? 'up' : 'down'">
        {{ deltaText }}
        <span class="stat-card__arrow">{{ deltaUp ? '↑' : '↓' }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.stat-card {
  background: var(--app-card-bg);
  border-radius: var(--app-radius);
  box-shadow: var(--app-shadow);
  padding: 22px 20px 20px;
  min-height: 168px;
  height: 100%;
  box-sizing: border-box;
  transition: box-shadow var(--app-transition), transform var(--app-transition);
}

.stat-card:hover {
  box-shadow: var(--app-shadow-hover);
  transform: translateY(-2px);
}

.stat-card__icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 22px;
  margin-bottom: 22px;
  box-shadow: 0 10px 18px rgba(93, 116, 247, 0.22);
}

.stat-card__label {
  font-size: 13px;
  color: #1f253d;
  margin-bottom: 10px;
  font-weight: 600;
}

.stat-card__value-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.stat-card__value {
  font-size: 28px;
  font-weight: 800;
  color: var(--app-text-primary);
  line-height: 1.1;
}

.stat-card__unit {
  font-size: 14px;
  color: #1f253d;
  font-weight: 700;
}

.stat-card__delta {
  font-size: 11px;
  font-weight: 600;
  margin-left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 1px;
}

.stat-card__delta.up {
  color: #5574f7;
}

.stat-card__delta.down {
  color: var(--el-color-danger);
}

.stat-card__arrow {
  font-size: 11px;
}
</style>
