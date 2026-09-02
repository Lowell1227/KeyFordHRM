<script setup lang="ts">
import { ref } from 'vue';
import type { FlowRecord, IndicatorInstance } from '@/types/api.types';
import GoalReviewReferencePanel from './GoalReviewReferencePanel.vue';
import IndicatorOperationTimeline from './IndicatorOperationTimeline.vue';

withDefaults(defineProps<{
  cycleId?: string;
  employeeId?: string;
  indicators?: IndicatorInstance[];
  flowRecords?: FlowRecord[];
}>(), {
  cycleId: undefined,
  employeeId: undefined,
  indicators: () => [],
  flowRecords: () => [],
});

type SupportTab = 'reference' | 'history';
const activeTab = ref<SupportTab>('history');
</script>

<template>
  <section class="goal-review-support" data-testid="goal-review-support-panel">
    <div class="goal-review-support__tabs" role="tablist" aria-label="目标审核参考信息">
      <button
        type="button"
        role="tab"
        data-testid="goal-review-support-reference-tab"
        :aria-selected="activeTab === 'reference'"
        :class="{ 'is-active': activeTab === 'reference' }"
        @click="activeTab = 'reference'"
      >
        参考目标
      </button>
      <button
        type="button"
        role="tab"
        data-testid="goal-review-support-history-tab"
        :aria-selected="activeTab === 'history'"
        :class="{ 'is-active': activeTab === 'history' }"
        @click="activeTab = 'history'"
      >
        操作记录
      </button>
    </div>

    <GoalReviewReferencePanel
      v-show="activeTab === 'reference'"
      :cycle-id="cycleId"
      :employee-id="employeeId"
      :indicators="indicators"
    />
    <div v-show="activeTab === 'history'" class="goal-review-support__history">
      <IndicatorOperationTimeline :records="flowRecords" :show-header="false" />
      <el-empty
        v-if="!flowRecords.length"
        :image-size="46"
        description="暂无操作记录"
      />
    </div>
  </section>
</template>

<style scoped>
.goal-review-support { min-width: 0; }
.goal-review-support__tabs { min-height: 42px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-bottom: 1px solid #e7ebf2; }
.goal-review-support__tabs button { min-height: 42px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #687386; font: inherit; font-size: 12px; cursor: pointer; }
.goal-review-support__tabs button.is-active { border-bottom-color: #4f67d8; color: #4f67d8; font-weight: 600; }
.goal-review-support__history { padding: 14px; }
.goal-review-support__history :deep(.operation-timeline) { margin-top: 0; padding-top: 0; border-top: 0; }
.goal-review-support__history :deep(.operation-timeline__header h3) { font-size: 14px; }
.goal-review-support__history :deep(.operation-timeline__main) { align-items: flex-start; flex-direction: column; gap: 3px; }
.goal-review-support__history :deep(.operation-timeline__content) { padding: 9px 10px; }
</style>
