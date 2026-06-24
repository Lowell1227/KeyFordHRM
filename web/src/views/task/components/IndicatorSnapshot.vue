<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Check, Close, Delete, Plus } from '@element-plus/icons-vue';
import RejectModal from './RejectModal.vue';
import ScoreInput from '@/components/common/ScoreInput.vue';
import FileUpload from '@/components/common/FileUpload.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import { indicatorsApi } from '@/api/indicators.api';
import { templatesApi } from '@/api/templates.api';
import { uploadApi } from '@/api/upload.api';
import type {
  AssessmentTemplate,
  Attachment,
  FlowRecord,
  Indicator,
  IndicatorInstance,
  SetIndicatorBody,
  SelfEvalSummary,
  SubmitSelfEvalBody,
  TemplateIndicator,
  TemplateListItem,
} from '@/types/api.types';
import type { DimensionType, IndicatorType } from '@/types/enums';
import { isValidScore } from '@/utils/score';

export interface ActualValueItem {
  id: string;
  actualValue?: string;
  actualNote?: string;
}

interface SelfEvalRow {
  id: string;
  name: string;
  description?: string;
  scoringStandard?: string;
  dataSource?: string;
  dataCaliber?: string;
  targetValue?: number;
  unit?: string;
  weight: number;
  dimensionName?: string;
  actualValue?: string;
  actualNote: string;
  selfScore: number | null;
  selfComment: string;
}

const props = defineProps<{
  instances: IndicatorInstance[];
  canEdit?: boolean;
  canConfirm: boolean;
  canReject?: boolean;
  title?: string;
  description?: string;
  deptId?: string | null;
  employeeId?: string | null;
  canUseTemplate?: boolean;
  flowRecords?: FlowRecord[];
  loading?: boolean;
  saveLabel?: string;
  submitLabel?: string;
  confirmLabel?: string;
  rejectLabel?: string;
  splitSaveActions?: boolean;
  selfEvalMode?: boolean;
  selfEvalReadonly?: boolean;
  selfEvalSummary?: SelfEvalSummary | null;
}>();

const emit = defineEmits<{
  (e: 'save', body: SetIndicatorBody): void;
  (e: 'confirm'): void;
  (e: 'reject', reason: string): void;
  (e: 'submit-self-eval', body: SubmitSelfEvalBody, actualValues: ActualValueItem[]): void;
}>();

const rejectVisible = ref(false);
const editableItems = reactive<SetIndicatorBody['instances']>([]);
const note = ref('');
const indicators = ref<Indicator[]>([]);
const templates = ref<TemplateListItem[]>([]);
const selectedTemplateId = ref('');
const referenceLoading = ref(false);
const templateLoading = ref(false);
const applyingTemplate = ref(false);
const indicatorSearchKeyword = ref('');
const indicatorPickerVisible = ref(false);
const indicatorsLoaded = ref(false);
const templatesLoaded = ref(false);
const templatesUnavailable = ref(false);
const weightHoldTimer = ref<number | null>(null);
const weightRepeatTimer = ref<number | null>(null);
const selfEvalRows = reactive<SelfEvalRow[]>([]);
const selfEvalForm = reactive({
  achievements: '',
  improvements: '',
  suggestions: '',
  nextGoals: '',
  supportNeeded: '',
  attachments: [] as Attachment[],
});

