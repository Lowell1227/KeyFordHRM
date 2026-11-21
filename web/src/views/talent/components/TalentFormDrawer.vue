<script setup lang="ts">
import { ref, reactive, computed, watch, onBeforeUnmount } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { Delete, Refresh } from '@element-plus/icons-vue';
import { talentPoolApi } from '@/api/talent-pool.api';
import { talentResumeApi, type ResumeField } from '@/api/talent-resume.api';
import { talentRecruitmentApi } from '@/api/talent-recruitment.api';
import PersonnelReferenceSelect from '@/components/common/PersonnelReferenceSelect.vue';
import { useAuthStore } from '@/stores/auth.store';
import {
  TALENT_STATUSES,
  TALENT_STATUS_LABELS,
  TALENT_SOURCE_CHANNELS,
  TALENT_SOURCE_LABELS,
  TALENT_TAGS,
  TALENT_TAG_LABELS,
  TALENT_GENDERS,
  TALENT_GENDER_LABELS,
  TALENT_PHONE_EXISTS,
  type TalentCandidateDetail,
  type TalentGender,
  type TalentResumeFile,
  type TalentSourceChannel,
  type TalentStatus,
  type TalentTag,
  type TalentRecruitmentOwner,
} from '@/types/talent.types';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import { isImageFile } from '@/utils/image-compress';
import { talentSalaryYuan } from '@/utils/talent-salary';
import {
  TALENT_MAX_FILES,
  TALENT_MAX_FILE_BYTES,
  TALENT_FILE_EXTENSIONS,
  formatTalentFileSize,
  talentFileExtension,
  prepareTalentFile,
  uploadAndBindTalentFile,
  type TalentFileUploadState,
} from './talent-file-upload';
import TalentFileList from './TalentFileList.vue';
import { useTalentPermissions } from '../useTalentPermissions';
import { useResumeTask } from './useResumeTask';

const { canEdit } = useTalentPermissions();
const auth = useAuthStore();

/**
 * 新增 / 编辑候选人抽屉（需求 §5.2）。
 * 手机号查重：blur 即查，命中给出「打开已有记录」并阻止提交；
 * 新建时简历文件先排队，候选人创建成功后再逐个绑定。
 */

const props = defineProps<{
  modelValue: boolean;
  /** 编辑模式传入候选人 ID；不传为新增。 */
  candidateId?: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [candidateId: string];
  'open-existing': [candidateId: string];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => {
    if (!value) invalidateLoad();
    emit('update:modelValue', value);
  },
});

interface PhoneConflict {
  existingId: string;
  existingName: string;
  statusLabel: string;
}

const formRef = ref<FormInstance>();
const loading = ref(false);
const saving = ref(false);
const conflict = ref<PhoneConflict | null>(null);
const pendingFiles = ref<File[]>([]);
const fileUploadStates = new Map<File, TalentFileUploadState>();
const editFiles = ref<TalentResumeFile[]>([]);
const pendingUploading = ref(false);
const persistedCandidateId = ref<string | null>(null);
const effectiveCandidateId = computed(() => props.candidateId ?? persistedCandidateId.value);
const isEdit = computed(() => Boolean(effectiveCandidateId.value));
const removingFileId = ref(''), fileError = ref('');
const saveError = ref('');
const resumeEnabled = ref(false);
const resumeSession = useResumeTask();
const { task: resumeTask, error: resumeConnectionError, recovered: resumeRecovered,
  checking: resumeChecking, acting: resumeActing, elapsed: resumeElapsed, busy: resumeBusy } = resumeSession;
const parsePreparing = ref(false);
const parsing = computed(() => parsePreparing.value || resumeBusy.value);
const recoveringResumeFile = ref(false);
const resumeSourceFile = ref<File | null>(null);
let appliedTaskId = '';
const parseError = ref('');
const parseSummary = ref('');
const parseReview = ref<Array<{ field: string; reason: string }>>([]);
const parseConflicts = ref<Array<{ field: ResumeField; label: string; value: string | number; selected: boolean;
  existing: string | number | null | undefined; negotiable: boolean }>>([]);
const owners = ref<TalentRecruitmentOwner[]>([]);
const ownersLoading = ref(false);
const ownerError = ref('');
const ownerFieldError = ref('');
const educationError = ref('');
const emailError = ref('');
let ownerGeneration = 0;
let parseGeneration = 0;
const loadError = ref('');
const loadedCandidateId = ref<string | null>(null);
const loadedEditVersion = ref('');
const editConflict = ref(false);
let loadGeneration = 0;
const formReady = computed(() => props.modelValue && !loading.value && !loadError.value
  && (!props.candidateId || loadedCandidateId.value === props.candidateId));
const saveDisabled = computed(() => !formReady.value || !canEdit.value || Boolean(conflict.value)
  || editConflict.value || saving.value || pendingUploading.value || parsing.value || resumeChecking.value
  || recoveringResumeFile.value || (Boolean(resumeTask.value) && !resumeSourceFile.value) || Boolean(removingFileId.value));
const fileBusy = computed(() => !formReady.value || !canEdit.value || saving.value || pendingUploading.value
  || recoveringResumeFile.value || Boolean(removingFileId.value));
const resumeStage = computed(() => {
  if (!resumeTask.value) return '';
  if (resumeTask.value.status === 'succeeded') return '解析完成';
  if (resumeTask.value.status === 'failed') return '解析失败';
  if (resumeTask.value.status === 'timed_out') return '解析超时';
  if (!resumeBusy.value) return '已达解析时限，待确认最终状态';
  return resumeTask.value.stage === 'recognizing' ? '正在识别原文' : '正在提取资料';
});

