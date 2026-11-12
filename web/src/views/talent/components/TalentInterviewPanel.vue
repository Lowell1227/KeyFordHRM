<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { Plus, Refresh } from '@element-plus/icons-vue';
import { talentInterviewsApi } from '@/api/talent-pool.api';
import { usersApi } from '@/api/users.api';
import type { User } from '@/types/api.types';
import { INTERVIEW_STATUS_LABELS, INTERVIEW_SYNC_LABELS, type TalentInterviewView } from '@/types/talent.types';
import TalentInterviewContent from './TalentInterviewContent.vue';
import { formatInterviewTime, interviewTimeToIso } from '../interview-time';
import { extractTencentMeetingLink, safeTencentMeetingLink } from '../interview-meeting-link';

const props = defineProps<{ candidateId: string; editable: boolean; invitationId?: string }>();
const rows = ref<TalentInterviewView[]>([]), loading = ref(false), busy = ref(false), error = ref('');
const editing = ref(false), current = ref<TalentInterviewView | null>(null), formRef = ref<FormInstance>();
const requestId = ref('');
const opened = ref<string[]>([]);
type InterviewPerson = Pick<User, 'id' | 'name' | 'employeeNo' | 'status' | 'archivedAt'>;
const people = ref<InterviewPerson[]>([]), searching = ref(false), checkingParticipants = ref(false);
const participantNames = ref<Record<string, string>>({}), participantIssues = ref<Record<string, string>>({});
const form = reactive({ startsAt: '', endsAt: '', participantIds: [] as string[], invitationText: '', meetingUrl: '', note: '' });
const meetingLinkManual = ref(false);
const meetingExtraction = ref<ReturnType<typeof extractTencentMeetingLink> | null>(null);
let generation = 0, searchGeneration = 0;
const blockedParticipantIds = computed(() => form.participantIds.filter(id => participantIssues.value[id]));
const selectableParticipantIds = computed({
  get: () => form.participantIds.filter(id => !participantIssues.value[id]),
  set: (ids: string[]) => {
    // Keep unresolved historical participants until HR explicitly removes them.
    form.participantIds = [...blockedParticipantIds.value, ...ids];
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
    : status === 'none' ? '未识别到有效的腾讯会议链接，请核对邀请并手动填写。' : '';
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
  const token = ++generation; loading.value = true; error.value = '';
  try {
    const result = props.invitationId ? [await talentInterviewsApi.detail(props.invitationId)]
      : await talentInterviewsApi.list({ candidateId: props.candidateId });
    if (token === generation) {
      rows.value = result;
      if (props.invitationId) opened.value = [props.invitationId];
    }
  } catch (cause) { if (token === generation) error.value = failure(cause); }
  finally { if (token === generation) loading.value = false; }
}
function closeEditor() {
  ++searchGeneration; editing.value = false; searching.value = false; checkingParticipants.value = false;
}
watch(() => [props.candidateId, props.invitationId], () => { rows.value = []; closeEditor(); void load(); }, { immediate: true });
onBeforeUnmount(closeEditor);

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
function openEditor(row: TalentInterviewView | null) {
  if (!props.editable) return;
  closeEditor();
  current.value = row; editing.value = true; error.value = '';
  requestId.value = row ? '' : crypto.randomUUID();
  meetingLinkManual.value = Boolean(row?.meetingUrl);
  meetingExtraction.value = null;
  Object.assign(form, { startsAt: row ? formatInterviewTime(row.startsAt) : '', endsAt: row ? formatInterviewTime(row.endsAt) : '',
    participantIds: row?.participants?.map((p) => p.userId) ?? [], invitationText: row?.invitationText ?? '',
    meetingUrl: row?.meetingUrl ?? '', note: row?.note ?? '' });
  people.value = [];
  participantNames.value = Object.fromEntries((row?.participants ?? []).map(p => [p.userId, p.userNameSnapshot]));
  participantIssues.value = Object.fromEntries(form.participantIds.map(id => [id, '正在核验当前任职状态']));
  formRef.value?.clearValidate();
  void searchPeople();
}
async function save() {
  if (!props.editable || busy.value || checkingParticipants.value || !await formRef.value?.validate().catch(() => false)) return;
  busy.value = true; error.value = '';
  try {
    if (!await searchPeople()) { await formRef.value?.validateField('participantIds').catch(() => false); return; }
    const body = { ...form, startsAt: interviewTimeToIso(form.startsAt), endsAt: interviewTimeToIso(form.endsAt),
      participantIds: [...form.participantIds], meetingUrl: form.meetingUrl.trim() || null, note: form.note.trim() || null };
    if (current.value) await talentInterviewsApi.update(current.value.id, { ...body, version: current.value.version });
    else await talentInterviewsApi.create({ ...body, candidateId: props.candidateId, requestId: requestId.value });
    closeEditor(); ElMessage.success('面试邀约已保存'); await load();
  } catch (cause) { error.value = failure(cause); }
  finally { busy.value = false; }
}
function syncBlocked(row: TalentInterviewView) { return ['processing', 'uncertain'].includes(row.syncStatus ?? ''); }
async function reconcile(row: TalentInterviewView) {
  if (!props.editable || busy.value) return;
  busy.value = true; error.value = '';
  try {
    const result = await talentInterviewsApi.reconcileCalendar(row.id, row.version);
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
  } catch (cause) { error.value = failure(cause); }
  finally { busy.value = false; }
}
async function action(row: TalentInterviewView, command: 'cancel' | 'complete' | 'retry-sync') {
  if (!props.editable || busy.value) return;
  if (command !== 'retry-sync') {
    try { await ElMessageBox.confirm(command === 'cancel' ? '取消这条面试邀约？腾讯会议本身仍需单独处理。' : '将这条面试记录标记为已完成？', '面试邀约',
      { confirmButtonText: command === 'cancel' ? '取消面试' : '完成面试', cancelButtonText: '返回' }); } catch { return; }
  }
  busy.value = true; error.value = '';
  try { await talentInterviewsApi.action(row.id, command, row.version); await load(); }
  catch (cause) { error.value = failure(cause); }
  finally { busy.value = false; }
}
</script>

<template>
  <section v-loading="loading" class="interview-panel">
    <header><h4>面试邀约</h4><div class="interview-panel__actions">
      <el-tooltip content="刷新邀约"><el-button :icon="Refresh" size="small" aria-label="刷新邀约" :disabled="busy" @click="load" /></el-tooltip>
      <el-button v-if="editable && !invitationId" size="small" :icon="Plus" :disabled="busy" @click="openEditor(null)">新增面试</el-button>
    </div></header>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-form v-if="editing && editable" ref="formRef" :model="form" :rules="rules" label-position="top" class="interview-panel__editor" :disabled="busy">
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
      <el-form-item label="会议邀请内容" prop="invitationText"><el-input v-model="form.invitationText" type="textarea" :rows="5" maxlength="10000" show-word-limit @input="invitationChanged" /></el-form-item>
      <el-form-item label="腾讯会议链接" prop="meetingUrl">
        <el-input v-model="form.meetingUrl" maxlength="1000" placeholder="https://meeting.tencent.com/..." @input="meetingLinkManual = true" />
        <p v-if="meetingHint" role="status" class="interview-panel__link-hint">{{ meetingHint }}</p>
      </el-form-item>
      <el-form-item label="安排备注" prop="note"><el-input v-model="form.note" type="textarea" :rows="2" maxlength="2000" show-word-limit /></el-form-item>
      <div class="interview-panel__actions"><el-button @click="closeEditor">取消编辑</el-button><el-button type="primary" :loading="busy" :disabled="checkingParticipants || blockedParticipantIds.length > 0" @click="save">保存邀约</el-button></div>
    </el-form>
    <el-empty v-if="!loading && !rows.length && !editing" description="暂无面试邀约" :image-size="50" />
    <el-collapse v-if="rows.length" v-model="opened" class="interview-panel__list">
      <el-collapse-item v-for="row in rows" :key="row.id" :name="row.id">
        <template #title><div class="interview-panel__summary"><span>{{ formatInterviewTime(row.startsAt) }}（北京时间）</span><span>{{ INTERVIEW_STATUS_LABELS[row.status] }}</span><el-tag size="small" :type="row.syncStatus === 'synced' ? 'success' : 'info'">{{ INTERVIEW_SYNC_LABELS[row.syncStatus ?? 'unconfigured'] }}</el-tag></div></template>
        <TalentInterviewContent :invitation="row" />
        <div v-if="editable" class="interview-panel__actions">
          <el-button v-if="row.status === 'scheduled'" size="small" :disabled="busy || syncBlocked(row)" @click="openEditor(row)">修改邀约</el-button>
          <el-button v-if="row.status === 'scheduled'" size="small" :disabled="busy || syncBlocked(row)" @click="action(row, 'complete')">完成面试</el-button>
          <el-button v-if="row.status === 'scheduled'" size="small" type="danger" plain :disabled="busy || syncBlocked(row)" @click="action(row, 'cancel')">取消面试</el-button>
          <el-button v-if="['failed', 'unconfigured'].includes(row.syncStatus ?? '')" size="small" :disabled="busy" @click="action(row, 'retry-sync')">重试日程同步</el-button>
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
.interview-panel__times { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.interview-panel__editor :deep(.el-date-editor), .interview-panel__editor :deep(.el-select) { width: 100%; min-width: 0; }
.interview-panel__summary { display: flex; flex-wrap: wrap; gap: 6px 12px; line-height: 1.5; padding: 8px 0; text-align: left; }
.interview-panel__list :deep(.el-collapse-item__header) { min-height: 48px; height: auto; }
.interview-panel__note { white-space: pre-wrap; overflow-wrap: anywhere; }
.interview-panel__link-hint { margin: 6px 0 0; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.interview-panel__participant-issues { width: 100%; margin-top: 8px; color: var(--el-color-warning-dark-2); line-height: 1.5; }
.interview-panel__participant-issues ul { margin: 6px 0 0; padding: 0; list-style: none; }
.interview-panel__participant-issues li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0; }
.interview-panel__participant-issues span { min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 768px) { .interview-panel__times { grid-template-columns: minmax(0, 1fr); gap: 0; } }
</style>
