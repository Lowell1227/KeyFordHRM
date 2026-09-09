<script setup lang="ts">
import { computed } from 'vue';
import type { AssessmentCycle, Department } from '@/types/api.types';

const props = withDefaults(defineProps<{
  cycles: AssessmentCycle[];
  departments: Department[];
  cycleId: string;
  deptId: string;
  keyword: string;
  cycleTestId?: string;
  loading?: boolean;
  disabled?: boolean;
}>(), {
  loading: false,
  disabled: false,
});

const emit = defineEmits<{
  'update:cycleId': [value: string];
  'update:deptId': [value: string];
  'update:keyword': [value: string];
  search: [];
  reset: [];
}>();

interface DepartmentOption { id: string; label: string }
const departmentOptions = computed(() => {
  const options: DepartmentOption[] = [];
  const visit = (items: Department[], depth = 0) => {
    items.forEach((item) => {
      options.push({ id: item.id, label: `${'　'.repeat(depth)}${item.name}` });
      if (item.children?.length) visit(item.children, depth + 1);
    });
  };
  visit(props.departments);
  return options;
});
</script>

<template>
  <section class="performance-record-filters" aria-label="查询条件">
    <div class="performance-record-filters__field" data-testid="performance-cycle-filter">
      <el-select
        :data-testid="cycleTestId"
        aria-label="绩效周期计划"
        :model-value="cycleId"
        :disabled="disabled || cycles.length === 0"
        :placeholder="cycles.length ? '选择绩效周期计划' : '暂无绩效周期计划'"
        @update:model-value="emit('update:cycleId', String($event ?? ''))"
      >
        <el-option v-if="cycles.length === 0" label="暂无绩效周期计划" value="" disabled />
        <el-option v-for="cycle in cycles" :key="cycle.id" :label="cycle.name" :value="cycle.id" />
      </el-select>
    </div>
    <div class="performance-record-filters__field">
      <el-select
        data-testid="performance-department-filter"
        aria-label="部门"
        :model-value="deptId"
        clearable
        filterable
        placeholder="全部部门"
        :disabled="disabled"
        @update:model-value="emit('update:deptId', String($event ?? ''))"
      >
        <el-option v-for="department in departmentOptions" :key="department.id" :label="department.label" :value="department.id" />
      </el-select>
    </div>
    <div class="performance-record-filters__field">
      <el-input
        data-testid="performance-employee-filter"
        aria-label="员工姓名或工号"
        :model-value="keyword"
        clearable
        placeholder="输入员工姓名或工号"
        :disabled="disabled"
        @update:model-value="emit('update:keyword', String($event ?? ''))"
        @keyup.enter="emit('search')"
      />
    </div>
    <slot />
    <div class="performance-record-filters__actions">
      <el-button type="primary" :loading="loading" :disabled="disabled" @click="emit('search')">查询</el-button>
      <el-button :disabled="disabled" @click="emit('reset')">重置</el-button>
    </div>
  </section>
</template>

<style scoped>
.performance-record-filters {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  min-width: 0;
}
.performance-record-filters__field {
  min-width: 0;
}
.performance-record-filters__field :deep(.el-select),
.performance-record-filters__field :deep(.el-input) { width: 220px; }
.performance-record-filters__field:first-child :deep(.el-select) { width: 260px; }
.performance-record-filters__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 1px;
}
.performance-record-filters__actions :deep(.el-button + .el-button) { margin-left: 0; }
.performance-record-filters :deep(.performance-record-filter-extra) { min-width: 0; }
.performance-record-filters :deep(.performance-record-filter-extra .el-select) { width: 180px; }
@media (max-width: 768px) {
  .performance-record-filters { display: grid; grid-template-columns: minmax(0, 1fr); width: 100%; gap: 10px; }
  .performance-record-filters__field :deep(.el-select),
  .performance-record-filters__field :deep(.el-input),
  .performance-record-filters__field:first-child :deep(.el-select) { width: 100%; }
  .performance-record-filters__actions { display: grid; grid-template-columns: 1fr 1fr; }
  .performance-record-filters__actions :deep(.el-button) { width: 100%; }
  .performance-record-filters :deep(.performance-record-filter-extra .el-select) { width: 100%; }
}
</style>
