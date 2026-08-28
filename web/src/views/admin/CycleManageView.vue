<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { QuestionFilled } from '@element-plus/icons-vue';
import dayjs from 'dayjs';
import { cyclesApi } from '@/api/cycles.api';
import { departmentsApi } from '@/api/departments.api';
import ChartCard from '@/components/common/ChartCard.vue';
import CollapsibleFilterPanel from '@/components/common/CollapsibleFilterPanel.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import UserSelect from '@/components/common/UserSelect.vue';
import CycleCompactTable from './components/CycleCompactTable.vue';
import CycleWorkspaceShell from './components/CycleWorkspaceShell.vue';
import CycleParticipantScopePicker, { type ParticipantScopeMode } from './components/CycleParticipantScopePicker.vue';
import CycleScoringSettings from './components/CycleScoringSettings.vue';
import CycleMonthlyScheduleEditor from './components/CycleMonthlyScheduleEditor.vue';
import { cycleStatusGroup } from './cycle-management';
import { buildDefaultCycleSchedule } from './cycle-default-schedule';
import { useAuthStore } from '@/stores/auth.store';
import { usePagination } from '@/composables/usePagination';
import { formatDate } from '@/utils/date';
import type {
  AssessmentCycle,
  CreateCycleBody,
  UpdateDeadlinesBody,
  PublishVisibleFields,
  LaunchPreflightResult,
  Department,
  CycleQuery,
  CycleStatusGroup,
  CycleNotificationMode,
  DingtalkNotificationSettings,
  CyclePeriodSchedule,
  CycleScheduleIssue,
} from '@/types/api.types';
import type { CycleStatus, CycleType, ScoringFrequency } from '@/types/enums';

const CYCLE_STATUS_OPTIONS: { label: string; value: CycleStatus }[] = [
  { label: '草稿', value: 'draft' },
  { label: '待发起', value: 'scheduled' },
  { label: '发起受阻', value: 'launch_blocked' },
  { label: '指标制定中', value: 'indicator_setting' },
  { label: '员工自评中', value: 'self_eval' },
  { label: '主管评分中', value: 'manager_score' },
  { label: 'HR校准中', value: 'hr_calibration' },
  { label: '审批中', value: 'approval' },
  { label: '已公示', value: 'published' },
  { label: '申诉中', value: 'appeal' },
  { label: '已关闭', value: 'closed' },
];

const CYCLE_STATUS_GROUPS: { label: string; value: CycleStatusGroup }[] = [
  { label: '待发起', value: 'attention' },
  { label: '进行中', value: 'active' },
  { label: '已结束', value: 'finished' },
];

const CYCLE_TYPE_OPTIONS: { label: string; value: CycleType }[] = [
  { label: '月度', value: 'monthly' },
  { label: '季度', value: 'quarterly' },
  { label: '半年', value: 'semiannual' },
  { label: '年度', value: 'annual' },
  { label: '试用期', value: 'probation' },
  { label: '自定义', value: 'custom' },
];

const STATUS_TAG_TYPE: Record<CycleStatus, 'primary' | 'success' | 'warning' | 'info' | 'danger'> = {
  draft: 'info',
  scheduled: 'primary',
  launch_blocked: 'danger',
  indicator_setting: 'warning',
  self_eval: 'primary',
  manager_score: 'primary',
  hr_calibration: 'primary',
  approval: 'primary',
  published: 'success',
  appeal: 'danger',
  closed: 'info',
};

const STATUS_LABEL: Record<CycleStatus, string> = {
  draft: '草稿',
  scheduled: '待发起',
  launch_blocked: '发起受阻',
  indicator_setting: '指标制定中',
  self_eval: '员工自评中',
  manager_score: '主管评分中',
  hr_calibration: 'HR校准中',
  approval: '审批中',
  published: '已公示',
  appeal: '申诉中',
  closed: '已关闭',
};

const DEADLINE_FIELDS = [
  { key: 'deadlineIndicatorSetting', label: '指标制定截止' },
  { key: 'deadlineIndicatorConfirm', label: '指标确认截止' },
  { key: 'deadlineSelfEval', label: '员工自评截止' },
  { key: 'deadlineManagerScore', label: '主管评分截止' },
  { key: 'deadlineHrCalibration', label: 'HR校准截止' },
  { key: 'deadlineApproval', label: '结果审批截止' },
  { key: 'deadlinePublish', label: '结果公示截止' },
] as const;

type DeadlineKey = (typeof DEADLINE_FIELDS)[number]['key'];

const CREATE_SCHEDULE_NODES = [
  { number: '01', key: 'goalSettingOpenAt', label: '目标制定开放', helper: '周期开始前第 10 个工作日 · 09:00', stage: 'preparation' },
  { number: '02', key: 'deadlineIndicatorSetting', label: '指标制定截止', helper: '周期开始前第 3 个工作日 · 18:00', stage: 'preparation' },
  { number: '03', key: 'deadlineIndicatorConfirm', label: '指标确认截止', helper: '周期开始前第 1 个工作日 · 18:00', stage: 'preparation' },
  { number: '04', key: 'selfEvalOpenAt', label: '员工自评开放', helper: '周期结束后的第 1 个工作日 · 09:00', stage: 'result' },
  { number: '05', key: 'deadlineSelfEval', label: '员工自评截止', helper: '开放日起第 3 个工作日 · 18:00', stage: 'result' },
  { number: '06', key: 'deadlineManagerScore', label: '主管评分截止', helper: '自评截止后第 3 个工作日 · 18:00', stage: 'result' },
  { number: '07', key: 'deadlineHrCalibration', label: 'HR校准截止', helper: '主管评分后第 2 个工作日 · 18:00', stage: 'result' },
  { number: '08', key: 'deadlineApproval', label: '结果审批截止', helper: 'HR校准后第 2 个工作日 · 18:00', stage: 'result' },
  { number: '09', key: 'deadlinePublish', label: '结果公示截止', helper: '结果审批后第 1 个工作日 · 18:00', stage: 'result' },
] as const;

const PREPARATION_SCHEDULE_NODES = CREATE_SCHEDULE_NODES.filter((node) => node.stage === 'preparation');
const RESULT_SCHEDULE_NODES = CREATE_SCHEDULE_NODES.filter((node) => node.stage === 'result');

const DEFAULT_VISIBLE_FIELDS: PublishVisibleFields = {
  totalScore: true,
  grade: true,
  indicatorScores: true,
  managerComment: true,
  coefficient: false,
};

const VISIBLE_FIELD_OPTIONS: { key: keyof PublishVisibleFields; label: string }[] = [
  { key: 'totalScore', label: '总得分' },
  { key: 'grade', label: '绩效等级' },
  { key: 'indicatorScores', label: '各项指标得分' },
  { key: 'managerComment', label: '主管评语' },
  { key: 'coefficient', label: '绩效系数' },
];

const GRADE_RATIO_FIELDS = [
  { key: 'gradeAMaxRatio', label: 'A 级上限' },
  { key: 'gradeBMaxRatio', label: 'B 级上限' },
  { key: 'gradeCMaxRatio', label: 'C 级上限' },
  { key: 'gradeDMaxRatio', label: 'D 级上限' },
] as const;

const listLoading = ref(false);
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const departments = ref<Department[]>([]);
const departmentsState = ref<'loading' | 'ready' | 'failed'>('loading');
const submitting = ref(false);
const launchingId = ref<string | null>(null);
const deletingId = ref<string | null>(null);
const cycles = ref<AssessmentCycle[]>([]);
const canEditCyclePlan = computed(() => (
  auth.user?.sysRole === 'system_admin'
  || auth.user?.sysRole === 'hr'
  || auth.user?.hrCapabilities?.includes('cycle_plan_edit')
));

const initialStatus = CYCLE_STATUS_OPTIONS.some((item) => item.value === route.query.status)
  ? route.query.status as CycleStatus
  : '';
const initialType = CYCLE_TYPE_OPTIONS.some((item) => item.value === route.query.type)
  ? route.query.type as CycleType
  : '';
const initialGroup = CYCLE_STATUS_GROUPS.some((item) => item.value === route.query.group)
  ? route.query.group as CycleStatusGroup
  : initialStatus
    ? cycleStatusGroup(initialStatus)
    : 'attention';

const statusGroup = ref<CycleStatusGroup>(initialGroup);
const statusFilter = ref<CycleStatus | ''>(initialStatus);
const typeFilter = ref<CycleType | ''>(initialType);
const keyword = ref(typeof route.query.keyword === 'string' ? route.query.keyword : '');

const { page, pageSize, total, pageSizeOptions, withParams, onChange } = usePagination({
  defaultPageSize: 10,
});
const initialPage = Number(route.query.page);
if (Number.isInteger(initialPage) && initialPage > 0) page.value = initialPage;

const createDialogVisible = ref(false);
const editingCycleId = ref<string | null>(null);
const isEditMode = computed(() => Boolean(editingCycleId.value));
const advancedCreateVisible = ref(false);
const advancedCreateSections = ref<string[]>([]);
const createScheduleCustomized = ref(false);
const createScheduleProvisionalYears = ref<number[]>([]);
const createNameCustomized = ref(false);
const createPeriodRange = ref<[Date, Date] | null>(null);
const createInitialSnapshot = ref('');
const editingWorkflowVersion = ref<1 | 2>(2);
const editingReviewStatus = ref<AssessmentCycle['reviewStatus']>();
const confirmedScoringFrequency = ref<ScoringFrequency>('monthly');
let schedulePreviewTimer: ReturnType<typeof setTimeout> | undefined;
let schedulePreviewRequest = 0;
let pendingSchedulePreviewReason = '';
const notificationSettings = ref<DingtalkNotificationSettings | null>(null);
const notificationSettingsLoading = ref(false);
const notificationSettingsSaving = ref(false);
const notificationDialogVisible = ref(false);
const notificationCycle = ref<AssessmentCycle | null>(null);
const notificationModeDraft = ref<CycleNotificationMode>('off');
const editDialogVisible = ref(false);
const editingCycle = ref<AssessmentCycle | null>(null);
const preflightLoading = ref(false);
const preflightError = ref('');
const preflightCycle = ref<AssessmentCycle | null>(null);
const preflight = ref<LaunchPreflightResult | null>(null);
const detailLoading = ref(false);
const detailError = ref('');
const cycleDetail = ref<AssessmentCycle | null>(null);
const isCycleWorkspace = computed(() => typeof route.query.cycleId === 'string' && route.query.cycleId.length > 0);
const hasListFilters = computed(() => Boolean(statusFilter.value || typeFilter.value || keyword.value.trim()));
const emptyStateDescription = computed(() => {
  if (hasListFilters.value) return '没有符合筛选条件的周期';
  if (statusGroup.value === 'active') return '暂无进行中的周期';
  if (statusGroup.value === 'finished') return '暂无已结束周期';
  return '暂无待发起周期';
});
const gradeRatioSummary = computed(() => (
  `A ${createForm.gradeAMaxRatio}% · B ${createForm.gradeBMaxRatio}% · C ${createForm.gradeCMaxRatio}% · D ${createForm.gradeDMaxRatio}%`
));
const visibleFieldCount = computed(() => Object.values(createForm.publishVisibleFields).filter(Boolean).length);
const semiannualPeriodWarning = computed(() => {
  if (createForm.type !== 'semiannual' || !createForm.startDate || !createForm.endDate) return '';
  const recommendedEnd = dayjs(createForm.startDate).add(6, 'month').subtract(1, 'day').startOf('day');
  if (dayjs(createForm.endDate).isSame(recommendedEnd, 'day')) return '';
  return `当前期间不是完整的连续六个月，仍可保存，请确认符合本次考核安排。按开始日期建议结束于 ${recommendedEnd.format('YYYY-MM-DD')}。`;
});
const createSchedulePlanLabel = computed(() => (createScheduleCustomized.value ? '已调整计划' : '系统默认计划'));
const createSchedulePeriodLabel = computed(() => {
  if (!createForm.startDate || !createForm.endDate) return '考核执行期未设置';
  return `考核执行期 ${dayjs(createForm.startDate).format('YYYY-MM-DD')}—${dayjs(createForm.endDate).format('YYYY-MM-DD')}`;
});
const createScheduleProvisionalYearLabel = computed(() => createScheduleProvisionalYears.value.join('、'));
const createNotificationHint = computed(() => {
  if (createForm.notificationMode === 'off') return '本周期不发送钉钉通知';
  if (!notificationSettings.value?.effectiveEnabled) return '钉钉通知总开关已关闭，本周期暂不外发';
  return createForm.notificationMode === 'launch_only'
    ? '正式发起时提醒一次，不会每日催办'
    : '正式发起时提醒，并在临期或逾期任务每日 09:00 催办';
});

