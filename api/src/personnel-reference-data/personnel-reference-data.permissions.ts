import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { hasHrCapability } from '@/auth/hr-capabilities';
import type { AuthUser } from '@/common/types/auth.types';
import { PersonnelReferenceDataKind } from './personnel-reference-data.dto';

export function assertPersonnelReferenceDataAccess(
  user: AuthUser,
  kind: string,
  write: boolean,
): PersonnelReferenceDataKind {
  if (!Object.values(PersonnelReferenceDataKind).includes(kind as PersonnelReferenceDataKind)) {
    throw new BadRequestException('基础资料类型无效');
  }
  const canEdit = user && hasHrCapability(user, 'employee_archive_edit');
  const canRead =
    canEdit ||
    (user &&
      (hasHrCapability(user, 'employee_archive_review') ||
        (kind === PersonnelReferenceDataKind.job_family &&
          hasHrCapability(user, 'organization_edit'))));
  if (!(write ? canEdit : canRead))
    throw new ForbiddenException('无权限执行此操作');
  return kind as PersonnelReferenceDataKind;
}
