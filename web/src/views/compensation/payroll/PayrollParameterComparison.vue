<script setup lang="ts">
import { computed } from 'vue';
import type { PayrollParameterRelease } from '@/types/payroll.types';
import { parameterChanges, payrollTracePerson } from './payroll-workflow-presentation';
const props = defineProps<{ release: Pick<PayrollParameterRelease, 'kind' | 'snapshot' | 'previousParameterId' | 'previousSnapshot' | 'comparisonUnavailable' | 'scopeEmployees' | 'manualEmployees'>; currentOnly?: boolean }>();
const people = computed(() => [...(props.release.scopeEmployees ?? []), ...(props.release.manualEmployees ?? [])]);
const rows = computed(() => {
  const changes = parameterChanges(props.release, id => {
    const person = people.value.find(person => person.id === id);
    return person ? `${person.name}${person.employeeNo ? ` · ${person.employeeNo}` : ''}` : payrollTracePerson(id);
  });
  return props.currentOnly ? changes.filter(row => !['发薪人员 · 新增', '发薪人员 · 移除'].includes(row.label)) : changes;
});
</script>
<template>
  <section class="parameter-comparison" :class="{ 'current-only': currentOnly }" data-testid="payroll-parameter-comparison">
    <h4>{{ currentOnly ? '版本内容' : '原值 → 本次提交' }}</h4>
    <p v-if="!currentOnly && release.previousParameterId && !release.previousSnapshot" role="status">{{ release.comparisonUnavailable || '原值未提供，暂不能核对与上一已发布版本的差异。' }}</p>
    <div class="comparison-head" aria-hidden="true"><span>{{ currentOnly ? '项目' : '审核项目' }}</span><span v-if="!currentOnly">原值</span><span>{{ currentOnly ? '本版内容' : '本次提交' }}</span></div>
    <dl class="comparison-list"><div v-for="row in rows" :key="row.label" class="comparison-row" :class="{ changed: row.changed }"><dt>{{ row.label }}<small v-if="!currentOnly && row.changed && release.previousSnapshot">已变更</small></dt><dd v-if="!currentOnly"><small>原值</small>{{ row.before }}</dd><dd><small>{{ currentOnly ? '本版内容' : '本次提交' }}</small>{{ row.after }}</dd></div></dl>
  </section>
</template>
<style scoped>
h4 {font-size:15px;margin:18px 0 10px;} p {font-size:13px;color:var(--el-color-warning-dark-2);}
.parameter-comparison {min-width:0;} .comparison-head,.comparison-row {display:grid;grid-template-columns:minmax(0,1fr) repeat(2,minmax(0,1.2fr));gap:12px;padding:10px 0;border-bottom:1px solid var(--el-border-color-lighter);}
.comparison-head {font-size:12px;color:var(--el-text-color-secondary);} .comparison-list {margin:0;font-size:13px;}
.current-only .comparison-head,.current-only .comparison-row {grid-template-columns:minmax(0,1fr) minmax(0,2fr);}
dt,dd {margin:0;overflow-wrap:anywhere;white-space:pre-wrap;line-height:1.6;} dt small {display:block;color:var(--el-color-warning-dark-2);} dd small {display:none;} .changed dd:last-child {font-weight:500;}
@media(max-width:768px){.comparison-head{display:none;}.comparison-row{grid-template-columns:repeat(2,minmax(0,1fr));}dt{grid-column:1 / -1;}dd small{display:block;color:var(--el-text-color-secondary);font-size:12px;}}
</style>