interface CycleScoringPlanForm {
  workflowVersion: 2;
  scoringFrequency: ScoringFrequency;
  reviewFrequency: 'cycle';
  periodSchedules: CyclePeriodSchedule[];
  scheduleBlockers: CycleScheduleIssue[];
  scheduleWarnings: CycleScheduleIssue[];
}

const scoringPlan = reactive<CycleScoringPlanForm>({
  workflowVersion: 2,
  scoringFrequency: 'monthly',
  reviewFrequency: 'cycle',
  periodSchedules: [],
  scheduleBlockers: [],
  scheduleWarnings: [],
});
const isWorkflowV2Form = computed(() => !isEditMode.value || editingWorkflowVersion.value === 2);
const scoringPlanSnapshot = () => JSON.stringify({
  scoringFrequency: scoringPlan.scoringFrequency,
  periodSchedules: scoringPlan.periodSchedules,
});
const reviewResetRequired = computed(() => (
  isEditMode.value
  && editingWorkflowVersion.value === 2
  && editingReviewStatus.value === 'approved'
  && createInitialSnapshot.value !== ''
  && createFormSnapshot() !== createInitialSnapshot.value
));

const createFormRef = ref<InstanceType<typeof import('element-plus')['ElForm']> | null>(null);
const editFormRef = ref<InstanceType<typeof import('element-plus')['ElForm']> | null>(null);

const createForm = reactive({
  name: '',
  type: 'quarterly' as CycleType,
  participantScope: 'all' as ParticipantScopeMode,
  startDate: undefined as Date | undefined,
  endDate: undefined as Date | undefined,
  goalSettingOpenAt: undefined as Date | undefined,
  selfEvalOpenAt: undefined as Date | undefined,
  hrOwnerId: '' as string | undefined,
  reviewerId: '' as string | undefined,
  monthlyFollowUpRequired: false,
  participantDeptIds: [] as string[],
  participantUserIds: [] as string[],
  explicitExemptDeptIds: [] as string[],
  explicitExemptUserIds: [] as string[],
  notificationMode: 'off' as CycleNotificationMode,
  deadlineIndicatorSetting: undefined as Date | undefined,
  deadlineIndicatorConfirm: undefined as Date | undefined,
  deadlineSelfEval: undefined as Date | undefined,
  deadlineManagerScore: undefined as Date | undefined,
  deadlineHrCalibration: undefined as Date | undefined,
  deadlineApproval: undefined as Date | undefined,
  deadlinePublish: undefined as Date | undefined,
  gradeAMaxRatio: 20,
  gradeBMaxRatio: 40,
  gradeCMaxRatio: 30,
  gradeDMaxRatio: 10,
  publishVisibleFields: { ...DEFAULT_VISIBLE_FIELDS },
});

function createFormSnapshot(): string {
  return JSON.stringify({
    form: createForm,
    ...(isWorkflowV2Form.value && { scoringPlan: scoringPlanSnapshot() }),
  });
}

const editForm = reactive<Record<DeadlineKey, Date | undefined>>({
  deadlineIndicatorSetting: undefined,
  deadlineIndicatorConfirm: undefined,
  deadlineSelfEval: undefined,
  deadlineManagerScore: undefined,
  deadlineHrCalibration: undefined,
  deadlineApproval: undefined,
  deadlinePublish: undefined,
});

const createRules = {
  name: [{ required: true, message: '请输入周期名称', trigger: 'blur' }],
  type: [{ required: true, message: '请选择周期类型', trigger: 'change' }],
  startDate: [{ required: true, message: '请选择开始日期', trigger: 'change' }],
  endDate: [{ required: true, message: '请选择结束日期', trigger: 'change' }],
  reviewerId: [{ required: true, message: '请选择本周期审核人', trigger: 'change' }],
  participantDeptIds: [{
    validator: (_rule: unknown, value: string[], callback: (error?: Error) => void) => {
      if (
        createForm.participantScope === 'custom'
        && value.length === 0
        && createForm.participantUserIds.length === 0
      ) {
        callback(new Error('请至少选择一个部门或一名员工'));
        return;
      }
      callback();
    },
    trigger: 'change',
  }],
};

const canOpenImmediately = computed(() => {
  const value = preflight.value?.cycle.goalSettingOpenAt;
  return Boolean(value && dayjs(value).valueOf() <= Date.now());
});

function resetCreateForm() {
  if (schedulePreviewTimer) clearTimeout(schedulePreviewTimer);
  pendingSchedulePreviewReason = '';
  editingCycleId.value = null;
  editingWorkflowVersion.value = 2;
  editingReviewStatus.value = undefined;
  advancedCreateVisible.value = false;
  advancedCreateSections.value = [];
  createScheduleCustomized.value = false;
  createScheduleProvisionalYears.value = [];
  createNameCustomized.value = false;
  createForm.name = '';
  createForm.type = 'quarterly';
  createForm.participantScope = 'all';
  createForm.startDate = undefined;
  createForm.endDate = undefined;
  createForm.goalSettingOpenAt = undefined;
  createForm.selfEvalOpenAt = undefined;
  createForm.hrOwnerId = auth.user?.sysRole === 'hr' ? auth.user.id : undefined;
  createForm.reviewerId = auth.user?.sysRole === 'hr' ? auth.user.id : undefined;
  createForm.monthlyFollowUpRequired = false;
  createForm.participantDeptIds = [];
  createForm.participantUserIds = [];
  createForm.explicitExemptDeptIds = [];
  createForm.explicitExemptUserIds = [];
  createForm.notificationMode = 'off';
  createForm.deadlineIndicatorSetting = undefined;
  createForm.deadlineIndicatorConfirm = undefined;
  createForm.deadlineSelfEval = undefined;
  createForm.deadlineManagerScore = undefined;
  createForm.deadlineHrCalibration = undefined;
  createForm.deadlineApproval = undefined;
  createForm.deadlinePublish = undefined;
  createForm.gradeAMaxRatio = 20;
  createForm.gradeBMaxRatio = 40;
  createForm.gradeCMaxRatio = 30;
  createForm.gradeDMaxRatio = 10;
  createForm.publishVisibleFields = { ...DEFAULT_VISIBLE_FIELDS };
  scoringPlan.scoringFrequency = 'monthly';
  confirmedScoringFrequency.value = 'monthly';
  scoringPlan.periodSchedules = [];
  scoringPlan.scheduleBlockers = [];
  scoringPlan.scheduleWarnings = [];
  createFormRef.value?.resetFields?.();
  createPeriodRange.value = null;
  applyCycleTypePreset('quarterly');
  createInitialSnapshot.value = createFormSnapshot();
}

function nextPeriodForType(type: CycleType): [dayjs.Dayjs, dayjs.Dayjs] | null {
  const now = dayjs();
  if (type === 'monthly') {
    const start = now.add(1, 'month').startOf('month').startOf('day');
    return [start, start.endOf('month').startOf('day')];
  }
  if (type === 'annual') {
    const start = now.add(1, 'year').startOf('year').startOf('day');
    return [start, start.endOf('year').startOf('day')];
  }
  if (type === 'semiannual') {
    const start = now.month() < 6
      ? now.startOf('year').add(6, 'month').startOf('day')
      : now.add(1, 'year').startOf('year').startOf('day');
    return [start, start.add(6, 'month').subtract(1, 'day').startOf('day')];
  }
  if (type !== 'quarterly') return null;
  const quarterStartMonth = Math.floor(now.month() / 3) * 3;
  const start = now.month(quarterStartMonth).startOf('month').add(3, 'month').startOf('day');
  const end = start.add(3, 'month').subtract(1, 'day').startOf('day');
  return [start, end];
}

function generatedCycleName(type: CycleType, start: dayjs.Dayjs, end?: dayjs.Dayjs): string {
  if (type === 'monthly') return `${start.year()}年${String(start.month() + 1).padStart(2, '0')}月绩效考核`;
  if (type === 'quarterly') return `${start.year()} Q${Math.floor(start.month() / 3) + 1} 季度考核`;
  if (type === 'semiannual') {
    const isFirstHalf = start.month() === 0 && start.date() === 1
      && end?.month() === 5 && end.date() === 30 && end.year() === start.year();
    const isSecondHalf = start.month() === 6 && start.date() === 1
      && end?.month() === 11 && end.date() === 31 && end.year() === start.year();
    if (isFirstHalf || isSecondHalf) {
      return `${start.year()} ${isFirstHalf ? '上半年' : '下半年'}绩效考核`;
    }
    if (end) {
      const startLabel = `${start.year()}年${String(start.month() + 1).padStart(2, '0')}月`;
      const endLabel = end.year() === start.year()
        ? `${String(end.month() + 1).padStart(2, '0')}月`
        : `${end.year()}年${String(end.month() + 1).padStart(2, '0')}月`;
      return `${startLabel}—${endLabel}半年绩效考核`;
    }
    return `${start.year()} 半年绩效考核`;
  }
  if (type === 'annual') return `${start.year()} 年度绩效考核`;
  if (type === 'probation') return `${start.year()} 试用期考核`;
  return `${start.year()} 自定义绩效考核`;
}

function syncGeneratedName() {
  if (createNameCustomized.value || !createForm.startDate) return;
  createForm.name = generatedCycleName(
    createForm.type,
    dayjs(createForm.startDate),
    createForm.endDate ? dayjs(createForm.endDate) : undefined,
  );
}

function applyCycleTypePreset(type: CycleType) {
  const period = nextPeriodForType(type);
  if (!period) {
    createPeriodRange.value = null;
    createForm.startDate = undefined;
    createForm.endDate = undefined;
    if (!createNameCustomized.value) createForm.name = type === 'probation' ? '试用期绩效考核' : '自定义绩效考核';
    return;
  }
  const [start, end] = period;
  createForm.startDate = start.toDate();
  createForm.endDate = end.toDate();
  createPeriodRange.value = [start.toDate(), end.toDate()];
  syncGeneratedName();
  applyDefaultCreateSchedule();
}

