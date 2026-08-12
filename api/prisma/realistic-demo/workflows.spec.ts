import { Prisma } from "@prisma/client";
import { generateCatalog } from "./catalog";
import { DEMO_CONFIG } from "./config";
import { createDemoContext } from "./context";
import { generatePeople } from "./people";
import { generatePerformance } from "./performance";
import type { PerformanceBundle, WorkflowBundle } from "./types";
import { generateWorkflows } from "./workflows";

function buildWorkflowFixture(): {
  performance: PerformanceBundle;
  workflows: WorkflowBundle;
  users: ReturnType<typeof generatePeople>["users"];
} {
  const context = createDemoContext();
  const people = generatePeople(context);
  const catalog = generateCatalog(context, people);
  const performance = generatePerformance(context, people, catalog);
  const workflows = generateWorkflows(context, people, performance);
  return { performance, workflows, users: people.users };
}

function countBy<T>(rows: T[], key: keyof T): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = String(row[key]);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function cycleId(performance: PerformanceBundle, name: string): string {
  const cycle = performance.cycles.find((row) => row.name === name);
  if (!cycle?.id) throw new Error(`missing cycle ${name}`);
  return cycle.id;
}

function millis(value: string | Date | null | undefined): number {
  if (value == null) throw new Error("expected timestamp");
  return new Date(value).getTime();
}

