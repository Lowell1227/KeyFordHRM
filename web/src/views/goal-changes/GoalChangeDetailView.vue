<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { isAxiosError } from 'axios';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { goalChangesApi, goalChangeError, type GoalChangeDetail, type GoalChangeItem } from '@/api/goal-changes.api';
import { formatDateTime } from '@/utils/date';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import GoalChangeGoals from './GoalChangeGoals.vue';
import { actionLabels, percent, statusLabels } from './goal-change-labels';
import PerformanceLifecycleActions from '@/views/task/components/PerformanceLifecycleActions.vue';
import { applyLifecycleProjection, lifecycleReadOnly } from '@/api/performance-lifecycle.api';

const route = useRoute(), router = useRouter();
const emit = defineEmits<{ changed: [] }>();
const detail = ref<GoalChangeDetail | null>(null), goals = ref<GoalChangeItem[]>([]), reason = ref('');
const loading = ref(false), busy = ref(false), readError = ref(''), writeError = ref('');
const lifecycleBusy = ref(false);
const validate = ref(false), needsReload = ref(false), baseline = ref('');
const decision = ref<'approve' | 'reject' | 'revoke' | ''>(''), comment = ref(''), commentError = ref('');
let session = 0, alive = true;
let pending: { id: string; session: number; revision: number } | null = null;
onBeforeUnmount(() => { alive = false; session++; });
const snapshot = () => JSON.stringify({ reason: reason.value, goals: goals.value });
const dirty = computed(() => Boolean(detail.value) && snapshot() !== baseline.value);
const can = (action: string) => !!detail.value && !lifecycleReadOnly(detail.value) && detail.value.allowedActions.includes(action);
const canEdit = computed(() => can('edit'));
const businessRecords = computed(() => {
  const records = detail.value?.records ?? [];
  const visible = records.some(record => record.action === 'submit')
    ? records.filter(record => !['create', 'save_draft', 'edit', 'update'].includes(record.action)) : records;
  return [...visible].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
});
const changedGoals = computed(() => {
  const before = detail.value?.beforeGoals ?? [];
  const original = new Map(before.filter(goal => goal.sourceInstanceId).map(goal => [goal.sourceInstanceId, goal]));
  const afterIds = new Set(goals.value.map(goal => goal.sourceInstanceId).filter(Boolean));
  return [
    ...before.filter(goal => goal.sourceInstanceId && !afterIds.has(goal.sourceInstanceId)).map(goal => ({ key: `remove-${goal.sourceInstanceId}`, label: `删除 · ${goal.name}` })),
    ...goals.value.filter(goal => !goal.sourceInstanceId).map((goal, index) => ({ key: `add-${index}`, label: `新增 · ${goal.name || '未命名目标'}` })),
    ...goals.value.filter(goal => goal.sourceInstanceId && original.has(goal.sourceInstanceId) && JSON.stringify(original.get(goal.sourceInstanceId)) !== JSON.stringify(goal))
      .map(goal => ({ key: `update-${goal.sourceInstanceId}`, label: `调整 · ${goal.name}` })),
  ];
});
const changeCounts = computed(() => ({ added: changedGoals.value.filter(item => item.key.startsWith('add-')).length,
  removed: changedGoals.value.filter(item => item.key.startsWith('remove-')).length,
  updated: changedGoals.value.filter(item => item.key.startsWith('update-')).length }));
const total = computed(() => goals.value.reduce((sum, goal) => sum + goal.weight, 0));
const reasonError = computed(() => validate.value && !reason.value.trim() ? '请填写变更原因' : '');
const goalErrors = computed(() => goals.value.map(goal => ({
  name: validate.value && !goal.name.trim() ? '请填写目标名称' : '',
  weight: validate.value && (!Number.isFinite(goal.weight) || goal.weight < 0 || goal.weight > 1) ? '权重须为 0 至 100%' : '',
  targetValue: validate.value && goal.targetValue !== null && !Number.isFinite(goal.targetValue) ? '请填写有效目标值' : '',
})));
const totalError = computed(() => !validate.value ? '' : !goals.value.length ? '至少保留一项目标'
  : Math.abs(total.value - 1) > 0.000001 ? `当前合计 ${percent(total.value)}%，权重合计必须为 100%` : '');
