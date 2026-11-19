<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { recruitmentError, talentRecruitmentApi } from '@/api/talent-recruitment.api';
import { FEEDBACK_OUTCOME_LABELS, type TalentFeedbackOutcome, type TalentFeedbackResponse, type TalentInterviewFeedbackView } from '@/types/talent.types';
import { formatDate } from '@/utils/date';

const props = defineProps<{ interviewId: string; interviewVersion: number }>();
const data = ref<TalentFeedbackResponse | null>(null), loading = ref(false), busy = ref(false), error = ref('');
const loadFailed = ref(false), conflict = ref(false), dirty = ref(false), baseInterviewVersion = ref(0);
const form = reactive({ outcome: '' as TalentFeedbackOutcome | '', summary: '' });
const fieldErrors = reactive({ outcome: '', summary: '' });
const returningId = ref(''), returnNote = ref(''), returnError = ref('');
let session = 0;
const canEdit = computed(() => data.value?.canEdit && data.value?.own?.status !== 'submitted');
const otherFeedback = computed(() => data.value?.items.filter(item => item.userId !== data.value?.own?.userId) ?? []);
const histories = computed(() => [data.value?.own, ...otherFeedback.value].filter((item): item is TalentInterviewFeedbackView => Boolean(item?.history?.length)));
function historyLabel(action: string) { return ({ submit_feedback: '提交反馈', save_feedback: '保存草稿', return_feedback: '退回修改', submit: '提交反馈', return: '退回修改' } as Record<string, string>)[action] ?? '反馈更新'; }
function valid(token: number, id: string) { return token === session && id === props.interviewId; }
function apply(result: TalentFeedbackResponse, preserve = false) {
  data.value = result;
  if (!preserve) { form.outcome = result.own?.outcome ?? ''; form.summary = result.own?.summary ?? ''; dirty.value = false; }
}
async function load(preserve = false) {
  if (busy.value) return;
  const token = ++session, id = props.interviewId, version = props.interviewVersion;
  loading.value = true; error.value = ''; loadFailed.value = false;
  try {
    const result = await talentRecruitmentApi.feedback(id);
    if (!valid(token, id)) return;
    apply(result, preserve); baseInterviewVersion.value = version; conflict.value = false;
  } catch (cause) { if (valid(token, id)) { error.value = recruitmentError(cause); loadFailed.value = true; } }
  finally { if (valid(token, id)) loading.value = false; }
}
watch(() => props.interviewId, () => {
  ++session; data.value = null; busy.value = false; dirty.value = false; returningId.value = ''; conflict.value = false;
  form.outcome = ''; form.summary = ''; fieldErrors.outcome = ''; fieldErrors.summary = ''; void load();
}, { immediate: true });
watch(() => props.interviewVersion, () => {
  if (dirty.value || returningId.value || busy.value) { error.value = '邀约已变化，输入已保留，请刷新核对后再提交。'; conflict.value = true; }
  else void load();
});
onBeforeUnmount(() => { ++session; });
async function save(submit: boolean) {
  if (!canEdit.value || busy.value) return;
  fieldErrors.outcome = submit && !form.outcome ? '请选择面试结论' : '';
  fieldErrors.summary = submit && !form.summary.trim() ? '请填写面试意见' : '';
  if (fieldErrors.outcome || fieldErrors.summary) return;
  const token = session, id = props.interviewId;
  const body = { interviewVersion: baseInterviewVersion.value, expectedRevision: data.value?.own?.revision ?? 0, outcome: form.outcome || undefined, summary: form.summary.trim(), submit };
  busy.value = true; error.value = '';
  try {
    const result = await talentRecruitmentApi.saveFeedback(id, body);
    if (!valid(token, id)) return;
    apply(result); conflict.value = false;
  } catch (cause) { if (valid(token, id)) { error.value = recruitmentError(cause); conflict.value = (cause as { response?: { status: number } }).response?.status === 409; } }
  finally { if (valid(token, id)) busy.value = false; }
}
function beginReturn(item: TalentInterviewFeedbackView) { returningId.value = item.userId; returnNote.value = ''; returnError.value = ''; error.value = ''; }
async function returnFeedback(item: TalentInterviewFeedbackView) {
  if (!data.value?.canReturn || busy.value || item.status !== 'submitted') return;
  returnError.value = returnNote.value.trim() ? '' : '请填写退回原因';
  if (returnError.value) return;
  const token = session, id = props.interviewId;
  busy.value = true; error.value = '';
  try {
    const result = await talentRecruitmentApi.returnFeedback(id, item.userId, { interviewVersion: baseInterviewVersion.value, expectedRevision: item.revision, note: returnNote.value.trim() });
    if (!valid(token, id)) return;
    apply(result, dirty.value); returningId.value = ''; conflict.value = false;
  } catch (cause) { if (valid(token, id)) { error.value = recruitmentError(cause); conflict.value = (cause as { response?: { status: number } }).response?.status === 409; } }
  finally { if (valid(token, id)) busy.value = false; }
}
</script>

