<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth.store';
import { interviewsApi } from '@/api/interviews.api';
import { usePagination } from '@/composables/usePagination';
import { INTERVIEW_METHOD_LABELS, INTERVIEW_STATUS_LABELS } from '@/types/enums';
import { formatDate, isOverdue, daysUntilDeadline } from '@/utils/date';
import InterviewDrawer from './InterviewDrawer.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import PerformanceRecordFilters from '@/components/common/PerformanceRecordFilters.vue';
import { cyclesApi } from '@/api/cycles.api';
import { departmentsApi } from '@/api/departments.api';
import { orderPerformanceCyclesByCreatedAt } from '@/utils/performance-cycle';
import type { AssessmentCycle, Department, PerformanceInterview } from '@/types/api.types';
import type { InterviewStatus } from '@/types/enums';

const auth = useAuthStore();
const user = computed(() => auth.user);

const list = ref<PerformanceInterview[]>([]);
const loading = ref(false);
const cycles = ref<AssessmentCycle[]>([]);
const departments = ref<Department[]>([]);
const filters = reactive<{ cycleId: string; deptId: string; status: InterviewStatus | ''; keyword: string }>({
  cycleId: '',
  deptId: '',
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

const drawerVisible = ref(false);
const selectedInterviewId = ref('');
const selectedReadonly = ref(false);

const statusOptions: InterviewStatus[] = ['pending', 'filled', 'employee_signed', 'closed'];

onMounted(async () => {
  const [cycleItems, departmentItems] = await Promise.all([
    (['hr', 'system_admin'].includes(user.value?.sysRole ?? '')
      ? cyclesApi.findAllOptions()
      : cyclesApi.findMine()).catch(() => [] as AssessmentCycle[]),
    departmentsApi.findAll({ isActive: true, pageSize: 1000 }).catch(() => [] as Department[]),
  ]);
  cycles.value = orderPerformanceCyclesByCreatedAt(cycleItems);
  departments.value = departmentItems;
  filters.cycleId = cycles.value[0]?.id ?? '';
  await loadList();
});

async function loadList() {
  loading.value = true;
  try {
    const res = await interviewsApi.findAll(
      withParams({
        status: filters.status || undefined,
        cycleId: filters.cycleId || undefined,
        deptId: filters.deptId || undefined,
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
  filters.cycleId = cycles.value[0]?.id ?? '';
  filters.deptId = '';
  filters.keyword = '';
  resetPagination();
  loadList();
}

function openDrawer(item: PerformanceInterview, readonly = false) {
  selectedInterviewId.value = item.id;
  selectedReadonly.value = readonly;
  drawerVisible.value = true;
}

function onDrawerSaved() {
  loadList();
}

function statusType(status: InterviewStatus): string {
  return INTERVIEW_STATUS_LABELS[status]?.type ?? 'info';
}

function statusLabel(status: InterviewStatus): string {
  return INTERVIEW_STATUS_LABELS[status]?.label ?? status;
}
</script>

<template>
  <div class="interview-list page-stack app-list-page">
    <ChartCard class="list-page-header-card">
      <template #title>绩效面谈工作台</template>
      <template #extra>
        <el-tag type="info" size="small">仅展示需由我面谈的记录</el-tag>
      </template>

      <PerformanceRecordFilters
        v-model:cycle-id="filters.cycleId"
        v-model:dept-id="filters.deptId"
        v-model:keyword="filters.keyword"
        :cycles="cycles"
        :departments="departments"
        :loading="loading"
        class="page-filter-panel"
        @search="onSearch"
        @reset="onReset"
      >
          <div class="performance-record-filter-extra">
            <label>状态</label>
            <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 160px">
              <el-option
                v-for="s in statusOptions"
                :key="s"
                :label="statusLabel(s)"
                :value="s"
              />
            </el-select>
          </div>
      </PerformanceRecordFilters>
    </ChartCard>

    <ChartCard :padded="false" class="list-card list-result-card">
      <div class="desktop-result-table">
      <el-table v-loading="loading" class="app-table" :data="list" height="100%">
        <el-table-column label="员工" min-width="160">
          <template #default="{ row }">
            <div class="employee-cell">
              <span class="employee-name">{{ row.employeeName || '-' }}</span>
              <span v-if="row.employeeNo" class="employee-no">{{ row.employeeNo }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="deptName" label="部门" min-width="140" />
        <el-table-column label="考核周期" min-width="140">
          <template #default="{ row }">{{ row.cycleName || '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status) as any" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="面谈方式" width="120">
          <template #default="{ row }">
            {{ (row as PerformanceInterview).method ? INTERVIEW_METHOD_LABELS[(row as PerformanceInterview).method!] : '-' }}
          </template>
        </el-table-column>
        <el-table-column label="截止日" width="140">
          <template #default="{ row }">
            <span :class="{ 'text-danger': row.deadline && isOverdue(row.deadline) }">
              {{ row.deadline ? formatDate(row.deadline) : '-' }}
            </span>
            <el-tag
              v-if="row.deadline && daysUntilDeadline(row.deadline) !== null"
              size="small"
              :type="isOverdue(row.deadline) ? 'danger' : 'warning'"
              class="deadline-tag"
            >
              {{ isOverdue(row.deadline) ? '逾期' : `${daysUntilDeadline(row.deadline)}天` }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="签字状态" width="140">
          <template #default="{ row }">
            <div class="sign-cell">
              <span :class="row.managerSignedAt ? 'signed' : 'unsigned'">主管{{ row.managerSignedAt ? '已签' : '未签' }}</span>
              <span :class="row.employeeSignedAt ? 'signed' : 'unsigned'">员工{{ row.employeeSignedAt ? '已签' : '未签' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDrawer(row as PerformanceInterview, (row as PerformanceInterview).interviewerId !== user?.id)">
              {{ (row as PerformanceInterview).interviewerId === user?.id ? '填写' : '查看' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      </div>

      <div v-loading="loading" class="mobile-result-list">
        <MobileResultCard v-for="item in list" :key="item.id">
          <template #title>{{ item.employeeName || '-' }}<template v-if="item.employeeNo"> · {{ item.employeeNo }}</template></template>
          <template #status>
            <el-tag :type="statusType(item.status) as any" size="small">{{ statusLabel(item.status) }}</el-tag>
          </template>
          <div class="mobile-result-field">
            <span class="mobile-result-field__label">部门</span>
            <span class="mobile-result-field__value">{{ item.deptName || '-' }}</span>
          </div>
          <div class="mobile-result-field">
            <span class="mobile-result-field__label">考核周期</span>
            <span class="mobile-result-field__value">{{ item.cycleName || '-' }}</span>
          </div>
          <div class="mobile-result-field">
            <span class="mobile-result-field__label">截止日</span>
            <span class="mobile-result-field__value">{{ item.deadline ? formatDate(item.deadline) : '-' }}</span>
          </div>
          <div class="mobile-result-field">
            <span class="mobile-result-field__label">签字状态</span>
            <span class="mobile-result-field__value">主管{{ item.managerSignedAt ? '已签' : '未签' }} · 员工{{ item.employeeSignedAt ? '已签' : '未签' }}</span>
          </div>
          <template #actions>
            <el-button link type="primary" @click="openDrawer(item, item.interviewerId !== user?.id)">
              {{ item.interviewerId === user?.id ? '填写' : '查看' }}
            </el-button>
          </template>
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

    <el-drawer
      v-model="drawerVisible"
      title="面谈记录"
      size="800"
      destroy-on-close
    >
      <InterviewDrawer
        v-if="selectedInterviewId"
        :interview-id="selectedInterviewId"
        :readonly="selectedReadonly"
        @saved="onDrawerSaved"
        @signed="onDrawerSaved"
      />
    </el-drawer>
  </div>
</template>

<style scoped>
.employee-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.employee-name {
  font-weight: 500;
}

.employee-no {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.deadline-tag {
  margin-left: 8px;
}

.text-danger {
  color: var(--el-color-danger);
}

.sign-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.signed {
  color: var(--el-color-success);
}

.unsigned {
  color: var(--el-text-color-secondary);
}
</style>
