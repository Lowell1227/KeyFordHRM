<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { employeeArchivesApi } from '@/api/employee-archives.api';
import { positionsApi, type PositionRecord } from '@/api/positions.api';
import UserSelect from '@/components/common/UserSelect.vue';
import type { Department } from '@/types/api.types';

const props = defineProps<{ modelValue: boolean; departments: Department[] }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; submitted: [] }>();
const saving = ref(false);
const positions = ref<PositionRecord[]>([]);
const form = reactive({
  employeeNo: '', name: '', phone: '', company: 'fuede', deptId: '', positionId: '',
  entryDate: '', effectiveFrom: '', employmentType: 'full_time', employeeStatus: 'probation',
  rosterManagerId: null as string | null, performanceManagerId: null as string | null,
});

function flatten(items: Department[]): Department[] {
  return items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
}

async function submit() {
  if (!form.employeeNo.trim() || !form.name.trim() || !form.deptId || !form.entryDate || !form.effectiveFrom) {
    ElMessage.warning('请填写工号、姓名、部门、入职日期和生效日期');
    return;
  }
  saving.value = true;
  try {
    await employeeArchivesApi.createEmployee({
      ...form,
      phone: form.phone.trim() || null,
      positionId: form.positionId || null,
      rosterManagerId: form.rosterManagerId,
      performanceManagerId: form.performanceManagerId,
    });
    ElMessage.success('已提交新增员工，HR 管理员审核后进入正式名册');
    emit('update:modelValue', false);
    emit('submitted');
  } finally { saving.value = false; }
}

onMounted(async () => { positions.value = await positionsApi.findAll(); });
</script>

<template>
  <el-drawer :model-value="modelValue" title="新增员工" size="min(720px, 100vw)" destroy-on-close @update:model-value="emit('update:modelValue', $event)">
    <el-form label-position="top" class="employee-create-form">
      <div class="form-grid">
        <el-form-item label="工号"><el-input v-model="form.employeeNo" /></el-form-item>
        <el-form-item label="姓名"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="手机号"><el-input v-model="form.phone" /></el-form-item>
        <el-form-item label="部门"><el-select v-model="form.deptId" filterable><el-option v-for="dept in flatten(departments)" :key="dept.id" :label="dept.fullPath || dept.name" :value="dept.id" /></el-select></el-form-item>
        <el-form-item label="岗位"><el-select v-model="form.positionId" filterable clearable><el-option v-for="position in positions" :key="position.id" :label="`${position.code} · ${position.name}`" :value="position.id" /></el-select></el-form-item>
        <el-form-item label="用工类型"><el-select v-model="form.employmentType"><el-option label="全职" value="full_time" /><el-option label="兼职" value="part_time" /><el-option label="返聘" value="rehire" /><el-option label="外部" value="external" /></el-select></el-form-item>
        <el-form-item label="入职日期"><el-date-picker v-model="form.entryDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="本次记录生效日期"><el-date-picker v-model="form.effectiveFrom" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="员工状态"><el-select v-model="form.employeeStatus"><el-option label="试用期" value="probation" /><el-option label="在职" value="active" /><el-option label="已离职" value="resigned" /></el-select></el-form-item>
        <el-form-item label="花名册直属主管"><UserSelect v-model="form.rosterManagerId" clearable /></el-form-item>
        <el-form-item label="绩效直属上级"><UserSelect v-model="form.performanceManagerId" clearable /></el-form-item>
      </div>
      <p class="form-help">可先保存不完整的主管关系；系统会提醒，审核人员可在通过前补充。</p>
    </el-form>
    <template #footer><el-button @click="emit('update:modelValue', false)">取消</el-button><el-button type="primary" :loading="saving" @click="submit">提交审核</el-button></template>
  </el-drawer>
</template>

<style scoped>
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
.form-grid :deep(.el-select), .form-grid :deep(.el-date-editor) { width: 100%; }
.form-help { margin: 0; color: #667085; font-size: 13px; }
@media (max-width: 640px) { .form-grid { grid-template-columns: 1fr; } }
</style>
