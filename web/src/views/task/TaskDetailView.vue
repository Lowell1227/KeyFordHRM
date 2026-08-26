<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ArrowLeft } from '@element-plus/icons-vue';
import { useTaskStore } from '@/stores/task.store';
import { tasksApi } from '@/api/tasks.api';
import { cyclesApi } from '@/api/cycles.api';
import { useTaskFlow } from '@/composables/useTaskFlow';
import { usePermission } from '@/composables/usePermission';
import IndicatorSnapshot, { type ActualValueItem } from './components/IndicatorSnapshot.vue';
import PerformanceReferencePanel from './components/PerformanceReferencePanel.vue';
import ExemptView from './components/ExemptView.vue';
import ScoreMask from './components/ScoreMask.vue';
import InterviewCard from './components/InterviewCard.vue';
import SignBlock from '@/components/common/SignBlock.vue';
import GradeTag from '@/components/common/GradeTag.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import { useAuthStore } from '@/stores/auth.store';
import { formatScore } from '@/utils/score';
import type { AssessmentCycle, TaskDetail, SetIndicatorBody, SubmitSelfEvalBody } from '@/types/api.types';
import type { SignatureRole } from '@/types/enums';
import { TASK_STATUS_META } from '@/types/enums';
import {
  TASK_STATUS_STAGE,
  getTaskStageStateForStatus,
  type TaskStageKey,
  type TaskStageState,
} from './task-stage';

const route = useRoute();
const router = useRouter();
const taskStore = useTaskStore();
const authStore = useAuthStore();
const PERFORMANCE_REFERENCE_ENABLED = false;

const cycle = ref<AssessmentCycle | null>(null);
const cycleLoading = ref(false);
const actionLoading = ref(false);
const reminding = ref(false);
const indicatorSnapshotRef = ref<{ clearSelfEvalDraft: () => void } | null>(null);

const task = computed(() => taskStore.detail);
const loading = computed(() => taskStore.loading || cycleLoading.value);
const workflowContext = computed(() => {
  const current = task.value;
  return current?.workflowContext ?? {
    stage: 'goal_setting' as const,
    statusLabel: current ? TASK_STATUS_META[current.status].label : '-',
    currentHandler: null,
    currentDeadline: null,
    canRemind: false,
    reminderNodeType: null,
    reminderAvailableAt: null,
  };
});

const flow = useTaskFlow({ task, cycle });
const permission = usePermission({ task, cycle });

const flowActions = computed(() => flow.actions.value);

const performanceStageLabels: Record<TaskStageKey, string> = {
  'goal-setting': '目标制定',
  'goal-confirmation': '目标确认',
  'self-eval': '自评',
  result: '结果确认',
};

const performanceStageCardTitles: Record<TaskStageKey, string> = {
  'goal-setting': '考核指标',
  'goal-confirmation': '指标确认',
  'self-eval': '员工自评',
  result: '结果信息',
};

function asTaskStage(value: unknown): TaskStageKey | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' && Object.prototype.hasOwnProperty.call(performanceStageLabels, raw)
    ? raw as TaskStageKey
    : null;
}

function safeTaskListReturnTo(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || !raw.startsWith('/tasks')) return null;
  try {
    const parsed = new URL(raw, window.location.origin);
    return parsed.pathname === '/tasks' ? `${parsed.pathname}${parsed.search}` : null;
  } catch {
    return null;
  }
}

const currentPerformanceStage = computed<TaskStageKey | null>(() => {
  const status = task.value?.status;
  return status ? TASK_STATUS_STAGE[status] : null;
});

const requestedPerformanceStage = computed<TaskStageKey>(() =>
  asTaskStage(route.query.stage) ?? currentPerformanceStage.value ?? 'goal-setting',
);

const performanceStageTitle = computed(() => performanceStageLabels[requestedPerformanceStage.value]);
const performanceStageCardTitle = computed(() => performanceStageCardTitles[requestedPerformanceStage.value]);
const performanceStageState = computed<TaskStageState>(() => {
  const status = task.value?.status;
  return status
    ? getTaskStageStateForStatus(status, requestedPerformanceStage.value)
    : 'not-started';
});
const performanceStageStateLabel = computed(() => {
  if (task.value?.isExempt && requestedPerformanceStage.value === 'result') return '已豁免';
  return {
    pending: '待处理',
    progress: '处理中',
    completed: '已完成',
    'not-started': '未开始',
  }[performanceStageState.value];
});
const isCurrentPerformanceStage = computed(() =>
  requestedPerformanceStage.value === currentPerformanceStage.value,
);
const showPerformanceStageContent = computed(() => performanceStageState.value !== 'not-started');

