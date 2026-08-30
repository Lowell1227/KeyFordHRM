<script setup lang="ts">
import { computed } from 'vue';
import { QuestionFilled } from '@element-plus/icons-vue';
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
}>();

const hasExceptions = computed(() => props.schedules.some((schedule) => schedule.isException));
const isCycleSchedule = computed(() => (
  props.schedules.length === 1 && props.schedules[0]?.periodType === 'cycle'
));
type DateField = 'selfEvalOpenAt' | 'selfEvalDueAt' | 'managerDueAt';

const FIELD_ISSUE_CODES: Record<DateField, string[]> = {
  selfEvalOpenAt: ['FIRST_SELF_EVAL_BEFORE_INDICATOR_CONFIRM'],
  selfEvalDueAt: ['SELF_EVAL_OPEN_AFTER_DUE'],
  managerDueAt: ['SELF_EVAL_DUE_AFTER_MANAGER_DUE'],
};

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
  updateSchedule(index, { [field]: value ? String(value) : '', isException: true });
}

function issuesFor(schedule: CyclePeriodSchedule, issues: CycleScheduleIssue[]) {
  return issues.filter((issue) => issue.periodKey === schedule.periodKey);
}

function issuesForField(schedule: CyclePeriodSchedule, field: DateField) {
  const codes = FIELD_ISSUE_CODES[field];
  return [...props.blockers, ...props.warnings].filter((issue) => (
    issue.periodKey === schedule.periodKey && codes.includes(issue.code)
  ));
}

function rowBlockers(schedule: CyclePeriodSchedule) {
  const fieldCodes = Object.values(FIELD_ISSUE_CODES).flat();
  return issuesFor(schedule, props.blockers).filter((issue) => !fieldCodes.includes(issue.code));
}
</script>

<template>
  <section class="cycle-monthly-schedule-editor" aria-label="复盘与评分时间安排">
    <div
      v-if="!isCycleSchedule"
      data-testid="cycle-schedule-column-header"
      class="cycle-monthly-schedule-grid__header"
    >
      <span class="cycle-schedule-help-label">月份
        <el-tooltip content="下方时间为每月复盘与评分安排，可直接修改；调整后可恢复默认。" placement="top">
          <el-icon
            data-testid="cycle-schedule-help"
            aria-label="查看时间安排说明"
            tabindex="0"
          ><QuestionFilled /></el-icon>
        </el-tooltip>
      </span>
      <span>本期自评开放</span>
      <span>本期员工自评截止</span>
      <span>本期主管评分截止</span>
      <span class="cycle-monthly-schedule-grid__actions">
        <el-button
          v-if="hasExceptions"
          data-testid="cycle-restore-all"
          text
          @click="emit('restore-all')"
        >全部恢复默认</el-button>
      </span>
    </div>

    <div class="cycle-monthly-schedule-list">
      <article
        v-for="(schedule, index) in schedules"
        :key="schedule.id ?? schedule.periodKey"
        data-testid="cycle-month-schedule-row"
        class="cycle-month-schedule-row"
      >
        <div class="cycle-month-schedule-row__main">
          <div class="cycle-month-schedule-row__period">
            <strong data-testid="cycle-period-label">{{ periodLabel(schedule) }}</strong>
            <el-tooltip
              v-if="isCycleSchedule"
              content="下方时间为整个绩效周期的复盘与评分安排，可直接修改。"
              placement="top"
            >
              <el-icon
                data-testid="cycle-schedule-help"
                aria-label="查看时间安排说明"
                tabindex="0"
              ><QuestionFilled /></el-icon>
            </el-tooltip>
            <el-tag v-if="schedule.isException" data-testid="cycle-special-month-badge" type="warning" size="small">已调整</el-tag>
            <small
              v-for="issue in rowBlockers(schedule)"
              :key="issue.code"
              class="cycle-time-field__issue"
            >{{ issue.message }}</small>
          </div>
        <label data-testid="self-eval-open-at">
          <span class="cycle-month-schedule-row__mobile-label">本期自评开放</span>
          <el-date-picker
            :model-value="schedule.selfEvalOpenAt"
            type="datetime"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm:ssZ"
            @update:model-value="updateDate(index, 'selfEvalOpenAt', $event)"
          />
          <small
            v-for="issue in issuesForField(schedule, 'selfEvalOpenAt')"
            :key="issue.code"
            class="cycle-time-field__issue"
          >正式发起前需调整：{{ issue.message }}</small>
        </label>
        <label data-testid="self-eval-due-at">
          <span class="cycle-month-schedule-row__mobile-label">本期员工自评截止</span>
          <el-date-picker
            :model-value="schedule.selfEvalDueAt"
            type="datetime"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm:ssZ"
            @update:model-value="updateDate(index, 'selfEvalDueAt', $event)"
          />
          <small
            v-for="issue in issuesForField(schedule, 'selfEvalDueAt')"
            :key="issue.code"
            class="cycle-time-field__issue"
          >正式发起前需调整：{{ issue.message }}</small>
        </label>
        <label data-testid="manager-due-at">
          <span class="cycle-month-schedule-row__mobile-label">本期主管评分截止</span>
          <el-date-picker
            :model-value="schedule.managerDueAt"
            type="datetime"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm:ssZ"
            @update:model-value="updateDate(index, 'managerDueAt', $event)"
          />
          <small
            v-for="issue in issuesForField(schedule, 'managerDueAt')"
            :key="issue.code"
            class="cycle-time-field__issue"
          >正式发起前需调整：{{ issue.message }}</small>
        </label>
          <div class="cycle-month-schedule-row__actions">
            <el-button
              v-if="schedule.isException"
              data-testid="cycle-restore-one"
              text
              @click="emit('restore-one', { ...schedule })"
            >恢复本月默认</el-button>
          </div>
        </div>

      </article>
    </div>
  </section>
