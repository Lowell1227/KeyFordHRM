import "reflect-metadata";
import { Prisma, SysRole, TaskStatus } from "@prisma/client";
import { PrismaService } from "@/prisma/prisma.service";
import { AuthUser } from "@/common/types/auth.types";
import { TeamTaskQueryDto } from "./dto/team-task-query.dto";
import { TeamTasksService } from "./team-tasks.service";

describe("TeamTasksService", () => {
  let service: TeamTasksService;
  let prisma: {
    assessmentTask: {
      count: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      groupBy: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let flowService: { transitionTx: jest.Mock };
  let notificationsService: { create: jest.Mock };

  const managerViewer: AuthUser = {
    id: "manager-1",
    name: "Manager",
    sysRole: SysRole.manager,
    deptId: "dept-1",
    isAssessorOnly: false,
    canViewAll: false,
  };

  beforeEach(() => {
    prisma = {
      assessmentTask: {
        count: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        groupBy: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    flowService = { transitionTx: jest.fn() };
    notificationsService = { create: jest.fn() };
    service = new TeamTasksService(
      prisma as unknown as PrismaService,
      flowService as any,
      notificationsService as any,
    );
  });

  function makeReviewTask(
    id: string,
    overrides: Partial<{
      managerId: string | null;
      status: TaskStatus;
      updatedAt: Date;
      indicatorInstances: Array<{ weight: Prisma.Decimal }>;
    }> = {},
  ) {
    return {
      id,
      cycleId: "cycle-1",
      employeeId: `${id}-employee`,
      managerId: managerViewer.id,
      deptHeadId: null,
      approverId: null,
      status: "indicator_reviewing" as TaskStatus,
      updatedAt: new Date("2026-08-08T08:00:00.000Z"),
      indicatorInstances: [{ weight: new Prisma.Decimal(1) }],
      ...overrides,
    };
  }

  function mockSuccessfulReviewTransaction() {
    const tx = {
      assessmentTask: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      flowRecord: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    flowService.transitionTx.mockImplementation(async (_tx, input) => ({
      oldStatus: input.task.status,
      newStatus: input.targetStatus,
      nodeType: "indicator_setting",
    }));
    return tx;
  }

  it("keeps every requested filter within the current manager scope", async () => {
    const query = Object.assign(new TeamTaskQueryDto(), {
      page: 2,
      pageSize: 5,
      stage: "manager-eval" as const,
      stageState: "pending" as const,
      cycleId: "cycle-1",
      deptId: "dept-1",
      employeeId: "employee-1",
      keyword: "Ada",
    });
    prisma.assessmentTask.count.mockResolvedValueOnce(1);
    prisma.assessmentTask.groupBy.mockResolvedValue([
      { status: "self_eval" as TaskStatus, _count: { status: 4 } },
      { status: "manager_scoring" as TaskStatus, _count: { status: 2 } },
      { status: "dept_review" as TaskStatus, _count: { status: 3 } },
      { status: "exempted" as TaskStatus, _count: { status: 1 } },
    ]);
    prisma.assessmentTask.findMany
      .mockResolvedValueOnce([
        {
          id: "task-1",
          cycleId: "cycle-1",
          employeeId: "employee-1",
          deptId: "dept-1",
          managerId: "manager-1",
          status: "manager_scoring" as TaskStatus,
          updatedAt: new Date("2026-08-08T00:00:00.000Z"),
          cycle: { name: "2026 H2" },
          employee: {
            name: "Ada",
            employeeNo: "E-001",
            avatarUrl: "https://example.test/ada.png",
            position: "Engineer",
          },
          dept: { name: "Engineering" },
          gradeResult: {
            calculatedScore: new Prisma.Decimal(88),
            rawGrade: "A",
          },
        },
      ])
      .mockResolvedValueOnce([{ dept: { id: "dept-1", name: "Engineering" } }])
      .mockResolvedValueOnce([
        {
          employee: {
            id: "employee-1",
            name: "Ada",
            employeeNo: "E-001",
            deptId: "dept-1",
          },
        },
      ]);

    const result = await service.findAll(query, managerViewer);

    expect(prisma.assessmentTask.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          managerId: managerViewer.id,
          cycleId: "cycle-1",
          deptId: "dept-1",
          employeeId: "employee-1",
          employee: {
            OR: [
              { name: { contains: "Ada", mode: "insensitive" } },
              { employeeNo: { contains: "Ada", mode: "insensitive" } },
            ],
          },
          status: { in: ["manager_scoring"] },
        }),
        skip: 5,
        take: 5,
      }),
    );
    expect(prisma.assessmentTask.count).toHaveBeenCalledTimes(1);
    expect(prisma.assessmentTask.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          managerId: managerViewer.id,
          cycleId: "cycle-1",
          deptId: "dept-1",
          employeeId: "employee-1",
          employee: {
            OR: [
              { name: { contains: "Ada", mode: "insensitive" } },
              { employeeNo: { contains: "Ada", mode: "insensitive" } },
            ],
          },
          status: { in: ["manager_scoring"] },
        }),
      }),
    );
    expect(prisma.assessmentTask.groupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: expect.objectContaining({
        managerId: managerViewer.id,
        cycleId: "cycle-1",
        deptId: "dept-1",
        employeeId: "employee-1",
        employee: {
          OR: [
            { name: { contains: "Ada", mode: "insensitive" } },
            { employeeNo: { contains: "Ada", mode: "insensitive" } },
          ],
        },
      }),
      _count: { status: true },
    });
    expect(prisma.assessmentTask.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { managerId: managerViewer.id, cycleId: "cycle-1" },
      }),
    );
    expect(prisma.assessmentTask.findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: { managerId: managerViewer.id, cycleId: "cycle-1" },
      }),
    );
    expect(result).toEqual({
      total: 1,
      page: 2,
      pageSize: 5,
      items: [
        expect.objectContaining({
          id: "task-1",
          employeeNo: "E-001",
          avatarUrl: "https://example.test/ada.png",
          position: "Engineer",
          stageState: "pending",
          totalScore: 88,
        }),
      ],
      counts: { all: 10, notStarted: 4, pending: 2, completed: 3, exempted: 1 },
      facets: {
        departments: [{ id: "dept-1", name: "Engineering" }],
        employees: [
          {
            id: "employee-1",
            name: "Ada",
            employeeNo: "E-001",
            deptId: "dept-1",
          },
        ],
      },
    });
  });

  it.each(["goal-review", "manager-eval"] as const)(
    "filters %s exempted items without indexing an undefined stage array",
    async (stage) => {
      const query = Object.assign(new TeamTaskQueryDto(), {
        stage,
        stageState: "exempted" as const,
      });
      prisma.assessmentTask.count.mockResolvedValue(1);
      prisma.assessmentTask.groupBy.mockResolvedValue([
        { status: "exempted" as TaskStatus, _count: { status: 1 } },
      ]);
      prisma.assessmentTask.findMany.mockResolvedValue([]);

      const result = await service.findAll(query, managerViewer);

      const itemWhere = {
        managerId: managerViewer.id,
        status: { in: ["exempted"] },
      };
      expect(prisma.assessmentTask.count).toHaveBeenCalledWith({
        where: itemWhere,
      });
      expect(prisma.assessmentTask.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ where: itemWhere }),
      );
      expect(result).toMatchObject({
        total: 1,
        counts: {
          all: 1,
          notStarted: 0,
          pending: 0,
          completed: 0,
          exempted: 1,
        },
      });
    },
  );

  it("approves owned review tasks while recording a foreign task failure", async () => {
    const transaction = mockSuccessfulReviewTransaction();
    prisma.assessmentTask.findUnique
      .mockResolvedValueOnce(makeReviewTask("valid-task"))
      .mockResolvedValueOnce(makeReviewTask("foreign-task", { managerId: "manager-2" }));

    const result = await service.batchApprove(
      {
        tasks: [
          { taskId: "valid-task", updatedAt: "2026-08-08T08:00:00.000Z" },
          { taskId: "foreign-task", updatedAt: "2026-08-08T08:00:00.000Z" },
        ],
      },
      managerViewer,
    );

    expect(result).toEqual({
      succeeded: [{ taskId: "valid-task", status: "indicator_confirming" }],
      failed: [{ taskId: "foreign-task", reason: "无权审核该员工目标" }],
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.assessmentTask.updateMany).toHaveBeenCalledWith({
      where: {
        id: "valid-task",
        updatedAt: new Date("2026-08-08T08:00:00.000Z"),
      },
      data: { updatedAt: expect.any(Date) },
    });
    expect(flowService.transitionTx).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        action: "submit",
        targetStatus: "indicator_confirming",
        extraData: expect.objectContaining({
          type: "indicator_review_approved",
          source: "manager",
          batchId: expect.any(String),
        }),
      }),
    );
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "valid-task-employee",
        type: "indicator_setting_notice",
      }),
    );
  });

  it.each([
    ["empty indicators", [] as Array<{ weight: Prisma.Decimal }>, "请至少保留一条指标"],
    [
      "a non-100 percent total weight",
      [{ weight: new Prisma.Decimal("0.8") }],
      "目标权重合计必须为100%",
    ],
  ])("records %s as an independent approval failure", async (_label, indicatorInstances, reason) => {
    prisma.assessmentTask.findUnique.mockResolvedValue(
      makeReviewTask("invalid-task", { indicatorInstances }),
    );

    const result = await service.batchApprove(
      { tasks: [{ taskId: "invalid-task", updatedAt: "2026-08-08T08:00:00.000Z" }] },
      managerViewer,
    );

    expect(result).toEqual({ succeeded: [], failed: [{ taskId: "invalid-task", reason }] });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("records a stale task version without beginning its transaction", async () => {
    prisma.assessmentTask.findUnique.mockResolvedValue(
      makeReviewTask("stale-task", { updatedAt: new Date("2026-08-08T08:00:01.000Z") }),
    );

    const result = await service.batchApprove(
      { tasks: [{ taskId: "stale-task", updatedAt: "2026-08-08T08:00:00.000Z" }] },
      managerViewer,
    );

    expect(result).toEqual({
      succeeded: [],
      failed: [{ taskId: "stale-task", reason: "任务已被其他操作更新，请刷新后重试" }],
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects every eligible task in its own transaction with the shared reason", async () => {
    const transactions = [
      {
        assessmentTask: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        flowRecord: { create: jest.fn() },
      },
      {
        assessmentTask: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        flowRecord: { create: jest.fn() },
      },
    ];
    prisma.$transaction.mockImplementation((callback) => callback(transactions[prisma.$transaction.mock.calls.length - 1]));
    flowService.transitionTx.mockImplementation(async (_tx, input) => ({
      oldStatus: input.task.status,
      newStatus: input.targetStatus,
      nodeType: "indicator_setting",
    }));
    prisma.assessmentTask.findUnique
      .mockResolvedValueOnce(makeReviewTask("task-1"))
      .mockResolvedValueOnce(makeReviewTask("task-2"));

    const result = await service.batchReject(
      {
        tasks: [
          { taskId: "task-1", updatedAt: "2026-08-08T08:00:00.000Z" },
          { taskId: "task-2", updatedAt: "2026-08-08T08:00:00.000Z" },
        ],
        reason: "请补充量化标准",
      },
      managerViewer,
    );

    expect(result).toEqual({
      succeeded: [
        { taskId: "task-1", status: "indicator_drafting" },
        { taskId: "task-2", status: "indicator_drafting" },
      ],
      failed: [],
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(flowService.transitionTx).toHaveBeenNthCalledWith(
      1,
      transactions[0],
      expect.objectContaining({
        action: "reject",
        targetStatus: "indicator_drafting",
        comment: "请补充量化标准",
        extraData: expect.objectContaining({
          type: "indicator_review_rejected",
          batchId: expect.any(String),
        }),
      }),
    );
    expect(flowService.transitionTx).toHaveBeenNthCalledWith(
      2,
      transactions[1],
      expect.objectContaining({
        action: "reject",
        targetStatus: "indicator_drafting",
        comment: "请补充量化标准",
      }),
    );
    expect(notificationsService.create).toHaveBeenCalledTimes(2);
  });

  it("requires a nonblank common rejection reason before processing the batch", async () => {
    await expect(
      service.batchReject(
        {
          tasks: [{ taskId: "task-1", updatedAt: "2026-08-08T08:00:00.000Z" }],
          reason: "   ",
        },
        managerViewer,
      ),
    ).rejects.toThrow("请填写驳回原因");

    expect(prisma.assessmentTask.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
