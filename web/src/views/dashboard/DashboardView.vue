<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { DocumentChecked, Medal, TrendCharts, WalletFilled } from '@element-plus/icons-vue';
import { cyclesApi } from '@/api/cycles.api';
import { reportsApi } from '@/api/reports.api';
import { tasksApi } from '@/api/tasks.api';
import { useAuthStore } from '@/stores/auth.store';
import StatCard from '@/components/common/StatCard.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import DonutScoreChart from '@/components/charts/DonutScoreChart.vue';
import DeptResultChart from '@/components/charts/DeptResultChart.vue';
import { getGradeLabel, getGradeStyle } from '@/utils/grade';
import { resolvePerformanceCycle } from '@/utils/performance-cycle';
import {
  isTerminalTaskStatus,
  TASK_STATUS_STAGE,
  type TaskStageKey,
} from '@/views/task/task-stage';
import type { AssessmentCycle, ReportSummary, TaskListItem } from '@/types/api.types';
import type { PerfGrade, TeamTaskStage } from '@/types/enums';

const auth = useAuthStore();
const router = useRouter();

const isEmployee = computed(() => auth.user?.sysRole === 'employee');
const userRole = computed(() => auth.user?.sysRole ?? '');
const userId = computed(() => auth.user?.id ?? '');
const isDirectManager = computed(() => userRole.value === 'manager');
const canOpenManagementTask = computed(() => [
  'manager',
  'dept_head',
  'vp',
  'chairman',
  'hr',
  'system_admin',
].includes(userRole.value));
const summaryScopeLabel = computed(() => {
  if (auth.user?.canViewAll || userRole.value === 'hr' || userRole.value === 'system_admin') return '全公司';
  if (userRole.value === 'vp' || userRole.value === 'chairman') return '分管范围';
  if (userRole.value === 'dept_head') return '负责部门';
  if (userRole.value === 'manager') return '我的团队';
  return '可见范围';
});
const deptChartTitle = computed(() => `${summaryScopeLabel.value}及部门等级分布`);

const GRADES: PerfGrade[] = ['A', 'B', 'C', 'D'];
const GRADE_COLORS: Record<PerfGrade, string> = {
  A: '#5574f7',
  B: '#45d7c5',
  C: '#f8d84a',
  D: '#f15c8b',
};

const dashboardLoading = ref(false);
const cycles = ref<AssessmentCycle[]>([]);
const selectedCycleId = ref('');
const summary = ref<ReportSummary | null>(null);

const personalTask = ref<TaskListItem | null>(null);
const personalTaskLoading = ref(false);
const personalTaskError = ref(false);
const teamPending = ref<Record<TeamTaskStage, number | null>>({
  'goal-review': null,
  'manager-eval': null,
});
const teamLoading = ref<Record<TeamTaskStage, boolean>>({
  'goal-review': false,
  'manager-eval': false,
});
const teamErrors = ref<Record<TeamTaskStage, boolean>>({
  'goal-review': false,
  'manager-eval': false,
});
let taskEntryRequestSerial = 0;

const taskStageLabels: Record<TaskStageKey, string> = {
  'goal-setting': '目标制定',
  'goal-confirmation': '目标确认',
  'self-eval': '自评',
  result: '结果确认',
};

const personalTaskStageLabel = computed(() => {
  const task = personalTask.value;
  return task ? taskStageLabels[TASK_STATUS_STAGE[task.status]] : '';
});

function latestOpenTask(items: TaskListItem[]): TaskListItem | null {
  return items.find((task) => !isTerminalTaskStatus(task.status)) ?? null;
}

function resetTaskEntries() {
  personalTask.value = null;
  personalTaskError.value = false;
  teamPending.value = { 'goal-review': null, 'manager-eval': null };
  teamErrors.value = { 'goal-review': false, 'manager-eval': false };
}

function isCurrentTaskEntryRequest(requestId: number): boolean {
  return requestId === taskEntryRequestSerial;
}

async function loadPersonalTask(requestId: number) {
  try {
    const response = await tasksApi.findMine({ page: 1, pageSize: 20 });
    if (!isCurrentTaskEntryRequest(requestId)) return;
    personalTask.value = latestOpenTask(response.items);
  } catch {
    if (!isCurrentTaskEntryRequest(requestId)) return;
    personalTaskError.value = true;
  } finally {
    if (isCurrentTaskEntryRequest(requestId)) {
      personalTaskLoading.value = false;
    }
  }
}

