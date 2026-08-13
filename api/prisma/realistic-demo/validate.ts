import { Prisma } from "@prisma/client";
import { ExemptService } from "../../src/cycles/exempt.service";
import { ScoringService } from "../../src/tasks/scoring.service";
import { DEMO_CONFIG } from "./config";
import { ACCEPTANCE_PASSWORD_HASH } from "./people";
import type {
  DemoEntityKind,
  DemoRowSets,
  RealisticDemoDataset,
} from "./types";

type AnyRow = Record<string, any>;

const ROW_MODEL: Record<keyof DemoRowSets, string> = {
  departments: "Department",
  users: "User",
  indicators: "Indicator",
  templates: "AssessmentTemplate",
  dimensions: "TemplateDimension",
  templateIndicators: "TemplateIndicator",
  cycles: "AssessmentCycle",
  snapshots: "AssessmentTemplateSnapshot",
  tasks: "AssessmentTask",
  indicatorInstances: "IndicatorInstance",
  selfEvaluations: "SelfEvalSummary",
  managerEvaluations: "ManagerEvalSummary",
  gradeResults: "GradeResult",
  flowRecords: "FlowRecord",
  archives: "PerformanceArchive",
  objectives: "Objective",
  actionItems: "ActionItem",
  interviews: "PerformanceInterview",
  appeals: "Appeal",
  improvementPlans: "ImprovementPlan",
  probationReviews: "ProbationReview",
  probationIndicators: "ProbationReviewIndicator",
  confirmations: "ConfirmationApplication",
  signatures: "Signature",
  notifications: "NotificationLog",
  auditLogs: "AuditLog",
};

const ROW_KIND: Record<keyof DemoRowSets, DemoEntityKind> = {
  departments: "department",
  users: "user",
  indicators: "indicator",
  templates: "template",
  dimensions: "dimension",
  templateIndicators: "template-indicator",
  cycles: "cycle",
  snapshots: "snapshot",
  tasks: "task",
  indicatorInstances: "indicator-instance",
  selfEvaluations: "self-eval",
  managerEvaluations: "manager-eval",
  gradeResults: "grade",
  flowRecords: "flow",
  archives: "archive",
  objectives: "objective",
  actionItems: "action-item",
  interviews: "interview",
  appeals: "appeal",
  improvementPlans: "improvement-plan",
  probationReviews: "probation-review",
  probationIndicators: "probation-indicator",
  confirmations: "confirmation",
  signatures: "signature",
  notifications: "notification",
  auditLogs: "audit-log",
};

const EXPECTED_ROW_COUNTS: Partial<Record<keyof DemoRowSets, number>> = {
  departments: 1,
  users: 133,
  indicators: 52,
  templates: 14,
  dimensions: 28,
  templateIndicators: 84,
  cycles: 5,
  snapshots: 45,
  tasks: 384,
  indicatorInstances: 2286,
  selfEvaluations: 241,
  managerEvaluations: 241,
  gradeResults: 241,
  flowRecords: 2438,
  archives: 361,
  objectives: 28,
  actionItems: 56,
  interviews: 241,
  appeals: 7,
  improvementPlans: 23,
  probationReviews: 11,
  probationIndicators: 44,
  confirmations: 7,
  signatures: 480,
  notifications: 48,
  auditLogs: 14,
};

const FLOW_COUNT_BY_STATUS: Record<string, number> = {
  indicator_setting: 0,
  indicator_confirming: 1,
  self_eval: 2,
  published: 8,
  appealing: 8,
  confirmed: 9,
  closed: 9,
  exempted: 0,
};

const TASK_TIMESTAMP_FIELDS = [
  "indicatorSetAt",
  "indicatorConfirmedAt",
  "selfEvalSubmittedAt",
  "managerScoredAt",
  "deptReviewedAt",
  "hrCalibratedAt",
  "approvedAt",
  "publishedAt",
  "employeeConfirmedAt",
  "closedAt",
] as const;

const REACHED_TIMESTAMP_COUNT: Record<string, number> = {
  indicator_setting: 0,
  indicator_confirming: 1,
  self_eval: 2,
  published: 8,
  appealing: 8,
  confirmed: 9,
  closed: 10,
  exempted: 0,
};

const BASE_FLOW_EVIDENCE: Record<string, Array<[string, string]>> = {
  indicator_setting: [],
  indicator_confirming: [["indicator_setting", "submit"]],
  self_eval: [
    ["indicator_setting", "submit"],
    ["indicator_confirm", "submit"],
  ],
  published: [
    ["indicator_setting", "submit"],
    ["indicator_confirm", "submit"],
    ["self_eval", "submit"],
    ["manager_score", "submit"],
    ["dept_review", "approve"],
    ["hr_calibration", "submit"],
    ["approval", "approve"],
    ["publish", "approve"],
  ],
  appealing: [],
  confirmed: [],
  closed: [],
  exempted: [],
};
BASE_FLOW_EVIDENCE.appealing = [...BASE_FLOW_EVIDENCE.published];
BASE_FLOW_EVIDENCE.confirmed = [
  ...BASE_FLOW_EVIDENCE.published,
  ["employee_confirm", "approve"],
];
BASE_FLOW_EVIDENCE.closed = [...BASE_FLOW_EVIDENCE.confirmed];

const GRADE_COEFFICIENT: Record<string, number> = {
  A: 1.2,
  B: 1,
  C: 0.8,
  D: 0.6,
};

export class RealisticDemoValidationError extends Error {
  constructor(path: string, rule: string, actual: unknown, expected: unknown) {
    super(
      `path=${path} rule=${rule} actual=${display(actual)} expected=${display(expected)}`,
    );
    this.name = "RealisticDemoValidationError";
  }
}

function display(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function fail(
  path: string,
  rule: string,
  actual: unknown,
  expected: unknown,
): never {
  throw new RealisticDemoValidationError(path, rule, actual, expected);
}

function number(value: unknown): number {
  return Number(value);
}

function date(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function countBy(rows: AnyRow[], field: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    const key = String(row[field]);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function equalCounts(
  actual: Record<string, number>,
  expected: Record<string, number>,
): boolean {
  return (
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, value]) => actual[key] === value)
  );
}

function sameMembers(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length &&
    [...actual]
      .sort()
      .every((value, index) => value === [...expected].sort()[index])
  );
}

interface ValidationIndex {
  users: Map<string, AnyRow>;
  employeeNoByUserId: Map<string, string>;
  cycles: Map<string, AnyRow>;
  cycleNameById: Map<string, string>;
  tasks: Map<string, AnyRow>;
  knownDepartmentIds: Set<string>;
}

function buildIndex(dataset: RealisticDemoDataset): ValidationIndex {
  const users = new Map(
    (dataset.rows.users as AnyRow[]).map((row) => [row.id, row]),
  );
  const cycles = new Map(
    (dataset.rows.cycles as AnyRow[]).map((row) => [row.id, row]),
  );
  return {
    users,
    employeeNoByUserId: new Map(
      [...users.values()].map((row) => [row.id, row.employeeNo ?? "unknown"]),
    ),
    cycles,
    cycleNameById: new Map(
      [...cycles.values()].map((row) => [row.id, row.name]),
    ),
    tasks: new Map(
      (dataset.rows.tasks as AnyRow[]).map((row) => [row.id, row]),
    ),
    knownDepartmentIds: new Set([
      ...DEMO_CONFIG.baseDepartments.map((department) => department.id),
      ...(dataset.rows.departments as AnyRow[]).map((row) => row.id),
    ]),
  };
}

function rowPath(index: ValidationIndex, row: AnyRow, entity: string): string {
  const task = row.taskId ? index.tasks.get(row.taskId) : undefined;
  const cycleId = row.cycleId ?? task?.cycleId;
  const employeeId = row.employeeId ?? row.appellantId ?? task?.employeeId;
  return `${index.cycleNameById.get(cycleId) ?? "global"}/${
    index.employeeNoByUserId.get(employeeId) ?? "global"
  }/${entity}`;
}

