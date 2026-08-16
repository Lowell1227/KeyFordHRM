<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { objectivesApi } from '@/api/objectives.api';
import { uploadApi } from '@/api/upload.api';
import type {
  Attachment,
  GoalTrackingHealthStatus,
  GoalTrackingIndicatorDetail,
} from '@/types/api.types';

const props = defineProps<{ indicatorId: string }>();
const emit = defineEmits<{ close: []; updated: [] }>();

const detail = ref<GoalTrackingIndicatorDetail | null>(null);
const loading = ref(false);
const loadError = ref('');
const editing = ref(false);
const submitting = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement>();
const contentInput = ref<HTMLTextAreaElement>();
let requestSerial = 0;

const form = reactive<{
  healthStatus: GoalTrackingHealthStatus;
  progress: number;
  content: string;
  attachments: Attachment[];
}>({
  healthStatus: 'on_track',
  progress: 0,
  content: '',
  attachments: [],
});

const opened = computed(() => Boolean(props.indicatorId));
const latestProgress = computed(() => detail.value?.progressUpdates[0] ?? null);
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
  form.attachments = [];
  editing.value = true;
  void nextTick(() => contentInput.value?.focus());
}

function cancelEditing() {
  editing.value = false;
  form.content = '';
  form.attachments = [];
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
    const created = await objectivesApi.updateTrackingIndicatorProgress(detail.value.id, {
      progress: form.progress,
      healthStatus: form.healthStatus,
      content: form.content.trim(),
      attachments: form.attachments,
      expectedLatestUpdateAt: latestProgress.value?.updatedAt ?? null,
    });
    detail.value.progress = created.progress;
    detail.value.progressUpdates = [created, ...detail.value.progressUpdates];
    editing.value = false;
    form.content = '';
    form.attachments = [];
    ElMessage.success('进展已更新');
    emit('updated');
  } finally {
    submitting.value = false;
  }
}

function triggerUpload() {
  fileInput.value?.click();
}

async function handleFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  if (!files.length) return;
  uploading.value = true;
  try {
    for (const file of files) {
      if (form.attachments.length >= 10) {
        ElMessage.warning('每次进展最多上传 10 个附件');
        break;
      }
      form.attachments.push(await uploadApi.upload(file));
    }
  } finally {
    uploading.value = false;
  }
}

function removeAttachment(index: number) {
  form.attachments.splice(index, 1);
}

function wrapSelection(prefix: string, suffix = prefix) {
  const input = contentInput.value;
  if (!input) return;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const selected = form.content.slice(start, end);
  form.content = `${form.content.slice(0, start)}${prefix}${selected}${suffix}${form.content.slice(end)}`;
  void nextTick(() => {
    input.focus();
    input.setSelectionRange(start + prefix.length, end + prefix.length);
  });
}

