<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Calendar, DocumentChecked, UserFilled } from '@element-plus/icons-vue';
import { tasksApi } from '@/api/tasks.api';
import { cyclesApi } from '@/api/cycles.api';
import { usePagination } from '@/composables/usePagination';
import StatusBadge from '@/components/common/StatusBadge.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import PerformanceWorkspace from '@/components/performance/PerformanceWorkspace.vue';
import PerformanceContextPanel from '@/components/performance/PerformanceContextPanel.vue';
import type { TaskListItem, AssessmentCycle } from '@/types/api.types';
import type { TaskStatus } from '@/types/enums';

const router = useRouter();

const list = ref<TaskListItem[]>([]);
const loading = ref(false);
const cycles = ref<AssessmentCycle[]>([]);
const selectedCycleId = ref<string>('');
const quickFilter = ref<'all' | 'pending' | 'cycle'>('all');
type TaskStageKey = 'all' | 'goal-setting' | 'goal-confirmation' | 'self-eval' | 'result';
type TaskStageState = 'pending' | 'progress' | 'completed' | 'not-started';

const selectedStage = ref<TaskStageKey>('all');
const taskStages = [
  { key: 'goal-setting', label: '目标制定' },
  { key: 'goal-confirmation', label: '目标确认' },
  { key: 'self-eval', label: '自评' },
  { key: 'result', label: '结果确认' },
] as const;

const selectedCycle = computed(() => cycles.value.find((cycle) => cycle.id === selectedCycleId.value) ?? null);
const selectedCycleName = computed(() => {
  if (quickFilter.value === 'all') return '全部考核周期';
  if (quickFilter.value === 'pending') return '仅看待办';
  return selectedCycle.value?.name ?? '暂无考核周期';
});

const {
  page,
  pageSize,
  total,
  pageSizeOptions,
  reset: resetPagination,
  withParams,
} = usePagination({ defaultPageSize: 10 });

const pendingStatuses: TaskStatus[] = ['indicator_drafting', 'indicator_confirming', 'self_eval', 'published', 'appealing'];
const goalSettingStatuses: TaskStatus[] = ['indicator_drafting', 'indicator_reviewing', 'indicator_setting'];
const selfEvalStatuses: TaskStatus[] = ['self_eval', 'manager_scoring', 'dept_review', 'hr_calibration', 'approval'];
const completedStatuses: TaskStatus[] = ['confirmed', 'closed'];

function stageForStatus(status: TaskStatus): Exclude<TaskStageKey, 'all'> {
  if (goalSettingStatuses.includes(status)) return 'goal-setting';
  if (status === 'indicator_confirming') return 'goal-confirmation';
  if (selfEvalStatuses.includes(status)) return 'self-eval';
  return 'result';
}

const visibleTasks = computed(() => {
  if (selectedStage.value === 'all') return list.value;
  return list.value.filter((task) => stageForStatus(task.status) === selectedStage.value);
});

const selectedStageLabel = computed(() => {
  if (selectedStage.value === 'all') return '全部绩效任务';
  return taskStages.find((stage) => stage.key === selectedStage.value)?.label ?? '绩效任务';
});

const visibleTotal = computed(() =>
  selectedStage.value === 'all' ? total.value : visibleTasks.value.length,
);

function stageState(stage: Exclude<TaskStageKey, 'all'>): TaskStageState {
  const matchingTasks = list.value.filter((task) => stageForStatus(task.status) === stage);
  if (matchingTasks.length === 0) return 'not-started';
  if (matchingTasks.some((task) => isPending(task.status))) return 'pending';
  if (matchingTasks.every((task) => completedStatuses.includes(task.status))) return 'completed';
  return 'progress';
}

function stageStateLabel(state: TaskStageState): string {
  const labels: Record<TaskStageState, string> = {
    pending: '待处理',
    progress: '处理中',
    completed: '已完成',
    'not-started': '未开始',
  };
  return labels[state];
}

