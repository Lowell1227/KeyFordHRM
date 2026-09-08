import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from '@/common/types/auth.types';
import { assertCycleOperator, cycleOperatorWhere } from './cycle-operator-scope';

const specialist = { id: 'specialist', sysRole: 'hr_user', hrCapabilities: ['cycle_plan_edit', 'performance_publish'], canViewAll: true } as AuthUser;

describe('cycle operator scope', () => {
  it('only grants the specialist their assigned cycle, regardless of global read access', () => {
    expect(cycleOperatorWhere(specialist)).toEqual({ hrOwnerId: 'specialist' });
    expect(() => assertCycleOperator(specialist, { hrOwnerId: 'another', createdBy: 'specialist' })).toThrow(ForbiddenException);
    expect(() => assertCycleOperator(specialist, { hrOwnerId: 'specialist' })).not.toThrow();
  });
  it.each(['hr', 'system_admin'])('preserves %s cycle management', (sysRole) => {
    const viewer = { ...specialist, sysRole } as AuthUser;
    expect(cycleOperatorWhere(viewer)).toEqual({});
    expect(() => assertCycleOperator(viewer, { hrOwnerId: 'another' })).not.toThrow();
  });
  it('does not turn participant, creator or ordinary employee into an operator', () => {
    expect(() => assertCycleOperator({ ...specialist, sysRole: 'employee' }, { hrOwnerId: 'specialist' })).toThrow(ForbiddenException);
    expect(() => assertCycleOperator({ ...specialist, hrCapabilities: [] }, { hrOwnerId: 'specialist' })).toThrow(ForbiddenException);
  });
  it('keeps publication capability separate from creation', () => {
    const editor = { ...specialist, hrCapabilities: ['cycle_plan_edit'] };
    expect(() => assertCycleOperator(editor, { hrOwnerId: 'specialist' }, 'performance_publish')).toThrow(ForbiddenException);
  });
});
