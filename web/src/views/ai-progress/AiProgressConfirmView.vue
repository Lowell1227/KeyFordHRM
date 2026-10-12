<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { aiProgressApi } from '@/api/ai-progress.api';
import type { AiProgressDraft, AiProgressGoal, GoalTrackingHealthStatus } from '@/types/api.types';

const route = useRoute();
const draft = ref<AiProgressDraft | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const blocked = ref(false);
const saved = ref(false);
const dirty = ref(false);
const reconcileRequired = ref(false);
const loadedDraftId = ref('');
let requestGeneration = 0;
const currentRequest = (id: string, generation: number) =>
  String(route.params.draftId) === id && generation === requestGeneration;
const form = reactive({ selection: '', content: '', actualValue: '', healthStatus: '' as GoalTrackingHealthStatus | '' });
const goalKey = (goal: AiProgressGoal) => JSON.stringify([goal.id, goal.periodId]);
const goal = computed(() => draft.value?.goals.find(item => goalKey(item) === form.selection));
const contentError = computed(() => !form.content.trim() ? '请输入进展说明' : form.content.length > 10000 ? '进展说明最多10000字' : '');
const actualError = computed(() => form.actualValue && !/^\d{1,8}(\.\d{1,2})?$/.test(form.actualValue)
  ? '实际值须为非负数，最多8位整数和2位小数' : '');
const canSave = computed(() => loadedDraftId.value === String(route.params.draftId) && !!goal.value
  && !contentError.value && !actualError.value && !loading.value && !saving.value && !blocked.value && !saved.value);
const previewTarget = computed(() => saved.value && draft.value?.saved ? draft.value.saved.targetValueSnapshot : goal.value?.targetValue);
const previewUnit = computed(() => saved.value && draft.value?.saved ? draft.value.saved.unitSnapshot : goal.value?.unit);
const completion = computed(() => {
  if (saved.value && draft.value?.saved) return draft.value.saved.completionPercent ?? null;
  if (!goal.value?.targetValue || Number(goal.value.targetValue) <= 0 || !form.actualValue || actualError.value) return null;
  // Both values have two decimal places; integer cents avoid binary rounding at half-percent hundredths.
  const actualCents = Math.round(Number(form.actualValue) * 100);
  const targetCents = Math.round(Number(goal.value.targetValue) * 100);
  return Math.round(actualCents * 10000 / targetCents) / 100;
});
const statuses: Array<{ value: GoalTrackingHealthStatus; label: string }> = [
  { value: 'on_track', label: '正常' }, { value: 'at_risk', label: '有风险' },
  { value: 'blocked', label: '受阻' }, { value: 'completed', label: '已完成' },
];

function reportError(reason: unknown, reading = false) {
  const status = (reason as { response?: { status?: number } })?.response?.status;
  blocked.value = status === 403 || status === 410 || status === 404;
  error.value = status === 403 ? '只能查看和保存本人的进展草稿，请核对当前登录账号。'
    : status === 410 || status === 404 ? '草稿已过期或不存在，请在钉钉重新发送进展。'
    : reading ? '草稿暂时无法读取，请重试。'
    : status === 409 ? '目标或考核月份可能已不可更新，输入已保留，请重试核对或前往 HRM 手动更新。'
    : status === 400 ? '进展内容未通过校验，输入已保留，请核对目标、月份、说明和实际值后重试。'
    : '进展暂时无法保存，输入已保留，请重试或前往 HRM 手动更新。';
}

function applyDraft(result: AiProgressDraft) {
  draft.value = result; loadedDraftId.value = result.draftId; saved.value = result.state === 'saved';
  // An uncertain model match must be explicitly chosen, including a single preselected indicator.
  const selected = result.goals.find(item => item.id === result.indicatorId && item.periodId === result.periodId);
  form.selection = !result.uncertain && selected ? goalKey(selected) : '';
  const persisted = saved.value ? result.saved : null;
  form.content = persisted?.content ?? result.content;
  form.actualValue = persisted ? String(persisted.actualValue ?? '') : result.actualValue ?? '';
  form.healthStatus = persisted ? persisted.healthStatus ?? '' : result.healthStatus ?? '';
  dirty.value = false; reconcileRequired.value = false;
}