const form = reactive({
  name: '',
  phone: '',
  email: '',
  gender: 'unknown' as TalentGender,
  birthYear: undefined as number | undefined,
  currentCompany: '',
  currentPosition: '',
  yearsOfExperience: undefined as number | undefined,
  appliedPosition: '',
  expectCity: '',
  expectSalaryMin: undefined as number | undefined,
  expectSalaryMax: undefined as number | undefined,
  salaryNegotiable: false,
  education: '',
  educationReferenceDataId: null as string | null,
  ownerId: '',
  school: '',
  major: '',
  sourceChannel: '' as TalentSourceChannel | '',
  tags: [] as TalentTag[],
  note: '',
  status: 'new' as TalentStatus,
});
let savedForm = '';
let confirmingDiscard = false;
const salaryError = ref('');
const salaryNeedsReview = ref(false);
const loadedSalary = reactive({ min: undefined as number | undefined, max: undefined as number | undefined, negotiable: false });
const salaryChanged = computed(() => form.expectSalaryMin !== loadedSalary.min
  || form.expectSalaryMax !== loadedSalary.max || form.salaryNegotiable !== loadedSalary.negotiable);
watch(() => [form.expectSalaryMin, form.expectSalaryMax, form.salaryNegotiable], () => { salaryError.value = ''; });

const rules: FormRules = {
  name: [{ required: true, message: '请填写姓名', trigger: 'blur' }],
  phone: [
    { required: true, message: '请填写手机号', trigger: 'blur' },
    { pattern: /^1\d{10}$/, message: '手机号格式不正确', trigger: 'blur' },
  ],
  sourceChannel: [{ required: true, message: '请选择来源', trigger: 'change' }],
};

const editableStatuses = TALENT_STATUSES.filter((status) => status !== 'hired');

watch(() => [props.modelValue, props.candidateId, auth.user?.id], () => {
  void onOpen();
}, { immediate: true, flush: 'sync' });
onBeforeUnmount(invalidateLoad);

watch(() => form.salaryNegotiable, (negotiable) => {
  if (negotiable) {
    form.expectSalaryMin = undefined;
    form.expectSalaryMax = undefined;
  }
});
watch(() => [form.education, form.educationReferenceDataId], () => { educationError.value = ''; });
watch(() => form.ownerId, () => { ownerFieldError.value = ''; });
watch(() => form.email, () => { emailError.value = ''; });
watch(() => [resumeTask.value, formReady.value && !parsePreparing.value] as const, ([task, ready]) => {
  if (!task || !ready) return;
  if (!resumeSourceFile.value && !recoveringResumeFile.value && !fileError.value) void recoverResumeFile();
  if (task.status === 'succeeded' && !resumeRecovered.value && appliedTaskId !== task.id) applyParsedResult();
});

function invalidateLoad() {
  loadGeneration += 1;
  parseGeneration += 1;
  ownerGeneration += 1;
  resumeSession.stop();
  parsePreparing.value = false;
  recoveringResumeFile.value = false;
  resumeSourceFile.value = null;
  appliedTaskId = '';
  saving.value = false;
  pendingUploading.value = false;
  loadedCandidateId.value = null;
  loadedEditVersion.value = '';
  editConflict.value = false;
  loading.value = false;
  loadError.value = '';
}

function isCurrentLoad(generation: number, candidateId: string | null | undefined) {
  return generation === loadGeneration && props.modelValue && props.candidateId === candidateId;
}

async function onOpen() {
  invalidateLoad();
  const generation = loadGeneration;
  const candidateId = props.candidateId;
  resetForm();
  savedForm = JSON.stringify(form);
  conflict.value = null;
  pendingFiles.value = [];
  fileUploadStates.clear();
  persistedCandidateId.value = null;
  removingFileId.value = ''; fileError.value = '';
  ownerFieldError.value = ''; educationError.value = ''; emailError.value = '';
  saveError.value = '';
  parseError.value = '';
  resumeEnabled.value = false;
  parseSummary.value = '';
  parseReview.value = [];
  parseConflicts.value = [];
  editFiles.value = [];
  formRef.value?.clearValidate();
  if (!props.modelValue) return;
  void loadOwners();
  void resumeSession.open(candidateId ?? 'new');
  void talentResumeApi.status().then(status => {
    if (isCurrentLoad(generation, candidateId)) resumeEnabled.value = status.enabled && status.configured;
  }).catch(() => { if (isCurrentLoad(generation, candidateId)) resumeEnabled.value = false; });
  if (candidateId) {
    loading.value = true;
    try {
      const detail = await talentPoolApi.detail(candidateId);
      if (!isCurrentLoad(generation, candidateId)) return;
      if (detail.id !== candidateId) throw new Error('Candidate detail mismatch');
      fillForm(detail);
      loadedEditVersion.value = detail.editVersion;
      editFiles.value = detail.files;
      loadedCandidateId.value = candidateId;
    } catch {
      if (isCurrentLoad(generation, candidateId)) loadError.value = '人才资料加载失败，请重试后再保存。';
    } finally {
      if (isCurrentLoad(generation, candidateId)) loading.value = false;
    }
  }
}

function resetForm() {
  salaryError.value = ''; salaryNeedsReview.value = false;
  Object.assign(loadedSalary, { min: undefined, max: undefined, negotiable: false });
  Object.assign(form, {
    name: '', phone: '', email: '', gender: 'unknown' as TalentGender,
    birthYear: undefined, currentCompany: '', currentPosition: '', yearsOfExperience: undefined,
    appliedPosition: '', expectCity: '',
    expectSalaryMin: undefined, expectSalaryMax: undefined, salaryNegotiable: false,
    education: '', educationReferenceDataId: null, ownerId: auth.user?.id ?? '', school: '', major: '', sourceChannel: '', tags: [], note: '', status: 'new',
  });
}

