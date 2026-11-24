<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { Plus, Refresh } from '@element-plus/icons-vue';
import { talentInterviewsApi } from '@/api/talent-pool.api';
import { usersApi } from '@/api/users.api';
import type { User } from '@/types/api.types';
import { INTERVIEW_STATUS_LABELS, INTERVIEW_SYNC_LABELS, type TalentInterviewView } from '@/types/talent.types';
import TalentInterviewContent from './TalentInterviewContent.vue';
import { formatInterviewTime, interviewTimeToIso } from '../interview-time';
import { interviewApplicationLabel, type InterviewApplication } from '../interview-application';
import { useRecruitmentLeaveGuard } from '../useRecruitmentLeaveGuard';
import { extractTencentMeetingLink, safeTencentMeetingLink } from '../interview-meeting-link';

const props = defineProps<{ candidateId: string; editable: boolean; invitationId?: string; application?: InterviewApplication | null; candidateName?: string }>();
const emit = defineEmits<{ changed: [] }>();
const rows = ref<TalentInterviewView[]>([]), loading = ref(false), busy = ref(false), error = ref('');
const editing = ref(false), current = ref<TalentInterviewView | null>(null), formRef = ref<FormInstance>();
const requestId = ref('');
const refreshedSnapshot = ref<TalentInterviewView | null>(null);
const applicationId = ref<string | undefined>();
const editorApplication = ref<TalentInterviewView['application']>(null);
const panelElement = ref<HTMLElement>();
const loadFailed = ref(false), conflict = ref(false), refreshingEditor = ref(false), showHistory = ref(false);
const visibleRows = computed(() => props.invitationId || !props.application ? rows.value : rows.value.filter(row => row.applicationId === props.application!.id));
const historicalRows = computed(() => props.application ? rows.value.filter(row => row.applicationId !== props.application!.id) : []);
const displayedRows = computed(() => showHistory.value ? historicalRows.value : visibleRows.value);
const calendarUnconfigured = computed(() => rows.value.some(row => !row.syncStatus || row.syncStatus === 'unconfigured'));
const canSaveEditor = computed(() => props.editable && !conflict.value && !refreshingEditor.value
  && (!current.value || (current.value.status === 'scheduled' && !syncBlocked(current.value) && !current.value.sourceDeleted)));
const inviteMode = ref('现场面试'), inviteLocation = ref(''), generatedTemplate = ref('');

const opened = ref<string[]>([]);
type InterviewPerson = Pick<User, 'id' | 'name' | 'employeeNo' | 'status' | 'archivedAt'>;
const people = ref<InterviewPerson[]>([]), searching = ref(false), checkingParticipants = ref(false);
const participantNames = ref<Record<string, string>>({}), participantIssues = ref<Record<string, string>>({});
const form = reactive({ startsAt: '', endsAt: '', participantIds: [] as string[], invitationText: '', meetingUrl: '', note: '' });
const meetingLinkManual = ref(false);
const meetingExtraction = ref<ReturnType<typeof extractTencentMeetingLink> | null>(null);
let generation = 0, searchGeneration = 0, editorSession = 0;
const blockedParticipantIds = computed(() => form.participantIds.filter(id => participantIssues.value[id]));
const selectableParticipantIds = computed({
  get: () => form.participantIds.filter(id => !participantIssues.value[id]),
  set: (ids: string[]) => {
    // Keep unresolved historical participants until HR explicitly removes them.
    const selectable = ids.filter(id => !participantIssues.value[id] && people.value.some(person => person.id === id));
    form.participantIds = [...new Set([...blockedParticipantIds.value, ...selectable])];
    for (const person of people.value) if (ids.includes(person.id)) participantNames.value[person.id] = person.name;
    ++searchGeneration; searching.value = false; checkingParticipants.value = false;
  },
});

