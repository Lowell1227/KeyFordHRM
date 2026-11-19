<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { recruitmentError, talentRecruitmentApi } from '@/api/talent-recruitment.api';
import { APPLICATION_ACTION_LABELS, APPLICATION_STAGE_LABELS, type TalentApplicationView } from '@/types/talent.types';
import { formatDate } from '@/utils/date';

const rows = ref<TalentApplicationView[]>([]), current = ref<TalentApplicationView | null>(null);
const loading = ref(false), detailLoading = ref(false), busy = ref(false);
const queueError = ref(''), detailError = ref(''), conflict = ref(false), detailFailed = ref(false);
const selectedId = ref(''), command = ref<'approve_hiring' | 'return_hiring' | null>(null), note = ref(''), noteError = ref('');
const resultMessage = ref('');
let queueSession = 0, detailSession = 0;
const hasEditor = computed(() => command.value !== null);
const actions = computed(() => (['approve_hiring', 'return_hiring'] as const).filter(action => current.value?.allowedActions.includes(action)));
function active(token: number, id: string) { return token === detailSession && selectedId.value === id; }
async function loadQueue() {
  if (busy.value || hasEditor.value) return;
  const token = ++queueSession;
  loading.value = true; queueError.value = '';
  try {
    const result = await talentRecruitmentApi.hiringReviews();
    if (token !== queueSession) return;
    rows.value = result;
    const selected = result.find(row => row.id === selectedId.value) ?? result[0];
    if (selected) await select(selected.id); else { ++detailSession; current.value = null; selectedId.value = ''; }
  } catch (cause) { if (token === queueSession) queueError.value = recruitmentError(cause); }
  finally { if (token === queueSession) loading.value = false; }
}
async function select(id: string, preserve = false) {
  if (busy.value || (hasEditor.value && !preserve)) return;
  const token = ++detailSession;
  selectedId.value = id; detailLoading.value = true; detailError.value = ''; detailFailed.value = false;
  if (!preserve) { current.value = null; command.value = null; note.value = ''; conflict.value = false; resultMessage.value = ''; }
  try {
    const result = await talentRecruitmentApi.detail(id);
    if (!active(token, id)) return;
    current.value = result; conflict.value = false;
    if (command.value && !result.allowedActions.includes(command.value)) detailError.value = '该申请已不支持此动作，意见已保留，请取消后核对。';
  } catch (cause) { if (active(token, id)) { detailError.value = recruitmentError(cause); detailFailed.value = true; } }
  finally { if (active(token, id)) detailLoading.value = false; }
}
function begin(action: 'approve_hiring' | 'return_hiring') {
  command.value = action; note.value = ''; noteError.value = ''; detailError.value = ''; conflict.value = false;
}
async function execute() {
  const target = current.value, action = command.value;
  if (!target || !action || busy.value || !target.allowedActions.includes(action)) return;
  noteError.value = action === 'return_hiring' && !note.value.trim() ? '请填写退回原因' : '';
  if (noteError.value) return;
  const token = detailSession;
  busy.value = true; detailError.value = '';
  try {
    const result = await talentRecruitmentApi.action(target.id, { expectedRevision: target.revision, action, note: note.value.trim() || undefined });
    if (!active(token, target.id)) return;
    current.value = result; rows.value = rows.value.filter(row => row.id !== target.id);
    resultMessage.value = action === 'approve_hiring' ? '已确认录用，等待经办记录候选人答复。' : '已退回经办，等待补充后重新提交。';
    command.value = null; note.value = ''; conflict.value = false;
  } catch (cause) {
    if (active(token, target.id)) {
      detailError.value = recruitmentError(cause);
      conflict.value = (cause as { response?: { status: number } }).response?.status === 409;
    }
  } finally { if (active(token, target.id)) busy.value = false; }
}
function eventLabel(action: string) { return APPLICATION_ACTION_LABELS[action as keyof typeof APPLICATION_ACTION_LABELS] ?? ({ create: '新增应聘', update: '修改应聘', submit_feedback: '提交反馈', return_feedback: '退回反馈', start_onboarding: '办理入职', cancel_onboarding: '取消入职', activate_onboarding: '入职生效' } as Record<string, string>)[action] ?? '流程更新'; }
void loadQueue();
onBeforeUnmount(() => { ++queueSession; ++detailSession; });
</script>

