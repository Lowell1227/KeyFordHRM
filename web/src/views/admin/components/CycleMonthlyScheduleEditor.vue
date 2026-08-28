<script setup lang="ts">
import { ref } from 'vue';
import type { CyclePeriodSchedule, CycleScheduleIssue } from '@/types/api.types';

const props = withDefaults(defineProps<{
  schedules: CyclePeriodSchedule[];
  warnings?: CycleScheduleIssue[];
  blockers?: CycleScheduleIssue[];
}>(), {
  warnings: () => [],
  blockers: () => [],
});

const emit = defineEmits<{
  'update:schedules': [value: CyclePeriodSchedule[]];
  'restore-all': [];
  'restore-one': [schedule: CyclePeriodSchedule];
  'apply-unified': [options: { preserveExceptions: boolean }];
}>();

const preserveExceptions = ref(true);

type DateField = 'selfEvalOpenAt' | 'selfEvalDueAt' | 'managerDueAt';

function periodLabel(schedule: CyclePeriodSchedule) {
  if (schedule.periodType === 'cycle') return '整个周期';
  const match = /^(\d{4})-(\d{2})$/.exec(schedule.periodKey);
  return match ? `${match[1]}年${Number(match[2])}月` : schedule.periodKey;
}

function updateSchedule(index: number, changes: Partial<CyclePeriodSchedule>) {
  const schedules = props.schedules.map((schedule) => ({ ...schedule }));
  schedules[index] = { ...schedules[index], ...changes };
  emit('update:schedules', schedules);
}

function updateDate(index: number, field: DateField, value: string | number | Date | null | undefined) {
  updateSchedule(index, { [field]: value ? String(value) : '' });
}

function issuesFor(schedule: CyclePeriodSchedule, issues: CycleScheduleIssue[]) {
  return issues.filter((issue) => issue.periodKey === schedule.periodKey);
}

function issuesForField(schedule: CyclePeriodSchedule, field: DateField) {
  const aliases: Record<DateField, string[]> = {
    selfEvalOpenAt: ['open', 'self_eval_open'],
    selfEvalDueAt: ['self', 'employee'],
    managerDueAt: ['manager'],
  };
  return issuesFor(schedule, props.blockers).filter((issue) => (
    aliases[field].some((alias) => issue.code.toLowerCase().includes(alias))
  ));
}
</script>

<template>
  <section class="cycle-monthly-schedule-editor" aria-label="月度评分计划">
    <header class="cycle-monthly-schedule-editor__header">
      <div>
        <strong>评分计划</strong>
        <p>逐期设置员工自评与主管评分的计划时间。</p>
      </div>
      <div class="cycle-monthly-schedule-editor__actions">
        <el-checkbox v-model="preserveExceptions">保留特殊月份</el-checkbox>
        <el-button text type="primary" @click="emit('apply-unified', { preserveExceptions })">统一调整规则</el-button>
        <el-button text @click="emit('restore-all')">恢复全部默认</el-button>
      </div>
    </header>

    <article
      v-for="(schedule, index) in schedules"
      :key="schedule.id ?? schedule.periodKey"
      data-testid="cycle-month-schedule-row"
      class="cycle-month-schedule-row"
    >
      <header class="cycle-month-schedule-row__header">
        <div>
          <strong>{{ periodLabel(schedule) }}</strong>
          <el-tag v-if="schedule.isException" type="warning" size="small">特殊月份</el-tag>
        </div>
        <div>
          <el-button
            data-testid="cycle-special-month-button"
            text
            type="primary"
            @click="updateSchedule(index, { isException: true })"
          >调整特殊月份</el-button>
          <el-button text @click="emit('restore-one', { ...schedule })">恢复默认</el-button>
        </div>
      </header>

      <div class="cycle-month-schedule-row__fields">
        <label>
          <span>自评开放时间</span>
          <el-date-picker
            :model-value="schedule.selfEvalOpenAt"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm"
            @update:model-value="updateDate(index, 'selfEvalOpenAt', $event)"
          />
          <small v-for="issue in issuesForField(schedule, 'selfEvalOpenAt')" :key="issue.code" class="is-blocker">{{ issue.message }}</small>
        </label>
        <label>
          <span>员工计划完成时间</span>
          <el-date-picker
            :model-value="schedule.selfEvalDueAt"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm"
            @update:model-value="updateDate(index, 'selfEvalDueAt', $event)"
          />
          <small v-for="issue in issuesForField(schedule, 'selfEvalDueAt')" :key="issue.code" class="is-blocker">{{ issue.message }}</small>
        </label>
        <label>
          <span>主管计划完成时间</span>
          <el-date-picker
            data-testid="manager-due-at"
            :model-value="schedule.managerDueAt"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm"
            @update:model-value="updateDate(index, 'managerDueAt', $event)"
          />
          <small v-for="issue in issuesForField(schedule, 'managerDueAt')" :key="issue.code" class="is-blocker">{{ issue.message }}</small>
        </label>
      </div>

      <p v-for="issue in issuesFor(schedule, warnings)" :key="issue.code" class="cycle-month-schedule-row__warning">{{ issue.message }}</p>
      <p
        v-for="issue in issuesFor(schedule, blockers).filter((blocker) => !['open', 'self', 'employee', 'manager'].some((word) => blocker.code.toLowerCase().includes(word)))"
        :key="issue.code"
        class="cycle-month-schedule-row__blocker"
      >{{ issue.message }}</p>
    </article>
  </section>
</template>

<style scoped>
.cycle-monthly-schedule-editor {
  display: grid;
  gap: 12px;
}

.cycle-monthly-schedule-editor__header,
.cycle-month-schedule-row__header,
.cycle-monthly-schedule-editor__actions,
.cycle-month-schedule-row__header > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.cycle-monthly-schedule-editor__header p {
  margin: 4px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.cycle-monthly-schedule-editor__actions {
  justify-content: flex-end;
  flex-wrap: wrap;
}

.cycle-month-schedule-row {
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.cycle-month-schedule-row__fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.cycle-month-schedule-row label {
  display: grid;
  gap: 6px;
  color: var(--el-text-color-regular);
  font-size: 12px;
}

.cycle-month-schedule-row :deep(.el-date-editor) {
  width: 100%;
}

.is-blocker,
.cycle-month-schedule-row__blocker {
  color: var(--el-color-danger);
}

.cycle-month-schedule-row__warning {
  margin: 10px 0 0;
  color: var(--el-color-warning-dark-2);
  font-size: 12px;
}

.cycle-month-schedule-row__blocker {
  margin: 8px 0 0;
  font-size: 12px;
}

@media (max-width: 768px) {
  .cycle-monthly-schedule-editor__header,
  .cycle-month-schedule-row__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .cycle-month-schedule-row__fields {
    grid-template-columns: 1fr;
  }
}
</style>
