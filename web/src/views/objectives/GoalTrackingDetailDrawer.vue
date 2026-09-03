<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import axios from 'axios';
import { objectivesApi } from '@/api/objectives.api';
import type {
  GoalTrackingHealthStatus,
  GoalTrackingIndicatorDetail,
  GoalTrackingLatestProgress,
} from '@/types/api.types';
import { buildIndicatorVersionHistory } from './indicator-version-history';
import { indicatorVisibilitySummary } from '@/views/task/indicator-visibility';

const props = defineProps<{ indicatorId: string }>();
const emit = defineEmits<{ close: []; updated: [] }>();

const detail = ref<GoalTrackingIndicatorDetail | null>(null);
const loading = ref(false);
const loadError = ref('');
const editing = ref(false);
const submitting = ref(false);
const contentInput = ref<HTMLTextAreaElement>();
let requestSerial = 0;

const form = reactive<{
  healthStatus: GoalTrackingHealthStatus;
  progress: number;
  content: string;
}>({
  healthStatus: 'on_track',
  progress: 0,
  content: '',
});

const opened = computed(() => Boolean(props.indicatorId));
const latestProgress = computed(() => detail.value?.progressUpdates[0] ?? null);
const activeBusinessPeriodKey = computed(() => (
  detail.value?.activeBusinessPeriodKey ?? latestProgress.value?.businessPeriodKey ?? null
));
const activePeriodLabel = computed(() => formatBusinessPeriod(activeBusinessPeriodKey.value));
const updateActionLabel = computed(() => `更新${activePeriodLabel.value}目标进展`);
const historyGroups = computed(() => {
  const groups = new Map<string, GoalTrackingLatestProgress[]>();
  for (const progress of detail.value?.progressUpdates.slice(1) ?? []) {
    groups.set(progress.businessPeriodKey, [...(groups.get(progress.businessPeriodKey) ?? []), progress]);
  }
  return [...groups.entries()].map(([periodKey, items]) => ({ periodKey, items }));
});
const indicatorVersions = computed(() => buildIndicatorVersionHistory(detail.value?.changeRecords ?? []));
const currentGoalBasis = computed(() => indicatorVersions.value[0] ?? null);
const displayDescription = computed(() => (
  detail.value?.description?.trim().replace(/^realistic-demo-v\d+\s*[；;:：]\s*/i, '') ?? ''
));

watch(() => props.indicatorId, (indicatorId) => {
  editing.value = false;
  if (!indicatorId) {
    detail.value = null;
    return;
  }
  void loadDetail(indicatorId);
}, { immediate: true });

async function loadDetail(indicatorId = props.indicatorId) {
  const serial = ++requestSerial;
  loading.value = true;
  loadError.value = '';
  try {
    const result = await objectivesApi.getTrackingIndicator(indicatorId);
    if (serial !== requestSerial || indicatorId !== props.indicatorId) return;
    detail.value = result;
  } catch {
    if (serial !== requestSerial) return;
    detail.value = null;
    loadError.value = '指标详情加载失败，请稍后重试';
  } finally {
    if (serial === requestSerial) loading.value = false;
  }
}

function startEditing() {
  if (!detail.value?.canEdit) return;
  form.healthStatus = latestProgress.value?.healthStatus ?? 'on_track';
  form.progress = latestProgress.value?.progress ?? 0;
  form.content = '';
  editing.value = true;
  void nextTick(() => contentInput.value?.focus());
}

function cancelEditing() {
  editing.value = false;
  form.content = '';
}

function validateForm() {
  if (!Number.isInteger(form.progress) || form.progress < 0 || form.progress > 100) {
    ElMessage.warning('完成进度必须是 0 到 100 的整数');
    return false;
  }
  if (!form.content.trim()) {
    ElMessage.warning('请填写进展说明');
    return false;
  }
  if (['at_risk', 'blocked'].includes(form.healthStatus) && form.content.trim().length < 4) {
    ElMessage.warning('风险或阻塞状态需要填写具体说明');
    return false;
  }
  return true;
}

