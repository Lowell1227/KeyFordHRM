import type { CurrentUser } from '@/types/api.types';
import type { PersonnelReferenceKind } from '@/api/personnel-reference-data.api';

type ReferenceUser = Pick<CurrentUser, 'sysRole' | 'hrCapabilities'> | null | undefined;

export function canWritePersonnelReferenceData(user: ReferenceUser): boolean {
  return user?.sysRole === 'system_admin' || user?.sysRole === 'hr'
    || (user?.sysRole === 'hr_user' && Boolean(user.hrCapabilities?.includes('employee_archive_edit')));
}

export function canReadPersonnelReferenceData(user: ReferenceUser, kind: PersonnelReferenceKind): boolean {
  return canWritePersonnelReferenceData(user)
    || (user?.sysRole === 'hr_user' && Boolean(user.hrCapabilities?.some(capability =>
      capability === 'employee_archive_review' || (kind === 'job_family' && capability === 'organization_edit'))));
}
