import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { AssessmentTask, Prisma, TaskStatus } from '@prisma/client';
import { FlowService, FLOW_TRANSITIONS } from './flow.service';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_CODE } from '@/common/constants/error-codes';

describe('FlowService', () => {
  let service: FlowService;
  let tx: {
    assessmentTask: { update: jest.Mock; groupBy: jest.Mock };
    assessmentCycle: { findUnique: jest.Mock; update: jest.Mock };
    flowRecord: { create: jest.Mock };
  };
  let prisma: { $transaction: jest.Mock };

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

  beforeEach(async () => {
    tx = {
      assessmentTask: { update: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
      assessmentCycle: { findUnique: jest.fn(), update: jest.fn() },
      flowRecord: { create: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn(async (cb) => cb(tx)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FlowService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<FlowService>(FlowService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('FLOW_TRANSITIONS 覆盖', () => {
    it.each(FLOW_TRANSITIONS)('允许 $from + $action → $to', async (t) => {
      tx.assessmentTask.update.mockResolvedValue({ ...makeTask(t.from), status: t.to });

      const result = await service.transition({
        task: makeTask(t.from),
        action: t.action,
        targetStatus: t.to,
        actorId: 'actor-1',
      });

      expect(result.oldStatus).toBe(t.from);
      expect(result.newStatus).toBe(t.to);
      expect(result.nodeType).toBe(t.nodeType);
      expect(tx.assessmentTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: t.to },
      });
      expect(tx.flowRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taskId: 'task-1',
            cycleId: 'cycle-1',
            nodeType: t.nodeType,
            actorId: 'actor-1',
            action: t.action,
          }),
        }),
      );
    });
  });

  describe('非法转换', () => {
    it('未定义的转换抛 4009', async () => {
      await expect(
        service.transition({
          task: makeTask('pending'),
          action: 'submit',
          targetStatus: 'self_eval',
          actorId: 'actor-1',
        }),
      ).rejects.toThrow(ConflictException);

      try {
        await service.transition({
          task: makeTask('pending'),
          action: 'submit',
          targetStatus: 'self_eval',
          actorId: 'actor-1',
        });
      } catch (err) {
        expect((err as ConflictException).getResponse()).toMatchObject({ code: ERROR_CODE.CONFLICT });
      }
    });

    it('状态正确但 action 不匹配仍抛 4009', async () => {
      await expect(
        service.transition({
          task: makeTask('indicator_confirming'),
          action: 'approve',
          targetStatus: 'self_eval',
          actorId: 'actor-1',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('目标确认等待自评', () => {
    it('员工确认目标后进入 goal_confirmed，而不是提前开放自评', async () => {
      tx.assessmentTask.update.mockResolvedValue({
        ...makeTask('indicator_confirming'),
        status: 'goal_confirmed',
      });

      const result = await service.transition({
        task: makeTask('indicator_confirming'),
        action: 'submit',
        targetStatus: 'goal_confirmed',
        actorId: 'emp-1',
      });

      expect(result.newStatus).toBe('goal_confirmed');
      expect(tx.flowRecord.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ nodeType: 'indicator_confirm' }),
      }));
    });
  });

  describe('主管即部门负责人路径', () => {
    it('manager_scoring → hr_calibration 合法', async () => {
      tx.assessmentTask.update.mockResolvedValue({ ...makeTask('manager_scoring'), status: 'hr_calibration' });

      const result = await service.transition({
        task: makeTask('manager_scoring'),
        action: 'submit',
        targetStatus: 'hr_calibration',
        actorId: 'mgr-1',
      });

      expect(result.newStatus).toBe('hr_calibration');
      expect(result.nodeType).toBe('manager_score');
    });

    it('manager_scoring → dept_review 合法', async () => {
      tx.assessmentTask.update.mockResolvedValue({ ...makeTask('manager_scoring'), status: 'dept_review' });

      const result = await service.transition({
        task: makeTask('manager_scoring'),
        action: 'submit',
        targetStatus: 'dept_review',
        actorId: 'mgr-1',
      });

      expect(result.newStatus).toBe('dept_review');
      expect(result.nodeType).toBe('manager_score');
    });
  });

  describe('审批节点转换（#11）', () => {
    it('approval → published 的 nodeType 为 publish', async () => {
      tx.assessmentTask.update.mockResolvedValue({ ...makeTask('approval'), status: 'published' });

      const result = await service.transition({
        task: makeTask('approval'),
        action: 'approve',
        targetStatus: 'published',
        actorId: 'vp-1',
      });

      expect(result.newStatus).toBe('published');
      expect(result.nodeType).toBe('publish');
    });

    it('approval → hr_calibration 退回合法', async () => {
      tx.assessmentTask.update.mockResolvedValue({ ...makeTask('approval'), status: 'hr_calibration' });

      const result = await service.transition({
        task: makeTask('approval'),
        action: 'reject',
        targetStatus: 'hr_calibration',
        actorId: 'vp-1',
      });

      expect(result.newStatus).toBe('hr_calibration');
      expect(result.nodeType).toBe('approval');
    });

    it('approval 状态使用未定义的 action 抛 4009', async () => {
      await expect(
        service.transition({
          task: makeTask('approval'),
          action: 'submit',
          targetStatus: 'published',
          actorId: 'vp-1',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('transitionTx', () => {
    it('在事务客户端内执行并写 FlowRecord', async () => {
      tx.assessmentTask.update.mockResolvedValue({ ...makeTask('self_eval'), status: 'manager_scoring' });

      const result = await service.transitionTx(tx as unknown as Prisma.TransactionClient, {
        task: makeTask('self_eval'),
        action: 'submit',
        targetStatus: 'manager_scoring',
        actorId: 'emp-1',
        comment: '提交自评',
      });

      expect(result.newStatus).toBe('manager_scoring');
      expect(tx.flowRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ comment: '提交自评' }),
        }),
      );
    });
  });

  describe('reopenPeriodTx', () => {
    it.each([
      TaskStatus.manager_scoring,
      TaskStatus.dept_review,
      TaskStatus.hr_calibration,
      TaskStatus.approval,
      TaskStatus.self_eval,
    ])('将 %s 恢复为月度自评并保留一条撤回流程记录', async (status) => {
      tx.assessmentTask.update.mockResolvedValue({ ...makeTask(status), status: TaskStatus.self_eval });

      await service.reopenPeriodTx(tx as unknown as Prisma.TransactionClient, {
        task: makeTask(status),
        actorId: 'hr-1',
        reason: '员工需要修正本月自评分',
        periodId: 'period-1',
        periodKey: '2026-09',
        taskUpdate: { managerScoredAt: null, deptReviewedAt: null },
      });

      expect(tx.assessmentTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: {
          status: TaskStatus.self_eval,
          managerScoredAt: null,
          deptReviewedAt: null,
        },
      });
      expect(tx.flowRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: 'task-1',
          cycleId: 'cycle-1',
          nodeType: 'self_eval',
          actorId: 'hr-1',
          action: 'withdraw',
          comment: '员工需要修正本月自评分',
          extraData: expect.objectContaining({
            type: 'monthly_self_evaluation_reopened',
            periodId: 'period-1',
            periodKey: '2026-09',
            oldTaskStatus: status,
          }),
        }),
      });
    });
  });

  describe('syncCycleStage 周期阶段同步', () => {
    function mockCycleStatus(status: string | null) {
      tx.assessmentCycle.findUnique.mockResolvedValue(status ? { status } : null);
    }

    it('有任务进入 hr_calibration 时周期推进到 hr_calibration', async () => {
      mockCycleStatus('manager_score');
      tx.assessmentTask.groupBy.mockResolvedValue([
        { status: 'hr_calibration', _count: { _all: 1 } },
        { status: 'manager_scoring', _count: { _all: 3 } },
      ]);

      await service.syncCycleStage(tx as unknown as Prisma.TransactionClient, 'cycle-1');

      expect(tx.assessmentCycle.update).toHaveBeenCalledWith({
        where: { id: 'cycle-1' },
        data: { status: 'hr_calibration' },
      });
    });

    it('全部任务过了校准后周期推进到 approval', async () => {
      mockCycleStatus('hr_calibration');
      tx.assessmentTask.groupBy.mockResolvedValue([
        { status: 'approval', _count: { _all: 2 } },
      ]);

      await service.syncCycleStage(tx as unknown as Prisma.TransactionClient, 'cycle-1');

      expect(tx.assessmentCycle.update).toHaveBeenCalledWith({
        where: { id: 'cycle-1' },
        data: { status: 'approval' },
      });
    });

    it('审批退回校准时周期回退到 hr_calibration', async () => {
      mockCycleStatus('approval');
      tx.assessmentTask.groupBy.mockResolvedValue([
        { status: 'approval', _count: { _all: 1 } },
        { status: 'hr_calibration', _count: { _all: 1 } },
      ]);

      await service.syncCycleStage(tx as unknown as Prisma.TransactionClient, 'cycle-1');

      expect(tx.assessmentCycle.update).toHaveBeenCalledWith({
        where: { id: 'cycle-1' },
        data: { status: 'hr_calibration' },
      });
    });

    it('校准驳回后任务回到评分中时周期回退到 manager_score', async () => {
      mockCycleStatus('hr_calibration');
      tx.assessmentTask.groupBy.mockResolvedValue([
        { status: 'manager_scoring', _count: { _all: 2 } },
      ]);

      await service.syncCycleStage(tx as unknown as Prisma.TransactionClient, 'cycle-1');

      expect(tx.assessmentCycle.update).toHaveBeenCalledWith({
        where: { id: 'cycle-1' },
        data: { status: 'manager_score' },
      });
    });

    it('公示后的周期不介入', async () => {
      mockCycleStatus('published');
      await service.syncCycleStage(tx as unknown as Prisma.TransactionClient, 'cycle-1');
      expect(tx.assessmentTask.groupBy).not.toHaveBeenCalled();
      expect(tx.assessmentCycle.update).not.toHaveBeenCalled();
    });

    it('目标制定阶段的周期不介入', async () => {
      mockCycleStatus('indicator_setting');
      await service.syncCycleStage(tx as unknown as Prisma.TransactionClient, 'cycle-1');
      expect(tx.assessmentTask.groupBy).not.toHaveBeenCalled();
      expect(tx.assessmentCycle.update).not.toHaveBeenCalled();
    });

    it('阶段已一致时不写库', async () => {
      mockCycleStatus('hr_calibration');
      tx.assessmentTask.groupBy.mockResolvedValue([
        { status: 'hr_calibration', _count: { _all: 1 } },
      ]);

      await service.syncCycleStage(tx as unknown as Prisma.TransactionClient, 'cycle-1');

      expect(tx.assessmentCycle.update).not.toHaveBeenCalled();
    });
  });
});
