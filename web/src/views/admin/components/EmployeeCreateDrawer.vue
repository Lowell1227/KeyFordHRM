<script setup lang="ts">
import dayjs from 'dayjs';
import { archiveFieldPath } from '@/utils/employee-archive-fields';
import { isCancelledNewHireArrival } from '@/utils/employee-lifecycle';
import { contractTitle } from '@/utils/employee-contract-presentation';
import { validateOnboardingStep } from '@/utils/onboarding-validation';
import { validateContractDates } from '@/utils/employee-contract-validation';
import { useContractUploads } from '@/utils/employee-contract-uploads';
import { isAxiosError } from 'axios';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { Delete, Plus, RefreshRight } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox, type UploadRequestOptions } from 'element-plus';
import {
  employeeArchivesApi,
  type EmployeeCreateDraftPayload,
  type EmployeeCreatePayload,
  type EmployeeDataReview,
  type EmployeeIdentityCandidate,
  type EmployeeIdentityLookupResult,
  type EmployeeArchiveIssue,
} from '@/api/employee-archives.api';
import { positionsApi, type PositionRecord } from '@/api/positions.api';
import { uploadApi } from '@/api/upload.api';
import UserSelect from '@/components/common/UserSelect.vue';
import ContractSubjectSelect from '@/components/common/ContractSubjectSelect.vue';
import ContractDateInput from '@/components/common/ContractDateInput.vue';
import EmployeeCompanySelect from '@/components/common/EmployeeCompanySelect.vue';
import PersonnelReferenceSelect from '@/components/common/PersonnelReferenceSelect.vue';
import type { Department, User } from '@/types/api.types';
import EmployeeReentryNameMatches from './EmployeeReentryNameMatches.vue';

const props = defineProps<{
  modelValue: boolean;
  departments: Department[];
  draft?: EmployeeDataReview | null;
  issueContext?: EmployeeArchiveIssue | null;
  nextAvailable?: boolean;
  /** 从人才库「办理入职」带入的预填姓名/手机（无草稿时生效）。 */
  initialName?: string;
  initialPhone?: string;
  talentCandidateId?: string;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  submitted: [requestId: string];
  saved: [];
  reentry: [userId: string, talentCandidateId?: string];
  existing: [userId: string];
  application: [requestId: string];
  next: [];
}>();

const stepTitles = ['基本信息', '本次任职', '档案', '检查并提交'];
const checkingStep = ref(false);
const validatedSteps = ref<number[]>([]);
const supplementGroups = ref<string[]>([]);
const fieldErrors = reactive<Record<string, string>>({});
const saveError = ref('');
const currentStep = ref(0);
const draftId = ref<string>();
const draftVersion = ref<number>();
const sourceTalentId = ref<string>();
const saveBlocked = ref(false);
const wizardElement = ref<HTMLElement>();
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
const savingAction = ref<'submit' | null>(null);
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
let generation = 0;
let lastSavedSnapshot = '';
function draftSnapshot() {
  return JSON.stringify({ form, talentCandidateId: sourceTalentId.value, step: currentStep.value, phoneDuplicateAcknowledged: phoneDuplicateAcknowledged.value });
}

