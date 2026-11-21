<script setup lang="ts">
import { computed, ref, reactive, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { isAxiosError } from 'axios';
import { talentPoolApi } from '@/api/talent-pool.api';
import {
  FOLLOW_UP_CHANNELS,
  FOLLOW_UP_CHANNEL_LABELS,
  type FollowUpChannel,
  type TalentFollowUp,
} from '@/types/talent.types';
import { beijingFollowUpToday, formatFollowUpDate, isFollowUpDate } from '@/utils/talent-follow-up-date';

const props = defineProps<{
  candidateId: string;
  editable?: boolean;
}>();

const emit = defineEmits<{
  changed: [];
}>();

const list = ref<TalentFollowUp[]>([]);
const loading = ref(false);
const loadError = ref('');
const saving = ref(false);
const formMode = ref<'supplement' | 'complete' | null>(null);
const expectedPlanId = ref<string | null>(null);
const planConflict = ref(false);
const actionError = ref('');
const summaryInput = ref<HTMLTextAreaElement>();
const currentPlan = computed(() => list.value.find(item => item.planStatus === 'pending'));
const currentDate = computed(() => formatFollowUpDate(currentPlan.value?.nextFollowUpAt));
const businessDay = ref(beijingFollowUpToday());
const currentTiming = computed(() => {
  const today = businessDay.value;
  return currentDate.value < today ? '逾期' : currentDate.value === today ? '今天' : '未来';
});
const draftPlanChanged = computed(() => Boolean(formMode.value) && expectedPlanId.value !== (currentPlan.value?.id ?? null));
const actionReady = computed(() => props.editable && !loading.value && !loadError.value && !saving.value && !planConflict.value);
const canChooseMode = computed(() => actionReady.value && (!formMode.value || draftPlanChanged.value));
const showNextDate = computed(() => formMode.value === 'complete' || !expectedPlanId.value);
const closedPlanLabels = { completed: '已完成', cancelled: '已取消', superseded: '已替换' };
let requestId = 0;
let session = 0;
let businessDayTimer: number | undefined;

const form = reactive({
  occurredAt: businessDay.value,
  channel: 'phone' as FollowUpChannel,
  summary: '',
  nextFollowUpAt: '',
});
type DateField = 'occurredAt' | 'nextFollowUpAt';
const errors = reactive({ occurredAt: '', nextFollowUpAt: '', summary: '' });
const typedDates = reactive<Partial<Record<DateField, string>>>({});

function captureDateInput(field: DateField, event: Event) {
  typedDates[field] = (event.target as HTMLInputElement).value;
}

function validateDate(field: DateField, value = form[field]) {
  const label = field === 'occurredAt' ? '沟通日期' : '下次跟进日期';
  errors[field] = (field === 'nextFollowUpAt' && !value) || isFollowUpDate(value)
    ? '' : `${label}必须是有效日期（YYYY-MM-DD）`;
  return !errors[field];
}

function dateChanged(field: DateField) {
  // Check typed text before the picker can silently roll Feb 31 into March.
  const value = typedDates[field] ?? form[field];
  delete typedDates[field];
  form[field] = validateDate(field, value) ? value || '' : '';
}

async function finishDateInput(field: DateField) {
  // Let the picker's change event finish before checking text it did not commit.
  await nextTick();
  await nextTick();
  if (typedDates[field] !== undefined) dateChanged(field);
}

function clearNextDate() {
  delete typedDates.nextFollowUpAt;
  errors.nextFollowUpAt = '';
}

function refreshBusinessDay() {
  window.clearTimeout(businessDayTimer);
  const now = new Date();
  businessDay.value = beijingFollowUpToday(now);
  const nextMidnight = Date.parse(`${businessDay.value}T00:00:00+08:00`) + 24 * 60 * 60 * 1000;
  businessDayTimer = window.setTimeout(refreshBusinessDay, nextMidnight - now.getTime());
}

function refreshBusinessDayOnReturn() {
  if (document.visibilityState === 'visible') refreshBusinessDay();
}

watch(() => props.candidateId, () => {
  ++session; ++requestId;
  list.value = [];
  loadError.value = '';
  formMode.value = null;
  planConflict.value = false;
  actionError.value = '';
  saving.value = false;
  void load();
}, { immediate: true });
onMounted(() => {
  refreshBusinessDay();
  document.addEventListener('visibilitychange', refreshBusinessDayOnReturn);
});
onBeforeUnmount(() => {
  ++session; ++requestId;
  window.clearTimeout(businessDayTimer);
  document.removeEventListener('visibilitychange', refreshBusinessDayOnReturn);
});

function active(candidateId: string, token: number) {
  return props.candidateId === candidateId && session === token;
}

async function load() {
  const id = ++requestId, candidateId = props.candidateId, token = session;
  loading.value = true;
  loadError.value = '';
  try {
    const result = await talentPoolApi.listFollowUps(candidateId);
    if (id !== requestId || !active(candidateId, token)) return;
    list.value = result;
  } catch {
    if (id === requestId && active(candidateId, token)) loadError.value = '跟进记录读取失败，请重试。';
  } finally {
    if (id === requestId && active(candidateId, token)) loading.value = false;
  }
}

function startCreate(mode: 'supplement' | 'complete') {
  if (!canChooseMode.value || (mode === 'complete' && !currentPlan.value)) return;
  if (!formMode.value) {
    Object.assign(form, { occurredAt: beijingFollowUpToday(), channel: 'phone', summary: '', nextFollowUpAt: '' });
    Object.assign(errors, { occurredAt: '', nextFollowUpAt: '', summary: '' });
    delete typedDates.occurredAt;
    delete typedDates.nextFollowUpAt;
  }
  actionError.value = '';
  expectedPlanId.value = currentPlan.value?.id ?? null;
  formMode.value = mode;
  void nextTick(() => summaryInput.value?.focus());
}

async function refreshArrangement() {
  const candidateId = props.candidateId, token = session;
  await load();
  if (active(candidateId, token) && !loadError.value) {
    planConflict.value = false;
    actionError.value = '';
    emit('changed');
  }
}

function showActionError(error: unknown, fallback: string) {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status === 409) {
    planConflict.value = true;
    actionError.value = '跟进安排已变化，请刷新后核对。';
    return;
  }
  const message = isAxiosError(error) ? error.response?.data?.message : error instanceof Error ? error.message : '';
  const messages = Array.isArray(message) ? message.join('；') : message;
  if (typeof messages === 'string' && messages.includes('下次跟进日期')) errors.nextFollowUpAt = messages;
  else if (typeof messages === 'string' && messages.includes('沟通日期')) errors.occurredAt = messages;
  else actionError.value = status === 403 ? '无权限办理跟进。' : typeof messages === 'string' && messages ? messages : fallback;
}

