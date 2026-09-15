<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { confirmationApi } from '@/api/confirmation.api';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import QueryFilterPanel from '@/components/common/QueryFilterPanel.vue';
import BusinessDetailDrawer from '@/components/common/business-list/BusinessDetailDrawer.vue';
import BusinessListPage from '@/components/common/business-list/BusinessListPage.vue';
import { usePagination } from '@/composables/usePagination';
import { useAuthStore } from '@/stores/auth.store';
import { CONFIRMATION_STATUS_META } from '@/types/enums';
import { formatDate } from '@/utils/date';
import type { ConfirmationApplication, ConfirmationWarning } from '@/types/api.types';
import type { ConfirmationStatus } from '@/types/enums';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const list = ref<ConfirmationApplication[]>([]);
const loading = ref(false);
const warnings = ref<ConfirmationWarning[]>([]);
const attentionOpen = ref(false);
const attentionItems = computed(() => warnings.value.filter((item) => !item.hasApplication || !item.plannedRegularDate));
const filters = reactive<{ keyword: string; status: ConfirmationStatus | '' }>({ keyword: '', status: '' });
const statusOptions: ConfirmationStatus[] = ['draft', 'submitted', 'manager_approved', 'hr_approved', 'approved', 'rejected'];
const hasManagementScope = computed(() => auth.user?.sysRole === 'hr'
  || Boolean(auth.user?.hrCapabilities?.includes('confirmation_manage')));
const viewMode = ref<'all' | 'pending' | 'history'>(hasManagementScope.value ? 'all' : 'pending');
const { page, pageSize, total, pageSizeOptions, reset: resetPagination, withParams } = usePagination({ defaultPageSize: 10 });
const detailOpen = computed(() => route.name === 'ConfirmationManageDetail');
const detailOpenedFromList = ref(false);

onMounted(() => {
  void loadList();
  if (hasManagementScope.value) void loadWarnings();
});

async function loadWarnings() {
  try { warnings.value = await confirmationApi.warnings(); }
  catch { warnings.value = []; }
}

