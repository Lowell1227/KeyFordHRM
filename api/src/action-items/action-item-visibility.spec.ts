import { SysRole } from '@prisma/client';
import { AuthUser } from '@/common/types/auth.types';
import { buildActionItemVisibilityWhere } from './action-item-visibility';

const viewer: AuthUser = {
  id: 'employee-1',
  name: 'Employee',
  sysRole: SysRole.employee,
  deptId: 'dept-1',
  isAssessorOnly: false,
  canViewAll: false,
};

describe('buildActionItemVisibilityWhere', () => {
  it('preserves the existing non-admin read predicate', () => {
    expect(buildActionItemVisibilityWhere(viewer)).toEqual({
      OR: [
        { assigneeId: 'employee-1' },
        { createdBy: 'employee-1' },
        { objective: { ownerId: 'employee-1' } },
        { objective: { level: 'company' } },
      ],
    });
  });

  it.each([SysRole.hr, SysRole.system_admin])(
    'keeps %s unrestricted',
    (sysRole) => {
      expect(buildActionItemVisibilityWhere({ ...viewer, sysRole })).toEqual({});
    },
  );
});