<template>
  <section v-loading="loading" class="interview-feedback">
    <header><h4>本人反馈</h4><el-tooltip content="刷新反馈"><el-button :icon="Refresh" aria-label="刷新反馈" size="small" :disabled="busy || dirty || !!returningId" @click="load()" /></el-tooltip></header>
    <el-alert v-if="error" :title="error" type="error" :closable="false">
      <el-button v-if="conflict" link type="primary" @click="load(true)">刷新反馈，保留输入</el-button>
      <el-button v-else-if="loadFailed" link type="primary" @click="load(dirty)">重试</el-button>
    </el-alert>
    <el-form v-if="canEdit" label-position="top" :disabled="busy" class="interview-feedback__form">
      <el-form-item label="面试结论" :error="fieldErrors.outcome"><el-radio-group v-model="form.outcome" @change="dirty = true"><el-radio-button v-for="(label, value) in FEEDBACK_OUTCOME_LABELS" :key="value" :value="value">{{ label }}</el-radio-button></el-radio-group></el-form-item>
      <el-form-item label="面试意见" :error="fieldErrors.summary"><el-input v-model="form.summary" type="textarea" :rows="4" maxlength="4000" show-word-limit @input="dirty = true" /></el-form-item>
      <div class="interview-feedback__actions"><el-button :loading="busy" @click="save(false)">保存草稿</el-button><el-button type="primary" :loading="busy" @click="save(true)">提交反馈</el-button></div>
    </el-form>
    <div v-else-if="data?.own" class="interview-feedback__record">
      <div>{{ data.own.status === 'submitted' ? '已提交' : '草稿（当前不可修改）' }} · {{ data.own.outcome ? FEEDBACK_OUTCOME_LABELS[data.own.outcome] : '未填写结论' }}<span v-if="data.own.submittedAt"> · {{ formatDate(data.own.submittedAt) }}</span></div>
      <p>{{ data.own.summary || '未填写意见' }}</p>
      <el-button v-if="data.canReturn && data.own.status === 'submitted' && !returningId" size="small" @click="beginReturn(data.own)">退回反馈</el-button>
    </div>
    <p v-else-if="data" class="interview-feedback__muted">暂无本人反馈</p>
    <h4 v-if="otherFeedback.length">面试反馈</h4>
    <div v-for="item in otherFeedback" :key="item.userId" class="interview-feedback__record">
      <header><strong>{{ item.userName || '面试参与人' }}</strong><span>{{ item.status === 'submitted' ? '已提交' : '草稿' }} · {{ item.outcome ? FEEDBACK_OUTCOME_LABELS[item.outcome] : '未填写结论' }}</span></header>
      <p>{{ item.summary || '未填写意见' }}</p>
      <el-button v-if="data?.canReturn && item.status === 'submitted' && !returningId" size="small" :disabled="busy" @click="beginReturn(item)">退回反馈</el-button>
    </div>
    <el-form v-if="returningId" label-position="top" :disabled="busy" class="interview-feedback__return">
      <el-form-item label="退回原因" required :error="returnError"><el-input v-model="returnNote" type="textarea" :rows="2" maxlength="2000" /></el-form-item>
      <div class="interview-feedback__actions"><el-button @click="returningId = ''">取消退回</el-button><el-button type="primary" :loading="busy" :disabled="!data?.canReturn || data?.items.find(item => item.userId === returningId)?.status !== 'submitted'" @click="returnFeedback(data!.items.find(item => item.userId === returningId)!)">退回修改</el-button></div>
    </el-form>
    <el-collapse v-if="histories.length" class="interview-feedback__history">
      <el-collapse-item v-for="item in histories" :key="item.userId" :name="item.userId" :title="`${item.userName || '本人'} · 历史反馈（${item.history!.length}）`">
        <ol><li v-for="(entry, index) in item.history" :key="`${entry.revision}:${entry.action}:${index}`">
          <div>{{ entry.actorName || item.userName || '参与人' }} · {{ historyLabel(entry.action) }} · {{ formatDate(entry.createdAt) }}</div>
          <span v-if="entry.outcome">{{ FEEDBACK_OUTCOME_LABELS[entry.outcome] }}</span>
          <p v-if="entry.summary">{{ entry.summary }}</p><p v-if="entry.note" class="interview-feedback__return-note">退回原因：{{ entry.note }}</p>
        </li></ol>
      </el-collapse-item>
    </el-collapse>
  </section>
</template>

<style scoped>
.interview-feedback { border-top: 1px solid var(--el-border-color-lighter); margin-top: 16px; padding-top: 12px; min-width: 0; font-size: 13px; overflow-wrap: anywhere; }
header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
h4 { margin: 0; font-size: 14px; } .interview-feedback > h4 { margin: 16px 0 8px; }
.interview-feedback__record { padding: 10px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.interview-feedback__record p { margin: 6px 0; white-space: pre-wrap; }
.interview-feedback__actions { display: flex; flex-wrap: wrap; gap: 8px; } .interview-feedback__actions .el-button { margin-left: 0; }
.interview-feedback__form, .interview-feedback__return { margin-top: 12px; }
.interview-feedback__muted { color: var(--el-text-color-secondary); }
.interview-feedback__history { margin-top: 12px; }
.interview-feedback__history ol { list-style: none; padding: 0; margin: 0; }
.interview-feedback__history li { padding: 8px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.interview-feedback__history p { white-space: pre-wrap; margin: 4px 0; }
.interview-feedback__return-note { color: var(--el-color-warning-dark-2); }
.interview-feedback__history :deep(.el-collapse-item__header) { height: auto; min-height: 40px; line-height: 1.6; padding: 8px 0; }
</style>
