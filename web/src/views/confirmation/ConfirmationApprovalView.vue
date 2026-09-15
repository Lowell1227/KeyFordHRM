<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { confirmationApi } from '@/api/confirmation.api';
import ChartCard from '@/components/common/ChartCard.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import QueryFilterPanel from '@/components/common/QueryFilterPanel.vue';
import { usePagination } from '@/composables/usePagination';
import { CONFIRMATION_STATUS_META } from '@/types/enums';
import type { ConfirmationApplication } from '@/types/api.types';

const router = useRouter();

const list = ref<ConfirmationApplication[]>([]);
const loading = ref(false);
const viewMode = ref<'pending' | 'history'>('pending');
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
    const res = await (viewMode.value === 'pending' ? confirmationApi.findPending : confirmationApi.findAssignedHistory)(
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

function changeMode(mode: 'pending' | 'history') {
  viewMode.value = mode;
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

function pendingLabel(row: ConfirmationApplication): string {
  if (!row.pendingRole) return '-';
  if (row.pendingRole === 'manager') return '待我评价（直属主管）';
  if (row.pendingRole === 'hr') return '待我记录评议（HR）';
  return '待我决定（公司审批人）';
}
</script>

<template>
  <div class="confirmation-approval page-stack app-list-page">
    <ChartCard class="header-card list-page-header-card">
      <template #title>转正管理</template>

      <div class="list-modes">
        <el-radio-group :model-value="viewMode" size="small" @change="changeMode($event as 'pending' | 'history')">
          <el-radio-button value="pending">待我办理</el-radio-button>
          <el-radio-button value="history">办理记录</el-radio-button>
        </el-radio-group>
      </div>

      <QueryFilterPanel class="page-filter-panel">
        <el-form :inline="true" class="filter-form" @submit.prevent="onSearch">
        <el-form-item label="姓名">
          <el-input v-model="filters.keyword" placeholder="请输入姓名" clearable style="width: 220px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="onSearch">查询</el-button>
          <el-button @click="onReset">重置</el-button>
        </el-form-item>
        </el-form>
      </QueryFilterPanel>
    </ChartCard>

    <ChartCard :padded="false" class="list-result-card">
      <div class="desktop-result-table">
      <el-table v-loading="loading" :data="list" height="100%" class="app-table">
        <el-table-column label="员工" min-width="120">
          <template #default="{ row }">{{ (row as ConfirmationApplication).employee?.name }}</template>
        </el-table-column>
        <el-table-column :label="viewMode === 'pending' ? '当前待办' : '办理状态'" min-width="140">
          <template #default="{ row }">
            <el-tag v-if="viewMode === 'pending'" type="warning" size="small">{{ pendingLabel(row as ConfirmationApplication) }}</el-tag>
            <span v-else>{{ statusLabel((row as ConfirmationApplication).status) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-tag :type="statusType((row as ConfirmationApplication).status) as any" size="small">
              {{ statusLabel((row as ConfirmationApplication).status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="goDetail(row as ConfirmationApplication)">
              {{ viewMode === 'pending' ? '去办理' : '查看' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      </div>

      <div v-loading="loading" class="mobile-result-list">
        <MobileResultCard v-for="item in list" :key="item.id">
          <template #title>{{ item.employee?.name || '-' }}</template>
          <template #status><el-tag :type="statusType(item.status) as any" size="small">{{ statusLabel(item.status) }}</el-tag></template>
          <div class="mobile-result-field"><span class="mobile-result-field__label">{{ viewMode === 'pending' ? '当前待办' : '办理状态' }}</span><span class="mobile-result-field__value">{{ viewMode === 'pending' ? pendingLabel(item) : statusLabel(item.status) }}</span></div>
          <template #actions><el-button link type="primary" @click="goDetail(item)">{{ viewMode === 'pending' ? '去办理' : '查看' }}</el-button></template>
        </MobileResultCard>
      </div>
      <ListPagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="pageSizeOptions"
        :total="total"
        @change="loadList"
      />
    </ChartCard>
  </div>
</template>

<style scoped>
.list-modes { margin: 0 0 12px; }
.filter-form :deep(.el-form-item) {
  margin-bottom: 0;
}

.text-placeholder {
  color: var(--el-text-color-placeholder);
}
</style>
