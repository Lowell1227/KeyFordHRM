import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth.store';

export function useTalentPermissions() {
  const auth = useAuthStore();
  const legacyCanEdit = computed(() => Boolean(auth.user && !auth.user.isAssessorOnly && (auth.user.sysRole === 'hr' || auth.user.sysRole === 'system_admin'
    || (auth.user.sysRole === 'hr_user' && auth.user.hrCapabilities?.includes('employee_archive_edit')))));
  const canEdit = computed(() => legacyCanEdit.value || Boolean(auth.user && !auth.user.isAssessorOnly
    && auth.user.hrCapabilities?.includes('recruitment_edit')));
  const canRead = computed(() => Boolean(auth.user && !auth.user.isAssessorOnly && (canEdit.value
    || auth.user.hrCapabilities?.includes('recruitment_view')
    || (auth.user.sysRole === 'hr_user' && auth.user.hrCapabilities?.includes('employee_archive_review')))));
  const canReviewDemand = computed(() => Boolean(auth.user && !auth.user.isAssessorOnly
    && auth.user.hrCapabilities?.includes('recruitment_demand_review')));
  const canReadDemand = computed(() => canRead.value || canReviewDemand.value);
  const canExport = computed(() => Boolean(auth.user && !auth.user.isAssessorOnly && (legacyCanEdit.value
    || (auth.user.sysRole === 'hr_user' && auth.user.hrCapabilities?.includes('employee_archive_review')))));
  return { canEdit, canRead, canReadDemand, canReviewDemand, canExport, canDelete: legacyCanEdit, canShare: legacyCanEdit, canOnboard: legacyCanEdit };
}
