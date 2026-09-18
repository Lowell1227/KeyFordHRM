<script setup lang="ts">
import dayjs from 'dayjs';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { Delete, Plus } from '@element-plus/icons-vue';
import { ElMessage, type UploadRequestOptions } from 'element-plus';
import {
  employeeArchivesApi,
  type EmployeeCreateDraftPayload,
  type EmployeeCreatePayload,
  type EmployeeDataReview,
  type EmployeeIdentityCandidate,
  type EmployeeIdentityLookupResult,
} from '@/api/employee-archives.api';
import { positionsApi, type PositionRecord } from '@/api/positions.api';
import { uploadApi } from '@/api/upload.api';
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

const stepTitles = ['身份核验', '任职信息', '管理关系', '个人与教育', '联系与保障', '合同与附件', '预览提交'];
const currentStep = ref(0);
const completedSteps = ref<number[]>([]);
const draftId = ref<string>();
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
const savingAction = ref<'draft' | 'submit' | null>(null);
const identityLoading = ref(false);
const identityResult = ref<EmployeeIdentityLookupResult | null>(null);
const phoneDuplicateAcknowledged = ref(false);
const lastIdentityKey = ref('');
const positions = ref<PositionRecord[]>([]);
const hydrating = ref(false);
const idNumberConfigured = ref(false);
const bankAccountConfigured = ref(false);
const plannedRegularDateAuto = ref(true);
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let draftSavePromise: Promise<boolean> | null = null;

type ContractDraft = Record<string, any> & { __key: string };
const form = reactive({
  name: '',
  phone: '',
  idNumber: '',
  company: 'fuede',
  deptId: '',
  positionId: '',
  entryDate: '',
  effectiveFrom: '',
  effectiveTo: '',
  employmentType: 'full_time',
  employeeStatus: 'probation',
  rosterManagerId: null as string | null,
  performanceManagerId: null as string | null,
  employee: {
    position: '',
    jobGrade: '',
    jobFamily: '',
    workLocation: '',
    probationMonths: 3 as number | null,
    plannedRegularDate: '',
    actualRegularDate: '',
    leaveDate: '',
  },
  profile: {
    gender: '',
    birthDate: '',
    ethnicity: '',
    education: '',
    professionalTitle: '',
    school: '',
    graduationDate: '',
    major: '',
    maritalStatus: '',
    childrenStatus: '',
    childrenCount: null as number | null,
    politicalStatus: '',
    nativePlace: '',
    householdType: '',
    idAddress: '',
    currentAddress: '',
    emergencyContactName: '',
    emergencyContactRelation: '',
    emergencyContactPhone: '',
    socialSecurityStatus: '',
    socialSecurityStartDate: '',
    housingFundStatus: '',
    housingFundStartDate: '',
    bankName: '',
    bankBranch: '',
    bankAccount: '',
  },
  contracts: [] as ContractDraft[],
});

const hasBlockingIdentityMatch = computed(() => (
  identityResult.value?.outcome === 'identity_match' || identityResult.value?.outcome === 'conflict'
));
const saveStateLabel = computed(() => ({
  idle: '输入姓名后自动保存',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败',
}[saveState.value]));
const selectedDepartment = computed(() => flatten(props.departments).find((item) => item.id === form.deptId));
const selectedPosition = computed(() => positions.value.find((item) => item.id === form.positionId));
const missingForSubmit = computed(() => [
  !form.deptId ? '部门' : '',
  !form.entryDate ? '入职日期' : '',
  !form.effectiveFrom ? '生效日期' : '',
].filter(Boolean));

function flatten(items: Department[]): Department[] {
  return items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
}

function dateValue(value: unknown): string {
  return typeof value === 'string' && value ? value.slice(0, 10) : '';
}

