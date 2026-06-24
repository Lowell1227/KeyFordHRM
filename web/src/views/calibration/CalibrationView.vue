<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { calibrationApi } from '@/api/calibration.api';
import { cyclesApi } from '@/api/cycles.api';
import { useCycleStore } from '@/stores/cycle.store';
import GradeTag from '@/components/common/GradeTag.vue';
import GradeDistChart from '@/components/charts/GradeDistChart.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import type { CalibrationCandidate, CalibrationSummary, AssessmentCycle } from '@/types/api.types';
import type { PerfGrade } from '@/types/enums';
import { GRADE_LABELS } from '@/utils/grade';

interface LocalEdit {
  calibratedGrade: PerfGrade;
  calibrationNote: string;
  isVeto: boolean;
  vetoReason?: string;
}

type SortField = 'calculatedScore' | 'rawGrade' | 'employeeName';
type SortOrder = 'asc' | 'desc';

const cycleStore = useCycleStore();

const cycles = ref<AssessmentCycle[]>([]);
const selectedCycleId = ref<string>('');
const candidates = ref<CalibrationCandidate[]>([]);
const summary = ref<CalibrationSummary | null>(null);
const loading = ref(false);
const submitting = ref(false);

const edits = ref<Record<string, LocalEdit>>({});
const selectedTaskIds = ref<string[]>([]);
const deptFilter = ref<string>('');
const sortField = ref<SortField>('calculatedScore');
const sortOrder = ref<SortOrder>('desc');

const batchGrade = ref<PerfGrade>('B');
const batchNote = ref('');

const GRADES: PerfGrade[] = ['A', 'B', 'C', 'D'];

const selectedCycle = computed(() => cycles.value.find((c) => c.id === selectedCycleId.value) ?? null);

const departments = computed(() => {
  const set = new Set<string>();
  candidates.value.forEach((c) => {
    if (c.deptName) set.add(c.deptName);
  });
  return Array.from(set).sort();
});

const filteredCandidates = computed(() => {
  let list = candidates.value;
  if (deptFilter.value) {
    list = list.filter((c) => c.deptName === deptFilter.value);
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

const totalCandidates = computed(() => candidates.value.length);

const gradeCounts = computed<Record<PerfGrade, number>>(() => {
  const counts: Record<PerfGrade, number> = { A: 0, B: 0, C: 0, D: 0 };
  candidates.value.forEach((c) => {
    const grade = edits.value[c.taskId]?.calibratedGrade ?? c.calibratedGrade ?? c.rawGrade;
    if (grade) counts[grade] = (counts[grade] ?? 0) + 1; // 未评分(grade=null)不计入分布
  });
  return counts;
});

const gradeWarnings = computed(() => {
  const cycle = selectedCycle.value;
  if (!cycle || totalCandidates.value === 0) return [] as { grade: PerfGrade; ratio: number; limit: number }[];
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
    const ratio = count / totalCandidates.value;
    if (limit > 0 && ratio > limit) {
      warnings.push({ grade, ratio, limit });
    }
  });
  return warnings;
});

const hasWarnings = computed(() => gradeWarnings.value.length > 0);

const hasEdits = computed(() => Object.keys(edits.value).length > 0);

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

function getDefaultGrade(candidate: CalibrationCandidate): PerfGrade | undefined {
  return candidate.calibratedGrade ?? candidate.rawGrade ?? undefined;
}

function getDisplayGrade(taskId: string, candidate: CalibrationCandidate): PerfGrade | undefined {
  return edits.value[taskId]?.calibratedGrade ?? getDefaultGrade(candidate);
}

function ensureEdit(taskId: string, candidate: CalibrationCandidate) {
  if (!edits.value[taskId]) {
    edits.value[taskId] = {
      calibratedGrade: getDefaultGrade(candidate) ?? 'B',
      calibrationNote: '',
      isVeto: candidate.isVeto ?? false,
      vetoReason: undefined,
    };
  }
}

function handleGradeChange(taskId: string, candidate: CalibrationCandidate, grade: PerfGrade) {
  ensureEdit(taskId, candidate);
  edits.value[taskId].calibratedGrade = grade;
}

function handleNoteChange(taskId: string, candidate: CalibrationCandidate, note: string) {
  ensureEdit(taskId, candidate);
  edits.value[taskId].calibrationNote = note;
}

function applyBatchGrade() {
  if (selectedTaskIds.value.length === 0) {
    ElMessage.warning('请先勾选要批量调整的人员');
    return;
  }
  selectedTaskIds.value.forEach((taskId) => {
    const c = candidates.value.find((x) => x.taskId === taskId);
    if (!c) return;
    ensureEdit(taskId, c);
    edits.value[taskId].calibratedGrade = batchGrade.value;
    if (batchNote.value) {
      edits.value[taskId].calibrationNote = batchNote.value;
    }
  });
  ElMessage.success(`已批量调整 ${selectedTaskIds.value.length} 人等级为 ${GRADE_LABELS[batchGrade.value]}`);
}

async function loadCycles() {
  try {
    const res = await cyclesApi.findAll({ status: 'hr_calibration' });
    cycles.value = res.items;
    if (cycles.value.length > 0 && !selectedCycleId.value) {
      selectedCycleId.value = cycles.value[0].id;
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '获取可校准周期失败');
  }
}

async function loadCandidates() {
  if (!selectedCycleId.value) return;
  loading.value = true;
  try {
    const res = await calibrationApi.getWorkbench(selectedCycleId.value);
    candidates.value = res.items;
    summary.value = {
      gradeDistribution: res.gradeDistribution,
      totalActive: res.totalActive,
      pendingCalibration: res.pendingCalibration,
    };
    selectedTaskIds.value = [];
    edits.value = {};
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '获取校准候选人失败');
    candidates.value = [];
    summary.value = null;
  } finally {
    loading.value = false;
  }
}