const performanceCycleName = computed(() => task.value?.cycleName || cycle.value?.name || '本期绩效');
const employeeInitial = computed(() => (task.value?.employeeName || '绩').slice(0, 1));
const employeeMeta = computed(() => {
  const current = task.value;
  if (!current) return [];
  return [
    current.employeeNo ? `工号 ${current.employeeNo}` : '',
    current.deptName || '',
    current.managerName ? `直属主管 ${current.managerName}` : '',
  ].filter(Boolean);
});

const canEditIndicators = computed(() => {
  const t = task.value;
  if (
    !t
    || t.isExempt
    || requestedPerformanceStage.value !== 'goal-setting'
    || !isCurrentPerformanceStage.value
  ) return false;
  if (t.status === 'indicator_drafting') {
    return permission.isTaskSelf.value || permission.isAdminLike.value;
  }
  if (t.status === 'indicator_reviewing') {
    return permission.isTaskManager.value || permission.isAdminLike.value;
  }
  if (t.status === 'indicator_setting') {
    return permission.isTaskSelf.value || permission.isTaskManager.value || permission.isAdminLike.value;
  }
  return false;
});

const indicatorSaveLabel = computed(() => {
  if (permission.isTaskSelf.value) return '提交主管审核';
  return '审核通过';
});

const indicatorSubmitLabel = computed(() => indicatorSaveLabel.value);
const splitIndicatorSaveActions = computed(() => canEditIndicators.value);
const canRejectIndicators = computed(() => {
  const t = task.value;
  if (!t || t.isExempt || !isCurrentPerformanceStage.value) return false;
  if (t.status === 'indicator_reviewing') return permission.isTaskManager.value || permission.isAdminLike.value;
  if (t.status === 'indicator_confirming') return permission.isTaskSelf.value;
  return false;
});
const rejectIndicatorLabel = computed(() =>
  task.value?.status === 'indicator_confirming' ? '退回修改' : '退回员工修改',
);

const showResultView = computed(() => {
  return requestedPerformanceStage.value === 'result' && showPerformanceStageContent.value;
});

const reminderOnCooldown = computed(() => {
  const value = workflowContext.value.reminderAvailableAt;
  return Boolean(value && new Date(value).getTime() > Date.now());
});

/**
 * 当前登录用户在该考核表上的签字角色位，按真实身份判定（非粗角色门）：
 * 被考核人=任务员工本人 / 考核人=任务主管本人 / HR=HR或系统管理员。
 * 旁观者（部门负责人、分管总等）返回 null，仅查看签字状态、无签字按钮。
 */
const signatureRole = computed<SignatureRole | null>(() => {
  const t = task.value;
  const uid = authStore.user?.id;
  if (!t || !uid) return null;
  if (t.employeeId === uid) return 'assessee';
  if (t.managerId === uid) return 'assessor';
  if (authStore.user?.sysRole === 'hr' || authStore.user?.sysRole === 'system_admin') return 'hr';
  return null;
});

async function loadCycle(taskDetail?: TaskDetail | null) {
  const t = taskDetail ?? task.value;
  if (!t?.cycleId) return;
  cycleLoading.value = true;
  try {
    cycle.value = await cyclesApi.findOne(t.cycleId);
  } catch {
    cycle.value = null;
  } finally {
    cycleLoading.value = false;
  }
}

async function loadDetail() {
  const id = route.params.id as string;
  await taskStore.fetchDetail(id);
  if (taskStore.detail) {
    await loadCycle(taskStore.detail);
  }
}

onMounted(() => {
  loadDetail();
});

watch(
  () => route.params.id,
  () => {
    if (route.name === 'TaskDetail') {
      loadDetail();
    }
  },
);

function goBack() {
  router.push(safeTaskListReturnTo(route.query.returnTo) ?? { name: 'MyTasks' });
}

async function handleConfirmIndicators() {
  const id = task.value?.id;
  if (!id) return;
  actionLoading.value = true;
  try {
    await tasksApi.confirmIndicators(id);
    ElMessage.success('指标确认成功');
    await loadDetail();
  } finally {
    actionLoading.value = false;
  }
}

async function handleRejectIndicators(reason: string) {
  const id = task.value?.id;
  if (!id) return;
  actionLoading.value = true;
  try {
    await tasksApi.rejectIndicators(id, { comment: reason });
    ElMessage.success('指标已退回');
    await loadDetail();
  } finally {
    actionLoading.value = false;
  }
}

