<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { periodReviewsApi } from '@/api/period-reviews.api';
import type { PeriodReviewAttachment } from '@/types/api.types';

const props = defineProps<{
  periodId: string;
  attachments: PeriodReviewAttachment[];
  editable: boolean;
}>();
const emit = defineEmits<{
  'update:attachments': [attachments: PeriodReviewAttachment[]];
  'busy-change': [busy: boolean];
}>();

const input = ref<HTMLInputElement>();
const busy = ref(false);
const previewUrls = reactive<Record<string, string>>({});
let previewSequence = 0;
const acceptedExtensions = new Set(['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx', 'xls', 'xlsx']);
const remainingCount = computed(() => Math.max(0, 10 - props.attachments.length));

function isImage(attachment: PeriodReviewAttachment): boolean {
  return attachment.mimeType === 'image/jpeg' || attachment.mimeType === 'image/png';
}

function setBusy(value: boolean) {
  busy.value = value;
  emit('busy-change', value);
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function revokePreview(id: string) {
  const url = previewUrls[id];
  if (!url) return;
  URL.revokeObjectURL(url);
  delete previewUrls[id];
}

async function loadPreviews() {
  const sequence = ++previewSequence;
  const imageIds = new Set(props.attachments.filter(isImage).map((item) => item.id));
  Object.keys(previewUrls).filter((id) => !imageIds.has(id)).forEach(revokePreview);
  for (const attachment of props.attachments) {
    if (!isImage(attachment) || previewUrls[attachment.id]) continue;
    try {
      const blob = await periodReviewsApi.downloadAttachment(props.periodId, attachment.id);
      if (sequence !== previewSequence) continue;
      previewUrls[attachment.id] = URL.createObjectURL(blob);
    } catch {
      // The filename remains available when a thumbnail cannot be loaded.
    }
  }
}

function validateFile(file: File): string | null {
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  if (!acceptedExtensions.has(extension)) return '仅支持 JPG、PNG、PDF、Word、Excel 文件';
  if (file.size > 20 * 1024 * 1024) return '单个附件不能超过 20MB';
  return null;
}

async function selectFiles(event: Event) {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files ?? []);
  target.value = '';
  if (!files.length || busy.value || !props.editable) return;
  if (files.length > remainingCount.value) {
    ElMessage.warning(`本月最多上传 10 个附件，还可上传 ${remainingCount.value} 个`);
    return;
  }
  const invalid = files.map(validateFile).find(Boolean);
  if (invalid) {
    ElMessage.warning(invalid);
    return;
  }
  setBusy(true);
  try {
    const next = [...props.attachments];
    for (const file of files) {
      next.push(await periodReviewsApi.uploadEmployeeAttachment(props.periodId, file));
      emit('update:attachments', [...next]);
    }
    ElMessage.success(files.length > 1 ? `${files.length} 个附件已上传` : '附件已上传');
  } finally {
    setBusy(false);
  }
}

async function removeAttachment(attachment: PeriodReviewAttachment) {
  if (!props.editable || busy.value) return;
  try {
    await ElMessageBox.confirm(
      `删除“${attachment.name}”后将无法在本月自评中查看。`,
      '删除附件',
      { type: 'warning', confirmButtonText: '删除附件', cancelButtonText: '保留附件' },
    );
  } catch {
    return;
  }
  setBusy(true);
  try {
    const remaining = await periodReviewsApi.deleteEmployeeAttachment(props.periodId, attachment.id);
    revokePreview(attachment.id);
    emit('update:attachments', remaining);
    ElMessage.success('附件已删除');
  } finally {
    setBusy(false);
  }
}

