<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { isAxiosError } from 'axios';
import { Delete, Plus } from '@element-plus/icons-vue';
import { ElMessage, type UploadRequestOptions } from 'element-plus';
import type { Department } from '@/types/api.types';
import { employeeArchivesApi, type EmployeeArchive, type EmployeeDataReview } from '@/api/employee-archives.api';
import UserSelect from '@/components/common/UserSelect.vue';
import ContractSubjectSelect from '@/components/common/ContractSubjectSelect.vue';
import PersonnelReferenceSelect from '@/components/common/PersonnelReferenceSelect.vue';
import { uploadApi } from '@/api/upload.api';
import { positionsApi, type PositionRecord } from '@/api/positions.api';
import { archiveFieldPath } from '@/utils/employee-archive-fields';

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
}>();
const positions = ref<PositionRecord[]>([]);
const editorElement = ref<HTMLElement>();
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
const saveError = ref('');
const saveBlocked = ref(false);
watch(saveState, value => emit('state', value));
let draftId: string | undefined;
let draftVersion: number | undefined;
let generation = 0;
let hydrating = false;
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
let savePromise: Promise<boolean> | undefined;

const form = reactive({
  employee: {} as Record<string, any>,
  profile: {} as Record<string, any>,
  contracts: [] as Array<Record<string, any> & { __key: string }>,
  performance: {} as Record<string, any>,
});
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
  const archive = props.archive;
  if (!archive) return;
  hydrating = true;
  generation++;
  clearTimeout(autosaveTimer);
  draftId = props.draft?.id;
  draftVersion = props.draft?.requestVersion;
  saveState.value = props.draft ? 'saved' : 'idle';
  saveError.value = '';
  saveBlocked.value = false;
  const employment = archive.currentEmployment ?? archive.employmentHistory[0];
  replaceRecord(form.employee, {
    name: archive.name,
    employeeNo: archive.employeeNo,
    phone: archive.employeeProfile?.phone ?? null,
    company: employment?.company ?? archive.dept?.company ?? 'fuede',
    companyText: employment?.companyText ?? null,
    contractSubjectId: employment?.contractSubjectId ?? undefined,
    deptId: archive.dept?.id ?? null,
    positionId: employment?.positionId ?? null,
    position: archive.position,
    jobGrade: employment?.jobGrade ?? null,
    jobFamily: employment?.jobFamily ?? null,
    managerId: archive.rosterManager?.id ?? null,
    workLocation: employment?.workLocation ?? null,
    employmentType: employment?.employmentType ?? 'full_time',
    employeeStatus: archive.status,
    entryDate: dateValue(archive.entryDate),
    plannedRegularDate: dateValue(employment?.plannedRegularDate),
    actualRegularDate: dateValue(employment?.actualRegularDate),
    leaveDate: dateValue(employment?.leaveDate),
    probationMonths: employment?.probationMonths ?? null,
  });
  replaceRecord(form.performance, { managerId: archive.performanceManager?.id ?? null });
  const profile = archive.employeeProfile;
  replaceRecord(form.profile, {
    phone: profile?.phone ?? null,
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
    replaceRecord(form.employee, { ...form.employee, ...(proposed.employee ?? {}) });
    if (form.employee.contractSubjectId == null && !employment?.contractSubjectId) form.employee.contractSubjectId = undefined;
    replaceRecord(form.profile, { ...form.profile, ...(proposed.profile ?? {}) });
    replaceRecord(form.performance, { ...form.performance, ...(proposed.performance ?? {}) });
    if (Array.isArray(proposed.contracts)) {
      form.contracts = proposed.contracts.map((item: Record<string, any>, index: number) => ({
        ...item,
        ...(!('contractSubjectId' in item) && item.id ? { contractSubjectId: archive.employeeContracts.find(contract => contract.id === item.id)?.contractSubjectId ?? undefined } : {}),
        ...(item.contractSubjectId == null && !archive.employeeContracts.find(contract => contract.id === item.id)?.contractSubjectId ? { contractSubjectId: undefined } : {}),
        __key: item.id || `draft-${index}`,
      }));
    }
  }
  initialSnapshot = formSnapshot();
  void nextTick(() => { hydrating = false; void focusField(props.focusField); });
}

