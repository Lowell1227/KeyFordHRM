<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue';
import type { PayrollSubject } from '@/types/payroll.types';
defineProps<{ subjects: PayrollSubject[]; disabled?: boolean; hideMonth?: boolean }>();
const subject = defineModel<string>('subject', { required: true });
const month = defineModel<string>('month', { required: true });
defineEmits<{ refresh: [] }>();
</script>
<template>
  <div class="payroll-scope">
    <el-select v-model="subject" aria-label="用工主体" placeholder="选择用工主体" :disabled="disabled" class="subject-select">
      <el-option v-for="item in subjects" :key="item.id" :label="item.name" :value="item.id" />
    </el-select>
    <el-date-picker v-if="!hideMonth" v-model="month" type="month" value-format="YYYY-MM" format="YYYY年MM月" aria-label="工资归属月" :clearable="false" :disabled="disabled" />
    <el-tooltip content="刷新授权和数据"><el-button :icon="Refresh" aria-label="刷新" :disabled="disabled" @click="$emit('refresh')" /></el-tooltip>
    <slot />
  </div>
</template>
<style scoped>
.payroll-scope { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; min-width: 0; }
.subject-select { width: 260px; max-width: 100%; }
.payroll-scope :deep(.el-date-editor) { width: 180px; max-width: 100%; }
@media(max-width:768px) { .subject-select { width: 100%; } }
</style>
