import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth.store';

/**
 * 路由骨架。MVP 完整路由表（团队/管理后台/校准/审批/报表等）在前端实现阶段
 * 按 04_前端设计文档第二节补全；此处先保证登录 + 首页可跑通。
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/auth/LoginView.vue'),
    meta: { layout: 'auth', public: true, title: '登录' },
  },
  {
    path: '/auth/callback',
    name: 'AuthCallback',
    component: () => import('@/views/auth/DingTalkCallbackView.vue'),
    meta: { layout: 'auth', public: true, title: '登录中' },
  },
  { path: '/', redirect: '/dashboard' },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('@/views/dashboard/DashboardView.vue'),
    meta: { requiresAuth: true, title: '首页' },
  },
  // 周期管理（B4-1）
  {
    path: '/cycles',
    name: 'Cycles',
    component: () => import('@/views/admin/CycleManageView.vue'),
    meta: { requiresAuth: true, title: '考核周期', roles: ['hr', 'system_admin'] },
  },
  {
    path: '/templates',
    name: 'Templates',
    component: () => import('@/views/admin/TemplateManageView.vue'),
    meta: { requiresAuth: true, title: '考核模板', roles: ['hr', 'system_admin'] },
  },
  {
    path: '/indicators',
    name: 'IndicatorLibrary',
    component: () => import('@/views/admin/IndicatorLibraryView.vue'),
    meta: { requiresAuth: true, title: '指标库', roles: ['hr', 'system_admin'] },
  },
  {
    path: '/calibration',
    name: 'Calibration',
    component: () => import('@/views/calibration/CalibrationView.vue'),
    meta: { requiresAuth: true, title: '绩效校准', roles: ['hr', 'system_admin'] },
  },
  {
    path: '/appeals',
    name: 'Appeals',
    component: () => import('@/views/appeals/AppealsView.vue'),
    meta: { requiresAuth: true, title: '申诉计划', roles: ['hr', 'system_admin'] },
  },
  {
    path: '/publish',
    name: 'Publish',
    component: () => import('@/views/publish/PublishView.vue'),
    meta: { requiresAuth: true, title: '结果公示', roles: ['hr', 'system_admin'] },
  },
  {
    path: '/approval',
    name: 'Approval',
    component: () => import('@/views/approval/ApprovalView.vue'),
    meta: {
      requiresAuth: true,
      title: '结果审批',
      roles: ['vp', 'chairman', 'system_admin'],
    },
  },
  {
    path: '/reports',
    name: 'Reports',
    component: () => import('@/views/reports/ReportsView.vue'),
    meta: {
      requiresAuth: true,
      title: '报表分析',
      roles: ['hr', 'system_admin', 'vp', 'chairman'],
    },
  },
  {
    path: '/users',
    name: 'Users',
    component: () => import('@/views/admin/UserManageView.vue'),
    meta: { requiresAuth: true, title: '用户管理', roles: ['hr', 'system_admin'] },
  },
  {
    path: '/manager/scoring',
    name: 'ManagerScoring',
    component: () => import('@/views/manager/ManagerScoringView.vue'),
    meta: {
      requiresAuth: true,
      title: '团队绩效',
      roles: ['manager', 'dept_head', 'vp', 'hr', 'system_admin'],
    },
  },
  {
    path: '/interviews',
    name: 'Interviews',
    component: () => import('@/views/interview/InterviewListView.vue'),
    meta: {
      requiresAuth: true,
      title: '绩效面谈',
      roles: ['manager', 'dept_head', 'vp', 'hr', 'system_admin'],
    },
  },
  {
    path: '/tasks',
    name: 'MyTasks',
    component: () => import('@/views/task/TaskListView.vue'),
    meta: { requiresAuth: true, title: '绩效考核' },
  },
  {
    path: '/tasks/:id',
    name: 'TaskDetail',
    component: () => import('@/views/task/TaskDetailView.vue'),
    meta: { requiresAuth: true, title: '任务详情' },
  },
  {
    path: '/improvement-plans',
    name: 'ImprovementPlans',
    component: () => import('@/views/improvement-plans/ImprovementPlanListView.vue'),
    meta: { requiresAuth: true, title: '绩效改进计划' },
  },
  {
    path: '/improvement-plans/:id',
    name: 'ImprovementPlanDetail',
    component: () => import('@/views/improvement-plans/ImprovementPlanDetailView.vue'),
    meta: { requiresAuth: true, title: '改进计划详情' },
  },
  // 试用期考核（D1）
  {
    path: '/probation-reviews/manage',
    name: 'ProbationManage',
    component: () => import('@/views/probation/ProbationManageView.vue'),
    meta: { requiresAuth: true, title: '试用期考核管理', roles: ['hr', 'system_admin'] },
  },
  {
    path: '/probation-reviews/manager',
    name: 'ProbationManager',
    component: () => import('@/views/probation/ProbationManagerView.vue'),
    meta: {
      requiresAuth: true,
      title: '试用期评分',
      roles: ['manager', 'dept_head', 'vp', 'hr', 'system_admin'],
    },
  },
  {
    path: '/probation-reviews/mine',
    name: 'ProbationMine',
    component: () => import('@/views/probation/ProbationMineView.vue'),
    meta: { requiresAuth: true, title: '我的试用期考核' },
  },
  {
    path: '/probation-reviews/:id',
    name: 'ProbationDetail',
    component: () => import('@/views/probation/ProbationDetailView.vue'),
    meta: { requiresAuth: true, title: '试用期考核详情' },
  },
  // 转正申请（D2）
  {
    path: '/confirmation-applications/manage',
    name: 'ConfirmationManage',
    component: () => import('@/views/confirmation/ConfirmationManageView.vue'),
    meta: { requiresAuth: true, title: '转正申请管理', roles: ['hr', 'system_admin'] },
  },
  {
    path: '/confirmation-applications/approvals',
    name: 'ConfirmationApprovals',
    component: () => import('@/views/confirmation/ConfirmationApprovalView.vue'),
    meta: {
      requiresAuth: true,
      title: '转正审批台',
      roles: ['manager', 'dept_head', 'vp', 'hr', 'chairman', 'system_admin'],
    },
  },
  {
    path: '/confirmation-applications/mine',
    name: 'ConfirmationMine',
    component: () => import('@/views/confirmation/ConfirmationMineView.vue'),
    meta: { requiresAuth: true, title: '我的转正申请' },
  },
  {
    path: '/confirmation-applications/:id',
    name: 'ConfirmationDetail',
    component: () => import('@/views/confirmation/ConfirmationDetailView.vue'),
    meta: { requiresAuth: true, title: '转正申请详情' },
  },
  // 目标地图（E1）—— 管理者+可见，对 employee 隐藏
  {
    path: '/objectives',
    name: 'ObjectiveMap',
    component: () => import('@/views/objectives/ObjectiveMapView.vue'),
    meta: {
      requiresAuth: true,
      title: '目标地图',
      roles: ['manager', 'dept_head', 'vp', 'hr', 'chairman', 'system_admin'],
    },
  },
  // 行动计划（E2）—— 管理者+可见，对 employee 隐藏
  {
    path: '/action-items',
    name: 'ActionItems',
    component: () => import('@/views/objectives/ActionItemsView.vue'),
    meta: {
      requiresAuth: true,
      title: '行动计划',
      roles: ['manager', 'dept_head', 'vp', 'hr', 'chairman', 'system_admin'],
    },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { layout: 'auth', public: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.meta.public) return true;

  // 本地 token 已过期：直接清登录态并跳登录，避免发无谓请求。
  if (auth.tokenExpired) {
    auth.logout();
    return { name: 'Login', query: { redirect: to.fullPath } };
  }

  // token 存在但 user 未加载时，先 hydration。
  if (auth.isLoggedIn && !auth.user) {
    const ok = await auth.ensureLoaded();
    if (!ok) return { name: 'Login', query: { redirect: to.fullPath } };
  }

  if (!auth.isLoggedIn) return { name: 'Login', query: { redirect: to.fullPath } };

  const requiredRoles = to.meta.roles as string[] | undefined;
  if (requiredRoles && auth.user && !requiredRoles.includes(auth.user.sysRole)) {
    ElMessage.warning('无权访问该页面');
    return { name: 'Dashboard' };
  }
  return true;
});

export default router;
