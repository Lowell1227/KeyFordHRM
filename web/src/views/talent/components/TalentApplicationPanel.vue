<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, Refresh } from '@element-plus/icons-vue';
import { type FormInstance, type FormRules } from 'element-plus';
import { departmentsApi } from '@/api/departments.api';
import { recruitmentError, talentRecruitmentApi } from '@/api/talent-recruitment.api';
import { canAccessRoute } from '@/router/navigation';
import { useAuthStore } from '@/stores/auth.store';
import type { Department } from '@/types/api.types';
import {
  APPLICATION_ACTION_LABELS, APPLICATION_STAGE_LABELS,
  TALENT_RESERVE_REASON_LABELS,
  type TalentApplicationAction, type TalentApplicationView, type TalentRecruitmentOwner, type TalentReserveReason,
} from '@/types/talent.types';
import { formatDate } from '@/utils/date';

const props = defineProps<{ candidateId: string; editable: boolean; convertedUserId?: string | null }>();
const emit = defineEmits<{ changed: []; interview: [applicationId: string] }>();
const router = useRouter();
const auth = useAuthStore();
const rows = ref<TalentApplicationView[]>([]), selectedId = ref(''), current = ref<TalentApplicationView | null>(null);
const loading = ref(false), busy = ref(false), error = ref(''), loadFailed = ref(false), conflict = ref(false);
const editing = ref(false), creating = ref(false), formRef = ref<FormInstance>();
const form = reactive({ positionName: '', recruitmentBatch: '', deptId: '', ownerId: '', expectedEntryDate: '' });
const owners = ref<TalentRecruitmentOwner[]>([]), departments = ref<Array<{ id: string; name: string; isActive: boolean }>>([]);
const departmentsLoaded = ref(false), departmentError = ref('');
const optionsError = ref(''), searching = ref(false);
const command = ref<TalentApplicationAction | null>(null), note = ref(''), noteError = ref('');
const reserveReasons = ref<TalentReserveReason[]>([]);
let session = 0, ownerSearch = 0, optionSession = 0;
const rules: FormRules = { positionName: [{ required: true, whitespace: true, message: '请填写应聘岗位', trigger: 'blur' }] };
const actions = computed(() => Object.keys(APPLICATION_ACTION_LABELS).filter(action => current.value?.allowedActions.includes(action)) as TalentApplicationAction[]);
const noteRequired = computed(() => command.value && ['submit_hiring', 'return_hiring', 'reject'].includes(command.value));
const canArrange = computed(() => props.editable && current.value && ['screening', 'interviewing', 'reserve'].includes(current.value.stage));
const activeOnboarding = computed(() => {
  const request = current.value?.onboardingRequest;
  return request && !request.cancelledAt && !request.archivedAt && !['archived', 'cancelled'].includes(request.recordStatus)
    && ['draft', 'submitted', 'pending_entry'].includes(request.onboardingStatus ?? '') ? request : null;
});
const canOnboard = computed(() => props.editable && current.value?.stage === 'accepted' && !activeOnboarding.value);
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
function active(token: number, candidateId: string, applicationId?: string) {
  return token === session && candidateId === props.candidateId && (!applicationId || applicationId === selectedId.value);
}
function accept(result: TalentApplicationView) {
  current.value = result;
  const index = rows.value.findIndex(row => row.id === result.id);
  if (index < 0) rows.value.unshift(result); else rows.value[index] = result;
}
async function loadList() {
  if (busy.value || editing.value || command.value) return;
  const token = ++session, candidateId = props.candidateId;
  loading.value = true; error.value = ''; loadFailed.value = false;
  try {
    const result = await talentRecruitmentApi.applications(candidateId);
    if (!active(token, candidateId)) return;
    rows.value = result;
    selectedId.value = result.some(row => row.id === selectedId.value) ? selectedId.value : result[0]?.id ?? '';
    current.value = result.find(row => row.id === selectedId.value) ?? null;
  } catch (cause) { if (active(token, candidateId)) { error.value = recruitmentError(cause); loadFailed.value = true; } }
  finally { if (active(token, candidateId)) loading.value = false; }
}
async function select(id: string, keepInputs = false) {
  const token = ++session, candidateId = props.candidateId;
  selectedId.value = id; loading.value = true; error.value = ''; loadFailed.value = false;
  if (!keepInputs) { current.value = null; command.value = null; editing.value = false; }
  try {
    const result = await talentRecruitmentApi.detail(id);
    if (!active(token, candidateId, id)) return;
    accept(result); conflict.value = false;
    if (command.value && !result.allowedActions.includes(command.value)) error.value = '当前阶段已不支持此操作，说明已保留，请取消后核对。';
  } catch (cause) { if (active(token, candidateId, id)) { error.value = recruitmentError(cause); loadFailed.value = true; } }
  finally { if (active(token, candidateId, id)) loading.value = false; }
}
watch(() => props.candidateId, () => {
  ++session; ++ownerSearch; ++optionSession; rows.value = []; selectedId.value = ''; current.value = null;
  editing.value = false; command.value = null; busy.value = false; conflict.value = false; void loadList();
}, { immediate: true });
onBeforeUnmount(() => { ++session; ++ownerSearch; ++optionSession; });

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
function openEditor(create: boolean) {
  if (!props.editable || busy.value || (!create && !canEditRecord.value)) return;
  creating.value = create; editing.value = true; command.value = null; error.value = ''; departmentError.value = ''; conflict.value = false;
  const row = create ? null : current.value;
  Object.assign(form, { positionName: row?.positionName ?? '', recruitmentBatch: row?.recruitmentBatch ?? '', deptId: row?.deptId ?? '', ownerId: row?.ownerId ?? '', expectedEntryDate: row?.expectedEntryDate?.slice(0, 10) ?? '' });
  owners.value = row ? [{ id: row.ownerId, name: row.ownerName ?? '原负责人', employeeNo: null, deptName: null }] : [];
  formRef.value?.clearValidate(); void loadOptions();
}
function cancelEditor() { editing.value = false; error.value = ''; conflict.value = false; ++ownerSearch; ++optionSession; }
async function save() {
  if (busy.value || !await formRef.value?.validate().catch(() => false)) return;
  if (!creating.value && !canEditRecord.value) { error.value = '当前阶段不可修改，输入已保留。'; return; }
  const token = session, candidateId = props.candidateId, row = current.value, isCreate = creating.value;
  const body = { positionName: form.positionName.trim(), recruitmentBatch: form.recruitmentBatch.trim() || null, deptId: form.deptId || null, ownerId: form.ownerId || undefined, expectedEntryDate: form.expectedEntryDate || null };
  busy.value = true; error.value = ''; departmentError.value = '';
  try {
    const result = isCreate ? await talentRecruitmentApi.create(candidateId, body)
      : await talentRecruitmentApi.update(row!.id, { ...body, expectedRevision: row!.revision });
    if (!active(token, candidateId)) return;
    selectedId.value = result.id; accept(result); cancelEditor(); emit('changed');
  } catch (cause) {
    if (active(token, candidateId)) {
      error.value = recruitmentError(cause);
      const response = (cause as { response?: { status: number; data?: { message?: string | string[] } } }).response;
      conflict.value = response?.status === 409;
      const messages = response?.data?.message;
      if (response?.status === 400) departmentError.value = (Array.isArray(messages) ? messages : [messages]).filter(message => message && /部门|deptId/.test(message)).join('；');
    }
  }
  finally { if (active(token, candidateId)) busy.value = false; }
}
function beginAction(action: TalentApplicationAction) { command.value = action; note.value = ''; noteError.value = ''; reserveReasons.value = []; error.value = ''; conflict.value = false; }
async function execute() {
  const row = current.value, action = command.value;
  if (!row || !action || busy.value || !row.allowedActions.includes(action)) return;
  noteError.value = noteRequired.value && !note.value.trim() ? '请填写原因或录用意见' : '';
  if (noteError.value) return;
  const token = session, candidateId = props.candidateId;
  busy.value = true; error.value = '';
  try {
    const result = await talentRecruitmentApi.action(row.id, { expectedRevision: row.revision, action, note: note.value.trim() || undefined,
      ...(action === 'reserve' ? { reserveReasons: [...reserveReasons.value] } : {}) });
    if (!active(token, candidateId, row.id)) return;
    accept(result); command.value = null; conflict.value = false; emit('changed');
  } catch (cause) { if (active(token, candidateId, row.id)) { error.value = recruitmentError(cause); conflict.value = (cause as { response?: { status: number } }).response?.status === 409; } }
  finally { if (active(token, candidateId, row.id)) busy.value = false; }
}
function openOnboarding() {
  const row = current.value;
  if (!row) return;
  if (canOnboard.value) void router.push({ path: '/entry-exit', query: { talentId: props.candidateId, talentApplicationId: row.id } });
}
function openOnboardingRequest() { if (current.value?.onboardingRequest) void router.push({ path: '/entry-exit', query: { applicationId: current.value.onboardingRequest.id } }); }
function eventLabel(action: string) { return APPLICATION_ACTION_LABELS[action as TalentApplicationAction] ?? ({ create: '新增应聘', update: '修改应聘', start_onboarding: '办理入职', cancel_onboarding: '取消入职', activate_onboarding: '入职生效', submit_feedback: '提交面试反馈', return_feedback: '退回面试反馈', onboarding: '办理入职', hired: '入职生效' } as Record<string, string>)[action] ?? '应聘更新'; }
</script>