function meetingValid(value: string) {
  return !value.trim() || safeTencentMeetingLink(value) !== null;
}
const meetingHint = computed(() => {
  if (!meetingExtraction.value) return '';
  const status = meetingExtraction.value.status;
  const result = status === 'multiple' ? '邀请中识别到多个腾讯会议链接，请核对后手动填写。'
    : status === 'none' && inviteMode.value === '线上面试' ? '未识别到有效的腾讯会议链接，如使用腾讯会议，请核对后填写。' : '';
  if (meetingLinkManual.value) return result + (form.meetingUrl.trim()
    ? '已保留手动填写的链接，请核对后保存。' : '会议链接已手动清空，请核对是否需要补充。');
  return result || '已提取腾讯会议链接，请核对后保存。';
});
function invitationChanged(value: string) {
  meetingExtraction.value = extractTencentMeetingLink(value);
  if (!meetingLinkManual.value) {
    form.meetingUrl = meetingExtraction.value.status === 'single' ? meetingExtraction.value.url : '';
    formRef.value?.clearValidate('meetingUrl');
  }
}
const rules: FormRules = {
  startsAt: [{ required: true, message: '请选择开始时间', trigger: 'change' }],
  endsAt: [{ required: true, message: '请选择结束时间', trigger: 'change' }, { validator: (_rule, value, done) => {
    try { done(interviewTimeToIso(value) > interviewTimeToIso(form.startsAt) ? undefined : new Error('结束时间必须晚于开始时间')); }
    catch { done(new Error('请填写完整、有效的北京时间')); }
  }, trigger: 'change' }],
  participantIds: [{ type: 'array', required: true, min: 1, message: '请选择内部参与人', trigger: 'change' },
    { validator: (_rule, _value, done) => done(blockedParticipantIds.value.length || checkingParticipants.value
      ? new Error('请先处理不可用参与人，核验通过后再保存') : undefined), trigger: 'change' }],
  invitationText: [{ required: true, whitespace: true, message: '请填写会议邀请内容', trigger: 'blur' }],
  meetingUrl: [{ validator: (_rule, value, done) => done(meetingValid(value) ? undefined : new Error('仅支持腾讯会议官方 HTTPS 链接')), trigger: 'blur' }],
};

function failure(cause: unknown) {
  const message = (cause as { response?: { data?: { message?: string } } }).response?.data?.message;
  return typeof message === 'string' ? message : '操作未完成，请稍后重试';
}
async function load() {
  const token = ++generation; loading.value = true; error.value = ''; loadFailed.value = false;
  try {
    const result = props.invitationId ? [await talentInterviewsApi.detail(props.invitationId)]
      : await talentInterviewsApi.list({ candidateId: props.candidateId });
    if (token === generation) {
      rows.value = result;
      if (props.invitationId) opened.value = [props.invitationId];
    }
  } catch (cause) { if (token === generation) { error.value = failure(cause); loadFailed.value = true; } }
  finally { if (token === generation) loading.value = false; }
}
function resetEditor() {
  ++searchGeneration; ++editorSession; editing.value = false; searching.value = false; checkingParticipants.value = false;
}
watch(() => [props.candidateId, props.invitationId], () => { rows.value = []; busy.value = false; resetEditor(); showHistory.value = false; void load(); }, { immediate: true });
onBeforeUnmount(() => { ++generation; resetEditor(); });

