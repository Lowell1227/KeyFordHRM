<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { cyclesApi } from '@/api/cycles.api';
import { reportsApi } from '@/api/reports.api';
import { useAuthStore } from '@/stores/auth.store';
import ChartCard from '@/components/common/ChartCard.vue';
import DashboardTaskEntries from './DashboardTaskEntries.vue';
import { getGradeLabel, getGradeStyle } from '@/utils/grade';
import { resolvePerformanceCycle } from '@/utils/performance-cycle';
import type { AssessmentCycle, ReportSummary } from '@/types/api.types';
import type { PerfGrade } from '@/types/enums';

const auth = useAuthStore();
const router = useRouter();

const userRole = computed(() => auth.user?.sysRole ?? '');
const isDirectManager = computed(() => auth.isManager);
const canViewReports = computed(() => Boolean(auth.user?.businessCapabilities?.canViewReports));
const canOpenManagementTask = computed(() => Boolean(
  canViewReports.value
));
const isEmployee = computed(() => !canOpenManagementTask.value && !auth.canAccessAdmin);
const GRADES: PerfGrade[] = ['A', 'B', 'C', 'D'];

const dashboardLoading = ref(false);
const cycles = ref<AssessmentCycle[]>([]);
const selectedCycleId = ref('');
const summary = ref<ReportSummary | null>(null);

function openTask(taskId: string) {
  void router.push({ name: 'TaskDetail', params: { id: taskId }, query: { cycleId: selectedCycleId.value, returnTo: '/tasks' } });
}

const selectedCycle = computed(() => cycles.value.find((cycle) => cycle.id === selectedCycleId.value));

const summaryItems = computed(() => summary.value?.items ?? []);

const gradeCounts = computed<Record<PerfGrade, number>>(() => {
  const counts: Record<PerfGrade, number> = { A: 0, B: 0, C: 0, D: 0 };
  if (!summary.value) return counts;
  for (const grade of GRADES) {
    counts[grade] = summary.value.stats.grades[grade]?.count ?? 0;
  }
  return counts;
});

const totalCount = computed(() => summary.value?.stats.total ?? summaryItems.value.length);
const resultedCount = computed(() =>
  summary.value?.stats.resulted
  ?? GRADES.reduce((total, grade) => total + gradeCounts.value[grade], 0),
);
const pendingCount = computed(() =>
  summary.value?.stats.pending ?? Math.max(0, totalCount.value - resultedCount.value),
);
const qualifiedCount = computed(() =>
  summary.value?.stats.qualified
  ?? gradeCounts.value.A + gradeCounts.value.B + gradeCounts.value.C,
);
const qualifiedRate = computed(() =>
  summary.value?.stats.qualifiedRate
  ?? (resultedCount.value === 0 ? 0 : qualifiedCount.value / resultedCount.value),
);
const canOpenReports = canViewReports;

function formatPercent(value: number): number {
  return Number((value * 100).toFixed(1));
}

interface DashboardQuickAction {
  label: string;
  description: string;
  path: string;
}

const roleQuickActions = computed<DashboardQuickAction[]>(() => {
  const actions: DashboardQuickAction[] = [];
  if (userRole.value === 'hr' || userRole.value === 'system_admin') {
    actions.push(
      { label: '周期与计划', description: '发起周期、检查节点与参与范围', path: '/cycles' },
      { label: '绩效校准', description: '核对等级分布并完成校准', path: '/calibration' },
      { label: '结果公示', description: '确认审批状态并公示结果', path: '/publish' },
      { label: '申诉管理', description: '集中处理员工绩效申诉', path: '/appeals' },
    );
  }
  if (auth.canAccessPerformanceApproval) {
    actions.push(
      { label: '结果审批', description: '处理待审批的绩效结果', path: '/approval' },
    );
  }
  if (canViewReports.value) {
    actions.push(
      { label: '报表分析', description: '查看分管范围结果与重点关注', path: '/reports' },
    );
  }
  return actions;
});

const tableRows = computed(() =>
  summaryItems.value.map((item) => ({
    ...item,
    taskId: item.taskId ?? null,
    avatar: item.employeeName.slice(0, 1) || '员',
    cycle: selectedCycle.value?.name ?? '-',
  })),
);
const previewRows = computed(() => tableRows.value.slice(0, 5));

function openReports() {
  void router.push({ path: '/reports', query: selectedCycleId.value ? { cycleId: selectedCycleId.value } : {} });
}

function openRoute(path: string) {
  void router.push(path);
}

function displayScore(score: number | null): string {
  return score == null ? '-' : `${score.toFixed(2)}分`;
}

function displayGrade(grade: PerfGrade | null): string {
  return grade ? getGradeLabel(grade) : '-';
}

