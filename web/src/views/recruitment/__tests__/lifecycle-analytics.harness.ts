import { createApp, h, ref } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import { useAuthStore } from '@/stores/auth.store';
import type { CurrentUser } from '@/types/api.types';
import RecruitmentDemandLifecycle from '../components/RecruitmentDemandLifecycle.vue';
import RecruitmentChannelAnalysis from '../components/RecruitmentChannelAnalysis.vue';

const pinia = createPinia();
const query = new URLSearchParams(location.search);
const auth = useAuthStore(pinia);
auth.user = { id: 'fictional-ui-operator', name: '虚构招聘经办', sysRole: 'employee', isAssessorOnly: false,
  hrCapabilities: [query.get('role') === 'viewer' ? 'recruitment_view' : query.get('role') === 'narrow' ? 'talent_hiring_confirm' : 'recruitment_edit'],
} as CurrentUser;
auth.token = 'fictional-component-test';
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] });
const component = query.get('component') === 'analysis' ? RecruitmentChannelAnalysis : RecruitmentDemandLifecycle;
const revision = ref(4), updates = ref(0);
addEventListener('test-parent-revision', () => { revision.value++; });
createApp({ render: () => h('div', [h('span', `父页已刷新 ${updates.value}`),
  h(component, { demandId: 'fictional-demand', revision: revision.value, onUpdated: () => { updates.value++; } })]) }).use(pinia).use(router).use(ElementPlus).mount('#app');
