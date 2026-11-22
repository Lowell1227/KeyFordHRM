import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue';
import { useRoute } from 'vue-router';
import { payrollApi, payrollError } from '@/api/payroll.api';
import type { PayrollAccess, PayrollCapability } from '@/types/payroll.types';
import { subjectCapabilities } from './payroll-state';

export function usePayrollScope(required: MaybeRefOrGetter<PayrollCapability[]>) {
  const route = useRoute();
  const access = ref<PayrollAccess>();
  const subjectId = ref(typeof route.query.subjectId === 'string' ? route.query.subjectId : '');
  const month = ref(typeof route.query.month === 'string' && /^\d{4}-\d{2}$/.test(route.query.month) ? route.query.month : new Date().toISOString().slice(0, 7));
  const error = ref('');
  const loading = ref(false);
  const subjects = computed(() => access.value?.enabled ? access.value.subjects.filter(subject => toValue(required).some(cap => subject.capabilities.includes(cap))) : []);
  const capabilities = computed(() => subjectCapabilities(access.value, subjectId.value));
  const has = (capability: PayrollCapability) => capabilities.value.includes(capability);
  async function refreshAccess() {
    loading.value = true;
    error.value = '';
    try {
      access.value = await payrollApi.access();
      if (!subjects.value.some(subject => subject.id === subjectId.value)) subjectId.value = subjects.value[0]?.id ?? '';
      if (!subjectId.value) error.value = '当前账号没有该页面的薪酬主体授权';
    } catch (cause) {
      access.value = undefined;
      subjectId.value = '';
      error.value = await payrollError(cause);
    } finally { loading.value = false; }
  }
  return { access, subjects, subjectId, month, capabilities, has, error, loading, refreshAccess };
}
