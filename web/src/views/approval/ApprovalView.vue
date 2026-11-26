<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
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
import PerformanceRecordFilters from '@/components/common/PerformanceRecordFilters.vue';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import { departmentsApi } from '@/api/departments.api';
import type { ApprovalOverview, ApprovalTaskView, AssessmentCycle, Department, TaskDetail } from '@/types/api.types';
import { resolvePerformanceCycleByCreatedAt } from '@/utils/performance-cycle';
import { useAuthStore } from '@/stores/auth.store';
import { useVisibleRefresh } from '@/composables/useVisibleRefresh';
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
const departments = ref<Department[]>([]);
const deptFilter = ref('');
const keywordFilter = ref('');
const tasks = ref<ApprovalTaskView[]>([]);
const overview = ref<ApprovalOverview | null>(null);
const loading = ref(false);
const listError = ref('');
const submitting = ref(false);
const selectedTaskIds = ref<string[]>([]);
const page = ref(1);
const pageSize = ref(10);
const detailDrawer = ref({ visible: false, loading: false, taskId: '', error: '', detail: null as TaskDetail | null });
const approvalReady = ref(false), accessDenied = ref(false), confirming = ref(false);
const appliedFilters = ref('');
const filterKey = () => JSON.stringify([deptFilter.value, keywordFilter.value.trim()]);
const refreshBlocked = () => loading.value || submitting.value || confirming.value || hasSelection.value
  || rejectDialog.value.visible || detailDrawer.value.visible || appliedFilters.value !== filterKey();
let listRequest = 0;
let detailRequest = 0;
let initRequest = 0;

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
  taskIds: [] as string[],
  comment: '',
});
const rejectError = ref('');

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

async function loadCycles(canApply = () => true) {
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
    if (canApply()) cycles.value = [...new Map(items.map(cycle => [cycle.id, cycle])).values()];
}

async function normalizeApprovalCycle() {
  const requestedCycleId = typeof route.query.cycleId === 'string'
    ? route.query.cycleId
    : undefined;
  const resolved = resolvePerformanceCycleByCreatedAt(cycles.value, requestedCycleId);
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
    taskIds: [],
    comment: '',
  };
  rejectError.value = '';
}

async function selectApprovalCycle(cycleId: string) {
  if (!cycleId || cycleId === selectedCycleId.value) return;
  await router.push({ query: { ...route.query, cycleId } });
}

async function loadTasks() {
  accessDenied.value = false;
  return fetchTasks(false);
}
async function fetchTasks(background: boolean, canApply = () => true) {
  if (background && refreshBlocked()) return;
  const request = ++listRequest;
  const cycleId = selectedCycleId.value;
  const filters = filterKey();
  if (!background) { listError.value = ''; appliedFilters.value = filters; }
  if (!selectedCycleId.value) {
    tasks.value = [];
    overview.value = null;
    loading.value = false;
    return;
  }
  if (!background) loading.value = true;
  const current = () => request === listRequest && cycleId === selectedCycleId.value && filters === filterKey()
    && (!background || (canApply() && !refreshBlocked()));
  try {
    const [list, overviewData] = await Promise.all([
      approvalApi.getApprovalList(cycleId, {
        deptId: deptFilter.value || undefined,
        keyword: keywordFilter.value.trim() || undefined,
      }),
      approvalApi.getOverview(cycleId),
    ]);
    if (!current()) return;
    tasks.value = list;
    overview.value = overviewData;
    listError.value = '';
    if (!background) page.value = Math.min(page.value, Math.max(1, Math.ceil(list.length / pageSize.value)));
  } catch (error) {
    if (request !== listRequest || cycleId !== selectedCycleId.value) return;
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 401 || status === 403) { accessDenied.value = true; clearApprovalState(); loading.value = false; }
    else if (!current()) return;
    else if (!background) { tasks.value = []; overview.value = null; }
    listError.value = readErrorMessage(error);
  } finally {
    if (!background && request === listRequest) loading.value = false;
  }
}

function refreshList() {
  selectedTaskIds.value = [];
  if (!approvalReady.value) void initializeApproval(); else void loadTasks();
}