function fillForm(detail: TalentCandidateDetail) {
  const salary = talentSalaryYuan(detail);
  salaryNeedsReview.value = salary.needsReview;
  Object.assign(form, {
    name: detail.name,
    phone: detail.phone,
    email: detail.email ?? '',
    gender: detail.gender,
    birthYear: detail.birthYear ?? undefined,
    currentCompany: detail.currentCompany ?? '',
    currentPosition: detail.currentPosition ?? '',
    yearsOfExperience: detail.yearsOfExperience ?? undefined,
    appliedPosition: detail.appliedPosition ?? '',
    expectCity: detail.expectCity ?? '',
    expectSalaryMin: salary.min ?? undefined,
    expectSalaryMax: salary.max ?? undefined,
    salaryNegotiable: !salary.needsReview && salary.min == null && salary.max == null,
    education: detail.education ?? '',
    educationReferenceDataId: detail.educationReferenceDataId ?? null,
    ownerId: detail.ownerId ?? detail.createdById,
    school: detail.school ?? '',
    major: detail.major ?? '',
    sourceChannel: detail.sourceChannel,
    tags: [...detail.tags],
    note: detail.note ?? '',
    status: detail.status,
  });
  Object.assign(loadedSalary, { min: form.expectSalaryMin, max: form.expectSalaryMax, negotiable: form.salaryNegotiable });
  savedForm = JSON.stringify(form);
  conflict.value = null;
}

async function removeSavedFile(file: TalentResumeFile) {
  if (fileBusy.value) return;
  if (resumeTask.value && resumeSourceFile.value && fileUploadStates.get(resumeSourceFile.value)?.bound?.id === file.id) {
    fileError.value = '请先清除解析任务，再移除对应文件。'; return;
  }
  const candidateId = effectiveCandidateId.value, targetId = props.candidateId, generation = loadGeneration;
  if (!candidateId) return;
  try {
    await ElMessageBox.confirm(`移除「${file.fileName}」？文件保留，仅解除关联。`, '移除简历文件',
      { confirmButtonText: '移除', cancelButtonText: '取消', type: 'warning' });
  } catch { return; }
  if (!isCurrentLoad(generation, targetId) || fileBusy.value) return;
  removingFileId.value = file.id; fileError.value = '';
  try {
    await talentPoolApi.unbindFile(candidateId, file.id);
    if (!isCurrentLoad(generation, targetId)) return;
    editFiles.value = editFiles.value.filter(item => item.id !== file.id);
    emit('saved', candidateId);
  } catch { if (isCurrentLoad(generation, targetId)) fileError.value = '移除简历失败，请重试。'; }
  finally { if (isCurrentLoad(generation, targetId)) removingFileId.value = ''; }
}

/** 手机号失焦查重（需求 §5.2：命中显示姓名+状态，可打开已有记录）。 */
async function checkPhoneDuplicate() {
  conflict.value = null;
  const generation = loadGeneration;
  const candidateId = props.candidateId;
  const phone = form.phone;
  if (!formReady.value) return;
  if (!/^1\d{10}$/.test(form.phone)) return;
  try {
    const result = await talentPoolApi.checkPhone(phone);
    if (!isCurrentLoad(generation, candidateId) || form.phone !== phone) return;
    if (result.exists && result.candidate && result.candidate.id !== (props.candidateId ?? persistedCandidateId.value)) {
      conflict.value = {
        existingId: result.candidate.id,
        existingName: result.candidate.name,
        statusLabel: result.candidate.statusLabel,
      };
    }
  } catch {
    // 查询失败不阻断填写，提交时服务端仍会校验
  }
}

async function beforeClose(done: () => void) {
  if (saving.value || pendingUploading.value || confirmingDiscard) return;
  if (JSON.stringify(form) === savedForm && pendingFiles.value.length === 0) {
    done();
    return;
  }
  const generation = loadGeneration, candidateId = props.candidateId;
  confirmingDiscard = true;
  try {
    await ElMessageBox.confirm('当前资料或待传文件尚未保存，是否放弃修改？', '放弃未保存修改？', {
      confirmButtonText: '放弃修改', cancelButtonText: '继续编辑', type: 'warning', closeOnClickModal: false,
    });
    if (isCurrentLoad(generation, candidateId)) done();
  } catch { /* 继续编辑。 */ }
  finally { confirmingDiscard = false; }
}

function openExisting() {
  const existingId = conflict.value?.existingId;
  if (!existingId) return;
  void beforeClose(() => {
    visible.value = false;
    emit('open-existing', existingId);
  });
}

function onPendingPick(event: Event) {
  const input = event.target as HTMLInputElement;
  const picked = input.files ? Array.from(input.files) : [];
  input.value = '';
  if (fileBusy.value) return;
  const room = TALENT_MAX_FILES - editFiles.value.length - pendingFiles.value.length;
  if (picked.length > room) {
    ElMessage.warning(`简历文件最多 ${TALENT_MAX_FILES} 个`);
    return;
  }
  const accepted = picked.filter((file) => {
    // 与 uploadAndBindTalentFile 同一套校验前置：类型不符直接拒；
    // 非图片超过 10MB 直接拒；图片在解析与上传前共用压缩结果。
    if (!TALENT_FILE_EXTENSIONS.includes(talentFileExtension(file.name))) {
      ElMessage.error(`不支持的文件类型：${file.name}（仅支持 PDF/DOC/DOCX/JPG/PNG）`);
      return false;
    }
    if (!isImageFile(file) && file.size > TALENT_MAX_FILE_BYTES) {
      ElMessage.error(`${file.name} 超过 10MB，请压缩后重试`);
      return false;
    }
    if (pendingFiles.value.some((item) => item.name === file.name && item.size === file.size)) {
      ElMessage.warning(`「${file.name}」已在待上传列表中`);
      return false;
    }
    return true;
  });
  pendingFiles.value.push(...accepted);
  if (accepted[0] && resumeEnabled.value) void parseResume(accepted[0]);
}

function removePending(file: File) {
  if (fileBusy.value || parsing.value) return;
  if (resumeTask.value && file === resumeSourceFile.value) {
    parseError.value = '请先清除解析任务，再移除对应文件。'; return;
  }
  parseGeneration += 1;
  parseConflicts.value = [];
  pendingFiles.value = pendingFiles.value.filter((item) => item !== file);
  fileUploadStates.delete(file);
}

async function loadOwners(keyword = '') {
  const generation = ++ownerGeneration;
  ownersLoading.value = true;
  ownerError.value = '';
  try {
    const result = await talentRecruitmentApi.owners({ keyword, pageSize: 50 });
    if (generation === ownerGeneration) owners.value = result.items;
  } catch { if (generation === ownerGeneration) ownerError.value = '负责人读取失败，请重试'; }
  finally { if (generation === ownerGeneration) ownersLoading.value = false; }
}

