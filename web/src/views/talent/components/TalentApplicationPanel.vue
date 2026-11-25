<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, Refresh } from '@element-plus/icons-vue';
import { ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { useRecruitmentLeaveGuard } from '../useRecruitmentLeaveGuard';
import { useTalentPermissions } from '../useTalentPermissions';
import { departmentsApi } from '@/api/departments.api';
import { recruitmentError, talentRecruitmentApi } from '@/api/talent-recruitment.api';
import { recruitmentDemandsApi } from '@/api/recruitment-demands.api';
import type { RecruitmentDemandDirectories, RecruitmentDemandStatus, RecruitmentDemandView } from '@/types/recruitment-demand.types';
import { demandErrorMessage, demandOriginLabel, demandReference, isLocalDemand } from '@/views/recruitment/demand-presentation';
import RecruitmentDemandSummary from '@/views/recruitment/components/RecruitmentDemandSummary.vue';
import { canAccessRoute } from '@/router/navigation';
import { useAuthStore } from '@/stores/auth.store';
import type { Department } from '@/types/api.types';
import {
  APPLICATION_ACTION_LABELS, APPLICATION_STAGE_LABELS,
  TALENT_RESERVE_REASON_LABELS, TALENT_SOURCE_CHANNELS, TALENT_SOURCE_LABELS,
  type TalentApplicationAction, type TalentApplicationMatch, type TalentApplicationView, type TalentRecruitmentOwner, type TalentReserveReason,
  type TalentSourceChannel,
} from '@/types/talent.types';
import { formatDate } from '@/utils/date';

const props = defineProps<{
  candidateId: string;
  editable: boolean;
  convertedUserId?: string | null;
  applicationMatch?: TalentApplicationMatch;
  beforeSwitch?: () => Promise<boolean>;
}>();
const emit = defineEmits<{ changed: []; selected: [application: TalentApplicationView | null]; interview: [application: Pick<TalentApplicationView, 'id' | 'positionName' | 'recruitmentBatch'>] }>();
const router = useRouter();
const auth = useAuthStore();
const { canEdit: canEditRecruitment, canOnboard: canMaintainArchive } = useTalentPermissions();
const canViewArchive = computed(() => !auth.user?.isAssessorOnly && (canMaintainArchive.value
  || (auth.user?.sysRole === 'hr_user' && auth.user.hrCapabilities?.includes('employee_archive_review'))));
const rows = ref<TalentApplicationView[]>([]), selectedId = ref(''), current = ref<TalentApplicationView | null>(null);
const loading = ref(false), busy = ref(false), error = ref(''), loadFailed = ref(false), conflict = ref(false);
const confirming = ref(false), hiringNeedsRefresh = ref(false), actionResult = ref('');
const actionResultUnknown = ref(false);
const selectionError = ref('');
const editing = ref(false), creating = ref(false), formRef = ref<FormInstance>();
const createRequestId = ref('');
const form = reactive({ positionName: '', recruitmentBatch: '', deptId: '', ownerId: '', expectedEntryDate: '', intentDemandId: '', intentChangeReason: '', sourceChannel: '' as TalentSourceChannel | '' });
const owners = ref<TalentRecruitmentOwner[]>([]), departments = ref<Array<{ id: string; name: string; isActive: boolean }>>([]);
const departmentsLoaded = ref(false), departmentError = ref('');
const optionsError = ref(''), searching = ref(false);
const command = ref<TalentApplicationAction | null>(null), note = ref(''), noteError = ref('');
const reserveReasons = ref<TalentReserveReason[]>([]);
const selectedDemand = ref<RecruitmentDemandView | null>(null), demandRows = ref<RecruitmentDemandView[]>([]);
const demandError = ref(''), demandLoadError = ref(''), demandLoading = ref(false), demandPage = ref(1), demandTotal = ref(0), demandKeyword = ref('');
const demandConnection = ref<RecruitmentDemandStatus | null>(null), demandDirectories = ref<RecruitmentDemandDirectories | null>(null);
const intentRows = ref<RecruitmentDemandView[]>([]), intentSelected = ref<RecruitmentDemandView | null>(null);
const intentLoading = ref(false), intentChoosing = ref(false), intentError = ref(''), intentLoadError = ref('');
const intentPage = ref(1), intentTotal = ref(0), intentKeyword = ref('');
let intentSession = 0, intentSelection = 0;
const intentOptions = computed(() => intentSelected.value && !intentRows.value.some(row => row.id === intentSelected.value!.id)
  ? [intentSelected.value, ...intentRows.value] : intentRows.value);
const intentChanged = computed(() => !creating.value && (current.value?.intentDemandId || '') !== form.intentDemandId);
let session = 0, ownerSearch = 0, optionSession = 0, demandSession = 0;
const demandOptions = computed(() => selectedDemand.value && !demandRows.value.some(row => row.id === selectedDemand.value!.id)
  ? [selectedDemand.value, ...demandRows.value] : demandRows.value);
const demandApplicationIssue = computed(() => {
  if (!current.value?.deptId) return '当前应聘未指定部门，请先修改当前应聘。';
  if (demandDirectories.value && !demandDirectories.value.departments.some(dept => dept.id === current.value!.deptId)) return '当前应聘部门已不可用，请先修改当前应聘。';
  if (demandDirectories.value && !demandDirectories.value.positions.some(job => job.name === current.value!.positionName)) return '当前应聘岗位未匹配有效的 HRM 岗位名称，请先修改当前应聘。';
  return '';
});
const demandTarget = computed(() => ({ path: '/recruitment/demands', query: { candidateId: props.candidateId, applicationId: current.value?.id || '' } }));
const rules: FormRules = { positionName: [{ required: true, whitespace: true, message: '请填写应聘岗位', trigger: 'blur' }] };
const actions = computed(() => Object.keys(APPLICATION_ACTION_LABELS).filter(action => current.value?.allowedActions.includes(action)
  && (!['submit_hiring', 'terminate_offer'].includes(action) || (props.editable && canEditRecruitment.value))
  && (action !== 'terminate_offer' || current.value?.stage !== 'hired')) as TalentApplicationAction[]);
const noteRequired = computed(() => command.value && ['submit_hiring', 'return_hiring', 'reject', 'terminate_offer'].includes(command.value));
const canTerminateOffer = computed(() => Boolean(props.editable && canEditRecruitment.value && current.value?.stage !== 'hired'
  && current.value?.allowedActions.includes('terminate_offer')));
const canArrange = computed(() => props.editable && current.value && ['screening', 'interviewing', 'reserve'].includes(current.value.stage));
const activeOnboarding = computed(() => {
  const request = current.value?.onboardingRequest;
  return request && !request.cancelledAt && !request.archivedAt && !['archived', 'cancelled'].includes(request.recordStatus)
    && ['draft', 'submitted', 'pending_entry'].includes(request.onboardingStatus ?? '') ? request : null;
});
const canOnboard = computed(() => props.editable && canMaintainArchive.value && current.value?.stage === 'accepted' && !activeOnboarding.value && !actionResultUnknown.value);
const canEditRecord = computed(() => props.editable && current.value && ['screening', 'interviewing', 'reserve'].includes(current.value.stage));
const departmentOptions = computed(() => {
  const options = departments.value.filter(dept => dept.isActive).map(dept => ({ ...dept, disabled: false }));
  if (form.deptId && !options.some(dept => dept.id === form.deptId)) {
    const name = current.value?.departmentNameSnapshot || departments.value.find(dept => dept.id === form.deptId)?.name || '原应聘部门';
    options.unshift({ id: form.deptId, name: name + (departmentsLoaded.value ? '（已停用或不可用）' : ''), isActive: false, disabled: true });
  }
  return options;
});
const canOpenHiringReview = computed(() => current.value?.stage === 'hiring_review'
  && current.value.allowedActions.some(action => ['approve_hiring', 'return_hiring'].includes(action))
  && auth.user && canAccessRoute(router.resolve({ name: 'TalentHiringReview' }), auth.user));
const leave = useRecruitmentLeaveGuard({
  dirty: () => editing.value || !!command.value,
  busy: () => busy.value || confirming.value,
  discard: () => { resetEditor(); command.value = null; note.value = ''; reserveReasons.value = []; },
});
defineExpose({ prepareToLeave: leave.prepareToLeave, openNewApplication: () => openEditor(true), refreshSelected: () => selectedId.value ? select(selectedId.value, true) : loadList() });
watch(current, value => emit('selected', value));
function active(token: number, candidateId: string, applicationId?: string) {
  return token === session && candidateId === props.candidateId && (!applicationId || applicationId === selectedId.value);
}
function accept(result: TalentApplicationView) {
  current.value = result;
  const index = rows.value.findIndex(row => row.id === result.id);
  if (index < 0) rows.value.unshift(result); else rows.value[index] = result;
}
function actionLabel(action: TalentApplicationAction) {
  return action === 'reject' ? '淘汰本次应聘' : action === 'start_interview' ? '进入面试阶段' : APPLICATION_ACTION_LABELS[action];
}
function applicationStageLabel(row: Pick<TalentApplicationView, 'stage' | 'offerTerminated'>) {
  return row.offerTerminated ? '录用已终止' : APPLICATION_STAGE_LABELS[row.stage];
}
async function loadList() {
  if (busy.value || editing.value || command.value) return;
  const token = ++session, candidateId = props.candidateId;
  loading.value = true; error.value = ''; loadFailed.value = false; actionResult.value = '';
  try {
    const result = await talentRecruitmentApi.applications(candidateId);
    if (!active(token, candidateId)) return;
    rows.value = result;
    const match = selectedId.value ? undefined : props.applicationMatch;
    const targetId = selectedId.value || match?.id;
    const target = targetId ? result.find(row => row.id === targetId) : result[0];
    if (match && (!target
      || (match.applicationPosition && target.positionName !== match.applicationPosition)
      || (match.applicationStage && target.stage !== match.applicationStage)
      || (match.applicationOwnerId && target.ownerId !== match.applicationOwnerId))) {
      selectionError.value = '筛选匹配的应聘记录已变化或不可用，请重新选择应聘记录。';
      current.value = null;
      return;
    }
    if (targetId && !target) {
      selectionError.value = '当前应聘记录已不可用，请重新选择应聘记录。';
      current.value = null;
      return;
    }
    selectionError.value = '';
    selectedId.value = target?.id ?? '';
    current.value = target ?? null;
  } catch (cause) { if (active(token, candidateId)) { error.value = recruitmentError(cause); loadFailed.value = true; } }
  finally { if (active(token, candidateId)) loading.value = false; }
}
async function select(id: string, keepInputs = false) {
  if (busy.value || loading.value || confirming.value) return;
  if (!keepInputs && (!await leave.prepareToLeave() || (props.beforeSwitch && !await props.beforeSwitch()))) return;
  const token = ++session, candidateId = props.candidateId;
  selectedId.value = id; loading.value = true; error.value = ''; loadFailed.value = false; selectionError.value = ''; actionResult.value = '';
  if (!keepInputs) { current.value = null; command.value = null; editing.value = false; }
  try {
    const result = await talentRecruitmentApi.detail(id);
    if (!active(token, candidateId, id)) return;
    accept(result); conflict.value = false; actionResultUnknown.value = false;
    if (editing.value && !canEditRecord.value) error.value = '当前阶段已不能修改应聘，输入已保留，请取消后核对。';
    if (command.value && !result.allowedActions.includes(command.value)) error.value = '当前阶段已不支持此操作，说明已保留，请取消后核对。';
  } catch (cause) { if (active(token, candidateId, id)) { error.value = recruitmentError(cause); loadFailed.value = true; } }
  finally { if (active(token, candidateId, id)) loading.value = false; }
}
watch([() => props.candidateId, () => props.applicationMatch?.id,
  () => props.applicationMatch?.applicationPosition, () => props.applicationMatch?.applicationStage,
  () => props.applicationMatch?.applicationOwnerId], () => {
  ++session; ++ownerSearch; ++optionSession; ++demandSession; ++intentSession; ++intentSelection; rows.value = []; selectedId.value = ''; current.value = null;
  intentRows.value = []; intentSelected.value = null; intentLoading.value = false; intentChoosing.value = false;
  selectedDemand.value = null; demandRows.value = []; demandLoading.value = false;
  hiringNeedsRefresh.value = false; actionResult.value = ''; confirming.value = false; actionResultUnknown.value = false;
  editing.value = false; command.value = null; busy.value = false; conflict.value = false; selectionError.value = ''; void loadList();
}, { immediate: true });
onBeforeUnmount(() => { ++session; ++ownerSearch; ++optionSession; ++demandSession; ++intentSession; ++intentSelection; });

async function searchOwners(keyword = '') {
  const token = ++ownerSearch, candidateId = props.candidateId;
  searching.value = true;
  try {
    const result = await talentRecruitmentApi.owners({ keyword: keyword.trim() || undefined, page: 1, pageSize: 30 });
    if (token !== ownerSearch || candidateId !== props.candidateId) return;
    const selected = owners.value.find(owner => owner.id === form.ownerId);
    owners.value = selected && !result.items.some(owner => owner.id === selected.id) ? [selected, ...result.items] : result.items;
  } catch (cause) { if (token === ownerSearch) optionsError.value = recruitmentError(cause); }
  finally { if (token === ownerSearch) searching.value = false; }
}
async function loadOptions() {
  const token = ++optionSession; optionsError.value = ''; departmentsLoaded.value = false; departments.value = [];
  void searchOwners();
  try {
    const result = await departmentsApi.findAll();
    if (token !== optionSession) return;
    const flat: Array<{ id: string; name: string; isActive: boolean }> = [];
    function visit(items: Department[], parent = '') { for (const item of items) { const name = parent ? `${parent} / ${item.name}` : item.name; flat.push({ id: item.id, name, isActive: item.isActive }); if (item.children) visit(item.children, name); } }
    visit(result); departments.value = [...new Map(flat.map(item => [item.id, item])).values()]; departmentsLoaded.value = true;
  } catch (cause) { if (token === optionSession) optionsError.value = recruitmentError(cause); }
}
async function openEditor(create: boolean, preserveHiring = false) {
  if (!props.editable || busy.value || actionResultUnknown.value || (!create && !canEditRecord.value)) return;
  const keepHiring = !create && preserveHiring && command.value === 'submit_hiring';
  if ((!keepHiring && !await leave.prepareToLeave()) || (create && props.beforeSwitch && !await props.beforeSwitch())) return;
  creating.value = create; editing.value = true; if (!keepHiring) command.value = null;
  error.value = ''; departmentError.value = ''; conflict.value = false;
  createRequestId.value = create ? crypto.randomUUID() : '';
  const row = create ? null : current.value;
  Object.assign(form, { positionName: row?.positionName ?? '', recruitmentBatch: row?.recruitmentBatch ?? '', deptId: row?.deptId ?? '', ownerId: row?.ownerId ?? '', expectedEntryDate: row?.expectedEntryDate?.slice(0, 10) ?? '',
    intentDemandId: row?.intentDemandId || '', intentChangeReason: '', sourceChannel: row?.sourceChannel || '' });
  ++intentSession; ++intentSelection; intentRows.value = []; intentSelected.value = row?.intentDemandCurrent || null;
  intentError.value = ''; intentLoadError.value = ''; intentPage.value = 1; intentKeyword.value = ''; intentTotal.value = 0; intentChoosing.value = false;
  owners.value = row ? [{ id: row.ownerId, name: row.ownerName ?? '原应聘负责人', employeeNo: null, deptName: null }] : [];
  formRef.value?.clearValidate(); void loadOptions(); void loadIntentOptions();
}
function resetEditor() { editing.value = false; createRequestId.value = ''; error.value = ''; conflict.value = false; ++ownerSearch; ++optionSession; ++intentSession; ++intentSelection; intentChoosing.value = false; intentLoading.value = false; }
async function loadIntentOptions(keyword = intentKeyword.value) {
  if (!editing.value || !props.editable || !canEditRecruitment.value) return;
  if (keyword !== intentKeyword.value) intentPage.value = 1;
  intentKeyword.value = keyword;
  const token = ++intentSession, candidateId = props.candidateId;
  intentLoading.value = true; intentLoadError.value = '';
  try {
    const result = await recruitmentDemandsApi.intentOptions({ keyword: keyword.trim() || undefined, page: intentPage.value, pageSize: 20 });
    if (token !== intentSession || candidateId !== props.candidateId || !editing.value || !canEditRecruitment.value) return;
    intentRows.value = result.items; intentTotal.value = result.total;
  } catch (cause) { if (token === intentSession) { intentRows.value = []; intentTotal.value = 0; intentLoadError.value = demandErrorMessage(cause); } }
  finally { if (token === intentSession) intentLoading.value = false; }
}
async function chooseIntentDemand(id: string) {
  if (!editing.value || !props.editable || !canEditRecruitment.value || busy.value || intentChoosing.value) return;
  const token = ++intentSelection, candidateId = props.candidateId;
  intentError.value = '';
  if (!id) { form.intentDemandId = ''; intentSelected.value = null; return; }
  const row = intentOptions.value.find(item => item.id === id);
  if (!row?.usable || !row.deptId || !row.positionName) { intentError.value = '请选择已批准且部门、岗位已核对的有效需求。'; return; }
  const before = JSON.stringify(form);
  if ((form.deptId && form.deptId !== row.deptId) || (form.positionName.trim() && form.positionName.trim() !== row.positionName)) {
    intentChoosing.value = true;
    try { await ElMessageBox.confirm(`所选需求为“${row.departmentName} / ${row.positionName}”，与已填部门或岗位不同。将本次应聘明确改为该需求的部门和岗位？`, '核对应聘归属', { confirmButtonText: '使用该需求部门和岗位', cancelButtonText: '保留原输入', type: 'warning' }); }
    catch { return; }
    finally { if (token === intentSelection) intentChoosing.value = false; }
  }
  if (token !== intentSelection || candidateId !== props.candidateId || !editing.value || !canEditRecruitment.value || before !== JSON.stringify(form)) return;
  intentSelected.value = row; form.intentDemandId = row.id; form.deptId = row.deptId; form.positionName = row.positionName;
  departmentError.value = '';
}
async function cancelEditor() {
  if (command.value === 'submit_hiring') {
    if (busy.value) return;
    try { await ElMessageBox.confirm('放弃本次应聘修改？已填写的录用意见和选单会保留。', '取消应聘修改', { confirmButtonText: '放弃修改', cancelButtonText: '继续编辑' }); }
    catch { return; }
    resetEditor(); return;
  }
  if (await leave.prepareToLeave()) resetEditor();
}
async function cancelAction() { if (await leave.prepareToLeave()) { command.value = null; error.value = ''; conflict.value = false; } }
async function save() {
  if (busy.value || loading.value || conflict.value || intentChoosing.value) return;
  busy.value = true;
  const valid = await formRef.value?.validate().catch(() => false);
  busy.value = false;
  if (!valid || !editing.value) return;
  intentError.value = '';
  if (intentChanged.value && (!form.intentChangeReason.trim() || form.intentChangeReason.trim().length > 2000)) { intentError.value = '请填写意向需求变更原因（最多2000字）。'; return; }
  if (form.intentDemandId && intentSelected.value && (form.deptId !== intentSelected.value.deptId || form.positionName.trim() !== intentSelected.value.positionName)) { intentError.value = '当前部门或岗位与意向需求不一致，请重新核对意向需求。'; return; }
  if (!creating.value && !canEditRecord.value) { error.value = '当前阶段不可修改，输入已保留。'; return; }
  const token = session, candidateId = props.candidateId, row = current.value, isCreate = creating.value;
  const body = { positionName: form.positionName.trim(), recruitmentBatch: form.recruitmentBatch.trim() || null, deptId: form.deptId || null, ownerId: form.ownerId || undefined, expectedEntryDate: form.expectedEntryDate || null,
    intentDemandId: form.intentDemandId || null, sourceChannel: form.sourceChannel || null, ...(intentChanged.value ? { intentChangeReason: form.intentChangeReason.trim() } : {}) };
  busy.value = true; error.value = ''; departmentError.value = '';
  try {
    const result = isCreate ? await talentRecruitmentApi.create(candidateId, { ...body, requestId: createRequestId.value })
      : await talentRecruitmentApi.update(row!.id, { ...body, expectedRevision: row!.revision });
    if (!active(token, candidateId)) return;
    selectedId.value = result.id; selectionError.value = ''; accept(result); resetEditor(); emit('changed');
    if (command.value === 'submit_hiring') { demandPage.value = 1; await loadDemandOptions(); }
  } catch (cause) {
    if (active(token, candidateId)) {
      error.value = recruitmentError(cause);
      const response = (cause as { response?: { status: number; data?: { message?: string | string[] } } }).response;
      conflict.value = !isCreate && response?.status === 409;
      if (isCreate && response?.status === 409) error.value = '此前已保存了不同的应聘内容。请取消编辑，刷新并核对应聘记录。';
      else if (isCreate && (!response || response.status >= 500)) error.value = '暂时无法确认是否保存成功。保留当前内容，再点“保存应聘”可核对本次提交。';
      const messages = response?.data?.message;
      if (response?.status === 400) departmentError.value = (Array.isArray(messages) ? messages : [messages]).filter(message => message && /部门|deptId/.test(message)).join('；');
    }
  }
  finally { if (active(token, candidateId)) busy.value = false; }
}
async function loadDemandOptions(keyword = demandKeyword.value) {
  const row = current.value;
  if (!row || command.value !== 'submit_hiring' || !props.editable || !canEditRecruitment.value) return;
  if (keyword !== demandKeyword.value) demandPage.value = 1;
  demandKeyword.value = keyword;
  const token = ++demandSession, candidateId = props.candidateId;
  demandLoading.value = true; demandLoadError.value = ''; demandConnection.value = null; demandDirectories.value = null;
  try {
    const [result, status, directories] = await Promise.all([
      recruitmentDemandsApi.options({ applicationId: row.id, keyword: keyword.trim() || undefined, page: demandPage.value, pageSize: 20 }),
      recruitmentDemandsApi.status(), recruitmentDemandsApi.directories(),
    ]);
    if (token !== demandSession || candidateId !== props.candidateId || row.id !== current.value?.id || command.value !== 'submit_hiring') return;
    demandRows.value = result.items; demandTotal.value = result.total; demandConnection.value = status; demandDirectories.value = directories;
  } catch (cause) {
    if (token === demandSession) { demandRows.value = []; demandTotal.value = 0; demandLoadError.value = demandErrorMessage(cause); }
  } finally { if (token === demandSession) demandLoading.value = false; }
}
function chooseDemand(id: string) {
  selectedDemand.value = demandOptions.value.find(row => row.id === id) || null;
  demandError.value = '';
}
async function refreshHiringContext() {
  const row = current.value;
  if (!row || busy.value || loading.value || demandLoading.value) return;
  await select(row.id, true);
  if (loadFailed.value || current.value?.id !== row.id || command.value !== 'submit_hiring') return;
  await loadDemandOptions();
  const selected = selectedDemand.value;
  if (demandLoadError.value) return;
  if (!selected) { hiringNeedsRefresh.value = false; return; }
  const token = demandSession;
  demandLoading.value = true;
  try {
    const latest = await recruitmentDemandsApi.detail(selected.id);
    if (token !== demandSession || current.value?.id !== row.id || command.value !== 'submit_hiring') return;
    selectedDemand.value = latest;
    demandRows.value = demandRows.value.map(item => item.id === latest.id ? latest : item);
    demandError.value = latest.usable ? '' : '所选需求当前不可用，请核对需求后重新选择。';
    hiringNeedsRefresh.value = false;
  } catch (cause) { if (token === demandSession) demandLoadError.value = demandErrorMessage(cause); }
  finally { if (token === demandSession) demandLoading.value = false; }
}
async function beginAction(action: TalentApplicationAction) {
  if (busy.value || confirming.value || actionResultUnknown.value || (action === 'submit_hiring' && (!props.editable || !canEditRecruitment.value))
    || (action === 'terminate_offer' && !canTerminateOffer.value)) return;
  if (action === 'terminate_offer' && activeOnboarding.value) { error.value = '请先由有入职权限的人员按原流程撤回在办入职申请；撤回入职不释放名额，再另行终止录用。'; return; }
  if (!await leave.prepareToLeave()) return;
  command.value = action; note.value = ''; noteError.value = ''; reserveReasons.value = []; error.value = ''; conflict.value = false; hiringNeedsRefresh.value = false; actionResult.value = '';
  ++demandSession; selectedDemand.value = null; demandError.value = ''; demandLoadError.value = ''; demandLoading.value = false;
  demandRows.value = []; demandPage.value = 1; demandTotal.value = 0; demandKeyword.value = '';
  if (action === 'submit_hiring') await loadDemandOptions();
}
async function execute() {
  if (loading.value || loadFailed.value || conflict.value || confirming.value || actionResultUnknown.value) return;
  const row = current.value, action = command.value;
  if (!row || !action || busy.value || !row.allowedActions.includes(action)) return;
  if (action === 'terminate_offer') {
    if (!canTerminateOffer.value) return;
    if (activeOnboarding.value) { error.value = '请先按原权限撤回在办入职申请；撤回入职不释放名额。'; return; }
  }
  noteError.value = noteRequired.value && !note.value.trim() ? (action === 'terminate_offer' ? '请填写终止录用原因' : '请填写原因或录用意见') : '';
  if (action === 'submit_hiring') {
    if (!props.editable || !canEditRecruitment.value || hiringNeedsRefresh.value) return;
    demandError.value = demandApplicationIssue.value || (!selectedDemand.value ? '请选择已批准且已核对的招聘需求单'
      : !selectedDemand.value.usable ? '所选招聘需求当前不可用，请核对后重新选择。'
        : selectedDemand.value.deptId !== row.deptId || selectedDemand.value.positionName !== row.positionName ? '所选需求不对应当前应聘的部门或岗位，请重新选择或修改当前应聘。' : '');
    if (demandError.value || demandLoading.value || demandLoadError.value) return;
  }
  if (noteError.value) return;
  const summary = row.activitySummary;
  if (['reject', 'withdraw', 'reserve', 'submit_hiring'].includes(action) && summary && (summary.scheduledCount || summary.unsubmittedFeedbackCount)) {
    try { await ElMessageBox.confirm(
      `本次应聘仍有未结束面试 ${summary.scheduledCount} 场、未提交反馈 ${summary.unsubmittedFeedbackCount} 份。继续后反馈可能无法再提交；现有邀约不会自动取消，请经办分别处理。`,
      '本次应聘仍有待处理事项', { confirmButtonText: '仍然继续', cancelButtonText: '返回处理', type: 'warning' },
    ); } catch { return; }
    if (current.value !== row || command.value !== action || busy.value) return;
  }
  const token = session, candidateId = props.candidateId;
  if (action === 'terminate_offer') {
    confirming.value = true;
    try { await ElMessageBox.confirm('请核对当前应聘和终止原因。本次录用将终止；已关联需求的所占名额随终止释放，未关联需求不变动名额。不会代办撤回入职申请。', '终止录用并释放名额', {
      confirmButtonText: '终止录用并释放名额', cancelButtonText: '返回核对', type: 'warning', closeOnClickModal: false,
    }); } catch { return; }
    finally { confirming.value = false; }
    if (!active(token, candidateId, row.id) || current.value !== row || command.value !== action || busy.value || !canTerminateOffer.value || activeOnboarding.value) {
      error.value = '应聘状态或终止权限已变化，原因已保留，请刷新核对后再办理。'; return;
    }
  }
  busy.value = true; error.value = '';
  try {
    const result = await talentRecruitmentApi.action(row.id, { expectedRevision: row.revision, action, note: note.value.trim() || undefined,
      ...(action === 'submit_hiring' ? { recruitmentDemandId: selectedDemand.value!.id, expectedDemandRevision: selectedDemand.value!.revision } : {}),
      ...(action === 'reserve' ? { reserveReasons: [...reserveReasons.value] } : {}) });
    if (!active(token, candidateId, row.id)) return;
    accept(result); command.value = null; conflict.value = false; emit('changed');
    if (action === 'terminate_offer') actionResult.value = '已终止本次录用。';
  } catch (cause) { if (active(token, candidateId, row.id)) {
    const status = (cause as { response?: { status: number } }).response?.status;
    actionResultUnknown.value = ['submit_hiring', 'terminate_offer'].includes(action) && !status;
    error.value = actionResultUnknown.value ? '暂不能确认结果，先刷新应聘状态再操作；本次输入已保留。'
      : action === 'submit_hiring' ? demandErrorMessage(cause) : recruitmentError(cause);
    if (action === 'submit_hiring') { demandError.value = error.value; hiringNeedsRefresh.value = !status || status === 403 || status === 409 || status >= 500; }
    conflict.value = status === 409;
  } }
  finally { if (active(token, candidateId, row.id)) busy.value = false; }
}
function openOnboarding() {
  const row = current.value;
  if (!row) return;
  if (canOnboard.value) void router.push({ path: '/entry-exit', query: { talentId: props.candidateId, talentApplicationId: row.id } });
}
function openOnboardingRequest() { if (canViewArchive.value && current.value?.onboardingRequest) void router.push({ path: '/entry-exit', query: { applicationId: current.value.onboardingRequest.id } }); }
function eventLabel(action: string) { return APPLICATION_ACTION_LABELS[action as TalentApplicationAction] ?? ({ create: '新增应聘', update: '修改应聘', change_intent: '调整意向需求', start_onboarding: '办理入职', cancel_onboarding: '取消入职', activate_onboarding: '入职生效', submit_feedback: '提交面试反馈', return_feedback: '退回面试反馈', onboarding: '办理入职', hired: '入职生效' } as Record<string, string>)[action] ?? '应聘更新'; }
</script>

<template>
  <section v-loading="loading" class="application-panel">
    <header><h4>应聘记录</h4><div class="application-panel__actions">
      <el-tooltip content="刷新应聘记录"><el-button :icon="Refresh" size="small" aria-label="刷新应聘记录" :disabled="busy || editing || !!command" @click="loadList" /></el-tooltip>
      <el-button v-if="editable" size="small" :icon="Plus" :disabled="busy || loading" @click="openEditor(true)">新增应聘</el-button>
    </div></header>
    <el-select v-if="rows.length" :model-value="selectionError ? '' : selectedId" aria-label="选择应聘记录" placeholder="选择应聘记录" fit-input-width :disabled="busy || loading" @change="(id: string) => select(id)">
      <el-option v-for="row in rows" :key="row.id" :value="row.id" :label="[row.positionName, row.recruitmentBatch, applicationStageLabel(row)].filter(Boolean).join(' · ')" />
    </el-select>
    <el-alert v-if="selectionError" :title="selectionError" type="warning" :closable="false" />
    <el-alert v-if="error || actionResultUnknown" :title="error || '暂不能确认结果，先刷新应聘状态再操作。'" type="error" :closable="false">
      <el-button v-if="(conflict || hiringNeedsRefresh || actionResultUnknown) && current" link type="primary" :disabled="demandLoading" @click="command === 'submit_hiring' ? refreshHiringContext() : select(current.id, true)">刷新记录，保留输入</el-button>
      <el-button v-else-if="loadFailed" link type="primary" @click="selectedId ? select(selectedId, editing || !!command) : loadList()">重试</el-button>
    </el-alert>
    <el-alert v-if="actionResult" :title="actionResult" type="success" :closable="false" />
    <el-form v-if="editing" ref="formRef" :model="form" :rules="rules" label-position="top" :disabled="busy || loading" class="application-panel__form">
      <div class="application-panel__fields">
        <el-form-item label="意向招聘需求（选填）" :error="intentError">
          <el-select :model-value="form.intentDemandId" aria-label="意向招聘需求" filterable remote clearable fit-input-width :remote-method="loadIntentOptions" :loading="intentLoading" :disabled="intentChoosing" placeholder="未关联也可先应聘和面试" @change="chooseIntentDemand">
            <el-option v-if="form.intentDemandId && !intentOptions.some(row => row.id === form.intentDemandId)" :value="form.intentDemandId" label="原意向需求（待核对）" disabled />
            <el-option v-for="demand in intentOptions" :key="demand.id" :value="demand.id" :disabled="!demand.usable" :label="[demandOriginLabel(demand), demandReference(demand), demand.departmentName, demand.positionName].filter(Boolean).join(' · ')" />
          </el-select>
          <div v-if="intentTotal > 20" class="application-panel__actions"><el-button link :disabled="intentPage <= 1 || intentLoading" @click="intentPage--; loadIntentOptions()">上一页需求</el-button><span>{{ intentPage }} / {{ Math.ceil(intentTotal / 20) }}</span><el-button link :disabled="intentPage * 20 >= intentTotal || intentLoading" @click="intentPage++; loadIntentOptions()">下一页需求</el-button></div>
        </el-form-item>
        <el-form-item label="本次应聘来源（选填）"><el-select v-model="form.sourceChannel" clearable aria-label="本次应聘来源"><el-option v-for="source in TALENT_SOURCE_CHANNELS" :key="source" :value="source" :label="TALENT_SOURCE_LABELS[source]" /></el-select></el-form-item>
        <el-form-item label="岗位名称" prop="positionName"><el-input v-model="form.positionName" maxlength="100" /></el-form-item>
        <el-form-item label="招聘批次" prop="recruitmentBatch"><el-input v-model="form.recruitmentBatch" maxlength="100" /></el-form-item>
        <el-form-item label="部门（选填）" prop="deptId" :error="departmentError"><el-select v-model="form.deptId" clearable filterable @change="departmentError = ''"><el-option v-for="dept in departmentOptions" :key="dept.id" :value="dept.id" :label="dept.name" :disabled="dept.disabled" /></el-select></el-form-item>
        <el-form-item label="应聘负责人"><el-select v-model="form.ownerId" clearable filterable remote :remote-method="searchOwners" :loading="searching" placeholder="默认当前经办" @focus="searchOwners()"><el-option v-for="owner in owners" :key="owner.id" :value="owner.id" :label="[owner.name, owner.deptName].filter(Boolean).join(' · ')" /></el-select></el-form-item>
        <el-form-item label="预计到岗"><el-date-picker v-model="form.expectedEntryDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
      </div>
      <el-form-item v-if="intentChanged" label="意向需求变更原因" required :error="intentError"><el-input v-model="form.intentChangeReason" aria-label="意向需求变更原因" type="textarea" :rows="2" maxlength="2000" show-word-limit /></el-form-item>
      <el-alert v-if="intentLoadError" :title="intentLoadError" type="error" :closable="false"><el-button link type="primary" @click="loadIntentOptions()">重试意向需求</el-button></el-alert>
      <el-alert v-if="optionsError" :title="optionsError" type="error" :closable="false"><el-button link type="primary" @click="loadOptions">重试选项</el-button></el-alert>
      <div class="application-panel__actions"><el-button @click="cancelEditor">取消编辑</el-button><el-button type="primary" :loading="busy" :disabled="loading || conflict || (!creating && !canEditRecord)" @click="save">保存应聘</el-button></div>
    </el-form>
    <template v-else-if="current">
      <dl><dt>本次应聘阶段</dt><dd class="application-panel__stage">{{ applicationStageLabel(current) }}</dd><dt>应聘负责人</dt><dd>{{ current.ownerName || '未指定' }}</dd><dt>部门</dt><dd>{{ current.departmentNameSnapshot || '未指定' }}</dd><dt>预计到岗</dt><dd>{{ current.expectedEntryDate ? formatDate(current.expectedEntryDate) : '未填写' }}</dd></dl>
      <dl aria-label="当前意向归属"><dt>当前意向需求</dt><dd><el-button v-if="current.intentDemandId" class="application-panel__intent-link" link type="primary" @click="router.push({ path: '/recruitment/demands', query: { demandId: current.intentDemandId } })">{{ current.intentDemandCurrent ? `${demandReference(current.intentDemandCurrent)} · ${current.intentDemandCurrent.positionName || '岗位待核对'}` : '查看意向需求原单' }}</el-button><span v-else>未关联</span></dd><dt>本次应聘来源</dt><dd>{{ current.sourceChannel ? TALENT_SOURCE_LABELS[current.sourceChannel] : '待核对' }}</dd></dl>
      <p v-if="['screening', 'interviewing', 'reserve'].includes(current.stage)" class="application-panel__muted">下一步：安排本岗位面试，或按实际情况更新应聘阶段。进入面试阶段不会自动创建邀约。</p>
      <p v-if="current.stage === 'hiring_review'" class="application-panel__muted">待其他有录用确认权限的人员办理，提交人不能确认本人提交的申请。</p>
      <p v-else-if="current.stage === 'offered'" class="application-panel__muted">下一步：由经办记录候选人接受或拒绝；候选人接受后，交人事办理入职。</p>
      <p v-else-if="current.stage === 'accepted' && !canMaintainArchive" class="application-panel__muted">候选人已接受录用，下一步交人事办理入职。</p>
      <p v-if="editable && canEditRecruitment && activeOnboarding" class="application-panel__muted">如本次录用需终止，请先由有权限的人事按原流程撤回在办入职申请；撤回或取消单次入职不释放名额。</p>
      <div v-if="!command" class="application-panel__actions">
        <el-button v-if="canOpenHiringReview" size="small" :disabled="busy" @click="router.push({ path: '/talent-hiring', query: { applicationId: current.id } })">录用确认</el-button>
        <el-button v-if="canEditRecord" size="small" :disabled="busy" @click="openEditor(false)">修改应聘</el-button>
        <el-button v-for="action in actions" :key="action" size="small" :disabled="busy || confirming || (action === 'terminate_offer' && !!activeOnboarding)" :type="action === 'terminate_offer' ? 'danger' : ['submit_hiring', 'approve_hiring', 'accept_offer'].includes(action) ? 'primary' : 'default'" @click="beginAction(action)">{{ actionLabel(action) }}</el-button>
        <el-button v-if="canArrange" size="small" type="primary" :disabled="busy" @click="emit('interview', current)">安排面试</el-button>
        <el-button v-if="canOnboard" size="small" type="primary" @click="openOnboarding">办理入职</el-button>
        <el-button v-if="canViewArchive && current.onboardingRequest" size="small" :type="activeOnboarding ? 'primary' : 'default'" @click="openOnboardingRequest">{{ activeOnboarding ? '查看入职申请' : '查看历史入职' }}</el-button>
        <el-button v-if="canViewArchive && current.stage === 'hired' && convertedUserId" size="small" type="primary" @click="router.push({ path: '/users', query: { employeeId: convertedUserId } })">查看员工档案</el-button>
      </div>
      <el-form v-if="command" label-position="top" :disabled="busy || confirming" class="application-panel__command">
        <strong>{{ actionLabel(command) }}</strong>
        <template v-if="command === 'submit_hiring'">
          <el-alert v-if="hiringNeedsRefresh" title="录用意见和选单已保留，请先刷新核对应聘及需求。权限不足时联系授权经办，恢复后再手动提交。" type="warning" :closable="false"><el-button link type="primary" :disabled="demandLoading" @click="refreshHiringContext">刷新核对录用依据</el-button></el-alert>
          <el-form-item label="招聘需求单" required :error="demandError">
            <el-select :model-value="selectedDemand?.id || ''" aria-label="招聘需求单" filterable remote clearable fit-input-width popper-class="recruitment-demand-options" :remote-method="loadDemandOptions" :loading="demandLoading" :disabled="demandLoading || !!demandApplicationIssue || !!demandLoadError" placeholder="选择已批准的需求单" @change="chooseDemand">
              <el-option v-for="demand in demandOptions" :key="demand.id" :value="demand.id" :disabled="!demand.usable" :label="[demandOriginLabel(demand), demandReference(demand), demand.departmentName, demand.positionName, `批准 ${demand.approvedHeadcount ?? '待核'} 人`, `版本 ${demand.revision}`].filter(Boolean).join(' · ')"><strong>{{ demandOriginLabel(demand) }} · {{ demandReference(demand) }}</strong><div>{{ demand.departmentName }} / {{ demand.positionName }} · 批准 {{ demand.approvedHeadcount ?? '待核' }} 人 · 版本 {{ demand.revision }}</div></el-option>
            </el-select>
          </el-form-item>
          <el-alert v-if="demandApplicationIssue" :title="demandApplicationIssue" type="warning" :closable="false"><el-button link type="primary" @click="openEditor(false, true)">修改当前应聘（保留录用意见）</el-button></el-alert>
          <el-alert v-if="demandConnection && !demandConnection.configured" title="钉钉招聘需求接入未就绪" type="warning" :closable="false">钉钉来源暂不可用，系统创建且审核通过的需求仍可选用。钉钉接入缺项：{{ demandConnection.missing.join('、') || '配置待核实' }}。</el-alert>
          <el-alert v-if="demandLoadError" :title="demandLoadError" type="error" :closable="false"><el-button link type="primary" @click="loadDemandOptions()">重试需求读取</el-button></el-alert>
          <p v-if="!demandLoading && !demandLoadError && !demandApplicationIssue && !demandRows.length" class="application-panel__muted">当前应聘没有匹配的可用需求。请核对需求是否已审核通过，并与当前应聘的部门、岗位一致。</p>
          <div class="application-panel__actions">
            <a class="application-panel__demand-link" :href="router.resolve(demandTarget).href" target="_blank" rel="noopener noreferrer">{{ isLocalDemand(selectedDemand) ? '前往系统需求办理' : '前往招聘需求核对' }}</a>
            <el-button v-if="!demandApplicationIssue" link type="primary" :disabled="busy" @click="openEditor(false, true)">修改当前应聘（保留录用意见）</el-button>
            <template v-if="demandTotal > 20"><el-button size="small" :disabled="demandPage <= 1 || demandLoading" @click="demandPage--; loadDemandOptions()">上一页需求</el-button><span>{{ demandPage }} / {{ Math.ceil(demandTotal / 20) }}</span><el-button size="small" :disabled="demandPage * 20 >= demandTotal || demandLoading" @click="demandPage++; loadDemandOptions()">下一页需求</el-button></template>
          </div>
          <p v-if="selectedDemand" class="application-panel__muted">已选 {{ demandOriginLabel(selectedDemand) }} · {{ demandReference(selectedDemand) }} · 版本 {{ selectedDemand.revision }} · {{ selectedDemand.usable ? '当前可用，提交时重新核验' : '当前不可用，请重新核对' }}</p>
        </template>
        <el-form-item v-if="command === 'reserve'" label="储备原因（选填，可多选）" :error="error.includes('储备原因') ? error : ''">
          <el-checkbox-group v-model="reserveReasons" class="application-panel__reason-options"><el-checkbox v-for="(label, reason) in TALENT_RESERVE_REASON_LABELS" :key="reason" :value="reason">{{ label }}</el-checkbox></el-checkbox-group>
        </el-form-item>
        <el-form-item :label="command === 'terminate_offer' ? '终止原因' : noteRequired ? '原因 / 意见' : '说明（选填）'" :required="!!noteRequired" :error="noteError"><el-input v-model="note" type="textarea" :rows="3" maxlength="2000" show-word-limit /></el-form-item>
        <div class="application-panel__actions"><el-button @click="cancelAction">取消操作</el-button><el-button :type="command === 'terminate_offer' ? 'danger' : 'primary'" :loading="busy" :disabled="loading || conflict || confirming || actionResultUnknown || !current.allowedActions.includes(command) || (command === 'submit_hiring' && (demandLoading || hiringNeedsRefresh))" @click="execute">{{ actionLabel(command) }}</el-button></div>
      </el-form>
      <RecruitmentDemandSummary v-if="current.recruitmentDemandSnapshot" :snapshot="current.recruitmentDemandSnapshot" :current="current.recruitmentDemandCurrent || null" />
      <el-collapse class="application-panel__history"><el-collapse-item title="应聘时间线" name="history">
      <el-timeline v-if="current.events?.length"><el-timeline-item v-for="event in current.events" :key="event.id" :timestamp="formatDate(event.createdAt)"><div>{{ event.actorName || '系统' }} · {{ eventLabel(event.action) }} · {{ APPLICATION_STAGE_LABELS[event.toStage] }}</div><p v-if="event.action === 'reserve' && event.reserveReasons?.length" class="application-panel__event-reasons">储备原因：{{ event.reserveReasons.map(reason => TALENT_RESERVE_REASON_LABELS[reason] || reason).join('、') }}</p><p v-if="event.note" class="application-panel__note">{{ event.note }}</p></el-timeline-item></el-timeline>
      <p v-else class="application-panel__muted">暂无流程记录</p></el-collapse-item></el-collapse>
    </template>
    <el-empty v-else-if="!loading && !error && !selectionError && !editing" description="暂无应聘记录" :image-size="40" />
  </section>
</template>

<style scoped>
.application-panel { min-width: 0; margin-top: 20px; overflow-wrap: anywhere; }
header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
h4, h5 { font-size: 14px; margin: 12px 0; }
.application-panel__actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
.application-panel__actions .el-button { margin-left: 0; }
.application-panel__form, .application-panel__command { border-block: 1px solid var(--el-border-color-lighter); padding: 12px 0; margin-top: 10px; }
.application-panel__fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; }
.application-panel :deep(.el-select), .application-panel :deep(.el-date-editor) { width: 100%; min-width: 0; }
.application-panel :deep(.el-alert) { margin: 10px 0; }
dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px; font-size: 13px; }
dt, .application-panel__muted { color: var(--el-text-color-secondary); } dd { margin: 0; min-width: 0; }
.application-panel__intent-link { max-width: 100%; height: auto; white-space: normal; text-align: left; line-height: 1.5; }
.application-panel__intent-link :deep(span) { min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.application-panel__note { white-space: pre-wrap; margin: 4px 0; }
.application-panel__event-reasons { margin: 4px 0; }
.application-panel__demand-link { align-self: center; color: var(--el-color-primary); font-size: 14px; text-decoration: underline; }
:global(.recruitment-demand-options) { max-width: calc(100vw - 24px); }
:global(.recruitment-demand-options .el-select-dropdown__item) { height: auto; padding-block: 8px; line-height: 20px; white-space: normal; overflow-wrap: anywhere; }
.application-panel__reason-options { display: flex; flex-wrap: wrap; gap: 0 14px; }
.application-panel__reason-options :deep(.el-checkbox) { margin-right: 0; }
.application-panel :deep(.el-timeline) { padding-left: 12px; }
@media (max-width: 768px) { .application-panel__form > .application-panel__actions, .application-panel__command > .application-panel__actions { position: sticky; bottom: -14px; background: var(--el-bg-color); padding: 10px 0; z-index: 2; }  .application-panel__fields { grid-template-columns: 1fr; } }
</style>