<template>
  <section v-loading="loading" class="application-panel">
    <header><h4>应聘记录</h4><div class="application-panel__actions">
      <el-tooltip content="刷新应聘记录"><el-button :icon="Refresh" size="small" aria-label="刷新应聘记录" :disabled="busy || editing || !!command" @click="loadList" /></el-tooltip>
      <el-button v-if="editable" size="small" :icon="Plus" :disabled="busy || editing || !!command" @click="openEditor(true)">新增应聘</el-button>
    </div></header>
    <el-select v-if="rows.length" :model-value="selectedId" aria-label="选择应聘记录" fit-input-width :disabled="busy || editing || !!command" @change="(id: string) => select(id)">
      <el-option v-for="row in rows" :key="row.id" :value="row.id" :label="[row.positionName, row.recruitmentBatch, APPLICATION_STAGE_LABELS[row.stage]].filter(Boolean).join(' · ')" />
    </el-select>
    <el-alert v-if="error" :title="error" type="error" :closable="false">
      <el-button v-if="conflict && current" link type="primary" @click="select(current.id, true)">刷新记录，保留输入</el-button>
      <el-button v-else-if="loadFailed" link type="primary" @click="selectedId ? select(selectedId, editing || !!command) : loadList()">重试</el-button>
    </el-alert>
    <el-form v-if="editing" ref="formRef" :model="form" :rules="rules" label-position="top" :disabled="busy" class="application-panel__form">
      <div class="application-panel__fields">
        <el-form-item label="岗位名称" prop="positionName"><el-input v-model="form.positionName" maxlength="100" /></el-form-item>
        <el-form-item label="招聘批次" prop="recruitmentBatch"><el-input v-model="form.recruitmentBatch" maxlength="100" /></el-form-item>
        <el-form-item label="部门（选填）" prop="deptId" :error="departmentError"><el-select v-model="form.deptId" clearable filterable @change="departmentError = ''"><el-option v-for="dept in departmentOptions" :key="dept.id" :value="dept.id" :label="dept.name" :disabled="dept.disabled" /></el-select></el-form-item>
        <el-form-item label="负责人"><el-select v-model="form.ownerId" clearable filterable remote :remote-method="searchOwners" :loading="searching" placeholder="默认当前经办" @focus="searchOwners()"><el-option v-for="owner in owners" :key="owner.id" :value="owner.id" :label="[owner.name, owner.deptName].filter(Boolean).join(' · ')" /></el-select></el-form-item>
        <el-form-item label="预计到岗"><el-date-picker v-model="form.expectedEntryDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
      </div>
      <el-alert v-if="optionsError" :title="optionsError" type="error" :closable="false"><el-button link type="primary" @click="loadOptions">重试选项</el-button></el-alert>
      <div class="application-panel__actions"><el-button @click="cancelEditor">取消编辑</el-button><el-button type="primary" :loading="busy" @click="save">保存应聘</el-button></div>
    </el-form>
    <template v-else-if="current">
      <dl><dt>阶段</dt><dd class="application-panel__stage">{{ APPLICATION_STAGE_LABELS[current.stage] }}</dd><dt>负责人</dt><dd>{{ current.ownerName || '未指定' }}</dd><dt>部门</dt><dd>{{ current.departmentNameSnapshot || '未指定' }}</dd><dt>预计到岗</dt><dd>{{ current.expectedEntryDate ? formatDate(current.expectedEntryDate) : '未填写' }}</dd></dl>
      <p v-if="current.stage === 'hiring_review'" class="application-panel__muted">下一步：由其他有录用确认权限的人员在“人员 → 录用确认”办理，提交人不能确认本人提交的申请。</p>
      <p v-else-if="current.stage === 'offered'" class="application-panel__muted">下一步：由经办记录候选人接受或拒绝；候选人接受后，再办理入职。</p>
      <div v-if="!command" class="application-panel__actions">
        <el-button v-if="canOpenHiringReview" size="small" :disabled="busy" @click="router.push('/talent-hiring')">前往录用确认</el-button>
        <el-button v-if="canEditRecord" size="small" :disabled="busy" @click="openEditor(false)">修改应聘</el-button>
        <el-button v-for="action in actions" :key="action" size="small" :disabled="busy" :type="['submit_hiring', 'approve_hiring', 'accept_offer'].includes(action) ? 'primary' : 'default'" @click="beginAction(action)">{{ APPLICATION_ACTION_LABELS[action] }}</el-button>
        <el-button v-if="canArrange" size="small" :disabled="busy" @click="emit('interview', current.id)">安排面试</el-button>
        <el-button v-if="canOnboard" size="small" type="primary" @click="openOnboarding">办理入职</el-button>
        <el-button v-if="current.onboardingRequest" size="small" :type="activeOnboarding ? 'primary' : 'default'" @click="openOnboardingRequest">{{ activeOnboarding ? '查看入职申请' : '查看历史入职' }}</el-button>
        <el-button v-if="current.stage === 'hired' && convertedUserId" size="small" type="primary" @click="router.push({ path: '/users', query: { employeeId: convertedUserId } })">查看员工档案</el-button>
      </div>
      <el-form v-if="command" label-position="top" :disabled="busy" class="application-panel__command">
        <strong>{{ APPLICATION_ACTION_LABELS[command] }}</strong>
        <el-form-item v-if="command === 'reserve'" label="储备原因（选填，可多选）" :error="error.includes('储备原因') ? error : ''">
          <el-checkbox-group v-model="reserveReasons" class="application-panel__reason-options"><el-checkbox v-for="(label, reason) in TALENT_RESERVE_REASON_LABELS" :key="reason" :value="reason">{{ label }}</el-checkbox></el-checkbox-group>
        </el-form-item>
        <el-form-item :label="noteRequired ? '原因 / 意见' : '说明（选填）'" :required="!!noteRequired" :error="noteError"><el-input v-model="note" type="textarea" :rows="3" maxlength="2000" show-word-limit /></el-form-item>
        <div class="application-panel__actions"><el-button @click="command = null; error = ''; conflict = false">取消操作</el-button><el-button type="primary" :loading="busy" :disabled="!current.allowedActions.includes(command)" @click="execute">{{ APPLICATION_ACTION_LABELS[command] }}</el-button></div>
      </el-form>
      <h5>应聘时间线</h5>
      <el-timeline v-if="current.events?.length"><el-timeline-item v-for="event in current.events" :key="event.id" :timestamp="formatDate(event.createdAt)"><div>{{ event.actorName || '系统' }} · {{ eventLabel(event.action) }} · {{ APPLICATION_STAGE_LABELS[event.toStage] }}</div><p v-if="event.action === 'reserve' && event.reserveReasons?.length" class="application-panel__event-reasons">储备原因：{{ event.reserveReasons.map(reason => TALENT_RESERVE_REASON_LABELS[reason] || reason).join('、') }}</p><p v-if="event.note" class="application-panel__note">{{ event.note }}</p></el-timeline-item></el-timeline>
      <p v-else class="application-panel__muted">暂无流程记录</p>
    </template>
    <el-empty v-else-if="!loading && !error && !editing" description="暂无应聘记录" :image-size="40" />
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
dl { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 8px; font-size: 13px; }
dt, .application-panel__muted { color: var(--el-text-color-secondary); } dd { margin: 0; }
.application-panel__note { white-space: pre-wrap; margin: 4px 0; }
.application-panel__event-reasons { margin: 4px 0; }
.application-panel__reason-options { display: flex; flex-wrap: wrap; gap: 0 14px; }
.application-panel__reason-options :deep(.el-checkbox) { margin-right: 0; }
.application-panel :deep(.el-timeline) { padding-left: 12px; }
@media (max-width: 768px) { .application-panel__fields { grid-template-columns: 1fr; } }
</style>
