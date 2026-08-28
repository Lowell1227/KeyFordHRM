<script setup lang="ts">
import { ref } from 'vue';
import { cyclesApi } from '../../src/api/cycles.api';
import CycleMonthlyScheduleEditor from '../../src/views/admin/components/CycleMonthlyScheduleEditor.vue';
import CycleScoringSettings from '../../src/views/admin/components/CycleScoringSettings.vue';
import type { CyclePeriodSchedule } from '../../src/types/api.types';
import type { CycleType, ScoringFrequency } from '../../src/types/enums';

const visible = ref(false);
const cycleType = ref<CycleType>('quarterly');
const scoringFrequency = ref<ScoringFrequency>('monthly');
const schedules = ref<CyclePeriodSchedule[]>([]);

async function preview(type: CycleType, frequency: ScoringFrequency) {
  const result = await cyclesApi.previewSchedule({
    type,
    scoringFrequency: frequency,
    startDate: '2027-01-01',
    endDate: '2027-12-31',
  });
  schedules.value = result.schedules;
}

function selectType(type: CycleType) {
  cycleType.value = type;
  if (type === 'monthly') scoringFrequency.value = 'monthly';
  if (type === 'custom' || type === 'probation') scoringFrequency.value = 'cycle';
  void preview(type, scoringFrequency.value);
}

function updateFrequency(frequency: ScoringFrequency) {
  scoringFrequency.value = frequency;
  void preview(cycleType.value, frequency);
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
      <CycleMonthlyScheduleEditor v-model:schedules="schedules" />
    </section>
  </main>
</template>
