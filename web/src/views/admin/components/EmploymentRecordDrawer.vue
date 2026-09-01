<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { employeeArchivesApi, type EmployeeArchive } from '@/api/employee-archives.api';
import { positionsApi, type PositionRecord } from '@/api/positions.api';
import UserSelect from '@/components/common/UserSelect.vue';
import type { Department } from '@/types/api.types';

const props = defineProps<{ modelValue: boolean; archive: EmployeeArchive | null; departments: Department[] }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; submitted: [] }>();
const positions = ref<PositionRecord[]>([]);
const saving = ref(false);
const form = reactive<Record<string, any>>({});
function flatten(items: Department[]): Department[] { return items.flatMap((item) => [item, ...flatten(item.children ?? [])]); }
function reset() {
  const archive = props.archive; const current = archive?.currentEmployment ?? archive?.employmentHistory[0];
  Object.assign(form, {
    effectiveFrom: '', effectiveTo: null, company: current?.company ?? archive?.dept?.company ?? 'fuede',
    deptId: current?.deptId ?? archive?.dept?.id ?? null, positionId: current?.positionId ?? null,
    directManagerId: archive?.rosterManager?.id ?? null, workLocation: current?.workLocation ?? null,
    employmentType: current?.employmentType ?? 'full_time', employeeStatus: archive?.status ?? 'active',
    entryDate: archive?.entryDate?.slice(0, 10) ?? null, plannedRegularDate: current?.plannedRegularDate?.slice(0, 10) ?? null,
    actualRegularDate: current?.actualRegularDate?.slice(0, 10) ?? null, leaveDate: current?.leaveDate?.slice(0, 10) ?? null,
    probationMonths: current?.probationMonths ?? null, changeType: 'transfer', reason: '',
  });
}
watch(() => props.modelValue, (open) => { if (open) reset(); });
async function submit() {
  if (!props.archive || !form.effectiveFrom || !form.deptId) { ElMessage.warning('请填写生效日期和部门'); return; }
  saving.value = true;
  try {
    await employeeArchivesApi.createEmployment(props.archive.id, { ...form, positionId: form.positionId || null });
    ElMessage.success('任职变更已提交审核；历史补录和未来生效记录都不会直接覆盖当前档案');
    emit('update:modelValue', false); emit('submitted');
  } finally { saving.value = false; }
}
onMounted(async () => { positions.value = await positionsApi.findAll(); });
</script>

<template>
  <el-drawer :model-value="modelValue" title="新增任职记录" size="min(720px, 100vw)" @update:model-value="emit('update:modelValue', $event)">
    <el-form label-position="top" class="employment-grid">
      <el-form-item label="变更类型"><el-select v-model="form.changeType"><el-option label="调动" value="transfer" /><el-option label="晋升" value="promotion" /><el-option label="上级变更" value="manager_change" /><el-option label="状态变更" value="status_change" /><el-option label="离职" value="resignation" /><el-option label="返聘" value="rehire" /><el-option label="历史补录" value="data_correction" /></el-select></el-form-item>
      <el-form-item label="生效日期"><el-date-picker v-model="form.effectiveFrom" type="date" value-format="YYYY-MM-DD" /></el-form-item>
      <el-form-item label="结束日期"><el-date-picker v-model="form.effectiveTo" type="date" value-format="YYYY-MM-DD" clearable /></el-form-item>
      <el-form-item label="部门"><el-select v-model="form.deptId" filterable><el-option v-for="dept in flatten(departments)" :key="dept.id" :label="dept.fullPath || dept.name" :value="dept.id" /></el-select></el-form-item>
      <el-form-item label="岗位"><el-select v-model="form.positionId" filterable clearable><el-option v-for="position in positions" :key="position.id" :label="`${position.code} · ${position.name}`" :value="position.id" /></el-select></el-form-item>
      <el-form-item label="花名册直属主管"><UserSelect v-model="form.directManagerId" :disabled-ids="archive ? [archive.id] : []" clearable /></el-form-item>
      <el-form-item label="员工状态"><el-select v-model="form.employeeStatus"><el-option label="在职" value="active" /><el-option label="试用期" value="probation" /><el-option label="已离职" value="resigned" /></el-select></el-form-item>
      <el-form-item label="用工类型"><el-select v-model="form.employmentType"><el-option label="全职" value="full_time" /><el-option label="兼职" value="part_time" /><el-option label="返聘" value="rehire" /><el-option label="外部" value="external" /></el-select></el-form-item>
      <el-form-item label="原因" class="span-2"><el-input v-model="form.reason" type="textarea" :rows="3" /></el-form-item>
    </el-form>
    <p class="employment-help">生效日期早于今天视为历史补录；晚于今天则审核后等待到期自动生效。时间重叠会提醒，但不阻断提交。</p>
    <template #footer><el-button @click="emit('update:modelValue', false)">取消</el-button><el-button type="primary" :loading="saving" @click="submit">提交审核</el-button></template>
  </el-drawer>
</template>

<style scoped>
.employment-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }.employment-grid :deep(.el-select), .employment-grid :deep(.el-date-editor) { width: 100%; }.span-2 { grid-column: span 2; }.employment-help { color: #667085; font-size: 13px; }
@media (max-width: 640px) { .employment-grid { grid-template-columns: 1fr; }.span-2 { grid-column: auto; } }
</style>