const leave = useRecruitmentLeaveGuard({ dirty: () => editing.value, busy: () => busy.value || refreshingEditor.value, discard: resetEditor }, true);
async function closeEditor() { if (await leave.prepareToLeave()) resetEditor(); }
async function toggleHistory() { if (await leave.prepareToLeave()) { showHistory.value = !showHistory.value; opened.value = []; } }
watch(() => props.application?.id, () => { showHistory.value = false; opened.value = []; });
function fillInviteTemplate() {
  form.invitationText = `${props.candidateName || current.value?.candidateNameSnapshot || '候选人'}，您好！\n邀请您参加${editorApplication.value?.positionName || '本岗位'}${inviteMode.value}。\n时间：${form.startsAt || '请补充开始时间'} 至 ${form.endsAt || '请补充结束时间'}（北京时间）\n${inviteMode.value === '线上面试' ? '会议方式 / 链接' : inviteMode.value === '电话面试' ? '联系电话 / 接听方式' : '面试地点'}：${inviteLocation.value || '请补充'}\n请回复是否能够参加，谢谢。`;
  generatedTemplate.value = form.invitationText;
  invitationChanged(form.invitationText);
}
async function useInviteTemplate() {
  if (!editing.value || !canSaveEditor.value || busy.value) return;
  const editor = editorSession, originalText = form.invitationText;
  if (form.invitationText && form.invitationText !== generatedTemplate.value) {
    try { await ElMessageBox.confirm('当前候选人邀请已填写。填入模板会替换现有文案，是否继续？', '替换候选人邀请', {
      confirmButtonText: '替换为模板', cancelButtonText: '保留原文', type: 'warning',
    }); } catch { return; }
  }
  if (editor !== editorSession || !editing.value || !canSaveEditor.value || busy.value || form.invitationText !== originalText) return;
  fillInviteTemplate();
}
watch([() => form.startsAt, () => form.endsAt, inviteMode, inviteLocation], () => {
  if (editing.value && !current.value && form.invitationText === generatedTemplate.value) fillInviteTemplate();
});
async function refreshEditor() {
  const row = current.value, editor = editorSession;
  if (!row || busy.value || refreshingEditor.value) return;
  refreshingEditor.value = true;
  try {
    const latest = await talentInterviewsApi.detail(row.id);
    if (editor !== editorSession || !editing.value) return;
    current.value = latest; refreshedSnapshot.value = latest; conflict.value = false;
    error.value = latest.status !== 'scheduled' || syncBlocked(latest) || latest.sourceDeleted
      ? '邀约当前不可修改，输入已保留，请核对状态或复制内容后取消编辑。'
      : '已读取最新邀约。请核对其他人的变更与本页输入，再保存。';
    await searchPeople();
  } catch (cause) { if (editor === editorSession) error.value = failure(cause); }
  finally { if (editor === editorSession) refreshingEditor.value = false; }
}
function participantIssue(person: InterviewPerson | null) {
  if (!person) return '状态无法核验，请重新核验或移除';
  if (person.archivedAt) return '已归档';
  if (person.status === 'resigned') return '已离职';
  return ['active', 'probation'].includes(person.status) ? '' : '当前不可用';
}
async function searchPeople(keyword?: string): Promise<boolean> {
  if (!editing.value) return false;
  const token = ++searchGeneration, selectedIds = [...form.participantIds];
  checkingParticipants.value = true; searching.value = keyword !== undefined;
  try {
    const query = { keyword: keyword?.trim() || undefined, page: 1, pageSize: 30, archived: false, includeTestAccounts: false };
    const [selected, options] = await Promise.all([
      Promise.all(selectedIds.map(async id => ({ id, person: await usersApi.findOne(id).catch(() => null) }))),
      keyword === undefined ? Promise.resolve(people.value) : Promise.all([
        usersApi.findAll({ ...query, status: 'active' }), usersApi.findAll({ ...query, status: 'probation' }),
      ]).then(results => results.flatMap(result => result.items)),
    ]);
    if (token !== searchGeneration || !editing.value) return false;
    participantIssues.value = {};
    const validSelected: InterviewPerson[] = [];
    for (const { id, person } of selected) {
      const issue = participantIssue(person);
      if (issue) participantIssues.value[id] = issue;
      else if (person) { validSelected.push(person); participantNames.value[id] = person.name; }
    }
    // Live per-ID results take precedence over a search page and the old selection cache.
    people.value = [...new Map([...options.filter(person => !selectedIds.includes(person.id) && !participantIssue(person)),
      ...validSelected].map(person => [person.id, person])).values()];
    return !blockedParticipantIds.value.length;
  } catch (cause) {
    if (token === searchGeneration && editing.value) {
      error.value = failure(cause);
      participantIssues.value = Object.fromEntries(selectedIds.map(id => [id, '状态无法核验，请重新核验或移除']));
      people.value = [];
    }
    return false;
  } finally { if (token === searchGeneration) { searching.value = false; checkingParticipants.value = false; } }
}
function removeParticipant(id: string) {
  form.participantIds = form.participantIds.filter(selected => selected !== id);
  delete participantIssues.value[id];
  void searchPeople();
}
async function openEditor(row: TalentInterviewView | null, targetApplication?: InterviewApplication) {
  if (!props.editable || busy.value || refreshingEditor.value) return;
  targetApplication ??= props.application ?? undefined;
  if (!row && !targetApplication) { error.value = '请先在上方新增或选择本次应聘，再安排面试。'; return; }
  if (!await leave.prepareToLeave()) return;
  resetEditor(); conflict.value = false; refreshedSnapshot.value = null;
  current.value = row; editing.value = true; error.value = '';
  applicationId.value = row ? row.applicationId ?? undefined : targetApplication?.id;
  editorApplication.value = row ? row.application ?? null : targetApplication ?? null;
  requestId.value = row ? '' : crypto.randomUUID();
  meetingLinkManual.value = Boolean(row?.meetingUrl);
  meetingExtraction.value = null;
  inviteMode.value = row?.meetingUrl ? '线上面试' : row?.invitationText.includes('电话面试') ? '电话面试' : '现场面试';
  inviteLocation.value = '';
  Object.assign(form, { startsAt: row ? formatInterviewTime(row.startsAt) : '', endsAt: row ? formatInterviewTime(row.endsAt) : '',
    participantIds: row?.participants?.map((p) => p.userId) ?? [], invitationText: row?.invitationText ?? '',
    meetingUrl: row?.meetingUrl ?? '', note: row?.note ?? '' });
  people.value = [];
  participantNames.value = Object.fromEntries((row?.participants ?? []).map(p => [p.userId, p.userNameSnapshot]));
  participantIssues.value = Object.fromEntries(form.participantIds.map(id => [id, '正在核验当前任职状态']));
  if (!row) fillInviteTemplate();
  formRef.value?.clearValidate();
  void searchPeople();
}
async function openForApplication(application: InterviewApplication) {
  if (busy.value) return;
  await openEditor(null, application);
  void nextTick(() => panelElement.value?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
}
defineExpose({ openForApplication, prepareToLeave: leave.prepareToLeave });
async function save() {
  const token = generation, editor = editorSession, candidateId = props.candidateId, row = current.value;
  const valid = () => canSaveEditor.value && token === generation && editor === editorSession && candidateId === props.candidateId && editing.value;
  if (!canSaveEditor.value || busy.value || checkingParticipants.value || !valid()) return;
  busy.value = true; error.value = '';
  const formValid = await formRef.value?.validate().catch(() => false);
  if (!formValid || !valid()) { busy.value = false; return; }
  try {
    if (!await searchPeople()) { await formRef.value?.validateField('participantIds').catch(() => false); return; }
    if (!valid()) return;
    const body = { ...form, startsAt: interviewTimeToIso(form.startsAt), endsAt: interviewTimeToIso(form.endsAt),
      participantIds: [...form.participantIds], meetingUrl: form.meetingUrl.trim() || null, note: form.note.trim() || null };
    if (row) await talentInterviewsApi.update(row.id, { ...body, version: row.version });
    else await talentInterviewsApi.create({ ...body, candidateId, applicationId: applicationId.value!, requestId: requestId.value });
    if (!valid()) return;
    resetEditor(); conflict.value = false; ElMessage.success('已保存HRM面试安排，请复制邀请并人工联系候选人'); emit('changed'); await load();
  } catch (cause) { if (valid()) { conflict.value = (cause as { response?: { status: number } }).response?.status === 409; error.value = conflict.value ? '邀约已变化，输入已保留，请刷新邀约并核对后重试。' : failure(cause); } }
  finally { if (candidateId === props.candidateId && (editor === editorSession || !editing.value)) busy.value = false; }
}
function syncBlocked(row: TalentInterviewView) { return ['processing', 'uncertain'].includes(row.syncStatus ?? ''); }
async function reconcile(row: TalentInterviewView) {
  if (!props.editable || busy.value) return;
  const token = generation;
  busy.value = true; error.value = '';
  try {
    const result = await talentInterviewsApi.reconcileCalendar(row.id, row.version);
    if (token !== generation) return;
    if (result.status === 'pending') {
      ElMessage.success('已找到原日程，正在同步到该日程');
      await load();
    } else if (result.status === 'unconfigured') {
      error.value = '日程同步尚未开通，邀约记录仍保留。';
    } else {
      const messages: Record<string, string> = {
        no_match: '暂未找到原日程，请在钉钉核实后再核对；不会自动新建日程。',
        multiple_matches: '发现多个关联日程，请先在钉钉核对重复记录。',
        read_failed: '读取钉钉日程失败，请检查日程读取权限和网络后重试。',
        event_unavailable: '原日程已变化或不可访问，请先在钉钉核对。',
      };
      error.value = messages[result.reason ?? ''] ?? '日程结果仍无法确认，请核实后重试；不会重复创建日程。';
    }
  } catch (cause) { if (token === generation) error.value = failure(cause); }
  finally { if (token === generation || rows.value.some(item => item.id === row.id)) busy.value = false; }
}
async function action(row: TalentInterviewView, command: 'cancel' | 'complete' | 'retry-sync') {
  if (!props.editable || busy.value) return;
  if (!await leave.prepareToLeave()) return;
  const token = generation;
  if (command !== 'retry-sync') {
    try { await ElMessageBox.confirm(command === 'cancel' ? '取消这条面试邀约？腾讯会议本身仍需单独处理。' : (new Date(row.startsAt).getTime() > Date.now() ? '该面试尚未到预约时间。仅在实际已完成面试时提前标记，是否继续？' : '请确认实际已完成面试，再将这条记录标记为已完成。'), '面试邀约',
      { confirmButtonText: command === 'cancel' ? '取消面试' : '完成面试', cancelButtonText: '返回' }); } catch { return; }
  }
  if (!props.editable || token !== generation || busy.value) return;
  busy.value = true; error.value = '';
  try { await talentInterviewsApi.action(row.id, command, row.version); if (token !== generation) return; emit('changed'); await load(); }
  catch (cause) { if (token === generation) error.value = failure(cause); }
  finally { if (token === generation || rows.value.some(item => item.id === row.id)) busy.value = false; }
}
</script>

<template>
  <section ref="panelElement" v-loading="loading" class="interview-panel">
    <header><h4>{{ application ? '本次应聘面试' : '面试邀约' }}</h4><div class="interview-panel__actions">
      <el-tooltip content="刷新邀约"><el-button :icon="Refresh" size="small" aria-label="刷新邀约" :disabled="busy || editing" @click="load" /></el-tooltip>
      <el-button v-if="editable && !invitationId" size="small" :icon="Plus" :disabled="busy" @click="openEditor(null)">新增面试</el-button>
    </div></header>
    <p v-if="calendarUnconfigured" class="interview-panel__link-hint" role="note">已保存的安排仅在HRM内办理，钉钉日程未开通。候选人仍需经办人工联系。</p>
    <el-button v-if="historicalRows.length" link type="primary" :disabled="busy" @click="toggleHistory">{{ showHistory ? '返回本次应聘面试' : `查看其他应聘 / 未关联历史（${historicalRows.length}）` }}</el-button>
    <el-alert v-if="error" :title="error" type="error" :closable="false"><el-button v-if="conflict && current" link type="primary" :disabled="busy || refreshingEditor" @click="refreshEditor">刷新邀约，保留输入</el-button><el-button v-else-if="loadFailed" link type="primary" @click="load">重试</el-button></el-alert>
    <el-form v-if="editing && editable" ref="formRef" :model="form" :rules="rules" label-position="top" class="interview-panel__editor" :disabled="busy || refreshingEditor">
      <el-collapse v-if="refreshedSnapshot" class="interview-panel__latest"><el-collapse-item title="最新已保存内容（核对后重提）" name="latest">
        <p>{{ formatInterviewTime(refreshedSnapshot.startsAt) }} 至 {{ formatInterviewTime(refreshedSnapshot.endsAt) }}（北京时间） · {{ INTERVIEW_STATUS_LABELS[refreshedSnapshot.status] }}</p>
        <p>内部参与人：{{ refreshedSnapshot.participantNames.join('、') }}</p>
        <p class="interview-panel__note">{{ refreshedSnapshot.invitationText }}</p>
        <p v-if="refreshedSnapshot.meetingUrl" class="interview-panel__note">腾讯会议链接：{{ refreshedSnapshot.meetingUrl }}</p>
        <p v-if="refreshedSnapshot.note" class="interview-panel__note">内部备注：{{ refreshedSnapshot.note }}</p>
      </el-collapse-item></el-collapse>
      <el-form-item label="关联应聘">{{ interviewApplicationLabel(editorApplication) }}</el-form-item>
      <p v-if="current && !current.applicationId" class="interview-panel__link-hint">这是未关联应聘的历史邀约，保存修改不会自动绑定到当前应聘。</p>
      <div class="interview-panel__times">
        <el-form-item label="开始时间（北京时间）" prop="startsAt"><el-date-picker v-model="form.startsAt" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" /></el-form-item>
        <el-form-item label="结束时间（北京时间）" prop="endsAt"><el-date-picker v-model="form.endsAt" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" /></el-form-item>
      </div>
      <el-form-item label="内部参与人" prop="participantIds">
        <el-select v-model="selectableParticipantIds" multiple filterable remote :remote-method="searchPeople" :loading="searching || checkingParticipants" :multiple-limit="50 - blockedParticipantIds.length" placeholder="搜索姓名或工号" @focus="searchPeople('')">
          <el-option v-for="person in people" :key="person.id" :value="person.id" :label="[person.name, person.employeeNo].filter(Boolean).join(' · ')" />
        </el-select>
        <div v-if="blockedParticipantIds.length" role="region" aria-label="待处理参与人" class="interview-panel__participant-issues">
          <div>以下参与人仍保留在本次邀约中，处理后才能保存。
            <el-tooltip content="重新核验参与人"><el-button :icon="Refresh" aria-label="重新核验参与人" size="small" :loading="checkingParticipants" @click="searchPeople()" /></el-tooltip>
          </div>
          <ul><li v-for="id in blockedParticipantIds" :key="id">
            <span>{{ participantNames[id] || '历史参与人' }}：{{ participantIssues[id] }}</span>
            <el-button size="small" type="danger" link :aria-label="`移除参与人 ${participantNames[id] || '历史参与人'}`" @click="removeParticipant(id)">移除</el-button>
          </li></ul>
        </div>
      </el-form-item>
      <div class="interview-panel__template">
        <el-select v-model="inviteMode" aria-label="面试方式"><el-option v-for="mode in ['现场面试', '电话面试', '线上面试']" :key="mode" :label="mode" :value="mode" /></el-select>
        <el-input v-model="inviteLocation" aria-label="面试地点或联系方式" placeholder="面试地点、接听方式或会议链接" />
        <el-button @click="useInviteTemplate">填入候选人模板</el-button>
      </div>
      <el-form-item label="会议邀请内容（候选人版）" prop="invitationText"><el-input v-model="form.invitationText" type="textarea" :rows="5" maxlength="10000" show-word-limit @input="invitationChanged" /></el-form-item>
      <el-form-item label="腾讯会议链接（选填）" prop="meetingUrl">
        <el-input v-model="form.meetingUrl" maxlength="1000" placeholder="https://meeting.tencent.com/..." @input="meetingLinkManual = true" />
        <p v-if="meetingHint" role="status" class="interview-panel__link-hint">{{ meetingHint }}</p>
      </el-form-item>
      <el-form-item label="安排备注（内部参与人可见）" prop="note"><el-input v-model="form.note" type="textarea" :rows="2" maxlength="2000" show-word-limit /></el-form-item>
      <div class="interview-panel__actions"><el-button @click="closeEditor">取消编辑</el-button><el-button type="primary" :loading="busy" :disabled="!canSaveEditor || checkingParticipants || blockedParticipantIds.length > 0" @click="save">保存邀约</el-button></div>
    </el-form>
    <el-empty v-if="!loading && !displayedRows.length && !editing" description="暂无面试邀约" :image-size="50" />
    <el-collapse v-if="displayedRows.length" v-model="opened" class="interview-panel__list">
      <el-collapse-item v-for="row in displayedRows" :key="row.id" :name="row.id">
        <template #title><div class="interview-panel__summary"><span>{{ formatInterviewTime(row.startsAt) }}（北京时间）</span><span v-if="row.application !== undefined">{{ interviewApplicationLabel(row.application) }}</span><span>{{ INTERVIEW_STATUS_LABELS[row.status] }}</span><el-tag v-if="row.syncStatus && row.syncStatus !== 'unconfigured'" size="small" :type="row.syncStatus === 'synced' ? 'success' : 'info'">{{ INTERVIEW_SYNC_LABELS[row.syncStatus ?? 'unconfigured'] }}</el-tag></div></template>
        <TalentInterviewContent :key="row.id" :invitation="row" @changed="emit('changed')" />
        <div v-if="editable" class="interview-panel__actions">
          <el-button v-if="row.status === 'scheduled'" size="small" :disabled="busy || syncBlocked(row)" @click="openEditor(row)">修改邀约</el-button>
          <el-button v-if="row.status === 'scheduled'" size="small" :disabled="busy || syncBlocked(row)" @click="action(row, 'complete')">完成面试</el-button>
          <el-button v-if="row.status === 'scheduled'" size="small" type="danger" plain :disabled="busy || syncBlocked(row)" @click="action(row, 'cancel')">取消面试</el-button>
          <el-button v-if="row.syncStatus === 'failed'" size="small" :disabled="busy" @click="action(row, 'retry-sync')">重试日程同步</el-button>
          <el-button v-if="row.syncStatus === 'uncertain'" size="small" :loading="busy" @click="reconcile(row)">核对钉钉日程</el-button>
          <router-link :to="`/talent-interviews/${row.id}`">打开邀约</router-link>
        </div>
      </el-collapse-item>
    </el-collapse>
  </section>
</template>

<style scoped>
.interview-panel { margin-top: 20px; min-width: 0; }
header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
h4 { margin: 0; font-size: 14px; }
.interview-panel__actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.interview-panel__actions .el-button { margin-left: 0; }
.interview-panel__actions a { color: var(--el-color-primary); }
.interview-panel__editor { margin: 12px 0; border-block: 1px solid var(--el-border-color); padding: 14px 0; }
.interview-panel__template { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
.interview-panel__times { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.interview-panel__editor :deep(.el-date-editor), .interview-panel__editor :deep(.el-select) { width: 100%; min-width: 0; }
.interview-panel__summary { display: flex; flex-wrap: wrap; gap: 6px 12px; min-width: 0; overflow-wrap: anywhere; line-height: 1.5; padding: 8px 0; text-align: left; }
.interview-panel__list :deep(.el-collapse-item__header) { min-height: 48px; height: auto; }
.interview-panel__note { white-space: pre-wrap; overflow-wrap: anywhere; }
.interview-panel__link-hint { margin: 6px 0 0; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.interview-panel__participant-issues { width: 100%; margin-top: 8px; color: var(--el-color-warning-dark-2); line-height: 1.5; }
.interview-panel__participant-issues ul { margin: 6px 0 0; padding: 0; list-style: none; }
.interview-panel__participant-issues li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0; }
.interview-panel__participant-issues span { min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 768px) { .interview-panel__editor > .interview-panel__actions { position: sticky; bottom: -14px; background: var(--el-bg-color); padding: 10px 0; z-index: 2; }  .interview-panel__times { grid-template-columns: minmax(0, 1fr); gap: 0; } }
</style>
