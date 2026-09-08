import { createApp, h, reactive } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import Picker from '../../src/views/admin/components/CycleParticipantScopePicker.vue';
import type { Department } from '../../src/types/api.types';

const saved = new URLSearchParams(location.search).get('saved');
const state = reactive(saved ? JSON.parse(saved) : {
  scope: 'custom', departmentIds: [], userIds: [], excludedDepartmentIds: [], excludedUserIds: [],
});
const departments: Department[] = [{
  id: 'parent', name: '人事部', parentId: null, company: 'fuede', sortOrder: 1, directMemberCount: 4,
  children: [{ id: 'child', name: '人事组', parentId: 'parent', company: 'fuede', sortOrder: 1, directMemberCount: 3 }],
}, { id: 'other', name: '其他部门', parentId: null, company: 'fuede', sortOrder: 2, directMemberCount: 1 }];
createApp({
  render: () => h('main', [
    h(Picker, {
      ...state, departments,
      ...Object.fromEntries(Object.keys(state).map((key) => [`onUpdate:${key}`, (value: unknown) => { state[key] = value; }])),
    }),
    h('pre', { 'data-testid': 'saved-scope' }, JSON.stringify(state)),
  ]),
}).use(ElementPlus).mount('#app');