async function submitProgress() {
  if (!detail.value || !validateForm()) return;
  submitting.value = true;
  try {
    const created = await objectivesApi.updateTrackingIndicatorProgress(
      detail.value.id,
      {
        progress: form.progress,
        healthStatus: form.healthStatus,
        content: form.content.trim(),
        expectedLatestUpdateAt: latestProgress.value?.updatedAt ?? null,
      },
      { skipErrorMessage: true },
    );
    detail.value.progress = created.progress ?? 0;
    detail.value.progressUpdates = [created, ...detail.value.progressUpdates];
    editing.value = false;
    form.content = '';
    ElMessage.success('进展已更新');
    emit('updated');
  } catch (error) {
    const responseMessage = axios.isAxiosError(error)
      ? error.response?.data?.message
      : null;
    if (
      axios.isAxiosError(error)
      && error.response?.status === 409
      && responseMessage === '进展已被更新，请刷新后重试'
    ) {
      const draftContent = form.content;
      await loadDetail();
      if (detail.value) {
        form.healthStatus = latestProgress.value?.healthStatus ?? 'on_track';
        form.progress = latestProgress.value?.progress ?? 0;
        form.content = draftContent;
        editing.value = true;
        ElMessage.warning('进展已更新，已加载最新状态；刚才填写的描述已保留，请确认后再次提交');
      } else {
        ElMessage.error('进展已更新，但最新状态加载失败，请稍后重试');
      }
      return;
    }
    ElMessage.error(typeof responseMessage === 'string' ? responseMessage : '更新进展失败，请稍后重试');
  } finally {
    submitting.value = false;
  }
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function healthLabel(status?: GoalTrackingHealthStatus | null) {
  if (!status) return '本月未更新';
  return {
    on_track: '正常',
    at_risk: '存在风险',
    blocked: '已阻塞',
    completed: '已完成',
  }[status];
}

function progressSourceLabel(progress: GoalTrackingLatestProgress) {
  return progress.source === 'monthly_self_evaluation' ? '月度自评结果' : '主动进展';
}

function formatBusinessPeriod(periodKey?: string | null) {
  if (periodKey === 'cycle') return '本考核周期';
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey ?? '');
  if (match) return `${match[1]}年${Number(match[2])}月`;
  return periodKey || '当前阶段';
}

</script>

