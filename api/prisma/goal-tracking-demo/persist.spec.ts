import type { GoalTrackingDemoPlan } from "./plan";
import {
  assertGoalTrackingDemoOwnership,
  requireGoalTrackingDemoWriteGate,
} from "./persist";

const plan: GoalTrackingDemoPlan = {
  cycleName: "2026-Q3",
  tasks: [
    {
      employeeNo: "EMP001",
      sourceEmployeeNo: "FD300126",
      create: {
        id: "owned-task",
        cycleId: "cycle-q3",
        snapshotId: "snapshot",
        employeeId: "employee",
        deptId: "dept",
        managerId: "manager",
        deptHeadId: "head",
        approverId: "approver",
        status: "indicator_setting" as never,
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
      },
      indicators: [
        {
          sourceIndicatorId: "source-indicator",
          create: { id: "owned-indicator", taskId: "owned-task" } as never,
        },
      ],
    },
  ],
};

describe("goal tracking demo write safety", () => {
  it("requires an explicit write gate", () => {
    expect(() => requireGoalTrackingDemoWriteGate({})).toThrow(
      /ENABLE_GOAL_TRACKING_DEMO_SEED=true/,
    );
    expect(() =>
      requireGoalTrackingDemoWriteGate({
        ENABLE_GOAL_TRACKING_DEMO_SEED: "true",
      }),
    ).not.toThrow();
  });

  it("refuses to overwrite an existing task not owned by this overlay", () => {
    expect(() =>
      assertGoalTrackingDemoOwnership(plan, {
        tasks: [
          {
            id: "foreign-task",
            cycleId: "cycle-q3",
            employeeId: "employee",
          },
        ],
        indicators: [],
      }),
    ).toThrow(/EMP001.*foreign-task/);
  });

  it("accepts absent rows or rows with the deterministic owned IDs", () => {
    expect(() =>
      assertGoalTrackingDemoOwnership(plan, { tasks: [], indicators: [] }),
    ).not.toThrow();
    expect(() =>
      assertGoalTrackingDemoOwnership(plan, {
        tasks: [
          {
            id: "owned-task",
            cycleId: "cycle-q3",
            employeeId: "employee",
          },
        ],
        indicators: [{ id: "owned-indicator", taskId: "owned-task" }],
      }),
    ).not.toThrow();
  });
});
