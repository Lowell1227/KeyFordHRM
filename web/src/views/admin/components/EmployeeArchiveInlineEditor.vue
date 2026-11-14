<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { isAxiosError } from 'axios';
import { Delete, Plus, QuestionFilled, RefreshLeft, RefreshRight } from '@element-plus/icons-vue';
import { ElMessage, type UploadRequestOptions } from 'element-plus';
import type { Department } from '@/types/api.types';
import { employeeArchivesApi, type EmployeeArchive, type EmployeeDataReview } from '@/api/employee-archives.api';
import UserSelect from '@/components/common/UserSelect.vue';
import ContractSubjectSelect from '@/components/common/ContractSubjectSelect.vue';
import ContractDateInput from '@/components/common/ContractDateInput.vue';
import EmployeeCompanySelect from '@/components/common/EmployeeCompanySelect.vue';
import PersonnelReferenceSelect from '@/components/common/PersonnelReferenceSelect.vue';
import { uploadApi } from '@/api/upload.api';
import { positionsApi, type PositionRecord } from '@/api/positions.api';
import { archiveFieldPath } from '@/utils/employee-archive-fields';
import { contractTitle } from '@/utils/employee-contract-presentation';
import { validateContractDates } from '@/utils/employee-contract-validation';
import { useContractUploads } from '@/utils/employee-contract-uploads';

const props = defineProps<{
  editing: boolean;
  archive: EmployeeArchive | null;
  draft?: EmployeeDataReview | null;
  departments: Department[];
  busy?: boolean;
  focusField?: string;
}>();

type ArchiveChangePayload = {
  draftId?: string;
  expectedVersion?: number;
  baseVersion?: string;
  employee: Record<string, unknown>;
  profile: Record<string, unknown>;
  contracts: Record<string, unknown>[];
  performance: Record<string, unknown>;
};

const emit = defineEmits<{
  submit: [value: ArchiveChangePayload];
  saved: [value: EmployeeDataReview];
  busy: [value: boolean];
  state: [value: 'idle' | 'saving' | 'saved' | 'error'];
  blocked: [value: boolean];
  reload: [];
}>();
const positions = ref<PositionRecord[]>([]);
const fallbackEmployment = computed(() => props.archive && !props.archive.currentEmployment && !props.archive.pendingEmployment
  ? props.archive.employmentHistory[0] : null);
const editorElement = ref<HTMLElement>();
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
const saveError = ref('');
const saveBlocked = ref(false);
const failedAction = ref<'save' | 'submit'>('save');
const companyError = ref('');
const serverContractErrors = reactive<Record<string, string>>({});
const serverFieldErrors = reactive<Record<string, string>>({});
const serverFieldSnapshots: Record<string, string | undefined> = {};
watch(saveState, value => emit('state', value));
let draftId: string | undefined;
let draftVersion: number | undefined;
let generation = 0;
let hydrating = false;
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
let savePromise: Promise<boolean> | undefined;
let submittedContractKeys: string[] = [];

const form = reactive({
  employee: {} as Record<string, any>,
  profile: {} as Record<string, any>,
  contracts: [] as Array<Record<string, any> & { __key: string }>,
  performance: {} as Record<string, any>,
});
const positionOptions = computed(() => positions.value.filter(position => position.isActive || position.id === form.employee.positionId));
function changePosition(id?: string | null) {
  const position = positions.value.find(item => item.id === id);
  form.employee.positionId = id || null;
  form.employee.position = position?.name ?? null;
  form.employee.jobFamily = position?.jobFamily ?? null;
}
function fieldSnapshot(path: string) {
  if (path === 'employee.companyText') return JSON.stringify([form.employee.company, form.employee.companyText, form.employee.contractSubjectId]);
  if (path === 'employee.positionId') return JSON.stringify([form.employee.positionId, form.employee.position]);
  const [scope, field] = path.split('.');
  return JSON.stringify(form[scope as 'employee' | 'profile' | 'performance']?.[field ?? '']);
}
const contractUploads = useContractUploads(contract => props.editing && form.contracts.some(item => item === contract && !item.__removed));
const uploadBlocked = contractUploads.blocked;
watch([saveBlocked, uploadBlocked], ([save, upload]) => emit('blocked', save || upload));
const contractErrors = computed(() => ({ ...serverContractErrors, ...Object.fromEntries(form.contracts.flatMap((contract, index) => {
  if (contract.__removed) return [];
  const previous = props.archive?.employeeContracts.find(item => item.id === contract.id);
  return Object.entries(validateContractDates(contract, previous ? { ...previous } : undefined)).map(([key, error]) => [`contracts.${index}.${key}`, error]);
})) }));
let initialSnapshot = '';

function formSnapshot() {
  return JSON.stringify(form);
}

function dateValue(value?: string | null) {
  return value ? value.slice(0, 10) : null;
}

function replaceRecord(target: Record<string, any>, value: Record<string, any>) {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, value);
}

