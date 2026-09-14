<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { isAxiosError } from 'axios';
import { ElMessage } from 'element-plus';
import { confirmationApi } from '@/api/confirmation.api';
import ChartCard from '@/components/common/ChartCard.vue';
import ListPagination from '@/components/common/ListPagination.vue';
import MobileResultCard from '@/components/common/MobileResultCard.vue';
import QueryFilterPanel from '@/components/common/QueryFilterPanel.vue';
import { usePagination } from '@/composables/usePagination';
import { CONFIRMATION_STATUS_META } from '@/types/enums';
import { formatDate } from '@/utils/date';
import type { ConfirmationApplication, ConfirmationWarning } from '@/types/api.types';
import type { ConfirmationStatus } from '@/types/enums';
import { useAuthStore } from '@/stores/auth.store';

const router = useRouter();
const auth = useAuthStore();
const list = ref<ConfirmationApplication[]>([]);
const loading = ref(false);
const warnings = ref<ConfirmationWarning[]>([]);
type Candidate = { id: string; name: string; employeeNo: string | null; deptName: string | null; hrEligible: boolean };
const candidates = ref<Candidate[]>([]);
const candidateLoading = ref(false);
const attentionOpen = ref(false);
const assignmentOpen = ref(false);
const assignmentRow = ref<ConfirmationApplication | null>(null);
const assignment = reactive<{ hrId: string; companyApproverId: string; reason: string }>({ hrId: '', companyApproverId: '', reason: '' });
const assignmentError = ref('');
const assignmentSaving = ref(false);
const hrCandidates = computed(() => candidates.value.filter((person) => person.hrEligible));
const attentionItems = computed(() => warnings.value.filter((item) => !item.hasApplication || !item.plannedRegularDate));
const filters = reactive<{ keyword: string; status: ConfirmationStatus | '' }>({ keyword: '', status: '' });
const statusOptions: ConfirmationStatus[] = ['draft', 'submitted', 'manager_approved', 'hr_approved', 'approved', 'rejected'];
const { page, pageSize, total, pageSizeOptions, reset: resetPagination, withParams } = usePagination({ defaultPageSize: 10 });

onMounted(() => { void loadList(); void loadWarnings(); });

async function loadWarnings() {
  try { warnings.value = await confirmationApi.warnings(); }
  catch { warnings.value = []; }
}

async function searchCandidates(keyword: string) {
  candidateLoading.value = true;
  try {
    const found = await confirmationApi.handlerCandidates(keyword);
    candidates.value = [...new Map([...candidates.value, ...found].map((person) => [person.id, person])).values()];
  } finally { candidateLoading.value = false; }
}

function canConfigure(row: ConfirmationApplication) {
  return row.workflowVersion === 2 && ['draft', 'submitted', 'manager_approved', 'hr_approved'].includes(row.status);
}

function openAssignment(row: ConfirmationApplication) {
  assignmentRow.value = row;
  assignment.hrId = row.hrId ?? '';
  assignment.companyApproverId = row.companyApproverId ?? '';
  assignment.reason = '';
  assignmentError.value = '';
  candidates.value = [
    ...(row.hr ? [{ ...row.hr, employeeNo: null, deptName: null, hrEligible: true }] : []),
    ...(row.companyApprover ? [{ ...row.companyApprover, employeeNo: null, deptName: null, hrEligible: false }] : []),
  ];
  assignmentOpen.value = true;
  void searchCandidates('');
}

function candidateLabel(person: Candidate) {
  return [person.name, person.employeeNo, person.deptName].filter(Boolean).join(' · ');
}

async function saveAssignment() {
  if (!assignmentRow.value) return;
  if (!assignment.hrId || !assignment.companyApproverId) {
    assignmentError.value = '请选择 HR 办理人和公司审批人'; return;
  }
  if (assignment.hrId === assignment.companyApproverId) {
    assignmentError.value = '两项办理职责请指定不同人员'; return;
  }
  if ((assignmentRow.value.submissionVersion ?? 0) > 0 && !assignment.reason.trim()) {
    assignmentError.value = '请填写改派原因'; return;
  }
  assignmentSaving.value = true;
  assignmentError.value = '';
  try {
    await confirmationApi.assignHandlers(assignmentRow.value.id, {
      hrId: assignment.hrId,
      companyApproverId: assignment.companyApproverId,
      ...((assignmentRow.value.submissionVersion ?? 0) > 0 ? { reason: assignment.reason.trim() } : {}),
    });
    assignmentOpen.value = false;
    ElMessage.success((assignmentRow.value.submissionVersion ?? 0) > 0 ? '办理人已调整' : '办理人已指定，员工现在可以提交申请');
    await loadList();
  } catch (error) {
    assignmentError.value = isAxiosError(error) ? error.response?.data?.message ?? '指定失败，请重试'
      : error instanceof Error ? error.message : '指定失败，请重试';
  } finally { assignmentSaving.value = false; }
}

