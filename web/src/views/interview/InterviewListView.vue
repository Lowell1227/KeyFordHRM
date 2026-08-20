<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Search, RefreshRight } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import { interviewsApi } from '@/api/interviews.api';
import { usePagination } from '@/composables/usePagination';
import { INTERVIEW_METHOD_LABELS, INTERVIEW_STATUS_LABELS } from '@/types/enums';
import { formatDate, isOverdue, daysUntilDeadline } from '@/utils/date';
import InterviewDrawer from './InterviewDrawer.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import CollapsibleFilterPanel from '@/components/common/CollapsibleFilterPanel.vue';
import type { PerformanceInterview } from '@/types/api.types';
import type { InterviewStatus } from '@/types/enums';

const auth = useAuthStore();
const user = computed(() => auth.user);

const list = ref<PerformanceInterview[]>([]);
const loading = ref(false);
const filters = reactive<{ status: InterviewStatus | ''; keyword: string }>({
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

onMounted(() => {
  loadList();
});

async function loadList() {
  loading.value = true;
  try {
    const res = await interviewsApi.findAll(
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

    <ChartCard :padded="false" class="list-card list-result-card">
      <el-table v-loading="loading" class="app-table" :data="list" height="100%">
        <el-table-column label="员工" min-width="160">
          <template #default="{ row }">
            <div class="employee-cell">
              <span class="employee-name">{{ row.employeeName || '-' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="deptName" label="部门" min-width="140" />
        <el-table-column label="考核周期" min-width="140">
          <template #default="{ row }">{{ row.cycleId || '-' }}</template>
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
