<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { Check, Delete, Plus, Refresh, RefreshLeft, Select } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { tasksApi, type TaskActionResult } from '@/api/tasks.api';
import { uploadApi } from '@/api/upload.api';
import FileUpload from '@/components/common/FileUpload.vue';
import GradeTag from '@/components/common/GradeTag.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import { useAuthStore } from '@/stores/auth.store';
import type {
  Attachment,
  ExtraScoreItem,
  IndicatorInstance,
  ManagerEvalSummary,
  SaveManagerEvaluationDraftBody,
  SubmitManagerScoreBody,
  TaskDetail,
} from '@/types/api.types';
import type { PerformanceIndicatorRow } from './PerformanceIndicatorList.vue';
import PerformanceReviewTable, {
  type PerformanceReviewColumn,
} from './PerformanceReviewTable.vue';
import { normalizeIndicatorVisibilityScopes } from '../indicator-visibility';

interface EditableIndicator extends IndicatorInstance {
  managerScoreInput: number | null;
  managerCommentInput: string;
  extraScoresInput: ExtraScoreItem[];
}

interface FeedbackState {
  type: 'success' | 'warning' | 'error' | 'info';
  message: string;
}

interface OperationContext {
  requestId: number;
  taskId: string;
  taskSession: number;
  draftRevision: number;
}

export interface ManagerEvaluationWorkspaceHandle {
  reload: () => Promise<void>;
}

const props = defineProps<{
  taskId: string;
}>();

const emit = defineEmits<{
  taskUpdated: [task: TaskDetail];
}>();

const auth = useAuthStore();
const rootRef = ref<HTMLElement>();
const task = ref<TaskDetail>();
const loading = ref(false);
const loadError = ref('');
const operation = ref<'save' | 'submit' | 'withdraw' | ''>('');
const uploading = ref(false);
const feedback = ref<FeedbackState>();
const dirty = ref(false);
const draftRevision = ref(0);
const validationIndicatorIds = ref<string[]>([]);
const draftIndicators = reactive<EditableIndicator[]>([]);
const summaryForm = reactive({
  strengths: '',
  improvements: '',
  developmentPlan: '',
  attachments: [] as Attachment[],
});
let loadSerial = 0;
let operationSerial = 0;
let taskSessionSerial = 0;

const isCurrentManager = computed(() => Boolean(
  task.value?.managerId
  && auth.user?.id
  && task.value.managerId === auth.user.id,
));
const canEdit = computed(() => Boolean(
  task.value
  && task.value.status === 'manager_scoring'
  && !task.value.isExempt
  && isCurrentManager.value,
));
const canEditForm = computed(() => (
  canEdit.value && operation.value !== 'submit' && operation.value !== 'withdraw'
));
const canWithdraw = computed(() => Boolean(
  task.value
  && ['dept_review', 'hr_calibration'].includes(task.value.status)
  && task.value.managerScoredAt
  && isCurrentManager.value,
));
const isBusy = computed(() => Boolean(operation.value) || uploading.value);
const evaluationRows = computed<PerformanceIndicatorRow[]>(() => draftIndicators.map((indicator) => ({
  id: indicator.id,
  name: indicator.name,
  weight: indicator.weight,
  visibilityScope: indicator.visibilityScope,
  visibilityScopes: indicator.visibilityScopes,
  statusLabel: indicator.managerScoreInput == null
    ? '待评分'
    : task.value?.status === 'manager_scoring' ? '已评分' : '已提交',
  description: indicator.description,
  scoringStandard: indicator.scoringStandard,
  dataSource: indicator.dataSource,
  dataCaliber: indicator.dataCaliber,
  targetValue: indicator.targetValue,
  targetValueText: indicator.targetValueText,
  unit: indicator.unit,
  alignedObjectives: indicator.alignedObjectives,
})));
const managerEvaluationColumns: PerformanceReviewColumn[] = [
  { key: 'indicator', label: '名称', width: 'minmax(150px, .8fr)' },
  { key: 'weight', label: '权重', width: '68px' },
  { key: 'description', label: '指标描述', width: 'minmax(230px, 1.15fr)' },
  { key: 'primary', label: '员工自评', width: 'minmax(190px, .95fr)' },
  { key: 'secondary', label: '主管评分', width: 'minmax(240px, 1.2fr)' },
];

function cloneIndicators(indicators: IndicatorInstance[]): EditableIndicator[] {
  return indicators.map((indicator) => ({
    ...indicator,
    visibilityScopes: normalizeIndicatorVisibilityScopes(indicator.visibilityScopes, indicator.visibilityScope),
    visibleDepartmentIds: [...indicator.visibleDepartmentIds],
    visibleUserIds: [...indicator.visibleUserIds],
    alignedObjectives: indicator.alignedObjectives.map((objective) => ({ ...objective })),
    managerScoreInput: indicator.managerScore ?? null,
    managerCommentInput: indicator.managerComment ?? '',
    extraScoresInput: Array.isArray(indicator.extraScores)
      ? indicator.extraScores.map((extra) => ({ ...extra }))
      : [],
  }));
}

