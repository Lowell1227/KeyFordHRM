<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Check, Close } from '@element-plus/icons-vue';
import type { TableInstance } from 'element-plus';
import EmptyState from '@/components/common/EmptyState.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import type { DirectReport, TeamTaskListItem } from '@/types/api.types';
import type { TeamStageState, TeamTaskStage } from '@/types/enums';

export interface TeamTaskVersion {
  taskId: string;
  updatedAt: string;
}

export interface TeamTaskListHandle {
  clearSelection: () => Promise<void>;
  retainSelection: (taskIds: string[]) => Promise<void>;
  focusList: () => Promise<void>;
}

const props = withDefaults(
  defineProps<{
    items: TeamTaskListItem[];
    roster?: DirectReport[];
    hasCycle?: boolean;
    total: number;
    page: number;
    pageSize: number;
    stage: TeamTaskStage;
    stageState?: TeamStageState;
    selectedTaskId?: string;
    loading?: boolean;
    error?: boolean;
    batchBusy?: boolean;
    currentManagerId?: string;
  }>(),
  {
    selectedTaskId: undefined,
    roster: () => [],
    hasCycle: false,
    stageState: undefined,
    loading: false,
    error: false,
    batchBusy: false,
    currentManagerId: undefined,
  },
);

const emit = defineEmits<{
  'task-selected': [payload: { taskId: string; employeeId: string }];
  'batch-approve': [tasks: TeamTaskVersion[]];
  'batch-reject': [tasks: TeamTaskVersion[]];
  'page-change': [page: number];
}>();

const tableRef = ref<TableInstance>();
const rootRef = ref<HTMLElement>();
const selectedRows = ref<TeamTaskListItem[]>([]);
const containerWidth = ref(typeof window === 'undefined' ? 0 : window.innerWidth);
let resizeObserver: ResizeObserver | undefined;
let reconcilingSelection = false;
const showRosterOnly = computed(
  () => !props.hasCycle && props.items.length === 0 && props.roster.length > 0,
);
const memberCount = computed(() => {
  if (props.roster.length > 0) return props.roster.length;
  return new Set(props.items.map((item) => item.employeeId)).size;
});
const showBatchCommands = computed(
  () => !showRosterOnly.value && props.stage === 'goal-review' && props.stageState === 'pending',
);
const mediumColumns = computed(() => containerWidth.value > 0 && containerWidth.value < 980);
const narrowColumns = computed(() => containerWidth.value > 0 && containerWidth.value < 640);
const selectedVersions = computed<TeamTaskVersion[]>(() =>
  selectedRows.value.map((item) => ({ taskId: item.id, updatedAt: item.updatedAt })),
);

function stageStateLabel(state: TeamStageState): string {
  const labels: Record<TeamStageState, string> = {
    not_started: '未开始',
    pending: '待处理',
    completed: '已完成',
    exempted: '已豁免',
  };
  return labels[state];
}

function periodLabel(item: TeamTaskListItem): string {
  const period = item.periodReview;
  if (!period) return '-';
  if (period.periodType === 'cycle') return '整周期';
  const [year, month] = period.periodKey.split('-');
  return `${year}年${Number(month)}月`;
}

function managerStatusLabel(item: TeamTaskListItem): string {
  const status = item.periodReview?.status;
  if (status === 'manager_scoring') return '主管评分中';
  if (status === 'self_eval') return '员工自评中';
  if (status === 'completed') return '本期已完成';
  if (status === 'no_result') return '本期无结果';
  if (status === 'unopened') return '未开始';
  return stageStateLabel(item.stageState);
}

function taskActionLabel(item: TeamTaskListItem): string {
  return item.stageState === 'pending' ? '处理' : '查看';
}

function selectTask(item: TeamTaskListItem) {
  emit('task-selected', { taskId: item.id, employeeId: item.employeeId });
}

function asTeamTask(row: unknown): TeamTaskListItem {
  return row as TeamTaskListItem;
}

