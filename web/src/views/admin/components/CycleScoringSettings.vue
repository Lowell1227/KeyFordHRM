<script setup lang="ts">
import { computed, watch } from 'vue';
import { QuestionFilled } from '@element-plus/icons-vue';
import type { CycleType, ScoringFrequency } from '@/types/enums';

const props = defineProps<{
  cycleType: CycleType;
  scoringFrequency: ScoringFrequency;
}>();

const emit = defineEmits<{
  'update:scoringFrequency': [value: ScoringFrequency];
  change: [value: ScoringFrequency];
}>();

const canChooseFrequency = computed(() => (
  props.cycleType === 'quarterly'
  || props.cycleType === 'semiannual'
  || props.cycleType === 'annual'
));

const fixedFrequency = computed<ScoringFrequency>(() => (
  props.cycleType === 'monthly' ? 'monthly' : 'cycle'
));

const fixedFrequencyCopy = computed(() => (
  fixedFrequency.value === 'monthly'
    ? '月度周期固定开启'
    : '当前周期不支持月度跟进'
));

function updateFrequency(value: ScoringFrequency) {
  emit('update:scoringFrequency', value);
  emit('change', value);
}

function handleMonthlyReviewChange(value: string | number | boolean) {
  if (typeof value === 'boolean') updateFrequency(value ? 'monthly' : 'cycle');
}

watch(
  () => props.cycleType,
  () => {
    if (!canChooseFrequency.value && props.scoringFrequency !== fixedFrequency.value) {
      updateFrequency(fixedFrequency.value);
    }
  },
  { immediate: true },
);
</script>

<template>
  <section data-testid="cycle-scoring-settings" class="cycle-scoring-settings" aria-label="月度跟进设置">
    <div class="cycle-scoring-settings__control">
      <el-switch
        data-testid="cycle-monthly-review-switch"
        :model-value="scoringFrequency === 'monthly'"
        :disabled="!canChooseFrequency"
        active-text="月度跟进"
        @change="handleMonthlyReviewChange"
      />
      <el-tooltip
        content="开启后，每月由员工填写复盘并由主管评分；关闭后，仅在周期结束时统一评分。最终结果仍按整个考核周期审核。"
        placement="top"
      >
        <el-icon
          data-testid="cycle-review-settings-help"
          class="cycle-scoring-settings__help"
          aria-label="查看月度跟进说明"
          tabindex="0"
        ><QuestionFilled /></el-icon>
      </el-tooltip>
      <p v-if="!canChooseFrequency" class="cycle-scoring-settings__fixed">{{ fixedFrequencyCopy }}</p>
    </div>
  </section>
</template>

<style scoped>
.cycle-scoring-settings {
  padding: 14px;
}

.cycle-scoring-settings__control {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.cycle-scoring-settings__help {
  flex: none;
  color: var(--el-text-color-placeholder);
  cursor: help;
}

.cycle-scoring-settings__help:focus-visible {
  color: var(--el-color-primary);
  outline: 2px solid var(--el-color-primary-light-5);
  outline-offset: 2px;
  border-radius: 50%;
}

.cycle-scoring-settings__fixed {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

@media (max-width: 767px) {
  .cycle-scoring-settings__control {
    flex-wrap: wrap;
  }
}
</style>
