<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { Check, Close, Refresh, Select } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { tasksApi } from '@/api/tasks.api';
import type { IndicatorInstance, SetIndicatorBody, TaskDetail } from '@/types/api.types';
import type { IndicatorVisibilityScope } from '@/types/enums';
import PerformanceIndicatorList, {
  type PerformanceIndicatorRow,
} from './PerformanceIndicatorList.vue';
import IndicatorVisibilityEditor, {
  type IndicatorVisibilitySelection,
  type VisibilityDepartmentOption,
  type VisibilityUserOption,
} from './IndicatorVisibilityEditor.vue';
import PerformanceReferencePanel from './PerformanceReferencePanel.vue';
import { normalizeDisplayedWeightTotal } from '../indicator-weight';

export interface GoalReviewSaveIdentity {
  operationToken: string;
  draftRevision: number;
}

export type GoalReviewSaveAcknowledgement = 'replaced' | 'version-acknowledged' | 'ignored';

export interface GoalReviewSavePayload extends GoalReviewSaveIdentity {
  taskId: string;
  expectedUpdatedAt: string;
  body: Omit<SetIndicatorBody, 'expectedUpdatedAt'>;
}

export interface GoalReviewActionPayload {
  taskId: string;
  expectedUpdatedAt: string;
}

export interface GoalReviewRejectPayload extends GoalReviewActionPayload {
  reason: string;
}

export interface GoalReviewWorkspaceHandle {
  reload: () => Promise<void>;
  acknowledgeSavedTask: (
    task: TaskDetail,
    identity: GoalReviewSaveIdentity,
  ) => GoalReviewSaveAcknowledgement;
}

const props = withDefaults(
  defineProps<{
    taskId: string;
    departments?: VisibilityDepartmentOption[];
    users?: VisibilityUserOption[];
    busy?: boolean;
  }>(),
  {
    departments: () => [],
    users: () => [],
    busy: false,
  },
);

const emit = defineEmits<{
  save: [payload: GoalReviewSavePayload];
  approve: [payload: GoalReviewActionPayload];
  reject: [payload: GoalReviewRejectPayload];
}>();

const task = ref<TaskDetail>();
const loading = ref(false);
const error = ref('');
const draftIndicators = reactive<IndicatorInstance[]>([]);
const validationIndicatorIds = ref<string[]>([]);
const dirtyIndicatorIds = ref(new Set<string>());
let requestSerial = 0;
let taskSessionSerial = 0;
let saveOperationSerial = 0;
const draftRevision = ref(0);
const pendingSaveOperations = new Map<string, {
  taskId: string;
  taskSession: number;
  draftRevision: number;
}>();
const latestSaveOperationByTask = new Map<string, string>();

const latestRejection = computed(() => [...(task.value?.flowRecords ?? [])]
  .filter((record) => record.action === 'reject')
  .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]);
const rejectedIndicatorId = computed(() => (
  latestRejection.value ? draftIndicators[0]?.id : undefined
));
const indicatorIdsToReveal = computed(() => {
  const ids = [...validationIndicatorIds.value];
  if (rejectedIndicatorId.value && !ids.includes(rejectedIndicatorId.value)) {
    ids.push(rejectedIndicatorId.value);
  }
  return ids;
});
const totalWeight = computed(() => draftIndicators.reduce(
  (sum, indicator) => sum + Number(indicator.weight || 0),
  0,
));
const displayedWeightTotal = computed(() => normalizeDisplayedWeightTotal(totalWeight.value));
const hasValidWeight = computed(() => displayedWeightTotal.value.isExactlyOneHundredPercent);
const isReviewable = computed(() => (
  task.value?.status === 'indicator_reviewing' && !task.value.isExempt
));
const reviewRows = computed<PerformanceIndicatorRow[]>(() => draftIndicators.map((indicator) => ({
  id: indicator.id,
  name: indicator.name,
  weight: indicator.weight,
  visibilityScope: indicator.visibilityScope,
  statusLabel: task.value?.status === 'indicator_reviewing' ? '待审核' : '已处理',
  description: indicator.description,
  scoringStandard: indicator.scoringStandard,
  dataSource: indicator.dataSource,
  dataCaliber: indicator.dataCaliber,
  targetValue: indicator.targetValue,
  targetValueText: indicator.targetValueText,
  unit: indicator.unit,
  alignedObjectives: indicator.alignedObjectives,
  rejectionReason: indicator.id === rejectedIndicatorId.value
    ? latestRejection.value?.comment
    : undefined,
})));