function isEligible(item: TeamTaskListItem): boolean {
  return showBatchCommands.value
    && item.stageState === 'pending'
    && Boolean(props.currentManagerId && item.managerId === props.currentManagerId);
}

function onSelectionChange(rows: TeamTaskListItem[]) {
  if (reconcilingSelection) return;
  selectedRows.value = rows.filter(isEligible);
}

async function syncSelection(taskIds: ReadonlySet<string>) {
  await nextTick();
  const eligibleRows = props.items.filter((item) => isEligible(item) && taskIds.has(item.id));
  reconcilingSelection = true;
  tableRef.value?.clearSelection();
  for (const row of eligibleRows) tableRef.value?.toggleRowSelection(row, true);
  selectedRows.value = eligibleRows;
  await nextTick();
  reconcilingSelection = false;
}

async function clearSelection() {
  await syncSelection(new Set());
}

async function retainSelection(taskIds: string[]) {
  await syncSelection(new Set(taskIds));
}

async function pruneSelection() {
  await syncSelection(new Set(selectedRows.value.map((item) => item.id)));
}

async function focusList() {
  await nextTick();
  rootRef.value?.focus();
}

watch(
  () => [props.items, props.page, props.stage, props.stageState] as const,
  () => void pruneSelection(),
);

onMounted(() => {
  if (!rootRef.value) return;
  resizeObserver = new ResizeObserver(([entry]) => {
    containerWidth.value = entry?.contentRect.width ?? 0;
  });
  resizeObserver.observe(rootRef.value);
});

onBeforeUnmount(() => resizeObserver?.disconnect());

defineExpose<TeamTaskListHandle>({ clearSelection, retainSelection, focusList });
</script>