const resumeLabels: Record<ResumeField, string> = {
  name: '姓名', phone: '手机', email: '邮箱', birthYear: '出生年份', currentCompany: '当前公司',
  currentPosition: '当前职位', yearsOfExperience: '工作年限', education: '学历', school: '院校', major: '专业',
  appliedPosition: '意向岗位', expectCity: '期望城市', expectSalaryMin: '最低薪资（元/月）', expectSalaryMax: '最高薪资（元/月）',
};
function applyResumeField(field: ResumeField, value: string | number) {
  Object.assign(form, { [field]: value });
  if (field === 'education') form.educationReferenceDataId = null;
  if (field === 'expectSalaryMin' || field === 'expectSalaryMax') form.salaryNegotiable = false;
}
async function parseResume(file: File) {
  if (fileBusy.value || parsing.value) return;
  const request = ++parseGeneration, generation = loadGeneration, candidateId = props.candidateId;
  parsePreparing.value = true;
  parseError.value = '';
  parseSummary.value = '';
  parseConflicts.value = [];
  parseReview.value = [];
  try {
    const state = fileUploadStates.get(file) ?? {};
    fileUploadStates.set(file, state);
    const prepared = await prepareTalentFile(file, state);
    if (request !== parseGeneration || !isCurrentLoad(generation, candidateId)) return;
    if (prepared.size > TALENT_MAX_FILE_BYTES) {
      parseError.value = '照片压缩后仍超过 10MB，请换用较小文件；原文件已保留。';
      return;
    }
    if (!resumeEnabled.value || resumeChecking.value) return;
    if (!pendingFiles.value.includes(file)) {
      if (editFiles.value.length + pendingFiles.value.length >= TALENT_MAX_FILES) return;
      pendingFiles.value.push(file);
    }
    const previousTaskId = resumeTask.value?.id, previousSource = resumeSourceFile.value;
    const accepted = await resumeSession.start(prepared);
    if (request !== parseGeneration || !isCurrentLoad(generation, candidateId)) return;
    if (accepted && !resumeRecovered.value) resumeSourceFile.value = file;
    else resumeSourceFile.value = resumeTask.value?.id === previousTaskId ? previousSource : null;
  } catch (error) {
    if (request !== parseGeneration || !isCurrentLoad(generation, candidateId)) return;
    const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
    parseError.value = typeof message === 'string' ? message : '解析失败，可重试或手工填写，文件已保留';
  } finally { if (request === parseGeneration) parsePreparing.value = false; }
}

async function recoverResumeFile() {
  const task = resumeTask.value, generation = loadGeneration, candidateId = props.candidateId;
  if (!task || !formReady.value || recoveringResumeFile.value || resumeSourceFile.value) return;
  recoveringResumeFile.value = true; fileError.value = '';
  try {
    const blob = await talentResumeApi.file(task.id);
    if (!isCurrentLoad(generation, candidateId) || resumeTask.value?.id !== task.id) return;
    const candidates = pendingFiles.value.filter(original => {
      const prepared = fileUploadStates.get(original)?.file ?? original;
      return prepared.name === task.fileName && prepared.size === blob.size;
    });
    if (candidates.length) {
      const source = new Uint8Array(await blob.arrayBuffer());
      for (const original of candidates) {
        const prepared = fileUploadStates.get(original)?.file ?? original;
        const bytes = new Uint8Array(await prepared.arrayBuffer());
        if (!isCurrentLoad(generation, candidateId) || resumeTask.value?.id !== task.id) return;
        if (bytes.every((value, index) => value === source[index])) { resumeSourceFile.value = original; return; }
      }
    }
    if (pendingFiles.value.length + editFiles.value.length >= TALENT_MAX_FILES) {
      fileError.value = '待恢复简历未加入：文件已达上限，请移除其他文件后重试恢复。'; return;
    }
    const file = new File([blob], task.fileName, { type: blob.type || 'application/octet-stream' });
    pendingFiles.value.push(file);
    fileUploadStates.set(file, { file });
    resumeSourceFile.value = file;
  } catch {
    if (isCurrentLoad(generation, candidateId) && resumeTask.value?.id === task.id) {
      fileError.value = '原简历恢复失败，请重试恢复；当前输入已保留。';
    }
  } finally { if (isCurrentLoad(generation, candidateId)) recoveringResumeFile.value = false; }
}

function applyParsedResult() {
  const task = resumeTask.value, result = task?.result;
  if (!formReady.value || saving.value || pendingUploading.value || task?.status !== 'succeeded' || !result) return;
  parseConflicts.value = [];
  let applied = 0;
  for (const field of Object.keys(resumeLabels) as ResumeField[]) {
    const rawValue = result.fields[field];
    // The resume API retains K units for existing clients; this form edits integer yuan.
    const value = typeof rawValue === 'number' && (field === 'expectSalaryMin' || field === 'expectSalaryMax')
      ? Math.round(rawValue * 1000) : rawValue;
    if (value === undefined || value === '') continue;
    const existing = form[field];
    const negotiable = form.salaryNegotiable && (field === 'expectSalaryMin' || field === 'expectSalaryMax');
    if (!negotiable && (existing === '' || existing === undefined || existing === null)) {
      applyResumeField(field, value); applied++;
    } else if (negotiable || String(existing) !== String(value)) {
      parseConflicts.value.push({ field, label: `${resumeLabels[field]}${negotiable ? '（当前面议）' : ''}`,
        value, selected: false, existing, negotiable });
    }
  }
  appliedTaskId = task.id;
  parseReview.value = result.reviewItems;
  parseSummary.value = applied ? `已填入 ${applied} 项，请核对后提交` : '解析完成，请核对资料';
  void checkPhoneDuplicate();
}

async function retryResumeTask() {
  if (fileBusy.value || parsing.value || !resumeEnabled.value) return;
  parseError.value = ''; parseSummary.value = ''; parseConflicts.value = []; parseReview.value = [];
  await resumeSession.retry();
}

