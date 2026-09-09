<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { calibrationApi } from '@/api/calibration.api';
import { useCycleStore } from '@/stores/cycle.store';
import GradeTag from '@/components/common/GradeTag.vue';
import GradeDistChart from '@/components/charts/GradeDistChart.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import PerformanceResultEvidence from '@/components/common/PerformanceResultEvidence.vue';
import PerformanceResultSummary from '@/components/common/PerformanceResultSummary.vue';
import PerformanceResultDrawer from '@/components/common/PerformanceResultDrawer.vue';
import { resultStage } from '@/utils/performance-result-presentation';
import EmptyState from '@/components/common/EmptyState.vue';
import type { CalibrationCandidate, CalibrationCandidateDetail, CalibrationSummary, AssessmentCycle } from '@/types/api.types';
import type { PerfGrade } from '@/types/enums';
import { GRADE_LABELS } from '@/utils/grade';

import { resolvePerformanceCycle } from '@/utils/performance-cycle';
import { formatDate } from '@/utils/date';
import { cycleBusinessState } from '@/views/admin/cycle-management';

type SortField = 'calculatedScore' | 'rawGrade' | 'employeeName';
type SortOrder = 'asc' | 'desc';
type StatusFilter = '' | 'pending' | 'dept_review' | 'final_grading' | 'inApproval' | 'done';

const cycleStore = useCycleStore();
const route = useRoute();
const router = useRouter();

const cycles = ref<AssessmentCycle[]>([]);
const selectedCycleId = ref<string>('');
const candidates = ref<CalibrationCandidate[]>([]);
const summary = ref<CalibrationSummary | null>(null);
const loading = ref(false);
const acting = ref(false);
let calibrationReady = false;
let listRequest = 0;
let detailRequest = 0;

const selectedTaskIds = ref<string[]>([]);
const deptFilter = ref<string>('');
const statusFilter = ref<StatusFilter>('');
const sortField = ref<SortField>('calculatedScore');
const sortOrder = ref<SortOrder>('desc');

/** 个人详情抽屉。 */
const drawer = ref({ visible: false, loading: false, detail: null as CalibrationCandidateDetail | null });

const GRADES: PerfGrade[] = ['A', 'B', 'C', 'D'];

const selectedCycle = computed(() => cycles.value.find((c) => c.id === selectedCycleId.value) ?? null);

const departments = computed(() => {
  const set = new Set<string>();
  candidates.value.forEach((c) => {
    if (c.deptName) set.add(c.deptName);
  });
  return Array.from(set).sort();
});

/** 状态过滤分组：评定中 = 非评定链路状态。 */
function statusGroup(c: CalibrationCandidate): StatusFilter {
  if (c.status === 'hr_calibration') return 'pending';
  if (c.status === 'dept_review') return 'dept_review';
  if (c.status === 'approval') return 'inApproval';
  if (c.status === 'published' || c.status === 'confirmed' || c.status === 'appealing' || c.status === 'closed') return 'done';
  return 'final_grading';
}

const filteredCandidates = computed(() => {
  let list = candidates.value;
  if (deptFilter.value) {
    list = list.filter((c) => c.deptName === deptFilter.value);
  }
  if (statusFilter.value) {
    list = list.filter((c) => statusGroup(c) === statusFilter.value);
  }
  return list.slice().sort((a, b) => {
    const order = sortOrder.value === 'asc' ? 1 : -1;
    if (sortField.value === 'calculatedScore') {
      return ((a.calculatedScore ?? -1) - (b.calculatedScore ?? -1)) * order;
    }
    if (sortField.value === 'employeeName') {
      return a.employeeName.localeCompare(b.employeeName, 'zh-CN') * order;
    }
    const map: Record<PerfGrade, number> = { A: 4, B: 3, C: 2, D: 1 };
    const gradeA = a.calibratedGrade ?? a.rawGrade;
    const gradeB = b.calibratedGrade ?? b.rawGrade;
    return ((gradeA ? map[gradeA] : 0) - (gradeB ? map[gradeB] : 0)) * order;
  });
});

