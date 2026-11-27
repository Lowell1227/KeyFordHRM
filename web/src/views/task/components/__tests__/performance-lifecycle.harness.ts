import { createApp, h } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '@/styles/theme.css';
import { useAuthStore } from '@/stores/auth.store';
import GoalPlanList from '../GoalPlanList.vue';
import GoalMonitorDetail from '../GoalMonitorDetail.vue';
import TaskDetailView from '../../TaskDetailView.vue';
import GoalChangeListView from '@/views/goal-changes/GoalChangeListView.vue';
import GoalChangeDetailView from '@/views/goal-changes/GoalChangeDetailView.vue';
import ImprovementPlanListView from '@/views/improvement-plans/ImprovementPlanListView.vue';
import ImprovementPlanDetailView from '@/views/improvement-plans/ImprovementPlanDetailView.vue';
import ConfirmationManageView from '@/views/confirmation/ConfirmationManageView.vue';
import ConfirmationMineView from '@/views/confirmation/ConfirmationMineView.vue';
import ConfirmationDetailView from '@/views/confirmation/ConfirmationDetailView.vue';

const pinia = createPinia(), auth = useAuthStore(pinia);
const viewer = new URLSearchParams(location.search).get('role') === 'viewer';
const lifecycleViewer = new URLSearchParams(location.search).get('role') === 'lifecycle-viewer';
auth.token = 'fictional-lifecycle-component';
auth.user = { id: 'fictional-manager', name: '虚构管理人员', sysRole: viewer ? 'employee' : lifecycleViewer ? 'hr_user' : 'hr',
  hrCapabilities: viewer ? [] : lifecycleViewer ? ['performance_lifecycle_view'] : ['confirmation_manage', 'performance_lifecycle_view', 'performance_lifecycle_terminate', 'performance_lifecycle_delete'],
} as typeof auth.user;
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/tasks', component: GoalPlanList, props: { scope: 'monitor', allowed: true } },
  { path: '/tasks/:id', name: 'TaskDetail', component: new URLSearchParams(location.search).has('direct') ? TaskDetailView : GoalMonitorDetail },
  { path: '/goal-changes', name: 'GoalChanges', component: GoalChangeListView,
    children: [{ path: ':id', name: 'GoalChangeDetail', component: GoalChangeDetailView }] },
  { path: '/improvement-plans', name: 'ImprovementPlans', component: ImprovementPlanListView,
    children: [{ path: ':id', name: 'ImprovementPlanDetail', component: ImprovementPlanDetailView, props: { embedded: true } }] },
  { path: '/confirmation-manage', name: 'ConfirmationManage', component: ConfirmationManageView,
    children: [{ path: ':id', name: 'ConfirmationManageDetail', component: ConfirmationDetailView, props: { embedded: true } }] },
  { path: '/confirmation-mine', name: 'ConfirmationMine', component: ConfirmationMineView,
    children: [{ path: ':id', name: 'ConfirmationMineDetail', component: ConfirmationDetailView, props: { embedded: true } }] },
] });
await router.push(new URLSearchParams(location.search).get('path') || '/tasks');
createApp({ render: () => h(RouterView) }).use(pinia).use(router).use(ElementPlus).mount('#app');