async function loadList() {
  loading.value = true;
  try {
    const result = await confirmationApi.findAll(withParams({
      keyword: filters.keyword || undefined,
      status: filters.status || undefined,
    }));
    list.value = result.items;
    total.value = result.total;
  } catch {
    list.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function search() {
  resetPagination();
  loadList();
}

function reset() {
  filters.keyword = '';
  filters.status = '';
  search();
}

function statusLabel(row: ConfirmationApplication) {
  if (row.status === 'draft' && row.returnReason) return '退回补充';
  return CONFIRMATION_STATUS_META[row.status]?.label ?? row.status;
}

function statusType(row: ConfirmationApplication) {
  return CONFIRMATION_STATUS_META[row.status]?.type ?? 'info';
}
</script>

<template>
  <div class="page-stack app-list-page">
    <ChartCard class="list-page-header-card">
      <template #title>转正管理</template>
      <template #extra>
        <el-button v-if="attentionItems.length" link type="warning" data-testid="confirmation-attention-trigger" @click="attentionOpen = true">待关注 {{ attentionItems.length }} 人</el-button>
      </template>
      <QueryFilterPanel class="page-filter-panel">
        <el-form :inline="true" class="filter-form" @submit.prevent="search">
          <el-form-item label="状态">
            <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 160px">
              <el-option v-for="status in statusOptions" :key="status" :label="CONFIRMATION_STATUS_META[status]?.label ?? status" :value="status" />
            </el-select>
          </el-form-item>
          <el-form-item label="姓名"><el-input v-model="filters.keyword" placeholder="请输入姓名" clearable style="width: 220px" /></el-form-item>
          <el-form-item><el-button type="primary" @click="search">查询</el-button><el-button @click="reset">重置</el-button></el-form-item>
        </el-form>
      </QueryFilterPanel>
    </ChartCard>

    <ChartCard :padded="false" class="list-result-card">
      <div class="desktop-result-table">
        <el-table v-loading="loading" :data="list" height="100%" class="app-table">
          <el-table-column label="员工" min-width="120"><template #default="{ row }">{{ (row as ConfirmationApplication).employee?.name }}</template></el-table-column>
          <el-table-column label="状态" width="130"><template #default="{ row }"><el-tag :type="statusType(row as ConfirmationApplication) as any" size="small">{{ statusLabel(row as ConfirmationApplication) }}</el-tag></template></el-table-column>
          <el-table-column label="直属主管" min-width="120"><template #default="{ row }">{{ (row as ConfirmationApplication).manager?.name || '待核实' }}</template></el-table-column>
          <el-table-column label="HR 办理人" min-width="120"><template #default="{ row }">{{ (row as ConfirmationApplication).hr?.name || '待配置' }}</template></el-table-column>
          <el-table-column label="公司审批人" min-width="120"><template #default="{ row }">{{ (row as ConfirmationApplication).companyApprover?.name || '待配置' }}</template></el-table-column>
          <el-table-column label="实际转正日期" width="135"><template #default="{ row }">{{ formatDate((row as ConfirmationApplication).actualRegularDate) }}</template></el-table-column>
          <el-table-column label="操作" width="165" fixed="right"><template #default="{ row }">
            <el-button v-if="canConfigure(row as ConfirmationApplication)" link type="primary" @click="openAssignment(row as ConfirmationApplication)">{{ (row as ConfirmationApplication).submissionVersion ? '调整办理人' : '指定办理人' }}</el-button>
            <el-button link type="primary" @click="router.push(`/confirmation-applications/${(row as ConfirmationApplication).id}`)">查看</el-button>
          </template></el-table-column>
        </el-table>
      </div>
      <div v-loading="loading" class="mobile-result-list">
        <MobileResultCard v-for="item in list" :key="item.id">
          <template #title>{{ item.employee?.name || '-' }}</template>
          <template #status><el-tag :type="statusType(item) as any" size="small">{{ statusLabel(item) }}</el-tag></template>
          <div class="mobile-result-field"><span class="mobile-result-field__label">直属主管</span><span class="mobile-result-field__value">{{ item.manager?.name || '待核实' }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">HR 办理人</span><span class="mobile-result-field__value">{{ item.hr?.name || '待配置' }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">公司审批人</span><span class="mobile-result-field__value">{{ item.companyApprover?.name || '待配置' }}</span></div>
          <div class="mobile-result-field"><span class="mobile-result-field__label">转正日期</span><span class="mobile-result-field__value">{{ formatDate(item.actualRegularDate) }}</span></div>
          <template #actions>
            <el-button v-if="canConfigure(item)" link type="primary" @click="openAssignment(item)">{{ item.submissionVersion ? '调整办理人' : '指定办理人' }}</el-button>
            <el-button link type="primary" @click="router.push(`/confirmation-applications/${item.id}`)">查看</el-button>
          </template>
        </MobileResultCard>
      </div>
      <ListPagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="pageSizeOptions" :total="total" @change="loadList" />
    </ChartCard>
    <el-drawer v-model="attentionOpen" title="试用期员工待关注" size="min(480px, 100vw)" append-to-body>
      <p class="attention-intro">计划转正日期临近、已过或缺失的员工。请核实档案，并提醒尚未提交申请的员工发起转正。</p>
      <div class="attention-list" role="list">
        <div v-for="item in attentionItems" :key="item.employeeId" class="attention-item" role="listitem">
          <div class="attention-item__head"><strong>{{ item.employeeName }}</strong><span>{{ item.deptName || '部门待核实' }}</span></div>
          <div class="attention-item__meta">
            <span>{{ item.plannedRegularDate ? `${formatDate(item.plannedRegularDate)}${(item.daysUntil ?? 0) < 0 ? '（已逾期）' : '（临近）'}` : '计划转正日期待核实' }}</span>
            <el-tag :type="item.hasApplication ? 'info' : 'warning'" size="small">{{ item.hasApplication ? '已提交申请' : '尚未提交申请' }}</el-tag>
          </div>
        </div>
      </div>
    </el-drawer>
    <el-dialog v-model="assignmentOpen" :title="assignmentRow?.submissionVersion ? '调整转正办理人' : '指定转正办理人'" width="min(480px, 94vw)" append-to-body>
      <p class="assignment-tip">{{ assignmentRow?.employee?.name }}的直属主管来自花名册。{{ ['draft', 'submitted'].includes(assignmentRow?.status ?? '') ? '保存时将按最新花名册核对主管。' : '已提交的主管评价和 HR 结论不会被改写。' }}</p>
      <el-form label-position="top">
        <el-form-item label="HR 办理人" required>
          <el-select v-model="assignment.hrId" filterable remote :remote-method="searchCandidates" :loading="candidateLoading" :disabled="assignmentRow?.status === 'hr_approved'" placeholder="搜索具备转正办理权限的 HR" style="width: 100%">
            <el-option v-for="person in hrCandidates" :key="person.id" :value="person.id" :label="candidateLabel(person)" :disabled="person.id === assignmentRow?.employeeId" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="(assignmentRow?.submissionVersion ?? 0) > 0" label="改派原因" required>
          <el-input v-model="assignment.reason" type="textarea" :rows="3" maxlength="1000" show-word-limit placeholder="说明人员变更及改派原因" />
        </el-form-item>
        <el-form-item label="公司审批人" required>
          <el-select v-model="assignment.companyApproverId" filterable remote :remote-method="searchCandidates" :loading="candidateLoading" placeholder="搜索公司审批人" style="width: 100%">
            <el-option v-for="person in candidates" :key="person.id" :value="person.id" :label="candidateLabel(person)" :disabled="person.id === assignmentRow?.employeeId || person.id === assignment.hrId || person.id === auth.user?.id" />
          </el-select>
        </el-form-item>
        <p v-if="assignmentError" class="field-error" role="alert">{{ assignmentError }}</p>
      </el-form>
      <template #footer><el-button @click="assignmentOpen = false">取消</el-button><el-button type="primary" :loading="assignmentSaving" @click="saveAssignment">{{ assignmentRow?.submissionVersion ? '保存改派' : '保存办理人' }}</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.filter-form :deep(.el-form-item) { margin-bottom: 0; }
.list-page-header-card :deep(.chart-card__head) { flex-wrap: wrap; gap: 4px 8px; }
.attention-intro { margin: 0 0 16px; color: var(--el-text-color-regular); font-size: 13px; line-height: 1.6; }
.attention-list { display: grid; gap: 8px; }
.attention-item { padding: 10px 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; }
.attention-item__head, .attention-item__meta { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px 12px; }
.attention-item__head { margin-bottom: 6px; }
.attention-item__head span, .attention-item__meta { color: var(--el-text-color-regular); font-size: 13px; }
.assignment-tip { margin: 0 0 12px; color: var(--el-text-color-regular); font-size: 13px; }
.field-error { color: var(--el-color-danger); font-size: 12px; margin: -4px 0 4px; }
</style>
