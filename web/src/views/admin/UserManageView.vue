<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox, type UploadFile } from 'element-plus';
import {
  ArrowRight,
  Key,
  QuestionFilled,
  Search,
  Setting,
  UploadFilled,
  Warning,
} from '@element-plus/icons-vue';
import { departmentsApi } from '@/api/departments.api';
import {
  employeeArchivesApi,
  type EmployeeArchive,
  type EmployeeRosterImportRow,
  type EmployeeRosterImportMode,
  type EmployeeRosterPreviewResult,
} from '@/api/employee-archives.api';
import { usersApi } from '@/api/users.api';
import { uploadApi } from '@/api/upload.api';
import ChartCard from '@/components/common/ChartCard.vue';
import CollapsibleFilterPanel from '@/components/common/CollapsibleFilterPanel.vue';
import UserSelect from '@/components/common/UserSelect.vue';
import EmployeeArchiveInlineEditor from './components/EmployeeArchiveInlineEditor.vue';
import DepartmentEditDrawer from './components/DepartmentEditDrawer.vue';
import DepartmentCreateDrawer from './components/DepartmentCreateDrawer.vue';
import EmployeeCreateDrawer from './components/EmployeeCreateDrawer.vue';
import EmploymentRecordDrawer from './components/EmploymentRecordDrawer.vue';
import { formatBusinessIdentityLabel } from '@/components/layout/business-identity';
import { useAuthStore } from '@/stores/auth.store';
import type { Attachment, BusinessIdentity, Department, HrCapability, SystemPermission, UpdateDepartmentStructureBody, User as ManagedUser, UserQuery } from '@/types/api.types';
import type { SysRole, UserStatus } from '@/types/enums';
import { formatDate, formatDateTime } from '@/utils/date';
import { isTopLevelDepartmentLeader } from '@/utils/organization-relations';
import { formatPersonnelIdentityLabel } from '@/utils/personnel-identity';

const props = withDefaults(defineProps<{ mode?: 'org' | 'users' }>(), { mode: 'users' });
const auth = useAuthStore();

const dingtalkStateLabels = {
  unbound: '未关联',
  enabled: '已关联·启用',
  disabled: '已关联·停用',
} as const;

const dingtalkStateTagType = {
  unbound: 'info',
  enabled: 'success',
  disabled: 'warning',
} as const;

const companyLabels: Record<string, string> = {
  fuede: '孚德',
  beijing_fuede: '北京孚德',
  fuede_sports: '孚德体育文化',
  fansibao: '凡思堡',
};

const employmentChangeLabels: Record<string, string> = {
  hire: '入职',
  transfer: '调动',
  promotion: '晋升',
  manager_change: '上级变更',
  status_change: '状态变更',
  resignation: '离职',
  rehire: '返聘',
  data_correction: '资料修订',
  migration: '历史迁移',
};

const contractTypeLabels: Record<string, string> = {
  contract: '劳动合同',
  renewal: '续签',
  transfer: '转签',
};

const employmentTypeLabels: Record<string, string> = {
  full_time: '全职',
  part_time: '兼职',
  rehire: '返聘',
  external: '外部',
};

const activeView = ref<'org' | 'users'>(props.mode);
watch(() => props.mode, (mode) => { activeView.value = mode; });
const isSystemAdmin = computed(() => auth.user?.sysRole === 'system_admin');
const canResetPassword = computed(() => ['hr', 'system_admin'].includes(auth.user?.sysRole ?? ''));
const hasHrCapability = (capability: HrCapability) => (
  ['hr', 'system_admin'].includes(auth.user?.sysRole ?? '')
  || Boolean(auth.user?.hrCapabilities?.includes(capability))
);
const canEditArchive = computed(() => hasHrCapability('employee_archive_edit'));
const canReviewArchive = computed(() => hasHrCapability('employee_archive_review'));
const canEditOrganization = computed(() => hasHrCapability('organization_edit'));
const canReviewDepartmentChanges = computed(() => ['hr', 'system_admin'].includes(auth.user?.sysRole ?? ''));

const roleLabels: Record<SysRole, string> = {
  system_admin: '系统管理员',
  hr: 'HR 管理员',
  hr_user: '普通 HR',
  chairman: '标准用户',
  vp: '标准用户',
  dept_head: '标准用户',
  manager: '标准用户',
  employee: '标准用户',
};

const systemPermissionLabels: Record<SystemPermission, string> = {
  system_admin: '系统管理员',
  hr_admin: 'HR 管理员',
  hr_user: '普通 HR',
  standard_user: '标准用户',
};

const statusLabels: Record<UserStatus, string> = {
  active: '在职',
  probation: '试用期',
  resigned: '已离职',
};

const statusTagType: Record<UserStatus, 'success' | 'warning' | 'info'> = {
  active: 'success',
  probation: 'warning',
  resigned: 'info',
};

const sysRoleOptions: { label: string; value: SysRole }[] = [
  { label: '系统管理员', value: 'system_admin' },
  { label: 'HR 管理员', value: 'hr' },
  { label: '普通 HR', value: 'hr_user' },
  { label: '标准用户', value: 'employee' },
];

function normalizeSystemRole(user: Pick<ManagedUser, 'sysRole' | 'systemPermission'>): SysRole {
  if (user.systemPermission === 'system_admin' || user.sysRole === 'system_admin') return 'system_admin';
  if (user.systemPermission === 'hr_admin' || user.sysRole === 'hr') return 'hr';
  if (user.systemPermission === 'hr_user' || user.sysRole === 'hr_user') return 'hr_user';
  return 'employee';
}

function systemPermissionLabel(user: Pick<ManagedUser, 'sysRole' | 'systemPermission'>): string {
  return user.systemPermission
    ? systemPermissionLabels[user.systemPermission]
    : roleLabels[user.sysRole];
}

function businessIdentityText(identity: BusinessIdentity): string {
  return formatBusinessIdentityLabel(identity);
}

const hrCapabilityOptions: { label: string; value: HrCapability }[] = [
  { label: '员工档案编辑', value: 'employee_archive_edit' },
  { label: '员工档案审核', value: 'employee_archive_review' },
  { label: '组织架构编辑', value: 'organization_edit' },
  { label: '考核周期创建与编辑', value: 'cycle_plan_edit' },
  { label: '考核周期审核', value: 'cycle_plan_review' },
];

const statusOptions: { label: string; value: UserStatus }[] = [
  { label: '在职', value: 'active' },
  { label: '试用期', value: 'probation' },
  { label: '已离职', value: 'resigned' },
];

const departments = ref<Department[]>([]);
const deptLoading = ref(false);
const selectedDeptId = ref('');
const UNASSIGNED_DEPARTMENT_ID = '__unassigned__';

const flattenedDepartments = computed<Department[]>(() => {
  const result: Department[] = [];
  const walk = (items: Department[]) => {
    items.forEach((item) => {
      result.push(item);
      if (item.children?.length) walk(item.children);
    });
  };
  walk(departments.value);
  return result;
});

const selectedDept = computed<Department | null>(() => {
  if (selectedDeptId.value === UNASSIGNED_DEPARTMENT_ID) {
    return {
      id: UNASSIGNED_DEPARTMENT_ID,
      name: '未分配人员',
      fullPath: '组织根节点 / 未分配人员',
      parentId: null,
      company: 'fuede',
      sortOrder: -1,
      isActive: true,
      directMemberCount: orgMemberTotal.value,
      memberCount: orgMemberTotal.value,
      children: [],
    };
  }
  return flattenedDepartments.value.find((dept) => dept.id === selectedDeptId.value) ?? null;
});

const childDeptCount = computed(() => selectedDept.value?.children?.length ?? 0);
const selectedDeptIssueBadges = computed(() => getDeptIssueBadges(selectedDept.value));

const orgMembers = ref<ManagedUser[]>([]);
const orgMemberTotal = ref(0);
const unassignedMemberTotal = ref(0);
const orgMemberLoading = ref(false);
const orgMemberPage = ref(1);
const selectedOrgMembers = ref<ManagedUser[]>([]);
const assignmentDialog = ref({ visible: false, targetDepartmentId: '' as string, saving: false });
const draggedUserIds = ref<string[]>([]);
const selectedOrgIsUnassigned = computed(() => selectedDeptId.value === UNASSIGNED_DEPARTMENT_ID);

const userList = ref<ManagedUser[]>([]);
const userTotal = ref(0);
const userLoading = ref(false);
const userQuery = ref<UserQuery>({
  page: 1,
  pageSize: 20,
  keyword: '',
  deptId: undefined,
  sysRole: undefined,
  status: undefined,
});
const checkUsers = ref<ManagedUser[]>([]);
const checkLoading = ref(false);
const issueLevelFilter = ref<'all' | 'danger' | 'warning' | 'info'>('all');

type IssueItem = {
  key: string;
  type: '部门' | '人员';
  title: string;
  detail: string;
  level: 'warning' | 'danger' | 'info';
  deptId?: string;
  userId?: string;
  keyword?: string;
  targetView: 'org' | 'users';
  action?: 'open-leader' | 'open-approver';
};

type DeptIssueBadge = {
  label: string;
  level: 'danger' | 'warning' | 'info';
};

const departmentIssueItems = computed<IssueItem[]>(() =>
  flattenedDepartments.value.flatMap((dept) => {
    const items: IssueItem[] = [];
    const directMemberCount = dept.directMemberCount ?? 0;
    const hasActiveWorkload = directMemberCount > 0;

    if (!dept.leaderId) {
      items.push({
        key: `${dept.id}-leader`,
        type: '部门',
        title: `${dept.name} 未设置部门负责人`,
        detail: '部门负责人负责本部门管理和绩效复核。',
        level: 'warning',
        deptId: dept.id,
        targetView: 'org',
        action: 'open-leader',
      });
    }
    if (hasActiveWorkload && !dept.effectiveApproverId) {
      items.push({
        key: `${dept.id}-approver`,
        type: '部门',
        title: `${dept.name} 未设置最终业务审批人`,
        detail: '当前部门有在职员工，但没有可自动匹配的业务上级。请补齐部门负责人及其绩效直属上级；最高层级可手动设置。',
        level: 'danger',
        deptId: dept.id,
        targetView: 'org',
        action: 'open-approver',
      });
    }
    if ((dept.memberCount ?? 0) === 0 && !dept.children?.length) {
      items.push({
        key: `${dept.id}-empty`,
        type: '部门',
        title: `${dept.name} 暂无在职人员`,
        detail: '如果是临时部门可以保留，否则请核对 HRM 组织和员工任职归属。',
        level: 'info',
        deptId: dept.id,
        targetView: 'org',
      });
    }
    return items;
  }),
);

const userIssueItems = computed<IssueItem[]>(() =>
  checkUsers.value.flatMap((user) => {
    const items: IssueItem[] = [];
    const isTopLeader = isTopLevelDepartmentLeader(user, flattenedDepartments.value);
    if (user.status !== 'resigned' && !user.directManagerId && !isTopLeader) {
      items.push({
        key: `${user.id}-manager`,
        type: '人员',
        title: `${user.name} 未设置绩效直属上级`,
        detail: `${user.deptName || '未分配部门'} · ${user.position || '岗位待补充'}`,
        level: 'warning',
        userId: user.id,
        keyword: user.name,
        targetView: 'users',
      });
    }
    if (!user.deptId && user.status !== 'resigned') {
      items.push({
        key: `${user.id}-dept`,
        type: '人员',
        title: `${user.name} 未分配部门`,
        detail: '绩效模板匹配和部门统计都依赖部门归属。',
        level: 'danger',
        userId: user.id,
        keyword: user.name,
        targetView: 'users',
      });
    }
    if (user.status === 'resigned' && ['hr', 'system_admin'].includes(user.sysRole)) {
      items.push({
        key: `${user.id}-role`,
        type: '人员',
        title: `${user.name} 已离职但仍保留 ${systemPermissionLabel(user)}权限`,
        detail: '建议确认是否需要清理系统权限。',
        level: 'warning',
        userId: user.id,
        keyword: user.name,
        targetView: 'users',
      });
    }
    return items;
  }),
);

const issueItems = computed(() => [...departmentIssueItems.value, ...userIssueItems.value]);
const dangerIssueCount = computed(() => issueItems.value.filter((item) => item.level === 'danger').length);
const warningIssueCount = computed(() => issueItems.value.filter((item) => item.level === 'warning').length);
const infoIssueCount = computed(() => issueItems.value.filter((item) => item.level === 'info').length);
const filteredDepartmentIssueItems = computed(() => filterIssueItems(departmentIssueItems.value));
const filteredUserIssueItems = computed(() => filterIssueItems(userIssueItems.value));

