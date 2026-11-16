import { createApp, h, nextTick, ref } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '../../src/styles/theme.css';
import '../../src/styles/performance-results.css';
import ArchiveEditor from '../../src/views/admin/components/EmployeeArchiveInlineEditor.vue';
import CreateDrawer from '../../src/views/admin/components/EmployeeCreateDrawer.vue';
import ReentryDrawer from '../../src/views/admin/components/EmployeeReentryDrawer.vue';
import EmploymentDrawer from '../../src/views/admin/components/EmploymentRecordDrawer.vue';
import CompanyDirectory from '../../src/views/admin/ContractSubjectManageView.vue';
import PositionDirectory from '../../src/views/admin/PositionDirectoryView.vue';
import { useAuthStore } from '../../src/stores/auth.store';

const fixture = (window as any).companyDirectoryFixture;
const opened = ref(false);
const submitted = ref<unknown[]>([]);
const editor = ref<InstanceType<typeof ArchiveEditor>>();
const app = createApp({
  setup() {
    void nextTick(() => { opened.value = true; });
    const submit = (value: unknown) => submitted.value.push(value);
    return () => h('main', { style: 'padding: 12px; max-width: 960px; margin: auto;' }, [
      fixture.kind === 'directory' ? h(CompanyDirectory) : fixture.kind === 'positions' ? h(PositionDirectory) : fixture.kind === 'archive'
        ? h(ArchiveEditor, { ref: editor, editing: true, archive: fixture.archive, draft: fixture.draft,
          departments: fixture.departments, onSubmit: submit })
        : h(fixture.kind === 'create' ? CreateDrawer : fixture.kind === 'reentry' ? ReentryDrawer : EmploymentDrawer, {
          modelValue: opened.value, archive: fixture.archive, employee: fixture.archive,
          draft: fixture.draft, departments: fixture.departments,
          'onUpdate:modelValue': (value: boolean) => { opened.value = value; }, onSubmitted: submit,
        }),
      fixture.kind === 'archive' ? h('button', { onClick: () => editor.value?.submit() }, '提交') : null,
      h('pre', { 'data-testid': 'submitted', style: 'white-space: pre-wrap; overflow-wrap: anywhere;' }, JSON.stringify(submitted.value)),
    ]);
  },
});
const pinia = createPinia();
app.use(pinia);
useAuthStore(pinia).user = { id: 'fixture-editor', name: '虚构公司维护员', sysRole: 'hr_user',
  hrCapabilities: [fixture.capability] } as any;
app.use(ElementPlus).mount('#app');
