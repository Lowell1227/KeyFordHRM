<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import {
  ArrowRight,
  Key,
  OfficeBuilding,
  QuestionFilled,
  Search,
  Setting,
  User as UserIcon,
  UserFilled,
  Warning,
} from '@element-plus/icons-vue';
import { departmentsApi } from '@/api/departments.api';
import { usersApi } from '@/api/users.api';
import ChartCard from '@/components/common/ChartCard.vue';
import UserSelect from '@/components/common/UserSelect.vue';
import { useAuthStore } from '@/stores/auth.store';
import type { Department, User as ManagedUser, UserQuery } from '@/types/api.types';
import type { SysRole, UserStatus } from '@/types/enums';

const auth = useAuthStore();

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
const selectedDeptApproverHint = computed(() => getApproverHint(selectedDept.value));
const selectedDeptApproverTag = computed(() => getApproverTag(selectedDept.value));
const selectedDeptApproverSource = computed(() => getApproverSource(selectedDept.value));
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
        title: `${dept.name} 暂未推导出审批责任人`,
        detail: '这个部门当前已有在职员工，但还没有形成可用审批继承链。请先补齐上级负责人，必要时再做审批覆盖。',
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
        detail: '如果是临时部门可以保留，否则建议检查钉钉同步或人员归属。',
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

function getApproverTag(dept: Department | null): string {
  if (!dept?.effectiveApproverId) return '未推导';
  switch (dept.effectiveApproverSource) {
    case 'manual_override':
      return '手动覆盖';
    case 'parent_leader':
      return '上级负责人';
    case 'ancestor_chain':
      return '逐级继承';
    default:
      return '自动推导';
  }
}

function getApproverHint(dept: Department | null): string {
  if (!dept?.effectiveApproverId) {
    return '未找到可继承的审批责任人，请补齐上级组织负责人或使用高级覆盖。';
  }

  if (dept.effectiveApproverSource === 'manual_override') {
    return '当前使用手动指定的审批覆盖人，适合特殊审批链。';
  }

  if (dept.effectiveApproverSource === 'parent_leader') {
    return `默认继承自上一级部门负责人${dept.effectiveApproverDeptName ? `：${dept.effectiveApproverDeptName}` : ''}。`;
  }

  if (dept.effectiveApproverSource === 'ancestor_chain') {
    return `当前由上层组织负责人逐级继承${dept.effectiveApproverDeptName ? `，来源：${dept.effectiveApproverDeptName}` : ''}。`;
  }

  return '审批责任人会按组织层级自动推导。';
}

function getApproverSource(dept: Department | null): string {
  if (!dept?.effectiveApproverId) return '来源：未推导';
  if (dept.effectiveApproverSource === 'manual_override') return '来源：手动审批覆盖';
  if (dept.effectiveApproverDeptName) return `来源：${dept.effectiveApproverDeptName}`;
  if (dept.effectiveApproverSource === 'parent_leader') return '来源：上一级组织负责人';
  if (dept.effectiveApproverSource === 'ancestor_chain') return '来源：上层组织逐级继承';
  return '来源：自动推导';
}