async function handleSubmit() {
  if (!selectedCycleId.value) return;
  const calibrations = Object.entries(edits.value).map(([taskId, edit]) => ({
    taskId,
    calibratedGrade: edit.calibratedGrade,
    calibrationNote: edit.calibrationNote || undefined,
    isVeto: edit.isVeto,
    vetoReason: edit.isVeto ? edit.vetoReason : undefined,
  }));
  if (calibrations.length === 0) {
    ElMessage.warning('没有待提交的校准调整');
    return;
  }
  if (hasWarnings.value) {
    try {
      await ElMessageBox.confirm(
        `当前 ${gradeWarnings.value.map((w) => `${GRADE_LABELS[w.grade]} ${formatRatio(w.ratio)} 超上限 ${formatRatio(w.limit)}`).join('、')}，是否仍要提交？`,
        '强制分布告警',
        { confirmButtonText: '仍要提交', cancelButtonText: '返回调整', type: 'warning' },
      );
    } catch {
      return;
    }
  }
  submitting.value = true;
  try {
    const res = await calibrationApi.submit(selectedCycleId.value, { submit: true, calibrations });
    ElMessage.success(`提交成功，已更新 ${res.updated} 条记录`);
    edits.value = {};
    selectedTaskIds.value = [];
    await loadCandidates();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '提交校准失败');
  } finally {
    submitting.value = false;
  }
}

async function toggleVeto(taskId: string, candidate: CalibrationCandidate) {
  const currentVeto = edits.value[taskId]?.isVeto ?? candidate.isVeto ?? false;
  const next = !currentVeto;
  let reason = '';
  if (next) {
    try {
      const input = await ElMessageBox.prompt('请输入一票否决原因', '一票否决', {
        confirmButtonText: '确认否决',
        cancelButtonText: '取消',
        inputPlaceholder: '否决原因',
        inputValidator: (v) => (v.trim() ? true : '否决原因不能为空'),
      });
      reason = input.value.trim();
    } catch {
      return;
    }
  }
  ensureEdit(taskId, candidate);
  edits.value[taskId].isVeto = next;
  edits.value[taskId].vetoReason = reason || undefined;
  // 一票否决时等级强制为 D
  if (next) {
    edits.value[taskId].calibratedGrade = 'D';
  }
  ElMessage.success(next ? '已标记一票否决' : '已取消一票否决');
}

watch(selectedCycleId, () => {
  loadCandidates();
  cycleStore.setCurrent(selectedCycle.value);
});

onMounted(() => {
  loadCycles().then(() => {
    if (selectedCycleId.value) {
      loadCandidates();
      cycleStore.setCurrent(selectedCycle.value);
    }
  });
});
</script>

