<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { Plus, Refresh } from '@element-plus/icons-vue';
import { talentInterviewsApi } from '@/api/talent-pool.api';
import { usersApi } from '@/api/users.api';
import { INTERVIEW_STATUS_LABELS, INTERVIEW_SYNC_LABELS, type TalentInterviewView } from '@/types/talent.types';
import TalentInterviewContent from './TalentInterviewContent.vue';
import { formatInterviewTime, interviewTimeToIso } from '../interview-time';

const props = defineProps<{ candidateId: string; editable: boolean; invitationId?: string }>();
const rows = ref<TalentInterviewView[]>([]), loading = ref(false), busy = ref(false), error = ref('');
const editing = ref(false), current = ref<TalentInterviewView | null>(null), formRef = ref<FormInstance>();
const requestId = ref('');
const opened = ref<string[]>([]);
const people = ref<Array<{ id: string; name: string; employeeNo?: string | null }>>([]), searching = ref(false);
const form = reactive({ startsAt: '', endsAt: '', participantIds: [] as string[], invitationText: '', meetingUrl: '', note: '' });
let generation = 0, searchGeneration = 0;

function meetingValid(value: string) {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return !/[\s\\\u0000-\u001f\u007f]/.test(value.trim()) && url.protocol === 'https:' && url.hostname === 'meeting.tencent.com'
      && !url.username && !url.password && (!url.port || url.port === '443');
  } catch { return false; }
}
const rules: FormRules = {
  startsAt: [{ required: true, message: '请选择开始时间', trigger: 'change' }],
  endsAt: [{ required: true, message: '请选择结束时间', trigger: 'change' }, { validator: (_rule, value, done) => {
    try { done(interviewTimeToIso(value) > interviewTimeToIso(form.startsAt) ? undefined : new Error('结束时间必须晚于开始时间')); }
    catch { done(new Error('请填写完整、有效的北京时间')); }
  }, trigger: 'change' }],
  participantIds: [{ type: 'array', required: true, min: 1, message: '请选择内部参与人', trigger: 'change' }],
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
watch(() => [props.candidateId, props.invitationId], () => { rows.value = []; editing.value = false; void load(); }, { immediate: true });

async function searchPeople(keyword: string) {
  const token = ++searchGeneration; searching.value = true;
  try {
    const query = { keyword: keyword.trim() || undefined, page: 1, pageSize: 30, archived: false, includeTestAccounts: false };
    const active = await usersApi.findAll({ ...query, status: 'active' });
    const probation = await usersApi.findAll({ ...query, status: 'probation' });
    if (token !== searchGeneration) return;
    const selected = people.value.filter((person) => form.participantIds.includes(person.id));
    people.value = [...new Map([...selected, ...active.items, ...probation.items].map((person) => [person.id, person])).values()];
  } catch (cause) { if (token === searchGeneration) error.value = failure(cause); }
  finally { if (token === searchGeneration) searching.value = false; }
}
function openEditor(row: TalentInterviewView | null) {
  if (!props.editable) return;
  current.value = row; editing.value = true; error.value = '';
  requestId.value = row ? '' : crypto.randomUUID();
  Object.assign(form, { startsAt: row ? formatInterviewTime(row.startsAt) : '', endsAt: row ? formatInterviewTime(row.endsAt) : '',
    participantIds: row?.participants?.map((p) => p.userId) ?? [], invitationText: row?.invitationText ?? '',
    meetingUrl: row?.meetingUrl ?? '', note: row?.note ?? '' });
  people.value = row?.participants?.map((p) => ({ id: p.userId, name: p.userNameSnapshot })) ?? [];
  formRef.value?.clearValidate();
}
async function save() {
  if (!props.editable || busy.value || !await formRef.value?.validate().catch(() => false)) return;
  busy.value = true; error.value = '';
  try {
    const body = { ...form, startsAt: interviewTimeToIso(form.startsAt), endsAt: interviewTimeToIso(form.endsAt),
      participantIds: [...form.participantIds], meetingUrl: form.meetingUrl.trim() || null, note: form.note.trim() || null };
    if (current.value) await talentInterviewsApi.update(current.value.id, { ...body, version: current.value.version });
    else await talentInterviewsApi.create({ ...body, candidateId: props.candidateId, requestId: requestId.value });
    editing.value = false; ElMessage.success('面试邀约已保存'); await load();
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
        <el-select v-model="form.participantIds" multiple filterable remote :remote-method="searchPeople" :loading="searching" :multiple-limit="50" placeholder="搜索姓名或工号" @focus="searchPeople('')">
          <el-option v-for="person in people" :key="person.id" :value="person.id" :label="[person.name, person.employeeNo].filter(Boolean).join(' · ')" />
        </el-select>
      </el-form-item>
      <el-form-item label="会议邀请内容" prop="invitationText"><el-input v-model="form.invitationText" type="textarea" :rows="5" maxlength="10000" show-word-limit /></el-form-item>
      <el-form-item label="腾讯会议链接" prop="meetingUrl"><el-input v-model="form.meetingUrl" maxlength="1000" placeholder="https://meeting.tencent.com/..." /></el-form-item>
      <el-form-item label="安排备注" prop="note"><el-input v-model="form.note" type="textarea" :rows="2" maxlength="2000" show-word-limit /></el-form-item>
      <div class="interview-panel__actions"><el-button @click="editing = false">取消编辑</el-button><el-button type="primary" :loading="busy" @click="save">保存邀约</el-button></div>
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
@media (max-width: 768px) { .interview-panel__times { grid-template-columns: minmax(0, 1fr); gap: 0; } }
</style>
