import { Prisma } from "@prisma/client";
import { generateRealisticDemoDataset } from "./generate";
import { summarizeRealisticDemoDataset } from "./report";
import {
  RealisticDemoValidationError,
  validateRealisticDemoDataset,
} from "./validate";

describe("realistic demo dataset orchestration", () => {
  it("assembles one deterministic, cloneable dataset with the approved totals", () => {
    const first = generateRealisticDemoDataset();
    const second = generateRealisticDemoDataset();

    expect(() => structuredClone(first)).not.toThrow();
    expect(first).toEqual(second);
    expect(() => validateRealisticDemoDataset(first)).not.toThrow();
    expect(summarizeRealisticDemoDataset(first)).toEqual({
      source: "realistic-demo-v1",
      asOf: "2026-08-10T16:00:00.000Z",
      currentPeople: 128,
      resignedPeople: 4,
      systemAdmins: 1,
      departments: 1,
      indicators: 52,
      templates: 14,
      cycles: 5,
      q1Tasks: 120,
      q1Exempt: 2,
      q1Graded: 118,
      q2Tasks: 124,
      q2Exempt: 1,
      q2Graded: 123,
      q3Tasks: 128,
      annualLeaderTasks: 12,
      archives: 361,
      appeals: 7,
      improvementPlans: 23,
      probationReviews: 11,
      notifications: 48,
    });
  });

  it("rejects an indicator mutation that breaks a task weight total", () => {
    const invalid = structuredClone(generateRealisticDemoDataset());
    invalid.rows.indicatorInstances[0].weight = 0.91;

    expect(() => validateRealisticDemoDataset(invalid)).toThrow(
      /path=2026-Q1\/.*\/task=.* rule=weight total/,
    );
  });

  it("rejects a completion timestamp after the observation instant", () => {
    const invalid = structuredClone(generateRealisticDemoDataset());
    invalid.rows.tasks.find((task) => task.status === "closed")!.publishedAt =
      new Date("2026-09-01T00:00:00+08:00");

    expect(() => validateRealisticDemoDataset(invalid)).toThrow(
      /publishedAt after asOf/,
    );
  });

  it("requires exactly one improvement plan for every final D grade", () => {
    const invalid = structuredClone(generateRealisticDemoDataset());
    invalid.rows.improvementPlans.pop();

    expect(() => validateRealisticDemoDataset(invalid)).toThrow(
      /D grade improvement plan/,
    );
  });

  it("rejects broken foreign keys with a path-specific validation error", () => {
    const invalid = structuredClone(generateRealisticDemoDataset());
    invalid.rows.appeals[0].taskId = "00000000-0000-0000-0000-000000000000";

    expect(() => validateRealisticDemoDataset(invalid)).toThrow(
      /path=.*\/appeal rule=task foreign key/,
    );
  });

  it("rejects duplicate IDs and duplicate employee numbers", () => {
    const duplicateId = structuredClone(generateRealisticDemoDataset());
    duplicateId.rows.notifications[1].id = duplicateId.rows.notifications[0].id;
    expect(() => validateRealisticDemoDataset(duplicateId)).toThrow(
      /rule=unique id/,
    );

    const duplicateEmployeeNo = structuredClone(generateRealisticDemoDataset());
    duplicateEmployeeNo.rows.users[1].employeeNo =
      duplicateEmployeeNo.rows.users[0].employeeNo;
    expect(() => validateRealisticDemoDataset(duplicateEmployeeNo)).toThrow(
      /rule=unique employee number/,
    );
  });

  it("rejects row properties that are not createMany fields in the Prisma DMMF", () => {
    const invalid = structuredClone(generateRealisticDemoDataset());
    Object.assign(invalid.rows.tasks[0], { accidentalRelationObject: {} });

    expect(() => validateRealisticDemoDataset(invalid)).toThrow(
      /rule=Prisma createMany fields.*accidentalRelationObject/,
    );
  });

  it("keeps normalized Decimal values cloneable and Prisma-compatible", () => {
    const dataset = generateRealisticDemoDataset();
    const values = [
      dataset.rows.gradeResults[0].calculatedScore,
      dataset.rows.indicatorInstances[0].weight,
      dataset.rows.cycles[0].gradeAMaxRatio,
    ];
    expect(values.every((value) => typeof value === "string")).toBe(true);
    expect(
      values.every(
        (value) =>
          new Prisma.Decimal(String(value)).toString() === String(value),
      ),
    ).toBe(true);

    const invalid = structuredClone(dataset);
    invalid.rows.gradeResults[0].calculatedScore = {
      value: "90",
    } as never;
    expect(() => validateRealisticDemoDataset(invalid)).toThrow(
      /rule=Prisma scalar type.*Decimal/,
    );
  });

  it("rejects credential-shaped keys nested in JSON fields", () => {
    const invalid = structuredClone(generateRealisticDemoDataset());
    invalid.rows.notifications[0].extraData = {
      source: "realistic-demo-v1",
      accessToken: "must-not-be-seeded",
    };

    expect(() => validateRealisticDemoDataset(invalid)).toThrow(
      /rule=sensitive JSON fields.*accessToken/,
    );
  });

  it("rejects cross-bundle state and ownership inconsistencies", () => {
    const dataset = generateRealisticDemoDataset();

    const wrongSnapshot = structuredClone(dataset);
    const q1Cycle = wrongSnapshot.rows.cycles.find(
      (cycle) => cycle.name === "2026-Q1",
    )!;
    const q2Snapshot = wrongSnapshot.rows.snapshots.find(
      (snapshot) => snapshot.cycleId !== q1Cycle.id,
    )!;
    wrongSnapshot.rows.tasks.find(
      (task) => task.cycleId === q1Cycle.id,
    )!.snapshotId = q2Snapshot.id!;
    expect(() => validateRealisticDemoDataset(wrongSnapshot)).toThrow(
      /rule=snapshot cycle consistency/,
    );

    const wrongQ2Status = structuredClone(dataset);
    const q2CycleId = wrongQ2Status.rows.cycles.find(
      (cycle) => cycle.name === "2026-Q2",
    )!.id;
    wrongQ2Status.rows.tasks.find(
      (task) => task.cycleId === q2CycleId && task.status === "confirmed",
    )!.status = "closed";
    expect(() => validateRealisticDemoDataset(wrongQ2Status)).toThrow(
      /rule=Q2 status quota/,
    );

    const wrongObjectiveLevel = structuredClone(dataset);
    wrongObjectiveLevel.rows.objectives.find(
      (objective) => objective.level === "company",
    )!.level = "individual";
    expect(() => validateRealisticDemoDataset(wrongObjectiveLevel)).toThrow(
      /rule=objective level quota/,
    );

    const wrongNotificationState = structuredClone(dataset);
    wrongNotificationState.rows.notifications.find(
      (notification) => notification.status === "sent",
    )!.sentAt = null;
    expect(() => validateRealisticDemoDataset(wrongNotificationState)).toThrow(
      /rule=notification delivery state/,
    );

    const unfinishedClosedReview = structuredClone(dataset);
    unfinishedClosedReview.rows.probationReviews.find(
      (review) => review.status === "closed",
    )!.completedAt = null;
    expect(() => validateRealisticDemoDataset(unfinishedClosedReview)).toThrow(
      /rule=closed probation completion/,
    );

    const nonLeaderAnnualTask = structuredClone(dataset);
    const annualCycleId = nonLeaderAnnualTask.rows.cycles.find(
      (cycle) => cycle.name === "2026-ANNUAL-LEADERS",
    )!.id;
    const managedIds = new Set(
      nonLeaderAnnualTask.rows.users
        .map((user) => user.directManagerId)
        .filter((id): id is string => Boolean(id)),
    );
    const nonManager = nonLeaderAnnualTask.rows.users.find(
      (user) =>
        user.status !== "resigned" &&
        user.sysRole !== "system_admin" &&
        !managedIds.has(user.id!),
    )!;
    nonLeaderAnnualTask.rows.tasks.find(
      (task) => task.cycleId === annualCycleId,
    )!.employeeId = nonManager.id!;
    expect(() => validateRealisticDemoDataset(nonLeaderAnnualTask)).toThrow(
      /rule=annual leader eligibility/,
    );
  });

  it("uses the required validation error contract", () => {
    const invalid = structuredClone(generateRealisticDemoDataset());
    invalid.rows.users[0].email = "person@example.com";

    try {
      validateRealisticDemoDataset(invalid);
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(RealisticDemoValidationError);
      expect((error as Error).message).toMatch(
        /^path=[^ ]+ rule=[^ ](?:.*) actual=.* expected=.*$/,
      );
    }
  });
});