const decisionTitle = computed(() => decision.value === 'reject' ? '退回修改' : decision.value === 'revoke' ? '撤销目标变更'
  : detail.value?.status === 'indicator_confirming' ? '确认变更' : '审核通过');

function current(capture: { id: string; session: number }) {
  return alive && capture.session === session && capture.id === String(route.params.id) && detail.value?.id === capture.id;
}
function capture() {
  return detail.value ? { id: detail.value.id, session, revision: detail.value.revision } : null;
}
async function load() {
  const id = String(route.params.id), token = ++session;
  detail.value = null; goals.value = []; reason.value = ''; baseline.value = '';
  loading.value = true; busy.value = false; readError.value = ''; writeError.value = '';
  validate.value = false; needsReload.value = false; decision.value = ''; pending = null;
  try {
    const result = await goalChangesApi.detail(id);
    if (!alive || token !== session || String(route.params.id) !== id) return;
    if (result.id !== id) throw new Error('目标变更详情与当前记录不一致，请重新加载');
    detail.value = result; goals.value = result.goals.map(goal => ({ ...goal })); reason.value = result.reason || '';
    baseline.value = snapshot();
  } catch (error) {
    if (alive && token === session && String(route.params.id) === id) readError.value = goalChangeError(error, '目标变更详情读取失败');
  } finally { if (alive && token === session) loading.value = false; }
}
watch(() => route.params.id, id => {
  if (typeof id === 'string' && id) void load();
  else { session++; decision.value = ''; pending = null; }
}, { immediate: true, flush: 'sync' });

async function mayLeave() {
  if (busy.value || lifecycleBusy.value) { ElMessage.warning('正在办理，请稍候'); return false; }
  if (!dirty.value) return true;
  const token = session;
  try {
    await ElMessageBox.confirm('离开后，本次未保存的目标和原因将丢失。', '放弃未保存的修改？',
      { confirmButtonText: '放弃修改', cancelButtonText: '继续编辑', type: 'warning', closeOnClickModal: false });
    return alive && token === session;
  } catch { return false; }
}
onBeforeRouteLeave(mayLeave);
onBeforeRouteUpdate((to, from) => to.params.id !== from.params.id ? mayLeave() : true);
function close() {
  const back = router.options.history.state.back;
  if (typeof back === 'string' && back.split('?')[0] === '/goal-changes') router.back();
  else void router.replace({ name: 'GoalChanges', query: route.query });
}
async function reload() { if (await mayLeave()) await load(); }
function valid() {
  validate.value = true;
  return !reasonError.value && !totalError.value && goalErrors.value.every(error => !error.name && !error.weight && !error.targetValue);
}
async function write(kind: 'save' | 'submit' | 'approve' | 'reject' | 'revoke', captured = capture()) {
  if (!captured || !current(captured) || busy.value || lifecycleBusy.value || needsReload.value) return;
  const action = kind === 'save' ? 'edit' : kind === 'approve' || kind === 'reject' ? 'decide' : kind;
  if (!can(action)) return;
  if ((kind === 'save' || kind === 'submit') && !valid()) return;
  writeError.value = ''; busy.value = true;
  // Capture the full item values before awaiting; unexposed metadata is retained.
  const body = { expectedRevision: captured.revision, reason: reason.value, goals: goals.value.map(goal => ({ ...goal })) };
  const decisionComment = comment.value.trim();
  try {
    if (kind === 'save') await goalChangesApi.update(captured.id, body);
    else if (kind === 'submit') {
      await goalChangesApi.submit(captured.id, body);
    }
    else if (kind === 'revoke') await goalChangesApi.revoke(captured.id, captured.revision);
    else await goalChangesApi.decide(captured.id, { expectedRevision: captured.revision, approve: kind === 'approve',
      ...(decisionComment ? { comment: decisionComment } : {}) });
    if (!current(captured)) return;
    ElMessage.success(kind === 'save' ? '草稿已保存' : kind === 'submit' ? '已提交审核' : kind === 'revoke' ? '变更已撤销' : kind === 'reject' ? '已退回发起人修改' : '已通过当前环节');
    emit('changed'); await load();
  } catch (error) {
    if (!current(captured)) return;
    writeError.value = goalChangeError(error, '办理结果未确认，请重新加载详情核对后再操作；当前输入仍保留');
    needsReload.value = !(isAxiosError(error) && [400, 422].includes(error.response?.status ?? 0));
  } finally { if (current(captured)) busy.value = false; }
}
function openDecision(kind: 'approve' | 'reject' | 'revoke') {
  if (busy.value || needsReload.value) return;
  pending = capture(); decision.value = kind; comment.value = ''; commentError.value = ''; writeError.value = '';
}
async function decide() {
  commentError.value = '';
  if (decision.value === 'reject' && !comment.value.trim()) { commentError.value = '请填写退回原因'; return; }
  if (decision.value && pending) await write(decision.value, pending);
}
function recordComment(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'comment' in value && typeof value.comment === 'string') return value.comment;
  return '';
}
function recordNode(record: GoalChangeDetail['records'][number]) {
  if (record.action === 'submit') return '目标变更提交';
  const value = record.newValue;
  const previous = value && typeof value === 'object' && 'previousStatus' in value ? value.previousStatus : null;
  return typeof previous === 'string' && previous in statusLabels
    ? statusLabels[previous as keyof typeof statusLabels] : '目标变更';
}
function recordAction(record: GoalChangeDetail['records'][number]) {
  const value = record.newValue;
  const previous = value && typeof value === 'object' && 'previousStatus' in value ? value.previousStatus : null;
  if (record.action === 'approve' && previous === 'indicator_confirming') return '员工确认';
  return actionLabels[record.action] || '流程办理';
}
</script>

