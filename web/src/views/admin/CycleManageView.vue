<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import dayjs from 'dayjs';
import { cyclesApi } from '@/api/cycles.api';
import { departmentsApi } from '@/api/departments.api';
import ChartCard from '@/components/common/ChartCard.vue';
import UserSelect from '@/components/common/UserSelect.vue';
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
} from '@/types/api.types';
import type { CycleStatus, CycleType } from '@/types/enums';

const CYCLE_STATUS_OPTIONS: { label: string; value: CycleStatus }[] = [
  { label: '草稿', value: 'draft' },
  { label: '待开放', value: 'scheduled' },
  { label: '开放受阻', value: 'launch_blocked' },
  { label: '指标制定中', value: 'indicator_setting' },
  { label: '员工自评中', value: 'self_eval' },
  { label: '主管评分中', value: 'manager_score' },
  { label: 'HR校准中', value: 'hr_calibration' },
  { label: '审批中', value: 'approval' },
  { label: '已公示', value: 'published' },
  { label: '申诉中', value: 'appeal' },
  { label: '已关闭', value: 'closed' },
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
  launch_blocked: '开放受阻',
  indicator_setting: '指标制定中',
  self_eval: '员工自评中',
  manager_score: '主管评分中',
  hr_calibration: 'HR校准中',
  approval: '审批中',
  published: '已公示',
  appeal: '申诉中',
  closed: '已关闭',
};

