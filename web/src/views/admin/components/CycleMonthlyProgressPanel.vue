<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { periodReviewsApi } from '@/api/period-reviews.api';
import type {
  PeriodMonitoringQuery,
  PeriodMonitoringResult,
  PeriodMonitoringRow,
  PeriodMonitoringStatus,
} from '@/types/api.types';

const props = withDefaults(defineProps<{
  cycleId: string;
  periodKeys?: string[];
  canEdit?: boolean;
}>(), { periodKeys: () => [], canEdit: false });

const loading = ref(false);
const error = ref('');
const result = ref<PeriodMonitoringResult | null>(null);
const periodKey = ref('');
const status = ref<PeriodMonitoringStatus | ''>('');
const keyword = ref('');
const reopeningId = ref('');

const statusOptions: Array<{ value: PeriodMonitoringStatus; label: string }> = [
  { value: 'employee_pending', label: '待员工月度自评' },
  { value: 'employee_overdue', label: '月度自评已逾期' },
  { value: 'manager_pending', label: '待主管月度评分' },
  { value: 'manager_completed', label: '主管月度评分已完成' },
];
const rows = computed(() => result.value?.items ?? []);

function statusLabel(value: PeriodMonitoringStatus) {
  return statusOptions.find((item) => item.value === value)?.label ?? value;
}

function statusType(value: PeriodMonitoringStatus): 'danger' | 'warning' | 'success' | 'info' {
  return value === 'employee_overdue' ? 'danger'
    : value === 'manager_completed' ? 'success'
      : value === 'manager_pending' ? 'warning'
        : 'info';
}

async function load() {
  if (!props.cycleId) return;
  loading.value = true;
  error.value = '';
  const query: PeriodMonitoringQuery = {
    page: 1,
    pageSize: 100,
    periodKey: periodKey.value || undefined,
    status: status.value || undefined,
    keyword: keyword.value.trim() || undefined,
  };
  try {
    result.value = await periodReviewsApi.findCycleMonitoring(props.cycleId, query);
  } catch (loadError) {
    const candidate = loadError as { message?: string; response?: { data?: { message?: string } } };
    error.value = candidate.response?.data?.message || candidate.message || '月度自评进度加载失败';
  } finally {
    loading.value = false;
  }
}

async function reopen(row: PeriodMonitoringRow) {
  if (!props.canEdit || !row.canReopen || reopeningId.value) return;
  let reason = '';
  try {
    const response = await ElMessageBox.prompt(
      '将清除当前主管评分及未公示的下游结果，员工需重新提交，主管需重新评分；历史记录保留。',
      `重新开放${row.periodKey}月度自评`,
      {
        confirmButtonText: '确认重新开放',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputPlaceholder: '请填写重新开放原因',
        inputValidator: (value) => value.trim().length > 0 || '请填写重新开放原因',
      },
    );
    reason = response.value.trim();
  } catch {
    return;
  }
  reopeningId.value = row.id;
  try {
    await periodReviewsApi.reopenPeriodReview(row.id, {
      expectedVersion: row.draftVersion,
      reason,
    });
    ElMessage.success('月度自评已重新开放');
    await load();
  } finally {
    reopeningId.value = '';
  }
}

watch(() => props.cycleId, () => void load());
onMounted(() => void load());
</script>

