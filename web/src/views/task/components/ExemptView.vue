<script setup lang="ts">
import ChartCard from '@/components/common/ChartCard.vue';
import type { TaskDetail } from '@/types/api.types';

const props = defineProps<{
  task: TaskDetail;
}>();
</script>

<template>
  <ChartCard class="exempt-view">
    <el-result icon="info" title="该任务已豁免" :sub-title="task.exemptReason || '无需参与本次绩效考核'">
      <template #extra>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="任务名称">{{ task.employeeName || '绩效任务' }}</el-descriptions-item>
          <el-descriptions-item label="考核周期">{{ task.cycleName || '-' }}</el-descriptions-item>
          <el-descriptions-item label="豁免原因">{{ task.exemptReason || '-' }}</el-descriptions-item>
        </el-descriptions>
      </template>
    </el-result>
  </ChartCard>
</template>
