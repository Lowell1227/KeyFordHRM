<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import ChartCard from '@/components/common/ChartCard.vue';
import GradeTag from '@/components/common/GradeTag.vue';
import { tasksApi } from '@/api/tasks.api';
import type { TaskListItem } from '@/types/api.types';
import type { PerfGrade } from '@/types/enums';
import { formatScore } from '@/utils/score';

const router = useRouter();
const items = ref<TaskListItem[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref('');
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const result = await tasksApi.findDepartmentReviews({ page: page.value, pageSize: 20 });
    items.value = result.items;
    total.value = result.total;
  } catch { error.value = '获取部门复核任务失败，请重试'; }
  finally { loading.value = false; }
}
function openTask(id: string) {
  router.push({ name: 'TaskDetail', params: { id }, query: { stage: 'result', returnTo: '/department-review' } });
}
onMounted(load);
</script>

<template>
  <div class="page-stack department-review-list">
    <ChartCard>
      <template #title>部门复核</template>
      <template #extra><span>待复核 {{ total }} 人</span></template>
      <el-alert v-if="error" type="error" :title="error" :closable="false"><el-button link @click="load">重试</el-button></el-alert>
      <el-table v-loading="loading" :data="items" empty-text="暂无待部门复核任务" style="width: 100%">
        <el-table-column prop="employeeName" label="员工" min-width="110" />
        <el-table-column prop="cycleName" label="考核周期" min-width="200" />
        <el-table-column prop="deptName" label="部门" min-width="110" />
        <el-table-column label="参考均分" width="110"><template #default="{ row }">{{ formatScore(row.totalScore) }}</template></el-table-column>
        <el-table-column label="最终等级" width="110"><template #default="{ row }"><GradeTag :grade="row.rawGrade as PerfGrade" size="small" /></template></el-table-column>
        <el-table-column label="操作" width="110" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openTask(row.id)">进入复核</el-button></template></el-table-column>
      </el-table>
      <el-pagination v-if="total > 20" v-model:current-page="page" :page-size="20" :total="total" layout="prev, pager, next" @current-change="load" />
    </ChartCard>
  </div>
</template>

<style scoped>
.department-review-list { min-width: 0; }
</style>