function prefixLines(prefix: string) {
  const input = contentInput.value;
  if (!input) return;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const selected = form.content.slice(start, end) || '列表内容';
  const replacement = selected.split('\n').map((line) => `${prefix}${line}`).join('\n');
  form.content = `${form.content.slice(0, start)}${replacement}${form.content.slice(end)}`;
  void nextTick(() => input.focus());
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

function healthLabel(status?: GoalTrackingHealthStatus) {
  return {
    on_track: '正常',
    at_risk: '存在风险',
    blocked: '已阻塞',
    completed: '已完成',
  }[status ?? 'on_track'];
}

function visibilityLabel(scope?: string) {
  return {
    company: '全公司可见',
    department: '本部门可见',
    department_tree: '部门体系可见',
    direct_reports: '直接下属可见',
    all_reports: '全部下属可见',
    supervisors: '本人及主管可见',
    custom: '指定范围可见',
  }[scope ?? 'supervisors'] ?? '按权限可见';
}

function changeActionLabel(action: string) {
  return {
    progress_update: '更新指标进展',
    indicator_created: '创建考核指标',
    indicator_updated: '调整考核指标',
    indicator_deleted: '删除考核指标',
  }[action] ?? action;
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
          更新进展
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
          <span class="goal-detail__visibility">{{ visibilityLabel(detail.visibilityScope) }}</span>
        </div>
        <h2>{{ detail.title }}</h2>
        <div class="goal-detail__subline">
          <span>{{ detail.dimensionName || '未分组' }}</span>
          <span>有效权重 {{ detail.weight ?? 0 }}%</span>
        </div>
        <nav class="goal-detail__tabs" aria-label="指标详情区块">
          <button type="button" @click="scrollToSection('goal-detail-progress')">进展</button>
          <button type="button" @click="scrollToSection('goal-detail-info')">指标详情</button>
          <button type="button" @click="scrollToSection('goal-detail-changes')">指标变更记录</button>
        </nav>
      </header>

      <section id="goal-detail-progress" class="goal-detail__card goal-detail__section">
        <div class="goal-detail__section-title">
          <h3>进展</h3>
          <button v-if="detail.canEdit && !editing" type="button" @click="startEditing">
            填写更多详细进展
          </button>
        </div>

        <form
          v-if="editing"
          class="progress-editor"
          data-testid="goal-tracking-progress-form"
          @submit.prevent="submitProgress"
        >
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
          <div class="progress-editor__composer">
            <div class="progress-editor__toolbar" aria-label="格式工具栏">
              <button type="button" aria-label="加粗" @click="wrapSelection('**')"><b>B</b></button>
              <button type="button" aria-label="斜体" @click="wrapSelection('_')"><i>I</i></button>
              <button type="button" aria-label="下划线" @click="wrapSelection('<u>', '</u>')"><u>U</u></button>
              <button type="button" aria-label="无序列表" @click="prefixLines('- ')">☷</button>
              <button type="button" aria-label="有序列表" @click="prefixLines('1. ')">☰</button>
              <button type="button" aria-label="链接" @click="wrapSelection('[', '](https://)')">↗</button>
            </div>
            <textarea
              ref="contentInput"
              v-model="form.content"
              aria-label="进展说明"
              maxlength="10000"
              placeholder="填写更多详细进展"
              rows="6"
            />
          </div>
          <div class="progress-editor__footer">
            <div>
              <input ref="fileInput" class="visually-hidden" type="file" multiple @change="handleFiles">
              <button type="button" class="progress-editor__upload" :disabled="uploading" @click="triggerUpload">
                ⇧ {{ uploading ? '上传中' : '点击上传' }}
              </button>
            </div>
            <div class="progress-editor__actions">
              <el-button @click="cancelEditing">取消</el-button>
              <el-button type="primary" native-type="submit" :loading="submitting">更新进度</el-button>
            </div>
          </div>
          <ul v-if="form.attachments.length" class="progress-editor__attachments">
            <li v-for="(attachment, index) in form.attachments" :key="attachment.url">
              <a :href="attachment.url" target="_blank" rel="noopener">{{ attachment.name }}</a>
              <button type="button" :aria-label="`移除附件 ${attachment.name}`" @click="removeAttachment(index)">×</button>
            </li>
          </ul>
        </form>

        <ol v-if="detail.progressUpdates.length" class="goal-progress-timeline">
          <li v-for="progress in detail.progressUpdates" :key="progress.id">
            <span class="goal-progress-timeline__dot" aria-hidden="true" />
            <div class="goal-progress-timeline__head">
              <strong>{{ progress.creatorName || detail.ownerName }}</strong>
              <time>{{ formatDate(progress.updatedAt) }}</time>
            </div>
            <div class="goal-progress-timeline__tags">
              <span :data-health="progress.healthStatus">{{ healthLabel(progress.healthStatus) }}</span>
              <span>{{ progress.progress }}%</span>
            </div>
            <p>{{ progress.content || progress.title }}</p>
            <div v-if="progress.attachments?.length" class="goal-progress-timeline__files">
              <a v-for="attachment in progress.attachments" :key="attachment.url" :href="attachment.url" target="_blank" rel="noopener">
                {{ attachment.name }}
              </a>
            </div>
          </li>
        </ol>
        <p v-else class="goal-detail__empty">暂无进展记录</p>
      </section>

      <section id="goal-detail-info" class="goal-detail__card goal-detail__section">
        <h3>指标详情</h3>
        <div class="goal-detail__description">
          <span>指标描述</span>
          <p>{{ displayDescription || '暂未填写' }}</p>
        </div>
      </section>

      <section id="goal-detail-changes" class="goal-detail__card goal-detail__section">
        <h3>指标变更记录</h3>
        <ol v-if="detail.changeRecords.length" class="goal-change-list">
          <li v-for="record in detail.changeRecords" :key="record.id">
            <strong>{{ formatDate(record.createdAt) }}</strong>
            <p>{{ record.actorName || '系统' }} · {{ changeActionLabel(record.action) }}</p>
          </li>
        </ol>
        <p v-else class="goal-detail__empty">暂无指标变更记录</p>
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

.goal-detail__section-title button {
  border: 0;
  color: #8a95a8;
  background: transparent;
  cursor: pointer;
}

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
.goal-progress-timeline,
.goal-change-list {
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

.goal-progress-timeline li,
.goal-change-list li {
  position: relative;
  padding: 0 0 20px 22px;
  border-left: 1px dashed #cbd9ec;
}

.goal-progress-timeline li:last-child,
.goal-change-list li:last-child {
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

.goal-progress-timeline p,
.goal-change-list p {
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

.goal-detail__description span {
  margin-bottom: 5px;
  color: #98a2b4;
  font-size: 12px;
}

.goal-detail__description p {
  margin: 5px 0 0;
  color: #3a465c;
  line-height: 1.7;
  white-space: pre-wrap;
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
