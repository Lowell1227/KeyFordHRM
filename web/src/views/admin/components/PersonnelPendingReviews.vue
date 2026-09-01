<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { QuestionFilled } from '@element-plus/icons-vue';
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
import { positionsApi, type PositionChangeRequest } from '@/api/positions.api';

const props = defineProps<{
  canReviewEmployee: boolean;
  canReviewDepartment: boolean;
  canReviewPosition?: boolean;
}>();

const emit = defineEmits<{
  changed: [];
}>();

function notifyPersonnelChanged() {
  emit('changed');
  window.dispatchEvent(new CustomEvent('personnel-data-changed'));
}

const activeCategory = ref<'all' | 'employee' | 'department' | 'position'>('all');
const employeeItems = ref<EmployeeDataReview[]>([]);
const employeeTotal = ref(0);
const employeeLoading = ref(false);
const selectedEmployees = ref<EmployeeDataReview[]>([]);
const departmentItems = ref<DepartmentChangeRequest[]>([]);
const departmentTotal = ref(0);
const departmentLoading = ref(false);
const positionItems = ref<PositionChangeRequest[]>([]);
const positionTotal = ref(0);
const positionLoading = ref(false);
const managerDialog = ref({
  visible: false,
  requestId: '',
  employeeName: '',
  managerId: null as string | null,
  saving: false,
});

