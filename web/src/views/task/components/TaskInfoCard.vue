<script setup lang="ts">
import { computed } from 'vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import GradeTag from '@/components/common/GradeTag.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import { usePermission } from '@/composables/usePermission';
import { formatScore } from '@/utils/score';
import type { AssessmentCycle, TaskDetail } from '@/types/api.types';

const props = defineProps<{
  task: TaskDetail;
  cycle?: AssessmentCycle | null;
}>();

const permission = usePermission({ task: props.task, cycle: props.cycle ?? null });

const weightTotal = computed(() => {
  const instances = props.task.indicatorInstances ?? [];
  if (!instances.length) return '待制定';
  const total = instances.reduce((sum, item) => sum + Number(item.weight ?? 0), 0);
  return `${Number((total * 100).toFixed(2))}%`;
});

const deadlineText = computed(() => {
  if (props.task.isExempt) return '已豁免';
  const cycle = props.cycle;
  if (!cycle) return '未设置';

  let value: string | undefined | null;
  switch (props.task.status) {
    case 'indicator_drafting':
    case 'indicator_reviewing':
    case 'indicator_setting':
    case 'indicator_confirming':
      value = cycle.deadlineIndicatorConfirm;
      break;
    case 'self_eval':
      value = cycle.deadlineSelfEval;
      break;
    case 'manager_scoring':
      value = cycle.deadlineManagerScore;
      break;
    default:
      value = cycle.deadlinePublish;
  }
  return formatDate(value);
});

const employeeInitial = computed(() => (props.task.employeeName || '绩效').slice(0, 1));
const employeeSubtitle = computed(() =>
  [props.task.employeeNo ? `工号 ${props.task.employeeNo}` : '工号待补充', props.task.deptName || '部门待补充'].join(' · '),
);
const cycleDisplay = computed(() => props.task.cycleName || props.cycle?.name || '未关联周期');
const taskTypeDisplay = computed(() => (props.task.isExempt ? '豁免任务' : '个人绩效'));

const infoGroups = computed(() => [
  {
    title: '人员信息',
    items: [
      { label: '所属部门', value: props.task.deptName || '待补充' },
      { label: '直属主管', value: props.task.managerName || '待补充' },
      { label: '部门负责人', value: props.task.deptHeadName || '待补充' },
      { label: '结果审批人', value: props.task.approverName || '待补充' },
    ],
  },
  {
    title: '考核信息',
    items: [
      { label: '考核周期', value: cycleDisplay.value },
      { label: '任务类型', value: taskTypeDisplay.value },
      { label: '当前截止', value: deadlineText.value },
      { label: '权重合计', value: weightTotal.value, emphasis: true },
    ],
  },
]);

const scoreItems = computed(() => {
  const items: Array<{ label: string; value?: string; grade?: boolean }> = [];
  if (permission.canViewTotalScore.value) {
    items.push({ label: '计算总分', value: formatScore(props.task.gradeResult?.calculatedScore) });
  }
  if (permission.canViewCalibration.value) {
    items.push({ label: '绩效等级', grade: true });
  }
  return items;
});

function formatDate(value?: string | null): string {
  if (!value) return '未设置';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
</script>

<template>
  <ChartCard class="task-info-card">
    <div class="task-hero">
      <div class="person-block">
        <div class="person-avatar">{{ employeeInitial }}</div>
        <div class="person-main">
          <div class="person-line">
            <h3>{{ task.employeeName || '绩效任务' }}</h3>
            <span class="task-type">{{ taskTypeDisplay }}</span>
            <span v-if="task.isExempt" class="exempt-tag">已豁免</span>
          </div>
          <div class="person-subtitle">{{ employeeSubtitle }}</div>
        </div>
      </div>
      <StatusBadge :status="task.status" />
    </div>

    <div class="info-grid">
      <section v-for="group in infoGroups" :key="group.title" class="info-panel">
        <div class="info-panel__title">{{ group.title }}</div>
        <div class="info-panel__items">
          <div v-for="item in group.items" :key="item.label" class="info-item">
            <span class="info-item__label">{{ item.label }}</span>
            <span class="info-item__value" :class="{ 'info-item__value--emphasis': item.emphasis }">
              {{ item.value }}
            </span>
          </div>
        </div>
      </section>

      <section v-if="scoreItems.length" class="info-panel">
        <div class="info-panel__title">结果信息</div>
        <div class="info-panel__items">
          <div v-for="item in scoreItems" :key="item.label" class="info-item">
            <span class="info-item__label">{{ item.label }}</span>
            <span class="info-item__value">
              <GradeTag
                v-if="item.grade"
                :grade="task.gradeResult?.calibratedGrade ?? task.gradeResult?.rawGrade"
                size="small"
              />
              <template v-else>{{ item.value }}</template>
            </span>
          </div>
        </div>
      </section>
    </div>

    <div v-if="task.exemptReason" class="exempt-reason">
      <span>豁免原因</span>
      <p>{{ task.exemptReason }}</p>
    </div>
  </ChartCard>
</template>

<style scoped>
.task-info-card :deep(.chart-card__body) {
  padding: 20px 22px;
}

.task-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.person-block {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 14px;
}

.person-avatar {
  display: grid;
  width: 52px;
  height: 52px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid #c9d8ff;
  border-radius: 8px;
  background: linear-gradient(135deg, #eef4ff 0%, #f8fbff 100%);
  color: #315cf6;
  font-size: 22px;
  font-weight: 700;
}

.person-main {
  min-width: 0;
}

.person-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.person-line h3 {
  margin: 0;
  color: #20242b;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.25;
}

.person-subtitle {
  margin-top: 6px;
  color: #7f8794;
  font-size: 13px;
}

.task-type,
.exempt-tag {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 9px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.task-type {
  background: #eef3ff;
  color: #315cf6;
}

.exempt-tag {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 12px;
}

.info-panel {
  border: 1px solid #e7ebf3;
  border-radius: 8px;
  background: #fbfcff;
}

.info-panel__title {
  padding: 10px 12px;
  border-bottom: 1px solid #eef1f6;
  color: #20242b;
  font-size: 13px;
  font-weight: 700;
}

.info-panel__items {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.info-item {
  min-width: 0;
  padding: 11px 12px;
  border-right: 1px solid #eef1f6;
  border-bottom: 1px solid #eef1f6;
}

.info-item:nth-child(2n) {
  border-right: 0;
}

.info-item:nth-last-child(-n + 2) {
  border-bottom: 0;
}

.info-item__label {
  display: block;
  margin-bottom: 5px;
  color: #8a93a3;
  font-size: 12px;
}

.info-item__value {
  display: block;
  overflow: hidden;
  color: #313844;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-item__value--emphasis {
  color: #315cf6;
}

.exempt-reason {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  background: #fff7ed;
  color: #9a5800;
}

.exempt-reason span {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 700;
}

.exempt-reason p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}

@media (max-width: 768px) {
  .task-hero {
    flex-direction: column;
  }

  .info-grid,
  .info-panel__items {
    grid-template-columns: 1fr;
  }

  .info-item,
  .info-item:nth-child(2n),
  .info-item:nth-last-child(-n + 2) {
    border-right: 0;
    border-bottom: 1px solid #eef1f6;
  }

  .info-item:last-child {
    border-bottom: 0;
  }
}
</style>
