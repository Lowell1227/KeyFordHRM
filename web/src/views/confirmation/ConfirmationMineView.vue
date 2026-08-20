<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { confirmationApi } from '@/api/confirmation.api';
import ChartCard from '@/components/common/ChartCard.vue';
import { usePagination } from '@/composables/usePagination';
import { CONFIRMATION_STATUS_META } from '@/types/enums';
import { formatDate } from '@/utils/date';
import type { ConfirmationApplication } from '@/types/api.types';

const router = useRouter();

const list = ref<ConfirmationApplication[]>([]);
const loading = ref(false);

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
    const res = await confirmationApi.findMine(withParams({} as Record<string, unknown>));
    list.value = res.items;
    total.value = res.total;
  } catch {
    list.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
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
</script>

<template>
  <div class="confirmation-mine page-stack app-list-page">
    <ChartCard class="header-card list-page-header-card">
      <template #title>我的转正申请</template>

      <p class="tip">此处展示与您相关的转正申请进度，转正薪资等敏感信息不对员工本人展示。</p>
    </ChartCard>

    <ChartCard :padded="false" class="list-result-card">
      <el-table v-loading="loading" :data="list" height="100%" class="app-table">
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-tag :type="statusType((row as ConfirmationApplication).status) as any" size="small">
              {{ statusLabel((row as ConfirmationApplication).status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="主管" min-width="120">
          <template #default="{ row }">{{ (row as ConfirmationApplication).manager?.name }}</template>
        </el-table-column>
        <el-table-column label="HR" min-width="120">
          <template #default="{ row }">{{ (row as ConfirmationApplication).hr?.name }}</template>
        </el-table-column>
        <el-table-column label="公司审批人" min-width="120">
          <template #default="{ row }">{{ (row as ConfirmationApplication).companyApprover?.name }}</template>
        </el-table-column>
        <el-table-column label="实际转正日期" width="130">
          <template #default="{ row }">{{ formatDate((row as ConfirmationApplication).actualRegularDate) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="goDetail(row as ConfirmationApplication)">
              查看
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
.tip {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin: 0;
}
</style>