async function load() {
  const id = String(route.params.draftId);
  const generation = ++requestGeneration;
  loading.value = true; error.value = ''; blocked.value = false; draft.value = null; loadedDraftId.value = '';
  saved.value = false; dirty.value = false; saving.value = false; reconcileRequired.value = false;
  try {
    const result = await aiProgressApi.getDraft(id);
    if (!currentRequest(id, generation)) return;
    if (result.draftId !== id) throw new Error('Draft response does not match the requested draft');
    applyDraft(result);
  } catch (reason) { if (currentRequest(id, generation)) reportError(reason, true); }
  finally { if (currentRequest(id, generation)) loading.value = false; }
}

async function save() {
  if (!canSave.value || !goal.value) return;
  const id = loadedDraftId.value;
  const generation = requestGeneration;
  saving.value = true; error.value = '';
  try {
    if (reconcileRequired.value) {
      const latest = await aiProgressApi.getDraft(id);
      if (!currentRequest(id, generation)) return;
      if (latest.draftId !== id) throw new Error('Draft response does not match the requested draft');
      if (latest.state === 'saved') { applyDraft(latest); return; }
    }
    reconcileRequired.value = true;
    const corrected = await aiProgressApi.updateDraft(id, { indicatorId: goal.value.id, periodId: goal.value.periodId,
      content: form.content, actualValue: form.actualValue || null, healthStatus: form.healthStatus || null });
    if (!currentRequest(id, generation)) return;
    if (corrected.draftId !== id) throw new Error('Draft response does not match the requested draft');
    if (!corrected.canSave) {
      error.value = '请重新选择目标与考核月份后保存。';
      form.selection = '';
      return;
    }
    const persisted = await aiProgressApi.saveDraft(id);
    if (!currentRequest(id, generation)) return;
    const latest = await aiProgressApi.getDraft(id);
    if (!currentRequest(id, generation)) return;
    if (latest.draftId !== id) throw new Error('Draft response does not match the requested draft');
    applyDraft({ ...latest, state: 'saved', saved: persisted });
  } catch (reason) { if (currentRequest(id, generation)) reportError(reason); }
  finally { if (currentRequest(id, generation)) saving.value = false; }
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value && !saved.value) event.preventDefault();
}
window.addEventListener('beforeunload', beforeUnload);
onBeforeUnmount(() => { requestGeneration++; window.removeEventListener('beforeunload', beforeUnload); });
async function confirmLeave() {
  if (saving.value) return false;
  if (!dirty.value || saved.value) return true;
  try {
    await ElMessageBox.confirm('更正内容尚未保存，离开后将丢失本页修改。', '离开确认页', {
      confirmButtonText: '离开页面', cancelButtonText: '继续修改', type: 'warning',
    });
    return true;
  } catch { return false; }
}
onBeforeRouteLeave(confirmLeave);
onBeforeRouteUpdate(confirmLeave);
watch(() => route.params.draftId, load, { immediate: true });
</script>