function reset() {
  contractUploads.clear();
  submittedContractKeys = [];
  Object.keys(serverContractErrors).forEach(key => delete serverContractErrors[key]);
  Object.keys(serverFieldErrors).forEach(key => delete serverFieldErrors[key]);
  Object.keys(serverFieldSnapshots).forEach(key => delete serverFieldSnapshots[key]);
  generation++;
  const archive = props.archive;
  if (!archive) return;
  hydrating = true;
  clearTimeout(autosaveTimer);
  draftId = props.draft?.id;
  draftVersion = props.draft?.requestVersion;
  saveState.value = props.draft ? 'saved' : 'idle';
  saveError.value = '';
  saveBlocked.value = false;
  companyError.value = '';
  const employment = archive.pendingEmployment ?? archive.currentEmployment ?? archive.employmentHistory[0];
  replaceRecord(form.employee, {
    name: archive.name,
    employeeNo: archive.employeeNo,
    phone: archive.employeeProfile?.phone ?? archive.phone ?? null,
    company: employment?.company ?? null,
    companyText: employment?.companyText ?? null,
    contractSubjectId: employment?.contractSubjectId ?? undefined,
    deptId: archive.dept?.id ?? employment?.deptId ?? null,
    positionId: archive.positionId ?? employment?.positionId ?? null,
    position: archive.position ?? employment?.position ?? null,
    jobGrade: employment?.jobGrade ?? null,
    jobFamily: employment?.jobFamily ?? null,
    managerId: employment?.directManagerId ?? archive.rosterManager?.id ?? null,
    workLocation: employment?.workLocation ?? null,
    employmentType: archive.employmentType ?? employment?.employmentType ?? 'full_time',
    employeeStatus: archive.status,
    entryDate: dateValue(archive.entryDate ?? employment?.entryDate),
    plannedRegularDate: dateValue(archive.plannedRegularDate ?? employment?.plannedRegularDate),
    actualRegularDate: dateValue(archive.actualRegularDate ?? employment?.actualRegularDate),
    leaveDate: dateValue(archive.leaveDate ?? employment?.leaveDate),
    probationMonths: employment?.probationMonths ?? null,
  });
  replaceRecord(form.performance, { managerId: archive.performanceManager?.id ?? null });
  const profile = archive.employeeProfile;
  replaceRecord(form.profile, {
    phone: profile?.phone ?? archive.phone ?? null,
    gender: profile?.gender ?? null,
    birthDate: dateValue(profile?.birthDate),
    ethnicity: profile?.ethnicity ?? null,
    education: profile?.education ?? null,
    professionalTitle: profile?.professionalTitle ?? null,
    school: profile?.school ?? null,
    graduationDate: dateValue(profile?.graduationDate),
    major: profile?.major ?? null,
    maritalStatus: profile?.maritalStatus ?? null,
    childrenStatus: profile?.childrenStatus ?? null,
    childrenCount: profile?.childrenCount ?? null,
    politicalStatus: profile?.politicalStatus ?? null,
    nativePlace: profile?.nativePlace ?? null,
    householdType: profile?.householdType ?? null,
    idAddress: profile?.idAddress ?? null,
    idNumber: '',
    currentAddress: profile?.currentAddress ?? null,
    emergencyContactName: profile?.emergencyContactName ?? null,
    emergencyContactRelation: profile?.emergencyContactRelation ?? null,
    emergencyContactPhone: profile?.emergencyContactPhone ?? null,
    socialSecurityStatus: profile?.socialSecurityStatus ?? null,
    socialSecurityStartDate: dateValue(profile?.socialSecurityStartDate),
    housingFundStatus: profile?.housingFundStatus ?? null,
    housingFundStartDate: dateValue(profile?.housingFundStartDate),
    bankName: profile?.bankName ?? null,
    bankBranch: profile?.bankBranch ?? null,
    bankAccount: '',
  });
  form.contracts = archive.employeeContracts
    .filter((item) => item.isActive !== false)
    .map((item, index) => ({
      __key: item.id || `existing-${index}`,
      id: item.id,
      contractType: item.contractType,
      sequence: item.sequence,
      name: item.name,
      signingCompany: item.signingCompany,
      contractSubjectId: item.contractSubjectId ?? undefined,
      signedAt: dateValue(item.signedAt),
      effectiveFrom: dateValue(item.effectiveFrom),
      expiresAt: dateValue(item.expiresAt),
      termType: item.termType,
      originalCompany: item.originalCompany,
      newCompany: item.newCompany,
      confidentialityAgreement: item.confidentialityAgreement,
      nonCompeteAgreement: item.nonCompeteAgreement,
      portraitAgreement: item.portraitAgreement,
      images: [...(item.images ?? [])],
      attachments: [...(item.attachments ?? [])],
    }));
  if (props.draft?.userId === archive.id && (props.draft.recordStatus === 'draft' || props.draft.canResume)) {
    const proposed = props.draft.proposedValue ?? {};
    // A partially applied legacy request contains an old snapshot of the applied scope.
    // Keep the current formal values (and persisted contract IDs) for that scope.
    const restoreProfile = props.draft.profileReviewStatus !== 'approved';
    if (restoreProfile) replaceRecord(form.employee, { ...form.employee, ...(proposed.employee ?? {}) });
    if (form.employee.contractSubjectId == null && !employment?.contractSubjectId) form.employee.contractSubjectId = undefined;
    if (restoreProfile) replaceRecord(form.profile, { ...form.profile, ...(proposed.profile ?? {}) });
    if (props.draft.performanceReviewStatus !== 'approved') replaceRecord(form.performance, { ...form.performance, ...(proposed.performance ?? {}) });
    if (restoreProfile && Array.isArray(proposed.contracts)) {
      form.contracts = proposed.contracts.map((item: Record<string, any>, index: number) => ({
        ...item,
        ...(!('contractSubjectId' in item) && item.id ? { contractSubjectId: archive.employeeContracts.find(contract => contract.id === item.id)?.contractSubjectId ?? undefined } : {}),
        ...(item.contractSubjectId == null && !archive.employeeContracts.find(contract => contract.id === item.id)?.contractSubjectId ? { contractSubjectId: undefined } : {}),
        __key: item.id || `draft-${index}`,
      }));
    }
  }
  initialSnapshot = '';
  const session = generation;
  void nextTick(() => {
    if (session !== generation || !props.editing) return;
    // Controls can normalize stored numeric values while mounting; that is not an edit.
    initialSnapshot = formSnapshot();
    hydrating = false;
    void focusField(props.focusField);
  });
}

