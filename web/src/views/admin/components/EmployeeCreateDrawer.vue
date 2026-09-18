<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import {
  employeeArchivesApi,
  type EmployeeDataReview,
  type EmployeeIdentityCandidate,
  type EmployeeIdentityLookupResult,
} from '@/api/employee-archives.api';
import { positionsApi, type PositionRecord } from '@/api/positions.api';
import UserSelect from '@/components/common/UserSelect.vue';
import type { Department } from '@/types/api.types';

const props = defineProps<{
  modelValue: boolean;
  departments: Department[];
  draft?: EmployeeDataReview | null;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  submitted: [];
  saved: [];
  reentry: [userId: string];
  existing: [userId: string];
}>();

const savingAction = ref<'draft' | 'submit' | null>(null);
const identityLoading = ref(false);
const identityResult = ref<EmployeeIdentityLookupResult | null>(null);
const phoneDuplicateAcknowledged = ref(false);
const lastIdentityKey = ref('');
const positions = ref<PositionRecord[]>([]);
const form = reactive({
  draftId: undefined as string | undefined,
  name: '', phone: '', idNumber: '', company: 'fuede', deptId: '', positionId: '',
  entryDate: '', effectiveFrom: '', employmentType: 'full_time', employeeStatus: 'probation',
  rosterManagerId: null as string | null, performanceManagerId: null as string | null,
});

const hasBlockingIdentityMatch = computed(() => (
  identityResult.value?.outcome === 'identity_match'
  || identityResult.value?.outcome === 'conflict'
));

function flatten(items: Department[]): Department[] {
  return items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
}

function dateValue(value: unknown): string {
  return typeof value === 'string' && value ? value.slice(0, 10) : '';
}

function reset() {
  const proposed = props.draft?.proposedValue ?? {};
  const employee = proposed.employee ?? {};
  const profile = proposed.profile ?? {};
  const performance = proposed.performance ?? {};
  Object.assign(form, {
    draftId: props.draft?.id,
    name: employee.name ?? '',
    phone: employee.phone ?? profile.phone ?? '',
    idNumber: '',
    company: employee.company ?? 'fuede',
    deptId: employee.deptId ?? '',
    positionId: employee.positionId ?? '',
    entryDate: dateValue(employee.entryDate),
    effectiveFrom: dateValue(employee.effectiveFrom),
    employmentType: employee.employmentType ?? 'full_time',
    employeeStatus: employee.employeeStatus ?? 'probation',
    rosterManagerId: employee.managerId ?? null,
    performanceManagerId: performance.managerId ?? null,
  });
  identityResult.value = null;
  phoneDuplicateAcknowledged.value = false;
  lastIdentityKey.value = '';
}

watch(() => props.modelValue, (open) => { if (open) reset(); });
watch(() => [form.phone, form.idNumber], () => {
  identityResult.value = null;
  phoneDuplicateAcknowledged.value = false;
  lastIdentityKey.value = '';
});

function normalizedPhone(): string {
  return form.phone.replace(/[\s-]/g, '').replace(/^\+86/, '');
}

function normalizedIdNumber(): string {
  return form.idNumber.trim().toUpperCase();
}

function canLookupIdentity(): boolean {
  return /^1\d{10}$/.test(normalizedPhone()) || /^(?:\d{15}|\d{17}[\dX])$/.test(normalizedIdNumber());
}

async function lookupIdentity(force = false) {
  if (!canLookupIdentity()) return;
  const phone = /^1\d{10}$/.test(normalizedPhone()) ? normalizedPhone() : undefined;
  const idNumber = /^(?:\d{15}|\d{17}[\dX])$/.test(normalizedIdNumber()) ? normalizedIdNumber() : undefined;
  const key = `${phone ?? ''}|${idNumber ?? ''}`;
  if (!force && key === lastIdentityKey.value) return;
  identityLoading.value = true;
  try {
    identityResult.value = await employeeArchivesApi.lookupIdentity({ phone, idNumber });
    lastIdentityKey.value = key;
    phoneDuplicateAcknowledged.value = false;
  } finally {
    identityLoading.value = false;
  }
}

