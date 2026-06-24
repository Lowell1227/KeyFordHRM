<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  visible: boolean;
  title?: string;
  confirmText?: string;
}>();

const emit = defineEmits<{
  (e: 'confirm', reason: string): void;
  (e: 'cancel'): void;
  (e: 'update:visible', value: boolean): void;
}>();

const reason = ref('');
const loading = ref(false);

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      reason.value = '';
      loading.value = false;
    }
  },
);

function handleClose() {
  emit('update:visible', false);
  emit('cancel');
}

async function handleConfirm() {
  const text = reason.value.trim();
  if (!text) {
    return;
  }
  loading.value = true;
  try {
    emit('confirm', text);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="title || '退回指标'"
    width="520"
    :close-on-click-modal="false"
    @close="handleClose"
    @closed="reason = ''"
  >
    <el-form label-position="top">
      <el-form-item label="退回意见" required>
        <el-input
          v-model="reason"
          type="textarea"
          :rows="4"
          placeholder="请填写退回意见，便于主管调整指标"
          maxlength="1000"
          show-word-limit
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-button type="primary" :disabled="!reason.trim()" :loading="loading" @click="handleConfirm">
          {{ confirmText || '确认退回' }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
