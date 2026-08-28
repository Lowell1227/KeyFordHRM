import { AccountType, Prisma, SysRole } from '@prisma/client';
import { LaunchService } from './launch.service';
import { AuthUser } from '@/common/types/auth.types';

describe('LaunchService preflight', () => {
  const cycleId = '55555555-5555-4555-8555-555555555555';
  const companyFinalApproverId = '88888888-8888-4888-8888-888888888888';
  const operator = {
    id: '11111111-1111-4111-8111-111111111111',
    sysRole: SysRole.hr,
    deptId: null,
    canViewAll: true,
  } as AuthUser;

  let tx: any;
  let prisma: any;
  let service: LaunchService;
  let notificationsService: { create: jest.Mock };

  const candidate = {
    id: '22222222-2222-4222-8222-222222222222',
    name: '测试员工',
    deptId: '33333333-3333-4333-8333-333333333333',
    directManagerId: '44444444-4444-4444-8444-444444444444',
    entryDate: new Date('2020-01-01T00:00:00.000Z'),
    leaveDate: null,
  };

  const periodSchedules = [
    {
      periodKey: '2027-01',
      periodType: 'month',
      sequence: 1,
      periodStart: new Date('2027-01-01T00:00:00.000Z'),
      periodEnd: new Date('2027-01-31T00:00:00.000Z'),
      selfEvalOpenAt: new Date('2027-02-01T01:00:00.000Z'),
      selfEvalDueAt: new Date('2027-02-03T10:00:00.000Z'),
      managerDueAt: new Date('2027-02-08T10:00:00.000Z'),
      isException: false,
    },
    {
      periodKey: '2027-02',
      periodType: 'month',
      sequence: 2,
      periodStart: new Date('2027-02-01T00:00:00.000Z'),
      periodEnd: new Date('2027-02-28T00:00:00.000Z'),
      selfEvalOpenAt: new Date('2027-03-01T01:00:00.000Z'),
      selfEvalDueAt: new Date('2027-03-03T10:00:00.000Z'),
      managerDueAt: new Date('2027-03-08T10:00:00.000Z'),
      isException: false,
    },
    {
      periodKey: '2027-03',
      periodType: 'month',
      sequence: 3,
      periodStart: new Date('2027-03-01T00:00:00.000Z'),
      periodEnd: new Date('2027-03-31T00:00:00.000Z'),
      selfEvalOpenAt: new Date('2027-04-01T01:00:00.000Z'),
      selfEvalDueAt: new Date('2027-04-03T10:00:00.000Z'),
      managerDueAt: new Date('2027-04-08T10:00:00.000Z'),
      isException: false,
    },
  ];

  const v2Cycle = (overrides: Record<string, unknown> = {}) => ({
    id: cycleId,
    name: '2027年第一季度',
    status: 'draft',
    startDate: new Date('2027-01-01T00:00:00.000Z'),
    endDate: new Date('2027-03-31T00:00:00.000Z'),
    goalSettingOpenAt: new Date('2026-12-22T00:00:00.000Z'),
    hrOwnerId: operator.id,
    reviewStatus: 'approved',
    workflowVersion: 2,
    scoringFrequency: 'monthly',
    companyFinalApproverId,
    participantDeptIds: [],
    participantUserIds: [],
    explicitExemptDeptIds: [],
    explicitExemptUserIds: [],
    ...overrides,
  });

  function template(id: string, indicatorWeight = 1) {
    return {
      id,
      name: `模板-${id.slice(0, 4)}`,
      description: null,
      applicableDepts: [],
      applicableUsers: [candidate.id],
      maxScore: new Prisma.Decimal(100),
      version: 1,
      dimensions: [{
        id: `${id}-dimension`,
        name: 'KPI',
        weight: new Prisma.Decimal(1),
        type: 'kpi',
        sortOrder: 0,
        indicators: [{
          id: `${id}-indicator`,
          indicatorId: null,
          name: '季度目标',
          description: '完成季度目标',
          scoringStandard: '按完成率评分',
          dataSource: '业务系统',
          dataCaliber: '季度累计',
          targetValue: new Prisma.Decimal(100),
          targetValueText: '100%',
          unit: '%',
          weight: new Prisma.Decimal(indicatorWeight),
          sortOrder: 0,
          indicator: { type: 'kpi' },
        }],
      }],
    };
  }

  beforeEach(() => {
    tx = {
      assessmentCycle: {
        findUnique: jest.fn().mockResolvedValue({
          id: cycleId,
          name: '2027年第一季度',
          status: 'draft',
          startDate: new Date('2027-01-01T00:00:00.000Z'),
          endDate: new Date('2027-03-31T00:00:00.000Z'),
          goalSettingOpenAt: new Date('2026-12-22T00:00:00.000Z'),
          hrOwnerId: operator.id,
          reviewStatus: 'approved',
          workflowVersion: 1,
          scoringFrequency: 'cycle',
          companyFinalApproverId: null,
          participantDeptIds: [],
          participantUserIds: [],
          explicitExemptDeptIds: [],
          explicitExemptUserIds: [],
        }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([candidate]),
        findFirst: jest.fn().mockResolvedValue({ id: operator.id, name: '测试 HR' }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      cyclePeriodSchedule: { findMany: jest.fn().mockResolvedValue([]) },
      assessmentTemplate: { findMany: jest.fn() },
      assessmentTemplateSnapshot: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: `snapshot-${data.templateId}`,
          templateId: data.templateId,
        })),
      },
      department: {
        findMany: jest.fn().mockResolvedValue([{
          id: candidate.deptId,
          name: '产品部',
          parentId: null,
          leaderId: '66666666-6666-4666-8666-666666666666',
          leader: { name: '部门负责人' },
          approverId: '77777777-7777-4777-8777-777777777777',
          approver: { name: '审批人' },
        }]),
      },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      assessmentTask: {
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'task-1', ...data })),
        count: jest.fn().mockResolvedValue(0),
      },
      assessmentPeriod: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
      },
      indicatorVersion: {
        create: jest.fn().mockResolvedValue({ id: 'version-1' }),
        count: jest.fn().mockResolvedValue(0),
      },
      indicatorInstance: { createMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn(async (callback: (client: any) => unknown) => callback(tx)),
      assessmentCycle: tx.assessmentCycle,
      user: tx.user,
      cyclePeriodSchedule: tx.cyclePeriodSchedule,
      assessmentTemplate: tx.assessmentTemplate,
      department: tx.department,
      systemConfig: tx.systemConfig,
    };
    notificationsService = { create: jest.fn().mockResolvedValue(undefined) };
    service = new LaunchService(
      prisma,
      { calcExempt: jest.fn().mockReturnValue({ isExempt: false, onJobDays: 90 }) } as never,
      notificationsService as never,
    );
  });

  it('does not inspect person-specific templates during launch preflight', async () => {
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      template('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    ]);

    await expect(service.preflight('55555555-5555-4555-8555-555555555555'))
      .resolves.toEqual(expect.objectContaining({ ready: true, templateCount: 0 }));
    expect(tx.assessmentTemplate.findMany).not.toHaveBeenCalled();
  });

  it('does not block preflight when company-default templates overlap', async () => {
    const first = template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const second = template('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    first.name = '公司模板 A';
    second.name = '公司模板 B';
    first.applicableUsers = [];
    second.applicableUsers = [];
    tx.assessmentTemplate.findMany.mockResolvedValue([first, second]);

    await expect(service.preflight('55555555-5555-4555-8555-555555555555'))
      .resolves.toEqual(expect.objectContaining({
        ready: true,
        templateCount: 0,
        blockers: [],
      }));
  });

  it('blocks launch preflight until the designated reviewer approves the plan', async () => {
    const cycle = await tx.assessmentCycle.findUnique({ where: { id: '55555555-5555-4555-8555-555555555555' } });
    tx.assessmentCycle.findUnique.mockResolvedValue({ ...cycle, reviewStatus: 'pending' });

    await expect(service.preflight('55555555-5555-4555-8555-555555555555'))
      .resolves.toEqual(expect.objectContaining({
        ready: false,
        blockers: expect.arrayContaining([expect.objectContaining({ code: 'CYCLE_NOT_APPROVED' })]),
      }));
  });

  it('limits an unscoped cycle to employee accounts', async () => {
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ]);

    await service.preflight('55555555-5555-4555-8555-555555555555');

    expect(tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        accountType: AccountType.employee,
      }),
    }));
  });

  it('treats a root department leader without a direct manager as self-managed in preflight', async () => {
    const topLeader = {
      ...candidate,
      name: '李宏',
      directManagerId: null,
      directManager: null,
    };
    tx.user.findMany.mockResolvedValue([topLeader]);
    tx.department.findMany.mockResolvedValue([{
      id: candidate.deptId,
      name: '总经办',
      parentId: null,
      leaderId: candidate.id,
      leader: { name: '李宏', directManagerId: null, directManager: null },
      approverId: candidate.id,
      approver: { name: '李宏' },
    }]);
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ]);

    await expect(service.preflight('55555555-5555-4555-8555-555555555555'))
      .resolves.toEqual(expect.objectContaining({
        ready: true,
        participants: [expect.objectContaining({
          employeeId: candidate.id,
          managerId: candidate.id,
          managerName: '李宏',
        })],
      }));
  });

  it('still blocks an ordinary employee without a direct manager', async () => {
    tx.user.findMany.mockResolvedValue([{
      ...candidate,
      directManagerId: null,
      directManager: null,
    }]);
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ]);

    await expect(service.preflight('55555555-5555-4555-8555-555555555555'))
      .resolves.toEqual(expect.objectContaining({
        ready: false,
        blockers: [expect.objectContaining({
          code: 'ORGANIZATION_RELATION_INVALID',
          message: expect.stringContaining('以下员工未设置直属上级：测试员工'),
        })],
      }));
  });

  it('keeps workflow v1 root leaders self-managed when creating the task', async () => {
    const topLeader = {
      ...candidate,
      name: '李宏',
      directManagerId: null,
      directManager: null,
    };
    tx.user.findMany.mockResolvedValue([topLeader]);
    tx.department.findMany.mockResolvedValue([{
      id: candidate.deptId,
      name: '总经办',
      parentId: null,
      leaderId: candidate.id,
      leader: { name: '李宏', directManagerId: null, directManager: null },
      approverId: candidate.id,
      approver: { name: '李宏' },
    }]);
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ]);
    const checked = await service.preflight('55555555-5555-4555-8555-555555555555');

    await service.launch('55555555-5555-4555-8555-555555555555', operator, {
      now: new Date('2026-12-23T00:00:00.000Z'),
      expectedPlanHash: checked.planHash!,
    });

    expect(tx.assessmentTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: candidate.id,
        managerId: candidate.id,
      }),
    });
    expect(tx.indicatorVersion.create).not.toHaveBeenCalled();
    expect(tx.assessmentPeriod.createMany).not.toHaveBeenCalled();
  });

  it('marks the structural company top leader exempt in workflow v2', async () => {
    const topLeader = {
      ...candidate,
      name: '李宏',
      directManagerId: null,
      directManager: null,
    };
    tx.assessmentCycle.findUnique.mockResolvedValue(v2Cycle({
      companyFinalApproverId: topLeader.id,
    }));
    tx.cyclePeriodSchedule.findMany.mockResolvedValue(periodSchedules);
    tx.user.findMany.mockImplementation(({ where }: any) => Promise.resolve(
      where.status === 'active' ? [topLeader] : [],
    ));
    tx.user.findUnique.mockResolvedValue({
      id: topLeader.id,
      name: topLeader.name,
      directManagerId: null,
    });
    tx.department.findMany.mockResolvedValue([{
      id: candidate.deptId,
      name: '总经办',
      parentId: null,
      leaderId: topLeader.id,
      leader: { name: topLeader.name, directManagerId: null, directManager: null },
      approverId: topLeader.id,
      approver: { name: topLeader.name },
    }]);

    const checked = await service.preflight(cycleId);

    expect(checked.participants).toContainEqual(expect.objectContaining({
      employeeName: '李宏',
      participantDisposition: 'top_leader_exempt',
      isExempt: true,
    }));
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: topLeader.id },
      select: { id: true, name: true, directManagerId: true },
    });

    await service.launch(cycleId, operator, {
      now: new Date('2026-12-23T00:00:00.000Z'),
      expectedPlanHash: checked.planHash!,
    });

    expect(tx.assessmentTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: topLeader.id,
        managerId: null,
        status: 'exempted',
        participantDisposition: 'top_leader_exempt',
        exemptReason: '最高负责人豁免',
      }),
    });
    expect(tx.indicatorVersion.create).not.toHaveBeenCalled();
    expect(tx.assessmentPeriod.createMany).not.toHaveBeenCalled();
  });

  it('keeps explicitly selected test accounts eligible without admitting every test account', async () => {
    tx.assessmentCycle.findUnique.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      name: '测试·验收周期',
      status: 'draft',
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T00:00:00.000Z'),
      goalSettingOpenAt: new Date('2026-12-22T00:00:00.000Z'),
      hrOwnerId: operator.id,
      reviewStatus: 'approved',
      participantDeptIds: [],
      participantUserIds: [candidate.id],
      explicitExemptDeptIds: [],
      explicitExemptUserIds: [],
    });
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ]);

    await service.preflight('55555555-5555-4555-8555-555555555555');

    expect(tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([{
          OR: [
            { accountType: AccountType.employee },
            { id: { in: [candidate.id] } },
          ],
        }]),
      }),
    }));
  });

  it('excludes probation employees from workflow v2 and explains the headcount change', async () => {
    const probationEmployee = {
      ...candidate,
      id: '99999999-9999-4999-8999-999999999999',
      name: '试用期员工',
    };
    tx.assessmentCycle.findUnique.mockResolvedValue(v2Cycle());
    tx.cyclePeriodSchedule.findMany.mockResolvedValue(periodSchedules);
    tx.user.findMany.mockImplementation(({ where }: any) => Promise.resolve(
      where.status === 'active' ? [candidate] : [probationEmployee],
    ));
    tx.user.findUnique.mockResolvedValue({
      id: companyFinalApproverId,
      name: '李宏',
      directManagerId: null,
    });

    const preflight = await service.preflight(cycleId);

    expect(tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'active' }),
    }));
    expect(tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'probation' }),
    }));
    expect(preflight.participantCount).toBe(1);
    expect(preflight.exclusions).toContainEqual({
      employeeId: probationEmployee.id,
      employeeName: probationEmployee.name,
      reasonCode: 'PROBATION_NOT_IN_PLAN',
      reason: '试用期员工不进入本绩效计划',
    });
  });

  it('blocks workflow v2 preflight when the company final approver is missing', async () => {
    tx.assessmentCycle.findUnique.mockResolvedValue(v2Cycle({ companyFinalApproverId: null }));
    tx.cyclePeriodSchedule.findMany.mockResolvedValue(periodSchedules);
    tx.user.findMany.mockImplementation(({ where }: any) => Promise.resolve(
      where.status === 'active' ? [candidate] : [],
    ));

    await expect(service.preflight(cycleId)).resolves.toEqual(expect.objectContaining({
      ready: false,
      blockers: expect.arrayContaining([expect.objectContaining({
        code: 'COMPANY_FINAL_APPROVER_MISSING',
      })]),
    }));
  });

  it('blocks workflow v2 preflight when no normalized period schedule is stored', async () => {
    tx.assessmentCycle.findUnique.mockResolvedValue(v2Cycle());
    tx.user.findMany.mockImplementation(({ where }: any) => Promise.resolve(
      where.status === 'active' ? [candidate] : [],
    ));
    tx.user.findUnique.mockResolvedValue({
      id: companyFinalApproverId,
      name: '李宏',
      directManagerId: null,
    });

    await expect(service.preflight(cycleId)).resolves.toEqual(expect.objectContaining({
      ready: false,
      blockers: expect.arrayContaining([expect.objectContaining({
        code: 'PERIOD_SCHEDULE_MISSING',
      })]),
    }));
  });

  it('blocks workflow v2 when the configured company final approver has a direct manager', async () => {
    tx.assessmentCycle.findUnique.mockResolvedValue(v2Cycle());
    tx.cyclePeriodSchedule.findMany.mockResolvedValue(periodSchedules);
    tx.user.findMany.mockImplementation(({ where }: any) => Promise.resolve(
      where.status === 'active' ? [candidate] : [],
    ));
    tx.user.findUnique.mockResolvedValue({
      id: companyFinalApproverId,
      name: '错误审定人',
      directManagerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });

    await expect(service.preflight(cycleId)).resolves.toEqual(expect.objectContaining({
      ready: false,
      blockers: expect.arrayContaining([expect.objectContaining({
        code: 'ORGANIZATION_RELATION_INVALID',
        message: expect.stringContaining('公司最终审定人必须是没有直属上级的最高负责人'),
      })]),
    }));
  });

  it.each([
    { workflowVersion: 1, expectedCopy: '最终业务审批人' },
    { workflowVersion: 2, expectedCopy: '分管总审核人/公司最终审定人' },
  ])('uses workflow v$workflowVersion organization blocker terminology', async ({
    workflowVersion,
    expectedCopy,
  }) => {
    tx.assessmentCycle.findUnique.mockResolvedValue(v2Cycle({ workflowVersion }));
    tx.cyclePeriodSchedule.findMany.mockResolvedValue(periodSchedules);
    tx.user.findMany.mockImplementation(({ where }: any) => Promise.resolve(
      workflowVersion === 1 || where.status === 'active' ? [candidate] : [],
    ));
    tx.user.findUnique.mockResolvedValue({
      id: companyFinalApproverId,
      name: '李宏',
      directManagerId: null,
    });
    tx.department.findMany.mockResolvedValue([{
      id: candidate.deptId,
      name: '产品部',
      parentId: null,
      leaderId: '66666666-6666-4666-8666-666666666666',
      leader: { name: '部门负责人' },
      approverId: null,
      approver: null,
    }]);

    await expect(service.preflight(cycleId)).resolves.toEqual(expect.objectContaining({
      ready: false,
      blockers: expect.arrayContaining([expect.objectContaining({
        code: 'ORGANIZATION_RELATION_INVALID',
        message: expect.stringContaining(expectedCopy),
      })]),
    }));
  });

  it('launches blank goal tasks without validating template weights', async () => {
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0.8),
    ]);

    const checked = await service.preflight('55555555-5555-4555-8555-555555555555');
    await expect(service.launch('55555555-5555-4555-8555-555555555555', operator, {
      now: new Date('2026-12-23T00:00:00.000Z'),
      expectedPlanHash: checked.planHash!,
    })).resolves.toEqual(expect.objectContaining({ activeTasks: 1 }));
    expect(tx.assessmentTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ snapshotId: null }),
    });
    expect(tx.indicatorInstance.createMany).not.toHaveBeenCalled();
  });

  it('creates v2 draft indicator V1 and one unopened record per stored period', async () => {
    tx.assessmentCycle.findUnique.mockResolvedValue(v2Cycle());
    tx.cyclePeriodSchedule.findMany.mockResolvedValue(periodSchedules);
    tx.user.findMany.mockImplementation(({ where }: any) => Promise.resolve(
      where.status === 'active' ? [candidate] : [],
    ));
    tx.user.findUnique.mockResolvedValue({
      id: companyFinalApproverId,
      name: '李宏',
      directManagerId: null,
    });

    const checked = await service.preflight(cycleId);
    const result = await service.launch(cycleId, operator, {
      now: new Date('2026-12-23T00:00:00.000Z'),
      expectedPlanHash: checked.planHash!,
    });

    expect(tx.cyclePeriodSchedule.findMany).toHaveBeenCalledWith({
      where: { cycleId },
      orderBy: { sequence: 'asc' },
    });
    expect(tx.assessmentCycle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        launchPlan: expect.objectContaining({
          workflowVersion: 2,
          scoringFrequency: 'monthly',
          companyFinalApproverId,
          periodSchedules: expect.arrayContaining([
            expect.objectContaining({
              periodKey: '2027-01',
              selfEvalOpenAt: '2027-02-01T01:00:00.000Z',
              managerDueAt: '2027-02-08T10:00:00.000Z',
            }),
          ]),
          participants: [expect.objectContaining({ participantDisposition: 'active' })],
        }),
      }),
    }));
    expect(tx.indicatorVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: 'task-1',
        version: 1,
        status: 'draft',
        effectiveFromPeriodKey: '2027-01',
        createdById: operator.id,
      }),
    });
    expect(tx.assessmentPeriod.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          taskId: 'task-1',
          periodKey: '2027-01',
          sequence: 1,
          managerId: candidate.directManagerId,
        }),
        expect.objectContaining({
          taskId: 'task-1',
          periodKey: '2027-02',
          sequence: 2,
          managerId: candidate.directManagerId,
        }),
        expect.objectContaining({
          taskId: 'task-1',
          periodKey: '2027-03',
          sequence: 3,
          managerId: candidate.directManagerId,
        }),
      ],
    });
    expect(result).toEqual(expect.objectContaining({
      totalTasks: 1,
      activeTasks: 1,
      periodCount: 3,
      indicatorVersionCount: 1,
    }));
  });

  it('creates audit-only tasks for workflow v2 cycle exemptions', async () => {
    tx.assessmentCycle.findUnique.mockResolvedValue(v2Cycle({
      explicitExemptUserIds: [candidate.id],
    }));
    tx.cyclePeriodSchedule.findMany.mockResolvedValue(periodSchedules);
    tx.user.findMany.mockImplementation(({ where }: any) => Promise.resolve(
      where.status === 'active' ? [candidate] : [],
    ));
    tx.user.findUnique.mockResolvedValue({
      id: companyFinalApproverId,
      name: '李宏',
      directManagerId: null,
    });

    const checked = await service.preflight(cycleId);
    expect(checked.participants).toContainEqual(expect.objectContaining({
      employeeId: candidate.id,
      participantDisposition: 'cycle_exempt',
      isExempt: true,
    }));

    await service.launch(cycleId, operator, {
      now: new Date('2026-12-23T00:00:00.000Z'),
      expectedPlanHash: checked.planHash!,
    });

    expect(tx.assessmentTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: candidate.id,
        participantDisposition: 'cycle_exempt',
        status: 'exempted',
      }),
    });
    expect(tx.indicatorVersion.create).not.toHaveBeenCalled();
    expect(tx.assessmentPeriod.createMany).not.toHaveBeenCalled();
  });

  it('opens a scheduled cycle and records the actual opening audit fields', async () => {
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ]);
    const checked = await service.preflight('55555555-5555-4555-8555-555555555555');
    tx.assessmentCycle.findUnique.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      name: '2027年第一季度',
      status: 'scheduled',
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T00:00:00.000Z'),
      goalSettingOpenAt: new Date('2026-12-22T00:00:00.000Z'),
      hrOwnerId: operator.id,
      reviewStatus: 'approved',
      launchPlanHash: checked.planHash,
    });
    jest.useFakeTimers().setSystemTime(new Date('2026-12-23T08:00:00.000Z'));

    await expect(service.launch('55555555-5555-4555-8555-555555555555', operator, {
      source: 'scheduled',
    }))
      .resolves.toEqual(expect.objectContaining({ activeTasks: 1 }));
    expect(tx.assessmentCycle.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: '55555555-5555-4555-8555-555555555555', openedAt: null }),
      data: expect.objectContaining({
        status: 'indicator_setting',
        openedAt: new Date('2026-12-23T08:00:00.000Z'),
        openedById: operator.id,
        openSource: 'scheduled',
      }),
    });
    expect(notificationsService.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: candidate.id,
      cycleId: '55555555-5555-4555-8555-555555555555',
      title: '季度目标制定已开放',
    }));
    expect(notificationsService.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: candidate.directManagerId,
      cycleId: '55555555-5555-4555-8555-555555555555',
      title: '团队目标制定已开放',
    }));

    jest.useRealTimers();
  });

  it('schedules a draft only after the launch preflight is ready', async () => {
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ]);
    const checked = await service.preflight('55555555-5555-4555-8555-555555555555');
    jest.useFakeTimers().setSystemTime(new Date('2026-12-01T08:00:00.000Z'));

    await expect(service.schedule('55555555-5555-4555-8555-555555555555', operator, checked.planHash!))
      .resolves.toEqual(expect.objectContaining({ status: 'scheduled', participantCount: 1 }));
    expect(tx.assessmentCycle.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: '55555555-5555-4555-8555-555555555555', openedAt: null }),
      data: expect.objectContaining({
        status: 'scheduled',
        scheduledAt: new Date('2026-12-01T08:00:00.000Z'),
        scheduledById: operator.id,
      }),
    });

    jest.useRealTimers();
  });

  it('blocks a scheduled opening when the approved participant plan has drifted', async () => {
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ]);
    const checked = await service.preflight('55555555-5555-4555-8555-555555555555');
    tx.user.findMany.mockResolvedValue([{ ...candidate, directManagerId: '88888888-8888-4888-8888-888888888888' }]);
    tx.assessmentCycle.findUnique.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      name: '2027年第一季度',
      status: 'scheduled',
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T00:00:00.000Z'),
      goalSettingOpenAt: new Date('2026-12-22T00:00:00.000Z'),
      hrOwnerId: operator.id,
      reviewStatus: 'approved',
      launchPlanHash: checked.planHash,
    });

    await expect(service.launch('55555555-5555-4555-8555-555555555555', operator, {
      source: 'scheduled',
      now: new Date('2026-12-23T00:00:00.000Z'),
    })).rejects.toMatchObject({
      response: { message: expect.stringContaining('已变化') },
    });
    expect(tx.assessmentCycle.updateMany).not.toHaveBeenCalled();
  });

  it('atomically adopts a rechecked plan when a blocked cycle is opened', async () => {
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ]);
    tx.assessmentCycle.findUnique.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      name: '2027年第一季度',
      status: 'launch_blocked',
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T00:00:00.000Z'),
      goalSettingOpenAt: new Date('2026-12-22T00:00:00.000Z'),
      hrOwnerId: operator.id,
      reviewStatus: 'approved',
      launchPlanHash: 'stale-plan-hash',
    });
    const checked = await service.preflight('55555555-5555-4555-8555-555555555555');

    await expect(service.launch('55555555-5555-4555-8555-555555555555', operator, {
      now: new Date('2026-12-23T00:00:00.000Z'),
      expectedPlanHash: checked.planHash!,
    })).resolves.toEqual(expect.objectContaining({ activeTasks: 1 }));

    expect(tx.assessmentCycle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        launchPlanHash: checked.planHash,
        launchPlan: expect.objectContaining({ participants: expect.any(Array) }),
      }),
    }));
  });

  it('never lets a stale scheduler worker reopen a blocked cycle', async () => {
    tx.assessmentCycle.findUnique.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      status: 'launch_blocked',
      openedAt: null,
      hrOwnerId: operator.id,
    });

    await expect(service.launch('55555555-5555-4555-8555-555555555555', operator, {
      source: 'scheduled',
      now: new Date('2026-12-23T00:00:00.000Z'),
    })).rejects.toMatchObject({
      response: { message: expect.stringContaining('不会自动重试') },
    });
    expect(tx.assessmentCycle.updateMany).not.toHaveBeenCalled();
  });

  it('requires and audits a reason when a system administrator opens early', async () => {
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ]);
    const checked = await service.preflight('55555555-5555-4555-8555-555555555555');
    const admin = { ...operator, sysRole: SysRole.system_admin };

    await expect(service.launch('55555555-5555-4555-8555-555555555555', admin, {
      now: new Date('2026-12-01T00:00:00.000Z'),
      expectedPlanHash: checked.planHash!,
    })).rejects.toMatchObject({ response: { message: expect.stringContaining('原因') } });

    await service.launch('55555555-5555-4555-8555-555555555555', admin, {
      now: new Date('2026-12-01T00:00:00.000Z'),
      expectedPlanHash: checked.planHash!,
      overrideReason: '业务调整需提前启动',
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'cycle_goal_setting_opened',
        newValue: expect.objectContaining({ overrideReason: '业务调整需提前启动' }),
      }),
    });
  });

  it('creates explicit exemption tasks and notifies both employee and manager', async () => {
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ]);
    tx.assessmentCycle.findUnique.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      name: '2027年第一季度',
      status: 'draft',
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T00:00:00.000Z'),
      goalSettingOpenAt: new Date('2026-12-22T00:00:00.000Z'),
      hrOwnerId: operator.id,
      reviewStatus: 'approved',
      participantDeptIds: [],
      participantUserIds: [],
      explicitExemptDeptIds: [],
      explicitExemptUserIds: [candidate.id],
    });
    const checked = await service.preflight('55555555-5555-4555-8555-555555555555');

    await expect(service.launch('55555555-5555-4555-8555-555555555555', operator, {
      now: new Date('2026-12-23T00:00:00.000Z'),
      expectedPlanHash: checked.planHash!,
    })).resolves.toEqual(expect.objectContaining({ exemptedTasks: 1, activeTasks: 0 }));
    expect(tx.assessmentTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ isExempt: true, exemptReason: expect.stringContaining('明确设置') }),
    });
    expect(notificationsService.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: candidate.id,
      title: '本季度绩效任务已豁免',
    }));
    expect(notificationsService.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: candidate.directManagerId,
      title: '团队成员存在绩效豁免',
    }));
  });

  it('marks employees in explicitly exempt departments as exempt', async () => {
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ]);
    tx.assessmentCycle.findUnique.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      name: '2027年第一季度',
      status: 'draft',
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T00:00:00.000Z'),
      goalSettingOpenAt: new Date('2026-12-22T00:00:00.000Z'),
      hrOwnerId: operator.id,
      reviewStatus: 'approved',
      participantDeptIds: [],
      participantUserIds: [],
      explicitExemptDeptIds: [candidate.deptId],
      explicitExemptUserIds: [],
    });

    await expect(service.preflight('55555555-5555-4555-8555-555555555555'))
      .resolves.toEqual(expect.objectContaining({
        ready: true,
        participants: [expect.objectContaining({
          employeeId: candidate.id,
          isExempt: true,
          exemptReason: 'HR 按部门设置为本周期豁免',
        })],
      }));
  });

  it('includes exempt departments in a custom-scope candidate query', async () => {
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ]);
    tx.assessmentCycle.findUnique.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      name: '2027年第一季度',
      status: 'draft',
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T00:00:00.000Z'),
      goalSettingOpenAt: new Date('2026-12-22T00:00:00.000Z'),
      hrOwnerId: operator.id,
      reviewStatus: 'approved',
      participantDeptIds: ['88888888-8888-4888-8888-888888888888'],
      participantUserIds: [],
      explicitExemptDeptIds: [candidate.deptId],
      explicitExemptUserIds: [],
    });

    await service.preflight('55555555-5555-4555-8555-555555555555');

    expect(tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { deptId: { in: [candidate.deptId] } },
        ]),
      }),
    }));
  });

  it('changes the launch plan hash when exempt departments change', async () => {
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ]);
    const cycle = {
      id: '55555555-5555-4555-8555-555555555555',
      name: '2027年第一季度',
      status: 'draft',
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T00:00:00.000Z'),
      goalSettingOpenAt: new Date('2026-12-22T00:00:00.000Z'),
      hrOwnerId: operator.id,
      reviewStatus: 'approved',
      participantDeptIds: [],
      participantUserIds: [],
      explicitExemptDeptIds: [],
      explicitExemptUserIds: [],
    };
    tx.assessmentCycle.findUnique.mockResolvedValue(cycle);
    const before = await service.preflight('55555555-5555-4555-8555-555555555555');
    tx.assessmentCycle.findUnique.mockResolvedValue({
      ...cycle,
      explicitExemptDeptIds: [candidate.deptId],
    });

    const after = await service.preflight('55555555-5555-4555-8555-555555555555');

    expect(before.planHash).not.toBeNull();
    expect(after.planHash).not.toBeNull();
    expect(after.planHash).not.toBe(before.planHash);
  });

  it('returns the existing result when a concurrent request already opened the cycle', async () => {
    tx.assessmentCycle.findUnique.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      status: 'indicator_setting',
      openedAt: new Date('2026-12-22T00:00:00.000Z'),
    });
    tx.assessmentTask.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);

    await expect(service.launch('55555555-5555-4555-8555-555555555555', operator))
      .resolves.toEqual({
        cycleId: '55555555-5555-4555-8555-555555555555',
        totalTasks: 3,
        exemptedTasks: 1,
        activeTasks: 2,
    });
    expect(tx.assessmentTask.create).not.toHaveBeenCalled();
  });

  it('returns existing workflow v2 child counts without creating duplicate rows', async () => {
    tx.assessmentCycle.findUnique.mockResolvedValue({
      id: cycleId,
      status: 'indicator_setting',
      workflowVersion: 2,
      openedAt: new Date('2026-12-22T00:00:00.000Z'),
    });
    tx.assessmentTask.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);
    tx.assessmentPeriod.count.mockResolvedValue(6);
    tx.indicatorVersion.count.mockResolvedValue(2);

    await expect(service.launch(cycleId, operator)).resolves.toEqual({
      cycleId,
      totalTasks: 3,
      exemptedTasks: 1,
      activeTasks: 2,
      periodCount: 6,
      indicatorVersionCount: 2,
    });
    expect(tx.assessmentPeriod.count).toHaveBeenCalledWith({
      where: { task: { cycleId } },
    });
    expect(tx.indicatorVersion.count).toHaveBeenCalledWith({
      where: { task: { cycleId } },
    });
    expect(tx.assessmentTask.create).not.toHaveBeenCalled();
    expect(tx.assessmentPeriod.createMany).not.toHaveBeenCalled();
    expect(tx.indicatorVersion.create).not.toHaveBeenCalled();
  });
});
