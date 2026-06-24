<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Search, RefreshRight } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth.store';
import { tasksApi } from '@/api/tasks.api';
import { uploadApi } from '@/api/upload.api';
import { departmentsApi } from '@/api/departments.api';
import { usePagination } from '@/composables/usePagination';
import { usePermission } from '@/composables/usePermission';
import StatusBadge from '@/components/common/StatusBadge.vue';
import GradeTag from '@/components/common/GradeTag.vue';
import ScoreInput from '@/components/common/ScoreInput.vue';
import FileUpload from '@/components/common/FileUpload.vue';
import DeptTree from '@/components/common/DeptTree.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import { formatScore } from '@/utils/score';
import type { TaskListItem, TaskDetail, IndicatorInstance, ExtraScoreItem, Department, Attachment } from '@/types/api.types';
import type { DimensionType } from '@/types/enums';

interface EditableInstance extends IndicatorInstance {
  _managerScoreInput: number | null;
  _managerCommentInput: string;
  _extraScoresInput: ExtraScoreItem[];
}

const auth = useAuthStore();
const router = useRouter();
const user = computed(() => auth.user);

const list = ref<TaskListItem[]>([]);
const loading = ref(false);
const departments = ref<Department[]>([]);
const filters = reactive({ deptId: '', keyword: '' });
const {
  page,
  pageSize,
  total,
  pageSizeOptions,
  reset: resetPagination,
  withParams,
} = usePagination({ defaultPageSize: 10 });

const drawerVisible = ref(false);
const detailLoading = ref(false);
const selectedTask = ref<TaskDetail | null>(null);
const canEditCurrent = ref(false);
const editableInstances = ref<EditableInstance[]>([]);
const summaryForm = reactive({ strengths: '', improvements: '', developmentPlan: '', attachments: [] as Attachment[] });
const vetoForm = reactive({ isVeto: false, vetoReason: '' });
const submitting = ref(false);

const filteredList = computed(() => {
  const uid = user.value?.id;
  if (!uid) return list.value;
  // 真正的“待我评分”以 task.managerId 为准
  return list.value.filter((t) => t.managerId === uid);
});

const hasVetoIndicator = computed(() =>
  editableInstances.value.some((i) => i.indicatorType === 'veto'),
);

const dimensionTotals = computed(() => {
  const map = new Map<
    string,
    { dimensionName: string; dimensionType: DimensionType; total: number }
  >();
  for (const inst of editableInstances.value) {
    if (inst.indicatorType !== 'bonus' && inst.indicatorType !== 'penalty') continue;
    const key = inst.dimensionName || inst.indicatorType;
    const score =
      (inst._managerScoreInput ?? 0) +
      (inst._extraScoresInput?.reduce((sum, e) => sum + (e.value ?? 0), 0) ?? 0);
    const entry = map.get(key);
    if (entry) {
      entry.total += score;
    } else {
      map.set(key, {
        dimensionName: inst.dimensionName || (inst.indicatorType === 'bonus' ? '加分项' : '减分项'),
        dimensionType: inst.indicatorType,
        total: score,
      });
    }
  }
  return Array.from(map.values());
});

onMounted(() => {
  loadDepartments();
  loadList();
});

async function loadDepartments() {
  try {
    departments.value = await departmentsApi.getTree({ isActive: true });
  } catch {
    departments.value = [];
  }
}

