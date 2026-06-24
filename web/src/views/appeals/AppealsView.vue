<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { appealsApi } from '@/api/appeals.api';
import { tasksApi } from '@/api/tasks.api';
import { cyclesApi } from '@/api/cycles.api';
import { departmentsApi } from '@/api/departments.api';
import GradeTag from '@/components/common/GradeTag.vue';
import FileUpload from '@/components/common/FileUpload.vue';
import DeptTree from '@/components/common/DeptTree.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import { usePagination } from '@/composables/usePagination';
import { formatDateTime } from '@/utils/date';
import type {
  AppealListItem,
  AppealDetail,
  Attachment,
  AssessmentCycle,
  Department,
  TaskListItem,
} from '@/types/api.types';
import type { AppealStatus, AppealResult, PerfGrade } from '@/types/enums';

const loading = ref(false);
const submitting = ref(false);

const appeals = ref<AppealListItem[]>([]);
const cycles = ref<AssessmentCycle[]>([]);
const departments = ref<Department[]>([]);

const filters = reactive({
  cycleId: undefined as string | undefined,
  status: undefined as AppealStatus | undefined,
  deptId: undefined as string | undefined,
  keyword: '',
});

const {
  page,
  pageSize,
  total,
  pageSizeOptions,
  withParams,
  reset: resetPagination,
} = usePagination({ defaultPageSize: 10 });

async function loadCycles() {
  try {
    const res = await cyclesApi.findAll({});
    cycles.value = res.items;
  } catch {
    cycles.value = [];
  }
}

async function loadDepartments() {
  try {
    const res = await departmentsApi.findAll({ isActive: true, pageSize: 1000 });
    departments.value = res;
  } catch {
    departments.value = [];
  }
}

