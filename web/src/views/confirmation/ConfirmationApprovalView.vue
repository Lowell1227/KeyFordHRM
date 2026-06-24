<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { confirmationApi } from '@/api/confirmation.api';
import ChartCard from '@/components/common/ChartCard.vue';
import { usePagination } from '@/composables/usePagination';
import { CONFIRMATION_STATUS_META, VOTE_RESULT_LABELS } from '@/types/enums';
import { formatDate } from '@/utils/date';
import type { ConfirmationApplication } from '@/types/api.types';

const router = useRouter();

const list = ref<ConfirmationApplication[]>([]);
const loading = ref(false);
const filters = reactive<{ keyword: string }>({ keyword: '' });

const {
  page,
  pageSize,
  total,
  pageSizeOptions,
  reset: resetPagination,
  withParams,
} = usePagination({ defaultPageSize: 10 });

onMounted(() => {
  loadList();
});

async function loadList() {
  loading.value = true;
  try {
    const res = await confirmationApi.findPending(
      withParams({ keyword: filters.keyword || undefined } as Record<string, unknown>),
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
  filters.keyword = '';
  resetPagination();
  loadList();
}

function goDetail(row: ConfirmationApplication) {
  router.push(`/confirmation-applications/${row.id}`);
}

function statusLabel(status: string): string {
  return CONFIRMATION_STATUS_META[status as keyof typeof CONFIRMATION_STATUS_META]?.label ?? status;
}

function statusType(status: string): string {
  return CONFIRMATION_STATUS_META[status as keyof typeof CONFIRMATION_STATUS_META]?.type ?? 'info';
}

function voteLabel(result?: string | null): string {
  if (!result) return '-';
  return VOTE_RESULT_LABELS[result as keyof typeof VOTE_RESULT_LABELS]?.label ?? result;
}

function voteType(result?: string | null): string {
  if (!result) return 'info';
  return VOTE_RESULT_LABELS[result as keyof typeof VOTE_RESULT_LABELS]?.type ?? 'info';
}

function pendingLabel(row: ConfirmationApplication): string {
  if (!row.pendingRole) return '-';
  if (row.pendingRole === 'manager') return '待我审批（主管）';
  if (row.pendingRole === 'hr') return '待我审批（HR）';
  return '待我审批（公司）';
}
</script>

<template>
  <div class="confirmation-approval page-stack">
    <ChartCard class="header-card">
      <template #title>转正审批台</template>

      <el-form :inline="true" class="filter-form" @submit.prevent="onSearch">
        <el-form-item label="姓名">
          <el-input v-model="filters.keyword" placeholder="请输入姓名" clearable style="width: 220px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="onSearch">查询</el-button>
          <el-button @click="onReset">重置</el-button>
        </el-form-item>
      </el-form>
    </ChartCard>

    <ChartCard :padded="false">
      <el-table v-loading="loading" :data="list" class="app-table">
        <el-table-column label="员工" min-width="120">
          <template #default="{ row }">{{ (row as ConfirmationApplication).employee?.name }}</template>
        </el-table-column>
        <el-table-column label="当前待审节点" min-width="140">
          <template #default="{ row }">
            <el-tag type="warning" size="small">{{ pendingLabel(row as ConfirmationApplication) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-tag :type="statusType((row as ConfirmationApplication).status) as any" size="small">
              {{ statusLabel((row as ConfirmationApplication).status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="表决结果" width="100">
          <template #default="{ row }">
            <el-tag
              v-if="(row as ConfirmationApplication).voteResult"
              :type="voteType((row as ConfirmationApplication).voteResult) as any"
              size="small"
            >
              {{ voteLabel((row as ConfirmationApplication).voteResult) }}
            </el-tag>
            <span v-else class="text-placeholder">-</span>
          </template>
        </el-table-column>
        <el-table-column label="实际转正日期" width="130">
          <template #default="{ row }">{{ formatDate((row as ConfirmationApplication).actualRegularDate) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="goDetail(row as ConfirmationApplication)">
              去审批
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="app-pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="pageSizeOptions"
          :total="total"
          layout="total, sizes, prev, pager, next"
          @change="loadList"
        />
      </div>
    </ChartCard>
  </div>
</template>

<style scoped>
.filter-form :deep(.el-form-item) {
  margin-bottom: 0;
}

.text-placeholder {
  color: var(--el-text-color-placeholder);
}
</style>