async function loadList() {
  loading.value = true;
  try {
    const params = withParams({
      deptId: filters.deptId || undefined,
      keyword: filters.keyword || undefined,
      pageSize: 100,
    } as Record<string, unknown>);
    const [indicatorReviewing, managerScoring] = await Promise.all(
      (['indicator_reviewing', 'manager_scoring'] as const).map((status) =>
        tasksApi.findAll({ ...params, status }),
      ),
    );
    const merged = [...(indicatorReviewing.items ?? []), ...(managerScoring.items ?? [])];
    const unique = Array.from(new Map(merged.map((item) => [item.id, item])).values());
    list.value = unique;
    total.value = unique.length;
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
  filters.deptId = '';
  filters.keyword = '';
  resetPagination();
  loadList();
}

async function openDetail(task: TaskListItem) {
  if (task.status === 'indicator_reviewing') {
    router.push({ name: 'TaskDetail', params: { id: task.id } });
    return;
  }
  drawerVisible.value = true;
  detailLoading.value = true;
  try {
    const detail = await tasksApi.findOne(task.id);
    selectedTask.value = detail;
    initForms(detail);
  } catch {
    selectedTask.value = null;
    editableInstances.value = [];
  } finally {
    detailLoading.value = false;
  }
}

function actionLabel(task: TaskListItem): string {
  if (task.status === 'indicator_reviewing') return '审核指标';
  if (task.status === 'manager_scoring') return '进入评分';
  return '查看';
}

function initForms(detail: TaskDetail) {
  const p = usePermission({ task: detail });
  canEditCurrent.value = p.canEditManagerScore.value;

  editableInstances.value = (detail.indicatorInstances ?? []).map((inst) => ({
    ...inst,
    _managerScoreInput: inst.managerScore ?? null,
    _managerCommentInput: inst.managerComment ?? '',
    _extraScoresInput: Array.isArray(inst.extraScores) ? inst.extraScores.map((e) => ({ ...e })) : [],
  }));

  summaryForm.strengths = detail.managerEvalSummary?.strengths ?? '';
  summaryForm.improvements = detail.managerEvalSummary?.improvements ?? '';
  summaryForm.developmentPlan = detail.managerEvalSummary?.developmentPlan ?? '';
  summaryForm.attachments = detail.managerEvalSummary?.attachments
    ? [...detail.managerEvalSummary.attachments]
    : [];

  vetoForm.isVeto = detail.gradeResult?.isVeto ?? false;
  vetoForm.vetoReason = detail.gradeResult?.vetoReason ?? '';
}

function closeDetail() {
  drawerVisible.value = false;
  selectedTask.value = null;
  editableInstances.value = [];
  canEditCurrent.value = false;
}

function addExtraScore(inst: EditableInstance) {
  if (!canEditCurrent.value) return;
  inst._extraScoresInput.push({ label: '', value: 0 });
}

function removeExtraScore(inst: EditableInstance, index: number) {
  if (!canEditCurrent.value) return;
  inst._extraScoresInput.splice(index, 1);
}

function instanceTotal(inst: EditableInstance): number {
  const base = inst._managerScoreInput ?? 0;
  const extra = inst._extraScoresInput.reduce((sum, e) => sum + (e.value ?? 0), 0);
  return Math.round((base + extra) * 10) / 10;
}

async function handleUpload(files: File[]) {
  for (const file of files) {
    try {
      const attachment = await uploadApi.upload(file);
      summaryForm.attachments.push(attachment);
      ElMessage.success(`「${file.name}」上传成功`);
    } catch {
      ElMessage.error(`「${file.name}」上传失败`);
    }
  }
}

function handleAttachmentsChange(attachments: Attachment[]) {
  summaryForm.attachments = attachments;
}

async function handleSubmit() {
  const task = selectedTask.value;
  if (!task || !canEditCurrent.value) return;

  // 校验所有指标已打分
  for (const inst of editableInstances.value) {
    if (inst._managerScoreInput == null || Number.isNaN(inst._managerScoreInput)) {
      ElMessage.warning(`请为指标「${inst.name}」录入主管评分`);
      return;
    }
    for (const extra of inst._extraScoresInput) {
      if (!extra.label || extra.label.trim() === '') {
        ElMessage.warning(`请填写指标「${inst.name}」加减分原因`);
        return;
      }
      if (extra.value == null || Number.isNaN(extra.value)) {
        ElMessage.warning(`请填写指标「${inst.name}」加减分分值`);
        return;
      }
    }
  }

  if (vetoForm.isVeto && (!vetoForm.vetoReason || vetoForm.vetoReason.trim() === '')) {
    ElMessage.warning('一票否决必须填写原因');
    return;
  }

  const message = vetoForm.isVeto
    ? '确认提交评分？注意：您已勾选一票否决，提交后该员工本次绩效等级将直接评为 D。'
    : '确认提交主管评分？提交后任务将进入下一环节。';

  try {
    await ElMessageBox.confirm(message, '提交确认', { type: 'warning', confirmButtonText: '确认提交' });
  } catch {
    return;
  }

  submitting.value = true;
  try {
    const body = {
      indicators: editableInstances.value.map((inst) => ({
        id: inst.id,
        managerScore: inst._managerScoreInput as number,
        managerComment: inst._managerCommentInput || undefined,
        extraScores: inst._extraScoresInput.length ? inst._extraScoresInput : undefined,
      })),
      evalSummary: {
        strengths: summaryForm.strengths || undefined,
        improvements: summaryForm.improvements || undefined,
        developmentPlan: summaryForm.developmentPlan || undefined,
        attachments: summaryForm.attachments.length ? summaryForm.attachments : undefined,
      },
      veto: vetoForm.isVeto
        ? { isVeto: true, vetoReason: vetoForm.vetoReason.trim() }
        : undefined,
    };

    await tasksApi.submitManagerScore(task.id, body);
    ElMessage.success('提交成功');

    // 用后端最新状态刷新详情与列表
    const detail = await tasksApi.findOne(task.id);
    selectedTask.value = detail;
    initForms(detail);
    await loadList();
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="manager-scoring page-stack">
    <ChartCard>
      <template #title>团队绩效工作台</template>
      <template #extra>
        <el-tag type="info" size="small">展示需要我处理的指标审核与主管评分任务</el-tag>
      </template>

      <el-form :inline="true" class="filter-form" @submit.prevent="onSearch">
        <el-form-item label="部门">
          <DeptTree
            v-model="filters.deptId"
            :departments="departments"
            placeholder="选择部门"
            style="width: 220px"
          />
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
    </ChartCard>

    <ChartCard :padded="false" class="manager-scoring__list-card">
      <el-table v-loading="loading" class="app-table" :data="filteredList">
        <el-table-column label="员工" min-width="160">
          <template #default="{ row }">
            <div class="employee-cell">
              <span class="employee-name">{{ row.employeeName }}</span>
              <span v-if="row.employeeNo" class="employee-no">{{ row.employeeNo }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="deptName" label="部门" min-width="140" />
        <el-table-column prop="cycleName" label="考核周期" min-width="140" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <StatusBadge :status="row.status" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row as TaskListItem)">
              {{ actionLabel(row as TaskListItem) }}
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
      :title="`${selectedTask?.employeeName ?? ''} 的主管评分`"
      size="900"
      destroy-on-close
      @closed="closeDetail"
    >
      <div v-loading="detailLoading" class="drawer-body">
        <template v-if="selectedTask">
          <el-descriptions :column="3" border size="small" class="task-info">
            <el-descriptions-item label="员工">{{ selectedTask.employeeName }}</el-descriptions-item>
            <el-descriptions-item label="工号">{{ selectedTask.employeeNo || '-' }}</el-descriptions-item>
            <el-descriptions-item label="部门">{{ selectedTask.deptName || '-' }}</el-descriptions-item>
            <el-descriptions-item label="考核周期">{{ selectedTask.cycleName || '-' }}</el-descriptions-item>
            <el-descriptions-item label="当前状态">
              <StatusBadge :status="selectedTask.status" size="small" />
            </el-descriptions-item>
            <el-descriptions-item label="是否可编辑">
              <el-tag :type="canEditCurrent ? 'success' : 'info'" size="small">
                {{ canEditCurrent ? '可编辑' : '只读' }}
              </el-tag>
            </el-descriptions-item>
          </el-descriptions>

          <div v-if="dimensionTotals.length" class="dimension-totals">
            <span class="dimension-totals__title">维度小计（不含总分/等级）：</span>
            <span
              v-for="d in dimensionTotals"
              :key="d.dimensionName"
              class="dimension-total"
              :class="d.dimensionType === 'bonus' ? 'dimension-total--bonus' : 'dimension-total--penalty'"
            >
              {{ d.dimensionName }} {{ d.dimensionType === 'bonus' ? '+' : '-' }}{{ formatScore(d.total) }}
            </span>
          </div>

          <h4 class="section-title">指标评分</h4>
          <el-table :data="editableInstances" border class="indicator-table">
            <el-table-column label="指标" min-width="160">
              <template #default="{ row }">
                <div class="indicator-name">{{ row.name }}</div>
                <div v-if="row.description" class="indicator-desc">{{ row.description }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="dimensionName" label="维度" width="100" />
            <el-table-column label="权重" width="80">
              <template #default="{ row }">{{ row.weight }}</template>
            </el-table-column>
            <el-table-column label="目标" width="100">
              <template #default="{ row }">
                {{ row.targetValue != null ? `${row.targetValue}${row.unit ? row.unit : ''}` : '-' }}
              </template>
            </el-table-column>
            <el-table-column label="数据来源" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">
                {{ (row as IndicatorInstance).dataSource || '-' }}
              </template>
            </el-table-column>
            <el-table-column label="数据口径" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">
                {{ (row as IndicatorInstance).dataCaliber || '-' }}
              </template>
            </el-table-column>
            <el-table-column label="员工自评" width="100">
              <template #default="{ row }">{{ formatScore(row.selfScore) }}</template>
            </el-table-column>
            <el-table-column label="主管评分" width="130">
              <template #default="{ row }">
                <ScoreInput
                  v-model="row._managerScoreInput"
                  :disabled="!canEditCurrent"
                  size="small"
                  placeholder="评分"
                />
              </template>
            </el-table-column>
            <el-table-column label="主管评语" min-width="140">
              <template #default="{ row }">
                <el-input
                  v-model="row._managerCommentInput"
                  :disabled="!canEditCurrent"
                  type="textarea"
                  :rows="2"
                  placeholder="评语"
                  maxlength="500"
                  show-word-limit
                />
              </template>
            </el-table-column>
            <el-table-column v-if="hasVetoIndicator" label="一票否决" width="110" align="center">
              <template #default="{ row }">
                <el-tag v-if="row.indicatorType === 'veto'" type="danger" size="small">支持否决</el-tag>
                <span v-else>-</span>
              </template>
            </el-table-column>
          </el-table>

          <div v-for="inst in editableInstances" :key="`extra-${inst.id}`">
            <div
              v-if="inst.indicatorType === 'bonus' || inst.indicatorType === 'penalty'"
              class="extra-scores-card"
            >
              <div class="extra-scores-card__header">
                <span>
                  {{ inst.indicatorType === 'bonus' ? '加分' : '减分' }}明细：{{ inst.name }}
                  <span class="extra-scores-card__total">合计 {{ formatScore(instanceTotal(inst)) }}</span>
                </span>
                <el-button
                  v-if="canEditCurrent"
                  link
                  type="primary"
                  size="small"
                  @click="addExtraScore(inst)"
                >
                  + 添加
                </el-button>
              </div>
              <div v-if="inst._extraScoresInput.length" class="extra-scores-list">
                <div
                  v-for="(item, idx) in inst._extraScoresInput"
                  :key="idx"
                  class="extra-score-item"
                >
                  <el-input
                    v-model="item.label"
                    :disabled="!canEditCurrent"
                    placeholder="加减分原因"
                    size="small"
                    class="extra-score-item__label"
                  />
                  <ScoreInput
                    v-model="item.value"
                    :disabled="!canEditCurrent"
                    size="small"
                    placeholder="分值"
                    class="extra-score-item__value"
                  />
                  <el-button
                    v-if="canEditCurrent"
                    link
                    type="danger"
                    size="small"
                    @click="removeExtraScore(inst, idx)"
                  >
                    删除
                  </el-button>
                </div>
              </div>
              <el-empty v-else description="暂无明细" :image-size="60" />
            </div>
          </div>

          <h4 class="section-title">主管综合评价</h4>
          <div class="summary-form">
            <el-input
              v-model="summaryForm.strengths"
              :disabled="!canEditCurrent"
              type="textarea"
              :rows="3"
              placeholder="优势反馈 / 主要优点 / 业绩亮点"
              maxlength="2000"
              show-word-limit
            />
            <el-input
              v-model="summaryForm.improvements"
              :disabled="!canEditCurrent"
              type="textarea"
              :rows="3"
              placeholder="待改进项 / 不足与改进方向"
              maxlength="2000"
              show-word-limit
            />
            <el-input
              v-model="summaryForm.developmentPlan"
              :disabled="!canEditCurrent"
              type="textarea"
              :rows="3"
              placeholder="发展计划 / 培养建议（可选）"
              maxlength="2000"
              show-word-limit
            />
            <div class="manager-attachments">
              <span class="attachment-label">附件</span>
              <FileUpload
                :model-value="summaryForm.attachments"
                :disabled="!canEditCurrent"
                @upload="handleUpload"
                @update:model-value="handleAttachmentsChange"
              />
            </div>
          </div>

          <div v-if="hasVetoIndicator" class="veto-section">
            <el-divider />
            <el-form label-width="100px">
              <el-form-item label="一票否决">
                <el-checkbox v-model="vetoForm.isVeto" :disabled="!canEditCurrent">
                  该员工本次绩效一票否决（等级将直接评为 D）
                </el-checkbox>
              </el-form-item>
              <el-form-item v-if="vetoForm.isVeto" label="否决原因">
                <el-input
                  v-model="vetoForm.vetoReason"
                  :disabled="!canEditCurrent"
                  type="textarea"
                  :rows="3"
                  placeholder="请填写一票否决原因，提交后不可撤销"
                  maxlength="1000"
                  show-word-limit
                />
              </el-form-item>
            </el-form>
          </div>

          <div v-if="selectedTask.gradeResult" class="result-preview">
            <el-divider />
            <el-descriptions :column="2" border size="small" title="后端计算结果">
              <el-descriptions-item label="计算总分">{{ formatScore(selectedTask.gradeResult.calculatedScore) }}</el-descriptions-item>
              <el-descriptions-item label="当前等级">
                <GradeTag :grade="selectedTask.gradeResult.rawGrade" size="small" />
              </el-descriptions-item>
              <el-descriptions-item v-if="selectedTask.gradeResult.isVeto" label="否决原因">
                <el-tag type="danger" size="small">已否决</el-tag>
                {{ selectedTask.gradeResult.vetoReason }}
              </el-descriptions-item>
            </el-descriptions>
          </div>

          <div class="drawer-footer">
            <el-button @click="closeDetail">关闭</el-button>
            <el-button
              v-if="canEditCurrent"
              type="primary"
              :loading="submitting"
              @click="handleSubmit"
            >
              提交评分
            </el-button>
          </div>
        </template>
      </div>
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

.employee-no {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.drawer-body {
  padding-bottom: 24px;
}

.task-info {
  margin-bottom: 16px;
}

.dimension-totals {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px 16px;
  background: #f7f8fa;
  border-radius: 4px;
}

.dimension-totals__title {
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.dimension-total {
  font-size: 13px;
  font-weight: 500;
}

.dimension-total--bonus {
  color: var(--el-color-success);
}

.dimension-total--penalty {
  color: var(--el-color-danger);
}

.section-title {
  margin: 20px 0 12px;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.indicator-name {
  font-weight: 500;
}

.indicator-desc {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.indicator-table {
  margin-bottom: 12px;
}

.extra-scores-card {
  margin-bottom: 12px;
  padding: 12px 16px;
  background: #fafafa;
  border: 1px solid #eef0f3;
  border-radius: 4px;
}

.extra-scores-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 500;
}

.extra-scores-card__total {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  font-weight: 400;
}

.extra-scores-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.extra-score-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.extra-score-item__label {
  flex: 1;
}

.extra-score-item__value {
  width: 140px;
}

.summary-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.manager-attachments {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.manager-attachments .attachment-label {
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.veto-section {
  margin-top: 16px;
}

.result-preview {
  margin-top: 16px;
}

.drawer-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 12px;
  background: #fff;
}
</style>