function openCandidate(candidate: EmployeeIdentityCandidate) {
  emit('update:modelValue', false);
  if (candidate.status === 'resigned' || candidate.archived) emit('reentry', candidate.id);
  else emit('existing', candidate.id);
}

function requestBody() {
  return {
    draftId: form.draftId,
    name: form.name.trim(),
    phone: normalizedPhone() || null,
    idNumber: normalizedIdNumber() || null,
    phoneDuplicateAcknowledged: phoneDuplicateAcknowledged.value,
    company: form.company,
    deptId: form.deptId,
    positionId: form.positionId || null,
    entryDate: form.entryDate,
    effectiveFrom: form.effectiveFrom,
    employmentType: form.employmentType,
    employeeStatus: form.employeeStatus,
    rosterManagerId: form.rosterManagerId,
    performanceManagerId: form.performanceManagerId,
  };
}

async function saveDraft() {
  savingAction.value = 'draft';
  try {
    const body = Object.fromEntries(Object.entries(requestBody()).filter(([, value]) => value !== ''));
    await employeeArchivesApi.saveEmployeeCreateDraft(body);
    ElMessage.success('草稿已保存，尚未提交审核');
    emit('update:modelValue', false);
    emit('saved');
  } finally { savingAction.value = null; }
}

async function submit() {
  if (!form.name.trim() || !form.deptId || !form.entryDate || !form.effectiveFrom) {
    ElMessage.warning('请填写姓名、部门、入职日期和生效日期');
    return;
  }
  if ((form.phone.trim() || form.idNumber.trim()) && !canLookupIdentity()) {
    ElMessage.warning('手机号或身份证号需填写完整后再提交');
    return;
  }
  if (canLookupIdentity()) await lookupIdentity(true);
  if (hasBlockingIdentityMatch.value) {
    ElMessage.warning('已找到现有员工，请从匹配结果进入原档案处理');
    return;
  }
  if (identityResult.value?.outcome === 'phone_candidates' && !phoneDuplicateAcknowledged.value) {
    ElMessage.warning('请先确认手机号匹配结果');
    return;
  }
  savingAction.value = 'submit';
  try {
    await employeeArchivesApi.createEmployee(requestBody());
    ElMessage.success('已提交新增员工，工号已自动生成，HR 管理员审核后生效');
    emit('update:modelValue', false);
    emit('submitted');
  } finally { savingAction.value = null; }
}

onMounted(async () => { positions.value = await positionsApi.findAll(); });
</script>

