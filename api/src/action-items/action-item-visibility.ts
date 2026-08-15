import { Prisma, SysRole } from '@prisma/client';
import { AuthUser } from '@/common/types/auth.types';

export function buildActionItemVisibilityWhere(
  viewer: AuthUser,
): Prisma.ActionItemWhereInput {
  if (([SysRole.hr, SysRole.system_admin] as SysRole[]).includes(viewer.sysRole)) return {};

  return {
    OR: [
      { assigneeId: viewer.id },
      { createdBy: viewer.id },
      { objective: { ownerId: viewer.id } },
      { objective: { level: 'company' } },
    ],
  };
}
