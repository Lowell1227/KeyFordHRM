<script setup lang="ts">
import { reactive, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { departmentsApi } from '@/api/departments.api';
import type { Department } from '@/types/api.types';

const props = defineProps<{ modelValue: boolean; parent: Department | null; departments: Department[] }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; submitted: [] }>();
const ROOT_PARENT = '__root__';
const form = reactive({ name: '', parentId: ROOT_PARENT, saving: false });
watch(() => props.modelValue, (open) => {
  if (open) {
    form.name = '';
    form.parentId = props.parent?.id ?? ROOT_PARENT;
  }
});

async function submit() {
  if (!form.name.trim()) { ElMessage.warning('请输入部门名称'); return; }
  form.saving = true;
  try {
    await departmentsApi.create({
      name: form.name.trim(),
      parentId: form.parentId === ROOT_PARENT ? null : form.parentId,
      company: form.parentId === ROOT_PARENT ? 'fuede' : undefined,
    });
    ElMessage.success('已提交新增部门，HR 管理员审核后生效');
    emit('update:modelValue', false);
    emit('submitted');
  } finally { form.saving = false; }
}
</script>

<template>
  <el-drawer :model-value="modelValue" title="新增部门" size="min(520px, 100vw)" @update:model-value="emit('update:modelValue', $event)">
    <el-form label-position="top">
      <el-form-item label="上级部门">
        <el-select v-model="form.parentId" filterable>
          <el-option label="无（一级部门）" :value="ROOT_PARENT" />
          <el-option v-for="item in departments" :key="item.id" :label="item.fullPath || item.name" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="部门名称"><el-input v-model="form.name" maxlength="100" autofocus @keyup.enter="submit" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="emit('update:modelValue', false)">取消</el-button><el-button type="primary" :loading="form.saving" @click="submit">提交审核</el-button></template>
  </el-drawer>
</template>