<template>
  <el-drawer :model-value="modelValue" title="新增员工" size="min(720px, 100vw)" destroy-on-close @update:model-value="emit('update:modelValue', $event)">
    <el-form label-position="top" class="employee-create-form">
      <div class="identity-note">员工工号由系统提交时自动生成，无需手工填写。</div>
      <div class="form-grid">
        <el-form-item label="姓名"><el-input v-model="form.name" maxlength="50" /></el-form-item>
        <el-form-item label="手机号"><el-input v-model="form.phone" maxlength="20" @blur="lookupIdentity()" /></el-form-item>
        <el-form-item label="身份证号"><el-input v-model="form.idNumber" maxlength="18" show-password @blur="lookupIdentity()" /></el-form-item>
        <el-form-item label="身份查重"><el-button :loading="identityLoading" :disabled="!canLookupIdentity()" @click="lookupIdentity(true)">检索已有档案</el-button></el-form-item>
      </div>

      <div v-if="identityResult?.outcome === 'conflict'" class="identity-result identity-result--danger">手机号与身份证号对应不同员工，请核对后再提交。</div>
      <div v-else-if="identityResult?.candidates.length" class="identity-result">
        <strong>{{ identityResult.outcome === 'identity_match' ? '已找到现有员工档案' : '手机号与以下档案相同' }}</strong>
        <div v-for="candidate in identityResult.candidates" :key="candidate.id" class="identity-candidate">
          <span>{{ candidate.maskedName }} · {{ candidate.currentEmployeeNo || candidate.matchedHistoricalEmployeeNo || '无工号' }} · {{ candidate.departmentName || '未分配部门' }}</span>
          <el-button link type="primary" @click="openCandidate(candidate)">{{ candidate.status === 'resigned' || candidate.archived ? '办理再入职' : candidate.status === 'pending_entry' ? '查看入职流程' : '打开现有档案' }}</el-button>
        </div>
        <el-checkbox v-if="identityResult.outcome === 'phone_candidates'" v-model="phoneDuplicateAcknowledged">已核对，以上人员均不是本次新增员工</el-checkbox>
      </div>
      <div v-else-if="identityResult?.outcome === 'none'" class="identity-result identity-result--success">未发现相同手机号或身份证号，可以继续新增。</div>

      <div class="form-grid employment-grid">
        <el-form-item label="部门"><el-select v-model="form.deptId" filterable><el-option v-for="dept in flatten(departments)" :key="dept.id" :label="dept.fullPath || dept.name" :value="dept.id" /></el-select></el-form-item>
        <el-form-item label="岗位"><el-select v-model="form.positionId" filterable clearable><el-option v-for="position in positions" :key="position.id" :label="position.jobFamily ? `${position.name}（${position.jobFamily}）` : position.name" :value="position.id" /></el-select></el-form-item>
        <el-form-item label="用工类型"><el-select v-model="form.employmentType"><el-option label="全职" value="full_time" /><el-option label="兼职" value="part_time" /><el-option label="返聘" value="rehire" /><el-option label="外部" value="external" /></el-select></el-form-item>
        <el-form-item label="员工状态"><el-select v-model="form.employeeStatus"><el-option label="试用期" value="probation" /><el-option label="在职" value="active" /></el-select></el-form-item>
        <el-form-item label="入职日期"><el-date-picker v-model="form.entryDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="本次记录生效日期"><el-date-picker v-model="form.effectiveFrom" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="花名册直属主管"><UserSelect v-model="form.rosterManagerId" clearable eligible-for="direct_manager" /></el-form-item>
        <el-form-item label="绩效直属上级"><UserSelect v-model="form.performanceManagerId" clearable eligible-for="direct_manager" /></el-form-item>
      </div>
      <p class="form-help">主管关系可稍后补充；提醒不阻断提交，最终由 HR 管理员二次确认。</p>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button :loading="savingAction === 'draft'" :disabled="savingAction === 'submit'" @click="saveDraft">保存草稿</el-button>
      <el-button type="primary" :loading="savingAction === 'submit'" :disabled="savingAction === 'draft'" @click="submit">提交审核</el-button>
    </template>
  </el-drawer>
</template>

<style scoped>
.identity-note { margin: 0 0 14px; padding: 10px 12px; color: #475467; background: #f8fafc; border-radius: 6px; font-size: 13px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
.employment-grid { margin-top: 18px; }
.form-grid :deep(.el-select), .form-grid :deep(.el-date-editor) { width: 100%; }
.identity-result { margin: 2px 0 8px; padding: 12px; border: 1px solid #dbe7ff; border-radius: 6px; color: #344054; background: #f7faff; font-size: 13px; }
.identity-result--danger { color: #b42318; border-color: #fecdca; background: #fffbfa; }
.identity-result--success { color: #067647; border-color: #abefc6; background: #f6fef9; }
.identity-candidate { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 8px 0; }
.form-help { margin: 0; color: #667085; font-size: 13px; }
@media (max-width: 640px) { .form-grid { grid-template-columns: 1fr; } .identity-candidate { align-items: flex-start; flex-direction: column; gap: 2px; } }
</style>