async function clearResumeTask() {
  const generation = loadGeneration, candidateId = props.candidateId;
  if (fileBusy.value || resumeActing.value) return;
  try {
    await ElMessageBox.confirm('清除临时解析任务及结果？已填写的资料和待上传文件会保留。', '清除解析任务',
      { confirmButtonText: '清除解析任务', cancelButtonText: '保留任务', type: 'warning' });
  } catch { return; }
  if (!isCurrentLoad(generation, candidateId) || fileBusy.value) return;
  if (await resumeSession.clear() && isCurrentLoad(generation, candidateId)) {
    resumeSourceFile.value = null; appliedTaskId = '';
    parseError.value = ''; parseSummary.value = ''; parseConflicts.value = []; parseReview.value = []; fileError.value = '';
    if (saveError.value === '人才资料和附件已保存，临时解析任务尚未清除，请重试清除任务。') saveError.value = '';
  }
}
function applySelectedParsedFields() {
  if (!formReady.value || saving.value || pendingUploading.value) return;
  const negotiable = form.salaryNegotiable;
  for (const item of parseConflicts.value.filter(item => item.selected)) {
    const salary = item.field === 'expectSalaryMin' || item.field === 'expectSalaryMax';
    if (form[item.field] !== item.existing || (salary && negotiable !== item.negotiable)) {
      item.selected = false; item.existing = form[item.field]; item.negotiable = salary && negotiable;
      parseSummary.value = '填写内容已变化，请重新核对并选择需要替换的字段。';
    } else applyResumeField(item.field, item.value);
  }
  parseConflicts.value = parseConflicts.value.filter(item => !item.selected);
  void checkPhoneDuplicate();
}

function pendingFileKind(file: File): string {
  return isImageFile(file) ? '图片' : '文档';
}

/** 服务端字段错误与版本冲突保留在当前表单，不自动覆盖输入。 */
function captureConflict(error: unknown) {
  const failure = (error as { response?: { status?: number; data?: { message?: string | string[]; data?: {
    reason?: string; existingId?: string; existingName?: string; fieldErrors?: Record<string, string>;
  } } } })?.response;
  const response = failure?.data;
  const data = response?.data;
  if (data?.reason === TALENT_PHONE_EXISTS && data.existingId) {
    conflict.value = { existingId: data.existingId, existingName: data.existingName ?? '', statusLabel: '' };
  }
  if (data?.reason === 'TALENT_EDIT_CONFLICT') editConflict.value = true;
  educationError.value = data?.fieldErrors?.educationReferenceDataId ?? '';
  ownerFieldError.value = data?.fieldErrors?.ownerId ?? '';
  const messages = Array.isArray(response?.message) ? response.message : typeof response?.message === 'string' ? [response.message] : [];
  emailError.value = failure?.status === 400 ? data?.fieldErrors?.email ?? messages.find(message => /邮箱|\bemail\b/i.test(message)) ?? '' : '';
  const message = messages.join('；');
  if (!ownerFieldError.value && message.includes('负责人')) ownerFieldError.value = message;
  if (emailError.value) return messages.filter(item => item !== emailError.value).join('；');
  return message || (failure?.status === 403 ? '无权限执行此操作' : '');
}

async function reloadAfterConflict() {
  const generation = loadGeneration, targetId = props.candidateId, candidateId = effectiveCandidateId.value;
  if (!candidateId || fileBusy.value) return;
  try {
    await ElMessageBox.confirm('重新加载会替换当前未保存的内容。请先保留需要的输入。', '重新加载最新资料',
      { confirmButtonText: '重新加载', cancelButtonText: '继续保留输入', type: 'warning' });
  } catch { return; }
  if (!isCurrentLoad(generation, targetId) || fileBusy.value) return;
  const reloadGeneration = ++loadGeneration;
  ++parseGeneration; parsePreparing.value = false; loading.value = true; saveError.value = '';
  try {
    const detail = await talentPoolApi.detail(candidateId);
    if (!isCurrentLoad(reloadGeneration, targetId)) return;
    if (detail.id !== candidateId) throw new Error('Candidate detail mismatch');
    fillForm(detail); loadedCandidateId.value = candidateId; loadedEditVersion.value = detail.editVersion;
    editFiles.value = detail.files; conflict.value = null; editConflict.value = false;
    ownerFieldError.value = ''; educationError.value = ''; emailError.value = '';
    parseConflicts.value = []; parseReview.value = []; parseSummary.value = ''; parseError.value = '';
  } catch {
    if (isCurrentLoad(reloadGeneration, targetId)) saveError.value = '最新资料读取失败，当前输入及待传文件已保留，请重试。';
  } finally { if (isCurrentLoad(reloadGeneration, targetId)) loading.value = false; }
}