function reset() {
  hydrating.value = true;
  const proposed = props.draft?.proposedValue ?? {};
  const employee = proposed.employee ?? {};
  const profile = proposed.profile ?? {};
  const performance = proposed.performance ?? {};
  const draftMeta = proposed.draftMeta ?? {};
  draftId.value = props.draft?.id;
  currentStep.value = Math.min(Math.max(Number(draftMeta.currentStep ?? 0), 0), stepTitles.length - 1);
  completedSteps.value = Array.isArray(draftMeta.completedSteps)
    ? draftMeta.completedSteps.filter((value: unknown) => Number.isInteger(value)).map(Number)
    : [];
  Object.assign(form, {
    name: employee.name ?? '',
    phone: employee.phone ?? profile.phone ?? '',
    idNumber: '',
    company: employee.company ?? 'fuede',
    deptId: employee.deptId ?? '',
    positionId: employee.positionId ?? '',
    entryDate: dateValue(employee.entryDate),
    effectiveFrom: dateValue(employee.effectiveFrom),
    effectiveTo: dateValue(employee.effectiveTo),
    employmentType: employee.employmentType ?? 'full_time',
    employeeStatus: employee.employeeStatus ?? 'probation',
    rosterManagerId: employee.managerId ?? null,
    performanceManagerId: performance.managerId ?? null,
  });
  Object.assign(form.employee, {
    position: employee.position ?? '',
    jobGrade: employee.jobGrade ?? '',
    jobFamily: employee.jobFamily ?? '',
    workLocation: employee.workLocation ?? '',
    probationMonths: employee.probationMonths ?? 3,
    plannedRegularDate: dateValue(employee.plannedRegularDate),
    actualRegularDate: dateValue(employee.actualRegularDate),
    leaveDate: dateValue(employee.leaveDate),
  });
  const automaticRegularDate = form.entryDate && form.employee.probationMonths != null
    ? dayjs(form.entryDate).add(form.employee.probationMonths, 'month').format('YYYY-MM-DD')
    : '';
  plannedRegularDateAuto.value = !form.employee.plannedRegularDate
    || form.employee.plannedRegularDate === automaticRegularDate;
  Object.assign(form.profile, {
    gender: profile.gender ?? '', birthDate: dateValue(profile.birthDate), ethnicity: profile.ethnicity ?? '',
    education: profile.education ?? '', professionalTitle: profile.professionalTitle ?? '', school: profile.school ?? '',
    graduationDate: dateValue(profile.graduationDate), major: profile.major ?? '', maritalStatus: profile.maritalStatus ?? '',
    childrenStatus: profile.childrenStatus ?? '', childrenCount: profile.childrenCount ?? null,
    politicalStatus: profile.politicalStatus ?? '', nativePlace: profile.nativePlace ?? '', householdType: profile.householdType ?? '',
    idAddress: profile.idAddress ?? '', currentAddress: profile.currentAddress ?? '',
    emergencyContactName: profile.emergencyContactName ?? '', emergencyContactRelation: profile.emergencyContactRelation ?? '',
    emergencyContactPhone: profile.emergencyContactPhone ?? '', socialSecurityStatus: profile.socialSecurityStatus ?? '',
    socialSecurityStartDate: dateValue(profile.socialSecurityStartDate), housingFundStatus: profile.housingFundStatus ?? '',
    housingFundStartDate: dateValue(profile.housingFundStartDate), bankName: profile.bankName ?? '',
    bankBranch: profile.bankBranch ?? '', bankAccount: '',
  });
  form.contracts = Array.isArray(proposed.contracts)
    ? proposed.contracts.map((item: Record<string, any>, index: number) => ({ ...item, __key: item.id || `draft-${index}` }))
    : [];
  idNumberConfigured.value = Boolean(profile.idNumberConfigured);
  bankAccountConfigured.value = Boolean(profile.bankAccountConfigured);
  identityResult.value = null;
  phoneDuplicateAcknowledged.value = false;
  lastIdentityKey.value = '';
  saveState.value = props.draft ? 'saved' : 'idle';
  nextTick(() => {
    hydrating.value = false;
    fillPlannedRegularDate();
  });
}

watch(() => props.modelValue, (open) => { if (open) reset(); });
watch(() => [form.phone, form.idNumber], () => {
  identityResult.value = null;
  phoneDuplicateAcknowledged.value = false;
  lastIdentityKey.value = '';
});
watch(() => form.positionId, (positionId) => {
  if (hydrating.value) return;
  const position = positions.value.find((item) => item.id === positionId);
  form.employee.position = position?.name ?? '';
  form.employee.jobFamily = position?.jobFamily ?? '';
});
watch(() => form.entryDate, (entryDate) => {
  if (!entryDate || hydrating.value) return;
  if (!form.effectiveFrom) form.effectiveFrom = entryDate;
  fillPlannedRegularDate();
});
watch(() => form.employee.probationMonths, () => {
  if (!hydrating.value) fillPlannedRegularDate();
});
watch(form, scheduleAutosave, { deep: true });
watch([currentStep, completedSteps], scheduleAutosave, { deep: true });

