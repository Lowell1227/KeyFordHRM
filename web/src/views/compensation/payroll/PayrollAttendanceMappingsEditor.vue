<script setup lang="ts">
import { Plus, Delete } from '@element-plus/icons-vue';
import { attendanceTypeLabels, type AttendanceMappingDraft } from './payroll-attendance-mappings';
const props = defineProps<{ modelValue: AttendanceMappingDraft[]; errors: Record<string, string> }>();
const emit = defineEmits<{ 'update:modelValue': [AttendanceMappingDraft[]] }>();
function update(index: number, key: keyof AttendanceMappingDraft, value: string) {
  emit('update:modelValue', props.modelValue.map((row, i) => i === index ? { ...row, [key]: value, ...(key === 'type' && value !== 'overtime' ? { overtimeKind: '' } : {}) } : row));
}
</script>
<template>
  <section>
    <h3>钉钉假勤分类</h3>
    <div v-for="(row, index) in modelValue" :key="index" class="mapping-row">
      <el-form-item label="原类型标识" :error="errors[`${index}.key`]"><el-input :model-value="row.key" maxlength="166" @update:model-value="update(index, 'key', $event)" /></el-form-item>
      <el-form-item label="计薪类型" :error="errors[`${index}.type`]"><el-select :model-value="row.type" @update:model-value="update(index, 'type', $event)"><el-option v-for="(label, type) in attendanceTypeLabels" :key="type" :value="type" :label="label" /></el-select></el-form-item>
      <el-form-item v-if="row.type === 'overtime'" label="加班日类型" :error="errors[`${index}.overtimeKind`]"><el-select :model-value="row.overtimeKind" @update:model-value="update(index, 'overtimeKind', $event)"><el-option label="工作日" value="weekday" /><el-option label="休息日" value="restday" /><el-option label="节假日" value="holiday" /></el-select></el-form-item>
      <el-tooltip content="移除分类"><el-button :icon="Delete" aria-label="移除假勤分类" @click="emit('update:modelValue', modelValue.filter((_, i) => i !== index))" /></el-tooltip>
    </div>
    <el-form-item :error="errors.rows"><el-button :icon="Plus" :disabled="modelValue.length >= 100" @click="emit('update:modelValue', [...modelValue, { key: '', type: '', overtimeKind: '' }])">添加假勤分类</el-button></el-form-item>
  </section>
</template>
<style scoped>
h3 { font-size: 15px; margin: 22px 0 14px; }
.mapping-row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) auto; gap: 12px; align-items: start; }
.mapping-row > .el-button { margin-top: 30px; }
:deep(.el-select) { width: 100%; }
@media(max-width:768px) { .mapping-row { grid-template-columns: minmax(0, 1fr); gap: 0; border-bottom: 1px solid var(--el-border-color-lighter); margin-bottom: 12px; padding-bottom: 12px; } .mapping-row > .el-button { margin-top: 0; justify-self: end; } }
</style>
