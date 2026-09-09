<script setup lang="ts">
import GradeTag from '@/components/common/GradeTag.vue';
import type { PerfGrade } from '@/types/enums';
import { formatResultScore } from '@/utils/performance-result-presentation';

defineProps<{ periods: Array<{
  periodKey: string;
  selfScoreTotal?: number | null;
  managerScoreTotal?: number | null;
  selfGrade?: PerfGrade | null;
  managerGrade?: PerfGrade | null;
}> }>();
</script>

<template>
  <section class="performance-result-section" aria-label="月度结果回顾">
    <h3>月度结果回顾</h3>
    <el-table :data="periods" class="performance-result-table performance-period-table" empty-text="暂无月度结果">
      <el-table-column prop="periodKey" label="月份" min-width="100" />
      <el-table-column label="自评分" min-width="90" align="right">
        <template #default="{ row }">{{ formatResultScore(row.selfScoreTotal) }}</template>
      </el-table-column>
      <el-table-column label="自评等级" min-width="90" align="center">
        <template #default="{ row }"><GradeTag :grade="row.selfGrade" size="small" /></template>
      </el-table-column>
      <el-table-column label="上级评分" min-width="90" align="right">
        <template #default="{ row }">{{ formatResultScore(row.managerScoreTotal) }}</template>
      </el-table-column>
      <el-table-column label="上级等级" min-width="90" align="center">
        <template #default="{ row }"><GradeTag :grade="row.managerGrade" size="small" /></template>
      </el-table-column>
    </el-table>
  </section>
</template>
