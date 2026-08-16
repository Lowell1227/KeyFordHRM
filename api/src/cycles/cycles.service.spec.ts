import { Prisma, SysRole } from '@prisma/client';
import { CyclesService } from './cycles.service';
import { CreateCycleDto } from './dto/create-cycle.dto';
import { AuthUser } from '@/common/types/auth.types';

describe('CyclesService', () => {
  const creator = {
    id: '11111111-1111-4111-8111-111111111111',
    sysRole: SysRole.hr,
    deptId: null,
    canViewAll: true,
  } as AuthUser;

  let prisma: any;
  let service: CyclesService;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (callback) => callback(prisma)),
      assessmentCycle: {
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'cycle-1', ...data })),
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      assessmentTask: { findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
      assessmentTemplateSnapshot: { count: jest.fn() },
      user: { findFirst: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    service = new CyclesService(prisma as never);
  });

  function quarterlyCycle(overrides: Partial<CreateCycleDto> = {}): CreateCycleDto {
    return {
      name: '2027年第一季度',
      type: 'quarterly',
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T00:00:00.000Z'),
      ...overrides,
    };
  }

  it('allows goal-setting deadlines before the performance period starts', async () => {
    const dto = quarterlyCycle({
      deadlineIndicatorSetting: new Date('2026-12-27T00:00:00.000Z'),
      deadlineIndicatorConfirm: new Date('2026-12-31T00:00:00.000Z'),
      deadlineSelfEval: new Date('2027-04-05T00:00:00.000Z'),
    });

    await expect(service.create(dto, creator)).resolves.toEqual(
      expect.objectContaining({ id: 'cycle-1' }),
    );
    expect(prisma.assessmentCycle.create).toHaveBeenCalledTimes(1);
  });

  it('derives the default goal-setting and self-evaluation opening dates', async () => {
    await service.create(quarterlyCycle(), creator);

    expect(prisma.assessmentCycle.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        goalSettingOpenAt: new Date('2026-12-22T00:00:00.000Z'),
        selfEvalOpenAt: new Date('2027-04-01T00:00:00.000Z'),
        gradeAMaxRatio: new Prisma.Decimal(0.2),
        gradeBMaxRatio: new Prisma.Decimal(0.4),
        gradeCMaxRatio: new Prisma.Decimal(0.3),
        gradeDMaxRatio: new Prisma.Decimal(0.1),
      }),
    });
  });

  it('rejects self evaluation opening before the day after the period ends', async () => {
    await expect(service.create(quarterlyCycle({
      selfEvalOpenAt: new Date('2027-03-31T12:00:00.000Z'),
    }), creator)).rejects.toMatchObject({
      response: { message: expect.stringContaining('次日') },
    });
  });

  it('returns only opened cycles that contain a task for the current employee', async () => {
    prisma.assessmentCycle.findMany.mockResolvedValue([{
      id: 'cycle-1',
      name: '2027年第一季度',
      status: 'indicator_setting',
      tasks: [{ id: 'task-1', status: 'indicator_drafting', isExempt: false }],
    }]);
    const employee = { ...creator, id: 'employee-1', sysRole: SysRole.employee } as AuthUser;
    const visibleCycles = service as unknown as {
      findMine: (viewer: AuthUser) => Promise<unknown[]>;
    };

    await expect(visibleCycles.findMine(employee)).resolves.toHaveLength(1);
    expect(prisma.assessmentCycle.findMany).toHaveBeenCalledWith({
      where: {
        status: { notIn: ['draft', 'scheduled', 'launch_blocked'] },
        tasks: { some: { employeeId: employee.id } },
      },
      include: {
        tasks: {
          where: { employeeId: employee.id },
          select: { id: true, status: true, isExempt: true },
          take: 1,
        },
      },
      orderBy: { startDate: 'desc' },
    });
  });

  it('returns cycles where the current user is the direct manager of a task', async () => {
    prisma.assessmentCycle.findMany.mockResolvedValue([{
      id: 'cycle-1',
      name: '2027年第一季度',
      status: 'indicator_setting',
      tasks: [{ id: 'task-1', status: 'indicator_reviewing', isExempt: false }],
    }]);
    const manager = { ...creator, id: 'manager-1', sysRole: SysRole.manager } as AuthUser;
    const visibleCycles = service as unknown as {
      findMine: (viewer: AuthUser) => Promise<unknown[]>;
    };

    await expect(visibleCycles.findMine(manager)).resolves.toHaveLength(1);
    expect(prisma.assessmentCycle.findMany).toHaveBeenCalledWith({
      where: {
        status: { notIn: ['draft', 'scheduled', 'launch_blocked'] },
        tasks: {
          some: {
            OR: [
              { employeeId: manager.id },
              { managerId: manager.id },
            ],
          },
        },
      },
      include: {
        tasks: {
          where: {
            OR: [
              { employeeId: manager.id },
              { managerId: manager.id },
            ],
          },
          select: { id: true, status: true, isExempt: true },
          take: 1,
        },
      },
      orderBy: { startDate: 'desc' },
    });
  });

  it('allows a direct manager to open a cycle that only contains team tasks', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      status: 'indicator_setting',
      deadlineIndicatorSetting: null,
      deadlineIndicatorConfirm: null,
    });
    prisma.assessmentTask.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    prisma.assessmentTask.groupBy.mockResolvedValue([]);
    prisma.assessmentTemplateSnapshot.count.mockResolvedValue(1);
    const manager = { ...creator, id: 'manager-1', sysRole: SysRole.manager } as AuthUser;

    await expect(service.findOne('cycle-1', manager)).resolves.toEqual(
      expect.objectContaining({ id: 'cycle-1' }),
    );
    expect(prisma.assessmentTask.count).toHaveBeenNthCalledWith(1, {
      where: {
        cycleId: 'cycle-1',
        OR: [
          { employeeId: manager.id },
          { managerId: manager.id },
        ],
      },
    });
    expect(prisma.assessmentTask.count).toHaveBeenNthCalledWith(2, {
      where: {
        cycleId: 'cycle-1',
        OR: [
          { employeeId: manager.id },
          { managerId: manager.id },
        ],
      },
    });
  });

  it('scopes the general cycle list to the current employee task', async () => {
    prisma.assessmentCycle.count.mockResolvedValue(1);
    prisma.assessmentCycle.findMany.mockResolvedValue([]);
    const employee = { ...creator, id: 'employee-1', sysRole: SysRole.employee } as AuthUser;

    await service.findAll({ page: 1, pageSize: 20, skip: 0, take: 20 } as any, employee);

    expect(prisma.assessmentCycle.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { notIn: ['draft', 'scheduled', 'launch_blocked'] },
        tasks: { some: { employeeId: employee.id } },
      }),
    }));
  });

  it('scopes the general cycle list to the current manager own or direct-team tasks', async () => {
    prisma.assessmentCycle.count.mockResolvedValue(1);
    prisma.assessmentCycle.findMany.mockResolvedValue([]);
    const manager = { ...creator, id: 'manager-1', sysRole: SysRole.manager } as AuthUser;

    await service.findAll({ page: 1, pageSize: 20, skip: 0, take: 20 } as any, manager);

    const taskScope = {
      OR: [
        { employeeId: manager.id },
        { managerId: manager.id },
      ],
    };
    expect(prisma.assessmentCycle.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ tasks: { some: taskScope } }),
    });
    expect(prisma.assessmentCycle.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tasks: { some: taskScope } }),
    }));
  });

  it('does not expose organization-wide task counts to an employee', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      status: 'indicator_setting',
      deadlineIndicatorSetting: null,
      deadlineIndicatorConfirm: null,
    });
    prisma.assessmentTask.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    prisma.assessmentTask.groupBy.mockResolvedValue([{ status: 'indicator_drafting', _count: { _all: 1 } }]);
    prisma.assessmentTemplateSnapshot.count.mockResolvedValue(1);
    const employee = { ...creator, id: 'employee-1', sysRole: SysRole.employee } as AuthUser;

    await service.findOne('cycle-1', employee);

    expect(prisma.assessmentTask.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { cycleId: 'cycle-1', employeeId: employee.id },
    }));
  });

  it('requires schedule cancellation before deadlines can be changed', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({ id: 'cycle-1', status: 'scheduled' });

    await expect(service.updateDeadlines('cycle-1', {
      deadlineIndicatorSetting: new Date('2026-12-28T00:00:00.000Z'),
    }, creator)).rejects.toMatchObject({
      response: { message: expect.stringContaining('取消预约') },
    });
  });

  it('uses a status CAS so concurrent scheduling cannot race a deadline update', async () => {
    prisma.assessmentCycle.findUnique.mockResolvedValue({
      id: 'cycle-1',
      status: 'draft',
      deadlineIndicatorSetting: new Date('2026-12-20T00:00:00.000Z'),
    });
    prisma.assessmentCycle.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.updateDeadlines('cycle-1', {
      deadlineIndicatorSetting: new Date('2026-12-21T00:00:00.000Z'),
    }, creator)).rejects.toMatchObject({
      response: { message: expect.stringContaining('状态已变化') },
    });
    expect(prisma.assessmentCycle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cycle-1', status: 'draft' },
    }));
  });
});
