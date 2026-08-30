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
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubmitManagerScoreDto } from './dto/submit-manager-score.dto';
import { SaveManagerEvaluationDraftDto } from './dto/save-manager-evaluation-draft.dto';
import { IndicatorVersionService } from './indicator-version.service';

describe('TasksService', () => {
  let service: TasksService;
  let prisma: {
    assessmentTask: {
      findUnique: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    assessmentCycle: { findUnique: jest.Mock };
    indicatorInstance: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      create: jest.Mock;
    };
    managerEvalSummary: { upsert: jest.Mock; update: jest.Mock };
    gradeResult: { upsert: jest.Mock; findUnique: jest.Mock };
    flowRecord: { create: jest.Mock; findFirst: jest.Mock };
    auditLog: { createMany: jest.Mock };
    systemConfig: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let dataScope: { getVisibleEmployeeFilter: jest.Mock; getSubDeptIds: jest.Mock };
  let notificationsService: {
    create: jest.Mock;
    sendTaskReminder: jest.Mock;
    getReminderCooldownUntil: jest.Mock;
  };
  let indicatorVisibility: { validateSelection: jest.Mock };
  let objectivesService: { findVisibleByIds: jest.Mock };
  let indicatorVersionService: { activateConfirmedV1: jest.Mock };
  let scoringService: {
    validateScore: jest.Mock;
    toScorableIndicator: jest.Mock;
    calcTaskTotal: jest.Mock;
    calcRawGrade: jest.Mock;
  };
  let flowService: { transition: jest.Mock; transitionTx: jest.Mock };
  let transactionClient: {
    assessmentTask: { update: jest.Mock; updateMany: jest.Mock };
    indicatorInstance: {
      update: jest.Mock;
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      create: jest.Mock;
    };
    managerEvalSummary: { upsert: jest.Mock; update: jest.Mock };
    gradeResult: { upsert: jest.Mock; findUnique: jest.Mock };
    systemConfig: { findUnique: jest.Mock };
    flowRecord: { create: jest.Mock; findFirst: jest.Mock };
    auditLog: { createMany: jest.Mock };
  };

  beforeEach(async () => {
    transactionClient = {
      assessmentTask: {
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      indicatorInstance: {
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
      managerEvalSummary: { upsert: jest.fn(), update: jest.fn() },
      gradeResult: { upsert: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      flowRecord: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    prisma = {
      assessmentTask: {
        findUnique: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      assessmentCycle: { findUnique: jest.fn().mockResolvedValue(null) },
      indicatorInstance: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
      managerEvalSummary: transactionClient.managerEvalSummary,
      gradeResult: transactionClient.gradeResult,
      flowRecord: transactionClient.flowRecord,
      auditLog: transactionClient.auditLog,
      systemConfig: { findUnique: jest.fn() },
      $transaction: jest.fn(async (cb) => cb(transactionClient)),
    };
    dataScope = {
      getVisibleEmployeeFilter: jest.fn().mockResolvedValue({}),
      getSubDeptIds: jest.fn().mockResolvedValue([]),
    };
    notificationsService = {
      create: jest.fn(),
      sendTaskReminder: jest.fn().mockResolvedValue('notification-1'),
      getReminderCooldownUntil: jest.fn().mockResolvedValue(null),
    };
    indicatorVisibility = {
      validateSelection: jest.fn().mockResolvedValue(undefined),
    };
    objectivesService = { findVisibleByIds: jest.fn().mockResolvedValue([]) };
    indicatorVersionService = { activateConfirmedV1: jest.fn().mockResolvedValue('version-1') };
    scoringService = {
      validateScore: jest.fn(),
      toScorableIndicator: jest.fn((indicator) => indicator),
      calcTaskTotal: jest.fn().mockReturnValue({ totalScore: 88, rawGrade: 'B', dimensionScores: [] }),
      calcRawGrade: jest.fn().mockReturnValue('B'),
    };
    flowService = { transition: jest.fn(), transitionTx: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: prisma },
        { provide: DataScopeService, useValue: dataScope },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: ScoringService, useValue: scoringService },
        { provide: FlowService, useValue: flowService },
        { provide: IndicatorVisibilityService, useValue: indicatorVisibility },
        { provide: ObjectivesService, useValue: objectivesService },
        { provide: IndicatorVersionService, useValue: indicatorVersionService },
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
      extraScores: [{ label: 'Stretch', value: 2 }],
      finalScore: new Prisma.Decimal(85),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as IndicatorInstance;
  }

  describe('manager evaluation DTO validation', () => {
    it('requires a score on every final indicator item', async () => {
      const dto = plainToInstance(SubmitManagerScoreDto, {
        expectedUpdatedAt: '2026-08-08T08:00:00.000Z',
        indicators: [{ id: '11111111-1111-4111-8111-111111111111' }],
        evalSummary: {},
      });

      const errors = await validate(dto);

      expect(JSON.stringify(errors)).toContain('managerScore');
    });

    it('rejects an extra-score label containing only whitespace', async () => {
      const dto = plainToInstance(SaveManagerEvaluationDraftDto, {
        expectedUpdatedAt: '2026-08-08T08:00:00.000Z',
        indicators: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            extraScores: [{ label: '   ', value: 2 }],
          },
        ],
        evalSummary: {},
      });

      const errors = await validate(dto);

      expect(JSON.stringify(errors)).toContain('label');
    });

    it('trims a valid extra-score label before validation', async () => {
      const dto = plainToInstance(SaveManagerEvaluationDraftDto, {
        expectedUpdatedAt: '2026-08-08T08:00:00.000Z',
        indicators: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            extraScores: [{ label: '  Stretch  ', value: 2 }],
          },
        ],
        evalSummary: {},
      });

      await expect(validate(dto)).resolves.toEqual([]);
      expect(dto.indicators[0].extraScores?.[0].label).toBe('Stretch');
    });

    it('accepts an explicit null draft score and empty clearable text', async () => {
      const dto = plainToInstance(SaveManagerEvaluationDraftDto, {
        expectedUpdatedAt: '2026-08-08T08:00:00.000Z',
        indicators: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            managerScore: null,
            managerComment: '',
          },
        ],
        evalSummary: {
          strengths: '',
          improvements: '',
          developmentPlan: '',
        },
      });

      await expect(validate(dto)).resolves.toEqual([]);
      expect(dto.indicators[0].managerScore).toBeNull();
    });
  });

  function buildFullTask(status: TaskStatus, publishVisibleFields: Prisma.JsonValue = null) {
    return {
      ...makeTask(status),
      employee: { name: '员工A', employeeNo: 'E001' },
      dept: { name: '部门A' },
      manager: { id: 'mgr-1', name: '主管A' },
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
        calibrationNote: null,
        isVeto: true,
        vetoReason: 'Policy breach',
        vetoOperatorId: 'mgr-1',
        vetoOperator: { id: 'mgr-1', name: 'Manager A' },
        coefficient: new Prisma.Decimal(1.0),
        isPublished: true,
        employeeConfirmedAt: null,
      },
      flowRecords: [],
      periods: [],
      cycle: { publishVisibleFields, workflowVersion: 1 },
    };
  }

  describe('findOne', () => {
    it('returns workflow v2 monthly periods so the employee can enter the active review', async () => {
      const task: any = buildFullTask('self_eval');
      const openAt = new Date('2027-02-01T01:00:00.000Z');
      task.cycle.workflowVersion = 2;
      task.periods = [{
        id: 'period-2027-01',
        periodKey: '2027-01',
        periodType: 'month',
        sequence: 1,
        status: 'self_eval',
        selfEvalOpenAt: openAt,
        selfEvalDueAt: new Date('2027-02-03T10:00:00.000Z'),
        managerDueAt: new Date('2027-02-08T10:00:00.000Z'),
        employeeSubmittedAt: null,
        managerSubmittedAt: null,
      }];
      prisma.assessmentTask.findUnique.mockResolvedValue(task);

      const result = await service.findOne('task-1', makeViewer({ id: 'emp-1' }));

      expect(result).toMatchObject({
        workflowVersion: 2,
        employeeNo: 'E001',
        managerName: '主管A',
        periods: [{
          id: 'period-2027-01',
          periodKey: '2027-01',
          status: 'self_eval',
          selfEvalOpenAt: openAt,
        }],
      });
    });

    it('returns the exemption flag and reason for an exempt employee task', async () => {
      const task: any = buildFullTask('exempted');
      task.isExempt = true;
      task.exemptReason = 'HR 在本周期中明确设置为豁免';
      task.indicatorInstances = [];
      prisma.assessmentTask.findUnique.mockResolvedValue(task);

      const result = await service.findOne('task-1', makeViewer({ id: 'emp-1' }));

      expect(result).toMatchObject({
        status: 'exempted',
        isExempt: true,
        exemptReason: 'HR 在本周期中明确设置为豁免',
      });
    });

    it('返回当前处理人、截止时间与催办能力', async () => {
      const deadline = new Date('2026-12-29T00:00:00.000Z');
      const task: any = buildFullTask('indicator_reviewing');
      task.manager = { id: 'mgr-1', name: '王主管' };
      task.deptHead = { id: 'head-1', name: '李负责人' };
      task.approver = { id: 'vp-1', name: '陈审批人' };
      task.cycle = {
        ...task.cycle,
        name: '2027 Q1',
        deadlineIndicatorSetting: deadline,
      };
      prisma.assessmentTask.findUnique.mockResolvedValue(task);

      const result = await service.findOne('task-1', makeViewer({ id: 'emp-1' }));

      expect(result.workflowContext).toMatchObject({
        stage: 'goal_setting',
        statusLabel: '待主管审核目标',
        currentHandler: { id: 'mgr-1', name: '王主管', nodeType: 'manager' },
        currentDeadline: deadline,
        canRemind: true,
        reminderNodeType: 'manager',
      });
    });

    it('目标确认后、自评未开放时清晰标识等待状态', async () => {
      const selfEvalOpenAt = new Date('2027-04-01T00:00:00.000Z');
      const task: any = buildFullTask('goal_confirmed');
      task.cycle = { ...task.cycle, name: '2027 Q1', selfEvalOpenAt };
      prisma.assessmentTask.findUnique.mockResolvedValue(task);

      const result = await service.findOne('task-1', makeViewer({ id: 'emp-1' }));

      expect(result.workflowContext).toMatchObject({
        stage: 'goal_setting',
        statusLabel: '目标已确认，待自评开放',
        currentHandler: null,
        currentDeadline: selfEvalOpenAt,
        canRemind: false,
      });
    });

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
      expect(ind.extraScores).toEqual([]);
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
      expect(ind.extraScores).toEqual([]);
      expect(ind.managerComment).toBeNull();
      expect(result.managerEvalSummary).toBeNull();
      expect(result.gradeResult?.coefficient).toBeNull();
      expect(result.gradeResult).toMatchObject({
        isVeto: false,
        vetoReason: null,
        vetoOperatorId: null,
        vetoOperatorName: null,
      });
    });

    it('非员工查看不受 D18 遮蔽影响', async () => {
      const managerScoredAt = new Date('2026-08-08T07:55:00.000Z');
      const task = buildFullTask('manager_scoring');
      task.managerScoredAt = managerScoredAt;
      task.indicatorInstances[0].extraScores = [{ label: 'Stretch', value: 2 }];
      prisma.assessmentTask.findUnique.mockResolvedValue(task);

      const result = await service.findOne('task-1', makeViewer({ id: 'mgr-1' }));

      expect(result.totalScore).toBe(85);
      expect(result.managerScoredAt).toEqual(managerScoredAt);
      expect(result.indicatorInstances[0].managerScore).toBe(85);
      expect(result.indicatorInstances[0].finalScore).toBe(85);
      expect(result.indicatorInstances[0].extraScores).toEqual([{ label: 'Stretch', value: 2 }]);
      expect(result.gradeResult).toMatchObject({
        isVeto: true,
        vetoReason: 'Policy breach',
        vetoOperatorId: 'mgr-1',
        vetoOperatorName: 'Manager A',
      });
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

  describe('remindCurrentHandler', () => {
    it('员工可催办当前审核目标的主管', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(makeTask('indicator_reviewing'));

      await expect(
        service.remindCurrentHandler('task-1', makeViewer({ id: 'emp-1' })),
      ).resolves.toEqual({ sent: true, nodeType: 'manager' });
      expect(notificationsService.sendTaskReminder).toHaveBeenCalledWith(
        'task-1',
        'manager',
        'emp-1',
      );
    });

    it('当前处理人不能催办自己', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(makeTask('indicator_reviewing'));

      await expect(
        service.remindCurrentHandler(
          'task-1',
          makeViewer({ id: 'mgr-1', sysRole: SysRole.manager }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('目标已确认等待自评开放时不可催办', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(makeTask('goal_confirmed'));

      await expect(
        service.remindCurrentHandler('task-1', makeViewer({ id: 'emp-1' })),
      ).rejects.toThrow(ConflictException);
    });

    it('员工可催办当前负责校准的 HR', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue({
        ...makeTask('hr_calibration'),
        cycle: { hrOwnerId: 'hr-1', hrOwner: { id: 'hr-1', name: '王小华' } },
      } as any);

      await expect(
        service.remindCurrentHandler('task-1', makeViewer({ id: 'emp-1' })),
      ).resolves.toEqual({ sent: true, nodeType: 'hr' });
      expect(notificationsService.sendTaskReminder).toHaveBeenCalledWith(
        'task-1',
        'hr',
        'emp-1',
      );
    });
  });

  describe('visibility persistence and aligned objectives', () => {
    const updatedAt = new Date('2026-08-08T08:00:00.000Z');

    it('allows an HR administrator to save their own goal draft as the employee', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue({
        ...makeTask('indicator_drafting'),
        updatedAt,
      });
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'task-1' } as TaskDetail);

      await expect(service.setIndicators(
        'task-1',
        {
          expectedUpdatedAt: updatedAt.toISOString(),
          action: 'save',
          instances: [{ name: 'Quarterly delivery', weight: 1, visibilityScope: 'company' }],
        } as any,
        makeViewer({ id: 'emp-1', sysRole: SysRole.hr }),
      )).resolves.toEqual({ id: 'task-1' });

      expect(transactionClient.indicatorInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Quarterly delivery' }),
        }),
      );
    });

    it('rejects a submitted goal set whose weights do not total 100 percent', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue({
        ...makeTask('indicator_setting'),
        updatedAt,
      });
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'task-1' } as TaskDetail);

      await expect(service.setIndicators(
        'task-1',
        {
          expectedUpdatedAt: updatedAt.toISOString(),
          action: 'submit',
          instances: [{
            name: 'Quarterly delivery',
            weight: 0.8,
            visibilityScope: 'company',
            visibleDepartmentIds: [],
            visibleUserIds: [],
            alignedObjectiveIds: [],
          }],
        } as any,
        makeViewer({ id: 'emp-1' }),
      )).rejects.toMatchObject({
        response: expect.objectContaining({ message: '提交目标前权重合计必须为 100%' }),
      });

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('preserves a partial weight when saving a goal draft', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue({
        ...makeTask('indicator_setting'),
        updatedAt,
      });
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'task-1' } as TaskDetail);

      await service.setIndicators(
        'task-1',
        {
          expectedUpdatedAt: updatedAt.toISOString(),
          action: 'save',
          instances: [{
            name: 'Quarterly delivery',
            weight: 0.8,
            visibilityScope: 'company',
            visibleDepartmentIds: [],
            visibleUserIds: [],
            alignedObjectiveIds: [],
          }],
        } as any,
        makeViewer({ id: 'emp-1' }),
      );

      expect(transactionClient.indicatorInstance.create.mock.calls[0][0].data.weight.toString()).toBe('0.8');
    });

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
      expect(transactionClient.assessmentTask.updateMany).toHaveBeenCalledWith({
        where: { id: 'task-1', updatedAt },
        data: { updatedAt: expect.any(Date) },
      });
      expect(transactionClient.assessmentTask.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        transactionClient.indicatorInstance.deleteMany.mock.invocationCallOrder[0],
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('allows only one concurrent replacement to commit for the same task version', async () => {
      const task = { ...makeTask('indicator_reviewing'), updatedAt };
      prisma.assessmentTask.findUnique.mockResolvedValue(task);
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'task-1' } as TaskDetail);

      let storedVersion = updatedAt.toISOString();
      const committedIndicators: string[] = [];
      prisma.$transaction.mockImplementation(async (callback) => {
        const stagedIndicators: string[] = [];
        const tx = {
          assessmentTask: {
            updateMany: jest.fn(async ({ where, data }) => {
              const expected = (where.updatedAt as Date).toISOString();
              if (expected !== storedVersion) return { count: 0 };
              storedVersion = (data.updatedAt as Date).toISOString();
              return { count: 1 };
            }),
            update: jest.fn().mockResolvedValue(task),
          },
          indicatorInstance: {
            deleteMany: jest.fn(),
            create: jest.fn(async ({ data }) => {
              stagedIndicators.push(data.name);
            }),
          },
          flowRecord: { create: jest.fn() },
        };

        const result = await callback(tx);
        committedIndicators.push(...stagedIndicators);
        return result;
      });

      const dto = {
        expectedUpdatedAt: updatedAt.toISOString(),
        action: 'save' as const,
        instances: [
          {
            name: 'Revenue',
            weight: 1,
            visibilityScope: 'company' as const,
            visibleDepartmentIds: [],
            visibleUserIds: [],
            alignedObjectiveIds: [],
          },
        ],
      };

      const results = await Promise.allSettled([
        service.setIndicators('task-1', dto, makeViewer({ id: 'mgr-1', sysRole: SysRole.manager })),
        service.setIndicators('task-1', dto, makeViewer({ id: 'mgr-1', sysRole: SysRole.manager })),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictException);
      expect((rejected.reason as ConflictException).getResponse()).toMatchObject({
        code: ERROR_CODE.CONFLICT,
      });
      expect(committedIndicators).toEqual(['Revenue']);
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

  describe('manager evaluation draft', () => {
    const updatedAt = new Date('2026-08-08T08:00:00.000Z');

    it('saves only supplied indicator fields and summary text without grading or transitioning', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue({
        ...makeTask('manager_scoring'),
        updatedAt,
      });

      const result = await service.saveManagerEvaluationDraft(
        'task-1',
        {
          expectedUpdatedAt: updatedAt.toISOString(),
          indicators: [
            { id: 'ind-1', managerScore: 88 },
            { id: 'ind-2', managerComment: 'Needs stronger follow-through' },
          ],
          evalSummary: { strengths: 'Reliable delivery' },
        },
        makeViewer({ id: 'mgr-1', sysRole: SysRole.manager }),
      );

      expect(result).toEqual(expect.objectContaining({
        id: 'task-1',
        status: 'manager_scoring',
        updatedAt: expect.any(String),
      }));
      expect(transactionClient.assessmentTask.updateMany).toHaveBeenCalledWith({
        where: { id: 'task-1', updatedAt },
        data: { updatedAt: expect.any(Date) },
      });
      expect(transactionClient.indicatorInstance.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'ind-1', taskId: 'task-1' },
        data: { managerScore: 88 },
      });
      expect(transactionClient.indicatorInstance.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'ind-2', taskId: 'task-1' },
        data: { managerComment: 'Needs stronger follow-through' },
      });
      expect(transactionClient.managerEvalSummary.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ taskId: 'task-1', submittedAt: null }),
          update: expect.objectContaining({ submittedAt: null }),
        }),
      );
      expect(transactionClient.assessmentTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { updatedAt: expect.any(Date) },
      });
      expect(transactionClient.flowRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: 'task-1',
          action: 'comment',
          extraData: { type: 'manager_evaluation_draft_saved' },
        }),
      });
      expect(transactionClient.gradeResult.upsert).not.toHaveBeenCalled();
      expect(flowService.transitionTx).not.toHaveBeenCalled();
      expect(transactionClient.assessmentTask.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        transactionClient.indicatorInstance.update.mock.invocationCallOrder[0],
      );
    });

    it('persists explicit clears and returns the claimed task version', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue({
        ...makeTask('manager_scoring'),
        updatedAt,
      });

      const result = await service.saveManagerEvaluationDraft(
        'task-1',
        {
          expectedUpdatedAt: updatedAt.toISOString(),
          indicators: [
            { id: 'ind-1', managerScore: null, managerComment: '' },
          ],
          evalSummary: {
            strengths: '',
            improvements: '',
            developmentPlan: '',
          },
        },
        makeViewer({ id: 'mgr-1', sysRole: SysRole.manager }),
      );

      const claimedUpdatedAt = transactionClient.assessmentTask.updateMany.mock.calls[0][0].data.updatedAt as Date;
      expect(result).toEqual({
        id: 'task-1',
        status: 'manager_scoring',
        updatedAt: claimedUpdatedAt.toISOString(),
      });
      expect(scoringService.validateScore).not.toHaveBeenCalled();
      expect(transactionClient.indicatorInstance.update).toHaveBeenCalledWith({
        where: { id: 'ind-1', taskId: 'task-1' },
        data: { managerScore: null, managerComment: '' },
      });
      expect(transactionClient.managerEvalSummary.upsert).toHaveBeenCalledWith(expect.objectContaining({
        update: expect.objectContaining({
          strengths: null,
          improvements: null,
          developmentPlan: null,
        }),
      }));
    });

    it('rejects a draft from anyone other than the assigned manager', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue({ ...makeTask('manager_scoring'), updatedAt });

      await expect(
        service.saveManagerEvaluationDraft(
          'task-1',
          { expectedUpdatedAt: updatedAt.toISOString(), indicators: [], evalSummary: {} },
          makeViewer({ id: 'other-manager', sysRole: SysRole.manager }),
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a draft outside manager_scoring', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue({ ...makeTask('dept_review'), updatedAt });

      await expect(
        service.saveManagerEvaluationDraft(
          'task-1',
          { expectedUpdatedAt: updatedAt.toISOString(), indicators: [], evalSummary: {} },
          makeViewer({ id: 'mgr-1', sysRole: SysRole.manager }),
        ),
      ).rejects.toThrow(ConflictException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects the legacy task-level draft when a workflow v2 period must be scored', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue({
        ...makeTask('manager_scoring'),
        updatedAt,
        cycle: { workflowVersion: 2 },
        periods: [{ id: 'period-august', status: 'manager_scoring' }],
      });

      await expect(
        service.saveManagerEvaluationDraft(
          'task-1',
          { expectedUpdatedAt: updatedAt.toISOString(), indicators: [], evalSummary: {} },
          makeViewer({ id: 'mgr-1', sysRole: SysRole.manager }),
        ),
      ).rejects.toThrow('请在本期复盘中完成主管评分');

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a stale draft before transactional writes', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue({ ...makeTask('manager_scoring'), updatedAt });

      await expect(
        service.saveManagerEvaluationDraft(
          'task-1',
          { expectedUpdatedAt: '2026-08-08T07:59:59.000Z', indicators: [], evalSummary: {} },
          makeViewer({ id: 'mgr-1', sysRole: SysRole.manager }),
        ),
      ).rejects.toThrow(ConflictException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('final manager evaluation', () => {
    const updatedAt = new Date('2026-08-08T08:00:00.000Z');
    const manager = () => makeViewer({ id: 'mgr-1', sysRole: SysRole.manager });
    const submittedIndicators = [
      { id: 'ind-1', managerScore: 88, managerComment: 'Met expectations' },
      { id: 'ind-2', managerScore: 92, managerComment: 'Strong ownership' },
    ];

    function scoringTask(status: TaskStatus = 'manager_scoring') {
      return {
        ...makeTask(status),
        updatedAt,
        snapshot: { snapshotData: { maxScore: 100 } },
        indicatorInstances: [
          { id: 'ind-1', indicatorType: 'kpi' },
          { id: 'ind-2', indicatorType: 'attitude' },
          { id: 'veto-1', indicatorType: 'veto' },
        ],
      };
    }

    it('claims the task version, persists every score, calculates the total, and transitions once', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(scoringTask());
      transactionClient.indicatorInstance.findMany.mockResolvedValue([
        makeIndicator({ id: 'ind-1', managerScore: new Prisma.Decimal(88), finalScore: new Prisma.Decimal(88) }),
        makeIndicator({ id: 'ind-2', managerScore: new Prisma.Decimal(92), finalScore: new Prisma.Decimal(92) }),
      ]);

      const result = await service.submitManagerScore(
        'task-1',
        {
          expectedUpdatedAt: updatedAt.toISOString(),
          indicators: submittedIndicators,
          evalSummary: { strengths: 'Strong execution' },
        },
        manager(),
      );

      expect(result).toEqual({ id: 'task-1', status: 'dept_review' });
      expect(scoringService.validateScore).toHaveBeenCalledTimes(2);
      expect(scoringService.calcTaskTotal).toHaveBeenCalledTimes(1);
      expect(transactionClient.gradeResult.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            calculatedScore: 88,
            rawGrade: 'B',
            calibratedGrade: null,
            calibrationNote: null,
            coefficient: null,
            hrCalibratorId: null,
            hrCalibratedAt: null,
            isVeto: false,
            vetoReason: null,
            vetoOperatorId: null,
          }),
          update: expect.objectContaining({
            calculatedScore: 88,
            rawGrade: 'B',
            calibratedGrade: null,
            calibrationNote: null,
            coefficient: null,
            hrCalibratorId: null,
            hrCalibratedAt: null,
            isVeto: false,
            vetoReason: null,
            vetoOperatorId: null,
          }),
        }),
      );
      expect(flowService.transitionTx).toHaveBeenCalledWith(
        transactionClient,
        expect.objectContaining({
          action: 'submit',
          targetStatus: 'dept_review',
          taskUpdate: expect.objectContaining({
            managerScoredAt: expect.any(Date),
            updatedAt: expect.any(Date),
          }),
        }),
      );
      expect(transactionClient.assessmentTask.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        transactionClient.indicatorInstance.update.mock.invocationCallOrder[0],
      );
    });

    it('rejects a veto before grading when the task has no veto indicator', async () => {
      const task = scoringTask();
      task.indicatorInstances = task.indicatorInstances.filter((indicator) => indicator.indicatorType !== 'veto');
      prisma.assessmentTask.findUnique.mockResolvedValue(task);

      await expect(
        service.submitManagerScore(
          'task-1',
          {
            expectedUpdatedAt: updatedAt.toISOString(),
            indicators: submittedIndicators,
            evalSummary: {},
            veto: { isVeto: true, vetoReason: 'Policy breach' },
          },
          manager(),
        ),
      ).rejects.toThrow(ConflictException);

      expect(scoringService.validateScore).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('preserves a valid manager veto while clearing stale HR calibration ownership', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(scoringTask());
      transactionClient.indicatorInstance.findMany.mockResolvedValue([
        makeIndicator({ id: 'ind-1' }),
        makeIndicator({ id: 'ind-2' }),
      ]);

      await service.submitManagerScore(
        'task-1',
        {
          expectedUpdatedAt: updatedAt.toISOString(),
          indicators: submittedIndicators,
          evalSummary: {},
          veto: { isVeto: true, vetoReason: ' Policy breach ' },
        },
        manager(),
      );

      expect(transactionClient.gradeResult.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            calibratedGrade: 'D',
            calibrationNote: null,
            coefficient: null,
            hrCalibratorId: null,
            hrCalibratedAt: null,
            isVeto: true,
            vetoReason: 'Policy breach',
            vetoOperatorId: 'mgr-1',
          }),
        }),
      );
    });

    it('rejects final submission when any non-veto indicator score is omitted', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(scoringTask());

      await expect(
        service.submitManagerScore(
          'task-1',
          {
            expectedUpdatedAt: updatedAt.toISOString(),
            indicators: [submittedIndicators[0]],
            evalSummary: {},
          },
          manager(),
        ),
      ).rejects.toThrow(ConflictException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects final submission outside manager_scoring', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(scoringTask('dept_review'));

      await expect(
        service.submitManagerScore(
          'task-1',
          {
            expectedUpdatedAt: updatedAt.toISOString(),
            indicators: submittedIndicators,
            evalSummary: {},
          },
          manager(),
        ),
      ).rejects.toThrow(ConflictException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects the legacy task-level submission when a workflow v2 period must be scored', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue({
        ...scoringTask(),
        cycle: { workflowVersion: 2 },
        periods: [{ id: 'period-august', status: 'manager_scoring' }],
      });

      await expect(
        service.submitManagerScore(
          'task-1',
          {
            expectedUpdatedAt: updatedAt.toISOString(),
            indicators: submittedIndicators,
            evalSummary: {},
          },
          manager(),
        ),
      ).rejects.toThrow('请在本期复盘中完成主管评分');

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects final submission with a stale task version', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(scoringTask());

      await expect(
        service.submitManagerScore(
          'task-1',
          {
            expectedUpdatedAt: '2026-08-08T07:59:59.000Z',
            indicators: submittedIndicators,
            evalSummary: {},
          },
          manager(),
        ),
      ).rejects.toThrow(ConflictException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('keeps a committed final submission successful when notification delivery fails', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(scoringTask());
      transactionClient.indicatorInstance.findMany.mockResolvedValue([
        makeIndicator({ id: 'ind-1' }),
        makeIndicator({ id: 'ind-2' }),
      ]);
      notificationsService.create.mockRejectedValue(new Error('notification unavailable'));
      jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

      await expect(
        service.submitManagerScore(
          'task-1',
          {
            expectedUpdatedAt: updatedAt.toISOString(),
            indicators: submittedIndicators,
            evalSummary: {},
          },
          manager(),
        ),
      ).resolves.toEqual({ id: 'task-1', status: 'dept_review' });
    });
  });

  describe('manager evaluation withdrawal', () => {
    const updatedAt = new Date('2026-08-08T08:00:00.000Z');
    const managerScoredAt = new Date('2026-08-08T07:55:00.000Z');
    const manager = () => makeViewer({ id: 'mgr-1', sysRole: SysRole.manager });

    function withdrawableTask(status: TaskStatus = 'dept_review') {
      return {
        ...makeTask(status),
        deptHeadId: status === 'hr_calibration' ? 'mgr-1' : 'head-1',
        updatedAt,
        managerScoredAt,
        deptReviewedAt: null,
        hrCalibratedAt: null,
      } as AssessmentTask;
    }

    it.each(['dept_review', 'hr_calibration'] as TaskStatus[])(
      'withdraws from untouched %s while preserving evaluation data',
      async (status) => {
        prisma.assessmentTask.findUnique.mockResolvedValue(withdrawableTask(status));

        const result = await service.withdrawManagerScore(
          'task-1',
          { expectedUpdatedAt: updatedAt.toISOString() },
          manager(),
        );

        expect(result).toEqual(expect.objectContaining({
          id: 'task-1',
          status: 'manager_scoring',
          updatedAt: expect.any(String),
        }));
        expect(transactionClient.flowRecord.findFirst).toHaveBeenCalledWith({
          where: {
            taskId: 'task-1',
            createdAt: { gt: managerScoredAt },
            nodeType: {
              in: ['dept_review', 'hr_calibration', 'approval', 'publish', 'employee_confirm', 'appeal'],
            },
          },
          select: { id: true },
        });
        expect(transactionClient.gradeResult.findUnique).toHaveBeenCalledWith({
          where: { taskId: 'task-1' },
          select: {
            calibratedGrade: true,
            calibrationNote: true,
            coefficient: true,
            hrCalibratorId: true,
            hrCalibratedAt: true,
            isVeto: true,
            vetoOperatorId: true,
          },
        });
        expect(transactionClient.assessmentTask.update).toHaveBeenCalledWith({
          where: { id: 'task-1' },
          data: {
            status: 'manager_scoring',
            managerScoredAt: null,
            updatedAt: expect.any(Date),
          },
        });
        expect(transactionClient.managerEvalSummary.update).toHaveBeenCalledWith({
          where: { taskId: 'task-1' },
          data: { submittedAt: null },
        });
        expect(transactionClient.flowRecord.create).toHaveBeenCalledWith({
          data: {
            taskId: 'task-1',
            cycleId: 'cycle-1',
            nodeType: 'manager_score',
            actorId: 'mgr-1',
            action: 'withdraw',
            extraData: { type: 'manager_score_withdrawn' },
          },
        });
        expect(transactionClient.indicatorInstance.update).not.toHaveBeenCalled();
        expect(transactionClient.gradeResult.upsert).not.toHaveBeenCalled();
        expect(transactionClient.assessmentTask.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
          transactionClient.flowRecord.findFirst.mock.invocationCallOrder[0],
        );
      },
    );

    it('rejects withdrawal by the wrong manager', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(withdrawableTask());

      await expect(
        service.withdrawManagerScore(
          'task-1',
          { expectedUpdatedAt: updatedAt.toISOString() },
          makeViewer({ id: 'other-manager', sysRole: SysRole.manager }),
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects withdrawal with a stale task version', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(withdrawableTask());

      await expect(
        service.withdrawManagerScore(
          'task-1',
          { expectedUpdatedAt: '2026-08-08T07:59:59.000Z' },
          manager(),
        ),
      ).rejects.toThrow(ConflictException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects withdrawal from any status other than the immediate next node', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(withdrawableTask('approval'));

      await expect(
        service.withdrawManagerScore(
          'task-1',
          { expectedUpdatedAt: updatedAt.toISOString() },
          manager(),
        ),
      ).rejects.toThrow(ConflictException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each(['deptReviewedAt', 'hrCalibratedAt'] as const)(
      'rejects withdrawal when %s records downstream processing',
      async (field) => {
        prisma.assessmentTask.findUnique.mockResolvedValue({
          ...withdrawableTask('hr_calibration'),
          [field]: new Date('2026-08-08T07:57:00.000Z'),
        });

        await expect(
          service.withdrawManagerScore(
            'task-1',
            { expectedUpdatedAt: updatedAt.toISOString() },
            manager(),
          ),
        ).rejects.toThrow(ConflictException);

        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it('rejects withdrawal when a downstream flow action exists after manager scoring', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(withdrawableTask());
      transactionClient.flowRecord.findFirst.mockResolvedValue({ id: 'flow-1' });

      await expect(
        service.withdrawManagerScore(
          'task-1',
          { expectedUpdatedAt: updatedAt.toISOString() },
          manager(),
        ),
      ).rejects.toThrow(ConflictException);

      expect(transactionClient.assessmentTask.update).not.toHaveBeenCalled();
      expect(transactionClient.flowRecord.create).not.toHaveBeenCalled();
    });

    it.each([
      ['hrCalibratedAt', { hrCalibratedAt: new Date('2026-08-08T07:57:00.000Z') }],
      ['hrCalibratorId', { hrCalibratorId: 'hr-1' }],
      ['coefficient', { coefficient: new Prisma.Decimal(1.2) }],
      ['calibrationNote', { calibrationNote: 'Draft note' }],
      ['calibratedGrade', { calibratedGrade: 'A' }],
    ])('rejects withdrawal when GradeResult contains the HR %s signal', async (_signal, gradeResult) => {
      prisma.assessmentTask.findUnique.mockResolvedValue(withdrawableTask('hr_calibration'));
      transactionClient.gradeResult.findUnique.mockResolvedValue({
        calibratedGrade: null,
        calibrationNote: null,
        coefficient: null,
        hrCalibratorId: null,
        hrCalibratedAt: null,
        isVeto: false,
        vetoOperatorId: null,
        ...gradeResult,
      });

      await expect(
        service.withdrawManagerScore(
          'task-1',
          { expectedUpdatedAt: updatedAt.toISOString() },
          manager(),
        ),
      ).rejects.toThrow(ConflictException);

      expect(transactionClient.assessmentTask.update).not.toHaveBeenCalled();
      expect(transactionClient.flowRecord.create).not.toHaveBeenCalled();
    });

    it('allows withdrawal of manager-owned veto state so it can be restored as a draft', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(withdrawableTask('hr_calibration'));
      transactionClient.gradeResult.findUnique.mockResolvedValue({
        calibratedGrade: 'D',
        calibrationNote: null,
        coefficient: null,
        hrCalibratorId: null,
        hrCalibratedAt: null,
        isVeto: true,
        vetoOperatorId: 'mgr-1',
      });

      await expect(
        service.withdrawManagerScore(
          'task-1',
          { expectedUpdatedAt: updatedAt.toISOString() },
          manager(),
        ),
      ).resolves.toEqual(expect.objectContaining({
        id: 'task-1',
        status: 'manager_scoring',
        updatedAt: expect.any(String),
      }));

      expect(transactionClient.gradeResult.upsert).not.toHaveBeenCalled();
    });
  });

  describe('department review transition claim', () => {
    it('claims the current department-review status and version before transitioning', async () => {
      const updatedAt = new Date('2026-08-08T08:00:00.000Z');
      prisma.assessmentTask.findUnique.mockResolvedValue({ ...makeTask('dept_review'), updatedAt });

      await service.deptReview(
        'task-1',
        { action: 'approve', comment: 'Approved' },
        makeViewer({ id: 'head-1', sysRole: SysRole.manager }),
      );

      expect(transactionClient.assessmentTask.updateMany).toHaveBeenCalledWith({
        where: { id: 'task-1', updatedAt, status: 'dept_review' },
        data: { updatedAt: expect.any(Date) },
      });
      expect(flowService.transitionTx).toHaveBeenCalledWith(
        transactionClient,
        expect.objectContaining({
          action: 'approve',
          targetStatus: 'hr_calibration',
          taskUpdate: expect.objectContaining({ updatedAt: expect.any(Date) }),
        }),
      );
      expect(transactionClient.assessmentTask.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        flowService.transitionTx.mock.invocationCallOrder[0],
      );
    });

    it('also claims the current status and version before rejecting', async () => {
      const updatedAt = new Date('2026-08-08T08:00:00.000Z');
      prisma.assessmentTask.findUnique.mockResolvedValue({ ...makeTask('dept_review'), updatedAt });

      await service.deptReview(
        'task-1',
        { action: 'reject', comment: 'Revise' },
        makeViewer({ id: 'head-1', sysRole: SysRole.manager }),
      );

      expect(transactionClient.assessmentTask.updateMany).toHaveBeenCalledWith({
        where: { id: 'task-1', updatedAt, status: 'dept_review' },
        data: { updatedAt: expect.any(Date) },
      });
      expect(flowService.transitionTx).toHaveBeenCalledWith(
        transactionClient,
        expect.objectContaining({
          action: 'reject',
          targetStatus: 'manager_scoring',
          taskUpdate: expect.objectContaining({ updatedAt: expect.any(Date) }),
        }),
      );
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

  describe('goal confirmation self-evaluation gate', () => {
    it('creates the approved V1 baseline only when the employee confirms the goal', async () => {
      const confirmedAt = new Date('2026-12-28T08:00:00.000Z');
      prisma.assessmentTask.findUnique.mockResolvedValue(makeTask('indicator_confirming'));
      prisma.assessmentCycle.findUnique.mockResolvedValue({ selfEvalOpenAt: new Date('2027-04-01T00:00:00.000Z') });
      transactionClient.indicatorInstance.findMany.mockResolvedValue([
        {
          ...makeIndicator({
            id: 'ind-1',
            name: '产品按期上线',
            description: '完成产品开发和客户验证',
            targetValue: new Prisma.Decimal(3),
            weight: new Prisma.Decimal(0.6),
          }),
          templateIndicatorId: 'template-ind-1',
          visibleDepartments: [{ departmentId: 'dept-2' }, { departmentId: 'dept-1' }],
          visibleUsers: [{ userId: 'user-2' }, { userId: 'user-1' }],
          objectiveAlignments: [{ objectiveId: 'objective-2' }, { objectiveId: 'objective-1' }],
        },
      ]);
      flowService.transitionTx.mockResolvedValue({ newStatus: 'goal_confirmed' });
      jest.useFakeTimers().setSystemTime(confirmedAt);

      await service.confirmIndicators('task-1', makeViewer({ id: 'emp-1' }));

      expect(transactionClient.assessmentTask.updateMany).toHaveBeenCalledWith({
        where: { id: 'task-1', status: TaskStatus.indicator_confirming },
        data: { indicatorConfirmedAt: confirmedAt },
      });
      expect(transactionClient.indicatorInstance.findMany).toHaveBeenCalledWith({
        where: { taskId: 'task-1' },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: {
          visibleDepartments: {
            orderBy: { departmentId: 'asc' },
            select: { departmentId: true },
          },
          visibleUsers: {
            orderBy: { userId: 'asc' },
            select: { userId: true },
          },
          objectiveAlignments: {
            orderBy: { objectiveId: 'asc' },
            select: { objectiveId: true },
          },
        },
      });
      expect(transactionClient.auditLog.createMany).toHaveBeenCalledWith({
        data: [{
          userId: 'emp-1',
          action: 'indicator_baseline_confirmed',
          entityType: 'indicator_instance',
          entityId: 'ind-1',
          oldValue: Prisma.JsonNull,
          newValue: expect.objectContaining({
            version: 1,
            name: '产品按期上线',
            description: '完成产品开发和客户验证',
            targetValue: 3,
            weight: 0.6,
            templateIndicatorId: 'template-ind-1',
            visibleDepartmentIds: ['dept-1', 'dept-2'],
            visibleUserIds: ['user-1', 'user-2'],
            alignedObjectiveIds: ['objective-1', 'objective-2'],
          }),
        }],
      });
      expect(flowService.transitionTx).toHaveBeenCalledWith(
        transactionClient,
        expect.objectContaining({
          targetStatus: 'goal_confirmed',
          taskUpdate: { indicatorConfirmedAt: confirmedAt },
        }),
      );
      jest.useRealTimers();
    });

    it('rejects a repeated confirmation before writing another V1 baseline', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(makeTask('indicator_confirming'));
      prisma.assessmentCycle.findUnique.mockResolvedValue({ selfEvalOpenAt: null });
      transactionClient.assessmentTask.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.confirmIndicators('task-1', makeViewer({ id: 'emp-1' })),
      ).rejects.toThrow(ConflictException);

      expect(transactionClient.auditLog.createMany).not.toHaveBeenCalled();
      expect(flowService.transitionTx).not.toHaveBeenCalled();
    });

    it('activates the frozen period indicator version for workflow v2', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(makeTask('indicator_confirming'));
      prisma.assessmentCycle.findUnique.mockResolvedValue({
        selfEvalOpenAt: new Date('2027-04-01T00:00:00.000Z'),
        workflowVersion: 2,
      });
      transactionClient.indicatorInstance.findMany.mockResolvedValue([{
        ...makeIndicator({ id: 'ind-1' }),
        visibleDepartments: [],
        visibleUsers: [],
        objectiveAlignments: [],
      }]);
      flowService.transitionTx.mockResolvedValue({ newStatus: 'goal_confirmed' });

      await service.confirmIndicators('task-1', makeViewer({ id: 'emp-1' }));

      expect(indicatorVersionService.activateConfirmedV1).toHaveBeenCalledWith(
        transactionClient,
        'task-1',
        'emp-1',
      );
    });

    it('does not let a stale rejection overwrite a concurrently confirmed baseline', async () => {
      const staleTask = makeTask('indicator_confirming');
      prisma.assessmentTask.findUnique.mockResolvedValue(staleTask);
      transactionClient.assessmentTask.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.rejectIndicators('task-1', '需要调整', makeViewer({ id: 'emp-1' })),
      ).rejects.toThrow(ConflictException);

      expect(transactionClient.assessmentTask.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'task-1',
          updatedAt: staleTask.updatedAt,
          status: TaskStatus.indicator_confirming,
        },
        data: { updatedAt: expect.any(Date) },
      });
      expect(flowService.transitionTx).not.toHaveBeenCalled();
      expect(flowService.transition).not.toHaveBeenCalled();
    });

    it('keeps a confirmed goal waiting when self evaluation has not opened', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(makeTask('indicator_confirming'));
      prisma.assessmentCycle.findUnique.mockResolvedValue({
        selfEvalOpenAt: new Date('2027-04-01T00:00:00.000Z'),
      });
      flowService.transitionTx.mockResolvedValue({ newStatus: 'goal_confirmed' });
      jest.useFakeTimers().setSystemTime(new Date('2026-12-28T08:00:00.000Z'));

      await expect(service.confirmIndicators('task-1', makeViewer({ id: 'emp-1' })))
        .resolves.toEqual({ id: 'task-1', status: 'goal_confirmed' });
      expect(flowService.transitionTx).toHaveBeenCalledWith(
        transactionClient,
        expect.objectContaining({
          targetStatus: 'goal_confirmed',
          taskUpdate: { indicatorConfirmedAt: new Date('2026-12-28T08:00:00.000Z') },
        }),
      );
      jest.useRealTimers();
    });

    it('keeps legacy cycles without an explicit self-evaluation opening time on the original direct flow', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(makeTask('indicator_confirming'));
      prisma.assessmentCycle.findUnique.mockResolvedValue({ selfEvalOpenAt: null });
      flowService.transitionTx.mockResolvedValue({ newStatus: 'self_eval' });

      await expect(service.confirmIndicators('task-1', makeViewer({ id: 'emp-1' })))
        .resolves.toEqual({ id: 'task-1', status: 'self_eval' });
      expect(flowService.transitionTx).toHaveBeenCalledWith(
        transactionClient,
        expect.objectContaining({ targetStatus: 'self_eval' }),
      );
    });

    it('rejects self evaluation writes while the task is still waiting to open', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue({
        ...makeTask('goal_confirmed'),
        snapshot: { snapshotData: { maxScore: 100 } },
      });

      await expect(service.submitSelfEval(
        'task-1',
        { indicators: [], summary: {} },
        makeViewer({ id: 'emp-1' }),
      )).rejects.toThrow(ConflictException);
      expect(transactionClient.indicatorInstance.update).not.toHaveBeenCalled();
    });
  });
});