watch(() => [props.editing, props.archive?.id] as const, ([editing]) => {
  if (editing) reset();
  else { generation++; clearTimeout(autosaveTimer); }
}, { immediate: true });
watch(() => props.focusField, field => { if (props.editing) void focusField(field); });
watch(form, () => { if (!hydrating && props.editing && !props.busy && !saveBlocked.value) scheduleAutosave(); }, { deep: true, flush: 'sync' });
onBeforeUnmount(() => { generation++; clearTimeout(autosaveTimer); });
onMounted(async () => { positions.value = await positionsApi.findAll(); });

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

async function uploadContractImage(contract: Record<string, any>, options: UploadRequestOptions) {
  const file = options.file as File;
  if ((contract.images?.length ?? 0) >= 5) {
    ElMessage.warning('每份合同最多上传 5 张图片');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    ElMessage.warning('合同图片单张不能超过 2MB');
    return;
  }
  const imageExtension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    && !['.jpg', '.jpeg', '.png', '.webp'].includes(imageExtension)) {
    ElMessage.warning('合同图片仅支持 JPG、PNG、WEBP');
    return;
  }
  const uploaded = await uploadApi.upload(file, 'employee-contract-image');
  contract.images = [...(contract.images ?? []), uploaded];
  options.onSuccess(uploaded);
}

