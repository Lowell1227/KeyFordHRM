import { Prisma } from "@prisma/client";
import { runInNewContext } from "node:vm";
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
    const mutatedQ2Task = wrongQ2Status.rows.tasks.find(
      (task) => task.cycleId === q2CycleId && task.status === "confirmed",
    )!;
    mutatedQ2Task.status = "closed";
    mutatedQ2Task.closedAt = mutatedQ2Task.updatedAt;
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

  it("rejects required nulls and non-JSON values at the Prisma boundary", () => {
    const nullName = generateRealisticDemoDataset();
    nullName.rows.indicators[0].name = null as never;
    expect(() => validateRealisticDemoDataset(nullName)).toThrow(
      /rule=Prisma required field null.*name/,
    );

    const nullSnapshot = generateRealisticDemoDataset();
    nullSnapshot.rows.snapshots[0].snapshotData = null as never;
    expect(() => validateRealisticDemoDataset(nullSnapshot)).toThrow(
      /rule=Prisma required field null.*snapshotData/,
    );

    const invalidJson = generateRealisticDemoDataset();
    invalidJson.rows.notifications[0].extraData = {
      generatedAt: new Date("2026-08-01T00:00:00.000Z"),
    } as never;
    expect(() => validateRealisticDemoDataset(invalidJson)).toThrow(
      /rule=Prisma InputJsonValue.*generatedAt/,
    );

    invalidJson.rows.notifications[0].extraData = { count: 1n } as never;
    expect(() => validateRealisticDemoDataset(invalidJson)).toThrow(
      /rule=Prisma InputJsonValue.*count/,
    );

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    invalidJson.rows.notifications[0].extraData = cyclic as never;
    expect(() => validateRealisticDemoDataset(invalidJson)).toThrow(
      /rule=Prisma InputJsonValue.*cycle/,
    );

    invalidJson.rows.notifications[0].extraData = Prisma.DbNull;
    expect(() => validateRealisticDemoDataset(invalidJson)).not.toThrow();
  });

  it("enforces top-level Prisma Json null semantics without rejecting legal nullable values", () => {
    const dataset = generateRealisticDemoDataset();
    const notification = dataset.rows.notifications[0];
    const originalExtraData = notification.extraData;

    notification.extraData = null as never;
    expect(() => validateRealisticDemoDataset(dataset)).toThrow(
      /rule=Prisma InputJsonValue.*extraData/,
    );

    notification.extraData = originalExtraData;
    notification.content = null;
    expect(() => validateRealisticDemoDataset(dataset)).not.toThrow();

    notification.extraData = Prisma.DbNull;
    expect(() => validateRealisticDemoDataset(dataset)).not.toThrow();
    notification.extraData = Prisma.JsonNull;
    expect(() => validateRealisticDemoDataset(dataset)).not.toThrow();
    notification.extraData = { nested: null };
    expect(() => validateRealisticDemoDataset(dataset)).not.toThrow();
    notification.extraData = runInNewContext("({ nested: null })") as never;
    expect(() => validateRealisticDemoDataset(dataset)).not.toThrow();

    const snapshot = dataset.rows.snapshots[0];
    snapshot.snapshotData = Prisma.JsonNull;
    expect(() => validateRealisticDemoDataset(dataset)).not.toThrow();
    snapshot.snapshotData = Prisma.DbNull as never;
    expect(() => validateRealisticDemoDataset(dataset)).toThrow(
      /rule=Prisma InputJsonValue.*snapshotData/,
    );
    snapshot.snapshotData = Prisma.AnyNull as never;
    expect(() => validateRealisticDemoDataset(dataset)).toThrow(
      /rule=Prisma InputJsonValue.*snapshotData/,
    );
  });

  it("requires the exact unique approved leadership departments", () => {
    const duplicate = generateRealisticDemoDataset();
    duplicate.departmentLeadership[1].id = duplicate.departmentLeadership[0].id;
    expect(() => validateRealisticDemoDataset(duplicate)).toThrow(
      /rule=department leadership IDs/,
    );

    const unknown = generateRealisticDemoDataset();
    unknown.departmentLeadership[0].id = "00000000-0000-0000-0000-000000009999";
    expect(() => validateRealisticDemoDataset(unknown)).toThrow(
      /rule=department leadership IDs/,
    );
  });

  it("requires state timestamps, published grades, and ordered flow evidence", () => {
    const missingPublishedAt = generateRealisticDemoDataset();
    missingPublishedAt.rows.tasks.find(
      (task) => task.status === "closed",
    )!.publishedAt = null;
    expect(() => validateRealisticDemoDataset(missingPublishedAt)).toThrow(
      /rule=task status timestamps.*publishedAt/,
    );

    const unpublishedGrade = generateRealisticDemoDataset();
    const publishedTask = unpublishedGrade.rows.tasks.find(
      (task) => task.status === "published",
    )!;
    unpublishedGrade.rows.gradeResults.find(
      (grade) => grade.taskId === publishedTask.id,
    )!.isPublished = false;
    expect(() => validateRealisticDemoDataset(unpublishedGrade)).toThrow(
      /rule=published grade evidence/,
    );

    const wrongFlow = generateRealisticDemoDataset();
    const closed = wrongFlow.rows.tasks.find(
      (task) => task.status === "closed",
    )!;
    wrongFlow.rows.flowRecords.find(
      (flow) => flow.taskId === closed.id,
    )!.action = "approve";
    expect(() => validateRealisticDemoDataset(wrongFlow)).toThrow(
      /rule=ordered flow evidence/,
    );
  });

  it("requires appeal terminal evidence and exactly one business audit", () => {
    const missingResult = generateRealisticDemoDataset();
    missingResult.rows.appeals.find(
      (appeal) =>
        appeal.status === "resolved" &&
        !Object.values(missingResult.manifest.storyUserIds).includes(
          appeal.appellantId,
        ),
    )!.finalResult = null;
    expect(() => validateRealisticDemoDataset(missingResult)).toThrow(
      /rule=appeal state evidence/,
    );

    const duplicateAudit = generateRealisticDemoDataset();
    duplicateAudit.rows.auditLogs[8].entityId =
      duplicateAudit.rows.auditLogs[7].entityId;
    expect(() => validateRealisticDemoDataset(duplicateAudit)).toThrow(
      /rule=confirmation audit cardinality/,
    );
  });

  it("binds workflow actors and notification cycles to their subjects", () => {
    const wrongSigner = generateRealisticDemoDataset();
    const closedInterview = wrongSigner.rows.interviews.find(
      (interview) => interview.status === "closed",
    )!;
    wrongSigner.rows.signatures.find(
      (signature) =>
        signature.businessRecordId === closedInterview.id &&
        signature.role === "assessee",
    )!.signerId = closedInterview.interviewerId;
    expect(() => validateRealisticDemoDataset(wrongSigner)).toThrow(
      /rule=interview signature subject/,
    );

    const wrongConfirmation = generateRealisticDemoDataset();
    const confirmation = wrongConfirmation.rows.confirmations[0];
    const review = wrongConfirmation.rows.probationReviews.find(
      (row) => row.id === confirmation.probationReviewId,
    )!;
    confirmation.managerId = review.hrId;
    expect(() => validateRealisticDemoDataset(wrongConfirmation)).toThrow(
      /rule=confirmation review subjects/,
    );

    const wrongNotificationCycle = generateRealisticDemoDataset();
    const linkedNotification = wrongNotificationCycle.rows.notifications.find(
      (notification) => notification.taskId,
    )!;
    const linkedTask = wrongNotificationCycle.rows.tasks.find(
      (task) => task.id === linkedNotification.taskId,
    )!;
    linkedNotification.cycleId = wrongNotificationCycle.rows.cycles.find(
      (cycle) => cycle.id !== linkedTask.cycleId,
    )!.id;
    expect(() => validateRealisticDemoDataset(wrongNotificationCycle)).toThrow(
      /rule=notification task cycle/,
    );
  });

  it("requires every approved story manifest binding and its business evidence", () => {
    const invalid = generateRealisticDemoDataset();
    invalid.manifest.storyUserIds.lateEntryExempt =
      invalid.manifest.storyUserIds.stableContributor;
    expect(() => validateRealisticDemoDataset(invalid)).toThrow(
      /rule=story manifest binding.*lateEntryExempt/,
    );
  });
});
