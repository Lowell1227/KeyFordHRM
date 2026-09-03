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
import CycleCompactTable from './components/CycleCompactTable.vue';
import CycleWorkspaceShell from './components/CycleWorkspaceShell.vue';
import CycleMonthlyProgressPanel from './components/CycleMonthlyProgressPanel.vue';
import CycleParticipantScopePicker, { type ParticipantScopeMode } from './components/CycleParticipantScopePicker.vue';
import CycleScoringSettings from './components/CycleScoringSettings.vue';
import CycleMonthlyScheduleEditor from './components/CycleMonthlyScheduleEditor.vue';
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
  CycleParticipantRecord,
  Department,
  CycleQuery,
  CycleStatusGroup,
  CycleNotificationMode,
  DingtalkNotificationSettings,
  CyclePeriodSchedule,
  CycleScheduleIssue,
} from '@/types/api.types';
import type { CycleType, ScoringFrequency } from '@/types/enums';

type CycleListGroup = CycleStatusGroup | 'all';

const CYCLE_STATUS_GROUPS: { label: string; value: CycleListGroup }[] = [
  { label: '全部', value: 'all' },
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

const DEADLINE_FIELDS = [
  { key: 'deadlineIndicatorSetting', label: '目标制定截止' },
  { key: 'deadlineIndicatorConfirm', label: '目标确认截止' },
  { key: 'deadlineSelfEval', label: '员工自评截止' },
  { key: 'deadlineManagerScore', label: '主管评分截止' },
  { key: 'deadlineHrCalibration', label: '绩效校准截止' },
  { key: 'deadlineApproval', label: '结果审批截止' },
  { key: 'deadlinePublish', label: '结果公示截止' },
] as const;

type DeadlineKey = (typeof DEADLINE_FIELDS)[number]['key'];

const CREATE_SCHEDULE_NODES = [
  { number: '01', key: 'goalSettingOpenAt', label: '目标制定开放', helper: '周期开始前第 10 个工作日 · 09:00', stage: 'preparation' },
  { number: '02', key: 'deadlineIndicatorSetting', label: '目标制定截止', helper: '周期开始前第 3 个工作日 · 18:00', stage: 'preparation' },
  { number: '03', key: 'deadlineIndicatorConfirm', label: '目标确认截止', helper: '周期开始前第 1 个工作日 · 18:00', stage: 'preparation' },
  { number: '04', key: 'selfEvalOpenAt', label: '员工自评开放', helper: '周期结束后的第 1 个工作日 · 09:00', stage: 'result' },
  { number: '05', key: 'deadlineSelfEval', label: '员工自评截止', helper: '开放日起第 3 个工作日 · 18:00', stage: 'result' },
  { number: '06', key: 'deadlineManagerScore', label: '主管评分截止', helper: '自评截止后第 3 个工作日 · 18:00', stage: 'result' },
  { number: '07', key: 'deadlineHrCalibration', label: '绩效校准截止', helper: '主管评分后第 2 个工作日 · 18:00', stage: 'result' },
  { number: '08', key: 'deadlineApproval', label: '结果审批截止', helper: '绩效校准后第 2 个工作日 · 18:00', stage: 'result' },
  { number: '09', key: 'deadlinePublish', label: '结果公示截止', helper: '结果审批后第 1 个工作日 · 18:00', stage: 'result' },
] as const;

const PREPARATION_SCHEDULE_NODES = CREATE_SCHEDULE_NODES.filter((node) => node.stage === 'preparation');
const RESULT_SCHEDULE_NODES = CREATE_SCHEDULE_NODES.filter((node) => node.stage === 'result');
const WORKFLOW_V2_FINAL_SCHEDULE_NODES = CREATE_SCHEDULE_NODES.slice(6).map((node, index) => ({
  ...node,
  number: `0${index + 4}`,
}));
type CreateScheduleNodeKey = (typeof CREATE_SCHEDULE_NODES)[number]['key'];

const SCHEDULE_NODE_ISSUE_CODES: Partial<Record<CreateScheduleNodeKey, string[]>> = {
  deadlineIndicatorSetting: ['INDICATOR_SETTING_BEFORE_GOAL_OPEN'],
  deadlineIndicatorConfirm: ['INDICATOR_CONFIRM_BEFORE_SETTING_DUE'],
  deadlineHrCalibration: ['HR_CALIBRATION_BEFORE_FINAL_MANAGER_DUE'],
  deadlineApproval: ['APPROVAL_BEFORE_HR_CALIBRATION'],
  deadlinePublish: ['PUBLISH_BEFORE_APPROVAL'],
};

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
const canReviewCyclePlan = computed(() => auth.user?.sysRole === 'hr');
const canRemindCycleReview = computed(() => (
  auth.user?.sysRole === 'hr_user'
  && auth.user.hrCapabilities?.includes('cycle_plan_edit')
));
const canManageGlobalNotificationSettings = computed(() => (
  auth.user?.sysRole === 'system_admin'
  || auth.user?.sysRole === 'hr'
));

const initialType = CYCLE_TYPE_OPTIONS.some((item) => item.value === route.query.type)
  ? route.query.type as CycleType
  : '';
const initialGroup = CYCLE_STATUS_GROUPS.some((item) => item.value === route.query.group)
  ? route.query.group as CycleListGroup
  : 'all';

const statusGroup = ref<CycleListGroup>(initialGroup);
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
const editingPlanVersion = ref<number | null>(null);
const editingReviewStatus = ref<AssessmentCycle['reviewStatus']>();
const editingCycleOriginal = ref<AssessmentCycle | null>(null);
type SchedulePreviewMode = 'defaults' | 'validate';
let schedulePreviewTimer: ReturnType<typeof setTimeout> | undefined;
let schedulePreviewRequest = 0;
let activeSchedulePreview: Promise<boolean> | null = null;
let pendingSchedulePreviewMode: SchedulePreviewMode = 'defaults';
let pendingSchedulePreserveAdjusted = false;
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
const preflight = ref<LaunchPreflightResult | null>(null);
const participantRecordLoading = ref(false);
const participantRecordError = ref('');
const participantRecord = ref<CycleParticipantRecord | null>(null);
const launchActionMode = ref<'launch' | 'schedule' | null>(null);
const reviewActionMode = ref<'review' | 'remind' | null>(null);
const detailLoading = ref(false);
const detailError = ref('');
const cycleDetail = ref<AssessmentCycle | null>(null);
const isCycleWorkspace = computed(() => typeof route.query.cycleId === 'string' && route.query.cycleId.length > 0);
const hasListFilters = computed(() => Boolean(typeFilter.value || keyword.value.trim()));
const emptyStateDescription = computed(() => {
  if (hasListFilters.value) return '没有符合筛选条件的周期';
  if (statusGroup.value === 'active') return '暂无进行中的周期';
  if (statusGroup.value === 'finished') return '暂无已结束周期';
  if (statusGroup.value === 'all') return '暂无考核周期';
  return '暂无待发起周期';
});
const gradeRatioSummary = computed(() => (
  `A ${createForm.gradeAMaxRatio}% · B ${createForm.gradeBMaxRatio}% · C ${createForm.gradeCMaxRatio}% · D ${createForm.gradeDMaxRatio}%`
));
const visibleFieldCount = computed(() => Object.values(createForm.publishVisibleFields).filter(Boolean).length);
const cyclePeriodWarning = computed(() => {
  if (!createForm.startDate || !createForm.endDate) return '';
  const start = dayjs(createForm.startDate).startOf('month');
  const end = dayjs(createForm.endDate).startOf('month');
  if (!start.isValid() || !end.isValid() || end.isBefore(start)) return '';
  const expectedMonths = ({ monthly: 1, quarterly: 3, semiannual: 6, annual: 12 } as Partial<Record<CycleType, number>>)[createForm.type];
  if (!expectedMonths) return '';
  const coveredMonths = end.diff(start, 'month') + 1;
  if (coveredMonths === expectedMonths) return '';
  const typeLabel = ({ monthly: '月度', quarterly: '季度', semiannual: '半年', annual: '年度' } as Partial<Record<CycleType, string>>)[createForm.type];
  return `当前期间覆盖${coveredMonths}个月，与${typeLabel}常规${expectedMonths}个月不同，仍可保存。`;
});
const createTimePlanCustomized = computed(() => (
  createScheduleCustomized.value
  || (isWorkflowV2Form.value && (
    scoringPlan.scoringFrequency !== defaultScoringFrequency(createForm.type)
    || scoringPlan.periodSchedules.some((schedule) => schedule.isException)
  ))
));
const createSchedulePlanLabel = computed(() => (createTimePlanCustomized.value ? '已调整计划' : '系统默认计划'));
const createNotificationHint = computed(() => {
  if (createForm.notificationMode === 'off') return '';
  if (!notificationSettings.value?.effectiveEnabled) return '钉钉通知总开关已关闭，本周期暂不外发';
  return '';
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

function normalizeScheduleInstant(value: string): string {
  const instant = dayjs(value);
  return instant.isValid() ? instant.toISOString() : value;
}

function semanticPeriodSchedules(schedules: CyclePeriodSchedule[]): Omit<CyclePeriodSchedule, 'id'>[] {
  return schedules.map((schedule) => ({
    periodKey: schedule.periodKey,
    periodType: schedule.periodType,
    sequence: schedule.sequence,
    periodStart: schedule.periodStart,
    periodEnd: schedule.periodEnd,
    selfEvalOpenAt: normalizeScheduleInstant(schedule.selfEvalOpenAt),
    selfEvalDueAt: normalizeScheduleInstant(schedule.selfEvalDueAt),
    managerDueAt: normalizeScheduleInstant(schedule.managerDueAt),
    isException: Boolean(schedule.isException),
  }));
}

const scoringPlanSnapshot = () => JSON.stringify({
  scoringFrequency: scoringPlan.scoringFrequency,
  periodSchedules: semanticPeriodSchedules(scoringPlan.periodSchedules),
});
const reviewResetRequired = computed(() => (
  isEditMode.value
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

function invalidateSchedulePreview() {
  schedulePreviewRequest += 1;
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

function resetCreateForm() {
  if (schedulePreviewTimer) clearTimeout(schedulePreviewTimer);
  invalidateSchedulePreview();
  activeSchedulePreview = null;
  pendingSchedulePreviewMode = 'defaults';
  pendingSchedulePreserveAdjusted = false;
  editingCycleId.value = null;
  editingWorkflowVersion.value = 2;
  editingPlanVersion.value = null;
  editingReviewStatus.value = undefined;
  editingCycleOriginal.value = null;
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
  scoringPlan.scoringFrequency = 'cycle';
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
  scoringPlan.scoringFrequency = defaultScoringFrequency(type);
  applyCycleTypePreset(type);
  void refreshScoringPlan();
}

function handleCreateNameInput() {
  createNameCustomized.value = true;
}

function handleCreatePeriodRangeChange(value: [Date, Date] | null) {
  const previousStartDate = createForm.startDate;
  const previousEndDate = createForm.endDate;
  createForm.startDate = value?.[0];
  createForm.endDate = value?.[1];
  syncGeneratedName();
  handleCreatePeriodChange(previousStartDate, previousEndDate);
  scheduleScoringPreview('defaults', true);
}

function handleSemiannualStartDateChange(value: Date | null) {
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
  handleCreatePeriodChange(previousStartDate, previousEndDate);
  scheduleScoringPreview('defaults', true);
  ElMessage.info('已按开始日期自动补齐连续六个自然月');
}

function handleSemiannualEndDateChange(value: Date | null) {
  const previousStartDate = createPeriodRange.value?.[0];
  const previousEndDate = createPeriodRange.value?.[1];
  createForm.endDate = value ? dayjs(value).startOf('day').toDate() : undefined;
  createPeriodRange.value = createForm.startDate && createForm.endDate
    ? [createForm.startDate, createForm.endDate]
    : null;
  syncGeneratedName();
  handleCreatePeriodChange(previousStartDate, previousEndDate);
  scheduleScoringPreview('defaults', true);
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

function isCreateScheduleNodeAdjusted(key: CreateScheduleNodeKey): boolean {
  if (!createForm.startDate || !createForm.endDate || !createForm[key]) return false;
  const defaultSchedule = buildDefaultCycleSchedule(createForm.startDate, createForm.endDate);
  return !dayjs(createForm[key]).isSame(dayjs(defaultSchedule[key]));
}

async function handleRestoreDefaultTimePlan() {
  applyDefaultCreateSchedule();
  if (!isWorkflowV2Form.value) return;
  scoringPlan.scoringFrequency = defaultScoringFrequency(createForm.type);
  await refreshScoringPlan();
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
  editingPlanVersion.value = cycle.planVersion;
  editingReviewStatus.value = cycle.reviewStatus;
  editingCycleOriginal.value = cycle;
  createForm.name = cycle.name;
  createForm.type = cycle.type;
  createForm.startDate = toDate(cycle.startDate);
  createForm.endDate = toDate(cycle.endDate);
  createPeriodRange.value = createForm.startDate && createForm.endDate ? [createForm.startDate, createForm.endDate] : null;
  createForm.goalSettingOpenAt = toDate(cycle.goalSettingOpenAt);
  createForm.selfEvalOpenAt = toDate(cycle.selfEvalOpenAt);
  createForm.hrOwnerId = cycle.hrOwnerId;
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
  advancedCreateSections.value = ['grades', 'publication'];
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

function timeWarningConfirmation(result: LaunchPreflightResult, action: '发起' | '预约'): string {
  if (!result.warnings.length) return '';
  return `\n\n有 ${result.warnings.length} 项时间安排提醒，已在页面列出；确认后仍可继续${action}。`;
}

function handleCreateScheduleChange() {
  createScheduleCustomized.value = true;
  if (isWorkflowV2Form.value) scheduleScoringPreview('validate');
}

function handleCreatePeriodChange(previousStartDate?: Date, previousEndDate?: Date) {
  if (!createForm.startDate || !createForm.endDate) return;
  if (!previousStartDate || !previousEndDate) {
    applyDefaultCreateSchedule();
    return;
  }

  const previousDefaults = buildDefaultCycleSchedule(previousStartDate, previousEndDate);
  const nextDefaults = buildDefaultCycleSchedule(createForm.startDate, createForm.endDate);
  CREATE_SCHEDULE_NODES.forEach(({ key }) => {
    const current = createForm[key];
    if (current && dayjs(current).isSame(dayjs(previousDefaults[key]))) {
      createForm[key] = nextDefaults[key];
    }
  });
  createScheduleProvisionalYears.value = nextDefaults.provisionalYears;
  createScheduleCustomized.value = CREATE_SCHEDULE_NODES.some(({ key }) => (
    !createForm[key] || !dayjs(createForm[key]).isSame(dayjs(nextDefaults[key]))
  ));
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
  if (createForm.startDate && createForm.endDate && dayjs(createForm.endDate).isBefore(createForm.startDate)) {
    return `结束日期不能早于开始日期（${formatDate(createForm.startDate)}）。`;
  }
  return null;
}

function schedulePreviewTimeline() {
  return {
    goalSettingOpenAt: formatDateTimeLocal(createForm.goalSettingOpenAt),
    deadlineIndicatorSetting: formatDateTimeLocal(createForm.deadlineIndicatorSetting),
    deadlineIndicatorConfirm: formatDateTimeLocal(createForm.deadlineIndicatorConfirm),
    deadlineHrCalibration: formatDateTimeLocal(createForm.deadlineHrCalibration),
    deadlineApproval: formatDateTimeLocal(createForm.deadlineApproval),
    deadlinePublish: formatDateTimeLocal(createForm.deadlinePublish),
  };
}

function clonePeriodSchedules(schedules: CyclePeriodSchedule[]): CyclePeriodSchedule[] {
  return schedules.map((schedule) => ({ ...schedule }));
}

function hasIncompleteScoringSchedule(): boolean {
  return scoringPlan.periodSchedules.some((schedule) => (
    !schedule.selfEvalOpenAt || !schedule.selfEvalDueAt || !schedule.managerDueAt
  ));
}

function requiredScoringFrequency(type: CycleType): ScoringFrequency | null {
  if (type === 'monthly') return 'monthly';
  if (type === 'custom' || type === 'probation') return 'cycle';
  return null;
}

function defaultScoringFrequency(type: CycleType): ScoringFrequency {
  return requiredScoringFrequency(type) ?? 'cycle';
}

async function refreshScoringPlan(options: { preserveAdjusted?: boolean } = {}): Promise<boolean> {
  if (!isWorkflowV2Form.value || !createForm.startDate || !createForm.endDate) return false;
  const requestId = ++schedulePreviewRequest;
  const contextFingerprint = scoringPreviewFingerprint(false);
  const promise = (async () => {
    try {
      const preview = await cyclesApi.previewSchedule({
        type: createForm.type,
        scoringFrequency: scoringPlan.scoringFrequency,
        startDate: formatDateLocal(createForm.startDate)!,
        endDate: formatDateLocal(createForm.endDate)!,
        ...schedulePreviewTimeline(),
      });
      if (requestId !== schedulePreviewRequest || contextFingerprint !== scoringPreviewFingerprint(false)) return false;

      const currentSchedules = new Map(
        scoringPlan.periodSchedules.map((schedule) => [schedule.periodKey, { ...schedule }]),
      );
      let preservedAdjustedSchedule = false;
      scoringPlan.periodSchedules = preview.schedules.map((schedule) => {
        const current = currentSchedules.get(schedule.periodKey);
        if (options.preserveAdjusted && current?.isException) {
          preservedAdjustedSchedule = true;
          return {
            ...schedule,
            selfEvalOpenAt: current.selfEvalOpenAt,
            selfEvalDueAt: current.selfEvalDueAt,
            managerDueAt: current.managerDueAt,
            isException: true,
          };
        }
        return { ...schedule };
      });
      scoringPlan.scoringFrequency = preview.scoringFrequency;
      scoringPlan.scheduleBlockers = [...preview.blockers];
      scoringPlan.scheduleWarnings = [...preview.warnings];
      if (preservedAdjustedSchedule) return validateCurrentScoringPlan();
      return true;
    } catch {
      return false;
    }
  })();
  return trackSchedulePreview(promise);
}

function scoringPreviewFingerprint(includeSchedules: boolean): string {
  return JSON.stringify({
    type: createForm.type,
    scoringFrequency: scoringPlan.scoringFrequency,
    startDate: formatDateLocal(createForm.startDate),
    endDate: formatDateLocal(createForm.endDate),
    ...schedulePreviewTimeline(),
    ...(includeSchedules && { schedules: scoringPlan.periodSchedules }),
  });
}

function scheduleNodeIssues(key: CreateScheduleNodeKey): CycleScheduleIssue[] {
  const codes = SCHEDULE_NODE_ISSUE_CODES[key] ?? [];
  return [...scoringPlan.scheduleBlockers, ...scoringPlan.scheduleWarnings]
    .filter((issue) => !issue.periodKey && codes.includes(issue.code));
}

function firstMissingCreateScheduleNode(): CreateScheduleNodeKey | undefined {
  const nodes = isWorkflowV2Form.value
    ? [...PREPARATION_SCHEDULE_NODES, ...WORKFLOW_V2_FINAL_SCHEDULE_NODES]
    : CREATE_SCHEDULE_NODES;
  return nodes.find((node) => !createForm[node.key])?.key;
}

async function focusFirstMissingCreateScheduleNode() {
  const key = firstMissingCreateScheduleNode();
  if (!key) return;
  await nextTick();
  const input = document.querySelector<HTMLInputElement>(
    `.cycle-create-dialog [data-schedule-node-key="${key}"] input`,
  );
  input?.scrollIntoView({ block: 'center' });
  input?.focus();
}

function trackSchedulePreview(promise: Promise<boolean>): Promise<boolean> {
  activeSchedulePreview = promise;
  void promise.then(() => {
    if (activeSchedulePreview === promise) activeSchedulePreview = null;
  });
  return promise;
}

async function validateCurrentScoringPlan(): Promise<boolean> {
  if (!isWorkflowV2Form.value || !createForm.startDate || !createForm.endDate) return false;
  if (scoringPlan.periodSchedules.length === 0) return false;
  if (hasIncompleteScoringSchedule()) return false;
  const requestId = ++schedulePreviewRequest;
  const contextFingerprint = scoringPreviewFingerprint(true);
  const schedules = clonePeriodSchedules(scoringPlan.periodSchedules);
  const promise = (async () => {
    try {
      const preview = await cyclesApi.previewSchedule({
        type: createForm.type,
        scoringFrequency: scoringPlan.scoringFrequency,
        startDate: formatDateLocal(createForm.startDate)!,
        endDate: formatDateLocal(createForm.endDate)!,
        ...schedulePreviewTimeline(),
        schedules,
      });
      if (requestId !== schedulePreviewRequest || contextFingerprint !== scoringPreviewFingerprint(true)) return false;
      scoringPlan.scoringFrequency = preview.scoringFrequency;
      scoringPlan.periodSchedules = clonePeriodSchedules(preview.schedules);
      scoringPlan.scheduleBlockers = preview.blockers.map((issue) => ({ ...issue }));
      scoringPlan.scheduleWarnings = preview.warnings.map((issue) => ({ ...issue }));
      return true;
    } catch {
      return false;
    }
  })();
  return trackSchedulePreview(promise);
}

function scheduleScoringPreview(mode: SchedulePreviewMode = 'defaults', preserveAdjusted = false) {
  if (!isWorkflowV2Form.value) return;
  if (schedulePreviewTimer) clearTimeout(schedulePreviewTimer);
  invalidateSchedulePreview();
  pendingSchedulePreviewMode = mode;
  pendingSchedulePreserveAdjusted = preserveAdjusted;
  schedulePreviewTimer = setTimeout(() => {
    schedulePreviewTimer = undefined;
    pendingSchedulePreviewMode = 'defaults';
    pendingSchedulePreserveAdjusted = false;
    void (mode === 'validate'
      ? validateCurrentScoringPlan()
      : refreshScoringPlan({ preserveAdjusted }));
  }, 300);
}

async function handleScoringFrequencyChange(frequency: ScoringFrequency) {
  scoringPlan.scoringFrequency = frequency;
  await refreshScoringPlan();
}

function handleScoringSchedulesUpdate(schedules: CyclePeriodSchedule[]) {
  scoringPlan.periodSchedules = clonePeriodSchedules(schedules);
  scoringPlan.scheduleBlockers = [];
  scoringPlan.scheduleWarnings = [];
  if (schedulePreviewTimer) clearTimeout(schedulePreviewTimer);
  schedulePreviewTimer = undefined;
  invalidateSchedulePreview();
  if (hasIncompleteScoringSchedule()) return;
  scheduleScoringPreview('validate');
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

async function focusFirstMissingScheduleField() {
  const index = scoringPlan.periodSchedules.findIndex((schedule) => (
    !schedule.selfEvalOpenAt || !schedule.selfEvalDueAt || !schedule.managerDueAt
  ));
  if (index < 0) return;
  const schedule = scoringPlan.periodSchedules[index];
  const fieldTestId = !schedule.selfEvalOpenAt
    ? 'self-eval-open-at'
    : !schedule.selfEvalDueAt
      ? 'self-eval-due-at'
      : 'manager-due-at';
  await nextTick();
  const rows = document.querySelectorAll<HTMLElement>('[data-testid="cycle-month-schedule-row"]');
  rows[index]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  rows[index]?.querySelector<HTMLElement>(`[data-testid="${fieldTestId}"] input`)?.focus();
}

function buildCreateBody(): CreateCycleBody {
  const body: CreateCycleBody = {
    name: createForm.name,
    type: createForm.type,
    startDate: formatDateLocal(createForm.startDate)!,
    endDate: formatDateLocal(createForm.endDate)!,
    goalSettingOpenAt: formatDateTimeLocal(createForm.goalSettingOpenAt),
    selfEvalOpenAt: formatDateTimeLocal(createForm.selfEvalOpenAt),
    hrOwnerId: createForm.hrOwnerId,
    monthlyFollowUpRequired: isWorkflowV2Form.value
      ? scoringPlan.scoringFrequency === 'monthly'
      : ['quarterly', 'semiannual', 'annual'].includes(createForm.type)
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
    body.periodSchedules = semanticPeriodSchedules(scoringPlan.periodSchedules);
  }

  return body;
}

async function handleCreate(openWorkspace = false) {
  if (!createFormRef.value) return;
  if (isEditMode.value && createFormSnapshot() === createInitialSnapshot.value) {
    const unchangedCycle = editingCycleOriginal.value;
    createDialogVisible.value = false;
    resetCreateForm();
    ElMessage.info('周期配置未修改，已保留当前审核状态');
    if (openWorkspace && unchangedCycle) await openCycleWorkspace(unchangedCycle);
    return;
  }
  try {
    await createFormRef.value.validate();
  } catch {
    return;
  }

  const validationMessage = getCreateDeadlineValidationMessage();
  if (validationMessage) {
    return;
  }

  if (firstMissingCreateScheduleNode()) {
    await focusFirstMissingCreateScheduleNode();
    return;
  }

  if (isWorkflowV2Form.value) {
    if (hasIncompleteScoringSchedule()) {
      await focusFirstMissingScheduleField();
      return;
    }
    if (activeSchedulePreview) {
      const completed = await activeSchedulePreview;
      if (!completed && !schedulePreviewTimer) return;
    }
    if (schedulePreviewTimer) {
      clearTimeout(schedulePreviewTimer);
      schedulePreviewTimer = undefined;
      const mode = pendingSchedulePreviewMode;
      const preserveAdjusted = pendingSchedulePreserveAdjusted;
      pendingSchedulePreviewMode = 'defaults';
      pendingSchedulePreserveAdjusted = false;
      const refreshed = mode === 'validate'
        ? await validateCurrentScoringPlan()
        : await refreshScoringPlan({ preserveAdjusted });
      if (!refreshed) return;
    }
    if (scoringPlan.periodSchedules.length === 0) {
      ElMessage.warning('评分计划尚未生成，请确认周期类型和考核期间');
      return;
    }
    if (!await validateCurrentScoringPlan()) return;
  }

  if (isWorkflowV2Form.value && scoringPlan.scheduleBlockers.length > 0) {
    await focusFirstInvalidScheduleRow();
    return;
  }
  if (reviewResetRequired.value) {
    try {
      await ElMessageBox.confirm(
        '本次修改会使已审核的考核周期重新进入待审核状态，由 HR 管理员审核。确认提交吗？',
        '重新提交周期审核？',
        {
          confirmButtonText: '确认提交',
          cancelButtonText: '返回修改',
          type: 'warning',
          closeOnClickModal: false,
        },
      );
    } catch {
      return;
    }
  }
  submitting.value = true;
  try {
    if (isEditMode.value && editingCycleId.value) {
      if (!editingPlanVersion.value) {
        ElMessage.error('周期版本信息缺失，请刷新后重试');
        return;
      }
      const updated = await cyclesApi.update(editingCycleId.value, {
        ...buildCreateBody(),
        expectedPlanVersion: editingPlanVersion.value,
      });
      ElMessage.success(reviewResetRequired.value ? '考核周期已提交审核' : '考核周期已保存');
      createDialogVisible.value = false;
      resetCreateForm();
      if (cycleDetail.value?.id === updated.id) cycleDetail.value = updated;
      await loadCycles();
      if (openWorkspace) {
        await openCycleWorkspace(updated);
      }
    } else {
      const created = await cyclesApi.create(buildCreateBody());
      ElMessage.success(openWorkspace ? '考核周期已提交审核' : '考核周期草稿已保存');
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
  const body: UpdateDeadlinesBody = {
    expectedPlanVersion: editingCycle.value?.planVersion ?? 0,
  };
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
    const updated = await cyclesApi.updateDeadlines(editingCycle.value.id, buildDeadlinesBody());
    const index = cycles.value.findIndex((cycle) => cycle.id === updated.id);
    if (index >= 0) cycles.value[index] = updated;
    if (cycleDetail.value?.id === updated.id) cycleDetail.value = updated;
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
  if (launchActionMode.value) return;
  launchActionMode.value = 'launch';
  try {
    const result = await handlePreflight(cycle);
    if (!result?.ready || !result.planHash) return;

    const opensInFuture = Boolean(
      result.cycle.goalSettingOpenAt
      && dayjs(result.cycle.goalSettingOpenAt).isAfter(dayjs()),
    );
    if (opensInFuture && auth.user?.sysRole !== 'system_admin') {
      ElMessage.warning('尚未到目标制定开放时间，请使用预约发起');
      return;
    }

    let overrideReason: string | undefined;
    if (
      auth.user?.sysRole === 'system_admin'
      && opensInFuture
    ) {
      try {
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
      } catch {
        return;
      }
    }

    try {
      await ElMessageBox.confirm(
        `发起后将为 ${result.participantCount} 名参与员工创建空白目标任务，该操作不可撤销。${timeWarningConfirmation(result, '发起')}\n\n确认发起「${cycle.name}」？`,
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
        expectedPlanHash: result.planHash,
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
  } finally {
    launchActionMode.value = null;
  }
}

async function handlePreflight(cycle: AssessmentCycle): Promise<LaunchPreflightResult | null> {
  preflight.value = null;
  preflightError.value = '';
  preflightLoading.value = true;
  try {
    const result = await cyclesApi.preflight(cycle.id);
    preflight.value = result;
    return result;
  } catch (error) {
    preflightError.value = error instanceof Error ? error.message : '发起检查失败，请重试';
    return null;
  } finally {
    preflightLoading.value = false;
  }
}

async function handleSchedule(cycle: AssessmentCycle) {
  if (launchActionMode.value) return;
  launchActionMode.value = 'schedule';
  try {
    const result = await handlePreflight(cycle);
    if (!result?.ready || !result.planHash) return;
    const openAt = formatDateTimeForMessage(result.cycle.goalSettingOpenAt);
    try {
      await ElMessageBox.confirm(
        `系统将在目标制定开放时间 ${openAt} 自动为 ${result.participantCount} 名参与员工发起周期。${timeWarningConfirmation(result, '预约')}\n\n确认预约吗？`,
        '确认预约发起',
        {
          confirmButtonText: '确认预约',
          cancelButtonText: '取消',
          type: 'warning',
        },
      );
    } catch {
      return;
    }

    launchingId.value = cycle.id;
    try {
      await cyclesApi.schedule(cycle.id, result.planHash);
      ElMessage.success(`已预约发起，将于 ${openAt} 自动发起周期`);
      preflight.value = null;
      await loadCycles();
      await loadCycleDetail(cycle.id);
    } finally {
      launchingId.value = null;
    }
  } finally {
    launchActionMode.value = null;
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
    const detail = await cyclesApi.findOne(cycleId);
    cycleDetail.value = detail;
    participantRecord.value = null;
    participantRecordError.value = '';
    if (detail.openedAt) {
      participantRecordLoading.value = true;
      try {
        participantRecord.value = await cyclesApi.participantRecord(cycleId);
      } catch (error) {
        participantRecordError.value = error instanceof Error ? error.message : '获取发起记录失败';
      } finally {
        participantRecordLoading.value = false;
      }
    } else if (['draft', 'scheduled', 'launch_blocked'].includes(detail.status)) {
      await handlePreflight(detail);
    }
  } catch (error) {
    detailError.value = error instanceof Error ? error.message : '获取周期详情失败';
  } finally {
    detailLoading.value = false;
  }
}

async function openCycleWorkspace(cycle: AssessmentCycle) {
  cycleDetail.value = cycle;
  preflight.value = null;
  preflightError.value = '';
  participantRecord.value = null;
  participantRecordError.value = '';
  if (route.query.cycleId !== cycle.id) {
    await router.push({ query: { ...route.query, cycleId: cycle.id } });
  }
  await loadCycleDetail(cycle.id);
}

async function closeCycleWorkspace() {
  const query = { ...route.query };
  delete query.cycleId;
  preflight.value = null;
  preflightError.value = '';
  cycleDetail.value = null;
  participantRecord.value = null;
  participantRecordError.value = '';
  await router.replace({ query });
}

function handleView(cycle: AssessmentCycle) {
  void openCycleWorkspace(cycle);
}

function retryCycleDetail() {
  if (typeof route.query.cycleId === 'string') void loadCycleDetail(route.query.cycleId);
}

function handleWorkspaceLaunch() {
  if (cycleDetail.value) void handleLaunch(cycleDetail.value);
}

function handleWorkspaceSchedule() {
  if (cycleDetail.value) void handleSchedule(cycleDetail.value);
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
    void openCycleWorkspace(cycle);
    return;
  }
  void openCycleWorkspace(cycle);
}

function buildQuery(): CycleQuery {
  const query: CycleQuery & Record<string, unknown> = {};
  if (statusGroup.value !== 'all') query.group = statusGroup.value;
  if (typeFilter.value) query.type = typeFilter.value;
  if (keyword.value.trim()) query.keyword = keyword.value.trim();
  return withParams(query);
}

async function syncListRoute() {
  const query = { ...route.query };
  if (statusGroup.value === 'all') delete query.group;
  else query.group = statusGroup.value;
  delete query.status;
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
  statusGroup.value = 'all';
  typeFilter.value = '';
  keyword.value = '';
  page.value = 1;
  await syncListRoute();
  await loadCycles();
}

async function selectStatusGroup(group: CycleListGroup) {
  if (statusGroup.value === group) return;
  statusGroup.value = group;
  page.value = 1;
  await syncListRoute();
  await loadCycles();
}

async function handleReviewCycle(cycle: AssessmentCycle) {
  if (reviewActionMode.value) return;
  reviewActionMode.value = 'review';
  const scoringSummary = cycle.workflowVersion === 2
    ? cycle.scoringFrequency === 'monthly'
      ? `月度自评，共 ${cycle.periodSchedules?.length ?? 0} 期`
      : '周期结束统一评分，共 1 期'
    : '历史流程';
  const reviewSummary = cycle.workflowVersion === 2
    ? `已调整月份 ${cycle.periodSchedules?.filter((schedule) => schedule.isException).length ?? 0} 个；结果审批人 ${cycle.companyFinalApprover?.name || '未配置'}；`
    : '';
  try {
    await ElMessageBox.confirm(
      `确认审核通过「${cycle.name}」？${scoringSummary}。${reviewSummary}通过后创建人可发起考核。`,
      '审核考核周期',
      { confirmButtonText: '审核通过', cancelButtonText: '取消', type: 'warning' },
    );
    const updated = await cyclesApi.review(cycle.id, 'approve', cycle.planVersion);
    const index = cycles.value.findIndex((item) => item.id === updated.id);
    if (index >= 0) cycles.value[index] = updated;
    if (cycleDetail.value?.id === updated.id) cycleDetail.value = updated;
    ElMessage.success('考核周期已审核通过');
    await loadCycles();
    if (isCycleWorkspace.value) await loadCycleDetail(cycle.id);
  } catch {
    // 用户取消或接口错误由拦截器展示。
  } finally {
    reviewActionMode.value = null;
  }
}

async function handleRemindCycleReview() {
  const cycle = cycleDetail.value;
  if (!cycle || reviewActionMode.value) return;
  reviewActionMode.value = 'remind';
  try {
    const result = await cyclesApi.remindReview(cycle.id);
    ElMessage.success(`已站内提醒 ${result.recipientCount} 名 HR 管理员`);
    if (preflight.value) {
      preflight.value = {
        ...preflight.value,
        reviewReminderAvailableAt: result.reminderAvailableAt,
      };
    }
    await loadCycleDetail(cycle.id);
  } catch {
    // 写请求失败已由 HTTP 拦截器展示业务文案。
  } finally {
    reviewActionMode.value = null;
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
      :participant-record="participantRecord"
      :participant-record-loading="participantRecordLoading"
      :participant-record-error="participantRecordError"
      :launch-action="launchActionMode"
      :review-action="reviewActionMode"
      :can-edit="canEditCyclePlan"
      :can-review="canReviewCyclePlan"
      :can-remind-review="canRemindCycleReview"
      @back="closeCycleWorkspace"
      @retry="retryCycleDetail"
      @launch="handleWorkspaceLaunch"
      @schedule="handleWorkspaceSchedule"
      @edit="handleWorkspaceEditCycle"
      @review="cycleDetail && handleReviewCycle(cycleDetail)"
      @remind-review="handleRemindCycleReview"
      @resolve-blocker="handleResolvePreflightBlocker"
    >
      <template #monthly-progress>
        <CycleMonthlyProgressPanel
          v-if="cycleDetail?.openedAt && cycleDetail.workflowVersion === 2 && cycleDetail.scoringFrequency === 'monthly'"
          :cycle-id="cycleDetail.id"
          :period-keys="cycleDetail.periodSchedules?.map((schedule) => schedule.periodKey) ?? []"
          :can-edit="canEditCyclePlan"
        />
      </template>
    </CycleWorkspaceShell>

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
              :disabled="!canManageGlobalNotificationSettings || !notificationSettings?.available"
              :title="canManageGlobalNotificationSettings ? '' : '仅 HR 管理员可修改总开关'"
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
        :can-edit="canEditCyclePlan"
        :can-review="canReviewCyclePlan"
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
            新建考核周期
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
      :title="isEditMode ? '编辑考核周期' : '新建考核周期'"
      width="900px"
      destroy-on-close
      :before-close="handleCreateBeforeClose"
    >
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="108px">
        <section class="cycle-create-main" aria-label="周期关键设置">
        <el-row :gutter="16" class="cycle-basic-fields">
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

        <el-form-item prop="startDate" class="cycle-period-field">
          <template #label>
            <span class="form-label-with-help">考核期间
              <el-tooltip content="修改期间时联动系统默认时间，已调整时间会保留；常规时长仅提醒" placement="top">
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
            v-if="cyclePeriodWarning"
            class="cycle-period-warning"
            data-testid="cycle-period-warning"
            type="warning"
            :closable="false"
            show-icon
            :title="cyclePeriodWarning"
          />
        </el-form-item>

        <section class="cycle-time-plan" data-testid="cycle-time-plan" aria-labelledby="cycle-time-plan-title">
          <div class="cycle-time-plan__heading">
            <div>
              <strong id="cycle-time-plan-title">时间节点
                <el-tooltip content="系统会生成建议时间；缺失时间会阻断，顺序异常仅提醒，相同时间允许保存" placement="top">
                  <el-icon><QuestionFilled /></el-icon>
                </el-tooltip>
              </strong>
              <span data-testid="cycle-plan-summary" :class="{ 'is-adjusted': createTimePlanCustomized }">{{ createSchedulePlanLabel }}</span>
            </div>
            <el-button data-testid="cycle-restore-default-plan" text type="primary" @click="handleRestoreDefaultTimePlan">
              恢复默认计划
            </el-button>
          </div>

          <section class="schedule-stage" data-testid="cycle-schedule-stage" aria-labelledby="schedule-stage-preparation">
            <div class="schedule-stage__title">
              <span class="schedule-stage__phase-number">1</span>
              <strong id="schedule-stage-preparation">目标准备</strong>
              <el-tooltip content="考核开始前完成目标设定" placement="top">
                <el-icon class="schedule-stage__help"><QuestionFilled /></el-icon>
              </el-tooltip>
            </div>
            <div
              v-for="node in PREPARATION_SCHEDULE_NODES"
              :key="node.key"
              class="schedule-node"
              :class="{ 'is-missing': !createForm[node.key] }"
              :data-schedule-node-key="node.key"
              data-testid="cycle-schedule-node"
            >
              <div class="schedule-node__copy">
                <strong><span v-if="isCreateScheduleNodeAdjusted(node.key)" class="cycle-adjusted-dot" aria-label="时间已调整" />{{ node.label }}</strong>
                <small>{{ node.helper }}</small>
              </div>
              <div class="schedule-node__input">
                <el-date-picker
                  v-model="createForm[node.key]"
                  type="datetime"
                  :placeholder="`选择${node.label}`"
                  @change="handleCreateScheduleChange"
                />
                <small v-if="!createForm[node.key]" class="schedule-node__required">必填</small>
                <small
                  v-for="issue in scheduleNodeIssues(node.key)"
                  :key="issue.code"
                  class="schedule-node__issue"
                >{{ issue.message }}</small>
              </div>
            </div>
          </section>

          <section
            v-if="isWorkflowV2Form"
            class="schedule-stage schedule-stage--tracking"
            data-testid="cycle-schedule-stage"
            aria-labelledby="schedule-stage-tracking"
          >
            <div class="schedule-stage__title schedule-stage__title--tracking">
              <span class="schedule-stage__phase-number">2</span>
              <strong id="schedule-stage-tracking">目标跟进</strong>
              <el-tooltip content="每月或者每个周期进行一次自评与评分" placement="top">
                <el-icon class="schedule-stage__help"><QuestionFilled /></el-icon>
              </el-tooltip>
              <CycleScoringSettings
                :cycle-type="createForm.type"
                :scoring-frequency="scoringPlan.scoringFrequency"
                @update:scoring-frequency="scoringPlan.scoringFrequency = $event"
                @change="handleScoringFrequencyChange"
              />
            </div>
            <CycleMonthlyScheduleEditor
              :schedules="scoringPlan.periodSchedules"
              :warnings="scoringPlan.scheduleWarnings"
              :blockers="scoringPlan.scheduleBlockers"
              @update:schedules="handleScoringSchedulesUpdate"
            />
          </section>

          <section class="schedule-stage" data-testid="cycle-schedule-stage" aria-labelledby="schedule-stage-result">
            <div class="schedule-stage__title">
              <span class="schedule-stage__phase-number">{{ isWorkflowV2Form ? 3 : 2 }}</span>
              <strong id="schedule-stage-result">结果考评</strong>
              <el-tooltip :content="isWorkflowV2Form ? '最后一期评分后完成结果审批和公示' : '考核结束后完成结果审批和公示'" placement="top">
                <el-icon class="schedule-stage__help"><QuestionFilled /></el-icon>
              </el-tooltip>
            </div>
            <div
              v-for="node in isWorkflowV2Form ? WORKFLOW_V2_FINAL_SCHEDULE_NODES : RESULT_SCHEDULE_NODES"
              :key="node.key"
              class="schedule-node"
              :class="{ 'is-missing': !createForm[node.key] }"
              :data-schedule-node-key="node.key"
              data-testid="cycle-schedule-node"
            >
              <div class="schedule-node__copy">
                <strong><span v-if="isCreateScheduleNodeAdjusted(node.key)" class="cycle-adjusted-dot" aria-label="时间已调整" />{{ node.label }}</strong>
                <small>{{ node.helper }}</small>
              </div>
              <div class="schedule-node__input">
                <el-date-picker
                  v-model="createForm[node.key]"
                  type="datetime"
                  :placeholder="`选择${node.label}`"
                  @change="handleCreateScheduleChange"
                />
                <small v-if="!createForm[node.key]" class="schedule-node__required">必填</small>
                <small
                  v-for="issue in scheduleNodeIssues(node.key)"
                  :key="issue.code"
                  class="schedule-node__issue"
                >{{ issue.message }}</small>
              </div>
            </div>
          </section>
        </section>

        <el-form-item label="考核范围" prop="participantDeptIds" class="cycle-participant-field">
          <template #label>
            <span class="form-label-with-help">考核范围
              <el-tooltip content="可按部门或人员多选考核对象，并支持全选、反选和清空" placement="top">
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

        <el-form-item class="cycle-notification-field">
          <template #label>
            <span class="form-label-with-help">员工通知
              <el-tooltip content="不发送为默认；发起时提醒只通知一次；每日催办会在临期或逾期任务每天 09:00 提醒，并按 24 小时限频" placement="top">
                <el-icon><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-radio-group v-model="createForm.notificationMode" class="notification-mode-options">
            <el-radio-button data-testid="cycle-notification-off" value="off">不发送</el-radio-button>
            <el-radio-button data-testid="cycle-notification-launch-only" value="launch_only">发起时提醒</el-radio-button>
            <el-radio-button data-testid="cycle-notification-reminders" value="launch_and_reminders">每日催办</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <button
          type="button"
          class="advanced-create-toggle"
          data-testid="cycle-create-advanced"
          :aria-expanded="advancedCreateVisible"
          @click="advancedCreateVisible = !advancedCreateVisible"
        >
          <span>{{ advancedCreateVisible ? '收起高级设置' : '高级设置' }}</span>
          <small>等级比例与公示范围</small>
        </button>

        <div
          data-testid="cycle-advanced-fields"
          class="advanced-create-fields"
          :class="{ 'is-visible': advancedCreateVisible }"
        >
          <el-collapse v-model="advancedCreateSections" class="advanced-create-groups">
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
        </section>
      </el-form>

      <template #footer>
        <div class="cycle-create-footer">
          <div class="cycle-create-footer__meta">
            <span class="cycle-creator-note">
              创建人：{{ isEditMode ? (cycles.find((item) => item.id === editingCycleId)?.creator?.name || auth.user?.name) : auth.user?.name }}
            </span>
            <p v-if="createNotificationHint" data-testid="cycle-create-impact-hint">{{ createNotificationHint }}</p>
          </div>
          <div class="cycle-create-footer__actions">
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
          title="已执行节点只能向后延期"
          description="节点先后异常会在发起检查中提醒，不影响保存；相同时间允许保存。"
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
  flex-wrap: wrap;
  gap: 6px 12px;
  padding: 9px 14px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  background: var(--el-fill-color-lighter);
  border-top: 1px solid var(--el-border-color-lighter);
}

.cycle-auto-plan--standalone {
  margin: 2px 0 16px 108px;
  border-top: 0;
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
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.cycle-basic-fields { order: 1; }
.cycle-period-field { order: 2; }
.cycle-time-plan { order: 3; }
.cycle-participant-field { order: 4; }
.cycle-notification-field { order: 5; }

.cycle-time-plan {
  display: grid;
  gap: 12px;
  margin: 0 0 18px 108px;
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.cycle-time-plan__heading,
.cycle-time-plan__heading > div,
.cycle-time-plan__heading strong {
  display: flex;
  align-items: center;
}

.cycle-time-plan__heading {
  justify-content: space-between;
  gap: 12px;
}

.cycle-time-plan__heading > div,
.cycle-time-plan__heading strong {
  gap: 7px;
}

.cycle-time-plan__heading strong {
  color: var(--el-text-color-primary);
  font-size: 15px;
}

.cycle-time-plan__heading > div > span {
  padding: 2px 7px;
  color: var(--el-color-primary);
  font-size: 12px;
  background: var(--el-color-primary-light-9);
  border-radius: 4px;
}

.cycle-time-plan__heading > div > span.is-adjusted {
  color: var(--el-color-warning-dark-2);
  background: var(--el-color-warning-light-9);
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

.cycle-period-warning {
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
  order: 6;
}

.advanced-create-toggle span {
  font-weight: 600;
}

.advanced-create-toggle:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.advanced-create-fields {
  display: contents;
}

.advanced-create-groups {
  display: contents;
}

.advanced-create-fields :deep(.el-collapse-item) {
  width: calc(100% - 108px);
  margin-left: 108px;
  order: 7;
}

.advanced-create-fields:not(.is-visible) {
  display: none;
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
  align-items: center;
  gap: 8px;
  padding: 0 2px 4px;
}

.schedule-stage__phase-number {
  display: grid;
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  place-items: center;
  color: #fff;
  font-size: 12px;
  background: var(--el-color-primary);
  border-radius: 50%;
}

.schedule-stage__title strong {
  color: var(--el-text-color-primary);
  font-size: 14px;
}

.schedule-stage__help {
  color: var(--el-text-color-placeholder);
  cursor: help;
}

.schedule-stage__title--tracking :deep(.cycle-scoring-settings) {
  margin-left: auto;
}

.schedule-node {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) minmax(210px, 280px);
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 10px 12px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.schedule-node__copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.schedule-node__copy strong {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--el-text-color-primary);
  font-size: 13px;
}

.cycle-adjusted-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  background: var(--el-color-danger);
  border-radius: 50%;
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

.schedule-node__issue {
  color: var(--el-color-warning-dark-2);
  font-size: 12px;
  line-height: 1.35;
}

.schedule-node__required {
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.35;
}

.schedule-node.is-missing :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}

.schedule-node :deep(.el-date-editor) {
  width: 100%;
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

.cycle-create-footer__meta {
  align-items: flex-start;
  flex-direction: column;
  gap: 2px !important;
  color: var(--el-text-color-secondary);
  font-size: 12px;
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

  .cycle-auto-plan--standalone {
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
    grid-template-columns: 1fr;
    gap: 8px;
    padding: 10px;
  }

  .schedule-node__input {
    grid-column: 1;
  }

  .cycle-time-plan {
    margin-left: 0;
  }

  .cycle-time-plan__heading,
  .schedule-stage__title--tracking {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .schedule-stage__title--tracking :deep(.cycle-scoring-settings) {
    width: 100%;
    margin-left: 34px;
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

  .cycle-create-footer__actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .cycle-create-footer__actions .el-button {
    width: 100%;
    margin-left: 0;
  }

  .cycle-create-footer__actions .el-button:last-child {
    grid-column: 1 / -1;
  }
}
</style>