const indicatorOptions = computed(() => {
  const keyword = indicatorSearchKeyword.value.trim().toLowerCase();
  return indicators.value
    .filter((item) => {
      if (!keyword) return true;
      return [
        item.name,
        item.description,
        item.category,
        item.groupName,
        item.scoringStandard,
        item.dataSource,
        item.dataCaliber,
        item.code,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    })
    .map((item) => ({
      value: item.id,
      label: `${item.name}${item.code ? `（${item.code}）` : ''}`,
      item,
    }));
});

const sortedTemplates = computed(() => {
  const deptId = props.deptId;
  const employeeId = props.employeeId;
  return [...templates.value].sort((a, b) => Number(templateMatchesContext(b, deptId, employeeId)) - Number(templateMatchesContext(a, deptId, employeeId)));
});

const weightTotalPercent = computed(() =>
  editableItems.reduce((sum, item) => sum + Number(item.weight ?? 0) * 100, 0),
);

const isWeightOverLimit = computed(() => weightTotalPercent.value > 100.0001);

const indicatorOperationNodeTypes = ['indicator_setting', 'indicator_confirm'];

const operationRecords = computed(() =>
  (props.flowRecords ?? [])
    .filter((record) => indicatorOperationNodeTypes.includes(String(record.nodeType)))
    .map((record) => ({
      id: record.id,
      actorName: record.actorName || '系统',
      createdAt: record.createdAt,
      note: record.comment ?? '',
      summary: formatOperationRecord(record),
    })),
);

const readonlyTableRows = computed<Array<IndicatorInstance | SelfEvalRow>>(() =>
  props.selfEvalMode ? selfEvalRows : props.instances,
);

watch(
  () => [props.instances, props.selfEvalSummary],
  () => initSelfEvalForm(),
  { immediate: true, deep: true },
);

watch(
  () => props.instances,
  (instances) => {
    editableItems.splice(
      0,
      editableItems.length,
      ...(instances.length ? instances.map(toEditableItem) : [createEmptyItem()]),
    );
    note.value = '';
  },
  { immediate: true, deep: true },
);

watch(
  () => props.canEdit,
  (canEdit) => {
    if (canEdit) {
      loadIndicatorReferences();
      if (props.canUseTemplate) loadTemplateReferences();
    }
  },
  { immediate: true },
);

function initSelfEvalForm() {
  selfEvalRows.splice(
    0,
    selfEvalRows.length,
    ...(props.instances ?? []).map((inst) => ({
      id: inst.id,
      name: inst.name,
      description: inst.description,
      scoringStandard: inst.scoringStandard,
      dataSource: inst.dataSource,
      dataCaliber: inst.dataCaliber,
      targetValue: inst.targetValue,
      unit: inst.unit,
      weight: inst.weight,
      dimensionName: inst.dimensionName,
      actualValue: inst.actualValue ?? undefined,
      actualNote: inst.actualNote ?? '',
      selfScore: inst.selfScore ?? null,
      selfComment: inst.selfComment ?? '',
    })),
  );
  selfEvalForm.achievements = props.selfEvalSummary?.achievements ?? '';
  selfEvalForm.improvements = props.selfEvalSummary?.improvements ?? '';
  selfEvalForm.suggestions = props.selfEvalSummary?.suggestions ?? '';
  selfEvalForm.nextGoals = props.selfEvalSummary?.nextGoals ?? '';
  selfEvalForm.supportNeeded = props.selfEvalSummary?.supportNeeded ?? '';
  selfEvalForm.attachments = props.selfEvalSummary?.attachments ? [...props.selfEvalSummary.attachments] : [];
}

function templateMatchesContext(template: TemplateListItem, deptId?: string | null, employeeId?: string | null): boolean {
  const matchesDept = !!deptId && (template.applicableDepts ?? []).includes(deptId);
  const matchesUser = !!employeeId && (template.applicableUsers ?? []).includes(employeeId);
  const isCommon = !(template.applicableDepts?.length || template.applicableUsers?.length);
  return matchesDept || matchesUser || isCommon;
}

function formatOperationRecord(record: FlowRecord): string {
  const type = String(record.extraData?.type ?? '');
  const count = Number(record.extraData?.count ?? 0);
  const countText = count > 0 ? `了 ${count} 条指标` : '';

  if (type === 'indicator_formal_submitted') {
    return record.extraData?.employeeConfirmedBeforeReview ? `保存并审核${countText}，指标确认完成` : `保存并审核${countText}`;
  }
  if (type === 'indicator_employee_submitted') {
    return `提交主管审核${countText}`;
  }
  if (type === 'indicator_review_saved') {
    return `保存审核调整${countText}`;
  }
  if (type === 'indicator_review_approved') {
    return `审核通过${countText}`;
  }
  if (type === 'indicator_draft_saved') {
    return `保存草稿${countText}`;
  }
  if (type === 'indicator_employee_confirmed') {
    return `提交指标${countText}`;
  }
  if (type === 'indicator_employee_confirmed' || type === 'indicator_draft_saved') {
    return `保存并确认${countText}`;
  }
  if (record.action === 'reject') {
    return '退回指标';
  }
  if (record.action === 'submit' && record.nodeType === 'indicator_confirm') {
    return '确认指标';
  }
  if (record.action === 'submit') {
    return `提交指标${countText}`;
  }
  return `操作${countText}`;
}

async function loadIndicatorReferences() {
  if (referenceLoading.value || indicatorsLoaded.value) return;
  referenceLoading.value = true;
  try {
    const result = await indicatorsApi.findAll({ page: 1, pageSize: 100, isActive: true });
    indicators.value = result.items.filter((item) => item.isActive);
    indicatorsLoaded.value = true;
  } catch {
    ElMessage.warning('指标库加载失败，可先添加空白指标。');
  } finally {
    referenceLoading.value = false;
  }
}

async function loadTemplateReferences() {
  if (templateLoading.value || templatesLoaded.value || templatesUnavailable.value) return;
  templateLoading.value = true;
  try {
    const result = await templatesApi.findAll({ page: 1, pageSize: 100, isActive: true });
    templates.value = result.items.filter((item) => item.isActive);
    templatesLoaded.value = true;
  } catch {
    templatesUnavailable.value = true;
  } finally {
    templateLoading.value = false;
  }
}

async function loadReferences() {
  if (referenceLoading.value || (indicators.value.length && templates.value.length)) return;
  referenceLoading.value = true;
  try {
    const [indicatorRes, templateRes] = await Promise.allSettled([
      indicatorsApi.findAll({ page: 1, pageSize: 100, isActive: true }),
      templatesApi.findAll({ page: 1, pageSize: 100, isActive: true }),
    ]);

    if (indicatorRes.status === 'fulfilled') {
      indicators.value = indicatorRes.value.items.filter((item) => item.isActive);
    }
    if (templateRes.status === 'fulfilled') {
      templates.value = templateRes.value.items.filter((item) => item.isActive);
    }
    if (indicatorRes.status === 'rejected' || templateRes.status === 'rejected') {
      ElMessage.warning('部分参考数据加载失败，可先手工编辑指标。');
    }
  } catch {
    ElMessage.warning('指标库或考核模板加载失败，可先手工编辑指标。');
  } finally {
    referenceLoading.value = false;
  }
}

function createEmptyItem(): SetIndicatorBody['instances'][number] {
  return {
    name: '',
    description: '',
    scoringStandard: '',
    dataSource: '',
    dataCaliber: '',
    targetValue: undefined,
    unit: '',
    weight: 1,
    indicatorType: 'kpi',
    dimensionName: 'KPI维度',
    dimensionWeight: 1,
    sortOrder: 0,
  };
}

function toIndicatorType(type: DimensionType | IndicatorType): IndicatorType {
  return type;
}

function libraryIndicatorToItem(indicator: Indicator, sortOrder: number): SetIndicatorBody['instances'][number] {
  return {
    name: indicator.name,
    description: indicator.description,
    scoringStandard: indicator.scoringStandard,
    dataSource: indicator.dataSource,
    dataCaliber: indicator.dataCaliber,
    targetValue: indicator.targetValue,
    unit: indicator.unit,
    weight: editableItems.length ? Number((1 / (editableItems.length + 1)).toFixed(4)) : 1,
    indicatorType: indicator.type,
    dimensionName: indicator.category || indicator.groupName || 'KPI维度',
    dimensionWeight: 1,
    sortOrder,
  };
}

function openIndicatorPicker() {
  loadIndicatorReferences();
}

function addLibraryIndicator(indicatorId: string) {
  const indicator = indicators.value.find((item) => item.id === indicatorId);
  if (!indicator) return;
  editableItems.push(libraryIndicatorToItem(indicator, editableItems.length));
  indicatorSearchKeyword.value = '';
  indicatorPickerVisible.value = false;
}

function addBlankIndicator() {
  addItem();
  indicatorSearchKeyword.value = '';
  indicatorPickerVisible.value = false;
}

function templateIndicatorToItem(
  indicator: TemplateIndicator,
  dimensionName: string,
  dimensionType: DimensionType,
  dimensionWeight: number,
  sortOrder: number,
): SetIndicatorBody['instances'][number] {
  return {
    templateIndicatorId: indicator.id,
    name: indicator.name,
    description: indicator.description,
    scoringStandard: indicator.scoringStandard,
    dataSource: indicator.dataSource,
    dataCaliber: indicator.dataCaliber,
    targetValue: indicator.targetValue,
    unit: indicator.unit,
    weight: indicator.weight,
    indicatorType: toIndicatorType(dimensionType),
    dimensionName,
    dimensionWeight,
    sortOrder,
  };
}

function templateToEditableItems(template: AssessmentTemplate): SetIndicatorBody['instances'] {
  return template.dimensions.flatMap((dimension) =>
    dimension.indicators.map((indicator, index) =>
      templateIndicatorToItem(
        indicator,
        dimension.name,
        dimension.type,
        dimension.weight,
        dimension.sortOrder * 100 + index,
      ),
    ),
  );
}

async function applyTemplate() {
  if (!selectedTemplateId.value) {
    ElMessage.warning('请先选择考核模板');
    return;
  }
  applyingTemplate.value = true;
  try {
    const template = await templatesApi.findOne(selectedTemplateId.value);
    const items = templateToEditableItems(template);
    if (!items.length) {
      ElMessage.warning('该模板没有可套用的指标');
      return;
    }
    editableItems.splice(0, editableItems.length, ...items);
    note.value = `参考模板：${template.name}`;
    ElMessage.success(`已套用模板「${template.name}」`);
  } finally {
    applyingTemplate.value = false;
  }
}

function toEditableItem(instance: IndicatorInstance): SetIndicatorBody['instances'][number] {
  return {
    templateIndicatorId: instance.templateIndicatorId,
    name: instance.name,
    description: instance.description,
    scoringStandard: instance.scoringStandard,
    dataSource: instance.dataSource,
    dataCaliber: instance.dataCaliber,
    targetValue: instance.targetValue,
    unit: instance.unit,
    weight: instance.weight,
    indicatorType: instance.indicatorType,
    dimensionName: instance.dimensionName || 'KPI维度',
    dimensionWeight: instance.dimensionWeight,
    sortOrder: instance.sortOrder,
  };
}

function addItem() {
  editableItems.push({
    ...createEmptyItem(),
    weight: editableItems.length ? Number((1 / (editableItems.length + 1)).toFixed(4)) : 1,
    sortOrder: editableItems.length,
  });
}

function removeItem(index: number) {
  if (editableItems.length === 1) {
    editableItems[0] = createEmptyItem();
    return;
  }
  editableItems.splice(index, 1);
}

function formatWeightPercent(weight: number | undefined): string {
  const percent = Number(weight ?? 0) * 100;
  return `${Number(percent.toFixed(2))}%`;
}

function toPercent(weight: number | undefined): number {
  return Number(((weight ?? 0) * 100).toFixed(2));
}

function setWeightPercent(row: unknown, value: number | undefined) {
  if (value == null || Number.isNaN(value)) return;
  const item = row as SetIndicatorBody['instances'][number];
  item.weight = Number((value / 100).toFixed(6));
}

function adjustWeightPercent(row: unknown, deltaPercent: number) {
  const item = row as SetIndicatorBody['instances'][number];
  const current = toPercent(item.weight);
  const next = Math.min(100, Math.max(0, Number((current + deltaPercent).toFixed(2))));
  setWeightPercent(item, next);
}

function clearWeightHold() {
  if (weightHoldTimer.value != null) {
    window.clearTimeout(weightHoldTimer.value);
    weightHoldTimer.value = null;
  }
  if (weightRepeatTimer.value != null) {
    window.clearInterval(weightRepeatTimer.value);
    weightRepeatTimer.value = null;
  }
}

function handleWeightControlPointerDown(row: unknown, event: PointerEvent) {
  const target = event.target as HTMLElement | null;
  const increase = target?.closest('.el-input-number__increase');
  const decrease = target?.closest('.el-input-number__decrease');
  if (!increase && !decrease) return;

  event.preventDefault();
  event.stopPropagation();
  clearWeightHold();

  const direction = increase ? 1 : -1;
  adjustWeightPercent(row, direction * 5);
  weightHoldTimer.value = window.setTimeout(() => {
    adjustWeightPercent(row, direction * 10);
    weightRepeatTimer.value = window.setInterval(() => {
      adjustWeightPercent(row, direction * 10);
    }, 180);
  }, 450);
}

function trimItem(item: SetIndicatorBody['instances'][number], index: number): SetIndicatorBody['instances'][number] {
  return {
    templateIndicatorId: item.templateIndicatorId,
    name: item.name?.trim() ?? '',
    description: item.description?.trim() || undefined,
    scoringStandard: item.scoringStandard?.trim() || undefined,
    dataSource: item.dataSource?.trim() || undefined,
    dataCaliber: item.dataCaliber?.trim() || undefined,
    targetValue: item.targetValue,
    unit: item.unit?.trim() || undefined,
    weight: Number(item.weight ?? 0),
    indicatorType: item.indicatorType ?? 'kpi',
    dimensionName: item.dimensionName?.trim() || 'KPI维度',
    dimensionWeight: Number(item.dimensionWeight ?? 1),
    sortOrder: index,
  };
}

onBeforeUnmount(() => {
  clearWeightHold();
});

function buildIndicatorBody(action: 'save' | 'submit'): SetIndicatorBody | null {
  const instances = editableItems.map(trimItem).filter((item) => item.name);
  if (!instances.length) {
    ElMessage.warning('请至少填写一条指标');
    return null;
  }
  if (isWeightOverLimit.value) {
    ElMessage.warning(`指标权重合计不能超过 100%，当前为 ${weightTotalPercent.value.toFixed(2)}%。`);
    return null;
  }
  return {
    instances,
    action,
    note: note.value.trim() || undefined,
  };
}

function handleSave(action: 'save' | 'submit' = 'submit') {
  const body = buildIndicatorBody(action);
  if (!body) return;
  emit('save', body);
}

async function handleConfirm() {
  try {
    await ElMessageBox.confirm(
      '确认后指标将锁定并进入自评阶段，是否继续？',
      '确认指标',
      { type: 'warning', confirmButtonText: '确认' },
    );
  } catch {
    return;
  }
  emit('confirm');
}

function handleReject(reason: string) {
  rejectVisible.value = false;
  emit('reject', reason);
}

function validateSelfEval(): boolean {
  for (const row of selfEvalRows) {
    if (row.selfScore == null || !isValidScore(row.selfScore)) {
      ElMessage.warning(`请为指标「${row.name}」录入有效的自评分数（0-100）`);
      return false;
    }
  }
  return true;
}

function buildSelfEvalBody(): SubmitSelfEvalBody {
  return {
    indicators: selfEvalRows.map((row) => ({
      id: row.id,
      selfScore: row.selfScore as number,
      selfComment: row.selfComment?.trim() || undefined,
    })),
    summary: {
      achievements: selfEvalForm.achievements.trim() || undefined,
      improvements: selfEvalForm.improvements.trim() || undefined,
      suggestions: selfEvalForm.suggestions.trim() || undefined,
      nextGoals: selfEvalForm.nextGoals.trim() || undefined,
      supportNeeded: selfEvalForm.supportNeeded.trim() || undefined,
      attachments: selfEvalForm.attachments.length ? selfEvalForm.attachments : undefined,
    },
  };
}

function buildActualValues(): ActualValueItem[] {
  return selfEvalRows
    .filter((row) => row.actualValue != null || row.actualNote)
    .map((row) => ({
      id: row.id,
      actualValue: row.actualValue?.trim() || undefined,
      actualNote: row.actualNote?.trim() || undefined,
    }));
}

function handleSubmitSelfEval() {
  if (!validateSelfEval()) return;
  emit('submit-self-eval', buildSelfEvalBody(), buildActualValues());
}

async function handleUpload(files: File[]) {
  for (const file of files) {
    try {
      const attachment = await uploadApi.upload(file);
      selfEvalForm.attachments.push(attachment);
      ElMessage.success(`「${file.name}」上传成功`);
    } catch {
      ElMessage.error(`「${file.name}」上传失败`);
    }
  }
}

function handleAttachmentsChange(attachments: Attachment[]) {
  selfEvalForm.attachments = attachments;
}

function handleFetchDingtalkWeekly() {
  ElMessage.info('暂无钉钉周报数据，可继续手动填写。');
}
</script>

<template>
  <ChartCard class="indicator-snapshot">
    <template #title>{{ title || '考核指标明细' }}</template>
    <template #extra>
      <div v-if="canConfirm || canReject" class="actions">
        <el-button v-if="canConfirm" type="success" :icon="Check" :loading="loading" @click="handleConfirm">
          {{ confirmLabel || '确认指标' }}
        </el-button>
        <el-button v-if="canConfirm || canReject" type="danger" :icon="Close" :loading="loading" @click="rejectVisible = true">
          {{ rejectLabel || '退回指标' }}
        </el-button>
      </div>
    </template>

    <div v-if="description || canEdit" class="snapshot-toolbar">
      <div v-if="description" class="snapshot-desc">{{ description }}</div>
      <div v-if="canEdit" class="snapshot-toolbar__actions">
        <template v-if="splitSaveActions">
          <el-button :loading="loading" @click="handleSave('save')">保存</el-button>
          <el-button type="primary" :loading="loading" @click="handleSave('submit')">{{ submitLabel || saveLabel || '提交' }}</el-button>
        </template>
        <el-button v-else class="snapshot-toolbar__save" type="primary" :loading="loading" @click="handleSave('submit')">
        {{ saveLabel || '保存指标' }}
        </el-button>
      </div>
    </div>

    <template v-if="canEdit">
      <div class="weight-summary" :class="{ 'weight-summary--danger': isWeightOverLimit }">
        权重合计：{{ weightTotalPercent.toFixed(2) }}% / 100%
      </div>

      <el-table :data="editableItems" border size="small" class="indicator-table">
        <el-table-column label="序号" type="index" width="56" fixed="left" />
        <el-table-column label="考核维度" min-width="130">
          <template #default="{ row }">
            <el-input v-model="row.dimensionName" placeholder="考核维度" maxlength="100" />
          </template>
        </el-table-column>
        <el-table-column label="指标" min-width="680">
          <template #default="{ row }">
            <div class="indicator-editor">
              <div class="indicator-fields">
                <div class="indicator-field">
                  <span class="indicator-field__label">指标名称</span>
                  <el-input v-model="row.name" placeholder="请输入指标名称" maxlength="100" />
                </div>
                <div class="indicator-field">
                  <span class="indicator-field__label">指标描述</span>
                  <el-input
                    v-model="row.description"
                    placeholder="请输入指标描述，例如：按阶段完成验证"
                    maxlength="300"
                  />
                </div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="权重" width="104">
          <template #default="{ row }">
            <el-input-number
              class="weight-input"
              :model-value="toPercent(row.weight)"
              :min="0"
              :max="100"
              :step="5"
              :precision="2"
              controls-position="right"
              @pointerdown.capture="(event: PointerEvent) => handleWeightControlPointerDown(row, event)"
              @pointerup.capture="clearWeightHold"
              @pointerleave.capture="clearWeightHold"
              @pointercancel.capture="clearWeightHold"
              @update:model-value="(value?: number) => setWeightPercent(row, value)"
            >
              <template #suffix>%</template>
            </el-input-number>
          </template>
        </el-table-column>
        <el-table-column label="评分标准" min-width="170">
          <template #default="{ row }">
            <el-input v-model="row.scoringStandard" placeholder="评分标准" maxlength="300" />
          </template>
        </el-table-column>
        <el-table-column label="数据来源" min-width="130">
          <template #default="{ row }">
            <el-input v-model="row.dataSource" placeholder="数据来源" maxlength="100" />
          </template>
        </el-table-column>
        <el-table-column label="数据口径" min-width="150">
          <template #default="{ row }">
            <el-input v-model="row.dataCaliber" placeholder="数据口径" maxlength="100" />
          </template>
        </el-table-column>
        <el-table-column label="目标值" width="150">
          <template #default="{ row }">
            <div class="target-inputs">
              <el-input-number v-model="row.targetValue" :precision="2" controls-position="right" placeholder="目标" />
              <el-input v-model="row.unit" placeholder="单位" maxlength="30" />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="76" fixed="right">
          <template #default="{ $index }">
            <el-button :icon="Delete" text type="danger" @click="removeItem($index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="edit-footer">
        <div class="indicator-add-toolbar">
          <el-popover
            v-model:visible="indicatorPickerVisible"
            trigger="click"
            placement="bottom-start"
            width="460"
            popper-class="indicator-picker-popover"
            @show="openIndicatorPicker"
          >
            <template #reference>
              <el-button type="primary" plain :icon="Plus">添加指标</el-button>
            </template>
            <div class="indicator-picker">
              <el-input
                v-model="indicatorSearchKeyword"
                clearable
                placeholder="搜索指标库：考核维度 / 指标 / 描述"
              />
              <div v-loading="referenceLoading" class="indicator-picker__list">
                <button
                  v-for="opt in indicatorOptions"
                  :key="opt.value"
                  class="indicator-picker__item"
                  type="button"
                  @click="addLibraryIndicator(opt.value)"
                >
                  <span class="indicator-picker__main">
                    <span>{{ opt.item.name }}</span>
                    <span class="indicator-picker__meta">{{ opt.item.category || opt.item.groupName || opt.item.type }}</span>
                  </span>
                  <span v-if="opt.item.description" class="indicator-picker__desc">{{ opt.item.description }}</span>
                </button>
                <el-empty v-if="!referenceLoading && indicatorOptions.length === 0" description="没有匹配的指标" :image-size="48" />
              </div>
              <div class="indicator-picker__footer">
                <el-button :icon="Plus" link type="primary" @click="addBlankIndicator">添加空白行</el-button>
              </div>
            </div>
          </el-popover>
          <template v-if="canUseTemplate">
            <el-select
              v-model="selectedTemplateId"
              filterable
              clearable
              :loading="templateLoading"
              placeholder="搜索考核模板"
              class="template-select template-select--inline"
            >
              <el-option
                v-for="template in sortedTemplates"
                :key="template.id"
                :label="`${template.name}${templateMatchesContext(template, deptId, employeeId) ? '（适用）' : ''}`"
                :value="template.id"
              >
                <div class="template-option">
                  <span>{{ template.name }}</span>
                  <span class="template-option__meta">{{ template.dimensionCount }} 维度 / {{ template.indicatorCount }} 指标</span>
                </div>
              </el-option>
            </el-select>
            <el-button :loading="applyingTemplate" :disabled="!selectedTemplateId" @click="applyTemplate">套用模板</el-button>
          </template>
        </div>
        <el-input
          v-model="note"
          type="textarea"
          :rows="3"
          maxlength="1000"
          show-word-limit
          placeholder="补充说明，例如本周期重点项目、资源支持需求、需要确认的口径"
        />
      </div>
    </template>

    <el-empty v-else-if="instances.length === 0" description="主管或HR尚未生成正式考核指标" />
    <el-table v-else :data="readonlyTableRows" border stripe size="small" class="indicator-table">
      <el-table-column label="序号" type="index" width="56" />
      <el-table-column prop="dimensionName" label="考核维度" min-width="120" />
      <el-table-column label="指标" min-width="360">
        <template #default="{ row }">
          <div class="indicator-name">{{ row.name }}</div>
          <div v-if="row.description" class="indicator-desc">{{ row.description }}</div>
        </template>
      </el-table-column>
      <el-table-column label="权重" width="78">
        <template #default="{ row }">{{ formatWeightPercent(row.weight) }}</template>
      </el-table-column>
      <el-table-column label="评分标准" min-width="160">
        <template #default="{ row }">{{ row.scoringStandard || '-' }}</template>
      </el-table-column>
      <el-table-column label="数据来源" min-width="140">
        <template #default="{ row }">{{ (row as IndicatorInstance).dataSource || '-' }}</template>
      </el-table-column>
      <el-table-column label="数据口径" min-width="140">
        <template #default="{ row }">{{ (row as IndicatorInstance).dataCaliber || '-' }}</template>
      </el-table-column>
      <el-table-column label="目标值" width="120">
        <template #default="{ row }">
          {{ row.targetValue != null ? `${row.targetValue}${row.unit ? row.unit : ''}` : '-' }}
        </template>
      </el-table-column>
      <template v-if="selfEvalMode">
        <el-table-column label="实际完成值" min-width="190">
          <template #default="{ row }">
            <el-input
              v-model="row.actualValue"
              :disabled="selfEvalReadonly"
              placeholder="请输入实际完成值"
              maxlength="200"
              show-word-limit
            />
          </template>
        </el-table-column>
        <el-table-column label="实际完成说明" min-width="300">
          <template #default="{ row }">
            <el-input
              v-model="row.actualNote"
              :disabled="selfEvalReadonly"
              placeholder="说明实际完成情况"
              maxlength="500"
              show-word-limit
            />
          </template>
        </el-table-column>
        <el-table-column label="自评分" width="132">
          <template #default="{ row }">
            <ScoreInput v-model="row.selfScore" :disabled="selfEvalReadonly" placeholder="0-100" />
          </template>
        </el-table-column>
        <el-table-column label="自评评语" min-width="260">
          <template #default="{ row }">
            <el-input
              v-model="row.selfComment"
              :disabled="selfEvalReadonly"
              placeholder="请说明打分依据"
              maxlength="500"
              show-word-limit
            />
          </template>
        </el-table-column>
      </template>
    </el-table>

    <div v-if="selfEvalMode" class="self-eval-inline">
      <div class="self-eval-inline__header">
        <div class="proposal-history__title">员工自评</div>
        <el-button v-if="!selfEvalReadonly" type="primary" link @click="handleFetchDingtalkWeekly">
          从钉钉周报拉取
        </el-button>
      </div>
      <el-form label-position="top" class="summary-form">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="主要成果">
              <el-input
                v-model="selfEvalForm.achievements"
                :disabled="selfEvalReadonly"
                type="textarea"
                :rows="2"
                placeholder="本周期主要工作成果"
                maxlength="2000"
                show-word-limit
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="待改进项">
              <el-input
                v-model="selfEvalForm.improvements"
                :disabled="selfEvalReadonly"
                type="textarea"
                :rows="2"
                placeholder="存在的不足与改进方向"
                maxlength="2000"
                show-word-limit
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="建议 / 反馈">
              <el-input
                v-model="selfEvalForm.suggestions"
                :disabled="selfEvalReadonly"
                type="textarea"
                :rows="2"
                placeholder="对团队或管理者的建议"
                maxlength="2000"
                show-word-limit
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="下阶段目标">
              <el-input
                v-model="selfEvalForm.nextGoals"
                :disabled="selfEvalReadonly"
                type="textarea"
                :rows="2"
                placeholder="下一阶段重点工作目标"
                maxlength="2000"
                show-word-limit
              />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="需要的困难 / 资源支持">
              <el-input
                v-model="selfEvalForm.supportNeeded"
                :disabled="selfEvalReadonly"
                type="textarea"
                :rows="2"
                placeholder="工作中遇到的困难或需要的资源支持"
                maxlength="2000"
                show-word-limit
              />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="附件">
              <FileUpload
                :model-value="selfEvalForm.attachments"
                :disabled="selfEvalReadonly"
                @upload="handleUpload"
                @update:model-value="handleAttachmentsChange"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <div v-if="!selfEvalReadonly" class="self-eval-inline__actions">
        <el-button type="primary" :loading="loading" @click="handleSubmitSelfEval">提交自评</el-button>
      </div>
    </div>

    <div v-if="operationRecords.length" class="proposal-history">
      <div class="proposal-history__title">操作记录</div>
      <div v-for="record in operationRecords" :key="record.id" class="proposal-history__item">
        <div class="proposal-history__meta">
          {{ record.actorName }} {{ record.summary }} · {{ new Date(record.createdAt).toLocaleString() }}
        </div>
        <div v-if="record.note" class="proposal-history__note">{{ record.note }}</div>
      </div>
    </div>

    <RejectModal
      v-model:visible="rejectVisible"
      title="退回指标"
      confirm-text="确认退回"
      @confirm="handleReject"
      @cancel="rejectVisible = false"
    />
  </ChartCard>
</template>

<style scoped>
.actions {
  display: flex;
  gap: 8px;
}

.snapshot-toolbar {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 10px;
}

.snapshot-desc {
  flex: 1;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.snapshot-toolbar__save {
  flex: 0 0 auto;
  min-width: 120px;
}

.snapshot-toolbar__actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

.indicator-name {
  font-weight: 500;
}

.indicator-desc {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.indicator-table {
  width: 100%;
  overflow: hidden;
  border: 1px solid #dfe3eb;
  border-radius: 6px;
  color: #2f343d;
  font-size: 12px;
  --el-table-border-color: #dfe3eb;
  --el-table-header-bg-color: #f5f7fa;
  --el-table-row-hover-bg-color: #f7f9fc;
  --el-table-tr-bg-color: #ffffff;
}

.indicator-table :deep(.el-table__inner-wrapper::before),
.indicator-table :deep(.el-table__border-left-patch) {
  display: none;
}

.indicator-table :deep(th.el-table__cell) {
  height: 34px;
  background: #f5f7fa !important;
  color: #20242b;
  font-size: 12px;
  font-weight: 600;
}

.indicator-table :deep(th.el-table__cell .cell) {
  line-height: 18px;
}

.indicator-table :deep(td.el-table__cell) {
  background: #ffffff;
  color: #3f4650;
  font-size: 12px;
}

.indicator-table :deep(.el-table__row:nth-child(even) td.el-table__cell) {
  background: #f7f9fc;
}

.indicator-table :deep(.el-table__cell) {
  padding: 4px 0;
}

.indicator-table :deep(.cell) {
  padding: 0 7px;
  line-height: 18px;
}

.indicator-table :deep(.el-input__wrapper),
.indicator-table :deep(.el-select__wrapper) {
  min-height: 26px;
  border-radius: 4px;
  background: #ffffff;
  box-shadow: 0 0 0 1px #dfe3eb inset;
  color: #2f343d;
  font-size: 12px;
}

.indicator-table :deep(.el-input__inner),
.indicator-table :deep(.el-select__placeholder),
.indicator-table :deep(.el-select__selected-item),
.indicator-table :deep(.el-button) {
  height: 24px;
  line-height: 24px;
  color: #3f4650;
  font-size: 12px;
}

.indicator-table :deep(.el-input__count-inner) {
  color: #8f98a8;
  font-size: 11px;
}

.indicator-table :deep(.el-input__count) {
  display: none;
}

.indicator-table :deep(.el-input-number) {
  line-height: 26px;
}

.indicator-table :deep(.el-input-number__decrease),
.indicator-table :deep(.el-input-number__increase) {
  width: 20px;
  background: #f8fafc;
  border-color: #dfe3eb;
}

.template-select {
  width: min(420px, 100%);
}

.template-select--inline {
  width: min(360px, 100%);
}

.template-option,
.indicator-option {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.template-option__meta,
.indicator-option__meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.indicator-option__desc {
  max-width: 420px;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.library-select {
  width: 100%;
}

.indicator-add-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
}

.indicator-editor {
  overflow: hidden;
  border: 1px solid #dfe3eb;
  border-radius: 4px;
  background: #ffffff;
}

.indicator-editor :deep(.el-input__wrapper),
.indicator-editor :deep(.el-select__wrapper) {
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.indicator-fields {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(360px, 1.6fr);
  gap: 0;
}

.indicator-fields > .indicator-field:first-child {
  border-right: 1px solid #edf0f5;
}

.indicator-field {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  align-items: center;
}

.indicator-field__label {
  padding: 0 8px;
  color: #7f8794;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.weight-input {
  width: 100%;
}

.weight-input :deep(.el-input-number__decrease),
.weight-input :deep(.el-input-number__increase) {
  width: 18px;
}

.weight-input :deep(.el-input__wrapper) {
  padding-left: 4px;
  padding-right: 18px;
}

.weight-input :deep(.el-input__inner) {
  min-width: 42px;
  padding-left: 0;
  padding-right: 0;
  text-align: right;
}

:global(.indicator-picker-popover) {
  padding: 10px;
}

.indicator-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.indicator-picker__list {
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid #edf0f5;
  border-radius: 6px;
  background: #ffffff;
}

.indicator-picker__item {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border: 0;
  border-bottom: 1px solid #edf0f5;
  background: transparent;
  color: #2f343d;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.indicator-picker__item:hover {
  background: #f7f9fc;
}

.indicator-picker__item:last-child {
  border-bottom: 0;
}

.indicator-picker__main {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  font-weight: 500;
}

.indicator-picker__meta,
.indicator-picker__desc {
  color: #8f98a8;
  font-size: 12px;
}

.indicator-picker__desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.indicator-picker__footer {
  display: flex;
  justify-content: flex-start;
  padding-top: 2px;
}

.weight-summary {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  margin-bottom: 10px;
  padding: 0 10px;
  border-radius: 4px;
  background: var(--el-color-success-light-9);
  color: var(--el-color-success-dark-2);
  font-size: 13px;
  font-weight: 500;
}

.weight-summary--danger {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

.target-inputs {
  display: grid;
  grid-template-columns: minmax(78px, 1fr) 50px;
  gap: 8px;
}

.target-inputs :deep(.el-input-number) {
  width: 100%;
}

.edit-footer {
  margin-top: 12px;
}

.edit-footer :deep(.el-textarea) {
  margin-top: 10px;
}

.self-eval-inline {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.self-eval-inline__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.summary-form :deep(.el-form-item) {
  margin-bottom: 12px;
}

.summary-form :deep(.el-textarea__inner) {
  min-height: 64px;
}

.self-eval-inline__actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}

.proposal-history {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.proposal-history__title {
  font-weight: 600;
  margin-bottom: 10px;
}

.proposal-history__item {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
}

.proposal-history__item + .proposal-history__item {
  margin-top: 10px;
}

.proposal-history__meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.proposal-history__note {
  margin-top: 6px;
  white-space: pre-wrap;
  color: var(--el-text-color-regular);
}
</style>
