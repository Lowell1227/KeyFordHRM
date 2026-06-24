<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { cyclesApi } from '@/api/cycles.api';
import { tasksApi } from '@/api/tasks.api';
import GradeTag from '@/components/common/GradeTag.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import { usePagination } from '@/composables/usePagination';
import { formatScore } from '@/utils/score';
import type { AssessmentCycle, TaskListItem } from '@/types/api.types';
import type { TaskStatus } from '@/types/enums';

const cycles = ref<AssessmentCycle[]>([]);
const selectedCycleId = ref<string | null>(null);
const tasks = ref<TaskListItem[]>([]);
const loading = ref(false);
const publishing = ref(false);
const selectedTaskIds = ref<string[]>([]);
const sendDingtalk = ref(false);

const tableRef = ref<any>(null);

const {
  page,
  pageSize,
  total,
  pageSizeOptions,
  reset: resetPagination,
  withParams,
} = usePagination({ defaultPageSize: 20 });

const selectedCycle = computed(() =>
  cycles.value.find((c) => c.id === selectedCycleId.value),
);

const hasSelection = computed(() => selectedTaskIds.value.length > 0);

const publishableCount = computed(() => tasks.value.filter((t) => !isPublished(t)).length);

function isPublished(task: TaskListItem): boolean {
  return task.status === 'published' || !!task.publishedAt;
}

function rowClassName({ row }: { row: TaskListItem }): string {
  return isPublished(row) ? 'publish-view__row--published' : '';
}

async function loadCycles() {
  try {
    const res = await cyclesApi.findAll({ status: 'approval' });
    cycles.value = res.items;
    if (cycles.value.length > 0 && !selectedCycleId.value) {
      selectedCycleId.value = cycles.value[0].id;
    }
  } catch {
    cycles.value = [];
  }
}

async function loadTasks() {
  if (!selectedCycleId.value) {
    tasks.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  try {
    const res = await tasksApi.findAll(
      withParams({
        cycleId: selectedCycleId.value,
        status: 'approval' as TaskStatus,
      }),
    );
    tasks.value = res.items;
    total.value = res.total;
  } catch {
    tasks.value = [];
    total.value = 0;
    ElMessage.error('获取任务列表失败');
  } finally {
    loading.value = false;
  }
}

function refreshList() {
  selectedTaskIds.value = [];
  tableRef.value?.clearSelection();
  loadTasks();
}

watch(selectedCycleId, () => {
  resetPagination();
  refreshList();
});

watch([page, pageSize], () => {
  loadTasks();
});

onMounted(() => {
  loadCycles().then(() => {
    if (selectedCycleId.value) loadTasks();
  });
});

function onSelectionChange(rows: TaskListItem[]) {
  selectedTaskIds.value = rows.map((r) => r.id);
}

function selectAllOnPage() {
  const rows = tasks.value.filter((t) => !isPublished(t));
  rows.forEach((row) => {
    tableRef.value?.toggleRowSelection(row, true);
  });
}

function clearSelection() {
  tableRef.value?.clearSelection();
  selectedTaskIds.value = [];
}

async function handlePublish() {
  if (!selectedCycleId.value || selectedTaskIds.value.length === 0) return;
  try {
    await ElMessageBox.confirm(
      `确认公示选中的 ${selectedTaskIds.value.length} 条绩效结果？公示后员工将收到通知并可在「我的绩效」中查看结果。`,
      '确认公示',
      {
        confirmButtonText: '确认公示',
        cancelButtonText: '取消',
        type: 'warning',
      },
    );
  } catch {
    return;
  }

  publishing.value = true;
  try {
    const res = await cyclesApi.publishResults(selectedCycleId.value, {
      taskIds: selectedTaskIds.value,
      sendDingtalkNotification: sendDingtalk.value,
    });
    ElMessage.success(`公示成功，共发布 ${res.published} 条`);
    sendDingtalk.value = false;
    refreshList();
  } catch {
    // 错误已由 http 拦截器统一提示，此处仅终止 loading
  } finally {
    publishing.value = false;
  }
}
</script>

<template>
  <div class="publish-view page-stack">
    <ChartCard>
      <template #title>结果公示发布台</template>
      <template #extra>
        <div class="publish-view__toolbar">
          <el-select
            v-model="selectedCycleId"
            placeholder="选择考核周期"
            style="width: 260px"
            :disabled="cycles.length === 0"
          >
            <el-option
              v-for="cycle in cycles"
              :key="cycle.id"
              :label="cycle.name"
              :value="cycle.id"
            />
          </el-select>

          <el-checkbox v-model="sendDingtalk" class="dingtalk-checkbox">
            发送钉钉通知
          </el-checkbox>

          <el-button
            type="primary"
            :disabled="!hasSelection"
            :loading="publishing"
            @click="handlePublish"
          >
            发布公示
          </el-button>
        </div>
      </template>

      <div v-if="!selectedCycle" class="publish-view__empty">
        <EmptyState description="暂无可公示的考核周期" />
      </div>

      <div v-else class="publish-view__sub-toolbar">
        <span class="selection-tip">
          已选 <strong>{{ selectedTaskIds.length }}</strong> 项
        </span>
        <div class="selection-actions">
          <el-button link type="primary" @click="selectAllOnPage">
            全选本页
          </el-button>
          <el-button link type="info" @click="clearSelection">
            清空选择
          </el-button>
        </div>
      </div>
    </ChartCard>

    <ChartCard v-if="selectedCycle" :padded="false">
      <template #default>
        <el-table
          ref="tableRef"
          class="app-table"
          v-loading="loading"
          :data="tasks"
          row-key="id"
          :row-class-name="rowClassName"
          @selection-change="onSelectionChange"
        >
          <el-table-column
            type="selection"
            width="50"
            :selectable="(row) => !isPublished(row as TaskListItem)"
            reserve-selection
          />
          <el-table-column prop="employeeName" label="员工" min-width="120" />
          <el-table-column prop="employeeNo" label="工号" min-width="120" />
          <el-table-column prop="deptName" label="部门" min-width="160" show-overflow-tooltip />
          <el-table-column label="总分" width="100">
            <template #default="{ row }">
              {{ formatScore(row.totalScore) }}
            </template>
          </el-table-column>
          <el-table-column label="等级" width="100">
            <template #default="{ row }">
              <GradeTag :grade="(row as TaskListItem).grade ?? (row as TaskListItem).rawGrade" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="状态" width="140">
            <template #default="{ row }">
              <StatusBadge :status="row.status" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="是否已公示" width="120" align="center">
            <template #default="{ row }">
              <el-tag v-if="isPublished(row as TaskListItem)" type="success" size="small">已公示</el-tag>
              <span v-else class="not-published">未公示</span>
            </template>
          </el-table-column>
          <el-table-column label="公示时间" min-width="160">
            <template #default="{ row }">
              {{ row.publishedAt || '-' }}
            </template>
          </el-table-column>
        </el-table>

        <div v-if="!loading && tasks.length === 0" class="publish-view__empty">
          <EmptyState description="该周期下暂无待公示任务" />
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
      </template>
    </ChartCard>
  </div>
</template>

<style scoped>
.publish-view__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.dingtalk-checkbox {
  margin-left: 8px;
}

.publish-view__sub-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.selection-tip {
  font-size: 14px;
  color: #606266;
}

.selection-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.not-published {
  color: #909399;
  font-size: 14px;
}

.publish-view__empty {
  padding: 32px 0;
}
</style>

<style>
.publish-view__row--published {
  background-color: var(--el-fill-color-light);
}
</style>
