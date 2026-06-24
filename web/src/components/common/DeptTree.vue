<script setup lang="ts">
import { computed } from 'vue';
import type { Department } from '@/types/api.types';

const props = withDefaults(
  defineProps<{
    departments: Department[];
    modelValue?: string | string[];
    multiple?: boolean;
    checkStrictly?: boolean;
    placeholder?: string;
    disabled?: boolean;
    clearable?: boolean;
    filterable?: boolean;
  }>(),
  {
    placeholder: '请选择部门',
    clearable: true,
    filterable: true,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | string[]): void;
  (e: 'change', value: string | string[]): void;
}>();

const treeData = computed(() => buildTree(props.departments));

const selected = computed({
  get: () => props.modelValue ?? (props.multiple ? [] : ''),
  set: (val) => emit('update:modelValue', val),
});

function buildTree(depts: Department[]): Department[] {
  const map = new Map<string, Department>();
  const roots: Department[] = [];
  for (const d of depts) {
    map.set(d.id, { ...d, children: [] });
  }
  for (const d of map.values()) {
    if (d.parentId && map.has(d.parentId)) {
      const parent = map.get(d.parentId)!;
      parent.children = parent.children ?? [];
      parent.children.push(d);
    } else {
      roots.push(d);
    }
  }
  return roots;
}

function onChange(val: string | string[]) {
  emit('update:modelValue', val);
  emit('change', val);
}

function defaultProps() {
  return {
    label: 'name',
    children: 'children',
    disabled: 'isActive',
  };
}
</script>

<template>
  <el-tree-select
    v-model="selected"
    :data="treeData"
    :props="defaultProps()"
    node-key="id"
    :multiple="multiple"
    :check-strictly="checkStrictly"
    :placeholder="placeholder"
    :disabled="disabled"
    :clearable="clearable"
    :filterable="filterable"
    :render-after-expand="false"
    @change="onChange"
  />
</template>

<style scoped>
:deep(.el-tree-select__popper) {
  max-height: 320px;
}
</style>
