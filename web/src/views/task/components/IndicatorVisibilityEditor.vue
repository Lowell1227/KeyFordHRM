<script setup lang="ts">
import { computed } from 'vue';
import type { IndicatorVisibilityScope } from '@/types/enums';

export interface IndicatorVisibilitySelection {
  visibilityScope: IndicatorVisibilityScope;
  visibleDepartmentIds: string[];
  visibleUserIds: string[];
}

export interface VisibilityDepartmentOption {
  id: string;
  name: string;
}

export interface VisibilityUserOption {
  id: string;
  name: string;
  employeeNo?: string | null;
}

const props = withDefaults(
  defineProps<{
    modelValue: IndicatorVisibilitySelection;
    indicatorId: string;
    departments?: VisibilityDepartmentOption[];
    users?: VisibilityUserOption[];
    disabled?: boolean;
  }>(),
  {
    departments: () => [],
    users: () => [],
    disabled: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: IndicatorVisibilitySelection];
}>();

const scopeOptions: Array<{ value: IndicatorVisibilityScope; label: string }> = [
  { value: 'company', label: '全公司可见' },
  { value: 'department', label: '部门内可见' },
  { value: 'department_tree', label: '部门及下级可见' },
  { value: 'direct_reports', label: '直接下级可见' },
  { value: 'all_reports', label: '所有下级可见' },
  { value: 'supervisors', label: '仅上级可见' },
  { value: 'custom', label: '自定义范围' },
];

const isCustom = computed(() => props.modelValue.visibilityScope === 'custom');

function normalizeIds(ids: string[]): string[] {
  const normalized = new Map<string, string>();
  for (const rawId of ids) {
    const id = rawId.trim();
    if (!id) continue;
    const key = id.toLocaleLowerCase();
    if (!normalized.has(key)) normalized.set(key, id);
  }
  return [...normalized.values()];
}

function updateScope(scope: IndicatorVisibilityScope) {
  emit('update:modelValue', {
    visibilityScope: scope,
    visibleDepartmentIds: scope === 'custom'
      ? normalizeIds(props.modelValue.visibleDepartmentIds)
      : [],
    visibleUserIds: scope === 'custom'
      ? normalizeIds(props.modelValue.visibleUserIds)
      : [],
  });
}

function updateDepartments(ids: string[]) {
  emit('update:modelValue', {
    visibilityScope: props.modelValue.visibilityScope,
    visibleDepartmentIds: normalizeIds(ids),
    visibleUserIds: normalizeIds(props.modelValue.visibleUserIds),
  });
}

function updateUsers(ids: string[]) {
  emit('update:modelValue', {
    visibilityScope: props.modelValue.visibilityScope,
    visibleDepartmentIds: normalizeIds(props.modelValue.visibleDepartmentIds),
    visibleUserIds: normalizeIds(ids),
  });
}
</script>

<template>
  <div class="visibility-editor" @click.stop>
    <el-select
      :model-value="modelValue.visibilityScope"
      :data-testid="`indicator-visibility-${indicatorId}`"
      :aria-label="`指标 ${indicatorId} 可见范围`"
      :disabled="disabled"
      @update:model-value="updateScope"
    >
      <el-option
        v-for="option in scopeOptions"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </el-select>

    <div v-if="isCustom" class="visibility-editor__custom">
      <label>
        <span>部门</span>
        <el-select
          :model-value="modelValue.visibleDepartmentIds"
          data-testid="visibility-departments"
          aria-label="自定义可见部门"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          :disabled="disabled"
          @update:model-value="updateDepartments"
        >
          <el-option
            v-for="department in departments"
            :key="department.id"
            :label="department.name"
            :value="department.id"
          />
        </el-select>
        <small data-testid="visibility-department-count">
          已选 {{ modelValue.visibleDepartmentIds.length }} 个部门
        </small>
      </label>

      <label>
        <span>员工</span>
        <el-select
          :model-value="modelValue.visibleUserIds"
          data-testid="visibility-users"
          aria-label="自定义可见员工"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          :disabled="disabled"
          @update:model-value="updateUsers"
        >
          <el-option
            v-for="user in users"
            :key="user.id"
            :label="`${user.name}${user.employeeNo ? `（${user.employeeNo}）` : ''}`"
            :value="user.id"
          />
        </el-select>
        <small data-testid="visibility-user-count">
          已选 {{ modelValue.visibleUserIds.length }} 名员工
        </small>
      </label>
    </div>
  </div>
</template>

<style scoped>
.visibility-editor {
  min-width: 0;
}

.visibility-editor :deep(.el-select) {
  width: 100%;
}

.visibility-editor__custom {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #e8ebf0;
}

.visibility-editor__custom label {
  min-width: 0;
  display: grid;
  gap: 5px;
  color: #596579;
  font-size: 12px;
}

.visibility-editor__custom small {
  color: #778195;
  font-size: 11px;
}

@media (max-width: 620px) {
  .visibility-editor__custom {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