function validatePrismaShapes(
  dataset: RealisticDemoDataset,
  index: ValidationIndex,
): void {
  const dmmfModels = new Map(
    Prisma.dmmf.datamodel.models.map((model) => [model.name, model]),
  );
  const enumValues = new Map(
    Prisma.dmmf.datamodel.enums.map((entry) => [
      entry.name,
      new Set(entry.values.map((value) => value.name)),
    ]),
  );
  for (const [rowSet, modelName] of Object.entries(ROW_MODEL) as Array<
    [keyof DemoRowSets, string]
  >) {
    const model = dmmfModels.get(modelName);
    if (!model)
      fail(`global/global/${rowSet}`, "Prisma DMMF model", null, modelName);
    const writableFields = new Set(
      model!.fields
        .filter((field) => field.kind !== "object")
        .map((field) => field.name),
    );
    const requiredFields = model!.fields.filter(
      (field) =>
        field.kind !== "object" &&
        field.isRequired &&
        !field.hasDefaultValue &&
        !field.isGenerated,
    );
    for (const row of dataset.rows[rowSet] as AnyRow[]) {
      const unknown = Object.keys(row).filter(
        (key) => !writableFields.has(key),
      );
      if (unknown.length > 0) {
        fail(
          rowPath(index, row, modelName),
          "Prisma createMany fields",
          unknown.join(","),
          "DMMF scalar fields only",
        );
      }
      const missing = requiredFields
        .filter((field) => row[field.name] === undefined)
        .map((field) => field.name);
      if (missing.length > 0) {
        fail(
          rowPath(index, row, modelName),
          "Prisma required fields",
          missing.join(","),
          "present",
        );
      }
      for (const field of model!.fields.filter(
        (candidate) => candidate.kind !== "object",
      )) {
        const value = row[field.name];
        if (value === undefined) continue;
        if (value === null) {
          if (field.isRequired) {
            fail(
              rowPath(index, row, modelName),
              "Prisma required field null",
              field.name,
              "non-null",
            );
          }
          continue;
        }
        let valid = true;
        if (field.isList) {
          valid = Array.isArray(value);
        } else if (field.kind === "enum") {
          valid =
            typeof value === "string" &&
            Boolean(enumValues.get(field.type)?.has(value));
        } else {
          switch (field.type) {
            case "String":
              valid = typeof value === "string";
              break;
            case "Boolean":
              valid = typeof value === "boolean";
              break;
            case "Int":
              valid = typeof value === "number" && Number.isInteger(value);
              break;
            case "Float":
              valid = typeof value === "number" && Number.isFinite(value);
              break;
            case "DateTime":
              valid =
                (value instanceof Date ||
                  Object.prototype.toString.call(value) === "[object Date]") &&
                !Number.isNaN(new Date(value).getTime());
              break;
            case "Decimal":
              valid =
                (typeof value === "string" || typeof value === "number") &&
                value !== "" &&
                Number.isFinite(Number(value));
              break;
            case "Json": {
              const invalidPath = invalidInputJsonPath(
                value,
                field.isRequired,
                field.name,
              );
              if (invalidPath) {
                fail(
                  rowPath(index, row, modelName),
                  "Prisma InputJsonValue",
                  invalidPath,
                  "JSON primitive, array, plain object, or Prisma JSON null",
                );
              }
              valid = true;
              break;
            }
          }
        }
        if (!valid) {
          fail(
            rowPath(index, row, modelName),
            "Prisma scalar type",
            `${field.name}:${typeof value}`,
            field.type,
          );
        }
      }
    }
  }
}

function invalidInputJsonPath(
  value: unknown,
  requiredField: boolean,
  root: string,
): string | null {
  if (value === Prisma.JsonNull) return null;
  if (value === Prisma.DbNull) return requiredField ? root : null;
  if (value === Prisma.AnyNull) return root;
  const active = new Set<object>();
  const visit = (candidate: unknown, path: string): string | null => {
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    ) {
      return null;
    }
    if (typeof candidate === "number") {
      return Number.isFinite(candidate) ? null : path;
    }
    if (
      typeof candidate === "undefined" ||
      typeof candidate === "bigint" ||
      typeof candidate === "symbol" ||
      typeof candidate === "function"
    ) {
      return path;
    }
    if (!candidate || typeof candidate !== "object") return path;
    if (active.has(candidate)) return `${path}.[cycle]`;
    const prototype = Object.getPrototypeOf(candidate);
    if (
      !Array.isArray(candidate) &&
      prototype !== null &&
      prototype?.constructor?.name !== "Object"
    ) {
      return path;
    }
    active.add(candidate);
    const entries = Array.isArray(candidate)
      ? candidate.map((item, arrayIndex) => [String(arrayIndex), item] as const)
      : Object.entries(candidate);
    for (const [key, item] of entries) {
      const invalid = visit(item, `${path}.${key}`);
      if (invalid) return invalid;
    }
    active.delete(candidate);
    return null;
  };
  return visit(value, root);
}

function validateIdentity(
  dataset: RealisticDemoDataset,
  index: ValidationIndex,
): void {
  const allIds: string[] = [];
  const manifestMismatches: Array<{
    rowSet: keyof DemoRowSets;
    actual: number;
    expected: number;
  }> = [];
  for (const [rowSet, kind] of Object.entries(ROW_KIND) as Array<
    [keyof DemoRowSets, DemoEntityKind]
  >) {
    const ids = (dataset.rows[rowSet] as AnyRow[]).map((row) => row.id);
    if (ids.some((id) => typeof id !== "string" || id.length === 0)) {
      fail(`global/global/${rowSet}`, "deterministic id", ids, "non-empty IDs");
    }
    if (!sameMembers(ids, dataset.manifest.ownedIds[kind] ?? [])) {
      manifestMismatches.push({
        rowSet,
        actual: dataset.manifest.ownedIds[kind]?.length ?? 0,
        expected: ids.length,
      });
    }
    allIds.push(...ids);
  }
  const unique = new Set(allIds);
  if (unique.size !== allIds.length) {
    fail("global/global/manifest", "unique id", allIds.length - unique.size, 0);
  }
  if (manifestMismatches.length > 0) {
    const mismatch = manifestMismatches[0];
    fail(
      `global/global/${mismatch.rowSet}`,
      "manifest owned IDs",
      mismatch.actual,
      mismatch.expected,
    );
  }

  const employeeNumbers = (dataset.rows.users as AnyRow[]).map(
    (user) => user.employeeNo,
  );
  if (new Set(employeeNumbers).size !== employeeNumbers.length) {
    fail(
      "global/global/users",
      "unique employee number",
      employeeNumbers.length - new Set(employeeNumbers).size,
      0,
    );
  }

  for (const user of dataset.rows.users as AnyRow[]) {
    if (
      typeof user.email !== "string" ||
      !user.email.endsWith("@example.invalid")
    ) {
      fail(
        rowPath(index, user, "user"),
        "example.invalid email",
        user.email,
        "*@example.invalid",
      );
    }
  }

  const sentinelUsers = (dataset.rows.users as AnyRow[]).filter(
    (user) => user.passwordHash === ACCEPTANCE_PASSWORD_HASH,
  );
  const acceptanceNumbers = Object.values(
    dataset.manifest.acceptanceEmployeeNos,
  );
  if (
    sentinelUsers.length !== 8 ||
    !sameMembers(
      sentinelUsers.map((user) => user.employeeNo),
      acceptanceNumbers,
    )
  ) {
    fail(
      "global/global/users",
      "acceptance password sentinels",
      sentinelUsers.map((user) => user.employeeNo),
      acceptanceNumbers,
    );
  }
  const unexpectedHashes = (dataset.rows.users as AnyRow[]).filter(
    (user) =>
      user.passwordHash !== null &&
      user.passwordHash !== ACCEPTANCE_PASSWORD_HASH,
  );
  if (unexpectedHashes.length > 0) {
    fail(
      "global/global/users",
      "password hash boundary",
      unexpectedHashes.length,
      "sentinel or null before persistence",
    );
  }
}

function validateDPlanCoverage(
  dataset: RealisticDemoDataset,
  index: ValidationIndex,
): void {
  const gradeByTask = new Map(
    (dataset.rows.gradeResults as AnyRow[]).map((grade) => [
      grade.taskId,
      grade,
    ]),
  );
  const planCounts = new Map<string, number>();
  for (const plan of dataset.rows.improvementPlans as AnyRow[]) {
    planCounts.set(plan.taskId, (planCounts.get(plan.taskId) ?? 0) + 1);
  }
  for (const grade of dataset.rows.gradeResults as AnyRow[]) {
    if (grade.calibratedGrade !== "D") continue;
    const count = planCounts.get(grade.taskId) ?? 0;
    if (count !== 1) {
      fail(
        rowPath(index, index.tasks.get(grade.taskId)!, `task=${grade.taskId}`),
        "D grade improvement plan",
        count,
        1,
      );
    }
  }
  for (const [taskId] of planCounts) {
    if (gradeByTask.get(taskId)?.calibratedGrade !== "D") {
      fail(
        rowPath(index, index.tasks.get(taskId)!, `task=${taskId}`),
        "D grade improvement plan",
        gradeByTask.get(taskId)?.calibratedGrade,
        "D",
      );
    }
  }
}

