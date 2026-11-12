<script setup lang="ts">
import { ref, reactive, onMounted, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import { isAxiosError } from 'axios';
import { talentPoolApi } from '@/api/talent-pool.api';
import {
  FOLLOW_UP_CHANNELS,
  FOLLOW_UP_CHANNEL_LABELS,
  type FollowUpChannel,
  type TalentFollowUp,
} from '@/types/talent.types';
import { beijingFollowUpToday, formatFollowUpDate, isFollowUpDate } from '@/utils/talent-follow-up-date';

/**
 * 跟进记录时间线（需求 §5.3）：倒序展示日期/方式/内容/记录人，
 * 顶部「记一条」行内表单（日期默认今天，内容必填，下次跟进可选）。
 */

const props = defineProps<{
  candidateId: string;
  editable?: boolean;
}>();

const emit = defineEmits<{
  changed: [];
}>();

const list = ref<TalentFollowUp[]>([]);
const loading = ref(false);
const saving = ref(false);
const formVisible = ref(false);
const summaryInput = ref<HTMLTextAreaElement>();

const form = reactive({
  occurredAt: beijingFollowUpToday(),
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

onMounted(() => {
  void load();
});

async function load() {
  loading.value = true;
  try {
    list.value = await talentPoolApi.listFollowUps(props.candidateId);
  } finally {
    loading.value = false;
  }
}

function startCreate() {
  if (!props.editable) return;
  form.occurredAt = beijingFollowUpToday();
  form.channel = 'phone';
  form.summary = '';
  form.nextFollowUpAt = '';
  Object.assign(errors, { occurredAt: '', nextFollowUpAt: '', summary: '' });
  delete typedDates.occurredAt;
  delete typedDates.nextFollowUpAt;
  formVisible.value = true;
  void nextTick(() => summaryInput.value?.focus());
}

async function submit() {
  if (!props.editable || saving.value) return;
  await finishDateInput('occurredAt');
  await finishDateInput('nextFollowUpAt');
  const occurredAtValid = !errors.occurredAt && validateDate('occurredAt');
  const nextDateValid = !errors.nextFollowUpAt && validateDate('nextFollowUpAt');
  errors.summary = form.summary.trim() ? '' : '请填写跟进内容';
  if (!occurredAtValid || !nextDateValid || errors.summary) return;
  saving.value = true;
  try {
    await talentPoolApi.addFollowUp(props.candidateId, {
      occurredAt: form.occurredAt,
      channel: form.channel,
      summary: form.summary.trim(),
      nextFollowUpAt: form.nextFollowUpAt || null,
    });
    ElMessage.success('已记录跟进');
    formVisible.value = false;
    await load();
    emit('changed');
  } catch (error) {
    const message = isAxiosError(error) ? error.response?.data?.message : error instanceof Error ? error.message : '';
    if (typeof message === 'string') {
      if (message.includes('下次跟进日期')) errors.nextFollowUpAt = message;
      else if (message.includes('沟通日期')) errors.occurredAt = message;
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="talent-follow-ups">
    <div class="talent-follow-ups__header">
      <h4 class="talent-follow-ups__title">跟进记录（{{ list.length }}）</h4>
      <el-button v-if="editable" size="small" @click="startCreate">记一条</el-button>
    </div>

    <el-form v-if="editable && formVisible" :model="form" class="talent-follow-ups__form" @submit.prevent="submit">
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
      <div class="talent-follow-ups__form-row">
        <span class="talent-follow-ups__next-label">下次跟进</span>
        <el-form-item prop="nextFollowUpAt" :error="errors.nextFollowUpAt" @input.capture="captureDateInput('nextFollowUpAt', $event)">
          <el-date-picker v-model="form.nextFollowUpAt" type="date" value-format="YYYY-MM-DD" placeholder="不设置"
            clearable class="talent-follow-ups__date" @change="dateChanged('nextFollowUpAt')" @clear="clearNextDate"
            @blur="finishDateInput('nextFollowUpAt')" />
        </el-form-item>
      </div>
      <div class="talent-follow-ups__form-actions">
        <el-button size="small" @click="formVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="saving" @click="submit">保存跟进</el-button>
      </div>
    </el-form>

    <el-empty v-if="!loading && !list.length && !formVisible" description="还没有跟进记录" :image-size="60" />
    <el-timeline v-else v-loading="loading" class="talent-follow-ups__timeline">
      <el-timeline-item v-for="item in list" :key="item.id" :timestamp="formatFollowUpDate(item.occurredAt)" placement="top">
        <div class="talent-follow-ups__item">
          <div class="talent-follow-ups__item-meta">
            <el-tag size="small" effect="plain">{{ FOLLOW_UP_CHANNEL_LABELS[item.channel] }}</el-tag>
            <span class="talent-follow-ups__recorder">{{ item.createdByName ?? '—' }}</span>
            <el-tag v-if="item.nextFollowUpAt" size="small" type="warning" effect="light">
              下次跟进 {{ formatFollowUpDate(item.nextFollowUpAt) }}
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
.talent-follow-ups__title {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
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
}
</style>