const TYPE_LABEL: Record<CycleType, string> = {
  monthly: '月度',
  quarterly: '季度',
  annual: '年度',
  probation: '试用期',
  custom: '自定义',
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
const departments = ref<Department[]>([]);
const submitting = ref(false);
const launchingId = ref<string | null>(null);
const cycles = ref<AssessmentCycle[]>([]);

const statusFilter = ref<CycleStatus | ''>('');
const typeFilter = ref<CycleType | ''>('');
const keyword = ref('');

const { page, pageSize, total, pageSizeOptions, withParams, onChange } = usePagination({
  defaultPageSize: 10,
});

const createDialogVisible = ref(false);
const editDialogVisible = ref(false);
const editingCycle = ref<AssessmentCycle | null>(null);
const preflightDialogVisible = ref(false);
const preflightLoading = ref(false);
const preflightCycle = ref<AssessmentCycle | null>(null);
const preflight = ref<LaunchPreflightResult | null>(null);
const detailDialogVisible = ref(false);
const detailLoading = ref(false);
const cycleDetail = ref<AssessmentCycle | null>(null);

const createFormRef = ref<InstanceType<typeof import('element-plus')['ElForm']> | null>(null);
const editFormRef = ref<InstanceType<typeof import('element-plus')['ElForm']> | null>(null);

const createForm = reactive({
  name: '',
  type: 'quarterly' as CycleType,
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

const editForm = reactive<Record<DeadlineKey, Date | undefined>>({
  deadlineIndicatorSetting: undefined,
  deadlineIndicatorConfirm: undefined,
  deadlineSelfEval: undefined,
  deadlineManagerScore: undefined,
  deadlineHrCalibration: undefined,
  deadlineApproval: undefined,
  deadlinePublish: undefined,
});

const autoFilledCreateDeadlines = reactive<Record<DeadlineKey, boolean>>({
  deadlineIndicatorSetting: false,
  deadlineIndicatorConfirm: false,
  deadlineSelfEval: false,
  deadlineManagerScore: false,
  deadlineHrCalibration: false,
  deadlineApproval: false,
  deadlinePublish: false,
});

const createRules = {
  name: [{ required: true, message: '请输入周期名称', trigger: 'blur' }],
  type: [{ required: true, message: '请选择周期类型', trigger: 'change' }],
  startDate: [{ required: true, message: '请选择开始日期', trigger: 'change' }],
  endDate: [{ required: true, message: '请选择结束日期', trigger: 'change' }],
  hrOwnerId: [{ required: true, message: '请选择本周期 HR 负责人', trigger: 'change' }],
};

const canPreflight = computed(() => (cycle: AssessmentCycle) =>
  ['draft', 'launch_blocked'].includes(cycle.status),
);
const canOpenImmediately = computed(() => {
  const value = preflight.value?.cycle.goalSettingOpenAt;
  return Boolean(value && (
    dayjs(value).valueOf() <= Date.now()
    || auth.user?.sysRole === 'system_admin'
  ));
});

function resetAutoFilledCreateDeadlines() {
  DEADLINE_FIELDS.forEach(({ key }) => {
    autoFilledCreateDeadlines[key] = false;
  });
}

function resetCreateForm() {
  createForm.name = '';
  createForm.type = 'quarterly';
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
  resetAutoFilledCreateDeadlines();
  createFormRef.value?.resetFields?.();
  presetNextQuarter();
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
  createForm.goalSettingOpenAt = start.subtract(10, 'day').hour(9).toDate();
  createForm.deadlineIndicatorSetting = start.subtract(3, 'day').hour(18).toDate();
  createForm.deadlineIndicatorConfirm = start.subtract(1, 'day').hour(18).toDate();
  createForm.selfEvalOpenAt = end.add(1, 'day').hour(9).toDate();
  createForm.deadlineSelfEval = end.add(5, 'day').hour(18).toDate();
  createForm.deadlineManagerScore = end.add(8, 'day').hour(18).toDate();
  createForm.deadlineHrCalibration = end.add(11, 'day').hour(18).toDate();
  createForm.deadlineApproval = end.add(13, 'day').hour(18).toDate();
  createForm.deadlinePublish = end.add(14, 'day').hour(18).toDate();
}

function openCreateDialog() {
  resetCreateForm();
  createDialogVisible.value = true;
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

function handleCreateDeadlineChange(changedKey: DeadlineKey) {
  autoFilledCreateDeadlines[changedKey] = false;
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

async function handleCreate() {
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
    await cyclesApi.create(buildCreateBody());
    ElMessage.success('已创建周期草稿，请完成开放检查');
    createDialogVisible.value = false;
    resetCreateForm();
    await loadCycles();
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
    preflightDialogVisible.value = false;
    await loadCycles();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '发起周期失败');
  } finally {
    launchingId.value = null;
  }
}

async function handlePreflight(cycle: AssessmentCycle) {
  preflightCycle.value = cycle;
  preflight.value = null;
  preflightDialogVisible.value = true;
  preflightLoading.value = true;
  try {
    preflight.value = await cyclesApi.preflight(cycle.id);
  } catch {
    preflightDialogVisible.value = false;
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
    preflightDialogVisible.value = false;
    await loadCycles();
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
  } finally {
    launchingId.value = null;
  }
}

async function handleView(cycle: AssessmentCycle) {
  detailDialogVisible.value = true;
  detailLoading.value = true;
  cycleDetail.value = cycle;
  try {
    cycleDetail.value = await cyclesApi.findOne(cycle.id);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '获取周期详情失败');
  } finally {
    detailLoading.value = false;
  }
}

function buildQuery() {
  const query: { status?: CycleStatus; type?: CycleType; keyword?: string } = {};
  if (statusFilter.value) query.status = statusFilter.value;
  if (typeFilter.value) query.type = typeFilter.value;
  if (keyword.value.trim()) query.keyword = keyword.value.trim();
  return withParams(query);
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

function handleSearch() {
  page.value = 1;
  loadCycles();
}

function handleReset() {
  statusFilter.value = '';
  typeFilter.value = '';
  keyword.value = '';
  page.value = 1;
  loadCycles();
}

onChange(loadCycles);

onMounted(() => {
  loadCycles();
  departmentsApi.findAll({ flat: true }).then((items) => {
    departments.value = items;
  }).catch(() => {
    departments.value = [];
  });
});
</script>

<template>
  <div class="cycle-manage-view page-stack">
    <ChartCard>
      <template #title>考核周期管理</template>
      <template #extra>
        <el-button data-testid="cycle-create" type="primary" @click="openCreateDialog">新建周期</el-button>
      </template>

      <div class="filter-row">
        <el-select v-model="statusFilter" placeholder="全部状态" clearable style="width: 160px" @change="handleSearch">
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
      <el-alert
        class="launch-guide"
        type="info"
        :closable="false"
        show-icon
        title="新季度开启：创建草稿 → 开放检查 → 预约开放"
        description="系统默认在季度开始前 10 天开放目标制定；只有检查通过后才能预约，开放后员工才会看到该季度。"
      />
    </ChartCard>

    <ChartCard :padded="false">
      <el-table v-loading="listLoading" class="app-table" :data="cycles" row-key="id">
        <el-table-column prop="name" label="周期名称" min-width="180" />
        <el-table-column prop="type" label="类型" width="100">
          <template #default="{ row }">
            {{ TYPE_LABEL[(row as AssessmentCycle).type] }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="STATUS_TAG_TYPE[(row as AssessmentCycle).status] as any" size="small">
              {{ STATUS_LABEL[(row as AssessmentCycle).status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="起止日期" min-width="200">
          <template #default="{ row }">
            {{ formatDate((row as AssessmentCycle).startDate) }} ~ {{ formatDate((row as AssessmentCycle).endDate) }}
          </template>
        </el-table-column>
        <el-table-column label="目标开放" min-width="150">
          <template #default="{ row }">
            {{ formatDateTimeForMessage((row as AssessmentCycle).goalSettingOpenAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleView(row as AssessmentCycle)">查看</el-button>
            <el-button
              link
              type="primary"
              size="small"
              :disabled="['scheduled', 'launch_blocked'].includes((row as AssessmentCycle).status)"
              @click="openEditDeadlines(row as AssessmentCycle)"
            >
              改截止日
            </el-button>
            <el-button
              v-if="['scheduled', 'launch_blocked'].includes((row as AssessmentCycle).status)"
              link
              type="danger"
              size="small"
              :loading="launchingId === (row as AssessmentCycle).id"
              @click="handleCancelSchedule(row as AssessmentCycle)"
            >
              取消预约
            </el-button>
            <el-button
              v-if="canPreflight(row as AssessmentCycle)"
              link
              type="success"
              size="small"
              :disabled="!canPreflight(row as AssessmentCycle)"
              @click="handlePreflight(row as AssessmentCycle)"
            >
              {{ (row as AssessmentCycle).status === 'launch_blocked' ? '重新检查' : '开放检查' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="app-pager">
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

    <el-dialog v-model="detailDialogVisible" title="周期详情" width="720px" destroy-on-close>
      <div v-loading="detailLoading">
        <el-descriptions v-if="cycleDetail" :column="2" border>
          <el-descriptions-item label="周期">
            {{ cycleDetail.name }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="STATUS_TAG_TYPE[cycleDetail.status] as any" size="small">
              {{ STATUS_LABEL[cycleDetail.status] }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="考核期间">
            {{ formatDate(cycleDetail.startDate) }} ~ {{ formatDate(cycleDetail.endDate) }}
          </el-descriptions-item>
          <el-descriptions-item label="目标制定开放">
            {{ formatDateTimeForMessage(cycleDetail.goalSettingOpenAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="HR 负责人">
            {{ cycleDetail.hrOwner?.name || '未设置' }}
          </el-descriptions-item>
          <el-descriptions-item label="目标提交截止">
            {{ formatDateTimeForMessage(cycleDetail.deadlineIndicatorSetting) }}
          </el-descriptions-item>
          <el-descriptions-item label="目标确认截止">
            {{ formatDateTimeForMessage(cycleDetail.deadlineIndicatorConfirm) }}
          </el-descriptions-item>
          <el-descriptions-item label="自评开放">
            {{ formatDateTimeForMessage(cycleDetail.selfEvalOpenAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="自评截止">
            {{ formatDateTimeForMessage(cycleDetail.deadlineSelfEval) }}
          </el-descriptions-item>
          <el-descriptions-item label="开放方式">
            {{ cycleDetail.openSource === 'scheduled' ? '预约自动开放' : cycleDetail.openSource === 'manual' ? 'HR 手动开放' : '尚未开放' }}
          </el-descriptions-item>
          <el-descriptions-item label="实际开放时间">
            {{ formatDateTimeForMessage(cycleDetail.openedAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="参与任务">
            {{ cycleDetail.taskStats?.total ?? 0 }} 人
          </el-descriptions-item>
          <el-descriptions-item label="模板快照">
            {{ cycleDetail.snapshotCount ?? 0 }} 个
          </el-descriptions-item>
          <el-descriptions-item label="目标未提交">
            {{ cycleDetail.taskStats?.unsubmitted ?? 0 }} 人
          </el-descriptions-item>
          <el-descriptions-item label="待主管审核">
            {{ cycleDetail.taskStats?.pendingManagerReview ?? 0 }} 人
          </el-descriptions-item>
          <el-descriptions-item label="待员工确认">
            {{ cycleDetail.taskStats?.pendingEmployeeConfirmation ?? 0 }} 人
          </el-descriptions-item>
          <el-descriptions-item label="目标已完成">
            {{ cycleDetail.taskStats?.goalCompleted ?? 0 }} 人
          </el-descriptions-item>
          <el-descriptions-item label="已豁免">
            {{ cycleDetail.taskStats?.exempted ?? 0 }} 人
          </el-descriptions-item>
          <el-descriptions-item label="已逾期">
            <el-text :type="cycleDetail.taskStats?.overdue ? 'danger' : 'success'">
              {{ cycleDetail.taskStats?.overdue ?? 0 }} 人
            </el-text>
          </el-descriptions-item>
          <el-descriptions-item v-if="cycleDetail.launchBlockedReason" label="开放受阻原因" :span="2">
            <el-text type="danger">{{ cycleDetail.launchBlockedReason }}</el-text>
          </el-descriptions-item>
        </el-descriptions>
      </div>
      <template #footer>
        <el-button @click="detailDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 新建周期 -->
    <el-dialog v-model="createDialogVisible" data-testid="cycle-create-dialog" title="新建考核周期" width="760px" destroy-on-close>
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="120px">
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

        <el-alert
          class="deadline-alert"
          type="success"
          :closable="false"
          show-icon
          title="已按下一季度自动生成建议时间"
          description="目标制定默认在周期开始前 10 天开放，自评默认在周期结束后第 1 天开放，所有时间均可调整。"
        />

        <el-divider content-position="left">负责人和参与范围</el-divider>
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
            <el-form-item label="参与部门">
              <el-select v-model="createForm.participantDeptIds" multiple filterable collapse-tags placeholder="不选表示全公司" style="width: 100%">
                <el-option v-for="dept in departments" :key="dept.id" :label="dept.fullPath || dept.name" :value="dept.id" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="额外参与人员">
              <UserSelect v-model="createForm.participantUserIds" multiple status="active" placeholder="按需补充参与人员" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="明确豁免人员">
              <UserSelect v-model="createForm.explicitExemptUserIds" multiple status="active" placeholder="按需设置本周期豁免" />
            </el-form-item>
          </el-col>
        </el-row>
        <p class="form-tip">参与部门和人员均不选择时默认覆盖全公司；明确豁免人员仍会生成可查看原因的豁免任务。</p>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="目标开放时间">
              <el-date-picker v-model="createForm.goalSettingOpenAt" type="datetime" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="自评开放时间">
              <el-date-picker v-model="createForm.selfEvalOpenAt" type="datetime" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="开始日期" prop="startDate">
              <el-date-picker v-model="createForm.startDate" type="date" placeholder="选择开始日期" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="结束日期" prop="endDate">
              <el-date-picker v-model="createForm.endDate" type="date" placeholder="选择结束日期" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">各节点截止日期</el-divider>
        <el-row :gutter="16">
          <el-col v-for="field in DEADLINE_FIELDS" :key="field.key" :span="12">
            <el-form-item :label="field.label">
              <el-date-picker
                v-model="createForm[field.key]"
                type="datetime"
                :placeholder="`选择${field.label}`"
                style="width: 100%"
                @change="handleCreateDeadlineChange(field.key)"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">等级上限比例（%）</el-divider>
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

        <el-divider content-position="left">公示可见字段</el-divider>
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
      </el-form>

      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleCreate">确认创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="preflightDialogVisible" title="目标制定开放检查" width="1000px" destroy-on-close>
      <div v-loading="preflightLoading" class="preflight-content">
        <template v-if="preflight">
          <el-alert
            :type="preflight.ready ? 'success' : 'error'"
            :closable="false"
            show-icon
            :title="preflight.ready ? '检查通过，可预约开放' : '检查未通过，请先处理阻断项'"
          />
          <el-descriptions :column="3" border class="preflight-summary">
            <el-descriptions-item label="周期">{{ preflight.cycle.name }}</el-descriptions-item>
            <el-descriptions-item label="参与人数">{{ preflight.participantCount }}</el-descriptions-item>
            <el-descriptions-item label="匹配模板">{{ preflight.templateCount }}</el-descriptions-item>
            <el-descriptions-item label="目标开放" :span="3">
              {{ formatDateTimeForMessage(preflight.cycle.goalSettingOpenAt) }}
            </el-descriptions-item>
          </el-descriptions>
          <div v-if="preflight.blockers.length" class="preflight-blockers">
            <div v-for="blocker in preflight.blockers" :key="blocker.code" class="preflight-blocker">
              <strong>{{ blocker.code }}</strong>
              <span>{{ blocker.message }}</span>
            </div>
          </div>
          <el-table v-else :data="preflight.participants" size="small" max-height="420">
            <el-table-column prop="employeeName" label="员工" min-width="100" />
            <el-table-column prop="deptName" label="部门" min-width="140" show-overflow-tooltip />
            <el-table-column prop="managerName" label="直属主管" min-width="110">
              <template #default="{ row }">{{ row.managerName || '未设置' }}</template>
            </el-table-column>
            <el-table-column prop="templateName" label="匹配模板" min-width="180" show-overflow-tooltip />
            <el-table-column label="豁免" min-width="220">
              <template #default="{ row }">
                <el-tag v-if="row.isExempt" type="warning" size="small">已豁免</el-tag>
                <span v-else>否</span>
                <span v-if="row.exemptReason" class="exempt-reason">{{ row.exemptReason }}</span>
              </template>
            </el-table-column>
          </el-table>
        </template>
      </div>
      <template #footer>
        <el-button @click="preflightDialogVisible = false">关闭</el-button>
        <el-button
          v-if="preflight?.ready && preflightCycle && canOpenImmediately"
          :loading="launchingId === preflightCycle.id"
          @click="handleLaunch(preflightCycle)"
        >
          立即开放
        </el-button>
        <el-button
          v-if="preflight?.ready"
          type="primary"
          :loading="launchingId === preflightCycle?.id"
          @click="handleSchedule"
        >
          按开放时间预约
        </el-button>
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
.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.launch-guide {
  margin-top: 16px;
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
</style>