watch(
  () => route.query.cycleId,
  async (cycleId) => {
    if (!approvalReady.value) return;
    const requestedCycleId = typeof cycleId === 'string' ? cycleId : undefined;
    const resolved = resolvePerformanceCycleByCreatedAt(cycles.value, requestedCycleId);
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

async function initializeApproval() {
  const request = ++initRequest;
  approvalReady.value = false; accessDenied.value = false; loading.value = true;
  const current = () => request === initRequest;
  try {
    await Promise.all([
    loadCycles(current),
    departmentsApi.findAll({ isActive: true, pageSize: 1000 })
      .then((items) => { if (current()) departments.value = items; })
      .catch(() => { if (current()) departments.value = []; }),
  ]);
  if (!current()) return;
  await normalizeApprovalCycle();
  if (!current()) return;
  approvalReady.value = true;
  await loadTasks();
  } catch (error) {
    if (!current()) return;
    listError.value = `考核周期读取失败：${readErrorMessage(error)}`;
    const status = (error as { response?: { status?: number } })?.response?.status;
    accessDenied.value = status === 401 || status === 403;
  } finally { if (current()) loading.value = false; }
}
onMounted(initializeApproval);
onUnmounted(() => { listRequest++; detailRequest++; initRequest++; });
watch(() => [auth.user?.id, auth.user?.sysRole, JSON.stringify(auth.user?.hrCapabilities)], () => {
  clearApprovalState(); cycles.value = []; departments.value = [];
  if (auth.user) void initializeApproval(); else { initRequest++; approvalReady.value = false; loading.value = false; }
});
useVisibleRefresh({ enabled: () => Boolean(auth.user) && approvalReady.value && Boolean(selectedCycleId.value) && !accessDenied.value,
  blocked: refreshBlocked, refresh: guard => fetchTasks(true, guard) });

function searchApproval() {
  page.value = 1;
  void loadTasks();
}

async function resetApprovalFilters() {
  deptFilter.value = '';
  keywordFilter.value = '';
  page.value = 1;
  const latestCycleId = cycles.value[0]?.id ?? '';
  if (latestCycleId && latestCycleId !== selectedCycleId.value) {
    await selectApprovalCycle(latestCycleId);
  } else {
    await loadTasks();
  }
}

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
    if (detailDrawer.value.taskId === taskId) closeDetail();
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

async function doBatchReject(comment: string): Promise<boolean> {
  if (rejectDialog.value.taskIds.length === 0) return false;
  submitting.value = true;
  let successCount = 0;
  const failedIds: string[] = [];
  try {
    for (const taskId of rejectDialog.value.taskIds) {
      try {
        await approvalApi.rejectTask(taskId, { comment });
        successCount++;
      } catch (e) {
        failedIds.push(taskId);
      }
    }
    rejectDialog.value.taskIds = failedIds;
    if (failedIds.length === 0) {
      ElMessage.success(`批量退回成功，共 ${successCount} 条`);
    } else {
      rejectError.value = `已退回 ${successCount} 条，仍有 ${failedIds.length} 条失败。请核对后重试剩余任务。`;
    }
    void loadTasks();
    return failedIds.length === 0;
  } finally {
    submitting.value = false;
  }
}

function openRejectDialog(options: { taskId?: string }) {
  rejectDialog.value = {
    visible: true,
    mode: options.taskId ? 'single' : 'batch',
    taskId: options.taskId,
    taskIds: options.taskId ? [options.taskId] : [...selectedTaskIds.value],
    comment: '',
  };
  rejectError.value = '';
}

async function confirmReject() {
  const comment = rejectDialog.value.comment.trim();
  if (!comment) {
    rejectError.value = '请填写退回原因';
    return;
  }
  rejectError.value = '';

  if (rejectDialog.value.mode === 'single' && rejectDialog.value.taskId) {
    submitting.value = true;
    try {
      await approvalApi.rejectTask(rejectDialog.value.taskId, { comment });
      ElMessage.success('已退回绩效校准');
      if (detailDrawer.value.taskId === rejectDialog.value.taskId) closeDetail();
      rejectDialog.value.visible = false;
      refreshList();
    } catch (error) {
      rejectError.value = readErrorMessage(error);
    } finally {
      submitting.value = false;
    }
  } else {
    if (await doBatchReject(comment)) rejectDialog.value.visible = false;
  }
}

async function handleApproveSingleWithConfirm(taskId: string) {
  if (confirming.value || submitting.value) return;
  confirming.value = true;
  try {
    await ElMessageBox.confirm('确认通过该员工的绩效结果？', '确认通过', {
      confirmButtonText: '通过',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch {
    confirming.value = false;
    return;
  }
  try {
    await handleApproveSingle(taskId);
  } catch (error) {
    ElMessage.error(readErrorMessage(error));
  } finally {
    confirming.value = false;
  }
}

async function handleBatchApproveWithConfirm() {
  if (confirming.value || submitting.value) return;
  confirming.value = true;
  try {
    await ElMessageBox.confirm(
      `确认批量通过选中的 ${selectedTaskIds.value.length} 条绩效结果？`,
      '确认批量通过',
      { confirmButtonText: '批量通过', cancelButtonText: '取消', type: 'warning' },
    );
    await handleBatchApprove();
  } catch {
    // 用户取消，不处理
  } finally {
    confirming.value = false;
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
  <BusinessListPage variant="workflow" :loading="loading" class="approval-view performance-result-page">
    <template #workspace>
    <ChartCard :padded="true" class="list-result-card">
      <PerformanceRecordFilters
        :cycle-id="selectedCycleId"
        v-model:dept-id="deptFilter"
        v-model:keyword="keywordFilter"
        :cycles="cycles"
        :departments="departments"
        cycle-test-id="approval-cycle-select"
        :loading="loading"
        @update:cycle-id="selectApprovalCycle"
        @search="searchApproval"
        @reset="resetApprovalFilters"
      />
      <div v-if="canOperateApproval" class="approval-view__bulk-actions performance-result-actions">
          <el-button
            type="primary"
            :disabled="!hasSelection"
            :loading="submitting"
            @click="handleBatchApproveWithConfirm"
          >
            批量通过
          </el-button>
          <el-button
            type="danger"
            plain
            :disabled="!hasSelection"
            :loading="submitting"
            @click="handleBatchReject"
          >
            批量退回
          </el-button>
      </div>

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
          description="你可以查看审批结果，但只有任务指定的分管领导可以通过或退回。"
          show-icon
        />

        <details v-if="overview" class="approval-view__overview-disclosure">
          <summary>审批依据 · 待我审批 {{ overview.ownPending }} 人 · 全周期待审批 {{ overview.cyclePending }} 人 · 查看分布与退回记录</summary>
        <div class="approval-view__overview">
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
        </details>
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
      <template #footer>
        <el-button v-if="detailDrawer.detail && canOperateTask(detailDrawer.detail)" :loading="submitting" @click="handleRejectSingle(detailDrawer.detail.id)">退回绩效校准</el-button>
        <el-button v-if="detailDrawer.detail && canOperateTask(detailDrawer.detail)" type="primary" :loading="submitting" @click="handleApproveSingleWithConfirm(detailDrawer.detail.id)">通过绩效结果</el-button>
        <el-button @click="detailDrawer.visible = false">关闭</el-button>
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
      <el-form label-position="top"><el-form-item label="退回原因" required :error="rejectError === '请填写退回原因' ? rejectError : ''">
        <el-input v-model="rejectDialog.comment" type="textarea" :rows="4" aria-label="退回原因" placeholder="请说明需重新校准的内容" maxlength="500" show-word-limit @input="rejectError = ''" />
      </el-form-item></el-form>
      <p v-if="rejectError && rejectError !== '请填写退回原因'" role="alert" class="approval-view__load-error">{{ rejectError }}</p>
      <template #footer>
        <el-button :disabled="submitting" @click="rejectDialog.visible = false">取消</el-button>
        <el-button
          type="danger"
          :loading="submitting"
          @click="confirmReject"
        >
          退回绩效校准
        </el-button>
      </template>
    </el-dialog>
    </template>
  </BusinessListPage>
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
