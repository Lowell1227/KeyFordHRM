<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, Close, View } from '@element-plus/icons-vue';
import type { TableInstance } from 'element-plus';
import EmptyState from '@/components/common/EmptyState.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import type { TeamTaskListItem } from '@/types/api.types';
import type { TeamStageState, TeamTaskStage } from '@/types/enums';

export interface TeamTaskVersion {
  taskId: string;
  updatedAt: string;
}

const props = withDefaults(
  defineProps<{
    items: TeamTaskListItem[];
    total: number;
    page: number;
    pageSize: number;
    stage: TeamTaskStage;
    stageState?: TeamStageState;
    selectedTaskId?: string;
    loading?: boolean;
  }>(),
  {
    selectedTaskId: undefined,
    stageState: undefined,
    loading: false,
  },
);

const emit = defineEmits<{
  'task-selected': [payload: { taskId: string; employeeId: string }];
  'batch-approve': [tasks: TeamTaskVersion[]];
  'batch-reject': [tasks: TeamTaskVersion[]];
  'page-change': [page: number];
}>();

const tableRef = ref<TableInstance>();
const selectedRows = ref<TeamTaskListItem[]>([]);
const showBatchCommands = computed(
  () => props.stage === 'goal-review' && props.stageState === 'pending',
);
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

function stageStateType(state: TeamStageState): 'info' | 'warning' | 'success' {
  if (state === 'pending') return 'warning';
  if (state === 'completed') return 'success';
  return 'info';
}

function selectTask(item: TeamTaskListItem) {
  emit('task-selected', { taskId: item.id, employeeId: item.employeeId });
}

function asTeamTask(row: unknown): TeamTaskListItem {
  return row as TeamTaskListItem;
}

function onSelectionChange(rows: TeamTaskListItem[]) {
  selectedRows.value = rows;
}

function clearSelection() {
  tableRef.value?.clearSelection();
  selectedRows.value = [];
}

watch(showBatchCommands, (enabled) => {
  if (!enabled) clearSelection();
});

defineExpose({ clearSelection });
</script>

<template>
  <section class="team-task-list" data-testid="team-task-list">
    <header class="team-task-list__header">
      <div class="team-task-list__summary">
        <strong>团队成员</strong>
        <span>{{ total }} 人</span>
      </div>

      <div v-if="showBatchCommands" class="team-task-list__batch">
        <span v-if="selectedRows.length" class="team-task-list__selected">
          已选 {{ selectedRows.length }} 项
        </span>
        <el-button
          data-testid="team-batch-reject"
          size="small"
          :icon="Close"
          :disabled="selectedRows.length === 0"
          @click="emit('batch-reject', selectedVersions)"
        >
          批量驳回
        </el-button>
        <el-button
          data-testid="team-batch-approve"
          type="primary"
          size="small"
          :icon="Check"
          :disabled="selectedRows.length === 0"
          @click="emit('batch-approve', selectedVersions)"
        >
          批量通过
        </el-button>
      </div>
    </header>

    <div v-loading="loading" class="team-task-list__table-wrap">
      <el-table
        ref="tableRef"
        class="app-table team-task-list__table"
        :data="items"
        row-key="id"
        highlight-current-row
        :current-row-key="selectedTaskId"
        @selection-change="onSelectionChange"
        @row-click="selectTask"
      >
        <el-table-column
          v-if="showBatchCommands"
          type="selection"
          width="44"
          reserve-selection
        />
        <el-table-column label="员工" min-width="190">
          <template #default="{ row }">
            <button
              type="button"
              class="member-cell"
              :data-testid="`team-task-row-${row.id}`"
              @click.stop="selectTask(asTeamTask(row))"
            >
              <el-avatar :size="32" :src="row.avatarUrl || undefined">
                {{ row.employeeName.slice(0, 1) }}
              </el-avatar>
              <span class="member-cell__copy">
                <strong>{{ row.employeeName }}</strong>
                <small>{{ row.employeeNo || '-' }}<span v-if="row.position"> · {{ row.position }}</span></small>
              </span>
            </button>
          </template>
        </el-table-column>
        <el-table-column prop="deptName" label="部门" min-width="130">
          <template #default="{ row }">{{ row.deptName || '-' }}</template>
        </el-table-column>
        <el-table-column prop="cycleName" label="考核周期" min-width="140" show-overflow-tooltip />
        <el-table-column label="任务状态" min-width="170">
          <template #default="{ row }">
            <div class="team-task-list__status">
              <StatusBadge :status="row.status" size="small" />
              <el-tag :type="stageStateType(row.stageState)" effect="plain" size="small">
                {{ stageStateLabel(row.stageState) }}
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="结果" width="88" align="right">
          <template #default="{ row }">
            <span v-if="row.totalScore !== null">{{ row.totalScore }}</span>
            <span v-else-if="row.rawGrade">{{ row.rawGrade }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="更新日期" width="112">
          <template #default="{ row }">{{ row.updatedAt.slice(0, 10) }}</template>
        </el-table-column>
        <el-table-column width="50" fixed="right" align="center">
          <template #default="{ row }">
            <el-tooltip content="查看成员" placement="top">
              <el-button
                class="team-task-list__view"
                text
                circle
                :icon="View"
                :aria-label="`查看${row.employeeName}`"
                @click.stop="selectTask(asTeamTask(row))"
              />
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>

      <EmptyState v-if="!loading && items.length === 0" description="暂无匹配成员" />
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

.team-task-list :deep(.el-table__row) {
  cursor: pointer;
}

.team-task-list :deep(.el-table__row:hover .member-cell strong),
.team-task-list :deep(.el-table__row.current-row .member-cell strong) {
  color: #155cc3;
}

.member-cell {
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
    overflow-x: auto;
  }

  .team-task-list__table {
    min-width: 850px;
  }

  .team-task-list__footer {
    justify-content: flex-start;
    overflow-x: auto;
  }
}
</style>