function pickDefaultCycle(items: AssessmentCycle[]): AssessmentCycle | undefined {
  const resultStatuses = ['published', 'appeal', 'closed'];
  const eligibleCycles = items.filter((cycle) => resultStatuses.includes(cycle.status));
  return resolvePerformanceCycle(eligibleCycles).selectedCycle ?? undefined;
}

async function loadDashboardData() {
  dashboardLoading.value = true;
  try {
    const cycleRes = await cyclesApi.findAll({ page: 1, pageSize: 50 });
    cycles.value = cycleRes.items;
    const cycle = pickDefaultCycle(cycles.value);
    selectedCycleId.value = cycle?.id ?? '';
    summary.value = selectedCycleId.value ? await reportsApi.getCycleSummary(selectedCycleId.value) : null;
  } catch {
    summary.value = null;
  } finally {
    dashboardLoading.value = false;
  }
}

let dashboardLoaded = false;

watch(
  canViewReports,
  (canView) => {
    if (canView && !dashboardLoaded) {
      dashboardLoaded = true;
      void loadDashboardData();
    }
  },
  { immediate: true },
);

function avatarColor(name: string): string {
  const colors = ['#2a9d8f', '#457b9d', '#e76f51', '#7b2cbf', '#f4a261'];
  let sum = 0;
  for (const ch of name) sum += ch.charCodeAt(0);
  return colors[sum % colors.length];
}
</script>

<template>
  <div class="dashboard">
    <template v-if="isEmployee">
      <section class="employee-hero">
        <div>
          <h2>{{ auth.user?.name || '员工' }}，这里是你的绩效工作台</h2>
          <p>查看各计划任务，继续处理当前待办。</p>
        </div>
      </section>
    </template>

    <DashboardTaskEntries />

    <template v-if="!isEmployee || isDirectManager || roleQuickActions.length">
      <div v-loading="dashboardLoading" class="dashboard-admin">
      <section v-if="roleQuickActions.length" class="quick-actions" data-testid="dashboard-quick-actions">
        <header class="quick-actions__header">
          <h2>常用工作入口</h2>
          <p>按当前系统权限和实际业务职责展示高频工作。</p>
        </header>
        <div class="quick-actions__grid">
          <button
            v-for="action in roleQuickActions"
            :key="action.path"
            class="quick-action"
            type="button"
            @click="openRoute(action.path)"
          >
            <span class="quick-action__label">{{ action.label }}</span>
            <span class="quick-action__description">{{ action.description }}</span>
            <span class="quick-action__link">进入 →</span>
          </button>
        </div>
      </section>

      <template v-if="canViewReports">
      <section class="result-summary" data-testid="dashboard-result-summary">
        <div class="result-summary__heading">
          <div>
            <span class="result-summary__eyebrow">最近公示结果</span>
            <h2 data-testid="dashboard-result-cycle">{{ selectedCycle?.name || '暂无已公示周期' }}</h2>
          </div>
          <el-button v-if="canOpenReports" type="primary" plain @click="openReports">查看完整报表</el-button>
        </div>
        <div class="result-summary__metrics">
          <div><span>应参评</span><strong>{{ totalCount }}</strong><small>人</small></div>
          <div><span>已出结果</span><strong>{{ resultedCount }}</strong><small>人</small></div>
          <div class="is-warning"><span>待出结果</span><strong>{{ pendingCount }}</strong><small>人</small></div>
          <div><span>已出结果合格率</span><strong>{{ formatPercent(qualifiedRate) }}</strong><small>%</small></div>
        </div>
        <p class="result-summary__note">合格率与等级占比仅按已出结果人员计算，未出结果人员不会被计为不合格。</p>
      </section>

      <ChartCard class="detail-card" title="最近结果预览（前 5 人）" :padded="false">
        <template #extra>
          <el-button v-if="canOpenReports" link type="primary" @click="openReports">查看全部</el-button>
        </template>
        <el-table :data="previewRows" style="width: 100%" class="dash-table">
          <el-table-column label="考核人员" min-width="150">
            <template #default="{ row }">
              <div class="cell-user" data-testid="dashboard-result-preview-row">
                <span class="cell-avatar" :style="{ background: avatarColor(row.employeeName) }">
                  {{ row.avatar }}
                </span>
                <div>
                  <div>{{ row.employeeName }}</div>
                  <div class="cell-sub">{{ row.employeeNo || '-' }}</div>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="deptName" label="部门" min-width="120">
            <template #default="{ row }">{{ row.deptName || '未分配部门' }}</template>
          </el-table-column>
          <el-table-column prop="position" label="岗位" min-width="120" />
          <el-table-column prop="cycle" label="考核周期" min-width="150" />
          <el-table-column prop="managerName" label="绩效直属上级" min-width="110">
            <template #default="{ row }">{{ row.managerName || '-' }}</template>
          </el-table-column>
          <el-table-column prop="totalScore" label="总分" min-width="100" align="center">
            <template #default="{ row }">{{ displayScore(row.totalScore) }}</template>
          </el-table-column>
          <el-table-column label="绩效等级" min-width="110" align="center">
            <template #default="{ row }">
              <span v-if="row.grade" class="grade-tag" :style="getGradeStyle(row.grade)">
                {{ displayGrade(row.grade) }}
              </span>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" min-width="90" align="center">
            <template #default="{ row }">
              <el-button
                v-if="row.taskId && canOpenManagementTask"
                :data-testid="`dashboard-task-open-${row.taskId}`"
                link
                type="primary"
                size="small"
                @click="openTask(row.taskId)"
              >
                查看
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </ChartCard>
      </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.dashboard-admin {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.employee-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px;
  background: #fff;
  border: 1px solid var(--app-border-color);
  border-radius: var(--app-radius);
}