function validateRelations(
  dataset: RealisticDemoDataset,
  index: ValidationIndex,
): void {
  const idSets = new Map<string, Set<string>>();
  for (const [rowSet, modelName] of Object.entries(ROW_MODEL) as Array<
    [keyof DemoRowSets, string]
  >) {
    idSets.set(
      modelName,
      new Set((dataset.rows[rowSet] as AnyRow[]).map((row) => row.id)),
    );
  }
  idSets.set("Department", index.knownDepartmentIds);

  const models = new Map(
    Prisma.dmmf.datamodel.models.map((model) => [model.name, model]),
  );
  for (const [rowSet, modelName] of Object.entries(ROW_MODEL) as Array<
    [keyof DemoRowSets, string]
  >) {
    const relationFields = models
      .get(modelName)!
      .fields.filter(
        (field) => field.kind === "object" && field.relationFromFields?.length,
      );
    for (const row of dataset.rows[rowSet] as AnyRow[]) {
      for (const relation of relationFields) {
        const foreignField = relation.relationFromFields![0];
        const value = row[foreignField];
        if (value === null || value === undefined) continue;
        if (!idSets.get(relation.type)?.has(value)) {
          fail(
            rowPath(index, row, modelName.toLowerCase()),
            `${relation.name.toLowerCase()} foreign key`,
            value,
            relation.type,
          );
        }
      }
    }
  }

  for (const template of dataset.rows.templates as AnyRow[]) {
    for (const departmentId of template.applicableDepts ?? []) {
      if (!index.knownDepartmentIds.has(departmentId)) {
        fail(
          "global/global/template",
          "applicable department foreign key",
          departmentId,
          "known department",
        );
      }
    }
    for (const userId of template.applicableUsers ?? []) {
      if (!index.users.has(userId)) {
        fail(
          "global/global/template",
          "applicable user foreign key",
          userId,
          "known user",
        );
      }
    }
  }

  const interviewIds = new Set(
    (dataset.rows.interviews as AnyRow[]).map((row) => row.id),
  );
  const reviewIds = new Set(
    (dataset.rows.probationReviews as AnyRow[]).map((row) => row.id),
  );
  for (const signature of dataset.rows.signatures as AnyRow[]) {
    const target =
      signature.businessType === "interview" ? interviewIds : reviewIds;
    if (!target.has(signature.businessRecordId)) {
      fail(
        rowPath(index, signature, "signature"),
        "signature business foreign key",
        signature.businessRecordId,
        signature.businessType,
      );
    }
  }

  const appealIds = new Set(
    (dataset.rows.appeals as AnyRow[]).map((row) => row.id),
  );
  const confirmationIds = new Set(
    (dataset.rows.confirmations as AnyRow[]).map((row) => row.id),
  );
  for (const audit of dataset.rows.auditLogs as AnyRow[]) {
    const valid =
      (audit.entityType === "appeal" && appealIds.has(audit.entityId)) ||
      (audit.entityType === "confirmation_application" &&
        confirmationIds.has(audit.entityId));
    if (!valid) {
      fail(
        rowPath(index, audit, "audit"),
        "audit entity foreign key",
        `${audit.entityType}:${audit.entityId}`,
        "generated business entity",
      );
    }
  }
}

function validatePopulation(
  dataset: RealisticDemoDataset,
  index: ValidationIndex,
): void {
  for (const [rowSet, expected] of Object.entries(EXPECTED_ROW_COUNTS) as Array<
    [keyof DemoRowSets, number]
  >) {
    const actual = dataset.rows[rowSet].length;
    if (actual !== expected) {
      const rule =
        rowSet === "improvementPlans"
          ? "D grade improvement plan count"
          : `exact ${rowSet} count`;
      fail(`global/global/${rowSet}`, rule, actual, expected);
    }
  }

  const people = (dataset.rows.users as AnyRow[]).filter(
    (user) => user.sysRole !== "system_admin",
  );
  const current = people.filter((user) => user.status !== "resigned");
  if (current.length !== 128)
    fail("global/global/users", "current headcount", current.length, 128);
  const statusCounts = countBy(people, "status");
  const expectedStatus = { active: 121, probation: 7, resigned: 4 };
  if (!equalCounts(statusCounts, expectedStatus)) {
    fail(
      "global/global/users",
      "employment status quota",
      statusCounts,
      expectedStatus,
    );
  }
  const employmentCounts = countBy(current, "employmentType");
  const expectedEmployment = {
    full_time: 115,
    rehire: 9,
    external: 3,
    part_time: 1,
  };
  if (!equalCounts(employmentCounts, expectedEmployment)) {
    fail(
      "global/global/users",
      "employment type quota",
      employmentCounts,
      expectedEmployment,
    );
  }
  const admins = (dataset.rows.users as AnyRow[]).filter(
    (user) => user.sysRole === "system_admin",
  );
  if (admins.length !== 1)
    fail("global/global/users", "system admin count", admins.length, 1);

  const objectiveLevels = countBy(dataset.rows.objectives as AnyRow[], "level");
  const expectedObjectiveLevels = { company: 1, department: 9, individual: 18 };
  if (!equalCounts(objectiveLevels, expectedObjectiveLevels)) {
    fail(
      "global/global/objectives",
      "objective level quota",
      objectiveLevels,
      expectedObjectiveLevels,
    );
  }

  for (const user of dataset.rows.users as AnyRow[]) {
    if (!index.knownDepartmentIds.has(user.deptId)) {
      fail(
        rowPath(index, user, "user"),
        "base department reference",
        user.deptId,
        "known base or generated department",
      );
    }
  }

  const edges = (dataset.rows.users as AnyRow[]).filter(
    (user) => user.directManagerId !== null,
  );
  if (edges.length !== 123)
    fail("global/global/users", "manager edge count", edges.length, 123);
  for (const user of dataset.rows.users as AnyRow[]) {
    const seen = new Set([user.id]);
    let managerId = user.directManagerId;
    while (managerId) {
      if (seen.has(managerId)) {
        fail(
          rowPath(index, user, "user"),
          "acyclic manager graph",
          managerId,
          "no cycle",
        );
      }
      seen.add(managerId);
      managerId = index.users.get(managerId)?.directManagerId ?? null;
    }
  }

  if (dataset.departmentLeadership.length !== 9) {
    fail(
      "global/global/department-leadership",
      "leadership count",
      dataset.departmentLeadership.length,
      9,
    );
  }
  const expectedLeadershipIds = [
    "00000000-0000-0000-0000-000000000010",
    "00000000-0000-0000-0000-000000000011",
    "00000000-0000-0000-0000-000000000012",
    "00000000-0000-0000-0000-000000000013",
    "00000000-0000-0000-0000-000000000014",
    "00000000-0000-0000-0000-000000000015",
    "00000000-0000-0000-0000-000000000016",
    "00000000-0000-0000-0000-000000000018",
    ...(dataset.rows.departments as AnyRow[]).map((row) => row.id),
  ];
  const leadershipIds = dataset.departmentLeadership.map((row) => row.id);
  if (!sameMembers(leadershipIds, expectedLeadershipIds)) {
    fail(
      "global/global/department-leadership",
      "department leadership IDs",
      leadershipIds,
      expectedLeadershipIds,
    );
  }
  for (const leadership of dataset.departmentLeadership) {
    for (const [role, userId] of [
      ["leader", leadership.leaderId],
      ["approver", leadership.approverId],
    ] as const) {
      const user = userId ? index.users.get(userId) : undefined;
      if (!user || user.status === "resigned") {
        fail(
          `global/global/department=${leadership.id}`,
          `${role} resolution`,
          userId,
          "current generated user",
        );
      }
    }
  }
}

function validateCatalog(
  dataset: RealisticDemoDataset,
  index: ValidationIndex,
): void {
  const dimensionsByTemplate = new Map<string, AnyRow[]>();
  for (const dimension of dataset.rows.dimensions as AnyRow[]) {
    const rows = dimensionsByTemplate.get(dimension.templateId) ?? [];
    rows.push(dimension);
    dimensionsByTemplate.set(dimension.templateId, rows);
  }
  const indicatorsByDimension = new Map<string, AnyRow[]>();
  for (const indicator of dataset.rows.templateIndicators as AnyRow[]) {
    const rows = indicatorsByDimension.get(indicator.dimensionId) ?? [];
    rows.push(indicator);
    indicatorsByDimension.set(indicator.dimensionId, rows);
  }
  for (const template of dataset.rows.templates as AnyRow[]) {
    const dimensions = dimensionsByTemplate.get(template.id) ?? [];
    const total = dimensions.reduce((sum, row) => sum + number(row.weight), 0);
    if (dimensions.length !== 2 || Math.abs(total - 1) > 0.0001) {
      fail(
        "global/global/template=" + template.id,
        "dimension weight total",
        total,
        1,
      );
    }
    for (const dimension of dimensions) {
      const indicators = indicatorsByDimension.get(dimension.id) ?? [];
      const weight = indicators.reduce(
        (sum, row) => sum + number(row.weight),
        0,
      );
      if (indicators.length === 0 || Math.abs(weight - 1) > 0.0001) {
        fail(
          "global/global/dimension=" + dimension.id,
          "indicator weight total",
          weight,
          1,
        );
      }
    }
  }
}