async function loadDepartments() {
  deptLoading.value = true;
  try {
    departments.value = await departmentsApi.findAll({ isActive: true });
    if (!selectedDeptId.value && flattenedDepartments.value.length > 0) {
      selectedDeptId.value = flattenedDepartments.value[0].id;
    }
  } catch {
    departments.value = [];
  } finally {
    deptLoading.value = false;
  }
}

async function loadUnassignedMemberTotal() {
  try {
    const res = await usersApi.findAll({ page: 1, pageSize: 1, unassigned: true });
    unassignedMemberTotal.value = res.total;
  } catch {
    unassignedMemberTotal.value = 0;
  }
}

async function loadOrgMembers() {
  if (!selectedDeptId.value) {
    orgMembers.value = [];
    orgMemberTotal.value = 0;
    return;
  }
  orgMemberLoading.value = true;
  try {
    const res = await usersApi.findAll({
      page: orgMemberPage.value,
      pageSize: 8,
      deptId: selectedOrgIsUnassigned.value ? undefined : selectedDeptId.value,
      unassigned: selectedOrgIsUnassigned.value || undefined,
    });
    orgMembers.value = res.items;
    orgMemberTotal.value = res.total;
    if (selectedOrgIsUnassigned.value) unassignedMemberTotal.value = res.total;
  } catch {
    orgMembers.value = [];
    orgMemberTotal.value = 0;
  } finally {
    orgMemberLoading.value = false;
  }
}

async function loadUsers() {
  userLoading.value = true;
  try {
    const res = await usersApi.findAll({
      ...userQuery.value,
      keyword: userQuery.value.keyword || undefined,
    });
    userList.value = res.items;
    userTotal.value = res.total;
  } catch {
    userList.value = [];
    userTotal.value = 0;
  } finally {
    userLoading.value = false;
  }
}

function onDeptSelect(deptId: string) {
  selectedDeptId.value = deptId;
  orgMemberPage.value = 1;
  loadOrgMembers();
}

function onUserQueryChange() {
  userQuery.value.page = 1;
  loadUsers();
}

function resetUserFilters() {
  userQuery.value = {
    page: 1,
    pageSize: userQuery.value.pageSize,
    keyword: '',
    deptId: undefined,
    sysRole: undefined,
    status: undefined,
  };
  loadUsers();
}

function getFinalApproverRule(dept: Department | null): string {
  if (!dept) return '';
  if (!dept.effectiveApproverId) {
    return '没有可自动匹配的业务上级，请手动设置';
  }

  if (dept.effectiveApproverSource === 'manual_override') {
    return '已手动设置；HR 只负责校准';
  }

  if (dept.effectiveApproverSource === 'leader_manager') {
    return '自动取部门负责人的绩效直属上级；HR 只负责校准';
  }

  if (dept.effectiveApproverSource === 'parent_leader') {
    return '自动取上一级部门负责人；HR 只负责校准';
  }

  if (dept.effectiveApproverSource === 'ancestor_chain') {
    return `自动取${dept.effectiveApproverDeptName || '上级部门'}负责人；HR 只负责校准`;
  }

  return '由业务负责人审批；HR 只负责校准';
}

function getDeptIssueBadges(dept: Department | null): DeptIssueBadge[] {
  if (!dept) return [];

  const badges: DeptIssueBadge[] = [];
  const directMemberCount = dept.directMemberCount ?? 0;

  if (directMemberCount > 0 && !dept.effectiveApproverId) {
    badges.push({ label: '缺最终审批人', level: 'danger' });
  }
  if (!dept.leaderId) {
    badges.push({ label: '缺负责人', level: 'warning' });
  }
  if ((dept.memberCount ?? 0) === 0 && !dept.children?.length) {
    badges.push({ label: '空部门', level: 'info' });
  }
  return badges;
}

function getTreeDeptBadge(dept: Department): DeptIssueBadge | null {
  const [badge] = getDeptIssueBadges(dept);
  return badge ?? null;
}

function filterIssueItems(items: IssueItem[]): IssueItem[] {
  if (issueLevelFilter.value === 'all') return items;
  return items.filter((item) => item.level === issueLevelFilter.value);
}

async function jumpToIssue(item: IssueItem) {
  if (item.targetView === 'org' && item.deptId) {
    activeView.value = 'org';
    selectedDeptId.value = item.deptId;
    orgMemberPage.value = 1;
    await loadOrgMembers();
    const dept = flattenedDepartments.value.find((row) => row.id === item.deptId) ?? null;
    if (dept && item.action === 'open-leader' && isSystemAdmin.value) {
      openLeaderDialog(dept);
    }
    if (dept && item.action === 'open-approver' && isSystemAdmin.value) {
      openApproverDialog(dept);
    }
    return;
  }

  activeView.value = 'users';
  userQuery.value.page = 1;
  userQuery.value.keyword = item.keyword ?? '';
  await loadUsers();
}

function refreshCurrentView() {
  if (activeView.value === 'org') {
    Promise.all([loadDepartments(), loadUnassignedMemberTotal()]).then(() => loadOrgMembers());
    return;
  }
  if (activeView.value === 'users') {
    loadUsers();
    return;
  }
  loadUsers();
}

const employeeArchiveDrawer = ref({
  visible: false,
  loading: false,
  dingtalkSaving: false,
  data: null as EmployeeArchive | null,
});
const archiveCurrentEmployment = computed(() => (
  employeeArchiveDrawer.value.data?.currentEmployment
  ?? employeeArchiveDrawer.value.data?.employmentHistory[0]
  ?? null
));
const archiveEditing = ref(false);
const archiveEditSaving = ref(false);
const archiveEditorRef = ref<InstanceType<typeof EmployeeArchiveInlineEditor> | null>(null);

function archiveDisplayValue(value: unknown, emptyText = '未填写') {
  return value === null || value === undefined || value === '' ? emptyText : String(value);
}

async function openEmployeeArchive(row: ManagedUser) {
  employeeArchiveDrawer.value.visible = true;
  archiveEditing.value = false;
  employeeArchiveDrawer.value.loading = true;
  employeeArchiveDrawer.value.data = null;
  try {
    employeeArchiveDrawer.value.data = await employeeArchivesApi.getArchive(row.id);
  } catch {
    employeeArchiveDrawer.value.visible = false;
  } finally {
    employeeArchiveDrawer.value.loading = false;
  }
}

async function submitArchiveDraft(value: {
  employee: Record<string, unknown>;
  profile: Record<string, unknown>;
  contracts: Record<string, unknown>[];
  performance: Record<string, unknown>;
}) {
  const data = employeeArchiveDrawer.value.data;
  if (!data) return;
  archiveEditSaving.value = true;
  try {
    await employeeArchivesApi.submitDraft(data.id, value);
    ElMessage.success('档案变更已提交审核，审核通过后生效');
    archiveEditing.value = false;
    employeeArchiveDrawer.value.data = await employeeArchivesApi.getArchive(data.id);
    employeeArchiveDrawer.value.visible = false;
    activeView.value = 'users';
  } catch {
    // 由 HTTP 拦截器展示错误
  } finally {
    archiveEditSaving.value = false;
  }
}

async function cancelArchiveEditing() {
  if (!archiveEditorRef.value?.isDirty()) {
    archiveEditing.value = false;
    return;
  }
  try {
    await ElMessageBox.confirm('当前档案修改尚未保存，确认放弃？', '放弃修改', {
      confirmButtonText: '放弃修改', cancelButtonText: '继续编辑', type: 'warning',
    });
    archiveEditing.value = false;
  } catch {
    // 继续编辑
  }
}

async function beforeCloseEmployeeArchive(done: () => void) {
  if (!archiveEditing.value || !archiveEditorRef.value?.isDirty()) {
    done();
    return;
  }
  try {
    await ElMessageBox.confirm('当前档案修改尚未保存，确认关闭？', '关闭员工档案', {
      confirmButtonText: '放弃并关闭', cancelButtonText: '继续编辑', type: 'warning',
    });
    archiveEditing.value = false;
    done();
  } catch {
    // 继续编辑
  }
}

function selectUnassignedPeople() {
  selectedDeptId.value = UNASSIGNED_DEPARTMENT_ID;
  orgMemberPage.value = 1;
  selectedOrgMembers.value = [];
  void loadOrgMembers();
}

function openBatchAssignment() {
  if (!selectedOrgMembers.value.length) return;
  assignmentDialog.value = { visible: true, targetDepartmentId: '', saving: false };
}

