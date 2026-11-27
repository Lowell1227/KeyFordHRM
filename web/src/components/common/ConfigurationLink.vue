<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import { canAccessRoute, navigationTarget } from '@/router/navigation';
import { configurationTargets, type ConfigurationTarget } from '@/router/configuration-targets';

const props = defineProps<{ setting: ConfigurationTarget; subjectId?: string; month?: string; employeeId?: string; label?: string; instructionsOnly?: boolean }>();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const target = computed(() => {
  const item = configurationTargets[props.setting];
  const help = { name: 'ConfigurationHelp', params: { setting: props.setting } };
  if (!item.path || props.instructionsOnly) return { to: help, label: '查看配置方式' };

  const query = { ...route.query, subjectId: props.subjectId ?? route.query.subjectId, month: props.month ?? route.query.month };
  const scoped = navigationTarget(item.path, { path: route.path, query });
  const to = { path: item.path, query: { ...(typeof scoped === 'string' ? {} : scoped.query), ...('query' in item ? item.query : {}), ...(props.setting === 'personnel-manager' && props.employeeId ? { employeeId: props.employeeId } : {}) } };
  const user = auth.user;
  const resolved = router.resolve(to);
  const isHrAdministrator = user?.sysRole === 'hr' || user?.sysRole === 'system_admin';
  if ((props.setting === 'dingtalk-notifications' && !isHrAdministrator)
    || (props.setting === 'improvement-reviewer' && user?.sysRole !== 'system_admin')
    || (props.setting === 'organization-roles' && !isHrAdministrator && !user?.hrCapabilities?.includes('organization_edit'))
    || (props.setting === 'personnel-manager' && !isHrAdministrator && !user?.hrCapabilities?.includes('employee_archive_edit'))) {
    return { to: help, label: '查看配置方式' };
  }
  const allowed = user && canAccessRoute(resolved, user);
  if (item.path.startsWith('/payroll/') && query.subjectId) {
    const capabilities = resolved.meta.payrollCapabilities ?? [];
    const access = user?.payrollAccess?.subjects.find(subject => subject.id === query.subjectId);
    if (!access || !capabilities.some(capability => access.capabilities.includes(capability))) {
      return { to: help, label: '查看配置方式' };
    }
  }
  return allowed ? { to, label: props.label ?? '前往配置' } : { to: help, label: '查看配置方式' };
});
</script>

<template>
  <RouterLink class="configuration-link" :to="target.to" target="_blank" rel="noopener">
    {{ target.label }}
  </RouterLink>
</template>

<style scoped>
.configuration-link { color: var(--el-color-primary); text-underline-offset: 2px; text-decoration: underline; }
.configuration-link:hover { color: var(--el-color-primary-dark-2); }
</style>