function validateTasksAndScores(
  dataset: RealisticDemoDataset,
  index: ValidationIndex,
): void {
  const tasks = dataset.rows.tasks as AnyRow[];
  const taskRowsByCycle = new Map<string, AnyRow[]>();
  for (const task of tasks) {
    const rows = taskRowsByCycle.get(task.cycleId) ?? [];
    rows.push(task);
    taskRowsByCycle.set(task.cycleId, rows);
  }
  const cycleByName = new Map(
    (dataset.rows.cycles as AnyRow[]).map((cycle) => [cycle.name, cycle]),
  );
  const taskCounts: Record<string, number> = {
    "2026-Q1": 120,
    "2026-Q2": 124,
    "2026-Q3": 128,
    "2026-ANNUAL-LEADERS": 12,
  };
  for (const [cycleName, expected] of Object.entries(taskCounts)) {
    const cycle = cycleByName.get(cycleName)!;
    const actual = taskRowsByCycle.get(cycle.id)?.length ?? 0;
    if (actual !== expected) {
      fail(
        `${cycleName}/global/tasks`,
        "task eligibility count",
        actual,
        expected,
      );
    }
  }

  const currentUsers = (dataset.rows.users as AnyRow[]).filter(
    (user) => user.status !== "resigned" && user.sysRole !== "system_admin",
  );
  const exemptService = new ExemptService();
  for (const cycleName of ["2026-Q1", "2026-Q2", "2026-Q3"]) {
    const cycle = cycleByName.get(cycleName)!;
    const expectedUsers = currentUsers
      .filter(
        (user) =>
          date(user.entryDate)!.getTime() <= date(cycle.endDate)!.getTime(),
      )
      .map((user) => user.id);
    const actualUsers = (taskRowsByCycle.get(cycle.id) ?? []).map(
      (task) => task.employeeId,
    );
    if (!sameMembers(actualUsers, expectedUsers)) {
      fail(
        `${cycleName}/global/tasks`,
        "task cycle eligibility",
        actualUsers.length,
        expectedUsers.length,
      );
    }
  }

  const indicatorsByTask = new Map<string, AnyRow[]>();
  for (const indicator of dataset.rows.indicatorInstances as AnyRow[]) {
    const rows = indicatorsByTask.get(indicator.taskId) ?? [];
    rows.push(indicator);
    indicatorsByTask.set(indicator.taskId, rows);
  }
  const selfByTask = new Map(
    (dataset.rows.selfEvaluations as AnyRow[]).map((row) => [row.taskId, row]),
  );
  const managerByTask = new Map(
    (dataset.rows.managerEvaluations as AnyRow[]).map((row) => [
      row.taskId,
      row,
    ]),
  );
  const gradeByTask = new Map(
    (dataset.rows.gradeResults as AnyRow[]).map((row) => [row.taskId, row]),
  );
  const flowsByTask = new Map<string, AnyRow[]>();
  for (const flow of dataset.rows.flowRecords as AnyRow[]) {
    const rows = flowsByTask.get(flow.taskId) ?? [];
    rows.push(flow);
    flowsByTask.set(flow.taskId, rows);
  }
  const appealByTask = new Map(
    (dataset.rows.appeals as AnyRow[]).map((appeal) => [appeal.taskId, appeal]),
  );
  const snapshots = new Map(
    (dataset.rows.snapshots as AnyRow[]).map((snapshot) => [
      snapshot.id,
      snapshot,
    ]),
  );
  const dimensions = new Map(
    (dataset.rows.dimensions as AnyRow[]).map((dimension) => [
      dimension.id,
      dimension,
    ]),
  );
  const templateIndicatorTemplate = new Map(
    (dataset.rows.templateIndicators as AnyRow[]).map((indicator) => [
      indicator.id,
      dimensions.get(indicator.dimensionId)?.templateId,
    ]),
  );

  for (const task of tasks) {
    const cycle = index.cycles.get(task.cycleId)!;
    const user = index.users.get(task.employeeId)!;
    const path = rowPath(index, task, `task=${task.id}`);
    const snapshot = snapshots.get(task.snapshotId)!;
    if (snapshot.cycleId !== task.cycleId) {
      fail(path, "snapshot cycle consistency", snapshot.cycleId, task.cycleId);
    }
    const reachedTimestampCount = REACHED_TIMESTAMP_COUNT[task.status];
    if (reachedTimestampCount === undefined) {
      fail(
        path,
        "supported task status",
        task.status,
        Object.keys(REACHED_TIMESTAMP_COUNT),
      );
    }
    const missingReached = TASK_TIMESTAMP_FIELDS.slice(
      0,
      reachedTimestampCount,
    ).filter((field) => !task[field]);
    const forbiddenReached = TASK_TIMESTAMP_FIELDS.slice(
      reachedTimestampCount,
    ).filter((field) => Boolean(task[field]));
    if (missingReached.length > 0 || forbiddenReached.length > 0) {
      fail(
        path,
        "task status timestamps",
        `missing=${missingReached.join(",")};forbidden=${forbiddenReached.join(",")}`,
        task.status,
      );
    }
    if (user.status === "resigned" || user.sysRole === "system_admin") {
      fail(
        path,
        "resigned user exclusion from new tasks",
        user.status,
        "current business user",
      );
    }
    if (date(task.createdAt)!.getTime() < date(user.entryDate)!.getTime()) {
      fail(path, "task creation after entry", task.createdAt, user.entryDate);
    }
    for (const role of ["managerId", "deptHeadId", "approverId"] as const) {
      if (!task[role] || index.users.get(task[role])?.status === "resigned") {
        fail(path, `${role} resolution`, task[role], "current generated user");
      }
    }

    if (["2026-Q1", "2026-Q2"].includes(cycle.name)) {
      const expectedExempt = exemptService.calcExempt(
        { entryDate: date(user.entryDate), leaveDate: date(user.leaveDate) },
        { startDate: date(cycle.startDate)!, endDate: date(cycle.endDate)! },
        0.3333,
      ).isExempt;
      if (Boolean(task.isExempt) !== expectedExempt) {
        fail(path, "service-derived exemption", task.isExempt, expectedExempt);
      }
    }

    const indicators = indicatorsByTask.get(task.id) ?? [];
    const flows = flowsByTask.get(task.id) ?? [];
    if (task.isExempt) {
      const excludedCount =
        indicators.length +
        Number(selfByTask.has(task.id)) +
        Number(managerByTask.has(task.id)) +
        Number(gradeByTask.has(task.id)) +
        flows.length;
      if (task.status !== "exempted" || excludedCount !== 0) {
        fail(path, "exempt task exclusions", excludedCount, 0);
      }
      continue;
    }
    const wrongTemplateIndicator = indicators.find(
      (indicator) =>
        indicator.templateIndicatorId &&
        templateIndicatorTemplate.get(indicator.templateIndicatorId) !==
          snapshot.templateId,
    );
    if (wrongTemplateIndicator) {
      fail(
        path,
        "snapshot indicator template consistency",
        wrongTemplateIndicator.templateIndicatorId,
        snapshot.templateId,
      );
    }

    const dimensions = new Map<string, AnyRow[]>();
    for (const indicator of indicators) {
      const rows = dimensions.get(indicator.dimensionName) ?? [];
      rows.push(indicator);
      dimensions.set(indicator.dimensionName, rows);
    }
    const dimensionWeights = new Set<number>();
    for (const rows of dimensions.values()) {
      const weightTotal = rows.reduce(
        (sum, indicator) => sum + number(indicator.weight),
        0,
      );
      if (Math.abs(weightTotal - 1) > 0.0001) {
        fail(path, "weight total", weightTotal, 1);
      }
      dimensionWeights.add(number(rows[0].dimensionWeight));
    }
    const dimensionTotal = [...dimensionWeights].reduce(
      (sum, weight) => sum + weight,
      0,
    );
    if (Math.abs(dimensionTotal - 1) > 0.0001) {
      fail(path, "dimension weight total", dimensionTotal, 1);
    }

    const appeal = appealByTask.get(task.id);
    const appealFlowCount =
      appeal?.status === "resolved"
        ? 3
        : appeal?.status === "hr_processing"
          ? 2
          : appeal?.status === "dept_processing"
            ? 1
            : 0;
    const expectedFlowCount =
      FLOW_COUNT_BY_STATUS[task.status] + appealFlowCount;
    if (flows.length !== expectedFlowCount) {
      fail(path, "flow reached state", flows.length, expectedFlowCount);
    }
    const appealEvidence: Array<[string, string]> =
      appeal?.status === "resolved"
        ? [
            ["appeal", "submit"],
            ["appeal", "approve"],
            ["appeal", "approve"],
          ]
        : appeal?.status === "hr_processing"
          ? [
              ["appeal", "submit"],
              ["appeal", "approve"],
            ]
          : appeal?.status === "dept_processing"
            ? [["appeal", "submit"]]
            : [];
    const expectedFlowEvidence = [
      ...(BASE_FLOW_EVIDENCE[task.status] ?? []),
      ...appealEvidence,
    ];
    const actualFlowEvidence = flows.map(
      (flow) => [flow.nodeType, flow.action] as [string, string],
    );
    if (
      actualFlowEvidence.length !== expectedFlowEvidence.length ||
      actualFlowEvidence.some(
        (entry, flowIndex) =>
          entry[0] !== expectedFlowEvidence[flowIndex][0] ||
          entry[1] !== expectedFlowEvidence[flowIndex][1],
      )
    ) {
      fail(
        path,
        "ordered flow evidence",
        actualFlowEvidence,
        expectedFlowEvidence,
      );
    }
    for (const flow of flows) {
      if (flow.cycleId !== task.cycleId || !flow.actorId) {
        fail(path, "flow task cycle actor", flow, "matching cycle and actor");
      }
    }

    const grade = gradeByTask.get(task.id);
    if (grade) {
      if (
        !["published", "appealing", "confirmed", "closed"].includes(
          task.status,
        ) ||
        grade.isPublished !== true ||
        !grade.publishedAt ||
        date(grade.publishedAt)?.getTime() !== date(task.publishedAt)?.getTime()
      ) {
        fail(
          path,
          "published grade evidence",
          {
            taskStatus: task.status,
            isPublished: grade.isPublished,
            gradePublishedAt: grade.publishedAt,
            taskPublishedAt: task.publishedAt,
          },
          "published task and synchronized published grade",
        );
      }
      if (!selfByTask.has(task.id) || !managerByTask.has(task.id)) {
        fail(path, "completed evaluation summaries", false, true);
      }
      const scoring = new ScoringService(null as never).calcTaskTotal(
        indicators.map((indicator) => ({
          id: indicator.id,
          name: indicator.name,
          indicatorType: indicator.indicatorType,
          dimensionName: indicator.dimensionName,
          dimensionType:
            indicator.indicatorType === "attitude" ? "attitude" : "kpi",
          dimensionWeight: number(indicator.dimensionWeight),
          weight: number(indicator.weight),
          managerScore: number(indicator.managerScore),
          finalScore: number(indicator.finalScore),
        })),
      );
      const persistedScore = number(grade.calculatedScore);
      if (Number(scoring.totalScore.toFixed(2)) !== persistedScore) {
        fail(
          path,
          "score arithmetic",
          persistedScore,
          scoring.totalScore.toFixed(2),
        );
      }
      const persistedRawGrade = new ScoringService(null as never).calcRawGrade(
        persistedScore,
        { A: 90, B: 75, C: 60 },
      );
      if (grade.rawGrade !== persistedRawGrade) {
        fail(path, "raw grade arithmetic", grade.rawGrade, persistedRawGrade);
      }
      if (
        number(grade.coefficient) !== GRADE_COEFFICIENT[grade.calibratedGrade]
      ) {
        fail(
          path,
          "grade coefficient",
          grade.coefficient,
          GRADE_COEFFICIENT[grade.calibratedGrade],
        );
      }
    }
  }

  const q1 = cycleByName.get("2026-Q1")!;
  const q2 = cycleByName.get("2026-Q2")!;
  const q3 = cycleByName.get("2026-Q3")!;
  const expectedStoryKeys = Object.keys(DEMO_CONFIG.storyEmployeeNos);
  const actualStoryKeys = Object.keys(dataset.manifest.storyUserIds);
  if (!sameMembers(actualStoryKeys, expectedStoryKeys)) {
    fail(
      "story/global/manifest",
      "story manifest keys",
      actualStoryKeys,
      expectedStoryKeys,
    );
  }
  for (const [story, employeeNo] of Object.entries(
    DEMO_CONFIG.storyEmployeeNos,
  )) {
    const userId = dataset.manifest.storyUserIds[story];
    const user = index.users.get(userId);
    if (!user || user.employeeNo !== employeeNo) {
      fail(
        `story/${story}/manifest`,
        "story manifest binding",
        `${story}:${user?.employeeNo ?? userId}`,
        `${story}:${employeeNo}`,
      );
    }
  }
  const exactExempt = (cycle: AnyRow, expected: string[]) => {
    const employeeNumbers = (taskRowsByCycle.get(cycle.id) ?? [])
      .filter((task) => task.isExempt)
      .map((task) => index.employeeNoByUserId.get(task.employeeId)!);
    if (!sameMembers(employeeNumbers, expected)) {
      fail(
        `${cycle.name}/global/tasks`,
        "exact exemption identities",
        employeeNumbers,
        expected,
      );
    }
  };
  exactExempt(q1, ["FD300118", "FD300119"]);
  exactExempt(q2, ["FD300123"]);

  const exactGrades = (cycle: AnyRow, expected: Record<string, number>) => {
    const cycleTaskIds = new Set(
      (taskRowsByCycle.get(cycle.id) ?? []).map((task) => task.id),
    );
    const actual = countBy(
      (dataset.rows.gradeResults as AnyRow[]).filter((grade) =>
        cycleTaskIds.has(grade.taskId),
      ),
      "calibratedGrade",
    );
    if (!equalCounts(actual, expected)) {
      fail(`${cycle.name}/global/grades`, "grade quota", actual, expected);
    }
  };
  exactGrades(q1, { A: 23, B: 47, C: 37, D: 11 });
  exactGrades(q2, { A: 24, B: 49, C: 38, D: 12 });
  const exactStatuses = (
    cycle: AnyRow,
    expected: Record<string, number>,
    rule: string,
  ) => {
    const actual = countBy(taskRowsByCycle.get(cycle.id) ?? [], "status");
    if (!equalCounts(actual, expected)) {
      fail(`${cycle.name}/global/tasks`, rule, actual, expected);
    }
  };
  exactStatuses(q1, { closed: 118, exempted: 2 }, "Q1 status quota");
  exactStatuses(
    q2,
    { confirmed: 115, appealing: 2, published: 6, exempted: 1 },
    "Q2 status quota",
  );
  const q3Statuses = countBy(taskRowsByCycle.get(q3.id) ?? [], "status");
  const expectedQ3 = {
    self_eval: 113,
    indicator_confirming: 9,
    indicator_setting: 6,
  };
  if (!equalCounts(q3Statuses, expectedQ3)) {
    fail("2026-Q3/global/tasks", "active status quota", q3Statuses, expectedQ3);
  }
  const annual = cycleByName.get("2026-ANNUAL-LEADERS")!;
  exactStatuses(annual, { self_eval: 12 }, "annual leader status quota");
  const managerIds = new Set(
    (dataset.rows.users as AnyRow[])
      .map((user) => user.directManagerId)
      .filter(Boolean),
  );
  for (const task of taskRowsByCycle.get(annual.id) ?? []) {
    if (!managerIds.has(task.employeeId)) {
      fail(
        rowPath(index, task, `task=${task.id}`),
        "annual leader eligibility",
        index.employeeNoByUserId.get(task.employeeId),
        "current manager",
      );
    }
  }

  const vp = [...index.users.values()].find(
    (user) => user.employeeNo === "FD100002",
  )!;
  const ordinary = [...index.users.values()].find(
    (user) => user.employeeNo === "FD210108",
  )!;
  if (date(vp.entryDate)?.toISOString() !== "2025-10-10T00:00:00.000Z") {
    fail(
      "global/FD100002/user",
      "approved entry date",
      vp.entryDate,
      "2025-10-10",
    );
  }
  if (date(ordinary.entryDate)?.toISOString() !== "2026-05-31T00:00:00.000Z") {
    fail(
      "global/FD210108/user",
      "approved entry date",
      ordinary.entryDate,
      "2026-05-31",
    );
  }

  const gradeForStory = (story: string, cycle: AnyRow): string | undefined => {
    const userId = dataset.manifest.storyUserIds[story];
    const task = (taskRowsByCycle.get(cycle.id) ?? []).find(
      (row) => row.employeeId === userId,
    );
    return task ? gradeByTask.get(task.id)?.calibratedGrade : undefined;
  };
  const storyGrades: Array<[string, string, string]> = [
    ["excellentManager", "A", "A"],
    ["stableContributor", "B", "B"],
    ["lowPerformer", "C", "D"],
    ["consecutiveLowPerformerA", "D", "D"],
    ["consecutiveLowPerformerB", "D", "D"],
  ];
  for (const [story, q1Grade, q2Grade] of storyGrades) {
    const actual = [gradeForStory(story, q1), gradeForStory(story, q2)];
    if (actual[0] !== q1Grade || actual[1] !== q2Grade) {
      fail(`story/${story}/grade`, "fixed grade story", actual, [
        q1Grade,
        q2Grade,
      ]);
    }
  }
  const appealForStory = (story: string, cycle: AnyRow): AnyRow | undefined => {
    const task = (taskRowsByCycle.get(cycle.id) ?? []).find(
      (row) => row.employeeId === dataset.manifest.storyUserIds[story],
    );
    return task
      ? (dataset.rows.appeals as AnyRow[]).find(
          (appeal) => appeal.taskId === task.id,
        )
      : undefined;
  };
  if (appealForStory("appealModified", q2)?.finalResult !== "modified") {
    fail(
      "story/appealModified/appeal",
      "fixed appeal story",
      appealForStory("appealModified", q2)?.finalResult,
      "modified",
    );
  }
  for (const cycle of [q1, q2]) {
    if (
      appealForStory("appealMaintained", cycle)?.finalResult !== "maintained"
    ) {
      fail(
        "story/appealMaintained/appeal",
        "fixed appeal story",
        appealForStory("appealMaintained", cycle)?.finalResult,
        `maintained in ${cycle.name}`,
      );
    }
  }
  const lateEntryTask = (taskRowsByCycle.get(q1.id) ?? []).find(
    (task) => task.employeeId === dataset.manifest.storyUserIds.lateEntryExempt,
  );
  if (!lateEntryTask?.isExempt || lateEntryTask.status !== "exempted") {
    fail(
      "story/lateEntryExempt/task",
      "fixed exemption story",
      lateEntryTask?.status,
      "FD300118 exempted in Q1",
    );
  }
  const transferredId = dataset.manifest.storyUserIds.transferredEmployee;
  const transferredQ2 = (taskRowsByCycle.get(q2.id) ?? []).find(
    (task) => task.employeeId === transferredId,
  );
  const transferredQ3 = (taskRowsByCycle.get(q3.id) ?? []).find(
    (task) => task.employeeId === transferredId,
  );
  if (
    !transferredQ2 ||
    !transferredQ3 ||
    transferredQ2.deptId === transferredQ3.deptId
  ) {
    fail(
      "story/transferredEmployee/task",
      "transfer organization history",
      [transferredQ2?.deptId, transferredQ3?.deptId],
      "different Q2 and Q3 departments",
    );
  }
}

