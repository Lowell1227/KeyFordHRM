import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasHrCapability, HrCapability } from '@/auth/hr-capabilities';
import { AuthUser } from '@/common/types/auth.types';
import { ERROR_CODE } from '@/common/constants/error-codes';

export function isGlobalCycleOperator(viewer: AuthUser): boolean {
  return viewer.sysRole === 'hr' || viewer.sysRole === 'system_admin';
}

export function cycleOperatorWhere(viewer: AuthUser): Prisma.AssessmentCycleWhereInput {
  return isGlobalCycleOperator(viewer) ? {} : { hrOwnerId: viewer.id };
}

export function assertCycleOperator(
  viewer: AuthUser,
  cycle: { hrOwnerId?: string | null; createdBy?: string | null },
  capability: HrCapability = 'cycle_plan_edit',
): void {
  if (isGlobalCycleOperator(viewer)) return;
  if (hasHrCapability(viewer, capability) && cycle.hrOwnerId === viewer.id) return;
  throw new ForbiddenException({ code: ERROR_CODE.FORBIDDEN, message: '仅可管理分配给本人的考核周期' });
}
