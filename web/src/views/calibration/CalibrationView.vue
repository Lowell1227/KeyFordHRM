<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { calibrationApi } from '@/api/calibration.api';
import { cyclesApi } from '@/api/cycles.api';
import { useCycleStore } from '@/stores/cycle.store';
import GradeTag from '@/components/common/GradeTag.vue';
import GradeDistChart from '@/components/charts/GradeDistChart.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import type { CalibrationCandidate, CalibrationCandidateDetail, CalibrationSummary, AssessmentCycle } from '@/types/api.types';
import type { PerfGrade, TaskStatus } from '@/types/enums';
import { GRADE_LABELS } from '@/utils/grade';
import { TASK_STATUS_META } from '@/types/enums';
import { resolvePerformanceCycle } from '@/utils/performance-cycle';

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
    return ((a.rawGrade ? map[a.rawGrade] : 0) - (b.rawGrade ? map[b.rawGrade] : 0)) * order;
  });
});

const pendingCandidates = computed(() => candidates.value.filter((c) => c.status === 'hr_calibration'));

/** 分布仅统计已进入评定链路的任务（与后端口径一致）。 */
const countedTotal = computed(() => {
  const p = summary.value?.progress;
  if (!p) return 0;
  return p.deptReview + p.pending + p.inApproval + p.done;
});

