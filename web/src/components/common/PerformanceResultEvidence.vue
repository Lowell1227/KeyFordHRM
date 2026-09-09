<script setup lang="ts">
import { computed } from 'vue';
import PerformancePeriodResults from './PerformancePeriodResults.vue';
import ReviewHistory from './ReviewHistory.vue';
import type { ResultEvidence, ReviewHistoryRecord } from '@/types/api.types';
import { formatResultScore } from '@/utils/performance-result-presentation';
const props = defineProps<{ evidence?: ResultEvidence; periods?: ResultEvidence['periods']; indicators?: ResultEvidence['indicators']; records?: ReviewHistoryRecord[] }>();
const months = computed(() => props.evidence?.periods ?? props.periods ?? []);
const goals = computed(() => props.evidence?.indicators ?? props.indicators ?? []);
</script>

<template>
  <div class="performance-result-evidence" data-testid="performance-result-evidence">
    <PerformancePeriodResults :periods="months" />
    <ReviewHistory :records="records" />
    <el-collapse class="performance-result-section">
      <el-collapse-item title="指标汇总（跨月平均）" name="indicators">
        <el-table :data="goals" class="performance-result-table" empty-text="暂无指标评分记录">
          <el-table-column prop="name" label="指标" min-width="160" show-overflow-tooltip />
          <el-table-column label="权重" width="70" align="right">
            <template #default="{ row }">{{ Number((row.weight * 100).toFixed(2)) }}%</template>
          </el-table-column>
          <el-table-column label="自评均分" width="100" align="right">
            <template #default="{ row }">{{ formatResultScore(row.avgSelfScore) }}</template>
          </el-table-column>
          <el-table-column label="上级均分" width="100" align="right">
            <template #default="{ row }">{{ formatResultScore(row.avgManagerScore) }}</template>
          </el-table-column>
        </el-table>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>
