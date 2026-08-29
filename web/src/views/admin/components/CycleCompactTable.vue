<script setup lang="ts">
import { MoreFilled } from '@element-plus/icons-vue';
import { computed } from 'vue';
import type { AssessmentCycle, Department } from '@/types/api.types';
import type { CycleStatus } from '@/types/enums';
import { formatDate } from '@/utils/date';
import { cyclePrimaryActionLabel } from '../cycle-management';

const props = defineProps<{
  cycles: AssessmentCycle[];
  departments: Department[];
  departmentState: 'loading' | 'ready' | 'failed';
  loading?: boolean;
  launchingId?: string | null;
  deletingId?: string | null;
  currentUserId?: string;
  canEdit?: boolean;
  canReview?: boolean;
}>();

const emit = defineEmits<{
  open: [cycle: AssessmentCycle];
  primary: [cycle: AssessmentCycle];
  'edit-cycle': [cycle: AssessmentCycle];
  'edit-deadlines': [cycle: AssessmentCycle];
  'cancel-schedule': [cycle: AssessmentCycle];
  'notification-mode': [cycle: AssessmentCycle];
  delete: [cycle: AssessmentCycle];
  review: [cycle: AssessmentCycle];
}>();

const TYPE_LABEL = {
  monthly: '月度',
  quarterly: '季度',
  semiannual: '半年',
  annual: '年度',
  probation: '试用期',
  custom: '自定义',
} as const;

const STATUS_LABEL: Record<CycleStatus, string> = {
  draft: '草稿',
  scheduled: '待发起',
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

function handleMore(command: string, cycle: AssessmentCycle) {
  if (command === 'deadlines') emit('edit-deadlines', cycle);
  if (command === 'cancel-schedule') emit('cancel-schedule', cycle);
  if (command === 'notification-mode') emit('notification-mode', cycle);
}

function notificationLabel(cycle: AssessmentCycle): string {
  if (cycle.notificationMode === 'launch_only') return '钉钉：仅发起提醒';
  if (cycle.notificationMode === 'launch_and_reminders') return '钉钉：发起＋每日催办';
  return '钉钉：关闭';
}

function scoringSummary(cycle: AssessmentCycle): string {
  if (cycle.workflowVersion !== 2) return '历史流程';
  return cycle.scoringFrequency === 'monthly'
    ? `按月评分 · ${cycle.periodSchedules?.length ?? 0}个月`
    : '按整个周期评分';
}

const departmentParentById = computed(() => {
  const result = new Map<string, string | null>();
  const visit = (items: Department[], inheritedParentId: string | null = null) => {
    for (const department of items) {
      result.set(department.id, department.parentId ?? inheritedParentId);
      visit(department.children ?? [], department.id);
    }
  };
  visit(props.departments);
  return result;
});

function uniqueCount(ids: string[] | undefined): number {
  return new Set(ids ?? []).size;
}

function referencedDepartmentIds(cycle: AssessmentCycle): string[] {
  return [...new Set([
    ...(cycle.participantDeptIds ?? []),
    ...(cycle.explicitExemptDeptIds ?? []),
  ])];
}

function hasCompleteDepartmentLineage(id: string): boolean {
  const visited = new Set<string>();
  let currentId: string | null = id;
  while (currentId) {
    if (visited.has(currentId) || !departmentParentById.value.has(currentId)) return false;
    visited.add(currentId);
    currentId = departmentParentById.value.get(currentId) ?? null;
  }
  return true;
}

function unavailableDepartmentSummary(cycle: AssessmentCycle): string | null {
  const referencedIds = referencedDepartmentIds(cycle);
  if (referencedIds.length === 0) return null;
  if (props.departmentState === 'loading') return '考核范围加载中…';
  if (props.departmentState === 'failed') return '考核范围暂不可用，请稍后重试';
  if (referencedIds.some((id) => !hasCompleteDepartmentLineage(id))) {
    return '部分历史部门信息不可用，请进入编辑核对';
  }
  return null;
}

function effectiveDepartmentCount(ids: string[] | undefined): number {
  const selected = new Set(ids ?? []);
  return [...selected].filter((id) => {
    const visited = new Set<string>();
    let parentId = departmentParentById.value.get(id);
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) return false;
      visited.add(parentId);
      parentId = departmentParentById.value.get(parentId);
    }
    return true;
  }).length;
}

function scopeCountText(
  departmentIds: string[] | undefined,
  userIds: string[] | undefined,
  options: { effective?: boolean; alternateUser?: boolean } = {},
): string {
  const departmentCount = effectiveDepartmentCount(departmentIds);
  const userCount = uniqueCount(userIds);
  const parts: string[] = [];
  if (departmentCount > 0) {
    parts.push(`${departmentCount} 个${options.effective ? '有效' : ''}部门`);
  }
  if (userCount > 0) {
    parts.push(`${options.alternateUser && departmentCount > 0 ? '另选 ' : ''}${userCount} 名员工`);
  }
  return parts.join('、');
}