type ContractDraft = Record<string, any> & { __key: string };
const form = reactive({
  name: '',
  phone: '',
  idNumber: '',
  company: null as string | null,
  deptId: '',
  positionId: '',
  entryDate: '',
  effectiveFrom: '',
  effectiveTo: '',
  employmentType: 'full_time' as string | null,
  employeeStatus: 'probation' as string | null,
  rosterManagerId: null as string | null,
  performanceManagerId: null as string | null,
  employee: {
    contractSubjectId: undefined as string | null | undefined,
    companyText: null as string | null,
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
const contractUploads = useContractUploads(contract => props.modelValue && form.contracts.some(item => item === contract));
const uploadBlocked = contractUploads.blocked;
const contractDateErrors = computed(() => Object.fromEntries(form.contracts.flatMap((contract, index) =>
  Object.entries(validateContractDates(contract)).map(([field, error]) => [`contracts.${index}.${field}`, error]))));

const hasBlockingIdentityMatch = computed(() => (
  identityResult.value?.outcome === 'identity_match' || identityResult.value?.outcome === 'conflict'
));
const saveStateLabel = computed(() => ({
  idle: form.name.trim() ? '待暂存' : '填写后自动暂存',
  saving: '草稿保存中…',
  saved: '草稿已保存',
  error: '保存失败',
}[saveState.value]));
const selectedDepartment = computed(() => flatten(props.departments).find((item) => item.id === form.deptId));
const selectedPosition = computed(() => positions.value.find((item) => item.id === form.positionId));
const missingForSubmit = computed(() => [
  { key: 'name', label: '姓名', step: 0, missing: !form.name.trim() },
  { key: 'companyText', label: '所属公司', step: 1, missing: !form.company || !(form.employee.contractSubjectId || form.employee.companyText) },
  { key: 'deptId', label: '部门', step: 1, missing: !form.deptId },
  { key: 'entryDate', label: '入职日期', step: 1, missing: !form.entryDate },
  { key: 'effectiveFrom', label: '任职开始', step: 1, missing: !form.effectiveFrom },
  { key: 'employmentType', label: '用工类型', step: 1, missing: !form.employmentType },
  { key: 'employeeStatus', label: '员工状态', step: 1, missing: !form.employeeStatus },
].filter((item) => item.missing));
const missingForSubmitLabels = computed(() => missingForSubmit.value.map((item) => item.label));
const completedSteps = computed(() => validatedSteps.value.filter(step => !Object.keys(validateOnboardingStep(validationPayload(), step)).length));

function stepStatus(step: number) {
  if (step === currentStep.value) return 'process';
  if (completedSteps.value.includes(step)) return 'success';
  return 'wait';
}

function flatten(items: Department[]): Department[] {
  return items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
}

function dateValue(value: unknown): string {
  return typeof value === 'string' && value ? value.slice(0, 10) : '';
}

function reset() {
  const session = ++generation;
  contractUploads.clear();
  if (autosaveTimer) clearTimeout(autosaveTimer);
  saveBlocked.value = false;
  checkingStep.value = false;
  validatedSteps.value = [];
  savingAction.value = null;
  identityLoading.value = false;
  hydrating.value = true;
  const proposed = props.draft?.proposedValue ?? {};
  const employee = proposed.employee ?? {};
  const profile = proposed.profile ?? {};
  const performance = proposed.performance ?? {};
  const draftMeta = proposed.draftMeta ?? {};
  draftId.value = props.draft?.id;
  draftVersion.value = props.draft?.requestVersion;
  sourceTalentId.value = props.draft ? props.draft.talentCandidateId ?? undefined : props.talentCandidateId;
  const savedStep = Number.isInteger(draftMeta.currentStep) ? Number(draftMeta.currentStep) : 0;
  const restoredStep = draftMeta.layoutVersion === 2
    ? Math.min(Math.max(savedStep, 0), 3)
    : [0, 1, 1, 2, 2, 2, 3][savedStep] ?? 0;
  if (draftMeta.layoutVersion === 2 && Array.isArray(draftMeta.completedSteps)) {
    validatedSteps.value = draftMeta.completedSteps.filter((step: unknown): step is number => Number.isInteger(step) && Number(step) >= 0 && Number(step) < 3);
  }
  Object.assign(form, {
    name: employee.name ?? '',
    phone: employee.phone ?? profile.phone ?? '',
    idNumber: '',
    company: employee.company ?? null,
    deptId: employee.deptId ?? '',
    positionId: employee.positionId ?? '',
    entryDate: dateValue(employee.entryDate),
    effectiveFrom: dateValue(employee.effectiveFrom),
    effectiveTo: dateValue(employee.effectiveTo),
    employmentType: employee.employmentType === null ? null : employee.employmentType ?? 'full_time',
    employeeStatus: employee.employeeStatus === null ? null : employee.employeeStatus ?? 'probation',
    rosterManagerId: employee.managerId ?? null,
    performanceManagerId: performance.managerId ?? null,
  });
  // 人才库「办理入职」带入的预填（仅全新创建时生效，草稿/问题单优先）
  if (!props.draft) {
    if (props.initialName) form.name = props.initialName;
    if (props.initialPhone) form.phone = props.initialPhone;
  }
  Object.assign(form.employee, {
    contractSubjectId: employee.contractSubjectId ?? undefined,
    companyText: employee.companyText ?? null,
    position: employee.position ?? '',
    jobGrade: employee.jobGrade ?? '',
    jobFamily: employee.jobFamily ?? '',
    workLocation: employee.workLocation ?? '',
    probationMonths: employee.probationMonths === null ? null : employee.probationMonths ?? 3,
    plannedRegularDate: dateValue(employee.plannedRegularDate),
    actualRegularDate: dateValue(employee.actualRegularDate),
    leaveDate: dateValue(employee.leaveDate),
  });
  const probationStartDate = form.effectiveFrom || form.entryDate;
  const automaticRegularDate = probationStartDate && form.employee.probationMonths != null
    ? dayjs(probationStartDate).add(form.employee.probationMonths, 'month').format('YYYY-MM-DD')
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
    ? proposed.contracts.map((item: Record<string, any>, index: number) => ({ ...item, contractSubjectId: item.contractSubjectId ?? undefined, __key: item.id || `draft-${index}` }))
    : [];
  idNumberConfigured.value = Boolean(profile.idNumberConfigured);
  bankAccountConfigured.value = Boolean(profile.bankAccountConfigured);
  currentStep.value = props.draft ? restoredStep : 0;
  identityResult.value = null;
  phoneDuplicateAcknowledged.value = false;
  lastIdentityKey.value = '';
  saveState.value = props.draft ? 'saved' : 'idle';
  saveError.value = '';
  Object.keys(fieldErrors).forEach((key) => delete fieldErrors[key]);
  nextTick(() => {
    if (session !== generation || !props.modelValue) return;
    hydrating.value = false;
    fillPlannedRegularDate();
    lastSavedSnapshot = draftSnapshot();
    if (!props.draft && sourceTalentId.value) scheduleAutosave();
    void focusIssue();
  });
}

watch(() => [props.modelValue, props.draft?.id] as const, ([open]) => {
  if (open) reset();
  else { generation++; contractUploads.clear(); if (autosaveTimer) clearTimeout(autosaveTimer); }
});
watch(() => props.issueContext, () => { if (props.modelValue) void focusIssue(); });
watch(() => [form.phone, form.idNumber], () => {
  identityResult.value = null;
  phoneDuplicateAcknowledged.value = false;
  lastIdentityKey.value = '';
  delete fieldErrors.identity;
});
watch(() => form.positionId, (positionId, previousId) => {
  if (hydrating.value) return;
  const position = positions.value.find((item) => item.id === positionId);
  const previous = positions.value.find((item) => item.id === previousId);
  if (!form.employee.position || form.employee.position === previous?.name) form.employee.position = position?.name ?? '';
  if (!form.employee.jobFamily || form.employee.jobFamily === previous?.jobFamily) form.employee.jobFamily = position?.jobFamily ?? '';
});
watch(() => form.entryDate, (entryDate) => {
  if (!entryDate || hydrating.value) return;
  if (!form.effectiveFrom) form.effectiveFrom = entryDate;
  fillPlannedRegularDate();
});
watch(() => form.effectiveFrom, () => {
  if (!hydrating.value) fillPlannedRegularDate();
});
watch(() => form.employee.probationMonths, () => {
  if (!hydrating.value) fillPlannedRegularDate();
});
watch(form, scheduleAutosave, { deep: true });
watch(form, () => {
  const errors = validateOnboardingStep(validationPayload(), currentStep.value);
  for (const path of Object.keys(fieldErrors)) {
    if (path === 'identity') continue;
    if (errors[path]) fieldErrors[path] = errors[path];
    else delete fieldErrors[path];
  }
}, { deep: true });
watch(currentStep, scheduleAutosave);

function fillPlannedRegularDate() {
  const probationStartDate = form.effectiveFrom || form.entryDate;
  if (!plannedRegularDateAuto.value || !probationStartDate || form.employee.probationMonths == null) return;
  form.employee.plannedRegularDate = dayjs(probationStartDate).add(form.employee.probationMonths, 'month').format('YYYY-MM-DD');
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
  const session = generation;
  // A draft already stored by the server must be excluded from its own identity lookup.
  if (draftSavePromise && !await draftSavePromise) return false;
  if (session !== generation || !props.modelValue) return false;
  const phone = /^1\d{10}$/.test(normalizedPhone()) ? normalizedPhone() : undefined;
  const idNumber = /^(?:\d{15}|\d{17}[\dX])$/.test(normalizedIdNumber()) ? normalizedIdNumber() : undefined;
  const excludedRequestId = draftId.value;
  const key = `${phone ?? ''}|${idNumber ?? ''}|${excludedRequestId ?? ''}`;
  if (!force && key === lastIdentityKey.value && identityResult.value) return true;
  identityLoading.value = true;
  try {
    const previousCandidates = identityResult.value?.candidates.map((item) => item.id).sort().join('|');
    const result = await employeeArchivesApi.lookupIdentity({ phone, idNumber, excludeRequestId: excludedRequestId });
    if (session !== generation || !props.modelValue) return false;
    if (excludedRequestId !== draftId.value) return await lookupIdentity(true);
    if (key !== `${normalizedPhone() || ''}|${normalizedIdNumber() || ''}|${draftId.value ?? ''}`) return false;
    const sameMatch = key === lastIdentityKey.value
      && previousCandidates === result.candidates.map((item) => item.id).sort().join('|');
    identityResult.value = result;
    lastIdentityKey.value = key;
    if (!sameMatch) phoneDuplicateAcknowledged.value = false;
    fieldErrors.identity = '';
    return true;
  } catch {
    if (session !== generation) return false;
    fieldErrors.identity = '查重暂未完成，请重试；已填写内容仍保留。';
    return false;
  } finally {
    if (session === generation) identityLoading.value = false;
  }
}

async function openNamedReentryCandidate(user: User) {
  if (identityLoading.value || savingAction.value) return;
  const session = generation;
  identityLoading.value = true;
  try {
    await openCandidate({ id: user.id, status: user.status, archived: !!user.archivedAt, nextAction: 'reentry' });
  } finally {
    if (session === generation) identityLoading.value = false;
  }
}

async function openCandidate(candidate: Pick<EmployeeIdentityCandidate, 'id' | 'status' | 'archived' | 'requestId' | 'nextAction'>) {
  const session = generation;
  if (!await prepareToLeave() || session !== generation) return;
  const talentId = sourceTalentId.value;
  if (!candidate.requestId && candidate.status === 'pending_entry' && !candidate.archived) {
    if (identityLoading.value) return;
    identityLoading.value = true;
    let archivedDraftId: string | undefined;
    let opened = false;
    try {
      // Release this replacement draft before the server checks the original talent source.
      if (talentId && draftId.value) {
        const id = draftId.value;
        const result = await employeeArchivesApi.archiveDrafts([id]);
        if (!result.failed?.length) archivedDraftId = id;
        if (session !== generation || !props.modelValue) return;
        if (result.failed?.length) { saveError.value = result.failed[0].reason; return; }
      }
      const request = await employeeArchivesApi.getCurrentReentry(candidate.id);
      if (session !== generation || !props.modelValue) return;
      if (!request || request.userId !== candidate.id
        || (request.onboardingStatus === 'cancelled' && !isCancelledNewHireArrival(request))) {
        saveError.value = '未找到可继续办理的原入职申请，请刷新匹配结果后核对。';
        return;
      }
      opened = true;
      emit('update:modelValue', false);
      emit('application', request.id);
    } catch {
      if (session === generation && props.modelValue) saveError.value = '原入职申请暂时无法打开，已填写内容仍保留，请重试。';
    } finally {
      if (archivedDraftId && !opened) {
        try {
          const result = await employeeArchivesApi.restoreDrafts([archivedDraftId]);
          if (result.failed?.length) throw new Error('Draft restore failed');
        } catch {
          if (session === generation && props.modelValue) {
            saveBlocked.value = true;
            saveError.value = '本次草稿仍保留在已归档草稿中，请从草稿列表恢复后继续。';
          }
        }
      }
      if (session === generation) identityLoading.value = false;
    }
    return;
  }
  if (!candidate.requestId && (candidate.status === 'resigned' || candidate.archived) && talentId && draftId.value) {
    try {
      // The selected reentry replaces this unsubmitted new-hire draft; keep it recoverable.
      const result = await employeeArchivesApi.archiveDrafts([draftId.value]);
      if (session !== generation) return;
      if (result.failed?.length) { saveError.value = result.failed[0].reason; return; }
    } catch { saveError.value = '转入再入职未完成，原草稿已保留，请重试。'; return; }
  }
  emit('update:modelValue', false);
  if (candidate.requestId || candidate.nextAction === 'view_application') emit('application', candidate.requestId ?? candidate.id);
  else if (candidate.status === 'resigned' || candidate.archived) emit('reentry', candidate.id, talentId);
  else emit('existing', candidate.id);
}

function validationPayload(): EmployeeCreateDraftPayload {
  const employee = {
    ...form.employee,
    plannedRegularDate: form.employee.plannedRegularDate || null,
    actualRegularDate: form.employee.actualRegularDate || null,
    leaveDate: form.employee.leaveDate || null,
    name: form.name.trim(), phone: normalizedPhone() || null, company: form.company,
    deptId: form.deptId || null, positionId: form.positionId || null,
    managerId: form.rosterManagerId, entryDate: form.entryDate || null,
    effectiveFrom: form.effectiveFrom || null, effectiveTo: form.effectiveTo || null,
    employmentType: form.employmentType, employeeStatus: form.employeeStatus,
  };
  const profile = {
    ...form.profile,
    birthDate: form.profile.birthDate || null,
    graduationDate: form.profile.graduationDate || null,
    socialSecurityStartDate: form.profile.socialSecurityStartDate || null,
    housingFundStartDate: form.profile.housingFundStartDate || null,
    phone: normalizedPhone() || null,
    idNumber: normalizedIdNumber() || '',
    bankAccount: form.profile.bankAccount.trim(),
  };
  return {
    talentCandidateId: sourceTalentId.value,
    draftId: draftId.value,
    expectedVersion: draftId.value ? draftVersion.value : undefined,
    name: form.name.trim(), phone: normalizedPhone() || null, idNumber: normalizedIdNumber() || null,
    phoneDuplicateAcknowledged: phoneDuplicateAcknowledged.value,
    company: form.company, deptId: form.deptId || undefined, positionId: form.positionId || null,
    entryDate: form.entryDate || undefined, effectiveFrom: form.effectiveFrom || undefined, effectiveTo: form.effectiveTo || null,
    employmentType: form.employmentType, employeeStatus: form.employeeStatus,
    rosterManagerId: form.rosterManagerId, performanceManagerId: form.performanceManagerId,
    employee, profile,
    contracts: form.contracts.map(({ __key, ...contract }, index) => ({ ...contract, signedAt: contract.signedAt || null, effectiveFrom: contract.effectiveFrom || null, expiresAt: contract.expiresAt || null, sequence: index })),
    performance: { managerId: form.performanceManagerId },
  };
}

function requestBody(): EmployeeCreateDraftPayload {
  return { ...validationPayload(), draftStep: currentStep.value, draftLayoutVersion: 2, completedSteps: completedSteps.value };
}

function scheduleAutosave() {
  if (hydrating.value || saveBlocked.value || savingAction.value === 'submit' || !props.modelValue || !form.name.trim()) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  saveState.value = 'idle';
  autosaveTimer = setTimeout(() => { void persistDraft(); }, 700);
}

function openExistingTalentApplication(error: unknown): boolean {
  if (!sourceTalentId.value || draftId.value || !isAxiosError(error) || error.response?.status !== 409) return false;
  const applicationId: unknown = error.response.data?.data?.applicationId;
  if (typeof applicationId !== 'string' || !applicationId.trim()) return false;
  saveBlocked.value = true;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  generation++;
  emit('update:modelValue', false);
  emit('application', applicationId);
  return true;
}

async function persistDraft() {
  const session = generation;
  if (!form.name.trim()) return false;
  if (savingAction.value === 'submit') return false;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  while (draftSavePromise) {
    if (!await draftSavePromise) return false;
    if (session !== generation || !props.modelValue || saveBlocked.value) return false;
  }
  if (session !== generation || !props.modelValue || saveBlocked.value) return false;
  if (savingAction.value === 'submit') return false;
  if (draftId.value && lastSavedSnapshot === draftSnapshot()) return true;
  const snapshot = draftSnapshot();
  saveState.value = 'saving';
  const save = (async () => {
    try {
      const request = await employeeArchivesApi.saveEmployeeCreateDraft({ ...requestBody(), saveMode: 'auto' });
      if (session !== generation || !props.modelValue) return false;
      draftId.value = request.id;
      draftVersion.value = request.requestVersion;
      lastSavedSnapshot = snapshot;
      saveState.value = 'saved';
      saveError.value = '';
      return true;
    } catch (error) {
      if (session !== generation || !props.modelValue) return false;
      if (openExistingTalentApplication(error)) return false;
      saveState.value = 'error';
      saveBlocked.value = isAxiosError(error) && error.response?.status === 409;
      saveError.value = saveBlocked.value ? '资料已更新，本次输入已保留。请先留存修改，再打开最新草稿核对。' : '草稿保存失败，输入内容仍保留。请重试保存，或放弃本次未保存内容。';
      return false;
    }
  })();
  draftSavePromise = save;
  const succeeded = await save;
  if (draftSavePromise === save) draftSavePromise = null;
  if (succeeded && session === generation && lastSavedSnapshot !== draftSnapshot()) return persistDraft();
  return succeeded;
}

async function beforeClose(done: () => void) {
  if (await prepareToLeave()) done();
}

async function prepareToLeave(): Promise<boolean> {
  if (savingAction.value === 'submit') return false;
  const session = generation;
  if (!form.name.trim()) {
    if (lastSavedSnapshot === draftSnapshot()) return true;
    try {
      await ElMessageBox.confirm('尚未填写姓名，当前内容无法保存草稿。放弃本次未保存内容？', '未保存的内容', {
        confirmButtonText: '放弃未保存内容', cancelButtonText: '继续填写', type: 'warning',
      });
      return true;
    } catch { return false; }
  }
  const saved = await persistDraft();
  if (session !== generation || !props.modelValue) return false;
  if (saved) {
    emit('saved');
    return true;
  } else {
    try {
      await ElMessageBox.confirm('草稿保存失败，关闭会丢失本次未保存内容。', '未保存的内容', { confirmButtonText: '放弃未保存内容', cancelButtonText: '继续填写', type: 'warning' });
      return true;
    } catch { return false; }
  }
}

async function nextDraft() {
  if (await prepareToLeave()) emit('next');
}

async function focusIssue() {
  if (!props.issueContext?.field) return;
  const field = archiveFieldPath(props.issueContext.field);
  const key = field.split('.').pop()!;
  currentStep.value = ['name', 'phone', 'idNumber', 'identity', 'employeeNo'].includes(key) ? 0
    : field.startsWith('contracts') || field.startsWith('profile') ? 2 : 1;
  if (currentStep.value === 2) supplementGroups.value = ['personal', 'contact', 'contracts'];
  await nextTick();
  const root = wizardElement.value;
  root?.querySelectorAll('.archive-field--focused').forEach(item => item.classList.remove('archive-field--focused'));
  const target = root?.querySelector<HTMLElement>(`[data-archive-field="${CSS.escape(field)}"]`)
    ?? root?.querySelector<HTMLElement>('.wizard-section:not([style*="display: none"])');
  if (!target) return;
  target.classList.add('archive-field--focused'); target.scrollIntoView({ block: 'center' });
  target.querySelector<HTMLElement>('input:not(:disabled),button:not(:disabled)')?.focus({ preventScroll: true });
}

defineExpose({ prepareToLeave });

function previousStep() {
  if (currentStep.value > 0) currentStep.value -= 1;
}

async function focusInvalidField(path: string) {
  if (path.startsWith('contracts')) supplementGroups.value = [...new Set([...supplementGroups.value, 'contracts'])];
  else if (path.startsWith('profile.') && currentStep.value === 2) supplementGroups.value = ['personal', 'contact', ...supplementGroups.value];
  await nextTick();
  const field = wizardElement.value?.querySelector<HTMLElement>(`[data-archive-field="${CSS.escape(path)}"]`);
  field?.scrollIntoView({ block: 'center' });
  field?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
}

async function validateStep(step: number, recheckIdentity = false): Promise<boolean> {
  const session = generation;
  if (step === 2 && !await validateUploads()) return false;
  Object.keys(fieldErrors).forEach(key => delete fieldErrors[key]);
  Object.assign(fieldErrors, validateOnboardingStep(validationPayload(), step));
  if (Object.keys(fieldErrors).length) {
    currentStep.value = step;
    await focusInvalidField(Object.keys(fieldErrors)[0]);
    return false;
  }
  if (step === 0) {
    const identityChecked = !canLookupIdentity() || await lookupIdentity(recheckIdentity);
    if (session !== generation || !props.modelValue) return false;
    if (!identityChecked) { currentStep.value = 0; return false; }
    if (hasBlockingIdentityMatch.value) fieldErrors.identity = '已找到现有员工，请从匹配结果进入原档案处理';
    else if (identityResult.value?.outcome === 'phone_candidates' && !phoneDuplicateAcknowledged.value) fieldErrors.identity = '请先核对手机号匹配结果';
    if (fieldErrors.identity) { currentStep.value = 0; await focusInvalidField('identity'); return false; }
  }
  if (!validatedSteps.value.includes(step)) validatedSteps.value.push(step);
  return true;
}

async function nextStep() {
  if (checkingStep.value || savingAction.value || identityLoading.value) return;
  const session = generation;
  checkingStep.value = true;
  try {
    if (!await validateStep(currentStep.value) || session !== generation) return;
    currentStep.value = Math.min(currentStep.value + 1, stepTitles.length - 1);
    await persistDraft();
  } finally {
    if (session === generation) checkingStep.value = false;
  }
}

async function submit() {
  if (savingAction.value || saveBlocked.value || checkingStep.value || identityLoading.value) return;
  if (!await validateUploads()) return;
  const session = generation;
  checkingStep.value = true;
  try {
    for (const step of [0, 1, 2]) if (!await validateStep(step, true) || session !== generation) return;
  } finally {
    if (session === generation) checkingStep.value = false;
  }
  if (session !== generation || !props.modelValue) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  savingAction.value = 'submit';
  try {
    if (draftSavePromise && !(await draftSavePromise)) return;
    if (session !== generation || !props.modelValue) return;
    if (!await validateUploads()) return;
    const request = await employeeArchivesApi.createEmployee(requestBody() as EmployeeCreatePayload);
    if (session !== generation || !props.modelValue) return;
    ElMessage.success('入职申请已提交');
    emit('update:modelValue', false);
    emit('submitted', request.id);
  } catch (error) {
    if (session !== generation || !props.modelValue) return;
    if (openExistingTalentApplication(error)) return;
    const fields = isAxiosError(error) ? error.response?.data?.data?.fieldErrors : undefined;
    if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
      for (const [path, value] of Object.entries(fields)) {
        if (/^contracts(?:\.\d+(?:\.[a-zA-Z]+)?)?$/.test(path) && typeof value === 'string') fieldErrors[path] = value;
      }
      const first = Object.keys(fieldErrors).find(path => path.startsWith('contracts'));
      if (first) { currentStep.value = 2; await focusInvalidField(first); }
    }
    const message = isAxiosError(error) ? error.response?.data?.message : '';
    const detail = Array.isArray(message) ? message.filter(item => typeof item === 'string').join('；') : message;
    saveError.value = typeof detail === 'string' && detail ? `${detail}。已填写内容仍保留。` : '提交未完成，已填写内容仍保留，请核对提示后重试。';
  } finally {
    if (session === generation) savingAction.value = null;
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

async function validateUploads(): Promise<boolean> {
  if (!uploadBlocked.value) return true;
  currentStep.value = 2;
  await focusInvalidField('contracts');
  return false;
}

function removeContract(contract: ContractDraft) {
  contractUploads.cancelContract(contract);
  form.contracts.splice(form.contracts.indexOf(contract), 1);
}

function uploadContractImage(contract: ContractDraft, options: UploadRequestOptions) {
  return contractUploads.start(contract, 'images', options.file);
}

function uploadContractAttachment(contract: ContractDraft, options: UploadRequestOptions) {
  return contractUploads.start(contract, 'attachments', options.file);
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
onBeforeUnmount(() => { generation++; contractUploads.clear(); if (autosaveTimer) clearTimeout(autosaveTimer); });
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    title="办理入职"
    size="min(960px, 100vw)"
    :close-on-click-modal="true"
    :before-close="beforeClose"
    destroy-on-close
    class="employee-create-drawer"
    @opened="focusIssue"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div ref="wizardElement" class="wizard-shell">
      <div class="wizard-head">
        <el-steps :active="currentStep" align-center class="desktop-steps">
          <el-step
            v-for="(title, index) in stepTitles"
            :key="title"
            :title="title"
            :status="stepStatus(index)"
          />
        </el-steps>
        <div class="mobile-step"><strong>{{ currentStep + 1 }}/{{ stepTitles.length }} {{ stepTitles[currentStep] }}</strong></div>
        <span class="save-state" :class="`save-state--${saveState}`">{{ saveStateLabel }}</span>
      </div>
      <aside v-if="issueContext" role="note" aria-label="正在核实事项" class="draft-issue-context"><strong>{{ issueContext.message }}</strong><span>{{ issueContext.reason }}</span><span>原资料：{{ issueContext.source.value ?? '未提供' }} · 当前资料：{{ issueContext.current.value ?? '未提供' }}</span></aside>
      <el-alert v-if="draft?.rejectedReason" :title="`已退回：${draft.rejectedReason}`" type="warning" :closable="false" />
      <el-alert v-if="saveError" :title="saveError" type="error" :closable="false">
        <el-button v-if="saveState === 'error' && !saveBlocked" link :disabled="savingAction === 'submit'" @click="persistDraft">重试暂存</el-button>
      </el-alert>
      <el-alert
        v-if="missingForSubmit.length && currentStep === 3"
        :title="`提交前还需补充：${missingForSubmitLabels.join('、')}`"
        type="warning"
        :closable="false"
        show-icon
      />

      <el-form label-position="top" class="wizard-form" :disabled="savingAction === 'submit' || identityLoading" :inert="savingAction === 'submit' || identityLoading">
        <section v-show="currentStep === 0" class="wizard-section">
          <div class="section-head"><div><h3>身份核验</h3></div></div>
          <div class="form-grid">
            <el-form-item data-archive-field="employee.name" label="姓名" required :error="fieldErrors['employee.name']"><el-input v-model="form.name" maxlength="50" placeholder="输入姓名，可查找离职员工" /></el-form-item>
            <el-form-item data-archive-field="profile.phone" label="手机号" :error="fieldErrors['profile.phone']"><el-input v-model="form.phone" maxlength="20" @blur="lookupIdentity()" /></el-form-item>
            <el-form-item data-archive-field="profile.idNumber" :label="idNumberConfigured ? '身份证号（已保存，留空不变）' : '身份证号'" :error="fieldErrors['profile.idNumber']"><el-input v-model="form.idNumber" maxlength="18" show-password @blur="lookupIdentity()" /></el-form-item>
            <el-form-item data-archive-field="identity" label="身份查重" :error="fieldErrors.identity"><el-button :loading="identityLoading" :disabled="!canLookupIdentity()" @click="lookupIdentity(true)">检索已有档案</el-button></el-form-item>
          </div>
          <EmployeeReentryNameMatches
            :name="form.name"
            :active="modelValue && currentStep === 0"
            :disabled="savingAction === 'submit' || identityLoading"
            @select="openNamedReentryCandidate"
          />
          <div v-if="identityResult?.outcome === 'conflict'" class="identity-result identity-result--danger">手机号与身份证号对应不同员工，请核对后再提交。</div>
          <div v-else-if="identityResult?.candidates.length" class="identity-result">
            <strong>{{ identityResult.outcome === 'identity_match' ? '已找到现有员工档案' : '手机号与以下档案相同' }}</strong>
            <div v-for="candidate in identityResult.candidates" :key="candidate.id" class="identity-candidate">
              <span>{{ candidate.maskedName }} · {{ candidate.currentEmployeeNo || candidate.matchedHistoricalEmployeeNo || '无工号' }} · {{ candidate.departmentName || '未分配部门' }}</span>
              <el-button link type="primary" :disabled="identityLoading" @click="openCandidate(candidate)">{{ candidate.requestId || candidate.nextAction === 'view_application' ? '查看原申请' : candidate.status === 'resigned' || candidate.archived ? '办理再入职' : candidate.status === 'pending_entry' ? '查看入职流程' : '打开现有档案' }}</el-button>
            </div>
            <el-checkbox v-if="identityResult.outcome === 'phone_candidates'" v-model="phoneDuplicateAcknowledged">已核对，以上人员均不是本次新增员工</el-checkbox>
          </div>
        </section>

        <section v-show="currentStep === 1" class="wizard-section">
          <div class="section-head"><h3>任职信息</h3></div>
          <div class="form-grid form-grid--3">
            <el-form-item data-archive-field="employee.companyText" label="所属公司" required :error="fieldErrors['employee.companyText']"><EmployeeCompanySelect v-model="form.employee.contractSubjectId" v-model:snapshot-name="form.employee.companyText" v-model:company="form.company" /></el-form-item>

            <el-form-item data-archive-field="employee.deptId" label="部门" required :error="fieldErrors['employee.deptId']"><el-tree-select v-model="form.deptId" :data="departments" node-key="id" :props="{ label: 'name', children: 'children' }" check-strictly filterable /></el-form-item>
            <el-form-item data-archive-field="employee.positionId" label="岗位" :error="fieldErrors['employee.positionId']"><el-select v-model="form.positionId" filterable clearable><el-option v-for="position in positions" :key="position.id" :label="position.jobFamily ? `${position.name}（${position.jobFamily}）` : position.name" :value="position.id" /></el-select></el-form-item>
            <el-form-item data-archive-field="employee.position" label="岗位名称" :error="fieldErrors['employee.position']"><el-input v-model="form.employee.position" placeholder="选择岗位后自动带入" /></el-form-item>
            <el-form-item data-archive-field="employee.jobGrade" label="职级" :error="fieldErrors['employee.jobGrade']"><el-input v-model="form.employee.jobGrade" /></el-form-item>
            <el-form-item data-archive-field="employee.jobFamily" label="职系" :error="fieldErrors['employee.jobFamily']"><PersonnelReferenceSelect v-model="form.employee.jobFamily" kind="job_family" label="职系" placeholder="选择岗位后自动带入，也可选择其他职系" /></el-form-item>
            <el-form-item data-archive-field="employee.workLocation" label="工作地点" :error="fieldErrors['employee.workLocation']"><PersonnelReferenceSelect v-model="form.employee.workLocation" kind="work_location" label="工作地点" /></el-form-item>
            <el-form-item data-archive-field="employee.employmentType" label="用工类型" required :error="fieldErrors['employee.employmentType']"><el-select v-model="form.employmentType" placeholder="待核实后选择" aria-label="用工类型"><el-option label="全职" value="full_time" /><el-option label="兼职" value="part_time" /><el-option label="返聘" value="rehire" /><el-option label="外部" value="external" /></el-select></el-form-item>
            <el-form-item data-archive-field="employee.employeeStatus" label="员工状态" required :error="fieldErrors['employee.employeeStatus']"><el-select v-model="form.employeeStatus" placeholder="待核实后选择" aria-label="员工状态"><el-option label="试用期" value="probation" /><el-option label="在职" value="active" /></el-select></el-form-item>
            <el-form-item data-archive-field="employee.entryDate" label="入职日期" required :error="fieldErrors['employee.entryDate']"><el-date-picker v-model="form.entryDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item data-archive-field="employee.effectiveFrom" label="任职开始" required :error="fieldErrors['employee.effectiveFrom']"><el-date-picker v-model="form.effectiveFrom" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item v-if="form.effectiveTo || fieldErrors['employee.effectiveTo']" data-archive-field="employee.effectiveTo" label="任职结束" :error="fieldErrors['employee.effectiveTo']"><el-date-picker v-model="form.effectiveTo" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item data-archive-field="employee.probationMonths" label="试用期（月）" :error="fieldErrors['employee.probationMonths']"><el-input-number v-model="form.employee.probationMonths" :min="0" :max="12" /><small v-if="form.employee.probationMonths === null">未提供月数，保持空值，可核实后补充。</small></el-form-item>
            <el-form-item data-archive-field="employee.plannedRegularDate" label="预计转正日期" :error="fieldErrors['employee.plannedRegularDate']"><el-date-picker v-model="form.employee.plannedRegularDate" type="date" value-format="YYYY-MM-DD" @change="plannedRegularDateAuto = false" /></el-form-item>
            <el-form-item v-if="form.employee.actualRegularDate || fieldErrors['employee.actualRegularDate']" data-archive-field="employee.actualRegularDate" label="实际转正日期" :error="fieldErrors['employee.actualRegularDate']"><el-date-picker v-model="form.employee.actualRegularDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item v-if="form.employee.leaveDate || fieldErrors['employee.leaveDate']" data-archive-field="employee.leaveDate" label="离职日期" :error="fieldErrors['employee.leaveDate']"><el-date-picker v-model="form.employee.leaveDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          </div>
        </section>

        <section v-show="currentStep === 1" class="wizard-section">
          <div class="section-head"><h3>管理关系</h3></div>
          <div class="form-grid">
            <el-form-item data-archive-field="employee.managerId" label="花名册直属主管" :error="fieldErrors['employee.managerId']"><UserSelect v-model="form.rosterManagerId" clearable eligible-for="direct_manager" /><small>仅作为档案中的汇报关系显示。</small></el-form-item>
            <el-form-item data-archive-field="performance.managerId" label="绩效直属上级" :error="fieldErrors['performance.managerId']"><UserSelect v-model="form.performanceManagerId" clearable eligible-for="direct_manager" /><small>用于绩效目标审核、评分和待办归属。</small></el-form-item>
          </div>
        </section>

        <el-collapse v-show="currentStep === 2" v-model="supplementGroups" class="supplement-groups">
        <el-collapse-item name="personal" title="个人与教育">
        <section class="wizard-section">
          <div class="form-grid form-grid--3">
            <el-form-item data-archive-field="profile.gender" label="性别" :error="fieldErrors['profile.gender']"><el-select v-model="form.profile.gender" clearable><el-option label="男" value="男" /><el-option label="女" value="女" /></el-select></el-form-item>
            <el-form-item data-archive-field="profile.birthDate" label="出生日期" :error="fieldErrors['profile.birthDate']"><el-date-picker v-model="form.profile.birthDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item data-archive-field="profile.ethnicity" label="民族" :error="fieldErrors['profile.ethnicity']"><el-input v-model="form.profile.ethnicity" /></el-form-item>
            <el-form-item data-archive-field="profile.education" label="学历" :error="fieldErrors['profile.education']"><el-input v-model="form.profile.education" /></el-form-item>
            <el-form-item data-archive-field="profile.professionalTitle" label="职称" :error="fieldErrors['profile.professionalTitle']"><el-input v-model="form.profile.professionalTitle" /></el-form-item>
            <el-form-item data-archive-field="profile.school" label="毕业院校" :error="fieldErrors['profile.school']"><el-input v-model="form.profile.school" /></el-form-item>
            <el-form-item data-archive-field="profile.graduationDate" label="毕业日期" :error="fieldErrors['profile.graduationDate']"><el-date-picker v-model="form.profile.graduationDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item data-archive-field="profile.major" label="专业" :error="fieldErrors['profile.major']"><el-input v-model="form.profile.major" /></el-form-item>
            <el-form-item data-archive-field="profile.maritalStatus" label="婚姻状况" :error="fieldErrors['profile.maritalStatus']"><el-input v-model="form.profile.maritalStatus" /></el-form-item>
            <el-form-item data-archive-field="profile.childrenStatus" label="子女状况" :error="fieldErrors['profile.childrenStatus']"><el-input v-model="form.profile.childrenStatus" /></el-form-item>
            <el-form-item data-archive-field="profile.childrenCount" label="子女数量" :error="fieldErrors['profile.childrenCount']"><el-input-number v-model="form.profile.childrenCount" :min="0" /></el-form-item>
            <el-form-item data-archive-field="profile.politicalStatus" label="政治面貌" :error="fieldErrors['profile.politicalStatus']"><el-input v-model="form.profile.politicalStatus" /></el-form-item>
            <el-form-item data-archive-field="profile.nativePlace" label="籍贯" :error="fieldErrors['profile.nativePlace']"><el-input v-model="form.profile.nativePlace" /></el-form-item>
            <el-form-item data-archive-field="profile.householdType" label="户籍类型" :error="fieldErrors['profile.householdType']"><el-input v-model="form.profile.householdType" /></el-form-item>
          </div>
        </section>
        </el-collapse-item>

        <el-collapse-item name="contact" title="联系与保障">
        <section class="wizard-section">
          <div class="form-grid form-grid--3">
            <el-form-item data-archive-field="profile.idAddress" label="身份证地址" class="span-2" :error="fieldErrors['profile.idAddress']"><el-input v-model="form.profile.idAddress" /></el-form-item>
            <el-form-item data-archive-field="profile.currentAddress" label="现住址" class="span-2" :error="fieldErrors['profile.currentAddress']"><el-input v-model="form.profile.currentAddress" /></el-form-item>
            <el-form-item data-archive-field="profile.emergencyContactName" label="紧急联系人" :error="fieldErrors['profile.emergencyContactName']"><el-input v-model="form.profile.emergencyContactName" /></el-form-item>
            <el-form-item data-archive-field="profile.emergencyContactRelation" label="与联系人关系" :error="fieldErrors['profile.emergencyContactRelation']"><el-input v-model="form.profile.emergencyContactRelation" /></el-form-item>
            <el-form-item data-archive-field="profile.emergencyContactPhone" label="紧急联系电话" :error="fieldErrors['profile.emergencyContactPhone']"><el-input v-model="form.profile.emergencyContactPhone" /></el-form-item>
            <el-form-item data-archive-field="profile.socialSecurityStatus" label="社保状态" :error="fieldErrors['profile.socialSecurityStatus']"><el-input v-model="form.profile.socialSecurityStatus" /></el-form-item>
            <el-form-item data-archive-field="profile.socialSecurityStartDate" label="社保起始日期" :error="fieldErrors['profile.socialSecurityStartDate']"><el-date-picker v-model="form.profile.socialSecurityStartDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item data-archive-field="profile.housingFundStatus" label="公积金状态" :error="fieldErrors['profile.housingFundStatus']"><el-input v-model="form.profile.housingFundStatus" /></el-form-item>
            <el-form-item data-archive-field="profile.housingFundStartDate" label="公积金起始日期" :error="fieldErrors['profile.housingFundStartDate']"><el-date-picker v-model="form.profile.housingFundStartDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item data-archive-field="profile.bankName" label="开户行" :error="fieldErrors['profile.bankName']"><el-input v-model="form.profile.bankName" /></el-form-item>
            <el-form-item data-archive-field="profile.bankBranch" label="开户支行" :error="fieldErrors['profile.bankBranch']"><el-input v-model="form.profile.bankBranch" /></el-form-item>
            <el-form-item data-archive-field="profile.bankAccount" :label="bankAccountConfigured ? '银行卡号（已保存，留空不变）' : '银行卡号'" :error="fieldErrors['profile.bankAccount']"><el-input v-model="form.profile.bankAccount" type="password" show-password /></el-form-item>
          </div>
        </section>
        </el-collapse-item>

        <el-collapse-item name="contracts" title="合同与附件" data-archive-field="contracts">
        <section class="wizard-section">
          <p v-if="fieldErrors.contracts" class="field-error" role="alert">{{ fieldErrors.contracts }}</p>
          <p v-if="uploadBlocked" class="field-error" role="status">{{ contractUploads.message.value }}</p>
          <div class="section-head contract-toolbar"><el-button :icon="Plus" @click="addContract">新增合同</el-button></div>
          <div v-for="(contract, index) in form.contracts" :key="contract.__key" class="contract-card">
            <div class="contract-card__head"><strong>{{ contractTitle(contract) }}</strong><el-button link type="danger" :icon="Delete" @click="removeContract(contract)">移除</el-button></div>
            <p v-if="fieldErrors[`contracts.${index}`]" :data-archive-field="`contracts.${index}`" class="field-error" role="alert">{{ fieldErrors[`contracts.${index}`] }}</p>
            <div class="form-grid form-grid--3">
              <el-form-item :data-archive-field="`contracts.${index}.contractType`" :error="fieldErrors[`contracts.${index}.contractType`]" label="类型"><el-select v-model="contract.contractType"><el-option label="首签" value="contract" /><el-option label="续签" value="renewal" /><el-option label="转签" value="transfer" /><el-option v-if="contract.contractType && !['contract', 'renewal', 'transfer'].includes(contract.contractType)" :label="contract.contractType" :value="contract.contractType" /></el-select></el-form-item>
              <el-form-item :data-archive-field="`contracts.${index}.name`" :error="fieldErrors[`contracts.${index}.name`]" label="合同名称"><el-input v-model="contract.name" /></el-form-item>
              <el-form-item :data-archive-field="`contracts.${index}.contractSubjectId`" :error="fieldErrors[`contracts.${index}.contractSubjectId`]" label="签约公司"><ContractSubjectSelect v-model="contract.contractSubjectId" v-model:snapshot-name="contract.signingCompany" /></el-form-item>
              <el-form-item :data-archive-field="`contracts.${index}.signedAt`" :error="contractDateErrors[`contracts.${index}.signedAt`] || fieldErrors[`contracts.${index}.signedAt`]" label="签订日期"><ContractDateInput v-model="contract.signedAt" /></el-form-item>
              <el-form-item :data-archive-field="`contracts.${index}.effectiveFrom`" :error="contractDateErrors[`contracts.${index}.effectiveFrom`] || fieldErrors[`contracts.${index}.effectiveFrom`]" label="生效日期"><ContractDateInput v-model="contract.effectiveFrom" /></el-form-item>
              <el-form-item :data-archive-field="`contracts.${index}.expiresAt`" :error="contractDateErrors[`contracts.${index}.expiresAt`] || fieldErrors[`contracts.${index}.expiresAt`]" label="到期日期"><ContractDateInput v-model="contract.expiresAt" /></el-form-item>
              <el-form-item :data-archive-field="`contracts.${index}.termType`" :error="fieldErrors[`contracts.${index}.termType`]" label="期限"><el-input v-model="contract.termType" /></el-form-item>
              <el-form-item v-if="contract.contractType === 'transfer' || contract.originalCompany" :data-archive-field="`contracts.${index}.originalCompany`" label="原公司" :error="fieldErrors[`contracts.${index}.originalCompany`]"><ContractSubjectSelect v-model:snapshot-name="contract.originalCompany" name-only /></el-form-item>
              <el-form-item v-if="contract.contractType === 'transfer' || contract.newCompany" :data-archive-field="`contracts.${index}.newCompany`" label="新公司" :error="fieldErrors[`contracts.${index}.newCompany`]"><ContractSubjectSelect v-model:snapshot-name="contract.newCompany" name-only /></el-form-item>
              <el-form-item :data-archive-field="`contracts.${index}.confidentialityAgreement`" :error="fieldErrors[`contracts.${index}.confidentialityAgreement`]" label="保密协议"><el-input v-model="contract.confidentialityAgreement" /></el-form-item>
              <el-form-item :data-archive-field="`contracts.${index}.nonCompeteAgreement`" :error="fieldErrors[`contracts.${index}.nonCompeteAgreement`]" label="竞业协议"><el-input v-model="contract.nonCompeteAgreement" /></el-form-item>
              <el-form-item :data-archive-field="`contracts.${index}.portraitAgreement`" :error="fieldErrors[`contracts.${index}.portraitAgreement`]" label="肖像协议"><el-input v-model="contract.portraitAgreement" /></el-form-item>
            </div>
            <div class="contract-materials">
              <div class="material-group"><strong>合同图片</strong><small>最多 5 张，单张不超过 2MB</small><el-upload :disabled="contractUploads.count(contract, 'images') >= 5" :show-file-list="false" accept="image/jpeg,image/png,image/webp" :http-request="(options: UploadRequestOptions) => uploadContractImage(contract, options)"><el-button :disabled="contractUploads.count(contract, 'images') >= 5">上传图片</el-button></el-upload><div v-for="(item, itemIndex) in contract.images" :key="item.url" class="material-item"><el-button link type="primary" @click="openUploadedMaterial(item)">{{ item.name }}</el-button><el-button link type="danger" @click="contract.images.splice(itemIndex, 1)">移除</el-button></div></div>
              <div class="material-group"><strong>合同附件</strong><small>最多 10 个，单个不超过 10MB</small><el-upload :disabled="contractUploads.count(contract, 'attachments') >= 10" :show-file-list="false" accept=".pdf,.doc,.docx,.xls,.xlsx" :http-request="(options: UploadRequestOptions) => uploadContractAttachment(contract, options)"><el-button :disabled="contractUploads.count(contract, 'attachments') >= 10">上传附件</el-button></el-upload><div v-for="(item, itemIndex) in contract.attachments" :key="item.url" class="material-item"><el-button link type="primary" @click="openUploadedMaterial(item)">{{ item.name }}</el-button><el-button link type="danger" @click="contract.attachments.splice(itemIndex, 1)">移除</el-button></div></div>
            </div>
            <div v-for="task in contractUploads.forContract(contract)" :key="task.id" class="contract-upload-task" role="status">
              <span>{{ task.file.name }}</span><small :class="{ 'field-error': task.status === 'failed' }">{{ task.status === 'uploading' ? '上传中' : task.error }}</small>
              <el-button v-if="task.status === 'failed'" link type="primary" :icon="RefreshRight" @click="contractUploads.retry(task)">重试</el-button>
              <el-button link type="danger" :icon="Delete" @click="contractUploads.remove(task)">移除</el-button>
            </div>
          </div>
          <p v-if="!form.contracts.length" class="empty-contracts">暂无合同</p>
        </section>
        </el-collapse-item>
        </el-collapse>

        <section v-show="currentStep === 3" class="wizard-section">
          <div class="section-head"><div><h3>检查并提交</h3></div></div>
          <dl class="preview-grid">
            <div><dt>所属公司</dt><dd>{{ form.employee.companyText || '未填写' }}</dd></div>
            <div><dt>姓名</dt><dd>{{ form.name || '未填写' }}</dd></div><div><dt>手机号</dt><dd>{{ form.phone || '未填写' }}</dd></div>
            <div><dt>部门</dt><dd>{{ selectedDepartment?.fullPath || selectedDepartment?.name || '未填写' }}</dd></div><div><dt>岗位</dt><dd>{{ selectedPosition?.name || form.employee.position || '未填写' }}</dd></div>
            <div><dt>入职日期</dt><dd>{{ form.entryDate || '未填写' }}</dd></div><div><dt>任职开始</dt><dd>{{ form.effectiveFrom || '未填写' }}</dd></div>
            <div><dt>花名册直属主管</dt><dd>{{ form.rosterManagerId ? '已设置' : '未设置' }}</dd></div><div><dt>绩效直属上级</dt><dd>{{ form.performanceManagerId ? '已设置' : '未设置' }}</dd></div>
            <div><dt>合同</dt><dd>{{ form.contracts.length }} 份</dd></div><div><dt>工号</dt><dd>审核通过后使用系统生成的新工号</dd></div>
          </dl>
          <p class="submission-process">提交审核 → 审核通过 → 确认到岗 → 入职生效</p>
        </section>
      </el-form>
    </div>

    <template #footer>
      <div class="drawer-footer">
        <el-button v-if="nextAvailable" :disabled="savingAction === 'submit'" @click="nextDraft">下一份待核资料</el-button>
        <el-button v-if="currentStep > 0" :disabled="checkingStep || identityLoading || !!savingAction" @click="previousStep">上一步</el-button>
        <span class="footer-spacer" />
        <el-button :disabled="savingAction === 'submit'" @click="beforeClose(() => emit('update:modelValue', false))">关闭</el-button>
        <el-button v-if="currentStep < stepTitles.length - 1" type="primary" :loading="checkingStep" :disabled="identityLoading || !!savingAction" @click="nextStep">下一步</el-button>
        <el-button v-else type="primary" :loading="checkingStep || savingAction === 'submit'" :disabled="saveBlocked || identityLoading || uploadBlocked" @click="submit">提交</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.draft-issue-context { display: grid; gap: 5px; padding: 12px; background: var(--el-color-warning-light-9); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.archive-field--focused { outline: 2px solid var(--el-color-primary-light-5); outline-offset: 5px; border-radius: 4px; }
.field-error { color: var(--el-color-danger); font-size: 12px; }
.wizard-form :deep(.el-form-item__error) { position: static; line-height: 1.5; }

.wizard-shell { display: grid; align-content: start; gap: 18px; min-height: 560px; }
.wizard-head { position: sticky; top: -20px; z-index: 3; padding: 14px 0 12px; background: #fff; border-bottom: 1px solid #eef1f6; }
.desktop-steps { padding: 0 8px; }
.mobile-step { display: none; }
.save-state { display: block; margin-top: 8px; color: #98a2b3; font-size: 12px; text-align: right; }
.save-state--saving { color: #667085; }.save-state--saved { color: #16a34a; }.save-state--error { color: #dc2626; }
.wizard-section { padding: 2px 2px 20px; }
.section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.section-head h3 { margin: 0 0 5px; font-size: 16px; }
.empty-contracts { color: var(--el-text-color-secondary); font-size: 13px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
.form-grid--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.form-grid :deep(.el-select), .form-grid :deep(.el-date-editor), .form-grid :deep(.el-input-number), .form-grid :deep(.el-tree-select) { width: 100%; }
.form-grid small { display: block; margin-top: 5px; color: #98a2b3; line-height: 1.4; }
.span-2 { grid-column: span 2; }
.identity-result { margin: 2px 0 8px; padding: 12px; border: 1px solid #dbe7ff; border-radius: 7px; color: #344054; background: #f7faff; font-size: 13px; }
.identity-result--danger { color: #b42318; border-color: #fecdca; background: #fffbfa; }
.identity-candidate { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 8px 0; }
.contract-card { margin-top: 14px; padding: 16px; border: 1px solid #dfe5ee; border-radius: 12px; background: #f8fafc; }
.contract-card__head, .contract-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; }.contract-card__head { margin-bottom: 10px; }
.contract-card__head strong { min-width: 0; overflow-wrap: anywhere; }
.contract-card__head .el-button { flex-shrink: 0; }
.contract-upload-task { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 8px; font-size: 13px; }
.contract-upload-task > span { min-width: 0; overflow-wrap: anywhere; }
.contract-materials { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }.material-group { display: grid; gap: 8px; padding: 12px; border: 1px dashed #cfd7e6; border-radius: 9px; background: #fff; }.material-group small { color: #667085; }
.material-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 7px; background: #f2f4f7; border-radius: 6px; }
.preview-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 16px 0 0; border: 1px solid #e5eaf2; border-radius: 10px; overflow: hidden; }
.preview-grid > div { padding: 14px 16px; border-right: 1px solid #eef1f6; border-bottom: 1px solid #eef1f6; }.preview-grid dt { color: #667085; font-size: 12px; }.preview-grid dd { margin: 5px 0 0; color: #101828; font-weight: 600; }
.submission-process { margin: 16px 0 0; padding-top: 16px; border-top: 1px solid var(--el-border-color-lighter); font-size: 13px; line-height: 1.8; color: var(--el-text-color-secondary); }
.drawer-footer { display: flex; align-items: center; width: 100%; }.footer-spacer { flex: 1; }
@media (max-width: 760px) {
  .wizard-shell { min-height: 0; }.desktop-steps { display: none; }.mobile-step { display: block; }.wizard-head { padding-top: 8px; }
  .form-grid, .form-grid--3, .preview-grid, .contract-materials { grid-template-columns: 1fr; }.span-2 { grid-column: auto; }
  .identity-candidate, .section-head, .contract-toolbar { align-items: flex-start; flex-direction: column; }.drawer-footer { flex-wrap: wrap; gap: 8px; }.drawer-footer .el-button { margin-left: 0; }
}
</style>