const visible = computed(() => props.canReviewEmployee || props.canReviewDepartment || props.canReviewPosition);
const reviewTotal = computed(() => (
  (props.canReviewEmployee ? employeeTotal.value : 0)
  + (props.canReviewDepartment ? departmentTotal.value : 0)
  + (props.canReviewPosition ? positionTotal.value : 0)
));
const allLoading = computed(() => employeeLoading.value || departmentLoading.value || positionLoading.value);
const showEmployeeReviews = computed(() => props.canReviewEmployee && (
  activeCategory.value === 'employee'
  || (activeCategory.value === 'all' && employeeTotal.value > 0)
));
const showDepartmentReviews = computed(() => props.canReviewDepartment && (
  activeCategory.value === 'department'
  || (activeCategory.value === 'all' && departmentTotal.value > 0)
));
const showPositionReviews = computed(() => props.canReviewPosition && (
  activeCategory.value === 'position'
  || (activeCategory.value === 'all' && positionTotal.value > 0)
));

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
  const images = reviewContracts(contract.images);
  const attachments = reviewContracts(contract.attachments);
  const items = [
    ['签约公司', contract.signingCompany],
    ['签订日期', contract.signedAt],
    ['生效日期', contract.effectiveFrom],
    ['到期日期', contract.expiresAt],
    ['期限', contract.termType ?? contract.termText],
    ['图片', images.length ? images.map((item) => item.name).filter(Boolean).join('、') : null],
    ['附件', attachments.length ? attachments.map((item) => item.name).filter(Boolean).join('、') : null],
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

function employeeChangeType(row: EmployeeDataReview): string {
  const profilePending = row.profileReviewStatus === 'pending';
  const performancePending = row.performanceReviewStatus === 'pending';
  if (profilePending && performancePending) return '档案及关系';
  if (performancePending) return '绩效关系';
  return '档案变更';
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
    delete: '停用部门',
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
    const changes: string[] = [];
    if (beforeName !== afterName) changes.push(`名称：${beforeName} → ${afterName}`);
    if (beforeParent !== afterParent) changes.push(`上级：${String(row.proposedValue.parentName ?? '公司根节点')}`);
    if ((row.baseValue.leaderId ?? null) !== (row.proposedValue.leaderId ?? null)) changes.push('部门负责人');
    if ((row.baseValue.approverId ?? null) !== (row.proposedValue.approverId ?? null)) changes.push('最终业务审批人');
    return changes.length ? changes.join('；') : `${beforeName} 组织信息调整`;
  }
  if (row.action === 'merge') {
    return `${row.departmentName} → ${String(row.proposedValue.targetDepartmentName ?? '目标部门')}`;
  }
  if (row.action === 'update_leader') {
    return `${row.departmentName}负责人变更`;
  }
  const directMembers = Array.isArray(row.baseValue.directMemberIds) ? row.baseValue.directMemberIds.length : 0;
  const childDepartments = Array.isArray(row.baseValue.childDepartmentIds) ? row.baseValue.childDepartmentIds.length : 0;
  return directMembers || childDepartments
    ? `停用 ${row.departmentName}；需先处理 ${directMembers} 人和 ${childDepartments} 个下级部门`
    : `停用 ${row.departmentName}`;
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

async function loadPositionReviews() {
  if (!props.canReviewPosition) return;
  positionLoading.value = true;
  try {
    const result = await positionsApi.listChangeRequests({ status: 'pending', page: 1, pageSize: 50 });
    positionItems.value = result.items;
    positionTotal.value = result.total;
  } finally {
    positionLoading.value = false;
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

async function rejectSelectedEmployees() {
  if (!selectedEmployees.value.length) return;
  try {
    const result = await ElMessageBox.prompt('请填写退回原因。', '退回员工变更', {
      confirmButtonText: '确认退回', cancelButtonText: '取消', inputPattern: /\S{2,}/, inputErrorMessage: '请至少填写 2 个字',
    });
    employeeLoading.value = true;
    await employeeArchivesApi.rejectReviews(selectedEmployees.value.map((row) => row.id), result.value);
    ElMessage.success(`已退回 ${selectedEmployees.value.length} 项`);
    await loadEmployeeReviews();
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') throw error;
  } finally { employeeLoading.value = false; }
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
    notifyPersonnelChanged();
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
    notifyPersonnelChanged();
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
    notifyPersonnelChanged();
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') throw error;
  } finally {
    departmentLoading.value = false;
  }
}

async function approvePosition(row: PositionChangeRequest) {
  positionLoading.value = true;
  try {
    await positionsApi.approve(row.id);
    ElMessage.success('岗位变更已通过并生效');
    await loadPositionReviews();
    notifyPersonnelChanged();
  } finally { positionLoading.value = false; }
}

async function rejectPosition(row: PositionChangeRequest) {
  try {
    const result = await ElMessageBox.prompt('请填写退回原因。', '退回岗位变更', {
      confirmButtonText: '确认退回', cancelButtonText: '取消', inputPattern: /\S{2,}/, inputErrorMessage: '请至少填写 2 个字',
    });
    await positionsApi.reject(row.id, result.value);
    ElMessage.success('岗位变更已退回');
    await loadPositionReviews();
    notifyPersonnelChanged();
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') throw error;
  }
}

function positionActionLabel(action: PositionChangeRequest['action']) {
  return ({ create: '新增岗位', update: '编辑岗位', deactivate: '停用岗位' })[action];
}

onMounted(async () => {
  await Promise.all([loadEmployeeReviews(), loadDepartmentReviews(), loadPositionReviews()]);
});
</script>

<template>
  <section v-if="visible" class="pending-review-workspace">
    <div class="pending-review-workspace__head">
      <div class="review-title"><h3>待审核变更</h3><el-tooltip placement="bottom"><template #content>普通 HR 提交后由 HR 管理员审核。<br>HR 管理员可审核本人提交的变更。<br>审核通过前不改变正式数据。</template><el-icon><QuestionFilled /></el-icon></el-tooltip></div>
      <div class="pending-review-workspace__tabs" aria-label="审核事项分类">
        <button type="button" :class="{ active: activeCategory === 'all' }" @click="activeCategory = 'all'">
          全部 {{ reviewTotal }}
        </button>
        <button v-if="canReviewEmployee" type="button" :class="{ active: activeCategory === 'employee' }" @click="activeCategory = 'employee'">
          员工档案 {{ employeeTotal }}
        </button>
        <button v-if="canReviewDepartment" type="button" :class="{ active: activeCategory === 'department' }" @click="activeCategory = 'department'">
          组织架构 {{ departmentTotal }}
        </button>
        <button v-if="canReviewPosition" type="button" :class="{ active: activeCategory === 'position' }" @click="activeCategory = 'position'">岗位目录 {{ positionTotal }}</button>
      </div>
    </div>

    <div v-if="showEmployeeReviews" class="review-workspace review-category-section">
      <h4 v-if="activeCategory === 'all'" class="review-category-heading">员工档案 <span>{{ employeeTotal }}</span></h4>
      <div v-if="selectedEmployees.length" class="review-batchbar">
        <span>已选择 <strong>{{ selectedEmployees.length }}</strong> 人</span>
        <el-button :loading="employeeLoading" @click="rejectSelectedEmployees">退回</el-button>
        <el-button type="primary" :loading="employeeLoading" @click="approveSelectedEmployees">通过可审核项（{{ selectedEmployees.length }}）</el-button>
      </div>
      <el-table
        v-loading="employeeLoading"
        :data="employeeItems"
        row-key="id"
        class="app-table compact-table review-table"
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
        <el-table-column label="变更类型" width="120"><template #default="{ row }"><el-tag type="warning" effect="plain">{{ employeeChangeType(row as EmployeeDataReview) }}</el-tag></template></el-table-column>
        <el-table-column prop="employeeName" label="审核对象" min-width="150" />
        <el-table-column label="变更内容" min-width="300">
          <template #default="{ row }">
            <div class="employee-change-content">
              <div>{{ employeeChangeSummary(row as EmployeeDataReview) }}</div>
              <div class="employee-change-content__statuses">
                <span v-if="(row as EmployeeDataReview).profileReviewStatus !== 'not_required'">
                  基础档案
                  <el-tag size="small" :type="reviewStatusType(row as EmployeeDataReview, 'profile')" effect="plain">{{ reviewStatusLabel(row as EmployeeDataReview, 'profile') }}</el-tag>
                </span>
                <span v-if="(row as EmployeeDataReview).performanceReviewStatus !== 'not_required'">
                  绩效关系
                  <el-tag size="small" :type="reviewStatusType(row as EmployeeDataReview, 'performance')" effect="plain">{{ reviewStatusLabel(row as EmployeeDataReview, 'performance') }}</el-tag>
                </span>
              </div>
              <div v-if="(row as EmployeeDataReview).validationWarnings?.length" class="review-warning">{{ (row as EmployeeDataReview).validationWarnings?.join('；') }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="提交人" min-width="120"><template #default="{ row }">{{ (row as EmployeeDataReview).createdBy?.name || '系统导入' }}</template></el-table-column>
        <el-table-column label="提交时间" width="160"><template #default="{ row }">{{ formatDateTime((row as EmployeeDataReview).createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="110"><template #default="{ row }"><el-button v-if="reviewHasPerformanceBlocker(row as EmployeeDataReview)" link type="primary" @click="openManagerDialog(row as EmployeeDataReview)">补充上级</el-button><span v-else>{{ reviewIsPending(row as EmployeeDataReview) ? '可审核' : '已处理' }}</span></template></el-table-column>
      </el-table>
      <el-empty v-if="activeCategory === 'employee' && !employeeLoading && !employeeItems.length" description="暂无员工档案待审核变更" />
    </div>

    <div v-if="showDepartmentReviews" class="review-category-section">
      <h4 v-if="activeCategory === 'all'" class="review-category-heading">组织架构 <span>{{ departmentTotal }}</span></h4>
      <el-table v-loading="departmentLoading" :data="departmentItems" row-key="id" class="app-table compact-table review-table">
        <el-table-column label="变更类型" width="120"><template #default="{ row }"><el-tag type="warning" effect="plain">{{ departmentActionLabel((row as DepartmentChangeRequest).action) }}</el-tag></template></el-table-column>
        <el-table-column prop="departmentName" label="审核对象" min-width="170" />
        <el-table-column label="变更内容" min-width="300"><template #default="{ row }">{{ departmentChangeSummary(row as DepartmentChangeRequest) }}</template></el-table-column>
        <el-table-column label="提交人" min-width="120"><template #default="{ row }">{{ (row as DepartmentChangeRequest).createdBy?.name || '未知' }}</template></el-table-column>
        <el-table-column label="提交时间" width="160"><template #default="{ row }">{{ formatDateTime((row as DepartmentChangeRequest).createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="150" fixed="right"><template #default="{ row }"><el-button @click="rejectDepartment(row as DepartmentChangeRequest)">退回</el-button><el-button type="primary" @click="approveDepartment(row as DepartmentChangeRequest)">通过</el-button></template></el-table-column>
      </el-table>
      <el-empty v-if="activeCategory === 'department' && !departmentLoading && !departmentItems.length" description="暂无部门架构待审核变更" />
    </div>

    <div v-if="showPositionReviews" class="review-category-section">
      <h4 v-if="activeCategory === 'all'" class="review-category-heading">岗位目录 <span>{{ positionTotal }}</span></h4>
      <el-table v-loading="positionLoading" :data="positionItems" row-key="id" class="app-table compact-table review-table">
        <el-table-column label="变更类型" width="120"><template #default="{ row }"><el-tag type="warning" effect="plain">{{ positionActionLabel((row as PositionChangeRequest).action) }}</el-tag></template></el-table-column>
        <el-table-column prop="positionName" label="审核对象" min-width="170" />
        <el-table-column label="变更内容" min-width="300"><template #default="{ row }"><div>岗位编码：{{ (row as PositionChangeRequest).proposedValue.code || '-' }}；岗位族：{{ (row as PositionChangeRequest).proposedValue.jobFamily || '未分类' }}</div><div v-if="(row as PositionChangeRequest).warnings?.length" class="review-warning">{{ (row as PositionChangeRequest).warnings.join('；') }}</div></template></el-table-column>
        <el-table-column label="提交人" min-width="120"><template #default="{ row }">{{ (row as PositionChangeRequest).createdBy?.name || '未知' }}</template></el-table-column>
        <el-table-column label="提交时间" width="160"><template #default="{ row }">{{ formatDateTime((row as PositionChangeRequest).createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="150" fixed="right"><template #default="{ row }"><el-button @click="rejectPosition(row as PositionChangeRequest)">退回</el-button><el-button type="primary" @click="approvePosition(row as PositionChangeRequest)">通过</el-button></template></el-table-column>
      </el-table>
      <el-empty v-if="activeCategory === 'position' && !positionLoading && !positionItems.length" description="暂无岗位待审核变更" />
    </div>

    <el-empty v-if="activeCategory === 'all' && !allLoading && reviewTotal === 0" description="暂无待审核变更" />

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
.review-title { display: flex; align-items: center; gap: 8px; }.review-title .el-icon { color: #98a2b3; cursor: help; }
.pending-review-workspace__tabs { display: flex; gap: 8px; padding: 4px; border-radius: 10px; background: #f2f4f7; }
.pending-review-workspace__tabs button { border: 0; padding: 8px 14px; border-radius: 8px; background: transparent; color: #475467; cursor: pointer; }
.pending-review-workspace__tabs button.active { background: #fff; color: #175cd3; box-shadow: 0 1px 3px rgb(16 24 40 / 12%); }
.review-batchbar { display: flex; align-items: center; justify-content: flex-end; gap: 14px; margin-bottom: 12px; }
.review-category-section + .review-category-section { margin-top: 22px; padding-top: 22px; border-top: 1px solid #eef2f6; }
.review-category-heading { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; color: #344054; }
.review-category-heading span { min-width: 24px; padding: 1px 8px; border-radius: 999px; background: #eef4ff; color: #3563e9; font-size: 12px; text-align: center; }
.contract-review-detail { padding: 4px 52px 14px; }
.contract-review-detail h4 { margin: 0 0 10px; }
.contract-review-detail > p { margin: 0; color: #667085; }
.contract-review-change { padding: 10px 0; border-top: 1px solid #eef2f6; }
.contract-review-change > div { display: flex; align-items: center; gap: 8px; }
.contract-review-change p { margin: 6px 0 0; color: #475467; font-size: 13px; }
.employee-change-content { display: grid; gap: 6px; }
.employee-change-content__statuses { display: flex; flex-wrap: wrap; gap: 6px 12px; color: #667085; font-size: 12px; }
.employee-change-content__statuses span { display: inline-flex; align-items: center; gap: 5px; }
.review-warning { color: #b54708 !important; }
@media (max-width: 760px) {
  .pending-review-workspace { padding: 14px; }
  .pending-review-workspace__head { align-items: stretch; flex-direction: column; }
  .pending-review-workspace__tabs { width: 100%; }
  .pending-review-workspace__tabs button { flex: 1; }
  .review-table { min-width: 860px; }
}
</style>
