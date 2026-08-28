<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  employeeArchivesApi,
  type EmployeeDataReview,
  type EmployeeReviewStatus,
} from '@/api/employee-archives.api';
import {
  departmentsApi,
  type DepartmentChangeAction,
  type DepartmentChangeRequest,
} from '@/api/departments.api';
import UserSelect from '@/components/common/UserSelect.vue';

const props = defineProps<{
  canReviewEmployee: boolean;
  canReviewDepartment: boolean;
}>();

const activeCategory = ref<'employee' | 'department'>('employee');
const employeeItems = ref<EmployeeDataReview[]>([]);
const employeeTotal = ref(0);
const employeeLoading = ref(false);
const selectedEmployees = ref<EmployeeDataReview[]>([]);
const departmentItems = ref<DepartmentChangeRequest[]>([]);
const departmentTotal = ref(0);
const departmentLoading = ref(false);
const managerDialog = ref({
  visible: false,
  requestId: '',
  employeeName: '',
  managerId: null as string | null,
  saving: false,
});

const visible = computed(() => props.canReviewEmployee || props.canReviewDepartment);

type ContractDiff = {
  key: string;
  kind: '新增' | '修改' | '移除';
  title: string;
  before: string | null;
  after: string | null;
};

function reviewContracts(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : [];
}

function contractKey(contract: Record<string, unknown>, index: number): string {
  const id = typeof contract.id === 'string' ? contract.id : null;
  const type = String(contract.contractType ?? contract.kind ?? 'contract');
  const sequence = typeof contract.sequence === 'number' ? contract.sequence : index;
  return id ?? `${type}:${sequence}`;
}

function contractTitle(contract: Record<string, unknown>, index: number): string {
  return String(contract.name ?? contract.termType ?? contract.termText ?? `合同 ${index + 1}`);
}

function contractDetail(contract: Record<string, unknown>): string {
  const items = [
    ['签约公司', contract.signingCompany],
    ['签订日期', contract.signedAt],
    ['生效日期', contract.effectiveFrom],
    ['到期日期', contract.expiresAt],
    ['期限', contract.termType ?? contract.termText],
  ].filter((item) => item[1] !== undefined && item[1] !== null && item[1] !== '');
  return items.length
    ? items.map(([label, value]) => `${label}：${String(value).slice(0, 10)}`).join('；')
    : '未填写合同日期或期限';
}

function contractDiffs(row: EmployeeDataReview): ContractDiff[] {
  const before = reviewContracts(row.baseValue.contracts);
  const after = reviewContracts(row.proposedValue.contracts);
  const beforeMap = new Map(before.map((item, index) => [contractKey(item, index), { item, index }]));
  const afterMap = new Map(after.map((item, index) => [contractKey(item, index), { item, index }]));
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const result: ContractDiff[] = [];
  for (const key of keys) {
    const previous = beforeMap.get(key);
    const next = afterMap.get(key);
    if (!previous && next) {
      result.push({ key, kind: '新增', title: contractTitle(next.item, next.index), before: null, after: contractDetail(next.item) });
      continue;
    }
    if (previous && !next) {
      result.push({ key, kind: '移除', title: contractTitle(previous.item, previous.index), before: contractDetail(previous.item), after: null });
      continue;
    }
    if (previous && next && JSON.stringify(previous.item) !== JSON.stringify(next.item)) {
      result.push({
        key,
        kind: '修改',
        title: contractTitle(next.item, next.index),
        before: contractDetail(previous.item),
        after: contractDetail(next.item),
      });
    }
  }
  return result;
}

function reviewHasPerformanceBlocker(row: EmployeeDataReview): boolean {
  return row.performanceReviewStatus === 'pending'
    && row.validationErrors.some((error) => error.includes('绩效直属上级'));
}

function reviewIsPending(row: EmployeeDataReview): boolean {
  return row.profileReviewStatus === 'pending' || row.performanceReviewStatus === 'pending';
}

function reviewStatusLabel(row: EmployeeDataReview, scope: 'profile' | 'performance'): string {
  const status = scope === 'profile' ? row.profileReviewStatus : row.performanceReviewStatus;
  if (scope === 'performance' && reviewHasPerformanceBlocker(row)) return '需补充';
  return ({
    not_required: '无变更',
    pending: '待审核',
    approved: '已通过',
    rejected: '已退回',
  } as Record<EmployeeReviewStatus, string>)[status];
}

function reviewStatusType(
  row: EmployeeDataReview,
  scope: 'profile' | 'performance',
): 'success' | 'warning' | 'danger' | 'info' {
  const status = scope === 'profile' ? row.profileReviewStatus : row.performanceReviewStatus;
  if (scope === 'performance' && reviewHasPerformanceBlocker(row)) return 'danger';
  if (status === 'approved') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'rejected') return 'danger';
  return 'info';
}

