import type { Prisma, PrismaClient } from "@prisma/client";
import type { DemoEntityKind, DemoManifest } from "./types";
import { DEMO_CONFIG } from "./config";

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface OwnedInspection {
  counts: Record<DemoEntityKind, number>;
  total: number;
}

const DELEGATE: Record<DemoEntityKind, string> = {
  department: "department",
  user: "user",
  indicator: "indicator",
  template: "assessmentTemplate",
  dimension: "templateDimension",
  "template-indicator": "templateIndicator",
  cycle: "assessmentCycle",
  snapshot: "assessmentTemplateSnapshot",
  task: "assessmentTask",
  "indicator-instance": "indicatorInstance",
  "self-eval": "selfEvalSummary",
  "manager-eval": "managerEvalSummary",
  grade: "gradeResult",
  flow: "flowRecord",
  archive: "performanceArchive",
  objective: "objective",
  "action-item": "actionItem",
  interview: "performanceInterview",
  appeal: "appeal",
  "improvement-plan": "improvementPlan",
  "probation-review": "probationReview",
  "probation-indicator": "probationReviewIndicator",
  confirmation: "confirmationApplication",
  signature: "signature",
  notification: "notificationLog",
  "audit-log": "auditLog",
};

const OBJECTIVE_TITLES = new Set([
  "提升年度经营质量与组织交付能力",
  ...Array.from(
    { length: 9 },
    (_, index) => `部门目标${index + 1}：提升关键业务交付质量`,
  ),
  "褚浩然个人关键成果目标",
  "赵安然个人关键成果目标",
  "卫德明个人关键成果目标",
  "吴芳菲个人关键成果目标",
  "郑冠宇个人关键成果目标",
  "韩冠宇个人关键成果目标",
  "吴浩然个人关键成果目标",
  "沈浩然个人关键成果目标",
  "杨浩然个人关键成果目标",
  "钱安然个人关键成果目标",
  "王安然个人关键成果目标",
  "韩安然个人关键成果目标",
  "孙安然个人关键成果目标",
  "李安然个人关键成果目标",
  "周安然个人关键成果目标",
  "吴安然个人关键成果目标",
  "郑安然个人关键成果目标",
  "冯安然个人关键成果目标",
]);

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasSource(value: unknown, source: string): boolean {
  const object = asObject(value);
  return object?.source === source || object?.datasetSource === source;
}

