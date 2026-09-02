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
import type { PerfGrade, TaskStatus } from '@/types/enums';
import { TASK_STATUS_META } from '@/types/enums';
import { GRADE_LABELS } from '@/utils/grade';
import dayjs from 'dayjs';
import { resolvePerformanceCycle } from '@/utils/performance-cycle';
import { cycleBusinessState } from '@/views/admin/cycle-management';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const { download: downloadExport, loading: exporting } = useExport({
  filename: 'reports-export.xlsx',
});

const GRADES: PerfGrade[] = ['A', 'B', 'C', 'D'];

const NODE_LABELS: Record<string, string> = {
  indicator_setting: '目标制定',
  self_eval: '员工自评',
  manager_scoring: '主管评分',
  hr_calibration: '绩效校准',
  approval: '结果审批',
  published: '结果公示',
};

const activeTab = ref('result');
const cycles = ref<AssessmentCycle[]>([]);
const selectedCycleId = ref<string>('');
const loading = ref(false);

// 汇总
const summary = ref<ReportSummary | null>(null);
const departments = ref<Department[]>([]);
const deptFilter = ref<string>('');
const detailKeyword = ref('');
const detailGrade = ref<PerfGrade | ''>('');
const detailPage = ref(1);
const detailPageSize = 20;

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

const resultedCount = computed(() => (
  summary.value?.stats.resulted
  ?? GRADES.reduce((total, grade) => total + gradeCounts.value[grade], 0)
));

const pendingCount = computed(() => (
  summary.value?.stats.pending
  ?? Math.max(0, (summary.value?.stats.total ?? 0) - resultedCount.value)
));

const qualifiedCount = computed(() => (
  summary.value?.stats.qualified
  ?? gradeCounts.value.A + gradeCounts.value.B + gradeCounts.value.C
));

const qualifiedRate = computed(() => (
  summary.value?.stats.qualifiedRate
  ?? (resultedCount.value === 0 ? 0 : qualifiedCount.value / resultedCount.value)
));

const summaryInsight = computed(() => {
  if (!summary.value) return '';
  const dCount = gradeCounts.value.D;
  if (pendingCount.value > 0) {
    return `本周期还有 ${pendingCount.value} 人未出结果；D 级 ${dCount} 人。点击指标可查看对应人员与部门。`;
  }
  return `本周期 ${resultedCount.value} 人已全部出结果；D 级 ${dCount} 人。`;
});

const deptStats = computed(() => {
  if (!summary.value) return [];
  const map = new Map<
    string,
    {
      deptName: string;
      count: number;
      resulted: number;
      totalScore: number;
      gradeCounts: Record<PerfGrade, number>;
    }
  >();
  for (const item of summary.value.items) {
    const dept = item.deptName ?? '未分配部门';
    if (!map.has(dept)) {
      map.set(dept, {
        deptName: dept,
        count: 0,
        resulted: 0,
        totalScore: 0,
        gradeCounts: { A: 0, B: 0, C: 0, D: 0 },
      });
    }
    const entry = map.get(dept)!;
    entry.count += 1;
    if (item.totalScore != null) {
      entry.resulted += 1;
      entry.totalScore += item.totalScore;
    }
    if (item.grade) {
      entry.gradeCounts[item.grade] += 1;
    }
  }
  return Array.from(map.values()).map((d) => ({
    ...d,
    averageScore: d.resulted > 0 ? d.totalScore / d.resulted : null,
  }));
});

const filteredSummaryItems = computed(() => {
  const keyword = detailKeyword.value.trim().toLowerCase();
  return (summary.value?.items ?? []).filter((item) => {
    if (detailGrade.value && item.grade !== detailGrade.value) return false;
    if (!keyword) return true;
    return [item.employeeName, item.employeeNo, item.deptName, item.position, item.managerName]
      .some((value) => value?.toLowerCase().includes(keyword));
  });
});

