import type { Prisma, PrismaClient } from "@prisma/client";
import { ACCEPTANCE_PASSWORD_HASH } from "./people";
import {
  assertOwnedOrAbsent,
  inspectOwnedRows,
  type OwnedInspection,
} from "./ownership";
import type {
  DemoEntityKind,
  DemoManifest,
  DemoRowSets,
  RealisticDemoDataset,
} from "./types";
import { validateRealisticDemoDataset } from "./validate";

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface DatabaseDemoSummary extends OwnedInspection {
  relations: {
    taskEmployees: number;
    taskSnapshots: number;
    indicatorTasks: number;
    acceptanceAccounts: number;
  };
}

export interface CleanDemoSummary extends OwnedInspection {
  executed: boolean;
}

const ROW_DELEGATE: Record<keyof DemoRowSets, string> = {
  departments: "department",
  users: "user",
  indicators: "indicator",
  templates: "assessmentTemplate",
  dimensions: "templateDimension",
  templateIndicators: "templateIndicator",
  cycles: "assessmentCycle",
  snapshots: "assessmentTemplateSnapshot",
  tasks: "assessmentTask",
  indicatorInstances: "indicatorInstance",
  selfEvaluations: "selfEvalSummary",
  managerEvaluations: "managerEvalSummary",
  gradeResults: "gradeResult",
  flowRecords: "flowRecord",
  archives: "performanceArchive",
  objectives: "objective",
  actionItems: "actionItem",
  interviews: "performanceInterview",
  appeals: "appeal",
  improvementPlans: "improvementPlan",
  probationReviews: "probationReview",
  probationIndicators: "probationReviewIndicator",
  confirmations: "confirmationApplication",
  signatures: "signature",
  notifications: "notificationLog",
  auditLogs: "auditLog",
};

const INSERT_ORDER: Array<keyof DemoRowSets> = [
  "departments",
  "users",
  "indicators",
  "templates",
  "dimensions",
  "templateIndicators",
  // Objective.cycleId is a real FK, so owned cycles must exist first.
  // This order was explicitly approved after the integration RED proved
  // objectives-before-cycles cannot satisfy PostgreSQL.
  "cycles",
  "objectives",
  "actionItems",
  "snapshots",
  "tasks",
  "indicatorInstances",
  "selfEvaluations",
  "managerEvaluations",
  "gradeResults",
  "flowRecords",
  "archives",
  "interviews",
  "appeals",
  "improvementPlans",
  "probationReviews",
  "probationIndicators",
  "confirmations",
  "signatures",
  "notifications",
  "auditLogs",
];

async function insertBatches<T>(
  rows: T[],
  write: (batch: T[]) => Promise<unknown>,
  size = 500,
): Promise<void> {
  for (let index = 0; index < rows.length; index += size) {
    await write(rows.slice(index, index + size));
  }
}

function ids(manifest: DemoManifest, kind: DemoEntityKind): string[] {
  return manifest.ownedIds[kind];
}

async function removeOwnedRows(
  tx: Prisma.TransactionClient,
  manifest: DemoManifest,
): Promise<void> {
  const instanceIds = ids(manifest, "indicator-instance");
  const objectiveIds = ids(manifest, "objective");
  const userIds = ids(manifest, "user");

  await tx.indicatorObjectiveAlignment.deleteMany({
    where: {
      OR: [
        { indicatorInstanceId: { in: instanceIds } },
        { objectiveId: { in: objectiveIds } },
      ],
    },
  });
  await tx.indicatorVisibilityDepartment.deleteMany({
    where: { indicatorInstanceId: { in: instanceIds } },
  });
  await tx.indicatorVisibilityUser.deleteMany({
    where: { indicatorInstanceId: { in: instanceIds } },
  });
  await tx.signature.deleteMany({
    where: { id: { in: ids(manifest, "signature") } },
  });
  await tx.notificationLog.deleteMany({
    where: { id: { in: ids(manifest, "notification") } },
  });
  await tx.auditLog.deleteMany({
    where: { id: { in: ids(manifest, "audit-log") } },
  });
  await tx.appeal.deleteMany({
    where: { id: { in: ids(manifest, "appeal") } },
  });
  await tx.performanceInterview.deleteMany({
    where: { id: { in: ids(manifest, "interview") } },
  });
  await tx.improvementPlan.deleteMany({
    where: { id: { in: ids(manifest, "improvement-plan") } },
  });
  await tx.flowRecord.deleteMany({
    where: { id: { in: ids(manifest, "flow") } },
  });
  await tx.gradeResult.deleteMany({
    where: { id: { in: ids(manifest, "grade") } },
  });
  await tx.selfEvalSummary.deleteMany({
    where: { id: { in: ids(manifest, "self-eval") } },
  });
  await tx.managerEvalSummary.deleteMany({
    where: { id: { in: ids(manifest, "manager-eval") } },
  });
  await tx.indicatorInstance.deleteMany({ where: { id: { in: instanceIds } } });
  await tx.assessmentTask.deleteMany({
    where: { id: { in: ids(manifest, "task") } },
  });
  await tx.performanceArchive.deleteMany({
    where: { id: { in: ids(manifest, "archive") } },
  });
  await tx.assessmentTemplateSnapshot.deleteMany({
    where: { id: { in: ids(manifest, "snapshot") } },
  });
  await tx.assessmentCycle.deleteMany({
    where: { id: { in: ids(manifest, "cycle") } },
  });
  await tx.confirmationApplication.deleteMany({
    where: { id: { in: ids(manifest, "confirmation") } },
  });
  await tx.probationReviewIndicator.deleteMany({
    where: { id: { in: ids(manifest, "probation-indicator") } },
  });
  await tx.probationReview.deleteMany({
    where: { id: { in: ids(manifest, "probation-review") } },
  });
  await tx.actionItem.deleteMany({
    where: { id: { in: ids(manifest, "action-item") } },
  });
  await tx.objective.deleteMany({ where: { id: { in: objectiveIds } } });
  await tx.templateIndicator.deleteMany({
    where: { id: { in: ids(manifest, "template-indicator") } },
  });
  await tx.templateDimension.deleteMany({
    where: { id: { in: ids(manifest, "dimension") } },
  });
  await tx.assessmentTemplate.deleteMany({
    where: { id: { in: ids(manifest, "template") } },
  });
  await tx.indicator.deleteMany({
    where: { id: { in: ids(manifest, "indicator") } },
  });

  await tx.department.updateMany({
    where: { leaderId: { in: userIds } },
    data: { leaderId: null },
  });
  await tx.department.updateMany({
    where: { approverId: { in: userIds } },
    data: { approverId: null },
  });
  await tx.user.deleteMany({ where: { id: { in: userIds } } });
  await tx.department.deleteMany({
    where: { id: { in: ids(manifest, "department") } },
  });
}