<template>
  <el-drawer
    :model-value="opened"
    data-testid="goal-tracking-detail"
    class="goal-detail-drawer"
    size="min(720px, 100vw)"
    destroy-on-close
    @close="emit('close')"
  >
    <template #header>
      <div class="goal-detail__header">
        <span>指标详情</span>
        <el-button
          v-if="detail?.canEdit && !editing"
          type="primary"
          data-testid="goal-tracking-update-trigger"
          @click="startEditing"
        >
          {{ updateActionLabel }}
        </el-button>
      </div>
    </template>

    <div v-if="loading" class="goal-detail__state"><el-skeleton :rows="8" animated /></div>
    <div v-else-if="loadError" class="goal-detail__state goal-detail__error">
      <p>{{ loadError }}</p>
      <el-button @click="loadDetail()">重新加载</el-button>
    </div>
    <article v-else-if="detail" class="goal-detail">
      <header class="goal-detail__hero">
        <div class="goal-detail__meta-line">
          <span class="goal-detail__alignment">↗ {{ detail.alignedObjectives.length ? '已对齐目标' : '暂未关联目标' }}</span>
          <span class="goal-detail__visibility">
            {{ indicatorVisibilitySummary(detail.visibilityScopes, detail.visibilityScope) }}
          </span>
        </div>
        <h2>{{ detail.title }}</h2>
        <div class="goal-detail__subline">
          <span>{{ detail.dimensionName || '未分组' }}</span>
          <span>有效权重 {{ detail.weight ?? 0 }}%</span>
        </div>
        <nav class="goal-detail__tabs" aria-label="指标详情区块">
          <button type="button" @click="scrollToSection('goal-detail-progress')">进展</button>
          <button type="button" @click="scrollToSection('goal-detail-info')">指标详情</button>
          <button type="button" @click="scrollToSection('goal-detail-changes')">目标变更记录</button>
        </nav>
      </header>

      <section id="goal-detail-progress" class="goal-detail__card goal-detail__section">
        <div class="goal-detail__section-title">
          <h3>进展</h3>
          <button v-if="detail.canEdit && !editing" type="button" @click="startEditing">
            {{ updateActionLabel }}
          </button>
        </div>

        <div v-if="latestProgress" class="current-progress" data-testid="goal-tracking-current-progress">
          <div class="current-progress__meta">
            <span>{{ latestProgress.businessPeriodKey }}</span>
            <span>{{ progressSourceLabel(latestProgress) }}</span>
            <time>{{ formatDate(latestProgress.updatedAt) }}</time>
          </div>
          <div class="current-progress__values">
            <span :data-health="latestProgress.healthStatus">{{ healthLabel(latestProgress.healthStatus) }}</span>
            <strong>{{ latestProgress.progress == null ? '本月未更新' : `${latestProgress.progress}%` }}</strong>
          </div>
          <p>{{ latestProgress.content || '未填写描述' }}</p>
        </div>
        <p v-else class="goal-detail__empty">当前尚未记录进展</p>

        <form
          v-if="editing"
          class="progress-editor"
          data-testid="goal-tracking-progress-form"
          @submit.prevent="submitProgress"
        >
          <div class="progress-editor__context" data-testid="goal-tracking-progress-context">
            <div><span>本次归属</span><strong>{{ activePeriodLabel }}</strong></div>
            <p v-if="latestProgress">
              当前记录：{{ healthLabel(latestProgress.healthStatus) }} · {{ latestProgress.progress ?? 0 }}%，来自
              {{ formatBusinessPeriod(latestProgress.businessPeriodKey) }}{{ progressSourceLabel(latestProgress) }}
            </p>
            <p v-else>当前尚无进展记录</p>
          </div>
          <div class="progress-editor__fields">
            <label>
              <span>状态</span>
              <select v-model="form.healthStatus" aria-label="进展状态">
                <option value="on_track">正常</option>
                <option value="at_risk">存在风险</option>
                <option value="blocked">已阻塞</option>
                <option value="completed">已完成</option>
              </select>
            </label>
            <label>
              <span>进度</span>
              <input v-model.number="form.progress" aria-label="完成进度" type="number" min="0" max="100" step="1">
              <b>%</b>
            </label>
          </div>
          <label class="progress-editor__composer">
            <span>描述</span>
            <textarea
              ref="contentInput"
              v-model="form.content"
              aria-label="进展描述"
              maxlength="10000"
              placeholder="简要说明当前进展"
              rows="4"
            />
          </label>
          <div class="progress-editor__footer">
            <span>只需填写状态、进度和描述</span>
            <div class="progress-editor__actions">
              <el-button @click="cancelEditing">取消</el-button>
              <el-button type="primary" native-type="submit" :loading="submitting">更新进度</el-button>
            </div>
          </div>
        </form>

        <details v-if="historyGroups.length" class="goal-progress-history" data-testid="goal-tracking-history">
          <summary>历史目标进展（{{ detail.progressUpdates.length - 1 }}）</summary>
          <section v-for="group in historyGroups" :key="group.periodKey">
            <h4>{{ group.periodKey }}</h4>
            <ol class="goal-progress-timeline">
              <li v-for="progress in group.items" :key="progress.id" :class="{ 'is-monthly': progress.source === 'monthly_self_evaluation' }">
                <span class="goal-progress-timeline__dot" aria-hidden="true" />
                <div class="goal-progress-timeline__head">
                  <strong>{{ progressSourceLabel(progress) }}</strong>
                  <time>{{ formatDate(progress.updatedAt) }}</time>
                </div>
                <div class="goal-progress-timeline__tags">
                  <span :data-health="progress.healthStatus">{{ healthLabel(progress.healthStatus) }}</span>
                  <span>{{ progress.progress == null ? '本月未更新' : `${progress.progress}%` }}</span>
                </div>
                <p>{{ progress.content || progress.title || '未填写描述' }}</p>
                <div v-if="progress.attachments?.length" class="goal-progress-timeline__files">
                  <a v-for="attachment in progress.attachments" :key="attachment.url" :href="attachment.url" target="_blank" rel="noopener">
                    {{ attachment.name }}
                  </a>
                </div>
              </li>
            </ol>
          </section>
        </details>

        <div v-if="currentGoalBasis" class="current-goal-basis" data-testid="goal-tracking-current-basis">
          <div>
            <span>当前目标依据</span>
            <strong>{{ currentGoalBasis.currentBasisLabel }}</strong>
            <small>{{ currentGoalBasis.actorName }} · {{ formatDate(currentGoalBasis.createdAt) }}</small>
            <small v-if="currentGoalBasis.reason" class="current-goal-basis__reason">调整原因：{{ currentGoalBasis.reason }}</small>
          </div>
          <button type="button" @click="scrollToSection('goal-detail-changes')">查看目标变更记录</button>
        </div>
      </section>

      <section id="goal-detail-info" class="goal-detail__card goal-detail__section">
        <h3>指标详情</h3>
        <div class="goal-detail__description">
          <span>指标描述</span>
          <p>{{ displayDescription || '暂未填写' }}</p>
        </div>
        <div class="goal-detail__scoring-standard">
          <span>评分标准</span>
          <p>{{ detail.scoringStandard || '暂未填写' }}</p>
        </div>
      </section>

      <section id="goal-detail-changes" class="goal-detail__card goal-detail__section">
        <div class="goal-detail__section-title">
          <div>
            <h3>目标变更记录</h3>
            <p class="goal-change-list__hint">记录目标确认及正式调整，日常进展和月度自评不会改变目标内容。</p>
          </div>
        </div>
        <ol v-if="indicatorVersions.length" class="goal-change-list">
          <li
            v-for="version in indicatorVersions"
            :key="version.id"
            :data-testid="`indicator-version-${version.id}`"
          >
            <details :open="version.isCurrent && version.changes.length > 0">
              <summary>
                <span class="goal-change-list__version">
                  {{ version.businessLabel }}
                  <em v-if="version.isCurrent">当前使用</em>
                </span>
                <span class="goal-change-list__meta">
                  {{ version.actorName }} · {{ formatDate(version.createdAt) }}
                </span>
              </summary>
              <div v-if="version.changes.length" class="goal-change-list__diffs">
                <div v-for="change in version.changes" :key="change.field" class="goal-change-list__diff">
                  <strong>{{ change.label }}</strong>
                  <div><span>变更前</span><p>{{ change.before }}</p></div>
                  <div><span>变更后</span><p>{{ change.after }}</p></div>
                </div>
              </div>
              <p v-else class="goal-change-list__baseline">{{ version.emptyMessage }}</p>
              <p v-if="version.reason" class="goal-change-list__reason">变更原因：{{ version.reason }}</p>
            </details>
          </li>
        </ol>
        <p v-else class="goal-detail__empty">目标确认后将在这里保留正式记录</p>
      </section>
    </article>
  </el-drawer>
