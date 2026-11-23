import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue';
import { useRoute } from 'vue-router';
import { payrollError } from '@/api/payroll.api';
import { useAuthStore } from '@/stores/auth.store';
import type { PayrollAccess, PayrollCapability } from '@/types/payroll.types';
import { payrollBusinessMonth, subjectCapabilities } from './payroll-state';

export function usePayrollScope(required: MaybeRefOrGetter<PayrollCapability[]>, options: { syncQuery?: boolean } = {}) {
  const auth = useAuthStore();
  const route = useRoute();
  const access = ref<PayrollAccess>();
  const subjectId = ref(typeof route.query.subjectId === 'string' ? route.query.subjectId : '');
  const month = ref(typeof route.query.month === 'string' && /^\d{4}-\d{2}$/.test(route.query.month) ? route.query.month : payrollBusinessMonth());
  const error = ref('');
  const loading = ref(false);
  let sequence = 0, disposed = false;
  watch([() => auth.token, () => auth.user?.id], () => {
    sequence++; access.value = undefined; subjectId.value = ''; error.value = ''; loading.value = false;
  }, { flush: 'sync' });
  onScopeDispose(() => { disposed = true; sequence++; loading.value = false; });
  const subjects = computed(() => access.value?.enabled ? access.value.subjects.filter(subject => toValue(required).some(cap => subject.capabilities.includes(cap))) : []);
  const capabilities = computed(() => subjectCapabilities(access.value, subjectId.value));
  const has = (capability: PayrollCapability) => capabilities.value.includes(capability);
  watch([() => route.query.subjectId, () => route.query.month], ([subject, period]) => {
    if (!options.syncQuery) return;
    if (typeof subject === 'string') {
      subjectId.value = !access.value || subjects.value.some(row => row.id === subject) ? subject : '';
      if (!subjectId.value && access.value) error.value = '当前账号没有该公司主体的薪酬授权';
    }
    if (typeof period === 'string' && /^[2-9]\d{3}-(0[1-9]|1[0-2])$/.test(period)) month.value = period;
  }, { flush: 'sync' });
  async function refreshAccess() {
    const request = ++sequence, token = auth.token, userId = auth.user?.id;
    const current = () => !disposed && request === sequence && token === auth.token && userId === auth.user?.id;
    loading.value = true;
    error.value = '';
    try {
      const value = await auth.refreshPayrollAccess();
      if (!current()) return;
      access.value = value;
      if (!subjects.value.some(subject => subject.id === subjectId.value)) subjectId.value = subjects.value[0]?.id ?? '';
      if (!subjectId.value) error.value = '当前账号没有该页面的薪酬主体授权';
    } catch (cause) {
      if (!current() || (cause as { name?: string } | null)?.name === 'PayrollAccessSupersededError') return;
      const message = await payrollError(cause);
      if (!current()) return;
      access.value = undefined;
      subjectId.value = '';
      error.value = message;
    } finally { if (current()) loading.value = false; }
  }
  return { access, subjects, subjectId, month, capabilities, has, error, loading, refreshAccess };
}
