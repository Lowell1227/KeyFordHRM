import { Prisma, type PrismaClient } from "@prisma/client";
import { DEMO_CONFIG } from "./config";
import { generateRealisticDemoDataset } from "./generate";
import type {
  DemoEntityKind,
  DemoManifest,
  DemoRowSets,
  RealisticDemoDataset,
} from "./types";

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface OwnedInspection {
  counts: Record<DemoEntityKind, number>;
  total: number;
}

const ENTITY: Record<
  DemoEntityKind,
  { delegate: string; rowSet: keyof DemoRowSets; ownershipFields: string[] }
> = {
  department: {
    delegate: "department",
    rowSet: "departments",
    ownershipFields: ["name", "parentId"],
  },
  user: {
    delegate: "user",
    rowSet: "users",
    ownershipFields: ["employeeNo", "email"],
  },
  indicator: {
    delegate: "indicator",
    rowSet: "indicators",
    ownershipFields: ["code", "description"],
  },
  template: {
    delegate: "assessmentTemplate",
    rowSet: "templates",
    ownershipFields: ["name", "description", "createdBy"],
  },
  dimension: {
    delegate: "templateDimension",
    rowSet: "dimensions",
    ownershipFields: ["templateId", "name", "type", "sortOrder"],
  },
  "template-indicator": {
    delegate: "templateIndicator",
    rowSet: "templateIndicators",
    ownershipFields: [
      "dimensionId",
      "indicatorId",
      "name",
      "description",
      "sortOrder",
    ],
  },
  cycle: {
    delegate: "assessmentCycle",
    rowSet: "cycles",
    ownershipFields: ["name", "type", "startDate", "endDate", "createdBy"],
  },
  snapshot: {
    delegate: "assessmentTemplateSnapshot",
    rowSet: "snapshots",
    ownershipFields: ["cycleId", "templateId", "snapshotData"],
  },
  task: {
    delegate: "assessmentTask",
    rowSet: "tasks",
    ownershipFields: [
      "cycleId",
      "snapshotId",
      "employeeId",
      "deptId",
      "managerId",
      "deptHeadId",
      "approverId",
    ],
  },
  "indicator-instance": {
    delegate: "indicatorInstance",
    rowSet: "indicatorInstances",
    ownershipFields: [
      "taskId",
      "templateIndicatorId",
      "name",
      "description",
      "sortOrder",
    ],
  },
  "self-eval": {
    delegate: "selfEvalSummary",
    rowSet: "selfEvaluations",
    ownershipFields: ["taskId"],
  },
  "manager-eval": {
    delegate: "managerEvalSummary",
    rowSet: "managerEvaluations",
    ownershipFields: ["taskId"],
  },
  grade: {
    delegate: "gradeResult",
    rowSet: "gradeResults",
    ownershipFields: [
      "taskId",
      "vetoOperatorId",
      "hrCalibratorId",
      "approverId",
    ],
  },
  flow: {
    delegate: "flowRecord",
    rowSet: "flowRecords",
    ownershipFields: ["taskId", "cycleId", "actorId", "extraData"],
  },
  archive: {
    delegate: "performanceArchive",
    rowSet: "archives",
    ownershipFields: ["employeeId", "cycleId", "summary"],
  },
  objective: {
    delegate: "objective",
    rowSet: "objectives",
    ownershipFields: [
      "title",
      "level",
      "deptId",
      "ownerId",
      "parentId",
      "cycleId",
      "relatedIndicatorId",
      "createdBy",
    ],
  },
  "action-item": {
    delegate: "actionItem",
    rowSet: "actionItems",
    ownershipFields: [
      "objectiveId",
      "title",
      "assigneeId",
      "parentId",
      "createdBy",
    ],
  },
  interview: {
    delegate: "performanceInterview",
    rowSet: "interviews",
    ownershipFields: ["taskId", "cycleId", "employeeId", "interviewerId"],
  },
  appeal: {
    delegate: "appeal",
    rowSet: "appeals",
    ownershipFields: [
      "taskId",
      "cycleId",
      "appellantId",
      "deptResolverId",
      "hrResolverId",
    ],
  },
  "improvement-plan": {
    delegate: "improvementPlan",
    rowSet: "improvementPlans",
    ownershipFields: ["taskId", "cycleId", "employeeId", "creatorId"],
  },
  "probation-review": {
    delegate: "probationReview",
    rowSet: "probationReviews",
    ownershipFields: ["employeeId", "managerId", "hrId", "createdBy"],
  },
  "probation-indicator": {
    delegate: "probationReviewIndicator",
    rowSet: "probationIndicators",
    ownershipFields: ["probationReviewId", "name", "type", "sortOrder"],
  },
  confirmation: {
    delegate: "confirmationApplication",
    rowSet: "confirmations",
    ownershipFields: [
      "employeeId",
      "probationReviewId",
      "managerId",
      "hrId",
      "companyApproverId",
      "rejectedById",
      "createdBy",
    ],
  },
  signature: {
    delegate: "signature",
    rowSet: "signatures",
    ownershipFields: [
      "businessType",
      "businessRecordId",
      "role",
      "signerId",
      "idempotencyKey",
    ],
  },
  notification: {
    delegate: "notificationLog",
    rowSet: "notifications",
    ownershipFields: ["userId", "senderId", "taskId", "cycleId", "extraData"],
  },
  "audit-log": {
    delegate: "auditLog",
    rowSet: "auditLogs",
    ownershipFields: ["userId", "action", "entityType", "entityId", "newValue"],
  },
};