describe("generateWorkflows", () => {
  it("generates the exact approved workflow populations", () => {
    const { workflows } = buildWorkflowFixture();

    expect(countBy(workflows.q1Interviews, "status")).toEqual({ closed: 118 });
    expect(countBy(workflows.q2Interviews, "status")).toEqual({
      closed: 107,
      filled: 13,
      pending: 3,
    });
    expect(countBy(workflows.q1Appeals, "finalResult")).toEqual({
      maintained: 2,
      modified: 1,
    });
    expect(countBy(workflows.q2Appeals, "status")).toEqual({
      resolved: 2,
      dept_processing: 1,
      hr_processing: 1,
    });
    expect(countBy(workflows.q1ImprovementPlans, "status")).toEqual({
      completed: 7,
      in_progress: 4,
    });
    expect(countBy(workflows.q2ImprovementPlans, "status")).toEqual({
      draft: 2,
      in_progress: 10,
    });
    expect(workflows.probationReviews).toHaveLength(11);
    expect(workflows.probationIndicators).toHaveLength(44);
    expect(workflows.confirmations).toHaveLength(7);
    expect(workflows.notifications).toHaveLength(48);
    expect(workflows.auditLogs).toHaveLength(14);
  });

  it("uses only interview states and signatures reachable through the real service", () => {
    const { workflows, performance } = buildWorkflowFixture();
    const signaturesByInterview = new Map(
      workflows.interviews.map((row) => [
        row.id!,
        workflows.signatures.filter(
          (signature) =>
            signature.businessType === "interview" &&
            signature.businessRecordId === row.id,
        ),
      ]),
    );

    for (const interview of workflows.interviews) {
      expect(interview.status).not.toBe("employee_signed");
      const signatures = signaturesByInterview.get(interview.id!)!;
      const roles = signatures.map((row) => row.role).sort();
      if (interview.status === "closed") {
        expect(interview.managerSignedAt).not.toBeNull();
        expect(interview.employeeSignedAt).not.toBeNull();
        expect(roles).toEqual(["assessee", "assessor"]);
      } else if (interview.status === "filled") {
        expect(interview.employeeSignedAt).toBeNull();
        expect(roles).not.toContain("assessee");
      } else {
        expect(interview.managerSignedAt).toBeNull();
        expect(interview.employeeSignedAt).toBeNull();
        expect(roles).toEqual([]);
      }
      const task = performance.tasks.find(
        (row) => row.id === interview.taskId,
      )!;
      expect(task).toBeDefined();
      expect(interview).toMatchObject({
        cycleId: task.cycleId,
        employeeId: task.employeeId,
        interviewerId: task.managerId,
      });
      expect(millis(interview.createdAt)).toBeLessThanOrEqual(
        DEMO_CONFIG.asOf.getTime(),
      );
      expect(millis(interview.updatedAt)).toBeLessThanOrEqual(
        DEMO_CONFIG.asOf.getTime(),
      );
    }
  });

  it("keeps appeals, final grades, archives, task states, and appeal flows coherent", () => {
    const { workflows, performance } = buildWorkflowFixture();
    const q1 = cycleId(performance, "2026-Q1");
    const q2 = cycleId(performance, "2026-Q2");

    expect(
      performance.gradeResults
        .filter((grade) =>
          performance.tasks.some(
            (task) => task.id === grade.taskId && task.cycleId === q1,
          ),
        )
        .reduce(
          (counts, row) => ({
            ...counts,
            [row.calibratedGrade!]: counts[row.calibratedGrade!] + 1,
          }),
          { A: 0, B: 0, C: 0, D: 0 },
        ),
    ).toEqual({ A: 23, B: 47, C: 37, D: 11 });
    expect(
      performance.gradeResults
        .filter((grade) =>
          performance.tasks.some(
            (task) => task.id === grade.taskId && task.cycleId === q2,
          ),
        )
        .reduce(
          (counts, row) => ({
            ...counts,
            [row.calibratedGrade!]: counts[row.calibratedGrade!] + 1,
          }),
          { A: 0, B: 0, C: 0, D: 0 },
        ),
    ).toEqual({ A: 24, B: 49, C: 38, D: 12 });

    for (const appeal of workflows.appeals) {
      const task = performance.tasks.find((row) => row.id === appeal.taskId)!;
      const cycle = performance.cycles.find(
        (row) => row.id === appeal.cycleId,
      )!;
      expect(task).toMatchObject({
        employeeId: appeal.appellantId,
        cycleId: appeal.cycleId,
      });
      expect(millis(appeal.createdAt)).toBeLessThanOrEqual(
        millis(cycle.deadlineAppeal),
      );
      expect(millis(appeal.updatedAt)).toBeLessThanOrEqual(
        DEMO_CONFIG.asOf.getTime(),
      );
      expect(
        performance.flowRecords.some(
          (flow) => flow.taskId === appeal.taskId && flow.nodeType === "appeal",
        ),
      ).toBe(true);
      if (appeal.status === "resolved") {
        expect(appeal.finalResult).not.toBeNull();
        expect(appeal.hrResolvedAt).not.toBeNull();
        expect(task.status === "confirmed" || task.status === "closed").toBe(
          true,
        );
      } else {
        expect(appeal.finalResult).toBeNull();
        expect(task.status).toBe("appealing");
        expect(appeal.attachments).toEqual([
          {
            name: "复核说明（演示）",
            source: DEMO_CONFIG.source,
            stateOrigin: "historical_migration",
          },
        ]);
      }
      if (appeal.finalResult === "modified") {
        const grade = performance.gradeResults.find(
          (row) => row.taskId === task.id,
        )!;
        const archive = performance.archives.find(
          (row) =>
            row.employeeId === task.employeeId && row.cycleId === task.cycleId,
        )!;
        const audit = workflows.auditLogs.find(
          (row) => row.entityId === appeal.id,
        )!;
        const prior = audit.oldValue as { calibratedGrade: string };
        const changed = audit.newValue as { calibratedGrade: string };
        expect(prior.calibratedGrade).not.toBe(changed.calibratedGrade);
        expect(grade.calibratedGrade).toBe(changed.calibratedGrade);
        expect(archive.grade).toBe(changed.calibratedGrade);
        expect(Number(archive.coefficient)).toBe(Number(grade.coefficient));
      }
    }
  });

  it("creates one service-compatible improvement plan for every final D", () => {
    const { workflows, performance } = buildWorkflowFixture();
    const finalDTaskIds = performance.gradeResults
      .filter((grade) => grade.calibratedGrade === "D")
      .map((grade) => grade.taskId)
      .sort();

    expect(workflows.improvementPlans.map((row) => row.taskId).sort()).toEqual(
      finalDTaskIds,
    );
    for (const plan of workflows.improvementPlans) {
      const task = performance.tasks.find((row) => row.id === plan.taskId)!;
      const indicators = performance.indicatorInstances
        .filter((row) => row.taskId === task.id)
        .sort(
          (left, right) => Number(left.finalScore) - Number(right.finalScore),
        );
      expect(plan).toMatchObject({
        employeeId: task.employeeId,
        cycleId: task.cycleId,
      });
      if (plan.status === "draft") {
        expect(plan.improvementNeed).toBeNull();
        expect(plan.finalScore).toBeNull();
      } else {
        expect(plan.improvementNeed).toContain(indicators[0].name);
        expect(plan.improvementGoal?.trim()).toBeTruthy();
        expect(Array.isArray(plan.measures)).toBe(true);
      }
      if (plan.status === "completed") {
        expect(plan.finalScore).not.toBeNull();
      } else {
        expect(plan.finalScore).toBeNull();
      }
    }

    for (const story of [
      "consecutiveLowPerformerA",
      "consecutiveLowPerformerB",
    ]) {
      expect(
        workflows.improvementPlans.filter(
          (row) => row.employeeId === performance.storyUserIds[story],
        ),
      ).toHaveLength(2);
    }
  });

  it("models current and historical probation outcomes through real state contracts", () => {
    const { workflows, users } = buildWorkflowFixture();
    expect(countBy(workflows.probationReviews, "status")).toEqual({
      indicator_setting: 2,
      self_eval: 1,
      manager_scoring: 1,
      closed: 7,
    });

    for (const review of workflows.probationReviews) {
      const indicators = workflows.probationIndicators.filter(
        (row) => row.probationReviewId === review.id,
      );
      expect(indicators).toHaveLength(4);
      expect(
        indicators
          .filter((row) => row.type === "work_objective")
          .reduce((sum, row) => sum + Number(row.weight), 0),
      ).toBeCloseTo(0.8, 6);
      expect(
        indicators
          .filter((row) => row.type === "values")
          .reduce((sum, row) => sum + Number(row.weight), 0),
      ).toBeCloseTo(0.2, 6);
      const employee = users.find((row) => row.id === review.employeeId)!;
      expect(millis(review.createdAt)).toBeGreaterThanOrEqual(
        millis(employee.entryDate),
      );
      if (review.status === "closed") {
        expect(review.completedAt).not.toBeNull();
        expect(review.employeeSignedAt).not.toBeNull();
        expect(review.managerSignedAt).not.toBeNull();
        expect(review.hrSignedAt).not.toBeNull();
        expect(
          workflows.signatures
            .filter(
              (row) =>
                row.businessType === "probation_task" &&
                row.businessRecordId === review.id,
            )
            .map((row) => row.role)
            .sort(),
        ).toEqual(["assessee", "assessor", "hr"]);
      } else {
        expect(review.completedAt).toBeNull();
      }
      expect(employee).toBeDefined();
    }

    expect(countBy(workflows.confirmations, "voteResult")).toEqual({
      extend: 3,
      pass: 3,
      fail: 1,
    });
    for (const confirmation of workflows.confirmations) {
      const user = users.find((row) => row.id === confirmation.employeeId)!;
      const review = workflows.probationReviews.find(
        (row) => row.id === confirmation.probationReviewId,
      )!;
      expect(review.status).toBe("closed");
      expect(millis(confirmation.createdAt)).toBeGreaterThanOrEqual(
        millis(review.createdAt),
      );
      expect(millis(confirmation.managerApprovedAt)).toBeLessThanOrEqual(
        millis(confirmation.hrApprovedAt),
      );
      expect(millis(confirmation.hrApprovedAt)).toBeLessThanOrEqual(
        millis(confirmation.companyApprovedAt ?? confirmation.rejectedAt),
      );
      if (confirmation.voteResult === "pass") {
        expect(confirmation.status).toBe("approved");
        expect(confirmation.actualRegularDate).not.toBeNull();
        expect(user.status).toBe("active");
      } else if (confirmation.voteResult === "extend") {
        expect(confirmation.status).toBe("rejected");
        expect(confirmation.actualRegularDate).toBeNull();
        expect(confirmation.rejectReason).toContain("延期");
        expect(user.status).toBe("probation");
      } else {
        expect(confirmation.status).toBe("rejected");
        expect(confirmation.actualRegularDate).toBeNull();
        expect(user.status).toBe("resigned");
      }
    }
  });

  it("creates safe acceptance notifications and workflow audit evidence deterministically", () => {
    const first = buildWorkflowFixture();
    const second = buildWorkflowFixture();
    expect(JSON.stringify(first.workflows)).toBe(
      JSON.stringify(second.workflows),
    );

    const acceptanceNumbers = new Set<string>(
      Object.values(DEMO_CONFIG.acceptanceEmployeeNos),
    );
    const acceptanceIds = first.users
      .filter((row) => acceptanceNumbers.has(row.employeeNo!))
      .map((row) => row.id!);
    expect(acceptanceIds).toHaveLength(8);
    for (const userId of acceptanceIds) {
      const rows = first.workflows.notifications.filter(
        (row) => row.userId === userId,
      );
      expect(rows).toHaveLength(6);
      expect(rows.filter((row) => !row.isRead && row.taskId)).toHaveLength(2);
      expect(
        rows.filter((row) => row.isRead && row.type === "workflow"),
      ).toHaveLength(2);
      expect(
        rows.filter((row) => row.isRead && row.type === "info"),
      ).toHaveLength(1);
      expect(
        rows.filter(
          (row) =>
            row.status === "failed" &&
            row.channel === "dingtalk" &&
            row.errorMsg === "DingTalk delivery unavailable (demo)",
        ),
      ).toHaveLength(1);
    }

    expect(countBy(first.workflows.auditLogs, "entityType")).toEqual({
      appeal: 7,
      confirmation_application: 7,
    });
    const secretPattern =
      /password|passwordHash|authorization|bearer|token|cookie|secret/i;
    for (const row of first.workflows.auditLogs) {
      expect(row.ipAddress).toBe("127.0.0.1");
      expect(row.userAgent).toBe("realistic-demo-seed");
      expect(secretPattern.test(JSON.stringify(row.oldValue ?? {}))).toBe(
        false,
      );
      expect(secretPattern.test(JSON.stringify(row.newValue ?? {}))).toBe(
        false,
      );
      expect(millis(row.createdAt)).toBeLessThanOrEqual(
        DEMO_CONFIG.asOf.getTime(),
      );
    }
    expect(
      first.workflows.notifications.every(
        (row) =>
          millis(row.createdAt) <= DEMO_CONFIG.asOf.getTime() &&
          (row.readAt == null ||
            millis(row.readAt) <= DEMO_CONFIG.asOf.getTime()) &&
          (row.sentAt == null ||
            millis(row.sentAt) <= DEMO_CONFIG.asOf.getTime()),
      ),
    ).toBe(true);
    expect(
      first.workflows.notifications.every(
        (row) =>
          row.extraData == null ||
          !secretPattern.test(JSON.stringify(row.extraData)),
      ),
    ).toBe(true);
    expect(
      first.workflows.probationIndicators.every(
        (row) => row.weight instanceof Prisma.Decimal,
      ),
    ).toBe(true);
  });

  it("never fabricates a completed workflow event after the observation instant", () => {
    const { workflows } = buildWorkflowFixture();
    const eventValues: Array<string | Date | null | undefined> = [];
    for (const row of workflows.interviews) {
      eventValues.push(
        row.interviewTime,
        row.managerSignedAt,
        row.employeeSignedAt,
        row.createdAt,
        row.updatedAt,
      );
    }
    for (const row of workflows.appeals) {
      eventValues.push(
        row.deptResolvedAt,
        row.hrResolvedAt,
        row.createdAt,
        row.updatedAt,
      );
    }
    for (const row of workflows.improvementPlans) {
      eventValues.push(row.createdAt, row.updatedAt);
    }
    for (const row of workflows.probationReviews) {
      eventValues.push(
        row.employeeSignedAt,
        row.managerSignedAt,
        row.hrSignedAt,
        row.completedAt,
        row.createdAt,
        row.updatedAt,
      );
    }
    for (const row of workflows.probationIndicators) {
      eventValues.push(row.createdAt, row.updatedAt);
    }
    for (const row of workflows.confirmations) {
      eventValues.push(
        row.voteMeetingTime,
        row.managerApprovedAt,
        row.hrApprovedAt,
        row.companyApprovedAt,
        row.rejectedAt,
        row.actualRegularDate,
        row.createdAt,
        row.updatedAt,
      );
    }
    for (const row of workflows.signatures) {
      eventValues.push(row.signedAt, row.createdAt);
    }
    for (const row of workflows.notifications) {
      eventValues.push(row.sentAt, row.readAt, row.createdAt);
    }
    for (const row of workflows.auditLogs) eventValues.push(row.createdAt);

    expect(
      eventValues
        .filter((value): value is string | Date => value != null)
        .filter((value) => millis(value) > DEMO_CONFIG.asOf.getTime()),
    ).toEqual([]);
  });
});