async function loadTeamTaskCount(requestId: number, stage: TeamTaskStage) {
  try {
    const response = await tasksApi.findTeam({ page: 1, pageSize: 1, stage });
    if (!isCurrentTaskEntryRequest(requestId)) return;
    teamPending.value = { ...teamPending.value, [stage]: response.counts.pending };
  } catch {
    if (!isCurrentTaskEntryRequest(requestId)) return;
    teamErrors.value = { ...teamErrors.value, [stage]: true };
  } finally {
    if (isCurrentTaskEntryRequest(requestId)) {
      teamLoading.value = { ...teamLoading.value, [stage]: false };
    }
  }
}

function loadTaskEntries() {
  const requestId = ++taskEntryRequestSerial;
  const loadPersonal = isEmployee.value || isDirectManager.value;
  const loadTeam = isDirectManager.value;
  resetTaskEntries();
  personalTaskLoading.value = loadPersonal;
  teamLoading.value = { 'goal-review': loadTeam, 'manager-eval': loadTeam };

  if (loadPersonal) {
    void loadPersonalTask(requestId);
  } else {
    personalTaskLoading.value = false;
  }

  if (loadTeam) {
    void loadTeamTaskCount(requestId, 'goal-review');
    void loadTeamTaskCount(requestId, 'manager-eval');
  }
}

function openTask(taskId: string) {
  void router.push({ name: 'TaskDetail', params: { id: taskId }, query: { returnTo: '/tasks' } });
}