function canCalibrate(candidate: CalibrationCandidate): boolean {
  return candidate.status === 'hr_calibration' && candidate.canCalibrate !== false;
}

const pendingCandidates = computed(() => candidates.value.filter(canCalibrate));

/** 分布仅统计已进入评定链路的任务（与后端口径一致）。 */
const countedTotal = computed(() => {
  return candidates.value.filter((c) => c.canViewDetail !== false && statusGroup(c) !== 'final_grading').length;
});

const gradeCounts = computed<Record<PerfGrade, number>>(() => {
  const counts: Record<PerfGrade, number> = { A: 0, B: 0, C: 0, D: 0 };
  candidates.value.forEach((c) => {
    if (c.canViewDetail === false || statusGroup(c) === 'final_grading') return;
    const grade = c.calibratedGrade ?? c.rawGrade;
    if (grade) counts[grade] = (counts[grade] ?? 0) + 1;
  });
  return counts;
});

const gradeWarnings = computed(() => {
  const cycle = selectedCycle.value;
  if (!cycle || countedTotal.value === 0) return [] as { grade: PerfGrade; ratio: number; limit: number }[];
  const warnings: { grade: PerfGrade; ratio: number; limit: number }[] = [];
  const limits: Record<PerfGrade, keyof AssessmentCycle> = {
    A: 'gradeAMaxRatio',
    B: 'gradeBMaxRatio',
    C: 'gradeCMaxRatio',
    D: 'gradeDMaxRatio',
  };
  (Object.keys(gradeCounts.value) as PerfGrade[]).forEach((grade) => {
    const limit = Number(cycle[limits[grade]]) || 0;
    const count = gradeCounts.value[grade] || 0;
    const ratio = count / countedTotal.value;
    if (limit > 0 && ratio > limit) {
      warnings.push({ grade, ratio, limit });
    }
  });
  return warnings;
});

const hasWarnings = computed(() => gradeWarnings.value.length > 0);

function handleSelectionChange(rows: CalibrationCandidate[]) {
  selectedTaskIds.value = rows.filter(canCalibrate).map((r) => r.taskId);
}

function getGradeMaxRatio(cycle: AssessmentCycle | null, grade: PerfGrade): number {
  if (!cycle) return 0;
  const key = `grade${grade}MaxRatio` as keyof AssessmentCycle;
  return Number(cycle[key]) || 0;
}

