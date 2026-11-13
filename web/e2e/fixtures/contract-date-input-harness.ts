import { computed, createApp, h, reactive, ref, type Component } from 'vue';
import ElementPlus, { ElButton, ElDatePicker, ElForm, ElFormItem } from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import { validateContractDates } from '../../src/utils/employee-contract-validation';

const baseline = new URLSearchParams(location.search).has('baseline');
const componentPath = '/src/components/common/ContractDateInput.vue';
const DateInput: Component = baseline ? ElDatePicker : (await import(/* @vite-ignore */ componentPath)).default;
const contract = reactive<Record<string, string | null>>({ signedAt: '2026-02-28', effectiveFrom: null, expiresAt: null });
const errors = computed(() => validateContractDates(contract));
const submitted = ref<Record<string, string | null>[]>([]);
const disabled = ref(false);
const labels = { signedAt: '签订日期', effectiveFrom: '生效日期', expiresAt: '到期日期' };
createApp({
  render: () => h('main', { style: 'max-width: 640px; padding: 16px;' }, [
    h(ElForm, { labelPosition: 'top', disabled: disabled.value, onSubmit: (event: Event) => event.preventDefault() }, () => [
      ...Object.entries(labels).map(([field, label]) => h(ElFormItem, { label, error: errors.value[field], 'data-field': field }, () => h(DateInput, {
        ...(baseline ? { type: 'date', valueFormat: 'YYYY-MM-DD' } : {}),
        modelValue: contract[field], 'onUpdate:modelValue': (value: string | null) => { contract[field] = value; },
      }))),
      h(ElButton, { onClick: () => { if (!Object.keys(errors.value).length) submitted.value.push({ ...contract }); }, 'data-testid': 'submit' }, () => '提交'),
    ]),
    h('button', { onClick: () => { disabled.value = !disabled.value; }, 'data-testid': 'toggle-disabled' }, '切换禁用'),
    h('button', { onClick: () => { contract.signedAt = '2027-06-01'; }, 'data-testid': 'switch-record' }, '切换记录'),
    h('pre', { 'data-testid': 'model' }, JSON.stringify(contract)),
    h('pre', { 'data-testid': 'submitted' }, JSON.stringify(submitted.value)),
  ]),
}).use(ElementPlus, { locale: zhCn }).mount('#app');
