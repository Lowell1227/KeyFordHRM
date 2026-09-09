import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  AssessmentCycle,
  AssessmentTask,
  Prisma,
  TaskStatus,
} from "@prisma/client";
import { PublishService, calcAppealDeadline } from "./publish.service";
import { PrismaService } from "@/prisma/prisma.service";
import { FlowService } from "@/tasks/flow.service";
import { NotificationsService } from "@/notifications/notifications.service";
import { ERROR_CODE } from "@/common/constants/error-codes";
import { AuthUser } from "@/common/types/auth.types";
import { PublicationRecordsQueryDto } from "./dto/publication-records-query.dto";

function makeViewer(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "hr-1",
    name: "HR",
    sysRole: "hr" as any,
    deptId: "dept-1",
    isAssessorOnly: false,
    canViewAll: false,
    ...overrides,
  };
}

function makeCycle(overrides?: Partial<AssessmentCycle>): AssessmentCycle {
  return {
    id: "cycle-1",
    name: "2026 Q1",
    type: "quarterly" as any,
    startDate: new Date("2026-01-01"),
    endDate: new Date("2026-03-31"),
    deadlineIndicatorSetting: null,
    deadlineIndicatorConfirm: null,
    deadlineSelfEval: null,
    deadlineManagerScore: null,
    deadlineHrCalibration: null,
    deadlineApproval: null,
    deadlinePublish: null,
    deadlineAppeal: null,
    status: "approval" as any,
    publishVisibleFields: {},
    gradeAMaxRatio: new Prisma.Decimal(0.2),
    gradeBMaxRatio: new Prisma.Decimal(0.4),
    gradeCMaxRatio: new Prisma.Decimal(0.3),
    gradeDMaxRatio: new Prisma.Decimal(0.1),
    createdBy: null,
    publishedAt: null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AssessmentCycle;
}

function makeTask(
  status: TaskStatus,
  approvedAt?: Date | null,
  overrides?: Partial<AssessmentTask>,
  gradeResult?: { calibratedGrade?: string | null; rawGrade?: string | null },
): AssessmentTask {
  return {
    id: "task-1",
    cycleId: "cycle-1",
    snapshotId: "snap-1",
    employeeId: "emp-1",
    deptId: "dept-1",
    managerId: "mgr-1",
    deptHeadId: "head-1",
    approverId: "vp-1",
    status,
    isExempt: false,
    exemptReason: null,
    indicatorSetAt: null,
    indicatorConfirmedAt: null,
    selfEvalSubmittedAt: null,
    managerScoredAt: null,
    deptReviewedAt: null,
    hrCalibratedAt: null,
    approvedAt: approvedAt ?? null,
    publishedAt: null,
    employeeConfirmedAt: status === "confirmed" ? new Date("2026-09-02") : null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    appeals: [],
    gradeResult: {
      approvedAt,
      employeeConfirmedAt: status === "confirmed" ? new Date("2026-09-02") : null,
      calibratedGrade: (gradeResult?.calibratedGrade ?? null) as any,
      rawGrade: (gradeResult?.rawGrade ?? null) as any,
    },
    ...overrides,
  } as AssessmentTask;
}

describe("calcAppealDeadline", () => {
  it("基于 publishedAt + appealWindowDays 天", () => {
    const publishedAt = new Date("2026-04-05T10:00:00Z");
    const cycle = makeCycle();

    const deadline = calcAppealDeadline(publishedAt, cycle, 30);

    expect(deadline.getFullYear()).toBe(2026);
    expect(deadline.getMonth()).toBe(4); // 5 月
    expect(deadline.getDate()).toBe(5);
  });

  it("使用配置天数（如 15 天）", () => {
    const publishedAt = new Date("2026-04-05T10:00:00Z");
    const cycle = makeCycle();

    const deadline = calcAppealDeadline(publishedAt, cycle, 15);

    expect(deadline.getFullYear()).toBe(2026);
    expect(deadline.getMonth()).toBe(3); // 4 月
    expect(deadline.getDate()).toBe(20);
  });

  it("已有 cycle.deadlineAppeal 更晚时取 max", () => {
    const publishedAt = new Date("2026-04-05T10:00:00Z");
    const cycle = makeCycle({ deadlineAppeal: new Date("2026-06-01") });

    const deadline = calcAppealDeadline(publishedAt, cycle, 30);

    expect(deadline.toDateString()).toBe(new Date("2026-06-01").toDateString());
  });
});

describe("PublishService", () => {
  let service: PublishService;
  let prisma: any;
  let flowService: Partial<FlowService>;
  let notificationsService: Partial<NotificationsService>;
  let tx: any;

  beforeEach(async () => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      assessmentCycle: { update: jest.fn() },
      assessmentTask: {
        update: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      flowRecord: { create: jest.fn() },
      gradeResult: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      performanceInterview: { upsert: jest.fn() },
      improvementPlan: { upsert: jest.fn() },
    };

    prisma = {
      $transaction: jest.fn((cb: any) => cb(tx)),
      assessmentCycle: { findUnique: jest.fn() },
      assessmentTask: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
      },
      systemConfig: { findUnique: jest.fn() },
    };

    flowService = {
      transitionTx: jest.fn(),
    };

    notificationsService = {
      sendResultPublished: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublishService,
        { provide: PrismaService, useValue: prisma },
        { provide: FlowService, useValue: flowService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<PublishService>(PublishService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("前置校验", () => {
    it("hr_user 缺少公示能力时在读取周期前拒绝", async () => {
      const viewer = makeViewer({
        sysRole: "hr_user" as any,
        hrCapabilities: [],
      });

      await expect(
        service.getPublicationRecords(
          "cycle-1",
          new PublicationRecordsQueryDto(),
          viewer,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.assessmentCycle.findUnique).not.toHaveBeenCalled();
      expect(prisma.assessmentTask.findMany).not.toHaveBeenCalled();
    });

    it("hr_user 仅可读取本人负责周期且越权时不读取任务", async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(
        makeCycle({ hrOwnerId: "other-owner" } as any),
      );
      const viewer = makeViewer({
        sysRole: "hr_user" as any,
        hrCapabilities: ["performance_publish"],
      });

      await expect(
        service.getPublicationRecords(
          "cycle-1",
          new PublicationRecordsQueryDto(),
          viewer,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.assessmentTask.findMany).not.toHaveBeenCalled();
    });

    it("hr_user 公示写入同样要求公示能力和周期归属", async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(
        makeCycle({ hrOwnerId: "other-owner" } as any),
      );
      const viewer = makeViewer({
        sysRole: "hr_user" as any,
        hrCapabilities: ["performance_publish"],
      });

      await expect(
        service.publishCycle("cycle-1", { taskIds: ["task-1"] }, viewer),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("周期不存在抛 4004", async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(null);

      await expect(
        service.publishCycle("cycle-x", { taskIds: ["task-1"] }, makeViewer()),
      ).rejects.toThrow(NotFoundException);
    });

    it("taskIds 为空或无效由 ValidationPipe 拦截（单测层面校验 DTO 结构）", () => {
      // DTO 已加 @ArrayNotEmpty + @IsUUID('4', { each: true })
      // 这里主要覆盖 service 不会收到空数组后误操作
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.assessmentTask.findMany.mockResolvedValue([]);

      return expect(
        service.publishCycle("cycle-1", { taskIds: [] as any }, makeViewer()),
      ).rejects.toThrow(BadRequestException);
    });

    it("勾选的任务不全是 approval 态或非本周期时抛 4001", async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      tx.assessmentTask.findMany.mockResolvedValue([
        makeTask("approval", new Date()),
      ]);

      await expect(
        service.publishCycle(
          "cycle-1",
          { taskIds: ["task-1", "task-2"] },
          makeViewer(),
        ),
      ).rejects.toThrow(ConflictException);

      try {
        await service.publishCycle(
          "cycle-1",
          { taskIds: ["task-1", "task-2"] },
          makeViewer(),
        );
      } catch (err) {
        expect((err as ConflictException).getResponse()).toMatchObject({
          code: ERROR_CODE.CONFLICT,
        });
      }
    });

    it("勾选中存在未审批任务时抛 4009 并列出任务", async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      tx.assessmentTask.findMany.mockResolvedValue([
        makeTask("approval", new Date()),
        makeTask("approval", null, { id: "task-2" }),
      ]);

      await expect(
        service.publishCycle(
          "cycle-1",
          { taskIds: ["task-1", "task-2"] },
          makeViewer(),
        ),
      ).rejects.toThrow(ConflictException);

      try {
        await service.publishCycle(
          "cycle-1",
          { taskIds: ["task-1", "task-2"] },
          makeViewer(),
        );
      } catch (err) {
        const resp = (err as ConflictException).getResponse() as any;
        expect(resp.code).toBe(ERROR_CODE.CONFLICT);
        expect(resp.message).toContain("task-2");
      }
    });
  });

  describe("公示记录读取", () => {
    const query = Object.assign(new PublicationRecordsQueryDto(), {
      page: 1,
      pageSize: 20,
    });
    const employee = { name: "员工甲", employeeNo: "E001", position: "顾问" };
    const dept = { name: "咨询部" };
    const manager = { name: "主管乙" };

    beforeEach(() => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(
        makeCycle({ hrOwnerId: "hr-1" } as any),
      );
      prisma.assessmentTask.count = jest.fn().mockResolvedValue(6);
    });

    it("按部门和员工姓名或工号过滤公示记录", async () => {
      prisma.assessmentTask.count.mockResolvedValue(0);
      prisma.assessmentTask.findMany.mockResolvedValue([]);

      await service.getPublicationRecords(
        "cycle-1",
        { page: 1, pageSize: 20, skip: 0, take: 20, deptId: "dept-1", keyword: "E001" } as any,
        makeViewer(),
      );

      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          cycleId: "cycle-1", deptId: "dept-1",
          employee: { OR: [
            { name: { contains: "E001", mode: "insensitive" } },
            { employeeNo: { contains: "E001", mode: "insensitive" } },
          ] },
        }),
      }));
    });

    it("分页保留各公示阶段并区分待审批和待公示", async () => {
      prisma.assessmentTask.findMany.mockResolvedValue([
        { ...makeTask("approval", null), employee, dept },
        {
          ...makeTask("approval", new Date("2026-09-01"), { id: "ready" }),
          employee,
          dept,
        },
        {
          ...makeTask("published", new Date("2026-09-01"), {
            id: "published",
            publishedAt: new Date("2026-09-02"),
          }),
          employee,
          dept,
        },
        {
          ...makeTask("confirmed", new Date("2026-09-01"), {
            id: "confirmed",
            publishedAt: new Date("2026-09-02"),
            employeeConfirmedAt: new Date("2026-09-03"),
          }),
          employee,
          dept,
        },
        {
          ...makeTask("appealing", new Date("2026-09-01"), {
            id: "appealing",
            publishedAt: new Date("2026-09-02"),
          }),
          employee,
          dept,
        },
        {
          ...makeTask("closed", new Date("2026-09-01"), {
            id: "closed",
            publishedAt: new Date("2026-09-02"),
            closedAt: new Date("2026-09-05"),
          }),
          employee,
          dept,
        },
      ]);

      const result = await service.getPublicationRecords(
        "cycle-1",
        query,
        makeViewer(),
      );

      expect(result.total).toBe(6);
      expect(result.items.map((item) => item.publicationState)).toEqual([
        "pending_approval",
        "pending_confirmation",
        "published",
        "confirmed",
        "appealing",
        "closed",
      ]);
      expect(result.items.map((item) => item.canPublish)).toEqual([
        false,
        false,
        false,
        false,
        false,
        false,
      ]);
      expect(prisma.assessmentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            cycleId: "cycle-1",
            OR: [
              { status: { in: ["approval", "published", "confirmed", "appealing", "closed"] } },
              { flowRecords: { some: { nodeType: "approval" } } },
            ],
          }),
          skip: 0,
          take: 20,
        }),
      );
    });

    it("所有角色读取本人已审批未公示结果时遵守可见字段", async () => {
      prisma.assessmentTask.count.mockResolvedValue(1);
      prisma.assessmentTask.findMany.mockResolvedValue([
        {
          ...makeTask("approval", new Date("2026-09-01"), {
            employeeId: "hr-1",
          }),
          employee,
          dept,
          gradeResult: {
            approvedAt: new Date("2026-09-01"),
            calculatedScore: new Prisma.Decimal(91),
            rawGrade: "A",
            calibratedGrade: "A",
            publishedAt: null,
          },
        },
      ]);

      const result = await service.getPublicationRecords(
        "cycle-1",
        query,
        makeViewer({ sysRole: "system_admin" as any }),
      );

      expect(result.items[0]).toMatchObject({
        resultMasked: false,
        totalScore: 91,
        rawGrade: "A",
        calibratedGrade: "A",
      });
    });

    it("本人未公示任务不提供详情", async () => {
      prisma.assessmentTask.findFirst.mockResolvedValue(null);

      await expect(
        service.getPublicationRecordDetail(
          "cycle-1",
          "task-1",
          makeViewer({ id: "emp-1" }),
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.assessmentTask.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "task-1",
            cycleId: "cycle-1",
            OR: expect.any(Array),
          }),
        }),
      );
    });

    it("详情只返回公示白名单字段和关键节点历史", async () => {
      prisma.assessmentTask.findFirst.mockResolvedValue({
        ...makeTask("published", new Date("2026-09-01"), {
          publishedAt: new Date("2026-09-02"),
        }),
        employee,
        dept,
        manager,
        periods: [{ periodKey: "2026-07", status: "completed", selfScoreTotal: new Prisma.Decimal(84), managerScoreTotal: new Prisma.Decimal(88), selfGrade: "B", managerGrade: "A", indicatorReviews: [{ selfScore: new Prisma.Decimal(84), managerScore: new Prisma.Decimal(88), indicatorVersionItem: { id: "v-one", sourceInstanceId: "goal-one", name: "月度指标", weight: new Prisma.Decimal(1), indicatorType: "kpi" } }] }],
        gradeResult: {
          approvedAt: new Date("2026-09-01"),
          calculatedScore: new Prisma.Decimal(88),
          rawGrade: "B",
          calibratedGrade: "A",
          publishedAt: new Date("2026-09-02"),
        },
        flowRecords: [
          {
            id: "flow-1",
            nodeType: "approval",
            action: "approve",
            comment: "同意公示",
            extraData: null,
            createdAt: new Date("2026-09-01"),
            actor: { name: "审批人丙" },
          },
        ],
        cycle: { name: "2026 Q1" },
      });

      const result = await service.getPublicationRecordDetail(
        "cycle-1",
        "task-1",
        makeViewer(),
      );

      expect(result).toMatchObject({
        taskId: "task-1",
        cycleName: "2026 Q1",
        employeeName: "员工甲",
        deptName: "咨询部",
        position: "顾问",
        managerName: "主管乙",
        totalScore: 88,
        rawGrade: "B",
        calibratedGrade: "A",
        publicationState: "published",
        resultEvidence: { periods: [{ periodKey: "2026-07", selfScoreTotal: 84, managerScoreTotal: 88 }], indicators: [{ name: "月度指标", avgManagerScore: 88 }] },
        flowRecords: [{ actorName: "审批人丙", comment: "同意公示" }],
      });
      expect(result).not.toHaveProperty("selfEvalSummary");
      expect(result).not.toHaveProperty("managerEvalSummary");
    });

    it.each([
      {
        visible: { total_score: false, grade: true, manager_comment: true },
        expected: {
          totalScore: null,
          rawGrade: "A",
          calibratedGrade: "A",
        },
      },
      {
        visible: { total_score: true, grade: false, manager_comment: false },
        expected: {
          totalScore: 96,
          rawGrade: null,
          calibratedGrade: null,
        },
      },
    ])(
      "本人已公示详情按 $visible 遮罩结果及历史文字",
      async ({ visible, expected }) => {
        prisma.assessmentCycle.findUnique.mockResolvedValue(
          makeCycle({
            hrOwnerId: "hr-1",
            publishVisibleFields: visible,
          } as any),
        );
        prisma.assessmentTask.findFirst.mockResolvedValue({
          ...makeTask("published", new Date("2026-09-01"), {
            employeeId: "hr-1",
            publishedAt: new Date("2026-09-02"),
          }),
          employee,
          dept,
          manager,
        periods: [{ periodKey: "2026-07", status: "completed", selfScoreTotal: new Prisma.Decimal(84), managerScoreTotal: new Prisma.Decimal(88), selfGrade: "B", managerGrade: "A", indicatorReviews: [{ selfScore: new Prisma.Decimal(84), managerScore: new Prisma.Decimal(88), indicatorVersionItem: { id: "v-one", sourceInstanceId: "goal-one", name: "月度指标", weight: new Prisma.Decimal(1), indicatorType: "kpi" } }] }],
          gradeResult: {
            approvedAt: new Date("2026-09-01"),
            calculatedScore: new Prisma.Decimal(96),
            rawGrade: "A",
            calibratedGrade: "A",
            publishedAt: new Date("2026-09-02"),
          },
          flowRecords: [
            {
              id: "flow-own",
              nodeType: "manager_score",
              action: "submit",
              comment: "整周期结果评定：最终等级 A（参考均分 96）",
              extraData: {
                type: "final_grade_submitted",
                comment: "主管周期评语",
              },
              createdAt: new Date("2026-09-01"),
              actor: { name: "主管乙" },
            },
            {
              id: "flow-review",
              nodeType: "dept_review",
              action: "approve",
              comment: "复核同意等级 A，总分 96",
              extraData: null,
              createdAt: new Date("2026-09-02"),
              actor: { name: "部门负责人丙" },
            },
          ],
        });

        const result = await service.getPublicationRecordDetail(
          "cycle-1",
          "task-1",
          makeViewer(),
        );

        expect(result.resultEvidence?.periods[0]).toMatchObject({ managerScoreTotal: visible.total_score === false ? null : 88, managerGrade: visible.grade === false ? null : 'A' });
        expect(result).toMatchObject({
          totalScore: expected.totalScore,
          rawGrade: expected.rawGrade,
          calibratedGrade: expected.calibratedGrade,
        });
        expect(
          result.flowRecords.every((record) => record.comment === null),
        ).toBe(true);
        expect(
          result.flowRecords.find((record) => record.id === "flow-own")
            ?.extraData,
        ).toEqual({
          type: "final_grade_submitted",
          comment: null,
        });
      },
    );

    it("仅隐藏主管评语时遮罩上级评定文字但保留其他节点意见", async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(
        makeCycle({
          hrOwnerId: "hr-1",
          publishVisibleFields: {
            total_score: true,
            grade: true,
            manager_comment: false,
          },
        } as any),
      );
      prisma.assessmentTask.findFirst.mockResolvedValue({
        ...makeTask("published", new Date("2026-09-01"), {
          employeeId: "hr-1",
          publishedAt: new Date("2026-09-02"),
        }),
        employee,
        dept,
        manager,
        periods: [{ periodKey: "2026-07", status: "completed", selfScoreTotal: new Prisma.Decimal(84), managerScoreTotal: new Prisma.Decimal(88), selfGrade: "B", managerGrade: "A", indicatorReviews: [{ selfScore: new Prisma.Decimal(84), managerScore: new Prisma.Decimal(88), indicatorVersionItem: { id: "v-one", sourceInstanceId: "goal-one", name: "月度指标", weight: new Prisma.Decimal(1), indicatorType: "kpi" } }] }],
        gradeResult: {
          approvedAt: new Date("2026-09-01"),
          calculatedScore: new Prisma.Decimal(96),
          rawGrade: "A",
          calibratedGrade: "A",
          publishedAt: new Date("2026-09-02"),
        },
        flowRecords: [
          {
            id: "manager-comment",
            nodeType: "manager_score",
            action: "submit",
            comment: "上级评定文字",
            extraData: {
              type: "final_grade_submitted",
              comment: "主管周期评语",
            },
            createdAt: new Date("2026-09-01"),
            actor: { name: "主管乙" },
          },
          {
            id: "approval-comment",
            nodeType: "approval",
            action: "approve",
            comment: "审批意见保留",
            extraData: null,
            createdAt: new Date("2026-09-02"),
            actor: { name: "审批人丁" },
          },
        ],
      });

      const result = await service.getPublicationRecordDetail(
        "cycle-1",
        "task-1",
        makeViewer(),
      );

      expect(
        result.flowRecords.find((record) => record.id === "manager-comment"),
      ).toMatchObject({
        comment: null,
        extraData: { type: "final_grade_submitted", comment: null },
      });
      expect(
        result.flowRecords.find((record) => record.id === "approval-comment")
          ?.comment,
      ).toBe("审批意见保留");
    });
  });

  describe("公示发布事务", () => {
    it("锁定后审批结果已变化时回滚公示事务", async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      tx.assessmentTask.findMany.mockResolvedValue([
        makeTask("confirmed", new Date()),
      ]);
      tx.gradeResult.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.publishCycle("cycle-1", { taskIds: ["task-1"] }, makeViewer()),
      ).rejects.toThrow(ConflictException);

      expect(tx.assessmentCycle.update).not.toHaveBeenCalled();
    });

    it("只公示勾选的 taskIds，未勾选的仍留在 approval，cycle.status 不推进", async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      tx.assessmentTask.findMany.mockResolvedValue([
        makeTask("confirmed", new Date()),
      ]);
      (flowService.transitionTx as jest.Mock).mockResolvedValue({
        oldStatus: "approval",
        newStatus: "published",
        nodeType: "publish",
      });
      tx.assessmentCycle.update.mockResolvedValue(makeCycle());
      tx.assessmentTask.update.mockResolvedValue({});
      tx.assessmentTask.count.mockResolvedValue(1); // 还有 task-2 未公示
      tx.gradeResult.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.publishCycle(
        "cycle-1",
        { taskIds: ["task-1"] },
        makeViewer(),
      );

      expect(result.published).toBe(1);
      const updateData = tx.assessmentCycle.update.mock.calls[0][0].data;
      expect(updateData).toHaveProperty("publishedAt");
      expect(updateData).toHaveProperty("deadlineAppeal");
      expect(updateData.status).toBeUndefined();
    });

    it("本周期已无 approval 任务时 cycle.status 推进为 published", async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.systemConfig.findUnique.mockResolvedValue({ value: 30 });
      tx.assessmentTask.findMany.mockResolvedValue([
        makeTask("confirmed", new Date()),
        makeTask("confirmed", new Date(), { id: "task-2" }),
      ]);
      (flowService.transitionTx as jest.Mock).mockResolvedValue({
        oldStatus: "approval",
        newStatus: "published",
        nodeType: "publish",
      });
      tx.assessmentCycle.update.mockResolvedValue(makeCycle());
      tx.assessmentTask.update.mockResolvedValue({});
      tx.assessmentTask.count.mockResolvedValue(0);
      tx.gradeResult.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.publishCycle(
        "cycle-1",
        { taskIds: ["task-1", "task-2"] },
        makeViewer(),
      );

      expect(result.published).toBe(2);
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        (flowService.transitionTx as jest.Mock).mock.invocationCallOrder[0],
      );
      expect(tx.assessmentCycle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "cycle-1" },
          data: expect.objectContaining({ status: "published" }),
        }),
      );
    });

    it("配置 appeal_window_days 为 15 时 deadlineAppeal 按 15 天计算", async () => {
      const cycle = makeCycle();
      prisma.assessmentCycle.findUnique.mockResolvedValue(cycle);
      prisma.systemConfig.findUnique.mockResolvedValue({ value: 15 });
      tx.assessmentTask.findMany.mockResolvedValue([
        makeTask("confirmed", new Date()),
      ]);
      (flowService.transitionTx as jest.Mock).mockResolvedValue({
        oldStatus: "approval",
        newStatus: "published",
        nodeType: "publish",
      });
      tx.assessmentCycle.update.mockResolvedValue(cycle);
      tx.assessmentTask.update.mockResolvedValue({});
      tx.assessmentTask.count.mockResolvedValue(0);
      tx.gradeResult.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.publishCycle(
        "cycle-1",
        { taskIds: ["task-1"] },
        makeViewer(),
      );

      const expected = new Date(result.publishedAt);
      expected.setDate(expected.getDate() + 15);
      expected.setHours(0, 0, 0, 0);
      expect(result.deadlineAppeal.getTime()).toBe(expected.getTime());
    });

    it("sendDingtalkNotification=true 时给员工发结果发布通知", async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      tx.assessmentTask.findMany.mockResolvedValue([
        makeTask("confirmed", new Date()),
      ]);
      (flowService.transitionTx as jest.Mock).mockResolvedValue({
        oldStatus: "approval",
        newStatus: "published",
        nodeType: "publish",
      });
      tx.assessmentTask.count.mockResolvedValue(0);
      (notificationsService.sendResultPublished as jest.Mock).mockResolvedValue(
        "log-1",
      );

      await service.publishCycle(
        "cycle-1",
        { taskIds: ["task-1"], sendDingtalkNotification: true },
        makeViewer(),
      );

      expect(notificationsService.sendResultPublished).toHaveBeenCalledWith(
        "task-1",
      );
    });

    it("sendDingtalkNotification=false/未传 时不发通知", async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      tx.assessmentTask.findMany.mockResolvedValue([
        makeTask("confirmed", new Date()),
      ]);
      (flowService.transitionTx as jest.Mock).mockResolvedValue({
        oldStatus: "approval",
        newStatus: "published",
        nodeType: "publish",
      });
      tx.assessmentTask.count.mockResolvedValue(0);

      await service.publishCycle(
        "cycle-1",
        { taskIds: ["task-1"] },
        makeViewer(),
      );

      expect(notificationsService.sendResultPublished).not.toHaveBeenCalled();
    });

    it("最终等级为 D 时自动创建 draft 绩效改进计划", async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      tx.assessmentTask.findMany.mockResolvedValue([
        makeTask(
          "confirmed",
          new Date(),
          { id: "task-1" },
          { calibratedGrade: "D", rawGrade: "D" },
        ),
      ]);
      (flowService.transitionTx as jest.Mock).mockResolvedValue({
        oldStatus: "approval",
        newStatus: "published",
        nodeType: "publish",
      });
      tx.assessmentTask.count.mockResolvedValue(0);

      await service.publishCycle(
        "cycle-1",
        { taskIds: ["task-1"] },
        makeViewer(),
      );

      expect(tx.improvementPlan.upsert).toHaveBeenCalledWith({
        where: {
          employeeId_cycleId: { employeeId: "emp-1", cycleId: "cycle-1" },
        },
        create: {
          employeeId: "emp-1",
          cycleId: "cycle-1",
          taskId: "task-1",
          status: "draft",
        },
        update: {},
      });
    });

    it("最终等级非 D 时不创建绩效改进计划", async () => {
      prisma.assessmentCycle.findUnique.mockResolvedValue(makeCycle());
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      tx.assessmentTask.findMany.mockResolvedValue([
        makeTask(
          "confirmed",
          new Date(),
          { id: "task-1" },
          { calibratedGrade: "C", rawGrade: "C" },
        ),
      ]);
      (flowService.transitionTx as jest.Mock).mockResolvedValue({
        oldStatus: "approval",
        newStatus: "published",
        nodeType: "publish",
      });
      tx.assessmentTask.count.mockResolvedValue(0);

      await service.publishCycle(
        "cycle-1",
        { taskIds: ["task-1"] },
        makeViewer(),
      );

      expect(tx.improvementPlan.upsert).not.toHaveBeenCalled();
    });
  });
});
