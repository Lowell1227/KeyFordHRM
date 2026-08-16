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
import TaskInfoCard from './components/TaskInfoCard.vue';
import IndicatorSnapshot, { type ActualValueItem } from './components/IndicatorSnapshot.vue';
import ExemptView from './components/ExemptView.vue';
import ScoreMask from './components/ScoreMask.vue';
import InterviewCard from './components/InterviewCard.vue';
import SignBlock from '@/components/common/SignBlock.vue';
import GradeTag from '@/components/common/GradeTag.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import { useAuthStore } from '@/stores/auth.store';
import { formatScore } from '@/utils/score';
import type { AssessmentCycle, TaskDetail, SetIndicatorBody, SubmitSelfEvalBody } from '@/types/api.types';
import type { SignatureRole } from '@/types/enums';
import { TASK_STATUS_META } from '@/types/enums';

const route = useRoute();
const router = useRouter();
const taskStore = useTaskStore();
const authStore = useAuthStore();

const cycle = ref<AssessmentCycle | null>(null);
const cycleLoading = ref(false);
const actionLoading = ref(false);
const reminding = ref(false);

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

const flowNodes = computed(() => flow.flowNodes.value);
const flowActions = computed(() => flow.actions.value);
const flowCurrentNode = computed(() => flow.currentNode.value);

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

const flowActiveIndex = computed(() => {
  const nodes = flowNodes.value;
  const current = flowCurrentNode.value;
  return nodes.findIndex((n) => n.key === current);
});

const canEditIndicators = computed(() => {
  const t = task.value;
  if (!t || t.isExempt) return false;
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
  if (!t || t.isExempt) return false;
  if (t.status === 'indicator_reviewing') return permission.isTaskManager.value || permission.isAdminLike.value;
  return false;
});
const rejectIndicatorLabel = computed(() => (canRejectIndicators.value ? '退回员工修改' : '退回主管调整'));

const showResultView = computed(() => {
  const status = task.value?.status;
  return !!status && !['indicator_drafting', 'indicator_reviewing', 'indicator_setting', 'indicator_confirming', 'goal_confirmed', 'self_eval'].includes(status);
});

const reminderOnCooldown = computed(() => {
  const value = workflowContext.value.reminderAvailableAt;
  return Boolean(value && new Date(value).getTime() > Date.now());
});

const workflowDeadlineText = computed(() => {
  const value = workflowContext.value.currentDeadline;
  if (!value) return '暂无截止时间';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', { hour12: false });
});