async function handleSaveIndicators(body: Omit<SetIndicatorBody, 'expectedUpdatedAt'>) {
  const currentTask = task.value;
  const id = currentTask?.id;
  if (!id || !currentTask.updatedAt) return;
  if (!body.instances.length) {
    ElMessage.warning('请至少保留一条指标');
    return;
  }
  actionLoading.value = true;
  try {
    const beforeStatus = task.value?.status;
    const wasSelf = permission.isTaskSelf.value;
    const savedTask = await tasksApi.setIndicators(id, {
      ...body,
      expectedUpdatedAt: currentTask.updatedAt,
    });
    if (body.action === 'save') {
      ElMessage.success('指标已保存');
      await loadDetail();
      return;
    }
    ElMessage.success(
      wasSelf
        ? '指标已提交主管审核'
        : savedTask.status === 'indicator_confirming' || beforeStatus === 'indicator_reviewing'
          ? '指标已审核通过，等待员工确认'
          : '指标已提交',
    );
    await loadDetail();
  } finally {
    actionLoading.value = false;
  }
}
async function handleSubmitSelfEval(body: SubmitSelfEvalBody, actualValues: ActualValueItem[]) {
  const id = task.value?.id;
  if (!id) return;
  actionLoading.value = true;
  let actualValuesSaved = false;
  try {
    if (actualValues.length > 0) {
      await tasksApi.updateActualValues(id, { indicators: actualValues }, { skipErrorMessage: true });
      actualValuesSaved = true;
    }
    await tasksApi.submitSelfEval(id, body, { skipErrorMessage: true });
    indicatorSnapshotRef.value?.clearSelfEvalDraft();
    ElMessage.success('自评提交成功');
    await loadDetail();
  } catch {
    ElMessage.error(
      actualValuesSaved
        ? '自评尚未提交，实际完成信息已保存，请稍后重试'
        : '自评尚未提交，当前设备草稿仍保留，请稍后重试',
    );
  } finally {
    actionLoading.value = false;
  }
}

async function handleConfirmResult() {
  const id = task.value?.id;
  if (!id) return;
  actionLoading.value = true;
  try {
    await tasksApi.confirmResult(id);
    ElMessage.success('结果确认成功');
    await loadDetail();
  } finally {
    actionLoading.value = false;
  }
}

async function handleRemind() {
  const id = task.value?.id;
  if (!id) return;
  reminding.value = true;
  try {
    await tasksApi.remindCurrentHandler(id);
    ElMessage.success('已催办当前处理人');
    await loadDetail();
  } finally {
    reminding.value = false;
  }
}
</script>