function handleCreateTypeChange(type: CycleType) {
  createScheduleCustomized.value = false;
  const fixedFrequency = requiredScoringFrequency(type);
  if (fixedFrequency) scoringPlan.scoringFrequency = fixedFrequency;
  applyCycleTypePreset(type);
  void refreshScoringPlan({ reason: '周期类型已调整，需要重新生成评分计划' });
}

function handleCreateNameInput() {
  createNameCustomized.value = true;
}

async function handleCreatePeriodRangeChange(value: [Date, Date] | null) {
  const previousStartDate = createForm.startDate;
  const previousEndDate = createForm.endDate;
  createForm.startDate = value?.[0];
  createForm.endDate = value?.[1];
  syncGeneratedName();
  await handleCreatePeriodChange(previousStartDate, previousEndDate);
  scheduleScoringPreview('考核期间已调整，需要重新生成评分计划');
}

async function handleSemiannualStartDateChange(value: Date | null) {
  const previousStartDate = createPeriodRange.value?.[0];
  const previousEndDate = createPeriodRange.value?.[1];
  if (!value) {
    createForm.startDate = undefined;
    createForm.endDate = undefined;
    createPeriodRange.value = null;
    return;
  }

  const start = dayjs(value).startOf('day');
  const end = start.add(6, 'month').subtract(1, 'day').startOf('day');
  createForm.startDate = start.toDate();
  createForm.endDate = end.toDate();
  createPeriodRange.value = [start.toDate(), end.toDate()];
  syncGeneratedName();
  await handleCreatePeriodChange(previousStartDate, previousEndDate);
  scheduleScoringPreview('考核期间已调整，需要重新生成评分计划');
  ElMessage.info('已按开始日期自动补齐连续六个自然月');
}

async function handleSemiannualEndDateChange(value: Date | null) {
  const previousStartDate = createPeriodRange.value?.[0];
  const previousEndDate = createPeriodRange.value?.[1];
  createForm.endDate = value ? dayjs(value).startOf('day').toDate() : undefined;
  createPeriodRange.value = createForm.startDate && createForm.endDate
    ? [createForm.startDate, createForm.endDate]
    : null;
  syncGeneratedName();
  await handleCreatePeriodChange(previousStartDate, previousEndDate);
  scheduleScoringPreview('考核期间已调整，需要重新生成评分计划');
}

function applyDefaultCreateSchedule() {
  if (!createForm.startDate || !createForm.endDate) return;
  const schedule = buildDefaultCycleSchedule(createForm.startDate, createForm.endDate);
  CREATE_SCHEDULE_NODES.forEach(({ key }) => {
    createForm[key] = schedule[key];
  });
  createScheduleProvisionalYears.value = schedule.provisionalYears;
  createScheduleCustomized.value = false;
}

function openCreateDialog() {
  resetCreateForm();
  const pristineForm = JSON.stringify(createForm);
  if (!notificationSettings.value) void loadNotificationSettings();
  createDialogVisible.value = true;
  void refreshScoringPlan().then(() => {
    if (!isEditMode.value && JSON.stringify(createForm) === pristineForm) {
      createInitialSnapshot.value = createFormSnapshot();
    }
  });
}

function openEditCycle(cycle: AssessmentCycle) {
  resetCreateForm();
  editingCycleId.value = cycle.id;
  editingWorkflowVersion.value = cycle.workflowVersion === 2 ? 2 : 1;
  editingReviewStatus.value = cycle.reviewStatus;
  createForm.name = cycle.name;
  createForm.type = cycle.type;
  createForm.startDate = toDate(cycle.startDate);
  createForm.endDate = toDate(cycle.endDate);
  createPeriodRange.value = createForm.startDate && createForm.endDate ? [createForm.startDate, createForm.endDate] : null;
  createForm.goalSettingOpenAt = toDate(cycle.goalSettingOpenAt);
  createForm.selfEvalOpenAt = toDate(cycle.selfEvalOpenAt);
  createForm.hrOwnerId = cycle.hrOwnerId;
  createForm.reviewerId = cycle.reviewerId
    ?? (auth.user?.sysRole === 'hr' ? auth.user.id : undefined);
  createForm.monthlyFollowUpRequired = Boolean(cycle.monthlyFollowUpRequired);
  createForm.participantScope = (
    (cycle.participantDeptIds?.length ?? 0) > 0
    || (cycle.participantUserIds?.length ?? 0) > 0
  ) ? 'custom' : 'all';
  createForm.participantDeptIds = [...(cycle.participantDeptIds ?? [])];
  createForm.participantUserIds = [...(cycle.participantUserIds ?? [])];
  createForm.explicitExemptDeptIds = [...(cycle.explicitExemptDeptIds ?? [])];
  createForm.explicitExemptUserIds = [...(cycle.explicitExemptUserIds ?? [])];
  createForm.notificationMode = cycle.notificationMode ?? 'off';
  createForm.gradeAMaxRatio = Math.round((cycle.gradeAMaxRatio ?? 0.2) * 100);
  createForm.gradeBMaxRatio = Math.round((cycle.gradeBMaxRatio ?? 0.4) * 100);
  createForm.gradeCMaxRatio = Math.round((cycle.gradeCMaxRatio ?? 0.3) * 100);
  createForm.gradeDMaxRatio = Math.round((cycle.gradeDMaxRatio ?? 0.1) * 100);
  createForm.publishVisibleFields = { ...DEFAULT_VISIBLE_FIELDS, ...(cycle.publishVisibleFields ?? {}) };
  DEADLINE_FIELDS.forEach(({ key }) => {
    createForm[key] = toDate(cycle[key]);
  });
  if (editingWorkflowVersion.value === 2) {
    scoringPlan.scoringFrequency = cycle.scoringFrequency ?? 'monthly';
    confirmedScoringFrequency.value = scoringPlan.scoringFrequency;
    scoringPlan.periodSchedules = clonePeriodSchedules(cycle.periodSchedules ?? []);
    scoringPlan.scheduleBlockers = [];
    scoringPlan.scheduleWarnings = [];
  }
  if (createForm.startDate && createForm.endDate) {
    createScheduleProvisionalYears.value = buildDefaultCycleSchedule(
      createForm.startDate,
      createForm.endDate,
    ).provisionalYears;
  }
  createNameCustomized.value = true;
  createScheduleCustomized.value = true;
  advancedCreateVisible.value = true;
  advancedCreateSections.value = ['schedule', 'grades', 'publication'];
  createInitialSnapshot.value = createFormSnapshot();
  if (!notificationSettings.value) void loadNotificationSettings();
  createDialogVisible.value = true;
}

function handleParticipantSelectionChange() {
  createFormRef.value?.clearValidate?.('participantDeptIds');
}

async function confirmDiscardCreateChanges(): Promise<boolean> {
  if (createFormSnapshot() === createInitialSnapshot.value) return true;
  try {
    await ElMessageBox.confirm(
      '当前周期信息尚未保存，关闭后本次修改将丢失。',
      '放弃未保存内容？',
      {
        confirmButtonText: '继续关闭',
        cancelButtonText: '返回编辑',
        type: 'warning',
      },
    );
    return true;
  } catch {
    return false;
  }
}

async function requestCloseCreateDialog() {
  if (!await confirmDiscardCreateChanges()) return;
  createDialogVisible.value = false;
  resetCreateForm();
}

async function handleCreateBeforeClose(done: () => void) {
  if (!await confirmDiscardCreateChanges()) return;
  resetCreateForm();
  done();
}

function formatDateTimeLocal(value: Date | undefined | null): string | undefined {
  if (!value) return undefined;
  const d = dayjs(value);
  return d.isValid() ? d.toDate().toISOString() : undefined;
}

function formatDateLocal(value: Date | undefined | null): string | undefined {
  if (!value) return undefined;
  const d = dayjs(value);
  return d.isValid() ? d.format('YYYY-MM-DD') : undefined;
}

function toDate(value: string | undefined | null): Date | undefined {
  if (!value) return undefined;
  const d = dayjs(value);
  return d.isValid() ? d.toDate() : undefined;
}

function formatDateTimeForMessage(value: Date | string | undefined | null): string {
  if (!value) return '未设置';
  const d = dayjs(value);
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : '未设置';
}

function handleCreateScheduleChange() {
  createScheduleCustomized.value = true;
}

async function handleCreatePeriodChange(previousStartDate?: Date, previousEndDate?: Date) {
  if (!createScheduleCustomized.value) {
    applyDefaultCreateSchedule();
    return;
  }
  if (
    !isEditMode.value
    || !previousStartDate
    || !previousEndDate
    || !createForm.startDate
    || !createForm.endDate
  ) return;

  const previousPeriod = `${dayjs(previousStartDate).format('YYYY-MM-DD')}—${dayjs(previousEndDate).format('YYYY-MM-DD')}`;
  const nextPeriod = `${dayjs(createForm.startDate).format('YYYY-MM-DD')}—${dayjs(createForm.endDate).format('YYYY-MM-DD')}`;
  if (previousPeriod === nextPeriod) return;

  try {
    await ElMessageBox.confirm(
      `考核期间已由「${previousPeriod}」调整为「${nextPeriod}」。系统可以按照新的考核期间和中国法定工作日，重新生成全部 01–09 时间节点；若节点已经人工调整，也可以保留当前设置。`,
      '是否同步调整时间节点？',
      {
        type: 'warning',
        confirmButtonText: '同步重新生成（推荐）',
        cancelButtonText: '保留当前时间节点',
        showClose: false,
        closeOnClickModal: false,
        closeOnPressEscape: false,
      },
    );
    applyDefaultCreateSchedule();
    ElMessage.success('已按新的考核期间重新生成时间节点');
  } catch (action) {
    if (action === 'cancel') {
      ElMessage.info('已保留当前时间节点，请确认各节点仍与新的考核期间匹配');
    }
  }
}

async function loadNotificationSettings() {
  notificationSettingsLoading.value = true;
  try {
    notificationSettings.value = await cyclesApi.getDingtalkNotificationSettings();
  } catch {
    notificationSettings.value = null;
  } finally {
    notificationSettingsLoading.value = false;
  }
}

async function handleDingtalkNotificationToggle(value: string | number | boolean) {
  notificationSettingsSaving.value = true;
  try {
    notificationSettings.value = await cyclesApi.updateDingtalkNotificationSettings(Boolean(value));
    ElMessage.success(Boolean(value) ? '钉钉绩效通知总开关已开启' : '钉钉绩效通知总开关已关闭');
  } catch {
    await loadNotificationSettings();
  } finally {
    notificationSettingsSaving.value = false;
  }
}

function openNotificationModeDialog(cycle: AssessmentCycle) {
  notificationCycle.value = cycle;
  notificationModeDraft.value = cycle.notificationMode ?? 'off';
  notificationDialogVisible.value = true;
}

async function saveNotificationMode() {
  if (!notificationCycle.value) return;
  submitting.value = true;
  try {
    const updated = await cyclesApi.updateNotificationMode(notificationCycle.value.id, notificationModeDraft.value);
    const index = cycles.value.findIndex((item) => item.id === updated.id);
    if (index >= 0) cycles.value[index] = updated;
    if (cycleDetail.value?.id === updated.id) cycleDetail.value = updated;
    notificationDialogVisible.value = false;
    ElMessage.success('周期通知策略已更新');
  } finally {
    submitting.value = false;
  }
}