function replaceDraft(nextTask: TaskDetail) {
  task.value = nextTask;
  draftIndicators.splice(
    0,
    draftIndicators.length,
    ...cloneIndicators(nextTask.indicatorInstances ?? []),
  );
  summaryForm.strengths = nextTask.managerEvalSummary?.strengths ?? '';
  summaryForm.improvements = nextTask.managerEvalSummary?.improvements ?? '';
  summaryForm.developmentPlan = nextTask.managerEvalSummary?.developmentPlan ?? '';
  summaryForm.attachments = (nextTask.managerEvalSummary?.attachments ?? []).map((item) => ({ ...item }));
  validationIndicatorIds.value = [];
  draftRevision.value = 0;
  dirty.value = false;
}

function httpErrorMessage(error: unknown, fallback: string): string {
  const candidate = error as {
    message?: string;
    response?: { data?: { message?: string | string[] } };
  };
  const responseMessage = candidate.response?.data?.message;
  if (Array.isArray(responseMessage)) return responseMessage.join('；');
  return responseMessage || candidate.message || fallback;
}

function setFeedback(type: FeedbackState['type'], message: string) {
  feedback.value = { type, message };
}

async function loadTask(clearFeedback = true) {
  const taskId = props.taskId;
  const requestId = ++loadSerial;
  const taskSession = ++taskSessionSerial;
  operationSerial += 1;
  operation.value = '';
  loading.value = true;
  loadError.value = '';
  if (clearFeedback) feedback.value = undefined;
  try {
    const response = await tasksApi.findOne(taskId);
    if (
      requestId !== loadSerial
      || taskSession !== taskSessionSerial
      || props.taskId !== taskId
    ) return;
    replaceDraft(response);
  } catch (error) {
    if (requestId !== loadSerial || props.taskId !== taskId) return;
    task.value = undefined;
    draftIndicators.splice(0, draftIndicators.length);
    loadError.value = httpErrorMessage(error, '主管评价详情加载失败');
  } finally {
    if (requestId === loadSerial) loading.value = false;
  }
}

function markDirty() {
  if (!canEdit.value) return;
  dirty.value = true;
  draftRevision.value += 1;
  if (feedback.value?.type === 'success') feedback.value = undefined;
}

function handleScoreInput(indicator: EditableIndicator, event: Event) {
  const value = (event.target as HTMLInputElement).value;
  indicator.managerScoreInput = value === '' ? null : Number(value);
  markDirty();
}

function handleCommentInput(indicator: EditableIndicator, event: Event) {
  indicator.managerCommentInput = (event.target as HTMLTextAreaElement).value;
  markDirty();
}

function addExtraScore(indicator: EditableIndicator) {
  if (!canEdit.value) return;
  indicator.extraScoresInput.push({ label: '', value: 0 });
  markDirty();
  const index = indicator.extraScoresInput.length - 1;
  void nextTick(() => {
    rootRef.value
      ?.querySelector<HTMLElement>(`[data-testid="manager-extra-reason-${CSS.escape(indicator.id)}-${index}"]`)
      ?.focus();
  });
}

function removeExtraScore(indicator: EditableIndicator, index: number) {
  if (!canEdit.value) return;
  indicator.extraScoresInput.splice(index, 1);
  markDirty();
}

function handleExtraReasonInput(extra: ExtraScoreItem, event: Event) {
  extra.label = (event.target as HTMLInputElement).value;
  markDirty();
}

function handleExtraValueInput(extra: ExtraScoreItem, event: Event) {
  const value = (event.target as HTMLInputElement).value;
  extra.value = value === '' ? Number.NaN : Number(value);
  markDirty();
}

function handleSummaryInput(
  field: 'strengths' | 'improvements' | 'developmentPlan',
  event: Event,
) {
  summaryForm[field] = (event.target as HTMLTextAreaElement).value;
  markDirty();
}

function handleAttachmentsChange(attachments: Attachment[]) {
  summaryForm.attachments = attachments.map((attachment) => ({ ...attachment }));
  markDirty();
}

async function handleUpload(files: File[]) {
  if (!canEdit.value || uploading.value) return;
  const taskId = props.taskId;
  const taskSession = taskSessionSerial;
  uploading.value = true;
  try {
    for (const file of files) {
      const attachment = await uploadApi.upload(file);
      if (props.taskId !== taskId || taskSession !== taskSessionSerial) return;
      summaryForm.attachments.push(attachment);
      markDirty();
      ElMessage.success(`「${file.name}」上传成功`);
    }
  } catch (error) {
    if (props.taskId === taskId && taskSession === taskSessionSerial) {
      const message = httpErrorMessage(error, '附件上传失败');
      setFeedback('error', message);
    }
  } finally {
    if (props.taskId === taskId && taskSession === taskSessionSerial) uploading.value = false;
  }
}

async function revealValidation(indicatorId: string, message: string, testId: string) {
  validationIndicatorIds.value = [];
  await nextTick();
  validationIndicatorIds.value = [indicatorId];
  setFeedback('error', message);
  ElMessage.warning(message);
  await nextTick();
  await nextTick();
  rootRef.value?.querySelector<HTMLElement>(`[data-testid="${CSS.escape(testId)}"]`)?.focus();
}