function employeeChangeSummary(row: EmployeeDataReview): string {
  const beforeEmployee = (row.baseValue.employee ?? {}) as Record<string, unknown>;
  const afterEmployee = (row.proposedValue.employee ?? {}) as Record<string, unknown>;
  const beforeProfile = (row.baseValue.profile ?? {}) as Record<string, unknown>;
  const afterProfile = (row.proposedValue.profile ?? {}) as Record<string, unknown>;
  const beforePerformance = (row.baseValue.performance ?? {}) as Record<string, unknown>;
  const afterPerformance = (row.proposedValue.performance ?? {}) as Record<string, unknown>;
  const changes: string[] = [];
  const fields: Array<[Record<string, unknown>, Record<string, unknown>, string, string]> = [
    [beforeEmployee, afterEmployee, 'deptId', '部门'],
    [beforeEmployee, afterEmployee, 'position', '岗位'],
    [beforeEmployee, afterEmployee, 'employeeStatus', '在职状态'],
    [beforeEmployee, afterEmployee, 'phone', '手机号'],
    [beforeProfile, afterProfile, 'education', '学历'],
  ];
  for (const [before, after, field, label] of fields) {
    if ((before[field] ?? null) !== (after[field] ?? null)) changes.push(label);
  }
  if ((beforePerformance.managerId ?? null) !== (afterPerformance.managerId ?? null)) changes.push('绩效直属上级');
  const contractKinds = [...new Set(contractDiffs(row).map((item) => item.kind))];
  if (contractKinds.length) changes.push(`合同${contractKinds.join('/')}`);
  if (reviewHasPerformanceBlocker(row)) changes.push('绩效直属上级待补充');
  return changes.length ? changes.join('、') : '员工档案信息复核';
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function departmentActionLabel(action: DepartmentChangeAction): string {
  return ({
    create: '新建部门',
    update_structure: '调整部门',
    update_leader: '调整负责人',
    merge: '合并部门',
    delete: '删除部门',
  })[action];
}

function departmentChangeSummary(row: DepartmentChangeRequest): string {
  if (row.action === 'create') {
    return `新建 ${String(row.proposedValue.name ?? row.departmentName)}`;
  }
  if (row.action === 'update_structure') {
    const beforeName = String(row.baseValue.name ?? row.departmentName);
    const afterName = String(row.proposedValue.name ?? row.departmentName);
    const beforeParent = row.baseValue.parentId ?? null;
    const afterParent = row.proposedValue.parentId ?? null;
    if (beforeName !== afterName) return `${beforeName} → ${afterName}`;
    if (beforeParent !== afterParent) return `${beforeName} → ${String(row.proposedValue.parentName ?? '公司根节点')}`;
    return `${beforeName} 组织信息调整`;
  }
  if (row.action === 'merge') {
    return `${row.departmentName} → ${String(row.proposedValue.targetDepartmentName ?? '目标部门')}`;
  }
  if (row.action === 'update_leader') {
    return `${row.departmentName}负责人变更`;
  }
  return `停用 ${row.departmentName}`;
}

async function loadEmployeeReviews() {
  if (!props.canReviewEmployee) return;
  employeeLoading.value = true;
  try {
    const result = await employeeArchivesApi.listReviews({ status: 'pending', page: 1, pageSize: 50 });
    employeeItems.value = result.items;
    employeeTotal.value = result.total;
    selectedEmployees.value = [];
  } finally {
    employeeLoading.value = false;
  }
}

async function loadDepartmentReviews() {
  if (!props.canReviewDepartment) return;
  departmentLoading.value = true;
  try {
    const result = await departmentsApi.listChangeRequests({ status: 'pending', page: 1, pageSize: 50 });
    departmentItems.value = result.items;
    departmentTotal.value = result.total;
  } finally {
    departmentLoading.value = false;
  }
}

async function approveSelectedEmployees() {
  if (!selectedEmployees.value.length) return;
  employeeLoading.value = true;
  try {
    const result = await employeeArchivesApi.approveReviews(
      selectedEmployees.value.map((row) => row.id),
      ['profile', 'performance'],
    );
    if (result.failed.length > 0) {
      const failedIds = new Set(result.failed.map((item) => item.requestId));
      const partialCount = result.succeeded.filter((item) => failedIds.has(item.requestId)).length;
      const passedCount = result.succeeded.length - partialCount;
      const failedCount = result.failed.length - partialCount;
      ElMessage.warning(partialCount > 0
        ? `已通过 ${passedCount} 人；${partialCount} 人部分通过；${failedCount} 人未通过`
        : `已通过 ${passedCount} 人；${result.failed.length} 人需补充信息`);
    } else {
      ElMessage.success(`已通过 ${result.succeeded.length} 人`);
    }
    await loadEmployeeReviews();
  } finally {
    employeeLoading.value = false;
  }
}

function openManagerDialog(row: EmployeeDataReview) {
  managerDialog.value = {
    visible: true,
    requestId: row.id,
    employeeName: row.employeeName,
    managerId: null,
    saving: false,
  };
}

async function confirmManager() {
  const dialog = managerDialog.value;
  if (!dialog.managerId) {
    ElMessage.warning('请选择绩效直属上级');
    return;
  }
  dialog.saving = true;
  try {
    await employeeArchivesApi.setPendingPerformanceManager(dialog.requestId, dialog.managerId);
    ElMessage.success('绩效直属上级已补充，可继续审核');
    dialog.visible = false;
    await loadEmployeeReviews();
  } finally {
    dialog.saving = false;
  }
}

async function approveDepartment(row: DepartmentChangeRequest) {
  departmentLoading.value = true;
  try {
    await departmentsApi.approveChange(row.id);
    ElMessage.success('部门变更已通过并生效');
    await loadDepartmentReviews();
  } finally {
    departmentLoading.value = false;
  }
}

async function rejectDepartment(row: DepartmentChangeRequest) {
  try {
    const result = await ElMessageBox.prompt('请填写退回原因，提交人可据此重新调整。', '退回部门变更', {
      confirmButtonText: '确认退回', cancelButtonText: '取消', inputPattern: /\S{2,}/, inputErrorMessage: '请至少填写 2 个字',
    });
    departmentLoading.value = true;
    await departmentsApi.rejectChange(row.id, result.value);
    ElMessage.success('部门变更已退回');
    await loadDepartmentReviews();
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') throw error;
  } finally {
    departmentLoading.value = false;
  }
}

onMounted(async () => {
  if (!props.canReviewEmployee && props.canReviewDepartment) activeCategory.value = 'department';
  await Promise.all([loadEmployeeReviews(), loadDepartmentReviews()]);
});
</script>

<template>
  <section v-if="visible" class="pending-review-workspace">
    <div class="pending-review-workspace__head">
      <div><h3>审核事项</h3><p>普通 HR 提交后，HR 管理员在这里分类处理；审核通过前不改变正式数据。</p></div>
      <div class="pending-review-workspace__tabs" aria-label="审核事项分类">
        <button v-if="canReviewEmployee" type="button" :class="{ active: activeCategory === 'employee' }" @click="activeCategory = 'employee'">
          员工档案 {{ employeeTotal }}
        </button>
        <button v-if="canReviewDepartment" type="button" :class="{ active: activeCategory === 'department' }" @click="activeCategory = 'department'">
          部门架构 {{ departmentTotal }}
        </button>
      </div>
    </div>

    <div v-if="activeCategory === 'employee'" class="review-workspace">
      <div v-if="selectedEmployees.length" class="review-batchbar">
        <span>已选择 <strong>{{ selectedEmployees.length }}</strong> 人</span>
        <el-button type="primary" :loading="employeeLoading" @click="approveSelectedEmployees">通过可审核项（{{ selectedEmployees.length }}）</el-button>
      </div>
      <el-table
        v-loading="employeeLoading"
        :data="employeeItems"
        row-key="id"
        class="app-table compact-table"
        @selection-change="selectedEmployees = $event"
      >
        <el-table-column type="expand" width="48">
          <template #default="{ row }">
            <div class="contract-review-detail">
              <h4>合同变更明细</h4>
              <template v-if="contractDiffs(row as EmployeeDataReview).length">
                <article v-for="change in contractDiffs(row as EmployeeDataReview)" :key="change.key" class="contract-review-change">
                  <div><el-tag :type="change.kind === '移除' ? 'danger' : change.kind === '新增' ? 'success' : 'warning'" effect="plain">{{ change.kind }}</el-tag><strong>{{ change.title }}</strong></div>
                  <p v-if="change.before">变更前：{{ change.before }}</p>
                  <p v-if="change.after">变更后：{{ change.after }}</p>
                </article>
              </template>
              <p v-else>本次未涉及合同变更。</p>
            </div>
          </template>
        </el-table-column>
        <el-table-column type="selection" width="48" :selectable="reviewIsPending" />
        <el-table-column prop="employeeName" label="员工" min-width="130" />
        <el-table-column label="提交人" min-width="120"><template #default="{ row }">{{ (row as EmployeeDataReview).createdBy?.name || '系统导入' }}</template></el-table-column>
        <el-table-column label="基础档案审核" min-width="130"><template #default="{ row }"><el-tag :type="reviewStatusType(row as EmployeeDataReview, 'profile')" effect="plain">{{ reviewStatusLabel(row as EmployeeDataReview, 'profile') }}</el-tag></template></el-table-column>
        <el-table-column label="绩效关系审核" min-width="130"><template #default="{ row }"><el-tag :type="reviewStatusType(row as EmployeeDataReview, 'performance')" effect="plain">{{ reviewStatusLabel(row as EmployeeDataReview, 'performance') }}</el-tag></template></el-table-column>
        <el-table-column label="变更摘要" min-width="220"><template #default="{ row }">{{ employeeChangeSummary(row as EmployeeDataReview) }}</template></el-table-column>
        <el-table-column label="提交时间" width="160"><template #default="{ row }">{{ formatDateTime((row as EmployeeDataReview).createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="110"><template #default="{ row }"><el-button v-if="reviewHasPerformanceBlocker(row as EmployeeDataReview)" link type="primary" @click="openManagerDialog(row as EmployeeDataReview)">补充上级</el-button><span v-else>{{ reviewIsPending(row as EmployeeDataReview) ? '可审核' : '已处理' }}</span></template></el-table-column>
      </el-table>
      <el-empty v-if="!employeeLoading && !employeeItems.length" description="暂无员工档案待审核变更" />
    </div>

    <div v-else class="department-review-list" v-loading="departmentLoading">
      <article v-for="row in departmentItems" :key="row.id" class="department-review-card">
        <div class="department-review-card__main">
          <el-tag type="warning" effect="plain">{{ departmentActionLabel(row.action) }}</el-tag>
          <div><strong>{{ departmentChangeSummary(row) }}</strong><p>提交人：<span>{{ row.createdBy?.name || '未知' }}</span> · {{ formatDateTime(row.createdAt) }}</p></div>
        </div>
        <div class="department-review-card__actions"><el-button @click="rejectDepartment(row)">退回</el-button><el-button type="primary" @click="approveDepartment(row)">通过</el-button></div>
      </article>
      <el-empty v-if="!departmentLoading && !departmentItems.length" description="暂无部门架构待审核变更" />
    </div>

    <el-dialog v-model="managerDialog.visible" title="补充绩效直属上级" width="480px" :close-on-click-modal="false" destroy-on-close>
      <p>为 <strong>{{ managerDialog.employeeName }}</strong> 选择系统内绩效直属上级。</p>
      <UserSelect v-model="managerDialog.managerId" placeholder="搜索姓名或工号选择绩效直属上级" />
      <template #footer><el-button @click="managerDialog.visible = false">取消</el-button><el-button type="primary" :loading="managerDialog.saving" @click="confirmManager">保存并返回审核</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.pending-review-workspace { margin-top: 22px; padding: 20px; border: 1px solid #dfe5ee; border-radius: 16px; background: #fff; }
.pending-review-workspace__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
.pending-review-workspace__head h3 { margin: 0 0 4px; }
.pending-review-workspace__head p, .department-review-card p { margin: 0; color: #667085; font-size: 13px; }
.pending-review-workspace__tabs { display: flex; gap: 8px; padding: 4px; border-radius: 10px; background: #f2f4f7; }
.pending-review-workspace__tabs button { border: 0; padding: 8px 14px; border-radius: 8px; background: transparent; color: #475467; cursor: pointer; }
.pending-review-workspace__tabs button.active { background: #fff; color: #175cd3; box-shadow: 0 1px 3px rgb(16 24 40 / 12%); }
.review-batchbar { display: flex; align-items: center; justify-content: flex-end; gap: 14px; margin-bottom: 12px; }
.contract-review-detail { padding: 4px 52px 14px; }
.contract-review-detail h4 { margin: 0 0 10px; }
.contract-review-detail > p { margin: 0; color: #667085; }
.contract-review-change { padding: 10px 0; border-top: 1px solid #eef2f6; }
.contract-review-change > div { display: flex; align-items: center; gap: 8px; }
.contract-review-change p { margin: 6px 0 0; color: #475467; font-size: 13px; }
.department-review-list { display: grid; gap: 10px; min-height: 100px; }
.department-review-card { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 14px 16px; border: 1px solid #e5eaf2; border-radius: 12px; }
.department-review-card__main { display: flex; align-items: center; gap: 12px; min-width: 0; }
.department-review-card__main strong { display: block; margin-bottom: 4px; }
.department-review-card__actions { display: flex; flex: none; }
@media (max-width: 760px) {
  .pending-review-workspace { padding: 14px; }
  .pending-review-workspace__head, .department-review-card { align-items: stretch; flex-direction: column; }
  .pending-review-workspace__tabs { width: 100%; }
  .pending-review-workspace__tabs button { flex: 1; }
  .department-review-card__actions { justify-content: flex-end; }
}
</style>