async function loadList() {
  loading.value = true;
  try {
    const params = withParams({
      keyword: filters.keyword || undefined,
      status: viewMode.value === 'all' ? filters.status || undefined : undefined,
    });
    const request = viewMode.value === 'all'
      ? confirmationApi.findAll
      : viewMode.value === 'pending'
        ? confirmationApi.findPending
        : confirmationApi.findAssignedHistory;
    const result = await request(params);
    list.value = result.items;
    total.value = result.total;
  } catch {
    list.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function search() {
  resetPagination();
  loadList();
}

function reset() {
  filters.keyword = '';
  filters.status = '';
  search();
}

function statusLabel(row: ConfirmationApplication) {
  if (row.status === 'draft' && row.returnReason) return '退回补充';
  return CONFIRMATION_STATUS_META[row.status]?.label ?? row.status;
}

function statusType(row: ConfirmationApplication) {
  return CONFIRMATION_STATUS_META[row.status]?.type ?? 'info';
}

function changeMode(mode: 'all' | 'pending' | 'history') {
  viewMode.value = mode;
  filters.status = '';
  resetPagination();
  void loadList();
}

function openDetail(id: string) {
  detailOpenedFromList.value = true;
  void router.push({ name: 'ConfirmationManageDetail', params: { id }, query: route.query });
}

function actionLabel() {
  return viewMode.value === 'pending' ? '去办理' : '查看';
}

function closeDetail() {
  if (detailOpenedFromList.value) {
    detailOpenedFromList.value = false;
    router.back();
    return;
  }
  void router.replace({ name: 'ConfirmationManage', query: route.query });
}

function handleDetailVisibility(value: boolean) {
  if (!value && detailOpen.value) closeDetail();
}
</script>

<template>
  <BusinessListPage variant="workflow" :loading="loading">
    <template #title>转正管理</template>
    <template #primary-action>
      <el-button v-if="viewMode === 'all' && attentionItems.length && !detailOpen" link type="warning" data-testid="confirmation-attention-trigger" @click="attentionOpen = true">待关注 {{ attentionItems.length }} 人</el-button>
    </template>
    <template v-if="!hasManagementScope" #summary>
      <div class="list-modes">
        <el-radio-group :model-value="viewMode" size="small" @change="changeMode($event as 'pending' | 'history')">
          <el-radio-button value="pending">待我办理</el-radio-button>
          <el-radio-button value="history">办理记录</el-radio-button>
        </el-radio-group>
      </div>
    </template>
    <template #filters>
      <QueryFilterPanel class="page-filter-panel">
        <el-form :inline="true" class="filter-form" @submit.prevent="search">
          <el-form-item v-if="viewMode === 'all'" label="状态">
            <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 160px">
              <el-option v-for="status in statusOptions" :key="status" :label="CONFIRMATION_STATUS_META[status]?.label ?? status" :value="status" />
            </el-select>
          </el-form-item>
          <el-form-item label="姓名"><el-input v-model="filters.keyword" placeholder="请输入姓名" clearable style="width: 220px" /></el-form-item>
          <el-form-item><el-button type="primary" @click="search">查询</el-button><el-button @click="reset">重置</el-button></el-form-item>
        </el-form>
      </QueryFilterPanel>
    </template>

    <template #desktop-list>
      <el-table v-loading="loading" :data="list" height="100%" class="app-table">
        <el-table-column label="员工" min-width="120"><template #default="{ row }">{{ (row as ConfirmationApplication).employee?.name }}</template></el-table-column>
        <el-table-column label="状态" width="130"><template #default="{ row }"><el-tag :type="statusType(row as ConfirmationApplication) as any" size="small">{{ statusLabel(row as ConfirmationApplication) }}</el-tag></template></el-table-column>
        <el-table-column label="直属主管" min-width="120"><template #default="{ row }">{{ (row as ConfirmationApplication).manager?.name || '待核实' }}</template></el-table-column>
        <el-table-column label="HR 实际经办" min-width="120"><template #default="{ row }">{{ (row as ConfirmationApplication).hr?.name || '尚未办理' }}</template></el-table-column>
        <el-table-column label="公司审批人" min-width="120"><template #default="{ row }">{{ (row as ConfirmationApplication).companyApprover?.name || '提交时确定' }}</template></el-table-column>
        <el-table-column label="实际转正日期" width="135"><template #default="{ row }">{{ formatDate((row as ConfirmationApplication).actualRegularDate) }}</template></el-table-column>
        <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }">
          <el-button link type="primary" @click="openDetail((row as ConfirmationApplication).id)">{{ actionLabel() }}</el-button>
        </template></el-table-column>
      </el-table>
    </template>
    <template #mobile-list>
      <div v-loading="loading" class="confirmation-mobile-list">
        <MobileResultCard v-for="item in list" :key="item.id">
          <template #title>{{ item.employee?.name || '-' }}</template>
          <template #status><el-tag :type="statusType(item) as any" size="small">{{ statusLabel(item) }}</el-tag></template>
          <div class="mobile-result-field"><span class="mobile-result-field__label">直属主管</span><span class="mobile-result-field__value">{{ item.manager?.name || '待核实' }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">HR 实际经办</span><span class="mobile-result-field__value">{{ item.hr?.name || '尚未办理' }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">公司审批人</span><span class="mobile-result-field__value">{{ item.companyApprover?.name || '提交时确定' }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">转正日期</span><span class="mobile-result-field__value">{{ formatDate(item.actualRegularDate) }}</span></div>
          <template #actions><el-button link type="primary" @click="openDetail(item.id)">{{ actionLabel() }}</el-button></template>
        </MobileResultCard>
      </div>
    </template>
    <template #pagination>
      <ListPagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="pageSizeOptions" :total="total" @change="loadList" />
    </template>
    <template #detail>
      <BusinessDetailDrawer
        :model-value="detailOpen"
        title="转正申请详情"
        variant="workflow"
        @update:model-value="handleDetailVisibility"
      >
        <RouterView v-slot="{ Component }">
          <component :is="Component" @changed="loadList" />
        </RouterView>
      </BusinessDetailDrawer>
      <el-drawer v-model="attentionOpen" title="试用期员工待关注" size="min(480px, 100vw)" append-to-body>
        <p class="attention-intro">计划转正日期临近、已过或缺失的员工。请核实档案，并提醒尚未提交申请的员工发起转正。</p>
        <div class="attention-list" role="list">
          <div v-for="item in attentionItems" :key="item.employeeId" class="attention-item" role="listitem">
            <div class="attention-item__head"><strong>{{ item.employeeName }}</strong><span>{{ item.deptName || '部门待核实' }}</span></div>
            <div class="attention-item__meta">
              <span>{{ item.plannedRegularDate ? `${formatDate(item.plannedRegularDate)}${(item.daysUntil ?? 0) < 0 ? '（已逾期）' : '（临近）'}` : '计划转正日期待核实' }}</span>
              <el-tag :type="item.hasApplication ? 'info' : 'warning'" size="small">{{ item.hasApplication ? '已提交申请' : '尚未提交申请' }}</el-tag>
            </div>
          </div>
        </div>
      </el-drawer>
    </template>
  </BusinessListPage>
</template>

<style scoped>
.filter-form :deep(.el-form-item) { margin-bottom: 0; }
.list-modes { margin: 0 0 12px; }
.list-page-header-card :deep(.chart-card__head) { flex-wrap: wrap; gap: 4px 8px; }
.confirmation-mobile-list { display: grid; gap: 10px; }
.attention-intro { margin: 0 0 16px; color: var(--el-text-color-regular); font-size: 13px; line-height: 1.6; }
.attention-list { display: grid; gap: 8px; }
.attention-item { padding: 10px 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; }
.attention-item__head, .attention-item__meta { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px 12px; }
.attention-item__head { margin-bottom: 6px; }
.attention-item__head span, .attention-item__meta { color: var(--el-text-color-regular); font-size: 13px; }
</style>