<template>
  <div
    v-loading="loading"
    class="performance-detail"
    data-testid="personal-performance-detail"
  >
    <template v-if="task">
      <header class="performance-detail__topbar">
        <el-button
          data-testid="task-detail-return"
          :icon="ArrowLeft"
          link
          aria-label="返回绩效待办"
          @click="goBack"
        />
        <div class="performance-detail__heading">
          <span data-testid="performance-stage-title">{{ performanceStageTitle }}</span>
          <small data-testid="performance-cycle-badge">{{ performanceCycleName }}</small>
        </div>
        <div class="performance-detail__topbar-actions">
          <el-button
            v-if="workflowContext.canRemind && isCurrentPerformanceStage"
            plain
            :loading="reminding"
            :disabled="reminderOnCooldown"
            @click="handleRemind"
          >
            {{ reminderOnCooldown ? '24小时内已催办' : '催办' }}
          </el-button>
          <span
            class="performance-stage-state"
            :class="`is-${performanceStageState}`"
            data-testid="performance-stage-state"
          >
            {{ performanceStageStateLabel }}
          </span>
        </div>
      </header>

      <section class="employee-summary" data-testid="performance-employee-summary">
        <div class="employee-summary__avatar">{{ employeeInitial }}</div>
        <div class="employee-summary__body">
          <div class="employee-summary__name-line">
            <strong>{{ task.employeeName || '绩效员工' }}</strong>
            <span>个人绩效</span>
          </div>
          <div v-if="employeeMeta.length" class="employee-summary__meta">
            <span v-for="item in employeeMeta" :key="item">{{ item }}</span>
          </div>
        </div>
      </section>

      <div
        class="performance-detail__workspace"
        :class="{ 'has-reference': PERFORMANCE_REFERENCE_ENABLED }"
      >
        <section class="performance-detail__main">
          <ChartCard
            v-if="!showPerformanceStageContent"
            class="stage-unavailable-card"
            data-testid="performance-stage-unavailable"
          >
            <template #title>{{ performanceStageCardTitle }}</template>
            <el-empty description="当前环节尚未开始" :image-size="72" />
          </ChartCard>

          <ExemptView v-else-if="task.isExempt" :task="task" />

          <IndicatorSnapshot
            v-else-if="requestedPerformanceStage !== 'result'"
            ref="indicatorSnapshotRef"
            :task-id="task.id"
            :title="performanceStageCardTitle"
            :instances="task.indicatorInstances"
            :can-edit="canEditIndicators"
            :can-confirm="requestedPerformanceStage === 'goal-confirmation' && isCurrentPerformanceStage && flowActions.canConfirmIndicator && !canEditIndicators"
            :can-reject="canRejectIndicators"
            confirm-label="确认指标"
            :reject-label="rejectIndicatorLabel"
            :dept-id="task.deptId"
            :employee-id="task.employeeId"
            :can-use-template="canEditIndicators"
            :flow-records="task.flowRecords"
            :loading="actionLoading"
            :save-label="indicatorSaveLabel"
            :submit-label="indicatorSubmitLabel"
            :split-save-actions="splitIndicatorSaveActions"
            :self-eval-mode="requestedPerformanceStage === 'self-eval'"
            :self-eval-readonly="!isCurrentPerformanceStage || !permission.canEditSelfEval.value"
            :self-eval-summary="task.selfEvalSummary"
            :self-eval-user-id="authStore.user?.id"
            @save="handleSaveIndicators"
            @confirm="handleConfirmIndicators"
            @reject="handleRejectIndicators"
            @submit-self-eval="handleSubmitSelfEval"
            @save-self-eval-draft="goBack"
          />

          <ChartCard v-if="showResultView" class="result-view">
            <template #title>结果信息</template>
            <template #extra v-if="permission.canConfirmResult.value && isCurrentPerformanceStage">
              <el-button type="primary" :loading="actionLoading" @click="handleConfirmResult">
                确认结果
              </el-button>
            </template>

            <el-descriptions :column="2" border size="small">
              <el-descriptions-item v-if="permission.canViewTotalScore.value" label="计算总分">
                {{ formatScore(task.gradeResult?.calculatedScore) }}
              </el-descriptions-item>
              <el-descriptions-item label="绩效等级">
                <template v-if="permission.canViewCalibration.value">
                  <GradeTag :grade="task.gradeResult?.calibratedGrade ?? task.gradeResult?.rawGrade" size="small" />
                </template>
                <ScoreMask v-else :message="permission.maskMessage.value" />
              </el-descriptions-item>
              <el-descriptions-item label="主管评语">
                <template v-if="permission.canViewManagerComment.value">
                  <div v-if="task.managerEvalSummary" class="manager-summary">
                    <div v-if="task.managerEvalSummary.strengths" class="manager-summary__block">
                      <div class="manager-summary__label">优势反馈</div>
                      <div class="manager-summary__content">{{ task.managerEvalSummary.strengths }}</div>
                    </div>
                    <div v-if="task.managerEvalSummary.improvements" class="manager-summary__block">
                      <div class="manager-summary__label">待改进项</div>
                      <div class="manager-summary__content">{{ task.managerEvalSummary.improvements }}</div>
                    </div>
                    <div v-if="task.managerEvalSummary.developmentPlan" class="manager-summary__block">
                      <div class="manager-summary__label">发展计划</div>
                      <div class="manager-summary__content">{{ task.managerEvalSummary.developmentPlan }}</div>
                    </div>
                    <div v-if="task.managerEvalSummary.attachments?.length" class="manager-summary__block">
                      <div class="manager-summary__label">附件</div>
                      <ul class="manager-summary__attachments">
                        <li v-for="att in task.managerEvalSummary.attachments" :key="att.url">
                          <a :href="att.url" target="_blank" rel="noopener">{{ att.name }}</a>
                        </li>
                      </ul>
                    </div>
                  </div>
                  <span v-else>-</span>
                </template>
                <ScoreMask v-else :message="permission.maskMessage.value" />
              </el-descriptions-item>
            </el-descriptions>

            <div v-if="!permission.isPublished.value" class="result-view__mask">
              <ScoreMask :message="permission.maskMessage.value" />
            </div>
          </ChartCard>

          <SignBlock
            v-if="requestedPerformanceStage === 'result' && ['published','confirmed','appealing','closed'].includes(task.status)"
            class="sign-block-card"
            business-type="assessment_task"
            :business-record-id="task.id"
            :role="signatureRole"
            title="考核表三方签字"
          />

          <InterviewCard
            v-if="requestedPerformanceStage === 'result' && ['published','confirmed','appealing','closed'].includes(task.status)"
            :task="task"
            :interview="task.performanceInterview"
            @refresh="loadDetail"
          />
        </section>

        <aside v-if="PERFORMANCE_REFERENCE_ENABLED" class="reference-card">
          <div class="reference-card__title">参考信息</div>
          <PerformanceReferencePanel
            :cycle-id="task.cycleId"
            :employee-id="task.employeeId"
            :indicators="task.indicatorInstances"
            :flow-records="task.flowRecords"
          />
        </aside>
      </div>
    </template>

    <div v-else-if="taskStore.error" class="error-state">
      <el-empty :description="taskStore.error" />
    </div>
  </div>
