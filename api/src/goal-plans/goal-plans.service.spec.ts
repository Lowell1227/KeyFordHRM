import { ForbiddenException } from "@nestjs/common";
import { SysRole, TaskStatus } from "@prisma/client";
import { AuthUser } from "@/common/types/auth.types";
import { GoalPlansService } from "./goal-plans.service";
import { GoalPlanQueryDto } from "./goal-plans.dto";

const actor = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: "reader",
  name: "Reader",
  sysRole: SysRole.employee,
  deptId: "reader-dept",
  isAssessorOnly: false,
  canViewAll: false,
  hrCapabilities: [],
  ...overrides,
});
const specialist = actor({
  sysRole: SysRole.hr_user,
  hrCapabilities: ["cycle_plan_edit", "performance_publish"],
});
const now = new Date("2026-10-29T12:00:00Z");
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1",
  cycleId: "cycle-1",
  employeeId: "employee",
  deptId: "other-dept",
  managerId: "manager",
  deptHeadId: "head",
  approverId: "leader",
  status: TaskStatus.indicator_drafting,
  isExempt: false,
  exemptReason: null,
  indicatorSetAt: null,
  indicatorConfirmedAt: null,
  goalApprovedAt: null,
  updatedAt: now,
  cycle: { name: "Cycle", goalWorkflowVersion: 2 },
  employee: { name: "Employee", employeeNo: "E1", position: "Operator" },
  dept: { name: "Other department" },
  manager: { name: "Manager" },
  deptHead: { name: "Head" },
  approver: { name: "Leader" },
  indicatorInstances: [
    {
      id: "indicator",
      name: "Saved draft",
      description: null,
      scoringStandard: "Agreed standard",
      dataSource: null,
      dataCaliber: null,
      targetValue: 10,
      targetValueText: null,
      unit: "items",
      weight: 1,
      indicatorType: "kpi",
      dimensionName: "Work",
      dimensionWeight: 1,
      sortOrder: 0,
      visibilityScope: "supervisors",
      visibilityRules: [],
      visibleDepartments: [],
      visibleUsers: [],
      objectiveAlignments: [],
      childAlignments: [],
      selfScore: 91,
      managerScore: 92,
      finalScore: 93,
      selfComment: "private self evaluation",
      actualNote: "private outcome",
    },
  ],
  flowRecords: [
    {
      id: "flow",
      nodeType: "indicator_setting",
      actorId: "employee",
      actor: { name: "Employee" },
      action: "comment",
      comment: "Saved draft",
      createdAt: now,
      extraData: {
        type: "indicator_draft_saved",
        count: 1,
        managerScore: 92,
        selfComment: "private self evaluation",
      },
    },
  ],
  gradeResult: { calibratedGrade: "A" },
  selfEvalSummary: { achievements: "private self evaluation" },
  ...overrides,
});

describe("GoalPlansService goal-only read scope", () => {
  let prisma: any;
  let service: GoalPlansService;
  beforeEach(() => {
    prisma = {
      assessmentTask: {
        findMany: jest.fn().mockResolvedValue([row()]),
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockResolvedValue(row()),
      },
    };
    service = new GoalPlansService(prisma);
  });

  it("lets the configured performance specialist read another department saved goal draft without result data", async () => {
    const plan = await service.findOne("task-1", specialist);
    expect(plan.employeeName).toBe("Employee");
    expect(plan.indicatorInstances[0].name).toBe("Saved draft");
    expect(plan.permissions).toEqual({
      canEdit: false,
      canApprove: false,
      canConfirm: false,
      canReject: false,
    });
    const serialized = JSON.stringify(plan);
    for (const privateKey of [
      "gradeResult",
      "calibratedGrade",
      "selfEvalSummary",
      "selfScore",
      "managerScore",
      "finalScore",
      "selfComment",
      "actualNote",
    ]) {
      expect(serialized).not.toContain(privateKey);
    }
    expect(serialized).not.toContain("private self evaluation");
    expect(plan.flowRecords[0].extraData).toEqual({
      type: "indicator_draft_saved",
      count: 1,
    });
  });

  it.each([
    actor({ sysRole: SysRole.hr_user, hrCapabilities: ["cycle_plan_edit"] }),
    actor({
      sysRole: SysRole.hr_user,
      hrCapabilities: ["performance_publish"],
    }),
    actor({ canViewAll: true }),
  ])(
    "does not turn a generic HR or full-reader flag into the specialist monitor scope",
    async (viewer) => {
      const query = Object.assign(new GoalPlanQueryDto(), { scope: "monitor" });
      await expect(service.findAll(query, viewer)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.assessmentTask.findMany).not.toHaveBeenCalled();
    },
  );

  it("blocks an unrelated employee from another saved goal draft", async () => {
    await expect(service.findOne("task-1", actor())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("shows the frozen leader the pending final goal decision without giving a same-role stranger actions", async () => {
    prisma.assessmentTask.findUnique.mockResolvedValue(
      row({
        status: TaskStatus.indicator_approving,
        indicatorConfirmedAt: now,
      }),
    );
    const plan = await service.findOne("task-1", actor({ id: "leader" }));
    expect(plan.currentStep).toBe("leader_review");
    expect(plan.currentHandlerId).toBe("leader");
    expect(plan.permissions).toEqual({
      canEdit: false,
      canApprove: true,
      canConfirm: false,
      canReject: true,
    });
    await expect(
      service.findOne("task-1", actor({ id: "another-leader" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("keeps the employee awaiting the leader after employee confirmation", async () => {
    prisma.assessmentTask.findUnique.mockResolvedValue(
      row({
        status: TaskStatus.indicator_approving,
        indicatorConfirmedAt: now,
      }),
    );
    const plan = await service.findOne("task-1", actor({ id: "employee" }));
    expect(plan.currentStep).toBe("leader_review");
    expect(plan.goalApprovedAt).toBeNull();
    expect(plan.permissions.canConfirm).toBe(false);
  });

  it("does not reveal the result-processing phase through the goal-only status", async () => {
    prisma.assessmentTask.findUnique.mockResolvedValue(
      row({
        status: TaskStatus.hr_calibration,
        indicatorConfirmedAt: now,
        goalApprovedAt: now,
      }),
    );
    const plan = await service.findOne("task-1", specialist);
    expect(plan.status).toBe(TaskStatus.goal_confirmed);
    expect(plan.currentStep).toBe("effective");
    expect(plan.currentHandlerId).toBeNull();
  });

  it("supports the leader review queue without requiring direct reports", async () => {
    prisma.assessmentTask.findMany.mockResolvedValue([
      row({ status: TaskStatus.indicator_approving }),
    ]);
    const query = Object.assign(new GoalPlanQueryDto(), { scope: "review" });
    const result = await service.findAll(query, actor({ id: "leader" }));
    expect(result.items[0].id).toBe("task-1");
    expect(result.total).toBe(1);
    const where = prisma.assessmentTask.findMany.mock.calls[0][0].where;
    expect(where.AND[0].OR).toContainEqual({
      status: TaskStatus.indicator_approving,
      approverId: "leader",
    });
  });
});
