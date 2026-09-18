<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  employeeArchivesApi,
  type EmployeeDataReview,
  type EmployeeReentryBody,
} from '@/api/employee-archives.api';
import { positionsApi, type PositionRecord } from '@/api/positions.api';
import UserSelect from '@/components/common/UserSelect.vue';
import type { Department, User } from '@/types/api.types';
import { formatDateTime } from '@/utils/date';

const props = defineProps<{
  modelValue: boolean;
  employee: User | null;
  departments: Department[];
}>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  submitted: [];
}>();

const loading = ref(false);
const saving = ref(false);
const cancelling = ref(false);
const currentRequest = ref<EmployeeDataReview | null>(null);
const positions = ref<PositionRecord[]>([]);
const form = reactive({
  company: 'fuede', deptId: '', positionId: '',
  rosterManagerId: null as string | null, performanceManagerId: null as string | null,
  effectiveDate: '', effectiveTo: '', employeeStatus: 'probation' as 'active' | 'probation',
  employmentType: 'full_time', plannedRegularDate: '', probationMonths: 3 as number | null,
});

function flatten(items: Department[]): Department[] {
  return items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
}

function dateValue(value: unknown): string {
  return typeof value === 'string' && value ? value.slice(0, 10) : '';
}

function warningMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'message' in value) return String((value as { message: unknown }).message);
  return '';
}

const statusLabel = computed(() => {
  const status = currentRequest.value?.onboardingStatus;
  return ({ draft: '草稿', submitted: '待 HR 审核', pending_entry: '已通过，待生效', effective: '已生效', cancelled: '已取消' } as Record<string, string>)[status ?? ''] ?? '未提交';
});
const canEdit = computed(() => !currentRequest.value || ['draft', 'submitted'].includes(currentRequest.value.onboardingStatus ?? ''));
const canCancel = computed(() => currentRequest.value && ['draft', 'submitted', 'pending_entry'].includes(currentRequest.value.onboardingStatus ?? ''));
const flowStep = computed(() => {
  const status = currentRequest.value?.onboardingStatus;
  if (status === 'effective') return 4;
  if (status === 'pending_entry') return 3;
  if (currentRequest.value?.profileReviewStatus === 'approved') return 2;
  if (status === 'submitted') return 1;
  return 0;
});

function setFormFromRequest(request: EmployeeDataReview | null) {
  const employee = request?.proposedValue?.employee ?? {};
  Object.assign(form, {
    company: employee.company ?? 'fuede',
    deptId: employee.deptId ?? props.employee?.deptId ?? '',
    positionId: employee.positionId ?? '',
    rosterManagerId: employee.managerId ?? null,
    performanceManagerId: request?.proposedValue?.performance?.managerId ?? null,
    effectiveDate: dateValue(employee.effectiveDate),
    effectiveTo: dateValue(employee.effectiveTo),
    employeeStatus: employee.employeeStatus ?? 'probation',
    employmentType: employee.employmentType ?? 'full_time',
    plannedRegularDate: dateValue(employee.plannedRegularDate),
    probationMonths: typeof employee.probationMonths === 'number' ? employee.probationMonths : 3,
  });
}

async function load() {
  if (!props.employee) return;
  loading.value = true;
  try {
    currentRequest.value = await employeeArchivesApi.getCurrentReentry(props.employee.id);
    setFormFromRequest(currentRequest.value);
  } finally { loading.value = false; }
}

watch(() => props.modelValue, (open) => { if (open) void load(); });

function body(): EmployeeReentryBody {
  return {
    company: form.company,
    deptId: form.deptId || null,
    positionId: form.positionId || null,
    rosterManagerId: form.rosterManagerId,
    performanceManagerId: form.performanceManagerId,
    effectiveDate: form.effectiveDate,
    effectiveTo: form.effectiveTo || null,
    employeeStatus: form.employeeStatus,
    employmentType: form.employmentType,
    plannedRegularDate: form.plannedRegularDate || null,
    probationMonths: form.probationMonths,
  };
}

async function submit() {
  if (!props.employee || !form.deptId || !form.effectiveDate) {
    ElMessage.warning('请填写部门和再入职日期');
    return;
  }
  saving.value = true;
  try {
    const request = currentRequest.value
      ? await employeeArchivesApi.reviseReentry(currentRequest.value.id, body())
      : await employeeArchivesApi.createReentry(props.employee.id, body());
    currentRequest.value = request;
    ElMessage.success('再入职申请已提交，HR 管理员审核后按生效日期启用');
    emit('submitted');
  } finally { saving.value = false; }
}

async function cancelRequest() {
  if (!currentRequest.value) return;
  try {
    const result = await ElMessageBox.prompt('请填写取消原因。', '取消再入职申请', {
      confirmButtonText: '确认取消', cancelButtonText: '返回', inputPattern: /\S{2,}/, inputErrorMessage: '请至少填写 2 个字',
    });
    cancelling.value = true;
    await employeeArchivesApi.cancelReentry(currentRequest.value.id, result.value);
    ElMessage.success('再入职申请已取消，预留工号不会再次使用');
    currentRequest.value = null;
    emit('submitted');
    emit('update:modelValue', false);
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') throw error;
  } finally { cancelling.value = false; }
}