function getApproverTrail(dept: Department | null): string[] {
  if (!dept) return [];
  if (!dept.effectiveApproverId) {
    return [dept.name, '未找到可继承的审批责任人'];
  }

  if (dept.effectiveApproverSource === 'manual_override') {
    return [dept.name, '手动审批覆盖', dept.effectiveApproverName || '已指定审批责任人'];
  }

  if (dept.effectiveApproverDeptName) {
    return [dept.name, dept.effectiveApproverDeptName, dept.effectiveApproverName || '审批责任人'];
  }

  if (dept.effectiveApproverSource === 'parent_leader') {
    return [dept.name, '上一级组织负责人', dept.effectiveApproverName || '审批责任人'];
  }

  if (dept.effectiveApproverSource === 'ancestor_chain') {
    return [dept.name, '上层组织逐级继承', dept.effectiveApproverName || '审批责任人'];
  }

  return [dept.name, dept.effectiveApproverName || '审批责任人'];
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

const managerDialog = ref({
  visible: false,
  userId: '',
  userName: '',
  directManagerId: undefined as string | undefined,
});

function openManagerDialog(row: ManagedUser) {
  managerDialog.value = {
    visible: true,
    userId: row.id,
    userName: row.name,
    directManagerId: row.directManagerId ?? undefined,
  };
}

async function confirmManager() {
  if (!managerDialog.value.userId) return;
  try {
    await usersApi.updateManager(managerDialog.value.userId, {
      directManagerId: managerDialog.value.directManagerId ?? null,
    });
    ElMessage.success('直属主管已更新');
    managerDialog.value.visible = false;
    await Promise.all([loadUsers(), loadOrgMembers(), loadCheckUsers()]);
  } catch {
    // 由 HTTP 拦截器展示错误
  }
}

const roleDialog = ref({
  visible: false,
  userId: '',
  userName: '',
  sysRole: '' as SysRole,
});

function openRoleDialog(row: ManagedUser) {
  roleDialog.value = {
    visible: true,
    userId: row.id,
    userName: row.name,
    sysRole: row.sysRole,
  };
}

async function confirmRole() {
  if (!roleDialog.value.userId) return;
  try {
    await usersApi.updateRole(roleDialog.value.userId, {
      sysRole: roleDialog.value.sysRole,
    });
    ElMessage.success('系统角色已更新');
    roleDialog.value.visible = false;
    await Promise.all([loadUsers(), loadCheckUsers()]);
  } catch {
    // 由 HTTP 拦截器展示错误
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
    ElMessage.success('审批覆盖已更新');
    approverDialog.value.visible = false;
    await Promise.all([loadDepartments(), loadCheckUsers()]);
  } catch {
    // 由 HTTP 拦截器展示错误
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
            <h2>组织与人员</h2>
            <p>这里先把直属主管和组织负责人维护清楚，审批责任人会按组织层级自动继承，特殊情况再做高级覆盖。</p>
          </div>
          <el-button :icon="Search" @click="refreshCurrentView">刷新</el-button>
        </div>
      </template>

      <div class="view-switch">
        <button :class="{ active: activeView === 'org' }" type="button" @click="activeView = 'org'">
          <el-icon><OfficeBuilding /></el-icon>
          组织视图
        </button>
        <button :class="{ active: activeView === 'users' }" type="button" @click="activeView = 'users'">
          <el-icon><UserFilled /></el-icon>
          人员名册
        </button>
        <button :class="{ active: activeView === 'checks' }" type="button" @click="activeView = 'checks'">
          <el-icon><Warning /></el-icon>
          配置检查
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
                  设置负责人
                </el-button>
                <el-button plain size="small" @click="openApproverDialog(selectedDept)">
                  高级设置
                </el-button>
              </div>
            </div>
          </div>

          <div class="relation-grid">
            <div class="relation-card">
              <div class="relation-card__label">
                <span>部门人数</span>
                <el-popover trigger="click" placement="top" width="240">
                  <p class="help-popover-text">含当前部门及所有下级部门的在职人数，用来判断这个组织范围内实际有多少人参与绩效。</p>
                  <template #reference>
                    <el-icon class="inline-help"><QuestionFilled /></el-icon>
                  </template>
                </el-popover>
              </div>
              <strong>{{ orgMemberTotal }} 人</strong>
            </div>
            <div class="relation-card">
              <div class="relation-card__label">
                <span>下级部门</span>
                <el-popover trigger="click" placement="top" width="240">
                  <p class="help-popover-text">当前部门下面直接挂靠的部门数量，用来检查组织架构层级是否完整。</p>
                  <template #reference>
                    <el-icon class="inline-help"><QuestionFilled /></el-icon>
                  </template>
                </el-popover>
              </div>
              <strong>{{ childDeptCount }} 个</strong>
            </div>
            <div class="relation-card">
              <div class="relation-card__label">
                <span>组织负责人</span>
                <el-popover trigger="click" placement="top" width="260">
                  <p class="help-popover-text">这是部门这条线的主数据，负责部门管理、部门复核和组织范围归属，也是审批链自动继承的重要来源。</p>
                  <template #reference>
                    <el-icon class="inline-help"><QuestionFilled /></el-icon>
                  </template>
                </el-popover>
              </div>
              <strong>{{ selectedDept.leaderName || '未设置' }}</strong>
              <small class="relation-card__hint">
                {{ selectedDept.leaderName ? '这是当前部门的主负责人，会作为下级部门审批链的默认继承来源。' : '请先为当前部门设置组织负责人，审批责任人才会更稳定地自动继承。' }}
              </small>
            </div>
            <div class="relation-card">
              <div class="relation-card__label">
                <span>审批责任人</span>
                <el-popover trigger="click" placement="top" width="300">
                  <p class="help-popover-text">默认自动继承上一级组织负责人。只有遇到跨组织审批、特殊签批链时，才需要单独设置审批覆盖。</p>
                  <template #reference>
                    <el-icon class="inline-help"><QuestionFilled /></el-icon>
                  </template>
                </el-popover>
              </div>
              <strong>{{ selectedDept.effectiveApproverName || '未推导' }}</strong>
              <small class="relation-card__hint">{{ selectedDeptApproverTag }} · {{ selectedDeptApproverHint }}</small>
              <small class="relation-card__subhint">{{ selectedDeptApproverSource }}</small>
            </div>
          </div>

          <div class="approver-trail-card">
            <div class="approver-trail-card__head">
              <strong>审批继承路径</strong>
              <span>让当前部门一眼看清责任人是从哪里带出来的</span>
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

          <el-collapse class="relation-guide">
            <el-collapse-item name="role-guide">
              <template #title>
                <div class="relation-guide__title">
                  <strong>关系说明</strong>
                  <span>主数据只维护直属主管和组织负责人，审批责任人默认自动继承，特殊场景再做覆盖。</span>
                </div>
              </template>
              <div class="relation-guide__items">
                <div>
                  <b>直属主管 = 管人</b>
                  <span>员工确认、自评、主管评分这些与“人”相关的环节，都按直属主管来走。</span>
                </div>
                <div>
                  <b>组织负责人 = 管部门</b>
                  <span>部门复核、组织归属、统计口径这些与“部门”相关的环节，都以组织负责人为准。</span>
                </div>
                <div>
                  <b>审批责任人 = 自动继承</b>
                  <span>流程进入审批节点时，默认继承上一级组织负责人。只有特殊审批链，才需要手动设置审批覆盖。</span>
                </div>
              </div>
              <div class="relation-guide__example">
                例：设计部员工先由直属主管处理与评分，再由设计部组织负责人复核；如果流程继续上收审批，则自动交给上一级组织负责人处理。
              </div>
            </el-collapse-item>
          </el-collapse>

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
            <el-table-column prop="position" label="岗位" min-width="140" show-overflow-tooltip />
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
            <el-table-column label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openManagerDialog(row as ManagedUser)">设主管</el-button>
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
          <el-table-column prop="position" label="岗位" min-width="140" show-overflow-tooltip />
          <el-table-column label="直属主管" min-width="130">
            <template #default="{ row }">{{ (row as ManagedUser).directManagerName || '未设置' }}</template>
          </el-table-column>
          <el-table-column label="角色" width="120">
            <template #default="{ row }">{{ roleLabels[(row as ManagedUser).sysRole] }}</template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="statusTagType[(row as ManagedUser).status]" size="small">
                {{ statusLabels[(row as ManagedUser).status] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="240" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" :icon="UserIcon" @click="openManagerDialog(row as ManagedUser)">
                主管
              </el-button>
              <el-button
                v-if="isSystemAdmin"
                link
                type="primary"
                size="small"
                :icon="Setting"
                @click="openRoleDialog(row as ManagedUser)"
              >
                角色
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
            <h3>配置检查</h3>
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
                <p>优先补齐组织负责人和审批责任继承链。</p>
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

    <el-dialog v-model="managerDialog.visible" title="设置直属主管" width="480px" :close-on-click-modal="false" destroy-on-close>
      <p class="dialog-tip">为员工 <strong>{{ managerDialog.userName }}</strong> 指定直属主管。</p>
      <UserSelect
        v-model="managerDialog.directManagerId"
        placeholder="搜索姓名或工号选择直属主管"
        :disabled-ids="[managerDialog.userId]"
      />
      <template #footer>
        <el-button @click="managerDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="confirmManager">确认</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="roleDialog.visible" title="设置系统角色" width="480px" :close-on-click-modal="false" destroy-on-close>
      <p class="dialog-tip">为员工 <strong>{{ roleDialog.userName }}</strong> 设置系统角色。</p>
      <el-select v-model="roleDialog.sysRole" placeholder="选择角色" style="width: 100%">
        <el-option v-for="opt in sysRoleOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
      </el-select>
      <template #footer>
        <el-button @click="roleDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="confirmRole">确认</el-button>
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
      <p class="dialog-tip">部门 <strong>{{ leaderDialog.deptName }}</strong> 的负责人会参与部门管理，也会作为下级部门审批责任人的默认继承来源。</p>
      <UserSelect v-model="leaderDialog.leaderId" placeholder="搜索姓名或工号，留空则清空组织负责人" />
      <template #footer>
        <el-button @click="leaderDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="confirmLeader">确认</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="approverDialog.visible" title="审批覆盖（高级）" width="480px" :close-on-click-modal="false" destroy-on-close>
      <p class="dialog-tip">部门 <strong>{{ approverDialog.deptName }}</strong> 默认会自动继承上一级组织负责人。只有特殊场景，才需要在这里单独指定审批覆盖人。</p>
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
  min-height: 560px;
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
  gap: 12px;
  margin-bottom: 14px;
}

.relation-card {
  padding: 14px;
  border: 1px solid #edf1f7;
  border-radius: 8px;
  background: #fafcff;
}

.relation-card__label,
.relation-card small {
  display: block;
  color: #8993a6;
  font-size: 12px;
}

.relation-card__label {
  display: flex;
  align-items: center;
  gap: 4px;
}

.inline-help {
  color: #a4afc2;
  font-size: 14px;
  cursor: pointer;
  transition: color 0.2s ease;
}

.inline-help:hover {
  color: #5f75ff;
}

.help-popover-text {
  margin: 0;
  color: #52627a;
  font-size: 13px;
  line-height: 1.6;
}

.relation-card strong {
  display: block;
  margin: 8px 0 4px;
  color: #1f2a44;
  font-size: 18px;
}

.relation-guide {
  margin-bottom: 18px;
  border: 1px solid #e6ecf7;
  border-radius: 8px;
  background: #f8fbff;
  overflow: hidden;
}

.relation-guide :deep(.el-collapse-item__header) {
  min-height: 46px;
  height: auto;
  padding: 0 14px;
  border-bottom: 0;
  background: #f8fbff;
}

.relation-guide :deep(.el-collapse-item__wrap) {
  border-bottom: 0;
  background: #f8fbff;
}

.relation-guide :deep(.el-collapse-item__content) {
  padding: 0 14px 14px;
}

.relation-guide__title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  margin-bottom: 0;
}

.relation-guide__title strong {
  color: #1f2a44;
  font-size: 15px;
}

.relation-guide__title span,
.relation-guide__items span,
.relation-guide__example {
  color: #758097;
  font-size: 13px;
  line-height: 1.6;
}

.relation-guide__items {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.relation-guide__items div {
  padding: 10px 12px;
  border-left: 3px solid #6a83ff;
  border-radius: 6px;
  background: #fff;
}

.relation-guide__items b,
.relation-guide__items span {
  display: block;
}

.relation-guide__items b {
  margin-bottom: 5px;
  color: #1f2a44;
}

.relation-guide__example {
  margin-top: 12px;
  padding: 9px 12px;
  border-radius: 6px;
  background: #eef4ff;
  color: #52627a;
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

.relation-card__hint {
  display: block;
  margin-top: 8px;
  color: #7b8497;
  font-size: 12px;
  line-height: 1.5;
}

.relation-card__subhint {
  display: block;
  margin-top: 4px;
  color: #98a1b3;
  font-size: 12px;
  line-height: 1.4;
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

.approver-trail-card__head span {
  color: #7b8497;
  font-size: 12px;
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

@media (max-width: 1200px) {
  .org-layout {
    grid-template-columns: 1fr;
  }

  .org-tree-panel {
    min-height: auto;
  }

  .relation-grid,
  .relation-guide__items {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .light-filter {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .checks-overview {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .page-title,
  .dept-summary {
    flex-direction: column;
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
  .relation-guide__items,
  .light-filter {
    grid-template-columns: 1fr;
  }
}
</style>