<template>
  <BusinessDetailDrawer :model-value="true" title="目标变更详情" variant="workflow" :loading="loading" :saving="busy"
    :before-close="() => close()" @update:model-value="value => { if (!value) close(); }">
    <div v-if="readError" class="request-error" role="alert">{{ readError }} <el-button link type="primary" @click="reload">重新加载详情</el-button></div>
    <div v-if="detail" data-testid="goal-change-detail" class="goal-change-detail">
      <PerformanceLifecycleActions kind="goal_change" :record="detail" :disabled="busy || dirty || needsReload || !!decision"
        :disabled-reason="dirty ? '有未保存的修改，请先保存或重新加载' : ''"
        @busy="lifecycleBusy = $event" @state="value => { if (detail) applyLifecycleProjection(detail, value); }"
        @changed="() => { emit('changed'); load(); }" />
      <section class="change-summary"><strong>{{ detail.employeeName }} · {{ detail.cycleName }}</strong>
        <el-tag>{{ statusLabels[detail.status] }}</el-tag><span>发起人：{{ detail.creatorName }}</span>
      </section>
      <el-alert v-if="detail.workflowIssue" data-testid="goal-change-workflow-issue" type="warning" :closable="false" :title="detail.workflowIssue" />
      <el-alert v-if="detail.protectedPeriodKeys.length" type="info" :closable="false" :title="`已提交月份保持原目标：${detail.protectedPeriodKeys.join('、')}`" />
      <el-form label-position="top" class="reason-form" @submit.prevent>
        <el-form-item v-if="canEdit" label="变更原因" required :error="reasonError"><el-input v-model="reason" aria-label="变更原因" type="textarea" :rows="2" maxlength="4000" :disabled="busy" /></el-form-item>
        <div v-else class="read-reason"><strong>变更原因</strong><p>{{ detail.reason || '未填写' }}</p></div>
      </el-form>
      <section class="change-digest" aria-label="变更摘要">
        <strong>本次变更：新增 {{ changeCounts.added }} 项 · 删除 {{ changeCounts.removed }} 项 · 调整 {{ changeCounts.updated }} 项</strong>
        <ul v-if="changedGoals.length"><li v-for="item in changedGoals" :key="item.key">{{ item.label }}</li></ul>
      </section>
      <fieldset :disabled="busy" class="goals-fieldset">
        <GoalChangeGoals v-if="canEdit" v-model="goals" :before-goals="detail.beforeGoals" :editable="canEdit" :errors="goalErrors" />
        <details v-else class="full-goal-diff"><summary>查看完整目标对比</summary>
          <GoalChangeGoals v-model="goals" :before-goals="detail.beforeGoals" :editable="false" :errors="goalErrors" />
        </details>
      </fieldset>
      <div class="weight-total">变更后权重合计：{{ percent(total) }}%</div>
      <div v-if="totalError" class="field-error" role="alert">{{ totalError }}</div>
      <section class="records"><h3>办理记录</h3>
        <el-timeline v-if="businessRecords.length"><el-timeline-item v-for="record in businessRecords" :key="record.id" :timestamp="formatDateTime(record.createdAt)">
          <strong>{{ recordNode(record) }} · {{ record.actorName }} · {{ recordAction(record) }}</strong><p v-if="recordComment(record.newValue)">{{ recordComment(record.newValue) }}</p>
        </el-timeline-item></el-timeline><p v-else>暂无办理记录</p>
      </section>
    </div>
    <template #footer>
      <div v-if="writeError" class="request-error footer-error" role="alert" data-testid="goal-change-write-error">{{ writeError }}
        <el-button v-if="needsReload" link type="primary" @click="reload">重新加载详情</el-button>
      </div>
      <el-button v-if="can('revoke')" type="danger" :disabled="busy || needsReload" @click="openDecision('revoke')">撤销变更</el-button>
      <el-button v-if="canEdit" :loading="busy" :disabled="needsReload" @click="write('save')">保存草稿</el-button>
      <el-button v-if="can('submit')" type="primary" :disabled="busy || needsReload" @click="write('submit')">提交审核</el-button>
      <el-button v-if="can('decide')" :disabled="busy || needsReload" @click="openDecision('reject')">退回修改</el-button>
      <el-button v-if="can('decide')" type="primary" :disabled="busy || needsReload" @click="openDecision('approve')">{{ detail?.status === 'indicator_confirming' ? '确认变更' : '审核通过' }}</el-button>
    </template>
  </BusinessDetailDrawer>
  <el-dialog :model-value="Boolean(decision)" :title="decisionTitle" width="min(480px, 96vw)" :close-on-click-modal="false"
    :close-on-press-escape="!busy" :show-close="!busy" @update:model-value="value => { if (!value && !busy) decision = ''; }">
    <p v-if="decision === 'revoke'">撤销后原目标继续生效，本申请不再进入后续审核。</p>
    <el-form v-else label-position="top"><el-form-item label="审核意见" :required="decision === 'reject'" :error="commentError">
      <el-input v-model="comment" aria-label="审核意见" type="textarea" :rows="3" maxlength="4000" :disabled="busy" @input="commentError = ''" />
    </el-form-item></el-form>
    <div v-if="writeError" class="request-error" role="alert">{{ writeError }}</div>
    <template #footer><el-button :disabled="busy" @click="decision = ''">取消</el-button>
      <el-button type="primary" :loading="busy" :disabled="needsReload" @click="decide">{{ decision === 'reject' ? '退回发起人' : decisionTitle }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.goal-change-detail { min-width: 0; }
.change-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; overflow-wrap: anywhere; }
.change-summary span:last-child { color: var(--el-text-color-secondary); font-size: 13px; }
.reason-form { margin-top: 16px; }
.goals-fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
.read-reason p, .records p { white-space: pre-wrap; overflow-wrap: anywhere; }
.weight-total { text-align: right; font-size: 13px; }
.field-error, .request-error { color: var(--el-color-danger); font-size: 13px; line-height: 22px; overflow-wrap: anywhere; }
.footer-error { flex-basis: 100%; text-align: left; }
.records { border-top: 1px solid var(--el-border-color); margin-top: 20px; padding-top: 12px; }
.change-digest { padding: 12px; margin: 12px 0; border: 1px solid var(--el-border-color); border-radius: 6px; }
.change-digest ul { margin: 8px 0 0; padding-left: 20px; }
.change-digest li { margin-top: 4px; overflow-wrap: anywhere; }
.full-goal-diff summary { cursor: pointer; padding: 8px 0; color: var(--el-color-primary); }
h3 { font-size: 15px; margin: 0 0 16px; }
</style>
