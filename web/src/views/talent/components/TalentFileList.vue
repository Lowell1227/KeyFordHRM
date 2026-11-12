<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { talentPoolApi } from '@/api/talent-pool.api';
import { uploadApi } from '@/api/upload.api';
import type { TalentResumeFile } from '@/types/talent.types';
import { isImageFile } from '@/utils/image-compress';
import {
  TALENT_MAX_FILES,
  formatTalentFileSize,
  uploadAndBindTalentFile,
} from './talent-file-upload';

/**
 * 候选人简历文件列表（需求 §5.2/§5.3）。
 * 上传走受控通道：先 POST /storage/upload?purpose=talent-resume，再绑定到候选人；
 * 下载/预览走 /storage/download（后端校验人才库权限），前端不持有对象存储裸链。
 */

const props = withDefaults(defineProps<{
  candidateId: string;
  files: TalentResumeFile[];
  editable?: boolean;
}>(), {
  editable: false,
});

const emit = defineEmits<{
  changed: [];
}>();

const uploading = ref(false);
const previewUrl = ref('');
const previewName = ref('');
const previewVisible = ref(false);

function isImageRecord(file: TalentResumeFile): boolean {
  return file.mimeType.startsWith('image/');
}

async function handleFiles(fileList: FileList | null) {
  const picked = fileList ? Array.from(fileList) : [];
  if (!picked.length) return;
  const room = TALENT_MAX_FILES - props.files.length;
  if (room <= 0 || picked.length > room) {
    ElMessage.warning(`每个候选人最多 ${TALENT_MAX_FILES} 个简历文件，当前已有 ${props.files.length} 个`);
    return;
  }
  uploading.value = true;
  try {
    for (const file of picked) {
      await uploadAndBindTalentFile(props.candidateId, file);
    }
    emit('changed');
  } finally {
    uploading.value = false;
  }
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement;
  void handleFiles(input.files);
  input.value = '';
}

async function removeFile(file: TalentResumeFile) {
  await ElMessageBox.confirm(`移除「${file.fileName}」？对象存储中的文件保留，仅解除关联。`, '移除简历文件', {
    confirmButtonText: '移除',
    cancelButtonText: '取消',
    type: 'warning',
  });
  await talentPoolApi.unbindFile(props.candidateId, file.id);
  ElMessage.success('已移除');
  emit('changed');
}

function downloadUrl(file: TalentResumeFile): string {
  return `/storage/download?key=${encodeURIComponent(file.objectKey)}`;
}

async function preview(file: TalentResumeFile) {
  const blob = await uploadApi.download(downloadUrl(file));
  const url = URL.createObjectURL(blob);
  if (isImageRecord(file)) {
    previewUrl.value = url;
    previewName.value = file.fileName;
    previewVisible.value = true;
  } else {
    window.open(url, '_blank');
  }
}

async function download(file: TalentResumeFile) {
  const blob = await uploadApi.download(downloadUrl(file));
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="talent-file-list">
    <div v-for="file in files" :key="file.id" class="talent-file-list__item">
      <el-icon class="talent-file-list__icon" :class="{ 'is-image': isImageRecord(file) }">
        <component :is="isImageRecord(file) ? 'Picture' : 'Document'" />
      </el-icon>
      <div class="talent-file-list__meta">
        <span class="talent-file-list__name" :title="file.fileName">{{ file.fileName }}</span>
        <span class="talent-file-list__size">{{ formatTalentFileSize(file.fileSize) }}</span>
      </div>
      <div class="talent-file-list__actions">
        <el-button link type="primary" @click="preview(file)">预览</el-button>
        <el-button link type="primary" @click="download(file)">下载</el-button>
        <el-button v-if="editable" link type="danger" @click="removeFile(file)">删除</el-button>
      </div>
    </div>
    <el-empty v-if="!files.length" description="还没有简历文件" :image-size="60" />
    <div v-if="editable" class="talent-file-list__upload">
      <input id="talent-file-input" type="file" class="talent-file-list__input" multiple
        accept=".pdf,.doc,.docx,image/*" @change="onPick" />
      <input id="talent-camera-input" type="file" class="talent-file-list__input" accept="image/*" capture="environment"
        @change="onPick" />
      <label for="talent-file-input" class="el-button el-button--default talent-file-list__pick">
        <el-icon><Plus /></el-icon><span>添加文件</span>
      </label>
      <label for="talent-camera-input" class="el-button el-button--primary talent-file-list__pick is-camera"
        :class="{ 'is-disabled': uploading }">
        <el-icon><Camera /></el-icon><span>拍照上传</span>
      </label>
      <span class="talent-file-list__hint">PDF/DOC/DOCX/JPG/PNG，单个 ≤10MB，最多 {{ TALENT_MAX_FILES }} 个；照片自动压缩后上传</span>
    </div>
    <el-dialog v-model="previewVisible" :title="previewName" append-to-body class="talent-file-preview-dialog">
      <img v-if="previewUrl" :src="previewUrl" class="talent-file-list__preview-image" :alt="previewName" />
    </el-dialog>
  </div>
</template>

<style scoped>
.talent-file-list {
  display: grid;
  gap: 8px;
}
.talent-file-list__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}
.talent-file-list__icon {
  flex: 0 0 auto;
  font-size: 20px;
  color: var(--el-color-primary);
}
.talent-file-list__icon.is-image { color: var(--el-color-success); }
.talent-file-list__meta {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.talent-file-list__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.talent-file-list__size {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.talent-file-list__actions {
  flex: 0 0 auto;
}
.talent-file-list__upload {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.talent-file-list__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
}
.talent-file-list__pick {
  cursor: pointer;
  margin-left: 0;
}
.talent-file-list__pick.is-camera.is-disabled {
  opacity: 0.6;
  pointer-events: none;
}
.talent-file-list__hint {
  flex-basis: 100%;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.talent-file-list__preview-image {
  max-width: 100%;
  display: block;
  margin: 0 auto;
}
</style>