function getCreateDeadlineValidationMessage(): string | null {
  if (createForm.startDate && createForm.endDate && !dayjs(createForm.endDate).isAfter(createForm.startDate)) {
    return `结束日期必须晚于开始日期（${formatDate(createForm.startDate)}）。`;
  }

  if (!createForm.goalSettingOpenAt || !createForm.selfEvalOpenAt) {
    return '请设置目标制定和自评的开放时间。';
  }
  const goalDates = [
    { label: '目标制定开放', value: createForm.goalSettingOpenAt },
    { label: '指标制定截止', value: createForm.deadlineIndicatorSetting },
    { label: '指标确认截止', value: createForm.deadlineIndicatorConfirm },
  ].filter((item): item is { label: string; value: Date } => Boolean(item.value));
  const resultDates = [
    { label: '自评开放', value: createForm.selfEvalOpenAt },
    ...DEADLINE_FIELDS.slice(2).map(({ key, label }) => ({ label, value: createForm[key] })),
  ].filter((item): item is { label: string; value: Date } => Boolean(item.value));

  for (const sequence of [goalDates, resultDates]) {
    for (let i = 1; i < sequence.length; i++) {
      if (dayjs(sequence[i].value).isBefore(sequence[i - 1].value)) {
        return `${sequence[i].label}不能早于${sequence[i - 1].label}。`;
      }
    }
  }

  return null;
}

function clonePeriodSchedules(schedules: CyclePeriodSchedule[]): CyclePeriodSchedule[] {
  return schedules.map((schedule) => ({ ...schedule }));
}

function requiredScoringFrequency(type: CycleType): ScoringFrequency | null {
  if (type === 'monthly') return 'monthly';
  if (type === 'custom' || type === 'probation') return 'cycle';
  return null;
}

async function confirmScheduleRegeneration(reason: string): Promise<boolean> {
  if (!scoringPlan.periodSchedules.some((schedule) => schedule.isException)) return true;
  try {
    await ElMessageBox.confirm(
      `${reason}。当前评分计划包含特殊月份，重新生成会替换这些调整；也可以保留当前设置。`,
      '重新生成还是保留当前评分计划？',
      {
        type: 'warning',
        confirmButtonText: '重新生成评分计划',
        cancelButtonText: '保留当前评分计划',
        showClose: false,
        closeOnClickModal: false,
        closeOnPressEscape: false,
      },
    );
    return true;
  } catch {
    return false;
  }
}

async function refreshScoringPlan(options: {
  reason?: string;
  preserveExceptions?: boolean;
  previousFrequency?: ScoringFrequency;
} = {}): Promise<boolean> {
  if (!isWorkflowV2Form.value || !createForm.startDate || !createForm.endDate) return false;
  const requestId = ++schedulePreviewRequest;
  const preview = await cyclesApi.previewSchedule({
    type: createForm.type,
    scoringFrequency: scoringPlan.scoringFrequency,
    startDate: formatDateLocal(createForm.startDate)!,
    endDate: formatDateLocal(createForm.endDate)!,
  });
  if (requestId !== schedulePreviewRequest) return false;

  if (options.reason && !await confirmScheduleRegeneration(options.reason)) {
    if (options.previousFrequency) scoringPlan.scoringFrequency = options.previousFrequency;
    return false;
  }

  const exceptions = new Map(
    scoringPlan.periodSchedules
      .filter((schedule) => schedule.isException)
      .map((schedule) => [schedule.periodKey, { ...schedule }]),
  );
  scoringPlan.periodSchedules = preview.schedules.map((schedule) => (
    options.preserveExceptions && exceptions.has(schedule.periodKey)
      ? { ...exceptions.get(schedule.periodKey)! }
      : { ...schedule }
  ));
  scoringPlan.scoringFrequency = preview.scoringFrequency;
  confirmedScoringFrequency.value = preview.scoringFrequency;
  scoringPlan.scheduleBlockers = [...preview.blockers];
  scoringPlan.scheduleWarnings = [...preview.warnings];
  return true;
}

function scheduleScoringPreview(reason: string) {
  if (!isWorkflowV2Form.value) return;
  if (schedulePreviewTimer) clearTimeout(schedulePreviewTimer);
  pendingSchedulePreviewReason = reason;
  schedulePreviewTimer = setTimeout(() => {
    schedulePreviewTimer = undefined;
    pendingSchedulePreviewReason = '';
    void refreshScoringPlan({ reason });
  }, 300);
}

async function handleScoringFrequencyChange(frequency: ScoringFrequency) {
  const previousFrequency = confirmedScoringFrequency.value;
  scoringPlan.scoringFrequency = frequency;
  await refreshScoringPlan({
    reason: '评分频率已调整，需要按新频率重新生成评分计划',
    previousFrequency,
  });
}

function handleScoringSchedulesUpdate(schedules: CyclePeriodSchedule[]) {
  scoringPlan.periodSchedules = clonePeriodSchedules(schedules);
  const blockers: CycleScheduleIssue[] = [];
  schedules.forEach((schedule) => {
    if (dayjs(schedule.selfEvalDueAt).isBefore(dayjs(schedule.selfEvalOpenAt))) {
      blockers.push({
        code: 'SELF_EVAL_DUE_BEFORE_OPEN',
        periodKey: schedule.periodKey,
        message: '员工完成时间不得早于自评开放时间',
      });
      return;
    }
    if (dayjs(schedule.managerDueAt).isBefore(dayjs(schedule.selfEvalDueAt))) {
      blockers.push({
        code: 'MANAGER_DUE_BEFORE_SELF_EVAL',
        periodKey: schedule.periodKey,
        message: '主管完成时间不得早于员工完成时间',
      });
    }
  });
  scoringPlan.scheduleBlockers = blockers;
}

async function handleRestoreScoringSchedule(schedule: CyclePeriodSchedule) {
  if (!createForm.startDate || !createForm.endDate) return;
  const preview = await cyclesApi.previewSchedule({
    type: createForm.type,
    scoringFrequency: scoringPlan.scoringFrequency,
    startDate: formatDateLocal(createForm.startDate)!,
    endDate: formatDateLocal(createForm.endDate)!,
  });
  const restored = preview.schedules.find((item) => item.periodKey === schedule.periodKey);
  if (!restored) return;
  scoringPlan.periodSchedules = scoringPlan.periodSchedules.map((item) => (
    item.periodKey === schedule.periodKey ? { ...restored } : { ...item }
  ));
  scoringPlan.scheduleBlockers = [...preview.blockers];
  scoringPlan.scheduleWarnings = [...preview.warnings];
}

async function handleRestoreAllScoringSchedules() {
  await refreshScoringPlan({ reason: '将恢复 API 生成的全部默认评分计划' });
}

async function handleApplyUnifiedScoringRule(options: { preserveExceptions: boolean }) {
  await refreshScoringPlan({
    reason: options.preserveExceptions ? undefined : '统一调整将覆盖特殊月份',
    preserveExceptions: options.preserveExceptions,
  });
}

function getCreateScheduleBoundaryWarning(node: (typeof CREATE_SCHEDULE_NODES)[number]): string {
  const value = createForm[node.key];
  if (!value) return '';

  if (
    node.stage === 'preparation'
    && createForm.startDate
    && !dayjs(value).isBefore(createForm.startDate)
  ) {
    return '该时间已进入考核期间，仍可保存，请确认符合实际安排。';
  }

  if (
    node.stage === 'result'
    && createForm.endDate
    && dayjs(value).isBefore(dayjs(createForm.endDate).add(1, 'day').startOf('day'))
  ) {
    return '该时间早于考核期间结束，仍可保存，请确认符合实际安排。';
  }

  return '';
}

async function focusFirstInvalidScheduleRow() {
  const issue = scoringPlan.scheduleBlockers[0];
  if (!issue) return;
  await nextTick();
  const index = scoringPlan.periodSchedules.findIndex((schedule) => schedule.periodKey === issue.periodKey);
  const rows = document.querySelectorAll<HTMLElement>('[data-testid="cycle-month-schedule-row"]');
  const row = rows[Math.max(index, 0)];
  if (!row) return;
  const code = issue.code.toLowerCase();
  const fieldTestId = code.includes('manager')
    ? 'manager-due-at'
    : code.includes('self') || code.includes('employee')
      ? 'self-eval-due-at'
      : 'self-eval-open-at';
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.querySelector<HTMLElement>(`[data-testid="${fieldTestId}"] input`)?.focus();
}

async function confirmScheduleWarnings(): Promise<boolean> {
  if (!isWorkflowV2Form.value || scoringPlan.scheduleWarnings.length === 0) return true;
  try {
    await ElMessageBox.confirm(
      scoringPlan.scheduleWarnings.map((warning) => warning.message).join('；'),
      '确认评分计划提示',
      {
        type: 'warning',
        confirmButtonText: '确认并继续',
        cancelButtonText: '返回调整',
      },
    );
    return true;
  } catch {
    return false;
  }
}

function buildCreateBody(): CreateCycleBody {
  const body: CreateCycleBody = {
    name: createForm.name,
    type: createForm.type,
    startDate: formatDateLocal(createForm.startDate)!,
    endDate: formatDateLocal(createForm.endDate)!,
    goalSettingOpenAt: formatDateTimeLocal(createForm.goalSettingOpenAt),
    selfEvalOpenAt: formatDateTimeLocal(createForm.selfEvalOpenAt),
    reviewerId: createForm.reviewerId,
    monthlyFollowUpRequired: ['quarterly', 'semiannual', 'annual'].includes(createForm.type)
      ? createForm.monthlyFollowUpRequired
      : false,
    participantDeptIds: [...createForm.participantDeptIds],
    participantUserIds: [...createForm.participantUserIds],
    explicitExemptDeptIds: [...createForm.explicitExemptDeptIds],
    explicitExemptUserIds: [...createForm.explicitExemptUserIds],
    notificationMode: createForm.notificationMode,
    publishVisibleFields: { ...createForm.publishVisibleFields },
  };

  DEADLINE_FIELDS.forEach(({ key }) => {
    const v = createForm[key];
    if (v) body[key] = formatDateTimeLocal(v);
  });

  GRADE_RATIO_FIELDS.forEach(({ key }) => {
    const percent = createForm[key as keyof typeof createForm] as number;
    body[key] = percent / 100;
  });

  if (isWorkflowV2Form.value) {
    body.workflowVersion = 2;
    body.scoringFrequency = scoringPlan.scoringFrequency;
    body.periodSchedules = scoringPlan.periodSchedules.map((schedule) => {
      const normalized = { ...schedule };
      delete normalized.id;
      return normalized;
    });
  }

  return body;
}