let expectedDatasetCache: RealisticDemoDataset | undefined;

function assertRecordMatches(
  path: string,
  actual: Record<string, string | number>,
  expected: Record<string, string | number>,
): void {
  const keys = [
    ...new Set([...Object.keys(actual), ...Object.keys(expected)]),
  ].sort();
  for (const key of keys) {
    if (
      !Object.prototype.hasOwnProperty.call(actual, key) ||
      !Object.prototype.hasOwnProperty.call(expected, key) ||
      actual[key] !== expected[key]
    ) {
      throw new Error(`realistic demo manifest mismatch field=${path}.${key}`);
    }
  }
}

function expectedDataset(manifest: DemoManifest): RealisticDemoDataset {
  expectedDatasetCache ??= generateRealisticDemoDataset();
  const expected = expectedDatasetCache;
  if (
    manifest.source !== expected.manifest.source ||
    manifest.asOf.getTime() !== expected.manifest.asOf.getTime()
  ) {
    throw new Error(
      "realistic demo manifest does not match the deterministic dataset",
    );
  }
  for (const kind of Object.keys(ENTITY) as DemoEntityKind[]) {
    if (
      JSON.stringify(manifest.ownedIds[kind]) !==
      JSON.stringify(expected.manifest.ownedIds[kind])
    ) {
      throw new Error(`realistic demo manifest ID mismatch kind=${kind}`);
    }
  }
  assertRecordMatches(
    "acceptanceEmployeeNos",
    manifest.acceptanceEmployeeNos,
    expected.manifest.acceptanceEmployeeNos,
  );
  assertRecordMatches(
    "storyUserIds",
    manifest.storyUserIds,
    expected.manifest.storyUserIds,
  );
  assertRecordMatches(
    "expectedCounts",
    manifest.expectedCounts,
    expected.manifest.expectedCounts,
  );
  return expected;
}

function normalized(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalized(item)]),
    );
  }
  return value;
}

function fieldMatches(actual: unknown, expected: unknown): boolean {
  if (expected === undefined && actual === null) return true;
  if (Prisma.Decimal.isDecimal(actual)) {
    try {
      return actual.equals(
        new Prisma.Decimal(expected as Prisma.Decimal.Value),
      );
    } catch {
      return false;
    }
  }
  return (
    JSON.stringify(normalized(actual)) === JSON.stringify(normalized(expected))
  );
}