async function afterWrite(candidateId: string, token: number, message: string) {
  ElMessage.success(message);
  await load();
  if (active(candidateId, token)) emit('changed');
}

async function submit() {
  if (!actionReady.value || !formMode.value || draftPlanChanged.value) return;
  const candidateId = props.candidateId, token = session;
  const mode = formMode.value, planId = expectedPlanId.value;
  saving.value = true;
  actionError.value = '';
  await finishDateInput('occurredAt');
  if (showNextDate.value) await finishDateInput('nextFollowUpAt');
  if (!active(candidateId, token)) return;
  const occurredAtValid = !errors.occurredAt && validateDate('occurredAt');
  const nextDateValid = !showNextDate.value || (!errors.nextFollowUpAt && validateDate('nextFollowUpAt'));
  errors.summary = form.summary.trim() ? '' : '请填写跟进内容';
  if (!occurredAtValid || !nextDateValid || errors.summary) {
    saving.value = false;
    return;
  }
  try {
    await talentPoolApi.addFollowUp(candidateId, {
      occurredAt: form.occurredAt,
      channel: form.channel,
      summary: form.summary.trim(),
      nextFollowUpAt: showNextDate.value && form.nextFollowUpAt ? form.nextFollowUpAt : null,
      expectedPlanId: planId,
      ...(mode === 'complete' && planId ? { completePlanId: planId } : {}),
    });
    if (!active(candidateId, token)) return;
    formMode.value = null;
    await afterWrite(candidateId, token, mode === 'complete' ? '已完成跟进' : '已记录跟进');
  } catch (error) {
    if (active(candidateId, token)) showActionError(error, '保存跟进失败，请重试。');
  } finally {
    if (active(candidateId, token)) saving.value = false;
  }
}