function fillPlannedRegularDate() {
  if (!plannedRegularDateAuto.value || !form.entryDate || form.employee.probationMonths == null) return;
  form.employee.plannedRegularDate = dayjs(form.entryDate).add(form.employee.probationMonths, 'month').format('YYYY-MM-DD');
}

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

function requestBody(): EmployeeCreateDraftPayload {
  const employee = {
    ...form.employee,
    name: form.name.trim(), phone: normalizedPhone() || null, company: form.company,
    deptId: form.deptId || null, positionId: form.positionId || null,
    managerId: form.rosterManagerId, entryDate: form.entryDate || null,
    effectiveFrom: form.effectiveFrom || null, effectiveTo: form.effectiveTo || null,
    employmentType: form.employmentType, employeeStatus: form.employeeStatus,
  };
  const profile = {
    ...form.profile,
    phone: normalizedPhone() || null,
    idNumber: normalizedIdNumber() || '',
    bankAccount: form.profile.bankAccount.trim(),
  };
  return {
    draftId: draftId.value,
    name: form.name.trim(), phone: normalizedPhone() || null, idNumber: normalizedIdNumber() || null,
    phoneDuplicateAcknowledged: phoneDuplicateAcknowledged.value,
    company: form.company, deptId: form.deptId, positionId: form.positionId || null,
    entryDate: form.entryDate, effectiveFrom: form.effectiveFrom, effectiveTo: form.effectiveTo || null,
    employmentType: form.employmentType, employeeStatus: form.employeeStatus,
    rosterManagerId: form.rosterManagerId, performanceManagerId: form.performanceManagerId,
    employee, profile,
    contracts: form.contracts.map(({ __key, ...contract }, index) => ({ ...contract, sequence: index })),
    performance: { managerId: form.performanceManagerId },
    draftStep: currentStep.value, completedSteps: completedSteps.value,
  };
}

function scheduleAutosave() {
  if (hydrating.value || savingAction.value === 'submit' || !props.modelValue || !form.name.trim()) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  saveState.value = 'idle';
  autosaveTimer = setTimeout(() => { void persistDraft('auto'); }, 700);
}

async function persistDraft(saveMode: 'auto' | 'manual') {
  if (!form.name.trim()) return false;
  if (saveMode === 'auto' && savingAction.value === 'submit') return false;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  if (draftSavePromise) await draftSavePromise;
  if (saveMode === 'auto' && savingAction.value === 'submit') return false;
  saveState.value = 'saving';
  if (saveMode === 'manual') savingAction.value = 'draft';
  const save = (async () => {
    try {
      const request = await employeeArchivesApi.saveEmployeeCreateDraft({ ...requestBody(), saveMode });
      draftId.value = request.id;
      saveState.value = 'saved';
      return true;
    } catch {
      saveState.value = 'error';
      ElMessage.error('草稿保存失败，请检查网络后重试');
      return false;
    } finally {
      if (saveMode === 'manual') savingAction.value = null;
    }
  })();
  draftSavePromise = save;
  try {
    return await save;
  } finally {
    if (draftSavePromise === save) draftSavePromise = null;
  }
}

async function saveAndExit() {
  if (!form.name.trim()) {
    ElMessage.warning('填写姓名后即可保存草稿');
    return;
  }
  if (await persistDraft('manual')) {
    emit('saved');
    emit('update:modelValue', false);
  }
}

async function beforeClose(done: () => void) {
  if (!form.name.trim()) { done(); return; }
  if (await persistDraft('auto')) {
    emit('saved');
    done();
  }
}

function previousStep() {
  if (currentStep.value > 0) currentStep.value -= 1;
}

async function nextStep() {
  if (currentStep.value === 0 && !form.name.trim()) {
    ElMessage.warning('填写姓名后即可继续，其他信息可稍后补充');
    return;
  }
  if (!completedSteps.value.includes(currentStep.value)) completedSteps.value.push(currentStep.value);
  currentStep.value = Math.min(currentStep.value + 1, stepTitles.length - 1);
  await persistDraft('auto');
}

