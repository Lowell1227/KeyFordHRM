<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { approvalApi } from '@/api/approval.api';
import { cyclesApi } from '@/api/cycles.api';
import GradeTag from '@/components/common/GradeTag.vue';
import GradeDistChart from '@/components/charts/GradeDistChart.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import type { ApprovalOverview, ApprovalTaskView, AssessmentCycle } from '@/types/api.types';
import { resolvePerformanceCycle } from '@/utils/performance-cycle';
import { useAuthStore } from '@/stores/auth.store';
import { TASK_STATUS_META, type PerfGrade } from '@/types/enums';
import { GRADE_LABELS } from '@/utils/grade';
import { formatDateTime } from '@/utils/date';
import {
  canOperatePerformanceApproval,
  canOperatePerformanceApprovalTask,
} from '@/utils/business-permissions';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const cycles = ref<AssessmentCycle[]>([]);
const selectedCycleId = ref('');
const tasks = ref<ApprovalTaskView[]>([]);
const overview = ref<ApprovalOverview | null>(null);
const loading = ref(false);
const submitting = ref(false);
const selectedTaskIds = ref<string[]>([]);
let approvalReady = false;

const GRADES = ['A', 'B', 'C', 'D'] as const;

const selectedCycle = computed(() =>
  cycles.value.find((c) => c.id === selectedCycleId.value),
);

const hasSelection = computed(() => selectedTaskIds.value.length > 0);
const canOperateApproval = computed(() => (
  auth.user ? canOperatePerformanceApproval(auth.user) : false
));

const rejectDialog = ref({
  visible: false,
  mode: 'single' as 'single' | 'batch',
  taskId: undefined as string | undefined,
  comment: '',
});

const gradeCounts = computed<Record<PerfGrade, number>>(() => {
  const counts: Record<PerfGrade, number> = { A: 0, B: 0, C: 0, D: 0 };
  const dist = overview.value?.gradeDistribution;
  if (dist) {
    (Object.keys(counts) as PerfGrade[]).forEach((g) => {
      counts[g] = dist[g]?.count ?? 0;
    });
  }
  return counts;
});

const distTotal = computed(() =>
  (Object.keys(gradeCounts.value) as PerfGrade[]).reduce((sum, g) => sum + gradeCounts.value[g], 0),
);

function statusLabel(status: ApprovalTaskView['status']): string {
  return TASK_STATUS_META[status]?.label ?? status;
}

const TAG_TYPES = ['info', 'primary', 'success', 'warning', 'danger'] as const;
type TagType = (typeof TAG_TYPES)[number];

function statusType(status: ApprovalTaskView['status']): TagType {
  const type = TASK_STATUS_META[status]?.type;
  return (TAG_TYPES as readonly string[]).includes(type) ? (type as TagType) : 'info';
}

async function loadCycles() {
  try {
    const res = await cyclesApi.findAll({ status: 'approval' });
    cycles.value = res.items;
  } catch {
    cycles.value = [];
  }
}

async function normalizeApprovalCycle() {
  const requestedCycleId = typeof route.query.cycleId === 'string'
    ? route.query.cycleId
    : undefined;
  const resolved = resolvePerformanceCycle(cycles.value, requestedCycleId);
  cycles.value = resolved.orderedCycles;
  selectedCycleId.value = resolved.selectedCycle?.id ?? '';

  if (selectedCycleId.value && requestedCycleId !== selectedCycleId.value) {
    await router.replace({ query: { ...route.query, cycleId: selectedCycleId.value } });
  } else if (!selectedCycleId.value && requestedCycleId) {
    const query = { ...route.query };
    delete query.cycleId;
    await router.replace({ query });
  }
}

function clearApprovalState() {
  tasks.value = [];
  overview.value = null;
  selectedTaskIds.value = [];
  rejectDialog.value = {
    visible: false,
    mode: 'single',
    taskId: undefined,
    comment: '',
  };
}

async function selectApprovalCycle(cycleId: string) {
  if (!cycleId || cycleId === selectedCycleId.value) return;
  await router.push({ query: { ...route.query, cycleId } });
}