function validateTime(
  dataset: RealisticDemoDataset,
  index: ValidationIndex,
): void {
  const asOf = dataset.manifest.asOf.getTime();
  const futureAllowed = new Map<string, Set<string>>([
    [
      "AssessmentCycle",
      new Set([
        "endDate",
        "deadlineIndicatorSetting",
        "deadlineIndicatorConfirm",
        "deadlineSelfEval",
        "deadlineManagerScore",
        "deadlineHrCalibration",
        "deadlineApproval",
        "deadlinePublish",
        "deadlineAppeal",
      ]),
    ],
    ["PerformanceInterview", new Set(["deadline"])],
    ["ImprovementPlan", new Set(["targetDate"])],
    ["ProbationReview", new Set(["plannedRegularDate"])],
    ["User", new Set(["plannedRegularDate"])],
    ["ActionItem", new Set(["startDate", "dueDate"])],
  ]);
  const models = new Map(
    Prisma.dmmf.datamodel.models.map((model) => [model.name, model]),
  );
  for (const [rowSet, modelName] of Object.entries(ROW_MODEL) as Array<
    [keyof DemoRowSets, string]
  >) {
    const dateFields = models
      .get(modelName)!
      .fields.filter(
        (field) =>
          field.kind === "scalar" &&
          field.type === "DateTime" &&
          !futureAllowed.get(modelName)?.has(field.name),
      );
    for (const row of dataset.rows[rowSet] as AnyRow[]) {
      for (const field of dateFields) {
        const value = date(row[field.name]);
        if (value && value.getTime() > asOf) {
          fail(
            rowPath(index, row, `${modelName.toLowerCase()}=${row.id}`),
            `${field.name} after asOf`,
            value,
            dataset.manifest.asOf,
          );
        }
      }
    }
  }

  const taskOrder = [
    "createdAt",
    "indicatorSetAt",
    "indicatorConfirmedAt",
    "selfEvalSubmittedAt",
    "managerScoredAt",
    "deptReviewedAt",
    "hrCalibratedAt",
    "approvedAt",
    "publishedAt",
    "employeeConfirmedAt",
    "closedAt",
    "updatedAt",
  ];
  for (const task of dataset.rows.tasks as AnyRow[]) {
    const reached = taskOrder
      .map((field) => [field, date(task[field])] as const)
      .filter((entry): entry is readonly [string, Date] => Boolean(entry[1]));
    for (
      let indexInOrder = 1;
      indexInOrder < reached.length;
      indexInOrder += 1
    ) {
      if (reached[indexInOrder][1] < reached[indexInOrder - 1][1]) {
        fail(
          rowPath(index, task, `task=${task.id}`),
          "chronological timestamps",
          reached[indexInOrder][0],
          `after ${reached[indexInOrder - 1][0]}`,
        );
      }
    }
  }
}

