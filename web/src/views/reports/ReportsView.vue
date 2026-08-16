<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { reportsApi } from '@/api/reports.api';
import { cyclesApi } from '@/api/cycles.api';
import { departmentsApi } from '@/api/departments.api';
import { usersApi } from '@/api/users.api';
import { useAuthStore } from '@/stores/auth.store';
import { useExport } from '@/composables/useExport';
import GradeDistChart from '@/components/charts/GradeDistChart.vue';
import ProgressPieChart from '@/components/charts/ProgressPieChart.vue';
import ScoreTrendChart from '@/components/charts/ScoreTrendChart.vue';
import GradeTag from '@/components/common/GradeTag.vue';
import DeptTree from '@/components/common/DeptTree.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import type {
  ReportSummary,
  ReportSummaryItem,
  ReportCycleProgress,
  EmployeeArchiveItem,
  AssessmentCycle,
  Department,
  User,
  ConsecutiveDWarningItem,
} from '@/types/api.types';
import type { PerfGrade, TaskStatus, CycleStatus } from '@/types/enums';
import { TASK_STATUS_META } from '@/types/enums';
import { GRADE_LABELS } from '@/utils/grade';
import dayjs from 'dayjs';
import { resolvePerformanceCycle } from '@/utils/performance-cycle';

const CYCLE_STATUS_LABELS: Record<CycleStatus, string> = {
  draft: '草稿',
  scheduled: '待开放',
  launch_blocked: '开放受阻',
  indicator_setting: '指标制定',
  self_eval: '员工自评',
  manager_score: '主管评分',
  hr_calibration: 'HR 校准',
  approval: '分管总审批',
  published: '已公示',
  appeal: '申诉中',
  closed: '已关闭',
};

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const { download: downloadExport, loading: exporting } = useExport({
  filename: 'reports-export.xlsx',
});

const GRADES: PerfGrade[] = ['A', 'B', 'C', 'D'];

const NODE_LABELS: Record<string, string> = {
  indicator_setting: '指标制定',
  self_eval: '员工自评',
  manager_scoring: '主管评分',
  hr_calibration: 'HR 校准',
  approval: '分管总审批',
  published: '结果公示',
};

const activeTab = ref('summary');
const cycles = ref<AssessmentCycle[]>([]);
const selectedCycleId = ref<string>('');
const loading = ref(false);

// 汇总
const summary = ref<ReportSummary | null>(null);
const departments = ref<Department[]>([]);
const deptFilter = ref<string>('');

// 进度
const progress = ref<ReportCycleProgress | null>(null);

// A/D 名单
const gradeList = ref<{ aList: ReportSummaryItem[]; cList: ReportSummaryItem[]; dList: ReportSummaryItem[] } | null>(null);

// 连续 D 预警
const consecutiveDData = ref<ConsecutiveDWarningItem[] | null>(null);

// 员工档案
const archiveEmployeeId = ref<string>('');
const archiveLoading = ref(false);
const archiveData = ref<EmployeeArchiveItem[]>([]);
const userOptions = ref<User[]>([]);
let userSearchTimer: number | undefined;
let reportsReady = false;
let reportCycleSyncing = false;

const isAdminLike = computed(() => ['hr', 'system_admin'].includes(auth.user?.sysRole ?? ''));
const canViewAdminTabs = computed(() => isAdminLike.value);

const selectedCycle = computed(() =>
  cycles.value.find((c) => c.id === selectedCycleId.value),
);

const gradeCounts = computed<Record<PerfGrade, number>>(() => {
  const counts: Record<PerfGrade, number> = { A: 0, B: 0, C: 0, D: 0 };
  if (!summary.value) return counts;
  for (const g of GRADES) {
    counts[g] = summary.value.stats.grades[g]?.count ?? 0;
  }
  return counts;
});