async function cancelArrangement() {
  const plan = currentPlan.value;
  if (!actionReady.value || formMode.value || !plan) return;
  const candidateId = props.candidateId, token = session;
  saving.value = true;
  actionError.value = '';
  try {
    const confirmed = await ElMessageBox.confirm(
      `取消 ${currentDate.value} 的跟进安排？沟通记录会保留。`,
      '取消跟进安排',
      { confirmButtonText: '取消安排', cancelButtonText: '保留安排', type: 'warning' },
    ).then(() => true, () => false);
    if (!confirmed || !active(candidateId, token)) return;
    await talentPoolApi.cancelFollowUpPlan(candidateId, plan.id);
    if (active(candidateId, token)) await afterWrite(candidateId, token, '已取消跟进安排');
  } catch (error) {
    if (active(candidateId, token)) showActionError(error, '取消跟进安排失败，请重试。');
  } finally {
    if (active(candidateId, token)) saving.value = false;
  }
}
</script>

<template>
  <div class="talent-follow-ups">
    <div class="talent-follow-ups__header">
      <h4 class="talent-follow-ups__title">跟进记录（{{ list.length }}）</h4>
      <el-button v-if="editable" size="small" :disabled="!canChooseMode" @click="startCreate('supplement')">补充记录</el-button>
    </div>

    <section v-if="currentPlan && !loadError" aria-label="当前跟进安排" class="talent-follow-ups__current">
      <div class="talent-follow-ups__item-meta">
        <strong>当前安排</strong>
        <span>{{ currentDate }}</span>
        <el-tag size="small" :type="currentTiming === '逾期' ? 'danger' : currentTiming === '今天' ? 'warning' : 'info'">{{ currentTiming }}</el-tag>
      </div>
      <div v-if="editable" class="talent-follow-ups__form-actions">
        <el-button size="small" type="primary" :disabled="!canChooseMode" @click="startCreate('complete')">完成并记录</el-button>
        <el-button size="small" :disabled="!actionReady || Boolean(formMode)" @click="cancelArrangement">取消安排</el-button>
      </div>
    </section>

    <el-alert v-if="actionError || draftPlanChanged" :title="actionError || '输入已保留，请重新选择跟进操作。'"
      type="warning" :closable="false" class="talent-follow-ups__error">
      <el-button v-if="planConflict" link type="primary" :disabled="loading" @click="refreshArrangement">
        {{ formMode ? '刷新安排，保留输入' : '刷新安排' }}
      </el-button>
    </el-alert>

    <el-form v-if="editable && formMode" :model="form" class="talent-follow-ups__form" @submit.prevent="submit">
      <div class="talent-follow-ups__form-row">
        <el-form-item prop="occurredAt" :error="errors.occurredAt" @input.capture="captureDateInput('occurredAt', $event)">
          <el-date-picker v-model="form.occurredAt" type="date" value-format="YYYY-MM-DD" placeholder="跟进日期"
            :clearable="false" class="talent-follow-ups__date" @change="dateChanged('occurredAt')"
            @blur="finishDateInput('occurredAt')" />
        </el-form-item>
        <el-select v-model="form.channel" class="talent-follow-ups__channel">
          <el-option v-for="c in FOLLOW_UP_CHANNELS" :key="c" :label="FOLLOW_UP_CHANNEL_LABELS[c]" :value="c" />
        </el-select>
      </div>
      <el-form-item prop="summary" :error="errors.summary">
        <el-input ref="summaryInput" v-model="form.summary" type="textarea" :rows="2" maxlength="500" show-word-limit
          placeholder="本次沟通要点（必填）" @input="errors.summary = ''" />
      </el-form-item>
      <div v-if="showNextDate" class="talent-follow-ups__form-row">
        <span class="talent-follow-ups__next-label">下次跟进</span>
        <el-form-item prop="nextFollowUpAt" :error="errors.nextFollowUpAt" @input.capture="captureDateInput('nextFollowUpAt', $event)">
          <el-date-picker v-model="form.nextFollowUpAt" type="date" value-format="YYYY-MM-DD" placeholder="不设置"
            clearable class="talent-follow-ups__date" @change="dateChanged('nextFollowUpAt')" @clear="clearNextDate"
            @blur="finishDateInput('nextFollowUpAt')" />
        </el-form-item>
      </div>
      <div class="talent-follow-ups__form-actions">
        <el-button size="small" :disabled="saving" @click="formMode = null">取消编辑</el-button>
        <el-button size="small" type="primary" :loading="saving" :disabled="!actionReady || draftPlanChanged" @click="submit">
          {{ formMode === 'complete' ? '完成并保存' : '保存跟进' }}
        </el-button>
      </div>
    </el-form>

    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" class="talent-follow-ups__error">
      <el-button link type="primary" :disabled="loading" @click="load">重试</el-button>
    </el-alert>
    <el-empty v-if="!loading && !loadError && !list.length && !formMode" description="还没有跟进记录" :image-size="60" />
    <el-timeline v-else v-loading="loading" class="talent-follow-ups__timeline">
      <el-timeline-item v-for="item in list" :key="item.id" :timestamp="formatFollowUpDate(item.occurredAt)" placement="top">
        <div class="talent-follow-ups__item">
          <div class="talent-follow-ups__item-meta">
            <el-tag size="small" effect="plain">{{ FOLLOW_UP_CHANNEL_LABELS[item.channel] }}</el-tag>
            <span class="talent-follow-ups__recorder">{{ item.createdByName ?? '—' }}</span>
            <el-tag v-if="item.nextFollowUpAt && item.planStatus in closedPlanLabels" size="small" type="info" effect="plain">
              {{ closedPlanLabels[item.planStatus as keyof typeof closedPlanLabels] }} {{ formatFollowUpDate(item.nextFollowUpAt) }}
            </el-tag>
          </div>
          <p class="talent-follow-ups__summary">{{ item.summary }}</p>
        </div>
      </el-timeline-item>
    </el-timeline>
  </div>
</template>

<style scoped>
.talent-follow-ups__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.talent-follow-ups__error { margin-bottom: 12px; }
.talent-follow-ups__title {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
}
.talent-follow-ups__current {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 13px;
}
.talent-follow-ups__form {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  margin-bottom: 12px;
}
.talent-follow-ups__form-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
}
.talent-follow-ups__form :deep(.el-form-item) {
  margin-bottom: 0;
  min-width: 0;
  max-width: 100%;
}
.talent-follow-ups__form :deep(.el-form-item__content) {
  display: block;
  min-width: 0;
}
.talent-follow-ups__form :deep(.el-form-item__error) {
  position: static;
  line-height: 18px;
  max-width: 240px;
}
.talent-follow-ups__date { width: 150px; }
.talent-follow-ups__channel { width: 110px; }
.talent-follow-ups__next-label {
  line-height: 32px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.talent-follow-ups__form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.talent-follow-ups__form-actions .el-button + .el-button { margin-left: 0; }
.talent-follow-ups__timeline {
  padding-left: 4px;
}
.talent-follow-ups__item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.talent-follow-ups__recorder {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.talent-follow-ups__summary {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 20px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