const indicatorSnapshotDescription = computed(() => {
  const t = task.value;
  if (!t) return '';
  if (t.status === 'indicator_drafting' || t.status === 'indicator_setting') {
    return '请添加本期的绩效指标，和您的主管进行确认。';
  }
  if (t.status === 'indicator_reviewing') {
    return permission.isTaskSelf.value
      ? '已提交主管审核，主管审核通过后将回到您这里确认。'
      : '请审核员工提交的本期绩效指标，可保存调整、审核通过或退回员工修改。';
  }
  if (t.status === 'indicator_confirming') {
    if (permission.isTaskSelf.value) {
      return '请核对主管审核后的本期绩效指标，确认后进入自评。';
    }
    return '请核对本期绩效指标。如有异议，可退回主管调整。';
  }
  if (t.status === 'self_eval') {
    return '请在指标表中填写实际完成值、自评分和自评说明，并提交自评。';
  }
  return '本期绩效指标如下。';
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
  try {
    if (actualValues.length > 0) {
      await tasksApi.updateActualValues(id, { indicators: actualValues });
    }
    await tasksApi.submitSelfEval(id, body);
    ElMessage.success('自评提交成功');
    await loadDetail();
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
  <div v-loading="loading" class="task-detail page-stack">
    <div class="task-detail__header">
      <el-button data-testid="task-detail-return" :icon="ArrowLeft" link @click="goBack">返回列表</el-button>
      <span class="task-detail__title">任务详情</span>
    </div>

    <template v-if="task">
      <TaskInfoCard :task="task" :cycle="cycle" />

      <ChartCard class="workflow-state-card">
        <div class="workflow-state">
          <div>
            <div class="workflow-state__eyebrow">{{ task.cycleName || cycle?.name || '本期绩效' }} · 当前状态</div>
            <div class="workflow-state__title">{{ workflowContext.statusLabel }}</div>
            <div class="workflow-state__meta">
              <span v-if="workflowContext.currentHandler">
                当前处理人：{{ workflowContext.currentHandler.name }}
              </span>
              <span v-else>当前无需人工处理</span>
              <span>时间：{{ workflowDeadlineText }}</span>
            </div>
          </div>
          <el-button
            v-if="workflowContext.canRemind"
            type="primary"
            plain
            :loading="reminding"
            :disabled="reminderOnCooldown"
            @click="handleRemind"
          >
            {{ reminderOnCooldown ? '24小时内已催办' : '催办' }}
          </el-button>
        </div>
      </ChartCard>

      <ChartCard class="flow-card">
        <el-steps :active="flowActiveIndex" finish-status="success">
          <el-step v-for="node in flowNodes" :key="node.key" :title="node.label" />
        </el-steps>
      </ChartCard>

      <!-- 豁免任务 -->
      <ExemptView v-if="task.isExempt" :task="task" />

      <!-- 正式考核指标：所有非豁免任务常驻展示 -->
      <IndicatorSnapshot
        v-else
        title="本周期指标"
        :instances="task.indicatorInstances"
        :can-edit="canEditIndicators"
        :can-confirm="task.status === 'indicator_confirming' && flowActions.canConfirmIndicator && !canEditIndicators"
        :can-reject="canRejectIndicators"
        confirm-label="确认指标"
        :reject-label="rejectIndicatorLabel"
        :description="indicatorSnapshotDescription"
        :dept-id="task.deptId"
        :employee-id="task.employeeId"
        :can-use-template="canEditIndicators"
        :flow-records="task.flowRecords"
        :loading="actionLoading"
        :save-label="indicatorSaveLabel"
        :submit-label="indicatorSubmitLabel"
        :split-save-actions="splitIndicatorSaveActions"
        :self-eval-mode="task.status === 'self_eval'"
        :self-eval-readonly="!permission.canEditSelfEval.value"
        :self-eval-summary="task.selfEvalSummary"
        @save="handleSaveIndicators"
        @confirm="handleConfirmIndicators"
        @reject="handleRejectIndicators"
        @submit-self-eval="handleSubmitSelfEval"
      />

      <ChartCard v-if="showResultView" class="result-view">
        <template #title>结果查看</template>
        <template #extra>
          <StatusBadge :status="task.status" size="small" />
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

        <div v-if="permission.canConfirmResult.value" class="result-actions">
          <el-button type="primary" :loading="actionLoading" @click="handleConfirmResult">
            确认结果
          </el-button>
        </div>

        <div v-if="!permission.isPublished.value" class="result-view__mask">
          <ScoreMask :message="permission.maskMessage.value" />
        </div>
      </ChartCard>

      <!-- 考核表三方签字（A3）：考核人 + HR + 被考核人 -->
      <SignBlock
        v-if="['published','confirmed','appealing','closed'].includes(task.status)"
        class="sign-block-card"
        business-type="assessment_task"
        :business-record-id="task.id"
        :role="signatureRole"
        title="考核表三方签字"
      />

      <!-- 绩效面谈（A1） -->
      <InterviewCard
        v-if="['published','confirmed','appealing','closed'].includes(task.status)"
        :task="task"
        :interview="task.performanceInterview"
        @refresh="loadDetail"
      />
    </template>

    <div v-else-if="taskStore.error" class="error-state">
      <el-empty :description="taskStore.error" />
    </div>
  </div>
</template>

<style scoped>
.task-detail__header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.task-detail__title {
  font-size: 16px;
  font-weight: 600;
}

.flow-card :deep(.el-step__head.is-success),
.flow-card :deep(.el-step__title.is-success) {
  color: #16a34a;
  border-color: #16a34a;
}

.workflow-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.workflow-state__eyebrow,
.workflow-state__meta {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.workflow-state__title {
  margin: 6px 0;
  color: var(--el-text-color-primary);
  font-size: 18px;
  font-weight: 600;
}

.workflow-state__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
}

.flow-card :deep(.el-step__head.is-process),
.flow-card :deep(.el-step__title.is-process) {
  color: #1f2937;
  border-color: #1f2937;
}

.flow-card :deep(.el-step__head.is-wait),
.flow-card :deep(.el-step__title.is-wait) {
  color: #9ca3af;
  border-color: #9ca3af;
}

.flow-card :deep(.el-step__title.is-process) {
  font-weight: 600;
}

.flow-card :deep(.el-step__head.is-success .el-step__line) {
  background-color: #16a34a;
}

.flow-card :deep(.el-step__head.is-process .el-step__line),
.flow-card :deep(.el-step__head.is-wait .el-step__line) {
  background-color: #d1d5db;
}

.result-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
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
</style>
