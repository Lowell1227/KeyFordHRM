<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox, type UploadFile } from 'element-plus';
import {
  ArrowRight,
  Key,
  OfficeBuilding,
  Search,
  Setting,
  UserFilled,
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
import ChartCard from '@/components/common/ChartCard.vue';
import UserSelect from '@/components/common/UserSelect.vue';
import { useAuthStore } from '@/stores/auth.store';
import type { Department, User as ManagedUser, UserQuery } from '@/types/api.types';
import type { SysRole, UserStatus } from '@/types/enums';
import { formatDate, formatDateTime } from '@/utils/date';

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

const activeView = ref<'org' | 'users' | 'checks'>('org');
const isSystemAdmin = computed(() => auth.user?.sysRole === 'system_admin');

const roleLabels: Record<SysRole, string> = {
  system_admin: '系统管理员',
  hr: 'HR',
  chairman: '董事长',
  vp: '副总裁',
  dept_head: '部门负责人',
  manager: '主管',
  employee: '员工',
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
  { label: 'HR', value: 'hr' },
  { label: '董事长', value: 'chairman' },
  { label: '副总裁', value: 'vp' },
  { label: '部门负责人', value: 'dept_head' },
  { label: '主管', value: 'manager' },
  { label: '员工', value: 'employee' },
];

const statusOptions: { label: string; value: UserStatus }[] = [
  { label: '在职', value: 'active' },
  { label: '试用期', value: 'probation' },
  { label: '已离职', value: 'resigned' },
];

const departments = ref<Department[]>([]);
const deptLoading = ref(false);
const selectedDeptId = ref('');

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

const selectedDept = computed(() => flattenedDepartments.value.find((dept) => dept.id === selectedDeptId.value) ?? null);

const childDeptCount = computed(() => selectedDept.value?.children?.length ?? 0);
const selectedDeptApproverTrail = computed(() => getApproverTrail(selectedDept.value));
const selectedDeptIssueBadges = computed(() => getDeptIssueBadges(selectedDept.value));

const orgMembers = ref<ManagedUser[]>([]);
const orgMemberTotal = ref(0);
const orgMemberLoading = ref(false);
const orgMemberPage = ref(1);

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
        title: `${dept.name} 未设置组织负责人`,
        detail: '组织负责人就是原来的部门负责人，负责部门管理、绩效复核和管理范围归属。',
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
        title: `${dept.name} 暂未推导出绩效结果审批人`,
        detail: '当前部门已有在职员工，请先补齐上级组织负责人；跨组织等特殊场景可手动指定审批人。',
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
    if (user.status !== 'resigned' && !user.directManagerId) {
      items.push({
        key: `${user.id}-manager`,
        type: '人员',
        title: `${user.name} 未设置直属主管`,
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
    if (user.status === 'resigned' && !['employee'].includes(user.sysRole)) {
      items.push({
        key: `${user.id}-role`,
        type: '人员',
        title: `${user.name} 已离职但仍保留 ${roleLabels[user.sysRole] ?? user.sysRole} 角色`,
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
      deptId: selectedDeptId.value,
    });
    orgMembers.value = res.items;
    orgMemberTotal.value = res.total;
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

async function loadCheckUsers() {
  checkLoading.value = true;
  try {
    const res = await usersApi.findAll({ page: 1, pageSize: 100 });
    checkUsers.value = res.items;
  } catch {
    checkUsers.value = [];
  } finally {
    checkLoading.value = false;
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

function getApproverTrail(dept: Department | null): string[] {
  if (!dept) return [];
  if (!dept.effectiveApproverId) {
    return [dept.name, '未找到绩效结果审批人'];
  }

  if (dept.effectiveApproverSource === 'manual_override') {
    return [dept.name, '手动指定', dept.effectiveApproverName || '已指定审批人'];
  }

  if (dept.effectiveApproverDeptName) {
    return [dept.name, dept.effectiveApproverDeptName, dept.effectiveApproverName || '绩效结果审批人'];
  }

  if (dept.effectiveApproverSource === 'parent_leader') {
    return [dept.name, '上一级组织负责人', dept.effectiveApproverName || '绩效结果审批人'];
  }

  if (dept.effectiveApproverSource === 'ancestor_chain') {
    return [dept.name, '上层组织逐级继承', dept.effectiveApproverName || '绩效结果审批人'];
  }

  return [dept.name, dept.effectiveApproverName || '绩效结果审批人'];
}

function getDeptIssueBadges(dept: Department | null): DeptIssueBadge[] {
  if (!dept) return [];

  const badges: DeptIssueBadge[] = [];
  const directMemberCount = dept.directMemberCount ?? 0;

  if (directMemberCount > 0 && !dept.effectiveApproverId) {
    badges.push({ label: '审批未就绪', level: 'danger' });
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
    loadDepartments().then(loadOrgMembers);
    return;
  }
  if (activeView.value === 'users') {
    loadUsers();
    return;
  }
  Promise.all([loadDepartments(), loadCheckUsers()]);
}

const employeeArchiveDrawer = ref({
  visible: false,
  loading: false,
  dingtalkSaving: false,
  data: null as EmployeeArchive | null,
});

async function openEmployeeArchive(row: ManagedUser) {
  employeeArchiveDrawer.value.visible = true;
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
  directManagerId: undefined as string | undefined,
  sysRole: 'employee' as SysRole,
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
    directManagerId: row.directManagerId ?? undefined,
    sysRole: row.sysRole,
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

const selectedManagerNeedsRole = computed(() =>
  isSystemAdmin.value && personSettingsDialog.value.selectedManager?.sysRole === 'employee',
);

const selectedManagerAccessText = computed(() => {
  const manager = personSettingsDialog.value.selectedManager;
  if (!manager) return '';
  if (manager.sysRole !== 'employee') return '主管权限：已开通';
  return isSystemAdmin.value
    ? '主管权限：未开通，保存时一并开通'
    : '主管权限：未开通，请联系系统管理员';
});

async function confirmPersonSettings() {
  if (!personSettingsDialog.value.userId) return;
  personSettingsDialog.value.saving = true;
  try {
    await usersApi.updateSettings(personSettingsDialog.value.userId, {
      directManagerId: personSettingsDialog.value.directManagerId ?? null,
      ...(isSystemAdmin.value ? { sysRole: personSettingsDialog.value.sysRole } : {}),
      ...(selectedManagerNeedsRole.value ? { grantManagerRole: true } : {}),
    });
    ElMessage.success(selectedManagerNeedsRole.value ? '人员设置已保存，并已开通主管权限' : '人员设置已保存');
    personSettingsDialog.value.visible = false;
    await Promise.all([loadUsers(), loadOrgMembers(), loadCheckUsers()]);
  } catch {
    // 由 HTTP 拦截器展示错误
  } finally {
    personSettingsDialog.value.saving = false;
  }
}

const passwordDialog = ref({
  visible: false,
  userId: '',
  userName: '',
  password: '',
});

function openPasswordDialog(row: ManagedUser) {
  passwordDialog.value = {
    visible: true,
    userId: row.id,
    userName: row.name,
    password: '',
  };
}

async function confirmPassword() {
  if (!passwordDialog.value.userId) return;
  const pwd = passwordDialog.value.password.trim();
  if (pwd.length < 6) {
    ElMessage.warning('密码长度不能少于 6 位');
    return;
  }
  try {
    await usersApi.setPassword(passwordDialog.value.userId, { password: pwd });
    ElMessage.success('登录密码已设置');
    passwordDialog.value.visible = false;
    passwordDialog.value.password = '';
  } catch {
    // 由 HTTP 拦截器展示错误
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
    ElMessage.success('组织负责人已更新');
    leaderDialog.value.visible = false;
    await Promise.all([loadDepartments(), loadOrgMembers(), loadCheckUsers()]);
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
    ElMessage.success('绩效结果审批人已更新');
    approverDialog.value.visible = false;
    await Promise.all([loadDepartments(), loadCheckUsers()]);
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
    await ElMessageBox.confirm(
      `将按花名册重建 ${result.summary.desiredDepartmentCount} 个组织节点，新增 ${result.summary.createCount} 人、更新 ${result.summary.updateCount} 人、归档离职 ${result.summary.missingFromFullRosterCount} 人。确认后不可直接撤销。`,
      '确认写入员工主数据',
      { confirmButtonText: '确认导入', cancelButtonText: '返回检查', type: 'warning' },
    );
  } catch {
    return;
  }

  rosterImportDialog.value.confirming = true;
  try {
    const confirmed = await employeeArchivesApi.confirmRoster(result.batchId, file);
    ElMessage.success(`导入完成：新增 ${confirmed.created} 人，更新 ${confirmed.updated} 人，归档离职 ${confirmed.resigned ?? 0} 人`);
    rosterImportDialog.value.visible = false;
    await Promise.all([loadDepartments(), loadUsers(), loadCheckUsers()]);
  } catch {
    // 由 HTTP 拦截器展示错误
  } finally {
    rosterImportDialog.value.confirming = false;
  }
}

watch(activeView, (view) => {
  if (view === 'users' && userList.value.length === 0) loadUsers();
  if (view === 'checks') loadCheckUsers();
});

onMounted(async () => {
  await Promise.all([loadDepartments(), loadUsers(), loadCheckUsers()]);
  await loadOrgMembers();
});
</script>

<template>
  <div class="user-manage-view page-stack">
    <ChartCard>
      <template #title>
        <div class="page-title">
          <div>
            <h2>员工档案</h2>
            <p>HRM 花名册是组织、人员和任职的唯一依据；钉钉仅用于登录关联和消息通知。</p>
          </div>
          <div class="page-title__actions">
            <el-button type="primary" :icon="UploadFilled" @click="openRosterImportDialog">导入花名册</el-button>
            <el-button :icon="Search" @click="refreshCurrentView">刷新</el-button>
          </div>
        </div>
      </template>

      <div class="view-switch">
        <button :class="{ active: activeView === 'org' }" type="button" @click="activeView = 'org'">
          <el-icon><OfficeBuilding /></el-icon>
          组织任职
        </button>
        <button :class="{ active: activeView === 'users' }" type="button" @click="activeView = 'users'">
          <el-icon><UserFilled /></el-icon>
          员工名册
        </button>
        <button :class="{ active: activeView === 'checks' }" type="button" @click="activeView = 'checks'">
          <el-icon><Warning /></el-icon>
          数据检查
          <span v-if="issueItems.length" class="issue-dot">{{ issueItems.length }}</span>
        </button>
      </div>

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
            @node-click="(data: Department) => onDeptSelect(data.id)"
          >
            <template #default="{ data }">
              <div class="dept-node">
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
              <div v-if="isSystemAdmin" class="dept-summary__actions">
                <el-button type="primary" size="small" @click="openLeaderDialog(selectedDept)">
                  设置组织负责人
                </el-button>
                <el-button plain size="small" @click="openApproverDialog(selectedDept)">
                  指定审批人
                </el-button>
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
              <span class="relation-card__label">组织负责人</span>
              <strong>{{ selectedDept.leaderName || '未设置' }}</strong>
              <small>{{ selectedDept.leaderName ? '负责部门复核与组织范围' : '未设置将影响部门复核' }}</small>
            </div>
            <div class="relation-card">
              <span class="relation-card__label">绩效结果审批人</span>
              <strong>{{ selectedDept.effectiveApproverName || '未推导' }}</strong>
              <small>审批该部门员工经 HR 校准后的绩效结果</small>
            </div>
          </div>

          <div class="approver-trail-card">
            <div class="approver-trail-card__head">
              <strong>审批人来源</strong>
            </div>
            <div class="approver-trail">
              <template v-for="(step, index) in selectedDeptApproverTrail" :key="`${step}-${index}`">
                <span :class="['approver-trail__step', { 'is-final': index === selectedDeptApproverTrail.length - 1 }]">
                  {{ step }}
                </span>
                <el-icon v-if="index < selectedDeptApproverTrail.length - 1" class="approver-trail__arrow">
                  <ArrowRight />
                </el-icon>
              </template>
            </div>
          </div>

          <div class="section-head">
            <h3>部门人员</h3>
            <span>含当前部门及下级部门</span>
          </div>
          <el-table v-loading="orgMemberLoading" :data="orgMembers" row-key="id" class="app-table compact-table">
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
            <el-table-column label="岗位" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">{{ (row as ManagedUser).position || '未设置' }}</template>
            </el-table-column>
            <el-table-column label="系统角色" width="120">
              <template #default="{ row }">{{ roleLabels[(row as ManagedUser).sysRole] }}</template>
            </el-table-column>
            <el-table-column label="直属主管" min-width="130">
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
          <el-select v-model="userQuery.sysRole" placeholder="全部角色" clearable>
            <el-option v-for="opt in sysRoleOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
          <el-button type="primary" @click="onUserQueryChange">查询</el-button>
          <el-button @click="resetUserFilters">重置</el-button>
        </div>

        <el-table v-loading="userLoading" :data="userList" row-key="id" class="app-table compact-table">
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
          <el-table-column label="直属主管" min-width="130">
            <template #default="{ row }">{{ (row as ManagedUser).directManagerName || '未设置' }}</template>
          </el-table-column>
          <el-table-column label="系统角色" width="120">
            <template #default="{ row }">{{ roleLabels[(row as ManagedUser).sysRole] }}</template>
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
              <el-button link type="primary" size="small" :icon="Key" @click="openPasswordDialog(row as ManagedUser)">
                密码
              </el-button>
            </template>
          </el-table-column>
        </el-table>
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

      <section v-else class="checks-view" v-loading="checkLoading || deptLoading">
        <div class="checks-summary">
          <div>
            <h3>员工主数据检查</h3>
            <p>优先处理会影响绩效流程流转的问题。</p>
          </div>
          <strong>{{ issueItems.length }}</strong>
        </div>

        <div v-if="issueItems.length" class="checks-overview">
          <button type="button" class="checks-stat is-danger" @click="issueLevelFilter = 'danger'">
            <span>阻塞项</span>
            <strong>{{ dangerIssueCount }}</strong>
            <small>会影响流程正常启动或流转</small>
          </button>
          <button type="button" class="checks-stat is-warning" @click="issueLevelFilter = 'warning'">
            <span>待补项</span>
            <strong>{{ warningIssueCount }}</strong>
            <small>建议尽快补齐，避免后续人工兜底</small>
          </button>
          <button type="button" class="checks-stat is-info" @click="issueLevelFilter = 'info'">
            <span>提示项</span>
            <strong>{{ infoIssueCount }}</strong>
            <small>不阻塞流程，但建议核对组织完整性</small>
          </button>
        </div>

        <div v-if="issueItems.length" class="checks-filter">
          <span class="checks-filter__label">快速筛选</span>
          <el-radio-group v-model="issueLevelFilter" size="small">
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="danger">阻塞项</el-radio-button>
            <el-radio-button value="warning">待补项</el-radio-button>
            <el-radio-button value="info">提示项</el-radio-button>
          </el-radio-group>
        </div>

        <el-empty v-if="issueItems.length === 0" description="暂无需要处理的组织配置问题" />
        <div v-else class="checks-groups">
          <section class="checks-group">
            <div class="checks-group__head">
              <div>
                <strong>组织问题</strong>
                <p>优先补齐组织负责人和绩效结果审批人的自动继承链。</p>
              </div>
              <el-tag effect="plain" type="primary">{{ filteredDepartmentIssueItems.length }}/{{ departmentIssueItems.length }}</el-tag>
            </div>
            <div v-if="filteredDepartmentIssueItems.length" class="issue-list">
              <button
                v-for="item in filteredDepartmentIssueItems"
                :key="item.key"
                type="button"
                :class="['issue-item', `is-${item.level}`]"
                @click="jumpToIssue(item)"
              >
                <el-tag :type="item.level === 'danger' ? 'danger' : item.level === 'warning' ? 'warning' : 'info'" effect="plain">
                  {{ item.type }}
                </el-tag>
                <div>
                  <strong>{{ item.title }}</strong>
                  <p>{{ item.detail }}</p>
                </div>
                <el-icon><ArrowRight /></el-icon>
              </button>
            </div>
            <el-empty v-else :description="departmentIssueItems.length ? '当前筛选下没有组织问题' : '组织关系已完整'" :image-size="70" />
          </section>

          <section class="checks-group">
            <div class="checks-group__head">
              <div>
                <strong>人员问题</strong>
                <p>检查直属主管、部门归属和离职权限残留。</p>
              </div>
              <el-tag effect="plain">{{ filteredUserIssueItems.length }}/{{ userIssueItems.length }}</el-tag>
            </div>
            <div v-if="filteredUserIssueItems.length" class="issue-list">
              <button
                v-for="item in filteredUserIssueItems"
                :key="item.key"
                type="button"
                :class="['issue-item', `is-${item.level}`]"
                @click="jumpToIssue(item)"
              >
                <el-tag :type="item.level === 'danger' ? 'danger' : item.level === 'warning' ? 'warning' : 'info'" effect="plain">
                  {{ item.type }}
                </el-tag>
                <div>
                  <strong>{{ item.title }}</strong>
                  <p>{{ item.detail }}</p>
                </div>
                <el-icon><ArrowRight /></el-icon>
              </button>
            </div>
            <el-empty v-else :description="userIssueItems.length ? '当前筛选下没有人员问题' : '人员关系已完整'" :image-size="70" />
          </section>
        </div>
      </section>
    </ChartCard>

    <el-drawer
      v-model="employeeArchiveDrawer.visible"
      title="员工档案"
      size="760px"
      class="employee-archive-drawer"
      destroy-on-close
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
          </div>

          <section class="employee-archive__section">
            <div class="section-head">
              <div>
                <h3>当前任职</h3>
                <span>来自 HRM 当前有效任职记录</span>
              </div>
            </div>
            <div class="employee-archive__facts">
              <div><span>所属公司</span><strong>{{ companyLabels[employeeArchiveDrawer.data.currentEmployment?.company || employeeArchiveDrawer.data.employmentHistory[0]?.company || ''] || '待确认' }}</strong></div>
              <div><span>部门</span><strong>{{ employeeArchiveDrawer.data.dept?.fullPath || employeeArchiveDrawer.data.dept?.name || '未设置' }}</strong></div>
              <div><span>岗位</span><strong>{{ employeeArchiveDrawer.data.position || '未设置' }}</strong></div>
              <div><span>直属上级</span><strong>{{ employeeArchiveDrawer.data.directManager?.name || '未设置' }}</strong></div>
              <div><span>入职日期</span><strong>{{ formatDate(employeeArchiveDrawer.data.entryDate) }}</strong></div>
              <div><span>当前状态</span><strong>{{ statusLabels[employeeArchiveDrawer.data.status] }}</strong></div>
            </div>
          </section>

          <section class="employee-archive__section">
            <div class="section-head">
              <div>
                <h3>个人与教育信息</h3>
                <span>默认仅展示普通档案字段，身份证和银行账户不在普通查询中返回</span>
              </div>
            </div>
            <div class="employee-archive__facts">
              <div><span>手机号</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.phone || '未填写' }}</strong></div>
              <div><span>性别</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.gender || '未填写' }}</strong></div>
              <div><span>出生日期</span><strong>{{ formatDate(employeeArchiveDrawer.data.employeeProfile?.birthDate) }}</strong></div>
              <div><span>民族</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.ethnicity || '未填写' }}</strong></div>
              <div><span>学历</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.education || '未填写' }}</strong></div>
              <div><span>毕业院校</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.school || '未填写' }}</strong></div>
              <div><span>专业</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.major || '未填写' }}</strong></div>
              <div><span>职称</span><strong>{{ employeeArchiveDrawer.data.employeeProfile?.professionalTitle || '未填写' }}</strong></div>
            </div>
          </section>

          <section class="employee-archive__section">
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

          <section class="employee-archive__section">
            <div class="section-head">
              <div>
                <h3>任职历史</h3>
                <span>生效区间不重叠，历史记录不会覆盖</span>
              </div>
            </div>
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

          <section class="employee-archive__section">
            <div class="section-head">
              <div>
                <h3>合同记录</h3>
                <span>劳动合同、续签和转签按独立记录保存</span>
              </div>
            </div>
            <el-table v-if="employeeArchiveDrawer.data.employeeContracts.length" :data="employeeArchiveDrawer.data.employeeContracts" size="small" class="app-table">
              <el-table-column label="类型" width="100">
                <template #default="{ row }">{{ contractTypeLabels[row.contractType] || row.contractType }}</template>
              </el-table-column>
              <el-table-column prop="name" label="合同名称" min-width="150" />
              <el-table-column label="签订日期" width="120">
                <template #default="{ row }">{{ formatDate(row.signedAt) }}</template>
              </el-table-column>
              <el-table-column label="到期日期" width="120">
                <template #default="{ row }">{{ formatDate(row.expiresAt) }}</template>
              </el-table-column>
            </el-table>
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
        description="组织、部门、岗位、直属上级和在离职状态均以这份 HRM 花名册为准；不会读取或同步钉钉组织。"
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
          确认写入正式档案
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="personSettingsDialog.visible" title="人员设置" width="520px" :close-on-click-modal="false" destroy-on-close>
      <div class="person-settings__summary">
        <span class="avatar">{{ personSettingsDialog.userName.slice(0, 1) }}</span>
        <div>
          <strong>{{ personSettingsDialog.userName }}</strong>
          <small>{{ personSettingsDialog.deptName }}</small>
        </div>
      </div>
      <el-form label-position="top" class="person-settings__form">
        <el-form-item :label="`${personSettingsDialog.userName}的岗位`">
          <div class="person-settings__readonly">
            {{ personSettingsDialog.position }}
            <small>来自 HRM 当前有效任职记录</small>
          </div>
        </el-form-item>
        <el-form-item label="直属主管">
          <UserSelect
            v-model="personSettingsDialog.directManagerId"
            placeholder="搜索姓名或工号选择直属主管"
            :disabled-ids="[personSettingsDialog.userId]"
          />
        </el-form-item>
        <div v-if="personSettingsDialog.selectedManager" class="person-settings__manager-access">
          <span>{{ personSettingsDialog.selectedManager.name }}的{{ selectedManagerAccessText }}</span>
          <el-tag
            :type="personSettingsDialog.selectedManager.sysRole === 'employee' ? 'warning' : 'success'"
            effect="light"
          >
            {{ personSettingsDialog.selectedManager.sysRole === 'employee' ? '待开通' : '已开通' }}
          </el-tag>
        </div>
        <el-alert
          v-if="selectedManagerNeedsRole"
          type="warning"
          :closable="false"
          show-icon
          :title="`${personSettingsDialog.selectedManager?.name}当前系统角色为员工，没有主管权限`"
          :description="`保存时将把系统角色升级为主管，岗位 ${personSettingsDialog.selectedManager?.position || '保持原值'} 保持不变。`"
          class="person-settings__alert"
        />
        <el-form-item :label="`${personSettingsDialog.userName}的系统角色`">
          <el-select v-if="isSystemAdmin" v-model="personSettingsDialog.sysRole" placeholder="选择系统权限" style="width: 100%">
            <el-option v-for="opt in sysRoleOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
          <div v-else class="person-settings__readonly">
            {{ roleLabels[personSettingsDialog.sysRole] }}
            <small>由系统管理员维护</small>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="personSettingsDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="personSettingsDialog.saving" @click="confirmPersonSettings">保存设置</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="passwordDialog.visible" title="设置登录密码" width="480px" :close-on-click-modal="false" destroy-on-close>
      <p class="dialog-tip">为员工 <strong>{{ passwordDialog.userName }}</strong> 设置登录密码，不少于 6 位。</p>
      <el-input v-model="passwordDialog.password" type="password" placeholder="请输入新密码" show-password />
      <template #footer>
        <el-button @click="passwordDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="confirmPassword">确认</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="leaderDialog.visible" title="设置组织负责人" width="480px" :close-on-click-modal="false" destroy-on-close>
      <p class="dialog-tip">组织负责人负责部门复核与组织范围，也是下级部门绩效结果审批人的默认来源。</p>
      <UserSelect v-model="leaderDialog.leaderId" placeholder="搜索姓名或工号，留空则清空组织负责人" />
      <template #footer>
        <el-button @click="leaderDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="confirmLeader">确认</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="approverDialog.visible" title="指定绩效结果审批人" width="480px" :close-on-click-modal="false" destroy-on-close>
      <p class="dialog-tip">系统默认从上级组织负责人自动推导。仅在跨组织等特殊场景中，为 <strong>{{ approverDialog.deptName }}</strong> 手动指定；清空后恢复自动推导。</p>
      <UserSelect v-model="approverDialog.approverId" placeholder="搜索姓名或工号，留空则恢复自动继承" />
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

