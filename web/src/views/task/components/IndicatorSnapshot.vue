<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowDown, ArrowUp, Check, Close, Delete, Plus } from '@element-plus/icons-vue';
import RejectModal from './RejectModal.vue';
import ScoreInput from '@/components/common/ScoreInput.vue';
import FileUpload from '@/components/common/FileUpload.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import PerformanceIndicatorList, {
  type PerformanceIndicatorRow,
} from './PerformanceIndicatorList.vue';
import IndicatorVisibilityEditor, {
  type IndicatorVisibilitySelection,
  type VisibilityDepartmentOption,
} from './IndicatorVisibilityEditor.vue';
import { indicatorsApi } from '@/api/indicators.api';
import { templatesApi } from '@/api/templates.api';
import { uploadApi } from '@/api/upload.api';
import { departmentsApi } from '@/api/departments.api';
import { objectivesApi } from '@/api/objectives.api';
import type {
  AssessmentTemplate,
  Attachment,
  Department,
  FlowRecord,
  Indicator,
  IndicatorInstance,
  Objective,
  Paginated,
  SetIndicatorBody,
  SelfEvalSummary,
  SubmitSelfEvalBody,
  TemplateIndicator,
  TemplateListItem,
} from '@/types/api.types';
import type { DimensionType, IndicatorType } from '@/types/enums';
import { isValidScore } from '@/utils/score';
import { normalizeDisplayedWeightTotal } from '../indicator-weight';

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
  targetValueText?: string;
  unit?: string;
  weight: number;
  dimensionName?: string;
  actualValue?: string;
  actualNote: string;
  selfScore: number | null;
  selfComment: string;
}

interface SelfEvalDraft {
  version: 1;
  indicatorIds: string[];
  updatedAt: number;
  activeIndicatorId: string;
  rows: Array<Pick<SelfEvalRow, 'id' | 'actualValue' | 'actualNote' | 'selfScore' | 'selfComment'>>;
  summary: typeof selfEvalForm;
}

const props = defineProps<{
  instances: IndicatorInstance[];
  canEdit?: boolean;
  canConfirm: boolean;
  canReject?: boolean;
  title?: string;
  cycleId?: string | null;
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
  taskId?: string;
  selfEvalUserId?: string;
}>();

const emit = defineEmits<{
  (e: 'save', body: Omit<SetIndicatorBody, 'expectedUpdatedAt'>): void;
  (e: 'save-and-add', body: Omit<SetIndicatorBody, 'expectedUpdatedAt'>): void;
  (e: 'confirm'): void;
  (e: 'reject', reason: string): void;
  (e: 'submit-self-eval', body: SubmitSelfEvalBody, actualValues: ActualValueItem[]): void;
  (e: 'save-self-eval-draft'): void;
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
const activeSelfEvalId = ref('');
const selfEvalValidationIds = ref<string[]>([]);
const selfEvalDraftState = ref<'idle' | 'saved' | 'restored'>('idle');
const selfEvalDraftSavedAt = ref<number | null>(null);
const selfEvalDraftReady = ref(false);
const selfEvalDraftRestoring = ref(false);
const selfEvalDraftTimer = ref<number | null>(null);
const selfEvalDraftErrorShown = ref(false);
const snapshotValidationIds = ref<string[]>([]);
const snapshotNameErrors = ref<Record<string, string>>({});
const snapshotWeightError = ref('');
const advancedSettingIds = ref(new Set<string>());
type GoalSettingMode = 'simple' | 'complete';
const GOAL_SETTING_MODE_KEY = 'kayford.goal-setting.mode';
const goalSettingMode = ref<GoalSettingMode>(readGoalSettingMode());
const goalSettingOptionsLoading = ref(false);
const goalSettingOptionsLoaded = ref(false);
const goalAlignmentOptions = ref<Objective[]>([]);
const goalVisibilityDepartments = ref<VisibilityDepartmentOption[]>([]);

function readGoalSettingMode(): GoalSettingMode {
  try {
    return window.localStorage.getItem(GOAL_SETTING_MODE_KEY) === 'complete' ? 'complete' : 'simple';
  } catch {
    return 'simple';
  }
}

function setGoalSettingMode(mode: GoalSettingMode) {
  goalSettingMode.value = mode;
  try {
    window.localStorage.setItem(GOAL_SETTING_MODE_KEY, mode);
  } catch {
    // The editor still works when browser storage is unavailable.
  }
}

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

const displayedWeightTotal = computed(() => (
  normalizeDisplayedWeightTotal(weightTotalPercent.value / 100)
));
const isWeightOverLimit = computed(() => displayedWeightTotal.value.hundredths > 10_000);
const isWeightReadyToSubmit = computed(() => displayedWeightTotal.value.isExactlyOneHundredPercent);
const goalWeightFeedback = computed(() => {
  if (snapshotWeightError.value) return snapshotWeightError.value;
  if (isWeightOverLimit.value) return `权重合计 ${displayedWeightTotal.value.percentText}% · 已超过 100%`;
  if (isWeightReadyToSubmit.value) return '权重合计 100% · 可以提交';
  return `权重合计 ${displayedWeightTotal.value.percentText}% · 提交前需调整为 100%`;
});

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

const scoredSelfEvalCount = computed(() => selfEvalRows.filter((row) => row.selfScore != null).length);
const selfEvalDraftKey = computed(() => (
  props.selfEvalUserId && props.taskId
    ? `kayford.self-eval-draft.${props.selfEvalUserId}.${props.taskId}`
    : ''
));
const selfEvalDraftStatusText = computed(() => {
  const savedAt = selfEvalDraftSavedAt.value;
  const time = savedAt
    ? new Date(savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
  if (selfEvalDraftState.value === 'restored') return `已恢复当前设备草稿${time ? ` · ${time}` : ''}`;
  if (selfEvalDraftState.value === 'saved') return `已暂存于当前设备${time ? ` · ${time}` : ''}`;
  return '内容将自动暂存于当前设备';
});

const editableRowIds = computed(() => editableItems.map((_, index) => (
  props.instances[index]?.id ?? `draft-indicator-${index + 1}`
)));
const latestIndicatorRejection = computed(() => [...(props.flowRecords ?? [])]
  .filter((record) => record.action === 'reject')
  .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]);
const rejectedSnapshotIndicatorId = computed(() => (
  latestIndicatorRejection.value
    ? (props.canEdit ? editableRowIds.value[0] : props.instances[0]?.id)
    : undefined
));
const snapshotRevealIds = computed(() => {
  const ids = [...snapshotValidationIds.value];
  if (rejectedSnapshotIndicatorId.value && !ids.includes(rejectedSnapshotIndicatorId.value)) {
    ids.push(rejectedSnapshotIndicatorId.value);
  }
  return ids;
});
const editableDisclosureRows = computed<PerformanceIndicatorRow[]>(() => editableItems.map((item, index) => ({
  id: editableRowIds.value[index],
  name: item.name,
  weight: item.weight,
  visibilityScope: item.visibilityScope,
  statusLabel: latestIndicatorRejection.value ? '待修改' : '草稿',
  description: item.description,
  scoringStandard: item.scoringStandard,
  dataSource: item.dataSource,
  dataCaliber: item.dataCaliber,
  targetValue: item.targetValue,
  targetValueText: item.targetValueText,
  unit: item.unit,
  alignedObjectives: props.instances[index]?.alignedObjectives ?? [],
  rejectionReason: editableRowIds.value[index] === rejectedSnapshotIndicatorId.value
    ? latestIndicatorRejection.value?.comment
    : undefined,
})));

function hasAdvancedSettings(id: string): boolean {
  return advancedSettingIds.value.has(id);
}

function toggleAdvancedSettings(id: string) {
  const next = new Set(advancedSettingIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  advancedSettingIds.value = next;
}
const readonlyDisclosureRows = computed<PerformanceIndicatorRow[]>(() => props.instances.map((item) => ({
  id: item.id,
  name: item.name,
  weight: item.weight,
  visibilityScope: item.visibilityScope,
  statusLabel: latestIndicatorRejection.value ? '已驳回' : '已提交',
  description: item.description,
  scoringStandard: item.scoringStandard,
  dataSource: item.dataSource,
  dataCaliber: item.dataCaliber,
  targetValue: item.targetValue,
  targetValueText: item.targetValueText,
  unit: item.unit,
  alignedObjectives: item.alignedObjectives,
  rejectionReason: item.id === rejectedSnapshotIndicatorId.value
    ? latestIndicatorRejection.value?.comment
    : undefined,
})));

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
    advancedSettingIds.value = new Set();
  },
  { immediate: true, deep: true },
);