function evidenceMatches(
  kind: DemoEntityKind,
  row: Record<string, unknown>,
  manifest: DemoManifest,
): boolean {
  const owned = manifest.ownedIds;
  const isOwned = (entity: DemoEntityKind, value: unknown) =>
    typeof value === "string" && owned[entity].includes(value);
  const isOwnedOrNull = (entity: DemoEntityKind, value: unknown) =>
    value === null || value === undefined || isOwned(entity, value);
  const isBaseOrOwnedDepartment = (value: unknown) =>
    typeof value === "string" &&
    (owned.department.includes(value) ||
      DEMO_CONFIG.baseDepartments.some(({ id }) => id === value));
  switch (kind) {
    case "department":
      return row.name === "总经办";
    case "user":
      return (
        typeof row.employeeNo === "string" &&
        /^FD\d{6}$/.test(row.employeeNo) &&
        typeof row.email === "string" &&
        row.email.endsWith("@example.invalid")
      );
    case "indicator":
      return (
        typeof row.code === "string" &&
        row.code.startsWith("RDMO_") &&
        typeof row.description === "string" &&
        row.description.includes(manifest.source)
      );
    case "template":
      return (
        typeof row.description === "string" &&
        row.description.includes(manifest.source)
      );
    case "dimension":
      return isOwned("template", row.templateId);
    case "template-indicator":
      return (
        isOwned("dimension", row.dimensionId) &&
        typeof row.description === "string" &&
        row.description.includes(manifest.source)
      );
    case "cycle":
      return (
        [
          "2025-LEGACY",
          "2026-Q1",
          "2026-Q2",
          "2026-Q3",
          "2026-ANNUAL-LEADERS",
        ].includes(String(row.name)) && isOwned("user", row.createdBy)
      );
    case "snapshot":
      return (
        isOwned("cycle", row.cycleId) &&
        isOwned("template", row.templateId) &&
        asObject(row.snapshotData)
          ?.description?.toString()
          .includes(manifest.source) === true
      );
    case "task":
      return (
        isOwned("cycle", row.cycleId) &&
        isOwned("snapshot", row.snapshotId) &&
        isOwned("user", row.employeeId) &&
        (row.deptId === null || isBaseOrOwnedDepartment(row.deptId)) &&
        isOwnedOrNull("user", row.managerId) &&
        isOwnedOrNull("user", row.deptHeadId) &&
        isOwnedOrNull("user", row.approverId)
      );
    case "indicator-instance":
      return (
        isOwned("task", row.taskId) &&
        isOwnedOrNull("template-indicator", row.templateIndicatorId) &&
        typeof row.description === "string" &&
        row.description.includes(manifest.source)
      );
    case "self-eval":
    case "manager-eval":
      return isOwned("task", row.taskId);
    case "grade":
      return (
        isOwned("task", row.taskId) &&
        isOwnedOrNull("user", row.vetoOperatorId) &&
        isOwnedOrNull("user", row.hrCalibratorId) &&
        isOwnedOrNull("user", row.approverId)
      );
    case "flow":
      return (
        isOwned("task", row.taskId) &&
        isOwned("cycle", row.cycleId) &&
        isOwnedOrNull("user", row.actorId) &&
        hasSource(row.extraData, manifest.source)
      );
    case "archive":
      return (
        isOwned("user", row.employeeId) &&
        isOwned("cycle", row.cycleId) &&
        hasSource(row.summary, manifest.source)
      );
    case "objective":
      return (
        typeof row.title === "string" &&
        OBJECTIVE_TITLES.has(row.title) &&
        isOwned("user", row.createdBy) &&
        isOwned("cycle", row.cycleId)
      );
    case "action-item":
      return (
        isOwned("objective", row.objectiveId) &&
        isOwnedOrNull("action-item", row.parentId) &&
        isOwnedOrNull("user", row.assigneeId) &&
        isOwned("user", row.createdBy)
      );
    case "interview":
      return (
        isOwned("task", row.taskId) &&
        isOwned("cycle", row.cycleId) &&
        isOwned("user", row.employeeId) &&
        isOwned("user", row.interviewerId)
      );
    case "appeal":
      return (
        isOwned("task", row.taskId) &&
        isOwned("cycle", row.cycleId) &&
        isOwned("user", row.appellantId) &&
        isOwnedOrNull("user", row.deptResolverId) &&
        isOwnedOrNull("user", row.hrResolverId)
      );
    case "improvement-plan":
      return (
        isOwned("task", row.taskId) &&
        isOwned("cycle", row.cycleId) &&
        isOwned("user", row.employeeId) &&
        isOwnedOrNull("user", row.creatorId)
      );
    case "probation-review":
      return (
        isOwned("user", row.employeeId) &&
        isOwned("user", row.managerId) &&
        isOwned("user", row.hrId) &&
        isOwnedOrNull("user", row.createdBy)
      );
    case "probation-indicator":
      return isOwned("probation-review", row.probationReviewId);
    case "confirmation":
      return (
        isOwned("user", row.employeeId) &&
        isOwned("probation-review", row.probationReviewId) &&
        isOwned("user", row.managerId) &&
        isOwned("user", row.hrId) &&
        isOwned("user", row.companyApproverId) &&
        isOwnedOrNull("user", row.rejectedById) &&
        isOwnedOrNull("user", row.createdBy)
      );
    case "signature":
      return (
        isOwned("user", row.signerId) &&
        (isOwned("interview", row.businessRecordId) ||
          isOwned("probation-review", row.businessRecordId))
      );
    case "notification":
      return (
        isOwned("user", row.userId) &&
        isOwnedOrNull("user", row.senderId) &&
        isOwnedOrNull("task", row.taskId) &&
        isOwnedOrNull("cycle", row.cycleId) &&
        hasSource(row.extraData, manifest.source)
      );
    case "audit-log":
      return (
        isOwnedOrNull("user", row.userId) &&
        ((row.entityType === "appeal" && isOwned("appeal", row.entityId)) ||
          (row.entityType === "confirmation_application" &&
            isOwned("confirmation", row.entityId))) &&
        hasSource(row.newValue, manifest.source)
      );
  }
}

export async function inspectOwnedRows(
  prisma: DbClient,
  manifest: DemoManifest,
): Promise<OwnedInspection> {
  const counts = {} as Record<DemoEntityKind, number>;
  let total = 0;
  for (const kind of Object.keys(DELEGATE) as DemoEntityKind[]) {
    const ids = manifest.ownedIds[kind];
    const delegate = (prisma as any)[DELEGATE[kind]];
    const rows = ids.length
      ? ((await delegate.findMany({ where: { id: { in: ids } } })) as Array<
          Record<string, unknown>
        >)
      : [];
    for (const row of rows) {
      if (!evidenceMatches(kind, row, manifest)) {
        throw new Error(
          `realistic demo ownership collision kind=${kind} id=${String(row.id)}`,
        );
      }
    }
    counts[kind] = rows.length;
    total += rows.length;
  }
  return { counts, total };
}

export async function assertOwnedOrAbsent(
  prisma: DbClient,
  manifest: DemoManifest,
): Promise<OwnedInspection> {
  const baseRows = (await (prisma as any).department.findMany({
    where: { id: { in: DEMO_CONFIG.baseDepartments.map(({ id }) => id) } },
    select: { id: true, name: true },
  })) as Array<{ id: string; name: string }>;
  const names = new Map(baseRows.map((row) => [row.id, row.name]));
  for (const expected of DEMO_CONFIG.baseDepartments) {
    if (names.get(expected.id) !== expected.expectedName) {
      throw new Error(
        `realistic demo base department mismatch id=${expected.id} actual=${String(names.get(expected.id))} expected=${expected.expectedName}`,
      );
    }
  }
  return inspectOwnedRows(prisma, manifest);
}
