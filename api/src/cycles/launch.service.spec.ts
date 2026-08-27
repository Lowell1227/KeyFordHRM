import { AccountType, Prisma, SysRole } from '@prisma/client';
import { LaunchService } from './launch.service';
import { AuthUser } from '@/common/types/auth.types';

describe('LaunchService preflight', () => {
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
          id: '55555555-5555-4555-8555-555555555555',
          name: '2027年第一季度',
          status: 'draft',
          startDate: new Date('2027-01-01T00:00:00.000Z'),
          endDate: new Date('2027-03-31T00:00:00.000Z'),
          goalSettingOpenAt: new Date('2026-12-22T00:00:00.000Z'),
          hrOwnerId: operator.id,
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
      },
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
        create: jest.fn().mockResolvedValue({ id: 'task-1' }),
        count: jest.fn().mockResolvedValue(0),
      },
      indicatorInstance: { createMany: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn(async (callback: (client: any) => unknown) => callback(tx)),
      assessmentCycle: tx.assessmentCycle,
      user: tx.user,
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

  it('blocks launch when one employee matches multiple person-specific templates', async () => {
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      template('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    ]);

    await expect(service.launch('55555555-5555-4555-8555-555555555555', operator))
      .rejects.toMatchObject({
        response: { message: expect.stringContaining('匹配到多个人员模板') },
      });
    expect(tx.assessmentTask.create).not.toHaveBeenCalled();
  });

  it('reports all company-default templates and the affected employee count', async () => {
    const first = template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const second = template('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    first.name = '公司模板 A';
    second.name = '公司模板 B';
    first.applicableUsers = [];
    second.applicableUsers = [];
    tx.assessmentTemplate.findMany.mockResolvedValue([first, second]);

    await expect(service.preflight('55555555-5555-4555-8555-555555555555'))
      .resolves.toEqual(expect.objectContaining({
        ready: false,
        blockers: expect.arrayContaining([{
          code: 'TEMPLATE_AMBIGUOUS',
          message: '存在 2 套启用的公司默认模板，影响 1 名员工：公司模板 A、公司模板 B',
        }]),
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

  it('creates a new-cycle task for the root leader with the leader as task manager', async () => {
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

  it('blocks launch when a matched template no longer has valid weights', async () => {
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0.8),
    ]);

    await expect(service.launch('55555555-5555-4555-8555-555555555555', operator))
      .rejects.toMatchObject({
        response: { message: expect.stringContaining('权重') },
      });
    expect(tx.assessmentTask.create).not.toHaveBeenCalled();
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

  it('blocks a scheduled opening when the approved launch plan has drifted', async () => {
    tx.assessmentTemplate.findMany.mockResolvedValue([
      template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ]);
    const checked = await service.preflight('55555555-5555-4555-8555-555555555555');
    const changedTemplate = template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    changedTemplate.version = 2;
    tx.assessmentTemplate.findMany.mockResolvedValue([changedTemplate]);
    tx.assessmentCycle.findUnique.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      name: '2027年第一季度',
      status: 'scheduled',
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-03-31T00:00:00.000Z'),
      goalSettingOpenAt: new Date('2026-12-22T00:00:00.000Z'),
      hrOwnerId: operator.id,
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
});
