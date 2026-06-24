<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Plus, Warning } from '@element-plus/icons-vue';
import { confirmationApi } from '@/api/confirmation.api';
import UserSelect from '@/components/common/UserSelect.vue';
import ChartCard from '@/components/common/ChartCard.vue';
import { usePagination } from '@/composables/usePagination';
import {
  CONFIRMATION_STATUS_META,
  VOTE_RESULT_LABELS,
} from '@/types/enums';
import { formatDate } from '@/utils/date';
import type {
  ConfirmationApplication,
  ConfirmationWarning,
} from '@/types/api.types';
import type { ConfirmationStatus } from '@/types/enums';

const router = useRouter();

const list = ref<ConfirmationApplication[]>([]);
const loading = ref(false);
const warnings = ref<ConfirmationWarning[]>([]);
const warningsLoading = ref(false);

const filters = reactive<{
  status: ConfirmationStatus | '';
  keyword: string;
}>({ status: '', keyword: '' });

const {
  page,
  pageSize,
  total,
  pageSizeOptions,
  reset: resetPagination,
  withParams,
} = usePagination({ defaultPageSize: 10 });

const dialogVisible = ref(false);
const dialogTitle = computed(() => (form.id ? '编辑转正申请' : '发起转正申请'));
const saving = ref(false);
const submitting = ref(false);

const emptyForm = () => ({
  id: '',
  employeeId: '',
  probationReviewId: '',
  managerId: '',
  hrId: '',
  companyApproverId: '',
  summary: '',
  salary: undefined as number | undefined,
  voteResult: '' as 'pass' | 'extend' | 'fail' | '',
  voteParticipants: [] as string[],
  voteComment: '',
  voteMeetingTime: '',
  actualRegularDate: '',
});

const form = reactive(emptyForm());

const statusOptions: ConfirmationStatus[] = [
  'draft',
  'submitted',
  'manager_approved',
  'hr_approved',
  'approved',
  'rejected',
];

const voteOptions: Array<{ value: 'pass' | 'extend' | 'fail'; label: string }> = [
  { value: 'pass', label: '通过' },
  { value: 'extend', label: '延期' },
  { value: 'fail', label: '不通过' },
];

onMounted(() => {
  loadList();
  loadWarnings();
});