function expectedById(
  dataset: RealisticDemoDataset,
  kind: DemoEntityKind,
): Map<string, Record<string, unknown>> {
  return new Map(
    (dataset.rows[ENTITY[kind].rowSet] as Array<Record<string, unknown>>).map(
      (row) => [String(row.id), row],
    ),
  );
}

async function inspect(
  prisma: DbClient,
  manifest: DemoManifest,
  mode: "ownership" | "verify",
): Promise<OwnedInspection> {
  const dataset = expectedDataset(manifest);
  const counts = {} as Record<DemoEntityKind, number>;
  let total = 0;
  for (const kind of Object.keys(ENTITY) as DemoEntityKind[]) {
    const definition = ENTITY[kind];
    const expectedRows = expectedById(dataset, kind);
    const rows = manifest.ownedIds[kind].length
      ? ((await (prisma as any)[definition.delegate].findMany({
          where: { id: { in: manifest.ownedIds[kind] } },
        })) as Array<Record<string, unknown>>)
      : [];
    for (const row of rows) {
      const expected = expectedRows.get(String(row.id));
      if (!expected)
        throw new Error(
          `realistic demo collision kind=${kind} id=${String(row.id)}`,
        );
      const fields = definition.ownershipFields;
      for (const field of fields) {
        if (!fieldMatches(row[field], expected[field])) {
          throw new Error(
            `realistic demo ${mode === "ownership" ? "collision" : "mismatch"} kind=${kind} id=${String(row.id)} field=${field}`,
          );
        }
      }
    }
    counts[kind] = rows.length;
    total += rows.length;
  }
  return { counts, total };
}

async function assertBaseDepartments(
  prisma: DbClient,
  verifyLeadership: boolean,
): Promise<void> {
  expectedDatasetCache ??= generateRealisticDemoDataset();
  const dataset = expectedDatasetCache;
  const leadership = new Map(
    dataset.departmentLeadership.map((row) => [row.id, row]),
  );
  const ids = [
    ...DEMO_CONFIG.baseDepartments.map(({ id }) => id),
    ...dataset.manifest.ownedIds.department,
  ];
  const rows = (await (prisma as any).department.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, leaderId: true, approverId: true },
  })) as Array<{
    id: string;
    name: string;
    leaderId: string | null;
    approverId: string | null;
  }>;
  const actual = new Map(rows.map((row) => [row.id, row]));
  for (const expected of DEMO_CONFIG.baseDepartments) {
    if (actual.get(expected.id)?.name !== expected.expectedName) {
      throw new Error(
        `realistic demo base department mismatch id=${expected.id}`,
      );
    }
  }
  if (verifyLeadership) {
    for (const expected of leadership.values()) {
      const row = actual.get(expected.id);
      if (
        row?.leaderId !== expected.leaderId ||
        row?.approverId !== expected.approverId
      ) {
        throw new Error(`realistic demo leadership mismatch id=${expected.id}`);
      }
    }
  }
}

export async function inspectOwnedRows(
  prisma: DbClient,
  manifest: DemoManifest,
): Promise<OwnedInspection> {
  return inspect(prisma, manifest, "ownership");
}

export async function assertOwnedOrAbsent(
  prisma: DbClient,
  manifest: DemoManifest,
): Promise<OwnedInspection> {
  expectedDataset(manifest);
  await assertBaseDepartments(prisma, false);
  return inspect(prisma, manifest, "ownership");
}

export async function verifyOwnedRows(
  prisma: DbClient,
  manifest: DemoManifest,
): Promise<OwnedInspection> {
  expectedDataset(manifest);
  await assertBaseDepartments(prisma, true);
  return inspect(prisma, manifest, "verify");
}