watch(
  () => [props.canEdit, props.cycleId] as const,
  ([canEdit]) => {
    if (canEdit) void loadGoalSettingOptions();
  },
  { immediate: true },
);

function initSelfEvalForm() {
  selfEvalDraftReady.value = false;
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
      targetValueText: inst.targetValueText,
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
  if (!selfEvalRows.some((row) => row.id === activeSelfEvalId.value)) {
    activeSelfEvalId.value = selfEvalRows.find((row) => row.selfScore == null)?.id ?? selfEvalRows[0]?.id ?? '';
  }
  void restoreSelfEvalDraft();
}

function toggleSelfEvalCard(id: string) {
  activeSelfEvalId.value = activeSelfEvalId.value === id ? '' : id;
}

function openSelfEvalCard(index: number) {
  const target = selfEvalRows[index];
  if (target) activeSelfEvalId.value = target.id;
}

function currentSelfEvalIndicatorIds() {
  return selfEvalRows.map((row) => row.id);
}

async function restoreSelfEvalDraft() {
  const storageKey = selfEvalDraftKey.value;
  if (!props.selfEvalMode || props.selfEvalReadonly || !storageKey) {
    selfEvalDraftReady.value = true;
    return;
  }

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    selfEvalDraftState.value = 'idle';
    selfEvalDraftSavedAt.value = null;
    selfEvalDraftReady.value = true;
    return;
  }

  try {
    const draft = JSON.parse(raw) as SelfEvalDraft;
    const indicatorIds = currentSelfEvalIndicatorIds();
    if (
      draft.version !== 1
      || draft.indicatorIds.length !== indicatorIds.length
      || draft.indicatorIds.some((id, index) => id !== indicatorIds[index])
    ) {
      window.localStorage.removeItem(storageKey);
      selfEvalDraftReady.value = true;
      return;
    }

    selfEvalDraftRestoring.value = true;
    const savedRows = new Map(draft.rows.map((row) => [row.id, row]));
    for (const row of selfEvalRows) {
      const saved = savedRows.get(row.id);
      if (!saved) continue;
      row.actualValue = saved.actualValue;
      row.actualNote = saved.actualNote ?? '';
      row.selfScore = saved.selfScore;
      row.selfComment = saved.selfComment ?? '';
    }
    Object.assign(selfEvalForm, draft.summary);
    if (selfEvalRows.some((row) => row.id === draft.activeIndicatorId)) {
      activeSelfEvalId.value = draft.activeIndicatorId;
    }
    selfEvalDraftSavedAt.value = draft.updatedAt;
    selfEvalDraftState.value = 'restored';
    await nextTick();
  } catch {
    window.localStorage.removeItem(storageKey);
  } finally {
    selfEvalDraftRestoring.value = false;
    selfEvalDraftReady.value = true;
  }
}

function persistSelfEvalDraft(): boolean {
  const storageKey = selfEvalDraftKey.value;
  if (!props.selfEvalMode || props.selfEvalReadonly || !storageKey) return false;
  const updatedAt = Date.now();
  const draft: SelfEvalDraft = {
    version: 1,
    indicatorIds: currentSelfEvalIndicatorIds(),
    updatedAt,
    activeIndicatorId: activeSelfEvalId.value,
    rows: selfEvalRows.map((row) => ({
      id: row.id,
      actualValue: row.actualValue,
      actualNote: row.actualNote,
      selfScore: row.selfScore,
      selfComment: row.selfComment,
    })),
    summary: {
      achievements: selfEvalForm.achievements,
      improvements: selfEvalForm.improvements,
      suggestions: selfEvalForm.suggestions,
      nextGoals: selfEvalForm.nextGoals,
      supportNeeded: selfEvalForm.supportNeeded,
      attachments: [...selfEvalForm.attachments],
    },
  };

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(draft));
    selfEvalDraftSavedAt.value = updatedAt;
    selfEvalDraftState.value = 'saved';
    selfEvalDraftErrorShown.value = false;
    return true;
  } catch {
    if (!selfEvalDraftErrorShown.value) {
      selfEvalDraftErrorShown.value = true;
      ElMessage.warning('当前设备无法暂存草稿，请勿关闭页面');
    }
    return false;
  }
}

function scheduleSelfEvalDraftSave() {
  if (!selfEvalDraftReady.value || selfEvalDraftRestoring.value || props.selfEvalReadonly) return;
  if (selfEvalDraftTimer.value != null) window.clearTimeout(selfEvalDraftTimer.value);
  selfEvalDraftTimer.value = window.setTimeout(() => {
    selfEvalDraftTimer.value = null;
    persistSelfEvalDraft();
  }, 300);
}

function clearSelfEvalDraft() {
  if (selfEvalDraftTimer.value != null) {
    window.clearTimeout(selfEvalDraftTimer.value);
    selfEvalDraftTimer.value = null;
  }
  selfEvalDraftReady.value = false;
  const storageKey = selfEvalDraftKey.value;
  if (storageKey) window.localStorage.removeItem(storageKey);
  selfEvalDraftState.value = 'idle';
  selfEvalDraftSavedAt.value = null;
  selfEvalDraftErrorShown.value = false;
}

watch(
  [selfEvalRows, selfEvalForm, activeSelfEvalId],
  () => {
    selfEvalValidationIds.value = selfEvalValidationIds.value.filter((id) => {
      const row = selfEvalRows.find((item) => item.id === id);
      return !row || row.selfScore == null || !isValidScore(row.selfScore);
    });
    scheduleSelfEvalDraftSave();
  },
  { deep: true, flush: 'post' },
);

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
    return record.extraData?.employeeConfirmedBeforeReview ? `保存并审核${countText}，目标确认完成` : `保存并审核${countText}`;
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

function flattenDepartmentOptions(items: Department[]): VisibilityDepartmentOption[] {
  const result: VisibilityDepartmentOption[] = [];
  const visit = (nodes: Department[]) => {
    for (const department of nodes) {
      if (department.isActive !== false) result.push({ id: department.id, name: department.name });
      if (department.children?.length) visit(department.children);
    }
  };
  visit(items);
  return result;
}

function objectiveItems(result: Objective[] | Paginated<Objective>): Objective[] {
  return Array.isArray(result) ? result : result.items;
}