<template>
  <section class="confirm-page" aria-label="确认目标进展" v-loading="loading">
    <p class="intro">请核对识别内容。点击“保存进展”后才会写入目标跟进。</p>
    <div v-if="error" class="feedback" role="alert">
      <p>{{ error }}</p>
      <el-button v-if="!draft && !blocked" @click="load">重新读取</el-button>
      <RouterLink to="/action-items">前往 HRM 目标跟进手动更新</RouterLink>
    </div>
    <template v-if="draft">
      <div v-if="saved" class="success" role="status">进展已保存</div>
      <el-form label-position="top" :disabled="saving || saved || blocked" @input="dirty = true" @change="dirty = true">
        <el-form-item label="目标与考核月份" :error="!form.selection && !saved ? '请选择本次更新的目标与考核月份' : ''">
          <el-select v-model="form.selection" aria-label="目标与考核月份" placeholder="请选择目标与考核月份" :fit-input-width="true" popper-class="ai-progress-goals" @change="dirty = true">
            <el-option v-for="item in draft.goals" :key="goalKey(item)" :value="goalKey(item)"
              :label="`${item.title} · ${item.periodKey || '周期目标'}`" />
          </el-select>
        </el-form-item>
        <p v-if="goal" class="goal-detail">{{ goal.title }} · {{ goal.periodKey || '周期目标' }}</p>
        <el-form-item label="进展说明" :error="contentError">
          <el-input v-model="form.content" aria-label="进展说明" type="textarea" :rows="4" maxlength="10000" />
        </el-form-item>
        <div class="fields">
          <el-form-item label="实际值" :error="actualError">
            <el-input v-model="form.actualValue" aria-label="实际值" inputmode="decimal" placeholder="未提供，可留空" maxlength="11">
              <template v-if="previewUnit" #append>{{ previewUnit }}</template>
            </el-input>
          </el-form-item>
          <el-form-item label="进展状态">
            <el-select v-model="form.healthStatus" aria-label="进展状态" clearable placeholder="未提供，可留空" @change="dirty = true">
              <el-option v-for="status in statuses" :key="status.value" :label="status.label" :value="status.value" />
            </el-select>
          </el-form-item>
        </div>
      </el-form>
      <div class="preview" aria-label="完成情况预览" aria-live="polite">
        <template v-if="goal">
          <span v-if="previewTarget != null">目标值：{{ previewTarget }} {{ previewUnit }}</span>
          <strong v-if="completion !== null">{{ completion }}%</strong>
          <span v-else>{{ previewTarget == null ? '定性目标，无完成率' : '未提供有效实际值或目标值，暂无完成率' }}</span>
        </template>
        <span v-else>选择目标与考核月份后显示完成情况</span>
      </div>
      <footer class="actions">
        <el-button type="primary" :loading="saving" :disabled="!canSave" @click="save">保存进展</el-button>
        <RouterLink to="/action-items">前往 HRM 目标跟进</RouterLink>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.confirm-page { max-width: 760px; margin: 0 auto; color: var(--el-text-color-primary); }
.intro { margin: 0 0 18px; color: var(--el-text-color-secondary); line-height: 1.6; }
.feedback, .success { padding: 12px; margin-bottom: 16px; border-radius: 6px; background: var(--el-color-warning-light-9); overflow-wrap: anywhere; }
.feedback p { margin: 0 0 8px; }
.feedback a { display: inline-block; margin: 8px; }
.success { background: var(--el-color-success-light-9); color: var(--el-color-success-dark-2); }
.el-select { width: 100%; min-width: 0; }
.fields { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.fields > * { min-width: 0; }
.goal-detail { margin: -6px 0 16px; font-size: 13px; overflow-wrap: anywhere; color: var(--el-text-color-secondary); }
.preview { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 14px 0; border-top: 1px solid var(--el-border-color-light); }
.preview strong { font-size: 22px; }
.actions { position: sticky; bottom: -18px; display: flex; align-items: center; gap: 18px; background: var(--app-bg, #fff); padding: 16px 0; border-top: 1px solid var(--el-border-color-light); }
a { color: var(--el-color-primary); font-size: 14px; }
@media (max-width: 768px) {
  .fields { grid-template-columns: 1fr; gap: 0; }
  .actions { bottom: -10px; flex-direction: column; gap: 12px; padding-bottom: max(12px, env(safe-area-inset-bottom)); }
  .actions .el-button { width: 100%; min-height: 42px; }
}
</style>

<style>
.ai-progress-goals { max-width: calc(100vw - 32px); }
.ai-progress-goals .el-select-dropdown__item { height: auto; min-height: 34px; white-space: normal; overflow-wrap: anywhere; line-height: 1.5; padding-top: 8px; padding-bottom: 8px; }
</style>
