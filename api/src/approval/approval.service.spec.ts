import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AssessmentTask, Prisma, TaskStatus } from '@prisma/client';
import { ApprovalService, ApprovalListItem } from './approval.service';
import { PrismaService } from '@/prisma/prisma.service';
import { FlowService } from '@/tasks/flow.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { ERROR_CODE } from '@/common/constants/error-codes';
import { AuthUser } from '@/common/types/auth.types';

function makeViewer(overrides?: Partial<AuthUser>): AuthUser {
  return {
    id: 'vp-1',
    name: 'VP',
    sysRole: 'vp' as any,
    deptId: 'dept-1',
    isAssessorOnly: false,
    canViewAll: false,
    ...overrides,
  };
}

function makeTask(status: TaskStatus, overrides?: Partial<AssessmentTask>): AssessmentTask {
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
    exemptReason: null,
    indicatorSetAt: null,
    indicatorConfirmedAt: null,
    selfEvalSubmittedAt: null,
    managerScoredAt: null,
    deptReviewedAt: null,
    hrCalibratedAt: null,
    approvedAt: null,
    publishedAt: null,
    employeeConfirmedAt: null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AssessmentTask;
}

function makeCycle() {
  return {
    id: 'cycle-1', name: '2026 Q1', status: 'approval' as any,
    gradeAMaxRatio: new Prisma.Decimal(0.2), gradeBMaxRatio: new Prisma.Decimal(0.4),
    gradeCMaxRatio: new Prisma.Decimal(0.3), gradeDMaxRatio: new Prisma.Decimal(0.1),
  };
}