async function loadGoalSettingOptions() {
  if (goalSettingOptionsLoading.value || goalSettingOptionsLoaded.value) return;
  goalSettingOptionsLoading.value = true;
  try {
    const [objectiveResult, departmentResult] = await Promise.allSettled([
      objectivesApi.findAll({
        cycleId: props.cycleId || undefined,
        page: 1,
        pageSize: 200,
        flat: true,
      }),
      departmentsApi.findAll({ isActive: true, flat: true }),
    ]);
    if (objectiveResult.status === 'fulfilled') {
      goalAlignmentOptions.value = objectiveItems(objectiveResult.value);
    }
    if (departmentResult.status === 'fulfilled') {
      goalVisibilityDepartments.value = flattenDepartmentOptions(departmentResult.value);
    }
    goalSettingOptionsLoaded.value = true;
  } finally {
    goalSettingOptionsLoading.value = false;
  }
}

function updateEditableVisibility(index: number, selection: IndicatorVisibilitySelection) {
  const item = editableItems[index];
  if (!item) return;
  item.visibilityScope = selection.visibilityScope;
  item.visibleDepartmentIds = [...selection.visibleDepartmentIds];
  item.visibleUserIds = [...selection.visibleUserIds];
}

function objectiveLabel(id: string, index: number): string {
  return goalAlignmentOptions.value.find((objective) => objective.id === id)?.title
    ?? props.instances[index]?.alignedObjectives.find((objective) => objective.id === id)?.title
    ?? '已对齐目标';
}

function targetInputValue(item: SetIndicatorBody['instances'][number]): string {
  if (item.targetValueText) return item.targetValueText;
  return item.targetValue == null ? '' : String(item.targetValue);
}

function setTargetInputValue(item: SetIndicatorBody['instances'][number], value: string) {
  item.targetValueText = value;
  item.targetValue = undefined;
}