async function submit() {
  if (!form.name.trim() || !form.deptId || !form.entryDate || !form.effectiveFrom) {
    ElMessage.warning(`提交审核前请补充：${['姓名', ...missingForSubmit.value].join('、')}`);
    currentStep.value = form.name.trim() ? 1 : 0;
    return;
  }
  if ((form.phone.trim() || form.idNumber.trim()) && !canLookupIdentity()) {
    ElMessage.warning('手机号或身份证号需填写完整后再提交');
    currentStep.value = 0;
    return;
  }
  if (canLookupIdentity()) await lookupIdentity(true);
  if (hasBlockingIdentityMatch.value) {
    ElMessage.warning('已找到现有员工，请从匹配结果进入原档案处理');
    currentStep.value = 0;
    return;
  }
  if (identityResult.value?.outcome === 'phone_candidates' && !phoneDuplicateAcknowledged.value) {
    ElMessage.warning('请先确认手机号匹配结果');
    currentStep.value = 0;
    return;
  }
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  savingAction.value = 'submit';
  try {
    if (draftSavePromise && !(await draftSavePromise)) return;
    await employeeArchivesApi.createEmployee(requestBody() as EmployeeCreatePayload);
    ElMessage.success('已提交新增员工，工号已自动生成，HR 管理员审核后生效');
    emit('update:modelValue', false);
    emit('submitted');
  } finally {
    savingAction.value = null;
  }
}

function addContract() {
  form.contracts.push({
    __key: `new-${Date.now()}-${form.contracts.length}`, contractType: 'contract', name: '',
    signingCompany: '', signedAt: '', effectiveFrom: '', expiresAt: '', termType: '',
    originalCompany: '', newCompany: '', confidentialityAgreement: '', nonCompeteAgreement: '',
    portraitAgreement: '', images: [], attachments: [],
  });
}

async function uploadContractImage(contract: ContractDraft, options: UploadRequestOptions) {
  const file = options.file as File;
  if ((contract.images?.length ?? 0) >= 5) { ElMessage.warning('每份合同最多上传 5 张图片'); return; }
  if (file.size > 2 * 1024 * 1024) { ElMessage.warning('合同图片单张不能超过 2MB'); return; }
  const extension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && !['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
    ElMessage.warning('合同图片仅支持 JPG、PNG、WEBP'); return;
  }
  const uploaded = await uploadApi.upload(file, 'employee-contract-image');
  contract.images = [...(contract.images ?? []), uploaded];
  options.onSuccess(uploaded);
}

async function uploadContractAttachment(contract: ContractDraft, options: UploadRequestOptions) {
  const file = options.file as File;
  if ((contract.attachments?.length ?? 0) >= 10) { ElMessage.warning('每份合同最多上传 10 个附件'); return; }
  if (file.size > 10 * 1024 * 1024) { ElMessage.warning('合同附件单个不能超过 10MB'); return; }
  const allowed = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
  const extension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  if (!allowed.includes(file.type) && !['.pdf', '.doc', '.docx', '.xls', '.xlsx'].includes(extension)) {
    ElMessage.warning('合同附件仅支持 PDF、Word、Excel'); return;
  }
  const uploaded = await uploadApi.upload(file, 'employee-contract-attachment');
  contract.attachments = [...(contract.attachments ?? []), uploaded];
  options.onSuccess(uploaded);
}