<template>
  <section class="monthly-monitor" data-testid="cycle-monthly-progress-panel">
    <header>
      <div><h2>月度自评进度</h2><p>按月查看员工提交与主管评分状态；逾期仅提醒，不自动推进。</p></div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </header>
    <el-skeleton v-if="loading && !result" animated :rows="5" />
    <el-alert v-else-if="error" type="error" :closable="false" :title="error" show-icon />
    <template v-else-if="result">
      <div class="monthly-monitor__summary">
        <div><span>待员工月度自评</span><strong>{{ result.summary.employeePending }}</strong></div>
        <div class="is-danger"><span>月度自评已逾期</span><strong>{{ result.summary.employeeOverdue }}</strong></div>
        <div><span>待主管月度评分</span><strong>{{ result.summary.managerPending }}</strong></div>
        <div><span>主管月度评分已完成</span><strong>{{ result.summary.managerCompleted }}</strong></div>
      </div>
      <div class="monthly-monitor__filters">
        <el-select v-model="periodKey" clearable placeholder="全部月份" @change="load">
          <el-option v-for="key in periodKeys" :key="key" :label="key" :value="key" />
        </el-select>
        <el-select v-model="status" clearable placeholder="全部状态" @change="load">
          <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-input v-model="keyword" clearable placeholder="搜索员工姓名或工号" @keyup.enter="load" />
        <el-button type="primary" @click="load">查询</el-button>
      </div>
      <el-table class="monthly-monitor__table" :data="rows" empty-text="暂无符合条件的月度自评记录">
        <el-table-column label="月份" prop="periodKey" width="105" />
        <el-table-column label="员工" min-width="150">
          <template #default="{ row }"><strong>{{ row.employeeName }}</strong><small>{{ row.employeeNo || '—' }}</small></template>
        </el-table-column>
        <el-table-column label="部门" prop="deptName" min-width="120" />
        <el-table-column label="绩效直属上级" prop="managerName" min-width="120" />
        <el-table-column label="状态" min-width="160">
          <template #default="{ row }"><el-tag :type="statusType(row.derivedStatus)" effect="light">{{ statusLabel(row.derivedStatus) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" min-width="170" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canEdit && row.canReopen" link type="primary" :loading="reopeningId === row.id" @click="reopen(row as PeriodMonitoringRow)">重新开放月度自评</el-button>
            <span v-else class="monthly-monitor__blocked">{{ row.reopenBlockedReason || '—' }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="monthly-monitor__cards">
        <article v-for="row in rows" :key="row.id">
          <header><strong>{{ row.employeeName }}</strong><span>{{ row.periodKey }}</span></header>
          <p>{{ row.employeeNo || '无工号' }} · {{ row.deptName || '无部门' }} · {{ row.managerName || '无绩效直属上级' }}</p>
          <el-tag :type="statusType(row.derivedStatus)" effect="light">{{ statusLabel(row.derivedStatus) }}</el-tag>
          <el-button v-if="canEdit && row.canReopen" type="primary" plain :loading="reopeningId === row.id" @click="reopen(row)">重新开放月度自评</el-button>
          <small v-else>{{ row.reopenBlockedReason || '—' }}</small>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.monthly-monitor { display: grid; gap: 14px; padding: 18px; border: 1px solid #e6eaf1; border-radius: 14px; background: #fff; }
.monthly-monitor > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.monthly-monitor h2, .monthly-monitor p { margin: 0; }
.monthly-monitor h2 { color: #253047; font-size: 18px; }
.monthly-monitor header p { margin-top: 4px; color: #8490a3; font-size: 12px; }
.monthly-monitor__summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.monthly-monitor__summary > div { display: grid; gap: 5px; padding: 12px; border-radius: 9px; background: #f6f8fc; }
.monthly-monitor__summary span { color: #7e899c; font-size: 12px; }
.monthly-monitor__summary strong { color: #28344b; font-size: 24px; }
.monthly-monitor__summary .is-danger strong { color: #df4d4d; }
.monthly-monitor__filters { display: grid; grid-template-columns: 150px 190px minmax(220px, 1fr) auto; gap: 10px; }
.monthly-monitor__table small, .monthly-monitor__table strong { display: block; }
.monthly-monitor__table small, .monthly-monitor__blocked { color: #929bad; font-size: 11px; }
.monthly-monitor__cards { display: none; }
@media (max-width: 767px) {
  .monthly-monitor { padding: 14px; }
  .monthly-monitor__summary { grid-template-columns: 1fr 1fr; }
  .monthly-monitor__filters { grid-template-columns: 1fr; }
  .monthly-monitor__table { display: none; }
  .monthly-monitor__cards { display: grid; gap: 10px; }
  .monthly-monitor__cards article { display: grid; gap: 8px; padding: 12px; border: 1px solid #e5e9f1; border-radius: 10px; }
  .monthly-monitor__cards article header { display: flex; justify-content: space-between; }
  .monthly-monitor__cards article p { color: #7d889a; font-size: 12px; }
  .monthly-monitor__cards article small { color: #929bad; }
}
</style>