function cloneIndicators(indicators: IndicatorInstance[]) {
  return indicators.map((indicator) => ({
    ...indicator,
    visibleDepartmentIds: [...indicator.visibleDepartmentIds],
    visibleUserIds: [...indicator.visibleUserIds],
    alignedObjectives: indicator.alignedObjectives.map((objective) => ({ ...objective })),
  }));
}

function replaceDraft(nextTask: TaskDetail) {
  task.value = nextTask;
  draftIndicators.splice(
    0,
    draftIndicators.length,
    ...cloneIndicators(nextTask.indicatorInstances ?? []),
  );
  validationIndicatorIds.value = [];
  dirtyIndicatorIds.value = new Set();
  draftRevision.value = 0;
}

function acknowledgeSavedTask(
  nextTask: TaskDetail,
  identity: GoalReviewSaveIdentity,
): GoalReviewSaveAcknowledgement {
  const operation = pendingSaveOperations.get(identity.operationToken);
  pendingSaveOperations.delete(identity.operationToken);
  if (
    !operation
    || operation.taskId !== nextTask.id
    || operation.draftRevision !== identity.draftRevision
    || latestSaveOperationByTask.get(nextTask.id) !== identity.operationToken
  ) return 'ignored';
  if (nextTask.id !== props.taskId || task.value?.id !== nextTask.id) return 'ignored';

  if (
    operation.taskSession === taskSessionSerial
    && operation.draftRevision === draftRevision.value
  ) {
    replaceDraft(nextTask);
    return 'replaced';
  }

  if (nextTask.updatedAt) task.value = { ...task.value, updatedAt: nextTask.updatedAt };
  return 'version-acknowledged';
}

async function loadTask() {
  const taskId = props.taskId;
  const requestId = ++requestSerial;
  const taskSession = ++taskSessionSerial;
  draftRevision.value = 0;
  loading.value = true;
  error.value = '';
  try {
    const response = await tasksApi.findOne(taskId);
    if (
      requestId !== requestSerial
      || taskSession !== taskSessionSerial
      || props.taskId !== taskId
    ) return;
    replaceDraft(response);
  } catch (loadError) {
    if (requestId !== requestSerial) return;
    const candidate = loadError as { message?: string; response?: { data?: { message?: string } } };
    error.value = candidate.response?.data?.message || candidate.message || '指标审核详情加载失败';
    task.value = undefined;
    draftIndicators.splice(0, draftIndicators.length);
  } finally {
    if (requestId === requestSerial) loading.value = false;
  }
}

function markDirty(indicatorId: string) {
  const next = new Set(dirtyIndicatorIds.value);
  next.add(indicatorId);
  dirtyIndicatorIds.value = next;
  draftRevision.value += 1;
}

function updateVisibility(index: number, selection: IndicatorVisibilitySelection) {
  const indicator = draftIndicators[index];
  if (!indicator) return;
  indicator.visibilityScope = selection.visibilityScope;
  indicator.visibleDepartmentIds = [...selection.visibleDepartmentIds];
  indicator.visibleUserIds = [...selection.visibleUserIds];
  markDirty(indicator.id);
}

function setWeightPercent(indicator: IndicatorInstance, value: number | undefined) {
  if (value == null || Number.isNaN(value)) return;
  indicator.weight = Number((value / 100).toFixed(6));
  markDirty(indicator.id);
}

function revealInvalid(indicatorId: string, message: string) {
  validationIndicatorIds.value = [];
  void nextTick(() => {
    validationIndicatorIds.value = [indicatorId];
  });
  ElMessage.error(message);
}