async function loadTasks() {
  if (!selectedCycleId.value) {
    tasks.value = [];
    overview.value = null;
    return;
  }
  loading.value = true;
  try {
    const [list, overviewData] = await Promise.all([
      approvalApi.getApprovalList(selectedCycleId.value),
      approvalApi.getOverview(selectedCycleId.value),
    ]);
    tasks.value = list;
    overview.value = overviewData;
  } catch {
    tasks.value = [];
    overview.value = null;
  } finally {
    loading.value = false;
  }
}

function refreshList() {
  selectedTaskIds.value = [];
  loadTasks();
}

watch(
  () => route.query.cycleId,
  async (cycleId) => {
    if (!approvalReady) return;
    const requestedCycleId = typeof cycleId === 'string' ? cycleId : undefined;
    const resolved = resolvePerformanceCycle(cycles.value, requestedCycleId);
    const canonicalCycleId = resolved.selectedCycle?.id ?? '';
    if (canonicalCycleId && requestedCycleId !== canonicalCycleId) {
      await router.replace({ query: { ...route.query, cycleId: canonicalCycleId } });
      return;
    }
    if (!canonicalCycleId && requestedCycleId) {
      const query = { ...route.query };
      delete query.cycleId;
      await router.replace({ query });
      return;
    }
    if (selectedCycleId.value === canonicalCycleId) return;
    clearApprovalState();
    selectedCycleId.value = canonicalCycleId;
    await loadTasks();
  },
);

onMounted(async () => {
  await loadCycles();
  await normalizeApprovalCycle();
  approvalReady = true;
  await loadTasks();
});

function onSelectionChange(rows: ApprovalTaskView[]) {
  selectedTaskIds.value = rows.map((r) => r.id);
}

function canOperateTask(task: unknown): boolean {
  const approvalTask = task as ApprovalTaskView;
  return Boolean(
    auth.user
    && canOperatePerformanceApprovalTask(auth.user, approvalTask.approverId),
  );
}

function isTaskSelectable(task: unknown): boolean {
  return canOperateTask(task);
}

async function handleApproveSingle(taskId: string) {
  if (!selectedCycleId.value) return;
  submitting.value = true;
  try {
    await approvalApi.approve(selectedCycleId.value, { taskIds: [taskId] });
    ElMessage.success('已通过');
    refreshList();
  } finally {
    submitting.value = false;
  }
}

async function handleBatchApprove() {
  if (!selectedCycleId.value || selectedTaskIds.value.length === 0) return;
  submitting.value = true;
  try {
    await approvalApi.approve(selectedCycleId.value, {
      taskIds: selectedTaskIds.value,
    });
    ElMessage.success('批量通过成功');
    refreshList();
  } finally {
    submitting.value = false;
  }
}

async function doBatchReject(comment: string) {
  if (selectedTaskIds.value.length === 0) return;
  submitting.value = true;
  let successCount = 0;
  let failCount = 0;
  try {
    for (const taskId of selectedTaskIds.value) {
      try {
        await approvalApi.rejectTask(taskId, { comment });
        successCount++;
      } catch (e) {
        failCount++;
        console.error(`退回任务 ${taskId} 失败`, e);
      }
    }
    if (failCount === 0) {
      ElMessage.success(`批量退回成功，共 ${successCount} 条`);
    } else {
      ElMessage.warning(`退回结果：成功 ${successCount} 条，失败 ${failCount} 条`);
    }
    refreshList();
  } finally {
    submitting.value = false;
  }
}

function openRejectDialog(options: { taskId?: string }) {
  rejectDialog.value = {
    visible: true,
    mode: options.taskId ? 'single' : 'batch',
    taskId: options.taskId,
    comment: '',
  };
}

async function confirmReject() {
  const comment = rejectDialog.value.comment.trim();
  if (!comment) {
    ElMessage.warning('退回绩效校准时必须填写审批意见');
    return;
  }
  rejectDialog.value.visible = false;

  if (rejectDialog.value.mode === 'single' && rejectDialog.value.taskId) {
    submitting.value = true;
    try {
      await approvalApi.rejectTask(rejectDialog.value.taskId, { comment });
      ElMessage.success('已退回绩效校准');
      refreshList();
    } finally {
      submitting.value = false;
    }
  } else {
    await doBatchReject(comment);
  }
}