<template>
  <div class="calibration-view page-stack">
    <ChartCard>
      <template #title>绩效校准工作台</template>
      <template #extra>
        <el-select
          v-model="selectedCycleId"
          placeholder="选择考核周期"
          style="width: 280px"
          :loading="loading"
        >
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
          <el-descriptions-item label="人数">{{ summary?.totalActive ?? candidates.length }}</el-descriptions-item>
        </el-descriptions>
      </div>
    </ChartCard>

    <el-row :gutter="16" class="middle-row">
      <el-col :xs="24" :md="14">
        <ChartCard class="chart-card">
          <template #title>当前等级分布</template>
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
              <span class="ratio-percent">{{ formatRatio(totalCandidates ? gradeCounts[grade] / totalCandidates : 0) }}</span>
              <span class="ratio-limit">上限 {{ formatRatio(getGradeMaxRatio(selectedCycle, grade)) }}</span>
            </div>
          </div>
        </ChartCard>
      </el-col>
      <el-col :xs="24" :md="10">
        <ChartCard class="warning-card">
          <template #title>分布告警</template>
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
            <p class="warning-tip">请在校准说明中解释原因，仍可提交。</p>
          </div>
        </ChartCard>
      </el-col>
    </el-row>

    <ChartCard>
      <template #title>校准名单</template>
      <div class="toolbar">
          <div class="toolbar-left">
            <el-select v-model="deptFilter" placeholder="全部部门" clearable style="width: 180px">
              <el-option v-for="d in departments" :key="d" :label="d" :value="d" />
            </el-select>
            <el-select v-model="sortField" placeholder="排序字段" style="width: 140px">
              <el-option label="计算分" value="calculatedScore" />
              <el-option label="原始等级" value="rawGrade" />
              <el-option label="姓名" value="employeeName" />
            </el-select>
            <el-radio-group v-model="sortOrder" size="small">
              <el-radio-button :value="'desc'">降序</el-radio-button>
              <el-radio-button :value="'asc'">升序</el-radio-button>
            </el-radio-group>
          </div>
          <div class="toolbar-right">
            <el-select v-model="batchGrade" placeholder="批量等级" style="width: 120px">
              <el-option v-for="g in GRADES" :key="g" :label="GRADE_LABELS[g]" :value="g" />
            </el-select>
            <el-input v-model="batchNote" placeholder="批量说明" style="width: 180px" clearable />
            <el-button type="primary" plain @click="applyBatchGrade">批量调整</el-button>
            <el-button type="success" :loading="submitting" @click="handleSubmit">提交校准</el-button>
          </div>
        </div>

      <el-table
        v-loading="loading"
        class="app-table"
        :data="filteredCandidates as CalibrationCandidate[]"
        row-key="taskId"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="50" reserve-selection />
        <el-table-column prop="employeeName" label="姓名" min-width="100" />
        <el-table-column prop="deptName" label="部门" min-width="140" />
        <el-table-column prop="position" label="岗位" min-width="140" />
        <el-table-column prop="calculatedScore" label="计算分" width="110" sortable>
          <template #default="{ row }">
            <span class="score-cell">{{ fmtScore((row as CalibrationCandidate).calculatedScore) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="rawGrade" label="原始等级" width="110">
          <template #default="{ row }">
            <GradeTag v-if="(row as CalibrationCandidate).rawGrade" :grade="(row as CalibrationCandidate).rawGrade!" size="small" />
            <span v-else class="score-cell" style="color: var(--el-text-color-placeholder)">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="managerName" label="主管" width="120" />
        <el-table-column label="校准等级" width="140">
          <template #default="{ row }">
            <el-select
              :model-value="getDisplayGrade((row as CalibrationCandidate).taskId, row as CalibrationCandidate)"
              placeholder="等级"
              size="small"
              style="width: 100px"
              @update:model-value="handleGradeChange((row as CalibrationCandidate).taskId, row as CalibrationCandidate, $event as PerfGrade)"
            >
              <el-option v-for="g in GRADES" :key="g" :label="GRADE_LABELS[g]" :value="g" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="校准说明" min-width="180">
          <template #default="{ row }">
            <el-input
              :model-value="edits[(row as CalibrationCandidate).taskId]?.calibrationNote ?? ''"
              placeholder="调整原因"
              size="small"
              clearable
              @update:model-value="handleNoteChange((row as CalibrationCandidate).taskId, row as CalibrationCandidate, $event)"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button
              :type="(edits[(row as CalibrationCandidate).taskId]?.isVeto ?? (row as CalibrationCandidate).isVeto) ? 'danger' : 'info'"
              link
              size="small"
              @click="toggleVeto((row as CalibrationCandidate).taskId, row as CalibrationCandidate)"
            >
              {{ (edits[(row as CalibrationCandidate).taskId]?.isVeto ?? (row as CalibrationCandidate).isVeto) ? '取消否决' : '一票否决' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="hasEdits" class="submit-hint">
        <el-alert title="尚有未提交的校准调整，记得点击「提交校准」" type="info" :closable="false" />
      </div>
    </ChartCard>
  </div>
</template>

<style scoped>
.cycle-info {
  margin-top: 8px;
}

.chart-card,
.warning-card {
  height: 100%;
}

.chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.table-card {
  margin-bottom: 16px;
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