</template>

<style scoped>
.goal-detail__header,
.goal-detail__meta-line,
.goal-detail__subline,
.goal-detail__section-title,
.goal-progress-timeline__head,
.progress-editor__footer,
.progress-editor__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.progress-editor__context {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid #dfe6f4;
  border-radius: 8px;
  background: #f7f9fd;
}

.progress-editor__context > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.progress-editor__context span,
.progress-editor__context p {
  margin: 0;
  color: #7d889c;
  font-size: 12px;
}

.progress-editor__context strong {
  color: #355dc9;
  font-size: 13px;
}

.goal-detail__header {
  width: 100%;
  color: #2d384d;
  font-size: 14px;
  font-weight: 600;
}

.goal-detail {
  min-height: 100%;
  margin: -20px;
  padding: 0 20px 24px;
  color: #27334a;
  background: #f4f6fb;
}

.goal-detail__hero {
  position: sticky;
  z-index: 2;
  top: -20px;
  margin: 0 -20px 16px;
  padding: 18px 20px 0;
  border-bottom: 1px solid #e9edf4;
  background: #fff;
}

.goal-detail__meta-line,
.goal-detail__subline {
  color: #8c97aa;
  font-size: 12px;
}

.goal-detail__alignment {
  color: #2388ee;
}

.goal-detail__visibility {
  padding: 3px 8px;
  border-radius: 4px;
  color: #3388dd;
  background: #eaf4ff;
}

.goal-detail__hero h2 {
  margin: 10px 0 6px;
  color: #1f2a40;
  font-size: 24px;
  line-height: 1.35;
}

.goal-detail__tabs {
  display: flex;
  gap: 28px;
  margin-top: 14px;
}

.goal-detail__tabs button {
  position: relative;
  padding: 10px 0;
  border: 0;
  color: #59667d;
  background: transparent;
  cursor: pointer;
}

.goal-detail__tabs button:first-child {
  color: #1684ee;
}

.goal-detail__tabs button:first-child::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 3px;
  border-radius: 3px;
  background: #1684ee;
  content: '';
}

.goal-detail__card {
  margin-top: 16px;
  padding: 18px;
  border: 1px solid #edf0f5;
  border-radius: 14px;
  background: #fff;
}