function createEmptyItem(): SetIndicatorBody['instances'][number] {
  return {
    name: '',
    description: '',
    scoringStandard: '',
    dataSource: '',
    dataCaliber: '',
    targetValue: undefined,
    targetValueText: '',
    unit: '',
    weight: 1,
    indicatorType: 'kpi',
    dimensionName: 'KPI维度',
    dimensionWeight: 1,
    sortOrder: 0,
    visibilityScope: 'supervisors',
    visibleDepartmentIds: [],
    visibleUserIds: [],
    alignedObjectiveIds: [],
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
    targetValueText: indicator.targetValueText,
    unit: indicator.unit,
    weight: editableItems.length ? 0 : 1,
    indicatorType: indicator.type,
    dimensionName: indicator.category || indicator.groupName || 'KPI维度',
    dimensionWeight: 1,
    sortOrder,
    visibilityScope: 'supervisors',
    visibleDepartmentIds: [],
    visibleUserIds: [],
    alignedObjectiveIds: [],
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
    targetValueText: indicator.targetValueText,
    unit: indicator.unit,
    weight: indicator.weight,
    indicatorType: toIndicatorType(dimensionType),
    dimensionName,
    dimensionWeight,
    sortOrder,
    visibilityScope: 'supervisors',
    visibleDepartmentIds: [],
    visibleUserIds: [],
    alignedObjectiveIds: [],
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
    targetValueText: instance.targetValueText,
    unit: instance.unit,
    weight: instance.weight,
    indicatorType: instance.indicatorType,
    dimensionName: instance.dimensionName || 'KPI维度',
    dimensionWeight: instance.dimensionWeight,
    sortOrder: instance.sortOrder,
    visibilityScope: instance.visibilityScope,
    visibleDepartmentIds: [...instance.visibleDepartmentIds],
    visibleUserIds: [...instance.visibleUserIds],
    alignedObjectiveIds: instance.alignedObjectives.map((objective) => objective.id),
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

function formatTargetValue(row: Pick<IndicatorInstance, 'targetValue' | 'targetValueText' | 'unit'>): string {
  if (row.targetValueText) return row.targetValueText;
  if (row.targetValue != null) return `${row.targetValue}${row.unit ? row.unit : ''}`;
  return '-';
}

function toPercent(weight: number | undefined): number {
  return Number(((weight ?? 0) * 100).toFixed(2));
}

function setWeightPercent(row: unknown, value: number | undefined) {
  if (value == null || Number.isNaN(value)) return;
  const item = row as SetIndicatorBody['instances'][number];
  item.weight = Number((value / 100).toFixed(6));
  snapshotWeightError.value = '';
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
    targetValueText: item.targetValueText?.trim() || undefined,
    unit: item.unit?.trim() || undefined,
    weight: Number(item.weight ?? 0),
    indicatorType: item.indicatorType ?? 'kpi',
    dimensionName: item.dimensionName?.trim() || 'KPI维度',
    dimensionWeight: Number(item.dimensionWeight ?? 1),
    sortOrder: index,
    visibilityScope: item.visibilityScope,
    visibleDepartmentIds: [...item.visibleDepartmentIds],
    visibleUserIds: [...item.visibleUserIds],
    alignedObjectiveIds: [...item.alignedObjectiveIds],
  };
}

onBeforeUnmount(() => {
  clearWeightHold();
  if (selfEvalDraftTimer.value != null) {
    window.clearTimeout(selfEvalDraftTimer.value);
    selfEvalDraftTimer.value = null;
    persistSelfEvalDraft();
  }
});

function revealSnapshotIndicator(index: number) {
  const indicatorId = editableRowIds.value[index];
  if (!indicatorId) return;
  snapshotValidationIds.value = [];
  void nextTick(() => {
    snapshotValidationIds.value = [indicatorId];
  });
}

function clearSnapshotNameError(id: string) {
  if (!snapshotNameErrors.value[id]) return;
  const next = { ...snapshotNameErrors.value };
  delete next[id];
  snapshotNameErrors.value = next;
}

function resetSnapshotValidation() {
  snapshotValidationIds.value = [];
  snapshotNameErrors.value = {};
  snapshotWeightError.value = '';
}

function buildIndicatorBody(action: 'save' | 'submit'): Omit<SetIndicatorBody, 'expectedUpdatedAt'> | null {
  resetSnapshotValidation();
  const trimmedItems = editableItems.map(trimItem);
  const instances = trimmedItems.filter((item) => item.name);
  if (!instances.length) {
    const firstId = editableRowIds.value[0];
    if (firstId) snapshotNameErrors.value = { [firstId]: '请填写目标名称' };
    revealSnapshotIndicator(0);
    ElMessage.warning('请至少填写一条目标');
    return null;
  }
  if (action === 'submit') {
    const emptyNameIndex = trimmedItems.findIndex((item) => !item.name);
    if (emptyNameIndex >= 0) {
      const id = editableRowIds.value[emptyNameIndex];
      if (id) snapshotNameErrors.value = { [id]: '请填写目标名称' };
      revealSnapshotIndicator(emptyNameIndex);
      ElMessage.warning('请补全目标名称后再提交');
      return null;
    }
  }
  const normalizedNames = instances.map((item) => item.name.trim().toLocaleLowerCase());
  const duplicateNames = new Set(normalizedNames.filter((name, index) => normalizedNames.indexOf(name) !== index));
  if (duplicateNames.size > 0) {
    snapshotNameErrors.value = Object.fromEntries(
      trimmedItems
        .map((item, index) => ({ item, id: editableRowIds.value[index] }))
        .filter(({ item }) => duplicateNames.has(item.name.trim().toLocaleLowerCase()))
        .map(({ id }) => [id, '目标名称不能重复']),
    );
    ElMessage.warning('目标名称不能重复');
    return null;
  }
  const emptyCustomIndex = editableItems.findIndex((item) => (
    item.visibilityScope === 'custom'
    && item.visibleDepartmentIds.length === 0
    && item.visibleUserIds.length === 0
  ));
  if (emptyCustomIndex >= 0) {
    revealSnapshotIndicator(emptyCustomIndex);
    ElMessage.warning('自定义可见范围至少选择一个部门或员工');
    return null;
  }
  if (isWeightOverLimit.value) {
    snapshotWeightError.value = `权重合计不能超过 100%，当前为 ${displayedWeightTotal.value.percentText}%`;
    revealSnapshotIndicator(0);
    ElMessage.warning(snapshotWeightError.value);
    return null;
  }
  if (action === 'submit' && !isWeightReadyToSubmit.value) {
    snapshotWeightError.value = `权重合计 ${displayedWeightTotal.value.percentText}%，提交前需调整为 100%`;
    ElMessage.warning(snapshotWeightError.value);
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

async function handleSaveAndAdd() {
  const body = buildIndicatorBody('save');
  if (!body) return;
  emit('save-and-add', body);
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

async function focusSelfEvalScoreInput(indicatorId: string) {
  await nextTick();
  const container = document.querySelector(`[data-self-eval-score-id="${indicatorId}"]`);
  const input = container?.querySelector('input');
  if (input instanceof HTMLInputElement) input.focus();
}

async function validateSelfEval(): Promise<boolean> {
  selfEvalValidationIds.value = selfEvalRows
    .filter((row) => row.selfScore == null || !isValidScore(row.selfScore))
    .map((row) => row.id);
  if (selfEvalValidationIds.value.length > 0) {
    const firstInvalid = selfEvalRows.find((row) => row.id === selfEvalValidationIds.value[0]);
    activeSelfEvalId.value = firstInvalid?.id ?? '';
    if (firstInvalid) await focusSelfEvalScoreInput(firstInvalid.id);
    ElMessage.warning(`请先完成${selfEvalValidationIds.value.length}项必填自评分`);
    return false;
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

async function handleSubmitSelfEval() {
  if (!await validateSelfEval()) return;
  emit('submit-self-eval', buildSelfEvalBody(), buildActualValues());
}

async function handleCheckAndSubmitSelfEval() {
  if (!await validateSelfEval()) return;
  try {
    await ElMessageBox.confirm(
      `${selfEvalRows.length} 项指标均已评分。其他总结内容为选填，确认后将进入主管评分。`,
      '提交前检查',
      {
        type: 'info',
        confirmButtonText: '确认提交',
        cancelButtonText: '返回修改',
      },
    );
  } catch {
    return;
  }
  handleSubmitSelfEval();
}

function handleSaveSelfEvalForLater() {
  if (persistSelfEvalDraft()) emit('save-self-eval-draft');
}

defineExpose({ clearSelfEvalDraft, addGoal: addItem });

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

</script>

<template>
  <ChartCard class="indicator-snapshot">
    <template #title>{{ title || '考核指标明细' }}</template>
    <template #extra>
      <div
        v-if="canEdit || canConfirm || canReject"
        class="goal-card-head-actions"
        data-testid="performance-stage-actions"
      >
        <el-button
          v-if="canEdit"
          plain
          class="goal-setting-mode-switch"
          :aria-label="goalSettingMode === 'simple' ? '切换到完整模式' : '切换到简洁模式'"
          @click="setGoalSettingMode(goalSettingMode === 'simple' ? 'complete' : 'simple')"
        >
          {{ goalSettingMode === 'simple' ? '完整模式' : '简洁模式' }}
        </el-button>
        <span v-if="canEdit" class="goal-weight-pill">维度权重：{{ displayedWeightTotal.percentText }}%</span>
        <el-button v-if="canReject" plain type="danger" :icon="Close" :loading="loading" @click="rejectVisible = true">
          {{ rejectLabel || '退回指标' }}
        </el-button>
        <el-button v-if="canConfirm" type="primary" :icon="Check" :loading="loading" @click="handleConfirm">
          {{ confirmLabel || '确认指标' }}
        </el-button>
      </div>
    </template>

    <template v-if="canEdit">
      <div
        class="goal-setting-editor"
        :class="`is-${goalSettingMode}`"
        :data-testid="goalSettingMode === 'simple' ? 'goal-setting-simple-editor' : 'goal-setting-complete-editor'"
      >
        <article
          v-for="(item, index) in editableItems"
          :key="editableRowIds[index]"
          class="goal-setting-row"
          data-testid="goal-setting-row"
        >
          <div class="goal-setting-row__meta">
            <span class="goal-setting-row__index">{{ index + 1 }}</span>
            <div class="goal-setting-row__alignment">
              <el-popover
                trigger="click"
                placement="bottom-start"
                :width="360"
                @show="loadGoalSettingOptions"
              >
                <template #reference>
                  <el-button
                    link
                    type="primary"
                    :data-testid="`goal-align-open-${index}`"
                  >
                    + 添加对齐
                  </el-button>
                </template>
                <div class="goal-alignment-picker">
                  <strong>选择要对齐的上级或协同目标</strong>
                  <el-select
                    v-model="item.alignedObjectiveIds"
                    multiple
                    filterable
                    collapse-tags
                    collapse-tags-tooltip
                    :loading="goalSettingOptionsLoading"
                    :data-testid="`goal-align-select-${index}`"
                    placeholder="搜索目标"
                  >
                    <el-option
                      v-for="objective in goalAlignmentOptions"
                      :key="objective.id"
                      :label="objective.title"
                      :value="objective.id"
                    />
                  </el-select>
                  <el-empty
                    v-if="!goalSettingOptionsLoading && goalAlignmentOptions.length === 0"
                    description="当前周期暂无可对齐目标"
                    :image-size="44"
                  />
                </div>
              </el-popover>
              <el-tag
                v-for="objectiveId in item.alignedObjectiveIds"
                :key="objectiveId"
                size="small"
                effect="plain"
              >
                {{ objectiveLabel(objectiveId, index) }}
              </el-tag>
            </div>
            <IndicatorVisibilityEditor
              class="goal-setting-row__visibility"
              :class="{ 'is-custom': item.visibilityScope === 'custom' }"
              :model-value="{
                visibilityScope: item.visibilityScope,
                visibleDepartmentIds: item.visibleDepartmentIds,
                visibleUserIds: item.visibleUserIds,
              }"
              :indicator-id="editableRowIds[index]"
              :departments="goalVisibilityDepartments"
              :disabled="loading"
              @update:model-value="updateEditableVisibility(index, $event)"
            />
          </div>

          <div class="goal-setting-row__primary">
            <label class="goal-name" :class="{ 'is-invalid': snapshotNameErrors[editableRowIds[index]] }">
              <el-input
                v-model="item.name"
                :data-testid="`goal-name-input-${index}`"
                maxlength="200"
                placeholder="请输入目标"
                @update:model-value="clearSnapshotNameError(editableRowIds[index])"
              />
              <em v-if="snapshotNameErrors[editableRowIds[index]]" class="goal-field-error">
                {{ snapshotNameErrors[editableRowIds[index]] }}
              </em>
            </label>
            <label class="goal-weight-input">
              <span>权重</span>
              <el-input-number
                :data-testid="`goal-weight-input-${index}`"
                :model-value="toPercent(item.weight)"
                :min="0"
                :max="100"
                :precision="2"
                @update:model-value="(value?: number) => setWeightPercent(item, value)"
              />
              <span>%</span>
            </label>
            <el-button
              class="goal-setting-row__delete"
              link
              type="danger"
              :icon="Delete"
              :aria-label="`删除目标 ${index + 1}`"
              @click="removeItem(index)"
            />
          </div>

          <div
            v-if="goalSettingMode === 'complete'"
            class="goal-setting-row__complete"
            data-testid="goal-setting-complete-fields"
          >
            <label>
              <span><i>*</i> 描述</span>
              <el-input
                v-model="item.description"
                :data-testid="`goal-description-input-${index}`"
                type="textarea"
                :rows="3"
                maxlength="500"
                placeholder="说明目标内容、范围与关键交付"
              />
            </label>
            <label>
              <span><i>*</i> 衡量标准</span>
              <el-input
                v-model="item.scoringStandard"
                :data-testid="`goal-standard-input-${index}`"
                type="textarea"
                :rows="3"
                maxlength="500"
                placeholder="说明达成条件、评价口径或分档标准"
              />
            </label>
            <div class="goal-setting-row__quantities">
              <label>
                <span>目标量</span>
                <div class="goal-quantity-inputs">
                  <el-input
                    :model-value="targetInputValue(item)"
                    :data-testid="`goal-target-input-${index}`"
                    maxlength="100"
                    placeholder="填写目标值"
                    @update:model-value="(value: string) => setTargetInputValue(item, value)"
                  />
                  <el-input
                    v-model="item.unit"
                    :data-testid="`goal-unit-input-${index}`"
                    maxlength="30"
                    placeholder="单位"
                  />
                </div>
              </label>
              <label>
                <span>完成量</span>
                <div class="goal-quantity-inputs">
                  <el-input disabled placeholder="目标制定阶段无需填写" />
                  <el-input :model-value="item.unit" disabled placeholder="单位" />
                </div>
              </label>
            </div>
          </div>
        </article>
      </div>

      <div class="goal-setting-tools">
        <div class="goal-setting-tools__add">
          <el-button plain :icon="Plus" @click="addItem">添加目标</el-button>
          <el-popover
            v-model:visible="indicatorPickerVisible"
            trigger="click"
            placement="bottom-start"
            :width="460"
            popper-class="indicator-picker-popover"
            @show="openIndicatorPicker"
          >
            <template #reference>
              <el-button plain>从指标库引入</el-button>
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
                <el-button :icon="Plus" link type="primary" @click="addBlankIndicator">添加空白目标</el-button>
              </div>
            </div>
          </el-popover>
        </div>
      </div>
      <footer class="goal-setting-action-bar" data-testid="goal-setting-actions">
        <span data-testid="goal-weight-feedback" :class="{
          'is-ready': isWeightReadyToSubmit && !snapshotWeightError,
          'is-danger': Boolean(snapshotWeightError) || isWeightOverLimit,
        }">{{ goalWeightFeedback }}</span>
        <div class="goal-setting-action-bar__buttons">
          <el-button :loading="loading" @click="handleSave('save')">保存草稿</el-button>
          <el-button type="primary" :loading="loading" @click="handleSave('submit')">
            {{ submitLabel || saveLabel || '提交' }}
          </el-button>
        </div>
      </footer>
    </template>

    <template v-else-if="false">
      <PerformanceIndicatorList
        :rows="editableDisclosureRows"
        :invalid-indicator-ids="snapshotRevealIds"
        :weight-total="weightTotalPercent / 100"
      >
        <template #details="{ row, index }">
          <div
            class="snapshot-compact-editor"
            :data-testid="`indicator-compact-editor-${row.id}`"
          >
            <div class="snapshot-compact-editor__commands">
              <el-button
                text
                type="primary"
                :icon="hasAdvancedSettings(row.id) ? ArrowUp : ArrowDown"
                :data-testid="`indicator-more-settings-${row.id}`"
                @click="toggleAdvancedSettings(row.id)"
              >
                {{ hasAdvancedSettings(row.id) ? '收起更多' : '更多设置' }}
              </el-button>
              <el-tooltip content="删除指标" placement="top">
                <el-button
                  text
                  circle
                  type="danger"
                  :icon="Delete"
                  :aria-label="`删除指标 ${editableItems[index].name || index + 1}`"
                  @click="removeItem(index)"
                />
              </el-tooltip>
            </div>
            <div class="snapshot-compact-editor__primary">
              <label>
                <span>指标名称</span>
                <el-input v-model="editableItems[index].name" placeholder="请输入指标名称" maxlength="100" />
              </label>
              <label>
                <span>权重</span>
                <el-input-number
                  class="weight-input"
                  :model-value="toPercent(editableItems[index].weight)"
                  :min="0"
                  :max="100"
                  :step="5"
                  :precision="2"
                  controls-position="right"
                  @pointerdown.capture="(event: PointerEvent) => handleWeightControlPointerDown(editableItems[index], event)"
                  @pointerup.capture="clearWeightHold"
                  @pointerleave.capture="clearWeightHold"
                  @pointercancel.capture="clearWeightHold"
                  @update:model-value="(value?: number) => setWeightPercent(editableItems[index], value)"
                />
              </label>
              <label class="is-wide">
                <span>指标描述</span>
                <el-input
                  v-model="editableItems[index].description"
                  type="textarea"
                  :rows="2"
                  placeholder="请输入指标描述，例如：按阶段完成验证"
                  maxlength="300"
                />
              </label>
              <label class="is-wide">
                <span>评分标准</span>
                <el-input
                  v-model="editableItems[index].scoringStandard"
                  type="textarea"
                  :rows="2"
                  placeholder="请输入评分标准，例如：按期验收100分，延期按规则扣分"
                  maxlength="300"
                />
              </label>
            </div>

            <div
              v-if="hasAdvancedSettings(row.id)"
              class="snapshot-compact-editor__advanced"
              :data-testid="`indicator-advanced-settings-${row.id}`"
            >
              <label>
                <span>考核维度</span>
                <el-input v-model="editableItems[index].dimensionName" placeholder="考核维度" maxlength="100" />
              </label>
              <label>
                <span>目标值</span>
                <div class="target-inputs">
                  <el-input
                    v-if="editableItems[index].targetValueText"
                    v-model="editableItems[index].targetValueText"
                    placeholder="固定值"
                    maxlength="100"
                  />
                  <template v-else>
                    <el-input-number v-model="editableItems[index].targetValue" :precision="2" controls-position="right" placeholder="目标" />
                    <el-input v-model="editableItems[index].unit" placeholder="单位" maxlength="30" />
                  </template>
                </div>
              </label>
              <label>
                <span>数据来源</span>
                <el-input v-model="editableItems[index].dataSource" placeholder="数据来源" maxlength="100" />
              </label>
              <label>
                <span>数据口径</span>
                <el-input v-model="editableItems[index].dataCaliber" placeholder="数据口径" maxlength="100" />
              </label>
            </div>
          </div>
        </template>
      </PerformanceIndicatorList>

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
    <template v-else>
      <PerformanceIndicatorList
        v-if="!selfEvalMode"
        :rows="readonlyDisclosureRows"
        :invalid-indicator-ids="snapshotRevealIds"
      />

      <section v-else class="self-eval-guide" data-testid="self-eval-guide">
        <div class="self-eval-guide__intro">
          <div>
            <strong>逐项完成指标自评</strong>
            <p>本次共 {{ selfEvalRows.length }} 项指标，每项自评分为必填，其他内容可按需补充。支持分次填写，提交前统一检查。</p>
            <small
              v-if="!selfEvalReadonly"
              class="self-eval-guide__draft-status"
              data-testid="self-eval-draft-status"
            >
              {{ selfEvalDraftStatusText }}
            </small>
          </div>
          <span class="self-eval-guide__progress" data-testid="self-eval-progress">
            已评分 {{ scoredSelfEvalCount }}/{{ selfEvalRows.length }}
          </span>
        </div>

        <div class="self-eval-card-list">
          <article
            v-for="(row, index) in selfEvalRows"
            :key="row.id"
            class="self-eval-card"
            :class="{
              'is-active': activeSelfEvalId === row.id,
              'is-complete': row.selfScore != null,
              'is-invalid': selfEvalValidationIds.includes(row.id),
            }"
            data-testid="self-eval-card"
          >
            <button
              type="button"
              class="self-eval-card__toggle"
              data-testid="self-eval-card-toggle"
              :aria-expanded="activeSelfEvalId === row.id"
              @click="toggleSelfEvalCard(row.id)"
            >
              <span class="self-eval-card__index">{{ index + 1 }}</span>
              <span class="self-eval-card__heading">
                <strong>{{ row.name || '未命名指标' }}</strong>
                <small>
                  {{ row.dimensionName || '未设置维度' }} · 权重 {{ formatWeightPercent(row.weight) }} · 目标 {{ formatTargetValue(row as IndicatorInstance) }}
                </small>
              </span>
              <span class="self-eval-card__state" :class="{ 'is-complete': row.selfScore != null }">
                {{ row.selfScore == null ? '待评分' : `已评分 ${row.selfScore}` }}
              </span>
              <el-icon><ArrowUp v-if="activeSelfEvalId === row.id" /><ArrowDown v-else /></el-icon>
            </button>

            <div
              v-show="activeSelfEvalId === row.id"
              class="self-eval-card__body"
              data-testid="self-eval-card-body"
            >
              <section class="self-eval-reference" aria-label="评分依据">
                <div class="self-eval-section-heading">评分依据</div>
                <p v-if="row.description" class="self-eval-reference__description">{{ row.description }}</p>
                <dl>
                  <div><dt>评分标准</dt><dd>{{ row.scoringStandard || '-' }}</dd></div>
                  <div><dt>目标值</dt><dd>{{ formatTargetValue(row as IndicatorInstance) }}</dd></div>
                  <div><dt>数据来源</dt><dd>{{ row.dataSource || '-' }}</dd></div>
                  <div><dt>数据口径</dt><dd>{{ row.dataCaliber || '-' }}</dd></div>
                </dl>
              </section>

              <el-form label-position="top" class="self-eval-fields" aria-label="我的填写">
                <div class="self-eval-section-heading">我的填写</div>
                <div class="self-eval-fields__primary">
                  <el-form-item label="实际完成值（选填）">
                    <el-input
                      v-model="row.actualValue"
                      :disabled="selfEvalReadonly"
                      placeholder="填写关键结果或完成比例"
                      maxlength="200"
                    />
                  </el-form-item>
                  <el-form-item label="自评分（必填）" required>
                    <ScoreInput
                      :data-self-eval-score-id="row.id"
                      v-model="row.selfScore"
                      :disabled="selfEvalReadonly"
                      placeholder="0-100"
                    />
                    <span v-if="selfEvalValidationIds.includes(row.id)" class="self-eval-field-error">
                      请填写 0-100 分的自评分
                    </span>
                  </el-form-item>
                </div>
                <el-form-item label="完成情况与证据（选填）">
                  <el-input
                    v-model="row.actualNote"
                    :disabled="selfEvalReadonly"
                    type="textarea"
                    :rows="2"
                    placeholder="写关键结果、时间或数据即可"
                    maxlength="500"
                    show-word-limit
                  />
                </el-form-item>
                <el-form-item label="评分说明（选填）">
                  <el-input
                    v-model="row.selfComment"
                    :disabled="selfEvalReadonly"
                    type="textarea"
                    :rows="2"
                    placeholder="说明与评分标准的对应点或未达原因，无需重复完成情况"
                    maxlength="500"
                    show-word-limit
                  />
                </el-form-item>
                <div v-if="!selfEvalReadonly" class="self-eval-card__navigation">
                  <el-button v-if="index > 0" @click="openSelfEvalCard(index - 1)">上一项</el-button>
                  <el-button v-if="index < selfEvalRows.length - 1" type="primary" plain @click="openSelfEvalCard(index + 1)">
                    下一项
                  </el-button>
                </div>
              </el-form>
            </div>
          </article>
        </div>
      </section>
    </template>

    <section v-if="selfEvalMode" class="self-eval-inline" data-testid="self-eval-summary">
      <div class="self-eval-inline__header">
        <div>
          <div class="proposal-history__title">自评总结</div>
          <p>以下内容均为选填，简要记录即可，不影响提交。</p>
        </div>
      </div>
      <el-form label-position="top" class="summary-form summary-groups">
        <section class="summary-group is-open">
          <div class="summary-group__title">本周期回顾（选填）</div>
          <div class="summary-group__grid">
            <el-form-item label="主要成果">
              <el-input
                v-model="selfEvalForm.achievements"
                :disabled="selfEvalReadonly"
                type="textarea"
                :rows="2"
                placeholder="概括 1-3 项关键成果"
                maxlength="2000"
              />
            </el-form-item>
            <el-form-item label="待改进项">
              <el-input
                v-model="selfEvalForm.improvements"
                :disabled="selfEvalReadonly"
                type="textarea"
                :rows="2"
                placeholder="存在的不足与改进方向"
                maxlength="2000"
              />
            </el-form-item>
          </div>
        </section>

        <details class="summary-group" :open="selfEvalReadonly">
          <summary>
            <span>下一阶段（选填）</span>
            <small>目标与需要的支持</small>
          </summary>
          <div class="summary-group__grid">
            <el-form-item label="下阶段目标">
              <el-input
                v-model="selfEvalForm.nextGoals"
                :disabled="selfEvalReadonly"
                type="textarea"
                :rows="2"
                placeholder="下一阶段重点工作目标"
                maxlength="2000"
              />
            </el-form-item>
            <el-form-item label="困难与资源支持">
              <el-input
                v-model="selfEvalForm.supportNeeded"
                :disabled="selfEvalReadonly"
                type="textarea"
                :rows="2"
                placeholder="如需协作、人员、预算或权限，请在此说明；暂无可留空"
                maxlength="2000"
              />
            </el-form-item>
          </div>
        </details>

        <details class="summary-group" :open="selfEvalReadonly">
          <summary>
            <span>建议与材料（选填）</span>
            <small>建议反馈与附件</small>
          </summary>
          <div class="summary-group__content">
            <el-form-item label="建议 / 反馈">
              <el-input
                v-model="selfEvalForm.suggestions"
                :disabled="selfEvalReadonly"
                type="textarea"
                :rows="2"
                placeholder="对团队或管理者的建议"
                maxlength="2000"
              />
            </el-form-item>
            <el-form-item label="附件">
              <FileUpload
                :model-value="selfEvalForm.attachments"
                :disabled="selfEvalReadonly"
                @upload="handleUpload"
                @update:model-value="handleAttachmentsChange"
              />
            </el-form-item>
          </div>
        </details>
      </el-form>
    </section>

    <div v-if="selfEvalMode && !selfEvalReadonly" class="self-eval-action-bar">
      <div>
        <strong>{{ scoredSelfEvalCount }}/{{ selfEvalRows.length }} 项已评分</strong>
        <span>{{ selfEvalDraftStatusText }}</span>
      </div>
      <div class="self-eval-action-bar__buttons">
        <el-button @click="handleSaveSelfEvalForLater">保存并稍后继续</el-button>
        <el-button type="primary" :loading="loading" @click="handleCheckAndSubmitSelfEval">
          检查并提交
        </el-button>
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
.goal-card-head-actions { display: flex; align-items: center; gap: 8px; }
.goal-weight-pill { display: inline-flex; min-height: 30px; align-items: center; padding: 0 10px; border-radius: 6px; background: #fff7df; color: #d99016; font-size: 12px; font-weight: 600; }
.goal-setting-editor { display: grid; gap: 0; }
.goal-setting-row { position: relative; min-width: 0; padding: 10px 0 14px 28px; border-bottom: 1px solid #edf0f5; }
.goal-setting-row:first-child { padding-top: 2px; }
.goal-setting-row__meta { min-height: 28px; display: grid; grid-template-columns: minmax(180px, 1fr) minmax(190px, 280px); align-items: center; gap: 12px; }
.goal-setting-row__index { position: absolute; top: 43px; left: 0; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; background: #eaf3ff; color: #2685eb; font-size: 12px; font-weight: 700; }
.goal-setting-row:first-child .goal-setting-row__index { top: 35px; }
.goal-setting-row__alignment { min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
.goal-setting-row__alignment :deep(.el-button) { padding: 0; font-size: 12px; }
.goal-setting-row__alignment :deep(.el-tag) { max-width: min(260px, 100%); }
.goal-setting-row__visibility { justify-self: end; width: min(100%, 240px); }
.goal-setting-row__visibility.is-custom { width: min(100%, 560px); }
.goal-setting-row__visibility :deep(.el-select__wrapper) {
  min-height: 30px;
  border-radius: 999px;
  background: #eff6ff;
  box-shadow: 0 0 0 1px #bfdbfe inset;
}
.goal-setting-row__visibility :deep(.el-select__wrapper:hover),
.goal-setting-row__visibility :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 0 0 1px #60a5fa inset;
}
.goal-setting-row__visibility :deep(.el-select__selected-item) {
  color: #2563eb;
  font-size: 12px;
  font-weight: 600;
}
.goal-setting-row__visibility :deep(.el-select__caret) { color: #3b82f6; }
.goal-setting-row__primary { min-width: 0; display: grid; grid-template-columns: minmax(220px, 1fr) 116px 28px; align-items: start; gap: 10px; }
.goal-setting-row__primary :deep(.el-input__wrapper),
.goal-setting-row__primary :deep(.el-select__wrapper),
.goal-setting-row__complete :deep(.el-input__wrapper),
.goal-setting-row__complete :deep(.el-select__wrapper) { min-height: 34px; }
.goal-setting-row__primary .goal-name { min-width: 0; display: grid; gap: 3px; }
.goal-setting-row__primary .goal-name.is-invalid :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px var(--el-color-danger) inset; }
.goal-weight-input { height: 34px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; overflow: hidden; border: 1px solid #dcdfe6; border-radius: 4px; color: #667085; font-size: 12px; }
.goal-weight-input > span { padding: 0 7px; white-space: nowrap; }
.goal-weight-input :deep(.el-input-number) { width: 100%; }
.goal-weight-input :deep(.el-input__wrapper) { padding: 0; box-shadow: none; }
.goal-weight-input :deep(.el-input-number__decrease), .goal-weight-input :deep(.el-input-number__increase) { display: none; }
.goal-setting-row__delete { width: 28px; min-height: 34px; margin: 0; }
.goal-setting-row__complete { display: grid; gap: 12px; padding-top: 12px; }
.goal-setting-row__complete > label { min-width: 0; display: grid; gap: 6px; color: #687386; font-size: 12px; }
.goal-setting-row__complete > label > span i { color: var(--el-color-danger); font-style: normal; }
.goal-setting-row__quantities { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.goal-setting-row__quantities > label { min-width: 0; display: grid; gap: 6px; color: #687386; font-size: 12px; }
.goal-quantity-inputs { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(70px, .42fr); gap: 6px; }
.goal-setting-tools { display: grid; justify-items: start; gap: 14px; padding-top: 14px; }
.goal-setting-tools__add { display: flex; flex-wrap: wrap; gap: 8px; }
.goal-setting-mode-switch { color: #2685eb; border-color: #2685eb; }
.goal-alignment-picker { display: grid; gap: 10px; }
.goal-alignment-picker > strong { color: #303744; font-size: 13px; }
.goal-alignment-picker :deep(.el-select) { width: 100%; }
.goal-field-error { color: var(--el-color-danger); font-size: 12px; font-style: normal; line-height: 18px; }
.goal-setting-action-bar { position: sticky; z-index: 5; bottom: 10px; display: flex; align-items: center; justify-content: flex-end; gap: 16px; margin-top: 16px; padding: 12px 14px; border: 1px solid #dfe5f0; border-radius: 10px; background: rgb(255 255 255 / 96%); box-shadow: 0 8px 24px rgb(31 45 61 / 10%); backdrop-filter: blur(10px); }
.goal-setting-action-bar > span { color: #9a6814; font-size: 13px; }
.goal-setting-action-bar > span.is-ready { color: var(--el-color-success); }
.goal-setting-action-bar > span.is-danger { color: var(--el-color-danger); }
.goal-setting-action-bar__buttons { display: flex; gap: 8px; }
.goal-setting-action-bar__buttons .el-button { min-width: 112px; margin-left: 0; }
.actions {
  display: flex;
  gap: 8px;
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

.snapshot-compact-editor {
  display: grid;
  gap: 12px;
}

.snapshot-compact-editor__commands {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.snapshot-compact-editor__primary,
.snapshot-compact-editor__advanced {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 160px;
  gap: 10px 12px;
}

.snapshot-compact-editor__advanced {
  padding-top: 12px;
  border-top: 1px dashed #dfe4ec;
}

.snapshot-compact-editor label {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 5px;
  color: #687386;
  font-size: 11px;
}

.snapshot-compact-editor label.is-wide {
  grid-column: 1 / -1;
}

.snapshot-compact-editor :deep(.el-input-number) {
  width: 100%;
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

.self-eval-guide {
  display: grid;
  gap: 14px;
}

.self-eval-guide__intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 14px 16px;
  border: 1px solid #dbe7ff;
  border-radius: 8px;
  background: #f6f9ff;
}

.self-eval-guide__intro strong {
  color: #1f2937;
  font-size: 15px;
}

.self-eval-guide__intro p {
  margin: 5px 0 0;
  color: #687386;
  font-size: 13px;
  line-height: 20px;
}

.self-eval-guide__draft-status {
  display: inline-block;
  margin-top: 6px;
  color: #4f6f9d;
  font-size: 12px;
}

.self-eval-guide__progress {
  flex: none;
  padding: 7px 12px;
  border-radius: 999px;
  background: #e8f0ff;
  color: #315fb4;
  font-size: 13px;
  font-weight: 600;
}

.self-eval-card-list {
  display: grid;
  gap: 10px;
}

.self-eval-card {
  overflow: hidden;
  border: 1px solid #dfe3eb;
  border-radius: 8px;
  background: #fff;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.self-eval-card.is-active {
  border-color: #9bb8f3;
  box-shadow: 0 8px 24px rgba(40, 88, 170, 0.08);
}

.self-eval-card.is-invalid {
  border-color: #e89a9a;
}

.self-eval-card__toggle {
  display: grid;
  width: 100%;
  grid-template-columns: 32px minmax(0, 1fr) auto 18px;
  align-items: center;
  gap: 12px;
  padding: 13px 16px;
  border: 0;
  background: #fff;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.self-eval-card.is-complete .self-eval-card__toggle {
  background: #fbfefc;
}

.self-eval-card__index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #edf3ff;
  color: #3264c5;
  font-size: 12px;
  font-weight: 700;
}

.self-eval-card__heading {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.self-eval-card__heading strong {
  overflow: hidden;
  color: #263244;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.self-eval-card__heading small {
  color: #7a8596;
  font-size: 12px;
  line-height: 18px;
}

.self-eval-card__state {
  padding: 4px 9px;
  border-radius: 999px;
  background: #f4f5f7;
  color: #737d8d;
  font-size: 12px;
  white-space: nowrap;
}

.self-eval-card__state.is-complete {
  background: #eaf7ef;
  color: #2f7c4a;
}

.self-eval-card__body {
  display: grid;
  grid-template-columns: minmax(260px, 0.8fr) minmax(420px, 1.2fr);
  gap: 18px;
  padding: 16px;
  border-top: 1px solid #edf0f5;
}

.self-eval-reference {
  padding: 14px;
  border-radius: 7px;
  background: #f7f9fc;
}

.self-eval-section-heading {
  margin-bottom: 10px;
  color: #354256;
  font-size: 13px;
  font-weight: 700;
}

.self-eval-reference__description {
  margin: 0 0 12px;
  color: #566176;
  font-size: 13px;
  line-height: 20px;
}

.self-eval-reference dl {
  display: grid;
  gap: 10px;
  margin: 0;
}

.self-eval-reference dl div {
  display: grid;
  gap: 3px;
}

.self-eval-reference dt {
  color: #8a94a6;
  font-size: 11px;
  font-weight: 600;
}

.self-eval-reference dd {
  margin: 0;
  color: #344054;
  font-size: 13px;
  line-height: 20px;
  word-break: break-word;
}

.self-eval-fields__primary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 160px;
  gap: 12px;
}

.self-eval-fields :deep(.el-form-item) {
  margin-bottom: 12px;
}

.self-eval-fields :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}

.self-eval-card__navigation {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

.self-eval-field-error {
  display: block;
  width: 100%;
  margin-top: 5px;
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 18px;
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

.self-eval-inline__header .proposal-history__title {
  margin-bottom: 4px;
}

.self-eval-inline__header p {
  margin: 0;
  color: #7b8798;
  font-size: 12px;
  line-height: 18px;
}

.summary-form :deep(.el-form-item) {
  margin-bottom: 12px;
}

.summary-form :deep(.el-textarea__inner) {
  min-height: 64px;
}

.summary-groups {
  display: grid;
  gap: 10px;
}

.summary-group {
  overflow: hidden;
  border: 1px solid #e1e5ec;
  border-radius: 8px;
  background: #fff;
}

.summary-group__title,
.summary-group summary {
  padding: 12px 14px;
  color: #354256;
  font-size: 13px;
  font-weight: 600;
}

.summary-group summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  list-style: none;
}

.summary-group summary::-webkit-details-marker {
  display: none;
}

.summary-group summary::after {
  content: '展开';
  color: #4f6f9d;
  font-size: 12px;
  font-weight: 500;
}

.summary-group[open] summary::after {
  content: '收起';
}

.summary-group summary small {
  margin-left: auto;
  color: #8b95a5;
  font-size: 12px;
  font-weight: 400;
}

.summary-group__grid,
.summary-group__content {
  padding: 0 14px 2px;
  border-top: 1px solid #eef1f5;
}

.summary-group__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}

.summary-group.is-open .summary-group__grid {
  padding-top: 12px;
}

.summary-group__content {
  padding-top: 12px;
}

.self-eval-inline__actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}

.self-eval-action-bar {
  position: sticky;
  z-index: 5;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 16px -16px -16px;
  padding: 12px 16px;
  border-top: 1px solid #dfe4ec;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 -8px 20px rgba(31, 45, 61, 0.06);
  backdrop-filter: blur(8px);
}

.self-eval-action-bar > div:first-child {
  display: grid;
  gap: 3px;
}

.self-eval-action-bar strong {
  color: #354256;
  font-size: 13px;
}

.self-eval-action-bar span {
  color: #7b8798;
  font-size: 12px;
}

.self-eval-action-bar__buttons {
  display: flex;
  gap: 8px;
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

@media (max-width: 768px) {
  .goal-card-head-actions { flex-wrap: wrap; justify-content: flex-end; }
  .goal-setting-editor { padding-bottom: 104px; }
  .goal-setting-row { padding: 12px 0 16px; scroll-margin-bottom: 126px; }
  .goal-setting-row:first-child { padding-top: 4px; }
  .goal-setting-row__index, .goal-setting-row:first-child .goal-setting-row__index { position: static; grid-row: 1 / span 2; align-self: center; }
  .goal-setting-row__meta { grid-template-columns: 24px minmax(0, 1fr); gap: 7px; }
  .goal-setting-row__alignment { grid-column: 2; }
  .goal-setting-row__visibility { grid-column: 2; justify-self: end; width: min(100%, 240px); }
  .goal-setting-row__visibility.is-custom { width: 100%; }
  .goal-setting-row__primary { grid-template-columns: minmax(0, 1fr) 102px 26px; gap: 7px; padding-top: 8px; }
  .goal-weight-input > span:first-child { display: none; }
  .goal-weight-input { grid-template-columns: minmax(0, 1fr) auto; }
  .goal-setting-row__complete { padding-top: 12px; }
  .goal-setting-row__quantities { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .goal-quantity-inputs { grid-template-columns: minmax(0, 1fr) 72px; }
  .goal-setting-tools { align-items: stretch; flex-direction: column; padding-bottom: 8px; }
  .goal-setting-action-bar { position: fixed; z-index: 40; right: 0; bottom: 0; left: 0; min-width: 0; margin: 0; padding: 9px 12px calc(9px + env(safe-area-inset-bottom)); border-width: 1px 0 0; border-radius: 0; }
  .goal-setting-action-bar > span { min-width: 0; flex: 1; font-size: 12px; line-height: 17px; }
  .goal-setting-action-bar__buttons { flex: none; }
  .goal-setting-action-bar__buttons .el-button { min-width: 0; min-height: 42px; padding: 8px 12px; }

  .self-eval-guide__intro {
    align-items: flex-start;
    flex-direction: column;
  }

  .self-eval-card__toggle {
    grid-template-columns: 32px minmax(0, 1fr) 18px;
    padding: 12px;
  }

  .self-eval-card__state {
    grid-column: 2;
    justify-self: start;
  }

  .self-eval-card__toggle > .el-icon {
    grid-column: 3;
    grid-row: 1 / span 2;
  }

  .self-eval-card__body {
    grid-template-columns: minmax(0, 1fr);
    padding: 12px;
  }

  .self-eval-fields__primary {
    grid-template-columns: minmax(0, 1fr);
  }

  .self-eval-action-bar {
    align-items: stretch;
    flex-direction: column;
    margin: 16px -12px -12px;
  }

  .self-eval-action-bar > div:first-child {
    display: none;
  }

  .self-eval-action-bar__buttons {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .self-eval-action-bar__buttons .el-button {
    min-height: 44px;
    margin-left: 0;
  }

  .summary-group__grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }

  .summary-group summary {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .summary-group summary small {
    width: 100%;
    margin-left: 0;
  }

  .snapshot-compact-editor__primary,
  .snapshot-compact-editor__advanced {
    grid-template-columns: minmax(0, 1fr);
  }

  .snapshot-compact-editor label.is-wide {
    grid-column: auto;
  }

  .actions,
  .indicator-add-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .actions .el-button,
  .indicator-add-toolbar .el-button {
    width: 100%;
    min-height: 44px;
    margin-left: 0;
  }

  .target-inputs {
    grid-template-columns: minmax(0, 1fr) 72px;
  }

  .template-select,
  .template-select--inline {
    width: 100%;
  }

  .edit-footer :deep(.el-textarea__inner),
  .summary-form :deep(.el-textarea__inner) {
    min-height: 88px;
  }

  .self-eval-inline__header {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
}

@media (max-width: 430px) {
  .goal-setting-row__primary { grid-template-columns: minmax(0, 1fr) 88px 24px; }
  .goal-setting-action-bar > span { max-width: 110px; }
  .goal-setting-action-bar__buttons .el-button { padding: 8px 10px; }
}
</style>