function validateIndicators(requireExactWeight: boolean): boolean {
  if (!draftIndicators.length) {
    ElMessage.error('请至少保留一条指标');
    return false;
  }
  const missingName = draftIndicators.find((indicator) => !indicator.name.trim());
  if (missingName) {
    revealInvalid(missingName.id, '请填写指标名称');
    return false;
  }
  const emptyCustom = draftIndicators.find((indicator) => (
    indicator.visibilityScope === 'custom'
    && indicator.visibleDepartmentIds.length === 0
    && indicator.visibleUserIds.length === 0
  ));
  if (emptyCustom) {
    revealInvalid(emptyCustom.id, '自定义可见范围至少选择一个部门或员工');
    return false;
  }
  if (requireExactWeight && !hasValidWeight.value) {
    revealInvalid(draftIndicators[0].id, '目标权重合计必须为 100%');
    return false;
  }
  return true;
}

function normalizeIds(ids: string[]): string[] {
  const normalized = new Map<string, string>();
  for (const rawId of ids) {
    const id = rawId.trim();
    if (!id) continue;
    const key = id.toLocaleLowerCase();
    if (!normalized.has(key)) normalized.set(key, id);
  }
  return [...normalized.values()];
}

function toSaveItem(indicator: IndicatorInstance, index: number): SetIndicatorBody['instances'][number] {
  const visibilityScope: IndicatorVisibilityScope = indicator.visibilityScope;
  return {
    templateIndicatorId: indicator.templateIndicatorId,
    name: indicator.name.trim(),
    description: indicator.description?.trim() || undefined,
    scoringStandard: indicator.scoringStandard?.trim() || undefined,
    dataSource: indicator.dataSource?.trim() || undefined,
    dataCaliber: indicator.dataCaliber?.trim() || undefined,
    targetValue: indicator.targetValue,
    targetValueText: indicator.targetValueText?.trim() || undefined,
    unit: indicator.unit?.trim() || undefined,
    weight: Number(indicator.weight || 0),
    indicatorType: indicator.indicatorType,
    dimensionName: indicator.dimensionName?.trim() || 'KPI维度',
    dimensionWeight: indicator.dimensionWeight,
    sortOrder: index,
    visibilityScope,
    visibleDepartmentIds: visibilityScope === 'custom'
      ? normalizeIds(indicator.visibleDepartmentIds)
      : [],
    visibleUserIds: visibilityScope === 'custom'
      ? normalizeIds(indicator.visibleUserIds)
      : [],
    alignedObjectiveIds: indicator.alignedObjectives.map((objective) => objective.id),
  };
}

function handleSave() {
  if (!isReviewable.value || !task.value?.updatedAt || !validateIndicators(false)) return;
  const operationToken = `${taskSessionSerial}:${++saveOperationSerial}`;
  const supersededToken = latestSaveOperationByTask.get(task.value.id);
  if (supersededToken) pendingSaveOperations.delete(supersededToken);
  pendingSaveOperations.set(operationToken, {
    taskId: task.value.id,
    taskSession: taskSessionSerial,
    draftRevision: draftRevision.value,
  });
  latestSaveOperationByTask.set(task.value.id, operationToken);
  emit('save', {
    taskId: task.value.id,
    expectedUpdatedAt: task.value.updatedAt,
    operationToken,
    draftRevision: draftRevision.value,
    body: {
      instances: draftIndicators.map(toSaveItem),
      action: 'save',
    },
  });
}