describe('ApprovalService', () => {
  let service: ApprovalService;
  let prisma: any;
  let flowService: Partial<FlowService>;
  let tx: any;

  beforeEach(async () => {
    tx = {
      gradeResult: { upsert: jest.fn(), updateMany: jest.fn() },
      assessmentTask: { update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      flowRecord: { create: jest.fn() },
    };

    prisma = {
      $transaction: jest.fn((cb: any) => cb(tx)),
      assessmentCycle: { findUnique: jest.fn() },
      assessmentTask: { findMany: jest.fn(), findUnique: jest.fn() },
      gradeResult: { findUnique: jest.fn() },
      flowRecord: { findMany: jest.fn() },
    };

    flowService = {
      transitionTx: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalService,
        { provide: PrismaService, useValue: prisma },
        { provide: FlowService, useValue: flowService },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
      ],
    }).compile();

    service = module.get<ApprovalService>(ApprovalService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /cycles/:id/approval 数据范围', () => {
    it('retains reached and handled approval records within the frozen approver scope', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([]);

      await service.getApprovalList('cycle-1', makeViewer());

      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ cycleId: 'cycle-1', approverId: 'vp-1', isExempt: false, OR: [
          { status: { in: ['approval', 'published', 'confirmed', 'appealing', 'closed'] } },
          { flowRecords: { some: { nodeType: 'approval' } } },
        ] }),
      }));
    });

    it('adds department and employee-name-or-number filters without replacing approval scope', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([]);

      await service.getApprovalList('cycle-1', makeViewer(), { deptId: 'dept-1', keyword: 'E001' });

      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          cycleId: 'cycle-1', approverId: 'vp-1', isExempt: false, deptId: 'dept-1',
          employee: { OR: [
            { name: { contains: 'E001', mode: 'insensitive' } },
            { employeeNo: { contains: 'E001', mode: 'insensitive' } },
          ] },
        }),
      }));
    });

    it('overview counts only unapproved tasks while retaining approval scope and grade distribution', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.flowRecord.findMany.mockResolvedValue([]);
      prisma.assessmentTask.findMany.mockResolvedValue([
        { ...makeTask('approval'), gradeResult: { rawGrade: 'B', calibratedGrade: null } },
        { ...makeTask('approval', { id: 'approved', approvedAt: new Date() }), gradeResult: { rawGrade: 'C', calibratedGrade: null } },
        { ...makeTask('approval', { id: 'other', approverId: 'vp-2' }), gradeResult: { rawGrade: 'D', calibratedGrade: null } },
      ]);

      const result = await service.getOverview('cycle-1', makeViewer());

      expect(result).toMatchObject({ ownPending: 1, ownTotal: 2, cyclePending: 2 });
      expect(result.gradeDistribution.C.count).toBe(1);
    });

    it.each([
      makeViewer({ id: 'cycle-owner', sysRole: 'employee' }),
      makeViewer({ id: 'unrelated', sysRole: 'employee' }),
      makeViewer({ id: 'hr-without-global-read', sysRole: 'hr' }),
    ])('rejects an overview without an existing approval read relation for $id', async (viewer) => {
      prisma.assessmentCycle.findUnique.mockResolvedValue({ ...makeCycle(), hrOwnerId: 'cycle-owner', createdBy: 'cycle-owner' });
      prisma.assessmentTask.findMany.mockResolvedValue([{ ...makeTask('hr_calibration'), gradeResult: { rawGrade: 'A', calibratedGrade: null } }]);
      prisma.flowRecord.findMany.mockResolvedValue([]);
      await expect(service.getOverview('cycle-1', viewer)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.flowRecord.findMany).not.toHaveBeenCalled();
    });

    it('does not grant overview access from an approval assignment on the viewer own result alone', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([{ ...makeTask('approval', { employeeId: 'vp-1' }), gradeResult: { rawGrade: 'A', calibratedGrade: null } }]);
      prisma.flowRecord.findMany.mockResolvedValue([]);
      await expect(service.getOverview('cycle-1', makeViewer())).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each(['manager_scoring', 'hr_calibration', 'approval', 'published'] as TaskStatus[])('preserves approval reference access from a frozen assignment at %s', async (status) => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([{ ...makeTask(status), gradeResult: { rawGrade: 'B', calibratedGrade: null } }]);
      prisma.flowRecord.findMany.mockResolvedValue([]);
      await expect(service.getOverview('cycle-1', makeViewer())).resolves.toMatchObject({ ownTotal: 1 });
    });

    it.each([makeViewer({ sysRole: 'system_admin' }), makeViewer({ canViewAll: true })])('preserves existing global overview read access for $sysRole / $canViewAll', async (viewer) => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([{ ...makeTask('approval', { approverId: 'other-approver' }), gradeResult: { rawGrade: 'B', calibratedGrade: null } }]);
      prisma.flowRecord.findMany.mockResolvedValue([]);
      await expect(service.getOverview('cycle-1', viewer)).resolves.toMatchObject({ ownTotal: 0, gradeDistribution: { B: { count: 1 } } });
    });

    it.each([makeViewer(), makeViewer({ sysRole: 'system_admin' }), makeViewer({ canViewAll: true })])('excludes the viewer from overview distribution and rejection reasons even with $sysRole / $canViewAll access', async (viewer) => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([
        { ...makeTask('approval', { id: 'own-result', employeeId: viewer.id }), gradeResult: { rawGrade: 'A', calibratedGrade: null } },
        { ...makeTask('approval', { id: 'other-result' }), gradeResult: { rawGrade: 'B', calibratedGrade: null } },
      ]);
      const rejectionRecords = [
        { task: { employeeId: viewer.id, employee: { name: '本人' } }, nodeType: 'hr_calibration', comment: '本人未公示等级 A 的退回依据', actor: { name: 'HR' }, createdAt: new Date() },
        { task: { employeeId: 'emp-1', employee: { name: '其他员工' } }, nodeType: 'dept_review', comment: '其他员工退回依据', actor: { name: '复核人' }, createdAt: new Date() },
      ];
      prisma.flowRecord.findMany.mockImplementation(async ({ where }) => rejectionRecords.filter(record => record.task.employeeId !== where.task?.employeeId?.not));
      const result = await service.getOverview('cycle-1', viewer);
      expect(result.gradeDistribution.A.count).toBe(0);
      expect(result.gradeDistribution.B).toMatchObject({ count: 1, ratio: 1 });
      expect(result.rejects.map(record => record.comment)).toEqual(['其他员工退回依据']);
    });

    it.each([makeViewer(), makeViewer({ sysRole: 'system_admin' }), makeViewer({ canViewAll: true })])('masks the viewer unpublished scores, grades and veto without removing their workflow row for $sysRole / $canViewAll', async (viewer) => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      const basis = { calculatedScore: new Prisma.Decimal(98), rawGrade: 'A', calibratedGrade: 'D', isVeto: true, approverId: viewer.id, approvedAt: null };
      const row = { ...makeTask('approval', { employeeId: viewer.id }), employee: { name: '本人', position: '测试岗位' }, dept: { name: '测试部门' }, gradeResult: basis };
      prisma.assessmentTask.findMany.mockResolvedValue([
        row,
        { ...row, id: 'other-result', employeeId: 'emp-2', employee: { name: '其他员工', position: '测试岗位' } },
      ]);
      const result = await service.getApprovalList('cycle-1', viewer);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 'task-1', employeeId: viewer.id, approverId: viewer.id, status: 'approval', totalScore: null, rawGrade: null, calibratedGrade: null, isVeto: false });
      expect(result[1]).toMatchObject({ id: 'other-result', totalScore: 98, rawGrade: 'A', calibratedGrade: 'D', isVeto: true });
      expect(basis).toMatchObject({ rawGrade: 'A', calibratedGrade: 'D', isVeto: true });
    });

    it('普通审批人只返回 approver_id 为自己的任务', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([
        {
          ...makeTask('approval'),
          employee: { name: '张三', employeeNo: 'E001', position: '工程师' },
          dept: { name: '研发部' },
          gradeResult: null,
        },
      ]);

      const result = await service.getApprovalList('cycle-1', makeViewer());

      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ cycleId: 'cycle-1', approverId: 'vp-1' }),
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].approverId).toBe('vp-1');
      expect(result[0]).toMatchObject({ employeeNo: 'E001', position: '工程师' });
      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
        include: expect.objectContaining({ employee: { select: { name: true, employeeNo: true, position: true } } }),
      }));
    });

    it('system_admin 返回全量', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([
        {
          ...makeTask('approval', { approverId: 'vp-2' }),
          employee: { name: '李四', position: '经理' },
          dept: { name: '销售部' },
          gradeResult: null,
        },
      ]);

      const result = await service.getApprovalList('cycle-1', makeViewer({ sysRole: 'system_admin' as any }));

      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ cycleId: 'cycle-1' }),
        }),
      );
      expect(result[0].approverId).toBe('vp-2');
    });

    it('canViewAll=true 返回全量', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([
        {
          ...makeTask('approval', { approverId: 'vp-3' }),
          employee: { name: '王五', position: '总监' },
          dept: { name: '财务部' },
          gradeResult: null,
        },
      ]);

      const result = await service.getApprovalList('cycle-1', makeViewer({ canViewAll: true }));

      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ approverId: expect.anything() }),
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('列表使用任务快照中的 approverId 作为当前操作责任人', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([{
        ...makeTask('approval', { approverId: 'vp-1' }),
        employee: { name: '张三', position: '工程师' },
        dept: { name: '研发部' },
        gradeResult: {
          calculatedScore: new Prisma.Decimal(90),
          rawGrade: 'A',
          calibratedGrade: 'A',
          isVeto: false,
          approverId: 'historic-approver',
          approvedAt: null,
        },
      }]);

      const [item] = await service.getApprovalList('cycle-1', makeViewer());

      expect(item.approverId).toBe('vp-1');
    });
  });

  describe('POST /cycles/:id/approval 批量审批', () => {
    it('rejects a stale approval claim before overwriting grade approval or creating audit', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([makeTask('approval')]);
      tx.assessmentTask.updateMany = jest.fn().mockResolvedValue({ count: 0 });

      await expect(service.approveTasks('cycle-1', { taskIds: ['task-1'] }, makeViewer()))
        .rejects.toThrow(ConflictException);
      expect(tx.gradeResult.upsert).not.toHaveBeenCalled();
      expect(tx.flowRecord.create).not.toHaveBeenCalled();
    });

    it('在同一事务内写 GradeResult.approver_id/approved_at、Task.approved_at 与 FlowRecord，不改 status', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([makeTask('approval')]);
      tx.gradeResult.upsert.mockResolvedValue({ id: 'gr-1' });
      tx.assessmentTask.update.mockResolvedValue(makeTask('approval'));
      tx.flowRecord.create.mockResolvedValue({ id: 'fr-1' });

      const result = await service.approveTasks(
        'cycle-1',
        { taskIds: ['task-1'], comment: '同意' },
        makeViewer(),
      );

      expect(result.approved).toBe(1);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.gradeResult.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { taskId: 'task-1' },
          create: expect.objectContaining({ approverId: 'vp-1', approvedAt: expect.any(Date) }),
          update: expect.objectContaining({ approverId: 'vp-1', approvedAt: expect.any(Date) }),
        }),
      );
      expect(tx.assessmentTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'task-1', status: 'approval', approvedAt: null, approverId: 'vp-1' }),
          data: { approvedAt: expect.any(Date), updatedAt: expect.any(Date) },
        }),
      );
      expect(tx.flowRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taskId: 'task-1',
            cycleId: 'cycle-1',
            nodeType: 'approval',
            action: 'approve',
            actorId: 'vp-1',
            comment: '同意',
          }),
        }),
      );
    });

    it('任务数量不匹配时抛 4001', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([]);

      await expect(
        service.approveTasks('cycle-1', { taskIds: ['task-1'] }, makeViewer()),
      ).rejects.toThrow(ConflictException);

      try {
        await service.approveTasks('cycle-1', { taskIds: ['task-1'] }, makeViewer());
      } catch (err) {
        expect((err as ConflictException).getResponse()).toMatchObject({ code: ERROR_CODE.CONFLICT });
      }
    });

    it('canViewAll 仍只能审批明确分配给自己的任务', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([]);

      await expect(service.approveTasks(
        'cycle-1',
        { taskIds: ['task-1'] },
        makeViewer({ canViewAll: true }),
      )).rejects.toThrow(ConflictException);

      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ approverId: 'vp-1' }),
      });
    });

    it('system_admin 也不能代替任务审批人批量审批', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([]);

      await expect(service.approveTasks(
        'cycle-1',
        { taskIds: ['task-1'] },
        makeViewer({ sysRole: 'system_admin' as any }),
      )).rejects.toThrow(ConflictException);

      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ approverId: 'vp-1' }),
      });
    });
  });

  describe('POST /tasks/:id/approval/reject 退回', () => {
    it('cannot reject an already approved result awaiting HR publication', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(makeTask('approval', { approvedAt: new Date() }));

      await expect(service.rejectTask('task-1', {}, makeViewer())).rejects.toThrow(ConflictException);
      expect(flowService.transitionTx).not.toHaveBeenCalled();
    });

    it('cannot reject after concurrent approval claims the same pending task', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(makeTask('approval'));
      tx.assessmentTask.updateMany = jest.fn().mockResolvedValue({ count: 0 });

      await expect(service.rejectTask('task-1', {}, makeViewer())).rejects.toThrow(ConflictException);
      expect(flowService.transitionTx).not.toHaveBeenCalled();
      expect(tx.gradeResult.updateMany).not.toHaveBeenCalled();
    });

    it('flow.transitionTx 到 hr_calibration 并清空 GradeResult 审批痕迹', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue({
        ...makeTask('approval'),
        gradeResult: { approvedAt: new Date() },
      });
      (flowService.transitionTx as jest.Mock).mockResolvedValue({
        oldStatus: 'approval',
        newStatus: 'hr_calibration',
        nodeType: 'approval',
      });

      const result = await service.rejectTask('task-1', { comment: '需重新校准' }, makeViewer());

      expect(result.status).toBe('hr_calibration');
      expect(flowService.transitionTx).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          task: expect.objectContaining({ id: 'task-1', status: 'approval' }),
          action: 'reject',
          targetStatus: 'hr_calibration',
          actorId: 'vp-1',
          comment: '需重新校准',
          taskUpdate: { approvedAt: null },
        }),
      );
      expect(tx.gradeResult.updateMany).toHaveBeenCalledWith({
        where: { taskId: 'task-1' },
        data: { approverId: null, approvedAt: null },
      });
    });

    it('非审批人操作抛 4003', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(makeTask('approval', { approverId: 'vp-2' }));

      await expect(service.rejectTask('task-1', {}, makeViewer())).rejects.toThrow(ForbiddenException);
    });

    it('canViewAll 不能退回其他审批人的任务', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(makeTask('approval', { approverId: 'vp-2' }));

      await expect(
        service.rejectTask('task-1', {}, makeViewer({ canViewAll: true })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('非 approval 状态抛 4001', async () => {
      prisma.assessmentTask.findUnique.mockResolvedValue(makeTask('hr_calibration'));

      await expect(service.rejectTask('task-1', {}, makeViewer())).rejects.toThrow(BadRequestException);
    });
  });

  describe('周期不存在', () => {
    it('getApprovalList 周期不存在抛 4004', async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(null);

      await expect(service.getApprovalList('cycle-x', makeViewer())).rejects.toThrow(NotFoundException);
    });
  });
});