async function handleCreate(openWorkspace = false) {
  if (!createFormRef.value) return;
  try {
    await createFormRef.value.validate();
  } catch {
    return;
  }

  const validationMessage = getCreateDeadlineValidationMessage();
  if (validationMessage) {
    ElMessage.warning(validationMessage);
    return;
  }

  if (isWorkflowV2Form.value && schedulePreviewTimer) {
    clearTimeout(schedulePreviewTimer);
    schedulePreviewTimer = undefined;
    const reason = pendingSchedulePreviewReason;
    pendingSchedulePreviewReason = '';
    if (!await refreshScoringPlan({ reason })) return;
  }
  if (isWorkflowV2Form.value && scoringPlan.periodSchedules.length === 0) {
    ElMessage.warning('评分计划尚未生成，请确认周期类型和考核期间');
    return;
  }

  if (isWorkflowV2Form.value && scoringPlan.scheduleBlockers.length > 0) {
    ElMessage.warning('评分计划存在阻断项，请先完成调整');
    await focusFirstInvalidScheduleRow();
    return;
  }
  if (!await confirmScheduleWarnings()) return;

  submitting.value = true;
  try {
    if (isEditMode.value && editingCycleId.value) {
      const updated = await cyclesApi.update(editingCycleId.value, buildCreateBody());
      ElMessage.success('周期已保存');
      createDialogVisible.value = false;
      resetCreateForm();
      if (cycleDetail.value?.id === updated.id) cycleDetail.value = updated;
      await loadCycles();
      if (openWorkspace) {
        await openCycleWorkspace(updated);
      }
    } else {
      const created = await cyclesApi.create(buildCreateBody());
      ElMessage.success(openWorkspace ? '周期已保存' : '周期草稿已保存');
      createDialogVisible.value = false;
      resetCreateForm();
      await loadCycles();
      if (openWorkspace) {
        await openCycleWorkspace(created);
      }
    }
  } catch {
    // 写请求失败已由 HTTP 拦截器显示后端业务文案，这里只负责收起 loading。
  } finally {
    submitting.value = false;
  }
}

function openEditDeadlines(cycle: AssessmentCycle) {
  editingCycle.value = cycle;
  DEADLINE_FIELDS.forEach(({ key }) => {
    editForm[key] = toDate(cycle[key]);
  });
  editDialogVisible.value = true;
}

function buildDeadlinesBody(): UpdateDeadlinesBody {
  const body: UpdateDeadlinesBody = {};
  DEADLINE_FIELDS.forEach(({ key }) => {
    const v = editForm[key];
    if (v) body[key] = formatDateTimeLocal(v);
  });
  return body;
}

function getDeadlineValidationMessage(): string | null {
  const cycle = editingCycle.value;
  if (!cycle) return '请先选择要修改的考核周期';

  for (const { key, label } of DEADLINE_FIELDS) {
    const current = editForm[key];
    const original = toDate(cycle[key]);
    if (current && original && dayjs(current).isBefore(original)) {
      return `${label}不能早于当前截止日（${formatDateTimeForMessage(original)}）。系统只支持延期，请选择更晚的时间。`;
    }
  }

  const merged: Array<{ label: string; value: Date }> = [];
  DEADLINE_FIELDS.forEach(({ key, label }) => {
    const value = editForm[key] ?? toDate(cycle[key]);
    if (value) merged.push({ label, value });
  });

  for (let i = 1; i < merged.length; i++) {
    const previous = merged[i - 1];
    const current = merged[i];
    if (dayjs(current.value).isBefore(previous.value)) {
      return `${current.label}不能早于${previous.label}。请按流程顺序设置截止时间：前一节点结束后，再进入下一节点。`;
    }
  }

  return null;
}

async function handleUpdateDeadlines() {
  if (!editFormRef.value || !editingCycle.value) return;
  try {
    await editFormRef.value.validate();
  } catch {
    return;
  }

  const validationMessage = getDeadlineValidationMessage();
  if (validationMessage) {
    ElMessage.warning(validationMessage);
    return;
  }

  submitting.value = true;
  try {
    await cyclesApi.updateDeadlines(editingCycle.value.id, buildDeadlinesBody());
    ElMessage.success('修改截止日成功');
    editDialogVisible.value = false;
    editingCycle.value = null;
    await loadCycles();
    if (isCycleWorkspace.value && cycleDetail.value) await loadCycleDetail(cycleDetail.value.id);
  } catch (e) {
    // 写请求失败已由 HTTP 拦截器提示，这里只负责收起 loading，避免重复弹出 Axios 英文错误。
  } finally {
    submitting.value = false;
  }
}

async function handleLaunch(cycle: AssessmentCycle) {
  if (!preflight.value?.planHash) return;
  let overrideReason: string | undefined;
  try {
    if (
      auth.user?.sysRole === 'system_admin'
      && preflight.value.cycle.goalSettingOpenAt
      && dayjs(preflight.value.cycle.goalSettingOpenAt).isAfter(dayjs())
    ) {
      const prompt = await ElMessageBox.prompt(
        '当前尚未到目标制定开放时间。提前发起会立即通知员工，请填写业务原因（至少 5 个字）。',
        '提前发起说明',
        {
          confirmButtonText: '继续',
          cancelButtonText: '取消',
          inputValidator: (value) => value.trim().length >= 5 || '请填写至少 5 个字的原因',
        },
      );
      overrideReason = prompt.value.trim();
    }
    await ElMessageBox.confirm(
      `发起后将为参与员工创建空白目标任务，该操作不可撤销。\n\n确认发起「${cycle.name}」？`,
      '确认发起周期',
      {
        confirmButtonText: '确认发起',
        cancelButtonText: '取消',
        type: 'warning',
      },
    );
  } catch {
    return;
  }

  launchingId.value = cycle.id;
  try {
    await cyclesApi.launch(cycle.id, {
      expectedPlanHash: preflight.value.planHash,
      overrideReason,
    });
    ElMessage.success('周期已发起，员工可开始目标制定');
    preflight.value = null;
    await loadCycles();
    await loadCycleDetail(cycle.id);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '发起周期失败');
  } finally {
    launchingId.value = null;
  }
}

async function handlePreflight(cycle: AssessmentCycle) {
  preflightCycle.value = cycle;
  preflight.value = null;
  preflightError.value = '';
  preflightLoading.value = true;
  try {
    preflight.value = await cyclesApi.preflight(cycle.id);
  } catch (error) {
    preflightError.value = error instanceof Error ? error.message : '发起检查失败，请重试';
  } finally {
    preflightLoading.value = false;
  }
}

async function handleSchedule() {
  const cycle = preflightCycle.value;
  if (!cycle || !preflight.value?.ready) return;
  launchingId.value = cycle.id;
  try {
    await cyclesApi.schedule(cycle.id, preflight.value.planHash!);
    ElMessage.success(`已预约发起，将于 ${formatDateTimeForMessage(preflight.value.cycle.goalSettingOpenAt)} 自动发起周期`);
    preflight.value = null;
    await loadCycles();
    await loadCycleDetail(cycle.id);
  } finally {
    launchingId.value = null;
  }
}

async function handleCancelSchedule(cycle: AssessmentCycle) {
  try {
    await ElMessageBox.confirm(
      `确认取消「${cycle.name}」的自动发起预约？`,
      '取消预约',
      { type: 'warning', confirmButtonText: '确认取消', cancelButtonText: '保留预约' },
    );
  } catch {
    return;
  }
  launchingId.value = cycle.id;
  try {
    await cyclesApi.cancelSchedule(cycle.id);
    ElMessage.success('已恢复为草稿');
    await loadCycles();
    if (isCycleWorkspace.value) await loadCycleDetail(cycle.id);
  } finally {
    launchingId.value = null;
  }
}

async function handleDeleteCycle(cycle: AssessmentCycle) {
  if (cycle.status !== 'draft') return;
  try {
    await ElMessageBox.confirm(
      `删除后无法恢复，确认删除「${cycle.name}」？`,
      '删除草稿周期',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      },
    );
  } catch {
    return;
  }

  deletingId.value = cycle.id;
  try {
    await cyclesApi.remove(cycle.id);
    ElMessage.success('草稿周期已删除');
    await loadCycles();
    if (cycles.value.length === 0 && page.value > 1) {
      page.value -= 1;
      await syncListRoute();
      await loadCycles();
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除周期失败');
  } finally {
    deletingId.value = null;
  }
}

async function loadCycleDetail(cycleId: string) {
  detailLoading.value = true;
  detailError.value = '';
  try {
    cycleDetail.value = await cyclesApi.findOne(cycleId);
  } catch (error) {
    detailError.value = error instanceof Error ? error.message : '获取周期详情失败';
  } finally {
    detailLoading.value = false;
  }
}

async function openCycleWorkspace(cycle: AssessmentCycle, runPreflight = false) {
  cycleDetail.value = cycle;
  preflight.value = null;
  preflightError.value = '';
  if (route.query.cycleId !== cycle.id) {
    await router.push({ query: { ...route.query, cycleId: cycle.id } });
  }
  await loadCycleDetail(cycle.id);
  if (runPreflight) await handlePreflight(cycleDetail.value ?? cycle);
}

async function closeCycleWorkspace() {
  const query = { ...route.query };
  delete query.cycleId;
  preflight.value = null;
  preflightError.value = '';
  cycleDetail.value = null;
  await router.replace({ query });
}

function handleView(cycle: AssessmentCycle) {
  void openCycleWorkspace(cycle);
}

function retryCycleDetail() {
  if (typeof route.query.cycleId === 'string') void loadCycleDetail(route.query.cycleId);
}

function handleWorkspacePreflight() {
  if (cycleDetail.value) void handlePreflight(cycleDetail.value);
}

function handleWorkspaceLaunch() {
  if (cycleDetail.value) void handleLaunch(cycleDetail.value);
}

function handleWorkspaceEditCycle() {
  if (cycleDetail.value) openEditCycle(cycleDetail.value);
}

function handleResolvePreflightBlocker(code: string) {
  const path = code.startsWith('TEMPLATE_') || code === 'NO_ACTIVE_TEMPLATES'
    ? '/templates'
    : code === 'ORGANIZATION_RELATION_INVALID'
      ? '/users'
      : '';
  if (!path) return;
  void router.push({ path, query: { returnTo: route.fullPath } });
}

function handlePrimaryCycleAction(cycle: AssessmentCycle) {
  if (['draft', 'launch_blocked'].includes(cycle.status)) {
    void openCycleWorkspace(cycle, true);
    return;
  }
  void openCycleWorkspace(cycle);
}

function buildQuery(): CycleQuery {
  const query: CycleQuery & Record<string, unknown> = {};
  if (statusFilter.value) query.status = statusFilter.value;
  else query.group = statusGroup.value;
  if (typeFilter.value) query.type = typeFilter.value;
  if (keyword.value.trim()) query.keyword = keyword.value.trim();
  return withParams(query);
}

async function syncListRoute() {
  const query = { ...route.query };
  query.group = statusGroup.value;
  if (statusFilter.value) query.status = statusFilter.value;
  else delete query.status;
  if (typeFilter.value) query.type = typeFilter.value;
  else delete query.type;
  if (keyword.value.trim()) query.keyword = keyword.value.trim();
  else delete query.keyword;
  if (page.value > 1) query.page = String(page.value);
  else delete query.page;
  await router.replace({ query });
}

async function loadCycles() {
  listLoading.value = true;
  try {
    const res = await cyclesApi.findAll(buildQuery());
    cycles.value = res.items;
    total.value = res.total;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '获取周期列表失败');
    cycles.value = [];
    total.value = 0;
  } finally {
    listLoading.value = false;
  }
}

async function handleSearch() {
  page.value = 1;
  await syncListRoute();
  await loadCycles();
}

async function handleReset() {
  statusGroup.value = 'attention';
  statusFilter.value = '';
  typeFilter.value = '';
  keyword.value = '';
  page.value = 1;
  await syncListRoute();
  await loadCycles();
}

async function selectStatusGroup(group: CycleStatusGroup) {
  if (statusGroup.value === group && !statusFilter.value) return;
  statusGroup.value = group;
  statusFilter.value = '';
  page.value = 1;
  await syncListRoute();
  await loadCycles();
}

