import type { RealisticDemoDataset, RealisticDemoSummary } from "./types";

export function summarizeRealisticDemoDataset(
  dataset: RealisticDemoDataset,
): RealisticDemoSummary {
  const cycleIds = new Map(
    dataset.rows.cycles.map((cycle) => [cycle.name, cycle.id!]),
  );
  const tasksFor = (cycleName: string) =>
    dataset.rows.tasks.filter(
      (task) => task.cycleId === cycleIds.get(cycleName),
    );
  const q1 = tasksFor("2026-Q1");
  const q2 = tasksFor("2026-Q2");
  const currentPeople = dataset.rows.users.filter(
    (user) => user.status !== "resigned" && user.sysRole !== "system_admin",
  );

  return {
    source: dataset.manifest.source,
    asOf: dataset.manifest.asOf.toISOString(),
    currentPeople: currentPeople.length,
    resignedPeople: dataset.rows.users.filter(
      (user) => user.status === "resigned",
    ).length,
    systemAdmins: dataset.rows.users.filter(
      (user) => user.sysRole === "system_admin",
    ).length,
    departments: dataset.rows.departments.length,
    indicators: dataset.rows.indicators.length,
    templates: dataset.rows.templates.length,
    cycles: dataset.rows.cycles.length,
    q1Tasks: q1.length,
    q1Exempt: q1.filter((task) => task.isExempt).length,
    q1Graded: q1.filter((task) =>
      dataset.rows.gradeResults.some((grade) => grade.taskId === task.id),
    ).length,
    q2Tasks: q2.length,
    q2Exempt: q2.filter((task) => task.isExempt).length,
    q2Graded: q2.filter((task) =>
      dataset.rows.gradeResults.some((grade) => grade.taskId === task.id),
    ).length,
    q3Tasks: tasksFor("2026-Q3").length,
    annualLeaderTasks: tasksFor("2026-ANNUAL-LEADERS").length,
    archives: dataset.rows.archives.length,
    appeals: dataset.rows.appeals.length,
    improvementPlans: dataset.rows.improvementPlans.length,
    probationReviews: dataset.rows.probationReviews.length,
    notifications: dataset.rows.notifications.length,
  };
}
