<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { approvalApi } from '@/api/approval.api';
import { cyclesApi } from '@/api/cycles.api';
import { tasksApi } from '@/api/tasks.api';
import GradeTag from '@/components/common/GradeTag.vue';
import PerformanceResultEvidence from '@/components/common/PerformanceResultEvidence.vue';
import PerformanceResultSummary from '@/components/common/PerformanceResultSummary.vue';
import PerformanceResultDrawer from '@/components/common/PerformanceResultDrawer.vue';
import { resultStage } from '@/utils/performance-result-presentation';
import GradeDistChart from '@/components/charts/GradeDistChart.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import type { ApprovalOverview, ApprovalTaskView, AssessmentCycle, TaskDetail } from '@/types/api.types';
import { resolvePerformanceCycle } from '@/utils/performance-cycle';
import { useAuthStore } from '@/stores/auth.store';
import { type PerfGrade } from '@/types/enums';
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
const listError = ref('');
const submitting = ref(false);
const selectedTaskIds = ref<string[]>([]);
const page = ref(1);
const pageSize = ref(10);
const detailDrawer = ref({ visible: false, loading: false, taskId: '', error: '', detail: null as TaskDetail | null });
let approvalReady = false;
let listRequest = 0;
let detailRequest = 0;

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
const pagedTasks = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return tasks.value.slice(start, start + pageSize.value);
});

watch(pageSize, () => { page.value = 1; });

function formatScore(score?: number | null): string {
  return score == null ? '—' : score.toFixed(2);
}

function canViewTaskDetail(task: unknown): boolean {
  const approvalTask = task as Pick<ApprovalTaskView, 'employeeId' | 'status' | 'approvedAt'>;
  return Boolean(auth.user && approvalTask.employeeId && (approvalTask.employeeId !== auth.user.id
    || (approvalTask.status === 'approval' && approvalTask.approvedAt)
    || ['published', 'confirmed', 'appealing', 'closed'].includes(approvalTask.status)));
}

function readErrorMessage(error: unknown): string {
  const responseMessage = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(responseMessage) ? responseMessage.join('；')
    : responseMessage || (error instanceof Error ? error.message : '读取失败，请重试');
}

function closeDetail() {
  detailRequest++;
  detailDrawer.value = { visible: false, loading: false, taskId: '', error: '', detail: null };
}

async function openDetail(taskId: string) {
  const task = tasks.value.find((item) => item.id === taskId);
  if (!task || !canViewTaskDetail(task) || task.cycleId !== selectedCycleId.value) return;
  const cycleId = selectedCycleId.value;
  const request = ++detailRequest;
  detailDrawer.value = { visible: true, loading: true, taskId, error: '', detail: null };
  try {
    const detail = await tasksApi.findOne(taskId);
    if (request !== detailRequest || cycleId !== selectedCycleId.value || !detailDrawer.value.visible) return;
    if (!detail || detail.id !== taskId || detail.cycleId !== cycleId) {
      throw new Error('任务详情与当前考核周期不一致，请重试');
    }
    if (!canViewTaskDetail(detail)) throw new Error('本人结果审批通过后可查看');
    detailDrawer.value.detail = detail;
  } catch (error) {
    if (request !== detailRequest || cycleId !== selectedCycleId.value) return;
    detailDrawer.value.error = readErrorMessage(error);
  } finally {
    if (request === detailRequest) detailDrawer.value.loading = false;
  }
}