async function submit() {
  if (saveDisabled.value) return;
  const generation = loadGeneration;
  const targetId = props.candidateId;
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid || !isCurrentLoad(generation, targetId) || saveDisabled.value) return;
  if (!form.salaryNegotiable && [form.expectSalaryMin, form.expectSalaryMax].some(value => value != null
    && (!Number.isInteger(value) || value < 0 || value > 2147483647))) {
    salaryError.value = '薪资请填写非负整数元/月'; return;
  }
  if (!form.salaryNegotiable && form.expectSalaryMin != null && form.expectSalaryMax != null
    && form.expectSalaryMin > form.expectSalaryMax) {
    salaryError.value = '期望薪资下限不能高于上限'; return;
  }
  saving.value = true;
  saveError.value = '';
  educationError.value = ''; ownerFieldError.value = ''; emailError.value = '';
  let savedCandidateId = '';
  const editing = isEdit.value;
  try {
    const body = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      gender: form.gender,
      birthYear: form.birthYear ?? null,
      currentCompany: form.currentCompany.trim() || null,
      currentPosition: form.currentPosition.trim() || null,
      yearsOfExperience: form.yearsOfExperience ?? null,
      appliedPosition: form.appliedPosition.trim() || null,
      expectCity: form.expectCity.trim() || null,
      ...(!isEdit.value || salaryChanged.value ? {
        expectSalaryMinYuan: form.salaryNegotiable ? null : (form.expectSalaryMin ?? null),
        expectSalaryMaxYuan: form.salaryNegotiable ? null : (form.expectSalaryMax ?? null),
      } : {}),
      education: form.education || null,
      educationReferenceDataId: form.educationReferenceDataId,
      ownerId: form.ownerId || undefined,
      school: form.school.trim() || null,
      major: form.major.trim() || null,
      sourceChannel: form.sourceChannel as TalentSourceChannel,
      tags: form.tags,
      note: form.note.trim() || null,
      ...(isEdit.value && form.status !== 'hired' ? { status: form.status } : {}),
    };
    let candidateId = targetId ?? persistedCandidateId.value ?? '';
    if (candidateId) {
      if (!loadedEditVersion.value) {
        const latest = await talentPoolApi.detail(candidateId);
        if (!isCurrentLoad(generation, targetId)) return;
        loadedEditVersion.value = latest.editVersion;
      }
      const saved = await talentPoolApi.update(candidateId, { ...body, editVersion: loadedEditVersion.value }, { skipErrorMessage: true });
      if (isCurrentLoad(generation, targetId)) loadedEditVersion.value = saved.editVersion;
    } else {
      const created = await talentPoolApi.create(body, { skipErrorMessage: true });
      candidateId = created.id;
      if (isCurrentLoad(generation, targetId)) {
        persistedCandidateId.value = candidateId;
        loadedEditVersion.value = created.editVersion;
      }
    }
    if (!isCurrentLoad(generation, targetId)) return;
    savedCandidateId = candidateId;
    savedForm = JSON.stringify(form);
    if (pendingFiles.value.length > 0) {
      pendingUploading.value = true;
      for (const file of [...pendingFiles.value]) {
        if (!isCurrentLoad(generation, targetId)) return;
        const state = fileUploadStates.get(file) ?? {};
        fileUploadStates.set(file, state);
        const bound = await uploadAndBindTalentFile(candidateId, file, state, () => isCurrentLoad(generation, targetId));
        if (!bound) throw new Error('Attachment not bound');
        if (isCurrentLoad(generation, targetId)) {
          if (state.bound && !editFiles.value.some(item => item.id === state.bound!.id)) editFiles.value.push(state.bound);
          pendingFiles.value = pendingFiles.value.filter(item => item !== file);
        }
      }
    }
    if (!isCurrentLoad(generation, targetId)) return;
    if (resumeTask.value && !await resumeSession.clear()) {
      if (isCurrentLoad(generation, targetId)) {
        saveError.value = '人才资料和附件已保存，临时解析任务尚未清除，请重试清除任务。';
        emit('saved', candidateId);
      }
      return;
    }
    if (!isCurrentLoad(generation, targetId)) return;
    ElMessage.success(editing ? '已保存修改' : '已加入人才库');
    emit('saved', candidateId);
    visible.value = false;
  } catch (error) {
    if (isCurrentLoad(generation, targetId)) {
      const message = captureConflict(error);
      saveError.value = savedCandidateId
        ? `人才资料已保存，附件未全部上传。${message ? `${message}。` : ''}未完成的文件已保留，可重试。`
        : editConflict.value ? '资料已更新，本次修改尚未保存，输入及待传文件已保留。'
        : message || (emailError.value ? '' : '保存失败，请核对填写内容后重试');
      if (savedCandidateId) emit('saved', savedCandidateId);
    }
  } finally {
    if (isCurrentLoad(generation, targetId)) {
      saving.value = false;
      pendingUploading.value = false;
    }
  }
}
</script>

