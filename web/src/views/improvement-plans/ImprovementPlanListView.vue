<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Search, RefreshRight } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import { improvementPlansApi } from '@/api/improvement-plans.api';
import { usePagination } from '@/composables/usePagination';
import { IMPROVEMENT_PLAN_STATUS_META } from '@/types/enums';
import { formatDate } from '@/utils/date';
import EmptyState from '@/components/common/EmptyState.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import CollapsibleFilterPanel from '@/components/common/CollapsibleFilterPanel.vue';
import type { ImprovementPlan } from '@/types/api.types';
import type { ImprovementPlanStatus } from '@/types/enums';

const auth = useAuthStore();
const router = useRouter();

const list = ref<ImprovementPlan[]>([]);
const loading = ref(false);
const filters = reactive<{ status: ImprovementPlanStatus | ''; keyword: string }>({
  status: '',
  keyword: '',
});

const {
  page,
  pageSize,
  total,
  pageSizeOptions,
  reset: resetPagination,
  withParams,
} = usePagination({ defaultPageSize: 10 });

const isManagerOrHR = computed(() =>
  ['hr', 'system_admin'].includes(auth.user?.sysRole ?? '')
  || Boolean(auth.user?.businessCapabilities?.canManageTeam)
  || Boolean(auth.user?.businessCapabilities?.canReviewDepartment),
);

const statusOptions: ImprovementPlanStatus[] = ['draft', 'in_progress', 'completed'];

onMounted(() => {
  loadList();
});

async function loadList() {
  loading.value = true;
  try {
    const res = await improvementPlansApi.findAll(
      withParams({
        status: filters.status || undefined,
        keyword: filters.keyword || undefined,
      } as Record<string, unknown>),
    );
    list.value = res.items;
    total.value = res.total;
  } catch {
    list.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  resetPagination();
  loadList();
}

function onReset() {
  filters.status = '';
  filters.keyword = '';
  resetPagination();
  loadList();
}

function goDetail(row: any) {
  router.push(`/improvement-plans/${row.id}`);
}

function statusType(status: ImprovementPlanStatus): string {
  return IMPROVEMENT_PLAN_STATUS_META[status]?.type ?? 'info';
}

function statusLabel(status: ImprovementPlanStatus): string {
  return IMPROVEMENT_PLAN_STATUS_META[status]?.label ?? status;
}

function formatMeasuresCount(row: any): string {
  const count = Array.isArray(row.measures) ? row.measures.length : 0;
  return count > 0 ? `${count} 项措施` : '-';
}
</script>

<template>
  <div class="improvement-plan-list page-stack app-list-page">
    <ChartCard class="header-card list-page-header-card">
      <template #title>绩效改进计划</template>
      <template #extra>
        <el-tag v-if="!isManagerOrHR" type="info" size="small">仅展示我的改进计划</el-tag>
      </template>

      <CollapsibleFilterPanel class="page-filter-panel">
        <el-form :inline="true" class="filter-form" @submit.prevent="onSearch">
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 160px">
            <el-option
              v-for="s in statusOptions"
              :key="s"
              :label="statusLabel(s)"
              :value="s"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="姓名/工号">
          <el-input
            v-model="filters.keyword"
            placeholder="请输入姓名或工号"
            clearable
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="onSearch">查询</el-button>
          <el-button :icon="RefreshRight" @click="onReset">重置</el-button>
        </el-form-item>
        </el-form>
      </CollapsibleFilterPanel>
    </ChartCard>

    <ChartCard :padded="false" class="list-result-card">
      <el-table v-loading="loading" :data="list" height="100%" class="app-table" @row-click="goDetail">
        <el-table-column label="员工" min-width="140">
          <template #default="{ row }">
            <div class="employee-cell">
              <span class="employee-name">{{ row.employeeName || '-' }}</span>
              <span v-if="row.employeeNo" class="employee-no">{{ row.employeeNo }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="cycleName" label="考核周期" min-width="160" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status) as any" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="目标日期" width="120">
          <template #default="{ row }">{{ row.targetDate ? formatDate(row.targetDate) : '-' }}</template>
        </el-table-column>
        <el-table-column label="措施" width="120">
          <template #default="{ row }">{{ formatMeasuresCount(row) }}</template>
        </el-table-column>
        <el-table-column label="最终评分" width="100">
          <template #default="{ row }">{{ row.finalScore ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="creatorName" label="制定人" min-width="120" />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click.stop="goDetail(row)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="list.length > 0" class="app-pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="pageSizeOptions"
          :total="total"
          layout="total, sizes, prev, pager, next"
          @change="loadList"
        />
      </div>
      <EmptyState v-else description="暂无改进计划" />
    </ChartCard>
  </div>
</template>

<style scoped>
.filter-form :deep(.el-form-item) {
  margin-bottom: 0;
}

.employee-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.employee-name {
  font-weight: 500;
}

.employee-no {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
