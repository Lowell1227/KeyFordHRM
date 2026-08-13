import { Prisma } from "@prisma/client";
import { generateCatalog } from "./catalog";
import { createDemoContext, type DemoContext } from "./context";
import { generatePeople } from "./people";
import { generatePerformance } from "./performance";
import type {
  CatalogBundle,
  DemoEntityKind,
  DemoRowSets,
  PeopleBundle,
  PerformanceBundle,
  RealisticDemoDataset,
  WorkflowBundle,
} from "./types";
import { validateRealisticDemoDataset } from "./validate";
import { generateWorkflows } from "./workflows";

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

function cloneForDataset<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value instanceof Prisma.Decimal) return value.toString() as T;
  if (Array.isArray(value)) {
    return value.map((item) => cloneForDataset(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneForDataset(item)]),
    ) as T;
  }
  return value;
}

function assertAssemblerUniqueness(rows: DemoRowSets): void {
  const allIds = Object.values(rows).flatMap((values) =>
    values.map((row) => row.id).filter((id): id is string => Boolean(id)),
  );
  if (new Set(allIds).size !== allIds.length) {
    throw new Error("realistic demo assembler found duplicate entity IDs");
  }

  const employeeNumbers = rows.users
    .map((user) => user.employeeNo)
    .filter((employeeNo): employeeNo is string => Boolean(employeeNo));
  if (new Set(employeeNumbers).size !== employeeNumbers.length) {
    throw new Error(
      "realistic demo assembler found duplicate employee numbers",
    );
  }
}

function assembleDataset(
  context: DemoContext,
  people: PeopleBundle,
  catalog: CatalogBundle,
  performance: PerformanceBundle,
  workflows: WorkflowBundle,
): RealisticDemoDataset {
  const rows: DemoRowSets = {
    departments: people.departments,
    users: people.users,
    indicators: catalog.indicators,
    templates: catalog.templates,
    dimensions: catalog.dimensions,
    templateIndicators: catalog.templateIndicators,
    cycles: performance.cycles,
    snapshots: performance.snapshots,
    tasks: performance.tasks,
    indicatorInstances: performance.indicatorInstances,
    selfEvaluations: performance.selfEvaluations,
    managerEvaluations: performance.managerEvaluations,
    gradeResults: performance.gradeResults,
    flowRecords: performance.flowRecords,
    archives: performance.archives,
    objectives: performance.objectives,
    actionItems: performance.actionItems,
    interviews: workflows.interviews,
    appeals: workflows.appeals,
    improvementPlans: workflows.improvementPlans,
    probationReviews: workflows.probationReviews,
    probationIndicators: workflows.probationIndicators,
    confirmations: workflows.confirmations,
    signatures: workflows.signatures,
    notifications: workflows.notifications,
    auditLogs: workflows.auditLogs,
  };
  assertAssemblerUniqueness(rows);

  for (const [rowSet, kind] of Object.entries(ROW_KIND) as Array<
    [keyof DemoRowSets, DemoEntityKind]
  >) {
    context.manifest.ownedIds[kind] = [
      ...new Set(
        rows[rowSet]
          .map((row) => row.id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
  }

  const dataset = cloneForDataset<RealisticDemoDataset>({
    rows,
    departmentLeadership: people.departmentLeadership,
    manifest: context.manifest,
  });
  validateRealisticDemoDataset(dataset);
  return dataset;
}

export function generateRealisticDemoDataset(): RealisticDemoDataset {
  const context = createDemoContext();
  const people = generatePeople(context);
  const catalog = generateCatalog(context, people);
  const performance = generatePerformance(context, people, catalog);
  const workflows = generateWorkflows(context, people, performance);
  return assembleDataset(context, people, catalog, performance, workflows);
}
