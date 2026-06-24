<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Search, RefreshRight } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import { probationApi } from '@/api/probation.api';
import { usePagination } from '@/composables/usePagination';
import { PROBATION_STATUS_META } from '@/types/enums';
import { formatDate } from '@/utils/date';
import ChartCard from '@/components/common/ChartCard.vue';
import type { ProbationReview } from '@/types/api.types';
import type { ProbationReviewStatus } from '@/types/enums';

type ListMode = 'manage' | 'manager' | 'mine';

const props = defineProps<{
  mode: ListMode;
}>();

const emit = defineEmits<{
  (e: 'edit', row: ProbationReview): void;
}>();

const router = useRouter();
const auth = useAuthStore();
const user = computed(() => auth.user);

const list = ref<ProbationReview[]>([]);
const loading = ref(false);
const filters = reactive<{
  status: ProbationReviewStatus | '';
  keyword: string;
}>({ status: '', keyword: '' });

const {
  page,
  pageSize,
  total,
  pageSizeOptions,
  reset: resetPagination,
  withParams,
} = usePagination({ defaultPageSize: 10 });

const statusOptions: ProbationReviewStatus[] = [
  'pending',
  'indicator_setting',
  'self_eval',
  'manager_scoring',
  'closed',
];

const titleMap: Record<ListMode, string> = {
  manage: '试用期考核管理',
  manager: '试用期评分工作台',
  mine: '我的试用期考核',
};

onMounted(() => {
  loadList();
});

async function loadList() {
  loading.value = true;
  try {
    const query = withParams({
      status: filters.status || undefined,
      keyword: filters.keyword || undefined,
    } as Record<string, unknown>);

    let res;
    if (props.mode === 'manage') {
      res = await probationApi.findAll(query);
    } else if (props.mode === 'manager') {
      res = await probationApi.findManaged(query);
    } else {
      res = await probationApi.findMine(query);
    }
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

function statusLabel(status: ProbationReviewStatus): string {
  return PROBATION_STATUS_META[status]?.label ?? status;
}

function statusType(status: ProbationReviewStatus): string {
  return PROBATION_STATUS_META[status]?.type ?? 'info';
}

function goDetail(row: ProbationReview) {
  router.push(`/probation-reviews/${row.id}`);
}

function signSummary(row: ProbationReview): string {
  const roles = new Set(row.signatures?.map((s) => s.role) ?? []);
  const parts: string[] = [];
  if (roles.has('assessee')) parts.push('员工已签');
  if (roles.has('assessor')) parts.push('主管已签');
  if (roles.has('hr')) parts.push('HR已签');
  return parts.length ? parts.join(' / ') : '未签字';
}

function canEdit(row: ProbationReview): boolean {
  return props.mode === 'manage' && row.status !== 'closed';
}

function currentUserRole(row: ProbationReview): 'assessee' | 'assessor' | 'hr' | null {
  if (!user.value) return null;
  if (row.employeeId === user.value.id) return 'assessee';
  if (row.managerId === user.value.id) return 'assessor';
  if (['hr', 'system_admin'].includes(user.value.sysRole)) return 'hr';
  return null;
}

function actionLabel(row: ProbationReview): string {
  const role = currentUserRole(row);
  if (role === 'assessee' && row.status === 'self_eval') return '去自评';
  if (role === 'assessor' && row.status === 'manager_scoring') return '去评分';
  if (role === 'hr' && row.status !== 'closed') return '去归档';
  return '查看';
}
</script>

<template>
  <div class="probation-list page-stack">
    <ChartCard>
      <template #title>{{ titleMap[mode] }}</template>
      <template #extra>
        <slot name="header-extra" />
      </template>

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
        <el-form-item label="姓名">
          <el-input
            v-model="filters.keyword"
            placeholder="请输入姓名"
            clearable
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="onSearch">查询</el-button>
          <el-button :icon="RefreshRight" @click="onReset">重置</el-button>
        </el-form-item>
      </el-form>
    </ChartCard>

    <ChartCard :padded="false">
      <el-table v-loading="loading" :data="list" class="app-table"
        >
        <el-table-column label="员工" min-width="140">
          <template #default="{ row }">{{ (row as ProbationReview).employee?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="主管" min-width="140">
          <template #default="{ row }">{{ (row as ProbationReview).manager?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="HR" min-width="140">
          <template #default="{ row }">{{ (row as ProbationReview).hr?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusType((row as ProbationReview).status) as any" size="small"
              >{{ statusLabel((row as ProbationReview).status) }}</el-tag
            >
          </template>
        </el-table-column>
        <el-table-column label="计划转正日期" width="130">
          <template #default="{ row }">
            {{ formatDate((row as ProbationReview).plannedRegularDate) }}
          </template>
        </el-table-column>
        <el-table-column label="签字状态" width="180">
          <template #default="{ row }">
            <span class="sign-summary">{{ signSummary(row as ProbationReview) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="goDetail(row as ProbationReview)"
              >{{ actionLabel(row as ProbationReview) }}</el-button
            >
            <el-button
              v-if="canEdit(row as ProbationReview)"
              link
              type="warning"
              size="small"
              @click="emit('edit', row as ProbationReview)"
            >
              编辑
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

.sign-summary {
  font-size: 12px;
  color: var(--el-text-color-regular);
}
</style>
