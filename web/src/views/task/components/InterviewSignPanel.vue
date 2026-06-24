<script setup lang="ts">
import { computed } from 'vue';
import { formatDateTime } from '@/utils/date';

const props = defineProps<{
  role: 'manager' | 'employee';
  signedAt?: string | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'sign'): void;
}>();

const roleLabel = computed(() => (props.role === 'manager' ? '面谈人' : '员工'));
</script>

<template>
  <div class="interview-sign-panel">
    <span class="role-label">{{ roleLabel }}签字</span>
    <span v-if="signedAt" class="signed-at">已签 {{ formatDateTime(signedAt) }}</span>
    <el-button
      v-else
      type="primary"
      size="small"
      :disabled="disabled"
      @click="emit('sign')"
    >
      {{ role === 'manager' ? '主管签字' : '确认签字' }}
    </el-button>
    <!-- TODO(A3): 替换为共享签名组件 <SignaturePad v-model="signatureImage" /> -->
  </div>
</template>

<style scoped>
.interview-sign-panel {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}

.role-label {
  color: var(--el-text-color-regular);
}

.signed-at {
  color: var(--el-color-success);
}
</style>
