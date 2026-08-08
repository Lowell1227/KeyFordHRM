import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { IndicatorVisibilityScope, SysRole } from '@prisma/client';
import { AuthUser } from '@/common/types/auth.types';
import { DataScopeService } from '@/common/services/data-scope.service';
import { ObjectivesService } from '@/objectives/objectives.service';
import { PrismaService } from '@/prisma/prisma.service';
import { ReferenceIndicatorQueryDto } from './dto/reference-indicator-query.dto';
import { IndicatorVisibilityService } from './indicator-visibility.service';
import { SetIndicatorItemDto, SetIndicatorsDto } from './dto/set-indicators.dto';
import { validate } from 'class-validator';

describe('IndicatorVisibilityService', () => {
  let service: IndicatorVisibilityService;
  let prisma: {
    user: { findMany: jest.Mock; findUnique: jest.Mock };
    department: { findMany: jest.Mock };
    indicatorInstance: { count: jest.Mock; findMany: jest.Mock };
  };
  let dataScope: {
    getVisibleEmployeeFilter: jest.Mock;
    getAncestorDeptIds: jest.Mock;
    getManagerChainIds: jest.Mock;
  };
  let objectives: { assertVisibleIds: jest.Mock };

  const viewer: AuthUser = {
    id: 'viewer-1',
    name: 'Viewer',
    sysRole: SysRole.manager,
    deptId: 'dept-child',
    isAssessorOnly: false,
    canViewAll: false,
  };
  const task = {
    id: 'task-1',
    employeeId: 'owner-1',
    deptId: 'dept-owner',
    managerId: viewer.id,
  };

  beforeEach(() => {
    prisma = {
      user: { findMany: jest.fn(), findUnique: jest.fn() },
      department: { findMany: jest.fn() },
      indicatorInstance: { count: jest.fn(), findMany: jest.fn() },
    };
    dataScope = {
      getVisibleEmployeeFilter: jest.fn().mockResolvedValue({
        OR: [{ directManagerId: viewer.id }, { id: viewer.id }],
      }),
      getAncestorDeptIds: jest.fn().mockResolvedValue(['dept-child', 'dept-parent']),
      getManagerChainIds: jest.fn().mockResolvedValue(['manager-direct', 'manager-upper']),
    };
    objectives = { assertVisibleIds: jest.fn().mockResolvedValue(undefined) };
    service = new IndicatorVisibilityService(
      prisma as unknown as PrismaService,
      dataScope as unknown as DataScopeService,
      objectives as unknown as ObjectivesService,
    );
  });

  const selection = (overrides: Record<string, unknown> = {}) => ({
    visibilityScope: IndicatorVisibilityScope.custom,
    visibleDepartmentIds: ['dept-2'],
    visibleUserIds: ['user-2'],
    alignedObjectiveIds: ['objective-1'],
    ...overrides,
  });

  it('requires a department or user for a custom visibility scope', async () => {
    await expect(
      service.validateSelection(selection({ visibleDepartmentIds: [], visibleUserIds: [] }) as any, task, viewer),
    ).rejects.toThrow('自定义可见范围至少选择一个部门或员工');
  });

  it('rejects a visibility scope outside the seven supported values', async () => {
    await expect(
      service.validateSelection(
        selection({
          visibilityScope: 'private',
          visibleDepartmentIds: [],
          visibleUserIds: [],
          alignedObjectiveIds: [],
        }) as any,
        task,
        viewer,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets duplicate ids reach service normalization instead of rejecting the request DTO', async () => {
    const item = Object.assign(new SetIndicatorItemDto(), {
      name: 'Revenue',
      visibilityScope: IndicatorVisibilityScope.custom,
      visibleDepartmentIds: [
        '11111111-1111-4111-8111-111111111111',
        '11111111-1111-4111-8111-111111111111',
      ],
      visibleUserIds: ['22222222-2222-4222-8222-222222222222'],
      alignedObjectiveIds: [
        '33333333-3333-4333-8333-333333333333',
        '33333333-3333-4333-8333-333333333333',
      ],
    });
    const dto = Object.assign(new SetIndicatorsDto(), {
      expectedUpdatedAt: '2026-08-08T08:00:00.000Z',
      instances: [item],
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it.each(Object.values(IndicatorVisibilityScope).filter((scope) => scope !== 'custom'))(
    'rejects custom ids submitted for the %s scope',
    async (visibilityScope) => {
      await expect(
        service.validateSelection(selection({ visibilityScope }) as any, task, viewer),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('rejects a selected user outside the viewer employee scope', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    prisma.department.findMany.mockResolvedValue([{ id: 'dept-2' }]);

    await expect(service.validateSelection(selection() as any, task, viewer)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a selected department not represented in the viewer employee scope', async () => {
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'user-2' }]).mockResolvedValueOnce([]);

    await expect(service.validateSelection(selection() as any, task, viewer)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('does not reveal whether a submitted objective exists when it is not visible', async () => {
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'user-2' }]).mockResolvedValueOnce([{ deptId: 'dept-2' }]);
    objectives.assertVisibleIds.mockRejectedValue(new ForbiddenException());

    await expect(service.validateSelection(selection() as any, task, viewer)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('requires a selected department to be active and represented in employee scope', async () => {
    prisma.user.findMany
      .mockResolvedValueOnce([{ id: 'user-2' }])
      .mockResolvedValueOnce([{ deptId: 'dept-2' }]);

    await service.validateSelection(selection() as any, task, viewer);

    expect(prisma.user.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ dept: { isActive: true } }]),
        }),
      }),
    );
  });

  it('builds one owner or audience clause for every supported reference scope', async () => {
    prisma.user.findUnique.mockResolvedValue({
      directManagerId: 'manager-direct',
    });

    const where = await service.buildReferenceWhere(viewer);

    expect(where.OR).toEqual(
      expect.arrayContaining([
        { task: { employeeId: viewer.id } },
        { visibilityScope: 'company' },
        { visibilityScope: 'department', task: { deptId: viewer.deptId } },
        {
          visibilityScope: 'department_tree',
          task: { deptId: { in: ['dept-child', 'dept-parent'] } },
        },
        {
          visibilityScope: 'direct_reports',
          task: { employeeId: 'manager-direct' },
        },
        {
          visibilityScope: 'all_reports',
          task: { employeeId: { in: ['manager-direct', 'manager-upper'] } },
        },
        { visibilityScope: 'supervisors', task: { managerId: viewer.id } },
        {
          visibleUsers: { some: { userId: viewer.id } },
        },
        {
          visibleDepartments: { some: { departmentId: viewer.deptId } },
        },
      ]),
    );
  });

  it('combines reference visibility with filters and returns only the picker projection', async () => {
    prisma.user.findUnique.mockResolvedValue({ directManagerId: null });
    prisma.indicatorInstance.count.mockResolvedValue(1);
    prisma.indicatorInstance.findMany.mockResolvedValue([
      {
        id: 'indicator-1',
        taskId: 'task-1',
        name: 'Revenue',
        weight: { toNumber: () => 0.4 },
        visibilityScope: IndicatorVisibilityScope.company,
        task: {
          cycleId: 'cycle-1',
          employee: { id: 'owner-1', name: 'Owner' },
        },
      },
    ]);
    const query = Object.assign(new ReferenceIndicatorQueryDto(), {
      cycleId: 'cycle-1',
      ownerId: 'owner-1',
      keyword: 'rev',
      page: 2,
      pageSize: 5,
    });

    const result = await service.findVisibleReferences(query, viewer);

    expect(prisma.indicatorInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: expect.arrayContaining([
            expect.objectContaining({ OR: expect.any(Array) }),
            { task: { cycleId: 'cycle-1' } },
            { task: { employeeId: 'owner-1' } },
            {
              OR: [
                { name: { contains: 'rev', mode: 'insensitive' } },
                {
                  task: {
                    employee: {
                      name: { contains: 'rev', mode: 'insensitive' },
                    },
                  },
                },
              ],
            },
          ]),
        },
        skip: 5,
        take: 5,
      }),
    );
    expect(result).toEqual({
      total: 1,
      page: 2,
      pageSize: 5,
      items: [
        {
          id: 'indicator-1',
          taskId: 'task-1',
          cycleId: 'cycle-1',
          employeeId: 'owner-1',
          employeeName: 'Owner',
          name: 'Revenue',
          weight: 0.4,
          visibilityScope: 'company',
        },
      ],
    });
  });
});
