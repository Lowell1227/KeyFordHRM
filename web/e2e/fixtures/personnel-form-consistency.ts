import { createApp, h, nextTick, ref } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import ArchiveEditor from '../../src/views/admin/components/EmployeeArchiveInlineEditor.vue';
import ReentryDrawer from '../../src/views/admin/components/EmployeeReentryDrawer.vue';
import EmploymentDrawer from '../../src/views/admin/components/EmploymentRecordDrawer.vue';
import { useAuthStore } from '../../src/stores/auth.store';

const fixture = (window as any).personnelFormFixture;
const archive = ref(fixture.archive);
const opened = ref(false);
const submitted = ref<unknown[]>([]);
(window as any).setResignationReview = (review: unknown) => {
  archive.value = { ...archive.value, latestResignationReview: review };
};
const app = createApp({
  setup() {
    void nextTick(() => { opened.value = true; });
    return () => h('main', { style: 'padding: 12px; max-width: 960px; margin: auto;' }, [
      fixture.kind === 'archive'
        ? h(ArchiveEditor, { editing: true, archive: archive.value, departments: fixture.departments })
        : h(fixture.kind === 'reentry' ? ReentryDrawer : EmploymentDrawer, {
          modelValue: opened.value, archive: archive.value, employee: archive.value, departments: fixture.departments,
          mode: fixture.kind === 'resignation' ? 'resignation' : 'default',
          'onUpdate:modelValue': (value: boolean) => { opened.value = value; },
          onSubmitted: (id?: string) => submitted.value.push(id),
        }),
      h('pre', { 'data-testid': 'submitted' }, JSON.stringify(submitted.value)),
    ]);
  },
});
const pinia = createPinia();
app.use(pinia);
useAuthStore(pinia).user = { id: 'fixture-editor', name: '虚构组件维护员', sysRole: 'hr_user',
  hrCapabilities: ['employee_archive_edit'] } as any;
app.use(ElementPlus).mount('#app');
