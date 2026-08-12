import { PerfGrade, Prisma } from "@prisma/client";
import { generateCatalog } from "./catalog";
import { DEMO_CONFIG } from "./config";
import { createDemoContext } from "./context";
import { generatePeople } from "./people";
import {
  calculateIndicatorScore,
  generatePerformance,
  rawGrade,
} from "./performance";
import type { PerformanceBundle } from "./types";

function buildPerformanceFixture(): PerformanceBundle {
  const context = createDemoContext();
  const people = generatePeople(context);
  const catalog = generateCatalog(context, people);
  return generatePerformance(context, people, catalog);
}

function cycleId(bundle: PerformanceBundle, key: string): string {
  const cycle = bundle.cycles.find((row) => row.name === key);
  if (!cycle?.id) throw new Error(`missing cycle ${key}`);
  return cycle.id;
}

function tasksFor(bundle: PerformanceBundle, key: string) {
  const id = cycleId(bundle, key);
  return bundle.tasks.filter((task) => task.cycleId === id);
}

function exemptTasksFor(bundle: PerformanceBundle, key: string) {
  return tasksFor(bundle, key).filter((task) => task.isExempt);
}

function countGrades(bundle: PerformanceBundle, key: string) {
  const taskIds = new Set(tasksFor(bundle, key).map((task) => task.id));
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  for (const result of bundle.gradeResults) {
    if (taskIds.has(result.taskId)) counts[result.calibratedGrade!] += 1;
  }
  return counts;
}

