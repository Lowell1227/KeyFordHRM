<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { Check, Close, Refresh, Select } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { tasksApi } from '@/api/tasks.api';
import { useAuthStore } from '@/stores/auth.store';
import type { IndicatorInstance, SetIndicatorBody, TaskDetail } from '@/types/api.types';
import type { IndicatorVisibilityScope } from '@/types/enums';
import type { PerformanceIndicatorRow } from './PerformanceIndicatorList.vue';
import PerformanceReviewTable, {
  type PerformanceReviewColumn,
} from './PerformanceReviewTable.vue';
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
const auth = useAuthStore();
const loading = ref(false);
const error = ref('');
const referenceOpen = ref(false);
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
const goalReviewColumns: PerformanceReviewColumn[] = [
  { key: 'indicator', label: '名称', width: 'minmax(170px, .95fr)' },
  { key: 'weight', label: '权重', width: '88px' },
  { key: 'description', label: '指标描述', width: 'minmax(320px, 1.55fr)' },
  { key: 'primary', label: '对齐', width: 'minmax(150px, .75fr)' },
  { key: 'secondary', label: '可见范围', width: 'minmax(180px, .85fr)' },
];
const visibilityScopeLabels: Record<IndicatorVisibilityScope, string> = {
  company: '全公司可见',
  department: '部门内可见',
  department_tree: '部门及下级可见',
  direct_reports: '直接下级可见',
  all_reports: '所有下级可见',
  supervisors: '仅上级可见',
  custom: '自定义范围',
};
const isReviewable = computed(() => (
  task.value?.status === 'indicator_reviewing'
  && !task.value.isExempt
  && Boolean(auth.user?.id && task.value.managerId === auth.user.id)
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
    error.value = candidate.response?.data?.message || candidate.message || '目标审核详情加载失败';
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
    await ElMessageBox.confirm('确认通过该员工的目标审核？', '通过目标审核', {
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
    const { value } = await ElMessageBox.prompt('请输入驳回原因', '驳回目标审核', {
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
      title="目标审核详情加载失败"
      :sub-title="error"
    >
      <template #extra>
        <el-tooltip content="重新加载" placement="top">
          <el-button circle :icon="Refresh" aria-label="重新加载目标审核" @click="loadTask" />
        </el-tooltip>
      </template>
    </el-result>

    <template v-else-if="task">
      <header class="goal-review__header">
        <div>
          <h3>考核指标</h3>
          <span>{{ task.indicatorInstances.length }} 项 · {{ task.cycleName || '-' }}</span>
        </div>
        <div class="goal-review__actions">
          <el-button
            data-testid="goal-review-reference-open"
            @click="referenceOpen = true"
          >
            参考信息
          </el-button>
          <template v-if="isReviewable">
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
                aria-label="通过目标审核"
                :loading="busy"
                @click="handleApprove"
              />
            </el-tooltip>
            <el-tooltip content="驳回审核" placement="top">
              <el-button
                type="danger"
                :icon="Close"
                data-testid="goal-review-reject"
                aria-label="驳回目标审核"
                :loading="busy"
                @click="handleReject"
              />
            </el-tooltip>
          </template>
        </div>
      </header>

      <PerformanceReviewTable
        :rows="reviewRows"
        :columns="goalReviewColumns"
        :invalid-indicator-ids="indicatorIdsToReveal"
        :weight-total="totalWeight"
      >
        <template #cell-indicator="{ index }">
          <div class="goal-review-cell goal-review-cell--name">
            <span class="goal-review-cell__index">{{ index + 1 }}</span>
            <div>
              <el-input
                v-if="isReviewable"
                v-model="draftIndicators[index].name"
                maxlength="100"
                aria-label="指标名称"
                @input="markDirty(draftIndicators[index].id)"
              />
              <strong v-else>{{ draftIndicators[index].name || '未命名指标' }}</strong>
              <label v-if="isReviewable" class="goal-review-cell__compact-field">
                <span>考核维度</span>
                <el-input
                  v-model="draftIndicators[index].dimensionName"
                  maxlength="100"
                  @input="markDirty(draftIndicators[index].id)"
                />
              </label>
              <small v-else>{{ draftIndicators[index].dimensionName || '未设置维度' }}</small>
            </div>
          </div>
        </template>

        <template #cell-weight="{ index }">
          <el-input-number
            v-if="isReviewable"
            :model-value="Number((draftIndicators[index].weight * 100).toFixed(2))"
            :min="0"
            :max="100"
            :step="5"
            :precision="2"
            controls-position="right"
            aria-label="权重"
            @update:model-value="setWeightPercent(draftIndicators[index], $event)"
          />
          <span v-else>{{ Number((draftIndicators[index].weight * 100).toFixed(2)) }}%</span>
        </template>

        <template #cell-description="{ index }">
          <div class="goal-review-cell__stack">
            <el-input
              v-if="isReviewable"
              v-model="draftIndicators[index].description"
              type="textarea"
              :rows="2"
              maxlength="300"
              aria-label="指标描述"
              @input="markDirty(draftIndicators[index].id)"
            />
            <p v-else>{{ draftIndicators[index].description || '-' }}</p>

            <div class="goal-review-cell__facts">
              <label>
                <span>目标值</span>
                <el-input
                  v-if="isReviewable"
                  v-model="draftIndicators[index].targetValueText"
                  maxlength="100"
                  @input="markDirty(draftIndicators[index].id)"
                />
                <strong v-else>{{ draftIndicators[index].targetValueText || '-' }}</strong>
              </label>
              <label>
                <span>单位</span>
                <el-input
                  v-if="isReviewable"
                  v-model="draftIndicators[index].unit"
                  maxlength="30"
                  @input="markDirty(draftIndicators[index].id)"
                />
                <strong v-else>{{ draftIndicators[index].unit || '-' }}</strong>
              </label>
              <label class="is-wide">
                <span>评分标准</span>
                <el-input
                  v-if="isReviewable"
                  v-model="draftIndicators[index].scoringStandard"
                  maxlength="300"
                  @input="markDirty(draftIndicators[index].id)"
                />
                <strong v-else>{{ draftIndicators[index].scoringStandard || '-' }}</strong>
              </label>
              <label>
                <span>数据来源</span>
                <el-input
                  v-if="isReviewable"
                  v-model="draftIndicators[index].dataSource"
                  maxlength="100"
                  @input="markDirty(draftIndicators[index].id)"
                />
                <strong v-else>{{ draftIndicators[index].dataSource || '-' }}</strong>
              </label>
              <label>
                <span>完成口径</span>
                <el-input
                  v-if="isReviewable"
                  v-model="draftIndicators[index].dataCaliber"
                  maxlength="100"
                  @input="markDirty(draftIndicators[index].id)"
                />
                <strong v-else>{{ draftIndicators[index].dataCaliber || '-' }}</strong>
              </label>
            </div>
          </div>
        </template>

        <template #cell-primary="{ row }">
          <span>{{ row.alignedObjectives?.map((objective) => objective.title).join('、') || '-' }}</span>
        </template>

        <template #cell-secondary="{ index }">
          <IndicatorVisibilityEditor
            v-if="isReviewable"
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
          <span v-else>{{ visibilityScopeLabels[draftIndicators[index].visibilityScope] }}</span>
        </template>
      </PerformanceReviewTable>

      <el-drawer
        v-model="referenceOpen"
        title="参考信息"
        size="430px"
        class="goal-review-reference-drawer"
      >
        <PerformanceReferencePanel
          :cycle-id="task.cycleId"
          :employee-id="task.employeeId"
          :indicators="task.indicatorInstances"
          :flow-records="task.flowRecords"
        />
      </el-drawer>
    </template>

    <el-empty v-else :image-size="52" description="暂无目标审核详情" />
  </section>
</template>

<style scoped>
.goal-review {
  min-width: 0;
  overflow: hidden;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(31 45 61 / 4%);
  container: goal-review / inline-size;
}

.goal-review__loading {
  min-height: 420px;
  padding: 18px;
}

.goal-review__header {
  min-height: 62px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 18px;
}

.goal-review__header > div:first-child {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.goal-review__header h3 {
  margin: 0;
  color: #20283a;
  font-size: 18px;
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

.goal-review-cell,
.goal-review-cell--name,
.goal-review-cell--name > div,
.goal-review-cell__stack,
.goal-review-cell__compact-field,
.goal-review-cell__facts label {
  min-width: 0;
}

.goal-review-cell--name {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.goal-review-cell--name > div,
.goal-review-cell__stack,
.goal-review-cell__compact-field,
.goal-review-cell__facts label {
  display: grid;
  gap: 5px;
}

.goal-review-cell__index {
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

.goal-review-cell--name strong {
  color: #273247;
  font-size: 14px;
}

.goal-review-cell--name small,
.goal-review-cell__compact-field > span,
.goal-review-cell__facts label > span {
  color: #8a94a6;
  font-size: 11px;
}

.goal-review-cell__compact-field {
  margin-top: 8px;
}

.goal-review-cell__stack p {
  margin: 0;
  white-space: pre-wrap;
}

.goal-review-cell__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 8px;
}

.goal-review-cell__facts .is-wide {
  grid-column: 1 / -1;
}

.goal-review-cell__facts strong {
  color: #5f6a7d;
  font-size: 12px;
  font-weight: 400;
}

.goal-review :deep(.performance-review-table) {
  border-top: 1px solid #edf0f5;
}

.goal-review :deep(.performance-review-table .el-input-number),
.goal-review :deep(.performance-review-table .el-input),
.goal-review :deep(.performance-review-table .el-select) {
  width: 100%;
  max-width: 100%;
}

.goal-review :deep(.performance-review-table .el-input__wrapper),
.goal-review :deep(.performance-review-table .el-textarea__inner) {
  box-shadow: 0 0 0 1px #e4e9f1 inset;
}

:global(.goal-review-reference-drawer .el-drawer__body) {
  padding: 0;
}

:global(.goal-review-reference-drawer .performance-reference) {
  min-height: 100%;
  border-left: 0;
}

@container goal-review (max-width: 720px) {
  .goal-review__header {
    align-items: flex-start;
    padding: 12px;
  }

  .goal-review__header > div:first-child {
    display: grid;
    gap: 3px;
  }

  .goal-review__actions {
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 2px;
  }

  .goal-review-cell__facts {
    grid-template-columns: minmax(0, 1fr);
  }

  .goal-review-cell__facts .is-wide {
    grid-column: auto;
  }
}
</style>
