<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Calendar } from '@element-plus/icons-vue';
import { ElButton, ElDatePickerPanel, ElInput, ElPopover, useFormDisabled } from 'element-plus';
import { contractCalendarDay } from '@/utils/employee-contract-validation';

const props = withDefaults(defineProps<{ modelValue?: string | null; disabled?: boolean }>(), { disabled: undefined });
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>();
const disabled = useFormDisabled();
const open = ref(false);
const inputRef = ref<InstanceType<typeof ElInput>>();
const lastCalendarDay = ref('');
watch(() => props.modelValue, value => {
  const day = contractCalendarDay(value);
  if (day || !value) lastCalendarDay.value = day ?? '';
}, { immediate: true });
watch(disabled, value => { if (value) open.value = false; });
const displayValue = computed(() => contractCalendarDay(props.modelValue) ?? props.modelValue ?? '');
const invalid = computed(() => !!props.modelValue && !contractCalendarDay(props.modelValue));

function input(value: string) {
  // Keep raw text in the form; Element Plus's date text parser rolls impossible days forward.
  emit('update:modelValue', value || null);
  open.value = false;
}
function selectDate(value: unknown) {
  const day = contractCalendarDay(value);
  if (!day || disabled.value) return;
  emit('update:modelValue', day);
  open.value = false;
  inputRef.value?.focus();
}
</script>

<template>
  <ElInput ref="inputRef" class="contract-date-input" :model-value="displayValue" :disabled="disabled" :aria-invalid="invalid"
    placeholder="YYYY-MM-DD" clearable @update:model-value="input" @keydown.enter.prevent>
    <template #suffix>
      <ElPopover v-model:visible="open" trigger="click" placement="bottom-start" :width="322" :disabled="disabled"
        popper-class="contract-date-calendar" :popper-style="{ padding: '0', maxWidth: 'calc(100vw - 16px)' }">
        <template #reference><ElButton link :icon="Calendar" :disabled="disabled" aria-label="选择日期" title="选择日期" /></template>
        <ElDatePickerPanel :model-value="lastCalendarDay" type="date" value-format="YYYY-MM-DD" :border="false" @update:model-value="selectDate" />
      </ElPopover>
    </template>
  </ElInput>
</template>

<style scoped>
.contract-date-input { width: 100%; }
.contract-date-input :deep(.el-input__suffix-inner) { gap: 4px; }
.contract-date-input :deep(.el-button) { width: 24px; height: 24px; min-width: 24px; margin: 0; padding: 0; }
</style>
