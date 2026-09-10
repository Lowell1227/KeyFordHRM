<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { interviewsApi, type InterviewCycle } from '@/api/interviews.api';
import { departmentsApi } from '@/api/departments.api';
import { usePagination } from '@/composables/usePagination';
import { INTERVIEW_METHOD_LABELS } from '@/types/enums';
import { formatDateTime } from '@/utils/date';
import InterviewDrawer from './InterviewDrawer.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import PerformanceRecordFilters from '@/components/common/PerformanceRecordFilters.vue';
import type { Department, PerformanceInterview } from '@/types/api.types';

const list = ref<PerformanceInterview[]>([]);
const loading = ref(false);
const loadError = ref('');
const cycles = ref<InterviewCycle[]>([]);
const departments = ref<Department[]>([]);
const filters = reactive({ cycleId: '', deptId: '', keyword: '' });
const { page, pageSize, total, pageSizeOptions, reset, withParams } = usePagination({ defaultPageSize: 10 });
const drawerVisible = ref(false);
const selectedInterviewId = ref<string>();
const readonly = ref(false);
let requestId = 0;

onMounted(async () => {
  const results = await Promise.allSettled([
    interviewsApi.cycles(),
    departmentsApi.findAll({ isActive: true, pageSize: 1000 }),
  ]);
  if (results[0].status === 'fulfilled') cycles.value = results[0].value;
  if (results[1].status === 'fulfilled') departments.value = results[1].value;
  await loadList();
});

async function loadList() {
  const id = ++requestId;
  loading.value = true;
  loadError.value = '';
  try {
    const res = await interviewsApi.findAll(withParams({
      cycleId: filters.cycleId || undefined, deptId: filters.deptId || undefined, keyword: filters.keyword.trim() || undefined,
    }));
    if (id !== requestId) return;
    list.value = res.items;
    total.value = res.total;
  } catch {
    if (id !== requestId) return;
    list.value = [];
    total.value = 0;
    loadError.value = '面谈记录暂时无法读取，请重试';
  } finally {
    if (id === requestId) loading.value = false;
  }
}
function onSearch() { reset(); void loadList(); }
function onReset() { Object.assign(filters, { cycleId: '', deptId: '', keyword: '' }); onSearch(); }
function openDrawer(item?: PerformanceInterview, viewOnly = false) {
  selectedInterviewId.value = item?.id;
  readonly.value = viewOnly;
  drawerVisible.value = true;
}
function onSaved() { drawerVisible.value = false; void loadList(); }
</script>

<template>
  <div class="interview-list page-stack app-list-page">
    <ChartCard class="list-page-header-card">
      <template #title>绩效面谈台账</template>
      <template #extra><el-button type="primary" @click="openDrawer()">新增面谈记录</el-button></template>
      <PerformanceRecordFilters v-model:cycle-id="filters.cycleId" v-model:dept-id="filters.deptId"
        v-model:keyword="filters.keyword" :cycles="cycles" :departments="departments" :loading="loading"
        allow-all-cycles class="page-filter-panel" @search="onSearch" @reset="onReset" />
    </ChartCard>
    <ChartCard :padded="false" class="list-card list-result-card">
      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false">
        <el-button link type="primary" @click="loadList">重试</el-button>
      </el-alert>
      <div class="desktop-result-table">
        <el-table v-loading="loading" class="app-table" :data="list" height="100%" empty-text="暂无面谈记录">
          <el-table-column label="员工" min-width="130">
            <template #default="{ row }"><div class="employee-cell"><span>{{ row.employeeName }}</span><span class="employee-no">{{ row.employeeNo || '—' }}</span></div></template>
          </el-table-column>
          <el-table-column prop="deptName" label="部门" min-width="120" />
          <el-table-column label="关联周期" min-width="180" show-overflow-tooltip><template #default="{ row }">{{ row.cycleName || '未关联周期' }}</template></el-table-column>
          <el-table-column prop="interviewerName" label="面谈人" width="100" />
          <el-table-column label="面谈时间" width="160"><template #default="{ row }">{{ row.interviewTime ? formatDateTime(row.interviewTime) : '未记录' }}</template></el-table-column>
          <el-table-column label="面谈方式" width="120"><template #default="{ row }">{{ row.method ? INTERVIEW_METHOD_LABELS[row.method as keyof typeof INTERVIEW_METHOD_LABELS] : '—' }}</template></el-table-column>
          <el-table-column label="录入人" width="100"><template #default="{ row }">{{ row.recordedByName || '—' }}</template></el-table-column>
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openDrawer(row as PerformanceInterview, true)">查看详情</el-button>
              <el-button link type="primary" @click="openDrawer(row as PerformanceInterview)">编辑</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div v-loading="loading" class="mobile-result-list">
        <el-empty v-if="!loading && !list.length && !loadError" description="暂无面谈记录" />
        <MobileResultCard v-for="item in list" :key="item.id">
          <template #title>{{ item.employeeName }}<template v-if="item.employeeNo"> · {{ item.employeeNo }}</template></template>
          <div v-for="field in [
            ['部门', item.deptName || '—'], ['关联周期', item.cycleName || '未关联周期'],
            ['面谈人', item.interviewerName || '—'], ['面谈时间', item.interviewTime ? formatDateTime(item.interviewTime) : '未记录'],
            ['面谈方式', item.method ? INTERVIEW_METHOD_LABELS[item.method] : '—'], ['录入人', item.recordedByName || '—'],
          ]" :key="field[0]" class="mobile-result-field">
            <span class="mobile-result-field__label">{{ field[0] }}</span><span class="mobile-result-field__value">{{ field[1] }}</span>
          </div>
          <template #actions>
            <el-button link type="primary" @click="openDrawer(item, true)">查看详情</el-button>
            <el-button link type="primary" @click="openDrawer(item)">编辑</el-button>
          </template>
        </MobileResultCard>
      </div>
      <ListPagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="pageSizeOptions" :total="total" @change="loadList" />
    </ChartCard>
    <el-drawer v-model="drawerVisible" :title="!selectedInterviewId ? '新增面谈记录' : readonly ? '面谈详情' : '编辑面谈记录'"
      size="min(800px, 100vw)" destroy-on-close class="performance-result-drawer">
      <InterviewDrawer v-if="drawerVisible" :interview-id="selectedInterviewId" :readonly="readonly" :cycles="cycles" @saved="onSaved" @cancel="drawerVisible = false" />
    </el-drawer>
  </div>
</template>

<style scoped>
.employee-cell { display: flex; flex-direction: column; gap: 4px; }
.employee-no { font-size: 12px; color: var(--el-text-color-secondary); }
</style>