async function handleStatusFilterChange(status: CycleStatus | '') {
  if (status) statusGroup.value = cycleStatusGroup(status);
  await handleSearch();
}

async function handleReviewCycle(cycle: AssessmentCycle) {
  const scoringSummary = cycle.workflowVersion === 2
    ? cycle.scoringFrequency === 'monthly'
      ? `按月评分，共 ${cycle.periodSchedules?.length ?? 0} 期`
      : '按整个周期评分，共 1 期'
    : '历史流程';
  const reviewSummary = cycle.workflowVersion === 2
    ? `结果按周期审核；特殊月份 ${cycle.periodSchedules?.filter((schedule) => schedule.isException).length ?? 0} 个；公司最终审定人 ${cycle.companyFinalApprover?.name || '未配置'}；`
    : '';
  try {
    await ElMessageBox.confirm(
      `确认审核通过「${cycle.name}」？${scoringSummary}。${reviewSummary}通过后创建人可执行发起检查。`,
      '审核周期计划',
      { confirmButtonText: '审核通过', cancelButtonText: '取消', type: 'warning' },
    );
    await cyclesApi.review(cycle.id, 'approve');
    ElMessage.success('周期计划已审核通过');
    await loadCycles();
    if (isCycleWorkspace.value) await loadCycleDetail(cycle.id);
  } catch {
    // 用户取消或接口错误由拦截器展示。
  }
}

onChange(() => {
  void syncListRoute();
  void loadCycles();
});

onMounted(() => {
  loadCycles();
  loadNotificationSettings();
  if (typeof route.query.cycleId === 'string') void loadCycleDetail(route.query.cycleId);
  departmentsApi.findAll({ isActive: true }).then((items) => {
    departments.value = items;
    departmentsState.value = 'ready';
  }).catch(() => {
    departments.value = [];
    departmentsState.value = 'failed';
  });
});
</script>