async function handleApproveSingleWithConfirm(taskId: string) {
  try {
    await ElMessageBox.confirm('确认通过该员工的绩效结果？', '确认通过', {
      confirmButtonText: '通过',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await handleApproveSingle(taskId);
  } catch {
    // 用户取消，不处理
  }
}

async function handleBatchApproveWithConfirm() {
  try {
    await ElMessageBox.confirm(
      `确认批量通过选中的 ${selectedTaskIds.value.length} 条绩效结果？`,
      '确认批量通过',
      { confirmButtonText: '批量通过', cancelButtonText: '取消', type: 'warning' },
    );
    await handleBatchApprove();
  } catch {
    // 用户取消，不处理
  }
}

function handleRejectSingle(taskId: string) {
  openRejectDialog({ taskId });
}

function handleBatchReject() {
  if (selectedTaskIds.value.length === 0) return;
  openRejectDialog({});
}
</script>

<template>
  <div class="approval-view page-stack">
    <ChartCard :padded="false">
      <template #title>结果审批</template>
      <template #extra>
        <div class="approval-view__toolbar">
          <el-select
            :model-value="selectedCycleId"
            data-testid="approval-cycle-select"
            :placeholder="cycles.length ? '选择考核周期' : '暂无考核周期'"
            style="width: 260px"
            :disabled="cycles.length === 0"
            @change="selectApprovalCycle"
          >
            <el-option v-if="cycles.length === 0" label="暂无考核周期" value="" disabled />
            <el-option
              v-for="cycle in cycles"
              :key="cycle.id"
              :label="cycle.name"
              :value="cycle.id"
            />
          </el-select>
          <el-button
            v-if="canOperateApproval"
            type="primary"
            :disabled="!hasSelection"
            :loading="submitting"
            @click="handleBatchApproveWithConfirm"
          >
            批量通过
          </el-button>
          <el-button
            v-if="canOperateApproval"
            type="danger"
            plain
            :disabled="!hasSelection"
            :loading="submitting"
            @click="handleBatchReject"
          >
            批量退回
          </el-button>
        </div>
      </template>

      <div v-if="!selectedCycle" class="approval-view__empty">
        <EmptyState description="暂无可审批的考核周期" />
      </div>

      <template v-else>
        <el-alert
          v-if="!canOperateApproval"
          class="approval-view__readonly"
          data-testid="approval-readonly-notice"
          type="info"
          :closable="false"
          title="当前为全局只读视图"
          description="你可以查看审批结果，但只有任务指定的最终业务审批人可以通过或退回。"
          show-icon
        />

        <div v-if="overview" class="approval-view__overview">
          <ChartCard class="approval-view__overview-card">
            <template #title>全校准分布（只读）</template>
            <GradeDistChart :data="gradeCounts" title="" :height="220" />
            <div class="ratio-row">
              <div
                v-for="grade in GRADES"
                :key="grade"
                class="ratio-item"
                :class="{ 'ratio-item--warning': overview.gradeDistribution[grade]?.isOverLimit }"
              >
                <span class="ratio-item__grade">{{ GRADE_LABELS[grade] }}</span>
                <span class="ratio-item__value">
                  {{ gradeCounts[grade] }} 人
                  <template v-if="distTotal > 0">
                    · {{ ((gradeCounts[grade] / distTotal) * 100).toFixed(1) }}%
                  </template>
                </span>
                <span v-if="overview.gradeDistribution[grade]?.isOverLimit" class="ratio-item__warn">
                  超上限
                </span>
              </div>
            </div>
          </ChartCard>

          <ChartCard class="approval-view__overview-card">
            <template #title>审批进度</template>
            <div class="progress-grid">
              <div class="progress-cell">
                <span class="progress-cell__num">{{ overview.ownPending }}</span>
                <span class="progress-cell__label">待我审批</span>
              </div>
              <div class="progress-cell">
                <span class="progress-cell__num">{{ overview.ownTotal }}</span>
                <span class="progress-cell__label">我的审批范围</span>
              </div>
              <div class="progress-cell">
                <span class="progress-cell__num">{{ overview.cyclePending }}</span>
                <span class="progress-cell__label">全周期待审批</span>
              </div>
            </div>
            <template v-if="overview.rejects.length > 0">
              <p class="reject-list__title">最近退回记录</p>
              <div class="reject-list">
                <div v-for="(r, idx) in overview.rejects" :key="idx" class="reject-item">
                  <div class="reject-item__head">
                    <span class="reject-item__name">{{ r.employeeName }}</span>
                    <el-tag size="small" :type="r.nodeType === 'approval' ? 'danger' : 'warning'">
                      {{ r.nodeType === 'approval' ? '审批退回' : '校准驳回' }}
                    </el-tag>
                    <span class="reject-item__meta">
                      {{ r.actorName ?? '系统' }} · {{ formatDateTime(r.createdAt) }}
                    </span>
                  </div>
                  <p v-if="r.comment" class="reject-item__comment">{{ r.comment }}</p>
                </div>
              </div>
            </template>
            <EmptyState v-else description="暂无退回记录" />
          </ChartCard>
        </div>
        <el-table
          class="app-table"
          v-loading="loading"
          :data="tasks"
          row-key="id"
          @selection-change="onSelectionChange"
        >
          <el-table-column
            v-if="canOperateApproval"
            type="selection"
            width="50"
            reserve-selection
            :selectable="isTaskSelectable"
          />
          <el-table-column prop="employeeName" label="员工" min-width="120" />
          <el-table-column prop="position" label="岗位" min-width="120" />
          <el-table-column prop="deptName" label="部门" min-width="160" show-overflow-tooltip />
          <el-table-column label="总分" width="100">
            <template #default="{ row }">
              {{ row.totalScore.toFixed(2) }}
            </template>
          </el-table-column>
          <el-table-column label="最终等级" width="100">
            <template #default="{ row }">
              <GradeTag :grade="row.rawGrade" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="状态" width="140">
            <template #default="{ row }">
              <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column v-if="canOperateApproval" label="操作" width="160" fixed="right">
            <template #default="{ row }">
              <template v-if="canOperateTask(row)">
                <el-button
                  link
                  type="primary"
                  size="small"
                  :loading="submitting"
                  @click="handleApproveSingleWithConfirm(row.id)"
                >
                  通过
                </el-button>
                <el-button
                  link
                  type="danger"
                  size="small"
                  :loading="submitting"
                  @click="handleRejectSingle(row.id)"
                >
                  退回
                </el-button>
              </template>
              <span v-else class="text-secondary">仅查看</span>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </ChartCard>

    <el-dialog
      v-model="rejectDialog.visible"
      title="退回绩效校准"
      width="520px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <p class="approval-view__reject-tip">
        退回后该任务将回到绩效校准环节，请填写审批意见。
      </p>
      <el-input
        v-model="rejectDialog.comment"
        type="textarea"
        :rows="4"
        placeholder="请输入审批意见（必填）"
        maxlength="500"
        show-word-limit
      />
      <template #footer>
        <el-button @click="rejectDialog.visible = false">取消</el-button>
        <el-button
          type="danger"
          :loading="submitting"
          @click="confirmReject"
        >
          确认退回
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.approval-view__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.approval-view__empty {
  padding: 24px 0;
}

.approval-view__readonly {
  margin: 0 0 12px;
}

.approval-view__reject-tip {
  margin: 0 0 16px;
  color: #606266;
  font-size: 14px;
}

.approval-view__overview {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}

@media (max-width: 1100px) {
  .approval-view__overview {
    grid-template-columns: 1fr;
  }
}

.ratio-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
}

.ratio-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.ratio-item__grade {
  font-weight: 600;
}

.ratio-item--warning {
  color: var(--el-color-danger);
}

.ratio-item__warn {
  font-size: 12px;
  padding: 0 6px;
  border: 1px solid currentColor;
  border-radius: 4px;
}

.progress-grid {
  display: flex;
  gap: 24px;
  padding: 8px 0 4px;
}

.progress-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.progress-cell__num {
  font-size: 24px;
  font-weight: 600;
  color: var(--el-color-primary);
}

.progress-cell__label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.reject-list__title {
  margin: 14px 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-regular);
}

.reject-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 220px;
  overflow-y: auto;
}

.reject-item {
  padding: 8px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

.reject-item__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.reject-item__name {
  font-weight: 600;
  font-size: 13px;
}

.reject-item__meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.reject-item__comment {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
}
</style>