.goal-detail__section {
  scroll-margin-top: 150px;
}

.goal-detail__section h3 {
  margin: 0 0 14px;
  font-size: 18px;
}

.goal-change-list__hint {
  margin: -8px 0 0;
  color: #8a95a8;
  font-size: 12px;
}

.goal-change-list {
  display: grid;
  gap: 10px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}

.goal-change-list > li {
  overflow: hidden;
  border: 1px solid #e6eaf1;
  border-radius: 10px;
  background: #fff;
}

.goal-change-list summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  cursor: pointer;
  list-style: none;
}

.goal-change-list summary::-webkit-details-marker {
  display: none;
}

.goal-change-list__version {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #276ed8;
  font-weight: 600;
}

.goal-change-list__version em {
  padding: 2px 7px;
  border-radius: 999px;
  color: #278557;
  background: #eaf7f0;
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
}

.goal-change-list__meta {
  color: #8a95a8;
  font-size: 12px;
  text-align: right;
}

.goal-change-list__diffs {
  display: grid;
  gap: 12px;
  padding: 0 14px 14px;
}

.goal-change-list__diff {
  display: grid;
  grid-template-columns: 88px 1fr 1fr;
  gap: 8px;
}

.goal-change-list__diff > strong {
  padding-top: 9px;
  font-size: 13px;
}

.goal-change-list__diff > div {
  padding: 8px 10px;
  border-radius: 7px;
  background: #f7f9fc;
}

.goal-change-list__diff > div:last-child {
  background: #eef8f3;
}

.goal-change-list__diff span {
  color: #9aa4b5;
  font-size: 11px;
}