watch(() => [props.editing, props.archive?.id] as const, ([editing]) => {
  if (editing) reset();
  else { generation++; contractUploads.clear(); clearTimeout(autosaveTimer); }
}, { immediate: true });
watch(() => props.focusField, field => { if (props.editing) void focusField(field); });
watch(form, () => {
  Object.keys(serverContractErrors).forEach(key => delete serverContractErrors[key]);
  for (const path of Object.keys(serverFieldErrors)) {
    if (fieldSnapshot(path) !== serverFieldSnapshots[path]) {
      delete serverFieldErrors[path];
      delete serverFieldSnapshots[path];
    }
  }
  if (!hydrating && props.editing && !props.busy && !saveBlocked.value) scheduleAutosave();
}, { deep: true, flush: 'sync' });
onBeforeUnmount(() => { generation++; contractUploads.clear(); clearTimeout(autosaveTimer); });
onMounted(async () => { positions.value = await positionsApi.findAll({ includeInactive: true }); });

function addContract() {
  form.contracts.push({
    __key: `new-${Date.now()}-${form.contracts.length}`,
    contractType: 'contract',
    sequence: form.contracts.length,
    name: '',
    signingCompany: '',
    signedAt: null,
    effectiveFrom: null,
    expiresAt: null,
    termType: '',
    originalCompany: '',
    newCompany: '',
    confidentialityAgreement: '',
    nonCompeteAgreement: '',
    portraitAgreement: '',
    images: [],
    attachments: [],
  });
}

function removeContract(contract: typeof form.contracts[number]) {
  contractUploads.cancelContract(contract);
  if (contract.id) contract.__removed = true;
  else form.contracts.splice(form.contracts.indexOf(contract), 1);
}

function restoreContract(contract: typeof form.contracts[number]) {
  delete contract.__removed;
}

function uploadContractImage(contract: Record<string, any>, options: UploadRequestOptions) {
  return contractUploads.start(contract, 'images', options.file);
}

function uploadContractAttachment(contract: Record<string, any>, options: UploadRequestOptions) {
  return contractUploads.start(contract, 'attachments', options.file);
}

async function openUploadedMaterial(item: { name: string; url: string; mimeType?: string }) {
  const blob = await uploadApi.download(item.url);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  if (item.mimeType?.startsWith('image/') || item.mimeType === 'application/pdf') {
    anchor.target = '_blank';
    anchor.rel = 'noopener';
  } else {
    anchor.download = item.name;
  }
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function changePayload(): ArchiveChangePayload {
  const employee: Record<string, unknown> = { ...form.employee, phone: form.profile.phone || null,
    positionId: form.employee.positionId ?? null, managerId: form.employee.managerId ?? null };
  if (unchangedMissingCompany()) delete employee.company;
  return {
    draftId,
    expectedVersion: draftId ? draftVersion : undefined,
    baseVersion: props.archive?.archiveVersion,
    employee,
    profile: { ...form.profile, phone: form.profile.phone || null, gender: form.profile.gender ?? null },
    contracts: form.contracts.filter(item => !item.__removed).map(({ __key, __removed, ...item }, index) => ({ ...item, sequence: index })),
    performance: { ...form.performance, managerId: form.performance.managerId ?? null },
  };
}

function unchangedMissingCompany() {
  const archive = props.archive;
  const employment = archive?.pendingEmployment ?? archive?.currentEmployment ?? archive?.employmentHistory[0];
  return !employment?.company && form.employee.company == null
    && (form.employee.contractSubjectId ?? null) === (employment?.contractSubjectId ?? null)
    && (form.employee.companyText ?? null) === (employment?.companyText ?? null);
}

async function submit() {
  clearTimeout(autosaveTimer);
  const session = generation;
  if (savePromise && !await savePromise) return;
  if (session !== generation || !props.editing || props.busy || saveBlocked.value) return;
  if (uploadBlocked.value) {
    ElMessage.warning(contractUploads.message.value);
    await focusField('contracts');
    return;
  }
  const invalidField = Object.keys(serverFieldErrors)[0];
  if (invalidField) {
    await focusField(invalidField);
    return;
  }
  const invalidContractField = Object.keys(contractErrors.value)[0];
  if (invalidContractField) {
    await focusField(invalidContractField);
    return;
  }
  if (!isDirty() && !draftId) {
    ElMessage.info('未检测到变更，无需提交');
    return;
  }
  if (!form.employee.company && !unchangedMissingCompany()) {
    companyError.value = '请选择已配置内部公司映射的所属公司';
    await focusField('employee.companyText');
    return;
  }
  submittedContractKeys = form.contracts.filter(item => !item.__removed).map(item => item.__key);
  emit('submit', changePayload());
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  if (!isDirty()) return;
  saveState.value = 'idle';
  autosaveTimer = setTimeout(() => { void saveDraft(); }, 700);
}

async function saveDraft(): Promise<boolean> {
  clearTimeout(autosaveTimer);
  const session = generation;
  while (savePromise) {
    if (!await savePromise) return false;
    if (session !== generation || !props.editing || props.busy || saveBlocked.value) return false;
  }
  if (session !== generation || !props.editing || props.busy || saveBlocked.value) return false;
  if (!isDirty()) return true;
  const snapshot = formSnapshot(), payload = changePayload(), userId = props.archive!.id;
  saveState.value = 'saving';
  saveError.value = '';
  emit('busy', true);
  const promise = (async () => {
    try {
      const result = await employeeArchivesApi.saveArchiveDraft(userId, payload);
      if (session !== generation || !props.editing) return false;
      if (result == null) {
        // 与当前档案一致，无可保存内容：视为保存成功并保持当前编辑状态，避免误报“草稿保存失败”。
        initialSnapshot = snapshot;
        saveState.value = 'idle';
        return true;
      }
      draftId = result.id;
      draftVersion = result.requestVersion;
      initialSnapshot = snapshot;
      saveState.value = 'saved';
      emit('saved', result);
      return true;
    } catch (error) {
      if (session !== generation) return false;
      showWriteError(error);
      return false;
    } finally {
      if (session === generation) emit('busy', false);
    }
  })();
  savePromise = promise;
  const succeeded = await promise;
  if (savePromise === promise) savePromise = undefined;
  if (succeeded && session === generation && isDirty()) return saveDraft();
  return succeeded;
}

function showWriteError(error: unknown, submitting = false) {
  clearTimeout(autosaveTimer);
  failedAction.value = submitting ? 'submit' : 'save';
  saveState.value = 'error';
  const status = isAxiosError(error) ? error.response?.status : undefined;
  saveBlocked.value = status === 409;
  const message = isAxiosError(error) ? error.response?.data?.message : '';
  const fields = isAxiosError(error) ? error.response?.data?.data?.fieldErrors : undefined;
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    const keys = submitting ? submittedContractKeys : form.contracts.filter(item => !item.__removed).map(item => item.__key);
    let firstField: string | undefined;
    for (const [path, value] of Object.entries(fields)) {
      if (typeof value !== 'string') continue;
      const normalized = archiveFieldPath(path === 'employee.phone' ? 'profile.phone' : path);
      const [scope, field, extra] = normalized.split('.');
      if (['employee', 'profile', 'performance'].includes(scope ?? '') && field && !extra
        && Object.prototype.hasOwnProperty.call(form[scope as 'employee' | 'profile' | 'performance'], field)) {
        serverFieldErrors[normalized] = value;
        serverFieldSnapshots[normalized] = fieldSnapshot(normalized);
        firstField ??= normalized;
        continue;
      }
      const match = /^contracts\.(\d+)(\.[a-zA-Z]+)?$/.exec(path);
      if (!match) continue;
      const index = form.contracts.findIndex(item => item.__key === keys[Number(match[1])]);
      if (index >= 0) {
        const target = `contracts.${index}${match[2] ?? ''}`;
        serverContractErrors[target] = value;
        firstField ??= target;
      }
    }
    void focusField(firstField);
  }
  const detail = Array.isArray(message) ? message.filter(item => typeof item === 'string').join('；') : message;
  saveError.value = saveBlocked.value
    ? (typeof message === 'string' && message.includes('已有待核草稿或待审申请')
      ? '已有未完成的档案变更，本次输入已保留。请加载原记录后继续。'
      : '档案或草稿已更新，本次输入已保留。请加载最新记录后核对。')
    : status === 403 ? '没有修改该档案的权限，请联系管理员。本次输入已保留。'
    : status === 400 && typeof detail === 'string' && detail ? `${detail}。本次输入已保留。`
    : submitting ? '提交未完成，输入已保留，请重试提交。' : '草稿保存失败，输入已保留，请重试保存。';
}

