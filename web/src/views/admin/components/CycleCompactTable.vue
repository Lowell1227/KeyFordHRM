<script setup lang="ts">
import { MoreFilled } from '@element-plus/icons-vue';
import dayjs from 'dayjs';
import type { AssessmentCycle } from '@/types/api.types';
import type { CycleStatus } from '@/types/enums';
import { formatDate } from '@/utils/date';
import { cycleNextStep, cyclePrimaryActionLabel } from '../cycle-management';

defineProps<{
  cycles: AssessmentCycle[];
  loading?: boolean;
  launchingId?: string | null;
  deletingId?: string | null;
}>();

const emit = defineEmits<{
  open: [cycle: AssessmentCycle];
  primary: [cycle: AssessmentCycle];
  'edit-deadlines': [cycle: AssessmentCycle];
  'cancel-schedule': [cycle: AssessmentCycle];
  'notification-mode': [cycle: AssessmentCycle];
  delete: [cycle: AssessmentCycle];
}>();

const TYPE_LABEL = {
  monthly: '月度',
  quarterly: '季度',
  annual: '年度',
  probation: '试用期',
  custom: '自定义',
} as const;

const STATUS_LABEL: Record<CycleStatus, string> = {
  draft: '草稿',
  scheduled: '待开放',
  launch_blocked: '发起受阻',
  indicator_setting: '指标制定中',
  self_eval: '员工自评中',
  manager_score: '主管评分中',
  hr_calibration: 'HR校准中',
  approval: '审批中',
  published: '已公示',
  appeal: '申诉中',
  closed: '已关闭',
};

const STATUS_TAG_TYPE: Record<CycleStatus, 'primary' | 'success' | 'warning' | 'info' | 'danger'> = {
  draft: 'info',
  scheduled: 'primary',
  launch_blocked: 'danger',
  indicator_setting: 'warning',
  self_eval: 'primary',
  manager_score: 'primary',
  hr_calibration: 'primary',
  approval: 'primary',
  published: 'success',
  appeal: 'danger',
  closed: 'info',
};

function formatNextTime(value?: string): string {
  if (!value) return '';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('MM月DD日 HH:mm') : '';
}

function handleMore(command: string, cycle: AssessmentCycle) {
  if (command === 'deadlines') emit('edit-deadlines', cycle);
  if (command === 'cancel-schedule') emit('cancel-schedule', cycle);
  if (command === 'notification-mode') emit('notification-mode', cycle);
  if (command === 'delete') emit('delete', cycle);
}

function notificationLabel(cycle: AssessmentCycle): string {
  if (cycle.notificationMode === 'launch_only') return '钉钉：仅发起提醒';
  if (cycle.notificationMode === 'launch_and_reminders') return '钉钉：发起＋每日催办';
  return '钉钉：关闭';
}
</script>