function validateArchivesAndWorkflows(
  dataset: RealisticDemoDataset,
  index: ValidationIndex,
): void {
  const grades = dataset.rows.gradeResults as AnyRow[];
  const gradeByTask = new Map(grades.map((row) => [row.taskId, row]));
  const archiveByEmployeeCycle = new Map(
    (dataset.rows.archives as AnyRow[]).map((row) => [
      `${row.employeeId}:${row.cycleId}`,
      row,
    ]),
  );
  for (const grade of grades) {
    const task = index.tasks.get(grade.taskId)!;
    const archive = archiveByEmployeeCycle.get(
      `${task.employeeId}:${task.cycleId}`,
    );
    if (
      !archive ||
      archive.grade !== grade.calibratedGrade ||
      number(archive.totalScore) !== number(grade.calculatedScore) ||
      number(archive.coefficient) !== number(grade.coefficient)
    ) {
      fail(
        rowPath(index, task, `task=${task.id}`),
        "grade archive consistency",
        archive,
        grade,
      );
    }
  }

  const dTasks = grades
    .filter((grade) => grade.calibratedGrade === "D")
    .map((grade) => grade.taskId);
  const plansByTask = new Map<string, AnyRow[]>();
  for (const plan of dataset.rows.improvementPlans as AnyRow[]) {
    const rows = plansByTask.get(plan.taskId) ?? [];
    rows.push(plan);
    plansByTask.set(plan.taskId, rows);
  }
  for (const taskId of dTasks) {
    const plans = plansByTask.get(taskId) ?? [];
    if (plans.length !== 1) {
      fail(
        rowPath(index, index.tasks.get(taskId)!, `task=${taskId}`),
        "D grade improvement plan",
        plans.length,
        1,
      );
    }
  }
  if (
    [...plansByTask.keys()].some(
      (taskId) => gradeByTask.get(taskId)?.calibratedGrade !== "D",
    )
  ) {
    fail(
      "global/global/improvement-plan",
      "D grade improvement plan",
      "non-D task",
      "D task only",
    );
  }
  for (const plan of dataset.rows.improvementPlans as AnyRow[]) {
    const task = index.tasks.get(plan.taskId)!;
    if (plan.employeeId !== task.employeeId || plan.cycleId !== task.cycleId) {
      fail(
        rowPath(index, plan, "improvement-plan"),
        "plan task consistency",
        plan,
        "same employee and cycle",
      );
    }
    if (
      plan.status === "completed" &&
      (plan.finalScore < 1 || plan.finalScore > 10)
    ) {
      fail(
        rowPath(index, plan, "improvement-plan"),
        "completed plan score",
        plan.finalScore,
        "1..10",
      );
    }
    if (plan.status !== "completed" && plan.finalScore !== null) {
      fail(
        rowPath(index, plan, "improvement-plan"),
        "unfinished plan score",
        plan.finalScore,
        null,
      );
    }
  }

  const auditsByEntity = new Map<string, AnyRow[]>();
  for (const audit of dataset.rows.auditLogs as AnyRow[]) {
    const rows = auditsByEntity.get(audit.entityId) ?? [];
    rows.push(audit);
    auditsByEntity.set(audit.entityId, rows);
  }
  const appealStatus = countBy(dataset.rows.appeals as AnyRow[], "status");
  const expectedAppealStatus = {
    resolved: 5,
    dept_processing: 1,
    hr_processing: 1,
  };
  if (!equalCounts(appealStatus, expectedAppealStatus)) {
    fail(
      "global/global/appeals",
      "appeal status quota",
      appealStatus,
      expectedAppealStatus,
    );
  }
  for (const appeal of dataset.rows.appeals as AnyRow[]) {
    const task = index.tasks.get(appeal.taskId)!;
    const grade = gradeByTask.get(task.id)!;
    const archive = archiveByEmployeeCycle.get(
      `${task.employeeId}:${task.cycleId}`,
    )!;
    const audits = auditsByEntity.get(appeal.id) ?? [];
    if (
      appeal.cycleId !== task.cycleId ||
      appeal.appellantId !== task.employeeId
    ) {
      fail(
        rowPath(index, appeal, "appeal"),
        "appeal task consistency",
        appeal,
        "same task/cycle/employee",
      );
    }
    const hasDeptEvidence =
      Boolean(appeal.deptResolution) &&
      Boolean(appeal.deptResolvedAt) &&
      Boolean(appeal.deptResolverId);
    const hasHrEvidence =
      Boolean(appeal.hrResolution) &&
      Boolean(appeal.hrResolvedAt) &&
      Boolean(appeal.hrResolverId);
    const appealStateValid =
      (appeal.status === "resolved" &&
        hasDeptEvidence &&
        hasHrEvidence &&
        ["maintained", "modified"].includes(appeal.finalResult)) ||
      (appeal.status === "dept_processing" &&
        !hasDeptEvidence &&
        !hasHrEvidence &&
        appeal.finalResult === null) ||
      (appeal.status === "hr_processing" &&
        hasDeptEvidence &&
        !hasHrEvidence &&
        appeal.finalResult === null);
    if (!appealStateValid) {
      fail(
        rowPath(index, appeal, "appeal"),
        "appeal state evidence",
        {
          status: appeal.status,
          finalResult: appeal.finalResult,
          hasDeptEvidence,
          hasHrEvidence,
        },
        "state-specific resolver, resolution, timestamp, and result",
      );
    }
    const appealChronology = [
      appeal.createdAt,
      appeal.deptResolvedAt,
      appeal.hrResolvedAt,
    ]
      .filter(Boolean)
      .map((value) => date(value)!.getTime());
    if (
      appealChronology.some(
        (value, position) =>
          position > 0 && value < appealChronology[position - 1],
      )
    ) {
      fail(
        rowPath(index, appeal, "appeal"),
        "appeal chronology",
        appealChronology,
        "created <= department <= HR",
      );
    }
    if (audits.length !== 1) {
      fail(
        rowPath(index, appeal, "appeal"),
        "appeal audit cardinality",
        audits.length,
        1,
      );
    }
    const audit = audits[0];
    const newValue = audit.newValue as AnyRow;
    const auditActor = index.users.get(audit.userId);
    const expectedAction =
      appeal.status === "resolved" ? "resolve_appeal" : "create_appeal";
    if (
      audit.entityType !== "appeal" ||
      audit.action !== expectedAction ||
      !auditActor ||
      !["hr", "system_admin"].includes(auditActor.sysRole) ||
      !newValue ||
      newValue.status !== appeal.status ||
      newValue.result !== appeal.finalResult ||
      newValue.appellantId !== appeal.appellantId
    ) {
      fail(
        rowPath(index, appeal, "appeal"),
        "appeal audit evidence",
        audit,
        `${expectedAction} by HR with matching state`,
      );
    }
    if (
      newValue.calibratedGrade !== grade.calibratedGrade ||
      archive.grade !== grade.calibratedGrade
    ) {
      fail(
        rowPath(index, appeal, "appeal"),
        "appeal grade archive consistency",
        newValue.calibratedGrade,
        grade.calibratedGrade,
      );
    }
    if (appeal.finalResult === "modified") {
      const oldValue = audit.oldValue as AnyRow;
      if (!oldValue || oldValue.calibratedGrade === newValue.calibratedGrade) {
        fail(
          rowPath(index, appeal, "appeal"),
          "modified appeal grade change",
          oldValue,
          newValue,
        );
      }
    }
    if (["dept_processing", "hr_processing"].includes(appeal.status)) {
      if (
        appeal.finalResult !== null ||
        newValue.stateOrigin !== "historical_migration"
      ) {
        fail(
          rowPath(index, appeal, "appeal"),
          "historical migration appeal provenance",
          newValue.stateOrigin,
          "historical_migration",
        );
      }
    }
  }

  const signaturesByBusiness = new Map<string, AnyRow[]>();
  for (const signature of dataset.rows.signatures as AnyRow[]) {
    const rows = signaturesByBusiness.get(signature.businessRecordId) ?? [];
    rows.push(signature);
    signaturesByBusiness.set(signature.businessRecordId, rows);
  }
  const interviewTaskIds = new Set<string>();
  for (const interview of dataset.rows.interviews as AnyRow[]) {
    interviewTaskIds.add(interview.taskId);
    const task = index.tasks.get(interview.taskId)!;
    const signatures = signaturesByBusiness.get(interview.id) ?? [];
    const roles = signatures.map((signature) => signature.role).sort();
    const expectedRoles =
      interview.status === "closed"
        ? ["assessee", "assessor"]
        : interview.status === "filled" && interview.managerSignedAt
          ? ["assessor"]
          : [];
    const expectedInterviewTime = interview.status !== "pending";
    if (
      interview.cycleId !== task.cycleId ||
      interview.employeeId !== task.employeeId ||
      !sameMembers(roles, expectedRoles) ||
      Boolean(interview.managerSignedAt) !==
        expectedRoles.includes("assessor") ||
      Boolean(interview.employeeSignedAt) !==
        expectedRoles.includes("assessee") ||
      Boolean(interview.interviewTime) !== expectedInterviewTime
    ) {
      fail(
        rowPath(index, interview, "interview"),
        "interview signature state",
        { status: interview.status, roles },
        expectedRoles,
      );
    }
    for (const signature of signatures) {
      const expectedSigner =
        signature.role === "assessor"
          ? interview.interviewerId
          : interview.employeeId;
      const expectedSignedAt =
        signature.role === "assessor"
          ? interview.managerSignedAt
          : interview.employeeSignedAt;
      if (
        signature.signerId !== expectedSigner ||
        date(signature.signedAt)?.getTime() !==
          date(expectedSignedAt)?.getTime()
      ) {
        fail(
          rowPath(index, interview, "interview"),
          "interview signature subject",
          {
            role: signature.role,
            signerId: signature.signerId,
            signedAt: signature.signedAt,
          },
          { signerId: expectedSigner, signedAt: expectedSignedAt },
        );
      }
    }
  }
  if (
    !sameMembers(
      [...interviewTaskIds],
      grades.map((grade) => grade.taskId),
    )
  ) {
    fail(
      "global/global/interviews",
      "graded task interview coverage",
      interviewTaskIds.size,
      grades.length,
    );
  }

  const indicatorsByReview = new Map<string, AnyRow[]>();
  for (const indicator of dataset.rows.probationIndicators as AnyRow[]) {
    const rows = indicatorsByReview.get(indicator.probationReviewId) ?? [];
    rows.push(indicator);
    indicatorsByReview.set(indicator.probationReviewId, rows);
  }
  for (const review of dataset.rows.probationReviews as AnyRow[]) {
    const indicators = indicatorsByReview.get(review.id) ?? [];
    const workWeight = indicators
      .filter((indicator) => indicator.type === "work_objective")
      .reduce((sum, indicator) => sum + number(indicator.weight), 0);
    const valueWeight = indicators
      .filter((indicator) => indicator.type === "values")
      .reduce((sum, indicator) => sum + number(indicator.weight), 0);
    if (
      indicators.length !== 4 ||
      Math.abs(workWeight - 0.8) > 0.0001 ||
      Math.abs(valueWeight - 0.2) > 0.0001
    ) {
      fail(
        rowPath(index, review, "probation-review"),
        "probation indicator weights",
        { count: indicators.length, workWeight, valueWeight },
        { count: 4, workWeight: 0.8, valueWeight: 0.2 },
      );
    }
    const signatures = signaturesByBusiness.get(review.id) ?? [];
    if (review.status === "closed") {
      if (
        !review.completedAt ||
        !review.employeeSignedAt ||
        !review.managerSignedAt ||
        !review.hrSignedAt
      ) {
        fail(
          rowPath(index, review, "probation-review"),
          "closed probation completion",
          {
            completedAt: Boolean(review.completedAt),
            employeeSignedAt: Boolean(review.employeeSignedAt),
            managerSignedAt: Boolean(review.managerSignedAt),
            hrSignedAt: Boolean(review.hrSignedAt),
          },
          "all completion timestamps",
        );
      }
      if (
        !sameMembers(
          signatures.map((row) => row.role),
          ["assessee", "assessor", "hr"],
        )
      ) {
        fail(
          rowPath(index, review, "probation-review"),
          "closed probation signatures",
          signatures.map((row) => row.role),
          ["assessee", "assessor", "hr"],
        );
      }
    } else if (review.completedAt) {
      fail(
        rowPath(index, review, "probation-review"),
        "unfinished probation completion",
        review.completedAt,
        null,
      );
    }
    for (const signature of signatures) {
      const subjectByRole: Record<string, [string, unknown]> = {
        assessee: [review.employeeId, review.employeeSignedAt],
        assessor: [review.managerId, review.managerSignedAt],
        hr: [review.hrId, review.hrSignedAt],
      };
      const expectedSubject = subjectByRole[signature.role];
      if (
        !expectedSubject ||
        signature.signerId !== expectedSubject[0] ||
        date(signature.signedAt)?.getTime() !==
          date(expectedSubject[1])?.getTime()
      ) {
        fail(
          rowPath(index, review, "probation-review"),
          "probation signature subject",
          signature,
          expectedSubject,
        );
      }
    }
  }

  const reviewsById = new Map(
    (dataset.rows.probationReviews as AnyRow[]).map((row) => [row.id, row]),
  );
  for (const confirmation of dataset.rows.confirmations as AnyRow[]) {
    const user = index.users.get(confirmation.employeeId)!;
    const review = reviewsById.get(confirmation.probationReviewId);
    if (!review) {
      fail(
        rowPath(index, confirmation, "confirmation"),
        "confirmation review relation",
        confirmation.probationReviewId,
        "probation review",
      );
    }
    if (
      confirmation.employeeId !== review.employeeId ||
      confirmation.managerId !== review.managerId ||
      confirmation.hrId !== review.hrId
    ) {
      fail(
        rowPath(index, confirmation, "confirmation"),
        "confirmation review subjects",
        {
          employeeId: confirmation.employeeId,
          managerId: confirmation.managerId,
          hrId: confirmation.hrId,
        },
        {
          employeeId: review.employeeId,
          managerId: review.managerId,
          hrId: review.hrId,
        },
      );
    }
    const expected =
      confirmation.voteResult === "pass"
        ? { status: "approved", userStatus: "active", actual: true }
        : confirmation.voteResult === "extend"
          ? { status: "rejected", userStatus: "probation", actual: false }
          : { status: "rejected", userStatus: "resigned", actual: false };
    if (
      confirmation.status !== expected.status ||
      user.status !== expected.userStatus ||
      Boolean(confirmation.actualRegularDate) !== expected.actual
    ) {
      fail(
        rowPath(index, confirmation, "confirmation"),
        "confirmation outcome",
        {
          status: confirmation.status,
          userStatus: user.status,
          actual: Boolean(confirmation.actualRegularDate),
        },
        expected,
      );
    }
    const terminalStateValid =
      (confirmation.status === "approved" &&
        Boolean(confirmation.companyApprovedAt) &&
        !confirmation.rejectedById &&
        !confirmation.rejectedAt &&
        !confirmation.rejectReason) ||
      (confirmation.status === "rejected" &&
        !confirmation.companyApprovedAt &&
        Boolean(confirmation.rejectedById) &&
        Boolean(confirmation.rejectedAt) &&
        Boolean(confirmation.rejectReason));
    if (!terminalStateValid) {
      fail(
        rowPath(index, confirmation, "confirmation"),
        "confirmation terminal evidence",
        {
          status: confirmation.status,
          companyApprovedAt: confirmation.companyApprovedAt,
          rejectedById: confirmation.rejectedById,
          rejectedAt: confirmation.rejectedAt,
          rejectReason: confirmation.rejectReason,
        },
        "approved or rejected terminal fields",
      );
    }
    const terminalAt =
      confirmation.status === "approved"
        ? confirmation.companyApprovedAt
        : confirmation.rejectedAt;
    const chronology = [
      confirmation.createdAt,
      confirmation.managerApprovedAt,
      confirmation.hrApprovedAt,
      terminalAt,
    ].map((value) => date(value)?.getTime() ?? Number.NaN);
    if (
      chronology.some((value) => Number.isNaN(value)) ||
      chronology.some(
        (value, position) => position > 0 && value < chronology[position - 1],
      )
    ) {
      fail(
        rowPath(index, confirmation, "confirmation"),
        "confirmation chronology",
        chronology,
        "created <= manager <= HR <= terminal",
      );
    }
    const audits = auditsByEntity.get(confirmation.id) ?? [];
    if (audits.length !== 1) {
      fail(
        rowPath(index, confirmation, "confirmation"),
        "confirmation audit cardinality",
        audits.length,
        1,
      );
    }
    const audit = audits[0];
    const oldValue = audit.oldValue as AnyRow;
    const newValue = audit.newValue as AnyRow;
    const expectedAction =
      confirmation.status === "approved"
        ? "approve_confirmation"
        : "reject_confirmation";
    const expectedActor =
      confirmation.status === "approved"
        ? confirmation.companyApproverId
        : confirmation.rejectedById;
    if (
      audit.entityType !== "confirmation_application" ||
      audit.action !== expectedAction ||
      audit.userId !== expectedActor ||
      oldValue?.status !== "hr_approved" ||
      newValue?.status !== confirmation.status ||
      newValue?.voteResult !== confirmation.voteResult ||
      (confirmation.actualRegularDate
        ? date(newValue?.actualRegularDate)?.getTime() !==
          date(confirmation.actualRegularDate)?.getTime()
        : newValue?.actualRegularDate !== null)
    ) {
      fail(
        rowPath(index, confirmation, "confirmation"),
        "confirmation audit evidence",
        audit,
        `${expectedAction} by terminal approver with matching state`,
      );
    }
  }

  const acceptanceUserIds = new Set(
    Object.values(dataset.manifest.acceptanceEmployeeNos).map(
      (employeeNo) =>
        [...index.users.values()].find(
          (user) => user.employeeNo === employeeNo,
        )!.id,
    ),
  );
  const notificationsByUser = new Map<string, AnyRow[]>();
  for (const notification of dataset.rows.notifications as AnyRow[]) {
    const rows = notificationsByUser.get(notification.userId) ?? [];
    rows.push(notification);
    notificationsByUser.set(notification.userId, rows);
    if (!acceptanceUserIds.has(notification.userId)) {
      fail(
        rowPath(index, notification, "notification"),
        "acceptance notification receiver",
        notification.userId,
        "acceptance account",
      );
    }
    const deliveryStateValid =
      (notification.status === "sent" &&
        Boolean(notification.sentAt) &&
        !notification.errorMsg) ||
      (notification.status === "failed" &&
        !notification.sentAt &&
        Boolean(notification.errorMsg));
    const readStateValid =
      Boolean(notification.isRead) === Boolean(notification.readAt);
    if (!deliveryStateValid || !readStateValid) {
      fail(
        rowPath(index, notification, "notification"),
        "notification delivery state",
        {
          status: notification.status,
          sentAt: Boolean(notification.sentAt),
          errorMsg: Boolean(notification.errorMsg),
          isRead: notification.isRead,
          readAt: Boolean(notification.readAt),
        },
        "sent/failed and read timestamps are coherent",
      );
    }
    if (!notification.isRead && notification.taskId) {
      const task = index.tasks.get(notification.taskId)!;
      const cycle = index.cycles.get(task.cycleId)!;
      const receiver = index.users.get(notification.userId)!;
      const accessible =
        [
          task.employeeId,
          task.managerId,
          task.deptHeadId,
          task.approverId,
        ].includes(notification.userId) ||
        receiver.sysRole === "hr" ||
        receiver.sysRole === "system_admin" ||
        receiver.canViewAll;
      if (
        !accessible ||
        cycle.name !== "2026-Q3" ||
        !["indicator_setting", "indicator_confirming", "self_eval"].includes(
          task.status,
        )
      ) {
        fail(
          rowPath(index, notification, "notification"),
          "unread actionable task access",
          { accessible, cycle: cycle.name, status: task.status },
          "accessible active Q3 task",
        );
      }
    }
    if (notification.taskId) {
      const task = index.tasks.get(notification.taskId)!;
      if (notification.cycleId !== task.cycleId) {
        fail(
          rowPath(index, notification, "notification"),
          "notification task cycle",
          notification.cycleId,
          task.cycleId,
        );
      }
    }
  }
  for (const userId of acceptanceUserIds) {
    const notifications = notificationsByUser.get(userId) ?? [];
    const unreadActionable = notifications.filter(
      (row) => !row.isRead && row.taskId,
    );
    if (notifications.length !== 6 || unreadActionable.length !== 2) {
      fail(
        `global/${index.employeeNoByUserId.get(userId)}/notifications`,
        "notification acceptance mix",
        {
          total: notifications.length,
          unreadActionable: unreadActionable.length,
        },
        { total: 6, unreadActionable: 2 },
      );
    }
  }
}