async function uploadContractAttachment(contract: Record<string, any>, options: UploadRequestOptions) {
  const file = options.file as File;
  if ((contract.attachments?.length ?? 0) >= 10) {
    ElMessage.warning('每份合同最多上传 10 个附件');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    ElMessage.warning('合同附件单个不能超过 10MB');
    return;
  }
  const allowed = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
  const attachmentExtension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  if (!allowed.includes(file.type) && !['.pdf', '.doc', '.docx', '.xls', '.xlsx'].includes(attachmentExtension)) {
    ElMessage.warning('合同附件仅支持 PDF、DOC、DOCX、XLS、XLSX');
    return;
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
    anchor.target = '_blank';
    anchor.rel = 'noopener';
  } else {
    anchor.download = item.name;
  }
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function changePayload(): ArchiveChangePayload {
  return {
    draftId,
    expectedVersion: draftId ? draftVersion : undefined,
    baseVersion: props.archive?.archiveVersion,
    employee: { ...form.employee, phone: form.profile.phone || null },
    profile: { ...form.profile },
    contracts: form.contracts.map(({ __key, ...item }, index) => ({ ...item, sequence: index })),
    performance: { ...form.performance },
  };
}

async function submit() {
  clearTimeout(autosaveTimer);
  const session = generation;
  if (savePromise && !await savePromise) return;
  if (session !== generation || !props.editing || props.busy || saveBlocked.value) return;
  if (!isDirty() && !draftId) {
    ElMessage.info('未检测到变更，无需提交审核');
    return;
  }
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
      saveState.value = 'error';
      saveBlocked.value = isAxiosError(error) && error.response?.status === 409;
      saveError.value = saveBlocked.value
        ? '资料已更新，本次输入已保留。请先留存本次修改，关闭后重新打开最新草稿核对，避免覆盖其他人的修改。'
        : '草稿保存失败，输入已保留。请重试保存。';
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

async function focusField(field?: string) {
  await nextTick();
  const root = editorElement.value;
  if (!root || !field) return;
  root.querySelectorAll('.archive-field--focused').forEach(item => item.classList.remove('archive-field--focused'));
  const normalized = archiveFieldPath(field);
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

defineExpose({ submit, saveDraft, reset, isDirty, focusField,
  pauseAutosave: () => clearTimeout(autosaveTimer), resumeAutosave: scheduleAutosave });
</script>

<template>
  <div v-if="editing" ref="editorElement" class="archive-inline-editor">
    <div class="archive-save-state" role="status" aria-live="polite">{{ saveState === 'saving' ? '正在保存草稿…' : saveState === 'saved' ? '草稿已保存，尚未提交审核' : saveState === 'error' ? '草稿尚未保存' : '修改后自动保存草稿' }}</div>
    <div v-if="saveError" class="archive-save-error" role="alert">{{ saveError }}<el-button v-if="!saveBlocked" link type="primary" @click="saveDraft">重试保存</el-button></div>
    <nav class="archive-editor-nav" aria-label="档案分区"><el-button v-for="section in [{ id: 'employment', label: '基本与任职' }, { id: 'personal', label: '个人与教育' }, { id: 'contact', label: '联系与保障' }, { id: 'contracts', label: '合同记录' }]" :key="section.id" link @click="editorElement?.querySelector(`[data-archive-section='${section.id}']`)?.scrollIntoView({ block: 'start' })">{{ section.label }}</el-button></nav>
    <el-alert
      title="保存草稿不会进入审核；只有点击提交审核后，才会进入人事办理的待我审核。"
      type="info"
      show-icon
      :closable="false"
    />

    <section class="editor-section" data-archive-section="employment">
      <div class="editor-section__head">
        <div><h3>基本与任职</h3><span>员工身份、当前组织和绩效关系</span></div>
      </div>
      <el-form label-position="top" class="archive-editor-grid">
        <el-form-item label="姓名" data-archive-field="employee.name"><el-input v-model="form.employee.name" /></el-form-item>
        <el-form-item label="当前工号" data-archive-field="employee.employeeNo"><el-input v-model="form.employee.employeeNo" disabled /><small class="field-help">工号由系统生成；历史任职工号在档案中保留，不在此处修改。</small></el-form-item>
        <el-form-item label="所属公司（合同主体）" data-archive-field="employee.companyText"><ContractSubjectSelect v-model="form.employee.contractSubjectId" v-model:snapshot-name="form.employee.companyText" /></el-form-item>
        <el-form-item label="组织归属" data-archive-field="employee.company">
          <el-select v-model="form.employee.company"><el-option label="孚德" value="fuede" /><el-option label="孚德体育文化" value="fuede_sports" /><el-option label="北京孚德" value="beijing_fuede" /><el-option label="凡思堡" value="fansibao" /></el-select>
        </el-form-item>
        <el-form-item label="所属部门" data-archive-field="employee.deptId"><el-tree-select v-model="form.employee.deptId" :data="departments" node-key="id" :props="{ label: 'name', children: 'children' }" check-strictly filterable /></el-form-item>
        <el-form-item label="岗位" data-archive-field="employee.positionId"><el-select v-model="form.employee.positionId" filterable clearable><el-option v-for="position in positions" :key="position.id" :label="position.jobFamily ? `${position.name}（${position.jobFamily}）` : position.name" :value="position.id" /></el-select></el-form-item>
        <el-form-item label="职级" data-archive-field="employee.jobGrade"><el-input v-model="form.employee.jobGrade" /></el-form-item>
          <el-form-item label="职系" data-archive-field="employee.jobFamily"><PersonnelReferenceSelect v-model="form.employee.jobFamily" kind="job_family" label="职系" /></el-form-item>
        <el-form-item label="花名册直属主管" data-archive-field="employee.managerId"><UserSelect v-model="form.employee.managerId" :disabled-ids="archive ? [archive.id] : []" /></el-form-item>
        <el-form-item label="绩效直属上级" data-archive-field="performance.managerId"><UserSelect v-model="form.performance.managerId" :disabled-ids="archive ? [archive.id] : []" /></el-form-item>
          <el-form-item label="工作地点" data-archive-field="employee.workLocation"><PersonnelReferenceSelect v-model="form.employee.workLocation" kind="work_location" label="工作地点" /></el-form-item>
        <el-form-item label="用工类型" data-archive-field="employee.employmentType"><el-select v-model="form.employee.employmentType"><el-option label="全职" value="full_time" /><el-option label="兼职" value="part_time" /><el-option label="返聘" value="rehire" /><el-option label="外部" value="external" /></el-select></el-form-item>
        <el-form-item label="当前状态" data-archive-field="employee.employeeStatus"><el-select v-model="form.employee.employeeStatus"><el-option label="在职" value="active" /><el-option label="试用期" value="probation" /><el-option label="已离职" value="resigned" /></el-select></el-form-item>
        <el-form-item label="入职日期" data-archive-field="employee.entryDate"><el-date-picker v-model="form.employee.entryDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="试用期（月）" data-archive-field="employee.probationMonths"><el-input-number v-model="form.employee.probationMonths" :min="0" :max="12" /></el-form-item>
        <el-form-item label="预计转正日期" data-archive-field="employee.plannedRegularDate"><el-date-picker v-model="form.employee.plannedRegularDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="实际转正日期" data-archive-field="employee.actualRegularDate"><el-date-picker v-model="form.employee.actualRegularDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="离职日期" data-archive-field="employee.leaveDate"><el-date-picker v-model="form.employee.leaveDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
      </el-form>
    </section>

    <section class="editor-section" data-archive-section="personal">
      <div class="editor-section__head"><div><h3>个人与教育</h3><span>基础身份和教育经历</span></div></div>
      <el-form label-position="top" class="archive-editor-grid">
        <el-form-item label="手机号" data-archive-field="profile.phone"><el-input v-model="form.profile.phone" /></el-form-item>
        <el-form-item label="性别" data-archive-field="profile.gender"><el-select v-model="form.profile.gender" clearable><el-option label="男" value="男" /><el-option label="女" value="女" /></el-select></el-form-item>
        <el-form-item label="出生日期" data-archive-field="profile.birthDate"><el-date-picker v-model="form.profile.birthDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="民族" data-archive-field="profile.ethnicity"><el-input v-model="form.profile.ethnicity" /></el-form-item>
        <el-form-item label="学历" data-archive-field="profile.education"><el-input v-model="form.profile.education" /></el-form-item>
        <el-form-item label="职称" data-archive-field="profile.professionalTitle"><el-input v-model="form.profile.professionalTitle" /></el-form-item>
        <el-form-item label="毕业院校" data-archive-field="profile.school"><el-input v-model="form.profile.school" /></el-form-item>
        <el-form-item label="毕业日期" data-archive-field="profile.graduationDate"><el-date-picker v-model="form.profile.graduationDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="专业" data-archive-field="profile.major"><el-input v-model="form.profile.major" /></el-form-item>
        <el-form-item label="婚姻状况" data-archive-field="profile.maritalStatus"><el-input v-model="form.profile.maritalStatus" /></el-form-item>
        <el-form-item label="子女状况"><el-input v-model="form.profile.childrenStatus" /></el-form-item>
        <el-form-item label="子女数量"><el-input-number v-model="form.profile.childrenCount" :min="0" /></el-form-item>
        <el-form-item label="政治面貌" data-archive-field="profile.politicalStatus"><el-input v-model="form.profile.politicalStatus" /></el-form-item>
        <el-form-item label="籍贯" data-archive-field="profile.nativePlace"><el-input v-model="form.profile.nativePlace" /></el-form-item>
        <el-form-item label="户籍类型" data-archive-field="profile.householdType"><el-input v-model="form.profile.householdType" /></el-form-item>
      </el-form>
    </section>

    <section class="editor-section" data-archive-section="contact">
      <div class="editor-section__head"><div><h3>联系与保障</h3><span>敏感号码留空表示保持原值</span></div></div>
      <el-form label-position="top" class="archive-editor-grid">
        <el-form-item label="身份证地址" data-archive-field="profile.idAddress" class="span-2"><el-input v-model="form.profile.idAddress" /></el-form-item>
        <el-form-item data-archive-field="profile.idNumber" :label="form.profile.idNumberConfigured || archive?.employeeProfile?.idNumberConfigured ? '身份证号（已保存，留空不变）' : '身份证号'"><el-input v-model="form.profile.idNumber" type="password" show-password /></el-form-item>
        <el-form-item label="现住址" data-archive-field="profile.currentAddress" class="span-2"><el-input v-model="form.profile.currentAddress" /></el-form-item>
        <el-form-item label="紧急联系人" data-archive-field="profile.emergencyContactName"><el-input v-model="form.profile.emergencyContactName" /></el-form-item>
        <el-form-item label="与联系人关系" data-archive-field="profile.emergencyContactRelation"><el-input v-model="form.profile.emergencyContactRelation" /></el-form-item>
        <el-form-item label="紧急联系电话" data-archive-field="profile.emergencyContactPhone"><el-input v-model="form.profile.emergencyContactPhone" /></el-form-item>
        <el-form-item label="社保状态" data-archive-field="profile.socialSecurityStatus"><el-input v-model="form.profile.socialSecurityStatus" /></el-form-item>
        <el-form-item label="社保起始日期" data-archive-field="profile.socialSecurityStartDate"><el-date-picker v-model="form.profile.socialSecurityStartDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="公积金状态" data-archive-field="profile.housingFundStatus"><el-input v-model="form.profile.housingFundStatus" /></el-form-item>
        <el-form-item label="公积金起始日期" data-archive-field="profile.housingFundStartDate"><el-date-picker v-model="form.profile.housingFundStartDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="开户行" data-archive-field="profile.bankName"><el-input v-model="form.profile.bankName" /></el-form-item>
        <el-form-item label="开户支行" data-archive-field="profile.bankBranch"><el-input v-model="form.profile.bankBranch" /></el-form-item>
        <el-form-item data-archive-field="profile.bankAccount" :label="form.profile.bankAccountConfigured || archive?.employeeProfile?.bankAccountConfigured ? '银行卡号（已保存，留空不变）' : '银行卡号'"><el-input v-model="form.profile.bankAccount" type="password" show-password /></el-form-item>
      </el-form>
    </section>

    <section class="editor-section" data-archive-section="contracts">
      <div class="editor-section__head contract-toolbar">
        <div><h3>合同记录</h3><span>支持新增、修改和移除；审核通过后统一生效</span></div>
        <el-button :icon="Plus" @click="addContract">新增合同</el-button>
      </div>
      <div v-for="(contract, index) in form.contracts" :key="contract.__key" class="contract-card">
        <div class="contract-card__head"><strong>合同 {{ index + 1 }}</strong><el-button link type="danger" :icon="Delete" @click="form.contracts.splice(index, 1)">移除</el-button></div>
        <el-form label-position="top" class="archive-editor-grid">
          <el-form-item label="类型" :data-archive-field="`contracts.${index}.contractType`"><el-select v-model="contract.contractType"><el-option label="劳动合同" value="contract" /><el-option label="续签" value="renewal" /><el-option label="转签" value="transfer" /></el-select></el-form-item>
          <el-form-item label="合同名称" :data-archive-field="`contracts.${index}.name`"><el-input v-model="contract.name" /></el-form-item>
          <el-form-item label="签约公司" :data-archive-field="`contracts.${index}.signingCompany`"><ContractSubjectSelect v-model="contract.contractSubjectId" v-model:snapshot-name="contract.signingCompany" /></el-form-item>
          <el-form-item label="签订日期" :data-archive-field="`contracts.${index}.signedAt`"><el-date-picker v-model="contract.signedAt" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="生效日期" :data-archive-field="`contracts.${index}.effectiveFrom`"><el-date-picker v-model="contract.effectiveFrom" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="到期日期" :data-archive-field="`contracts.${index}.expiresAt`"><el-date-picker v-model="contract.expiresAt" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="期限" :data-archive-field="`contracts.${index}.termType`"><el-input v-model="contract.termType" /></el-form-item>
          <el-form-item label="原公司" :data-archive-field="`contracts.${index}.originalCompany`"><el-input v-model="contract.originalCompany" /></el-form-item>
          <el-form-item label="新公司" :data-archive-field="`contracts.${index}.newCompany`"><el-input v-model="contract.newCompany" /></el-form-item>
          <el-form-item label="保密协议" :data-archive-field="`contracts.${index}.confidentialityAgreement`"><el-input v-model="contract.confidentialityAgreement" /></el-form-item>
          <el-form-item label="竞业协议" :data-archive-field="`contracts.${index}.nonCompeteAgreement`"><el-input v-model="contract.nonCompeteAgreement" /></el-form-item>
          <el-form-item label="肖像协议" :data-archive-field="`contracts.${index}.portraitAgreement`"><el-input v-model="contract.portraitAgreement" /></el-form-item>
        </el-form>
        <div class="contract-materials">
          <div class="contract-materials__group">
            <div><strong>合同图片</strong><span>最多 5 张，JPG/PNG/WEBP，单张不超过 2MB</span></div>
            <el-upload :show-file-list="false" accept="image/jpeg,image/png,image/webp" :http-request="(options: UploadRequestOptions) => uploadContractImage(contract, options)">
              <el-button :disabled="(contract.images?.length ?? 0) >= 5">上传图片</el-button>
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
            <el-upload :show-file-list="false" accept=".pdf,.doc,.docx,.xls,.xlsx" :http-request="(options: UploadRequestOptions) => uploadContractAttachment(contract, options)">
              <el-button :disabled="(contract.attachments?.length ?? 0) >= 10">上传附件</el-button>
            </el-upload>
            <div v-if="contract.attachments?.length" class="material-list">
              <div v-for="(item, itemIndex) in contract.attachments" :key="`${item.url}-${itemIndex}`" class="material-item">
                <el-button link type="primary" @click="openUploadedMaterial(item)">{{ item.name }}</el-button><small>{{ Math.ceil(item.size / 1024) }}KB</small>
                <el-button link type="danger" @click="contract.attachments.splice(itemIndex, 1)">移除</el-button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <el-empty v-if="!form.contracts.length" description="暂无合同，可点击新增合同" :image-size="72" />
    </section>
  </div>
</template>

<style scoped>
.archive-save-state { color: var(--el-text-color-secondary); font-size: 13px; }
.archive-save-error { color: var(--el-color-danger); font-size: 13px; line-height: 1.6; }
.archive-editor-nav { display: flex; gap: 16px; flex-wrap: wrap; padding: 6px 0; }
.editor-section { scroll-margin-top: 12px; }
.archive-field--focused { outline: 2px solid var(--el-color-primary-light-5); outline-offset: 5px; border-radius: 4px; }

.archive-inline-editor { display: grid; gap: 18px; }
.editor-section { padding: 18px; border: 1px solid #e5eaf2; border-radius: 14px; background: #fff; }
.editor-section__head, .contract-card__head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.editor-section__head { margin-bottom: 14px; }
.editor-section__head h3 { margin: 0 0 4px; font-size: 16px; }
.editor-section__head span { color: #667085; font-size: 13px; }
.archive-editor-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 18px; }
.archive-editor-grid :deep(.el-select), .archive-editor-grid :deep(.el-date-editor), .archive-editor-grid :deep(.el-input-number) { width: 100%; }
.span-2 { grid-column: span 2; }
.contract-card { margin-top: 14px; padding: 16px; border: 1px solid #dfe5ee; border-radius: 12px; background: #f8fafc; }
.contract-card__head { margin-bottom: 8px; }
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