async function loadList() {
  loading.value = true;
  try {
    const res = await appealsApi.findAll(
      withParams({
        ...(filters.cycleId ? { cycleId: filters.cycleId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.deptId ? { deptId: filters.deptId } : {}),
        ...(filters.keyword.trim() ? { keyword: filters.keyword.trim() } : {}),
      }),
    );
    appeals.value = res.items;
    total.value = res.total;
  } catch {
    appeals.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function resetFilters() {
  filters.cycleId = undefined;
  filters.status = undefined;
  filters.deptId = undefined;
  filters.keyword = '';
  resetPagination();
  loadList();
}

function search() {
  resetPagination();
  loadList();
}

watch(pageSize, () => {
  page.value = 1;
  loadList();
});

watch(page, () => {
  loadList();
});

onMounted(async () => {
  await Promise.all([loadCycles(), loadDepartments()]);
  loadList();
});

// ---------- 录入申诉 ----------

const createDialog = reactive({
  visible: false,
  taskId: '',
  reason: '',
  attachments: [] as Attachment[],
  taskOptions: [] as TaskListItem[],
  taskLoading: false,
});

function openCreateDialog() {
  createDialog.visible = true;
  createDialog.taskId = '';
  createDialog.reason = '';
  createDialog.attachments = [];
  createDialog.taskOptions = [];
  loadTaskOptions('');
}

function onTaskSelectFocus() {
  if (createDialog.taskOptions.length === 0) {
    loadTaskOptions('');
  }
}

async function loadTaskOptions(keyword: string) {
  createDialog.taskLoading = true;
  try {
    const res = await tasksApi.findAll({
      status: 'published',
      keyword: keyword.trim() || undefined,
      pageSize: 20,
    });
    createDialog.taskOptions = res.items;
  } catch {
    createDialog.taskOptions = [];
  } finally {
    createDialog.taskLoading = false;
  }
}

function taskOptionLabel(task: TaskListItem): string {
  const gradeText = task.grade ?? '未评级';
  return `${task.employeeName ?? task.employeeNo ?? '未知员工'} - ${task.deptName ?? '-'}（等级 ${gradeText}）`;
}

function handleCreateUpload(files: File[]) {
  for (const file of files) {
    createDialog.attachments.push({
      name: file.name,
      url: URL.createObjectURL(file),
      size: file.size,
    });
  }
  ElMessage.warning('附件上传功能待后端通用上传接口对接，当前仅在本地预览。');
}

async function submitCreate() {
  if (!createDialog.taskId) {
    ElMessage.warning('请选择被申诉任务');
    return;
  }
  if (!createDialog.reason.trim()) {
    ElMessage.warning('请填写申诉事由');
    return;
  }
  submitting.value = true;
  try {
    await appealsApi.create({
      taskId: createDialog.taskId,
      reason: createDialog.reason.trim(),
      attachments: createDialog.attachments,
    });
    ElMessage.success('申诉录入成功');
    createDialog.visible = false;
    search();
  } finally {
    submitting.value = false;
  }
}

// ---------- 详情 / 处理 ----------

const detailDialog = reactive({
  visible: false,
  appeal: null as AppealDetail | null,
  loading: false,
  result: 'maintained' as AppealResult,
  newGrade: undefined as PerfGrade | undefined,
  newGradeNote: '',
  resolution: '',
});

function openDetail(row: AppealListItem) {
  detailDialog.visible = true;
  detailDialog.appeal = null;
  detailDialog.result = 'maintained';
  detailDialog.newGrade = undefined;
  detailDialog.newGradeNote = '';
  detailDialog.resolution = '';
  loadDetail(row.id);
}

async function loadDetail(id: string) {
  detailDialog.loading = true;
  try {
    detailDialog.appeal = await appealsApi.findOne(id);
  } finally {
    detailDialog.loading = false;
  }
}

const isModified = computed(() => detailDialog.result === 'modified');

function asGrade(value: string | null | undefined): PerfGrade | null {
  if (!value) return null;
  return value as PerfGrade;
}

async function submitResolve() {
  const appeal = detailDialog.appeal;
  if (!appeal) return;

  if (!detailDialog.resolution.trim()) {
    ElMessage.warning('请填写处理说明');
    return;
  }
  if (isModified.value && !detailDialog.newGrade) {
    ElMessage.warning('改判时必须选择新等级');
    return;
  }

  submitting.value = true;
  try {
    const body: {
      resolution: string;
      result: AppealResult;
      newGrade?: PerfGrade;
      newGradeNote?: string;
    } = {
      resolution: detailDialog.resolution.trim(),
      result: detailDialog.result,
    };
    if (isModified.value) {
      body.newGrade = detailDialog.newGrade;
      if (detailDialog.newGradeNote.trim()) {
        body.newGradeNote = detailDialog.newGradeNote.trim();
      }
    }
    const updated = await appealsApi.resolve(appeal.id, body);
    detailDialog.appeal = updated;
    ElMessage.success('处理成功');
    loadList();
  } finally {
    submitting.value = false;
  }
}

// ---------- 展示辅助 ----------

const statusLabel: Record<AppealStatus, string> = {
  pending: '待处理',
  resolved: '已处理',
};

const resultLabel: Record<AppealResult, string> = {
  maintained: '维持原判',
  modified: '改判',
};

const resultType: Record<AppealResult, 'info' | 'success' | 'warning' | 'danger'> = {
  maintained: 'info',
  modified: 'warning',
};

function statusText(status: AppealStatus): string {
  return statusLabel[status];
}

function resultText(result: AppealResult): string {
  return resultLabel[result];
}

function resultTagType(result: AppealResult): 'info' | 'success' | 'warning' | 'danger' {
  return resultType[result];
}
</script>

<template>
  <div class="appeals-view page-stack">
    <ChartCard>
      <template #title>申诉处理</template>
      <template #extra>
        <el-button type="primary" @click="openCreateDialog">录入申诉</el-button>
      </template>

      <div class="appeals-view__filters">
        <el-select
          v-model="filters.cycleId"
          placeholder="考核周期"
          clearable
          style="width: 200px"
        >
          <el-option
            v-for="cycle in cycles"
            :key="cycle.id"
            :label="cycle.name"
            :value="cycle.id"
          />
        </el-select>

        <el-select
          v-model="filters.status"
          placeholder="状态"
          clearable
          style="width: 140px"
        >
          <el-option label="待处理" value="pending" />
          <el-option label="已处理" value="resolved" />
        </el-select>

        <DeptTree
          v-model="filters.deptId"
          :departments="departments"
          placeholder="选择部门"
          style="width: 220px"
        />

        <el-input
          v-model="filters.keyword"
          placeholder="员工姓名"
          clearable
          style="width: 200px"
          @keyup.enter="search"
        />

        <el-button type="primary" :loading="loading" @click="search">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </div>
    </ChartCard>

    <ChartCard :padded="false">
      <el-table v-loading="loading" :data="appeals" row-key="id" class="app-table">
        <el-table-column prop="appellant.name" label="员工" min-width="120">
          <template #default="{ row }">
            {{ row.appellant?.name ?? '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="dept.name" label="部门" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.dept?.name ?? '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="cycle.name" label="考核周期" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.cycle?.name ?? '-' }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'pending' ? 'warning' : 'success'" size="small">
              {{ statusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="处理结果" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.finalResult" :type="resultTagType(row.finalResult)" size="small">
              {{ resultText(row.finalResult) }}
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">
            {{ formatDateTime(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row as AppealListItem)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="!loading && appeals.length === 0" class="appeals-view__empty">
        <EmptyState description="暂无申诉记录" />
      </div>

      <div v-if="total > 0" class="app-pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="pageSizeOptions"
          :total="total"
          layout="total, sizes, prev, pager, next"
        />
      </div>
    </ChartCard>

    <!-- 录入申诉 -->
    <el-dialog
      v-model="createDialog.visible"
      title="录入申诉"
      width="560px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form label-width="90px">
        <el-form-item label="被申诉任务" required>
          <el-select
            v-model="createDialog.taskId"
            placeholder="搜索已公示任务"
            filterable
            remote
            clearable
            :remote-method="loadTaskOptions"
            :loading="createDialog.taskLoading"
            style="width: 100%"
            @focus="onTaskSelectFocus"
          >
            <el-option
              v-for="task in createDialog.taskOptions"
              :key="task.id"
              :label="taskOptionLabel(task)"
              :value="task.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="申诉事由" required>
          <el-input
            v-model="createDialog.reason"
            type="textarea"
            :rows="4"
            placeholder="请输入申诉事由"
            maxlength="1000"
            show-word-limit
          />
        </el-form-item>

        <el-form-item label="附件">
          <FileUpload
            :model-value="createDialog.attachments"
            @upload="handleCreateUpload"
            @update:model-value="createDialog.attachments = $event"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="createDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitCreate">提交</el-button>
      </template>
    </el-dialog>

    <!-- 详情 / 处理 -->
    <el-dialog
      v-model="detailDialog.visible"
      title="申诉详情"
      width="640px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-skeleton v-if="detailDialog.loading" :rows="6" animated />

      <template v-else-if="detailDialog.appeal">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="员工">
            {{ detailDialog.appeal.appellant?.name ?? '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="部门">
            {{ detailDialog.appeal.dept?.name ?? '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="考核周期" :span="2">
            {{ detailDialog.appeal.cycle?.name ?? '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="计算分">
            {{ detailDialog.appeal.taskGrade?.calculatedScore?.toFixed(2) ?? '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="原始等级">
            <GradeTag :grade="asGrade(detailDialog.appeal.taskGrade?.rawGrade)" size="small" />
          </el-descriptions-item>
          <el-descriptions-item label="校准等级">
            <GradeTag :grade="asGrade(detailDialog.appeal.taskGrade?.calibratedGrade)" size="small" />
          </el-descriptions-item>
        </el-descriptions>

        <div class="appeals-view__section">
          <div class="appeals-view__section-title">申诉事由</div>
          <div class="appeals-view__section-body">{{ detailDialog.appeal.reason }}</div>
        </div>

        <div class="appeals-view__section">
          <div class="appeals-view__section-title">附件</div>
          <ul v-if="detailDialog.appeal.attachments?.length" class="appeals-view__attachments">
            <li v-for="(file, idx) in detailDialog.appeal.attachments" :key="idx">
              <a :href="file.url" target="_blank" rel="noopener">{{ file.name }}</a>
            </li>
          </ul>
          <div v-else class="appeals-view__section-body">无附件</div>
        </div>

        <!-- 已处理结果展示 -->
        <template v-if="detailDialog.appeal.status === 'resolved'">
          <el-divider />
          <el-descriptions :column="2" border>
            <el-descriptions-item label="处理结果">
              <el-tag :type="resultTagType(detailDialog.appeal.finalResult as AppealResult)" size="small">
                {{ detailDialog.appeal.finalResult ? resultLabel[detailDialog.appeal.finalResult] : '-' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item v-if="detailDialog.appeal.finalResult === 'modified'" label="新等级">
              <GradeTag :grade="asGrade(detailDialog.appeal.taskGrade?.calibratedGrade)" size="small" />
            </el-descriptions-item>
          </el-descriptions>
          <div class="appeals-view__section">
            <div class="appeals-view__section-title">处理说明</div>
            <div class="appeals-view__section-body">{{ detailDialog.appeal.hrResolution ?? '-' }}</div>
          </div>
        </template>

        <!-- 待处理表单 -->
        <template v-else>
          <el-divider />
          <el-form label-width="90px">
            <el-form-item label="处理结果" required>
              <el-radio-group v-model="detailDialog.result">
                <el-radio label="maintained">维持原判</el-radio>
                <el-radio label="modified">改判</el-radio>
              </el-radio-group>
            </el-form-item>

            <template v-if="isModified">
              <el-form-item label="新等级" required>
                <el-select v-model="detailDialog.newGrade" placeholder="选择新等级" clearable>
                  <el-option label="A" value="A" />
                  <el-option label="B" value="B" />
                  <el-option label="C" value="C" />
                  <el-option label="D" value="D" />
                </el-select>
              </el-form-item>
              <el-form-item label="改判说明">
                <el-input
                  v-model="detailDialog.newGradeNote"
                  type="textarea"
                  :rows="2"
                  placeholder="请输入改判说明（可选）"
                  maxlength="500"
                  show-word-limit
                />
              </el-form-item>
            </template>

            <el-form-item label="处理说明" required>
              <el-input
                v-model="detailDialog.resolution"
                type="textarea"
                :rows="4"
                placeholder="请输入处理说明"
                maxlength="1000"
                show-word-limit
              />
            </el-form-item>
          </el-form>
        </template>
      </template>

      <template #footer>
        <el-button @click="detailDialog.visible = false">关闭</el-button>
        <el-button
          v-if="detailDialog.appeal?.status === 'pending'"
          type="primary"
          :loading="submitting"
          @click="submitResolve"
        >
          提交处理
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.appeals-view__filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.appeals-view__empty {
  padding: 24px 0;
}

.appeals-view__section {
  margin-top: 16px;
}

.appeals-view__section-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-regular);
  margin-bottom: 8px;
}

.appeals-view__section-body {
  font-size: 14px;
  color: var(--el-text-color-primary);
  line-height: 1.6;
  white-space: pre-wrap;
}

.appeals-view__attachments {
  margin: 0;
  padding: 0;
  list-style: none;
}

.appeals-view__attachments li {
  margin-bottom: 6px;
}

.appeals-view__attachments a {
  color: var(--el-color-primary);
  text-decoration: none;
}
</style>