function openTeamWorkspace(stage: TeamTaskStage) {
  void router.push({ path: '/tasks', query: { scope: 'team', stage } });
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

const averageScore = computed(() => {
  const scores = summaryItems.value
    .map((item) => item.totalScore)
    .filter((score): score is number => typeof score === 'number');
  if (scores.length === 0) return '-';
  const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return avg.toFixed(2);
});

function ratioOf(grade: PerfGrade): number {
  return summary.value?.stats.grades[grade]?.ratio ?? 0;
}

function formatPercent(value: number): number {
  return Number((value * 100).toFixed(1));
}

const kpis = computed(() => [
  { label: '参评人数', value: totalCount.value, unit: '人', delta: null, icon: DocumentChecked, gradient: 'blue' as const },
  { label: '平均绩效', value: averageScore.value, unit: averageScore.value === '-' ? '' : '分', delta: null, icon: TrendCharts, gradient: 'purple' as const },
  { label: 'A（优秀）占比', value: formatPercent(ratioOf('A')), unit: '%', delta: null, icon: WalletFilled, gradient: 'red' as const },
  { label: 'D（不合格）占比', value: formatPercent(ratioOf('D')), unit: '%', delta: null, icon: Medal, gradient: 'gold' as const },
]);

const gradeDistribution = computed(() =>
  GRADES.map((grade) => ({
    name: `${grade}${getGradeLabel(grade)}`,
    value: gradeCounts.value[grade],
    color: GRADE_COLORS[grade],
  })),
);

const deptGradeRows = computed(() => {
  const deptMap = new Map<string, { deptName: string; total: number; counts: Record<PerfGrade, number> }>();
  for (const item of summaryItems.value) {
    const deptName = item.deptName || '未分配部门';
    if (!deptMap.has(deptName)) {
      deptMap.set(deptName, {
        deptName,
        total: 0,
        counts: { A: 0, B: 0, C: 0, D: 0 },
      });
    }
    const row = deptMap.get(deptName)!;
    row.total += 1;
    if (item.grade) row.counts[item.grade] += 1;
  }

  return [
    {
      deptName: summaryScopeLabel.value,
      total: totalCount.value,
      counts: gradeCounts.value,
    },
    ...Array.from(deptMap.values()).sort((a, b) => b.total - a.total),
  ];
});

const deptCategories = computed(() => deptGradeRows.value.map((row) => row.deptName));

const deptSeries = computed(() =>
  GRADES.map((grade) => ({
    name: `${grade}${getGradeLabel(grade)}`,
    color: GRADE_COLORS[grade],
    data: deptGradeRows.value.map((row) => row.counts[grade]),
  })),
);

const deptChartHeight = computed(() => Math.min(420, Math.max(280, deptGradeRows.value.length * 34 + 58)));

const passRate = computed(() => {
  const total = totalCount.value;
  const qualifiedCount = gradeCounts.value.A + gradeCounts.value.B + gradeCounts.value.C;
  return {
    rate: total === 0 ? 0 : Number(((qualifiedCount / total) * 100).toFixed(1)),
    segments: [
      { label: 'A优秀', value: formatPercent(ratioOf('A')), count: gradeCounts.value.A, color: GRADE_COLORS.A },
      { label: 'B良好', value: formatPercent(ratioOf('B')), count: gradeCounts.value.B, color: GRADE_COLORS.B },
      { label: 'C待改进', value: formatPercent(ratioOf('C')), count: gradeCounts.value.C, color: GRADE_COLORS.C },
      { label: 'D不合格', value: formatPercent(ratioOf('D')), count: gradeCounts.value.D, color: GRADE_COLORS.D },
    ],
  };
});

const tableRows = computed(() =>
  summaryItems.value.map((item) => ({
    ...item,
    taskId: item.taskId ?? null,
    avatar: item.employeeName.slice(0, 1) || '员',
    cycle: selectedCycle.value?.name ?? '-',
  })),
);

function displayScore(score: number | null): string {
  return score == null ? '-' : `${score.toFixed(2)}分`;
}

function displayGrade(grade: PerfGrade | null): string {
  return grade ? `${grade}${getGradeLabel(grade)}` : '-';
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
  userRole,
  (role) => {
    if (role && role !== 'employee' && !dashboardLoaded) {
      dashboardLoaded = true;
      void loadDashboardData();
    }
  },
  { immediate: true },
);

watch(
  [userRole, userId],
  () => {
    loadTaskEntries();
  },
  { immediate: true },
);

onUnmounted(() => {
  taskEntryRequestSerial += 1;
});

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
          <p>只展示当前可继续处理的绩效任务。</p>
        </div>
      </section>

      <section class="task-entry-card" data-testid="employee-current-task">
        <template v-if="personalTaskLoading">
          <el-skeleton :rows="2" animated />
        </template>
        <template v-else-if="personalTaskError">
          <el-alert title="当前任务暂时无法加载，请稍后重试。" type="warning" :closable="false" show-icon />
        </template>
        <template v-else-if="personalTask">
          <div class="task-entry-card__main">
            <span class="task-entry-card__eyebrow">当前阶段</span>
            <strong>{{ personalTaskStageLabel }}</strong>
            <span class="task-entry-card__meta">{{ personalTask.cycleName || '当前考核周期' }}</span>
          </div>
          <el-button data-testid="employee-current-task-open" type="primary" @click="openTask(personalTask.id)">
            查看任务
          </el-button>
        </template>
        <EmptyState v-else description="HR 发起考核任务后，会在这里显示你的待办。" />
      </section>
    </template>

    <template v-else>
      <div v-loading="dashboardLoading" class="dashboard-admin">
      <section v-if="isDirectManager" class="manager-task-entry" aria-label="团队绩效待办">
        <article
          class="task-entry-card task-entry-card--personal"
          data-testid="manager-personal-task"
          :data-state="personalTaskLoading ? 'loading' : personalTaskError ? 'error' : personalTask ? 'ready' : 'empty'"
          :aria-busy="personalTaskLoading"
        >
          <template v-if="personalTaskLoading">
            <el-skeleton :rows="2" animated />
          </template>
          <template v-else-if="personalTaskError">
            <el-alert title="个人任务暂时无法加载。" type="warning" :closable="false" />
          </template>
          <template v-else-if="personalTask">
            <div class="task-entry-card__main">
              <span class="task-entry-card__eyebrow">我的任务</span>
              <strong>{{ personalTaskStageLabel }}</strong>
              <span class="task-entry-card__meta">{{ personalTask.cycleName || '当前考核周期' }}</span>
            </div>
            <el-button text type="primary" @click="openTask(personalTask.id)">查看</el-button>
          </template>
          <div v-else class="task-entry-card__empty">当前没有个人绩效任务</div>
        </article>

        <article
          class="task-entry-card"
          data-testid="manager-goal-review-card"
          :data-state="teamLoading['goal-review'] ? 'loading' : teamErrors['goal-review'] ? 'error' : 'ready'"
          :aria-busy="teamLoading['goal-review']"
        >
          <template v-if="teamLoading['goal-review']">
            <el-skeleton :rows="2" animated />
          </template>
          <template v-else-if="teamErrors['goal-review']">
            <el-alert title="目标审核待办暂时无法加载。" type="warning" :closable="false" />
          </template>
          <template v-else>
            <div class="task-entry-card__main">
              <span class="task-entry-card__eyebrow">团队待办</span>
              <strong data-testid="manager-goal-review-count">{{ teamPending['goal-review'] }}</strong>
              <span class="task-entry-card__meta">目标审核</span>
            </div>
            <el-button data-testid="manager-goal-review-open" text type="primary" @click="openTeamWorkspace('goal-review')">处理</el-button>
          </template>
        </article>

        <article
          class="task-entry-card"
          data-testid="manager-evaluation-card"
          :data-state="teamLoading['manager-eval'] ? 'loading' : teamErrors['manager-eval'] ? 'error' : 'ready'"
          :aria-busy="teamLoading['manager-eval']"
        >
          <template v-if="teamLoading['manager-eval']">
            <el-skeleton :rows="2" animated />
          </template>
          <template v-else-if="teamErrors['manager-eval']">
            <el-alert title="上级评价待办暂时无法加载。" type="warning" :closable="false" />
          </template>
          <template v-else>
            <div class="task-entry-card__main">
              <span class="task-entry-card__eyebrow">团队待办</span>
              <strong data-testid="manager-evaluation-count">{{ teamPending['manager-eval'] }}</strong>
              <span class="task-entry-card__meta">上级评价</span>
            </div>
            <el-button data-testid="manager-evaluation-open" text type="primary" @click="openTeamWorkspace('manager-eval')">处理</el-button>
          </template>
        </article>
      </section>
      <section class="dashboard-top">
        <div class="kpi-grid">
          <StatCard
            v-for="k in kpis"
            :key="k.label"
            :label="k.label"
            :value="k.value"
            :unit="k.unit"
            :delta="k.delta"
            :icon="k.icon"
            :gradient="k.gradient"
          />
        </div>
        <ChartCard class="grade-card" title="等级分布">
          <DonutScoreChart
            :data="gradeDistribution"
            :center-value="`${totalCount}人`"
            center-label="参评人数"
            :height="190"
          />
        </ChartCard>
      </section>

      <section class="dashboard-middle">
        <ChartCard :title="deptChartTitle">
          <template #extra>
            <span class="cycle-name" data-testid="dashboard-result-cycle">
              {{ selectedCycle?.name || '暂无考核周期' }}
            </span>
          </template>
          <DeptResultChart :categories="deptCategories" :series="deptSeries" :height="deptChartHeight" />
        </ChartCard>

        <ChartCard class="pass-rate-card" title="绩效考核合格率">
          <div class="pass-rate">
            <div class="pass-rate__big">{{ passRate.rate }}%</div>
            <div class="pass-rate__bar">
              <span
                v-for="s in passRate.segments"
                :key="s.label"
                class="pass-rate__seg"
                :style="{ width: `${s.value}%`, background: s.color }"
              />
            </div>
            <div class="pass-rate__percent">
              <span v-for="s in passRate.segments" :key="s.label">{{ s.value }}%</span>
            </div>
            <div class="pass-rate__stats">
              <div v-for="s in passRate.segments" :key="s.label" class="pass-rate__stat">
                <span class="pass-rate__badge" :style="{ background: s.color }">
                  <el-icon><Medal /></el-icon>
                </span>
                  <div class="pass-rate__count">{{ s.count }}</div>
                  <div class="pass-rate__label">{{ s.label }}</div>
              </div>
            </div>
          </div>
        </ChartCard>
      </section>

      <ChartCard class="detail-card" :padded="false">
        <el-table :data="tableRows" style="width: 100%" class="dash-table">
          <el-table-column label="考核人员" min-width="150">
            <template #default="{ row }">
              <div class="cell-user">
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
          <el-table-column prop="managerName" label="直属主管" min-width="110">
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

.dashboard-top,
.dashboard-middle {
  display: grid;
  gap: 14px;
}

.dashboard-top {
  grid-template-columns: minmax(0, 1fr) minmax(360px, 420px);
}

.dashboard-middle {
  grid-template-columns: minmax(0, 1fr) minmax(360px, 420px);
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
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

.task-entry-card,
.manager-task-entry {
  display: grid;
  gap: 12px;
}

.task-entry-card {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  min-height: 92px;
  padding: 18px 20px;
  background: var(--app-card-bg);
  border: 1px solid var(--app-border-color);
  border-radius: var(--app-radius);
  box-sizing: border-box;
}

.task-entry-card :deep(.el-skeleton) {
  grid-column: 1 / -1;
}

.task-entry-card :deep(.el-alert),
.task-entry-card .empty-state {
  grid-column: 1 / -1;
}

.task-entry-card .empty-state {
  padding: 0;
}

.task-entry-card__main {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.task-entry-card__eyebrow,
.task-entry-card__meta,
.task-entry-card__empty {
  color: var(--app-text-secondary);
  font-size: 13px;
}

.task-entry-card__main strong {
  color: var(--app-text-primary);
  font-size: 18px;
  line-height: 1.25;
}

.manager-task-entry {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.manager-task-entry .task-entry-card {
  min-height: 112px;
  box-shadow: var(--app-shadow);
}

.employee-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.employee-action {
  display: grid;
  grid-template-columns: 40px 1fr;
  grid-template-areas:
    "icon title"
    "icon desc";
  gap: 4px 12px;
  padding: 18px;
  text-align: left;
  background: #fff;
  border: 1px solid var(--app-border-color);
  border-radius: var(--app-radius);
  cursor: pointer;
}

.employee-action:hover {
  border-color: var(--el-color-primary);
}

.action-icon {
  grid-area: icon;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.action-icon--primary {
  color: #1d4ed8;
  background: #e0ecff;
}

.action-icon--success {
  color: #047857;
  background: #dcfce7;
}

.action-icon--warning {
  color: #b45309;
  background: #fef3c7;
}

.action-title {
  grid-area: title;
  font-weight: 700;
  color: var(--app-text-primary);
}

.action-desc {
  grid-area: desc;
  color: var(--app-text-secondary);
  font-size: 13px;
  line-height: 1.45;
}

.pass-rate {
  min-height: 250px;
  padding: 10px 16px 0;
  display: flex;
  flex-direction: column;
}

.pass-rate__big {
  font-size: 48px;
  font-weight: 300;
  color: var(--app-text-primary);
  line-height: 1;
  margin-bottom: 24px;
}

.pass-rate__bar {
  display: flex;
  height: 8px;
  border-radius: 8px;
  overflow: hidden;
  gap: 3px;
}

.pass-rate__seg {
  height: 100%;
  border-radius: 8px;
}

.pass-rate__percent {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
  color: #5e6478;
  font-size: 11px;
}

.pass-rate__stats {
  display: flex;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 34px;
}

.pass-rate__stat {
  text-align: center;
  min-width: 70px;
}

.pass-rate__badge {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

.pass-rate__count {
  font-size: 20px;
  font-weight: 700;
  color: var(--app-text-primary);
}

.pass-rate__label {
  font-size: 12px;
  color: var(--app-text-secondary);
  margin-top: 4px;
}

.cycle-name,
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
  .dashboard-top,
  .dashboard-middle {
    grid-template-columns: 1fr;
  }

  .pass-rate {
    padding-inline: 4px;
  }

  .pass-rate__big {
    font-size: 42px;
  }

  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .employee-hero {
    align-items: flex-start;
    flex-direction: column;
  }

  .employee-actions {
    grid-template-columns: 1fr;
  }

  .manager-task-entry {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .kpi-grid {
    grid-template-columns: 1fr;
  }

  .task-entry-card {
    padding: 16px;
  }

  .task-entry-card__main strong {
    font-size: 17px;
  }
}
</style>