const gradeCounts = computed<Record<PerfGrade, number>>(() => {
  const counts: Record<PerfGrade, number> = { A: 0, B: 0, C: 0, D: 0 };
  candidates.value.forEach((c) => {
    if (statusGroup(c) === 'final_grading') return;
    const grade = c.rawGrade;
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
  selectedTaskIds.value = rows.map((r) => r.taskId);
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

function statusLabel(status: TaskStatus): string {
  return TASK_STATUS_META[status]?.label ?? status;
}

function statusTagType(status: TaskStatus): string {
  return TASK_STATUS_META[status]?.type ?? 'info';
}

async function loadCycles() {
  try {
    const res = await cyclesApi.findAll({ status: 'hr_calibration' });
    cycles.value = res.items;
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
  try {
    const res = await calibrationApi.getWorkbench(selectedCycleId.value);
    candidates.value = res.items;
    summary.value = {
      gradeDistribution: res.gradeDistribution,
      totalActive: res.totalActive,
      progress: res.progress,
    };
    selectedTaskIds.value = [];
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '获取校准名单失败');
    candidates.value = [];
    summary.value = null;
  } finally {
    loading.value = false;
  }
}

/** 打开个人详情抽屉。 */
async function openDetail(taskId: string) {
  if (!selectedCycleId.value) return;
  drawer.value = { visible: true, loading: true, detail: null };
  try {
    drawer.value.detail = await calibrationApi.getCandidateDetail(selectedCycleId.value, taskId);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '获取详情失败');
    drawer.value.visible = false;
  } finally {
    drawer.value.loading = false;
  }
}

/** 确认（单人或批量）。 */
async function handleConfirm(taskIds: string[]) {
  if (!selectedCycleId.value || taskIds.length === 0) return;
  try {
    await ElMessageBox.confirm(
      `确认后 ${taskIds.length} 人将进入结果审批并通知审批人，是否继续？`,
      '校准确认',
      { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return;
  }
  acting.value = true;
  try {
    const res = await calibrationApi.confirm(selectedCycleId.value, { taskIds });
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
  if (!selectedCycleId.value || taskIds.length === 0) return;
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
  acting.value = true;
  try {
    const res = await calibrationApi.reject(selectedCycleId.value, { taskIds, reason });
    ElMessage.success(`已驳回 ${res.updated} 人，退回直属上级重新评定`);
    selectedTaskIds.value = [];
    await loadCandidates();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '驳回失败');
  } finally {
    acting.value = false;
  }
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
  <div class="calibration-view page-stack">
    <ChartCard>
      <template #title>绩效校准工作台</template>
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
          <el-descriptions-item label="状态">{{ selectedCycle.status }}</el-descriptions-item>
          <el-descriptions-item label="校准截止">{{ selectedCycle.deadlineHrCalibration ?? '未设置' }}</el-descriptions-item>
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
          <ChartCard class="chart-card">
            <template #title>等级分布（评定链路 {{ countedTotal }} 人）</template>
            <template #extra>
              <el-tag v-if="hasWarnings" type="danger" effect="dark">存在超限</el-tag>
            </template>
            <GradeDistChart :data="gradeCounts" title="" :height="240" />
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
          <ChartCard class="warning-card">
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

      <ChartCard>
        <template #title>校准名单</template>
        <div class="toolbar">
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
              <el-option label="参考均分" value="calculatedScore" />
              <el-option label="最终等级" value="rawGrade" />
              <el-option label="姓名" value="employeeName" />
            </el-select>
            <el-radio-group v-model="sortOrder" size="small">
              <el-radio-button :value="'desc'">降序</el-radio-button>
              <el-radio-button :value="'asc'">升序</el-radio-button>
            </el-radio-group>
          </div>
          <div class="toolbar-right">
            <el-button
              type="primary"
              plain
              :disabled="selectedTaskIds.length === 0"
              :loading="acting"
              @click="handleConfirm(selectedTaskIds)"
            >批量确认</el-button>
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
          v-loading="loading"
          class="app-table"
          :data="filteredCandidates as CalibrationCandidate[]"
          row-key="taskId"
          @selection-change="handleSelectionChange"
        >
          <el-table-column type="selection" width="50" reserve-selection :selectable="(row: CalibrationCandidate) => row.status === 'hr_calibration'" />
          <el-table-column prop="employeeName" label="姓名" min-width="100" />
          <el-table-column prop="deptName" label="部门" min-width="130" />
          <el-table-column prop="position" label="岗位" min-width="130" />
          <el-table-column prop="managerName" label="直属上级" width="110" />
          <el-table-column prop="calculatedScore" label="参考均分" width="110" sortable>
            <template #default="{ row }">
              <span class="score-cell">{{ fmtScore((row as CalibrationCandidate).calculatedScore) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="最终等级" width="100">
            <template #default="{ row }">
              <GradeTag v-if="(row as CalibrationCandidate).rawGrade" :grade="(row as CalibrationCandidate).rawGrade!" size="small" />
              <span v-else class="score-cell" style="color: var(--el-text-color-placeholder)">—</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="statusTagType((row as CalibrationCandidate).status) as any" size="small">
                {{ statusLabel((row as CalibrationCandidate).status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button link size="small" @click="openDetail((row as CalibrationCandidate).taskId)">详情</el-button>
              <template v-if="(row as CalibrationCandidate).status === 'hr_calibration'">
                <el-button link type="primary" size="small" :loading="acting" @click="handleConfirm([(row as CalibrationCandidate).taskId])">确认</el-button>
                <el-button link type="danger" size="small" :loading="acting" @click="handleReject([(row as CalibrationCandidate).taskId])">驳回</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="pendingCandidates.length === 0 && summary" class="submit-hint">
          <el-alert
            :title="summary.progress.inApproval > 0 || summary.progress.done > 0
              ? '本周期待校准任务已处理完毕'
              : '本周期尚无待校准任务，等待直属上级完成整周期结果评定'"
            type="info"
            :closable="false"
          />
        </div>
      </ChartCard>
    </template>

    <el-drawer
      v-model="drawer.visible"
      :title="drawer.detail ? `${drawer.detail.employeeName} · 校准依据` : '校准依据'"
      size="560px"
    >
      <div v-loading="drawer.loading">
        <template v-if="drawer.detail">
          <el-descriptions :column="2" size="small" border>
            <el-descriptions-item label="部门">{{ drawer.detail.deptName ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="岗位">{{ drawer.detail.position ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="直属上级">{{ drawer.detail.managerName ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="当前状态">
              <el-tag :type="statusTagType(drawer.detail.status) as any" size="small">{{ statusLabel(drawer.detail.status) }}</el-tag>
            </el-descriptions-item>
          </el-descriptions>

          <div class="drawer-section">
            <h4>整周期结果</h4>
            <div class="result-row">
              <div class="result-item">
                <span class="result-label">参考均分</span>
                <span class="score-cell">{{ fmtScore(drawer.detail.calculatedScore) }}</span>
                <span class="result-hint">（分数与等级无换算关系）</span>
              </div>
              <div class="result-item">
                <span class="result-label">最终等级（直属上级录入）</span>
                <GradeTag v-if="drawer.detail.finalGrade" :grade="drawer.detail.finalGrade" />
                <span v-else class="result-hint">未录入</span>
              </div>
            </div>
          </div>

          <div class="drawer-section">
            <h4>月度结果</h4>
            <el-table :data="drawer.detail.periods" size="small" border>
              <el-table-column prop="periodKey" label="月份" width="90" />
              <el-table-column label="自评等级" width="90">
                <template #default="{ row }">
                  <GradeTag v-if="row.selfGrade" :grade="row.selfGrade" size="small" />
                  <span v-else>—</span>
                </template>
              </el-table-column>
              <el-table-column label="上级等级" width="90">
                <template #default="{ row }">
                  <GradeTag v-if="row.managerGrade" :grade="row.managerGrade" size="small" />
                  <span v-else>—</span>
                </template>
              </el-table-column>
              <el-table-column label="自评分" width="80">
                <template #default="{ row }">{{ fmtScore(row.selfScoreTotal) }}</template>
              </el-table-column>
              <el-table-column label="上级评分">
                <template #default="{ row }">{{ fmtScore(row.managerScoreTotal) }}</template>
              </el-table-column>
            </el-table>
          </div>

          <el-collapse class="drawer-section">
            <el-collapse-item title="指标汇总（跨月平均）" name="indicators">
              <el-table :data="drawer.detail.indicators" size="small" border>
                <el-table-column prop="name" label="指标" min-width="140" show-overflow-tooltip />
                <el-table-column label="权重" width="70">
                  <template #default="{ row }">{{ formatRatio(row.weight) }}</template>
                </el-table-column>
                <el-table-column label="自评均分" width="90">
                  <template #default="{ row }">{{ fmtScore(row.avgSelfScore) }}</template>
                </el-table-column>
                <el-table-column label="上级均分" width="90">
                  <template #default="{ row }">{{ fmtScore(row.avgManagerScore) }}</template>
                </el-table-column>
              </el-table>
            </el-collapse-item>
            <el-collapse-item
              v-if="drawer.detail.rejectHistory.length > 0"
              :title="`驳回历史（${drawer.detail.rejectHistory.length}）`"
              name="rejects"
            >
              <div v-for="(r, i) in drawer.detail.rejectHistory" :key="i" class="reject-item">
                <div class="reject-meta">
                  <el-tag size="small" :type="r.nodeType === 'hr_calibration' ? 'danger' : 'warning'">
                    {{ r.nodeType === 'hr_calibration' ? '校准驳回' : '复核退回' }}
                  </el-tag>
                  <span>{{ r.actorName ?? '系统' }} · {{ new Date(r.createdAt).toLocaleString('zh-CN') }}</span>
                </div>
                <p class="reject-comment">{{ r.comment ?? '—' }}</p>
              </div>
            </el-collapse-item>
          </el-collapse>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
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

.result-row {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
}

.result-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.result-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.result-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
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
