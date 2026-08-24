import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ImprovementPlanStatus, Prisma } from '@prisma/client';
import { ImprovementPlansService } from './improvement-plans.service';
import { PrismaService } from '@/prisma/prisma.service';
import { DataScopeService } from '@/common/services/data-scope.service';
import { AuthUser } from '@/common/types/auth.types';

function makeViewer(overrides?: Partial<AuthUser>): AuthUser {
  return {
    id: 'viewer-1',
    name: 'Viewer',
    sysRole: 'hr' as any,
    deptId: 'dept-1',
    isAssessorOnly: false,
    canViewAll: false,
    ...overrides,
  };
}

function makePlan(overrides?: any) {
  return {
    id: 'plan-1',
    employeeId: 'emp-1',
    cycleId: 'cycle-1',
    taskId: 'task-1',
    creatorId: null,
    improvementNeed: null,
    importance: null,
    improvementGoal: null,
    targetDate: null,
    measures: [],
    finalScore: null,
    status: ImprovementPlanStatus.draft,
    createdAt: new Date(),
    updatedAt: new Date(),
    employee: { id: 'emp-1', name: 'Employee', employeeNo: 'E001', dept: { name: 'Dept' } },
    cycle: { id: 'cycle-1', name: '2026 Q1' },
    creator: null,
    ...overrides,
  };
}