function startPersonDrag(row: ManagedUser, event: DragEvent) {
  const selectedIds = selectedOrgMembers.value.some((item) => item.id === row.id)
    ? selectedOrgMembers.value.map((item) => item.id)
    : [row.id];
  draggedUserIds.value = selectedIds;
  event.dataTransfer?.setData('application/x-kayford-personnel', selectedIds.join(','));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

async function assignUsersToDepartment(userIds: string[], department: Department) {
  if (!userIds.length || department.id === UNASSIGNED_DEPARTMENT_ID) return;
  try {
    await ElMessageBox.confirm(
      `确认将 ${userIds.length} 名员工归属到“${department.name}”？提交后由 HR 管理员审核，审核通过前人员仍保留在原位置。`,
      '调整人员归属',
      { confirmButtonText: '提交审核', cancelButtonText: '取消', type: 'warning' },
    );
    const result = await employeeArchivesApi.submitDepartmentAssignments(userIds, department.id);
    if (result.submitted > 0) {
      ElMessage.success(`已提交 ${result.submitted} 条人员归属变更审核`);
    } else {
      ElMessage.info('所选人员已归属该部门，无需重复提交');
    }
    selectedOrgMembers.value = [];
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') throw error;
  } finally {
    draggedUserIds.value = [];
  }
}

function dropPeopleOnDepartment(event: DragEvent, department: Department) {
  const raw = event.dataTransfer?.getData('application/x-kayford-personnel') ?? '';
  const userIds = raw.split(',').filter(Boolean);
  if (userIds.length) void assignUsersToDepartment(userIds, department);
}

async function confirmBatchAssignment() {
  const department = flattenedDepartments.value.find((item) => item.id === assignmentDialog.value.targetDepartmentId);
  if (!department) {
    ElMessage.warning('请选择目标部门');
    return;
  }
  assignmentDialog.value.visible = false;
  await assignUsersToDepartment(selectedOrgMembers.value.map((item) => item.id), department);
}

const departmentEditDrawer = ref({ visible: false, department: null as Department | null, saving: false });
const departmentCreateDrawer = ref({ visible: false, parent: null as Department | null });
const employeeCreateDrawerVisible = ref(false);
const employmentRecordDrawerVisible = ref(false);
const departmentMergeDialog = ref({ visible: false, source: null as Department | null, targetId: '', saving: false });
const departmentContextMenu = ref({ visible: false, x: 0, y: 0, department: null as Department | null });
const orgDragEnabled = ref(false);
let orgLongPressTimer: ReturnType<typeof setTimeout> | null = null;

function openDepartmentEdit(row: Department) {
  departmentContextMenu.value.visible = false;
  departmentEditDrawer.value = { visible: true, department: row, saving: false };
}

function openDepartmentCreate(parent: Department | null) {
  departmentCreateDrawer.value = { visible: true, parent };
}

function openDepartmentMerge(source: Department) {
  departmentContextMenu.value.visible = false;
  departmentMergeDialog.value = { visible: true, source, targetId: '', saving: false };
}

async function confirmDepartmentMerge() {
  const dialog = departmentMergeDialog.value;
  if (!dialog.source || !dialog.targetId) { ElMessage.warning('请选择合并后的目标部门'); return; }
  dialog.saving = true;
  try {
    await departmentsApi.merge(dialog.source.id, dialog.targetId);
    ElMessage.success('部门合并已提交 HR 管理员审核');
    dialog.visible = false;
    await loadDepartments();
  } finally { dialog.saving = false; }
}

async function saveDepartment(value: UpdateDepartmentStructureBody) {
  const department = departmentEditDrawer.value.department;
  if (!department) return;
  departmentEditDrawer.value.saving = true;
  try {
    await departmentsApi.updateStructure(department.id, value);
    ElMessage.success('部门变更已提交 HR 管理员审核');
    departmentEditDrawer.value.visible = false;
    await loadDepartments();
    activeView.value = 'org';
  } finally {
    departmentEditDrawer.value.saving = false;
  }
}

function onDepartmentContextMenu(rawEvent: Event, row: Department) {
  if (!canEditOrganization.value) return;
  const event = rawEvent as MouseEvent;
  event.preventDefault();
  selectedDeptId.value = row.id;
  departmentContextMenu.value = {
    visible: true,
    x: Math.min(event.clientX, window.innerWidth - 170),
    y: Math.min(event.clientY, window.innerHeight - 110),
    department: row,
  };
}

async function removeDepartment(row: Department) {
  departmentContextMenu.value.visible = false;
  const memberCount = row.directMemberCount ?? 0;
  const childCount = row.children?.length ?? 0;
  try {
    await ElMessageBox.confirm(
      memberCount || childCount
        ? `“${row.name}”仍有 ${memberCount} 名直属人员、${childCount} 个下级部门。可以提交停用，但审核通过前需先处理这些归属。`
        : `停用“${row.name}”？停用后不再用于新的人员归属，历史记录继续保留。`,
      '停用部门',
      { confirmButtonText: '提交停用审核', cancelButtonText: '取消', type: 'warning' },
    );
    await departmentsApi.remove(row.id);
    ElMessage.success('停用部门申请已提交 HR 管理员审核');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') throw error;
  }
}

function closeDepartmentContextMenu() {
  departmentContextMenu.value.visible = false;
}

function startOrgLongPress() {
  if (!canEditOrganization.value) return;
  if (orgLongPressTimer) clearTimeout(orgLongPressTimer);
  orgLongPressTimer = setTimeout(() => { orgDragEnabled.value = true; }, 450);
}

function endOrgLongPress() {
  if (orgLongPressTimer) clearTimeout(orgLongPressTimer);
  orgLongPressTimer = null;
  setTimeout(() => { orgDragEnabled.value = false; }, 250);
}

function allowDepartmentDrop(draggingNode: any, dropNode: any, type: string) {
  if (!canEditOrganization.value) return false;
  if (draggingNode.data.company !== dropNode.data.company) return false;
  return type !== 'inner' || draggingNode.data.id !== dropNode.data.id;
}

async function onDepartmentDrop(draggingNode: any, dropNode: any, type: 'before' | 'after' | 'inner') {
  const department = draggingNode.data as Department;
  const target = dropNode.data as Department;
  const parentId = type === 'inner' ? target.id : (target.parentId ?? null);
  try {
    await ElMessageBox.confirm(
      `确认将“${department.name}”挂靠到${parentId ? `“${flattenedDepartments.value.find((item) => item.id === parentId)?.name ?? target.name}”` : '组织根节点'}？`,
      '调整组织层级',
      { confirmButtonText: '确认调整', cancelButtonText: '取消', type: 'warning' },
    );
    await departmentsApi.updateStructure(department.id, { parentId });
    ElMessage.success('组织层级变更已提交 HR 管理员审核');
    activeView.value = 'org';
  } catch {
    // 取消时重新加载正式结构；接口错误由拦截器展示。
  } finally {
    orgDragEnabled.value = false;
    await loadDepartments();
  }
}

async function downloadRosterTemplate() {
  try {
    const blob = await employeeArchivesApi.downloadRosterTemplate();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '员工花名册导入模板.xlsx';
    anchor.click();
    URL.revokeObjectURL(url);
  } catch {
    ElMessage.error('模板下载失败，请稍后重试');
  }
}

async function openContractMaterial(item: Attachment) {
  const blob = await uploadApi.download(item.url);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  if (item.mimeType?.startsWith('image/') || item.mimeType === 'application/pdf') {
    anchor.target = '_blank';
    anchor.rel = 'noopener';
  } else {
    anchor.download = item.name;
  }
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function setArchiveDingtalkState(enabled: boolean) {
  const archive = employeeArchiveDrawer.value.data;
  if (!archive?.dingtalkBinding) return;

  let reason: string | undefined;
  if (!enabled) {
    try {
      const result = await ElMessageBox.prompt(
        '停用后，该员工不能再使用钉钉登录，但 HRM 员工档案、组织任职和历史数据不会改变。',
        '停用钉钉登录',
        {
          confirmButtonText: '确认停用',
          cancelButtonText: '取消',
          inputPlaceholder: '填写停用原因',
          inputValidator: (value) => Boolean(value.trim()) || '请填写停用原因',
          type: 'warning',
        },
      );
      reason = result.value.trim();
    } catch {
      return;
    }
  }

  employeeArchiveDrawer.value.dingtalkSaving = true;
  try {
    await employeeArchivesApi.setDingtalkState(archive.id, enabled, reason);
    employeeArchiveDrawer.value.data = await employeeArchivesApi.getArchive(archive.id);
    await loadUsers();
    ElMessage.success(enabled ? '钉钉登录已启用' : '钉钉登录已停用');
  } catch {
    // 由 HTTP 拦截器展示错误
  } finally {
    employeeArchiveDrawer.value.dingtalkSaving = false;
  }
}

const personSettingsDialog = ref({
  visible: false,
  userId: '',
  userName: '',
  deptName: '',
  position: '',
  status: 'active' as UserStatus,
  originalDirectManagerId: undefined as string | undefined,
  directManagerId: undefined as string | undefined,
  originalSysRole: 'employee' as SysRole,
  sysRole: 'employee' as SysRole,
  originalHrCapabilities: [] as HrCapability[],
  hrCapabilities: [] as HrCapability[],
  businessIdentities: [] as BusinessIdentity[],
  canViewAll: false,
  isTopLevelLeader: false,
  selectedManager: null as ManagedUser | null,
  saving: false,
});
let managerLookupRequestId = 0;

function openPersonSettingsDialog(row: ManagedUser) {
  personSettingsDialog.value = {
    visible: true,
    userId: row.id,
    userName: row.name,
    deptName: row.deptName || '未分配部门',
    position: row.position || '未设置岗位',
    status: row.status,
    originalDirectManagerId: row.directManagerId ?? undefined,
    directManagerId: row.directManagerId ?? undefined,
    originalSysRole: normalizeSystemRole(row),
    sysRole: normalizeSystemRole(row),
    originalHrCapabilities: [...(row.hrCapabilities ?? [])],
    hrCapabilities: [...(row.hrCapabilities ?? [])],
    businessIdentities: row.businessIdentities ?? [],
    canViewAll: row.canViewAll,
    isTopLevelLeader: isTopLevelDepartmentLeader(row, flattenedDepartments.value),
    selectedManager: null,
    saving: false,
  };
}

async function loadSelectedManager(managerId: string | undefined) {
  const requestId = ++managerLookupRequestId;
  personSettingsDialog.value.selectedManager = null;
  if (!managerId || !personSettingsDialog.value.visible) return;
  try {
    const manager = await usersApi.findOne(managerId);
    if (requestId === managerLookupRequestId) {
      personSettingsDialog.value.selectedManager = manager;
    }
  } catch {
    // 由 HTTP 拦截器展示错误
  }
}

watch(
  () => [personSettingsDialog.value.visible, personSettingsDialog.value.directManagerId] as const,
  ([visible, managerId]) => {
    if (visible) void loadSelectedManager(managerId);
  },
);

const selectedManagerRelationChanged = computed(() =>
  personSettingsDialog.value.selectedManager?.id !== personSettingsDialog.value.originalDirectManagerId,
);

async function confirmPersonSettings() {
  if (!personSettingsDialog.value.userId) return;
  if (!personSettingsDialog.value.directManagerId && !personSettingsDialog.value.isTopLevelLeader) {
    ElMessage.warning('请选择绩效直属上级');
    return;
  }
  personSettingsDialog.value.saving = true;
  try {
    const performanceRelationChanged =
      personSettingsDialog.value.directManagerId !== personSettingsDialog.value.originalDirectManagerId;
    const systemRoleChanged =
      isSystemAdmin.value && personSettingsDialog.value.sysRole !== personSettingsDialog.value.originalSysRole;
    const nextHrCapabilities = personSettingsDialog.value.sysRole === 'hr_user'
      ? [...personSettingsDialog.value.hrCapabilities].sort()
      : [];
    const hrCapabilitiesChanged = isSystemAdmin.value
      && JSON.stringify(nextHrCapabilities) !== JSON.stringify([...personSettingsDialog.value.originalHrCapabilities].sort());
    const actions: Promise<unknown>[] = [];
    if (performanceRelationChanged) {
      actions.push(employeeArchivesApi.proposePerformanceManager(
        personSettingsDialog.value.userId,
        personSettingsDialog.value.directManagerId ?? null,
      ));
    }
    if (systemRoleChanged || hrCapabilitiesChanged) {
      actions.push(usersApi.updateSettings(personSettingsDialog.value.userId, {
        sysRole: personSettingsDialog.value.sysRole,
        hrCapabilities: nextHrCapabilities,
      }));
    }
    if (actions.length === 0) {
      ElMessage.info('没有需要提交的变更');
      return;
    }
    await Promise.all(actions);
    if (performanceRelationChanged && (systemRoleChanged || hrCapabilitiesChanged)) {
      ElMessage.success('系统权限已更新；绩效直属上级变更已提交 HR 审核');
    } else if (performanceRelationChanged) {
      ElMessage.success('绩效直属上级变更已提交 HR 审核');
    } else {
      ElMessage.success('系统权限已更新');
    }
    personSettingsDialog.value.visible = false;
    if (performanceRelationChanged) {
      activeView.value = 'users';
    }
    await Promise.all([loadUsers(), loadOrgMembers()]);
  } catch {
    // 由 HTTP 拦截器展示错误
  } finally {
    personSettingsDialog.value.saving = false;
  }
}

async function resetPassword(row: ManagedUser) {
  try {
    await ElMessageBox.confirm(
      `确认将 ${row.name} 的密码重置为 0000？重置后，下次使用密码登录时必须修改密码。`,
      '重置登录密码',
      { confirmButtonText: '确认重置', cancelButtonText: '取消', type: 'warning' },
    );
    await usersApi.setPassword(row.id, {});
    ElMessage.success('密码已重置为 0000');
  } catch {
    // 用户取消或由 HTTP 拦截器展示错误
  }
}

const leaderDialog = ref({
  visible: false,
  deptId: '',
  deptName: '',
  leaderId: undefined as string | undefined,
});

function openLeaderDialog(row: Department) {
  leaderDialog.value = {
    visible: true,
    deptId: row.id,
    deptName: row.name,
    leaderId: row.leaderId ?? undefined,
  };
}

async function confirmLeader() {
  if (!leaderDialog.value.deptId) return;
  try {
    await departmentsApi.updateLeader(leaderDialog.value.deptId, {
      leaderId: leaderDialog.value.leaderId ?? null,
    });
    ElMessage.success('部门负责人已更新');
    leaderDialog.value.visible = false;
    await Promise.all([loadDepartments(), loadOrgMembers()]);
  } catch {
    // 由 HTTP 拦截器展示错误
  }
}

const approverDialog = ref({
  visible: false,
  deptId: '',
  deptName: '',
  approverId: undefined as string | undefined,
});

function openApproverDialog(row: Department) {
  approverDialog.value = {
    visible: true,
    deptId: row.id,
    deptName: row.name,
    approverId: row.approverId ?? undefined,
  };
}

async function confirmApprover() {
  if (!approverDialog.value.deptId) return;
  try {
    await departmentsApi.updateApprover(approverDialog.value.deptId, {
      approverId: approverDialog.value.approverId ?? null,
    });
    ElMessage.success('最终业务审批人已更新');
    approverDialog.value.visible = false;
    await loadDepartments();
  } catch {
    // 由 HTTP 拦截器展示错误
  }
}

const rosterImportDialog = ref({
  visible: false,
  mode: 'full' as EmployeeRosterImportMode,
  file: null as File | null,
  loading: false,
  confirming: false,
  result: null as EmployeeRosterPreviewResult | null,
  rows: [] as EmployeeRosterImportRow[],
});

const rosterIssueRows = computed(() => rosterImportDialog.value.rows
  .filter((row) => row.errors.length > 0 || row.warnings.length > 0)
  .sort((left, right) => (
    Number(right.errors.length > 0) - Number(left.errors.length > 0)
    || left.rowNumber - right.rowNumber
  )));

function openRosterImportDialog() {
  rosterImportDialog.value = {
    visible: true,
    mode: 'full',
    file: null,
    loading: false,
    confirming: false,
    result: null,
    rows: [],
  };
}

function onRosterFileChange(uploadFile: UploadFile) {
  rosterImportDialog.value.file = uploadFile.raw ?? null;
  rosterImportDialog.value.result = null;
  rosterImportDialog.value.rows = [];
}

function onRosterFileRemove() {
  rosterImportDialog.value.file = null;
  rosterImportDialog.value.result = null;
  rosterImportDialog.value.rows = [];
}

async function previewRosterImport() {
  const file = rosterImportDialog.value.file;
  if (!file) {
    ElMessage.warning('请先选择花名册文件');
    return;
  }
  rosterImportDialog.value.loading = true;
  try {
    const result = await employeeArchivesApi.previewRoster(file, rosterImportDialog.value.mode);
    rosterImportDialog.value.result = result;
    const batch = await employeeArchivesApi.getRosterBatch(result.batchId);
    rosterImportDialog.value.rows = batch.rows;
    ElMessage.success('预检完成，尚未写入员工正式档案');
  } catch {
    rosterImportDialog.value.result = null;
    rosterImportDialog.value.rows = [];
  } finally {
    rosterImportDialog.value.loading = false;
  }
}

async function confirmRosterImport() {
  const { file, result } = rosterImportDialog.value;
  if (!file || !result?.canConfirm) return;
  try {
    const validChangeCount = result.summary.createCount
      + result.summary.updateCount
      + (result.summary.blockingErrorCount > 0 ? 0 : result.summary.missingFromFullRosterCount);
    const skippedText = result.summary.blockingErrorCount > 0
      ? `；另有 ${result.summary.blockingErrorCount} 行存在问题，本次跳过，不会据此停用缺行员工`
      : '';
    await ElMessageBox.confirm(
      `将暂存 ${result.summary.desiredDepartmentCount} 个组织节点方案，并提交 ${validChangeCount} 条员工变更供 HR 审核${skippedText}。审核通过前，现有正式档案和组织继续生效。`,
      '确认提交员工变更',
      { confirmButtonText: '提交审核', cancelButtonText: '返回检查', type: 'warning' },
    );
  } catch {
    return;
  }

  rosterImportDialog.value.confirming = true;
  try {
    const confirmed = await employeeArchivesApi.confirmRoster(result.batchId, file);
    ElMessage.success(confirmed.submitted > 0
      ? `已提交 ${confirmed.submitted} 条员工变更，审核通过后生效`
      : '花名册与正式档案一致，无需重复审核');
    rosterImportDialog.value.visible = false;
    activeView.value = 'users';
    await Promise.all([loadDepartments(), loadUsers()]);
  } catch {
    // 由 HTTP 拦截器展示错误
  } finally {
    rosterImportDialog.value.confirming = false;
  }
}

watch(activeView, (view) => {
  if (view === 'users') {
    if (userList.value.length === 0) loadUsers();
  }
});

function refreshAfterPersonnelReview() {
  void Promise.all([loadDepartments(), loadUsers(), loadOrgMembers(), loadUnassignedMemberTotal()]);
}

onMounted(async () => {
  document.addEventListener('click', closeDepartmentContextMenu);
  window.addEventListener('personnel-data-changed', refreshAfterPersonnelReview);
  await Promise.all([loadDepartments(), loadUsers(), loadUnassignedMemberTotal()]);
  await loadOrgMembers();
});

onBeforeUnmount(() => {
  document.removeEventListener('click', closeDepartmentContextMenu);
  window.removeEventListener('personnel-data-changed', refreshAfterPersonnelReview);
});
</script>

<template>
  <div class="user-manage-view page-stack">
    <ChartCard>
      <template #title>
        <div class="page-title">
          <div>
            <h2>{{ activeView === 'org' ? '组织架构' : '员工档案' }}</h2>
          </div>
          <div class="page-title__actions">
            <template v-if="activeView === 'org'">
              <el-button v-if="canEditOrganization" @click="openDepartmentCreate(null)">新增一级部门</el-button>
              <el-button v-if="canEditOrganization && selectedDept && !selectedOrgIsUnassigned" type="primary" @click="openDepartmentCreate(selectedDept)">新增下级部门</el-button>
            </template>
            <template v-else>
              <el-button v-if="canEditArchive" type="primary" @click="employeeCreateDrawerVisible = true">新增员工</el-button>
              <el-dropdown v-if="canEditArchive" trigger="click" @command="(command: string) => command === 'roster' && openRosterImportDialog()">
                <el-button>批量操作</el-button>
                <template #dropdown><el-dropdown-menu><el-dropdown-item command="roster" :icon="UploadFilled">导入花名册</el-dropdown-item></el-dropdown-menu></template>
              </el-dropdown>
            </template>
            <el-button :icon="Search" @click="refreshCurrentView">刷新</el-button>
          </div>
        </div>
      </template>

      <section v-if="activeView === 'org'" class="org-layout">
        <aside class="org-tree-panel">
          <div class="panel-head">
            <strong>部门架构</strong>
            <span>{{ flattenedDepartments.length }} 个部门</span>
          </div>
          <el-tree
            v-loading="deptLoading"
            :data="departments"
            node-key="id"
            :props="{ label: 'name', children: 'children' }"
            default-expand-all
            highlight-current
            :current-node-key="selectedDeptId"
            :draggable="orgDragEnabled"
            :allow-drop="allowDepartmentDrop"
            @node-click="(data: Department) => onDeptSelect(data.id)"
            @node-contextmenu="onDepartmentContextMenu"
            @node-drop="onDepartmentDrop"
            @node-drag-end="endOrgLongPress"
          >
            <template #default="{ data }">
              <div
                class="dept-node"
                @pointerdown="startOrgLongPress"
                @pointerup="endOrgLongPress"
                @dragover.stop.prevent
                @drop.stop.prevent="dropPeopleOnDepartment($event, data as Department)"
              >
                <div class="dept-node__content">
                  <span class="dept-node__name">{{ data.name }}</span>
                  <div v-if="getTreeDeptBadge(data)" class="dept-node__badges">
                    <span :class="['dept-node__badge', `is-${getTreeDeptBadge(data)?.level}`]">
                      {{ getTreeDeptBadge(data)?.label }}
                    </span>
                  </div>
                </div>
                <div class="dept-node__meta">
                  <em>{{ data.memberCount ?? 0 }}</em>
                  <span v-if="getDeptIssueBadges(data).length" class="dept-node__issue-count">
                    {{ getDeptIssueBadges(data).length }}
                  </span>
                </div>
              </div>
            </template>
          </el-tree>
          <button
            v-if="unassignedMemberTotal > 0"
            type="button"
            :class="['unassigned-node', { active: selectedOrgIsUnassigned }]"
            @click="selectUnassignedPeople"
          >
            <span>未分配人员</span>
            <small>{{ unassignedMemberTotal }} 人</small>
          </button>
        </aside>

        <main class="org-detail" v-if="selectedDept">
          <div class="dept-summary">
            <div>
              <span class="eyebrow">当前部门</span>
              <h3>{{ selectedDept.name }}</h3>
              <div v-if="selectedDeptIssueBadges.length" class="dept-summary__chips">
                <span
                  v-for="badge in selectedDeptIssueBadges"
                  :key="badge.label"
                  :class="['dept-summary__chip', `is-${badge.level}`]"
                >
                  {{ badge.label }}
                </span>
              </div>
            </div>
            <div class="dept-summary__side">
              <span class="dept-path">{{ selectedDept.fullPath || '未维护完整路径' }}</span>
              <div v-if="(isSystemAdmin || canEditOrganization) && !selectedOrgIsUnassigned" class="dept-summary__actions">
                <el-button v-if="canEditOrganization" type="primary" size="small" @click="openDepartmentEdit(selectedDept)">编辑</el-button>
                <el-button v-if="canEditOrganization" plain type="danger" size="small" @click="removeDepartment(selectedDept)">停用</el-button>
              </div>
            </div>
          </div>

          <div class="relation-grid">
            <div class="relation-card">
              <span class="relation-card__label">部门人数</span>
              <strong>{{ orgMemberTotal }} 人</strong>
            </div>
            <div class="relation-card">
              <span class="relation-card__label">下级部门</span>
              <strong>{{ childDeptCount }} 个</strong>
            </div>
            <div class="relation-card">
              <span class="relation-card__label">部门负责人</span>
              <strong>{{ selectedDept.leaderName || '未设置' }}</strong>
              <small>{{ selectedDept.leaderName ? '负责本部门管理和绩效复核' : '未设置将影响部门复核' }}</small>
            </div>
            <div class="relation-card">
              <span class="relation-card__label">最终业务审批人</span>
              <strong>{{ selectedDept.effectiveApproverName || '未设置' }}</strong>
              <small>{{ getFinalApproverRule(selectedDept) }}</small>
            </div>
          </div>

          <div class="section-head">
            <div><h3>{{ selectedOrgIsUnassigned ? '未分配人员' : '部门人员' }}</h3><span>{{ selectedOrgIsUnassigned ? '尚未归属有效部门的人员' : '含当前部门及下级部门' }}</span></div>
            <el-button v-if="selectedOrgIsUnassigned && selectedOrgMembers.length" type="primary" @click="openBatchAssignment">批量归属部门（{{ selectedOrgMembers.length }}）</el-button>
          </div>
          <el-table v-loading="orgMemberLoading" :data="orgMembers" row-key="id" class="app-table compact-table" @selection-change="selectedOrgMembers = $event">
            <el-table-column v-if="selectedOrgIsUnassigned" type="selection" width="48" />
            <el-table-column label="人员" min-width="180">
              <template #default="{ row }">
                <div class="person-cell" :draggable="selectedOrgIsUnassigned" @dragstart="startPersonDrag(row as ManagedUser, $event)">
                  <span class="avatar">{{ (row as ManagedUser).name.slice(0, 1) }}</span>
                  <div>
                    <strong>{{ (row as ManagedUser).name }}</strong>
                    <small>{{ (row as ManagedUser).employeeNo || '工号待补充' }}</small>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="岗位" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">{{ (row as ManagedUser).position || '未设置' }}</template>
            </el-table-column>
            <el-table-column label="系统权限" width="150">
              <template #default="{ row }">
                <div>{{ systemPermissionLabel(row as ManagedUser) }}</div>
                <el-tag v-if="(row as ManagedUser).canViewAll" size="small" type="info" effect="plain">全量只读</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="业务职责" min-width="220">
              <template #default="{ row }">
                <div class="business-identity-tags">
                  <el-tag size="small" effect="plain">员工</el-tag>
                  <el-tag
                    v-for="identity in (row as ManagedUser).businessIdentities"
                    :key="identity.type"
                    size="small"
                    effect="plain"
                  >
                    {{ businessIdentityText(identity) }}
                  </el-tag>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="绩效直属上级" min-width="140">
              <template #default="{ row }">{{ (row as ManagedUser).directManagerName || '未设置' }}</template>
            </el-table-column>
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <el-tag :type="statusTagType[(row as ManagedUser).status]" size="small">
                  {{ statusLabels[(row as ManagedUser).status] }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="220" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openEmployeeArchive(row as ManagedUser)">查看档案</el-button>
                <el-button link type="primary" size="small" :icon="Setting" @click="openPersonSettingsDialog(row as ManagedUser)">人员设置</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-pagination
            v-model:current-page="orgMemberPage"
            :page-size="8"
            :total="orgMemberTotal"
            layout="total, prev, pager, next"
            class="table-pagination"
            @current-change="loadOrgMembers"
          />
        </main>
      </section>

      <section v-else-if="activeView === 'users'" class="directory-view">
        <CollapsibleFilterPanel class="roster-filter-panel">
          <div class="light-filter">
            <el-input
              v-model="userQuery.keyword"
              :prefix-icon="Search"
              placeholder="搜索姓名或工号"
              clearable
              class="filter-keyword"
              @keyup.enter="onUserQueryChange"
            />
            <el-tree-select
              v-model="userQuery.deptId"
              :data="departments"
              node-key="id"
              :props="{ label: 'name', children: 'children' }"
              placeholder="全部部门"
              clearable
              filterable
            />
            <el-select v-model="userQuery.status" placeholder="全部状态" clearable>
              <el-option v-for="opt in statusOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
            <el-select v-model="userQuery.sysRole" placeholder="全部系统权限" clearable>
              <el-option v-for="opt in sysRoleOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
            <el-button type="primary" @click="onUserQueryChange">查询</el-button>
            <el-button @click="resetUserFilters">重置</el-button>
          </div>
        </CollapsibleFilterPanel>

          <div class="directory-table-region">
          <el-table v-loading="userLoading" :data="userList" row-key="id" height="100%" class="app-table compact-table">
            <el-table-column label="人员" min-width="180">
            <template #default="{ row }">
              <div class="person-cell">
                <span class="avatar">{{ (row as ManagedUser).name.slice(0, 1) }}</span>
                <div>
                  <strong>{{ (row as ManagedUser).name }}</strong>
                  <small>{{ (row as ManagedUser).employeeNo || '工号待补充' }}</small>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="deptName" label="部门" min-width="160" show-overflow-tooltip />
          <el-table-column label="岗位" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ (row as ManagedUser).position || '未设置' }}</template>
          </el-table-column>
          <el-table-column label="绩效直属上级" min-width="140">
            <template #default="{ row }">{{ (row as ManagedUser).directManagerName || '未设置' }}</template>
          </el-table-column>
          <el-table-column label="系统权限" width="150">
            <template #default="{ row }">
              <div>{{ systemPermissionLabel(row as ManagedUser) }}</div>
              <el-tag v-if="(row as ManagedUser).canViewAll" size="small" type="info" effect="plain">全量只读</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="业务职责" min-width="220">
            <template #default="{ row }">
              <div class="business-identity-tags">
                <el-tag size="small" effect="plain">员工</el-tag>
                <el-tag
                  v-for="identity in (row as ManagedUser).businessIdentities"
                  :key="identity.type"
                  size="small"
                  effect="plain"
                >
                  {{ businessIdentityText(identity) }}
                </el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="钉钉登录" width="130">
            <template #default="{ row }">
              <el-tag
                :type="dingtalkStateTagType[(row as ManagedUser).dingtalkBindingState ?? 'unbound']"
                size="small"
                effect="plain"
              >
                {{ dingtalkStateLabels[(row as ManagedUser).dingtalkBindingState ?? 'unbound'] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="statusTagType[(row as ManagedUser).status]" size="small">
                {{ statusLabels[(row as ManagedUser).status] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="290" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openEmployeeArchive(row as ManagedUser)">
                查看档案
              </el-button>
              <el-button link type="primary" size="small" :icon="Setting" @click="openPersonSettingsDialog(row as ManagedUser)">
                人员设置
              </el-button>
              <el-button v-if="canResetPassword" link type="primary" size="small" :icon="Key" @click="resetPassword(row as ManagedUser)">
                重置密码
              </el-button>
            </template>
            </el-table-column>
          </el-table>
          </div>
          <el-pagination
            v-model:current-page="userQuery.page"
            v-model:page-size="userQuery.pageSize"
            :total="userTotal"
            :page-sizes="[10, 20, 50, 100]"
            layout="total, sizes, prev, pager, next"
            class="table-pagination"
            @current-change="loadUsers"
            @size-change="onUserQueryChange"
          />
      </section>

    </ChartCard>

    <el-drawer
      v-model="employeeArchiveDrawer.visible"
      title="员工档案"
      size="min(1080px, 100vw)"
      class="employee-archive-drawer"
      destroy-on-close
      :before-close="beforeCloseEmployeeArchive"
    >
      <div v-loading="employeeArchiveDrawer.loading" class="employee-archive">
        <template v-if="employeeArchiveDrawer.data">
          <div class="employee-archive__hero">
            <span class="avatar">{{ employeeArchiveDrawer.data.name.slice(0, 1) }}</span>
            <div>
              <div class="employee-archive__name">
                <h3>{{ employeeArchiveDrawer.data.name }}</h3>
                <el-tag :type="statusTagType[employeeArchiveDrawer.data.status]" size="small">
                  {{ statusLabels[employeeArchiveDrawer.data.status] }}
                </el-tag>
              </div>
              <p>
                {{ employeeArchiveDrawer.data.employeeNo || '工号待补充' }}
                · {{ employeeArchiveDrawer.data.dept?.name || '未分配部门' }}
                · {{ employeeArchiveDrawer.data.position || '未设置岗位' }}
              </p>
            </div>
            <div v-if="canEditArchive" class="employee-archive__global-actions">
              <el-button v-if="!archiveEditing" type="primary" @click="archiveEditing = true">编辑档案</el-button>
              <template v-else>
                <el-button :disabled="archiveEditSaving" @click="cancelArchiveEditing">取消</el-button>
                <el-button type="primary" :loading="archiveEditSaving" @click="archiveEditorRef?.submit()">保存并提交审核</el-button>
              </template>
            </div>
          </div>

          <EmployeeArchiveInlineEditor
            ref="archiveEditorRef"
            :editing="archiveEditing"
            :archive="employeeArchiveDrawer.data"
            :departments="departments"
            @submit="submitArchiveDraft"
          />

          <section v-if="!archiveEditing" class="employee-archive__section employee-archive__section--card">
            <div class="section-head">
              <div>
                <h3>基本与任职</h3>
                <span>员工身份、当前组织和绩效关系</span>
              </div>
            </div>
            <div class="employee-archive__facts">
              <div><span>姓名</span><strong>{{ employeeArchiveDrawer.data.name }}</strong></div>
              <div><span>工号</span><strong>{{ employeeArchiveDrawer.data.employeeNo || '未填写' }}</strong></div>
              <div><span>所属公司</span><strong>{{ companyLabels[archiveCurrentEmployment?.company || employeeArchiveDrawer.data.dept?.company || ''] || '待确认' }}</strong></div>
              <div><span>所属部门</span><strong>{{ employeeArchiveDrawer.data.dept?.fullPath || employeeArchiveDrawer.data.dept?.name || '未设置' }}</strong></div>
              <div><span>岗位</span><strong>{{ employeeArchiveDrawer.data.position || '未设置' }}</strong></div>
              <div><span>职级</span><strong>{{ archiveDisplayValue(archiveCurrentEmployment?.jobGrade) }}</strong></div>
              <div><span>职系</span><strong>{{ archiveDisplayValue(archiveCurrentEmployment?.jobFamily) }}</strong></div>
              <div><span>花名册直属主管</span><strong>{{ employeeArchiveDrawer.data.rosterManager?.name || '未设置' }}</strong></div>
              <div><span>绩效直属上级</span><strong>{{ employeeArchiveDrawer.data.performanceManager?.name || '未设置' }}</strong></div>
              <div><span>工作地点</span><strong>{{ archiveDisplayValue(archiveCurrentEmployment?.workLocation) }}</strong></div>
              <div><span>用工类型</span><strong>{{ employmentTypeLabels[archiveCurrentEmployment?.employmentType || ''] || '未填写' }}</strong></div>
              <div><span>当前状态</span><strong>{{ statusLabels[employeeArchiveDrawer.data.status] }}</strong></div>
              <div><span>入职日期</span><strong>{{ formatDate(employeeArchiveDrawer.data.entryDate) }}</strong></div>
              <div><span>试用期（月）</span><strong>{{ archiveDisplayValue(archiveCurrentEmployment?.probationMonths) }}</strong></div>
              <div><span>预计转正日期</span><strong>{{ formatDate(archiveCurrentEmployment?.plannedRegularDate) }}</strong></div>
              <div><span>实际转正日期</span><strong>{{ formatDate(archiveCurrentEmployment?.actualRegularDate) }}</strong></div>
              <div><span>离职日期</span><strong>{{ formatDate(archiveCurrentEmployment?.leaveDate) }}</strong></div>
            </div>
          </section>

          <section v-if="!archiveEditing" class="employee-archive__section employee-archive__section--card">
            <div class="section-head">
              <div>
                <h3>个人与教育</h3>
                <span>基础身份和教育经历</span>
              </div>
            </div>
            <div class="employee-archive__facts">
              <div><span>手机号</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.phone || '未填写' }}</strong></div>
              <div><span>性别</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.gender || '未填写' }}</strong></div>
              <div><span>出生日期</span><strong>{{ formatDate(employeeArchiveDrawer.data.employeeProfile?.birthDate) }}</strong></div>
              <div><span>民族</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.ethnicity || '未填写' }}</strong></div>
              <div><span>学历</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.education || '未填写' }}</strong></div>
              <div><span>职称</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.professionalTitle || '未填写' }}</strong></div>
              <div><span>毕业院校</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.school || '未填写' }}</strong></div>
              <div><span>毕业日期</span><strong>{{ formatDate(employeeArchiveDrawer.data.employeeProfile?.graduationDate) }}</strong></div>
              <div><span>专业</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.major || '未填写' }}</strong></div>
              <div><span>婚姻状况</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.maritalStatus || '未填写' }}</strong></div>
              <div><span>子女状况</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.childrenStatus || '未填写' }}</strong></div>
              <div><span>子女数量</span><strong>{{ archiveDisplayValue(employeeArchiveDrawer.data.employeeProfile?.childrenCount) }}</strong></div>
              <div><span>政治面貌</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.politicalStatus || '未填写' }}</strong></div>
              <div><span>籍贯</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.nativePlace || '未填写' }}</strong></div>
              <div><span>户籍类型</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.householdType || '未填写' }}</strong></div>
            </div>
          </section>

          <section v-if="!archiveEditing" class="employee-archive__section employee-archive__section--card">
            <div class="section-head">
              <div>
                <h3>联系与保障</h3>
                <span>敏感号码仅显示保存状态，不返回具体内容</span>
              </div>
            </div>
            <div class="employee-archive__facts">
              <div class="span-2"><span>身份证地址</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.idAddress || '未填写' }}</strong></div>
              <div>
                <span>{{ employeeArchiveDrawer.data.employeeProfile?.idNumberConfigured ? '身份证号（已保存，留空不变）' : '身份证号' }}</span>
                <strong>{{ employeeArchiveDrawer.data.employeeProfile?.idNumberConfigured ? '已保存' : '未填写' }}</strong>
              </div>
              <div class="span-2"><span>现住址</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.currentAddress || '未填写' }}</strong></div>
              <div><span>紧急联系人</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.emergencyContactName || '未填写' }}</strong></div>
              <div><span>与联系人关系</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.emergencyContactRelation || '未填写' }}</strong></div>
              <div><span>紧急联系电话</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.emergencyContactPhone || '未填写' }}</strong></div>
              <div><span>社保状态</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.socialSecurityStatus || '未填写' }}</strong></div>
              <div><span>社保起始日期</span><strong>{{ formatDate(employeeArchiveDrawer.data.employeeProfile?.socialSecurityStartDate) }}</strong></div>
              <div><span>公积金状态</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.housingFundStatus || '未填写' }}</strong></div>
              <div><span>公积金起始日期</span><strong>{{ formatDate(employeeArchiveDrawer.data.employeeProfile?.housingFundStartDate) }}</strong></div>
              <div><span>开户行</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.bankName || '未填写' }}</strong></div>
              <div><span>开户支行</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.bankBranch || '未填写' }}</strong></div>
              <div>
                <span>{{ employeeArchiveDrawer.data.employeeProfile?.bankAccountConfigured ? '银行卡号（已保存，留空不变）' : '银行卡号' }}</span>
                <strong>{{ employeeArchiveDrawer.data.employeeProfile?.bankAccountConfigured ? '已保存' : '未填写' }}</strong>
              </div>
            </div>
          </section>

          <section v-if="!archiveEditing" class="employee-archive__section">
            <div class="section-head">
              <div>
                <h3>钉钉账号关联</h3>
                <span>仅影响钉钉登录和消息通知，不读取或同步钉钉组织</span>
              </div>
              <el-switch
                v-if="employeeArchiveDrawer.data.dingtalkBinding"
                :model-value="employeeArchiveDrawer.data.dingtalkBindingState === 'enabled'"
                :loading="employeeArchiveDrawer.dingtalkSaving"
                inline-prompt
                active-text="启用"
                inactive-text="停用"
                @change="setArchiveDingtalkState(Boolean($event))"
              />
            </div>
            <div class="employee-archive__identity">
              <el-tag :type="dingtalkStateTagType[employeeArchiveDrawer.data.dingtalkBindingState]" effect="plain">
                {{ dingtalkStateLabels[employeeArchiveDrawer.data.dingtalkBindingState] }}
              </el-tag>
              <span v-if="employeeArchiveDrawer.data.dingtalkBinding?.lastLoginAt">
                最近登录 {{ formatDateTime(employeeArchiveDrawer.data.dingtalkBinding.lastLoginAt) }}
              </span>
              <span v-else-if="employeeArchiveDrawer.data.dingtalkBinding">尚无登录记录</span>
              <span v-else>完成身份核验和人工绑定后，才可启用钉钉登录。</span>
            </div>
          </section>

          <section v-if="!archiveEditing" class="employee-archive__section">
            <div class="section-head">
              <div>
                <h3>任职历史</h3>
                <span>支持历史补录和未来生效；重叠只提醒，不覆盖记录</span>
              </div>
              <el-button v-if="canEditArchive" @click="employmentRecordDrawerVisible = true">新增任职记录</el-button>
            </div>
            <el-tag v-if="employeeArchiveDrawer.data.employmentWarnings?.length" type="warning" effect="plain" size="small">{{ employeeArchiveDrawer.data.employmentWarnings.join('；') }}</el-tag>
            <el-table :data="employeeArchiveDrawer.data.employmentHistory" size="small" class="app-table">
              <el-table-column label="生效区间" min-width="180">
                <template #default="{ row }">{{ formatDate(row.effectiveFrom) }} — {{ row.effectiveTo ? formatDate(row.effectiveTo) : '至今' }}</template>
              </el-table-column>
              <el-table-column label="部门 / 岗位" min-width="180">
                <template #default="{ row }">{{ row.dept?.name || '未设置' }} / {{ row.position || '未设置' }}</template>
              </el-table-column>
              <el-table-column label="变更" width="100">
                <template #default="{ row }">{{ employmentChangeLabels[row.changeType] || row.changeType }}</template>
              </el-table-column>
              <el-table-column label="状态" width="90">
                <template #default="{ row }">{{ statusLabels[row.employeeStatus as UserStatus] }}</template>
              </el-table-column>
            </el-table>
          </section>

          <section v-if="!archiveEditing" class="employee-archive__section employee-archive__section--card">
            <div class="section-head">
              <div>
                <h3>合同记录</h3>
                <span>有效合同与历史合同均保留，花名册移除只停用、不删除</span>
              </div>
            </div>
            <template v-if="employeeArchiveDrawer.data.employeeContracts.length">
            <div
              v-for="(contract, index) in employeeArchiveDrawer.data.employeeContracts"
              :key="contract.id"
              class="employee-archive__contract-card"
            >
              <div class="employee-archive__contract-head">
                <strong>合同 {{ index + 1 }}</strong>
                <el-tag :type="contract.isActive === false ? 'info' : 'success'" size="small">
                  {{ contract.isActive === false ? '历史' : '有效' }}
                </el-tag>
              </div>
              <div class="employee-archive__facts">
                <div><span>类型</span><strong>{{ contractTypeLabels[contract.contractType] || contract.contractType || '未填写' }}</strong></div>
                <div><span>合同名称</span><strong>{{ contract.name || '未填写' }}</strong></div>
                <div><span>签约公司</span><strong>{{ contract.signingCompany || '未填写' }}</strong></div>
                <div><span>签订日期</span><strong>{{ formatDate(contract.signedAt) }}</strong></div>
                <div><span>生效日期</span><strong>{{ formatDate(contract.effectiveFrom) }}</strong></div>
                <div><span>到期日期</span><strong>{{ formatDate(contract.expiresAt) }}</strong></div>
                <div><span>期限</span><strong>{{ contract.termType || '未填写' }}</strong></div>
                <div><span>原公司</span><strong>{{ contract.originalCompany || '未填写' }}</strong></div>
                <div><span>新公司</span><strong>{{ contract.newCompany || '未填写' }}</strong></div>
                <div><span>保密协议</span><strong>{{ contract.confidentialityAgreement || '未填写' }}</strong></div>
                <div><span>竞业协议</span><strong>{{ contract.nonCompeteAgreement || '未填写' }}</strong></div>
                <div><span>肖像协议</span><strong>{{ contract.portraitAgreement || '未填写' }}</strong></div>
              </div>
              <div class="employee-archive__contract-materials">
                <div>
                  <strong>合同图片</strong>
                  <div class="contract-material-links">
                    <span v-if="!contract.images?.length">无图片</span>
                    <el-button v-for="item in contract.images ?? []" :key="item.url" link type="primary" @click="openContractMaterial(item)">{{ item.name }}</el-button>
                  </div>
                </div>
                <div>
                  <strong>合同附件</strong>
                  <div class="contract-material-links">
                    <span v-if="!contract.attachments?.length">无附件</span>
                    <el-button v-for="item in contract.attachments ?? []" :key="item.url" link type="primary" @click="openContractMaterial(item)">{{ item.name }}</el-button>
                  </div>
                </div>
              </div>
            </div>
            </template>
            <el-empty v-else description="暂无合同记录" :image-size="64" />
          </section>
        </template>
      </div>
    </el-drawer>

    <el-dialog
      v-model="rosterImportDialog.visible"
      title="花名册导入预检"
      width="680px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-alert
        title="上传只生成差异预检，不会直接修改员工档案"
        description="组织、部门、岗位、花名册直属主管和在离职状态均以这份 HRM 花名册为准；不会读取或同步钉钉组织，也不会覆盖已审核的绩效直属上级。"
        type="info"
        show-icon
        :closable="false"
        class="roster-import__alert"
      />
      <div class="roster-import__mode">
        <strong>导入模式</strong>
        <el-radio-group v-model="rosterImportDialog.mode">
          <el-radio-button value="full">全量盘点</el-radio-button>
          <el-radio-button value="incremental">增量更新</el-radio-button>
        </el-radio-group>
        <p v-if="rosterImportDialog.mode === 'full'">文件缺少的在职员工只会进入“疑似离职”清单，不会自动离职。</p>
        <p v-else>只检查文件中出现的员工；空单元格默认不修改旧值。</p>
      </div>
      <el-upload
        drag
        action="#"
        accept=".xlsx"
        :auto-upload="false"
        :limit="1"
        :on-change="onRosterFileChange"
        :on-remove="onRosterFileRemove"
        class="roster-import__upload"
      >
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">拖拽花名册到此处，或 <em>点击选择</em></div>
        <template #tip>
          <div class="el-upload__tip">仅支持 .xlsx，最大 10MB；当前模板按 81 列花名册解析。</div>
        </template>
      </el-upload>
      <el-button plain type="primary" @click="downloadRosterTemplate">下载标准 Excel 模板</el-button>

      <div v-if="rosterImportDialog.result" class="roster-preview">
        <div class="roster-preview__head">
          <div>
            <strong>预检结果</strong>
            <small>批次 {{ rosterImportDialog.result.batchId }}</small>
          </div>
          <el-tag :type="rosterImportDialog.result.canConfirm ? 'success' : 'danger'">
            {{ rosterImportDialog.result.canConfirm ? '无阻断项' : '需处理阻断项' }}
          </el-tag>
        </div>
        <div class="roster-preview__grid">
          <div><span>文件员工</span><strong>{{ rosterImportDialog.result.summary.totalRows }}</strong></div>
          <div><span>拟新增</span><strong>{{ rosterImportDialog.result.summary.createCount }}</strong></div>
          <div><span>拟更新</span><strong>{{ rosterImportDialog.result.summary.updateCount }}</strong></div>
          <div><span>组织节点</span><strong>{{ rosterImportDialog.result.summary.desiredDepartmentCount }}</strong></div>
          <div class="is-danger"><span>阻断行</span><strong>{{ rosterImportDialog.result.summary.blockingErrorCount }}</strong></div>
          <div class="is-warning"><span>提醒</span><strong>{{ rosterImportDialog.result.summary.warningCount }}</strong></div>
          <div><span>将归档离职</span><strong>{{ rosterImportDialog.result.summary.missingFromFullRosterCount }}</strong></div>
        </div>
        <div v-if="rosterIssueRows.length" class="roster-preview__issues">
          <div class="roster-preview__issues-head">
            <strong>需要核对的行</strong>
            <small>共 {{ rosterIssueRows.length }} 行，阻断项优先；个人敏感字段不在预检清单中明文展示。</small>
          </div>
          <div class="roster-preview__issue-list">
            <div v-for="row in rosterIssueRows" :key="row.rowNumber" class="roster-preview__issue-row">
              <div class="roster-preview__issue-person">
                <strong>第 {{ row.rowNumber }} 行</strong>
                <span>
                  {{ row.normalizedValue.employee?.employeeNo || row.normalizedValue.employeeNo || '无工号' }}
                  · {{ row.normalizedValue.employee?.name || row.normalizedValue.name || '无姓名' }}
                </span>
                <small>{{ row.normalizedValue.employee?.departmentPath?.join(' / ') || '未填写部门' }}</small>
              </div>
              <div class="roster-preview__issue-tags">
                <el-tag v-for="error in row.errors" :key="`error-${error}`" type="danger" effect="plain">{{ error }}</el-tag>
                <el-tag v-for="warning in row.warnings" :key="`warning-${warning}`" type="warning" effect="plain">
                  {{ warning }}
                </el-tag>
              </div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="rosterImportDialog.visible = false">关闭</el-button>
        <el-button
          type="primary"
          :loading="rosterImportDialog.loading"
          :disabled="!rosterImportDialog.file"
          @click="previewRosterImport"
        >
          开始预检
        </el-button>
        <el-button
          v-if="rosterImportDialog.result?.canConfirm"
          type="success"
          :loading="rosterImportDialog.confirming"
          @click="confirmRosterImport"
        >
          提交审核
        </el-button>
      </template>
    </el-dialog>

    <DepartmentEditDrawer
      v-model="departmentEditDrawer.visible"
      :department="departmentEditDrawer.department"
      :departments="departments"
      :saving="departmentEditDrawer.saving"
      @save="saveDepartment"
    />

    <DepartmentCreateDrawer
      v-model="departmentCreateDrawer.visible"
      :parent="departmentCreateDrawer.parent"
      @submitted="loadDepartments"
    />

    <EmployeeCreateDrawer
      v-model="employeeCreateDrawerVisible"
      :departments="departments"
      @submitted="loadUsers"
    />

    <EmploymentRecordDrawer
      v-model="employmentRecordDrawerVisible"
      :archive="employeeArchiveDrawer.data"
      :departments="departments"
      @submitted="employeeArchiveDrawer.visible = false"
    />

    <el-dialog v-model="departmentMergeDialog.visible" title="合并部门" width="520px" :close-on-click-modal="false">
      <p>将 <strong>{{ departmentMergeDialog.source?.name }}</strong> 合并到目标部门。审核通过后，人员和下级部门转入目标部门，来源部门停用，历史记录保留。</p>
      <el-select v-model="departmentMergeDialog.targetId" filterable placeholder="请选择目标部门" style="width: 100%">
        <el-option v-for="dept in flattenedDepartments.filter((item) => item.id !== departmentMergeDialog.source?.id)" :key="dept.id" :label="dept.fullPath || dept.name" :value="dept.id" />
      </el-select>
      <template #footer><el-button @click="departmentMergeDialog.visible = false">取消</el-button><el-button type="primary" :loading="departmentMergeDialog.saving" @click="confirmDepartmentMerge">提交审核</el-button></template>
    </el-dialog>

    <el-dialog v-model="assignmentDialog.visible" title="批量归属部门" width="480px" :close-on-click-modal="false">
      <p>已选择 <strong>{{ selectedOrgMembers.length }}</strong> 名未分配人员。保存后提交员工档案审核。</p>
      <el-tree-select
        v-model="assignmentDialog.targetDepartmentId"
        :data="departments"
        node-key="id"
        :props="{ label: 'name', children: 'children' }"
        check-strictly
        filterable
        placeholder="请选择目标部门"
        style="width: 100%"
      />
      <template #footer><el-button @click="assignmentDialog.visible = false">取消</el-button><el-button type="primary" @click="confirmBatchAssignment">提交审核</el-button></template>
    </el-dialog>

    <div
      v-if="departmentContextMenu.visible && departmentContextMenu.department"
      class="department-context-menu"
      :style="{ left: `${departmentContextMenu.x}px`, top: `${departmentContextMenu.y}px` }"
      @click.stop
    >
      <button type="button" @click="openDepartmentEdit(departmentContextMenu.department!)">编辑</button>
      <button type="button" @click="openDepartmentCreate(departmentContextMenu.department!)">新增下级部门</button>
      <button type="button" @click="openDepartmentMerge(departmentContextMenu.department!)">合并到…</button>
      <button type="button" class="is-danger" @click="removeDepartment(departmentContextMenu.department!)">停用</button>
    </div>

    <el-dialog v-model="personSettingsDialog.visible" title="人员设置" width="520px" :close-on-click-modal="false" destroy-on-close>
      <div class="person-settings__summary">
        <span class="avatar">{{ personSettingsDialog.userName.slice(0, 1) }}</span>
        <div class="person-settings__summary-content">
          <div class="person-settings__summary-title">
            <strong>{{ personSettingsDialog.userName }}</strong>
            <el-tag
              size="small"
              :type="statusTagType[personSettingsDialog.status]"
              effect="plain"
            >
              {{ formatPersonnelIdentityLabel(personSettingsDialog.status) }}
            </el-tag>
            <el-tag size="small" type="info" effect="plain">{{ personSettingsDialog.position }}</el-tag>
            <el-select
              v-if="isSystemAdmin"
              v-model="personSettingsDialog.sysRole"
              aria-label="系统权限"
              size="small"
              class="person-settings__permission-select"
            >
              <el-option v-for="opt in sysRoleOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
            <el-tag v-else size="small" effect="plain">{{ roleLabels[personSettingsDialog.sysRole] }}</el-tag>
            <el-tag v-if="personSettingsDialog.canViewAll" size="small" type="info" effect="plain">全量只读</el-tag>
            <el-tooltip placement="top">
              <template #content>
                <div class="person-settings__tooltip-content">
                  <div class="person-settings__tooltip-line"><strong>岗位：</strong>来自当前有效任职记录。</div>
                  <div class="person-settings__tooltip-line"><strong>系统权限：</strong>由系统管理员维护。</div>
                  <div class="person-settings__tooltip-line"><strong>全量只读：</strong>只扩大查看范围，不授予业务审批或处理权限。</div>
                </div>
              </template>
              <button type="button" class="person-settings__help" aria-label="岗位和系统权限说明">
                <el-icon><QuestionFilled /></el-icon>
              </button>
            </el-tooltip>
          </div>
          <small>{{ personSettingsDialog.deptName }}</small>
        </div>
      </div>
      <el-form label-position="top" class="person-settings__form">
        <el-form-item v-if="isSystemAdmin && personSettingsDialog.sysRole === 'hr_user'" label="普通 HR 可操作能力">
          <el-checkbox-group v-model="personSettingsDialog.hrCapabilities" class="hr-capability-options">
            <el-checkbox v-for="item in hrCapabilityOptions" :key="item.value" :value="item.value">
              {{ item.label }}
            </el-checkbox>
          </el-checkbox-group>
          <small class="dialog-tip">编辑与审核可分别赋给不同人员，也允许同一人同时拥有两项能力。</small>
        </el-form-item>
        <el-form-item>
          <template #label>
            <span class="person-settings__label">
              绩效直属上级
              <el-tooltip placement="top">
                <template #content>
                  <div class="person-settings__tooltip-content">
                    <div class="person-settings__tooltip-line"><strong>作用：</strong>用于目标审核、主管评分和待办归属。</div>
                    <div class="person-settings__tooltip-line"><strong>区别：</strong>与花名册“直属主管”相互独立。</div>
                    <div class="person-settings__tooltip-line"><strong>审核：</strong>由 HR 管理员在“人事变更审核 → 员工档案”中处理。</div>
                    <div class="person-settings__tooltip-line"><strong>生效：</strong>审核通过前继续使用原关系，不改变岗位或系统权限。</div>
                  </div>
                </template>
                <button type="button" class="person-settings__help" aria-label="绩效直属上级说明">
                  <el-icon><QuestionFilled /></el-icon>
                </button>
              </el-tooltip>
            </span>
          </template>
          <UserSelect
            v-model="personSettingsDialog.directManagerId"
            placeholder="搜索姓名或工号选择绩效直属上级"
            :disabled-ids="[personSettingsDialog.userId]"
          />
        </el-form-item>
        <div v-if="personSettingsDialog.selectedManager" class="person-settings__manager-access">
          <el-tag
            :type="selectedManagerRelationChanged ? 'warning' : 'success'"
            effect="light"
            size="small"
          >
            {{ selectedManagerRelationChanged ? '提交后待 HR 审核' : '已生效' }}
          </el-tag>
          <span v-if="selectedManagerRelationChanged">审核入口：人事变更审核 &gt; 员工档案</span>
        </div>
        <el-form-item>
          <template #label>
            <span class="person-settings__label">
              当前业务职责
              <el-tooltip placement="top">
                <template #content>
                  <div class="person-settings__tooltip-content">
                    <div class="person-settings__tooltip-line"><strong>人员身份：</strong>员工是基础人员身份，不会额外赋权。</div>
                    <div class="person-settings__tooltip-line"><strong>业务职责：</strong>根据组织关系和当前业务记录自动计算。</div>
                    <div class="person-settings__tooltip-line"><strong>职责数量：</strong>表示当前负责的关系或业务事项，不等同于下属人数。</div>
                  </div>
                </template>
                <button type="button" class="person-settings__help" aria-label="业务职责说明">
                  <el-icon><QuestionFilled /></el-icon>
                </button>
              </el-tooltip>
            </span>
          </template>
          <div class="person-settings__readonly">
            <div v-if="personSettingsDialog.businessIdentities.length" class="business-identity-tags">
              <el-tag
                v-for="identity in personSettingsDialog.businessIdentities"
                :key="identity.type"
                size="small"
                effect="plain"
              >
                {{ businessIdentityText(identity) }}
              </el-tag>
            </div>
            <span v-else>无额外业务职责</span>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="personSettingsDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="personSettingsDialog.saving" @click="confirmPersonSettings">提交审核</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="leaderDialog.visible" title="设置部门负责人" width="480px" :close-on-click-modal="false" destroy-on-close>
      <p class="dialog-tip">部门负责人负责本部门管理和绩效复核，也是下级部门最终业务审批人的默认来源。</p>
      <UserSelect v-model="leaderDialog.leaderId" placeholder="搜索姓名或工号，留空则清空部门负责人" />
      <template #footer>
        <el-button @click="leaderDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="confirmLeader">确认</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="approverDialog.visible" title="设置最终业务审批人" width="480px" :close-on-click-modal="false" destroy-on-close>
      <p class="dialog-tip">二级及以下部门默认由上一级部门负责人审批；一级部门默认由部门负责人的绩效直属上级审批。HR 只负责校准，跨部门或最高层级可手动设置。</p>
      <UserSelect v-model="approverDialog.approverId" placeholder="搜索姓名或工号，留空则恢复自动匹配" />
      <template #footer>
        <el-button @click="approverDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="confirmApprover">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.page-title h2 {
  margin: 0;
  font-size: 20px;
  color: #172033;
}