function selectStage(stage: TaskStageKey) {
  selectedStage.value = stage;
  resetPagination();
}

function getCycleTime(cycleId: string): number {
  const cycle = cycles.value.find((item) => item.id === cycleId);
  const rawDate = cycle?.startDate || cycle?.endDate || '';
  const time = rawDate ? new Date(rawDate).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function sortTasksByCycleDesc(items: TaskListItem[]) {
  return [...items].sort((a, b) => {
    const byCycle = getCycleTime(b.cycleId) - getCycleTime(a.cycleId);
    if (byCycle !== 0) return byCycle;
    return String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''));
  });
}

async function loadCycles() {
  try {
    const res = await cyclesApi.findAll({ pageSize: 50 });
    cycles.value = [...(res.items ?? [])].sort((a, b) => {
      const aTime = new Date(a.startDate || a.endDate || '').getTime();
      const bTime = new Date(b.startDate || b.endDate || '').getTime();
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
  } catch {
    cycles.value = [];
  }
}

async function loadList() {
  loading.value = true;
  try {
    const baseParams = withParams({
      cycleId: quickFilter.value === 'cycle' ? selectedCycleId.value || undefined : undefined,
    } as Record<string, unknown>);

    if (quickFilter.value === 'pending') {
      const results = await Promise.all(
        pendingStatuses.map((status) => tasksApi.findMine({ ...baseParams, status })),
      );
      const merged = results.flatMap((res) => res.items ?? []);
      const unique = Array.from(new Map(merged.map((item) => [item.id, item])).values());
      list.value = sortTasksByCycleDesc(unique);
      total.value = unique.length;
    } else {
      const res = await tasksApi.findMine(baseParams);
      list.value = sortTasksByCycleDesc(res.items ?? []);
      total.value = res.total ?? 0;
    }
  } catch {
    list.value = [];
    total.value = 0;
    ElMessage.error('获取绩效任务失败');
  } finally {
    loading.value = false;
  }
}

function onCycleChange(value: string) {
  selectedStage.value = 'all';
  if (value === '__pending__') {
    showPendingTasks();
    return;
  }
  if (!value) {
    showAllCycles();
    return;
  }
  quickFilter.value = 'cycle';
  resetPagination();
  loadList();
}

function showAllCycles() {
  quickFilter.value = 'all';
  selectedCycleId.value = '';
  selectedStage.value = 'all';
  resetPagination();
  loadList();
}

function showPendingTasks() {
  quickFilter.value = 'pending';
  selectedCycleId.value = '__pending__';
  selectedStage.value = 'all';
  resetPagination();
  loadList();
}

function actionText(status: TaskStatus): string {
  const map: Partial<Record<TaskStatus, string>> = {
    indicator_drafting: '填写指标',
    indicator_reviewing: '查看审核进度',
    indicator_setting: '查看/补充指标',
    indicator_confirming: '确认指标',
    self_eval: '去自评',
    published: '查看结果',
    confirmed: '查看记录',
    appealing: '查看申诉',
    closed: '查看归档',
  };
  return map[status] ?? '进入详情';
}

function handlerText(status: TaskStatus): string {
  const map: Partial<Record<TaskStatus, string>> = {
    indicator_drafting: '员工填写指标',
    indicator_reviewing: '主管审核指标',
    indicator_setting: '主管/HR制定；员工可先补充建议',
    indicator_confirming: '员工确认',
    self_eval: '员工自评',
    manager_scoring: '主管评分',
    dept_review: '部门负责人审核',
    hr_calibration: 'HR校准',
    approval: '分管总审批',
    published: '员工查看结果',
    confirmed: '已完成确认',
    appealing: '申诉处理中',
    closed: '已归档',
  };
  return map[status] ?? '查看详情';
}

function isPending(status: TaskStatus): boolean {
  return pendingStatuses.includes(status);
}

function taskDisplayName(row: TaskListItem): string {
  return row.cycleName ? `${row.cycleName} · 个人绩效` : '个人绩效任务';
}

function asTask(row: unknown): TaskListItem {
  return row as TaskListItem;
}

function goDetail(row: unknown) {
  const item = row as TaskListItem;
  router.push({ name: 'TaskDetail', params: { id: item.id } });
}

onMounted(async () => {
  await loadCycles();
  selectedCycleId.value = '';
  quickFilter.value = 'all';
  await loadList();
});

watch([page, pageSize], () => {
  loadList();
});
</script>

<template>
  <PerformanceWorkspace title="绩效待办" active-section="tasks">
    <template #toolbar>
      <el-tag type="info" effect="plain">{{ selectedCycleName }}</el-tag>
    </template>

    <template #context>
      <PerformanceContextPanel title="绩效阶段">
        <div data-testid="task-context" class="task-context">
          <div class="task-context__cycle">
            <div class="task-context__label">
              <el-icon><Calendar /></el-icon>
              <span>考核周期</span>
            </div>
            <el-select
              v-model="selectedCycleId"
              data-testid="task-cycle-filter"
              placeholder="选择考核周期"
              @change="onCycleChange"
            >
              <el-option label="全部考核周期" value="" />
              <el-option label="仅看待办任务" value="__pending__" />
              <el-option
                v-for="cycle in cycles"
                :key="cycle.id"
                :label="cycle.name"
                :value="cycle.id"
              />
            </el-select>
          </div>

          <div class="task-context__group">
            <div class="task-context__label">
              <el-icon><UserFilled /></el-icon>
              <span>我的绩效待办</span>
            </div>

            <div class="task-stage-list">
              <button
                type="button"
                class="task-stage-item"
                :class="{ 'is-active': selectedStage === 'all' }"
                :aria-pressed="selectedStage === 'all'"
                @click="selectStage('all')"
              >
                <span>全部阶段</span>
                <span class="task-stage-item__count">{{ list.length }}</span>
              </button>

              <button
                v-for="stage in taskStages"
                :key="stage.key"
                type="button"
                class="task-stage-item"
                :class="{ 'is-active': selectedStage === stage.key }"
                :data-testid="`task-stage-${stage.key}`"
                :aria-pressed="selectedStage === stage.key"
                @click="selectStage(stage.key)"
              >
                <span>{{ stage.label }}</span>
                <span
                  class="task-stage-item__state"
                  :class="`is-${stageState(stage.key)}`"
                >
                  {{ stageStateLabel(stageState(stage.key)) }}
                </span>
              </button>
            </div>
          </div>
        </div>
      </PerformanceContextPanel>
    </template>

    <div class="task-list page-stack">
      <section data-testid="task-surface" class="performance-surface">
        <header class="task-surface__header">
          <div class="task-surface__title">
            <span>{{ selectedCycleName }}</span>
            <h2>{{ selectedStageLabel }}</h2>
          </div>
          <div class="task-surface__summary">
            共 {{ visibleTasks.length }} 项
          </div>
        </header>

        <el-table v-loading="loading" class="app-table" :data="visibleTasks" @row-click="goDetail">
          <el-table-column label="任务名称" min-width="180">
            <template #default="{ row }">
              <div class="task-name">
                <div class="task-name__main">
                  <span>{{ taskDisplayName(asTask(row)) }}</span>
                  <el-tag v-if="asTask(row).isExempt" type="info" size="small" class="exempt-tag">已豁免</el-tag>
                </div>
                <div class="task-name__sub">
                  {{ asTask(row).employeeName || '-' }}<span v-if="asTask(row).deptName"> / {{ asTask(row).deptName }}</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="考核周期" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="cycle-cell">{{ asTask(row).cycleName || '未关联周期' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="190">
            <template #default="{ row }">
              <div class="status-cell">
                <StatusBadge :status="row.status" size="small" />
                <el-tag
                  :type="isPending(asTask(row).status) ? 'warning' : 'info'"
                  effect="plain"
                  size="small"
                >
                  {{ isPending(asTask(row).status) ? '待处理' : '无需处理' }}
                </el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="处理人/说明" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="handler-cell">{{ handlerText(asTask(row).status) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="当前动作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button type="primary" size="small" :icon="DocumentChecked" @click.stop="goDetail(row)">
                {{ actionText(row.status) }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="!loading && visibleTasks.length === 0" class="empty-wrap">
          <EmptyState
            :description="selectedStage === 'all'
              ? '暂无绩效任务。请等待HR发起考核周期后再处理。'
              : '该阶段暂无绩效任务。'"
          />
        </div>

        <div v-if="visibleTotal > 0" class="app-pager">
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :page-sizes="pageSizeOptions"
            :total="visibleTotal"
            layout="total, sizes, prev, pager, next"
          />
        </div>
      </section>
    </div>
  </PerformanceWorkspace>
</template>

<style scoped>
.task-list {
  min-width: 0;
  min-height: 100%;
  padding: 16px;
}

.task-context {
  min-width: 0;
}

.task-context__cycle {
  padding: 2px 4px 14px;
  border-bottom: 1px solid #edf0f4;
}

.task-context__cycle :deep(.el-select) {
  width: 100%;
}

.task-context__label {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 9px;
  color: #4d576b;
  font-size: 13px;
  font-weight: 650;
}

.task-context__group {
  padding: 14px 0 0;
}

.task-stage-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.task-stage-item {
  width: 100%;
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  color: #30384b;
  background: transparent;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.task-stage-item:hover {
  background: #f2f6fc;
}

.task-stage-item.is-active {
  color: #155cc3;
  background: #e6f2ff;
}

.task-stage-item__count,
.task-stage-item__state {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 4px;
  color: #727c8f;
  background: #f0f2f5;
  font-size: 11px;
}

.task-stage-item__state.is-pending {
  color: #ad6800;
  background: #fff1d6;
}

.task-stage-item__state.is-progress {
  color: #155cc3;
  background: #e6f2ff;
}

.task-stage-item__state.is-completed {
  color: #237804;
  background: #e8f7df;
}

.performance-surface {
  min-width: 0;
  min-height: 500px;
  overflow: hidden;
  background: #fff;
  border: 1px solid #e2e6ed;
  border-radius: 7px;
}

.performance-surface :deep(.el-table) {
  border: 0;
  border-radius: 0;
}

.performance-surface :deep(.el-table__row) {
  cursor: pointer;
}

.task-surface__header {
  min-height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  border-bottom: 1px solid #e8ebf0;
}

.task-surface__title span {
  color: #7b8495;
  font-size: 12px;
}

.task-surface__title h2 {
  margin: 4px 0 0;
  color: #20283a;
  font-size: 18px;
  font-weight: 700;
}

.task-surface__summary {
  flex-shrink: 0;
  color: #6f7889;
  font-size: 13px;
}

.status-cell {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.task-name {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.task-name__main {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--app-text-primary);
  font-weight: 600;
}

.task-name__sub {
  color: var(--app-text-secondary);
  font-size: 12px;
}

.cycle-cell {
  color: var(--app-text-primary);
  font-weight: 500;
}

.handler-cell {
  color: var(--app-text-secondary);
  font-size: 13px;
}

.exempt-tag {
  flex-shrink: 0;
}

.empty-wrap {
  padding: 32px 0;
}

@media (max-width: 768px) {
  .task-list {
    min-height: auto;
    padding: 10px;
  }

  .task-context__cycle {
    padding-bottom: 10px;
  }

  .task-stage-list {
    flex-direction: row;
    overflow-x: auto;
  }

  .task-stage-item {
    width: 168px;
    min-width: 168px;
  }

  .performance-surface {
    min-height: 420px;
    overflow-x: auto;
  }

  .task-surface__header {
    width: 100%;
    min-width: 320px;
  }

  .task-surface__title h2 {
    font-size: 16px;
  }
}
</style>
