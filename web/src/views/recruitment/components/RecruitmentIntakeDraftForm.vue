<script setup lang="ts">
import type { TalentCandidateInput } from '@/types/talent.types';
import { ref, watch } from 'vue';
import PersonnelReferenceSelect from '@/components/common/PersonnelReferenceSelect.vue';
const props = defineProps<{ modelValue: TalentCandidateInput; disabled?: boolean; errors?: Record<string, string> }>();
const emit = defineEmits<{ 'update:modelValue': [value: TalentCandidateInput]; 'check-phone': [] }>();
const local = ref<TalentCandidateInput>({ ...props.modelValue });
watch(() => props.modelValue, value => { local.value = { ...value }; }, { deep: true, flush: 'sync' });
function update(field: keyof TalentCandidateInput, value: unknown) {
  local.value = { ...local.value, ...(field === 'birthYear' && value !== local.value.birthYear ? { birthMonth: null } : {}), [field]: value };
  emit('update:modelValue', { ...local.value });
}
</script>

<template>
  <el-form label-position="top" :disabled="disabled" class="intake-draft-form" @submit.prevent>
    <div class="draft-grid">
      <el-form-item label="姓名" required :error="errors?.name"><el-input :model-value="modelValue.name" maxlength="50" aria-label="候选人姓名" @update:model-value="update('name', $event)" /></el-form-item>
      <el-form-item label="手机号" required :error="errors?.phone"><el-input :model-value="modelValue.phone" maxlength="11" inputmode="tel" aria-label="候选人手机号" @update:model-value="update('phone', $event)" @blur="emit('check-phone')" /></el-form-item>
      <el-form-item label="邮箱" :error="errors?.email"><el-input :model-value="modelValue.email" maxlength="100" aria-label="候选人邮箱" @update:model-value="update('email', $event)" /></el-form-item>
      <el-form-item label="性别"><el-select :model-value="modelValue.gender || 'unknown'" aria-label="候选人性别" @update:model-value="update('gender', $event)"><el-option label="未提供" value="unknown" /><el-option label="男" value="male" /><el-option label="女" value="female" /></el-select></el-form-item>
      <el-form-item label="出生年" :error="errors?.birthYear"><el-input-number :model-value="modelValue.birthYear ?? undefined" :min="1900" :max="new Date().getFullYear()" :precision="0" aria-label="出生年" @update:model-value="update('birthYear', $event)" /></el-form-item>
      <el-form-item label="出生月" :error="errors?.birthMonth"><el-select :model-value="modelValue.birthMonth" clearable aria-label="出生月" @update:model-value="update('birthMonth', $event ?? null)"><el-option v-for="month in 12" :key="month" :label="`${month}月`" :value="month" /></el-select></el-form-item>
      <el-form-item label="简历注明年龄" :error="errors?.reportedAge"><el-input-number :model-value="modelValue.reportedAge ?? undefined" :min="0" :max="150" :precision="0" aria-label="简历注明年龄" @update:model-value="update('reportedAge', $event)" /></el-form-item>
      <el-form-item label="工作年限" :error="errors?.yearsOfExperience"><el-input-number :model-value="modelValue.yearsOfExperience ?? undefined" :min="0" :max="60" :precision="0" aria-label="工作年限" @update:model-value="update('yearsOfExperience', $event)" /></el-form-item>
      <el-form-item label="目前公司" :error="errors?.currentCompany"><el-input :model-value="modelValue.currentCompany" maxlength="150" @update:model-value="update('currentCompany', $event)" /></el-form-item>
      <el-form-item label="目前岗位" :error="errors?.currentPosition"><el-input :model-value="modelValue.currentPosition" maxlength="100" @update:model-value="update('currentPosition', $event)" /></el-form-item>
      <el-form-item label="学历" :error="errors?.education"><PersonnelReferenceSelect :model-value="modelValue.education" :reference-id="modelValue.educationReferenceDataId" :disabled="disabled" kind="education" @update:model-value="update('education', $event)" @update:reference-id="update('educationReferenceDataId', $event)" /></el-form-item>
      <el-form-item label="专业" :error="errors?.major"><el-input :model-value="modelValue.major" maxlength="150" aria-label="专业" @update:model-value="update('major', $event)" /></el-form-item>
      <el-form-item label="意向岗位" :error="errors?.appliedPosition"><el-input :model-value="modelValue.appliedPosition" maxlength="100" @update:model-value="update('appliedPosition', $event)" /></el-form-item>
      <el-form-item label="意向城市" :error="errors?.expectCity"><el-input :model-value="modelValue.expectCity" maxlength="100" @update:model-value="update('expectCity', $event)" /></el-form-item>
      <el-form-item label="学校" :error="errors?.school"><el-input :model-value="modelValue.school" maxlength="200" @update:model-value="update('school', $event)" /></el-form-item>
      <el-form-item label="期望薪资下限（元/月）" :error="errors?.expectSalaryMinYuan"><el-input-number :model-value="modelValue.expectSalaryMinYuan ?? undefined" :min="0" :max="2147483647" :precision="0" :controls="false" aria-label="期望薪资下限" @update:model-value="update('expectSalaryMinYuan', $event)" /></el-form-item>
      <el-form-item label="期望薪资上限（元/月）" :error="errors?.expectSalaryMaxYuan"><el-input-number :model-value="modelValue.expectSalaryMaxYuan ?? undefined" :min="0" :max="2147483647" :precision="0" :controls="false" aria-label="期望薪资上限" @update:model-value="update('expectSalaryMaxYuan', $event)" /></el-form-item>
    </div>
    <el-form-item label="资料备注" :error="errors?.note"><el-input :model-value="modelValue.note" type="textarea" :rows="2" maxlength="500" show-word-limit @update:model-value="update('note', $event)" /></el-form-item>
  </el-form>
</template>

<style scoped>
.draft-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
.intake-draft-form :deep(.el-select) { width: 100%; }
@media (max-width: 768px) { .draft-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