function showReloadError() {
  saveError.value = '最新记录暂时读取失败，输入已保留，请重试加载。';
}

async function focusField(field?: string) {
  await nextTick();
  const root = editorElement.value;
  if (!root || !field) return;
  root.querySelectorAll('.archive-field--focused').forEach(item => item.classList.remove('archive-field--focused'));
  const path = archiveFieldPath(field);
  const normalized = ['employee.company', 'employee.contractSubjectId'].includes(path) ? 'employee.companyText' : path;
  const target = root.querySelector<HTMLElement>(`[data-archive-field="${CSS.escape(normalized)}"]`)
    ?? (normalized.startsWith('contracts') ? root.querySelector<HTMLElement>('[data-archive-section="contracts"]') : null);
  if (!target) return;
  target.classList.add('archive-field--focused');
  target.scrollIntoView({ block: 'center' });
  const input = target.querySelector<HTMLElement>('input:not(:disabled),textarea:not(:disabled),button:not(:disabled)');
  if (input) input.focus({ preventScroll: true });
  else { target.tabIndex = -1; target.focus({ preventScroll: true }); }
}

function isDirty() {
  return Boolean(initialSnapshot) && formSnapshot() !== initialSnapshot;
}

defineExpose({ submit, saveDraft, reset, isDirty, focusField, showWriteError, showReloadError,
  pauseAutosave: () => clearTimeout(autosaveTimer), resumeAutosave: scheduleAutosave });
</script>