<template>
  <BusinessDetailDrawer v-model="visible" :title="isEdit ? '编辑人才' : '新增人才'"
    :loading="loading" :saving="saving || pendingUploading" :before-close="beforeClose" variant="standard" class="talent-form-drawer">
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon>
      <el-button link type="primary" @click="onOpen">重新加载</el-button>
    </el-alert>
    <el-alert v-if="editConflict" title="资料已更新，当前输入已保留。请核对最新资料后再保存。" type="warning" :closable="false" show-icon>
      <el-button link type="primary" @click="reloadAfterConflict">重新加载最新资料</el-button>
    </el-alert>
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" class="talent-form"
      :disabled="!formReady || saving || pendingUploading"
      @submit.prevent="submit">
      <h4 class="talent-form__group-title">简历文件</h4>
      <div v-for="file in editFiles" :key="file.id" class="talent-form__saved-file">
        <TalentFileList v-if="effectiveCandidateId && formReady" :candidate-id="effectiveCandidateId" :files="[file]" />
        <el-tooltip content="移除简历文件"><el-button :icon="Delete" :aria-label="`移除简历 ${file.fileName}`" :disabled="fileBusy" :loading="removingFileId === file.id" size="small" type="danger" plain @click="removeSavedFile(file)" /></el-tooltip>
      </div>
      <div v-if="fileError" role="alert" class="talent-form__error">{{ fileError }}</div>
      <template v-if="editFiles.length + pendingFiles.length < TALENT_MAX_FILES || pendingFiles.length">
        <div v-for="file in pendingFiles" :key="file.name + file.size" class="talent-form__pending">
          <el-icon><component :is="isImageFile(file) ? 'Picture' : 'Document'" /></el-icon>
          <span class="talent-form__pending-name">{{ file.name }}</span>
          <span class="talent-form__pending-meta">{{ pendingFileKind(file) }} · {{ formatTalentFileSize(file.size) }}</span>
          <el-button v-if="resumeEnabled" link type="primary" :disabled="parsing || fileBusy || resumeChecking" @click="parseResume(file)">解析</el-button>
          <el-button link type="danger" :disabled="fileBusy || parsing || (Boolean(resumeTask) && file === resumeSourceFile)" @click="removePending(file)">移除</el-button>
        </div>
        <div class="talent-form__upload-row">
          <input id="talent-form-file-input" type="file" class="talent-form__hidden-input" multiple :disabled="fileBusy"
            accept=".pdf,.doc,.docx,image/*" @change="onPendingPick" />
          <input id="talent-form-camera-input" type="file" class="talent-form__hidden-input" accept="image/*" :disabled="fileBusy"
            capture="environment" @change="onPendingPick" />
          <label for="talent-form-file-input" class="el-button el-button--default talent-form__pick" :class="{ 'is-disabled': fileBusy }" :aria-disabled="fileBusy">
            <el-icon><Plus /></el-icon><span>添加文件</span>
          </label>
          <label for="talent-form-camera-input" class="el-button el-button--primary talent-form__pick" :class="{ 'is-disabled': fileBusy }" :aria-disabled="fileBusy">
            <el-icon><Camera /></el-icon><span>拍照上传</span>
          </label>
          <span class="talent-form__hint">PDF/DOC/DOCX/JPG/PNG，单个 ≤10MB，最多 {{ TALENT_MAX_FILES }} 个<template v-if="resumeEnabled">，由 DeepSeek 解析</template></span>
        </div>
      </template>
      <div v-if="resumeTask" class="talent-form__resume-task" data-testid="resume-task">
        <div role="status" class="talent-form__task-status">
          <strong>{{ resumeStage }}</strong><span v-if="resumeTask.status === 'processing' || resumeActing">已用 {{ resumeElapsed }} 秒 / 最长 150 秒</span>
        </div>
        <div class="talent-form__task-file">{{ resumeTask.fileName }}</div>
        <div class="talent-form__hint">临时文件及结果保留 30 分钟，至 {{ new Date(resumeTask.expiresAt).toLocaleTimeString() }}</div>
        <div v-if="resumeTask.message" class="talent-form__hint">{{ resumeTask.message }}</div>
        <div v-if="recoveringResumeFile" role="status" class="talent-form__hint">正在恢复原简历文件</div>
        <div class="talent-form__task-actions">
          <el-button v-if="resumeTask.status === 'succeeded' && resumeTask.result" size="small" type="primary"
            :disabled="!formReady || saving || pendingUploading" @click="applyParsedResult">填入解析结果</el-button>
          <el-button v-if="resumeTask.status === 'failed' || resumeTask.status === 'timed_out'" size="small" :icon="Refresh"
            :disabled="!resumeEnabled || fileBusy || parsing || resumeChecking" @click="retryResumeTask">重新解析</el-button>
          <el-button v-if="!resumeSourceFile" size="small" :loading="recoveringResumeFile" :disabled="!formReady || saving || pendingUploading"
            @click="recoverResumeFile">重试恢复原文件</el-button>
          <el-button size="small" :icon="Delete" :disabled="fileBusy || resumeActing" @click="clearResumeTask">清除解析任务</el-button>
        </div>
      </div>
      <div v-if="parsePreparing || (resumeActing && !resumeTask)" role="status" class="talent-form__hint">正在提交简历解析任务</div>
      <div v-if="resumeChecking && !resumeTask" role="status" class="talent-form__hint">正在读取已有解析任务</div>
      <div v-if="!resumeEnabled" role="status" class="talent-form__hint">简历解析未启用，可手工填写</div>
      <div v-if="resumeConnectionError" role="alert" class="talent-form__error">
        {{ resumeConnectionError }}
        <el-button link type="primary" :icon="Refresh" :disabled="resumeChecking || resumeActing || !formReady"
          @click="resumeSession.refresh">重新连接</el-button>
      </div>
      <div v-if="parseError" role="alert" class="talent-form__error">{{ parseError }}</div>
      <div v-if="parseSummary" role="status" class="talent-form__hint">{{ parseSummary }}</div>
      <div v-if="parseConflicts.length" class="talent-form__parse-conflicts">
        <div v-for="item in parseConflicts" :key="item.field">
          <el-checkbox v-model="item.selected">{{ item.label }}：{{ item.value }}</el-checkbox>
        </div>
        <el-button size="small" :disabled="!parseConflicts.some(item => item.selected)" @click="applySelectedParsedFields">替换所选字段</el-button>
      </div>
      <div v-for="(item, index) in parseReview" :key="index" class="talent-form__hint">{{ resumeLabels[item.field as ResumeField] || item.field }}：{{ item.reason }}</div>

      <h4 class="talent-form__group-title">基本信息</h4>
      <el-form-item label="姓名" prop="name">
        <el-input v-model="form.name" placeholder="候选人姓名" maxlength="30" />
      </el-form-item>
      <el-form-item label="手机" prop="phone">
        <el-input v-model="form.phone" placeholder="11 位手机号" maxlength="11" @blur="checkPhoneDuplicate" />
        <div v-if="conflict" class="talent-form__conflict">
          <span class="talent-form__conflict-text">
            该手机号已在库：{{ conflict.existingName }}<template v-if="conflict.statusLabel">（{{ conflict.statusLabel }}）</template>
          </span>
          <el-button link type="primary" @click="openExisting">打开已有记录</el-button>
        </div>
      </el-form-item>
      <el-form-item label="邮箱" prop="email" :error="emailError">
        <el-input v-model="form.email" placeholder="选填" maxlength="100" />
      </el-form-item>
      <el-form-item label="性别">
        <el-radio-group v-model="form.gender">
          <el-radio-button v-for="g in TALENT_GENDERS" :key="g" :value="g">{{ TALENT_GENDER_LABELS[g] }}</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="出生年份">
        <el-input-number v-model="form.birthYear" :min="1940" :max="new Date().getFullYear()" :controls="false"
          placeholder="选填" class="talent-form__year" />
      </el-form-item>
      <el-form-item label="当前公司">
        <el-input v-model="form.currentCompany" placeholder="选填" maxlength="50" />
      </el-form-item>
      <el-form-item label="当前职位">
        <el-input v-model="form.currentPosition" placeholder="选填" maxlength="50" />
      </el-form-item>
      <el-form-item label="工作年限">
        <el-input-number v-model="form.yearsOfExperience" :min="0" :max="60" :controls="false" placeholder="年"
          class="talent-form__year" />
      </el-form-item>

      <h4 class="talent-form__group-title">求职意向</h4>
      <el-form-item label="意向岗位">
        <el-input v-model="form.appliedPosition" placeholder="选填" maxlength="50" />
      </el-form-item>
      <el-form-item label="期望城市">
        <el-input v-model="form.expectCity" placeholder="选填" maxlength="30" />
      </el-form-item>
      <el-form-item label="期望薪资（元/月）" :error="salaryError">
        <div class="talent-form__salary">
          <el-input-number v-model="form.expectSalaryMin" :controls="false" placeholder="最低"
            :disabled="form.salaryNegotiable" @change="form.salaryNegotiable = false" />
          <span class="talent-form__salary-sep">–</span>
          <el-input-number v-model="form.expectSalaryMax" :controls="false" placeholder="最高"
            :disabled="form.salaryNegotiable" @change="form.salaryNegotiable = false" />
          <el-checkbox v-model="form.salaryNegotiable">面议</el-checkbox>
        </div>
        <span v-if="salaryNeedsReview && !salaryChanged" class="talent-form__salary-review">历史薪资待核对，原值保留；核实后重新填写。</span>
      </el-form-item>
      <el-form-item label="学历" :error="educationError">
        <PersonnelReferenceSelect v-model="form.education" v-model:reference-id="form.educationReferenceDataId" kind="education" />
      </el-form-item>
      <el-form-item label="院校">
        <el-input v-model="form.school" placeholder="选填" maxlength="50" />
      </el-form-item>
      <el-form-item label="专业">
        <el-input v-model="form.major" placeholder="选填" maxlength="50" />
      </el-form-item>
      <el-form-item label="来源" prop="sourceChannel">
        <el-select v-model="form.sourceChannel" data-testid="talent-form-source" placeholder="请选择来源" class="talent-form__full">
          <el-option v-for="s in TALENT_SOURCE_CHANNELS" :key="s" :label="TALENT_SOURCE_LABELS[s]" :value="s" />
        </el-select>
      </el-form-item>
      <el-form-item label="人才负责人" :error="ownerFieldError || ownerError">
        <el-select v-model="form.ownerId" filterable remote :remote-method="loadOwners" :loading="ownersLoading" class="talent-form__full">
          <el-option v-for="owner in owners" :key="owner.id" :value="owner.id" :label="owner.name" />
        </el-select>
        <el-button v-if="ownerError" link @click="loadOwners()">重试</el-button>
      </el-form-item>
      <el-form-item label="标签（最多 5 个）">
        <el-select v-model="form.tags" multiple :multiple-limit="5" collapse-tags clearable placeholder="选填"
          class="talent-form__full">
          <el-option v-for="t in TALENT_TAGS" :key="t" :label="TALENT_TAG_LABELS[t]" :value="t" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="isEdit && form.status !== 'hired'" label="人才库状态">
        <el-select v-model="form.status" data-testid="talent-form-status" class="talent-form__full">
          <el-option v-for="s in editableStatuses" :key="s" :label="TALENT_STATUS_LABELS[s]" :value="s" />
        </el-select>
      </el-form-item>
      <el-form-item v-else-if="isEdit" label="人才库状态"><span>已入职</span></el-form-item>

      <h4 class="talent-form__group-title">备注</h4>
      <el-form-item label="备注">
        <el-input v-model="form.note" type="textarea" :rows="3" maxlength="500" show-word-limit
          placeholder="选填，如沟通要点、淘汰原因建议写在这里" />
      </el-form-item>
    </el-form>
    <div v-if="saveError" role="alert" class="talent-form__error">{{ saveError }}</div>
    <template #footer>
      <el-button :disabled="saving || pendingUploading" @click="beforeClose(() => { visible = false; })">取消</el-button>
      <el-button type="primary" :loading="saving || pendingUploading" :disabled="saveDisabled" @click="submit">
        {{ isEdit ? '保存修改' : '加入人才库' }}
      </el-button>
    </template>
  </BusinessDetailDrawer>