onMounted(async () => { positions.value = await positionsApi.findAll(); });
</script>

<template>
  <el-drawer :model-value="modelValue" title="办理再入职" size="min(760px, 100vw)" destroy-on-close @update:model-value="emit('update:modelValue', $event)">
    <div v-loading="loading" class="reentry-drawer">
      <div class="employee-summary">
        <div><strong>{{ employee?.name }}</strong><span>历史工号 {{ employee?.employeeNo || '无' }}</span></div>
        <el-tag v-if="currentRequest" effect="plain">{{ statusLabel }}</el-tag>
      </div>
      <p class="number-note">再入职将自动生成新工号；历史工号仅保留在档案中，不再用于本次任职或登录。</p>

      <section v-if="currentRequest" class="flow-panel">
        <div class="flow-title"><strong>审批流程</strong><span>提交于 {{ formatDateTime(currentRequest.createdAt) }}</span></div>
        <el-steps :active="flowStep" finish-status="success" align-center>
          <el-step title="已提交" />
          <el-step title="HR 审核" />
          <el-step title="等待生效" />
          <el-step title="已生效" />
        </el-steps>
        <div v-if="currentRequest.employeeNo" class="new-number">本次新工号：<strong>{{ currentRequest.employeeNo }}</strong></div>
      </section>

      <el-form label-position="top" :disabled="!canEdit">
        <div class="form-grid">
          <el-form-item label="部门"><el-select v-model="form.deptId" filterable><el-option v-for="dept in flatten(departments)" :key="dept.id" :label="dept.fullPath || dept.name" :value="dept.id" /></el-select></el-form-item>
          <el-form-item label="岗位"><el-select v-model="form.positionId" filterable clearable><el-option v-for="position in positions" :key="position.id" :label="position.name" :value="position.id" /></el-select></el-form-item>
          <el-form-item label="花名册直属主管"><UserSelect v-model="form.rosterManagerId" clearable eligible-for="direct_manager" :disabled-ids="employee ? [employee.id] : []" /></el-form-item>
          <el-form-item label="绩效直属上级"><UserSelect v-model="form.performanceManagerId" clearable eligible-for="direct_manager" :disabled-ids="employee ? [employee.id] : []" /></el-form-item>
          <el-form-item label="用工类型"><el-select v-model="form.employmentType"><el-option label="全职" value="full_time" /><el-option label="兼职" value="part_time" /><el-option label="返聘" value="rehire" /><el-option label="外部" value="external" /></el-select></el-form-item>
          <el-form-item label="再入职日期"><el-date-picker v-model="form.effectiveDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="员工状态"><el-select v-model="form.employeeStatus"><el-option label="试用期" value="probation" /><el-option label="在职" value="active" /></el-select></el-form-item>
          <el-form-item v-if="form.employeeStatus === 'probation'" label="计划转正日"><el-date-picker v-model="form.plannedRegularDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item v-if="form.employeeStatus === 'probation'" label="试用期（月）"><el-input-number v-model="form.probationMonths" :min="0" :max="60" /></el-form-item>
        </div>
      </el-form>

      <div v-if="currentRequest?.validationWarnings?.length" class="warning-list">
        <span v-for="(warning, index) in currentRequest.validationWarnings" :key="index">{{ warningMessage(warning) }}</span>
      </div>
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">关闭</el-button>
      <el-button v-if="canCancel" :loading="cancelling" @click="cancelRequest">取消申请</el-button>
      <el-button v-if="canEdit" type="primary" :loading="saving" @click="submit">{{ currentRequest ? '更新并重新提交' : '提交审核' }}</el-button>
    </template>
  </el-drawer>
</template>

<style scoped>
.reentry-drawer { min-height: 280px; }
.employee-summary { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid #eaecf0; }
.employee-summary div { display: flex; align-items: baseline; gap: 12px; }
.employee-summary span, .flow-title span { color: #667085; font-size: 13px; }
.number-note { margin: 12px 0 18px; color: #475467; font-size: 13px; }
.flow-panel { margin-bottom: 20px; padding: 14px; background: #f8fafc; border-radius: 8px; }
.flow-title { display: flex; justify-content: space-between; margin-bottom: 14px; }
.new-number { margin-top: 12px; color: #344054; text-align: center; font-size: 13px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
.form-grid :deep(.el-select), .form-grid :deep(.el-date-editor) { width: 100%; }
.warning-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; color: #b54708; font-size: 12px; }
@media (max-width: 640px) { .form-grid { grid-template-columns: 1fr; } .employee-summary div, .flow-title { align-items: flex-start; flex-direction: column; gap: 4px; } }
</style>
