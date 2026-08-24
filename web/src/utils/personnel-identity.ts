import type { UserStatus } from '@/types/enums';

export function formatPersonnelIdentityLabel(status?: UserStatus): string {
  if (status === 'probation') return '试用期员工';
  if (status === 'resigned') return '离职人员';
  return '员工';
}