.goal-change-list__diff p,
.goal-change-list__baseline,
.goal-change-list__reason {
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.goal-change-list__baseline,
.goal-change-list__reason {
  margin: 0;
  padding: 0 14px 14px;
  color: #687386;
  font-size: 13px;
}

.goal-detail__section-title button {
  border: 0;
  color: #8a95a8;
  background: transparent;
  cursor: pointer;
}

.current-goal-basis {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
  padding: 13px 14px;
  border: 1px solid #dfe7f5;
  border-radius: 10px;
  background: #f7faff;
}

.current-goal-basis > div {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.current-goal-basis span,
.current-goal-basis small {
  color: #8792a5;
  font-size: 11px;
}

.current-goal-basis__reason {
  margin-top: 2px;
  color: #66758e !important;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.current-goal-basis strong {
  color: #2f3c55;
  font-size: 14px;
}

.current-goal-basis button {
  flex: 0 0 auto;
  padding: 6px 10px;
  border: 1px solid #cdd9ec;
  border-radius: 7px;
  color: #316ed4;
  background: #fff;
  cursor: pointer;
}

.current-progress { display: grid; gap: 10px; margin-bottom: 16px; padding: 14px; border: 1px solid #dfe6f2; border-radius: 11px; background: #f9fbff; }
.current-progress__meta, .current-progress__values { display: flex; align-items: center; gap: 8px; }
.current-progress__meta span { padding: 3px 7px; border-radius: 999px; background: #edf3ff; color: #4770cf; font-size: 11px; }
.current-progress__meta time { margin-left: auto; color: #8d97a8; font-size: 11px; }
.current-progress__values { justify-content: space-between; }
.current-progress__values span { color: #33845c; font-size: 12px; }
.current-progress__values strong { font-size: 22px; }
.current-progress p { margin: 0; color: #425069; white-space: pre-wrap; word-break: break-word; }
.goal-progress-history { margin-top: 14px; border-top: 1px solid #edf0f5; }
.goal-progress-history > summary { padding: 14px 0 4px; color: #60708a; cursor: pointer; font-weight: 600; }
.goal-progress-history > section h4 { margin: 14px 0 4px; color: #8490a4; font-size: 12px; }
.goal-progress-timeline > li.is-monthly { border-radius: 8px; background: #f4f8ff; }

.progress-editor {
  margin-bottom: 18px;
  padding: 14px;
  border-radius: 12px;
  background: #f6f8fc;
}

.progress-editor__fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 10px;
}

.progress-editor__fields label {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid #dfe4ec;
  border-radius: 7px;
  background: #fff;
}

.progress-editor__fields label > span {
  flex: 0 0 auto;
  color: #7d899d;
  font-size: 13px;
}

.progress-editor__fields select,
.progress-editor__fields input {
  min-width: 0;
  height: 34px;
  flex: 1;
  border: 0;
  outline: 0;
  color: #344056;
  background: transparent;
}

.progress-editor__composer {
  overflow: hidden;
  border: 1px solid #dfe4ec;
  border-radius: 8px;
  background: #fff;
}

.progress-editor__toolbar {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid #e5e9f0;
}

.progress-editor__toolbar button {
  width: 30px;
  height: 28px;
  border: 0;
  border-radius: 4px;
  color: #526079;
  background: transparent;
  cursor: pointer;
}

.progress-editor__toolbar button:hover {
  color: #177edb;
  background: #edf5ff;
}

.progress-editor textarea {
  width: 100%;
  min-height: 130px;
  box-sizing: border-box;
  padding: 12px;
  resize: vertical;
  border: 0;
  outline: 0;
  color: #344056;
  font: inherit;
}

.progress-editor__footer {
  margin-top: 10px;
}

.progress-editor__upload {
  padding: 7px 12px;
  border: 1px solid #d5dce7;
  border-radius: 6px;
  color: #4f5d73;
  background: #fff;
  cursor: pointer;
}

.progress-editor__attachments,
.goal-progress-timeline {
  padding: 0;
  margin: 12px 0 0;
  list-style: none;
}

.progress-editor__attachments li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  color: #287ccb;
  font-size: 13px;
}

.progress-editor__attachments button {
  border: 0;
  color: #8d97aa;
  background: transparent;
}

.goal-progress-timeline li {
  position: relative;
  padding: 0 0 20px 22px;
  border-left: 1px dashed #cbd9ec;
}

.goal-progress-timeline li:last-child {
  padding-bottom: 0;
  border-left-color: transparent;
}

.goal-progress-timeline__dot {
  position: absolute;
  top: 3px;
  left: -5px;
  width: 9px;
  height: 9px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #1684ee;
  box-shadow: 0 0 0 1px #1684ee;
}

.goal-progress-timeline__head time {
  color: #98a2b4;
  font-size: 12px;
}

.goal-progress-timeline__tags {
  display: flex;
  gap: 8px;
  margin: 7px 0;
}

.goal-progress-timeline__tags span {
  padding: 2px 8px;
  border-radius: 10px;
  color: #33805b;
  background: #e8f8ee;
  font-size: 12px;
}

.goal-progress-timeline__tags [data-health='at_risk'] {
  color: #a66a00;
  background: #fff3d5;
}

.goal-progress-timeline__tags [data-health='blocked'] {
  color: #c34545;
  background: #ffeaea;
}

.goal-progress-timeline p {
  margin: 6px 0 0;
  color: #4d5a70;
  line-height: 1.7;
  white-space: pre-wrap;
}

.goal-progress-timeline__files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.goal-progress-timeline__files a {
  color: #2584dc;
  font-size: 13px;
}

.goal-detail__description span,
.goal-detail__scoring-standard span {
  margin-bottom: 5px;
  color: #98a2b4;
  font-size: 12px;
}

.goal-detail__description p,
.goal-detail__scoring-standard p {
  margin: 5px 0 0;
  color: #3a465c;
  line-height: 1.7;
  white-space: pre-wrap;
}

.goal-detail__scoring-standard {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid #edf0f5;
}

.goal-detail__state {
  padding: 24px;
}

.goal-detail__error,
.goal-detail__empty {
  color: #8e99ab;
  text-align: center;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 768px) {
  .goal-detail {
    padding-bottom: 88px;
  }

  .goal-detail__hero {
    position: relative;
    top: auto;
  }

  .goal-detail__hero h2 {
    font-size: 21px;
  }

  .goal-detail__tabs {
    gap: 18px;
    overflow-x: auto;
    white-space: nowrap;
  }

  .goal-change-list summary {
    grid-template-columns: minmax(0, 1fr);
  }

  .goal-change-list__meta {
    text-align: left;
  }

  .goal-change-list__diff {
    grid-template-columns: minmax(0, 1fr);
  }

  .goal-change-list__diff > strong {
    padding-top: 0;
  }

  .current-goal-basis {
    align-items: flex-start;
    flex-direction: column;
  }

  .progress-editor__fields {
    grid-template-columns: 1fr;
  }

  .progress-editor__footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .progress-editor__actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