<template>
  <div v-if="editing" ref="editorElement" class="archive-inline-editor" :inert="busy" :aria-busy="busy">
    <div v-if="saveError" class="archive-save-error" :class="{ 'archive-save-error--conflict': saveBlocked }" role="alert">
      <span>{{ saveError }}</span>
      <el-button v-if="saveBlocked" link type="primary" @click="emit('reload')">重新加载</el-button>
      <el-button v-else-if="failedAction === 'submit'" link type="primary" @click="submit">重试提交</el-button>
      <el-button v-else link type="primary" @click="saveDraft">重试保存</el-button>
    </div>
    <nav class="archive-editor-nav" aria-label="档案分区"><el-button v-for="section in [{ id: 'employment', label: '基本与任职' }, { id: 'personal', label: '个人与教育' }, { id: 'contact', label: '联系与保障' }, { id: 'contracts', label: '合同记录' }]" :key="section.id" link @click="editorElement?.querySelector(`[data-archive-section='${section.id}']`)?.scrollIntoView({ block: 'start' })">{{ section.label }}</el-button></nav>
    <section class="editor-section" data-archive-section="employment">
      <div class="editor-section__head">
        <div><h3>基本与任职</h3><span>员工身份、当前组织和绩效关系</span></div>
      </div>
      <div v-if="fallbackEmployment" class="employment-baseline-note">
        <span>当前无有效任职，以下任职资料沿用最近一次记录（生效日期：{{ dateValue(fallbackEmployment.effectiveFrom) || '待完善' }}）</span>
        <el-tooltip content="该记录可能尚未生效或已经结束，编辑仅沿用其资料作为基准。提交会更新档案资料；入离职仍需单独办理。" placement="top">
          <el-icon tabindex="0" aria-label="任职资料来源说明"><QuestionFilled /></el-icon>
        </el-tooltip>
      </div>
      <el-form label-position="top" class="archive-editor-grid">
        <el-form-item label="姓名" data-archive-field="employee.name" :error="serverFieldErrors['employee.name']"><el-input v-model="form.employee.name" /></el-form-item>
        <el-form-item label="当前工号" data-archive-field="employee.employeeNo" :error="serverFieldErrors['employee.employeeNo']"><el-input v-model="form.employee.employeeNo" disabled /><small class="field-help">工号由系统生成；历史任职工号在档案中保留，不在此处修改。</small></el-form-item>
        <el-form-item label="所属公司" data-archive-field="employee.companyText" :error="companyError || serverFieldErrors['employee.companyText']"><EmployeeCompanySelect v-model="form.employee.contractSubjectId" v-model:snapshot-name="form.employee.companyText" v-model:company="form.employee.company" @update:company="companyError = ''" /></el-form-item>
        <el-form-item label="所属部门" data-archive-field="employee.deptId" :error="serverFieldErrors['employee.deptId']"><el-tree-select v-model="form.employee.deptId" :data="departments" node-key="id" :props="{ label: 'name', children: 'children' }" check-strictly filterable /></el-form-item>
        <el-form-item label="岗位" data-archive-field="employee.positionId" :error="serverFieldErrors['employee.positionId']"><el-select v-model="form.employee.positionId" filterable clearable @change="changePosition"><el-option v-for="position in positionOptions" :key="position.id" :label="position.jobFamily ? `${position.name}（${position.jobFamily}）` : position.name" :value="position.id" :disabled="!position.isActive" /></el-select></el-form-item>
        <el-form-item v-if="!form.employee.positionId" label="岗位名称" data-archive-field="employee.position" :error="serverFieldErrors['employee.position']"><el-input v-model="form.employee.position" /></el-form-item>
        <el-form-item label="职级" data-archive-field="employee.jobGrade" :error="serverFieldErrors['employee.jobGrade']"><PersonnelReferenceSelect v-model="form.employee.jobGrade" kind="job_grade" /></el-form-item>
        <el-form-item label="职系" data-archive-field="employee.jobFamily" :error="serverFieldErrors['employee.jobFamily']">
          <template v-if="form.employee.positionId"><el-input :model-value="form.employee.jobFamily" readonly placeholder="未设置" /><small class="field-help">随岗位只读，特殊情况请先维护岗位目录；历史已存值保留。</small></template>
          <PersonnelReferenceSelect v-else v-model="form.employee.jobFamily" kind="job_family" label="职系" />
        </el-form-item>
        <el-form-item label="花名册直属主管" data-archive-field="employee.managerId" :error="serverFieldErrors['employee.managerId']"><UserSelect v-model="form.employee.managerId" :disabled-ids="archive ? [archive.id] : []" /></el-form-item>
        <el-form-item label="绩效直属上级" data-archive-field="performance.managerId" :error="serverFieldErrors['performance.managerId']"><UserSelect v-model="form.performance.managerId" eligible-for="direct_manager" :disabled-ids="archive ? [archive.id] : []" /></el-form-item>
          <el-form-item label="工作地点" data-archive-field="employee.workLocation" :error="serverFieldErrors['employee.workLocation']"><PersonnelReferenceSelect v-model="form.employee.workLocation" kind="work_location" label="工作地点" /></el-form-item>
        <el-form-item label="用工类型" data-archive-field="employee.employmentType" :error="serverFieldErrors['employee.employmentType']"><el-select v-model="form.employee.employmentType"><el-option label="全职" value="full_time" /><el-option label="兼职" value="part_time" /><el-option label="返聘" value="rehire" /><el-option label="外部" value="external" /></el-select></el-form-item>
        <el-form-item data-archive-field="employee.employeeStatus" :error="serverFieldErrors['employee.employeeStatus']"><template #label>当前状态 <el-tooltip content="入职、再入职和离职请在入离职页面办理；这里可调整在职与试用期状态。" placement="top"><el-icon aria-label="任职状态说明"><QuestionFilled /></el-icon></el-tooltip></template><el-select v-model="form.employee.employeeStatus" :disabled="!['active', 'probation'].includes(archive?.status ?? '')"><template v-if="['active', 'probation'].includes(archive?.status ?? '')"><el-option label="在职" value="active" /><el-option label="试用期" value="probation" /></template><el-option v-else-if="archive?.status === 'resigned'" label="已离职" value="resigned" /><el-option v-else label="待入职" value="pending_entry" /></el-select></el-form-item>
        <el-form-item label="入职日期" data-archive-field="employee.entryDate" :error="serverFieldErrors['employee.entryDate']"><el-date-picker v-model="form.employee.entryDate" type="date" value-format="YYYY-MM-DD" :disabled="archive?.status === 'pending_entry'" /><small v-if="archive?.status === 'pending_entry'" class="field-help">待到岗员工请在入离职申请中修改到岗日期。</small></el-form-item>
        <el-form-item label="试用期（月）" data-archive-field="employee.probationMonths" :error="serverFieldErrors['employee.probationMonths']"><el-input-number v-model="form.employee.probationMonths" :min="0" :max="12" /></el-form-item>
        <el-form-item label="预计转正日期" data-archive-field="employee.plannedRegularDate" :error="serverFieldErrors['employee.plannedRegularDate']"><el-date-picker v-model="form.employee.plannedRegularDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="实际转正日期" data-archive-field="employee.actualRegularDate" :error="serverFieldErrors['employee.actualRegularDate']"><el-date-picker v-model="form.employee.actualRegularDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="离职日期" data-archive-field="employee.leaveDate" :error="serverFieldErrors['employee.leaveDate']"><el-date-picker v-model="form.employee.leaveDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
      </el-form>
    </section>

    <section class="editor-section" data-archive-section="personal">
      <div class="editor-section__head"><div><h3>个人与教育</h3><span>基础身份和教育经历</span></div></div>
      <el-form label-position="top" class="archive-editor-grid">
        <el-form-item label="手机号" data-archive-field="profile.phone" :error="serverFieldErrors['profile.phone']"><el-input v-model="form.profile.phone" /></el-form-item>
        <el-form-item label="性别" data-archive-field="profile.gender" :error="serverFieldErrors['profile.gender']"><el-select v-model="form.profile.gender" clearable><el-option label="男" value="男" /><el-option label="女" value="女" /></el-select></el-form-item>
        <el-form-item label="出生日期" data-archive-field="profile.birthDate" :error="serverFieldErrors['profile.birthDate']"><el-date-picker v-model="form.profile.birthDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="民族" data-archive-field="profile.ethnicity" :error="serverFieldErrors['profile.ethnicity']"><el-input v-model="form.profile.ethnicity" /></el-form-item>
        <el-form-item label="学历" data-archive-field="profile.education" :error="serverFieldErrors['profile.education']"><PersonnelReferenceSelect v-model="form.profile.education" kind="education" /></el-form-item>
        <el-form-item label="职称" data-archive-field="profile.professionalTitle" :error="serverFieldErrors['profile.professionalTitle']"><el-input v-model="form.profile.professionalTitle" /></el-form-item>
        <el-form-item label="毕业院校" data-archive-field="profile.school" :error="serverFieldErrors['profile.school']"><el-input v-model="form.profile.school" /></el-form-item>
        <el-form-item label="毕业日期" data-archive-field="profile.graduationDate" :error="serverFieldErrors['profile.graduationDate']"><el-date-picker v-model="form.profile.graduationDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="专业" data-archive-field="profile.major" :error="serverFieldErrors['profile.major']"><el-input v-model="form.profile.major" /></el-form-item>
        <el-form-item label="婚姻状况" data-archive-field="profile.maritalStatus" :error="serverFieldErrors['profile.maritalStatus']"><PersonnelReferenceSelect v-model="form.profile.maritalStatus" kind="marital_status" /></el-form-item>
        <el-form-item label="子女状况" data-archive-field="profile.childrenStatus" :error="serverFieldErrors['profile.childrenStatus']"><el-input v-model="form.profile.childrenStatus" /></el-form-item>
        <el-form-item label="子女数量" data-archive-field="profile.childrenCount" :error="serverFieldErrors['profile.childrenCount']"><el-input-number v-model="form.profile.childrenCount" :min="0" /></el-form-item>
        <el-form-item label="政治面貌" data-archive-field="profile.politicalStatus" :error="serverFieldErrors['profile.politicalStatus']"><PersonnelReferenceSelect v-model="form.profile.politicalStatus" kind="political_status" /></el-form-item>
        <el-form-item label="籍贯" data-archive-field="profile.nativePlace" :error="serverFieldErrors['profile.nativePlace']"><el-input v-model="form.profile.nativePlace" /></el-form-item>
        <el-form-item label="户籍类型" data-archive-field="profile.householdType" :error="serverFieldErrors['profile.householdType']"><PersonnelReferenceSelect v-model="form.profile.householdType" kind="household_type" /></el-form-item>
      </el-form>
    </section>

    <section class="editor-section" data-archive-section="contact">
      <div class="editor-section__head"><div><h3>联系与保障</h3><span>敏感号码留空表示保持原值</span></div></div>
      <el-form label-position="top" class="archive-editor-grid">
        <el-form-item label="身份证地址" data-archive-field="profile.idAddress" :error="serverFieldErrors['profile.idAddress']" class="span-2"><el-input v-model="form.profile.idAddress" /></el-form-item>
        <el-form-item data-archive-field="profile.idNumber" :error="serverFieldErrors['profile.idNumber']" :label="form.profile.idNumberConfigured || archive?.employeeProfile?.idNumberConfigured ? '身份证号（已保存，留空不变）' : '身份证号'"><el-input v-model="form.profile.idNumber" type="password" show-password /></el-form-item>
        <el-form-item label="现住址" data-archive-field="profile.currentAddress" :error="serverFieldErrors['profile.currentAddress']" class="span-2"><el-input v-model="form.profile.currentAddress" /></el-form-item>
        <el-form-item label="紧急联系人" data-archive-field="profile.emergencyContactName" :error="serverFieldErrors['profile.emergencyContactName']"><el-input v-model="form.profile.emergencyContactName" /></el-form-item>
        <el-form-item label="与联系人关系" data-archive-field="profile.emergencyContactRelation" :error="serverFieldErrors['profile.emergencyContactRelation']"><PersonnelReferenceSelect v-model="form.profile.emergencyContactRelation" kind="contact_relation" /></el-form-item>
        <el-form-item label="紧急联系电话" data-archive-field="profile.emergencyContactPhone" :error="serverFieldErrors['profile.emergencyContactPhone']"><el-input v-model="form.profile.emergencyContactPhone" /></el-form-item>
        <el-form-item label="社保状态" data-archive-field="profile.socialSecurityStatus" :error="serverFieldErrors['profile.socialSecurityStatus']"><el-input v-model="form.profile.socialSecurityStatus" /></el-form-item>
        <el-form-item label="社保起始日期" data-archive-field="profile.socialSecurityStartDate" :error="serverFieldErrors['profile.socialSecurityStartDate']"><el-date-picker v-model="form.profile.socialSecurityStartDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="公积金状态" data-archive-field="profile.housingFundStatus" :error="serverFieldErrors['profile.housingFundStatus']"><el-input v-model="form.profile.housingFundStatus" /></el-form-item>
        <el-form-item label="公积金起始日期" data-archive-field="profile.housingFundStartDate" :error="serverFieldErrors['profile.housingFundStartDate']"><el-date-picker v-model="form.profile.housingFundStartDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="开户行" data-archive-field="profile.bankName" :error="serverFieldErrors['profile.bankName']"><PersonnelReferenceSelect v-model="form.profile.bankName" kind="bank_name" /></el-form-item>
        <el-form-item label="开户支行" data-archive-field="profile.bankBranch" :error="serverFieldErrors['profile.bankBranch']"><el-input v-model="form.profile.bankBranch" /></el-form-item>
        <el-form-item data-archive-field="profile.bankAccount" :error="serverFieldErrors['profile.bankAccount']" :label="form.profile.bankAccountConfigured || archive?.employeeProfile?.bankAccountConfigured ? '银行卡号（已保存，留空不变）' : '银行卡号'"><el-input v-model="form.profile.bankAccount" type="password" show-password /></el-form-item>
      </el-form>
    </section>

    <section class="editor-section" data-archive-section="contracts">
      <div class="editor-section__head contract-toolbar">
        <div><h3>合同记录</h3><span>支持新增、修改和移除；提交后生效</span></div>
        <el-button :icon="Plus" @click="addContract">新增合同</el-button>
      </div>
      <p v-if="uploadBlocked" class="contract-upload-error" role="status">{{ contractUploads.message.value }}</p>
      <div v-for="(contract, index) in form.contracts" :key="contract.__key" class="contract-card">
        <div class="contract-card__head">
          <strong>{{ contractTitle(contract) }}</strong>
          <span v-if="contract.__removed" class="contract-removal"><el-tag type="warning" size="small">待移除</el-tag><el-button link :icon="RefreshLeft" @click="restoreContract(contract)">撤销移除</el-button></span>
          <el-button v-else link type="danger" :icon="Delete" @click="removeContract(contract)">移除</el-button>
        </div>
        <p v-if="contractErrors[`contracts.${index}`]" :data-archive-field="`contracts.${index}`" class="contract-upload-error" role="alert">{{ contractErrors[`contracts.${index}`] }}</p>
        <el-form v-if="!contract.__removed" label-position="top" class="archive-editor-grid">
          <el-form-item label="类型" :data-archive-field="`contracts.${index}.contractType`" :error="contractErrors[`contracts.${index}.contractType`]"><el-select v-model="contract.contractType"><el-option label="首签" value="contract" /><el-option label="续签" value="renewal" /><el-option label="转签" value="transfer" /><el-option v-if="contract.contractType && !['contract', 'renewal', 'transfer'].includes(contract.contractType)" :label="contract.contractType" :value="contract.contractType" /></el-select></el-form-item>
          <el-form-item label="合同名称" :data-archive-field="`contracts.${index}.name`" :error="contractErrors[`contracts.${index}.name`]"><PersonnelReferenceSelect v-model="contract.name" kind="contract_name" /></el-form-item>
          <el-form-item label="签约公司" :data-archive-field="`contracts.${index}.signingCompany`"><ContractSubjectSelect v-model="contract.contractSubjectId" v-model:snapshot-name="contract.signingCompany" /></el-form-item>
          <el-form-item label="签订日期" :data-archive-field="`contracts.${index}.signedAt`" :error="contractErrors[`contracts.${index}.signedAt`]"><ContractDateInput v-model="contract.signedAt" /></el-form-item>
          <el-form-item label="生效日期" :data-archive-field="`contracts.${index}.effectiveFrom`" :error="contractErrors[`contracts.${index}.effectiveFrom`]"><ContractDateInput v-model="contract.effectiveFrom" /></el-form-item>
          <el-form-item label="到期日期" :data-archive-field="`contracts.${index}.expiresAt`" :error="contractErrors[`contracts.${index}.expiresAt`]"><ContractDateInput v-model="contract.expiresAt" /></el-form-item>
          <el-form-item label="期限" :data-archive-field="`contracts.${index}.termType`"><el-input v-model="contract.termType" /></el-form-item>
          <el-form-item v-if="contract.contractType === 'transfer' || contract.originalCompany" label="原公司" :data-archive-field="`contracts.${index}.originalCompany`"><ContractSubjectSelect v-model:snapshot-name="contract.originalCompany" name-only /></el-form-item>
          <el-form-item v-if="contract.contractType === 'transfer' || contract.newCompany" label="新公司" :data-archive-field="`contracts.${index}.newCompany`"><ContractSubjectSelect v-model:snapshot-name="contract.newCompany" name-only /></el-form-item>
          <el-form-item label="保密协议" :data-archive-field="`contracts.${index}.confidentialityAgreement`"><el-input v-model="contract.confidentialityAgreement" /></el-form-item>
          <el-form-item label="竞业协议" :data-archive-field="`contracts.${index}.nonCompeteAgreement`"><el-input v-model="contract.nonCompeteAgreement" /></el-form-item>
          <el-form-item label="肖像协议" :data-archive-field="`contracts.${index}.portraitAgreement`"><el-input v-model="contract.portraitAgreement" /></el-form-item>
        </el-form>
        <div v-if="!contract.__removed" class="contract-materials">
          <div class="contract-materials__group">
            <div><strong>合同图片</strong><span>最多 5 张，JPG/PNG/WEBP，单张不超过 2MB</span></div>
            <el-upload :disabled="contractUploads.count(contract, 'images') >= 5" :show-file-list="false" accept="image/jpeg,image/png,image/webp" :http-request="(options: UploadRequestOptions) => uploadContractImage(contract, options)">
              <el-button :disabled="contractUploads.count(contract, 'images') >= 5">上传图片</el-button>
            </el-upload>
            <div v-if="contract.images?.length" class="material-list">
              <div v-for="(item, itemIndex) in contract.images" :key="`${item.url}-${itemIndex}`" class="material-item">
                <el-button link type="primary" @click="openUploadedMaterial(item)">{{ item.name }}</el-button><small>{{ Math.ceil(item.size / 1024) }}KB</small>
                <el-button link type="danger" @click="contract.images.splice(itemIndex, 1)">移除</el-button>
              </div>
            </div>
          </div>
          <div class="contract-materials__group">
            <div><strong>合同附件</strong><span>最多 10 个，PDF/Word/Excel，单个不超过 10MB</span></div>
            <el-upload :disabled="contractUploads.count(contract, 'attachments') >= 10" :show-file-list="false" accept=".pdf,.doc,.docx,.xls,.xlsx" :http-request="(options: UploadRequestOptions) => uploadContractAttachment(contract, options)">
              <el-button :disabled="contractUploads.count(contract, 'attachments') >= 10">上传附件</el-button>
            </el-upload>
            <div v-if="contract.attachments?.length" class="material-list">
              <div v-for="(item, itemIndex) in contract.attachments" :key="`${item.url}-${itemIndex}`" class="material-item">
                <el-button link type="primary" @click="openUploadedMaterial(item)">{{ item.name }}</el-button><small>{{ Math.ceil(item.size / 1024) }}KB</small>
                <el-button link type="danger" @click="contract.attachments.splice(itemIndex, 1)">移除</el-button>
              </div>
            </div>
          </div>
        </div>
        <div v-for="task in contractUploads.forContract(contract)" :key="task.id" class="contract-upload-task" role="status">
          <span>{{ task.file.name }}</span><small :class="{ 'contract-upload-error': task.status === 'failed' }">{{ task.status === 'uploading' ? '上传中' : task.error }}</small>
          <el-button v-if="task.status === 'failed'" link type="primary" :icon="RefreshRight" @click="contractUploads.retry(task)">重试</el-button>
          <el-button link type="danger" :icon="Delete" @click="contractUploads.remove(task)">移除</el-button>
        </div>
      </div>
      <el-empty v-if="!form.contracts.length" description="暂无合同，可点击新增合同" :image-size="72" />
    </section>
  </div>
