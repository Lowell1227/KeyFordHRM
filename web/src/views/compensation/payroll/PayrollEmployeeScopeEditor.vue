<script setup lang="ts">
import { computed } from 'vue';
import type { PayrollEmployee, PayrollRuleConfig } from '@/types/payroll.types';
const props = defineProps<{
  modelValue: PayrollRuleConfig['employeeScope']; employees: PayrollEmployee[];
  loading: boolean; loadError: string; errors: Record<string, string>;
}>();
const emit = defineEmits<{ 'update:modelValue': [NonNullable<PayrollRuleConfig['employeeScope']>]; retry: [] }>();
const selected = computed(() => props.modelValue?.employeeIds ?? []);
const evidence = computed(() => props.modelValue?.evidenceRef ?? '');
function select(employeeIds: string[]) { emit('update:modelValue', { employeeIds, evidenceRef: evidence.value }); }
function updateEvidence(evidenceRef: string) { emit('update:modelValue', { employeeIds: [...selected.value], evidenceRef }); }
</script>
<template>
  <section>
    <h3>发薪人员</h3>
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false"><el-button link type="primary" @click="emit('retry')">重新读取</el-button></el-alert>
    <el-form-item label="本主体发薪人员" :error="errors.employeeIds">
      <el-select :model-value="selected" multiple filterable :loading="loading" :disabled="loading || !!loadError" placeholder="请选择已确认的发薪人员" @update:model-value="select">
        <el-option v-for="person in employees" :key="person.id" :value="person.id" :label="`${person.name} ${person.employeeNo ?? ''}`" />
      </el-select>
    </el-form-item>
    <el-form-item label="发薪归属确认依据" :error="errors.evidenceRef">
      <el-input :model-value="evidence" type="textarea" :rows="2" maxlength="200" @update:model-value="updateEvidence" />
    </el-form-item>
  </section>
</template>
<style scoped>
h3 { font-size: 15px; margin: 22px 0 14px; }
:deep(.el-select) { width: 100%; }
.el-alert { margin-bottom: 12px; }
</style>