async function validateDraft(requireAllScores: boolean): Promise<boolean> {
  for (const indicator of draftIndicators) {
    if (requireAllScores && indicator.managerScoreInput == null) {
      await revealValidation(
        indicator.id,
        `请为指标「${indicator.name}」填写主管评分`,
        `manager-score-${indicator.id}`,
      );
      return false;
    }
    if (
      indicator.managerScoreInput != null
      && (
        !Number.isFinite(indicator.managerScoreInput)
        || indicator.managerScoreInput < 0
        || indicator.managerScoreInput > 100
      )
    ) {
      await revealValidation(
        indicator.id,
        `指标「${indicator.name}」的主管评分必须在 0 至 100 之间`,
        `manager-score-${indicator.id}`,
      );
      return false;
    }
    for (let index = 0; index < indicator.extraScoresInput.length; index += 1) {
      const extra = indicator.extraScoresInput[index];
      if (!extra.label.trim()) {
        await revealValidation(
          indicator.id,
          `请填写加减分原因：指标「${indicator.name}」`,
          `manager-extra-reason-${indicator.id}-${index}`,
        );
        return false;
      }
      if (!Number.isFinite(extra.value)) {
        await revealValidation(
          indicator.id,
          `请填写加减分分值：指标「${indicator.name}」`,
          `manager-extra-value-${indicator.id}-${index}`,
        );
        return false;
      }
    }
  }
  return true;
}

function normalizedExtraScores(indicator: EditableIndicator): ExtraScoreItem[] {
  return indicator.extraScoresInput.map((extra) => ({
    label: extra.label.trim(),
    value: Number(extra.value),
  }));
}

function buildDraftIndicators(): SaveManagerEvaluationDraftBody['indicators'] {
  return draftIndicators.map((indicator) => ({
    id: indicator.id,
    managerScore: indicator.managerScoreInput,
    managerComment: indicator.managerCommentInput.trim(),
    extraScores: normalizedExtraScores(indicator),
  }));
}

function buildSummary(): Omit<ManagerEvalSummary, 'id' | 'taskId' | 'submittedAt'> {
  return {
    strengths: summaryForm.strengths.trim(),
    improvements: summaryForm.improvements.trim(),
    developmentPlan: summaryForm.developmentPlan.trim(),
    attachments: summaryForm.attachments.map((attachment) => ({ ...attachment })),
  };
}

function operationContext(taskId: string): OperationContext {
  return {
    requestId: ++operationSerial,
    taskId,
    taskSession: taskSessionSerial,
    draftRevision: draftRevision.value,
  };
}

function isCurrentOperation(context: OperationContext): boolean {
  return (
    context.requestId === operationSerial
    && context.taskId === props.taskId
    && context.taskSession === taskSessionSerial
    && task.value?.id === context.taskId
  );
}

function acknowledgeLatestTask(nextTask: TaskDetail, context: OperationContext): 'replaced' | 'version-only' | 'ignored' {
  if (!isCurrentOperation(context) || nextTask.id !== context.taskId) return 'ignored';
  emit('taskUpdated', nextTask);
  if (context.draftRevision === draftRevision.value) {
    replaceDraft(nextTask);
    return 'replaced';
  }
  if (nextTask.updatedAt && task.value) {
    task.value = { ...task.value, updatedAt: nextTask.updatedAt };
  }
  return 'version-only';
}

function acknowledgeMutationResult(
  result: TaskActionResult,
  context: OperationContext,
): 'replaced' | 'version-only' | 'ignored' {
  if (!isCurrentOperation(context) || result.id !== context.taskId || !task.value) return 'ignored';
  task.value = {
    ...task.value,
    status: result.status,
    updatedAt: result.updatedAt ?? task.value.updatedAt,
  };
  emit('taskUpdated', task.value);
  if (context.draftRevision === draftRevision.value) {
    dirty.value = false;
    return 'replaced';
  }
  return 'version-only';
}

async function handleSave() {
  const currentTask = task.value;
  if (!currentTask?.updatedAt || !canEdit.value || operation.value) return;
  if (!await validateDraft(false)) return;
  const context = operationContext(currentTask.id);
  operation.value = 'save';
  setFeedback('info', '正在保存草稿');
  try {
    const result = await tasksApi.saveManagerEvaluationDraft(currentTask.id, {
      expectedUpdatedAt: currentTask.updatedAt,
      indicators: buildDraftIndicators(),
      evalSummary: buildSummary(),
    });
    if (!isCurrentOperation(context)) return;
    try {
      const latestTask = await tasksApi.findOne(currentTask.id);
      const acknowledgement = acknowledgeLatestTask(latestTask, context);
      if (acknowledgement === 'replaced') {
        setFeedback('success', '草稿已保存');
        ElMessage.success('草稿已保存');
      } else if (acknowledgement === 'version-only') {
        setFeedback('warning', '先前草稿已保存，当前修改尚未保存');
        ElMessage.warning('先前草稿已保存，当前修改尚未保存');
      }
    } catch (refreshError) {
      const acknowledgement = acknowledgeMutationResult(result, context);
      if (acknowledgement === 'ignored') return;
      const message = acknowledgement === 'replaced'
        ? `草稿已保存，但最新详情加载失败：${httpErrorMessage(refreshError, '请重新加载')}`
        : `先前草稿已保存，当前修改尚未保存；最新详情加载失败：${httpErrorMessage(refreshError, '请重新加载')}`;
      setFeedback('warning', message);
      ElMessage.warning(message);
    }
  } catch (error) {
    if (!isCurrentOperation(context)) return;
    const message = httpErrorMessage(error, '主管评价草稿保存失败');
    setFeedback('error', message);
  } finally {
    if (isCurrentOperation(context)) operation.value = '';
  }
}