</template>

<style scoped>
.talent-form__group-title {
  margin: 18px 0 4px;
  font-size: 14px;
  color: var(--el-text-color-primary);
}
.talent-form__group-title:first-child { margin-top: 0; }
.talent-form__full { width: 100%; }
.talent-form__year { width: 120px; }
.talent-form__salary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.talent-form__salary :deep(.el-input-number) { width: 90px; }
.talent-form__salary-review { display: block; margin-top: 6px; color: var(--el-color-warning-dark-2); font-size: 12px; line-height: 1.5; }
.talent-form__salary-sep { color: var(--el-text-color-secondary); }
.talent-form__conflict {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 18px;
}
.talent-form__hint {
  width: 100%;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 18px;
}
.talent-form__error { color: var(--el-color-danger); font-size: 13px; line-height: 20px; margin: 8px 0; }
.talent-form__parse-conflicts { padding: 8px 0; border-block: 1px solid var(--el-border-color-light); }
.talent-form__parse-conflicts :deep(.el-checkbox__label) { white-space: normal; overflow-wrap: anywhere; }
.talent-form__resume-task { padding: 10px 0; margin-bottom: 8px; border-block: 1px solid var(--el-border-color-light); }
.talent-form__task-status, .talent-form__task-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.talent-form__task-status { justify-content: space-between; font-size: 13px; line-height: 20px; }
.talent-form__task-file { overflow-wrap: anywhere; font-size: 13px; line-height: 20px; }
.talent-form__task-actions { margin-top: 8px; }
.talent-form__task-actions :deep(.el-button) { margin-left: 0; }
.talent-form__pending {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
  margin-bottom: 6px;
  font-size: 13px;
}
.talent-form__pending-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.talent-form__pending-meta {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.talent-form__hidden-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
}
.talent-form__upload-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.talent-form__pick {
  cursor: pointer;
  margin-left: 0;
}
.talent-form__pick.is-disabled { cursor: not-allowed; opacity: 0.55; }
.talent-form__saved-file { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; margin-bottom: 6px; }
</style>