.page-title p {
  margin: 6px 0 0;
  color: #7b8497;
  font-size: 13px;
}

.page-title__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.archive-edit-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.employee-archive__facts .el-input,
.employee-archive__facts .el-select {
  margin-top: 5px;
}

.roster-import__alert {
  margin-bottom: 18px;
}

.roster-import__mode {
  padding: 14px 16px;
  margin-bottom: 16px;
  border: 1px solid #e8edf5;
  border-radius: 10px;
  background: #fbfcff;
}

.roster-import__mode strong {
  display: block;
  margin-bottom: 10px;
  color: #26324b;
}

:global(.employee-archive-drawer) {
  max-width: 100%;
}

:global(.employee-archive-drawer .el-drawer__body) {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.employee-archive {
  min-height: 240px;
}

.employee-archive__hero {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 4px 0 20px;
  border-bottom: 1px solid #e8edf5;
}

.employee-archive__hero .avatar {
  width: 52px;
  height: 52px;
  font-size: 20px;
}

.employee-archive__name {
  display: flex;
  align-items: center;
  gap: 10px;
}

.employee-archive__name h3,
.employee-archive__hero p {
  margin: 0;
}

.employee-archive__hero p {
  margin-top: 6px;
  color: #6f7b91;
}

.department-context-menu {
  position: fixed;
  z-index: 5000;
  display: grid;
  min-width: 150px;
  padding: 6px;
  border: 1px solid #e5eaf2;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 12px 32px rgb(16 24 40 / 18%);
}

.department-context-menu button {
  border: 0;
  border-radius: 7px;
  padding: 9px 12px;
  background: transparent;
  color: #344054;
  text-align: left;
  cursor: pointer;
}

.department-context-menu button:hover { background: #f2f4f7; }
.department-context-menu button.is-danger { color: #d92d20; }

.unassigned-node {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: calc(100% - 16px);
  margin: 4px 8px 8px;
  border: 0;
  border-radius: 8px;
  padding: 9px 10px;
  background: #fff7ed;
  color: #9a3412;
  cursor: pointer;
}

.unassigned-node.active { background: #ffedd5; box-shadow: inset 0 0 0 1px #fdba74; }
.unassigned-node small { color: #c2410c; }

.contract-material-links { display: grid; justify-items: start; gap: 2px; }
.contract-material-links .el-button { max-width: 100%; margin-left: 0; }

.employee-archive__global-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.employee-archive__section {
  padding: 22px 0;
  border-bottom: 1px solid #e8edf5;
}

.employee-archive__section:last-child {
  border-bottom: 0;
}

.employee-archive__section.employee-archive__section--card {
  padding: 18px;
  margin-top: 18px;
  border: 1px solid #e5eaf2;
  border-radius: 14px;
  background: #fff;
}

.employee-archive__section .section-head {
  margin-bottom: 14px;
}

.employee-archive__facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px 18px;
}

.employee-archive__facts > div {
  min-width: 0;
  padding: 12px;
  border: 1px solid #e7ecf5;
  border-radius: 8px;
  background: #fafbfe;
}

.employee-archive__facts span,
.employee-archive__facts strong {
  display: block;
}

.employee-archive__facts span {
  color: #8791a4;
  font-size: 12px;
}

.employee-archive__facts strong {
  margin-top: 5px;
  overflow-wrap: anywhere;
  color: #2d3850;
}

.employee-archive__facts .span-2 {
  grid-column: span 2;
}

.employee-archive__contract-card {
  padding: 16px;
  margin-top: 14px;
  border: 1px solid #dfe5ee;
  border-radius: 12px;
  background: #f8fafc;
}

.employee-archive__contract-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.employee-archive__contract-materials {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 14px;
}

.employee-archive__contract-materials > div {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px dashed #cfd7e6;
  border-radius: 10px;
  background: #fff;
}

.employee-archive__identity {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  color: #667289;
}

.roster-import__mode p {
  margin: 10px 0 0;
  color: #6f7b91;
  font-size: 13px;
}

.roster-import__upload {
  margin-bottom: 18px;
}

.roster-preview {
  padding: 16px;
  border: 1px solid #dfe7f7;
  border-radius: 10px;
  background: #f8faff;
}

.roster-preview__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.roster-preview__head strong,
.roster-preview__head small {
  display: block;
}

.roster-preview__head small {
  margin-top: 4px;
  color: #8a94a6;
}

.roster-preview__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.roster-preview__grid > div {
  padding: 12px;
  border-radius: 8px;
  background: #fff;
}

.roster-preview__grid span,
.roster-preview__grid strong {
  display: block;
}

.roster-preview__grid span {
  color: #7b8497;
  font-size: 12px;
}

.roster-preview__grid strong {
  margin-top: 6px;
  color: #26324b;
  font-size: 22px;
}

.roster-preview__grid .is-danger strong {
  color: #e24d4d;
}

.roster-preview__grid .is-warning strong {
  color: #d38a0a;
}

.roster-preview__issues {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid #dfe7f7;
}

.roster-preview__issues-head {
  margin-bottom: 10px;
}

.roster-preview__issues-head strong,
.roster-preview__issues-head small {
  display: block;
}

.roster-preview__issue-list {
  max-height: 320px;
  padding-right: 4px;
  overflow-y: auto;
}

.roster-preview__issues-head small {
  margin-top: 4px;
  color: #7b8497;
}

.roster-preview__issue-row {
  display: grid;
  grid-template-columns: minmax(150px, 0.7fr) minmax(220px, 1.3fr);
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid #edf1f7;
}

.roster-preview__issue-person strong,
.roster-preview__issue-person span,
.roster-preview__issue-person small {
  display: block;
}

.roster-preview__issue-person span {
  margin-top: 3px;
  color: #46536b;
}

.roster-preview__issue-person small {
  margin-top: 3px;
  color: #8a94a6;
}

.roster-preview__issue-tags {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 6px;
}

.view-switch {
  display: inline-flex;
  gap: 6px;
  padding: 4px;
  margin: 18px 0;
  background: #f3f6fb;
  border: 1px solid #e5eaf4;
  border-radius: 8px;
}

.view-switch button {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #5f6b82;
  font-weight: 600;
  cursor: pointer;
}

.view-switch button.active {
  color: #2f63ff;
  background: #fff;
  box-shadow: 0 4px 12px rgba(42, 77, 158, 0.1);
}

.user-manage-view {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.user-manage-view :deep(.chart-card),
.user-manage-view :deep(.chart-card__body) {
  min-height: 0;
}

.user-manage-view :deep(.chart-card__body) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.view-switch {
  flex: 0 0 auto;
}

.issue-dot {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #ff4d4f;
  color: #fff;
  font-size: 12px;
  line-height: 18px;
}

.org-layout {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  gap: 18px;
}

.org-tree-panel,
.org-detail,
.checks-view {
  border: 1px solid #e8edf5;
  border-radius: 8px;
  background: #fff;
}

.org-tree-panel {
  padding: 14px;
  min-height: 0;
}

.org-tree-panel,
.org-detail {
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  -webkit-overflow-scrolling: touch;
}

.panel-head,
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.panel-head span,
.section-head span {
  color: #8a94a6;
  font-size: 12px;
}

.dept-node {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  width: 100%;
  gap: 8px;
  padding: 4px 8px 4px 0;
}

:deep(.el-tree-node__content) {
  align-items: flex-start;
  min-height: 38px;
  height: auto;
  padding: 2px 0;
}

:deep(.el-tree-node__expand-icon) {
  margin-top: 7px;
}

.dept-node__content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
}

.dept-node__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
  line-height: 1.4;
  word-break: break-word;
}

.dept-node__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.dept-node__badge {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 18px;
  white-space: nowrap;
}

.dept-node__badge.is-danger {
  background: #fff1f1;
  color: #df4d4d;
}

.dept-node__badge.is-warning {
  background: #fff6e7;
  color: #c98008;
}

.dept-node__badge.is-info {
  background: #eef3ff;
  color: #5572ef;
}

.dept-node__meta {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  flex-shrink: 0;
  padding-top: 2px;
}

.dept-node em {
  min-width: 24px;
  padding: 1px 7px;
  border-radius: 999px;
  background: #eef3ff;
  color: #5a72e8;
  font-style: normal;
  font-size: 12px;
  text-align: center;
}

.dept-node__issue-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 999px;
  background: #fff1f1;
  color: #df4d4d;
  font-size: 11px;
  font-weight: 700;
}

.org-detail {
  padding: 18px;
}

.dept-summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.dept-summary__side {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-width: 0;
}

.dept-summary__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.dept-path {
  max-width: 460px;
  padding: 6px 10px;
  overflow: hidden;
  color: #66738c;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid #e6ecf7;
  border-radius: 6px;
  background: #fbfcff;
}

.eyebrow {
  color: #7d8aa4;
  font-size: 12px;
}

.dept-summary h3,
.checks-summary h3,
.section-head h3 {
  margin: 4px 0;
  color: #172033;
  font-size: 18px;
}

.dept-summary__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.dept-summary__chip {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.dept-summary__chip.is-danger {
  background: #fff1f1;
  color: #df4d4d;
}

.dept-summary__chip.is-warning {
  background: #fff6e7;
  color: #c98008;
}

.dept-summary__chip.is-info {
  background: #eef3ff;
  color: #5572ef;
}

.dept-summary p,
.checks-summary p {
  margin: 0;
  color: #7b8497;
  font-size: 13px;
}

.relation-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  overflow: hidden;
  margin-bottom: 14px;
  border: 1px solid #e8edf5;
  border-radius: 8px;
  background: #fbfcff;
}

.relation-card {
  padding: 14px;
  border-right: 1px solid #e8edf5;
}

.relation-card:last-child {
  border-right: 0;
}

.relation-card__label,
.relation-card small {
  display: block;
  color: #8993a6;
  font-size: 12px;
}

.relation-card__label {
  font-weight: 600;
}

.relation-card strong {
  display: block;
  margin: 8px 0 4px;
  color: #1f2a44;
  font-size: 18px;
}

.light-filter {
  display: grid;
  grid-template-columns: minmax(260px, 1.5fr) repeat(3, minmax(160px, 1fr)) auto auto;
  gap: 12px;
  align-items: center;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.directory-view {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.directory-table-region {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.directory-table-region :deep(.el-table) {
  height: 100%;
}

.person-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #edf3ff;
  color: #4168e8;
  font-weight: 700;
}

.person-cell strong,
.person-cell small {
  display: block;
}

.business-identity-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.muted-text {
  color: #98a1b3;
  font-size: 12px;
}

.person-cell small {
  margin-top: 2px;
  color: #8a94a6;
}

.table-pagination {
  flex: 0 0 auto;
  justify-content: flex-end;
  margin-top: 16px;
}

.checks-view {
  padding: 16px;
}

.checks-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 14px;
  margin-bottom: 12px;
  border-bottom: 1px solid #eef2f7;
}

.checks-summary strong {
  font-size: 28px;
  color: #ff7d00;
}

.checks-filter {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.checks-filter__label {
  color: #6f7b91;
  font-size: 13px;
  font-weight: 600;
}

.checks-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.checks-stat {
  appearance: none;
  text-align: left;
  cursor: pointer;
  padding: 14px 16px;
  border: 1px solid #e8edf5;
  border-radius: 10px;
  background: #fbfcff;
}

.checks-stat span,
.checks-stat small {
  display: block;
}

.checks-stat span {
  color: #7b8497;
  font-size: 12px;
}

.checks-stat strong {
  display: block;
  margin: 8px 0 6px;
  color: #1f2a44;
  font-size: 28px;
  line-height: 1;
}

.checks-stat small {
  color: #98a1b3;
  font-size: 12px;
  line-height: 1.5;
}

.checks-stat.is-danger {
  border-color: #ffd6d6;
  background: #fff8f8;
}

.checks-stat.is-danger strong {
  color: #e24d4d;
}

.checks-stat.is-warning {
  border-color: #ffe4b3;
  background: #fffbf4;
}

.checks-stat.is-warning strong {
  color: #d38a0a;
}

.checks-stat.is-info strong {
  color: #4d6fff;
}

.checks-stat:hover {
  box-shadow: 0 10px 24px rgba(47, 99, 255, 0.08);
  transform: translateY(-1px);
}

.checks-groups {
  display: grid;
  gap: 16px;
}

.checks-group {
  padding: 14px;
  border: 1px solid #e8edf5;
  border-radius: 10px;
  background: #fff;
}

.checks-group__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.checks-group__head strong {
  color: #1f2a44;
  font-size: 15px;
}

.checks-group__head p {
  margin: 4px 0 0;
  color: #7b8497;
  font-size: 13px;
}

.issue-list {
  display: grid;
  gap: 10px;
}

.issue-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #e8edf5;
  border-radius: 8px;
  background: #fff;
  width: 100%;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.issue-item:hover {
  border-color: #cdd9f5;
  box-shadow: 0 8px 20px rgba(47, 99, 255, 0.08);
  transform: translateY(-1px);
}

.issue-item:focus-visible {
  outline: 2px solid #2f63ff;
  outline-offset: 2px;
}

.issue-item.is-danger {
  border-color: #ffd6d6;
  background: #fffafa;
}

.issue-item.is-warning {
  border-color: #ffe7ba;
  background: #fffdf7;
}

.issue-item strong {
  color: #26324b;
}

.issue-item p {
  margin: 4px 0 0;
  color: #7b8497;
  font-size: 13px;
}

.dialog-tip {
  margin: 0 0 16px;
  color: #606b80;
}

.person-settings__summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid #edf1f7;
}

.person-settings__summary-content {
  flex: 1;
  min-width: 0;
}

.person-settings__summary-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.person-settings__summary strong,
.person-settings__summary-content > small {
  display: block;
}

.person-settings__summary-content > small {
  margin-top: 4px;
  color: #8993a6;
}

.person-settings__permission-select {
  width: 112px;
}

.person-settings__permission-select :deep(.el-select__wrapper) {
  min-height: 24px;
  border-radius: 6px;
}

.person-settings__help {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #98a2b3;
  cursor: help;
}

.person-settings__help:hover,
.person-settings__help:focus-visible {
  color: #2f63ff;
  background: #eef3ff;
  outline: none;
}

.person-settings__tooltip-content {
  display: grid;
  gap: 6px;
  max-width: 340px;
}

.person-settings__tooltip-line {
  line-height: 1.55;
}

.person-settings__tooltip-line strong {
  color: #fff;
}

.person-settings__label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.person-settings__form {
  margin-top: 18px;
}

.person-settings__manager-access {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  margin: -6px 0 14px;
  color: #7b8497;
  font-size: 12px;
}

.person-settings__readonly {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 32px;
  color: #344054;
}

.roster-workspace-switch {
  display: inline-flex;
  align-self: flex-start;
  gap: 4px;
  padding: 4px;
  border: 1px solid #e1e7f0;
  border-radius: 10px;
  background: #f5f7fb;
}

.roster-workspace-switch button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 14px;
  border: 0;
  border-radius: 7px;
  color: #657188;
  background: transparent;
  cursor: pointer;
}

.roster-workspace-switch button.active {
  color: var(--el-color-primary);
  background: #fff;
  box-shadow: 0 2px 8px rgb(42 63 112 / 10%);
  font-weight: 600;
}

.roster-workspace-switch button span {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  color: #fff;
  background: #ff5d68;
  font-size: 12px;
  text-align: center;
}

.review-workspace {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 12px;
  min-height: 0;
  flex: 1;
}

.review-toolbar,
.review-batchbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.review-toolbar {
  padding: 14px 16px;
  border: 1px solid #e5eaf2;
  border-radius: 12px;
  background: #fff;
}

.review-toolbar strong,
.review-toolbar small {
  display: block;
}

.review-toolbar small {
  margin-top: 5px;
  color: #8993a6;
}

.review-toolbar__filters {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 120px auto;
  gap: 10px;
  min-width: min(520px, 52%);
}

.review-batchbar {
  justify-content: flex-start;
  padding: 10px 14px;
  border: 1px solid #ccd6ff;
  border-radius: 10px;
  color: #4054a8;
  background: #f0f3ff;
}

.review-batchbar small {
  flex: 1;
  color: #76819a;
}

.review-table-region {
  min-height: 0;
  overflow: hidden;
  border: 1px solid #e5eaf2;
  border-radius: 12px;
}

.review-ready {
  color: #2f9e68;
  font-size: 13px;
}

@media (max-width: 1200px) {
  .org-layout {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(220px, 36%) minmax(0, 1fr);
  }

  .org-tree-panel {
    min-height: auto;
  }

  .relation-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .relation-card:nth-child(2) {
    border-right: 0;
  }

  .relation-card:nth-child(-n + 2) {
    border-bottom: 1px solid #e8edf5;
  }

  .light-filter {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .checks-overview {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .user-manage-view {
    height: auto;
    overflow: visible;
  }

  .user-manage-view :deep(.chart-card__body) {
    display: block;
    overflow: visible;
  }

  .org-layout {
    display: grid;
    grid-template-rows: none;
    min-height: auto;
    overflow: visible;
  }

  .directory-view {
    display: block;
    overflow: visible;
  }

  .review-workspace {
    display: block;
  }

  .review-toolbar,
  .review-batchbar {
    align-items: stretch;
    flex-direction: column;
  }

  .review-toolbar__filters {
    grid-template-columns: 1fr;
    min-width: 0;
  }

  .review-table-region {
    min-height: 520px;
    margin: 12px 0;
    overflow: auto;
  }

  .directory-table-region {
    overflow: visible;
  }

  .directory-table-region :deep(.el-table) {
    height: auto;
  }

  .org-tree-panel,
  .org-detail {
    overflow: visible;
    scrollbar-gutter: auto;
  }

  .page-title,
  .dept-summary {
    flex-direction: column;
  }

  .page-title__actions {
    width: 100%;
  }

  .page-title__actions .el-button {
    flex: 1;
  }

  .roster-preview__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .roster-preview__issue-row {
    grid-template-columns: 1fr;
  }

  .employee-archive__facts {
    grid-template-columns: 1fr;
  }

  .employee-archive__facts .span-2 {
    grid-column: auto;
  }

  .employee-archive__section.employee-archive__section--card {
    padding: 14px;
  }

  .employee-archive__contract-materials {
    grid-template-columns: 1fr;
  }

  .employee-archive__hero {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .employee-archive__global-actions {
    width: 100%;
    margin-left: 0;
  }

  .employee-archive__global-actions .el-button {
    flex: 1;
  }

  .dept-summary__side {
    justify-content: flex-start;
    width: 100%;
  }

  .dept-path {
    max-width: 100%;
  }

  .view-switch {
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
  }

  .relation-grid,
  .light-filter {
    grid-template-columns: 1fr;
  }

  .relation-card,
  .relation-card:nth-child(2) {
    border-right: 0;
    border-bottom: 1px solid #e8edf5;
  }

  .relation-card:last-child {
    border-bottom: 0;
  }
}
</style>
