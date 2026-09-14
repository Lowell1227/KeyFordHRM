<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft } from '@element-plus/icons-vue';
import { probationApi } from '@/api/probation.api';
import ChartCard from '@/components/common/ChartCard.vue';
import SignBlock from '@/components/common/SignBlock.vue';
import { PROBATION_INDICATOR_TYPE_LABELS, PROBATION_STATUS_META } from '@/types/enums';
import { formatDate } from '@/utils/date';
import type { ProbationReview } from '@/types/api.types';

const route = useRoute();
const router = useRouter();
const review = ref<ProbationReview | null>(null);
const loading = ref(false);

const totalScore = computed(() => {
  if (!review.value?.indicators.length || review.value.indicators.some((item) => item.managerScore == null)) return null;
  return Number(review.value.indicators.reduce((sum, item) => sum + item.managerScore! * item.weight, 0).toFixed(2));
});

onMounted(async () => {
  loading.value = true;
  try {
    review.value = await probationApi.findOne(route.params.id as string);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-loading="loading" class="page-stack">
    <div class="page-header">
      <el-button link :icon="ArrowLeft" @click="router.back()">返回</el-button>
      <h2>试用期考核历史</h2>
    </div>

    <template v-if="review">
      <ChartCard>
        <p class="archive-note">本记录仅供查阅。当前绩效考核请在周期与计划中办理，转正由员工本人发起申请。</p>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="员工">{{ review.employee.name }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ PROBATION_STATUS_META[review.status]?.label ?? review.status }}</el-descriptions-item>
          <el-descriptions-item label="直属主管">{{ review.manager.name }}</el-descriptions-item>
          <el-descriptions-item label="HR">{{ review.hr.name }}</el-descriptions-item>
          <el-descriptions-item label="计划转正日期">{{ formatDate(review.plannedRegularDate) }}</el-descriptions-item>
          <el-descriptions-item label="综合得分">{{ totalScore ?? '未形成' }}</el-descriptions-item>
        </el-descriptions>
      </ChartCard>

      <ChartCard :padded="false">
        <template #title>原试用期考核记录</template>
        <div class="desktop-result-table">
          <el-table :data="review.indicators" class="app-table">
            <el-table-column prop="name" label="指标" min-width="180" />
            <el-table-column label="类型" width="120">
              <template #default="{ row }">{{ PROBATION_INDICATOR_TYPE_LABELS[row.type as keyof typeof PROBATION_INDICATOR_TYPE_LABELS] }}</template>
            </el-table-column>
            <el-table-column label="权重" width="90"><template #default="{ row }">{{ Math.round(row.weight * 100) }}%</template></el-table-column>
            <el-table-column label="自评分" width="90"><template #default="{ row }">{{ row.selfScore ?? '-' }}</template></el-table-column>
            <el-table-column label="主管评分" width="100"><template #default="{ row }">{{ row.managerScore ?? '-' }}</template></el-table-column>
            <el-table-column prop="selfComment" label="自评说明" min-width="180" show-overflow-tooltip />
            <el-table-column prop="managerComment" label="主管评语" min-width="180" show-overflow-tooltip />
          </el-table>
        </div>
        <div class="mobile-result-list archive-mobile">
          <div v-for="item in review.indicators" :key="item.id" class="archive-item">
            <strong>{{ item.name }}</strong>
            <span>权重 {{ Math.round(item.weight * 100) }}% · 自评 {{ item.selfScore ?? '-' }} · 主管 {{ item.managerScore ?? '-' }}</span>
            <p v-if="item.selfComment">自评：{{ item.selfComment }}</p>
            <p v-if="item.managerComment">主管：{{ item.managerComment }}</p>
          </div>
        </div>
      </ChartCard>

      <ChartCard v-if="review.strengths || review.improvements">
        <template #title>综合评价</template>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="优势反馈">{{ review.strengths || '暂无' }}</el-descriptions-item>
          <el-descriptions-item label="待改进项">{{ review.improvements || '暂无' }}</el-descriptions-item>
        </el-descriptions>
      </ChartCard>

      <SignBlock business-type="probation_task" :business-record-id="review.id" :role="null" title="原试用期考核签字记录" />
    </template>
  </div>
</template>

<style scoped>
.page-header { display: flex; align-items: center; gap: 12px; }
.page-header h2 { margin: 0; font-size: 18px; }
.archive-note { margin: 0 0 14px; color: var(--el-text-color-secondary); }
.archive-mobile { padding: 12px; }
.archive-item { display: grid; gap: 6px; padding: 12px 0; border-bottom: 1px solid var(--el-border-color-lighter); overflow-wrap: anywhere; }
.archive-item span { color: var(--el-text-color-secondary); }
.archive-item p { margin: 0; white-space: pre-wrap; }
</style>
