<script setup lang="ts">
import { computed } from 'vue';
import type { ContractSubject } from '@/api/contract-subjects.api';
import ContractSubjectSelect from './ContractSubjectSelect.vue';

const props = defineProps<{
  modelValue?: string | null;
  snapshotName?: string | null;
  company?: string | null;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: string | null];
  'update:snapshotName': [value: string | null];
  'update:company': [value: string | null];
}>();
const legacyCompany = computed(() => {
  const names: Record<string, string> = { fuede: '孚德', fuede_sports: '孚德体育文化', beijing_fuede: '北京孚德', fansibao: '凡思堡' };
  return props.company ? names[props.company] || props.company : '';
});

function select(subject: ContractSubject | null) {
  if (subject && !subject.internalCompany) return;
  // Directory loading and snapshot hydration must never rewrite historical codes.
  emit('update:modelValue', subject?.id ?? null);
  emit('update:snapshotName', subject?.name ?? null);
  emit('update:company', subject?.internalCompany ?? null);
}
</script>

<template>
  <div class="employee-company-select">
    <ContractSubjectSelect :model-value="modelValue" :snapshot-name="snapshotName" :disabled="disabled" require-company-mapping placeholder="选择所属公司" @select="select" />
    <span v-if="!modelValue && !snapshotName && legacyCompany" class="legacy-company">{{ legacyCompany }} · 历史公司，尚未关联主体</span>
  </div>
</template>

<style scoped>
.employee-company-select { width: 100%; min-width: 0; display: grid; gap: 4px; }
.legacy-company { color: #667085; font-size: 12px; overflow-wrap: anywhere; line-height: 1.5; }
</style>
