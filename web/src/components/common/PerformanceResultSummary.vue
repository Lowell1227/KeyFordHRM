<script setup lang="ts">
import GradeTag from '@/components/common/GradeTag.vue';
import type { PerfGrade } from '@/types/enums';

type StatusTagType = 'info' | 'primary' | 'success' | 'warning' | 'danger';

const props = withDefaults(defineProps<{
  cycleName?: string | null;
  employeeName: string;
  statusLabel: string;
  statusType?: StatusTagType;
  departmentName?: string | null;
  position?: string | null;
  managerName?: string | null;
  currentHandlerName?: string | null;
  score?: number | null;
  scoreHint?: string;
  rawGrade?: PerfGrade | null;
  calibratedGrade?: PerfGrade | null;
  scoreLabel?: string;
  rawGradeLabel?: string;
  calibratedGradeLabel?: string;
}>(), {
  statusType: 'info',
  scoreLabel: '周期得分',
  rawGradeLabel: '上级评定等级',
  calibratedGradeLabel: '校准后等级',
});

const formatScore = (score: number | null | undefined) => score == null ? '—' : score.toFixed(2);
</script>

<template>
  <section class="performance-result-summary" data-testid="performance-result-summary" aria-label="绩效详情摘要">
    <dl class="performance-result-summary__identity">
      <div v-if="cycleName !== undefined">
        <dt>考核周期</dt>
        <dd>{{ cycleName || '—' }}</dd>
      </div>
      <div>
        <dt>员工</dt>
        <dd>{{ employeeName || '—' }}</dd>
      </div>
      <div>
        <dt>当前环节</dt>
        <dd><el-tag :type="props.statusType" size="small">{{ statusLabel }}</el-tag></dd>
      </div>
      <div v-if="departmentName !== undefined">
        <dt>部门</dt>
        <dd>{{ departmentName || '—' }}</dd>
      </div>
      <div v-if="position !== undefined">
        <dt>岗位</dt>
        <dd>{{ position || '—' }}</dd>
      </div>
      <div v-if="managerName !== undefined">
        <dt>绩效直属上级</dt>
        <dd>{{ managerName || '—' }}</dd>
      </div>
      <div v-if="currentHandlerName">
        <dt>当前办理人</dt>
        <dd>{{ currentHandlerName }}</dd>
      </div>
    </dl>

    <dl v-if="score !== undefined || rawGrade !== undefined || calibratedGrade !== undefined" class="performance-result-summary__result">
      <div v-if="score !== undefined">
        <dt>{{ scoreLabel }}</dt>
        <dd class="performance-result-summary__score">{{ formatScore(score) }}</dd>
        <dd v-if="scoreHint" class="performance-result-summary__hint">{{ scoreHint }}</dd>
      </div>
      <div v-if="rawGrade !== undefined">
        <dt>{{ rawGradeLabel }}</dt>
        <dd><GradeTag v-if="rawGrade" :grade="rawGrade" size="small" /><span v-else>未评定</span></dd>
      </div>
      <div v-if="calibratedGrade !== undefined">
        <dt>{{ calibratedGradeLabel }}</dt>
        <dd><GradeTag v-if="calibratedGrade" :grade="calibratedGrade" size="small" /><span v-else>未评定</span></dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.performance-result-summary {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-blank);
}

.performance-result-summary dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
}

.performance-result-summary dl + dl {
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
}

.performance-result-summary dl > div {
  min-width: 0;
  padding: 9px 12px;
}

.performance-result-summary dt {
  margin-bottom: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 18px;
}

.performance-result-summary dd {
  min-width: 0;
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: 13px;
  line-height: 20px;
  white-space: normal;
  overflow-wrap: anywhere;
}

.performance-result-summary__score {
  color: var(--el-color-primary) !important;
  font-size: 16px !important;
  font-weight: 600;
}

.performance-result-summary__hint {
  margin-top: 2px !important;
  color: var(--el-text-color-secondary) !important;
  font-size: 12px !important;
}

@media (max-width: 600px) {
  .performance-result-summary dl {
    grid-template-columns: minmax(0, 1fr);
  }

  .performance-result-summary dl > div + div {
    border-top: 1px solid var(--el-border-color-extra-light);
  }
}
</style>