function countStatuses(bundle: PerformanceBundle, key: string) {
  const counts: Record<string, number> = {};
  for (const task of tasksFor(bundle, key)) {
    const status = task.status!;
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function millis(value: string | Date | null | undefined): number {
  if (value == null) throw new Error("expected timestamp");
  return new Date(value).getTime();
}

function gradeFor(bundle: PerformanceBundle, taskId: string) {
  const grade = bundle.gradeResults.find((row) => row.taskId === taskId);
  if (!grade) throw new Error(`missing grade for ${taskId}`);
  return grade;
}

function recalculateTaskScore(
  taskId: string,
  indicators: PerformanceBundle["indicatorInstances"],
): number {
  return indicators
    .filter((indicator) => indicator.taskId === taskId)
    .reduce(
      (sum, indicator) =>
        sum + Number(indicator.finalScore) * Number(indicator.weight),
      0,
    );
}

function taskForStory(
  bundle: PerformanceBundle,
  story: string,
  cycleKey: string,
) {
  const employeeId = bundle.storyUserIds[story];
  const task = tasksFor(bundle, cycleKey).find(
    (candidate) => candidate.employeeId === employeeId,
  );
  if (!task) throw new Error(`missing ${story} task in ${cycleKey}`);
  return task;
}

function gradesForStory(bundle: PerformanceBundle, story: string) {
  return ["2026-Q1", "2026-Q2"].map((key) => {
    const task = taskForStory(bundle, story, key);
    return gradeFor(bundle, task.id!).calibratedGrade;
  });
}

describe("generatePerformance", () => {
  it("generates only the five approved timeline slices and exact quotas", () => {
    const bundle = buildPerformanceFixture();

    expect(
      bundle.cycles.map(({ name, type, status, startDate, endDate }) => ({
        name,
        type,
        status,
        start: new Date(startDate).toISOString().slice(0, 10),
        end: new Date(endDate).toISOString().slice(0, 10),
      })),
    ).toEqual([
      {
        name: "2025-LEGACY",
        type: "annual",
        status: "closed",
        start: "2025-01-01",
        end: "2025-12-31",
      },
      {
        name: "2026-Q1",
        type: "quarterly",
        status: "closed",
        start: "2026-01-01",
        end: "2026-03-31",
      },
      {
        name: "2026-Q2",
        type: "quarterly",
        status: "appeal",
        start: "2026-04-01",
        end: "2026-06-30",
      },
      {
        name: "2026-Q3",
        type: "quarterly",
        status: "self_eval",
        start: "2026-07-01",
        end: "2026-09-30",
      },
      {
        name: "2026-ANNUAL-LEADERS",
        type: "annual",
        status: "self_eval",
        start: "2026-01-01",
        end: "2026-12-31",
      },
    ]);
    expect(tasksFor(bundle, "2025-LEGACY")).toHaveLength(0);
    expect(
      bundle.archives.filter(
        (archive) => archive.cycleId === cycleId(bundle, "2025-LEGACY"),
      ),
    ).toHaveLength(120);
    expect(tasksFor(bundle, "2026-Q1")).toHaveLength(120);
    expect(exemptTasksFor(bundle, "2026-Q1")).toHaveLength(2);
    expect(
      exemptTasksFor(bundle, "2026-Q1")
        .map((task) => bundle.employeeNoByUserId.get(task.employeeId))
        .sort(),
    ).toEqual(["FD300118", "FD300119"]);
    expect(countGrades(bundle, "2026-Q1")).toEqual({
      A: 23,
      B: 47,
      C: 37,
      D: 11,
    });
    expect(tasksFor(bundle, "2026-Q2")).toHaveLength(124);
    expect(exemptTasksFor(bundle, "2026-Q2")).toHaveLength(1);
    expect(
      exemptTasksFor(bundle, "2026-Q2").map((task) =>
        bundle.employeeNoByUserId.get(task.employeeId),
      ),
    ).toEqual(["FD300123"]);
    expect(
      bundle.gradeResults.filter((grade) =>
        new Set(tasksFor(bundle, "2026-Q2").map((task) => task.id)).has(
          grade.taskId,
        ),
      ),
    ).toHaveLength(123);
    expect(countGrades(bundle, "2026-Q2")).toEqual({
      A: 24,
      B: 49,
      C: 38,
      D: 12,
    });
    expect(countStatuses(bundle, "2026-Q2")).toEqual({
      confirmed: 115,
      appealing: 2,
      published: 6,
      exempted: 1,
    });
    expect(tasksFor(bundle, "2026-Q3")).toHaveLength(128);
    expect(countStatuses(bundle, "2026-Q3")).toEqual({
      self_eval: 113,
      indicator_confirming: 9,
      indicator_setting: 6,
    });
    expect(tasksFor(bundle, "2026-ANNUAL-LEADERS")).toHaveLength(12);
    expect(countStatuses(bundle, "2026-ANNUAL-LEADERS")).toEqual({
      self_eval: 12,
    });
    const incompleteTaskIds = new Set(
      [
        ...tasksFor(bundle, "2026-Q3"),
        ...tasksFor(bundle, "2026-ANNUAL-LEADERS"),
      ].map((task) => task.id),
    );
    expect(
      bundle.gradeResults.filter((grade) =>
        incompleteTaskIds.has(grade.taskId),
      ),
    ).toHaveLength(0);
  });

  it("keeps completed scores, grades, flow timestamps, and snapshots coherent", () => {
    const bundle = buildPerformanceFixture();
    const complete = bundle.tasks.filter(
      (task) => !task.isExempt && task.publishedAt,
    );

    expect(complete).toHaveLength(241);
    for (const task of complete) {
      expect(
        recalculateTaskScore(task.id!, bundle.indicatorInstances),
      ).toBeCloseTo(Number(gradeFor(bundle, task.id!).calculatedScore), 2);
      expect(millis(task.indicatorSetAt)).toBeLessThanOrEqual(
        millis(task.indicatorConfirmedAt),
      );
      expect(millis(task.indicatorConfirmedAt)).toBeLessThanOrEqual(
        millis(task.selfEvalSubmittedAt),
      );
      expect(millis(task.selfEvalSubmittedAt)).toBeLessThanOrEqual(
        millis(task.managerScoredAt),
      );
      expect(millis(task.managerScoredAt)).toBeLessThanOrEqual(
        millis(task.deptReviewedAt),
      );
      expect(millis(task.deptReviewedAt)).toBeLessThanOrEqual(
        millis(task.hrCalibratedAt),
      );
      expect(millis(task.hrCalibratedAt)).toBeLessThanOrEqual(
        millis(task.approvedAt),
      );
      expect(millis(task.approvedAt)).toBeLessThanOrEqual(
        millis(task.publishedAt),
      );
      expect(millis(task.publishedAt)).toBeLessThanOrEqual(
        DEMO_CONFIG.asOf.getTime(),
      );
      expect(millis(task.createdAt)).toBeLessThanOrEqual(
        millis(task.updatedAt),
      );
      const grade = gradeFor(bundle, task.id!);
      expect(
        bundle.archives.find(
          (archive) =>
            archive.employeeId === task.employeeId &&
            archive.cycleId === task.cycleId,
        ),
      ).toMatchObject({
        grade: grade.calibratedGrade,
        totalScore: grade.calculatedScore,
      });
      const flowNodes = bundle.flowRecords
        .filter((flow) => flow.taskId === task.id)
        .map((flow) => flow.nodeType);
      expect(flowNodes).toEqual([
        "indicator_setting",
        "indicator_confirm",
        "self_eval",
        "manager_score",
        "dept_review",
        "hr_calibration",
        "approval",
        "publish",
        ...(task.employeeConfirmedAt ? ["employee_confirm" as const] : []),
      ]);
    }

    expect(bundle.snapshots).toHaveLength(
      new Set(bundle.tasks.map((task) => task.snapshotId)).size,
    );
    expect(
      bundle.snapshots.every(
        (snapshot) =>
          snapshot.cycleId !== cycleId(bundle, "2025-LEGACY") &&
          bundle.tasks.some((task) => task.snapshotId === snapshot.id),
      ),
    ).toBe(true);
    expect(
      bundle.flowRecords.every(
        (flow) =>
          bundle.tasks.some(
            (task) => task.id === flow.taskId && task.cycleId === flow.cycleId,
          ) && millis(flow.createdAt) <= DEMO_CONFIG.asOf.getTime(),
      ),
    ).toBe(true);
    expect(
      bundle.tasks
        .filter((task) => !task.publishedAt)
        .every(
          (task) =>
            task.managerScoredAt == null &&
            task.deptReviewedAt == null &&
            task.hrCalibratedAt == null &&
            task.approvedAt == null,
        ),
    ).toBe(true);
  });

  it("uses real indicator arithmetic and records meaningful calibration changes", () => {
    expect(calculateIndicatorScore(80, 88)).toBe(100);
    expect(calculateIndicatorScore(100, 72)).toBe(72);
    expect(calculateIndicatorScore(5, 4, false)).toBe(100);
    expect(calculateIndicatorScore(5, 10, false)).toBe(50);
    expect(rawGrade(90)).toBe(PerfGrade.A);
    expect(rawGrade(75)).toBe(PerfGrade.B);
    expect(rawGrade(60)).toBe(PerfGrade.C);
    expect(rawGrade(59.99)).toBe(PerfGrade.D);

    const bundle = buildPerformanceFixture();
    const coefficient = { A: 1.2, B: 1, C: 0.8, D: 0.6 };
    for (const grade of bundle.gradeResults) {
      expect(Number(grade.coefficient)).toBe(
        coefficient[grade.calibratedGrade!],
      );
      if (grade.rawGrade !== grade.calibratedGrade) {
        expect(grade.calibrationNote?.trim()).toBeTruthy();
      }
    }
  });

  it("builds narratives from each task's strongest and weakest indicators", () => {
    const bundle = buildPerformanceFixture();
    expect(bundle.selfEvaluations).toHaveLength(241);
    expect(bundle.managerEvaluations).toHaveLength(241);

    for (const selfEval of bundle.selfEvaluations) {
      const indicators = bundle.indicatorInstances
        .filter((row) => row.taskId === selfEval.taskId)
        .sort(
          (left, right) => Number(left.finalScore) - Number(right.finalScore),
        );
      const lowest = indicators[0];
      const highest = indicators[indicators.length - 1];
      expect(selfEval.achievements).toContain(highest.name);
      expect(selfEval.improvements).toContain(lowest.name);
      expect(selfEval.nextGoals?.trim()).toBeTruthy();
      expect(selfEval.supportNeeded?.trim()).toBeTruthy();

      const managerEval = bundle.managerEvaluations.find(
        (row) => row.taskId === selfEval.taskId,
      )!;
      expect(managerEval.strengths).toContain(highest.name);
      expect(managerEval.improvements).toContain(lowest.name);
      expect(managerEval.developmentPlan?.trim()).toBeTruthy();
    }
  });

  it("creates the approved objective tree and 56 current action items", () => {
    const bundle = buildPerformanceFixture();
    const byLevel = (level: "company" | "department" | "individual") =>
      bundle.objectives.filter((objective) => objective.level === level);

    expect(byLevel("company")).toHaveLength(1);
    expect(byLevel("department")).toHaveLength(9);
    expect(byLevel("individual")).toHaveLength(18);
    expect(bundle.actionItems).toHaveLength(56);
    const allowedCycleIds = new Set([
      cycleId(bundle, "2026-Q3"),
      cycleId(bundle, "2026-ANNUAL-LEADERS"),
    ]);
    expect(
      bundle.objectives.every(
        (objective) =>
          allowedCycleIds.has(objective.cycleId!) &&
          millis(objective.createdAt) <= DEMO_CONFIG.asOf.getTime(),
      ),
    ).toBe(true);
    expect(
      byLevel("department").every(
        (objective) => objective.parentId === byLevel("company")[0].id,
      ),
    ).toBe(true);
    const departmentObjectiveIds = new Set(
      byLevel("department").map((objective) => objective.id),
    );
    expect(
      byLevel("individual").every((objective) =>
        departmentObjectiveIds.has(objective.parentId!),
      ),
    ).toBe(true);
    const objectiveIds = new Set(
      bundle.objectives.map((objective) => objective.id),
    );
    expect(
      bundle.actionItems.every(
        (item) =>
          objectiveIds.has(item.objectiveId) &&
          millis(item.createdAt) <= DEMO_CONFIG.asOf.getTime() &&
          (!item.dueDate || millis(item.dueDate) >= millis(item.startDate)),
      ),
    ).toBe(true);
  });

  it("preserves every fixed story trajectory", () => {
    const bundle = buildPerformanceFixture();

    expect(gradesForStory(bundle, "excellentManager")).toEqual(["A", "A"]);
    expect(gradesForStory(bundle, "lowPerformer")).toEqual(["C", "D"]);
    expect(gradesForStory(bundle, "consecutiveLowPerformerA")).toEqual([
      "D",
      "D",
    ]);
    expect(gradesForStory(bundle, "consecutiveLowPerformerB")).toEqual([
      "D",
      "D",
    ]);
    expect(taskForStory(bundle, "lateEntryExempt", "2026-Q1").status).toBe(
      "exempted",
    );
    expect(
      taskForStory(bundle, "transferredEmployee", "2026-Q3").deptId,
    ).not.toBe(taskForStory(bundle, "transferredEmployee", "2026-Q2").deptId);
  });

  it("is deterministic without ambient dates or cross-run ownership drift", () => {
    const first = buildPerformanceFixture();
    const second = buildPerformanceFixture();

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(
      first.tasks.every(
        (task) =>
          millis(task.createdAt) <= DEMO_CONFIG.asOf.getTime() &&
          millis(task.updatedAt) <= DEMO_CONFIG.asOf.getTime(),
      ),
    ).toBe(true);
    expect(
      first.indicatorInstances.every(
        (instance) => millis(instance.createdAt) <= DEMO_CONFIG.asOf.getTime(),
      ),
    ).toBe(true);
    expect(
      first.gradeResults.every(
        (grade) => grade.calculatedScore instanceof Prisma.Decimal,
      ),
    ).toBe(true);
  });
});