<template>
  <div class="cycle-manage-view page-stack" :class="{ 'app-list-page': !isCycleWorkspace }">
    <CycleWorkspaceShell
      v-if="isCycleWorkspace"
      :cycle="cycleDetail"
      :loading="detailLoading"
      :error="detailError"
      :preflight="preflight"
      :preflight-loading="preflightLoading"
      :preflight-error="preflightError"
      :launching="launchingId === cycleDetail?.id"
      :can-open-immediately="canOpenImmediately"
      :can-edit="canEditCyclePlan"
      @back="closeCycleWorkspace"
      @retry="retryCycleDetail"
      @preflight="handleWorkspacePreflight"
      @launch="handleWorkspaceLaunch"
      @schedule="handleSchedule"
      @edit="handleWorkspaceEditCycle"
      @resolve-blocker="handleResolvePreflightBlocker"
    />

    <template v-else>
    <ChartCard class="list-page-header-card">
      <template #title>考核周期管理</template>
      <template #extra>
        <div class="cycle-header-actions">
          <div
            data-testid="dingtalk-notification-status"
            class="dingtalk-notification-status"
            :class="{ 'is-enabled': notificationSettings?.effectiveEnabled }"
          >
            <span>{{ notificationSettings?.effectiveEnabled ? '钉钉通知已开启' : '钉钉通知已关闭' }}</span>
            <el-switch
              data-testid="dingtalk-global-toggle"
              :model-value="notificationSettings?.enabled ?? false"
              :loading="notificationSettingsLoading || notificationSettingsSaving"
              :disabled="!notificationSettings?.available"
              @change="handleDingtalkNotificationToggle"
            />
          </div>
          <el-button v-if="canEditCyclePlan" data-testid="cycle-create" type="primary" @click="openCreateDialog">新建周期</el-button>
        </div>
      </template>

      <CollapsibleFilterPanel title="周期筛选" class="page-filter-panel">
        <div class="cycle-list-toolbar">
        <div class="cycle-group-tabs" aria-label="周期状态分组">
          <button
            v-for="group in CYCLE_STATUS_GROUPS"
            :key="group.value"
            type="button"
            :data-testid="`cycle-group-${group.value}`"
            :class="{ 'is-active': statusGroup === group.value }"
            :aria-pressed="statusGroup === group.value"
            @click="selectStatusGroup(group.value)"
          >
            {{ group.label }}
          </button>
        </div>

        <div class="filter-row">
        <el-select
          v-model="statusFilter"
          placeholder="精确状态"
          clearable
          style="width: 160px"
          @change="handleStatusFilterChange"
        >
          <el-option v-for="opt in CYCLE_STATUS_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
        <el-select v-model="typeFilter" placeholder="全部类型" clearable style="width: 160px" @change="handleSearch">
          <el-option v-for="opt in CYCLE_TYPE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
        <el-input
          v-model="keyword"
          placeholder="周期名称"
          clearable
          style="width: 240px"
          @keyup.enter="handleSearch"
        />
        <el-button type="primary" plain @click="handleSearch">查询</el-button>
        <el-button @click="handleReset">重置</el-button>
        </div>
        </div>
      </CollapsibleFilterPanel>
    </ChartCard>

    <ChartCard :padded="false" class="list-result-card">
      <CycleCompactTable
        v-if="listLoading || cycles.length > 0"
        :cycles="cycles"
        :departments="departments"
        :department-state="departmentsState"
        :loading="listLoading"
        :launching-id="launchingId"
        :deleting-id="deletingId"
        :current-user-id="auth.user?.id"
        :is-system-admin="auth.user?.sysRole === 'system_admin'"
        :can-edit="canEditCyclePlan"
        @open="handleView"
        @primary="handlePrimaryCycleAction"
        @edit-cycle="openEditCycle"
        @edit-deadlines="openEditDeadlines"
        @cancel-schedule="handleCancelSchedule"
        @notification-mode="openNotificationModeDialog"
        @delete="handleDeleteCycle"
        @review="handleReviewCycle"
      />

      <div v-else data-testid="cycle-empty-state" class="cycle-empty-state">
        <EmptyState :description="emptyStateDescription">
          <el-button
            v-if="canEditCyclePlan && statusGroup === 'attention' && !hasListFilters"
            data-testid="cycle-empty-create"
            type="primary"
            @click="openCreateDialog"
          >
            创建绩效周期
          </el-button>
          <el-button v-else-if="hasListFilters" @click="handleReset">清空筛选</el-button>
        </EmptyState>
      </div>

      <div v-if="listLoading || total > 0" class="app-pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="pageSizeOptions"
          :total="total"
          layout="total, sizes, prev, pager, next"
          background
        />
      </div>
    </ChartCard>

    </template>

    <!-- 新建/编辑周期 -->
    <el-dialog
      v-model="createDialogVisible"
      class="cycle-create-dialog"
      data-testid="cycle-create-dialog"
      :title="isEditMode ? '编辑绩效周期' : '创建绩效周期'"
      width="760px"
      destroy-on-close
      :before-close="handleCreateBeforeClose"
    >
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="108px">
        <section class="cycle-create-main" aria-label="周期关键设置">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="周期类型" prop="type">
              <template #label>
                <span class="form-label-with-help">周期类型
                  <el-tooltip content="选择后自动生成建议的周期名称、考核期间和时间节点" placement="top">
                    <el-icon><QuestionFilled /></el-icon>
                  </el-tooltip>
                </span>
              </template>
              <el-select v-model="createForm.type" placeholder="请选择" style="width: 100%" @change="handleCreateTypeChange">
                <el-option v-for="opt in CYCLE_TYPE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="周期名称" prop="name">
              <el-input v-model="createForm.name" placeholder="系统自动生成，可直接修改" @input="handleCreateNameInput" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item prop="startDate">
          <template #label>
            <span class="form-label-with-help">考核期间
              <el-tooltip content="新建周期时会自动联动；编辑已保存周期并修改期间时，可选择重新生成或保留现有时间节点" placement="top">
                <el-icon><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <div v-if="createForm.type === 'semiannual'" class="cycle-semiannual-period">
            <el-date-picker
              v-model="createForm.startDate"
              data-testid="cycle-semiannual-start"
              type="date"
              placeholder="开始日期"
              :clearable="false"
              style="width: 100%"
              @change="handleSemiannualStartDateChange"
            />
            <span class="cycle-semiannual-period__separator">至</span>
            <el-date-picker
              v-model="createForm.endDate"
              data-testid="cycle-semiannual-end"
              type="date"
              placeholder="结束日期"
              :clearable="false"
              style="width: 100%"
              @change="handleSemiannualEndDateChange"
            />
          </div>
          <el-date-picker
            v-else
            v-model="createPeriodRange"
            data-testid="cycle-period-range"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            style="width: 100%"
            @change="handleCreatePeriodRangeChange"
          />
          <el-alert
            v-if="semiannualPeriodWarning"
            class="cycle-semiannual-warning"
            data-testid="cycle-semiannual-warning"
            type="warning"
            :closable="false"
            show-icon
            :title="semiannualPeriodWarning"
          />
        </el-form-item>

        <section v-if="isWorkflowV2Form" class="cycle-create-scoring-plan">
          <CycleScoringSettings
            :cycle-type="createForm.type"
            :scoring-frequency="scoringPlan.scoringFrequency"
            @update:scoring-frequency="scoringPlan.scoringFrequency = $event"
            @change="handleScoringFrequencyChange"
          />
          <el-alert
            v-if="reviewResetRequired"
            data-testid="cycle-review-reset-warning"
            type="warning"
            :closable="false"
            show-icon
            title="评分配置已变化，修改后需重新审核"
          />
          <CycleMonthlyScheduleEditor
            :schedules="scoringPlan.periodSchedules"
            :warnings="scoringPlan.scheduleWarnings"
            :blockers="scoringPlan.scheduleBlockers"
            @update:schedules="handleScoringSchedulesUpdate"
            @restore-one="handleRestoreScoringSchedule"
            @restore-all="handleRestoreAllScoringSchedules"
            @apply-unified="handleApplyUnifiedScoringRule"
          />
        </section>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="考核范围" prop="participantDeptIds">
              <template #label>
                <span class="form-label-with-help">考核范围
                  <el-tooltip content="自定义范围支持部门与人员混选，并可明确排除个别人" placement="top">
                    <el-icon><QuestionFilled /></el-icon>
                  </el-tooltip>
                </span>
              </template>
              <CycleParticipantScopePicker
                v-model:scope="createForm.participantScope"
                v-model:department-ids="createForm.participantDeptIds"
                v-model:user-ids="createForm.participantUserIds"
                v-model:excluded-department-ids="createForm.explicitExemptDeptIds"
                v-model:excluded-user-ids="createForm.explicitExemptUserIds"
                :departments="departments"
                @change="handleParticipantSelectionChange"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="审核人" prop="reviewerId">
              <UserSelect
                v-model="createForm.reviewerId"
                sys-role="hr"
                status="active"
                :clearable="false"
                placeholder="选择 HR 管理员审核"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item v-if="['quarterly', 'semiannual', 'annual'].includes(createForm.type)" label="月度跟进">
          <el-switch
            v-model="createForm.monthlyFollowUpRequired"
            active-text="需要按月跟进"
            inactive-text="不要求月度跟进"
          />
        </el-form-item>

        <el-form-item>
          <template #label>
            <span class="form-label-with-help">员工通知
              <el-tooltip content="不发送为默认；仅发起只通知一次；每日催办会在临期或逾期任务每天 09:00 提醒，并按 24 小时限频" placement="top">
                <el-icon><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-radio-group v-model="createForm.notificationMode" class="notification-mode-options">
            <el-radio-button data-testid="cycle-notification-off" value="off">不发送</el-radio-button>
            <el-radio-button data-testid="cycle-notification-launch-only" value="launch_only">仅发起提醒一次</el-radio-button>
            <el-radio-button data-testid="cycle-notification-reminders" value="launch_and_reminders">发起＋每日催办</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <div class="cycle-auto-plan" data-testid="cycle-plan-summary">
          <div class="cycle-auto-plan__heading">
            <el-tag size="small" :type="createScheduleCustomized ? 'warning' : 'info'" effect="light">
              {{ createSchedulePlanLabel }}
            </el-tag>
            <span>按中国法定工作日（含调休）</span>
            <el-tooltip content="时间节点按法定工作日顺序生成，保存后不会因日历更新而自动改变" placement="top">
              <el-icon><QuestionFilled /></el-icon>
            </el-tooltip>
          </div>
          <span>目标制定开放 {{ formatDateTimeForMessage(createForm.goalSettingOpenAt) }} · 员工自评开放 {{ formatDateTimeForMessage(createForm.selfEvalOpenAt) }}</span>
        </div>

        <button
          type="button"
          class="advanced-create-toggle"
          data-testid="cycle-create-advanced"
          :aria-expanded="advancedCreateVisible"
          @click="advancedCreateVisible = !advancedCreateVisible"
        >
          <span>{{ advancedCreateVisible ? '收起高级设置' : '高级设置' }}</span>
          <small>{{ createScheduleCustomized ? '时间计划已调整' : '通常无需修改' }}</small>
        </button>

        <div v-show="advancedCreateVisible" data-testid="cycle-advanced-fields" class="advanced-create-fields">
          <el-collapse v-model="advancedCreateSections" class="advanced-create-groups">
            <el-collapse-item name="schedule">
              <template #title>
                <div data-testid="cycle-advanced-schedule" class="advanced-group-title">
                  <strong>时间节点
                    <el-tooltip content="默认随考核期间按法定工作日自动生成；调整任一节点后标记为已调整计划" placement="top">
                      <el-icon><QuestionFilled /></el-icon>
                    </el-tooltip>
                  </strong>
                  <span>{{ createSchedulePlanLabel }}</span>
                </div>
              </template>
              <div class="advanced-group-actions">
                <span>节点按实际业务顺序执行，开放时间为 09:00，截止时间为 18:00</span>
                <el-button text type="primary" @click.stop="applyDefaultCreateSchedule">恢复默认计划</el-button>
              </div>
              <div
                v-if="createScheduleProvisionalYears.length"
                class="schedule-calendar-warning"
                data-testid="cycle-schedule-calendar-warning"
              >
                {{ createScheduleProvisionalYearLabel }} 年法定节假日日历尚未维护，相关节点暂按周一至周五排期，并避开元旦等固定法定节日；保存后不会自动变化。
              </div>

              <section class="schedule-stage" aria-labelledby="schedule-stage-preparation">
                <div class="schedule-stage__title">
                  <strong id="schedule-stage-preparation">目标准备</strong>
                  <span>考核开始前完成</span>
                </div>
                <div
                  v-for="node in PREPARATION_SCHEDULE_NODES"
                  :key="node.key"
                  class="schedule-node"
                  data-testid="cycle-schedule-node"
                >
                  <span class="schedule-node__number">{{ node.number }}</span>
                  <div class="schedule-node__copy">
                    <strong>{{ node.label }}</strong>
                    <small>{{ node.helper }}</small>
                  </div>
                  <div class="schedule-node__input">
                    <el-date-picker
                      v-model="createForm[node.key]"
                      type="datetime"
                      :placeholder="`选择${node.label}`"
                      @change="handleCreateScheduleChange"
                    />
                    <small
                      v-if="getCreateScheduleBoundaryWarning(node)"
                      class="schedule-node__warning"
                      data-testid="cycle-schedule-boundary-warning"
                    >{{ getCreateScheduleBoundaryWarning(node) }}</small>
                  </div>
                </div>
              </section>

              <div class="schedule-period" data-testid="cycle-schedule-period">
                {{ createSchedulePeriodLabel }}
              </div>

              <section class="schedule-stage" aria-labelledby="schedule-stage-result">
                <div class="schedule-stage__title">
                  <strong id="schedule-stage-result">评价与结果</strong>
                  <span>考核结束后依次完成</span>
                </div>
                <div
                  v-for="node in RESULT_SCHEDULE_NODES"
                  :key="node.key"
                  class="schedule-node"
                  data-testid="cycle-schedule-node"
                >
                  <span class="schedule-node__number">{{ node.number }}</span>
                  <div class="schedule-node__copy">
                    <strong>{{ node.label }}</strong>
                    <small>{{ node.helper }}</small>
                  </div>
                  <div class="schedule-node__input">
                    <el-date-picker
                      v-model="createForm[node.key]"
                      type="datetime"
                      :placeholder="`选择${node.label}`"
                      @change="handleCreateScheduleChange"
                    />
                    <small
                      v-if="getCreateScheduleBoundaryWarning(node)"
                      class="schedule-node__warning"
                      data-testid="cycle-schedule-boundary-warning"
                    >{{ getCreateScheduleBoundaryWarning(node) }}</small>
                  </div>
                </div>
              </section>
            </el-collapse-item>

            <el-collapse-item name="grades">
              <template #title>
                <div data-testid="cycle-advanced-grades" class="advanced-group-title">
                  <strong>等级比例
                    <el-tooltip content="用于校准阶段判断各绩效等级是否超过建议上限" placement="top">
                      <el-icon><QuestionFilled /></el-icon>
                    </el-tooltip>
                  </strong>
                  <span>{{ gradeRatioSummary }}</span>
                </div>
              </template>
              <el-row :gutter="16">
                <el-col v-for="field in GRADE_RATIO_FIELDS" :key="field.key" :span="12">
                  <el-form-item :label="field.label">
                    <el-input-number
                      v-model="createForm[field.key]"
                      :min="0"
                      :max="100"
                      :precision="1"
                      :step="1"
                      style="width: 100%"
                      controls-position="right"
                    />
                  </el-form-item>
                </el-col>
              </el-row>
            </el-collapse-item>

            <el-collapse-item name="publication">
              <template #title>
                <div data-testid="cycle-advanced-publication" class="advanced-group-title">
                  <strong>公示范围
                    <el-tooltip content="设置结果公示后员工可以看到的字段；绩效系数默认隐藏" placement="top">
                      <el-icon><QuestionFilled /></el-icon>
                    </el-tooltip>
                  </strong>
                  <span>{{ visibleFieldCount }} 项可见</span>
                </div>
              </template>
              <el-form-item label="员工可见内容">
                <div class="checkbox-list">
                  <el-checkbox
                    v-for="opt in VISIBLE_FIELD_OPTIONS"
                    :key="opt.key"
                    v-model="createForm.publishVisibleFields[opt.key]"
                  >
                    {{ opt.label }}
                  </el-checkbox>
                </div>
              </el-form-item>
            </el-collapse-item>
          </el-collapse>
        </div>
          <div class="cycle-creator-note">
            创建人：{{ isEditMode ? (cycles.find((item) => item.id === editingCycleId)?.creator?.name || auth.user?.name) : auth.user?.name }}
          </div>
        </section>
      </el-form>

      <template #footer>
        <div class="cycle-create-footer">
          <p data-testid="cycle-create-impact-hint">{{ createNotificationHint }}</p>
          <div>
            <el-button @click="requestCloseCreateDialog">取消</el-button>
            <el-button
              v-if="!isEditMode"
              data-testid="cycle-create-save-draft"
              :loading="submitting"
              @click="handleCreate(false)"
            >保存草稿</el-button>
            <el-button
              data-testid="cycle-create-save-and-view"
              type="primary"
              :loading="submitting"
              @click="handleCreate(true)"
            >
              下一步
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="notificationDialogVisible" title="周期通知设置" width="560px" destroy-on-close>
      <div class="notification-setting-dialog">
        <div class="notification-setting-dialog__status">
          <strong>{{ notificationSettings?.effectiveEnabled ? '钉钉通知总开关已开启' : '钉钉通知总开关已关闭' }}</strong>
          <span>{{ notificationSettings?.effectiveEnabled ? '本周期将按下方策略执行' : '可先保存策略，打开总开关后才会外发' }}</span>
        </div>
        <el-radio-group v-model="notificationModeDraft" class="notification-setting-list">
          <el-radio value="off"><strong>不发送</strong><span>仅保留系统站内通知</span></el-radio>
          <el-radio value="launch_only"><strong>仅发起提醒一次</strong><span>正式发起时通知员工和主管，不做每日催办</span></el-radio>
          <el-radio value="launch_and_reminders"><strong>发起＋每日催办</strong><span>临期或逾期任务每天 09:00 催办，24 小时内不重复</span></el-radio>
        </el-radio-group>
      </div>
      <template #footer>
        <el-button @click="notificationDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="saveNotificationMode">保存</el-button>
      </template>
    </el-dialog>

    <!-- 修改截止日 -->
    <el-dialog v-model="editDialogVisible" title="修改节点截止日" width="560px" destroy-on-close>
      <el-form ref="editFormRef" :model="editForm" label-width="130px">
        <el-alert
          class="deadline-alert"
          title="截止日只能向后延期，并且要保持流程顺序"
          description="例如：指标确认截止不能早于指标制定截止；员工自评截止不能早于指标确认截止。"
          type="info"
          :closable="false"
          show-icon
        />
        <el-form-item v-for="field in DEADLINE_FIELDS" :key="field.key" :label="field.label">
          <el-date-picker
            v-model="editForm[field.key]"
            type="datetime"
            :placeholder="`选择${field.label}`"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleUpdateDeadlines">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.cycle-list-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.cycle-group-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

.cycle-group-tabs button {
  min-width: 76px;
  padding: 7px 14px;
  color: var(--el-text-color-secondary);
  font: inherit;
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}

.cycle-group-tabs button:hover {
  color: var(--el-color-primary);
}

