<script setup lang="ts">
import { computed } from 'vue';
import type { PayrollWorkCalendar } from '@/types/payroll.types';

const props = defineProps<{ month: string; modelValue?: PayrollWorkCalendar; error?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: PayrollWorkCalendar] }>();
const dates = computed(() => {
  const [year, month] = props.month.split('-').map(Number);
  return Array.from({ length: new Date(Date.UTC(year!, month!, 0)).getUTCDate() }, (_, i) => `${props.month}-${String(i + 1).padStart(2, '0')}`);
});
const calendar = computed<PayrollWorkCalendar>(() => props.modelValue ?? {
  sourceVersion: '', evidenceRef: '', days: dates.value.map(workDate => ({ workDate, units: '0' })),
});
const total = computed(() => calendar.value.days.reduce((sum, day) => sum + Math.round(Number(day.units) * 10000), 0) / 10000);
function reference(key: 'sourceVersion' | 'evidenceRef', value: string) {
  emit('update:modelValue', { ...calendar.value, [key]: value });
}
function toggle(workDate: string, checked: boolean | string | number) {
  const previous = new Map(calendar.value.days.map(day => [day.workDate, day.units]));
  emit('update:modelValue', { ...calendar.value, days: dates.value.map(date => {
    const units = previous.get(date) ?? '0';
    return { workDate: date, units: date === workDate ? checked ? Number(units) > 0 ? units : '1' : '0' : units };
  }) });
}
</script>
<template>
  <section data-testid="payroll-work-calendar">
    <h3>{{ month }} 工作日日历</h3>
    <div class="reference-grid">
      <el-form-item label="日历版本"><el-input :model-value="calendar.sourceVersion" maxlength="200" @update:model-value="reference('sourceVersion', $event)" /></el-form-item>
      <el-form-item label="日历确认依据"><el-input :model-value="calendar.evidenceRef" maxlength="200" @update:model-value="reference('evidenceRef', $event)" /></el-form-item>
    </div>
    <el-form-item label="应出勤日期" :error="error">
      <div class="workdays">
        <el-checkbox v-for="date in dates" :key="date" :aria-label="date" :model-value="Number(calendar.days.find(day => day.workDate === date)?.units ?? 0) > 0" @change="toggle(date, $event)">{{ Number(date.slice(-2)) }}日</el-checkbox>
      </div>
    </el-form-item>
    <p class="total">整月应出勤：<strong>{{ total }}</strong> 天</p>
  </section>
</template>
<style scoped>
.reference-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.workdays { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); width: 100%; gap: 4px; }
.workdays :deep(.el-checkbox) { margin-right: 0; min-width: 0; }
.workdays :deep(.el-checkbox__label) { padding-left: 5px; }
h3 { font-size: 15px; margin: 18px 0 12px; }
.total { margin: 0 0 16px; color: var(--el-text-color-regular); font-size: 14px; }
@media (max-width: 600px) { .reference-grid { grid-template-columns: minmax(0, 1fr); gap: 0; } .workdays { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
</style>