<template>
  <section class="hiring-review">
    <header class="hiring-review__toolbar"><span>待确认 {{ rows.length }}</span><el-tooltip content="刷新录用确认"><el-button :icon="Refresh" aria-label="刷新录用确认" :loading="loading" :disabled="busy || hasEditor" @click="loadQueue" /></el-tooltip></header>
    <el-alert v-if="queueError" :title="queueError" type="error" :closable="false"><el-button link type="primary" @click="loadQueue">重试队列</el-button></el-alert>
    <div v-loading="loading" class="hiring-review__layout">
      <aside aria-label="待录用确认申请" class="hiring-review__queue">
        <el-empty v-if="!rows.length && !queueError && !loading" description="暂无待确认申请" :image-size="50" />
        <button v-for="row in rows" :key="row.id" type="button" class="hiring-review__item" :class="{ 'is-selected': selectedId === row.id }" :aria-pressed="selectedId === row.id" :disabled="busy || hasEditor" @click="select(row.id)">
          <strong>{{ row.candidateName || '候选人' }}</strong><span>{{ row.positionName }}</span><small>{{ [row.recruitmentBatch, row.ownerName].filter(Boolean).join(' · ') }}</small>
        </button>
      </aside>
      <article v-loading="detailLoading" class="hiring-review__detail">
        <el-alert v-if="detailError" :title="detailError" type="error" :closable="false">
          <el-button v-if="conflict" link type="primary" @click="select(selectedId, true)">刷新记录，保留意见</el-button>
          <el-button v-else-if="detailFailed" link type="primary" @click="select(selectedId, hasEditor)">重试详情</el-button>
        </el-alert>
        <template v-if="current">
          <el-alert v-if="resultMessage" :title="resultMessage" type="success" :closable="false" />
          <header class="hiring-review__heading"><h3>{{ current.candidateName || '录用申请' }}</h3><el-tag size="small">{{ APPLICATION_STAGE_LABELS[current.stage] }}</el-tag></header>
          <dl><dt>岗位</dt><dd>{{ current.positionName }}</dd><dt>批次</dt><dd>{{ current.recruitmentBatch || '未填写' }}</dd><dt>部门</dt><dd>{{ current.departmentNameSnapshot || '未指定' }}</dd><dt>经办</dt><dd>{{ current.ownerName || '未指定' }}</dd><dt>提交时间</dt><dd>{{ current.hiringRequestedAt ? formatDate(current.hiringRequestedAt) : '未记录' }}</dd><dt>预计到岗</dt><dd>{{ current.expectedEntryDate ? formatDate(current.expectedEntryDate) : '未填写' }}</dd></dl>
          <h4>录用意见</h4><p class="hiring-review__note">{{ current.hiringReason || '未填写' }}</p>
          <div v-if="!command" class="hiring-review__actions"><el-button v-for="action in actions" :key="action" :type="action === 'approve_hiring' ? 'primary' : 'default'" :disabled="busy" @click="begin(action)">{{ APPLICATION_ACTION_LABELS[action] }}</el-button><el-button v-if="!actions.length && rows.length" @click="select(rows[0]!.id)">下一条申请</el-button></div>
          <el-form v-if="command" label-position="top" :disabled="busy" class="hiring-review__form">
            <el-form-item :label="command === 'return_hiring' ? '退回原因' : '确认意见（选填）'" :required="command === 'return_hiring'" :error="noteError"><el-input v-model="note" type="textarea" :rows="4" maxlength="4000" show-word-limit /></el-form-item>
            <div class="hiring-review__actions"><el-button @click="command = null; detailError = ''; conflict = false">取消操作</el-button><el-button type="primary" :loading="busy" :disabled="!current.allowedActions.includes(command)" @click="execute">{{ command === 'approve_hiring' ? '提交录用确认' : '提交退回' }}</el-button></div>
          </el-form>
          <h4>应聘时间线</h4><el-timeline v-if="current.events?.length"><el-timeline-item v-for="event in current.events" :key="event.id" :timestamp="formatDate(event.createdAt)"><div>{{ event.actorName || '系统' }} · {{ eventLabel(event.action) }}</div><p v-if="event.note" class="hiring-review__note">{{ event.note }}</p></el-timeline-item></el-timeline><p v-else class="hiring-review__muted">暂无流程记录</p>
        </template>
        <el-empty v-else-if="!detailLoading && !detailError && rows.length" description="选择待确认申请" :image-size="50" />
      </article>
    </div>
  </section>
</template>

<style scoped>
.hiring-review { min-width: 0; padding: 16px; }
.hiring-review__toolbar, .hiring-review__heading, .hiring-review__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.hiring-review__toolbar { justify-content: space-between; margin-bottom: 12px; font-size: 13px; }
.hiring-review__layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 20px; }
.hiring-review__queue { border-right: 1px solid var(--el-border-color-lighter); padding-right: 16px; min-width: 0; }
.hiring-review__item { width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--el-border-color-lighter); border-left: 3px solid transparent; background: transparent; color: var(--el-text-color-primary); padding: 12px 10px; cursor: pointer; font: inherit; overflow-wrap: anywhere; }
.hiring-review__item.is-selected { border-left-color: var(--el-color-primary); background: var(--el-fill-color-light); }
.hiring-review__item:disabled { cursor: default; } .hiring-review__item strong, .hiring-review__item span, .hiring-review__item small { display: block; margin-bottom: 4px; }
.hiring-review__item span { font-size: 13px; } .hiring-review__item small, .hiring-review__muted { color: var(--el-text-color-secondary); }
.hiring-review__detail { min-width: 0; max-width: 840px; overflow-wrap: anywhere; }
h3 { margin: 0; font-size: 18px; } h4 { margin: 18px 0 10px; font-size: 14px; }
dl { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 10px; font-size: 13px; } dt { color: var(--el-text-color-secondary); } dd { margin: 0; }
.hiring-review__note { white-space: pre-wrap; font-size: 13px; line-height: 1.7; margin: 6px 0 14px; }
.hiring-review__actions { margin: 12px 0; } .hiring-review__actions .el-button { margin-left: 0; }
.hiring-review__form { border-block: 1px solid var(--el-border-color-lighter); padding: 12px 0; }
.hiring-review :deep(.el-timeline) { padding-left: 12px; }
@media (max-width: 768px) { .hiring-review { padding: 10px; } .hiring-review__layout { grid-template-columns: 1fr; gap: 14px; } .hiring-review__queue { border-right: 0; border-bottom: 1px solid var(--el-border-color-lighter); padding-right: 0; max-height: 220px; overflow: auto; } }
</style>
