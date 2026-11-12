<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { talentPoolApi } from '@/api/talent-pool.api';
import {
  FOLLOW_UP_CHANNELS,
  FOLLOW_UP_CHANNEL_LABELS,
  type FollowUpChannel,
  type TalentFollowUp,
} from '@/types/talent.types';
import { formatDate } from '@/utils/date';

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
  occurredAt: new Date().toISOString().slice(0, 10),
  channel: 'phone' as FollowUpChannel,
  summary: '',
  nextFollowUpAt: '',
});

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
  form.occurredAt = new Date().toISOString().slice(0, 10);
  form.channel = 'phone';
  form.summary = '';
  form.nextFollowUpAt = '';
  formVisible.value = true;
  setTimeout(() => summaryInput.value?.focus(), 50);
}

async function submit() {
  if (!props.editable) return;
  if (!form.summary.trim()) {
    ElMessage.warning('请填写跟进内容');
    return;
  }
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

    <div v-if="editable && formVisible" class="talent-follow-ups__form">
      <div class="talent-follow-ups__form-row">
        <el-date-picker v-model="form.occurredAt" type="date" value-format="YYYY-MM-DD" placeholder="跟进日期"
          :clearable="false" class="talent-follow-ups__date" />
        <el-select v-model="form.channel" class="talent-follow-ups__channel">
          <el-option v-for="c in FOLLOW_UP_CHANNELS" :key="c" :label="FOLLOW_UP_CHANNEL_LABELS[c]" :value="c" />
        </el-select>
      </div>
      <el-input ref="summaryInput" v-model="form.summary" type="textarea" :rows="2" maxlength="500" show-word-limit
        placeholder="本次沟通要点（必填）" />
      <div class="talent-follow-ups__form-row">
        <span class="talent-follow-ups__next-label">下次跟进</span>
        <el-date-picker v-model="form.nextFollowUpAt" type="date" value-format="YYYY-MM-DD" placeholder="不设置"
          clearable class="talent-follow-ups__date" />
      </div>
      <div class="talent-follow-ups__form-actions">
        <el-button size="small" @click="formVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="saving" @click="submit">保存跟进</el-button>
      </div>
    </div>

    <el-empty v-if="!loading && !list.length && !formVisible" description="还没有跟进记录" :image-size="60" />
    <el-timeline v-else v-loading="loading" class="talent-follow-ups__timeline">
      <el-timeline-item v-for="item in list" :key="item.id" :timestamp="formatDate(item.occurredAt)" placement="top">
        <div class="talent-follow-ups__item">
          <div class="talent-follow-ups__item-meta">
            <el-tag size="small" effect="plain">{{ FOLLOW_UP_CHANNEL_LABELS[item.channel] }}</el-tag>
            <span class="talent-follow-ups__recorder">{{ item.createdByName ?? '—' }}</span>
            <el-tag v-if="item.nextFollowUpAt" size="small" type="warning" effect="light">
              下次跟进 {{ formatDate(item.nextFollowUpAt) }}
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
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.talent-follow-ups__date { width: 150px; }
.talent-follow-ups__channel { width: 110px; }
.talent-follow-ups__next-label {
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