describe('ImprovementPlansService', () => {
  let service: ImprovementPlansService;
  let prisma: any;
  let dataScope: Partial<DataScopeService>;

  beforeEach(async () => {
    prisma = {
      improvementPlan: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      performanceArchive: {
        findMany: jest.fn(),
      },
      user: {
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      department: {
        findMany: jest.fn(),
      },
    };

    dataScope = {
      getVisibleEmployeeFilter: jest.fn().mockResolvedValue({}),
      getSubDeptIds: jest.fn().mockResolvedValue(['dept-1', 'dept-2']),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImprovementPlansService,
        { provide: PrismaService, useValue: prisma },
        { provide: DataScopeService, useValue: dataScope },
      ],
    }).compile();

    service = module.get<ImprovementPlansService>(ImprovementPlansService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('按数据范围过滤并返回分页列表', async () => {
      (dataScope.getVisibleEmployeeFilter as jest.Mock).mockResolvedValue({ id: 'emp-1' });
      prisma.improvementPlan.count.mockResolvedValue(1);
      prisma.improvementPlan.findMany.mockResolvedValue([makePlan()]);

      const result = await service.findAll(
        { status: ImprovementPlanStatus.draft },
        { page: 1, pageSize: 20, skip: 0, take: 20 } as any,
        makeViewer(),
      );

      expect(result.total).toBe(1);
      expect(result.items[0].status).toBe('draft');
      expect(prisma.improvementPlan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employee: { id: 'emp-1' },
            status: 'draft',
          }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('员工可以查看自己的计划', async () => {
      prisma.improvementPlan.findUnique.mockResolvedValue(makePlan({ employeeId: 'emp-1' }));

      const result = await service.findOne('plan-1', makeViewer({ id: 'emp-1', sysRole: 'employee' as any }));

      expect(result.id).toBe('plan-1');
    });

    it('非授权用户查看他人计划抛 403', async () => {
      prisma.improvementPlan.findUnique.mockResolvedValue(makePlan({ employeeId: 'emp-1' }));
      (dataScope.getVisibleEmployeeFilter as jest.Mock).mockResolvedValue({ id: 'emp-2' });
      prisma.user.count.mockResolvedValue(0);

      await expect(
        service.findOne('plan-1', makeViewer({ id: 'emp-2', sysRole: 'employee' as any })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('计划不存在抛 404', async () => {
      prisma.improvementPlan.findUnique.mockResolvedValue(null);

      await expect(service.findOne('plan-x', makeViewer())).rejects.toThrow(NotFoundException);
    });
  });

  describe('fill', () => {
    it('普通员工只要是记录对应员工的绩效直属上级即可填写', async () => {
      prisma.improvementPlan.findUnique.mockResolvedValue(makePlan({ status: 'draft' }));
      prisma.user.findUnique.mockResolvedValue({ directManagerId: 'viewer-1', deptId: 'dept-1' });
      prisma.improvementPlan.update.mockResolvedValue(makePlan({
        status: 'in_progress',
        creatorId: 'viewer-1',
      }));

      await expect(service.fill(
        'plan-1',
        {
          improvementNeed: 'need',
          importance: 'high',
          improvementGoal: 'goal',
          targetDate: '2026-07-01',
          measures: [],
        },
        makeViewer({ sysRole: 'employee' as any }),
      )).resolves.toEqual(expect.objectContaining({ status: 'in_progress' }));
    });

    it('填写 draft 计划后状态变为 in_progress', async () => {
      prisma.improvementPlan.findUnique.mockResolvedValue(makePlan({ status: 'draft' }));
      prisma.improvementPlan.update.mockResolvedValue(
        makePlan({
          status: 'in_progress',
          improvementNeed: 'need',
          improvementGoal: 'goal',
          targetDate: new Date('2026-07-01'),
          measures: [{ description: 'step', responsible: 'mgr', deadline: '2026-07-01' }],
          creatorId: 'viewer-1',
        }),
      );

      const result = await service.fill(
        'plan-1',
        {
          improvementNeed: 'need',
          importance: 'high',
          improvementGoal: 'goal',
          targetDate: '2026-07-01',
          measures: [{ description: 'step', responsible: 'mgr', deadline: '2026-07-01' }],
        },
        makeViewer(),
      );

      expect(result.status).toBe('in_progress');
      expect(prisma.improvementPlan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'in_progress', creatorId: 'viewer-1' }),
        }),
      );
    });

    it('非 draft 状态不可填写', async () => {
      prisma.improvementPlan.findUnique.mockResolvedValue(makePlan({ status: 'completed' }));

      await expect(
        service.fill(
          'plan-1',
          {
            improvementNeed: 'need',
            importance: 'high',
            improvementGoal: 'goal',
            targetDate: '2026-07-01',
            measures: [],
          },
          makeViewer(),
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('complete', () => {
    it('in_progress 计划可录入最终评分并变为 completed', async () => {
      prisma.improvementPlan.findUnique.mockResolvedValue(makePlan({ status: 'in_progress' }));
      prisma.improvementPlan.update.mockResolvedValue(makePlan({ status: 'completed', finalScore: 8 }));

      const result = await service.complete('plan-1', { finalScore: 8 }, makeViewer());

      expect(result.status).toBe('completed');
      expect(result.finalScore).toBe(8);
    });

    it('非 in_progress 状态不可完成', async () => {
      prisma.improvementPlan.findUnique.mockResolvedValue(makePlan({ status: 'draft' }));

      await expect(service.complete('plan-1', { finalScore: 5 }, makeViewer())).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('detectConsecutiveD', () => {
    it('最近两次归档都是 D 时返回预警', async () => {
      prisma.performanceArchive.findMany.mockResolvedValue([
        { cycleId: 'cycle-2', cycle: { name: '2026 Q2' }, grade: 'D', archivedAt: new Date('2026-06-01') },
        { cycleId: 'cycle-1', cycle: { name: '2026 Q1' }, grade: 'D', archivedAt: new Date('2026-03-01') },
      ]);

      const result = await service.detectConsecutiveD('emp-1');

      expect(result.hasWarning).toBe(true);
      expect(result.consecutiveCount).toBe(2);
      expect(result.archives).toHaveLength(2);
    });

    it('仅一次 D 时不预警', async () => {
      prisma.performanceArchive.findMany.mockResolvedValue([
        { cycleId: 'cycle-2', cycle: { name: '2026 Q2' }, grade: 'D', archivedAt: new Date('2026-06-01') },
        { cycleId: 'cycle-1', cycle: { name: '2026 Q1' }, grade: 'C', archivedAt: new Date('2026-03-01') },
      ]);

      const result = await service.detectConsecutiveD('emp-1');

      expect(result.hasWarning).toBe(false);
      expect(result.consecutiveCount).toBe(0);
    });
  });
});