async function loadList() {
  loading.value = true;
  try {
    const res = await confirmationApi.findAll(
      withParams({
        status: filters.status || undefined,
        keyword: filters.keyword || undefined,
      } as Record<string, unknown>),
    );
    list.value = res.items;
    total.value = res.total;
  } catch {
    list.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

async function loadWarnings() {
  warningsLoading.value = true;
  try {
    warnings.value = await confirmationApi.warnings();
  } catch {
    warnings.value = [];
  } finally {
    warningsLoading.value = false;
  }
}


function onSearch() {
  resetPagination();
  loadList();
}

function onReset() {
  filters.status = '';
  filters.keyword = '';
  resetPagination();
  loadList();
}

function openCreate() {
  Object.assign(form, emptyForm());
  dialogVisible.value = true;
}

function openEdit(row: ConfirmationApplication) {
  Object.assign(form, {
    id: row.id,
    employeeId: row.employeeId,
    probationReviewId: row.probationReviewId ?? '',
    managerId: row.managerId,
    hrId: row.hrId,
    companyApproverId: row.companyApproverId,
    summary: row.summary ?? '',
    salary: row.salary ?? undefined,
    voteResult: row.voteResult ?? '',
    voteParticipants: row.voteParticipants ?? [],
    voteComment: row.voteComment ?? '',
    voteMeetingTime: row.voteMeetingTime ?? '',
    actualRegularDate: row.actualRegularDate ?? '',
  });
  dialogVisible.value = true;
}

async function handleSave() {
  if (!form.employeeId || !form.managerId || !form.hrId || !form.companyApproverId) {
    ElMessage.warning('请完整填写员工、主管、HR、公司审批人');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      employeeId: form.employeeId,
      probationReviewId: form.probationReviewId || undefined,
      managerId: form.managerId,
      hrId: form.hrId,
      companyApproverId: form.companyApproverId,
      summary: form.summary || undefined,
      salary: form.salary,
      voteResult: form.voteResult || undefined,
      voteParticipants: form.voteParticipants.length ? form.voteParticipants : undefined,
      voteComment: form.voteComment || undefined,
      voteMeetingTime: form.voteMeetingTime || undefined,
      actualRegularDate: form.actualRegularDate || undefined,
    };
    if (form.id) {
      await confirmationApi.update(form.id, payload);
    } else {
      await confirmationApi.create(payload);
    }
    ElMessage.success(form.id ? '更新成功' : '发起成功');
    dialogVisible.value = false;
    loadList();
    loadWarnings();
  } finally {
    saving.value = false;
  }
}

async function handleSubmit(row: ConfirmationApplication) {
  if (row.status !== 'draft') return;
  submitting.value = true;
  try {
    await confirmationApi.submit(row.id);
    ElMessage.success('已提交审批');
    loadList();
  } finally {
    submitting.value = false;
  }
}

function goDetail(row: ConfirmationApplication) {
  router.push(`/confirmation-applications/${row.id}`);
}

function statusLabel(status: ConfirmationStatus): string {
  return CONFIRMATION_STATUS_META[status]?.label ?? status;
}

function statusType(status: ConfirmationStatus): string {
  return CONFIRMATION_STATUS_META[status]?.type ?? 'info';
}

function voteLabel(result?: string | null): string {
  if (!result) return '-';
  return VOTE_RESULT_LABELS[result as keyof typeof VOTE_RESULT_LABELS]?.label ?? result;
}

function voteType(result?: string | null): string {
  if (!result) return 'info';
  return VOTE_RESULT_LABELS[result as keyof typeof VOTE_RESULT_LABELS]?.type ?? 'info';
}

</script>

<template>
  <div class="confirmation-manage page-stack">
    <!-- 预警卡片 -->
    <ChartCard class="warning-card">
      <template #title>
        <span class="warning-title">
          <el-icon class="warning-icon"><Warning /></el-icon>
          转正申请预警（计划转正日期 ≤ 7 天且未提交申请）
        </span>
      </template>

      <el-table v-loading="warningsLoading" :data="warnings" class="app-table" size="small">
        <el-table-column label="员工" prop="employeeName" />
        <el-table-column label="工号" prop="employeeNo" />
        <el-table-column label="部门" prop="deptName" />
        <el-table-column label="计划转正日期">
          <template #default="{ row }">{{ formatDate(row.plannedRegularDate) }}</template>
        </el-table-column>
        <el-table-column label="剩余天数" prop="daysUntil" />
        <el-table-column label="状态">
          <template #default="{ row }">
            <el-tag :type="row.hasApplication ? 'success' : 'danger'" size="small">
              {{ row.hasApplication ? '已创建申请' : '未创建申请' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </ChartCard>

    <ChartCard class="header-card">
      <template #title>转正申请管理</template>
      <template #extra>
        <el-button data-testid="confirmation-create" type="primary" :icon="Plus" @click="openCreate">发起转正申请</el-button>
      </template>

      <el-form :inline="true" class="filter-form" @submit.prevent="onSearch">
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 160px">
            <el-option
              v-for="s in statusOptions"
              :key="s"
              :label="statusLabel(s)"
              :value="s"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="姓名">
          <el-input v-model="filters.keyword" placeholder="请输入姓名" clearable style="width: 220px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="onSearch">查询</el-button>
          <el-button @click="onReset">重置</el-button>
        </el-form-item>
      </el-form>
    </ChartCard>

    <ChartCard :padded="false">
      <el-table v-loading="loading" :data="list" class="app-table">
        <el-table-column label="员工" min-width="120">
          <template #default="{ row }">{{ (row as ConfirmationApplication).employee?.name }}</template>
        </el-table-column>
        <el-table-column label="主管" min-width="120">
          <template #default="{ row }">{{ (row as ConfirmationApplication).manager?.name }}</template>
        </el-table-column>
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-tag :type="statusType((row as ConfirmationApplication).status) as any" size="small">
              {{ statusLabel((row as ConfirmationApplication).status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="表决结果" width="100">
          <template #default="{ row }">
            <el-tag
              v-if="(row as ConfirmationApplication).voteResult"
              :type="voteType((row as ConfirmationApplication).voteResult) as any"
              size="small"
            >
              {{ voteLabel((row as ConfirmationApplication).voteResult) }}
            </el-tag>
            <span v-else class="text-placeholder">-</span>
          </template>
        </el-table-column>
        <el-table-column label="实际转正日期" width="130">
          <template #default="{ row }">{{ formatDate((row as ConfirmationApplication).actualRegularDate) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="goDetail(row as ConfirmationApplication)">
              查看
            </el-button>
            <el-button
              v-if="(row as ConfirmationApplication).status === 'draft'"
              link
              type="warning"
              size="small"
              @click="openEdit(row as ConfirmationApplication)"
            >
              编辑
            </el-button>
            <el-button
              v-if="(row as ConfirmationApplication).status === 'draft'"
              link
              type="success"
              size="small"
              :loading="submitting"
              @click="handleSubmit(row as ConfirmationApplication)"
            >
              提交
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

    <el-dialog
      v-model="dialogVisible"
      data-testid="confirmation-dialog"
      :title="dialogTitle"
      width="720"
      destroy-on-close
      :close-on-click-modal="false"
    >
      <el-form label-position="top">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="试用期员工">
              <UserSelect v-model="form.employeeId" status="probation" placeholder="搜索试用期员工" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="试用期考核 ID（可选）">
              <el-input v-model="form.probationReviewId" placeholder="关联试用期考核" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="主管审批人">
              <UserSelect v-model="form.managerId" placeholder="搜索主管" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="HR 审批人">
              <UserSelect v-model="form.hrId" placeholder="搜索 HR 审批人" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="公司审批人">
              <UserSelect v-model="form.companyApproverId" placeholder="搜索公司审批人" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="试用期小结">
          <el-input
            v-model="form.summary"
            type="textarea"
            :rows="4"
            maxlength="4000"
            show-word-limit
            placeholder="填写试用期小结"
          />
        </el-form-item>

        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="转正后薪资（仅 HR/审批链可见）">
              <el-input-number
                v-model="form.salary"
                :min="0"
                :precision="2"
                placeholder="薪资"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="实际转正日期">
              <el-date-picker
                v-model="form.actualRegularDate"
                type="date"
                placeholder="选择日期"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="表决结果">
              <el-select v-model="form.voteResult" placeholder="选择表决结果" clearable style="width: 100%">
                <el-option
                  v-for="opt in voteOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="会议时间">
              <el-date-picker
                v-model="form.voteMeetingTime"
                type="datetime"
                placeholder="选择会议时间"
                value-format="YYYY-MM-DDTHH:mm:ss"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="参与人（多选）">
              <UserSelect v-model="form.voteParticipants" multiple placeholder="搜索参与人（多选）" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="表决意见">
          <el-input
            v-model="form.voteComment"
            type="textarea"
            :rows="3"
            maxlength="4000"
            show-word-limit
            placeholder="填写表决意见"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.warning-title {
  display: inline-flex;
  align-items: center;
}

.warning-icon {
  color: var(--el-color-danger);
  margin-right: 6px;
}

.filter-form :deep(.el-form-item) {
  margin-bottom: 0;
}

.text-placeholder {
  color: var(--el-text-color-placeholder);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
