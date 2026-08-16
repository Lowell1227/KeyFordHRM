import {
  IndicatorType,
  IndicatorVisibilityScope,
  Prisma,
  TaskStatus,
} from "@prisma/client";
import { buildGoalTrackingDemoPlan } from "./plan";

const cycle = { id: "cycle-q3", name: "2026-Q3" };

const users = [
  {
    id: "manager",
    employeeNo: "MGR001",
    deptId: "dept-beijing",
    directManagerId: null,
  },
  {
    id: "employee",
    employeeNo: "EMP001",
    deptId: "dept-beijing",
    directManagerId: "manager",
  },
];

function sourceTask(employeeNo: "FD300125" | "FD300126", roleName: string) {
  const leader = employeeNo === "FD300125";
  return {
    id: `source-task-${employeeNo}`,
    cycleId: cycle.id,
    snapshotId: `snapshot-${employeeNo}`,
    deptId: "dept-beijing",
    managerId: leader ? "regional-manager" : "department-leader",
    deptHeadId: "department-leader",
    approverId: "regional-manager",
    status: TaskStatus.indicator_setting,
    isExempt: false,
    exemptReason: null,
    indicatorSetAt: new Date("2026-07-08T00:00:00.000Z"),
    indicatorConfirmedAt: null,
    selfEvalSubmittedAt: null,
    managerScoredAt: null,
    deptReviewedAt: null,
    hrCalibratedAt: null,
    approvedAt: null,
    publishedAt: null,
    employeeConfirmedAt: null,
    closedAt: null,
    employee: { employeeNo },
    indicatorInstances: [
      {
        id: `source-indicator-${employeeNo}`,
        templateIndicatorId: `template-indicator-${employeeNo}`,
        name: roleName,
        description: "realistic-demo-v1；来自真实业务岗位指标",
        scoringStandard: "达到目标 90 分，超过目标 100 分",
        dataSource: "ERP 业务台账",
        dataCaliber: "按考核周期内已确认数据统计",
        targetValue: new Prisma.Decimal(95),
        targetValueText: "达成率不低于 95%",
        unit: "%",
        weight: new Prisma.Decimal("0.8"),
        indicatorType: IndicatorType.kpi,
        dimensionName: "工作目标",
        dimensionWeight: new Prisma.Decimal("0.8"),
        visibilityScope: IndicatorVisibilityScope.supervisors,
        actualValue: null,
        actualNote: null,
        selfScore: null,
        selfComment: null,
        managerScore: null,
        managerComment: null,
        extraScores: [],
        finalScore: null,
        sortOrder: 1,
      },
    ],
  };
}

describe("goal tracking formal-cycle demo plan", () => {
  it("clones role-matched real Q3 indicators for the two quick-login accounts", () => {
    const plan = buildGoalTrackingDemoPlan({
      cycle,
      users,
      sourceTasks: [
        sourceTask("FD300125", "人才培养与流程优化"),
        sourceTask("FD300126", "库存清理"),
      ],
    });

    expect(plan.tasks).toHaveLength(2);
    expect(
      plan.tasks.map((task) => ({
        employeeNo: task.employeeNo,
        sourceEmployeeNo: task.sourceEmployeeNo,
        managerId: task.create.managerId,
        indicatorNames: task.indicators.map(
          (indicator) => indicator.create.name,
        ),
        visibility: task.indicators.map(
          (indicator) => indicator.create.visibilityScope,
        ),
      })),
    ).toEqual([
      {
        employeeNo: "MGR001",
        sourceEmployeeNo: "FD300125",
        managerId: null,
        indicatorNames: ["人才培养与流程优化"],
        visibility: [IndicatorVisibilityScope.direct_reports],
      },
      {
        employeeNo: "EMP001",
        sourceEmployeeNo: "FD300126",
        managerId: "manager",
        indicatorNames: ["库存清理"],
        visibility: [IndicatorVisibilityScope.supervisors],
      },
    ]);

    expect(plan.tasks[1].indicators[0].create).toEqual(
      expect.objectContaining({
        description: "realistic-demo-v1；来自真实业务岗位指标",
        scoringStandard: "达到目标 90 分，超过目标 100 分",
        dataSource: "ERP 业务台账",
        dataCaliber: "按考核周期内已确认数据统计",
        targetValueText: "达成率不低于 95%",
        unit: "%",
        weight: new Prisma.Decimal("0.8"),
      }),
    );
  });

  it("rejects a source task from another department", () => {
    const mismatched = sourceTask("FD300126", "库存清理");
    mismatched.deptId = "dept-shanghai";

    expect(() =>
      buildGoalTrackingDemoPlan({
        cycle,
        users,
        sourceTasks: [sourceTask("FD300125", "负责人指标"), mismatched],
      }),
    ).toThrow(/same department/);
  });
});
