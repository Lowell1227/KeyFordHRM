import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from '@/common/types/auth.types';
import { CyclesService } from './cycles.service';
import { CycleQueryDto } from './dto/cycle-query.dto';

describe('cycle specialist scope in services', () => {
  const viewer = { id: 'specialist', sysRole: 'hr_user', hrCapabilities: ['cycle_plan_edit', 'performance_publish'], canViewAll: true } as AuthUser;
  let prisma: any;
  let service: CyclesService;
  beforeEach(() => {
    prisma = { assessmentCycle: {
      findUnique: jest.fn().mockResolvedValue({ id: 'cycle', hrOwnerId: 'someone-else', status: 'draft' }),
      count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn(), deleteMany: jest.fn(),
    } };
    prisma.$transaction = jest.fn((fn) => fn(prisma));
    service = new CyclesService(prisma, {} as any, {} as any);
  });
  it('scopes management list to the assigned owner', async () => {
    await service.findAll(Object.assign(new CycleQueryDto(), { purpose: 'manage' }), viewer);
    expect(prisma.assessmentCycle.findMany.mock.calls[0][0].where.OR).toEqual([{ hrOwnerId: viewer.id }]);
  });
  it('scopes publication cycles and rejects readers without the new permission', async () => {
    const query = Object.assign(new CycleQueryDto(), { purpose: 'publish' });
    await service.findAll(query, viewer);
    expect(prisma.assessmentCycle.findMany.mock.calls[0][0].where.hrOwnerId).toBe(viewer.id);
    expect(prisma.assessmentCycle.findMany.mock.calls[0][0].where.tasks.some.OR[0].status.in).toContain('closed');
    await expect(service.findAll(query, { ...viewer, hrCapabilities: ['cycle_plan_edit'] })).rejects.toThrow(ForbiddenException);
  });
  it('keeps independently assigned approval and team cycles visible in general selectors', async () => {
    await service.findAll(new CycleQueryDto(), viewer);
    const choices = prisma.assessmentCycle.findMany.mock.calls[0][0].where.OR;
    expect(choices).toEqual([
      { hrOwnerId: viewer.id },
      { tasks: { some: { OR: [
        { employeeId: viewer.id }, { managerId: viewer.id },
        { deptHeadId: viewer.id }, { approverId: viewer.id },
      ] } } },
    ]);
  });
  it('cannot delete another owner draft even when creator or global reader', async () => {
    await expect(service.remove('cycle', viewer)).rejects.toThrow(ForbiddenException);
    expect(prisma.assessmentCycle.deleteMany).not.toHaveBeenCalled();
  });
  it('cannot edit another cycle notification settings', async () => {
    await expect(service.updateNotificationMode('cycle', 'off', viewer)).rejects.toThrow(ForbiddenException);
    expect(prisma.assessmentCycle.updateMany).not.toHaveBeenCalled();
  });
});
