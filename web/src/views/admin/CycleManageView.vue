<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import dayjs from 'dayjs';
import { cyclesApi } from '@/api/cycles.api';
import ChartCard from '@/components/common/ChartCard.vue';
import { usePagination } from '@/composables/usePagination';
import { formatDate } from '@/utils/date';
import type {
  AssessmentCycle,
  CreateCycleBody,
  UpdateDeadlinesBody,
  PublishVisibleFields,
} from '@/types/api.types';
import type { CycleStatus, CycleType } from '@/types/enums';

const CYCLE_STATUS_OPTIONS: { label: string; value: CycleStatus }[] = [
  { label: '草稿', value: 'draft' },
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

const DEADLINE_AUTO_DAY_STEPS: Partial<Record<DeadlineKey, number>> = {
  deadlineIndicatorConfirm: 2,
  deadlineSelfEval: 3,
  deadlineManagerScore: 5,
  deadlineHrCalibration: 3,
  deadlineApproval: 2,
  deadlinePublish: 1,
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

type GradeRatioKey = (typeof GRADE_RATIO_FIELDS)[number]['key'];

const listLoading = ref(false);
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

const createFormRef = ref<InstanceType<typeof import('element-plus')['ElForm']> | null>(null);
const editFormRef = ref<InstanceType<typeof import('element-plus')['ElForm']> | null>(null);

const createForm = reactive({
  name: '',
  type: 'quarterly' as CycleType,
  startDate: undefined as Date | undefined,
  endDate: undefined as Date | undefined,
  deadlineIndicatorSetting: undefined as Date | undefined,
  deadlineIndicatorConfirm: undefined as Date | undefined,
  deadlineSelfEval: undefined as Date | undefined,
  deadlineManagerScore: undefined as Date | undefined,
  deadlineHrCalibration: undefined as Date | undefined,
  deadlineApproval: undefined as Date | undefined,
  deadlinePublish: undefined as Date | undefined,
  gradeAMaxRatio: 20,
  gradeBMaxRatio: 30,
  gradeCMaxRatio: 40,
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
};

const canLaunch = computed(() => (cycle: AssessmentCycle) => cycle.status === 'draft');

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
  createForm.deadlineIndicatorSetting = undefined;
  createForm.deadlineIndicatorConfirm = undefined;
  createForm.deadlineSelfEval = undefined;
  createForm.deadlineManagerScore = undefined;
  createForm.deadlineHrCalibration = undefined;
  createForm.deadlineApproval = undefined;
  createForm.deadlinePublish = undefined;
  createForm.gradeAMaxRatio = 20;
  createForm.gradeBMaxRatio = 30;
  createForm.gradeCMaxRatio = 40;
  createForm.gradeDMaxRatio = 10;
  createForm.publishVisibleFields = { ...DEFAULT_VISIBLE_FIELDS };
  resetAutoFilledCreateDeadlines();
  createFormRef.value?.resetFields?.();
}

function openCreateDialog() {
  resetCreateForm();
  createDialogVisible.value = true;
}

function formatDateTimeLocal(value: Date | undefined | null): string | undefined {
  if (!value) return undefined;
  const d = dayjs(value);
  return d.isValid() ? d.format('YYYY-MM-DDTHH:mm:ss') : undefined;
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
  const changedAt = createForm[changedKey];
  if (!changedAt) {
    autoFilledCreateDeadlines[changedKey] = false;
    return;
  }

  autoFilledCreateDeadlines[changedKey] = false;
  if (createForm.startDate && dayjs(changedAt).isBefore(createForm.startDate)) {
    const label = DEADLINE_FIELDS.find(({ key }) => key === changedKey)?.label ?? '节点截止日';
    ElMessage.warning(`${label}不能早于周期开始日期（${formatDate(createForm.startDate)}）。`);
  }

  const changedIndex = DEADLINE_FIELDS.findIndex(({ key }) => key === changedKey);
  let cursor = dayjs(changedAt);

  for (let i = changedIndex + 1; i < DEADLINE_FIELDS.length; i++) {
    const key = DEADLINE_FIELDS[i].key;
    cursor = cursor.add(DEADLINE_AUTO_DAY_STEPS[key] ?? 1, 'day');

    if (!createForm[key] || autoFilledCreateDeadlines[key]) {
      createForm[key] = cursor.toDate();
      autoFilledCreateDeadlines[key] = true;
    } else {
      cursor = dayjs(createForm[key]);
    }
  }
}

function getCreateDeadlineValidationMessage(): string | null {
  if (createForm.startDate && createForm.endDate && !dayjs(createForm.endDate).isAfter(createForm.startDate)) {
    return `结束日期必须晚于开始日期（${formatDate(createForm.startDate)}）。`;
  }

  const selectedDeadlines: Array<{ label: string; value: Date }> = [];
  for (const { key, label } of DEADLINE_FIELDS) {
    const value = createForm[key];
    if (!value) continue;

    if (createForm.startDate && dayjs(value).isBefore(createForm.startDate)) {
      return `${label}不能早于周期开始日期（${formatDate(createForm.startDate)}）。`;
    }
    selectedDeadlines.push({ label, value });
  }

  for (let i = 1; i < selectedDeadlines.length; i++) {
    const previous = selectedDeadlines[i - 1];
    const current = selectedDeadlines[i];
    if (dayjs(current.value).isBefore(previous.value)) {
      return `${current.label}不能早于${previous.label}。请按流程顺序设置截止时间。`;
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
    ElMessage.success('创建周期成功');
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
  try {
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
    await cyclesApi.launch(cycle.id);
    ElMessage.success('周期发起成功，已开始生成全员任务');
    await loadCycles();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '发起周期失败');
  } finally {
    launchingId.value = null;
  }
}

function handleView(cycle: AssessmentCycle) {
  ElMessage.info(`周期 ${cycle.name} 的详情页将在后续迭代中提供`);
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
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleView(row as AssessmentCycle)">查看</el-button>
            <el-button link type="primary" size="small" @click="openEditDeadlines(row as AssessmentCycle)">
              改截止日
            </el-button>
            <el-button
              link
              type="success"
              size="small"
              :loading="launchingId === (row as AssessmentCycle).id"
              :disabled="!canLaunch(row as AssessmentCycle)"
              @click="handleLaunch(row as AssessmentCycle)"
            >
              发起
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

:deep(.el-input-number .el-input__inner) {
  text-align: left;
}
</style>
