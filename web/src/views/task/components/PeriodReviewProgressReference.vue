<script setup lang="ts">
import { computed } from 'vue';
import type { PeriodReviewDetail, PeriodReviewIndicator, PeriodReviewProgressReference } from '@/types/api.types';
import { belongsToReviewPeriod, compareProgressRecordedAt, progressReferencesFor } from './period-progress-summary';

const props = defineProps<{
  indicator: PeriodReviewIndicator;
  period: PeriodReviewDetail['period'];
  canSync: boolean;
  collapsed?: boolean;
}>();
const emit = defineEmits<{ summarize: [] }>();

const records = computed(() => progressReferencesFor(props.indicator));
const currentRecords = computed(() => records.value.filter(record => belongsToReviewPeriod(record, props.period))
  .sort((a, b) => compareProgressRecordedAt(b, a)));
const otherRecords = computed(() => records.value.filter(record => !belongsToReviewPeriod(record, props.period))
  .sort((a, b) => b.periodKey.localeCompare(a.periodKey) || compareProgressRecordedAt(b, a)));
const periodNoun = computed(() => props.period.periodType === 'month' ? '本月' : '本期');
const groups = computed(() => [
  { id: 'latest', label: '本期最新进展', current: true, records: currentRecords.value.slice(0, 1) },
  { id: 'current', label: `本期其他记录（${Math.max(0, currentRecords.value.length - 1)}）`, current: true, records: currentRecords.value.slice(1) },
  { id: 'other', label: `其他月份（${new Set(otherRecords.value.map(record => record.periodKey)).size}）`, current: false, records: otherRecords.value },
].filter(group => group.records.length));

function healthLabel(status: PeriodReviewProgressReference['healthStatus']) {
  return status ? { on_track: '正常推进', at_risk: '存在风险', blocked: '当前受阻', completed: '已经完成' }[status] : '未填写状态';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}
</script>

<template>
  <component :is="collapsed ? 'details' : 'section'" class="progress-reference" data-testid="monthly-progress-reference" aria-label="日常进展参考">
    <summary v-if="collapsed">{{ periodNoun }}跟进记录（{{ currentRecords.length }}条）</summary>
    <header v-if="!collapsed">
      <h4>日常进展参考</h4>
      <el-button v-if="canSync && currentRecords.length" type="primary" plain size="small" @click.stop="emit('summarize')">汇总{{ periodNoun }}进展到自评</el-button>
    </header>
    <p v-if="!currentRecords.length" class="progress-reference__empty">本期暂无日常进展</p>
    <component :is="group.id === 'latest' ? 'div' : 'details'" v-for="group in groups" :key="group.id" class="progress-reference__group">
      <summary v-if="group.id !== 'latest'">{{ group.label }}</summary>
      <article v-for="record in group.records" :key="record.id" class="progress-reference__record" :data-testid="`progress-reference-${record.id}`">
        <div class="progress-reference__meta">
          <strong>{{ group.id === 'latest' ? group.label : record.periodKey }}</strong>
          <span v-if="group.id === 'latest'">{{ record.periodKey }}</span>
          <time :datetime="record.createdAt">记录于 {{ formatDate(record.createdAt) }}</time>
        </div>
        <div class="progress-reference__status">
          <span :data-health="record.healthStatus">{{ healthLabel(record.healthStatus) }}</span>
          <b>{{ record.progress == null ? '未填写进度' : `${record.progress}%` }}</b>
        </div>
        <p>{{ record.content || '未填写描述' }}</p>
      </article>
    </component>
  </component>
</template>

<style scoped>
.progress-reference { min-width: 0; padding: 12px 16px; border-bottom: 1px solid #edf0f5; background: #fff; }
.progress-reference > header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; }
.progress-reference > summary { color: #6f7c90; font-size: 12px; cursor: pointer; }
.progress-reference h4 { margin: 0; color: #566174; font-size: 12px; }
.progress-reference > header > span, .progress-reference__empty { margin: 0; color: #8b95a6; font-size: 11px; }
.progress-reference__empty { margin-top: 8px; }
.progress-reference__group { margin-top: 8px; }
.progress-reference__group > summary { padding: 4px 0; color: #6f7c90; font-size: 12px; cursor: pointer; }
.progress-reference__record { min-width: 0; margin-top: 6px; padding: 10px 12px; border: 1px solid #e4eaf4; border-radius: 7px; background: #f8fafd; }
.progress-reference__meta, .progress-reference__status { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.progress-reference__meta { color: #8b95a6; font-size: 11px; }
.progress-reference__meta strong { color: #6a778d; font-weight: 500; }
.progress-reference__meta time { margin-left: auto; }
.progress-reference__status { margin-top: 8px; color: #56715e; font-size: 12px; }
.progress-reference__status b { color: #40516e; }
.progress-reference__status [data-health='blocked'] { color: #c34545; }
.progress-reference__status [data-health='at_risk'] { color: #a66a00; }
.progress-reference__status .el-button { margin-left: auto; }
.progress-reference__record p { margin: 8px 0 0; color: #58667d; font-size: 12px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 767px) {
  .progress-reference { padding: 12px; }
  .progress-reference__meta time { width: 100%; margin-left: 0; }
}
</style>
