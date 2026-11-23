<script setup lang="ts">
import { computed } from 'vue';
import type { PayrollEmployee, PayrollPerformanceMapping } from '@/types/payroll.types';

const props = defineProps<{
  modelValue: PayrollPerformanceMapping;
  employees: PayrollEmployee[];
  month: string;
  loading?: boolean;
  loadError?: string;
  errors: Record<string, string>;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: PayrollPerformanceMapping]; retry: [] }>();
const people = computed(() => [
  ...props.employees,
  ...Object.keys(props.modelValue.manualAmounts ?? {}).filter(id => !props.employees.some(person => person.id === id)
    && props.modelValue.manualAmounts?.[id]?.trim()).map(id => ({ id, name: '不在本月范围的员工', employeeNo: '' })),
]);
function amount(id: string, value: string) {
  emit('update:modelValue', { ...props.modelValue, manualAmounts: { ...props.modelValue.manualAmounts, [id]: value } });
}
</script>
<template>
  <section class="manual-performance" data-testid="payroll-manual-performance">
    <p class="amount-note">填写当月确认金额，留空为待确认；不按月中入离职自动折算。</p>
    <el-form-item label="绩效工资确认依据" :error="errors.evidenceRef">
      <el-input :model-value="modelValue.evidenceRef" maxlength="200" @update:model-value="emit('update:modelValue', { ...modelValue, evidenceRef: $event })" />
    </el-form-item>
    <p v-if="!month" class="amount-note">请选择归属月</p>
    <p v-else-if="loading" role="status" class="amount-note">正在读取本月人员…</p>
    <el-alert v-else-if="loadError" :title="loadError" type="error" :closable="false">
      <el-button link type="primary" @click="emit('retry')">重新读取人员</el-button>
    </el-alert>
    <template v-else>
      <div class="amount-grid">
        <el-form-item v-for="person in people" :key="person.id" :label="`${person.name}${person.employeeNo ? ` · ${person.employeeNo}` : ''} 绩效工资金额`" :error="errors[`manualAmounts.${person.id}`]">
          <el-input :model-value="modelValue.manualAmounts?.[person.id] ?? ''" inputmode="decimal" placeholder="待确认" clearable
            :data-testid="`payroll-manual-amount-${person.id}`" @update:model-value="amount(person.id, $event)"><template #suffix>元</template></el-input>
        </el-form-item>
      </div>
      <p v-if="!people.length" class="amount-note">该主体本月暂无有效人员</p>
    </template>
    <p v-if="errors.people" class="people-error" role="alert">{{ errors.people }}</p>
  </section>
</template>
<style scoped>
.manual-performance { min-width: 0; }
.amount-note { margin: 0 0 14px; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
.amount-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
.amount-grid :deep(.el-form-item__label) { height: auto; line-height: 1.5; overflow-wrap: anywhere; }
.people-error { color: var(--el-color-danger); font-size: 12px; }
@media (max-width: 768px) { .amount-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
