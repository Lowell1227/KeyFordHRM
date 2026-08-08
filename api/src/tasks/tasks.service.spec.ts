import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AssessmentTask, IndicatorInstance, Prisma, SysRole, TaskStatus } from '@prisma/client';
import { TaskDetail, TasksService } from './tasks.service';
import { PrismaService } from '@/prisma/prisma.service';
import { DataScopeService } from '@/common/services/data-scope.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { ScoringService } from './scoring.service';
import { FlowService } from './flow.service';
import { AuthUser } from '@/common/types/auth.types';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { IndicatorVisibilityService } from './indicator-visibility.service';
import { ObjectivesService } from '@/objectives/objectives.service';

describe('TasksService', () => {
  let service: TasksService;
  let prisma: {
    assessmentTask: {
      findUnique: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    indicatorInstance: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      create: jest.Mock;
    };
    flowRecord: { create: jest.Mock };
    systemConfig: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let dataScope: { getVisibleEmployeeFilter: jest.Mock; getSubDeptIds: jest.Mock };
  let notificationsService: { create: jest.Mock };
  let indicatorVisibility: { validateSelection: jest.Mock };
  let objectivesService: { findVisibleByIds: jest.Mock };
  let transactionClient: {
    assessmentTask: { update: jest.Mock };
    indicatorInstance: { deleteMany: jest.Mock; create: jest.Mock };
    flowRecord: { create: jest.Mock };
  };

  beforeEach(async () => {
    transactionClient = {
      assessmentTask: { update: jest.fn() },
      indicatorInstance: { deleteMany: jest.fn(), create: jest.fn() },
      flowRecord: { create: jest.fn() },
    };
    prisma = {
      assessmentTask: {
        findUnique: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      indicatorInstance: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
      flowRecord: { create: jest.fn() },
      systemConfig: { findUnique: jest.fn() },
      $transaction: jest.fn(async (cb) => cb(transactionClient)),
    };
    dataScope = {
      getVisibleEmployeeFilter: jest.fn().mockResolvedValue({}),
      getSubDeptIds: jest.fn().mockResolvedValue([]),
    };
    notificationsService = { create: jest.fn() };
    indicatorVisibility = {
      validateSelection: jest.fn().mockResolvedValue(undefined),
    };
    objectivesService = { findVisibleByIds: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: prisma },
        { provide: DataScopeService, useValue: dataScope },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: ScoringService, useValue: {} },
        { provide: FlowService, useValue: {} },
        { provide: IndicatorVisibilityService, useValue: indicatorVisibility },
        { provide: ObjectivesService, useValue: objectivesService },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function makeViewer(overrides: Partial<AuthUser> = {}): AuthUser {
    return {
      id: 'user-1',
      sysRole: SysRole.employee,
      deptId: null,
      canViewAll: false,
      ...overrides,
    } as AuthUser;
  }

  function makeTask(status: TaskStatus): AssessmentTask {
    return {
      id: 'task-1',
      cycleId: 'cycle-1',
      snapshotId: 'snap-1',
      employeeId: 'emp-1',
      deptId: 'dept-1',
      managerId: 'mgr-1',
      deptHeadId: 'head-1',
      approverId: 'vp-1',
      status,
      isExempt: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as AssessmentTask;
  }

  function makeIndicator(overrides: Partial<IndicatorInstance> = {}): IndicatorInstance {
    return {
      id: 'ind-1',
      taskId: 'task-1',
      templateIndicatorId: null,
      name: '指标A',
      description: null,
      scoringStandard: null,
      targetValue: new Prisma.Decimal(100),
      unit: null,
      weight: new Prisma.Decimal(0.5),
      indicatorType: 'kpi',
      dimensionName: '维度',
      dimensionWeight: new Prisma.Decimal(1),
      sortOrder: 0,
      actualValue: '90',
      actualNote: null,
      selfScore: new Prisma.Decimal(80),
      selfComment: '自评备注',
      managerScore: new Prisma.Decimal(85),
      managerComment: '主管评语',
      finalScore: new Prisma.Decimal(85),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as IndicatorInstance;
  }

  function buildFullTask(status: TaskStatus, publishVisibleFields: Prisma.JsonValue = null) {
    return {
      ...makeTask(status),
      employee: { name: '员工A' },
      dept: { name: '部门A' },
      indicatorInstances: [makeIndicator()],
      selfEvalSummary: {
        achievements: '成就',
        improvements: null,
        suggestions: null,
        nextGoals: null,
        supportNeeded: null,
        attachments: [],
        submittedAt: new Date(),
      },
      managerEvalSummary: {
        strengths: '优势',
        improvements: null,
        developmentPlan: null,
        submittedAt: new Date(),
      },
      gradeResult: {
        calculatedScore: new Prisma.Decimal(85),
        rawGrade: 'B',
        calibratedGrade: null,
        coefficient: new Prisma.Decimal(1.0),
        isPublished: true,
        employeeConfirmedAt: null,
      },
      flowRecords: [],
      cycle: { publishVisibleFields },
    };
  }

  describe('findOne', () => {
    it('员工本人在公示前看不到主管评分、final_score、总分、等级', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(buildFullTask('manager_scoring'));

      const result = await service.findOne('task-1', makeViewer({ id: 'emp-1' }));

      expect(result.totalScore).toBeNull();
      expect(result.rawGrade).toBeNull();
      expect(result.gradeResult).toBeNull();
      expect(result.managerEvalSummary).toBeNull();

      const ind = result.indicatorInstances[0];
      expect(ind.selfScore).toBe(80);
      expect(ind.selfComment).toBe('自评备注');
      expect(ind.managerScore).toBeNull();
      expect(ind.managerComment).toBeNull();
      expect(ind.finalScore).toBeNull();
    });

    it('员工本人在公示后按 publishVisibleFields 遮蔽', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(
        buildFullTask('published', {
          total_score: true,
          grade: true,
          indicator_scores: false,
          manager_comment: false,
          coefficient: false,
        }),
      );

      const result = await service.findOne('task-1', makeViewer({ id: 'emp-1' }));

      expect(result.totalScore).toBe(85);
      expect(result.rawGrade).toBe('B');
      const ind = result.indicatorInstances[0];
      expect(ind.selfScore).toBe(80);
      expect(ind.managerScore).toBeNull();
      expect(ind.finalScore).toBeNull();
      expect(ind.managerComment).toBeNull();
      expect(result.managerEvalSummary).toBeNull();
      expect(result.gradeResult?.coefficient).toBeNull();
    });

    it('非员工查看不受 D18 遮蔽影响', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(buildFullTask('manager_scoring'));

      const result = await service.findOne('task-1', makeViewer({ id: 'mgr-1' }));

      expect(result.totalScore).toBe(85);
      expect(result.indicatorInstances[0].managerScore).toBe(85);
      expect(result.indicatorInstances[0].finalScore).toBe(85);
    });

    it('无权限查看抛 403', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(buildFullTask('manager_scoring'));

      await expect(service.findOne('task-1', makeViewer({ id: 'other' }))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('任务不存在抛 404', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(null);

      await expect(service.findOne('task-1', makeViewer())).rejects.toThrow(NotFoundException);
    });
  });

  describe('visibility persistence and aligned objectives', () => {
    const updatedAt = new Date('2026-08-08T08:00:00.000Z');

    it('returns only aligned objectives that remain visible to the viewer', async () => {
      const task = buildFullTask('indicator_reviewing');
      task.indicatorInstances = [
        {
          ...makeIndicator(),
          visibilityScope: 'custom',
          visibleDepartments: [{ departmentId: 'dept-2' }],
          visibleUsers: [{ userId: 'user-2' }],
          objectiveAlignments: [
            {
              objectiveId: 'objective-1',
              objective: {
                id: 'objective-1',
                title: 'Visible objective',
                level: 'department',
                ownerId: 'owner-1',
              },
            },
            {
              objectiveId: 'objective-2',
              objective: {
                id: 'objective-2',
                title: 'Protected objective',
                level: 'individual',
                ownerId: 'owner-2',
              },
            },
          ],
        } as any,
      ];
      prisma.assessmentTask.findUnique.mockResolvedValue(task);
      objectivesService.findVisibleByIds.mockResolvedValue([{ id: 'objective-1' }]);

      const result = await service.findOne('task-1', makeViewer({ id: 'mgr-1' }));

      expect(objectivesService.findVisibleByIds).toHaveBeenCalledWith(
        ['objective-1', 'objective-2'],
        expect.objectContaining({ id: 'mgr-1' }),
      );
      expect(result.indicatorInstances[0]).toMatchObject({
        visibilityScope: 'custom',
        visibleDepartmentIds: ['dept-2'],
        visibleUserIds: ['user-2'],
        alignedObjectives: [
          {
            id: 'objective-1',
            title: 'Visible objective',
            level: 'department',
            ownerId: 'owner-1',
          },
        ],
      });
    });

    it('persists deduplicated visibility and objective relations inside the transaction', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue({
        ...makeTask('indicator_reviewing'),
        updatedAt,
      });
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'task-1' } as TaskDetail);

      await service.setIndicators(
        'task-1',
        {
          expectedUpdatedAt: updatedAt.toISOString(),
          action: 'save',
          instances: [
            {
              name: 'Revenue',
              weight: 1,
              visibilityScope: 'custom',
              visibleDepartmentIds: ['dept-2', 'dept-2'],
              visibleUserIds: ['user-2', 'user-2'],
              alignedObjectiveIds: ['objective-1', 'objective-1'],
            },
          ],
        } as any,
        makeViewer({ id: 'mgr-1', sysRole: SysRole.manager }),
      );

      expect(indicatorVisibility.validateSelection).toHaveBeenCalledWith(
        expect.objectContaining({
          visibilityScope: 'custom',
          visibleDepartmentIds: ['dept-2'],
          visibleUserIds: ['user-2'],
          alignedObjectiveIds: ['objective-1'],
        }),
        expect.objectContaining({ id: 'task-1' }),
        expect.objectContaining({ id: 'mgr-1' }),
      );
      expect(transactionClient.indicatorInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visibilityScope: 'custom',
            visibleDepartments: {
              createMany: { data: [{ departmentId: 'dept-2' }] },
            },
            visibleUsers: { createMany: { data: [{ userId: 'user-2' }] } },
            objectiveAlignments: {
              createMany: { data: [{ objectiveId: 'objective-1' }] },
            },
          }),
        }),
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('rejects a stale task version before validation or transactional writes', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue({
        ...makeTask('indicator_reviewing'),
        updatedAt,
      });

      await expect(
        service.setIndicators(
          'task-1',
          {
            expectedUpdatedAt: '2026-08-08T07:59:59.000Z',
            instances: [{ name: 'Revenue', weight: 1, visibilityScope: 'company' }],
          } as any,
          makeViewer({ id: 'mgr-1', sysRole: SysRole.manager }),
        ),
      ).rejects.toThrow(ConflictException);

      expect(indicatorVisibility.validateSelection).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('updateActualValues', () => {
    it('非允许状态抛 4009 冲突异常', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(buildFullTask('indicator_confirming'));

      await expect(
        service.updateActualValues('task-1', { indicators: [] }, makeViewer({ id: 'emp-1' })),
      ).rejects.toThrow(ConflictException);

      try {
        await service.updateActualValues('task-1', { indicators: [] }, makeViewer({ id: 'emp-1' }));
      } catch (err) {
        expect((err as ConflictException).getResponse()).toMatchObject({ code: ERROR_CODE.CONFLICT });
      }
    });
  });
});