async function loadCycles() {
  try {
    // Retained records remain reachable after cycle closure; server scope stays unchanged.
    const items: AssessmentCycle[] = [];
    for (const group of ['active', 'finished'] as const) {
      let page = 1;
      while (true) {
        const res = await cyclesApi.findAll({ group, page, pageSize: 100 });
        items.push(...res.items);
        if (page * 100 >= res.total || res.items.length < 100) break;
        page++;
      }
    }
    cycles.value = [...new Map(items.map(cycle => [cycle.id, cycle])).values()];
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
  listRequest++;
  closeDetail();
  tasks.value = [];
  overview.value = null;
  listError.value = '';
  selectedTaskIds.value = [];
  page.value = 1;
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
  const request = ++listRequest;
  const cycleId = selectedCycleId.value;
  listError.value = '';
  if (!selectedCycleId.value) {
    tasks.value = [];
    overview.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const [list, overviewData] = await Promise.all([
      approvalApi.getApprovalList(cycleId),
      approvalApi.getOverview(cycleId),
    ]);
    if (request !== listRequest || cycleId !== selectedCycleId.value) return;
    tasks.value = list;
    overview.value = overviewData;
    page.value = Math.min(page.value, Math.max(1, Math.ceil(list.length / pageSize.value)));
  } catch (error) {
    if (request !== listRequest || cycleId !== selectedCycleId.value) return;
    tasks.value = [];
    overview.value = null;
    listError.value = readErrorMessage(error);
  } finally {
    if (request === listRequest) loading.value = false;
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
  selectedTaskIds.value = rows.filter(canOperateTask).map((r) => r.id);
}

function toggleMobileSelection(item: ApprovalTaskView, checked: boolean) {
  if (!canOperateTask(item)) return;
  const selected = new Set(selectedTaskIds.value);
  if (checked) selected.add(item.id); else selected.delete(item.id);
  selectedTaskIds.value = [...selected];
}

function canOperateTask(task: unknown): boolean {
  const approvalTask = task as ApprovalTaskView;
  return Boolean(
    auth.user
    && approvalTask.status === 'approval'
    && !approvalTask.approvedAt
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
  <div class="approval-view page-stack performance-result-page">
    <ChartCard :padded="true" class="list-result-card">
      <template #title>结果审批</template>
      <template #extra>
        <div class="approval-view__toolbar performance-result-toolbar">
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
        <div v-if="listError" class="approval-view__load-error" role="alert">
          <span>{{ listError }}</span>
          <el-button @click="loadTasks">重试</el-button>
        </div>
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
          <ChartCard :padded="true" class="approval-view__overview-card">
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

          <ChartCard :padded="true" class="approval-view__overview-card">
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
        <div class="desktop-result-table">
        <el-table
          class="app-table performance-result-table"
          v-loading="loading"
          :data="pagedTasks"
          row-key="id"
          @selection-change="onSelectionChange"
        >
          <el-table-column
            v-if="canOperateApproval"
            type="selection"
            width="50"
            :selectable="isTaskSelectable"
          />
          <el-table-column prop="employeeName" label="员工" min-width="150" show-overflow-tooltip>
            <template #default="{ row }"><div class="performance-result-employee"><div>{{ row.employeeName }}</div><div class="performance-result-meta">{{ row.employeeNo || '—' }}</div></div></template>
          </el-table-column>
          <el-table-column prop="deptName" label="部门" min-width="130" show-overflow-tooltip />
          <el-table-column prop="position" label="岗位" min-width="130" show-overflow-tooltip />
          <el-table-column label="周期得分" width="110" align="right">
            <template #default="{ row }">
              <span class="performance-result-score">{{ formatScore(row.totalScore) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="周期等级" width="100" align="center">
            <template #default="{ row }">
              <GradeTag :grade="row.calibratedGrade ?? row.rawGrade" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="当前环节" min-width="150">
            <template #default="{ row }">
              <el-tag :type="resultStage(row.status, row.approvedAt, row.publishedAt ?? null).type" size="small">
                {{ resultStage(row.status, row.approvedAt, row.publishedAt ?? null).label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <div class="performance-result-actions">
              <el-button v-if="canViewTaskDetail(row)" link type="primary" @click="openDetail(row.id)">查看详情</el-button>
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
              <span v-if="!canViewTaskDetail(row)" class="text-secondary">审批通过后可查看</span>
              </div>
            </template>
          </el-table-column>
        </el-table>
        </div>
        <div v-loading="loading" class="mobile-result-list approval-mobile-list">
          <MobileResultCard v-for="item in pagedTasks" :key="item.id">
            <template #title>
              <el-checkbox v-if="canOperateApproval" :model-value="selectedTaskIds.includes(item.id)" :disabled="!canOperateTask(item)" @change="toggleMobileSelection(item, Boolean($event))">{{ item.employeeName }} · {{ item.employeeNo || '—' }}</el-checkbox>
              <span v-else>{{ item.employeeName }} · {{ item.employeeNo || '—' }}</span>
            </template>
            <template #status><el-tag :type="resultStage(item.status, item.approvedAt, item.publishedAt ?? null).type" size="small">{{ resultStage(item.status, item.approvedAt, item.publishedAt ?? null).label }}</el-tag></template>
            <div class="mobile-result-field"><span class="mobile-result-field__label">部门 / 岗位</span><span class="mobile-result-field__value">{{ item.deptName || '—' }} · {{ item.position || '—' }}</span></div>
            <div class="mobile-result-field"><span class="mobile-result-field__label">周期结果</span><span class="mobile-result-field__value">{{ formatScore(item.totalScore) }} · {{ item.calibratedGrade ?? item.rawGrade ?? '—' }}</span></div>
            <template #actions>
              <el-button v-if="canViewTaskDetail(item)" link type="primary" @click="openDetail(item.id)">查看详情</el-button>
              <el-button v-if="canOperateTask(item)" link type="primary" :loading="submitting" @click="handleApproveSingleWithConfirm(item.id)">通过</el-button>
              <el-button v-if="canOperateTask(item)" link type="danger" :loading="submitting" @click="handleRejectSingle(item.id)">退回</el-button>
              <span v-if="!canViewTaskDetail(item)" class="text-secondary">审批通过后可查看</span>
            </template>
          </MobileResultCard>
        </div>
        <ListPagination v-model:current-page="page" v-model:page-size="pageSize" :total="tasks.length" />
      </template>
    </ChartCard>

    <PerformanceResultDrawer
      v-model="detailDrawer.visible"
      :title="detailDrawer.detail ? `${detailDrawer.detail.employeeName} · 结果审批` : '结果审批详情'"
      data-testid="approval-detail-drawer"
      @close="closeDetail"
    >
      <el-skeleton v-if="detailDrawer.loading" :rows="8" animated />
      <div v-else-if="detailDrawer.error" class="approval-view__load-error" role="alert">
        <span>{{ detailDrawer.error }}</span>
        <el-button @click="openDetail(detailDrawer.taskId)">重试</el-button>
      </div>
      <template v-else-if="detailDrawer.detail">
        <PerformanceResultSummary
          score-hint="分数与等级无换算关系"
          class="approval-view__detail-summary"
          :cycle-name="detailDrawer.detail.cycleName || selectedCycle?.name"
          :employee-name="detailDrawer.detail.employeeName || '—'"
          :status-label="resultStage(detailDrawer.detail.status, detailDrawer.detail.approvedAt, detailDrawer.detail.publishedAt ?? null).label"
          :status-type="resultStage(detailDrawer.detail.status, detailDrawer.detail.approvedAt, detailDrawer.detail.publishedAt ?? null).type"
          :department-name="detailDrawer.detail.deptName"
          :position="detailDrawer.detail.position"
          :manager-name="detailDrawer.detail.managerName"
          :score="(detailDrawer.detail.gradeResult?.calculatedScore) ?? null"
          :raw-grade="(detailDrawer.detail.gradeResult?.rawGrade) ?? null"
          :calibrated-grade="(detailDrawer.detail.gradeResult?.calibratedGrade) ?? null"
        />
        <PerformanceResultEvidence :evidence="detailDrawer.detail.resultEvidence" :records="detailDrawer.detail.flowRecords" />
      </template>
    </PerformanceResultDrawer>

    <el-dialog
      v-model="rejectDialog.visible"
      title="退回绩效校准"
      width="min(520px, calc(100vw - 32px))"
      class="performance-result-dialog"
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
.approval-view__load-error {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  color: var(--el-color-danger);
  overflow-wrap: anywhere;
}

.approval-view__detail-summary {
  margin-bottom: 20px;
  overflow-wrap: anywhere;
}

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
