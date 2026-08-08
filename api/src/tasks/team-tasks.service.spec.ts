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
      findMany: jest.Mock;
      groupBy: jest.Mock;
    };
  };

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
        findMany: jest.fn(),
        groupBy: jest.fn(),
      },
    };
    service = new TeamTasksService(prisma as unknown as PrismaService);
  });

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
});
