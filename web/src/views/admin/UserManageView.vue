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

const issueItems = computed(() => {
  const departmentIssues = flattenedDepartments.value.flatMap((dept) => {
    const items: Array<{ key: string; type: '部门'; title: string; detail: string; level: 'warning' | 'danger' | 'info' }> = [];
    if (!dept.leaderId) {
      items.push({
        key: `${dept.id}-leader`,
        type: '部门',
        title: `${dept.name} 未设置组织负责人`,
        detail: '组织负责人就是原来的部门负责人，负责部门管理、绩效复核和管理范围归属。',
        level: 'warning',
      });
    }
    if (!dept.approverId) {
      items.push({
        key: `${dept.id}-approver`,
        type: '部门',
        title: `${dept.name} 未设置流程审批人`,
        detail: '流程审批人就是原来的部门审批人，绩效流程进入审批节点时会找这个人处理。',
        level: 'danger',
      });
    }
    if ((dept.memberCount ?? 0) === 0 && !dept.children?.length) {
      items.push({
        key: `${dept.id}-empty`,
        type: '部门',
        title: `${dept.name} 暂无在职人员`,
        detail: '如果是临时部门可以保留，否则建议检查钉钉同步或人员归属。',
        level: 'info',
      });
    }
    return items;
  });

  const userIssues = checkUsers.value.flatMap((user) => {
    const items: Array<{ key: string; type: '人员'; title: string; detail: string; level: 'warning' | 'danger' | 'info' }> = [];
    if (user.status !== 'resigned' && !user.directManagerId) {
      items.push({
        key: `${user.id}-manager`,
        type: '人员',
        title: `${user.name} 未设置直属主管`,
        detail: `${user.deptName || '未分配部门'} · ${user.position || '岗位待补充'}`,
        level: 'warning',
      });
    }
    if (!user.deptId && user.status !== 'resigned') {
      items.push({
        key: `${user.id}-dept`,
        type: '人员',
        title: `${user.name} 未分配部门`,
        detail: '绩效模板匹配和部门统计都依赖部门归属。',
        level: 'danger',
      });
    }
    if (user.status === 'resigned' && !['employee'].includes(user.sysRole)) {
      items.push({
        key: `${user.id}-role`,
        type: '人员',
        title: `${user.name} 已离职但仍保留 ${roleLabels[user.sysRole] ?? user.sysRole} 角色`,
        detail: '建议确认是否需要清理系统权限。',
        level: 'warning',
      });
    }
    return items;
  });

  return [...departmentIssues, ...userIssues];
});

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
    ElMessage.success('流程审批人已更新');
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
            <p>按组织查看人员、维护主管和审批人，先把绩效流程的责任关系理清楚。</p>
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
                <span>{{ data.name }}</span>
                <em>{{ data.memberCount ?? 0 }}</em>
              </div>
            </template>
          </el-tree>
        </aside>

        <main class="org-detail" v-if="selectedDept">
          <div class="dept-summary">
            <div>
              <span class="eyebrow">当前部门</span>
              <h3>{{ selectedDept.name }}</h3>
            </div>
            <div class="dept-summary__side">
              <span class="dept-path">{{ selectedDept.fullPath || '未维护完整路径' }}</span>
              <el-button
                v-if="isSystemAdmin"
                type="primary"
                plain
                size="small"
                @click="openApproverDialog(selectedDept)"
              >
                设置审批人
              </el-button>
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
                  <p class="help-popover-text">管这个部门的人，负责部门日常管理、部门复核和统计范围归属。可以和流程审批人是同一个人。</p>
                  <template #reference>
                    <el-icon class="inline-help"><QuestionFilled /></el-icon>
                  </template>
                </el-popover>
              </div>
              <strong>{{ selectedDept.leaderName || '未设置' }}</strong>
            </div>
            <div class="relation-card">
              <div class="relation-card__label">
                <span>流程审批人</span>
                <el-popover trigger="click" placement="top" width="270">
                  <p class="help-popover-text">绩效流程走到审批节点时处理的人。可以与组织负责人相同，也可以设置为更高层审批人。</p>
                  <template #reference>
                    <el-icon class="inline-help"><QuestionFilled /></el-icon>
                  </template>
                </el-popover>
              </div>
              <strong>{{ selectedDept.approverName || '未设置' }}</strong>
            </div>
          </div>

          <el-collapse class="relation-guide">
            <el-collapse-item name="role-guide">
              <template #title>
                <div class="relation-guide__title">
                  <strong>角色关系说明</strong>
                  <span>直属主管、组织负责人、流程审批人分别管人、管部门、管审批节点</span>
                </div>
              </template>
              <div class="relation-guide__items">
                <div>
                  <b>直属主管 = 管某个人</b>
                  <span>员工表里每个人都有自己的直属主管。员工评分、自评确认、主管评分时，主要找这个人。</span>
                </div>
                <div>
                  <b>组织负责人 = 管这个部门</b>
                  <span>部门负责人代表这个部门的管理责任。部门复核、部门统计、管理范围通常看这个人。</span>
                </div>
                <div>
                  <b>流程审批人 = 管审批节点</b>
                  <span>绩效流程走到审批节点时才找这个人。可以和组织负责人是同一个人，也可以另设更高层审批人。</span>
                </div>
              </div>
              <div class="relation-guide__example">
                例：创意设计部员工先由直属主管评分，再由组织负责人做部门复核；如果流程进入审批节点，则交给流程审批人处理。
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

        <el-empty v-if="issueItems.length === 0" description="暂无需要处理的组织配置问题" />
        <div v-else class="issue-list">
          <div v-for="item in issueItems" :key="item.key" :class="['issue-item', `is-${item.level}`]">
            <el-tag :type="item.level === 'danger' ? 'danger' : item.level === 'warning' ? 'warning' : 'info'" effect="plain">
              {{ item.type }}
            </el-tag>
            <div>
              <strong>{{ item.title }}</strong>
              <p>{{ item.detail }}</p>
            </div>
            <el-icon><ArrowRight /></el-icon>
          </div>
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

    <el-dialog v-model="approverDialog.visible" title="设置流程审批人" width="480px" :close-on-click-modal="false" destroy-on-close>
      <p class="dialog-tip">为部门 <strong>{{ approverDialog.deptName }}</strong> 指定绩效流程审批人。</p>
      <UserSelect v-model="approverDialog.approverId" placeholder="搜索姓名或工号选择审批人" />
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
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 8px;
  padding-right: 8px;
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