const deptStats = computed(() => {
  if (!summary.value) return [];
  const map = new Map<
    string,
    { deptName: string; count: number; totalScore: number; gradeCounts: Record<PerfGrade, number> }
  >();
  for (const item of summary.value.items) {
    const dept = item.deptName ?? '未分配部门';
    if (!map.has(dept)) {
      map.set(dept, {
        deptName: dept,
        count: 0,
        totalScore: 0,
        gradeCounts: { A: 0, B: 0, C: 0, D: 0 },
      });
    }
    const entry = map.get(dept)!;
    entry.count += 1;
    if (item.totalScore != null) {
      entry.totalScore += item.totalScore;
    }
    if (item.grade) {
      entry.gradeCounts[item.grade] += 1;
    }
  }
  return Array.from(map.values()).map((d) => ({
    ...d,
    averageScore: d.count > 0 ? d.totalScore / d.count : 0,
  }));
});

const progressPieData = computed(() => {
  if (!progress.value) return [];
  return (Object.entries(progress.value.byStatus) as [TaskStatus, number][])
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({
      name: TASK_STATUS_META[status]?.label ?? status,
      value: count,
    }));
});

const archiveTrendData = computed(() => {
  return [...archiveData.value]
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
    .map((item) => ({
      cycleName: item.cycleName,
      averageScore: item.totalScore,
    }));
});

