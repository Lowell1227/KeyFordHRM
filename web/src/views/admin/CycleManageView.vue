<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import dayjs from 'dayjs';
import { cyclesApi } from '@/api/cycles.api';
import { departmentsApi } from '@/api/departments.api';
import ChartCard from '@/components/common/ChartCard.vue';
import CollapsibleFilterPanel from '@/components/common/CollapsibleFilterPanel.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import UserSelect from '@/components/common/UserSelect.vue';
import CycleCompactTable from './components/CycleCompactTable.vue';
import CycleWorkspaceShell from './components/CycleWorkspaceShell.vue';
import { cycleStatusGroup } from './cycle-management';
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
} from '@/types/api.types';
import type { CycleStatus, CycleType } from '@/types/enums';

const CYCLE_STATUS_OPTIONS: { label: string; value: CycleStatus }[] = [
  { label: '草稿', value: 'draft' },
  { label: '待开放', value: 'scheduled' },
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
  scheduled: '待开放',
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
type ParticipantScope = 'all' | 'departments';

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
const submitting = ref(false);
const launchingId = ref<string | null>(null);
const cycles = ref<AssessmentCycle[]>([]);

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
const advancedCreateVisible = ref(false);
const advancedCreateSections = ref<string[]>([]);
const createScheduleCustomized = ref(false);
const createInitialSnapshot = ref('');
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
const participantScopeSummary = computed(() => (
  createForm.participantScope === 'all'
    ? '全公司'
    : createForm.participantDeptIds.length > 0
      ? `${createForm.participantDeptIds.length} 个部门`
      : '待选择部门'
));
const gradeRatioSummary = computed(() => (
  `A ${createForm.gradeAMaxRatio}% · B ${createForm.gradeBMaxRatio}% · C ${createForm.gradeCMaxRatio}% · D ${createForm.gradeDMaxRatio}%`
));
const visibleFieldCount = computed(() => Object.values(createForm.publishVisibleFields).filter(Boolean).length);
const hrOwnerSummary = computed(() => {
  if (!createForm.hrOwnerId) return '待选择';
  if (createForm.hrOwnerId === auth.user?.id) return auth.user.name;
  return '已指定';
});

const createFormRef = ref<InstanceType<typeof import('element-plus')['ElForm']> | null>(null);
const editFormRef = ref<InstanceType<typeof import('element-plus')['ElForm']> | null>(null);

const createForm = reactive({
  name: '',
  type: 'quarterly' as CycleType,
  participantScope: 'all' as ParticipantScope,
  startDate: undefined as Date | undefined,
  endDate: undefined as Date | undefined,
  goalSettingOpenAt: undefined as Date | undefined,
  selfEvalOpenAt: undefined as Date | undefined,
  hrOwnerId: '' as string | undefined,
  participantDeptIds: [] as string[],
  participantUserIds: [] as string[],
  explicitExemptUserIds: [] as string[],
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
  return JSON.stringify(createForm);
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
  hrOwnerId: [{ required: true, message: '请选择本周期 HR 负责人', trigger: 'change' }],
  participantDeptIds: [{
    validator: (_rule: unknown, value: string[], callback: (error?: Error) => void) => {
      if (createForm.participantScope === 'departments' && value.length === 0) {
        callback(new Error('请选择至少一个参与部门'));
        return;
      }
      callback();
    },
    trigger: 'change',
  }],
};

const canOpenImmediately = computed(() => {
  const value = preflight.value?.cycle.goalSettingOpenAt;
  return Boolean(value && (
    dayjs(value).valueOf() <= Date.now()
    || auth.user?.sysRole === 'system_admin'
  ));
});

function resetCreateForm() {
  advancedCreateVisible.value = false;
  advancedCreateSections.value = [];
  createScheduleCustomized.value = false;
  createForm.name = '';
  createForm.type = 'quarterly';
  createForm.participantScope = 'all';
  createForm.startDate = undefined;
  createForm.endDate = undefined;
  createForm.goalSettingOpenAt = undefined;
  createForm.selfEvalOpenAt = undefined;
  createForm.hrOwnerId = auth.user?.sysRole === 'hr' ? auth.user.id : undefined;
  createForm.participantDeptIds = [];
  createForm.participantUserIds = [];
  createForm.explicitExemptUserIds = [];
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
  createFormRef.value?.resetFields?.();
  presetNextQuarter();
  createInitialSnapshot.value = createFormSnapshot();
}

function presetNextQuarter() {
  const now = dayjs();
  const quarterStartMonth = Math.floor(now.month() / 3) * 3;
  const start = now.month(quarterStartMonth).startOf('month').add(3, 'month').startOf('day');
  const end = start.add(3, 'month').subtract(1, 'day').startOf('day');
  const quarter = Math.floor(start.month() / 3) + 1;
  createForm.name = `${start.year()} Q${quarter} 季度考核`;
  createForm.startDate = start.toDate();
  createForm.endDate = end.toDate();
  applyDefaultCreateSchedule();
}

function applyDefaultCreateSchedule() {
  if (!createForm.startDate || !createForm.endDate) return;
  const start = dayjs(createForm.startDate).startOf('day');
  const end = dayjs(createForm.endDate).startOf('day');
  createForm.goalSettingOpenAt = start.subtract(10, 'day').hour(9).toDate();
  createForm.deadlineIndicatorSetting = start.subtract(3, 'day').hour(18).toDate();
  createForm.deadlineIndicatorConfirm = start.subtract(1, 'day').hour(18).toDate();
  createForm.selfEvalOpenAt = end.add(1, 'day').hour(9).toDate();
  createForm.deadlineSelfEval = end.add(5, 'day').hour(18).toDate();
  createForm.deadlineManagerScore = end.add(8, 'day').hour(18).toDate();
  createForm.deadlineHrCalibration = end.add(11, 'day').hour(18).toDate();
  createForm.deadlineApproval = end.add(13, 'day').hour(18).toDate();
  createForm.deadlinePublish = end.add(14, 'day').hour(18).toDate();
  createScheduleCustomized.value = false;
}

function openCreateDialog() {
  resetCreateForm();
  createDialogVisible.value = true;
}

function handleParticipantScopeChange(scope: string | number | boolean | undefined) {
  if (scope !== 'all' && scope !== 'departments') return;
  if (scope === 'all') createForm.participantDeptIds = [];
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

function handleCreatePeriodChange() {
  if (!createScheduleCustomized.value) applyDefaultCreateSchedule();
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
  if (goalDates.some((item) => createForm.startDate && !dayjs(item.value).isBefore(createForm.startDate))) {
    return '目标制定、审核与确认应在考核周期开始前完成。';
  }
  if (createForm.endDate && dayjs(createForm.selfEvalOpenAt).isBefore(dayjs(createForm.endDate).add(1, 'day').startOf('day'))) {
    return '自评开放时间不能早于考核周期结束后的次日。';
  }
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

function buildCreateBody(): CreateCycleBody {
  const body: CreateCycleBody = {
    name: createForm.name,
    type: createForm.type,
    startDate: formatDateLocal(createForm.startDate)!,
    endDate: formatDateLocal(createForm.endDate)!,
    goalSettingOpenAt: formatDateTimeLocal(createForm.goalSettingOpenAt),
    selfEvalOpenAt: formatDateTimeLocal(createForm.selfEvalOpenAt),
    hrOwnerId: createForm.hrOwnerId,
    participantDeptIds: [...createForm.participantDeptIds],
    participantUserIds: [...createForm.participantUserIds],
    explicitExemptUserIds: [...createForm.explicitExemptUserIds],
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

  return body;
}

async function handleCreate(runPreflight = false) {
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

  submitting.value = true;
  try {
    const created = await cyclesApi.create(buildCreateBody());
    ElMessage.success(runPreflight ? '周期草稿已保存，正在进入发起前检查' : '周期草稿已保存');
    createDialogVisible.value = false;
    resetCreateForm();
    await loadCycles();
    if (runPreflight) {
      await openCycleWorkspace(created, true);
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
        '当前尚未到目标开放时间。提前开放会立即通知员工，请填写业务原因（至少 5 个字）。',
        '提前开放说明',
        {
          confirmButtonText: '继续',
          cancelButtonText: '取消',
          inputValidator: (value) => value.trim().length >= 5 || '请填写至少 5 个字的原因',
        },
      );
      overrideReason = prompt.value.trim();
    }
    await ElMessageBox.confirm(
      `发起后将为全员创建考核任务并绑定模板快照，该操作不可撤销。\n\n确认发起「${cycle.name}」？`,
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
    ElMessage.success('目标制定已开放，员工可查看本期任务');
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
    preflightError.value = error instanceof Error ? error.message : '发起前检查失败，请重试';
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
    ElMessage.success(`已预约，将于 ${formatDateTimeForMessage(preflight.value.cycle.goalSettingOpenAt)} 自动开放`);
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
      `确认取消「${cycle.name}」的自动开放预约？`,
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

function handleWorkspaceEditDeadlines() {
  if (cycleDetail.value) openEditDeadlines(cycleDetail.value);
}

function handleWorkspaceCancelSchedule() {
  if (cycleDetail.value) void handleCancelSchedule(cycleDetail.value);
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

onChange(() => {
  void syncListRoute();
  void loadCycles();
});

onMounted(() => {
  loadCycles();
  if (typeof route.query.cycleId === 'string') void loadCycleDetail(route.query.cycleId);
  departmentsApi.findAll({ flat: true }).then((items) => {
    departments.value = items;
  }).catch(() => {
    departments.value = [];
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
      @back="closeCycleWorkspace"
      @retry="retryCycleDetail"
      @preflight="handleWorkspacePreflight"
      @launch="handleWorkspaceLaunch"
      @schedule="handleSchedule"
      @edit-deadlines="handleWorkspaceEditDeadlines"
      @cancel-schedule="handleWorkspaceCancelSchedule"
      @resolve-blocker="handleResolvePreflightBlocker"
    />

    <template v-else>
    <ChartCard class="list-page-header-card">
      <template #title>考核周期管理</template>
      <template #extra>
        <el-button data-testid="cycle-create" type="primary" @click="openCreateDialog">新建周期</el-button>
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
        :loading="listLoading"
        :launching-id="launchingId"
        @open="handleView"
        @primary="handlePrimaryCycleAction"
        @edit-deadlines="openEditDeadlines"
        @cancel-schedule="handleCancelSchedule"
      />

      <div v-else data-testid="cycle-empty-state" class="cycle-empty-state">
        <EmptyState :description="emptyStateDescription">
          <el-button
            v-if="statusGroup === 'attention' && !hasListFilters"
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

    <!-- 新建周期 -->
    <el-dialog
      v-model="createDialogVisible"
      class="cycle-create-dialog"
      data-testid="cycle-create-dialog"
      title="创建绩效周期"
      width="900px"
      destroy-on-close
      :before-close="handleCreateBeforeClose"
    >
      <ol class="cycle-create-flow" data-testid="cycle-create-flow" aria-label="绩效周期发起流程">
        <li class="is-current"><span>1</span><div><strong>创建周期</strong><small>填写关键设置</small></div></li>
        <li><span>2</span><div><strong>发起前检查</strong><small>核对人员与模板</small></div></li>
        <li><span>3</span><div><strong>通知员工</strong><small>确认后正式发起</small></div></li>
      </ol>

      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="104px">
        <div class="cycle-create-layout">
          <section class="cycle-create-main" aria-label="周期关键设置">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="周期名称" prop="name">
              <el-input v-model="createForm.name" placeholder="如 2026 Q2 季度考核" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="周期类型" prop="type">
              <el-select v-model="createForm.type" placeholder="请选择" style="width: 100%">
                <el-option v-for="opt in CYCLE_TYPE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="HR 负责人" prop="hrOwnerId">
              <UserSelect
                v-model="createForm.hrOwnerId"
                sys-role="hr"
                status="active"
                :clearable="false"
                placeholder="选择本周期 HR 负责人"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="考核范围">
              <el-radio-group v-model="createForm.participantScope" @change="handleParticipantScopeChange">
                <el-radio-button data-testid="cycle-scope-all" value="all">全公司</el-radio-button>
                <el-radio-button data-testid="cycle-scope-departments" value="departments">指定部门</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item
          v-if="createForm.participantScope === 'departments'"
          label="参与部门"
          prop="participantDeptIds"
        >
          <el-select
            v-model="createForm.participantDeptIds"
            data-testid="cycle-scope-department-select"
            multiple
            filterable
            collapse-tags
            placeholder="请选择至少一个参与部门"
            style="width: 100%"
          >
            <el-option v-for="dept in departments" :key="dept.id" :label="dept.fullPath || dept.name" :value="dept.id" />
          </el-select>
        </el-form-item>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="开始日期" prop="startDate">
              <el-date-picker
                v-model="createForm.startDate"
                type="date"
                placeholder="选择开始日期"
                style="width: 100%"
                @change="handleCreatePeriodChange"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="结束日期" prop="endDate">
              <el-date-picker
                v-model="createForm.endDate"
                type="date"
                placeholder="选择结束日期"
                style="width: 100%"
                @change="handleCreatePeriodChange"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <div class="cycle-plan-summary" data-testid="cycle-plan-summary">
          <div>
            <span>目标制定开放</span>
            <strong>{{ formatDateTimeForMessage(createForm.goalSettingOpenAt) }}</strong>
          </div>
          <div>
            <span>周期开始</span>
            <strong>{{ formatDate(createForm.startDate) }}</strong>
          </div>
          <div>
            <span>周期结束</span>
            <strong>{{ formatDate(createForm.endDate) }}</strong>
          </div>
          <div>
            <span>员工自评开放</span>
            <strong>{{ formatDateTimeForMessage(createForm.selfEvalOpenAt) }}</strong>
          </div>
          <el-tag size="small" :type="createScheduleCustomized ? 'warning' : 'info'" effect="light">
            {{ createScheduleCustomized ? '自定义计划' : '默认计划' }}
          </el-tag>
          <p>
            {{ createScheduleCustomized
              ? '已保留自定义时间节点；可在高级设置中恢复默认计划。'
              : '系统已根据考核期间自动生成目标制定、自评和审批节点。' }}
          </p>
        </div>

        <button
          type="button"
          class="advanced-create-toggle"
          data-testid="cycle-create-advanced"
          :aria-expanded="advancedCreateVisible"
          @click="advancedCreateVisible = !advancedCreateVisible"
        >
          <span>{{ advancedCreateVisible ? '收起高级设置' : '高级设置' }}</span>
          <small>{{ createScheduleCustomized ? '时间计划已自定义' : '通常无需修改' }}</small>
        </button>

        <div v-show="advancedCreateVisible" data-testid="cycle-advanced-fields" class="advanced-create-fields">
          <el-collapse v-model="advancedCreateSections" class="advanced-create-groups">
            <el-collapse-item name="participants">
              <template #title>
                <div data-testid="cycle-advanced-participants" class="advanced-group-title">
                  <strong>参与范围与例外</strong>
                  <span>{{ participantScopeSummary }}</span>
                </div>
              </template>
              <el-row :gutter="16">
                <el-col v-if="createForm.participantScope === 'departments'" :span="12">
                  <el-form-item label="额外参与人员">
                    <UserSelect v-model="createForm.participantUserIds" multiple status="active" placeholder="按需补充参与人员" />
                  </el-form-item>
                </el-col>
                <el-col :span="createForm.participantScope === 'departments' ? 12 : 24">
                  <el-form-item label="明确豁免人员">
                    <UserSelect v-model="createForm.explicitExemptUserIds" multiple status="active" placeholder="按需设置本周期豁免" />
                  </el-form-item>
                </el-col>
              </el-row>
              <p class="form-tip">全公司范围无需额外补充人员；明确豁免人员仍会生成可查看原因的豁免任务。</p>
            </el-collapse-item>

            <el-collapse-item name="schedule">
              <template #title>
                <div data-testid="cycle-advanced-schedule" class="advanced-group-title">
                  <strong>时间节点</strong>
                  <span>{{ createScheduleCustomized ? '已自定义' : '默认计划' }}</span>
                </div>
              </template>
              <div class="advanced-group-actions">
                <span>调整任一时间后将标记为自定义计划</span>
                <el-button text type="primary" @click.stop="applyDefaultCreateSchedule">恢复默认计划</el-button>
              </div>
              <el-row :gutter="16">
                <el-col :span="12">
                  <el-form-item label="目标开放时间">
                    <el-date-picker
                      v-model="createForm.goalSettingOpenAt"
                      type="datetime"
                      style="width: 100%"
                      @change="handleCreateScheduleChange"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="自评开放时间">
                    <el-date-picker
                      v-model="createForm.selfEvalOpenAt"
                      type="datetime"
                      style="width: 100%"
                      @change="handleCreateScheduleChange"
                    />
                  </el-form-item>
                </el-col>
                <el-col v-for="field in DEADLINE_FIELDS" :key="field.key" :span="12">
                  <el-form-item :label="field.label">
                    <el-date-picker
                      v-model="createForm[field.key]"
                      type="datetime"
                      :placeholder="`选择${field.label}`"
                      style="width: 100%"
                      @change="handleCreateScheduleChange"
                    />
                  </el-form-item>
                </el-col>
              </el-row>
            </el-collapse-item>

            <el-collapse-item name="grades">
              <template #title>
                <div data-testid="cycle-advanced-grades" class="advanced-group-title">
                  <strong>等级比例</strong>
                  <span>{{ gradeRatioSummary }}</span>
                </div>
              </template>
              <p class="form-tip advanced-group-tip">用于校准阶段判断各绩效等级是否超过建议上限。</p>
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
                  <strong>公示范围</strong>
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
                <p class="form-tip">「绩效系数」默认不勾选，员工默认不可见；HR 可按需开启。</p>
              </el-form-item>
            </el-collapse-item>
          </el-collapse>
        </div>
          </section>

          <aside class="cycle-create-summary" data-testid="cycle-create-summary" aria-label="创建摘要">
            <h3>本次将创建</h3>
            <dl>
              <div><dt>考核期间</dt><dd>{{ formatDate(createForm.startDate) }} – {{ formatDate(createForm.endDate) }}</dd></div>
              <div><dt>考核范围</dt><dd>{{ participantScopeSummary }}</dd></div>
              <div><dt>HR 负责人</dt><dd>{{ hrOwnerSummary }}</dd></div>
              <div><dt>时间计划</dt><dd>{{ createScheduleCustomized ? '已自定义' : '系统自动生成' }}</dd></div>
              <div><dt>绩效模板</dt><dd>模板将在下一步自动匹配检查</dd></div>
            </dl>
            <p v-if="createScheduleCustomized" class="cycle-create-summary__warning">
              时间节点已自定义，修改考核期间不会覆盖这些节点。
            </p>
            <p class="cycle-create-summary__notice">当前仅保存草稿，不会通知员工。</p>
          </aside>
        </div>
      </el-form>

      <template #footer>
        <div class="cycle-create-footer">
          <p data-testid="cycle-create-impact-hint">检查通过并确认发起后，员工才会收到通知</p>
          <div>
            <el-button @click="requestCloseCreateDialog">取消</el-button>
            <el-button data-testid="cycle-create-save-draft" :loading="submitting" @click="handleCreate(false)">仅保存草稿</el-button>
            <el-button data-testid="cycle-create-and-check" type="primary" :loading="submitting" @click="handleCreate(true)">
              保存并进行发起检查
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>
    </template>

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
  width: calc(100% - 104px);
  margin: 0 0 8px 104px;
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
  margin-left: 104px;
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
