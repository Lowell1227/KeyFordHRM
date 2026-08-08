import 'reflect-metadata';
import { Prisma, SysRole, TaskStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthUser } from '@/common/types/auth.types';
import { TeamTaskQueryDto } from './dto/team-task-query.dto';
import { TeamTasksService } from './team-tasks.service';

describe('TeamTasksService', () => {
  let service: TeamTasksService;
  let prisma: {
    assessmentTask: { count: jest.Mock; findMany: jest.Mock };
  };

  const managerViewer: AuthUser = {
    id: 'manager-1',
    name: 'Manager',
    sysRole: SysRole.manager,
    deptId: 'dept-1',
    isAssessorOnly: false,
    canViewAll: false,
  };

  beforeEach(() => {
    prisma = {
      assessmentTask: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };
    service = new TeamTasksService(prisma as unknown as PrismaService);
  });

  it('keeps every requested filter within the current manager scope', async () => {
    const query = Object.assign(new TeamTaskQueryDto(), {
      page: 2,
      pageSize: 5,
      stage: 'manager-eval' as const,
      stageState: 'pending' as const,
      cycleId: 'cycle-1',
      deptId: 'dept-1',
      employeeId: 'employee-1',
      keyword: 'Ada',
    });
    prisma.assessmentTask.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);
    prisma.assessmentTask.findMany
      .mockResolvedValueOnce([
        {
          id: 'task-1',
          cycleId: 'cycle-1',
          employeeId: 'employee-1',
          deptId: 'dept-1',
          managerId: 'manager-1',
          status: 'manager_scoring' as TaskStatus,
          updatedAt: new Date('2026-08-08T00:00:00.000Z'),
          cycle: { name: '2026 H2' },
          employee: {
            name: 'Ada',
            employeeNo: 'E-001',
            avatarUrl: 'https://example.test/ada.png',
            position: 'Engineer',
          },
          dept: { name: 'Engineering' },
          gradeResult: { calculatedScore: new Prisma.Decimal(88), rawGrade: 'A' },
        },
      ])
      .mockResolvedValueOnce([{ dept: { id: 'dept-1', name: 'Engineering' } }])
      .mockResolvedValueOnce([
        {
          employee: {
            id: 'employee-1',
            name: 'Ada',
            employeeNo: 'E-001',
            deptId: 'dept-1',
          },
        },
      ]);

    const result = await service.findAll(query, managerViewer);

    expect(prisma.assessmentTask.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          managerId: managerViewer.id,
          cycleId: 'cycle-1',
          deptId: 'dept-1',
          employeeId: 'employee-1',
          employee: { name: { contains: 'Ada', mode: 'insensitive' } },
          status: { in: ['manager_scoring'] },
        }),
        skip: 5,
        take: 5,
      }),
    );
    expect(prisma.assessmentTask.count).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          managerId: managerViewer.id,
          cycleId: 'cycle-1',
          deptId: 'dept-1',
          employeeId: 'employee-1',
          employee: { name: { contains: 'Ada', mode: 'insensitive' } },
        }),
      }),
    );
    expect(prisma.assessmentTask.count.mock.calls[0][0].where.status).toBeUndefined();
    expect(prisma.assessmentTask.count).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ where: expect.objectContaining({ status: { in: ['manager_scoring'] } }) }),
    );
    expect(prisma.assessmentTask.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { managerId: managerViewer.id, cycleId: 'cycle-1' } }),
    );
    expect(prisma.assessmentTask.findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ where: { managerId: managerViewer.id, cycleId: 'cycle-1' } }),
    );
    expect(result).toEqual({
      total: 10,
      page: 2,
      pageSize: 5,
      items: [
        expect.objectContaining({
          id: 'task-1',
          employeeNo: 'E-001',
          avatarUrl: 'https://example.test/ada.png',
          position: 'Engineer',
          stageState: 'pending',
          totalScore: 88,
        }),
      ],
      counts: { all: 10, notStarted: 4, pending: 2, completed: 3, exempted: 1 },
      facets: {
        departments: [{ id: 'dept-1', name: 'Engineering' }],
        employees: [{ id: 'employee-1', name: 'Ada', employeeNo: 'E-001', deptId: 'dept-1' }],
      },
    });
  });
});