</template>

<style scoped>
.cycle-monthly-schedule-editor {
  display: grid;
  overflow: hidden;
  border-top: 1px solid var(--el-border-color-lighter);
}

.cycle-month-schedule-row__period {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cycle-schedule-help-label,
.cycle-monthly-schedule-grid__actions {
  display: flex;
  align-items: center;
  gap: 5px;
}

.cycle-schedule-help-label .el-icon,
.cycle-month-schedule-row__period .el-icon {
  color: var(--el-text-color-placeholder);
  cursor: help;
}

.cycle-schedule-help-label .el-icon:focus-visible,
.cycle-month-schedule-row__period .el-icon:focus-visible {
  color: var(--el-color-primary);
  outline: 2px solid var(--el-color-primary-light-5);
  outline-offset: 2px;
  border-radius: 50%;
}

.cycle-monthly-schedule-grid__actions {
  min-height: 24px;
  justify-content: flex-end;
}

.cycle-monthly-schedule-grid__header,
.cycle-month-schedule-row__main {
  display: grid;
  grid-template-columns: 82px repeat(3, minmax(0, 1fr)) 76px;
  align-items: start;
  gap: 8px;
}

.cycle-monthly-schedule-grid__header {
  padding: 8px 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  font-size: 12px;
}

.cycle-monthly-schedule-grid__header > span,
.cycle-month-schedule-row label,
.cycle-month-schedule-row__actions {
  min-width: 0;
}

.cycle-monthly-schedule-list {
  display: grid;
}

.cycle-month-schedule-row {
  padding: 10px 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.cycle-month-schedule-row__period {
  min-height: 32px;
  justify-content: flex-start;
  flex-wrap: wrap;
}

.cycle-month-schedule-row label {
  display: grid;
  gap: 4px;
  color: var(--el-text-color-regular);
  font-size: 12px;
}

.cycle-month-schedule-row__mobile-label {
  display: none;
}

.cycle-month-schedule-row__actions {
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: flex-end;
}

.cycle-month-schedule-row :deep(.el-date-editor) {
  min-width: 0;
  width: 100%;
}

.cycle-time-field__issue {
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.35;
}

@media (max-width: 768px) {
  .cycle-monthly-schedule-editor {
    overflow: visible;
    gap: 12px;
    border: 0;
  }

  .cycle-monthly-schedule-grid__header {
    display: none;
  }

  .cycle-monthly-schedule-list {
    gap: 12px;
  }

  .cycle-month-schedule-row {
    padding: 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
  }

  .cycle-month-schedule-row__main {
    grid-template-columns: 1fr;
  }

  .cycle-month-schedule-row__mobile-label {
    display: block;
  }

  .cycle-month-schedule-row__actions {
    justify-content: flex-start;
  }
}
</style>