</template>

<style scoped>
.performance-detail {
  min-height: 100%;
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 18px;
  background: #f4f6fb;
}

.performance-detail__topbar {
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.performance-detail__heading {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.performance-detail__heading > span {
  color: #1f2937;
  font-size: 19px;
  font-weight: 700;
}

.performance-detail__heading small {
  padding: 4px 9px;
  border-radius: 4px;
  background: #eaf2ff;
  color: #3675d3;
  font-size: 12px;
}

.performance-detail__topbar-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.performance-stage-state {
  display: inline-flex;
  min-height: 26px;
  align-items: center;
  padding: 0 10px;
  border-radius: 5px;
  background: #eef2f7;
  color: #738096;
  font-size: 12px;
  font-weight: 600;
}

.performance-stage-state.is-pending,
.performance-stage-state.is-progress {
  background: #fff3df;
  color: #d78a17;
}

.performance-stage-state.is-completed {
  background: #eaf8ee;
  color: #35a45b;
}

.employee-summary {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border: 1px solid #edf0f5;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(31 45 61 / 4%);
}

.employee-summary__avatar {
  display: grid;
  width: 46px;
  height: 46px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 9px;
  background: linear-gradient(145deg, #596ddd, #4458c9);
  color: #fff;
  font-size: 18px;
  font-weight: 700;
}

.employee-summary__body {
  min-width: 0;
}

.employee-summary__name-line,
.employee-summary__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}

.employee-summary__name-line {
  gap: 9px;
}

.employee-summary__name-line strong {
  color: #20283a;
  font-size: 19px;
}

.employee-summary__name-line > span {
  padding: 3px 8px;
  border-radius: 4px;
  background: #eef3ff;
  color: #4968d8;
  font-size: 11px;
}

.employee-summary__meta {
  gap: 8px 20px;
  margin-top: 7px;
  color: #7a8495;
  font-size: 12px;
}

.performance-detail__workspace {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: 14px;
}

.performance-detail__workspace.has-reference {
  grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
}

.performance-detail__main {
  min-width: 0;
  display: grid;
  gap: 14px;
}

.performance-detail__main :deep(.chart-card),
.reference-card {
  border: 1px solid #edf0f5;
  border-radius: 14px;
  box-shadow: 0 1px 2px rgb(31 45 61 / 4%);
}

.reference-card {
  min-width: 0;
  overflow: hidden;
  background: #fff;
}

.reference-card__title {
  min-height: 50px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid #edf0f5;
  color: #20283a;
  font-size: 16px;
  font-weight: 700;
}

.reference-card :deep(.performance-reference) {
  border-left: 0;
}

.stage-unavailable-card :deep(.el-empty) {
  min-height: 220px;
}

.result-view__mask {
  display: flex;
  justify-content: center;
  margin-top: 16px;
  padding: 16px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

.manager-summary {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.manager-summary__label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}

.manager-summary__content {
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.manager-summary__attachments {
  margin: 0;
  padding-left: 16px;
}

.manager-summary__attachments a {
  color: var(--el-color-primary);
  text-decoration: none;
}

.error-state {
  padding: 48px 0;
}

@media (max-width: 1180px) {
  .performance-detail__workspace.has-reference {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .performance-detail {
    padding: 12px;
  }

  .performance-detail__topbar {
    align-items: flex-start;
  }

  .performance-detail__heading {
    flex-wrap: wrap;
  }

  .performance-detail__topbar-actions {
    align-self: center;
  }

  .employee-summary {
    padding: 15px;
  }
}
</style>
