<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { DocumentChecked } from '@element-plus/icons-vue';
import { tasksApi } from '@/api/tasks.api';
import { cyclesApi } from '@/api/cycles.api';
import { usePagination } from '@/composables/usePagination';
import StatusBadge from '@/components/common/StatusBadge.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import PerformanceWorkspace from '@/components/performance/PerformanceWorkspace.vue';
import type { TaskListItem, AssessmentCycle } from '@/types/api.types';
import type { TaskStatus } from '@/types/enums';

const router = useRouter();

const list = ref<TaskListItem[]>([]);
const loading = ref(false);
const cycles = ref<AssessmentCycle[]>([]);
const selectedCycleId = ref<string>('');
const quickFilter = ref<'all' | 'pending' | 'cycle'>('all');

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
  resetPagination();
  loadList();
}

function showPendingTasks() {
  quickFilter.value = 'pending';
  selectedCycleId.value = '__pending__';
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
  <PerformanceWorkspace title="绩效待办" active-section="tasks" :show-context="false">
    <div class="task-list page-stack">
    <ChartCard>
      <div class="task-summary">
        <div>
          <div class="summary-title">个人绩效任务</div>
        </div>
      </div>

      <div class="cycle-summary">
        <div class="cycle-summary__label">考核周期范围</div>
        <div class="cycle-summary__name">{{ selectedCycleName }}</div>
        <el-select
          v-if="cycles.length > 0"
          v-model="selectedCycleId"
          placeholder="快速筛选"
          class="cycle-summary__select"
          size="small"
          @change="onCycleChange"
        >
          <el-option label="全部考核周期" value="" />
          <el-option label="仅看待办任务" value="__pending__" />
          <el-option v-for="cycle in cycles" :key="cycle.id" :label="cycle.name" :value="cycle.id" />
        </el-select>
      </div>
    </ChartCard>

    <ChartCard :padded="false" class="task-list__list-card">
      <el-table v-loading="loading" class="app-table" :data="list" @row-click="goDetail">
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

      <div v-if="!loading && list.length === 0" class="empty-wrap">
        <EmptyState description="暂无绩效任务。请等待HR发起考核周期后再处理。" />
      </div>

      <div v-if="total > 0" class="app-pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="pageSizeOptions"
          :total="total"
          layout="total, sizes, prev, pager, next"
        />
      </div>
    </ChartCard>
    </div>
  </PerformanceWorkspace>
</template>

<style scoped>
.task-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.summary-title {
  font-weight: 700;
  color: var(--app-text-primary);
  margin-bottom: 4px;
}

.cycle-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  max-width: 100%;
  margin-top: 14px;
  padding: 7px 10px;
  color: var(--app-text-secondary);
  background: #f7f9fd;
  border: 1px solid #e4e9f2;
  border-radius: 6px;
}

.cycle-summary__label {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
}

.cycle-summary__name {
  max-width: 460px;
  overflow: hidden;
  color: var(--app-text-primary);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cycle-summary__select {
  width: 240px;
}

.task-list__list-card :deep(.el-table__row) {
  cursor: pointer;
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
  .task-summary {
    align-items: flex-start;
    flex-direction: column;
  }

  .cycle-summary {
    align-items: stretch;
    flex-direction: column;
    width: 100%;
  }

  .cycle-summary__name,
  .cycle-summary__select {
    width: 100%;
    max-width: none;
  }
}
</style>