async function handleSubmit() {
  const currentTask = task.value;
  if (!currentTask?.updatedAt || !canEdit.value || operation.value) return;
  if (!await validateDraft(true)) return;
  try {
    await ElMessageBox.confirm('确认提交主管评估？提交后任务将进入下一环节。', '提交评估', {
      confirmButtonText: '确认提交',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    throw error;
  }

  const context = operationContext(currentTask.id);
  operation.value = 'submit';
  setFeedback('info', '正在提交评估');
  const body: SubmitManagerScoreBody = {
    expectedUpdatedAt: currentTask.updatedAt,
    indicators: draftIndicators.map((indicator) => ({
      id: indicator.id,
      managerScore: indicator.managerScoreInput as number,
      managerComment: indicator.managerCommentInput.trim() || undefined,
      extraScores: normalizedExtraScores(indicator),
    })),
    evalSummary: buildSummary(),
  };
  try {
    const result = await tasksApi.submitManagerScore(currentTask.id, body);
    if (!isCurrentOperation(context)) return;
    dirty.value = false;
    try {
      const latestTask = await tasksApi.findOne(currentTask.id);
      if (acknowledgeLatestTask(latestTask, context) === 'ignored') return;
      setFeedback('success', '评估已提交');
      ElMessage.success('评估已提交');
    } catch (refreshError) {
      if (!isCurrentOperation(context) || !task.value) return;
      task.value = { ...task.value, status: result.status };
      const message = `评估已提交，但最新结果加载失败：${httpErrorMessage(refreshError, '请重新加载')}`;
      setFeedback('warning', message);
      ElMessage.warning(message);
      emit('taskUpdated', task.value);
    }
  } catch (error) {
    if (!isCurrentOperation(context)) return;
    const message = httpErrorMessage(error, '主管评估提交失败');
    setFeedback('error', message);
  } finally {
    if (isCurrentOperation(context)) operation.value = '';
  }
}

async function handleWithdraw() {
  const currentTask = task.value;
  if (!currentTask?.updatedAt || !canWithdraw.value || operation.value) return;
  try {
    await ElMessageBox.confirm('确认撤回主管评估？已保存的评分和评价将保留为草稿。', '撤回评估', {
      confirmButtonText: '确认撤回',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    throw error;
  }

  const context = operationContext(currentTask.id);
  operation.value = 'withdraw';
  setFeedback('info', '正在撤回评估');
  try {
    const result = await tasksApi.withdrawManagerScore(currentTask.id, {
      expectedUpdatedAt: currentTask.updatedAt,
    });
    if (!isCurrentOperation(context)) return;
    try {
      const latestTask = await tasksApi.findOne(currentTask.id);
      if (acknowledgeLatestTask(latestTask, context) === 'ignored') return;
      setFeedback('success', '评估已撤回，可继续编辑草稿');
      ElMessage.success('评估已撤回');
    } catch (refreshError) {
      if (acknowledgeMutationResult(result, context) === 'ignored') return;
      const message = `评估已撤回，但最新详情加载失败：${httpErrorMessage(refreshError, '请重新加载')}`;
      setFeedback('warning', message);
      ElMessage.warning(message);
    }
  } catch (error) {
    if (!isCurrentOperation(context)) return;
    const message = httpErrorMessage(error, '主管评估撤回失败');
    setFeedback('error', message);
  } finally {
    if (isCurrentOperation(context)) operation.value = '';
  }
}

async function confirmDiscardChanges(): Promise<boolean> {
  if (!dirty.value) return true;
  try {
    await ElMessageBox.confirm('存在未保存的主管评价，确定放弃修改并离开当前员工？', '放弃未保存修改？', {
      confirmButtonText: '放弃修改',
      cancelButtonText: '继续编辑',
      type: 'warning',
    });
    dirty.value = false;
    return true;
  } catch (error) {
    if (error === 'cancel' || error === 'close') return false;
    throw error;
  }
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value) return;
  event.preventDefault();
  event.returnValue = '';
}

onBeforeRouteUpdate(confirmDiscardChanges);
onBeforeRouteLeave(confirmDiscardChanges);

onMounted(() => window.addEventListener('beforeunload', handleBeforeUnload));
onUnmounted(() => window.removeEventListener('beforeunload', handleBeforeUnload));

watch(
  () => props.taskId,
  () => {
    void loadTask();
  },
  { immediate: true },
);

defineExpose<ManagerEvaluationWorkspaceHandle>({ reload: () => loadTask(false) });
</script>

<template>
  <section ref="rootRef" class="manager-evaluation" data-testid="manager-evaluation-workspace">
    <div v-if="loading" class="manager-evaluation__loading" aria-label="正在加载主管评价">
      <el-skeleton animated :rows="10" />
    </div>

    <el-result
      v-else-if="loadError"
      icon="error"
      title="主管评价详情加载失败"
      :sub-title="loadError"
    >
      <template #extra>
        <el-tooltip content="重新加载" placement="top">
          <el-button
            circle
            :icon="Refresh"
            aria-label="重新加载主管评价"
            @click="loadTask()"
          />
        </el-tooltip>
      </template>
    </el-result>

    <template v-else-if="task">
      <section class="manager-evaluation__indicators">
      <header class="manager-evaluation__header">
        <div class="manager-evaluation__heading">
          <div>
            <h3>考核指标</h3>
            <span>{{ task.indicatorInstances.length }} 项 · {{ task.cycleName || '-' }}</span>
          </div>
          <StatusBadge :status="task.status" size="small" />
        </div>
        <div class="manager-evaluation__actions">
          <el-button
            v-if="canWithdraw"
            type="danger"
            plain
            :icon="RefreshLeft"
            data-testid="manager-evaluation-withdraw"
            :loading="operation === 'withdraw'"
            :disabled="isBusy && operation !== 'withdraw'"
            @click="handleWithdraw"
          >
            撤回评估
          </el-button>
          <template v-if="canEdit">
            <el-button
              :icon="Select"
              data-testid="manager-evaluation-save"
              :loading="operation === 'save'"
              :disabled="isBusy && operation !== 'save'"
              @click="handleSave"
            >
              保存草稿
            </el-button>
            <el-button
              type="primary"
              :icon="Check"
              data-testid="manager-evaluation-submit"
              :loading="operation === 'submit'"
              :disabled="isBusy && operation !== 'submit'"
              @click="handleSubmit"
            >
              提交评估
            </el-button>
          </template>
        </div>
      </header>

      <div
        v-if="feedback"
        class="manager-evaluation__feedback"
        :class="`is-${feedback.type}`"
        data-testid="manager-evaluation-feedback"
        role="status"
      >
        {{ feedback.message }}
      </div>

        <PerformanceReviewTable
          :rows="evaluationRows"
          :columns="managerEvaluationColumns"
          :invalid-indicator-ids="validationIndicatorIds"
        >
          <template #cell-indicator="{ row, index }">
            <div class="manager-cell manager-cell--name">
              <span class="manager-cell__index">{{ index + 1 }}</span>
              <strong>{{ row.name || '未命名指标' }}</strong>
            </div>
          </template>

          <template #cell-weight="{ row }">
            <span>{{ Number((row.weight * 100).toFixed(2)) }}%</span>
          </template>

          <template #cell-description="{ index }">
            <div class="manager-cell__description">
              <p>{{ draftIndicators[index].description || '-' }}</p>
              <dl>
                <div>
                  <dt>目标值</dt>
                  <dd>
                    {{ draftIndicators[index].targetValueText
                      || (draftIndicators[index].targetValue != null
                        ? `${draftIndicators[index].targetValue}${draftIndicators[index].unit || ''}`
                        : '-') }}
                  </dd>
                </div>
                <div><dt>实际完成</dt><dd>{{ draftIndicators[index].actualValue || '-' }}</dd></div>
                <div><dt>完成说明</dt><dd>{{ draftIndicators[index].actualNote || '-' }}</dd></div>
                <div><dt>评分标准</dt><dd>{{ draftIndicators[index].scoringStandard || '-' }}</dd></div>
              </dl>
            </div>
          </template>

          <template #cell-primary="{ index }">
            <section class="evaluation-column is-self" aria-label="员工自评">
              <strong>{{ draftIndicators[index].selfScore ?? '-' }} 分</strong>
              <div
                class="evaluation-column__comment"
                :data-testid="`employee-self-comment-${draftIndicators[index].id}`"
              >
                {{ draftIndicators[index].selfComment || '暂无自评说明' }}
              </div>
            </section>
          </template>

          <template #cell-secondary="{ index }">
            <section class="evaluation-column is-manager" aria-label="主管评价">
              <label>
                <span>主管评分</span>
                <input
                  class="manager-field manager-field--score"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  inputmode="decimal"
                  :value="draftIndicators[index].managerScoreInput ?? ''"
                  :data-testid="`manager-score-${draftIndicators[index].id}`"
                  :disabled="!canEditForm"
                  @input="handleScoreInput(draftIndicators[index], $event)"
                >
              </label>
              <label>
                <span>主管评语</span>
                <textarea
                  class="manager-field manager-field--comment"
                  rows="3"
                  maxlength="500"
                  :value="draftIndicators[index].managerCommentInput"
                  :data-testid="`manager-comment-${draftIndicators[index].id}`"
                  :disabled="!canEditForm"
                  @input="handleCommentInput(draftIndicators[index], $event)"
                />
              </label>
            </section>
          </template>

          <template #row-extra="{ index }">
            <section class="manager-indicator-detail__extras" aria-label="加减分明细">
              <header>
                <div>
                  <strong>加减分明细</strong>
                  <span>{{ draftIndicators[index].extraScoresInput.length }} 条</span>
                </div>
                <el-tooltip v-if="canEditForm" content="添加加减分" placement="top">
                  <el-button
                    text
                    circle
                    :icon="Plus"
                    :data-testid="`manager-extra-add-${draftIndicators[index].id}`"
                    :aria-label="`为 ${draftIndicators[index].name} 添加加减分`"
                    @click="addExtraScore(draftIndicators[index])"
                  />
                </el-tooltip>
              </header>
              <div
                v-for="(extra, extraIndex) in draftIndicators[index].extraScoresInput"
                :key="`${draftIndicators[index].id}-${extraIndex}`"
                class="manager-extra-row"
              >
                <label>
                  <span>原因</span>
                  <input
                    class="manager-field"
                    type="text"
                    maxlength="200"
                    :value="extra.label"
                    :data-testid="`manager-extra-reason-${draftIndicators[index].id}-${extraIndex}`"
                    :disabled="!canEditForm"
                    @input="handleExtraReasonInput(extra, $event)"
                  >
                </label>
                <label>
                  <span>分值</span>
                  <input
                    class="manager-field"
                    type="number"
                    step="0.1"
                    inputmode="decimal"
                    :value="Number.isFinite(extra.value) ? extra.value : ''"
                    :data-testid="`manager-extra-value-${draftIndicators[index].id}-${extraIndex}`"
                    :disabled="!canEditForm"
                    @input="handleExtraValueInput(extra, $event)"
                  >
                </label>
                <el-tooltip v-if="canEditForm" content="删除加减分" placement="top">
                  <el-button
                    text
                    circle
                    type="danger"
                    :icon="Delete"
                    :aria-label="`删除第 ${extraIndex + 1} 条加减分`"
                    @click="removeExtraScore(draftIndicators[index], extraIndex)"
                  />
                </el-tooltip>
              </div>
              <p v-if="draftIndicators[index].extraScoresInput.length === 0">暂无加减分</p>
            </section>
          </template>
        </PerformanceReviewTable>
      </section>

        <section
          class="manager-evaluation__summary"
          data-testid="manager-evaluation-summary-card"
          aria-label="综合评价"
        >
          <header>
            <div>
              <h4>综合评价</h4>
              <span>员工总结与主管评价对照</span>
            </div>
            <div class="manager-evaluation__result">
              <span>总分</span>
              <strong data-testid="manager-evaluation-total">
                {{ task.gradeResult?.calculatedScore ?? '-' }}
              </strong>
              <span>等级</span>
              <span data-testid="manager-evaluation-grade">
                <GradeTag v-if="task.gradeResult?.rawGrade" :grade="task.gradeResult.rawGrade" size="small" />
                <strong v-else>-</strong>
              </span>
            </div>
          </header>

          <div class="manager-summary-grid">
            <section class="employee-summary" aria-label="员工总评">
              <h5>员工总评</h5>
              <dl>
                <div><dt>主要成果</dt><dd>{{ task.selfEvalSummary?.achievements || '-' }}</dd></div>
                <div><dt>待改进项</dt><dd>{{ task.selfEvalSummary?.improvements || '-' }}</dd></div>
                <div><dt>建议</dt><dd>{{ task.selfEvalSummary?.suggestions || '-' }}</dd></div>
                <div><dt>下阶段目标</dt><dd>{{ task.selfEvalSummary?.nextGoals || '-' }}</dd></div>
                <div><dt>所需支持</dt><dd>{{ task.selfEvalSummary?.supportNeeded || '-' }}</dd></div>
              </dl>
              <div v-if="task.selfEvalSummary?.attachments?.length" class="summary-attachments">
                <strong>员工附件</strong>
                <a
                  v-for="attachment in task.selfEvalSummary.attachments"
                  :key="attachment.url"
                  :href="attachment.url"
                  target="_blank"
                  rel="noopener"
                >
                  {{ attachment.name }}
                </a>
              </div>
            </section>

            <section class="manager-summary" aria-label="主管综合评价">
              <h5>主管综合评价</h5>
              <label>
                <span>优势</span>
                <textarea
                  class="manager-field"
                  rows="3"
                  maxlength="2000"
                  :value="summaryForm.strengths"
                  data-testid="manager-strengths"
                  :disabled="!canEditForm"
                  @input="handleSummaryInput('strengths', $event)"
                />
              </label>
              <label>
                <span>待改进项</span>
                <textarea
                  class="manager-field"
                  rows="3"
                  maxlength="2000"
                  :value="summaryForm.improvements"
                  data-testid="manager-improvements"
                  :disabled="!canEditForm"
                  @input="handleSummaryInput('improvements', $event)"
                />
              </label>
              <label>
                <span>发展计划</span>
                <textarea
                  class="manager-field"
                  rows="3"
                  maxlength="2000"
                  :value="summaryForm.developmentPlan"
                  data-testid="manager-development-plan"
                  :disabled="!canEditForm"
                  @input="handleSummaryInput('developmentPlan', $event)"
                />
              </label>
              <div class="manager-summary__attachments">
                <span>附件</span>
                <FileUpload
                  :key="task.id"
                  :model-value="summaryForm.attachments"
                  :disabled="!canEditForm || uploading"
                  @upload="handleUpload"
                  @update:model-value="handleAttachmentsChange"
                />
              </div>
            </section>
          </div>
        </section>
    </template>

    <el-empty v-else :image-size="52" description="暂无主管评价详情" />
  </section>
</template>

<style scoped>
.manager-evaluation {
  min-width: 0;
  border-top: 1px solid #e5e9ef;
  container: manager-evaluation / inline-size;
}

.manager-evaluation__loading {
  min-height: 460px;
  padding: 18px;
}

.manager-evaluation__header {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid #e5e9ef;
}

.manager-evaluation__heading,
.manager-evaluation__heading > div,
.manager-evaluation__actions,
.manager-evaluation__summary > header,
.manager-evaluation__result,
.manager-indicator-detail__extras > header,
.manager-indicator-detail__extras > header > div,
.evaluation-column > header {
  display: flex;
  align-items: center;
}

.manager-evaluation__heading {
  min-width: 0;
  gap: 10px;
}

.manager-evaluation__heading > div {
  min-width: 0;
  align-items: baseline;
  gap: 8px;
}

.manager-evaluation__heading h3,
.manager-evaluation__summary h4,
.manager-summary-grid h5 {
  margin: 0;
  color: #273247;
}

.manager-evaluation__heading h3 {
  font-size: 14px;
}

.manager-evaluation__heading span,
.manager-evaluation__summary > header span,
.manager-indicator-detail__extras header span,
.evaluation-column header span {
  color: #7a8495;
  font-size: 11px;
}

.manager-evaluation__actions {
  flex: 0 0 auto;
  gap: 6px;
}

.manager-evaluation__feedback {
  min-height: 34px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  border-bottom: 1px solid #e5e9ef;
  color: #465267;
  background: #f7f9fb;
  font-size: 12px;
}

.manager-evaluation__feedback.is-success {
  color: #1f6b42;
  background: #f0f9eb;
}

.manager-evaluation__feedback.is-warning {
  color: #8a5a10;
  background: #fff8e8;
}

.manager-evaluation__feedback.is-error {
  color: #a4262c;
  background: #fff1f0;
}

.manager-evaluation__body {
  min-width: 0;
  padding: 10px 14px 18px;
}

.manager-evaluation__self-summary {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manager-indicator-detail {
  min-width: 0;
}

.manager-indicator-detail__facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px 14px;
  margin: 0;
  padding-bottom: 12px;
}

.manager-indicator-detail__facts div,
.employee-summary dl div {
  min-width: 0;
}

.manager-indicator-detail__facts dt,
.employee-summary dt {
  margin-bottom: 4px;
  color: #7a8597;
  font-size: 11px;
}

.manager-indicator-detail__facts dd,
.employee-summary dd {
  margin: 0;
  color: #344054;
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.manager-indicator-detail__comparison {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid #dfe4ec;
  border-bottom: 1px solid #dfe4ec;
}

.evaluation-column {
  min-width: 0;
  padding: 12px;
}

.evaluation-column.is-manager {
  border-left: 1px solid #dfe4ec;
}

.evaluation-column > header {
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.evaluation-column > header strong,
.manager-indicator-detail__extras header strong,
.summary-attachments strong {
  color: #334057;
  font-size: 12px;
}

.evaluation-column__comment {
  min-height: 80px;
  color: #465267;
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.evaluation-column label,
.manager-extra-row label,
.manager-summary label,
.manager-summary__attachments {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.evaluation-column label + label,
.manager-summary label + label,
.manager-summary__attachments {
  margin-top: 10px;
}

.evaluation-column label > span,
.manager-extra-row label > span,
.manager-summary label > span,
.manager-summary__attachments > span {
  color: #687386;
  font-size: 11px;
}

.manager-field {
  width: 100%;
  min-width: 0;
  min-height: 34px;
  box-sizing: border-box;
  padding: 7px 9px;
  border: 1px solid #d7dde7;
  border-radius: 5px;
  color: #273247;
  background: #fff;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  letter-spacing: 0;
}

.manager-field:focus {
  border-color: #2f73b7;
  outline: 2px solid rgb(47 115 183 / 15%);
}

.manager-field:disabled {
  color: #5d687a;
  background: #f4f6f8;
  cursor: not-allowed;
}

.manager-field--score {
  max-width: 150px;
}

.manager-field--comment {
  resize: vertical;
}

.manager-indicator-detail__extras {
  padding-top: 10px;
}

.manager-indicator-detail__extras > header {
  min-height: 32px;
  justify-content: space-between;
}

.manager-indicator-detail__extras > header > div {
  gap: 8px;
}

.manager-extra-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 130px 34px;
  align-items: end;
  gap: 8px;
  padding: 6px 0;
}

.manager-indicator-detail__extras > p {
  margin: 4px 0 0;
  color: #8a94a5;
  font-size: 11px;
}

.manager-evaluation__summary {
  margin-top: 14px;
  border-top: 1px solid #dfe4ec;
}

.manager-evaluation__summary > header {
  min-height: 48px;
  justify-content: space-between;
  gap: 12px;
}

.manager-evaluation__summary > header > div:first-child {
  display: grid;
  gap: 3px;
}

.manager-evaluation__summary h4 {
  font-size: 13px;
}

.manager-evaluation__result {
  gap: 6px;
  color: #687386;
  font-size: 11px;
}

.manager-evaluation__result > strong {
  min-width: 44px;
  color: #245f9e;
  font-size: 17px;
  text-align: center;
}

.manager-summary-grid {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid #e5e9ef;
}

.employee-summary,
.manager-summary {
  min-width: 0;
  padding: 14px;
}

.manager-summary {
  border-left: 1px solid #e5e9ef;
}

.manager-summary-grid h5 {
  margin-bottom: 12px;
  font-size: 12px;
}

.employee-summary dl {
  display: grid;
  gap: 10px;
  margin: 0;
}

.summary-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-top: 12px;
  font-size: 12px;
}

.summary-attachments a {
  color: #245f9e;
  text-decoration: none;
}

.manager-summary :deep(.file-upload__trigger) {
  min-height: 82px;
  padding: 10px;
}

@container manager-evaluation (max-width: 620px) {
  .manager-evaluation__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .manager-evaluation__actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .manager-evaluation__actions :deep(.el-button) {
    flex: 1 1 120px;
    margin-left: 0;
  }

  .manager-evaluation__body {
    padding: 8px;
  }

  .manager-indicator-detail__facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .manager-indicator-detail__comparison,
  .manager-summary-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .evaluation-column.is-manager,
  .manager-summary {
    border-top: 1px solid #dfe4ec;
    border-left: 0;
  }

  .manager-extra-row {
    grid-template-columns: minmax(0, 1fr) 96px 34px;
  }

  .manager-evaluation__summary > header {
    align-items: flex-start;
    flex-direction: column;
    padding: 8px 0;
  }
}

@container manager-evaluation (max-width: 430px) {
  .manager-evaluation__heading {
    align-items: flex-start;
  }

  .manager-evaluation__heading > div {
    display: grid;
    gap: 3px;
  }

  .manager-indicator-detail__facts,
  .manager-extra-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .manager-extra-row :deep(.el-button) {
    justify-self: end;
  }
}

.manager-evaluation {
  display: grid;
  gap: 14px;
  border-top: 0;
}

.manager-evaluation__indicators,
.manager-evaluation__summary {
  min-width: 0;
  overflow: hidden;
  border: 0;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(31 45 61 / 4%);
}

.manager-evaluation__header {
  min-height: 62px;
  padding: 8px 18px;
  border-bottom: 0;
}

.manager-evaluation__heading h3 {
  color: #20283a;
  font-size: 18px;
}

.manager-evaluation__feedback {
  border-top: 1px solid #edf0f5;
  border-bottom-color: #edf0f5;
}

.manager-evaluation__indicators :deep(.performance-review-table) {
  border-top: 1px solid #edf0f5;
}

.manager-cell,
.manager-cell__description,
.manager-cell__description dl,
.manager-cell__description dl div {
  min-width: 0;
}

.manager-cell--name {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.manager-cell__index {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  color: #1677ff;
  background: #e8f3ff;
  font-size: 12px;
  font-weight: 700;
}

.manager-cell--name strong {
  color: #273247;
  font-size: 14px;
}

.manager-cell__description > p {
  margin: 0 0 10px;
  white-space: pre-wrap;
}

.manager-cell__description dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
  margin: 0;
}

.manager-cell__description dt {
  margin-bottom: 2px;
  color: #8a94a6;
  font-size: 11px;
}

.manager-cell__description dd {
  margin: 0;
  color: #5f6a7d;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.evaluation-column {
  padding: 0;
}

.evaluation-column.is-manager {
  border-left: 0;
}

.evaluation-column.is-self > strong {
  display: inline-block;
  margin-bottom: 8px;
  color: #273247;
}

.evaluation-column__comment {
  min-height: 0;
}

.manager-indicator-detail__extras {
  padding: 12px;
  border-radius: 8px;
  background: #f8fafc;
}

.manager-evaluation__summary {
  margin-top: 0;
  padding: 0 18px 18px;
}

.manager-evaluation__summary > header {
  min-height: 58px;
}

.manager-evaluation__summary h4 {
  color: #20283a;
  font-size: 18px;
}

.manager-summary-grid {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
  gap: 24px;
  border-top-color: #edf0f5;
}

.employee-summary,
.manager-summary {
  padding: 16px 0 0;
}

.manager-summary {
  padding-left: 24px;
  border-left-color: #edf0f5;
}

@container manager-evaluation (max-width: 760px) {
  .manager-evaluation__header {
    align-items: flex-start;
    flex-direction: column;
    padding: 12px;
  }

  .manager-evaluation__actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .manager-summary-grid,
  .manager-cell__description dl {
    grid-template-columns: minmax(0, 1fr);
  }

  .manager-summary {
    padding-left: 0;
    border-top: 1px solid #edf0f5;
    border-left: 0;
  }

  .manager-extra-row {
    grid-template-columns: minmax(0, 1fr) 96px 34px;
  }
}

@container manager-evaluation (max-width: 430px) {
  .manager-evaluation__summary {
    padding-inline: 12px;
  }

  .manager-extra-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
