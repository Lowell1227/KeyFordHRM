import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CycleManagementGuard } from './cycle-management.guard';
import { CyclesController } from './cycles.controller';

describe('CycleManagementGuard', () => {
  const viewer = { id: 'owner', sysRole: 'hr_user', hrCapabilities: ['cycle_plan_edit'] };
  const id = '11111111-1111-4111-8111-111111111111';
  const findUnique = jest.fn();
  const guard = new CycleManagementGuard({ assessmentCycle: { findUnique } } as any, new Reflector());
  const context = (handler: Function, method = 'POST', user = viewer) => ({
    getClass: () => CyclesController,
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({ method, user, params: { id } }) }),
  }) as ExecutionContext;

  beforeEach(() => findUnique.mockReset());
  it.each(['launch', 'schedule', 'cancelSchedule', 'update', 'remove', 'updateDeadlines', 'updateNotificationMode', 'preflight', 'participantRecord'])(
    'blocks %s on another cycle before running its handler', async (method) => {
      findUnique.mockResolvedValue({ hrOwnerId: 'other', reviewerId: 'other' });
      await expect(guard.canActivate(context(CyclesController.prototype[method], 'GET'))).rejects.toThrow(ForbiddenException);
    },
  );
  it('allows own launch', async () => {
    findUnique.mockResolvedValue({ hrOwnerId: 'owner' });
    await expect(guard.canActivate(context(CyclesController.prototype.launch))).resolves.toBe(true);
  });
  it('retains personal task-based detail reads without management permission', async () => {
    await expect(guard.canActivate(context(CyclesController.prototype.findOne, 'GET'))).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