<template>
  <el-table
    v-loading="loading"
    class="cycle-compact-table app-table"
    :data="cycles"
    row-key="id"
    @row-click="emit('open', $event as AssessmentCycle)"
  >
    <el-table-column label="周期" min-width="280">
      <template #default="{ row }">
        <button class="cycle-cell" type="button" @click.stop="emit('open', row as AssessmentCycle)">
          <strong>{{ (row as AssessmentCycle).name }}</strong>
          <span>
            {{ TYPE_LABEL[(row as AssessmentCycle).type] }} ·
            {{ formatDate((row as AssessmentCycle).startDate) }}–{{ formatDate((row as AssessmentCycle).endDate) }}
          </span>
          <small>{{ notificationLabel(row as AssessmentCycle) }}</small>
        </button>
      </template>
    </el-table-column>

    <el-table-column label="当前状态" min-width="170">
      <template #default="{ row }">
        <div class="cycle-state-cell">
          <el-tag :type="STATUS_TAG_TYPE[(row as AssessmentCycle).status]" size="small">
            {{ STATUS_LABEL[(row as AssessmentCycle).status] }}
          </el-tag>
          <small v-if="(row as AssessmentCycle).status === 'launch_blocked' && (row as AssessmentCycle).launchBlockedReason">
            {{ (row as AssessmentCycle).launchBlockedReason }}
          </small>
        </div>
      </template>
    </el-table-column>

    <el-table-column label="下一步" min-width="220">
      <template #default="{ row }">
        <div class="cycle-next-cell">
          <strong>{{ cycleNextStep(row as AssessmentCycle).label }}</strong>
          <span v-if="formatNextTime(cycleNextStep(row as AssessmentCycle).time)">
            {{ formatNextTime(cycleNextStep(row as AssessmentCycle).time) }}
          </span>
        </div>
      </template>
    </el-table-column>

    <el-table-column label="操作" width="190" fixed="right">
      <template #default="{ row }">
        <div class="cycle-actions" @click.stop>
          <el-button
            :data-testid="`cycle-primary-${(row as AssessmentCycle).id}`"
            type="primary"
            size="small"
            :loading="launchingId === (row as AssessmentCycle).id"
            @click="emit('primary', row as AssessmentCycle)"
          >
            {{ cyclePrimaryActionLabel((row as AssessmentCycle).status) }}
          </el-button>
          <el-dropdown
            trigger="click"
            @command="handleMore($event as string, row as AssessmentCycle)"
          >
            <el-button :icon="MoreFilled" text aria-label="更多操作" />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  command="deadlines"
                  :disabled="['scheduled', 'launch_blocked'].includes((row as AssessmentCycle).status)"
                >
                  修改截止日
                </el-dropdown-item>
                <el-dropdown-item
                  v-if="['draft', 'scheduled', 'launch_blocked'].includes((row as AssessmentCycle).status)"
                  command="notification-mode"
                >
                  通知设置
                </el-dropdown-item>
                <el-dropdown-item
                  v-if="['scheduled', 'launch_blocked'].includes((row as AssessmentCycle).status)"
                  command="cancel-schedule"
                  divided
                >
                  取消预约
                </el-dropdown-item>
                <el-dropdown-item
                  v-if="(row as AssessmentCycle).status === 'draft'"
                  command="delete"
                  divided
                  :disabled="deletingId === (row as AssessmentCycle).id"
                  style="color: var(--el-color-danger)"
                >
                  删除周期
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </template>
    </el-table-column>
  </el-table>

  <section v-loading="loading" class="cycle-mobile-list" aria-label="周期列表">
    <article
      v-for="cycle in cycles"
      :key="cycle.id"
      :data-testid="`cycle-compact-card-${cycle.id}`"
      class="cycle-mobile-card"
      role="button"
      tabindex="0"
      @click="emit('open', cycle)"
      @keyup.enter="emit('open', cycle)"
    >
      <header>
        <div>
          <strong>{{ cycle.name }}</strong>
          <span>{{ TYPE_LABEL[cycle.type] }} · {{ formatDate(cycle.startDate) }}–{{ formatDate(cycle.endDate) }}</span>
          <small>{{ notificationLabel(cycle) }}</small>
        </div>
        <el-tag :type="STATUS_TAG_TYPE[cycle.status]" size="small">{{ STATUS_LABEL[cycle.status] }}</el-tag>
      </header>
      <div class="cycle-mobile-card__next">
        <span>下一步</span>
        <strong>{{ cycleNextStep(cycle).label }}</strong>
        <small v-if="formatNextTime(cycleNextStep(cycle).time)">{{ formatNextTime(cycleNextStep(cycle).time) }}</small>
      </div>
      <footer @click.stop>
        <el-button
          :data-testid="`cycle-primary-mobile-${cycle.id}`"
          type="primary"
          size="small"
          :loading="launchingId === cycle.id"
          @click="emit('primary', cycle)"
        >
          {{ cyclePrimaryActionLabel(cycle.status) }}
        </el-button>
        <el-dropdown trigger="click" @command="handleMore($event as string, cycle)">
          <el-button :icon="MoreFilled" text aria-label="更多操作" />
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                command="deadlines"
                :disabled="['scheduled', 'launch_blocked'].includes(cycle.status)"
              >
                修改截止日
              </el-dropdown-item>
              <el-dropdown-item
                v-if="['draft', 'scheduled', 'launch_blocked'].includes(cycle.status)"
                command="notification-mode"
              >
                通知设置
              </el-dropdown-item>
              <el-dropdown-item
                v-if="['scheduled', 'launch_blocked'].includes(cycle.status)"
                command="cancel-schedule"
                divided
              >
                取消预约
              </el-dropdown-item>
              <el-dropdown-item
                v-if="cycle.status === 'draft'"
                command="delete"
                divided
                :disabled="deletingId === cycle.id"
                style="color: var(--el-color-danger)"
              >
                删除周期
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </footer>
    </article>
  </section>
</template>

<style scoped>
.cycle-compact-table :deep(.el-table__row) {
  cursor: pointer;
}

.cycle-cell {
  display: grid;
  gap: 5px;
  width: 100%;
  padding: 0;
  color: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.cycle-cell strong,
.cycle-next-cell strong {
  color: var(--el-text-color-primary);
  font-size: 14px;
  font-weight: 600;
}

.cycle-cell span,
.cycle-cell small,
.cycle-next-cell span,
.cycle-state-cell small {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.45;
}

.cycle-cell small {
  color: var(--el-color-info);
}

.cycle-state-cell,
.cycle-next-cell {
  display: grid;
  justify-items: start;
  gap: 6px;
}

.cycle-state-cell small {
  max-width: 240px;
  color: var(--el-color-danger);
}

.cycle-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cycle-mobile-list {
  display: none;
}

@media (max-width: 767px) {
  .cycle-compact-table {
    display: none;
  }

  .cycle-mobile-list {
    display: grid;
    gap: 10px;
    padding: 12px;
  }

  .cycle-mobile-card {
    display: grid;
    gap: 14px;
    padding: 14px;
    background: #fff;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 10px;
    cursor: pointer;
  }

  .cycle-mobile-card > header,
  .cycle-mobile-card > footer {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .cycle-mobile-card > header > div,
  .cycle-mobile-card__next {
    display: grid;
    gap: 4px;
  }

  .cycle-mobile-card > header span,
  .cycle-mobile-card__next span,
  .cycle-mobile-card__next small {
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }

  .cycle-mobile-card__next strong {
    font-size: 14px;
  }
}
</style>
