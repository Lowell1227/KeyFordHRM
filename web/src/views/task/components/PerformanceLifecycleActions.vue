<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { isAxiosError } from 'axios';
import { ElMessage } from 'element-plus';
import { performanceLifecycleApi, lifecycleLabel, type LifecycleKind, type PerformanceLifecycle } from '@/api/performance-lifecycle.api';
import { formatDateTime } from '@/utils/date';

const props = defineProps<{ kind: LifecycleKind; record: { id: string } & Partial<PerformanceLifecycle>; disabled?: boolean; disabledReason?: string }>();
const emit = defineEmits<{ changed: []; state: [value: PerformanceLifecycle]; busy: [value: boolean] }>();
const action = ref<'terminate' | 'delete' | ''>(''), reason = ref(''), fieldError = ref(''), error = ref('');
const evidence = ref<PerformanceLifecycle | null>(null), loading = ref(false), saving = ref(false), needsReload = ref(false);
const history = ref<PerformanceLifecycle | null>(null), historyLoading = ref(false), historyError = ref('');
let session = 0, alive = true;
let historySession = 0;
const title = computed(() => action.value === 'delete' ? '删除记录' : '终止流程');
const can = (value: 'terminate' | 'delete') => props.record.allowedActions?.includes(`lifecycle_${value}`) ?? false;
const canSubmit = computed(() => !!action.value && !needsReload.value && !loading.value && !props.disabled
  && evidence.value?.allowedActions.includes(`lifecycle_${action.value}`));
function message(cause: unknown) {
  if (isAxiosError(cause)) {
    if (cause.response?.status === 403) return '无权执行此操作，请重新核对权限';
    const value: unknown = cause.response?.data?.message;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.join('；');
  }
  return '操作结果未确认，请重新核对记录；操作原因已保留';
}
function close() {
  if (saving.value || loading.value) return;
  session++; action.value = ''; emit('busy', false);
}
watch(() => [props.record.id, props.kind], () => { session++; action.value = ''; saving.value = false; loading.value = false; emit('busy', false); });
watch(() => [props.record.updatedAt, props.record.lifecycleVersion], () => {
  if (action.value && evidence.value && (props.record.updatedAt !== evidence.value.updatedAt
    || props.record.lifecycleVersion !== evidence.value.lifecycleVersion)) {
    needsReload.value = true; error.value = '记录已变化，请重新核对；操作原因已保留';
  }
});
onBeforeUnmount(() => { alive = false; session++; historySession++; emit('busy', false); });
async function loadHistory() {
  const token = ++historySession, id = props.record.id, kind = props.kind;
  history.value = null; historyError.value = '';
  if (!lifecycleLabel(props.record)) { historyLoading.value = false; return; }
  historyLoading.value = true;
  try {
    const value = await performanceLifecycleApi.detail(kind, id);
    if (alive && token === historySession) history.value = value;
  } catch (cause) { if (alive && token === historySession) historyError.value = message(cause); }
  finally { if (alive && token === historySession) historyLoading.value = false; }
}
watch(() => [props.record.id, props.kind, props.record.lifecycleStatus], loadHistory, { immediate: true });
async function refresh() {
  const token = ++session, id = props.record.id, kind = props.kind;
  loading.value = true; error.value = ''; evidence.value = null; needsReload.value = true;
  try {
    const value = await performanceLifecycleApi.detail(kind, id);
    if (!alive || session !== token || id !== props.record.id || kind !== props.kind) return;
    evidence.value = value;
    emit('state', value);
    if (!value.allowedActions.includes(`lifecycle_${action.value}`)) error.value = '记录状态或权限已变化，当前操作不可执行';
    else needsReload.value = false;
  } catch (cause) { if (alive && session === token) error.value = message(cause); }
  finally { if (alive && session === token) loading.value = false; }
}
async function open(value: 'terminate' | 'delete') {
  if (props.disabled || !can(value) || saving.value) return;
  action.value = value; reason.value = ''; fieldError.value = ''; error.value = ''; emit('busy', true);
  await refresh();
}
async function submit() {
  fieldError.value = !reason.value.trim() ? '请填写操作原因' : reason.value.trim().length > 1000 ? '操作原因不能超过 1000 字' : '';
  if (fieldError.value || !canSubmit.value || !evidence.value || !action.value || saving.value) return;
  const token = session, id = props.record.id, kind = props.kind, operation = action.value;
  saving.value = true; error.value = '';
  try {
    const value = await performanceLifecycleApi.mutate(kind, id, operation, {
      expectedUpdatedAt: evidence.value.updatedAt, expectedLifecycleVersion: evidence.value.lifecycleVersion, reason: reason.value.trim(),
    });
    if (!alive || session !== token || id !== props.record.id || kind !== props.kind) return;
    emit('state', value); action.value = ''; emit('busy', false);
    ElMessage.success(operation === 'delete' ? '记录已删除，原业务事实和历史保留' : '流程已终止，既有业务事实保留');
    emit('changed');
  } catch (cause) {
    if (!alive || session !== token) return;
    error.value = message(cause);
    needsReload.value = true;
  } finally { if (alive && session === token) saving.value = false; }
}
</script>