.employee-archive__section {
  padding: 22px 0;
  border-bottom: 1px solid #e8edf5;
}

.employee-archive__section:last-child {
  border-bottom: 0;
}

.employee-archive__section .section-head {
  margin-bottom: 14px;
}

.employee-archive__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
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
  padding: 14px;
  margin-bottom: 16px;
  border: 1px solid #e8edf5;
  border-radius: 8px;
  background: #fbfcff;
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

.person-cell small {
  margin-top: 2px;
  color: #8a94a6;
}

.approver-trail-card {
  padding: 14px;
  margin-bottom: 16px;
  border: 1px solid #e6ecf7;
  border-radius: 8px;
  background: linear-gradient(180deg, #fbfcff 0%, #f7faff 100%);
}

.approver-trail-card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.approver-trail-card__head strong {
  color: #1f2a44;
  font-size: 15px;
}

.approver-trail {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.approver-trail__step {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid #dfe7f7;
  border-radius: 999px;
  background: #fff;
  color: #52627a;
  font-size: 13px;
}

.approver-trail__step.is-final {
  border-color: #cfdcff;
  background: #edf3ff;
  color: #2f63ff;
  font-weight: 600;
}

.approver-trail__arrow {
  color: #a8b2c5;
}

.table-pagination {
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

.person-settings__summary strong,
.person-settings__summary small {
  display: block;
}

.person-settings__summary small {
  margin-top: 4px;
  color: #8993a6;
}

.person-settings__form {
  margin-top: 18px;
}

.person-settings__alert {
  margin: -2px 0 18px;
}

.person-settings__manager-access {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: -4px 0 16px;
  color: #52627a;
  font-size: 13px;
}

.person-settings__readonly {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 32px;
  color: #344054;
}

.person-settings__readonly small {
  color: #98a1b3;
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