</template>

<style scoped>
.archive-save-error { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; color: var(--el-color-danger); font-size: 13px; line-height: 1.6; }
.archive-save-error--conflict { color: var(--el-text-color-regular); }
.archive-editor-nav { display: flex; gap: 16px; flex-wrap: wrap; padding: 6px 0; }
.editor-section { scroll-margin-top: 12px; }
.archive-field--focused { outline: 2px solid var(--el-color-primary-light-5); outline-offset: 5px; border-radius: 4px; }

.archive-inline-editor { display: grid; gap: 18px; }
.editor-section { padding: 18px; border: 1px solid #e5eaf2; border-radius: 14px; background: #fff; }
.editor-section__head, .contract-card__head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.editor-section__head { margin-bottom: 14px; }
.editor-section__head h3 { margin: 0 0 4px; font-size: 16px; }
.editor-section__head span { color: #667085; font-size: 13px; }
.employment-baseline-note { display: flex; align-items: center; gap: 6px; margin-bottom: 14px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }
.archive-editor-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 18px; }
.archive-editor-grid :deep(.el-form-item__error) { position: static; flex-basis: 100%; line-height: 1.5; }
.archive-editor-grid :deep(.el-select), .archive-editor-grid :deep(.el-date-editor), .archive-editor-grid :deep(.el-input-number) { width: 100%; }
.span-2 { grid-column: span 2; }
.contract-card { margin-top: 14px; padding: 16px; border: 1px solid #dfe5ee; border-radius: 12px; background: #f8fafc; }
.contract-card__head { margin-bottom: 8px; }
.contract-card__head strong { min-width: 0; overflow-wrap: anywhere; }
.contract-card__head > .el-button, .contract-removal { flex-shrink: 0; }
.contract-removal, .contract-upload-task { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.contract-upload-task { margin-top: 8px; font-size: 13px; }
.contract-upload-task > span { min-width: 0; overflow-wrap: anywhere; }
.contract-upload-task small { color: var(--el-text-color-secondary); }
.contract-upload-error, .contract-upload-task .contract-upload-error { color: var(--el-color-danger); font-size: 12px; }
.contract-materials { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 8px; }
.contract-materials__group { display: grid; gap: 10px; padding: 14px; border: 1px dashed #cfd7e6; border-radius: 10px; background: #fff; }
.contract-materials__group > div:first-child { display: grid; gap: 3px; }
.contract-materials__group span { color: #667085; font-size: 12px; }
.material-list { display: grid; gap: 6px; }
.material-item { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-radius: 7px; background: #f2f4f7; }
.material-item .el-button { min-width: 0; max-width: 100%; flex: 1; justify-content: flex-start; overflow: hidden; margin-left: 0; }
.material-item .el-button :deep(span) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.material-item small { color: #98a2b3; }
@media (max-width: 760px) {
  .editor-section { padding: 14px; }
  .archive-editor-grid { grid-template-columns: 1fr; }
  .contract-materials { grid-template-columns: 1fr; }
  .span-2 { grid-column: auto; }
  .editor-section__head { align-items: flex-start; flex-direction: column; }
}
</style>