<template>
  <section
    ref="rootRef"
    class="team-task-list"
    data-testid="team-task-list"
    tabindex="-1"
  >
    <header class="team-task-list__header">
      <div class="team-task-list__summary">
        <strong>直属下属</strong>
        <span>{{ memberCount }} 人 · {{ total }} 项任务</span>
      </div>

      <div v-if="showBatchCommands" class="team-task-list__batch">
        <span
          v-if="selectedRows.length"
          class="team-task-list__selected"
          data-testid="team-selected-count"
        >
          已选 {{ selectedRows.length }} 项
        </span>
        <el-button
          data-testid="team-batch-reject"
          size="small"
          :icon="Close"
          :disabled="selectedRows.length === 0 || batchBusy"
          :loading="batchBusy"
          @click="emit('batch-reject', selectedVersions)"
        >
          批量退回
        </el-button>
        <el-button
          data-testid="team-batch-approve"
          type="primary"
          size="small"
          :icon="Check"
          :disabled="selectedRows.length === 0 || batchBusy"
          :loading="batchBusy"
          @click="emit('batch-approve', selectedVersions)"
        >
          批量通过
        </el-button>
      </div>
    </header>

    <div
      v-loading="loading"
      class="team-task-list__table-wrap"
      data-testid="team-task-table-wrap"
    >
      <el-table
        v-if="!showRosterOnly"
        ref="tableRef"
        class="app-table team-task-list__table"
        :data="items"
        row-key="id"
        highlight-current-row
        :current-row-key="selectedTaskId"
        empty-text=" "
        @selection-change="onSelectionChange"
        @row-click="selectTask"
      >
        <el-table-column
          v-if="showBatchCommands"
          type="selection"
          width="40"
          :selectable="isEligible"
        />
        <el-table-column label="员工" :min-width="narrowColumns ? 132 : mediumColumns ? 150 : 190">
          <template #default="{ row }">
            <button
              type="button"
              class="member-cell"
              :data-testid="`team-task-row-${row.id}`"
              @click.stop="selectTask(asTeamTask(row))"
            >
              <el-avatar :size="28" :src="row.avatarUrl || undefined">
                {{ row.employeeName.slice(0, 1) }}
              </el-avatar>
              <span class="member-cell__copy">
                <strong>{{ row.employeeName }}</strong>
                <small class="member-cell__meta">
                  {{ row.employeeNo || '-' }}<template v-if="mediumColumns">
                    <span v-if="narrowColumns && row.deptName"> · {{ row.deptName }}</span>
                    <span v-if="narrowColumns && row.position"> · {{ row.position }}</span>
                    <span v-if="row.cycleName"> · {{ row.cycleName }}</span>
                  </template>
                </small>
              </span>
            </button>
          </template>
        </el-table-column>
        <el-table-column v-if="!narrowColumns" prop="deptName" label="部门" min-width="120">
          <template #default="{ row }">{{ row.deptName || '-' }}</template>
        </el-table-column>
        <el-table-column v-if="!narrowColumns" prop="position" label="职位" min-width="120">
          <template #default="{ row }">{{ row.position || '-' }}</template>
        </el-table-column>
        <el-table-column
          v-if="!mediumColumns"
          prop="cycleName"
          label="考核周期"
          min-width="130"
          show-overflow-tooltip
        />
        <el-table-column v-if="stage === 'manager-eval' && !mediumColumns" label="复盘期间" width="112">
          <template #default="{ row }">{{ periodLabel(asTeamTask(row)) }}</template>
        </el-table-column>
        <el-table-column label="任务状态" :min-width="narrowColumns ? 96 : mediumColumns ? 120 : 170">
          <template #default="{ row }">
            <div v-if="stage === 'manager-eval'" class="team-task-list__status">
              <el-tag size="small" :type="row.stageState === 'pending' ? 'warning' : row.stageState === 'completed' ? 'success' : 'info'">
                {{ managerStatusLabel(asTeamTask(row)) }}
              </el-tag>
            </div>
            <div v-else class="team-task-list__status">
              <StatusBadge :status="row.status" size="small" />
              <small :class="`is-${row.stageState}`">
                {{ stageStateLabel(row.stageState) }}
              </small>
            </div>
          </template>
        </el-table-column>
        <el-table-column v-if="stage === 'manager-eval' && !narrowColumns" label="自评总分" width="96" align="right">
          <template #default="{ row }">
            <span data-testid="team-self-score-total">{{ row.periodReview?.selfScoreTotal ?? '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="stage === 'manager-eval' && !narrowColumns" label="主管总分" width="96" align="right">
          <template #default="{ row }">
            <span data-testid="team-manager-score-total">{{ row.periodReview ? (row.periodReview.managerScoreTotal ?? '-') : (row.totalScore ?? '-') }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="!mediumColumns" label="更新日期" width="112">
          <template #default="{ row }">{{ row.updatedAt.slice(0, 10) }}</template>
        </el-table-column>
        <el-table-column label="操作" :width="narrowColumns ? 56 : 72" fixed="right" align="center">
          <template #default="{ row }">
            <el-button
              class="team-task-list__action"
              link
              type="primary"
              size="small"
              :aria-label="`${taskActionLabel(asTeamTask(row))} ${row.employeeName}`"
              @click.stop="selectTask(asTeamTask(row))"
            >
              {{ taskActionLabel(asTeamTask(row)) }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-table
        v-else
        class="app-table team-task-list__table team-task-list__roster"
        :data="roster"
        row-key="id"
      >
        <el-table-column label="员工" :min-width="narrowColumns ? 150 : 210">
          <template #default="{ row }">
            <div class="member-cell" :data-testid="`direct-report-row-${row.id}`">
              <el-avatar :size="28" :src="row.avatarUrl || undefined">
                {{ row.name.slice(0, 1) }}
              </el-avatar>
              <span class="member-cell__copy">
                <strong>{{ row.name }}</strong>
                <small>{{ row.employeeNo || '工号待补充' }}</small>
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column v-if="!narrowColumns" label="部门" min-width="120">
          <template #default="{ row }">{{ row.deptName || '-' }}</template>
        </el-table-column>
        <el-table-column v-if="!narrowColumns" label="职位" min-width="140">
          <template #default="{ row }">{{ row.position || '-' }}</template>
        </el-table-column>
        <el-table-column label="任务状态" :min-width="narrowColumns ? 110 : 150">
          <template #default>
            <el-tag type="info" size="small">待发起考核</el-tag>
          </template>
        </el-table-column>
      </el-table>

      <div
        v-if="!loading && !error && items.length === 0 && roster.length === 0"
        data-testid="team-task-empty"
      >
        <EmptyState :description="hasCycle ? '暂无匹配任务' : '暂无直属下属'" />
      </div>
    </div>

    <footer v-if="total > 0" class="team-task-list__footer">
      <el-pagination
        background
        small
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @update:current-page="emit('page-change', $event)"
      />
    </footer>
  </section>
</template>

<style scoped>
.team-task-list {
  min-width: 0;
  min-height: 520px;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #e2e6ed;
  border-radius: 7px;
  overflow: hidden;
  outline: none;
}

.team-task-list:focus-visible {
  box-shadow: 0 0 0 2px #91caff inset;
}

.team-task-list__header {
  min-height: 54px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid #e8ebf0;
}

.team-task-list__summary,
.team-task-list__batch,
.team-task-list__status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.team-task-list__summary strong {
  color: #20283a;
  font-size: 15px;
}

.team-task-list__summary span,
.team-task-list__selected {
  color: #70798a;
  font-size: 12px;
}

.team-task-list__table-wrap {
  min-width: 0;
  min-height: 400px;
  flex: 1;
  overflow: hidden;
}

.team-task-list__table {
  width: 100%;
}

.team-task-list :deep(.el-table__header-wrapper th.el-table__cell) {
  height: 44px;
  background: #f7f9fc !important;
}

.team-task-list :deep(.el-table__body td.el-table__cell) {
  height: 52px;
  padding: 5px 0;
}

.team-task-list :deep(.el-table__row:nth-child(even) td.el-table__cell) {
  background: #fff;
}

.team-task-list :deep(.el-table__row) {
  cursor: pointer;
}

.team-task-list__roster :deep(.el-table__row) {
  cursor: default;
}

.team-task-list :deep(.el-table__row:hover .member-cell strong),
.team-task-list :deep(.el-table__row.current-row .member-cell strong) {
  color: #155cc3;
}

.member-cell {
  width: 100%;
  max-width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.member-cell__copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.member-cell__copy strong,
.member-cell__copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-cell__copy strong {
  color: #273044;
  font-size: 13px;
  font-weight: 650;
}

.member-cell__copy small {
  color: #7a8495;
  font-size: 11px;
}

.team-task-list__status {
  min-width: 0;
  align-items: flex-start;
  flex-direction: column;
  gap: 2px;
}

.team-task-list__status small {
  color: #7a8495;
  font-size: 11px;
  line-height: 14px;
}

.team-task-list__status small.is-pending {
  color: #ad6800;
}

.team-task-list__status small.is-completed {
  color: #389e0d;
}

.team-task-list__action {
  min-height: 28px;
  padding: 0 4px;
  font-weight: 600;
}

.team-task-list__footer {
  min-height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 8px 14px;
  border-top: 1px solid #e8ebf0;
}

@media (max-width: 768px) {
  .team-task-list {
    min-height: 460px;
  }

  .team-task-list__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .team-task-list__batch {
    width: 100%;
    overflow-x: auto;
  }

  .team-task-list__table-wrap {
    min-height: 340px;
    overflow-x: hidden;
  }

  .member-cell__meta {
    display: -webkit-box;
    white-space: normal;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .team-task-list__footer {
    justify-content: flex-start;
    overflow-x: auto;
  }
}
</style>