function validateSensitiveJson(
  dataset: RealisticDemoDataset,
  index: ValidationIndex,
): void {
  const jsonFields: Array<[AnyRow, string, unknown]> = [];
  const add = (rows: AnyRow[], fields: string[]) => {
    for (const row of rows) {
      for (const field of fields) jsonFields.push([row, field, row[field]]);
    }
  };
  add(dataset.rows.cycles as AnyRow[], ["publishVisibleFields"]);
  add(dataset.rows.snapshots as AnyRow[], ["snapshotData"]);
  add(dataset.rows.indicatorInstances as AnyRow[], ["extraScores"]);
  add(dataset.rows.selfEvaluations as AnyRow[], ["attachments"]);
  add(dataset.rows.managerEvaluations as AnyRow[], ["attachments"]);
  add(dataset.rows.flowRecords as AnyRow[], ["extraData"]);
  add(dataset.rows.archives as AnyRow[], ["summary"]);
  add(dataset.rows.appeals as AnyRow[], ["attachments"]);
  add(dataset.rows.improvementPlans as AnyRow[], ["measures"]);
  add(dataset.rows.confirmations as AnyRow[], ["voteParticipants"]);
  add(dataset.rows.notifications as AnyRow[], ["extraData"]);
  add(dataset.rows.auditLogs as AnyRow[], ["oldValue", "newValue"]);

  const sensitive = /password|authorization|token|cookie|secret|api[_-]?key/i;
  const scan = (value: unknown, path: string[]): string | null => {
    if (Array.isArray(value)) {
      for (const [arrayIndex, item] of value.entries()) {
        const found = scan(item, [...path, String(arrayIndex)]);
        if (found) return found;
      }
      return null;
    }
    if (!value || typeof value !== "object") return null;
    for (const [key, item] of Object.entries(value)) {
      if (sensitive.test(key)) return [...path, key].join(".");
      const found = scan(item, [...path, key]);
      if (found) return found;
    }
    return null;
  };
  for (const [row, field, value] of jsonFields) {
    const found = scan(value, [field]);
    if (found) {
      fail(
        rowPath(index, row, `json=${row.id}`),
        "sensitive JSON fields",
        found,
        "no credential-shaped keys",
      );
    }
  }
}

export function validateRealisticDemoDataset(
  dataset: RealisticDemoDataset,
): void {
  if (
    dataset.manifest.source !== DEMO_CONFIG.source ||
    dataset.manifest.asOf.getTime() !== DEMO_CONFIG.asOf.getTime()
  ) {
    fail(
      "global/global/manifest",
      "fixed source and observation instant",
      [dataset.manifest.source, dataset.manifest.asOf],
      [DEMO_CONFIG.source, DEMO_CONFIG.asOf],
    );
  }
  const index = buildIndex(dataset);
  validatePrismaShapes(dataset, index);
  validateDPlanCoverage(dataset, index);
  validateIdentity(dataset, index);
  validateRelations(dataset, index);
  validatePopulation(dataset, index);
  validateCatalog(dataset, index);
  validateTime(dataset, index);
  validateTasksAndScores(dataset, index);
  validateArchivesAndWorkflows(dataset, index);
  validateSensitiveJson(dataset, index);
}
