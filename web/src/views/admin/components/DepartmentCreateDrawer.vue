<script setup lang="ts">
import { reactive, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { departmentsApi } from '@/api/departments.api';
import type { Department } from '@/types/api.types';

const props = defineProps<{ modelValue: boolean; parent: Department | null }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; submitted: [] }>();
const form = reactive({ name: '', saving: false });
watch(() => props.modelValue, (open) => { if (open) form.name = ''; });

async function submit() {
  if (!form.name.trim()) { ElMessage.warning('请输入部门名称'); return; }
  form.saving = true;
  try {
    await departmentsApi.create({ name: form.name.trim(), parentId: props.parent?.id ?? null, company: props.parent ? undefined : 'fuede' });
    ElMessage.success('已提交新增部门，HR 管理员审核后生效');
    emit('update:modelValue', false);
    emit('submitted');
  } finally { form.saving = false; }
}
</script>

<template>
  <el-drawer :model-value="modelValue" :title="parent ? '新增下级部门' : '新增一级部门'" size="min(520px, 100vw)" @update:model-value="emit('update:modelValue', $event)">
    <el-form label-position="top">
      <el-form-item label="上级部门"><el-input :model-value="parent?.fullPath || parent?.name || '一级部门'" disabled /></el-form-item>
      <el-form-item label="部门名称"><el-input v-model="form.name" maxlength="100" autofocus @keyup.enter="submit" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="emit('update:modelValue', false)">取消</el-button><el-button type="primary" :loading="form.saving" @click="submit">提交审核</el-button></template>
  </el-drawer>
</template>