function formatRatio(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatScore(n: number | null): string {
  return n == null ? '-' : n.toFixed(2);
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '-';
  return dayjs(date).format('YYYY-MM-DD');
}

async function loadCycles() {
  try {
    const res = await cyclesApi.findAll({});
    cycles.value = res.items;
  } catch {
    cycles.value = [];
  }
}

async function normalizeReportCycle() {
  const requestedCycleId = typeof route.query.cycleId === 'string'
    ? route.query.cycleId
    : undefined;
  const resolved = resolvePerformanceCycle(cycles.value, requestedCycleId);
  cycles.value = resolved.orderedCycles;
  selectedCycleId.value = resolved.selectedCycle?.id ?? '';

  if (selectedCycleId.value && requestedCycleId !== selectedCycleId.value) {
    await router.replace({ query: { ...route.query, cycleId: selectedCycleId.value } });
  } else if (!selectedCycleId.value && requestedCycleId) {
    const query = { ...route.query };
    delete query.cycleId;
    await router.replace({ query });
  }
}

async function loadDepartments() {
  if (!isAdminLike.value) return;
  try {
    departments.value = await departmentsApi.findAll({ pageSize: 1000 });
  } catch {
    departments.value = [];
  }
}

async function loadSummary() {
  if (!selectedCycleId.value) {
    summary.value = null;
    return;
  }
  loading.value = true;
  try {
    const query = deptFilter.value ? { deptId: deptFilter.value } : undefined;
    summary.value = await reportsApi.getCycleSummary(selectedCycleId.value, query);
  } catch {
    summary.value = null;
  } finally {
    loading.value = false;
  }
}

async function loadProgress() {
  if (!selectedCycleId.value) {
    progress.value = null;
    return;
  }
  loading.value = true;
  try {
    progress.value = await reportsApi.getCycleProgress(selectedCycleId.value);
  } catch {
    progress.value = null;
  } finally {
    loading.value = false;
  }
}

async function loadGradeList() {
  if (!selectedCycleId.value) {
    gradeList.value = null;
    return;
  }
  loading.value = true;
  try {
    gradeList.value = await reportsApi.getCycleGradeList(selectedCycleId.value);
  } catch {
    gradeList.value = null;
  } finally {
    loading.value = false;
  }
}

async function loadConsecutiveDWarning() {
  if (!isAdminLike.value) {
    consecutiveDData.value = null;
    return;
  }
  loading.value = true;
  try {
    consecutiveDData.value = await reportsApi.getConsecutiveDWarningList();
  } catch {
    consecutiveDData.value = null;
  } finally {
    loading.value = false;
  }
}

async function handleExport() {
  if (!selectedCycleId.value) return;
  const filename = selectedCycle.value
    ? `${selectedCycle.value.name}-绩效导出.xlsx`
    : `reports-export-${selectedCycleId.value}.xlsx`;
  await downloadExport(() => reportsApi.exportCycle(selectedCycleId.value), filename);
}

async function searchEmployees(keyword: string) {
  window.clearTimeout(userSearchTimer);
  if (!keyword.trim()) {
    userOptions.value = [];
    return;
  }
  userSearchTimer = window.setTimeout(async () => {
    try {
      const res = await usersApi.findAll({ keyword: keyword.trim(), page: 1, pageSize: 20 });
      userOptions.value = res.items;
    } catch {
      userOptions.value = [];
    }
  }, 300);
}

async function loadArchive() {
  if (!archiveEmployeeId.value) {
    archiveData.value = [];
    return;
  }
  archiveLoading.value = true;
  try {
    archiveData.value = await reportsApi.getEmployeeArchive(archiveEmployeeId.value);
  } catch (e) {
    archiveData.value = [];
    ElMessage.error(e instanceof Error ? e.message : '获取员工档案失败');
  } finally {
    archiveLoading.value = false;
  }
}

function onArchiveEmployeeChange(val: string) {
  archiveEmployeeId.value = val;
  loadArchive();
}

async function loadActiveReport() {
  if (!selectedCycleId.value) return;
  if (activeTab.value === 'summary') await loadSummary();
  else if (activeTab.value === 'progress') await loadProgress();
  else if (activeTab.value === 'gradeList') await loadGradeList();
}

async function selectReportCycle(cycleId: string) {
  if (!cycleId || cycleId === selectedCycleId.value) return;
  await router.push({ query: { ...route.query, cycleId } });
}

watch(
  () => route.query.cycleId,
  async (cycleId) => {
    if (!reportsReady) return;
    const requestedCycleId = typeof cycleId === 'string' ? cycleId : undefined;
    const resolved = resolvePerformanceCycle(cycles.value, requestedCycleId);
    const canonicalCycleId = resolved.selectedCycle?.id ?? '';
    if (canonicalCycleId && requestedCycleId !== canonicalCycleId) {
      await router.replace({ query: { ...route.query, cycleId: canonicalCycleId } });
      return;
    }
    if (!canonicalCycleId && requestedCycleId) {
      const query = { ...route.query };
      delete query.cycleId;
      await router.replace({ query });
      return;
    }
    if (selectedCycleId.value === canonicalCycleId) return;
    reportCycleSyncing = true;
    selectedCycleId.value = canonicalCycleId;
    deptFilter.value = '';
    archiveEmployeeId.value = '';
    archiveData.value = [];
    reportCycleSyncing = false;
    summary.value = null;
    progress.value = null;
    gradeList.value = null;
    await loadActiveReport();
  },
);

watch(activeTab, (tab) => {
  if (!reportsReady || !selectedCycleId.value) return;
  if (tab === 'summary') loadSummary();
  if (tab === 'progress') loadProgress();
  if (tab === 'gradeList') loadGradeList();
  if (tab === 'consecutiveDWarning') loadConsecutiveDWarning();
});

watch(deptFilter, () => {
  if (!reportsReady || reportCycleSyncing) return;
  loadSummary();
});

onMounted(async () => {
  await Promise.all([loadCycles(), loadDepartments()]);
  await normalizeReportCycle();
  reportsReady = true;
  summary.value = null;
  progress.value = null;
  gradeList.value = null;
  await loadActiveReport();
});
</script>

<template>
  <div class="reports-view page-stack">
    <ChartCard class="header-card">
      <template #title>绩效看板 / 报表</template>
      <template #extra>
          <div class="header-tools">
            <el-select
              :model-value="selectedCycleId"
              data-testid="report-cycle-select"
              :placeholder="cycles.length ? '选择考核周期' : '暂无考核周期'"
              style="width: 280px"
              :loading="loading"
              :disabled="cycles.length === 0"
              @change="selectReportCycle"
            >
              <el-option v-if="cycles.length === 0" label="暂无考核周期" value="" disabled />
              <el-option
                v-for="cycle in cycles"
                :key="cycle.id"
                :label="cycle.name"
                :value="cycle.id"
              />
            </el-select>
            <el-button
              v-if="canViewAdminTabs"
              data-testid="report-export"
              type="primary"
              :loading="exporting"
              @click="handleExport"
            >
              导出 Excel
            </el-button>
          </div>
      </template>

      <div v-if="selectedCycle" class="cycle-info">
        <el-descriptions :column="4" size="small" border>
          <el-descriptions-item label="周期">{{ selectedCycle.name }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            {{ CYCLE_STATUS_LABELS[selectedCycle.status] }}
          </el-descriptions-item>
          <el-descriptions-item label="开始">{{ formatDate(selectedCycle.startDate) }}</el-descriptions-item>
          <el-descriptions-item label="结束">{{ formatDate(selectedCycle.endDate) }}</el-descriptions-item>
        </el-descriptions>
      </div>
    </ChartCard>

    <el-tabs v-model="activeTab" class="report-tabs">
      <el-tab-pane label="汇总" name="summary">
        <div v-loading="loading" class="tab-panel">
          <div v-if="summary" class="summary-section">
            <el-row :gutter="16" class="stats-row">
              <el-col :xs="12" :sm="8" :md="4">
                <div class="stat-card">
                  <div class="stat-value">{{ summary.stats.total }}</div>
                  <div class="stat-label">参评人数</div>
                </div>
              </el-col>
              <el-col
                v-for="grade in GRADES"
                :key="grade"
                :xs="12"
                :sm="8"
                :md="4"
              >
                <div class="stat-card">
                  <div class="stat-value">
                    <GradeTag :grade="grade" size="small" />
                    {{ summary.stats.grades[grade]?.count ?? 0 }}
                  </div>
                  <div class="stat-label">
                    {{ GRADE_LABELS[grade] }}
                    <span class="stat-ratio">
                      {{ formatRatio(summary.stats.grades[grade]?.ratio ?? 0) }}
                    </span>
                  </div>
                </div>
              </el-col>
            </el-row>

            <el-row :gutter="16" class="chart-row">
              <el-col :xs="24" :md="12">
                <ChartCard>
                  <template #title>等级分布</template>
                  <GradeDistChart :data="gradeCounts" title="" :height="280" />
                </ChartCard>
              </el-col>
              <el-col :xs="24" :md="12">
                <ChartCard>
                  <template #title>部门维度</template>
                  <template #extra>
                    <DeptTree
                      v-if="canViewAdminTabs"
                      v-model="deptFilter"
                      :departments="departments"
                      placeholder="筛选部门"
                      clearable
                      style="width: 220px"
                    />
                  </template>
                  <el-table :data="deptStats" size="small" max-height="320">
                    <el-table-column prop="deptName" label="部门" min-width="140" show-overflow-tooltip />
                    <el-table-column prop="count" label="人数" width="80" />
                    <el-table-column label="平均分" width="100">
                      <template #default="{ row }">
                        {{ formatScore(row.averageScore) }}
                      </template>
                    </el-table-column>
                    <el-table-column label="等级分布" min-width="160">
                      <template #default="{ row }">
                        <div class="dist-tags">
                          <span
                            v-for="grade in GRADES"
                            :key="grade"
                            class="dist-item"
                          >
                            <GradeTag :grade="grade" size="small" />
                            <span class="dist-count">{{ row.gradeCounts[grade] }}</span>
                          </span>
                        </div>
                      </template>
                    </el-table-column>
                  </el-table>
                </ChartCard>
              </el-col>
            </el-row>

            <ChartCard class="detail-card">
              <template #title>汇总明细</template>
              <el-table :data="summary.items" size="small">
                <el-table-column prop="employeeName" label="姓名" min-width="100" />
                <el-table-column prop="employeeNo" label="工号" min-width="120" />
                <el-table-column prop="deptName" label="部门" min-width="140" show-overflow-tooltip />
                <el-table-column prop="position" label="职位" min-width="140" show-overflow-tooltip />
                <el-table-column label="总分" width="100">
                  <template #default="{ row }">
                    {{ formatScore(row.totalScore) }}
                  </template>
                </el-table-column>
                <el-table-column label="等级" width="100">
                  <template #default="{ row }">
                    <GradeTag :grade="row.grade" size="small" />
                  </template>
                </el-table-column>
                <el-table-column prop="managerName" label="主管" min-width="120" />
              </el-table>
            </ChartCard>
          </div>
          <EmptyState v-else description="选择考核周期后查看汇总报表" />
        </div>
      </el-tab-pane>

      <el-tab-pane v-if="canViewAdminTabs" label="进度" name="progress" lazy>
        <div v-loading="loading" class="tab-panel">
          <div v-if="progress" class="progress-section">
            <el-row :gutter="16">
              <el-col :xs="24" :md="12">
                <ChartCard>
                  <template #title>状态分布</template>
                  <ProgressPieChart
                    v-if="progressPieData.length > 0"
                    :data="progressPieData"
                    title=""
                    :height="320"
                  />
                  <EmptyState v-else description="暂无状态分布数据" />
                </ChartCard>
              </el-col>
              <el-col :xs="24" :md="12">
                <ChartCard>
                  <template #title>节点超期情况</template>
                  <el-table :data="progress.overdueByNode" size="small">
                    <el-table-column label="节点" min-width="140">
                      <template #default="{ row }">
                        {{ NODE_LABELS[row.node] ?? row.node }}
                      </template>
                    </el-table-column>
                    <el-table-column prop="overdueCount" label="超期数" width="100" />
                  </el-table>
                </ChartCard>
              </el-col>
            </el-row>
          </div>
          <EmptyState v-else description="选择考核周期后查看进度" />
        </div>
      </el-tab-pane>

      <el-tab-pane v-if="canViewAdminTabs" label="A/C/D 名单" name="gradeList" lazy>
        <div v-loading="loading" class="tab-panel">
          <div v-if="gradeList" class="grade-list-section">
            <el-row :gutter="16">
              <el-col :xs="24" :md="8">
                <ChartCard>
                  <template #title>
                    <span>A 级名单（{{ gradeList.aList.length }} 人）</span>
                  </template>
                  <el-table :data="gradeList.aList" size="small" max-height="480">
                    <el-table-column prop="employeeName" label="姓名" min-width="100" />
                    <el-table-column prop="deptName" label="部门" min-width="140" show-overflow-tooltip />
                    <el-table-column prop="position" label="职位" min-width="140" show-overflow-tooltip />
                    <el-table-column label="总分" width="100">
                      <template #default="{ row }">
                        {{ formatScore(row.totalScore) }}
                      </template>
                    </el-table-column>
                    <el-table-column prop="managerName" label="主管" min-width="120" />
                  </el-table>
                </ChartCard>
              </el-col>
              <el-col :xs="24" :md="8">
                <ChartCard>
                  <template #title>
                    <span>C 级名单（{{ gradeList.cList.length }} 人）</span>
                  </template>
                  <el-table :data="gradeList.cList" size="small" max-height="480">
                    <el-table-column prop="employeeName" label="姓名" min-width="100" />
                    <el-table-column prop="deptName" label="部门" min-width="140" show-overflow-tooltip />
                    <el-table-column prop="position" label="职位" min-width="140" show-overflow-tooltip />
                    <el-table-column label="总分" width="100">
                      <template #default="{ row }">
                        {{ formatScore(row.totalScore) }}
                      </template>
                    </el-table-column>
                    <el-table-column prop="managerName" label="主管" min-width="120" />
                  </el-table>
                </ChartCard>
              </el-col>
              <el-col :xs="24" :md="8">
                <ChartCard>
                  <template #title>
                    <span>D 级名单（{{ gradeList.dList.length }} 人）</span>
                  </template>
                  <el-table :data="gradeList.dList" size="small" max-height="480">
                    <el-table-column prop="employeeName" label="姓名" min-width="100" />
                    <el-table-column prop="deptName" label="部门" min-width="140" show-overflow-tooltip />
                    <el-table-column prop="position" label="职位" min-width="140" show-overflow-tooltip />
                    <el-table-column label="总分" width="100">
                      <template #default="{ row }">
                        {{ formatScore(row.totalScore) }}
                      </template>
                    </el-table-column>
                    <el-table-column prop="managerName" label="主管" min-width="120" />
                  </el-table>
                </ChartCard>
              </el-col>
            </el-row>
          </div>
          <EmptyState v-else description="选择考核周期后查看 A/C/D 名单" />
        </div>
      </el-tab-pane>

      <el-tab-pane v-if="canViewAdminTabs" label="员工档案" name="archive" lazy>
        <div v-loading="archiveLoading" class="tab-panel">
          <ChartCard class="archive-search-card">
            <template #title>查询员工历史绩效</template>
            <el-select
              v-model="archiveEmployeeId"
              placeholder="输入姓名 / 工号搜索"
              filterable
              remote
              clearable
              :remote-method="searchEmployees"
              style="width: 320px"
              @change="onArchiveEmployeeChange"
            >
              <el-option
                v-for="user in userOptions"
                :key="user.id"
                :label="`${user.name} (${user.employeeNo ?? '-'})`"
                :value="user.id"
              />
            </el-select>
          </ChartCard>

          <template v-if="archiveData.length > 0">
            <ChartCard class="archive-chart-card">
              <template #title>历史得分趋势</template>
              <ScoreTrendChart :data="archiveTrendData" title="" :height="320" />
            </ChartCard>

            <ChartCard>
              <template #title>历史归档</template>
              <el-table :data="archiveData" size="small">
                <el-table-column prop="cycleName" label="考核周期" min-width="160" />
                <el-table-column prop="startDate" label="开始日期" min-width="120">
                  <template #default="{ row }">
                    {{ formatDate(row.startDate) }}
                  </template>
                </el-table-column>
                <el-table-column prop="endDate" label="结束日期" min-width="120">
                  <template #default="{ row }">
                    {{ formatDate(row.endDate) }}
                  </template>
                </el-table-column>
                <el-table-column label="总分" width="100">
                  <template #default="{ row }">
                    {{ formatScore(row.totalScore) }}
                  </template>
                </el-table-column>
                <el-table-column label="等级" width="100">
                  <template #default="{ row }">
                    <GradeTag :grade="row.grade" size="small" />
                  </template>
                </el-table-column>
              </el-table>
            </ChartCard>
          </template>
          <EmptyState v-else-if="!archiveEmployeeId" description="搜索并选择员工后查看历史绩效" />
          <EmptyState v-else description="暂无该员工的历史绩效记录" />
        </div>
      </el-tab-pane>

      <el-tab-pane v-if="canViewAdminTabs" label="连续D预警" name="consecutiveDWarning" lazy>
        <div v-loading="loading" class="tab-panel">
          <ChartCard v-if="consecutiveDData && consecutiveDData.length > 0">
            <template #title>末尾淘汰预警名单（{{ consecutiveDData.length }} 人）</template>
            <el-table :data="consecutiveDData" size="small" max-height="560">
              <el-table-column prop="employeeName" label="姓名" min-width="100" />
              <el-table-column prop="employeeNo" label="工号" min-width="120" />
              <el-table-column prop="deptName" label="部门" min-width="140" show-overflow-tooltip />
              <el-table-column prop="consecutiveCount" label="连续D次数" width="110" />
              <el-table-column label="最近考核周期" min-width="260">
                <template #default="{ row }">
                  <div v-for="archive in row.archives" :key="archive.cycleId" class="archive-line">
                    {{ archive.cycleName }} <GradeTag :grade="archive.grade" size="small" />
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </ChartCard>
          <EmptyState v-else description="暂无连续D预警员工" />
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.reports-view :deep(.el-table) {
  --el-table-border-color: transparent;
  --el-table-header-bg-color: #fafbfc;
}

.reports-view :deep(.el-table th.el-table__cell) {
  background: #fafbfc;
  color: var(--app-text-secondary);
  font-weight: 600;
}

.header-tools {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.cycle-info {
  margin-top: 8px;
}

.report-tabs :deep(.el-tabs__content) {
  padding-top: 16px;
}

.tab-panel {
  min-height: 240px;
}

.summary-section,
.progress-section,
.grade-list-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stats-row {
  margin-bottom: 8px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px 8px;
  background: #f6f8fa;
  border-radius: 8px;
  text-align: center;
}

.stat-value {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 20px;
  font-weight: 600;
  color: #333;
}

.stat-label {
  font-size: 13px;
  color: #666;
}

.stat-ratio {
  margin-left: 4px;
  color: #999;
}

.chart-row {
  margin-bottom: 8px;
}

.dept-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.dist-tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.dist-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dist-count {
  font-size: 12px;
  color: #666;
}

.detail-card,
.archive-search-card,
.archive-chart-card {
  margin-bottom: 16px;
}

.archive-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

@media (max-width: 768px) {
  .header-row,
  .header-tools {
    flex-direction: column;
    align-items: flex-start;
  }

  .header-tools .el-select {
    width: 100% !important;
  }

  .el-button {
    width: 100%;
  }
}
</style>