function formatRatio(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** 计算分可能为 null（未到评分阶段），统一兜底显示。 */
function fmtScore(s: number | null | undefined): string {
  return s == null ? '—' : s.toFixed(2);
}

async function loadCycles() {
  try {
    cycles.value = await calibrationApi.listCycles();
  } catch (e) {
    cycles.value = [];
    ElMessage.error(e instanceof Error ? e.message : '获取可校准周期失败');
  }
}

async function normalizeCalibrationCycle() {
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

function clearCalibrationState() {
  listRequest++;
  detailRequest++;
  drawer.value = { visible: false, loading: false, detail: null };
  candidates.value = [];
  summary.value = null;
  selectedTaskIds.value = [];
  deptFilter.value = '';
  statusFilter.value = '';
}

async function selectCalibrationCycle(cycleId: string) {
  if (!cycleId || cycleId === selectedCycleId.value) return;
  await router.push({ query: { ...route.query, cycleId } });
}

async function loadCandidates() {
  if (!selectedCycleId.value) {
    clearCalibrationState();
    return;
  }
  loading.value = true;
  const cycleId = selectedCycleId.value;
  const request = ++listRequest;
  try {
    const res = await calibrationApi.getWorkbench(cycleId);
    if (request !== listRequest || cycleId !== selectedCycleId.value) return;
    candidates.value = res.items;
    summary.value = {
      gradeDistribution: res.gradeDistribution,
      totalActive: res.totalActive,
      progress: res.progress,
    };
    selectedTaskIds.value = [];
  } catch (e) {
    if (request !== listRequest || cycleId !== selectedCycleId.value) return;
    ElMessage.error(e instanceof Error ? e.message : '获取校准名单失败');
    candidates.value = [];
    summary.value = null;
  } finally {
    if (request === listRequest) loading.value = false;
  }
}

/** 打开个人详情抽屉。 */
async function openDetail(taskId: string) {
  if (!selectedCycleId.value || !candidates.value.some((c) => c.taskId === taskId && c.canViewDetail !== false)) return;
  const cycleId = selectedCycleId.value;
  const request = ++detailRequest;
  drawer.value = { visible: true, loading: true, detail: null };
  try {
    const detail = await calibrationApi.getCandidateDetail(cycleId, taskId);
    if (request !== detailRequest || cycleId !== selectedCycleId.value) return;
    drawer.value.detail = detail;
  } catch (e) {
    if (request !== detailRequest || cycleId !== selectedCycleId.value) return;
    ElMessage.error(e instanceof Error ? e.message : '获取详情失败');
    drawer.value.visible = false;
  } finally {
    if (request === detailRequest) drawer.value.loading = false;
  }
}

/** 确认（单人或批量）。 */
async function handleConfirm(taskIds: string[]) {
  if (!selectedCycleId.value || !areActionable(taskIds) || acting.value) return;
  const cycleId = selectedCycleId.value;
  const requestedTaskIds = [...taskIds];
  try {
    await ElMessageBox.confirm(
      `确认后 ${taskIds.length} 人将进入结果审批并通知审批人，是否继续？`,
      '校准确认',
      { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return;
  }
  if (cycleId !== selectedCycleId.value || !areActionable(requestedTaskIds)) return;
  acting.value = true;
  try {
    const res = await calibrationApi.confirm(cycleId, { taskIds: requestedTaskIds });
    ElMessage.success(`已确认 ${res.updated} 人，进入结果审批`);
    selectedTaskIds.value = [];
    await loadCandidates();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '确认失败');
  } finally {
    acting.value = false;
  }
}

/** 驳回（单人或批量，原因必填）。 */
async function handleReject(taskIds: string[]) {
  if (!selectedCycleId.value || !areActionable(taskIds) || acting.value) return;
  const cycleId = selectedCycleId.value;
  const requestedTaskIds = [...taskIds];
  let reason = '';
  try {
    const input = await ElMessageBox.prompt(
      `驳回后任务将退回直属上级，可重新编写月度结果与最终等级。${taskIds.length > 1 ? `（共 ${taskIds.length} 人，使用同一原因）` : ''}`,
      '校准驳回',
      {
        confirmButtonText: '确认驳回',
        cancelButtonText: '取消',
        inputPlaceholder: '驳回原因（必填）',
        inputValidator: (v) => (v && v.trim() ? true : '驳回原因不能为空'),
      },
    );
    reason = input.value.trim();
  } catch {
    return;
  }
  if (cycleId !== selectedCycleId.value || !areActionable(requestedTaskIds)) return;
  acting.value = true;
  try {
    const res = await calibrationApi.reject(cycleId, { taskIds: requestedTaskIds, reason });
    ElMessage.success(`已驳回 ${res.updated} 人，退回直属上级重新评定`);
    selectedTaskIds.value = [];
    await loadCandidates();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '驳回失败');
  } finally {
    acting.value = false;
  }
}

function areActionable(taskIds: string[]): boolean {
  return taskIds.length > 0 && taskIds.every((id) => candidates.value.some((c) => c.taskId === id && canCalibrate(c)));
}

watch(
  () => route.query.cycleId,
  async (cycleId) => {
    if (!calibrationReady) return;
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
    clearCalibrationState();
    selectedCycleId.value = canonicalCycleId;
    cycleStore.setCurrent(selectedCycle.value);
    await loadCandidates();
  },
);

onMounted(async () => {
  await loadCycles();
  await normalizeCalibrationCycle();
  calibrationReady = true;
  cycleStore.setCurrent(selectedCycle.value);
  await loadCandidates();
});
</script>

<template>
  <div class="calibration-view page-stack performance-result-page">
    <ChartCard :padded="true">
      <template #title>绩效校准</template>
      <template #extra>
        <el-select
          :model-value="selectedCycleId"
          data-testid="calibration-cycle-select"
          :placeholder="cycles.length ? '选择考核周期' : '暂无考核周期'"
          style="width: 280px"
          :loading="loading"
          :disabled="cycles.length === 0"
          @change="selectCalibrationCycle"
        >
          <el-option v-if="cycles.length === 0" label="暂无考核周期" value="" disabled />
          <el-option
            v-for="cycle in cycles"
            :key="cycle.id"
            :label="cycle.name"
            :value="cycle.id"
          />
        </el-select>
      </template>

      <div v-if="selectedCycle" class="cycle-info">
        <el-descriptions :column="4" size="small" border>
          <el-descriptions-item label="周期">{{ selectedCycle.name }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ cycleBusinessState(selectedCycle).label }}</el-descriptions-item>
          <el-descriptions-item label="校准截止">{{ selectedCycle.deadlineHrCalibration ? formatDate(selectedCycle.deadlineHrCalibration) : '未设置' }}</el-descriptions-item>
          <el-descriptions-item label="参与人数">{{ summary?.totalActive ?? candidates.length }}</el-descriptions-item>
        </el-descriptions>
        <div v-if="summary" class="progress-row">
          <span class="progress-item">评定中 <b>{{ summary.progress.finalGrading }}</b></span>
          <span class="progress-item">待部门复核 <b>{{ summary.progress.deptReview }}</b></span>
          <span class="progress-item progress-item--pending">待校准 <b>{{ summary.progress.pending }}</b></span>
          <span class="progress-item">审批中 <b>{{ summary.progress.inApproval }}</b></span>
          <span class="progress-item">已定级 <b>{{ summary.progress.done }}</b></span>
        </div>
      </div>
    </ChartCard>

    <EmptyState v-if="!selectedCycle" description="暂无可校准的考核周期" />

    <template v-else>
      <el-row :gutter="16" class="middle-row">
        <el-col :xs="24" :md="14">
          <ChartCard :padded="true" class="chart-card">
            <template #title>等级分布（评定链路 {{ countedTotal }} 人）</template>
            <template #extra>
              <el-tag v-if="hasWarnings" type="danger" effect="dark">存在超限</el-tag>
            </template>
            <GradeDistChart :data="gradeCounts" title="" :height="220" />
            <div class="ratio-row">
              <div
                v-for="grade in GRADES"
                :key="grade"
                class="ratio-item"
                :class="{ 'ratio-item--warning': gradeWarnings.some((w) => w.grade === grade) }"
              >
                <GradeTag :grade="grade" size="small" />
                <span class="ratio-count">{{ gradeCounts[grade] }}人</span>
                <span class="ratio-percent">{{ formatRatio(countedTotal ? gradeCounts[grade] / countedTotal : 0) }}</span>
                <span class="ratio-limit">上限 {{ formatRatio(getGradeMaxRatio(selectedCycle, grade)) }}</span>
              </div>
            </div>
          </ChartCard>
        </el-col>
        <el-col :xs="24" :md="10">
          <ChartCard :padded="true" class="warning-card">
            <template #title>分布告警（仅作校准参考，不阻止操作）</template>
            <el-alert
              v-if="!hasWarnings"
              title="当前分布未超过各等级上限"
              type="success"
              :closable="false"
              show-icon
            />
            <div v-else class="warning-list">
              <el-alert
                v-for="w in gradeWarnings"
                :key="w.grade"
                :title="`${GRADE_LABELS[w.grade]} 等级占比 ${formatRatio(w.ratio)}，超过上限 ${formatRatio(w.limit)}`"
                type="error"
                :closable="false"
                show-icon
              />
              <p class="warning-tip">可通过驳回相应人员，退回直属上级重新评定。</p>
            </div>
          </ChartCard>
        </el-col>
      </el-row>

      <ChartCard :padded="true">
        <template #title>校准名单</template>
        <div class="toolbar performance-result-toolbar">
          <div class="toolbar-left">
            <el-select v-model="deptFilter" placeholder="全部部门" clearable style="width: 160px">
              <el-option v-for="d in departments" :key="d" :label="d" :value="d" />
            </el-select>
            <el-select v-model="statusFilter" placeholder="全部状态" clearable style="width: 150px">
              <el-option label="待校准" value="pending" />
              <el-option label="待部门复核" value="dept_review" />
              <el-option label="评定中" value="final_grading" />
              <el-option label="审批中" value="inApproval" />
              <el-option label="已定级" value="done" />
            </el-select>
            <el-select v-model="sortField" placeholder="排序字段" style="width: 130px">
              <el-option label="周期得分" value="calculatedScore" />
              <el-option label="周期等级" value="rawGrade" />
              <el-option label="姓名" value="employeeName" />
            </el-select>
            <el-radio-group v-model="sortOrder" size="small">
              <el-radio-button :value="'desc'">降序</el-radio-button>
              <el-radio-button :value="'asc'">升序</el-radio-button>
            </el-radio-group>
          </div>
          <div class="toolbar-right performance-result-actions">
            <el-button
              type="primary"
              :disabled="selectedTaskIds.length === 0"
              :loading="acting"
              @click="handleConfirm(selectedTaskIds)"
            >批量确认校准</el-button>
            <el-button
              type="danger"
              plain
              :disabled="selectedTaskIds.length === 0"
              :loading="acting"
              @click="handleReject(selectedTaskIds)"
            >批量驳回</el-button>
          </div>
        </div>

        <el-table
          :key="selectedCycleId"
          v-loading="loading"
          class="app-table performance-result-table"
          :data="filteredCandidates as CalibrationCandidate[]"
          row-key="taskId"
          @selection-change="handleSelectionChange"
        >
          <el-table-column type="selection" width="50" :selectable="canCalibrate" />
          <el-table-column prop="employeeName" label="员工" min-width="150" show-overflow-tooltip>
            <template #default="{ row }"><div class="performance-result-employee"><div>{{ row.employeeName }}</div><div class="performance-result-meta">{{ row.employeeNo || '—' }}</div></div></template>
          </el-table-column>
          <el-table-column prop="deptName" label="部门" min-width="130" show-overflow-tooltip />
          <el-table-column prop="position" label="岗位" min-width="130" show-overflow-tooltip />
          <el-table-column prop="calculatedScore" label="周期得分" width="110" align="right" sortable>
            <template #default="{ row }">
              <span class="performance-result-score">{{ fmtScore((row as CalibrationCandidate).calculatedScore) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="周期等级" width="100" align="center">
            <template #default="{ row }">
              <GradeTag v-if="row.calibratedGrade ?? row.rawGrade" :grade="row.calibratedGrade ?? row.rawGrade" size="small" />
              <span v-else class="score-cell" style="color: var(--el-text-color-placeholder)">—</span>
            </template>
          </el-table-column>
          <el-table-column label="当前环节" min-width="150">
            <template #default="{ row }">
              <el-tag :type="resultStage(row.status, row.approvedAt).type" size="small">
                {{ resultStage(row.status, row.approvedAt).label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="managerName" label="绩效直属上级" min-width="140" show-overflow-tooltip />
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <span v-if="row.actionHint" class="action-hint">{{ row.actionHint }}</span>
              <div class="performance-result-actions">
              <el-button v-if="row.canViewDetail !== false" link type="primary" @click="openDetail((row as CalibrationCandidate).taskId)">查看详情</el-button>
              <template v-if="canCalibrate(row as CalibrationCandidate)">
                <el-button link type="primary" :loading="acting" @click="handleConfirm([(row as CalibrationCandidate).taskId])">确认校准</el-button>
                <el-button link type="danger" size="small" :loading="acting" @click="handleReject([(row as CalibrationCandidate).taskId])">驳回</el-button>
              </template>
              </div>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="pendingCandidates.length === 0 && summary" class="submit-hint">
          <el-alert
            :title="summary.progress.pending > 0
              ? '暂无可由你处理的校准任务，其他任务仍待处理'
              : summary.progress.inApproval > 0 || summary.progress.done > 0
              ? '本周期待校准任务已处理完毕'
              : '本周期尚无待校准任务，等待直属上级完成整周期结果评定'"
            type="info"
            :closable="false"
          />
        </div>
      </ChartCard>
    </template>

    <PerformanceResultDrawer
      v-model="drawer.visible"
      :title="drawer.detail ? `${drawer.detail.employeeName} · 绩效校准` : '绩效校准详情'"
      data-testid="calibration-detail-drawer"
    >
      <div v-loading="drawer.loading">
        <template v-if="drawer.detail">
          <PerformanceResultSummary
          score-hint="分数与等级无换算关系"
            :cycle-name="selectedCycle?.name"
            :employee-name="drawer.detail.employeeName"
            :status-label="resultStage(drawer.detail.status, drawer.detail.approvedAt).label"
            :status-type="resultStage(drawer.detail.status, drawer.detail.approvedAt).type"
            :department-name="drawer.detail.deptName"
            :position="drawer.detail.position"
            :manager-name="drawer.detail.managerName"
            :score="(drawer.detail.calculatedScore) ?? null"
            :raw-grade="(drawer.detail.finalGrade) ?? null"
            :calibrated-grade="(drawer.detail.calibratedGrade) ?? null"
          />

          <PerformanceResultEvidence :evidence="drawer.detail.resultEvidence" :periods="drawer.detail.periods" :indicators="drawer.detail.indicators" :records="drawer.detail.flowRecords" />
        </template>
      </div>
    </PerformanceResultDrawer>
  </div>
</template>

<style scoped>
.action-hint {
  display: block;
  white-space: normal;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.cycle-info {
  margin-top: 8px;
}

.progress-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 12px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.progress-item b {
  color: var(--el-text-color-primary);
  margin-left: 2px;
}

.progress-item--pending b {
  color: var(--el-color-primary);
}

.chart-card,
.warning-card {
  height: 100%;
}

.ratio-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
}

.ratio-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f6f8fa;
  border-radius: 6px;
  font-size: 13px;
}

.ratio-item--warning {
  background: #fff2f0;
  border: 1px solid #ffccc7;
}

.ratio-count {
  color: #666;
}

.ratio-percent {
  font-weight: 600;
  color: #333;
}

.ratio-limit {
  color: #999;
}

.warning-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.warning-tip {
  margin: 8px 0 0;
  color: #f56c6c;
  font-size: 13px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.score-cell {
  font-weight: 600;
  color: #1677ff;
}

.submit-hint {
  margin-top: 16px;
}

.drawer-section {
  margin-top: 16px;
}

.drawer-section h4 {
  margin: 0 0 8px;
  font-size: 14px;
}

.reject-item {
  padding: 8px 0;
  border-bottom: 1px dashed var(--el-border-color-lighter);
}

.reject-item:last-child {
  border-bottom: none;
}

.reject-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.reject-comment {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--el-text-color-primary);
}

@media (max-width: 768px) {
  .toolbar {
    flex-direction: column;
    align-items: flex-start;
  }

  .toolbar-left,
  .toolbar-right {
    width: 100%;
  }
}
</style>