async function openUploadedMaterial(item: { name: string; url: string; mimeType?: string }) {
  const blob = await uploadApi.download(item.url);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  if (item.mimeType?.startsWith('image/') || item.mimeType === 'application/pdf') {
    anchor.target = '_blank'; anchor.rel = 'noopener';
  } else anchor.download = item.name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

onMounted(async () => { positions.value = await positionsApi.findAll(); });
onBeforeUnmount(() => { if (autosaveTimer) clearTimeout(autosaveTimer); });
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    title="新增员工"
    size="min(960px, 100vw)"
    :close-on-click-modal="false"
    :before-close="beforeClose"
    destroy-on-close
    class="employee-create-drawer"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="wizard-shell">
      <div class="wizard-head">
        <el-steps :active="currentStep" align-center finish-status="success" class="desktop-steps">
          <el-step v-for="title in stepTitles" :key="title" :title="title" />
        </el-steps>
        <div class="mobile-step"><strong>{{ currentStep + 1 }}/{{ stepTitles.length }} {{ stepTitles[currentStep] }}</strong></div>
        <span class="save-state" :class="`save-state--${saveState}`">{{ saveStateLabel }}</span>
      </div>

      <el-form label-position="top" class="wizard-form">
        <section v-show="currentStep === 0" class="wizard-section">
          <div class="section-head"><div><h3>身份核验</h3><p>姓名即可建立草稿；手机号或身份证号填写完整后才查重。</p></div></div>
          <div class="identity-note">员工工号将在提交审核时自动生成</div>
          <div class="form-grid">
            <el-form-item label="姓名"><el-input v-model="form.name" maxlength="50" placeholder="必填，输入后自动保存" /></el-form-item>
            <el-form-item label="手机号"><el-input v-model="form.phone" maxlength="20" @blur="lookupIdentity()" /></el-form-item>
            <el-form-item :label="idNumberConfigured ? '身份证号（已保存，留空不变）' : '身份证号'"><el-input v-model="form.idNumber" maxlength="18" show-password @blur="lookupIdentity()" /></el-form-item>
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
        </section>

        <section v-show="currentStep === 1" class="wizard-section">
          <div class="section-head"><div><h3>任职信息</h3><p>选择岗位后自动带入岗位名称和职系；入职日期自动作为生效日期。</p></div></div>
          <div class="form-grid form-grid--3">
            <el-form-item label="所属公司"><el-select v-model="form.company"><el-option label="孚德" value="fuede" /><el-option label="孚德体育文化" value="fuede_sports" /><el-option label="北京孚德" value="beijing_fuede" /><el-option label="凡思堡" value="fansibao" /></el-select></el-form-item>
            <el-form-item label="部门"><el-tree-select v-model="form.deptId" :data="departments" node-key="id" :props="{ label: 'name', children: 'children' }" check-strictly filterable /></el-form-item>
            <el-form-item label="岗位"><el-select v-model="form.positionId" filterable clearable><el-option v-for="position in positions" :key="position.id" :label="position.jobFamily ? `${position.name}（${position.jobFamily}）` : position.name" :value="position.id" /></el-select></el-form-item>
            <el-form-item label="岗位名称"><el-input v-model="form.employee.position" placeholder="选择岗位后自动带入" /></el-form-item>
            <el-form-item label="职级"><el-input v-model="form.employee.jobGrade" /></el-form-item>
            <el-form-item label="职系"><el-input v-model="form.employee.jobFamily" placeholder="选择岗位后自动带入" /></el-form-item>
            <el-form-item label="工作地点"><el-input v-model="form.employee.workLocation" /></el-form-item>
            <el-form-item label="用工类型"><el-select v-model="form.employmentType"><el-option label="全职" value="full_time" /><el-option label="兼职" value="part_time" /><el-option label="返聘" value="rehire" /><el-option label="外部" value="external" /></el-select></el-form-item>
            <el-form-item label="员工状态"><el-select v-model="form.employeeStatus"><el-option label="试用期" value="probation" /><el-option label="在职" value="active" /></el-select></el-form-item>
            <el-form-item label="入职日期"><el-date-picker v-model="form.entryDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item label="本次记录生效日期"><el-date-picker v-model="form.effectiveFrom" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item label="本次记录结束日期"><el-date-picker v-model="form.effectiveTo" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item label="试用期（月）"><el-input-number v-model="form.employee.probationMonths" :min="0" :max="12" /></el-form-item>
            <el-form-item label="预计转正日期"><el-date-picker v-model="form.employee.plannedRegularDate" type="date" value-format="YYYY-MM-DD" @change="plannedRegularDateAuto = false" /></el-form-item>
            <el-form-item label="实际转正日期"><el-date-picker v-model="form.employee.actualRegularDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          </div>
        </section>

        <section v-show="currentStep === 2" class="wizard-section">
          <div class="section-head"><div><h3>管理关系</h3><p>两类关系用途不同，均可稍后补充并由 HR 审核。</p></div></div>
          <div class="form-grid">
            <el-form-item label="花名册直属主管"><UserSelect v-model="form.rosterManagerId" clearable eligible-for="direct_manager" /><small>仅作为档案中的汇报关系显示。</small></el-form-item>
            <el-form-item label="绩效直属上级"><UserSelect v-model="form.performanceManagerId" clearable eligible-for="direct_manager" /><small>用于绩效目标审核、评分和待办归属。</small></el-form-item>
          </div>
        </section>

        <section v-show="currentStep === 3" class="wizard-section">
          <div class="section-head"><div><h3>个人与教育</h3><p>非必填信息可先跳过，后续在草稿中继续补充。</p></div></div>
          <div class="form-grid form-grid--3">
            <el-form-item label="性别"><el-select v-model="form.profile.gender" clearable><el-option label="男" value="男" /><el-option label="女" value="女" /></el-select></el-form-item>
            <el-form-item label="出生日期"><el-date-picker v-model="form.profile.birthDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item label="民族"><el-input v-model="form.profile.ethnicity" /></el-form-item>
            <el-form-item label="学历"><el-input v-model="form.profile.education" /></el-form-item>
            <el-form-item label="职称"><el-input v-model="form.profile.professionalTitle" /></el-form-item>
            <el-form-item label="毕业院校"><el-input v-model="form.profile.school" /></el-form-item>
            <el-form-item label="毕业日期"><el-date-picker v-model="form.profile.graduationDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item label="专业"><el-input v-model="form.profile.major" /></el-form-item>
            <el-form-item label="婚姻状况"><el-input v-model="form.profile.maritalStatus" /></el-form-item>
            <el-form-item label="子女状况"><el-input v-model="form.profile.childrenStatus" /></el-form-item>
            <el-form-item label="子女数量"><el-input-number v-model="form.profile.childrenCount" :min="0" /></el-form-item>
            <el-form-item label="政治面貌"><el-input v-model="form.profile.politicalStatus" /></el-form-item>
            <el-form-item label="籍贯"><el-input v-model="form.profile.nativePlace" /></el-form-item>
            <el-form-item label="户籍类型"><el-input v-model="form.profile.householdType" /></el-form-item>
          </div>
        </section>

        <section v-show="currentStep === 4" class="wizard-section">
          <div class="section-head"><div><h3>联系与保障</h3><p>敏感号码加密保存；续填草稿时留空会保持原值。</p></div></div>
          <div class="form-grid form-grid--3">
            <el-form-item label="身份证地址" class="span-2"><el-input v-model="form.profile.idAddress" /></el-form-item>
            <el-form-item label="现住址" class="span-2"><el-input v-model="form.profile.currentAddress" /></el-form-item>
            <el-form-item label="紧急联系人"><el-input v-model="form.profile.emergencyContactName" /></el-form-item>
            <el-form-item label="与联系人关系"><el-input v-model="form.profile.emergencyContactRelation" /></el-form-item>
            <el-form-item label="紧急联系电话"><el-input v-model="form.profile.emergencyContactPhone" /></el-form-item>
            <el-form-item label="社保状态"><el-input v-model="form.profile.socialSecurityStatus" /></el-form-item>
            <el-form-item label="社保起始日期"><el-date-picker v-model="form.profile.socialSecurityStartDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item label="公积金状态"><el-input v-model="form.profile.housingFundStatus" /></el-form-item>
            <el-form-item label="公积金起始日期"><el-date-picker v-model="form.profile.housingFundStartDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item label="开户行"><el-input v-model="form.profile.bankName" /></el-form-item>
            <el-form-item label="开户支行"><el-input v-model="form.profile.bankBranch" /></el-form-item>
            <el-form-item :label="bankAccountConfigured ? '银行卡号（已保存，留空不变）' : '银行卡号'"><el-input v-model="form.profile.bankAccount" type="password" show-password /></el-form-item>
          </div>
        </section>

        <section v-show="currentStep === 5" class="wizard-section">
          <div class="section-head contract-toolbar"><div><h3>合同与附件</h3><p>合同可先不录入，后续从草稿继续补充。</p></div><el-button :icon="Plus" @click="addContract">新增合同</el-button></div>
          <div v-for="(contract, index) in form.contracts" :key="contract.__key" class="contract-card">
            <div class="contract-card__head"><strong>合同 {{ index + 1 }}</strong><el-button link type="danger" :icon="Delete" @click="form.contracts.splice(index, 1)">移除</el-button></div>
            <div class="form-grid form-grid--3">
              <el-form-item label="类型"><el-select v-model="contract.contractType"><el-option label="劳动合同" value="contract" /><el-option label="续签" value="renewal" /><el-option label="转签" value="transfer" /></el-select></el-form-item>
              <el-form-item label="合同名称"><el-input v-model="contract.name" /></el-form-item>
              <el-form-item label="签约公司"><el-input v-model="contract.signingCompany" /></el-form-item>
              <el-form-item label="签订日期"><el-date-picker v-model="contract.signedAt" type="date" value-format="YYYY-MM-DD" /></el-form-item>
              <el-form-item label="生效日期"><el-date-picker v-model="contract.effectiveFrom" type="date" value-format="YYYY-MM-DD" /></el-form-item>
              <el-form-item label="到期日期"><el-date-picker v-model="contract.expiresAt" type="date" value-format="YYYY-MM-DD" /></el-form-item>
              <el-form-item label="期限"><el-input v-model="contract.termType" /></el-form-item>
              <el-form-item label="原公司"><el-input v-model="contract.originalCompany" /></el-form-item>
              <el-form-item label="新公司"><el-input v-model="contract.newCompany" /></el-form-item>
              <el-form-item label="保密协议"><el-input v-model="contract.confidentialityAgreement" /></el-form-item>
              <el-form-item label="竞业协议"><el-input v-model="contract.nonCompeteAgreement" /></el-form-item>
              <el-form-item label="肖像协议"><el-input v-model="contract.portraitAgreement" /></el-form-item>
            </div>
            <div class="contract-materials">
              <div class="material-group"><strong>合同图片</strong><small>最多 5 张，单张不超过 2MB</small><el-upload :show-file-list="false" accept="image/jpeg,image/png,image/webp" :http-request="(options: UploadRequestOptions) => uploadContractImage(contract, options)"><el-button>上传图片</el-button></el-upload><div v-for="(item, itemIndex) in contract.images" :key="item.url" class="material-item"><el-button link type="primary" @click="openUploadedMaterial(item)">{{ item.name }}</el-button><el-button link type="danger" @click="contract.images.splice(itemIndex, 1)">移除</el-button></div></div>
              <div class="material-group"><strong>合同附件</strong><small>最多 10 个，单个不超过 10MB</small><el-upload :show-file-list="false" accept=".pdf,.doc,.docx,.xls,.xlsx" :http-request="(options: UploadRequestOptions) => uploadContractAttachment(contract, options)"><el-button>上传附件</el-button></el-upload><div v-for="(item, itemIndex) in contract.attachments" :key="item.url" class="material-item"><el-button link type="primary" @click="openUploadedMaterial(item)">{{ item.name }}</el-button><el-button link type="danger" @click="contract.attachments.splice(itemIndex, 1)">移除</el-button></div></div>
            </div>
          </div>
          <el-empty v-if="!form.contracts.length" description="暂无合同，可直接下一步" :image-size="72" />
        </section>

        <section v-show="currentStep === 6" class="wizard-section">
          <div class="section-head"><div><h3>预览提交</h3><p>提交后进入 HR 审核；审核通过前不会写入正式员工档案。</p></div></div>
          <el-alert v-if="missingForSubmit.length" :title="`提交前还需补充：${missingForSubmit.join('、')}`" type="warning" :closable="false" show-icon />
          <dl class="preview-grid">
            <div><dt>姓名</dt><dd>{{ form.name || '未填写' }}</dd></div><div><dt>手机号</dt><dd>{{ form.phone || '未填写' }}</dd></div>
            <div><dt>部门</dt><dd>{{ selectedDepartment?.fullPath || selectedDepartment?.name || '未填写' }}</dd></div><div><dt>岗位</dt><dd>{{ selectedPosition?.name || form.employee.position || '未填写' }}</dd></div>
            <div><dt>入职日期</dt><dd>{{ form.entryDate || '未填写' }}</dd></div><div><dt>生效日期</dt><dd>{{ form.effectiveFrom || '未填写' }}</dd></div>
            <div><dt>花名册直属主管</dt><dd>{{ form.rosterManagerId ? '已设置' : '未设置' }}</dd></div><div><dt>绩效直属上级</dt><dd>{{ form.performanceManagerId ? '已设置' : '未设置' }}</dd></div>
            <div><dt>合同</dt><dd>{{ form.contracts.length }} 份</dd></div><div><dt>工号</dt><dd>审核通过后使用系统生成的新工号</dd></div>
          </dl>
        </section>
      </el-form>
    </div>

    <template #footer>
      <div class="drawer-footer">
        <el-button v-if="currentStep > 0" @click="previousStep">上一步</el-button>
        <span class="footer-spacer" />
        <el-button :loading="savingAction === 'draft'" :disabled="savingAction === 'submit'" @click="saveAndExit">保存并退出</el-button>
        <el-button v-if="currentStep < stepTitles.length - 1" type="primary" @click="nextStep">下一步</el-button>
        <el-button v-else type="primary" :loading="savingAction === 'submit'" :disabled="savingAction === 'draft'" @click="submit">提交审核</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.wizard-shell { display: grid; gap: 18px; min-height: 560px; }
.wizard-head { position: sticky; top: -20px; z-index: 3; padding: 14px 0 12px; background: #fff; border-bottom: 1px solid #eef1f6; }
.desktop-steps { padding: 0 8px; }
.mobile-step { display: none; }
.save-state { display: block; margin-top: 8px; color: #98a2b3; font-size: 12px; text-align: right; }
.save-state--saving { color: #667085; }.save-state--saved { color: #16a34a; }.save-state--error { color: #dc2626; }
.wizard-section { padding: 2px 2px 20px; }
.section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.section-head h3 { margin: 0 0 5px; font-size: 20px; }.section-head p { margin: 0; color: #667085; font-size: 13px; }
.identity-note { margin-bottom: 16px; padding: 10px 12px; color: #475467; background: #f8fafc; border-radius: 7px; font-size: 13px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
.form-grid--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.form-grid :deep(.el-select), .form-grid :deep(.el-date-editor), .form-grid :deep(.el-input-number), .form-grid :deep(.el-tree-select) { width: 100%; }
.form-grid small { display: block; margin-top: 5px; color: #98a2b3; line-height: 1.4; }
.span-2 { grid-column: span 2; }
.identity-result { margin: 2px 0 8px; padding: 12px; border: 1px solid #dbe7ff; border-radius: 7px; color: #344054; background: #f7faff; font-size: 13px; }
.identity-result--danger { color: #b42318; border-color: #fecdca; background: #fffbfa; }.identity-result--success { color: #067647; border-color: #abefc6; background: #f6fef9; }
.identity-candidate { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 8px 0; }
.contract-card { margin-top: 14px; padding: 16px; border: 1px solid #dfe5ee; border-radius: 12px; background: #f8fafc; }
.contract-card__head, .contract-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; }.contract-card__head { margin-bottom: 10px; }
.contract-materials { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }.material-group { display: grid; gap: 8px; padding: 12px; border: 1px dashed #cfd7e6; border-radius: 9px; background: #fff; }.material-group small { color: #667085; }
.material-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 7px; background: #f2f4f7; border-radius: 6px; }
.preview-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 16px 0 0; border: 1px solid #e5eaf2; border-radius: 10px; overflow: hidden; }
.preview-grid > div { padding: 14px 16px; border-right: 1px solid #eef1f6; border-bottom: 1px solid #eef1f6; }.preview-grid dt { color: #667085; font-size: 12px; }.preview-grid dd { margin: 5px 0 0; color: #101828; font-weight: 600; }
.drawer-footer { display: flex; align-items: center; width: 100%; }.footer-spacer { flex: 1; }
@media (max-width: 760px) {
  .wizard-shell { min-height: 0; }.desktop-steps { display: none; }.mobile-step { display: block; }.wizard-head { top: -12px; padding-top: 8px; }
  .form-grid, .form-grid--3, .preview-grid, .contract-materials { grid-template-columns: 1fr; }.span-2 { grid-column: auto; }
  .identity-candidate, .section-head, .contract-toolbar { align-items: flex-start; flex-direction: column; }.drawer-footer { flex-wrap: wrap; gap: 8px; }.drawer-footer .el-button { margin-left: 0; }
}
</style>