async function downloadAttachment(attachment: PeriodReviewAttachment) {
  try {
    const blob = await periodReviewsApi.downloadAttachment(props.periodId, attachment.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch {
    ElMessage.error('附件下载失败，请稍后重试');
  }
}

watch(
  () => [props.periodId, ...props.attachments.map((attachment) => `${attachment.id}:${attachment.mimeType}`)],
  () => { void loadPreviews(); },
  { immediate: true },
);

onBeforeUnmount(() => {
  previewSequence += 1;
  Object.keys(previewUrls).forEach(revokePreview);
});
</script>

<template>
  <section class="period-attachments" data-testid="period-review-attachments">
    <header>
      <div>
        <h3>本月工作产出附件（选填）</h3>
        <p>上传主管可能不了解的工作成果。支持 JPG、PNG、PDF、Word、Excel，最多 10 个，单个不超过 20MB。</p>
      </div>
      <div v-if="editable" class="period-attachments__upload">
        <input
          ref="input"
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx"
          aria-label="选择月度自评附件"
          @change="selectFiles"
        >
        <el-button
          :loading="busy"
          :disabled="busy || remainingCount === 0"
          @click="input?.click()"
        >上传附件</el-button>
        <span>{{ attachments.length }}/10</span>
      </div>
    </header>

    <div v-if="attachments.length" class="period-attachments__list">
      <article v-for="attachment in attachments" :key="attachment.id" class="period-attachments__item">
        <el-image
          v-if="isImage(attachment) && previewUrls[attachment.id]"
          class="period-attachments__thumbnail"
          :src="previewUrls[attachment.id]"
          :preview-src-list="[previewUrls[attachment.id]]"
          :alt="attachment.name"
          fit="cover"
          preview-teleported
        />
        <button
          v-else
          type="button"
          class="period-attachments__file-mark"
          :aria-label="`下载 ${attachment.name}`"
          @click="downloadAttachment(attachment)"
        >文件</button>
        <div class="period-attachments__meta">
          <button type="button" @click="downloadAttachment(attachment)">{{ attachment.name }}</button>
          <span>{{ formatSize(attachment.size) }}</span>
        </div>
        <el-button
          v-if="editable"
          text
          type="danger"
          :disabled="busy"
          :aria-label="`删除 ${attachment.name}`"
          @click="removeAttachment(attachment)"
        >删除</el-button>
      </article>
    </div>
    <div v-else class="period-attachments__empty">暂无附件</div>
  </section>
</template>

<style scoped>
.period-attachments { min-width: 0; overflow: hidden; border: 1px solid #e5eaf2; border-radius: 10px; background: #fff; }
.period-attachments > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 14px 15px; border-bottom: 1px solid #edf0f5; }
.period-attachments h3, .period-attachments p { margin: 0; }
.period-attachments h3 { color: #293449; font-size: 14px; }
.period-attachments p { margin-top: 5px; color: #8993a5; font-size: 11px; line-height: 1.6; }
.period-attachments__upload { display: flex; flex: none; align-items: center; gap: 8px; }
.period-attachments__upload input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
.period-attachments__upload span { color: #8993a5; font-size: 11px; }
.period-attachments__list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 12px 15px 15px; }
.period-attachments__item { min-width: 0; display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 8px; border: 1px solid #edf0f5; border-radius: 8px; background: #fafbfc; }
.period-attachments__thumbnail, .period-attachments__file-mark { width: 48px; height: 48px; border-radius: 6px; }
.period-attachments__thumbnail { display: block; cursor: zoom-in; }
.period-attachments__file-mark { border: 0; background: #eef2ff; color: #586fd5; font-size: 11px; cursor: pointer; }
.period-attachments__meta { min-width: 0; display: grid; gap: 4px; }
.period-attachments__meta button { min-width: 0; overflow: hidden; padding: 0; border: 0; background: transparent; color: #354156; font-size: 12px; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.period-attachments__meta span { color: #98a1b0; font-size: 10px; }
.period-attachments__empty { padding: 15px; color: #a0a8b5; font-size: 12px; text-align: center; }
@media (max-width: 767px) {
  .period-attachments > header { align-items: stretch; flex-direction: column; padding: 12px; }
  .period-attachments__upload { justify-content: space-between; }
  .period-attachments__list { grid-template-columns: minmax(0, 1fr); padding: 10px 12px 12px; }
  .period-attachments__item { grid-template-columns: 44px minmax(0, 1fr) auto; }
  .period-attachments__thumbnail, .period-attachments__file-mark { width: 44px; height: 44px; }
}
</style>