async function handleApprove() {
  if (!isReviewable.value || !task.value?.updatedAt || !validateIndicators(true)) return;
  if (dirtyIndicatorIds.value.size > 0) {
    revealInvalid([...dirtyIndicatorIds.value][0], '请先保存指标修改再通过审核');
    return;
  }
  try {
    await ElMessageBox.confirm('确认通过该员工的指标审核？', '通过指标审核', {
      confirmButtonText: '通过',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch (confirmError) {
    if (confirmError === 'cancel' || confirmError === 'close') return;
    throw confirmError;
  }
  emit('approve', {
    taskId: task.value.id,
    expectedUpdatedAt: task.value.updatedAt,
  });
}

async function handleReject() {
  if (!isReviewable.value || !task.value?.updatedAt) return;
  try {
    const { value } = await ElMessageBox.prompt('请输入驳回原因', '驳回指标审核', {
      confirmButtonText: '驳回',
      cancelButtonText: '取消',
      inputPlaceholder: '请输入驳回原因',
      inputPattern: /\S+/,
      inputErrorMessage: '请输入驳回原因',
      type: 'warning',
    });
    emit('reject', {
      taskId: task.value.id,
      expectedUpdatedAt: task.value.updatedAt,
      reason: value.trim(),
    });
  } catch (promptError) {
    if (promptError === 'cancel' || promptError === 'close') return;
  }
}

watch(
  () => props.taskId,
  () => {
    void loadTask();
  },
  { immediate: true },
);

defineExpose<GoalReviewWorkspaceHandle>({ reload: loadTask, acknowledgeSavedTask });
</script>

<template>
  <section class="goal-review" data-testid="goal-review-workspace">
    <div v-if="loading" class="goal-review__loading">
      <el-skeleton animated :rows="8" />
    </div>

    <el-result
      v-else-if="error"
      icon="error"
      title="指标审核详情加载失败"
      :sub-title="error"
    >
      <template #extra>
        <el-tooltip content="重新加载" placement="top">
          <el-button circle :icon="Refresh" aria-label="重新加载指标审核" @click="loadTask" />
        </el-tooltip>
      </template>
    </el-result>

    <template v-else-if="task">
      <header class="goal-review__header">
        <div>
          <h3>指标审核</h3>
          <span>{{ task.indicatorInstances.length }} 项 · {{ task.cycleName || '-' }}</span>
        </div>
        <div v-if="isReviewable" class="goal-review__actions">
          <el-tooltip content="保存修改" placement="top">
            <el-button
              :icon="Select"
              data-testid="goal-review-save"
              aria-label="保存指标修改"
              :loading="busy"
              @click="handleSave"
            />
          </el-tooltip>
          <el-tooltip content="通过审核" placement="top">
            <el-button
              type="success"
              :icon="Check"
              data-testid="goal-review-approve"
              aria-label="通过指标审核"
              :loading="busy"
              @click="handleApprove"
            />
          </el-tooltip>
          <el-tooltip content="驳回审核" placement="top">
            <el-button
              type="danger"
              :icon="Close"
              data-testid="goal-review-reject"
              aria-label="驳回指标审核"
              :loading="busy"
              @click="handleReject"
            />
          </el-tooltip>
        </div>
      </header>

      <div class="goal-review__layout">
        <div class="goal-review__main">
          <PerformanceIndicatorList
            :rows="reviewRows"
            :invalid-indicator-ids="indicatorIdsToReveal"
            :weight-total="totalWeight"
          >
            <template v-if="isReviewable" #visibility="{ index }">
              <IndicatorVisibilityEditor
                :model-value="{
                  visibilityScope: draftIndicators[index].visibilityScope,
                  visibleDepartmentIds: draftIndicators[index].visibleDepartmentIds,
                  visibleUserIds: draftIndicators[index].visibleUserIds,
                }"
                :indicator-id="draftIndicators[index].id"
                :departments="departments"
                :users="users"
                :disabled="busy"
                @update:model-value="updateVisibility(index, $event)"
              />
            </template>

            <template v-if="isReviewable" #details="{ index }">
              <div class="goal-review-editor">
                <label class="goal-review-editor__wide">
                  <span>指标名称</span>
                  <el-input
                    v-model="draftIndicators[index].name"
                    maxlength="100"
                    @input="markDirty(draftIndicators[index].id)"
                  />
                </label>
                <label>
                  <span>考核维度</span>
                  <el-input
                    v-model="draftIndicators[index].dimensionName"
                    maxlength="100"
                    @input="markDirty(draftIndicators[index].id)"
                  />
                </label>
                <label>
                  <span>权重</span>
                  <el-input-number
                    :model-value="Number((draftIndicators[index].weight * 100).toFixed(2))"
                    :min="0"
                    :max="100"
                    :step="5"
                    :precision="2"
                    controls-position="right"
                    @update:model-value="setWeightPercent(draftIndicators[index], $event)"
                  />
                </label>
                <label class="goal-review-editor__wide">
                  <span>指标描述</span>
                  <el-input
                    v-model="draftIndicators[index].description"
                    type="textarea"
                    :rows="2"
                    maxlength="300"
                    @input="markDirty(draftIndicators[index].id)"
                  />
                </label>
                <label>
                  <span>目标值</span>
                  <el-input
                    v-model="draftIndicators[index].targetValueText"
                    maxlength="100"
                    @input="markDirty(draftIndicators[index].id)"
                  />
                </label>
                <label>
                  <span>单位</span>
                  <el-input
                    v-model="draftIndicators[index].unit"
                    maxlength="30"
                    @input="markDirty(draftIndicators[index].id)"
                  />
                </label>
                <label class="goal-review-editor__wide">
                  <span>评分标准</span>
                  <el-input
                    v-model="draftIndicators[index].scoringStandard"
                    maxlength="300"
                    @input="markDirty(draftIndicators[index].id)"
                  />
                </label>
                <label>
                  <span>数据来源</span>
                  <el-input
                    v-model="draftIndicators[index].dataSource"
                    maxlength="100"
                    @input="markDirty(draftIndicators[index].id)"
                  />
                </label>
                <label>
                  <span>完成口径</span>
                  <el-input
                    v-model="draftIndicators[index].dataCaliber"
                    maxlength="100"
                    @input="markDirty(draftIndicators[index].id)"
                  />
                </label>
              </div>
            </template>
          </PerformanceIndicatorList>
        </div>

        <div class="goal-review__reference">
          <PerformanceReferencePanel
            :cycle-id="task.cycleId"
            :employee-id="task.employeeId"
            :indicators="task.indicatorInstances"
            :flow-records="task.flowRecords"
          />
        </div>
      </div>
    </template>

    <el-empty v-else :image-size="52" description="暂无指标审核详情" />
  </section>
</template>

<style scoped>
.goal-review {
  min-width: 0;
  border-top: 1px solid #e5e9ef;
  container: goal-review / inline-size;
}

.goal-review__loading {
  min-height: 420px;
  padding: 18px;
}

.goal-review__header {
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 14px;
  border-bottom: 1px solid #e5e9ef;
}

.goal-review__header > div:first-child {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.goal-review__header h3 {
  margin: 0;
  color: #273247;
  font-size: 14px;
}

.goal-review__header span {
  color: #7a8495;
  font-size: 11px;
}

.goal-review__actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.goal-review__layout {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(230px, 280px);
  grid-template-areas: "main reference";
}

.goal-review__main {
  grid-area: main;
  min-width: 0;
  padding: 12px 14px 16px;
}

.goal-review__reference {
  grid-area: reference;
  min-width: 0;
}

.goal-review__reference :deep(.performance-reference) {
  height: 100%;
}

.goal-review-editor {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
}

.goal-review-editor label {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 5px;
}

.goal-review-editor label > span {
  color: #687386;
  font-size: 11px;
}

.goal-review-editor__wide {
  grid-column: 1 / -1;
}

.goal-review-editor :deep(.el-input-number) {
  width: 100%;
}

@container goal-review (max-width: 1024px) {
  .goal-review__layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "reference"
      "main";
  }

  .goal-review__reference :deep(.performance-reference) {
    border-top: 1px solid #e2e6ec;
    border-left: 0;
  }
}

@container goal-review (max-width: 620px) {
  .goal-review__header {
    align-items: flex-start;
    padding: 9px 10px;
  }

  .goal-review__header > div:first-child {
    display: grid;
    gap: 3px;
  }

  .goal-review__actions {
    gap: 2px;
  }

  .goal-review__main {
    padding: 8px;
  }

  .goal-review-editor {
    grid-template-columns: minmax(0, 1fr);
  }

  .goal-review-editor__wide {
    grid-column: auto;
  }
}
</style>