const pagedSummaryItems = computed(() => {
  const start = (detailPage.value - 1) * detailPageSize;
  return filteredSummaryItems.value.slice(start, start + detailPageSize);
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

async function loadFocusReport() {
  await Promise.all([loadGradeList(), loadConsecutiveDWarning()]);
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
  if (activeTab.value === 'result') await loadSummary();
  else if (activeTab.value === 'progress') await loadProgress();
  else if (activeTab.value === 'focus') await loadFocusReport();
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
  if (tab === 'result') loadSummary();
  if (tab === 'progress') loadProgress();
  if (tab === 'focus') loadFocusReport();
});

watch(deptFilter, () => {
  if (!reportsReady || reportCycleSyncing) return;
  loadSummary();
});

watch([detailKeyword, detailGrade], () => {
  detailPage.value = 1;
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
      <template #title>绩效分析</template>
      <template #extra>
        <div class="header-tools">
          <el-select
            :model-value="selectedCycleId"
            data-testid="report-cycle-select"
            :placeholder="cycles.length ? '选择考核周期' : '暂无考核周期'"
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
            导出本周期全量
          </el-button>
        </div>
      </template>

      <div v-if="selectedCycle" class="report-context" data-testid="report-context">
        <span><b>分析范围</b>{{ isAdminLike ? '全公司' : '授权范围' }}</span>
        <span><b>周期</b>{{ selectedCycle.name }}</span>
        <span><b>状态</b>{{ cycleBusinessState(selectedCycle).label }}</span>
        <span><b>日期</b>{{ formatDate(selectedCycle.startDate) }} 至 {{ formatDate(selectedCycle.endDate) }}</span>
      </div>
    </ChartCard>

    <div v-if="summaryInsight && activeTab === 'result'" class="insight-bar" data-testid="report-insight">
      <div>
        <strong>本期提示</strong>
        <span>{{ summaryInsight }}</span>
      </div>
      <el-button v-if="pendingCount > 0" text type="primary" @click="detailGrade = ''; detailKeyword = ''">
        查看人员明细
      </el-button>
    </div>

    <el-tabs v-model="activeTab" class="report-tabs">
      <el-tab-pane label="结果概览" name="result">
        <div v-loading="loading" class="tab-panel">
          <div v-if="summary" class="summary-section">
            <div class="business-stats">
              <div class="business-stat" data-testid="report-stats-total">
                <span>应参评</span><strong>{{ summary.stats.total }}</strong><small>全部考核任务</small>
              </div>
              <div class="business-stat" data-testid="report-stats-resulted">
                <span>已出结果</span><strong>{{ resultedCount }}</strong><small>完成率 {{ formatRatio(summary.stats.total ? resultedCount / summary.stats.total : 0) }}</small>
              </div>
              <div class="business-stat is-warning" data-testid="report-stats-pending">
                <span>待出结果</span><strong>{{ pendingCount }}</strong><small>不计入结果合格率</small>
              </div>
              <div class="business-stat" data-testid="report-stats-qualified-rate">
                <span>已出结果合格率</span><strong>{{ formatRatio(qualifiedRate) }}</strong><small>{{ qualifiedCount }} / {{ resultedCount }}</small>
              </div>
            </div>

            <el-row :gutter="16" class="chart-row">
              <el-col :xs="24" :md="10">
                <ChartCard>
                  <template #title>等级分布</template>
                  <template #extra><span class="metric-note">占已出结果人数</span></template>
                  <GradeDistChart :data="gradeCounts" title="" :height="280" />
                </ChartCard>
              </el-col>
              <el-col :xs="24" :md="14">
                <ChartCard>
                  <template #title>部门差异</template>
                  <template #extra>
                    <DeptTree
                      v-if="canViewAdminTabs"
                      v-model="deptFilter"
                      :departments="departments"
                      placeholder="筛选部门"
                      clearable
                    />
                  </template>
                  <el-table data-testid="report-department-table" :data="deptStats" size="small" max-height="320">
                    <el-table-column prop="deptName" label="部门" min-width="140" show-overflow-tooltip />
                    <el-table-column prop="count" label="应参评" width="78" />
                    <el-table-column prop="resulted" label="已出结果" width="88" />
                    <el-table-column label="平均分" width="88">
                      <template #default="{ row }">{{ formatScore(row.averageScore) }}</template>
                    </el-table-column>
                    <el-table-column label="等级分布" min-width="180">
                      <template #default="{ row }">
                        <div class="dist-tags">
                          <span v-for="grade in GRADES" :key="grade" class="dist-item">
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
              <template #title>人员明细</template>
              <template #extra>
                <div class="detail-filters">
                  <el-input v-model="detailKeyword" clearable placeholder="搜索姓名 / 工号 / 部门" />
                  <el-select v-model="detailGrade" clearable placeholder="全部等级">
                    <el-option v-for="grade in GRADES" :key="grade" :label="`${grade} ${GRADE_LABELS[grade]}`" :value="grade" />
                  </el-select>
                </div>
              </template>
              <el-table :data="pagedSummaryItems" size="small">
                <el-table-column label="姓名" min-width="110" fixed="left">
                  <template #default="{ row }"><span data-testid="report-detail-row">{{ row.employeeName }}</span></template>
                </el-table-column>
                <el-table-column prop="employeeNo" label="工号" min-width="110" />
                <el-table-column prop="deptName" label="部门" min-width="140" show-overflow-tooltip />
                <el-table-column prop="position" label="职位" min-width="130" show-overflow-tooltip />
                <el-table-column label="总分" width="88"><template #default="{ row }">{{ formatScore(row.totalScore) }}</template></el-table-column>
                <el-table-column label="等级" width="100"><template #default="{ row }"><GradeTag :grade="row.grade" size="small" /></template></el-table-column>
                <el-table-column prop="managerName" label="主管" min-width="110" />
              </el-table>
              <div class="detail-pagination" data-testid="report-detail-pagination">
                <span>共 {{ filteredSummaryItems.length }} 人</span>
                <el-pagination
                  v-if="filteredSummaryItems.length > detailPageSize"
                  v-model:current-page="detailPage"
                  background
                  layout="prev, pager, next"
                  :page-size="detailPageSize"
                  :total="filteredSummaryItems.length"
                />
              </div>
            </ChartCard>
          </div>
          <EmptyState v-else description="选择考核周期后查看结果概览" />
        </div>
      </el-tab-pane>

      <el-tab-pane v-if="canViewAdminTabs" label="流程进度" name="progress" lazy>
        <div v-loading="loading" class="tab-panel">
          <div v-if="progress" class="progress-section">
            <el-row :gutter="16">
              <el-col :xs="24" :md="12">
                <ChartCard>
                  <template #title>当前流程分布</template>
                  <ProgressPieChart v-if="progressPieData.length > 0" :data="progressPieData" title="" :height="320" />
                  <EmptyState v-else description="暂无流程状态数据" />
                </ChartCard>
              </el-col>
              <el-col :xs="24" :md="12">
                <ChartCard>
                  <template #title>节点超期情况</template>
                  <template #extra><span class="metric-note">点击数量后进入对应任务</span></template>
                  <el-table :data="progress.overdueByNode" size="small">
                    <el-table-column label="节点" min-width="140"><template #default="{ row }">{{ NODE_LABELS[row.node] ?? row.node }}</template></el-table-column>
                    <el-table-column prop="overdueCount" label="超期人数" width="100" />
                  </el-table>
                </ChartCard>
              </el-col>
            </el-row>
          </div>
          <EmptyState v-else description="选择考核周期后查看流程进度" />
        </div>
      </el-tab-pane>

      <el-tab-pane v-if="canViewAdminTabs" label="重点关注" name="focus" lazy>
        <div v-loading="loading" class="tab-panel focus-section">
          <div v-if="gradeList" class="grade-list-section">
            <el-alert title="以下名单属于当前所选周期；用于人才盘点和绩效辅导，不替代业务判断。" type="info" :closable="false" show-icon />
            <el-row :gutter="16">
              <el-col :xs="24" :md="8">
                <ChartCard><template #title>优秀表现（{{ gradeList.aList.length }} 人）</template><el-table :data="gradeList.aList" size="small" max-height="360"><el-table-column prop="employeeName" label="姓名" min-width="100" /><el-table-column prop="deptName" label="部门" min-width="130" show-overflow-tooltip /><el-table-column label="总分" width="80"><template #default="{ row }">{{ formatScore(row.totalScore) }}</template></el-table-column></el-table></ChartCard>
              </el-col>
              <el-col :xs="24" :md="8">
                <ChartCard><template #title>待改进（{{ gradeList.cList.length }} 人）</template><el-table :data="gradeList.cList" size="small" max-height="360"><el-table-column prop="employeeName" label="姓名" min-width="100" /><el-table-column prop="deptName" label="部门" min-width="130" show-overflow-tooltip /><el-table-column label="总分" width="80"><template #default="{ row }">{{ formatScore(row.totalScore) }}</template></el-table-column></el-table></ChartCard>
              </el-col>
              <el-col :xs="24" :md="8">
                <ChartCard><template #title>不合格（{{ gradeList.dList.length }} 人）</template><el-table :data="gradeList.dList" size="small" max-height="360"><el-table-column prop="employeeName" label="姓名" min-width="100" /><el-table-column prop="deptName" label="部门" min-width="130" show-overflow-tooltip /><el-table-column label="总分" width="80"><template #default="{ row }">{{ formatScore(row.totalScore) }}</template></el-table-column></el-table></ChartCard>
              </el-col>
            </el-row>
          </div>

          <ChartCard class="cross-cycle-card">
            <template #title>连续低绩效关注（跨周期）</template>
            <template #extra><span class="metric-note">不受顶部周期筛选影响</span></template>
            <el-alert title="该名单仅用于绩效辅导提醒，不自动触发人事处理。" type="warning" :closable="false" show-icon />
            <el-table v-if="consecutiveDData && consecutiveDData.length > 0" :data="consecutiveDData" size="small" max-height="460">
              <el-table-column prop="employeeName" label="姓名" min-width="100" />
              <el-table-column prop="employeeNo" label="工号" min-width="110" />
              <el-table-column prop="deptName" label="部门" min-width="140" show-overflow-tooltip />
              <el-table-column prop="consecutiveCount" label="连续D次数" width="110" />
              <el-table-column label="最近周期" min-width="230"><template #default="{ row }"><div v-for="archive in row.archives" :key="archive.cycleId" class="archive-line">{{ archive.cycleName }} <GradeTag :grade="archive.grade" size="small" /></div></template></el-table-column>
            </el-table>
            <EmptyState v-else description="暂无连续低绩效关注人员" />
          </ChartCard>
        </div>
      </el-tab-pane>

      <el-tab-pane v-if="canViewAdminTabs" label="员工趋势" name="trend" lazy>
        <div v-loading="archiveLoading" class="tab-panel">
          <ChartCard class="archive-search-card">
            <template #title>员工跨周期绩效趋势</template>
            <template #extra><span class="metric-note">不受顶部周期筛选影响</span></template>
            <el-select
              v-model="archiveEmployeeId"
              placeholder="输入姓名 / 工号搜索"
              filterable
              remote
              clearable
              :remote-method="searchEmployees"
              @change="onArchiveEmployeeChange"
            >
              <el-option v-for="user in userOptions" :key="user.id" :label="`${user.name} (${user.employeeNo ?? '-'})`" :value="user.id" />
            </el-select>
          </ChartCard>
          <template v-if="archiveData.length > 0">
            <ChartCard class="archive-chart-card"><template #title>历史得分趋势</template><ScoreTrendChart :data="archiveTrendData" title="" :height="320" /></ChartCard>
            <ChartCard><template #title>历史归档</template><el-table :data="archiveData" size="small"><el-table-column prop="cycleName" label="考核周期" min-width="160" /><el-table-column prop="startDate" label="开始日期" min-width="120"><template #default="{ row }">{{ formatDate(row.startDate) }}</template></el-table-column><el-table-column prop="endDate" label="结束日期" min-width="120"><template #default="{ row }">{{ formatDate(row.endDate) }}</template></el-table-column><el-table-column label="总分" width="100"><template #default="{ row }">{{ formatScore(row.totalScore) }}</template></el-table-column><el-table-column label="等级" width="100"><template #default="{ row }"><GradeTag :grade="row.grade" size="small" /></template></el-table-column></el-table></ChartCard>
          </template>
          <EmptyState v-else-if="!archiveEmployeeId" description="搜索并选择员工后查看跨周期绩效" />
          <EmptyState v-else description="暂无该员工的历史绩效记录" />
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

.header-tools .el-select {
  width: 280px;
}

.report-context {
  display: flex;
  align-items: center;
  gap: 10px 24px;
  flex-wrap: wrap;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--app-border-color);
  color: var(--app-text-secondary);
  font-size: 13px;
}

.report-context span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.report-context b {
  color: var(--app-text-primary);
  font-weight: 600;
}

.insight-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 16px;
  border: 1px solid #d9e3ff;
  border-radius: 10px;
  background: #f2f6ff;
}

.insight-bar > div {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.insight-bar strong {
  flex: 0 0 auto;
  color: var(--el-color-primary);
}

.insight-bar span {
  color: var(--app-text-secondary);
}

.report-tabs :deep(.el-tabs__content) {
  padding-top: 16px;
}

.tab-panel {
  min-height: 240px;
}

.summary-section,
.progress-section,
.grade-list-section,
.focus-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.business-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.business-stat {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--app-border-color);
  border-radius: 10px;
  background: var(--app-card-bg);
}

.business-stat span,
.business-stat small {
  color: var(--app-text-secondary);
}

.business-stat strong {
  color: var(--app-text-primary);
  font-size: 28px;
  line-height: 1.2;
}

.business-stat.is-warning {
  border-color: #f3d39d;
  background: #fff9ef;
}

.business-stat.is-warning strong {
  color: #b66b12;
}

.chart-row {
  margin-bottom: 8px;
}

.metric-note {
  color: var(--app-text-secondary);
  font-size: 12px;
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

.detail-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.detail-filters .el-input {
  width: 230px;
}

.detail-filters .el-select {
  width: 145px;
}

.detail-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 14px;
  color: var(--app-text-secondary);
}

.archive-search-card .el-select {
  width: 320px;
  max-width: 100%;
}

.cross-cycle-card {
  margin-top: 4px;
}

.cross-cycle-card :deep(.el-alert) {
  margin-bottom: 12px;
}

.archive-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

@media (max-width: 768px) {
  .header-tools {
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
  }

  .header-tools .el-select {
    width: 100% !important;
  }

  .header-tools .el-button {
    width: 100%;
  }

  .business-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .insight-bar,
  .insight-bar > div,
  .detail-pagination {
    align-items: flex-start;
    flex-direction: column;
  }

  .detail-filters {
    width: 100%;
  }

  .detail-filters .el-input,
  .detail-filters .el-select {
    width: 100%;
  }
}

@media (max-width: 480px) {
  .business-stats {
    grid-template-columns: 1fr;
  }

  .report-context {
    display: grid;
    grid-template-columns: 1fr;
  }
}
</style>
