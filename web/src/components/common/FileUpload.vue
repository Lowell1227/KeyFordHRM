<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { UploadFilled } from '@element-plus/icons-vue';
import type { Attachment } from '@/types/api.types';
import type { UploadFile, UploadRawFile } from 'element-plus';

const props = withDefaults(
  defineProps<{
    modelValue?: Attachment[];
    accept?: string;
    multiple?: boolean;
    disabled?: boolean;
    maxSize?: number; // MB
    maxCount?: number;
  }>(),
  {
    accept: '.jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx',
    multiple: true,
    maxSize: 20,
    maxCount: 10,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: Attachment[]): void;
  (e: 'change', value: Attachment[]): void;
  (e: 'upload', files: File[]): void;
}>();

const fileList = ref<Attachment[]>(props.modelValue ?? []);

function onFileChange(files: File[]) {
  const valid = files.filter((file) => {
    if (props.maxSize && file.size > props.maxSize * 1024 * 1024) {
      ElMessage.warning(`文件大小不能超过 ${props.maxSize}MB`);
      return false;
    }
    return true;
  });
  if (!valid.length) return;
  if (props.maxCount && fileList.value.length + valid.length > props.maxCount) {
    ElMessage.warning(`最多上传 ${props.maxCount} 个文件`);
    return;
  }
  emit('upload', valid);
}

function onRemove(index: number) {
  const next = [...fileList.value];
  next.splice(index, 1);
  fileList.value = next;
  emit('update:modelValue', next);
  emit('change', next);
}

function updateAttachments(attachments: Attachment[]) {
  fileList.value = attachments;
  emit('update:modelValue', attachments);
  emit('change', attachments);
}

function handleUpload(rawFile: UploadRawFile) {
  onFileChange([rawFile as File]);
  return false; // 阻止默认上传
}
</script>

<template>
  <div class="file-upload">
    <el-upload
      drag
      action="#"
      :auto-upload="false"
      :multiple="multiple"
      :disabled="disabled"
      :accept="accept"
      :show-file-list="false"
      :before-upload="handleUpload"
      @change="(file: UploadFile) => onFileChange([file.raw as File])"
    >
      <div class="file-upload__trigger">
        <el-icon><UploadFilled /></el-icon>
        <div class="file-upload__text">点击或拖拽上传文件</div>
        <div class="file-upload__tip">支持 {{ accept }}，单个不超过 {{ maxSize }}MB</div>
      </div>
    </el-upload>

    <ul v-if="fileList.length" class="file-upload__list">
      <li v-for="(file, idx) in fileList" :key="file.url" class="file-upload__item">
        <a :href="file.url" target="_blank" rel="noopener" class="file-upload__name">{{ file.name }}</a>
        <el-button
          v-if="!disabled"
          link
          type="danger"
          size="small"
          @click="onRemove(idx)"
        >
          删除
        </el-button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.file-upload__trigger {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  padding: 16px;
  text-align: center;
}

.file-upload__text {
  margin-top: 8px;
  color: var(--el-text-color-regular);
}

.file-upload__tip {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.file-upload__list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.file-upload__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  margin-bottom: 4px;
}

.file-upload__name {
  color: var(--el-color-primary);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