function replacePasswordSentinels(
  dataset: RealisticDemoDataset,
  passwordHash: string,
): DemoRowSets {
  let replaced = 0;
  const users = dataset.rows.users.map((user) => {
    if (user.passwordHash !== ACCEPTANCE_PASSWORD_HASH) return user;
    replaced += 1;
    return { ...user, passwordHash };
  });
  if (replaced !== 8) {
    throw new Error(
      `expected 8 acceptance password sentinels, found ${replaced}`,
    );
  }
  return { ...dataset.rows, users };
}

async function insertDatasetRows(
  tx: Prisma.TransactionClient,
  rows: DemoRowSets,
): Promise<void> {
  for (const rowSet of INSERT_ORDER) {
    const values = rows[rowSet] as unknown[];
    const delegate = (tx as any)[ROW_DELEGATE[rowSet]];
    await insertBatches(values, (batch) =>
      delegate.createMany({ data: batch }),
    );
  }
}

async function applyDepartmentLeadership(
  tx: Prisma.TransactionClient,
  leadership: RealisticDemoDataset["departmentLeadership"],
): Promise<void> {
  for (const department of leadership) {
    await tx.department.update({
      where: { id: department.id },
      data: {
        leaderId: department.leaderId,
        approverId: department.approverId,
      },
    });
  }
}

export async function verifyRealisticDemoData(
  prisma: DbClient,
  manifest: DemoManifest,
): Promise<DatabaseDemoSummary> {
  const inspection = await assertOwnedOrAbsent(prisma, manifest);
  for (const kind of Object.keys(manifest.ownedIds) as DemoEntityKind[]) {
    const expected = manifest.ownedIds[kind].length;
    if (inspection.counts[kind] !== expected) {
      throw new Error(
        `realistic demo count mismatch kind=${kind} actual=${inspection.counts[kind]} expected=${expected}`,
      );
    }
  }

  const taskIds = ids(manifest, "task");
  const instanceIds = ids(manifest, "indicator-instance");
  const acceptanceNos = Object.values(manifest.acceptanceEmployeeNos);
  const [taskEmployees, taskSnapshots, indicatorTasks, acceptanceAccounts] =
    await Promise.all([
      (prisma as any).assessmentTask.count({
        where: {
          id: { in: taskIds },
          employeeId: { in: ids(manifest, "user") },
        },
      }),
      (prisma as any).assessmentTask.count({
        where: {
          id: { in: taskIds },
          snapshotId: { in: ids(manifest, "snapshot") },
        },
      }),
      (prisma as any).indicatorInstance.count({
        where: { id: { in: instanceIds }, taskId: { in: taskIds } },
      }),
      (prisma as any).user.count({
        where: {
          id: { in: ids(manifest, "user") },
          employeeNo: { in: acceptanceNos },
          passwordHash: { not: null },
        },
      }),
    ]);
  if (
    taskEmployees !== taskIds.length ||
    taskSnapshots !== taskIds.length ||
    indicatorTasks !== instanceIds.length ||
    acceptanceAccounts !== acceptanceNos.length
  ) {
    throw new Error("realistic demo relation verification failed");
  }
  return {
    ...inspection,
    relations: {
      taskEmployees,
      taskSnapshots,
      indicatorTasks,
      acceptanceAccounts,
    },
  };
}

export async function persistRealisticDemoDataset(
  prisma: PrismaClient,
  dataset: RealisticDemoDataset,
  passwordHash: string,
): Promise<DatabaseDemoSummary> {
  validateRealisticDemoDataset(dataset);
  await assertOwnedOrAbsent(prisma, dataset.manifest);
  const rows = replacePasswordSentinels(dataset, passwordHash);
  return prisma.$transaction(
    async (tx) => {
      await removeOwnedRows(tx, dataset.manifest);
      await insertDatasetRows(tx, rows);
      await applyDepartmentLeadership(tx, dataset.departmentLeadership);
      return verifyRealisticDemoData(tx, dataset.manifest);
    },
    { timeout: 120_000 },
  );
}

export async function cleanRealisticDemoData(
  prisma: PrismaClient,
  manifest: DemoManifest,
  options: { execute: boolean },
): Promise<CleanDemoSummary> {
  const inspection = await inspectOwnedRows(prisma, manifest);
  if (!options.execute) return { ...inspection, executed: false };
  await prisma.$transaction(
    async (tx) => {
      await removeOwnedRows(tx, manifest);
    },
    { timeout: 120_000 },
  );
  return { ...inspection, executed: true };
}
