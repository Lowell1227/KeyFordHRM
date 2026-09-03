<script setup lang="ts">
import { computed } from 'vue';
import type { PeriodReviewIndicator } from '@/types/api.types';

const props = defineProps<{ indicator: PeriodReviewIndicator }>();

const targetText = computed(() => {
  if (props.indicator.targetValueText) return props.indicator.targetValueText;
  if (props.indicator.targetValue == null) return '未设置';
  return `${props.indicator.targetValue}${props.indicator.unit ?? ''}`;
});

function healthLabel(status: PeriodReviewIndicator['healthStatus']) {
  if (status === 'on_track') return '正常推进';
  if (status === 'at_risk') return '存在风险';
  if (status === 'blocked') return '当前受阻';
  if (status === 'completed') return '已经完成';
  return '未更新';
}
</script>

<template>
  <details class="period-review-context" data-testid="period-review-indicator-context">
    <summary>
      <span>目标依据</span>
      <em>目标值 {{ targetText }}</em>
      <em>历史月度结果 {{ indicator.history.length }}条</em>
    </summary>
    <div class="period-review-context__body">
      <dl>
        <div>
          <dt>评分/完成标准</dt>
          <dd>{{ indicator.scoringStandard || '暂未设置评分标准' }}</dd>
        </div>
        <div v-if="indicator.alignedObjectives.length">
          <dt>相关对齐目标</dt>
          <dd>{{ indicator.alignedObjectives.map((item) => item.title).join('、') }}</dd>
        </div>
      </dl>
      <div v-if="indicator.history.length" class="period-review-context__history">
        <span
          v-for="record in indicator.history"
          :key="record.periodKey"
        >
          <b>{{ record.periodKey }}</b>
          {{ healthLabel(record.healthStatus) }} · 进度{{ record.progress ?? '--' }}{{ record.progress == null ? '' : '%' }} · 自评{{ record.selfScore ?? '--' }}分
        </span>
      </div>
    </div>
  </details>
</template>

<style scoped>
.period-review-context {
  border-bottom: 1px solid #edf0f5;
  background: #fff;
}

.period-review-context summary {
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  color: #758095;
  font-size: 11px;
  cursor: pointer;
  list-style: none;
}

.period-review-context summary::-webkit-details-marker {
  display: none;
}

.period-review-context summary::before {
  content: '›';
  color: #7282b7;
  font-size: 16px;
  transform: rotate(0deg);
  transition: transform .15s ease;
}

.period-review-context[open] summary::before {
  transform: rotate(90deg);
}

.period-review-context summary span {
  color: #4c5870;
  font-weight: 600;
}

.period-review-context summary em {
  color: #99a2b1;
  font-style: normal;
}

.period-review-context__body {
  display: grid;
  gap: 10px;
  padding: 0 16px 12px 36px;
}

.period-review-context dl {
  display: grid;
  gap: 8px;
  margin: 0;
}

.period-review-context dl > div {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 10px;
}

.period-review-context dt {
  color: #929bad;
  font-size: 11px;
}

.period-review-context dd {
  margin: 0;
  color: #4b566b;
  font-size: 12px;
  line-height: 1.6;
}

.period-review-context__history {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.period-review-context__history span {
  padding: 5px 8px;
  border-radius: 6px;
  background: #f5f7fa;
  color: #737e91;
  font-size: 11px;
}

.period-review-context__history b {
  margin-right: 5px;
  color: #4d5970;
}

@media (max-width: 767px) {
  .period-review-context summary {
    flex-wrap: wrap;
    gap: 4px 10px;
    padding: 8px 12px;
  }

  .period-review-context__body {
    padding: 0 12px 12px 30px;
  }

  .period-review-context dl > div {
    grid-template-columns: minmax(0, 1fr);
    gap: 3px;
  }
}
</style>
