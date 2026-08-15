import { ForbiddenException } from '@nestjs/common';
import { ObjectiveLevel, ObjectiveStatus, Prisma, SysRole } from '@prisma/client';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { DataScopeService } from '@/common/services/data-scope.service';
import { AuthUser } from '@/common/types/auth.types';
import { PrismaService } from '@/prisma/prisma.service';
import { ObjectivesService } from './objectives.service';

describe('ObjectivesService visibility helpers', () => {
  let service: ObjectivesService;
  let prisma: {
    objective: { count: jest.Mock; findMany: jest.Mock };
    actionItem: { findMany: jest.Mock };
    user: { findMany: jest.Mock };
  };
  let dataScope: { getVisibleEmployeeFilter: jest.Mock };

  const viewer: AuthUser = {
    id: 'manager-1',
    name: 'Manager',
    sysRole: SysRole.manager,
    deptId: 'dept-1',
    isAssessorOnly: false,
    canViewAll: false,
  };

  const visibleObjective = {
    id: 'objective-visible',
    title: 'Visible objective',
    description: null,
    level: ObjectiveLevel.individual,
    deptId: 'dept-1',
    ownerId: 'employee-1',
    parentId: null,
    cycleId: 'cycle-1',
    weight: new Prisma.Decimal(50),
    priority: 0,
    progress: 25,
    status: ObjectiveStatus.active,
    relatedIndicatorId: null,
    createdBy: 'manager-1',
    createdAt: new Date('2026-08-08T08:00:00.000Z'),
    updatedAt: new Date('2026-08-08T08:00:00.000Z'),
    dept: { id: 'dept-1', name: 'Engineering' },
    owner: { id: 'employee-1', name: 'Employee' },
    cycle: { id: 'cycle-1', name: '2026 H2' },
    relatedIndicator: null,
    creator: { id: 'manager-1', name: 'Manager' },
  };

  beforeEach(() => {
    prisma = {
      objective: { count: jest.fn(), findMany: jest.fn() },
      actionItem: { findMany: jest.fn() },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'manager-1' }, { id: 'employee-1' }]),
      },
    };
    dataScope = {
      getVisibleEmployeeFilter: jest.fn().mockResolvedValue({
        OR: [{ directManagerId: 'manager-1' }, { id: 'manager-1' }],
      }),
    };
    service = new ObjectivesService(
      prisma as unknown as PrismaService,
      dataScope as unknown as DataScopeService,
    );
  });

  it('uses the same visibility predicate for submitted-id validation and read filtering', async () => {
    prisma.objective.count.mockResolvedValue(1);
    prisma.objective.findMany.mockResolvedValue([visibleObjective]);

    await service.assertVisibleIds(['objective-visible'], viewer);
    await service.findVisibleByIds(['objective-visible'], viewer);

    const assertionWhere = prisma.objective.count.mock.calls[0][0].where.AND[0];
    const readWhere = prisma.objective.findMany.mock.calls[0][0].where.AND[0];
    expect(assertionWhere).toEqual(readWhere);
    expect(assertionWhere).toEqual({
      OR: [
        { level: ObjectiveLevel.company },
        { ownerId: { in: ['manager-1', 'employee-1'] } },
        { deptId: 'dept-1' },
      ],
    });
  });

  it('returns indistinguishable forbidden responses for missing and invisible objective ids', async () => {
    prisma.objective.count.mockResolvedValue(0);

    const capture = async (id: string) => {
      try {
        await service.assertVisibleIds([id], viewer);
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        return (error as ForbiddenException).getResponse();
      }
      throw new Error('expected assertVisibleIds to reject');
    };

    const missingResponse = await capture('objective-missing');
    const invisibleResponse = await capture('objective-invisible');

    expect(missingResponse).toEqual(invisibleResponse);
    expect(missingResponse).toMatchObject({ code: ERROR_CODE.FORBIDDEN });
  });

  it('quietly omits missing or invisible objectives from read filtering', async () => {
    prisma.objective.findMany.mockResolvedValue([visibleObjective]);

    const result = await service.findVisibleByIds(
      ['objective-visible', 'objective-protected'],
      viewer,
    );

    expect(result).toEqual([
      expect.objectContaining({
        id: 'objective-visible',
        title: 'Visible objective',
        ownerId: 'employee-1',
      }),
    ]);
    expect(prisma.objective.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            expect.objectContaining({ OR: expect.any(Array) }),
            { id: { in: ['objective-visible', 'objective-protected'] } },
          ],
        },
      }),
    );
  });

  it('returns visible owner-cycle objectives with one latest progress summary', async () => {
    prisma.objective.findMany.mockResolvedValue([visibleObjective]);
    prisma.actionItem.findMany.mockResolvedValue([
      {
        id: 'action-latest',
        objectiveId: 'objective-visible',
        title: '完成方案评审',
        progress: 60,
        updatedAt: new Date('2026-08-15T08:00:00.000Z'),
      },
      {
        id: 'action-older',
        objectiveId: 'objective-visible',
        title: '旧进展',
        progress: 30,
        updatedAt: new Date('2026-08-14T08:00:00.000Z'),
      },
    ]);

    const result = await service.findTracking(
      { ownerId: 'employee-1', cycleId: 'cycle-1' },
      viewer,
    );

    expect(prisma.objective.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        ownerId: 'employee-1',
        cycleId: 'cycle-1',
        OR: expect.any(Array),
      }),
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    }));
    expect(prisma.actionItem.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            OR: [
              { assigneeId: viewer.id },
              { createdBy: viewer.id },
              { objective: { ownerId: viewer.id } },
              { objective: { level: 'company' } },
            ],
          },
          { objectiveId: { in: ['objective-visible'] } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        objectiveId: true,
        title: true,
        progress: true,
        updatedAt: true,
      },
    });
    expect(result).toEqual({
      totalWeight: 50,
      items: [expect.objectContaining({
        id: 'objective-visible',
        latestProgress: {
          id: 'action-latest',
          title: '完成方案评审',
          progress: 60,
          updatedAt: new Date('2026-08-15T08:00:00.000Z'),
        },
      })],
    });
  });

  it('resolves a deep link through the same visibility predicate', async () => {
    prisma.objective.findMany.mockResolvedValue([]);

    await service.findTracking({ objectiveId: 'objective-visible' }, viewer);

    expect(prisma.objective.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          expect.objectContaining({ OR: expect.any(Array) }),
          { id: 'objective-visible' },
        ],
      },
    }));
  });

  it('rejects tracking requests without a deep link or owner-cycle pair', async () => {
    await expect(service.findTracking({ ownerId: 'employee-1' }, viewer))
      .rejects.toMatchObject({ response: expect.objectContaining({ message: '请选择人员和考核周期' }) });
  });
});
