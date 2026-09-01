<script setup lang="ts">
import { ref } from 'vue';
import { cyclesApi } from '../../src/api/cycles.api';
import CycleMonthlyScheduleEditor from '../../src/views/admin/components/CycleMonthlyScheduleEditor.vue';
import CycleScoringSettings from '../../src/views/admin/components/CycleScoringSettings.vue';
import type { CyclePeriodSchedule, CycleScheduleIssue } from '../../src/types/api.types';
import type { CycleType, ScoringFrequency } from '../../src/types/enums';

const visible = ref(false);
const cycleType = ref<CycleType>('quarterly');
const scoringFrequency = ref<ScoringFrequency>('cycle');
const schedules = ref<CyclePeriodSchedule[]>([]);
const immutableUpdate = ref('array:false,row:false');
const warnings: CycleScheduleIssue[] = [
  { code: 'overlap_warning', periodKey: '2027-02', message: '该月与相邻计划有重叠风险' },
  { code: 'manager_due_before_self', periodKey: '2027-02', message: '主管评分早于自评截止' },
];
const blockers: CycleScheduleIssue[] = [];

function cloneSchedules(value: CyclePeriodSchedule[]) {
  return value.map((schedule) => ({ ...schedule }));
}

async function preview(type: CycleType, frequency: ScoringFrequency) {
  const result = await cyclesApi.previewSchedule({
    type,
    scoringFrequency: frequency,
    startDate: '2027-01-01',
    endDate: '2027-12-31',
  });
  schedules.value = cloneSchedules(result.schedules);
}

function selectType(type: CycleType) {
  cycleType.value = type;
  scoringFrequency.value = type === 'monthly' ? 'monthly' : 'cycle';
  void preview(type, scoringFrequency.value);
}

function updateFrequency(frequency: ScoringFrequency) {
  scoringFrequency.value = frequency;
  void preview(cycleType.value, frequency);
}

function updateSchedules(value: CyclePeriodSchedule[]) {
  immutableUpdate.value = `array:${value !== schedules.value}:row:${value[0] !== schedules.value[0]}`;
  schedules.value = value;
}

</script>

<template>
  <main>
    <button data-testid="cycle-create" type="button" @click="visible = true">新建周期</button>
    <section v-if="visible" aria-label="创建绩效周期">
      <div aria-label="周期类型">
        <button data-testid="cycle-type-monthly" type="button" @click="selectType('monthly')">月度</button>
        <button data-testid="cycle-type-quarterly" type="button" @click="selectType('quarterly')">季度</button>
        <button data-testid="cycle-type-semiannual" type="button" @click="selectType('semiannual')">半年</button>
        <button data-testid="cycle-type-annual" type="button" @click="selectType('annual')">年度</button>
        <button data-testid="cycle-type-custom" type="button" @click="selectType('custom')">自定义</button>
      </div>
      <CycleScoringSettings
        :cycle-type="cycleType"
        :scoring-frequency="scoringFrequency"
        @update:scoring-frequency="updateFrequency"
      />
      <CycleMonthlyScheduleEditor
        :schedules="schedules"
        :warnings="warnings"
        :blockers="blockers"
        @update:schedules="updateSchedules"
      />
      <output data-testid="cycle-immutable-update">{{ immutableUpdate }}</output>
    </section>
  </main>
</template>