<template>
  <section class="lifecycle-actions" aria-label="记录管理">
    <el-alert v-if="lifecycleLabel(record)" :title="`${lifecycleLabel(record)} · 仅供查阅，既有业务事实保留`" type="info" :closable="false">
      <p v-if="record.terminatedAt || record.terminationReason">终止：{{ formatDateTime(record.terminatedAt) }} · {{ record.terminationReason }}</p>
      <p v-if="record.deletedAt || record.deletionReason">删除：{{ formatDateTime(record.deletedAt) }} · {{ record.deletionReason }}</p>
    </el-alert>
    <details v-if="lifecycleLabel(record)" class="lifecycle-history">
      <summary>办理记录</summary>
      <p v-if="historyLoading" role="status">正在读取办理记录</p>
      <div v-if="historyError" role="alert">{{ historyError }} <el-button link @click="loadHistory">重试</el-button></div>
      <ol v-if="history?.events?.length">
        <li v-for="event in history.events" :key="event.id"><strong>{{ event.action === 'lifecycle_terminated' ? '终止流程' : '删除记录' }}</strong>
          · {{ event.actorName || '系统' }} · {{ formatDateTime(event.createdAt) }}<p>{{ event.reason }}</p></li>
      </ol>
    </details>
    <div v-if="can('terminate') || can('delete')" class="lifecycle-buttons">
      <span v-if="disabled && disabledReason" class="disabled-reason">{{ disabledReason }}</span>
      <el-button v-if="can('terminate')" type="danger" plain :disabled="disabled || saving || loading" @click="open('terminate')">终止流程</el-button>
      <el-button v-if="can('delete')" type="danger" plain :disabled="disabled || saving || loading" @click="open('delete')">删除记录</el-button>
    </div>
    <el-dialog :model-value="!!action" :title="title" width="min(480px, 94vw)" append-to-body
      :close-on-click-modal="false" :close-on-press-escape="!saving && !loading" :show-close="!saving && !loading"
      @update:model-value="value => { if (!value) close(); }">
      <p v-if="action === 'terminate'">终止后不再办理本流程，不代表审批通过、豁免或零分；不撤销已生效的目标、任职或结果。</p>
      <p v-else>仅从常规列表移除，历史、审计和已生效结果保留，不撤销任何已生效业务。</p>
      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="操作原因" required :error="fieldError">
          <el-input v-model="reason" aria-label="操作原因" type="textarea" :rows="3" maxlength="1000" show-word-limit :disabled="saving" @input="fieldError = ''" />
        </el-form-item>
      </el-form>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <template #footer>
        <el-button :disabled="saving || loading" @click="close">取消</el-button>
        <el-button v-if="needsReload && !loading" :disabled="saving" @click="refresh">重新核对记录</el-button>
        <el-button type="danger" :loading="saving || loading" :disabled="!canSubmit" @click="submit">{{ title }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.lifecycle-actions { min-width: 0; overflow-wrap: anywhere; }
.lifecycle-buttons { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin: 10px 0; }
.lifecycle-buttons :deep(.el-button) { margin-left: 0; }
.disabled-reason { align-self: center; color: var(--el-text-color-secondary); font-size: 13px; }
.lifecycle-actions p { white-space: pre-wrap; overflow-wrap: anywhere; }
.lifecycle-history { margin: 10px 0; font-size: 13px; }
.lifecycle-history summary { cursor: pointer; }
.lifecycle-history ol { padding-left: 20px; }
</style>
