import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth.store';

export function useTalentPermissions() {
  const auth = useAuthStore();
  const canEdit = computed(() => auth.user?.sysRole === 'hr' || auth.user?.sysRole === 'system_admin'
    || (auth.user?.sysRole === 'hr_user' && Boolean(auth.user.hrCapabilities?.includes('employee_archive_edit'))));
  return { canEdit };
}