.employee-hero h2 {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 700;
  color: var(--app-text-primary);
}

.employee-hero p {
  margin: 0;
  color: var(--app-text-secondary);
}

.quick-actions {
  padding: 18px 20px 20px;
  background: var(--app-card-bg);
  border: 1px solid var(--app-border-color);
  border-radius: var(--app-radius);
  box-shadow: var(--app-shadow);
}

.quick-actions__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.quick-actions__header h2 {
  margin: 0;
  color: var(--app-text-primary);
  font-size: 17px;
}

.quick-actions__header p {
  margin: 0;
  color: var(--app-text-secondary);
  font-size: 12px;
}

.quick-actions__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.quick-action {
  min-width: 0;
  padding: 14px;
  text-align: left;
  background: #f8faff;
  border: 1px solid #e4eaf4;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color var(--app-transition), transform var(--app-transition), box-shadow var(--app-transition);
}

.quick-action:hover,
.quick-action:focus-visible {
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 6px 18px rgb(64 111 222 / 10%);
  outline: none;
  transform: translateY(-1px);
}

.quick-action__label,
.quick-action__description,
.quick-action__link {
  display: block;
}

.quick-action__label {
  color: var(--app-text-primary);
  font-size: 15px;
  font-weight: 700;
}

.quick-action__description {
  min-height: 36px;
  margin-top: 6px;
  color: var(--app-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.quick-action__link {
  margin-top: 10px;
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 600;
}

.result-summary {
  padding: 20px;
  background: linear-gradient(135deg, #f6f9ff 0%, #fff 58%, #f2fbf8 100%);
  border: 1px solid #dce6f5;
  border-radius: var(--app-radius);
  box-shadow: var(--app-shadow);
}

.result-summary__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.result-summary__eyebrow {
  color: var(--app-text-secondary);
  font-size: 12px;
}

.result-summary__heading h2 {
  margin: 4px 0 0;
  color: var(--app-text-primary);
  font-size: 19px;
}

.result-summary__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 18px;
}

.result-summary__metrics > div {
  padding: 14px 16px;
  background: rgb(255 255 255 / 82%);
  border: 1px solid #e5eaf2;
  border-radius: 10px;
}

.result-summary__metrics span {
  display: block;
  margin-bottom: 6px;
  color: var(--app-text-secondary);
  font-size: 12px;
}

.result-summary__metrics strong {
  color: var(--app-text-primary);
  font-size: 26px;
  line-height: 1;
}

.result-summary__metrics small {
  margin-left: 3px;
  color: var(--app-text-secondary);
}

.result-summary__metrics .is-warning strong {
  color: var(--el-color-warning-dark-2);
}

.result-summary__note {
  margin: 12px 0 0;
  color: var(--app-text-secondary);
  font-size: 12px;
}

.cell-sub {
  color: var(--app-text-secondary);
  font-size: 12px;
}

.dash-table {
  border-radius: var(--app-radius);
}

.detail-card :deep(.chart-card__body) {
  padding: 0 18px 10px;
}

.cell-user {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cell-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 13px;
  flex-shrink: 0;
}

.grade-tag {
  display: inline-block;
  padding: 2px 12px;
  border-radius: 12px;
  border: 1px solid;
  font-size: 12px;
  font-weight: 600;
}

@media (max-width: 900px) {
  .quick-actions__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .result-summary__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .employee-hero {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 560px) {
  .quick-actions__grid {
    grid-template-columns: 1fr;
  }

  .quick-actions__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .result-summary {
    padding: 16px;
  }

  .result-summary__heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .result-summary__metrics {
    grid-template-columns: 1fr;
  }
}
</style>