function assessmentScopeSummary(cycle: AssessmentCycle) {
  const custom = (cycle.participantDeptIds?.length ?? 0) > 0
    || (cycle.participantUserIds?.length ?? 0) > 0;
  const unavailableSummary = unavailableDepartmentSummary(cycle);
  if (unavailableSummary) {
    return {
      label: custom ? '自定义范围' : '全公司',
      details: [unavailableSummary],
    };
  }
  const exclusionText = scopeCountText(cycle.explicitExemptDeptIds, cycle.explicitExemptUserIds);

  if (!custom) {
    return {
      label: '全公司',
      details: [exclusionText ? `排除 ${exclusionText}` : '无排除'],
    };
  }

  const selectionText = scopeCountText(
    cycle.participantDeptIds,
    cycle.participantUserIds,
    { effective: true, alternateUser: true },
  );
  return {
    label: '自定义范围',
    details: [
      selectionText || '未选择考核对象',
      ...(exclusionText ? [`排除 ${exclusionText}`] : []),
    ],
  };
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
          <small :data-testid="`cycle-scoring-summary-${(row as AssessmentCycle).id}`">
            {{ scoringSummary(row as AssessmentCycle) }}
          </small>
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
          <small v-if="(row as AssessmentCycle).status === 'draft'">
            计划审核：{{ (row as AssessmentCycle).reviewStatus === 'approved' ? '已通过' : ((row as AssessmentCycle).reviewStatus === 'rejected' ? '已退回' : '待审核') }}
          </small>
        </div>
      </template>
    </el-table-column>

    <el-table-column label="考核范围" min-width="240">
      <template #default="{ row }">
        <div
          :data-testid="`cycle-scope-${(row as AssessmentCycle).id}`"
          class="cycle-scope-cell"
        >
          <strong>{{ assessmentScopeSummary(row as AssessmentCycle).label }}</strong>
          <span
            v-for="detail in assessmentScopeSummary(row as AssessmentCycle).details"
            :key="detail"
          >
            {{ detail }}
          </span>
        </div>
      </template>
    </el-table-column>

    <el-table-column label="操作" width="190" fixed="right">
      <template #default="{ row }">
        <div class="cycle-actions" @click.stop>
          <template v-if="(row as AssessmentCycle).status === 'draft'">
            <el-button
              v-if="canReview && (row as AssessmentCycle).reviewStatus !== 'approved' && (!(row as AssessmentCycle).reviewerId || (row as AssessmentCycle).reviewerId === currentUserId)"
              link
              type="success"
              @click="emit('review', row as AssessmentCycle)"
            >审核</el-button>
            <el-button
              v-if="canEdit"
              :data-testid="`cycle-edit-${(row as AssessmentCycle).id}`"
              link
              type="primary"
              @click="emit('edit-cycle', row as AssessmentCycle)"
            >编辑</el-button>
            <el-button
              v-if="canEdit"
              :data-testid="`cycle-delete-${(row as AssessmentCycle).id}`"
              link
              type="danger"
              :loading="deletingId === (row as AssessmentCycle).id"
              @click="emit('delete', row as AssessmentCycle)"
            >删除</el-button>
          </template>
          <template v-else>
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
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
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
          <small :data-testid="`cycle-scoring-summary-mobile-${cycle.id}`">{{ scoringSummary(cycle) }}</small>
          <small>{{ notificationLabel(cycle) }}</small>
        </div>
        <el-tag :type="STATUS_TAG_TYPE[cycle.status]" size="small">{{ STATUS_LABEL[cycle.status] }}</el-tag>
      </header>
      <div
        :data-testid="`cycle-scope-mobile-${cycle.id}`"
        class="cycle-mobile-card__scope"
      >
        <span>考核范围</span>
        <strong>{{ assessmentScopeSummary(cycle).label }}</strong>
        <small
          v-for="detail in assessmentScopeSummary(cycle).details"
          :key="detail"
        >{{ detail }}</small>
      </div>
      <footer @click.stop>
        <template v-if="cycle.status === 'draft'">
          <el-button
            v-if="canReview && cycle.reviewStatus !== 'approved' && (!cycle.reviewerId || cycle.reviewerId === currentUserId)"
            type="success"
            size="small"
            @click="emit('review', cycle)"
          >审核</el-button>
          <el-button
            v-if="canEdit"
            :data-testid="`cycle-edit-mobile-${cycle.id}`"
            type="primary"
            size="small"
            @click="emit('edit-cycle', cycle)"
          >编辑</el-button>
          <el-button
            v-if="canEdit"
            :data-testid="`cycle-delete-mobile-${cycle.id}`"
            type="danger"
            plain
            size="small"
            :loading="deletingId === cycle.id"
            @click="emit('delete', cycle)"
          >删除</el-button>
        </template>
        <template v-else>
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
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
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
.cycle-scope-cell strong {
  color: var(--el-text-color-primary);
  font-size: 14px;
  font-weight: 600;
}

.cycle-cell span,
.cycle-cell small,
.cycle-scope-cell span,
.cycle-state-cell small {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.45;
}

.cycle-cell small {
  color: var(--el-color-info);
}

.cycle-state-cell,
.cycle-scope-cell {
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
  .cycle-mobile-card__scope {
    display: grid;
    gap: 4px;
  }

  .cycle-mobile-card > header span,
  .cycle-mobile-card__scope span,
  .cycle-mobile-card__scope small {
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }

  .cycle-mobile-card__scope strong {
    font-size: 14px;
  }
}
</style>