.cycle-group-tabs button.is-active {
  color: var(--el-color-primary);
  font-weight: 600;
  background: #fff;
  box-shadow: 0 1px 3px rgb(15 23 42 / 8%);
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.cycle-empty-state {
  min-height: 220px;
}

.cycle-header-actions,
.dingtalk-notification-status,
.form-label-with-help,
.cycle-auto-plan,
.advanced-group-title strong {
  display: flex;
  align-items: center;
}

.cycle-header-actions {
  gap: 12px;
}

.dingtalk-notification-status {
  gap: 9px;
  padding: 6px 10px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.dingtalk-notification-status.is-enabled {
  color: var(--el-color-success-dark-2);
  background: var(--el-color-success-light-9);
  border-color: var(--el-color-success-light-7);
}

.form-label-with-help,
.advanced-group-title strong {
  gap: 5px;
}

.form-label-with-help {
  flex: none;
  flex-wrap: nowrap;
  white-space: nowrap;
  word-break: keep-all;
}

.form-label-with-help .el-icon,
.advanced-group-title strong .el-icon,
.cycle-auto-plan .el-icon {
  color: var(--el-text-color-placeholder);
  cursor: help;
}

.notification-mode-options {
  display: flex;
  width: 100%;
}

.notification-mode-options :deep(.el-radio-button) {
  flex: 1;
}

.notification-mode-options :deep(.el-radio-button__inner) {
  width: 100%;
  padding-inline: 10px;
}

.cycle-auto-plan {
  align-items: stretch;
  flex-direction: column;
  gap: 9px;
  margin: 2px 0 16px 108px;
  padding: 10px 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  background: var(--el-fill-color-lighter);
  border-radius: 8px;
}

.cycle-auto-plan__heading {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cycle-auto-plan__heading > span {
  color: var(--el-text-color-regular);
  font-weight: 500;
}

.cycle-create-flow {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  margin: 0 8px 20px;
  padding: 0;
  list-style: none;
}

.cycle-create-flow li {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  color: var(--el-text-color-secondary);
}

.cycle-create-flow li:not(:last-child)::after {
  position: absolute;
  top: 15px;
  right: 14px;
  left: 132px;
  height: 1px;
  content: '';
  background: var(--el-border-color-light);
}

.cycle-create-flow li > span {
  display: grid;
  flex: none;
  width: 30px;
  height: 30px;
  place-items: center;
  font-size: 13px;
  background: var(--el-fill-color);
  border-radius: 50%;
}

.cycle-create-flow li > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.cycle-create-flow strong {
  color: var(--el-text-color-primary);
  font-size: 13px;
}

.cycle-create-flow small {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cycle-create-flow li.is-current > span {
  color: #fff;
  background: var(--el-color-primary);
}

.cycle-create-flow li.is-current strong {
  color: var(--el-color-primary);
}

.cycle-create-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 238px;
  align-items: start;
  gap: 20px;
}

.cycle-create-main {
  min-width: 0;
}

.cycle-create-scoring-plan {
  display: grid;
  gap: 14px;
  margin: 0 0 18px 108px;
}

.cycle-semiannual-period {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  width: 100%;
}

.cycle-semiannual-period__separator {
  color: var(--el-text-color-secondary);
}

.cycle-semiannual-warning {
  width: 100%;
  margin-top: 8px;
}

.cycle-plan-summary {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: center;
  gap: 12px;
  margin: 4px 0 16px 104px;
  padding: 12px 88px 12px 14px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.cycle-plan-summary > p {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.45;
}

.cycle-plan-summary > div {
  display: grid;
  gap: 3px;
}

.cycle-plan-summary span,
.advanced-create-toggle small {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.cycle-plan-summary strong {
  color: var(--el-text-color-primary);
  font-size: 13px;
  white-space: nowrap;
}

.cycle-plan-summary > .el-tag {
  position: absolute;
  top: 12px;
  right: 14px;
}

.advanced-create-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: calc(100% - 108px);
  margin: 0 0 8px 108px;
  padding: 11px 14px;
  color: var(--el-color-primary);
  font: inherit;
  text-align: left;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  cursor: pointer;
}

.advanced-create-toggle span {
  font-weight: 600;
}

.advanced-create-toggle:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.advanced-create-fields {
  padding-top: 4px;
}

.advanced-create-groups {
  margin-left: 108px;
  border-top: 0;
}

.cycle-create-summary {
  position: sticky;
  top: 0;
  padding: 16px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.cycle-create-summary h3 {
  margin: 0 0 14px;
  font-size: 15px;
}

.cycle-create-summary dl,
.cycle-create-summary dl > div {
  display: grid;
  gap: 6px;
}

.cycle-create-summary dl {
  gap: 12px;
  margin: 0;
}

.cycle-create-summary dt {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.cycle-create-summary dd {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: 13px;
  line-height: 1.45;
}

.cycle-create-summary__warning,
.cycle-create-summary__notice {
  margin: 14px 0 0;
  padding: 10px;
  font-size: 12px;
  line-height: 1.5;
  border-radius: 7px;
}

.cycle-create-summary__warning {
  color: var(--el-color-warning-dark-2);
  background: var(--el-color-warning-light-9);
}

.cycle-create-summary__notice {
  color: var(--el-color-success-dark-2);
  background: var(--el-color-success-light-9);
}

.advanced-create-groups :deep(.el-collapse-item__header) {
  min-height: 50px;
  height: auto;
  line-height: 1.4;
}

.advanced-create-groups :deep(.el-collapse-item__content) {
  padding: 14px 4px 18px;
}

.advanced-group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  padding-right: 12px;
}

.advanced-group-title strong {
  color: var(--el-text-color-primary);
  font-size: 14px;
}

.advanced-group-title span,
.advanced-group-actions span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.advanced-group-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.advanced-group-actions .el-button {
  flex: none;
}

.schedule-calendar-warning {
  margin-bottom: 14px;
  padding: 10px 12px;
  color: var(--el-color-warning-dark-2);
  font-size: 12px;
  line-height: 1.55;
  background: var(--el-color-warning-light-9);
  border: 1px solid var(--el-color-warning-light-7);
  border-radius: 8px;
}

.schedule-stage {
  display: grid;
  gap: 8px;
  padding: 14px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.schedule-stage__title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 0 2px 4px;
}

.schedule-stage__title strong {
  color: var(--el-text-color-primary);
  font-size: 14px;
}

.schedule-stage__title span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.schedule-node {
  display: grid;
  grid-template-columns: 36px minmax(150px, 1fr) minmax(210px, 250px);
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 10px 12px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.schedule-node__number {
  display: grid;
  width: 32px;
  height: 32px;
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 700;
  place-items: center;
  background: var(--el-color-primary-light-9);
  border-radius: 50%;
}

.schedule-node__copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.schedule-node__copy strong {
  color: var(--el-text-color-primary);
  font-size: 13px;
}

.schedule-node__copy small {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.schedule-node__input {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.schedule-node__warning {
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.4;
}

.schedule-node :deep(.el-date-editor) {
  width: 100%;
}

.schedule-period {
  margin: 12px 0;
  padding: 11px 14px;
  color: var(--el-color-primary-dark-2);
  font-size: 13px;
  font-weight: 600;
  text-align: center;
  background: var(--el-color-primary-light-9);
  border: 1px dashed var(--el-color-primary-light-5);
  border-radius: 8px;
}

.advanced-group-tip {
  margin-bottom: 12px;
}

.cycle-create-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.cycle-create-footer p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.cycle-create-footer > div {
  display: flex;
  gap: 10px;
}

.notification-setting-dialog,
.notification-setting-list,
.notification-setting-list :deep(.el-radio),
.notification-setting-list :deep(.el-radio__label) {
  display: grid;
}

.notification-setting-dialog {
  gap: 16px;
}

.notification-setting-dialog__status {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  background: var(--el-fill-color-lighter);
  border-radius: 8px;
}

.notification-setting-dialog__status span,
.notification-setting-list span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.notification-setting-list {
  gap: 8px;
}

.notification-setting-list :deep(.el-radio) {
  grid-template-columns: auto 1fr;
  align-items: start;
  height: auto;
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.notification-setting-list :deep(.el-radio__label) {
  gap: 4px;
}

:global(.cycle-create-dialog) {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 48px);
  margin-top: 24px !important;
}

:global(.cycle-create-dialog .el-dialog__header),
:global(.cycle-create-dialog .el-dialog__footer) {
  flex: none;
}

:global(.cycle-create-dialog .el-dialog__body) {
  min-height: 0;
  overflow-y: auto;
}

:global(.cycle-create-dialog .el-form-item__label) {
  white-space: nowrap;
  word-break: keep-all;
}

:global(.cycle-create-dialog .el-form) {
  box-sizing: border-box;
  padding-inline: 8px;
}

.form-tip {
  margin: 4px 0 0;
  color: #909399;
  font-size: 12px;
  line-height: 1.5;
}

.checkbox-list {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.deadline-alert {
  margin-bottom: 16px;
}

.preflight-summary {
  margin: 16px 0;
}

.preflight-blockers {
  display: grid;
  gap: 10px;
}

.preflight-blocker {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  border-radius: 6px;
}

.exempt-reason {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
}

:deep(.el-input-number .el-input__inner) {
  text-align: left;
}

@media (max-width: 767px) {
  .cycle-header-actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .dingtalk-notification-status {
    justify-content: space-between;
  }
  .cycle-list-toolbar,
  .filter-row {
    align-items: stretch;
  }

  .cycle-group-tabs {
    width: 100%;
  }

  .cycle-group-tabs button {
    flex: 1;
    min-width: 0;
    padding-inline: 8px;
  }

  .filter-row > :deep(.el-select),
  .filter-row > :deep(.el-input) {
    width: 100% !important;
  }

  :global(.cycle-create-dialog) {
    width: calc(100% - 24px) !important;
    margin-top: 12px !important;
  }

  .cycle-create-flow {
    margin-inline: 0;
  }

  .cycle-create-flow li {
    align-items: flex-start;
    gap: 6px;
  }

  .cycle-create-flow li:not(:last-child)::after {
    display: none;
  }

  .cycle-create-flow li > span {
    width: 24px;
    height: 24px;
  }

  .cycle-create-flow small {
    display: none;
  }

  .cycle-create-layout {
    grid-template-columns: 1fr;
  }

  .cycle-create-summary {
    position: static;
  }

  :global(.cycle-create-dialog .el-col-12) {
    max-width: 100%;
    flex: 0 0 100%;
  }

  :global(.cycle-create-dialog .el-form-item) {
    display: block;
  }

  :global(.cycle-create-dialog .el-form-item__label) {
    width: auto !important;
    justify-content: flex-start;
  }

  :global(.cycle-create-dialog .el-form-item__content) {
    margin-left: 0 !important;
  }

  .cycle-plan-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-left: 0;
    padding-right: 14px;
  }

  .cycle-auto-plan {
    align-items: stretch;
    margin-left: 0;
  }

  .cycle-auto-plan__heading {
    flex-wrap: wrap;
  }

  .advanced-group-actions {
    align-items: flex-start;
  }

  .schedule-stage {
    padding: 10px;
  }

  .schedule-node {
    grid-template-columns: 32px minmax(0, 1fr);
    gap: 8px 10px;
    padding: 10px;
  }

  .schedule-node__number {
    width: 28px;
    height: 28px;
  }

  .schedule-node__input {
    grid-column: 2;
  }

  .cycle-create-scoring-plan {
    margin-left: 0;
  }

  .notification-mode-options {
    align-items: stretch;
    flex-direction: column;
  }

  .notification-mode-options :deep(.el-radio-button__inner) {
    border-left: var(--el-border);
    border-radius: 0;
  }

  .notification-mode-options :deep(.el-radio-button:first-child .el-radio-button__inner) {
    border-radius: var(--el-border-radius-base) var(--el-border-radius-base) 0 0;
  }

  .notification-mode-options :deep(.el-radio-button:last-child .el-radio-button__inner) {
    border-radius: 0 0 var(--el-border-radius-base) var(--el-border-radius-base);
  }

  .cycle-plan-summary > .el-tag {
    position: static;
    justify-self: start;
  }

  .advanced-create-toggle {
    align-items: flex-start;
    width: 100%;
    margin-left: 0;
  }

  .advanced-create-groups {
    margin-left: 0;
  }

  .advanced-group-title {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
    padding-block: 8px;
  }

  .advanced-group-actions,
  .cycle-create-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .cycle-create-footer > div {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .cycle-create-footer > div .el-button {
    width: 100%;
    margin-left: 0;
  }

  .cycle-create-footer > div .el-button:last-child {
    grid-column: 1 / -1;
  }
}
</style>
