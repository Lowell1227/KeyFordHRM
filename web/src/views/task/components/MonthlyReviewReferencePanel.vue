<script setup lang="ts">
import { computed } from 'vue';
import type { PeriodReviewIndicator } from '@/types/api.types';

const props = defineProps<{ indicator?: PeriodReviewIndicator }>();

const targetText = computed(() => {
  const item = props.indicator;
  if (!item) return '-';
  if (item.targetValueText) return item.unit ? `${item.targetValueText} ${item.unit}` : item.targetValueText;
  if (item.targetValue != null) return item.unit ? `${item.targetValue} ${item.unit}` : String(item.targetValue);
  return '-';
});

const healthLabels = {
  on_track: '正常推进',
  at_risk: '存在风险',
  blocked: '受阻',
  completed: '已完成',
};
</script>

<template>
  <div v-if="indicator" class="monthly-reference-panel">
    <section>
      <span class="monthly-reference-panel__eyebrow">当前查看</span>
      <h3>{{ indicator.name }}</h3>
      <p>{{ indicator.description || '暂无目标背景说明' }}</p>
      <dl>
        <div><dt>目标值</dt><dd>{{ targetText }}</dd></div>
        <div><dt>权重</dt><dd>{{ Math.round(indicator.weight * 100) }}%</dd></div>
      </dl>
    </section>
    <section>
      <h4>评分 / 完成标准</h4>
      <p>{{ indicator.scoringStandard || '暂未设置评分标准' }}</p>
    </section>
    <section>
      <h4>相关对齐目标</h4>
      <ul v-if="indicator.alignedObjectives.length" class="monthly-reference-panel__alignments">
        <li v-for="objective in indicator.alignedObjectives" :key="objective.id">{{ objective.title }}</li>
      </ul>
      <p v-else>暂无对齐目标</p>
    </section>
    <section>
      <h4>历史月度记录</h4>
      <div v-if="indicator.history.length" class="monthly-reference-panel__history">
        <article v-for="record in indicator.history" :key="record.periodKey">
          <strong>{{ record.periodKey }}</strong>
          <span>{{ record.progress == null ? '未填进度' : `${record.progress}%` }}</span>
          <span v-if="record.healthStatus">{{ healthLabels[record.healthStatus] }}</span>
          <small v-if="record.selfScore != null">自评 {{ record.selfScore }} 分</small>
        </article>
      </div>
      <p v-else>暂无历史月度记录</p>
    </section>
  </div>
  <el-empty v-else description="请选择左侧目标" :image-size="64" />
</template>

<style scoped>
.monthly-reference-panel {
  display: grid;
  gap: 0;
}

.monthly-reference-panel section {
  padding: 16px;
  border-bottom: 1px solid #edf0f5;
}

.monthly-reference-panel section:last-child { border-bottom: 0; }
.monthly-reference-panel h3,
.monthly-reference-panel h4,
.monthly-reference-panel p { margin: 0; }
.monthly-reference-panel h3 { margin-top: 4px; color: #20283a; font-size: 16px; }
.monthly-reference-panel h4 { margin-bottom: 9px; color: #3d4758; font-size: 13px; }
.monthly-reference-panel p { margin-top: 8px; color: #778296; font-size: 13px; line-height: 1.65; white-space: pre-wrap; }
.monthly-reference-panel__eyebrow { color: #6076db; font-size: 11px; font-weight: 700; }
.monthly-reference-panel dl { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 14px 0 0; }
.monthly-reference-panel dl div { padding: 9px 10px; border-radius: 8px; background: #f7f8fb; }
.monthly-reference-panel dt { color: #8a93a3; font-size: 11px; }
.monthly-reference-panel dd { margin: 3px 0 0; color: #30394a; font-size: 13px; font-weight: 600; }
.monthly-reference-panel__alignments { margin: 0; padding-left: 18px; color: #5769c9; font-size: 13px; line-height: 1.6; }
.monthly-reference-panel__history { display: grid; gap: 8px; }
.monthly-reference-panel__history article { display: grid; grid-template-columns: 1fr auto; gap: 3px 8px; padding: 10px; border-radius: 8px; background: #f7f8fb; color: #667084; font-size: 12px; }
.monthly-reference-panel__history article strong { color: #30394a; }
.monthly-reference-panel__history article small { grid-column: 1 / -1; color: #8a93a3; }
</style>
